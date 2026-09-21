from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.test import APIClient

from apps.hr.models import DocumentType
from apps.hr.onboarding_documents import (
    DEFAULT_ONBOARDING_DOCUMENT_TYPES,
    ensure_default_document_types,
)
from apps.shared.models import Hospital

User = get_user_model()


class DocumentTypeDefaultsTests(TestCase):
    def setUp(self):
        self.hospital = Hospital.objects.create(name='Doc Defaults Hospital', slug='doc-defaults-hospital')
        self.hr_user = User.objects.create_user(
            email='hr.docdefaults@test.local',
            password='test-pass-123',
            is_staff=True,
            hospital=self.hospital,
        )
        self.client = APIClient()
        self.client.force_authenticate(user=self.hr_user)

    def test_ensure_default_document_types_creates_standard_rows(self):
        created = ensure_default_document_types(self.hospital)
        self.assertEqual(len(created), len(DEFAULT_ONBOARDING_DOCUMENT_TYPES))
        names = set(DocumentType.objects.filter(hospital=self.hospital).values_list('name', flat=True))
        self.assertEqual(names, {row[0] for row in DEFAULT_ONBOARDING_DOCUMENT_TYPES})

        # Second call is idempotent and does not reactivate deactivated rows.
        DocumentType.objects.filter(hospital=self.hospital, name='Resume').update(is_active=False)
        again = ensure_default_document_types(self.hospital)
        self.assertEqual(again, [])
        resume = DocumentType.objects.get(hospital=self.hospital, name='Resume')
        self.assertFalse(resume.is_active)

    def test_document_types_list_seeds_defaults_for_hospital(self):
        self.assertEqual(DocumentType.objects.filter(hospital=self.hospital).count(), 0)
        res = self.client.get('/api/v1/hr/document-types/')
        self.assertEqual(res.status_code, 200)
        payload = res.data if isinstance(res.data, list) else res.data.get('results', [])
        names = {row['name'] for row in payload}
        expected = {row[0] for row in DEFAULT_ONBOARDING_DOCUMENT_TYPES}
        self.assertTrue(expected.issubset(names))
        self.assertEqual(
            DocumentType.objects.filter(hospital=self.hospital).count(),
            len(DEFAULT_ONBOARDING_DOCUMENT_TYPES),
        )

    def test_seed_defaults_action(self):
        res = self.client.post('/api/v1/hr/document-types/seed-defaults/')
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data['created'], len(DEFAULT_ONBOARDING_DOCUMENT_TYPES))
        again = self.client.post('/api/v1/hr/document-types/seed-defaults/')
        self.assertEqual(again.status_code, 200)
        self.assertEqual(again.data['created'], 0)
