from django.core.management.base import BaseCommand

from apps.hr.biometric.repair import repair_all_biometric_punches, repair_employee_biometric_punches
from apps.hr.models import Employee


class Command(BaseCommand):
    help = 'Repair biometric punch attendance dates and clear false duplicate flags, then recalculate daily attendance.'

    def add_arguments(self, parser):
        parser.add_argument('--employee-id', help='Employee UUID or EMP code (e.g. EMP0003)')
        parser.add_argument('--dry-run', action='store_true', help='Report changes without saving')

    def handle(self, *args, **options):
        dry_run = options['dry_run']
        employee_id = options.get('employee_id')

        if employee_id:
            employee = Employee.objects.filter(pk=employee_id).first()
            if not employee:
                employee = Employee.objects.filter(employee_id=employee_id).first()
            if not employee:
                self.stderr.write(self.style.ERROR(f'Employee not found: {employee_id}'))
                return
            results = [repair_employee_biometric_punches(employee, dry_run=dry_run)]
        else:
            results = repair_all_biometric_punches(dry_run=dry_run)

        for row in results:
            self.stdout.write(
                f"{row['employee_id']}: scanned={row['punches_scanned']} "
                f"dates_fixed={row['dates_fixed']} suspicious_cleared={row['suspicious_cleared']} "
                f"days_recalculated={row['days_recalculated']}"
            )
        if dry_run:
            self.stdout.write(self.style.WARNING('Dry run — no changes saved.'))
