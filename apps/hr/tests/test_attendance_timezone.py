from datetime import date, datetime, time, timedelta

from django.test import SimpleTestCase, override_settings
from django.utils import timezone

from apps.hr.attendance_policy import (
    combine_attendance_day_time,
    get_attendance_timezone,
    resolve_punch_timestamp,
)


@override_settings(TIME_ZONE='Asia/Kolkata')
class AttendanceTimezoneTests(SimpleTestCase):
    def test_punch_date_time_ignores_browser_utc_mistake(self):
        """11:53 wall clock on shift day must not become 10:53 UTC from a UK browser."""
        day = date(2026, 6, 4)
        ts = resolve_punch_timestamp(punch_date=day, punch_time='11:53')
        local = timezone.localtime(ts, get_attendance_timezone())
        self.assertEqual(local.hour, 11)
        self.assertEqual(local.minute, 53)
        shift_start = combine_attendance_day_time(day, time(9, 0))
        late_min = int((ts - shift_start).total_seconds() // 60)
        self.assertEqual(late_min, 173)

    def test_naive_timestamp_treated_as_attendance_local(self):
        day = date(2026, 6, 4)
        naive = datetime.combine(day, time(11, 53))
        ts = resolve_punch_timestamp(timestamp=naive)
        local = timezone.localtime(ts, get_attendance_timezone())
        self.assertEqual(local.hour, 11)
        self.assertEqual(local.minute, 53)

    def test_aware_utc_instant_preserved_for_live_punch(self):
        utc_instant = timezone.now()
        ts = resolve_punch_timestamp(timestamp=utc_instant)
        self.assertEqual(ts, utc_instant)
