"""
One-off attendance scenario audit.
Run: python scripts/attendance_audit_scenarios.py
"""
from __future__ import annotations

import json
import os
import sys

import django

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')
django.setup()
from datetime import date, datetime, time, timedelta
from decimal import Decimal
from unittest.mock import patch

from django.db import transaction
from django.utils import timezone

from apps.hr.attendance_engine import calculate_daily_attendance, pair_punches
from apps.hr.attendance_policy import compute_late_metrics, combine_attendance_day_time
from apps.hr.attendance_analytics import build_dashboard_summary
from apps.hr.models import AttendancePunch, DailyAttendance, Employee, Shift
from apps.shared.models import Hospital

AUDIT_DAY = date(2026, 5, 15)  # fixed past day for stable "now" patches
RESULTS = []


def record(name, expected, actual, extra=None):
    ok = expected == actual if not callable(expected) else expected(actual)
    RESULTS.append({
        'name': name,
        'pass': bool(ok),
        'expected': expected if not callable(expected) else '(predicate)',
        'actual': actual,
        'extra': extra or {},
    })
    status = 'PASS' if ok else 'FAIL'
    print(f"[{status}] {name}: expected={expected!r} actual={actual!r} {extra or ''}")


def punch(employee, shift, day, clock, ptype):
    ts = combine_attendance_day_time(day, clock)
    return AttendancePunch.objects.create(
        employee=employee,
        shift=shift,
        attendance_date=day,
        timestamp=ts,
        punch_type=ptype,
        source='biometric',
        device_id='AUDIT',
    )


@transaction.atomic
def main():
    slug = 'audit-attendance-hosp'
    Hospital.objects.filter(slug=slug).delete()
    hospital = Hospital.objects.create(name='Audit Hospital', slug=slug)

    shift = Shift.objects.create(
        hospital=hospital,
        name='Day Shift',
        code='AUDIT09',
        start_time=time(9, 0),
        end_time=time(18, 0),
        grace_minutes=15,
        half_day_hours=4,
        full_day_hours=8,
        overtime_allowed=True,
    )
    night = Shift.objects.create(
        hospital=hospital,
        name='Night',
        code='AUDITNIGHT',
        start_time=time(22, 0),
        end_time=time(6, 0),
        is_overnight=True,
        grace_minutes=15,
        half_day_hours=4,
        full_day_hours=8,
        overtime_allowed=True,
    )

    def emp(code):
        return Employee.objects.create(
            hospital=hospital,
            name=f'Audit {code}',
            employee_id=code,
            status='active',
            shift=shift,
        )

    # --- Phase 4: late metrics (default shift_start basis) ---
    shift_start = combine_attendance_day_time(AUDIT_DAY, time(9, 0))
    for clock, exp_min, exp_late in [
        (time(9, 5), 5, False),
        (time(9, 10), 10, False),
        (time(9, 15), 15, False),
        (time(10, 30), 90, True),
    ]:
        ci = combine_attendance_day_time(AUDIT_DAY, clock)
        lm, il = compute_late_metrics(ci, shift_start, 15)
        record(f'late_{clock}', {'late_minutes': exp_min, 'is_late': exp_late}, {'late_minutes': lm, 'is_late': il})

    # --- Phase 3: status scenarios ---
    scenarios = [
        ('case1_present', lambda e: (punch(e, shift, AUDIT_DAY, time(9, 0), 'IN'), punch(e, shift, AUDIT_DAY, time(18, 0), 'OUT')), 'present'),
        ('case2_late', lambda e: (punch(e, shift, AUDIT_DAY, time(10, 30), 'IN'), punch(e, shift, AUDIT_DAY, time(18, 0), 'OUT')), 'late'),
        ('case3_half_day', lambda e: (punch(e, shift, AUDIT_DAY, time(9, 0), 'IN'), punch(e, shift, AUDIT_DAY, time(12, 0), 'OUT')), 'half_day'),
        ('case4_absent', lambda e: None, 'absent'),
        ('case5_in_progress', lambda e: punch(e, shift, AUDIT_DAY, time(9, 0), 'IN'), 'in_progress'),
        ('case6_missing_checkout', lambda e: punch(e, shift, AUDIT_DAY, time(9, 0), 'IN'), 'missing_checkout'),
    ]
    noon = combine_attendance_day_time(AUDIT_DAY, time(12, 0))
    evening = combine_attendance_day_time(AUDIT_DAY, time(19, 0))

    for name, setup, exp_status in scenarios:
        e = emp(f'AUD-{name}')
        AttendancePunch.objects.filter(employee=e).delete()
        fn = setup(e)
        if callable(fn) and fn is not None and not isinstance(fn, tuple):
            pass
        now_patch = noon if name == 'case5_in_progress' else evening if name == 'case6_missing_checkout' else evening
        with patch('apps.hr.attendance_policy.timezone.now', return_value=now_patch):
            r = calculate_daily_attendance(e, AUDIT_DAY, shift)
        record(name, exp_status, r['attendance_status'], {
            'late_minutes': r.get('late_minutes'),
            'total_hours': str(r.get('total_work_hours')),
            'overtime': str(r.get('overtime_hours')),
        })

    # --- Phase 5: overtime ---
    for out_clock, label in [(time(18, 15), 'ot_15m'), (time(19, 0), 'ot_1h'), (time(21, 0), 'ot_3h')]:
        e = emp(f'AUD-OT-{label}')
        punch(e, shift, AUDIT_DAY, time(9, 0), 'IN')
        punch(e, shift, AUDIT_DAY, out_clock, 'OUT')
        r = calculate_daily_attendance(e, AUDIT_DAY, shift)
        record(label, lambda a, oh=float(r['overtime_hours']): oh > 0, r['overtime_hours'], {'total': str(r['total_work_hours'])})

    # --- Phase 9: night shift ---
    ne = Employee.objects.create(
        hospital=hospital,
        name='Audit Night',
        employee_id='AUD-NIGHT',
        status='active',
        shift=night,
    )
    nd = AUDIT_DAY
    punch(ne, night, nd, time(22, 0), 'IN')
    punch(ne, night, date(2026, 5, 16), time(6, 0), 'OUT')
    r = calculate_daily_attendance(ne, nd, night)
    record('night_shift_status', lambda s: s in ('present', 'late', 'half_day'), r['attendance_status'], {
        'hours': str(r['total_work_hours']),
        'overtime': str(r['overtime_hours']),
    })

    # --- Phase 6: pairing rules ---
    pe = emp('AUD-PAIR')
    punches = [
        punch(pe, shift, AUDIT_DAY, time(9, 0), 'IN'),
        punch(pe, shift, AUDIT_DAY, time(9, 5), 'IN'),
        punch(pe, shift, AUDIT_DAY, time(10, 0), 'OUT'),
        punch(pe, shift, AUDIT_DAY, time(11, 0), 'OUT'),
    ]
    sessions, invalid = pair_punches(list(AttendancePunch.objects.filter(employee=pe).order_by('timestamp')))
    reasons = [x['reason'] for x in invalid]
    record('pair_consecutive_in', 'consecutive_in_without_checkout' in reasons, reasons)
    record('pair_out_without_in', 'out_without_matching_in' in reasons, reasons)

    # --- Data consistency sample ---
    orphan_punches = AttendancePunch.objects.filter(is_void=False).exclude(
        employee_id__in=DailyAttendance.objects.values_list('employee_id', flat=True)
    ).count()

    fails = [x for x in RESULTS if not x['pass']]
    print('\n=== SUMMARY ===')
    print(f"Total: {len(RESULTS)} Pass: {len(RESULTS)-len(fails)} Fail: {len(fails)}")
    print(f"Orphan punch rows (no DailyAttendance for employee): {orphan_punches} (informational)")
    print(json.dumps({'results': RESULTS, 'fail_count': len(fails)}, indent=2))

    # Cleanup audit rows (transaction commits on success)
    AttendancePunch.objects.filter(device_id='AUDIT').delete()
    DailyAttendance.objects.filter(employee__employee_id__startswith='AUD-').delete()
    Employee.objects.filter(employee_id__startswith='AUD-').delete()
    Shift.objects.filter(code__startswith='AUDIT').delete()
    hospital.delete()


if __name__ == '__main__':
    main()
    fails = [r for r in RESULTS if not r['pass']]
    sys.exit(0 if not fails else 1)
