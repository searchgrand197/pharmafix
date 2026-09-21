"""Tests for experience letter generation and mark-exited workflow."""

from datetime import date
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.test import APIClient

from apps.hr.models import Department, Designation, Employee, OfferLetterSettings
from apps.hr.utils.experience_letter_renderer import (
    ExperienceLetterError,
    build_experience_letter_context,
    render_experience_letter_pdf_bytes,
)
from apps.shared.models import Hospital

User = get_user_model()

FAKE_PDF = b'%PDF-1.4 fake experience letter pdf'


class ExperienceLetterRendererTests(TestCase):
    def setUp(self):
        self.hospital = Hospital.objects.create(name='Letter Hospital', slug='letter-hospital')
        self.department = Department.objects.create(hospital=self.hospital, name='Engineering')
        self.designation = Designation.objects.create(
            hospital=self.hospital,
            name='Software Engineer',
        )
        OfferLetterSettings.objects.create(
            organization_name='Acme Healthcare Pvt Ltd',
            organization_address='123 Main Street',
            hr_name='Priya Sharma',
            hr_designation='HR Manager',
        )
        self.employee = Employee.objects.create(
            hospital=self.hospital,
            name='Rahul Verma',
            email='rahul.verma@test.local',
            employee_id='EMP0099',
            status='terminated',
            joining_date=date(2024, 1, 15),
            relieving_date=date(2026, 6, 30),
            exit_reason='resignation',
            conduct_remarks='satisfactory',
            designation=self.designation,
            department_ref=self.department,
            department='Engineering',
            job_title='Software Engineer',
        )

    def test_build_context_includes_employee_and_dates(self):
        ctx = build_experience_letter_context(self.employee)
        self.assertEqual(ctx['employee_name'], 'Rahul Verma')
        self.assertEqual(ctx['employee_id'], 'EMP0099')
        self.assertEqual(ctx['designation'], 'Software Engineer')
        self.assertEqual(ctx['department'], 'Engineering')
        self.assertIn('January 2024', ctx['joining_date'])
        self.assertIn('June 2026', ctx['relieving_date'])
        self.assertEqual(ctx['exit_reason'], 'Resignation')
        self.assertTrue(ctx['show_exit_reason'])
        self.assertIn('year', ctx['tenure'])

    def test_active_employee_not_eligible(self):
        self.employee.status = 'active'
        with self.assertRaises(ExperienceLetterError) as ctx:
            build_experience_letter_context(self.employee)
        self.assertEqual(str(ctx.exception), 'employee_not_exited')

    def test_missing_relieving_date_not_eligible(self):
        self.employee.relieving_date = None
        with self.assertRaises(ExperienceLetterError) as ctx:
            build_experience_letter_context(self.employee)
        self.assertEqual(str(ctx.exception), 'relieving_date_required')

    @patch('apps.hr.utils.experience_letter_renderer.generate_pdf_bytes_from_html', return_value=FAKE_PDF)
    def test_render_pdf_bytes(self, _mock_pdf):
        pdf = render_experience_letter_pdf_bytes(self.employee)
        self.assertEqual(pdf, FAKE_PDF)


class ExperienceLetterApiTests(TestCase):
    def setUp(self):
        self.hospital = Hospital.objects.create(name='API Hospital', slug='api-hospital')
        self.hr_user = User.objects.create_user(
            email='hr.letter@test.local',
            password='test-pass-123',
            is_staff=True,
            hospital=self.hospital,
        )
        self.active_employee = Employee.objects.create(
            hospital=self.hospital,
            name='Active Employee',
            email='active.emp@test.local',
            status='active',
            joining_date=date(2025, 1, 1),
        )
        self.exited_employee = Employee.objects.create(
            hospital=self.hospital,
            name='Exited Employee',
            email='exited.emp@test.local',
            status='terminated',
            joining_date=date(2024, 3, 1),
            relieving_date=date(2026, 2, 28),
            exit_reason='resignation',
        )
        self.client = APIClient()
        self.client.force_authenticate(user=self.hr_user)

    def test_mark_exited_sets_status_and_dates(self):
        res = self.client.post(
            f'/api/v1/hr/employees/{self.active_employee.id}/mark-exited/',
            {
                'status': 'terminated',
                'relieving_date': '2026-06-15',
                'exit_reason': 'resignation',
                'conduct_remarks': 'excellent',
            },
            format='json',
        )
        self.assertEqual(res.status_code, 200)
        self.assertTrue(res.data['success'])
        self.active_employee.refresh_from_db()
        self.assertEqual(self.active_employee.status, 'terminated')
        self.assertEqual(self.active_employee.relieving_date, date(2026, 6, 15))
        self.assertEqual(self.active_employee.exit_reason, 'resignation')
        self.assertEqual(self.active_employee.conduct_remarks, 'excellent')
        self.assertIsNotNone(self.active_employee.exited_at)

    def test_mark_exited_requires_relieving_date(self):
        res = self.client.post(
            f'/api/v1/hr/employees/{self.active_employee.id}/mark-exited/',
            {'status': 'terminated'},
            format='json',
        )
        self.assertEqual(res.status_code, 400)
        self.assertIn('relieving_date', res.data['error'])

    def test_download_blocked_for_active_employee(self):
        res = self.client.get(
            f'/api/v1/hr/employees/{self.active_employee.id}/experience-letter/download/',
        )
        self.assertEqual(res.status_code, 400)
        self.assertEqual(res.data['error'], 'employee_not_exited')

    def test_download_blocked_without_relieving_date(self):
        self.exited_employee.relieving_date = None
        self.exited_employee.save(update_fields=['relieving_date'])
        res = self.client.get(
            f'/api/v1/hr/employees/{self.exited_employee.id}/experience-letter/download/',
        )
        self.assertEqual(res.status_code, 400)
        self.assertEqual(res.data['error'], 'relieving_date_required')

    @patch('apps.hr.utils.experience_letter_renderer.render_experience_letter_pdf_bytes', return_value=FAKE_PDF)
    def test_download_returns_pdf_for_exited_employee(self, _mock_pdf):
        res = self.client.get(
            f'/api/v1/hr/employees/{self.exited_employee.id}/experience-letter/download/',
        )
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res['Content-Type'], 'application/pdf')
        self.assertTrue(res.content.startswith(b'%PDF'))
        self.assertIn('attachment', res['Content-Disposition'])

    @patch('apps.hr.utils.experience_letter_renderer.render_experience_letter_html', return_value='<p>Letter preview</p>')
    def test_preview_returns_html(self, _mock_html):
        res = self.client.get(
            f'/api/v1/hr/employees/{self.exited_employee.id}/experience-letter/preview/',
        )
        self.assertEqual(res.status_code, 200)
        self.assertIn('html', res.data)
        self.assertIn('Letter preview', res.data['html'])
