from decimal import Decimal

from django.contrib.auth import get_user_model
from django.test import TestCase
from django.utils import timezone

from apps.inventory.models import Medicine, MedicineBatch, Unit
from apps.patients.models import Patient
from apps.pharmacy.dashboard import _today_sales_block
from apps.pharmacy.models import (
    Pharmacy,
    PharmacyInvoice,
    PharmacyInvoiceItem,
    PharmacyPurchaseChallan,
    PharmacyPurchaseChallanLine,
)
from apps.shared.models import Hospital

User = get_user_model()


class DashboardMarginAfterBatchDeleteTests(TestCase):
    def setUp(self):
        self.hospital = Hospital.objects.create(name="Margin Hospital", slug="margin-hospital")
        self.user = User.objects.create_user(
            email="margin@test.com",
            password="x",
            hospital=self.hospital,
            is_superuser=True,
        )
        self.pharmacy = Pharmacy.objects.create(
            hospital=self.hospital,
            slug="margin-pharm",
            name="Margin Pharmacy",
            display_name="Margin Pharmacy",
            is_active=True,
        )
        self.unit = Unit.objects.create(pharmacy=self.pharmacy, code="TAB", name="Tablet")
        self.medicine = Medicine.objects.create(
            pharmacy=self.pharmacy,
            sku="MARGIN-001",
            name="Margin Med",
            unit=self.unit,
        )
        self.batch = MedicineBatch.objects.create(
            pharmacy=self.pharmacy,
            medicine=self.medicine,
            batch_no="MARGIN-B1",
            expiry_date=timezone.localdate().replace(year=timezone.localdate().year + 2),
            mrp=Decimal("100.00"),
            sale_rate=Decimal("80.00"),
            unit_cost=Decimal("50.00"),
        )
        self.patient = Patient.objects.create(
            hospital=self.hospital,
            uhid="MARGIN-UHID",
            first_name="Margin",
            last_name="Patient",
        )
        today = timezone.localdate()
        self.invoice = PharmacyInvoice.objects.create(
            pharmacy=self.pharmacy,
            patient=self.patient,
            invoice_no="PH-MARGIN-001",
            status=PharmacyInvoice.Status.FINALIZED,
            date=today,
            grand_total=Decimal("160.00"),
            paid_amount=Decimal("160.00"),
            payment_method="cash",
            created_by=self.user,
        )
        self.item = PharmacyInvoiceItem.objects.create(
            invoice=self.invoice,
            medicine=self.medicine,
            batch=self.batch,
            qty=Decimal("2"),
            mrp=Decimal("100.00"),
            rate=Decimal("80.00"),
            amount=Decimal("160.00"),
        )

    def _margin_block(self):
        return _today_sales_block(self.pharmacy.id, date_from=self.invoice.date, date_to=self.invoice.date)

    def test_margin_preserved_after_batch_delete(self):
        block = self._margin_block()
        self.assertEqual(block["total_margin"], 60.0)
        med = block["medicine_details"][0]
        self.assertEqual(med["name"], "Margin Med")
        self.assertEqual(med["total_qty"], 2.0)
        self.assertEqual(med["total_revenue"], 160.0)
        self.assertEqual(med["total_margin"], 60.0)

        PharmacyInvoiceItem.objects.filter(batch_id=self.batch.id).update(
            snapshot_batch_no=self.batch.batch_no,
            snapshot_expiry_date=self.batch.expiry_date,
            snapshot_unit_cost=self.batch.unit_cost,
            batch_id=None,
        )
        self.batch.delete()

        block_after = self._margin_block()
        self.assertEqual(block_after["total_margin"], 60.0)
        med_after = block_after["medicine_details"][0]
        self.assertEqual(med_after["total_margin"], 60.0)
        self.assertEqual(med_after["total_revenue"], 160.0)

    def test_medicine_revenue_includes_gst_when_invoice_gst_enabled(self):
        self.invoice.gst_enabled = True
        self.invoice.cgst = Decimal("9.60")
        self.invoice.sgst = Decimal("9.60")
        self.invoice.grand_total = Decimal("179.20")
        self.invoice.save(update_fields=["gst_enabled", "cgst", "sgst", "grand_total", "updated_at"])
        self.item.cgst_rate = Decimal("6.00")
        self.item.sgst_rate = Decimal("6.00")
        self.item.save(update_fields=["cgst_rate", "sgst_rate", "updated_at"])

        block = self._margin_block()
        self.assertEqual(block["total_margin"], 60.0)
        med = block["medicine_details"][0]
        self.assertEqual(med["total_qty"], 2.0)
        self.assertEqual(med["total_revenue"], 179.2)
        self.assertEqual(med["total_margin"], 60.0)

    def test_margin_from_challan_when_snapshot_missing(self):
        """Older deleted batches with no snapshot still resolve cost from purchase history."""
        self.batch.unit_cost = Decimal("0.00")
        self.batch.save(update_fields=["unit_cost", "updated_at"])
        self.item.snapshot_unit_cost = Decimal("0.00")
        self.item.save(update_fields=["snapshot_unit_cost", "updated_at"])

        challan = PharmacyPurchaseChallan.objects.create(
            pharmacy=self.pharmacy,
            supplier_name_snapshot="Test Supplier",
            challan_no="PC-001",
            purchase_date=timezone.localdate(),
            created_by=self.user,
        )
        PharmacyPurchaseChallanLine.objects.create(
            challan=challan,
            medicine=self.medicine,
            batch=self.batch,
            snapshot_batch_no=self.batch.batch_no,
            purchase_rate=Decimal("50.00"),
            base_qty=Decimal("100"),
        )

        PharmacyInvoiceItem.objects.filter(pk=self.item.pk).update(
            snapshot_batch_no=self.batch.batch_no,
            snapshot_unit_cost=Decimal("0.00"),
            batch_id=None,
        )
        self.batch.delete()

        block = self._margin_block()
        self.assertEqual(block["total_margin"], 60.0)
        self.assertEqual(block["medicine_details"][0]["total_margin"], 60.0)
