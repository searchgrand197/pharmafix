from django.db import migrations


def migrate_document_types_to_upload(apps, schema_editor):
    DocumentType = apps.get_model('hr', 'DocumentType')
    DocumentType.objects.filter(
        verification_mode__in=['physical', 'hybrid'],
    ).update(verification_mode='upload')


class Migration(migrations.Migration):

    dependencies = [
        ('hr', '0092_alter_biometricdevice_options'),
    ]

    operations = [
        migrations.RunPython(migrate_document_types_to_upload, migrations.RunPython.noop),
    ]
