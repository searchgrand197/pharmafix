from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('accounts', '0001_initial'),
    ]

    operations = [
        migrations.AddField(
            model_name='user',
            name='must_change_password',
            field=models.BooleanField(
                default=False,
                help_text='When true, employee portal blocks access until password is changed.',
            ),
        ),
    ]
