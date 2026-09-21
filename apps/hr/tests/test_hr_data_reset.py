"""Tests for full HR data reset with biometric device preservation."""

from __future__ import annotations

from datetime import time

from django.contrib.auth import get_user_model
from django.test import TestCase
from django.utils import timezone

from apps.hr.biometric_models import BiometricDevice
from apps.hr.demo_reset import run_hr_full_reset
from apps.hr.models import AttendancePunch, Department, Employee, Shift
from apps.shared.models import Hospital

User = get_user_model()


class HRDataResetTests(TestCase):
    def setUp(self):
        User.objects.create_superuser('admin@test.local', 'pass')
        self.hospital = Hospital.objects.create(name='Reset H', slug='reset-h')
        self.device = BiometricDevice.objects.create(
            hospital=self.hospital,
            serial_number='SN-RESET-001',
            name='Main Gate',
            is_active=True,
        )
        self.department = Department.objects.create(
            hospital=self.hospital,
            name='Engineering',
        )
        self.shift = Shift.objects.create(
            hospital=self.hospital,
            name='Day',
            code='DAY',
            start_time=time(9, 0),
            end_time=time(18, 0),
        )
        self.employee = Employee.objects.create(
            hospital=self.hospital,
            name='Reset User',
            email='reset@test.local',
            status='active',
            department_ref=self.department,
            shift=self.shift,
            biometric_pin='42',
            biometric_attendance_enabled=True,
        )
        AttendancePunch.objects.create(
            employee=self.employee,
            punch_type='IN',
            source='biometric',
            device_id=self.device.serial_number,
            timestamp=timezone.now(),
        )

    def _run_reset(self, **kwargs):
        lines: list[str] = []

        def capture(msg, ending=None):
            lines.append(str(msg))

        run_hr_full_reset(
            stdout_write=capture,
            style=type('Style', (), {
                'WARNING': lambda s, m: m,
                'SUCCESS': lambda s, m: m,
                'ERROR': lambda s, m: m,
                'NOTICE': lambda s, m: m,
            })(),
            no_input=True,
            run_check=False,
            **kwargs,
        )
        return lines

    def test_dry_run_does_not_mutate_database(self):
        self._run_reset(dry_run=True)

        self.assertEqual(BiometricDevice.objects.count(), 1)
        self.assertEqual(Employee.objects.count(), 1)
        self.assertEqual(Department.objects.count(), 1)
        self.assertEqual(AttendancePunch.objects.count(), 1)
        self.device.refresh_from_db()
        self.assertEqual(self.device.serial_number, 'SN-RESET-001')

    def test_full_reset_preserves_biometric_devices(self):
        self._run_reset(keep_biometric_devices=True)

        self.assertFalse(Employee.objects.exists())
        self.assertFalse(Department.objects.exists())
        self.assertFalse(Shift.objects.exists())
        self.assertFalse(AttendancePunch.objects.exists())

        self.assertEqual(BiometricDevice.objects.count(), 1)
        device = BiometricDevice.objects.get(serial_number='SN-RESET-001')
        self.assertEqual(device.hospital_id, self.hospital.id)
        self.assertEqual(device.name, 'Main Gate')
        self.assertTrue(device.is_active)

    def test_full_reset_purges_biometric_devices_when_requested(self):
        self._run_reset(keep_biometric_devices=False)

        self.assertFalse(BiometricDevice.objects.exists())
        self.assertFalse(Employee.objects.exists())
