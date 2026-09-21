from datetime import datetime, time
from decimal import Decimal

from django.db.models import F, Q, Sum
from django.utils.dateparse import parse_date, parse_datetime, parse_time
from rest_framework import permissions, status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import ValidationError
from rest_framework.response import Response

from apps.discharge.catalog import build_discharge_field_catalog, sanitize_discharge_template_payload
from apps.discharge.constants import DISCHARGE_TEXT_FIELDS
from apps.discharge.models import (
    DischargeInvestigation,
    DischargeMedication,
    DischargeSummary,
    DischargeSummaryTemplate,
    DischargeSurgery,
)
from apps.discharge.serializers import DischargeSummarySerializer, DischargeSummaryTemplateSerializer
from apps.ipd.models import IPDAdmission
from apps.billing.final_bill_utils import next_ipd_final_bill_number
from apps.billing.models import BillingInvoice
from apps.billing.collection_attribution import apply_attribution_to_invoice
from apps.payments.models import PaymentTransaction
from apps.settings_management.document_number_service import render_document_number


def _parse_bool(val):
    if val is True or val is False:
        return val
    if val in (None, ""):
        return False
    s = str(val).strip().lower()
    return s in ("1", "true", "yes", "on")


def _parse_optional_date(val):
    if val in (None, ""):
        return None
    if hasattr(val, "isoformat") and not isinstance(val, str):
        return val
    return parse_date(str(val))


def _parse_optional_time(val):
    if val in (None, ""):
        return None
    if hasattr(val, "isoformat") and not isinstance(val, str):
        return val
    return parse_time(str(val))


def _parse_optional_datetime(val):
    if val in (None, ""):
        return None
    if hasattr(val, "isoformat") and not isinstance(val, str):
        return val
    return parse_datetime(str(val))


def _doctor_display_name(user):
    if not user:
        return ""
    fn = getattr(user, "first_name", "") or ""
    ln = getattr(user, "last_name", "") or ""
    name = f"{fn} {ln}".strip()
    if name:
        return name
    return getattr(user, "email", "") or str(user.pk)


class DischargeSummaryViewSet(viewsets.ModelViewSet):
    queryset = (
        DischargeSummary.objects.all()
        .select_related(
            "admission",
            "admission__patient",
            "admission__patient__guardian",
            "admission__assigned_doctor",
            "admission__scheme",
        )
        .prefetch_related("medication_rows", "investigation_rows", "surgery_rows")
        .order_by("-updated_at", "-created_at")
    )
    serializer_class = DischargeSummarySerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        qs = super().get_queryset()
        if self.request.user.is_superuser:
            filtered_qs = qs
        else:
            filtered_qs = qs.filter(hospital_id=self.request.user.hospital_id)

        admission_id = self.request.query_params.get("admission_id")
        if admission_id:
            filtered_qs = filtered_qs.filter(admission_id=admission_id)

        is_draft_param = self.request.query_params.get("is_draft")
        if is_draft_param is not None and str(is_draft_param).strip() != "":
            filtered_qs = filtered_qs.filter(is_draft=_parse_bool(is_draft_param))

        return filtered_qs.order_by("-updated_at", "-created_at")

    def _finalize_admission(self, admission, hospital_id, summary=None):
        # 1. Finalize Room Charges before closing (skip for death/abscond discharge types)
        from django.db import transaction
        from django.utils import timezone

        from apps.beds.models import Bed
        from apps.billing.models import (
            BillingInvoice,
            IPDFinalBill,
            IPDFinalBillItem,
            InvoiceItem,
            InvoiceNumberSequence,
        )

        skip_room_invoice = summary and summary.discharge_type in (
            DischargeSummary.DischargeType.DEATH,
            DischargeSummary.DischargeType.ABSCONDED,
        )

        from apps.ipd.services import ipd_stay_days

        stay_days = ipd_stay_days(admission)
        end_date = (
            summary.discharge_date
            if summary and summary.discharge_date
            else timezone.now().date()
        )

        with transaction.atomic():
            if not skip_room_invoice and admission.bed_code:
                room_invoice_exists = BillingInvoice.objects.filter(
                    ipd_admission=admission,
                    invoice_no__startswith="IPDROOM-",
                    status=BillingInvoice.Status.FINALIZED,
                ).exists()
                bed = Bed.objects.filter(bed_code=admission.bed_code, hospital_id=hospital_id).select_related("room").first()
                if not room_invoice_exists and bed and bed.room:
                    daily_rate = bed.room.daily_charge
                    if admission.room_rent_daily_charge_override is not None:
                        daily_rate = admission.room_rent_daily_charge_override
                        total_room_amount = stay_days * daily_rate
                    elif admission.room_rent_override is not None:
                        total_room_amount = admission.room_rent_override
                        daily_rate = (
                            (total_room_amount / Decimal(stay_days))
                            if stay_days
                            else total_room_amount
                        )
                    else:
                        total_room_amount = stay_days * daily_rate

                    if total_room_amount > 0:
                        year = end_date.year
                        seq, _ = InvoiceNumberSequence.objects.select_for_update().get_or_create(
                            hospital_id=hospital_id, year=year
                        )
                        seq.last_seq += 1
                        seq.save(update_fields=["last_seq"])

                        room_inv_no = render_document_number(admission.hospital, "ipd_room", year, seq.last_seq)

                        room_invoice = BillingInvoice.objects.create(
                            hospital_id=hospital_id,
                            invoice_no=room_inv_no,
                            encounter_type=BillingInvoice.EncounterType.IPD,
                            patient=admission.patient,
                            ipd_admission=admission,
                            status=BillingInvoice.Status.FINALIZED,
                            subtotal_amount=total_room_amount,
                            total_amount=total_room_amount,
                            amount_paid=Decimal("0.00"),
                            currency="INR",
                            invoice_date=end_date,
                        )
                        apply_attribution_to_invoice(room_invoice, ipd_admission=admission)
                        InvoiceItem.objects.create(
                            invoice=room_invoice,
                            description=f"Room Charges: {admission.bed_code} ({stay_days} days @ ₹{daily_rate})",
                            quantity=Decimal(str(stay_days)),
                            unit_price=daily_rate,
                            line_total=total_room_amount,
                        )

            # 2. Mark the admission as discharged
            if admission.status != IPDAdmission.Status.DISCHARGED:
                admission.status = IPDAdmission.Status.DISCHARGED
                admission.discharged_at = timezone.now()
                admission.save(update_fields=["status", "discharged_at"])

            # 3. Auto-clear pharmacy credit invoices linked to this admission
            from apps.pharmacy.models import PharmacyInvoice as PharmInvoice

            PharmInvoice.objects.filter(
                ipd_admission=admission,
                payment_method="credit",
                status=PharmInvoice.Status.FINALIZED,
                paid_amount__lt=F("grand_total"),
            ).update(paid_amount=F("grand_total"))

            # 4. Release occupied bed immediately after discharge (vacant/available).
            if admission.bed_code:
                Bed.objects.filter(
                    bed_code=admission.bed_code,
                    hospital_id=hospital_id,
                ).update(status=Bed.Status.AVAILABLE)

            # 5. Populate/refresh the editable final bill record.
            items_qs = (
                InvoiceItem.objects.filter(
                    invoice__ipd_admission=admission,
                    invoice__status=BillingInvoice.Status.FINALIZED,
                )
                .exclude(invoice__invoice_no__startswith="IPDADV-")
                .select_related("invoice")
            )

            positive_items = items_qs.filter(line_total__gte=0)
            gross = positive_items.aggregate(total=Sum("line_total"))["total"] or Decimal("0.00")
            discount_total = items_qs.filter(line_total__lt=0).aggregate(total=Sum("line_total"))["total"] or Decimal("0.00")
            discount = abs(discount_total)
            amount_paid = (
                BillingInvoice.objects.filter(
                    ipd_admission=admission,
                    status=BillingInvoice.Status.FINALIZED,
                ).aggregate(total=Sum("amount_paid"))["total"]
                or Decimal("0.00")
            )
            net = max(gross - discount, Decimal("0.00"))
            due = max(net - amount_paid, Decimal("0.00"))

            patient = admission.patient
            patient_name = " ".join(
                part for part in [patient.first_name, patient.middle_name, patient.last_name] if part
            ).strip()
            guardian_name = getattr(getattr(patient, "guardian", None), "name", "") or ""
            address = getattr(patient, "address", None)
            address_parts = []
            if address is not None:
                address_parts = [
                    address.line1,
                    address.line2,
                    address.city,
                    address.state,
                    address.country,
                    address.postal_code,
                ]
            patient_address = ", ".join(part.strip() for part in address_parts if part and part.strip())
            consultant_name = summary.treating_consultant.strip() if summary and summary.treating_consultant else _doctor_display_name(admission.assigned_doctor)
            admission_dt = timezone.make_aware(datetime.combine(admission.admission_date, time.min))
            if summary and summary.discharge_date:
                discharge_time = summary.discharge_time or time.min
                discharge_dt = timezone.make_aware(datetime.combine(summary.discharge_date, discharge_time))
            else:
                discharge_dt = admission.discharged_at or timezone.now()

            final_bill, _ = IPDFinalBill.objects.get_or_create(
                admission=admission,
                defaults={
                    "hospital_id": hospital_id,
                    "patient": patient,
                    "bill_no": next_ipd_final_bill_number(admission),
                    "patient_name": patient_name,
                    "guardian_name": guardian_name,
                    "patient_phone": patient.phone or "",
                    "patient_address": patient_address,
                    "consultant_name": consultant_name,
                    "room_bed": admission.bed_code or "",
                    "scheme_name": getattr(getattr(admission, "scheme", None), "name", "") or "",
                    "admission_date": admission_dt,
                },
            )
            final_bill_bill_no_was_missing = not (final_bill.bill_no or "").strip()
            if not (final_bill.bill_no or "").strip():
                final_bill.bill_no = next_ipd_final_bill_number(admission)
            final_bill.patient = patient
            final_bill.patient_name = patient_name
            final_bill.guardian_name = guardian_name
            final_bill.patient_phone = patient.phone or ""
            final_bill.patient_address = patient_address
            final_bill.consultant_name = consultant_name
            final_bill.room_bed = admission.bed_code or ""
            final_bill.scheme_name = getattr(getattr(admission, "scheme", None), "name", "") or ""
            final_bill.admission_date = admission_dt
            final_bill.discharge_date = discharge_dt
            final_bill.gross_amount = gross
            final_bill.discount_amount = discount
            final_bill.net_amount = net
            final_bill.amount_paid = amount_paid
            final_bill.due_amount = due
            final_bill.notes = summary.summary_notes if summary else ""
            final_bill.save(
                update_fields=[
                    "patient",
                    "patient_name",
                    "guardian_name",
                    "patient_phone",
                    "patient_address",
                    "consultant_name",
                    "room_bed",
                    "scheme_name",
                    "admission_date",
                    "discharge_date",
                    "gross_amount",
                    "discount_amount",
                    "net_amount",
                    "amount_paid",
                    "due_amount",
                    "notes",
                    "updated_at",
                ] + (["bill_no"] if final_bill_bill_no_was_missing else [])
            )
            final_bill.items.all().delete()
            IPDFinalBillItem.objects.bulk_create(
                [
                    IPDFinalBillItem(
                        final_bill=final_bill,
                        description=item.description,
                        category=item.category or "",
                        quantity=item.quantity,
                        rate=item.unit_price,
                        amount=item.line_total,
                    )
                    for item in positive_items
                ]
            )

    def create(self, request, *args, **kwargs):
        admission_id = request.data.get("admission")
        if not admission_id:
            return Response({"admission": ["This field is required."]}, status=status.HTTP_400_BAD_REQUEST)

        try:
            admission = IPDAdmission.objects.select_related(
                "hospital", "patient", "assigned_doctor"
            ).get(pk=admission_id)
        except IPDAdmission.DoesNotExist:
            return Response({"admission": ["Invalid admission id."]}, status=status.HTTP_400_BAD_REQUEST)

        if not request.user.is_superuser and admission.hospital_id != request.user.hospital_id:
            return Response({"detail": "Not permitted for this admission."}, status=status.HTTP_403_FORBIDDEN)

        hospital_id = admission.hospital_id

        summary, created = DischargeSummary.objects.get_or_create(
            admission=admission,
            defaults={"hospital_id": hospital_id},
        )

        TEXT_FIELDS = list(DISCHARGE_TEXT_FIELDS)

        CHOICE_FIELDS = ["discharge_type", "discharge_status", "mode_of_admission"]

        for field in TEXT_FIELDS:
            if field in request.data:
                setattr(summary, field, request.data.get(field) or "")

        for field in CHOICE_FIELDS:
            if field not in request.data:
                continue
            val = request.data.get(field)
            if val is None or (isinstance(val, str) and not val.strip()):
                continue
            setattr(summary, field, str(val).strip())

        if "vitals_at_discharge" in request.data:
            v = request.data.get("vitals_at_discharge")
            summary.vitals_at_discharge = v if isinstance(v, dict) else {}

        if "autopsy_required" in request.data:
            summary.autopsy_required = _parse_bool(request.data.get("autopsy_required"))

        if "patient_education_given" in request.data:
            summary.patient_education_given = _parse_bool(request.data.get("patient_education_given"))

        for fname in ("surgery_date", "stitch_removal_date", "next_follow_up_date", "discharge_date"):
            if fname in request.data:
                setattr(summary, fname, _parse_optional_date(request.data.get(fname)))

        if "discharge_time" in request.data:
            summary.discharge_time = _parse_optional_time(request.data.get("discharge_time"))

        if "time_of_death" in request.data:
            summary.time_of_death = _parse_optional_datetime(request.data.get("time_of_death"))

        if not (summary.treating_consultant or "").strip() and admission.assigned_doctor_id:
            summary.treating_consultant = _doctor_display_name(admission.assigned_doctor)

        if not (summary.mode_of_admission or "").strip():
            summary.mode_of_admission = (
                DischargeSummary.ModeOfAdmission.OPD
                if admission.opd_visit_id
                else DischargeSummary.ModeOfAdmission.EMERGENCY
            )

        is_finalize_payload = all(
            key in request.data for key in ["total_billed", "total_paid", "outstanding_balance"]
        )

        if is_finalize_payload:
            from django.utils import timezone as dj_tz

            now = dj_tz.now()
            if summary.discharge_date is None:
                summary.discharge_date = now.date()
            if summary.discharge_time is None:
                summary.discharge_time = now.time()

            try:
                summary.total_billed = Decimal(str(request.data.get("total_billed", summary.total_billed)))
                summary.total_paid = Decimal(str(request.data.get("total_paid", summary.total_paid)))
                summary.outstanding_balance = Decimal(str(request.data.get("outstanding_balance", summary.outstanding_balance)))
            except Exception:
                return Response(
                    {"detail": "Invalid financial values in finalize payload."},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            summary.is_draft = False
        elif "is_draft" in request.data:
            summary.is_draft = _parse_bool(request.data.get("is_draft"))

        summary.hospital_id = hospital_id
        summary.save()

        if "medication_rows" in request.data:
            summary.medication_rows.all().delete()
            rows = request.data.get("medication_rows") or []
            if isinstance(rows, list):
                for i, row in enumerate(rows):
                    if not isinstance(row, dict):
                        continue
                    drug_name = (row.get("drug_name") or "").strip()
                    if not drug_name:
                        continue
                    rx_m = row.get("rx_meta")
                    if not isinstance(rx_m, dict):
                        rx_m = {}
                    DischargeMedication.objects.create(
                        summary=summary,
                        drug_name=drug_name[:200],
                        dose=(row.get("dose") or "")[:80],
                        route=(row.get("route") or "")[:40],
                        frequency=(row.get("frequency") or "")[:80],
                        duration=(row.get("duration") or "")[:80],
                        instructions=(row.get("instructions") or "")[:200],
                        sort_order=i,
                        rx_meta=rx_m,
                    )

        if "investigation_rows" in request.data:
            summary.investigation_rows.all().delete()
            rows = request.data.get("investigation_rows") or []
            if isinstance(rows, list):
                for i, row in enumerate(rows):
                    if not isinstance(row, dict):
                        continue
                    test_name = (row.get("test_name") or "").strip()
                    if not test_name:
                        continue
                    cat = (row.get("category") or DischargeInvestigation.Category.LAB).strip().lower()
                    if cat not in ("lab", "imaging"):
                        cat = DischargeInvestigation.Category.LAB
                    DischargeInvestigation.objects.create(
                        summary=summary,
                        category=cat,
                        test_name=test_name[:200],
                        value=(row.get("value") or "")[:120],
                        reference_range=(row.get("reference_range") or "")[:120],
                        test_date=_parse_optional_date(row.get("test_date")),
                        sort_order=i,
                    )

        if "surgery_rows" in request.data:
            summary.surgery_rows.all().delete()
            rows = request.data.get("surgery_rows") or []
            if isinstance(rows, list):
                for i, row in enumerate(rows):
                    if not isinstance(row, dict):
                        continue
                    procedure_name = (
                        row.get("procedure_name")
                        or row.get("procedure_surgery")
                        or row.get("name")
                        or ""
                    ).strip()
                    if not procedure_name:
                        continue
                    DischargeSurgery.objects.create(
                        summary=summary,
                        surgery_date=_parse_optional_date(row.get("surgery_date")),
                        procedure_name=procedure_name[:300],
                        surgeon_name=(row.get("surgeon_name") or "")[:200],
                        assistant_name=(row.get("assistant_name") or "")[:200],
                        anaesthetist_name=(row.get("anaesthetist_name") or "")[:200],
                        anaesthesia_type=(row.get("anaesthesia_type") or "")[:120],
                        operative_findings=(row.get("operative_findings") or ""),
                        intra_op_complications=(row.get("intra_op_complications") or ""),
                        sort_order=i,
                    )

                first_row = next(
                    (
                        r
                        for r in rows
                        if isinstance(r, dict)
                        and (
                            (r.get("procedure_name") or "").strip()
                            or (r.get("procedure_surgery") or "").strip()
                        )
                    ),
                    None,
                )
                if first_row:
                    summary.procedure_surgery = (
                        (first_row.get("procedure_name") or first_row.get("procedure_surgery") or "").strip()
                    )
                    summary.surgery_date = _parse_optional_date(first_row.get("surgery_date"))
                    summary.surgeon_name = (first_row.get("surgeon_name") or "")[:200]
                    summary.assistant_name = (first_row.get("assistant_name") or "")[:200]
                    summary.anaesthetist_name = (first_row.get("anaesthetist_name") or "")[:200]
                    summary.anaesthesia_type = (first_row.get("anaesthesia_type") or "")[:120]
                    summary.operative_findings = first_row.get("operative_findings") or ""
                    summary.intra_op_complications = first_row.get("intra_op_complications") or ""
                    summary.save(
                        update_fields=[
                            "procedure_surgery",
                            "surgery_date",
                            "surgeon_name",
                            "assistant_name",
                            "anaesthetist_name",
                            "anaesthesia_type",
                            "operative_findings",
                            "intra_op_complications",
                            "updated_at",
                        ]
                    )

        if is_finalize_payload and admission.status != IPDAdmission.Status.DISCHARGED:
            self._finalize_admission(admission, hospital_id, summary=summary)

        summary = (
            DischargeSummary.objects.select_related(
                "admission",
                "admission__patient",
                "admission__patient__guardian",
                "admission__assigned_doctor",
            )
            .prefetch_related("medication_rows", "investigation_rows", "surgery_rows")
            .get(pk=summary.pk)
        )
        out = self.get_serializer(summary)
        status_code = status.HTTP_201_CREATED if created else status.HTTP_200_OK
        return Response(out.data, status=status_code)

    @action(detail=False, methods=["get"], url_path="billing-summary")
    def billing_summary(self, request):
        """Calculate total billed, paid, and outstanding for an admission including room charges."""
        admission_id = request.query_params.get("admission_id")
        if not admission_id:
            return Response({"error": "admission_id query param required"}, status=400)
            
        try:
            from django.utils import timezone
            from apps.beds.models import Bed
            admission = IPDAdmission.objects.select_related("patient", "hospital").get(pk=admission_id)
        except IPDAdmission.DoesNotExist:
            return Response({"error": "Admission not found"}, status=404)

        # 1. Total Services (Surgery, Pharmacy, etc.)
        # IMPORTANT: We calculate this from InvoiceItems to precisely exclude existing room rent items
        # and we must exclude Advance Invoices which are NOT charges.
        from apps.billing.models import InvoiceItem
        total_services = InvoiceItem.objects.filter(
            invoice__ipd_admission=admission,
            invoice__status=BillingInvoice.Status.FINALIZED
        ).exclude(
            # Exclude paid advances only; include credit advances as due services.
            Q(invoice__invoice_no__startswith="IPDADV-") & Q(invoice__amount_paid__gt=0)
        ).exclude(
            invoice__invoice_no__startswith="IPDROOM-" # Exclude finalized Room bills
        ).exclude(
            description__icontains="Room Rent" # Double-check exclusion by description
        ).aggregate(total=Sum("line_total"))["total"] or Decimal("0.00")

        # 2. Dynamic Room Charges
        room_total = Decimal("0.00")
        stay_days = 0
        daily_rate = Decimal("0.00")
        
        from apps.ipd.services import ipd_stay_days

        stay_days = ipd_stay_days(admission)

        # Get room rate (respect per-day or total ledger overrides when set)
        if admission.room_rent_daily_charge_override is not None:
            room_total = admission.room_rent_daily_charge_override * Decimal(stay_days)
            if admission.bed_code:
                bed = Bed.objects.filter(bed_code=admission.bed_code, hospital=admission.hospital).select_related("room").first()
                if bed and bed.room:
                    daily_rate = admission.room_rent_daily_charge_override
        elif admission.room_rent_override is not None:
            room_total = admission.room_rent_override
            if admission.bed_code:
                bed = Bed.objects.filter(bed_code=admission.bed_code, hospital=admission.hospital).select_related("room").first()
                if bed and bed.room:
                    daily_rate = bed.room.daily_charge
        elif admission.bed_code:
            bed = Bed.objects.filter(bed_code=admission.bed_code, hospital=admission.hospital).select_related("room").first()
            if bed and bed.room:
                daily_rate = bed.room.daily_charge
                room_total = stay_days * daily_rate

        # 3. Total Paid: Sum of all successful payment transactions (advances and payments)
        total_paid = PaymentTransaction.objects.filter(
            invoice__ipd_admission=admission,
            status=PaymentTransaction.Status.SUCCESS
        ).aggregate(total=Sum("amount"))["total"] or Decimal("0.00")

        total_billed = total_services + room_total
        outstanding = total_billed - total_paid

        return Response({
            "admission_id": admission_id,
            "patient_name": f"{admission.patient.first_name} {admission.patient.last_name}",
            "admission_date": admission.admission_date,
            "stay_days": stay_days,
            "daily_rate": daily_rate,
            "room_total": room_total,
            "total_services": total_services,
            "total_billed": total_billed,
            "total_paid": total_paid,
            "outstanding": outstanding
        })

    @action(detail=False, methods=["get"], url_path="field-catalog")
    def field_catalog(self, request):
        """Hospital-wide discharge field suggestions for autocomplete."""
        hospital_id = getattr(request.user, "hospital_id", None)
        if request.user.is_superuser:
            raw = (request.query_params.get("hospital_id") or "").strip()
            if raw:
                hospital_id = raw
        return Response(build_discharge_field_catalog(hospital_id))


class DischargeSummaryTemplateViewSet(viewsets.ModelViewSet):
    queryset = DischargeSummaryTemplate.objects.filter(is_active=True).order_by("name")
    serializer_class = DischargeSummaryTemplateSerializer
    permission_classes = [permissions.IsAuthenticated]
    http_method_names = ["get", "post", "patch", "delete", "head", "options"]

    def get_queryset(self):
        qs = super().get_queryset()
        if self.request.user.is_superuser:
            return qs
        return qs.filter(hospital_id=self.request.user.hospital_id)

    def create(self, request, *args, **kwargs):
        hospital_id = getattr(request.user, "hospital_id", None)
        if not hospital_id:
            return Response({"detail": "User must belong to a hospital."}, status=status.HTTP_400_BAD_REQUEST)
        name = (request.data.get("name") or "").strip()
        if not name:
            return Response({"name": ["This field is required."]}, status=status.HTTP_400_BAD_REQUEST)
        if DischargeSummaryTemplate.objects.filter(hospital_id=hospital_id, name=name, is_active=True).exists():
            return Response({"name": ["Template with this name already exists."]}, status=status.HTTP_400_BAD_REQUEST)
        return super().create(request, *args, **kwargs)

    def perform_create(self, serializer):
        hospital_id = getattr(self.request.user, "hospital_id", None)
        if not hospital_id:
            raise ValidationError({"detail": "User must belong to a hospital."})
        payload = sanitize_discharge_template_payload(self.request.data.get("payload"))
        serializer.save(
            hospital_id=hospital_id,
            payload=payload,
            created_by=self.request.user,
            updated_by=self.request.user,
        )

    def perform_update(self, serializer):
        save_kwargs = {"updated_by": self.request.user}
        if "payload" in self.request.data:
            save_kwargs["payload"] = sanitize_discharge_template_payload(self.request.data.get("payload"))
        serializer.save(**save_kwargs)

    def perform_destroy(self, instance):
        instance.is_active = False
        instance.updated_by = self.request.user
        instance.save(update_fields=["is_active", "updated_by", "updated_at"])
