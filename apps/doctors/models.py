from django.conf import settings
from django.db import models
from django.utils import timezone

from apps.shared.models import Hospital, SoftDeleteModel, TimeStampedModel, UUIDPrimaryKeyModel
from apps.staff.models import Department


class Specialty(SoftDeleteModel, TimeStampedModel, UUIDPrimaryKeyModel):
    hospital = models.ForeignKey(Hospital, on_delete=models.PROTECT, related_name="specialties")
    code = models.CharField(max_length=50)
    name = models.CharField(max_length=200)
    department = models.ForeignKey(Department, on_delete=models.PROTECT, related_name="specialties")
    is_active = models.BooleanField(default=True)

    class Meta:
        indexes = [models.Index(fields=["hospital", "name"])]
        constraints = [
            models.UniqueConstraint(
                fields=["hospital", "code"],
                condition=models.Q(is_deleted=False),
                name="specialty_hospital_active_code_uniq",
            ),
        ]

    def __str__(self) -> str:
        return self.name


class DoctorProfile(SoftDeleteModel, TimeStampedModel, UUIDPrimaryKeyModel):
    class DoctorType(models.TextChoices):
        CONSULTANT = "consultant"
        VISITING = "visiting"
        RESIDENT = "resident"
        OTHER = "other"

    hospital = models.ForeignKey(Hospital, on_delete=models.PROTECT, related_name="doctor_profiles")
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="doctor_profiles",
    )

    # A doctor can belong to multiple departments.
    departments = models.ManyToManyField(Department, related_name="doctors")
    specialty = models.ForeignKey(Specialty, on_delete=models.PROTECT, related_name="doctors")
    doctor_type = models.CharField(max_length=20, choices=DoctorType.choices, default=DoctorType.CONSULTANT)

    doctor_code = models.CharField(max_length=80)
    name = models.CharField(max_length=200)
    mobile_number = models.CharField(max_length=25, blank=True, default="")
    alternate_mobile_number = models.CharField(max_length=25, blank=True, default="")
    address = models.TextField(blank=True, default="")
    consultation_fee = models.DecimalField(max_digits=12, decimal_places=2, default=0)

    is_active = models.BooleanField(default=True)

    class Meta:
        indexes = [
            models.Index(fields=["hospital", "is_active"]),
        ]
        constraints = [
            models.UniqueConstraint(
                fields=["hospital", "doctor_code"],
                condition=models.Q(is_deleted=False),
                name="doctorprofile_hospital_active_doctor_code_uniq",
            ),
        ]

    def __str__(self) -> str:
        return self.name


class DoctorWeeklySchedule(TimeStampedModel, UUIDPrimaryKeyModel):
    hospital = models.ForeignKey(Hospital, on_delete=models.PROTECT, related_name="weekly_schedules")
    doctor = models.ForeignKey(DoctorProfile, on_delete=models.CASCADE, related_name="weekly_schedules")
    # Monday=0 ... Sunday=6
    day_of_week = models.PositiveSmallIntegerField(db_index=True)
    start_time = models.TimeField()
    end_time = models.TimeField()
    slot_minutes = models.PositiveIntegerField(default=15)
    is_available = models.BooleanField(default=True)

    class Meta:
        unique_together = [("hospital", "doctor", "day_of_week", "start_time", "end_time")]
        indexes = [models.Index(fields=["hospital", "doctor", "day_of_week"])]

    def __str__(self) -> str:
        return f"{self.doctor_id} dow={self.day_of_week}"


class DoctorDailyAvailability(TimeStampedModel, UUIDPrimaryKeyModel):
    hospital = models.ForeignKey(Hospital, on_delete=models.PROTECT, related_name="daily_availabilities")
    doctor = models.ForeignKey(DoctorProfile, on_delete=models.CASCADE, related_name="daily_availabilities")
    date = models.DateField(db_index=True)
    is_available = models.BooleanField(default=True)
    open_from_time = models.TimeField(null=True, blank=True)
    open_to_time = models.TimeField(null=True, blank=True)
    closed_reason = models.CharField(max_length=300, blank=True, default="")
    updated_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="availability_updates")

    class Meta:
        unique_together = [("hospital", "doctor", "date")]
        indexes = [models.Index(fields=["hospital", "doctor", "date"])]

    def __str__(self) -> str:
        return f"{self.doctor_id} {self.date}"


def default_doctor_daily_date() -> timezone.datetime.date:
    return timezone.now().date()


def default_followup_days() -> list[int]:
    return [3, 5, 7, 10, 14, 30]


def default_rx_days() -> list[int]:
    return [1, 3, 5, 7, 10, 14, 30]


def default_dosage_pattern_options() -> list[dict]:
    return [
        {"v": "1", "l": "1 (OD)", "q": 1},
        {"v": "1-0-1", "l": "1-0-1 (BD)", "q": 2},
        {"v": "1-1", "l": "1-1 (BD)", "q": 2},
        {"v": "1-1-1", "l": "1-1-1 (TDS)", "q": 3},
        {"v": "1-1-1-1", "l": "1-1-1-1 (QID)", "q": 4},
        {"v": "0-1", "l": "0-1 (Night)", "q": 1},
        {"v": "1-0", "l": "1-0 (Morning)", "q": 1},
        {"v": "2-2", "l": "2-2 (BD)", "q": 4},
        {"v": "2-2-2", "l": "2-2-2 (TDS)", "q": 6},
        {"v": "0.5-0.5", "l": "0.5-0.5 (Half BD)", "q": 1},
    ]


def default_food_timing_options() -> list[dict]:
    return [
        {"v": "AF", "l": "After Food"},
        {"v": "BF", "l": "Before Food"},
        {"v": "EM", "l": "Empty Stomach"},
        {"v": "BD", "l": "Twice Daily"},
        {"v": "TDS", "l": "Three Times"},
        {"v": "QID", "l": "Four Times"},
        {"v": "HS", "l": "Bedtime"},
        {"v": "SOS", "l": "As Needed"},
    ]


class DoctorPortalPreference(TimeStampedModel, UUIDPrimaryKeyModel):
    hospital = models.ForeignKey(Hospital, on_delete=models.PROTECT, related_name="doctor_portal_preferences")
    user = models.OneToOneField(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="doctor_portal_preference",
    )
    followup_day_options = models.JSONField(default=default_followup_days)
    rx_default_day_options = models.JSONField(default=default_rx_days)
    dosage_pattern_options = models.JSONField(default=default_dosage_pattern_options)
    food_timing_options = models.JSONField(default=default_food_timing_options)

    class Meta:
        indexes = [models.Index(fields=["hospital", "user"])]

    def __str__(self) -> str:
        return f"DoctorPortalPreference<{self.user_id}>"


class HospitalCustomRxSalt(TimeStampedModel, UUIDPrimaryKeyModel):
    """Hospital-wide custom medicine names for doctor not-in-pharmacy prescribing."""

    hospital = models.ForeignKey(Hospital, on_delete=models.CASCADE, related_name="custom_rx_salts")
    name = models.CharField(max_length=200)
    normalized_name = models.CharField(max_length=200)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="created_custom_rx_salts",
    )
    last_used_at = models.DateTimeField(default=timezone.now)
    use_count = models.PositiveIntegerField(default=1)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["hospital", "normalized_name"],
                name="custom_rx_salt_hosp_norm_uniq",
            ),
        ]
        indexes = [models.Index(fields=["hospital", "-last_used_at"])]

    def __str__(self) -> str:
        return self.name
