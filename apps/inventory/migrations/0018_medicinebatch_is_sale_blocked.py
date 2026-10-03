from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('inventory', '0017_medicine_name_on_bill_alter_medicine_name'),
    ]

    operations = [
        migrations.AddField(
            model_name='medicinebatch',
            name='is_sale_blocked',
            field=models.BooleanField(default=False),
        ),
        migrations.AddField(
            model_name='medicinebatch',
            name='sale_block_reason',
            field=models.CharField(blank=True, default='', max_length=120),
        ),
    ]
