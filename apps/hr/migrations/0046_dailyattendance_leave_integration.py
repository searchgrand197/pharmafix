from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ("hr", "0045_leavebalance_leaverequest"),
    ]

    operations = [
        migrations.AddField(
            model_name="dailyattendance",
            name="is_on_leave",
            field=models.BooleanField(db_index=True, default=False),
        ),
        migrations.AddField(
            model_name="dailyattendance",
            name="leave_request",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="daily_attendance",
                to="hr.leaverequest",
            ),
        ),
        migrations.AddField(
            model_name="dailyattendance",
            name="leave_type",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="daily_attendance",
                to="hr.leavetype",
            ),
        ),
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
                    ("leave", "On Leave"),
                    ("holiday", "Holiday"),
                    ("weekend", "Weekend"),
                    ("work_from_office", "Work From Office"),
                ],
                db_index=True,
                default="absent",
                max_length=30,
            ),
        ),
        migrations.AddIndex(
            model_name="dailyattendance",
            index=models.Index(fields=["date", "is_on_leave"], name="hr_dailyatt_date_7f2ca4_idx"),
        ),
    ]
