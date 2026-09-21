from decimal import Decimal

from django.contrib.auth import get_user_model
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from apps.expenses.models import ExpenseQuickCategory, ExpenseQuickService, ExpenseTransaction
from apps.shared.models import Hospital

User = get_user_model()


class ExpenseTransactionTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.hospital = Hospital.objects.create(name="Expense Hospital", slug="expense-hospital")
        self.other_hospital = Hospital.objects.create(name="Other Hospital", slug="other-hospital")
        self.user = User.objects.create_user(
            email="expense@test.com",
            password="x",
            hospital=self.hospital,
            is_superuser=True,
        )
        self.other_user = User.objects.create_user(
            email="other-expense@test.com",
            password="x",
            hospital=self.other_hospital,
            is_superuser=True,
        )
        self.client.force_authenticate(self.user)

    def _create_payload(self, **overrides):
        payload = {
            "paid_at": timezone.now().isoformat(),
            "paid_to": "Stationery Vendor",
            "payment_mode": "cash",
            "remarks": "Office supplies",
            "discount_amount": "0.00",
            "items": [
                {
                    "description": "Paper reams",
                    "quantity": "2",
                    "unit_price": "250.00",
                    "category": "Office",
                }
            ],
        }
        payload.update(overrides)
        return payload

    def test_create_computes_server_totals(self):
        response = self.client.post("/api/v1/expenses/", self._create_payload(), format="json")
        self.assertEqual(response.status_code, 201)
        data = response.data.get("data") or response.data
        self.assertEqual(data["total_amount"], "500.00")
        self.assertEqual(data["subtotal"], "500.00")
        self.assertTrue(data["slip_number"])
        self.assertEqual(len(data["items"]), 1)

        expense = ExpenseTransaction.objects.get(id=data["id"])
        self.assertEqual(expense.total_amount, Decimal("500.00"))

    def test_reject_empty_paid_to(self):
        response = self.client.post(
            "/api/v1/expenses/",
            self._create_payload(paid_to="   "),
            format="json",
        )
        self.assertEqual(response.status_code, 400)

    def test_reject_invalid_discount(self):
        response = self.client.post(
            "/api/v1/expenses/",
            self._create_payload(discount_amount="600.00"),
            format="json",
        )
        self.assertEqual(response.status_code, 400)

    def test_hospital_isolation(self):
        create_res = self.client.post("/api/v1/expenses/", self._create_payload(), format="json")
        expense_id = (create_res.data.get("data") or create_res.data)["id"]

        self.client.force_authenticate(self.other_user)
        detail_res = self.client.get(f"/api/v1/expenses/{expense_id}/")
        self.assertEqual(detail_res.status_code, 404)

    def test_void_excludes_from_active_list(self):
        create_res = self.client.post("/api/v1/expenses/", self._create_payload(), format="json")
        expense_id = (create_res.data.get("data") or create_res.data)["id"]

        void_res = self.client.post(
            f"/api/v1/expenses/{expense_id}/void/",
            {"void_reason": "Entered twice"},
            format="json",
        )
        self.assertEqual(void_res.status_code, 200)

        list_res = self.client.get("/api/v1/expenses/")
        rows = list_res.data.get("results") or list_res.data.get("data") or []
        self.assertFalse(any(str(row.get("id")) == str(expense_id) for row in rows))

        expense = ExpenseTransaction.objects.get(id=expense_id)
        self.assertTrue(expense.voided)
        self.assertEqual(expense.status, ExpenseTransaction.Status.CANCELLED)

    def test_void_requires_reason(self):
        create_res = self.client.post("/api/v1/expenses/", self._create_payload(), format="json")
        expense_id = (create_res.data.get("data") or create_res.data)["id"]
        void_res = self.client.post(f"/api/v1/expenses/{expense_id}/void/", {"void_reason": "  "}, format="json")
        self.assertEqual(void_res.status_code, 400)

    def test_void_rejects_already_cancelled(self):
        create_res = self.client.post("/api/v1/expenses/", self._create_payload(), format="json")
        expense_id = (create_res.data.get("data") or create_res.data)["id"]
        first = self.client.post(
            f"/api/v1/expenses/{expense_id}/void/",
            {"void_reason": "Duplicate entry"},
            format="json",
        )
        self.assertEqual(first.status_code, 200)
        second = self.client.post(
            f"/api/v1/expenses/{expense_id}/void/",
            {"void_reason": "Try again"},
            format="json",
        )
        self.assertEqual(second.status_code, 400)

    def test_quick_services_put_round_trip(self):
        put_res = self.client.put(
            "/api/v1/expenses/quick-services/",
            {
                "services": [{"label": "Tea", "price": 20, "category": "Refreshment"}],
                "categories": ["Refreshment", "Custom"],
            },
            format="json",
        )
        self.assertEqual(put_res.status_code, 200)

        get_res = self.client.get("/api/v1/expenses/quick-services/")
        payload = get_res.data.get("data") or get_res.data
        self.assertEqual(len(payload["services"]), 1)
        self.assertEqual(payload["services"][0]["label"], "Tea")
        self.assertIn("Refreshment", payload["categories"])

        self.assertEqual(ExpenseQuickService.objects.filter(hospital=self.hospital).count(), 1)
        self.assertEqual(ExpenseQuickCategory.objects.filter(hospital=self.hospital).count(), 2)

    def test_collection_summary_includes_expenses(self):
        self.client.post("/api/v1/expenses/", self._create_payload(), format="json")
        today = timezone.localdate().isoformat()
        summary_res = self.client.get(f"/api/v1/reports/collection-summary/?date_from={today}&date_to={today}")
        payload = summary_res.data.get("data") or summary_res.data
        self.assertEqual(payload["expenses_total"], "500.00")
        self.assertEqual(payload["net_total"], str(Decimal(payload["grand_total"]) - Decimal("500.00")))

    def test_report_list_excludes_cancelled_expenses(self):
        first_res = self.client.post("/api/v1/expenses/", self._create_payload(paid_to="Vendor A"), format="json")
        self.client.post("/api/v1/expenses/", self._create_payload(paid_to="Vendor B"), format="json")
        first_id = (first_res.data.get("data") or first_res.data)["id"]

        void_res = self.client.post(
            f"/api/v1/expenses/{first_id}/void/",
            {"void_reason": "Duplicate entry"},
            format="json",
        )
        self.assertEqual(void_res.status_code, 200)

        list_res = self.client.get("/api/v1/expenses/?status=success&voided=false")
        rows = list_res.data.get("results") or list_res.data.get("data") or []
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["paid_to"], "Vendor B")

    def test_collection_summary_excludes_cancelled_expenses(self):
        first_res = self.client.post("/api/v1/expenses/", self._create_payload(paid_to="Vendor A"), format="json")
        self.client.post("/api/v1/expenses/", self._create_payload(paid_to="Vendor B"), format="json")
        first_id = (first_res.data.get("data") or first_res.data)["id"]
        self.client.post(
            f"/api/v1/expenses/{first_id}/void/",
            {"void_reason": "Duplicate entry"},
            format="json",
        )

        today = timezone.localdate().isoformat()
        summary_res = self.client.get(f"/api/v1/reports/collection-summary/?date_from={today}&date_to={today}")
        payload = summary_res.data.get("data") or summary_res.data
        self.assertEqual(payload["expenses_total"], "500.00")
