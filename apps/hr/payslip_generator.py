"""
Payslip generation service — converts locked PayrollRun records into immutable Payslip artifacts.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from decimal import Decimal
from typing import TYPE_CHECKING

from django.db import transaction
from django.utils import timezone

from apps.hr.payslip_pdf import render_payslip_pdf_bytes

if TYPE_CHECKING:
    from apps.hr.payroll_models import PayrollRun, Payslip

MONEY_QUANTIZE = Decimal('0.01')


class PayslipGeneratorError(Exception):
    """Raised when a payslip cannot be generated."""


class DuplicatePayslipError(PayslipGeneratorError):
    """Raised when a payslip already exists for the payroll run."""


class PayrollNotReadyError(PayslipGeneratorError):
    """Raised when payroll run is not in a publishable state."""


@dataclass
class PayslipBreakdown:
    earnings: dict = field(default_factory=dict)
    deductions: dict = field(default_factory=dict)
    gross_salary: Decimal = Decimal('0.00')
    total_deductions: Decimal = Decimal('0.00')
    net_salary: Decimal = Decimal('0.00')
    attendance_summary: dict = field(default_factory=dict)


@dataclass
class PayslipBatchResult:
    month: str | None = None
    created: list['Payslip'] = field(default_factory=list)
    skipped: list[dict] = field(default_factory=list)
    errors: list[dict] = field(default_factory=list)


def _decimal(value) -> Decimal:
    if value is None or value == '':
        return Decimal('0.00')
    return Decimal(str(value)).quantize(MONEY_QUANTIZE)


def _titleize_key(key: str) -> str:
    return str(key).replace('_', ' ').strip().title()


def _format_hours(value) -> str:
    if value is None or value == '':
        return '—'
    amount = Decimal(str(value)).quantize(Decimal('0.01'))
    return f'{amount:.2f}'


def _format_days(value) -> str:
    if value is None or value == '':
        return '—'
    amount = Decimal(str(value)).quantize(Decimal('0.01'))
    if amount == amount.to_integral_value():
        return str(int(amount))
    return f'{amount:.2f}'


def _format_pct(value) -> str:
    if value is None or value == '':
        return '—'
    return f'{Decimal(str(value)).quantize(Decimal("0.1"))}%'


def attendance_summary_for_api(payroll_run: 'PayrollRun') -> dict:
    """Full attendance block for payslip APIs (includes computed attendance %)."""
    snapshot = payroll_run.calculation_snapshot or {}
    stored = snapshot.get('attendance_summary') or {}
    if (
        not stored
        and payroll_run.total_present_days is None
        and payroll_run.total_absent_days is None
        and payroll_run.total_leave_days is None
    ):
        return {}
    return PayslipGenerator()._build_attendance_summary(payroll_run, snapshot)


class PayslipGenerator:
    """Build payslip records and PDFs from PayrollRun snapshots."""

    PUBLISHABLE_STATUSES = frozenset({'LOCKED'})

    def _build_attendance_summary(self, payroll_run: 'PayrollRun', snapshot: dict) -> dict:
        """Attendance metrics frozen on PayrollRun — no live recalculation."""
        stored = snapshot.get('attendance_summary') or {}
        structure = payroll_run.salary_structure
        overtime_rate = _decimal(snapshot.get('overtime_rate') or (structure.overtime_rate if structure else None))
        overtime_amount = _decimal(snapshot.get('overtime_amount') or snapshot.get('earnings_breakdown', {}).get('overtime'))
        per_day_salary = snapshot.get('per_day_salary')

        def pick(key, fallback=None):
            if key in stored and stored[key] not in (None, ''):
                return stored[key]
            return fallback

        present = pick('present_days', payroll_run.total_present_days)
        absent = pick('absent_days', payroll_run.total_absent_days)
        leave = pick('leave_days', payroll_run.total_leave_days)
        overtime_hours = pick('overtime_hours', payroll_run.overtime_hours)
        working_days = pick('working_days', snapshot.get('working_days'))

        working_int = int(working_days) if working_days not in (None, '') else 0
        present_float = float(present or 0)
        attendance_pct = round((present_float / working_int) * 100, 1) if working_int else None

        return {
            'working_days': _format_days(working_days),
            'present_days': _format_days(present),
            'absent_days': _format_days(absent),
            'leave_days': _format_days(leave),
            'paid_leave_days': _format_days(pick('paid_leave_days', snapshot.get('paid_leave_days'))),
            'unpaid_leave_days': _format_days(pick('unpaid_leave_days', snapshot.get('unpaid_leave_days'))),
            'holiday_days': _format_days(pick('holiday_days', '0')),
            'half_days': _format_days(pick('half_days', '0')),
            'late_days': _format_days(pick('late_days', '0')),
            'incomplete_days': '—',
            'total_work_hours': _format_hours(pick('total_work_hours', snapshot.get('total_work_hours'))),
            'overtime_hours': _format_hours(overtime_hours),
            'overtime_rate': str(overtime_rate) if overtime_rate > 0 else '—',
            'overtime_amount': str(overtime_amount) if overtime_amount > 0 else '—',
            'attendance_percentage': _format_pct(attendance_pct),
            'per_day_salary': str(_decimal(per_day_salary)) if per_day_salary else '—',
            'period_start': pick('period_start'),
            'period_end': pick('period_end'),
            'late_penalty': str(_decimal(snapshot.get('late_penalty'))),
            'late_conversion_deduction': str(_decimal(snapshot.get('late_conversion_deduction'))),
            'late_equivalent_leave_days': _format_days(snapshot.get('late_equivalent_leave_days')),
            'compliance_warnings': snapshot.get('compliance_warnings') or [],
        }

    def build_breakdown(self, payroll_run: 'PayrollRun') -> PayslipBreakdown:
        snapshot = payroll_run.calculation_snapshot or {}
        structure = payroll_run.salary_structure

        earnings_snapshot = snapshot.get('earnings_breakdown') or {}
        deductions_snapshot = snapshot.get('deductions_breakdown') or {}

        earnings: dict[str, str] = {}
        if structure is not None:
            earnings['basic_salary'] = str(structure.basic_salary)
            earnings['hra'] = str(structure.hra)
            for key, value in (structure.allowances or {}).items():
                earnings[_titleize_key(key)] = str(_decimal(value))
        else:
            earnings['basic_salary'] = str(_decimal(earnings_snapshot.get('basic_salary')))
            earnings['hra'] = str(_decimal(earnings_snapshot.get('hra')))
            for key, value in (earnings_snapshot.get('allowances') or {}).items():
                earnings[_titleize_key(key)] = str(_decimal(value))

        overtime_amount = _decimal(snapshot.get('overtime_amount') or earnings_snapshot.get('overtime'))
        if overtime_amount > 0:
            earnings['overtime'] = str(overtime_amount)

        deductions: dict[str, str] = {}
        fixed = deductions_snapshot.get('fixed') or {}
        if structure is not None and not fixed:
            fixed = structure.deductions or {}
        for key, value in fixed.items():
            deductions[_titleize_key(key)] = str(_decimal(value))

        lop_amount = _decimal(deductions_snapshot.get('lop') or snapshot.get('lop_amount'))
        if lop_amount > 0:
            deductions['loss_of_pay'] = str(lop_amount)

        late_penalty = _decimal(deductions_snapshot.get('late_penalty') or snapshot.get('late_penalty'))
        if late_penalty > 0:
            deductions['late_penalty'] = str(late_penalty)

        late_conversion = _decimal(
            deductions_snapshot.get('late_conversion') or snapshot.get('late_conversion_deduction'),
        )
        if late_conversion > 0:
            deductions['late_conversion'] = str(late_conversion)

        compliance_deduction = _decimal(
            deductions_snapshot.get('attendance_compliance') or snapshot.get('attendance_compliance_deduction'),
        )
        if compliance_deduction > 0:
            deductions['attendance_compliance'] = str(compliance_deduction)

        gross_base = sum(_decimal(v) for v in earnings.values())
        total_deductions = sum(_decimal(v) for v in deductions.values())
        net_salary = _decimal(payroll_run.final_salary)
        if net_salary <= 0:
            net_salary = max(gross_base - total_deductions, Decimal('0.00'))

        attendance_summary = self._build_attendance_summary(payroll_run, snapshot)

        return PayslipBreakdown(
            earnings=earnings,
            deductions=deductions,
            gross_salary=gross_base,
            total_deductions=total_deductions,
            net_salary=net_salary,
            attendance_summary=attendance_summary,
        )

    def _get_payroll_run(self, payroll_run_id) -> 'PayrollRun':
        from apps.hr.payroll_models import PayrollRun

        try:
            return PayrollRun.objects.select_related(
                'employee',
                'employee__hospital',
                'employee__shift',
                'salary_structure',
            ).get(pk=payroll_run_id)
        except PayrollRun.DoesNotExist as exc:
            raise PayslipGeneratorError(f'PayrollRun {payroll_run_id} not found.') from exc

    def _validate_payroll_run(self, payroll_run: 'PayrollRun') -> None:
        from apps.hr.payroll_models import Payslip

        if payroll_run.status not in self.PUBLISHABLE_STATUSES:
            raise PayrollNotReadyError(
                f'PayrollRun {payroll_run.id} must be LOCKED before payslip generation.',
            )
        if hasattr(payroll_run, 'payslip') and Payslip.objects.filter(payroll_run=payroll_run).exists():
            raise DuplicatePayslipError(f'Payslip already exists for PayrollRun {payroll_run.id}.')
        if payroll_run.final_salary is None:
            raise PayslipGeneratorError('PayrollRun is missing final salary.')

    def regenerate_payslip_pdf(self, payroll_run_id, *, generated_by=None) -> 'Payslip':
        """Rebuild payslip PDF using current Organization Settings branding."""
        from apps.hr.payroll_models import Payslip

        payroll_run = self._get_payroll_run(payroll_run_id)
        if payroll_run.status not in {'LOCKED', 'PUBLISHED'}:
            raise PayrollNotReadyError(
                f'PayrollRun {payroll_run.id} must be LOCKED or PUBLISHED to regenerate payslip PDF.',
            )
        try:
            payslip = payroll_run.payslip
        except Payslip.DoesNotExist as exc:
            raise PayslipGeneratorError('No payslip exists for this payroll run.') from exc

        breakdown = self.build_breakdown(payroll_run)
        pdf_content = render_payslip_pdf_bytes(
            payroll_run=payroll_run,
            payslip=payslip,
            breakdown=breakdown,
        )
        if not pdf_content:
            raise PayslipGeneratorError('Payslip PDF regeneration failed.')

        filename = f'payslip_{payroll_run.employee.employee_id}_{payroll_run.month}.pdf'
        payslip.pdf_file.save(filename, pdf_content, save=False)
        from apps.hr.payroll_models import Payslip as PayslipModel

        PayslipModel.objects.filter(pk=payslip.pk).update(pdf_file=payslip.pdf_file.name)
        payslip.refresh_from_db()
        return payslip

    def generate_payslip(self, payroll_run_id, *, generated_by=None) -> 'Payslip':
        """
        Generate payslip record + PDF for a payroll run.

        Locks the payroll run and creates an immutable Payslip.
        """
        from apps.hr.payroll_models import PayrollRun, Payslip

        payroll_run = self._get_payroll_run(payroll_run_id)
        self._validate_payroll_run(payroll_run)

        breakdown = self.build_breakdown(payroll_run)
        now = timezone.now()

        with transaction.atomic():
            payroll_run = PayrollRun.objects.select_for_update().get(pk=payroll_run.pk)
            self._validate_payroll_run(payroll_run)

            pdf_content = render_payslip_pdf_bytes(payroll_run=payroll_run, payslip=None, breakdown=breakdown)
            if not pdf_content:
                raise PayslipGeneratorError('Payslip PDF generation failed.')

            payslip = Payslip(
                payroll_run=payroll_run,
                employee=payroll_run.employee,
                month=payroll_run.month,
                earnings_breakdown=breakdown.earnings,
                deductions_breakdown=breakdown.deductions,
                gross_salary=breakdown.gross_salary,
                net_salary=breakdown.net_salary,
                generated_at=now,
            )
            filename = f'payslip_{payroll_run.employee.employee_id}_{payroll_run.month}.pdf'
            payslip.pdf_file.save(filename, pdf_content, save=False)
            payslip.save()

        return payslip

    def generate_for_month(self, month: str, *, generated_by=None) -> PayslipBatchResult:
        """Generate payslips for all publishable payroll runs in a month."""
        from apps.hr.payroll_models import PayrollRun

        result = PayslipBatchResult(month=month)
        runs = PayrollRun.objects.filter(month=month, status__in=self.PUBLISHABLE_STATUSES).select_related('employee')
        for payroll_run in runs:
            try:
                payslip = self.generate_payslip(payroll_run.id, generated_by=generated_by)
                result.created.append(payslip)
            except DuplicatePayslipError:
                result.skipped.append({
                    'payroll_run_id': str(payroll_run.id),
                    'employee_id': payroll_run.employee.employee_id,
                    'reason': 'duplicate',
                })
            except PayslipGeneratorError as exc:
                result.errors.append({
                    'payroll_run_id': str(payroll_run.id),
                    'employee_id': payroll_run.employee.employee_id,
                    'message': str(exc),
                })
        return result
