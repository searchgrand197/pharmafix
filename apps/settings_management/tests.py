import json

from django.test import TestCase
from django.urls import reverse

from apps.settings_management.models import ReceptionPortalSettings
from apps.shared.models import Hospital


class PwaManifestViewTests(TestCase):
    def setUp(self):
        self.hospital = Hospital.objects.create(name="Test Hospital")
        ReceptionPortalSettings.objects.create(
            hospital=self.hospital,
            hospital_name="City Care Hospital",
            address="Main Road",
            pin_code="110001",
            phone="+91-9999999999",
        )

    def test_manifest_uses_reception_hospital_name(self):
        url = reverse("pwa-manifest", kwargs={"portal": "staff"})
        response = self.client.get(url, {"hospital_id": str(self.hospital.pk)})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response["Content-Type"], "application/manifest+json")
        data = json.loads(response.content)
        self.assertEqual(data["name"], "City Care Hospital – Staff")
        self.assertEqual(data["start_url"], "/staff")

    def test_manifest_fallback_without_hospital_id(self):
        url = reverse("pwa-manifest", kwargs={"portal": "doctor"})
        response = self.client.get(url)
        self.assertEqual(response.status_code, 200)
        data = json.loads(response.content)
        self.assertEqual(data["name"], "Vardaan – Doctor")
