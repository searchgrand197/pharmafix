from datetime import date
from decimal import Decimal

from django.contrib.auth import get_user_model
from django.test import RequestFactory, TestCase
from rest_framework.test import APIClient, APITestCase

from apps.hr.models import DailyAttendance, Designation, Employee
from apps.hr.payroll_api.compensation_level_service import (
    assign_compensation_level_to_employee,
    save_compensation_level,
    save_employee_compensation_override,
)
from apps.hr.payroll_calculator import PayrollCalculator, generate_monthly_payroll
from apps.hr.payroll_models import (
    CompensationLevel,
    EmployeeCompensationAssignment,
    EmployeeCompensationOverride,
    PayrollRun,
    SalaryStructure,
)
from apps.hr.payroll_structure_resolver import resolve_compensation
from apps.hr.serializers import EmployeeSerializer
from apps.hr.tests.payroll_test_utils import finalize_hospital_attendance_month
from apps.shared.models import Hospital

User = get_user_model()


class CompensationLevelPayrollTests(TestCase):
    def setUp(self):
        self.hospital = Hospital.objects.create(name='Comp Level Hospital', slug='comp-level-hosp')
        self.designation = Designation.objects.create(hospital=self.hospital, name='Nurse', code='NURSE')
        self.month = '2026-05'

        self.level_l0 = save_compensation_level(
            hospital=self.hospital,
            designation=self.designation,
            code='NURSE_L0',
            name='Nurse Level 0',
            rank=0,
            basic=Decimal('30000.00'),
            hra=Decimal('8000.00'),
            medical=Decimal('1000.00'),
            special_allowance=Decimal('1000.00'),
            allowances={},
            deductions={'pf': 1800},
            overtime_rate=Decimal('120.00'),
            effective_from=date(2026, 1, 1),
            is_default_for_designation=True,
            compliance_fields={
                'overtime_enabled': True,
                'overtime_type': 'fixed_per_hour',
            },
        )
        self.level_l1 = save_compensation_level(
            hospital=self.hospital,
            designation=self.designation,
            code='NURSE_L1',
            name='Nurse Level 1',
            rank=1,
            basic=Decimal('36000.00'),
            hra=Decimal('9000.00'),
            medical=Decimal('1500.00'),
            special_allowance=Decimal('2500.00'),
            allowances={'transport': '1500.00'},
            deductions={'pf': 2200},
            overtime_rate=Decimal('150.00'),
            effective_from=date(2026, 1, 1),
            is_default_for_designation=False,
            compliance_fields={
                'overtime_enabled': True,
                'overtime_type': 'fixed_per_hour',
            },
        )

    def test_same_designation_different_levels_resolve_different_gross(self):
        junior = Employee.objects.create(
            hospital=self.hospital,
            name='Junior Nurse',
            email='junior-nurse@test.local',
            status='active',
            joining_date=date(2026, 1, 1),
            designation=self.designation,
        )
        senior = Employee.objects.create(
            hospital=self.hospital,
            name='Senior Nurse',
            email='senior-nurse@test.local',
            status='active',
            joining_date=date(2026, 1, 1),
            designation=self.designation,
        )
        assign_compensation_level_to_employee(employee=junior, level=self.level_l0, effective_from=date(2026, 1, 1))
        assign_compensation_level_to_employee(employee=senior, level=self.level_l1, effective_from=date(2026, 1, 1))

        junior_calc = PayrollCalculator(employee=junior, month=self.month)
        senior_calc = PayrollCalculator(employee=senior, month=self.month)

        junior_gross = junior_calc._gross_from_structure(junior_calc.get_active_salary_structure())
        senior_gross = senior_calc._gross_from_structure(senior_calc.get_active_salary_structure())

        self.assertEqual(junior_gross, Decimal('40000.00'))
        self.assertEqual(senior_gross, Decimal('50500.00'))
        self.assertGreater(senior_gross, junior_gross)

    def test_effective_dated_level_promotion_supersedes_prior_assignment(self):
        employee = Employee.objects.create(
            hospital=self.hospital,
            name='Promoted Nurse',
            email='promoted-nurse@test.local',
            status='active',
            joining_date=date(2026, 1, 1),
            designation=self.designation,
        )
        first, _legacy, _ = assign_compensation_level_to_employee(
            employee=employee,
            level=self.level_l0,
            effective_from=date(2026, 1, 1),
        )
        second, _legacy, _ = assign_compensation_level_to_employee(
            employee=employee,
            level=self.level_l1,
            effective_from=date(2026, 6, 1),
        )

        first.refresh_from_db()
        self.assertFalse(first.is_active)
        self.assertEqual(first.effective_to, date(2026, 5, 31))
        self.assertTrue(second.is_active)

        may_resolved = resolve_compensation(employee, '2026-05')
        june_resolved = resolve_compensation(employee, '2026-06')
        self.assertEqual(may_resolved.source_compensation_level.id, self.level_l0.id)
        self.assertEqual(june_resolved.source_compensation_level.id, self.level_l1.id)

    def test_resolve_compensation_falls_back_to_legacy_salary_structure(self):
        employee = Employee.objects.create(
            hospital=self.hospital,
            name='Legacy Only Nurse',
            email='legacy-only-nurse@test.local',
            status='active',
            joining_date=date(2026, 1, 1),
            designation=self.designation,
        )
        SalaryStructure.objects.create(
            employee=employee,
            basic_salary=Decimal('28000.00'),
            hra=Decimal('7000.00'),
            allowances={'medical': '500', 'special_allowance': '500'},
            deductions={},
            overtime_rate=Decimal('0'),
            effective_from=date(2026, 1, 1),
            is_active=True,
        )
        resolved = resolve_compensation(employee, self.month)
        self.assertIsNotNone(resolved)
        self.assertTrue(resolved.used_legacy_fallback)
        self.assertEqual(resolved.basic_salary, Decimal('28000.00'))
        self.assertEqual(resolved.hra, Decimal('7000.00'))
        self.assertIsNone(resolved.source_compensation_assignment)

    def test_employee_override_beats_compensation_level(self):
        employee = Employee.objects.create(
            hospital=self.hospital,
            name='Override Nurse',
            email='override-nurse@test.local',
            status='active',
            joining_date=date(2026, 1, 1),
            designation=self.designation,
        )
        assign_compensation_level_to_employee(
            employee=employee,
            level=self.level_l0,
            effective_from=date(2026, 1, 1),
        )
        override = save_employee_compensation_override(
            employee=employee,
            effective_from=date(2026, 4, 1),
            basic=Decimal('42000.00'),
            allowances={'retention_bonus': '2500.00'},
            reason='Retention adjustment',
        )

        resolved = resolve_compensation(employee, self.month)
        self.assertEqual(resolved.basic_salary, Decimal('42000.00'))
        self.assertEqual(resolved.hra, Decimal('8000.00'))
        self.assertEqual(resolved.allowances['retention_bonus'], '2500.00')
        self.assertEqual(resolved.source_compensation_override.id, override.id)

    def test_generate_payroll_accepts_compensation_assignment_without_legacy_designation_assignment(self):
        employee = Employee.objects.create(
            hospital=self.hospital,
            name='Payroll Nurse',
            email='payroll-nurse@test.local',
            status='active',
            joining_date=date(2026, 1, 1),
            designation=self.designation,
        )
        assign_compensation_level_to_employee(
            employee=employee,
            level=self.level_l0,
            effective_from=date(2026, 1, 1),
        )
        for day_num in range(1, 32):
            day = date(2026, 5, day_num)
            status_value = 'weekend' if day.weekday() >= 5 else 'present'
            DailyAttendance.objects.create(employee=employee, date=day, attendance_status=status_value)
        finalize_hospital_attendance_month(self.hospital, self.month)

        result = generate_monthly_payroll(
            self.month,
            employee_queryset=Employee.objects.filter(pk=employee.pk),
        )

        self.assertEqual(len(result.created), 1, result.skipped)
        self.assertEqual(len(result.skipped), 0)
        run = result.created[0]
        salary_snapshot = (run.calculation_snapshot or {}).get('input_snapshots', {}).get('salary', {})
        self.assertEqual(salary_snapshot.get('compensation_level_id'), str(self.level_l0.id))
        self.assertIsNotNone(run.employee_compensation_assignment_id)
        self.assertEqual(run.employee_compensation_assignment.compensation_level_id, self.level_l0.id)


class CompensationLevelAutoAssignTests(TestCase):
    def setUp(self):
        self.hospital = Hospital.objects.create(name='Auto Assign Hospital', slug='auto-assign-level')
        self.user = User.objects.create_user(
            email='hr-comp-level@test.local',
            password='test-pass-123',
            is_staff=True,
            hospital=self.hospital,
        )
        self.designation = Designation.objects.create(hospital=self.hospital, name='Nurse', code='NURSE')
        self.level = save_compensation_level(
            hospital=self.hospital,
            designation=self.designation,
            code='NURSE_L0',
            name='Nurse Level 0',
            rank=0,
            basic=Decimal('30000.00'),
            hra=Decimal('7000.00'),
            medical=Decimal('1000.00'),
            special_allowance=Decimal('1000.00'),
            allowances={},
            deductions={},
            overtime_rate=Decimal('100.00'),
            effective_from=date(2026, 1, 1),
            is_default_for_designation=True,
            compliance_fields={
                'overtime_enabled': True,
                'overtime_type': 'fixed_per_hour',
            },
        )

    def test_employee_serializer_auto_assigns_default_compensation_level(self):
        factory = RequestFactory()
        request = factory.post('/api/hr/employees/')
        request.user = self.user
        serializer = EmployeeSerializer(
            data={
                'hospital': str(self.hospital.id),
                'name': 'New Join Nurse',
                'email': 'new-join-nurse@test.local',
                'status': 'active',
                'joining_date': '2026-05-01',
                'designation': str(self.designation.id),
            },
            context={'request': request},
        )
        self.assertTrue(serializer.is_valid(), serializer.errors)
        employee = serializer.save()

        assignment = EmployeeCompensationAssignment.objects.filter(employee=employee, is_active=True).first()
        self.assertIsNotNone(assignment)
        self.assertEqual(assignment.compensation_level_id, self.level.id)


class CompensationLevelPayrollAuditTests(TestCase):
    def setUp(self):
        self.hospital = Hospital.objects.create(name='Audit Link Hospital', slug='audit-link-hosp')
        self.designation = Designation.objects.create(hospital=self.hospital, name='Nurse', code='NURSE')
        self.level = save_compensation_level(
            hospital=self.hospital,
            designation=self.designation,
            code='NURSE_L0',
            name='Nurse Standard',
            rank=0,
            basic=Decimal('28000.00'),
            hra=Decimal('7000.00'),
            medical=Decimal('1000.00'),
            special_allowance=Decimal('1000.00'),
            allowances={},
            deductions={},
            overtime_rate=Decimal('100.00'),
            effective_from=date(2026, 1, 1),
        )
        self.employee = Employee.objects.create(
            hospital=self.hospital,
            name='Audit Nurse',
            email='audit-nurse-comp@test.local',
            status='active',
            joining_date=date(2026, 1, 1),
            designation=self.designation,
        )
        self.assignment, _legacy, _ = assign_compensation_level_to_employee(
            employee=self.employee,
            level=self.level,
            effective_from=date(2026, 1, 1),
        )
        legacy_structure = SalaryStructure.objects.create(
            employee=self.employee,
            basic_salary=Decimal('28000.00'),
            hra=Decimal('7000.00'),
            allowances={'medical': '1000.00', 'special_allowance': '1000.00'},
            deductions={},
            overtime_rate=Decimal('100.00'),
            effective_from=date(2026, 1, 1),
            is_active=True,
            notes='Frozen payroll snapshot.',
        )
        self.payroll_run = PayrollRun.objects.create(
            employee=self.employee,
            salary_structure=legacy_structure,
            employee_compensation_assignment=self.assignment,
            month='2026-04',
            gross_salary=Decimal('36000.00'),
            final_salary=Decimal('34000.00'),
        )

    def test_payroll_run_uses_compensation_assignment_audit_link(self):
        self.payroll_run.refresh_from_db()
        self.assertEqual(self.payroll_run.employee_compensation_assignment_id, self.assignment.id)
        self.assertTrue(
            SalaryStructure.objects.filter(employee=self.employee, is_active=True).exists(),
        )


class CompensationLevelApiTests(APITestCase):
    def setUp(self):
        self.hospital = Hospital.objects.create(name='Comp API Hospital', slug='comp-api-hosp')
        self.hr_user = User.objects.create_user(
            email='hr-comp-api@test.local',
            password='test-pass-123',
            is_staff=True,
            hospital=self.hospital,
        )
        self.designation = Designation.objects.create(hospital=self.hospital, name='Nurse', code='NURSE')
        self.employee = Employee.objects.create(
            hospital=self.hospital,
            name='API Nurse',
            email='api-nurse@test.local',
            status='active',
            joining_date=date(2026, 1, 1),
            designation=self.designation,
        )
        self.client = APIClient()
        self.client.force_authenticate(user=self.hr_user)

    def test_create_level_assign_employees_and_preview(self):
        create_res = self.client.post(
            '/api/payroll/compensation-levels/',
            {
                'designation': str(self.designation.id),
                'code': 'NURSE_L0',
                'name': 'Nurse Level 0',
                'rank': 0,
                'basic': '30000.00',
                'hra': '8000.00',
                'medical': '1000.00',
                'special_allowance': '1000.00',
                'allowances': {},
                'deductions': {},
                'overtime_rate': '100.00',
                'effective_from': '2026-01-01',
                'is_default_for_designation': True,
                'assign_to_employees': True,
            },
            format='json',
        )
        self.assertEqual(create_res.status_code, 201, create_res.data)
        level_id = create_res.data['level']['id']
        self.assertEqual(create_res.data['employee_assignment']['assigned_count'], 1)

        preview_res = self.client.get(
            '/api/payroll/compensation/preview/',
            {'employee': str(self.employee.id), 'month': '2026-05'},
        )
        self.assertEqual(preview_res.status_code, 200, preview_res.data)
        self.assertEqual(preview_res.data['source']['compensation_level_id'], level_id)

        override_res = self.client.post(
            '/api/payroll/compensation-overrides/',
            {
                'employee': str(self.employee.id),
                'basic': '35000.00',
                'effective_from': '2026-04-01',
                'reason': 'Performance-based increment',
            },
            format='json',
        )
        self.assertEqual(override_res.status_code, 201, override_res.data)
        self.assertEqual(EmployeeCompensationOverride.objects.filter(employee=self.employee).count(), 1)

    def test_list_multiple_levels_for_same_designation(self):
        self.client.post(
            '/api/payroll/compensation-levels/',
            {
                'designation': str(self.designation.id),
                'code': 'NURSE_L0',
                'name': 'Nurse Level 0',
                'rank': 0,
                'basic': '30000.00',
                'hra': '8000.00',
                'medical': '1000.00',
                'special_allowance': '1000.00',
                'allowances': {},
                'deductions': {},
                'overtime_rate': '100.00',
                'effective_from': '2026-01-01',
                'is_default_for_designation': True,
                'assign_to_employees': False,
            },
            format='json',
        )
        self.client.post(
            '/api/payroll/compensation-levels/',
            {
                'designation': str(self.designation.id),
                'code': 'NURSE_L1',
                'name': 'Nurse Level 1',
                'rank': 1,
                'basic': '40000.00',
                'hra': '10000.00',
                'medical': '1000.00',
                'special_allowance': '1000.00',
                'allowances': {},
                'deductions': {},
                'overtime_rate': '100.00',
                'effective_from': '2026-01-01',
                'is_default_for_designation': False,
                'assign_to_employees': False,
            },
            format='json',
        )
        list_res = self.client.get(
            '/api/payroll/compensation-levels/',
            {'active': 'true', 'designation': str(self.designation.id)},
        )
        self.assertEqual(list_res.status_code, 200, list_res.data)
        codes = {row['code'] for row in list_res.data['results']}
        self.assertEqual(codes, {'NURSE_L0', 'NURSE_L1'})
        defaults = [row for row in list_res.data['results'] if row['is_default_for_designation']]
        self.assertEqual(len(defaults), 1)
        self.assertEqual(defaults[0]['code'], 'NURSE_L0')

    def test_set_default_updates_existing_level_in_place(self):
        first = self.client.post(
            '/api/payroll/compensation-levels/',
            {
                'designation': str(self.designation.id),
                'code': 'NURSE_L0',
                'name': 'Nurse Level 0',
                'rank': 0,
                'basic': '30000.00',
                'hra': '8000.00',
                'medical': '1000.00',
                'special_allowance': '1000.00',
                'allowances': {},
                'deductions': {},
                'overtime_rate': '100.00',
                'effective_from': '2026-01-01',
                'is_default_for_designation': True,
                'assign_to_employees': False,
            },
            format='json',
        )
        self.assertEqual(first.status_code, 201, first.data)
        second = self.client.post(
            '/api/payroll/compensation-levels/',
            {
                'designation': str(self.designation.id),
                'code': 'NURSE_L1',
                'name': 'Nurse Level 1',
                'rank': 1,
                'basic': '40000.00',
                'hra': '10000.00',
                'medical': '1000.00',
                'special_allowance': '1000.00',
                'allowances': {},
                'deductions': {},
                'overtime_rate': '100.00',
                'effective_from': '2026-01-01',
                'is_default_for_designation': False,
                'assign_to_employees': False,
            },
            format='json',
        )
        self.assertEqual(second.status_code, 201, second.data)
        level_id = second.data['level']['id']

        patch_res = self.client.patch(
            f'/api/payroll/compensation-levels/{level_id}/',
            {'is_default_for_designation': True},
            format='json',
        )
        self.assertEqual(patch_res.status_code, 200, patch_res.data)
        self.assertEqual(patch_res.data['id'], level_id)
        self.assertTrue(patch_res.data['is_default_for_designation'])
        self.assertTrue(patch_res.data['is_active'])

        list_res = self.client.get(
            '/api/payroll/compensation-levels/',
            {'active': 'true', 'designation': str(self.designation.id)},
        )
        self.assertEqual(list_res.status_code, 200, list_res.data)
        defaults = [row for row in list_res.data['results'] if row['is_default_for_designation']]
        self.assertEqual(len(defaults), 1)
        self.assertEqual(defaults[0]['id'], level_id)
        self.assertEqual(defaults[0]['code'], 'NURSE_L1')
