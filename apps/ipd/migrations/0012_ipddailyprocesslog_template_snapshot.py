from django.db import migrations, models

from apps.settings_management.ipd_process_field_config import (
    DEFAULT_TEMPLATE_ID,
    get_hospital_process_config,
    normalize_ipd_process_field_config,
)


def backfill_process_log_templates(apps, schema_editor):
    IPDDailyProcessLog = apps.get_model("ipd", "IPDDailyProcessLog")
    for log in IPDDailyProcessLog.objects.select_related("hospital").iterator():
        if log.process_template_id and log.process_field_config:
            continue
        config = get_hospital_process_config(log.hospital_id)
        log.process_template_id = log.process_template_id or DEFAULT_TEMPLATE_ID
        log.process_field_config = normalize_ipd_process_field_config(
            log.process_field_config or config,
        )
        log.save(update_fields=["process_template_id", "process_field_config", "updated_at"])


class Migration(migrations.Migration):

    dependencies = [
        ("ipd", "0011_ipddailyprocesslog_custom_fields"),
        ("settings_management", "0019_ipd_process_templates_v2"),
    ]

    operations = [
        migrations.AddField(
            model_name="ipddailyprocesslog",
            name="process_template_id",
            field=models.CharField(blank=True, default="", max_length=64),
        ),
        migrations.AddField(
            model_name="ipddailyprocesslog",
            name="process_field_config",
            field=models.JSONField(blank=True, default=dict),
        ),
        migrations.RunPython(backfill_process_log_templates, migrations.RunPython.noop),
    ]
