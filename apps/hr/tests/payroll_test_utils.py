"""Shared helpers for payroll-related tests."""
from __future__ import annotations

import copy
import uuid
from calendar import monthrange
from datetime import date
from decimal import Decimal

from apps.hr.attendance_analytics import build_employee_analytics
from apps.hr.attendance_finalization_service import finalize_attendance_month
from apps.hr.attendance_service import get_attendance_summary
from apps.hr.models import DailyAttendance, Designation
from apps.hr.payroll_api.compensation_level_service import (
    assign_compensation_level_to_employee,
    save_compensation_level,
)
from apps.hr.payroll_calculator import PayrollCalculator, parse_payroll_month


def ensure_test_designation(hospital, *, name: str = 'Test Staff', code: str = 'TEST_STAFF') -> Designation:
    designation, _ = Designation.objects.get_or_create(
        hospital=hospital,
        code=code,
        defaults={'name': name, 'is_active': True},
    )
    return designation


def assign_test_compensation(
    employee,
    *,
    designation: Designation | None = None,
    basic: str = '30000.00',
    hra: str = '10000.00',
    overtime_rate: str = '200.00',
    overtime_enabled: bool = True,
    late_policy_enabled: bool = False,
    late_penalty_value: str | None = None,
    effective_from: date | None = None,
):
    """Assign a compensation level for payroll tests (replaces legacy SalaryStructure-only setup)."""
    from apps.hr.payroll_models import CompensationLevel

    designation = designation or ensure_test_designation(employee.hospital)
    if employee.designation_id != designation.id:
        employee.designation = designation
        employee.save(update_fields=['designation', 'updated_at'])

    effective = effective_from or date(2026, 1, 1)
    code = f'TEST_{uuid.uuid4().hex[:8].upper()}'
    compliance_fields = {
        'late_policy_enabled': late_policy_enabled,
        'late_penalty_type': 'per_minute',
        'late_penalty_value': Decimal(late_penalty_value or '0'),
        'late_penalty_threshold_minutes': 15,
        'overtime_enabled': overtime_enabled,
        'overtime_type': 'fixed_per_hour',
    }
    level = save_compensation_level(
        hospital=employee.hospital,
        designation=designation,
        code=code,
        name=f'Test Level {code}',
        rank=0,
        basic=Decimal(basic),
        hra=Decimal(hra),
        medical=Decimal('0.00'),
        special_allowance=Decimal('0.00'),
        allowances={'transport': 2000},
        deductions={'pf': 1800},
        overtime_rate=Decimal(overtime_rate),
        effective_from=effective,
        compliance_fields=compliance_fields,
    )
    assign_compensation_level_to_employee(
        employee=employee,
        level=level,
        effective_from=effective,
    )
    return CompensationLevel.objects.get(pk=level.pk)


def finalize_hospital_attendance_month(hospital, month: str, *, user=None):
    """Finalize attendance month for payroll tests."""
    record, _report = finalize_attendance_month(
        hospital=hospital,
        month=month,
        finalized_by=user,
    )
    return record


def seed_month_attendance(
    employee,
    month: str,
    *,
    day_overrides: dict[date, dict] | None = None,
    default_weekday: str = 'absent',
) -> None:
    """Create DailyAttendance rows for every day in ``month``."""
    month_start, month_end = parse_payroll_month(month)
    overrides = day_overrides or {}
    last_day = monthrange(month_start.year, month_start.month)[1]
    for day_num in range(1, last_day + 1):
        day = date(month_start.year, month_start.month, day_num)
        if day in overrides:
            fields = dict(overrides[day])
        else:
            status = 'weekend' if day.weekday() >= 5 else default_weekday
            fields = {'attendance_status': status}
        DailyAttendance.objects.create(employee=employee, date=day, **fields)


def attendance_core_metrics(employee, month: str, *, require_finalized: bool = False) -> dict[str, dict]:
    """Collect comparable attendance metrics from all consumer surfaces."""
    month_start, month_end = parse_payroll_month(month)
    service = get_attendance_summary(employee.pk, month_start, month_end)
    calc = PayrollCalculator(
        employee=employee,
        month=month,
        require_finalized_attendance=require_finalized,
    )
    payroll = calc.gather_attendance_summary()
    hr_analytics = build_employee_analytics(str(employee.pk), month=month)
    portal_analytics = build_employee_analytics(str(employee.pk), month=month)

    def _q(value) -> Decimal:
        return Decimal(str(value)).quantize(Decimal('0.01'))

    service_core = {
        'present_days': _q(service.present_days),
        'absent_days': _q(service.absent_days),
        'leave_days': _q(service.leave_days),
        'late_days': _q(service.late_days),
        'half_days': _q(service.half_days),
        'overtime_hours': _q(service.overtime_hours),
        'working_hours': _q(service.working_hours),
    }
    payroll_core = {
        'present_days': _q(payroll.present_days),
        'absent_days': _q(payroll.absent_days),
        'leave_days': _q(payroll.leave_days),
        'late_days': _q(payroll.late_days),
        'half_days': _q(payroll.half_days),
        'overtime_hours': _q(payroll.overtime_hours),
        'working_hours': _q(payroll.total_work_hours),
    }

    def _from_analytics(payload: dict) -> dict:
        summary = payload['summary']
        return {
            'present_days': _q(summary['present_days']),
            'absent_days': _q(summary['absent_days']),
            'leave_days': _q(summary['leave_days']),
            'late_days': _q(summary['late_days']),
            'half_days': _q(summary.get('half_days', 0)),
            'overtime_hours': _q(summary['total_overtime_hours']),
            'working_hours': _q(summary['total_work_hours']),
        }

    return {
        'service': service_core,
        'payroll': payroll_core,
        'hr': _from_analytics(hr_analytics),
        'portal': _from_analytics(portal_analytics),
    }


def assert_attendance_surfaces_match(test_case, employee, month: str, *, require_finalized: bool = False) -> dict:
    """Assert HR dashboard, employee portal, service, and payroll agree."""
    metrics = attendance_core_metrics(employee, month, require_finalized=require_finalized)
    test_case.assertEqual(metrics['payroll'], metrics['service'])
    test_case.assertEqual(metrics['hr'], metrics['portal'])
    test_case.assertEqual(metrics['hr'], metrics['service'])
    return metrics


def deep_copy_snapshot(snapshot: dict | None) -> dict:
    return copy.deepcopy(snapshot or {})
