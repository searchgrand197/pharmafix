"""

Email notifications for HR leave requests (LeaveRequest model).

Notifications are best-effort: SMTP failures must never block leave workflow.

"""

from __future__ import annotations



import logging
import sys

from django.conf import settings

from django.db import transaction

from django.utils import timezone

from email.mime.text import MIMEText



logger = logging.getLogger(__name__)





def _employee_email(leave_request) -> str | None:

    employee = leave_request.employee

    if employee.email:

        return employee.email

    if employee.user_id and getattr(employee.user, 'email', None):

        return employee.user.email

    return None





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
        logger.debug('[leave-notify] skipped SMTP during tests to=%s', recipients)
        return False

    try:

        from apps.hr.email_utils import _safe_smtp_send, smtp_send_ok



        msg = _build_mime_message(subject, body, recipients)

        return smtp_send_ok(_safe_smtp_send(msg))

    except Exception:

        logger.exception('[leave-notify] failed to send email to=%s subject=%s', recipients, subject)

        return False





def _append_notification_event(leave_request_id, event: dict) -> None:

    from apps.hr.models import LeaveRequest



    leave_request = LeaveRequest.objects.filter(pk=leave_request_id).first()

    if not leave_request:

        return

    events = list(leave_request.notification_events or [])

    if events and events[-1].get('pending_notification'):

        events[-1] = event

    else:

        events.append(event)

    LeaveRequest.objects.filter(pk=leave_request_id).update(notification_events=events)





def pending_notification_event(event: str) -> dict:

    return {

        'event': event,

        'pending_notification': True,

        'at': timezone.now().isoformat(),

    }





def schedule_leave_submitted_notification(leave_request_id) -> None:

    def _run():

        from apps.hr.models import LeaveRequest



        leave_request = (

            LeaveRequest.objects.select_related('employee', 'leave_type', 'employee__user')

            .filter(pk=leave_request_id)

            .first()

        )

        if not leave_request:

            return

        event = notify_leave_submitted(leave_request)

        _append_notification_event(leave_request_id, event)



    transaction.on_commit(_run)





def schedule_leave_reviewed_notification(leave_request_id, *, action: str) -> None:

    def _run():

        from apps.hr.models import LeaveRequest



        leave_request = (

            LeaveRequest.objects.select_related('employee', 'leave_type', 'employee__user')

            .filter(pk=leave_request_id)

            .first()

        )

        if not leave_request:

            return

        event = notify_leave_reviewed(leave_request, action=action)

        _append_notification_event(leave_request_id, event)



    transaction.on_commit(_run)





def notify_leave_submitted(leave_request) -> dict:

    employee = leave_request.employee

    subject = f'Leave request submitted — {employee.name}'

    body = (

        f'Hello,\n\n'

        f'A new leave request has been submitted.\n\n'

        f'Employee: {employee.name} ({employee.employee_id or "—"})\n'

        f'Type: {leave_request.leave_type.name}\n'

        f'Dates: {leave_request.start_date} to {leave_request.end_date}\n'

        f'Days: {leave_request.number_of_days}\n'

        f'Reason: {leave_request.reason or "—"}\n'

        f'Status: Pending HR review\n\n'

        f'Please review in the HR Leave Management dashboard.\n'

    )

    hr_emails = []

    if employee.hospital_id:

        from django.contrib.auth import get_user_model

        User = get_user_model()

        hr_emails = list(

            User.objects.filter(hospital_id=employee.hospital_id, is_staff=True, is_active=True)

            .exclude(email='')

            .values_list('email', flat=True)[:10]

        )

    sent_hr = _send(subject, body, hr_emails)

    emp_email = _employee_email(leave_request)

    emp_subject = 'Your leave request has been submitted'

    emp_body = (

        f'Hello {employee.name},\n\n'

        f'Your leave request ({leave_request.leave_type.name}, '

        f'{leave_request.start_date} to {leave_request.end_date}) has been submitted and is pending HR approval.\n\n'

        f'You will receive another email once HR reviews your request.\n'

    )

    sent_emp = _send(emp_subject, emp_body, [emp_email] if emp_email else [])

    from apps.hr.employee_portal_notifications import notify_leave_portal_event

    notify_leave_portal_event(leave_request, event='submitted')

    return {

        'event': 'submitted',

        'sent_hr': sent_hr,

        'sent_employee': sent_emp,

        'at': timezone.now().isoformat(),

    }





def notify_leave_reviewed(leave_request, *, action: str) -> dict:

    employee = leave_request.employee

    status_label = 'approved' if action == 'approved' else 'rejected'

    subject = f'Leave request {status_label} — {leave_request.leave_type.name}'

    remarks = leave_request.remarks or '—'

    body = (

        f'Hello {employee.name},\n\n'

        f'Your leave request has been {status_label}.\n\n'

        f'Type: {leave_request.leave_type.name}\n'

        f'Dates: {leave_request.start_date} to {leave_request.end_date}\n'

        f'Days: {leave_request.number_of_days}\n'

        f'HR remarks: {remarks}\n\n'

        f'Reviewed on: {leave_request.reviewed_on or timezone.now()}\n'

    )

    sent = _send(subject, body, [_employee_email(leave_request) or ''])

    from apps.hr.employee_portal_notifications import notify_leave_portal_event

    notify_leave_portal_event(leave_request, event=action)

    return {

        'event': action,

        'sent_employee': sent,

        'at': timezone.now().isoformat(),

    }


