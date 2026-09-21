import uuid

import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("shared", "0001_initial"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
        ("ipd", "0008_ipdadmission_room_rent_days_override"),
    ]

    operations = [
        migrations.CreateModel(
            name="IPDDailyProcessLog",
            fields=[
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("id", models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ("log_date", models.DateField(db_index=True)),
                ("day_number", models.PositiveIntegerField(blank=True, null=True)),
                ("vitals", models.JSONField(blank=True, default=dict)),
                ("medication_procedure_notes", models.TextField(blank=True, default="")),
                ("completed_notes", models.TextField(blank=True, default="")),
                ("pending_notes", models.TextField(blank=True, default="")),
                ("general_notes", models.TextField(blank=True, default="")),
                (
                    "admission",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="process_logs",
                        to="ipd.ipdadmission",
                    ),
                ),
                (
                    "hospital",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="ipd_process_logs",
                        to="shared.hospital",
                    ),
                ),
                (
                    "recorded_by",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="ipd_process_logs_recorded",
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
            ],
            options={
                "ordering": ["-log_date", "-created_at"],
            },
        ),
        migrations.AddIndex(
            model_name="ipddailyprocesslog",
            index=models.Index(fields=["admission", "log_date"], name="ipd_process_adm_date_idx"),
        ),
        migrations.AddIndex(
            model_name="ipddailyprocesslog",
            index=models.Index(fields=["hospital", "log_date"], name="ipd_process_hosp_date_idx"),
        ),
        migrations.AddConstraint(
            model_name="ipddailyprocesslog",
            constraint=models.UniqueConstraint(
                fields=("admission", "log_date"),
                name="ipd_unique_process_log_per_day",
            ),
        ),
    ]
