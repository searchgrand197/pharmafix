# Document moderation status history + undo

import uuid

import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('hr', '0059_document_upload_versions'),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name='DocumentStatusTransition',
            fields=[
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('id', models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ('scope', models.CharField(choices=[('document', 'Document'), ('application', 'Application')], default='document', max_length=20)),
                ('previous_status', models.CharField(blank=True, default='', max_length=40)),
                ('new_status', models.CharField(blank=True, default='', max_length=40)),
                ('previous_candidate_status', models.CharField(blank=True, default='', max_length=30)),
                ('new_candidate_status', models.CharField(blank=True, default='', max_length=30)),
                (
                    'action_type',
                    models.CharField(
                        choices=[
                            ('approve', 'Approve'),
                            ('request_reupload', 'Request Reupload'),
                            ('final_reject', 'Final Reject'),
                            ('undo', 'Undo'),
                        ],
                        max_length=30,
                    ),
                ),
                ('reason', models.TextField(blank=True, default='')),
                ('snapshot', models.JSONField(blank=True, default=dict)),
                ('undone_at', models.DateTimeField(blank=True, null=True)),
                ('email_sent', models.BooleanField(default=False)),
                (
                    'candidate',
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name='document_status_transitions',
                        to='hr.candidate',
                    ),
                ),
                (
                    'changed_by',
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name='document_status_transitions',
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
                (
                    'employee',
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name='document_status_transitions',
                        to='hr.employee',
                    ),
                ),
                (
                    'requirement',
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name='status_transitions',
                        to='hr.employeedocumentrequirement',
                    ),
                ),
                (
                    'undone_by',
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name='undone_document_transitions',
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
            ],
            options={
                'ordering': ['-created_at'],
            },
        ),
    ]
