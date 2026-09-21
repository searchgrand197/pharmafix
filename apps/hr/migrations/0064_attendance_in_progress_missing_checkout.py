from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('hr', '0063_daily_attendance_summary_fields'),
    ]

    operations = [
        migrations.AlterField(
            model_name='dailyattendance',
            name='attendance_status',
            field=models.CharField(
                choices=[
                    ('present', 'Present'),
                    ('absent', 'Absent'),
                    ('late', 'Late'),
                    ('half_day', 'Half Day'),
                    ('in_progress', 'In Progress'),
                    ('missing_checkout', 'Missing Checkout'),
                    ('incomplete', 'Incomplete'),
                    ('overtime', 'Overtime'),
                    ('leave', 'On Leave'),
                    ('holiday', 'Holiday'),
                    ('weekend', 'Weekend'),
                    ('work_from_office', 'Work From Office'),
                    ('unscheduled', 'No Shift Assigned'),
                ],
                db_index=True,
                default='absent',
                max_length=30,
            ),
        ),
    ]
