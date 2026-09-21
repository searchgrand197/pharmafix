from decimal import Decimal, InvalidOperation
from django.conf import settings
from django.db import models
from apps.shared.models import Hospital, TimeStampedModel, UUIDPrimaryKeyModel
from apps.patients.models import Patient
from apps.doctors.models import DoctorProfile


class LabTestCategory(TimeStampedModel, UUIDPrimaryKeyModel):
    hospital = models.ForeignKey(Hospital, on_delete=models.PROTECT, related_name="lab_categories")
    name = models.CharField(max_length=100)

    def __str__(self):
        return self.name


class LabTest(TimeStampedModel, UUIDPrimaryKeyModel):
    hospital = models.ForeignKey(Hospital, on_delete=models.PROTECT, related_name="lab_tests")
    category = models.ForeignKey(LabTestCategory, on_delete=models.PROTECT, related_name="tests")
    name = models.CharField(max_length=200)
    code = models.CharField(max_length=50, blank=True, default="")
    # Kept for single-parameter tests that haven't migrated to LabTestParameter
    unit = models.CharField(max_length=50, blank=True, default="")
    reference_range = models.CharField(max_length=200, blank=True, default="")
    price = models.DecimalField(max_digits=12, decimal_places=2, default=0.00)
    is_group_test = models.BooleanField(default=False)
    procedure = models.TextField(blank=True, default="")
    is_active = models.BooleanField(default=True)
    # New fields
    sample_type = models.CharField(max_length=100, blank=True, default="")
    method = models.CharField(max_length=200, blank=True, default="")
    interpretation = models.TextField(blank=True, default="")
    department_label = models.CharField(max_length=150, blank=True, default="")

    def __str__(self):
        return f"{self.name} ({self.category.name})"


class LabTestParameter(TimeStampedModel, UUIDPrimaryKeyModel):
    """A single analyte row within a LabTest (panel or simple test)."""

    class ResultType(models.TextChoices):
        NUMERIC = "numeric", "Numeric"
        TEXT = "text", "Text"
        QUALITATIVE = "qualitative", "Qualitative"

    test = models.ForeignKey(LabTest, on_delete=models.CASCADE, related_name="parameters")
    name = models.CharField(max_length=200)
    code = models.CharField(max_length=50, blank=True, default="")
    unit = models.CharField(max_length=50, blank=True, default="")
    reference_range = models.CharField(max_length=200, blank=True, default="")
    ref_low = models.DecimalField(max_digits=14, decimal_places=4, null=True, blank=True)
    ref_high = models.DecimalField(max_digits=14, decimal_places=4, null=True, blank=True)
    method = models.CharField(max_length=200, blank=True, default="")
    section_title = models.CharField(max_length=200, blank=True, default="")
    sort_order = models.PositiveSmallIntegerField(default=0)
    result_type = models.CharField(max_length=20, choices=ResultType.choices, default=ResultType.NUMERIC)

    class Meta:
        ordering = ["sort_order", "name"]

    def __str__(self):
        return f"{self.test.name} > {self.name}"


class LabReport(TimeStampedModel, UUIDPrimaryKeyModel):
    class Status(models.TextChoices):
        DRAFT = "draft", "Draft"
        FINAL = "final", "Final"
        CANCELLED = "cancelled", "Cancelled"

    hospital = models.ForeignKey(Hospital, on_delete=models.PROTECT, related_name="lab_reports")
    patient = models.ForeignKey(Patient, on_delete=models.PROTECT, related_name="lab_reports")
    referred_by = models.ForeignKey(DoctorProfile, on_delete=models.SET_NULL, null=True, blank=True, related_name="lab_referrals")

    lab_no = models.CharField(max_length=50, unique=True)
    collected_at = models.DateTimeField(null=True, blank=True)
    received_at = models.DateTimeField(null=True, blank=True)
    reported_at = models.DateTimeField(null=True, blank=True)
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.DRAFT)

    validation_status = models.CharField(max_length=50, blank=True, default="Pending")
    notes = models.TextField(blank=True, default="")
    barcode_no = models.CharField(max_length=100, blank=True, default="")
    visit_id = models.CharField(max_length=100, blank=True, default="")
    processed_at_label = models.CharField(max_length=200, blank=True, default="")
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="created_lab_reports")

    def __str__(self):
        return f"Report {self.lab_no} - {self.patient.first_name}"


class LabTestResult(TimeStampedModel, UUIDPrimaryKeyModel):
    class Flag(models.TextChoices):
        NORMAL = "", "Normal"
        HIGH = "H", "High"
        LOW = "L", "Low"

    report = models.ForeignKey(LabReport, on_delete=models.CASCADE, related_name="results")
    test = models.ForeignKey(LabTest, on_delete=models.PROTECT, related_name="results")
    parameter = models.ForeignKey(
        LabTestParameter, on_delete=models.SET_NULL, null=True, blank=True, related_name="results"
    )
    result_value = models.CharField(max_length=200, blank=True, default="")
    is_abnormal = models.BooleanField(default=False)
    flag = models.CharField(max_length=2, choices=Flag.choices, default=Flag.NORMAL, blank=True)
    # Snapshots so report reflects values at time of entry
    unit_snapshot = models.CharField(max_length=50, blank=True, default="")
    reference_range_snapshot = models.CharField(max_length=200, blank=True, default="")
    method_snapshot = models.CharField(max_length=200, blank=True, default="")
    section_title_snapshot = models.CharField(max_length=200, blank=True, default="")
    sort_order_snapshot = models.PositiveSmallIntegerField(default=0)

    class Meta:
        ordering = ["sort_order_snapshot"]

    def _compute_flag(self):
        if not self.result_value:
            return ""
        param = self.parameter
        if not param:
            return ""
        try:
            val = Decimal(self.result_value)
        except InvalidOperation:
            return ""
        if param.ref_high is not None and val > param.ref_high:
            return "H"
        if param.ref_low is not None and val < param.ref_low:
            return "L"
        return ""

    def save(self, *args, **kwargs):
        # Snapshot parameter metadata on every save
        p = self.parameter
        if p:
            self.unit_snapshot = p.unit
            self.reference_range_snapshot = p.reference_range
            self.method_snapshot = p.method
            self.section_title_snapshot = p.section_title
            self.sort_order_snapshot = p.sort_order
        computed = self._compute_flag()
        self.flag = computed
        self.is_abnormal = bool(computed)
        super().save(*args, **kwargs)

    def __str__(self):
        return f"{self.parameter.name if self.parameter else self.test.name}: {self.result_value}"


class LabSettings(TimeStampedModel, UUIDPrimaryKeyModel):
    """Hospital-scoped lab letterhead / branding for printed reports."""

    hospital = models.OneToOneField(Hospital, on_delete=models.CASCADE, related_name="lab_settings")
    lab_name = models.CharField(max_length=200, blank=True, default="Clinical Laboratory")
    tagline = models.CharField(max_length=200, blank=True, default="")
    address = models.TextField(blank=True, default="")
    phone = models.CharField(max_length=40, blank=True, default="")
    email = models.CharField(max_length=120, blank=True, default="")
    website = models.CharField(max_length=200, blank=True, default="")
    gstin = models.CharField(max_length=40, blank=True, default="")
    nabl_reg_no = models.CharField(max_length=80, blank=True, default="")
    processed_at_label = models.CharField(max_length=200, blank=True, default="")
    pathologist_name = models.CharField(max_length=120, blank=True, default="")
    pathologist_qualification = models.CharField(max_length=120, blank=True, default="")
    pathologist_reg_no = models.CharField(max_length=80, blank=True, default="")
    footer_note = models.CharField(max_length=300, blank=True, default="")
    logo = models.ImageField(upload_to="lab/logos/", blank=True, null=True)
    signature = models.ImageField(upload_to="lab/signatures/", blank=True, null=True)
    watermark = models.ImageField(upload_to="lab/watermarks/", blank=True, null=True)
    watermark_enabled = models.BooleanField(default=False)
    watermark_source = models.CharField(
        max_length=20,
        default="logo",
        choices=(("logo", "Lab logo"), ("custom", "Custom image")),
    )
    watermark_opacity = models.PositiveSmallIntegerField(
        default=15,
        help_text="Watermark opacity percent (5–40).",
    )
    watermark_size = models.PositiveSmallIntegerField(
        default=55,
        help_text="Watermark size percent of page (20–90).",
    )
    watermark_rotation = models.SmallIntegerField(
        default=0,
        help_text="Watermark rotation in degrees (-90 to 90).",
    )
    # Visit ID auto-numbering (like UHID: PREFIX-0001)
    visit_id_prefix = models.CharField(max_length=20, blank=True, default="LABV")
    visit_id_next_number = models.PositiveIntegerField(default=1)
    visit_id_padding = models.PositiveSmallIntegerField(default=4)

    def __str__(self):
        return f"Lab settings ({self.hospital_id})"

    def peek_next_visit_id(self) -> str:
        prefix = (self.visit_id_prefix or "LABV").strip() or "LABV"
        n = max(1, int(self.visit_id_next_number or 1))
        pad = max(1, min(10, int(self.visit_id_padding or 4)))
        return f"{prefix}-{str(n).zfill(pad)}"
