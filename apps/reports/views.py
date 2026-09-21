from __future__ import annotations

from decimal import Decimal

from django.db.models import Q, Sum
from django.utils.dateparse import parse_date
from rest_framework.permissions import IsAuthenticated
from rest_framework.views import APIView

from apps.billing.collection_attribution import doctor_name_map
from apps.billing.models import BillingInvoice, CollectionAttribution
from apps.expenses.models import ExpenseTransaction
from apps.opd.models import OPDVisit
from apps.payments.models import PaymentTransaction
from apps.reports.doctor_revenue import build_doctor_revenue_report
from apps.shared.response import success_response


def _decimal(value) -> Decimal:
    if value is None:
        return Decimal("0.00")
    return Decimal(str(value))


class CollectionSummaryView(APIView):
    """Hospital-wide collection grouped by doctor attribution and Self (Hospital)."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        hospital_id = getattr(request.user, "hospital_id", None)
        if not hospital_id:
            return success_response(data={"hospital_self": {}, "doctors": [], "grand_total": "0.00"})

        date_from = parse_date(request.query_params.get("date_from") or "")
        date_to = parse_date(request.query_params.get("date_to") or "")
        doctor_filter = (request.query_params.get("attributed_doctor_user") or "").strip()

        opd_qs = OPDVisit.objects.filter(hospital_id=hospital_id).exclude(status=OPDVisit.Status.CANCELLED)
        if date_from:
            opd_qs = opd_qs.filter(visit_date__gte=date_from)
        if date_to:
            opd_qs = opd_qs.filter(visit_date__lte=date_to)

        pay_qs = PaymentTransaction.objects.filter(
            hospital_id=hospital_id,
            status=PaymentTransaction.Status.SUCCESS,
            is_deleted=False,
        )
        if date_from:
            pay_qs = pay_qs.filter(paid_at__date__gte=date_from)
        if date_to:
            pay_qs = pay_qs.filter(paid_at__date__lte=date_to)

        self_opd = _decimal(
            opd_qs.filter(doctor_user__isnull=True).aggregate(total=Sum("amount"))["total"]
        )
        self_payments = _decimal(
            pay_qs.filter(attribution_type=CollectionAttribution.HOSPITAL_SELF).aggregate(total=Sum("amount"))["total"]
        )

        doctor_buckets: dict[str, dict] = {}

        def ensure_doctor(uid: str | None):
            if not uid:
                return None
            key = str(uid)
            if key not in doctor_buckets:
                doctor_buckets[key] = {
                    "doctor_user_id": key,
                    "doctor_name": "",
                    "opd_fees": Decimal("0.00"),
                    "payments": Decimal("0.00"),
                    "total": Decimal("0.00"),
                }
            return doctor_buckets[key]

        for row in opd_qs.filter(doctor_user__isnull=False).values("doctor_user").annotate(total=Sum("amount")):
            bucket = ensure_doctor(row["doctor_user"])
            if bucket:
                bucket["opd_fees"] += _decimal(row["total"])

        for row in pay_qs.filter(attribution_type=CollectionAttribution.DOCTOR).values("attributed_doctor_user").annotate(
            total=Sum("amount")
        ):
            bucket = ensure_doctor(row["attributed_doctor_user"])
            if bucket:
                bucket["payments"] += _decimal(row["total"])

        if doctor_filter:
            doctor_buckets = {k: v for k, v in doctor_buckets.items() if k == doctor_filter}

        name_map = doctor_name_map(hospital_id, set(doctor_buckets.keys()))
        doctors_out = []
        doctors_grand = Decimal("0.00")
        for key, bucket in sorted(doctor_buckets.items(), key=lambda item: name_map.get(item[0], "").lower()):
            bucket["doctor_name"] = name_map.get(key, "Doctor")
            bucket["total"] = bucket["opd_fees"] + bucket["payments"]
            doctors_grand += bucket["total"]
            doctors_out.append(
                {
                    "doctor_user_id": bucket["doctor_user_id"],
                    "doctor_name": bucket["doctor_name"],
                    "opd_fees": str(bucket["opd_fees"]),
                    "payments": str(bucket["payments"]),
                    "total": str(bucket["total"]),
                }
            )

        hospital_self_total = self_opd + self_payments
        hospital_self = {
            "opd_fees": str(self_opd),
            "payments": str(self_payments),
            "total": str(hospital_self_total),
        }

        if not doctor_filter:
            grand_total = hospital_self_total + doctors_grand
        else:
            grand_total = doctors_grand

        expense_qs = ExpenseTransaction.objects.filter(
            hospital_id=hospital_id,
            voided=False,
            status=ExpenseTransaction.Status.SUCCESS,
            source=ExpenseTransaction.Source.COLLECTION,
            is_deleted=False,
        )
        if date_from:
            expense_qs = expense_qs.filter(paid_at__date__gte=date_from)
        if date_to:
            expense_qs = expense_qs.filter(paid_at__date__lte=date_to)
        expenses_total = _decimal(expense_qs.aggregate(total=Sum("total_amount"))["total"])
        net_total = grand_total - expenses_total

        return success_response(
            data={
                "hospital_self": hospital_self if not doctor_filter else {"opd_fees": "0.00", "payments": "0.00", "total": "0.00"},
                "doctors": doctors_out,
                "grand_total": f"{grand_total:.2f}",
                "expenses_total": f"{expenses_total:.2f}",
                "net_total": f"{net_total:.2f}",
                "date_from": date_from.isoformat() if date_from else None,
                "date_to": date_to.isoformat() if date_to else None,
            }
        )


class DoctorRevenueView(APIView):
    """Per-doctor OPD / IPD / payment-slip revenue with daily breakdown for print."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        hospital_id = getattr(request.user, "hospital_id", None)
        if not hospital_id:
            return success_response(
                data={
                    "date_from": None,
                    "date_to": None,
                    "slip_category": None,
                    "doctors": [],
                    "hospital_self": None,
                    "grand_total": "0.00",
                }
            )

        date_from = parse_date(request.query_params.get("date_from") or "")
        date_to = parse_date(request.query_params.get("date_to") or "")
        doctor_filter = (request.query_params.get("attributed_doctor_user") or "").strip()
        slip_category = (request.query_params.get("slip_category") or "").strip()

        data = build_doctor_revenue_report(
            hospital_id=hospital_id,
            date_from=date_from,
            date_to=date_to,
            doctor_filter=doctor_filter,
            slip_category=slip_category,
        )
        return success_response(data=data)
