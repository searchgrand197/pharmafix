"""
Full payroll end-to-end tests — HR flow through employee portal.

Covers: structure assign → generate → approve → lock → payslip → publish → employee view/download.
"""
from __future__ import annotations

from calendar import monthrange
from datetime import date
from decimal import Decimal
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.test import APIClient

from apps.hr.models import DailyAttendance, Employee, LeaveRequest, LeaveType
from apps.hr.payroll_calculator import PayrollCalculator, generate_monthly_payroll
from apps.hr.payroll_models import PayrollRun, Payslip, SalaryStructure
from apps.hr.tests.payroll_test_utils import finalize_hospital_attendance_month
from apps.shared.models import Hospital

User = get_user_model()
MONTH = '2026-05'
FAKE_PDF = b'%PDF-1.4 e2e payslip'


class PayrollE2EBase(TestCase):
    def setUp(self):
        self.hospital = Hospital.objects.create(name='E2E Payroll Hospital', slug='e2e-payroll')
        self.hr_user = User.objects.create_user(
            email='hr-e2e@test.local',
            password='test-pass-123',
            is_staff=True,
            hospital=self.hospital,
            must_change_password=False,
        )
        self.leave_paid = LeaveType.objects.create(hospital=self.hospital, name='Casual')
        self.leave_unpaid = LeaveType.objects.create(hospital=self.hospital, name='LWP')
        self.hr_client = APIClient()
        self.hr_client.force_authenticate(user=self.hr_user)

    def _make_employee(self, *, suffix: str, joining_date: date | None = None) -> Employee:
        email = f'e2e-{suffix}@test.local'
        user = User.objects.create_user(
            email=email,
            password='test-pass-123',
            must_change_password=False,
        )
        employee = Employee.objects.create(
            hospital=self.hospital,
            name=f'E2E Employee {suffix}',
            email=email,
            user=user,
            status='active',
            joining_date=joining_date or date(2026, 1, 1),
        )
        return employee

    def _template_structure(self, employee: Employee) -> SalaryStructure:
        return SalaryStructure.objects.create(
            employee=employee,
            basic_salary=Decimal('30000.00'),
            hra=Decimal('10000.00'),
            allowances={'transport': 2000},
            deductions={'pf': 1800},
            overtime_rate=Decimal('200.00'),
            effective_from=date(2026, 1, 1),
            is_active=True,
        )

    def _seed_weekdays_may(self, employee: Employee, *, present_days: list[int] | None = None, overtime_day: int | None = None):
        present = set(present_days or [5, 6, 7, 8, 9])
        last = monthrange(2026, 5)[1]
        for day_num in range(1, last + 1):
            day = date(2026, 5, day_num)
            if day.weekday() >= 5:
                status = 'weekend'
            elif day_num in present:
                status = 'present'
            else:
                status = 'absent'
            row = DailyAttendance.objects.create(employee=employee, date=day, attendance_status=status)
            if overtime_day and day_num == overtime_day:
                row.overtime_hours = Decimal('2.00')
                row.save(update_fields=['overtime_hours'])

    def _assign_structure_api(self, employee: Employee, source: SalaryStructure) -> dict:
        res = self.hr_client.post(
            '/api/payroll/structures/assign/',
            {
                'employee': str(employee.id),
                'source_structure_id': str(source.id),
                'effective_from': '2026-01-01',
            },
            format='json',
        )
        self.assertEqual(res.status_code, 201, res.data)
        return res.data

    def _finalize_may(self) -> None:
        finalize_hospital_attendance_month(self.hospital, MONTH, user=self.hr_user)

    def _run_full_hr_to_employee_flow(self, employee: Employee, mock_pdf):
        from django.core.files.base import ContentFile

        mock_pdf.return_value = ContentFile(FAKE_PDF)

        template_owner = self._make_employee(suffix=f'tpl-{employee.id.hex[:8]}')
        template = self._template_structure(template_owner)
        assigned = self._assign_structure_api(employee, template)
        self._finalize_may()

        gen_res = self.hr_client.post('/api/payroll/run/', {'month': MONTH}, format='json')
        self.assertIn(gen_res.status_code, {200, 201}, gen_res.data)
        self.assertGreaterEqual(gen_res.data.get('created_count', 0), 1)

        gen_dup = self.hr_client.post('/api/payroll/run/', {'month': MONTH}, format='json')
        self.assertEqual(gen_dup.data.get('created_count', 0), 0)
        self.assertGreaterEqual(gen_dup.data.get('recalculated_count', 0), 1)

        runs_res = self.hr_client.get('/api/payroll/runs/', {'month': MONTH, 'employee': str(employee.id)})
        self.assertEqual(runs_res.status_code, 200)
        run_row = runs_res.data['results'][0]
        run_id = run_row['id']

        calc = PayrollCalculator(employee=employee, month=MONTH)
        expected = calc.calculate()
        self.assertAlmostEqual(float(run_row['final_salary']), float(expected.final_salary), places=2)

        approve_res = self.hr_client.post(f'/api/payroll/run/{run_id}/approve/')
        self.assertEqual(approve_res.status_code, 200)
        self.assertEqual(approve_res.data['status'], PayrollRun.STATUS_APPROVED)

        lock_res = self.hr_client.post(f'/api/payroll/run/{run_id}/lock/')
        self.assertEqual(lock_res.status_code, 200)
        self.assertEqual(lock_res.data['status'], PayrollRun.STATUS_LOCKED)

        payslip_res = self.hr_client.post(f'/api/v1/hr/payroll-runs/{run_id}/generate-payslip/')
        self.assertEqual(payslip_res.status_code, 201, payslip_res.data)
        payslip_id = payslip_res.data['id']

        publish_res = self.hr_client.post(f'/api/v1/hr/payroll-runs/{run_id}/publish/')
        self.assertEqual(publish_res.status_code, 200)
        self.assertEqual(publish_res.data['status'], PayrollRun.STATUS_PUBLISHED)

        emp_client = APIClient()
        emp_client.force_authenticate(user=employee.user)
        portal_list = emp_client.get('/api/payroll/payslips/', {'month': MONTH})
        self.assertEqual(portal_list.status_code, 200)
        self.assertGreaterEqual(len(portal_list.data['results']), 1)

        detail = emp_client.get(f'/api/v1/employee-portal/payslips/{payslip_id}/')
        self.assertEqual(detail.status_code, 200)
        self.assertEqual(detail.data['month'], MONTH)

        download = emp_client.get(f'/api/v1/employee-portal/payslips/{payslip_id}/download/')
        self.assertEqual(download.status_code, 200)
        self.assertTrue(download['Content-Type'].startswith('application/pdf'))
        pdf_bytes = b''.join(download.streaming_content)
        self.assertTrue(pdf_bytes[:4] == b'%PDF')

        return {
            'assigned_structure_id': assigned['id'],
            'run_id': run_id,
            'payslip_id': payslip_id,
            'expected_net': str(expected.final_salary),
            'actual_net': str(run_row['final_salary']),
        }


class PayrollE2EHappyPathTests(PayrollE2EBase):
    @patch('apps.hr.payslip_generator.render_payslip_pdf_bytes')
    def test_full_flow_standard_employee(self, mock_pdf):
        employee = self._make_employee(suffix='standard')
        self._seed_weekdays_may(employee, present_days=[5, 6, 7, 8, 9, 12, 13, 14, 15, 16])
        result = self._run_full_hr_to_employee_flow(employee, mock_pdf)
        self.assertEqual(result['expected_net'], result['actual_net'])

    @patch('apps.hr.payslip_generator.render_payslip_pdf_bytes')
    def test_full_flow_with_overtime(self, mock_pdf):
        employee = self._make_employee(suffix='overtime')
        self._seed_weekdays_may(employee, present_days=[5, 6, 7, 8, 9], overtime_day=5)
        result = self._run_full_hr_to_employee_flow(employee, mock_pdf)
        run = PayrollRun.objects.get(pk=result['run_id'])
        self.assertGreater(Decimal(str(run.overtime_hours)), Decimal('0'))


class PayrollE2EEdgeCaseTests(PayrollE2EBase):
    def test_no_attendance_still_generates_with_warning(self):
        employee = self._make_employee(suffix='no-att')
        self._template_structure(employee)
        self._finalize_may()
        batch = generate_monthly_payroll(MONTH, calculated_by=self.hr_user, employee_queryset=Employee.objects.filter(pk=employee.pk))
        self.assertEqual(len(batch.created), 1)
        warnings = batch.created[0].calculation_snapshot.get('warnings') or []
        self.assertTrue(any('No attendance' in str(w) for w in warnings))

    def test_employee_on_leave(self):
        employee = self._make_employee(suffix='on-leave', joining_date=date(2026, 5, 4))
        self._template_structure(employee)
        self._seed_weekdays_may(employee, present_days=[4, 8, 9])
        LeaveRequest.objects.create(
            employee=employee,
            leave_type=self.leave_paid,
            start_date=date(2026, 5, 5),
            end_date=date(2026, 5, 5),
            status=LeaveRequest.STATUS_APPROVED,
        )
        self._finalize_may()
        calc = PayrollCalculator(employee=employee, month=MONTH)
        leave = calc.calculate_leave_days()
        self.assertGreaterEqual(leave.paid, Decimal('1.00'))
        batch = generate_monthly_payroll(MONTH, calculated_by=self.hr_user, employee_queryset=Employee.objects.filter(pk=employee.pk))
        self.assertEqual(len(batch.created), 1)

    def test_mid_month_joining_reduces_working_days(self):
        employee = self._make_employee(suffix='mid-join', joining_date=date(2026, 5, 28))
        self._template_structure(employee)
        DailyAttendance.objects.create(employee=employee, date=date(2026, 5, 28), attendance_status='present')
        DailyAttendance.objects.create(employee=employee, date=date(2026, 5, 29), attendance_status='present')
        self._finalize_may()
        calc = PayrollCalculator(employee=employee, month=MONTH)
        self.assertEqual(calc.calculate_working_days(), 2)
        batch = generate_monthly_payroll(MONTH, calculated_by=self.hr_user, employee_queryset=Employee.objects.filter(pk=employee.pk))
        self.assertEqual(len(batch.created), 1)

    def test_mid_month_joining_prorates_june_payroll_run(self):
        month = '2026-06'
        employee = self._make_employee(suffix='june-proration', joining_date=date(2026, 6, 22))
        self._template_structure(employee)
        for day in [
            date(2026, 6, 22),
            date(2026, 6, 23),
            date(2026, 6, 24),
            date(2026, 6, 25),
            date(2026, 6, 26),
            date(2026, 6, 29),
            date(2026, 6, 30),
        ]:
            DailyAttendance.objects.create(employee=employee, date=day, attendance_status='present')
        for day in [date(2026, 6, 27), date(2026, 6, 28)]:
            DailyAttendance.objects.create(employee=employee, date=day, attendance_status='weekend')

        finalize_hospital_attendance_month(self.hospital, month, user=self.hr_user)
        calc = PayrollCalculator(employee=employee, month=month)
        batch = generate_monthly_payroll(
            month,
            calculated_by=self.hr_user,
            employee_queryset=Employee.objects.filter(pk=employee.pk),
        )

        self.assertEqual(len(batch.created), 1)
        run = batch.created[0]
        self.assertEqual(calc.calculate_full_month_working_days(), 22)
        self.assertEqual(calc.calculate_working_days(), 7)
        self.assertEqual(run.gross_salary, Decimal('13363.64'))
        self.assertEqual(run.final_salary, Decimal('11563.64'))
        self.assertLess(run.gross_salary, Decimal('42000.00'))

    def test_missing_salary_structure_skipped(self):
        employee = self._make_employee(suffix='no-structure')
        self._seed_weekdays_may(employee, present_days=[5, 6, 7])
        self._finalize_may()
        batch = generate_monthly_payroll(MONTH, calculated_by=self.hr_user, employee_queryset=Employee.objects.filter(pk=employee.pk))
        self.assertEqual(len(batch.created), 0)
        self.assertEqual(len(batch.skipped), 1)
        self.assertEqual(batch.skipped[0]['reason'], 'missing_salary_structure')

    def test_duplicate_payroll_run_blocked(self):
        employee = self._make_employee(suffix='dup-run')
        self._template_structure(employee)
        self._seed_weekdays_may(employee, present_days=[5, 6, 7])
        self._finalize_may()
        first = generate_monthly_payroll(MONTH, calculated_by=self.hr_user, employee_queryset=Employee.objects.filter(pk=employee.pk))
        second = generate_monthly_payroll(MONTH, calculated_by=self.hr_user, employee_queryset=Employee.objects.filter(pk=employee.pk))
        self.assertEqual(len(first.created), 1)
        self.assertEqual(len(second.created), 0)
        self.assertEqual(len(second.recalculated), 1)
        self.assertEqual(PayrollRun.objects.filter(employee=employee, month=MONTH).count(), 1)

    def test_assignment_history_tracked(self):
        employee = self._make_employee(suffix='history')
        template_employee = self._make_employee(suffix='template-src')
        s1 = self._template_structure(template_employee)
        res = self.hr_client.post(
            '/api/payroll/structures/assign/',
            {
                'employee': str(employee.id),
                'source_structure_id': str(s1.id),
                'effective_from': '2026-01-01',
            },
            format='json',
        )
        self.assertEqual(res.status_code, 201, res.data)
        dup = self.hr_client.post(
            '/api/payroll/structures/assign/',
            {
                'employee': str(employee.id),
                'source_structure_id': str(s1.id),
                'effective_from': '2026-01-01',
            },
            format='json',
        )
        self.assertEqual(dup.status_code, 400, dup.data)
        self.assertEqual(dup.data.get('code'), 'duplicate_effective_from')

        res2 = self.hr_client.post(
            '/api/payroll/structures/assign/',
            {
                'employee': str(employee.id),
                'basic_salary': '32000.00',
                'hra': '10000.00',
                'allowances': {'transport': 2000},
                'deductions': {'pf': 1800},
                'overtime_rate': '200.00',
                'effective_from': '2026-06-01',
            },
            format='json',
        )
        self.assertEqual(res2.status_code, 201, res2.data)

        hist = self.hr_client.get('/api/payroll/structures/history/', {'employee': str(employee.id)})
        self.assertEqual(hist.status_code, 200)
        self.assertGreaterEqual(len(hist.data['results']), 2)
        active = [r for r in hist.data['results'] if r['is_active']]
        self.assertEqual(len(active), 1)
