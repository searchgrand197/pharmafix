import threading
from datetime import timedelta

from django.db import connection
from django.test import TestCase, TransactionTestCase

from apps.hr.candidate_pipeline import apply_search
from apps.hr.job_applications import local_today
from apps.hr.models import Candidate, CandidateProfile, Department, JobOpening, RecruitmentIdSequence
from apps.hr.recruitment_applications import (
    DUPLICATE_JOB_APPLICATION_MSG,
    create_application,
    create_application_from_api,
    get_or_create_profile,
)
from apps.hr.recruitment_ids import allocate_application_code, allocate_candidate_code
from apps.shared.models import Hospital


class RecruitmentIdsTestCase(TestCase):
    def setUp(self):
        self.hospital = Hospital.objects.create(name='Recruitment Hospital', slug='rec-hosp')
        self.department = Department.objects.create(
            hospital=self.hospital,
            name='Engineering',
        )
        self.tomorrow = local_today() + timedelta(days=30)

    def _job(self, title, code):
        return JobOpening.objects.create(
            hospital=self.hospital,
            department=self.department,
            title=title,
            job_code=code,
            status='open',
            is_active=True,
            expiry_date=self.tomorrow,
        )

    def test_global_codes_unique_across_jobs(self):
        job_a = self._job('Web Developer', 'JOB-WEB-001')
        job_b = self._job('Java Developer', 'JOB-JAVA-001')
        profile = get_or_create_profile(
            hospital=self.hospital,
            email='dev@example.com',
            name='Dev User',
            phone='999',
        )
        app_a = create_application(job_a, profile, name='Dev User', email='dev@example.com')
        app_b = create_application(job_b, profile, name='Dev User', email='dev@example.com')

        self.assertEqual(profile.candidate_code, 'CAND-000001')
        self.assertEqual(app_a.application_code, 'APP-000001')
        self.assertEqual(app_b.application_code, 'APP-000002')
        self.assertNotEqual(app_a.application_code, app_b.application_code)
        self.assertEqual(app_a.profile_id, app_b.profile_id)

    def test_same_email_reuses_candidate_code(self):
        job_a = self._job('Role A', 'JOB-A-001')
        job_b = self._job('Role B', 'JOB-B-001')
        p1 = get_or_create_profile(
            hospital=self.hospital,
            email='same@example.com',
            name='Same Person',
        )
        p2 = get_or_create_profile(
            hospital=self.hospital,
            email='Same@Example.com',
            name='Same Person',
        )
        self.assertEqual(p1.pk, p2.pk)
        create_application(job_a, p1, name='Same Person', email='same@example.com')
        create_application(job_b, p2, name='Same Person', email='same@example.com')
        self.assertEqual(CandidateProfile.objects.filter(email__iexact='same@example.com').count(), 1)

    def test_duplicate_application_same_job_blocked(self):
        job = self._job('Only Role', 'JOB-ONLY-001')
        profile = get_or_create_profile(
            hospital=self.hospital,
            email='once@example.com',
            name='Once',
        )
        create_application(job, profile, name='Once', email='once@example.com')
        with self.assertRaisesMessage(ValueError, DUPLICATE_JOB_APPLICATION_MSG):
            create_application(job, profile, name='Once', email='once@example.com')

    def test_search_by_candidate_and_application_codes(self):
        job = self._job('Search Role', 'JOB-SRCH-001')
        profile = get_or_create_profile(
            hospital=self.hospital,
            email='search@example.com',
            name='Searcher',
        )
        app = create_application(job, profile, name='Searcher', email='search@example.com')
        qs = Candidate.objects.all()
        self.assertEqual(apply_search(qs, app.application_code).count(), 1)
        self.assertEqual(apply_search(qs, profile.candidate_code).count(), 1)

    def test_create_application_from_api(self):
        job = self._job('API Role', 'JOB-API-001')
        app = create_application_from_api({
            'job_opening': job,
            'name': 'API Applicant',
            'email': 'api@example.com',
            'phone': '111',
            'status': 'applied',
        })
        self.assertTrue(app.application_code.startswith('APP-'))
        self.assertTrue(app.profile.candidate_code.startswith('CAND-'))


class RecruitmentIdConcurrencyTest(TransactionTestCase):
    def test_concurrent_allocation_no_duplicate_codes(self):
        codes = []
        errors = []

        def worker():
            try:
                codes.append(allocate_candidate_code())
            except Exception as exc:
                errors.append(exc)
            finally:
                connection.close()

        threads = [threading.Thread(target=worker) for _ in range(8)]
        for t in threads:
            t.start()
        for t in threads:
            t.join()

        self.assertEqual(errors, [])
        self.assertEqual(len(codes), len(set(codes)))
        self.assertEqual(RecruitmentIdSequence.objects.get(prefix='CAND').last_seq, 8)
