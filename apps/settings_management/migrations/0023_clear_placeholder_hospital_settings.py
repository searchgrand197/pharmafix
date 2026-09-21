from django.db import migrations

OLD_DEFAULTS = {
    "hospital_name": "Vardraan Hospital",
    "address": "Jind, Haryana, 126102",
    "pin_code": "126102",
    "phone": "+91-XXXXXXXXXX",
    "email": "info@vardraanhospital.com",
    "website": "www.vardraanhospital.com",
}


def clear_placeholder_values(apps, schema_editor):
    """
    Blank out fields that still hold the old hard-coded placeholder values.
    Only touches rows where the value exactly matches the old default so that
    hospitals that intentionally set (e.g.) "Vardraan Hospital" as their real
    name keep their data.
    """
    ReceptionPortalSettings = apps.get_model("settings_management", "ReceptionPortalSettings")
    for field, old_value in OLD_DEFAULTS.items():
        ReceptionPortalSettings.objects.filter(**{field: old_value}).update(**{field: ""})


def noop(apps, schema_editor):
    pass


class Migration(migrations.Migration):

    dependencies = [
        ("settings_management", "0022_blank_hospital_display_defaults"),
    ]

    operations = [
        migrations.RunPython(clear_placeholder_values, noop),
    ]
