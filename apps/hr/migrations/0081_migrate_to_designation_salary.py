"""Backfill designation salary templates and employee assignments from legacy structures."""

from decimal import Decimal

from django.db import migrations


def _allowances_split(allowances: dict | None) -> tuple[Decimal, Decimal]:
    data = allowances or {}
    medical = Decimal(str(data.get('medical', 0) or 0))
    special = Decimal(str(data.get('special_allowance', 0) or 0))
    return medical, special


def migrate_to_designation_salary(apps, schema_editor):
    DepartmentSalaryStructure = apps.get_model('hr', 'DepartmentSalaryStructure')
    DesignationSalaryStructure = apps.get_model('hr', 'DesignationSalaryStructure')
    EmployeeSalaryAssignment = apps.get_model('hr', 'EmployeeSalaryAssignment')
    SalaryStructure = apps.get_model('hr', 'SalaryStructure')
    Employee = apps.get_model('hr', 'Employee')

    template_by_designation: dict[tuple, object] = {}

    for dept_struct in (
        DepartmentSalaryStructure.objects.filter(is_active=True, designation_id__isnull=False)
        .select_related('designation')
        .order_by('designation_id', '-effective_from')
    ):
        designation = dept_struct.designation
        if designation is None:
            continue
        key = (str(designation.hospital_id), str(designation.id))
        if key in template_by_designation:
            continue

        medical, special = _allowances_split(dept_struct.allowances)
        late_penalty = Decimal('0.00')
        if getattr(dept_struct, 'late_policy_enabled', False):
            late_penalty = Decimal(str(dept_struct.late_penalty_value or 0))

        name = (dept_struct.name or f'{designation.name} template').strip() or f'{designation.name} template'
        template = DesignationSalaryStructure.objects.create(
            hospital_id=designation.hospital_id,
            name=name,
            designation_id=designation.id,
            basic=dept_struct.basic_salary,
            hra=dept_struct.hra,
            medical=medical,
            special_allowance=special,
            overtime_rate_per_hour=dept_struct.overtime_rate,
            late_penalty_per_minute=late_penalty,
            effective_from=dept_struct.effective_from,
            effective_to=dept_struct.effective_to,
            is_active=True,
        )
        template_by_designation[key] = template

    def template_for_employee(employee, emp_structure):
        if not employee.designation_id:
            return None
        key = (str(employee.hospital_id), str(employee.designation_id))
        if key in template_by_designation:
            return template_by_designation[key]

        medical, special = _allowances_split(emp_structure.allowances)
        late_penalty = Decimal('0.00')
        if getattr(emp_structure, 'late_policy_enabled', False):
            late_penalty = Decimal(str(emp_structure.late_penalty_value or 0))

        designation = employee.designation
        name = f'{designation.name} template'
        template = DesignationSalaryStructure.objects.create(
            hospital_id=employee.hospital_id,
            name=name,
            designation_id=employee.designation_id,
            basic=emp_structure.basic_salary,
            hra=emp_structure.hra,
            medical=medical,
            special_allowance=special,
            overtime_rate_per_hour=emp_structure.overtime_rate,
            late_penalty_per_minute=late_penalty,
            effective_from=emp_structure.effective_from,
            effective_to=emp_structure.effective_to,
            is_active=True,
        )
        template_by_designation[key] = template
        return template

    for emp_structure in (
        SalaryStructure.objects.filter(is_active=True)
        .select_related('employee', 'employee__designation')
        .order_by('employee_id', '-effective_from')
    ):
        employee = emp_structure.employee
        if not employee.designation_id:
            continue
        if EmployeeSalaryAssignment.objects.filter(
            employee_id=employee.id,
            is_active=True,
        ).exists():
            continue

        template = template_for_employee(employee, emp_structure)
        if template is None:
            continue

        EmployeeSalaryAssignment.objects.create(
            employee_id=employee.id,
            salary_structure_id=template.id,
            effective_from=emp_structure.effective_from,
            effective_to=emp_structure.effective_to,
            is_active=True,
        )


def reverse_migrate(apps, schema_editor):
    pass


class Migration(migrations.Migration):

    dependencies = [
        ('hr', '0080_designation_salary_structures'),
    ]

    operations = [
        migrations.RunPython(migrate_to_designation_salary, reverse_migrate),
    ]
