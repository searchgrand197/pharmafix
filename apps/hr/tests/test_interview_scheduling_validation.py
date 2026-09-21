from datetime import datetime
from unittest import mock
from zoneinfo import ZoneInfo

from django.test import SimpleTestCase

from apps.hr.interview_scheduling import (
    InterviewSchedulingError,
    ensure_interview_not_in_past,
)


class EnsureInterviewNotInPastTests(SimpleTestCase):
    TZ = 'Asia/Kolkata'

    def _aware(self, year, month, day, hour, minute, second=0):
        return datetime(year, month, day, hour, minute, second, tzinfo=ZoneInfo(self.TZ))

    @mock.patch('apps.hr.interview_scheduling.dj_timezone.localtime')
    def test_yesterday_raises(self, localtime_mock):
        localtime_mock.return_value = self._aware(2026, 5, 16, 15, 0)
        when = self._aware(2026, 5, 15, 10, 0)
        with self.assertRaises(InterviewSchedulingError):
            ensure_interview_not_in_past(when, self.TZ)

    @mock.patch('apps.hr.interview_scheduling.dj_timezone.localtime')
    def test_tomorrow_ok(self, localtime_mock):
        localtime_mock.return_value = self._aware(2026, 5, 16, 15, 0)
        when = self._aware(2026, 5, 17, 9, 0)
        ensure_interview_not_in_past(when, self.TZ)

    @mock.patch('apps.hr.interview_scheduling.dj_timezone.localtime')
    def test_today_past_time_raises(self, localtime_mock):
        localtime_mock.return_value = self._aware(2026, 5, 16, 15, 0)
        when = self._aware(2026, 5, 16, 10, 0)
        with self.assertRaises(InterviewSchedulingError):
            ensure_interview_not_in_past(when, self.TZ)

    @mock.patch('apps.hr.interview_scheduling.dj_timezone.localtime')
    def test_today_future_time_ok(self, localtime_mock):
        localtime_mock.return_value = self._aware(2026, 5, 16, 15, 0)
        when = self._aware(2026, 5, 16, 16, 0)
        ensure_interview_not_in_past(when, self.TZ)

    @mock.patch('apps.hr.interview_scheduling.dj_timezone.localtime')
    def test_exactly_now_ok(self, localtime_mock):
        now = self._aware(2026, 5, 16, 15, 0)
        localtime_mock.return_value = now
        ensure_interview_not_in_past(now, self.TZ)

    @mock.patch('apps.hr.interview_scheduling.dj_timezone.localtime')
    def test_same_minute_with_seconds_on_now_ok(self, localtime_mock):
        localtime_mock.return_value = self._aware(2026, 5, 16, 15, 0, 45)
        when = self._aware(2026, 5, 16, 15, 0)
        ensure_interview_not_in_past(when, self.TZ)

    @mock.patch('apps.hr.interview_scheduling.dj_timezone.localtime')
    def test_one_minute_grace_allows_recent_slot(self, localtime_mock):
        localtime_mock.return_value = self._aware(2026, 5, 16, 15, 6)
        when = self._aware(2026, 5, 16, 15, 5)
        ensure_interview_not_in_past(when, self.TZ, grace_minutes=2)

    @mock.patch('apps.hr.interview_scheduling.dj_timezone.localtime')
    def test_beyond_grace_raises(self, localtime_mock):
        localtime_mock.return_value = self._aware(2026, 5, 16, 15, 11)
        when = self._aware(2026, 5, 16, 15, 5)
        with self.assertRaises(InterviewSchedulingError):
            ensure_interview_not_in_past(when, self.TZ, grace_minutes=2)

    @mock.patch('apps.hr.interview_scheduling.dj_timezone.localtime')
    def test_zero_grace_rejects_one_minute_ago(self, localtime_mock):
        localtime_mock.return_value = self._aware(2026, 5, 16, 15, 6)
        when = self._aware(2026, 5, 16, 15, 5)
        with self.assertRaises(InterviewSchedulingError):
            ensure_interview_not_in_past(when, self.TZ, grace_minutes=0)

    @mock.patch('apps.hr.interview_scheduling.dj_timezone.localtime')
    def test_unknown_timezone_raises(self, localtime_mock):
        localtime_mock.return_value = self._aware(2026, 5, 16, 15, 0)
        when = self._aware(2026, 5, 17, 9, 0)
        with self.assertRaises(InterviewSchedulingError):
            ensure_interview_not_in_past(when, 'Not/A_Timezone')
