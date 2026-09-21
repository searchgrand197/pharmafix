"""
Single source of truth for employee attendance period summaries.

All consumers (HR employee analytics, employee portal, payroll, reports) must use
``get_attendance_summary`` so present/absent/leave/holiday/late/overtime/working hours
stay aligned.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from decimal import Decimal

from apps.hr.models import Employee
from apps.hr.payroll_calculator import (
    DAY_QUANTIZE,
    PayrollCalculator,
    employee_effective_join_date,
)


@dataclass(frozen=True)
class AttendanceSummary:
    """Canonical attendance aggregates for an employee over an inclusive date range."""

    present_days: Decimal
    absent_days: Decimal
    leave_days: Decimal
    holiday_days: Decimal
    late_days: Decimal
    overtime_hours: Decimal
    working_hours: Decimal
    half_days: Decimal = Decimal('0.00')
    working_days: int = 0
    paid_leave_days: Decimal = Decimal('0.00')
    unpaid_leave_days: Decimal = Decimal('0.00')
    period_start: date | None = None
    period_end: date | None = None
    month_finalized: bool = False
    uses_finalized_rows_only: bool = False


def resolve_attendance_period(
    employee: Employee,
    start_date: date,
    end_date: date,
) -> tuple[date, date]:
    """
    Inclusive attendance window: max(join date, start_date) through end_date.
    Never includes dates before the employee's effective joining date.
    """
    period_start = start_date
    join = employee_effective_join_date(employee)
    if join and join > period_start:
        period_start = join
    return period_start, end_date


def _month_finalized_for_employee(employee: Employee, month: str) -> bool:
    from apps.hr.attendance_finalization_service import is_attendance_month_finalized

    if not employee.hospital_id:
        return False
    return is_attendance_month_finalized(employee.hospital, month)


def build_attendance_summary_bundle(
    employee: Employee,
    start_date: date,
    end_date: date,
    *,
    require_finalized_attendance: bool | None = None,
) -> tuple[AttendanceSummary, 'ComplianceCalculationResult']:
    """
    Single calculator pass for portal, HR analytics, and payroll attendance totals.

    When ``require_finalized_attendance`` is omitted, finalized rows are used automatically
    for months that are locked for payroll.
    """
    period_start, period_end = resolve_attendance_period(employee, start_date, end_date)
    month = period_end.strftime('%Y-%m')
    month_finalized = _month_finalized_for_employee(employee, month)
    if require_finalized_attendance is None:
        require_finalized_attendance = month_finalized

    calc = PayrollCalculator(
        employee=employee,
        month=month,
        period_start=period_start,
        period_end=period_end,
        require_finalized_attendance=require_finalized_attendance,
    )
    resolved_start, resolved_end = calc.get_payroll_period()
    leave = calc.calculate_leave_days()
    compliance = calc.compute_attendance_compliance()
    raw_overtime = calc._sum_overtime_hours()
    overtime_hours = compliance.overtime_hours or raw_overtime

    summary = AttendanceSummary(
        present_days=calc.calculate_present_days(),
        absent_days=calc.calculate_absent_days(),
        leave_days=leave.total,
        holiday_days=calc.calculate_holiday_days(),
        late_days=calc.calculate_late_days(),
        overtime_hours=overtime_hours,
        working_hours=calc._sum_work_hours(),
        half_days=calc.calculate_half_days(),
        working_days=calc.calculate_working_days(),
        paid_leave_days=leave.paid,
        unpaid_leave_days=leave.unpaid,
        period_start=resolved_start,
        period_end=resolved_end,
        month_finalized=month_finalized,
        uses_finalized_rows_only=require_finalized_attendance,
    )
    return summary, compliance


def get_attendance_summary(
    employee_id,
    start_date: date,
    end_date: date,
    *,
    require_finalized_attendance: bool | None = None,
) -> AttendanceSummary:
    """
    Aggregate attendance for one employee over [start_date, end_date], clipped to join date.

    Delegates to PayrollCalculator aggregation (working-day rules, half-days, leave overrides).
    """
    employee = Employee.objects.get(pk=employee_id)
    summary, _compliance = build_attendance_summary_bundle(
        employee,
        start_date,
        end_date,
        require_finalized_attendance=require_finalized_attendance,
    )
    return summary


def attendance_compliance_as_portal_dict(compliance: 'ComplianceCalculationResult') -> dict:
    """Map compliance calculation to employee portal / HR analytics shape."""
    status = 'ok'
    if compliance.warnings:
        status = 'warning'
    return {
        'monthly_late_count': compliance.monthly_late_count,
        'overtime_hours': float(compliance.overtime_hours.quantize(DAY_QUANTIZE)),
        'late_equivalent_leave_days': float(compliance.late_equivalent_leave_days.quantize(DAY_QUANTIZE)),
        'late_warnings': list(compliance.warnings),
        'status': status,
    }


def attendance_summary_as_portal_dict(
    summary: AttendanceSummary,
    *,
    incomplete_days: int = 0,
) -> dict:
    """Map canonical summary to portal/HR employee-analytics API shape."""
    working = summary.working_days
    present = float(summary.present_days or 0)
    attendance_pct = round((present / working) * 100, 1) if working else 0.0
    return {
        'working_days': working,
        'present_days': present,
        'late_days': float(summary.late_days),
        'absent_days': float(summary.absent_days),
        'half_days': float(summary.half_days),
        'incomplete_days': incomplete_days,
        'leave_days': float(summary.leave_days),
        'holiday_days': float(summary.holiday_days),
        'attendance_percentage': attendance_pct,
        'total_work_hours': float(summary.working_hours.quantize(DAY_QUANTIZE)),
        'total_overtime_hours': float(summary.overtime_hours.quantize(DAY_QUANTIZE)),
        'month_finalized': summary.month_finalized,
        'uses_finalized_rows_only': summary.uses_finalized_rows_only,
    }
