from __future__ import annotations

from datetime import date, timedelta

from django.db.models import Q

from apps.hr.models import Employee, OrganizationHoliday


def employee_holiday_q(employee: Employee) -> Q:
    """Active holidays visible to an employee."""
    hospital_id = getattr(employee, 'hospital_id', None)
    return (
        Q(scope=OrganizationHoliday.SCOPE_NATIONAL)
        | Q(scope=OrganizationHoliday.SCOPE_FESTIVAL, hospital__isnull=True)
        | Q(hospital_id=hospital_id)
    )


def get_active_holiday_for_employee(employee: Employee, day: date) -> OrganizationHoliday | None:
    return (
        OrganizationHoliday.objects.filter(active=True, date=day)
        .filter(employee_holiday_q(employee))
        .order_by('scope', 'name')
        .first()
    )


def holidays_in_range_for_employee(employee: Employee, start: date, end: date):
    return (
        OrganizationHoliday.objects.filter(active=True, date__gte=start, date__lte=end)
        .filter(employee_holiday_q(employee))
        .order_by('date', 'name')
    )


def leave_range_holiday_message(employee: Employee, start_date: date, end_date: date) -> str | None:
    holidays = list(holidays_in_range_for_employee(employee, start_date, end_date)[:8])
    if not holidays:
        return None
    parts = [f'{holiday.name} ({holiday.date.strftime("%d %b %Y")})' for holiday in holidays]
    suffix = '…' if len(holidays) >= 8 else ''
    return (
        'Leave cannot be requested on scheduled holidays. '
        f'Holiday dates in your range: {", ".join(parts)}{suffix}'
    )


def employees_for_holiday(holiday: OrganizationHoliday):
    qs = Employee.objects.filter(status='active')
    if holiday.scope == OrganizationHoliday.SCOPE_NATIONAL:
        return qs
    if holiday.scope == OrganizationHoliday.SCOPE_FESTIVAL and not holiday.hospital_id:
        return qs
    if holiday.hospital_id:
        return qs.filter(hospital_id=holiday.hospital_id)
    return qs.none()


def sync_holiday_attendance(holiday: OrganizationHoliday) -> None:
    from apps.hr.attendance_engine import recalculate_daily_attendance

    for employee in employees_for_holiday(holiday).iterator(chunk_size=200):
        recalculate_daily_attendance(employee, holiday.date)


def sync_holidays_for_date(day: date, *, hospital_id=None) -> None:
    from apps.hr.attendance_engine import recalculate_daily_attendance

    qs = OrganizationHoliday.objects.filter(active=True, date=day)
    if hospital_id:
        qs = qs.filter(
            Q(scope=OrganizationHoliday.SCOPE_NATIONAL)
            | Q(scope=OrganizationHoliday.SCOPE_FESTIVAL, hospital__isnull=True)
            | Q(hospital_id=hospital_id)
        )
    holiday_ids = set(qs.values_list('id', flat=True))
    if not holiday_ids:
        return

    employee_qs = Employee.objects.filter(status='active')
    if hospital_id:
        employee_qs = employee_qs.filter(hospital_id=hospital_id)

    for employee in employee_qs.iterator(chunk_size=200):
        if get_active_holiday_for_employee(employee, day):
            recalculate_daily_attendance(employee, day)


def iter_dates(start: date, end: date):
    current = start
    while current <= end:
        yield current
        current += timedelta(days=1)
