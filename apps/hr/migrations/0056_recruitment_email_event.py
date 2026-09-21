# Generated manually for recruitment email event log

import uuid

from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ('hr', '0055_recruitment_global_ids_enforce'),
    ]

    operations = [
        migrations.CreateModel(
            name='RecruitmentEmailEvent',
            fields=[
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('id', models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                (
                    'event_type',
                    models.CharField(
                        choices=[
                            ('APPLICATION_RECEIVED', 'Application received'),
                            ('SHORTLISTED', 'Shortlisted'),
                            ('INTERVIEW_SCHEDULED', 'Interview scheduled'),
                            ('INTERVIEW_RESCHEDULED', 'Interview rescheduled'),
                            ('OFFER_SENT', 'Offer sent'),
                            ('OFFER_ACCEPTED', 'Offer accepted (welcome)'),
                            ('DOCUMENT_REQUEST', 'Document request'),
                            ('REJECTED', 'Rejected'),
                        ],
                        db_index=True,
                        max_length=40,
                    ),
                ),
                (
                    'stage',
                    models.CharField(
                        help_text='Idempotency key segment (pipeline stage, interview id, offer id, etc.).',
                        max_length=160,
                    ),
                ),
                (
                    'email_status',
                    models.CharField(
                        choices=[
                            ('pending', 'Pending'),
                            ('sent', 'Sent'),
                            ('failed', 'Failed'),
                            ('skipped_duplicate', 'Skipped (duplicate)'),
                        ],
                        db_index=True,
                        default='pending',
                        max_length=24,
                    ),
                ),
                ('error_message', models.TextField(blank=True, default='')),
                ('metadata', models.JSONField(blank=True, default=dict)),
                (
                    'candidate',
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name='recruitment_email_events',
                        to='hr.candidate',
                    ),
                ),
            ],
            options={
                'ordering': ['-created_at'],
            },
        ),
        migrations.AddIndex(
            model_name='recruitmentemailevent',
            index=models.Index(fields=['candidate', 'event_type'], name='hr_recruitm_candida_8a1f2d_idx'),
        ),
        migrations.AddIndex(
            model_name='recruitmentemailevent',
            index=models.Index(fields=['event_type', 'email_status'], name='hr_recruitm_event_t_4c9e8a_idx'),
        ),
        migrations.AddConstraint(
            model_name='recruitmentemailevent',
            constraint=models.UniqueConstraint(
                fields=('candidate', 'event_type', 'stage'),
                name='unique_recruitment_email_event',
            ),
        ),
    ]
