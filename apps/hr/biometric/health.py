"""Biometric device health and alert aggregation."""

from __future__ import annotations

from collections import Counter, defaultdict
from datetime import timedelta

from django.db.models import Count, Q
from django.utils import timezone

from apps.hr.biometric.device_commands import device_is_online, pending_command_count
from apps.hr.biometric_models import (
    BiometricDevice,
    BiometricDeviceCommand,
    BiometricRejectedPunch,
    BiometricSyncLog,
    BiometricUnlinkedUser,
)
from apps.hr.models import DailyAttendance

HEALTH_LOOKBACK_HOURS = 24
TIME_ALERT_ACTIONS = frozenset({'device_clock_drift', 'future_device_time'})
WARNING_ACTIONS = frozenset({
    'malformed_attlog_line',
    'delayed_punch',
    'out_of_order_punch',
    'mixed_source_resequence_blocked',
    'manual_override_preserved',
    'finalized_day_conflict',
    'device_command_failed',
})


def _recent_action_counts(queryset) -> dict[str, Counter]:
    counts: dict[str, Counter] = defaultdict(Counter)
    for row in queryset.values('device_id', 'action').annotate(total=Count('id')):
        counts[str(row['device_id'])][row['action']] = row['total']
    return counts


def _device_health_issues(
    device: BiometricDevice,
    *,
    warning_counts: Counter,
    failed_commands: int,
) -> list[dict]:
    issues: list[dict] = []
    if not device.hospital_id:
        issues.append({
            'code': 'unassigned_device',
            'severity': 'warning',
            'message': 'Device is online but not assigned to a hospital.',
        })
    if not device_is_online(device):
        issues.append({
            'code': 'device_offline',
            'severity': 'warning',
            'message': 'Device heartbeat is stale or offline.',
        })
    if failed_commands > 0:
        issues.append({
            'code': 'failed_commands',
            'severity': 'warning',
            'message': f'{failed_commands} device command(s) failed and may need retry.',
        })
    if warning_counts.get('malformed_attlog_line'):
        issues.append({
            'code': 'malformed_attlog',
            'severity': 'warning',
            'message': f"{warning_counts['malformed_attlog_line']} malformed ATTLOG line(s) were rejected recently.",
        })
    if warning_counts.get('delayed_punch'):
        issues.append({
            'code': 'delayed_punch',
            'severity': 'warning',
            'message': f"{warning_counts['delayed_punch']} delayed device punch(es) were uploaded recently.",
        })
    if warning_counts.get('out_of_order_punch'):
        issues.append({
            'code': 'out_of_order_punch',
            'severity': 'warning',
            'message': f"{warning_counts['out_of_order_punch']} out-of-order punch(es) were detected recently.",
        })
    if warning_counts.get('mixed_source_resequence_blocked'):
        issues.append({
            'code': 'mixed_source_conflict',
            'severity': 'warning',
            'message': 'Mixed manual/device punches blocked automatic resequencing and need HR review.',
        })
    if warning_counts.get('finalized_day_conflict'):
        issues.append({
            'code': 'finalized_day_conflict',
            'severity': 'warning',
            'message': 'A biometric punch arrived for a finalized attendance day.',
        })
    if warning_counts.get('manual_override_preserved'):
        issues.append({
            'code': 'manual_override_preserved',
            'severity': 'warning',
            'message': 'A biometric punch arrived for a manually corrected day.',
        })
    if any(warning_counts.get(action) for action in TIME_ALERT_ACTIONS):
        issues.append({
            'code': 'device_time_issue',
            'severity': 'warning',
            'message': 'Device clock drift or future punch timestamps were detected.',
        })
    return issues


def build_connection_status_payload(*, hospital_id=None) -> dict:
    now = timezone.now()
    since = now - timedelta(hours=HEALTH_LOOKBACK_HOURS)
    device_qs = BiometricDevice.objects.filter(is_active=True).order_by('-last_seen')
    if hospital_id:
        device_qs = device_qs.filter(Q(hospital_id=hospital_id) | Q(hospital__isnull=True))

    devices = list(device_qs[:10])
    device_ids = [device.id for device in devices]
    warning_counts = _recent_action_counts(
        BiometricSyncLog.objects.filter(
            device_id__in=device_ids,
            created_at__gte=since,
            level__in=[BiometricSyncLog.LEVEL_WARNING, BiometricSyncLog.LEVEL_ERROR],
        ),
    ) if device_ids else {}
    failed_commands = {
        str(row['device_id']): row['total']
        for row in BiometricDeviceCommand.objects.filter(
            device_id__in=device_ids,
            status=BiometricDeviceCommand.STATUS_FAILED,
        ).values('device_id').annotate(total=Count('id'))
    } if device_ids else {}

    payload_devices = []
    for device in devices:
        issues = _device_health_issues(
            device,
            warning_counts=warning_counts.get(str(device.id), Counter()),
            failed_commands=failed_commands.get(str(device.id), 0),
        )
        payload_devices.append({
            'id': str(device.id),
            'serial_number': device.serial_number,
            'name': device.name or device.serial_number,
            'hospital_assigned': bool(device.hospital_id),
            'is_online': device_is_online(device),
            'last_seen': device.last_seen.isoformat() if device.last_seen else None,
            'pending_commands': pending_command_count(device),
            'ip_address': device.ip_address,
            'health_issues': issues,
        })

    device_count = len(payload_devices)
    any_online = any(d['is_online'] for d in payload_devices)
    any_assigned = any(d['hospital_assigned'] for d in payload_devices if d['is_online'] or d['pending_commands'])
    pending_unlinked = BiometricUnlinkedUser.objects.none()
    rejected_qs = BiometricRejectedPunch.objects.filter(
        punch_time__gte=since,
        dismissed_at__isnull=True,
    )
    review_qs = DailyAttendance.objects.filter(date=timezone.localdate(), requires_hr_review=True)
    if hospital_id:
        pending_unlinked = BiometricUnlinkedUser.objects.filter(
            hospital_id=hospital_id,
            status=BiometricUnlinkedUser.STATUS_PENDING,
        )
        rejected_qs = rejected_qs.filter(hospital_id=hospital_id)
        review_qs = review_qs.filter(employee__hospital_id=hospital_id)
    else:
        pending_unlinked = BiometricUnlinkedUser.objects.filter(status=BiometricUnlinkedUser.STATUS_PENDING)

    devices_with_warnings = sum(1 for row in payload_devices if row['health_issues'])
    devices_with_time_issues = sum(
        1 for row in payload_devices if any(issue['code'] == 'device_time_issue' for issue in row['health_issues'])
    )
    devices_with_failed_commands = sum(
        1 for row in payload_devices if any(issue['code'] == 'failed_commands' for issue in row['health_issues'])
    )

    return {
        'devices': payload_devices,
        'device_count': device_count,
        'any_online': any_online,
        'any_assigned': any_assigned,
        'setup_ok': bool(payload_devices) and any_assigned and any_online,
        'pending_unlinked_users': pending_unlinked.count(),
        'recent_rejected_punches': rejected_qs.count(),
        'attendance_rows_requiring_review': review_qs.count(),
        'devices_with_warnings': devices_with_warnings,
        'devices_with_time_issues': devices_with_time_issues,
        'devices_with_failed_commands': devices_with_failed_commands,
    }
