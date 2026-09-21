"""
Dashboard and analytics built exclusively from DailyAttendance summaries.
Punch data is never aggregated directly for metrics — only via the calculation engine.
"""

from __future__ import annotations

import logging
import threading
from calendar import monthrange
from datetime import date
from decimal import Decimal

from django.db.models import Count, Q
from django.utils import timezone

from apps.hr.attendance_compliance import ComplianceCalculationResult
from apps.hr.attendance_engine import (
    AttendanceCalculationService,
    compute_metrics_from_check_times,
    recalculate_daily_attendance,
)
from apps.hr.attendance_policy import policy_documentation
from apps.hr.models import DailyAttendance, Employee

logger = logging.getLogger(__name__)

# SQLite (and other backends) cannot run two rebuild_day() transactions in parallel.
_day_rebuild_lock = threading.Lock()
_day_rebuilt_keys: set[tuple[str, str]] = set()


def invalidate_day_rebuild_cache() -> None:
    """Clear in-process day rebuild cache after punches/summaries change."""
    with _day_rebuild_lock:
        _day_rebuilt_keys.clear()


def _active_employees_queryset(hospital_id=None):
    qs = Employee.objects.filter(status='active')
    if hospital_id:
        qs = qs.filter(hospital_id=hospital_id)
    return qs


def _scheduled_active_employees_queryset(hospital_id=None):
    """Active employees with a primary shift on the Employee record (attendance roster)."""
    return _active_employees_queryset(hospital_id).filter(shift__isnull=False)


def _not_yet_joined_filter(day: date) -> Q:
    return Q(joining_date_confirmed__gt=day) | Q(
        joining_date_confirmed__isnull=True,
        joining_date__gt=day,
    )


def _roster_eligible_employees(day: date, hospital_id=None):
    """Active employees whose effective join date is on or before ``day``."""
    return _active_employees_queryset(hospital_id).exclude(_not_yet_joined_filter(day))


def _scheduled_roster_for_day(day: date, hospital_id=None):
    """Scheduled roster employees eligible for attendance on ``day``."""
    return _roster_eligible_employees(day, hospital_id).filter(shift__isnull=False)


def _scoped_daily_queryset(day: date, hospital_id=None):
    qs = DailyAttendance.objects.filter(date=day).select_related('employee', 'shift')
    if hospital_id:
        qs = qs.filter(employee__hospital_id=hospital_id)
    return qs


def _dashboard_bucket_counts(rows: list) -> dict:
    """
    Count daily dashboard buckets using portal/payroll-aligned derived status.

    ``present`` is a headcount bucket for employees who are on-site today, so
    late and half-day rows still count as present on the dashboard even though
    they remain visible in their more specific buckets as well.
    """
    from decimal import Decimal

    counts = {
        'present': 0,
        'late': 0,
        'half_day': 0,
        'absent': 0,
        'not_started': 0,
        'unscheduled': 0,
        'in_progress': 0,
        'missing_checkout': 0,
        'incomplete': 0,
        'on_leave': 0,
        'overtime': 0,
        'needs_attention': 0,
    }
    for row in rows:
        employee = row.employee
        if row.is_on_leave:
            counts['on_leave'] += 1
            continue

        display = resolve_daily_attendance_display(row, employee)
        status = display.get('status') or row.attendance_status or ''
        late_minutes = int(display.get('late_minutes') or row.late_minutes or 0)
        ot_hours = Decimal(str(display.get('overtime_hours') or row.overtime_hours or '0'))

        if status in {'present', 'late', 'half_day', 'overtime', 'work_from_office'} or late_minutes > 0:
            counts['present'] += 1
        if status == 'late' or late_minutes > 0:
            counts['late'] += 1
        if status == 'half_day':
            counts['half_day'] += 1
        elif status == 'absent':
            counts['absent'] += 1
        elif status == 'not_started':
            counts['not_started'] += 1
        elif status == 'unscheduled':
            counts['unscheduled'] += 1
        elif status == 'in_progress':
            counts['in_progress'] += 1
        elif status == 'missing_checkout' or row.incomplete_checkout:
            counts['missing_checkout'] += 1
        elif status == 'incomplete' or row.incomplete_punches:
            counts['incomplete'] += 1

        if ot_hours > 0 or int(display.get('overtime_minutes') or row.overtime_minutes or 0) > 0:
            counts['overtime'] += 1

        if (
            row.requires_hr_review
            or status in {'late', 'in_progress', 'missing_checkout', 'incomplete'}
            or row.incomplete_punches
            or row.incomplete_checkout
        ):
            counts['needs_attention'] += 1

    return counts


def _rebuild_cache_key(day: date, hospital_id=None) -> tuple[str, str]:
    return (day.isoformat(), str(hospital_id or ''))


def ensure_day_summaries(day: date, hospital_id=None, *, force: bool = False, admin_override: bool = False) -> int:
    """Rebuild summary rows for all active employees on a day (serialized per process)."""
    if day > timezone.localdate():
        return 0

    cache_key = _rebuild_cache_key(day, hospital_id)
    with _day_rebuild_lock:
        if not force and cache_key in _day_rebuilt_keys:
            return DailyAttendance.objects.filter(
                date=day,
                employee__status='active',
                **({'employee__hospital_id': hospital_id} if hospital_id else {}),
            ).count()

        employees_qs = _active_employees_queryset(hospital_id)
        not_yet_joined = _not_yet_joined_filter(day)
        if force:
            DailyAttendance.objects.filter(employee__in=employees_qs.filter(not_yet_joined), date=day).delete()
        employees = employees_qs.exclude(not_yet_joined)
        records = AttendanceCalculationService.rebuild_day(day, employees, force=force, admin_override=admin_override)
        _day_rebuilt_keys.add(cache_key)
        logger.info('[AttendanceAnalytics] rebuilt summaries day=%s hospital=%s count=%s', day, hospital_id, len(records))
        return len(records)


def build_dashboard_summary(day: date, hospital_id=None, *, force_rebuild: bool = True) -> dict:
    if force_rebuild and day <= timezone.localdate():
        ensure_day_summaries(day, hospital_id, force=True, admin_override=False)

    active_employees = _active_employees_queryset(hospital_id)
    scheduled_employees = _scheduled_roster_for_day(day, hospital_id)
    active_count = active_employees.count()
    scheduled_count = scheduled_employees.count()
    not_joined_yet_today = _scheduled_active_employees_queryset(hospital_id).filter(
        _not_yet_joined_filter(day),
    ).count()
    qs = _scoped_daily_queryset(day, hospital_id).filter(employee__status='active')
    rows = list(qs)

    bucket_counts = _dashboard_bucket_counts(rows)
    present = bucket_counts['present']
    late = bucket_counts['late']
    half_day = bucket_counts['half_day']
    absent = bucket_counts['absent']
    not_started = bucket_counts['not_started']
    unscheduled = bucket_counts['unscheduled']
    in_progress = bucket_counts['in_progress']
    missing_checkout = bucket_counts['missing_checkout']
    incomplete_only = bucket_counts['incomplete']
    on_leave = bucket_counts['on_leave']
    overtime = bucket_counts['overtime']
    needs_attention = bucket_counts['needs_attention']

    records_count = len(rows)
    scheduled_records = sum(1 for row in rows if getattr(row.employee, 'shift_id', None))
    # Only scheduled roster employees missing a row count toward absent (not unassigned shift).
    missing_scheduled_rows = max(0, scheduled_count - scheduled_records)
    absent_total = absent + missing_scheduled_rows

    checked_in_ids = {
        row.employee_id for row in rows if row.first_check_in is not None
    }
    on_leave_ids = {row.employee_id for row in rows if row.is_on_leave}
    not_started_ids = {
        row.employee_id
        for row in rows
        if (resolve_daily_attendance_display(row, row.employee).get('status') or row.attendance_status) == 'not_started'
    }
    not_checked_in = (
        scheduled_employees
        .exclude(id__in=checked_in_ids)
        .exclude(id__in=on_leave_ids)
        .exclude(id__in=not_started_ids)
        .count()
    )

    return {
        'date': day.isoformat(),
        'active_employees': active_count,
        'scheduled_employees': scheduled_count,
        'present_today': present,
        'late_employees': late,
        'half_day_today': half_day,
        'absent_today': absent_total,
        'not_started_today': not_started,
        'not_joined_yet_today': not_joined_yet_today,
        'unscheduled_today': unscheduled,
        'in_progress_today': in_progress,
        'missing_checkout_today': missing_checkout,
        'incomplete_only': incomplete_only,
        # Legacy combined metric (incomplete + in-progress + missing checkout rows).
        'incomplete_punches': incomplete_only + in_progress + missing_checkout,
        'on_leave_today': on_leave,
        'needs_attention': needs_attention + not_checked_in,
        'needs_attention_records': needs_attention,
        'attendance_policy': policy_documentation(),
        'overtime_employees': overtime,
        'employees_not_checked_in': not_checked_in,
        'on_roster': scheduled_count,
        'total_records': records_count,
        'summary_only': True,
    }


def build_department_stats(day: date, hospital_id=None, *, force_rebuild: bool = False) -> list[dict]:
    if force_rebuild and day <= timezone.localdate():
        ensure_day_summaries(day, hospital_id, force=True, admin_override=False)

    qs = _scoped_daily_queryset(day, hospital_id).filter(employee__status='active')
    rows = (
        qs.values('employee__department')
        .annotate(
            total=Count('id'),
            present=Count('id', filter=Q(attendance_status='present')),
            late=Count('id', filter=Q(attendance_status='late') | Q(late_minutes__gt=0)),
            half_day=Count('id', filter=Q(attendance_status='half_day')),
            absent=Count('id', filter=Q(attendance_status='absent')),
            in_progress=Count('id', filter=Q(attendance_status='in_progress')),
            missing_checkout=Count('id', filter=Q(attendance_status='missing_checkout')),
            incomplete=Count('id', filter=Q(attendance_status='incomplete')),
            on_leave=Count('id', filter=Q(is_on_leave=True)),
            overtime=Count('id', filter=Q(overtime_hours__gt=0) | Q(overtime_minutes__gt=0)),
        )
        .order_by('employee__department')
    )
    return [
        {
            'department': row['employee__department'] or 'Unassigned',
            'total': row['total'],
            'present': row['present'],
            'late': row['late'],
            'half_day': row['half_day'],
            'absent': row['absent'],
            'in_progress': row['in_progress'],
            'missing_checkout': row['missing_checkout'],
            'incomplete': row['incomplete'],
            'on_leave': row['on_leave'],
            'overtime': row['overtime'],
        }
        for row in rows
    ]


def _calendar_day_health(stats: dict, *, is_weekend: bool) -> str:
    """Dominant health key for calendar cell color coding."""
    if is_weekend and stats.get('total', 0) == 0:
        return 'weekend'
    total = stats.get('total') or 0
    if total == 0:
        return 'weekend' if is_weekend else 'empty'
    holiday = stats.get('holiday') or 0
    weekend_status = stats.get('weekend_status') or 0
    if holiday > 0 and holiday >= total * 0.5:
        return 'holiday'
    if weekend_status >= total * 0.5:
        return 'weekend'
    absent = stats.get('absent') or 0
    late = stats.get('late') or 0
    present = stats.get('present') or 0
    overtime = stats.get('overtime') or 0
    incomplete = stats.get('incomplete') or 0
    missing_checkout = stats.get('missing_checkout') or 0
    in_progress = stats.get('in_progress') or 0
    if absent / total >= 0.35:
        return 'absent'
    if missing_checkout / total >= 0.1:
        return 'incomplete'
    if late / total >= 0.2:
        return 'late'
    if (incomplete + in_progress) / total >= 0.15:
        return 'incomplete'
    if overtime / total >= 0.25:
        return 'overtime'
    if present / total >= 0.55:
        return 'present'
    if is_weekend:
        return 'weekend'
    return 'neutral'


def build_calendar_month(
    year: int,
    month: int,
    hospital_id=None,
    *,
    department: str = '',
    shift_id: str = '',
    status: str = '',
    force_rebuild: bool = False,
) -> dict:
    _, last_day = monthrange(year, month)
    start = date(year, month, 1)
    end = date(year, month, last_day)
    today = timezone.localdate()

    if force_rebuild:
        day = start
        while day <= end and day <= today:
            ensure_day_summaries(day, hospital_id, force=True, admin_override=False)
            day = date.fromordinal(day.toordinal() + 1)

    qs = DailyAttendance.objects.filter(date__gte=start, date__lte=end).select_related('employee')
    if hospital_id:
        qs = qs.filter(employee__hospital_id=hospital_id)
    if department:
        qs = qs.filter(employee__department__icontains=department)
    if shift_id:
        qs = qs.filter(shift_id=shift_id)
    if status:
        qs = qs.filter(attendance_status=status)

    day_stats: dict[str, dict] = {}
    for row in qs.values('date').annotate(
        total=Count('id'),
        present=Count('id', filter=Q(attendance_status='present')),
        late=Count('id', filter=Q(attendance_status='late') | Q(late_minutes__gt=0)),
        half_day=Count('id', filter=Q(attendance_status='half_day')),
        absent=Count('id', filter=Q(attendance_status='absent')),
        in_progress=Count('id', filter=Q(attendance_status='in_progress')),
        missing_checkout=Count('id', filter=Q(attendance_status='missing_checkout')),
        incomplete=Count('id', filter=Q(attendance_status='incomplete')),
        on_leave=Count('id', filter=Q(is_on_leave=True)),
        overtime=Count('id', filter=Q(overtime_hours__gt=0) | Q(overtime_minutes__gt=0)),
        holiday=Count('id', filter=Q(attendance_status='holiday')),
        weekend_status=Count('id', filter=Q(attendance_status='weekend')),
    ):
        key = row['date'].isoformat()
        is_weekend = row['date'].weekday() >= 5
        stats = {
            'date': key,
            'total': row['total'],
            'present': row['present'],
            'late': row['late'],
            'half_day': row['half_day'],
            'absent': row['absent'],
            'in_progress': row['in_progress'],
            'missing_checkout': row['missing_checkout'],
            'incomplete': row['incomplete'],
            'on_leave': row['on_leave'],
            'overtime': row['overtime'],
            'holiday': row['holiday'],
            'weekend_status': row['weekend_status'],
            'is_weekend': is_weekend,
            'is_future': row['date'] > today,
        }
        stats['health'] = _calendar_day_health(stats, is_weekend=is_weekend)
        day_stats[key] = stats

    # Ensure every calendar day has metadata (weekends / future days without rows).
    day = start
    while day <= end:
        key = day.isoformat()
        is_weekend = day.weekday() >= 5
        if key not in day_stats:
            empty = {
                'date': key,
                'total': 0,
                'present': 0,
                'late': 0,
                'half_day': 0,
                'absent': 0,
                'in_progress': 0,
                'missing_checkout': 0,
                'incomplete': 0,
                'on_leave': 0,
                'overtime': 0,
                'holiday': 0,
                'weekend_status': 0,
                'is_weekend': is_weekend,
                'is_future': day > today,
            }
            empty['health'] = _calendar_day_health(empty, is_weekend=is_weekend)
            day_stats[key] = empty
        day = date.fromordinal(day.toordinal() + 1)

    month_totals = {
        'present': sum(d.get('present', 0) for d in day_stats.values()),
        'absent': sum(d.get('absent', 0) for d in day_stats.values()),
        'late': sum(d.get('late', 0) for d in day_stats.values()),
        'half_day': sum(d.get('half_day', 0) for d in day_stats.values()),
        'overtime': sum(d.get('overtime', 0) for d in day_stats.values()),
        'in_progress': sum(d.get('in_progress', 0) for d in day_stats.values()),
        'missing_checkout': sum(d.get('missing_checkout', 0) for d in day_stats.values()),
        'incomplete': sum(d.get('incomplete', 0) for d in day_stats.values()),
    }

    return {
        'year': year,
        'month': month,
        'start': start.isoformat(),
        'end': end.isoformat(),
        'days': day_stats,
        'month_totals': month_totals,
        'summary_only': True,
    }


_PORTAL_STALE_STATUSES = frozenset({
    'in_progress',
    'missing_checkout',
    'incomplete',
    'absent',
})


def _should_derive_portal_metrics(row) -> bool:
    """Recompute display metrics when punches exist but summary row was not finalized."""
    if not (row.first_check_in and row.last_check_out and row.last_check_out > row.first_check_in):
        return False
    if row.attendance_status in _PORTAL_STALE_STATUSES:
        return True
    if not row.total_work_hours or row.total_work_hours <= 0:
        return True
    return False


def resolve_daily_attendance_display(row, employee: Employee) -> dict:
    """Portal-aligned metrics for payroll and HR summaries (DailyAttendance source)."""
    return _portal_history_entry(row, employee)


def _portal_history_entry(row, employee: Employee) -> dict:
    status = row.attendance_status
    late_minutes = row.late_minutes
    overtime_hours = row.overtime_hours
    overtime_minutes = row.overtime_minutes
    worked_hours = row.total_work_hours

    if _should_derive_portal_metrics(row):
        try:
            shift = row.shift if getattr(row, 'shift_id', None) else employee.shift
            metrics = compute_metrics_from_check_times(
                employee,
                row.date,
                row.first_check_in,
                row.last_check_out,
                shift,
            )
            status = metrics['attendance_status']
            late_minutes = metrics['late_minutes']
            overtime_hours = metrics['overtime_hours']
            overtime_minutes = metrics['overtime_minutes']
            worked_hours = metrics['total_work_hours']
        except Exception:
            logger.exception(
                '[EmployeePortal] failed to derive attendance metrics employee=%s date=%s',
                employee.id,
                row.date,
            )

    return {
        'date': row.date.isoformat(),
        'status': status,
        'worked_hours': str(worked_hours) if worked_hours is not None else None,
        'late_minutes': late_minutes,
        'overtime_hours': str(overtime_hours) if overtime_hours is not None else None,
        'overtime_minutes': overtime_minutes,
        'check_in': row.first_check_in.isoformat() if row.first_check_in else None,
        'check_out': row.last_check_out.isoformat() if row.last_check_out else None,
        'attendance_source': row.attendance_source,
        'incomplete_checkout': row.incomplete_checkout,
        **_shift_for_attendance_row(row, employee),
    }


def _serialize_shift(shift) -> dict:
    """Shift fields for portal/HR attendance history rows."""
    if not shift:
        return {
            'shift_name': None,
            'shift_start': None,
            'shift_end': None,
            'shift_timing': None,
        }
    start = shift.start_time
    end = shift.end_time
    timing = None
    if start and end:
        timing = f'{start.strftime("%H:%M")} – {end.strftime("%H:%M")}'
    return {
        'shift_name': shift.name,
        'shift_start': str(start) if start else None,
        'shift_end': str(end) if end else None,
        'shift_timing': timing,
    }


def _shift_for_attendance_row(row, employee: Employee) -> dict:
    shift = row.shift if getattr(row, 'shift_id', None) else None
    if shift is None and employee.shift_id:
        shift = employee.shift
    return _serialize_shift(shift)


def _ensure_employee_month_summaries(employee: Employee, start: date, end: date) -> None:
    """Create missing DailyAttendance rows for past days in the employee's period."""
    today = timezone.localdate()
    end_cap = min(end, today)
    if start > end_cap:
        return

    existing_dates = set(
        DailyAttendance.objects.filter(
            employee=employee,
            date__gte=start,
            date__lte=end_cap,
        ).values_list('date', flat=True)
    )
    day = start
    while day <= end_cap:
        if day not in existing_dates:
            recalculate_daily_attendance(employee, day, force=False)
        day = date.fromordinal(day.toordinal() + 1)


def _incomplete_days_from_history(portal_history: list[dict]) -> int:
    """Display-only incomplete count; not part of payroll attendance totals."""
    return sum(
        1 for row in portal_history
        if row['status'] in {'incomplete', 'in_progress', 'missing_checkout'} or row.get('incomplete_checkout')
    )


def _month_finalized_for_analytics(employee: Employee, month: str | None, end: date) -> bool:
    from apps.hr.attendance_service import _month_finalized_for_employee

    month_key = str(month)[:7] if month else end.strftime('%Y-%m')
    return _month_finalized_for_employee(employee, month_key)


def _empty_employee_period_bundle(
    employee: Employee,
    period_start: date,
    period_end: date,
    *,
    month_finalized: bool = False,
):
    """Zeroed summary when the employee has not joined within the requested window."""
    from apps.hr.attendance_service import AttendanceSummary

    summary = AttendanceSummary(
        present_days=Decimal('0.00'),
        absent_days=Decimal('0.00'),
        leave_days=Decimal('0.00'),
        holiday_days=Decimal('0.00'),
        late_days=Decimal('0.00'),
        overtime_hours=Decimal('0.00'),
        working_hours=Decimal('0.00'),
        half_days=Decimal('0.00'),
        working_days=0,
        period_start=period_start,
        period_end=period_end,
        month_finalized=month_finalized,
        uses_finalized_rows_only=month_finalized,
    )
    return summary, ComplianceCalculationResult()


def build_employee_analytics(
    employee_id,
    *,
    month: str | None = None,
    date_from: str | None = None,
    date_to: str | None = None,
) -> dict:
    try:
        employee = Employee.objects.select_related('shift').get(pk=employee_id)
    except Employee.DoesNotExist:
        return None

    today = timezone.localdate()
    if month:
        year_s, month_s = str(month)[:7].split('-')
        year, mon = int(year_s), int(month_s)
        start = date(year, mon, 1)
        _, last = monthrange(year, mon)
        end = date(year, mon, last)
        if year == today.year and mon == today.month:
            end = today
    else:
        start = date.fromisoformat(str(date_from)[:10]) if date_from else today.replace(day=1)
        end = date.fromisoformat(str(date_to)[:10]) if date_to else today

    from apps.hr.attendance_service import (
        attendance_compliance_as_portal_dict,
        attendance_summary_as_portal_dict,
        build_attendance_summary_bundle,
        resolve_attendance_period,
    )

    period_start, period_end = resolve_attendance_period(employee, start, end)
    month_finalized = _month_finalized_for_analytics(employee, month, end)

    if period_start > period_end:
        employee_shift = _serialize_shift(employee.shift)
        canonical_summary, compliance = _empty_employee_period_bundle(
            employee,
            start,
            end,
            month_finalized=month_finalized,
        )
        return {
            'employee': {
                'id': str(employee.id),
                'name': employee.name,
                'employee_id': employee.employee_id,
                'department': employee.department,
                **employee_shift,
            },
            'period': {
                'start': start.isoformat(),
                'end': end.isoformat(),
            },
            'summary': attendance_summary_as_portal_dict(
                canonical_summary,
                incomplete_days=0,
            ),
            'attendance_compliance': attendance_compliance_as_portal_dict(compliance),
            'history': [],
        }

    # Fill missing summary rows only (no force-recalc — preserves HR manual corrections).
    _ensure_employee_month_summaries(employee, period_start, period_end)

    qs = (
        DailyAttendance.objects.filter(employee=employee, date__gte=period_start, date__lte=period_end)
        .select_related('shift')
        .order_by('date')
    )
    if month_finalized:
        qs = qs.filter(finalized=True)
    history_rows = list(qs)
    employee_shift = _serialize_shift(employee.shift)
    portal_history = [_portal_history_entry(row, employee) for row in history_rows]
    canonical_summary, compliance = build_attendance_summary_bundle(employee, start, end)

    return {
        'employee': {
            'id': str(employee.id),
            'name': employee.name,
            'employee_id': employee.employee_id,
            'department': employee.department,
            **employee_shift,
        },
        'period': {
            'start': canonical_summary.period_start.isoformat(),
            'end': canonical_summary.period_end.isoformat(),
        },
        'summary': attendance_summary_as_portal_dict(
            canonical_summary,
            incomplete_days=_incomplete_days_from_history(portal_history),
        ),
        'attendance_compliance': attendance_compliance_as_portal_dict(compliance),
        'history': portal_history,
    }
