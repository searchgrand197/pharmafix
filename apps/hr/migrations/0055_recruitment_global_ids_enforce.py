# Generated manually — enforce NOT NULL and uniqueness after backfill.

from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ('hr', '0054_recruitment_global_ids'),
    ]

    operations = [
        migrations.AlterField(
            model_name='candidate',
            name='application_code',
            field=models.CharField(db_index=True, max_length=20, unique=True),
        ),
        migrations.AlterField(
            model_name='candidate',
            name='profile',
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.PROTECT,
                related_name='applications',
                to='hr.candidateprofile',
            ),
        ),
        migrations.AddConstraint(
            model_name='candidate',
            constraint=models.UniqueConstraint(
                fields=('job_opening', 'profile'),
                name='unique_job_application_per_profile',
            ),
        ),
        migrations.AddConstraint(
            model_name='candidateprofile',
            constraint=models.UniqueConstraint(
                condition=models.Q(('email__gt', '')),
                fields=('hospital', 'email'),
                name='unique_candidate_profile_email_per_hospital',
            ),
        ),
    ]
