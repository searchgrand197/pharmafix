from datetime import date, timedelta
from decimal import Decimal
from unittest import mock

from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.test import APIClient

from apps.hr.email_utils import _send_offer_email_core
from apps.hr.job_applications import local_today
from apps.hr.models import (
    Candidate,
    CandidateProfile,
    Department,
    JobOpening,
    Offer,
    OfferBuilderV2,
)
from apps.shared.models import Hospital

User = get_user_model()


class OfferExpiryIntegrationTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.hospital = Hospital.objects.create(name='Expiry Hospital', slug='expiry-hosp')
        cls.department = Department.objects.create(hospital=cls.hospital, name='Nursing')
        cls.job = JobOpening.objects.create(
            hospital=cls.hospital,
            department=cls.department,
            title='Nursing Staff',
            job_code='JOB-EXPIRY-001',
            status='open',
            is_active=True,
            expiry_date=local_today() + timedelta(days=30),
        )
        cls.profile = CandidateProfile.objects.create(
            hospital=cls.hospital,
            candidate_code='CAND-EXPIRY',
            name='Ankit',
            email='ankit.expiry@example.com',
        )
        cls.candidate = Candidate.objects.create(
            job_opening=cls.job,
            profile=cls.profile,
            application_code='APP-EXPIRY',
            name='Ankit',
            email='ankit.expiry@example.com',
            status='selected',
            offer_status='pending',
        )
        cls.hr_user = User.objects.create_user(
            email='hr.expiry@example.com',
            password='test-pass-123',
            is_staff=True,
            hospital=cls.hospital,
        )

    def _create_offer(self, *, expiry: date):
        return Offer.objects.create(
            candidate=self.candidate,
            job=self.job,
            candidate_name=self.candidate.name,
            candidate_email=self.candidate.email,
            company_name='Test Hospital',
            company_address='123 Main St',
            company_email='hr@hospital.test',
            company_phone='9999999999',
            hr_name='HR Lead',
            hr_designation='HR Manager',
            job_title=self.job.title,
            department=self.department.name,
            job_location='On-site',
            employment_type='full_time',
            ctc=Decimal('500000.00'),
            joining_date=date.today() + timedelta(days=30),
            terms_conditions='Standard terms apply.',
            offer_expiry_date=expiry,
            status='created',
        )

    @mock.patch('apps.hr.email_utils._safe_smtp_send', return_value=True)
    def test_send_offer_email_includes_expiry_deadline(self, _smtp_mock):
        expiry = local_today() + timedelta(days=7)
        offer = self._create_offer(expiry=expiry)
        expiry_display = expiry.strftime('%d %B %Y')

        ok = _send_offer_email_core(offer)

        self.assertTrue(ok)
        args, _kwargs = _smtp_mock.call_args
        msg = args[0]
        plain = ''
        for part in msg.walk():
            if part.get_content_type() == 'text/plain':
                plain = part.get_payload(decode=True).decode()
                break
        self.assertIn(expiry_display, plain)
        self.assertIn('accept or decline', plain.lower())

    @mock.patch('apps.hr.recruitment_email_dispatcher.EmailEventDispatcher.offer_sent', return_value=True)
    @mock.patch('apps.hr.utils.pdf_generator.generate_offer_pdf', return_value=True)
    @mock.patch('apps.hr.utils.pdf_generator.generate_pdf_bytes_from_html', return_value=b'%PDF')
    def test_generate_offer_uses_builder_offer_expiry_date(self, _pdf_bytes_mock, _pdf_mock, _email_mock):
        custom_expiry = local_today() + timedelta(days=10)
        builder = OfferBuilderV2.objects.create(
            candidate=self.candidate,
            candidate_name=self.candidate.name,
            candidate_email=self.candidate.email,
            job_title=self.job.title,
            department=self.department.name,
            joining_date=local_today() + timedelta(days=14),
            offer_expiry_date=custom_expiry,
            ctc='500000',
            dynamic_content=[],
        )

        client = APIClient()
        client.force_authenticate(user=self.hr_user)
        response = client.post(f'/api/v1/hr/offer-builder-v2/{builder.id}/generate_offer/')

        self.assertEqual(response.status_code, 200, response.content)
        offer = Offer.objects.get(candidate=self.candidate)
        self.assertEqual(offer.offer_expiry_date, custom_expiry)

    def test_generate_offer_rejects_past_expiry_date(self):
        builder = OfferBuilderV2.objects.create(
            candidate=self.candidate,
            candidate_name=self.candidate.name,
            candidate_email=self.candidate.email,
            job_title=self.job.title,
            department=self.department.name,
            joining_date=local_today() + timedelta(days=14),
            offer_expiry_date=local_today() - timedelta(days=1),
            ctc='500000',
            dynamic_content=[],
        )

        client = APIClient()
        client.force_authenticate(user=self.hr_user)
        response = client.post(f'/api/v1/hr/offer-builder-v2/{builder.id}/generate_offer/')

        self.assertEqual(response.status_code, 400)
        self.assertIn('past', response.json().get('error', '').lower())
