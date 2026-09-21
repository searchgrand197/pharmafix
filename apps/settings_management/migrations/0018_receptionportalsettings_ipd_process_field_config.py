from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("settings_management", "0017_receptionportalsettings_reception_daily_report_enabled"),
    ]

    operations = [
        migrations.AddField(
            model_name="receptionportalsettings",
            name="ipd_process_field_config",
            field=models.JSONField(
                blank=True,
                default=dict,
                help_text="Hospital IPD Process form builder: field tree, types, layout.",
            ),
        ),
    ]
