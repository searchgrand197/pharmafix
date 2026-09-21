from datetime import datetime, time, timedelta
from unittest.mock import patch

from django.test import TestCase
from django.utils import timezone

from apps.hr.attendance_analytics import build_dashboard_summary
from apps.hr.attendance_engine import AttendanceCalculationService, calculate_daily_attendance
from apps.hr.models import DailyAttendance, Employee, Shift
from apps.shared.models import Hospital


class AttendancePreShiftStatusTests(TestCase):
    def setUp(self):
        self.hospital = Hospital.objects.create(name='Pre Shift Hospital', slug='pre-shift-hospital')
        self.day = timezone.localdate()
        self.shift = Shift.objects.create(
            hospital=self.hospital,
            name='Mid Shift',
            code='MID',
            start_time=time(16, 0),
            end_time=time(0, 0),
            grace_minutes=10,
            half_day_hours=4,
            full_day_hours=8,
            is_overnight=True,
        )
        self.employee = Employee.objects.create(
            hospital=self.hospital,
            name='Naveen',
            email='naveen-pre-shift@test.local',
            status='active',
            shift=self.shift,
        )

    def test_no_punch_before_shift_is_not_started_not_absent(self):
        morning = timezone.make_aware(datetime.combine(self.day, time(9, 30)))
        with patch('apps.hr.attendance_policy.timezone.now', return_value=morning):
            calculated = calculate_daily_attendance(self.employee, self.day)
            self.assertEqual(calculated['attendance_status'], 'not_started')

            AttendanceCalculationService.rebuild_day(
                self.day,
                Employee.objects.filter(pk=self.employee.pk),
            )
            summary = build_dashboard_summary(self.day, hospital_id=self.hospital.id, force_rebuild=True)

        self.assertEqual(summary['absent_today'], 0)
        self.assertEqual(summary['not_started_today'], 1)
        row = DailyAttendance.objects.get(employee=self.employee, date=self.day)
        self.assertEqual(row.attendance_status, 'not_started')

    def test_no_punch_after_grace_counts_as_absent(self):
        after_grace = timezone.make_aware(datetime.combine(self.day, time(16, 15)))
        with patch('apps.hr.attendance_policy.timezone.now', return_value=after_grace):
            calculated = calculate_daily_attendance(self.employee, self.day)
            self.assertEqual(calculated['attendance_status'], 'absent')

            AttendanceCalculationService.rebuild_day(
                self.day,
                Employee.objects.filter(pk=self.employee.pk),
            )
            summary = build_dashboard_summary(self.day, hospital_id=self.hospital.id, force_rebuild=True)

        self.assertEqual(summary['absent_today'], 1)
        self.assertEqual(summary['not_started_today'], 0)

    def test_past_day_without_punch_stays_absent(self):
        past_day = self.day - timedelta(days=1)
        calculated = calculate_daily_attendance(self.employee, past_day)
        self.assertEqual(calculated['attendance_status'], 'absent')
