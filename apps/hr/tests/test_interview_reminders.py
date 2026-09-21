from datetime import timedelta
from unittest import mock

from django.test import TestCase
from django.utils import timezone

from apps.hr.interview_reminders import (
    REMINDER_1_HOUR,
    REMINDER_10_MIN,
    cancel_interview_reminders,
    compute_reminder_fire_times,
    process_due_reminders,
    sync_interview_reminders,
)
from apps.hr.models import Candidate, CandidateProfile, Department, Interview, InterviewReminder, JobOpening
from apps.shared.models import Hospital


class InterviewReminderTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.hospital = Hospital.objects.create(name='Reminder Hospital', slug='reminder-hospital')
        cls.department = Department.objects.create(hospital=cls.hospital, name='Eng')
        cls.job = JobOpening.objects.create(
            hospital=cls.hospital,
            department=cls.department,
            title='Developer',
            job_code='JOB-REM-001',
            status='open',
            is_active=True,
        )
        cls.profile = CandidateProfile.objects.create(
            hospital=cls.hospital,
            candidate_code='CAND-REM-001',
            name='Alex Applicant',
            email='alex@example.com',
        )
        cls.candidate = Candidate.objects.create(
            job_opening=cls.job,
            profile=cls.profile,
            application_code='APP-REM-001',
            name='Alex Applicant',
            email='alex@example.com',
            status='interview',
        )

    def _create_interview(self, hours_ahead=3):
        start = timezone.now() + timedelta(hours=hours_ahead)
        return Interview.objects.create(
            candidate=self.candidate,
            scheduled_start=start,
            scheduled_end=start + timedelta(hours=1),
            duration_minutes=60,
            timezone='Asia/Kolkata',
            mode='online',
            meeting_link='https://meet.example.com/room',
            status=Interview.STATUS_SCHEDULED,
        )

    def test_compute_reminder_fire_times(self):
        inv = self._create_interview(hours_ahead=3)
        times = dict(compute_reminder_fire_times(inv))
        self.assertIn(REMINDER_1_HOUR, times)
        self.assertIn(REMINDER_10_MIN, times)
        self.assertAlmostEqual(
            times[REMINDER_1_HOUR].timestamp(),
            (inv.scheduled_start - timedelta(hours=1)).timestamp(),
            delta=2,
        )

    def test_sync_creates_two_reminders(self):
        inv = self._create_interview(hours_ahead=3)
        count = sync_interview_reminders(inv)
        self.assertEqual(count, 2)
        self.assertEqual(InterviewReminder.objects.filter(interview=inv, is_sent=False).count(), 2)

    def test_reschedule_replaces_unsent_reminders(self):
        inv = self._create_interview(hours_ahead=3)
        sync_interview_reminders(inv)
        old_ids = set(InterviewReminder.objects.filter(interview=inv).values_list('pk', flat=True))

        inv.scheduled_start = timezone.now() + timedelta(hours=5)
        inv.save(update_fields=['scheduled_start', 'updated_at'])
        sync_interview_reminders(inv)

        new_qs = InterviewReminder.objects.filter(interview=inv, is_sent=False)
        self.assertEqual(new_qs.count(), 2)
        self.assertFalse(old_ids.intersection(set(new_qs.values_list('pk', flat=True))))

    def test_cancel_removes_pending_reminders(self):
        inv = self._create_interview(hours_ahead=3)
        sync_interview_reminders(inv)
        inv.status = Interview.STATUS_CANCELLED
        inv.save(update_fields=['status', 'updated_at'])
        cancel_interview_reminders(inv)
        self.assertEqual(InterviewReminder.objects.filter(interview=inv, is_sent=False).count(), 0)

    @mock.patch('apps.hr.email_utils._safe_smtp_send', return_value=True)
    def test_process_due_reminders_sends_once(self, smtp_mock):
        inv = self._create_interview(hours_ahead=0.5)
        sync_interview_reminders(inv)
        InterviewReminder.objects.filter(interview=inv).update(
            scheduled_time=timezone.now() - timedelta(minutes=1),
        )

        stats = process_due_reminders()
        self.assertEqual(stats['sent'], 2)
        self.assertEqual(InterviewReminder.objects.filter(interview=inv, is_sent=True).count(), 2)

        smtp_mock.reset_mock()
        stats2 = process_due_reminders()
        self.assertEqual(stats2['sent'], 0)
        self.assertEqual(smtp_mock.call_count, 0)

    @mock.patch('apps.hr.email_utils._safe_smtp_send', return_value=True)
    def test_catch_up_overdue_reminder(self, smtp_mock):
        inv = self._create_interview(hours_ahead=2)
        sync_interview_reminders(inv)
        InterviewReminder.objects.filter(
            interview=inv,
            reminder_type=REMINDER_10_MIN,
        ).update(scheduled_time=timezone.now() - timedelta(hours=1))

        stats = process_due_reminders()
        self.assertGreaterEqual(stats['sent'], 1)
        self.assertTrue(
            InterviewReminder.objects.filter(
                interview=inv,
                reminder_type=REMINDER_10_MIN,
                is_sent=True,
            ).exists()
        )
