"""Repair biometric punch attendance dates and false duplicate flags."""

from __future__ import annotations

from datetime import date

from apps.hr.attendance_engine import recalculate_daily_attendance
from apps.hr.biometric.ingestion import _find_near_duplicate
from apps.hr.biometric.punch_pairing import attendance_date_for
from apps.hr.models import AttendancePunch, Employee


def repair_employee_biometric_punches(employee: Employee, *, dry_run: bool = False) -> dict:
    """
    Re-derive attendance_date for biometric punches and clear false suspicious flags.
    Returns counts of changes made (or that would be made when dry_run=True).
    """
    punches = list(
        AttendancePunch.objects.filter(
            employee=employee,
            source='biometric',
            is_void=False,
        ).order_by('timestamp', 'created_at')
    )
    prior: list[AttendancePunch] = []
    dates_fixed = 0
    suspicious_cleared = 0
    affected_days: set[date] = set()

    for punch in punches:
        shift = punch.shift or employee.shift
        new_date = attendance_date_for(
            employee,
            punch.timestamp,
            punch.punch_type,
            shift,
            prior_punches=prior,
        )
        update_fields: list[str] = []

        if punch.attendance_date != new_date:
            dates_fixed += 1
            if punch.attendance_date:
                affected_days.add(punch.attendance_date)
            affected_days.add(new_date)
            punch.attendance_date = new_date
            if not dry_run:
                update_fields.append('attendance_date')

        if punch.is_suspicious:
            still_dup = _find_near_duplicate(
                employee,
                punch.timestamp,
                punch.punch_type,
                exclude_pk=punch.pk,
            )
            if still_dup is None:
                suspicious_cleared += 1
                affected_days.add(punch.attendance_date or new_date)
                if not dry_run:
                    punch.is_suspicious = False
                    punch.suspicious_reason = ''
                    punch.duplicate_of = None
                update_fields.extend(['is_suspicious', 'suspicious_reason', 'duplicate_of'])

        if update_fields and not dry_run:
            punch.save(update_fields=[*set(update_fields), 'updated_at'])

        prior.append(punch)
        affected_days.add(punch.attendance_date or new_date)

    if not dry_run:
        for day in sorted(d for d in affected_days if d):
            recalculate_daily_attendance(employee, day, force=True)

    return {
        'employee_id': employee.employee_id,
        'punches_scanned': len(punches),
        'dates_fixed': dates_fixed,
        'suspicious_cleared': suspicious_cleared,
        'days_recalculated': len([d for d in affected_days if d]) if not dry_run else 0,
    }


def repair_all_biometric_punches(*, hospital_id=None, dry_run: bool = False) -> list[dict]:
    qs = Employee.objects.filter(
        biometric_pin__gt='',
        biometric_attendance_enabled=True,
    )
    if hospital_id:
        qs = qs.filter(hospital_id=hospital_id)
    return [repair_employee_biometric_punches(emp, dry_run=dry_run) for emp in qs.order_by('employee_id')]
