from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("lab", "0005_lab_visit_id_settings"),
    ]

    operations = [
        migrations.AddField(
            model_name="labsettings",
            name="watermark",
            field=models.ImageField(blank=True, null=True, upload_to="lab/watermarks/"),
        ),
        migrations.AddField(
            model_name="labsettings",
            name="watermark_enabled",
            field=models.BooleanField(default=False),
        ),
        migrations.AddField(
            model_name="labsettings",
            name="watermark_source",
            field=models.CharField(
                choices=[("logo", "Lab logo"), ("custom", "Custom image")],
                default="logo",
                max_length=20,
            ),
        ),
        migrations.AddField(
            model_name="labsettings",
            name="watermark_opacity",
            field=models.PositiveSmallIntegerField(
                default=15,
                help_text="Watermark opacity percent (5–40).",
            ),
        ),
    ]
