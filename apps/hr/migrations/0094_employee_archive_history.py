from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion
import django.utils.timezone


class Migration(migrations.Migration):

    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
        ('hr', '0093_document_type_upload_only'),
    ]

    operations = [
        migrations.AddField(
            model_name='employee',
            name='eligible_for_rehire',
            field=models.BooleanField(default=True, help_text='Whether HR marked the employee as eligible for future rehire.'),
        ),
        migrations.AddField(
            model_name='employee',
            name='exit_notes',
            field=models.TextField(blank=True, default=''),
        ),
        migrations.AddField(
            model_name='employee',
            name='last_working_day_confirmed_by',
            field=models.ForeignKey(
                blank=True,
                help_text='HR user who last confirmed the exit details.',
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name='employees_last_working_day_confirmed',
                to=settings.AUTH_USER_MODEL,
            ),
        ),
        migrations.AlterField(
            model_name='employee',
            name='exit_reason',
            field=models.CharField(
                blank=True,
                choices=[
                    ('', 'Not specified'),
                    ('resignation', 'Resignation'),
                    ('termination', 'Termination'),
                    ('retirement', 'Retirement'),
                    ('contract_end', 'Contract End'),
                    ('absconding', 'Absconding'),
                    ('death', 'Death'),
                    ('other', 'Other'),
                ],
                default='',
                max_length=100,
            ),
        ),
        migrations.CreateModel(
            name='EmployeeStatusHistory',
            fields=[
                ('id', models.UUIDField(editable=False, primary_key=True, serialize=False)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('event_type', models.CharField(choices=[('status_change', 'Status Change'), ('exit', 'Exit'), ('restore', 'Restore')], db_index=True, default='status_change', max_length=30)),
                ('previous_status', models.CharField(blank=True, default='', max_length=30)),
                ('new_status', models.CharField(blank=True, default='', max_length=30)),
                ('exit_reason', models.CharField(blank=True, choices=[('', 'Not specified'), ('resignation', 'Resignation'), ('termination', 'Termination'), ('retirement', 'Retirement'), ('contract_end', 'Contract End'), ('absconding', 'Absconding'), ('death', 'Death'), ('other', 'Other')], default='', max_length=100)),
                ('notes', models.TextField(blank=True, default='')),
                ('conduct_remarks', models.CharField(blank=True, default='', max_length=255)),
                ('relieving_date', models.DateField(blank=True, null=True)),
                ('eligible_for_rehire', models.BooleanField(default=True)),
                ('changed_at', models.DateTimeField(db_index=True, default=django.utils.timezone.now)),
                ('changed_by', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='employee_status_history_events', to=settings.AUTH_USER_MODEL)),
                ('employee', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='status_history', to='hr.employee')),
            ],
            options={
                'ordering': ['-changed_at', '-created_at'],
                'indexes': [
                    models.Index(fields=['employee', 'changed_at'], name='hr_employe_employe_67e3d8_idx'),
                    models.Index(fields=['employee', 'event_type'], name='hr_employe_employe_24d66c_idx'),
                ],
            },
        ),
    ]
