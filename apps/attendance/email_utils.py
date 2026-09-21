"""
Email utilities for the attendance / leave module.

The leave-approval email embeds one-click Approve / Deny buttons that call the
HMS API directly using a short-lived signed token.  No login is required — the
token encodes both the leave id and the approver id so the action is fully
authenticated by the token itself.

Token format (signed with Django's SECRET_KEY, max_age = 7 days):
    { "leave_id": "<uuid>", "approver_id": "<int>", "action": "approve"|"deny" }
"""

from __future__ import annotations

import smtplib
import ssl
from email.message import EmailMessage
from email.utils import format_datetime
from zoneinfo import ZoneInfo

from django.conf import settings
from django.core import signing
from django.utils import timezone


# ── Token helpers ─────────────────────────────────────────────────────────────

TOKEN_MAX_AGE = 7 * 24 * 3600  # 7 days in seconds
_SALT = "hms.leave.action"
IST = ZoneInfo("Asia/Kolkata")


def _stamp_ist_headers(msg):
    sent_at = timezone.now().astimezone(IST)
    msg["Date"] = format_datetime(sent_at)
    msg["X-Curevice-Local-Time"] = sent_at.strftime("%d %b %Y, %I:%M %p IST")
    msg["X-Curevice-Time-Zone"] = "Asia/Kolkata"


def make_leave_action_token(*, leave_id, approver_id, action: str) -> str:
    """
    Return a URL-safe signed token valid for TOKEN_MAX_AGE seconds.

    We deliberately cast IDs to str so this works whether the primary keys
    are UUIDs or integers.
    """
    return signing.dumps(
        {
            "leave_id": str(leave_id),
            "approver_id": str(approver_id),
            "action": action,
        },
        salt=_SALT,
    )


def load_leave_action_token(token: str) -> dict:
    """
    Validate and decode a leave-action token.
    Raises signing.BadSignature / signing.SignatureExpired on failure.
    """
    return signing.loads(token, salt=_SALT, max_age=TOKEN_MAX_AGE)


def send_leave_approval_emails(application) -> int:
    """
    Send an HTML email with one-click Approve / Deny buttons to every active
    LeaveApprover configured for the leave application's hospital.

    Returns the number of emails successfully sent.
    """
    from apps.settings_management.models import LeaveApprover

    approvers = (
        LeaveApprover.objects.filter(
            hospital_id=application.hospital_id,
            is_active=True,
        )
        .select_related("user")
        .order_by("user__email")
    )

    if not approvers.exists():
        # Helpful for debugging in dev: see in Django runserver console.
        print(
            f"[leave-email] No active LeaveApprover for hospital={application.hospital_id}; "
            f"no notification sent for leave {application.id}"
        )
        return 0

    # Build base URL from settings (fall back to localhost for development)
    base_url = getattr(settings, "SITE_BASE_URL", "http://127.0.0.1:8000").rstrip("/")

    staff = application.staff
    staff_name = f"{getattr(staff, 'first_name', '')} {getattr(staff, 'last_name', '')}".strip() or str(staff)
    leave_type = application.leave_type.replace("_", " ").title()
    days = application.total_days
    start = application.start_date
    end = application.end_date
    reason = application.reason or "—"

    # Use the exact same SMTP config pattern as staff creation email in
    # apps/staff/views.py so behaviour is identical.
    host = settings.EMAIL_HOST
    port = settings.EMAIL_PORT
    use_ssl = getattr(settings, "EMAIL_USE_SSL", False)
    use_tls = getattr(settings, "EMAIL_USE_TLS", False)
    user_smtp = settings.EMAIL_HOST_USER
    pwd_smtp = settings.EMAIL_HOST_PASSWORD
    from_email = settings.DEFAULT_FROM_EMAIL

    sent = 0
    for approver_obj in approvers:
        user = approver_obj.user
        approver_name = (
            f"{getattr(user, 'first_name', '')} {getattr(user, 'last_name', '')}".strip()
            or user.email
        )

        approve_token = make_leave_action_token(
            leave_id=application.id,
            approver_id=user.id,
            action="approve",
        )
        deny_token = make_leave_action_token(
            leave_id=application.id,
            approver_id=user.id,
            action="deny",
        )

        approve_url = f"{base_url}/leave/action/{approve_token}/"
        deny_url = f"{base_url}/leave/action/{deny_token}/"

        subject = f"[Leave Request] {staff_name} – {leave_type} ({days} day(s))"

        text_body = (
            f"Hello {approver_name},\n\n"
            f"{staff_name} has applied for {leave_type} leave.\n\n"
            f"  From   : {start}\n"
            f"  To     : {end}\n"
            f"  Days   : {days}\n"
            f"  Reason : {reason}\n\n"
            f"Approve: {approve_url}\n"
            f"Deny   : {deny_url}\n\n"
            "This link is valid for 7 days.\n"
        )

        html_body = f"""
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8"/>
  <style>
    body {{ font-family: Arial, sans-serif; background: #f4f6f8; margin: 0; padding: 0; }}
    .wrapper {{ max-width: 560px; margin: 32px auto; background: #fff;
                border-radius: 10px; overflow: hidden;
                box-shadow: 0 2px 10px rgba(0,0,0,.08); }}
    .header {{ background: #1e40af; padding: 24px 32px; }}
    .header h1 {{ color: #fff; margin: 0; font-size: 20px; }}
    .header p  {{ color: #bfdbfe; margin: 4px 0 0; font-size: 13px; }}
    .body {{ padding: 28px 32px; }}
    .greeting {{ font-size: 15px; color: #374151; margin-bottom: 16px; }}
    .info-box {{ background: #f0f9ff; border-left: 4px solid #3b82f6;
                 border-radius: 6px; padding: 16px 20px; margin-bottom: 24px; }}
    .info-box table {{ border-collapse: collapse; width: 100%; }}
    .info-box td {{ padding: 4px 0; font-size: 14px; color: #1e293b; }}
    .info-box td:first-child {{ font-weight: 600; width: 90px; color: #64748b; }}
    .actions {{ display: flex; gap: 12px; margin-top: 8px; }}
    .btn {{ display: inline-block; padding: 12px 28px; border-radius: 6px;
             text-decoration: none; font-weight: 700; font-size: 15px; }}
    .btn-approve {{ background: #16a34a; color: #fff; }}
    .btn-deny    {{ background: #dc2626; color: #fff; }}
    .note {{ font-size: 12px; color: #94a3b8; margin-top: 20px; }}
    .footer {{ background: #f8fafc; padding: 16px 32px; font-size: 12px; color: #94a3b8;
               border-top: 1px solid #e2e8f0; }}
  </style>
</head>
<body>
  <div class="wrapper">
    <div class="header">
      <h1>Leave Approval Request</h1>
      <p>Hospital Management System</p>
    </div>
    <div class="body">
      <p class="greeting">Hello {approver_name},</p>
      <p style="color:#374151;font-size:14px;">
        <strong>{staff_name}</strong> has submitted a leave request that requires your approval.
      </p>
      <div class="info-box">
        <table>
          <tr><td>Leave type</td><td>{leave_type}</td></tr>
          <tr><td>From</td><td>{start}</td></tr>
          <tr><td>To</td><td>{end}</td></tr>
          <tr><td>Days</td><td>{days}</td></tr>
          <tr><td>Reason</td><td>{reason}</td></tr>
        </table>
      </div>
      <p style="font-size:14px;color:#374151;margin-bottom:12px;">
        Click a button below to take action directly from this email:
      </p>
      <div class="actions">
        <a href="{approve_url}" class="btn btn-approve">✓ Approve</a>
        <a href="{deny_url}"    class="btn btn-deny">✕ Deny</a>
      </div>
      <p class="note">
        These links are valid for <strong>7 days</strong> and can only be used once.
        If the leave is already actioned, a notice will be shown.
      </p>
    </div>
    <div class="footer">
      Hospital Management System &mdash; automated notification &mdash; do not reply
    </div>
  </div>
</body>
</html>
"""

        try:
            msg = EmailMessage()
            msg["Subject"] = subject
            msg["From"] = from_email
            msg["To"] = user.email
            msg.set_content(text_body)
            msg.add_alternative(html_body, subtype="html")
            _stamp_ist_headers(msg)

            # This block is intentionally identical to staff creation email.
            if use_ssl:
                context = ssl.create_default_context()
                with smtplib.SMTP_SSL(host, port, context=context) as server:
                    if user_smtp and pwd_smtp:
                        server.login(user_smtp, pwd_smtp)
                    server.send_message(msg)
            else:
                with smtplib.SMTP(host, port) as server:
                    if use_tls:
                        server.starttls()
                    if user_smtp and pwd_smtp:
                        server.login(user_smtp, pwd_smtp)
                    server.send_message(msg)

            sent += 1
        except Exception as exc:
            # Don't let an email failure block the API response, but log it for debugging.
            print(
                f"[leave-email] FAILED sending to {user.email} for leave={application.id}: {exc}"
            )

    return sent
