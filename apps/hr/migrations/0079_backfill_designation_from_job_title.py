from django.db import migrations
import uuid


def backfill_designations_from_job_title(apps, schema_editor):
    Employee = apps.get_model('hr', 'Employee')
    Designation = apps.get_model('hr', 'Designation')

    for employee in Employee.objects.exclude(job_title__isnull=True).exclude(job_title='').iterator():
        title = (employee.job_title or '').strip()
        if not title:
            continue

        hospital_id = employee.hospital_id
        if not hospital_id and employee.department_ref_id:
            Department = apps.get_model('hr', 'Department')
            dept = Department.objects.filter(pk=employee.department_ref_id).first()
            hospital_id = getattr(dept, 'hospital_id', None) if dept else None
        if not hospital_id:
            continue

        designation = Designation.objects.filter(
            hospital_id=hospital_id,
            name__iexact=title,
        ).first()
        if designation is None:
            defaults = {'is_active': True}
            if employee.department_ref_id:
                defaults['department_id'] = employee.department_ref_id
            designation = Designation.objects.create(
                id=uuid.uuid4(),
                hospital_id=hospital_id,
                name=title,
                **defaults,
            )

        if employee.designation_id != designation.id:
            employee.designation_id = designation.id
            employee.save(update_fields=['designation_id', 'updated_at'])


def noop_reverse(apps, schema_editor):
    pass


class Migration(migrations.Migration):

    dependencies = [
        ('hr', '0078_hr_designation'),
    ]

    operations = [
        migrations.RunPython(backfill_designations_from_job_title, noop_reverse),
    ]
