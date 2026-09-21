from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta
from decimal import Decimal, ROUND_HALF_UP

from django.db import transaction
from django.db.models import Q
from django.utils import timezone

from apps.hr.attendance_policy import (
    STATUS_IN_PROGRESS,
    STATUS_MISSING_CHECKOUT,
    attendance_localtime,
    combine_attendance_day_time,
    compute_late_metrics,
    get_late_minutes_basis,
    policy_documentation,
    resolve_no_punch_status,
    resolve_open_checkout_status,
)
from apps.hr.models import AttendancePunch, DailyAttendance, Employee, EmployeeShift, LeaveRequest, Shift

logger = logging.getLogger(__name__)

PUNCH_SOURCE_TO_ATTENDANCE_SOURCE = {
    'HR_manual': 'HR_MANUAL',
    'MANUAL_BIOMETRIC_SIMULATION': 'MANUAL_BIOMETRIC_SIMULATION',
    'biometric': 'BIOMETRIC_DEVICE',
    'employee_portal': 'EMPLOYEE_PORTAL',
    'import': 'IMPORT',
    'system': 'SYSTEM',
}


@dataclass(frozen=True)
class PunchSession:
    check_in: datetime
    check_out: datetime

    @property
    def seconds(self) -> int:
        return max(0, int((self.check_out - self.check_in).total_seconds()))


def _decimal_hours(seconds: int) -> Decimal:
    return (Decimal(seconds) / Decimal(3600)).quantize(Decimal('0.01'), rounding=ROUND_HALF_UP)


def _aware_for_day(day: date, clock: time) -> datetime:
    return combine_attendance_day_time(day, clock)


def _shift_window(day: date, shift: Shift | None) -> tuple[datetime, datetime]:
    """
    Query window for raw punches. Overnight shifts include next-day checkout.
    A small buffer is intentionally included so manual/imported punches near edges are available.
    """
    if shift and shift.start_time and shift.end_time:
        from apps.hr.attendance_policy import shift_early_punch_minutes

        early_mins = shift_early_punch_minutes(shift)
        start_at = _aware_for_day(day, shift.start_time) - timedelta(minutes=early_mins)
        end_day = day + timedelta(days=1) if shift.is_overnight else day
        # Include post-shift OT checkout (seeder extends up to 3h past end).
        end_at = _aware_for_day(end_day, shift.end_time) + timedelta(hours=4)
        if shift.overtime_allowed:
            end_at += timedelta(hours=2)
        return start_at, end_at
    start_at = _aware_for_day(day, time.min)
    end_at = _aware_for_day(day, time.max)
    return start_at, end_at


def _derived_working_date_for_punch(punch: AttendancePunch, shift: Shift | None) -> date:
    if punch.attendance_date:
        return punch.attendance_date
    local_ts = attendance_localtime(punch.timestamp)
    if (
        shift
        and shift.is_overnight
        and shift.start_time
        and shift.end_time
        and punch.punch_type == 'OUT'
    ):
        from apps.hr.biometric.punch_pairing import _overnight_out_attendance_date

        return _overnight_out_attendance_date(local_ts, shift)
    return local_ts.date()


def _working_day_for_punch(punch: AttendancePunch, day: date, shift: Shift | None) -> bool:
    derived_day = _derived_working_date_for_punch(punch, shift)
    return derived_day == day or punch.attendance_date == day


def get_engine_punches(employee: Employee, day: date, shift: Shift | None = None):
    shift = shift or employee.shift
    window_start, window_end = _shift_window(day, shift)
    punches = [
        punch
        for punch in AttendancePunch.objects.filter(
            employee=employee,
            timestamp__gte=window_start,
            timestamp__lte=window_end,
            is_void=False,
        )
        .select_related('shift')
        .order_by('timestamp', 'created_at')
        if _working_day_for_punch(punch, day, shift)
    ]
    logger.debug(
        '[AttendanceEngine] fetched punches employee=%s date=%s shift=%s count=%s',
        employee.id,
        day,
        getattr(shift, 'id', None),
        len(punches),
    )
    return punches


def pair_punches(punches: list[AttendancePunch]) -> tuple[list[PunchSession], list[dict]]:
    sessions: list[PunchSession] = []
    invalid: list[dict] = []
    open_in: AttendancePunch | None = None

    for punch in punches:
        if punch.is_suspicious:
            invalid.append({
                'punch_id': str(punch.id),
                'type': punch.punch_type,
                'timestamp': punch.timestamp.isoformat(),
                'reason': 'suspicious_duplicate_ignored',
            })
            continue

        if punch.punch_type == 'IN':
            if open_in is not None:
                invalid.append({
                    'punch_id': str(open_in.id),
                    'type': open_in.punch_type,
                    'timestamp': open_in.timestamp.isoformat(),
                    'reason': 'consecutive_in_without_checkout',
                })
            open_in = punch
            continue

        if punch.punch_type == 'OUT':
            if open_in is None:
                invalid.append({
                    'punch_id': str(punch.id),
                    'type': punch.punch_type,
                    'timestamp': punch.timestamp.isoformat(),
                    'reason': 'out_without_matching_in',
                })
                continue
            if punch.timestamp <= open_in.timestamp:
                invalid.append({
                    'punch_id': str(punch.id),
                    'type': punch.punch_type,
                    'timestamp': punch.timestamp.isoformat(),
                    'reason': 'checkout_before_checkin',
                })
                open_in = None
                continue
            sessions.append(PunchSession(check_in=open_in.timestamp, check_out=punch.timestamp))
            open_in = None

    if open_in is not None:
        invalid.append({
            'punch_id': str(open_in.id),
            'type': open_in.punch_type,
            'timestamp': open_in.timestamp.isoformat(),
            'reason': 'missing_checkout',
        })

    logger.debug(
        '[AttendanceEngine] paired sessions=%s invalid=%s',
        [
            {
                'check_in': session.check_in.isoformat(),
                'check_out': session.check_out.isoformat(),
                'seconds': session.seconds,
            }
            for session in sessions
        ],
        invalid,
    )
    return sessions, invalid


def _resolve_attendance_source(punches: list[AttendancePunch]) -> str:
    sources = {
        PUNCH_SOURCE_TO_ATTENDANCE_SOURCE.get(p.source, 'IMPORT')
        for p in punches
        if not p.is_suspicious
    }
    sources.discard(None)
    if not sources:
        return 'NONE'
    if len(sources) == 1:
        return next(iter(sources))
    return 'MIXED'


def _scheduled_shift_hours(shift: Shift | None) -> Decimal | None:
    """Scheduled shift span (start → end), excluding pre/post shift grace."""
    if not shift or not shift.start_time or not shift.end_time:
        return None
    start = datetime.combine(date.min, shift.start_time)
    end = datetime.combine(date.min, shift.end_time)
    if shift.is_overnight or end <= start:
        end += timedelta(days=1)
    seconds = max(0, int((end - start).total_seconds()))
    return _decimal_hours(seconds)


def _coerce_aware_timestamp(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    if timezone.is_naive(value):
        from apps.hr.attendance_policy import resolve_punch_timestamp

        return resolve_punch_timestamp(timestamp=value)
    return value


def _credited_work_hours(
    first_check_in: datetime | None,
    last_check_out: datetime | None,
    shift: Shift | None,
    day: date,
    *,
    raw_seconds: int = 0,
) -> Decimal:
    """
    Payable/display work hours. When a shift exists, time before shift start is excluded
    (same rule as overtime calculation).
    """
    first_check_in = _coerce_aware_timestamp(first_check_in)
    last_check_out = _coerce_aware_timestamp(last_check_out)
    if shift and shift.start_time and first_check_in and last_check_out:
        shift_start = _aware_for_day(day, shift.start_time)
        work_start = max(first_check_in, shift_start)
        if last_check_out > work_start:
            return _decimal_hours(int((last_check_out - work_start).total_seconds()))
        return Decimal('0.00')
    if raw_seconds > 0:
        return _decimal_hours(raw_seconds)
    if first_check_in and last_check_out and last_check_out > first_check_in:
        return _decimal_hours(int((last_check_out - first_check_in).total_seconds()))
    return Decimal('0.00')


def _compute_overtime_hours(
    *,
    total_hours: Decimal,
    full_day_hours: Decimal,
    shift: Shift | None,
    first_check_in: datetime | None,
    last_check_out: datetime | None,
    day: date,
) -> Decimal:
    """
    Overtime from shift rules:
    - Early arrival before shift start is not counted toward overtime.
    - With a shift: credited work = max(check-in, shift start) → check-out vs scheduled shift hours.
    - Also counts checkout after shift end when overtime is allowed.
    - Without shift timings: fall back to total hours vs full_day_hours policy.
    """
    overtime = Decimal('0.00')

    first_check_in = _coerce_aware_timestamp(first_check_in)
    last_check_out = _coerce_aware_timestamp(last_check_out)

    if shift and shift.start_time and shift.end_time and first_check_in and last_check_out:
        shift_start = _aware_for_day(day, shift.start_time)
        shift_end_day = day + timedelta(days=1) if shift.is_overnight else day
        shift_end = _aware_for_day(shift_end_day, shift.end_time)

        work_start = max(first_check_in, shift_start)
        if last_check_out > work_start:
            credited_hours = _decimal_hours(int((last_check_out - work_start).total_seconds()))
        else:
            credited_hours = Decimal('0.00')

        scheduled_hours = _scheduled_shift_hours(shift)
        if scheduled_hours and credited_hours > scheduled_hours:
            overtime = max(
                overtime,
                (credited_hours - scheduled_hours).quantize(Decimal('0.01'), rounding=ROUND_HALF_UP),
            )

        if shift.overtime_allowed and last_check_out > shift_end:
            end_based_hours = _decimal_hours(int((last_check_out - shift_end).total_seconds()))
            overtime = max(overtime, end_based_hours)
    elif total_hours > full_day_hours:
        overtime = (total_hours - full_day_hours).quantize(Decimal('0.01'), rounding=ROUND_HALF_UP)

    return overtime


def resolve_shift_for_employee(employee: Employee, day: date) -> Shift | None:
    """
    Active shift for attendance on a date: Employee.shift, else an in-range EmployeeShift row.
    """
    if employee.shift_id:
        return employee.shift

    assignment = (
        EmployeeShift.objects.filter(employee=employee, shift__active=True)
        .filter(
            Q(effective_from__isnull=True) | Q(effective_from__lte=day),
            Q(effective_to__isnull=True) | Q(effective_to__gte=day),
        )
        .select_related('shift')
        .order_by('-is_primary', '-effective_from', '-created_at')
        .first()
    )
    return assignment.shift if assignment else None


def get_approved_leave(employee: Employee, day: date) -> LeaveRequest | None:
    return (
        LeaveRequest.objects
        .select_related('leave_type')
        .filter(
            employee=employee,
            status=LeaveRequest.STATUS_APPROVED,
            start_date__lte=day,
            end_date__gte=day,
        )
        .order_by('start_date', 'created_at')
        .first()
    )


def _holiday_attendance_result(employee: Employee, day: date, shift: Shift | None, holiday) -> dict:
    return {
        'employee_id': str(employee.id),
        'date': day.isoformat(),
        'shift_id': str(shift.id) if shift else None,
        'first_check_in': None,
        'last_check_out': None,
        'total_work_hours': Decimal('0.00'),
        'overtime_hours': Decimal('0.00'),
        'overtime_minutes': 0,
        'late_minutes': 0,
        'attendance_status': 'holiday',
        'is_on_leave': False,
        'leave_type_id': None,
        'leave_type_name': None,
        'leave_request_id': None,
        'leave_covered': False,
        'incomplete_punches': False,
        'incomplete_checkout': False,
        'attendance_source': 'SYSTEM',
        'requires_hr_review': False,
        'punch_count': 0,
        'sessions': [],
        'invalid_punches': [],
        'ignored_suspicious_count': 0,
        'holiday_id': str(holiday.id),
        'holiday_name': holiday.name,
        'holiday_scope': holiday.scope,
        'is_paid_day': bool(getattr(holiday, 'is_paid_day', True)),
    }


def calculate_daily_attendance(employee: Employee, day: date, shift: Shift | None = None) -> dict:
    shift = shift if shift is not None else resolve_shift_for_employee(employee, day)
    punches = get_engine_punches(employee, day, shift)
    approved_leave = get_approved_leave(employee, day)
    if approved_leave:
        if punches:
            logger.warning(
                '[AttendanceEngine] leave override conflict employee=%s date=%s leave=%s punch_count=%s',
                employee.id,
                day,
                approved_leave.id,
                len(punches),
            )
        return {
            'employee_id': str(employee.id),
            'date': day.isoformat(),
            'shift_id': str(shift.id) if shift else None,
            'first_check_in': None,
            'last_check_out': None,
            'total_work_hours': Decimal('0.00'),
            'overtime_hours': Decimal('0.00'),
            'overtime_minutes': 0,
            'late_minutes': 0,
            'attendance_status': 'leave',
            'is_on_leave': True,
            'leave_type_id': str(approved_leave.leave_type_id),
            'leave_type_name': approved_leave.leave_type.name if approved_leave.leave_type else None,
            'leave_request_id': str(approved_leave.id),
            'leave_covered': True,
            'incomplete_punches': False,
            'incomplete_checkout': False,
            'attendance_source': _resolve_attendance_source(punches),
            'requires_hr_review': bool(punches),
            'punch_count': len(punches),
            'sessions': [],
            'invalid_punches': [
                {
                    'punch_id': str(punch.id),
                    'type': punch.punch_type,
                    'timestamp': punch.timestamp.isoformat(),
                    'reason': 'leave_override_conflict',
                }
                for punch in punches
            ],
            'ignored_suspicious_count': 0,
            'review_reasons': (
                [{
                    'code': 'leave_override_conflict',
                    'message': 'Approved leave exists on this day, but biometric punches were also received.',
                }]
                if punches else []
            ),
        }

    from apps.hr.holiday_services import get_active_holiday_for_employee

    active_holiday = get_active_holiday_for_employee(employee, day)
    if active_holiday:
        return _holiday_attendance_result(employee, day, shift, active_holiday)

    sessions, invalid = pair_punches(punches)

    total_seconds = sum(session.seconds for session in sessions)
    full_day_hours = Decimal(str(getattr(shift, 'full_day_hours', None) or 8))
    half_day_hours = Decimal(str(getattr(shift, 'half_day_hours', None) or 4))

    first_check_in = min((session.check_in for session in sessions), default=None)
    last_check_out = max((session.check_out for session in sessions), default=None)
    if first_check_in is None:
        in_timestamps = [
            punch.timestamp
            for punch in punches
            if not punch.is_suspicious and punch.punch_type == 'IN'
        ]
        if in_timestamps:
            first_check_in = min(in_timestamps)

    total_hours = _credited_work_hours(
        first_check_in,
        last_check_out,
        shift,
        day,
        raw_seconds=total_seconds,
    )

    late_minutes = 0
    is_late_for_status = False
    if first_check_in and shift and shift.start_time:
        shift_start = _aware_for_day(day, shift.start_time)
        late_minutes, is_late_for_status = compute_late_metrics(
            first_check_in,
            shift_start,
            int(shift.grace_minutes or 0),
        )

    overtime_hours = _compute_overtime_hours(
        total_hours=total_hours,
        full_day_hours=full_day_hours,
        shift=shift,
        first_check_in=first_check_in,
        last_check_out=last_check_out,
        day=day,
    )
    overtime_minutes = int((overtime_hours * 60).quantize(Decimal('1'), rounding=ROUND_HALF_UP))

    has_any_punches = bool(punches)
    open_checkout_only = any(row['reason'] == 'missing_checkout' for row in invalid)
    has_other_invalid = any(
        row['reason'] != 'missing_checkout' for row in invalid
    )
    has_valid_session = bool(sessions)

    # Status priority: open checkout → pairing errors → unscheduled → absent → late → half_day → present
    if open_checkout_only and not has_valid_session:
        status = resolve_open_checkout_status(day, shift)
    elif has_any_punches and not has_valid_session:
        status = 'incomplete'
    elif not shift and not has_any_punches:
        status = 'unscheduled'
    elif not has_any_punches:
        status = resolve_no_punch_status(day, shift)
    elif not has_valid_session:
        status = 'incomplete'
    elif is_late_for_status:
        status = 'late'
    elif total_hours < half_day_hours:
        status = 'half_day'
    elif has_valid_session:
        if overtime_hours > 0 and shift and shift.overtime_allowed:
            status = 'overtime'
        else:
            status = 'present'
    else:
        status = 'absent'

    incomplete_checkout_flag = status == STATUS_MISSING_CHECKOUT
    incomplete_punches_flag = status in {'incomplete', STATUS_MISSING_CHECKOUT} or has_other_invalid
    attendance_source = _resolve_attendance_source(punches)
    requires_review = (
        status in {STATUS_MISSING_CHECKOUT, 'incomplete'}
        or has_other_invalid
        or any(
            row['reason'] in {
                'consecutive_in_without_checkout',
                'out_without_matching_in',
                'checkout_before_checkin',
            }
            for row in invalid
        )
    )
    review_reasons = []
    if open_checkout_only and not has_valid_session:
        review_reasons.append({
            'code': 'missing_checkout',
            'message': 'Employee checked in but no checkout punch was found yet.',
        })
    if has_other_invalid:
        review_reasons.append({
            'code': 'invalid_punch_sequence',
            'message': 'Punch order is inconsistent and needs HR review.',
        })

    logger.debug(
        '[AttendanceEngine] calculated raw employee=%s date=%s punch_count=%s total_hours=%s late_minutes=%s overtime=%s status=%s',
        employee.id,
        day,
        len(punches),
        total_hours,
        late_minutes,
        overtime_hours,
        status,
    )

    return {
        'employee_id': str(employee.id),
        'date': day.isoformat(),
        'shift_id': str(shift.id) if shift else None,
        'first_check_in': first_check_in,
        'last_check_out': last_check_out,
        'total_work_hours': total_hours,
        'overtime_hours': overtime_hours,
        'late_minutes': late_minutes,
        'attendance_status': status,
        'is_on_leave': False,
        'leave_type_id': None,
        'leave_type_name': None,
        'leave_request_id': None,
        'leave_covered': False,
        'incomplete_punches': incomplete_punches_flag,
        'incomplete_checkout': incomplete_checkout_flag,
        'late_minutes_basis': get_late_minutes_basis(),
        'attendance_source': attendance_source,
        'overtime_minutes': overtime_minutes,
        'requires_hr_review': requires_review,
        'punch_count': len(punches),
        'sessions': [
            {
                'check_in': session.check_in.isoformat(),
                'check_out': session.check_out.isoformat(),
                'hours': str(_decimal_hours(session.seconds)),
            }
            for session in sessions
        ],
        'invalid_punches': invalid,
        'ignored_suspicious_count': len([row for row in invalid if row['reason'] == 'suspicious_duplicate_ignored']),
        'review_reasons': review_reasons,
    }


def _snapshot(attendance: DailyAttendance) -> dict:
    return {
        'first_check_in': attendance.first_check_in.isoformat() if attendance.first_check_in else None,
        'last_check_out': attendance.last_check_out.isoformat() if attendance.last_check_out else None,
        'total_work_hours': str(attendance.total_work_hours) if attendance.total_work_hours is not None else None,
        'overtime_hours': str(attendance.overtime_hours) if attendance.overtime_hours is not None else None,
        'late_minutes': attendance.late_minutes,
        'attendance_status': attendance.attendance_status,
        'is_on_leave': attendance.is_on_leave,
        'leave_type': str(attendance.leave_type_id) if attendance.leave_type_id else None,
        'leave_request': str(attendance.leave_request_id) if attendance.leave_request_id else None,
        'incomplete_punches': attendance.incomplete_punches,
        'incomplete_checkout': attendance.incomplete_checkout,
        'attendance_source': attendance.attendance_source,
        'overtime_minutes': attendance.overtime_minutes,
        'requires_hr_review': attendance.requires_hr_review,
    }


def _serializable_calculation(calculated: dict) -> dict:
    payload = dict(calculated)
    for key in ('first_check_in', 'last_check_out'):
        if payload.get(key):
            payload[key] = payload[key].isoformat()
    for key in ('total_work_hours', 'overtime_hours'):
        if payload.get(key) is not None:
            payload[key] = str(payload[key])
    return payload


def _append_unique_remark(existing: str, message: str) -> str:
    existing = (existing or '').strip()
    if not message:
        return existing
    if not existing:
        return message
    if message in existing:
        return existing
    return f'{existing} {message}'.strip()


def _apply_review_reason(
    attendance: DailyAttendance,
    *,
    code: str,
    message: str,
    calculation_payload: dict | None = None,
) -> None:
    payload = calculation_payload if calculation_payload is not None else dict(attendance.calculation_details or {})
    reasons = list(payload.get('review_reasons') or [])
    if not any(row.get('code') == code for row in reasons):
        reasons.append({'code': code, 'message': message})
    payload['review_reasons'] = reasons
    attendance.calculation_details = payload
    attendance.requires_hr_review = True
    attendance.remarks = _append_unique_remark(attendance.remarks, message)


def _calculated_snapshot(calculated: dict) -> dict:
    return {
        'first_check_in': calculated['first_check_in'].isoformat() if calculated.get('first_check_in') else None,
        'last_check_out': calculated['last_check_out'].isoformat() if calculated.get('last_check_out') else None,
        'total_work_hours': str(calculated['total_work_hours']) if calculated.get('total_work_hours') is not None else None,
        'overtime_hours': str(calculated['overtime_hours']) if calculated.get('overtime_hours') is not None else None,
        'late_minutes': calculated['late_minutes'],
        'attendance_status': calculated['attendance_status'],
        'is_on_leave': calculated['is_on_leave'],
        'leave_type': calculated['leave_type_id'],
        'leave_request': calculated['leave_request_id'],
        'incomplete_punches': calculated['incomplete_punches'],
        'incomplete_checkout': calculated.get('incomplete_checkout', False),
        'attendance_source': calculated.get('attendance_source', 'NONE'),
        'overtime_minutes': calculated.get('overtime_minutes', 0),
        'requires_hr_review': calculated['requires_hr_review'],
    }


@transaction.atomic
def recalculate_daily_attendance(employee: Employee, day: date, *, force: bool = False, admin_override: bool = False) -> tuple[DailyAttendance, dict]:
    """
    Calculate and upsert DailyAttendance from raw punches.
    If HR locked/manually corrected a record, operational fields are preserved unless admin_override=True;
    latest calculated values are still stored in calculation_details for audit/review.
    """
    employee = Employee.objects.select_related('shift').select_for_update().get(pk=employee.pk)
    shift = resolve_shift_for_employee(employee, day)
    calculated = calculate_daily_attendance(employee, day, shift)
    attendance, _ = DailyAttendance.objects.select_for_update().get_or_create(
        employee=employee,
        date=day,
        defaults={'shift': shift},
    )

    protected = (
        attendance.finalized
        or ((attendance.calculation_locked or attendance.manually_corrected) and not admin_override)
    )
    if attendance.finalized and not admin_override:
        logger.info('[AttendanceEngine] skipped finalized row employee=%s date=%s', employee.id, day)
        calculation_payload = _serializable_calculation(calculated)
        attendance.calculation_details = calculation_payload
        attendance.last_calculated_at = timezone.now()
        if _snapshot(attendance) != _calculated_snapshot(calculated):
            _apply_review_reason(
                attendance,
                code='finalized_day_conflict',
                message='New biometric activity conflicts with a finalized attendance day. HR must review before payroll changes.',
                calculation_payload=calculation_payload,
            )
        attendance.save(update_fields=['calculation_details', 'last_calculated_at', 'requires_hr_review', 'remarks', 'updated_at'])
        return attendance, calculated
    if protected and not attendance.finalized:
        if not attendance.original_calculated_values:
            attendance.original_calculated_values = _snapshot(attendance)
        calculation_payload = _serializable_calculation(calculated)
        attendance.calculation_details = calculation_payload
        attendance.last_calculated_at = timezone.now()
        _apply_review_reason(
            attendance,
            code='manual_override_preserved',
            message='A new biometric punch conflicts with a manually corrected or locked attendance day. Manual values were preserved.',
            calculation_payload=calculation_payload,
        )
        attendance.save(update_fields=[
            'original_calculated_values',
            'calculation_details',
            'last_calculated_at',
            'requires_hr_review',
            'remarks',
            'updated_at',
        ])
        logger.info('[AttendanceEngine] preserved manual override employee=%s date=%s', employee.id, day)
        return attendance, calculated

    attendance.shift = shift
    attendance.first_check_in = calculated['first_check_in']
    attendance.last_check_out = calculated['last_check_out']
    attendance.total_work_hours = calculated['total_work_hours']
    attendance.overtime_hours = calculated['overtime_hours']
    attendance.late_minutes = calculated['late_minutes']
    attendance.attendance_status = calculated['attendance_status']
    attendance.is_on_leave = calculated['is_on_leave']
    attendance.leave_type_id = calculated['leave_type_id']
    attendance.leave_request_id = calculated['leave_request_id']
    attendance.incomplete_punches = calculated['incomplete_punches']
    attendance.incomplete_checkout = calculated.get('incomplete_checkout', False)
    attendance.attendance_source = calculated.get('attendance_source', 'NONE')
    attendance.overtime_minutes = calculated.get('overtime_minutes', 0)
    attendance.requires_hr_review = calculated['requires_hr_review']
    attendance.calculation_details = _serializable_calculation(calculated)
    attendance.last_calculated_at = timezone.now()
    update_fields = [
        'shift',
        'first_check_in',
        'last_check_out',
        'total_work_hours',
        'overtime_hours',
        'overtime_minutes',
        'late_minutes',
        'attendance_status',
        'is_on_leave',
        'leave_type',
        'leave_request',
        'incomplete_punches',
        'incomplete_checkout',
        'attendance_source',
        'requires_hr_review',
        'calculation_details',
        'last_calculated_at',
        'updated_at',
    ]
    if admin_override and (attendance.calculation_locked or attendance.manually_corrected):
        attendance.calculation_locked = False
        attendance.manually_corrected = False
        attendance.remarks = ''
        update_fields.extend(['calculation_locked', 'manually_corrected', 'remarks'])
    attendance.save(update_fields=update_fields)
    logger.info(
        '[AttendanceEngine] calculated employee=%s date=%s status=%s hours=%s review=%s',
        employee.id,
        day,
        attendance.attendance_status,
        attendance.total_work_hours,
        attendance.requires_hr_review,
    )
    return attendance, calculated


def compute_metrics_from_check_times(
    employee: Employee,
    day: date,
    check_in: datetime | None,
    check_out: datetime | None,
    shift: Shift | None = None,
) -> dict:
    """Derive status, hours, late, and overtime from explicit check-in/out (read-only safe)."""
    check_in = _coerce_aware_timestamp(check_in)
    check_out = _coerce_aware_timestamp(check_out)
    shift = shift or resolve_shift_for_employee(employee, day)

    total_hours = Decimal('0.00')
    late_minutes = 0
    overtime_hours = Decimal('0.00')
    overtime_minutes = 0
    status = resolve_no_punch_status(day, shift)
    incomplete_checkout = False
    incomplete_punches = False

    full_day_hours = Decimal(str(getattr(shift, 'full_day_hours', None) or 8))
    half_day_hours = Decimal(str(getattr(shift, 'half_day_hours', None) or 4))

    if check_in and check_out and check_out > check_in:
        raw_seconds = int((check_out - check_in).total_seconds())
        total_hours = _credited_work_hours(
            check_in,
            check_out,
            shift,
            day,
            raw_seconds=raw_seconds,
        )
        is_late_for_status = False
        if shift and shift.start_time:
            shift_start = _aware_for_day(day, shift.start_time)
            late_minutes, is_late_for_status = compute_late_metrics(
                check_in,
                shift_start,
                int(shift.grace_minutes or 0),
            )
        overtime_hours = _compute_overtime_hours(
            total_hours=total_hours,
            full_day_hours=full_day_hours,
            shift=shift,
            first_check_in=check_in,
            last_check_out=check_out,
            day=day,
        )
        overtime_minutes = int((overtime_hours * 60).quantize(Decimal('1'), rounding=ROUND_HALF_UP))
        if is_late_for_status:
            status = 'late'
        elif total_hours < half_day_hours:
            status = 'half_day'
        elif overtime_hours > 0 and shift and shift.overtime_allowed:
            status = 'overtime'
        else:
            status = 'present'
    elif check_in and not check_out:
        status = resolve_open_checkout_status(day, shift)
        incomplete_checkout = status == STATUS_MISSING_CHECKOUT
        incomplete_punches = status in {STATUS_IN_PROGRESS, STATUS_MISSING_CHECKOUT}
    elif not check_in and check_out:
        status = 'incomplete'
        incomplete_punches = True

    return {
        'shift': shift,
        'attendance_status': status,
        'total_work_hours': total_hours,
        'late_minutes': late_minutes,
        'overtime_hours': overtime_hours,
        'overtime_minutes': overtime_minutes,
        'incomplete_checkout': incomplete_checkout,
        'incomplete_punches': incomplete_punches,
    }


def apply_manual_check_times_to_attendance(
    attendance: DailyAttendance,
    *,
    check_in: datetime | None = None,
    check_out: datetime | None = None,
) -> DailyAttendance:
    """Apply HR-approved correction times and derive hours, late, overtime, and status."""
    if check_in is not None:
        attendance.first_check_in = check_in
    if check_out is not None:
        attendance.last_check_out = check_out

    metrics = compute_metrics_from_check_times(
        attendance.employee,
        attendance.date,
        attendance.first_check_in,
        attendance.last_check_out,
        attendance.shift,
    )
    attendance.shift = metrics['shift']
    attendance.total_work_hours = metrics['total_work_hours']
    attendance.late_minutes = metrics['late_minutes']
    attendance.overtime_hours = metrics['overtime_hours']
    attendance.overtime_minutes = metrics['overtime_minutes']
    attendance.attendance_status = metrics['attendance_status']
    attendance.incomplete_checkout = metrics['incomplete_checkout']
    attendance.incomplete_punches = metrics['incomplete_punches']
    attendance.is_on_leave = False
    attendance.leave_type_id = None
    attendance.leave_request_id = None
    attendance.attendance_source = 'HR_MANUAL'
    attendance.requires_hr_review = False
    return attendance


def recalculate_for_punch(punch: AttendancePunch, *, force: bool = False, admin_override: bool = False) -> tuple[DailyAttendance, dict] | None:
    shift = punch.shift or punch.employee.shift
    if punch.attendance_date:
        day = punch.attendance_date
    else:
        day = _derived_working_date_for_punch(punch, shift)
        AttendancePunch.objects.filter(pk=punch.pk).update(attendance_date=day)
        punch.attendance_date = day
        logger.info('[AttendanceEngine] set punch attendance_date punch=%s date=%s', punch.id, day)
    if not day:
        return None
    return recalculate_daily_attendance(punch.employee, day, force=force, admin_override=admin_override)


class AttendanceCalculationService:
    """Service facade for rebuilding DailyAttendance from raw punch events."""

    @staticmethod
    def calculate(employee: Employee, day: date, shift: Shift | None = None) -> dict:
        return calculate_daily_attendance(employee, day, shift)

    @staticmethod
    def recalculate(employee: Employee, day: date, *, force: bool = False, admin_override: bool = False) -> tuple[DailyAttendance, dict]:
        return recalculate_daily_attendance(employee, day, force=force, admin_override=admin_override)

    @staticmethod
    def recalculate_for_punch(punch: AttendancePunch, *, force: bool = False, admin_override: bool = False) -> tuple[DailyAttendance, dict] | None:
        return recalculate_for_punch(punch, force=force, admin_override=admin_override)

    @staticmethod
    def rebuild_day(day: date, employees=None, *, force: bool = False, admin_override: bool = False) -> list[DailyAttendance]:
        if employees is None:
            employees = Employee.objects.filter(status='active').select_related('shift')
        elif hasattr(employees, 'select_related'):
            employees = employees.select_related('shift')
        records: list[DailyAttendance] = []
        for employee in employees:
            joined = employee.joining_date_confirmed or employee.joining_date
            if joined and day < joined:
                if force:
                    DailyAttendance.objects.filter(employee=employee, date=day).delete()
                continue
            attendance, _ = recalculate_daily_attendance(employee, day, force=force, admin_override=admin_override)
            records.append(attendance)
        logger.info('[AttendanceEngine] rebuilt day=%s employees=%s', day, len(records))
        return records
