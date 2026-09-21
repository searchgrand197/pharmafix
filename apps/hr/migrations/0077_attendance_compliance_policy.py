# Generated manually for attendance compliance policy engine

from decimal import Decimal

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('hr', '0076_department_salary_structures'),
    ]

    operations = [
        migrations.AddField(
            model_name='departmentsalarystructure',
            name='grace_minutes',
            field=models.PositiveSmallIntegerField(
                blank=True,
                help_text='Grace minutes before late applies; defaults to employee shift when empty.',
                null=True,
            ),
        ),
        migrations.AddField(
            model_name='departmentsalarystructure',
            name='half_day_after_n_lates',
            field=models.PositiveSmallIntegerField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name='departmentsalarystructure',
            name='holiday_ot_multiplier',
            field=models.DecimalField(decimal_places=2, default=Decimal('1.00'), max_digits=5),
        ),
        migrations.AddField(
            model_name='departmentsalarystructure',
            name='late_conversion_enabled',
            field=models.BooleanField(
                default=False,
                help_text='Convert monthly late count into equivalent leave-day deductions.',
            ),
        ),
        migrations.AddField(
            model_name='departmentsalarystructure',
            name='late_count_for_full_day',
            field=models.PositiveSmallIntegerField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name='departmentsalarystructure',
            name='late_count_for_half_day',
            field=models.PositiveSmallIntegerField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name='departmentsalarystructure',
            name='late_penalty_threshold_minutes',
            field=models.PositiveSmallIntegerField(
                default=15,
                help_text='Minutes above grace before per-minute penalty billing starts.',
            ),
        ),
        migrations.AddField(
            model_name='departmentsalarystructure',
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
            model_name='departmentsalarystructure',
            name='late_penalty_value',
            field=models.DecimalField(
                decimal_places=2,
                default=Decimal('0.00'),
                help_text='Rate per minute, fixed amount per late day, or percentage of daily salary.',
                max_digits=10,
            ),
        ),
        migrations.AddField(
            model_name='departmentsalarystructure',
            name='late_policy_enabled',
            field=models.BooleanField(
                default=False,
                help_text='When enabled, late penalty uses structure fields instead of global payroll settings.',
            ),
        ),
        migrations.AddField(
            model_name='departmentsalarystructure',
            name='overtime_enabled',
            field=models.BooleanField(default=True),
        ),
        migrations.AddField(
            model_name='departmentsalarystructure',
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
            model_name='departmentsalarystructure',
            name='warning_after_n_lates',
            field=models.PositiveSmallIntegerField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name='departmentsalarystructure',
            name='weekend_ot_multiplier',
            field=models.DecimalField(decimal_places=2, default=Decimal('1.00'), max_digits=5),
        ),
        migrations.AddField(
            model_name='departmentsalarystructure',
            name='full_day_after_n_lates',
            field=models.PositiveSmallIntegerField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name='salarystructure',
            name='grace_minutes',
            field=models.PositiveSmallIntegerField(
                blank=True,
                help_text='Grace minutes before late applies; defaults to employee shift when empty.',
                null=True,
            ),
        ),
        migrations.AddField(
            model_name='salarystructure',
            name='half_day_after_n_lates',
            field=models.PositiveSmallIntegerField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name='salarystructure',
            name='holiday_ot_multiplier',
            field=models.DecimalField(decimal_places=2, default=Decimal('1.00'), max_digits=5),
        ),
        migrations.AddField(
            model_name='salarystructure',
            name='late_conversion_enabled',
            field=models.BooleanField(
                default=False,
                help_text='Convert monthly late count into equivalent leave-day deductions.',
            ),
        ),
        migrations.AddField(
            model_name='salarystructure',
            name='late_count_for_full_day',
            field=models.PositiveSmallIntegerField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name='salarystructure',
            name='late_count_for_half_day',
            field=models.PositiveSmallIntegerField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name='salarystructure',
            name='late_penalty_threshold_minutes',
            field=models.PositiveSmallIntegerField(
                default=15,
                help_text='Minutes above grace before per-minute penalty billing starts.',
            ),
        ),
        migrations.AddField(
            model_name='salarystructure',
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
            model_name='salarystructure',
            name='late_penalty_value',
            field=models.DecimalField(
                decimal_places=2,
                default=Decimal('0.00'),
                help_text='Rate per minute, fixed amount per late day, or percentage of daily salary.',
                max_digits=10,
            ),
        ),
        migrations.AddField(
            model_name='salarystructure',
            name='late_policy_enabled',
            field=models.BooleanField(
                default=False,
                help_text='When enabled, late penalty uses structure fields instead of global payroll settings.',
            ),
        ),
        migrations.AddField(
            model_name='salarystructure',
            name='overtime_enabled',
            field=models.BooleanField(default=True),
        ),
        migrations.AddField(
            model_name='salarystructure',
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
            model_name='salarystructure',
            name='warning_after_n_lates',
            field=models.PositiveSmallIntegerField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name='salarystructure',
            name='weekend_ot_multiplier',
            field=models.DecimalField(decimal_places=2, default=Decimal('1.00'), max_digits=5),
        ),
        migrations.AddField(
            model_name='salarystructure',
            name='full_day_after_n_lates',
            field=models.PositiveSmallIntegerField(blank=True, null=True),
        ),
        migrations.AlterField(
            model_name='payrollauditlog',
            name='action',
            field=models.CharField(
                choices=[
                    ('CREATE', 'Create'),
                    ('UPDATE', 'Update'),
                    ('CALCULATE', 'Calculate'),
                    ('SUBMIT_REVIEW', 'Submit for Review'),
                    ('APPROVE', 'Approve'),
                    ('LOCK', 'Lock'),
                    ('PUBLISH', 'Publish'),
                ],
                db_index=True,
                max_length=20,
            ),
        ),
    ]
