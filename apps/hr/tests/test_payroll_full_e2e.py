"""
Full end-to-end payroll system validation — 9-phase test suite.

Validates attendance, leave, late penalty, overtime, payroll calculation,
snapshots, versioning, portal consistency, and edge cases.
"""
from __future__ import annotations

from datetime import date
from decimal import Decimal
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.test import TestCase, override_settings

from apps.hr.models import DailyAttendance, Employee, LeaveRequest, LeaveType
from apps.hr.payroll_approval import PayrollApprovalService, PayrollStateError
from apps.hr.payroll_calculator import (
    PayrollCalculator,
    PayrollCalculatorError,
    generate_monthly_payroll,
    recalculate_payroll_run,
)
from apps.hr.payroll_models import PayrollRun
from apps.hr.payslip_generator import PayslipGenerator
from apps.hr.tests.payroll_test_utils import (
    assert_attendance_surfaces_match,
    assign_test_compensation,
    deep_copy_snapshot,
    finalize_hospital_attendance_month,
    seed_month_attendance,
)
from apps.shared.models import Hospital

User = get_user_model()
MONTH = '2026-05'


class PayrollFullE2EBase(TestCase):
    """Shared fixtures for the 9-phase payroll validation suite."""

    def setUp(self):
        self.hospital = Hospital.objects.create(name='Full E2E Hospital', slug='full-e2e-payroll')
        self.hr_user = User.objects.create_user(
            email='hr-full-e2e@test.local',
            password='test-pass-123',
            is_staff=True,
            hospital=self.hospital,
        )
        self.leave_paid = LeaveType.objects.create(
            hospital=self.hospital,
            name='Casual Leave',
            is_paid=True,
        )
        self.leave_unpaid = LeaveType.objects.create(
            hospital=self.hospital,
            name='LWP',
            is_paid=False,
        )
        self.approval = PayrollApprovalService()

    def _employee(
        self,
        suffix: str,
        *,
        joining_date: date | None = None,
    ) -> Employee:
        return Employee.objects.create(
            hospital=self.hospital,
            name=f'Full E2E {suffix}',
            email=f'full-e2e-{suffix}@test.local',
            status='active',
            joining_date=joining_date or date(2026, 1, 1),
        )

    def _structure(
        self,
        employee: Employee,
        *,
        basic: str = '30000.00',
        hra: str = '10000.00',
        overtime_rate: str = '200.00',
        overtime_enabled: bool = True,
        late_policy_enabled: bool = False,
        late_penalty_value: str | None = None,
    ):
        return assign_test_compensation(
            employee,
            basic=basic,
            hra=hra,
            overtime_rate=overtime_rate,
            overtime_enabled=overtime_enabled,
            late_policy_enabled=late_policy_enabled,
            late_penalty_value=late_penalty_value,
            effective_from=date(2026, 1, 1),
        )

    def _finalize(self) -> None:
        finalize_hospital_attendance_month(self.hospital, MONTH, user=self.hr_user)

    def _generate(self, employee: Employee) -> PayrollRun:
        batch = generate_monthly_payroll(
            MONTH,
            calculated_by=self.hr_user,
            employee_queryset=Employee.objects.filter(pk=employee.pk),
        )
        self.assertEqual(len(batch.created) + len(batch.recalculated), 1, batch.errors or batch.skipped)
        if batch.created:
            return batch.created[0]
        return batch.recalculated[0]

    def _calc(self, employee: Employee) -> PayrollCalculator:
        return PayrollCalculator(employee=employee, month=MONTH, require_finalized_attendance=True)


# ---------------------------------------------------------------------------
# Phase 1 — Attendance validation
# ---------------------------------------------------------------------------


class Phase1AttendanceValidationTests(PayrollFullE2EBase):
    def test_perfect_attendance_full_month(self):
        employee = self._employee('perfect')
        self._structure(employee)
        seed_month_attendance(employee, MONTH, default_weekday='present')
        self._finalize()

        calc = self._calc(employee)
        working = calc.calculate_working_days()
        metrics = assert_attendance_surfaces_match(self, employee, MONTH, require_finalized=True)

        self.assertEqual(metrics['service']['present_days'], Decimal(str(working)))
        self.assertEqual(metrics['service']['late_days'], Decimal('0.00'))
        self.assertEqual(metrics['service']['overtime_hours'], Decimal('0.00'))
        self.assertEqual(metrics['service']['absent_days'], Decimal('0.00'))

    def test_problem_attendance_late_half_day_absent(self):
        employee = self._employee('problem')
        self._structure(employee)
        seed_month_attendance(
            employee,
            MONTH,
            default_weekday='present',
            day_overrides={
                date(2026, 5, 4): {'attendance_status': 'late', 'late_minutes': 20},
                date(2026, 5, 5): {'attendance_status': 'half_day'},
                date(2026, 5, 6): {'attendance_status': 'absent'},
                date(2026, 5, 7): {'attendance_status': 'absent'},
            },
        )
        self._finalize()

        calc = self._calc(employee)
        metrics = assert_attendance_surfaces_match(self, employee, MONTH, require_finalized=True)

        self.assertEqual(metrics['service']['late_days'], Decimal('1.00'))
        self.assertEqual(metrics['service']['half_days'], Decimal('1.00'))
        self.assertEqual(metrics['service']['absent_days'], calc.calculate_absent_days())
        self.assertEqual(calc.calculate_present_days(), Decimal('18.50'))

    def test_overtime_attendance_hr_and_portal_match(self):
        employee = self._employee('overtime-att')
        self._structure(employee)
        seed_month_attendance(
            employee,
            MONTH,
            default_weekday='present',
            day_overrides={
                date(2026, 5, 4): {'attendance_status': 'present', 'overtime_hours': Decimal('2.00')},
                date(2026, 5, 5): {'attendance_status': 'present', 'overtime_hours': Decimal('3.00')},
            },
        )
        self._finalize()

        metrics = assert_attendance_surfaces_match(self, employee, MONTH, require_finalized=True)
        self.assertEqual(metrics['service']['overtime_hours'], Decimal('5.00'))
        self.assertGreater(metrics['hr']['overtime_hours'], Decimal('0'))
        self.assertEqual(metrics['hr']['overtime_hours'], metrics['portal']['overtime_hours'])


# ---------------------------------------------------------------------------
# Phase 2 — Leave validation
# ---------------------------------------------------------------------------


class Phase2LeaveValidationTests(PayrollFullE2EBase):
    def test_paid_leave_no_deduction(self):
        employee = self._employee('paid-leave')
        self._structure(employee)
        seed_month_attendance(
            employee,
            MONTH,
            default_weekday='present',
            day_overrides={date(2026, 5, 6): {'attendance_status': 'leave', 'is_on_leave': True}},
        )
        LeaveRequest.objects.create(
            employee=employee,
            leave_type=self.leave_paid,
            start_date=date(2026, 5, 6),
            end_date=date(2026, 5, 6),
            status=LeaveRequest.STATUS_APPROVED,
        )
        self._finalize()

        calc = self._calc(employee)
        leave = calc.calculate_leave_days()
        self.assertEqual(leave.paid, Decimal('1.00'))
        self.assertEqual(leave.unpaid, Decimal('0.00'))
        self.assertEqual(calc.calculate_lop(), Decimal('0.00'))

        result = calc.calculate()
        self.assertEqual(result.lop_amount, Decimal('0.00'))

    def test_unpaid_leave_deducted(self):
        employee = self._employee('unpaid-leave')
        self._structure(employee)
        seed_month_attendance(
            employee,
            MONTH,
            default_weekday='present',
            day_overrides={date(2026, 5, 7): {'attendance_status': 'leave', 'is_on_leave': True}},
        )
        LeaveRequest.objects.create(
            employee=employee,
            leave_type=self.leave_unpaid,
            start_date=date(2026, 5, 7),
            end_date=date(2026, 5, 7),
            status=LeaveRequest.STATUS_APPROVED,
        )
        self._finalize()

        calc = self._calc(employee)
        leave = calc.calculate_leave_days()
        self.assertEqual(leave.unpaid, Decimal('1.00'))
        lop = calc.calculate_lop()
        self.assertGreater(lop, Decimal('0.00'))

    def test_mixed_leave_partial_salary_impact(self):
        employee = self._employee('mixed-leave')
        self._structure(employee)
        seed_month_attendance(
            employee,
            MONTH,
            default_weekday='present',
            day_overrides={
                date(2026, 5, 6): {'attendance_status': 'leave', 'is_on_leave': True},
                date(2026, 5, 7): {'attendance_status': 'leave', 'is_on_leave': True},
            },
        )
        LeaveRequest.objects.create(
            employee=employee,
            leave_type=self.leave_paid,
            start_date=date(2026, 5, 6),
            end_date=date(2026, 5, 6),
            status=LeaveRequest.STATUS_APPROVED,
        )
        LeaveRequest.objects.create(
            employee=employee,
            leave_type=self.leave_unpaid,
            start_date=date(2026, 5, 7),
            end_date=date(2026, 5, 7),
            status=LeaveRequest.STATUS_APPROVED,
        )
        self._finalize()

        calc = self._calc(employee)
        leave = calc.calculate_leave_days()
        self.assertEqual(leave.paid, Decimal('1.00'))
        self.assertEqual(leave.unpaid, Decimal('1.00'))

        gross = Decimal('42000.00')
        working = calc.calculate_working_days()
        per_day = (gross / Decimal(working)).quantize(Decimal('0.01'))
        expected_lop = per_day
        self.assertEqual(calc.calculate_lop(), expected_lop)


# ---------------------------------------------------------------------------
# Phase 3 — Late penalty validation
# ---------------------------------------------------------------------------


class Phase3LatePenaltyValidationTests(PayrollFullE2EBase):
    @override_settings(PAYROLL_LATE_PENALTY_THRESHOLD_MINUTES=15, PAYROLL_LATE_PENALTY_RATE_PER_MINUTE='5')
    def test_small_late_below_threshold_no_penalty(self):
        employee = self._employee('small-late')
        self._structure(employee)
        seed_month_attendance(
            employee,
            MONTH,
            default_weekday='present',
            day_overrides={
                date(2026, 5, 4): {'attendance_status': 'late', 'late_minutes': 10},
            },
        )
        self._finalize()

        calc = self._calc(employee)
        self.assertEqual(calc.calculate_late_penalty(), Decimal('0.00'))
        result = calc.calculate()
        self.assertEqual(result.late_penalty, Decimal('0.00'))

    @override_settings(PAYROLL_LATE_PENALTY_THRESHOLD_MINUTES=15, PAYROLL_LATE_PENALTY_RATE_PER_MINUTE='5')
    def test_large_late_above_threshold_per_minute_deduction(self):
        employee = self._employee('large-late')
        self._structure(employee)
        seed_month_attendance(
            employee,
            MONTH,
            default_weekday='present',
            day_overrides={
                date(2026, 5, 4): {'attendance_status': 'late', 'late_minutes': 25},
            },
        )
        self._finalize()

        calc = self._calc(employee)
        # (25 - 15) * 5 = 50
        self.assertEqual(calc.calculate_late_penalty(), Decimal('50.00'))

    @override_settings(PAYROLL_LATE_PENALTY_THRESHOLD_MINUTES=15, PAYROLL_LATE_PENALTY_RATE_PER_MINUTE='5')
    def test_multiple_late_days_aggregate_penalty(self):
        employee = self._employee('multi-late')
        self._structure(employee)
        seed_month_attendance(
            employee,
            MONTH,
            default_weekday='present',
            day_overrides={
                date(2026, 5, 4): {'attendance_status': 'late', 'late_minutes': 25},
                date(2026, 5, 5): {'attendance_status': 'late', 'late_minutes': 30},
            },
        )
        self._finalize()

        calc = self._calc(employee)
        # (10 * 5) + (15 * 5) = 125
        self.assertEqual(calc.calculate_late_penalty(), Decimal('125.00'))
        self.assertEqual(calc.calculate_late_days(), Decimal('2.00'))


# ---------------------------------------------------------------------------
# Phase 4 — Overtime validation
# ---------------------------------------------------------------------------


class Phase4OvertimeValidationTests(PayrollFullE2EBase):
    def test_overtime_allowed_hours_and_pay(self):
        employee = self._employee('ot-allowed')
        self._structure(employee, overtime_rate='200.00', overtime_enabled=True)
        seed_month_attendance(
            employee,
            MONTH,
            default_weekday='present',
            day_overrides={
                date(2026, 5, 4): {'attendance_status': 'present', 'overtime_hours': Decimal('2.00')},
            },
        )
        self._finalize()

        calc = self._calc(employee)
        self.assertEqual(calc._sum_overtime_hours(), Decimal('2.00'))
        result = calc.calculate()
        self.assertEqual(result.overtime_amount, Decimal('400.00'))
        self.assertEqual(result.attendance_summary.overtime_hours, Decimal('2.00'))

    def test_overtime_not_allowed_pay_zero_hours_tracked(self):
        employee = self._employee('ot-blocked')
        self._structure(employee, overtime_rate='200.00', overtime_enabled=False)
        seed_month_attendance(
            employee,
            MONTH,
            default_weekday='present',
            day_overrides={
                date(2026, 5, 4): {'attendance_status': 'present', 'overtime_hours': Decimal('2.00')},
            },
        )
        self._finalize()

        calc = self._calc(employee)
        compliance = calc.compute_attendance_compliance()
        self.assertEqual(compliance.overtime_hours, Decimal('2.00'))
        self.assertEqual(compliance.overtime_pay, Decimal('0.00'))
        result = calc.calculate()
        self.assertEqual(result.overtime_amount, Decimal('0.00'))


# ---------------------------------------------------------------------------
# Phase 5 — Payroll calculation validation
# ---------------------------------------------------------------------------


class Phase5PayrollCalculationValidationTests(PayrollFullE2EBase):
    def test_basic_salary_employee_earnings(self):
        employee = self._employee('basic')
        self._structure(employee)
        seed_month_attendance(employee, MONTH, default_weekday='present')
        self._finalize()

        calc = self._calc(employee)
        result = calc.calculate()
        self.assertEqual(result.gross_salary, Decimal('42000.00'))
        self.assertEqual(result.earnings_breakdown['basic_salary'], '30000.00')
        self.assertEqual(result.earnings_breakdown['hra'], '10000.00')
        self.assertEqual(result.earnings_breakdown['allowances']['transport'], 2000)

    def test_deduction_employee_pf_late_penalty(self):
        employee = self._employee('deductions')
        self._structure(employee, late_policy_enabled=True, late_penalty_value='5')
        seed_month_attendance(
            employee,
            MONTH,
            default_weekday='present',
            day_overrides={
                date(2026, 5, 4): {'attendance_status': 'late', 'late_minutes': 30},
            },
        )
        self._finalize()

        calc = self._calc(employee)
        result = calc.calculate()
        self.assertEqual(result.deductions_breakdown['fixed']['pf'], 1800)
        self.assertGreater(result.late_penalty, Decimal('0.00'))
        self.assertEqual(
            result.final_salary,
            result.gross_salary + result.overtime_amount - result.total_deductions,
        )

    @override_settings(PAYROLL_LATE_PENALTY_THRESHOLD_MINUTES=15, PAYROLL_LATE_PENALTY_RATE_PER_MINUTE='5')
    def test_full_mixed_scenario_net_formula(self):
        employee = self._employee('mixed-payroll')
        self._structure(employee)
        seed_month_attendance(
            employee,
            MONTH,
            default_weekday='present',
            day_overrides={
                date(2026, 5, 4): {'attendance_status': 'present', 'overtime_hours': Decimal('2.00')},
                date(2026, 5, 5): {'attendance_status': 'late', 'late_minutes': 25},
                date(2026, 5, 6): {'attendance_status': 'absent'},
            },
        )
        LeaveRequest.objects.create(
            employee=employee,
            leave_type=self.leave_unpaid,
            start_date=date(2026, 5, 6),
            end_date=date(2026, 5, 6),
            status=LeaveRequest.STATUS_APPROVED,
        )
        self._finalize()

        calc = self._calc(employee)
        result = calc.calculate()
        expected_net = (
            result.gross_salary + result.overtime_amount - result.total_deductions
        ).quantize(Decimal('0.01'))
        self.assertEqual(result.final_salary, expected_net)


# ---------------------------------------------------------------------------
# Phase 6 — Snapshot validation
# ---------------------------------------------------------------------------


class Phase6SnapshotValidationTests(PayrollFullE2EBase):
    def test_payroll_run_stores_input_snapshots(self):
        employee = self._employee('snapshot')
        self._structure(employee)
        seed_month_attendance(employee, MONTH, default_weekday='present')
        self._finalize()

        run = self._generate(employee)
        snapshots = (run.calculation_snapshot or {}).get('input_snapshots') or {}
        self.assertIn('attendance_rows', snapshots)
        self.assertIn('salary', snapshots)
        self.assertIn('holidays', snapshots)

    def test_attendance_update_after_payroll_does_not_change_run(self):
        employee = self._employee('snap-att')
        self._structure(employee)
        seed_month_attendance(employee, MONTH, default_weekday='present')
        self._finalize()

        run = self._generate(employee)
        frozen_net = run.final_salary
        frozen_present = run.total_present_days

        DailyAttendance.objects.filter(employee=employee, date=date(2026, 5, 8)).update(
            attendance_status='absent',
            finalized=False,
        )
        run.refresh_from_db()
        self.assertEqual(run.final_salary, frozen_net)
        self.assertEqual(run.total_present_days, frozen_present)

    def test_leave_update_after_payroll_does_not_change_run(self):
        employee = self._employee('snap-leave')
        self._structure(employee)
        seed_month_attendance(employee, MONTH, default_weekday='present')
        self._finalize()

        run = self._generate(employee)
        frozen_net = run.final_salary

        LeaveRequest.objects.create(
            employee=employee,
            leave_type=self.leave_unpaid,
            start_date=date(2026, 5, 12),
            end_date=date(2026, 5, 12),
            status=LeaveRequest.STATUS_APPROVED,
        )
        run.refresh_from_db()
        self.assertEqual(run.final_salary, frozen_net)


# ---------------------------------------------------------------------------
# Phase 7 — Versioning validation
# ---------------------------------------------------------------------------


class Phase7VersioningValidationTests(PayrollFullE2EBase):
    def test_recalculate_creates_new_version_v1_unchanged(self):
        employee = self._employee('versioning')
        level = self._structure(employee, overtime_rate='200.00')
        seed_month_attendance(
            employee,
            MONTH,
            default_weekday='present',
            day_overrides={
                date(2026, 5, 4): {'attendance_status': 'present', 'overtime_hours': Decimal('2.00')},
            },
        )
        self._finalize()

        run = self._generate(employee)
        v1_snapshot = deep_copy_snapshot(run.calculation_snapshot)
        v1_ot_amount = v1_snapshot.get('overtime_amount')
        self.assertEqual(v1_ot_amount, '400.00')

        level.overtime_rate = Decimal('300.00')
        level.save(update_fields=['overtime_rate', 'updated_at'])
        recalculate_payroll_run(run, calculated_by=self.hr_user)
        run.refresh_from_db()

        v2_snapshot = run.calculation_snapshot or {}
        self.assertEqual(v2_snapshot.get('overtime_amount'), '600.00')
        self.assertNotEqual(v2_snapshot.get('overtime_amount'), v1_ot_amount)
        # Saved v1 copy must remain unchanged (no overwrite).
        self.assertEqual(v1_snapshot.get('overtime_amount'), '400.00')

    def test_version_differences_visible_in_snapshots(self):
        employee = self._employee('version-diff')
        structure = self._structure(employee)
        seed_month_attendance(
            employee,
            MONTH,
            default_weekday='present',
            day_overrides={date(2026, 5, 4): {'attendance_status': 'absent'}},
        )
        self._finalize()

        run = self._generate(employee)
        v1_net = run.final_salary

        DailyAttendance.objects.filter(employee=employee, date=date(2026, 5, 4)).update(
            attendance_status='present',
        )
        recalculate_payroll_run(run, calculated_by=self.hr_user)
        run.refresh_from_db()

        self.assertNotEqual(run.final_salary, v1_net)
        self.assertGreater(run.final_salary, v1_net)
        self.assertIn('input_snapshots', run.calculation_snapshot or {})


# ---------------------------------------------------------------------------
# Phase 8 — Portal consistency
# ---------------------------------------------------------------------------


class Phase8PortalConsistencyTests(PayrollFullE2EBase):
    def test_hr_portal_employee_portal_and_payroll_run_match(self):
        employee = self._employee('portal')
        self._structure(employee)
        seed_month_attendance(
            employee,
            MONTH,
            default_weekday='present',
            day_overrides={
                date(2026, 5, 4): {'attendance_status': 'present', 'overtime_hours': Decimal('2.00')},
                date(2026, 5, 5): {'attendance_status': 'late', 'late_minutes': 20},
            },
        )
        self._finalize()

        metrics = assert_attendance_surfaces_match(self, employee, MONTH, require_finalized=True)
        run = self._generate(employee)
        att = (run.calculation_snapshot or {}).get('attendance_summary') or {}

        self.assertEqual(Decimal(att['present_days']), metrics['service']['present_days'])
        self.assertEqual(Decimal(att['overtime_hours']), metrics['service']['overtime_hours'])
        self.assertEqual(Decimal(att['late_days']), metrics['service']['late_days'])
        self.assertEqual(run.overtime_hours, metrics['service']['overtime_hours'])

    def test_payroll_run_matches_payslip_breakdown(self):
        employee = self._employee('payslip-match')
        self._structure(employee)
        seed_month_attendance(employee, MONTH, default_weekday='present')
        self._finalize()

        run = self._generate(employee)
        run = self.approval.submit_for_review(run, performed_by=self.hr_user)
        run = self.approval.approve_payroll(run, hr_user=self.hr_user)
        run = self.approval.lock_payroll(run, performed_by=self.hr_user)

        breakdown = PayslipGenerator().build_breakdown(run)
        self.assertEqual(breakdown.net_salary, run.final_salary)
        self.assertEqual(breakdown.gross_salary, run.gross_salary)


# ---------------------------------------------------------------------------
# Phase 9 — Edge cases
# ---------------------------------------------------------------------------


class Phase9EdgeCaseTests(PayrollFullE2EBase):
    def test_mid_month_joining_starts_attendance_from_join_date(self):
        employee = self._employee('mid-join', joining_date=date(2026, 5, 28))
        self._structure(employee)
        seed_month_attendance(
            employee,
            MONTH,
            default_weekday='absent',
            day_overrides={
                date(2026, 5, 28): {'attendance_status': 'present'},
                date(2026, 5, 29): {'attendance_status': 'present'},
            },
        )
        self._finalize()

        calc = self._calc(employee)
        self.assertEqual(calc.calculate_working_days(), 2)
        self.assertEqual(calc.calculate_present_days(), Decimal('2.00'))

    def test_employee_without_shift_fallback_handled(self):
        employee = self._employee('no-shift')
        self.assertIsNone(employee.shift_id)
        self._structure(employee)
        seed_month_attendance(employee, MONTH, default_weekday='present')
        self._finalize()

        calc = self._calc(employee)
        result = calc.calculate()
        self.assertGreater(result.final_salary, Decimal('0.00'))

    def test_missing_attendance_days_treated_as_absent(self):
        employee = self._employee('sparse-att')
        self._structure(employee)
        DailyAttendance.objects.create(
            employee=employee,
            date=date(2026, 5, 4),
            attendance_status='present',
        )
        self._finalize()

        calc = self._calc(employee)
        self.assertEqual(calc.calculate_present_days(), Decimal('1.00'))
        self.assertGreater(calc.calculate_absent_days(), Decimal('0.00'))

    def test_recalculate_blocked_after_publish(self):
        employee = self._employee('published-block')
        self._structure(employee)
        seed_month_attendance(employee, MONTH, default_weekday='present')
        self._finalize()

        run = self._generate(employee)
        run = self.approval.submit_for_review(run, performed_by=self.hr_user)
        run = self.approval.approve_payroll(run, hr_user=self.hr_user)
        run = self.approval.lock_payroll(run, performed_by=self.hr_user)

        from apps.hr.payroll_models import Payslip

        Payslip.objects.create(
            payroll_run=run,
            employee=employee,
            month=MONTH,
            gross_salary=run.gross_salary,
            net_salary=run.final_salary,
            earnings_breakdown={},
            deductions_breakdown={},
        )
        with patch('apps.hr.email_utils.send_payslip_published_email', return_value=True):
            run = self.approval.publish_payroll(run, performed_by=self.hr_user)

        with self.assertRaises(PayrollStateError):
            self.approval.recalculate(run, performed_by=self.hr_user)
        with self.assertRaises(PayrollCalculatorError):
            recalculate_payroll_run(run)
