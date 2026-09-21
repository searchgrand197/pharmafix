from datetime import date
from decimal import Decimal
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.core.files.base import ContentFile
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from apps.hr.models import Employee, OfferLetterSettings
from apps.hr.payslip_generator import (
    DuplicatePayslipError,
    PayslipGenerator,
    PayrollNotReadyError,
)
from django.template.loader import render_to_string

from apps.hr.payslip_pdf import amount_in_words_inr, build_payslip_context
from apps.hr.payroll_models import PayrollRun, Payslip, SalaryStructure
from apps.shared.models import Hospital

User = get_user_model()

FAKE_PDF = b'%PDF-1.4 fake payslip pdf content'


class PayslipGeneratorTests(TestCase):
    def setUp(self):
        self.hospital = Hospital.objects.create(name='Payslip Hospital', slug='payslip-hospital')
        self.employee = Employee.objects.create(
            hospital=self.hospital,
            name='Payslip Employee',
            email='payslip-employee@test.local',
            status='active',
            joining_date=date(2026, 5, 1),
        )
        self.month = '2026-05'
        self.structure = SalaryStructure.objects.create(
            employee=self.employee,
            basic_salary=Decimal('30000.00'),
            hra=Decimal('10000.00'),
            allowances={'transport': 2000},
            deductions={'pf': 1800},
            overtime_rate=Decimal('200.00'),
            effective_from=date(2026, 1, 1),
            is_active=True,
        )
        self.payroll_run = PayrollRun.objects.create(
            employee=self.employee,
            salary_structure=self.structure,
            month=self.month,
            total_present_days=Decimal('21.00'),
            total_absent_days=Decimal('0.00'),
            total_leave_days=Decimal('0.00'),
            overtime_hours=Decimal('0.00'),
            gross_salary=Decimal('42000.00'),
            total_deductions=Decimal('1800.00'),
            final_salary=Decimal('40200.00'),
            status=PayrollRun.STATUS_LOCKED,
            calculation_snapshot={
                'earnings_breakdown': {
                    'basic_salary': '30000.00',
                    'hra': '10000.00',
                    'allowances': {'transport': 2000},
                    'overtime': '0.00',
                },
                'deductions_breakdown': {
                    'fixed': {'pf': 1800},
                    'lop': '0.00',
                    'late_penalty': '0.00',
                },
                'overtime_amount': '0.00',
                'lop_amount': '0.00',
                'late_penalty': '0.00',
                'working_days': 21,
                'attendance_summary': {
                    'present_days': '21.00',
                    'absent_days': '0.00',
                    'leave_days': '0.00',
                    'holiday_days': '0.00',
                    'late_days': '0.00',
                    'overtime_hours': '0.00',
                    'working_days': 21,
                },
            },
        )

    @patch('apps.hr.payslip_generator.render_payslip_pdf_bytes')
    def test_generate_payslip_creates_immutable_record(self, mock_pdf):
        from django.core.files.base import ContentFile

        mock_pdf.return_value = ContentFile(FAKE_PDF)

        payslip = PayslipGenerator().generate_payslip(self.payroll_run.id)
        self.assertEqual(payslip.month, self.month)
        self.assertEqual(payslip.gross_salary, Decimal('42000.00'))
        self.assertEqual(payslip.net_salary, Decimal('40200.00'))
        self.assertTrue(payslip.pdf_file)
        self.assertIsNotNone(payslip.generated_at)

        self.payroll_run.refresh_from_db()
        self.assertEqual(self.payroll_run.status, PayrollRun.STATUS_LOCKED)

        payslip.net_salary = Decimal('1.00')
        with self.assertRaises(ValueError):
            payslip.save()

    @patch('apps.hr.payslip_generator.render_payslip_pdf_bytes')
    def test_duplicate_payslip_blocked(self, mock_pdf):
        from django.core.files.base import ContentFile

        mock_pdf.return_value = ContentFile(FAKE_PDF)
        PayslipGenerator().generate_payslip(self.payroll_run.id)
        with self.assertRaises(DuplicatePayslipError):
            PayslipGenerator().generate_payslip(self.payroll_run.id)

    def test_draft_payroll_rejected(self):
        self.payroll_run.status = PayrollRun.STATUS_DRAFT
        self.payroll_run.save(update_fields=['status'])
        with self.assertRaises(PayrollNotReadyError):
            PayslipGenerator().generate_payslip(self.payroll_run.id)

    def test_breakdown_includes_attendance_and_overtime_fields(self):
        breakdown = PayslipGenerator().build_breakdown(self.payroll_run)
        summary = breakdown.attendance_summary
        self.assertEqual(summary['working_days'], '21')
        self.assertEqual(summary['present_days'], '21')
        self.assertIn('overtime_hours', summary)
        self.assertIn('total_work_hours', summary)
        self.assertIn('attendance_percentage', summary)

    def test_payslip_context_uses_organization_settings_name(self):
        OfferLetterSettings.objects.update_or_create(
            hospital=None,
            defaults={'organization_name': 'Acme Healthcare Pvt Ltd'},
        )
        breakdown = PayslipGenerator().build_breakdown(self.payroll_run)
        ctx = build_payslip_context(
            payroll_run=self.payroll_run,
            payslip=None,
            breakdown=breakdown,
        )
        self.assertEqual(ctx['company_name'], 'Acme Healthcare Pvt Ltd')
        self.assertIn('per_day_salary', ctx)
        self.assertIn('pay_period_range', ctx)
        self.assertNotIn('attendance_rows', ctx)
        self.assertNotIn('compliance_rows', ctx)
        self.assertIn('Rupees Only', ctx['net_salary_words'])

    def test_payslip_html_matches_template_layout(self):
        breakdown = PayslipGenerator().build_breakdown(self.payroll_run)
        ctx = build_payslip_context(
            payroll_run=self.payroll_run,
            payslip=None,
            breakdown=breakdown,
        )
        html = render_to_string('hr/payroll/payslip.html', ctx)
        self.assertNotIn('Attendance &amp; Time Summary', html)
        self.assertNotIn('Attendance Compliance', html)
        self.assertIn('Salary Slip', html)
        self.assertIn('Earnings', html)
        self.assertIn('Deductions', html)
        self.assertIn('Net Pay', html)
        self.assertIn('Payment Mode', html)
        self.assertIn('Date of Payment', html)

    def test_amount_in_words_inr(self):
        self.assertIn('Rupees Only', amount_in_words_inr('40200.00'))
        self.assertIn('Paise', amount_in_words_inr('40200.50'))


class PayslipPortalApiTests(TestCase):
    def setUp(self):
        self.hospital = Hospital.objects.create(name='Portal Payslip Hospital', slug='portal-payslip')
        self.employee = Employee.objects.create(
            hospital=self.hospital,
            name='Portal Payslip Employee',
            email='portal-payslip@test.local',
            status='active',
            joining_date=date(2026, 5, 1),
        )
        self.employee_user = User.objects.create_user(
            email='portal-payslip@test.local',
            password='test-pass-123',
            must_change_password=False,
        )
        self.other_user = User.objects.create_user(
            email='other-payslip@test.local',
            password='test-pass-123',
            must_change_password=False,
        )
        self.hr_user = User.objects.create_user(
            email='hr-payslip@test.local',
            password='test-pass-123',
            is_staff=True,
            must_change_password=False,
        )
        structure = SalaryStructure.objects.create(
            employee=self.employee,
            basic_salary=Decimal('25000.00'),
            hra=Decimal('5000.00'),
            effective_from=date(2026, 1, 1),
            is_active=True,
        )
        payroll_run = PayrollRun.objects.create(
            employee=self.employee,
            salary_structure=structure,
            month='2026-05',
            gross_salary=Decimal('30000.00'),
            total_deductions=Decimal('0.00'),
            final_salary=Decimal('30000.00'),
            status=PayrollRun.STATUS_PUBLISHED,
            calculation_snapshot={
                'earnings_breakdown': {'basic_salary': '25000.00', 'hra': '5000.00', 'allowances': {}},
                'deductions_breakdown': {'fixed': {}, 'lop': '0.00', 'late_penalty': '0.00'},
            },
        )
        self.payslip = Payslip.objects.create(
            payroll_run=payroll_run,
            employee=self.employee,
            month='2026-05',
            earnings_breakdown={'basic_salary': '25000.00', 'hra': '5000.00'},
            deductions_breakdown={},
            gross_salary=Decimal('30000.00'),
            net_salary=Decimal('30000.00'),
            generated_at=timezone.now(),
        )
        self.client = APIClient()

    def test_employee_can_list_own_payslips(self):
        self.client.force_authenticate(user=self.employee_user)
        res = self.client.get('/api/v1/employee-portal/payslips/')
        self.assertEqual(res.status_code, 200)
        self.assertEqual(len(res.data['results']), 1)
        self.assertEqual(res.data['results'][0]['month'], '2026-05')

    def test_employee_cannot_view_other_payslip(self):
        other_employee = Employee.objects.create(
            hospital=self.hospital,
            name='Other',
            email='other-emp@test.local',
            status='active',
        )
        other_run = PayrollRun.objects.create(
            employee=other_employee,
            month='2026-05',
            gross_salary=Decimal('10000.00'),
            final_salary=Decimal('10000.00'),
            status=PayrollRun.STATUS_PUBLISHED,
        )
        other_payslip = Payslip.objects.create(
            payroll_run=other_run,
            employee=other_employee,
            month='2026-05',
            gross_salary=Decimal('10000.00'),
            net_salary=Decimal('10000.00'),
            generated_at=timezone.now(),
        )
        self.client.force_authenticate(user=self.employee_user)
        res = self.client.get(f'/api/v1/employee-portal/payslips/{other_payslip.id}/')
        self.assertEqual(res.status_code, 404)

    @patch('apps.hr.payslip_generator.render_payslip_pdf_bytes')
    def test_hr_can_generate_payslip(self, mock_pdf):
        from django.core.files.base import ContentFile

        mock_pdf.return_value = ContentFile(FAKE_PDF)
        Employee.objects.create(
            hospital=self.hospital,
            name='HR Gen Employee',
            email='hr-gen@test.local',
            status='active',
        )
        gen_employee = Employee.objects.get(email='hr-gen@test.local')
        structure = SalaryStructure.objects.create(
            employee=gen_employee,
            basic_salary=Decimal('20000.00'),
            effective_from=date(2026, 1, 1),
            is_active=True,
        )
        payroll_run = PayrollRun.objects.create(
            employee=gen_employee,
            salary_structure=structure,
            month='2026-04',
            gross_salary=Decimal('20000.00'),
            final_salary=Decimal('20000.00'),
            status=PayrollRun.STATUS_LOCKED,
            calculation_snapshot={
                'earnings_breakdown': {'basic_salary': '20000.00', 'hra': '0.00', 'allowances': {}},
                'deductions_breakdown': {'fixed': {}, 'lop': '0.00', 'late_penalty': '0.00'},
            },
        )
        self.client.force_authenticate(user=self.hr_user)
        res = self.client.post(f'/api/v1/hr/payroll-runs/{payroll_run.id}/generate-payslip/')
        self.assertEqual(res.status_code, 201)
        self.assertEqual(res.data['month'], '2026-04')
