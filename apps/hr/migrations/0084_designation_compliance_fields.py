# Designation salary: full attendance compliance fields (OT + late rules)

from decimal import Decimal

from django.db import migrations, models


def backfill_designation_compliance(apps, schema_editor):
    DesignationSalaryStructure = apps.get_model('hr', 'DesignationSalaryStructure')

    for row in DesignationSalaryStructure.objects.all():
        ot_rate = getattr(row, 'overtime_rate_per_hour', None) or Decimal('0.00')
        late_rate = getattr(row, 'late_penalty_per_minute', None) or Decimal('0.00')

        row.overtime_rate = ot_rate
        if ot_rate > 0:
            row.overtime_enabled = True
            row.overtime_type = 'fixed_per_hour'

        if late_rate > 0:
            row.late_policy_enabled = True
            row.late_penalty_type = 'per_minute'
            row.late_penalty_value = late_rate
            row.late_penalty_threshold_minutes = 15

        row.save(
            update_fields=[
                'overtime_rate',
                'overtime_enabled',
                'overtime_type',
                'late_policy_enabled',
                'late_penalty_type',
                'late_penalty_value',
                'late_penalty_threshold_minutes',
            ],
        )


class Migration(migrations.Migration):

    dependencies = [
        ('hr', '0083_candidate_passport_photo'),
    ]

    operations = [
        migrations.AddField(
            model_name='designationsalarystructure',
            name='grace_minutes',
            field=models.PositiveSmallIntegerField(
                blank=True,
                help_text='Grace minutes before late applies; defaults to employee shift when empty.',
                null=True,
            ),
        ),
        migrations.AddField(
            model_name='designationsalarystructure',
            name='half_day_after_n_lates',
            field=models.PositiveSmallIntegerField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name='designationsalarystructure',
            name='holiday_ot_multiplier',
            field=models.DecimalField(decimal_places=2, default=Decimal('1.00'), max_digits=5),
        ),
        migrations.AddField(
            model_name='designationsalarystructure',
            name='late_conversion_enabled',
            field=models.BooleanField(
                default=False,
                help_text='Convert monthly late count into equivalent leave-day deductions.',
            ),
        ),
        migrations.AddField(
            model_name='designationsalarystructure',
            name='late_count_for_full_day',
            field=models.PositiveSmallIntegerField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name='designationsalarystructure',
            name='late_count_for_half_day',
            field=models.PositiveSmallIntegerField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name='designationsalarystructure',
            name='late_penalty_threshold_minutes',
            field=models.PositiveSmallIntegerField(
                default=15,
                help_text='Minutes above grace before per-minute penalty billing starts.',
            ),
        ),
        migrations.AddField(
            model_name='designationsalarystructure',
            name='late_penalty_type',
            field=models.CharField(
                choices=[
                    ('per_minute', 'Per minute'),
                    ('fixed_per_late_day', 'Fixed per late day'),
                    ('percentage_daily_salary', 'Percentage of daily salary'),
                ],
                default='per_minute',
                max_length=32,
            ),
        ),
        migrations.AddField(
            model_name='designationsalarystructure',
            name='late_penalty_value',
            field=models.DecimalField(
                decimal_places=2,
                default=Decimal('0.00'),
                help_text='Rate per minute, fixed amount per late day, or percentage of daily salary.',
                max_digits=10,
            ),
        ),
        migrations.AddField(
            model_name='designationsalarystructure',
            name='late_policy_enabled',
            field=models.BooleanField(
                default=False,
                help_text='When enabled, late penalty uses structure fields instead of global payroll settings.',
            ),
        ),
        migrations.AddField(
            model_name='designationsalarystructure',
            name='full_day_after_n_lates',
            field=models.PositiveSmallIntegerField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name='designationsalarystructure',
            name='overtime_enabled',
            field=models.BooleanField(default=True),
        ),
        migrations.AddField(
            model_name='designationsalarystructure',
            name='overtime_type',
            field=models.CharField(
                choices=[
                    ('fixed_per_hour', 'Fixed per hour'),
                    ('percentage_hourly_rate', 'Percentage of hourly rate'),
                ],
                default='fixed_per_hour',
                max_length=32,
            ),
        ),
        migrations.AddField(
            model_name='designationsalarystructure',
            name='warning_after_n_lates',
            field=models.PositiveSmallIntegerField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name='designationsalarystructure',
            name='weekend_ot_multiplier',
            field=models.DecimalField(decimal_places=2, default=Decimal('1.00'), max_digits=5),
        ),
        migrations.AddField(
            model_name='designationsalarystructure',
            name='overtime_rate',
            field=models.DecimalField(
                decimal_places=2,
                default=Decimal('0.00'),
                help_text='Hourly overtime rate applied when shift policy allows OT.',
                max_digits=10,
            ),
        ),
        migrations.RunPython(backfill_designation_compliance, migrations.RunPython.noop),
        migrations.RemoveField(
            model_name='designationsalarystructure',
            name='late_penalty_per_minute',
        ),
        migrations.RemoveField(
            model_name='designationsalarystructure',
            name='overtime_rate_per_hour',
        ),
    ]
