# Generated for interview reminder system

import uuid

from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ('hr', '0056_recruitment_email_event'),
    ]

    operations = [
        migrations.CreateModel(
            name='InterviewReminder',
            fields=[
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('id', models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                (
                    'reminder_type',
                    models.CharField(
                        choices=[
                            ('1_HOUR_BEFORE', '1 hour before'),
                            ('10_MIN_BEFORE', '10 minutes before'),
                        ],
                        max_length=20,
                    ),
                ),
                (
                    'scheduled_time',
                    models.DateTimeField(
                        db_index=True,
                        help_text='UTC time when this reminder should fire.',
                    ),
                ),
                ('is_sent', models.BooleanField(db_index=True, default=False)),
                ('sent_at', models.DateTimeField(blank=True, null=True)),
                ('error_message', models.TextField(blank=True, default='')),
                (
                    'interview',
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name='reminders',
                        to='hr.interview',
                    ),
                ),
            ],
            options={
                'ordering': ['scheduled_time'],
            },
        ),
        migrations.AddIndex(
            model_name='interviewreminder',
            index=models.Index(fields=['is_sent', 'scheduled_time'], name='hr_intervie_is_sent_7f3a2b_idx'),
        ),
        migrations.AddConstraint(
            model_name='interviewreminder',
            constraint=models.UniqueConstraint(
                fields=('interview', 'reminder_type'),
                name='unique_interview_reminder',
            ),
        ),
    ]
