"""Data migration: lowercase stored emails where safe (conflicts skipped)."""

from django.db import migrations


def normalize_emails_forward(apps, schema_editor):
    from apps.shared.email_normalization import normalize_all_stored_emails
    normalize_all_stored_emails(apps=apps, dry_run=False)


class Migration(migrations.Migration):

    dependencies = [
        ('hr', '0051_component_offer_template_category'),
        ('accounts', '0001_initial'),
    ]

    operations = [
        migrations.RunPython(normalize_emails_forward, migrations.RunPython.noop),
    ]
