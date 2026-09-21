"""
Attendance month finalization — lock daily rows for payroll.
"""
from __future__ import annotations

import calendar
from dataclasses import dataclass, field
from datetime import date
from typing import TYPE_CHECKING

from django.db import transaction
from django.utils import timezone

if TYPE_CHECKING:
    from apps.hr.models import AttendanceMonthFinalization, Employee
    from apps.shared.models import Hospital


class AttendanceFinalizationError(Exception):
    def __init__(self, message: str, *, code: str = 'attendance_finalization_error'):
        super().__init__(message)
        self.code = code
        self.message = message


@dataclass
class AttendanceFinalizationReport:
    month: str
    hospital_id: str
    rows_finalized: int = 0
    employees_touched: int = 0
    warnings: list[str] = field(default_factory=list)
    pending_hr_review_count: int = 0
    incomplete_status_count: int = 0


PROVISIONAL_STATUSES = frozenset({
    'in_progress',
    'incomplete',
    'missing_checkout',
})


def parse_month(month: str) -> tuple[date, date]:
    year_str, month_str = month.split('-', 1)
    year, month_num = int(year_str), int(month_str)
    last_day = calendar.monthrange(year, month_num)[1]
    return date(year, month_num, 1), date(year, month_num, last_day)


def get_attendance_month_finalization(
    hospital,
    month: str,
) -> 'AttendanceMonthFinalization | None':
    from apps.hr.models import AttendanceMonthFinalization

    if hospital is None:
        return None
    return AttendanceMonthFinalization.objects.filter(
        hospital_id=hospital.id if hasattr(hospital, 'id') else hospital,
        month=month,
    ).first()


def is_attendance_month_finalized(hospital, month: str) -> bool:
    return get_attendance_month_finalization(hospital, month) is not None


def _scoped_employees(hospital):
    from apps.hr.models import Employee

    qs = Employee.objects.filter(status='active')
    hospital_id = hospital.id if hasattr(hospital, 'id') else hospital
    if hospital_id:
        qs = qs.filter(hospital_id=hospital_id)
    return qs


@transaction.atomic
def finalize_attendance_month(
    *,
    hospital: 'Hospital',
    month: str,
    finalized_by=None,
    block_on_hr_review: bool = False,
) -> tuple['AttendanceMonthFinalization', AttendanceFinalizationReport]:
    from apps.hr.models import AttendanceMonthFinalization, DailyAttendance

    if get_attendance_month_finalization(hospital, month):
        raise AttendanceFinalizationError(
            f'Attendance for {month} is already finalized.',
            code='already_finalized',
        )

    month_start, month_end = parse_month(month)
    now = timezone.now()
    report = AttendanceFinalizationReport(
        month=month,
        hospital_id=str(hospital.id),
    )

    attendance_qs = DailyAttendance.objects.filter(
        employee__hospital_id=hospital.id,
        date__gte=month_start,
        date__lte=month_end,
    ).select_related('employee')

    pending_review = attendance_qs.filter(requires_hr_review=True, finalized=False).count()
    report.pending_hr_review_count = pending_review
    if block_on_hr_review and pending_review > 0:
        raise AttendanceFinalizationError(
            f'{pending_review} attendance row(s) require HR review before finalization.',
            code='pending_hr_review',
        )
    if pending_review > 0:
        report.warnings.append(f'{pending_review} row(s) flagged requires_hr_review were still finalized.')

    incomplete_count = attendance_qs.filter(
        attendance_status__in=PROVISIONAL_STATUSES,
        finalized=False,
    ).count()
    report.incomplete_status_count = incomplete_count
    if incomplete_count > 0:
        report.warnings.append(
            f'{incomplete_count} row(s) have provisional status (in_progress/incomplete/missing_checkout).',
        )

    updated = attendance_qs.filter(finalized=False).update(
        finalized=True,
        finalized_at=now,
        finalized_by=finalized_by,
        updated_at=now,
    )
    report.rows_finalized = updated
    report.employees_touched = (
        attendance_qs.filter(finalized=True)
        .values('employee_id')
        .distinct()
        .count()
    )

    record = AttendanceMonthFinalization.objects.create(
        hospital=hospital,
        month=month,
        finalized_at=now,
        finalized_by=finalized_by,
        summary={
            'rows_finalized': report.rows_finalized,
            'employees_touched': report.employees_touched,
            'pending_hr_review_count': report.pending_hr_review_count,
            'incomplete_status_count': report.incomplete_status_count,
            'warnings': report.warnings,
        },
    )
    return record, report


@transaction.atomic
def unfinalize_attendance_month(
    *,
    hospital: 'Hospital',
    month: str,
) -> int:
    from apps.hr.models import AttendanceMonthFinalization, DailyAttendance

    record = get_attendance_month_finalization(hospital, month)
    if record is None:
        raise AttendanceFinalizationError(
            f'Attendance for {month} is not finalized.',
            code='not_finalized',
        )

    month_start, month_end = parse_month(month)
    cleared = DailyAttendance.objects.filter(
        employee__hospital_id=hospital.id,
        date__gte=month_start,
        date__lte=month_end,
        finalized=True,
    ).update(
        finalized=False,
        finalized_at=None,
        finalized_by=None,
    )
    record.delete()
    return cleared
