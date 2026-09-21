from decimal import Decimal

from django.conf import settings
from django.db import models, transaction
from django.utils import timezone

from apps.settings_management.document_number_service import render_document_number
from apps.shared.models import Hospital, SoftDeleteModel, TimeStampedModel, UUIDPrimaryKeyModel


class ExpenseSlipSequence(TimeStampedModel):
    hospital = models.ForeignKey(Hospital, on_delete=models.CASCADE, related_name="expense_slip_sequences")
    year = models.PositiveIntegerField()
    last_seq = models.PositiveIntegerField(default=0)

    class Meta:
        unique_together = [("hospital", "year")]

    def __str__(self) -> str:
        return f"{self.hospital_id}-{self.year}-{self.last_seq}"


class ExpenseTransaction(SoftDeleteModel, TimeStampedModel, UUIDPrimaryKeyModel):
    class PaymentMode(models.TextChoices):
        CASH = "cash"
        CARD = "card"
        UPI = "upi"
        BANK_TRANSFER = "bank_transfer"
        OTHER = "other"

    class Status(models.TextChoices):
        SUCCESS = "success"
        CANCELLED = "cancelled"

    class Source(models.TextChoices):
        COLLECTION = "collection", "Collection"
        OTHER_FUNDS = "other_funds", "Other Funds"

    hospital = models.ForeignKey(Hospital, on_delete=models.PROTECT, related_name="expenses")
    recorded_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="recorded_expenses",
    )

    slip_number = models.CharField(max_length=80, unique=True, db_index=True, blank=True, default="")
    paid_at = models.DateTimeField(default=timezone.now, db_index=True)
    paid_to = models.CharField(max_length=200)
    payment_mode = models.CharField(max_length=30, choices=PaymentMode.choices)
    remarks = models.CharField(max_length=500, blank=True, default="")

    subtotal = models.DecimalField(max_digits=12, decimal_places=2, default=Decimal("0.00"))
    discount_amount = models.DecimalField(max_digits=12, decimal_places=2, default=Decimal("0.00"))
    total_amount = models.DecimalField(max_digits=12, decimal_places=2, default=Decimal("0.00"))

    voided = models.BooleanField(default=False, db_index=True)
    void_reason = models.CharField(max_length=500, blank=True, default="")
    voided_at = models.DateTimeField(null=True, blank=True)
    voided_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="voided_expenses",
    )
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.SUCCESS, db_index=True)
    source = models.CharField(max_length=20, choices=Source.choices, default=Source.COLLECTION, db_index=True)

    @staticmethod
    def _build_slip_number(hospital, year: int, seq: int) -> str:
        return render_document_number(hospital, "expense_voucher", year, seq)

    def _generate_slip_number(self) -> str:
        if not self.hospital_id:
            return ""
        now = self.paid_at or timezone.now()
        year = now.year
        with transaction.atomic():
            seq_obj, _ = ExpenseSlipSequence.objects.select_for_update().get_or_create(
                hospital_id=self.hospital_id,
                year=year,
            )
            hospital = getattr(self, "hospital", None) or Hospital.objects.only("id", "slug", "name").get(
                id=self.hospital_id
            )
            for _ in range(50):
                seq_obj.last_seq += 1
                seq_obj.save(update_fields=["last_seq", "updated_at"])
                candidate = self._build_slip_number(hospital, year, seq_obj.last_seq)
                holder = (
                    ExpenseTransaction.objects.select_for_update()
                    .filter(slip_number=candidate)
                    .first()
                )
                if holder is None:
                    return candidate
                if holder.voided:
                    tombstone = f"VOID-{holder.id}"[:80]
                    if holder.slip_number != tombstone:
                        holder.slip_number = tombstone
                        holder.save(update_fields=["slip_number", "updated_at"])
                    return candidate
            raise ValueError("Unable to allocate a unique expense voucher number.")

    def save(self, *args, **kwargs):
        if not self.slip_number:
            self.slip_number = self._generate_slip_number()
        super().save(*args, **kwargs)

    def __str__(self) -> str:
        return f"{self.slip_number} - {self.paid_to} ({self.total_amount})"


class ExpenseLineItem(TimeStampedModel, UUIDPrimaryKeyModel):
    expense = models.ForeignKey(ExpenseTransaction, on_delete=models.CASCADE, related_name="items")
    description = models.CharField(max_length=300)
    category = models.CharField(max_length=120, blank=True, default="")
    quantity = models.DecimalField(max_digits=10, decimal_places=2, default=Decimal("1.00"))
    unit_price = models.DecimalField(max_digits=12, decimal_places=2, default=Decimal("0.00"))
    line_total = models.DecimalField(max_digits=12, decimal_places=2, default=Decimal("0.00"))

    class Meta:
        ordering = ["created_at"]

    def __str__(self) -> str:
        return f"{self.description} ({self.line_total})"


class ExpenseQuickService(TimeStampedModel, UUIDPrimaryKeyModel):
    hospital = models.ForeignKey(Hospital, on_delete=models.PROTECT, related_name="expense_quick_services")
    label = models.CharField(max_length=120)
    category = models.CharField(max_length=80, default="Custom", db_index=True)
    price = models.DecimalField(max_digits=12, decimal_places=2, default=Decimal("0.00"))
    sort_order = models.PositiveIntegerField(default=0)
    is_active = models.BooleanField(default=True, db_index=True)

    class Meta:
        indexes = [
            models.Index(fields=["hospital", "is_active", "category", "sort_order"]),
            models.Index(fields=["hospital", "label"]),
        ]
        ordering = ["sort_order", "created_at"]

    def __str__(self) -> str:
        return f"{self.label} ({self.price})"


class ExpenseQuickCategory(TimeStampedModel, UUIDPrimaryKeyModel):
    hospital = models.ForeignKey(Hospital, on_delete=models.PROTECT, related_name="expense_quick_categories")
    name = models.CharField(max_length=80)
    sort_order = models.PositiveIntegerField(default=0)
    is_active = models.BooleanField(default=True, db_index=True)

    class Meta:
        indexes = [
            models.Index(fields=["hospital", "is_active", "sort_order"]),
            models.Index(fields=["hospital", "name"]),
        ]
        ordering = ["sort_order", "created_at"]

    def __str__(self) -> str:
        return self.name


class ExpenseParty(TimeStampedModel, UUIDPrimaryKeyModel):
    hospital = models.ForeignKey(Hospital, on_delete=models.PROTECT, related_name="expense_parties")
    name = models.CharField(max_length=200, db_index=True)
    phone = models.CharField(max_length=30, blank=True, default="")
    is_active = models.BooleanField(default=True, db_index=True)

    class Meta:
        indexes = [
            models.Index(fields=["hospital", "is_active", "name"]),
        ]
        ordering = ["name", "created_at"]
        constraints = [
            models.UniqueConstraint(
                fields=["hospital", "name"],
                name="expenses_expenseparty_unique_hospital_name",
            ),
        ]

    def __str__(self) -> str:
        return self.name
