"""Attendance engine: late status must not be masked by half_day."""
from datetime import date, datetime, time, timedelta

from django.test import TestCase
from django.utils import timezone

from apps.hr.attendance_engine import calculate_daily_attendance
from apps.hr.models import AttendancePunch, Employee, Shift
from apps.shared.models import Hospital


class AttendanceEngineLatePriorityTests(TestCase):
    def setUp(self):
        self.hospital = Hospital.objects.create(name='Late Engine Hospital', slug='late-engine')
        self.shift = Shift.objects.create(
            hospital=self.hospital,
            name='Morning',
            code='AM',
            start_time=time(9, 0),
            end_time=time(18, 0),
            grace_minutes=10,
            half_day_hours=4,
            full_day_hours=8,
        )
        self.employee = Employee.objects.create(
            hospital=self.hospital,
            name='Late Worker',
            email='late-worker@test.local',
            status='active',
            shift=self.shift,
        )
        self.day = timezone.localdate() - timedelta(days=2)
        tz = timezone.get_current_timezone()

        in_ts = timezone.make_aware(datetime.combine(self.day, time(10, 30)), tz)
        out_ts = timezone.make_aware(datetime.combine(self.day, time(12, 0)), tz)
        AttendancePunch.objects.create(
            employee=self.employee,
            shift=self.shift,
            attendance_date=self.day,
            timestamp=in_ts,
            punch_type='IN',
            source='biometric',
            device_id='K90-TEST',
        )
        AttendancePunch.objects.create(
            employee=self.employee,
            shift=self.shift,
            attendance_date=self.day,
            timestamp=out_ts,
            punch_type='OUT',
            source='biometric',
            device_id='K90-TEST',
        )

    def test_late_beyond_grace_not_half_day(self):
        result = calculate_daily_attendance(self.employee, self.day, self.shift)
        self.assertGreater(result['late_minutes'], 0)
        self.assertEqual(result['attendance_status'], 'late')
