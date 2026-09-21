"""
Payroll approval workflow — HR financial control layer on top of PayrollCalculator output.

State machine:
  DRAFT → UNDER_REVIEW → APPROVED → LOCKED → PUBLISHED
"""
from __future__ import annotations

from dataclasses import dataclass, field
from decimal import Decimal
from typing import TYPE_CHECKING

from django.db import transaction
from django.utils import timezone

if TYPE_CHECKING:
    from apps.hr.payroll_models import PayrollRun

MONEY_QUANTIZE = Decimal('0.01')


class PayrollApprovalError(Exception):
    """Base payroll approval workflow error."""


class PayrollStateError(PayrollApprovalError):
    """Invalid status transition."""


class PayrollValidationError(PayrollApprovalError):
    """Pre-approval validation failed."""

    def __init__(self, message: str, *, errors: list[str] | None = None, warnings: list[str] | None = None):
        super().__init__(message)
        self.errors = errors or []
        self.warnings = warnings or []


@dataclass
class PayrollValidationResult:
    errors: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    incomplete: bool = False

    @property
    def ok(self) -> bool:
        return not self.errors


def _decimal(value) -> Decimal:
    if value is None or value == '':
        return Decimal('0.00')
    return Decimal(str(value)).quantize(MONEY_QUANTIZE)


def snapshot_payroll_state(payroll_run: 'PayrollRun') -> dict:
    snapshot = payroll_run.calculation_snapshot or {}
    return {
        'status': payroll_run.status,
        'month': payroll_run.month,
        'employee_id': payroll_run.employee.employee_id if payroll_run.employee_id else None,
        'gross_salary': str(payroll_run.gross_salary),
        'total_deductions': str(payroll_run.total_deductions),
        'final_salary': str(payroll_run.final_salary),
        'total_present_days': str(payroll_run.total_present_days),
        'total_absent_days': str(payroll_run.total_absent_days),
        'total_leave_days': str(payroll_run.total_leave_days),
        'overtime_hours': str(payroll_run.overtime_hours),
        'salary_structure_id': str(payroll_run.salary_structure_id) if payroll_run.salary_structure_id else None,
        'warnings': snapshot.get('warnings') or [],
        'approval_flags': snapshot.get('approval_flags') or {},
    }


class PayrollApprovalService:
    """HR-controlled payroll approval workflow with audit logging."""

    def validate_for_approval(self, payroll_run: 'PayrollRun') -> PayrollValidationResult:
        from apps.hr.payroll_models import PayrollRun

        result = PayrollValidationResult()
        snapshot = payroll_run.calculation_snapshot or {}
        input_snapshots = snapshot.get('input_snapshots') or {}
        salary_snapshot = input_snapshots.get('salary') or {}

        if not payroll_run.salary_structure_id:
            result.errors.append('missing_salary_structure')

        if (
            payroll_run.employee.designation_id
            and not payroll_run.employee_compensation_assignment_id
            and not salary_snapshot.get('compensation_assignment_id')
        ):
            result.errors.append('missing_compensation_assignment')

        if not input_snapshots.get('attendance_month_finalization_id'):
            result.errors.append('attendance_month_not_finalized')

        if payroll_run.final_salary is None or _decimal(payroll_run.final_salary) < Decimal('0.00'):
            result.errors.append('negative_salary')

        if payroll_run.gross_salary is not None and _decimal(payroll_run.gross_salary) < Decimal('0.00'):
            result.errors.append('negative_gross_salary')

        if _decimal(payroll_run.overtime_hours) < Decimal('0.00'):
            result.errors.append('invalid_overtime_hours')

        if _decimal(payroll_run.overtime_hours) > Decimal('0.00'):
            structure = payroll_run.salary_structure
            rate = _decimal(getattr(structure, 'overtime_rate', 0) if structure else 0)
            if rate <= 0:
                result.warnings.append('overtime_without_rate')

        working_days = snapshot.get('working_days')
        if working_days is not None:
            total_days = (
                _decimal(payroll_run.total_present_days)
                + _decimal(payroll_run.total_absent_days)
                + _decimal(payroll_run.total_leave_days)
            )
            if abs(Decimal(str(working_days)) - total_days) > Decimal('0.05'):
                result.warnings.append('attendance_totals_mismatch')

        warnings = snapshot.get('warnings') or []
        if any('No attendance data' in str(item) for item in warnings):
            result.warnings.append('no_attendance_data')
            result.incomplete = True

        if not working_days:
            result.warnings.append('no_working_days')
            result.incomplete = True

        if PayrollRun.objects.filter(
            employee_id=payroll_run.employee_id,
            month=payroll_run.month,
        ).exclude(pk=payroll_run.pk).exists():
            result.errors.append('duplicate_payroll')

        return result

    def _log(
        self,
        payroll_run: 'PayrollRun',
        *,
        action: str,
        performed_by=None,
        old_value: dict | None = None,
        new_value: dict | None = None,
        notes: str = '',
    ) -> None:
        from apps.hr.payroll_models import PayrollAuditLog

        PayrollAuditLog.objects.create(
            payroll_run=payroll_run,
            action=action,
            performed_by=performed_by,
            old_value=old_value or {},
            new_value=new_value or {},
            notes=notes,
        )

    def _transition(
        self,
        payroll_run: 'PayrollRun',
        *,
        new_status: str,
        performed_by=None,
        action: str,
        extra_updates: dict | None = None,
        notes: str = '',
    ) -> 'PayrollRun':
        from apps.hr.payroll_models import PayrollRun

        old_state = snapshot_payroll_state(payroll_run)
        updates = {'status': new_status, 'updated_at': timezone.now(), **(extra_updates or {})}
        for field, value in updates.items():
            setattr(payroll_run, field, value)
        payroll_run.save(update_fields=list(updates.keys()))
        payroll_run.refresh_from_db()
        self._log(
            payroll_run,
            action=action,
            performed_by=performed_by,
            old_value=old_state,
            new_value=snapshot_payroll_state(payroll_run),
            notes=notes,
        )
        return payroll_run

    def submit_for_review(self, payroll_run: 'PayrollRun', *, performed_by=None) -> 'PayrollRun':
        from apps.hr.payroll_models import PayrollRun

        if payroll_run.status == PayrollRun.STATUS_UNDER_REVIEW:
            return payroll_run
        if payroll_run.status not in {PayrollRun.STATUS_DRAFT, PayrollRun.STATUS_CALCULATED}:
            raise PayrollStateError(
                f'Only DRAFT or CALCULATED payroll can be submitted for review (current: {payroll_run.status}).',
            )

        now = timezone.now()
        with transaction.atomic():
            payroll_run = PayrollRun.objects.select_for_update().get(pk=payroll_run.pk)
            return self._transition(
                payroll_run,
                new_status=PayrollRun.STATUS_UNDER_REVIEW,
                performed_by=performed_by,
                action='SUBMIT_REVIEW',
                extra_updates={'reviewed_at': now, 'reviewed_by': performed_by},
            )

    def approve_payroll(self, payroll_run: 'PayrollRun', *, hr_user) -> 'PayrollRun':
        from apps.hr.payroll_models import PayrollRun

        if payroll_run.status == PayrollRun.STATUS_APPROVED:
            return payroll_run
        if payroll_run.status == PayrollRun.STATUS_FINALIZED:
            return self._transition(
                payroll_run,
                new_status=PayrollRun.STATUS_APPROVED,
                performed_by=hr_user,
                action='APPROVE',
                extra_updates={'approved_at': timezone.now(), 'approved_by': hr_user},
                notes='Migrated legacy FINALIZED status to APPROVED.',
            )
        if payroll_run.status != PayrollRun.STATUS_UNDER_REVIEW:
            raise PayrollStateError(f'Only UNDER_REVIEW payroll can be approved (current: {payroll_run.status}).')

        validation = self.validate_for_approval(payroll_run)
        if not validation.ok:
            raise PayrollValidationError(
                'Payroll validation failed.',
                errors=validation.errors,
                warnings=validation.warnings,
            )

        snapshot = dict(payroll_run.calculation_snapshot or {})
        approval_flags = {
            'incomplete': validation.incomplete,
            'warnings': validation.warnings,
            'approved_at': timezone.now().isoformat(),
        }
        snapshot['approval_flags'] = approval_flags
        snapshot['warnings'] = list(dict.fromkeys((snapshot.get('warnings') or []) + validation.warnings))

        now = timezone.now()
        with transaction.atomic():
            payroll_run = PayrollRun.objects.select_for_update().get(pk=payroll_run.pk)
            old_state = snapshot_payroll_state(payroll_run)
            payroll_run.status = PayrollRun.STATUS_APPROVED
            payroll_run.approved_at = now
            payroll_run.approved_by = hr_user
            payroll_run.calculation_snapshot = snapshot
            payroll_run.save(update_fields=[
                'status', 'approved_at', 'approved_by', 'calculation_snapshot', 'updated_at',
            ])
            self._log(
                payroll_run,
                action='APPROVE',
                performed_by=hr_user,
                old_value=old_state,
                new_value=snapshot_payroll_state(payroll_run),
                notes='; '.join(validation.warnings) if validation.warnings else '',
            )
        return payroll_run

    def lock_payroll(self, payroll_run: 'PayrollRun', *, performed_by=None) -> 'PayrollRun':
        from apps.hr.payroll_models import PayrollRun

        if payroll_run.status == PayrollRun.STATUS_LOCKED:
            return payroll_run
        if payroll_run.status not in {PayrollRun.STATUS_APPROVED, PayrollRun.STATUS_FINALIZED}:
            raise PayrollStateError(f'Only APPROVED payroll can be locked (current: {payroll_run.status}).')

        now = timezone.now()
        with transaction.atomic():
            payroll_run = PayrollRun.objects.select_for_update().get(pk=payroll_run.pk)
            return self._transition(
                payroll_run,
                new_status=PayrollRun.STATUS_LOCKED,
                performed_by=performed_by,
                action='LOCK',
                extra_updates={'locked_at': now},
            )

    def publish_payroll(self, payroll_run: 'PayrollRun', *, performed_by=None) -> 'PayrollRun':
        from apps.hr.payroll_models import PayrollRun

        if payroll_run.status == PayrollRun.STATUS_PUBLISHED:
            return payroll_run
        if payroll_run.status != PayrollRun.STATUS_LOCKED:
            raise PayrollStateError(f'Only LOCKED payroll can be published (current: {payroll_run.status}).')

        from apps.hr.payroll_models import Payslip

        if not Payslip.objects.filter(payroll_run=payroll_run).exists():
            raise PayrollApprovalError('Payslip must be generated before publishing.')

        now = timezone.now()
        with transaction.atomic():
            payroll_run = PayrollRun.objects.select_for_update().get(pk=payroll_run.pk)
            payroll_run = self._transition(
                payroll_run,
                new_status=PayrollRun.STATUS_PUBLISHED,
                performed_by=performed_by,
                action='PUBLISH',
                extra_updates={'published_at': now, 'published_by': performed_by},
            )

        from apps.hr.email_utils import send_payslip_published_email
        from apps.hr.employee_portal_notifications import notify_payslip_published

        try:
            payslip = payroll_run.payslip
            send_payslip_published_email(payroll_run.employee, payslip=payslip, payroll_run=payroll_run)
        except Exception:
            pass

        try:
            notify_payslip_published(payroll_run)
        except Exception:
            pass

        return payroll_run

    def log_create(self, payroll_run: 'PayrollRun', *, performed_by=None) -> None:
        self._log(
            payroll_run,
            action='CREATE',
            performed_by=performed_by,
            old_value={},
            new_value=snapshot_payroll_state(payroll_run),
        )

    def recalculate(self, payroll_run: 'PayrollRun', *, performed_by=None) -> 'PayrollRun':
        from apps.hr.payroll_calculator import PayrollCalculatorError, recalculate_payroll_run

        if not payroll_run.is_editable:
            raise PayrollStateError(
                f'Payroll in {payroll_run.status} status cannot be recalculated.',
            )
        old_value = snapshot_payroll_state(payroll_run)
        try:
            payroll_run = recalculate_payroll_run(payroll_run, calculated_by=performed_by)
        except PayrollCalculatorError as exc:
            raise PayrollApprovalError(str(exc)) from exc
        self._log(
            payroll_run,
            action='UPDATE',
            performed_by=performed_by,
            old_value=old_value,
            new_value=snapshot_payroll_state(payroll_run),
            notes='Recalculated from current attendance and salary structure.',
        )
        return payroll_run
