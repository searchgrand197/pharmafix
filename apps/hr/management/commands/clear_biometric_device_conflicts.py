from django.core.management.base import BaseCommand
from django.db import transaction

from apps.hr.biometric_models import BiometricUnlinkedUser
from apps.hr.models import Employee
from apps.shared.models import Hospital


class Command(BaseCommand):
    help = (
        'Delete all biometric device conflict records (BiometricUnlinkedUser). '
        'Clears biometric PIN assignment on employees that were linked via a conflict '
        'when the PIN matches.'
    )

    def add_arguments(self, parser):
        parser.add_argument(
            '--hospital',
            help='Limit to a hospital slug or UUID (default: all hospitals).',
        )
        parser.add_argument(
            '--dry-run',
            action='store_true',
            help='Show what would be deleted without making changes.',
        )
        parser.add_argument(
            '--no-input',
            action='store_true',
            help='Skip the interactive confirmation prompt.',
        )

    def handle(self, *args, **options):
        hospital = self._resolve_hospital(options.get('hospital'))
        qs = BiometricUnlinkedUser.objects.all()
        if hospital:
            qs = qs.filter(hospital=hospital)

        total = qs.count()
        linked = qs.filter(status=BiometricUnlinkedUser.STATUS_LINKED).select_related('linked_employee')
        linked_count = linked.count()
        pending_count = qs.filter(status=BiometricUnlinkedUser.STATUS_PENDING).count()
        rejected_count = qs.filter(status=BiometricUnlinkedUser.STATUS_REJECTED).count()

        scope = hospital.name if hospital else 'all hospitals'
        self.stdout.write(
            f'Biometric device conflicts ({scope}): '
            f'{total} total ({pending_count} pending, {linked_count} linked, {rejected_count} rejected)',
        )

        if total == 0:
            self.stdout.write(self.style.SUCCESS('Nothing to clear.'))
            return

        if options['dry_run']:
            pin_clears = 0
            for conflict in linked:
                employee = conflict.linked_employee
                if employee and (employee.biometric_pin or '').strip() == (conflict.pin or '').strip():
                    pin_clears += 1
            self.stdout.write(
                f'Dry run: would delete {total} conflict(s) and clear PIN on {pin_clears} employee(s).',
            )
            return

        if not options['no_input']:
            answer = input(f'Delete {total} conflict record(s)? [y/N]: ').strip().lower()
            if answer not in {'y', 'yes'}:
                self.stdout.write('Aborted.')
                return

        with transaction.atomic():
            pin_clears = self._clear_linked_pins(linked)
            deleted, _ = qs.delete()

        self.stdout.write(
            self.style.SUCCESS(
                f'Cleared {deleted} conflict record(s); reset biometric PIN on {pin_clears} employee(s).',
            ),
        )

    def _resolve_hospital(self, value):
        if not value:
            return None
        hospital = Hospital.objects.filter(slug=value).first()
        if hospital:
            return hospital
        return Hospital.objects.filter(pk=value).first()

    def _clear_linked_pins(self, linked_qs):
        cleared = 0
        for conflict in linked_qs:
            employee = conflict.linked_employee
            if not employee:
                continue
            if (employee.biometric_pin or '').strip() != (conflict.pin or '').strip():
                continue
            employee.biometric_pin = ''
            employee.biometric_card_number = ''
            employee.biometric_attendance_enabled = False
            employee.save(
                update_fields=[
                    'biometric_pin',
                    'biometric_card_number',
                    'biometric_attendance_enabled',
                    'updated_at',
                ],
            )
            cleared += 1
        return cleared
