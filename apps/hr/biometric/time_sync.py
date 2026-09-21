"""
Device clock synchronization for ZKTeco / ESSL ADMS.
"""

import logging
import time
from email.utils import formatdate

from django.conf import settings
from django.http import HttpResponse
from django.utils import timezone

logger = logging.getLogger('apps.hr.biometric')


def get_local_now():
    return timezone.localtime()


def get_adms_timezone_offset() -> str:
    override = getattr(settings, 'ADMS_TIMEZONE_MINUTES', None)
    if override is not None:
        minutes = int(override)
        logger.info('ADMS handshake TimeZone=%d minutes (override)', minutes)
        return str(minutes)

    tz_name = getattr(settings, 'TIME_ZONE', 'UTC')
    try:
        from zoneinfo import ZoneInfo
        tz = ZoneInfo(tz_name)
        offset = timezone.localtime(timezone.now(), tz).utcoffset()
        if offset is None:
            return '0'
        minutes = int(offset.total_seconds() / 60)
        logger.info('ADMS handshake TimeZone=%d minutes (%s)', minutes, tz_name)
        return str(minutes)
    except Exception:
        logger.warning('ADMS timezone lookup failed, using default 330 (IST)')
        return '330'


def _format_tz_suffix(dt) -> str:
    offset = dt.utcoffset()
    if offset is None:
        return ''
    total_secs = int(offset.total_seconds())
    sign = '+' if total_secs >= 0 else '-'
    total_secs = abs(total_secs)
    hours, remainder = divmod(total_secs, 3600)
    minutes = remainder // 60
    return f'{sign}{hours:02d}:{minutes:02d}'


def build_time_sync_response() -> str:
    local = get_local_now()
    suffix = _format_tz_suffix(local)
    body = f"Time={local.strftime('%Y-%m-%dT%H:%M:%S')}{suffix}"
    logger.info('Time sync response: %s', body)
    return body


def adms_http_response(content: str, status: int = 200) -> HttpResponse:
    if content and not content.endswith('\n'):
        content = content + '\n'
    response = HttpResponse(content, content_type='text/plain', status=status)
    response['Date'] = formatdate(timeval=time.time(), localtime=False, usegmt=True)
    response['Cache-Control'] = 'no-store'
    response['Pragma'] = 'no-cache'
    return response
