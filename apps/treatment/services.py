from __future__ import annotations

from datetime import date, timedelta

from django.db import transaction
from django.utils import timezone

from apps.treatment.models import PatientTimeline, TreatmentPlan, TreatmentPlanItem, TreatmentTask


def _resolve_staff_for_item(item: TreatmentPlanItem, target_date: date):
    """
    Resolve which StaffProfile should be assigned to a task on target_date.

    Priority:
    1. Direct assigned_staff on the item.
    2. Role-based: find an active staff with matching designation + department
       who has a shift assignment covering target_date.
    3. Fallback: None (task created unassigned for manual routing).
    """
    if item.assigned_staff_id:
        return item.assigned_staff

    if item.assigned_designation_id or item.assigned_department_id:
        from apps.staff.models import StaffProfile, StaffShiftAssignment

        qs = StaffProfile.objects.filter(
            hospital=item.plan.hospital_id,
            is_deleted=False,
            employment_status="active",
        )
        if item.assigned_designation_id:
            qs = qs.filter(designation_id=item.assigned_designation_id)
        if item.assigned_department_id:
            qs = qs.filter(department_id=item.assigned_department_id)

        # Prefer staff who have an active shift assignment for this date.
        staff_with_shift = (
            StaffShiftAssignment.objects.filter(
                date__lte=target_date,
                status="assigned",
            )
            .filter(
                models.Q(end_date__isnull=True) | models.Q(end_date__gte=target_date)
            )
            .values_list("staff_id", flat=True)
        )

        # Try to get a staff with matching shift first.
        candidate = qs.filter(id__in=staff_with_shift).first()
        if candidate:
            return candidate

        # Fallback: any matching staff even without a shift assigned.
        return qs.first()

    return None


def create_patient_timeline_event(
    *,
    patient,
    hospital_id,
    event_type: str,
    title: str,
    description: str = "",
    timestamp=None,
    ipd_admission=None,
    treatment_plan=None,
    treatment_item=None,
    treatment_task=None,
    ipd_process_log=None,
    created_by=None,
):
    """Create a single audit timeline event for treatment history."""
    PatientTimeline.objects.create(
        patient=patient,
        hospital_id=hospital_id,
        ipd_admission=ipd_admission,
        event_type=event_type,
        title=title,
        description=description,
        timestamp=timestamp or timezone.now(),
        treatment_plan=treatment_plan,
        treatment_item=treatment_item,
        treatment_task=treatment_task,
        ipd_process_log=ipd_process_log,
        created_by=created_by,
    )


@transaction.atomic
def generate_tasks_for_plan(
    plan: TreatmentPlan,
    from_date: date | None = None,
    to_date: date | None = None,
) -> int:
    """
    Materialize TreatmentTask rows for each TreatmentPlanItem in the plan.

    - from_date defaults to plan.start_date.
    - to_date defaults to plan.end_date or from_date (single day).
    - Existing tasks that are not yet done/cancelled are updated (staff, time).
    - Only active items are processed.
    """
    from_date = from_date or plan.start_date
    to_date = to_date or plan.end_date or from_date

    items = plan.items.filter(is_active=True).select_related(
        "assigned_staff", "assigned_designation", "assigned_department"
    )

    created = 0
    for item in items:
        task_date = plan.start_date + timedelta(days=item.day_offset)
        if task_date < from_date or task_date > to_date:
            continue

        staff = _resolve_staff_for_item(item, task_date)

        task, was_created = TreatmentTask.objects.get_or_create(
            plan_item=item,
            date=task_date,
            defaults={
                "ipd_admission": plan.ipd_admission,
                "time_of_day": item.time_of_day,
                "assigned_staff": staff,
                "status": TreatmentTask.Status.PENDING,
                "notes_from_doctor": item.instructions,
            },
        )

        if not was_created:
            # Only update tasks that are still pending (not completed / skipped).
            if task.status in (TreatmentTask.Status.PENDING,):
                task.time_of_day = item.time_of_day
                task.assigned_staff = staff
                task.notes_from_doctor = item.instructions
                task.save(update_fields=["time_of_day", "assigned_staff", "notes_from_doctor", "updated_at"])
        else:
            created += 1

    return created


@transaction.atomic
def complete_task(
    *,
    task: TreatmentTask,
    completed_by,
    notes: str = "",
) -> TreatmentTask:
    """Mark a treatment task as done by a staff member."""
    if task.status in (TreatmentTask.Status.DONE, TreatmentTask.Status.CANCELLED):
        raise ValueError(f"Task is already {task.status}.")
    task.status = TreatmentTask.Status.DONE
    task.completed_at = timezone.now()
    task.completed_by = completed_by
    if notes:
        task.notes_from_staff = notes
    task.save(update_fields=["status", "completed_at", "completed_by", "notes_from_staff", "updated_at"])
    create_patient_timeline_event(
        patient=task.ipd_admission.patient,
        hospital_id=task.ipd_admission.hospital_id,
        ipd_admission=task.ipd_admission,
        event_type=PatientTimeline.EventType.TREATMENT_DONE,
        title=f"{task.plan_item.title} marked done",
        description=notes or "Treatment task completed by staff.",
        timestamp=task.completed_at,
        treatment_plan=task.plan_item.plan,
        treatment_item=task.plan_item,
        treatment_task=task,
        created_by=completed_by,
    )
    return task


@transaction.atomic
def cancel_plan(*, plan: TreatmentPlan, cancelled_by) -> TreatmentPlan:
    """Cancel a plan and all pending tasks under it."""
    plan.status = TreatmentPlan.Status.CANCELLED
    plan.save(update_fields=["status", "updated_at"])

    TreatmentTask.objects.filter(
        plan_item__plan=plan,
        status__in=[TreatmentTask.Status.PENDING, TreatmentTask.Status.IN_PROGRESS],
    ).update(status=TreatmentTask.Status.CANCELLED)

    return plan
