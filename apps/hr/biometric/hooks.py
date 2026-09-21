"""Employee lifecycle hooks for biometric sync."""

from __future__ import annotations

import logging

from apps.hr.biometric.sync import (
    enable_biometric_for_employee,
    push_employee_to_hospital_devices,
    remove_employee_from_hospital_devices,
)
from apps.hr.biometric.eligibility import is_biometric_eligible
from apps.hr.models import Employee

logger = logging.getLogger('apps.hr.biometric')

TERMINAL_STATUSES = frozenset({'inactive', 'terminated'})


def on_employee_biometric_state_changed(
    employee: Employee,
    *,
    previous_status: str | None,
    previous_biometric_enabled: bool | None,
) -> None:
    employee.refresh_from_db()

    if employee.status in TERMINAL_STATUSES or (
        previous_status == 'active' and employee.status in TERMINAL_STATUSES
    ):
        remove_employee_from_hospital_devices(employee)
        Employee.objects.filter(pk=employee.pk).update(biometric_attendance_enabled=False)
        return

    if previous_biometric_enabled is True and not employee.biometric_attendance_enabled:
        remove_employee_from_hospital_devices(employee)
        return

    if is_biometric_eligible(employee):
        push_employee_to_hospital_devices(employee)
    elif employee.biometric_attendance_enabled and employee.status == 'active' and employee.onboarding_completed:
        push_employee_to_hospital_devices(employee)


def on_employee_activated(employee: Employee) -> None:
    """Called after HR activation — enable biometric and push to devices."""
    Employee.objects.filter(pk=employee.pk).update(biometric_attendance_enabled=True)
    employee.refresh_from_db()
    enable_biometric_for_employee(employee)


def on_employee_activated_deferred(*, employee_id) -> None:
    """Schedule biometric activation after commit (reduces SQLite contention)."""
    from apps.shared.deferred import run_after_commit

    def _run(**_kwargs):
        employee = Employee.objects.get(pk=employee_id)
        on_employee_activated(employee)

    run_after_commit(_run)
