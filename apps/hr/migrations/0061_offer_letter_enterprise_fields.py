from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('hr', '0060_document_status_transition'),
    ]

    operations = [
        migrations.AddField(
            model_name='offerlettersettings',
            name='registered_office_address',
            field=models.TextField(blank=True, default=''),
        ),
        migrations.AddField(
            model_name='offerlettersettings',
            name='corporate_office_address',
            field=models.TextField(blank=True, default=''),
        ),
        migrations.AddField(
            model_name='offerlettersettings',
            name='company_registration_number',
            field=models.CharField(
                blank=True,
                default='',
                help_text='Company registration / CIN number shown on offer letter footer.',
                max_length=128,
            ),
        ),
        migrations.AddField(
            model_name='offerlettersettings',
            name='footer_confidentiality_note',
            field=models.TextField(
                blank=True,
                default='CONFIDENTIAL — This document is intended solely for the named recipient.',
            ),
        ),
        migrations.AddField(
            model_name='offerlettersettings',
            name='default_terms_conditions',
            field=models.JSONField(
                blank=True,
                default=list,
                help_text='Default Terms & Conditions blocks for new offer letters.',
            ),
        ),
    ]
