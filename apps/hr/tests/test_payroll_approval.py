from datetime import date
from decimal import Decimal
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.test import APIClient

from apps.hr.models import Employee
from apps.hr.payroll_approval import (
    PayrollApprovalError,
    PayrollApprovalService,
    PayrollStateError,
    PayrollValidationError,
)
from apps.hr.payroll_models import PayrollAuditLog, PayrollRun, Payslip, SalaryStructure
from apps.hr.tests.payroll_test_utils import finalize_hospital_attendance_month
from apps.shared.models import Hospital

User = get_user_model()


class PayrollApprovalServiceTests(TestCase):
    def setUp(self):
        self.hospital = Hospital.objects.create(name='Approval Hospital', slug='approval-hospital')
        self.employee = Employee.objects.create(
            hospital=self.hospital,
            name='Approval Employee',
            email='approval-employee@test.local',
            status='active',
            joining_date=date(2026, 5, 1),
        )
        self.hr_user = User.objects.create_user(
            email='hr-approval@test.local',
            password='test-pass-123',
            is_staff=True,
        )
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
            month='2026-05',
            total_present_days=Decimal('20.00'),
            total_absent_days=Decimal('1.00'),
            total_leave_days=Decimal('0.00'),
            overtime_hours=Decimal('2.00'),
            gross_salary=Decimal('42000.00'),
            total_deductions=Decimal('1800.00'),
            final_salary=Decimal('40200.00'),
            status=PayrollRun.STATUS_DRAFT,
            calculation_snapshot={
                'working_days': 21,
                'warnings': [],
                'earnings_breakdown': {'basic_salary': '30000.00', 'hra': '10000.00', 'allowances': {'transport': 2000}},
                'deductions_breakdown': {'fixed': {'pf': 1800}, 'lop': '0.00', 'late_penalty': '0.00'},
            },
        )
        finalization = finalize_hospital_attendance_month(self.hospital, '2026-05')
        snapshot = dict(self.payroll_run.calculation_snapshot)
        snapshot['input_snapshots'] = {
            'attendance_month_finalization_id': str(finalization.id),
        }
        self.payroll_run.calculation_snapshot = snapshot
        self.payroll_run.save(update_fields=['calculation_snapshot', 'updated_at'])
        self.service = PayrollApprovalService()

    def test_full_workflow_state_machine(self):
        run = self.service.submit_for_review(self.payroll_run, performed_by=self.hr_user)
        self.assertEqual(run.status, PayrollRun.STATUS_UNDER_REVIEW)

        run = self.service.approve_payroll(run, hr_user=self.hr_user)
        self.assertEqual(run.status, PayrollRun.STATUS_APPROVED)

        run = self.service.lock_payroll(run, performed_by=self.hr_user)
        self.assertEqual(run.status, PayrollRun.STATUS_LOCKED)
        self.assertIsNotNone(run.locked_at)

        Payslip.objects.create(
            payroll_run=run,
            employee=self.employee,
            month='2026-05',
            gross_salary=Decimal('42000.00'),
            net_salary=Decimal('40200.00'),
            earnings_breakdown={},
            deductions_breakdown={},
        )

        with patch('apps.hr.email_utils.send_payslip_published_email', return_value=True):
            run = self.service.publish_payroll(run, performed_by=self.hr_user)
        self.assertEqual(run.status, PayrollRun.STATUS_PUBLISHED)

        from apps.hr.models import EmployeePortalNotification

        self.assertTrue(
            EmployeePortalNotification.objects.filter(
                employee=self.employee,
                category=EmployeePortalNotification.CATEGORY_PAYROLL,
                metadata__payroll_run_id=str(run.id),
            ).exists()
        )

        actions = list(run.audit_logs.values_list('action', flat=True))
        self.assertIn('SUBMIT_REVIEW', actions)
        self.assertIn('APPROVE', actions)
        self.assertIn('LOCK', actions)
        self.assertIn('PUBLISH', actions)

    def test_duplicate_submit_and_approve_are_idempotent(self):
        run = self.service.submit_for_review(self.payroll_run, performed_by=self.hr_user)
        again = self.service.submit_for_review(run, performed_by=self.hr_user)
        self.assertEqual(again.status, PayrollRun.STATUS_UNDER_REVIEW)

        approved = self.service.approve_payroll(again, hr_user=self.hr_user)
        approved_again = self.service.approve_payroll(approved, hr_user=self.hr_user)
        self.assertEqual(approved_again.status, PayrollRun.STATUS_APPROVED)

    def test_approval_blocks_negative_salary(self):
        self.payroll_run.final_salary = Decimal('-100.00')
        self.payroll_run.save()
        run = self.service.submit_for_review(self.payroll_run, performed_by=self.hr_user)
        with self.assertRaises(PayrollValidationError):
            self.service.approve_payroll(run, hr_user=self.hr_user)

    def test_locked_payroll_cannot_be_edited(self):
        self.payroll_run.status = PayrollRun.STATUS_LOCKED
        self.payroll_run.save(update_fields=['status', 'updated_at'])
        self.payroll_run.gross_salary = Decimal('1.00')
        with self.assertRaises(ValueError):
            self.payroll_run.save()

    def test_publish_requires_payslip(self):
        run = self.service.submit_for_review(self.payroll_run, performed_by=self.hr_user)
        run = self.service.approve_payroll(run, hr_user=self.hr_user)
        run = self.service.lock_payroll(run, performed_by=self.hr_user)
        with self.assertRaises(PayrollApprovalError):
            self.service.publish_payroll(run, performed_by=self.hr_user)

    def test_payslip_generation_blocked_before_lock(self):
        from apps.hr.payslip_generator import PayrollNotReadyError, PayslipGenerator

        with self.assertRaises(PayrollNotReadyError):
            PayslipGenerator().generate_payslip(self.payroll_run.id)


class PayrollApprovalApiTests(TestCase):
    def setUp(self):
        self.hospital = Hospital.objects.create(name='API Approval Hospital', slug='api-approval')
        self.employee = Employee.objects.create(
            hospital=self.hospital,
            name='API Employee',
            email='api-approval-employee@test.local',
            status='active',
        )
        self.hr_user = User.objects.create_user(
            email='hr-api-approval@test.local',
            password='test-pass-123',
            is_staff=True,
        )
        structure = SalaryStructure.objects.create(
            employee=self.employee,
            basic_salary=Decimal('20000.00'),
            effective_from=date(2026, 1, 1),
            is_active=True,
        )
        self.payroll_run = PayrollRun.objects.create(
            employee=self.employee,
            salary_structure=structure,
            month='2026-05',
            gross_salary=Decimal('20000.00'),
            final_salary=Decimal('20000.00'),
            status=PayrollRun.STATUS_DRAFT,
            calculation_snapshot={'working_days': 21, 'warnings': []},
        )
        finalization = finalize_hospital_attendance_month(self.hospital, '2026-05')
        snapshot = dict(self.payroll_run.calculation_snapshot)
        snapshot['input_snapshots'] = {
            'attendance_month_finalization_id': str(finalization.id),
        }
        self.payroll_run.calculation_snapshot = snapshot
        self.payroll_run.save(update_fields=['calculation_snapshot', 'updated_at'])
        self.client = APIClient()
        self.client.force_authenticate(user=self.hr_user)

    def test_hr_approval_api_workflow(self):
        res = self.client.post(f'/api/v1/hr/payroll-runs/{self.payroll_run.id}/submit-for-review/')
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data['status'], PayrollRun.STATUS_UNDER_REVIEW)

        res = self.client.post(f'/api/v1/hr/payroll-runs/{self.payroll_run.id}/approve/')
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data['status'], PayrollRun.STATUS_APPROVED)

        res = self.client.get(f'/api/v1/hr/payroll-runs/{self.payroll_run.id}/audit-trail/')
        self.assertEqual(res.status_code, 200)
        self.assertGreaterEqual(len(res.data['results']), 2)
