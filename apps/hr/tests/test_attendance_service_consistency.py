"""HR dashboard, employee portal, and payroll must share identical attendance summaries."""

from calendar import monthrange
from datetime import date
from decimal import Decimal

from django.test import TestCase

from apps.hr.attendance_analytics import build_employee_analytics
from apps.hr.attendance_service import get_attendance_summary
from apps.hr.models import DailyAttendance, Employee, LeaveRequest, LeaveType, OrganizationHoliday
from apps.hr.payroll_calculator import PayrollCalculator, parse_payroll_month
from apps.shared.models import Hospital


class AttendanceSummaryConsistencyTests(TestCase):
    """Employee joining on the 15th: all surfaces must report the same totals."""

    def setUp(self):
        self.hospital = Hospital.objects.create(name='Consistency Hosp', slug='consistency-hosp')
        self.month = '2026-06'
        self.month_start, self.month_end = parse_payroll_month(self.month)
        self.join_date = date(2026, 6, 15)
        self.employee = Employee.objects.create(
            hospital=self.hospital,
            name='Mid Month Join',
            email='mid-month@test.local',
            status='active',
            joining_date=self.join_date,
            joining_date_confirmed=self.join_date,
        )
        self.leave_type = LeaveType.objects.create(hospital=self.hospital, name='Casual Leave')

        present_days = [
            date(2026, 6, 15),
            date(2026, 6, 16),
            date(2026, 6, 17),
            date(2026, 6, 18),
            date(2026, 6, 19),
            date(2026, 6, 22),
            date(2026, 6, 25),
            date(2026, 6, 26),
            date(2026, 6, 29),
            date(2026, 6, 30),
        ]
        leave_days = [date(2026, 6, 23), date(2026, 6, 24)]
        weekend_days = [date(2026, 6, 20), date(2026, 6, 21), date(2026, 6, 27), date(2026, 6, 28)]

        for day in present_days:
            DailyAttendance.objects.create(
                employee=self.employee,
                date=day,
                attendance_status='present',
                overtime_hours=Decimal('5.00') if day == date(2026, 6, 15) else Decimal('0.00'),
                total_work_hours=Decimal('8.00'),
            )
        for day in leave_days:
            DailyAttendance.objects.create(
                employee=self.employee,
                date=day,
                attendance_status='leave',
                is_on_leave=True,
                leave_type=self.leave_type,
            )
        for day in weekend_days:
            DailyAttendance.objects.create(
                employee=self.employee,
                date=day,
                attendance_status='weekend',
            )

        LeaveRequest.objects.create(
            employee=self.employee,
            leave_type=self.leave_type,
            start_date=date(2026, 6, 23),
            end_date=date(2026, 6, 24),
            status=LeaveRequest.STATUS_APPROVED,
        )
        OrganizationHoliday.objects.create(
            scope=OrganizationHoliday.SCOPE_NATIONAL,
            name='Festival',
            date=date(2026, 6, 21),
            active=True,
        )

    def _portal_core_metrics(self, summary: dict) -> dict:
        return {
            'present_days': Decimal(str(summary['present_days'])).quantize(Decimal('0.01')),
            'absent_days': Decimal(str(summary['absent_days'])).quantize(Decimal('0.01')),
            'leave_days': Decimal(str(summary['leave_days'])).quantize(Decimal('0.01')),
            'holiday_days': Decimal(str(summary.get('holiday_days', 0))).quantize(Decimal('0.01')),
            'late_days': Decimal(str(summary['late_days'])).quantize(Decimal('0.01')),
            'overtime_hours': Decimal(str(summary['total_overtime_hours'])).quantize(Decimal('0.01')),
            'working_hours': Decimal(str(summary['total_work_hours'])).quantize(Decimal('0.01')),
        }

    def test_hr_portal_and_payroll_match_for_mid_month_join(self):
        service_summary = get_attendance_summary(
            str(self.employee.id),
            self.month_start,
            self.month_end,
        )
        payroll_summary = PayrollCalculator(employee=self.employee, month=self.month).gather_attendance_summary()
        hr_analytics = build_employee_analytics(str(self.employee.id), month=self.month)
        portal_analytics = build_employee_analytics(str(self.employee.id), month=self.month)

        self.assertEqual(service_summary.period_start, self.join_date)
        self.assertEqual(service_summary.period_end, self.month_end)

        expected = {
            'present_days': Decimal('10.00'),
            'absent_days': payroll_summary.absent_days,
            'leave_days': Decimal('2.00'),
            'holiday_days': Decimal('1.00'),
            'late_days': Decimal('0.00'),
            'overtime_hours': Decimal('5.00'),
            'working_hours': Decimal('80.00'),
        }
        self.assertEqual(service_summary.present_days, expected['present_days'])
        self.assertEqual(service_summary.leave_days, expected['leave_days'])
        self.assertEqual(service_summary.holiday_days, expected['holiday_days'])
        self.assertEqual(service_summary.overtime_hours, expected['overtime_hours'])
        self.assertEqual(service_summary.working_hours, expected['working_hours'])

        payroll_core = {
            'present_days': payroll_summary.present_days,
            'absent_days': payroll_summary.absent_days,
            'leave_days': payroll_summary.leave_days,
            'holiday_days': payroll_summary.holiday_days,
            'late_days': payroll_summary.late_days,
            'overtime_hours': payroll_summary.overtime_hours,
            'working_hours': payroll_summary.total_work_hours,
        }
        service_core = {
            'present_days': service_summary.present_days,
            'absent_days': service_summary.absent_days,
            'leave_days': service_summary.leave_days,
            'holiday_days': service_summary.holiday_days,
            'late_days': service_summary.late_days,
            'overtime_hours': service_summary.overtime_hours,
            'working_hours': service_summary.working_hours,
        }
        self.assertEqual(payroll_core, service_core)

        hr_core = self._portal_core_metrics(hr_analytics['summary'])
        portal_core = self._portal_core_metrics(portal_analytics['summary'])
        self.assertEqual(hr_core, portal_core)
        self.assertEqual(hr_core['present_days'], service_summary.present_days)
        self.assertEqual(hr_core['leave_days'], service_summary.leave_days)
        self.assertEqual(hr_core['holiday_days'], service_summary.holiday_days)
        self.assertEqual(hr_core['overtime_hours'], service_summary.overtime_hours)
        self.assertEqual(hr_core['working_hours'], service_summary.working_hours)
        self.assertEqual(hr_core['absent_days'], service_summary.absent_days)
        self.assertEqual(hr_core['late_days'], service_summary.late_days)

        self.assertEqual(hr_analytics['period']['start'], self.join_date.isoformat())
        self.assertEqual(hr_analytics['period']['end'], self.month_end.isoformat())
