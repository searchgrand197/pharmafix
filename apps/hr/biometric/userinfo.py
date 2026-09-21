"""USERINFO parsing — unlinked users only, never auto-create Employee."""

from __future__ import annotations

import logging

from django.utils import timezone

from apps.hr.biometric.audit import log_biometric_event
from apps.hr.biometric.sync import push_employee_to_hospital_devices
from apps.hr.biometric_models import BiometricSyncLog, BiometricUnlinkedUser
from apps.hr.models import Employee

logger = logging.getLogger('apps.hr.biometric')


def _parse_user_fields(line: str) -> dict:
    if line.startswith('USER'):
        line = line[4:].strip()

    fields: dict[str, str] = {}
    if '=' in line:
        for token in line.split('\t'):
            token = token.strip()
            if '=' in token:
                key, _, value = token.partition('=')
                fields[key.strip().lower()] = value.strip()
        return fields

    parts = [p.strip() for p in line.split('\t')]
    if len(parts) >= 2 and parts[0]:
        fields['pin'] = parts[0]
        fields['name'] = parts[1]
        if len(parts) > 2:
            fields['pri'] = parts[2]
        if len(parts) > 4:
            fields['card'] = parts[4]
    return fields


def _upsert_unlinked(device, pin: str, name: str, card: str) -> None:
    if not device.hospital_id:
        return
    obj, created = BiometricUnlinkedUser.objects.get_or_create(
        hospital_id=device.hospital_id,
        pin=pin,
        status=BiometricUnlinkedUser.STATUS_PENDING,
        defaults={
            'device': device,
            'name': name,
            'card_number': card,
        },
    )
    if not created:
        if name and obj.name != name:
            obj.name = name
        if card and obj.card_number != card:
            obj.card_number = card
        obj.device = device
        obj.save(update_fields=['name', 'card_number', 'device', 'last_seen_at', 'updated_at'])


def parse_userinfo(raw: str, device) -> int:
    """
    Process USERINFO from device.
    Known employees: update card/name if HR is source of truth (log only, re-push on mismatch).
    Unknown PINs: create BiometricUnlinkedUser.
    """
    count = 0
    for line in raw.strip().splitlines():
        line = line.strip()
        if not line:
            continue
        if line.startswith(('FP', 'FACE', 'Face', 'OPLOG', 'BIOPHOTO')):
            continue

        fields = _parse_user_fields(line)
        pin = fields.get('pin', '').strip()
        name = fields.get('name', '').strip()
        card = fields.get('card', '').strip()

        if not pin:
            logger.warning('USERINFO line missing PIN, skipping: %r', line)
            continue

        if not device.hospital_id:
            log_biometric_event(
                action='userinfo_no_hospital',
                level=BiometricSyncLog.LEVEL_WARNING,
                device=device,
                message=f'USERINFO PIN={pin} received but device has no hospital.',
            )
            continue

        employee = Employee.objects.filter(
            hospital_id=device.hospital_id,
            biometric_pin=pin,
        ).first()

        if employee:
            changed = False
            if name and employee.name != name:
                log_biometric_event(
                    action='userinfo_name_mismatch',
                    level=BiometricSyncLog.LEVEL_INFO,
                    device=device,
                    employee=employee,
                    message=f'Device name "{name}" differs from HR — HR is source of truth; re-push queued.',
                )
                push_employee_to_hospital_devices(employee)
                changed = True
            if card and employee.biometric_card_number != card:
                Employee.objects.filter(pk=employee.pk).update(biometric_card_number=card)
                changed = True
            if changed:
                count += 1
            else:
                count += 1
            continue

        _upsert_unlinked(device, pin, name or f'Device user PIN-{pin}', card)
        log_biometric_event(
            action='userinfo_unlinked',
            level=BiometricSyncLog.LEVEL_WARNING,
            device=device,
            message=f'USERINFO for unknown PIN={pin} — conflict record created.',
            metadata={'name': name, 'card': card},
        )
        count += 1

    return count
