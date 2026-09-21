"""
Send a one-off SMTP test email using Django settings.

Usage:
    python scripts/send_test_email.py
    python scripts/send_test_email.py --to you@example.com
"""

from __future__ import annotations

import argparse
import os
import smtplib
import sys
from datetime import datetime
from pathlib import Path


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Send a Django SMTP test email.")
    parser.add_argument(
        "--to",
        default="nvnsaroy001@gmail.com",
        help="Recipient email address (default: nvnsaroy001@gmail.com)",
    )
    parser.add_argument(
        "--subject",
        default="SMTP test from Curevice",
        help="Email subject line",
    )
    parser.add_argument(
        "--debug-smtp",
        action="store_true",
        help="Enable SMTP-level debug logging",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()

    project_root = Path(__file__).resolve().parent.parent
    if str(project_root) not in sys.path:
        sys.path.insert(0, str(project_root))

    os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")

    import django

    django.setup()

    from django.conf import settings
    from django.core.mail import get_connection, send_mail

    body = (
        "Hello,\n\n"
        "This is a test email sent from the Curevice Django project.\n\n"
        f"Sent at: {datetime.utcnow().isoformat()}Z\n"
        f"SMTP host: {settings.EMAIL_HOST}:{settings.EMAIL_PORT}\n"
    )

    smtp_connection = get_connection(
        backend="django.core.mail.backends.smtp.EmailBackend",
        host=settings.EMAIL_HOST,
        port=settings.EMAIL_PORT,
        username=settings.EMAIL_HOST_USER,
        password=settings.EMAIL_HOST_PASSWORD,
        use_tls=settings.EMAIL_USE_TLS,
        use_ssl=settings.EMAIL_USE_SSL,
    )

    print(f"Using SMTP host={settings.EMAIL_HOST} port={settings.EMAIL_PORT}")
    print(f"Security: SSL={settings.EMAIL_USE_SSL} TLS={settings.EMAIL_USE_TLS}")
    print(f"Auth user: {settings.EMAIL_HOST_USER}")

    if args.debug_smtp:
        print("SMTP debug enabled (wire logs below).")

    try:
        # Force-open the connection first so auth/network failures are explicit.
        smtp_connection.open()
        if args.debug_smtp and smtp_connection.connection is not None:
            smtp_connection.connection.set_debuglevel(1)

        sent_count = send_mail(
            subject=args.subject,
            message=body,
            from_email=settings.DEFAULT_FROM_EMAIL,
            recipient_list=[args.to],
            connection=smtp_connection,
            fail_silently=False,
        )
    except smtplib.SMTPException as exc:
        print(f"SMTP error: {exc.__class__.__name__}: {exc}")
        return 1
    except OSError as exc:
        print(f"Network/socket error: {exc.__class__.__name__}: {exc}")
        return 1
    finally:
        try:
            smtp_connection.close()
        except Exception:
            pass

    if sent_count == 1:
        print(f"Success: test email sent to {args.to}")
        return 0

    print("Warning: send_mail returned 0 (email not sent).")
    return 1


if __name__ == "__main__":
    sys.exit(main())
