from datetime import timedelta
from unittest import mock

from django.test import TestCase

from apps.hr.job_applications import local_today
from apps.hr.models import (
    Candidate,
    CandidateProfile,
    Department,
    JobOpening,
    RecruitmentEmailEvent,
)
from apps.hr.recruitment_email_dispatcher import EmailEventDispatcher
from apps.shared.models import Hospital


class RecruitmentEmailDispatcherTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.hospital = Hospital.objects.create(name='Test Hospital', slug='test-hospital-dispatch')
        cls.department = Department.objects.create(hospital=cls.hospital, name='Nursing')
        cls.job = JobOpening.objects.create(
            hospital=cls.hospital,
            department=cls.department,
            title='Nurse',
            job_code='JOB-DISPATCH-001',
            status='open',
            is_active=True,
            expiry_date=local_today() + timedelta(days=30),
        )
        cls.profile = CandidateProfile.objects.create(
            hospital=cls.hospital,
            candidate_code='CAND-TEST-001',
            name='Jane Doe',
            email='candidate@example.com',
        )
        cls.candidate = Candidate.objects.create(
            job_opening=cls.job,
            profile=cls.profile,
            application_code='APP-TEST-001',
            name='Jane Doe',
            email='candidate@example.com',
            status='applied',
        )

    @mock.patch('apps.hr.email_utils._send_job_application_email_core', return_value=True)
    def test_application_received_idempotent(self, send_mock):
        EmailEventDispatcher.application_received(
            self.candidate, job=self.job, on_commit=False
        )
        EmailEventDispatcher.application_received(
            self.candidate, job=self.job, on_commit=False
        )
        self.assertEqual(send_mock.call_count, 1)
        self.assertEqual(
            RecruitmentEmailEvent.objects.filter(
                candidate=self.candidate,
                event_type=RecruitmentEmailEvent.EVENT_APPLICATION_RECEIVED,
            ).count(),
            1,
        )

    @mock.patch('apps.hr.email_utils._send_candidate_status_email_core', return_value=True)
    def test_rejected_once_per_candidate(self, send_mock):
        EmailEventDispatcher.rejected(self.candidate, on_commit=False)
        EmailEventDispatcher.rejected(self.candidate, on_commit=False)
        self.assertEqual(send_mock.call_count, 1)

    @mock.patch('apps.hr.email_utils._send_document_request_email_core', return_value=True)
    def test_document_request_allows_multiple(self, send_mock):
        EmailEventDispatcher.document_request(self.candidate, message='First', on_commit=False)
        EmailEventDispatcher.document_request(self.candidate, message='Second', on_commit=False)
        self.assertEqual(send_mock.call_count, 2)
        self.assertEqual(
            RecruitmentEmailEvent.objects.filter(
                candidate=self.candidate,
                event_type=RecruitmentEmailEvent.EVENT_DOCUMENT_REQUEST,
            ).count(),
            2,
        )

    @mock.patch('apps.hr.email_utils._send_interview_slot_email_core', return_value=True)
    def test_interview_scheduled_per_interview_id(self, send_mock):
        interview_id = '11111111-1111-1111-1111-111111111111'
        EmailEventDispatcher.interview_scheduled(
            self.candidate.pk, interview_id, on_commit=False
        )
        EmailEventDispatcher.interview_scheduled(
            self.candidate.pk, interview_id, on_commit=False
        )
        self.assertEqual(send_mock.call_count, 1)

    def test_default_stage_keys(self):
        self.assertEqual(
            EmailEventDispatcher.default_stage(
                RecruitmentEmailEvent.EVENT_REJECTED,
            ),
            'rejected',
        )
        self.assertEqual(
            EmailEventDispatcher.default_stage(
                RecruitmentEmailEvent.EVENT_INTERVIEW_SCHEDULED,
                interview_id='abc',
            ),
            'interview:abc',
        )

    @mock.patch(
        'apps.hr.email_utils._send_job_application_email_core',
        return_value=(False, 'Connection unexpectedly closed'),
    )
    def test_failed_send_persists_smtp_error_message(self, _send_mock):
        EmailEventDispatcher.application_received(
            self.candidate,
            job=self.job,
            on_commit=False,
            sync=True,
        )
        event = RecruitmentEmailEvent.objects.get(
            candidate=self.candidate,
            event_type=RecruitmentEmailEvent.EVENT_APPLICATION_RECEIVED,
        )
        self.assertEqual(event.email_status, RecruitmentEmailEvent.STATUS_FAILED)
        self.assertEqual(event.error_message, 'Connection unexpectedly closed')
