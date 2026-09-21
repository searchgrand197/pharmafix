# Generated manually

import django.db.models.deletion
import django.utils.timezone
import uuid
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("expenses", "0001_initial"),
        ("shared", "0001_initial"),
    ]

    operations = [
        migrations.CreateModel(
            name="ExpenseParty",
            fields=[
                ("created_at", models.DateTimeField(default=django.utils.timezone.now, editable=False)),
                ("updated_at", models.DateTimeField(default=django.utils.timezone.now)),
                ("id", models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ("name", models.CharField(db_index=True, max_length=200)),
                ("phone", models.CharField(blank=True, default="", max_length=30)),
                ("is_active", models.BooleanField(db_index=True, default=True)),
                (
                    "hospital",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="expense_parties",
                        to="shared.hospital",
                    ),
                ),
            ],
            options={
                "ordering": ["name", "created_at"],
            },
        ),
        migrations.AddIndex(
            model_name="expenseparty",
            index=models.Index(fields=["hospital", "is_active", "name"], name="expenses_ex_party_idx"),
        ),
        migrations.AddConstraint(
            model_name="expenseparty",
            constraint=models.UniqueConstraint(
                fields=("hospital", "name"),
                name="expenses_expenseparty_unique_hospital_name",
            ),
        ),
    ]
