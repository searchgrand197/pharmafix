"""
Email notifications for employee attendance regularization requests.

Notifications are best-effort: SMTP failures must never block the workflow.
"""

from __future__ import annotations

import logging
import sys

from django.conf import settings
from django.db import transaction
from django.utils import timezone
from email.mime.text import MIMEText

logger = logging.getLogger(__name__)


def _employee_email(regularization) -> str | None:
    employee = regularization.employee
    if employee.email:
        return employee.email
    if employee.user_id and getattr(employee.user, 'email', None):
        return employee.user.email
    return None


def _format_punch(value) -> str:
    if not value:
        return '—'
    return timezone.localtime(value).strftime('%d %b %Y, %I:%M %p')


def _regularization_date(regularization):
    if regularization.attendance_id and regularization.attendance:
        return regularization.attendance.date
    for value in (regularization.requested_check_in, regularization.requested_check_out):
        if value:
            return timezone.localdate(value)
    return timezone.localdate(regularization.created_at)


def _hr_recipient_emails(employee) -> list[str]:
    emails: list[str] = []
    if employee.hospital_id:
        from django.contrib.auth import get_user_model

        User = get_user_model()
        emails = list(
            User.objects.filter(
                hospital_id=employee.hospital_id,
                is_staff=True,
                is_active=True,
            )
            .exclude(email='')
            .values_list('email', flat=True)[:10]
        )
    if emails:
        return emails

    try:
        from apps.hr.organization_branding import get_organization_settings

        org = get_organization_settings(employee.hospital_id)
        hr_email = (getattr(org, 'hr_email', None) or getattr(org, 'company_email', None) or '').strip()
        if hr_email:
            return [hr_email]
    except Exception:
        logger.debug('[regularization-notify] could not resolve org HR email', exc_info=True)
    return []


def _portal_hr_regularizations_url() -> str:
    from config.frontend_url import get_frontend_base_url

    return f'{get_frontend_base_url()}/hr/operations/regularizations'


def _portal_employee_attendance_url() -> str:
    from config.frontend_url import get_frontend_base_url

    return f'{get_frontend_base_url()}/employee/attendance'


def _build_mime_message(subject: str, body: str, recipients: list[str]) -> MIMEText:
    msg = MIMEText(body, 'plain', 'utf-8')
    msg['Subject'] = subject
    msg['From'] = getattr(settings, 'DEFAULT_FROM_EMAIL', '') or ''
    msg['To'] = ', '.join(recipients)
    return msg


def _running_tests() -> bool:
    return 'test' in sys.argv


def _send(subject: str, body: str, to: list[str]) -> bool:
    recipients = [addr for addr in to if addr]
    if not recipients:
        return False
    if _running_tests():
        logger.debug('[regularization-notify] skipped SMTP during tests to=%s', recipients)
        return False
    try:
        from apps.hr.email_utils import _safe_smtp_send, smtp_send_ok

        msg = _build_mime_message(subject, body, recipients)
        return smtp_send_ok(_safe_smtp_send(msg))
    except Exception:
        logger.exception(
            '[regularization-notify] failed to send email to=%s subject=%s',
            recipients,
            subject,
        )
        return False


def notify_regularization_submitted(regularization) -> dict:
    employee = regularization.employee
    att_date = _regularization_date(regularization)
    review_url = _portal_hr_regularizations_url()
    subject = f'Attendance correction requested — {employee.name}'
    body = (
        f'Hello,\n\n'
        f'An employee has submitted a missed punch / attendance correction request.\n\n'
        f'Employee: {employee.name} ({employee.employee_id or "—"})\n'
        f'Date: {att_date}\n'
        f'Requested check-in: {_format_punch(regularization.requested_check_in)}\n'
        f'Requested check-out: {_format_punch(regularization.requested_check_out)}\n'
        f'Reason: {regularization.reason or "—"}\n'
        f'Status: Pending HR review\n\n'
        f'Review in HR Operations → Regularization Requests:\n'
        f'{review_url}\n'
    )
    hr_emails = _hr_recipient_emails(employee)
    sent_hr = _send(subject, body, hr_emails)

    emp_email = _employee_email(regularization)
    emp_subject = 'Your attendance correction request has been submitted'
    emp_body = (
        f'Hello {employee.name},\n\n'
        f'Your attendance correction request for {att_date} has been submitted '
        f'and is pending HR approval.\n\n'
        f'Requested check-in: {_format_punch(regularization.requested_check_in)}\n'
        f'Requested check-out: {_format_punch(regularization.requested_check_out)}\n'
        f'Reason: {regularization.reason or "—"}\n\n'
        f'You will be notified once HR reviews your request.\n'
    )
    sent_emp = _send(emp_subject, emp_body, [emp_email] if emp_email else [])

    from apps.hr.employee_portal_notifications import notify_regularization_portal_event

    notify_regularization_portal_event(regularization, event='submitted')

    return {
        'event': 'submitted',
        'sent_hr': sent_hr,
        'sent_employee': sent_emp,
        'hr_recipients': hr_emails,
        'at': timezone.now().isoformat(),
    }


def schedule_regularization_submitted_notification(regularization_id) -> None:
    def _run():
        from apps.hr.models import AttendanceRegularization

        regularization = (
            AttendanceRegularization.objects.select_related(
                'employee',
                'employee__user',
                'attendance',
            )
            .filter(pk=regularization_id)
            .first()
        )
        if not regularization:
            return
        event = notify_regularization_submitted(regularization)
        logger.info(
            '[regularization-notify] submitted request=%s sent_hr=%s sent_employee=%s recipients=%s',
            regularization_id,
            event.get('sent_hr'),
            event.get('sent_employee'),
            event.get('hr_recipients'),
        )

    transaction.on_commit(_run)


def notify_regularization_reviewed(regularization, *, action: str) -> dict:
    employee = regularization.employee
    att_date = _regularization_date(regularization)
    status_label = 'approved' if action == 'approved' else 'rejected'
    remarks = regularization.reviewer_remarks or '—'
    attendance_url = _portal_employee_attendance_url()
    subject = f'Attendance correction {status_label} — {att_date}'
    body = (
        f'Hello {employee.name},\n\n'
        f'Your attendance correction request has been {status_label}.\n\n'
        f'Date: {att_date}\n'
        f'Requested check-in: {_format_punch(regularization.requested_check_in)}\n'
        f'Requested check-out: {_format_punch(regularization.requested_check_out)}\n'
        f'Your reason: {regularization.reason or "—"}\n'
        f'HR remarks: {remarks}\n'
    )
    if action == 'approved':
        body += (
            f'\nYour attendance record for this date has been updated.\n'
            f'View your attendance: {attendance_url}\n'
        )
    else:
        body += '\nNo changes were made to your attendance record.\n'
    body += (
        f'\nReviewed on: {regularization.reviewed_at or timezone.now()}\n'
    )
    emp_email = _employee_email(regularization)
    sent = _send(subject, body, [emp_email] if emp_email else [])

    from apps.hr.employee_portal_notifications import notify_regularization_portal_event

    notify_regularization_portal_event(regularization, event=action)

    return {
        'event': action,
        'sent_employee': sent,
        'at': timezone.now().isoformat(),
    }


def schedule_regularization_reviewed_notification(regularization_id, *, action: str) -> None:
    def _run():
        from apps.hr.models import AttendanceRegularization

        regularization = (
            AttendanceRegularization.objects.select_related(
                'employee',
                'employee__user',
                'attendance',
            )
            .filter(pk=regularization_id)
            .first()
        )
        if not regularization:
            return
        event = notify_regularization_reviewed(regularization, action=action)
        logger.info(
            '[regularization-notify] %s request=%s sent_employee=%s',
            action,
            regularization_id,
            event.get('sent_employee'),
        )

    transaction.on_commit(_run)
