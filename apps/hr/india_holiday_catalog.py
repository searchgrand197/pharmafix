"""
Curated India public / gazetted holiday suggestions.

Nager.Date does not currently publish India (IN returns HTTP 204). This catalog
covers fixed national holidays plus widely observed festivals for recent FYs so
HR can review and adopt them. Dates for lunar festivals are best-effort gazetted
dates and may be adjusted by HR when creating.
"""

from __future__ import annotations

from typing import Any

# year -> list of suggestion dicts (same shape as Nager mapper output)
INDIA_PUBLIC_HOLIDAYS_BY_YEAR: dict[int, list[dict[str, Any]]] = {
    2025: [
        {'date': '2025-01-01', 'name': "New Year's Day", 'local_name': 'New Year', 'types': ['Optional'], 'source': 'india_catalog'},
        {'date': '2025-01-26', 'name': 'Republic Day', 'local_name': 'Republic Day', 'types': ['Public'], 'source': 'india_catalog'},
        {'date': '2025-03-14', 'name': 'Holi', 'local_name': 'Holi', 'types': ['Public'], 'source': 'india_catalog'},
        {'date': '2025-03-31', 'name': 'Eid al-Fitr', 'local_name': 'Id-ul-Fitr', 'types': ['Public'], 'source': 'india_catalog'},
        {'date': '2025-04-10', 'name': 'Mahavir Jayanti', 'local_name': 'Mahavir Jayanti', 'types': ['Public'], 'source': 'india_catalog'},
        {'date': '2025-04-18', 'name': 'Good Friday', 'local_name': 'Good Friday', 'types': ['Public'], 'source': 'india_catalog'},
        {'date': '2025-05-12', 'name': 'Buddha Purnima', 'local_name': 'Buddha Purnima', 'types': ['Public'], 'source': 'india_catalog'},
        {'date': '2025-06-07', 'name': 'Eid al-Adha', 'local_name': 'Bakrid', 'types': ['Public'], 'source': 'india_catalog'},
        {'date': '2025-07-06', 'name': 'Muharram', 'local_name': 'Muharram', 'types': ['Public'], 'source': 'india_catalog'},
        {'date': '2025-08-15', 'name': 'Independence Day', 'local_name': 'Independence Day', 'types': ['Public'], 'source': 'india_catalog'},
        {'date': '2025-08-16', 'name': 'Janmashtami', 'local_name': 'Janmashtami', 'types': ['Public'], 'source': 'india_catalog'},
        {'date': '2025-09-05', 'name': 'Milad un-Nabi', 'local_name': 'Id-e-Milad', 'types': ['Public'], 'source': 'india_catalog'},
        {'date': '2025-10-02', 'name': 'Mahatma Gandhi Jayanti', 'local_name': 'Gandhi Jayanti', 'types': ['Public'], 'source': 'india_catalog'},
        {'date': '2025-10-02', 'name': 'Dussehra', 'local_name': 'Vijayadashami', 'types': ['Public'], 'source': 'india_catalog'},
        {'date': '2025-10-20', 'name': 'Diwali', 'local_name': 'Deepavali', 'types': ['Public'], 'source': 'india_catalog'},
        {'date': '2025-11-05', 'name': "Guru Nanak's Birthday", 'local_name': 'Gurpurab', 'types': ['Public'], 'source': 'india_catalog'},
        {'date': '2025-12-25', 'name': 'Christmas Day', 'local_name': 'Christmas', 'types': ['Public'], 'source': 'india_catalog'},
    ],
    2026: [
        {'date': '2026-01-01', 'name': "New Year's Day", 'local_name': 'New Year', 'types': ['Optional'], 'source': 'india_catalog'},
        {'date': '2026-01-26', 'name': 'Republic Day', 'local_name': 'Republic Day', 'types': ['Public'], 'source': 'india_catalog'},
        {'date': '2026-03-04', 'name': 'Holi', 'local_name': 'Holi', 'types': ['Public'], 'source': 'india_catalog'},
        {'date': '2026-03-21', 'name': 'Eid al-Fitr', 'local_name': 'Id-ul-Fitr', 'types': ['Public'], 'source': 'india_catalog'},
        {'date': '2026-03-31', 'name': 'Mahavir Jayanti', 'local_name': 'Mahavir Jayanti', 'types': ['Public'], 'source': 'india_catalog'},
        {'date': '2026-04-03', 'name': 'Good Friday', 'local_name': 'Good Friday', 'types': ['Public'], 'source': 'india_catalog'},
        {'date': '2026-05-01', 'name': 'Buddha Purnima', 'local_name': 'Buddha Purnima', 'types': ['Public'], 'source': 'india_catalog'},
        {'date': '2026-05-27', 'name': 'Eid al-Adha', 'local_name': 'Bakrid', 'types': ['Public'], 'source': 'india_catalog'},
        {'date': '2026-06-26', 'name': 'Muharram', 'local_name': 'Muharram', 'types': ['Public'], 'source': 'india_catalog'},
        {'date': '2026-08-15', 'name': 'Independence Day', 'local_name': 'Independence Day', 'types': ['Public'], 'source': 'india_catalog'},
        {'date': '2026-09-04', 'name': 'Janmashtami', 'local_name': 'Janmashtami', 'types': ['Public'], 'source': 'india_catalog'},
        {'date': '2026-09-26', 'name': 'Milad un-Nabi', 'local_name': 'Id-e-Milad', 'types': ['Public'], 'source': 'india_catalog'},
        {'date': '2026-10-02', 'name': 'Mahatma Gandhi Jayanti', 'local_name': 'Gandhi Jayanti', 'types': ['Public'], 'source': 'india_catalog'},
        {'date': '2026-10-20', 'name': 'Dussehra', 'local_name': 'Vijayadashami', 'types': ['Public'], 'source': 'india_catalog'},
        {'date': '2026-11-08', 'name': 'Diwali', 'local_name': 'Deepavali', 'types': ['Public'], 'source': 'india_catalog'},
        {'date': '2026-11-24', 'name': "Guru Nanak's Birthday", 'local_name': 'Gurpurab', 'types': ['Public'], 'source': 'india_catalog'},
        {'date': '2026-12-25', 'name': 'Christmas Day', 'local_name': 'Christmas', 'types': ['Public'], 'source': 'india_catalog'},
    ],
    2027: [
        {'date': '2027-01-01', 'name': "New Year's Day", 'local_name': 'New Year', 'types': ['Optional'], 'source': 'india_catalog'},
        {'date': '2027-01-26', 'name': 'Republic Day', 'local_name': 'Republic Day', 'types': ['Public'], 'source': 'india_catalog'},
        {'date': '2027-03-22', 'name': 'Holi', 'local_name': 'Holi', 'types': ['Public'], 'source': 'india_catalog'},
        {'date': '2027-03-10', 'name': 'Eid al-Fitr', 'local_name': 'Id-ul-Fitr', 'types': ['Public'], 'source': 'india_catalog'},
        {'date': '2027-03-21', 'name': 'Mahavir Jayanti', 'local_name': 'Mahavir Jayanti', 'types': ['Public'], 'source': 'india_catalog'},
        {'date': '2027-03-26', 'name': 'Good Friday', 'local_name': 'Good Friday', 'types': ['Public'], 'source': 'india_catalog'},
        {'date': '2027-04-20', 'name': 'Buddha Purnima', 'local_name': 'Buddha Purnima', 'types': ['Public'], 'source': 'india_catalog'},
        {'date': '2027-05-17', 'name': 'Eid al-Adha', 'local_name': 'Bakrid', 'types': ['Public'], 'source': 'india_catalog'},
        {'date': '2027-06-15', 'name': 'Muharram', 'local_name': 'Muharram', 'types': ['Public'], 'source': 'india_catalog'},
        {'date': '2027-08-15', 'name': 'Independence Day', 'local_name': 'Independence Day', 'types': ['Public'], 'source': 'india_catalog'},
        {'date': '2027-08-25', 'name': 'Janmashtami', 'local_name': 'Janmashtami', 'types': ['Public'], 'source': 'india_catalog'},
        {'date': '2027-09-15', 'name': 'Milad un-Nabi', 'local_name': 'Id-e-Milad', 'types': ['Public'], 'source': 'india_catalog'},
        {'date': '2027-10-02', 'name': 'Mahatma Gandhi Jayanti', 'local_name': 'Gandhi Jayanti', 'types': ['Public'], 'source': 'india_catalog'},
        {'date': '2027-10-09', 'name': 'Dussehra', 'local_name': 'Vijayadashami', 'types': ['Public'], 'source': 'india_catalog'},
        {'date': '2027-10-29', 'name': 'Diwali', 'local_name': 'Deepavali', 'types': ['Public'], 'source': 'india_catalog'},
        {'date': '2027-11-14', 'name': "Guru Nanak's Birthday", 'local_name': 'Gurpurab', 'types': ['Public'], 'source': 'india_catalog'},
        {'date': '2027-12-25', 'name': 'Christmas Day', 'local_name': 'Christmas', 'types': ['Public'], 'source': 'india_catalog'},
    ],
    2028: [
        {'date': '2028-01-01', 'name': "New Year's Day", 'local_name': 'New Year', 'types': ['Optional'], 'source': 'india_catalog'},
        {'date': '2028-01-26', 'name': 'Republic Day', 'local_name': 'Republic Day', 'types': ['Public'], 'source': 'india_catalog'},
        {'date': '2028-03-11', 'name': 'Holi', 'local_name': 'Holi', 'types': ['Public'], 'source': 'india_catalog'},
        {'date': '2028-02-27', 'name': 'Eid al-Fitr', 'local_name': 'Id-ul-Fitr', 'types': ['Public'], 'source': 'india_catalog'},
        {'date': '2028-04-07', 'name': 'Mahavir Jayanti', 'local_name': 'Mahavir Jayanti', 'types': ['Public'], 'source': 'india_catalog'},
        {'date': '2028-04-14', 'name': 'Good Friday', 'local_name': 'Good Friday', 'types': ['Public'], 'source': 'india_catalog'},
        {'date': '2028-05-08', 'name': 'Buddha Purnima', 'local_name': 'Buddha Purnima', 'types': ['Public'], 'source': 'india_catalog'},
        {'date': '2028-05-05', 'name': 'Eid al-Adha', 'local_name': 'Bakrid', 'types': ['Public'], 'source': 'india_catalog'},
        {'date': '2028-06-04', 'name': 'Muharram', 'local_name': 'Muharram', 'types': ['Public'], 'source': 'india_catalog'},
        {'date': '2028-08-15', 'name': 'Independence Day', 'local_name': 'Independence Day', 'types': ['Public'], 'source': 'india_catalog'},
        {'date': '2028-08-14', 'name': 'Janmashtami', 'local_name': 'Janmashtami', 'types': ['Public'], 'source': 'india_catalog'},
        {'date': '2028-09-04', 'name': 'Milad un-Nabi', 'local_name': 'Id-e-Milad', 'types': ['Public'], 'source': 'india_catalog'},
        {'date': '2028-10-02', 'name': 'Mahatma Gandhi Jayanti', 'local_name': 'Gandhi Jayanti', 'types': ['Public'], 'source': 'india_catalog'},
        {'date': '2028-09-27', 'name': 'Dussehra', 'local_name': 'Vijayadashami', 'types': ['Public'], 'source': 'india_catalog'},
        {'date': '2028-10-17', 'name': 'Diwali', 'local_name': 'Deepavali', 'types': ['Public'], 'source': 'india_catalog'},
        {'date': '2028-11-02', 'name': "Guru Nanak's Birthday", 'local_name': 'Gurpurab', 'types': ['Public'], 'source': 'india_catalog'},
        {'date': '2028-12-25', 'name': 'Christmas Day', 'local_name': 'Christmas', 'types': ['Public'], 'source': 'india_catalog'},
    ],
}


def india_catalog_holidays_for_year(year: int) -> list[dict[str, Any]]:
    rows = INDIA_PUBLIC_HOLIDAYS_BY_YEAR.get(year, [])
    # Always include fixed national holidays even if year block is missing
    fixed = [
        {'date': f'{year}-01-26', 'name': 'Republic Day', 'local_name': 'Republic Day', 'types': ['Public'], 'source': 'india_catalog'},
        {'date': f'{year}-08-15', 'name': 'Independence Day', 'local_name': 'Independence Day', 'types': ['Public'], 'source': 'india_catalog'},
        {'date': f'{year}-10-02', 'name': 'Mahatma Gandhi Jayanti', 'local_name': 'Gandhi Jayanti', 'types': ['Public'], 'source': 'india_catalog'},
        {'date': f'{year}-12-25', 'name': 'Christmas Day', 'local_name': 'Christmas', 'types': ['Public'], 'source': 'india_catalog'},
    ]
    if rows:
        return [dict(row) for row in rows]
    return [dict(row) for row in fixed]
