from decimal import Decimal

from django.conf import settings
from django.db import models
from django.utils import timezone

from apps.shared.models import Hospital, TimeStampedModel, UUIDPrimaryKeyModel


class Unit(TimeStampedModel, UUIDPrimaryKeyModel):
    pharmacy = models.ForeignKey("pharmacy.Pharmacy", on_delete=models.PROTECT, related_name="units")
    code = models.CharField(max_length=20)
    name = models.CharField(max_length=100)
    is_active = models.BooleanField(default=True)

    class Meta:
        unique_together = [("pharmacy", "code")]
        indexes = [models.Index(fields=["pharmacy", "name"])]

    def __str__(self) -> str:
        return self.name


class Medicine(TimeStampedModel, UUIDPrimaryKeyModel):
    pharmacy = models.ForeignKey("pharmacy.Pharmacy", on_delete=models.PROTECT, related_name="medicines")
    sku = models.CharField(max_length=80)
    name = models.CharField(max_length=250, help_text="Internal nickname for pharmacy staff.")
    name_on_bill = models.CharField(
        max_length=250,
        blank=True,
        default="",
        help_text="Optional print name on customer invoice; falls back to nickname.",
    )
    company_name = models.CharField(max_length=200, blank=True, default="")
    form = models.CharField(max_length=100, blank=True, default="")
    category = models.ForeignKey(
        "MedicineCategory",
        on_delete=models.PROTECT,
        related_name="medicines",
        null=True,
        blank=True,
    )
    composition = models.CharField(max_length=250, blank=True, default="")
    strength = models.CharField(max_length=100, blank=True, default="")
    unit = models.ForeignKey(Unit, on_delete=models.PROTECT, related_name="medicines")
    hsn_code = models.CharField(max_length=20, blank=True, default="")
    pack_info = models.CharField(max_length=50, blank=True, default="") # e.g. 10x15
    default_mrp = models.DecimalField(max_digits=12, decimal_places=2, default=Decimal("0.00"))
    # Maps pack label (strip, box, carton) to number of base units (e.g. tablets) in that pack.
    unit_conversions = models.JSONField(default=dict, blank=True)
    gst_percent = models.DecimalField(max_digits=5, decimal_places=2, default=Decimal("5.00"))
    is_active = models.BooleanField(default=True)

    class Meta:
        unique_together = [("pharmacy", "sku")]
        indexes = [models.Index(fields=["pharmacy", "name"])]

    def __str__(self) -> str:
        return self.name


class MedicineCategory(TimeStampedModel, UUIDPrimaryKeyModel):
    class RuleType(models.TextChoices):
        STRIP_BASED = "strip_based", "Strip-based (allow loose)"
        LIQUID = "liquid", "Liquid (no loose)"
        FLEXIBLE = "flexible", "Flexible (outer + retail + base)"
        UNIT_ONLY = "unit_only", "Unit only"

    pharmacy = models.ForeignKey("pharmacy.Pharmacy", on_delete=models.PROTECT, related_name="medicine_categories")
    name = models.CharField(max_length=120)
    color = models.CharField(max_length=7, blank=True, default="")
    parent = models.ForeignKey(
        "self",
        on_delete=models.PROTECT,
        related_name="subcategories",
        null=True,
        blank=True,
    )
    is_active = models.BooleanField(default=True)
    rule_type = models.CharField(
        max_length=20,
        choices=RuleType.choices,
        default=RuleType.UNIT_ONLY,
        db_index=True,
    )
    allow_loose_sale = models.BooleanField(default=True)
    base_unit_label = models.CharField(max_length=40, default="unit")
    retail_pack_label = models.CharField(max_length=40, blank=True, default="")
    outer_pack_label = models.CharField(max_length=40, blank=True, default="")

    class Meta:
        unique_together = [("pharmacy", "parent", "name")]
        indexes = [
            models.Index(fields=["pharmacy", "name"]),
            models.Index(fields=["pharmacy", "parent"], name="inventory_m_pharmac_parent_idx"),
        ]

    def __str__(self) -> str:
        return self.name


class MedicineReorderRule(TimeStampedModel, UUIDPrimaryKeyModel):
    pharmacy = models.ForeignKey("pharmacy.Pharmacy", on_delete=models.PROTECT, related_name="reorder_rules")
    medicine = models.ForeignKey(Medicine, on_delete=models.PROTECT, related_name="reorder_rules")
    reorder_level = models.DecimalField(max_digits=12, decimal_places=3, default=Decimal("0"))
    is_active = models.BooleanField(default=True)

    class Meta:
        unique_together = [("pharmacy", "medicine")]


class MedicineBatch(TimeStampedModel, UUIDPrimaryKeyModel):
    pharmacy = models.ForeignKey("pharmacy.Pharmacy", on_delete=models.PROTECT, related_name="batches")
    medicine = models.ForeignKey(Medicine, on_delete=models.PROTECT, related_name="batches")
    batch_no = models.CharField(max_length=80)
    expiry_date = models.DateField(db_index=True, null=True, blank=True)
    mfg_date = models.DateField(null=True, blank=True)

    # Track current cost/price defaults; the pharmacy can use its own pricing.
    unit_cost = models.DecimalField(max_digits=12, decimal_places=2, default=Decimal("0.00")) # Purchase Rate
    mrp = models.DecimalField(max_digits=12, decimal_places=2, default=Decimal("0.00"))
    sale_rate = models.DecimalField(max_digits=12, decimal_places=2, default=Decimal("0.00")) # Standard Sale Rate

    # Manual hold (recall / damage / quarantine): batch stays in inventory but cannot be billed.
    is_sale_blocked = models.BooleanField(default=False)
    sale_block_reason = models.CharField(max_length=120, blank=True, default="")

    class Meta:
        unique_together = [("pharmacy", "medicine", "batch_no")]
        indexes = [models.Index(fields=["pharmacy", "medicine", "expiry_date"])]

    def __str__(self) -> str:
        return f"{self.medicine_id} - {self.batch_no}"


class StockLedger(TimeStampedModel, UUIDPrimaryKeyModel):
    class Reason(models.TextChoices):
        STOCK_IN = "stock_in"
        DISPENSE_OUT = "dispense_out"
        RETURN_IN = "return_in"
        ADJUST = "adjust"

    pharmacy = models.ForeignKey("pharmacy.Pharmacy", on_delete=models.PROTECT, related_name="stock_ledger")
    medicine = models.ForeignKey(Medicine, on_delete=models.PROTECT, related_name="ledger_entries")
    batch = models.ForeignKey(MedicineBatch, on_delete=models.PROTECT, related_name="ledger_entries")

    qty_change = models.DecimalField(max_digits=12, decimal_places=3)
    reason = models.CharField(max_length=30, choices=Reason.choices)

    reference_type = models.CharField(max_length=50, blank=True, default="")
    reference_id = models.CharField(max_length=100, blank=True, default="")

    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="stock_ledger_entries"
    )
    created_at = models.DateTimeField(default=timezone.now, editable=False)

    class Meta:
        indexes = [models.Index(fields=["pharmacy", "medicine", "batch"])]

    def __str__(self) -> str:
        return f"{self.medicine_id} {self.batch_id} {self.qty_change}"

