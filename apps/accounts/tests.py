from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.test import APIClient

from apps.shared.models import Hospital

User = get_user_model()


class EmailCaseHandlingTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.hospital = Hospital.objects.create(name="Email Case Hospital", slug="email-case-hospital")
        self.admin = User.objects.create_user(
            email="admin@hospital.test",
            password="AdminPass123!",
            hospital=self.hospital,
            is_superuser=True,
        )
        self.client.force_authenticate(self.admin)

    def test_create_user_stores_email_lowercase(self):
        user = User.objects.create_user(
            email="Raviv23@gmail.com",
            password="Secret123!",
            hospital=self.hospital,
        )
        self.assertEqual(user.email, "raviv23@gmail.com")

    def test_login_accepts_lowercase_when_db_has_mixed_case(self):
        legacy_user = User(
            email="Raviv23@gmail.com",
            hospital=self.hospital,
            is_active=True,
        )
        legacy_user.set_password("Secret123!")
        legacy_user.save()

        response = self.client.post(
            "/api/v1/auth/login/",
            {"email": "raviv23@gmail.com", "password": "Secret123!"},
            format="json",
        )
        self.assertEqual(response.status_code, 200, response.content)
        payload = response.json()
        self.assertTrue(payload.get("access") or payload.get("data", {}).get("access"))

    def test_staff_create_returns_lowercase_login_email(self):
        response = self.client.post(
            "/api/v1/staff/",
            {
                "first_name": "Raviv",
                "last_name": "Test",
                "email": "Raviv23@gmail.com",
                "phone": "9876543210",
                "address": "Test address",
            },
            format="json",
        )
        self.assertEqual(response.status_code, 201, response.content)
        data = response.json()
        login_email = data.get("login_email") or data.get("loginEmail")
        self.assertEqual(login_email, "raviv23@gmail.com")
        created_user = User.objects.get(email="raviv23@gmail.com")
        self.assertEqual(created_user.email, "raviv23@gmail.com")
