from django.db import migrations


def rename_sick_to_medical_leave(apps, schema_editor):
    LeaveType = apps.get_model('hr', 'LeaveType')
    LeaveType.objects.filter(
        code__iexact='SL',
        name__iexact='Sick Leave',
    ).update(name='Medical Leave')


def reverse_rename(apps, schema_editor):
    LeaveType = apps.get_model('hr', 'LeaveType')
    LeaveType.objects.filter(
        code__iexact='SL',
        name__iexact='Medical Leave',
    ).update(name='Sick Leave')


class Migration(migrations.Migration):

    dependencies = [
        ('hr', '0089_add_gender_fields'),
    ]

    operations = [
        migrations.RunPython(rename_sick_to_medical_leave, reverse_rename),
    ]
