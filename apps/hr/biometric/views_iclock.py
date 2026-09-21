"""
ZKTeco / ESSL ADMS push-protocol endpoints for HR biometric attendance.
"""

from __future__ import annotations

import logging
from datetime import datetime

from django.utils import timezone
from django.utils.decorators import method_decorator
from django.views import View
from django.views.decorators.csrf import csrf_exempt

from apps.hr.biometric.audit import log_biometric_event
from apps.hr.biometric.biometric_parser import parse_fp_body, parse_operlog_body
from apps.hr.biometric.device_commands import (
    clear_fingertmp_stamp_reset,
    clear_operlog_stamp_reset,
    needs_fingertmp_stamp_reset,
    needs_operlog_stamp_reset,
    pop_device_command,
    record_command_result,
    request_operlog_pull,
    request_userinfo_sync,
)
from apps.hr.biometric.ingestion import ingest_attlog_line
from apps.hr.biometric.time_sync import (
    adms_http_response,
    build_time_sync_response,
    get_adms_timezone_offset,
)
from apps.hr.biometric.device_registry import auto_assign_device_hospital
from apps.hr.biometric.userinfo import parse_userinfo
from apps.hr.biometric_models import BiometricDevice

logger = logging.getLogger('apps.hr.biometric')


def _looks_like_attlog(text: str) -> bool:
    line = text.strip().splitlines()[0].strip() if text else ''
    if not line or line.startswith(('USER', 'FP', 'FACE', 'Face', 'OPLOG', 'BIOPHOTO')):
        return False
    parts = line.split('\t')
    if len(parts) < 2:
        return False
    try:
        datetime.strptime(parts[1].strip(), '%Y-%m-%d %H:%M:%S')
        return True
    except ValueError:
        return False


def get_or_create_device(sn: str, request) -> BiometricDevice:
    ip = (
        request.META.get('HTTP_X_FORWARDED_FOR', '').split(',')[0].strip()
        or request.META.get('REMOTE_ADDR')
    )
    device, created = BiometricDevice.objects.get_or_create(
        serial_number=sn,
        defaults={'name': f'Device {sn}'},
    )
    device.touch(ip=ip)
    if created:
        logger.info('New biometric device registered: SN=%s IP=%s', sn, ip)
    auto_assign_device_hospital(device)
    return device


def parse_attlog_body(raw: str, device: BiometricDevice) -> int:
    saved = 0
    for line in raw.strip().splitlines():
        line = line.strip()
        if not line:
            continue
        parts = line.split('\t')
        if len(parts) < 2:
            logger.warning('Skipping malformed ATTLOG line: %r', line)
            log_biometric_event(
                action='malformed_attlog_line',
                level='warning',
                device=device,
                message='Malformed ATTLOG line rejected during parsing.',
                metadata={'raw_line': line},
            )
            continue
        try:
            pin = parts[0].strip()
            ts_str = parts[1].strip()
            status = int(parts[2]) if len(parts) > 2 and parts[2].strip() != '' else 0
            verify = int(parts[3]) if len(parts) > 3 and parts[3].strip() != '' else 1

            naive_dt = datetime.strptime(ts_str, '%Y-%m-%d %H:%M:%S')
            aware_dt = timezone.make_aware(naive_dt)

            if ingest_attlog_line(device, pin, aware_dt, status, verify, line):
                saved += 1
        except (ValueError, IndexError) as exc:
            logger.error('Error parsing ATTLOG line %r: %s', line, exc)
            log_biometric_event(
                action='malformed_attlog_line',
                level='warning',
                device=device,
                message='ATTLOG line could not be parsed.',
                metadata={'raw_line': line, 'error': str(exc)},
            )
    return saved


@method_decorator(csrf_exempt, name='dispatch')
class CDataView(View):
    def get(self, request, *args, **kwargs):
        sn = request.GET.get('SN', '').strip()
        if not sn:
            logger.warning('Handshake received with no SN')
            return adms_http_response('ERROR', status=400)

        device = get_or_create_device(sn, request)
        req_type = request.GET.get('type', '').strip().lower()

        if req_type == 'time':
            logger.info('Time sync request from SN=%s', sn)
            device.last_time_sync = timezone.now()
            device.last_time_sync_status = 'requested'
            device.save(update_fields=['last_time_sync', 'last_time_sync_status', 'updated_at'])
            return adms_http_response(build_time_sync_response())

        logger.info('Handshake from device SN=%s', sn)
        request_userinfo_sync(device)
        request_operlog_pull(sn)

        operlog_stamp = '0' if needs_operlog_stamp_reset(sn) else '9999'
        if operlog_stamp == '0':
            clear_operlog_stamp_reset(sn)
        fingertmp_stamp = '0' if needs_fingertmp_stamp_reset(sn) else '9999'
        if fingertmp_stamp == '0':
            clear_fingertmp_stamp_reset(sn)

        tz_offset = get_adms_timezone_offset()
        options = (
            f'GET OPTION FROM: {sn}\n'
            f'ATTLOGStamp=9999\n'
            f'OPERLOGStamp={operlog_stamp}\n'
            f'FINGERTMPStamp={fingertmp_stamp}\n'
            f'ATTPHOTOStamp=9999\n'
            f'USERStamp=0\n'
            f'USERINFOStamp=0\n'
            f'ErrorDelay=30\n'
            f'Delay=10\n'
            f'TransTimes=00:00;14:05\n'
            f'TransInterval=1\n'
            f'TransFlag=1111111100\n'
            f'TimeZone={tz_offset}\n'
            f'SyncTime=3600\n'
            f'Realtime=1\n'
            f'Encrypt=None\n'
        )
        return adms_http_response(options)

    def post(self, request, *args, **kwargs):
        sn = request.GET.get('SN', '').strip()
        table = request.GET.get('table', '').strip().upper()

        if not sn:
            return adms_http_response('ERROR', status=400)

        device = get_or_create_device(sn, request)

        try:
            body = request.body.decode('utf-8', errors='replace')
        except Exception as exc:
            logger.error('Failed to decode request body: %s', exc)
            return adms_http_response('ERROR', status=400)

        logger.info('Data push from SN=%s table=%s length=%d', sn, table, len(body))
        logger.debug('Raw body:\n%s', body)

        try:
            if table == 'ATTLOG' or (not table and _looks_like_attlog(body)):
                count = parse_attlog_body(body, device)
                return adms_http_response(f'OK:{count}')

            if table in ('USERINFO', 'USER'):
                count = parse_userinfo(body, device)
                logger.info('%s processed %d record(s) from SN=%s', table, count, sn)

            elif table in ('BIOPHOTO', 'BIODATA', 'FP', 'FINGERTMP'):
                fp_count = parse_fp_body(body, device)
                logger.info(
                    'Fingerprint template(s) from SN=%s table=%s — %d updated',
                    sn, table, fp_count,
                )

            elif table == 'OPERLOG':
                if 'name=' in body.lower() or body.strip().startswith('USER'):
                    user_count = parse_userinfo(body, device)
                    if user_count:
                        logger.info('OPERLOG user records processed %d from SN=%s', user_count, sn)

                fp_from_operlog = parse_operlog_body(body, device)
                att_count = 0
                other_lines = 0
                for line in body.strip().splitlines():
                    line = line.strip()
                    if not line:
                        continue
                    if line.startswith(('USER', 'FP', 'FACE', 'Face', 'OPLOG', 'BIOPHOTO')):
                        if not _looks_like_attlog(line):
                            continue
                    if _looks_like_attlog(line):
                        att_count += parse_attlog_body(line, device)
                    else:
                        other_lines += 1
                logger.info(
                    'OPERLOG from SN=%s: %d attendance, %d FP events, %d other lines',
                    sn, att_count, fp_from_operlog, other_lines,
                )
                if att_count:
                    return adms_http_response(f'OK:{att_count}')

            else:
                logger.warning('Unknown table=%s from SN=%s — acknowledged anyway', table, sn)
                log_biometric_event(
                    action='unexpected_table',
                    level='warning',
                    device=device,
                    message=f'Unexpected ADMS table {table or "UNKNOWN"} received.',
                    metadata={'table': table, 'sample': body[:200]},
                )

        except Exception as exc:
            logger.exception('Error processing ADMS post SN=%s table=%s: %s', sn, table, exc)

        return adms_http_response('OK')


@method_decorator(csrf_exempt, name='dispatch')
class GetRequestView(View):
    def get(self, request, *args, **kwargs):
        sn = request.GET.get('SN', '').strip()
        if sn:
            device = get_or_create_device(sn, request)
            logger.debug('Heartbeat / command poll from SN=%s', sn)
            # Device polls here every few seconds — pull USERINFO periodically so
            # locally registered users appear in HR device conflicts.
            request_userinfo_sync(device)
            request_operlog_pull(sn)
            pending = pop_device_command(sn)
            if pending:
                logger.info('Sending command to SN=%s: %s', sn, pending.strip())
                return adms_http_response(pending)
        return adms_http_response('OK')


@method_decorator(csrf_exempt, name='dispatch')
class DeviceCmdView(View):
    def post(self, request, *args, **kwargs):
        sn = request.GET.get('SN', '').strip()
        try:
            body = request.body.decode('utf-8', errors='replace')
        except Exception:
            body = ''

        cmd_id = None
        return_code = None

        for source in (request.GET,):
            if not cmd_id and source.get('ID'):
                try:
                    cmd_id = int(source.get('ID'))
                except (ValueError, TypeError):
                    pass
            if return_code is None and source.get('Return') is not None:
                return_code = str(source.get('Return')).strip()

        for token in body.replace('\n', '&').split('&'):
            token = token.strip()
            if token.startswith('ID=') and cmd_id is None:
                try:
                    cmd_id = int(token.split('=', 1)[1])
                except ValueError:
                    pass
            elif token.startswith('Return=') and return_code is None:
                return_code = token.split('=', 1)[1].strip()

        original_cmd = None
        if sn and cmd_id is not None:
            original_cmd = record_command_result(sn, cmd_id, return_code or '')

        logger.info(
            'Command result from SN=%s: %s (Return=%s, cmd=%s)',
            sn, body, return_code or '?', original_cmd or '?',
        )
        return adms_http_response('OK')
