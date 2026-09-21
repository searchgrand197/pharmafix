from datetime import date
from decimal import Decimal

from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.test import APIClient, APIRequestFactory, force_authenticate

from apps.hr.attendance_finalization_service import (
    finalize_attendance_month,
    is_attendance_month_finalized,
    unfinalize_attendance_month,
)
from apps.hr.models import DailyAttendance, Department, Designation, Employee
from apps.hr.payroll_api.compensation_level_service import (
    assign_compensation_level_to_employee,
    save_compensation_level,
)
from apps.hr.payroll_api.department_structure_service import save_department_salary_structure
from apps.hr.payroll_calculator import PayrollCalculator, generate_monthly_payroll
from apps.hr.payroll_models import PayrollRun
from apps.hr.payroll_structure_resolver import resolve_compensation
from apps.hr.tests.payroll_test_utils import finalize_hospital_attendance_month
from apps.shared.models import Hospital

User = get_user_model()


class PayrollReconciliationTests(TestCase):
    def setUp(self):
        self.hospital = Hospital.objects.create(name='Reconciliation Hospital', slug='recon-hosp')
        self.department = Department.objects.create(hospital=self.hospital, name='Clinical')
        self.designation = Designation.objects.create(hospital=self.hospital, name='Doctor')
        self.month = '2026-05'
        self.effective = date(2026, 1, 1)

        self.base_level = save_compensation_level(
            hospital=self.hospital,
            designation=self.designation,
            code='DOCTOR_L0',
            name='Doctor Base',
            rank=0,
            basic=Decimal('50000.00'),
            hra=Decimal('10000.00'),
            medical=Decimal('1000.00'),
            special_allowance=Decimal('1000.00'),
            allowances={},
            deductions={},
            overtime_rate=Decimal('200.00'),
            effective_from=self.effective,
            compliance_fields={
                'late_policy_enabled': True,
                'late_penalty_type': 'per_minute',
                'late_penalty_value': Decimal('5.00'),
                'late_penalty_threshold_minutes': 15,
                'overtime_enabled': True,
                'overtime_type': 'fixed_per_hour',
            },
        )
        self.dept_override = save_department_salary_structure(
            department=self.department,
            effective_from=self.effective,
            basic_salary=Decimal('55000.00'),
            hra=Decimal('12000.00'),
            allowances={'medical': 1500},
            deductions={'pf': 1800},
            overtime_rate=Decimal('250.00'),
        )

        self.employee = Employee.objects.create(
            hospital=self.hospital,
            name='Recon Doctor',
            email='recon-doctor@test.local',
            status='active',
            joining_date=date(2026, 1, 1),
            designation=self.designation,
            department_ref=self.department,
        )
        assign_compensation_level_to_employee(
            employee=self.employee,
            level=self.base_level,
            effective_from=self.effective,
        )

    def _seed_and_finalize_may(self):
        for day_num in range(1, 32):
            day = date(2026, 5, day_num)
            status = 'weekend' if day.weekday() >= 5 else 'present'
            DailyAttendance.objects.create(
                employee=self.employee,
                date=day,
                attendance_status=status,
            )
        finalize_hospital_attendance_month(self.hospital, self.month)

    def test_merge_department_override_over_compensation_level(self):
        resolved = resolve_compensation(self.employee, self.month)
        self.assertIsNotNone(resolved)
        self.assertEqual(resolved.basic_salary, Decimal('55000.00'))
        self.assertEqual(resolved.hra, Decimal('12000.00'))
        self.assertEqual(resolved.overtime_rate, Decimal('250.00'))
        self.assertIsNotNone(resolved.source_department_override)

    def test_finalize_month_sets_rows_finalized(self):
        DailyAttendance.objects.create(
            employee=self.employee,
            date=date(2026, 5, 5),
            attendance_status='present',
        )
        finalize_attendance_month(hospital=self.hospital, month=self.month)
        row = DailyAttendance.objects.get(employee=self.employee, date=date(2026, 5, 5))
        self.assertTrue(row.finalized)
        self.assertTrue(is_attendance_month_finalized(self.hospital, self.month))

    def test_payroll_skips_when_month_not_finalized(self):
        DailyAttendance.objects.create(
            employee=self.employee,
            date=date(2026, 5, 5),
            attendance_status='present',
            finalized=True,
        )
        result = generate_monthly_payroll(
            self.month,
            employee_queryset=Employee.objects.filter(pk=self.employee.pk),
        )
        self.assertEqual(len(result.created), 0)
        self.assertTrue(
            any(item.get('reason') == 'attendance_not_finalized' for item in result.skipped),
        )

    def test_payroll_ignores_non_finalized_rows(self):
        DailyAttendance.objects.create(
            employee=self.employee,
            date=date(2026, 5, 5),
            attendance_status='present',
            finalized=False,
        )
        DailyAttendance.objects.create(
            employee=self.employee,
            date=date(2026, 5, 6),
            attendance_status='present',
            finalized=True,
        )
        calc = PayrollCalculator(
            employee=self.employee,
            month=self.month,
            require_finalized_attendance=True,
        )
        rows = calc._attendance_rows()
        self.assertEqual(len(rows), 1)
        self.assertIn(date(2026, 5, 6), rows)

    def test_reconciliation_snapshot_on_run(self):
        self._seed_and_finalize_may()
        result = generate_monthly_payroll(
            self.month,
            employee_queryset=Employee.objects.filter(pk=self.employee.pk),
        )
        self.assertEqual(len(result.created), 1)
        run = result.created[0]
        snapshots = (run.calculation_snapshot or {}).get('input_snapshots') or {}
        self.assertIn('attendance_rows', snapshots)
        self.assertIn('salary', snapshots)
        self.assertIn('holidays', snapshots)
        self.assertEqual(run.status, PayrollRun.STATUS_CALCULATED)

    def test_unfinalize_clears_month_lock(self):
        finalize_hospital_attendance_month(self.hospital, self.month)
        unfinalize_attendance_month(hospital=self.hospital, month=self.month)
        self.assertFalse(is_attendance_month_finalized(self.hospital, self.month))

    def test_merge_without_override_uses_compensation_level_base(self):
        employee = Employee.objects.create(
            hospital=self.hospital,
            name='No Dept Override',
            email='no-dept@test.local',
            status='active',
            joining_date=date(2026, 1, 1),
            designation=self.designation,
        )
        assign_compensation_level_to_employee(
            employee=employee,
            level=self.base_level,
            effective_from=self.effective,
        )
        resolved = resolve_compensation(employee, self.month)
        self.assertEqual(resolved.basic_salary, Decimal('50000.00'))
        self.assertIsNone(resolved.source_department_override)


class PayrollGenerateAutoFinalizeApiTests(TestCase):
    def setUp(self):
        self.hospital = Hospital.objects.create(name='Auto Finalize Hospital', slug='auto-finalize')
        self.hr_user = User.objects.create_user(
            email='hr-auto-finalize@test.local',
            password='test-pass-123',
            is_staff=True,
            hospital=self.hospital,
            must_change_password=False,
        )
        self.department = Department.objects.create(hospital=self.hospital, name='Clinical')
        self.designation = Designation.objects.create(hospital=self.hospital, name='Nurse')
        self.month = '2026-05'
        self.effective = date(2026, 1, 1)
        self.level = save_compensation_level(
            hospital=self.hospital,
            designation=self.designation,
            code='NURSE_L0',
            name='Nurse Base',
            rank=0,
            basic=Decimal('40000.00'),
            hra=Decimal('8000.00'),
            medical=Decimal('1000.00'),
            special_allowance=Decimal('1000.00'),
            allowances={},
            deductions={},
            overtime_rate=Decimal('200.00'),
            effective_from=self.effective,
        )
        self.employee = Employee.objects.create(
            hospital=self.hospital,
            name='Auto Finalize Nurse',
            email='auto-finalize-nurse@test.local',
            status='active',
            joining_date=date(2026, 1, 1),
            designation=self.designation,
            department_ref=self.department,
        )
        assign_compensation_level_to_employee(
            employee=self.employee,
            level=self.level,
            effective_from=self.effective,
        )
        DailyAttendance.objects.create(
            employee=self.employee,
            date=date(2026, 5, 5),
            attendance_status='present',
            finalized=False,
        )
        self.factory = APIRequestFactory()
        self.client = APIClient()
        self.client.raise_request_exception = True
        self.client.force_authenticate(user=self.hr_user)

    def _post_run(self):
        from apps.hr.payroll_api.views import PayrollGenerateView

        request = self.factory.post('/api/payroll/run/', {'month': self.month}, format='json')
        force_authenticate(request, user=self.hr_user)
        view = PayrollGenerateView()
        drf_request = view.initialize_request(request)
        view.request = drf_request
        view.args = ()
        view.kwargs = {}
        view.headers = view.default_response_headers
        view.initial(drf_request)
        return view.post(drf_request)

    def test_payroll_run_auto_finalizes_attendance_when_month_not_closed(self):
        self.assertFalse(is_attendance_month_finalized(self.hospital, self.month))

        res = self._post_run()

        self.assertIn(res.status_code, {200, 201}, res.data)
        self.assertTrue(res.data.get('attendance_auto_finalized'))
        self.assertIn('attendance_finalization', res.data)
        self.assertGreaterEqual(res.data.get('created_count', 0), 1)
        self.assertTrue(is_attendance_month_finalized(self.hospital, self.month))

    def test_payroll_run_does_not_report_auto_finalize_when_already_closed(self):
        finalize_attendance_month(hospital=self.hospital, month=self.month)

        res = self._post_run()

        self.assertIn(res.status_code, {200, 201}, res.data)
        self.assertFalse(res.data.get('attendance_auto_finalized'))
        self.assertNotIn('attendance_finalization', res.data)


class PayrollBlockedReasonTests(TestCase):
    def setUp(self):
        from apps.hr.payroll_models import SalaryStructure
        from apps.hr.payroll_reconciliation_engine import employee_payroll_blocked_reason

        self.blocked_reason = employee_payroll_blocked_reason
        self.hospital = Hospital.objects.create(name='Blocked Reason Hospital', slug='blocked-reason')
        self.department = Department.objects.create(hospital=self.hospital, name='Ops')
        self.designation = Designation.objects.create(hospital=self.hospital, name='Helper')
        self.month = '2026-05'
        self.employee = Employee.objects.create(
            hospital=self.hospital,
            name='Legacy Only',
            email='legacy-only@test.local',
            status='active',
            joining_date=date(2026, 1, 1),
            designation=self.designation,
            department_ref=self.department,
        )
        SalaryStructure.objects.create(
            employee=self.employee,
            basic_salary=Decimal('25000.00'),
            hra=Decimal('5000.00'),
            effective_from=date(2026, 1, 1),
            is_active=True,
        )
        finalize_attendance_month(hospital=self.hospital, month=self.month)

    def test_blocked_reason_allows_legacy_salary_structure_fallback(self):
        reason = self.blocked_reason(self.employee, self.month)
        self.assertIsNone(reason)

    def test_payroll_run_processes_legacy_salary_structure_fallback(self):
        hr_user = User.objects.create_user(
            email='hr-blocked@test.local',
            password='test-pass-123',
            is_staff=True,
            hospital=self.hospital,
            must_change_password=False,
        )
        client = APIClient()
        client.force_authenticate(user=hr_user)

        res = client.post('/api/payroll/run/', {'month': self.month}, format='json')

        self.assertIn(res.status_code, {200, 201}, res.data)
        skipped = res.data.get('skipped') or []
        self.assertFalse(
            any(
                row.get('employee_id') == self.employee.employee_id
                and row.get('reason') == 'missing_compensation_assignment'
                for row in skipped
            ),
        )
        self.assertEqual(res.data.get('errors') or [], [])
        created = res.data.get('created') or res.data.get('runs') or []
        # Accept either created list shape or payroll count depending on API
        employee_processed = any(
            row.get('employee_id') == self.employee.employee_id
            or str(row.get('employee')) == str(self.employee.id)
            for row in created
            if isinstance(row, dict)
        )
        if not employee_processed:
            from apps.hr.payroll_models import PayrollRun
            self.assertTrue(
                PayrollRun.objects.filter(employee=self.employee, month=self.month).exists(),
            )
