from datetime import date, datetime, time, timedelta
from decimal import Decimal

from django.test import TestCase, override_settings
from django.utils import timezone

from apps.hr.attendance_analytics import build_employee_analytics
from apps.hr.attendance_policy import combine_attendance_day_time
from apps.hr.models import DailyAttendance, Employee, Shift
from apps.shared.models import Hospital


@override_settings(TIME_ZONE='Asia/Kolkata')
class PortalAttendanceDisplayTests(TestCase):
    def setUp(self):
        self.hospital = Hospital.objects.create(name='Display Hosp', slug='display-hosp')
        self.shift = Shift.objects.create(
            hospital=self.hospital,
            name='General Shift',
            code='GEN',
            start_time=time(9, 0),
            end_time=time(18, 0),
            full_day_hours=Decimal('8.00'),
            half_day_hours=Decimal('4.00'),
            overtime_allowed=True,
            active=True,
        )
        self.employee = Employee.objects.create(
            hospital=self.hospital,
            name='Display Employee',
            email='display.emp@test.local',
            status='active',
            shift=self.shift,
        )
        self.day = timezone.localdate()

    def test_portal_derives_present_status_and_overtime_for_complete_punches(self):
        check_in = combine_attendance_day_time(self.day, time(8, 30))
        check_out = combine_attendance_day_time(self.day, time(18, 30))
        DailyAttendance.objects.create(
            employee=self.employee,
            date=self.day,
            shift=self.shift,
            first_check_in=check_in,
            last_check_out=check_out,
            attendance_status='in_progress',
            total_work_hours=Decimal('0.00'),
            late_minutes=0,
            overtime_hours=Decimal('0.00'),
        )

        payload = build_employee_analytics(str(self.employee.id), month=self.day.strftime('%Y-%m'))
        row = next(item for item in payload['history'] if item['date'] == self.day.isoformat())

        self.assertEqual(row['status'], 'overtime')
        self.assertEqual(row['worked_hours'], '10.00')
        self.assertEqual(row['late_minutes'], 0)
        # 9:00 AM shift start → 6:30 PM checkout = 9.5h credited; shift is 9h → 0.5h OT (not 2h).
        self.assertEqual(row['overtime_hours'], '0.50')
        # Summary must match derived history (not stale DB status).
        self.assertEqual(payload['summary']['present_days'], 1)
        self.assertEqual(payload['summary']['total_work_hours'], 10.0)
        self.assertEqual(payload['summary']['total_overtime_hours'], 0.5)

    def test_current_month_summary_caps_totals_at_today(self):
        employee = Employee.objects.create(
            hospital=self.hospital,
            name='Today Joiner',
            email='today.joiner@test.local',
            status='active',
            shift=self.shift,
            joining_date=self.day,
            joining_date_confirmed=self.day,
        )
        check_in = combine_attendance_day_time(self.day, time(9, 0))
        check_out = combine_attendance_day_time(self.day, time(18, 0))
        DailyAttendance.objects.create(
            employee=employee,
            date=self.day,
            shift=self.shift,
            first_check_in=check_in,
            last_check_out=check_out,
            attendance_status='present',
            total_work_hours=Decimal('9.00'),
            late_minutes=0,
            overtime_hours=Decimal('0.00'),
        )

        payload = build_employee_analytics(str(employee.id), month=self.day.strftime('%Y-%m'))

        self.assertEqual(payload['period']['start'], self.day.isoformat())
        self.assertEqual(payload['period']['end'], self.day.isoformat())
        self.assertEqual(payload['summary']['present_days'], 1)
        self.assertEqual(payload['summary']['absent_days'], 0)

    def test_future_joiner_in_current_month_returns_empty_analytics(self):
        future_day = self.day + timedelta(days=5)
        employee = Employee.objects.create(
            hospital=self.hospital,
            name='Future Joiner',
            email='future.joiner@test.local',
            status='active',
            shift=self.shift,
            joining_date=future_day,
            joining_date_confirmed=future_day,
        )

        payload = build_employee_analytics(str(employee.id), month=self.day.strftime('%Y-%m'))

        self.assertEqual(payload['period']['start'], self.day.replace(day=1).isoformat())
        self.assertEqual(payload['period']['end'], self.day.isoformat())
        self.assertEqual(payload['history'], [])
        self.assertEqual(payload['summary']['present_days'], 0)
        self.assertEqual(payload['summary']['working_days'], 0)
