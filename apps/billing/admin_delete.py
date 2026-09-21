"""Admin helpers for hard-deleting soft-delete billing/payment rows."""

from __future__ import annotations

from django.db import transaction

from apps.billing.models import BillingInvoice, InvoiceItem
from apps.payments.models import PaymentTransaction, RefundLog


@transaction.atomic
def hard_delete_payment(payment: PaymentTransaction) -> None:
    """Permanently remove a payment and its refund logs (bypasses soft-delete)."""
    RefundLog.objects.filter(payment_id=payment.pk).delete()
    # Use all_objects in case row was already soft-deleted.
    row = PaymentTransaction.all_objects.filter(pk=payment.pk).first()
    if row is not None:
        row.hard_delete()


@transaction.atomic
def hard_delete_invoice(invoice: BillingInvoice) -> None:
    """
    Permanently remove an invoice and related payments/refunds/items.

    Soft-delete alone leaves PROTECT FKs in place, so admin delete of advance
    bills would otherwise hang on payment transactions that are only is_deleted=True.
    """
    RefundLog.objects.filter(invoice_id=invoice.pk).delete()
    payments = list(PaymentTransaction.all_objects.filter(invoice_id=invoice.pk))
    for payment in payments:
        hard_delete_payment(payment)
    InvoiceItem.objects.filter(invoice_id=invoice.pk).delete()
    row = BillingInvoice.all_objects.filter(pk=invoice.pk).first()
    if row is not None:
        row.hard_delete()
