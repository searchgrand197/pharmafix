# Payroll engine foundation — SalaryStructure, PayrollRun, Payslip

import django.core.validators
import django.db.models.deletion
import django.utils.timezone
import uuid
from decimal import Decimal
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('hr', '0067_audit_actions_portal_unified'),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name='SalaryStructure',
            fields=[
                ('created_at', models.DateTimeField(default=django.utils.timezone.now, editable=False)),
                ('updated_at', models.DateTimeField(default=django.utils.timezone.now)),
                ('id', models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ('basic_salary', models.DecimalField(decimal_places=2, max_digits=12)),
                ('hra', models.DecimalField(decimal_places=2, default=Decimal('0.00'), max_digits=12)),
                ('allowances', models.JSONField(blank=True, default=dict, help_text='Flexible allowance breakdown, e.g. {"transport": 1500, "medical": 800}.')),
                ('deductions', models.JSONField(blank=True, default=dict, help_text='Fixed monthly deductions, e.g. {"pf": 1800, "professional_tax": 200}.')),
                ('overtime_rate', models.DecimalField(decimal_places=2, default=Decimal('0.00'), help_text='Hourly overtime rate applied when shift policy allows OT.', max_digits=10)),
                ('effective_from', models.DateField(db_index=True)),
                ('effective_to', models.DateField(blank=True, null=True)),
                ('is_active', models.BooleanField(db_index=True, default=True)),
                ('notes', models.TextField(blank=True, default='')),
                ('employee', models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name='salary_structures', to='hr.employee')),
            ],
            options={
                'ordering': ['-effective_from', '-created_at'],
            },
        ),
        migrations.CreateModel(
            name='PayrollRun',
            fields=[
                ('created_at', models.DateTimeField(default=django.utils.timezone.now, editable=False)),
                ('updated_at', models.DateTimeField(default=django.utils.timezone.now)),
                ('id', models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ('month', models.CharField(db_index=True, help_text='Payroll period in YYYY-MM format.', max_length=7, validators=[django.core.validators.RegexValidator(message='Month must be in YYYY-MM format.', regex='^\\d{4}-(0[1-9]|1[0-2])$')])),
                ('total_present_days', models.DecimalField(decimal_places=2, default=Decimal('0.00'), max_digits=6)),
                ('total_absent_days', models.DecimalField(decimal_places=2, default=Decimal('0.00'), max_digits=6)),
                ('total_leave_days', models.DecimalField(decimal_places=2, default=Decimal('0.00'), max_digits=6)),
                ('overtime_hours', models.DecimalField(decimal_places=2, default=Decimal('0.00'), max_digits=8)),
                ('gross_salary', models.DecimalField(decimal_places=2, default=Decimal('0.00'), max_digits=12)),
                ('total_deductions', models.DecimalField(decimal_places=2, default=Decimal('0.00'), max_digits=12)),
                ('final_salary', models.DecimalField(decimal_places=2, default=Decimal('0.00'), max_digits=12)),
                ('status', models.CharField(choices=[('DRAFT', 'Draft'), ('FINALIZED', 'Finalized'), ('LOCKED', 'Locked')], db_index=True, default='DRAFT', max_length=12)),
                ('calculation_snapshot', models.JSONField(blank=True, default=dict, help_text='Intermediate values from PayrollCalculator (attendance/leave inputs, LOP, OT, etc.).')),
                ('finalized_at', models.DateTimeField(blank=True, null=True)),
                ('locked_at', models.DateTimeField(blank=True, null=True)),
                ('calculated_by', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='payroll_runs_calculated', to=settings.AUTH_USER_MODEL)),
                ('employee', models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name='payroll_runs', to='hr.employee')),
                ('salary_structure', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='payroll_runs', to='hr.salarystructure')),
            ],
            options={
                'ordering': ['-month', '-created_at'],
            },
        ),
        migrations.CreateModel(
            name='Payslip',
            fields=[
                ('created_at', models.DateTimeField(default=django.utils.timezone.now, editable=False)),
                ('updated_at', models.DateTimeField(default=django.utils.timezone.now)),
                ('id', models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ('month', models.CharField(db_index=True, max_length=7, validators=[django.core.validators.RegexValidator(message='Month must be in YYYY-MM format.', regex='^\\d{4}-(0[1-9]|1[0-2])$')])),
                ('earnings_breakdown', models.JSONField(blank=True, default=dict, help_text='Earnings line items, e.g. {"basic": 30000, "hra": 12000, "overtime": 500}.')),
                ('deductions_breakdown', models.JSONField(blank=True, default=dict, help_text='Deduction line items, e.g. {"lop": 2000, "pf": 1800}.')),
                ('generated_pdf', models.FileField(blank=True, help_text='Optional PDF payslip — populated when document generation is implemented.', null=True, upload_to='payslips/%Y/%m/')),
                ('employee', models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name='payslips', to='hr.employee')),
                ('payroll_run', models.OneToOneField(on_delete=django.db.models.deletion.CASCADE, related_name='payslip', to='hr.payrollrun')),
            ],
            options={
                'ordering': ['-month', '-created_at'],
            },
        ),
        migrations.AddIndex(
            model_name='salarystructure',
            index=models.Index(fields=['employee', 'effective_from'], name='hr_salaryst_employe_69f349_idx'),
        ),
        migrations.AddIndex(
            model_name='salarystructure',
            index=models.Index(fields=['employee', 'is_active'], name='hr_salaryst_employe_98d14d_idx'),
        ),
        migrations.AddIndex(
            model_name='payrollrun',
            index=models.Index(fields=['month', 'status'], name='hr_payrollr_month_646704_idx'),
        ),
        migrations.AddIndex(
            model_name='payrollrun',
            index=models.Index(fields=['employee', 'month'], name='hr_payrollr_employe_7e8506_idx'),
        ),
        migrations.AddIndex(
            model_name='payslip',
            index=models.Index(fields=['employee', 'month'], name='hr_payslip_employe_443aed_idx'),
        ),
        migrations.AddConstraint(
            model_name='payrollrun',
            constraint=models.UniqueConstraint(fields=('employee', 'month'), name='unique_payroll_run_per_employee_month'),
        ),
    ]
