"""
Email utilities for the HR recruitment module.

Sends emails for:
- Job application confirmation
- Candidate shortlist notification
- Candidate rejection notification
- Interview scheduling
- Offer letters
- Offer revocations
- Onboarding portal (initial) and verification-complete welcome after HR activates the employee
"""

import smtplib
import ssl
import threading
import time
import os
from email.utils import format_datetime
from email.message import EmailMessage
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from email.mime.application import MIMEApplication
from zoneinfo import ZoneInfo
from django.conf import settings
from django.utils import timezone
from django.utils.html import escape, format_html
import logging

logger = logging.getLogger(__name__)
IST = ZoneInfo("Asia/Kolkata")


def _branded_email_bodies(plain_main: str, html_inner: str, **resolve_kw):
    from apps.hr.organization_branding import append_branded_signature

    return append_branded_signature(plain_main, html_inner, **resolve_kw)


def _local_email_time():
    return timezone.now().astimezone(IST)


def _format_ist_display(dt=None):
    local_dt = (dt or timezone.now()).astimezone(IST)
    return local_dt.strftime("%d %b %Y, %I:%M %p IST")


def _stamp_ist_headers(msg):
    """Make SMTP-created messages carry an explicit Indian local timestamp."""
    sent_at = _local_email_time()
    for header in ("Date", "X-Curevice-Local-Time", "X-Curevice-Time-Zone"):
        if header in msg:
            del msg[header]
    msg["Date"] = format_datetime(sent_at)
    msg["X-Curevice-Local-Time"] = _format_ist_display(sent_at)
    msg["X-Curevice-Time-Zone"] = "Asia/Kolkata"
    return sent_at


def send_in_background(func, *args, **kwargs):
    """Helper to send emails in a background thread to prevent blocking the UI."""
    thread = threading.Thread(target=func, args=args, kwargs=kwargs)
    thread.daemon = True
    thread.start()
    return True

def _smtp_ssl_context():
    """TLS context for SMTP (certifi when available)."""
    try:
        import certifi

        return ssl.create_default_context(cafile=certifi.where())
    except Exception:
        ctx = ssl.create_default_context()
        ctx.check_hostname = True
        ctx.verify_mode = ssl.CERT_REQUIRED
        return ctx


def smtp_send_ok(result) -> bool:
    """True when an SMTP send succeeded (handles bool or (ok, error) tuple)."""
    if isinstance(result, tuple):
        return bool(result[0])
    return bool(result)


def smtp_send_error(result, default: str = 'SMTP delivery failed') -> str:
    """Error text from an SMTP send result."""
    if isinstance(result, tuple) and len(result) > 1:
        return (result[1] or default)[:2000]
    return '' if smtp_send_ok(result) else default


def _smtp_transport_strategies():
    """
    Ordered (host, port, use_ssl, use_tls) attempts.
    GoDaddy / secureserver often works on 587+STARTTLS when 465+SSL closes abruptly.
    """
    host = settings.EMAIL_HOST
    port = settings.EMAIL_PORT
    use_ssl = getattr(settings, 'EMAIL_USE_SSL', False)
    use_tls = getattr(settings, 'EMAIL_USE_TLS', False)

    strategies = [(host, port, use_ssl, use_tls)]
    seen = {strategies[0]}

    if use_ssl and port == 465:
        alt = (host, 587, False, True)
        if alt not in seen:
            strategies.append(alt)
            seen.add(alt)

    if not use_ssl and use_tls and port == 587:
        alt = (host, 465, True, False)
        if alt not in seen:
            strategies.append(alt)

    return strategies


def _smtp_send_once(msg, host, port, use_ssl, use_tls, user_smtp, pwd_smtp, context, timeout=60):
    if use_ssl:
        with smtplib.SMTP_SSL(host, port, context=context, timeout=timeout) as server:
            server.ehlo()
            if user_smtp and pwd_smtp:
                server.login(user_smtp, pwd_smtp)
            server.send_message(msg)
        return

    with smtplib.SMTP(host, port, timeout=timeout) as server:
        server.ehlo()
        if use_tls:
            server.starttls(context=context)
            server.ehlo()
        if user_smtp and pwd_smtp:
            server.login(user_smtp, pwd_smtp)
        server.send_message(msg)


def _safe_smtp_send(msg, context=None) -> tuple[bool, str]:
    """
    Internal helper to send an email with retries and robust timeout handling.
    Works for both simple EmailMessage and MIMEMultipart.

    Returns (success, error_message).
    """
    user_smtp = settings.EMAIL_HOST_USER
    pwd_smtp = settings.EMAIL_HOST_PASSWORD

    if not pwd_smtp:
        err = 'EMAIL_HOST_PASSWORD not configured'
        logger.error(
            '[hr-email] EMAIL_HOST_PASSWORD is not set — cannot send mail. '
            'Set it in .env and restart Django.'
        )
        print('[hr-email] SKIPPED: EMAIL_HOST_PASSWORD not configured')
        return False, err

    if context is None:
        context = _smtp_ssl_context()

    sent_at = _stamp_ist_headers(msg)
    strategies = _smtp_transport_strategies()
    last_error = None
    attempt = 0

    for host, port, use_ssl, use_tls in strategies:
        mode = 'SSL' if use_ssl else ('STARTTLS' if use_tls else 'plain')
        for retry in range(1, 4):
            attempt += 1
            try:
                print(
                    f'[hr-email] Sending attempt {attempt} to {host}:{port} ({mode}) '
                    f'at {sent_at:%d %b %Y %I:%M %p IST} (timeout=60s)...'
                )
                _smtp_send_once(
                    msg, host, port, use_ssl, use_tls, user_smtp, pwd_smtp, context,
                )
                print(f'[hr-email] SUCCESS: Email sent on attempt {attempt} ({host}:{port} {mode})')
                return True, ''
            except smtplib.SMTPServerDisconnected as e:
                last_error = e
                print(
                    f'[hr-email] Attempt {attempt} failed ({host}:{port} {mode}): {e} '
                    '(server closed during login — check EMAIL_HOST_USER is the full email '
                    'and EMAIL_HOST_PASSWORD matches GoDaddy webmail; reset password if unsure)'
                )
                if retry < 3:
                    time.sleep(2)
            except Exception as e:
                last_error = e
                print(f'[hr-email] Attempt {attempt} failed ({host}:{port} {mode}): {e}')
                if retry < 3:
                    time.sleep(2)

    logger.error(
        '[hr-email] ALL ATTEMPTS FAILED. Last error: %s. '
        'SMTP reached the server but login likely failed — verify GoDaddy mailbox password '
        'and that SMTP is enabled for %s. If email is Microsoft 365 use EMAIL_HOST=smtp.office365.com. '
        'Run: python manage.py test_email',
        last_error,
        user_smtp,
    )
    print('[hr-email] ALL ATTEMPTS FAILED for email.')
    err = str(last_error) if last_error else 'SMTP delivery failed'
    return False, err[:2000]

def send_job_application_email(candidate, job):
    """Wrapper for background sending."""
    return send_in_background(_send_job_application_email_core, candidate, job)

def _send_job_application_email_core(candidate, job):
    """Core logic for job application confirmation."""
    from_email = (settings.DEFAULT_FROM_EMAIL or '').strip()
    to_email = (candidate.email or '').strip()
    if not to_email:
        logger.warning(
            '[hr-email] application email skipped: no recipient candidate_id=%s',
            candidate.pk,
        )
        return False
    if not from_email:
        logger.warning('[hr-email] application email skipped: DEFAULT_FROM_EMAIL not configured')
        return False

    candidate_name = candidate.name
    job_title = job.title

    subject = f"Application Received - {job_title}"

    plain_main = f"""Dear {candidate_name},

Thank you for applying for the position of {job_title} at our organization.

We have received your application and will review it shortly. If your profile matches our requirements, our HR team will contact you for further rounds of the selection process."""

    html_inner = f"""
            <h2 style="margin-top: 0; color: #111827;">Application received</h2>
            <p>Dear <strong>{escape(candidate_name)}</strong>,</p>
            <p>Thank you for applying for the position of <strong>{escape(job_title)}</strong> at our organization.</p>
            <p>We have received your application and will review it shortly. If your profile matches our requirements, our HR team will contact you for further rounds of the selection process.</p>
    """
    text_body, html_content = _branded_email_bodies(plain_main, html_inner, job=job, candidate=candidate)

    msg = MIMEMultipart('alternative')
    msg["Subject"] = subject
    msg["From"] = from_email
    msg["To"] = to_email
    msg.attach(MIMEText(text_body, 'plain'))
    msg.attach(MIMEText(html_content, 'html'))

    return _safe_smtp_send(msg)

def send_candidate_status_email(
    candidate,
    new_status,
    interview_date=None,
    interview_type=None,
    interview_meeting_link=None,
    interview_venue_address=None,
):
    """Wrapper for background sending."""
    return send_in_background(
        _send_candidate_status_email_core,
        candidate,
        new_status,
        interview_date=interview_date,
        interview_type=interview_type,
        interview_meeting_link=interview_meeting_link,
        interview_venue_address=interview_venue_address,
    )


def _format_candidate_email_time(value=None):
    if not value:
        return _format_ist_display()
    if timezone.is_naive(value):
        value = timezone.make_aware(value, timezone.get_current_timezone())
    return _format_ist_display(value)


def _interview_mode_label(interview_type):
    if interview_type == 'online':
        return 'Online'
    if interview_type == 'offline':
        return 'Offline'
    return interview_type or '—'


def _send_candidate_status_email_core(
    candidate,
    new_status,
    interview_date=None,
    interview_type=None,
    interview_meeting_link=None,
    interview_venue_address=None,
):
    """Core logic for status update emails."""
    from_email = settings.DEFAULT_FROM_EMAIL
    to_email = (candidate.email or '').strip()
    if not to_email:
        logger.warning('[hr-email] candidate status email skipped: no email candidate_id=%s status=%s', candidate.pk, new_status)
        return False
    candidate_name = candidate.name
    job_title = getattr(getattr(candidate, 'job_opening', None), 'title', None) or 'the role'
    
    if new_status == 'shortlisted':
        subject = f"You have been shortlisted for {job_title}"
        heading = "You have been shortlisted"
        message = f"Congratulations! Your application for the position of {job_title} has been shortlisted.\n\nOur HR team will contact you soon to schedule the next round."
    elif new_status == 'rejected':
        subject = f"Application Status - {job_title}"
        heading = "Application update"
        message = f"Thank you for your interest in the position of {job_title}.\n\nAfter careful consideration, we regret to inform you that your application has not been selected at this time."
    elif new_status == 'interview':
        subject = f"Interview Scheduled - {job_title}"
        heading = "Interview scheduled"
        mode_label = _interview_mode_label(interview_type)
        detail_lines = []
        if interview_date:
            detail_lines.append(f"Date & time: {_format_candidate_email_time(interview_date)}")
        detail_lines.append(f"Mode: {mode_label}")
        link = (interview_meeting_link or "").strip()
        venue = (interview_venue_address or "").strip()
        if interview_type == 'online' and link:
            detail_lines.append(f"Join link: {link}")
        elif interview_type == 'offline' and venue:
            detail_lines.append(f"Venue / address: {venue}")
        details_block = ("\n" + "\n".join(detail_lines)) if detail_lines else ""
        message = f"Your interview for {job_title} has been scheduled.{details_block}\n\nPlease be prepared."
    elif new_status == 'selected':
        subject = f"Congratulations - Selected for {job_title}"
        heading = "Application selected"
        message = f"Congratulations! You have been selected for the position of {job_title}.\n\nOur HR team will contact you with offer details soon."
    else:
        return False
    
    plain_main = f"Dear {candidate_name},\n\n{message}"
    html_message = escape(message).replace('\n', '<br>')
    interview_link_html = ''
    if new_status == 'interview' and interview_type == 'online':
        link_raw = (interview_meeting_link or '').strip()
        if link_raw.startswith(('http://', 'https://')):
            interview_link_html = str(format_html(
                '<p style="margin-top: 16px;"><a href="{}" style="color: #7c3aed; font-weight: 600;">Join the meeting</a></p>',
                link_raw,
            ))
    html_inner = f"""
            <h2 style="margin-top: 0; color: #111827;">{escape(heading)}</h2>
            <p>Dear <strong>{escape(candidate_name)}</strong>,</p>
            <p>{html_message}</p>
            {interview_link_html}
    """
    text_body, html_content = _branded_email_bodies(plain_main, html_inner, candidate=candidate)

    msg = MIMEMultipart('alternative')
    msg["Subject"] = subject
    msg["From"] = from_email
    msg["To"] = to_email
    msg.attach(MIMEText(text_body, 'plain'))
    msg.attach(MIMEText(html_content, 'html'))
    
    ok, err = _safe_smtp_send(msg)
    if ok:
        logger.info('[hr-email] candidate status email sent candidate_id=%s status=%s to=%s', candidate.pk, new_status, to_email)
    else:
        logger.warning('[hr-email] candidate status email failed candidate_id=%s status=%s to=%s: %s', candidate.pk, new_status, to_email, err)
    return ok, err


def send_interview_slot_email(candidate_id, interview_id, *, rescheduled=False):
    """Personalized invite / reschedule email for a single Interview row."""
    return send_in_background(
        _send_interview_slot_email_core,
        str(candidate_id),
        str(interview_id),
        rescheduled=rescheduled,
    )


def _format_interview_local_display(interview):
    from zoneinfo import ZoneInfo

    try:
        zi = ZoneInfo((interview.timezone or 'Asia/Kolkata').strip())
    except Exception:
        zi = IST
    dt = interview.scheduled_start.astimezone(zi)
    return dt.strftime('%d %b %Y, %I:%M %p')


def _send_interview_slot_email_core(candidate_id, interview_id, rescheduled=False):
    from apps.hr.models import Candidate, Interview

    from_email = settings.DEFAULT_FROM_EMAIL
    try:
        candidate = Candidate.objects.select_related('job_opening').get(pk=candidate_id)
    except Candidate.DoesNotExist:
        logger.warning('[hr-email] interview slot email skipped: candidate missing id=%s', candidate_id)
        return False
    try:
        interview = Interview.objects.get(pk=interview_id, candidate_id=candidate.pk)
    except Interview.DoesNotExist:
        logger.warning('[hr-email] interview slot email skipped: interview missing id=%s', interview_id)
        return False
    if interview.status != Interview.STATUS_SCHEDULED:
        logger.warning(
            '[hr-email] interview slot email skipped: status=%s id=%s',
            interview.status,
            interview_id,
        )
        return False

    to_email = (candidate.email or '').strip()
    if not to_email:
        logger.warning('[hr-email] interview slot email skipped: no email candidate_id=%s', candidate_id)
        return False

    candidate_name = candidate.name
    job_title = getattr(getattr(candidate, 'job_opening', None), 'title', None) or 'the role'
    when = _format_interview_local_display(interview)
    mode_label = 'Online' if interview.mode == 'online' else 'Offline'
    subject = (
        f'Interview Rescheduled - {job_title}' if rescheduled else f'Interview Scheduled - {job_title}'
    )
    heading = 'Interview rescheduled' if rescheduled else 'Interview scheduled'
    opener = (
        f'Your interview for {job_title}' + (' has been rescheduled.' if rescheduled else ' has been scheduled.')
    )

    lines = [opener, '', f'When: {when}', f'Mode: {mode_label}']
    interviewer = (interview.interviewer_name or '').strip()
    if interviewer:
        lines.append(f'Interviewer / host: {interviewer}')
    notes = (interview.notes or '').strip()
    if notes:
        lines.append(f'Notes: {notes}')

    if interview.mode == 'online':
        plat = (interview.platform or '').strip()
        if plat:
            lines.append(f'Platform: {plat}')
        link = (interview.meeting_link or '').strip()
        if link:
            lines.append(f'Join link: {link}')
    else:
        addr = (interview.office_address or '').strip()
        if addr:
            lines.append(f'Address: {addr}')
        ln = (interview.location_notes or '').strip()
        if ln:
            lines.append(f'Location / instructions: {ln}')

    lines.extend(['', 'Please arrive or join on time. If you need to reschedule, reply to this email.'])
    message = '\n'.join(lines)

    plain_main = f'Dear {candidate_name},\n\n{message}'

    link_html = ''
    link_raw = (interview.meeting_link or '').strip()
    if interview.mode == 'online' and link_raw.startswith(('http://', 'https://')):
        link_html = str(
            format_html(
                '<p style="margin-top: 16px;"><a href="{}" style="color: #7c3aed; font-weight: 600;">Join the meeting</a></p>',
                link_raw,
            )
        )

    html_message = escape(message).replace('\n', '<br>')
    html_inner = f"""
            <h2 style="margin-top: 0; color: #111827;">{escape(heading)}</h2>
            <p>Dear <strong>{escape(candidate_name)}</strong>,</p>
            <p>{html_message}</p>
            {link_html}
    """
    text_body, html_content = _branded_email_bodies(plain_main, html_inner, candidate=candidate)

    msg = MIMEMultipart('alternative')
    msg['Subject'] = subject
    msg['From'] = from_email
    msg['To'] = to_email
    msg.attach(MIMEText(text_body, 'plain'))
    msg.attach(MIMEText(html_content, 'html'))

    ok, err = _safe_smtp_send(msg)
    if ok:
        logger.info(
            '[hr-email] interview slot email sent candidate_id=%s interview_id=%s rescheduled=%s to=%s',
            candidate_id,
            interview_id,
            rescheduled,
            to_email,
        )
    else:
        logger.warning(
            '[hr-email] interview slot email failed candidate_id=%s interview_id=%s: %s',
            candidate_id,
            interview_id,
            err,
        )
    return ok, err


def _reminder_time_label(reminder_type: str) -> str:
    if reminder_type == '10_MIN_BEFORE':
        return '10 minutes'
    return '1 hour'


def _build_interview_reminder_content(interview, *, audience: str, reminder_type: str):
    """Build subject, plain body, and HTML inner for interview reminders."""
    candidate = interview.candidate
    job_title = getattr(getattr(candidate, 'job_opening', None), 'title', None) or 'the role'
    candidate_name = candidate.name
    when = _format_interview_local_display(interview)
    mode_label = 'Online' if interview.mode == 'online' else 'Offline'
    time_label = _reminder_time_label(reminder_type)

    detail_lines = [f'When: {when}', f'Mode: {mode_label}']
    interviewer = (interview.interviewer_name or '').strip()
    if interviewer:
        detail_lines.append(f'Interviewer / host: {interviewer}')
    notes = (interview.notes or '').strip()
    if notes:
        detail_lines.append(f'Notes: {notes}')

    if interview.mode == 'online':
        plat = (interview.platform or '').strip()
        if plat:
            detail_lines.append(f'Platform: {plat}')
        link = (interview.meeting_link or '').strip()
        if link:
            detail_lines.append(f'Join link: {link}')
    else:
        addr = (interview.office_address or '').strip()
        if addr:
            detail_lines.append(f'Address: {addr}')
        ln = (interview.location_notes or '').strip()
        if ln:
            detail_lines.append(f'Location / instructions: {ln}')

    detail_lines.append('')
    detail_lines.append('Please be prepared and join or arrive on time.')

    details_block = '\n'.join(detail_lines)

    if audience == 'hr':
        subject = f'HR reminder: {candidate_name} interview in {time_label} — {job_title}'
        greeting = f'Hello,\n\nThis is a reminder that {candidate_name} has an interview in {time_label}.\n\n'
        heading = 'Interview reminder (HR)'
        html_greeting = (
            f'<p>This is a reminder that <strong>{escape(candidate_name)}</strong> '
            f'has an interview in <strong>{escape(time_label)}</strong> '
            f'for <strong>{escape(job_title)}</strong>.</p>'
        )
    else:
        subject = f'Reminder: Your interview in {time_label} — {job_title}'
        greeting = f'Dear {candidate_name},\n\nYour interview is coming up in {time_label}.\n\n'
        heading = f'Interview in {time_label}'
        html_greeting = (
            f'<p>Dear <strong>{escape(candidate_name)}</strong>,</p>'
            f'<p>Your interview for <strong>{escape(job_title)}</strong> '
            f'is in <strong>{escape(time_label)}</strong>.</p>'
        )

    plain_main = greeting + details_block
    html_message = escape(details_block).replace('\n', '<br>')

    link_html = ''
    link_raw = (interview.meeting_link or '').strip()
    if interview.mode == 'online' and link_raw.startswith(('http://', 'https://')):
        link_html = str(
            format_html(
                '<p style="margin-top: 16px;"><a href="{}" style="color: #7c3aed; font-weight: 600;">Join the meeting</a></p>',
                link_raw,
            )
        )

    html_inner = f"""
            <h2 style="margin-top: 0; color: #111827;">{escape(heading)}</h2>
            {html_greeting}
            <p>{html_message}</p>
            {link_html}
    """
    return subject, plain_main, html_inner, candidate


def _send_interview_reminder_email_core(interview, *, to_email, audience, reminder_type):
    from_email = (settings.DEFAULT_FROM_EMAIL or '').strip()
    to_email = (to_email or '').strip()
    if not to_email:
        logger.warning(
            '[hr-email] interview reminder skipped: no recipient interview=%s audience=%s',
            interview.pk,
            audience,
        )
        return False
    if not from_email:
        logger.warning('[hr-email] interview reminder skipped: DEFAULT_FROM_EMAIL not configured')
        return False

    from apps.hr.models import Interview

    if interview.status != Interview.STATUS_SCHEDULED:
        logger.warning(
            '[hr-email] interview reminder skipped: status=%s interview=%s',
            interview.status,
            interview.pk,
        )
        return False

    subject, plain_main, html_inner, candidate = _build_interview_reminder_content(
        interview,
        audience=audience,
        reminder_type=reminder_type,
    )
    text_body, html_content = _branded_email_bodies(
        plain_main,
        html_inner,
        candidate=candidate,
        job=getattr(candidate, 'job_opening', None),
    )

    msg = MIMEMultipart('alternative')
    msg['Subject'] = subject
    msg['From'] = from_email
    msg['To'] = to_email
    msg.attach(MIMEText(text_body, 'plain'))
    msg.attach(MIMEText(html_content, 'html'))

    ok, err = _safe_smtp_send(msg)
    if ok:
        logger.info(
            '[hr-email] interview reminder sent interview=%s audience=%s type=%s to=%s',
            interview.pk,
            audience,
            reminder_type,
            to_email,
        )
    else:
        logger.warning(
            '[hr-email] interview reminder failed interview=%s audience=%s type=%s: %s',
            interview.pk,
            audience,
            reminder_type,
            err,
        )
    return ok


def send_interview_reminder_email(interview, *, to_email, audience, reminder_type):
    """Send interview reminder synchronously (called from reminder worker)."""
    return _send_interview_reminder_email_core(
        interview,
        to_email=to_email,
        audience=audience,
        reminder_type=reminder_type,
    )


def _render_offer_action_buttons(accept_url: str, reject_url: str) -> str:
    """
    Email-safe accept/decline buttons — stacked vertically for reliable mobile layout.

    Side-by-side inline-block links overlap on narrow screens in many mobile mail clients.
    """
    button_base = (
        'display: block; width: 100%; max-width: 320px; margin: 0 auto; '
        'padding: 16px 20px; font-size: 16px; font-weight: bold; '
        'line-height: 1.25; text-align: center; text-decoration: none; '
        'border-radius: 8px; box-sizing: border-box;'
    )
    return f"""
            <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="margin: 32px auto 8px; max-width: 360px;">
              <tr>
                <td align="center" style="padding: 0 0 12px 0;">
                  <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="max-width: 320px;">
                    <tr>
                      <td align="center" bgcolor="#10b981" style="border-radius: 8px; mso-padding-alt: 16px 20px;">
                        <a href="{accept_url}" target="_blank" style="{button_base} color: #ffffff; background-color: #10b981;">Accept Offer</a>
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>
              <tr>
                <td align="center" style="padding: 0;">
                  <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="max-width: 320px;">
                    <tr>
                      <td align="center" bgcolor="#ef4444" style="border-radius: 8px; mso-padding-alt: 16px 20px;">
                        <a href="{reject_url}" target="_blank" style="{button_base} color: #ffffff; background-color: #ef4444;">Decline Offer</a>
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>
            </table>
    """


def send_offer_email(offer, base_url=None):
    """
    Send offer email with PDF attachment and accept/reject links.

    Runs synchronously so HTTP handlers can detect SMTP failures and avoid marking
    the offer as sent when delivery did not complete.
    """
    return _send_offer_email_core(offer, base_url=base_url)

def _send_offer_email_core(offer, base_url=None):
    """Core logic for offer emails with PDF attachment and professional HTML."""
    from_email = settings.DEFAULT_FROM_EMAIL
    to_email = (offer.candidate_email or '').strip()

    if not to_email:
        logger.warning('[hr-email] offer email skipped: empty candidate_email offer_id=%s', offer.pk)
        return False

    if not from_email:
        logger.warning('[hr-email] offer email skipped: DEFAULT_FROM_EMAIL not configured')
        return False

    if not base_url:
        base_url = getattr(settings, 'SITE_BASE_URL', 'http://127.0.0.1:8000')
    
    # Ensure base_url doesn't have trailing slash for consistent joining
    base_url = base_url.rstrip('/')
    
    accept_url = f"{base_url}/offer/accept/{offer.token}/"
    reject_url = f"{base_url}/offer/reject/{offer.token}/"

    expiry_display = ''
    if offer.offer_expiry_date:
        expiry_display = offer.offer_expiry_date.strftime('%d %B %Y')
    expiry_line = (
        f'Please accept or decline this offer on or before {expiry_display}.'
        if expiry_display
        else 'Please accept or decline this offer by the deadline stated in your offer letter.'
    )
    
    subject = f"Congratulations! Your Offer Letter from {offer.company_name}"
    
    # Create the root message
    msg = MIMEMultipart('mixed')
    msg["Subject"] = subject
    msg["From"] = from_email
    msg["To"] = to_email
    
    plain_main = f"""Dear {offer.candidate_name},

Congratulations!

We are pleased to offer you the position of {offer.job_title} at {offer.company_name}.

Please find your offer letter attached.

{expiry_line}

To respond, click below:

Accept Offer: {accept_url}
Reject Offer: {reject_url}

We look forward to working with you."""

    html_inner = f"""
            <h1 style="color: #1e293b; margin-bottom: 24px;">Congratulations!</h1>
            <p style="font-size: 16px;">Dear <strong>{escape(offer.candidate_name)}</strong>,</p>
            <p style="font-size: 16px;">We are pleased to offer you the position of <strong>{escape(offer.job_title)}</strong> at <strong>{escape(offer.company_name)}</strong>.</p>
            <p style="font-size: 16px;">Please find your official offer letter attached to this email.</p>
            <p style="font-size: 16px;">{escape(expiry_line)}</p>
            <p style="font-size: 14px; color: #64748b; margin: 32px 0 0; text-align: center;">Please review the document and respond:</p>
            {_render_offer_action_buttons(accept_url, reject_url)}
            <p style="font-size: 16px;">If you have any questions, please contact our HR department.</p>
    """
    plain_text, html_content = _branded_email_bodies(plain_main, html_inner, offer=offer)

    msg_body = MIMEMultipart('alternative')
    msg_body.attach(MIMEText(plain_text, 'plain'))
    msg_body.attach(MIMEText(html_content, 'html'))
    msg.attach(msg_body)
    
    # Attach PDF    msg.attach(msg_body)
    
    # Attach PDF
    if offer.pdf and os.path.exists(offer.pdf.path):
        try:
            with open(offer.pdf.path, "rb") as f:
                part = MIMEApplication(f.read(), Name=os.path.basename(offer.pdf.name))
                part['Content-Disposition'] = f'attachment; filename="{os.path.basename(offer.pdf.name)}"'
                msg.attach(part)
        except Exception as e:
            logger.warning('[hr-email] Error attaching PDF offer=%s: %s', offer.pk, e)

    ok, err = _safe_smtp_send(msg)
    if ok:
        logger.info('[hr-email] offer email sent offer_id=%s to=%s', offer.pk, to_email)
    else:
        logger.warning('[hr-email] offer email failed offer_id=%s to=%s: %s', offer.pk, to_email, err)
    return ok, err

def send_offer_revocation_email(offer):
    """Wrapper for background sending."""
    return send_in_background(_send_offer_revocation_email_core, offer)

def _send_offer_revocation_email_core(offer):
    """Core logic for offer revocation emails."""
    from_email = settings.DEFAULT_FROM_EMAIL
    to_email = offer.candidate_email
    candidate_name = offer.candidate_name
    job_title = offer.job_title
    company_name = offer.company_name
    
    subject = f"Update regarding your Offer Letter - {company_name}"
    
    plain_main = f"""Dear {candidate_name},

This is to inform you that your job offer for the position of {job_title} at {company_name} has been revoked by the HR department.

As a result, the previously shared offer letter and its associated links are no longer valid.

If you have any questions, please contact our HR team."""

    html_inner = f"""
            <h2 style="margin-top: 0; color: #111827;">Offer update</h2>
            <p>Dear <strong>{escape(candidate_name)}</strong>,</p>
            <p>Your job offer for <strong>{escape(job_title)}</strong> at <strong>{escape(company_name)}</strong> has been revoked.</p>
            <p>The previously shared offer letter and its links are no longer valid.</p>
    """
    text_body, html_content = _branded_email_bodies(plain_main, html_inner, offer=offer)

    msg = MIMEMultipart('alternative')
    msg["Subject"] = subject
    msg["From"] = from_email
    msg["To"] = to_email
    msg.attach(MIMEText(text_body, 'plain'))
    msg.attach(MIMEText(html_content, 'html'))

    return smtp_send_ok(_safe_smtp_send(msg))

def dispatch_onboarding_welcome_email(employee, offer=None):
    """Queue offer-accepted welcome email via EmailEventDispatcher (idempotent per offer)."""
    from apps.hr.recruitment_email_dispatcher import EmailEventDispatcher

    return EmailEventDispatcher.offer_accepted(employee, offer=offer)


def send_onboarding_welcome_email(employee, offer=None):
    """Backward-compatible alias — use EmailEventDispatcher.offer_accepted from services."""
    return dispatch_onboarding_welcome_email(employee, offer)


def _send_onboarding_welcome_email_core(employee, offer):
    """Core logic for onboarding email with professional HTML template."""
    from_email = settings.DEFAULT_FROM_EMAIL
    to_email = employee.email

    from apps.hr.onboarding_documents import get_onboarding_upload_url

    onboarding_url = get_onboarding_upload_url(employee)
    if not onboarding_url:
        from config.frontend_url import get_frontend_base_url

        base_url = get_frontend_base_url()
        token = getattr(offer, 'token', None) if offer else None
        if token:
            onboarding_url = f'{base_url}/offer/onboarding/{token}'
        else:
            onboarding_url = base_url
    
    subject = f"Welcome to the Team! - Onboarding for {employee.name}"

    from apps.hr.designation_utils import resolve_designation_display

    role_label = resolve_designation_display(employee) or employee.job_title or 'team member'
    
    # Create root message
    msg = MIMEMultipart('mixed')
    msg["Subject"] = subject
    msg["From"] = from_email
    msg["To"] = to_email
    
    plain_main = f"""Dear {employee.name},

Congratulations on joining our organization! We are excited to have you onboard as our new {role_label}.

To complete your joining formalities, please upload the required documents through our onboarding portal:

Complete Onboarding: {onboarding_url}

Please ensure you have the following documents ready for upload:
- Aadhaar Card
- PAN Card
- Degree Certificate
- Bank Details
- Experience Letter (if applicable)"""

    html_inner = f"""
            <h1 style="color: #4f46e5; margin-bottom: 24px;">Welcome to the Team!</h1>
            <p style="font-size: 16px;">Dear <strong>{escape(employee.name)}</strong>,</p>
            <p style="font-size: 16px;">Please complete onboarding for <strong>{escape(role_label)}</strong>.</p>
            <div style="margin: 40px 0; text-align: center;">
                <a href="{onboarding_url}" style="background-color: #4f46e5; color: white; padding: 14px 28px; text-decoration: none; border-radius: 8px; font-weight: bold; display: inline-block;">Complete Onboarding</a>
            </div>
            <p style="font-size: 14px; color: #64748b;">Link: <a href="{onboarding_url}">{escape(onboarding_url)}</a></p>
    """
    plain_text, html_content = _branded_email_bodies(plain_main, html_inner, employee=employee, offer=offer)

    msg_body = MIMEMultipart('alternative')
    msg_body.attach(MIMEText(plain_text, 'plain'))
    msg_body.attach(MIMEText(html_content, 'html'))
    msg.attach(msg_body)
    
    return _safe_smtp_send(msg)


def send_employee_portal_welcome_email(employee, *, temporary_password: str | None = None):
    """Portal credentials email sent when HR activates the employee after document verification."""
    return _send_employee_portal_welcome_email_core(employee, temporary_password=temporary_password)


def _send_employee_portal_welcome_email_core(employee, *, temporary_password: str | None = None):
    from apps.hr.onboarding_documents import get_employee_offer
    from apps.hr.organization_branding import build_email_branding_context, media_url
    from apps.hr.portal_provisioning import get_portal_login_url

    to_email = (getattr(employee, 'email', None) or '').strip()
    if not to_email:
        logger.warning('[hr-email] portal welcome skipped: no employee email employee_id=%s', employee.employee_id)
        return False

    offer = get_employee_offer(employee)
    ctx = build_email_branding_context()
    org_name = (ctx.get('organization_name') or ctx.get('company_name') or 'Organization').strip()
    portal_url = get_portal_login_url()
    login_email = to_email
    from_email = settings.DEFAULT_FROM_EMAIL
    subject = f'Welcome to {org_name} — Employee Portal Access'

    password_block = ''
    password_html = ''
    if temporary_password:
        password_block = f'\nTemporary Password:\n{temporary_password}\n\nPlease change your password after first login.'
        password_html = (
            f'<p style="font-size: 15px;"><strong>Temporary Password:</strong> '
            f'<code style="background:#f1f5f9;padding:4px 8px;border-radius:4px;">{escape(temporary_password)}</code></p>'
            '<p style="font-size: 14px; color: #64748b;">Please change your password after first login.</p>'
        )
    else:
        password_block = '\nPlease sign in with your existing portal password.'
        password_html = '<p style="font-size: 14px; color: #64748b;">Please sign in with your existing portal password.</p>'

    logo_url = media_url(ctx.get('company_logo'))
    logo_html = ''
    if logo_url:
        logo_html = f'<p style="text-align:center;margin-bottom:20px;"><img src="{escape(logo_url)}" alt="{escape(org_name)} logo" style="max-height:56px;"></p>'

    plain_main = f"""Welcome to {org_name}

Your onboarding has been completed.

Employee Name: {employee.name}
Employee ID: {employee.employee_id}

Portal:
{portal_url}

Login Email:
{login_email}
{password_block}"""

    html_inner = f"""
            {logo_html}
            <h1 style="color: #0f766e; margin-bottom: 16px;">Welcome to {escape(org_name)}</h1>
            <p style="font-size: 16px;">Dear <strong>{escape(employee.name)}</strong>,</p>
            <p style="font-size: 16px;">Your onboarding has been completed. Your employee portal access is now active.</p>
            <table style="width:100%;border-collapse:collapse;margin:20px 0;font-size:15px;">
              <tr><td style="padding:8px 0;color:#64748b;">Employee ID</td><td style="padding:8px 0;"><strong>{escape(employee.employee_id)}</strong></td></tr>
              <tr><td style="padding:8px 0;color:#64748b;">Portal</td><td style="padding:8px 0;"><a href="{escape(portal_url)}">{escape(portal_url)}</a></td></tr>
              <tr><td style="padding:8px 0;color:#64748b;">Login Email</td><td style="padding:8px 0;">{escape(login_email)}</td></tr>
            </table>
            {password_html}
    """
    plain_text, html_content = _branded_email_bodies(plain_main, html_inner, employee=employee, offer=offer)

    msg = MIMEMultipart('mixed')
    msg['Subject'] = subject
    msg['From'] = from_email
    msg['To'] = to_email

    body = MIMEMultipart('alternative')
    body.attach(MIMEText(plain_text, 'plain'))
    body.attach(MIMEText(html_content, 'html'))
    msg.attach(body)

    return smtp_send_ok(_safe_smtp_send(msg))


def send_verification_complete_welcome_email(employee, offer=None):
    """
    Final welcome after HR has verified all required documents and activated the employee.
    Sends to the employee / candidate email on file.
    """
    return send_in_background(_send_verification_complete_welcome_email_core, employee, offer)


def _send_verification_complete_welcome_email_core(employee, offer=None):
    to_email = (getattr(employee, 'email', None) or '').strip()
    if not to_email:
        print('[hr-email] Skipping verification-complete welcome: no employee email')
        return False

    if offer is None:
        from apps.hr.onboarding_documents import get_employee_offer

        offer = get_employee_offer(employee)

    display_name = employee.name or (getattr(offer, 'candidate_name', None) if offer else None) or 'there'
    from apps.hr.designation_utils import resolve_designation_display

    job_title = (
        resolve_designation_display(employee)
        or (getattr(offer, 'job_title', None) if offer else None)
        or 'your role'
    )
    from apps.hr.organization_branding import build_branding_context, resolve_hospital_id

    hospital_id = resolve_hospital_id(employee=employee, offer=offer)
    branding = build_branding_context(hospital_id=hospital_id)
    company_name = (getattr(offer, 'company_name', None) if offer else None) or branding.get('company_name') or 'our organization'

    from_email = settings.DEFAULT_FROM_EMAIL
    subject = f'Welcome aboard — documents verified | {company_name}'

    plain_main = f"""Dear {display_name},

Great news: our HR team has completed verification of your joining documents.

You are now recorded as an active team member in the role of {job_title} at {company_name}. We are delighted to officially welcome you.

If you have questions about your employment or next steps, please reply to this message or contact HR directly."""

    html_inner = f"""
            <h1 style="color: #059669; margin-bottom: 24px;">You're officially on board</h1>
            <p style="font-size: 16px;">Dear <strong>{escape(display_name)}</strong>,</p>
            <p style="font-size: 16px;">Our HR team has <strong>completed verification</strong> of your joining documents.</p>
            <p style="font-size: 16px;">You are now active as <strong>{escape(job_title)}</strong> at <strong>{escape(company_name)}</strong>.</p>
    """
    plain_text, html_content = _branded_email_bodies(
        plain_main, html_inner, employee=employee, offer=offer,
    )

    msg = MIMEMultipart('mixed')
    msg['Subject'] = subject
    msg['From'] = from_email
    msg['To'] = to_email

    body = MIMEMultipart('alternative')
    body.attach(MIMEText(plain_text, 'plain'))
    body.attach(MIMEText(html_content, 'html'))
    msg.attach(body)

    return smtp_send_ok(_safe_smtp_send(msg))


def _send_document_request_email_core(candidate, message='', documents=None):
    """HR-triggered request for additional documents during recruitment."""
    from_email = settings.DEFAULT_FROM_EMAIL
    to_email = (candidate.email or '').strip()
    if not to_email:
        logger.warning(
            '[hr-email] document request skipped: no email candidate_id=%s',
            candidate.pk,
        )
        return False

    candidate_name = candidate.name
    job_title = getattr(getattr(candidate, 'job_opening', None), 'title', None) or 'your application'
    doc_list = documents or []
    if doc_list:
        doc_lines = '\n'.join(f'- {item}' for item in doc_list)
        doc_html = ''.join(f'<li>{escape(str(item))}</li>' for item in doc_list)
        doc_block = f'\n\nPlease submit the following:\n{doc_lines}'
        doc_html_block = f'<ul style="margin: 12px 0;">{doc_html}</ul>'
    else:
        doc_block = '\n\nPlease submit the documents requested by our HR team.'
        doc_html_block = '<p>Please submit the documents requested by our HR team.</p>'

    hr_note = (message or '').strip()
    note_block = f'\n\nMessage from HR:\n{hr_note}' if hr_note else ''
    note_html = (
        f'<p style="margin-top: 16px;"><strong>Message from HR:</strong><br>{escape(hr_note).replace(chr(10), "<br>")}</p>'
        if hr_note
        else ''
    )

    subject = f'Documents requested — {job_title}'
    plain_main = f"""Dear {candidate_name},

Our HR team has requested additional documents for your application to {job_title}.{doc_block}{note_block}

Please reply to this email or contact HR if you have questions."""

    html_inner = f"""
            <h2 style="margin-top: 0; color: #111827;">Documents requested</h2>
            <p>Dear <strong>{escape(candidate_name)}</strong>,</p>
            <p>We need additional documents for your application to <strong>{escape(job_title)}</strong>.</p>
            {doc_html_block}
            {note_html}
    """
    text_body, html_content = _branded_email_bodies(plain_main, html_inner, candidate=candidate)

    msg = MIMEMultipart('alternative')
    msg['Subject'] = subject
    msg['From'] = from_email
    msg['To'] = to_email
    msg.attach(MIMEText(text_body, 'plain'))
    msg.attach(MIMEText(html_content, 'html'))

    ok, err = _safe_smtp_send(msg)
    if ok:
        logger.info('[hr-email] document request sent candidate_id=%s', candidate.pk)
    return ok, err


def send_document_reupload_email(employee, document, reason):
    return send_in_background(_send_document_reupload_email_core, employee, document, reason)


def _send_document_reupload_email_core(employee, document, reason):
    from apps.hr.onboarding_documents import document_label, get_onboarding_upload_url

    to_email = employee.email
    if not to_email:
        return False

    from_email = settings.DEFAULT_FROM_EMAIL
    upload_url = get_onboarding_upload_url(employee)
    raw_document_type = getattr(document, 'document_type', None)
    if hasattr(raw_document_type, 'name'):
        raw_document_type = raw_document_type.name
    document_name = document_label(raw_document_type or 'document')

    subject = f'Action required: re-upload {document_name}'
    upload_block_plain = upload_url or 'Please contact HR for a new onboarding link.'
    plain_main = f"""Dear {employee.name},

HR has requested a new upload for your {document_name}.

Reason:
{reason}

Please upload the corrected document using the onboarding link below:
{upload_block_plain}"""

    upload_html = (
        f'<p><a href="{upload_url}" style="background:#4f46e5;color:#fff;padding:12px 20px;text-decoration:none;border-radius:8px;display:inline-block;">Upload Document</a></p>'
        if upload_url
        else '<p>Please contact HR for a new onboarding link.</p>'
    )
    html_inner = f"""
        <h2 style="color: #4f46e5;">Document re-upload requested</h2>
        <p>Dear <strong>{escape(employee.name)}</strong>,</p>
        <p>HR has requested a new upload for your <strong>{escape(document_name)}</strong>.</p>
        <p><strong>Reason:</strong><br>{escape(reason)}</p>
        {upload_html}
    """
    plain_text, html_content = _branded_email_bodies(plain_main, html_inner)

    msg = MIMEMultipart('mixed')
    msg['Subject'] = subject
    msg['From'] = from_email
    msg['To'] = to_email

    body = MIMEMultipart('alternative')
    body.attach(MIMEText(plain_text, 'plain'))
    body.attach(MIMEText(html_content, 'html'))
    msg.attach(body)

    return smtp_send_ok(_safe_smtp_send(msg))


def send_payslip_published_email(employee, *, payslip, payroll_run):
    """Notify employee that their payslip for the month is available on the portal."""
    to_email = (getattr(employee, 'email', None) or '').strip()
    if not to_email:
        logger.warning(
            '[hr-email] payslip publish skipped: no employee email employee_id=%s',
            employee.employee_id,
        )
        return False

    from apps.hr.organization_branding import build_email_branding_context
    from apps.hr.portal_provisioning import get_portal_login_url

    ctx = build_email_branding_context()
    org_name = (ctx.get('organization_name') or ctx.get('company_name') or 'Organization').strip()
    portal_url = get_portal_login_url()
    month = getattr(payroll_run, 'month', '') or getattr(payslip, 'month', '')
    net_salary = getattr(payslip, 'net_salary', None) or getattr(payroll_run, 'final_salary', '')
    from_email = settings.DEFAULT_FROM_EMAIL
    subject = f'Payslip Available — {month} | {org_name}'

    plain_main = f"""Your payslip is now available.

Employee: {employee.name}
Employee ID: {employee.employee_id}
Pay Period: {month}
Net Salary: {net_salary}

View your payslip in the employee portal:
{portal_url}
"""
    html_inner = f"""
        <h2 style="color: #1e3a5f;">Payslip Published</h2>
        <p>Dear <strong>{escape(employee.name)}</strong>,</p>
        <p>Your payslip for <strong>{escape(month)}</strong> has been published and is available on the employee portal.</p>
        <table style="width:100%;border-collapse:collapse;margin:16px 0;font-size:15px;">
          <tr><td style="padding:6px 0;color:#64748b;">Employee ID</td><td><strong>{escape(employee.employee_id)}</strong></td></tr>
          <tr><td style="padding:6px 0;color:#64748b;">Pay Period</td><td><strong>{escape(month)}</strong></td></tr>
          <tr><td style="padding:6px 0;color:#64748b;">Net Salary</td><td><strong>{escape(str(net_salary))}</strong></td></tr>
        </table>
        <p><a href="{escape(portal_url)}" style="display:inline-block;background:#1e3a5f;color:#fff;padding:10px 18px;text-decoration:none;border-radius:6px;">Open Employee Portal</a></p>
    """
    plain_text, html_content = _branded_email_bodies(plain_main, html_inner, employee=employee)

    msg = MIMEMultipart('mixed')
    msg['Subject'] = subject
    msg['From'] = from_email
    msg['To'] = to_email
    body = MIMEMultipart('alternative')
    body.attach(MIMEText(plain_text, 'plain'))
    body.attach(MIMEText(html_content, 'html'))
    msg.attach(body)

    if payslip and getattr(payslip, 'pdf_file', None) and os.path.exists(payslip.pdf_file.path):
        try:
            with open(payslip.pdf_file.path, "rb") as f:
                part = MIMEApplication(f.read(), Name=os.path.basename(payslip.pdf_file.name))
                part['Content-Disposition'] = f'attachment; filename="{os.path.basename(payslip.pdf_file.name)}"'
                msg.attach(part)
        except Exception as e:
            logger.warning('[hr-email] Error attaching PDF payslip=%s: %s', payslip.pk, e)

    return smtp_send_ok(_safe_smtp_send(msg))
