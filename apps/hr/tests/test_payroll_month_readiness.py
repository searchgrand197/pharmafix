from datetime import date
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.test import APIClient

from apps.hr.models import DailyAttendance, Employee
from apps.hr.payroll_models import PayrollRun
from apps.hr.payroll_month_readiness import compute_payroll_month_readiness
from apps.hr.tests.payroll_test_utils import finalize_hospital_attendance_month
from apps.shared.models import Hospital

User = get_user_model()


class PayrollMonthReadinessServiceTests(TestCase):
    def setUp(self):
        self.hospital = Hospital.objects.create(name='Readiness Hospital', slug='readiness-hosp')
        self.month = '2026-05'
        self.employee = Employee.objects.create(
            hospital=self.hospital,
            name='Ready Dev',
            email='ready-dev@test.local',
            status='active',
            joining_date=date(2026, 1, 1),
        )

    def _seed_attendance(self):
        for day_num in range(1, 32):
            day = date(2026, 5, day_num)
            status = 'weekend' if day.weekday() >= 5 else 'present'
            DailyAttendance.objects.create(
                employee=self.employee,
                date=day,
                attendance_status=status,
            )

    @patch('apps.hr.payroll_month_readiness._count_payroll_eligible_employees', return_value=1)
    def test_readiness_none_without_attendance(self, _mock_eligible):
        readiness = compute_payroll_month_readiness(self.hospital, self.month)
        self.assertEqual(readiness.next_action, 'none')
        self.assertEqual(readiness.attendance_row_count, 0)

    @patch('apps.hr.payroll_month_readiness._count_payroll_eligible_employees', return_value=1)
    def test_readiness_finalize_when_attendance_not_finalized(self, _mock_eligible):
        self._seed_attendance()
        readiness = compute_payroll_month_readiness(self.hospital, self.month)
        self.assertEqual(readiness.next_action, 'finalize_attendance')
        self.assertFalse(readiness.finalized)
        self.assertGreater(readiness.attendance_row_count, 0)

    @patch('apps.hr.payroll_month_readiness._count_payroll_eligible_employees', return_value=1)
    def test_readiness_calculate_after_finalize(self, _mock_eligible):
        self._seed_attendance()
        finalize_hospital_attendance_month(self.hospital, self.month)
        readiness = compute_payroll_month_readiness(self.hospital, self.month)
        self.assertTrue(readiness.finalized)
        self.assertEqual(readiness.next_action, 'calculate_payroll')

    @patch('apps.hr.payroll_month_readiness._count_payroll_eligible_employees', return_value=1)
    def test_readiness_review_when_draft_runs_exist(self, _mock_eligible):
        self._seed_attendance()
        finalize_hospital_attendance_month(self.hospital, self.month)
        PayrollRun.objects.create(
            employee=self.employee,
            month=self.month,
            status=PayrollRun.STATUS_DRAFT,
        )
        readiness = compute_payroll_month_readiness(self.hospital, self.month)
        self.assertEqual(readiness.next_action, 'review_payroll')
        self.assertEqual(readiness.payroll_runs_needing_action, 1)

    @patch('apps.hr.payroll_month_readiness._count_payroll_eligible_employees', return_value=1)
    def test_readiness_none_when_payroll_locked(self, _mock_eligible):
        self._seed_attendance()
        finalize_hospital_attendance_month(self.hospital, self.month)
        PayrollRun.objects.create(
            employee=self.employee,
            month=self.month,
            status=PayrollRun.STATUS_LOCKED,
        )
        readiness = compute_payroll_month_readiness(self.hospital, self.month)
        self.assertEqual(readiness.next_action, 'none')


class PayrollMonthReadinessApiTests(TestCase):
    def setUp(self):
        self.hospital = Hospital.objects.create(name='Readiness API', slug='readiness-api')
        self.hr_user = User.objects.create_user(
            email='hr-readiness-api@test.local',
            password='test-pass-123',
            is_staff=True,
            hospital=self.hospital,
        )
        self.client = APIClient()
        self.client.force_authenticate(user=self.hr_user)

    @patch('apps.hr.payroll_month_readiness._count_payroll_eligible_employees', return_value=0)
    def test_api_returns_readiness_payload(self, _mock_eligible):
        res = self.client.get('/api/v1/hr/payroll-month-readiness/', {'month': '2026-05'})
        self.assertEqual(res.status_code, 200)
        self.assertIn('next_action', res.data)
        self.assertEqual(res.data['month'], '2026-05')

    @patch('apps.hr.payroll_month_readiness._count_payroll_eligible_employees', return_value=0)
    def test_api_provisions_hospital_when_tenant_missing(self, _mock_eligible):
        self.hr_user.hospital = None
        self.hr_user.save(update_fields=['hospital'])
        self.hospital.delete()
        res = self.client.get('/api/v1/hr/payroll-month-readiness/', {'month': '2026-05'})
        self.assertEqual(res.status_code, 200)
        self.hr_user.refresh_from_db()
        self.assertIsNotNone(self.hr_user.hospital_id)
