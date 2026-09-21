from django.db import migrations


def _legacy_department_base_name(department_text):
    text = (department_text or '').strip()
    if ' · ' in text:
        text = text.split(' · ', 1)[0].strip()
    return text


def backfill_employee_department_refs(apps, schema_editor):
    Employee = apps.get_model('hr', 'Employee')
    Department = apps.get_model('hr', 'Department')

    for employee in Employee.objects.filter(department_ref__isnull=True).exclude(department='').iterator():
        base_name = _legacy_department_base_name(employee.department)
        if not base_name:
            continue
        dept_qs = Department.objects.filter(name__iexact=base_name)
        if employee.hospital_id:
            dept_qs = dept_qs.filter(hospital_id=employee.hospital_id)
        department = dept_qs.first()
        if not department:
            continue
        employee.department_ref_id = department.id
        employee.department = department.name
        employee.save(update_fields=['department_ref', 'department', 'updated_at'])


class Migration(migrations.Migration):

    dependencies = [
        ('hr', '0084_designation_compliance_fields'),
    ]

    operations = [
        migrations.RunPython(backfill_employee_department_refs, migrations.RunPython.noop),
    ]
