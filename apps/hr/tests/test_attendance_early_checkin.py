"""Tests for early check-in before shift start."""

from datetime import time, timedelta
from decimal import Decimal
from unittest.mock import patch

from django.test import TestCase
from django.utils import timezone

from apps.hr.attendance_engine import calculate_daily_attendance, compute_metrics_from_check_times
from apps.hr.attendance_policy import (
    combine_attendance_day_time,
    is_early_arrival,
    is_punch_before_earliest_window,
)
from apps.hr.biometric.ingestion import ingest_attlog_line
from apps.hr.biometric_models import BiometricDevice, BiometricRejectedPunch
from apps.hr.models import AttendancePunch, Employee, Shift
from apps.shared.models import Hospital


@patch('apps.hr.biometric.ingestion.recalculate_for_punch', return_value=None)
@patch('apps.hr.biometric.ingestion.recalculate_daily_attendance', return_value=None)
class EarlyCheckInTests(TestCase):
    def setUp(self):
        self.hospital = Hospital.objects.create(name='Early Hosp', slug='early-hosp')
        self.shift = Shift.objects.create(
            hospital=self.hospital,
            name='Afternoon',
            code='AFT',
            start_time=time(12, 25),
            end_time=time(21, 0),
            grace_minutes=10,
            early_punch_minutes=120,
            half_day_hours=4,
            full_day_hours=8,
        )
        self.employee = Employee.objects.create(
            hospital=self.hospital,
            name='Early Bird',
            email='early.bird@test.local',
            status='active',
            shift=self.shift,
            biometric_pin='501',
            biometric_attendance_enabled=True,
            onboarding_completed=True,
        )
        self.device = BiometricDevice.objects.create(
            hospital=self.hospital,
            name='Front Gate',
            serial_number='EARLY-001',
            is_active=True,
        )
        self.day = timezone.localdate()

    def test_early_check_in_not_late_and_in_progress(self, *_mocks):
        check_in = combine_attendance_day_time(self.day, time(12, 15))
        AttendancePunch.objects.create(
            employee=self.employee,
            shift=self.shift,
            attendance_date=self.day,
            timestamp=check_in,
            punch_type='IN',
            source='BIOMETRIC',
        )
        with patch('apps.hr.attendance_policy.timezone.now', return_value=check_in + timedelta(minutes=1)):
            calculated = calculate_daily_attendance(self.employee, self.day)

        self.assertEqual(calculated['attendance_status'], 'in_progress')
        self.assertEqual(calculated['late_minutes'], 0)
        self.assertTrue(is_early_arrival(check_in, self.day, self.shift))

    def test_credited_hours_exclude_pre_shift_minutes(self, *_mocks):
        check_in = combine_attendance_day_time(self.day, time(12, 15))
        check_out = combine_attendance_day_time(self.day, time(21, 0))
        metrics = compute_metrics_from_check_times(
            self.employee,
            self.day,
            check_in,
            check_out,
            self.shift,
        )
        self.assertEqual(metrics['attendance_status'], 'present')
        self.assertEqual(metrics['late_minutes'], 0)
        self.assertEqual(metrics['total_work_hours'], Decimal('8.58'))

    def test_punch_before_configured_early_window_rejected(self, *_mocks):
        too_early = combine_attendance_day_time(self.day, time(9, 0))
        self.assertTrue(is_punch_before_earliest_window(too_early, self.day, self.shift))
        accepted = ingest_attlog_line(self.device, '501', too_early, 0, 1, 'too-early')
        self.assertFalse(accepted)
        self.assertTrue(
            BiometricRejectedPunch.objects.filter(
                employee=self.employee,
                reason='too_early_before_shift',
            ).exists(),
        )

    def test_punch_within_early_window_accepted(self, *_mocks):
        check_in = combine_attendance_day_time(self.day, time(12, 15))
        self.assertFalse(is_punch_before_earliest_window(check_in, self.day, self.shift))
        accepted = ingest_attlog_line(self.device, '501', check_in, 0, 1, 'early-ok')
        self.assertTrue(accepted)
