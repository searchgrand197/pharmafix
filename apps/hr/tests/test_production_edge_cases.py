"""
Production edge-case validation — attendance ingestion, leaves, regularization, payroll.

Runs in isolated test DB; safe to execute anytime without affecting production data.
"""
from __future__ import annotations

from datetime import date, datetime, time, timedelta
from decimal import Decimal
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIRequestFactory, force_authenticate

from apps.hr.attendance_finalization_service import finalize_attendance_month, unfinalize_attendance_month
from apps.hr.attendance_seeder import generate_test_attendance
from apps.hr.biometric.ingestion import ingest_attlog_line
from apps.hr.biometric_models import BiometricDevice, BiometricRejectedPunch, BiometricUnlinkedUser
from apps.hr.models import (
    AttendancePunch,
    AttendanceRegularization,
    DailyAttendance,
    Employee,
    LeaveRequest,
    LeaveType,
    Shift,
)
from apps.hr.payroll_calculator import PayrollCalculator, generate_monthly_payroll, recalculate_payroll_run
from apps.hr.views import AttendanceRegularizationViewSet, LeaveRequestViewSet
from apps.hr.tests.payroll_test_utils import (
    assign_test_compensation,
    assert_attendance_surfaces_match,
    finalize_hospital_attendance_month,
    seed_month_attendance,
)
from apps.shared.models import Hospital

User = get_user_model()
MONTH = '2026-05'
FIXED_DAY = date(2026, 6, 18)


class ProductionEdgeCaseBase(TestCase):
    def setUp(self):
        self.hospital = Hospital.objects.create(name='Edge Hospital', slug='edge-hosp')
        self.hr_user = User.objects.create_user(
            email='hr-edge@test.local',
            password='test-pass',
            is_staff=True,
            hospital=self.hospital,
        )
        self.shift = Shift.objects.create(
            hospital=self.hospital,
            name='Day',
            code='EDGE_DAY',
            start_time=time(10, 0),
            end_time=time(19, 0),
            grace_minutes=10,
            early_punch_minutes=240,
            half_day_hours=Decimal('4'),
            full_day_hours=Decimal('8'),
            overtime_allowed=True,
        )
        self.device = BiometricDevice.objects.create(
            hospital=self.hospital,
            serial_number='EDGE-DEVICE',
            name='Gate',
        )
        self.paid_leave = LeaveType.objects.create(hospital=self.hospital, name='Paid', is_paid=True)
        self.unpaid_leave = LeaveType.objects.create(hospital=self.hospital, name='LWP', is_paid=False)

    def _employee(self, suffix: str) -> Employee:
        return Employee.objects.create(
            hospital=self.hospital,
            name=f'Edge {suffix}',
            email=f'edge-{suffix}@test.local',
            status='active',
            onboarding_completed=True,
            biometric_attendance_enabled=True,
            biometric_pin=f'8{suffix[:2]}',
            shift=self.shift,
            joining_date=date(2026, 1, 1),
        )

    def _aware(self, day: date, clock: time) -> datetime:
        tz = timezone.get_current_timezone()
        return timezone.make_aware(datetime.combine(day, clock), tz)

    def _fixed_now_patcher(self, day: date = FIXED_DAY):
        tz = timezone.get_current_timezone()
        fixed_now = timezone.make_aware(datetime.combine(day, time(21, 0)), tz)
        return patch('django.utils.timezone.now', return_value=fixed_now)


class BiometricMachineEdgeCaseTests(ProductionEdgeCaseBase):
    def test_in_out_transitions_to_late_with_work_hours(self):
        employee = self._employee('bio-out')
        employee.biometric_pin = '801'
        employee.save(update_fields=['biometric_pin'])

        tz = timezone.get_current_timezone()
        midday = timezone.make_aware(datetime.combine(FIXED_DAY, time(12, 30)), tz)
        evening = timezone.make_aware(datetime.combine(FIXED_DAY, time(21, 0)), tz)

        with patch('django.utils.timezone.now', return_value=midday):
            self.assertTrue(ingest_attlog_line(self.device, '801', self._aware(FIXED_DAY, time(12, 14)), 0, 1, 'in'))
            daily = DailyAttendance.objects.get(employee=employee, date=FIXED_DAY)
            self.assertEqual(daily.attendance_status, 'in_progress')

        with patch('django.utils.timezone.now', return_value=evening):
            self.assertTrue(ingest_attlog_line(self.device, '801', self._aware(FIXED_DAY, time(19, 0)), 0, 1, 'out'))
            daily.refresh_from_db()
            self.assertEqual(daily.attendance_status, 'late')
            self.assertGreater(daily.late_minutes, 0)
            self.assertGreater(daily.total_work_hours, Decimal('0'))

    def test_after_in_out_pair_device_reopen_creates_new_in_not_duplicate_out(self):
        """Machine alternates IN/OUT — a third tap after OUT starts a new IN cycle."""
        employee = self._employee('bio-dup')
        employee.biometric_pin = '802'
        employee.save(update_fields=['biometric_pin'])

        with self._fixed_now_patcher():
            self.assertTrue(ingest_attlog_line(self.device, '802', self._aware(FIXED_DAY, time(10, 5)), 0, 1, 'in'))
            out_ts = self._aware(FIXED_DAY, time(19, 0))
            self.assertTrue(ingest_attlog_line(self.device, '802', out_ts, 0, 1, 'out'))
            self.assertTrue(ingest_attlog_line(self.device, '802', out_ts, 0, 1, 'reopen'))
            types = list(
                AttendancePunch.objects.filter(employee=employee, is_void=False)
                .order_by('timestamp')
                .values_list('punch_type', flat=True)
            )
            self.assertEqual(types, ['IN', 'OUT', 'IN'])

    def test_too_early_punch_rejected(self):
        employee = self._employee('bio-early')
        employee.biometric_pin = '803'
        employee.save(update_fields=['biometric_pin'])

        with self._fixed_now_patcher():
            self.shift.early_punch_minutes = 30
            self.shift.save(update_fields=['early_punch_minutes'])
            too_early = self._aware(FIXED_DAY, time(8, 0))
            self.assertFalse(ingest_attlog_line(self.device, '803', too_early, 0, 1, 'early'))
            self.assertTrue(
                BiometricRejectedPunch.objects.filter(employee=employee, reason='too_early_before_shift').exists()
            )

    def test_unknown_pin_goes_to_unlinked(self):
        with self._fixed_now_patcher():
            self.assertFalse(ingest_attlog_line(self.device, '99999', self._aware(FIXED_DAY, time(10, 0)), 0, 1, 'x'))
            self.assertTrue(BiometricUnlinkedUser.objects.filter(hospital=self.hospital, pin='99999').exists())

    def test_missing_checkout_only_in_shows_missing_checkout(self):
        employee = self._employee('bio-miss')
        employee.biometric_pin = '804'
        employee.save(update_fields=['biometric_pin'])

        with self._fixed_now_patcher():
            self.assertTrue(ingest_attlog_line(self.device, '804', self._aware(FIXED_DAY, time(10, 5)), 0, 1, 'in'))
            daily = DailyAttendance.objects.get(employee=employee, date=FIXED_DAY)
            self.assertIn(daily.attendance_status, {'in_progress', 'missing_checkout'})


class LeaveAndPayrollEdgeCaseTests(ProductionEdgeCaseBase):
    def test_leave_on_day_with_punch_flags_hr_review(self):
        employee = self._employee('leave-conflict')
        day = date(2026, 5, 6)
        with self._fixed_now_patcher(day):
            ingest_attlog_line(self.device, employee.biometric_pin, self._aware(day, time(10, 5)), 0, 1, 'in')
            ingest_attlog_line(self.device, employee.biometric_pin, self._aware(day, time(19, 0)), 0, 1, 'out')

        LeaveRequest.objects.create(
            employee=employee,
            leave_type=self.paid_leave,
            start_date=day,
            end_date=day,
            status=LeaveRequest.STATUS_APPROVED,
        )
        from apps.hr.attendance_engine import recalculate_daily_attendance
        recalculate_daily_attendance(employee, day, force=True)
        daily = DailyAttendance.objects.get(employee=employee, date=day)
        self.assertEqual(daily.attendance_status, 'leave')
        self.assertTrue(daily.requires_hr_review)

    def test_unpaid_leave_adds_lop_paid_leave_does_not(self):
        employee = self._employee('leave-lop')
        assign_test_compensation(employee)
        seed_month_attendance(
            employee,
            MONTH,
            default_weekday='present',
            day_overrides={
                date(2026, 5, 6): {'attendance_status': 'present'},
                date(2026, 5, 7): {'attendance_status': 'present'},
            },
        )
        LeaveRequest.objects.create(
            employee=employee,
            leave_type=self.paid_leave,
            start_date=date(2026, 5, 6),
            end_date=date(2026, 5, 6),
            status=LeaveRequest.STATUS_APPROVED,
        )
        LeaveRequest.objects.create(
            employee=employee,
            leave_type=self.unpaid_leave,
            start_date=date(2026, 5, 7),
            end_date=date(2026, 5, 7),
            status=LeaveRequest.STATUS_APPROVED,
        )
        from apps.hr.attendance_engine import recalculate_daily_attendance
        for day in (date(2026, 5, 6), date(2026, 5, 7)):
            recalculate_daily_attendance(employee, day, force=True)
        finalize_hospital_attendance_month(self.hospital, MONTH, user=self.hr_user)

        calc = PayrollCalculator(employee=employee, month=MONTH, require_finalized_attendance=True)
        leave = calc.calculate_leave_days()
        self.assertEqual(leave.paid, Decimal('1.00'))
        self.assertEqual(leave.unpaid, Decimal('1.00'))
        lop = calc.calculate_lop()
        per_day = calc.calculate_per_day_salary()
        self.assertEqual(lop, per_day)

    def test_half_day_counts_half_present_weight_for_payroll(self):
        employee = self._employee('half-day')
        assign_test_compensation(employee)
        seed_month_attendance(
            employee,
            MONTH,
            default_weekday='present',
            day_overrides={date(2026, 5, 6): {'attendance_status': 'half_day'}},
        )
        finalize_hospital_attendance_month(self.hospital, MONTH, user=self.hr_user)
        calc = PayrollCalculator(employee=employee, month=MONTH, require_finalized_attendance=True)
        metrics = assert_attendance_surfaces_match(self, employee, MONTH, require_finalized=True)
        self.assertEqual(metrics['service']['half_days'], Decimal('1.00'))


class RegularizationPayrollEdgeCaseTests(ProductionEdgeCaseBase):
    def _approve_reg(self, reg: AttendanceRegularization):
        factory = APIRequestFactory()
        request = factory.post(f'/approve/{reg.id}/', {'remarks': 'edge test'}, format='json')
        force_authenticate(request, user=self.hr_user)
        view = AttendanceRegularizationViewSet.as_view({'post': 'approve'})
        response = view(request, pk=str(reg.id))
        self.assertLess(response.status_code, 400, response.data)

    def test_regularization_fixes_missing_checkout_and_updates_payroll(self):
        employee = self._employee('reg-pay')
        assign_test_compensation(employee)
        miss_day = date(2026, 5, 8)
        seed_month_attendance(employee, MONTH, default_weekday='present')
        DailyAttendance.objects.filter(employee=employee, date=miss_day).update(
            attendance_status='missing_checkout',
            first_check_in=self._aware(miss_day, time(10, 0)),
            last_check_out=None,
            requires_hr_review=True,
        )
        finalize_hospital_attendance_month(self.hospital, MONTH, user=self.hr_user)
        batch_before = generate_monthly_payroll(
            MONTH, calculated_by=self.hr_user, employee_queryset=Employee.objects.filter(pk=employee.pk),
        )
        run = batch_before.created[0] if batch_before.created else batch_before.recalculated[0]
        net_before = run.final_salary

        unfinalize_attendance_month(hospital=self.hospital, month=MONTH)
        reg = AttendanceRegularization.objects.create(
            employee=employee,
            requested_check_in=self._aware(miss_day, time(10, 0)),
            requested_check_out=self._aware(miss_day, time(19, 0)),
            reason='Forgot checkout',
            status='pending',
        )
        self._approve_reg(reg)
        daily = DailyAttendance.objects.get(employee=employee, date=miss_day)
        self.assertEqual(daily.attendance_status, 'present')
        self.assertIsNotNone(daily.last_check_out)

        finalize_hospital_attendance_month(self.hospital, MONTH, user=self.hr_user)
        recalculate_payroll_run(run, calculated_by=self.hr_user)
        run.refresh_from_db()
        self.assertGreaterEqual(run.final_salary, net_before)

    def test_regularization_blocked_on_finalized_month_without_unfinalize(self):
        employee = self._employee('reg-block')
        day = date(2026, 5, 9)
        seed_month_attendance(employee, MONTH, default_weekday='present')
        finalize_hospital_attendance_month(self.hospital, MONTH, user=self.hr_user)
        DailyAttendance.objects.filter(employee=employee, date=day).update(finalized=True)

        reg = AttendanceRegularization.objects.create(
            employee=employee,
            requested_check_in=self._aware(day, time(10, 0)),
            requested_check_out=self._aware(day, time(19, 0)),
            reason='Too late',
            status='pending',
        )
        factory = APIRequestFactory()
        request = factory.post(f'/approve/{reg.id}/', {}, format='json')
        force_authenticate(request, user=self.hr_user)
        view = AttendanceRegularizationViewSet.as_view({'post': 'approve'})
        response = view(request, pk=str(reg.id))
        self.assertEqual(response.status_code, 400)
        self.assertIn('finalized', response.data['error'].lower())


class PayrollMonthEdgeCaseTests(ProductionEdgeCaseBase):
    def test_finalize_blocks_when_hr_review_required(self):
        employee = self._employee('hr-review')
        seed_month_attendance(
            employee,
            MONTH,
            default_weekday='present',
            day_overrides={
                date(2026, 5, 6): {
                    'attendance_status': 'missing_checkout',
                    'requires_hr_review': True,
                    'first_check_in': timezone.now(),
                },
            },
        )
        from apps.hr.attendance_finalization_service import AttendanceFinalizationError

        with self.assertRaises(AttendanceFinalizationError):
            finalize_attendance_month(
                hospital=self.hospital,
                month=MONTH,
                finalized_by=self.hr_user,
                block_on_hr_review=True,
            )

    def test_seeder_payroll_stress_month_generates_and_finalizes(self):
        employee = self._employee('stress')
        assign_test_compensation(employee)
        summary = generate_test_attendance(
            employees=[employee],
            year=2026,
            month=5,
            scenario='payroll_stress',
            replace_existing=True,
        )
        self.assertEqual(summary.employees_processed, 1)
        self.assertGreater(summary.working_days_considered, 0)
        finalize_hospital_attendance_month(self.hospital, MONTH, user=self.hr_user)
        batch = generate_monthly_payroll(
            MONTH, calculated_by=self.hr_user, employee_queryset=Employee.objects.filter(pk=employee.pk),
        )
        self.assertEqual(len(batch.created) + len(batch.recalculated), 1, batch.errors or batch.skipped)

    def test_in_progress_day_counts_as_present_for_payroll_weight(self):
        """Checked-in but not out yet still counts as present (weight 1.0) for payroll."""
        employee = self._employee('partial')
        assign_test_compensation(employee)
        day = FIXED_DAY
        with self._fixed_now_patcher(day):
            ingest_attlog_line(self.device, employee.biometric_pin, self._aware(day, time(10, 5)), 0, 1, 'in')

        calc = PayrollCalculator(
            employee=employee,
            month=day.strftime('%Y-%m'),
            require_finalized_attendance=False,
        )
        weight = calc._present_weight_for_day(day)
        self.assertEqual(weight, Decimal('1.00'))
