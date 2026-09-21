from datetime import datetime, time, timedelta

from django.contrib.auth import get_user_model
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from apps.hr.attendance_control import (
    AttendanceControlError,
    mark_attendance_via_biometric_simulation,
    punches_for_work_date,
    simulate_biometric_punch,
    suggest_next_punch_type,
)
from apps.hr.models import (
    AttendanceControlAuditLog,
    AttendancePunch,
    DailyAttendance,
    Employee,
    Shift,
)
from apps.shared.models import Hospital

User = get_user_model()


class AttendanceControlBiometricSimulationTests(TestCase):
    def setUp(self):
        self.hospital = Hospital.objects.create(name='Test Hospital', slug='test-hospital')
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
            name='Test Employee',
            email='attendance-control@test.local',
            status='active',
            shift=self.shift,
        )
        self.hr_user = User.objects.create_user(
            email='hr-attendance@test.local',
            password='test-pass-123',
            is_staff=True,
        )
        self.work_date = timezone.localdate() - timedelta(days=1)
        self.client = APIClient()
        self.client.force_authenticate(user=self.hr_user)

    def _mark(self, **payload):
        body = {
            'employee_id': str(self.employee.id),
            'date': self.work_date.isoformat(),
            'status': 'PRESENT',
            **payload,
        }
        return self.client.post('/api/v1/hr/attendance-control/mark/', body, format='json')

    def _punch(self, punch_type, *, work_date=None, clock=None, **payload):
        day = work_date or self.work_date
        if clock is None and 'timestamp' in payload:
            from apps.hr.attendance_policy import attendance_localtime

            local = attendance_localtime(payload.pop('timestamp'))
            clock = local.strftime('%H:%M')
            day = local.date()
        if clock is None:
            clock = '09:00'
        body = {
            'employee_id': str(self.employee.id),
            'punch_type': punch_type,
            'punch_date': day.isoformat(),
            'punch_time': clock,
            **payload,
        }
        return self.client.post('/api/v1/hr/attendance-control/punch/', body, format='json')

    def test_device_flow_in_then_out_same_day(self):
        """Real punch machine: separate IN tap, later OUT tap."""
        day = self.work_date - timedelta(days=6)
        tz = timezone.get_current_timezone()
        in_ts = timezone.make_aware(datetime.combine(day, time(9, 0)), tz)
        out_ts = timezone.make_aware(datetime.combine(day, time(18, 0)), tz)

        in_resp = self._punch('IN', work_date=day, clock='09:00')
        self.assertEqual(in_resp.status_code, 201, in_resp.data)
        self.assertEqual(in_resp.data['suggested_next_punch_type'], 'OUT')
        self.assertEqual(len(in_resp.data['today_punches']), 1)

        out_resp = self._punch('OUT', work_date=day, clock='18:00')
        self.assertEqual(out_resp.status_code, 201, out_resp.data)
        self.assertEqual(out_resp.data['suggested_next_punch_type'], 'IN')
        self.assertEqual(len(out_resp.data['today_punches']), 2)

        punches = AttendancePunch.objects.filter(
            employee=self.employee,
            attendance_date=day,
            is_void=False,
            source=AttendancePunch.SOURCE_MANUAL_BIOMETRIC_SIMULATION,
        ).order_by('timestamp')
        self.assertEqual(punches.count(), 2)
        self.assertEqual(punches[0].punch_type, 'IN')
        self.assertEqual(punches[1].punch_type, 'OUT')
        self.assertEqual(punches[0].device_id, 'BIO_SIM')

        daily = DailyAttendance.objects.get(employee=self.employee, date=day)
        self.assertIn(daily.attendance_status, {'present', 'late', 'overtime', 'incomplete'})

    def test_suggest_next_after_in_is_out(self):
        day = self.work_date - timedelta(days=7)
        tz = timezone.get_current_timezone()
        in_ts = timezone.make_aware(datetime.combine(day, time(9, 0)), tz)
        simulate_biometric_punch(
            employee_id=self.employee.id,
            punch_type='IN',
            punch_date=day,
            punch_time='09:00',
            marked_by=self.hr_user,
        )
        punches = punches_for_work_date(self.employee, day)
        self.assertEqual(suggest_next_punch_type(punches), 'OUT')

    def test_console_endpoint(self):
        day = self.work_date - timedelta(days=8)
        tz = timezone.get_current_timezone()
        in_ts = timezone.make_aware(datetime.combine(day, time(9, 0)), tz)
        self._punch('IN', work_date=day, clock='09:00')
        response = self.client.get(
            '/api/v1/hr/attendance-control/console/',
            {'employee_id': str(self.employee.id), 'date': day.isoformat()},
        )
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data['suggested_next_punch_type'], 'OUT')
        self.assertGreaterEqual(len(response.data['today_punches']), 1)

    def test_present_creates_real_punches_and_daily_attendance(self):
        response = self._mark(check_in='09:05', check_out='18:10')
        self.assertEqual(response.status_code, 201, response.data)
        self.assertTrue(response.data['success'])

        punches = AttendancePunch.objects.filter(
            employee=self.employee,
            attendance_date=self.work_date,
            is_void=False,
        ).order_by('timestamp')
        self.assertEqual(punches.count(), 2)
        self.assertEqual(punches[0].punch_type, 'IN')
        self.assertEqual(punches[1].punch_type, 'OUT')
        self.assertEqual(punches[0].source, AttendancePunch.SOURCE_MANUAL_BIOMETRIC_SIMULATION)
        self.assertEqual(punches[1].source, AttendancePunch.SOURCE_MANUAL_BIOMETRIC_SIMULATION)
        self.assertEqual(punches[0].created_by_id, self.hr_user.id)

        daily = DailyAttendance.objects.get(employee=self.employee, date=self.work_date)
        self.assertIn(daily.attendance_status, {'present', 'overtime'})
        self.assertIsNotNone(daily.first_check_in)
        self.assertIsNotNone(daily.last_check_out)

        audit = AttendanceControlAuditLog.objects.get(employee=self.employee, attendance_date=self.work_date)
        self.assertTrue(audit.success)
        self.assertEqual(audit.marked_by_id, self.hr_user.id)
        self.assertEqual(len(audit.punch_ids), 2)

    def test_absent_creates_no_punches(self):
        response = self._mark(status='ABSENT')
        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual(
            AttendancePunch.objects.filter(employee=self.employee, attendance_date=self.work_date).count(),
            0,
        )
        daily = DailyAttendance.objects.get(employee=self.employee, date=self.work_date)
        self.assertEqual(daily.attendance_status, 'absent')

    def test_late_uses_shift_defaults_when_times_omitted(self):
        response = self._mark(status='LATE')
        self.assertEqual(response.status_code, 201, response.data)
        in_punch = AttendancePunch.objects.get(employee=self.employee, punch_type='IN')
        local_in = timezone.localtime(in_punch.timestamp)
        self.assertGreater(local_in.time(), time(9, 10))

    def test_duplicate_mark_rejected(self):
        first = self._mark()
        self.assertEqual(first.status_code, 201)
        second = self._mark()
        self.assertEqual(second.status_code, 400)
        self.assertEqual(second.data['code'], 'duplicate_mark')
        self.assertEqual(
            AttendancePunch.objects.filter(employee=self.employee, attendance_date=self.work_date, is_void=False).count(),
            2,
        )

    def test_replace_existing_mark_updates_punches(self):
        first = self._mark(check_in='09:00', check_out='18:00')
        self.assertEqual(first.status_code, 201)
        second = self.client.post(
            '/api/v1/hr/attendance-control/mark/',
            {
                'employee_id': str(self.employee.id),
                'date': self.work_date.isoformat(),
                'status': 'LATE',
                'check_in': '09:45',
                'check_out': '18:00',
                'replace_existing': True,
            },
            format='json',
        )
        self.assertEqual(second.status_code, 201, second.data)
        active = AttendancePunch.objects.filter(
            employee=self.employee,
            attendance_date=self.work_date,
            is_void=False,
        ).order_by('timestamp')
        self.assertEqual(active.count(), 2)
        in_punch = active.filter(punch_type='IN').first()
        local_in = timezone.localtime(in_punch.timestamp)
        self.assertEqual(local_in.hour, 9)
        self.assertEqual(local_in.minute, 45)
        daily = DailyAttendance.objects.get(employee=self.employee, date=self.work_date)
        self.assertIn(daily.attendance_status, {'late', 'present'})

    def test_future_date_rejected(self):
        future = timezone.localdate() + timedelta(days=2)
        response = self._mark(date=future.isoformat())
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.data['code'], 'future_date')

    def test_inactive_employee_rejected(self):
        self.employee.status = 'inactive'
        self.employee.save(update_fields=['status', 'updated_at'])
        other_date = self.work_date - timedelta(days=1)
        response = self._mark(date=other_date.isoformat())
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.data['code'], 'employee_inactive')

    def test_non_hr_forbidden(self):
        user = User.objects.create_user(email='plain@test.local', password='x', is_staff=False)
        client = APIClient()
        client.force_authenticate(user=user)
        response = client.post(
            '/api/v1/hr/attendance-control/mark/',
            {
                'employee_id': str(self.employee.id),
                'date': (self.work_date - timedelta(days=2)).isoformat(),
                'status': 'PRESENT',
            },
            format='json',
        )
        self.assertEqual(response.status_code, 403)

    def test_existing_manual_punch_api_still_works(self):
        ts = timezone.make_aware(
            datetime.combine(self.work_date - timedelta(days=3), time(10, 0)),
            timezone.get_current_timezone(),
        )
        response = self.client.post(
            '/api/v1/hr/attendance-punches/',
            {
                'employee': str(self.employee.id),
                'timestamp': ts.isoformat(),
                'punch_type': 'IN',
                'source': 'HR_manual',
                'correction_reason': 'Legacy manual punch still supported.',
            },
            format='json',
        )
        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual(response.data['source'], 'HR_manual')

    def test_service_duplicate_punch_guard(self):
        mark_attendance_via_biometric_simulation(
            employee_id=self.employee.id,
            work_date=self.work_date - timedelta(days=4),
            status='PRESENT',
            check_in='09:00',
            check_out='18:00',
            marked_by=self.hr_user,
        )
        with self.assertRaises(AttendanceControlError) as ctx:
            mark_attendance_via_biometric_simulation(
                employee_id=self.employee.id,
                work_date=self.work_date - timedelta(days=4),
                status='PRESENT',
                check_in='09:00',
                check_out='18:00',
                marked_by=self.hr_user,
            )
        self.assertEqual(ctx.exception.code, 'duplicate_mark')
