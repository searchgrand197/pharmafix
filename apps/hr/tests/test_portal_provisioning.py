from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from apps.hr.models import Department, Designation, DocumentType, Employee, EmployeeDocumentRequirement, LeaveType
from apps.hr.manual_employee import create_manual_employee
from apps.hr.onboarding_documents import activate_employee_after_verification, sync_employee_requirements
from apps.hr.payroll_api.compensation_level_service import save_compensation_level
from apps.hr.payroll_models import EmployeeCompensationAssignment
from apps.hr.portal_provisioning import generate_secure_temporary_password, validate_activation_documents
from apps.shared.models import Hospital
from decimal import Decimal
from datetime import date

User = get_user_model()


class PortalProvisioningTests(TestCase):
    def setUp(self):
        self.hospital = Hospital.objects.create(name='Provision Hospital', slug='provision-hospital')
        self.department = Department.objects.create(hospital=self.hospital, name='General')
        self.designation = Designation.objects.create(
            hospital=self.hospital,
            name='Staff Nurse',
            department=self.department,
        )
        self.hr_user = User.objects.create_user(
            email='hr.provision@test.local',
            password='hr-pass-123',
            is_staff=True,
            hospital=self.hospital,
        )
        self.doc_type = DocumentType.objects.create(
            hospital=self.hospital,
            name='Aadhaar',
            verification_mode='upload',
        )
        self.employee = Employee.objects.create(
            hospital=self.hospital,
            name='Provision Employee',
            email='employee.provision@test.local',
            status='pending_onboarding',
            onboarding_status='under_review',
            job_title='Staff Nurse',
            designation=self.designation,
            department_ref=self.department,
        )
        sync_employee_requirements(self.employee)
        self.requirement = EmployeeDocumentRequirement.objects.filter(
            employee=self.employee,
            document_type=self.doc_type,
        ).first() or EmployeeDocumentRequirement.objects.create(
            employee=self.employee,
            document_type=self.doc_type,
            mandatory=True,
        )
        EmployeeDocumentRequirement.objects.filter(employee=self.employee).update(
            mandatory=True,
            status='verified',
            override_approved=True,
            uploaded_at=timezone.now(),
            verified_at=timezone.now(),
        )
        self.client = APIClient()

    def test_secure_password_meets_requirements(self):
        password = generate_secure_temporary_password()
        self.assertGreaterEqual(len(password), 12)
        self.assertTrue(any(c.islower() for c in password))
        self.assertTrue(any(c.isupper() for c in password))
        self.assertTrue(any(c.isdigit() for c in password))
        self.assertTrue(any(c in '!@#$%&*-_' for c in password))

    @patch('apps.hr.portal_provisioning.generate_secure_temporary_password', return_value='TempPass1!2345')
    @patch('apps.hr.email_utils._safe_smtp_send', return_value=True)
    def test_scenario_a_activation_provisions_user_and_sends_email(self, _mock_send, _mock_pw):
        result = activate_employee_after_verification(employee=self.employee, reviewer=self.hr_user)
        self.assertTrue(result['success'], result)

        self.employee.refresh_from_db()
        self.assertEqual(self.employee.status, 'active')
        self.assertIsNotNone(self.employee.user_id)
        self.assertIsNotNone(self.employee.portal_account_created_at)
        self.assertIsNotNone(self.employee.portal_welcome_email_sent_at)
        self.assertIsNotNone(self.employee.activated_at)

        user = User.objects.get(pk=self.employee.user_id)
        self.assertTrue(user.must_change_password)
        self.assertTrue(user.is_active)

        self.client.force_authenticate(user=user)
        login_res = self.client.post('/api/v1/auth/login/', {
            'email': user.email,
            'password': 'TempPass1!2345',
        }, format='json')
        self.assertEqual(login_res.status_code, 200)

    @patch('apps.hr.portal_provisioning.generate_secure_temporary_password', return_value='TempPass1!2345')
    @patch('apps.hr.email_utils._safe_smtp_send', return_value=True)
    def test_activation_auto_assigns_default_compensation_level(self, _mock_send, _mock_pw):
        save_compensation_level(
            hospital=self.hospital,
            designation=self.designation,
            code='STAFF_NURSE_L0',
            name='Nurse Base',
            rank=0,
            basic=Decimal('35000.00'),
            hra=Decimal('7000.00'),
            medical=Decimal('1000.00'),
            special_allowance=Decimal('1000.00'),
            allowances={},
            deductions={},
            overtime_rate=Decimal('200.00'),
            effective_from=date(2026, 1, 1),
            is_default_for_designation=True,
        )
        self.assertFalse(EmployeeCompensationAssignment.objects.filter(employee=self.employee).exists())

        result = activate_employee_after_verification(employee=self.employee, reviewer=self.hr_user)

        self.assertTrue(result['success'], result)
        self.assertTrue(
            EmployeeCompensationAssignment.objects.filter(employee=self.employee, is_active=True).exists(),
        )

    @patch('apps.hr.email_utils._safe_smtp_send', return_value=True)
    def test_scenario_b_double_activation_no_duplicate_user(self, _mock_send):
        activate_employee_after_verification(employee=self.employee, reviewer=self.hr_user)
        first_user_id = Employee.objects.get(pk=self.employee.pk).user_id
        count_after_first = User.objects.filter(email__iexact=self.employee.email).count()

        result = activate_employee_after_verification(employee=self.employee, reviewer=self.hr_user)
        self.assertTrue(result['success'], result)
        self.assertTrue(result.get('idempotent'))

        self.employee.refresh_from_db()
        self.assertEqual(self.employee.user_id, first_user_id)
        self.assertEqual(User.objects.filter(email__iexact=self.employee.email).count(), count_after_first)

    @patch('apps.hr.email_utils._safe_smtp_send', return_value=True)
    def test_scenario_c_inactive_employee_portal_blocked(self, _mock_send):
        activate_employee_after_verification(employee=self.employee, reviewer=self.hr_user)
        self.employee.refresh_from_db()
        user = self.employee.user

        self.employee.status = 'inactive'
        self.employee.save(update_fields=['status'])

        user.refresh_from_db()
        self.assertFalse(user.is_active)

        self.client.force_authenticate(user=user)
        res = self.client.get('/api/v1/employee-portal/dashboard/')
        self.assertEqual(res.status_code, 403)

    def test_scenario_d_pending_document_blocks_activation(self):
        self.requirement.status = 'pending'
        self.requirement.save(update_fields=['status'])

        ok, message = validate_activation_documents(self.employee)
        self.assertFalse(ok)
        self.assertIn('Required documents', message)

        result = activate_employee_after_verification(employee=self.employee, reviewer=self.hr_user)
        self.assertFalse(result['success'])
        self.assertFalse(User.objects.filter(email__iexact=self.employee.email).exists())

    @patch('apps.hr.portal_provisioning.generate_secure_temporary_password', return_value='TempPass1!2345')
    @patch('apps.hr.email_utils._safe_smtp_send', return_value=True)
    def test_manual_create_active_provisions_portal(self, _mock_send, _mock_pw):
        with self.captureOnCommitCallbacks(execute=True):
            employee, meta = create_manual_employee(
                hr_user=self.hr_user,
                hospital=self.hospital,
                payload={
                    'name': 'Manual Active',
                    'email': 'manual.active@test.local',
                    'phone': '9999999999',
                    'gender': 'female',
                    'department': 'General',
                    'job_title': 'Staff Nurse',
                    'joining_date': timezone.localdate().isoformat(),
                    'start_onboarding': False,
                },
            )
        self.assertTrue(meta.get('portal_provisioning_scheduled'))
        employee.refresh_from_db()
        self.assertEqual(employee.status, 'active')

    @patch('apps.hr.email_utils._safe_smtp_send', return_value=True)
    def test_manual_create_pending_does_not_provision(self, _mock_send):
        employee, meta = create_manual_employee(
            hr_user=self.hr_user,
            hospital=self.hospital,
            payload={
                'name': 'Manual Pending',
                'email': 'manual.pending@test.local',
                'phone': '8888888888',
                'gender': 'female',
                'department': 'General',
                'job_title': 'Staff Nurse',
                'joining_date': timezone.localdate().isoformat(),
                'start_onboarding': True,
                'document_timing': 'collect_now',
            },
        )
        self.assertFalse(meta.get('portal_provisioning_scheduled'))
        employee.refresh_from_db()
        self.assertEqual(employee.status, 'pending_onboarding')
        self.assertIsNone(employee.user_id)

    @patch('apps.hr.email_utils._safe_smtp_send', return_value=True)
    def test_existing_user_is_linked_not_duplicated(self, _mock_send):
        existing = User.objects.create_user(
            email=self.employee.email,
            password='existing-pass-123',
            hospital=self.hospital,
        )
        result = activate_employee_after_verification(employee=self.employee, reviewer=self.hr_user)
        self.assertTrue(result['success'], result)
        self.assertFalse(result['portal_account_created'])

        self.employee.refresh_from_db()
        self.assertEqual(self.employee.user_id, existing.id)
        self.assertEqual(User.objects.filter(email__iexact=self.employee.email).count(), 1)
        existing.refresh_from_db()
        self.assertFalse(existing.must_change_password)
