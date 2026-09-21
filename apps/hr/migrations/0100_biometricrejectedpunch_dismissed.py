# Generated manually for rejected-punch dismiss (acknowledge)

from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
        ('hr', '0099_leave_policy_departments_designations'),
    ]

    operations = [
        migrations.AddField(
            model_name='biometricrejectedpunch',
            name='dismissed_at',
            field=models.DateTimeField(blank=True, db_index=True, null=True),
        ),
        migrations.AddField(
            model_name='biometricrejectedpunch',
            name='dismissed_by',
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name='dismissed_biometric_rejected_punches',
                to=settings.AUTH_USER_MODEL,
            ),
        ),
        migrations.AddIndex(
            model_name='biometricrejectedpunch',
            index=models.Index(fields=['hospital', 'dismissed_at'], name='hr_biometri_hospita_d2f81a_idx'),
        ),
    ]
