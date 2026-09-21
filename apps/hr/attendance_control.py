"""
HR attendance control — biometric device simulation.

- ``record_simulation_punch``: shared punch creation + recalc (simulator + bulk mark).
- ``simulate_biometric_punch``: one IN or OUT (default timestamp = now; optional override).
- ``mark_attendance_via_biometric_simulation``: bulk day mark with explicit check-in/out times.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta
from decimal import Decimal

from django.db import transaction
from django.utils import timezone

from apps.hr.attendance_engine import pair_punches, recalculate_daily_attendance, recalculate_for_punch
from apps.hr.attendance_policy import (
    attendance_localtime,
    combine_attendance_day_time,
    resolve_punch_timestamp,
)
from apps.hr.models import (
    AttendanceControlAuditLog,
    AttendancePunch,
    DailyAttendance,
    Employee,
    Shift,
)

logger = logging.getLogger(__name__)

MARK_STATUSES = frozenset({'PRESENT', 'ABSENT', 'LATE', 'HALF_DAY'})
PUNCH_STATUSES = frozenset({'PRESENT', 'LATE', 'HALF_DAY'})
SOURCE = AttendancePunch.SOURCE_MANUAL_BIOMETRIC_SIMULATION
DEVICE_ID = 'BIO_SIM'


class AttendanceControlError(Exception):
    def __init__(self, message: str, code: str = 'invalid_request'):
        super().__init__(message)
        self.code = code
        self.message = message


@dataclass(frozen=True)
class SimulatePunchResult:
    employee_id: str
    punch_id: str
    punch_type: str
    timestamp: str
    local_time: str
    attendance_date: str
    suggested_next_punch_type: str
    today_punches: list[dict]
    daily_attendance: dict | None


@dataclass(frozen=True)
class MarkAttendanceResult:
    employee_id: str
    date: str
    requested_status: str
    attendance_status: str
    punch_ids: list[str]
    daily_attendance_id: str | None
    audit_log_id: str


def _parse_time_value(value: str | time | None) -> time | None:
    if value is None or value == '':
        return None
    if isinstance(value, time):
        return value
    raw = str(value).strip()
    for fmt in ('%H:%M:%S', '%H:%M'):
        try:
            return datetime.strptime(raw, fmt).time()
        except ValueError:
            continue
    raise AttendanceControlError(f'Invalid time value: {value!r}.', code='invalid_time')


def _aware_datetime(work_date: date, clock: time) -> datetime:
    return combine_attendance_day_time(work_date, clock)


def _add_hours_to_time(start: time, hours: Decimal | float) -> time:
    base = datetime.combine(date.today(), start)
    end = base + timedelta(hours=float(hours))
    return end.time()


def _attendance_date_for(
    employee: Employee,
    timestamp: datetime,
    punch_type: str,
    shift: Shift | None = None,
) -> date:
    shift = shift or employee.shift
    local_ts = attendance_localtime(timestamp)
    attendance_date = local_ts.date()
    if (
        shift
        and shift.is_overnight
        and shift.start_time
        and shift.end_time
        and punch_type == 'OUT'
        and local_ts.time() <= shift.end_time
    ):
        attendance_date = (local_ts - timedelta(days=1)).date()
    return attendance_date


def _out_timestamp(work_date: date, shift: Shift | None, check_out: time) -> datetime:
    if shift and shift.is_overnight and shift.end_time and check_out <= shift.end_time:
        return _aware_datetime(work_date + timedelta(days=1), check_out)
    return _aware_datetime(work_date, check_out)


def _resolve_check_times(
    *,
    work_date: date,
    status: str,
    shift: Shift | None,
    check_in: str | time | None,
    check_out: str | time | None,
) -> tuple[time, time]:
    parsed_in = _parse_time_value(check_in)
    parsed_out = _parse_time_value(check_out)

    if parsed_in and parsed_out:
        if parsed_out <= parsed_in and not (shift and shift.is_overnight):
            raise AttendanceControlError('check_out must be after check_in.', code='invalid_time_range')
        return parsed_in, parsed_out

    if shift and shift.start_time and shift.end_time:
        start = shift.start_time
        end = shift.end_time
        grace = int(shift.grace_minutes or 0)
        half_hours = Decimal(str(shift.half_day_hours or 4))

        if status == 'LATE':
            default_in = (_aware_datetime(work_date, start) + timedelta(minutes=grace + 1)).time()
            default_out = end
        elif status == 'HALF_DAY':
            default_in = start
            default_out = _add_hours_to_time(start, half_hours)
        else:
            default_in = start
            default_out = end

        return parsed_in or default_in, parsed_out or default_out

    if status == 'HALF_DAY':
        return parsed_in or time(9, 0), parsed_out or time(13, 0)
    if status == 'LATE':
        return parsed_in or time(9, 15), parsed_out or time(18, 0)
    return parsed_in or time(9, 0), parsed_out or time(18, 0)


def _employee_for_request(*, employee_id, hospital_id=None) -> Employee:
    qs = Employee.objects.select_related('shift', 'hospital')
    try:
        employee = qs.get(pk=employee_id)
    except (Employee.DoesNotExist, ValueError, TypeError):
        employee = qs.filter(employee_id=str(employee_id)).first()
    if not employee:
        raise AttendanceControlError('Employee not found.', code='employee_not_found')
    if hospital_id and employee.hospital_id and str(employee.hospital_id) != str(hospital_id):
        raise AttendanceControlError('Employee is outside your hospital scope.', code='forbidden')
    return employee


def _assert_employee_active(employee: Employee) -> None:
    if employee.status != 'active':
        raise AttendanceControlError(
            f'Employee is not active (status={employee.status}).',
            code='employee_inactive',
        )


def _assert_not_future(work_date: date) -> None:
    if work_date > timezone.localdate():
        raise AttendanceControlError('Future attendance dates are not allowed.', code='future_date')


def _existing_punches(employee: Employee, work_date: date):
    return AttendancePunch.objects.filter(
        employee=employee,
        is_void=False,
    ).filter(
        models_q_attendance_date(work_date),
    )


def models_q_attendance_date(work_date: date):
    from django.db.models import Q

    return Q(attendance_date=work_date) | Q(attendance_date__isnull=True, timestamp__date=work_date)


def _assert_attendance_not_locked(employee: Employee, work_date: date) -> None:
    daily = DailyAttendance.objects.filter(employee=employee, date=work_date).first()
    if daily and (daily.calculation_locked or daily.manually_corrected):
        raise AttendanceControlError(
            'Daily attendance is locked or manually corrected; cannot overwrite via simulation.',
            code='attendance_locked',
        )


def _clear_day_for_remark(employee: Employee, work_date: date) -> None:
    """Void existing punches and unlock the day so HR can replace check-in/out."""
    now = timezone.now()
    for punch in _existing_punches(employee, work_date):
        punch.is_void = True
        punch.void_reason = 'Replaced via attendance control remark.'
        punch.voided_at = now
        punch.save(update_fields=['is_void', 'void_reason', 'voided_at', 'updated_at'])

    AttendanceControlAuditLog.objects.filter(
        employee=employee,
        attendance_date=work_date,
        action=AttendanceControlAuditLog.ACTION_MARK,
    ).delete()

    daily = DailyAttendance.objects.filter(employee=employee, date=work_date).first()
    if daily:
        daily.calculation_locked = False
        daily.manually_corrected = False
        daily.save(update_fields=['calculation_locked', 'manually_corrected', 'updated_at'])

    recalculate_daily_attendance(employee, work_date, force=True)


def _assert_no_existing_mark(employee: Employee, work_date: date) -> None:
    if AttendanceControlAuditLog.objects.filter(
        employee=employee,
        attendance_date=work_date,
        action=AttendanceControlAuditLog.ACTION_MARK,
        success=True,
    ).exists():
        raise AttendanceControlError(
            'Attendance for this employee and date was already marked via attendance control.',
            code='duplicate_mark',
        )

    if _existing_punches(employee, work_date).exists():
        raise AttendanceControlError(
            'Attendance punches already exist for this employee and date.',
            code='duplicate_punches',
        )

    _assert_attendance_not_locked(employee, work_date)


def punches_for_work_date(employee: Employee, work_date: date):
    return list(
        AttendancePunch.objects.filter(employee=employee, is_void=False)
        .filter(models_q_attendance_date(work_date))
        .order_by('timestamp')
    )


def suggest_next_punch_type(punches: list[AttendancePunch]) -> str:
    """Next tap on device: OUT if an open IN session exists, else IN."""
    open_in = None
    for punch in punches:
        if punch.is_suspicious:
            continue
        if punch.punch_type == 'IN':
            open_in = punch
        elif punch.punch_type == 'OUT' and open_in is not None:
            open_in = None
    return 'OUT' if open_in is not None else 'IN'


def _serialize_punch_row(punch: AttendancePunch) -> dict:
    local_ts = attendance_localtime(punch.timestamp)
    return {
        'id': str(punch.id),
        'punch_type': punch.punch_type,
        'timestamp': punch.timestamp.isoformat(),
        'local_timestamp': local_ts.isoformat() if local_ts else None,
        'local_time': local_ts.strftime('%H:%M') if local_ts else None,
        'source': punch.source,
        'device_id': punch.device_id or '',
        'is_suspicious': punch.is_suspicious,
        'suspicious_reason': punch.suspicious_reason or '',
    }


def _serialize_daily_summary(daily: DailyAttendance | None) -> dict | None:
    if not daily:
        return None
    return {
        'id': str(daily.id),
        'date': daily.date.isoformat(),
        'attendance_status': daily.attendance_status,
        'first_check_in': daily.first_check_in.isoformat() if daily.first_check_in else None,
        'last_check_out': daily.last_check_out.isoformat() if daily.last_check_out else None,
        'total_work_hours': str(daily.total_work_hours) if daily.total_work_hours is not None else None,
        'late_minutes': daily.late_minutes,
        'incomplete_checkout': daily.incomplete_checkout,
        'requires_hr_review': daily.requires_hr_review,
        'attendance_source': daily.attendance_source,
    }


def get_employee_punch_console_state(
    *,
    employee_id,
    work_date: date | None = None,
    hospital_id=None,
) -> dict:
    work_date = work_date or timezone.localdate()
    employee = _employee_for_request(employee_id=employee_id, hospital_id=hospital_id)
    punches = punches_for_work_date(employee, work_date)
    daily = DailyAttendance.objects.filter(employee=employee, date=work_date).first()
    sessions, invalid = pair_punches(punches)
    return {
        'employee_id': str(employee.id),
        'employee_code': employee.employee_id,
        'employee_name': employee.name,
        'employee_status': employee.status,
        'shift_name': getattr(employee.shift, 'name', None) if employee.shift_id else None,
        'work_date': work_date.isoformat(),
        'suggested_next_punch_type': suggest_next_punch_type(punches),
        'today_punches': [_serialize_punch_row(p) for p in punches],
        'paired_sessions': len(sessions),
        'invalid_punches': invalid,
        'daily_attendance': _serialize_daily_summary(daily),
        'can_punch': employee.status == 'active' and work_date <= timezone.localdate(),
    }


def record_simulation_punch(
    *,
    employee: Employee,
    punch_type: str,
    timestamp: datetime,
    created_by=None,
    notes: str = '',
) -> AttendancePunch:
    """
    Create one biometric-simulation punch and recalculate the working day.
    Used by both live simulator taps and bulk day marks.
    """
    timestamp = resolve_punch_timestamp(timestamp=timestamp)
    work_date = attendance_localtime(timestamp).date()
    _assert_not_future(work_date)

    punch = AttendancePunch.objects.create(
        employee=employee,
        shift=employee.shift,
        attendance_date=_attendance_date_for(employee, timestamp, punch_type),
        timestamp=timestamp,
        punch_type=punch_type,
        source=SOURCE,
        device_id=DEVICE_ID,
        notes=notes or 'Biometric device simulation.',
        created_by=created_by,
    )
    recalculate_for_punch(punch, force=True)
    return punch


@transaction.atomic
def simulate_biometric_punch(
    *,
    employee_id,
    punch_type: str,
    timestamp: datetime | None = None,
    punch_date: date | None = None,
    punch_time: str | time | None = None,
    marked_by=None,
    hospital_id=None,
) -> SimulatePunchResult:
    """
    Record a single biometric tap (IN or OUT) at the current time, then recalculate the day.
    """
    punch_type = str(punch_type or '').strip().upper()
    if punch_type not in {'IN', 'OUT'}:
        raise AttendanceControlError(
            f'Unsupported punch_type {punch_type!r}. Use IN or OUT.',
            code='invalid_punch_type',
        )

    employee = _employee_for_request(employee_id=employee_id, hospital_id=hospital_id)
    _assert_employee_active(employee)

    if punch_date is None or not punch_time:
        raise AttendanceControlError(
            'punch_date and punch_time are required for simulator taps (use PC/device wall clock).',
            code='missing_punch_time',
        )
    ts = resolve_punch_timestamp(
        timestamp=timestamp,
        punch_date=punch_date,
        punch_time=punch_time,
    )
    punch = record_simulation_punch(
        employee=employee,
        punch_type=punch_type,
        timestamp=ts,
        created_by=marked_by,
        notes='Biometric device simulation tap.',
    )
    work_date = attendance_localtime(punch.timestamp).date()
    logger.info(
        '[AttendanceControl] device punch employee=%s type=%s punch=%s at=%s by=%s',
        employee.id,
        punch_type,
        punch.id,
        punch.timestamp.isoformat(),
        getattr(marked_by, 'id', None),
    )
    punches = punches_for_work_date(employee, work_date)
    daily = DailyAttendance.objects.filter(employee=employee, date=work_date).first()
    punch_local = attendance_localtime(punch.timestamp)

    return SimulatePunchResult(
        employee_id=str(employee.id),
        punch_id=str(punch.id),
        punch_type=punch.punch_type,
        timestamp=punch.timestamp.isoformat(),
        local_time=punch_local.strftime('%H:%M') if punch_local else '',
        attendance_date=punch.attendance_date.isoformat() if punch.attendance_date else work_date.isoformat(),
        suggested_next_punch_type=suggest_next_punch_type(punches),
        today_punches=[_serialize_punch_row(p) for p in punches],
        daily_attendance=_serialize_daily_summary(daily),
    )


def _write_audit_log(
    *,
    employee: Employee,
    work_date: date,
    requested_status: str,
    marked_by,
    payload: dict,
    punch_ids: list,
    daily_attendance,
    result_status: str,
    success: bool,
    error_message: str = '',
) -> AttendanceControlAuditLog:
    return AttendanceControlAuditLog.objects.create(
        employee=employee,
        attendance_date=work_date,
        requested_status=requested_status,
        action=AttendanceControlAuditLog.ACTION_MARK,
        marked_by=marked_by,
        payload=payload,
        punch_ids=punch_ids,
        daily_attendance=daily_attendance,
        result_status=result_status,
        success=success,
        error_message=error_message,
    )


@transaction.atomic
def mark_attendance_via_biometric_simulation(
    *,
    employee_id,
    work_date: date,
    status: str,
    check_in=None,
    check_out=None,
    marked_by=None,
    hospital_id=None,
    replace_existing: bool = False,
) -> MarkAttendanceResult:
    """
    Mark attendance for one employee/day using real punches + engine recalculation.
    """
    status = str(status or '').strip().upper()
    if status not in MARK_STATUSES:
        raise AttendanceControlError(
            f'Unsupported status {status!r}. Use one of: {", ".join(sorted(MARK_STATUSES))}.',
            code='invalid_status',
        )

    employee = _employee_for_request(employee_id=employee_id, hospital_id=hospital_id)
    _assert_employee_active(employee)
    _assert_not_future(work_date)
    if replace_existing:
        _assert_attendance_not_locked(employee, work_date)
        _clear_day_for_remark(employee, work_date)
    else:
        _assert_no_existing_mark(employee, work_date)

    payload = {
        'employee_id': str(employee.id),
        'employee_code': employee.employee_id,
        'date': work_date.isoformat(),
        'status': status,
        'check_in': str(check_in) if check_in is not None else None,
        'check_out': str(check_out) if check_out is not None else None,
        'replace_existing': replace_existing,
    }

    punch_ids: list[str] = []
    shift = employee.shift

    try:
        if status in PUNCH_STATUSES:
            check_in_time, check_out_time = _resolve_check_times(
                work_date=work_date,
                status=status,
                shift=shift,
                check_in=check_in,
                check_out=check_out,
            )
            in_ts = _aware_datetime(work_date, check_in_time)
            out_ts = _out_timestamp(work_date, shift, check_out_time)
            if out_ts <= in_ts and not (shift and shift.is_overnight):
                raise AttendanceControlError('check_out must be after check_in.', code='invalid_time_range')

            in_punch = record_simulation_punch(
                employee=employee,
                punch_type='IN',
                timestamp=in_ts,
                created_by=marked_by,
                notes=f'Biometric simulation mark ({status}).',
            )
            out_punch = record_simulation_punch(
                employee=employee,
                punch_type='OUT',
                timestamp=out_ts,
                created_by=marked_by,
                notes=f'Biometric simulation mark ({status}).',
            )
            punch_ids = [str(in_punch.id), str(out_punch.id)]
            logger.info(
                '[AttendanceControl] punches created employee=%s date=%s in=%s out=%s by=%s',
                employee.id,
                work_date,
                in_punch.id,
                out_punch.id,
                getattr(marked_by, 'id', None),
            )

        attendance, calculated = recalculate_daily_attendance(employee, work_date, force=True)
        if status == 'ABSENT' and not punch_ids:
            attendance.attendance_status = 'absent'
            attendance.manually_corrected = True
            attendance.save(update_fields=['attendance_status', 'manually_corrected', 'updated_at'])
        result_status = calculated.get('attendance_status') or attendance.attendance_status
        if status == 'ABSENT' and not punch_ids:
            result_status = 'absent'
        # record_simulation_punch already recalculated after each punch; final pass ensures consistency.

        audit = _write_audit_log(
            employee=employee,
            work_date=work_date,
            requested_status=status,
            marked_by=marked_by,
            payload=payload,
            punch_ids=punch_ids,
            daily_attendance=attendance,
            result_status=result_status,
            success=True,
        )
        logger.info(
            '[AttendanceControl] marked employee=%s date=%s requested=%s result=%s audit=%s by=%s',
            employee.id,
            work_date,
            status,
            result_status,
            audit.id,
            getattr(marked_by, 'id', None),
        )
        return MarkAttendanceResult(
            employee_id=str(employee.id),
            date=work_date.isoformat(),
            requested_status=status,
            attendance_status=result_status,
            punch_ids=punch_ids,
            daily_attendance_id=str(attendance.id),
            audit_log_id=str(audit.id),
        )
    except AttendanceControlError as exc:
        _write_audit_log(
            employee=employee,
            work_date=work_date,
            requested_status=status,
            marked_by=marked_by,
            payload=payload,
            punch_ids=punch_ids,
            daily_attendance=None,
            result_status='',
            success=False,
            error_message=exc.message,
        )
        logger.warning(
            '[AttendanceControl] mark failed employee=%s date=%s status=%s code=%s msg=%s by=%s',
            employee.id,
            work_date,
            status,
            exc.code,
            exc.message,
            getattr(marked_by, 'id', None),
        )
        raise
