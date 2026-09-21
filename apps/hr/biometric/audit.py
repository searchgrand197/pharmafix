"""Biometric sync audit logging."""

from __future__ import annotations

import logging

from apps.hr.biometric_models import BiometricDevice, BiometricSyncLog
from apps.hr.models import Employee
from apps.shared.models import Hospital

logger = logging.getLogger('apps.hr.biometric')


def log_biometric_event(
    *,
    action: str,
    message: str,
    level: str = BiometricSyncLog.LEVEL_INFO,
    hospital: Hospital | None = None,
    device: BiometricDevice | None = None,
    employee: Employee | None = None,
    metadata: dict | None = None,
) -> BiometricSyncLog:
    entry = BiometricSyncLog.objects.create(
        hospital=hospital or (device.hospital if device else None) or (employee.hospital if employee else None),
        device=device,
        employee=employee,
        action=action,
        level=level,
        message=message,
        metadata=metadata or {},
    )
    log_fn = logger.warning if level == BiometricSyncLog.LEVEL_WARNING else (
        logger.error if level == BiometricSyncLog.LEVEL_ERROR else logger.info
    )
    log_fn('[Biometric] %s: %s', action, message)
    return entry
