from calendar import monthrange
from datetime import date, time, timedelta

from django.test import TestCase
from django.utils import timezone

from apps.hr.attendance_seeder import (
    employee_seed_start,
    generate_test_attendance,
    month_bounds,
)
from apps.hr.attendance_service import get_attendance_summary
from apps.hr.models import AttendancePunch, DailyAttendance, Employee, Shift
from apps.shared.models import Hospital


class AttendanceSeederJoiningDateTests(TestCase):
    def setUp(self):
        self.hospital = Hospital.objects.create(name='Seeder Hospital', slug='seeder-hospital')
        self.shift = Shift.objects.create(
            hospital=self.hospital,
            name='General',
            code='GEN',
            start_time=time(9, 0),
            end_time=time(18, 0),
            grace_minutes=10,
            half_day_hours=4,
            full_day_hours=8,
            overtime_allowed=True,
        )
        today = timezone.localdate()
        self.year = today.year
        self.month = today.month
        self.month_start, self.month_end = month_bounds(self.year, self.month)

    def _employee(self, *, joining_date: date) -> Employee:
        return Employee.objects.create(
            hospital=self.hospital,
            name='Seeder Employee',
            email=f'seeder-{joining_date.isoformat()}@test.local',
            status='active',
            shift=self.shift,
            joining_date=joining_date,
        )

    def test_starts_from_joining_date_not_month_start(self):
        joined = min(date(self.year, self.month, 10), self.month_end)
        if joined <= self.month_start:
            joined = self.month_start + timedelta(days=5)
        employee = self._employee(joining_date=joined)
        summary = generate_test_attendance(
            employees=[employee],
            year=self.year,
            month=self.month,
            scenario='perfect',
            replace_existing=True,
        )
        self.assertEqual(summary.employees_processed, 1)

        before_join = DailyAttendance.objects.filter(
            employee=employee,
            date__gte=self.month_start,
            date__lt=joined,
        ).count()
        self.assertEqual(before_join, 0)

        from_join = DailyAttendance.objects.filter(
            employee=employee,
            date__gte=joined,
            date__lte=self.month_end,
        ).count()
        _, days_in_month = monthrange(self.year, self.month)
        self.assertEqual(from_join, days_in_month - joined.day + 1)

    def test_seeds_through_month_end_with_biometric_punches(self):
        if self.month == 1:
            year, month = self.year - 1, 12
        else:
            year, month = self.year, self.month - 1
        month_start, month_end = month_bounds(year, month)
        employee = self._employee(joining_date=month_start)
        generate_test_attendance(
            employees=[employee],
            year=year,
            month=month,
            scenario='perfect',
            replace_existing=True,
        )
        punches = AttendancePunch.objects.filter(employee=employee, is_void=False)
        self.assertGreater(punches.count(), 0)
        self.assertTrue(
            punches.filter(source=AttendancePunch.SOURCE_MANUAL_BIOMETRIC_SIMULATION).exists(),
        )
        self.assertTrue(punches.filter(device_id='BIO_SIM').exists())

        last_day = month_end
        self.assertTrue(
            DailyAttendance.objects.filter(employee=employee, date=last_day).exists(),
        )

    def test_seeds_current_month_through_end(self):
        joined = self.month_start
        employee = self._employee(joining_date=joined)
        summary = generate_test_attendance(
            employees=[employee],
            year=self.year,
            month=self.month,
            scenario='perfect',
            replace_existing=True,
        )
        self.assertEqual(summary.employees_processed, 1)
        self.assertTrue(
            DailyAttendance.objects.filter(employee=employee, date=self.month_end).exists(),
        )

    def test_employee_seed_start_helper(self):
        joined = self.month_start + timedelta(days=5)
        if joined > self.month_end:
            joined = self.month_start + timedelta(days=1)
        employee = self._employee(joining_date=joined)
        self.assertEqual(employee_seed_start(employee, self.month_start), joined)

    def test_skips_employee_joining_after_month(self):
        if self.month == 12:
            after_month = date(self.year + 1, 1, 1)
        else:
            after_month = date(self.year, self.month + 1, 1)
        employee = self._employee(joining_date=after_month)
        summary = generate_test_attendance(
            employees=[employee],
            year=self.year,
            month=self.month,
            scenario='perfect',
            replace_existing=True,
        )
        self.assertEqual(summary.employees_processed, 0)
        self.assertEqual(summary.employees_skipped[0]['reason'], 'joining_date_after_month_end')

    def test_average_scenario_produces_late_and_present_from_punches(self):
        employee = self._employee(joining_date=self.month_start)
        summary = generate_test_attendance(
            employees=[employee],
            year=self.year,
            month=self.month,
            scenario='average',
            replace_existing=True,
        )
        self.assertEqual(summary.employees_processed, 1)
        self.assertGreater(summary.punches_created, 0)
        self.assertGreater(summary.present + summary.late, 0)

    def test_perfect_scenario_summary_matches_attendance_service(self):
        """Generation summary must match HR dashboard / payroll attendance service."""
        employee = self._employee(joining_date=self.month_start)
        summary = generate_test_attendance(
            employees=[employee],
            year=self.year,
            month=self.month,
            scenario='perfect',
            replace_existing=True,
        )
        canonical = get_attendance_summary(
            str(employee.id),
            self.month_start,
            self.month_end,
            require_finalized_attendance=False,
        )
        self.assertEqual(summary.present, float(canonical.present_days))
        self.assertEqual(summary.absent, float(canonical.absent_days))
        self.assertEqual(summary.late, float(canonical.late_days))
        self.assertGreater(summary.present, 0)

        rows = DailyAttendance.objects.filter(
            employee=employee,
            date__gte=self.month_start,
            date__lte=self.month_end,
        )
        punch_backed = rows.filter(
            attendance_status__in=['present', 'late', 'half_day'],
        )
        self.assertTrue(punch_backed.exists())
        for row in punch_backed:
            self.assertGreater(
                AttendancePunch.objects.filter(
                    employee=employee,
                    is_void=False,
                    attendance_date=row.date,
                ).count(),
                0,
            )

    def test_weekend_rows_preserved_after_generation(self):
        employee = self._employee(joining_date=self.month_start)
        generate_test_attendance(
            employees=[employee],
            year=self.year,
            month=self.month,
            scenario='perfect',
            replace_existing=True,
        )
        weekend_rows = DailyAttendance.objects.filter(
            employee=employee,
            date__gte=self.month_start,
            date__lte=self.month_end,
            attendance_status='weekend',
        )
        self.assertGreater(weekend_rows.count(), 0)
        for row in weekend_rows:
            self.assertGreaterEqual(row.date.weekday(), 5)

    def test_seeds_from_joining_date_when_only_confirmed_set_on_activation(self):
        joined = self.month_start + timedelta(days=3)
        if joined > self.month_end:
            joined = self.month_start
        employee = self._employee(joining_date=joined)
        employee.joining_date_confirmed = joined
        employee.save(update_fields=['joining_date_confirmed', 'updated_at'])

        summary = generate_test_attendance(
            employees=[employee],
            year=self.year,
            month=self.month,
            scenario='perfect',
            replace_existing=True,
        )
        self.assertEqual(summary.employees_processed, 1)
        self.assertEqual(
            DailyAttendance.objects.filter(
                employee=employee,
                date__gte=self.month_start,
                date__lt=joined,
            ).count(),
            0,
        )
        self.assertTrue(
            DailyAttendance.objects.filter(employee=employee, date=joined).exists(),
        )

    def test_problem_scenario_summary_matches_attendance_service(self):
        employee = self._employee(joining_date=self.month_start)
        summary = generate_test_attendance(
            employees=[employee],
            year=self.year,
            month=self.month,
            scenario='problem',
            replace_existing=True,
        )
        canonical = get_attendance_summary(
            str(employee.id),
            self.month_start,
            self.month_end,
            require_finalized_attendance=False,
        )
        self.assertEqual(summary.present, float(canonical.present_days))
        self.assertEqual(summary.absent, float(canonical.absent_days))
        self.assertEqual(summary.late, float(canonical.late_days))
        self.assertEqual(summary.half_day, float(canonical.half_days))
        self.assertGreater(summary.absent, 0)
        self.assertGreater(summary.late, 0)

    def test_overtime_scenario_summary_matches_attendance_service(self):
        employee = self._employee(joining_date=self.month_start)
        summary = generate_test_attendance(
            employees=[employee],
            year=self.year,
            month=self.month,
            scenario='overtime',
            replace_existing=True,
        )
        canonical = get_attendance_summary(
            str(employee.id),
            self.month_start,
            self.month_end,
            require_finalized_attendance=False,
        )
        self.assertEqual(summary.present, float(canonical.present_days))
        self.assertEqual(summary.absent, float(canonical.absent_days))
        self.assertEqual(summary.late, float(canonical.late_days))
        self.assertEqual(summary.overtime_hours, float(canonical.overtime_hours))
        self.assertGreater(summary.overtime, 0)
        self.assertGreater(summary.overtime_hours, 0)
        # OT scenario should not mark on-time extended days as late.
        self.assertLess(summary.late, summary.present)

    def test_perfect_summary_after_month_finalized(self):
        """Re-seeding a finalized month must still report present days from new punches."""
        from apps.hr.attendance_finalization_service import (
            finalize_attendance_month,
            is_attendance_month_finalized,
        )

        employee = self._employee(joining_date=self.month_start)
        month_str = f'{self.year}-{self.month:02d}'
        generate_test_attendance(
            employees=[employee],
            year=self.year,
            month=self.month,
            scenario='average',
            replace_existing=True,
        )
        finalize_attendance_month(hospital=self.hospital, month=month_str)
        self.assertTrue(is_attendance_month_finalized(self.hospital, month_str))

        summary = generate_test_attendance(
            employees=[employee],
            year=self.year,
            month=self.month,
            scenario='perfect',
            replace_existing=True,
            hospital_id=self.hospital.id,
        )
        canonical = get_attendance_summary(
            str(employee.id),
            self.month_start,
            self.month_end,
            require_finalized_attendance=False,
        )
        self.assertEqual(summary.present, float(canonical.present_days))
        self.assertGreater(summary.present, 0)
        self.assertFalse(is_attendance_month_finalized(self.hospital, month_str))

    def test_replace_existing_unfinalizes_month_adds_warning(self):
        from apps.hr.attendance_finalization_service import (
            finalize_attendance_month,
            is_attendance_month_finalized,
        )

        employee = self._employee(joining_date=self.month_start)
        month_str = f'{self.year}-{self.month:02d}'
        generate_test_attendance(
            employees=[employee],
            year=self.year,
            month=self.month,
            scenario='perfect',
            replace_existing=True,
        )
        finalize_attendance_month(hospital=self.hospital, month=month_str)

        summary = generate_test_attendance(
            employees=[employee],
            year=self.year,
            month=self.month,
            scenario='perfect',
            replace_existing=True,
            hospital_id=self.hospital.id,
        )
        self.assertFalse(is_attendance_month_finalized(self.hospital, month_str))
        self.assertTrue(any('unfinalized' in w.lower() for w in summary.warnings))
        payload = summary.as_dict()
        self.assertIn('warnings', payload)
        self.assertGreater(payload['present'], 0)

    def test_problem_scenario_has_more_issues_than_perfect(self):
        employee = self._employee(joining_date=self.month_start)
        perfect = generate_test_attendance(
            employees=[employee],
            year=self.year,
            month=self.month,
            scenario='perfect',
            replace_existing=True,
        )
        problem = generate_test_attendance(
            employees=[employee],
            year=self.year,
            month=self.month,
            scenario='problem',
            replace_existing=True,
        )
        self.assertGreater(perfect.present, problem.present)
        self.assertGreater(problem.late + problem.absent + problem.half_day, perfect.late + perfect.absent + perfect.half_day)

    def test_overtime_scenario_on_overnight_shift(self):
        """Overtime seeding must pair IN/OUT on overnight shifts (e.g. 18:00–00:00)."""
        overnight = Shift.objects.create(
            hospital=self.hospital,
            name='Night',
            code='NIGHT',
            start_time=time(18, 0),
            end_time=time(0, 0),
            is_overnight=True,
            grace_minutes=10,
            half_day_hours=3,
            full_day_hours=6,
            overtime_allowed=True,
        )
        employee = self._employee(joining_date=self.month_start)
        employee.shift = overnight
        employee.save(update_fields=['shift', 'updated_at'])

        summary = generate_test_attendance(
            employees=[employee],
            year=self.year,
            month=self.month,
            scenario='overtime',
            replace_existing=True,
        )
        self.assertEqual(summary.employees_processed, 1)
        self.assertGreater(summary.overtime, 0)
        self.assertGreater(summary.overtime_hours, 0)
        self.assertGreater(summary.present, 0)

        ot_rows = DailyAttendance.objects.filter(
            employee=employee,
            date__gte=self.month_start,
            date__lte=self.month_end,
            attendance_status='overtime',
        )
        self.assertGreater(ot_rows.count(), 0)
        in_progress = DailyAttendance.objects.filter(
            employee=employee,
            date__gte=self.month_start,
            date__lte=self.month_end,
            attendance_status='in_progress',
        ).count()
        self.assertEqual(in_progress, 0)
