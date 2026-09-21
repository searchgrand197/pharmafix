"""India financial-year holiday suggestions (Nager.Date + India catalog fallback)."""

from __future__ import annotations

import logging
import re
from collections import defaultdict
from datetime import date
from typing import Any

import requests
from django.core.cache import cache
from django.utils import timezone

from apps.hr.india_holiday_catalog import india_catalog_holidays_for_year

logger = logging.getLogger(__name__)

NAGER_COUNTRY = 'IN'
NAGER_BASE_URL = 'https://date.nager.at/api/v3/PublicHolidays'
NAGER_TIMEOUT_SECONDS = 8
NAGER_CACHE_TTL = 60 * 60 * 24  # 24 hours
FY_LABEL_RE = re.compile(r'^(\d{4})-(\d{2})$')


class HolidaySuggestionsError(Exception):
    """Raised when FY label cannot be parsed."""


def resolve_india_fy(
    fy_label: str | None = None,
    *,
    today: date | None = None,
) -> tuple[str, date, date, list[int]]:
    """
    Resolve an India financial year (1 Apr – 31 Mar).

    Returns (fy_label, start, end, calendar_years_to_fetch).
    Example: ('2026-27', 2026-04-01, 2027-03-31, [2026, 2027]).
    """
    if fy_label:
        match = FY_LABEL_RE.match(fy_label.strip())
        if not match:
            raise HolidaySuggestionsError(
                'Invalid fy. Use format YYYY-YY (e.g. 2026-27 for Apr 2026 – Mar 2027).'
            )
        start_year = int(match.group(1))
        end_suffix = int(match.group(2))
        expected_suffix = (start_year + 1) % 100
        if end_suffix != expected_suffix:
            raise HolidaySuggestionsError(
                f'Invalid fy range. Expected {start_year}-{expected_suffix:02d}.'
            )
    else:
        day = today or timezone.localdate()
        start_year = day.year if day.month >= 4 else day.year - 1

    end_year = start_year + 1
    label = f'{start_year}-{end_year % 100:02d}'
    start = date(start_year, 4, 1)
    end = date(end_year, 3, 31)
    return label, start, end, [start_year, end_year]


def shift_india_fy(fy_label: str, delta: int) -> str:
    _label, start, _end, _years = resolve_india_fy(fy_label)
    start_year = start.year + delta
    return f'{start_year}-{(start_year + 1) % 100:02d}'


def _nager_cache_key(year: int) -> str:
    return f'nager:{NAGER_COUNTRY}:{year}'


def _map_nager_rows(raw: list) -> list[dict[str, Any]]:
    mapped: list[dict[str, Any]] = []
    for row in raw:
        if not isinstance(row, dict):
            continue
        day = (row.get('date') or '')[:10]
        if len(day) < 10:
            continue
        types = row.get('types') or []
        if not isinstance(types, list):
            types = [str(types)]
        mapped.append({
            'date': day,
            'name': (row.get('name') or row.get('localName') or 'Holiday').strip(),
            'local_name': (row.get('localName') or row.get('name') or '').strip(),
            'types': [str(t) for t in types],
            'source': 'nager',
        })
    return mapped


def fetch_nager_public_holidays(year: int) -> list[dict[str, Any]]:
    """
    Fetch India public holidays for a calendar year from Nager.Date.

    Nager currently does not support IN and returns HTTP 204 with an empty body.
    That is treated as an empty list (not an error) so the India catalog can fill in.
    """
    cache_key = _nager_cache_key(year)
    cached = cache.get(cache_key)
    if cached is not None:
        return cached

    url = f'{NAGER_BASE_URL}/{year}/{NAGER_COUNTRY}'
    response = requests.get(
        url,
        timeout=NAGER_TIMEOUT_SECONDS,
        headers={'Accept': 'application/json', 'User-Agent': 'curevice-hr/1.0'},
    )
    # Unsupported country → 204 No Content (empty body)
    if response.status_code == 204 or not (response.content or b'').strip():
        mapped: list[dict[str, Any]] = []
        cache.set(cache_key, mapped, NAGER_CACHE_TTL)
        return mapped

    response.raise_for_status()
    raw = response.json()
    if not isinstance(raw, list):
        raise ValueError('Unexpected Nager.Date response shape')

    mapped = _map_nager_rows(raw)
    cache.set(cache_key, mapped, NAGER_CACHE_TTL)
    return mapped


def fetch_suggestions_for_year(year: int) -> tuple[list[dict[str, Any]], str]:
    """
    Return (holidays, source_label) for a calendar year.

    Prefer Nager when it returns data; otherwise use the curated India catalog.
    """
    try:
        nager_rows = fetch_nager_public_holidays(year)
    except Exception as exc:  # noqa: BLE001
        logger.warning('Nager.Date holiday fetch failed for %s/%s: %s', year, NAGER_COUNTRY, exc)
        nager_rows = []

    if nager_rows:
        return nager_rows, 'nager.date'

    catalog_rows = india_catalog_holidays_for_year(year)
    return catalog_rows, 'india_catalog'


def _serialize_existing(holiday) -> dict[str, Any]:
    from apps.hr.serializers import OrganizationHolidaySerializer

    return OrganizationHolidaySerializer(holiday).data


def build_holiday_suggestions(
    *,
    fy: str | None = None,
    existing_holidays_qs,
    today: date | None = None,
) -> dict[str, Any]:
    """
    Merge holiday suggestions with existing OrganizationHoliday rows for an India FY.

    Tries Nager.Date first; when IN is unsupported/empty, uses the curated India catalog.
    """
    fy_label, start, end, years = resolve_india_fy(fy, today=today)

    existing_rows = list(
        existing_holidays_qs.filter(date__gte=start, date__lte=end).order_by('date', 'name')
    )
    existing_by_date: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for holiday in existing_rows:
        existing_by_date[holiday.date.isoformat()].append(_serialize_existing(holiday))

    suggestions_by_date: dict[str, list[dict[str, Any]]] = defaultdict(list)
    sources_used: set[str] = set()
    source_error: str | None = None

    try:
        for year in years:
            items, source_label = fetch_suggestions_for_year(year)
            sources_used.add(source_label)
            for item in items:
                day = date.fromisoformat(item['date'])
                if start <= day <= end:
                    suggestions_by_date[item['date']].append(item)
    except Exception as exc:  # noqa: BLE001 — calendar must still show saved holidays
        logger.warning('Holiday suggestions failed for FY %s: %s', fy_label, exc)
        source_error = (
            'Unable to load government holiday suggestions right now. '
            'Showing saved holidays only. You can still create custom holidays.'
        )

    if not suggestions_by_date and not source_error:
        source_error = (
            'No holiday suggestions are available for this financial year yet. '
            'You can still create custom holidays.'
        )

    all_dates = sorted(set(suggestions_by_date) | set(existing_by_date))
    days: list[dict[str, Any]] = []
    for day_iso in all_dates:
        existing = existing_by_date.get(day_iso, [])
        days.append({
            'date': day_iso,
            'suggestions': suggestions_by_date.get(day_iso, []),
            'existing': existing,
            'already_created': bool(existing),
        })

    if 'nager.date' in sources_used and 'india_catalog' not in sources_used:
        source = 'nager.date'
    elif 'india_catalog' in sources_used:
        source = 'india_catalog'
    else:
        source = 'nager.date'

    return {
        'fy': fy_label,
        'start': start.isoformat(),
        'end': end.isoformat(),
        'source': source,
        'country': NAGER_COUNTRY,
        'source_error': source_error,
        'days': days,
    }
