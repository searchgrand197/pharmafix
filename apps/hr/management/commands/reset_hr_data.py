from django.core.management.base import BaseCommand

from apps.hr.demo_reset import run_hr_full_reset


class Command(BaseCommand):
    help = (
        'Delete all HR data while preserving biometric device registrations '
        '(serial numbers, hospital links, connection metadata). '
        'Hospitals and Django users are kept. '
        'Does not touch apps.staff or apps.attendance.'
    )

    def add_arguments(self, parser):
        parser.add_argument(
            '--dry-run',
            action='store_true',
            help='Show row counts that would be deleted without making changes.',
        )
        parser.add_argument(
            '--no-input',
            action='store_true',
            help='Skip the interactive confirmation prompt.',
        )
        parser.add_argument(
            '--purge-biometric-devices',
            action='store_true',
            help='Also delete BiometricDevice and BiometricDeviceCommand records.',
        )
        parser.add_argument(
            '--skip-check',
            action='store_true',
            help='Skip manage.py check after reset.',
        )

    def handle(self, *args, **options):
        run_hr_full_reset(
            stdout_write=self.stdout.write,
            style=self.style,
            dry_run=options['dry_run'],
            no_input=options['no_input'],
            keep_biometric_devices=not options['purge_biometric_devices'],
            run_check=not options['skip_check'],
        )
