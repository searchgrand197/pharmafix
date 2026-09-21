"""Eligibility checks for biometric attendance."""

from __future__ import annotations

from apps.hr.models import Employee


def is_biometric_eligible(employee: Employee) -> bool:
    return (
        employee.status == 'active'
        and employee.onboarding_completed
        and employee.biometric_attendance_enabled
        and employee.hospital_id is not None
        and bool((employee.biometric_pin or '').strip())
    )


def is_punch_allowed(employee: Employee) -> tuple[bool, str]:
    if employee.status != 'active':
        return False, 'inactive_employee'
    if not employee.onboarding_completed:
        return False, 'onboarding_incomplete'
    if not employee.biometric_attendance_enabled:
        return False, 'biometric_disabled'
    if not employee.hospital_id:
        return False, 'no_hospital'
    if not (employee.biometric_pin or '').strip():
        return False, 'no_biometric_pin'
    return True, ''
