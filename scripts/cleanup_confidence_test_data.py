"""
Delete confidence / validation test data from the live database.

Removes employees created by attendance_payroll_confidence.py and related records.
Does NOT touch real hospital staff (e.g. Naveen, Keshav, Ravi).

Run: python scripts/cleanup_confidence_test_data.py
      python scripts/cleanup_confidence_test_data.py --dry-run
"""
from __future__ import annotations

import argparse
import os
import sys

import django

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')
django.setup()

from django.db import transaction
from django.db.models import Q

from apps.hr.attendance_finalization_service import unfinalize_attendance_month
from apps.hr.biometric_models import BiometricDevice, BiometricRejectedPunch, BiometricUnlinkedUser
from apps.hr.models import (
    AttendanceControlAuditLog,
    AttendanceMonthFinalization,
    AttendancePunch,
    AttendanceRegularization,
    DailyAttendance,
    Department,
    Designation,
    Employee,
    LeaveBalance,
    LeaveRequest,
    LeaveType,
    Shift,
)
from apps.hr.payroll_models import (
    CompensationLevel,
    EmployeeCompensationAssignment,
    PayrollRun,
    Payslip,
    SalaryStructure,
)
from apps.shared.models import Hospital

TEST_EMPLOYEE_FILTER = (
    Q(email__startswith='confidence-test-')
    | Q(email__endswith='@test.local')
    | Q(name__startswith='Confidence ')
)

INFRA_MARKERS = {
    'department_name': 'Confidence Test Dept',
    'designation_code': 'CONF_STAFF',
    'shift_code': 'CONF_DAY',
    'comp_level_code': 'CONF_L0',
    'leave_paid': 'Confidence Paid Leave',
    'leave_unpaid': 'Confidence LWP',
    'device_serial': 'CONF-PILOT-DEVICE',
    'unlinked_pin': '99999',
}


def _count(qs) -> int:
    return qs.count()


@transaction.atomic
def cleanup(*, dry_run: bool = False) -> dict:
    hospital = Hospital.objects.order_by('id').first()
    employees = Employee.objects.filter(TEST_EMPLOYEE_FILTER)
    employee_ids = list(employees.values_list('pk', flat=True))

    stats = {
        'employees': _count(employees),
        'payslips': 0,
        'payroll_runs': 0,
        'comp_assignments': 0,
        'daily_attendance': 0,
        'punches': 0,
        'leave_requests': 0,
        'regularizations': 0,
        'unlinked_users': 0,
        'rejected_punches': 0,
        'devices': 0,
        'infra_deleted': [],
        'finalizations_removed': [],
    }

    if not employee_ids:
        print('No confidence test employees found.')
    else:
        print('Test employees to remove:')
        for emp in employees:
            print(f'  - {emp.employee_id} {emp.name} <{emp.email}>')

    runs = PayrollRun.objects.filter(employee_id__in=employee_ids)
    stats['payroll_runs'] = _count(runs)
    payslips = Payslip.objects.filter(payroll_run__in=runs)
    stats['payslips'] = _count(payslips)
    stats['comp_assignments'] = _count(
        EmployeeCompensationAssignment.objects.filter(employee_id__in=employee_ids)
    )
    stats['daily_attendance'] = _count(DailyAttendance.objects.filter(employee_id__in=employee_ids))
    stats['punches'] = _count(AttendancePunch.objects.filter(employee_id__in=employee_ids))
    stats['leave_requests'] = _count(LeaveRequest.objects.filter(employee_id__in=employee_ids))
    stats['regularizations'] = _count(AttendanceRegularization.objects.filter(employee_id__in=employee_ids))

    unlinked = BiometricUnlinkedUser.objects.filter(pin=INFRA_MARKERS['unlinked_pin'])
    stats['unlinked_users'] = _count(unlinked)
    rejected = BiometricRejectedPunch.objects.filter(pin__in=['900', '901', '902', '903', '904', '950', '99999'])
    stats['rejected_punches'] = _count(rejected)
    devices = BiometricDevice.objects.filter(serial_number=INFRA_MARKERS['device_serial'])
    stats['devices'] = _count(devices)

    if dry_run:
        print('\nDRY RUN — nothing deleted.')
        return stats

    payslips.delete()
    runs.delete()
    LeaveBalance.objects.filter(employee_id__in=employee_ids).delete()
    LeaveRequest.objects.filter(employee_id__in=employee_ids).delete()
    AttendanceRegularization.objects.filter(employee_id__in=employee_ids).delete()
    AttendanceControlAuditLog.objects.filter(employee_id__in=employee_ids).delete()
    AttendancePunch.objects.filter(employee_id__in=employee_ids).delete()
    DailyAttendance.objects.filter(employee_id__in=employee_ids).delete()
    EmployeeCompensationAssignment.objects.filter(employee_id__in=employee_ids).delete()
    SalaryStructure.objects.filter(employee_id__in=employee_ids).delete()
    employees.delete()

    rejected.delete()
    unlinked.delete()
    devices.delete()

    # Remove June finalization if it only existed for test seeding
    if hospital and AttendanceMonthFinalization.objects.filter(hospital=hospital, month='2026-06').exists():
        remaining_june = DailyAttendance.objects.filter(
            employee__hospital=hospital,
            date__year=2026,
            date__month=6,
        ).count()
        if remaining_june == 0:
            unfinalize_attendance_month(hospital=hospital, month='2026-06')
            stats['finalizations_removed'].append('2026-06')

    # Infrastructure only used by confidence tests
    if hospital:
        LeaveType.objects.filter(
            hospital=hospital,
            name__in=[INFRA_MARKERS['leave_paid'], INFRA_MARKERS['leave_unpaid']],
        ).delete()

        level = CompensationLevel.objects.filter(hospital=hospital, code=INFRA_MARKERS['comp_level_code']).first()
        if level and not EmployeeCompensationAssignment.objects.filter(compensation_level=level).exists():
            level.delete()
            stats['infra_deleted'].append('compensation_level')

        if not Employee.objects.filter(shift__code=INFRA_MARKERS['shift_code']).exists():
            deleted, _ = Shift.objects.filter(hospital=hospital, code=INFRA_MARKERS['shift_code']).delete()
            if deleted:
                stats['infra_deleted'].append('shift')

        if not Employee.objects.filter(designation__code=INFRA_MARKERS['designation_code']).exists():
            deleted, _ = Designation.objects.filter(
                hospital=hospital, code=INFRA_MARKERS['designation_code'],
            ).delete()
            if deleted:
                stats['infra_deleted'].append('designation')

        if not Employee.objects.filter(department_ref__name=INFRA_MARKERS['department_name']).exists():
            deleted, _ = Department.objects.filter(
                hospital=hospital, name=INFRA_MARKERS['department_name'],
            ).delete()
            if deleted:
                stats['infra_deleted'].append('department')

    print('\nDeleted:')
    for key, val in stats.items():
        if key in ('infra_deleted', 'finalizations_removed'):
            continue
        if val:
            print(f'  {key}: {val}')
    if stats['infra_deleted']:
        print('  infra:', ', '.join(stats['infra_deleted']))
    if stats['finalizations_removed']:
        print('  unfinalized months:', ', '.join(stats['finalizations_removed']))

    return stats


def main() -> int:
    parser = argparse.ArgumentParser(description='Remove confidence validation test data')
    parser.add_argument('--dry-run', action='store_true', help='Show what would be deleted')
    args = parser.parse_args()
    cleanup(dry_run=args.dry_run)
    print('\nDone. Real employees (Naveen, Keshav, Ravi, etc.) were not touched.')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
