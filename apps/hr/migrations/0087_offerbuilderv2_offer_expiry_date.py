from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('hr', '0086_backfill_department_ref_hospital_null'),
    ]

    operations = [
        migrations.AddField(
            model_name='offerbuilderv2',
            name='offer_expiry_date',
            field=models.DateField(blank=True, null=True),
        ),
    ]
