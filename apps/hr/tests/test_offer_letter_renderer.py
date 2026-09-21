from datetime import date

from django.test import RequestFactory, TestCase

from apps.hr.models import OfferLetterSettings
from apps.hr.utils.offer_letter_renderer import (
    DEFAULT_LETTER_TITLE,
    build_substitution_context,
    prepare_builder_for_render,
    render_offer_letter_html,
    substitute_variables,
)


class OfferLetterRendererTests(TestCase):
    def setUp(self):
        OfferLetterSettings.objects.update_or_create(
            hospital_id=None,
            defaults={
                'organization_name': 'Acme Healthcare Ltd',
                'organization_address': '123 Corporate Park',
                'organization_location': 'Mumbai 400001',
                'company_email': 'hr@acme.test',
                'hr_name': 'Priya Sharma',
                'hr_designation': 'Head of HR',
                'hr_email': 'hr@acme.test',
                'company_registration_number': 'U12345MH2020PTC000001',
                'registered_office_address': '123 Corporate Park, Mumbai',
                'footer_confidentiality_note': 'CONFIDENTIAL — For recipient only.',
            },
        )

    def test_substitute_variables_replaces_mustache_and_brackets(self):
        ctx = {'company_name': 'Acme', 'job_title': 'Nurse'}
        text = 'Role: {{job_title}} at [Your Organization]'
        out = substitute_variables(text, ctx)
        self.assertIn('Nurse', out)
        self.assertIn('Acme', out)
        self.assertNotIn('[Your Organization]', out)

    def test_prepare_builder_clears_subject_and_sets_title(self):
        prepared = prepare_builder_for_render({
            'letter_title': '',
            'subject_value': 'Old subject',
            'candidate_name': 'Jane Doe',
            'dynamic_content': [],
        })
        self.assertEqual(prepared.letter_title, DEFAULT_LETTER_TITLE)
        self.assertEqual(prepared.subject_value, '')

    def test_render_includes_enterprise_footer_and_terms(self):
        html = render_offer_letter_html({
            'company_name': 'Acme Healthcare Ltd',
            'candidate_name': 'Jane Doe',
            'candidate_email': 'jane@example.com',
            'job_title': 'Staff Nurse',
            'joining_date': date.today(),
            'dynamic_content': [
                {
                    'id': 'p1',
                    'type': 'paragraph',
                    'content': 'We are pleased to offer you {{job_title}}.',
                },
            ],
        })
        self.assertIn('OFFER OF EMPLOYMENT', html)
        self.assertNotIn('Subject:', html)
        self.assertIn('Acme Healthcare Ltd', html)
        self.assertIn('Terms &amp; Conditions', html)
        self.assertIn('Registered Office', html)
        self.assertIn('U12345MH2020PTC000001', html)
        self.assertIn('letterhead-table', html)

    def test_render_preview_uses_table_letterhead_not_absolute(self):
        html = render_offer_letter_html({
            'company_name': 'Test Co',
            'candidate_name': 'A',
            'dynamic_content': [],
        })
        self.assertIn('letterhead-table', html)
        self.assertNotIn('position: absolute', html)

    def test_resolve_hospital_accepts_candidate_model_instance(self):
        """generate_offer passes OfferBuilderV2 model; candidate FK must not be str()'d."""
        from apps.hr.models import Candidate, JobOpening
        from apps.shared.models import Hospital
        from types import SimpleNamespace

        hospital = Hospital.objects.create(name='Offer Hospital', slug='offer-hosp')
        job = JobOpening.objects.create(
            hospital=hospital,
            title='web developer',
            job_code='JOB002',
            status='active',
        )
        candidate = Candidate.objects.create(
            job_opening=job,
            name='ANKIT',
            email='ankit@example.com',
            application_code='APP-000005',
        )
        builder = SimpleNamespace(
            candidate=candidate,
            candidate_name=candidate.name,
            dynamic_content=[],
        )
        html = render_offer_letter_html(builder)
        self.assertIn('ANKIT', html)
        self.assertNotIn('not a valid UUID', html)

    def test_pdf_uses_global_org_name_not_hospital_or_stale_builder_name(self):
        from apps.shared.models import Hospital

        hospital = Hospital.objects.create(name='Email Test', slug='email-test-pdf')
        OfferLetterSettings.objects.update_or_create(
            hospital=hospital,
            defaults={'organization_name': ''},
        )
        html = render_offer_letter_html({
            'company_name': 'Email Test',
            'candidate_name': 'Jane Doe',
            'dynamic_content': [],
        })
        self.assertIn('Acme Healthcare Ltd', html)
        self.assertNotIn('Email Test', html)

    def test_resolve_job_title_and_department_from_candidate_job_opening(self):
        from apps.hr.models import Candidate, CandidateProfile, Department, Designation, JobOpening
        from apps.shared.models import Hospital

        hospital = Hospital.objects.create(name='Dept Hospital', slug='dept-hosp')
        department = Department.objects.create(hospital=hospital, name='Nursing')
        designation = Designation.objects.create(
            hospital=hospital,
            name='Staff Nurse',
            department=department,
        )
        job = JobOpening.objects.create(
            hospital=hospital,
            title='Nurse Opening',
            designation=designation,
            department=department,
            job_code='JOB-NURSE',
            status='open',
        )
        profile = CandidateProfile.objects.create(
            hospital=hospital,
            candidate_code='CAND-100',
            name='Jane Doe',
            email='jane@example.com',
        )
        candidate = Candidate.objects.create(
            job_opening=job,
            profile=profile,
            name='Jane Doe',
            email='jane@example.com',
            application_code='APP-000100',
        )
        ctx = build_substitution_context({
            'candidate': candidate,
            'candidate_name': candidate.name,
        })
        self.assertEqual(ctx['job_title'], 'Staff Nurse')
        self.assertEqual(ctx['designation'], 'Staff Nurse')
        self.assertEqual(ctx['department'], 'Nursing')

        html = render_offer_letter_html({
            'candidate': candidate,
            'candidate_name': candidate.name,
            'dynamic_content': [
                {
                    'id': 't1',
                    'type': 'table',
                    'title': 'Position Details',
                    'rows': [
                        {'id': 'r1', 'cols': ['Designation', '—']},
                        {'id': 'r2', 'cols': ['Department', '—']},
                    ],
                },
            ],
        })
        self.assertIn('Staff Nurse', html)
        self.assertIn('Nursing', html)

    def test_build_substitution_context_includes_offer_expiry_date(self):
        expiry = date(2026, 7, 15)
        ctx = build_substitution_context({
            'offer_expiry_date': expiry,
            'candidate_name': 'Jane Doe',
        })
        self.assertIn('15', ctx['offer_expiry_date'])
        self.assertIn('July', ctx['offer_expiry_date'])
        self.assertIn('2026', ctx['offer_expiry_date'])

    def test_render_includes_offer_expiry_in_position_details(self):
        expiry = date(2026, 7, 15)
        html = render_offer_letter_html({
            'company_name': 'Acme Healthcare Ltd',
            'candidate_name': 'Jane Doe',
            'job_title': 'Staff Nurse',
            'offer_expiry_date': expiry,
            'dynamic_content': [
                {
                    'id': 't1',
                    'type': 'table',
                    'title': 'Position Details',
                    'rows': [
                        {'id': 'r1', 'cols': ['Last date to accept offer', '—']},
                    ],
                },
            ],
        })
        self.assertIn('15 July 2026', html)
