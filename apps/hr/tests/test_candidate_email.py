from datetime import timedelta



from django.test import TestCase



from apps.shared.email_normalization import normalize_email_address

from apps.hr.job_applications import local_today

from apps.hr.models import Candidate, Department, JobOpening

from apps.hr.recruitment_applications import create_application, get_or_create_profile

from apps.shared.models import Hospital





class CandidateEmailNormalizationTests(TestCase):

    def setUp(self):

        self.hospital = Hospital.objects.create(name='Test Hospital', slug='test-hospital-email')

        self.department = Department.objects.create(

            hospital=self.hospital,

            name='Engineering',

        )

        self.job = JobOpening.objects.create(

            hospital=self.hospital,

            department=self.department,

            title='Role',

            job_code='JOB-EMAIL-001',

            status='open',

            is_active=True,

            expiry_date=local_today() + timedelta(days=30),

        )



    def test_normalize_lowercases_email(self):

        self.assertEqual(

            normalize_email_address('  Ajay@gmail.com '),

            'ajay@gmail.com',

        )



    def test_duplicate_detected_case_insensitive(self):

        profile = get_or_create_profile(

            hospital=self.hospital,

            email='ajay@gmail.com',

            name='Ajay',

        )

        create_application(

            self.job,

            profile,

            name='Ajay',

            email='ajay@gmail.com',

            status='applied',

        )

        exists = Candidate.objects.filter(

            job_opening=self.job,

            profile__email__iexact='Ajay@gmail.com',

        ).exists()

        self.assertTrue(exists)


