from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('hr', '0097_dailyattendance_not_started_status'),
    ]

    operations = [
        migrations.AddField(
            model_name='shift',
            name='early_punch_minutes',
            field=models.PositiveSmallIntegerField(
                default=240,
                help_text='Minutes before shift start that biometric punches are accepted (default 4 hours).',
            ),
        ),
    ]
