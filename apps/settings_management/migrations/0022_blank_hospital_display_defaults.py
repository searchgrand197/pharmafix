from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('settings_management', '0021_remove_receptionportalsettings_document_next_numbers'),
    ]

    operations = [
        migrations.AlterField(
            model_name='receptionportalsettings',
            name='hospital_name',
            field=models.CharField(blank=True, default='', max_length=200),
        ),
        migrations.AlterField(
            model_name='receptionportalsettings',
            name='address',
            field=models.CharField(blank=True, default='', max_length=255),
        ),
        migrations.AlterField(
            model_name='receptionportalsettings',
            name='pin_code',
            field=models.CharField(blank=True, default='', max_length=30),
        ),
        migrations.AlterField(
            model_name='receptionportalsettings',
            name='phone',
            field=models.CharField(blank=True, default='', max_length=40),
        ),
        migrations.AlterField(
            model_name='receptionportalsettings',
            name='email',
            field=models.CharField(blank=True, default='', max_length=120),
        ),
        migrations.AlterField(
            model_name='receptionportalsettings',
            name='website',
            field=models.CharField(blank=True, default='', max_length=200),
        ),
    ]
