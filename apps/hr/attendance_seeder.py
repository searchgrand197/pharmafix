"""
Generate realistic monthly attendance via real punches + calculation engine.

Used for HR payroll/attendance testing only — not fake dashboard aggregates.
"""
from __future__ import annotations

import logging
import random
from calendar import monthrange
from dataclasses import dataclass, field
from datetime import date, time, timedelta
from typing import Iterable

from django.db import transaction
from django.db.models import Exists, OuterRef, Q
from django.utils import timezone

from apps.hr.attendance_control import _attendance_date_for, _out_timestamp
from apps.hr.attendance_engine import recalculate_daily_attendance, resolve_shift_for_employee
from apps.hr.payroll_calculator import employee_effective_join_date
from apps.hr.attendance_policy import combine_attendance_day_time
from apps.hr.models import AttendancePunch, DailyAttendance, Employee, Shift

logger = logging.getLogger(__name__)

SOURCE_TEST_SEED = AttendancePunch.SOURCE_MANUAL_BIOMETRIC_SIMULATION
DEVICE_ID = 'BIO_SIM'

SCENARIO_PERFECT = 'perfect'
SCENARIO_AVERAGE = 'average'
SCENARIO_PROBLEM = 'problem'
SCENARIO_OVERTIME = 'overtime'
SCENARIO_PAYROLL_STRESS = 'payroll_stress'

SCENARIO_ALIASES = {
    'a': SCENARIO_PERFECT,
    'perfect': SCENARIO_PERFECT,
    'perfect_employee': SCENARIO_PERFECT,
    'b': SCENARIO_AVERAGE,
    'average': SCENARIO_AVERAGE,
    'average_employee': SCENARIO_AVERAGE,
    'c': SCENARIO_PROBLEM,
    'problem': SCENARIO_PROBLEM,
    'problem_employee': SCENARIO_PROBLEM,
    'd': SCENARIO_OVERTIME,
    'overtime': SCENARIO_OVERTIME,
    'overtime_employee': SCENARIO_OVERTIME,
    'payroll_stress': SCENARIO_PAYROLL_STRESS,
    'payroll_stress_test': SCENARIO_PAYROLL_STRESS,
}


class AttendanceSeederError(Exception):
    def __init__(self, message: str, code: str = 'invalid_request'):
        super().__init__(message)
        self.message = message
        self.code = code


INCOMPLETE_PUNCH_STATUSES = frozenset({'in_progress', 'missing_checkout', 'incomplete'})


@dataclass
class SeederSummary:
    employees_processed: int = 0
    employees_skipped: list[dict] = field(default_factory=list)
    days_in_month: int = 0
    working_days_considered: int = 0
    punches_created: int = 0
    summaries_created: int = 0
    present: float = 0.0
    absent: float = 0.0
    late: float = 0.0
    half_day: float = 0.0
    leave_days: float = 0.0
    regular_work_hours: float = 0.0
    incomplete_punch_days: int = 0
    hr_review_days: int = 0
    overtime: int = 0
    overtime_hours: float = 0.0
    weekend: int = 0
    holiday: int = 0
    other: int = 0
    warnings: list[str] = field(default_factory=list)

    def as_dict(self) -> dict:
        return {
            'employees_processed': self.employees_processed,
            'employees_skipped': self.employees_skipped,
            'days_in_month': self.days_in_month,
            'working_days_considered': self.working_days_considered,
            'generated_punches': self.punches_created,
            'generated_summaries': self.summaries_created,
            'present': round(self.present, 2),
            'absent': round(self.absent, 2),
            'late': round(self.late, 2),
            'half_day': round(self.half_day, 2),
            'leave_days': round(self.leave_days, 2),
            'regular_work_hours': round(self.regular_work_hours, 2),
            'incomplete_punch_days': self.incomplete_punch_days,
            'hr_review_days': self.hr_review_days,
            'overtime': self.overtime,
            'overtime_hours': round(self.overtime_hours, 2),
            'weekend': self.weekend,
            'holiday': self.holiday,
            'other': self.other,
            'warnings': list(self.warnings),
        }


def normalize_scenario(raw: str) -> str:
    key = str(raw or '').strip().lower().replace(' ', '_')
    scenario = SCENARIO_ALIASES.get(key)
    if not scenario:
        allowed = ', '.join(sorted({
            SCENARIO_PERFECT,
            SCENARIO_AVERAGE,
            SCENARIO_PROBLEM,
            SCENARIO_OVERTIME,
            SCENARIO_PAYROLL_STRESS,
        }))
        raise AttendanceSeederError(f'Unknown scenario {raw!r}. Use one of: {allowed}', code='invalid_scenario')
    return scenario


def month_bounds(year: int, month: int) -> tuple[date, date]:
    if not 1 <= month <= 12:
        raise AttendanceSeederError('Month must be 1–12.', code='invalid_month')
    _, last = monthrange(year, month)
    return date(year, month, 1), date(year, month, last)


def effective_joining_date(employee: Employee) -> date | None:
    """Employment start for attendance seeding — same rule as payroll."""
    return employee_effective_join_date(employee)


def employee_seed_start(employee: Employee, month_start: date) -> date:
    """First calendar day this employee should have attendance in the month."""
    joined = effective_joining_date(employee)
    if joined and joined > month_start:
        return joined
    return month_start


def is_weekend(day: date) -> bool:
    return day.weekday() >= 5


def parse_holiday_dates(values: Iterable | None) -> set[date]:
    holidays: set[date] = set()
    for raw in values or []:
        try:
            holidays.add(date.fromisoformat(str(raw)[:10]))
        except ValueError:
            continue
    return holidays


def default_shift_times(shift: Shift | None) -> tuple[time, time, int, float]:
    if shift and shift.start_time and shift.end_time:
        return (
            shift.start_time,
            shift.end_time,
            int(shift.grace_minutes or 0),
            float(shift.half_day_hours or 4),
        )
    return time(9, 0), time(18, 0), 15, 4.0


def _add_minutes(clock: time, minutes: int) -> time:
    base = combine_attendance_day_time(date.today(), clock)
    return (base + timedelta(minutes=minutes)).time()


def _resolve_seeder_checkout_timestamp(
    work_date: date,
    shift: Shift | None,
    check_in: time,
    check_out: time,
) -> datetime:
    """
    Build checkout timestamp strictly after check-in for seeder punches.

    Overnight shifts (e.g. 18:00–00:00) need early-morning checkout on the next
    calendar day; otherwise OUT can appear before IN and pairing fails.
    """
    in_ts = combine_attendance_day_time(work_date, check_in)
    if shift and shift.is_overnight and shift.end_time is not None:
        if check_out <= check_in or check_out <= shift.end_time:
            return combine_attendance_day_time(work_date + timedelta(days=1), check_out)
    out_ts = _out_timestamp(work_date, shift, check_out)
    if out_ts <= in_ts:
        out_ts = combine_attendance_day_time(work_date + timedelta(days=1), check_out)
    return out_ts


def _pick_day_kind(rng: random.Random, scenario: str) -> str:
    roll = rng.random()
    if scenario == SCENARIO_PERFECT:
        return 'present'
    if scenario == SCENARIO_AVERAGE:
        if roll < 0.05:
            return 'absent'
        if roll < 0.15:
            return 'late'
        return 'present'
    if scenario == SCENARIO_PROBLEM:
        if roll < 0.15:
            return 'absent'
        if roll < 0.40:
            return 'late'
        if roll < 0.52:
            return 'half_day'
        return 'present'
    if scenario == SCENARIO_OVERTIME:
        if roll < 0.03:
            return 'absent'
        if roll < 0.08:
            return 'late'
        return 'overtime'
    if scenario == SCENARIO_PAYROLL_STRESS:
        if roll < 0.10:
            return 'absent'
        if roll < 0.22:
            return 'late'
        if roll < 0.30:
            return 'half_day'
        if roll < 0.42:
            return 'overtime'
        if roll < 0.52:
            return 'incomplete'
        return 'present'
    return 'present'


def _times_for_kind(
    kind: str,
    *,
    start: time,
    end: time,
    grace: int,
    half_hours: float,
    rng: random.Random,
) -> tuple[time, time] | None:
    if kind == 'absent':
        return None
    if kind == 'present':
        # On-time or early only — positive offset within grace still records late_minutes
        # and inflates payroll "late days" on dashboards.
        offset = rng.randint(-5, 0)
        return _add_minutes(start, offset), end
    if kind == 'late':
        late_min = int(grace or 0) + rng.randint(10, 55)
        return _add_minutes(start, late_min), end
    if kind == 'half_day':
        out_min = int(half_hours * 60) + rng.randint(-15, 15)
        return start, _add_minutes(start, max(60, out_min))
    if kind == 'overtime':
        extra = rng.randint(60, 180)
        return start, _add_minutes(end, extra)
    return start, end


def clear_employee_month(employee: Employee, start: date, end: date) -> tuple[int, int]:
    punch_q = Q(employee=employee, is_void=False) & (
        Q(attendance_date__gte=start, attendance_date__lte=end)
        | Q(attendance_date__isnull=True, timestamp__date__gte=start, timestamp__date__lte=end)
    )
    punches_deleted, _ = AttendancePunch.objects.filter(punch_q).delete()
    summaries_deleted, _ = DailyAttendance.objects.filter(
        employee=employee,
        date__gte=start,
        date__lte=end,
    ).delete()
    return punches_deleted, summaries_deleted


def _create_punch(
    *,
    employee: Employee,
    shift: Shift | None,
    timestamp,
    punch_type: str,
    created_by=None,
    attendance_date: date | None = None,
) -> AttendancePunch:
    resolved_date = attendance_date or _attendance_date_for(employee, timestamp, punch_type, shift)
    return AttendancePunch.objects.create(
        employee=employee,
        shift=shift or employee.shift,
        attendance_date=resolved_date,
        timestamp=timestamp,
        punch_type=punch_type,
        source=SOURCE_TEST_SEED,
        device_id=DEVICE_ID,
        notes='Biometric test attendance seed.',
        created_by=created_by,
    )


def _seed_non_working_summary(
    employee: Employee,
    day: date,
    status: str,
    shift: Shift | None,
) -> DailyAttendance:
    attendance, _ = DailyAttendance.objects.update_or_create(
        employee=employee,
        date=day,
        defaults={
            'shift': shift,
            'first_check_in': None,
            'last_check_out': None,
            'total_work_hours': None,
            'overtime_hours': None,
            'overtime_minutes': 0,
            'late_minutes': 0,
            'attendance_status': status,
            'attendance_source': 'SYSTEM',
            'incomplete_punches': False,
            'incomplete_checkout': False,
            'requires_hr_review': False,
            'calculation_details': {'seeded': True, 'status': status},
            'last_calculated_at': timezone.now(),
        },
    )
    return attendance


def _seed_punch_day(
    employee: Employee,
    day: date,
    kind: str,
    shift: Shift | None,
    created_by=None,
) -> int:
    start, end, grace, half_hours = default_shift_times(shift)
    rng = random.Random(f'{employee.id}-{day.isoformat()}-{kind}')
    times = _times_for_kind(
        kind,
        start=start,
        end=end,
        grace=grace,
        half_hours=half_hours,
        rng=rng,
    )
    if not times:
        recalculate_daily_attendance(employee, day, force=True)
        return 0

    check_in, check_out = times
    in_ts = combine_attendance_day_time(day, check_in)
    out_ts = _resolve_seeder_checkout_timestamp(day, shift, check_in, check_out)

    _create_punch(
        employee=employee,
        shift=shift,
        timestamp=in_ts,
        punch_type='IN',
        created_by=created_by,
        attendance_date=day,
    )
    _create_punch(
        employee=employee,
        shift=shift,
        timestamp=out_ts,
        punch_type='OUT',
        created_by=created_by,
        attendance_date=day,
    )
    recalculate_daily_attendance(employee, day, force=True)
    return 2


def _seed_incomplete_day(
    employee: Employee,
    day: date,
    shift: Shift | None,
    created_by=None,
) -> int:
    """IN only — open checkout / missing punch edge case for payroll stress tests."""
    start, _, _, _ = default_shift_times(shift)
    in_ts = combine_attendance_day_time(day, start)
    _create_punch(
        employee=employee,
        shift=shift,
        timestamp=in_ts,
        punch_type='IN',
        created_by=created_by,
        attendance_date=day,
    )
    recalculate_daily_attendance(employee, day, force=True)
    return 1


def _tally_summary(summary: SeederSummary, employee: Employee, start: date, end: date) -> None:
    """
    Aggregate using get_attendance_summary so generation totals match HR dashboard,
    employee portal, and payroll for the same month.

    Always reads unfinalized rows so the post-generation panel reflects freshly seeded data.
    """
    rows = DailyAttendance.objects.filter(employee=employee, date__gte=start, date__lte=end)
    summary.summaries_created += rows.count()

    for row in rows:
        status = row.attendance_status
        has_ot = bool(row.overtime_hours and row.overtime_hours > 0) or bool(row.overtime_minutes)
        if status == 'weekend':
            summary.weekend += 1
        elif status == 'holiday':
            summary.holiday += 1
        elif status not in {
            'present', 'late', 'absent', 'half_day', 'overtime', 'work_from_office',
        }:
            summary.other += 1
        if status in INCOMPLETE_PUNCH_STATUSES:
            summary.incomplete_punch_days += 1
        if row.requires_hr_review:
            summary.hr_review_days += 1
        if has_ot and status not in {'weekend', 'holiday', 'absent'}:
            summary.overtime += 1

    from apps.hr.attendance_service import get_attendance_summary

    canonical = get_attendance_summary(
        str(employee.pk),
        start,
        end,
        require_finalized_attendance=False,
    )
    summary.present += float(canonical.present_days)
    summary.absent += float(canonical.absent_days)
    summary.late += float(canonical.late_days)
    summary.half_day += float(canonical.half_days)
    summary.leave_days += float(canonical.leave_days)
    summary.regular_work_hours += float(canonical.working_hours)
    summary.overtime_hours += float(canonical.overtime_hours)


@transaction.atomic
def generate_test_attendance(
    *,
    employees: list[Employee],
    year: int,
    month: int,
    scenario: str,
    holiday_dates: set[date] | None = None,
    replace_existing: bool = True,
    created_by=None,
    hospital_id=None,
) -> SeederSummary:
    scenario = normalize_scenario(scenario)
    holidays = holiday_dates or set()
    month_start, month_end = month_bounds(year, month)
    today = timezone.localdate()
    if month_start > today:
        raise AttendanceSeederError('Cannot seed a future month.', code='future_month')
    # HR test tool: seed the full selected month (including future days in-month) so employees
    # whose joining date falls later in the month still receive attendance. Live HR rebuild
    # after generation only reconciles days through today.
    effective_end = month_end

    summary = SeederSummary()
    summary.days_in_month = (month_end - month_start).days + 1
    month_str = f'{year}-{month:02d}'

    if replace_existing:
        from apps.hr.attendance_finalization_service import (
            is_attendance_month_finalized,
            unfinalize_attendance_month,
        )
        from apps.shared.models import Hospital

        hospital = None
        if hospital_id:
            hospital = Hospital.objects.filter(pk=hospital_id).first()
        elif employees:
            hospital = employees[0].hospital
        if hospital and is_attendance_month_finalized(hospital, month_str):
            unfinalize_attendance_month(hospital=hospital, month=month_str)
            summary.warnings.append(
                f'Attendance for {month_str} was unfinalized. Finalize again before payroll.',
            )

    for employee in employees:
        if hospital_id and employee.hospital_id and str(employee.hospital_id) != str(hospital_id):
            summary.employees_skipped.append({
                'employee_id': employee.employee_id,
                'reason': 'outside_hospital_scope',
            })
            continue
        if employee.status != 'active':
            summary.employees_skipped.append({
                'employee_id': employee.employee_id,
                'reason': f'inactive_status_{employee.status}',
            })
            continue

        shift = resolve_shift_for_employee(employee, month_start)
        if not shift and not employee.shift_id:
            summary.employees_skipped.append({
                'employee_id': employee.employee_id,
                'reason': 'no_shift_assigned',
            })
            continue

        emp_start = employee_seed_start(employee, month_start)
        if emp_start > month_end:
            summary.employees_skipped.append({
                'employee_id': employee.employee_id,
                'reason': 'joining_date_after_month_end',
            })
            continue
        if emp_start > effective_end:
            summary.employees_skipped.append({
                'employee_id': employee.employee_id,
                'reason': 'joining_date_after_seed_period',
            })
            continue

        if replace_existing:
            clear_employee_month(employee, month_start, month_end)

        employee_days_seeded = 0
        rng = random.Random(f'{employee.id}-{year}-{month}-{scenario}')
        day = month_start
        while day <= effective_end:
            if day < emp_start:
                day += timedelta(days=1)
                continue

            if is_weekend(day):
                _seed_non_working_summary(employee, day, 'weekend', shift)
                employee_days_seeded += 1
                day += timedelta(days=1)
                continue

            if day in holidays:
                _seed_non_working_summary(employee, day, 'holiday', shift)
                employee_days_seeded += 1
                day += timedelta(days=1)
                continue

            summary.working_days_considered += 1
            kind = _pick_day_kind(rng, scenario)
            if kind == 'overtime' and shift and not shift.overtime_allowed:
                kind = 'present'
            if kind == 'incomplete':
                created = _seed_incomplete_day(employee, day, shift, created_by=created_by)
            else:
                created = _seed_punch_day(employee, day, kind, shift, created_by=created_by)
            summary.punches_created += created
            employee_days_seeded += 1
            day += timedelta(days=1)

        if employee_days_seeded == 0:
            summary.employees_skipped.append({
                'employee_id': employee.employee_id,
                'reason': 'no_eligible_days_in_month',
            })
            continue

        _tally_summary(summary, employee, emp_start, effective_end)
        summary.employees_processed += 1
        logger.info(
            '[AttendanceSeeder] employee=%s month=%s-%s scenario=%s punches=%s',
            employee.employee_id,
            year,
            month,
            scenario,
            summary.punches_created,
        )

    return summary


def resolve_employees(
    *,
    employee_ids: list | None,
    hospital_id=None,
) -> list[Employee]:
    from apps.hr.models import EmployeeShift

    has_active_assignment = EmployeeShift.objects.filter(
        employee=OuterRef('pk'),
        shift__active=True,
    )
    qs = (
        Employee.objects.filter(status='active')
        .select_related('shift')
        .filter(Q(shift__isnull=False) | Exists(has_active_assignment))
    )
    if hospital_id:
        qs = qs.filter(hospital_id=hospital_id)
    if employee_ids:
        ids = [str(i) for i in employee_ids]
        return list(qs.filter(Q(pk__in=ids) | Q(employee_id__in=ids)))
    return list(qs)
