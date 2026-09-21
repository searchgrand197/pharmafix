from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("settings_management", "0019_ipd_process_templates_v2"),
    ]

    operations = [
        migrations.AddField(
            model_name="receptionportalsettings",
            name="document_next_numbers",
            field=models.JSONField(
                blank=True,
                default=dict,
                help_text=(
                    "Next sequence numbers for independent document counters "
                    "(uhid, opd, ipd, payment_slip, ipd_final_bill). Receipt uses invoice_next_number."
                ),
            ),
        ),
    ]
