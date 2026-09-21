from __future__ import annotations

import re
from datetime import date
from decimal import Decimal

from django.contrib.auth import get_user_model
from django.db import transaction
from django.db.models import Max, Q, Sum
from django.utils import timezone
from django.utils.dateparse import parse_date
from rest_framework import permissions, status, viewsets
from rest_framework.decorators import api_view, permission_classes
from django_filters import rest_framework as django_filters
from rest_framework.filters import OrderingFilter
from rest_framework.response import Response

from apps.auditlogs.services import create_audit_log
from apps.billing.models import BillingInvoice
from apps.billing.collection_attribution import apply_attribution_to_payment
from apps.shared.cancel_service import (
    apply_void_if_last,
    is_last_payment_slip,
    release_payment_slip_number,
    void_payment_slip_sequence,
)
from apps.opd.models import OPDVisit
from apps.expenses.models import ExpenseTransaction
from apps.payments.models import CashHandover, PaymentQuickCategory, PaymentQuickService, PaymentTransaction
from apps.settings_management.models import ReceptionPortalSettings
from apps.payments.serializers import PaymentTransactionCreateSerializer, PaymentTransactionSerializer
from apps.roles_permissions.effective_permissions import allowed_portals_for_user
from apps.roles_permissions.permissions import HasRequiredPermission
from apps.shared.response import success_response


def _invoice_amount_paid_success(invoice: BillingInvoice):
    """Sum only successful, non-deleted payments for invoice.amount_paid."""
    total = (
        invoice.payments.filter(
            status=PaymentTransaction.Status.SUCCESS,
            is_deleted=False,
        ).aggregate(t=Sum("amount"))["t"]
        or 0
    )
    return total


class PaymentTransactionFilter(django_filters.FilterSet):
    paid_at__date__gte = django_filters.DateFilter(field_name="paid_at", lookup_expr="date__gte")
    paid_at__date__lte = django_filters.DateFilter(field_name="paid_at", lookup_expr="date__lte")
    payment_mode = django_filters.CharFilter()
    status = django_filters.CharFilter()
    invoice__encounter_type = django_filters.CharFilter()
    collected_by = django_filters.UUIDFilter()
    attribution_type = django_filters.CharFilter()
    attributed_doctor_user = django_filters.UUIDFilter()
    advance_only = django_filters.BooleanFilter(method="filter_advance_only")
    refund_only = django_filters.BooleanFilter(method="filter_refund_only")

    class Meta:
        model = PaymentTransaction
        fields = []

    def filter_advance_only(self, queryset, name, value):
        if value in (True, "true", "1", 1):
            return queryset.filter(invoice__invoice_no__startswith="IPDADV-")
        return queryset

    def filter_refund_only(self, queryset, name, value):
        if value in (True, "true", "1", 1):
            return queryset.filter(
                Q(invoice__invoice_no__icontains="IPDREF") | Q(amount__lt=0)
            )
        return queryset


_PAYMENT_SEARCH_LOOKUPS = (
    "invoice__invoice_no",
    "invoice__patient__uhid",
    "invoice__patient__first_name",
    "invoice__patient__last_name",
    "invoice__patient__phone",
    "transaction_reference",
    "receipt_no",
    "slip_number",
)


class PaymentTransactionViewSet(viewsets.ModelViewSet):
    queryset = PaymentTransaction.objects.filter(voided=False).select_related(
        "invoice",
        "invoice__patient",
        "invoice__patient__guardian",
        "collected_by",
        "attributed_doctor_user",
    ).prefetch_related(
        "invoice__items"
    )
    filter_backends = (django_filters.DjangoFilterBackend, OrderingFilter)
    filterset_class = PaymentTransactionFilter
    ordering_fields = ("paid_at", "created_at", "amount")
    ordering = ("-paid_at", "-created_at")

    permission_classes = [permissions.IsAuthenticated, HasRequiredPermission]
    http_method_names = ["get", "post", "patch"]

    required_permission_map = {
        "list": "payments.view_transaction",
        "retrieve": "payments.view_transaction",
        "create": "payments.create_transaction",
        "update": "payments.create_transaction",
        "partial_update": "payments.create_transaction",
    }

    def get_serializer_class(self):
        if self.action in {"list", "retrieve"}:
            return PaymentTransactionSerializer
        return PaymentTransactionCreateSerializer

    def get_required_permission(self) -> str | None:
        return self.required_permission_map.get(getattr(self, "action", None))

    def get_permissions(self):
        self.required_permission = self.get_required_permission()
        return super().get_permissions()

    def get_queryset(self):
        qs = super().get_queryset()
        if not self.request.user.hospital_id:
            return qs.none()
        return qs.filter(hospital_id=self.request.user.hospital_id)

    def filter_queryset(self, queryset):
        qs = super().filter_queryset(queryset)
        search = (self.request.query_params.get("search") or "").strip()
        if not search:
            return qs

        terms = [part for part in re.split(r"\s+", search) if part]
        if not terms:
            return qs

        filters = Q()
        for term in terms:
            term_q = Q()
            for lookup in _PAYMENT_SEARCH_LOOKUPS:
                term_q |= Q(**{f"{lookup}__icontains": term})
            digits = re.sub(r"\D", "", term)
            if len(digits) >= 4:
                term_q |= Q(invoice__patient__phone__icontains=digits)
            filters &= term_q
        return qs.filter(filters).distinct()

    @transaction.atomic
    def create(self, request, *args, **kwargs):
        serializer = PaymentTransactionCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        invoice: BillingInvoice = serializer.validated_data["invoice"]

        if not request.user.hospital_id:
            return Response(
                {"success": False, "errors": {"hospital": ["User is not linked to a hospital."]}},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if invoice.hospital_id != request.user.hospital_id:
            return Response(
                {"success": False, "errors": {"invoice": ["Invoice does not belong to your hospital."]}},
                status=status.HTTP_403_FORBIDDEN,
            )
        if invoice.status in {BillingInvoice.Status.CANCELLED, BillingInvoice.Status.REFUNDED}:
            return Response(
                {"success": False, "errors": {"invoice": ["Cannot accept payments for cancelled/refunded invoices."]}},
                status=status.HTTP_400_BAD_REQUEST,
            )

        payload = serializer.validated_data
        payload["hospital_id"] = invoice.hospital_id
        payload["collected_by_id"] = request.user.id

        payment = PaymentTransaction(**payload)
        apply_attribution_to_payment(payment, invoice)
        payment.save()

        total_paid = _invoice_amount_paid_success(invoice)
        invoice.amount_paid = total_paid
        invoice.save(update_fields=["amount_paid"])

        create_audit_log(
            request=request,
            hospital=invoice.hospital,
            module="payments",
            action="create_payment",
            obj=payment,
            after={
                "invoice_no": invoice.invoice_no,
                "amount": str(payment.amount),
                "payment_mode": payment.payment_mode,
                "status": payment.status,
            },
        )

        return success_response(data=PaymentTransactionSerializer(payment).data, status_code=status.HTTP_201_CREATED)

    @transaction.atomic
    def partial_update(self, request, *args, **kwargs):
        instance: PaymentTransaction = self.get_object()
        old_amount = instance.amount
        old_status = instance.status
        old_mode = instance.payment_mode
        old_reference = instance.transaction_reference
        old_receipt = instance.receipt_no
        old_paid_at = instance.paid_at

        serializer = PaymentTransactionCreateSerializer(instance, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        validated = serializer.validated_data
        effective_status = validated.get("status", instance.status)
        inv = instance.invoice
        if effective_status == PaymentTransaction.Status.SUCCESS and inv.status in {
            BillingInvoice.Status.CANCELLED,
            BillingInvoice.Status.REFUNDED,
        }:
            return Response(
                {
                    "success": False,
                    "errors": {"status": ["Cannot set payment to success for a cancelled or refunded invoice."]},
                },
                status=status.HTTP_400_BAD_REQUEST,
            )
        is_cancelling = (
            effective_status == PaymentTransaction.Status.CANCELLED
            and old_status != PaymentTransaction.Status.CANCELLED
        )
        voided_last = False
        if is_cancelling:
            voided_last = apply_void_if_last(
                obj=instance,
                is_last_fn=is_last_payment_slip,
                void_seq_fn=void_payment_slip_sequence,
                release_number_fn=release_payment_slip_number,
            )
        payment = serializer.save()
        if is_cancelling and voided_last:
            payment.voided = True
            payment.slip_number = instance.slip_number
            payment.save(update_fields=["voided", "slip_number", "updated_at"])

        invoice = payment.invoice
        total_paid = _invoice_amount_paid_success(invoice)
        invoice.amount_paid = total_paid
        invoice.save(update_fields=["amount_paid"])

        create_audit_log(
            request=request,
            hospital=invoice.hospital,
            module="payments",
            action="update_payment",
            obj=payment,
            before={
                "amount": str(old_amount),
                "status": old_status,
                "payment_mode": old_mode,
                "transaction_reference": old_reference,
                "receipt_no": old_receipt,
                "paid_at": old_paid_at.isoformat() if old_paid_at else None,
            },
            after={
                "amount": str(payment.amount),
                "status": payment.status,
                "payment_mode": payment.payment_mode,
                "transaction_reference": payment.transaction_reference,
                "receipt_no": payment.receipt_no,
                "paid_at": payment.paid_at.isoformat() if payment.paid_at else None,
            },
        )
        return success_response(data=PaymentTransactionSerializer(payment).data)


User = get_user_model()


def _cash_zero() -> Decimal:
    return Decimal("0.00")


def _decimal_2(value) -> Decimal:
    if isinstance(value, Decimal):
        return value
    return Decimal(str(value or "0.00"))


def _format_money(value) -> str:
    return f"{_decimal_2(value):.2f}"


def _last_handover_reset_at(user) -> timezone.datetime | None:
    """
    Sender-side accepted handover is treated as settlement/reset point.
    """
    return (
        CashHandover.objects.filter(
            hospital_id=user.hospital_id,
            from_user_id=user.id,
            status=CashHandover.Status.ACCEPTED,
        ).aggregate(m=Max("accepted_at"))["m"]
    )


def _user_can_view_hospital_collection(user) -> bool:
    if getattr(user, "is_superuser", False):
        return True
    return "admin" in allowed_portals_for_user(user)


def _reception_collection_enabled(hospital_id) -> bool:
    if not hospital_id:
        return True
    try:
        return ReceptionPortalSettings.objects.get(hospital_id=hospital_id).reception_collection_enabled
    except ReceptionPortalSettings.DoesNotExist:
        return True


def _reception_collection_disabled_response():
    return Response(
        {
            "success": False,
            "errors": {
                "detail": ["Reception shift collection is disabled for this hospital."],
            },
        },
        status=status.HTTP_403_FORBIDDEN,
    )


def _default_hospital_collection_dates() -> tuple[date, date]:
    today = timezone.localdate()
    return today.replace(day=1), today


def _parse_collection_date_param(raw, default: date) -> date:
    if raw is None or str(raw).strip() == "":
        return default
    parsed = parse_date(str(raw).strip())
    return parsed or default


def _collection_payment_queryset(hospital_id, *, user_id=None, since=None, date_from=None, date_to=None):
    payment_qs = PaymentTransaction.objects.filter(
        hospital_id=hospital_id,
        status=PaymentTransaction.Status.SUCCESS,
        is_deleted=False,
    )
    if user_id:
        payment_qs = payment_qs.filter(collected_by_id=user_id)
    if since:
        payment_qs = payment_qs.filter(paid_at__gt=since)
    if date_from:
        payment_qs = payment_qs.filter(paid_at__date__gte=date_from)
    if date_to:
        payment_qs = payment_qs.filter(paid_at__date__lte=date_to)
    return payment_qs


def _collection_opd_queryset(hospital_id, *, user_id=None, since=None, date_from=None, date_to=None):
    opd_qs = OPDVisit.objects.filter(
        hospital_id=hospital_id,
        is_deleted=False,
        status__in=[OPDVisit.Status.WAITING, OPDVisit.Status.IN_PROGRESS, OPDVisit.Status.COMPLETED],
    )
    if user_id:
        opd_qs = opd_qs.filter(created_by_id=user_id)
    if since:
        opd_qs = opd_qs.filter(created_at__gt=since)
    if date_from:
        opd_qs = opd_qs.filter(created_at__date__gte=date_from)
    if date_to:
        opd_qs = opd_qs.filter(created_at__date__lte=date_to)
    return opd_qs


def _collection_expense_queryset(hospital_id, *, user_id=None, since=None, date_from=None, date_to=None, source=None):
    """Return active expenses. Pass source='collection' to restrict to those that affect the balance."""
    expense_qs = ExpenseTransaction.objects.filter(
        hospital_id=hospital_id,
        voided=False,
        status=ExpenseTransaction.Status.SUCCESS,
        is_deleted=False,
    )
    if source:
        expense_qs = expense_qs.filter(source=source)
    if user_id:
        expense_qs = expense_qs.filter(recorded_by_id=user_id)
    if since:
        expense_qs = expense_qs.filter(paid_at__gt=since)
    if date_from:
        expense_qs = expense_qs.filter(paid_at__date__gte=date_from)
    if date_to:
        expense_qs = expense_qs.filter(paid_at__date__lte=date_to)
    return expense_qs


def _build_collection_snapshot_for_scope(
    hospital_id,
    *,
    user_id=None,
    date_from=None,
    date_to=None,
    shift_reset_user=None,
    include_opening_cash=False,
):
    since = _last_handover_reset_at(shift_reset_user) if shift_reset_user else None

    payment_qs = _collection_payment_queryset(
        hospital_id, user_id=user_id, since=since, date_from=date_from, date_to=date_to
    )
    opd_qs = _collection_opd_queryset(hospital_id, user_id=user_id, since=since, date_from=date_from, date_to=date_to)
    expense_qs = _collection_expense_queryset(
        hospital_id, user_id=user_id, since=since, date_from=date_from, date_to=date_to,
        source=ExpenseTransaction.Source.COLLECTION,
    )

    payment_cash = (
        payment_qs.filter(payment_mode=PaymentTransaction.PaymentMode.CASH).aggregate(t=Sum("amount"))["t"] or _cash_zero()
    )
    payment_upi = (
        payment_qs.filter(payment_mode=PaymentTransaction.PaymentMode.UPI).aggregate(t=Sum("amount"))["t"] or _cash_zero()
    )
    payment_other = (
        payment_qs.exclude(payment_mode__in=[PaymentTransaction.PaymentMode.CASH, PaymentTransaction.PaymentMode.UPI]).aggregate(
            t=Sum("amount")
        )["t"]
        or _cash_zero()
    )

    opd_cash = opd_qs.filter(payment_mode=OPDVisit.PaymentMode.CASH).aggregate(t=Sum("amount"))["t"] or _cash_zero()
    opd_upi = opd_qs.filter(payment_mode=OPDVisit.PaymentMode.UPI).aggregate(t=Sum("amount"))["t"] or _cash_zero()
    opd_other = opd_qs.filter(payment_mode=OPDVisit.PaymentMode.OTHER).aggregate(t=Sum("amount"))["t"] or _cash_zero()

    expense_cash = (
        expense_qs.filter(payment_mode=ExpenseTransaction.PaymentMode.CASH).aggregate(t=Sum("total_amount"))["t"]
        or _cash_zero()
    )
    expense_upi = (
        expense_qs.filter(payment_mode=ExpenseTransaction.PaymentMode.UPI).aggregate(t=Sum("total_amount"))["t"]
        or _cash_zero()
    )
    expense_other = (
        expense_qs.exclude(
            payment_mode__in=[ExpenseTransaction.PaymentMode.CASH, ExpenseTransaction.PaymentMode.UPI]
        ).aggregate(t=Sum("total_amount"))["t"]
        or _cash_zero()
    )

    opening_cash = _cash_zero()
    if include_opening_cash and shift_reset_user:
        incoming_qs = CashHandover.objects.filter(
            hospital_id=hospital_id,
            to_user_id=shift_reset_user.id,
            status=CashHandover.Status.ACCEPTED,
        )
        if since:
            incoming_qs = incoming_qs.filter(accepted_at__gt=since)
        opening_cash = incoming_qs.aggregate(t=Sum("declared_cash_amount"))["t"] or _cash_zero()

    cash_total = _decimal_2(opening_cash + payment_cash + opd_cash - expense_cash)
    upi_total = _decimal_2(payment_upi + opd_upi - expense_upi)
    other_total = _decimal_2(payment_other + opd_other - expense_other)
    grand_total = _decimal_2(cash_total + upi_total + other_total)

    payload = {
        "date_from": date_from.isoformat() if date_from else None,
        "date_to": date_to.isoformat() if date_to else None,
        "opening_cash_in_hand": _format_money(opening_cash),
        "cash_total": _format_money(cash_total),
        "upi_total": _format_money(upi_total),
        "other_total": _format_money(other_total),
        "grand_total": _format_money(grand_total),
    }
    if shift_reset_user is not None:
        payload["since"] = since.isoformat() if since else None
    return payload


def _build_collection_entries_for_scope(
    hospital_id,
    *,
    user_id=None,
    date_from=None,
    date_to=None,
    shift_reset_user=None,
):
    since = _last_handover_reset_at(shift_reset_user) if shift_reset_user else None

    payment_qs = _collection_payment_queryset(
        hospital_id, user_id=user_id, since=since, date_from=date_from, date_to=date_to
    ).select_related("invoice__patient", "collected_by")
    opd_qs = _collection_opd_queryset(
        hospital_id, user_id=user_id, since=since, date_from=date_from, date_to=date_to
    ).select_related("patient", "created_by")
    expense_qs = _collection_expense_queryset(
        hospital_id, user_id=user_id, since=since, date_from=date_from, date_to=date_to,
    ).select_related("recorded_by")

    rows = []
    for p in payment_qs:
        patient = getattr(getattr(p, "invoice", None), "patient", None)
        patient_name = ""
        if patient:
            patient_name = f"{patient.first_name} {patient.last_name}".strip() or patient.uhid
        invoice = getattr(p, "invoice", None)
        entry_ref = p.receipt_no or p.transaction_reference or ""
        if invoice:
            entry_ref = entry_ref or invoice.invoice_no
        rows.append(
            {
                "id": str(p.id),
                "entry_type": "payment",
                "token_number": None,
                "queue_number": None,
                "patient_name": patient_name or "Patient",
                "amount": _format_money(p.amount),
                "payment_mode": p.payment_mode or "cash",
                "created_by_name": p.collected_by.full_name if p.collected_by_id else "",
                "entry_time": p.paid_at.isoformat() if p.paid_at else p.created_at.isoformat(),
                "entry_ref": entry_ref,
            }
        )

    for v in opd_qs:
        rows.append(
            {
                "id": str(v.id),
                "entry_type": "opd",
                "token_number": v.queue_number,
                "queue_number": v.queue_number,
                "patient_name": f"{v.patient.first_name} {v.patient.last_name}".strip() or v.patient.uhid,
                "amount": _format_money(v.amount or _cash_zero()),
                "payment_mode": v.payment_mode or "cash",
                "created_by_name": v.created_by.full_name if v.created_by_id else "",
                "entry_time": v.created_at.isoformat(),
                "entry_ref": "OPD",
            }
        )

    for expense in expense_qs:
        is_other_funds = getattr(expense, "source", None) == ExpenseTransaction.Source.OTHER_FUNDS
        rows.append(
            {
                "id": str(expense.id),
                "entry_type": "expense",
                "expense_source": expense.source if hasattr(expense, "source") else "collection",
                "token_number": None,
                "queue_number": None,
                "patient_name": expense.paid_to or "Expense",
                "amount": _format_money(_cash_zero() if is_other_funds else -_decimal_2(expense.total_amount)),
                "payment_mode": expense.payment_mode or "cash",
                "created_by_name": expense.recorded_by.full_name if expense.recorded_by_id else "",
                "entry_time": expense.paid_at.isoformat() if expense.paid_at else expense.created_at.isoformat(),
                "entry_ref": expense.slip_number or "",
            }
        )

    rows.sort(key=lambda x: x["entry_time"], reverse=True)
    return rows


def _build_collection_snapshot(user):
    return _build_collection_snapshot_for_scope(
        user.hospital_id,
        user_id=user.id,
        shift_reset_user=user,
        include_opening_cash=True,
    )


def _build_collection_entries(user):
    return _build_collection_entries_for_scope(
        user.hospital_id,
        user_id=user.id,
        shift_reset_user=user,
    )


def _serialize_handover(row: CashHandover):
    return {
        "id": str(row.id),
        "from_user_id": str(row.from_user_id),
        "from_user_name": row.from_user.full_name,
        "from_user_email": getattr(row.from_user, "email", "") or "",
        "to_user_id": str(row.to_user_id),
        "to_user_name": row.to_user.full_name,
        "system_cash_amount": _format_money(row.system_cash_amount),
        "system_upi_amount": _format_money(row.system_upi_amount),
        "system_other_amount": _format_money(row.system_other_amount),
        "declared_cash_amount": _format_money(row.declared_cash_amount),
        "status": row.status,
        "accepted_at": row.accepted_at.isoformat() if row.accepted_at else None,
        "notes": row.notes,
        "created_at": row.created_at.isoformat(),
    }


def _handover_event_datetime(row: CashHandover):
    if row.status == CashHandover.Status.ACCEPTED and row.accepted_at:
        return row.accepted_at
    return row.created_at


def _build_handover_collection_entries(hospital_id, date_from=None, date_to=None):
    """Shift handover rows for admin collection list (by handover event date)."""
    rows = []
    handovers = CashHandover.objects.filter(hospital_id=hospital_id).select_related("from_user", "to_user")
    for h in handovers:
        if h.status == CashHandover.Status.REJECTED:
            continue
        event_dt = _handover_event_datetime(h)
        event_date = timezone.localtime(event_dt).date()
        if date_from and event_date < date_from:
            continue
        if date_to and event_date > date_to:
            continue

        status_label = h.status
        verified_at = h.accepted_at if h.status == CashHandover.Status.ACCEPTED else None
        rows.append(
            {
                "id": f"handover-{h.id}",
                "entry_type": "handover",
                "token_number": None,
                "queue_number": None,
                "patient_name": "Shift handover",
                "amount": _format_money(h.declared_cash_amount),
                "payment_mode": "handover",
                "created_by_name": h.from_user.full_name or "",
                "entry_time": timezone.localtime(verified_at or h.created_at).isoformat(),
                "entry_ref": status_label,
                "handover_status": status_label,
                "handover_from_name": h.from_user.full_name or "",
                "handover_to_name": h.to_user.full_name or "",
                "handover_declared_cash": _format_money(h.declared_cash_amount),
                "handover_verified_at": timezone.localtime(verified_at).isoformat() if verified_at else None,
                "handover_requested_at": timezone.localtime(h.created_at).isoformat(),
                "handover_system_cash": _format_money(h.system_cash_amount),
                "handover_system_upi": _format_money(h.system_upi_amount),
                "handover_system_other": _format_money(h.system_other_amount),
            }
        )

    return rows


@api_view(["GET"])
@permission_classes([permissions.IsAuthenticated])
def handover_balance(request):
    if not request.user.hospital_id:
        return Response({"success": False, "errors": {"hospital": ["User is not linked to a hospital."]}}, status=400)

    if not _reception_collection_enabled(request.user.hospital_id):
        return _reception_collection_disabled_response()

    snapshot = _build_collection_snapshot(request.user)
    users = (
        User.objects.filter(hospital_id=request.user.hospital_id, is_active=True)
        .exclude(id=request.user.id)
        .order_by("first_name", "email")
    )
    pending_received = CashHandover.objects.filter(
        hospital_id=request.user.hospital_id,
        to_user_id=request.user.id,
        status=CashHandover.Status.PENDING,
    ).select_related("from_user", "to_user")

    data = {
        "collection": snapshot,
        "collection_entries": _build_collection_entries(request.user),
        "handover_recipients": [{"id": str(u.id), "name": u.full_name, "email": u.email} for u in users],
        "pending_received": [_serialize_handover(h) for h in pending_received],
    }
    return success_response(data=data)


@api_view(["GET"])
@permission_classes([permissions.IsAuthenticated])
def hospital_collection(request):
    if not request.user.hospital_id:
        return Response({"success": False, "errors": {"hospital": ["User is not linked to a hospital."]}}, status=400)

    if not _user_can_view_hospital_collection(request.user):
        return Response(
            {"success": False, "errors": {"detail": ["Only hospital admins can view hospital-wide collection."]}},
            status=status.HTTP_403_FORBIDDEN,
        )

    default_from, default_to = _default_hospital_collection_dates()
    date_from = _parse_collection_date_param(request.query_params.get("date_from"), default_from)
    date_to = _parse_collection_date_param(request.query_params.get("date_to"), default_to)
    if date_from > date_to:
        return Response(
            {"success": False, "errors": {"date_from": ["date_from cannot be after date_to."]}},
            status=status.HTTP_400_BAD_REQUEST,
        )

    hospital_id = request.user.hospital_id
    reception_collection_enabled = _reception_collection_enabled(hospital_id)
    payment_entries = _build_collection_entries_for_scope(
        hospital_id,
        date_from=date_from,
        date_to=date_to,
    )
    if reception_collection_enabled:
        pending_received = CashHandover.objects.filter(
            hospital_id=hospital_id,
            to_user_id=request.user.id,
            status=CashHandover.Status.PENDING,
        ).select_related("from_user", "to_user")
        collection_entries = _merge_collection_entries_sorted(
            payment_entries,
            _build_handover_collection_entries(hospital_id, date_from=date_from, date_to=date_to),
        )
        pending_payload = [_serialize_handover(h) for h in pending_received]
    else:
        collection_entries = payment_entries
        pending_payload = []

    data = {
        "reception_collection_enabled": reception_collection_enabled,
        "collection": _build_collection_snapshot_for_scope(
            hospital_id,
            date_from=date_from,
            date_to=date_to,
            include_opening_cash=False,
        ),
        "collection_entries": collection_entries,
        "pending_received": pending_payload,
    }
    return success_response(data=data)


def _merge_collection_entries_sorted(*entry_lists):
    rows = []
    for chunk in entry_lists:
        rows.extend(chunk)
    rows.sort(key=lambda x: x.get("entry_time") or "", reverse=True)
    return rows


@api_view(["POST"])
@permission_classes([permissions.IsAuthenticated])
def initiate_handover(request):
    if not request.user.hospital_id:
        return Response({"success": False, "errors": {"hospital": ["User is not linked to a hospital."]}}, status=400)

    if not _reception_collection_enabled(request.user.hospital_id):
        return _reception_collection_disabled_response()

    to_user_id = request.data.get("to_user_id")
    declared_cash_amount = _decimal_2(request.data.get("declared_cash_amount"))
    notes = str(request.data.get("notes") or "").strip()

    if declared_cash_amount < 0:
        return Response(
            {"success": False, "errors": {"declared_cash_amount": ["Amount cannot be negative."]}},
            status=status.HTTP_400_BAD_REQUEST,
        )
    if not to_user_id:
        return Response({"success": False, "errors": {"to_user_id": ["This field is required."]}}, status=400)

    try:
        to_user = User.objects.get(id=to_user_id, hospital_id=request.user.hospital_id, is_active=True)
    except User.DoesNotExist:
        return Response({"success": False, "errors": {"to_user_id": ["Recipient not found."]}}, status=404)

    if to_user.id == request.user.id:
        return Response({"success": False, "errors": {"to_user_id": ["Cannot handover to yourself."]}}, status=400)

    snapshot = _build_collection_snapshot(request.user)

    handover = CashHandover.objects.create(
        hospital_id=request.user.hospital_id,
        from_user_id=request.user.id,
        to_user=to_user,
        system_cash_amount=_decimal_2(snapshot["cash_total"]),
        system_upi_amount=_decimal_2(snapshot["upi_total"]),
        system_other_amount=_decimal_2(snapshot["other_total"]),
        declared_cash_amount=declared_cash_amount,
        status=CashHandover.Status.PENDING,
        notes=notes,
    )
    return success_response(data=_serialize_handover(handover), status_code=status.HTTP_201_CREATED)


@api_view(["GET"])
@permission_classes([permissions.IsAuthenticated])
def pending_handovers(request):
    if not request.user.hospital_id:
        return success_response(data=[])

    rows = (
        CashHandover.objects.filter(
            hospital_id=request.user.hospital_id,
            to_user_id=request.user.id,
            status=CashHandover.Status.PENDING,
        )
        .select_related("from_user", "to_user")
        .order_by("-created_at")
    )
    return success_response(data=[_serialize_handover(r) for r in rows])


@api_view(["POST"])
@permission_classes([permissions.IsAuthenticated])
@transaction.atomic
def verify_handover(request):
    if not request.user.hospital_id:
        return Response({"success": False, "errors": {"hospital": ["User is not linked to a hospital."]}}, status=400)

    if not _reception_collection_enabled(request.user.hospital_id):
        return _reception_collection_disabled_response()

    handover_id = request.data.get("handover_id")
    action = (request.data.get("action") or "").strip().lower()
    notes = str(request.data.get("notes") or "").strip()

    if action not in {"accept", "reject"}:
        return Response({"success": False, "errors": {"action": ["Use 'accept' or 'reject'."]}}, status=400)
    if not handover_id:
        return Response({"success": False, "errors": {"handover_id": ["This field is required."]}}, status=400)

    try:
        handover = CashHandover.objects.select_for_update().select_related("from_user", "to_user").get(
            id=handover_id, hospital_id=request.user.hospital_id
        )
    except CashHandover.DoesNotExist:
        return Response({"success": False, "errors": {"handover_id": ["Handover not found."]}}, status=404)

    if handover.to_user_id != request.user.id:
        return Response(
            {"success": False, "errors": {"handover_id": ["Only the designated recipient can verify this handover."]}},
            status=403,
        )
    if handover.status != CashHandover.Status.PENDING:
        return Response({"success": False, "errors": {"handover_id": ["This handover is already processed."]}}, status=400)

    if notes:
        handover.notes = notes

    if action == "accept":
        handover.status = CashHandover.Status.ACCEPTED
        handover.accepted_at = timezone.now()
    else:
        handover.status = CashHandover.Status.REJECTED

    handover.save(update_fields=["status", "accepted_at", "notes", "updated_at"])
    return success_response(data=_serialize_handover(handover))


@api_view(["GET", "PUT"])
@permission_classes([permissions.IsAuthenticated])
@transaction.atomic
def payment_quick_services(request):
    def _normalize_category(value) -> str:
        category = str(value or "").strip()
        return (category or "Custom")[:80]

    hospital_id = getattr(request.user, "hospital_id", None)
    if not hospital_id:
        return Response({"success": False, "detail": "Hospital context required."}, status=400)

    if request.method == "GET":
        service_rows = (
            PaymentQuickService.objects.filter(hospital_id=hospital_id, is_active=True)
            .order_by("category", "sort_order", "created_at")
        )
        category_rows = (
            PaymentQuickCategory.objects.filter(hospital_id=hospital_id, is_active=True)
            .order_by("sort_order", "created_at")
        )
        services = [{"label": r.label, "category": r.category or "Custom", "price": float(r.price)} for r in service_rows]
        categories = [r.name for r in category_rows]
        return success_response(data={"services": services, "categories": categories})

    services = request.data.get("services")
    if not isinstance(services, list):
        return Response({"success": False, "errors": {"services": ["Must be a list."]}}, status=400)
    category_names = request.data.get("categories")
    if category_names is not None and not isinstance(category_names, list):
        return Response({"success": False, "errors": {"categories": ["Must be a list."]}}, status=400)

    PaymentQuickService.objects.filter(hospital_id=hospital_id).delete()
    create_rows = []
    for idx, row in enumerate(services):
        label = str((row or {}).get("label") or "").strip()
        if not label:
            continue
        category = _normalize_category((row or {}).get("category"))
        try:
            price = Decimal(str((row or {}).get("price") or "0"))
        except Exception:
            price = Decimal("0")
        if price < 0:
            price = Decimal("0")
        create_rows.append(
            PaymentQuickService(
                hospital_id=hospital_id,
                label=label[:120],
                category=category,
                price=price,
                sort_order=idx,
                is_active=True,
            )
        )
    if create_rows:
        PaymentQuickService.objects.bulk_create(create_rows)

    normalized_categories = []
    if isinstance(category_names, list):
        for idx, name in enumerate(category_names):
            normalized = _normalize_category(name)
            if normalized and normalized not in normalized_categories:
                normalized_categories.append(normalized)
    for row in create_rows:
        normalized = _normalize_category(row.category)
        if normalized and normalized not in normalized_categories:
            normalized_categories.append(normalized)
    if "Custom" not in normalized_categories:
        normalized_categories.insert(0, "Custom")

    PaymentQuickCategory.objects.filter(hospital_id=hospital_id).delete()
    PaymentQuickCategory.objects.bulk_create(
        [
            PaymentQuickCategory(
                hospital_id=hospital_id,
                name=name,
                sort_order=idx,
                is_active=True,
            )
            for idx, name in enumerate(normalized_categories)
        ]
    )

    services_data = [{"label": r.label, "category": r.category or "Custom", "price": float(r.price)} for r in create_rows]
    return success_response(data={"services": services_data, "categories": normalized_categories})
