"""Tests for leave balance provisioning vs policy apply."""

from decimal import Decimal

from django.test import TestCase

from apps.hr.leave_services import (
    apply_policy_balances,
    ensure_employee_leave_balances,
    provision_missing_balances,
    resolve_policy_for_employee,
)
from apps.hr.models import (
    Department,
    Designation,
    Employee,
    LeaveBalance,
    LeavePolicy,
    LeavePolicyLine,
    LeaveType,
)
from apps.hr.serializers import EmployeeSerializer, LeavePolicySerializer
from apps.shared.models import Hospital


class LeaveBalanceProvisioningTests(TestCase):
    def setUp(self):
        self.hospital = Hospital.objects.create(name='Leave Hospital', slug='leave-hospital')
        self.department = Department.objects.create(hospital=self.hospital, name='HR')
        self.other_department = Department.objects.create(hospital=self.hospital, name='Nursing')
        self.designation = Designation.objects.create(
            hospital=self.hospital,
            name='Executive',
            is_active=True,
        )
        self.employee = Employee.objects.create(
            hospital=self.hospital,
            name='Portal Employee',
            email='portal.leave@example.com',
            phone='9876543210',
            department='HR',
            department_ref=self.department,
            designation=self.designation,
            job_title='Executive',
            status='active',
        )
        self.leave_type = LeaveType.objects.create(
            hospital=self.hospital,
            name='Casual Leave',
            code='CL',
            is_paid=True,
            annual_limit=Decimal('12.00'),
            is_active=True,
        )
        self.policy = LeavePolicy.objects.create(
            hospital=self.hospital,
            name='Test Policy',
            assignment_type=LeavePolicy.ASSIGNMENT_DEPARTMENT,
            is_active=True,
            is_default=True,
        )
        self.policy.departments.set([self.department])
        LeavePolicyLine.objects.create(
            policy=self.policy,
            leave_type=self.leave_type,
            allocated_days=Decimal('12.00'),
            is_unlimited=False,
        )
        self.balance = LeaveBalance.objects.create(
            employee=self.employee,
            leave_type=self.leave_type,
            policy=self.policy,
            total_days=Decimal('12.00'),
            used_days=Decimal('2.00'),
            remaining_days=Decimal('10.00'),
            is_unlimited=False,
        )

    def test_ensure_employee_leave_balances_preserves_hr_manual_edit(self):
        self.balance.total_days = Decimal('20.00')
        self.balance.remaining_days = Decimal('18.00')
        self.balance.save(update_fields=['total_days', 'remaining_days', 'updated_at'])

        ensure_employee_leave_balances(self.employee)

        self.balance.refresh_from_db()
        self.assertEqual(self.balance.total_days, Decimal('20.00'))
        self.assertEqual(self.balance.remaining_days, Decimal('18.00'))
        self.assertEqual(self.balance.used_days, Decimal('2.00'))

    def test_provision_missing_balances_creates_only_new_rows(self):
        created = provision_missing_balances(self.policy, employees=[self.employee])
        self.assertEqual(created, 0)
        self.assertEqual(LeaveBalance.objects.filter(employee=self.employee).count(), 1)

    def test_apply_policy_balances_overwrites_totals_from_policy(self):
        self.balance.total_days = Decimal('20.00')
        self.balance.remaining_days = Decimal('18.00')
        self.balance.save(update_fields=['total_days', 'remaining_days', 'updated_at'])

        apply_policy_balances(self.policy, employees=[self.employee])

        self.balance.refresh_from_db()
        self.assertEqual(self.balance.total_days, Decimal('12.00'))
        self.assertEqual(self.balance.remaining_days, Decimal('10.00'))
        self.assertEqual(self.balance.used_days, Decimal('2.00'))

    def test_ensure_skips_when_no_matching_policy(self):
        self.policy.departments.clear()
        result = ensure_employee_leave_balances(self.employee)
        self.assertTrue(result['skipped'])
        self.assertEqual(result['reason'], 'no_matching_policy')

    def test_leave_policy_serializer_update_auto_applies_balances(self):
        self.balance.total_days = Decimal('20.00')
        self.balance.remaining_days = Decimal('18.00')
        self.balance.save(update_fields=['total_days', 'remaining_days', 'updated_at'])
        policy_line = self.policy.lines.get()
        policy_line.allocated_days = Decimal('15.00')
        policy_line.save(update_fields=['allocated_days', 'updated_at'])

        serializer = LeavePolicySerializer(
            instance=self.policy,
            data={
                'name': 'Updated Policy Name',
                'assignment_type': LeavePolicy.ASSIGNMENT_DEPARTMENT,
                'departments': [self.department.id],
            },
            partial=True,
        )
        serializer.is_valid(raise_exception=True)
        serializer.save()

        self.balance.refresh_from_db()
        self.assertEqual(self.balance.total_days, Decimal('15.00'))
        self.assertEqual(self.balance.remaining_days, Decimal('13.00'))
        self.assertEqual(self.balance.used_days, Decimal('2.00'))

    def test_leave_policy_serializer_create_auto_applies_balances(self):
        LeaveBalance.objects.filter(employee=self.employee).delete()
        self.policy.is_active = False
        self.policy.save(update_fields=['is_active', 'updated_at'])

        serializer = LeavePolicySerializer(data={
            'name': 'Department Policy',
            'assignment_type': LeavePolicy.ASSIGNMENT_DEPARTMENT,
            'departments': [self.department.id],
            'is_active': True,
            'is_default': False,
            'lines': [{
                'leave_type': self.leave_type.id,
                'allocated_days': '12.00',
                'is_unlimited': False,
            }],
        })
        serializer.is_valid(raise_exception=True)
        serializer.save(hospital=self.hospital)

        balance = LeaveBalance.objects.get(employee=self.employee, leave_type=self.leave_type)
        self.assertEqual(balance.total_days, Decimal('12.00'))
        self.assertEqual(balance.remaining_days, Decimal('12.00'))

    def test_leave_policy_serializer_patch_with_line_ids_updates_in_place(self):
        """PATCH payloads include line ids; must update rows, not duplicate them."""
        line = self.policy.lines.get()
        serializer = LeavePolicySerializer(
            instance=self.policy,
            data={
                'name': self.policy.name,
                'assignment_type': self.policy.assignment_type,
                'departments': [self.department.id],
                'is_active': True,
                'lines': [{
                    'id': str(line.id),
                    'leave_type': str(line.leave_type_id),
                    'allocated_days': '14.00',
                    'is_unlimited': False,
                }],
            },
            partial=True,
        )
        serializer.is_valid(raise_exception=True)
        serializer.save()

        self.assertEqual(self.policy.lines.count(), 1)
        line.refresh_from_db()
        self.assertEqual(line.allocated_days, Decimal('14.00'))

    def test_designation_policy_overrides_department_policy(self):
        desig_type = LeaveType.objects.create(
            hospital=self.hospital,
            name='Special Leave',
            code='SPL',
            is_paid=True,
            annual_limit=Decimal('5.00'),
            is_active=True,
        )
        desig_policy = LeavePolicy.objects.create(
            hospital=self.hospital,
            name='Executive Package',
            assignment_type=LeavePolicy.ASSIGNMENT_DESIGNATION,
            is_active=True,
        )
        desig_policy.designations.set([self.designation])
        LeavePolicyLine.objects.create(
            policy=desig_policy,
            leave_type=desig_type,
            allocated_days=Decimal('5.00'),
            is_unlimited=False,
        )

        resolved = resolve_policy_for_employee(self.employee)
        self.assertEqual(resolved.pk, desig_policy.pk)

        apply_policy_balances(self.policy)
        self.balance.refresh_from_db()
        # Department apply must not overwrite when designation wins
        self.assertEqual(self.balance.total_days, Decimal('12.00'))
        self.assertEqual(self.balance.policy_id, self.policy.id)

        apply_policy_balances(desig_policy)
        balance = LeaveBalance.objects.get(employee=self.employee, leave_type=desig_type)
        self.assertEqual(balance.total_days, Decimal('5.00'))
        self.assertEqual(balance.policy_id, desig_policy.id)

    def test_multi_department_policy_covers_selected_departments_only(self):
        other_employee = Employee.objects.create(
            hospital=self.hospital,
            name='Nurse',
            email='nurse.leave@example.com',
            phone='9876543211',
            department='Nursing',
            department_ref=self.other_department,
            job_title='Nurse',
            status='active',
        )
        self.policy.departments.set([self.department, self.other_department])
        apply_policy_balances(self.policy)

        self.assertTrue(
            LeaveBalance.objects.filter(employee=other_employee, leave_type=self.leave_type).exists()
        )

    def test_employee_serializer_provisions_leave_when_department_set_while_active(self):
        """Active employees get leave balances when department is assigned later."""
        late_hire = Employee.objects.create(
            hospital=self.hospital,
            name='Late Dept Hire',
            email='late.dept.hire@example.com',
            phone='9876543212',
            department='',
            department_ref=None,
            designation=None,
            job_title='',
            status='active',
        )
        self.assertFalse(LeaveBalance.objects.filter(employee=late_hire).exists())

        serializer = EmployeeSerializer(
            instance=late_hire,
            data={'department_ref': str(self.department.id)},
            partial=True,
        )
        self.assertTrue(serializer.is_valid(), serializer.errors)
        serializer.save()

        balance = LeaveBalance.objects.get(employee=late_hire, leave_type=self.leave_type)
        self.assertEqual(balance.total_days, Decimal('12.00'))
        self.assertEqual(balance.policy_id, self.policy.id)

    def test_employee_serializer_provisions_leave_when_designation_set_while_active(self):
        """Active employees get leave balances when a designation policy starts matching."""
        desig_type = LeaveType.objects.create(
            hospital=self.hospital,
            name='Special Leave',
            code='SPL2',
            is_paid=True,
            annual_limit=Decimal('5.00'),
            is_active=True,
        )
        desig_policy = LeavePolicy.objects.create(
            hospital=self.hospital,
            name='Executive Package Late',
            assignment_type=LeavePolicy.ASSIGNMENT_DESIGNATION,
            is_active=True,
        )
        desig_policy.designations.set([self.designation])
        LeavePolicyLine.objects.create(
            policy=desig_policy,
            leave_type=desig_type,
            allocated_days=Decimal('5.00'),
            is_unlimited=False,
        )

        late_hire = Employee.objects.create(
            hospital=self.hospital,
            name='Late Designation Hire',
            email='late.desig.hire@example.com',
            phone='9876543213',
            department='',
            department_ref=None,
            designation=None,
            job_title='',
            status='active',
        )
        self.assertFalse(LeaveBalance.objects.filter(employee=late_hire).exists())

        serializer = EmployeeSerializer(
            instance=late_hire,
            data={
                'designation': str(self.designation.id),
                'job_title': self.designation.name,
            },
            partial=True,
        )
        self.assertTrue(serializer.is_valid(), serializer.errors)
        serializer.save()

        balance = LeaveBalance.objects.get(employee=late_hire, leave_type=desig_type)
        self.assertEqual(balance.total_days, Decimal('5.00'))
        self.assertEqual(balance.policy_id, desig_policy.id)
