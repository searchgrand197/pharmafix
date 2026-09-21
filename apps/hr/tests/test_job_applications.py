from datetime import timedelta

from django.contrib.auth import get_user_model
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from apps.hr.job_applications import (
    APPLICATION_CLOSED_MESSAGE,
    DEADLINE_PASSED_MESSAGE,
    HR_EXPIRY_DATE_PAST_ERROR,
    POSITION_CLOSED_MESSAGE,
    get_application_block_message,
    is_job_expired,
    job_accepts_applications,
    local_today,
    validate_hr_expiry_date,
)
from apps.hr.models import Department, JobOpening
from apps.shared.models import Hospital

User = get_user_model()


class JobAcceptsApplicationsTests(TestCase):
    def setUp(self):
        self.hospital = Hospital.objects.create(name='Test Hospital')
        self.department = Department.objects.create(
            hospital=self.hospital,
            name='Engineering',
        )
        self.today = local_today()
        self.tomorrow = self.today + timedelta(days=1)
        self.yesterday = self.today - timedelta(days=1)

    def _job(self, **kwargs):
        defaults = {
            'hospital': self.hospital,
            'department': self.department,
            'title': 'Software Engineer',
            'job_code': 'JOB-TEST-001',
            'status': 'open',
            'is_active': True,
            'is_archived': False,
            'expiry_date': self.tomorrow,
        }
        defaults.update(kwargs)
        return JobOpening.objects.create(**defaults)

    def test_open_active_job_with_future_deadline_accepts(self):
        job = self._job()
        self.assertTrue(job_accepts_applications(job))

    def test_open_job_without_deadline_rejected(self):
        job = self._job(expiry_date=None)
        self.assertFalse(job_accepts_applications(job))

    def test_closed_job_rejected(self):
        job = self._job(status='closed', is_active=False)
        self.assertFalse(job_accepts_applications(job))
        self.assertEqual(get_application_block_message(job), POSITION_CLOSED_MESSAGE)

    def test_draft_job_rejected(self):
        job = self._job(status='draft')
        self.assertFalse(job_accepts_applications(job))

    def test_on_hold_job_rejected(self):
        job = self._job(status='on_hold')
        self.assertFalse(job_accepts_applications(job))

    def test_archived_job_rejected(self):
        job = self._job(status='archived', is_archived=True, is_active=False)
        self.assertFalse(job_accepts_applications(job))

    def test_expired_job_rejected(self):
        job = self._job(expiry_date=self.yesterday)
        self.assertTrue(is_job_expired(job))
        self.assertFalse(job_accepts_applications(job))
        self.assertEqual(get_application_block_message(job), DEADLINE_PASSED_MESSAGE)

    def test_deadline_today_still_accepts(self):
        job = self._job(expiry_date=self.today)
        self.assertFalse(is_job_expired(job))
        self.assertTrue(job_accepts_applications(job))

    def test_inactive_open_job_rejected(self):
        job = self._job(is_active=False)
        self.assertFalse(job_accepts_applications(job))
        self.assertEqual(get_application_block_message(job), APPLICATION_CLOSED_MESSAGE)


class ValidateHrExpiryDateTests(TestCase):
    def setUp(self):
        self.today = local_today()

    def test_past_date_rejected(self):
        past = self.today - timedelta(days=1)
        with self.assertRaises(ValueError) as ctx:
            validate_hr_expiry_date(past)
        self.assertIn(HR_EXPIRY_DATE_PAST_ERROR, str(ctx.exception))

    def test_today_and_future_allowed(self):
        validate_hr_expiry_date(self.today)
        validate_hr_expiry_date(self.today + timedelta(days=30))


class JobOpeningDraftApiTests(TestCase):
    def setUp(self):
        self.hospital = Hospital.objects.create(name='Draft Test Hospital')
        self.department = Department.objects.create(
            hospital=self.hospital,
            name='Engineering',
        )
        self.hr_user = User.objects.create_user(
            email='hr.draft@test.local',
            password='test-pass-123',
            is_staff=True,
            hospital=self.hospital,
        )
        self.client = APIClient()
        self.client.force_authenticate(user=self.hr_user)
        self.today = local_today()

    def _base_payload(self, **overrides):
        payload = {
            'title': 'Software Engineer',
            'department': str(self.department.id),
            'employment_type': 'full_time',
            'vacancies': 1,
        }
        payload.update(overrides)
        return payload

    def _error_payload(self, res):
        return res.data.get('errors', res.data)

    def test_create_draft_without_expiry_date(self):
        res = self.client.post(
            '/api/v1/hr/job-openings/',
            self._base_payload(status='draft'),
            format='json',
        )
        self.assertEqual(res.status_code, 201)
        self.assertEqual(res.data['status'], 'draft')
        self.assertIsNone(res.data['expiry_date'])

    def test_create_open_without_expiry_date_rejected(self):
        res = self.client.post(
            '/api/v1/hr/job-openings/',
            self._base_payload(status='open'),
            format='json',
        )
        self.assertEqual(res.status_code, 400)
        self.assertIn('expiry_date', self._error_payload(res))

    def test_create_draft_with_past_expiry_date_rejected(self):
        past = (self.today - timedelta(days=1)).isoformat()
        res = self.client.post(
            '/api/v1/hr/job-openings/',
            self._base_payload(status='draft', expiry_date=past),
            format='json',
        )
        self.assertEqual(res.status_code, 400)
        self.assertIn('expiry_date', self._error_payload(res))


class JobOpeningReopenOnExpiryExtensionTests(TestCase):
    def setUp(self):
        self.hospital = Hospital.objects.create(name='Reopen Test Hospital')
        self.department = Department.objects.create(
            hospital=self.hospital,
            name='Engineering',
        )
        self.hr_user = User.objects.create_user(
            email='hr.reopen@test.local',
            password='test-pass-123',
            is_staff=True,
            hospital=self.hospital,
        )
        self.client = APIClient()
        self.client.force_authenticate(user=self.hr_user)
        self.today = local_today()
        self.job = JobOpening.objects.create(
            hospital=self.hospital,
            department=self.department,
            title='Cleaner',
            job_code='JOB-REOPEN-001',
            status='closed',
            is_active=False,
            is_archived=False,
            expiry_date=self.today + timedelta(days=7),
        )

    def test_update_reopens_closed_job_with_valid_deadline(self):
        res = self.client.put(
            f'/api/v1/hr/job-openings/{self.job.id}/',
            {
                'title': 'Cleaner',
                'department': str(self.department.id),
                'employment_type': 'full_time',
                'vacancies': 1,
                'status': 'closed',
                'expiry_date': (self.today + timedelta(days=14)).isoformat(),
            },
            format='json',
        )
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data['status'], 'open')
        self.assertTrue(res.data['is_active'])
        self.assertTrue(res.data['accepts_applications'])

    def test_update_keeps_on_hold_even_with_valid_deadline(self):
        self.job.status = 'on_hold'
        self.job.save(update_fields=['status', 'updated_at'])
        res = self.client.put(
            f'/api/v1/hr/job-openings/{self.job.id}/',
            {
                'title': 'Cleaner',
                'department': str(self.department.id),
                'employment_type': 'full_time',
                'vacancies': 1,
                'status': 'on_hold',
                'expiry_date': (self.today + timedelta(days=14)).isoformat(),
            },
            format='json',
        )
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data['status'], 'on_hold')
        self.assertFalse(res.data['accepts_applications'])
