"""Spot-check 2-3 real employees: attendance vs payroll."""
from __future__ import annotations

import json
import os
import sys

import django

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')
django.setup()

from decimal import Decimal

from django.utils import timezone

from apps.hr.attendance_finalization_service import is_attendance_month_finalized
from apps.hr.attendance_service import get_attendance_summary
from apps.hr.models import DailyAttendance, Employee
from apps.hr.payroll_calculator import PayrollCalculator, parse_payroll_month
from apps.hr.payroll_models import PayrollRun
from apps.hr.payroll_structure_resolver import resolve_compensation
from apps.shared.models import Hospital

TEST_EMAIL_MARKERS = ('confidence-test-', '@test.local', 'full-e2e-', 'recon-doctor@')


def is_real_employee(emp: Employee) -> bool:
    email = (emp.email or '').lower()
    return not any(m in email for m in TEST_EMAIL_MARKERS)


def pick_employees(hospital, month: str, limit: int = 3) -> list[Employee]:
    month_start, month_end = parse_payroll_month(month)
    scored: list[tuple[int, Employee]] = []
    qs = Employee.objects.filter(hospital=hospital, status='active').select_related('shift', 'designation')
    for emp in qs:
        if not is_real_employee(emp):
            continue
        if resolve_compensation(emp, month) is None:
            continue
        bio = 10 if emp.biometric_pin else 0
        rows = DailyAttendance.objects.filter(employee=emp, date__gte=month_start, date__lte=month_end).count()
        if rows == 0 and not emp.biometric_pin:
            continue
        scored.append((bio + rows, emp))
    scored.sort(key=lambda x: -x[0])
    return [emp for _, emp in scored[:limit]]


def status_breakdown(employee, month_start, month_end) -> dict[str, int]:
    rows = DailyAttendance.objects.filter(
        employee=employee,
        date__gte=month_start,
        date__lte=month_end,
    )
    breakdown: dict[str, int] = {}
    for row in rows:
        status = row.attendance_status or 'unknown'
        breakdown[status] = breakdown.get(status, 0) + 1
    return breakdown


def spot_check_employee(employee: Employee, month: str) -> dict:
    month_start, month_end = parse_payroll_month(month)
    today = timezone.localdate()
    effective_end = min(month_end, today)

    resolved = resolve_compensation(employee, month)
    service = get_attendance_summary(employee.pk, month_start, effective_end)
    finalized = is_attendance_month_finalized(employee.hospital, month)

    calc_kwargs = {'require_finalized_attendance': finalized}
    calc = PayrollCalculator(employee=employee, month=month, **calc_kwargs)
    payroll_summary = calc.gather_attendance_summary()
    result = None
    calc_error = None
    try:
        if finalized:
            result = calc.calculate()
        else:
            # Preview calculation without finalization gate
            calc_preview = PayrollCalculator(
                employee=employee, month=month, require_finalized_attendance=False,
            )
            result = calc_preview.calculate()
    except Exception as exc:
        calc_error = str(exc)

    run = PayrollRun.objects.filter(employee=employee, month=month).order_by('-created_at').first()
    breakdown = status_breakdown(employee, month_start, effective_end)

    parity = {
        'present_match': Decimal(str(service.present_days)) == payroll_summary.present_days,
        'absent_match': Decimal(str(service.absent_days)) == payroll_summary.absent_days,
        'leave_match': Decimal(str(service.leave_days)) == payroll_summary.leave_days,
    }

    return {
        'employee_id': employee.employee_id,
        'name': employee.name,
        'email': employee.email,
        'biometric_pin': employee.biometric_pin,
        'shift': employee.shift.name if employee.shift else None,
        'compensation': {
            'basic': str(resolved.basic_salary),
            'hra': str(resolved.hra),
            'gross_components': str(
                resolved.basic_salary + resolved.hra
                + sum(Decimal(str(v)) for v in (resolved.allowances or {}).values())
            ),
            'overtime_rate': str(resolved.overtime_rate),
        },
        'month': month,
        'period': f'{month_start} to {effective_end} (partial month through today)',
        'attendance_finalized': finalized,
        'daily_status_breakdown': breakdown,
        'attendance_service': {
            'present_days': str(service.present_days),
            'absent_days': str(service.absent_days),
            'leave_days': str(service.leave_days),
            'late_days': str(service.late_days),
            'overtime_hours': str(service.overtime_hours),
            'working_days': str(service.working_days),
        },
        'payroll_calculator': {
            'present_days': str(payroll_summary.present_days),
            'absent_days': str(payroll_summary.absent_days),
            'leave_days': str(payroll_summary.leave_days),
            'late_days': str(payroll_summary.late_days),
            'overtime_hours': str(payroll_summary.overtime_hours),
            'working_days_in_month': payroll_summary.working_days_in_month,
        },
        'parity_ok': all(parity.values()),
        'parity': parity,
        'payroll_preview' if result else 'payroll_error': (
            {
                'gross_salary': str(result.gross_salary),
                'lop_amount': str(result.lop_amount),
                'overtime_amount': str(result.overtime_amount),
                'late_penalty': str(result.late_penalty),
                'total_deductions': str(result.total_deductions),
                'net_salary': str(result.final_salary),
                'per_day_salary': str(result.per_day_salary),
            }
            if result
            else calc_error
        ),
        'existing_payroll_run': (
            {
                'status': run.status,
                'net_salary': str(run.final_salary),
                'gross': str(run.gross_salary),
                'lop': str(run.lop_amount),
                'snapshot_present': (run.calculation_snapshot or {}).get('attendance_summary', {}).get('present_days'),
            }
            if run
            else None
        ),
    }


def main():
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument('--month', default=None)
    args = parser.parse_args()

    today = timezone.localdate()
    month = args.month or today.strftime('%Y-%m')
    hospital = Hospital.objects.order_by('id').first()
    if not hospital:
        print('No hospital in database.')
        return 1

    employees = pick_employees(hospital, month, limit=3)
    if not employees:
        # Fall back to June if July has no data yet
        month = '2026-06'
        employees = pick_employees(hospital, month, limit=3)

    if not employees:
        print('No real employees with compensation + attendance found.')
        return 1

    print(f'Spot check: {hospital.name} ({hospital.slug}) | month={month}')
    print('=' * 70)

    reports = [spot_check_employee(emp, month) for emp in employees]
    for i, report in enumerate(reports, 1):
        print(f"\n### Employee {i}: {report['name']} ({report['employee_id']})")
        print(f"PIN: {report['biometric_pin'] or 'not set'} | Shift: {report['shift']}")
        print(f"Period: {report['period']}")
        print(f"Finalized: {report['attendance_finalized']} | Parity OK: {report['parity_ok']}")
        print(f"Status breakdown: {report['daily_status_breakdown']}")
        print(f"Attendance: present={report['attendance_service']['present_days']} "
              f"absent={report['attendance_service']['absent_days']} "
              f"leave={report['attendance_service']['leave_days']} "
              f"OT={report['attendance_service']['overtime_hours']}h")
        preview = report.get('payroll_preview')
        if preview:
            print(f"Payroll preview: gross={preview['gross_salary']} LOP={preview['lop_amount']} "
                  f"OT pay={preview['overtime_amount']} late pen={preview['late_penalty']} "
                  f"NET={preview['net_salary']}")
        else:
            print(f"Payroll error: {report.get('payroll_error')}")
        if report['existing_payroll_run']:
            r = report['existing_payroll_run']
            print(f"Saved run: status={r['status']} NET={r['net_salary']} LOP={r['lop']}")

    print('\n' + '=' * 70)
    all_ok = all(r['parity_ok'] for r in reports)
    print('OVERALL:', 'PASS — attendance matches payroll for all spot-checked employees' if all_ok
          else 'WARN — mismatch on at least one employee (see parity)')
    print(json.dumps(reports, indent=2))
    return 0 if all_ok else 1


if __name__ == '__main__':
    raise SystemExit(main())
