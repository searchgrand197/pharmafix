"""
Payroll reconciliation — load frozen inputs, validate, calculate, persist snapshots.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import TYPE_CHECKING

from django.db import transaction

from apps.hr.attendance_finalization_service import (
    is_attendance_month_finalized,
    parse_month,
)
from apps.hr.payroll_calculator import (
    PayrollCalculator,
    PayrollCalculatorError,
    parse_payroll_month,
)
from apps.hr.payroll_structure_resolver import (
    ResolvedCompensation,
    materialize_legacy_structure,
    resolve_compensation,
)

if TYPE_CHECKING:
    from apps.hr.models import AttendanceMonthFinalization, DailyAttendance, Employee, LeaveRequest
    from apps.hr.payroll_calculator import PayrollCalculationResult
    from apps.hr.payroll_models import OrganizationHoliday, PayrollRun


@dataclass
class PayrollInputValidationResult:
    errors: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)

    @property
    def ok(self) -> bool:
        return not self.errors


@dataclass
class PayrollInputBundle:
    employee: 'Employee'
    month: str
    salary: ResolvedCompensation
    attendance_rows: list['DailyAttendance']
    leave_requests: list['LeaveRequest']
    holidays: list
    attendance_month_finalized: 'AttendanceMonthFinalization'


@dataclass
class PayrollReconciliationResult:
    calculation: 'PayrollCalculationResult'
    input_snapshots: dict
    warnings: list[str] = field(default_factory=list)
    salary: ResolvedCompensation | None = None


def _attendance_row_snapshot(row: 'DailyAttendance') -> dict:
    return {
        'id': str(row.id),
        'date': row.date.isoformat(),
        'attendance_status': row.attendance_status,
        'late_minutes': row.late_minutes,
        'overtime_hours': str(row.overtime_hours or '0'),
        'total_work_hours': str(row.total_work_hours or '0'),
        'is_on_leave': row.is_on_leave,
        'finalized': row.finalized,
    }


def _leave_snapshot(leave: 'LeaveRequest') -> dict:
    leave_type = leave.leave_type
    return {
        'id': str(leave.id),
        'start_date': leave.start_date.isoformat(),
        'end_date': leave.end_date.isoformat(),
        'leave_type': leave_type.name if leave_type else None,
        'paid': bool(getattr(leave_type, 'is_paid', True)) if leave_type else True,
    }


def _holiday_snapshot(holiday) -> dict:
    return {
        'id': str(holiday.id),
        'date': holiday.date.isoformat(),
        'name': getattr(holiday, 'name', '') or getattr(holiday, 'title', ''),
    }


def _salary_snapshot(resolved: ResolvedCompensation) -> dict:
    return {
        'compensation_level_id': (
            str(resolved.source_compensation_level.id) if resolved.source_compensation_level else None
        ),
        'compensation_assignment_id': (
            str(resolved.source_compensation_assignment.id)
            if resolved.source_compensation_assignment
            else None
        ),
        'compensation_override_id': (
            str(resolved.source_compensation_override.id)
            if resolved.source_compensation_override
            else None
        ),
        'department_override_id': (
            str(resolved.source_department_override.id) if resolved.source_department_override else None
        ),
        'used_legacy_fallback': resolved.used_legacy_fallback,
        'merged_compensation': {
            'basic_salary': str(resolved.basic_salary),
            'hra': str(resolved.hra),
            'allowances': resolved.allowances or {},
            'deductions': resolved.deductions or {},
            'overtime_rate': str(resolved.overtime_rate),
        },
    }


class PayrollReconciliationEngine:
    def load_inputs(self, employee: 'Employee', month: str) -> PayrollInputBundle:
        from apps.hr.models import AttendanceMonthFinalization, DailyAttendance, LeaveRequest
        from apps.hr.holiday_services import holidays_in_range_for_employee

        if not is_attendance_month_finalized(employee.hospital, month):
            raise PayrollCalculatorError(
                f'Attendance month {month} is not finalized for payroll.',
            )

        month_finalization = AttendanceMonthFinalization.objects.get(
            hospital_id=employee.hospital_id,
            month=month,
        )
        resolved = resolve_compensation(employee, month)
        if resolved is None:
            raise PayrollCalculatorError(
                f'No active salary structure for employee {employee.employee_id} in {month}.',
            )

        period_start, period_end = parse_payroll_month(month)
        join = employee.joining_date_confirmed or employee.joining_date
        if join and join > period_start:
            period_start = join

        attendance_rows = list(
            DailyAttendance.objects.filter(
                employee=employee,
                date__gte=period_start,
                date__lte=period_end,
                finalized=True,
            ).order_by('date'),
        )
        leave_requests = list(
            LeaveRequest.objects.filter(
                employee=employee,
                status=LeaveRequest.STATUS_APPROVED,
                start_date__lte=period_end,
                end_date__gte=period_start,
            ).select_related('leave_type'),
        )
        holidays = list(holidays_in_range_for_employee(employee, period_start, period_end))

        return PayrollInputBundle(
            employee=employee,
            month=month,
            salary=resolved,
            attendance_rows=attendance_rows,
            leave_requests=leave_requests,
            holidays=holidays,
            attendance_month_finalized=month_finalization,
        )

    def validate_inputs(self, bundle: PayrollInputBundle) -> PayrollInputValidationResult:
        result = PayrollInputValidationResult()
        if bundle.salary is None:
            result.errors.append('missing_salary_structure')
        if (
            bundle.salary is not None
            and bundle.employee.designation_id
            and not bundle.salary.source_compensation_assignment
            and not bundle.salary.used_legacy_fallback
        ):
            result.errors.append('missing_compensation_assignment')
        if not bundle.attendance_rows:
            result.warnings.append('no_finalized_attendance_rows')
        return result

    def reconcile(self, bundle: PayrollInputBundle) -> PayrollReconciliationResult:
        validation = self.validate_inputs(bundle)
        if not validation.ok:
            raise PayrollCalculatorError('; '.join(validation.errors))

        calculator = PayrollCalculator(
            employee=bundle.employee,
            month=bundle.month,
            salary_structure=None,
            require_finalized_attendance=True,
        )
        calculation = calculator.calculate()
        warnings = list(calculation.warnings) + list(validation.warnings)
        if bundle.salary.used_legacy_fallback:
            warnings.append('Legacy salary structure fallback used.')

        input_snapshots = {
            'attendance_month_finalization_id': str(bundle.attendance_month_finalized.id),
            'attendance_rows': [_attendance_row_snapshot(row) for row in bundle.attendance_rows],
            'leave_requests': [_leave_snapshot(item) for item in bundle.leave_requests],
            'holidays': [_holiday_snapshot(item) for item in bundle.holidays],
            'salary': _salary_snapshot(bundle.salary),
        }
        return PayrollReconciliationResult(
            calculation=calculation,
            input_snapshots=input_snapshots,
            warnings=warnings,
            salary=bundle.salary,
        )

    @transaction.atomic
    def persist_run(
        self,
        bundle: PayrollInputBundle,
        reconciliation: PayrollReconciliationResult,
        *,
        calculated_by=None,
        existing_run: 'PayrollRun | None' = None,
    ) -> 'PayrollRun':
        from apps.hr.payroll_models import PayrollRun
        from django.utils import timezone

        calculator = PayrollCalculator(
            employee=bundle.employee,
            month=bundle.month,
            require_finalized_attendance=True,
        )
        month_start, _ = parse_payroll_month(bundle.month)
        structure = materialize_legacy_structure(bundle.employee, bundle.salary, month_start)
        adapter = calculator.get_active_salary_structure()
        attendance = reconciliation.calculation.attendance_summary
        snapshot = calculator.build_calculation_snapshot(reconciliation.calculation, adapter or structure)
        snapshot['input_snapshots'] = reconciliation.input_snapshots
        snapshot['warnings'] = list(snapshot.get('warnings') or []) + reconciliation.warnings

        if existing_run is not None:
            payroll_run = existing_run
        else:
            payroll_run = PayrollRun(
                employee=bundle.employee,
                month=bundle.month,
            )

        payroll_run.salary_structure = structure
        payroll_run.employee_compensation_assignment = bundle.salary.source_compensation_assignment
        payroll_run.total_present_days = attendance.present_days
        payroll_run.total_absent_days = attendance.absent_days
        payroll_run.total_leave_days = attendance.leave_days
        payroll_run.overtime_hours = attendance.overtime_hours
        payroll_run.gross_salary = reconciliation.calculation.gross_salary
        payroll_run.total_deductions = reconciliation.calculation.total_deductions
        payroll_run.final_salary = reconciliation.calculation.final_salary
        payroll_run.status = PayrollRun.STATUS_CALCULATED
        payroll_run.calculation_snapshot = snapshot
        payroll_run.calculated_by = calculated_by
        payroll_run.save()
        return payroll_run


def employee_payroll_blocked_reason(employee: 'Employee', month: str) -> str | None:
    if not is_attendance_month_finalized(employee.hospital, month):
        return 'attendance_not_finalized'
    resolved = resolve_compensation(employee, month)
    if resolved is None:
        if employee.designation_id:
            return 'missing_compensation_assignment'
        return 'missing_salary_structure'
    if (
        employee.designation_id
        and not resolved.source_compensation_assignment
        and not resolved.used_legacy_fallback
    ):
        return 'missing_compensation_assignment'
    return None
