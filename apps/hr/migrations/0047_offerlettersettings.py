from django.db import migrations, models
import django.db.models.deletion
import django.utils.timezone
import uuid


class Migration(migrations.Migration):

    dependencies = [
        ("hr", "0046_dailyattendance_leave_integration"),
    ]

    operations = [
        migrations.CreateModel(
            name="OfferLetterSettings",
            fields=[
                ("created_at", models.DateTimeField(default=django.utils.timezone.now, editable=False)),
                ("updated_at", models.DateTimeField(default=django.utils.timezone.now)),
                ("id", models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ("organization_name", models.CharField(blank=True, default="", max_length=255)),
                ("organization_address", models.TextField(blank=True, default="")),
                ("organization_location", models.CharField(blank=True, default="", max_length=255)),
                ("organization_contact", models.CharField(blank=True, default="", max_length=255)),
                ("organization_website", models.CharField(blank=True, default="", max_length=255)),
                ("hr_name", models.CharField(blank=True, default="", max_length=255)),
                ("hr_designation", models.CharField(blank=True, default="HR Manager", max_length=255)),
                ("logo", models.ImageField(blank=True, null=True, upload_to="offer_settings/logos/")),
                ("signature", models.ImageField(blank=True, null=True, upload_to="offer_settings/signatures/")),
                ("logo_config", models.JSONField(blank=True, default=dict)),
                ("signature_config", models.JSONField(blank=True, default=dict)),
                (
                    "hospital",
                    models.OneToOneField(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="offer_letter_settings",
                        to="shared.hospital",
                    ),
                ),
            ],
            options={
                "verbose_name": "Offer Letter Settings",
                "verbose_name_plural": "Offer Letter Settings",
                "ordering": ["-updated_at"],
            },
        ),
    ]
