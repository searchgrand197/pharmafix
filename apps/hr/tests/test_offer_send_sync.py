from datetime import date, timedelta
from decimal import Decimal
from unittest import mock

from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.test import APIClient

from apps.hr.job_applications import local_today
from apps.hr.models import (
    Candidate,
    CandidateProfile,
    Department,
    JobOpening,
    Offer,
)
from apps.hr.offer_generation import send_created_offer
from apps.shared.models import Hospital

User = get_user_model()


class OfferSendStatusSyncTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.hospital = Hospital.objects.create(name='Offer Sync Hospital', slug='offer-sync-hosp')
        cls.department = Department.objects.create(hospital=cls.hospital, name='Nursing')
        cls.job = JobOpening.objects.create(
            hospital=cls.hospital,
            department=cls.department,
            title='Nursing Staff',
            job_code='JOB-OFFER-SYNC-001',
            status='open',
            is_active=True,
            expiry_date=local_today() + timedelta(days=30),
        )
        cls.profile = CandidateProfile.objects.create(
            hospital=cls.hospital,
            candidate_code='CAND-OFFER-SYNC',
            name='Ankit',
            email='ankit.offer.sync@example.com',
        )
        cls.candidate = Candidate.objects.create(
            job_opening=cls.job,
            profile=cls.profile,
            application_code='APP-OFFER-SYNC',
            name='Ankit',
            email='ankit.offer.sync@example.com',
            status='selected',
            offer_status='pending',
        )
        cls.hr_user = User.objects.create_user(
            email='hr.offer.sync@example.com',
            password='test-pass-123',
            is_staff=True,
            hospital=cls.hospital,
        )

    def _create_offer(self, *, status='created'):
        expiry = local_today() + timedelta(days=14)
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
            status=status,
        )

    @mock.patch('apps.hr.recruitment_email_dispatcher.EmailEventDispatcher.offer_sent', return_value=True)
    @mock.patch('apps.hr.utils.pdf_generator.generate_offer_pdf', return_value=True)
    def test_offer_send_endpoint_updates_candidate_offer_status(self, _pdf_mock, _email_mock):
        offer = self._create_offer(status='created')
        client = APIClient()
        client.force_authenticate(user=self.hr_user)

        response = client.post(f'/api/v1/hr/offers/{offer.id}/send/')

        self.assertEqual(response.status_code, 200)
        offer.refresh_from_db()
        self.candidate.refresh_from_db()
        self.assertEqual(offer.status, 'sent')
        self.assertEqual(self.candidate.offer_status, 'sent')

    @mock.patch('apps.hr.recruitment_email_dispatcher.EmailEventDispatcher.offer_sent', return_value=True)
    @mock.patch('apps.hr.utils.pdf_generator.generate_offer_pdf', return_value=True)
    def test_send_created_offer_updates_both_statuses_atomically(self, _pdf_mock, _email_mock):
        offer = self._create_offer(status='created')

        ok, err = send_created_offer(offer)

        self.assertTrue(ok, err)
        offer.refresh_from_db()
        self.candidate.refresh_from_db()
        self.assertEqual(offer.status, 'sent')
        self.assertEqual(self.candidate.offer_status, 'sent')
