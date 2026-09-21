from datetime import timedelta
from io import StringIO
from unittest import mock

from django.core.management import call_command
from django.test import TestCase

from apps.hr.job_applications import local_today
from apps.hr.models import (
    Candidate,
    CandidateProfile,
    Department,
    JobOpening,
    RecruitmentEmailEvent,
)
from apps.shared.models import Hospital


class RetryFailedRecruitmentEmailsCommandTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.hospital = Hospital.objects.create(name='Retry Hospital', slug='retry-hospital')
        cls.department = Department.objects.create(hospital=cls.hospital, name='Ops')
        cls.job = JobOpening.objects.create(
            hospital=cls.hospital,
            department=cls.department,
            title='Analyst',
            job_code='JOB-RETRY-001',
            status='open',
            is_active=True,
            expiry_date=local_today() + timedelta(days=30),
        )
        cls.profile = CandidateProfile.objects.create(
            hospital=cls.hospital,
            candidate_code='CAND-RETRY-001',
            name='Retry Applicant',
            email='retry@example.com',
        )
        cls.candidate = Candidate.objects.create(
            job_opening=cls.job,
            profile=cls.profile,
            application_code='APP-RETRY-001',
            name='Retry Applicant',
            email='retry@example.com',
            status='applied',
        )
        cls.failed_event = RecruitmentEmailEvent.objects.create(
            candidate=cls.candidate,
            event_type=RecruitmentEmailEvent.EVENT_APPLICATION_RECEIVED,
            stage='applied',
            email_status=RecruitmentEmailEvent.STATUS_FAILED,
            error_message='Connection unexpectedly closed',
        )

    @mock.patch(
        'apps.hr.email_utils._send_job_application_email_core',
        return_value=(True, ''),
    )
    def test_retry_failed_recruitment_emails_command(self, _send_mock):
        out = StringIO()
        call_command('retry_failed_recruitment_emails', stdout=out)
        output = out.getvalue()
        self.assertIn('SENT', output)
        self.failed_event.refresh_from_db()
        self.assertEqual(self.failed_event.email_status, RecruitmentEmailEvent.STATUS_SENT)
        self.assertEqual(self.failed_event.error_message, '')
