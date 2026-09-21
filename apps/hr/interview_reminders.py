"""Interview reminder scheduling, sync on interview changes, and worker dispatch."""
from __future__ import annotations

import logging
from datetime import datetime, timedelta
from typing import Dict, List, Tuple

from django.db import transaction
from django.utils import timezone

from apps.hr.models import Interview, InterviewReminder

logger = logging.getLogger(__name__)

REMINDER_1_HOUR = InterviewReminder.REMINDER_1_HOUR
REMINDER_10_MIN = InterviewReminder.REMINDER_10_MIN

DEFAULT_OFFSETS: Dict[str, timedelta] = {
    REMINDER_1_HOUR: timedelta(hours=1),
    REMINDER_10_MIN: timedelta(minutes=10),
}


def compute_reminder_fire_times(interview: Interview) -> List[Tuple[str, datetime]]:
    """
    Return (reminder_type, fire_at_utc) pairs for a scheduled interview.
    Skips fire times in the past and non-scheduled interviews.
    """
    if interview.status != Interview.STATUS_SCHEDULED:
        return []

    now = timezone.now()
    start = interview.scheduled_start
    if timezone.is_naive(start):
        start = timezone.make_aware(start, timezone.utc)

    result: List[Tuple[str, datetime]] = []
    for reminder_type, offset in DEFAULT_OFFSETS.items():
        fire_at = start - offset
        if fire_at > now:
            result.append((reminder_type, fire_at))
    return result


def resolve_hr_recipient_email(interview: Interview) -> str:
    """HR inbox for reminder copies: scheduler user, then org HR email."""
    created_by = getattr(interview, 'created_by', None)
    if created_by and (getattr(created_by, 'email', None) or '').strip():
        return created_by.email.strip()

    from apps.hr.organization_branding import resolve_hospital_id, get_organization_settings

    hospital_id = resolve_hospital_id(candidate=getattr(interview, 'candidate', None))
    settings = get_organization_settings(hospital_id)
    hr_email = (settings.hr_email or '').strip()
    if hr_email:
        return hr_email

    return ''


@transaction.atomic
def sync_interview_reminders(interview: Interview) -> int:
    """
    Replace pending reminders for an interview with rows for 1h and 10m before start.
    Returns number of reminders created.
    """
    interview = Interview.objects.select_for_update().get(pk=interview.pk)
    if interview.status != Interview.STATUS_SCHEDULED:
        InterviewReminder.objects.filter(interview=interview, is_sent=False).delete()
        return 0

    InterviewReminder.objects.filter(interview=interview, is_sent=False).delete()

    fire_times = compute_reminder_fire_times(interview)
    if not fire_times:
        return 0

    rows = [
        InterviewReminder(
            interview=interview,
            reminder_type=reminder_type,
            scheduled_time=fire_at,
        )
        for reminder_type, fire_at in fire_times
    ]
    InterviewReminder.objects.bulk_create(rows, ignore_conflicts=True)
    logger.info(
        '[interview-reminder] synced interview=%s reminders=%s',
        interview.pk,
        [r.reminder_type for r in rows],
    )
    return len(rows)


def cancel_interview_reminders(interview: Interview) -> int:
    """Remove pending reminders when interview is cancelled or completed."""
    deleted, _ = InterviewReminder.objects.filter(
        interview=interview,
        is_sent=False,
    ).delete()
    if deleted:
        logger.info('[interview-reminder] cancelled pending reminders interview=%s count=%s', interview.pk, deleted)
    return deleted


def queue_sync_interview_reminders(interview: Interview) -> None:
    """Run sync after the surrounding DB transaction commits."""
    interview_id = interview.pk
    transaction.on_commit(lambda: _sync_by_id(interview_id))


def queue_cancel_interview_reminders(interview: Interview) -> None:
    interview_id = interview.pk
    transaction.on_commit(lambda: _cancel_by_id(interview_id))


def _sync_by_id(interview_id) -> None:
    try:
        inv = Interview.objects.get(pk=interview_id)
    except Interview.DoesNotExist:
        return
    sync_interview_reminders(inv)


def _cancel_by_id(interview_id) -> None:
    try:
        inv = Interview.objects.get(pk=interview_id)
    except Interview.DoesNotExist:
        return
    cancel_interview_reminders(inv)


def process_due_reminders(*, batch_size: int = 200) -> dict:
    """
    Send all due reminders. Returns stats dict for logging/management command.
    """
    from apps.hr.email_utils import send_interview_reminder_email

    now = timezone.now()
    stats = {'processed': 0, 'sent': 0, 'failed': 0, 'skipped': 0}

    due_ids = list(
        InterviewReminder.objects.filter(
            is_sent=False,
            scheduled_time__lte=now,
            interview__status=Interview.STATUS_SCHEDULED,
        )
        .order_by('scheduled_time')
        .values_list('pk', flat=True)[:batch_size]
    )

    for reminder_id in due_ids:
        stats['processed'] += 1
        with transaction.atomic():
            try:
                reminder = (
                    InterviewReminder.objects.select_for_update()
                    .select_related(
                        'interview',
                        'interview__candidate',
                        'interview__candidate__job_opening',
                        'interview__created_by',
                    )
                    .get(pk=reminder_id)
                )
            except InterviewReminder.DoesNotExist:
                continue

            if reminder.is_sent:
                stats['skipped'] += 1
                continue

            interview = reminder.interview
            if interview.status != Interview.STATUS_SCHEDULED:
                reminder.is_sent = True
                reminder.sent_at = now
                reminder.error_message = 'skipped: interview not scheduled'
                reminder.save(update_fields=['is_sent', 'sent_at', 'error_message', 'updated_at'])
                stats['skipped'] += 1
                continue

            if interview.scheduled_start <= now:
                reminder.is_sent = True
                reminder.sent_at = now
                reminder.error_message = 'skipped: interview already started'
                reminder.save(update_fields=['is_sent', 'sent_at', 'error_message', 'updated_at'])
                stats['skipped'] += 1
                continue

            candidate = interview.candidate
            cand_ok = send_interview_reminder_email(
                interview,
                to_email=(candidate.email or '').strip(),
                audience='candidate',
                reminder_type=reminder.reminder_type,
            )
            hr_email = resolve_hr_recipient_email(interview)
            hr_ok = True
            if hr_email:
                hr_ok = send_interview_reminder_email(
                    interview,
                    to_email=hr_email,
                    audience='hr',
                    reminder_type=reminder.reminder_type,
                )
            else:
                logger.warning(
                    '[interview-reminder] no HR email interview=%s reminder=%s',
                    interview.pk,
                    reminder.reminder_type,
                )

            if cand_ok and hr_ok:
                reminder.is_sent = True
                reminder.sent_at = now
                reminder.error_message = ''
                reminder.save(update_fields=['is_sent', 'sent_at', 'error_message', 'updated_at'])
                stats['sent'] += 1
            else:
                errors = []
                if not cand_ok:
                    errors.append('candidate email failed')
                if hr_email and not hr_ok:
                    errors.append('HR email failed')
                reminder.error_message = '; '.join(errors) or 'send failed'
                reminder.save(update_fields=['error_message', 'updated_at'])
                stats['failed'] += 1

    return stats


def sync_all_scheduled_interviews() -> int:
    """Backfill reminders for future scheduled interviews."""
    count = 0
    qs = Interview.objects.filter(
        status=Interview.STATUS_SCHEDULED,
        scheduled_start__gt=timezone.now(),
    )
    for inv in qs.iterator():
        sync_interview_reminders(inv)
        count += 1
    return count
