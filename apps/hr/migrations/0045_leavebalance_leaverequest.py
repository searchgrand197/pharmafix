from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion
import django.utils.timezone
import uuid


class Migration(migrations.Migration):

    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
        ("hr", "0044_attendancepunch_system_source"),
    ]

    operations = [
        migrations.CreateModel(
            name="LeaveBalance",
            fields=[
                ("created_at", models.DateTimeField(default=django.utils.timezone.now, editable=False)),
                ("updated_at", models.DateTimeField(default=django.utils.timezone.now)),
                ("id", models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ("total_days", models.DecimalField(decimal_places=2, default=0, max_digits=6)),
                ("used_days", models.DecimalField(decimal_places=2, default=0, max_digits=6)),
                ("remaining_days", models.DecimalField(decimal_places=2, default=0, max_digits=6)),
                (
                    "employee",
                    models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="leave_balances", to="hr.employee"),
                ),
                (
                    "leave_type",
                    models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="balances", to="hr.leavetype"),
                ),
            ],
            options={
                "ordering": ["employee__name", "leave_type__name"],
            },
        ),
        migrations.CreateModel(
            name="LeaveRequest",
            fields=[
                ("created_at", models.DateTimeField(default=django.utils.timezone.now, editable=False)),
                ("updated_at", models.DateTimeField(default=django.utils.timezone.now)),
                ("id", models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ("start_date", models.DateField()),
                ("end_date", models.DateField()),
                ("number_of_days", models.DecimalField(decimal_places=2, max_digits=6)),
                ("reason", models.TextField(blank=True, default="")),
                (
                    "status",
                    models.CharField(
                        choices=[
                            ("PENDING", "Pending"),
                            ("APPROVED", "Approved"),
                            ("REJECTED", "Rejected"),
                            ("CANCELLED", "Cancelled"),
                        ],
                        db_index=True,
                        default="PENDING",
                        max_length=20,
                    ),
                ),
                ("applied_on", models.DateTimeField(auto_now_add=True)),
                ("reviewed_on", models.DateTimeField(blank=True, null=True)),
                ("remarks", models.TextField(blank=True, default="")),
                ("notification_events", models.JSONField(blank=True, default=list)),
                (
                    "applied_by",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="leave_requests_applied",
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
                (
                    "employee",
                    models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name="leave_requests", to="hr.employee"),
                ),
                (
                    "leave_type",
                    models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name="leave_requests", to="hr.leavetype"),
                ),
                (
                    "reviewed_by",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="leave_requests_reviewed",
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
            ],
            options={
                "ordering": ["-applied_on"],
            },
        ),
        migrations.AddConstraint(
            model_name="leavebalance",
            constraint=models.UniqueConstraint(fields=("employee", "leave_type"), name="unique_leave_balance_per_employee_type"),
        ),
        migrations.AddIndex(
            model_name="leavebalance",
            index=models.Index(fields=["employee", "leave_type"], name="hr_leavebal_employe_ead70e_idx"),
        ),
        migrations.AddIndex(
            model_name="leaverequest",
            index=models.Index(fields=["employee", "status"], name="hr_leavereq_employe_1b7929_idx"),
        ),
        migrations.AddIndex(
            model_name="leaverequest",
            index=models.Index(fields=["start_date", "end_date"], name="hr_leavereq_start_d_9e9e54_idx"),
        ),
        migrations.AddIndex(
            model_name="leaverequest",
            index=models.Index(fields=["status", "applied_on"], name="hr_leavereq_status_0a80c6_idx"),
        ),
    ]
