from __future__ import annotations
from decimal import Decimal
from collections import defaultdict

from datetime import datetime, time as dtime

from django.db import transaction
from django.db.models import Q
from django.utils import timezone
from django.utils.dateparse import parse_datetime, parse_date
from rest_framework.exceptions import ValidationError
from rest_framework import permissions, status, viewsets
from rest_framework.decorators import action
from rest_framework.filters import SearchFilter
from rest_framework.response import Response

from apps.ipd.models import IPDAdmission, IPDAdmissionStatusHistory, IPDTransferHistory, IPDDailyProcessLog
from apps.ipd.serializers import IPDAdmissionCreateUpdateSerializer, IPDAdmissionSerializer, IPDDailyProcessLogSerializer
from apps.ipd.process_log_service import resolve_process_config_for_save, save_ipd_process_log
from apps.ipd.services import ipd_calendar_stay_days, ipd_stay_days
from apps.opd.models import OPDVisit
from apps.beds.models import Bed
from apps.billing.final_bill_utils import next_ipd_final_bill_number
from apps.billing.models import BillingInvoice, IPDFinalBill, InvoiceItem, InvoiceNumberSequence
from apps.payments.models import PaymentTransaction
from apps.payments.serializers import PaymentTransactionSerializer
from apps.roles_permissions.permissions import HasRequiredPermission
from apps.auditlogs.services import create_audit_log
from apps.billing.collection_attribution import apply_attribution_to_invoice, apply_attribution_to_payment
from apps.settings_management.document_number_service import render_document_number
from apps.shared.response import success_response


def _occupy_bed(bed_code: str, hospital_id):
    """Mark a bed as OCCUPIED by its bed_code."""
    if bed_code:
        Bed.objects.filter(bed_code=bed_code, hospital_id=hospital_id).update(status=Bed.Status.OCCUPIED)


def _release_bed(bed_code: str, hospital_id):
    """Mark a bed as CLEANING (ready to be cleaned before next use)."""
    if bed_code:
        Bed.objects.filter(bed_code=bed_code, hospital_id=hospital_id).update(status=Bed.Status.CLEANING)
        # Auto-create/refresh cleaning task for housekeeping workflow.
        from apps.beds.services import ensure_cleaning_task_for_bed

        ensure_cleaning_task_for_bed(
            bed_code=bed_code,
            hospital_id=hospital_id,
            notes="Auto-created from discharge/transfer.",
        )


def _parse_paid_at_from_request(request, default=None):
    """Optional paid_at from client (ISO datetime); defaults to now."""
    if default is None:
        default = timezone.now()
    raw = request.data.get("paid_at")
    if raw is None or str(raw).strip() == "":
        return default
    parsed = parse_datetime(str(raw).strip())
    if parsed is None:
        try:
            parsed = datetime.fromisoformat(str(raw).strip().replace("Z", "+00:00"))
        except (TypeError, ValueError):
            return default
    if timezone.is_naive(parsed):
        parsed = timezone.make_aware(parsed, timezone.get_current_timezone())
    return parsed


def _ipd_final_bill_patient_snapshot(patient):
    patient_name = " ".join(
        part for part in [getattr(patient, "first_name", ""), getattr(patient, "middle_name", ""), getattr(patient, "last_name", "")]
        if part
    ).strip()
    guardian_name = getattr(getattr(patient, "guardian", None), "name", "") or ""
    address_obj = getattr(patient, "address", None)
    patient_address = ""
    if address_obj is not None:
        patient_address = ", ".join(
            part.strip()
            for part in [
                getattr(address_obj, "line1", ""),
                getattr(address_obj, "line2", ""),
                getattr(address_obj, "city", ""),
                getattr(address_obj, "state", ""),
                getattr(address_obj, "postal_code", ""),
            ]
            if str(part).strip()
        )
    return patient_name, guardian_name, patient_address


def _ipd_doctor_display_name(user):
    if not user:
        return ""
    fn = (getattr(user, "first_name", "") or "").strip()
    ln = (getattr(user, "last_name", "") or "").strip()
    return f"{fn} {ln}".strip() or getattr(user, "email", "") or str(user.pk)


def _stamp_new_invoice_ledger_times(invoice, paid_at):
    """Align charge rows on IPD ledger with the payment timestamp chosen at reception."""
    BillingInvoice.objects.filter(pk=invoice.pk).update(
        created_at=paid_at,
        updated_at=paid_at,
        invoice_date=paid_at.date(),
    )
    InvoiceItem.objects.filter(invoice=invoice).update(created_at=paid_at, updated_at=paid_at)


def _ipd_ledger_grouped_row_is_cancelled(row: dict) -> bool:
    events = row.get("events") or []
    if events:
        return all(
            str(ev.get("invoice_status") or "").lower() == BillingInvoice.Status.CANCELLED
            for ev in events
        )
    return "(cancelled)" in str(row.get("description") or "").lower()


def _ipd_ledger_grouped_sort_key(row: dict):
    evs = row.get("events") or []
    dates = [e.get("date") or "" for e in evs] or [""]
    return (1 if _ipd_ledger_grouped_row_is_cancelled(row) else 0, min(dates))


def _ipd_ledger_payment_sort_key(p: dict):
    if str(p.get("type") or "") == "pharmacy_payment":
        return (0, p.get("date") or "")
    st = str(p.get("status") or "").lower()
    inv = str(p.get("invoice_status") or "").lower()
    void = st == PaymentTransaction.Status.CANCELLED or inv == BillingInvoice.Status.CANCELLED
    return (1 if void else 0, p.get("date") or "")


def _ipd_invoice_is_finalize_room_invoice(invoice_no: str) -> bool:
    return str(invoice_no or "").startswith("IPDROOM-")


def _ipd_ledger_is_room_charge_text(description: str) -> bool:
    lower = (description or "").strip().lower()
    if "discount" in lower:
        return False
    return "room rent" in lower or "room charge" in lower or "bed charge" in lower


def _ipd_room_rent_ledger_description(
    admission,
    *,
    days: int,
    unit_for_row,
    daily,
    room_rent,
) -> str:
    custom = (getattr(admission, "room_rent_description_override", None) or "").strip()
    if custom:
        return custom[:300]
    if admission.room_rent_daily_charge_override is not None:
        if admission.room_rent_daily_charge_override == Decimal("0.00"):
            return f"Room Rent ({days} day(s) — cancelled)"
        return f"Room Rent ({days} days @ ₹{unit_for_row}/day — adjusted)"
    if admission.room_rent_override is not None:
        if admission.room_rent_override == Decimal("0.00"):
            return "Room Rent (cancelled)"
        return f"Room Rent (adjusted · {days} day(s) basis)"
    if daily is not None:
        return f"Room Rent ({days} days @ ₹{daily})"
    return "Room Rent"


def _normalize_ipd_service_description(description: str) -> str:
    return " ".join((description or "").strip().split()).casefold()


def _ipd_unit_price_matches(left, right) -> bool:
    return abs((left or Decimal("0.00")) - (right or Decimal("0.00"))) <= Decimal("0.01")


def _ipd_ledger_service_group_key(description: str) -> str:
    return _normalize_ipd_service_description(description)


def _ipd_ledger_service_group_id(description: str) -> str:
    base = _normalize_ipd_service_description(description) or "service"
    slug = "".join(ch if ch.isalnum() else "-" for ch in base).strip("-") or "service"
    return f"grp-{slug[:64]}"


def _build_ipd_charge_catalog(hospital_id) -> list[dict]:
    """Distinct service descriptions from all IPD-linked bills (any admission status)."""
    if not hospital_id:
        return []

    items = (
        InvoiceItem.objects.filter(
            invoice__hospital_id=hospital_id,
            invoice__status=BillingInvoice.Status.FINALIZED,
            invoice__is_deleted=False,
        )
        .filter(
            Q(invoice__encounter_type=BillingInvoice.EncounterType.IPD)
            | Q(invoice__ipd_admission__isnull=False)
        )
        .exclude(invoice__invoice_no__startswith="IPDADV-")
        .exclude(invoice__invoice_no__startswith="IPDREF-")
        .exclude(invoice__invoice_no__startswith="IPDROOM-")
        .order_by("-created_at")
    )

    catalog: dict[str, dict] = {}
    for item in items:
        desc = (item.description or "").strip()
        if not desc or desc.casefold() == "service":
            continue
        lower = desc.casefold()
        if lower in {"advance payment", "advance (credit / due)"}:
            continue
        if _ipd_ledger_is_room_charge_text(desc):
            continue
        if "(cancelled)" in lower:
            continue
        key = _ipd_ledger_service_group_key(desc)
        if key in catalog:
            continue
        unit_price = item.unit_price if item.unit_price is not None else Decimal("0.00")
        qty = item.quantity or Decimal("1")
        line_total = item.line_total if item.line_total is not None else (unit_price * qty)
        if unit_price <= Decimal("0.00") and qty > Decimal("0.00") and line_total > Decimal("0.00"):
            unit_price = line_total / qty
        catalog[key] = {
            "id": _ipd_ledger_service_group_id(desc),
            "description": desc,
            "unit_price": str(unit_price),
        }

    return sorted(catalog.values(), key=lambda row: (row.get("description") or "").casefold())


def _find_ipd_mergeable_service_invoice(admission, description: str, unit_price: Decimal):
    normalized = _normalize_ipd_service_description(description)
    invoices = (
        BillingInvoice.objects.filter(
            ipd_admission=admission,
            status=BillingInvoice.Status.FINALIZED,
        )
        .exclude(invoice_no__startswith="IPDADV-")
        .exclude(invoice_no__startswith="IPDREF-")
        .exclude(invoice_no__startswith="IPDROOM-")
        .prefetch_related("items")
        .order_by("-created_at")
    )
    for invoice in invoices:
        items = list(invoice.items.all())
        if len(items) != 1:
            continue
        item = items[0]
        if _ipd_ledger_is_room_charge_text(item.description):
            continue
        if _normalize_ipd_service_description(item.description) != normalized:
            continue
        if not _ipd_unit_price_matches(item.unit_price, unit_price):
            continue
        return invoice, item
    return None, None


class IPDAdmissionViewSet(viewsets.ModelViewSet):
    queryset = IPDAdmission.objects.all()
    filter_backends = (SearchFilter,)
    search_fields = ("patient__uhid", "admission_diagnosis", "admission_notes", "ward_name", "department", "room_name", "bed_code")

    permission_classes = [permissions.IsAuthenticated, HasRequiredPermission]

    required_permission_map = {
        "list": "ipd.view_admission",
        "retrieve": "ipd.view_admission",
        "create": "ipd.create_admission",
        "update": "ipd.update_admission",
        "partial_update": "ipd.update_admission",
        "destroy": "ipd.delete_admission",
        "convert_from_opd": "ipd.create_admission",
        "process_logs": "ipd.view_admission",
        "update_process_log": "ipd.update_admission",
    }

    def get_serializer_class(self):
        if self.action in {"list", "retrieve"}:
            return IPDAdmissionSerializer
        return IPDAdmissionCreateUpdateSerializer

    def get_required_permission(self) -> str | None:
        action = getattr(self, "action", None)
        if action == "process_logs" and getattr(self.request, "method", "").upper() == "POST":
            return "ipd.update_admission"
        return self.required_permission_map.get(action)

    def get_permissions(self):
        self.required_permission = self.get_required_permission()
        return super().get_permissions()

    def get_queryset(self):
        qs = super().get_queryset()
        user = self.request.user
        if user.is_superuser:
            scoped = qs
        else:
            scoped = qs.filter(hospital_id=user.hospital_id)

        status_q = (self.request.query_params.get("status") or "").strip().lower()
        if status_q:
            allowed = {k for (k, _v) in IPDAdmission.Status.choices}
            wanted = [s.strip() for s in status_q.split(",") if s.strip() in allowed]
            if wanted:
                scoped = scoped.filter(status__in=wanted)
        scoped = scoped.select_related("final_bill", "patient", "patient__guardian", "assigned_doctor", "scheme")
        return scoped

    @transaction.atomic
    def perform_create(self, serializer):
        # Hospital is derived from the chosen patient/opd_visit to keep tenancy safe.
        hospital_id = None

        patient = serializer.validated_data.get("patient")
        if patient:
            hospital_id = patient.hospital_id

        if not hospital_id:
            opd_visit = serializer.validated_data.get("opd_visit")
            if opd_visit:
                hospital_id = opd_visit.hospital_id

        if not hospital_id:
            hospital_id = self.request.user.hospital_id

        patient = serializer.validated_data.get("patient")
        if patient:
            existing = IPDAdmission.objects.filter(
                hospital_id=hospital_id,
                patient=patient,
                is_deleted=False,
            ).exclude(
                status__in=[IPDAdmission.Status.DISCHARGED, IPDAdmission.Status.CANCELLED]
            ).first()
            if existing:
                raise ValidationError({
                    "patient": [
                        f"Patient already has an active IPD admission ({existing.ipd_no or existing.id}) in "
                        f"{existing.ward_name or 'ward'} / {existing.bed_code or 'bed'}."
                    ]
                })

        admission: IPDAdmission = serializer.save(hospital_id=hospital_id)

        # Mark the selected bed as occupied.
        _occupy_bed(admission.bed_code, hospital_id)

        IPDAdmissionStatusHistory.objects.create(
            admission=admission,
            from_status=admission.status,
            to_status=admission.status,
            changed_by=self.request.user,
        )
        create_audit_log(
            request=self.request,
            hospital=admission.hospital,
            module="ipd",
            action="create_admission",
            obj=admission,
            after={"patient_uhid": admission.patient.uhid, "status": admission.status},
        )

        patient_name, guardian_name, patient_address = _ipd_final_bill_patient_snapshot(admission.patient)
        IPDFinalBill.objects.get_or_create(
            admission=admission,
            defaults={
                "hospital_id": hospital_id,
                "patient": admission.patient,
                "bill_no": next_ipd_final_bill_number(admission),
                "patient_name": patient_name,
                "guardian_name": guardian_name,
                "patient_phone": admission.patient.phone or "",
                "patient_address": patient_address,
                "consultant_name": _ipd_doctor_display_name(admission.assigned_doctor),
                "room_bed": admission.bed_code or "",
                "scheme_name": getattr(getattr(admission, "scheme", None), "name", "") or "",
                "admission_date": timezone.make_aware(datetime.combine(admission.admission_date, dtime.min)),
            },
        )

    @transaction.atomic
    def perform_update(self, serializer):
        admission: IPDAdmission = serializer.instance
        hospital_id = admission.hospital_id

        old_status = admission.status
        old_ward = admission.ward_name
        old_room = admission.room_name
        old_bed = admission.bed_code

        serializer.save()

        new_status = admission.status

        # ── Bed status management ──────────────────────────────────────────────
        bed_changed = admission.bed_code != old_bed
        discharged = new_status in (IPDAdmission.Status.DISCHARGED, IPDAdmission.Status.CANCELLED)

        if discharged:
            # Release the bed the patient was in.
            _release_bed(old_bed, hospital_id)
        elif bed_changed:
            # Patient transferred: free old bed, occupy new bed.
            _release_bed(old_bed, hospital_id)
            _occupy_bed(admission.bed_code, hospital_id)
        # ──────────────────────────────────────────────────────────────────────

        if new_status != old_status:
            IPDAdmissionStatusHistory.objects.create(
                admission=admission,
                from_status=old_status,
                to_status=new_status,
                changed_by=self.request.user,
            )
            create_audit_log(
                request=self.request,
                hospital=admission.hospital,
                module="ipd",
                action="update_status",
                obj=admission,
                before={"status": old_status},
                after={"status": new_status},
            )

        # Transfer is triggered if any bed-identifying field changes.
        if (
            admission.ward_name != old_ward
            or admission.room_name != old_room
            or admission.bed_code != old_bed
        ):
            IPDTransferHistory.objects.create(
                admission=admission,
                from_ward_name=old_ward,
                to_ward_name=admission.ward_name,
                from_room_name=old_room,
                to_room_name=admission.room_name,
                from_bed_code=old_bed,
                to_bed_code=admission.bed_code,
                changed_by=self.request.user,
            )
            create_audit_log(
                request=self.request,
                hospital=admission.hospital,
                module="ipd",
                action="transfer_bed",
                obj=admission,
                before={"ward_name": old_ward, "room_name": old_room, "bed_code": old_bed},
                after={"ward_name": admission.ward_name, "room_name": admission.room_name, "bed_code": admission.bed_code},
            )

    @action(detail=False, methods=["post"], url_path="convert-from-opd")
    def convert_from_opd(self, request, *args, **kwargs):
        opd_visit_id = request.data.get("opd_visit_id")
        if not opd_visit_id:
            return Response(
                {"success": False, "errors": {"opd_visit_id": ["This field is required."]}},
                status=status.HTTP_400_BAD_REQUEST,
            )

        qs = OPDVisit.objects.all()
        if not request.user.is_superuser:
            qs = qs.filter(hospital_id=request.user.hospital_id)

        try:
            opd_visit: OPDVisit = qs.get(pk=opd_visit_id)
        except OPDVisit.DoesNotExist:
            return Response({"success": False, "errors": {"detail": ["OPD visit not found."]}}, status=404)

        admission_data = {
            "patient": opd_visit.patient_id,
            "opd_visit": opd_visit.id,
            "admission_date": timezone.now().date(),
            "admission_time": timezone.localtime().time().replace(microsecond=0),
            "expected_discharge_date": request.data.get("expected_discharge_date"),
            "assigned_doctor": request.data.get("assigned_doctor"),
            "assigned_nurse": request.data.get("assigned_nurse"),
            "ward_name": request.data.get("ward_name", ""),
            "department": request.data.get("department", ""),
            "room_name": request.data.get("room_name", ""),
            "bed_code": request.data.get("bed_code", ""),
            "admission_diagnosis": request.data.get("admission_diagnosis") or opd_visit.diagnosis,
            "admission_notes": request.data.get("admission_notes") or opd_visit.consultation_notes,
            "status": IPDAdmission.Status.ADMITTED,
            "discharge_notes": request.data.get("discharge_notes", ""),
        }

        serializer = IPDAdmissionCreateUpdateSerializer(data=admission_data)
        serializer.is_valid(raise_exception=True)

        with transaction.atomic():
            admission: IPDAdmission = serializer.save(hospital_id=opd_visit.hospital_id)
            # Mark OPD visit as completed when converted to IPD.
            opd_visit.status = OPDVisit.Status.COMPLETED
            opd_visit.save(update_fields=["status"])

        create_audit_log(
            request=request,
            hospital=admission.hospital,
            module="ipd",
            action="convert_from_opd",
            obj=admission,
            before={"opd_visit_id": str(opd_visit.id), "opd_status": OPDVisit.Status.COMPLETED},
            after={"patient_uhid": admission.patient.uhid, "status": admission.status},
        )

        return success_response(data=IPDAdmissionSerializer(admission).data, status_code=status.HTTP_201_CREATED)

    @action(detail=True, methods=["get"])
    def payments(self, request, pk=None):
        """List all payments for this admission."""
        admission = self.get_object()
        payments = PaymentTransaction.objects.filter(
            invoice__ipd_admission=admission,
            status=PaymentTransaction.Status.SUCCESS
        ).select_related("invoice", "collected_by").order_by("-created_at")
        return Response(PaymentTransactionSerializer(payments, many=True).data)

    @action(detail=False, methods=["get"], url_path="charge-catalog")
    def charge_catalog(self, request):
        """Hospital-wide IPD charge descriptions for ledger autocomplete."""
        hospital_id = getattr(request.user, "hospital_id", None)
        if request.user.is_superuser:
            raw = (request.query_params.get("hospital_id") or "").strip()
            if raw:
                hospital_id = raw
        return Response({"services": _build_ipd_charge_catalog(hospital_id)})

    @action(detail=True, methods=["get"])
    def ledger(self, request, pk=None):
        """Calculate running IPD ledger including dynamic room rent."""
        admission = self.get_object()
        stay_end_date = (
            admission.discharged_at.date()
            if admission.status in (IPDAdmission.Status.DISCHARGED, IPDAdmission.Status.CANCELLED) and admission.discharged_at
            else timezone.now().date()
        )
        
        # 1. Invoices (charges):
        # Include directly linked invoices and also fallback IPD invoices/payments
        # created for the same patient during this admission window.
        invoices = BillingInvoice.objects.filter(
            status__in=[BillingInvoice.Status.FINALIZED, BillingInvoice.Status.CANCELLED],
        ).filter(
            Q(ipd_admission=admission)
            | Q(
                ipd_admission__isnull=True,
                encounter_type=BillingInvoice.EncounterType.IPD,
                patient=admission.patient,
                invoice_date__gte=admission.admission_date,
                invoice_date__lte=stay_end_date,
            )
        ).prefetch_related("items").order_by("-created_at")

        # Count invoice payment outcomes so cancelled advances can be excluded
        # from charge totals/rows.
        invoice_payment_counts = defaultdict(lambda: {"success": 0, "cancelled": 0})
        invoice_ids = list(invoices.values_list("id", flat=True))
        if invoice_ids:
            payment_rows = (
                PaymentTransaction.objects.filter(
                    invoice_id__in=invoice_ids,
                    is_deleted=False,
                    status__in=[
                        PaymentTransaction.Status.SUCCESS,
                        PaymentTransaction.Status.CANCELLED,
                    ],
                )
                .values("invoice_id", "status")
            )
            for row in payment_rows:
                bucket = "success" if row["status"] == PaymentTransaction.Status.SUCCESS else "cancelled"
                invoice_payment_counts[row["invoice_id"]][bucket] += 1
        
        record_charges = []
        grouped_charge_map = {}
        invoice_to_event_refs = {}
        invoices_total = Decimal("0.00")
        for inv in invoices:
            is_advance_invoice = str(inv.invoice_no or "").startswith("IPDADV-")
            payment_counts = invoice_payment_counts.get(inv.id, {"success": 0, "cancelled": 0})
            # Paid advance invoices are deposits, not billable charges.
            if is_advance_invoice and (
                (inv.amount_paid or Decimal("0.00")) > Decimal("0.00")
                or payment_counts["success"] > 0
            ):
                continue
            # If advance payment was cancelled (and no successful payment remains),
            # do not show it as credit/due charge.
            if is_advance_invoice and payment_counts["success"] == 0 and payment_counts["cancelled"] > 0:
                continue
            if _ipd_invoice_is_finalize_room_invoice(inv.invoice_no):
                continue
            # Shell invoices for discharge refund tracking (negative payments only; no charges).
            if str(inv.invoice_no or "").startswith("IPDREF-"):
                continue
            # Cancelled invoices stay visible on the ledger but do not add to active totals.
            items = list(inv.items.all())
            if inv.status == BillingInvoice.Status.FINALIZED:
                room_line_total = Decimal("0.00")
                for item in items:
                    if not _ipd_ledger_is_room_charge_text(item.description):
                        continue
                    quantity = item.quantity or Decimal("1")
                    unit_price = item.unit_price if item.unit_price is not None else Decimal("0.00")
                    line_total = (
                        item.line_total
                        if item.line_total is not None
                        else (unit_price * quantity)
                    )
                    if line_total <= Decimal("0.00"):
                        continue
                    room_line_total += line_total
                invoices_total += inv.total_amount - room_line_total
            invoice_event_refs = []
            invoice_to_event_refs[str(inv.id)] = invoice_event_refs
            invoice_payment_mode = "credit" if (inv.amount_paid or Decimal("0.00")) <= Decimal("0.00") else "cash"

            # Group identical services into one ledger row per active/cancelled bucket; each invoice stays a separate event.
            def _invoice_group_key(description: str, invoice_status: str) -> str:
                base = _ipd_ledger_service_group_key(description)
                if str(invoice_status or "").lower() == BillingInvoice.Status.CANCELLED:
                    return f"{base}::cancelled"
                return f"{base}::active"

            def _invoice_group_row_id(description: str, invoice_status: str) -> str:
                base_id = _ipd_ledger_service_group_id(description)
                if str(invoice_status or "").lower() == BillingInvoice.Status.CANCELLED:
                    return f"{base_id}-cancelled"
                return base_id

            if is_advance_invoice and (inv.amount_paid or Decimal("0.00")) == Decimal("0.00"):
                desc = "Advance (Credit / Due)"
                quantity = Decimal("1")
                unit_price = inv.total_amount
                charge_date = inv.created_at.isoformat()
                record_charges.append({
                    "id": str(inv.id),
                    "type": "charge",
                    "date": charge_date,
                    "description": desc,
                    "amount": str(inv.total_amount),
                    "invoice_no": inv.invoice_no,
                    "invoice_id": str(inv.id),
                    "invoice_status": inv.status,
                    "quantity": str(quantity),
                    "unit_price": str(unit_price),
                    "charge_times": [charge_date],
                    "payment_mode": invoice_payment_mode,
                })
                group_key = _invoice_group_key(desc, inv.status)
                if group_key not in grouped_charge_map:
                    grouped_charge_map[group_key] = {
                        "id": _invoice_group_row_id(desc, inv.status),
                        "description": (
                            f"{desc} (Cancelled)"
                            if inv.status == BillingInvoice.Status.CANCELLED
                            else desc
                        ),
                        "quantity": Decimal("0.00"),
                        "total_amount": Decimal("0.00"),
                        "total_paid": Decimal("0.00"),
                        "events": [],
                    }
                grouped_charge_map[group_key]["quantity"] += quantity
                grouped_charge_map[group_key]["total_amount"] += inv.total_amount
                event_ref = {
                    "id": str(inv.id),
                    "name": desc,
                    "date": charge_date,
                    "price": str(inv.total_amount),
                    "quantity": str(quantity),
                    "invoice_no": inv.invoice_no,
                    "invoice_id": str(inv.id),
                    "invoice_status": inv.status,
                    "cancelled_reason": inv.cancelled_reason or "",
                    "payment_mode": invoice_payment_mode,
                    "paid_amount": "0.00",
                    "slip_number": "",
                }
                grouped_charge_map[group_key]["events"].append(event_ref)
                invoice_event_refs.append({
                    "group_key": group_key,
                    "event": event_ref,
                    "amount": inv.total_amount,
                })
                continue

            if not items:
                desc = "Service"
                quantity = Decimal("1")
                unit_price = inv.total_amount
                charge_date = inv.created_at.isoformat()
                record_charges.append({
                    "id": str(inv.id),
                    "type": "charge",
                    "date": charge_date,
                    "description": desc,
                    "amount": str(inv.total_amount),
                    "invoice_no": inv.invoice_no,
                    "invoice_id": str(inv.id),
                    "invoice_status": inv.status,
                    "quantity": str(quantity),
                    "unit_price": str(unit_price),
                    "charge_times": [charge_date],
                    "payment_mode": invoice_payment_mode,
                })
                group_key = _invoice_group_key(desc, inv.status)
                if group_key not in grouped_charge_map:
                    grouped_charge_map[group_key] = {
                        "id": _invoice_group_row_id(desc, inv.status),
                        "description": (
                            f"{desc} (Cancelled)"
                            if inv.status == BillingInvoice.Status.CANCELLED
                            else desc
                        ),
                        "quantity": Decimal("0.00"),
                        "total_amount": Decimal("0.00"),
                        "total_paid": Decimal("0.00"),
                        "events": [],
                    }
                grouped_charge_map[group_key]["quantity"] += quantity
                grouped_charge_map[group_key]["total_amount"] += inv.total_amount
                event_ref = {
                    "id": str(inv.id),
                    "name": desc,
                    "date": charge_date,
                    "price": str(inv.total_amount),
                    "quantity": str(quantity),
                    "invoice_no": inv.invoice_no,
                    "invoice_id": str(inv.id),
                    "invoice_status": inv.status,
                    "cancelled_reason": inv.cancelled_reason or "",
                    "payment_mode": invoice_payment_mode,
                    "paid_amount": "0.00",
                    "slip_number": "",
                }
                grouped_charge_map[group_key]["events"].append(event_ref)
                invoice_event_refs.append({
                    "group_key": group_key,
                    "event": event_ref,
                    "amount": inv.total_amount,
                })
                continue

            for idx, item in enumerate(items):
                desc = (item.description or "Service").strip() or "Service"
                if _ipd_ledger_is_room_charge_text(desc):
                    continue
                quantity = item.quantity or Decimal("1")
                unit_price = item.unit_price if item.unit_price is not None else Decimal("0.00")
                line_total = item.line_total if item.line_total is not None else (unit_price * quantity)
                charge_date = (item.created_at or inv.created_at).isoformat()

                record_charges.append({
                    "id": f"{inv.id}:{idx + 1}",
                    "type": "charge",
                    "date": charge_date,
                    "description": desc,
                    "amount": str(line_total),
                    "invoice_no": inv.invoice_no,
                    "invoice_id": str(inv.id),
                    "invoice_status": inv.status,
                    "quantity": str(quantity),
                    "unit_price": str(unit_price),
                    "charge_times": [charge_date],
                    "payment_mode": invoice_payment_mode,
                })

                group_key = _invoice_group_key(desc, inv.status)
                if group_key not in grouped_charge_map:
                    grouped_charge_map[group_key] = {
                        "id": _invoice_group_row_id(desc, inv.status),
                        "description": (
                            f"{desc} (Cancelled)"
                            if inv.status == BillingInvoice.Status.CANCELLED
                            else desc
                        ),
                        "quantity": Decimal("0.00"),
                        "total_amount": Decimal("0.00"),
                        "total_paid": Decimal("0.00"),
                        "events": [],
                    }
                grouped_charge_map[group_key]["quantity"] += quantity
                grouped_charge_map[group_key]["total_amount"] += line_total
                event_ref = {
                    "id": f"{inv.id}:{idx + 1}",
                    "name": desc,
                    "date": charge_date,
                    "price": str(line_total),
                    "quantity": str(quantity),
                    "unit_price": str(unit_price),
                    "invoice_no": inv.invoice_no,
                    "invoice_id": str(inv.id),
                    "invoice_status": inv.status,
                    "cancelled_reason": inv.cancelled_reason or "",
                    "payment_mode": invoice_payment_mode,
                    "paid_amount": "0.00",
                    "slip_number": "",
                    "payment_events": [],
                }
                grouped_charge_map[group_key]["events"].append(event_ref)
                invoice_event_refs.append({
                    "group_key": group_key,
                    "event": event_ref,
                    "amount": line_total,
                })

        # 2. Dynamic Room Rent (optional manual override on admission)
        bed = Bed.objects.select_related("room").filter(bed_code=admission.bed_code, hospital_id=admission.hospital_id).first()
        days = ipd_stay_days(admission)

        room_rent_calc = Decimal("0.00")
        daily = None
        if bed and bed.room and bed.room.daily_charge:
            daily = bed.room.daily_charge
            room_rent_calc = daily * days

        days_dec = Decimal(days)
        if admission.room_rent_daily_charge_override is not None:
            room_rent = admission.room_rent_daily_charge_override * days_dec
        elif admission.room_rent_override is not None:
            room_rent = admission.room_rent_override
        else:
            room_rent = room_rent_calc

        if admission.room_rent_daily_charge_override is not None:
            unit_for_row = admission.room_rent_daily_charge_override
        elif days_dec > 0:
            unit_for_row = (room_rent / days_dec)
        else:
            unit_for_row = room_rent

        show_room_line = (
            room_rent > 0
            or admission.room_rent_override is not None
            or admission.room_rent_daily_charge_override is not None
        )
        if show_room_line:
            rent_desc = _ipd_room_rent_ledger_description(
                admission,
                days=days,
                unit_for_row=unit_for_row,
                daily=daily,
                room_rent=room_rent,
            )
            record_charges.append(
                {
                    "id": "room_rent",
                    "type": "room_rent",
                    "date": timezone.now().isoformat(),
                    "description": rent_desc,
                    "amount": str(room_rent),
                    "invoice_no": "SYSTEM",
                    "invoice_id": "room_rent",
                    "invoice_status": "finalized",
                    "quantity": str(days),
                    "unit_price": str(unit_for_row),
                }
            )

        total_charges = invoices_total + room_rent
        
        # 3. Payments (include cancelled for audit; totals count only successful + finalized)
        payment_admission_q = (
            Q(invoice__ipd_admission=admission)
            | Q(
                invoice__ipd_admission__isnull=True,
                invoice__encounter_type=BillingInvoice.EncounterType.IPD,
                invoice__patient=admission.patient,
                invoice__invoice_date__gte=admission.admission_date,
                invoice__invoice_date__lte=stay_end_date,
            )
        )
        payments_qs = (
            PaymentTransaction.objects.filter(
                payment_admission_q,
                is_deleted=False,
                status__in=[
                    PaymentTransaction.Status.SUCCESS,
                    PaymentTransaction.Status.CANCELLED,
                ],
                invoice__status__in=[
                    BillingInvoice.Status.FINALIZED,
                    BillingInvoice.Status.CANCELLED,
                ],
            )
            .select_related("invoice")
            .order_by("-created_at")
        )

        record_payments = []
        total_paid = Decimal("0.00")
        for p in payments_qs:
            if (
                p.status == PaymentTransaction.Status.SUCCESS
                and p.invoice.status == BillingInvoice.Status.FINALIZED
            ):
                total_paid += p.amount
            desc_prefix = "Advance" if "ADV" in p.invoice.invoice_no else "Payment"
            if p.status == PaymentTransaction.Status.CANCELLED:
                pay_desc = f"{desc_prefix} (Cancelled) - {p.payment_mode.upper()}"
            else:
                pay_desc = f"{desc_prefix} - {p.payment_mode.upper()}"
            record_payments.append(
                {
                    "id": str(p.id),
                    "type": "payment",
                    "date": (p.paid_at or p.created_at).isoformat(),
                    "description": pay_desc,
                    "amount": str(p.amount),
                    "invoice_no": p.invoice.invoice_no,
                    "slip_number": p.slip_number or "",
                    "status": p.status,
                    "invoice_status": p.invoice.status,
                }
            )
        for p in payments_qs:
            if (
                p.status != PaymentTransaction.Status.SUCCESS
                or p.invoice.status != BillingInvoice.Status.FINALIZED
            ):
                continue
            event_refs = invoice_to_event_refs.get(str(p.invoice_id), [])
            if event_refs:
                total_ref_amount = sum((ref["amount"] or Decimal("0.00")) for ref in event_refs) or Decimal("0.00")
                remaining = p.amount
                for idx, ref in enumerate(event_refs):
                    group_key = ref.get("group_key")
                    ev = ref.get("event")
                    if not group_key or group_key not in grouped_charge_map or not ev:
                        continue
                    if idx == len(event_refs) - 1 or total_ref_amount <= Decimal("0.00"):
                        allocation = remaining
                    else:
                        ratio = (ref["amount"] or Decimal("0.00")) / total_ref_amount if total_ref_amount > 0 else Decimal("0.00")
                        allocation = (p.amount * ratio)
                        remaining -= allocation
                    grouped_charge_map[group_key]["total_paid"] += allocation
                    existing = Decimal(str(ev.get("paid_amount", "0.00")))
                    ev["paid_amount"] = str(existing + allocation)
                    ev["payment_mode"] = p.payment_mode or ev.get("payment_mode") or "other"
                    ev["slip_number"] = getattr(p, "slip_number", "") or ev.get("slip_number") or ""
                    unit_price = Decimal(str(ev.get("unit_price") or "0.00"))
                    if unit_price <= Decimal("0.00"):
                        qty_dec = Decimal(str(ev.get("quantity") or "1"))
                        line_total = Decimal(str(ev.get("price") or "0.00"))
                        unit_price = (
                            (line_total / qty_dec)
                            if qty_dec > Decimal("0.00")
                            else line_total
                        )
                    qty_payment = (
                        (allocation / unit_price)
                        if unit_price > Decimal("0.00")
                        else Decimal("1.00")
                    )
                    ev.setdefault("payment_events", []).append(
                        {
                            "id": str(p.id),
                            "date": (p.paid_at or p.created_at).isoformat(),
                            "amount": str(allocation),
                            "quantity": str(qty_payment if qty_payment > Decimal("0.00") else Decimal("1.00")),
                            "unit_price": str(unit_price),
                            "payment_mode": p.payment_mode or "other",
                            "slip_number": p.slip_number or "",
                            "invoice_no": p.invoice.invoice_no,
                        }
                    )
        record_payments.sort(key=_ipd_ledger_payment_sort_key)

        grouped_charge_rows = sorted(grouped_charge_map.values(), key=_ipd_ledger_grouped_sort_key)

        balance_due = total_charges - total_paid

        return Response({
            "total_charges": str(total_charges),
            "total_paid": str(total_paid),
            "balance_due": str(balance_due),
            "charges": record_charges,
            "grouped_charges": [
                {
                    "id": row["id"],
                    "description": row["description"],
                    "quantity": str(row["quantity"]),
                    "total_amount": str(row["total_amount"]),
                    "total_paid": str(row["total_paid"]),
                    "events": sorted(row["events"], key=lambda e: e["date"]),
                }
                for row in grouped_charge_rows
            ],
            "payments": record_payments,
            "room_rent": str(room_rent),
            "room_rent_computed": str(room_rent_calc),
            "room_rent_override": (
                str(admission.room_rent_override) if admission.room_rent_override is not None else None
            ),
            "room_rent_daily_charge_override": (
                str(admission.room_rent_daily_charge_override)
                if admission.room_rent_daily_charge_override is not None
                else None
            ),
            "room_rent_days_override": admission.room_rent_days_override,
            "days": days,
        })

    @action(detail=True, methods=["post"], url_path="capture-advance")
    @transaction.atomic
    def capture_advance(self, request, pk=None):
        """Create an advance invoice and payment for this admission."""
        admission = self.get_object()
        amount_str = request.data.get("amount")
        mode = (request.data.get("payment_mode", "cash") or "cash").lower()
        ref = request.data.get("reference", "")

        if not amount_str:
            return Response({"error": "Amount is required"}, status=400)
        
        try:
            amount = Decimal(str(amount_str))
        except:
            return Response({"error": "Invalid amount format"}, status=400)

        if amount <= 0:
            return Response({"error": "Amount must be greater than zero"}, status=400)

        # 1. Generate Invoice No
        hospital = admission.hospital
        hospital_id = hospital.id
        year = timezone.now().year
        seq, _ = InvoiceNumberSequence.objects.select_for_update().get_or_create(hospital_id=hospital_id, year=year)
        seq.last_seq += 1
        seq.save(update_fields=["last_seq"])
        
        invoice_no = render_document_number(hospital, "ipd_advance", year, seq.last_seq)

        allowed_modes = {"cash", "upi", "other", "credit"}
        if mode not in allowed_modes:
            mode = "cash"
        is_credit = mode == "credit"

        # 2. Create Invoice
        invoice = BillingInvoice.objects.create(
            hospital_id=hospital_id,
            invoice_no=invoice_no,
            encounter_type=BillingInvoice.EncounterType.IPD,
            patient=admission.patient,
            ipd_admission=admission,
            status=BillingInvoice.Status.FINALIZED,
            subtotal_amount=amount,
            total_amount=amount,
            amount_paid=Decimal("0.00") if is_credit else amount,
            currency="INR",
            invoice_date=timezone.now().date()
        )
        apply_attribution_to_invoice(invoice, ipd_admission=admission)
        
        InvoiceItem.objects.create(
            invoice=invoice,
            description="Advance Payment",
            quantity=Decimal("1"),
            unit_price=amount,
            line_total=amount
        )

        # 3. Create Payment (only for non-credit entries)
        payment = None
        if not is_credit:
            payment = PaymentTransaction(
                hospital_id=hospital_id,
                invoice=invoice,
                payment_mode=mode,
                amount=amount,
                transaction_reference=ref,
                status=PaymentTransaction.Status.SUCCESS,
                collected_by=request.user,
                paid_at=timezone.now()
            )
            apply_attribution_to_payment(payment, invoice)
            payment.save()

        return Response({
            "success": True,
            "invoice_no": invoice.invoice_no,
            "is_credit": is_credit,
            "payment": PaymentTransactionSerializer(payment).data if payment else None
        })

    @action(detail=True, methods=["post"], url_path="record-discharge-refund")
    @transaction.atomic
    def record_discharge_refund(self, request, pk=None):
        """Record cash/UPI/etc. refund to patient at discharge via negative payment (reduces total paid)."""
        admission = self.get_object()
        ledger_resp = self.ledger(request)
        ledger_payload = getattr(ledger_resp, "data", None) or {}
        try:
            balance_due = Decimal(str(ledger_payload.get("balance_due", "0")))
        except Exception:
            return Response({"error": "Could not read ledger balance"}, status=500)

        if balance_due >= Decimal("-0.009"):
            return Response({"error": "No credit balance to refund"}, status=400)

        amount_str = request.data.get("amount")
        if not amount_str:
            return Response({"error": "Amount is required"}, status=400)
        try:
            amount = Decimal(str(amount_str))
        except Exception:
            return Response({"error": "Invalid amount format"}, status=400)
        if amount <= 0:
            return Response({"error": "Amount must be greater than zero"}, status=400)

        credit_available = (-balance_due).quantize(Decimal("0.01"))
        if amount - credit_available > Decimal("0.02"):
            return Response({"error": "Refund amount exceeds credit balance"}, status=400)

        raw_mode = (request.data.get("payment_mode", "cash") or "cash").lower()
        if raw_mode == "credit":
            return Response({"error": "Credit mode is not valid for discharge refund"}, status=400)
        allowed_modes = {"cash", "upi", "other", "card", "bank_transfer"}
        if raw_mode not in allowed_modes:
            raw_mode = "cash"
        mode = raw_mode
        ref = request.data.get("reference", "")

        hospital = admission.hospital
        hospital_id = hospital.id
        year = timezone.now().year
        seq, _ = InvoiceNumberSequence.objects.select_for_update().get_or_create(hospital_id=hospital_id, year=year)
        seq.last_seq += 1
        seq.save(update_fields=["last_seq"])

        invoice_no = render_document_number(hospital, "ipd_refund", year, seq.last_seq)

        zero = Decimal("0.00")
        invoice = BillingInvoice.objects.create(
            hospital_id=hospital_id,
            invoice_no=invoice_no,
            encounter_type=BillingInvoice.EncounterType.IPD,
            patient=admission.patient,
            ipd_admission=admission,
            status=BillingInvoice.Status.FINALIZED,
            subtotal_amount=zero,
            total_amount=zero,
            amount_paid=zero,
            currency="INR",
            invoice_date=timezone.now().date(),
        )
        apply_attribution_to_invoice(invoice, ipd_admission=admission)

        InvoiceItem.objects.create(
            invoice=invoice,
            description="Discharge refund (ledger offset)",
            quantity=Decimal("1"),
            unit_price=zero,
            line_total=zero,
        )

        neg_amount = -amount
        payment = PaymentTransaction(
            hospital_id=hospital_id,
            invoice=invoice,
            payment_mode=mode,
            amount=neg_amount,
            transaction_reference=ref,
            status=PaymentTransaction.Status.SUCCESS,
            collected_by=request.user,
            paid_at=timezone.now(),
        )
        apply_attribution_to_payment(payment, invoice)
        payment.save()

        return Response({
            "success": True,
            "invoice_no": invoice.invoice_no,
            "is_credit": False,
            "payment": PaymentTransactionSerializer(payment).data,
        })

    @action(detail=True, methods=["post"], url_path="add-charge")
    @transaction.atomic
    def add_charge(self, request, pk=None):
        """Add a service charge (e.g. Surgery, Procedure) to this admission."""
        admission = self.get_object()
        paid_at = _parse_paid_at_from_request(request)
        description = request.data.get("description")
        amount_str = request.data.get("amount")
        quantity_str = request.data.get("quantity")
        unit_price_str = request.data.get("unit_price")

        if not description or not amount_str:
            return Response({"error": "Description and amount are required"}, status=status.HTTP_400_BAD_REQUEST)

        try:
            amount = Decimal(str(amount_str))
        except:
            return Response({"error": "Invalid amount format"}, status=status.HTTP_400_BAD_REQUEST)
        if amount == 0:
            return Response({"error": "Amount must not be zero"}, status=status.HTTP_400_BAD_REQUEST)

        try:
            quantity = Decimal(str(quantity_str if quantity_str is not None else "1"))
        except Exception:
            return Response({"error": "Invalid quantity format"}, status=status.HTTP_400_BAD_REQUEST)
        if quantity <= 0:
            return Response({"error": "Quantity must be greater than 0"}, status=status.HTTP_400_BAD_REQUEST)

        if unit_price_str is not None and str(unit_price_str).strip() != "":
            try:
                unit_price = Decimal(str(unit_price_str))
            except Exception:
                return Response({"error": "Invalid unit price format"}, status=status.HTTP_400_BAD_REQUEST)
        else:
            unit_price = (amount / quantity) if quantity else amount

        payment_mode = (request.data.get("payment_mode", "credit") or "credit").lower()
        if payment_mode not in {"cash", "upi", "other", "credit"}:
            payment_mode = "credit"
        if amount < 0:
            payment_mode = "credit"
        line_delta = (unit_price * quantity)
        collect_now = amount > 0 and payment_mode in {"cash", "upi", "other"}

        existing_invoice, existing_item = _find_ipd_mergeable_service_invoice(
            admission, description, unit_price
        )
        if existing_invoice and existing_item:
            new_qty = (existing_item.quantity or Decimal("1")) + quantity
            new_total = (unit_price * new_qty)
            existing_item.quantity = new_qty
            existing_item.unit_price = unit_price
            existing_item.line_total = new_total
            existing_item.save(update_fields=["quantity", "unit_price", "line_total", "updated_at"])

            existing_invoice.subtotal_amount = new_total
            existing_invoice.total_amount = new_total
            if collect_now:
                existing_invoice.amount_paid = (
                    (existing_invoice.amount_paid or Decimal("0.00")) + line_delta
                )
            existing_invoice.save(
                update_fields=["subtotal_amount", "total_amount", "amount_paid", "updated_at"]
            )

            payment_data = None
            if collect_now:
                payment = PaymentTransaction.objects.create(
                    hospital_id=admission.hospital_id,
                    invoice=existing_invoice,
                    payment_mode=payment_mode,
                    amount=line_delta,
                    transaction_reference="",
                    status=PaymentTransaction.Status.SUCCESS,
                    collected_by=request.user,
                    paid_at=paid_at,
                )
                payment_data = PaymentTransactionSerializer(payment).data

            return Response(
                {
                    "success": True,
                    "merged": True,
                    "invoice_id": str(existing_invoice.id),
                    "invoice_no": existing_invoice.invoice_no,
                    "description": description,
                    "amount": str(new_total),
                    "quantity": str(new_qty),
                    "unit_price": str(unit_price),
                    "payment": payment_data,
                }
            )

        # 1. Generate Invoice No (Prefix IPDSRV)
        hospital = admission.hospital
        hospital_id = hospital.id
        year = timezone.now().year
        seq, _ = InvoiceNumberSequence.objects.select_for_update().get_or_create(hospital_id=hospital_id, year=year)
        seq.last_seq += 1
        seq.save(update_fields=["last_seq"])
        
        invoice_no = render_document_number(hospital, "ipd_service", year, seq.last_seq)

        # 2. Create Invoice
        amount_paid = line_delta if collect_now else Decimal("0.00")

        invoice = BillingInvoice.objects.create(
            hospital_id=hospital_id,
            invoice_no=invoice_no,
            encounter_type=BillingInvoice.EncounterType.IPD,
            patient=admission.patient,
            ipd_admission=admission,
            status=BillingInvoice.Status.FINALIZED,
            subtotal_amount=amount,
            total_amount=amount,
            amount_paid=amount_paid,
            currency="INR",
            invoice_date=paid_at.date(),
        )
        apply_attribution_to_invoice(invoice, ipd_admission=admission)

        InvoiceItem.objects.create(
            invoice=invoice,
            description=description,
            quantity=quantity,
            unit_price=unit_price,
            line_total=amount
        )
        _stamp_new_invoice_ledger_times(invoice, paid_at)

        payment_data = None
        if collect_now:
            payment = PaymentTransaction(
                hospital_id=hospital_id,
                invoice=invoice,
                payment_mode=payment_mode,
                amount=line_delta,
                transaction_reference="",
                status=PaymentTransaction.Status.SUCCESS,
                collected_by=request.user,
                paid_at=paid_at,
            )
            apply_attribution_to_payment(payment, invoice)
            payment.save()
            payment_data = PaymentTransactionSerializer(payment).data

        return Response({
            "success": True,
            "invoice_id": str(invoice.id),
            "invoice_no": invoice.invoice_no,
            "description": description,
            "amount": amount,
            "quantity": str(quantity),
            "unit_price": str(unit_price),
            "payment": payment_data
        })

    @action(detail=True, methods=["patch"], url_path="update-charge")
    @transaction.atomic
    def update_charge(self, request, pk=None):
        """Update the amount and/or quantity of an existing service charge."""
        admission = self.get_object()
        invoice_id = request.data.get("invoice_id")
        amount_str = request.data.get("amount")
        quantity_str = request.data.get("quantity")
        unit_price_str = request.data.get("unit_price")

        if not invoice_id:
            return Response({"error": "Invoice ID is required"}, status=400)

        # 1. Room rent: stored override on admission (not a billing invoice)
        if str(invoice_id) == "room_rent":
            description_str = request.data.get("description")
            if description_str is not None:
                admission.room_rent_description_override = str(description_str).strip()[:300]
                admission.save(update_fields=["room_rent_description_override", "updated_at"])

            clear = request.data.get("clear_room_rent_override")
            if clear in (True, "true", "1", 1, "yes"):
                admission.room_rent_override = None
                admission.room_rent_daily_charge_override = None
                admission.room_rent_days_override = None
                admission.save(
                    update_fields=[
                        "room_rent_override",
                        "room_rent_daily_charge_override",
                        "room_rent_days_override",
                        "updated_at",
                    ]
                )
                return Response(
                    {
                        "success": True,
                        "room_rent_override": None,
                        "room_rent_daily_charge_override": None,
                        "room_rent_days_override": None,
                    }
                )
            days_override = None
            quantity_str = request.data.get("quantity")
            if quantity_str is None:
                quantity_str = request.data.get("days")
            calendar_days_before = ipd_calendar_stay_days(admission)
            if quantity_str is not None:
                try:
                    days_override = max(1, int(Decimal(str(quantity_str))))
                except Exception:
                    return Response({"error": "Invalid stay days format"}, status=400)
                admission.room_rent_days_override = days_override
            if unit_price_str is None and amount_str is None and days_override is None:
                if description_str is not None:
                    return Response(
                        {
                            "success": True,
                            "description": admission.room_rent_description_override,
                        }
                    )
                return Response({"error": "Provide unit_price (per-day bed charge), stay days, or amount"}, status=400)
            # Prefer per-day bed rate (unit_price); total = rate × stay days (recomputed server-side).
            if unit_price_str is not None:
                try:
                    daily = Decimal(str(unit_price_str))
                except Exception:
                    return Response({"error": "Invalid per-day rate format"}, status=400)
                if daily < 0:
                    return Response({"error": "Per-day rate cannot be negative"}, status=400)
                admission.room_rent_daily_charge_override = daily
                admission.room_rent_override = None
                save_fields = ["room_rent_daily_charge_override", "room_rent_override", "updated_at"]
                if days_override is not None:
                    save_fields.append("room_rent_days_override")
                admission.save(update_fields=save_fields)
                days = ipd_stay_days(admission)
                total_rr = daily * Decimal(days)
                return Response(
                    {
                        "success": True,
                        "room_rent_daily_charge_override": str(daily),
                        "room_rent_override": None,
                        "room_rent_days_override": admission.room_rent_days_override,
                        "room_rent": str(total_rr),
                        "days": days,
                    }
                )
            if days_override is not None:
                bed = Bed.objects.select_related("room").filter(
                    bed_code=admission.bed_code, hospital_id=admission.hospital_id
                ).first()
                if admission.room_rent_daily_charge_override is not None:
                    daily = admission.room_rent_daily_charge_override
                elif bed and bed.room and bed.room.daily_charge:
                    daily = bed.room.daily_charge
                elif admission.room_rent_override is not None:
                    daily = (
                        admission.room_rent_override / Decimal(calendar_days_before)
                        if calendar_days_before
                        else admission.room_rent_override
                    )
                else:
                    daily = Decimal("0.00")
                days = ipd_stay_days(admission)
                admission.room_rent_override = None
                if daily > 0:
                    admission.room_rent_daily_charge_override = daily
                admission.save(
                    update_fields=[
                        "room_rent_days_override",
                        "room_rent_override",
                        "room_rent_daily_charge_override",
                        "updated_at",
                    ]
                )
                total_rr = daily * Decimal(days)
                return Response(
                    {
                        "success": True,
                        "room_rent_days_override": admission.room_rent_days_override,
                        "room_rent_daily_charge_override": (
                            str(admission.room_rent_daily_charge_override)
                            if admission.room_rent_daily_charge_override is not None
                            else None
                        ),
                        "room_rent": str(total_rr),
                        "days": days,
                    }
                )
            # Legacy: total-line override only if amount sent without unit_price
            if amount_str is not None:
                try:
                    amount = Decimal(str(amount_str))
                except Exception:
                    return Response({"error": "Invalid amount format"}, status=400)
                if amount < 0:
                    return Response({"error": "Amount cannot be negative"}, status=400)
                admission.room_rent_override = amount
                admission.room_rent_daily_charge_override = None
                admission.save(
                    update_fields=["room_rent_override", "room_rent_daily_charge_override", "updated_at"]
                )
                return Response({"success": True, "room_rent_override": str(amount), "room_rent_daily_charge_override": None})
            return Response({"error": "Provide unit_price (per-day bed charge) or amount"}, status=400)

        try:
            invoice = BillingInvoice.objects.filter(
                id=invoice_id, ipd_admission=admission
            ).first()
        except (ValueError, TypeError):
            return Response({"error": "Invalid Invoice ID format"}, status=400)

        if not invoice:
            return Response({"error": "Invoice not found or does not belong to this admission"}, status=404)

        if invoice.status == BillingInvoice.Status.CANCELLED:
            return Response({"error": "Cannot edit a cancelled invoice"}, status=400)

        # 2. Update line items
        # Typically these service charges have only one item
        item = invoice.items.first()
        if item:
            current_quantity = item.quantity or Decimal("1")
            current_unit_price = item.unit_price if item.unit_price is not None else (
                (invoice.total_amount / current_quantity) if current_quantity else invoice.total_amount
            )

            quantity = current_quantity
            unit_price = current_unit_price
            description_str = request.data.get("description")

            if quantity_str is not None:
                try:
                    quantity = Decimal(str(quantity_str))
                except Exception:
                    return Response({"error": "Invalid quantity format"}, status=400)
                if quantity <= 0:
                    return Response({"error": "Quantity must be greater than 0"}, status=400)

            if unit_price_str is not None:
                try:
                    unit_price = Decimal(str(unit_price_str))
                except Exception:
                    return Response({"error": "Invalid unit price format"}, status=400)
                new_total = (unit_price * quantity)
            elif amount_str is not None:
                try:
                    amount = Decimal(str(amount_str))
                except Exception:
                    return Response({"error": "Invalid amount format"}, status=400)
                unit_price = (amount / quantity) if quantity else amount
                new_total = amount
            elif quantity_str is not None:
                new_total = (unit_price * quantity)
            elif description_str is not None:
                desc = str(description_str).strip()
                if not desc:
                    return Response({"error": "Description cannot be empty"}, status=400)
                item.description = desc[:300]
                item.save(update_fields=["description"])
                return Response({
                    "success": True,
                    "invoice_no": invoice.invoice_no,
                    "description": item.description,
                    "quantity": str(item.quantity),
                    "unit_price": str(item.unit_price),
                    "new_total": str(invoice.total_amount),
                })
            else:
                return Response({"error": "Provide amount, quantity, or unit_price to update"}, status=400)

            item_update_fields = ["quantity", "unit_price", "line_total"]
            if description_str is not None:
                desc = str(description_str).strip()
                if not desc:
                    return Response({"error": "Description cannot be empty"}, status=400)
                item.description = desc[:300]
                item_update_fields.append("description")

            item.quantity = quantity
            item.unit_price = unit_price
            item.line_total = new_total
            item.save(update_fields=item_update_fields)
        else:
            return Response({"error": "No invoice item found to update"}, status=400)

        # 3. Update invoice totals directly
        # We bypass recalc_totals() here because that method incorrectly zeroes out 
        # negative totals, but our IPD system uses negative amounts for discounts.
        invoice.subtotal_amount = item.line_total
        invoice.total_amount = item.line_total
        invoice.save(update_fields=["subtotal_amount", "total_amount"])

        return Response({
            "success": True,
            "invoice_no": invoice.invoice_no,
            "description": item.description,
            "quantity": str(item.quantity),
            "unit_price": str(item.unit_price),
            "new_total": str(invoice.total_amount)
        })

    @action(detail=True, methods=["get", "post"], url_path="process-logs")
    @transaction.atomic
    def process_logs(self, request, pk=None):
        admission = self.get_object()
        if request.method == "GET":
            logs = (
                IPDDailyProcessLog.objects.filter(admission=admission)
                .select_related("recorded_by")
                .order_by("-log_date", "-created_at")
            )
            return success_response(data=IPDDailyProcessLogSerializer(logs, many=True).data)

        raw_date = request.data.get("log_date")
        log_date = parse_date(str(raw_date).strip()) if raw_date else None
        if not log_date:
            return Response({"errors": {"log_date": ["Valid log_date (YYYY-MM-DD) is required."]}}, status=400)
        existing = IPDDailyProcessLog.objects.filter(admission=admission, log_date=log_date).first()
        template_id, process_config = resolve_process_config_for_save(
            hospital_id=admission.hospital_id,
            process_template_id=request.data.get("process_template_id"),
            existing=existing,
        )
        serializer = IPDDailyProcessLogSerializer(
            instance=existing,
            data=request.data,
            partial=bool(existing),
            context={"admission": admission, "process_config": process_config},
        )
        serializer.is_valid(raise_exception=True)
        validated = serializer.validated_data
        log = save_ipd_process_log(
            admission=admission,
            log_date=log_date,
            data=validated,
            user=request.user,
            existing=existing,
            process_template_id=template_id,
            process_config=process_config,
        )
        return success_response(
            data=IPDDailyProcessLogSerializer(log).data,
            status_code=status.HTTP_200_OK if existing else status.HTTP_201_CREATED,
        )

    @action(detail=True, methods=["patch"], url_path=r"process-logs/(?P<log_id>[^/.]+)")
    @transaction.atomic
    def update_process_log(self, request, pk=None, log_id=None):
        admission = self.get_object()
        log = IPDDailyProcessLog.objects.filter(admission=admission, pk=log_id).first()
        if not log:
            return Response({"errors": {"log_id": ["Process log not found."]}}, status=404)
        template_id, process_config = resolve_process_config_for_save(
            hospital_id=admission.hospital_id,
            process_template_id=request.data.get("process_template_id") or log.process_template_id,
            existing=log,
        )
        serializer = IPDDailyProcessLogSerializer(
            log,
            data=request.data,
            partial=True,
            context={
                "admission": admission,
                "process_config": process_config,
            },
        )
        serializer.is_valid(raise_exception=True)
        validated = serializer.validated_data
        log_date = validated.get("log_date", log.log_date)
        log = save_ipd_process_log(
            admission=admission,
            log_date=log_date,
            data={**validated, "log_date": log_date},
            user=request.user,
            existing=log,
            process_template_id=template_id,
            process_config=process_config,
        )
        return success_response(data=IPDDailyProcessLogSerializer(log).data)

