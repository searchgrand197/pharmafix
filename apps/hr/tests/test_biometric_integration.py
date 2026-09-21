"""Biometric integration tests."""

from __future__ import annotations

from datetime import date, datetime, time, timedelta
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.test import Client, TestCase
from django.utils import timezone
from apps.hr.attendance_analytics import build_dashboard_summary
from rest_framework.test import APIClient

from apps.hr.biometric.device_commands import (
    pop_device_command,
    queue_device_command,
    record_command_result,
)
from apps.hr.biometric.ingestion import ingest_attlog_line
from apps.hr.biometric.punch_pairing import suggest_next_punch_type
from apps.hr.biometric.sync import assign_biometric_pin, push_employee_to_hospital_devices
from apps.hr.biometric.time_sync import get_adms_timezone_offset
from apps.hr.biometric.unlinked_service import (
    BiometricLinkError,
    create_employee_from_unlinked,
    link_unlinked_user_to_employee,
    reject_unlinked_user,
)
from apps.hr.biometric_models import (
    BiometricDevice,
    BiometricDeviceCommand,
    BiometricRejectedPunch,
    BiometricUnlinkedUser,
)
from apps.hr.models import AttendancePunch, DailyAttendance, Department, Designation, Employee, Shift
from apps.shared.models import Hospital


class BiometricPinAssignmentTests(TestCase):
    def setUp(self):
        self.hospital = Hospital.objects.create(name='Bio H1', slug='bio-h1')
        self.other = Hospital.objects.create(name='Bio H2', slug='bio-h2')

    def test_sequential_pin_per_hospital(self):
        e1 = Employee.objects.create(
            hospital=self.hospital, name='A', email='a@test.local', status='active',
            onboarding_completed=True, biometric_attendance_enabled=True,
        )
        e2 = Employee.objects.create(
            hospital=self.hospital, name='B', email='b@test.local', status='active',
            onboarding_completed=True, biometric_attendance_enabled=True,
        )
        e3 = Employee.objects.create(
            hospital=self.other, name='C', email='c@test.local', status='active',
            onboarding_completed=True, biometric_attendance_enabled=True,
        )
        self.assertEqual(assign_biometric_pin(e1), '1')
        self.assertEqual(assign_biometric_pin(e2), '2')
        self.assertEqual(assign_biometric_pin(e3), '1')


class BiometricIngestionTests(TestCase):
    # Fixed Wednesday so punch times (e.g. 18:02) are never "future" vs mocked now.
    FIXED_DAY = date(2026, 6, 18)

    def setUp(self):
        self.hospital = Hospital.objects.create(name='Ingest H', slug='ingest-h')
        self.device = BiometricDevice.objects.create(
            hospital=self.hospital,
            serial_number='SN-INGEST-001',
            name='Gate',
        )
        self.shift = Shift.objects.create(
            hospital=self.hospital,
            name='Day',
            code='DAY',
            start_time=time(9, 0),
            end_time=time(18, 0),
            grace_minutes=10,
            half_day_hours=4,
            full_day_hours=8,
        )
        self.employee = Employee.objects.create(
            hospital=self.hospital,
            name='Punch User',
            email='punch@test.local',
            status='active',
            onboarding_completed=True,
            biometric_attendance_enabled=True,
            biometric_pin='101',
            shift=self.shift,
        )
        tz = timezone.get_current_timezone()
        self.day = self.FIXED_DAY
        self.fixed_now = timezone.make_aware(datetime.combine(self.day, time(21, 0)), tz)
        self.now_patcher = patch('django.utils.timezone.now', return_value=self.fixed_now)
        self.now_patcher.start()

    def tearDown(self):
        self.now_patcher.stop()

    def _aware(self, clock: time) -> datetime:
        tz = timezone.get_current_timezone()
        return timezone.make_aware(datetime.combine(self.day, clock), tz)

    def test_in_out_alternation_creates_daily_attendance(self):
        in_ts = self._aware(time(9, 5))
        out_ts = self._aware(time(18, 2))

        self.assertTrue(ingest_attlog_line(self.device, '101', in_ts, 0, 1, 'line1'))
        self.assertTrue(ingest_attlog_line(self.device, '101', out_ts, 0, 1, 'line2'))

        punches = AttendancePunch.objects.filter(employee=self.employee, source='biometric')
        self.assertEqual(punches.count(), 2)
        self.assertEqual(list(punches.order_by('timestamp').values_list('punch_type', flat=True)), ['IN', 'OUT'])

        daily = DailyAttendance.objects.get(employee=self.employee, date=self.day)
        self.assertIsNotNone(daily.first_check_in)
        self.assertIsNotNone(daily.last_check_out)

        summary = build_dashboard_summary(self.day, hospital_id=self.hospital.id, force_rebuild=False)
        self.assertEqual(summary['present_today'], 1)
        self.assertEqual(summary['late_employees'], 1)

    def test_unknown_pin_creates_unlinked_user(self):
        ts = self._aware(time(10, 0))
        self.assertFalse(ingest_attlog_line(self.device, '999', ts, 0, 1, 'line'))
        self.assertTrue(BiometricUnlinkedUser.objects.filter(hospital=self.hospital, pin='999').exists())
        self.assertEqual(AttendancePunch.objects.count(), 0)

    def test_disabled_biometric_rejects_punch(self):
        self.employee.biometric_attendance_enabled = False
        self.employee.save()
        ts = self._aware(time(10, 0))
        self.assertFalse(ingest_attlog_line(self.device, '101', ts, 0, 1, 'line'))
        self.assertEqual(BiometricRejectedPunch.objects.filter(pin='101', reason='biometric_disabled').count(), 1)

    def test_reentry_in_after_quick_out_not_suspicious(self):
        """IN → OUT → IN within 2 minutes must count as a valid new check-in."""
        t_in1 = self._aware(time(16, 2, 48))
        t_out = self._aware(time(16, 2, 53))
        t_in2 = self._aware(time(16, 3, 23))

        self.assertTrue(ingest_attlog_line(self.device, '101', t_in1, 0, 1, 'line1'))
        self.assertTrue(ingest_attlog_line(self.device, '101', t_out, 0, 1, 'line2'))
        self.assertTrue(ingest_attlog_line(self.device, '101', t_in2, 0, 1, 'line3'))

        punches = list(AttendancePunch.objects.filter(employee=self.employee).order_by('timestamp'))
        self.assertEqual(len(punches), 3)
        self.assertFalse(punches[2].is_suspicious)

        daily = DailyAttendance.objects.get(employee=self.employee, date=self.day)
        self.assertEqual(daily.first_check_in, t_in1)
        self.assertEqual(daily.last_check_out, t_out)

    def test_late_biometric_day_counts_as_present_and_late_on_dashboard(self):
        in_ts = self._aware(time(9, 25))
        out_ts = self._aware(time(18, 0))

        self.assertTrue(ingest_attlog_line(self.device, '101', in_ts, 0, 1, 'late-in'))
        self.assertTrue(ingest_attlog_line(self.device, '101', out_ts, 0, 1, 'late-out'))

        daily = DailyAttendance.objects.get(employee=self.employee, date=self.day)
        self.assertEqual(daily.attendance_status, 'late')
        self.assertGreater(daily.late_minutes, 0)

        summary = build_dashboard_summary(self.day, hospital_id=self.hospital.id, force_rebuild=False)
        self.assertEqual(summary['present_today'], 1)
        self.assertEqual(summary['late_employees'], 1)

    def test_future_device_time_is_rejected(self):
        ts = self.fixed_now + timedelta(minutes=20)
        self.assertFalse(ingest_attlog_line(self.device, '101', ts, 0, 1, 'future-line'))
        rejected = BiometricRejectedPunch.objects.get(pin='101', reason='future_device_time')
        self.assertGreater(rejected.metadata['future_minutes'], 5)

    def test_out_of_order_upload_resequences_existing_biometric_punches(self):
        late_first = self._aware(time(18, 0))
        early_second = self._aware(time(9, 0))

        self.assertTrue(ingest_attlog_line(self.device, '101', late_first, 0, 1, 'late-first'))
        self.assertTrue(ingest_attlog_line(self.device, '101', early_second, 0, 1, 'early-second'))

        punches = list(AttendancePunch.objects.filter(employee=self.employee).order_by('timestamp'))
        self.assertEqual([p.punch_type for p in punches], ['IN', 'OUT'])
        self.assertEqual(punches[0].timestamp, early_second)
        self.assertEqual(punches[1].timestamp, late_first)

        daily = DailyAttendance.objects.get(employee=self.employee, date=self.day)
        self.assertEqual(daily.first_check_in, early_second)
        self.assertEqual(daily.last_check_out, late_first)

    def test_finalized_day_conflict_preserves_row_and_flags_review(self):
        DailyAttendance.objects.create(
            employee=self.employee,
            date=self.day,
            shift=self.shift,
            attendance_status='absent',
            attendance_source='NONE',
            finalized=True,
        )
        in_ts = self._aware(time(9, 0))

        self.assertTrue(ingest_attlog_line(self.device, '101', in_ts, 0, 1, 'finalized-conflict'))

        daily = DailyAttendance.objects.get(employee=self.employee, date=self.day)
        self.assertEqual(daily.attendance_status, 'absent')
        self.assertTrue(daily.requires_hr_review)
        self.assertIn('finalized attendance day', daily.remarks.lower())

    def test_overnight_shift_afternoon_in_out_same_attendance_date(self):
        overnight = Shift.objects.create(
            hospital=self.hospital,
            name='Night',
            code='NIGHT',
            start_time=time(18, 0),
            end_time=time(0, 0),
            is_overnight=True,
            grace_minutes=10,
            half_day_hours=4,
            full_day_hours=8,
        )
        self.employee.shift = overnight
        self.employee.save()

        tz = timezone.get_current_timezone()
        t_in = timezone.make_aware(datetime.combine(self.day, time(14, 59, 52)), tz)
        t_out = timezone.make_aware(datetime.combine(self.day, time(15, 4, 17)), tz)

        self.assertTrue(ingest_attlog_line(self.device, '101', t_in, 0, 1, 'in'))
        self.assertTrue(ingest_attlog_line(self.device, '101', t_out, 0, 1, 'out'))

        in_punch, out_punch = AttendancePunch.objects.filter(employee=self.employee).order_by('timestamp')
        self.assertEqual(in_punch.attendance_date, self.day)
        self.assertEqual(out_punch.attendance_date, self.day)

        daily = DailyAttendance.objects.get(employee=self.employee, date=self.day)
        self.assertEqual(daily.first_check_in, t_in)
        self.assertEqual(daily.last_check_out, t_out)


class BiometricDeviceCommandTests(TestCase):
    def setUp(self):
        self.device = BiometricDevice.objects.create(serial_number='SN-CMD-001')

    def test_queue_pop_and_ack(self):
        cmd = queue_device_command(self.device, 'DATA UPDATE USERINFO PIN=1\tName=Test')
        line = pop_device_command(self.device.serial_number)
        self.assertIn(f'C:{cmd.command_id}:', line)
        body = record_command_result(self.device.serial_number, cmd.command_id, '0')
        self.assertIn('DATA UPDATE USERINFO', body)
        cmd.refresh_from_db()
        self.assertEqual(cmd.status, BiometricDeviceCommand.STATUS_ACKED)


class BiometricIclockTests(TestCase):
    def test_handshake_and_attlog_post(self):
        client = Client()
        response = client.get('/iclock/cdata?SN=SN-HTTP-001&options=all')
        self.assertEqual(response.status_code, 200)
        self.assertIn(b'Realtime=1', response.content)
        self.assertTrue(BiometricDevice.objects.filter(serial_number='SN-HTTP-001').exists())

        hospital = Hospital.objects.create(name='HTTP H', slug='http-h')
        device = BiometricDevice.objects.filter(serial_number='SN-HTTP-001').first()
        device.hospital = hospital
        device.save()
        Employee.objects.create(
            hospital=hospital,
            name='HTTP Worker',
            email='http@test.local',
            status='active',
            onboarding_completed=True,
            biometric_attendance_enabled=True,
            biometric_pin='55',
        )
        body = '55\t2026-06-28 09:00:00\t0\t1\t0\t0'
        response = client.post('/iclock/cdata?SN=SN-HTTP-001&table=ATTLOG', data=body, content_type='text/plain')
        self.assertEqual(response.status_code, 200)
        self.assertTrue(AttendancePunch.objects.filter(device_id='SN-HTTP-001').exists())


class BiometricUnlinkedServiceTests(TestCase):
    def setUp(self):
        User = get_user_model()
        self.hospital = Hospital.objects.create(name='Link H', slug='link-h')
        self.department = Department.objects.create(hospital=self.hospital, name='Ops')
        self.designation = Designation.objects.create(
            hospital=self.hospital,
            department=self.department,
            name='Staff',
            code='STAFF',
            is_active=True,
        )
        self.hr_user = User.objects.create_user(
            email='hr-link@test.local',
            password='test-pass',
            hospital=self.hospital,
            is_staff=True,
        )
        self.device = BiometricDevice.objects.create(
            hospital=self.hospital, serial_number='SN-LINK',
        )
        self.unlinked = BiometricUnlinkedUser.objects.create(
            hospital=self.hospital,
            device=self.device,
            pin='77',
            name='Device User',
            status=BiometricUnlinkedUser.STATUS_PENDING,
        )
        self.employee = Employee.objects.create(
            hospital=self.hospital,
            name='HR User',
            email='hr-link-existing@test.local',
            status='active',
            onboarding_completed=True,
            designation=self.designation,
            department_ref=self.department,
            department=self.department.name,
        )

    def test_link_assigns_pin_and_queues_push(self):
        result = link_unlinked_user_to_employee(self.unlinked, self.employee)
        self.assertEqual(result['biometric_pin'], '77')
        self.employee.refresh_from_db()
        self.assertEqual(self.employee.biometric_pin, '77')
        self.assertTrue(self.employee.biometric_attendance_enabled)
        self.assertTrue(
            BiometricDeviceCommand.objects.filter(device=self.device, status='pending').exists()
        )

    def test_reject_queues_delete(self):
        result = reject_unlinked_user(self.unlinked)
        self.assertEqual(result['status'], BiometricUnlinkedUser.STATUS_REJECTED)
        self.assertTrue(
            BiometricDeviceCommand.objects.filter(
                device=self.device,
                command_body__contains='DATA DELETE USERINFO',
            ).exists()
        )

    def test_create_and_link_assigns_machine_pin(self):
        today = timezone.localdate().isoformat()
        result = create_employee_from_unlinked(
            self.unlinked,
            hr_user=self.hr_user,
            payload={
                'email': 'device.user@example.com',
                'phone': '9876543210',
                'gender': 'male',
                'department': self.department.name,
                'designation': str(self.designation.id),
                'joining_date': today,
            },
        )
        self.assertEqual(result['biometric_pin'], '77')
        employee = Employee.objects.get(pk=result['employee_id'])
        self.assertEqual(employee.biometric_pin, '77')
        self.assertTrue(employee.biometric_attendance_enabled)
        self.unlinked.refresh_from_db()
        self.assertEqual(self.unlinked.status, BiometricUnlinkedUser.STATUS_LINKED)
        self.assertEqual(self.unlinked.linked_employee_id, employee.id)

    def test_create_and_link_accepts_uuid_designation_from_api(self):
        import uuid
        from apps.hr.biometric_models import BiometricUnlinkedUser as Unlinked

        unlinked = Unlinked.objects.create(
            hospital=self.hospital,
            device=self.device,
            pin='78',
            name='API User',
            status=Unlinked.STATUS_PENDING,
        )
        today = timezone.localdate().isoformat()
        result = create_employee_from_unlinked(
            unlinked,
            hr_user=self.hr_user,
            payload={
                'email': 'api.uuid@example.com',
                'phone': '9876543211',
                'gender': 'female',
                'department': self.department.name,
                'designation': uuid.UUID(str(self.designation.id)),
                'joining_date': today,
            },
        )
        self.assertEqual(result['biometric_pin'], '78')

    def test_create_and_link_rejects_duplicate_email(self):
        today = timezone.localdate().isoformat()
        with self.assertRaises(BiometricLinkError) as ctx:
            create_employee_from_unlinked(
                self.unlinked,
                hr_user=self.hr_user,
                payload={
                    'email': self.employee.email,
                    'phone': '9876543211',
                    'gender': 'male',
                    'department': self.department.name,
                    'designation': str(self.designation.id),
                    'joining_date': today,
                },
            )
        self.assertEqual(ctx.exception.code, 'duplicate_email')

    def test_link_rejects_pin_conflict(self):
        other = BiometricUnlinkedUser.objects.create(
            hospital=self.hospital,
            device=self.device,
            pin='88',
            name='Other Device User',
            status=BiometricUnlinkedUser.STATUS_PENDING,
        )
        Employee.objects.create(
            hospital=self.hospital,
            name='Pin Owner',
            email='pin-owner@test.local',
            status='active',
            onboarding_completed=True,
            biometric_pin='88',
            designation=self.designation,
            department_ref=self.department,
            department=self.department.name,
        )
        with self.assertRaises(BiometricLinkError) as ctx:
            link_unlinked_user_to_employee(other, self.employee)
        self.assertEqual(ctx.exception.code, 'pin_conflict')

    def test_create_and_link_api_accepts_gender(self):
        today = timezone.localdate().isoformat()
        client = APIClient()
        client.force_authenticate(user=self.hr_user)
        res = client.post(
            f'/api/v1/hr/biometric-unlinked-users/{self.unlinked.id}/create-and-link/',
            {
                'email': 'api.create@test.local',
                'phone': '9876543212',
                'gender': 'male',
                'department': self.department.name,
                'designation': str(self.designation.id),
                'joining_date': today,
            },
            format='json',
        )
        self.assertEqual(res.status_code, 200, res.data)
        self.assertTrue(res.data['success'])
        self.assertEqual(res.data['biometric_pin'], '77')
        employee = Employee.objects.get(pk=res.data['employee_id'])
        self.assertEqual(employee.gender, 'male')

    def test_create_and_link_api_accepts_department_id_and_compensation_level(self):
        from decimal import Decimal

        from apps.hr.payroll_api.compensation_level_service import save_compensation_level
        from apps.hr.payroll_models import EmployeeCompensationAssignment

        level = save_compensation_level(
            hospital=self.hospital,
            designation=self.designation,
            code='STAFF_L1',
            name='Staff Level 1',
            rank=1,
            basic=Decimal('25000.00'),
            hra=Decimal('5000.00'),
            medical=Decimal('1000.00'),
            special_allowance=Decimal('1000.00'),
            allowances={},
            deductions={},
            overtime_rate=Decimal('100.00'),
            effective_from=timezone.localdate().replace(day=1),
            is_default_for_designation=False,
        )
        unlinked = BiometricUnlinkedUser.objects.create(
            hospital=self.hospital,
            device=self.device,
            pin='79',
            name='Comp Level User',
            status=BiometricUnlinkedUser.STATUS_PENDING,
        )
        today = timezone.localdate().isoformat()
        client = APIClient()
        client.force_authenticate(user=self.hr_user)
        res = client.post(
            f'/api/v1/hr/biometric-unlinked-users/{unlinked.id}/create-and-link/',
            {
                'email': 'comp.level@test.local',
                'phone': '9876543213',
                'gender': 'female',
                'department_id': str(self.department.id),
                'department': self.department.name,
                'designation': str(self.designation.id),
                'compensation_level': str(level.id),
                'joining_date': today,
            },
            format='json',
        )
        self.assertEqual(res.status_code, 200, res.data)
        employee = Employee.objects.get(pk=res.data['employee_id'])
        assignment = EmployeeCompensationAssignment.objects.filter(
            employee=employee,
            compensation_level_id=level.id,
            is_active=True,
        ).first()
        self.assertIsNotNone(assignment)

    def test_create_and_link_api_returns_validation_error_for_missing_gender(self):
        today = timezone.localdate().isoformat()
        client = APIClient()
        client.force_authenticate(user=self.hr_user)
        res = client.post(
            f'/api/v1/hr/biometric-unlinked-users/{self.unlinked.id}/create-and-link/',
            {
                'email': 'no.gender@test.local',
                'phone': '9876543214',
                'department': self.department.name,
                'designation': str(self.designation.id),
                'joining_date': today,
            },
            format='json',
        )
        self.assertEqual(res.status_code, 400, res.data)
        self.assertFalse(res.data.get('success', True))
        self.assertIn('gender', res.data.get('errors', {}))


class PunchPairingTests(TestCase):
    def test_suggest_next_punch_type(self):
        from apps.hr.models import AttendancePunch

        class P:
            def __init__(self, ptype, suspicious=False):
                self.punch_type = ptype
                self.is_suspicious = suspicious

        self.assertEqual(suggest_next_punch_type([]), 'IN')
        self.assertEqual(suggest_next_punch_type([P('IN')]), 'OUT')
        self.assertEqual(suggest_next_punch_type([P('IN'), P('OUT')]), 'IN')


class TimeSyncTests(TestCase):
    def test_timezone_offset_is_numeric_minutes(self):
        offset = get_adms_timezone_offset()
        self.assertTrue(offset.lstrip('-').isdigit())


class BiometricStatusApiTests(TestCase):
    def setUp(self):
        User = get_user_model()
        self.hospital = Hospital.objects.create(name='Status H', slug='status-h')
        self.device = BiometricDevice.objects.create(
            hospital=self.hospital,
            serial_number='SN-STATUS-001',
            name='Front Gate',
        )
        self.shift = Shift.objects.create(
            hospital=self.hospital,
            name='Day',
            code='DAY2',
            start_time=time(9, 0),
            end_time=time(18, 0),
            grace_minutes=10,
            half_day_hours=4,
            full_day_hours=8,
        )
        self.employee = Employee.objects.create(
            hospital=self.hospital,
            name='Status User',
            email='status@test.local',
            status='active',
            onboarding_completed=True,
            biometric_attendance_enabled=True,
            biometric_pin='202',
            shift=self.shift,
        )
        self.hr_user = User.objects.create_user(
            email='hr-status@test.local',
            password='test-pass',
            hospital=self.hospital,
            is_staff=True,
        )
        self.client = APIClient()
        self.client.force_authenticate(user=self.hr_user)

    def test_connection_status_surfaces_device_time_and_rejected_backlog(self):
        future_ts = timezone.now() + timedelta(minutes=20)
        self.assertFalse(ingest_attlog_line(self.device, '202', future_ts, 0, 1, 'future-status'))

        res = self.client.get('/api/v1/hr/biometric-devices/connection-status/')
        self.assertEqual(res.status_code, 200, res.data)
        self.assertEqual(res.data['recent_rejected_punches'], 1)
        self.assertEqual(res.data['devices_with_time_issues'], 1)
        self.assertTrue(any(issue['code'] == 'device_time_issue' for issue in res.data['devices'][0]['health_issues']))

    def test_dismiss_rejected_punch_hides_from_list_and_health(self):
        future_ts = timezone.now() + timedelta(minutes=20)
        self.assertFalse(ingest_attlog_line(self.device, '202', future_ts, 0, 1, 'future-dismiss'))
        rejected = BiometricRejectedPunch.objects.get(pin='202', reason='future_device_time')

        list_res = self.client.get('/api/v1/hr/biometric-rejected-punches/')
        self.assertEqual(list_res.status_code, 200, list_res.data)
        self.assertEqual(len(list_res.data), 1)

        dismiss_res = self.client.post(f'/api/v1/hr/biometric-rejected-punches/{rejected.id}/dismiss/')
        self.assertEqual(dismiss_res.status_code, 200, dismiss_res.data)
        self.assertTrue(dismiss_res.data['success'])

        rejected.refresh_from_db()
        self.assertIsNotNone(rejected.dismissed_at)
        self.assertEqual(rejected.dismissed_by_id, self.hr_user.id)

        list_after = self.client.get('/api/v1/hr/biometric-rejected-punches/')
        self.assertEqual(list_after.status_code, 200, list_after.data)
        self.assertEqual(len(list_after.data), 0)

        status_res = self.client.get('/api/v1/hr/biometric-devices/connection-status/')
        self.assertEqual(status_res.status_code, 200, status_res.data)
        self.assertEqual(status_res.data['recent_rejected_punches'], 0)

    def test_dismiss_all_rejected_punches_hospital_scoped(self):
        other_hospital = Hospital.objects.create(name='Other Status H', slug='other-status-h')
        other_device = BiometricDevice.objects.create(
            hospital=other_hospital,
            serial_number='SN-STATUS-OTHER',
            name='Other Gate',
        )
        now = timezone.now()
        mine_a = BiometricRejectedPunch.objects.create(
            hospital=self.hospital,
            device=self.device,
            employee=self.employee,
            pin='202',
            punch_time=now - timedelta(minutes=5),
            reason='biometric_disabled',
        )
        mine_b = BiometricRejectedPunch.objects.create(
            hospital=self.hospital,
            device=self.device,
            employee=self.employee,
            pin='202',
            punch_time=now - timedelta(minutes=3),
            reason='inactive_employee',
        )
        other = BiometricRejectedPunch.objects.create(
            hospital=other_hospital,
            device=other_device,
            pin='999',
            punch_time=now - timedelta(minutes=1),
            reason='no_hospital',
        )

        res = self.client.post('/api/v1/hr/biometric-rejected-punches/dismiss-all/')
        self.assertEqual(res.status_code, 200, res.data)
        self.assertEqual(res.data['dismissed_count'], 2)

        mine_a.refresh_from_db()
        mine_b.refresh_from_db()
        other.refresh_from_db()
        self.assertIsNotNone(mine_a.dismissed_at)
        self.assertIsNotNone(mine_b.dismissed_at)
        self.assertIsNone(other.dismissed_at)

        list_res = self.client.get('/api/v1/hr/biometric-rejected-punches/')
        self.assertEqual(list_res.status_code, 200, list_res.data)
        self.assertEqual(len(list_res.data), 0)
