from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('hr', '0088_biometric_integration'),
    ]

    operations = [
        migrations.AddField(
            model_name='candidate',
            name='gender',
            field=models.CharField(
                blank=True,
                choices=[('male', 'Male'), ('female', 'Female'), ('other', 'Other')],
                default='',
                max_length=10,
            ),
        ),
        migrations.AddField(
            model_name='candidateprofile',
            name='gender',
            field=models.CharField(
                blank=True,
                choices=[('male', 'Male'), ('female', 'Female'), ('other', 'Other')],
                default='',
                max_length=10,
            ),
        ),
        migrations.AddField(
            model_name='employee',
            name='gender',
            field=models.CharField(
                blank=True,
                choices=[('male', 'Male'), ('female', 'Female'), ('other', 'Other')],
                default='',
                max_length=10,
            ),
        ),
    ]
