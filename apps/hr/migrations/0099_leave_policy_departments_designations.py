# Generated manually for leave policy assignment redesign

from django.db import migrations, models


def migrate_leave_policy_assignments(apps, schema_editor):
    LeavePolicy = apps.get_model('hr', 'LeavePolicy')
    Department = apps.get_model('hr', 'Department')

    for policy in LeavePolicy.objects.all().iterator():
        assignment = (policy.assignment_type or '').upper()

        if assignment == 'EMPLOYEE':
            policy.is_active = False
            policy.assignment_type = 'DEPARTMENT'
            policy.save(update_fields=['is_active', 'assignment_type'])
            continue

        if assignment == 'ALL':
            policy.assignment_type = 'DEPARTMENT'
            policy.save(update_fields=['assignment_type'])
            dept_ids = list(
                Department.objects.filter(hospital_id=policy.hospital_id).values_list('pk', flat=True)
            )
            if dept_ids:
                policy.departments.set(dept_ids)
            continue

        if assignment == 'DEPARTMENT':
            old_dept_id = getattr(policy, 'department_id', None)
            if old_dept_id:
                policy.departments.add(old_dept_id)
            continue

        # Unknown legacy value — treat as inactive department package
        policy.assignment_type = 'DEPARTMENT'
        policy.is_active = False
        policy.save(update_fields=['assignment_type', 'is_active'])


def noop_reverse(apps, schema_editor):
    pass


class Migration(migrations.Migration):

    dependencies = [
        ('hr', '0098_shift_early_punch_minutes'),
    ]

    operations = [
        migrations.AddField(
            model_name='leavepolicy',
            name='departments',
            field=models.ManyToManyField(
                blank=True,
                related_name='department_leave_policies',
                to='hr.department',
            ),
        ),
        migrations.AddField(
            model_name='leavepolicy',
            name='designations',
            field=models.ManyToManyField(
                blank=True,
                related_name='designation_leave_policies',
                to='hr.designation',
            ),
        ),
        migrations.AlterField(
            model_name='leavepolicy',
            name='assignment_type',
            field=models.CharField(
                choices=[
                    ('ALL', 'All Employees'),
                    ('DEPARTMENT', 'Department'),
                    ('EMPLOYEE', 'Specific Employee'),
                    ('DESIGNATION', 'Designations'),
                ],
                default='DEPARTMENT',
                max_length=20,
            ),
        ),
        migrations.RunPython(migrate_leave_policy_assignments, noop_reverse),
        migrations.RemoveField(
            model_name='leavepolicy',
            name='department',
        ),
        migrations.RemoveField(
            model_name='leavepolicy',
            name='employee',
        ),
        migrations.AlterField(
            model_name='leavepolicy',
            name='assignment_type',
            field=models.CharField(
                choices=[
                    ('DEPARTMENT', 'Departments'),
                    ('DESIGNATION', 'Designations'),
                ],
                default='DEPARTMENT',
                max_length=20,
            ),
        ),
    ]
