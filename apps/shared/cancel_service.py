"""
Smart cancel service: determines if a document is the last in its series and,
if so, rolls back the sequence counter so the freed number is reused next time.

Rules:
- Last bill cancelled → voided=True (hidden from lists), sequence rolled back,
  unique document number released (tombstoned) so the next bill can reuse it.
- Non-last bill cancelled → voided=False (stays visible as cancelled), sequence unchanged.
"""

from __future__ import annotations

from django.db import transaction

from apps.pharmacy.invoice_number import _invoice_seq_from_number


def _void_tombstone(doc_id, *, max_len: int) -> str:
    return f"VOID-{doc_id}"[:max_len]


# ---------------------------------------------------------------------------
# Pharmacy invoices
# ---------------------------------------------------------------------------

def _pharmacy_channel(invoice) -> str:
    """Determine channel (b2c/b2b) from invoice: b2b if party is set, else b2c."""
    return "b2b" if invoice.party_id else "b2c"


def _pharmacy_channel_settings(pharmacy_id, channel: str):
    from apps.pharmacy.models import PharmacyOutletSettings

    try:
        return PharmacyOutletSettings.objects.get(pharmacy_id=pharmacy_id)
    except PharmacyOutletSettings.DoesNotExist:
        return None


def _pharmacy_max_seq(pharmacy_id, channel: str, *, settings_obj=None) -> tuple[str, str, int]:
    """Return (prefix, legacy_prefix_upper, max_seq) for a pharmacy channel."""
    from apps.pharmacy.models import PharmacyInvoice

    settings_obj = settings_obj or _pharmacy_channel_settings(pharmacy_id, channel)
    if not settings_obj:
        return "INV", "INV", 0

    prefix_attr = f"{channel}_invoice_prefix"
    next_attr = f"{channel}_invoice_next_number"
    prefix = (getattr(settings_obj, prefix_attr, None) or "INV").strip() or "INV"
    legacy_prefix_upper = prefix.upper()
    max_seq = max(int(getattr(settings_obj, next_attr, 1) or 1) - 1, 0)

    qs = PharmacyInvoice.objects.filter(pharmacy_id=pharmacy_id, voided=False)
    if channel == "b2b":
        qs = qs.filter(party_id__isnull=False)
    else:
        qs = qs.filter(party_id__isnull=True)

    for inv_no in qs.values_list("invoice_no", flat=True):
        seq = _invoice_seq_from_number(inv_no, prefix, legacy_prefix_upper)
        if seq is not None:
            max_seq = max(max_seq, seq)
    return prefix, legacy_prefix_upper, max_seq


def is_last_pharmacy_invoice(invoice) -> bool:
    """Return True if this invoice has the highest sequence in its channel."""
    ch = _pharmacy_channel(invoice)
    prefix, legacy_prefix_upper, max_seq = _pharmacy_max_seq(invoice.pharmacy_id, ch)
    if max_seq < 1:
        return False
    inv_seq = _invoice_seq_from_number(invoice.invoice_no, prefix, legacy_prefix_upper)
    return inv_seq is not None and inv_seq == max_seq


@transaction.atomic
def void_pharmacy_sequence(invoice) -> bool:
    """
    Roll back the pharmacy invoice sequence if this invoice is still the last
    (re-checked under lock). Returns True if rollback happened.
    """
    from apps.pharmacy.models import PharmacyOutletSettings

    ch = _pharmacy_channel(invoice)
    try:
        settings_obj = PharmacyOutletSettings.objects.select_for_update().get(
            pharmacy_id=invoice.pharmacy_id
        )
    except PharmacyOutletSettings.DoesNotExist:
        return False

    prefix, legacy_prefix_upper, max_seq = _pharmacy_max_seq(
        invoice.pharmacy_id, ch, settings_obj=settings_obj
    )
    if max_seq < 1:
        return False
    inv_seq = _invoice_seq_from_number(invoice.invoice_no, prefix, legacy_prefix_upper)
    if inv_seq is None or inv_seq != max_seq:
        return False

    next_attr = f"{ch}_invoice_next_number"
    setattr(settings_obj, next_attr, max(max_seq, 1))
    settings_obj.save(update_fields=[next_attr])
    return True


def release_pharmacy_invoice_number(invoice) -> None:
    """Tombstone invoice_no so the freed number can be reused."""
    if not invoice.invoice_no or str(invoice.invoice_no).startswith("VOID-"):
        return
    invoice.invoice_no = _void_tombstone(invoice.id, max_len=50)


# ---------------------------------------------------------------------------
# OPD visits
# ---------------------------------------------------------------------------

def is_last_opd_visit(visit) -> bool:
    """Return True if this visit's opd_no matches the current last in its year's sequence."""
    from apps.opd.models import OPDVisitSequence
    from apps.settings_management.document_number_service import render_document_number

    if not visit.opd_no or str(visit.opd_no).startswith("VOID-"):
        return False
    year = visit.created_at.year
    seq_obj = OPDVisitSequence.objects.filter(hospital=visit.hospital, year=year).first()
    if not seq_obj or seq_obj.last_seq < 1:
        return False
    rendered_last = render_document_number(visit.hospital, "opd", year, seq_obj.last_seq)
    return visit.opd_no == rendered_last


@transaction.atomic
def void_opd_sequence(visit) -> bool:
    """Roll back the OPD sequence if this visit is still the last (re-checked under lock)."""
    from apps.opd.models import OPDVisitSequence
    from apps.settings_management.document_number_service import render_document_number

    if not visit.opd_no or str(visit.opd_no).startswith("VOID-"):
        return False
    year = visit.created_at.year
    try:
        seq_obj = OPDVisitSequence.objects.select_for_update().get(
            hospital=visit.hospital, year=year
        )
    except OPDVisitSequence.DoesNotExist:
        return False
    if seq_obj.last_seq < 1:
        return False
    rendered_last = render_document_number(visit.hospital, "opd", year, seq_obj.last_seq)
    if visit.opd_no != rendered_last:
        return False
    seq_obj.last_seq = max(seq_obj.last_seq - 1, 0)
    seq_obj.save(update_fields=["last_seq", "updated_at"])
    return True


def release_opd_number(visit) -> None:
    if not visit.opd_no or str(visit.opd_no).startswith("VOID-"):
        return
    visit.opd_no = _void_tombstone(visit.id, max_len=50)


# ---------------------------------------------------------------------------
# Payment slips
# ---------------------------------------------------------------------------

def is_last_payment_slip(payment) -> bool:
    """Return True if this payment's slip_number matches the current last in its year's sequence."""
    from apps.payments.models import PaymentSlipSequence
    from apps.settings_management.document_number_service import render_document_number

    if not payment.slip_number or str(payment.slip_number).startswith("VOID-"):
        return False
    now = payment.paid_at
    year = now.year if now else None
    if not year:
        return False
    seq_obj = PaymentSlipSequence.objects.filter(hospital=payment.hospital, year=year).first()
    if not seq_obj or seq_obj.last_seq < 1:
        return False
    hospital = payment.hospital
    rendered_last = render_document_number(hospital, "payment_slip", year, seq_obj.last_seq)
    return payment.slip_number == rendered_last


@transaction.atomic
def void_payment_slip_sequence(payment) -> bool:
    """Roll back the payment slip sequence if this payment is still the last (re-checked under lock)."""
    from apps.payments.models import PaymentSlipSequence
    from apps.settings_management.document_number_service import render_document_number

    if not payment.slip_number or str(payment.slip_number).startswith("VOID-"):
        return False
    now = payment.paid_at
    year = now.year if now else None
    if not year:
        return False
    try:
        seq_obj = PaymentSlipSequence.objects.select_for_update().get(
            hospital=payment.hospital, year=year
        )
    except PaymentSlipSequence.DoesNotExist:
        return False
    if seq_obj.last_seq < 1:
        return False
    hospital = payment.hospital
    rendered_last = render_document_number(hospital, "payment_slip", year, seq_obj.last_seq)
    if payment.slip_number != rendered_last:
        return False
    seq_obj.last_seq = max(seq_obj.last_seq - 1, 0)
    seq_obj.save(update_fields=["last_seq", "updated_at"])
    return True


def release_payment_slip_number(payment) -> None:
    if not payment.slip_number or str(payment.slip_number).startswith("VOID-"):
        return
    payment.slip_number = _void_tombstone(payment.id, max_len=80)


# ---------------------------------------------------------------------------
# Expense vouchers
# ---------------------------------------------------------------------------

def is_last_expense_voucher(expense) -> bool:
    """Return True if this expense's slip_number matches the current last in its year's sequence."""
    from apps.expenses.models import ExpenseSlipSequence
    from apps.settings_management.document_number_service import render_document_number

    if not expense.slip_number or str(expense.slip_number).startswith("VOID-"):
        return False
    now = expense.paid_at
    year = now.year if now else None
    if not year:
        return False
    seq_obj = ExpenseSlipSequence.objects.filter(hospital=expense.hospital, year=year).first()
    if not seq_obj or seq_obj.last_seq < 1:
        return False
    hospital = expense.hospital
    rendered_last = render_document_number(hospital, "expense_voucher", year, seq_obj.last_seq)
    return expense.slip_number == rendered_last


@transaction.atomic
def void_expense_voucher_sequence(expense) -> bool:
    """Roll back the expense voucher sequence if this expense is still the last (re-checked under lock)."""
    from apps.expenses.models import ExpenseSlipSequence
    from apps.settings_management.document_number_service import render_document_number

    if not expense.slip_number or str(expense.slip_number).startswith("VOID-"):
        return False
    now = expense.paid_at
    year = now.year if now else None
    if not year:
        return False
    try:
        seq_obj = ExpenseSlipSequence.objects.select_for_update().get(
            hospital=expense.hospital, year=year
        )
    except ExpenseSlipSequence.DoesNotExist:
        return False
    if seq_obj.last_seq < 1:
        return False
    hospital = expense.hospital
    rendered_last = render_document_number(hospital, "expense_voucher", year, seq_obj.last_seq)
    if expense.slip_number != rendered_last:
        return False
    seq_obj.last_seq = max(seq_obj.last_seq - 1, 0)
    seq_obj.save(update_fields=["last_seq", "updated_at"])
    return True


def release_expense_voucher_number(expense) -> None:
    if not expense.slip_number or str(expense.slip_number).startswith("VOID-"):
        return
    expense.slip_number = _void_tombstone(expense.id, max_len=80)


# ---------------------------------------------------------------------------
# Billing invoices
# ---------------------------------------------------------------------------

def is_last_billing_invoice(invoice) -> bool:
    """Return True if this invoice's invoice_no matches the current last in its year's sequence."""
    from apps.billing.models import InvoiceNumberSequence
    from apps.settings_management.document_number_service import render_document_number

    if not invoice.invoice_no or str(invoice.invoice_no).startswith("VOID-"):
        return False
    year = invoice.created_at.year
    seq_obj = InvoiceNumberSequence.objects.filter(hospital=invoice.hospital, year=year).first()
    if not seq_obj or seq_obj.last_seq < 1:
        return False
    rendered_last = render_document_number(invoice.hospital, "receipt", year, seq_obj.last_seq)
    return invoice.invoice_no == rendered_last


@transaction.atomic
def void_billing_invoice_sequence(invoice) -> bool:
    """Roll back the billing invoice sequence if this invoice is still the last."""
    from apps.billing.models import InvoiceNumberSequence
    from apps.settings_management.document_number_service import render_document_number
    from apps.settings_management.models import ReceptionPortalSettings

    if not invoice.invoice_no or str(invoice.invoice_no).startswith("VOID-"):
        return False
    year = invoice.created_at.year
    try:
        seq_obj = InvoiceNumberSequence.objects.select_for_update().get(
            hospital=invoice.hospital, year=year
        )
    except InvoiceNumberSequence.DoesNotExist:
        return False
    if seq_obj.last_seq < 1:
        return False
    rendered_last = render_document_number(invoice.hospital, "receipt", year, seq_obj.last_seq)
    if invoice.invoice_no != rendered_last:
        return False
    new_last_seq = max(seq_obj.last_seq - 1, 0)
    seq_obj.last_seq = new_last_seq
    seq_obj.save(update_fields=["last_seq"])
    ReceptionPortalSettings.objects.filter(hospital=invoice.hospital).update(
        invoice_next_number=new_last_seq + 1
    )
    return True


def release_billing_invoice_number(invoice) -> None:
    if not invoice.invoice_no or str(invoice.invoice_no).startswith("VOID-"):
        return
    invoice.invoice_no = _void_tombstone(invoice.id, max_len=60)


def repair_stale_voided_payment_slip_numbers(*, hospital_id=None) -> int:
    """Tombstone slip numbers on voided payments that still hold live numbers."""
    from apps.payments.models import PaymentTransaction

    qs = PaymentTransaction.objects.filter(voided=True).exclude(slip_number__startswith="VOID-")
    if hospital_id:
        qs = qs.filter(hospital_id=hospital_id)
    repaired = 0
    for payment in qs.only("id", "slip_number"):
        payment.slip_number = _void_tombstone(payment.id, max_len=80)
        payment.save(update_fields=["slip_number", "updated_at"])
        repaired += 1
    return repaired


def apply_void_if_last(*, obj, is_last_fn, void_seq_fn, release_number_fn) -> bool:
    """
    If obj is the last in its series: roll back sequence, mark voided, release number.
    Returns True when the document was voided (hidden from lists).
    """
    if not is_last_fn(obj):
        return False
    void_seq_fn(obj)
    obj.voided = True
    release_number_fn(obj)
    return True
