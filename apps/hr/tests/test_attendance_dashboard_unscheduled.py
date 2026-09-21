from datetime import time, timedelta

from django.test import TestCase
from django.utils import timezone

from apps.hr.attendance_analytics import build_dashboard_summary
from apps.hr.attendance_engine import AttendanceCalculationService, calculate_daily_attendance
from apps.hr.models import DailyAttendance, Employee, Shift
from apps.shared.models import Hospital


class AttendanceDashboardUnscheduledTests(TestCase):
    def setUp(self):
        self.hospital = Hospital.objects.create(name='Dash Hospital', slug='dash-hospital')
        self.day = timezone.localdate()
        self.shift = Shift.objects.create(
            hospital=self.hospital,
            name='General',
            code='GEN',
            start_time=time(9, 0),
            end_time=time(18, 0),
            grace_minutes=10,
            half_day_hours=4,
            full_day_hours=8,
        )

    def test_employee_without_shift_is_unscheduled_not_absent(self):
        employee = Employee.objects.create(
            hospital=self.hospital,
            name='No Shift Yet',
            email='no-shift@example.com',
            status='active',
            shift=None,
        )
        calculated = calculate_daily_attendance(employee, self.day)
        self.assertEqual(calculated['attendance_status'], 'unscheduled')

        AttendanceCalculationService.rebuild_day(self.day, Employee.objects.filter(pk=employee.pk))
        summary = build_dashboard_summary(self.day, hospital_id=self.hospital.id, force_rebuild=True)
        self.assertEqual(summary['absent_today'], 0)
        self.assertGreaterEqual(summary['unscheduled_today'], 1)

        row = DailyAttendance.objects.get(employee=employee, date=self.day)
        self.assertEqual(row.attendance_status, 'unscheduled')

    def test_late_and_half_day_rows_still_count_as_present_headcount(self):
        late_employee = Employee.objects.create(
            hospital=self.hospital,
            name='Late Employee',
            email='late@example.com',
            status='active',
            shift=self.shift,
        )
        half_day_employee = Employee.objects.create(
            hospital=self.hospital,
            name='Half Day Employee',
            email='half@example.com',
            status='active',
            shift=self.shift,
        )

        DailyAttendance.objects.create(
            employee=late_employee,
            date=self.day,
            shift=self.shift,
            attendance_status='late',
            late_minutes=20,
        )
        DailyAttendance.objects.create(
            employee=half_day_employee,
            date=self.day,
            shift=self.shift,
            attendance_status='half_day',
        )

        summary = build_dashboard_summary(self.day, hospital_id=self.hospital.id, force_rebuild=False)

        self.assertEqual(summary['present_today'], 2)
        self.assertEqual(summary['late_employees'], 1)
        self.assertEqual(summary['half_day_today'], 1)

    def test_future_joiner_with_shift_not_counted_as_absent(self):
        future_day = self.day + timedelta(days=5)
        Employee.objects.create(
            hospital=self.hospital,
            name='Future Joiner',
            email='future-joiner@example.com',
            status='active',
            shift=self.shift,
            joining_date=future_day,
            joining_date_confirmed=future_day,
        )

        summary = build_dashboard_summary(self.day, hospital_id=self.hospital.id, force_rebuild=True)

        self.assertEqual(summary['absent_today'], 0)
        self.assertEqual(summary['not_joined_yet_today'], 1)
        self.assertFalse(
            DailyAttendance.objects.filter(
                employee__email='future-joiner@example.com',
                date=self.day,
            ).exists(),
        )
