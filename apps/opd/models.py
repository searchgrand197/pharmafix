from django.conf import settings
from django.db import models, transaction
from django.utils import timezone

from apps.patients.models import Patient
from apps.settings_management.document_number_service import render_document_number
from apps.shared.models import Hospital, SoftDeleteModel, TimeStampedModel, UUIDPrimaryKeyModel

class OPDVisitSequence(TimeStampedModel):
    hospital = models.ForeignKey(Hospital, on_delete=models.CASCADE, related_name="opd_visit_sequences")
    year = models.PositiveIntegerField()
    last_seq = models.PositiveIntegerField(default=0)

    class Meta:
        unique_together = [("hospital", "year")]

    def __str__(self) -> str:
        return f"{self.hospital_id}-{self.year}-{self.last_seq}"


class OPDPaymentSlipSequence(TimeStampedModel):
    hospital = models.ForeignKey(Hospital, on_delete=models.CASCADE, related_name="opd_payment_slip_sequences")
    year = models.PositiveIntegerField()
    last_seq = models.PositiveIntegerField(default=0)

    class Meta:
        unique_together = [("hospital", "year")]

    def __str__(self) -> str:
        return f"{self.hospital_id}-{self.year}-{self.last_seq}"


class OPDVisit(SoftDeleteModel, TimeStampedModel, UUIDPrimaryKeyModel):
    class Status(models.TextChoices):
        WAITING = "waiting"
        IN_PROGRESS = "in_progress"
        COMPLETED = "completed"
        SKIPPED = "skipped"
        CANCELLED = "cancelled"

    class PaymentMode(models.TextChoices):
        CASH = "cash", "Cash"
        UPI = "upi", "UPI"
        OTHER = "other", "Other"

    hospital = models.ForeignKey(Hospital, on_delete=models.PROTECT, related_name="opd_visits")
    patient = models.ForeignKey(Patient, on_delete=models.PROTECT, related_name="opd_visits")

    visit_date = models.DateField()
    queue_number = models.PositiveIntegerField(default=0, db_index=True)
    opd_no = models.CharField(max_length=50, unique=True, blank=True, null=True, db_index=True)

    doctor_user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="opd_visits_as_doctor",
    )

    department = models.CharField(max_length=120, blank=True, default="")

    visit_reason = models.TextField(blank=True, default="")
    symptoms = models.TextField(blank=True, default="")
    vitals = models.JSONField(default=dict, blank=True)

    consultation_notes = models.TextField(blank=True, default="")
    patient_notes = models.JSONField(default=list, blank=True)
    diagnosis = models.TextField(blank=True, default="")
    test_recommendations = models.TextField(blank=True, default="")
    revisit_advice = models.TextField(blank=True, default="")
    follow_up_date = models.DateField(null=True, blank=True, db_index=True)
    follow_up_completed = models.BooleanField(default=False, db_index=True)

    status = models.CharField(max_length=20, choices=Status.choices, default=Status.WAITING, db_index=True)
    amount = models.DecimalField(max_digits=10, decimal_places=2, null=True, blank=True)
    payment_mode = models.CharField(max_length=20, choices=PaymentMode.choices, default=PaymentMode.CASH, blank=True)

    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="opd_visits_created",
    )
    cancel_reason = models.TextField(blank=True, default="")
    cancelled_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="opd_visits_cancelled",
    )
    cancelled_at = models.DateTimeField(null=True, blank=True, db_index=True)
    voided = models.BooleanField(default=False, db_index=True)
    opd_payment_slip_no = models.CharField(max_length=80, unique=True, null=True, blank=True, db_index=True)

    class Meta:
        indexes = [
            models.Index(fields=["hospital", "visit_date"]),
            models.Index(fields=["hospital", "doctor_user", "visit_date"]),
            models.Index(fields=["hospital", "created_by", "visit_date"]),
            models.Index(fields=["patient", "visit_date"]),
        ]

    def __str__(self) -> str:
        return f"OPD {self.opd_no or self.id} ({self.visit_date})"

    def generate_opd_no(self):
        if self.opd_no:
            return self.opd_no
        
        now = timezone.now()
        year = now.year
        
        with transaction.atomic():
            seq_obj, _ = OPDVisitSequence.objects.select_for_update().get_or_create(
                hospital=self.hospital,
                year=year
            )
            seq_obj.last_seq += 1
            seq_obj.save(update_fields=["last_seq", "updated_at"])
            
            return render_document_number(self.hospital, "opd", year, seq_obj.last_seq)

    def save(self, *args, **kwargs):
        if not self.opd_no:
            self.opd_no = self.generate_opd_no()
        super().save(*args, **kwargs)

    def generate_opd_payment_slip_no(self) -> str:
        if self.opd_payment_slip_no:
            return self.opd_payment_slip_no
        now = timezone.now()
        year = now.year
        with transaction.atomic():
            seq_obj, _ = OPDPaymentSlipSequence.objects.select_for_update().get_or_create(
                hospital=self.hospital, year=year
            )
            hospital = self.hospital
            for _ in range(50):
                seq_obj.last_seq += 1
                seq_obj.save(update_fields=["last_seq", "updated_at"])
                candidate = render_document_number(hospital, "opd_payment_slip", year, seq_obj.last_seq)
                if not OPDVisit.objects.filter(opd_payment_slip_no=candidate).exists():
                    return candidate
        raise ValueError("Unable to allocate a unique OPD payment slip number.")


class OPDVisitStatusHistory(TimeStampedModel, UUIDPrimaryKeyModel):
    visit = models.ForeignKey(OPDVisit, on_delete=models.CASCADE, related_name="status_history")
    from_status = models.CharField(max_length=20)
    to_status = models.CharField(max_length=20)

    changed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="opd_status_changes",
    )

    notes = models.TextField(blank=True, default="")

