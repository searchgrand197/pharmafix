"""Link / reject flows for unlinked device users."""

from __future__ import annotations

from django.db import transaction
from django.utils import timezone

from typing import Any

from apps.hr.biometric.audit import log_biometric_event
from apps.hr.biometric.device_commands import build_userinfo_delete_command, queue_device_command
from apps.hr.biometric.sync import push_employee_to_hospital_devices
from apps.hr.biometric_models import BiometricUnlinkedUser
from apps.hr.manual_employee import ManualEmployeeValidationError, create_manual_employee
from apps.hr.models import Employee


class BiometricLinkError(Exception):
    def __init__(self, message: str, code: str = 'invalid_request', field_errors: dict | None = None):
        super().__init__(message)
        self.code = code
        self.message = message
        self.field_errors = field_errors or {}


@transaction.atomic
def link_unlinked_user_to_employee(
    unlinked: BiometricUnlinkedUser,
    employee: Employee,
    *,
    resolved_by=None,
) -> dict:
    if unlinked.status != BiometricUnlinkedUser.STATUS_PENDING:
        raise BiometricLinkError('This conflict was already resolved.', code='already_resolved')

    if employee.hospital_id != unlinked.hospital_id:
        raise BiometricLinkError('Employee must belong to the same hospital.', code='hospital_mismatch')

    existing = Employee.objects.filter(
        hospital_id=employee.hospital_id,
        biometric_pin=unlinked.pin,
    ).exclude(pk=employee.pk).first()
    if existing:
        raise BiometricLinkError(
            f'PIN {unlinked.pin} is already assigned to {existing.employee_id}.',
            code='pin_conflict',
        )

    employee.biometric_pin = unlinked.pin
    employee.biometric_attendance_enabled = True
    if unlinked.name and not employee.name:
        pass
    if unlinked.card_number:
        employee.biometric_card_number = unlinked.card_number
    employee.save(update_fields=[
        'biometric_pin',
        'biometric_attendance_enabled',
        'biometric_card_number',
        'updated_at',
    ])

    unlinked.status = BiometricUnlinkedUser.STATUS_LINKED
    unlinked.linked_employee = employee
    unlinked.resolved_at = timezone.now()
    unlinked.resolved_by = resolved_by
    unlinked.save(update_fields=[
        'status', 'linked_employee', 'resolved_at', 'resolved_by', 'updated_at',
    ])

    push_results = push_employee_to_hospital_devices(employee)
    log_biometric_event(
        action='unlinked_user_linked',
        employee=employee,
        device=unlinked.device,
        message=f'Linked device PIN={unlinked.pin} to employee {employee.employee_id}.',
        metadata={'unlinked_id': str(unlinked.id)},
    )
    return {
        'unlinked_id': str(unlinked.id),
        'employee_id': str(employee.id),
        'biometric_pin': employee.biometric_pin,
        'push_results': push_results,
    }


@transaction.atomic
def reject_unlinked_user(unlinked: BiometricUnlinkedUser, *, resolved_by=None) -> dict:
    if unlinked.status != BiometricUnlinkedUser.STATUS_PENDING:
        raise BiometricLinkError('This conflict was already resolved.', code='already_resolved')

    if unlinked.device:
        queue_device_command(unlinked.device, build_userinfo_delete_command(unlinked.pin))

    unlinked.status = BiometricUnlinkedUser.STATUS_REJECTED
    unlinked.resolved_at = timezone.now()
    unlinked.resolved_by = resolved_by
    unlinked.save(update_fields=['status', 'resolved_at', 'resolved_by', 'updated_at'])

    log_biometric_event(
        action='unlinked_user_rejected',
        device=unlinked.device,
        message=f'Rejected device PIN={unlinked.pin}; delete queued on device.',
        metadata={'unlinked_id': str(unlinked.id)},
    )
    return {'unlinked_id': str(unlinked.id), 'status': unlinked.status}


@transaction.atomic
def create_employee_from_unlinked(
    unlinked: BiometricUnlinkedUser,
    *,
    hr_user,
    payload: dict[str, Any],
) -> dict:
    if unlinked.status != BiometricUnlinkedUser.STATUS_PENDING:
        raise BiometricLinkError('This conflict was already resolved.', code='already_resolved')

    hospital = unlinked.hospital
    if not hospital:
        raise BiometricLinkError(
            'This device conflict has no hospital assigned.',
            code='no_hospital',
        )

    if Employee.objects.filter(
        hospital_id=hospital.id,
        biometric_pin=unlinked.pin,
    ).exists():
        raise BiometricLinkError(
            f'PIN {unlinked.pin} is already assigned to another employee.',
            code='pin_conflict',
        )

    merged = dict(payload)
    if not (merged.get('name') or '').strip():
        merged['name'] = (unlinked.name or '').strip() or f'Device user PIN-{unlinked.pin}'
    merged.setdefault('start_onboarding', False)
    for key in ('designation', 'designation_id', 'department_id', 'compensation_level'):
        if merged.get(key) is not None:
            merged[key] = str(merged[key])

    try:
        employee, _meta = create_manual_employee(
            hr_user=hr_user,
            hospital=hospital,
            payload=merged,
            skip_biometric_activation=True,
        )
    except ManualEmployeeValidationError as exc:
        raise BiometricLinkError(
            'Please fix the employee details and try again.',
            code='validation_error',
            field_errors=getattr(exc, 'field_errors', {}) or {},
        ) from exc
    except ValueError as exc:
        if str(exc) == 'duplicate_email':
            raise BiometricLinkError(
                'An employee with this email already exists.',
                code='duplicate_email',
            ) from exc
        raise BiometricLinkError(str(exc), code='invalid_request') from exc

    if employee.status != 'active':
        raise BiometricLinkError(
            'Employee must be created as active to link a device user.',
            code='invalid_status',
        )

    result = link_unlinked_user_to_employee(unlinked, employee, resolved_by=hr_user)
    log_biometric_event(
        action='unlinked_user_created_and_linked',
        employee=employee,
        device=unlinked.device,
        message=f'Created employee {employee.employee_id} from device PIN={unlinked.pin}.',
        metadata={'unlinked_id': str(unlinked.id)},
    )
    return {
        **result,
        'employee_code': employee.employee_id,
        'employee_name': employee.name,
    }
