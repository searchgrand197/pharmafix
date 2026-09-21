from django.db import migrations


class Migration(migrations.Migration):

    dependencies = [
        ('hr', '0095_compensation_assignment_cutover'),
    ]

    operations = [
        migrations.RemoveField(
            model_name='payrollrun',
            name='employee_salary_assignment',
        ),
        migrations.DeleteModel(
            name='EmployeeSalaryAssignment',
        ),
        migrations.DeleteModel(
            name='DesignationSalaryStructure',
        ),
    ]
