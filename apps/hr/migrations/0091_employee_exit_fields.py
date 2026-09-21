from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('hr', '0090_rename_sick_to_medical_leave'),
    ]

    operations = [
        migrations.AddField(
            model_name='employee',
            name='conduct_remarks',
            field=models.CharField(blank=True, default='satisfactory', max_length=255),
        ),
        migrations.AddField(
            model_name='employee',
            name='exit_reason',
            field=models.CharField(blank=True, default='', max_length=100),
        ),
        migrations.AddField(
            model_name='employee',
            name='exited_at',
            field=models.DateTimeField(blank=True, help_text='When HR marked the employee as exited', null=True),
        ),
        migrations.AddField(
            model_name='employee',
            name='relieving_date',
            field=models.DateField(blank=True, help_text='Last working day', null=True),
        ),
    ]
