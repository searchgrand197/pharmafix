"""Punch pairing helpers shared by biometric ingestion."""

from __future__ import annotations

from datetime import date, datetime, time, timedelta

from django.db.models import Q
from django.utils import timezone

from apps.hr.attendance_policy import attendance_localtime, combine_attendance_day_time
from apps.hr.models import AttendancePunch, Employee, Shift

# Cover any overnight shift when deciding the next IN/OUT alternation.
ALTERNATION_LOOKBACK_HOURS = 36


def models_q_attendance_date(work_date: date):
    return Q(attendance_date=work_date) | Q(attendance_date__isnull=True, timestamp__date=work_date)


def punches_for_work_date(employee: Employee, work_date: date) -> list[AttendancePunch]:
    return list(
        AttendancePunch.objects.filter(employee=employee, is_void=False)
        .filter(models_q_attendance_date(work_date))
        .order_by('timestamp')
    )


def open_in_punch(punches: list[AttendancePunch]) -> AttendancePunch | None:
    """Most recent open IN that has not been closed by a non-suspicious OUT."""
    open_in: AttendancePunch | None = None
    for punch in punches:
        if punch.is_suspicious:
            continue
        if punch.punch_type == 'IN':
            open_in = punch
        elif punch.punch_type == 'OUT' and open_in is not None:
            open_in = None
    return open_in


def suggest_next_punch_type(punches: list[AttendancePunch]) -> str:
    """Next tap on device: OUT if an open IN session exists, else IN."""
    return 'OUT' if open_in_punch(punches) is not None else 'IN'


def _overnight_out_attendance_date(local_ts: datetime, shift: Shift) -> date:
    """
    For orphan OUT punches on overnight shifts (no open IN in context):
    assign to the previous calendar day only in the post-midnight checkout window
    (after shift end through before shift start), e.g. 00:05 after an 18:00–00:00 shift.
    """
    checkout_time = local_ts.time()
    if shift.end_time < shift.start_time:
        if shift.end_time < checkout_time < shift.start_time:
            return (local_ts - timedelta(days=1)).date()
    elif checkout_time <= shift.end_time:
        return (local_ts - timedelta(days=1)).date()
    return local_ts.date()


def attendance_date_for(
    employee: Employee,
    timestamp: datetime,
    punch_type: str,
    shift: Shift | None = None,
    prior_punches: list[AttendancePunch] | None = None,
) -> date:
    shift = shift or employee.shift
    local_ts = attendance_localtime(timestamp)
    attendance_date = local_ts.date()

    if punch_type == 'OUT' and prior_punches:
        open_in = open_in_punch(prior_punches)
        if open_in is not None:
            return open_in.attendance_date or attendance_localtime(open_in.timestamp).date()

    if (
        shift
        and shift.is_overnight
        and shift.start_time
        and shift.end_time
        and punch_type == 'OUT'
    ):
        attendance_date = _overnight_out_attendance_date(local_ts, shift)
    return attendance_date


def assert_employee_punchable(employee: Employee) -> None:
    if employee.status != 'active':
        raise ValueError(f'Employee is not active (status={employee.status}).')


def recent_punches_for_alternation(employee: Employee, timestamp: datetime) -> list[AttendancePunch]:
    """Recent punches used to derive the next IN/OUT for a new device tap."""
    lookback_start = timestamp - timedelta(hours=ALTERNATION_LOOKBACK_HOURS)
    return list(
        AttendancePunch.objects.filter(
            employee=employee,
            is_void=False,
            timestamp__gte=lookback_start,
            timestamp__lte=timestamp,
        ).order_by('timestamp', 'created_at')
    )


def resequence_biometric_punch_window(
    employee: Employee,
    anchor_timestamp: datetime,
    *,
    window_hours: int = ALTERNATION_LOOKBACK_HOURS,
) -> dict:
    """
    Recompute punch types and attendance dates for biometric punches around an
    out-of-order ingest so later stored rows stay consistent with chronological history.

    Automatic resequencing is intentionally skipped when manual/import/app punches
    are mixed into the same time window because those rows are curated and should
    be reviewed by HR instead of rewritten.
    """
    window_start = anchor_timestamp - timedelta(hours=window_hours)
    window_end = anchor_timestamp + timedelta(hours=window_hours)
    mixed_sources = AttendancePunch.objects.filter(
        employee=employee,
        is_void=False,
        timestamp__gte=window_start,
        timestamp__lte=window_end,
    ).exclude(source='biometric').exists()
    if mixed_sources:
        return {
            'blocked_reason': 'mixed_sources',
            'changed_count': 0,
            'affected_dates': set(),
        }

    punches = list(
        AttendancePunch.objects.filter(
            employee=employee,
            source='biometric',
            is_void=False,
            timestamp__gte=window_start,
            timestamp__lte=window_end,
        )
        .select_related('shift')
        .order_by('timestamp', 'created_at')
    )
    prior: list[AttendancePunch] = []
    changed_count = 0
    affected_dates: set[date] = set()

    for punch in punches:
        current_date = punch.attendance_date
        new_type = suggest_next_punch_type(prior)
        new_date = attendance_date_for(
            employee,
            punch.timestamp,
            new_type,
            punch.shift or employee.shift,
            prior_punches=prior,
        )
        changed_fields = []
        if punch.punch_type != new_type:
            punch.punch_type = new_type
            changed_fields.append('punch_type')
        if current_date != new_date:
            punch.attendance_date = new_date
            changed_fields.append('attendance_date')
        if changed_fields:
            punch.save(update_fields=changed_fields + ['updated_at'])
            changed_count += 1
        if current_date:
            affected_dates.add(current_date)
        if new_date:
            affected_dates.add(new_date)
        prior.append(punch)

    return {
        'blocked_reason': None,
        'changed_count': changed_count,
        'affected_dates': affected_dates,
    }


def out_timestamp(work_date: date, shift: Shift | None, check_out: time) -> datetime:
    if shift and shift.is_overnight and shift.end_time and check_out <= shift.end_time:
        return combine_attendance_day_time(work_date + timedelta(days=1), check_out)
    return combine_attendance_day_time(work_date, check_out)
