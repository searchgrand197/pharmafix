from decimal import Decimal
from datetime import date, timedelta

from django.contrib.auth import get_user_model
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from apps.hr.models import Department, Designation, Employee, JobOpening
from apps.hr.payroll_models import DepartmentSalaryStructure
from apps.shared.models import Hospital

User = get_user_model()


class DesignationSystemTests(TestCase):
    def setUp(self):
        self.hospital = Hospital.objects.create(name='Designation Hospital', slug='designation-hospital')
        self.other_hospital = Hospital.objects.create(name='Other Hospital', slug='other-designation-hospital')
        self.department = Department.objects.create(hospital=self.hospital, name='Nursing')
        self.other_department = Department.objects.create(hospital=self.other_hospital, name='Admin')
        self.hr_user = User.objects.create_user(
            email='hr.designation@test.local',
            password='test-pass-123',
            is_staff=True,
            hospital=self.hospital,
        )
        self.employee_user = User.objects.create_user(
            email='emp.designation@test.local',
            password='test-pass-123',
            hospital=self.hospital,
        )
        self.client = APIClient()
        self.client.force_authenticate(user=self.hr_user)

    def _create_designation(self, **kwargs):
        defaults = {
            'hospital': self.hospital,
            'name': 'Staff Nurse',
            'code': 'SN',
            'department': self.department,
            'level': 1,
            'is_active': True,
        }
        defaults.update(kwargs)
        return Designation.objects.create(**defaults)

    def test_create_designation(self):
        res = self.client.post('/api/v1/hr/designations/', {
            'name': 'Doctor',
        }, format='json')
        self.assertEqual(res.status_code, 201)
        self.assertEqual(res.data['name'], 'Doctor')
        self.assertEqual(res.data['code'], 'D')
        self.assertEqual(str(res.data['hospital']), str(self.hospital.id))
        self.assertIsNone(res.data['department'])
        self.assertEqual(res.data['level'], 0)

    def test_designation_level_not_writable_via_api(self):
        res = self.client.post('/api/v1/hr/designations/', {
            'name': 'Read Only Level',
            'level': 5,
        }, format='json')
        self.assertEqual(res.status_code, 201)
        self.assertEqual(res.data['level'], 0)
        designation_id = res.data['id']
        patch_res = self.client.patch(f'/api/v1/hr/designations/{designation_id}/', {
            'level': 9,
        }, format='json')
        self.assertEqual(patch_res.status_code, 200)
        self.assertEqual(patch_res.data['level'], 0)

    def test_create_designation_auto_generates_code_from_multi_word_name(self):
        res = self.client.post('/api/v1/hr/designations/', {
            'name': 'Staff Nurse',
        }, format='json')
        self.assertEqual(res.status_code, 201)
        self.assertEqual(res.data['code'], 'SN')

    def test_assign_same_designation_across_departments(self):
        pharmacy = Department.objects.create(hospital=self.hospital, name='Pharmacy')
        designation = self.client.post('/api/v1/hr/designations/', {
            'name': 'Supervisor',
        }, format='json').data
        employee_one = Employee.objects.create(
            hospital=self.hospital,
            name='Nursing Supervisor',
            email='nursing.supervisor@test.local',
            status='active',
            department=self.department.name,
            department_ref=self.department,
        )
        employee_two = Employee.objects.create(
            hospital=self.hospital,
            name='Pharmacy Supervisor',
            email='pharmacy.supervisor@test.local',
            status='active',
            department=pharmacy.name,
            department_ref=pharmacy,
        )

        res_one = self.client.patch(f'/api/v1/hr/employees/{employee_one.id}/', {
            'designation': designation['id'],
        }, format='json')
        res_two = self.client.patch(f'/api/v1/hr/employees/{employee_two.id}/', {
            'designation': designation['id'],
        }, format='json')

        self.assertEqual(res_one.status_code, 200)
        self.assertEqual(res_two.status_code, 200)
        employee_one.refresh_from_db()
        employee_two.refresh_from_db()
        self.assertEqual(employee_one.designation_id, employee_two.designation_id)
        self.assertEqual(employee_one.department_ref_id, self.department.id)
        self.assertEqual(employee_two.department_ref_id, pharmacy.id)

    def test_duplicate_name_rejected(self):
        self._create_designation(name='Pharmacist')
        res = self.client.post('/api/v1/hr/designations/', {
            'name': 'pharmacist',
        }, format='json')
        self.assertEqual(res.status_code, 400)

    def test_assign_inactive_designation_rejected(self):
        designation = self._create_designation(is_active=False)
        employee = Employee.objects.create(
            hospital=self.hospital,
            name='Assign Test',
            email='assign.test@test.local',
            status='active',
            department=self.department.name,
            department_ref=self.department,
        )
        res = self.client.patch(f'/api/v1/hr/employees/{employee.id}/', {
            'designation': str(designation.id),
        }, format='json')
        self.assertEqual(res.status_code, 400)

    def test_assign_active_designation_syncs_job_title(self):
        designation = self._create_designation(name='Lab Technician')
        employee = Employee.objects.create(
            hospital=self.hospital,
            name='Sync Test',
            email='sync.test@test.local',
            status='active',
            department=self.department.name,
            department_ref=self.department,
            job_title='Old Title',
        )
        res = self.client.patch(f'/api/v1/hr/employees/{employee.id}/', {
            'designation': str(designation.id),
        }, format='json')
        self.assertEqual(res.status_code, 200)
        employee.refresh_from_db()
        self.assertEqual(employee.designation_id, designation.id)
        self.assertEqual(employee.job_title, 'Lab Technician')

    def test_job_title_syncs_designation_on_read(self):
        designation = self._create_designation(name='Web Developer')
        employee = Employee.objects.create(
            hospital=self.hospital,
            name='Title Match',
            email='title.match@test.local',
            status='active',
            department=self.department.name,
            department_ref=self.department,
            job_title='Web Developer',
        )
        self.assertIsNone(employee.designation_id)
        res = self.client.patch(f'/api/v1/hr/employees/{employee.id}/', {
            'phone': '9999999999',
        }, format='json')
        self.assertEqual(res.status_code, 200)
        employee.refresh_from_db()
        self.assertEqual(employee.designation_id, designation.id)
        self.assertEqual(res.data['designation_name'], 'Web Developer')

    def test_delete_assigned_designation_blocked(self):
        designation = self._create_designation(name='Occupied Role')
        Employee.objects.create(
            hospital=self.hospital,
            name='Linked Employee',
            email='linked.emp@test.local',
            status='active',
            department=self.department.name,
            department_ref=self.department,
            designation=designation,
            job_title='Occupied Role',
        )
        res = self.client.delete(f'/api/v1/hr/designations/{designation.id}/')
        self.assertEqual(res.status_code, 409)
        self.assertEqual(res.data['linked_counts']['employees'], 1)

    def test_employee_portal_shows_designation_name(self):
        designation = self._create_designation(name='Portal Nurse')
        Employee.objects.create(
            hospital=self.hospital,
            name='Portal Nurse Employee',
            email='emp.designation@test.local',
            status='active',
            department=self.department.name,
            department_ref=self.department,
            designation=designation,
            job_title='Portal Nurse',
        )
        portal_client = APIClient()
        portal_client.force_authenticate(user=self.employee_user)
        res = portal_client.get('/api/v1/employee-portal/profile/')
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data['designation'], 'Portal Nurse')

    def test_job_opening_with_designation_syncs_title(self):
        designation = self._create_designation(name='Resident Doctor')
        expiry = (timezone.localdate() + timedelta(days=30)).isoformat()
        res = self.client.post('/api/v1/hr/job-openings/', {
            'designation': str(designation.id),
            'title': 'Placeholder',
            'department': str(self.department.id),
            'employment_type': 'full_time',
            'vacancies': 1,
            'status': 'draft',
            'expiry_date': expiry,
        }, format='json')
        self.assertEqual(res.status_code, 201)
        self.assertEqual(res.data['title'], 'Resident Doctor')
        self.assertEqual(str(res.data['designation']), str(designation.id))

    def test_department_salary_structure_with_designation(self):
        designation = self._create_designation(name='Senior Nurse')
        res = self.client.post('/api/payroll/department-structures/', {
            'department': str(self.department.id),
            'designation': str(designation.id),
            'basic_salary': '50000',
            'hra': '10000',
            'overtime_rate': '100',
            'effective_from': date.today().isoformat(),
            'assign_to_employees': False,
        }, format='json')
        self.assertEqual(res.status_code, 201)
        structure_id = res.data['structure']['id']
        structure = DepartmentSalaryStructure.objects.get(pk=structure_id)
        self.assertEqual(structure.designation_id, designation.id)

    def test_department_salary_structure_allows_designation_from_other_department_same_hospital(self):
        finance_dept = Department.objects.create(hospital=self.hospital, name='Finance')
        finance_designation = Designation.objects.create(
            hospital=self.hospital,
            name='Finance Manager',
            department=finance_dept,
        )
        res = self.client.post('/api/payroll/department-structures/', {
            'department': str(self.department.id),
            'designation': str(finance_designation.id),
            'basic_salary': '50000',
            'hra': '10000',
            'overtime_rate': '100',
            'effective_from': date.today().isoformat(),
            'assign_to_employees': False,
        }, format='json')
        self.assertEqual(res.status_code, 201)

    def test_department_salary_structure_rejects_cross_hospital_designation(self):
        other_designation = Designation.objects.create(
            hospital=self.other_hospital,
            name='External Manager',
            department=self.other_department,
        )
        res = self.client.post('/api/payroll/department-structures/', {
            'department': str(self.department.id),
            'designation': str(other_designation.id),
            'basic_salary': '50000',
            'hra': '10000',
            'overtime_rate': '100',
            'effective_from': date.today().isoformat(),
            'assign_to_employees': False,
        }, format='json')
        self.assertEqual(res.status_code, 400)

    def test_backfill_migration_from_job_title(self):
        import importlib

        from django.apps import apps as django_apps

        migration = importlib.import_module('apps.hr.migrations.0079_backfill_designation_from_job_title')
        Employee.objects.create(
            hospital=self.hospital,
            name='Legacy Employee',
            email='legacy.emp@test.local',
            status='active',
            department=self.department.name,
            department_ref=self.department,
            job_title='Ward Assistant',
        )
        migration.backfill_designations_from_job_title(django_apps, None)
        employee = Employee.objects.get(email='legacy.emp@test.local')
        self.assertIsNotNone(employee.designation_id)
        self.assertEqual(employee.designation.name, 'Ward Assistant')
        self.assertEqual(employee.job_title, 'Ward Assistant')
