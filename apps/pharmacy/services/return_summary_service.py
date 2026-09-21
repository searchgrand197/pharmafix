from __future__ import annotations

from collections import defaultdict
from decimal import Decimal
from typing import Any

from apps.inventory.models import MedicineBatch, StockLedger
from apps.pharmacy.calculations import split_gst_equally
from apps.pharmacy.models import PharmacyInvoice


def _money_str(value: Decimal) -> str:
    return str(value.quantize(Decimal("0.01")))


def _session_key(row: StockLedger) -> str:
    created = row.created_at.isoformat() if row.created_at else ""
    second_bucket = created[:19]
    return f"{row.reference_id}|{row.reference_type}|{second_bucket}"


def _rate_key(medicine_id, batch_id) -> str:
    return f"{medicine_id}:{batch_id}"


def _build_rate_map(invoice: PharmacyInvoice) -> dict[str, tuple[Decimal, Decimal, Decimal]]:
    rate_map: dict[str, tuple[Decimal, Decimal, Decimal]] = {}
    for item in invoice.items.select_related("batch", "medicine").all():
        batch_id = item.batch_id
        if batch_id is None:
            continue
        key = _rate_key(item.medicine_id, batch_id)
        rate_map[key] = (
            Decimal(item.rate or 0),
            Decimal(item.cgst_rate or 0),
            Decimal(item.sgst_rate or 0),
        )
    return rate_map


def _load_batch_fallbacks(
    rows: list[StockLedger],
    rate_map: dict[str, tuple[Decimal, Decimal, Decimal]],
    gst_enabled: bool,
) -> dict[str, tuple[Decimal, Decimal, Decimal]]:
    missing_batch_ids: set = set()
    for row in rows:
        key = _rate_key(row.medicine_id, row.batch_id)
        if key not in rate_map and row.batch_id:
            missing_batch_ids.add(row.batch_id)

    if not missing_batch_ids:
        return {}

    fallbacks: dict[str, tuple[Decimal, Decimal, Decimal]] = {}
    batches = MedicineBatch.objects.filter(id__in=missing_batch_ids).select_related("medicine")
    for batch in batches:
        if gst_enabled:
            cgst, sgst = split_gst_equally(Decimal(batch.medicine.gst_percent or 0))
        else:
            cgst, sgst = Decimal("0"), Decimal("0")
        fallbacks[_rate_key(batch.medicine_id, batch.id)] = (
            Decimal(batch.sale_rate or 0),
            cgst,
            sgst,
        )
    return fallbacks


def _line_refund(
    *,
    qty: Decimal,
    rate: Decimal,
    cgst_rate: Decimal,
    sgst_rate: Decimal,
    gst_enabled: bool,
) -> Decimal:
    if qty <= 0:
        return Decimal("0.00")
    base = (qty * rate).quantize(Decimal("0.01"))
    if not gst_enabled:
        return base
    cgst = (base * cgst_rate / Decimal("100")).quantize(Decimal("0.01"))
    sgst = (base * sgst_rate / Decimal("100")).quantize(Decimal("0.01"))
    return base + cgst + sgst


def _resolve_rates(
    row: StockLedger,
    rate_map: dict[str, tuple[Decimal, Decimal, Decimal]],
    batch_fallbacks: dict[str, tuple[Decimal, Decimal, Decimal]],
    gst_enabled: bool,
) -> tuple[Decimal, Decimal, Decimal]:
    key = _rate_key(row.medicine_id, row.batch_id)
    if key in rate_map:
        rate, cgst, sgst = rate_map[key]
    elif key in batch_fallbacks:
        rate, cgst, sgst = batch_fallbacks[key]
    else:
        rate, cgst, sgst = Decimal("0"), Decimal("0"), Decimal("0")

    if not gst_enabled:
        return rate, Decimal("0"), Decimal("0")
    return rate, cgst, sgst


def calc_ledger_row_refund(
    row: StockLedger,
    invoice: PharmacyInvoice,
    *,
    rate_map: dict[str, tuple[Decimal, Decimal, Decimal]] | None = None,
    batch_fallbacks: dict[str, tuple[Decimal, Decimal, Decimal]] | None = None,
) -> Decimal:
    """Per-line refund for a stock-ledger return row (same math as return summary)."""
    gst_enabled = bool(invoice.gst_enabled)
    if rate_map is None:
        rate_map = _build_rate_map(invoice)
    if batch_fallbacks is None:
        batch_fallbacks = _load_batch_fallbacks([row], rate_map, gst_enabled)
    qty = Decimal(row.qty_change or 0)
    rate, cgst_rate, sgst_rate = _resolve_rates(row, rate_map, batch_fallbacks, gst_enabled)
    return _line_refund(
        qty=qty,
        rate=rate,
        cgst_rate=cgst_rate,
        sgst_rate=sgst_rate,
        gst_enabled=gst_enabled,
    )


def build_invoice_return_summary(invoice: PharmacyInvoice) -> dict[str, Any]:
    rows = list(
        StockLedger.objects.filter(
            pharmacy_id=invoice.pharmacy_id,
            reason=StockLedger.Reason.RETURN_IN,
            reference_type__in=("pharmacy_edit", "pharmacy_cancel"),
            reference_id=str(invoice.id),
        )
        .select_related("medicine", "batch")
        .order_by("-created_at")
    )

    if not rows:
        return {
            "has_returns": False,
            "original_amount": _money_str(Decimal(invoice.grand_total or 0)),
            "returned_amount": "0.00",
            "new_amount": _money_str(
                Decimal("0") if invoice.status == PharmacyInvoice.Status.CANCELLED else Decimal(invoice.grand_total or 0)
            ),
            "sessions": [],
        }

    gst_enabled = bool(invoice.gst_enabled)
    rate_map = _build_rate_map(invoice)
    batch_fallbacks = _load_batch_fallbacks(rows, rate_map, gst_enabled)

    grouped: dict[str, list[StockLedger]] = defaultdict(list)
    for row in rows:
        grouped[_session_key(row)].append(row)

    sessions = []
    total_returned = Decimal("0.00")

    for key, group_rows in grouped.items():
        session_items = []
        session_refund = Decimal("0.00")
        returned_at = max((r.created_at for r in group_rows if r.created_at), default=None)
        reference_type = group_rows[0].reference_type if group_rows else ""

        for row in group_rows:
            qty = Decimal(row.qty_change or 0)
            rate, cgst_rate, sgst_rate = _resolve_rates(row, rate_map, batch_fallbacks, gst_enabled)
            line_refund = _line_refund(
                qty=qty,
                rate=rate,
                cgst_rate=cgst_rate,
                sgst_rate=sgst_rate,
                gst_enabled=gst_enabled,
            )
            session_refund += line_refund
            session_items.append(
                {
                    "medicine_name": getattr(row.medicine, "name", None) or str(row.medicine_id),
                    "batch_no": getattr(row.batch, "batch_no", None) or "—",
                    "qty_returned": _money_str(qty),
                    "line_refund": _money_str(line_refund),
                }
            )

        total_returned += session_refund
        sessions.append(
            {
                "key": key,
                "returned_at": returned_at.isoformat() if returned_at else None,
                "reference_type": reference_type,
                "refund_amount": _money_str(session_refund),
                "items": session_items,
            }
        )

    sessions.sort(key=lambda s: s.get("returned_at") or "", reverse=True)

    is_cancelled = invoice.status == PharmacyInvoice.Status.CANCELLED
    grand_total = Decimal(invoice.grand_total or 0)
    returned_amount = total_returned.quantize(Decimal("0.01"))
    new_amount = Decimal("0.00") if is_cancelled else grand_total
    original_amount = returned_amount if is_cancelled else (grand_total + returned_amount)

    return {
        "has_returns": True,
        "original_amount": _money_str(original_amount),
        "returned_amount": _money_str(returned_amount),
        "new_amount": _money_str(new_amount),
        "sessions": sessions,
    }
