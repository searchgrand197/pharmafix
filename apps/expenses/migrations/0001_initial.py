# Generated manually for apps.expenses

import django.db.models.deletion
import django.utils.timezone
import uuid
from decimal import Decimal
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):

    initial = True

    dependencies = [
        ("shared", "0001_initial"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name="ExpenseSlipSequence",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("created_at", models.DateTimeField(default=django.utils.timezone.now, editable=False)),
                ("updated_at", models.DateTimeField(default=django.utils.timezone.now)),
                ("year", models.PositiveIntegerField()),
                ("last_seq", models.PositiveIntegerField(default=0)),
                (
                    "hospital",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="expense_slip_sequences",
                        to="shared.hospital",
                    ),
                ),
            ],
            options={
                "unique_together": {("hospital", "year")},
            },
        ),
        migrations.CreateModel(
            name="ExpenseTransaction",
            fields=[
                ("created_at", models.DateTimeField(default=django.utils.timezone.now, editable=False)),
                ("updated_at", models.DateTimeField(default=django.utils.timezone.now)),
                ("id", models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ("is_deleted", models.BooleanField(db_index=True, default=False)),
                ("deleted_at", models.DateTimeField(blank=True, null=True)),
                ("slip_number", models.CharField(blank=True, db_index=True, default="", max_length=80, unique=True)),
                ("paid_at", models.DateTimeField(db_index=True, default=django.utils.timezone.now)),
                ("paid_to", models.CharField(max_length=200)),
                (
                    "payment_mode",
                    models.CharField(
                        choices=[
                            ("cash", "Cash"),
                            ("card", "Card"),
                            ("upi", "Upi"),
                            ("bank_transfer", "Bank Transfer"),
                            ("other", "Other"),
                        ],
                        max_length=30,
                    ),
                ),
                ("remarks", models.CharField(blank=True, default="", max_length=500)),
                ("subtotal", models.DecimalField(decimal_places=2, default=Decimal("0.00"), max_digits=12)),
                ("discount_amount", models.DecimalField(decimal_places=2, default=Decimal("0.00"), max_digits=12)),
                ("total_amount", models.DecimalField(decimal_places=2, default=Decimal("0.00"), max_digits=12)),
                ("voided", models.BooleanField(db_index=True, default=False)),
                ("void_reason", models.CharField(blank=True, default="", max_length=500)),
                ("voided_at", models.DateTimeField(blank=True, null=True)),
                (
                    "status",
                    models.CharField(
                        choices=[("success", "Success"), ("cancelled", "Cancelled")],
                        db_index=True,
                        default="success",
                        max_length=20,
                    ),
                ),
                (
                    "hospital",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="expenses",
                        to="shared.hospital",
                    ),
                ),
                (
                    "recorded_by",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="recorded_expenses",
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
                (
                    "voided_by",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="voided_expenses",
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
            ],
            options={
                "abstract": False,
            },
        ),
        migrations.CreateModel(
            name="ExpenseQuickCategory",
            fields=[
                ("created_at", models.DateTimeField(default=django.utils.timezone.now, editable=False)),
                ("updated_at", models.DateTimeField(default=django.utils.timezone.now)),
                ("id", models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ("name", models.CharField(max_length=80)),
                ("sort_order", models.PositiveIntegerField(default=0)),
                ("is_active", models.BooleanField(db_index=True, default=True)),
                (
                    "hospital",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="expense_quick_categories",
                        to="shared.hospital",
                    ),
                ),
            ],
            options={
                "ordering": ["sort_order", "created_at"],
            },
        ),
        migrations.CreateModel(
            name="ExpenseQuickService",
            fields=[
                ("created_at", models.DateTimeField(default=django.utils.timezone.now, editable=False)),
                ("updated_at", models.DateTimeField(default=django.utils.timezone.now)),
                ("id", models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ("label", models.CharField(max_length=120)),
                ("category", models.CharField(db_index=True, default="Custom", max_length=80)),
                ("price", models.DecimalField(decimal_places=2, default=Decimal("0.00"), max_digits=12)),
                ("sort_order", models.PositiveIntegerField(default=0)),
                ("is_active", models.BooleanField(db_index=True, default=True)),
                (
                    "hospital",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="expense_quick_services",
                        to="shared.hospital",
                    ),
                ),
            ],
            options={
                "ordering": ["sort_order", "created_at"],
            },
        ),
        migrations.CreateModel(
            name="ExpenseLineItem",
            fields=[
                ("created_at", models.DateTimeField(default=django.utils.timezone.now, editable=False)),
                ("updated_at", models.DateTimeField(default=django.utils.timezone.now)),
                ("id", models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ("description", models.CharField(max_length=300)),
                ("category", models.CharField(blank=True, default="", max_length=120)),
                ("quantity", models.DecimalField(decimal_places=2, default=Decimal("1.00"), max_digits=10)),
                ("unit_price", models.DecimalField(decimal_places=2, default=Decimal("0.00"), max_digits=12)),
                ("line_total", models.DecimalField(decimal_places=2, default=Decimal("0.00"), max_digits=12)),
                (
                    "expense",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="items",
                        to="expenses.expensetransaction",
                    ),
                ),
            ],
            options={
                "ordering": ["created_at"],
            },
        ),
        migrations.AddIndex(
            model_name="expensequickservice",
            index=models.Index(fields=["hospital", "is_active", "category", "sort_order"], name="expenses_ex_hospita_idx"),
        ),
        migrations.AddIndex(
            model_name="expensequickservice",
            index=models.Index(fields=["hospital", "label"], name="expenses_ex_hospita_label_idx"),
        ),
        migrations.AddIndex(
            model_name="expensequickcategory",
            index=models.Index(fields=["hospital", "is_active", "sort_order"], name="expenses_ex_hospita_cat_idx"),
        ),
        migrations.AddIndex(
            model_name="expensequickcategory",
            index=models.Index(fields=["hospital", "name"], name="expenses_ex_hospita_name_idx"),
        ),
    ]
