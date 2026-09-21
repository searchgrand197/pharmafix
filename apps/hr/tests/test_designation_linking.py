"""Tests for designation FK linking during onboarding and activation."""
from datetime import date, timedelta
from decimal import Decimal
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.test import TestCase
from django.utils import timezone

from apps.hr.designation_utils import (
    apply_designation_from_hire_sources,
    link_employee_designation_from_job_title,
    validate_active_employee_designation,
)
from apps.hr.models import (
    Candidate,
    CandidateProfile,
    Department,
    Designation,
    Employee,
    JobOpening,
    Offer,
)
from apps.hr.onboarding_documents import activate_employee_after_verification
from apps.shared.models import Hospital

User = get_user_model()

DOCS_OK_PATCH = 'apps.hr.portal_provisioning.validate_activation_documents'


class DesignationLinkingTests(TestCase):
    def setUp(self):
        self.hospital = Hospital.objects.create(name='Link Hospital', slug='link-hospital')
        self.department = Department.objects.create(hospital=self.hospital, name='IT')
        self.designation = Designation.objects.create(
            hospital=self.hospital,
            name='Web Developer',
            department=self.department,
        )
        self.hr_user = User.objects.create_user(
            email='hr.link@test.local',
            password='hr-pass-123',
            is_staff=True,
            hospital=self.hospital,
        )

    def test_link_from_job_title_exact_match(self):
        employee = Employee.objects.create(
            hospital=self.hospital,
            name='Naveen',
            email='naveen.link@test.local',
            status='pending_onboarding',
            job_title='Web Developer',
            department_ref=self.department,
        )
        self.assertTrue(link_employee_designation_from_job_title(employee, save=True).linked)
        employee.refresh_from_db()
        self.assertEqual(employee.designation_id, self.designation.id)
        self.assertEqual(employee.job_title, 'Web Developer')

    @patch(DOCS_OK_PATCH, return_value=(True, ''))
    def test_activation_auto_links_designation(self, _mock_docs):
        employee = Employee.objects.create(
            hospital=self.hospital,
            name='Activate Link',
            email='activate.link@test.local',
            status='pending_onboarding',
            onboarding_status='under_review',
            job_title='Web Developer',
            department_ref=self.department,
        )
        result = activate_employee_after_verification(employee=employee, reviewer=self.hr_user)
        self.assertTrue(result['success'], result)
        employee.refresh_from_db()
        self.assertEqual(employee.status, 'active')
        self.assertEqual(employee.designation_id, self.designation.id)

    @patch(DOCS_OK_PATCH, return_value=(True, ''))
    def test_activation_blocked_without_designation_match(self, _mock_docs):
        employee = Employee.objects.create(
            hospital=self.hospital,
            name='No Match',
            email='nomatch.link@test.local',
            status='pending_onboarding',
            onboarding_status='under_review',
            job_title='Unique Role Title',
            department_ref=self.department,
        )
        result = activate_employee_after_verification(employee=employee, reviewer=self.hr_user)
        self.assertFalse(result['success'])
        self.assertEqual(result['code'], 'missing_designation')
        self.assertTrue(result['requires_override'])
        employee.refresh_from_db()
        self.assertEqual(employee.status, 'pending_onboarding')

    @patch(DOCS_OK_PATCH, return_value=(True, ''))
    def test_activation_override_allows_missing_designation(self, _mock_docs):
        employee = Employee.objects.create(
            hospital=self.hospital,
            name='Override',
            email='override.link@test.local',
            status='pending_onboarding',
            onboarding_status='under_review',
            job_title='Unique Role Title',
            department_ref=self.department,
        )
        result = activate_employee_after_verification(
            employee=employee,
            reviewer=self.hr_user,
            override_missing_designation=True,
        )
        self.assertTrue(result['success'], result)
        employee.refresh_from_db()
        self.assertEqual(employee.status, 'active')
        self.assertIsNone(employee.designation_id)

    def test_validate_active_employee_designation_messages(self):
        employee = Employee.objects.create(
            hospital=self.hospital,
            name='Validate',
            email='validate.link@test.local',
            job_title='Unknown Role',
        )
        ok, message, code = validate_active_employee_designation(employee)
        self.assertFalse(ok)
        self.assertEqual(code, 'missing_designation')
        self.assertIn('Unknown Role', message)

    def test_apply_designation_from_hire_sources_uses_job_opening_fk(self):
        job = JobOpening.objects.create(
            hospital=self.hospital,
            title='Web Developer',
            designation=self.designation,
            department=self.department,
            status='open',
        )
        profile = CandidateProfile.objects.create(
            hospital=self.hospital,
            candidate_code='CAND-LINK-1',
            name='Offer Hire',
            email='offer.hire@test.local',
        )
        candidate = Candidate.objects.create(
            job_opening=job,
            profile=profile,
            application_code='APP-LINK-1',
            name='Offer Hire',
            email='offer.hire@test.local',
            status='hired',
        )
        offer = Offer.objects.create(
            candidate=candidate,
            job=job,
            candidate_name='Offer Hire',
            candidate_email='offer.hire@test.local',
            company_name='Link Hospital',
            company_address='Addr',
            company_email='hr@link.local',
            company_phone='9999999999',
            hr_name='HR',
            hr_designation='HR Manager',
            job_title='Web Developer',
            department='IT',
            job_location='City',
            employment_type='full_time',
            ctc=Decimal('500000.00'),
            joining_date=timezone.localdate(),
            terms_conditions='Standard terms apply.',
            offer_expiry_date=date.today() + timedelta(days=30),
            status='accepted',
        )
        employee = Employee.objects.create(
            hospital=self.hospital,
            name='Offer Hire',
            email='offer.hire@test.local',
            candidate=candidate,
            offer=offer,
            job_title='Web Developer',
            status='pending_onboarding',
        )
        self.assertTrue(apply_designation_from_hire_sources(employee, offer=offer))
        employee.refresh_from_db()
        self.assertEqual(employee.designation_id, self.designation.id)
