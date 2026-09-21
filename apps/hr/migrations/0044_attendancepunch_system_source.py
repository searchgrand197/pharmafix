from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("hr", "0043_dailyattendance_incomplete_status"),
    ]

    operations = [
        migrations.AlterField(
            model_name="attendancepunch",
            name="source",
            field=models.CharField(
                choices=[
                    ("biometric", "Biometric"),
                    ("employee_portal", "Employee Portal"),
                    ("HR_manual", "HR Manual"),
                    ("import", "Import"),
                    ("system", "System"),
                ],
                default="import",
                max_length=30,
            ),
        ),
    ]
