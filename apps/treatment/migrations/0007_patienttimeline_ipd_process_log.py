import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("ipd", "0009_ipddailyprocesslog"),
        ("treatment", "0006_rename_treatment_t_hospita_5d87d0_idx_treatment_t_hospita_7501dd_idx"),
    ]

    operations = [
        migrations.AddField(
            model_name="patienttimeline",
            name="ipd_process_log",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="timeline_events",
                to="ipd.ipddailyprocesslog",
            ),
        ),
        migrations.AlterField(
            model_name="patienttimeline",
            name="event_type",
            field=models.CharField(
                choices=[
                    ("plan_saved", "Treatment Plan Saved"),
                    ("treatment_done", "Treatment Done"),
                    ("treatment_skipped", "Treatment Skipped"),
                    ("process_log_saved", "IPD Process Log Saved"),
                ],
                db_index=True,
                max_length=30,
            ),
        ),
    ]
