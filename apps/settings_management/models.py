from django.conf import settings
from django.db import models
from django.utils import timezone

from apps.shared.models import Hospital, TimeStampedModel, UUIDPrimaryKeyModel


class LeaveApprover(TimeStampedModel, UUIDPrimaryKeyModel):
    """
    Defines who is allowed to approve leave applications for a hospital.
    A hospital can have multiple approvers.
    """

    hospital = models.ForeignKey(
        Hospital,
        on_delete=models.CASCADE,
        related_name="leave_approvers",
    )
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="leave_approver_hospitals",
        help_text="User who is permitted to approve leave requests for this hospital.",
    )
    is_active = models.BooleanField(
        default=True,
        help_text="Uncheck to temporarily suspend this approver without deleting the record.",
    )
    notes = models.TextField(
        blank=True,
        default="",
        help_text="Optional note (e.g. 'HR Manager', 'Backup approver').",
    )

    class Meta:
        unique_together = [("hospital", "user")]
        verbose_name = "Leave Approver"
        verbose_name_plural = "Leave Approvers"
        ordering = ["hospital__name", "user__email"]

    def __str__(self) -> str:
        return f"{self.user.email} → {self.hospital.name}"


class ReceptionPortalSettings(TimeStampedModel, UUIDPrimaryKeyModel):
    class OpdFeeMode(models.TextChoices):
        DOCTOR = "doctor", "Doctor charges currently following"
        SLOT = "slot", "Slots wise"

    class AdmissionBedLabelMode(models.TextChoices):
        BED_CODE = "bed_code", "Bed code"
        BED_NUMBER = "bed_number", "Bed number"

    class TimeDisplayMode(models.TextChoices):
        HOUR_12 = "12h", "12 hour"
        HOUR_24 = "24h", "24 hour"

    hospital = models.OneToOneField(
        Hospital,
        on_delete=models.CASCADE,
        related_name="reception_portal_settings",
    )
    default_city = models.CharField(max_length=120, blank=True, default="Jind")
    default_state = models.CharField(max_length=120, blank=True, default="Haryana")
    default_doctor_user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="default_reception_portal_for_hospitals",
    )

    hospital_name = models.CharField(max_length=200, blank=True, default="")
    address = models.CharField(max_length=255, blank=True, default="")
    pin_code = models.CharField(max_length=30, blank=True, default="")
    phone = models.CharField(max_length=40, blank=True, default="")
    email = models.CharField(max_length=120, blank=True, default="")
    website = models.CharField(max_length=200, blank=True, default="")
    hospital_logo = models.ImageField(
        upload_to="hospital_logos/",
        null=True,
        blank=True,
    )
    invoice_prefix = models.CharField(max_length=20, blank=True, default="INV")
    invoice_next_number = models.PositiveIntegerField(default=1)
    uhid_prefix = models.CharField(max_length=8, blank=True, default="DEF")
    print_with_background = models.BooleanField(default=True)
    opd_fee_mode = models.CharField(
        max_length=10,
        choices=OpdFeeMode.choices,
        default=OpdFeeMode.DOCTOR,
    )
    opd_fee_slots = models.JSONField(blank=True, default=list)
    opd_visible_fields = models.JSONField(
        blank=True,
        default=list,
        help_text="Legacy hidden-field keys; prefer opd_field_config.",
    )
    opd_field_config = models.JSONField(blank=True, default=dict)
    admission_bed_label_mode = models.CharField(
        max_length=20,
        choices=AdmissionBedLabelMode.choices,
        default=AdmissionBedLabelMode.BED_CODE,
        help_text="Label shown in admission bed picker: bed code or bed number.",
    )
    time_display_mode = models.CharField(
        max_length=4,
        choices=TimeDisplayMode.choices,
        default=TimeDisplayMode.HOUR_12,
        help_text="Hospital-wide time display: 12 hour or 24 hour.",
    )
    document_number_formats = models.JSONField(
        blank=True,
        default=dict,
        help_text="Per-document number format templates (uhid, opd, ipd, payment_slip, receipt, ipd_*).",
    )
    reception_collection_enabled = models.BooleanField(
        default=True,
        help_text=(
            "When enabled, reception staff use shift collection and handover. "
            "When disabled, collections are viewed only on the admin cash collection page."
        ),
    )
    reception_daily_report_enabled = models.BooleanField(
        default=True,
        help_text="When enabled, reception staff see Daily Report. When disabled, it is admin-only.",
    )
    ipd_process_field_config = models.JSONField(
        blank=True,
        default=dict,
        help_text="Hospital IPD Process form builder: field tree, types, layout.",
    )

    @staticmethod
    def _time_to_minutes(hhmm: str):
        s = str(hhmm or "").strip()
        try:
            hh, mm = s.split(":")[:2]
            h = int(hh)
            m = int(mm)
        except Exception:
            return None
        if h < 0 or h > 23 or m < 0 or m > 59:
            return None
        return h * 60 + m

    def get_current_opd_slot(self):
        if self.opd_fee_mode != self.OpdFeeMode.SLOT:
            return None
        slots = self.opd_fee_slots or []
        if not isinstance(slots, list) or not slots:
            return None
        now_local = timezone.localtime(timezone.now()).time()
        mins_now = now_local.hour * 60 + now_local.minute
        for row in slots:
            if not isinstance(row, dict):
                continue
            start = self._time_to_minutes(row.get("start"))
            end = self._time_to_minutes(row.get("end"))
            try:
                amount = float(row.get("amount", None))
            except Exception:
                continue
            if start is None or end is None or amount < 0:
                continue
            in_range = (mins_now >= start and mins_now < end) if start <= end else (mins_now >= start or mins_now < end)
            if in_range:
                return {
                    "start": str(row.get("start") or "")[:5],
                    "end": str(row.get("end") or "")[:5],
                    "amount": round(amount, 2),
                }
        return None

    def get_current_opd_slot_fee(self):
        slot = self.get_current_opd_slot()
        return None if slot is None else slot["amount"]

    def __str__(self) -> str:
        return f"Reception settings ({self.hospital_id})"
