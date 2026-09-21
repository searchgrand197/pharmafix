"""
Persistent ADMS command queue backed by the database.
"""

from __future__ import annotations

import logging
import threading
from datetime import timedelta

from django.db import transaction
from django.db.models import Max
from django.utils import timezone

from apps.hr.biometric.audit import log_biometric_event
from apps.hr.biometric_models import BiometricDevice, BiometricDeviceCommand
from apps.hr.models import Employee

logger = logging.getLogger('apps.hr.biometric')

PASSIVE_CLOCK_SYNC_MESSAGE = (
    'Clock syncs automatically from the server on every heartbeat. '
    'Restart device network (Comm menu) if the clock is still wrong.'
)

_cmd_lock = threading.Lock()
_operlog_stamp_reset: set[str] = set()
_fingertmp_stamp_reset: set[str] = set()
_periodic_operlog_reset: dict[str, timezone.datetime] = {}
MAX_COMMAND_ATTEMPTS = 5
USERINFO_QUERY_INTERVAL_SECONDS = 300
OPERLOG_RESET_INTERVAL_SECONDS = 900


def _recent_device_command(device: BiometricDevice, needle: str, *, within_seconds: int) -> bool:
    cutoff = timezone.now() - timedelta(seconds=within_seconds)
    return BiometricDeviceCommand.objects.filter(
        device=device,
        command_body__icontains=needle,
        created_at__gte=cutoff,
    ).exists()


def request_userinfo_sync(device: BiometricDevice) -> None:
    """
    Ask the device to upload its user list (DATA QUERY USERINFO).
    Re-queues periodically so locally enrolled users are not missed after the first sync.
    """
    if _recent_device_command(device, 'QUERY USERINFO', within_seconds=USERINFO_QUERY_INTERVAL_SECONDS):
        return
    queue_device_command(device, 'DATA QUERY USERINFO')
    BiometricDevice.objects.filter(pk=device.pk).update(userinfo_sync_requested=True)
    logger.info('Scheduled USERINFO pull for SN=%s', device.serial_number)


def request_operlog_pull(sn: str) -> None:
    """Request OPERLOG upload on the next device handshake (catches local user enroll events)."""
    with _cmd_lock:
        last = _periodic_operlog_reset.get(sn)
        now = timezone.now()
        if last and (now - last).total_seconds() < OPERLOG_RESET_INTERVAL_SECONDS:
            return
        _periodic_operlog_reset[sn] = now
        _operlog_stamp_reset.add(sn)


def _next_command_id(device: BiometricDevice) -> int:
    agg = BiometricDeviceCommand.objects.filter(device=device).aggregate(m=Max('command_id'))
    return (agg['m'] or 0) + 1


def queue_device_command(device: BiometricDevice, command: str) -> BiometricDeviceCommand:
    with _cmd_lock:
        with transaction.atomic():
            device = BiometricDevice.objects.select_for_update().get(pk=device.pk)
            cmd_id = _next_command_id(device)
            row = BiometricDeviceCommand.objects.create(
                device=device,
                command_id=cmd_id,
                command_body=command,
                status=BiometricDeviceCommand.STATUS_PENDING,
            )
    logger.info('Queued command for SN=%s: C:%s:%s', device.serial_number, cmd_id, command)
    return row


def queue_device_command_by_sn(sn: str, command: str) -> BiometricDeviceCommand | None:
    device = BiometricDevice.objects.filter(serial_number=sn, is_active=True).first()
    if not device:
        logger.warning('Cannot queue command — device SN=%s not found', sn)
        return None
    return queue_device_command(device, command)


def format_command_line(cmd: BiometricDeviceCommand) -> str:
    return f"C:{cmd.command_id}:{cmd.command_body}\n"


def pop_device_command(sn: str) -> str | None:
    with _cmd_lock:
        with transaction.atomic():
            device = (
                BiometricDevice.objects.select_for_update()
                .filter(serial_number=sn, is_active=True)
                .first()
            )
            if not device:
                return None
            cmd = (
                BiometricDeviceCommand.objects.select_for_update()
                .filter(
                    device=device,
                    status__in=[
                        BiometricDeviceCommand.STATUS_PENDING,
                        BiometricDeviceCommand.STATUS_FAILED,
                    ],
                    attempts__lt=MAX_COMMAND_ATTEMPTS,
                )
                .order_by('created_at')
                .first()
            )
            if not cmd:
                return None
            cmd.status = BiometricDeviceCommand.STATUS_SENT
            cmd.sent_at = timezone.now()
            cmd.attempts += 1
            cmd.save(update_fields=['status', 'sent_at', 'attempts', 'updated_at'])
            return format_command_line(cmd)


def record_command_result(sn: str, cmd_id: int, return_code: str) -> str | None:
    with _cmd_lock:
        device = BiometricDevice.objects.filter(serial_number=sn).first()
        if not device:
            return None
        cmd = BiometricDeviceCommand.objects.filter(device=device, command_id=cmd_id).first()
        if not cmd:
            return None
        original = cmd.command_body
        cmd.return_code = return_code or ''
        if return_code == '0':
            cmd.status = BiometricDeviceCommand.STATUS_ACKED
            cmd.acked_at = timezone.now()
            cmd.error_message = ''
        else:
            cmd.status = BiometricDeviceCommand.STATUS_FAILED
            cmd.error_message = f'Device returned {return_code}'
        cmd.save(update_fields=['return_code', 'status', 'acked_at', 'error_message', 'updated_at'])
        if return_code != '0':
            log_biometric_event(
                action='device_command_failed',
                level='warning',
                device=device,
                message=f'Device command {cmd.command_id} failed with return code {return_code or "unknown"}.',
                metadata={
                    'command_id': cmd.command_id,
                    'return_code': return_code or '',
                    'command_body': original,
                },
            )
        return original


def pending_command_count(device: BiometricDevice | None = None) -> int:
    qs = BiometricDeviceCommand.objects.filter(
        status__in=[
            BiometricDeviceCommand.STATUS_PENDING,
            BiometricDeviceCommand.STATUS_SENT,
            BiometricDeviceCommand.STATUS_FAILED,
        ],
        attempts__lt=MAX_COMMAND_ATTEMPTS,
    )
    if device:
        qs = qs.filter(device=device)
    return qs.count()


def request_fingerprint_sync(sn: str) -> None:
    with _cmd_lock:
        _operlog_stamp_reset.add(sn)
        _fingertmp_stamp_reset.add(sn)
    queue_device_command_by_sn(sn, 'DATA QUERY FINGERTMP')


def needs_operlog_stamp_reset(sn: str) -> bool:
    return sn in _operlog_stamp_reset


def needs_fingertmp_stamp_reset(sn: str) -> bool:
    return sn in _fingertmp_stamp_reset


def clear_operlog_stamp_reset(sn: str) -> None:
    _operlog_stamp_reset.discard(sn)


def clear_fingertmp_stamp_reset(sn: str) -> None:
    _fingertmp_stamp_reset.discard(sn)


def build_userinfo_update_command(employee: Employee) -> str:
    fields = [
        f'PIN={employee.biometric_pin}',
        f'Name={employee.name}',
        f'Pri={employee.biometric_device_privilege}',
        'Passwd=',
        f'Card={employee.biometric_card_number or ""}',
        'Grp=1',
        'TZ=0000000100000000',
    ]
    return f"DATA UPDATE USERINFO {'\t'.join(fields)}"


def build_userinfo_delete_command(pin: str) -> str:
    return f'DATA DELETE USERINFO PIN={pin}'


def get_hospital_devices(hospital_id, active_only: bool = True):
    qs = BiometricDevice.objects.filter(hospital_id=hospital_id)
    if active_only:
        qs = qs.filter(is_active=True)
    return qs.order_by('-last_seen')


def device_is_online(device: BiometricDevice, within_seconds: int = 120) -> bool:
    if not device.last_seen:
        return False
    return (timezone.now() - device.last_seen).total_seconds() < within_seconds
