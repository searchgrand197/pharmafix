from decimal import Decimal

from django.contrib.auth import get_user_model
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from apps.inventory.models import Medicine, MedicineBatch, StockLedger, Unit
from apps.patients.models import Patient
from apps.pharmacy.models import Pharmacy, PharmacyInvoice, PharmacyInvoiceItem
from apps.pharmacy.services.return_summary_service import build_invoice_return_summary
from apps.shared.models import Hospital

User = get_user_model()


class PharmacyReturnSummaryTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.hospital = Hospital.objects.create(name="Summary Hospital", slug="summary-hospital")
        self.user = User.objects.create_user(
            email="pharm-summary@test.com",
            password="x",
            hospital=self.hospital,
            is_superuser=True,
        )
        self.client.force_authenticate(self.user)

        self.pharmacy = Pharmacy.objects.create(
            hospital=self.hospital,
            slug="summary-pharm",
            name="Summary Pharmacy",
            display_name="Summary Pharmacy",
            is_active=True,
        )
        self.unit = Unit.objects.create(pharmacy=self.pharmacy, code="TAB", name="Tablet")
        self.medicine = Medicine.objects.create(
            pharmacy=self.pharmacy,
            sku="MED-SUM",
            name="Paracetamol",
            unit=self.unit,
        )
        self.batch = MedicineBatch.objects.create(
            pharmacy=self.pharmacy,
            medicine=self.medicine,
            batch_no="BATCH-SUM",
            expiry_date=timezone.localdate().replace(year=timezone.localdate().year + 2),
            mrp=Decimal("10.00"),
            sale_rate=Decimal("8.00"),
        )
        self.patient = Patient.objects.create(
            hospital=self.hospital,
            uhid="UHID-SUM",
            first_name="Sum",
            last_name="Patient",
        )
        self.branch_header = {"HTTP_X_PHARMACY_BRANCH": str(self.pharmacy.id)}

        self.invoice = PharmacyInvoice.objects.create(
            pharmacy=self.pharmacy,
            patient=self.patient,
            invoice_no="PH-SUM-001",
            status=PharmacyInvoice.Status.FINALIZED,
            gst_enabled=False,
            grand_total=Decimal("80.00"),
            paid_amount=Decimal("80.00"),
            payment_method="cash",
            created_by=self.user,
        )
        PharmacyInvoiceItem.objects.create(
            invoice=self.invoice,
            medicine=self.medicine,
            batch=self.batch,
            qty=Decimal("10"),
            free_qty=Decimal("0"),
            mrp=Decimal("10.00"),
            rate=Decimal("8.00"),
            cgst_rate=Decimal("0"),
            sgst_rate=Decimal("0"),
            amount=Decimal("80.00"),
        )

    def _summary_url(self, invoice_id=None):
        return f"/api/v1/pharmacy/invoices/{invoice_id or self.invoice.id}/return-summary/"

    def test_no_returns(self):
        data = build_invoice_return_summary(self.invoice)
        self.assertFalse(data["has_returns"])
        self.assertEqual(data["returned_amount"], "0.00")
        self.assertEqual(data["new_amount"], "80.00")

        response = self.client.get(self._summary_url(), **self.branch_header)
        self.assertEqual(response.status_code, 200)
        payload = response.data.get("data") or response.data
        self.assertFalse(payload["has_returns"])

    def test_partial_return_amounts(self):
        StockLedger.objects.create(
            pharmacy_id=self.pharmacy.id,
            medicine_id=self.medicine.id,
            batch_id=self.batch.id,
            qty_change=Decimal("3"),
            reason=StockLedger.Reason.RETURN_IN,
            reference_type="pharmacy_edit",
            reference_id=str(self.invoice.id),
            created_by=self.user,
        )
        self.invoice.grand_total = Decimal("56.00")
        self.invoice.save(update_fields=["grand_total"])

        data = build_invoice_return_summary(self.invoice)
        self.assertTrue(data["has_returns"])
        self.assertEqual(data["returned_amount"], "24.00")  # 3 * 8
        self.assertEqual(data["new_amount"], "56.00")
        self.assertEqual(data["original_amount"], "80.00")
        self.assertEqual(len(data["sessions"]), 1)
        self.assertEqual(data["sessions"][0]["items"][0]["qty_returned"], "3.00")

    def test_cancelled_invoice_summary(self):
        StockLedger.objects.create(
            pharmacy_id=self.pharmacy.id,
            medicine_id=self.medicine.id,
            batch_id=self.batch.id,
            qty_change=Decimal("10"),
            reason=StockLedger.Reason.RETURN_IN,
            reference_type="pharmacy_cancel",
            reference_id=str(self.invoice.id),
            created_by=self.user,
        )
        self.invoice.status = PharmacyInvoice.Status.CANCELLED
        self.invoice.save(update_fields=["status"])

        data = build_invoice_return_summary(self.invoice)
        self.assertTrue(data["has_returns"])
        self.assertEqual(data["returned_amount"], "80.00")
        self.assertEqual(data["new_amount"], "0.00")
        self.assertEqual(data["original_amount"], "80.00")
