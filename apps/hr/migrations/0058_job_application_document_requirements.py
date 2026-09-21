# Generated manually for job-specific document requirements

import uuid

import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('hr', '0057_interview_reminder'),
    ]

    operations = [
        migrations.AddField(
            model_name='candidate',
            name='document_requirements_snapshotted_at',
            field=models.DateTimeField(
                blank=True,
                help_text='Set when job document requirements were frozen for this application.',
                null=True,
            ),
        ),
        migrations.CreateModel(
            name='JobDocumentRequirement',
            fields=[
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('id', models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ('is_required', models.BooleanField(default=True)),
                ('allow_multiple', models.BooleanField(default=False)),
                ('display_order', models.PositiveSmallIntegerField(default=0)),
                (
                    'document_type',
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name='job_requirements',
                        to='hr.documenttype',
                    ),
                ),
                (
                    'job',
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name='document_requirements',
                        to='hr.jobopening',
                    ),
                ),
            ],
            options={
                'ordering': ['display_order', 'document_type__name'],
            },
        ),
        migrations.CreateModel(
            name='ApplicationDocumentRequirement',
            fields=[
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('id', models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ('is_required', models.BooleanField(default=True)),
                ('allow_multiple', models.BooleanField(default=False)),
                ('display_order', models.PositiveSmallIntegerField(default=0)),
                (
                    'application',
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name='document_requirements',
                        to='hr.candidate',
                    ),
                ),
                (
                    'document_type',
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name='application_requirements',
                        to='hr.documenttype',
                    ),
                ),
            ],
            options={
                'ordering': ['display_order', 'document_type__name'],
            },
        ),
        migrations.AddConstraint(
            model_name='jobdocumentrequirement',
            constraint=models.UniqueConstraint(
                fields=('job', 'document_type'),
                name='unique_job_document_requirement',
            ),
        ),
        migrations.AddConstraint(
            model_name='applicationdocumentrequirement',
            constraint=models.UniqueConstraint(
                fields=('application', 'document_type'),
                name='unique_application_document_requirement',
            ),
        ),
    ]
