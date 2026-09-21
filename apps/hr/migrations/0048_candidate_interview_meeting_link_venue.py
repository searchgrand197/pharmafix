from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("hr", "0047_offerlettersettings"),
    ]

    operations = [
        migrations.AddField(
            model_name="candidate",
            name="interview_meeting_link",
            field=models.URLField(blank=True, default="", max_length=2000),
        ),
        migrations.AddField(
            model_name="candidate",
            name="interview_venue_address",
            field=models.TextField(blank=True, default=""),
        ),
    ]
