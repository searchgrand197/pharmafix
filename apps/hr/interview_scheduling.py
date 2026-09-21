"""Enterprise interview scheduling: parsing slots, overlap checks, candidate mirror sync, audit."""
from __future__ import annotations

import logging
import uuid
from datetime import datetime, timedelta
from typing import List, Optional, Sequence, Tuple

from django.db import transaction
from django.utils import timezone as dj_timezone
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from apps.hr.interview_reminders import queue_cancel_interview_reminders, queue_sync_interview_reminders
from apps.hr.models import Candidate, Interview, InterviewBulkAuditLog

logger = logging.getLogger(__name__)


def hr_timezone_name() -> str:
    """Hospital wall-clock timezone — must match Django TIME_ZONE (default IST)."""
    from django.conf import settings

    return (getattr(settings, 'TIME_ZONE', None) or 'Asia/Kolkata').strip()


class InterviewSchedulingError(Exception):
    """Business-rule failure for scheduling APIs (maps to HTTP 400)."""

    def __init__(self, message: str):
        self.message = message
        super().__init__(message)


def parse_local_datetime(date_str: str, time_str: str, tz_name: str) -> datetime:
    if not date_str or not time_str:
        raise InterviewSchedulingError('Date and time are required.')
    try:
        zi = ZoneInfo((tz_name or hr_timezone_name()).strip())
    except ZoneInfoNotFoundError:
        raise InterviewSchedulingError(f'Unknown timezone: {tz_name}')
    try:
        d = datetime.strptime(date_str.strip(), '%Y-%m-%d').date()
    except ValueError:
        raise InterviewSchedulingError('Invalid date. Use YYYY-MM-DD.')
    try:
        t = datetime.strptime(time_str.strip(), '%H:%M').time()
    except ValueError:
        try:
            t = datetime.strptime(time_str.strip(), '%H:%M:%S').time()
        except ValueError:
            raise InterviewSchedulingError('Invalid time. Use HH:MM.')
    local = datetime.combine(d, t, tzinfo=zi)
    return local


def _truncate_to_minute(dt: datetime) -> datetime:
    return dt.replace(second=0, microsecond=0)


def _schedule_audit_payload(data) -> dict:
    """Extract schedule-related keys from request.data / bulk payload for audit logs."""
    if not data:
        return {}
    keys = (
        'date', 'time', 'interview_date', 'timezone', 'duration_minutes',
        'interview_type', 'candidate_ids',
    )
    if hasattr(data, 'items'):
        return {k: data.get(k) for k in keys if data.get(k) not in (None, '')}
    return {}


def _classify_past_validation_failure(
    *,
    date_s: str,
    time_s: str,
    when_date,
    now_date,
    when_minutes: int,
    now_minutes_floor: int,
    local_now_hour: int,
) -> str:
    """Heuristic classification for audit reports (A–E)."""
    if when_date < now_date:
        return 'B: Wrong date sent (interview calendar date before server IST today)'
    if when_date == now_date and when_minutes < now_minutes_floor:
        if time_s:
            try:
                hour = int(time_s.strip().split(':', 1)[0])
            except (ValueError, IndexError):
                hour = -1
            if 0 <= hour < 12 and local_now_hour >= 12:
                return (
                    'A: Wrong time sent — payload hour is AM (e.g. 02:00) while server '
                    'is PM; 14:00 required for 2 PM'
                )
        return 'C: Server clock ahead of slot (same IST day, slot minutes < server minutes − grace)'
    return 'E: Other / undetermined'


def log_interview_past_validation_audit(
    *,
    date_s: str,
    time_s: str,
    when: datetime,
    tz_name: str,
    grace_minutes: int = 2,
    request_payload: Optional[dict] = None,
    audit_source: str = '',
) -> dict:
    """
    Log diagnostic snapshot immediately before ensure_interview_not_in_past().

    Called from apps/hr/views.py schedule_interview (~L2935) and bulk runners.
    """
    tz_name = (tz_name or hr_timezone_name()).strip()
    zi = ZoneInfo(tz_name)

    if dj_timezone.is_naive(when):
        when_aware = datetime.combine(when.date(), when.time(), tzinfo=zi)
    else:
        when_aware = when

    local_when = when_aware.astimezone(zi)
    local_now = dj_timezone.localtime()
    if local_now.tzinfo != zi:
        local_now = local_now.astimezone(zi)

    when_date = local_when.date()
    now_date = local_now.date()
    when_minutes = local_when.hour * 60 + local_when.minute
    now_minutes_floor = local_now.hour * 60 + local_now.minute - max(0, grace_minutes)

    audit = {
        'audit_source': audit_source or 'unknown',
        'date_s': date_s,
        'time_s': time_s,
        'request_payload': request_payload or {},
        'parsed_interview_datetime': local_when.isoformat(),
        'server_localtime': local_now.isoformat(),
        'parsed_interview_date': when_date.isoformat(),
        'current_server_date': now_date.isoformat(),
        'parsed_interview_minutes': when_minutes,
        'current_server_minutes': local_now.hour * 60 + local_now.minute,
        'current_server_minutes_floor': now_minutes_floor,
        'grace_minutes': grace_minutes,
        'timezone': tz_name,
    }
    logger.warning(
        '[InterviewScheduleAudit] PRE-VALIDATION source=%s | '
        'REQUEST date_s=%r time_s=%r payload=%s | '
        'PARSED=%s SERVER=%s | '
        'parsed_date=%s server_date=%s | '
        'parsed_minutes=%s server_minutes=%s floor=%s',
        audit['audit_source'],
        date_s,
        time_s,
        audit['request_payload'],
        audit['parsed_interview_datetime'],
        audit['server_localtime'],
        audit['parsed_interview_date'],
        audit['current_server_date'],
        when_minutes,
        audit['current_server_minutes'],
        now_minutes_floor,
    )
    return audit


def ensure_interview_not_in_past(
    when: datetime,
    tz_name: str = '',
    grace_minutes: int = 2,
    *,
    date_s: str = '',
    time_s: str = '',
    request_payload: Optional[dict] = None,
    audit_source: str = '',
) -> None:
    """Reject past datetimes using IST wall clock (date + HH:MM), not string compare."""
    tz_name = (tz_name or hr_timezone_name()).strip()
    try:
        zi = ZoneInfo(tz_name)
    except ZoneInfoNotFoundError:
        raise InterviewSchedulingError(f'Unknown timezone: {tz_name}')

    audit = log_interview_past_validation_audit(
        date_s=date_s,
        time_s=time_s,
        when=when,
        tz_name=tz_name,
        grace_minutes=grace_minutes,
        request_payload=request_payload,
        audit_source=audit_source or 'ensure_interview_not_in_past',
    )

    if dj_timezone.is_naive(when):
        when = datetime.combine(when.date(), when.time(), tzinfo=zi)

    local_when = when.astimezone(zi)
    local_now = dj_timezone.localtime()
    if local_now.tzinfo != zi:
        local_now = local_now.astimezone(zi)

    when_date = local_when.date()
    now_date = local_now.date()
    when_minutes = audit['parsed_interview_minutes']
    now_minutes = audit['current_server_minutes_floor']

    if when_date < now_date:
        classification = _classify_past_validation_failure(
            date_s=date_s,
            time_s=time_s,
            when_date=when_date,
            now_date=now_date,
            when_minutes=when_minutes,
            now_minutes_floor=now_minutes,
            local_now_hour=local_now.hour,
        )
        logger.warning(
            '[InterviewScheduleAudit] VALIDATION RESULT=REJECT classification=%s | '
            'REQUEST PAYLOAD=%s | PARSED DATETIME=%s | SERVER DATETIME=%s',
            classification,
            audit['request_payload'],
            audit['parsed_interview_datetime'],
            audit['server_localtime'],
        )
        raise InterviewSchedulingError(
            'Interview cannot be scheduled in the past. Choose today or a future date and time.'
        )
    if when_date > now_date:
        logger.warning(
            '[InterviewScheduleAudit] VALIDATION RESULT=PASS (future date) | '
            'REQUEST PAYLOAD=%s | PARSED DATETIME=%s | SERVER DATETIME=%s',
            audit['request_payload'],
            audit['parsed_interview_datetime'],
            audit['server_localtime'],
        )
        return

    if when_minutes < now_minutes:
        classification = _classify_past_validation_failure(
            date_s=date_s,
            time_s=time_s,
            when_date=when_date,
            now_date=now_date,
            when_minutes=when_minutes,
            now_minutes_floor=now_minutes,
            local_now_hour=local_now.hour,
        )
        logger.warning(
            '[InterviewScheduleAudit] VALIDATION RESULT=REJECT classification=%s | '
            'REQUEST PAYLOAD=%s | PARSED DATETIME=%s | SERVER DATETIME=%s',
            classification,
            audit['request_payload'],
            audit['parsed_interview_datetime'],
            audit['server_localtime'],
        )
        raise InterviewSchedulingError(
            'Interview cannot be scheduled in the past. Choose today or a future date and time.'
        )

    logger.warning(
        '[InterviewScheduleAudit] VALIDATION RESULT=PASS | '
        'REQUEST PAYLOAD=%s | PARSED DATETIME=%s | SERVER DATETIME=%s',
        audit['request_payload'],
        audit['parsed_interview_datetime'],
        audit['server_localtime'],
    )


def ensure_future_start(when: datetime, tz_name: str = '') -> None:
    ensure_interview_not_in_past(when, tz_name)


def compute_end(start: datetime, duration_minutes: int) -> datetime:
    minutes = duration_minutes or 60
    minutes = max(1, min(int(minutes), 24 * 60))
    return start + timedelta(minutes=minutes)


def ranges_overlap(a_start, a_end, b_start, b_end) -> bool:
    return a_start < b_end and b_start < a_end


def _interview_effective_end(inv: Interview) -> datetime:
    if inv.scheduled_end:
        return inv.scheduled_end
    return compute_end(inv.scheduled_start, inv.duration_minutes)


def find_scheduled_overlap_for_candidate(
    candidate_id,
    new_start,
    new_end,
    exclude_interview_id=None,
) -> Optional[Interview]:
    qs = Interview.objects.filter(candidate_id=candidate_id, status=Interview.STATUS_SCHEDULED)
    if exclude_interview_id:
        qs = qs.exclude(pk=exclude_interview_id)
    for inv in qs:
        if ranges_overlap(new_start, new_end, inv.scheduled_start, _interview_effective_end(inv)):
            return inv
    return None


def find_interviewer_conflict(
    interviewer_name: str,
    new_start,
    new_end,
    exclude_interview_ids: Optional[Sequence] = None,
) -> Optional[Interview]:
    name = (interviewer_name or '').strip()
    if not name:
        return None
    qs = Interview.objects.filter(
        status=Interview.STATUS_SCHEDULED,
        interviewer_name__iexact=name,
    )
    if exclude_interview_ids:
        qs = qs.exclude(pk__in=list(exclude_interview_ids))
    for inv in qs:
        if ranges_overlap(new_start, new_end, inv.scheduled_start, _interview_effective_end(inv)):
            return inv
    return None


def sync_candidate_interview_snapshot(candidate: Candidate, interview: Interview) -> None:
    candidate.interview_date = interview.scheduled_start
    candidate.interview_type = interview.mode
    candidate.interview_meeting_link = interview.meeting_link or ''
    candidate.interview_venue_address = interview.office_address or ''
    candidate.interview_status = 'pending'
    candidate.save(
        update_fields=[
            'interview_date',
            'interview_type',
            'interview_meeting_link',
            'interview_venue_address',
            'interview_status',
            'updated_at',
        ]
    )


def clear_candidate_interview_snapshot_if_none_scheduled(candidate: Candidate) -> None:
    latest = (
        candidate.interviews.filter(status=Interview.STATUS_SCHEDULED)
        .order_by('-scheduled_start')
        .first()
    )
    if latest:
        sync_candidate_interview_snapshot(candidate, latest)
        return
    candidate.interview_date = None
    candidate.interview_type = None
    candidate.interview_meeting_link = ''
    candidate.interview_venue_address = ''
    candidate.interview_status = 'pending'
    candidate.save(
        update_fields=[
            'interview_date',
            'interview_type',
            'interview_meeting_link',
            'interview_venue_address',
            'interview_status',
            'updated_at',
        ]
    )


def validate_mode_fields(
    mode: str,
    meeting_link: str,
    office_address: str,
    platform: str,
) -> Tuple[str, str, str, str]:
    mode = (mode or 'online').lower()
    if mode not in ('online', 'offline'):
        mode = 'online'
    meeting_link = (meeting_link or '').strip()
    office_address = (office_address or '').strip()
    platform = (platform or '').strip()
    if mode == 'online':
        if not meeting_link:
            raise InterviewSchedulingError('Meeting link is required for online interviews.')
        from django.core.validators import URLValidator
        from django.core.exceptions import ValidationError as DjValidationError

        v = URLValidator()
        try:
            v(meeting_link)
        except DjValidationError:
            raise InterviewSchedulingError('Invalid meeting link URL.')
        office_address = ''
    else:
        if not office_address:
            raise InterviewSchedulingError('Office address is required for offline interviews.')
        meeting_link = ''
    return mode, meeting_link, office_address, platform


def write_audit(user, action: str, candidate_ids: List, detail: dict) -> None:
    InterviewBulkAuditLog.objects.create(
        action=action,
        performed_by=user if getattr(user, 'is_authenticated', False) else None,
        candidate_ids=[str(x) for x in candidate_ids],
        affected_count=len(candidate_ids),
        detail=detail or {},
    )


def _normalize_candidate_ids(raw) -> List[str]:
    if not raw:
        return []
    out: List[str] = []
    seen = set()
    for x in raw:
        s = str(x).strip()
        if not s or s in seen:
            continue
        seen.add(s)
        out.append(s)
    return out


def _load_candidates_for_bulk(candidate_ids: List[str]) -> List[Candidate]:
    if not candidate_ids:
        raise InterviewSchedulingError('candidate_ids is required.')
    candidates = list(Candidate.objects.filter(id__in=candidate_ids).select_related('job_opening'))
    if len(candidates) != len(candidate_ids):
        raise InterviewSchedulingError('One or more candidates were not found.')
    by_id = {str(c.id): c for c in candidates}
    return [by_id[i] for i in candidate_ids]


def run_bulk_schedule(user, raw_candidate_ids, payload: dict) -> dict:
    """Create one Interview per candidate; move shortlisted → interview."""
    candidate_ids = _normalize_candidate_ids(raw_candidate_ids)
    candidates = _load_candidates_for_bulk(candidate_ids)

    date_s = (payload.get('date') or '').strip()
    time_s = (payload.get('time') or '').strip()
    tz_name = hr_timezone_name()
    start = parse_local_datetime(date_s, time_s, tz_name)
    ensure_interview_not_in_past(
        start,
        tz_name,
        date_s=date_s,
        time_s=time_s,
        request_payload=_schedule_audit_payload(payload),
        audit_source='run_bulk_schedule',
    )

    duration = int(payload.get('duration_minutes') or 60)
    end = compute_end(start, duration)

    mode, meeting_link, office_address, platform = validate_mode_fields(
        payload.get('interview_type') or payload.get('mode'),
        payload.get('meeting_link') or payload.get('interview_meeting_link'),
        payload.get('office_address') or payload.get('interview_venue_address'),
        payload.get('platform') or '',
    )
    location_notes = (payload.get('location_notes') or '').strip()
    interviewer_name = (payload.get('interviewer') or payload.get('interviewer_name') or '').strip()
    notes = (payload.get('notes') or '').strip()

    conflict = find_interviewer_conflict(interviewer_name, start, end, None)
    if conflict:
        raise InterviewSchedulingError(
            f'Interviewer "{interviewer_name}" has an overlapping interview scheduled '
            f'({conflict.scheduled_start}). Choose another time or interviewer.'
        )

    batch_id = uuid.uuid4()
    created: List[Interview] = []

    with transaction.atomic():
        for cand in candidates:
            cand = Candidate.objects.select_for_update().select_related('job_opening').get(pk=cand.pk)
            if cand.status == 'shortlisted':
                cand.status = 'interview'
                cand.interview_status = 'pending'
                cand.save(update_fields=['status', 'interview_status', 'updated_at'])
            elif cand.status != 'interview':
                raise InterviewSchedulingError(
                    f'{cand.name} cannot be scheduled (status: {cand.status}). '
                    'Only shortlisted or interview-stage candidates are allowed.'
                )
            overlap = find_scheduled_overlap_for_candidate(cand.pk, start, end, None)
            if overlap:
                raise InterviewSchedulingError(
                    f'{cand.name} already has a scheduled interview overlapping this slot.'
                )

            inv = Interview.objects.create(
                candidate=cand,
                scheduled_start=start,
                scheduled_end=end,
                duration_minutes=duration,
                timezone=tz_name,
                mode=mode,
                platform=platform,
                meeting_link=meeting_link,
                office_address=office_address,
                location_notes=location_notes,
                interviewer_name=interviewer_name,
                notes=notes,
                status=Interview.STATUS_SCHEDULED,
                bulk_batch_id=batch_id,
                created_by=user if getattr(user, 'is_authenticated', False) else None,
            )
            sync_candidate_interview_snapshot(cand, inv)
            created.append(inv)
            queue_sync_interview_reminders(inv)

        write_audit(
            user,
            InterviewBulkAuditLog.ACTION_SCHEDULE,
            candidate_ids,
            {
                'batch_id': str(batch_id),
                'scheduled_start': start.isoformat(),
                'timezone': tz_name,
                'mode': mode,
                'affected_count': len(candidate_ids),
            },
        )

    return {
        'batch_id': str(batch_id),
        'created_interview_ids': [str(i.pk) for i in created],
        'affected_count': len(created),
    }


def run_bulk_reschedule(user, raw_candidate_ids, payload: dict) -> dict:
    """Update each candidate's current scheduled interview to the new slot."""
    candidate_ids = _normalize_candidate_ids(raw_candidate_ids)
    candidates = _load_candidates_for_bulk(candidate_ids)

    date_s = (payload.get('date') or '').strip()
    time_s = (payload.get('time') or '').strip()
    tz_name = hr_timezone_name()
    start = parse_local_datetime(date_s, time_s, tz_name)
    ensure_interview_not_in_past(
        start,
        tz_name,
        date_s=date_s,
        time_s=time_s,
        request_payload=_schedule_audit_payload(payload),
        audit_source='run_bulk_reschedule',
    )

    duration = int(payload.get('duration_minutes') or 60)
    end = compute_end(start, duration)

    mode, meeting_link, office_address, platform = validate_mode_fields(
        payload.get('interview_type') or payload.get('mode'),
        payload.get('meeting_link') or payload.get('interview_meeting_link'),
        payload.get('office_address') or payload.get('interview_venue_address'),
        payload.get('platform') or '',
    )
    location_notes = (payload.get('location_notes') or '').strip()
    interviewer_name = (payload.get('interviewer') or payload.get('interviewer_name') or '').strip()
    notes = (payload.get('notes') or '').strip()

    updated: List[Interview] = []
    inv_map = {}
    for cand in candidates:
        inv = (
            Interview.objects.filter(candidate_id=cand.pk, status=Interview.STATUS_SCHEDULED)
            .order_by('-scheduled_start')
            .first()
        )
        if not inv:
            raise InterviewSchedulingError(f'No scheduled interview found for {cand.name}.')
        inv_map[str(cand.pk)] = inv
    batch_inv_ids = [inv.pk for inv in inv_map.values()]

    with transaction.atomic():
        for cand in candidates:
            cand = Candidate.objects.select_for_update().select_related('job_opening').get(pk=cand.pk)
            if cand.status != 'interview':
                raise InterviewSchedulingError(
                    f'{cand.name} is not in interview stage; cannot reschedule.'
                )
            inv = inv_map[str(cand.pk)]

            conflict = find_interviewer_conflict(
                interviewer_name, start, end, exclude_interview_ids=batch_inv_ids
            )
            if conflict:
                raise InterviewSchedulingError(
                    f'Interviewer "{interviewer_name}" has an overlapping interview scheduled.'
                )

            overlap = find_scheduled_overlap_for_candidate(cand.pk, start, end, exclude_interview_id=inv.pk)
            if overlap:
                raise InterviewSchedulingError(
                    f'{cand.name} would overlap another scheduled interview for the same candidate.'
                )

            inv.scheduled_start = start
            inv.scheduled_end = end
            inv.duration_minutes = duration
            inv.timezone = tz_name
            inv.mode = mode
            inv.platform = platform
            inv.meeting_link = meeting_link
            inv.office_address = office_address
            inv.location_notes = location_notes
            inv.interviewer_name = interviewer_name
            inv.notes = notes
            inv.updated_by = user if getattr(user, 'is_authenticated', False) else None
            inv.save()
            sync_candidate_interview_snapshot(cand, inv)
            updated.append(inv)
            queue_sync_interview_reminders(inv)

        write_audit(
            user,
            InterviewBulkAuditLog.ACTION_RESCHEDULE,
            candidate_ids,
            {
                'scheduled_start': start.isoformat(),
                'timezone': tz_name,
                'mode': mode,
                'affected_count': len(candidate_ids),
            },
        )

    return {
        'updated_interview_ids': [str(i.pk) for i in updated],
        'affected_count': len(updated),
    }


def run_bulk_cancel(user, raw_candidate_ids) -> dict:
    candidate_ids = _normalize_candidate_ids(raw_candidate_ids)
    candidates = _load_candidates_for_bulk(candidate_ids)
    cancelled_ids: List[str] = []

    with transaction.atomic():
        for cand in candidates:
            cand = Candidate.objects.select_for_update().get(pk=cand.pk)
            if cand.status != 'interview':
                raise InterviewSchedulingError(
                    f'{cand.name} is not in interview stage; only cancel interviews for interview-stage candidates.'
                )
            qs = Interview.objects.filter(candidate=cand, status=Interview.STATUS_SCHEDULED)
            if not qs.exists():
                raise InterviewSchedulingError(f'No scheduled interview to cancel for {cand.name}.')
            for inv in qs:
                inv.status = Interview.STATUS_CANCELLED
                inv.updated_by = user if getattr(user, 'is_authenticated', False) else None
                inv.save(update_fields=['status', 'updated_by', 'updated_at'])
                cancelled_ids.append(str(inv.pk))
                queue_cancel_interview_reminders(inv)
            clear_candidate_interview_snapshot_if_none_scheduled(cand)

        write_audit(
            user,
            InterviewBulkAuditLog.ACTION_CANCEL,
            candidate_ids,
            {'cancelled_interview_ids': cancelled_ids, 'affected_count': len(candidate_ids)},
        )

    return {'cancelled_interview_ids': cancelled_ids, 'affected_count': len(candidate_ids)}
