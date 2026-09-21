# Generated manually for HR designation master

import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('hr', '0077_attendance_compliance_policy'),
    ]

    operations = [
        migrations.CreateModel(
            name='Designation',
            fields=[
                ('id', models.UUIDField(editable=False, primary_key=True, serialize=False)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('name', models.CharField(max_length=200)),
                ('code', models.CharField(blank=True, default='', max_length=50)),
                ('level', models.PositiveSmallIntegerField(default=0)),
                ('is_active', models.BooleanField(db_index=True, default=True)),
                (
                    'department',
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name='designations',
                        to='hr.department',
                    ),
                ),
                (
                    'hospital',
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name='hr_designations',
                        to='shared.hospital',
                    ),
                ),
            ],
            options={
                'ordering': ['level', 'name'],
            },
        ),
        migrations.AddIndex(
            model_name='designation',
            index=models.Index(fields=['hospital', 'is_active'], name='hr_designat_hospita_idx'),
        ),
        migrations.AddConstraint(
            model_name='designation',
            constraint=models.UniqueConstraint(
                fields=('hospital', 'name'),
                name='unique_hr_designation_name_per_hospital',
            ),
        ),
        migrations.AddConstraint(
            model_name='designation',
            constraint=models.UniqueConstraint(
                condition=models.Q(('code__gt', '')),
                fields=('hospital', 'code'),
                name='unique_hr_designation_code_per_hospital',
            ),
        ),
        migrations.AddField(
            model_name='employee',
            name='designation',
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name='employees',
                to='hr.designation',
            ),
        ),
        migrations.AddField(
            model_name='jobopening',
            name='designation',
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name='job_openings',
                to='hr.designation',
            ),
        ),
        migrations.AddField(
            model_name='departmentsalarystructure',
            name='designation',
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name='salary_structures',
                to='hr.designation',
            ),
        ),
    ]
