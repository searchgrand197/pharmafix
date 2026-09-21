"""
Attendance policy helpers — configurable rules shared by engine, control, and analytics.

Environment:
  ATTENDANCE_LATE_MINUTES_BASIS = shift_start | after_grace
    shift_start (default): minutes after scheduled shift start (common HR reporting).
    after_grace: minutes only after shift_start + grace_minutes (payroll-style).
"""
from __future__ import annotations

from datetime import date, datetime, time, timedelta
from zoneinfo import ZoneInfo

from django.conf import settings
from django.utils import timezone

LATE_MINUTES_BASIS_SHIFT_START = 'shift_start'
LATE_MINUTES_BASIS_AFTER_GRACE = 'after_grace'
ALLOWED_LATE_MINUTES_BASES = frozenset({LATE_MINUTES_BASIS_SHIFT_START, LATE_MINUTES_BASIS_AFTER_GRACE})

STATUS_IN_PROGRESS = 'in_progress'
STATUS_MISSING_CHECKOUT = 'missing_checkout'
STATUS_NOT_STARTED = 'not_started'


def get_late_minutes_basis() -> str:
    raw = str(getattr(settings, 'ATTENDANCE_LATE_MINUTES_BASIS', LATE_MINUTES_BASIS_SHIFT_START)).strip().lower()
    if raw not in ALLOWED_LATE_MINUTES_BASES:
        return LATE_MINUTES_BASIS_SHIFT_START
    return raw


def get_attendance_timezone() -> ZoneInfo:
    """Hospital attendance timezone — always settings.TIME_ZONE (not browser or server locale)."""
    return ZoneInfo(str(getattr(settings, 'TIME_ZONE', 'IST')))


def attendance_localtime(dt: datetime | None) -> datetime | None:
    if dt is None:
        return None
    return timezone.localtime(dt, get_attendance_timezone())


def combine_attendance_day_time(day: date, clock: time) -> datetime:
    naive = datetime.combine(day, clock)
    return timezone.make_aware(naive, get_attendance_timezone())


def parse_attendance_clock(value: str | time | None) -> time:
    if value is None or value == '':
        raise ValueError('Time is required.')
    if isinstance(value, time):
        return value
    raw = str(value).strip()
    for fmt in ('%H:%M:%S', '%H:%M'):
        try:
            return datetime.strptime(raw, fmt).time()
        except ValueError:
            continue
    raise ValueError(f'Invalid time value: {value!r}.')


def resolve_punch_timestamp(
    *,
    timestamp: datetime | None = None,
    punch_date: date | None = None,
    punch_time: str | time | None = None,
) -> datetime:
    """
    Build a timezone-aware punch instant in IST for storage.

    Prefer ``punch_date`` + ``punch_time`` (wall clock in attendance TZ).
    Naive ``timestamp`` values are interpreted as attendance-local wall clock.
    Aware ``timestamp`` values are kept as the same instant (legacy API clients).
    """
    tz = get_attendance_timezone()
    if punch_date is not None and punch_time is not None:
        return combine_attendance_day_time(punch_date, parse_attendance_clock(punch_time))
    if timestamp is None:
        return timezone.now()
    if timezone.is_naive(timestamp):
        return timezone.make_aware(timestamp, tz)
    return timestamp


def policy_documentation() -> dict:
    basis = get_late_minutes_basis()
    tz_name = str(get_attendance_timezone())
    return {
        'attendance_timezone': tz_name,
        'late_minutes_basis': basis,
        'late_minutes_basis_description': (
            'Minutes counted after scheduled shift start.'
            if basis == LATE_MINUTES_BASIS_SHIFT_START
            else 'Minutes counted only after grace period ends.'
        ),
        'open_checkout_before_shift_end': STATUS_IN_PROGRESS,
        'open_checkout_after_shift_end': STATUS_MISSING_CHECKOUT,
        'no_punch_before_absence_deadline': STATUS_NOT_STARTED,
        'no_punch_after_absence_deadline': 'absent',
        'early_arrival_credits_from_shift_start': True,
        'default_early_punch_minutes': 240,
        'django_timezone': tz_name,
        'use_tz': bool(getattr(settings, 'USE_TZ', True)),
    }


def aware_on_day(day: date, clock: time) -> datetime:
    return combine_attendance_day_time(day, clock)


def shift_start_datetime(day: date, shift) -> datetime | None:
    if not shift or not shift.start_time:
        return None
    return aware_on_day(day, shift.start_time)


def shift_end_datetime(day: date, shift) -> datetime | None:
    if not shift or not shift.end_time:
        return None
    end_day = day + timedelta(days=1) if getattr(shift, 'is_overnight', False) else day
    return aware_on_day(end_day, shift.end_time)


def absence_deadline_datetime(day: date, shift) -> datetime | None:
    """Shift start + grace — no-show is evaluated only after this instant on the attendance day."""
    start_at = shift_start_datetime(day, shift)
    if start_at is None:
        return None
    grace = int(getattr(shift, 'grace_minutes', None) or 0)
    return start_at + timedelta(minutes=grace)


def shift_early_punch_minutes(shift) -> int:
    """How many minutes before shift start punches are accepted (default 240 = 4h)."""
    raw = getattr(shift, 'early_punch_minutes', None)
    if raw is None:
        return 240
    return max(0, int(raw))


def earliest_punch_datetime(day: date, shift) -> datetime | None:
    """Earliest allowed punch instant for a scheduled shift day."""
    start_at = shift_start_datetime(day, shift)
    if start_at is None:
        return None
    return start_at - timedelta(minutes=shift_early_punch_minutes(shift))


def is_early_arrival(first_check_in: datetime | None, day: date, shift) -> bool:
    """True when check-in is before scheduled shift start."""
    start_at = shift_start_datetime(day, shift)
    if not first_check_in or not start_at:
        return False
    return first_check_in < start_at


def is_punch_before_earliest_window(timestamp: datetime, day: date, shift) -> bool:
    """True when punch is earlier than the configured pre-shift acceptance window."""
    earliest = earliest_punch_datetime(day, shift)
    if earliest is None:
        return False
    return timestamp < earliest


def is_shift_end_passed(day: date, shift, *, now: datetime | None = None) -> bool:
    """True when local now is at or after scheduled shift end for this working day."""
    now = now or timezone.now()
    local_now = attendance_localtime(now)
    if day < local_now.date():
        return True
    if day > local_now.date():
        return False
    end_at = shift_end_datetime(day, shift)
    if end_at is None:
        return False
    return local_now >= end_at


def compute_late_metrics(
    first_check_in: datetime | None,
    shift_start: datetime | None,
    grace_minutes: int,
) -> tuple[int, bool]:
    """
    Return (late_minutes, is_late_for_status).
    is_late_for_status drives attendance_status == 'late' when day is otherwise complete.
    """
    if not first_check_in or not shift_start:
        return 0, False
    grace = int(grace_minutes or 0)
    grace_deadline = shift_start + timedelta(minutes=grace)
    basis = get_late_minutes_basis()

    if basis == LATE_MINUTES_BASIS_AFTER_GRACE:
        if first_check_in <= grace_deadline:
            return 0, False
        late_minutes = int((first_check_in - grace_deadline).total_seconds() // 60)
        return max(0, late_minutes), True

    if first_check_in <= shift_start:
        return 0, False
    late_minutes = int((first_check_in - shift_start).total_seconds() // 60)
    is_late = first_check_in > grace_deadline
    return max(0, late_minutes), is_late


def is_absence_deadline_passed(day: date, shift, *, now: datetime | None = None) -> bool:
    """True when a scheduled employee with no punches should count as absent."""
    now = now or timezone.now()
    local_now = attendance_localtime(now)
    if day < local_now.date():
        return True
    if day > local_now.date():
        return False
    deadline = absence_deadline_datetime(day, shift)
    if deadline is None:
        return True
    return local_now >= deadline


def resolve_no_punch_status(day: date, shift, *, now: datetime | None = None) -> str:
    """No punches yet: not_started before shift+grace on today, absent otherwise."""
    if is_absence_deadline_passed(day, shift, now=now):
        return 'absent'
    return STATUS_NOT_STARTED


def resolve_open_checkout_status(day: date, shift, *, now: datetime | None = None) -> str:
    if is_shift_end_passed(day, shift, now=now):
        return STATUS_MISSING_CHECKOUT
    return STATUS_IN_PROGRESS
