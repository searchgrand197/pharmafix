"""Employee ↔ biometric device synchronization."""

from __future__ import annotations

import logging

from django.db import transaction
from django.db.models import Max
from django.utils import timezone

from apps.hr.biometric.audit import log_biometric_event
from apps.hr.biometric.device_commands import (
    build_userinfo_delete_command,
    build_userinfo_update_command,
    get_hospital_devices,
    queue_device_command,
)
from apps.hr.biometric_models import BiometricSyncLog
from apps.hr.models import Employee

logger = logging.getLogger('apps.hr.biometric')


def assign_biometric_pin(employee: Employee) -> str:
    if (employee.biometric_pin or '').strip():
        return employee.biometric_pin
    if not employee.hospital_id:
        raise ValueError('Cannot assign biometric PIN without hospital.')

    with transaction.atomic():
        locked = Employee.objects.select_for_update().get(pk=employee.pk)
        if (locked.biometric_pin or '').strip():
            return locked.biometric_pin

        agg = (
            Employee.objects.select_for_update()
            .filter(hospital_id=locked.hospital_id)
            .exclude(biometric_pin='')
            .aggregate(m=Max('biometric_pin'))
        )
        max_pin = 0
        if agg['m']:
            try:
                max_pin = int(str(agg['m']).strip())
            except ValueError:
                max_pin = Employee.objects.filter(
                    hospital_id=locked.hospital_id,
                ).exclude(biometric_pin='').count()

        new_pin = str(max_pin + 1)
        locked.biometric_pin = new_pin
        locked.biometric_sync_status = Employee.BIOMETRIC_SYNC_PENDING
        locked.save(update_fields=['biometric_pin', 'biometric_sync_status', 'updated_at'])
        employee.biometric_pin = new_pin
        employee.biometric_sync_status = Employee.BIOMETRIC_SYNC_PENDING
    return new_pin


def push_employee_to_hospital_devices(employee: Employee) -> list[dict]:
    if not employee.hospital_id:
        logger.info(
            'Skip biometric push employee=%s — no hospital',
            employee.employee_id,
        )
        return []
    if employee.status != 'active' or not employee.onboarding_completed:
        logger.info(
            'Skip biometric push employee=%s — not active/onboarded',
            employee.employee_id,
        )
        return []
    if not employee.biometric_attendance_enabled:
        logger.info(
            'Skip biometric push employee=%s — biometric disabled',
            employee.employee_id,
        )
        return []

    if not (employee.biometric_pin or '').strip():
        assign_biometric_pin(employee)
        employee.refresh_from_db(fields=['biometric_pin', 'biometric_sync_status'])

    devices = list(get_hospital_devices(employee.hospital_id))
    if not devices:
        log_biometric_event(
            action='push_skipped_no_device',
            level=BiometricSyncLog.LEVEL_WARNING,
            employee=employee,
            message=f'No active biometric devices for hospital {employee.hospital_id}.',
        )
        Employee.objects.filter(pk=employee.pk).update(
            biometric_sync_status=Employee.BIOMETRIC_SYNC_PENDING,
        )
        return []

    command = build_userinfo_update_command(employee)
    results = []
    for device in devices:
        cmd = queue_device_command(device, command)
        results.append({
            'device_id': str(device.id),
            'device_sn': device.serial_number,
            'command_id': cmd.command_id,
            'status': 'queued',
        })

    Employee.objects.filter(pk=employee.pk).update(
        biometric_sync_status=Employee.BIOMETRIC_SYNC_PENDING,
        biometric_last_synced_at=None,
    )
    log_biometric_event(
        action='employee_push_queued',
        employee=employee,
        message=f'Queued USERINFO push PIN={employee.biometric_pin} on {len(devices)} device(s).',
        metadata={'devices': [d.serial_number for d in devices]},
    )
    return results


def remove_employee_from_hospital_devices(employee: Employee) -> list[dict]:
    pin = (employee.biometric_pin or '').strip()
    if not pin or not employee.hospital_id:
        return []

    command = build_userinfo_delete_command(pin)
    results = []
    for device in get_hospital_devices(employee.hospital_id, active_only=False):
        cmd = queue_device_command(device, command)
        results.append({
            'device_id': str(device.id),
            'device_sn': device.serial_number,
            'command_id': cmd.command_id,
            'status': 'queued',
        })

    Employee.objects.filter(pk=employee.pk).update(
        biometric_sync_status=Employee.BIOMETRIC_SYNC_REMOVED,
    )
    log_biometric_event(
        action='employee_remove_queued',
        employee=employee,
        message=f'Queued USERINFO delete PIN={pin}.',
    )
    return results


def sync_all_eligible_employees_for_device(device) -> int:
    if not device.hospital_id:
        return 0
    count = 0
    employees = Employee.objects.filter(
        hospital_id=device.hospital_id,
        status='active',
        onboarding_completed=True,
        biometric_attendance_enabled=True,
    )
    for employee in employees:
        push_employee_to_hospital_devices(employee)
        count += 1
    return count


def mark_employee_synced_from_command(employee: Employee, device=None) -> None:
    Employee.objects.filter(pk=employee.pk).update(
        biometric_sync_status=Employee.BIOMETRIC_SYNC_SYNCED,
        biometric_last_synced_at=timezone.now(),
    )
    log_biometric_event(
        action='employee_push_acked',
        employee=employee,
        device=device,
        message=f'USERINFO push confirmed for PIN={employee.biometric_pin}.',
    )


def enable_biometric_for_employee(employee: Employee) -> None:
    Employee.objects.filter(pk=employee.pk).update(biometric_attendance_enabled=True)
    employee.biometric_attendance_enabled = True
    if not (employee.biometric_pin or '').strip():
        assign_biometric_pin(employee)
        employee.refresh_from_db(fields=['biometric_pin'])
    push_employee_to_hospital_devices(employee)
