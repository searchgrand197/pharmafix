from decimal import Decimal

from django.conf import settings
from django.db import models
from django.db.models import Sum
from django.utils import timezone

from apps.ipd.models import IPDAdmission
from apps.opd.models import OPDVisit
from apps.patients.models import Patient
from apps.shared.models import Hospital, SoftDeleteModel, TimeStampedModel, UUIDPrimaryKeyModel


class CollectionAttribution(models.TextChoices):
    DOCTOR = "doctor", "Doctor"
    HOSPITAL_SELF = "hospital_self", "Self (Hospital)"


class InvoiceNumberSequence(TimeStampedModel):
    """
    Invoice number sequence per hospital per year.
    """

    hospital = models.ForeignKey(Hospital, on_delete=models.PROTECT, related_name="invoice_sequences")
    year = models.PositiveIntegerField()
    last_seq = models.PositiveIntegerField(default=0)

    class Meta:
        unique_together = [("hospital", "year")]
        indexes = [models.Index(fields=["hospital", "year"])]


class IPDFinalBillSequence(TimeStampedModel):
    hospital = models.ForeignKey(Hospital, on_delete=models.CASCADE, related_name="ipd_final_bill_sequences")
    year = models.PositiveIntegerField()
    last_seq = models.PositiveIntegerField(default=0)

    class Meta:
        unique_together = [("hospital", "year")]
        indexes = [models.Index(fields=["hospital", "year"])]

    def __str__(self) -> str:
        return f"{self.hospital_id}-{self.year}-{self.last_seq}"


class BillingInvoice(SoftDeleteModel, TimeStampedModel, UUIDPrimaryKeyModel):
    class Status(models.TextChoices):
        DRAFT = "draft"
        FINALIZED = "finalized"
        CANCELLED = "cancelled"
        REFUNDED = "refunded"

    class EncounterType(models.TextChoices):
        OPD = "opd"
        IPD = "ipd"
        LAB = "lab"
        PHARMACY = "pharmacy"
        PACKAGE = "package"

    hospital = models.ForeignKey(Hospital, on_delete=models.PROTECT, related_name="invoices")
    invoice_no = models.CharField(max_length=60)

    encounter_type = models.CharField(max_length=20, choices=EncounterType.choices, default=EncounterType.OPD)

    patient = models.ForeignKey(Patient, on_delete=models.PROTECT, related_name="invoices")
    opd_visit = models.ForeignKey(OPDVisit, null=True, blank=True, on_delete=models.SET_NULL, related_name="invoices")
    ipd_admission = models.ForeignKey(
        IPDAdmission, null=True, blank=True, on_delete=models.SET_NULL, related_name="invoices"
    )

    invoice_date = models.DateField(default=timezone.now)
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.DRAFT, db_index=True)

    currency = models.CharField(max_length=10, default="INR")
    subtotal_amount = models.DecimalField(max_digits=12, decimal_places=2, default=Decimal("0.00"))
    discount_amount = models.DecimalField(max_digits=12, decimal_places=2, default=Decimal("0.00"))
    tax_rate = models.DecimalField(max_digits=5, decimal_places=2, default=Decimal("0.00"))
    tax_amount = models.DecimalField(max_digits=12, decimal_places=2, default=Decimal("0.00"))
    total_amount = models.DecimalField(max_digits=12, decimal_places=2, default=Decimal("0.00"))
    amount_paid = models.DecimalField(max_digits=12, decimal_places=2, default=Decimal("0.00"))

    cancelled_reason = models.CharField(max_length=500, blank=True, default="")
    cancelled_at = models.DateTimeField(null=True, blank=True)
    voided = models.BooleanField(default=False, db_index=True)

    attribution_type = models.CharField(
        max_length=20,
        choices=CollectionAttribution.choices,
        default=CollectionAttribution.HOSPITAL_SELF,
        db_index=True,
    )
    attributed_doctor_user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="attributed_invoices",
    )

    class Meta:
        unique_together = [("hospital", "invoice_no")]
        indexes = [models.Index(fields=["hospital", "invoice_date"]), models.Index(fields=["hospital", "status"])]

    def __str__(self) -> str:
        return self.invoice_no

    def recalc_totals(self):
        items_total = self.items.aggregate(t=Sum("line_total"))["t"] or Decimal("0.00")
        self.subtotal_amount = items_total
        taxable = self.subtotal_amount - self.discount_amount
        if taxable < 0:
            taxable = Decimal("0.00")
        self.tax_amount = (taxable * (self.tax_rate / Decimal("100.0")))
        self.total_amount = (taxable + self.tax_amount)


class InvoiceItem(TimeStampedModel, UUIDPrimaryKeyModel):
    invoice = models.ForeignKey(BillingInvoice, on_delete=models.CASCADE, related_name="items")
    description = models.CharField(max_length=300)
    category = models.CharField(max_length=120, default="", blank=True)
    subcategory = models.CharField(max_length=120, default="", blank=True)

    quantity = models.DecimalField(max_digits=10, decimal_places=2, default=Decimal("1.00"))
    unit_price = models.DecimalField(max_digits=12, decimal_places=2, default=Decimal("0.00"))
    line_total = models.DecimalField(max_digits=12, decimal_places=2, default=Decimal("0.00"))

    class Meta:
        indexes = [models.Index(fields=["invoice", "description"])]

    def __str__(self) -> str:
        return self.description


class IPDFinalBill(TimeStampedModel, UUIDPrimaryKeyModel):
    # Editable in Django admin (overrides TimeStampedModel.editable=False).
    created_at = models.DateTimeField(default=timezone.now)

    admission = models.OneToOneField(IPDAdmission, on_delete=models.PROTECT, related_name="final_bill")
    hospital = models.ForeignKey(Hospital, on_delete=models.PROTECT, related_name="ipd_final_bills")
    patient = models.ForeignKey(Patient, on_delete=models.PROTECT, related_name="ipd_final_bills")
    bill_no = models.CharField(max_length=60, blank=True)

    patient_name = models.CharField(max_length=300, blank=True)
    guardian_name = models.CharField(max_length=300, blank=True)
    patient_phone = models.CharField(max_length=30, blank=True)
    patient_address = models.TextField(blank=True)
    consultant_name = models.CharField(max_length=200, blank=True)
    room_bed = models.CharField(max_length=100, blank=True)
    scheme_name = models.CharField(max_length=200, blank=True)
    admission_date = models.DateTimeField(null=True, blank=True)
    discharge_date = models.DateTimeField(null=True, blank=True)

    gross_amount = models.DecimalField(max_digits=12, decimal_places=2, default=Decimal("0.00"))
    discount_amount = models.DecimalField(max_digits=12, decimal_places=2, default=Decimal("0.00"))
    net_amount = models.DecimalField(max_digits=12, decimal_places=2, default=Decimal("0.00"))
    amount_paid = models.DecimalField(max_digits=12, decimal_places=2, default=Decimal("0.00"))
    due_amount = models.DecimalField(max_digits=12, decimal_places=2, default=Decimal("0.00"))

    notes = models.TextField(blank=True)

    class Meta:
        indexes = [models.Index(fields=["hospital", "bill_no"]), models.Index(fields=["patient", "created_at"])]

    def __str__(self) -> str:
        return f"Final Bill {self.bill_no or self.id} - {self.patient_name}"


class IPDFinalBillItem(TimeStampedModel, UUIDPrimaryKeyModel):
    final_bill = models.ForeignKey(IPDFinalBill, on_delete=models.CASCADE, related_name="items")
    description = models.CharField(max_length=300)
    category = models.CharField(max_length=120, blank=True)
    quantity = models.DecimalField(max_digits=10, decimal_places=2, default=Decimal("1.00"))
    rate = models.DecimalField(max_digits=12, decimal_places=2, default=Decimal("0.00"))
    amount = models.DecimalField(max_digits=12, decimal_places=2, default=Decimal("0.00"))

    class Meta:
        indexes = [models.Index(fields=["final_bill", "description"])]

    def __str__(self) -> str:
        return f"{self.description} - {self.amount}"


class DailyClosingSummary(TimeStampedModel, UUIDPrimaryKeyModel):
    hospital = models.ForeignKey(Hospital, on_delete=models.PROTECT, related_name="daily_closings")
    closing_date = models.DateField()

    total_collected = models.DecimalField(max_digits=12, decimal_places=2, default=Decimal("0.00"))
    total_invoiced = models.DecimalField(max_digits=12, decimal_places=2, default=Decimal("0.00"))
    total_outstanding = models.DecimalField(max_digits=12, decimal_places=2, default=Decimal("0.00"))

    class Meta:
        unique_together = [("hospital", "closing_date")]


# ── Admin-only proxy models (same table, separate admin lists; no schema change) ──


class IPDAdvanceInvoice(BillingInvoice):
    class Meta:
        proxy = True
        verbose_name = "IPD Advance Bill"
        verbose_name_plural = "IPD Advance Bills"


class IPDServiceInvoice(BillingInvoice):
    class Meta:
        proxy = True
        verbose_name = "IPD Service Bill"
        verbose_name_plural = "IPD Service Bills"


class IPDRoomInvoice(BillingInvoice):
    class Meta:
        proxy = True
        verbose_name = "IPD Room Bill"
        verbose_name_plural = "IPD Room Bills"


class IPDRefundInvoice(BillingInvoice):
    class Meta:
        proxy = True
        verbose_name = "IPD Refund Bill"
        verbose_name_plural = "IPD Refund Bills"


class OPDBillingInvoice(BillingInvoice):
    class Meta:
        proxy = True
        verbose_name = "OPD Bill"
        verbose_name_plural = "OPD Bills"


class OtherBillingInvoice(BillingInvoice):
    class Meta:
        proxy = True
        verbose_name = "Other Bill"
        verbose_name_plural = "Other Bills"

