from django.db import IntegrityError, transaction
from decimal import Decimal
from django.utils import timezone
from django.utils.dateparse import parse_date, parse_datetime
from django.db.models import BooleanField, Case, F, Prefetch, Q, Value, When
from django_filters.rest_framework import DjangoFilterBackend
from rest_framework import generics, permissions, serializers, status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import ValidationError
from rest_framework.filters import SearchFilter
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.auditlogs.services import create_audit_log
from apps.inventory.services.stock_service import (
    deduct_stock_fifo,
    get_batch_available_qty,
    reconcile_stock_for_invoice_edit,
    restore_stock_for_invoice_cancel,
)
from apps.shared.cancel_service import apply_void_if_last, is_last_pharmacy_invoice, release_pharmacy_invoice_number, void_pharmacy_sequence

from apps.pharmacy.calculations import invoice_round_off
from apps.pharmacy.invoice_number import next_pharmacy_invoice_number
from apps.pharmacy.models import Pharmacy, PharmacyInvoice, PharmacyInvoiceItem, PharmacyOutletSettings, PharmacySupplier
from apps.patients.models import Patient, PatientAddress, PatientGuardian
from apps.patients.age_utils import AGE_UNIT_YEARS, VALID_AGE_UNITS, age_parts_to_dob
from apps.pharmacy.purchase_challan import process_purchase_challan
from apps.pharmacy.purchase_history import detail_purchase_history, list_purchase_history
from apps.pharmacy.services.return_summary_service import build_invoice_return_summary
from apps.pharmacy.outlet_settings_channels import apply_nested_settings_patch, nested_settings_response
from apps.pharmacy.serializers import (
    PharmacyInvoiceItemSerializer,
    PharmacyInvoiceSerializer,
    PharmacyOutletSettingsPatchSerializer,
    PharmacySupplierSerializer,
    PurchaseChallanSerializer,
)
from apps.shared.response import success_response


def _get_pharmacy_branch(request):
    """Return selected pharmacy branch from middleware context."""
    pharmacy = getattr(request, "pharmacy", None)
    if pharmacy is not None:
        return pharmacy
    return None


def _require_pharmacy_branch(request):
    pharmacy = _get_pharmacy_branch(request)
    if pharmacy is None:
        raise serializers.ValidationError({"detail": ["Pharmacy branch context required."]})
    user = getattr(request, "user", None)
    if user is not None and user.is_authenticated and not user.is_superuser:
        from apps.roles_permissions.effective_permissions import user_may_access_pharmacy

        if not user_may_access_pharmacy(user, pharmacy.id):
            raise serializers.ValidationError(
                {"detail": ["Your account is not allowed to access this pharmacy branch."]}
            )
    return pharmacy


def _parse_invoice_datetime(value, *, error_key="invoice_datetime"):
    if value in (None, ""):
        return None
    invoice_dt = value
    if isinstance(value, str):
        invoice_dt = parse_datetime(value.strip())
        if invoice_dt is None:
            raise ValidationError({error_key: "Enter a valid invoice datetime."})
    if timezone.is_naive(invoice_dt):
        invoice_dt = timezone.make_aware(invoice_dt, timezone.get_current_timezone())
    return invoice_dt


def _sync_invoice_created_at(invoice, invoice_datetime):
    if invoice_datetime is None:
        return invoice
    PharmacyInvoice.objects.filter(pk=invoice.pk).update(created_at=invoice_datetime)
    invoice.refresh_from_db()
    return invoice


class PharmacyOutletSettingsView(generics.RetrieveUpdateAPIView):
    """GET/PATCH /api/v1/pharmacy/settings/ — nested B2C / B2B outlet profiles."""

    permission_classes = [permissions.IsAuthenticated]

    def get_object(self):
        pharmacy = _require_pharmacy_branch(self.request)
        obj, _ = PharmacyOutletSettings.objects.get_or_create(
            pharmacy=pharmacy,
            defaults={"business_name": pharmacy.name or ""},
        )
        return obj

    def retrieve(self, request, *args, **kwargs):
        obj = self.get_object()
        return success_response(nested_settings_response(obj, request))

    def update(self, request, *args, **kwargs):
        import json

        obj = self.get_object()
        raw = request.data
        if hasattr(raw, "dict"):
            data = raw.dict()
        elif isinstance(raw, dict):
            data = dict(raw)
        else:
            data = dict(raw)
        for key in ("b2c", "b2b"):
            if key in data and isinstance(data.get(key), str):
                try:
                    data[key] = json.loads(data[key])
                except (json.JSONDecodeError, TypeError):
                    pass
        for bool_key in ("apply_to_both", "b2b_enabled"):
            if bool_key in data and isinstance(data.get(bool_key), str):
                data[bool_key] = str(data[bool_key]).lower() in ("true", "1", "yes")
        ser = PharmacyOutletSettingsPatchSerializer(data=data)
        if not ser.is_valid():
            return Response({"success": False, "errors": ser.errors}, status=status.HTTP_400_BAD_REQUEST)
        updated = apply_nested_settings_patch(obj, ser.validated_data, request)
        if updated:
            obj.save(update_fields=updated + ["updated_at"])
        return success_response(nested_settings_response(obj, request))


class PharmacyPurchaseChallanView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request, *args, **kwargs):
        ser = PurchaseChallanSerializer(data=request.data, context={"request": request})
        if not ser.is_valid():
            return Response({"success": False, "errors": ser.errors}, status=status.HTTP_400_BAD_REQUEST)
        pharmacy = _require_pharmacy_branch(request)
        try:
            vd = ser.validated_data
            lines = process_purchase_challan(
                request=request,
                pharmacy=pharmacy,
                lines=vd["lines"],
                supplier_id=vd.get("supplier_id"),
                invoice_no=(vd.get("invoice_no") or "").strip(),
                purchase_date=vd.get("purchase_date"),
                payment_type=vd.get("payment_type") or "cash",
                gst_enabled=vd.get("gst_enabled", True),
            )
        except ValueError as exc:
            return Response({"success": False, "detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        return success_response({"lines": lines}, message="Purchase posted.")


class PharmacySupplierViewSet(viewsets.ModelViewSet):
    """CRUD + search for purchase parties (supplier master)."""

    serializer_class = PharmacySupplierSerializer
    permission_classes = [permissions.IsAuthenticated]
    filter_backends = [DjangoFilterBackend, SearchFilter]
    search_fields = ("name", "phone", "gst_number")

    def get_queryset(self):
        pharmacy = _get_pharmacy_branch(self.request)
        if not pharmacy:
            return PharmacySupplier.objects.none()
        return PharmacySupplier.objects.filter(pharmacy=pharmacy, is_active=True).order_by("name")


class PharmacyNextInvoiceNumberView(APIView):
    """GET /api/v1/pharmacy/invoice/next-number/ — preview next {prefix}{seq} (not reserved)."""

    permission_classes = [permissions.IsAuthenticated]

    def get(self, request, *args, **kwargs):
        pharmacy = _require_pharmacy_branch(request)
        channel = (request.query_params.get("channel") or "b2c").strip().lower()
        if channel not in ("b2b", "b2c"):
            channel = "b2c"
        return success_response({"invoice_no": next_pharmacy_invoice_number(pharmacy.id, channel=channel)})


class PharmacyInvoiceViewSet(viewsets.ModelViewSet):
    queryset = PharmacyInvoice.objects.all().order_by("-created_at")
    serializer_class = PharmacyInvoiceSerializer
    permission_classes = [permissions.IsAuthenticated]
    filter_backends = [SearchFilter]
    search_fields = ["invoice_no", "patient__first_name", "patient__last_name", "patient__uhid", "patient__phone"]

    def get_queryset(self):
        pharmacy = _get_pharmacy_branch(self.request)
        hospital = getattr(self.request.user, "hospital", None)
        action = getattr(self, "action", None)
        qs = super().get_queryset().filter(voided=False)
        # Detail / print-copy / return-summary (reception TPA): hospital-scoped by id.
        # Lists and edits stay tied to the selected pharmacy branch.
        if action in ("retrieve", "save_print_copy", "return_summary"):
            if hospital is not None:
                qs = qs.filter(pharmacy__hospital_id=hospital.id)
            elif pharmacy is not None:
                qs = qs.filter(pharmacy=pharmacy)
            else:
                return PharmacyInvoice.objects.none()
        elif pharmacy is None:
            return PharmacyInvoice.objects.none()
        else:
            qs = qs.filter(pharmacy=pharmacy)
        patient_id = self.request.query_params.get("patient")
        ipd_admission = self.request.query_params.get("ipd_admission")
        status_filter = (self.request.query_params.get("status") or "").strip().lower()
        if patient_id:
            qs = qs.filter(patient_id=patient_id)
        if ipd_admission:
            qs = qs.filter(ipd_admission_id=ipd_admission)
        if status_filter:
            # Status stored as lowercase in DB (TextChoices value, not name)
            qs = qs.filter(status=status_filter)
        if action == "list":
            qs = qs.defer("print_html").annotate(
                has_print_copy_flag=Case(
                    When(Q(print_html__gt=""), then=Value(True)),
                    default=Value(False),
                    output_field=BooleanField(),
                )
            )
        qs = qs.select_related("patient", "party", "created_by", "cancelled_by", "referred_by")
        qs = qs.prefetch_related(
            Prefetch(
                "items",
                queryset=PharmacyInvoiceItem.objects.select_related("medicine", "medicine__unit", "batch"),
            )
        )
        return qs

    def perform_update(self, serializer):
        invoice: PharmacyInvoice = serializer.instance
        if invoice.status == PharmacyInvoice.Status.CANCELLED:
            raise ValidationError({"detail": "Cancelled pharmacy receipts are view-only."})
        requested_status = serializer.validated_data.get("status")
        if requested_status == PharmacyInvoice.Status.CANCELLED:
            raise ValidationError({"detail": "Use the cancel action to cancel a pharmacy receipt."})
        invoice = serializer.save()
        invoice_datetime = getattr(serializer, "_invoice_datetime", None)
        if invoice_datetime is not None:
            _sync_invoice_created_at(invoice, invoice_datetime)

    def perform_create(self, serializer):
        pharmacy = _get_pharmacy_branch(self.request)
        if pharmacy is None:
            raise serializers.ValidationError({"detail": ["Pharmacy branch context required."]})
        channel = "b2b" if serializer.validated_data.get("party") else "b2c"
        raw = (serializer.validated_data.get("invoice_no") or "").strip()
        if raw and not PharmacyInvoice.objects.filter(invoice_no=raw).exists():
            invoice_no = raw
        else:
            invoice_no = next_pharmacy_invoice_number(pharmacy.id, reserve=True, channel=channel)
            while PharmacyInvoice.objects.filter(invoice_no=invoice_no).exists():
                invoice_no = next_pharmacy_invoice_number(pharmacy.id, reserve=True, channel=channel)
        payment_method = (serializer.validated_data.get("payment_method") or "cash").lower()
        grand_total = serializer.validated_data.get("grand_total") or Decimal("0.00")
        round_off = serializer.validated_data.get("round_off") or Decimal("0.00")
        if serializer.validated_data.get("party") is None:
            # Retail bills settle in whole rupees. Re-derive from the exact amount the
            # payload implies, so the rule holds no matter what the client rounded.
            grand_total, round_off = invoice_round_off(grand_total - round_off)
        else:
            round_off = Decimal("0.00")
        paid_amount = serializer.validated_data.get("paid_amount")
        if payment_method == "credit":
            paid_amount = Decimal("0.00")
        elif paid_amount is None or abs(grand_total - paid_amount) < Decimal("1.00"):
            # Full settlement: absorb the round-off rather than leaving paise of due.
            paid_amount = grand_total
        for _ in range(3):
            try:
                invoice = serializer.save(
                    pharmacy=pharmacy,
                    created_by=self.request.user,
                    invoice_no=invoice_no,
                    payment_method=payment_method,
                    grand_total=grand_total,
                    round_off=round_off,
                    paid_amount=paid_amount,
                )
                invoice_datetime = getattr(serializer, "_invoice_datetime", None)
                if invoice_datetime is not None:
                    _sync_invoice_created_at(invoice, invoice_datetime)
                return
            except IntegrityError:
                invoice_no = next_pharmacy_invoice_number(pharmacy.id, reserve=True, channel=channel)
                while PharmacyInvoice.objects.filter(invoice_no=invoice_no).exists():
                    invoice_no = next_pharmacy_invoice_number(pharmacy.id, reserve=True, channel=channel)
        # If all retries fail, bubble up the final DB integrity error.
        invoice = serializer.save(
            pharmacy=pharmacy,
            created_by=self.request.user,
            invoice_no=invoice_no,
            payment_method=payment_method,
            paid_amount=paid_amount,
        )
        invoice_datetime = getattr(serializer, "_invoice_datetime", None)
        if invoice_datetime is not None:
            _sync_invoice_created_at(invoice, invoice_datetime)

    @action(detail=True, methods=["post"], url_path="cancel")
    @transaction.atomic
    def cancel(self, request, pk=None):
        invoice = self.get_object()

        if invoice.status == PharmacyInvoice.Status.CANCELLED:
            raise ValidationError({"detail": "This pharmacy receipt is already cancelled."})
        if invoice.status != PharmacyInvoice.Status.FINALIZED:
            raise ValidationError({"detail": "Only finalized receipts can be cancelled."})

        reason = str(request.data.get("cancel_reason") or request.data.get("reason") or "").strip()
        if not reason:
            raise ValidationError({"cancel_reason": ["Cancellation reason is required."]})

        try:
            restore_stock_for_invoice_cancel(
                request=request,
                pharmacy=invoice.pharmacy,
                items=list(invoice.items.all()),
                reference_id=str(invoice.id),
            )
        except ValueError as exc:
            raise ValidationError({"detail": str(exc)}) from exc

        old_status = invoice.status
        apply_void_if_last(
            obj=invoice,
            is_last_fn=is_last_pharmacy_invoice,
            void_seq_fn=void_pharmacy_sequence,
            release_number_fn=release_pharmacy_invoice_number,
        )
        invoice.status = PharmacyInvoice.Status.CANCELLED
        invoice.cancel_reason = reason
        invoice.cancelled_by = request.user
        invoice.cancelled_at = timezone.now()
        update_fields = ["status", "cancel_reason", "cancelled_by", "cancelled_at", "voided", "updated_at"]
        if str(invoice.invoice_no or "").startswith("VOID-"):
            update_fields.append("invoice_no")
        invoice.save(update_fields=update_fields)

        hospital = invoice.pharmacy.hospital
        create_audit_log(
            request=request,
            hospital=hospital,
            module="pharmacy",
            action="cancel_pharmacy_invoice",
            obj=invoice,
            before={"status": old_status},
            after={
                "status": PharmacyInvoice.Status.CANCELLED,
                "cancel_reason": reason,
                "cancelled_by": str(request.user.id),
                "cancelled_at": invoice.cancelled_at.isoformat() if invoice.cancelled_at else None,
            },
        )

        invoice.refresh_from_db()
        return success_response(
            PharmacyInvoiceSerializer(invoice, context=self.get_serializer_context()).data,
            message="Pharmacy receipt cancelled.",
        )

    @action(detail=True, methods=["patch"], url_path="update-full")
    @transaction.atomic
    def update_full(self, request, pk=None):
        """
        PATCH /api/v1/pharmacy/invoices/{id}/update-full/
        Update patient basic details, invoice settlement fields, and replace all items.
        """
        invoice = self.get_object()
        if invoice.status == PharmacyInvoice.Status.CANCELLED:
            return Response({"detail": "Cancelled pharmacy receipts are view-only."}, status=status.HTTP_400_BAD_REQUEST)
        patient = invoice.patient
        if patient is None:
            return Response({"detail": "Invoice has no patient linked."}, status=status.HTTP_400_BAD_REQUEST)

        patient_payload = request.data.get("patient") or {}
        requested_id = str(patient_payload.get("id") or "").strip()
        if requested_id and str(requested_id) != str(patient.id):
            found = Patient.objects.filter(pk=requested_id, is_deleted=False).first()
            if not found:
                return Response(
                    {"detail": "Selected patient was not found."},
                    status=status.HTTP_404_NOT_FOUND,
                )
            invoice.patient = found
            invoice.save(update_fields=["patient", "updated_at"])
            patient = found
        invoice_payload = request.data.get("invoice") or {}
        items_payload = request.data.get("items") or []
        invoice_datetime = _parse_invoice_datetime(invoice_payload.get("invoice_datetime"))
        should_update_invoice_date = False
        resolved_invoice_date = invoice.date
        if "date" in invoice_payload:
            raw_invoice_date = str(invoice_payload.get("date") or "").strip()
            if not raw_invoice_date:
                raise ValidationError({"invoice.date": ["Invoice date is required."]})
            parsed_invoice_date = parse_date(raw_invoice_date)
            if parsed_invoice_date is None:
                raise ValidationError({"invoice.date": ["Enter a valid invoice date."]})
            resolved_invoice_date = parsed_invoice_date
            should_update_invoice_date = True
        if invoice_datetime is not None:
            local_invoice_date = timezone.localtime(invoice_datetime).date()
            if should_update_invoice_date and resolved_invoice_date != local_invoice_date:
                raise ValidationError(
                    {"invoice_datetime": ["Invoice date must match the date portion of invoice datetime."]}
                )
            resolved_invoice_date = local_invoice_date
            should_update_invoice_date = True

        if not isinstance(items_payload, list) or len(items_payload) == 0:
            return Response({"detail": "At least one item is required."}, status=status.HTTP_400_BAD_REQUEST)

        # Update patient core fields
        first_name = str(patient_payload.get("first_name", patient.first_name or "")).strip()
        last_name = str(patient_payload.get("last_name", patient.last_name or "")).strip()
        if first_name:
            patient.first_name = first_name
        patient.last_name = last_name
        patient.phone = str(patient_payload.get("phone", patient.phone or "")).strip()
        gender = str(patient_payload.get("gender", patient.gender or "")).strip().lower()
        if gender in ("male", "female", "other"):
            patient.gender = gender
        patient_update_fields = ["first_name", "last_name", "phone", "gender", "updated_at"]
        age_raw = patient_payload.get("age", None)
        if age_raw not in (None, ""):
            age_unit = str(patient_payload.get("age_unit") or AGE_UNIT_YEARS).strip().lower()
            if age_unit not in VALID_AGE_UNITS:
                age_unit = AGE_UNIT_YEARS
            try:
                dob = age_parts_to_dob(int(age_raw), age_unit)
            except (TypeError, ValueError):
                dob = None
            if dob is not None:
                patient.dob = dob
                patient_update_fields.append("dob")
        patient.save(update_fields=patient_update_fields)

        # Update guardian
        guardian_name = str(patient_payload.get("guardian_name", "")).strip()
        if guardian_name:
            guardian_obj, _ = PatientGuardian.objects.get_or_create(patient=patient, defaults={"name": guardian_name})
            guardian_obj.name = guardian_name
            guardian_obj.save(update_fields=["name", "updated_at"])

        # Update address
        line1 = str(patient_payload.get("address_line1", "")).strip()
        city = str(patient_payload.get("city", "")).strip()
        state_name = str(patient_payload.get("state", "")).strip()
        if line1 or city or state_name:
            addr_obj, _ = PatientAddress.objects.get_or_create(patient=patient)
            addr_obj.line1 = line1
            addr_obj.city = city
            addr_obj.state = state_name
            addr_obj.save(update_fields=["line1", "city", "state", "updated_at"])

        old_items = list(invoice.items.select_related("batch", "medicine").all())
        if invoice.status == PharmacyInvoice.Status.FINALIZED:
            try:
                reconcile_stock_for_invoice_edit(
                    request=request,
                    pharmacy=invoice.pharmacy,
                    old_items=old_items,
                    new_rows=items_payload,
                    reference_id=str(invoice.id),
                )
            except ValueError as exc:
                raise ValidationError({"detail": str(exc)}) from exc

        # Replace all items
        invoice.items.all().delete()
        subtotal = Decimal("0.00")
        total_cgst = Decimal("0.00")
        total_sgst = Decimal("0.00")
        for row in items_payload:
            medicine_id = row.get("medicine")
            batch_id = row.get("batch")
            qty = Decimal(str(row.get("qty", 0) or 0))
            free_qty = Decimal(str(row.get("free_qty", 0) or 0))
            rate = Decimal(str(row.get("rate", 0) or 0))
            mrp = Decimal(str(row.get("mrp", 0) or 0))
            cgst_rate = Decimal(str(row.get("cgst_rate", 0) or 0))
            sgst_rate = Decimal(str(row.get("sgst_rate", 0) or 0))
            if not medicine_id or not batch_id or qty <= 0:
                continue
            base_amount = (qty * rate).quantize(Decimal("0.01"))
            cgst_amount = (base_amount * cgst_rate / Decimal("100")).quantize(Decimal("0.01"))
            sgst_amount = (base_amount * sgst_rate / Decimal("100")).quantize(Decimal("0.01"))
            line_total = (base_amount + cgst_amount + sgst_amount).quantize(Decimal("0.01"))
            PharmacyInvoiceItem.objects.create(
                invoice=invoice,
                medicine_id=medicine_id,
                batch_id=batch_id,
                qty=qty,
                free_qty=free_qty,
                mrp=mrp,
                rate=rate,
                cgst_rate=cgst_rate,
                sgst_rate=sgst_rate,
                amount=line_total,
            )
            subtotal += base_amount
            total_cgst += cgst_amount
            total_sgst += sgst_amount

        total_discount = Decimal(str(invoice_payload.get("total_discount", invoice.total_discount or 0) or 0)).quantize(Decimal("0.01"))
        payment_method = str(invoice_payload.get("payment_method", invoice.payment_method or "cash") or "cash").strip().lower()
        if payment_method not in ("cash", "card", "upi", "credit", "bank_transfer", "other"):
            payment_method = "cash"
        grand_total = (subtotal + total_cgst + total_sgst - total_discount).quantize(Decimal("0.01"))
        if grand_total < 0:
            grand_total = Decimal("0.00")
        # Retail bills settle in whole rupees; party (B2B / GST) bills stay exact.
        round_off = Decimal("0.00")
        if invoice.party_id is None:
            grand_total, round_off = invoice_round_off(grand_total)
        paid_amount = Decimal(str(invoice_payload.get("paid_amount", invoice.paid_amount or 0) or 0)).quantize(Decimal("0.01"))
        if payment_method == "credit":
            paid_amount = Decimal("0.00")
        elif abs(grand_total - paid_amount) < Decimal("1.00"):
            # This endpoint only settles in full or as credit, so absorb the round-off
            # instead of leaving a few paise of due behind.
            paid_amount = grand_total
        if paid_amount > grand_total:
            paid_amount = grand_total
        if paid_amount < 0:
            paid_amount = Decimal("0.00")

        invoice.payment_method = payment_method
        invoice.paid_amount = paid_amount
        if should_update_invoice_date:
            invoice.date = resolved_invoice_date
        invoice.total_discount = total_discount
        invoice.subtotal = subtotal.quantize(Decimal("0.01"))
        invoice.cgst = total_cgst.quantize(Decimal("0.01"))
        invoice.sgst = total_sgst.quantize(Decimal("0.01"))
        invoice.round_off = round_off
        invoice.grand_total = grand_total
        invoice.remarks = str(invoice_payload.get("remarks", invoice.remarks or ""))
        if "billing_doctor_name" in invoice_payload:
            invoice.billing_doctor_name = str(invoice_payload.get("billing_doctor_name") or "").strip()
        if "billing_hospital_name" in invoice_payload:
            invoice.billing_hospital_name = str(invoice_payload.get("billing_hospital_name") or "").strip()
        invoice.print_html = ""
        invoice.print_html_updated_at = None
        update_fields = [
            "payment_method",
            "paid_amount",
            "total_discount",
            "subtotal",
            "cgst",
            "sgst",
            "round_off",
            "grand_total",
            "remarks",
            "print_html",
            "print_html_updated_at",
            "updated_at",
        ]
        if should_update_invoice_date:
            update_fields.append("date")
        if "billing_doctor_name" in invoice_payload:
            update_fields.append("billing_doctor_name")
        if "billing_hospital_name" in invoice_payload:
            update_fields.append("billing_hospital_name")
        invoice.save(update_fields=update_fields)
        if invoice_datetime is not None:
            _sync_invoice_created_at(invoice, invoice_datetime)
        return success_response(data=PharmacyInvoiceSerializer(invoice).data, message="Invoice updated.")

    @action(detail=True, methods=["get"], url_path="return-summary")
    def return_summary(self, request, pk=None):
        invoice = self.get_object()
        data = build_invoice_return_summary(invoice)
        return success_response(data)

    @action(detail=False, methods=["post"], url_path="create-draft")
    def create_draft(self, request, *args, **kwargs):
        """
        POST /api/v1/pharmacy/invoices/create-draft/
        Creates a draft invoice + all items in a single atomic transaction.
        Body: { patient, ipd_admission, remarks, items: [{medicine, batch, qty, mrp, rate}] }
        """
        import logging
        import uuid as _uuid
        from .models import PharmacyInvoiceItem

        log = logging.getLogger(__name__)

        pharmacy = _get_pharmacy_branch(request)
        if pharmacy is None:
            return Response({"detail": "Pharmacy branch not set."}, status=status.HTTP_400_BAD_REQUEST)

        patient_id = request.data.get("patient")
        if not patient_id:
            return Response({"detail": "patient is required."}, status=status.HTTP_400_BAD_REQUEST)

        items_data = request.data.get("items", [])
        if not items_data:
            return Response({"detail": "At least one item is required."}, status=status.HTTP_400_BAD_REQUEST)

        try:
            with transaction.atomic():
                # Generate a collision-safe invoice number (max 10 retries then UUID suffix)
                invoice_no = next_pharmacy_invoice_number(pharmacy.id, reserve=True, channel="b2c")
                for _ in range(10):
                    if not PharmacyInvoice.objects.filter(invoice_no=invoice_no).exists():
                        break
                    invoice_no = next_pharmacy_invoice_number(pharmacy.id, reserve=True, channel="b2c")
                else:
                    # Absolute fallback — extremely unlikely to collide
                    invoice_no = f"DRFT-{str(_uuid.uuid4())[:8].upper()}"

                invoice = PharmacyInvoice.objects.create(
                    pharmacy=pharmacy,
                    patient_id=patient_id,
                    ipd_admission_id=request.data.get("ipd_admission") or None,
                    invoice_no=invoice_no,
                    status="draft",
                    payment_method="cash",
                    paid_amount=Decimal("0.00"),
                    subtotal=Decimal("0.00"),
                    grand_total=Decimal("0.00"),
                    cgst=Decimal("0.00"),
                    sgst=Decimal("0.00"),
                    remarks=request.data.get("remarks", ""),
                    created_by=request.user,
                )

                item_objs = []
                for item in items_data:
                    item_objs.append(PharmacyInvoiceItem(
                        invoice=invoice,
                        medicine_id=item["medicine"],
                        batch_id=item.get("batch") or None,
                        qty=Decimal(str(item.get("qty", "1"))),
                        mrp=Decimal(str(item.get("mrp", "0"))),
                        rate=Decimal(str(item.get("rate", "0"))),
                        amount=Decimal(str(item.get("amount", "0"))),
                        cgst_rate=Decimal("0.00"),
                        sgst_rate=Decimal("0.00"),
                    ))

                PharmacyInvoiceItem.objects.bulk_create(item_objs)

                serializer = self.get_serializer(invoice)
                return Response({"success": True, "data": serializer.data}, status=status.HTTP_201_CREATED)

        except Exception as exc:
            log.exception("create_draft failed for patient=%s pharmacy=%s", patient_id, pharmacy.id)
            return Response(
                {"detail": f"Failed to create draft: {exc}"},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )



    @action(detail=False, methods=["get"], url_path="all-drafts")
    def all_drafts(self, request, *args, **kwargs):
        """
        GET /api/v1/pharmacy/invoices/all-drafts/
        Returns draft invoices in the selected pharmacy branch.
        """
        qs = (
            self.get_queryset().filter(status="draft")
            .select_related("patient", "created_by")
            .prefetch_related("items")
            .order_by("-created_at")
        )
        serializer = self.get_serializer(qs, many=True)
        return Response({"success": True, "data": serializer.data})

    @action(detail=True, methods=["delete"], url_path="delete-draft")
    def delete_draft(self, request, pk=None, *args, **kwargs):
        """
        DELETE /api/v1/pharmacy/invoices/{id}/delete-draft/
        Deletes draft invoice by UUID in selected branch only.
        """
        try:
            invoice = self.get_queryset().get(pk=pk, status="draft")
        except PharmacyInvoice.DoesNotExist:
            return Response({"detail": "Draft not found."}, status=status.HTTP_404_NOT_FOUND)
        invoice.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)

    @action(detail=True, methods=["patch"], url_path="print-copy")
    def save_print_copy(self, request, pk=None, *args, **kwargs):
        """
        PATCH /api/v1/pharmacy/invoices/{id}/print-copy/
        Save or clear the pre-print edited HTML snapshot for a finalized invoice.
        Body: { "print_html": "<!DOCTYPE html>..." } — empty string clears the copy.
        """
        invoice = self.get_object()
        if invoice.status != PharmacyInvoice.Status.FINALIZED:
            return Response(
                {"detail": "Print copy can only be saved for finalized invoices."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        print_html = request.data.get("print_html", "")
        if print_html is None:
            print_html = ""
        print_html = str(print_html)
        if not print_html.strip():
            invoice.print_html = ""
            invoice.print_html_updated_at = None
        else:
            invoice.print_html = print_html
            invoice.print_html_updated_at = timezone.now()
        invoice.save(update_fields=["print_html", "print_html_updated_at", "updated_at"])
        return success_response(
            data=PharmacyInvoiceSerializer(invoice).data,
            message="Print copy saved." if invoice.print_html else "Print copy cleared.",
        )

    @action(detail=True, methods=["post"], url_path="clear-credit")
    def clear_credit(self, request, pk=None, *args, **kwargs):
        """
        POST /api/v1/pharmacy/invoices/{id}/clear-credit/
        Mark a pending credit invoice as fully paid without editing line items.
        """
        invoice = self.get_object()
        if invoice.status == PharmacyInvoice.Status.CANCELLED:
            return Response(
                {"detail": "Cancelled pharmacy receipts cannot be settled."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if invoice.status != PharmacyInvoice.Status.FINALIZED:
            return Response(
                {"detail": "Only finalized invoices can be settled."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        due = (invoice.grand_total or Decimal("0.00")) - (invoice.paid_amount or Decimal("0.00"))
        if due <= 0:
            return Response(
                {"detail": "No pending due on this invoice."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        payment_method = str(request.data.get("payment_method") or "cash").strip().lower()
        if payment_method not in ("cash", "card", "upi", "bank_transfer", "other"):
            payment_method = "cash"

        invoice.payment_method = payment_method
        invoice.paid_amount = invoice.grand_total or Decimal("0.00")
        invoice.save(update_fields=["payment_method", "paid_amount", "updated_at"])
        return success_response(
            data=PharmacyInvoiceSerializer(invoice, context=self.get_serializer_context()).data,
            message="Pending credit cleared.",
        )

    @action(detail=False, methods=["get"], url_path="pending-credits")
    def pending_credits(self, request, *args, **kwargs):
        qs = (
            self.get_queryset()
            .select_related("patient")
            .filter(payment_method="credit")
            .exclude(status=PharmacyInvoice.Status.CANCELLED)
            .order_by("-date", "-created_at")
        )
        search = (request.query_params.get("search") or "").strip()
        patient_id = (request.query_params.get("patient_id") or "").strip()
        if patient_id:
            qs = qs.filter(patient_id=patient_id)
        if search:
            qs = qs.filter(
                Q(invoice_no__icontains=search)
                | Q(patient__first_name__icontains=search)
                | Q(patient__last_name__icontains=search)
                | Q(patient__uhid__icontains=search)
                | Q(patient__phone__icontains=search)
            )

        patients: dict[str, dict] = {}
        total_pending = Decimal("0.00")
        for inv in qs:
            due = (inv.grand_total or Decimal("0")) - (inv.paid_amount or Decimal("0"))
            if due <= 0:
                continue
            pid = str(inv.patient_id)
            row = patients.get(pid)
            if row is None:
                first_name = (inv.patient.first_name or "").strip()
                last_name = (inv.patient.last_name or "").strip()
                row = {
                    "patient_id": pid,
                    "patient_name": " ".join([x for x in [first_name, last_name] if x]).strip() or "Unknown",
                    "uhid": inv.patient.uhid or "",
                    "phone": inv.patient.phone or "",
                    "total_pending_amount": Decimal("0.00"),
                    "latest_bill_at": inv.created_at,
                    "bills": [],
                }
                patients[pid] = row
            row["total_pending_amount"] += due
            row["bills"].append(
                {
                    "id": str(inv.id),
                    "invoice_no": inv.invoice_no,
                    "date": inv.date.isoformat() if inv.date else None,
                    "created_at": inv.created_at.isoformat() if inv.created_at else None,
                    "grand_total": str(inv.grand_total or Decimal("0.00")),
                    "paid_amount": str(inv.paid_amount or Decimal("0.00")),
                    "due_amount": str(due),
                    "ipd_admission": str(inv.ipd_admission_id) if inv.ipd_admission_id else None,
                    "status": inv.status,
                }
            )
            total_pending += due

        rows = []
        for row in patients.values():
            row["total_pending_amount"] = str(row["total_pending_amount"])
            row["bill_count"] = len(row["bills"])
            latest = row.pop("latest_bill_at", None)
            row["latest_bill_at"] = latest.isoformat() if latest else None
            rows.append(row)
        rows.sort(key=lambda r: r.get("latest_bill_at") or "", reverse=True)
        return success_response(
            rows,
            meta={
                "total_patients": len(rows),
                "total_pending_amount": str(total_pending),
            },
        )


class PharmacyInvoiceItemViewSet(viewsets.ModelViewSet):
    queryset = PharmacyInvoiceItem.objects.all()
    serializer_class = PharmacyInvoiceItemSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        pharmacy = _get_pharmacy_branch(self.request)
        if pharmacy is None:
            return PharmacyInvoiceItem.objects.none()
        return super().get_queryset().filter(invoice__pharmacy=pharmacy)

    @transaction.atomic
    def perform_create(self, serializer):
        item = serializer.save()
        inv = item.invoice
        pharmacy = inv.pharmacy
        batch = item.batch
        allow_expired = str(self.request.query_params.get("allow_expired", "")).lower() in ("1", "true", "yes")
        if (
            batch.expiry_date
            and batch.expiry_date < timezone.now().date()
            and not allow_expired
        ):
            raise serializers.ValidationError({"batch": ["This batch is expired and cannot be sold."]})
        if inv.status == PharmacyInvoice.Status.FINALIZED:
            available = get_batch_available_qty(batch)
            deduct_qty = item.qty + (item.free_qty or Decimal("0"))
            if available < deduct_qty:
                raise serializers.ValidationError(
                    {
                        "qty": [
                            f"Insufficient stock for batch {batch.batch_no}. "
                            f"Available {available}, requested {deduct_qty} (sold + free)."
                        ]
                    }
                )
            try:
                deduct_stock_fifo(
                    request=self.request,
                    pharmacy=pharmacy,
                    medicine_batch_pairs=[(batch, deduct_qty)],
                    reference_id=str(inv.id),
                )
            except ValueError as exc:
                raise serializers.ValidationError({"non_field_errors": [str(exc)]}) from exc


class PurchaseHistoryListView(APIView):
    """GET /api/v1/pharmacy/purchase-history/ — paginated tiles for Marg-style dashboard."""

    permission_classes = [permissions.IsAuthenticated]

    def get(self, request, *args, **kwargs):
        pharmacy = _get_pharmacy_branch(request)
        if pharmacy is None:
            return Response({"success": False, "detail": "Pharmacy branch context required."}, status=status.HTTP_400_BAD_REQUEST)
        try:
            limit = max(1, min(int(request.query_params.get("limit", 20)), 100))
            offset = max(0, int(request.query_params.get("offset", 0)))
        except ValueError:
            limit, offset = 20, 0
        search = (request.query_params.get("search") or "").strip()
        supplier_id = request.query_params.get("supplier_id")
        gst = (request.query_params.get("gst") or "all").lower()
        if gst not in ("all", "gst", "non"):
            gst = "all"
        date_from = parse_date(request.query_params.get("date_from", "") or "")
        date_to = parse_date(request.query_params.get("date_to", "") or "")

        rows, total = list_purchase_history(
            pharmacy_id=pharmacy.id,
            limit=limit,
            offset=offset,
            search=search,
            supplier_id=supplier_id if supplier_id else None,
            date_from=date_from,
            date_to=date_to,
            gst=gst,
        )
        return success_response(
            rows,
            meta={"total": total, "limit": limit, "offset": offset, "has_more": offset + len(rows) < total},
        )


class PurchaseHistoryDetailView(APIView):
    """GET /api/v1/pharmacy/purchase-history/<uuid>/ — full challan + lines + return hints."""

    permission_classes = [permissions.IsAuthenticated]

    def get(self, request, pk, *args, **kwargs):
        pharmacy = _get_pharmacy_branch(request)
        if pharmacy is None:
            return Response({"success": False, "detail": "Pharmacy branch context required."}, status=status.HTTP_400_BAD_REQUEST)
        data = detail_purchase_history(pharmacy_id=pharmacy.id, pk=pk)
        if not data:
            return Response({"success": False, "detail": "Not found."}, status=status.HTTP_404_NOT_FOUND)
        return success_response(data)


class DoctorStockSearchView(APIView):
    """
    GET /api/v1/pharmacy/doctor-stock-search/?pharmacy_id=<uuid>&q=<query>

    Allows any authenticated user (e.g. Doctors) to search pharmacy stock
    by explicitly providing the target pharmacy pharmacy_id as a query param.
    No X-Pharmacy-Branch header needed — works from any portal/role.
    """

    permission_classes = [permissions.IsAuthenticated]

    def get(self, request, *args, **kwargs):
        from apps.inventory.models import Medicine, MedicineBatch
        from apps.inventory.services.stock_service import get_batch_available_qty
        from apps.shared.models import Hospital
        from django.db.models import Q
        from django.utils import timezone
        import uuid as uuid_module

        pharmacy_id = (
            request.query_params.get("pharmacy_id")
            or request.query_params.get("hospital_id")
            or ""
        ).strip()
        q = (request.query_params.get("q") or "").strip()
        q_lower = q.lower()

        if len(q) < 1:
            return success_response([])

        if not pharmacy_id:
            return Response({"success": False, "detail": "pharmacy_id is required."}, status=400)

        try:
            # Look up any active hospital — not restricted to is_pharmacy
            # because some setups store all medicines in the main hospital
            pharmacy = Pharmacy.objects.get(id=uuid_module.UUID(pharmacy_id), is_active=True)
        except (Pharmacy.DoesNotExist, ValueError):
            return Response({"success": False, "detail": "Invalid pharmacy branch."}, status=400)

        hid = pharmacy.id

        # If this pharmacy branch has no medicines, fall back to the requester's
        # own hospital (which typically holds all the shared medicine catalogue)
        from apps.inventory.models import Medicine as _Med
        if not _Med.objects.filter(pharmacy_id=hid, is_active=True).exists():
            fallback_hid = getattr(getattr(request.user, 'hospital', None), 'id', None)
            if fallback_hid:
                hid = fallback_hid


        def _pack_size(med):
            conv = med.unit_conversions or {}
            for key in ("strip", "STRIP", "box", "BOX", "carton", "CARTON"):
                v = conv.get(key)
                if v is not None:
                    try:
                        n = int(float(v))
                        if n > 0:
                            return n
                    except (TypeError, ValueError):
                        continue
            return 1

        def _exp_status(expiry_date):
            if not expiry_date:
                return "ok", None
            today = timezone.now().date()
            if expiry_date < today:
                return "expired", (expiry_date - today).days
            days = (expiry_date - today).days
            return ("expiring", days) if days <= 60 else ("ok", days)

        med_qs = (
            Medicine.objects.filter(pharmacy_id=hid, is_active=True)
            .filter(Q(name__icontains=q) | Q(sku__icontains=q))
            .select_related("unit")
            .order_by("name")[:25]
        )

        out = []
        for med in med_qs:
            pack_size = _pack_size(med)
            batches = (
                MedicineBatch.objects.filter(medicine_id=med.id, pharmacy_id=hid)
                .order_by("expiry_date", "batch_no")
            )
            for b in batches:
                stock = float(get_batch_available_qty(b))
                st, days = _exp_status(b.expiry_date)
                out.append({
                    "medicine": {
                        "id": str(med.id),
                        "name": med.name,
                        "sku": med.sku,
                        "pack_info": med.pack_info or "",
                        "hsn_code": med.hsn_code or "",
                        "gst_percent": str(med.gst_percent),
                        "unit_conversions": med.unit_conversions or {},
                        "unit_name": med.unit.name if med.unit_id else "",
                        "pack_size": pack_size,
                        "form": med.form or "",
                    },
                    "batch": {
                        "id": str(b.id),
                        "batch_no": b.batch_no,
                        "expiry_date": b.expiry_date.isoformat() if b.expiry_date else None,
                        "mrp": str(b.mrp),
                        "unit_cost": str(b.unit_cost),
                        "sale_rate": str(b.sale_rate),
                        "stock": stock,
                    },
                    "expiry_status": st,
                    "days_to_expiry": days,
                })

        def _match_rank(row):
            name = (row["medicine"].get("name") or "").strip().lower()
            sku = (row["medicine"].get("sku") or "").strip().lower()
            if name == q_lower or sku == q_lower:
                return 0
            if name.startswith(q_lower):
                return 1
            if sku.startswith(q_lower):
                return 2
            if q_lower in name:
                return 3
            return 4

        out.sort(key=lambda r: (
            _match_rank(r),
            0 if r["expiry_status"] == "ok" else 1 if r["expiry_status"] == "expiring" else 2,
            r["batch"]["expiry_date"] or "9999-12-31",
            r["medicine"]["name"],
        ))
        return success_response(out[:80])
