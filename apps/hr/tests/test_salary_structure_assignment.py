from datetime import date
from decimal import Decimal

from django.contrib.auth import get_user_model
from rest_framework.test import APIClient, APITestCase

from apps.hr.models import Employee
from apps.hr.payroll_api.assignment_service import (
    SalaryStructureAssignmentError,
    assign_salary_structure,
)
from apps.hr.payroll_models import SalaryStructure
from apps.shared.models import Hospital

User = get_user_model()


class SalaryStructureAssignmentTests(APITestCase):
    def setUp(self):
        self.hospital = Hospital.objects.create(name='Assign Hospital', slug='assign-hospital')
        self.hr_user = User.objects.create_user(
            email='hr-assign@test.local',
            password='test-pass-123',
            is_staff=True,
            hospital=self.hospital,
        )
        self.employee = Employee.objects.create(
            hospital=self.hospital,
            name='Assign Employee',
            email='assign-emp@test.local',
            status='active',
        )
        self.template = SalaryStructure.objects.create(
            employee=self.employee,
            basic_salary=Decimal('30000.00'),
            hra=Decimal('10000.00'),
            allowances={'transport': 2000},
            deductions={'pf': 1800},
            overtime_rate=Decimal('200.00'),
            effective_from=date(2026, 1, 1),
            is_active=True,
        )
        self.client = APIClient()
        self.client.force_authenticate(user=self.hr_user)

    def test_assign_via_api_copies_structure(self):
        other = Employee.objects.create(
            hospital=self.hospital,
            name='Other Employee',
            email='other-assign@test.local',
            status='active',
        )
        res = self.client.post(
            '/api/payroll/structures/assign/',
            {
                'employee': str(other.id),
                'source_structure_id': str(self.template.id),
                'effective_from': '2026-03-01',
            },
            format='json',
        )
        self.assertEqual(res.status_code, 201)
        created = SalaryStructure.objects.get(employee=other, effective_from=date(2026, 3, 1))
        self.assertEqual(created.basic_salary, Decimal('30000.00'))
        self.assertTrue(created.is_active)

    def test_duplicate_effective_from_rejected(self):
        with self.assertRaises(SalaryStructureAssignmentError):
            assign_salary_structure(
                employee=self.employee,
                effective_from=date(2026, 1, 1),
                basic_salary=Decimal('31000.00'),
                hra=Decimal('0.00'),
                allowances={},
                deductions={},
                overtime_rate=Decimal('0.00'),
            )

    def test_history_endpoint(self):
        res = self.client.get('/api/payroll/structures/history/', {'employee': str(self.employee.id)})
        self.assertEqual(res.status_code, 200)
        self.assertGreaterEqual(len(res.data['results']), 1)

    def test_options_endpoint(self):
        res = self.client.get('/api/payroll/structures/options/')
        self.assertEqual(res.status_code, 200)
        self.assertGreaterEqual(len(res.data['results']), 1)

    def test_superseded_structure_gets_effective_to(self):
        other = Employee.objects.create(
            hospital=self.hospital,
            name='History Employee',
            email='hist-assign@test.local',
            status='active',
        )
        first = assign_salary_structure(
            employee=other,
            effective_from=date(2026, 1, 1),
            basic_salary=Decimal('20000.00'),
            hra=Decimal('5000.00'),
            allowances={},
            deductions={},
            overtime_rate=Decimal('0.00'),
        )
        assign_salary_structure(
            employee=other,
            effective_from=date(2026, 4, 1),
            basic_salary=Decimal('22000.00'),
            hra=Decimal('5000.00'),
            allowances={},
            deductions={},
            overtime_rate=Decimal('0.00'),
        )
        first.refresh_from_db()
        self.assertFalse(first.is_active)
        self.assertEqual(first.effective_to, date(2026, 3, 31))
