from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('hr', '0037_offerbuilderv2_letter_fonts_and_website'),
    ]

    operations = [
        migrations.AddField(
            model_name='offer',
            name='onboarding_welcome_email_sent_at',
            field=models.DateTimeField(
                blank=True,
                help_text=(
                    'Set when onboarding welcome email dispatch is claimed (idempotent send). '
                    'Cleared if SMTP dispatch fails so HR can retry.'
                ),
                null=True,
            ),
        ),
    ]
