from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("lab", "0006_lab_watermark"),
    ]

    operations = [
        migrations.AddField(
            model_name="labsettings",
            name="watermark_size",
            field=models.PositiveSmallIntegerField(
                default=55,
                help_text="Watermark size percent of page (20–90).",
            ),
        ),
        migrations.AddField(
            model_name="labsettings",
            name="watermark_rotation",
            field=models.SmallIntegerField(
                default=0,
                help_text="Watermark rotation in degrees (-90 to 90).",
            ),
        ),
        migrations.AlterField(
            model_name="labsettings",
            name="watermark_opacity",
            field=models.PositiveSmallIntegerField(
                default=15,
                help_text="Watermark opacity percent (5–40).",
            ),
        ),
    ]
