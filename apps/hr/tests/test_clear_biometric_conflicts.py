from io import StringIO

from django.contrib.auth import get_user_model
from django.core.management import call_command
from django.test import TestCase
from django.utils import timezone

from apps.hr.biometric_models import BiometricDevice, BiometricUnlinkedUser
from apps.hr.models import Department, Designation, Employee
from apps.shared.models import Hospital

User = get_user_model()


class ClearBiometricDeviceConflictsTests(TestCase):
    def setUp(self):
        self.hospital = Hospital.objects.create(name='Clear H', slug='clear-h')
        self.other_hospital = Hospital.objects.create(name='Other H', slug='other-h')
        self.department = Department.objects.create(hospital=self.hospital, name='Ops')
        self.designation = Designation.objects.create(
            hospital=self.hospital,
            department=self.department,
            name='Staff',
            code='STAFF',
            is_active=True,
        )
        self.device = BiometricDevice.objects.create(
            hospital=self.hospital,
            serial_number='SN-CLEAR',
        )
        self.linked_employee = Employee.objects.create(
            hospital=self.hospital,
            name='Linked Worker',
            email='linked-worker@test.local',
            status='active',
            onboarding_completed=True,
            designation=self.designation,
            department_ref=self.department,
            department=self.department.name,
            biometric_pin='42',
            biometric_card_number='CARD42',
            biometric_attendance_enabled=True,
        )
        self.linked_conflict = BiometricUnlinkedUser.objects.create(
            hospital=self.hospital,
            device=self.device,
            pin='42',
            name='Device 42',
            status=BiometricUnlinkedUser.STATUS_LINKED,
            linked_employee=self.linked_employee,
            resolved_at=timezone.now(),
        )
        self.pending_conflict = BiometricUnlinkedUser.objects.create(
            hospital=self.hospital,
            device=self.device,
            pin='43',
            name='Device 43',
            status=BiometricUnlinkedUser.STATUS_PENDING,
        )
        self.rejected_conflict = BiometricUnlinkedUser.objects.create(
            hospital=self.hospital,
            device=self.device,
            pin='44',
            name='Device 44',
            status=BiometricUnlinkedUser.STATUS_REJECTED,
            resolved_at=timezone.now(),
        )
        self.other_conflict = BiometricUnlinkedUser.objects.create(
            hospital=self.other_hospital,
            pin='99',
            name='Other Hospital',
            status=BiometricUnlinkedUser.STATUS_PENDING,
        )

    def test_clear_all_conflicts_and_reset_matching_pin(self):
        out = StringIO()
        call_command('clear_biometric_device_conflicts', '--no-input', stdout=out)

        self.assertEqual(BiometricUnlinkedUser.objects.count(), 0)
        self.linked_employee.refresh_from_db()
        self.assertEqual(self.linked_employee.biometric_pin, '')
        self.assertEqual(self.linked_employee.biometric_card_number, '')
        self.assertFalse(self.linked_employee.biometric_attendance_enabled)
        self.assertIn('Cleared 4 conflict record(s)', out.getvalue())

    def test_clear_scoped_to_hospital(self):
        out = StringIO()
        call_command(
            'clear_biometric_device_conflicts',
            '--hospital=clear-h',
            '--no-input',
            stdout=out,
        )

        self.assertEqual(BiometricUnlinkedUser.objects.count(), 1)
        self.assertTrue(
            BiometricUnlinkedUser.objects.filter(hospital=self.other_hospital, pin='99').exists(),
        )
        self.linked_employee.refresh_from_db()
        self.assertEqual(self.linked_employee.biometric_pin, '')

    def test_dry_run_does_not_delete(self):
        out = StringIO()
        call_command('clear_biometric_device_conflicts', '--dry-run', stdout=out)

        self.assertEqual(BiometricUnlinkedUser.objects.count(), 4)
        self.linked_employee.refresh_from_db()
        self.assertEqual(self.linked_employee.biometric_pin, '42')
        self.assertIn('Dry run', out.getvalue())
