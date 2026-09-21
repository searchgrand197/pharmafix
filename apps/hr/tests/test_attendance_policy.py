from datetime import date, datetime, time, timedelta
from unittest.mock import patch

from django.test import SimpleTestCase, override_settings
from django.utils import timezone

from apps.hr.attendance_policy import (
    LATE_MINUTES_BASIS_AFTER_GRACE,
    LATE_MINUTES_BASIS_SHIFT_START,
    STATUS_IN_PROGRESS,
    STATUS_MISSING_CHECKOUT,
    STATUS_NOT_STARTED,
    compute_late_metrics,
    get_late_minutes_basis,
    is_absence_deadline_passed,
    is_shift_end_passed,
    resolve_no_punch_status,
    resolve_open_checkout_status,
)


class _Shift:
    def __init__(self, *, start=None, end=None, grace=0, overnight=False):
        self.start_time = start
        self.end_time = end
        self.grace_minutes = grace
        self.is_overnight = overnight


class AttendancePolicyTests(SimpleTestCase):
    def test_late_minutes_shift_start_before_grace_not_late_status(self):
        day = date(2026, 6, 4)
        shift_start = timezone.make_aware(datetime.combine(day, time(9, 0)))
        check_in = shift_start + timedelta(minutes=5)
        late_min, is_late = compute_late_metrics(check_in, shift_start, grace_minutes=15)
        self.assertEqual(late_min, 5)
        self.assertFalse(is_late)

    def test_late_minutes_shift_start_after_grace_is_late(self):
        day = date(2026, 6, 4)
        shift_start = timezone.make_aware(datetime.combine(day, time(9, 0)))
        check_in = shift_start + timedelta(minutes=20)
        late_min, is_late = compute_late_metrics(check_in, shift_start, grace_minutes=15)
        self.assertEqual(late_min, 20)
        self.assertTrue(is_late)

    @override_settings(ATTENDANCE_LATE_MINUTES_BASIS=LATE_MINUTES_BASIS_AFTER_GRACE)
    def test_late_minutes_after_grace_basis(self):
        self.assertEqual(get_late_minutes_basis(), LATE_MINUTES_BASIS_AFTER_GRACE)
        day = date(2026, 6, 4)
        shift_start = timezone.make_aware(datetime.combine(day, time(9, 0)))
        check_in = shift_start + timedelta(minutes=20)
        late_min, is_late = compute_late_metrics(check_in, shift_start, grace_minutes=15)
        self.assertEqual(late_min, 5)
        self.assertTrue(is_late)

    def test_open_checkout_in_progress_before_shift_end(self):
        day = date(2026, 6, 4)
        shift = _Shift(start=time(9, 0), end=time(18, 0))
        noon = timezone.make_aware(datetime.combine(day, time(12, 0)))
        with patch('apps.hr.attendance_policy.timezone.now', return_value=noon):
            self.assertEqual(resolve_open_checkout_status(day, shift), STATUS_IN_PROGRESS)

    def test_open_checkout_missing_after_shift_end(self):
        day = date(2026, 6, 4)
        shift = _Shift(start=time(9, 0), end=time(18, 0))
        evening = timezone.make_aware(datetime.combine(day, time(19, 0)))
        with patch('apps.hr.attendance_policy.timezone.now', return_value=evening):
            self.assertEqual(resolve_open_checkout_status(day, shift), STATUS_MISSING_CHECKOUT)

    def test_shift_end_passed_on_prior_day(self):
        day = date(2026, 6, 3)
        shift = _Shift(start=time(9, 0), end=time(18, 0))
        now = timezone.make_aware(datetime.combine(date(2026, 6, 4), time(10, 0)))
        with patch('apps.hr.attendance_policy.timezone.now', return_value=now):
            self.assertTrue(is_shift_end_passed(day, shift))

    def test_no_punch_not_started_before_shift_grace_on_today(self):
        day = date(2026, 6, 4)
        shift = _Shift(start=time(16, 0), end=time(0, 0), grace=10, overnight=True)
        morning = timezone.make_aware(datetime.combine(day, time(9, 26)))
        with patch('apps.hr.attendance_policy.timezone.now', return_value=morning):
            self.assertFalse(is_absence_deadline_passed(day, shift))
            self.assertEqual(resolve_no_punch_status(day, shift), STATUS_NOT_STARTED)

    def test_no_punch_absent_after_shift_grace_on_today(self):
        day = date(2026, 6, 4)
        shift = _Shift(start=time(16, 0), end=time(0, 0), grace=10, overnight=True)
        after_grace = timezone.make_aware(datetime.combine(day, time(16, 15)))
        with patch('apps.hr.attendance_policy.timezone.now', return_value=after_grace):
            self.assertTrue(is_absence_deadline_passed(day, shift))
            self.assertEqual(resolve_no_punch_status(day, shift), 'absent')

    def test_no_punch_absent_on_past_day(self):
        day = date(2026, 6, 3)
        shift = _Shift(start=time(16, 0), end=time(0, 0), grace=10, overnight=True)
        now = timezone.make_aware(datetime.combine(date(2026, 6, 4), time(9, 0)))
        with patch('apps.hr.attendance_policy.timezone.now', return_value=now):
            self.assertEqual(resolve_no_punch_status(day, shift), 'absent')
