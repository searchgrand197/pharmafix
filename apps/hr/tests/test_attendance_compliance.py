from datetime import date
from decimal import Decimal

from django.test import TestCase

from apps.hr.attendance_compliance import (
    calculate_late_equivalent_days,
    calculate_late_penalty_with_policy,
    calculate_overtime_pay,
    CompliancePolicy,
    resolve_compliance_policy,
)
from apps.hr.models import DailyAttendance, Employee, OrganizationHoliday
from apps.hr.payroll_calculator import PayrollCalculator
from apps.hr.payroll_models import SalaryStructure
from apps.shared.models import Hospital


class AttendanceComplianceUnitTests(TestCase):
    def test_case4_late_penalty_per_minute(self):
        policy = CompliancePolicy(
            late_policy_enabled=True,
            late_penalty_threshold_minutes=15,
            late_penalty_type='per_minute',
            late_penalty_value=Decimal('2.00'),
        )
        penalty, _rates = calculate_late_penalty_with_policy(
            policy=policy,
            late_day_metrics=[{'late_minutes': 42}],
            per_day_salary=Decimal('1000.00'),
        )
        self.assertEqual(penalty, Decimal('54.00'))

    def test_case1_late_conversion_half_day(self):
        policy = CompliancePolicy(
            late_conversion_enabled=True,
            late_count_for_half_day=3,
            late_count_for_full_day=6,
        )
        self.assertEqual(calculate_late_equivalent_days(policy, 3), Decimal('0.50'))
        self.assertEqual(calculate_late_equivalent_days(policy, 6), Decimal('1.00'))

    def test_case2_overtime_flat_rate(self):
        policy = CompliancePolicy(
            overtime_enabled=True,
            overtime_type='fixed_per_hour',
            overtime_rate=Decimal('100.00'),
        )
        ot_pay, hours, _rates = calculate_overtime_pay(
            policy=policy,
            ot_by_day=[(date(2026, 5, 4), Decimal('20'))],
            holiday_dates=set(),
            is_weekend_fn=lambda d: d.weekday() >= 5,
            gross_monthly=Decimal('42000.00'),
            working_days=21,
        )
        self.assertEqual(hours, Decimal('20.00'))
        self.assertEqual(ot_pay, Decimal('2000.00'))

    def test_case3_holiday_overtime_multiplier(self):
        holiday = date(2026, 5, 4)
        policy = CompliancePolicy(
            overtime_enabled=True,
            overtime_type='fixed_per_hour',
            overtime_rate=Decimal('100.00'),
            holiday_ot_multiplier=Decimal('2.00'),
        )
        ot_pay, _, _rates = calculate_overtime_pay(
            policy=policy,
            ot_by_day=[(holiday, Decimal('5'))],
            holiday_dates={holiday},
            is_weekend_fn=lambda d: d.weekday() >= 5,
            gross_monthly=Decimal('42000.00'),
            working_days=21,
        )
        self.assertEqual(ot_pay, Decimal('1000.00'))


class AttendanceCompliancePayrollIntegrationTests(TestCase):
    def setUp(self):
        self.hospital = Hospital.objects.create(name='Compliance Hospital', slug='compliance-hospital')
        self.employee = Employee.objects.create(
            hospital=self.hospital,
            name='Compliance Employee',
            email='compliance-employee@test.local',
            status='active',
            joining_date=date(2026, 5, 1),
        )
        self.month = '2026-05'
        self.structure = SalaryStructure.objects.create(
            employee=self.employee,
            basic_salary=Decimal('30000.00'),
            hra=Decimal('10000.00'),
            allowances={'transport': 2000},
            deductions={'pf': 1800},
            overtime_rate=Decimal('100.00'),
            effective_from=date(2026, 1, 1),
            is_active=True,
        )

    def _attendance(self, day: date, **kwargs):
        return DailyAttendance.objects.create(employee=self.employee, date=day, **kwargs)

    def test_payroll_late_conversion_deduction(self):
        self.structure.late_conversion_enabled = True
        self.structure.late_count_for_half_day = 3
        self.structure.late_count_for_full_day = 6
        self.structure.save()

        for day in (date(2026, 5, 4), date(2026, 5, 5), date(2026, 5, 6)):
            self._attendance(day, attendance_status='late', late_minutes=10)

        calc = PayrollCalculator(employee=self.employee, month=self.month)
        result = calc.calculate()
        per_day = result.per_day_salary
        self.assertEqual(result.late_equivalent_leave_days, Decimal('0.50'))
        self.assertEqual(result.late_conversion_deduction, (per_day * Decimal('0.50')).quantize(Decimal('0.01')))

    def test_payroll_structure_late_penalty_policy(self):
        self.structure.late_policy_enabled = True
        self.structure.late_penalty_threshold_minutes = 15
        self.structure.late_penalty_type = 'per_minute'
        self.structure.late_penalty_value = Decimal('2.00')
        self.structure.save()

        self._attendance(date(2026, 5, 4), attendance_status='late', late_minutes=42)

        calc = PayrollCalculator(employee=self.employee, month=self.month)
        result = calc.calculate()
        self.assertEqual(result.late_penalty, Decimal('54.00'))

    def test_payroll_snapshot_includes_compliance_audit(self):
        self._attendance(date(2026, 5, 4), attendance_status='present', overtime_hours=Decimal('2'))
        calc = PayrollCalculator(employee=self.employee, month=self.month)
        run = calc.build_payroll_run()
        snapshot = run.calculation_snapshot
        self.assertIn('compliance', snapshot)
        self.assertIn('compliance_audit', snapshot)
        self.assertIn('policy_used', snapshot['compliance_audit'])
        self.assertIn('calculation_timestamp', snapshot['compliance_audit'])

    def test_legacy_late_penalty_unchanged_when_policy_disabled(self):
        from django.test import override_settings

        self._attendance(date(2026, 5, 4), attendance_status='late', late_minutes=25)
        with override_settings(PAYROLL_LATE_PENALTY_THRESHOLD_MINUTES=10, PAYROLL_LATE_PENALTY_RATE_PER_MINUTE='5'):
            calc = PayrollCalculator(employee=self.employee, month=self.month)
            self.assertEqual(calc.calculate_late_penalty(), Decimal('75.00'))

    def test_holiday_overtime_in_payroll(self):
        holiday = date(2026, 5, 4)
        OrganizationHoliday.objects.create(
            scope=OrganizationHoliday.SCOPE_NATIONAL,
            name='Test Holiday',
            date=holiday,
            is_paid_day=True,
        )
        self.structure.holiday_ot_multiplier = Decimal('2.00')
        self.structure.save()
        self._attendance(holiday, attendance_status='overtime', overtime_hours=Decimal('5'))

        calc = PayrollCalculator(employee=self.employee, month=self.month)
        result = calc.calculate()
        self.assertEqual(result.overtime_amount, Decimal('1000.00'))

    def test_warning_when_ot_hours_but_zero_rate(self):
        self.structure.overtime_rate = Decimal('0.00')
        self.structure.save(update_fields=['overtime_rate'])
        self._attendance(date(2026, 5, 4), attendance_status='overtime', overtime_hours=Decimal('3'))
        calc = PayrollCalculator(employee=self.employee, month=self.month)
        result = calc.calculate()
        self.assertEqual(result.overtime_amount, Decimal('0.00'))
        joined = ' '.join(result.compliance_warnings + result.warnings)
        self.assertIn('OT hour', joined)
        self.assertIn('overtime rate ₹0/hr', joined)

    def test_warning_when_late_penalty_much_higher_than_legacy(self):
        self.structure.late_policy_enabled = True
        self.structure.late_penalty_value = Decimal('99.99')
        self.structure.late_penalty_type = 'per_minute'
        self.structure.save()
        self._attendance(date(2026, 5, 4), attendance_status='late', late_minutes=52)
        calc = PayrollCalculator(employee=self.employee, month=self.month)
        result = calc.calculate()
        joined = ' '.join(result.compliance_warnings + result.warnings)
        self.assertIn('Review attendance compliance', joined)
        self.assertGreater(result.late_penalty, Decimal('500'))
