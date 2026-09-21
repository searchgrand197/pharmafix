# Payroll approval workflow — extended statuses, audit log, approval metadata

import django.db.models.deletion
import django.utils.timezone
import uuid
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('hr', '0069_payslip_generation_fields'),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.AlterField(
            model_name='payrollrun',
            name='status',
            field=models.CharField(
                choices=[
                    ('DRAFT', 'Draft'),
                    ('UNDER_REVIEW', 'Under Review'),
                    ('APPROVED', 'Approved'),
                    ('LOCKED', 'Locked'),
                    ('PUBLISHED', 'Published'),
                    ('FINALIZED', 'Finalized (legacy)'),
                ],
                db_index=True,
                default='DRAFT',
                max_length=16,
            ),
        ),
        migrations.AddField(
            model_name='payrollrun',
            name='approved_at',
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name='payrollrun',
            name='approved_by',
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name='payroll_runs_approved',
                to=settings.AUTH_USER_MODEL,
            ),
        ),
        migrations.AddField(
            model_name='payrollrun',
            name='published_at',
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name='payrollrun',
            name='published_by',
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name='payroll_runs_published',
                to=settings.AUTH_USER_MODEL,
            ),
        ),
        migrations.AddField(
            model_name='payrollrun',
            name='reviewed_at',
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name='payrollrun',
            name='reviewed_by',
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name='payroll_runs_reviewed',
                to=settings.AUTH_USER_MODEL,
            ),
        ),
        migrations.CreateModel(
            name='PayrollAuditLog',
            fields=[
                ('created_at', models.DateTimeField(default=django.utils.timezone.now, editable=False)),
                ('updated_at', models.DateTimeField(default=django.utils.timezone.now)),
                ('id', models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ('action', models.CharField(
                    choices=[
                        ('CREATE', 'Create'),
                        ('UPDATE', 'Update'),
                        ('SUBMIT_REVIEW', 'Submit for Review'),
                        ('APPROVE', 'Approve'),
                        ('LOCK', 'Lock'),
                        ('PUBLISH', 'Publish'),
                    ],
                    db_index=True,
                    max_length=20,
                )),
                ('old_value', models.JSONField(blank=True, default=dict)),
                ('new_value', models.JSONField(blank=True, default=dict)),
                ('notes', models.TextField(blank=True, default='')),
                ('payroll_run', models.ForeignKey(
                    on_delete=django.db.models.deletion.CASCADE,
                    related_name='audit_logs',
                    to='hr.payrollrun',
                )),
                ('performed_by', models.ForeignKey(
                    blank=True,
                    null=True,
                    on_delete=django.db.models.deletion.SET_NULL,
                    related_name='payroll_audit_logs',
                    to=settings.AUTH_USER_MODEL,
                )),
            ],
            options={
                'ordering': ['-created_at'],
            },
        ),
        migrations.AddIndex(
            model_name='payrollauditlog',
            index=models.Index(fields=['payroll_run', 'action'], name='hr_payroll_run_action_idx'),
        ),
        migrations.AddIndex(
            model_name='payrollauditlog',
            index=models.Index(fields=['payroll_run', 'created_at'], name='hr_payroll_run_created_idx'),
        ),
    ]
