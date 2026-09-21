from datetime import date
from decimal import Decimal

from django.contrib.auth import get_user_model
from rest_framework.test import APIClient, APITestCase

from apps.hr.models import (
    Candidate,
    CandidateProfile,
    Department,
    DocumentType,
    Employee,
    EmployeeDocumentRequirement,
    JobOpening,
)
from apps.shared.models import Hospital

User = get_user_model()


class OnboardingDashboardTests(APITestCase):
    def setUp(self):
        self.hospital = Hospital.objects.create(name='Onboard Hospital', slug='onboard-hospital')
        self.hr_user = User.objects.create_user(
            email='hr-onboard@test.local',
            password='test-pass-123',
            is_staff=True,
            hospital=self.hospital,
        )
        self.department = Department.objects.create(hospital=self.hospital, name='Nursing')
        self.job = JobOpening.objects.create(
            hospital=self.hospital,
            title='Staff Nurse',
            department=self.department,
            employment_type='full_time',
        )
        self.pending_employee = Employee.objects.create(
            hospital=self.hospital,
            name='Pending Nurse',
            email='pending-nurse@test.local',
            status='pending_onboarding',
            onboarding_status='pending_documents',
            job_title='Staff Nurse',
            joining_date=date(2026, 6, 15),
        )
        self.ready_employee = Employee.objects.create(
            hospital=self.hospital,
            name='Ready Nurse',
            email='ready-nurse@test.local',
            status='pending_onboarding',
            onboarding_status='ready_to_join',
            job_title='Staff Nurse',
        )
        self.active_employee = Employee.objects.create(
            hospital=self.hospital,
            name='Active Nurse',
            email='active-nurse@test.local',
            status='active',
            onboarding_status='onboarded',
        )
        self.doc_type = DocumentType.objects.create(
            hospital=self.hospital,
            name='Aadhaar',
            verification_mode='upload',
            is_active=True,
        )
        self.requirement = EmployeeDocumentRequirement.objects.create(
            employee=self.pending_employee,
            document_type=self.doc_type,
            mandatory=True,
            status='uploaded',
        )
        self.profile = CandidateProfile.objects.create(
            hospital=self.hospital,
            candidate_code='CAND-ONB-001',
            name='Accepted Only',
            email='accepted-only@test.local',
        )
        self.accepted_candidate = Candidate.objects.create(
            job_opening=self.job,
            profile=self.profile,
            application_code='APP-ONB-001',
            name='Accepted Only',
            email='accepted-only@test.local',
            status='hired',
            offer_status='accepted',
        )
        self.client = APIClient()
        self.client.force_authenticate(user=self.hr_user)

    def test_dashboard_counts_pending_onboarding_only(self):
        res = self.client.get('/api/v1/hr/onboarding-dashboard/')
        self.assertEqual(res.status_code, 200)
        stats = res.data['statistics']
        self.assertEqual(stats['in_onboarding'], 2)
        self.assertEqual(stats['pending_documents'], 1)
        self.assertEqual(stats['ready_to_join'], 1)
        self.assertEqual(stats['documents_to_review'], 1)
        self.assertEqual(len(res.data['employees']), 2)
        self.assertEqual(len(res.data['accepted_without_employee']), 1)
        self.assertEqual(res.data['accepted_without_employee'][0]['name'], 'Accepted Only')

    def test_dashboard_employee_row_includes_progress_and_action(self):
        res = self.client.get('/api/v1/hr/onboarding-dashboard/')
        pending_row = next(row for row in res.data['employees'] if row['name'] == 'Pending Nurse')
        self.assertEqual(pending_row['next_action'], 'review')
        self.assertEqual(pending_row['documents_awaiting_review'], 1)
        ready_row = next(row for row in res.data['employees'] if row['name'] == 'Ready Nurse')
        self.assertEqual(ready_row['next_action'], 'activate')

    def test_rejected_candidate_hidden_from_onboarding_lists(self):
        profile = CandidateProfile.objects.create(
            hospital=self.hospital,
            candidate_code='CAND-REJ-001',
            name='Rejected Nurse',
            email='rejected-nurse@test.local',
        )
        rejected_candidate = Candidate.objects.create(
            job_opening=self.job,
            profile=profile,
            application_code='APP-REJ-001',
            name='Rejected Nurse',
            email='rejected-nurse@test.local',
            status='rejected',
        )
        rejected_employee = Employee.objects.create(
            hospital=self.hospital,
            name='Rejected Nurse',
            email='rejected-nurse@test.local',
            status='pending_onboarding',
            onboarding_status='documents_uploaded',
            job_title='Staff Nurse',
            candidate=rejected_candidate,
        )
        EmployeeDocumentRequirement.objects.create(
            employee=rejected_employee,
            document_type=self.doc_type,
            mandatory=True,
            status='uploaded',
        )

        employees_res = self.client.get('/api/v1/hr/employees/', {'status': 'pending_onboarding'})
        self.assertEqual(employees_res.status_code, 200)
        employee_names = [row['name'] for row in employees_res.data['results']]
        self.assertNotIn('Rejected Nurse', employee_names)
        self.assertIn('Pending Nurse', employee_names)

        all_employees_res = self.client.get('/api/v1/hr/employees/')
        self.assertEqual(all_employees_res.status_code, 200)
        all_names = [row['name'] for row in all_employees_res.data['results']]
        self.assertIn('Rejected Nurse', all_names)
        rejected_row = next(row for row in all_employees_res.data['results'] if row['name'] == 'Rejected Nurse')
        self.assertEqual(rejected_row['status'], 'pending_onboarding')
        self.assertTrue(rejected_row['application_rejected'])

        dashboard_res = self.client.get('/api/v1/hr/onboarding-dashboard/')
        self.assertEqual(dashboard_res.status_code, 200)
        dashboard_names = [row['name'] for row in dashboard_res.data['employees']]
        self.assertNotIn('Rejected Nurse', dashboard_names)
        self.assertEqual(dashboard_res.data['statistics']['in_onboarding'], 2)

        documents_res = self.client.get('/api/v1/hr/documents/')
        self.assertEqual(documents_res.status_code, 200)
        doc_employee_ids = {row['employee'] for row in documents_res.data['results']}
        self.assertNotIn(str(rejected_employee.id), doc_employee_ids)

        documents_workspace = self.client.get(
            f'/api/v1/hr/employees/{rejected_employee.id}/documents/',
        )
        self.assertEqual(documents_workspace.status_code, 404)
        self.assertTrue(documents_workspace.data['application_rejected'])

    def test_rejected_accepted_offer_hidden_from_accepted_without_employee(self):
        profile = CandidateProfile.objects.create(
            hospital=self.hospital,
            candidate_code='CAND-REJ-OFFER',
            name='Rejected Offer',
            email='rejected-offer@test.local',
        )
        Candidate.objects.create(
            job_opening=self.job,
            profile=profile,
            application_code='APP-REJ-OFFER',
            name='Rejected Offer',
            email='rejected-offer@test.local',
            status='rejected',
            offer_status='accepted',
        )

        res = self.client.get('/api/v1/hr/onboarding-dashboard/')
        self.assertEqual(res.status_code, 200)
        names = [row['name'] for row in res.data['accepted_without_employee']]
        self.assertNotIn('Rejected Offer', names)
        self.assertEqual(res.data['accepted_without_employee'][0]['name'], 'Accepted Only')
