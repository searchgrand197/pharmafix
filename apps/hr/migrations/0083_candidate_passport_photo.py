from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('hr', '0082_attendance_finalization'),
    ]

    operations = [
        migrations.AddField(
            model_name='candidate',
            name='passport_photo',
            field=models.FileField(
                blank=True,
                help_text='Optional passport-size photo uploaded with the job application.',
                null=True,
                upload_to='candidate_photos/',
            ),
        ),
    ]
