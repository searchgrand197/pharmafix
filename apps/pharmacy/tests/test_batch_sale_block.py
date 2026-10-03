from decimal import Decimal

from django.contrib.auth import get_user_model
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from apps.inventory.models import Medicine, MedicineBatch, StockLedger, Unit
from apps.patients.models import Patient
from apps.pharmacy.models import Pharmacy, PharmacyInvoice, PharmacyInvoiceItem
from apps.shared.models import Hospital

User = get_user_model()


class BatchSaleVisibilityTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.hospital = Hospital.objects.create(name="Block Hospital", slug="block-hospital")
        self.user = User.objects.create_user(
            email="pharm-block@test.com",
            password="x",
            hospital=self.hospital,
            is_superuser=True,
        )
        self.client.force_authenticate(self.user)
        self.pharmacy = Pharmacy.objects.create(
            hospital=self.hospital,
            slug="block-pharm",
            name="Block Pharmacy",
            display_name="Block Pharmacy",
            is_active=True,
        )
        self.unit = Unit.objects.create(pharmacy=self.pharmacy, code="TAB", name="Tablet")
        self.medicine = Medicine.objects.create(
            pharmacy=self.pharmacy, sku="PARA-500", name="Paracetamol 500", unit=self.unit
        )
        today = timezone.localdate()
        # Sold-out batch expires earlier, so plain expiry sort would put it first.
        self.old_batch = self._batch("123", today.replace(year=today.year + 1))
        self.new_batch = self._batch("1234", today.replace(year=today.year + 2))
        self.patient = Patient.objects.create(
            hospital=self.hospital, uhid="UHID-BLOCK-001", first_name="Block", last_name="Patient"
        )
        self.branch_header = {"HTTP_X_PHARMACY_BRANCH": str(self.pharmacy.id)}
        self._ledger(self.old_batch, 100, StockLedger.Reason.STOCK_IN)
        self._ledger(self.old_batch, -100, StockLedger.Reason.DISPENSE_OUT)
        self._ledger(self.new_batch, 200, StockLedger.Reason.STOCK_IN)

    def _batch(self, batch_no, expiry, medicine=None):
        return MedicineBatch.objects.create(
            pharmacy=self.pharmacy,
            medicine=medicine or self.medicine,
            batch_no=batch_no,
            expiry_date=expiry,
            mrp=Decimal("10.00"),
            sale_rate=Decimal("8.00"),
        )

    def _ledger(self, batch, qty, reason):
        StockLedger.objects.create(
            pharmacy_id=self.pharmacy.id,
            medicine_id=batch.medicine_id,
            batch_id=batch.id,
            qty_change=Decimal(qty),
            reason=reason,
            reference_type="test",
            reference_id="setup",
            created_by=self.user,
        )

    def _search(self, q):
        res = self.client.get("/api/v1/medicines/search/", {"q": q}, **self.branch_header)
        self.assertEqual(res.status_code, 200)
        body = res.json()
        return body.get("data", body)

    def _draft_invoice(self):
        return PharmacyInvoice.objects.create(
            pharmacy=self.pharmacy,
            patient=self.patient,
            invoice_no=f"PH-BLOCK-{PharmacyInvoice.objects.count() + 1}",
            status=PharmacyInvoice.Status.DRAFT,
            created_by=self.user,
        )

    def _post_item(self, invoice, batch):
        return self.client.post(
            "/api/v1/pharmacy/items/",
            {
                "invoice": str(invoice.id),
                "medicine": str(self.medicine.id),
                "batch": str(batch.id),
                "qty": "2",
                "free_qty": "0",
                "mrp": "10.00",
                "rate": "8.00",
                "cgst_rate": "0",
                "sgst_rate": "0",
                "amount": "16.00",
            },
            format="json",
            **self.branch_header,
        )

    def test_search_puts_sellable_batches_before_zero_stock_and_blocked(self):
        blocked = self._batch("BLK-9", timezone.localdate().replace(year=timezone.localdate().year + 1))
        self._ledger(blocked, 50, StockLedger.Reason.STOCK_IN)
        blocked.is_sale_blocked = True
        blocked.sale_block_reason = "Recall"
        blocked.save()

        rows = self._search("para")
        self.assertEqual([r["batch"]["batch_no"] for r in rows][0], "1234")
        self.assertTrue(rows[0]["sellable"])
        hidden = {r["batch"]["batch_no"]: r for r in rows[1:]}
        self.assertEqual(set(hidden), {"123", "BLK-9"})
        self.assertFalse(hidden["123"]["sellable"])
        self.assertFalse(hidden["BLK-9"]["sellable"])
        self.assertTrue(hidden["BLK-9"]["batch"]["is_sale_blocked"])
        self.assertEqual(hidden["BLK-9"]["batch"]["sale_block_reason"], "Recall")

    def test_medicine_with_only_zero_stock_batches_still_appears(self):
        med = Medicine.objects.create(pharmacy=self.pharmacy, sku="DOLO-650", name="Dolo 650", unit=self.unit)
        self._batch("D1", timezone.localdate().replace(year=timezone.localdate().year + 1), medicine=med)

        rows = self._search("dolo")
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["batch"]["batch_no"], "D1")
        self.assertFalse(rows[0]["sellable"])

    def test_creating_invoice_item_on_blocked_batch_fails(self):
        self.new_batch.is_sale_blocked = True
        self.new_batch.sale_block_reason = "Damaged"
        self.new_batch.save()

        res = self._post_item(self._draft_invoice(), self.new_batch)
        self.assertEqual(res.status_code, 400)
        self.assertIn("blocked for sale", str(res.json()))

    def test_creating_invoice_item_on_unblocked_batch_succeeds(self):
        res = self._post_item(self._draft_invoice(), self.new_batch)
        self.assertEqual(res.status_code, 201, res.content)

    def test_return_against_blocked_batch_still_allowed_but_increase_rejected(self):
        invoice = PharmacyInvoice.objects.create(
            pharmacy=self.pharmacy,
            patient=self.patient,
            invoice_no="PH-BLOCK-FIN",
            status=PharmacyInvoice.Status.FINALIZED,
            grand_total=Decimal("80.00"),
            paid_amount=Decimal("80.00"),
            payment_method="cash",
            created_by=self.user,
        )
        PharmacyInvoiceItem.objects.create(
            invoice=invoice,
            medicine=self.medicine,
            batch=self.new_batch,
            qty=Decimal("10"),
            free_qty=Decimal("0"),
            mrp=Decimal("10.00"),
            rate=Decimal("8.00"),
            amount=Decimal("80.00"),
        )
        self._ledger(self.new_batch, -10, StockLedger.Reason.DISPENSE_OUT)
        self.new_batch.is_sale_blocked = True
        self.new_batch.save()

        def update(qty):
            return self.client.patch(
                f"/api/v1/pharmacy/invoices/{invoice.id}/update-full/",
                {
                    "patient": {"first_name": "Block", "last_name": "Patient", "phone": ""},
                    "invoice": {"payment_method": "cash", "paid_amount": "100.00"},
                    "items": [
                        {
                            "medicine": str(self.medicine.id),
                            "batch": str(self.new_batch.id),
                            "qty": str(qty),
                            "free_qty": "0",
                            "mrp": "10.00",
                            "rate": "8.00",
                            "cgst_rate": "0",
                            "sgst_rate": "0",
                        }
                    ],
                },
                format="json",
                **self.branch_header,
            )

        res = update(12)
        self.assertEqual(res.status_code, 400)
        self.assertIn("blocked for sale", str(res.json()))

        res = update(6)
        self.assertEqual(res.status_code, 200, res.content)
        self.assertTrue(
            StockLedger.objects.filter(
                batch_id=self.new_batch.id,
                reason=StockLedger.Reason.RETURN_IN,
                reference_type="pharmacy_edit",
                qty_change=Decimal("4"),
            ).exists()
        )

    def test_patch_batch_toggles_block_and_clears_reason_on_unblock(self):
        url = f"/api/v1/batches/{self.new_batch.id}/"
        res = self.client.patch(
            url, {"is_sale_blocked": True, "sale_block_reason": " Recall "}, format="json", **self.branch_header
        )
        self.assertEqual(res.status_code, 200, res.content)
        self.new_batch.refresh_from_db()
        self.assertTrue(self.new_batch.is_sale_blocked)
        self.assertEqual(self.new_batch.sale_block_reason, "Recall")

        res = self.client.patch(url, {"is_sale_blocked": False}, format="json", **self.branch_header)
        self.assertEqual(res.status_code, 200, res.content)
        self.new_batch.refresh_from_db()
        self.assertFalse(self.new_batch.is_sale_blocked)
        self.assertEqual(self.new_batch.sale_block_reason, "")
