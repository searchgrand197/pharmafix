from decimal import Decimal

from django.contrib.auth import get_user_model
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from apps.inventory.models import Medicine, MedicineBatch, Unit
from apps.patients.models import Patient
from apps.pharmacy.models import Pharmacy, PharmacyInvoice, PharmacyInvoiceItem, PharmacySupplier
from apps.shared.models import Hospital

User = get_user_model()


class PharmacyInvoiceRoundOffTests(TestCase):
    """Retail bills settle in whole rupees; party (B2B / GST) bills stay exact."""

    def setUp(self):
        self.client = APIClient()
        self.hospital = Hospital.objects.create(name="Round Off Hospital", slug="round-off-hospital")
        self.user = User.objects.create_user(
            email="pharm-round@test.com",
            password="x",
            hospital=self.hospital,
            is_superuser=True,
        )
        self.client.force_authenticate(self.user)
        self.pharmacy = Pharmacy.objects.create(
            hospital=self.hospital,
            slug="round-pharm",
            name="Round Pharmacy",
            display_name="Round Pharmacy",
            is_active=True,
        )
        self.unit = Unit.objects.create(pharmacy=self.pharmacy, code="TAB", name="Tablet")
        self.medicine = Medicine.objects.create(
            pharmacy=self.pharmacy,
            sku="MED-R",
            name="Round Med",
            unit=self.unit,
        )
        self.batch = MedicineBatch.objects.create(
            pharmacy=self.pharmacy,
            medicine=self.medicine,
            batch_no="BATCH-R",
            expiry_date=timezone.localdate().replace(year=timezone.localdate().year + 2),
            mrp=Decimal("100.00"),
            sale_rate=Decimal("60.20"),
        )
        self.patient = Patient.objects.create(
            hospital=self.hospital,
            uhid="UHID-ROUND-001",
            first_name="Round",
            last_name="Patient",
        )
        self.branch_header = {"HTTP_X_PHARMACY_BRANCH": str(self.pharmacy.id)}

    def _created_invoice(self, response):
        payload = response.data.get("data") or response.data
        return PharmacyInvoice.objects.get(pk=payload["id"])

    def _create_invoice(self, *, grand_total, party=None, patient=None, paid_amount=None):
        return self.client.post(
            "/api/v1/pharmacy/invoices/",
            {
                "patient": str(patient.id) if patient else None,
                "party": str(party.id) if party else None,
                "gst_enabled": False,
                "subtotal": grand_total,
                "cgst": "0.00",
                "sgst": "0.00",
                "grand_total": grand_total,
                "payment_method": "cash",
                "paid_amount": paid_amount or grand_total,
                "status": "finalized",
            },
            format="json",
            **self.branch_header,
        )

    def test_retail_bill_rounds_up_and_records_round_off(self):
        response = self._create_invoice(grand_total="120.60", patient=self.patient)
        self.assertEqual(response.status_code, 201, response.data)
        invoice = self._created_invoice(response)
        self.assertEqual(invoice.grand_total, Decimal("121.00"))
        self.assertEqual(invoice.round_off, Decimal("0.40"))
        self.assertEqual(invoice.paid_amount, Decimal("121.00"))

    def test_retail_bill_rounds_down_and_records_round_off(self):
        response = self._create_invoice(grand_total="120.40", patient=self.patient)
        self.assertEqual(response.status_code, 201, response.data)
        invoice = self._created_invoice(response)
        self.assertEqual(invoice.grand_total, Decimal("120.00"))
        self.assertEqual(invoice.round_off, Decimal("-0.40"))
        self.assertEqual(invoice.paid_amount, Decimal("120.00"))

    def test_credit_bill_keeps_full_amount_due(self):
        response = self.client.post(
            "/api/v1/pharmacy/invoices/",
            {
                "patient": str(self.patient.id),
                "gst_enabled": False,
                "subtotal": "120.60",
                "grand_total": "120.60",
                "payment_method": "credit",
                "paid_amount": "0.00",
                "status": "finalized",
            },
            format="json",
            **self.branch_header,
        )
        self.assertEqual(response.status_code, 201, response.data)
        invoice = self._created_invoice(response)
        self.assertEqual(invoice.grand_total, Decimal("121.00"))
        self.assertEqual(invoice.paid_amount, Decimal("0.00"))

    def test_party_bill_keeps_paise(self):
        party = PharmacySupplier.objects.create(pharmacy=self.pharmacy, name="Wholesale Party")
        response = self._create_invoice(grand_total="120.60", party=party)
        self.assertEqual(response.status_code, 201, response.data)
        invoice = self._created_invoice(response)
        self.assertEqual(invoice.grand_total, Decimal("120.60"))
        self.assertEqual(invoice.round_off, Decimal("0.00"))

    def test_edit_recomputes_round_off_from_new_lines(self):
        invoice = PharmacyInvoice.objects.create(
            pharmacy=self.pharmacy,
            patient=self.patient,
            invoice_no="PH-ROUND-EDIT-1",
            status=PharmacyInvoice.Status.DRAFT,
            gst_enabled=False,
            subtotal=Decimal("60.20"),
            grand_total=Decimal("60.00"),
            round_off=Decimal("-0.20"),
            paid_amount=Decimal("60.00"),
            payment_method="cash",
            created_by=self.user,
        )
        PharmacyInvoiceItem.objects.create(
            invoice=invoice,
            medicine=self.medicine,
            batch=self.batch,
            qty=Decimal("1"),
            mrp=Decimal("100.00"),
            rate=Decimal("60.20"),
            cgst_rate=Decimal("0"),
            sgst_rate=Decimal("0"),
            amount=Decimal("60.20"),
        )

        response = self.client.patch(
            f"/api/v1/pharmacy/invoices/{invoice.id}/update-full/",
            {
                "patient": {"first_name": "Round", "last_name": "Patient", "phone": ""},
                "invoice": {"payment_method": "cash", "paid_amount": "180.60"},
                "items": [
                    {
                        "medicine": str(self.medicine.id),
                        "batch": str(self.batch.id),
                        "qty": "3",
                        "free_qty": "0",
                        "mrp": "100.00",
                        "rate": "60.20",
                        "cgst_rate": "0",
                        "sgst_rate": "0",
                    }
                ],
            },
            format="json",
            **self.branch_header,
        )
        self.assertEqual(response.status_code, 200, response.data)
        invoice.refresh_from_db()
        self.assertEqual(invoice.grand_total, Decimal("181.00"))
        self.assertEqual(invoice.round_off, Decimal("0.40"))
        self.assertEqual(invoice.paid_amount, Decimal("181.00"))
