"""
Salary structure assignment — API-layer validation and history tracking.

Does not modify PayrollCalculator or payroll computation logic.
"""
from __future__ import annotations

import calendar
from datetime import date, timedelta
from typing import TYPE_CHECKING

from django.db import transaction
from django.db.models import Q

if TYPE_CHECKING:
    from apps.hr.models import Employee
    from apps.hr.payroll_models import SalaryStructure


class SalaryStructureAssignmentError(Exception):
    def __init__(self, message: str, *, code: str = 'assignment_error'):
        super().__init__(message)
        self.code = code
        self.message = message


def month_bounds(day: date) -> tuple[date, date]:
    last = calendar.monthrange(day.year, day.month)[1]
    return date(day.year, day.month, 1), date(day.year, day.month, last)


def structures_active_for_month(employee: 'Employee', day: date):
    from apps.hr.payroll_models import SalaryStructure

    month_start, month_end = month_bounds(day)
    return SalaryStructure.objects.filter(
        employee=employee,
        effective_from__lte=month_end,
    ).filter(Q(effective_to__isnull=True) | Q(effective_to__gte=month_start)).exclude(
        is_active=False,
        effective_to__isnull=True,
    )


def structure_fingerprint(
    *,
    basic_salary,
    hra,
    allowances,
    deductions,
    overtime_rate,
) -> tuple:
    return (
        str(basic_salary),
        str(hra),
        tuple(sorted((allowances or {}).items())),
        tuple(sorted((deductions or {}).items())),
        str(overtime_rate),
    )


def validate_assignment(
    employee: 'Employee',
    effective_from: date,
    *,
    basic_salary,
    hra,
    allowances,
    deductions,
    overtime_rate,
) -> None:
    from apps.hr.payroll_models import SalaryStructure

    if SalaryStructure.objects.filter(employee=employee, effective_from=effective_from).exists():
        raise SalaryStructureAssignmentError(
            f'A salary structure with effective date {effective_from.isoformat()} already exists for this employee.',
            code='duplicate_effective_from',
        )

    fingerprint = structure_fingerprint(
        basic_salary=basic_salary,
        hra=hra,
        allowances=allowances,
        deductions=deductions,
        overtime_rate=overtime_rate,
    )

    for existing in structures_active_for_month(employee, effective_from):
        existing_fp = structure_fingerprint(
            basic_salary=existing.basic_salary,
            hra=existing.hra,
            allowances=existing.allowances,
            deductions=existing.deductions,
            overtime_rate=existing.overtime_rate,
        )
        if existing_fp == fingerprint:
            month_label = effective_from.strftime('%Y-%m')
            raise SalaryStructureAssignmentError(
                f'An identical active salary structure already covers {month_label} for this employee.',
                code='duplicate_month_assignment',
            )

    active_count = structures_active_for_month(employee, effective_from).count()
    if active_count > 1:
        raise SalaryStructureAssignmentError(
            'Multiple active structures cover this month. Resolve conflicts before assigning.',
            code='multiple_active_for_month',
        )


def close_superseded_structures(employee: 'Employee', effective_from: date) -> int:
    """Deactivate prior structures and set effective_to for history tracking."""
    from apps.hr.payroll_models import SalaryStructure

    prior_day = effective_from - timedelta(days=1)
    updated = 0
    for structure in SalaryStructure.objects.filter(employee=employee, is_active=True):
        structure.is_active = False
        if structure.effective_to is None or structure.effective_to >= effective_from:
            structure.effective_to = prior_day
        structure.save(update_fields=['is_active', 'effective_to', 'updated_at'])
        updated += 1
    return updated


def copy_structure_fields(source: 'SalaryStructure') -> dict:
    from apps.hr.attendance_compliance import compliance_fields_dict

    return {
        'basic_salary': source.basic_salary,
        'hra': source.hra,
        'allowances': dict(source.allowances or {}),
        'deductions': dict(source.deductions or {}),
        'overtime_rate': source.overtime_rate,
        **compliance_fields_dict(source),
    }


def assign_salary_structure(
    *,
    employee: 'Employee',
    effective_from: date,
    basic_salary,
    hra,
    allowances,
    deductions,
    overtime_rate,
    effective_to: date | None = None,
    notes: str = '',
    source_structure: 'SalaryStructure | None' = None,
    source_department_structure=None,
    deactivate_previous: bool = True,
    compliance_fields: dict | None = None,
) -> 'SalaryStructure':
    from apps.hr.payroll_models import SalaryStructure

    validate_assignment(
        employee,
        effective_from,
        basic_salary=basic_salary,
        hra=hra,
        allowances=allowances,
        deductions=deductions,
        overtime_rate=overtime_rate,
    )

    note_parts = [notes.strip()] if notes and notes.strip() else []
    if source_structure is not None:
        note_parts.append(f'Copied from structure {source_structure.id}.')
    if source_department_structure is not None:
        note_parts.append(f'Copied from department structure {source_department_structure.id}.')
    merged_notes = ' '.join(note_parts)

    with transaction.atomic():
        if deactivate_previous:
            close_superseded_structures(employee, effective_from)

        return SalaryStructure.objects.create(
            employee=employee,
            source_department_structure=source_department_structure,
            basic_salary=basic_salary,
            hra=hra,
            allowances=allowances or {},
            deductions=deductions or {},
            overtime_rate=overtime_rate,
            effective_from=effective_from,
            effective_to=effective_to,
            is_active=True,
            notes=merged_notes,
            **(compliance_fields or {}),
        )


def assignment_history(employee: 'Employee'):
    from apps.hr.payroll_models import SalaryStructure

    return (
        SalaryStructure.objects.filter(employee=employee)
        .select_related('employee')
        .order_by('-effective_from', '-created_at')
    )
