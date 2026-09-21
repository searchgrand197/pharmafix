"""
Department salary structure templates and assignment helpers.
"""
from __future__ import annotations

import calendar
from datetime import date, timedelta
from typing import TYPE_CHECKING

from django.db import transaction
from django.db.models import Q

if TYPE_CHECKING:
    from apps.hr.models import Department, Employee
    from apps.hr.payroll_models import DepartmentSalaryStructure, SalaryStructure


class DepartmentSalaryStructureError(Exception):
    def __init__(self, message: str, *, code: str = 'department_structure_error'):
        super().__init__(message)
        self.code = code
        self.message = message


def month_bounds(day: date) -> tuple[date, date]:
    last = calendar.monthrange(day.year, day.month)[1]
    return date(day.year, day.month, 1), date(day.year, day.month, last)


def legacy_department_base_name(department_text: str | None) -> str:
    """Strip manual-hire suffixes like 'Nursing · Full Time' → 'Nursing'."""
    text = (department_text or '').strip()
    if ' · ' in text:
        text = text.split(' · ', 1)[0].strip()
    return text


def _department_lookup_qs(employee: 'Employee'):
    from apps.hr.models import Department

    qs = Department.objects.all()
    if employee.hospital_id:
        qs = qs.filter(Q(hospital_id=employee.hospital_id) | Q(hospital__isnull=True))
    return qs


def resolve_employee_department(employee: 'Employee') -> 'Department | None':
    from apps.hr.models import Department

    if employee.department_ref_id:
        return employee.department_ref

    department_text = legacy_department_base_name(employee.department)
    if not department_text:
        return None

    return _department_lookup_qs(employee).filter(name__iexact=department_text).first()


def employee_belongs_to_department(employee: 'Employee', department: 'Department') -> bool:
    if employee.department_ref_id == department.id:
        return True
    base = legacy_department_base_name(employee.department)
    return bool(base) and base.lower() == department.name.strip().lower()


def link_employee_department_ref(employee: 'Employee', department: 'Department') -> bool:
    """Persist canonical department_ref when legacy text already matches."""
    if employee.department_ref_id == department.id:
        return False
    employee.department_ref = department
    sync_employee_department_text(employee)
    employee.save(update_fields=['department_ref', 'department', 'updated_at'])
    return True


def backfill_department_refs_for_department(department: 'Department') -> int:
    """Link department_ref for active employees whose legacy department text matches."""
    from apps.hr.models import Employee

    name = department.name.strip()
    if not name:
        return 0

    qs = Employee.objects.filter(status='active', department_ref__isnull=True)
    if department.hospital_id:
        qs = qs.filter(hospital_id=department.hospital_id)

    updated = 0
    for employee in qs.only('id', 'department', 'department_ref_id', 'hospital_id'):
        if legacy_department_base_name(employee.department).lower() == name.lower():
            link_employee_department_ref(employee, department)
            updated += 1
    return updated


def apply_department_from_offer(employee: 'Employee', offer) -> bool:
    """Set department text and link department_ref from an offer snapshot."""
    dept_name = legacy_department_base_name(getattr(offer, 'department', None))
    if not dept_name:
        return False
    employee.department = dept_name
    hospital_id = employee.hospital_id
    if not hospital_id and getattr(offer, 'job_id', None):
        hospital_id = getattr(offer.job, 'hospital_id', None)
    if hospital_id and not employee.hospital_id:
        employee.hospital_id = hospital_id
    department = (
        _department_lookup_qs(employee).filter(name__iexact=dept_name).first()
        if hospital_id or employee.hospital_id
        else None
    )
    if department:
        employee.department_ref = department
        sync_employee_department_text(employee)
    return True


def ensure_employee_department_ref_linked(employee: 'Employee') -> bool:
    """Link department_ref when legacy department text matches a hospital department."""
    if employee.department_ref_id:
        return False
    department = resolve_employee_department(employee)
    if not department:
        return False
    return link_employee_department_ref(employee, department)


def sync_employee_department_text(employee: 'Employee') -> None:
    """Keep legacy department text in sync with department_ref."""
    if employee.department_ref_id:
        employee.department = employee.department_ref.name


def department_structures_active_for_month(department: 'Department', day: date):
    from apps.hr.payroll_models import DepartmentSalaryStructure

    month_start, month_end = month_bounds(day)
    return DepartmentSalaryStructure.objects.filter(
        department=department,
        effective_from__lte=month_end,
    ).filter(Q(effective_to__isnull=True) | Q(effective_to__gte=month_start)).exclude(
        is_active=False,
        effective_to__isnull=True,
    )


def get_active_department_structure(
    department: 'Department',
    *,
    as_of: date | None = None,
) -> 'DepartmentSalaryStructure | None':
    day = as_of or date.today()
    return (
        department_structures_active_for_month(department, day)
        .order_by('-effective_from', '-created_at')
        .first()
    )


def close_superseded_department_structures(department: 'Department', effective_from: date) -> int:
    from apps.hr.payroll_models import DepartmentSalaryStructure

    prior_day = effective_from - timedelta(days=1)
    updated = 0
    for structure in DepartmentSalaryStructure.objects.filter(department=department, is_active=True):
        structure.is_active = False
        if structure.effective_to is None or structure.effective_to >= effective_from:
            structure.effective_to = prior_day
        structure.save(update_fields=['is_active', 'effective_to', 'updated_at'])
        updated += 1
    return updated


def copy_department_structure_fields(source: 'DepartmentSalaryStructure') -> dict:
    from apps.hr.attendance_compliance import compliance_fields_dict

    return {
        'basic_salary': source.basic_salary,
        'hra': source.hra,
        'allowances': dict(source.allowances or {}),
        'deductions': dict(source.deductions or {}),
        'overtime_rate': source.overtime_rate,
        **compliance_fields_dict(source),
    }


def save_department_salary_structure(
    *,
    department: 'Department',
    effective_from: date,
    basic_salary,
    hra,
    allowances,
    deductions,
    overtime_rate,
    name: str = '',
    effective_to: date | None = None,
    notes: str = '',
    deactivate_previous: bool = True,
    compliance_fields: dict | None = None,
    designation=None,
) -> 'DepartmentSalaryStructure':
    from apps.hr.payroll_models import DepartmentSalaryStructure

    if DepartmentSalaryStructure.objects.filter(
        department=department,
        effective_from=effective_from,
    ).exists():
        raise DepartmentSalaryStructureError(
            f'A department structure with effective date {effective_from.isoformat()} already exists.',
            code='duplicate_effective_from',
        )

    with transaction.atomic():
        if deactivate_previous:
            close_superseded_department_structures(department, effective_from)

        return DepartmentSalaryStructure.objects.create(
            department=department,
            designation=designation,
            name=name.strip(),
            basic_salary=basic_salary,
            hra=hra,
            allowances=allowances or {},
            deductions=deductions or {},
            overtime_rate=overtime_rate,
            effective_from=effective_from,
            effective_to=effective_to,
            is_active=True,
            notes=notes,
            **(compliance_fields or {}),
        )


def employees_for_department(department: 'Department'):
    from apps.hr.models import Employee

    name = department.name.strip()
    q = Q(department_ref=department) | Q(department__iexact=name)
    # Manual hires store "Department · Full Time" in the legacy text field.
    q |= Q(department__istartswith=f'{name} · ')

    qs = Employee.objects.filter(q, status='active')
    if department.hospital_id:
        qs = qs.filter(hospital_id=department.hospital_id)
    return qs.distinct()


def employee_has_active_structure(employee: 'Employee', as_of: date | None = None) -> bool:
    from apps.hr.payroll_api.assignment_service import structures_active_for_month

    day = as_of or date.today()
    return structures_active_for_month(employee, day).exists()


def assign_department_structure_to_employee(
    *,
    employee: 'Employee',
    department_structure: 'DepartmentSalaryStructure',
    effective_from: date | None = None,
    notes: str = '',
    deactivate_previous: bool = True,
    skip_if_active: bool = False,
) -> tuple['SalaryStructure | None', str | None]:
    from apps.hr.payroll_api.assignment_service import (
        SalaryStructureAssignmentError,
        assign_salary_structure,
    )

    if skip_if_active and employee_has_active_structure(employee, effective_from or date.today()):
        return None, 'already_has_structure'

    if employee_belongs_to_department(employee, department_structure.department):
        link_employee_department_ref(employee, department_structure.department)

    copied = copy_department_structure_fields(department_structure)
    effective = effective_from or department_structure.effective_from

    note_parts = []
    if notes.strip():
        note_parts.append(notes.strip())
    note_parts.append(
        f'Assigned from department structure {department_structure.id} '
        f'({department_structure.department.name}).',
    )

    try:
        compliance_fields = {
            key: copied[key]
            for key in copied
            if key not in {'basic_salary', 'hra', 'allowances', 'deductions', 'overtime_rate'}
        }
        structure = assign_salary_structure(
            employee=employee,
            effective_from=effective,
            basic_salary=copied['basic_salary'],
            hra=copied['hra'],
            allowances=copied['allowances'],
            deductions=copied['deductions'],
            overtime_rate=copied['overtime_rate'],
            notes=' '.join(note_parts),
            source_structure=None,
            deactivate_previous=deactivate_previous,
            source_department_structure=department_structure,
            compliance_fields=compliance_fields,
        )
        return structure, None
    except SalaryStructureAssignmentError as exc:
        return None, exc.code


def bulk_assign_department_structure(
    *,
    department_structure: 'DepartmentSalaryStructure',
    effective_from: date | None = None,
    notes: str = '',
    skip_employees_with_structure: bool = True,
) -> dict:
    department = department_structure.department
    backfill_department_refs_for_department(department)

    employees = list(employees_for_department(department))
    assigned = []
    skipped = []
    errors = []

    for employee in employees:
        try:
            structure, skip_reason = assign_department_structure_to_employee(
                employee=employee,
                department_structure=department_structure,
                effective_from=effective_from,
                notes=notes,
                skip_if_active=skip_employees_with_structure,
            )
            if structure is None:
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
                    'structure_id': str(structure.id),
                })
        except Exception as exc:
            errors.append({
                'employee_id': str(employee.id),
                'employee_name': employee.name,
                'error': str(exc),
            })

    return {
        'department_id': str(department.id),
        'department_name': department.name,
        'eligible_count': len(employees),
        'assigned_count': len(assigned),
        'assigned': assigned,
        'skipped_count': len(skipped),
        'skipped': skipped,
        'errors': errors,
    }


def auto_assign_from_employee_department(
    employee: 'Employee',
    *,
    effective_from: date | None = None,
    notes: str = '',
) -> 'SalaryStructure | None':
    from apps.hr.payroll_api.compensation_level_service import auto_assign_default_compensation_level

    compensation_assignment = auto_assign_default_compensation_level(employee, effective_from=effective_from)
    if compensation_assignment is not None:
        return None

    department = resolve_employee_department(employee)
    if department is None:
        return None

    department_structure = get_active_department_structure(department, as_of=effective_from or date.today())
    if department_structure is None:
        return None

    structure, _reason = assign_department_structure_to_employee(
        employee=employee,
        department_structure=department_structure,
        effective_from=effective_from,
        notes=notes or 'Auto-assigned from department salary structure.',
        skip_if_active=True,
    )
    return structure
