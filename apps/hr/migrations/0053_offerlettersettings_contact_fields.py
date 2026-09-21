from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('hr', '0052_normalize_stored_emails'),
    ]

    operations = [
        migrations.AddField(
            model_name='offerlettersettings',
            name='company_email',
            field=models.CharField(blank=True, default='', max_length=255),
        ),
        migrations.AddField(
            model_name='offerlettersettings',
            name='company_phone',
            field=models.CharField(blank=True, default='', max_length=64),
        ),
        migrations.AddField(
            model_name='offerlettersettings',
            name='hr_email',
            field=models.CharField(blank=True, default='', max_length=255),
        ),
        migrations.AddField(
            model_name='offerlettersettings',
            name='hr_phone',
            field=models.CharField(blank=True, default='', max_length=64),
        ),
        migrations.AlterModelOptions(
            name='offerlettersettings',
            options={
                'ordering': ['-updated_at'],
                'verbose_name': 'Organization Settings',
                'verbose_name_plural': 'Organization Settings',
            },
        ),
    ]
