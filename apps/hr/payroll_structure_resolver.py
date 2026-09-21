"""
Resolve employee compensation from compensation-level assignments and overrides.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from decimal import Decimal
from typing import TYPE_CHECKING

from django.db.models import Q

if TYPE_CHECKING:
    from apps.hr.models import Employee
    from apps.hr.payroll_models import (
        CompensationLevel,
        DepartmentSalaryStructure,
        EmployeeCompensationAssignment,
        EmployeeCompensationOverride,
        SalaryStructure,
    )

MONEY_QUANTIZE = Decimal('0.01')


def parse_payroll_month(month: str) -> tuple[date, date]:
    import calendar

    year_str, month_str = month.split('-', 1)
    year, month_num = int(year_str), int(month_str)
    last_day = calendar.monthrange(year, month_num)[1]
    return date(year, month_num, 1), date(year, month_num, last_day)


def models_q_effective_to(month_start: date):
    return Q(effective_to__isnull=True) | Q(effective_to__gte=month_start)


@dataclass
class ResolvedCompensation:
    basic_salary: Decimal
    hra: Decimal
    allowances: dict
    deductions: dict
    overtime_rate: Decimal
    late_policy_enabled: bool
    late_penalty_type: str
    late_penalty_value: Decimal
    late_penalty_threshold_minutes: int
    grace_minutes: int | None
    late_conversion_enabled: bool
    late_count_for_half_day: int | None
    late_count_for_full_day: int | None
    warning_after_n_lates: int | None
    half_day_after_n_lates: int | None
    full_day_after_n_lates: int | None
    overtime_enabled: bool
    overtime_type: str
    weekend_ot_multiplier: Decimal
    holiday_ot_multiplier: Decimal
    source_compensation_assignment: 'EmployeeCompensationAssignment | None' = None
    source_compensation_level: 'CompensationLevel | None' = None
    source_compensation_override: 'EmployeeCompensationOverride | None' = None
    source_department_override: 'DepartmentSalaryStructure | None' = None
    legacy_structure: 'SalaryStructure | None' = None
    used_legacy_fallback: bool = False


class CompensationAdapter:
    """SalaryStructure-compatible view for PayrollCalculator."""

    def __init__(self, resolved: ResolvedCompensation):
        self._resolved = resolved
        self.basic_salary = resolved.basic_salary
        self.hra = resolved.hra
        self.allowances = resolved.allowances
        self.deductions = resolved.deductions
        self.overtime_rate = resolved.overtime_rate
        self.late_policy_enabled = resolved.late_policy_enabled
        self.late_penalty_type = resolved.late_penalty_type
        self.late_penalty_value = resolved.late_penalty_value
        self.late_penalty_threshold_minutes = resolved.late_penalty_threshold_minutes
        self.grace_minutes = resolved.grace_minutes
        self.late_conversion_enabled = resolved.late_conversion_enabled
        self.late_count_for_half_day = resolved.late_count_for_half_day
        self.late_count_for_full_day = resolved.late_count_for_full_day
        self.warning_after_n_lates = resolved.warning_after_n_lates
        self.half_day_after_n_lates = resolved.half_day_after_n_lates
        self.full_day_after_n_lates = resolved.full_day_after_n_lates
        self.overtime_enabled = resolved.overtime_enabled
        self.overtime_type = resolved.overtime_type
        self.weekend_ot_multiplier = resolved.weekend_ot_multiplier
        self.holiday_ot_multiplier = resolved.holiday_ot_multiplier


def _normalized_allowances(
    *,
    allowances: dict | None,
    medical,
    special_allowance,
) -> dict:
    merged = dict(allowances or {})
    if medical is not None:
        merged['medical'] = str(medical)
    if special_allowance is not None:
        merged['special_allowance'] = str(special_allowance)
    return merged


def _resolved_from_compensation_level(
    level: 'CompensationLevel',
    *,
    assignment: 'EmployeeCompensationAssignment | None' = None,
) -> ResolvedCompensation:
    from apps.hr.attendance_compliance import compliance_fields_dict

    compliance = compliance_fields_dict(level)
    return ResolvedCompensation(
        basic_salary=Decimal(str(level.basic)),
        hra=Decimal(str(level.hra)),
        allowances=_normalized_allowances(
            allowances=level.allowances,
            medical=level.medical or 0,
            special_allowance=level.special_allowance or 0,
        ),
        deductions=dict(level.deductions or {}),
        overtime_rate=Decimal(str(level.overtime_rate or 0)),
        late_policy_enabled=bool(compliance.get('late_policy_enabled', False)),
        late_penalty_type=compliance.get('late_penalty_type', 'per_minute'),
        late_penalty_value=Decimal(str(compliance.get('late_penalty_value') or 0)),
        late_penalty_threshold_minutes=int(compliance.get('late_penalty_threshold_minutes') or 15),
        grace_minutes=compliance.get('grace_minutes'),
        late_conversion_enabled=bool(compliance.get('late_conversion_enabled', False)),
        late_count_for_half_day=compliance.get('late_count_for_half_day'),
        late_count_for_full_day=compliance.get('late_count_for_full_day'),
        warning_after_n_lates=compliance.get('warning_after_n_lates'),
        half_day_after_n_lates=compliance.get('half_day_after_n_lates'),
        full_day_after_n_lates=compliance.get('full_day_after_n_lates'),
        overtime_enabled=bool(compliance.get('overtime_enabled', True)),
        overtime_type=compliance.get('overtime_type', 'fixed_per_hour'),
        weekend_ot_multiplier=Decimal(str(compliance.get('weekend_ot_multiplier') or '1.00')),
        holiday_ot_multiplier=Decimal(str(compliance.get('holiday_ot_multiplier') or '1.00')),
        source_compensation_assignment=assignment,
        source_compensation_level=level,
    )


def _resolved_from_department_override(
    override: 'DepartmentSalaryStructure',
) -> ResolvedCompensation:
    from apps.hr.attendance_compliance import compliance_fields_dict

    compliance = compliance_fields_dict(override)
    allowances = dict(override.allowances or {})
    return ResolvedCompensation(
        basic_salary=Decimal(str(override.basic_salary)),
        hra=Decimal(str(override.hra)),
        allowances=allowances,
        deductions=dict(override.deductions or {}),
        overtime_rate=Decimal(str(override.overtime_rate or 0)),
        late_policy_enabled=bool(compliance.get('late_policy_enabled', False)),
        late_penalty_type=compliance.get('late_penalty_type', 'per_minute'),
        late_penalty_value=Decimal(str(compliance.get('late_penalty_value') or 0)),
        late_penalty_threshold_minutes=int(compliance.get('late_penalty_threshold_minutes') or 15),
        grace_minutes=compliance.get('grace_minutes'),
        late_conversion_enabled=bool(compliance.get('late_conversion_enabled', False)),
        late_count_for_half_day=compliance.get('late_count_for_half_day'),
        late_count_for_full_day=compliance.get('late_count_for_full_day'),
        warning_after_n_lates=compliance.get('warning_after_n_lates'),
        half_day_after_n_lates=compliance.get('half_day_after_n_lates'),
        full_day_after_n_lates=compliance.get('full_day_after_n_lates'),
        overtime_enabled=bool(compliance.get('overtime_enabled', True)),
        overtime_type=compliance.get('overtime_type', 'fixed_per_hour'),
        weekend_ot_multiplier=Decimal(str(compliance.get('weekend_ot_multiplier') or '1.00')),
        holiday_ot_multiplier=Decimal(str(compliance.get('holiday_ot_multiplier') or '1.00')),
        source_department_override=override,
    )


def merge_compensation_override(
    base: ResolvedCompensation,
    override: 'EmployeeCompensationOverride | None',
) -> ResolvedCompensation:
    if override is None:
        return base

    merged_allowances = dict(base.allowances or {})
    if override.allowances is not None:
        merged_allowances.update(override.allowances or {})
    if override.medical is not None:
        merged_allowances['medical'] = str(override.medical)
    if override.special_allowance is not None:
        merged_allowances['special_allowance'] = str(override.special_allowance)

    merged_deductions = dict(base.deductions or {})
    if override.deductions is not None:
        merged_deductions.update(override.deductions or {})

    return ResolvedCompensation(
        basic_salary=Decimal(str(override.basic)) if override.basic is not None else base.basic_salary,
        hra=Decimal(str(override.hra)) if override.hra is not None else base.hra,
        allowances=merged_allowances,
        deductions=merged_deductions,
        overtime_rate=(
            Decimal(str(override.overtime_rate))
            if override.overtime_rate is not None
            else base.overtime_rate
        ),
        late_policy_enabled=base.late_policy_enabled,
        late_penalty_type=base.late_penalty_type,
        late_penalty_value=base.late_penalty_value,
        late_penalty_threshold_minutes=base.late_penalty_threshold_minutes,
        grace_minutes=base.grace_minutes,
        late_conversion_enabled=base.late_conversion_enabled,
        late_count_for_half_day=base.late_count_for_half_day,
        late_count_for_full_day=base.late_count_for_full_day,
        warning_after_n_lates=base.warning_after_n_lates,
        half_day_after_n_lates=base.half_day_after_n_lates,
        full_day_after_n_lates=base.full_day_after_n_lates,
        overtime_enabled=base.overtime_enabled,
        overtime_type=base.overtime_type,
        weekend_ot_multiplier=base.weekend_ot_multiplier,
        holiday_ot_multiplier=base.holiday_ot_multiplier,
        source_compensation_assignment=base.source_compensation_assignment,
        source_compensation_level=base.source_compensation_level,
        source_compensation_override=override,
        source_department_override=base.source_department_override,
        legacy_structure=base.legacy_structure,
        used_legacy_fallback=base.used_legacy_fallback,
    )


def merge_compensation(
    base: ResolvedCompensation,
    override: 'DepartmentSalaryStructure | None',
) -> ResolvedCompensation:
    if override is None:
        return base

    override_resolved = _resolved_from_department_override(override)
    merged_allowances = dict(base.allowances or {})
    merged_allowances.update(override_resolved.allowances or {})

    return ResolvedCompensation(
        basic_salary=override_resolved.basic_salary,
        hra=override_resolved.hra,
        allowances=merged_allowances,
        deductions=override_resolved.deductions or base.deductions,
        overtime_rate=override_resolved.overtime_rate,
        late_policy_enabled=override_resolved.late_policy_enabled,
        late_penalty_type=override_resolved.late_penalty_type,
        late_penalty_value=override_resolved.late_penalty_value,
        late_penalty_threshold_minutes=override_resolved.late_penalty_threshold_minutes,
        grace_minutes=override_resolved.grace_minutes,
        late_conversion_enabled=override_resolved.late_conversion_enabled,
        late_count_for_half_day=override_resolved.late_count_for_half_day,
        late_count_for_full_day=override_resolved.late_count_for_full_day,
        warning_after_n_lates=override_resolved.warning_after_n_lates,
        half_day_after_n_lates=override_resolved.half_day_after_n_lates,
        full_day_after_n_lates=override_resolved.full_day_after_n_lates,
        overtime_enabled=override_resolved.overtime_enabled,
        overtime_type=override_resolved.overtime_type,
        weekend_ot_multiplier=override_resolved.weekend_ot_multiplier,
        holiday_ot_multiplier=override_resolved.holiday_ot_multiplier,
        source_compensation_assignment=base.source_compensation_assignment,
        source_compensation_level=base.source_compensation_level,
        source_compensation_override=base.source_compensation_override,
        source_department_override=override,
        legacy_structure=base.legacy_structure,
        used_legacy_fallback=base.used_legacy_fallback,
    )


def get_active_department_override(employee: 'Employee', month: str) -> 'DepartmentSalaryStructure | None':
    from apps.hr.payroll_api.department_structure_service import (
        get_active_department_structure,
        resolve_employee_department,
    )

    department = resolve_employee_department(employee)
    if department is None:
        return None
    _, month_end = parse_payroll_month(month)
    return get_active_department_structure(department, as_of=month_end)


def resolve_compensation(employee: 'Employee', month: str) -> ResolvedCompensation | None:
    base: ResolvedCompensation | None = None

    comp_assignment = get_active_compensation_assignment(employee, month)
    if comp_assignment is not None:
        level = comp_assignment.compensation_level
        if level and level.is_active:
            base = _resolved_from_compensation_level(level, assignment=comp_assignment)

    if base is not None:
        dept_override = get_active_department_override(employee, month)
        base = merge_compensation(base, dept_override)
        override = get_active_compensation_override(employee, month)
        return merge_compensation_override(base, override)

    legacy = get_active_legacy_structure(employee, month)
    if legacy is not None:
        return _resolved_from_legacy(legacy)
    return None


def _resolved_from_legacy(structure: 'SalaryStructure') -> ResolvedCompensation:
    return ResolvedCompensation(
        basic_salary=Decimal(str(structure.basic_salary)),
        hra=Decimal(str(structure.hra)),
        allowances=dict(structure.allowances or {}),
        deductions=dict(structure.deductions or {}),
        overtime_rate=Decimal(str(structure.overtime_rate or 0)),
        late_policy_enabled=bool(structure.late_policy_enabled),
        late_penalty_type=structure.late_penalty_type,
        late_penalty_value=Decimal(str(structure.late_penalty_value or 0)),
        late_penalty_threshold_minutes=int(structure.late_penalty_threshold_minutes or 15),
        grace_minutes=structure.grace_minutes,
        late_conversion_enabled=bool(structure.late_conversion_enabled),
        late_count_for_half_day=structure.late_count_for_half_day,
        late_count_for_full_day=structure.late_count_for_full_day,
        warning_after_n_lates=structure.warning_after_n_lates,
        half_day_after_n_lates=structure.half_day_after_n_lates,
        full_day_after_n_lates=structure.full_day_after_n_lates,
        overtime_enabled=bool(structure.overtime_enabled),
        overtime_type=structure.overtime_type,
        weekend_ot_multiplier=Decimal(str(structure.weekend_ot_multiplier or '1.00')),
        holiday_ot_multiplier=Decimal(str(structure.holiday_ot_multiplier or '1.00')),
        legacy_structure=structure,
        used_legacy_fallback=True,
    )


def get_active_compensation_assignment(employee: 'Employee', month: str) -> 'EmployeeCompensationAssignment | None':
    from apps.hr.payroll_api.compensation_level_service import get_active_compensation_assignment as _get_active

    return _get_active(employee, month)


def get_active_compensation_override(employee: 'Employee', month: str) -> 'EmployeeCompensationOverride | None':
    from apps.hr.payroll_api.compensation_level_service import get_active_compensation_override as _get_active

    return _get_active(employee, month)


def get_active_legacy_structure(employee: 'Employee', month: str) -> 'SalaryStructure | None':
    from apps.hr.payroll_models import SalaryStructure

    month_start, month_end = parse_payroll_month(month)
    return (
        SalaryStructure.objects.filter(
            employee=employee,
            effective_from__lte=month_end,
        )
        .filter(models_q_effective_to(month_start))
        .exclude(is_active=False, effective_to__isnull=True)
        .order_by('-effective_from', '-created_at')
        .first()
    )


def compensation_adapter(employee: 'Employee', month: str) -> CompensationAdapter | None:
    resolved = resolve_compensation(employee, month)
    if resolved is None:
        return None
    return CompensationAdapter(resolved)


def materialize_legacy_structure(
    employee: 'Employee',
    resolved: ResolvedCompensation,
    effective_from: date,
) -> 'SalaryStructure':
    """Return employee SalaryStructure snapshot for payslip / PayrollRun FK compatibility."""
    from apps.hr.payroll_models import SalaryStructure

    if resolved.legacy_structure is not None:
        return resolved.legacy_structure

    existing = get_active_legacy_structure(employee, effective_from.strftime('%Y-%m'))
    if existing is not None and _resolved_matches_legacy_structure(resolved, existing):
        return existing

    compliance_fields = {
        'late_policy_enabled': resolved.late_policy_enabled,
        'late_penalty_type': resolved.late_penalty_type,
        'late_penalty_value': resolved.late_penalty_value,
        'late_penalty_threshold_minutes': resolved.late_penalty_threshold_minutes,
        'grace_minutes': resolved.grace_minutes,
        'late_conversion_enabled': resolved.late_conversion_enabled,
        'late_count_for_half_day': resolved.late_count_for_half_day,
        'late_count_for_full_day': resolved.late_count_for_full_day,
        'warning_after_n_lates': resolved.warning_after_n_lates,
        'half_day_after_n_lates': resolved.half_day_after_n_lates,
        'full_day_after_n_lates': resolved.full_day_after_n_lates,
        'overtime_enabled': resolved.overtime_enabled,
        'overtime_type': resolved.overtime_type,
        'weekend_ot_multiplier': resolved.weekend_ot_multiplier,
        'holiday_ot_multiplier': resolved.holiday_ot_multiplier,
    }

    notes = 'Materialized from compensation-level assignment.'
    if resolved.source_compensation_level is not None:
        notes = (
            f'Materialized from compensation level {resolved.source_compensation_level.id} '
            f'({resolved.source_compensation_level.code}).'
        )
    if resolved.source_compensation_override is not None:
        notes = f'{notes} Employee compensation override applied.'

    return SalaryStructure.objects.create(
        employee=employee,
        basic_salary=resolved.basic_salary,
        hra=resolved.hra,
        allowances=resolved.allowances,
        deductions=resolved.deductions,
        overtime_rate=resolved.overtime_rate,
        effective_from=effective_from,
        is_active=existing is None,
        notes=notes,
        **compliance_fields,
    )


def _resolved_matches_legacy_structure(resolved: ResolvedCompensation, structure: 'SalaryStructure') -> bool:
    from apps.hr.attendance_compliance import compliance_fields_dict

    if Decimal(str(structure.basic_salary)) != Decimal(str(resolved.basic_salary)):
        return False
    if Decimal(str(structure.hra)) != Decimal(str(resolved.hra)):
        return False
    if Decimal(str(structure.overtime_rate or 0)) != Decimal(str(resolved.overtime_rate or 0)):
        return False
    if dict(structure.allowances or {}) != dict(resolved.allowances or {}):
        return False
    if dict(structure.deductions or {}) != dict(resolved.deductions or {}):
        return False

    compliance = compliance_fields_dict(structure)
    return (
        bool(compliance.get('late_policy_enabled', False)) == bool(resolved.late_policy_enabled)
        and compliance.get('late_penalty_type', 'per_minute') == resolved.late_penalty_type
        and Decimal(str(compliance.get('late_penalty_value') or 0)) == Decimal(str(resolved.late_penalty_value))
        and int(compliance.get('late_penalty_threshold_minutes') or 15) == int(resolved.late_penalty_threshold_minutes)
        and compliance.get('grace_minutes') == resolved.grace_minutes
        and bool(compliance.get('late_conversion_enabled', False)) == bool(resolved.late_conversion_enabled)
        and compliance.get('late_count_for_half_day') == resolved.late_count_for_half_day
        and compliance.get('late_count_for_full_day') == resolved.late_count_for_full_day
        and compliance.get('warning_after_n_lates') == resolved.warning_after_n_lates
        and compliance.get('half_day_after_n_lates') == resolved.half_day_after_n_lates
        and compliance.get('full_day_after_n_lates') == resolved.full_day_after_n_lates
        and bool(compliance.get('overtime_enabled', True)) == bool(resolved.overtime_enabled)
        and compliance.get('overtime_type', 'fixed_per_hour') == resolved.overtime_type
        and Decimal(str(compliance.get('weekend_ot_multiplier') or '1.00')) == Decimal(str(resolved.weekend_ot_multiplier))
        and Decimal(str(compliance.get('holiday_ot_multiplier') or '1.00')) == Decimal(str(resolved.holiday_ot_multiplier))
    )
