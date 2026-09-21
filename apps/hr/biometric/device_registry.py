"""Biometric device registration helpers."""

from __future__ import annotations

import logging

from apps.hr.biometric.audit import log_biometric_event
from apps.hr.biometric.sync import sync_all_eligible_employees_for_device
from apps.hr.biometric_models import BiometricDevice, BiometricSyncLog
from apps.shared.models import Hospital

logger = logging.getLogger('apps.hr.biometric')


def auto_assign_device_hospital(device: BiometricDevice) -> bool:
    """
    When exactly one hospital exists, link an unassigned device to it and
  queue a full employee sync. Returns True if hospital was assigned now.
    """
    if device.hospital_id:
        return False

    hospitals = list(Hospital.objects.all()[:2])
    if len(hospitals) != 1:
        return False

    device.hospital = hospitals[0]
    device.save(update_fields=['hospital', 'updated_at'])
    logger.info(
        'Auto-assigned biometric device SN=%s to hospital %s',
        device.serial_number,
        hospitals[0].id,
    )
    log_biometric_event(
        action='device_hospital_auto_assigned',
        device=device,
        hospital=hospitals[0],
        message=f'Device linked to {hospitals[0].name} (single-hospital setup).',
    )
    queued = sync_all_eligible_employees_for_device(device)
    log_biometric_event(
        action='device_initial_sync_queued',
        device=device,
        hospital=hospitals[0],
        level=BiometricSyncLog.LEVEL_INFO,
        message=f'Queued USERINFO push for {queued} eligible employee(s).',
        metadata={'employees_queued': queued},
    )
    return True
