"""Tests for HR Command Center aggregate counts."""
from datetime import date, timedelta

from django.test import TestCase
from django.utils import timezone

from apps.accounts.models import User
from apps.hr.dashboard_command_center import compute_command_center_counts
from apps.hr.models import (
    AttendanceRegularization,
    Candidate,
    CandidateProfile,
    Department,
    Designation,
    Employee,
    EmployeeDocumentRequirement,
    DocumentType,
    Hospital,
    JobOpening,
    LeaveRequest,
    LeaveType,
    Offer,
    RecruitmentEmailEvent,
)
from apps.hr.payroll_models import PayrollRun


class CommandCenterCountsTests(TestCase):
    def setUp(self):
        self.hospital = Hospital.objects.create(name='Test Hospital', slug='test-hospital-cc')
        self.user = User.objects.create_user(
            email='hr-cc@test.local',
            password='pass',
            is_staff=True,
            hospital=self.hospital,
        )
        self.department = Department.objects.create(hospital=self.hospital, name='Nursing')
        self.designation = Designation.objects.create(
            hospital=self.hospital,
            name='Nurse',
            department=self.department,
        )
        self.leave_type = LeaveType.objects.create(hospital=self.hospital, name='Casual')
        self.doc_type = DocumentType.objects.create(hospital=self.hospital, name='PAN')
        self.job = JobOpening.objects.create(
            hospital=self.hospital,
            title='Staff Nurse',
            department=self.department,
            status='open',
        )
        self.profile = CandidateProfile.objects.create(
            hospital=self.hospital,
            candidate_code='CAND0001',
            name='Applicant',
            email='applicant@example.com',
        )
        self.candidate = Candidate.objects.create(
            job_opening=self.job,
            profile=self.profile,
            application_code='APP0001',
            name='Applicant',
            email='applicant@example.com',
            status='selected',
        )

    def test_leave_and_document_review_counts(self):
        employee = Employee.objects.create(
            hospital=self.hospital,
            name='Joiner',
            status='pending_onboarding',
            onboarding_status='documents_uploaded',
            designation=self.designation,
            department_ref=self.department,
        )
        EmployeeDocumentRequirement.objects.create(
            employee=employee,
            document_type=self.doc_type,
            status='uploaded',
        )
        active = Employee.objects.create(
            hospital=self.hospital,
            name='Active',
            status='active',
            designation=self.designation,
            department_ref=self.department,
        )
        LeaveRequest.objects.create(
            employee=active,
            leave_type=self.leave_type,
            start_date=timezone.localdate(),
            end_date=timezone.localdate(),
            number_of_days=1,
            status=LeaveRequest.STATUS_PENDING,
        )
        AttendanceRegularization.objects.create(
            employee=active,
            reason='Missed punch',
            status='pending',
        )

        counts = compute_command_center_counts(
            user=self.user,
            month=timezone.localdate().strftime('%Y-%m'),
        )
        self.assertEqual(counts['leave_requests'], 1)
        self.assertEqual(counts['regularizations'], 1)
        self.assertEqual(counts['documents_to_review'], 1)
        self.assertEqual(counts['document_reviews'], 1)

    def test_offer_and_email_failure_counts(self):
        today = timezone.localdate()
        Offer.objects.create(
            candidate=self.candidate,
            job=self.job,
            candidate_name='Applicant',
            candidate_email='applicant@example.com',
            company_name='Test Hospital',
            company_address='Addr',
            company_email='hr@test.com',
            company_phone='123',
            hr_name='HR',
            hr_designation='Manager',
            job_title='Nurse',
            department='Nursing',
            job_location='City',
            employment_type='full_time',
            ctc=300000,
            joining_date=today,
            offer_expiry_date=today + timedelta(days=3),
            terms_conditions='Terms',
            status='sent',
        )
        RecruitmentEmailEvent.objects.create(
            candidate=self.candidate,
            event_type=RecruitmentEmailEvent.EVENT_OFFER_SENT,
            stage='offer-1',
            email_status=RecruitmentEmailEvent.STATUS_FAILED,
        )
        counts = compute_command_center_counts(user=self.user, month=today.strftime('%Y-%m'))
        self.assertEqual(counts['offers_awaiting_response'], 1)
        self.assertEqual(counts['offers_expiring_soon'], 1)
        self.assertEqual(counts['email_failures'], 1)

    def test_joining_this_week_excludes_active_onboarded(self):
        today = timezone.localdate()
        Employee.objects.create(
            hospital=self.hospital,
            name='Already Joined',
            status='active',
            onboarding_status='onboarded',
            onboarding_completed=True,
            joining_date=today,
            joining_date_confirmed=today,
            designation=self.designation,
            department_ref=self.department,
        )
        Employee.objects.create(
            hospital=self.hospital,
            name='Upcoming Joiner',
            status='pending_onboarding',
            onboarding_status='pending_documents',
            joining_date=today + timedelta(days=2),
            designation=self.designation,
            department_ref=self.department,
        )

        counts = compute_command_center_counts(user=self.user, month=today.strftime('%Y-%m'))
        self.assertEqual(counts['joining_this_week'], 1)

    def test_missing_department_excludes_text_matched_via_ref(self):
        today = timezone.localdate()
        it_dept = Department.objects.create(hospital=self.hospital, name='Information Technology')
        Employee.objects.create(
            hospital=self.hospital,
            name='Legacy Dept Text',
            status='active',
            department='Information Technology',
            department_ref=it_dept,
            designation=self.designation,
        )
        Employee.objects.create(
            hospital=self.hospital,
            name='No Department',
            status='active',
            designation=self.designation,
        )

        counts = compute_command_center_counts(user=self.user, month=today.strftime('%Y-%m'))
        self.assertEqual(counts['missing_department'], 1)

    def test_department_ref_linked_from_legacy_text(self):
        from apps.hr.payroll_api.department_structure_service import ensure_employee_department_ref_linked

        it_dept = Department.objects.create(hospital=self.hospital, name='Information Technology')
        employee = Employee.objects.create(
            hospital=self.hospital,
            name='Ankit',
            status='active',
            department='Information Technology',
            designation=self.designation,
        )
        self.assertTrue(ensure_employee_department_ref_linked(employee))
        employee.refresh_from_db()
        self.assertEqual(employee.department_ref_id, it_dept.id)
        self.assertEqual(employee.department, it_dept.name)

    def test_department_ref_links_hospital_null_department(self):
        from apps.hr.payroll_api.department_structure_service import ensure_employee_department_ref_linked

        global_dept = Department.objects.create(hospital=None, name='Shared Operations')
        employee = Employee.objects.create(
            hospital=self.hospital,
            name='Ankit',
            status='active',
            department='Shared Operations',
            designation=self.designation,
        )
        self.assertTrue(ensure_employee_department_ref_linked(employee))
        employee.refresh_from_db()
        self.assertEqual(employee.department_ref_id, global_dept.id)
        self.assertEqual(employee.department, global_dept.name)

    def test_missing_designation_excludes_job_title_matched_via_fk(self):
        from apps.hr.designation_utils import ensure_employee_designation_linked

        web_dev = Designation.objects.create(
            hospital=self.hospital,
            name='Web Developer',
            department=self.department,
        )
        Employee.objects.create(
            hospital=self.hospital,
            name='Legacy Title Only',
            status='active',
            job_title='Web Developer',
            department_ref=self.department,
        )
        Employee.objects.create(
            hospital=self.hospital,
            name='No Designation',
            status='active',
            department_ref=self.department,
        )
        legacy = Employee.objects.get(name='Legacy Title Only')
        self.assertTrue(ensure_employee_designation_linked(legacy))
        legacy.refresh_from_db()
        self.assertEqual(legacy.designation_id, web_dev.id)

        counts = compute_command_center_counts(user=self.user, month=timezone.localdate().strftime('%Y-%m'))
        self.assertEqual(counts['missing_designation'], 1)
