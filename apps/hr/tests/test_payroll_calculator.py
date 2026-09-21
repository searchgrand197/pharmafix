from datetime import date
from decimal import Decimal

from django.test import TestCase, override_settings

from apps.hr.models import DailyAttendance, Employee, LeaveRequest, LeaveType, OrganizationHoliday
from apps.hr.payroll_calculator import (
    DuplicatePayrollError,
    PayrollCalculator,
    PayrollCalculatorError,
    PayrollPeriodError,
    employee_eligible_for_payroll_month,
    generate_monthly_payroll,
)
from apps.hr.payroll_models import PayrollRun, SalaryStructure
from apps.hr.tests.payroll_test_utils import finalize_hospital_attendance_month
from apps.shared.models import Hospital


class PayrollCalculatorTests(TestCase):
    def setUp(self):
        self.hospital = Hospital.objects.create(name='Payroll Hospital', slug='payroll-hospital')
        self.employee = Employee.objects.create(
            hospital=self.hospital,
            name='Payroll Employee',
            email='payroll-employee@test.local',
            status='active',
            joining_date=date(2026, 5, 1),
        )
        self.leave_type_paid = LeaveType.objects.create(hospital=self.hospital, name='Casual Leave')
        self.leave_type_unpaid = LeaveType.objects.create(hospital=self.hospital, name='LWP')
        self.month = '2026-05'
        self.structure = SalaryStructure.objects.create(
            employee=self.employee,
            basic_salary=Decimal('30000.00'),
            hra=Decimal('10000.00'),
            allowances={'transport': 2000},
            deductions={'pf': 1800},
            overtime_rate=Decimal('200.00'),
            effective_from=date(2026, 1, 1),
            is_active=True,
        )

    def _attendance(self, day: date, **kwargs):
        return DailyAttendance.objects.create(employee=self.employee, date=day, **kwargs)

    def _finalize_payroll_month(self):
        finalize_hospital_attendance_month(self.hospital, self.month)

    def _seed_may_2026(self, overrides: dict[date, str] | None = None):
        """Seed every day in May 2026; weekdays default absent, weekends default weekend."""
        overrides = overrides or {}
        for day_num in range(1, 32):
            day = date(2026, 5, day_num)
            if day in overrides:
                status = overrides[day]
            elif day.weekday() >= 5:
                status = 'weekend'
            else:
                status = 'absent'
            self._attendance(day, attendance_status=status)

    def test_calculate_working_days_excludes_weekends_and_holidays(self):
        self._seed_may_2026({
            date(2026, 5, 1): 'present',
            date(2026, 5, 4): 'holiday',
            date(2026, 5, 5): 'present',
        })

        calc = PayrollCalculator(employee=self.employee, month=self.month)
        working = calc.calculate_working_days()
        self.assertEqual(working, 20)

    def test_calculate_working_days_short_join_window(self):
        self.employee.joining_date = date(2026, 5, 28)
        self.employee.save(update_fields=['joining_date'])
        self._attendance(date(2026, 5, 28), attendance_status='present')
        self._attendance(date(2026, 5, 29), attendance_status='present')
        self._attendance(date(2026, 5, 30), attendance_status='weekend')
        self._attendance(date(2026, 5, 31), attendance_status='weekend')

        calc = PayrollCalculator(employee=self.employee, month=self.month)
        self.assertEqual(calc.calculate_working_days(), 2)

    def test_mid_month_join_prorates_gross_salary_from_full_month_working_days(self):
        employee = Employee.objects.create(
            hospital=self.hospital,
            name='June Join Employee',
            email='june-join@test.local',
            status='active',
            joining_date=date(2026, 6, 22),
        )
        SalaryStructure.objects.create(
            employee=employee,
            basic_salary=Decimal('30000.00'),
            hra=Decimal('10000.00'),
            allowances={'transport': 2000},
            deductions={'pf': 1800},
            overtime_rate=Decimal('200.00'),
            effective_from=date(2026, 1, 1),
            is_active=True,
        )
        month = '2026-06'
        present_days = [
            date(2026, 6, 22),
            date(2026, 6, 23),
            date(2026, 6, 24),
            date(2026, 6, 25),
            date(2026, 6, 26),
            date(2026, 6, 29),
            date(2026, 6, 30),
        ]
        weekend_days = [date(2026, 6, 27), date(2026, 6, 28)]
        for day in present_days:
            DailyAttendance.objects.create(employee=employee, date=day, attendance_status='present')
        for day in weekend_days:
            DailyAttendance.objects.create(employee=employee, date=day, attendance_status='weekend')

        finalize_hospital_attendance_month(self.hospital, month)
        calc = PayrollCalculator(employee=employee, month=month)

        self.assertEqual(calc.calculate_full_month_working_days(), 22)
        self.assertEqual(calc.calculate_working_days(), 7)
        self.assertEqual(calc.calculate_prorated_gross_salary(), Decimal('13363.64'))
        self.assertEqual(calc.calculate_per_day_salary(gross_monthly=calc.calculate_prorated_gross_salary(), working_days=7), Decimal('1909.09'))

        result = calc.calculate()
        self.assertEqual(result.gross_salary, Decimal('13363.64'))
        self.assertEqual(result.lop_amount, Decimal('0.00'))
        self.assertEqual(result.final_salary, Decimal('11563.64'))

    def test_present_absent_and_leave_split(self):
        self.employee.joining_date = date(2026, 5, 4)
        self.employee.save(update_fields=['joining_date'])
        self._seed_may_2026({
            date(2026, 5, 4): 'present',
            date(2026, 5, 5): 'late',
            date(2026, 5, 6): 'absent',
            date(2026, 5, 7): 'absent',
        })
        LeaveRequest.objects.create(
            employee=self.employee,
            leave_type=self.leave_type_paid,
            start_date=date(2026, 5, 6),
            end_date=date(2026, 5, 6),
            status=LeaveRequest.STATUS_APPROVED,
        )
        LeaveRequest.objects.create(
            employee=self.employee,
            leave_type=self.leave_type_unpaid,
            start_date=date(2026, 5, 7),
            end_date=date(2026, 5, 7),
            status=LeaveRequest.STATUS_APPROVED,
        )

        calc = PayrollCalculator(employee=self.employee, month=self.month)
        self.assertEqual(calc.calculate_working_days(), 20)
        self.assertEqual(calc.calculate_present_days(), Decimal('2.00'))
        leave = calc.calculate_leave_days()
        self.assertEqual(leave.paid, Decimal('1.00'))
        self.assertEqual(leave.unpaid, Decimal('1.00'))
        self.assertEqual(calc.calculate_absent_days(), Decimal('16.00'))

    def test_leave_overrides_absence(self):
        self._seed_may_2026({
            date(2026, 5, 4): 'absent',
        })
        LeaveRequest.objects.create(
            employee=self.employee,
            leave_type=self.leave_type_paid,
            start_date=date(2026, 5, 4),
            end_date=date(2026, 5, 4),
            status=LeaveRequest.STATUS_APPROVED,
        )

        calc = PayrollCalculator(employee=self.employee, month=self.month)
        self.assertEqual(calc.calculate_leave_days().paid, Decimal('1.00'))
        self.assertEqual(calc.calculate_absent_days(), Decimal('20.00'))

    def test_lop_for_unpaid_leave_and_unexcused_absence(self):
        self.employee.joining_date = date(2026, 5, 4)
        self.employee.save(update_fields=['joining_date'])
        self._seed_may_2026({
            date(2026, 5, 4): 'present',
            date(2026, 5, 5): 'absent',
            date(2026, 5, 6): 'absent',
        })
        LeaveRequest.objects.create(
            employee=self.employee,
            leave_type=self.leave_type_unpaid,
            start_date=date(2026, 5, 6),
            end_date=date(2026, 5, 6),
            status=LeaveRequest.STATUS_APPROVED,
        )

        calc = PayrollCalculator(employee=self.employee, month=self.month)
        working = calc.calculate_working_days()
        gross = calc.calculate_prorated_gross_salary()
        per_day = (gross / Decimal(working)).quantize(Decimal('0.01'))
        lop_days = calc.calculate_absent_days() + calc.calculate_leave_days().unpaid
        expected_lop = (per_day * lop_days).quantize(Decimal('0.01'))
        self.assertEqual(calc.calculate_lop(), expected_lop)
        self.assertGreater(calc.calculate_lop(), Decimal('0.00'))

    def test_overtime_and_final_salary(self):
        self._seed_may_2026({
            date(2026, 5, 4): 'present',
            date(2026, 5, 5): 'present',
        })
        DailyAttendance.objects.filter(employee=self.employee, date=date(2026, 5, 4)).update(
            overtime_hours=Decimal('2.00'),
        )

        calc = PayrollCalculator(employee=self.employee, month=self.month)
        self.assertEqual(calc.calculate_overtime(), Decimal('400.00'))
        result = calc.calculate()
        self.assertEqual(result.gross_salary, Decimal('42000.00'))
        self.assertEqual(result.overtime_amount, Decimal('400.00'))
        self.assertEqual(
            result.final_salary,
            result.gross_salary + result.overtime_amount - result.lop_amount - Decimal('1800.00') - result.late_penalty,
        )

    @override_settings(PAYROLL_LATE_PENALTY_THRESHOLD_MINUTES=10, PAYROLL_LATE_PENALTY_RATE_PER_MINUTE='5')
    def test_late_penalty_threshold_rules(self):
        self._seed_may_2026({
            date(2026, 5, 4): 'late',
            date(2026, 5, 5): 'present',
        })
        DailyAttendance.objects.filter(employee=self.employee, date=date(2026, 5, 4)).update(late_minutes=25)
        DailyAttendance.objects.filter(employee=self.employee, date=date(2026, 5, 5)).update(late_minutes=5)

        calc = PayrollCalculator(employee=self.employee, month=self.month)
        self.assertEqual(calc.calculate_late_penalty(), Decimal('75.00'))

    def test_missing_salary_structure_raises(self):
        self.structure.is_active = False
        self.structure.save(update_fields=['is_active'])
        calc = PayrollCalculator(employee=self.employee, month=self.month)
        with self.assertRaises(PayrollCalculatorError):
            calc.calculate()

    def test_build_payroll_run_defaults_to_calculated(self):
        self._attendance(date(2026, 5, 4), attendance_status='present')
        self._finalize_payroll_month()
        calc = PayrollCalculator(employee=self.employee, month=self.month)
        run = calc.build_payroll_run()
        self.assertEqual(run.status, PayrollRun.STATUS_CALCULATED)
        self.assertIsNone(run.locked_at)
        self.assertIn('working_days', run.calculation_snapshot)
        self.assertIn('input_snapshots', run.calculation_snapshot)

    def test_duplicate_payroll_prevented(self):
        self._attendance(date(2026, 5, 4), attendance_status='present')
        self._finalize_payroll_month()
        calc = PayrollCalculator(employee=self.employee, month=self.month)
        first = calc.build_payroll_run()
        first.save()
        with self.assertRaises(DuplicatePayrollError):
            calc.build_payroll_run()

    def test_generate_monthly_payroll_batch(self):
        self._attendance(date(2026, 5, 4), attendance_status='present')
        self._finalize_payroll_month()
        batch = generate_monthly_payroll(self.month)
        self.assertEqual(len(batch.created), 1)
        self.assertEqual(batch.created[0].employee_id, self.employee.pk)
        self.assertEqual(len(batch.skipped), 0)

        second = generate_monthly_payroll(self.month)
        self.assertEqual(len(second.created), 0)
        self.assertEqual(len(second.recalculated), 1)
        self.assertEqual(second.recalculated[0].employee_id, self.employee.pk)
        self.assertEqual(len(second.skipped), 0)

    def test_generate_recalculates_when_attendance_added_later(self):
        """Calculated payroll refreshes after attendance month is re-finalized."""
        from apps.hr.attendance_finalization_service import unfinalize_attendance_month

        self._finalize_payroll_month()
        batch = generate_monthly_payroll(self.month)
        self.assertEqual(len(batch.created), 1)
        run = batch.created[0]
        self.assertEqual(run.total_present_days, Decimal('0.00'))

        unfinalize_attendance_month(hospital=self.hospital, month=self.month)
        self._attendance(date(2026, 5, 4), attendance_status='present')
        self._attendance(date(2026, 5, 5), attendance_status='present')
        self._finalize_payroll_month()
        refreshed = generate_monthly_payroll(self.month)
        self.assertEqual(len(refreshed.recalculated), 1)
        run.refresh_from_db()
        self.assertEqual(run.total_present_days, Decimal('2.00'))
        self.assertGreater(run.final_salary, Decimal('0.00'))

    def test_generate_skips_employee_without_structure(self):
        other = Employee.objects.create(
            hospital=self.hospital,
            name='No Structure',
            email='no-structure@test.local',
            status='active',
            joining_date=date(2026, 5, 1),
        )
        self._attendance(date(2026, 5, 4), attendance_status='present')
        self._finalize_payroll_month()
        batch = generate_monthly_payroll(self.month)
        self.assertEqual(len(batch.created), 1)
        skipped = [row for row in batch.skipped if row['employee_id'] == other.employee_id]
        self.assertEqual(len(skipped), 1)
        self.assertEqual(skipped[0]['reason'], 'missing_salary_structure')

    def test_future_month_generation_blocked(self):
        with self.assertRaises(PayrollCalculatorError):
            generate_monthly_payroll('2099-01')

    def test_empty_deductions_and_allowances_do_not_crash(self):
        self.structure.allowances = {}
        self.structure.deductions = {}
        self.structure.save(update_fields=['allowances', 'deductions'])
        self._attendance(date(2026, 5, 4), attendance_status='present')
        self._finalize_payroll_month()
        calc = PayrollCalculator(employee=self.employee, month=self.month)
        result = calc.calculate()
        self.assertEqual(
            PayrollCalculator._fixed_deductions_from_structure(self.structure),
            Decimal('0.00'),
        )
        self.assertEqual(result.gross_salary, Decimal('40000.00'))
        run = calc.build_payroll_run()
        run.save()
        self.assertEqual(run.final_salary, result.final_salary)

    def test_mid_month_join_attendance_aggregation_june_2026(self):
        """Join 15-Jun: verify present, leave, holiday, OT match seeded DailyAttendance."""
        employee = Employee.objects.create(
            hospital=self.hospital,
            name='Mid Join Employee',
            email='mid-join@test.local',
            status='active',
            joining_date=date(2026, 6, 15),
        )
        SalaryStructure.objects.create(
            employee=employee,
            basic_salary=Decimal('20000.00'),
            hra=Decimal('5000.00'),
            allowances={'medical': 1000, 'special_allowance': 500},
            deductions={'pf': 1200},
            overtime_rate=Decimal('100.00'),
            effective_from=date(2026, 6, 1),
            is_active=True,
        )
        leave_type = LeaveType.objects.create(hospital=self.hospital, name='Casual Leave')

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
                employee=employee,
                date=day,
                attendance_status='present',
                overtime_hours=Decimal('5.00') if day == date(2026, 6, 15) else Decimal('0.00'),
                total_work_hours=Decimal('8.00'),
            )
        for day in leave_days:
            DailyAttendance.objects.create(
                employee=employee,
                date=day,
                attendance_status='leave',
                is_on_leave=True,
                leave_type=leave_type,
            )
        for day in weekend_days:
            DailyAttendance.objects.create(employee=employee, date=day, attendance_status='weekend')

        LeaveRequest.objects.create(
            employee=employee,
            leave_type=leave_type,
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

        month = '2026-06'
        finalize_hospital_attendance_month(self.hospital, month)
        calc = PayrollCalculator(employee=employee, month=month)
        period_start, period_end = calc.get_payroll_period()
        self.assertEqual(period_start, date(2026, 6, 15))
        self.assertEqual(period_end, date(2026, 6, 30))

        summary = calc.gather_attendance_summary()
        self.assertEqual(summary.present_days, Decimal('10.00'))
        self.assertEqual(summary.leave_days, Decimal('2.00'))
        self.assertEqual(summary.holiday_days, Decimal('1.00'))
        self.assertEqual(summary.overtime_hours, Decimal('5.00'))

        run = calc.build_payroll_run()
        run.save()
        att = run.calculation_snapshot['attendance_summary']
        self.assertEqual(att['present_days'], '10.00')
        self.assertEqual(att['leave_days'], '2.00')
        self.assertEqual(att['holiday_days'], '1.00')
        self.assertEqual(att['overtime_hours'], '5.00')
        self.assertEqual(run.overtime_hours, Decimal('5.00'))
        earnings = run.calculation_snapshot['earnings_breakdown']
        self.assertEqual(earnings['basic_salary'], '20000.00')
        self.assertEqual(earnings['allowances']['medical'], 1000)
        self.assertEqual(earnings['allowances']['special_allowance'], 500)
        self.assertLess(run.gross_salary, Decimal('26500.00'))

    def test_recalculate_picks_up_updated_overtime_rate(self):
        from apps.hr.payroll_calculator import recalculate_payroll_run

        self._seed_may_2026({
            date(2026, 5, 4): 'present',
        })
        DailyAttendance.objects.filter(employee=self.employee, date=date(2026, 5, 4)).update(
            overtime_hours=Decimal('2.00'),
        )
        self._finalize_payroll_month()

        calc = PayrollCalculator(employee=self.employee, month=self.month)
        run = calc.build_payroll_run()
        run.save()
        self.assertEqual(run.calculation_snapshot.get('overtime_amount'), '400.00')

        self.structure.overtime_rate = Decimal('300.00')
        self.structure.save(update_fields=['overtime_rate', 'updated_at'])

        # Simulates old bug: frozen structure on payroll run ignores updated rate.
        frozen_calc = PayrollCalculator(
            employee=self.employee,
            month=self.month,
            salary_structure=run.salary_structure,
        )
        self.assertEqual(frozen_calc.calculate_overtime(), Decimal('400.00'))

        recalculate_payroll_run(run)
        run.refresh_from_db()
        self.assertEqual(run.calculation_snapshot.get('overtime_amount'), '600.00')
        self.assertEqual(run.salary_structure_id, self.structure.id)

    def test_joined_after_month_not_eligible(self):
        employee = Employee.objects.create(
            hospital=self.hospital,
            name='Future Join',
            email='future-join@test.local',
            status='active',
            joining_date=date(2026, 7, 1),
        )
        self.assertFalse(employee_eligible_for_payroll_month(employee, '2026-06'))
        calc = PayrollCalculator(employee=employee, month='2026-06')
        with self.assertRaises(PayrollPeriodError):
            calc.get_payroll_period()
