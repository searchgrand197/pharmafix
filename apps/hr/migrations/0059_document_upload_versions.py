# Document upload version history + file hash on requirements

import uuid

import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('hr', '0058_job_application_document_requirements'),
    ]

    operations = [
        migrations.AddField(
            model_name='employeedocumentrequirement',
            name='file_hash',
            field=models.CharField(blank=True, db_index=True, default='', max_length=64),
        ),
        migrations.CreateModel(
            name='EmployeeDocumentUploadVersion',
            fields=[
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('id', models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ('file', models.FileField(upload_to='employee_requirements/versions/%Y/%m/')),
                ('original_filename', models.CharField(blank=True, default='', max_length=255)),
                ('file_size', models.PositiveIntegerField(default=0)),
                ('file_hash', models.CharField(blank=True, db_index=True, default='', max_length=64)),
                ('version_number', models.PositiveIntegerField(default=1)),
                ('uploaded_at', models.DateTimeField()),
                ('archived_at', models.DateTimeField(auto_now_add=True)),
                (
                    'archived_reason',
                    models.CharField(
                        choices=[
                            ('replaced', 'Replaced by candidate'),
                            ('reupload_cleared', 'Cleared for HR re-upload request'),
                            ('hr_rejected', 'Archived on HR rejection'),
                        ],
                        default='replaced',
                        max_length=32,
                    ),
                ),
                ('status_at_archive', models.CharField(blank=True, default='', max_length=30)),
                (
                    'requirement',
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name='upload_versions',
                        to='hr.employeedocumentrequirement',
                    ),
                ),
            ],
            options={
                'ordering': ['-version_number'],
            },
        ),
    ]
