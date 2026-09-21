"""
Attendance compliance policy resolution and payroll calculations.

Structure-level policies override global payroll settings when enabled.
Legacy late-penalty logic in PayrollCalculator.calculate_late_penalty() is preserved
when late_policy_enabled is False.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, datetime
from decimal import Decimal
from typing import TYPE_CHECKING, Any

from django.conf import settings
from django.utils import timezone

if TYPE_CHECKING:
    from apps.hr.models import Employee
    from apps.hr.payroll_models import CompensationLevel, DepartmentSalaryStructure, SalaryStructure

MONEY_QUANTIZE = Decimal('0.01')
DAY_QUANTIZE = Decimal('0.01')

LATE_PENALTY_PER_MINUTE = 'per_minute'
LATE_PENALTY_FIXED_PER_LATE_DAY = 'fixed_per_late_day'
LATE_PENALTY_PERCENTAGE_DAILY_SALARY = 'percentage_daily_salary'
LATE_PENALTY_TYPE_CHOICES = (
    (LATE_PENALTY_PER_MINUTE, 'Per minute'),
    (LATE_PENALTY_FIXED_PER_LATE_DAY, 'Fixed per late day'),
    (LATE_PENALTY_PERCENTAGE_DAILY_SALARY, 'Percentage of daily salary'),
)

OVERTIME_FIXED_PER_HOUR = 'fixed_per_hour'
OVERTIME_PERCENTAGE_HOURLY_RATE = 'percentage_hourly_rate'
OVERTIME_TYPE_CHOICES = (
    (OVERTIME_FIXED_PER_HOUR, 'Fixed per hour'),
    (OVERTIME_PERCENTAGE_HOURLY_RATE, 'Percentage of hourly rate'),
)

COMPLIANCE_FIELD_NAMES = (
    'late_policy_enabled',
    'grace_minutes',
    'late_penalty_threshold_minutes',
    'late_penalty_type',
    'late_penalty_value',
    'late_conversion_enabled',
    'late_count_for_half_day',
    'late_count_for_full_day',
    'warning_after_n_lates',
    'half_day_after_n_lates',
    'full_day_after_n_lates',
    'overtime_enabled',
    'overtime_type',
    'weekend_ot_multiplier',
    'holiday_ot_multiplier',
)


def extract_compliance_payload(data: dict) -> dict:
    return {name: data[name] for name in COMPLIANCE_FIELD_NAMES if name in data}


@dataclass
class CompliancePolicy:
    late_policy_enabled: bool = False
    grace_minutes: int | None = None
    late_penalty_threshold_minutes: int = 15
    late_penalty_type: str = LATE_PENALTY_PER_MINUTE
    late_penalty_value: Decimal = Decimal('0.00')
    late_conversion_enabled: bool = False
    late_count_for_half_day: int | None = None
    late_count_for_full_day: int | None = None
    warning_after_n_lates: int | None = None
    half_day_after_n_lates: int | None = None
    full_day_after_n_lates: int | None = None
    overtime_enabled: bool = True
    overtime_type: str = OVERTIME_FIXED_PER_HOUR
    overtime_rate: Decimal = Decimal('0.00')
    weekend_ot_multiplier: Decimal = Decimal('1.00')
    holiday_ot_multiplier: Decimal = Decimal('1.00')

    def as_dict(self) -> dict[str, Any]:
        return {
            'late_policy_enabled': self.late_policy_enabled,
            'grace_minutes': self.grace_minutes,
            'late_penalty_threshold_minutes': self.late_penalty_threshold_minutes,
            'late_penalty_type': self.late_penalty_type,
            'late_penalty_value': str(self.late_penalty_value),
            'late_conversion_enabled': self.late_conversion_enabled,
            'late_count_for_half_day': self.late_count_for_half_day,
            'late_count_for_full_day': self.late_count_for_full_day,
            'warning_after_n_lates': self.warning_after_n_lates,
            'half_day_after_n_lates': self.half_day_after_n_lates,
            'full_day_after_n_lates': self.full_day_after_n_lates,
            'overtime_enabled': self.overtime_enabled,
            'overtime_type': self.overtime_type,
            'overtime_rate': str(self.overtime_rate),
            'weekend_ot_multiplier': str(self.weekend_ot_multiplier),
            'holiday_ot_multiplier': str(self.holiday_ot_multiplier),
        }


@dataclass
class ComplianceCalculationResult:
    monthly_late_count: int = 0
    late_penalty: Decimal = Decimal('0.00')
    late_equivalent_leave_days: Decimal = Decimal('0.00')
    late_conversion_deduction: Decimal = Decimal('0.00')
    attendance_compliance_deduction: Decimal = Decimal('0.00')
    overtime_pay: Decimal = Decimal('0.00')
    overtime_hours: Decimal = Decimal('0.00')
    effective_ot_rate: Decimal = Decimal('0.00')
    warnings: list[str] = field(default_factory=list)
    policy: CompliancePolicy | None = None
    rates_used: dict[str, Any] = field(default_factory=dict)

    @property
    def total_compliance_deductions(self) -> Decimal:
        return (
            self.late_penalty
            + self.late_conversion_deduction
            + self.attendance_compliance_deduction
        ).quantize(MONEY_QUANTIZE)


def compliance_fields_dict(
    source: 'SalaryStructure | DepartmentSalaryStructure | CompensationLevel | None',
) -> dict:
    if source is None:
        return {}
    return {name: getattr(source, name) for name in COMPLIANCE_FIELD_NAMES}


def resolve_compliance_policy(
    structure: 'SalaryStructure | DepartmentSalaryStructure | None',
    employee: 'Employee | None' = None,
) -> CompliancePolicy:
    if structure is None:
        return CompliancePolicy()
    shift_grace = None
    if employee is not None and getattr(employee, 'shift_id', None):
        shift_grace = getattr(employee.shift, 'grace_minutes', None)
    grace = structure.grace_minutes if structure.grace_minutes is not None else shift_grace
    return CompliancePolicy(
        late_policy_enabled=bool(structure.late_policy_enabled),
        grace_minutes=grace,
        late_penalty_threshold_minutes=int(structure.late_penalty_threshold_minutes or 15),
        late_penalty_type=structure.late_penalty_type or LATE_PENALTY_PER_MINUTE,
        late_penalty_value=Decimal(str(structure.late_penalty_value or '0')),
        late_conversion_enabled=bool(structure.late_conversion_enabled),
        late_count_for_half_day=structure.late_count_for_half_day,
        late_count_for_full_day=structure.late_count_for_full_day,
        warning_after_n_lates=structure.warning_after_n_lates,
        half_day_after_n_lates=structure.half_day_after_n_lates,
        full_day_after_n_lates=structure.full_day_after_n_lates,
        overtime_enabled=bool(getattr(structure, 'overtime_enabled', True)),
        overtime_type=getattr(structure, 'overtime_type', None) or OVERTIME_FIXED_PER_HOUR,
        overtime_rate=Decimal(str(structure.overtime_rate or '0')),
        weekend_ot_multiplier=Decimal(str(structure.weekend_ot_multiplier or '1')),
        holiday_ot_multiplier=Decimal(str(structure.holiday_ot_multiplier or '1')),
    )


def _is_late_day(late_minutes: int, grace_minutes: int | None) -> bool:
    grace = int(grace_minutes or 0)
    return late_minutes > grace


def calculate_late_penalty_with_policy(
    *,
    policy: CompliancePolicy,
    late_day_metrics: list[dict],
    per_day_salary: Decimal,
    legacy_penalty: Decimal | None = None,
) -> tuple[Decimal, dict[str, Any]]:
    """Apply structure late policy when enabled; otherwise return legacy_penalty."""
    if not policy.late_policy_enabled:
        penalty = legacy_penalty if legacy_penalty is not None else Decimal('0.00')
        return penalty.quantize(MONEY_QUANTIZE), {
            'mode': 'legacy_global_settings',
            'threshold_minutes': int(getattr(settings, 'PAYROLL_LATE_PENALTY_THRESHOLD_MINUTES', 15)),
        }

    threshold = policy.late_penalty_threshold_minutes
    penalty = Decimal('0.00')
    billable_minutes = 0
    late_days_counted = 0

    for row in late_day_metrics:
        late_minutes = int(row.get('late_minutes') or 0)
        if not _is_late_day(late_minutes, policy.grace_minutes):
            continue
        late_days_counted += 1
        if policy.late_penalty_type == LATE_PENALTY_FIXED_PER_LATE_DAY:
            penalty += policy.late_penalty_value
        elif policy.late_penalty_type == LATE_PENALTY_PERCENTAGE_DAILY_SALARY:
            penalty += per_day_salary * (policy.late_penalty_value / Decimal('100'))
        else:
            if late_minutes <= threshold:
                continue
            minutes = late_minutes - threshold
            billable_minutes += minutes
            penalty += Decimal(minutes) * policy.late_penalty_value

    rates = {
        'mode': 'structure_policy',
        'late_penalty_type': policy.late_penalty_type,
        'threshold_minutes': threshold,
        'grace_minutes': policy.grace_minutes,
        'rate': str(policy.late_penalty_value),
        'billable_minutes': billable_minutes,
        'late_days_counted': late_days_counted,
    }
    return penalty.quantize(MONEY_QUANTIZE), rates


def calculate_late_equivalent_days(policy: CompliancePolicy, monthly_late_count: int) -> Decimal:
    if not policy.late_conversion_enabled or monthly_late_count <= 0:
        return Decimal('0.00')
    if policy.late_count_for_full_day and monthly_late_count >= policy.late_count_for_full_day:
        return Decimal('1.00')
    if policy.late_count_for_half_day and monthly_late_count >= policy.late_count_for_half_day:
        return Decimal('0.50')
    return Decimal('0.00')


def calculate_escalation(
    policy: CompliancePolicy,
    monthly_late_count: int,
    per_day_salary: Decimal,
) -> tuple[list[str], Decimal, Decimal]:
    """Return warnings, escalation equivalent days, and monetary deduction."""
    warnings: list[str] = []
    escalation_days = Decimal('0.00')

    if monthly_late_count <= 0:
        return warnings, escalation_days, Decimal('0.00')

    if policy.warning_after_n_lates and monthly_late_count >= policy.warning_after_n_lates:
        warnings.append(
            f'Late attendance warning: {monthly_late_count} late day(s) this month '
            f'(threshold: {policy.warning_after_n_lates}).',
        )

    if policy.full_day_after_n_lates and monthly_late_count >= policy.full_day_after_n_lates:
        escalation_days = Decimal('1.00')
        warnings.append(
            f'Escalation: {monthly_late_count} lates triggered a full-day attendance deduction.',
        )
    elif policy.half_day_after_n_lates and monthly_late_count >= policy.half_day_after_n_lates:
        escalation_days = Decimal('0.50')
        warnings.append(
            f'Escalation: {monthly_late_count} lates triggered a half-day attendance deduction.',
        )

    deduction = (escalation_days * per_day_salary).quantize(MONEY_QUANTIZE)
    return warnings, escalation_days, deduction


def _hourly_rate_from_gross(
    *,
    gross_monthly: Decimal,
    working_days: int,
    policy: CompliancePolicy,
) -> Decimal:
    if working_days <= 0:
        return Decimal('0.00')
    base_hourly = (gross_monthly / Decimal(working_days) / Decimal('8')).quantize(MONEY_QUANTIZE)
    if policy.overtime_type == OVERTIME_PERCENTAGE_HOURLY_RATE:
        return (base_hourly * (policy.overtime_rate / Decimal('100'))).quantize(MONEY_QUANTIZE)
    return policy.overtime_rate


def _day_ot_multiplier(
    day: date,
    *,
    policy: CompliancePolicy,
    holiday_dates: set[date],
    is_weekend_fn,
) -> Decimal:
    if day in holiday_dates:
        return policy.holiday_ot_multiplier
    if is_weekend_fn(day):
        return policy.weekend_ot_multiplier
    return Decimal('1.00')


def calculate_overtime_pay(
    *,
    policy: CompliancePolicy,
    ot_by_day: list[tuple[date, Decimal]],
    holiday_dates: set[date],
    is_weekend_fn,
    gross_monthly: Decimal,
    working_days: int,
    legacy_amount: Decimal | None = None,
) -> tuple[Decimal, Decimal, dict[str, Any]]:
    total_hours = sum((hours for _, hours in ot_by_day), Decimal('0.00')).quantize(DAY_QUANTIZE)
    if not policy.overtime_enabled:
        return Decimal('0.00'), total_hours, {'mode': 'disabled'}

    hourly_rate = _hourly_rate_from_gross(
        gross_monthly=gross_monthly,
        working_days=working_days,
        policy=policy,
    )

    use_multipliers = (
        policy.weekend_ot_multiplier != Decimal('1')
        or policy.holiday_ot_multiplier != Decimal('1')
        or any(day in holiday_dates or is_weekend_fn(day) for day, _ in ot_by_day)
    )

    if not use_multipliers and policy.overtime_type == OVERTIME_FIXED_PER_HOUR:
        amount = (total_hours * policy.overtime_rate).quantize(MONEY_QUANTIZE)
        return amount, total_hours, {
            'mode': 'fixed_per_hour',
            'hourly_rate': str(policy.overtime_rate),
            'total_hours': str(total_hours),
        }

    pay = Decimal('0.00')
    day_breakdown: list[dict] = []
    for day, hours in ot_by_day:
        if hours <= 0:
            continue
        multiplier = _day_ot_multiplier(
            day,
            policy=policy,
            holiday_dates=holiday_dates,
            is_weekend_fn=is_weekend_fn,
        )
        line = (hours * hourly_rate * multiplier).quantize(MONEY_QUANTIZE)
        pay += line
        day_breakdown.append({
            'date': day.isoformat(),
            'hours': str(hours),
            'multiplier': str(multiplier),
            'amount': str(line),
        })

    if pay == Decimal('0.00') and legacy_amount is not None:
        return legacy_amount, total_hours, {'mode': 'legacy_flat_rate', 'amount': str(legacy_amount)}

    return pay.quantize(MONEY_QUANTIZE), total_hours, {
        'mode': policy.overtime_type,
        'hourly_rate': str(hourly_rate),
        'total_hours': str(total_hours),
        'day_breakdown': day_breakdown,
    }


def build_compliance_audit(
    *,
    policy: CompliancePolicy,
    rates_used: dict[str, Any],
    calculated_at: datetime | None = None,
) -> dict[str, Any]:
    return {
        'policy_used': policy.as_dict(),
        'rates_used': rates_used,
        'calculation_timestamp': (calculated_at or timezone.now()).isoformat(),
    }


def build_portal_compliance_for_employee(employee, month: str, summary: dict | None = None) -> dict:
    from apps.hr.payroll_calculator import PayrollCalculator

    summary = summary or {}
    monthly_late_count = int(summary.get('late_days') or 0)
    ot_hours = Decimal(str(summary.get('overtime_hours') or summary.get('total_overtime_hours') or '0'))
    structure = PayrollCalculator(employee=employee, month=month).get_active_salary_structure()
    policy = resolve_compliance_policy(structure, employee)
    return portal_compliance_status(
        policy=policy,
        monthly_late_count=monthly_late_count,
        overtime_hours=ot_hours,
    )


def portal_compliance_status(
    *,
    policy: CompliancePolicy,
    monthly_late_count: int,
    overtime_hours: Decimal,
) -> dict[str, Any]:
    warnings, _, _ = calculate_escalation(policy, monthly_late_count, Decimal('0.00'))
    late_equiv = calculate_late_equivalent_days(policy, monthly_late_count)
    status = 'compliant'
    if monthly_late_count > 0:
        status = 'late_recorded'
    if warnings:
        status = 'warning'
    if late_equiv > 0:
        status = 'deduction_pending'

    return {
        'monthly_late_count': monthly_late_count,
        'late_warnings': warnings,
        'overtime_hours': str(overtime_hours),
        'late_equivalent_leave_days': str(late_equiv),
        'status': status,
        'policy_enabled': policy.late_policy_enabled or policy.late_conversion_enabled,
    }
