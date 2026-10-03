"""
Pharmacy dashboard aggregation API.

GET /api/v1/pharmacy/dashboard/?gst=1&date_from=2026-04-01&date_to=2026-04-13

Returns:
  { sales, purchase, stock, customers, cash }
"""

from datetime import timedelta
from decimal import Decimal

from django.db.models import Sum
from django.utils import timezone
from django.utils.dateparse import parse_date
from rest_framework import permissions
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.inventory.models import MedicineBatch, StockLedger
from apps.pharmacy.calculations import calculate_sale_gst_split
from apps.pharmacy.margin_utils import resolve_invoice_item_unit_cost
from apps.pharmacy.models import PharmacyInvoice, PharmacyPurchaseChallan
from apps.shared.response import success_response

ZERO = Decimal("0")


def invoice_bill_discount(inv) -> Decimal:
    """
    Bill-level ("additional") discount on an invoice.

    Older bills never stored total_discount; for those it is recovered from the
    saved totals the same way the printed bill shows it.
    """
    saved = inv.total_discount or ZERO
    if saved > ZERO:
        return saved
    pre_discount = (inv.subtotal or ZERO) + (inv.cgst or ZERO) + (inv.sgst or ZERO)
    implied = (pre_discount + (inv.round_off or ZERO) - (inv.grand_total or ZERO)).quantize(Decimal("0.01"))
    # A few paise can differ from per-line rounding; that is not a discount.
    return implied if implied >= Decimal("0.05") else ZERO


def _parse_dates(params):
    raw_from = (params.get("date_from") or "").strip()
    raw_to = (params.get("date_to") or "").strip()
    date_to = parse_date(raw_to) if raw_to else timezone.now().date()
    date_from = parse_date(raw_from) if raw_from else date_to - timedelta(days=29)
    return date_from, date_to


def _prev_range(date_from, date_to):
    span = (date_to - date_from).days + 1
    return date_from - timedelta(days=span), date_from - timedelta(days=1)


def _sales_block(pharmacy_id, date_from, date_to, gst):
    qs = PharmacyInvoice.objects.filter(
        pharmacy_id=pharmacy_id,
        status=PharmacyInvoice.Status.FINALIZED,
    )
    current_qs = qs.filter(date__gte=date_from, date__lte=date_to)

    if gst:
        total = current_qs.aggregate(s=Sum("grand_total"))["s"] or ZERO
    else:
        total = current_qs.aggregate(s=Sum("subtotal"))["s"] or ZERO

    prev_from, prev_to = _prev_range(date_from, date_to)
    prev_qs = qs.filter(date__gte=prev_from, date__lte=prev_to)
    if gst:
        prev_total = prev_qs.aggregate(s=Sum("grand_total"))["s"] or ZERO
    else:
        prev_total = prev_qs.aggregate(s=Sum("subtotal"))["s"] or ZERO

    growth = None
    if prev_total:
        growth = float(((total - prev_total) / prev_total) * 100)

    trend_field = "grand_total" if gst else "subtotal"
    day_agg = (
        current_qs.values("date")
        .annotate(amount=Sum(trend_field))
        .order_by("date")
    )
    trend = [{"date": str(r["date"]), "amount": float(r["amount"])} for r in day_agg]

    return {"total": float(total), "growth": growth, "trend": trend}


def _purchase_block(pharmacy_id, date_from, date_to):
    qs = PharmacyPurchaseChallan.objects.filter(pharmacy_id=pharmacy_id)
    current_qs = qs.filter(purchase_date__gte=date_from, purchase_date__lte=date_to)
    total = current_qs.aggregate(s=Sum("total_amount"))["s"] or ZERO

    prev_from, prev_to = _prev_range(date_from, date_to)
    prev_total = qs.filter(
        purchase_date__gte=prev_from, purchase_date__lte=prev_to,
    ).aggregate(s=Sum("total_amount"))["s"] or ZERO

    growth = None
    if prev_total:
        growth = float(((total - prev_total) / prev_total) * 100)

    day_agg = (
        current_qs.values("purchase_date")
        .annotate(amount=Sum("total_amount"))
        .order_by("purchase_date")
    )
    trend = [{"date": str(r["purchase_date"]), "amount": float(r["amount"])} for r in day_agg]

    return {"total": float(total), "growth": growth, "trend": trend}


def _stock_block(pharmacy_id):
    batches = MedicineBatch.objects.filter(pharmacy_id=pharmacy_id)
    ledger = (
        StockLedger.objects.filter(pharmacy_id=pharmacy_id)
        .values("batch_id")
        .annotate(qty=Sum("qty_change"))
    )
    qty_map = {str(r["batch_id"]): r["qty"] or ZERO for r in ledger}

    purchase_value = ZERO
    mrp_value = ZERO
    sale_value = ZERO

    for b in batches.only("id", "unit_cost", "mrp", "sale_rate"):
        qty = qty_map.get(str(b.id), ZERO)
        if qty <= 0:
            continue
        purchase_value += qty * b.unit_cost
        mrp_value += qty * b.mrp
        sale_value += qty * b.sale_rate

    return {
        "purchase_value": float(purchase_value),
        "mrp_value": float(mrp_value),
        "sale_value": float(sale_value),
    }


def _customers_block(pharmacy_id, date_from, date_to, gst):
    qs = PharmacyInvoice.objects.filter(
        pharmacy_id=pharmacy_id,
        status=PharmacyInvoice.Status.FINALIZED,
        date__gte=date_from,
        date__lte=date_to,
    )
    patient_ids = set(qs.values_list("patient_id", flat=True))
    total = len(patient_ids)
    if not total:
        return {"total": 0, "new": 0, "repeat": 0, "avg_order_value": 0}

    returning = PharmacyInvoice.objects.filter(
        pharmacy_id=pharmacy_id,
        status=PharmacyInvoice.Status.FINALIZED,
        date__lt=date_from,
        patient_id__in=patient_ids,
    ).values_list("patient_id", flat=True).distinct()
    repeat_ids = set(returning)
    repeat_count = len(repeat_ids & patient_ids)
    new_count = total - repeat_count

    total_field = "grand_total" if gst else "subtotal"
    total_rev = qs.aggregate(s=Sum(total_field))["s"] or ZERO
    inv_count = qs.count() or 1
    avg_order = float(total_rev / inv_count)

    return {
        "total": total,
        "new": new_count,
        "repeat": repeat_count,
        "avg_order_value": round(avg_order, 2),
    }


def _cash_block(pharmacy_id, date_from, date_to):
    """Approximate cash breakdown from invoices (placeholder for real payment method tracking)."""
    qs = PharmacyInvoice.objects.filter(
        pharmacy_id=pharmacy_id,
        status=PharmacyInvoice.Status.FINALIZED,
        date__gte=date_from,
        date__lte=date_to,
    )
    total = float(qs.aggregate(s=Sum("grand_total"))["s"] or ZERO)
    return {
        "total": total,
        "cash": total,
        "online": 0,
        "cheque": 0,
    }


def _today_sales_block(pharmacy_id, date_from=None, date_to=None):
    """Finalized sale split by payment method for a selected date range."""
    default_date = timezone.now().date()
    start_date = date_from or default_date
    end_date = date_to or start_date
    if end_date < start_date:
        start_date, end_date = end_date, start_date
    qs = PharmacyInvoice.objects.filter(
        pharmacy_id=pharmacy_id,
        status=PharmacyInvoice.Status.FINALIZED,
        date__gte=start_date,
        date__lte=end_date,
    ).select_related("patient").prefetch_related("items__batch", "items__medicine")
    by_method = {
        "cash": {"amount": ZERO, "margin": ZERO},
        "upi": {"amount": ZERO, "margin": ZERO},
        "other": {"amount": ZERO, "margin": ZERO},
        "credit": {"amount": ZERO, "margin": ZERO},
    }
    invoice_rows = []
    total_margin = ZERO
    med_map = {}  # medicine_id -> {name, total_qty, total_revenue, total_margin}

    for inv in qs:
        method = (inv.payment_method or "").strip().lower()
        key = method if method in by_method else "other"
        inv_total = inv.grand_total or ZERO
        due = inv_total - (inv.paid_amount or ZERO)
        inv_margin = ZERO
        invoice_med_margin_deltas = {}
        invoice_med_revenue_deltas = {}

        bill_discount = invoice_bill_discount(inv)

        for it in inv.items.all():
            qty = it.qty or ZERO
            rate = it.rate or ZERO
            line_base = qty * rate
            line_revenue = line_base
            if inv.gst_enabled:
                cgst_amount, sgst_amount = calculate_sale_gst_split(
                    taxable_line_total=line_base,
                    cgst_rate=it.cgst_rate or ZERO,
                    sgst_rate=it.sgst_rate or ZERO,
                )
                line_revenue = line_base + cgst_amount + sgst_amount
            unit_cost = resolve_invoice_item_unit_cost(it)
            # Only count margin when a valid cost price has been recorded
            item_margin = (rate - unit_cost) * qty if unit_cost is not None else ZERO
            inv_margin += item_margin

            # Accumulate per-medicine totals (raw, pre-discount)
            mid = str(it.medicine_id) if it.medicine_id else "__unknown__"
            med_name = it.medicine.name if it.medicine_id and it.medicine else "Unknown"
            if mid not in med_map:
                med_map[mid] = {
                    "name": med_name,
                    "total_qty": ZERO,
                    "total_revenue": ZERO,
                    "total_margin": ZERO,
                }
            med_map[mid]["total_qty"] += qty
            med_map[mid]["total_revenue"] += line_revenue
            med_map[mid]["total_margin"] += item_margin
            invoice_med_margin_deltas[mid] = invoice_med_margin_deltas.get(mid, ZERO) + item_margin
            invoice_med_revenue_deltas[mid] = invoice_med_revenue_deltas.get(mid, ZERO) + line_revenue

        # The bill-level discount is money not collected while cost stays the same, so it
        # comes straight off the margin. Per-medicine figures share it by revenue.
        if bill_discount > ZERO:
            inv_margin = (inv_margin - bill_discount).quantize(Decimal("0.01"))
            inv_revenue = sum(invoice_med_revenue_deltas.values(), ZERO)
            if inv_revenue > ZERO:
                for mid, raw_revenue in invoice_med_revenue_deltas.items():
                    share = (bill_discount * raw_revenue / inv_revenue).quantize(Decimal("0.01"))
                    med_map[mid]["total_margin"] -= share
                    med_map[mid]["total_revenue"] -= share

        by_method[key]["amount"] += inv_total
        by_method[key]["margin"] += inv_margin
        total_margin += inv_margin
        patient_name = ""
        if inv.patient_id and inv.patient is not None:
            patient_name = f"{(inv.patient.first_name or '').strip()} {(inv.patient.last_name or '').strip()}".strip()
        if not patient_name:
            patient_name = (getattr(inv, "party_name_snapshot", "") or "").strip() or "—"

        invoice_rows.append(
            {
                "id": str(inv.id),
                "invoice_no": inv.invoice_no,
                "date": str(inv.date) if inv.date else None,
                "payment_method": key,
                "patient_name": patient_name,
                "grand_total": float(inv_total),
                "paid_amount": float(inv.paid_amount or ZERO),
                "due_amount": float(max(due, ZERO)),
                "margin": float(inv_margin),
            }
        )

    # Fetch current stock quantities for medicines sold in this period
    sold_med_ids = [k for k in med_map.keys() if k != "__unknown__"]
    stock_qs = (
        StockLedger.objects.filter(
            pharmacy_id=pharmacy_id,
            medicine_id__in=sold_med_ids,
        )
        .values("medicine_id")
        .annotate(qty=Sum("qty_change"))
    )
    stock_map = {str(r["medicine_id"]): float(r["qty"] or ZERO) for r in stock_qs}

    medicine_details = sorted(
        [
            {
                "medicine_id": k,
                "name": v["name"],
                "total_qty": float(v["total_qty"]),
                "total_revenue": float(v["total_revenue"]),
                "total_margin": float(v["total_margin"]),
                "left_stock": max(0.0, stock_map.get(k, 0.0)),
            }
            for k, v in med_map.items()
        ],
        key=lambda x: x["total_revenue"],
        reverse=True,
    )

    total = sum([by_method[k]["amount"] for k in by_method.keys()], ZERO)
    return {
        "date_from": str(start_date),
        "date_to": str(end_date),
        "total": float(total),
        "total_margin": float(total_margin),
        "cash": float(by_method["cash"]["amount"]),
        "cash_margin": float(by_method["cash"]["margin"]),
        "upi": float(by_method["upi"]["amount"]),
        "upi_margin": float(by_method["upi"]["margin"]),
        "other": float(by_method["other"]["amount"]),
        "other_margin": float(by_method["other"]["margin"]),
        "credit": float(by_method["credit"]["amount"]),
        "credit_margin": float(by_method["credit"]["margin"]),
        "details": invoice_rows,
        "medicine_details": medicine_details,
    }


class PharmacyDashboardView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request, *args, **kwargs):
        pharmacy = getattr(request, "pharmacy", None)
        if pharmacy is None:
            return Response(
                {"success": False, "detail": "Pharmacy branch context required."},
                status=400,
            )
        pharmacy_id = pharmacy.id
        date_from, date_to = _parse_dates(request.query_params)
        today_date_from = parse_date((request.query_params.get("today_date_from") or "").strip() or "")
        today_date_to = parse_date((request.query_params.get("today_date_to") or "").strip() or "")
        # Backward compatibility for older clients sending a single selected date.
        today_date = parse_date((request.query_params.get("today_date") or "").strip() or "")
        if today_date_from is None and today_date is not None:
            today_date_from = today_date
        if today_date_to is None and today_date is not None:
            today_date_to = today_date
        if today_date_from is None and today_date_to is None:
            today_date_from = timezone.now().date()
            today_date_to = today_date_from
        elif today_date_from is None:
            today_date_from = today_date_to
        elif today_date_to is None:
            today_date_to = today_date_from
        gst = request.query_params.get("gst", "1") == "1"

        data = {
            "sales": _sales_block(pharmacy_id, date_from, date_to, gst),
            "purchase": _purchase_block(pharmacy_id, date_from, date_to),
            "stock": _stock_block(pharmacy_id),
            "customers": _customers_block(pharmacy_id, date_from, date_to, gst),
            "cash": _cash_block(pharmacy_id, date_from, date_to),
            "today_sales": _today_sales_block(
                pharmacy_id,
                date_from=today_date_from,
                date_to=today_date_to,
            ),
            "today_total_for_tab": _today_sales_block(
                pharmacy_id,
                date_from=timezone.now().date(),
                date_to=timezone.now().date(),
            ).get("total", 0.0),
        }
        return success_response(data)

