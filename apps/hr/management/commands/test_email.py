from django.core.management.base import BaseCommand
from django.conf import settings
from email.mime.text import MIMEText

from apps.hr.email_utils import _safe_smtp_send, smtp_send_error, smtp_send_ok


class Command(BaseCommand):
    help = 'Test email configuration and sending (uses the same SMTP path as HR recruitment emails).'

    def add_arguments(self, parser):
        parser.add_argument(
            '--to',
            dest='to_email',
            default='',
            help='Recipient for the test message (default: EMAIL_HOST_USER).',
        )

    def handle(self, *args, **options):
        self.stdout.write('=' * 60)
        self.stdout.write('EMAIL CONFIGURATION DEBUG')
        self.stdout.write('=' * 60)

        self.stdout.write(f'\n[DEBUG] EMAIL_BACKEND: {settings.EMAIL_BACKEND}')
        self.stdout.write(f'[DEBUG] EMAIL_HOST: {settings.EMAIL_HOST}')
        self.stdout.write(f'[DEBUG] EMAIL_PORT: {settings.EMAIL_PORT}')
        self.stdout.write(f'[DEBUG] EMAIL_USE_SSL: {settings.EMAIL_USE_SSL}')
        self.stdout.write(f'[DEBUG] EMAIL_USE_TLS: {settings.EMAIL_USE_TLS}')
        self.stdout.write(f'[DEBUG] EMAIL_HOST_USER: {settings.EMAIL_HOST_USER}')
        pwd = settings.EMAIL_HOST_PASSWORD
        self.stdout.write(f'[DEBUG] EMAIL_HOST_PASSWORD: {"*" * len(pwd) if pwd else "NOT SET"}')
        self.stdout.write(f'[DEBUG] DEFAULT_FROM_EMAIL: {settings.DEFAULT_FROM_EMAIL}')

        to_email = (options.get('to_email') or settings.EMAIL_HOST_USER or '').strip()
        if not to_email:
            self.stdout.write(self.style.ERROR('\nNo recipient — pass --to or set EMAIL_HOST_USER.'))
            return

        self.stdout.write('\n' + '=' * 60)
        self.stdout.write('TESTING HR SMTP SEND (_safe_smtp_send)')
        self.stdout.write('=' * 60)
        self.stdout.write(
            '\nThis uses the same transport as recruitment, portal welcome, and status emails.'
        )

        msg = MIMEText(
            'This is a test email from the Curevice HR system to verify SMTP configuration.',
            'plain',
            'utf-8',
        )
        msg['Subject'] = 'Test Email from Curevice HR System'
        msg['From'] = settings.DEFAULT_FROM_EMAIL
        msg['To'] = to_email

        self.stdout.write(f'\n[TEST] Sending test email to {to_email}...')
        result = _safe_smtp_send(msg)
        ok = smtp_send_ok(result)
        err = smtp_send_error(result)

        if ok:
            self.stdout.write(self.style.SUCCESS('[TEST] Email sent successfully!'))
        else:
            self.stdout.write(self.style.ERROR(f'[TEST] Email send FAILED: {err}'))
            self.stdout.write(
                '\nCommon fixes:\n'
                '  - EMAIL_HOST_USER must be the full mailbox address\n'
                '  - EMAIL_HOST_PASSWORD must match webmail (not cPanel login)\n'
                '  - GoDaddy: try EMAIL_PORT=587, EMAIL_USE_TLS=True, EMAIL_USE_SSL=False\n'
                '  - Microsoft 365: EMAIL_HOST=smtp.office365.com\n'
                '  - After changing .env, restart Django\n'
            )

        self.stdout.write('\n' + '=' * 60)
        self.stdout.write('TEST COMPLETE')
        self.stdout.write('=' * 60)
