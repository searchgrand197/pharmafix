"""Payroll month readiness — dashboard next-step for finalize / calculate / review."""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date
from typing import TYPE_CHECKING

from django.utils import timezone

from apps.hr.attendance_finalization_service import (
    is_attendance_month_finalized,
    parse_month,
)
from apps.hr.payroll_calculator import parse_payroll_month
from apps.hr.payroll_models import PayrollRun
from apps.hr.payroll_structure_resolver import resolve_compensation

if TYPE_CHECKING:
    from apps.shared.models import Hospital

PAYROLL_RUNS_NEEDING_ACTION = frozenset({
    PayrollRun.STATUS_DRAFT,
    PayrollRun.STATUS_CALCULATED,
    PayrollRun.STATUS_UNDER_REVIEW,
    PayrollRun.STATUS_APPROVED,
    PayrollRun.STATUS_FINALIZED,
})


@dataclass
class PayrollMonthReadiness:
    month: str
    hospital_id: str
    attendance_row_count: int = 0
    unfinalized_row_count: int = 0
    employees_with_attendance: int = 0
    finalized: bool = False
    payroll_eligible_employees: int = 0
    payroll_run_count: int = 0
    payroll_runs_needing_action: int = 0
    next_action: str = 'none'
    blocking_reasons: list[str] = field(default_factory=list)

    def as_dict(self) -> dict:
        return {
            'month': self.month,
            'hospital_id': self.hospital_id,
            'attendance_row_count': self.attendance_row_count,
            'unfinalized_row_count': self.unfinalized_row_count,
            'employees_with_attendance': self.employees_with_attendance,
            'finalized': self.finalized,
            'payroll_eligible_employees': self.payroll_eligible_employees,
            'payroll_run_count': self.payroll_run_count,
            'payroll_runs_needing_action': self.payroll_runs_needing_action,
            'next_action': self.next_action,
            'blocking_reasons': self.blocking_reasons,
        }


def default_payroll_month() -> str:
    return timezone.localdate().strftime('%Y-%m')


def _employee_joined_on_or_before_month(employee, month_end: date) -> bool:
    join = employee.joining_date_confirmed or employee.joining_date
    if not join:
        return True
    return join <= month_end


def _count_payroll_eligible_employees(hospital, month: str) -> int:
    from apps.hr.models import Employee

    _month_start, month_end = parse_payroll_month(month)
    qs = Employee.objects.filter(status='active', hospital_id=hospital.id)
    count = 0
    for employee in qs.iterator():
        if not _employee_joined_on_or_before_month(employee, month_end):
            continue
        if resolve_compensation(employee, month) is not None:
            count += 1
    return count


def _attendance_counts(hospital, month: str) -> tuple[int, int, int]:
    from apps.hr.models import DailyAttendance

    month_start, month_end = parse_month(month)
    qs = DailyAttendance.objects.filter(
        employee__hospital_id=hospital.id,
        date__gte=month_start,
        date__lte=month_end,
    )
    row_count = qs.count()
    unfinalized = qs.filter(finalized=False).count()
    employees_with_attendance = qs.values('employee_id').distinct().count()
    return row_count, unfinalized, employees_with_attendance


def _payroll_run_counts(hospital, month: str) -> tuple[int, int]:
    runs = PayrollRun.objects.filter(
        employee__hospital_id=hospital.id,
        month=month,
    )
    total = runs.count()
    needing_action = runs.filter(status__in=PAYROLL_RUNS_NEEDING_ACTION).count()
    return total, needing_action


def compute_payroll_month_readiness(hospital: 'Hospital', month: str) -> PayrollMonthReadiness:
    readiness = PayrollMonthReadiness(
        month=month,
        hospital_id=str(hospital.id),
    )

    (
        readiness.attendance_row_count,
        readiness.unfinalized_row_count,
        readiness.employees_with_attendance,
    ) = _attendance_counts(hospital, month)
    readiness.finalized = is_attendance_month_finalized(hospital, month)
    readiness.payroll_eligible_employees = _count_payroll_eligible_employees(hospital, month)
    readiness.payroll_run_count, readiness.payroll_runs_needing_action = _payroll_run_counts(
        hospital,
        month,
    )

    if readiness.payroll_eligible_employees == 0 and readiness.employees_with_attendance == 0:
        readiness.next_action = 'none'
        if readiness.attendance_row_count > 0:
            readiness.blocking_reasons.append('no_payroll_eligible_employees')
        return readiness

    if not readiness.finalized:
        if readiness.attendance_row_count > 0:
            readiness.next_action = 'finalize_attendance'
        else:
            readiness.next_action = 'none'
        return readiness

    if readiness.payroll_runs_needing_action > 0:
        readiness.next_action = 'review_payroll'
        return readiness

    if readiness.payroll_run_count == 0 and readiness.payroll_eligible_employees > 0:
        readiness.next_action = 'calculate_payroll'
        return readiness

    readiness.next_action = 'none'
    return readiness
