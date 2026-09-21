from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("ipd", "0010_rename_ipd_process_adm_date_idx_ipd_ipddail_admissi_ff86b4_idx_and_more"),
    ]

    operations = [
        migrations.AddField(
            model_name="ipddailyprocesslog",
            name="custom_fields",
            field=models.JSONField(blank=True, default=dict),
        ),
    ]
