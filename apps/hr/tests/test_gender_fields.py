"""Tests for gender capture on job applications and hire propagation."""
from datetime import date, timedelta
from decimal import Decimal

from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import Client, TestCase

from apps.hr.job_applications import local_today
from apps.hr.models import Candidate, CandidateProfile, Department, Employee, JobOpening, Offer
from apps.hr.onboarding_documents import ensure_employee_for_offer
from apps.hr.recruitment_applications import create_application_from_public_apply
from apps.shared.models import Hospital


class GenderFieldTests(TestCase):
    def setUp(self):
        self.hospital = Hospital.objects.create(name='Gender Hospital', slug='gender-hosp')
        self.department = Department.objects.create(
            hospital=self.hospital,
            name='Nursing',
        )
        self.tomorrow = local_today() + timedelta(days=30)
        self.job = JobOpening.objects.create(
            hospital=self.hospital,
            department=self.department,
            title='Staff Nurse',
            job_code='JOB-GENDER-001',
            status='open',
            is_active=True,
            expiry_date=self.tomorrow,
        )
        self.client = Client()

    def test_apply_job_view_without_trailing_slash(self):
        response = self.client.get(f'/jobs/{self.job.job_code}/apply')
        self.assertEqual(response.status_code, 200)
        self.assertContains(response, 'Apply for Position')
        self.assertContains(response, 'Application Form')
        self.assertNotContains(response, 'id="root"')

    def test_hr_prefixed_apply_url_redirects_to_public_form(self):
        response = self.client.get(f'/hr/jobs/{self.job.job_code}/apply/')
        self.assertEqual(response.status_code, 302)
        self.assertEqual(response.url, f'/jobs/{self.job.job_code}/apply/')

    def test_hr_prefixed_apply_url_with_job_id_redirects_to_public_form(self):
        response = self.client.get(f'/hr/jobs/{self.job.id}/apply/')
        self.assertEqual(response.status_code, 302)
        self.assertEqual(response.url, f'/jobs/{self.job.job_code}/apply/')

    def test_create_application_from_public_apply_stores_gender(self):
        candidate = create_application_from_public_apply(
            self.job,
            name='Applicant',
            email='applicant@example.com',
            phone='9876543210',
            gender='female',
            status='applied',
        )
        profile = CandidateProfile.objects.get(pk=candidate.profile_id)
        self.assertEqual(candidate.gender, 'female')
        self.assertEqual(profile.gender, 'female')

    def test_apply_job_view_requires_gender(self):
        resume = SimpleUploadedFile('resume.pdf', b'%PDF-1.4 test', content_type='application/pdf')
        response = self.client.post(
            f'/jobs/{self.job.job_code}/apply/',
            {
                'name': 'Applicant',
                'email': 'missing.gender@example.com',
                'phone': '9876543210',
                'address': '123 Main Street',
                'resume': resume,
            },
        )
        self.assertEqual(response.status_code, 200)
        self.assertFalse(Candidate.objects.filter(email__iexact='missing.gender@example.com').exists())
        self.assertContains(response, 'Gender is required')

    def test_apply_job_view_persists_gender(self):
        resume = SimpleUploadedFile('resume.pdf', b'%PDF-1.4 test', content_type='application/pdf')
        response = self.client.post(
            f'/jobs/{self.job.job_code}/apply/',
            {
                'name': 'Applicant',
                'email': 'with.gender@example.com',
                'phone': '9876543210',
                'gender': 'male',
                'address': '123 Main Street',
                'resume': resume,
            },
        )
        self.assertEqual(response.status_code, 200)
        candidate = Candidate.objects.get(email__iexact='with.gender@example.com')
        self.assertEqual(candidate.gender, 'male')
        self.assertContains(response, 'Application Submitted')

    def test_ensure_employee_for_offer_copies_gender(self):
        candidate = create_application_from_public_apply(
            self.job,
            name='Hire Me',
            email='hire.me@example.com',
            phone='9876543210',
            gender='other',
            status='selected',
        )
        offer = Offer.objects.create(
            candidate=candidate,
            job=self.job,
            candidate_name=candidate.name,
            candidate_email=candidate.email,
            company_name='Gender Hospital',
            company_address='123 Main St',
            company_email='hr@example.com',
            company_phone='9999999999',
            hr_name='HR Lead',
            hr_designation='HR Manager',
            job_title='Staff Nurse',
            department='Nursing',
            job_location='On-site',
            employment_type='full_time',
            ctc=Decimal('500000.00'),
            joining_date=date.today() + timedelta(days=30),
            terms_conditions='Standard terms apply.',
            offer_expiry_date=self.tomorrow,
            status='created',
        )
        employee = ensure_employee_for_offer(offer)
        self.assertEqual(employee.gender, 'other')
        self.assertIsInstance(employee, Employee)
