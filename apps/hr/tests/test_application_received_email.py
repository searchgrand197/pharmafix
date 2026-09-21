from datetime import timedelta
from unittest import mock

from django.test import TestCase

from apps.hr.job_applications import local_today
from apps.hr.models import Department, JobOpening, RecruitmentEmailEvent
from apps.hr.recruitment_applications import create_application_from_public_apply, get_or_create_profile
from apps.shared.models import Hospital


class ApplicationReceivedEmailTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.hospital = Hospital.objects.create(name='Email Hospital', slug='email-hospital')
        cls.department = Department.objects.create(hospital=cls.hospital, name='Ops')
        cls.job = JobOpening.objects.create(
            hospital=cls.hospital,
            department=cls.department,
            title='Analyst',
            job_code='JOB-EMAIL-APP-001',
            status='open',
            is_active=True,
            expiry_date=local_today() + timedelta(days=30),
        )

    @mock.patch('apps.hr.recruitment_email_dispatcher.EmailEventDispatcher.application_received')
    def test_public_apply_queues_application_received_email(self, dispatch_mock):
        create_application_from_public_apply(
            self.job,
            name='Applicant One',
            email='applicant@example.com',
            phone='9876543210',
            address='123 Street',
            status='applied',
        )
        dispatch_mock.assert_called_once()
        args, kwargs = dispatch_mock.call_args
        self.assertEqual(args[0].email, 'applicant@example.com')
        self.assertFalse(kwargs.get('on_commit', True))

    @mock.patch('apps.hr.email_utils._send_job_application_email_core', return_value=True)
    def test_application_received_send_after_commit(self, send_mock):
        create_application_from_public_apply(
            self.job,
            name='Applicant Two',
            email='applicant2@example.com',
            phone='9876543211',
            address='456 Street',
            status='applied',
        )
        send_mock.assert_called_once()
        self.assertTrue(
            RecruitmentEmailEvent.objects.filter(
                event_type=RecruitmentEmailEvent.EVENT_APPLICATION_RECEIVED,
                email_status=RecruitmentEmailEvent.STATUS_SENT,
            ).exists()
        )
