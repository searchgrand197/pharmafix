from datetime import datetime, time, timedelta

from django.contrib.auth import get_user_model
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from apps.hr.models import AttendancePunch, DailyAttendance, Employee, Shift
from apps.shared.models import Hospital

User = get_user_model()


class AttendancePunchApiTests(TestCase):
    def setUp(self):
        self.hospital = Hospital.objects.create(name='Punch API Hospital', slug='punch-api-hospital')
        self.shift = Shift.objects.create(
            hospital=self.hospital,
            name='General',
            code='GEN',
            start_time=time(9, 0),
            end_time=time(18, 0),
            grace_minutes=10,
            half_day_hours=4,
            full_day_hours=8,
        )
        self.employee = Employee.objects.create(
            hospital=self.hospital,
            name='Punch API Employee',
            email='punch-api@test.local',
            status='active',
            shift=self.shift,
        )
        self.inactive_employee = Employee.objects.create(
            hospital=self.hospital,
            name='Inactive Employee',
            email='inactive-punch@test.local',
            status='archived',
            shift=self.shift,
        )
        self.hr_user = User.objects.create_user(
            email='hr-punch-api@test.local',
            password='test-pass-123',
            is_staff=True,
        )
        self.work_date = timezone.localdate() - timedelta(days=5)
        self.client = APIClient()
        self.client.force_authenticate(user=self.hr_user)

    def _post_manual(self, **payload):
        body = {
            'employee': str(self.employee.id),
            'punch_type': 'IN',
            'punch_date': self.work_date.isoformat(),
            'punch_time': '09:00',
            'correction_reason': 'Test manual punch.',
            'source': 'HR_manual',
            **payload,
        }
        return self.client.post('/api/v1/hr/attendance-punches/', body, format='json')

    def test_hr_manual_punch_with_punch_date_and_time(self):
        response = self._post_manual()
        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual(response.data['source'], 'HR_manual')
        daily = DailyAttendance.objects.filter(employee=self.employee, date=self.work_date).first()
        self.assertIsNotNone(daily)
        self.assertIn(daily.attendance_status, {'in_progress', 'present', 'late', 'missing_checkout'})

    def test_hr_manual_punch_rejects_inactive_employee(self):
        response = self._post_manual(employee=str(self.inactive_employee.id))
        self.assertEqual(response.status_code, 400)
        self.assertIn('employee', response.data)

    def test_hr_manual_punch_rejects_out_without_in(self):
        response = self._post_manual(punch_type='OUT', punch_time='18:00')
        self.assertEqual(response.status_code, 400)
        self.assertIn('punch_type', response.data)

    def test_hr_manual_punch_sequence_in_then_out(self):
        first = self._post_manual()
        self.assertEqual(first.status_code, 201, first.data)
        second = self._post_manual(punch_type='OUT', punch_time='18:00')
        self.assertEqual(second.status_code, 201, second.data)

    def test_hr_manual_duplicate_punch_flagged_suspicious(self):
        ts = timezone.make_aware(
            datetime.combine(self.work_date, time(9, 0)),
            timezone.get_current_timezone(),
        )
        AttendancePunch.objects.create(
            employee=self.employee,
            shift=self.shift,
            attendance_date=self.work_date,
            timestamp=ts,
            punch_type='IN',
            source='biometric',
            is_suspicious=True,
            suspicious_reason='Ignored for alternation.',
        )
        response = self._post_manual(punch_time='09:01', correction_reason='Duplicate test.')
        self.assertEqual(response.status_code, 201, response.data)
        self.assertTrue(response.data['is_suspicious'])

    def test_list_punches_by_date(self):
        AttendancePunch.objects.create(
            employee=self.employee,
            shift=self.shift,
            attendance_date=self.work_date,
            timestamp=timezone.make_aware(
                datetime.combine(self.work_date, time(9, 0)),
                timezone.get_current_timezone(),
            ),
            punch_type='IN',
            source='HR_manual',
            correction_reason='Seed punch.',
        )
        response = self.client.get(
            '/api/v1/hr/attendance-punches/',
            {'date_from': self.work_date.isoformat(), 'date_to': self.work_date.isoformat()},
        )
        self.assertEqual(response.status_code, 200)
        rows = response.data.get('results', response.data)
        self.assertGreaterEqual(len(rows), 1)

    def test_mark_reviewed_clears_suspicious_flag(self):
        ts = timezone.make_aware(
            datetime.combine(self.work_date - timedelta(days=1), time(9, 0)),
            timezone.get_current_timezone(),
        )
        punch = AttendancePunch.objects.create(
            employee=self.employee,
            shift=self.shift,
            attendance_date=self.work_date - timedelta(days=1),
            timestamp=ts,
            punch_type='IN',
            source='biometric',
            is_suspicious=True,
            suspicious_reason='Test review.',
        )
        response = self.client.post(
            f'/api/v1/hr/attendance-punches/{punch.id}/mark-reviewed/',
            {'notes': 'Reviewed in test.'},
            format='json',
        )
        self.assertEqual(response.status_code, 200)
        punch.refresh_from_db()
        self.assertFalse(punch.is_suspicious)
