from __future__ import annotations

from django.conf import settings
from django.db import models

from apps.ipd.models import IPDAdmission
from apps.patients.models import Patient
from apps.shared.models import Hospital, TimeStampedModel, UUIDPrimaryKeyModel
from apps.staff.models import Department, Designation, StaffProfile


class TreatmentPlan(TimeStampedModel, UUIDPrimaryKeyModel):
    """
    A doctor creates one or more treatment plans for an IPD admission.
    Each plan contains ordered items (tasks) for staff to execute.
    """

    class Status(models.TextChoices):
        ACTIVE = "active", "Active"
        LOCKED = "locked", "Locked"
        COMPLETED = "completed", "Completed"
        CANCELLED = "cancelled", "Cancelled"

    hospital = models.ForeignKey(Hospital, on_delete=models.PROTECT, related_name="treatment_plans")
    ipd_admission = models.ForeignKey(IPDAdmission, on_delete=models.CASCADE, related_name="treatment_plans")
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="created_treatment_plans",
    )

    name = models.CharField(max_length=200, blank=True, default="")
    notes = models.TextField(blank=True, default="")
    start_date = models.DateField()
    end_date = models.DateField(null=True, blank=True)
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.ACTIVE, db_index=True)

    class Meta:
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["hospital", "status"]),
            models.Index(fields=["ipd_admission", "status"]),
        ]

    def __str__(self) -> str:
        return f"Plan '{self.name or self.id}' – {self.ipd_admission}"


class TreatmentPlanItem(TimeStampedModel, UUIDPrimaryKeyModel):
    """
    One ordered item inside a plan (e.g. 'Give glucose', 'Ceftriaxone 1g IV').
    Supports hierarchy via parent FK and scheduling via day_offset + time_of_day.
    """

    class Category(models.TextChoices):
        MEDICATION = "medication", "Medication"
        NURSING = "nursing", "Nursing care"
        PHYSIOTHERAPY = "physiotherapy", "Physiotherapy"
        INVESTIGATION = "investigation", "Investigation"
        DIET = "diet", "Diet"
        OTHER = "other", "Other"

    plan = models.ForeignKey(TreatmentPlan, on_delete=models.CASCADE, related_name="items")

    # Hierarchical ordering: parent is null for top-level items.
    parent = models.ForeignKey(
        "self",
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name="children",
    )
    sequence = models.PositiveSmallIntegerField(default=0)

    title = models.CharField(max_length=300)
    instructions = models.TextField(blank=True, default="")
    category = models.CharField(max_length=30, choices=Category.choices, default=Category.MEDICATION, db_index=True)

    # Scheduling: day_offset=0 means same day as plan.start_date.
    day_offset = models.PositiveSmallIntegerField(default=0)
    time_of_day = models.TimeField(null=True, blank=True)

    # Direct assignment (takes priority over role-based).
    assigned_staff = models.ForeignKey(
        StaffProfile,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="treatment_plan_items",
    )
    # Role-based fallback: route to any staff of this designation in this department.
    assigned_designation = models.ForeignKey(
        Designation,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="treatment_plan_items",
    )
    assigned_department = models.ForeignKey(
        Department,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="treatment_plan_items",
    )

    is_active = models.BooleanField(default=True)

    class Meta:
        ordering = ["day_offset", "time_of_day", "sequence"]
        indexes = [
            models.Index(fields=["plan", "day_offset"]),
            models.Index(fields=["plan", "category"]),
        ]

    def __str__(self) -> str:
        return f"[Day {self.day_offset}] {self.title}"


class TreatmentTask(TimeStampedModel, UUIDPrimaryKeyModel):
    """
    A concrete, dated task assigned to a specific staff member.
    Generated automatically from TreatmentPlanItem by the service layer.
    Staff see and complete these tasks.
    """

    class Status(models.TextChoices):
        PENDING = "pending", "Pending"
        IN_PROGRESS = "in_progress", "In progress"
        DONE = "done", "Done"
        SKIPPED = "skipped", "Skipped"
        CANCELLED = "cancelled", "Cancelled"

    class Priority(models.TextChoices):
        NORMAL = "normal", "Normal"
        HIGH = "high", "High"
        STAT = "stat", "Stat (Immediate)"

    plan_item = models.ForeignKey(TreatmentPlanItem, on_delete=models.CASCADE, related_name="tasks")
    ipd_admission = models.ForeignKey(IPDAdmission, on_delete=models.CASCADE, related_name="treatment_tasks")

    date = models.DateField(db_index=True)
    time_of_day = models.TimeField(null=True, blank=True)

    assigned_staff = models.ForeignKey(
        StaffProfile,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="treatment_tasks",
    )

    status = models.CharField(max_length=20, choices=Status.choices, default=Status.PENDING, db_index=True)
    priority = models.CharField(max_length=10, choices=Priority.choices, default=Priority.NORMAL, db_index=True)

    notes_from_doctor = models.TextField(blank=True, default="")
    notes_from_staff = models.TextField(blank=True, default="")

    completed_at = models.DateTimeField(null=True, blank=True)
    completed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="completed_treatment_tasks",
    )

    class Meta:
        ordering = ["date", "time_of_day", "priority"]
        constraints = [
            models.UniqueConstraint(
                fields=["plan_item", "date"],
                name="treatment_unique_task_per_item_per_date",
            )
        ]
        indexes = [
            models.Index(fields=["ipd_admission", "date", "status"]),
            models.Index(fields=["assigned_staff", "date", "status"]),
        ]

    def __str__(self) -> str:
        return f"{self.plan_item.title} – {self.date} ({self.status})"


class TreatmentPlanStaffAssignment(TimeStampedModel, UUIDPrimaryKeyModel):
    """Links multiple staff to a treatment plan for coordinated care."""

    plan = models.ForeignKey(TreatmentPlan, on_delete=models.CASCADE, related_name="staff_assignments")
    staff = models.ForeignKey(StaffProfile, on_delete=models.CASCADE, related_name="treatment_plan_assignments")
    assigned_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="tp_staff_assignments_made",
    )
    role_label = models.CharField(max_length=100, blank=True, default="")

    class Meta:
        unique_together = [("plan", "staff")]
        indexes = [models.Index(fields=["plan", "staff"])]

    def __str__(self):
        return f"{self.staff} → Plan {self.plan_id}"


class PatientTimeline(TimeStampedModel, UUIDPrimaryKeyModel):
    """Audit-friendly treatment timeline events for a patient."""

    class EventType(models.TextChoices):
        PLAN_SAVED = "plan_saved", "Treatment Plan Saved"
        TREATMENT_DONE = "treatment_done", "Treatment Done"
        TREATMENT_SKIPPED = "treatment_skipped", "Treatment Skipped"
        PROCESS_LOG_SAVED = "process_log_saved", "IPD Process Log Saved"

    hospital = models.ForeignKey(Hospital, on_delete=models.PROTECT, related_name="patient_timeline_events")
    patient = models.ForeignKey(Patient, on_delete=models.CASCADE, related_name="treatment_timeline_events")
    ipd_admission = models.ForeignKey(
        IPDAdmission,
        on_delete=models.CASCADE,
        related_name="patient_timeline_events",
        null=True,
        blank=True,
    )

    event_type = models.CharField(max_length=30, choices=EventType.choices, db_index=True)
    title = models.CharField(max_length=255)
    description = models.TextField(blank=True, default="")
    timestamp = models.DateTimeField(db_index=True)

    treatment_plan = models.ForeignKey(
        "TreatmentPlan",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="timeline_events",
    )
    treatment_item = models.ForeignKey(
        "TreatmentPlanItem",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="timeline_events",
    )
    treatment_task = models.ForeignKey(
        "TreatmentTask",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="timeline_events",
    )
    ipd_process_log = models.ForeignKey(
        "ipd.IPDDailyProcessLog",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="timeline_events",
    )
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="patient_timeline_events_created",
    )

    class Meta:
        ordering = ["-timestamp", "-created_at"]
        indexes = [
            models.Index(fields=["hospital", "patient", "timestamp"]),
            models.Index(fields=["ipd_admission", "timestamp"]),
            models.Index(fields=["event_type", "timestamp"]),
        ]

    def __str__(self) -> str:
        return f"{self.patient_id} - {self.event_type} - {self.timestamp}"


class TreatmentTemplateCatalog(TimeStampedModel, UUIDPrimaryKeyModel):
    """Hospital-scoped doctor template/package catalog used by TP builder."""

    hospital = models.OneToOneField(
        Hospital,
        on_delete=models.CASCADE,
        related_name="treatment_template_catalog",
    )
    templates = models.JSONField(default=list, blank=True)
    packages = models.JSONField(default=list, blank=True)
    updated_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="updated_treatment_template_catalogs",
    )

    class Meta:
        indexes = [models.Index(fields=["hospital"])]

    def __str__(self) -> str:
        return f"Treatment template catalog ({self.hospital_id})"
