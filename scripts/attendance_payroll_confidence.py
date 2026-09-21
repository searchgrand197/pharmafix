"""
Full-month attendance & payroll confidence validation.

Implements the production readiness plan:
  Phase 1 — automated test suite + HRMS E2E simulation
  Phase 2 — seed all 5 attendance scenarios on dedicated test employees
  Phase 3 — HR workflow drill (leave, regularization, finalize, readiness, payroll)
  Phase 4 — machine ingestion pilot (biometric edge cases via ingest_attlog_line)
  Phase 5 — shadow payroll (generate runs, verify not published)

Run:
  python scripts/attendance_payroll_confidence.py
  python scripts/attendance_payroll_confidence.py --month 2026-06 --hospital-slug my-hospital
  python scripts/attendance_payroll_confidence.py --skip-tests
"""
from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import uuid
from dataclasses import dataclass, field
from datetime import date, datetime, time, timedelta
from decimal import Decimal
from unittest.mock import patch

import django

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')
django.setup()

from django.contrib.auth import get_user_model
from django.db import transaction
from django.utils import timezone
from rest_framework.test import APIRequestFactory, force_authenticate

from apps.hr.attendance_finalization_service import finalize_attendance_month, is_attendance_month_finalized
from apps.hr.attendance_seeder import (
    SCENARIO_AVERAGE,
    SCENARIO_OVERTIME,
    SCENARIO_PAYROLL_STRESS,
    SCENARIO_PERFECT,
    SCENARIO_PROBLEM,
    generate_test_attendance,
)
from apps.hr.attendance_service import get_attendance_summary
from apps.hr.biometric.ingestion import ingest_attlog_line
from apps.hr.biometric_models import BiometricDevice, BiometricRejectedPunch, BiometricUnlinkedUser
from apps.hr.models import (
    AttendancePunch,
    AttendanceRegularization,
    DailyAttendance,
    Department,
    Designation,
    Employee,
    LeaveRequest,
    LeaveType,
    Shift,
)
from apps.hr.payroll_api.compensation_level_service import assign_compensation_level_to_employee, save_compensation_level
from apps.hr.payroll_calculator import PayrollCalculator, generate_monthly_payroll, parse_payroll_month
from apps.hr.payroll_models import PayrollRun
from apps.hr.payroll_month_readiness import compute_payroll_month_readiness
from apps.hr.views import AttendanceRegularizationViewSet, LeaveRequestViewSet
from apps.shared.models import Hospital

User = get_user_model()

ALL_SCENARIOS = [
    SCENARIO_PERFECT,
    SCENARIO_AVERAGE,
    SCENARIO_PROBLEM,
    SCENARIO_OVERTIME,
    SCENARIO_PAYROLL_STRESS,
]

TEST_EMAIL_PREFIX = 'confidence-test-'
TEST_SHIFT_CODE = 'CONF_DAY'
MACHINE_PILOT_DAY = date(2026, 6, 12)


@dataclass
class ConfidenceReport:
    ok: bool = True
    phases: dict = field(default_factory=dict)
    errors: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)

    def fail(self, phase: str, message: str):
        self.ok = False
        self.errors.append(f'[{phase}] {message}')

    def warn(self, message: str):
        self.warnings.append(message)

    def phase(self, name: str, *, ok: bool, details: dict | None = None):
        self.phases[name] = {'ok': ok, **(details or {})}
        if not ok:
            self.ok = False


def _python() -> str:
    return sys.executable


def run_automated_suite(report: ConfidenceReport, *, skip_tests: bool) -> None:
    phase = 'phase1_automated_suite'
    if skip_tests:
        report.phase(phase, ok=True, details={'skipped': True})
        return

    test_modules = [
        'apps.hr.tests.test_payroll_full_e2e',
        'apps.hr.tests.test_attendance_seeder',
        'apps.hr.tests.test_payroll_reconciliation',
        'apps.hr.tests.test_attendance_service_consistency',
        'apps.hr.tests.test_biometric_integration',
        'apps.hr.tests.test_attendance_early_checkin',
    ]
    cmd = [_python(), 'manage.py', 'test', *test_modules, '-v', '1']
    result = subprocess.run(cmd, cwd=ROOT, capture_output=True, text=True)
    tests_ok = result.returncode == 0
    if not tests_ok:
        report.fail(phase, 'Unit test suite failed')
        report.warn(result.stdout[-2000:] if result.stdout else result.stderr[-2000:])

    e2e_cmd = [_python(), 'scripts/e2e_hrms_simulation.py']
    e2e = subprocess.run(e2e_cmd, cwd=ROOT, capture_output=True, text=True)
    e2e_ok = e2e.returncode == 0
    if not e2e_ok:
        report.fail(phase, 'e2e_hrms_simulation.py failed')
        report.warn(e2e.stdout[-1500:] if e2e.stdout else e2e.stderr[-1500:])

    report.phase(
        phase,
        ok=tests_ok and e2e_ok,
        details={
            'tests_passed': tests_ok,
            'e2e_passed': e2e_ok,
            'test_modules': test_modules,
        },
    )


def _resolve_hospital(slug: str | None) -> Hospital:
    if slug:
        hospital = Hospital.objects.filter(slug=slug).first()
        if not hospital:
            raise SystemExit(f'Hospital slug not found: {slug}')
        return hospital
    hospital = Hospital.objects.order_by('id').first()
    if not hospital:
        raise SystemExit('No hospital found in database.')
    return hospital


def _ensure_hr_user(hospital: Hospital) -> User:
    user = User.objects.filter(hospital=hospital, is_staff=True).order_by('date_joined').first()
    if user:
        return user
    email = f'confidence-hr@{hospital.slug or "hospital"}.local'
    return User.objects.create_user(
        email=email,
        password='confidence-hr-pass',
        is_staff=True,
        hospital=hospital,
    )


def _ensure_infrastructure(hospital: Hospital) -> tuple[Department, Designation, Shift, LeaveType, LeaveType]:
    department, _ = Department.objects.get_or_create(
        hospital=hospital,
        name='Confidence Test Dept',
        defaults={},
    )
    designation, _ = Designation.objects.get_or_create(
        hospital=hospital,
        code='CONF_STAFF',
        defaults={'name': 'Confidence Staff', 'is_active': True},
    )
    shift, _ = Shift.objects.get_or_create(
        hospital=hospital,
        code=TEST_SHIFT_CODE,
        defaults={
            'name': 'Confidence Day Shift',
            'start_time': time(9, 0),
            'end_time': time(18, 0),
            'grace_minutes': 10,
            'early_punch_minutes': 240,
            'half_day_hours': Decimal('4'),
            'full_day_hours': Decimal('8'),
            'overtime_allowed': True,
            'active': True,
        },
    )
    paid_leave, _ = LeaveType.objects.get_or_create(
        hospital=hospital,
        name='Confidence Paid Leave',
        defaults={'is_paid': True},
    )
    unpaid_leave, _ = LeaveType.objects.get_or_create(
        hospital=hospital,
        name='Confidence LWP',
        defaults={'is_paid': False},
    )
    return department, designation, shift, paid_leave, unpaid_leave


def _ensure_compensation_level(hospital: Hospital, designation: Designation):
    code = 'CONF_L0'
    existing = (
        __import__('apps.hr.payroll_models', fromlist=['CompensationLevel'])
        .CompensationLevel.objects.filter(hospital=hospital, code=code)
        .first()
    )
    if existing:
        return existing
    month_start, _ = parse_payroll_month(timezone.localdate().strftime('%Y-%m'))
    return save_compensation_level(
        hospital=hospital,
        designation=designation,
        code=code,
        name='Confidence Base Level',
        rank=0,
        basic=Decimal('30000.00'),
        hra=Decimal('10000.00'),
        medical=Decimal('0.00'),
        special_allowance=Decimal('0.00'),
        allowances={'transport': 2000},
        deductions={'pf': 1800},
        overtime_rate=Decimal('200.00'),
        effective_from=month_start.replace(month=1, day=1),
        compliance_fields={
            'late_policy_enabled': True,
            'late_penalty_type': 'per_minute',
            'late_penalty_value': Decimal('5.00'),
            'late_penalty_threshold_minutes': 15,
            'overtime_enabled': True,
            'overtime_type': 'fixed_per_hour',
        },
    )


def _test_biometric_pin(scenario: str) -> str:
    pins = {
        SCENARIO_PERFECT: '900',
        SCENARIO_AVERAGE: '901',
        SCENARIO_PROBLEM: '902',
        SCENARIO_OVERTIME: '903',
        SCENARIO_PAYROLL_STRESS: '904',
        'machine_pilot': '950',
    }
    return pins.get(scenario, f'9{abs(hash(scenario)) % 90 + 10:02d}')


def _get_or_create_test_employee(
    hospital: Hospital,
    scenario: str,
    *,
    department: Department,
    designation: Designation,
    shift: Shift,
    level,
    month: str,
) -> Employee:
    email = f'{TEST_EMAIL_PREFIX}{scenario}@{hospital.slug or "hospital"}.local'
    employee, created = Employee.objects.get_or_create(
        email=email,
        defaults={
            'hospital': hospital,
            'name': f'Confidence {scenario.title()}',
            'status': 'active',
            'onboarding_completed': True,
            'biometric_attendance_enabled': True,
            'biometric_pin': _test_biometric_pin(scenario),
            'department_ref': department,
            'department': department.name,
            'designation': designation,
            'shift': shift,
            'joining_date': date(2026, 1, 1),
            'joining_date_confirmed': date(2026, 1, 1),
        },
    )
    if not created:
        employee.shift = shift
        employee.designation = designation
        employee.status = 'active'
        employee.save(update_fields=['shift', 'designation', 'status', 'updated_at'])
    from apps.hr.payroll_api.compensation_level_service import get_active_compensation_assignment

    if get_active_compensation_assignment(employee, month) is None:
        assign_compensation_level_to_employee(
            employee=employee,
            level=level,
            effective_from=date(2026, 1, 1),
        )
    return employee


def seed_month_scenarios(
    report: ConfidenceReport,
    *,
    hospital: Hospital,
    month: str,
) -> dict[str, Employee]:
    phase = 'phase2_seed_scenarios'
    year, month_num = [int(part) for part in month.split('-')]
    department, designation, shift, _, _ = _ensure_infrastructure(hospital)
    level = _ensure_compensation_level(hospital, designation)

    employees_by_scenario: dict[str, Employee] = {}
    summaries = {}
    for scenario in ALL_SCENARIOS:
        employee = _get_or_create_test_employee(
            hospital,
            scenario,
            department=department,
            designation=designation,
            shift=shift,
            level=level,
            month=month,
        )
        employees_by_scenario[scenario] = employee
        summary = generate_test_attendance(
            employees=[employee],
            year=year,
            month=month_num,
            scenario=scenario,
            replace_existing=True,
            hospital_id=hospital.id,
        )
        summaries[scenario] = summary.as_dict()
        if summary.employees_skipped:
            report.warn(f'Seed skipped for {scenario}: {summary.employees_skipped}')

    report.phase(
        phase,
        ok=True,
        details={
            'month': month,
            'hospital': hospital.slug,
            'scenarios': summaries,
            'employee_ids': {k: v.employee_id for k, v in employees_by_scenario.items()},
        },
    )
    return employees_by_scenario


def _find_working_days_without_leave(
    employee: Employee,
    month_start: date,
    month_end: date,
    *,
    count: int,
) -> list[date]:
    blocked: set[date] = set()
    for leave in LeaveRequest.objects.filter(
        employee=employee,
        status=LeaveRequest.STATUS_APPROVED,
        start_date__lte=month_end,
        end_date__gte=month_start,
    ):
        day = leave.start_date
        while day <= leave.end_date:
            blocked.add(day)
            day += timedelta(days=1)

    free_days: list[date] = []
    day = month_start
    while day <= month_end:
        if day.weekday() < 5 and day not in blocked:
            free_days.append(day)
            if len(free_days) >= count:
                break
        day += timedelta(days=1)
    if len(free_days) < count:
        raise RuntimeError(f'Need {count} free working days in month for leave drill, found {len(free_days)}')
    return free_days


def _approve_leave(hospital: Hospital, hr_user: User, employee: Employee, leave_type: LeaveType, day: date) -> LeaveRequest:
    LeaveRequest.objects.filter(
        employee=employee,
        start_date__lte=day,
        end_date__gte=day,
        status=LeaveRequest.STATUS_PENDING,
    ).delete()
    leave = LeaveRequest.objects.create(
        employee=employee,
        leave_type=leave_type,
        start_date=day,
        end_date=day,
        status=LeaveRequest.STATUS_PENDING,
        reason='Confidence validation leave',
    )
    factory = APIRequestFactory()
    request = factory.post(f'/api/v1/hr/leave-requests/{leave.id}/approve/', {}, format='json')
    force_authenticate(request, user=hr_user)
    view = LeaveRequestViewSet.as_view({'post': 'approve'})
    response = view(request, pk=str(leave.id))
    if response.status_code >= 400:
        raise RuntimeError(f'Leave approve failed: {response.data}')
    leave.refresh_from_db()
    return leave


def _approve_regularization(hospital: Hospital, hr_user: User, employee: Employee, day: date) -> None:
    check_in = timezone.make_aware(datetime.combine(day, time(9, 0)), timezone.get_current_timezone())
    check_out = timezone.make_aware(datetime.combine(day, time(18, 0)), timezone.get_current_timezone())
    reg = AttendanceRegularization.objects.create(
        employee=employee,
        requested_check_in=check_in,
        requested_check_out=check_out,
        reason='Confidence validation regularization',
        status='pending',
    )
    factory = APIRequestFactory()
    request = factory.post(
        f'/api/v1/hr/attendance-regularizations/{reg.id}/approve/',
        {'remarks': 'Confidence drill'},
        format='json',
    )
    force_authenticate(request, user=hr_user)
    view = AttendanceRegularizationViewSet.as_view({'post': 'approve'})
    response = view(request, pk=str(reg.id))
    if response.status_code >= 400:
        raise RuntimeError(f'Regularization approve failed: {response.data}')


def hr_workflow_drill(
    report: ConfidenceReport,
    *,
    hospital: Hospital,
    month: str,
    employees_by_scenario: dict[str, Employee],
    hr_user: User,
) -> PayrollRun | None:
    phase = 'phase3_hr_workflow'
    employee = employees_by_scenario[SCENARIO_PERFECT]
    month_start, month_end = parse_payroll_month(month)
    _, _, _, paid_leave, unpaid_leave = _ensure_infrastructure(hospital)

    leave_day, unpaid_day, reg_day = _find_working_days_without_leave(
        employee,
        month_start,
        month_end,
        count=3,
    )

    try:
        _approve_leave(hospital, hr_user, employee, paid_leave, leave_day)
        _approve_leave(hospital, hr_user, employee, unpaid_leave, unpaid_day)

        DailyAttendance.objects.filter(employee=employee, date=reg_day).delete()
        AttendancePunch.objects.filter(employee=employee, attendance_date=reg_day).delete()
        AttendanceRegularization.objects.filter(employee=employee, status='pending').delete()
        _approve_regularization(hospital, hr_user, employee, reg_day)

        if is_attendance_month_finalized(hospital, month):
            from apps.hr.attendance_finalization_service import unfinalize_attendance_month
            unfinalize_attendance_month(hospital=hospital, month=month)

        finalize_record, finalize_report = finalize_attendance_month(
            hospital=hospital,
            month=month,
            finalized_by=hr_user,
            block_on_hr_review=False,
        )
        readiness = compute_payroll_month_readiness(hospital, month)

        batch = generate_monthly_payroll(
            month,
            calculated_by=hr_user,
            employee_queryset=Employee.objects.filter(pk=employee.pk),
        )
        run = None
        if batch.created:
            run = batch.created[0]
        elif batch.recalculated:
            run = batch.recalculated[0]

        month_start_p, month_end_p = parse_payroll_month(month)
        service_summary = get_attendance_summary(employee.pk, month_start_p, month_end_p)
        calc = PayrollCalculator(employee=employee, month=month, require_finalized_attendance=True)
        payroll_summary = calc.gather_attendance_summary()

        parity_ok = (
            Decimal(str(service_summary.present_days)) == Decimal(str(payroll_summary.present_days))
            and Decimal(str(service_summary.absent_days)) == Decimal(str(payroll_summary.absent_days))
        )

        report.phase(
            phase,
            ok=run is not None and parity_ok,
            details={
                'leave_days': [leave_day.isoformat(), unpaid_day.isoformat()],
                'regularization_day': reg_day.isoformat(),
                'finalized': bool(finalize_record),
                'finalize_warnings': finalize_report.warnings,
                'readiness_next_action': readiness.next_action,
                'payroll_run_id': str(run.id) if run else None,
                'payroll_status': run.status if run else None,
                'parity_ok': parity_ok,
                'batch_errors': batch.errors,
                'batch_skipped': batch.skipped,
            },
        )
        if run is None:
            report.fail(phase, f'Payroll not generated: {batch.skipped or batch.errors}')
        if not parity_ok:
            report.fail(phase, 'Attendance service vs payroll summary mismatch')
        return run
    except Exception as exc:
        report.fail(phase, str(exc))
        report.phase(phase, ok=False, details={'exception': str(exc)})
        return None


def machine_ingestion_pilot(report: ConfidenceReport, *, hospital: Hospital, month: str) -> None:
    """Programmatic machine pilot — validates biometric ingestion edge cases."""
    phase = 'phase4_machine_pilot'
    _, designation, shift, _, _ = _ensure_infrastructure(hospital)
    level = _ensure_compensation_level(hospital, designation)
    employee = _get_or_create_test_employee(
        hospital,
        'machine_pilot',
        department=_ensure_infrastructure(hospital)[0],
        designation=designation,
        shift=shift,
        level=level,
        month=month,
    )
    employee.biometric_pin = '950'
    employee.save(update_fields=['biometric_pin', 'updated_at'])

    device, _ = BiometricDevice.objects.get_or_create(
        hospital=hospital,
        serial_number='CONF-PILOT-DEVICE',
        defaults={'name': 'Confidence Pilot Device', 'is_active': True},
    )

    tz = timezone.get_current_timezone()
    fixed_now = timezone.make_aware(datetime.combine(MACHINE_PILOT_DAY, time(21, 0)), tz)
    checks: list[dict] = []

    def _aware(clock: time) -> datetime:
        return timezone.make_aware(datetime.combine(MACHINE_PILOT_DAY, clock), tz)

    with patch('django.utils.timezone.now', return_value=fixed_now):
        AttendancePunch.objects.filter(employee=employee, attendance_date=MACHINE_PILOT_DAY).delete()
        DailyAttendance.objects.filter(employee=employee, date=MACHINE_PILOT_DAY).delete()
        BiometricRejectedPunch.objects.filter(employee=employee).delete()

        in_ok = ingest_attlog_line(device, '950', _aware(time(9, 5)), 0, 1, 'pilot-in')
        dup_in_ok = ingest_attlog_line(device, '950', _aware(time(9, 6)), 0, 1, 'pilot-dup-in')
        out_ok = ingest_attlog_line(device, '950', _aware(time(18, 2)), 0, 1, 'pilot-out')
        suspicious = AttendancePunch.objects.filter(
            employee=employee,
            attendance_date=MACHINE_PILOT_DAY,
            is_suspicious=True,
        ).exists()
        checks.append({
            'name': 'in_out_punch_pair',
            'ok': in_ok and out_ok,
        })
        checks.append({
            'name': 'duplicate_near_tap_flagged',
            'ok': in_ok and dup_in_ok and suspicious,
        })

        unknown_ok = ingest_attlog_line(device, '99999', _aware(time(10, 0)), 0, 1, 'pilot-unknown')
        unlinked = BiometricUnlinkedUser.objects.filter(hospital=hospital, pin='99999').exists()
        checks.append({'name': 'unknown_pin_unlinked', 'ok': unknown_ok is False and unlinked})

        missing_out_day = MACHINE_PILOT_DAY - timedelta(days=1)
        while missing_out_day.weekday() >= 5:
            missing_out_day -= timedelta(days=1)
        AttendancePunch.objects.filter(employee=employee, attendance_date=missing_out_day).delete()
        DailyAttendance.objects.filter(employee=employee, date=missing_out_day).delete()
        missing_in_ok = ingest_attlog_line(
            device, '950',
            timezone.make_aware(datetime.combine(missing_out_day, time(9, 0)), tz),
            0, 1, 'pilot-missing-out',
        )
        daily_missing = DailyAttendance.objects.filter(employee=employee, date=missing_out_day).first()
        checks.append({
            'name': 'missing_checkout_detected',
            'ok': missing_in_ok and daily_missing and daily_missing.attendance_status in {
                'missing_checkout', 'in_progress',
            },
        })

        portal_daily = DailyAttendance.objects.filter(employee=employee, date=MACHINE_PILOT_DAY).first()
        checks.append({
            'name': 'daily_row_created',
            'ok': portal_daily is not None and portal_daily.first_check_in is not None,
        })

    all_ok = all(row['ok'] for row in checks)
    report.phase(phase, ok=all_ok, details={'checks': checks, 'pilot_day': MACHINE_PILOT_DAY.isoformat()})
    if not all_ok:
        failed = [row['name'] for row in checks if not row['ok']]
        report.fail(phase, f'Machine pilot checks failed: {", ".join(failed)}')


def shadow_payroll_validation(
    report: ConfidenceReport,
    *,
    hospital: Hospital,
    month: str,
    employees_by_scenario: dict[str, Employee],
    hr_user: User,
) -> None:
    phase = 'phase5_shadow_payroll'
    if not is_attendance_month_finalized(hospital, month):
        finalize_attendance_month(
            hospital=hospital,
            month=month,
            finalized_by=hr_user,
            block_on_hr_review=False,
        )
    employee_ids = [emp.pk for emp in employees_by_scenario.values()]
    batch = generate_monthly_payroll(
        month,
        calculated_by=hr_user,
        employee_queryset=Employee.objects.filter(pk__in=employee_ids),
    )
    runs = list(
        PayrollRun.objects.filter(employee_id__in=employee_ids, month=month).order_by('-created_at')
    )
    published = [run for run in runs if run.status in {
        PayrollRun.STATUS_PUBLISHED,
        PayrollRun.STATUS_FINALIZED,
        PayrollRun.STATUS_LOCKED,
    }]
    review_runs = [run for run in runs if run.status in {
        PayrollRun.STATUS_DRAFT,
        PayrollRun.STATUS_CALCULATED,
        PayrollRun.STATUS_UNDER_REVIEW,
        PayrollRun.STATUS_APPROVED,
    }]

    spot_checks = []
    for run in runs[:3]:
        snapshot = run.calculation_snapshot or {}
        spot_checks.append({
            'employee_id': run.employee.employee_id,
            'net_salary': str(run.final_salary),
            'present_days': snapshot.get('attendance_summary', {}).get('present_days'),
            'lop': snapshot.get('lop_amount'),
            'status': run.status,
        })

    ok = len(published) == 0 and len(runs) > 0
    report.phase(
        phase,
        ok=ok,
        details={
            'runs_created': len(batch.created),
            'runs_recalculated': len(batch.recalculated),
            'total_runs': len(runs),
            'published_count': len(published),
            'review_ready_count': len(review_runs),
            'skipped': batch.skipped,
            'errors': batch.errors,
            'spot_checks': spot_checks,
            'instruction': 'Verify spot_checks manually before approving payroll for payment.',
        },
    )
    if published:
        report.fail(phase, 'Shadow payroll must not publish/pay runs automatically')
    if not runs:
        report.fail(phase, 'No payroll runs generated for confidence employees')


def main() -> int:
    parser = argparse.ArgumentParser(description='Attendance & payroll confidence validation')
    parser.add_argument('--month', default=None, help='Payroll month YYYY-MM (default: previous calendar month)')
    parser.add_argument('--hospital-slug', default=None, help='Hospital slug (default: first hospital)')
    parser.add_argument('--skip-tests', action='store_true', help='Skip Phase 1 automated tests')
    args = parser.parse_args()

    if args.month:
        month = args.month
    else:
        today = timezone.localdate()
        first_this_month = today.replace(day=1)
        last_prev = first_this_month - timedelta(days=1)
        month = last_prev.strftime('%Y-%m')

    hospital = _resolve_hospital(args.hospital_slug)
    hr_user = _ensure_hr_user(hospital)
    report = ConfidenceReport()

    print(f'Confidence validation — hospital={hospital.slug} month={month}')
    print('=' * 60)

    run_automated_suite(report, skip_tests=args.skip_tests)
    employees = seed_month_scenarios(report, hospital=hospital, month=month)
    shadow_run = hr_workflow_drill(
        report,
        hospital=hospital,
        month=month,
        employees_by_scenario=employees,
        hr_user=hr_user,
    )
    machine_ingestion_pilot(report, hospital=hospital, month=month)
    shadow_payroll_validation(
        report,
        hospital=hospital,
        month=month,
        employees_by_scenario=employees,
        hr_user=hr_user,
    )

    print(json.dumps({
        'ok': report.ok,
        'phases': report.phases,
        'errors': report.errors,
        'warnings': report.warnings,
    }, indent=2, default=str))

    print('=' * 60)
    if report.ok:
        print('PASS — All confidence phases completed.')
        print('Next: HR manually reviews shadow payroll spot_checks before approving payment.')
    else:
        print('FAIL — See errors above.')
    return 0 if report.ok else 1


if __name__ == '__main__':
    raise SystemExit(main())
