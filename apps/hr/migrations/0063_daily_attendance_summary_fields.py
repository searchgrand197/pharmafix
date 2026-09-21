from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('hr', '0062_attendance_control_biometric_simulation'),
    ]

    operations = [
        migrations.AddField(
            model_name='dailyattendance',
            name='attendance_source',
            field=models.CharField(
                choices=[
                    ('NONE', 'None'),
                    ('HR_MANUAL', 'HR Manual'),
                    ('MANUAL_BIOMETRIC_SIMULATION', 'Manual Biometric Simulation'),
                    ('BIOMETRIC_DEVICE', 'Biometric Device'),
                    ('EMPLOYEE_PORTAL', 'Employee Portal'),
                    ('IMPORT', 'Import'),
                    ('SYSTEM', 'System'),
                    ('MIXED', 'Mixed'),
                ],
                db_index=True,
                default='NONE',
                max_length=40,
            ),
        ),
        migrations.AddField(
            model_name='dailyattendance',
            name='incomplete_checkout',
            field=models.BooleanField(db_index=True, default=False),
        ),
        migrations.AddField(
            model_name='dailyattendance',
            name='overtime_minutes',
            field=models.PositiveIntegerField(default=0),
        ),
    ]
