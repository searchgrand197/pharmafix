"""
Shared HR operational data reset for QA / demo environments.

Preserves: Django users, superusers, hospitals, OfferLetterSettings, OfferTemplate,
ComponentOfferTemplate, DocumentType, LeaveType, Training,
Policy, Role, permissions, migrations, and org branding media:

  company_logos/, hr_signatures/, offer_settings/logos/, offer_settings/signatures/

Deletes operational uploads: resumes/, candidate_photos/, offers/, employee_documents/,
employee_requirements/, per-offer offer_company_logos/ & offer_hr_signatures/, etc.

Does NOT touch apps.staff or apps.attendance (HMS staff attendance module).
"""
from __future__ import annotations

import os
import shutil
from pathlib import Path
from typing import Callable

from django.conf import settings
from django.contrib.auth import get_user_model
from django.core.management import call_command
from django.core.management.base import CommandError
from django.db import connection, transaction

from apps.shared.models import Hospital

from apps.hr.biometric_models import (
    BiometricDevice,
    BiometricDeviceCommand,
    BiometricEnrollment,
    BiometricRejectedPunch,
    BiometricSyncLog,
    BiometricUnlinkedUser,
)
from apps.hr.models import (
    ApplicationDocumentRequirement,
    Attendance,
    AttendanceControlAuditLog,
    AttendanceMonthFinalization,
    AttendancePunch,
    AttendanceRegularization,
    Candidate,
    CandidateProfile,
    ComponentOfferTemplate,
    DailyAttendance,
    Department,
    Designation,
    DocumentStatusTransition,
    DocumentType,
    Employee,
    EmployeeDocument,
    EmployeeDocumentAuditLog,
    EmployeeDocumentRequirement,
    EmployeeDocumentUploadVersion,
    EmployeePolicy,
    EmployeePortalNotification,
    EmployeeShift,
    EmployeeTraining,
    Interview,
    InterviewBulkAuditLog,
    InterviewReminder,
    JobDocumentRequirement,
    JobOpening,
    Leave,
    LeaveBalance,
    LeavePolicy,
    LeavePolicyLine,
    LeaveRequest,
    LeaveType,
    Offer,
    OfferBuilderV2,
    OfferLetterSettings,
    OfferTemplate,
    OrganizationHoliday,
    PerformanceReview,
    Policy,
    RecruitmentEmailEvent,
    RecruitmentIdSequence,
    Role,
    Salary,
    Shift,
    Training,
)
from apps.hr.payroll_models import (
    CompensationLevel,
    DepartmentSalaryStructure,
    EmployeeCompensationAssignment,
    EmployeeCompensationOverride,
    PayrollAuditLog,
    PayrollRun,
    Payslip,
    SalaryStructure,
)

User = get_user_model()

# Operational upload folders — never template/org branding paths.
MEDIA_SUBDIRS_TO_CLEAR = (
    'resumes',
    'candidate_photos',
    'offers',
    'employee_documents',
    'employee_requirements',
    'offer_company_logos',
    'offer_hr_signatures',
    'onboarding',
    'hr_exports',
    'recruitment_exports',
    'temp_exports',
)

# Kept on disk (organization / template branding) — demo reset only.
MEDIA_SUBDIRS_PRESERVED = (
    'company_logos',
    'hr_signatures',
    'offer_settings',
)

# Full HR wipe clears branding folders too.
MEDIA_SUBDIRS_FULL_CLEAR = MEDIA_SUBDIRS_TO_CLEAR + MEDIA_SUBDIRS_PRESERVED

BIOMETRIC_DEVICE_STEP_KEYS = frozenset({'biometric_device_commands', 'biometric_devices'})

# FK-safe deletion order (children before parents).
DELETE_STEPS: tuple[tuple[str, type], ...] = (
    ('offer_builder_v2', OfferBuilderV2),
    ('offers', Offer),
    ('recruitment_email_events', RecruitmentEmailEvent),
    ('attendance_control_audit_logs', AttendanceControlAuditLog),
    ('biometric_device_commands', BiometricDeviceCommand),
    ('biometric_enrollments', BiometricEnrollment),
    ('biometric_rejected_punches', BiometricRejectedPunch),
    ('biometric_sync_logs', BiometricSyncLog),
    ('biometric_unlinked_users', BiometricUnlinkedUser),
    ('biometric_devices', BiometricDevice),
    ('attendance_regularizations', AttendanceRegularization),
    ('daily_attendance', DailyAttendance),
    ('leave_requests', LeaveRequest),
    ('attendance_punches', AttendancePunch),
    ('legacy_attendance', Attendance),
    ('leave_balances', LeaveBalance),
    ('leaves', Leave),
    ('salary_records', Salary),
    ('performance_reviews', PerformanceReview),
    ('employee_training', EmployeeTraining),
    ('employee_policies', EmployeePolicy),
    ('employee_shifts', EmployeeShift),
    ('employee_document_upload_versions', EmployeeDocumentUploadVersion),
    ('employee_document_audit_logs', EmployeeDocumentAuditLog),
    ('document_status_transitions', DocumentStatusTransition),
    ('employee_document_requirements', EmployeeDocumentRequirement),
    ('employee_documents_legacy', EmployeeDocument),
    ('employees', Employee),
    ('interview_reminders', InterviewReminder),
    ('interview_bulk_audit_logs', InterviewBulkAuditLog),
    ('interviews', Interview),
    ('application_document_requirements', ApplicationDocumentRequirement),
    ('candidates', Candidate),
    ('job_document_requirements', JobDocumentRequirement),
    ('job_openings', JobOpening),
    ('candidate_profiles', CandidateProfile),
)

# FK-safe full wipe: payroll, operational data, then master/config tables.
DELETE_STEPS_FULL: tuple[tuple[str, type], ...] = (
    ('payslips', Payslip),
    ('payroll_audit_logs', PayrollAuditLog),
    ('payroll_runs', PayrollRun),
    ('employee_compensation_overrides', EmployeeCompensationOverride),
    ('employee_compensation_assignments', EmployeeCompensationAssignment),
    ('salary_structures', SalaryStructure),
    ('compensation_levels', CompensationLevel),
    ('department_salary_structures', DepartmentSalaryStructure),
    ('offer_builder_v2', OfferBuilderV2),
    ('offers', Offer),
    ('recruitment_email_events', RecruitmentEmailEvent),
    ('attendance_control_audit_logs', AttendanceControlAuditLog),
    ('biometric_device_commands', BiometricDeviceCommand),
    ('biometric_enrollments', BiometricEnrollment),
    ('biometric_rejected_punches', BiometricRejectedPunch),
    ('biometric_sync_logs', BiometricSyncLog),
    ('biometric_unlinked_users', BiometricUnlinkedUser),
    ('biometric_devices', BiometricDevice),
    ('attendance_month_finalizations', AttendanceMonthFinalization),
    ('employee_portal_notifications', EmployeePortalNotification),
    ('attendance_regularizations', AttendanceRegularization),
    ('daily_attendance', DailyAttendance),
    ('leave_requests', LeaveRequest),
    ('attendance_punches', AttendancePunch),
    ('legacy_attendance', Attendance),
    ('leave_balances', LeaveBalance),
    ('leaves', Leave),
    ('salary_records', Salary),
    ('performance_reviews', PerformanceReview),
    ('employee_training', EmployeeTraining),
    ('employee_policies', EmployeePolicy),
    ('employee_shifts', EmployeeShift),
    ('employee_document_upload_versions', EmployeeDocumentUploadVersion),
    ('employee_document_audit_logs', EmployeeDocumentAuditLog),
    ('document_status_transitions', DocumentStatusTransition),
    ('employee_document_requirements', EmployeeDocumentRequirement),
    ('employee_documents_legacy', EmployeeDocument),
    ('employees', Employee),
    ('interview_reminders', InterviewReminder),
    ('interview_bulk_audit_logs', InterviewBulkAuditLog),
    ('interviews', Interview),
    ('application_document_requirements', ApplicationDocumentRequirement),
    ('candidates', Candidate),
    ('job_document_requirements', JobDocumentRequirement),
    ('job_openings', JobOpening),
    ('candidate_profiles', CandidateProfile),
    ('designations', Designation),
    ('departments', Department),
    ('shifts', Shift),
    ('leave_policy_lines', LeavePolicyLine),
    ('leave_policies', LeavePolicy),
    ('leave_types', LeaveType),
    ('document_types', DocumentType),
    ('offer_templates', OfferTemplate),
    ('component_offer_templates', ComponentOfferTemplate),
    ('offer_letter_settings', OfferLetterSettings),
    ('organization_holidays', OrganizationHoliday),
    ('roles', Role),
    ('trainings', Training),
    ('policies', Policy),
)


def build_full_delete_steps(*, keep_biometric_devices: bool) -> tuple[tuple[str, type], ...]:
    if keep_biometric_devices:
        return tuple(
            step for step in DELETE_STEPS_FULL if step[0] not in BIOMETRIC_DEVICE_STEP_KEYS
        )
    return DELETE_STEPS_FULL


def _add_file_path(paths: set[str], field_file) -> None:
    if not field_file:
        return
    try:
        path = field_file.path
    except (ValueError, AttributeError):
        return
    if path and os.path.isfile(path):
        paths.add(path)


def collect_operational_media_paths() -> set[str]:
    paths: set[str] = set()
    for offer in Offer.objects.iterator():
        _add_file_path(paths, offer.pdf)
        _add_file_path(paths, offer.company_logo)
        _add_file_path(paths, offer.hr_signature)
    for cand in Candidate.objects.iterator():
        _add_file_path(paths, cand.resume)
        _add_file_path(paths, cand.passport_photo)
    for req in EmployeeDocumentRequirement.objects.iterator():
        _add_file_path(paths, req.uploaded_file)
    for ver in EmployeeDocumentUploadVersion.objects.iterator():
        _add_file_path(paths, ver.file)
    for doc in EmployeeDocument.objects.iterator():
        _add_file_path(paths, doc.file)
    return paths


def collect_full_media_paths() -> set[str]:
    paths = collect_operational_media_paths()
    for settings_row in OfferLetterSettings.objects.iterator():
        _add_file_path(paths, settings_row.logo)
        _add_file_path(paths, settings_row.signature)
    for template in OfferTemplate.objects.iterator():
        _add_file_path(paths, template.company_logo)
        _add_file_path(paths, template.hr_signature)
    for leave in LeaveRequest.objects.iterator():
        _add_file_path(paths, leave.attachment)
    return paths


def _count_files_in_tree(root: Path) -> int:
    if not root.is_dir():
        return 0
    return sum(len(files) for _dir, _subdirs, files in os.walk(root))


def reset_db_sequences(models) -> None:
    from django.core.management.color import no_style

    sql_list = connection.ops.sequence_reset_sql(no_style(), models)
    if not sql_list:
        return
    with connection.cursor() as cursor:
        for sql in sql_list:
            cursor.execute(sql)


def operational_counts(*, keep_departments: bool, keep_shifts: bool) -> dict[str, int]:
    counts = {key: model.objects.count() for key, model in DELETE_STEPS}
    counts['shifts'] = Shift.objects.count()
    counts['departments'] = Department.objects.count()
    counts['applications'] = counts['candidates']
    counts['attendance_summaries'] = counts['daily_attendance']
    counts['attendance'] = (
        counts['attendance_punches']
        + counts['daily_attendance']
        + counts['legacy_attendance']
        + counts['attendance_regularizations']
        + counts['attendance_control_audit_logs']
    )
    counts['biometric_device_punches'] = AttendancePunch.objects.filter(
        source='biometric',
    ).count()
    return counts


def preserved_counts() -> dict[str, int]:
    return {
        'users': User.objects.count(),
        'superusers': User.objects.filter(is_superuser=True).count(),
        'hospitals': Hospital.objects.count(),
        'roles': Role.objects.count(),
        'leave_types': LeaveType.objects.count(),
        'offer_templates': OfferTemplate.objects.count(),
        'component_offer_templates': ComponentOfferTemplate.objects.count(),
        'document_types': DocumentType.objects.count(),
        'organization_settings': OfferLetterSettings.objects.count(),
    }


def post_reset_counts(*, keep_departments: bool, keep_shifts: bool) -> dict[str, int]:
    """Counts for final verification report (expect zeros for operational keys)."""
    leave_total = (
        LeaveRequest.objects.count()
        + LeaveBalance.objects.count()
        + Leave.objects.count()
    )
    attendance_total = (
        AttendancePunch.objects.count()
        + DailyAttendance.objects.count()
        + Attendance.objects.count()
        + AttendanceRegularization.objects.count()
        + AttendanceControlAuditLog.objects.count()
    )
    return {
        'jobs': JobOpening.objects.count(),
        'candidates': Candidate.objects.count(),
        'applications': Candidate.objects.count(),
        'candidate_profiles': CandidateProfile.objects.count(),
        'interviews': Interview.objects.count(),
        'interview_reminders': InterviewReminder.objects.count(),
        'offers': Offer.objects.count(),
        'employees': Employee.objects.count(),
        'departments': Department.objects.count(),
        'shifts': Shift.objects.count(),
        'attendance_records': attendance_total,
        'attendance_punches': AttendancePunch.objects.count(),
        'attendance_summaries': DailyAttendance.objects.count(),
        'leave_records': leave_total,
        'salary_records': Salary.objects.count(),
        'performance_reviews': PerformanceReview.objects.count(),
        'payroll_runs': 0,
        'payslips': 0,
        'kpis': 0,
        'ratings': 0,
    }


def print_final_cleanup_report(
    *,
    stdout_write: Callable[[str], None],
    style,
    preserved_after: dict[str, int],
    keep_departments: bool,
    keep_shifts: bool,
) -> bool:
    """Print verification table; return True if all operational counts are zero."""
    post = post_reset_counts(keep_departments=keep_departments, keep_shifts=keep_shifts)
    stdout_write(style.SUCCESS('=== FINAL CLEANUP REPORT ==='))
    stdout_write('Operational data (expect 0):')
    all_zero = True
    checks = [
        ('Jobs', 'jobs'),
        ('Candidates', 'candidates'),
        ('Applications', 'applications'),
        ('Employees', 'employees'),
        ('Departments', 'departments'),
        ('Shifts', 'shifts'),
        ('Attendance records (all types)', 'attendance_records'),
        ('Leave records (requests+balances+legacy)', 'leave_records'),
        ('Performance reviews', 'performance_reviews'),
        ('Salary records (payroll)', 'salary_records'),
    ]
    for label, key in checks:
        val = post[key]
        skip_zero = (key == 'departments' and keep_departments) or (key == 'shifts' and keep_shifts)
        if skip_zero:
            stdout_write(f'  [SKIP] {label}: {val} (kept via flag)')
            continue
        ok = val == 0
        if not ok:
            all_zero = False
        mark = 'OK' if ok else 'FAIL'
        stdout_write(f'  [{mark}] {label}: {val}')

    stdout_write('Preserved configuration (must remain):')
    for label, key in (
        ('Users', 'users'),
        ('Superusers', 'superusers'),
        ('Hospitals', 'hospitals'),
        ('Organization settings (OfferLetterSettings)', 'organization_settings'),
        ('Offer templates', 'offer_templates'),
        ('Roles', 'roles'),
        ('Document types', 'document_types'),
    ):
        val = preserved_after.get(key, 0)
        ok = val > 0 if key in ('superusers', 'hospitals') else val >= 0
        if key == 'superusers':
            ok = val >= 1
        mark = 'OK' if ok else 'WARN'
        stdout_write(f'  [{mark}] {label}: {val}')

    stdout_write('Media folders preserved (not cleared):')
    for sub in MEDIA_SUBDIRS_PRESERVED:
        root = Path(settings.MEDIA_ROOT) / sub
        exists = root.is_dir()
        stdout_write(f'  [OK] {sub}/' if exists else f'  [—] {sub}/ (not created yet)')

    stdout_write('Payroll modules not in codebase: payroll_runs=0, payslips=0 (N/A)')
    stdout_write('Performance KPI/rating tables not in codebase: kpis=0, ratings=0 (N/A)')

    return all_zero


def run_django_system_check(*, stdout_write: Callable[[str], None], style) -> None:
    stdout_write(style.WARNING('Running: python manage.py check'))
    try:
        call_command('check', verbosity=1)
    except Exception as exc:
        raise CommandError(f'manage.py check failed: {exc}') from exc
    stdout_write(style.SUCCESS('System check: no issues.'))


def run_delete_steps(steps: tuple[tuple[str, type], ...]) -> dict[str, int]:
    deleted: dict[str, int] = {}
    for key, model in steps:
        deleted[key] = model.objects.all().delete()[0]
    return deleted


def verify_clean_state(*, keep_departments: bool, keep_shifts: bool) -> None:
    checks = [
        (JobOpening, 'job openings'),
        (CandidateProfile, 'candidate profiles'),
        (Candidate, 'candidates/applications'),
        (Interview, 'interviews'),
        (InterviewReminder, 'interview reminders'),
        (Offer, 'offers'),
        (OfferBuilderV2, 'offer builder drafts'),
        (Employee, 'employees'),
        (AttendancePunch, 'attendance punches'),
        (DailyAttendance, 'daily attendance summaries'),
        (AttendanceControlAuditLog, 'attendance control audit logs'),
        (LeaveRequest, 'leave requests'),
        (LeaveBalance, 'leave balances'),
        (Leave, 'legacy leave records'),
        (AttendanceRegularization, 'attendance regularizations'),
        (Attendance, 'legacy attendance records'),
        (Salary, 'salary records'),
        (PerformanceReview, 'performance reviews'),
        (RecruitmentEmailEvent, 'recruitment email events'),
        (InterviewBulkAuditLog, 'interview bulk audit logs'),
    ]
    if not keep_shifts:
        checks.append((Shift, 'shifts'))
    if not keep_departments:
        checks.append((Department, 'departments'))
    for model, label in checks:
        if model.objects.exists():
            raise RuntimeError(f'Expected zero {label} after reset')

    bio = AttendancePunch.objects.filter(source='biometric').count()
    if bio:
        raise RuntimeError(f'Expected zero biometric device punches after reset (found {bio})')


def run_hr_demo_reset(
    *,
    stdout_write: Callable[[str], None],
    style,
    dry_run: bool = False,
    no_input: bool = False,
    keep_departments: bool = False,
    keep_shifts: bool = False,
    run_check: bool = True,
) -> None:
    pre = operational_counts(keep_departments=keep_departments, keep_shifts=keep_shifts)
    preserved = preserved_counts()

    stdout_write(style.WARNING('HR operational data reset — BEFORE deletion'))
    stdout_write('  Operational row counts:')
    for key in (
        'job_openings',
        'candidate_profiles',
        'candidates',
        'interviews',
        'interview_reminders',
        'offers',
        'offer_builder_v2',
        'employees',
        'attendance',
        'attendance_summaries',
        'biometric_device_punches',
        'leave_requests',
        'leave_balances',
        'salary_records',
        'performance_reviews',
        'shifts',
        'departments',
    ):
        stdout_write(f'    {key}: {pre.get(key, 0)}')
    stdout_write('  Will PRESERVE:')
    for key, val in preserved.items():
        stdout_write(f'    {key}: {val}')
    stdout_write(f'  Media kept: {", ".join(MEDIA_SUBDIRS_PRESERVED)}')
    stdout_write('  (Also: permissions, migrations, Training/Policy masters, HMS staff module)')
    if keep_departments:
        stdout_write(style.NOTICE('  --keep-departments: HR departments will be kept.'))
    if keep_shifts:
        stdout_write(style.NOTICE('  --keep-shifts: HR shift masters will be kept.'))

    if dry_run:
        stdout_write(style.NOTICE('Dry run: no changes made.'))
        return

    if preserved['superusers'] < 1:
        raise CommandError('Refusing to run: no superuser accounts found.')

    if not no_input:
        confirm = input(
            'Delete ALL HR operational/demo data listed above? Type yes to confirm: '
        )
        if confirm.strip().lower() != 'yes':
            stdout_write(style.ERROR('Aborted.'))
            return

    media_paths = collect_operational_media_paths()
    deleted: dict[str, int] = {}

    try:
        with transaction.atomic():
            deleted = run_delete_steps(DELETE_STEPS)

            sequences_reset = RecruitmentIdSequence.objects.filter(
                prefix__in=['CAND', 'APP'],
            ).update(last_seq=0)

            post_steps = []
            if not keep_shifts:
                post_steps.append(('shifts', Shift))
            if not keep_departments:
                post_steps.append(('departments', Department))
            if post_steps:
                deleted.update(run_delete_steps(tuple(post_steps)))

            verify_clean_state(keep_departments=keep_departments, keep_shifts=keep_shifts)

    except Exception as exc:
        stdout_write(style.ERROR(f'Transaction rolled back: {exc}'))
        raise CommandError('Database reset failed; no partial HR data was committed.') from exc

    files_removed = 0
    for p in media_paths:
        try:
            os.remove(p)
            files_removed += 1
        except OSError as e:
            stdout_write(style.WARNING(f'Could not remove file {p}: {e}'))

    media_root = Path(settings.MEDIA_ROOT)
    extra_removed = 0
    for sub in MEDIA_SUBDIRS_TO_CLEAR:
        d = media_root / sub
        if d.is_dir():
            extra_removed += _count_files_in_tree(d)
            try:
                shutil.rmtree(d)
            except OSError as e:
                stdout_write(style.WARNING(f'Could not remove directory {d}: {e}'))
            else:
                d.mkdir(parents=True, exist_ok=True)

    sequence_models = [m for _, m in DELETE_STEPS]
    if not keep_shifts:
        sequence_models.append(Shift)
    if not keep_departments:
        sequence_models.append(Department)
    sequence_models.append(RecruitmentIdSequence)
    reset_db_sequences(sequence_models)

    preserved_after = preserved_counts()

    post = post_reset_counts(keep_departments=keep_departments, keep_shifts=keep_shifts)
    stdout_write(style.SUCCESS('--- AFTER deletion (remaining rows) ---'))
    for label, key in (
        ('jobs', 'jobs'),
        ('candidates', 'candidates'),
        ('employees', 'employees'),
        ('attendance (all)', 'attendance_records'),
        ('leave (all)', 'leave_records'),
    ):
        stdout_write(f'  {label}: {post[key]}')

    stdout_write(style.SUCCESS('--- Deleted (row counts removed) ---'))
    for label, key in (
        ('jobs', 'job_openings'),
        ('candidate profiles', 'candidate_profiles'),
        ('applications', 'candidates'),
        ('interviews', 'interviews'),
        ('interview reminders', 'interview_reminders'),
        ('offers', 'offers'),
        ('offer drafts', 'offer_builder_v2'),
        ('employees', 'employees'),
        ('attendance summaries', 'daily_attendance'),
        ('attendance punches', 'attendance_punches'),
        ('attendance regularizations', 'attendance_regularizations'),
        ('biometric sync logs', 'biometric_sync_logs'),
        ('attendance control audit logs', 'attendance_control_audit_logs'),
        ('leave requests', 'leave_requests'),
        ('leave balances', 'leave_balances'),
        ('salary records', 'salary_records'),
        ('performance reviews', 'performance_reviews'),
        ('shifts', 'shifts'),
        ('departments', 'departments'),
    ):
        stdout_write(f'  {label}: {deleted.get(key, 0)}')
    stdout_write(f'  recruitment ID sequences reset: {sequences_reset}')
    stdout_write(f'  referenced media files removed: {files_removed}')
    stdout_write(f'  operational folder files cleared: {extra_removed}')

    stdout_write(style.SUCCESS('--- Preserved ---'))
    for key in (
        'users',
        'superusers',
        'hospitals',
        'roles',
        'leave_types',
        'offer_templates',
        'component_offer_templates',
        'document_types',
        'organization_settings',
    ):
        stdout_write(f'  {key}: {preserved_after[key]}')

    all_zero = print_final_cleanup_report(
        stdout_write=stdout_write,
        style=style,
        preserved_after=preserved_after,
        keep_departments=keep_departments,
        keep_shifts=keep_shifts,
    )
    if not all_zero:
        raise CommandError('Post-reset verification failed: operational counts are not all zero.')

    if run_check:
        run_django_system_check(stdout_write=stdout_write, style=style)

    stdout_write(style.SUCCESS('Fresh HR operational state ready for testing.'))


def full_reset_counts(steps: tuple[tuple[str, type], ...]) -> dict[str, int]:
    counts = {key: model.objects.count() for key, model in steps}
    counts['biometric_devices'] = BiometricDevice.objects.count()
    counts['biometric_device_commands'] = BiometricDeviceCommand.objects.count()
    return counts


def full_preserved_counts() -> dict[str, int]:
    return {
        'users': User.objects.count(),
        'superusers': User.objects.filter(is_superuser=True).count(),
        'hospitals': Hospital.objects.count(),
        'biometric_devices': BiometricDevice.objects.count(),
        'biometric_device_commands': BiometricDeviceCommand.objects.count(),
    }


def verify_full_clean_state(
    steps: tuple[tuple[str, type], ...],
    *,
    keep_biometric_devices: bool,
    expected_biometric_devices: int,
    expected_biometric_commands: int,
) -> None:
    for _key, model in steps:
        if model.objects.exists():
            raise RuntimeError(
                f'Expected zero {model._meta.verbose_name_plural} after full reset',
            )
    if keep_biometric_devices:
        if BiometricDevice.objects.count() != expected_biometric_devices:
            raise RuntimeError(
                'BiometricDevice count changed after reset '
                f'(expected {expected_biometric_devices}, '
                f'found {BiometricDevice.objects.count()})',
            )
        if BiometricDeviceCommand.objects.count() != expected_biometric_commands:
            raise RuntimeError(
                'BiometricDeviceCommand count changed after reset '
                f'(expected {expected_biometric_commands}, '
                f'found {BiometricDeviceCommand.objects.count()})',
            )


def print_full_cleanup_report(
    *,
    stdout_write: Callable[[str], None],
    style,
    preserved_after: dict[str, int],
    keep_biometric_devices: bool,
    expected_biometric_devices: int,
) -> bool:
    stdout_write(style.SUCCESS('=== FULL HR RESET REPORT ==='))
    all_ok = True

    stdout_write('Deleted tables (expect 0 rows):')
    for key, model in build_full_delete_steps(keep_biometric_devices=keep_biometric_devices):
        val = model.objects.count()
        ok = val == 0
        if not ok:
            all_ok = False
        mark = 'OK' if ok else 'FAIL'
        stdout_write(f'  [{mark}] {key}: {val}')

    stdout_write('Preserved (must remain):')
    for label, key, min_val in (
        ('Users', 'users', 0),
        ('Superusers', 'superusers', 1),
        ('Hospitals', 'hospitals', 1),
    ):
        val = preserved_after.get(key, 0)
        ok = val >= min_val
        if not ok:
            all_ok = False
        mark = 'OK' if ok else 'FAIL'
        stdout_write(f'  [{mark}] {label}: {val}')

    if keep_biometric_devices:
        val = preserved_after.get('biometric_devices', 0)
        ok = val == expected_biometric_devices and val > 0
        if expected_biometric_devices == 0:
            ok = val == 0
        if not ok:
            all_ok = False
        mark = 'OK' if ok else 'FAIL'
        stdout_write(
            f'  [{mark}] Biometric devices (serial registrations): {val} '
            f'(expected {expected_biometric_devices})',
        )

    stdout_write(f'Media folders cleared: {", ".join(MEDIA_SUBDIRS_FULL_CLEAR)}')
    return all_ok


def run_hr_full_reset(
    *,
    stdout_write: Callable[[str], None],
    style,
    dry_run: bool = False,
    no_input: bool = False,
    keep_biometric_devices: bool = True,
    run_check: bool = True,
) -> None:
    steps = build_full_delete_steps(keep_biometric_devices=keep_biometric_devices)
    pre = full_reset_counts(steps)
    preserved = full_preserved_counts()
    expected_devices = preserved['biometric_devices']
    expected_commands = preserved['biometric_device_commands']

    stdout_write(style.WARNING('Full HR data reset — BEFORE deletion'))
    stdout_write('  Row counts to delete:')
    for key, model in steps:
        stdout_write(f'    {key}: {pre.get(key, model.objects.count())}')
    stdout_write('  Will PRESERVE:')
    for key, val in preserved.items():
        stdout_write(f'    {key}: {val}')
    if keep_biometric_devices:
        stdout_write(style.NOTICE(
            '  Biometric device registrations (serial numbers) will be kept.',
        ))
    else:
        stdout_write(style.WARNING('  Biometric devices will be PURGED.'))
    stdout_write('  (HMS staff module apps.staff / apps.attendance is NOT touched)')

    if dry_run:
        stdout_write(style.NOTICE('Dry run: no changes made.'))
        return

    if preserved['superusers'] < 1:
        raise CommandError('Refusing to run: no superuser accounts found.')

    if not no_input:
        confirm = input(
            'Delete ALL HR data (keeping biometric devices)? Type yes to confirm: '
            if keep_biometric_devices
            else 'Delete ALL HR data INCLUDING biometric devices? Type yes to confirm: '
        )
        if confirm.strip().lower() != 'yes':
            stdout_write(style.ERROR('Aborted.'))
            return

    media_paths = collect_full_media_paths()
    deleted: dict[str, int] = {}

    try:
        with transaction.atomic():
            deleted = run_delete_steps(steps)
            sequences_reset = RecruitmentIdSequence.objects.all().update(last_seq=0)
            verify_full_clean_state(
                steps,
                keep_biometric_devices=keep_biometric_devices,
                expected_biometric_devices=expected_devices,
                expected_biometric_commands=expected_commands,
            )
    except Exception as exc:
        stdout_write(style.ERROR(f'Transaction rolled back: {exc}'))
        raise CommandError('Database reset failed; no partial HR data was committed.') from exc

    files_removed = 0
    for p in media_paths:
        try:
            os.remove(p)
            files_removed += 1
        except OSError as e:
            stdout_write(style.WARNING(f'Could not remove file {p}: {e}'))

    media_root = Path(settings.MEDIA_ROOT)
    extra_removed = 0
    for sub in MEDIA_SUBDIRS_FULL_CLEAR:
        d = media_root / sub
        if d.is_dir():
            extra_removed += _count_files_in_tree(d)
            try:
                shutil.rmtree(d)
            except OSError as e:
                stdout_write(style.WARNING(f'Could not remove directory {d}: {e}'))
            else:
                d.mkdir(parents=True, exist_ok=True)

    sequence_models = [m for _, m in steps]
    sequence_models.append(RecruitmentIdSequence)
    reset_db_sequences(sequence_models)

    preserved_after = full_preserved_counts()

    stdout_write(style.SUCCESS('--- AFTER deletion ---'))
    stdout_write(f'  employees: {Employee.objects.count()}')
    stdout_write(f'  departments: {Department.objects.count()}')
    stdout_write(f'  biometric_devices: {BiometricDevice.objects.count()}')

    stdout_write(style.SUCCESS('--- Deleted (row counts removed) ---'))
    for key, _model in steps:
        stdout_write(f'  {key}: {deleted.get(key, 0)}')
    stdout_write(f'  recruitment ID sequences reset: {sequences_reset}')
    stdout_write(f'  referenced media files removed: {files_removed}')
    stdout_write(f'  media folder files cleared: {extra_removed}')

    all_ok = print_full_cleanup_report(
        stdout_write=stdout_write,
        style=style,
        preserved_after=preserved_after,
        keep_biometric_devices=keep_biometric_devices,
        expected_biometric_devices=expected_devices,
    )
    if not all_ok:
        raise CommandError('Post-reset verification failed.')

    if run_check:
        run_django_system_check(stdout_write=stdout_write, style=style)

    stdout_write(style.SUCCESS('Fresh HR state ready — biometric devices preserved.'))
