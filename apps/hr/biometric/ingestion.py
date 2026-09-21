"""ATTLOG ingestion into AttendancePunch."""

from __future__ import annotations

import logging
from datetime import timedelta

from django.db import IntegrityError, transaction
from django.utils import timezone

from apps.hr.attendance_engine import recalculate_daily_attendance, recalculate_for_punch
from apps.hr.biometric.audit import log_biometric_event
from apps.hr.biometric.eligibility import is_punch_allowed
from apps.hr.biometric.punch_pairing import (
    attendance_date_for,
    recent_punches_for_alternation,
    resequence_biometric_punch_window,
    suggest_next_punch_type,
)
from apps.hr.biometric_models import BiometricRejectedPunch, BiometricSyncLog, BiometricUnlinkedUser
from apps.hr.models import AttendancePunch, DailyAttendance, Employee

logger = logging.getLogger('apps.hr.biometric')

DUPLICATE_THRESHOLD_MINUTES = 2
FUTURE_PUNCH_GRACE_MINUTES = 5
DELAYED_PUNCH_WARNING_HOURS = 12
DEVICE_CLOCK_DRIFT_WARNING_MINUTES = 10


def _find_near_duplicate(employee, timestamp, punch_type: str, *, exclude_pk=None):
    """
    Flag only true accidental double-taps: same type within the threshold
    without a closing opposite punch between them.
    """
    threshold = timedelta(minutes=DUPLICATE_THRESHOLD_MINUTES)
    opposing = 'OUT' if punch_type == 'IN' else 'IN'
    candidates = AttendancePunch.objects.filter(
        employee=employee,
        punch_type=punch_type,
        source='biometric',
        is_void=False,
        is_suspicious=False,
        timestamp__gte=timestamp - threshold,
        timestamp__lt=timestamp,
    )
    if exclude_pk:
        candidates = candidates.exclude(pk=exclude_pk)
    for candidate in candidates.order_by('-timestamp'):
        closed_between = AttendancePunch.objects.filter(
            employee=employee,
            punch_type=opposing,
            is_void=False,
            is_suspicious=False,
            timestamp__gt=candidate.timestamp,
            timestamp__lt=timestamp,
        ).exists()
        if not closed_between:
            return candidate
    return None


def _exact_duplicate_exists(employee, timestamp, punch_type: str, device_sn: str) -> bool:
    return AttendancePunch.objects.filter(
        employee=employee,
        timestamp=timestamp,
        punch_type=punch_type,
        source='biometric',
        device_id=device_sn,
        is_void=False,
    ).exists()


def _record_unlinked(device, pin: str, name: str = '', card: str = '') -> None:
    if not device.hospital_id:
        log_biometric_event(
            action='unlinked_user_no_hospital',
            level=BiometricSyncLog.LEVEL_WARNING,
            device=device,
            message=f'Unknown PIN={pin} but device has no hospital assigned.',
            metadata={'pin': pin, 'name': name},
        )
        return

    obj, created = BiometricUnlinkedUser.objects.get_or_create(
        hospital_id=device.hospital_id,
        pin=str(pin).strip(),
        status=BiometricUnlinkedUser.STATUS_PENDING,
        defaults={
            'device': device,
            'name': name or f'Device user PIN-{pin}',
            'card_number': card or '',
        },
    )
    if not created:
        changed = []
        if name and obj.name != name:
            obj.name = name
            changed.append('name')
        if card and obj.card_number != card:
            obj.card_number = card
            changed.append('card_number')
        obj.device = device
        changed.extend(['device', 'last_seen_at'])
        obj.save(update_fields=changed + ['updated_at'])

    log_biometric_event(
        action='unlinked_device_user',
        level=BiometricSyncLog.LEVEL_WARNING,
        device=device,
        message=f'Punch from unlinked PIN={pin} — stored as conflict for HR review.',
        metadata={'pin': pin, 'name': name},
    )


def _record_rejected(device, employee, pin: str, punch_time, reason: str, raw_line: str, metadata: dict):
    BiometricRejectedPunch.objects.create(
        hospital_id=device.hospital_id if device else None,
        device=device,
        employee=employee,
        pin=pin,
        punch_time=punch_time,
        reason=reason,
        raw_line=raw_line,
        metadata=metadata,
    )
    log_biometric_event(
        action='punch_rejected',
        level=BiometricSyncLog.LEVEL_WARNING,
        device=device,
        employee=employee,
        message=f'Rejected punch PIN={pin} reason={reason}',
        metadata=metadata,
    )


def _append_review_reason(details: dict, *, code: str, message: str) -> dict:
    payload = dict(details or {})
    review_reasons = list(payload.get('review_reasons') or [])
    if not any(row.get('code') == code for row in review_reasons):
        review_reasons.append({'code': code, 'message': message})
    payload['review_reasons'] = review_reasons
    return payload


def _flag_days_for_review(employee, dates, *, code: str, message: str) -> None:
    for attendance in DailyAttendance.objects.filter(employee=employee, date__in=dates):
        details = _append_review_reason(attendance.calculation_details, code=code, message=message)
        remarks = (attendance.remarks or '').strip()
        if message not in remarks:
            remarks = f'{remarks} {message}'.strip() if remarks else message
        attendance.calculation_details = details
        attendance.requires_hr_review = True
        attendance.remarks = remarks
        attendance.save(update_fields=['calculation_details', 'requires_hr_review', 'remarks', 'updated_at'])


def _timestamp_health_flags(timestamp):
    now = timezone.now()
    delta = timestamp - now
    future_minutes = round(delta.total_seconds() / 60, 2)
    delayed_hours = round((now - timestamp).total_seconds() / 3600, 2)
    return {
        'future_minutes': future_minutes,
        'delayed_hours': delayed_hours,
        'is_future': future_minutes > FUTURE_PUNCH_GRACE_MINUTES,
        'is_delayed': delayed_hours > DELAYED_PUNCH_WARNING_HOURS,
        'has_clock_drift': abs(future_minutes) >= DEVICE_CLOCK_DRIFT_WARNING_MINUTES,
    }


def ingest_attlog_line(
    device,
    pin: str,
    timestamp,
    raw_status: int,
    verify_mode: int,
    raw_line: str,
) -> bool:
    """
    Process one ATTLOG line. Returns True if a punch was created.
    Never raises — device must always get OK.
    """
    try:
        pin = str(pin).strip()
        if not pin:
            return False

        if not device.hospital_id:
            log_biometric_event(
                action='punch_rejected_no_hospital',
                level=BiometricSyncLog.LEVEL_WARNING,
                device=device,
                message=f'Device {device.serial_number} has no hospital — assign in HR admin.',
                metadata={'pin': pin, 'timestamp': timestamp.isoformat()},
            )
            return False

        employee = Employee.objects.filter(
            hospital_id=device.hospital_id,
            biometric_pin=pin,
        ).select_related('shift').first()

        if not employee:
            _record_unlinked(device, pin)
            return False

        allowed, reason = is_punch_allowed(employee)
        if not allowed:
            _record_rejected(
                device,
                employee,
                pin,
                timestamp,
                reason,
                raw_line,
                {'raw_status': raw_status, 'verify_mode': verify_mode},
            )
            return False

        shift = employee.shift
        if shift and shift.start_time:
            from apps.hr.attendance_policy import is_punch_before_earliest_window

            attendance_day = attendance_date_for(
                employee, timestamp, 'IN', shift, prior_punches=[],
            )
            if is_punch_before_earliest_window(timestamp, attendance_day, shift):
                _record_rejected(
                    device,
                    employee,
                    pin,
                    timestamp,
                    'too_early_before_shift',
                    raw_line,
                    {
                        'raw_status': raw_status,
                        'verify_mode': verify_mode,
                        'shift_start': str(shift.start_time),
                        'early_punch_minutes': getattr(shift, 'early_punch_minutes', 240),
                    },
                )
                return False

        time_flags = _timestamp_health_flags(timestamp)
        if time_flags['is_future']:
            metadata = {
                'raw_status': raw_status,
                'verify_mode': verify_mode,
                'future_minutes': time_flags['future_minutes'],
            }
            _record_rejected(
                device,
                employee,
                pin,
                timestamp,
                'future_device_time',
                raw_line,
                metadata,
            )
            log_biometric_event(
                action='future_device_time',
                level=BiometricSyncLog.LEVEL_WARNING,
                device=device,
                employee=employee,
                message=f'Future biometric punch rejected for PIN={pin} ({time_flags["future_minutes"]} min ahead).',
                metadata=metadata,
            )
            return False
        if time_flags['has_clock_drift']:
            log_biometric_event(
                action='device_clock_drift',
                level=BiometricSyncLog.LEVEL_WARNING,
                device=device,
                employee=employee,
                message=f'Device clock drift detected for PIN={pin}.',
                metadata={
                    'future_minutes': time_flags['future_minutes'],
                    'delayed_hours': time_flags['delayed_hours'],
                },
            )
        if time_flags['is_delayed']:
            log_biometric_event(
                action='delayed_punch',
                level=BiometricSyncLog.LEVEL_WARNING,
                device=device,
                employee=employee,
                message=f'Delayed biometric punch received for PIN={pin}.',
                metadata={'delayed_hours': time_flags['delayed_hours']},
            )

        prior = recent_punches_for_alternation(employee, timestamp)
        punch_type = suggest_next_punch_type(prior)
        out_of_order = AttendancePunch.objects.filter(
            employee=employee,
            is_void=False,
            timestamp__gt=timestamp,
        ).exists()

        if _exact_duplicate_exists(employee, timestamp, punch_type, device.serial_number):
            logger.debug('Exact duplicate biometric punch skipped PIN=%s time=%s', pin, timestamp)
            return False

        near_dup = _find_near_duplicate(employee, timestamp, punch_type)
        is_suspicious = near_dup is not None
        suspicious_reason = ''
        if is_suspicious:
            suspicious_reason = (
                f'Possible duplicate punch within {DUPLICATE_THRESHOLD_MINUTES} minute(s) '
                f'of {near_dup.timestamp.isoformat()}.'
            )

        attendance_date = attendance_date_for(
            employee, timestamp, punch_type, shift, prior_punches=prior,
        )

        with transaction.atomic():
            punch = AttendancePunch.objects.create(
                employee=employee,
                shift=shift,
                attendance_date=attendance_date,
                timestamp=timestamp,
                punch_type=punch_type,
                source='biometric',
                device_id=device.serial_number,
                device_metadata={
                    'raw_status': raw_status,
                    'verify_mode': verify_mode,
                    'raw_line': raw_line,
                    'delayed_hours': time_flags['delayed_hours'] if time_flags['is_delayed'] else None,
                    'future_minutes': time_flags['future_minutes'],
                    'out_of_order': out_of_order,
                },
                is_suspicious=is_suspicious,
                suspicious_reason=suspicious_reason,
                duplicate_of=near_dup if is_suspicious else None,
            )
            if out_of_order:
                log_biometric_event(
                    action='out_of_order_punch',
                    level=BiometricSyncLog.LEVEL_WARNING,
                    device=device,
                    employee=employee,
                    message=f'Out-of-order biometric punch received for PIN={pin}.',
                    metadata={'timestamp': timestamp.isoformat(), 'punch_id': str(punch.id)},
                )
                resequence = resequence_biometric_punch_window(employee, timestamp)
                if resequence.get('blocked_reason') == 'mixed_sources':
                    review_message = (
                        'Automatic punch resequencing was skipped because manual and biometric punches are mixed for this window.'
                    )
                    log_biometric_event(
                        action='mixed_source_resequence_blocked',
                        level=BiometricSyncLog.LEVEL_WARNING,
                        device=device,
                        employee=employee,
                        message=review_message,
                        metadata={'timestamp': timestamp.isoformat(), 'punch_id': str(punch.id)},
                    )
                    recalculate_for_punch(punch, force=True)
                    _flag_days_for_review(
                        employee,
                        {attendance_date},
                        code='mixed_source_conflict',
                        message=review_message,
                    )
                else:
                    affected_dates = set(resequence.get('affected_dates') or [])
                    punch.refresh_from_db(fields=['punch_type', 'attendance_date'])
                    if punch.attendance_date:
                        affected_dates.add(punch.attendance_date)
                    for work_date in sorted(affected_dates):
                        recalculate_daily_attendance(employee, work_date, force=True)
            else:
                recalculate_for_punch(punch, force=True)

        log_biometric_event(
            action='punch_ingested',
            device=device,
            employee=employee,
            message=f'Punch {punch_type} PIN={pin} at {timestamp.isoformat()}',
            metadata={'punch_id': str(punch.id), 'raw_status': raw_status},
        )
        return True

    except IntegrityError:
        logger.debug('IntegrityError on punch ingest PIN=%s — duplicate', pin)
        return False
    except Exception as exc:
        log_biometric_event(
            action='punch_ingest_error',
            level=BiometricSyncLog.LEVEL_ERROR,
            device=device,
            message=str(exc),
            metadata={'pin': pin, 'raw_line': raw_line},
        )
        logger.exception('Failed to ingest ATTLOG PIN=%s', pin)
        return False
