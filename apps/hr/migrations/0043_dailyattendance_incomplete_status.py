from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("hr", "0042_remove_attendancepunch_unique_attendance_punch_fingerprint_and_more"),
    ]

    operations = [
        migrations.AlterField(
            model_name="dailyattendance",
            name="attendance_status",
            field=models.CharField(
                choices=[
                    ("present", "Present"),
                    ("absent", "Absent"),
                    ("late", "Late"),
                    ("half_day", "Half Day"),
                    ("incomplete", "Incomplete"),
                    ("overtime", "Overtime"),
                    ("leave", "Leave"),
                    ("holiday", "Holiday"),
                    ("weekend", "Weekend"),
                    ("work_from_office", "Work From Office"),
                ],
                db_index=True,
                default="absent",
                max_length=30,
            ),
        ),
    ]
