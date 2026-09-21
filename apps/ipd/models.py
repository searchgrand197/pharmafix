from django.conf import settings
from django.db import models, transaction
from django.utils import timezone

from apps.opd.models import OPDVisit
from apps.patients.models import Patient
from apps.settings_management.document_number_service import render_document_number
from apps.shared.models import Hospital, SoftDeleteModel, TimeStampedModel, UUIDPrimaryKeyModel


class Scheme(SoftDeleteModel, TimeStampedModel, UUIDPrimaryKeyModel):
    hospital = models.ForeignKey(Hospital, on_delete=models.PROTECT, related_name="schemes")
    name = models.CharField(max_length=255)
    description = models.TextField(blank=True, default="")
    is_active = models.BooleanField(default=True)

    class Meta:
        ordering = ["name"]
        constraints = [
            models.UniqueConstraint(
                fields=["hospital", "name"],
                condition=models.Q(is_deleted=False),
                name="scheme_hospital_active_name_uniq",
            ),
        ]

    def __str__(self) -> str:
        return self.name


class IPDAdmissionSequence(TimeStampedModel):
    hospital = models.ForeignKey(Hospital, on_delete=models.CASCADE, related_name="ipd_admission_sequences")
    year = models.PositiveIntegerField()
    last_seq = models.PositiveIntegerField(default=0)

    class Meta:
        unique_together = [("hospital", "year")]

    def __str__(self) -> str:
        return f"{self.hospital_id}-{self.year}-{self.last_seq}"


class IPDAdmission(SoftDeleteModel, TimeStampedModel, UUIDPrimaryKeyModel):
    class Status(models.TextChoices):
        ADMITTED = "admitted"
        TRANSFERRED = "transferred"
        DISCHARGED = "discharged"
        CANCELLED = "cancelled"

    hospital = models.ForeignKey(Hospital, on_delete=models.PROTECT, related_name="ipd_admissions")
    patient = models.ForeignKey(Patient, on_delete=models.PROTECT, related_name="ipd_admissions")

    opd_visit = models.ForeignKey(
        OPDVisit, null=True, blank=True, on_delete=models.SET_NULL, related_name="ipd_conversions"
    )

    admission_date = models.DateField()
    admission_time = models.TimeField(null=True, blank=True)
    expected_discharge_date = models.DateField(null=True, blank=True)

    assigned_doctor = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="ipd_admissions_as_doctor",
    )
    assigned_nurse = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="ipd_admissions_as_nurse",
    )

    ward_name = models.CharField(max_length=200, blank=True, default="")
    department = models.CharField(max_length=120, blank=True, default="")
    room_name = models.CharField(max_length=200, blank=True, default="")
    bed_code = models.CharField(max_length=100, blank=True, default="")

    admission_diagnosis = models.TextField(blank=True, default="")
    admission_notes = models.TextField(blank=True, default="")

    status = models.CharField(max_length=20, choices=Status.choices, default=Status.ADMITTED, db_index=True)

    discharged_at = models.DateTimeField(null=True, blank=True)
    discharge_notes = models.TextField(blank=True, default="")
    ipd_no = models.CharField(max_length=50, unique=True, blank=True, null=True, db_index=True)

    scheme = models.ForeignKey(
        Scheme,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="admissions",
    )

    # When set, ledger room rent uses this total instead of bed daily_charge × days.
    room_rent_override = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    # When set, ledger room rent = this per-day rate × stay days (preferred over room_rent_override).
    room_rent_daily_charge_override = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    # Custom label for the room rent line on IPD ledger / bill (optional).
    room_rent_description_override = models.CharField(max_length=300, blank=True, default="")
    # When set, ledger room rent uses this day count instead of admission-date span.
    room_rent_days_override = models.PositiveIntegerField(null=True, blank=True)

    class Meta:
        indexes = [
            models.Index(fields=["hospital", "admission_date"]),
            models.Index(fields=["hospital", "assigned_doctor", "admission_date"]),
            models.Index(fields=["patient", "admission_date"]),
        ]

    def __str__(self) -> str:
        return f"IPD {self.ipd_no or self.id} ({self.admission_date})"

    def generate_ipd_no(self):
        if self.ipd_no:
            return self.ipd_no
        
        now = timezone.now()
        year = now.year
        
        with transaction.atomic():
            seq_obj, _ = IPDAdmissionSequence.objects.select_for_update().get_or_create(
                hospital=self.hospital,
                year=year
            )
            seq_obj.last_seq += 1
            seq_obj.save(update_fields=["last_seq", "updated_at"])
            
            return render_document_number(self.hospital, "ipd", year, seq_obj.last_seq)

    def save(self, *args, **kwargs):
        if not self.ipd_no:
            self.ipd_no = self.generate_ipd_no()
        super().save(*args, **kwargs)


class IPDAdmissionStatusHistory(TimeStampedModel, UUIDPrimaryKeyModel):
    admission = models.ForeignKey(IPDAdmission, on_delete=models.CASCADE, related_name="status_history")
    from_status = models.CharField(max_length=20)
    to_status = models.CharField(max_length=20)
    changed_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT)
    notes = models.TextField(blank=True, default="")

    class Meta:
        indexes = [models.Index(fields=["admission", "to_status"])]


class IPDTransferHistory(TimeStampedModel, UUIDPrimaryKeyModel):
    admission = models.ForeignKey(IPDAdmission, on_delete=models.CASCADE, related_name="transfer_history")

    from_ward_name = models.CharField(max_length=200, blank=True, default="")
    to_ward_name = models.CharField(max_length=200, blank=True, default="")
    from_room_name = models.CharField(max_length=200, blank=True, default="")
    to_room_name = models.CharField(max_length=200, blank=True, default="")
    from_bed_code = models.CharField(max_length=100, blank=True, default="")
    to_bed_code = models.CharField(max_length=100, blank=True, default="")

    changed_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT)
    notes = models.TextField(blank=True, default="")


class IPDDailyProcessLog(TimeStampedModel, UUIDPrimaryKeyModel):
    """One structured daily process log per IPD admission per calendar date."""

    admission = models.ForeignKey(IPDAdmission, on_delete=models.CASCADE, related_name="process_logs")
    hospital = models.ForeignKey(Hospital, on_delete=models.PROTECT, related_name="ipd_process_logs")
    log_date = models.DateField(db_index=True)
    day_number = models.PositiveIntegerField(null=True, blank=True)

    vitals = models.JSONField(default=dict, blank=True)
    medication_procedure_notes = models.TextField(blank=True, default="")
    completed_notes = models.TextField(blank=True, default="")
    pending_notes = models.TextField(blank=True, default="")
    general_notes = models.TextField(blank=True, default="")
    custom_fields = models.JSONField(default=dict, blank=True)
    process_template_id = models.CharField(max_length=64, blank=True, default="")
    process_field_config = models.JSONField(default=dict, blank=True)

    recorded_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="ipd_process_logs_recorded",
    )

    class Meta:
        ordering = ["-log_date", "-created_at"]
        constraints = [
            models.UniqueConstraint(
                fields=["admission", "log_date"],
                name="ipd_unique_process_log_per_day",
            ),
        ]
        indexes = [
            models.Index(fields=["admission", "log_date"]),
            models.Index(fields=["hospital", "log_date"]),
        ]

    def __str__(self) -> str:
        return f"Process log {self.log_date} – {self.admission_id}"

