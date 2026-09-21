"""
Compensation level templates, employee assignments, and override helpers.
"""
from __future__ import annotations

import calendar
from datetime import date, timedelta
from decimal import Decimal
from typing import TYPE_CHECKING

from django.db import transaction
from django.db.models import Q
from django.utils import timezone

if TYPE_CHECKING:
    from apps.hr.models import Designation, Employee
    from apps.hr.payroll_models import (
        CompensationLevel,
        EmployeeCompensationAssignment,
        EmployeeCompensationOverride,
    )


class CompensationLevelError(Exception):
    def __init__(self, message: str, *, code: str = 'compensation_level_error'):
        super().__init__(message)
        self.code = code
        self.message = message


class EmployeeCompensationAssignmentError(Exception):
    def __init__(self, message: str, *, code: str = 'compensation_assignment_error'):
        super().__init__(message)
        self.code = code
        self.message = message


class EmployeeCompensationOverrideError(Exception):
    def __init__(self, message: str, *, code: str = 'compensation_override_error'):
        super().__init__(message)
        self.code = code
        self.message = message


def month_bounds(day: date) -> tuple[date, date]:
    last = calendar.monthrange(day.year, day.month)[1]
    return date(day.year, day.month, 1), date(day.year, day.month, last)


def models_q_effective_to(month_start: date):
    return Q(effective_to__isnull=True) | Q(effective_to__gte=month_start)


def validate_designation_hospital(designation: 'Designation | None', hospital_id) -> None:
    if designation is not None and hospital_id and designation.hospital_id != hospital_id:
        raise CompensationLevelError(
            'Designation does not belong to this hospital.',
            code='designation_hospital_mismatch',
        )


def compensation_levels_active_for_month(
    *,
    hospital_id,
    as_of: date,
    designation: 'Designation | None' = None,
    code: str | None = None,
):
    from apps.hr.payroll_models import CompensationLevel

    month_start, month_end = month_bounds(as_of)
    qs = CompensationLevel.objects.filter(
        hospital_id=hospital_id,
        effective_from__lte=month_end,
    ).filter(models_q_effective_to(month_start)).exclude(
        is_active=False,
        effective_to__isnull=True,
    )
    if designation is not None:
        qs = qs.filter(designation=designation)
    if code:
        qs = qs.filter(code__iexact=code.strip())
    return qs


def get_default_compensation_level(
    designation: 'Designation',
    *,
    as_of: date | None = None,
) -> 'CompensationLevel | None':
    day = as_of or date.today()
    return (
        compensation_levels_active_for_month(
            hospital_id=designation.hospital_id,
            designation=designation,
            as_of=day,
        )
        .filter(is_default_for_designation=True)
        .order_by('rank', '-effective_from', '-created_at')
        .first()
    )


def close_superseded_compensation_levels(
    *,
    hospital_id,
    code: str,
    effective_from: date,
) -> int:
    from apps.hr.payroll_models import CompensationLevel

    prior_day = effective_from - timedelta(days=1)
    updated = 0
    for level in CompensationLevel.objects.filter(
        hospital_id=hospital_id,
        code__iexact=code.strip(),
        is_active=True,
    ):
        level.is_active = False
        if level.effective_to is None or level.effective_to >= effective_from:
            level.effective_to = prior_day
        level.save(update_fields=['is_active', 'effective_to', 'updated_at'])
        updated += 1
    return updated


def clear_other_default_levels(
    *,
    hospital_id,
    designation: 'Designation',
    keep_level_id,
) -> int:
    from apps.hr.payroll_models import CompensationLevel

    return CompensationLevel.objects.filter(
        hospital_id=hospital_id,
        designation=designation,
        is_active=True,
        is_default_for_designation=True,
    ).exclude(pk=keep_level_id).update(
        is_default_for_designation=False,
        updated_at=timezone.now(),
    )


def set_default_compensation_level(level: 'CompensationLevel') -> 'CompensationLevel':
    """Mark an existing level as the designation default without creating a new version."""
    if not level.is_active:
        raise CompensationLevelError(
            'Cannot set an inactive compensation level as default.',
            code='inactive_level',
        )
    if level.designation_id is None:
        raise CompensationLevelError(
            'Default compensation levels must be linked to a designation.',
            code='default_requires_designation',
        )

    with transaction.atomic():
        if not level.is_default_for_designation:
            level.is_default_for_designation = True
            level.save(update_fields=['is_default_for_designation', 'updated_at'])
        clear_other_default_levels(
            hospital_id=level.hospital_id,
            designation=level.designation,
            keep_level_id=level.id,
        )
        level.refresh_from_db()
        return level


def save_compensation_level(
    *,
    hospital,
    designation: 'Designation | None',
    code: str,
    name: str,
    rank: int,
    basic,
    hra,
    medical,
    special_allowance,
    allowances,
    deductions,
    overtime_rate,
    effective_from: date,
    effective_to: date | None = None,
    notes: str = '',
    is_default_for_designation: bool = False,
    deactivate_previous: bool = True,
    compliance_fields: dict | None = None,
) -> 'CompensationLevel':
    from apps.hr.payroll_models import CompensationLevel

    code_value = (code or '').strip().upper()
    if not code_value:
        raise CompensationLevelError('Level code is required.', code='missing_code')
    if effective_to and effective_to < effective_from:
        raise CompensationLevelError('End date cannot be before start date.', code='invalid_effective_to')
    if is_default_for_designation and designation is None:
        raise CompensationLevelError(
            'Default compensation levels must be linked to a designation.',
            code='default_requires_designation',
        )
    validate_designation_hospital(designation, hospital.id if hospital else None)

    if CompensationLevel.objects.filter(
        hospital=hospital,
        code__iexact=code_value,
        effective_from=effective_from,
    ).exists():
        raise CompensationLevelError(
            f'A compensation level with code "{code_value}" already exists for {effective_from.isoformat()}.',
            code='duplicate_effective_from',
        )

    with transaction.atomic():
        if deactivate_previous:
            close_superseded_compensation_levels(
                hospital_id=hospital.id if hospital else None,
                code=code_value,
                effective_from=effective_from,
            )

        level = CompensationLevel.objects.create(
            hospital=hospital,
            designation=designation,
            code=code_value,
            name=(name or '').strip() or code_value,
            rank=rank or 0,
            basic=basic,
            hra=hra or 0,
            medical=medical or 0,
            special_allowance=special_allowance or 0,
            allowances=allowances or {},
            deductions=deductions or {},
            overtime_rate=overtime_rate or 0,
            effective_from=effective_from,
            effective_to=effective_to,
            is_active=True,
            is_default_for_designation=bool(is_default_for_designation),
            notes=notes or '',
            **(compliance_fields or {}),
        )
        if level.is_default_for_designation and level.designation_id:
            clear_other_default_levels(
                hospital_id=level.hospital_id,
                designation=level.designation,
                keep_level_id=level.id,
            )
        return level


def copy_compensation_level_fields(source: 'CompensationLevel') -> dict:
    from apps.hr.attendance_compliance import compliance_fields_dict

    return {
        'basic': source.basic,
        'hra': source.hra,
        'medical': source.medical,
        'special_allowance': source.special_allowance,
        'allowances': dict(source.allowances or {}),
        'deductions': dict(source.deductions or {}),
        'overtime_rate': source.overtime_rate,
        **compliance_fields_dict(source),
    }


def compensation_assignments_active_for_month(employee: 'Employee', day: date):
    from apps.hr.payroll_models import EmployeeCompensationAssignment

    month_start, month_end = month_bounds(day)
    return (
        EmployeeCompensationAssignment.objects.filter(
            employee=employee,
            effective_from__lte=month_end,
        )
        .filter(models_q_effective_to(month_start))
        .exclude(is_active=False, effective_to__isnull=True)
        .select_related('compensation_level', 'compensation_level__designation')
    )


def overrides_active_for_month(employee: 'Employee', day: date):
    from apps.hr.payroll_models import EmployeeCompensationOverride

    month_start, month_end = month_bounds(day)
    return EmployeeCompensationOverride.objects.filter(
        employee=employee,
        effective_from__lte=month_end,
    ).filter(models_q_effective_to(month_start)).exclude(
        is_active=False,
        effective_to__isnull=True,
    )


def validate_employee_compensation_assignment(
    employee: 'Employee',
    level: 'CompensationLevel',
    effective_from: date,
) -> None:
    from apps.hr.payroll_models import EmployeeCompensationAssignment

    if employee.hospital_id and level.hospital_id and employee.hospital_id != level.hospital_id:
        raise EmployeeCompensationAssignmentError(
            'Compensation level is outside the employee hospital scope.',
            code='hospital_mismatch',
        )
    if level.designation_id and employee.designation_id != level.designation_id:
        raise EmployeeCompensationAssignmentError(
            'Compensation level designation does not match employee designation.',
            code='designation_mismatch',
        )
    if not level.is_active:
        raise EmployeeCompensationAssignmentError(
            'Compensation level is not active.',
            code='inactive_level',
        )
    if EmployeeCompensationAssignment.objects.filter(employee=employee, effective_from=effective_from).exists():
        raise EmployeeCompensationAssignmentError(
            f'An assignment with effective date {effective_from.isoformat()} already exists.',
            code='duplicate_effective_from',
        )
    active_count = compensation_assignments_active_for_month(employee, effective_from).count()
    if active_count > 1:
        raise EmployeeCompensationAssignmentError(
            'Multiple active compensation assignments cover this month.',
            code='multiple_active_for_month',
        )


def close_superseded_compensation_assignments(employee: 'Employee', effective_from: date) -> int:
    from apps.hr.payroll_models import EmployeeCompensationAssignment

    prior_day = effective_from - timedelta(days=1)
    updated = 0
    for assignment in EmployeeCompensationAssignment.objects.filter(employee=employee, is_active=True):
        assignment.is_active = False
        if assignment.effective_to is None or assignment.effective_to >= effective_from:
            assignment.effective_to = prior_day
        assignment.save(update_fields=['is_active', 'effective_to', 'updated_at'])
        updated += 1
    return updated


def assign_compensation_level_to_employee(
    *,
    employee: 'Employee',
    level: 'CompensationLevel',
    effective_from: date | None = None,
    deactivate_previous: bool = True,
    skip_if_active: bool = False,
    sync_legacy: bool = False,
) -> tuple['EmployeeCompensationAssignment | None', None, str | None]:
    from apps.hr.payroll_models import EmployeeCompensationAssignment

    effective = effective_from or level.effective_from
    if skip_if_active and compensation_assignments_active_for_month(employee, effective).exists():
        return None, None, 'already_has_assignment'

    validate_employee_compensation_assignment(employee, level, effective)

    with transaction.atomic():
        if deactivate_previous:
            close_superseded_compensation_assignments(employee, effective)

        assignment = EmployeeCompensationAssignment.objects.create(
            employee=employee,
            compensation_level=level,
            effective_from=effective,
            is_active=True,
        )

    return assignment, None, None


def bulk_assign_compensation_level(
    *,
    level: 'CompensationLevel',
    effective_from: date | None = None,
    skip_employees_with_assignment: bool = True,
) -> dict:
    from apps.hr.models import Employee

    qs = Employee.objects.filter(status='active', hospital_id=level.hospital_id)
    if level.designation_id:
        qs = qs.filter(designation_id=level.designation_id)

    assigned = []
    skipped = []
    errors = []

    for employee in qs.distinct():
        try:
            assignment, _legacy, skip_reason = assign_compensation_level_to_employee(
                employee=employee,
                level=level,
                effective_from=effective_from,
                skip_if_active=skip_employees_with_assignment,
            )
            if assignment is None:
                skipped.append({
                    'employee_id': str(employee.id),
                    'employee_name': employee.name,
                    'employee_code': employee.employee_id,
                    'reason': skip_reason or 'unknown',
                })
            else:
                assigned.append({
                    'employee_id': str(employee.id),
                    'employee_name': employee.name,
                    'employee_code': employee.employee_id,
                    'assignment_id': str(assignment.id),
                })
        except (EmployeeCompensationAssignmentError, Exception) as exc:
            errors.append({
                'employee_id': str(employee.id),
                'employee_name': employee.name,
                'error': str(exc),
                'code': getattr(exc, 'code', 'error'),
            })

    return {
        'compensation_level_id': str(level.id),
        'compensation_level_code': level.code,
        'compensation_level_name': level.name,
        'eligible_count': qs.count(),
        'assigned_count': len(assigned),
        'assigned': assigned,
        'skipped_count': len(skipped),
        'skipped': skipped,
        'errors': errors,
    }


def get_active_compensation_assignment(employee: 'Employee', month: str) -> 'EmployeeCompensationAssignment | None':
    year_str, month_str = month.split('-', 1)
    return (
        compensation_assignments_active_for_month(employee, date(int(year_str), int(month_str), 1))
        .order_by('-effective_from', '-created_at')
        .first()
    )


def get_active_compensation_override(employee: 'Employee', month: str) -> 'EmployeeCompensationOverride | None':
    year_str, month_str = month.split('-', 1)
    return (
        overrides_active_for_month(employee, date(int(year_str), int(month_str), 1))
        .order_by('-effective_from', '-created_at')
        .first()
    )


def validate_employee_compensation_override(employee: 'Employee', effective_from: date, *, payload: dict) -> None:
    from apps.hr.payroll_models import EmployeeCompensationOverride

    if EmployeeCompensationOverride.objects.filter(employee=employee, effective_from=effective_from).exists():
        raise EmployeeCompensationOverrideError(
            f'An override with effective date {effective_from.isoformat()} already exists.',
            code='duplicate_effective_from',
        )
    active_count = overrides_active_for_month(employee, effective_from).count()
    if active_count > 1:
        raise EmployeeCompensationOverrideError(
            'Multiple active compensation overrides cover this month.',
            code='multiple_active_for_month',
        )
    meaningful_keys = {
        'basic',
        'hra',
        'medical',
        'special_allowance',
        'allowances',
        'deductions',
        'overtime_rate',
    }
    if not any(payload.get(key) is not None for key in meaningful_keys):
        raise EmployeeCompensationOverrideError(
            'At least one override field is required.',
            code='empty_override',
        )


def close_superseded_compensation_overrides(employee: 'Employee', effective_from: date) -> int:
    from apps.hr.payroll_models import EmployeeCompensationOverride

    prior_day = effective_from - timedelta(days=1)
    updated = 0
    for override in EmployeeCompensationOverride.objects.filter(employee=employee, is_active=True):
        override.is_active = False
        if override.effective_to is None or override.effective_to >= effective_from:
            override.effective_to = prior_day
        override.save(update_fields=['is_active', 'effective_to', 'updated_at'])
        updated += 1
    return updated


def save_employee_compensation_override(
    *,
    employee: 'Employee',
    effective_from: date,
    effective_to: date | None = None,
    basic=None,
    hra=None,
    medical=None,
    special_allowance=None,
    allowances=None,
    deductions=None,
    overtime_rate=None,
    reason: str = '',
    approved_by=None,
    deactivate_previous: bool = True,
) -> 'EmployeeCompensationOverride':
    from apps.hr.payroll_models import EmployeeCompensationOverride

    if effective_to and effective_to < effective_from:
        raise EmployeeCompensationOverrideError(
            'End date cannot be before start date.',
            code='invalid_effective_to',
        )
    payload = {
        'basic': basic,
        'hra': hra,
        'medical': medical,
        'special_allowance': special_allowance,
        'allowances': allowances,
        'deductions': deductions,
        'overtime_rate': overtime_rate,
    }
    for key, value in payload.items():
        if key in {'allowances', 'deductions'} or value is None:
            continue
        if Decimal(str(value)) < Decimal('0.00'):
            raise EmployeeCompensationOverrideError(
                f'{key} cannot be negative.',
                code='negative_amount',
            )

    validate_employee_compensation_override(employee, effective_from, payload=payload)

    with transaction.atomic():
        if deactivate_previous:
            close_superseded_compensation_overrides(employee, effective_from)
        return EmployeeCompensationOverride.objects.create(
            employee=employee,
            basic=basic,
            hra=hra,
            medical=medical,
            special_allowance=special_allowance,
            allowances=allowances,
            deductions=deductions,
            overtime_rate=overtime_rate,
            reason=reason or '',
            approved_by=approved_by,
            effective_from=effective_from,
            effective_to=effective_to,
            is_active=True,
        )


def auto_assign_default_compensation_level(
    employee: 'Employee',
    *,
    effective_from: date | None = None,
) -> 'EmployeeCompensationAssignment | None':
    if not employee.designation_id:
        return None

    level = get_default_compensation_level(employee.designation, as_of=effective_from or date.today())
    if level is None:
        return None

    assignment, _legacy, _reason = assign_compensation_level_to_employee(
        employee=employee,
        level=level,
        effective_from=effective_from,
        skip_if_active=True,
    )
    return assignment


def ensure_employee_compensation_assigned(
    employee: 'Employee',
    *,
    effective_from: date | None = None,
) -> 'EmployeeCompensationAssignment | None':
    from apps.hr.payroll_structure_resolver import resolve_compensation

    day = effective_from or employee.joining_date_confirmed or employee.joining_date or date.today()
    month = day.strftime('%Y-%m')
    resolved = resolve_compensation(employee, month)
    if resolved is not None and resolved.source_compensation_assignment is not None:
        return resolved.source_compensation_assignment

    assignment = auto_assign_default_compensation_level(employee, effective_from=day)
    if assignment is not None:
        return assignment
    return None


def assign_employee_compensation_level_by_id(
    *,
    employee: 'Employee',
    compensation_level_id,
    effective_from: date | None = None,
) -> 'EmployeeCompensationAssignment | None':
    from apps.hr.payroll_models import CompensationLevel

    if not compensation_level_id:
        return None
    level = CompensationLevel.objects.filter(pk=compensation_level_id, is_active=True).first()
    if level is None:
        raise EmployeeCompensationAssignmentError(
            'Compensation level not found.',
            code='level_not_found',
        )
    effective = effective_from or employee.joining_date_confirmed or employee.joining_date or date.today()
    assignment, _legacy, skip_reason = assign_compensation_level_to_employee(
        employee=employee,
        level=level,
        effective_from=effective,
        skip_if_active=False,
    )
    if assignment is None:
        raise EmployeeCompensationAssignmentError(
            skip_reason or 'Could not assign compensation level.',
            code='assignment_skipped',
        )
    return assignment


def assign_employee_compensation_or_default(
    *,
    employee: 'Employee',
    compensation_level_id=None,
    effective_from: date | None = None,
) -> 'EmployeeCompensationAssignment | None':
    if compensation_level_id:
        return assign_employee_compensation_level_by_id(
            employee=employee,
            compensation_level_id=compensation_level_id,
            effective_from=effective_from,
        )
    return ensure_employee_compensation_assigned(employee, effective_from=effective_from)


def compensation_assignment_history(employee: 'Employee'):
    from apps.hr.payroll_models import EmployeeCompensationAssignment

    return (
        EmployeeCompensationAssignment.objects.filter(employee=employee)
        .select_related('compensation_level', 'compensation_level__designation')
        .order_by('-effective_from', '-created_at')
    )


def compensation_override_history(employee: 'Employee'):
    from apps.hr.payroll_models import EmployeeCompensationOverride

    return EmployeeCompensationOverride.objects.filter(employee=employee).order_by('-effective_from', '-created_at')
