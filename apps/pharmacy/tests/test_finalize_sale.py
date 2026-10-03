import io
from decimal import Decimal

from django.contrib.auth import get_user_model
from django.core.management import call_command
from django.db.models import Sum
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from apps.inventory.models import Medicine, MedicineBatch, StockLedger, Unit
from apps.patients.models import Patient
from apps.pharmacy.dashboard import _today_sales_block
from apps.pharmacy.models import Pharmacy, PharmacyInvoice, PharmacyInvoiceItem
from apps.shared.models import Hospital

User = get_user_model()


class FinalizeSaleTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.hospital = Hospital.objects.create(name="Sale Hospital", slug="sale-hospital")
        self.user = User.objects.create_user(
            email="sale@test.com", password="x", hospital=self.hospital, is_superuser=True
        )
        self.client.force_authenticate(self.user)
        self.pharmacy = Pharmacy.objects.create(
            hospital=self.hospital, slug="sale-pharm", name="Sale Pharmacy", display_name="Sale Pharmacy", is_active=True
        )
        unit = Unit.objects.create(pharmacy=self.pharmacy, code="TAB", name="Tablet")
        expiry = timezone.localdate().replace(year=timezone.localdate().year + 2)
        self.batches = []
        for code, cost in (("A", "5.00"), ("B", "6.00"), ("PCM", "1.00")):
            med = Medicine.objects.create(pharmacy=self.pharmacy, sku=f"MED-{code}", name=f"Medicine {code}", unit=unit)
            self.batches.append(
                MedicineBatch.objects.create(
                    pharmacy=self.pharmacy,
                    medicine=med,
                    batch_no=f"B-{code}",
                    expiry_date=expiry,
                    mrp=Decimal("10.00"),
                    sale_rate=Decimal("10.00"),
                    unit_cost=Decimal(cost),
                )
            )
        self.patient = Patient.objects.create(hospital=self.hospital, uhid="UHID-SALE", first_name="Sale", last_name="P")
        self.branch = {"HTTP_X_PHARMACY_BRANCH": str(self.pharmacy.id)}

    def _stock_in(self, batch, qty):
        StockLedger.objects.create(
            pharmacy_id=self.pharmacy.id,
            medicine_id=batch.medicine_id,
            batch_id=batch.id,
            qty_change=Decimal(qty),
            reason=StockLedger.Reason.STOCK_IN,
            reference_type="test",
            reference_id="setup",
            created_by=self.user,
        )

    def _available(self, batch):
        s = StockLedger.objects.filter(batch_id=batch.id).aggregate(s=Sum("qty_change"))["s"]
        return s or Decimal("0")

    def _line(self, batch, qty):
        return {
            "medicine": str(batch.medicine_id),
            "batch": str(batch.id),
            "qty": str(qty),
            "free_qty": "0",
            "mrp": "10.00",
            "rate": "10.00",
            "amount": f"{Decimal(qty) * 10:.2f}",
            "cgst_rate": "0",
            "sgst_rate": "0",
        }

    def _finalize(self, lines, **extra):
        total = sum(Decimal(l["amount"]) for l in lines)
        body = {
            "patient": str(self.patient.id),
            "gst_enabled": False,
            "subtotal": f"{total:.2f}",
            "cgst": "0",
            "sgst": "0",
            "round_off": "0",
            "grand_total": f"{total:.2f}",
            "payment_method": "cash",
            "paid_amount": f"{total:.2f}",
            "items": lines,
        }
        body.update(extra)
        return self.client.post("/api/v1/pharmacy/invoices/finalize-sale/", body, format="json", **self.branch)

    def test_shortage_on_third_line_saves_nothing(self):
        a, b, pcm = self.batches
        self._stock_in(a, 50)
        self._stock_in(b, 50)
        self._stock_in(pcm, 5)

        res = self._finalize([self._line(a, 10), self._line(b, 10), self._line(pcm, 20)])

        self.assertEqual(res.status_code, 400, res.content)
        self.assertIn("Line 3", res.json()["errors"]["detail"])
        self.assertEqual(self._available(a), Decimal("50"))
        self.assertEqual(self._available(b), Decimal("50"))
        self.assertEqual(self._available(pcm), Decimal("5"))
        self.assertFalse(PharmacyInvoice.objects.exists())
        self.assertFalse(PharmacyInvoiceItem.objects.exists())

    def test_success_deducts_all_lines_and_stores_bill_discount(self):
        a, b, _ = self.batches
        self._stock_in(a, 50)
        self._stock_in(b, 50)

        res = self._finalize(
            [self._line(a, 5), self._line(b, 5)],
            total_discount="10.00",
            grand_total="90.00",
            paid_amount="90.00",
        )

        self.assertEqual(res.status_code, 201, res.content)
        data = res.json()["data"]
        self.assertEqual(len(data["items"]), 2)
        self.assertEqual(Decimal(data["total_discount"]), Decimal("10.00"))
        self.assertEqual(Decimal(data["grand_total"]), Decimal("90.00"))
        self.assertEqual(self._available(a), Decimal("45"))
        self.assertEqual(self._available(b), Decimal("45"))

    def test_dashboard_margin_reduced_by_bill_discount(self):
        a, b, _ = self.batches
        self._stock_in(a, 50)
        self._stock_in(b, 50)
        # 5×(10−5) + 5×(10−6) = 45 margin before the 10% bill discount on 100.
        res = self._finalize(
            [self._line(a, 5), self._line(b, 5)],
            total_discount="10.00",
            grand_total="90.00",
            paid_amount="90.00",
        )
        self.assertEqual(res.status_code, 201, res.content)
        today = timezone.localdate()
        block = _today_sales_block(self.pharmacy.id, date_from=today, date_to=today)
        self.assertEqual(block["total"], 90.0)
        self.assertEqual(block["total_margin"], 35.0)
        self.assertEqual(block["details"][0]["margin"], 35.0)
        self.assertAlmostEqual(sum(m["total_margin"] for m in block["medicine_details"]), 35.0, places=2)

    def test_dashboard_recovers_unsaved_discount_on_old_bills(self):
        a, _, _ = self.batches
        inv = PharmacyInvoice.objects.create(
            pharmacy=self.pharmacy,
            patient=self.patient,
            invoice_no="OLD-1",
            status=PharmacyInvoice.Status.FINALIZED,
            date=timezone.localdate(),
            subtotal=Decimal("100.00"),
            grand_total=Decimal("90.00"),
            paid_amount=Decimal("90.00"),
            created_by=self.user,
        )
        PharmacyInvoiceItem.objects.create(
            invoice=inv, medicine=a.medicine, batch=a, qty=Decimal("10"), mrp=Decimal("10"), rate=Decimal("10"), amount=Decimal("100")
        )
        block = _today_sales_block(self.pharmacy.id, date_from=inv.date, date_to=inv.date)
        self.assertEqual(block["total_margin"], 40.0)

    def test_deleting_finalized_invoice_returns_stock(self):
        a, _, _ = self.batches
        self._stock_in(a, 20)
        res = self._finalize([self._line(a, 5)])
        self.assertEqual(res.status_code, 201, res.content)
        self.assertEqual(self._available(a), Decimal("15"))

        inv_id = res.json()["data"]["id"]
        del_res = self.client.delete(f"/api/v1/pharmacy/invoices/{inv_id}/", **self.branch)
        self.assertIn(del_res.status_code, (200, 204), del_res.content)
        self.assertEqual(self._available(a), Decimal("20"))

    def test_detail_visible_when_branch_hospital_differs_from_user(self):
        other = Hospital.objects.create(name="Other", slug="other-hospital")
        self.pharmacy.hospital = other
        self.pharmacy.save(update_fields=["hospital"])
        a, _, _ = self.batches
        self._stock_in(a, 20)
        res = self._finalize([self._line(a, 1)])
        self.assertEqual(res.status_code, 201, res.content)
        inv_id = res.json()["data"]["id"]

        detail = self.client.get(f"/api/v1/pharmacy/invoices/{inv_id}/", **self.branch)
        self.assertEqual(detail.status_code, 200, detail.content)
        summary = self.client.get(f"/api/v1/pharmacy/invoices/{inv_id}/return-summary/", **self.branch)
        self.assertEqual(summary.status_code, 200, summary.content)

    def test_restore_orphan_sale_stock_command(self):
        a, b, _ = self.batches
        self._stock_in(a, 30)
        self._stock_in(b, 30)
        ghost = "00000000-0000-0000-0000-00000000abcd"
        for batch, qty in ((a, 4), (b, 6)):
            StockLedger.objects.create(
                pharmacy_id=self.pharmacy.id,
                medicine_id=batch.medicine_id,
                batch_id=batch.id,
                qty_change=-Decimal(qty),
                reason=StockLedger.Reason.DISPENSE_OUT,
                reference_type="pharmacy_dispense",
                reference_id=ghost,
                created_by=self.user,
            )

        call_command("restore_orphan_sale_stock", stdout=io.StringIO())
        self.assertEqual(self._available(a), Decimal("26"))

        call_command("restore_orphan_sale_stock", "--apply", stdout=io.StringIO())
        self.assertEqual(self._available(a), Decimal("30"))
        self.assertEqual(self._available(b), Decimal("30"))

        call_command("restore_orphan_sale_stock", "--apply", stdout=io.StringIO())
        self.assertEqual(self._available(a), Decimal("30"))
