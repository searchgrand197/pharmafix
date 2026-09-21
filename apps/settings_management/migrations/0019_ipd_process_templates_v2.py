from django.db import migrations

from apps.settings_management.ipd_process_field_config import normalize_ipd_process_templates


def wrap_legacy_ipd_configs(apps, schema_editor):
    ReceptionPortalSettings = apps.get_model("settings_management", "ReceptionPortalSettings")
    for row in ReceptionPortalSettings.objects.all().iterator():
        raw = row.ipd_process_field_config or {}
        normalized = normalize_ipd_process_templates(raw)
        if normalized != raw:
            row.ipd_process_field_config = normalized
            row.save(update_fields=["ipd_process_field_config", "updated_at"])


class Migration(migrations.Migration):

    dependencies = [
        ("settings_management", "0018_receptionportalsettings_ipd_process_field_config"),
    ]

    operations = [
        migrations.RunPython(wrap_legacy_ipd_configs, migrations.RunPython.noop),
    ]
