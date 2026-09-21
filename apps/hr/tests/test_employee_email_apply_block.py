from datetime import timedelta

from django.test import TestCase
from rest_framework.test import APIRequestFactory

from apps.hr.job_applications import local_today
from apps.hr.models import Department, Employee, JobOpening
from apps.hr.recruitment_applications import (
    DUPLICATE_JOB_APPLICATION_MSG,
    create_application_from_api,
    create_application_from_public_apply,
)
from apps.hr.serializers import CandidateSerializer
from apps.shared.models import Hospital


class ApplicationEmailRulesTests(TestCase):
    def setUp(self):
        self.hospital = Hospital.objects.create(name='Block Hospital', slug='block-hosp')
        self.department = Department.objects.create(
            hospital=self.hospital,
            name='Nursing',
        )
        self.tomorrow = local_today() + timedelta(days=30)
        self.job_a = self._job('Nursing Staff', 'JOB-NURSE-A')
        self.job_b = self._job('Ward Nurse', 'JOB-NURSE-B')
        self.employee = Employee.objects.create(
            hospital=self.hospital,
            name='Existing Employee',
            email='employee@example.com',
            department='Nursing',
            status='active',
        )

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

    def test_same_email_allowed_on_different_jobs(self):
        first = create_application_from_public_apply(
            self.job_a,
            name='Applicant',
            email='applicant@example.com',
            phone='9876543210',
            status='applied',
        )
        second = create_application_from_public_apply(
            self.job_b,
            name='Applicant',
            email='applicant@example.com',
            phone='9876543210',
            status='applied',
        )
        self.assertNotEqual(first.pk, second.pk)
        self.assertEqual(first.profile_id, second.profile_id)

    def test_employee_email_allowed_on_different_job(self):
        candidate = create_application_from_public_apply(
            self.job_a,
            name='Existing Employee',
            email='employee@example.com',
            phone='9876543210',
            status='applied',
        )
        self.assertEqual(candidate.email, 'employee@example.com')

    def test_employee_email_allowed_on_second_different_job(self):
        create_application_from_public_apply(
            self.job_a,
            name='Existing Employee',
            email='employee@example.com',
            phone='9876543210',
            status='applied',
        )
        second = create_application_from_public_apply(
            self.job_b,
            name='Existing Employee',
            email='employee@example.com',
            phone='9876543210',
            status='applied',
        )
        self.assertEqual(second.job_opening_id, self.job_b.pk)

    def test_duplicate_same_job_still_blocked(self):
        create_application_from_public_apply(
            self.job_a,
            name='First',
            email='once@example.com',
            phone='9876543210',
            status='applied',
        )
        with self.assertRaisesMessage(ValueError, DUPLICATE_JOB_APPLICATION_MSG):
            create_application_from_public_apply(
                self.job_a,
                name='First',
                email='once@example.com',
                phone='9876543210',
                status='applied',
            )

    def test_create_application_from_api_allows_employee_email(self):
        candidate = create_application_from_api({
            'job_opening': self.job_a,
            'name': 'Existing Employee',
            'email': 'employee@example.com',
            'phone': '9876543210',
            'status': 'applied',
        })
        self.assertEqual(candidate.email, 'employee@example.com')

    def test_serializer_allows_employee_email(self):
        serializer = CandidateSerializer(
            data={
                'job_opening': str(self.job_a.pk),
                'name': 'Existing Employee',
                'email': 'employee@example.com',
                'phone': '9876543210',
                'status': 'applied',
            },
            context={'request': APIRequestFactory().get('/')},
        )
        self.assertTrue(serializer.is_valid(), serializer.errors)
