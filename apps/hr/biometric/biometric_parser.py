"""
Parse fingerprint enrollment metadata from ZKTeco ADMS FP / OPERLOG payloads.
Never auto-creates Employee records.
"""

from __future__ import annotations

import logging
import re

from django.utils import timezone

from apps.hr.biometric_models import BiometricEnrollment, FINGER_LABELS
from apps.hr.models import Employee

logger = logging.getLogger('apps.hr.biometric')

_FP_KV_RE = re.compile(
    r'(?:^|[\s\t])(?:FPPIN|PIN)\s*=\s*(\S+).*?'
    r'(?:^|[\s\t])FID\s*=\s*(\d+).*?'
    r'(?:^|[\s\t])Size\s*=\s*(\d+)?.*?'
    r'(?:^|[\s\t])Valid\s*=\s*(\d+)',
    re.IGNORECASE | re.DOTALL,
)


def get_finger_map_for_employee(employee, device=None):
    qs = BiometricEnrollment.objects.filter(employee=employee, is_enrolled=True)
    if device:
        qs = qs.filter(device=device)

    enrolled_ids = set(qs.values_list('finger_id', flat=True).distinct())
    latest = {}
    for entry in qs.order_by('-enrolled_at'):
        if entry.finger_id not in latest:
            latest[entry.finger_id] = entry

    fingers = []
    for fid in range(10):
        entry = latest.get(fid)
        fingers.append({
            'finger_id': fid,
            'label': FINGER_LABELS.get(fid, f'Finger {fid}'),
            'enrolled': fid in enrolled_ids,
            'enrolled_at': entry.enrolled_at.isoformat() if entry and entry.enrolled_at else None,
            'template_size': entry.template_size if entry else None,
            'device_sn': entry.device.serial_number if entry and entry.device else None,
        })
    enrolled_count = len(enrolled_ids)
    return {
        'fingers': fingers,
        'enrolled_count': enrolled_count,
        'total_fingers': 10,
        'missing_count': 10 - enrolled_count,
    }


def _resolve_employee_by_pin(device, pin: str) -> Employee | None:
    if not device or not device.hospital_id:
        return None
    return Employee.objects.filter(
        hospital_id=device.hospital_id,
        biometric_pin=str(pin).strip(),
    ).first()


def _upsert_fingerprint(
    device,
    pin: str,
    finger_id: int,
    *,
    is_enrolled: bool,
    template_size: int | None = None,
    source: str = 'fp_push',
) -> bool:
    if finger_id < 0 or finger_id > 9:
        logger.warning('Invalid FID=%s for PIN=%s', finger_id, pin)
        return False

    employee = _resolve_employee_by_pin(device, pin)
    if not employee:
        logger.debug('Fingerprint event for unknown PIN=%s — skipped', pin)
        return False

    defaults = {
        'is_enrolled': is_enrolled,
        'template_size': template_size,
        'source': source,
        'enrolled_at': timezone.now() if is_enrolled else None,
    }
    BiometricEnrollment.objects.update_or_create(
        employee=employee,
        device=device,
        finger_id=finger_id,
        defaults=defaults,
    )
    action = 'Enrolled' if is_enrolled else 'Removed'
    logger.info(
        '%s fingerprint PIN=%s FID=%s (%s) device=%s',
        action,
        pin,
        finger_id,
        FINGER_LABELS.get(finger_id, '?'),
        device.serial_number if device else '—',
    )
    return True


def _strip_fp_prefix(line: str) -> str:
    line = line.strip()
    upper = line.upper()
    if upper.startswith('FPPIN'):
        return line[5:].lstrip(' \t=')
    if upper.startswith('FP'):
        return re.sub(r'^FP[\s\t]+', '', line, count=1, flags=re.IGNORECASE).strip()
    return line


def _parse_kv_fields(line: str) -> dict[str, str]:
    fields: dict[str, str] = {}
    line = _strip_fp_prefix(line)
    tmp_idx = re.search(r'[\s\t]TMP\s*=', line, re.IGNORECASE)
    if tmp_idx:
        line = line[:tmp_idx.start()]

    for token in re.split(r'[\t]+', line):
        for part in token.split():
            if '=' in part:
                key, _, value = part.partition('=')
                fields[key.strip().lower()] = value.strip()
    return fields


def is_fingerprint_line(line: str) -> bool:
    upper = line.upper().strip()
    if not upper:
        return False
    if upper.startswith('FP') or upper.startswith('FPPIN'):
        return True
    return 'FID=' in upper and ('PIN=' in upper or 'FPPIN=' in upper)


def _parse_fp_fields(line: str) -> dict | None:
    if not is_fingerprint_line(line):
        return None

    fields = _parse_kv_fields(line)
    pin = fields.get('pin') or fields.get('fppin')
    fid = fields.get('fid')

    if not pin or fid is None:
        match = _FP_KV_RE.search(line)
        if match:
            pin, fid, size, valid = match.groups()
            fields['pin'] = pin
            fields['fid'] = fid
            if size:
                fields['size'] = size
            if valid is not None:
                fields['valid'] = valid

    pin = fields.get('pin') or fields.get('fppin')
    fid = fields.get('fid')
    if not pin or fid is None:
        return None

    try:
        finger_id = int(fid)
        valid = int(fields.get('valid', '1'))
        size = int(fields['size']) if fields.get('size') else None
    except ValueError:
        return None

    return {
        'pin': str(pin).strip(),
        'finger_id': finger_id,
        'valid': valid,
        'template_size': size,
    }


def parse_fp_line(line: str, device) -> bool:
    parsed = _parse_fp_fields(line)
    if not parsed:
        return False
    return _upsert_fingerprint(
        device,
        parsed['pin'],
        parsed['finger_id'],
        is_enrolled=parsed['valid'] == 1,
        template_size=parsed['template_size'],
        source='fp_push',
    )


def parse_fp_body(raw: str, device) -> int:
    count = 0
    for line in raw.strip().splitlines():
        line = line.strip()
        if line and parse_fp_line(line, device):
            count += 1
    return count


def _split_oplog_parts(line: str) -> list[str]:
    line = line.strip()
    if '\t' in line:
        return [p.strip() for p in line.split('\t') if p.strip()]
    return line.split()


def parse_oplog_line(line: str, device) -> bool:
    parts = _split_oplog_parts(line)
    if len(parts) < 6:
        return False
    if not parts[0].upper().startswith('OPLOG'):
        return False

    try:
        op_type = int(parts[1])
    except ValueError:
        return False

    if len(parts) < 7:
        return False

    value1 = parts[5]
    value2 = parts[6] if len(parts) > 6 else '0'

    if op_type == 6:
        try:
            finger_id = int(value2)
        except ValueError:
            finger_id = 0
        return _upsert_fingerprint(
            device, str(value1), finger_id, is_enrolled=True, source='operlog',
        )

    if op_type == 10:
        pin = str(value1)
        if value2.isdigit() and int(value2) <= 9:
            return _upsert_fingerprint(
                device, pin, int(value2), is_enrolled=False, source='operlog',
            )
        employee = _resolve_employee_by_pin(device, pin)
        if employee:
            updated = BiometricEnrollment.objects.filter(employee=employee).update(is_enrolled=False)
            if updated:
                logger.info('Cleared %d fingerprint(s) for PIN=%s via OPERLOG', updated, pin)
            return updated > 0
        return False

    return False


def parse_operlog_body(raw: str, device) -> int:
    count = 0
    for line in raw.strip().splitlines():
        line = line.strip()
        if not line:
            continue
        upper = line.upper()
        if is_fingerprint_line(line):
            if parse_fp_line(line, device):
                count += 1
        elif upper.startswith('OPLOG'):
            if parse_oplog_line(line, device):
                count += 1
    return count
