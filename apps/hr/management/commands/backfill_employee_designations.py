"""Backfill employee.designation FK from job_title text matches."""
from __future__ import annotations

from django.core.management.base import BaseCommand
from django.db import transaction

from apps.hr.designation_utils import (
    LINK_ALREADY_LINKED,
    LINK_LINKED,
    LINK_MULTIPLE_MATCHES,
    LINK_NO_HOSPITAL,
    LINK_NO_JOB_TITLE,
    LINK_NO_MATCH,
    link_employee_designation_from_job_title,
)
from apps.hr.models import Employee


class Command(BaseCommand):
    help = (
        'Link employee.designation FK where job_title matches exactly one hospital designation. '
        'Generates a report of linked, no-match, and ambiguous rows.'
    )

    def add_arguments(self, parser):
        parser.add_argument(
            '--dry-run',
            action='store_true',
            help='Report matches without saving changes.',
        )
        parser.add_argument(
            '--active-only',
            action='store_true',
            help='Only process active employees.',
        )

    def handle(self, *args, **options):
        dry_run = options['dry_run']
        active_only = options['active_only']

        qs = Employee.objects.filter(designation__isnull=True).order_by('employee_id')
        if active_only:
            qs = qs.filter(status='active')

        linked: list[str] = []
        no_match: list[str] = []
        multiple: list[str] = []
        skipped: list[str] = []

        for employee in qs.iterator():
            label = f'{employee.employee_id} — {employee.name}'
            if not (employee.job_title or '').strip():
                skipped.append(f'{label} (no job_title)')
                continue

            if dry_run:
                from apps.hr.designation_utils import resolve_employee_hospital_id, resolve_designation_link_from_job_title

                hospital_id = resolve_employee_hospital_id(employee)
                result = resolve_designation_link_from_job_title(
                    hospital_id=hospital_id,
                    job_title=employee.job_title,
                )
                status = result.status
            else:
                with transaction.atomic():
                    result = link_employee_designation_from_job_title(employee, save=True)
                    status = result.status

            if status in {LINK_LINKED, LINK_ALREADY_LINKED}:
                linked.append(label)
            elif status == LINK_MULTIPLE_MATCHES:
                multiple.append(label)
            elif status in {LINK_NO_MATCH, LINK_NO_HOSPITAL, LINK_NO_JOB_TITLE}:
                no_match.append(label)
            else:
                no_match.append(f'{label} ({status})')

        self.stdout.write(self.style.MIGRATE_HEADING('Designation backfill report'))
        self.stdout.write(f'Dry run: {dry_run}')
        self.stdout.write(f'Active only: {active_only}')
        self.stdout.write('')

        self.stdout.write(self.style.SUCCESS(f'Linked successfully: {len(linked)}'))
        for row in linked:
            self.stdout.write(f'  • {row}')

        self.stdout.write('')
        self.stdout.write(self.style.WARNING(f'No match found: {len(no_match)}'))
        for row in no_match:
            self.stdout.write(f'  • {row}')

        self.stdout.write('')
        self.stdout.write(self.style.ERROR(f'Multiple matches found: {len(multiple)}'))
        for row in multiple:
            self.stdout.write(f'  • {row}')

        if skipped:
            self.stdout.write('')
            self.stdout.write(f'Skipped (empty job_title): {len(skipped)}')
            for row in skipped:
                self.stdout.write(f'  • {row}')

        self.stdout.write('')
        self.stdout.write(
            f'Total scanned: {len(linked) + len(no_match) + len(multiple) + len(skipped)}',
        )
