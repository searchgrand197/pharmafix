from datetime import date
from decimal import Decimal

from django.contrib.auth import get_user_model
from rest_framework.test import APIClient, APITestCase

from apps.hr.models import (
    Candidate,
    CandidateProfile,
    Department,
    Employee,
    JobOpening,
)
from apps.hr.payroll_models import PayrollRun, SalaryStructure
from apps.shared.models import Hospital

User = get_user_model()


class JourneyCenterCountsTests(APITestCase):
    def setUp(self):
        self.hospital = Hospital.objects.create(name='Journey Hospital', slug='journey-hospital')
        self.hr_user = User.objects.create_user(
            email='hr-journey@test.local',
            password='test-pass-123',
            is_staff=True,
            hospital=self.hospital,
        )
        self.department = Department.objects.create(hospital=self.hospital, name='Nursing')
        self.job_a = JobOpening.objects.create(
            hospital=self.hospital,
            title='Staff Nurse A',
            department=self.department,
            employment_type='full_time',
            status='open',
            vacancies=10,
        )
        self.job_b = JobOpening.objects.create(
            hospital=self.hospital,
            title='Staff Nurse B',
            department=self.department,
            employment_type='full_time',
            status='open',
        )
        self.profile_a = CandidateProfile.objects.create(
            hospital=self.hospital,
            candidate_code='CAND-JA-001',
            name='Applicant A',
            email='applicant-a@test.local',
        )
        self.profile_b = CandidateProfile.objects.create(
            hospital=self.hospital,
            candidate_code='CAND-JB-001',
            name='Applicant B',
            email='applicant-b@test.local',
        )
        Candidate.objects.create(
            job_opening=self.job_a,
            profile=self.profile_a,
            application_code='APP-JA-001',
            name='Applicant A',
            email='applicant-a@test.local',
            status='applied',
        )
        Candidate.objects.create(
            job_opening=self.job_b,
            profile=self.profile_b,
            application_code='APP-JB-001',
            name='Applicant B',
            email='applicant-b@test.local',
            status='shortlisted',
        )
        self.direct_hire = Employee.objects.create(
            hospital=self.hospital,
            name='Direct Hire',
            email='direct@test.local',
            status='active',
            onboarding_status='onboarded',
            job_title='Receptionist',
        )
        self.recruited_employee = Employee.objects.create(
            hospital=self.hospital,
            name='Recruited Nurse',
            email='recruited@test.local',
            status='active',
            onboarding_status='onboarded',
            job_title='Staff Nurse A',
            candidate=Candidate.objects.create(
                job_opening=self.job_a,
                profile=CandidateProfile.objects.create(
                    hospital=self.hospital,
                    candidate_code='CAND-JA-HIRED',
                    name='Recruited Nurse',
                    email='recruited@test.local',
                ),
                application_code='APP-JA-HIRED',
                name='Recruited Nurse',
                email='recruited@test.local',
                status='hired',
            ),
        )
        SalaryStructure.objects.create(
            employee=self.recruited_employee,
            basic_salary=Decimal('30000'),
            hra=Decimal('10000'),
            effective_from=date(2026, 1, 1),
            is_active=True,
        )
        PayrollRun.objects.create(
            employee=self.recruited_employee,
            month='2026-06',
            status=PayrollRun.STATUS_PUBLISHED,
            gross_salary=Decimal('40000'),
        )
        self.client = APIClient()
        self.client.force_authenticate(user=self.hr_user)

    def test_global_counts_include_all_jobs(self):
        res = self.client.get('/api/v1/hr/journey-center/counts/')
        self.assertEqual(res.status_code, 200)
        counts = res.data['counts']
        self.assertGreaterEqual(counts['jobs_open'], 2)
        self.assertEqual(counts['applied'], 1)
        self.assertEqual(counts['shortlisted'], 1)

    def test_job_filter_scopes_pipeline_counts(self):
        res = self.client.get(f'/api/v1/hr/journey-center/counts/?job_opening={self.job_a.id}')
        self.assertEqual(res.status_code, 200)
        counts = res.data['counts']
        self.assertEqual(res.data['job_title'], 'Staff Nurse A')
        self.assertEqual(counts['applied'], 1)
        self.assertEqual(counts['shortlisted'], 0)
        self.assertEqual(counts['jobs_open'], 1)

    def test_job_filter_excludes_direct_hire_from_employee_created(self):
        res = self.client.get(f'/api/v1/hr/journey-center/counts/?job_opening={self.job_a.id}')
        counts = res.data['counts']
        self.assertEqual(counts['employee_created'], 1)
        self.assertEqual(counts['salary_assigned'], 1)
        self.assertEqual(counts['published'], 1)

    def test_other_job_has_zero_applicants_from_job_a(self):
        res = self.client.get(f'/api/v1/hr/journey-center/counts/?job_opening={self.job_b.id}')
        counts = res.data['counts']
        self.assertEqual(counts['applied'], 0)
        self.assertEqual(counts['shortlisted'], 1)

    def test_job_completion_includes_funnel_steps(self):
        res = self.client.get(f'/api/v1/hr/journey-center/counts/?job_opening={self.job_a.id}')
        self.assertEqual(res.status_code, 200)
        completion = res.data['completion']
        self.assertEqual(completion['vacancies'], 10)
        self.assertIn('steps', completion)
        self.assertEqual(completion['steps']['jobs_open']['percent'], 100)
        self.assertEqual(completion['steps']['jobs_open']['status'], 'complete')
        # 2 applicants (applied + hired candidate) of 10 vacancies = 20%
        self.assertEqual(completion['steps']['applied']['percent'], 20)
        self.assertEqual(completion['steps']['applied']['current'], 2)

    def test_job_completion_caps_at_100_when_over_vacancies(self):
        for i in range(10):
            profile = CandidateProfile.objects.create(
                hospital=self.hospital,
                candidate_code=f'CAND-JA-SL-{i}',
                name=f'Shortlisted {i}',
                email=f'sl-{i}@test.local',
            )
            Candidate.objects.create(
                job_opening=self.job_a,
                profile=profile,
                application_code=f'APP-JA-SL-{i}',
                name=f'Shortlisted {i}',
                email=f'sl-{i}@test.local',
                status='shortlisted',
            )
        res = self.client.get(f'/api/v1/hr/journey-center/counts/?job_opening={self.job_a.id}')
        shortlisted = res.data['completion']['steps']['shortlisted']
        self.assertEqual(shortlisted['percent'], 100)
        self.assertEqual(shortlisted['extra'], 1)
        self.assertEqual(shortlisted['current'], 11)
        self.assertEqual(shortlisted['target'], 10)

    def test_global_counts_omit_completion(self):
        res = self.client.get('/api/v1/hr/journey-center/counts/')
        self.assertNotIn('completion', res.data)

    def test_applied_count_includes_rejected_candidates(self):
        profile = CandidateProfile.objects.create(
            hospital=self.hospital,
            candidate_code='CAND-JA-REJ',
            name='Rejected Applicant',
            email='rejected@test.local',
        )
        Candidate.objects.create(
            job_opening=self.job_a,
            profile=profile,
            application_code='APP-JA-REJ',
            name='Rejected Applicant',
            email='rejected@test.local',
            status='rejected',
        )
        res = self.client.get(f'/api/v1/hr/journey-center/counts/?job_opening={self.job_a.id}')
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data['counts']['applied'], 2)

    def test_applied_pipeline_lists_rejected_candidates(self):
        profile = CandidateProfile.objects.create(
            hospital=self.hospital,
            candidate_code='CAND-JA-REJ2',
            name='Rejected Two',
            email='rejected2@test.local',
        )
        rejected = Candidate.objects.create(
            job_opening=self.job_a,
            profile=profile,
            application_code='APP-JA-REJ2',
            name='Rejected Two',
            email='rejected2@test.local',
            status='rejected',
        )
        res = self.client.get(
            f'/api/v1/hr/candidates/?job_opening={self.job_a.id}&pipeline=applied',
        )
        self.assertEqual(res.status_code, 200)
        ids = {row['id'] for row in res.data['results']}
        self.assertIn(str(rejected.id), ids)
