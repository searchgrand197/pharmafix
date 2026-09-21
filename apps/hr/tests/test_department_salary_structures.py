from datetime import date
from decimal import Decimal

from django.contrib.auth import get_user_model
from rest_framework.test import APIClient, APITestCase

from apps.hr.models import Department, Employee
from apps.hr.payroll_models import DepartmentSalaryStructure, SalaryStructure
from apps.shared.models import Hospital

User = get_user_model()


class DepartmentSalaryStructureTests(APITestCase):
    def setUp(self):
        self.hospital = Hospital.objects.create(name='Dept Payroll Hospital', slug='dept-payroll-hospital')
        self.hr_user = User.objects.create_user(
            email='hr-dept@test.local',
            password='test-pass-123',
            is_staff=True,
            hospital=self.hospital,
        )
        self.department = Department.objects.create(hospital=self.hospital, name='Nursing')
        self.employee = Employee.objects.create(
            hospital=self.hospital,
            name='Nurse One',
            email='nurse-one@test.local',
            status='active',
            department_ref=self.department,
            department='Nursing',
        )
        self.other_employee = Employee.objects.create(
            hospital=self.hospital,
            name='Nurse Two',
            email='nurse-two@test.local',
            status='active',
            department='Nursing',
        )
        self.client = APIClient()
        self.client.force_authenticate(user=self.hr_user)

    def test_create_department_structure_and_bulk_assign(self):
        res = self.client.post(
            '/api/payroll/department-structures/',
            {
                'department': str(self.department.id),
                'name': 'Nursing default',
                'basic_salary': '35000.00',
                'hra': '12000.00',
                'allowances': {'transport': 2000},
                'deductions': {'pf': 2000},
                'overtime_rate': '250.00',
                'effective_from': '2026-04-01',
                'assign_to_employees': True,
            },
            format='json',
        )
        self.assertEqual(res.status_code, 201)
        structure = DepartmentSalaryStructure.objects.get(department=self.department)
        self.assertEqual(structure.basic_salary, Decimal('35000.00'))
        self.assertEqual(
            SalaryStructure.objects.filter(employee=self.employee, is_active=True).count(),
            1,
        )
        self.assertEqual(
            SalaryStructure.objects.filter(employee=self.other_employee, is_active=True).count(),
            1,
        )

    def test_assign_from_department_structure_via_api(self):
        dept_structure = DepartmentSalaryStructure.objects.create(
            department=self.department,
            basic_salary=Decimal('30000.00'),
            hra=Decimal('10000.00'),
            allowances={'transport': 1500},
            deductions={'pf': 1800},
            overtime_rate=Decimal('200.00'),
            effective_from=date(2026, 1, 1),
            is_active=True,
        )
        third = Employee.objects.create(
            hospital=self.hospital,
            name='Nurse Three',
            email='nurse-three@test.local',
            status='active',
            department_ref=self.department,
            department='Nursing',
        )
        res = self.client.post(
            '/api/payroll/structures/assign/',
            {
                'employee': str(third.id),
                'source_department_structure_id': str(dept_structure.id),
                'effective_from': '2026-05-01',
            },
            format='json',
        )
        self.assertEqual(res.status_code, 201)
        created = SalaryStructure.objects.get(employee=third, effective_from=date(2026, 5, 1))
        self.assertEqual(created.basic_salary, Decimal('30000.00'))
        self.assertEqual(created.source_department_structure_id, dept_structure.id)

    def test_department_preview_endpoint(self):
        DepartmentSalaryStructure.objects.create(
            department=self.department,
            basic_salary=Decimal('28000.00'),
            hra=Decimal('8000.00'),
            effective_from=date(2026, 1, 1),
            is_active=True,
        )
        res = self.client.get(
            '/api/payroll/structures/department-preview/',
            {'employee': str(self.employee.id)},
        )
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data['department']['name'], 'Nursing')
        self.assertIsNotNone(res.data['structure'])

    def test_bulk_assign_matches_legacy_department_suffix(self):
        """Manual hires store 'Staff Nurse · Full Time' — must still match 'Staff Nurse' dept."""
        staff_dept = Department.objects.create(hospital=self.hospital, name='Staff Nurse')
        legacy_employee = Employee.objects.create(
            hospital=self.hospital,
            name='Legacy Nurse',
            email='legacy-nurse@test.local',
            status='active',
            department='Staff Nurse · Full Time',
        )
        structure = DepartmentSalaryStructure.objects.create(
            department=staff_dept,
            basic_salary=Decimal('32000.00'),
            hra=Decimal('10000.00'),
            effective_from=date(2026, 6, 1),
            is_active=True,
        )
        res = self.client.post(f'/api/payroll/department-structures/{structure.id}/assign-employees/', {}, format='json')
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data['eligible_count'], 1)
        self.assertEqual(res.data['assigned_count'], 1)
        legacy_employee.refresh_from_db()
        self.assertEqual(legacy_employee.department_ref_id, staff_dept.id)
        self.assertTrue(
            SalaryStructure.objects.filter(employee=legacy_employee, is_active=True).exists(),
        )
