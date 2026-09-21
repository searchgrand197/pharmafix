from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('hr', '0064_attendance_in_progress_missing_checkout'),
    ]

    operations = [
        migrations.AddField(
            model_name='leaverequest',
            name='attachment',
            field=models.FileField(
                blank=True,
                help_text='Optional supporting document for leave application.',
                null=True,
                upload_to='leave_requests/%Y/%m/',
            ),
        ),
    ]
