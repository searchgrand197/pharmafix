# Generated manually for HospitalCustomRxSalt

from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion
import django.utils.timezone
import uuid


class Migration(migrations.Migration):

    dependencies = [
        ("shared", "0002_add_pharmacy_branch_fields_to_hospital"),
        ("doctors", "0009_master_soft_delete"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name="HospitalCustomRxSalt",
            fields=[
                ("updated_at", models.DateTimeField(default=django.utils.timezone.now)),
                ("created_at", models.DateTimeField(default=django.utils.timezone.now, editable=False)),
                ("id", models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ("name", models.CharField(max_length=200)),
                ("normalized_name", models.CharField(max_length=200)),
                ("last_used_at", models.DateTimeField(default=django.utils.timezone.now)),
                ("use_count", models.PositiveIntegerField(default=1)),
                (
                    "created_by",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="created_custom_rx_salts",
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
                (
                    "hospital",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="custom_rx_salts",
                        to="shared.hospital",
                    ),
                ),
            ],
            options={
                "abstract": False,
            },
        ),
        migrations.AddIndex(
            model_name="hospitalcustomrxsalt",
            index=models.Index(fields=["hospital", "-last_used_at"], name="doctors_hos_hospita_idx"),
        ),
        migrations.AddConstraint(
            model_name="hospitalcustomrxsalt",
            constraint=models.UniqueConstraint(
                fields=("hospital", "normalized_name"),
                name="custom_rx_salt_hosp_norm_uniq",
            ),
        ),
    ]
