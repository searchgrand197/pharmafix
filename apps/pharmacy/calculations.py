"""Pure GST / purchase & sale line math for pharmacy (Marg-style, shared API + tests)."""

from __future__ import annotations

import re
from decimal import ROUND_HALF_UP, Decimal
from typing import Literal, TypedDict

TWO_PLACES = Decimal("0.01")


def invoice_round_off(amount: Decimal) -> tuple[Decimal, Decimal]:
    """
    Retail bill round-off: settle in whole rupees, nearest rupee (0.50 rounds up).

    Returns (payable, round_off) where round_off = payable - amount, i.e. the paise
    adjustment shown on the bill. Mirrors computeInvoiceRoundOff() in the frontend.
    """
    exact = Decimal(amount or 0).quantize(TWO_PLACES)
    payable = exact.quantize(Decimal("1"), rounding=ROUND_HALF_UP).quantize(TWO_PLACES)
    return payable, (payable - exact).quantize(TWO_PLACES)


def _tablets_per_strip_from_pack_info(pack_info: str) -> int | None:
    """e.g. '1x10' or '1 x 10' → 10 tablets per strip (uses the number after x)."""
    if not pack_info or not str(pack_info).strip():
        return None
    m = re.match(r"^\s*(\d+)\s*[x×]\s*(\d+)\s*$", str(pack_info).strip(), re.I)
    if not m:
        return None
    return int(m.group(2))


def medicine_pack_size(medicine) -> int:
    """Base units per retail pack (strip/box); from unit_conversions or pack_info."""
    conv = getattr(medicine, "unit_conversions", None) or {}
    for key in ("strip", "STRIP", "box", "BOX", "carton", "CARTON"):
        v = conv.get(key)
        if v is not None:
            try:
                n = int(float(v))
                if n > 0:
                    return n
            except (TypeError, ValueError):
                continue
    t = _tablets_per_strip_from_pack_info(getattr(medicine, "pack_info", None) or "")
    return t if t and t > 0 else 1


class PurchaseLineAmounts(TypedDict):
    taxable_amount: Decimal
    gst_amount: Decimal
    final_amount: Decimal


def normalize_gst_type(value: str | None) -> Literal["inclusive", "exclusive"]:
    if not value:
        return "exclusive"
    v = str(value).strip().upper()
    if v == "INCLUSIVE":
        return "inclusive"
    return "exclusive"


def split_gst_equally(total_gst: Decimal) -> tuple[Decimal, Decimal]:
    """CGST + SGST = total GST, each half (last paise adjusted on SGST)."""
    total_gst = Decimal(total_gst).quantize(Decimal("0.01"))
    if total_gst <= 0:
        return Decimal("0.00"), Decimal("0.00")
    half = (total_gst / Decimal("2")).quantize(Decimal("0.01"))
    other = (total_gst - half).quantize(Decimal("0.01"))
    return half, other


def compute_marg_gst_on_base(
    *,
    base_amount: Decimal,
    discount: Decimal,
    gst_type: str,
    gst_percent: Decimal,
    no_gst: bool,
) -> PurchaseLineAmounts:
    """
    Marg order: GST on base_amount first; then final = result − discount.
    EXCLUSIVE: taxable = base, gst = taxable * pct/100, final = taxable + gst − discount.
    INCLUSIVE: taxable = base / (1 + pct/100), gst = base − taxable, final = base − discount.
    """
    base_amount = max(Decimal("0"), Decimal(base_amount))
    discount = max(Decimal("0"), Decimal(discount))
    pct = max(Decimal("0"), Decimal(gst_percent))
    gt = normalize_gst_type(gst_type)

    if no_gst or pct <= 0:
        final = (base_amount - discount).quantize(Decimal("0.01"))
        if final < 0:
            final = Decimal("0.00")
        return PurchaseLineAmounts(
            taxable_amount=final,
            gst_amount=Decimal("0.00"),
            final_amount=final,
        )

    if gt == "inclusive":
        divisor = Decimal("1") + (pct / Decimal("100"))
        taxable = (base_amount / divisor).quantize(Decimal("0.01"))
        gst_amount = (base_amount - taxable).quantize(Decimal("0.01"))
        final_amount = (base_amount - discount).quantize(Decimal("0.01"))
    else:
        taxable = base_amount.quantize(Decimal("0.01"))
        gst_amount = (taxable * pct / Decimal("100")).quantize(Decimal("0.01"))
        final_amount = (taxable + gst_amount - discount).quantize(Decimal("0.01"))

    if final_amount < 0:
        final_amount = Decimal("0.00")
    return PurchaseLineAmounts(
        taxable_amount=taxable,
        gst_amount=gst_amount,
        final_amount=final_amount,
    )


def calculate_marg_purchase_line_amounts(
    *,
    line_gross: Decimal,
    discount: Decimal,
    gst_type: str,
    gst_percent: Decimal,
    skip_gst: bool = False,
    no_gst: bool = False,
) -> PurchaseLineAmounts:
    """Purchase line: line_gross = strip/tablet rate basis total before GST/discount."""
    return compute_marg_gst_on_base(
        base_amount=line_gross,
        discount=discount,
        gst_type=gst_type,
        gst_percent=gst_percent,
        no_gst=bool(skip_gst or no_gst),
    )


def calculate_purchase_line_amounts(
    *,
    qty_packs: Decimal,
    purchase_rate: Decimal,
    discount: Decimal,
    gst_type: Literal["inclusive", "exclusive"],
    gst_percent: Decimal,
    skip_gst: bool,
) -> PurchaseLineAmounts:
    """Legacy: discount applied inside gross before GST (kept for existing tests)."""
    qty_packs = Decimal(qty_packs)
    purchase_rate = Decimal(purchase_rate)
    discount = Decimal(discount)
    gst_percent = Decimal(gst_percent)

    gross = qty_packs * purchase_rate - discount
    if gross < 0:
        gross = Decimal("0")

    if skip_gst or gst_percent <= 0:
        return PurchaseLineAmounts(
            taxable_amount=gross.quantize(Decimal("0.01")),
            gst_amount=Decimal("0.00"),
            final_amount=gross.quantize(Decimal("0.01")),
        )

    if gst_type == "inclusive":
        divisor = Decimal("1") + (gst_percent / Decimal("100"))
        taxable = (gross / divisor).quantize(Decimal("0.01"))
        gst_amount = (gross - taxable).quantize(Decimal("0.01"))
        return PurchaseLineAmounts(taxable_amount=taxable, gst_amount=gst_amount, final_amount=gross.quantize(Decimal("0.01")))

    taxable = gross.quantize(Decimal("0.01"))
    gst_amount = (taxable * gst_percent / Decimal("100")).quantize(Decimal("0.01"))
    final_amount = (taxable + gst_amount).quantize(Decimal("0.01"))
    return PurchaseLineAmounts(taxable_amount=taxable, gst_amount=gst_amount, final_amount=final_amount)


def calculate_sale_gst_split(*, taxable_line_total: Decimal, cgst_rate: Decimal, sgst_rate: Decimal) -> tuple[Decimal, Decimal]:
    """Given a pre-tax line total, return (cgst, sgst) amounts."""
    base = Decimal(taxable_line_total)
    cgst = (base * cgst_rate / Decimal("100")).quantize(Decimal("0.01"))
    sgst = (base * sgst_rate / Decimal("100")).quantize(Decimal("0.01"))
    return cgst, sgst
