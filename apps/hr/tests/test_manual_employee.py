"""Tests for manual employee create validation."""

from datetime import timedelta

from django.test import TestCase
from django.utils import timezone

from apps.hr.manual_employee import (
    ManualEmployeeValidationError,
    create_manual_employee,
    validate_manual_employee_payload,
)
from apps.hr.models import Department, Designation, Employee
from apps.hr.payroll_api.compensation_level_service import save_compensation_level
from apps.hr.payroll_models import EmployeeCompensationAssignment
from apps.shared.models import Hospital
from decimal import Decimal
from datetime import date


def _valid_payload(**overrides):
    today = timezone.localdate().isoformat()
    base = {
        'name': 'Jane Doe',
        'email': 'jane.doe@example.com',
        'phone': '9876543210',
        'gender': 'female',
        'department': 'IT',
        'job_title': 'Software Engineer',
        'joining_date': today,
        'employment_type': 'full_time',
    }
    base.update(overrides)
    return base


class ManualEmployeeValidationTests(TestCase):
    def setUp(self):
        self.hospital = Hospital.objects.create(name='Test Hospital', slug='test-hospital')
        Department.objects.create(hospital=self.hospital, name='IT')

    def test_valid_payload_has_no_errors(self):
        errors = validate_manual_employee_payload(
            _valid_payload(),
            hospital=self.hospital,
        )
        self.assertEqual(errors, {})

    def test_rejects_short_name(self):
        errors = validate_manual_employee_payload(
            _valid_payload(name='J'),
            hospital=self.hospital,
        )
        self.assertIn('name', errors)

    def test_rejects_invalid_email(self):
        errors = validate_manual_employee_payload(
            _valid_payload(email='not-an-email'),
            hospital=self.hospital,
        )
        self.assertIn('email', errors)

    def test_rejects_short_phone(self):
        errors = validate_manual_employee_payload(
            _valid_payload(phone='12345'),
            hospital=self.hospital,
        )
        self.assertIn('phone', errors)

    def test_rejects_missing_gender(self):
        errors = validate_manual_employee_payload(
            _valid_payload(gender=''),
            hospital=self.hospital,
        )
        self.assertIn('gender', errors)

    def test_rejects_invalid_gender(self):
        errors = validate_manual_employee_payload(
            _valid_payload(gender='unknown'),
            hospital=self.hospital,
        )
        self.assertIn('gender', errors)

    def test_create_stores_gender(self):
        dept = Department.objects.get(hospital=self.hospital, name='IT')
        Designation.objects.create(
            hospital=self.hospital,
            name='Software Engineer',
            department=dept,
        )
        employee, _meta = create_manual_employee(
            hr_user=None,
            hospital=self.hospital,
            payload=_valid_payload(email='gender.store@test.local', gender='male'),
        )
        employee.refresh_from_db()
        self.assertEqual(employee.gender, 'male')

    def test_rejects_invalid_indian_mobile(self):
        errors = validate_manual_employee_payload(
            _valid_payload(phone='5123456789'),
            hospital=self.hospital,
        )
        self.assertIn('phone', errors)

    def test_allows_future_joining_date(self):
        future = (timezone.localdate() + timedelta(days=30)).isoformat()
        errors = validate_manual_employee_payload(
            _valid_payload(joining_date=future),
            hospital=self.hospital,
        )
        self.assertNotIn('joining_date', errors)

    def test_rejects_unknown_department_for_hospital(self):
        errors = validate_manual_employee_payload(
            _valid_payload(department='Finance'),
            hospital=self.hospital,
        )
        self.assertIn('department', errors)

    def test_accepts_department_id(self):
        dept = Department.objects.get(hospital=self.hospital, name='IT')
        errors = validate_manual_employee_payload(
            _valid_payload(department_id=str(dept.id), department=''),
            hospital=self.hospital,
        )
        self.assertEqual(errors, {})

    def test_rejects_department_id_from_other_hospital(self):
        other = Hospital.objects.create(name='Other Hospital', slug='other-hospital')
        other_dept = Department.objects.create(hospital=other, name='HR')
        errors = validate_manual_employee_payload(
            _valid_payload(department_id=str(other_dept.id)),
            hospital=self.hospital,
        )
        self.assertIn('department', errors)

    def test_rejects_negative_salary(self):
        errors = validate_manual_employee_payload(
            _valid_payload(salary='-100'),
            hospital=self.hospital,
        )
        self.assertIn('salary', errors)

    def test_create_raises_validation_error(self):
        with self.assertRaises(ManualEmployeeValidationError) as ctx:
            create_manual_employee(
                hr_user=None,
                hospital=self.hospital,
                payload=_valid_payload(email='bad-email'),
            )
        self.assertIn('email', ctx.exception.field_errors)

    def test_create_links_designation_from_job_title(self):
        dept = Department.objects.get(hospital=self.hospital, name='IT')
        designation = Designation.objects.create(
            hospital=self.hospital,
            name='Software Engineer',
            department=dept,
        )
        employee, _meta = create_manual_employee(
            hr_user=None,
            hospital=self.hospital,
            payload=_valid_payload(email='linked.designation@test.local'),
        )
        employee.refresh_from_db()
        self.assertEqual(employee.designation_id, designation.id)
        self.assertEqual(employee.job_title, 'Software Engineer')

    def test_create_active_employee_auto_assigns_default_compensation_level(self):
        dept = Department.objects.get(hospital=self.hospital, name='IT')
        designation = Designation.objects.create(
            hospital=self.hospital,
            name='Payroll Engineer',
            department=dept,
        )
        save_compensation_level(
            hospital=self.hospital,
            designation=designation,
            code='PAYROLL_ENGINEER_L0',
            name='Engineer Base',
            rank=0,
            basic=Decimal('45000.00'),
            hra=Decimal('9000.00'),
            medical=Decimal('1000.00'),
            special_allowance=Decimal('1000.00'),
            allowances={},
            deductions={},
            overtime_rate=Decimal('200.00'),
            effective_from=date(2026, 1, 1),
            is_default_for_designation=True,
        )
        employee, _meta = create_manual_employee(
            hr_user=None,
            hospital=self.hospital,
            payload=_valid_payload(
                email='auto.salary@test.local',
                job_title='Payroll Engineer',
            ),
        )
        employee.refresh_from_db()
        self.assertEqual(employee.designation_id, designation.id)
        self.assertTrue(
            EmployeeCompensationAssignment.objects.filter(employee=employee, is_active=True).exists(),
        )

    def test_create_active_employee_with_explicit_l1_compensation_level(self):
        dept = Department.objects.get(hospital=self.hospital, name='IT')
        designation = Designation.objects.create(
            hospital=self.hospital,
            name='Senior Engineer',
            department=dept,
        )
        save_compensation_level(
            hospital=self.hospital,
            designation=designation,
            code='SENIOR_ENGINEER_L0',
            name='Engineer Base',
            rank=0,
            basic=Decimal('45000.00'),
            hra=Decimal('9000.00'),
            medical=Decimal('1000.00'),
            special_allowance=Decimal('1000.00'),
            allowances={},
            deductions={},
            overtime_rate=Decimal('200.00'),
            effective_from=date(2026, 1, 1),
            is_default_for_designation=True,
        )
        level_l1 = save_compensation_level(
            hospital=self.hospital,
            designation=designation,
            code='SENIOR_ENGINEER_L1',
            name='Engineer Senior',
            rank=1,
            basic=Decimal('55000.00'),
            hra=Decimal('11000.00'),
            medical=Decimal('1000.00'),
            special_allowance=Decimal('1000.00'),
            allowances={},
            deductions={},
            overtime_rate=Decimal('200.00'),
            effective_from=date(2026, 1, 1),
            is_default_for_designation=False,
        )
        employee, _meta = create_manual_employee(
            hr_user=None,
            hospital=self.hospital,
            payload=_valid_payload(
                email='senior.hire@test.local',
                designation=str(designation.id),
                compensation_level=str(level_l1.id),
            ),
        )
        employee.refresh_from_db()
        assignment = EmployeeCompensationAssignment.objects.get(employee=employee, is_active=True)
        self.assertEqual(assignment.compensation_level_id, level_l1.id)
        self.assertEqual(assignment.compensation_level.code, 'SENIOR_ENGINEER_L1')

    def test_rejects_custom_salary_and_compensation_level_together(self):
        dept = Department.objects.get(hospital=self.hospital, name='IT')
        designation = Designation.objects.create(
            hospital=self.hospital,
            name='Mixed Pay Engineer',
            department=dept,
        )
        level = save_compensation_level(
            hospital=self.hospital,
            designation=designation,
            code='MIXED_L0',
            name='Mixed Base',
            rank=0,
            basic=Decimal('40000.00'),
            hra=Decimal('8000.00'),
            medical=Decimal('1000.00'),
            special_allowance=Decimal('1000.00'),
            allowances={},
            deductions={},
            overtime_rate=Decimal('0'),
            effective_from=date(2026, 1, 1),
            is_default_for_designation=True,
        )
        errors = validate_manual_employee_payload(
            _valid_payload(
                designation=str(designation.id),
                compensation_level=str(level.id),
                custom_salary={
                    'basic': '50000',
                    'hra': '10000',
                    'medical': '1000',
                    'special_allowance': '2000',
                },
            ),
            hospital=self.hospital,
        )
        self.assertIn('custom_salary', errors)

    def test_rejects_custom_salary_missing_basic(self):
        errors = validate_manual_employee_payload(
            _valid_payload(
                pay_mode='custom',
                custom_salary={
                    'basic': '',
                    'hra': '1000',
                    'medical': '0',
                    'special_allowance': '0',
                },
            ),
            hospital=self.hospital,
        )
        self.assertIn('custom_basic', errors)

    def test_rejects_negative_custom_basic(self):
        errors = validate_manual_employee_payload(
            _valid_payload(
                pay_mode='custom',
                custom_salary={
                    'basic': '-100',
                    'hra': '0',
                    'medical': '0',
                    'special_allowance': '0',
                },
            ),
            hospital=self.hospital,
        )
        self.assertIn('custom_basic', errors)

    def test_create_active_employee_with_custom_salary(self):
        from apps.hr.payroll_models import SalaryStructure
        from apps.hr.payroll_structure_resolver import resolve_compensation

        dept = Department.objects.get(hospital=self.hospital, name='IT')
        designation = Designation.objects.create(
            hospital=self.hospital,
            name='Custom Pay Engineer',
            department=dept,
        )
        # Even if a default level exists, custom mode must skip assignment.
        save_compensation_level(
            hospital=self.hospital,
            designation=designation,
            code='CUSTOM_ENG_L0',
            name='Unused default',
            rank=0,
            basic=Decimal('45000.00'),
            hra=Decimal('9000.00'),
            medical=Decimal('1000.00'),
            special_allowance=Decimal('1000.00'),
            allowances={},
            deductions={},
            overtime_rate=Decimal('0'),
            effective_from=date(2026, 1, 1),
            is_default_for_designation=True,
        )
        employee, _meta = create_manual_employee(
            hr_user=None,
            hospital=self.hospital,
            payload=_valid_payload(
                email='custom.salary@test.local',
                designation=str(designation.id),
                pay_mode='custom',
                custom_salary={
                    'basic': '52000',
                    'hra': '12000',
                    'medical': '1500',
                    'special_allowance': '2500',
                },
            ),
        )
        employee.refresh_from_db()
        self.assertFalse(
            EmployeeCompensationAssignment.objects.filter(employee=employee, is_active=True).exists(),
        )
        structure = SalaryStructure.objects.get(employee=employee, is_active=True)
        self.assertEqual(structure.basic_salary, Decimal('52000.00'))
        self.assertEqual(structure.hra, Decimal('12000.00'))
        self.assertEqual(structure.allowances.get('medical'), '1500')
        self.assertEqual(structure.allowances.get('special_allowance'), '2500')

        month = employee.joining_date.strftime('%Y-%m')
        resolved = resolve_compensation(employee, month)
        self.assertIsNotNone(resolved)
        self.assertTrue(resolved.used_legacy_fallback)
        self.assertEqual(resolved.basic_salary, Decimal('52000.00'))
        self.assertEqual(resolved.hra, Decimal('12000.00'))

    def test_sync_auto_verifies_new_document_type_for_direct_office_hire(self):
        from apps.hr.models import DocumentType
        from apps.hr.onboarding_documents import (
            build_employee_document_review_payload,
            calculate_onboarding_progress,
            is_requirement_complete,
            sync_employee_requirements,
        )

        dept = Department.objects.get(hospital=self.hospital, name='IT')
        Designation.objects.create(
            hospital=self.hospital,
            name='Software Engineer',
            department=dept,
        )
        employee, _meta = create_manual_employee(
            hr_user=None,
            hospital=self.hospital,
            payload=_valid_payload(
                email='direct.hire.docs@test.local',
                start_onboarding=False,
            ),
        )
        employee.refresh_from_db()
        self.assertEqual(employee.status, 'active')
        self.assertTrue(
            calculate_onboarding_progress(employee)['all_mandatory_verified'],
        )

        DocumentType.objects.create(
            hospital=self.hospital,
            name='Passport',
            description='Passport copy',
            mandatory=True,
            verification_mode='upload',
            is_active=True,
        )

        requirements = list(sync_employee_requirements(employee))
        passport = next(
            (r for r in requirements if r.document_type.name == 'Passport'),
            None,
        )
        self.assertIsNotNone(passport)
        passport.refresh_from_db()
        self.assertTrue(is_requirement_complete(passport))
        self.assertTrue(passport.override_approved)
        self.assertEqual(passport.status, 'verified')
        self.assertTrue(
            calculate_onboarding_progress(employee)['all_mandatory_verified'],
        )

        payload = build_employee_document_review_payload(employee)
        passport_row = next(
            (row for row in payload['documents'] if row['document_label'] == 'Passport'),
            None,
        )
        self.assertIsNotNone(passport_row)
        self.assertTrue(passport_row['verified_at_office'])
        self.assertEqual(passport_row['hr_status_label'], 'Verified at office')
