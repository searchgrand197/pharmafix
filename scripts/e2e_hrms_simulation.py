"""
Full end-to-end HRMS lifecycle simulation (production-level validation).

Hire → Onboard → Attendance → Leave → Payroll → Payslip

Run: python scripts/e2e_hrms_simulation.py
"""
from __future__ import annotations

import calendar
import json
import os
import sys
import uuid
from datetime import date, datetime, time, timedelta
from decimal import Decimal
from io import StringIO

import django

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')
django.setup()

from django.contrib.auth import get_user_model
from django.core.files.base import ContentFile
from django.core.management import call_command
from django.db import connection
from django.utils import timezone
from rest_framework.test import APIClient

from apps.hr.document_moderation import moderate_approve, moderate_request_reupload
from apps.hr.models import (
    DailyAttendance,
    Department,
    Employee,
    EmployeeDocumentRequirement,
    LeaveBalance,
    LeaveRequest,
    LeaveType,
    Shift,
)
from apps.hr.onboarding_documents import (
    activate_employee_after_verification,
    sync_employee_requirements,
)
from apps.hr.payroll_approval import PayrollApprovalService
from apps.hr.payroll_calculator import PayrollCalculator, generate_monthly_payroll
from apps.hr.payroll_models import PayrollRun, Payslip, SalaryStructure
from apps.hr.payslip_generator import PayslipGenerator

User = get_user_model()

SIM_MONTH = '2026-04'
SIM_PASSWORD = 'e2e-sim-pass-123'
HR_EMAIL = 'hr@test.com'
HR_PASSWORD = 'dev-hr-pass-123'

CORE_APIS = [
    ('GET', '/api/v1/hr/employees/', 'hr'),
    ('GET', '/api/v1/hr/daily-attendance/', 'hr'),
    ('GET', '/api/v1/hr/leave-requests/', 'hr'),
    ('GET', '/api/v1/hr/payroll-runs/', 'hr'),
    ('GET', '/api/v1/employee-portal/dashboard/', 'employee'),
    ('GET', '/api/v1/employee-portal/attendance/', 'employee'),
    ('GET', '/api/v1/employee-portal/leaves/', 'employee'),
    ('GET', '/api/v1/employee-portal/payslips/', 'employee'),
]


class SimulationReport:
    def __init__(self):
        self.steps: dict = {}
        self.critical_bugs: list[str] = []
        self.warnings: list[str] = []
        self.performance: list[str] = []

    def step(self, name: str, *, ok: bool, details: dict | None = None):
        self.steps[name] = {'ok': ok, **(details or {})}

    def fail(self, step: str, message: str, *, critical: bool = True):
        entry = self.steps.setdefault(step, {'ok': False})
        entry['ok'] = False
        issues = entry.setdefault('issues', [])
        issues.append(message)
        if critical:
            self.critical_bugs.append(f'[{step}] {message}')
        else:
            self.warnings.append(f'[{step}] {message}')

    def verdict(self) -> str:
        if self.critical_bugs:
            if len(self.critical_bugs) >= 3 or any('crash' in b.lower() or '500' in b for b in self.critical_bugs):
                return 'NOT READY'
            return 'STABLE BUT NEEDS FIXES'
        failed = [k for k, v in self.steps.items() if not v.get('ok')]
        if failed:
            return 'STABLE BUT NEEDS FIXES'
        return 'PRODUCTION READY'


def _hr_client() -> tuple[APIClient, User]:
    hr_user = User.objects.filter(email=HR_EMAIL).first()
    if not hr_user:
        raise RuntimeError('HR seed user missing — run seed_hrms_dev first.')
    client = APIClient()
    client.force_authenticate(user=hr_user)
    return client, hr_user


def _employee_client(user: User) -> APIClient:
    client = APIClient()
    client.force_authenticate(user=user)
    return client


def step1_employee_creation(report: SimulationReport, hr_client: APIClient, hr_user: User) -> Employee | None:
    """Create HR employee via manual-create API."""
    sim_email = f'e2e-sim-{uuid.uuid4().hex[:8]}@test.local'
    hospital = hr_user.hospital
    dept = Department.objects.filter(hospital=hospital).first()
    if not dept:
        report.fail('step1_employee_creation', 'No department found for hospital', critical=True)
        report.step('step1_employee_creation', ok=False)
        return None

    payload = {
        'name': 'E2E Simulation Employee',
        'email': sim_email,
        'phone': '9999900001',
        'department': dept.name,
        'job_title': 'QA Analyst',
        'joining_date': '2026-04-01',
        'employment_type': 'full_time',
        'salary': '32000',
        'start_onboarding': True,
        'document_timing': 'collect_now',
        'send_welcome_email': False,
    }
    res = hr_client.post('/api/v1/hr/employees/manual-create/', payload, format='json')
    details = {
        'api_status': res.status_code,
        'email': sim_email,
    }
    if res.status_code not in (200, 201):
        report.fail('step1_employee_creation', f'manual-create failed: {res.status_code} {getattr(res, "data", "")}')
        report.step('step1_employee_creation', ok=False, details=details)
        return None

    employee = Employee.objects.filter(email__iexact=sim_email).first()
    if not employee:
        report.fail('step1_employee_creation', 'Employee record not persisted after API create')
        report.step('step1_employee_creation', ok=False, details=details)
        return None

    portal_user = User.objects.filter(email__iexact=sim_email).first()
    details.update({
        'employee_id': employee.employee_id,
        'status': employee.status,
        'onboarding_status': employee.onboarding_status,
        'user_account_exists': portal_user is not None,
        'user_linked_to_hospital': bool(portal_user and portal_user.hospital_id),
    })

    ok = (
        employee.status == 'pending_onboarding'
        and employee.onboarding_status in (
            'pending_documents', 'documents_pending', 'pending', 'ready_to_join',
        )
        and bool(employee.employee_id)
    )
    if not portal_user:
        report.fail('step1_employee_creation', 'User account not created yet (expected after activation)', critical=False)

    report.step('step1_employee_creation', ok=ok, details=details)
    return employee


def _simulate_upload(requirement: EmployeeDocumentRequirement) -> None:
    payload = f'%PDF-1.4 e2e test document {uuid.uuid4().hex}'.encode()
    content = ContentFile(payload, name=f'e2e-{requirement.id}.pdf')
    requirement.uploaded_file = content
    requirement.status = 'uploaded'
    requirement.uploaded_at = timezone.now()
    requirement.save(update_fields=['uploaded_file', 'status', 'uploaded_at', 'updated_at'])


def step2_document_flow(report: SimulationReport, hr_user: User, employee: Employee) -> bool:
    """Assign, upload, approve, and reupload-request documents."""
    requirements = list(sync_employee_requirements(employee))
    if not requirements:
        report.fail('step2_document_flow', 'No document requirements assigned after sync')
        report.step('step2_document_flow', ok=False)
        return False

    mandatory = [r for r in requirements if r.mandatory]
    for req in requirements:
        _simulate_upload(req)

    approved = 0
    for req in mandatory:
        try:
            moderate_approve(requirement=req, reviewer=hr_user)
            approved += 1
        except Exception as exc:
            report.fail('step2_document_flow', f'Approve failed for {req.document_type.name}: {exc}')

    reupload_req = requirements[-1]
    reupload_ok = False
    try:
        moderate_request_reupload(
            requirement=reupload_req,
            reviewer=hr_user,
            reason='E2E test — please re-upload clearer scan.',
        )
        reupload_req.refresh_from_db()
        reupload_ok = reupload_req.status == 'reupload_requested'
        if reupload_ok:
            reupload_req.refresh_from_db()
            _simulate_upload(reupload_req)
            moderate_approve(requirement=reupload_req, reviewer=hr_user)
    except Exception as exc:
        report.fail('step2_document_flow', f'Reupload flow failed: {exc}', critical=False)

    activation = activate_employee_after_verification(employee=employee, reviewer=hr_user)
    employee.refresh_from_db()
    portal_user = User.objects.filter(email__iexact=employee.email).first()

    details = {
        'requirements_count': len(requirements),
        'mandatory_count': len(mandatory),
        'approved_count': approved,
        'reupload_flow_ok': reupload_ok,
        'activation_success': activation.get('success'),
        'activation_message': activation.get('message'),
        'final_status': employee.status,
        'onboarding_completed': employee.onboarding_completed,
        'portal_user_exists': portal_user is not None,
    }

    ok = (
        approved == len(mandatory)
        and activation.get('success')
        and employee.status == 'active'
        and employee.onboarding_completed
        and portal_user is not None
    )
    if not ok:
        report.fail('step2_document_flow', 'Document approval or activation incomplete', critical=not activation.get('success'))

    report.step('step2_document_flow', ok=ok, details=details)
    return ok


def step3_employee_login(report: SimulationReport, employee: Employee) -> User | None:
    """Login as employee and verify RBAC."""
    portal_user = User.objects.filter(email__iexact=employee.email).first()
    if not portal_user:
        report.fail('step3_employee_login', 'Portal user missing after activation')
        report.step('step3_employee_login', ok=False)
        return None

    portal_user.set_password(SIM_PASSWORD)
    portal_user.must_change_password = False
    portal_user.save(update_fields=['password', 'must_change_password'])

    client = APIClient()
    login_res = client.post(
        '/api/v1/auth/login/',
        {'email': employee.email, 'password': SIM_PASSWORD},
        format='json',
    )
    client.force_authenticate(user=portal_user)

    dash = client.get('/api/v1/employee-portal/dashboard/')
    profile = client.get('/api/v1/employee-portal/profile/')
    hr_block = client.get('/api/v1/hr/employees/')
    hr_payroll_block = client.get('/api/v1/hr/payroll-runs/')

    details = {
        'login_status': login_res.status_code,
        'dashboard_status': dash.status_code,
        'profile_status': profile.status_code,
        'hr_api_blocked': hr_block.status_code == 403,
        'payroll_api_blocked': hr_payroll_block.status_code == 403,
        'profile_employee_id_match': (
            profile.status_code == 200 and profile.data.get('id') == str(employee.id)
        ),
    }

    ok = (
        login_res.status_code == 200
        and dash.status_code == 200
        and profile.status_code == 200
        and hr_block.status_code == 403
        and hr_payroll_block.status_code == 403
        and details['profile_employee_id_match']
    )
    if login_res.status_code != 200:
        report.fail('step3_employee_login', f'Login failed: {login_res.status_code}')
    if hr_block.status_code != 403:
        report.fail('step3_employee_login', f'HR API not blocked for employee (got {hr_block.status_code})', critical=False)

    report.step('step3_employee_login', ok=ok, details=details)
    return portal_user


def step4_attendance_30_days(report: SimulationReport, employee: Employee, hr_user: User) -> Shift | None:
    """Generate 30-day attendance for SIM_MONTH."""
    hospital = employee.hospital
    shift = Shift.objects.filter(hospital=hospital).first()
    if not shift:
        shift, _ = Shift.objects.get_or_create(
            hospital=hospital,
            code='E2E',
            defaults={
                'name': 'E2E Shift',
                'start_time': time(9, 0),
                'end_time': time(18, 0),
                'grace_minutes': 15,
                'full_day_hours': Decimal('8.00'),
            },
        )
    employee.shift = shift
    employee.save(update_fields=['shift', 'updated_at'])

    year, month_num = 2026, 4
    last_day = calendar.monthrange(year, month_num)[1]
    tz = timezone.get_current_timezone()

    present = absent = late = ot_days = 0
    total_late_minutes = Decimal('0')
    total_ot_hours = Decimal('0')

    DailyAttendance.objects.filter(employee=employee, date__year=year, date__month=month_num).delete()

    for day_num in range(1, last_day + 1):
        day = date(year, month_num, day_num)
        if day.weekday() >= 5:
            DailyAttendance.objects.create(
                employee=employee,
                date=day,
                shift=shift,
                attendance_status='weekend',
                attendance_source='SYSTEM',
            )
            continue

        if day_num % 7 == 0:
            status = 'absent'
            absent += 1
            late_minutes = 0
            ot_hours = Decimal('0')
        elif day_num % 5 == 0:
            status = 'late'
            late += 1
            late_minutes = 35
            total_late_minutes += late_minutes
            ot_hours = Decimal('0')
        elif day_num % 11 == 0:
            status = 'overtime'
            present += 1
            late_minutes = 0
            ot_hours = Decimal('2.50')
            ot_days += 1
            total_ot_hours += ot_hours
        else:
            status = 'present'
            present += 1
            late_minutes = 0
            ot_hours = Decimal('0.50') if day_num % 3 == 0 else Decimal('0')
            total_ot_hours += ot_hours

        check_in = timezone.make_aware(datetime.combine(day, time(9, 0)), tz)
        if status == 'late':
            check_in = timezone.make_aware(datetime.combine(day, time(9, 35)), tz)
        check_out = timezone.make_aware(datetime.combine(day, time(18, 0)), tz)
        if ot_hours > 0:
            check_out = timezone.make_aware(datetime.combine(day, time(20, 30)), tz)

        DailyAttendance.objects.create(
            employee=employee,
            date=day,
            shift=shift,
            attendance_status=status,
            late_minutes=late_minutes,
            overtime_hours=ot_hours,
            first_check_in=check_in,
            last_check_out=check_out,
            total_work_hours=Decimal('8.00') if status in ('present', 'late', 'overtime') else None,
            attendance_source='HR_MANUAL',
            manually_corrected=True,
            calculation_locked=True,
        )

    calc = PayrollCalculator(employee=employee, month=SIM_MONTH)
    calc_present = calc.calculate_present_days()
    calc_absent = calc.calculate_absent_days()
    calc_ot = calc.calculate_overtime()
    calc_late = calc.calculate_late_penalty()

    emp_client = _employee_client(User.objects.filter(email__iexact=employee.email).first())
    cal_res = emp_client.get(f'/api/v1/employee-portal/attendance/?month={SIM_MONTH}')

    details = {
        'days_seeded': last_day,
        'weekday_present': present + late + ot_days,
        'weekday_absent': absent,
        'weekday_late': late,
        'overtime_days': ot_days,
        'total_ot_hours': str(total_ot_hours),
        'calc_present_days': str(calc_present),
        'calc_absent_days': str(calc_absent),
        'calc_overtime_amount': str(calc_ot),
        'calc_late_penalty': str(calc_late),
        'calendar_api_status': cal_res.status_code,
        'calendar_has_days': bool(
            cal_res.status_code == 200
            and (cal_res.data.get('days') or cal_res.data.get('history') or cal_res.data.get('calendar'))
        ),
    }

    ok = (
        DailyAttendance.objects.filter(employee=employee, date__year=year, date__month=month_num).count() == last_day
        and calc_present > 0
        and cal_res.status_code == 200
    )
    if cal_res.status_code != 200:
        report.fail('step4_attendance', f'Calendar API failed: {cal_res.status_code}', critical=False)

    report.step('step4_attendance', ok=ok, details=details)
    return shift


def _next_weekday(start: date, *, skip: int = 0) -> date:
    day = start
    found = 0
    while True:
        if day.weekday() < 5:
            if found >= skip:
                return day
            found += 1
        day += timedelta(days=1)


def step5_leave_system(report: SimulationReport, hr_client: APIClient, emp_client: APIClient, employee: Employee, hr_user: User) -> None:
    """Apply, approve, reject leave; verify attendance impact."""
    leave_type = LeaveType.objects.filter(hospital=employee.hospital).first()
    if not leave_type:
        leave_type = LeaveType.objects.create(hospital=employee.hospital, name='Casual Leave')

    LeaveBalance.objects.update_or_create(
        employee=employee,
        leave_type=leave_type,
        defaults={
            'total_days': Decimal('12.00'),
            'used_days': Decimal('0.00'),
            'remaining_days': Decimal('12.00'),
        },
    )

    # Portal flow — future dates (past dates blocked unless HR_ALLOW_PAST_LEAVE_REQUESTS).
    today = timezone.localdate()
    portal_start = _next_weekday(today + timedelta(days=7))
    portal_end = portal_start + timedelta(days=1)
    reject_start = _next_weekday(portal_end + timedelta(days=3))
    reject_end = reject_start

    portal_apply = emp_client.post(
        '/api/v1/employee-portal/leaves/',
        {
            'leave_type': str(leave_type.id),
            'start_date': portal_start.isoformat(),
            'end_date': portal_end.isoformat(),
            'reason': 'E2E portal leave — pending HR approval',
        },
        format='json',
    )
    portal_reject_apply = emp_client.post(
        '/api/v1/employee-portal/leaves/',
        {
            'leave_type': str(leave_type.id),
            'start_date': reject_start.isoformat(),
            'end_date': reject_end.isoformat(),
            'reason': 'E2E rejection test',
        },
        format='json',
    )

    portal_leave_id = portal_apply.data.get('id') if portal_apply.status_code == 201 else None
    reject_leave_id = portal_reject_apply.data.get('id') if portal_reject_apply.status_code == 201 else None

    portal_approve_res = reject_res = None
    if portal_leave_id:
        portal_approve_res = hr_client.post(
            f'/api/v1/hr/leave-requests/{portal_leave_id}/approve/', {}, format='json',
        )
    if reject_leave_id:
        reject_res = hr_client.post(
            f'/api/v1/hr/leave-requests/{reject_leave_id}/reject/',
            {'remarks': 'E2E rejection — insufficient coverage'},
            format='json',
        )

    # Payroll-month leave (April) — HR creates pending request then approves (no past-date portal rule).
    payroll_leave_start = date(2026, 4, 10)
    payroll_leave_end = date(2026, 4, 11)
    payroll_leave = LeaveRequest.objects.create(
        employee=employee,
        leave_type=leave_type,
        start_date=payroll_leave_start,
        end_date=payroll_leave_end,
        number_of_days=Decimal('2.00'),
        reason='E2E payroll-month leave',
        status=LeaveRequest.STATUS_PENDING,
        applied_by=hr_user,
    )
    payroll_approve_res = hr_client.post(
        f'/api/v1/hr/leave-requests/{payroll_leave.id}/approve/', {}, format='json',
    )

    leave_attendance = DailyAttendance.objects.filter(
        employee=employee,
        date__gte=payroll_leave_start,
        date__lte=payroll_leave_end,
    ).values_list('date', 'attendance_status')

    calc = PayrollCalculator(employee=employee, month=SIM_MONTH)
    leave_breakdown = calc.calculate_leave_days()
    calc_absent_after = calc.calculate_absent_days()

    details = {
        'portal_apply_status': portal_apply.status_code,
        'portal_reject_apply_status': portal_reject_apply.status_code,
        'portal_hr_approve_status': portal_approve_res.status_code if portal_approve_res else None,
        'hr_reject_status': reject_res.status_code if reject_res else None,
        'payroll_month_hr_approve_status': payroll_approve_res.status_code,
        'leave_days_paid': str(leave_breakdown.paid),
        'leave_days_unpaid': str(leave_breakdown.unpaid),
        'absent_days_after_leave': str(calc_absent_after),
        'attendance_on_payroll_leave_dates': {str(d): s for d, s in leave_attendance},
    }

    ok = (
        portal_apply.status_code == 201
        and portal_reject_apply.status_code == 201
        and portal_approve_res
        and portal_approve_res.status_code == 200
        and reject_res
        and reject_res.status_code == 200
        and payroll_approve_res.status_code == 200
        and leave_breakdown.paid >= Decimal('1.00')
    )
    if portal_apply.status_code != 201:
        report.fail('step5_leave', f'Portal leave apply failed: {portal_apply.status_code} {portal_apply.data}')
    if payroll_approve_res.status_code != 200:
        report.fail('step5_leave', f'Payroll-month leave approve failed: {payroll_approve_res.status_code}')

    report.step('step5_leave', ok=ok, details=details)


def step6_payroll(report: SimulationReport, hr_user: User, employee: Employee) -> PayrollRun | None:
    """Generate payroll, verify calculations, test duplicate guard."""
    SalaryStructure.objects.filter(employee=employee).delete()
    structure = SalaryStructure.objects.create(
        employee=employee,
        basic_salary=Decimal('30000.00'),
        hra=Decimal('10000.00'),
        allowances={'transport': 2000},
        deductions={'pf': 1800},
        overtime_rate=Decimal('250.00'),
        effective_from=date(2026, 1, 1),
        is_active=True,
    )

    if employee.status != 'active':
        report.fail('step6_payroll', f'Employee not active (status={employee.status}) — payroll skipped')
        report.step('step6_payroll', ok=False)
        return None

    gen1 = generate_monthly_payroll(SIM_MONTH, calculated_by=hr_user, employee_queryset=Employee.objects.filter(pk=employee.pk))
    gen2 = generate_monthly_payroll(SIM_MONTH, calculated_by=hr_user, employee_queryset=Employee.objects.filter(pk=employee.pk))

    run = PayrollRun.objects.filter(employee=employee, month=SIM_MONTH).first()
    if not run:
        report.fail('step6_payroll', 'Payroll run not created')
        report.step('step6_payroll', ok=False)
        return None

    calc = PayrollCalculator(employee=employee, month=SIM_MONTH, salary_structure=structure)
    expected = calc.calculate()

    gross_match = abs(run.gross_salary - expected.gross_salary) <= Decimal('0.02')
    net_match = abs(run.final_salary - expected.final_salary) <= Decimal('0.02')
    duplicate_blocked = len(gen2.skipped) == 1 and gen2.skipped[0].get('reason') == 'duplicate'

    service = PayrollApprovalService()
    run = service.submit_for_review(run, performed_by=hr_user)
    run = service.approve_payroll(run, hr_user=hr_user)
    run = service.lock_payroll(run, performed_by=hr_user)

    details = {
        'created_count': len(gen1.created),
        'skipped_duplicate': duplicate_blocked,
        'run_status_after_lock': run.status,
        'gross_salary': str(run.gross_salary),
        'expected_gross': str(expected.gross_salary),
        'final_salary': str(run.final_salary),
        'expected_final': str(expected.final_salary),
        'gross_match': gross_match,
        'net_match': net_match,
        'overtime_hours': str(run.overtime_hours),
        'total_absent_days': str(run.total_absent_days),
        'total_leave_days': str(run.total_leave_days),
        'lop_in_snapshot': (run.calculation_snapshot or {}).get('lop_amount'),
    }

    ok = gross_match and net_match and duplicate_blocked and run.status == PayrollRun.STATUS_LOCKED
    if not gross_match or not net_match:
        report.fail('step6_payroll', 'Payroll calculation mismatch vs PayrollCalculator')
    if not duplicate_blocked:
        report.fail('step6_payroll', 'Duplicate payroll run was not blocked', critical=False)

    report.step('step6_payroll', ok=ok, details=details)
    return run


def step7_payslip(report: SimulationReport, hr_user: User, employee: Employee, payroll_run: PayrollRun) -> Payslip | None:
    """Generate payslip PDF and publish payroll."""
    try:
        payslip = PayslipGenerator().generate_payslip(payroll_run.id, generated_by=hr_user)
    except Exception as exc:
        report.fail('step7_payslip', f'Payslip generation failed: {exc}')
        report.step('step7_payslip', ok=False)
        return None

    pdf_bytes = b''
    if payslip.pdf_file:
        payslip.pdf_file.open('rb')
        try:
            pdf_bytes = payslip.pdf_file.read()
        finally:
            payslip.pdf_file.close()

    is_pdf = pdf_bytes[:4] == b'%PDF'
    net_match = payslip.net_salary == payroll_run.final_salary
    # Payslip gross sums earnings lines (may include overtime); payroll gross is structure base.
    gross_match = abs(payslip.gross_salary - payroll_run.gross_salary) <= Decimal('5000.00')

    service = PayrollApprovalService()
    published_run = service.publish_payroll(payroll_run, performed_by=hr_user)

    emp_user = User.objects.filter(email__iexact=employee.email).first()
    emp_client = _employee_client(emp_user)
    portal_list = emp_client.get(f'/api/v1/employee-portal/payslips/?month={SIM_MONTH}')
    portal_has_payslip = (
        portal_list.status_code == 200
        and len(portal_list.data.get('results', [])) >= 1
    )

    download_res = None
    if portal_list.status_code == 200 and portal_list.data.get('results'):
        pid = portal_list.data['results'][0]['id']
        download_res = emp_client.get(f'/api/v1/employee-portal/payslips/{pid}/download/')

    details = {
        'payslip_id': str(payslip.id),
        'pdf_generated': bool(payslip.pdf_file),
        'pdf_is_valid_header': is_pdf,
        'pdf_size_bytes': len(pdf_bytes),
        'gross_match': gross_match,
        'net_match': net_match,
        'published_status': published_run.status,
        'portal_list_status': portal_list.status_code,
        'portal_visible': portal_has_payslip,
        'download_status': download_res.status_code if download_res else None,
        'download_is_pdf': (
            download_res.status_code == 200
            and download_res.get('Content-Type', '').startswith('application/pdf')
        ) if download_res else False,
    }

    ok = is_pdf and net_match and published_run.status == PayrollRun.STATUS_PUBLISHED and portal_has_payslip
    if not is_pdf:
        report.fail('step7_payslip', 'PDF header invalid — generation or layout engine issue')
    if not gross_match:
        report.fail('step7_payslip', 'Payslip gross diverges significantly from payroll gross', critical=False)
    if not portal_has_payslip:
        report.fail('step7_payslip', 'Payslip not visible on employee portal after publish', critical=False)

    report.step('step7_payslip', ok=ok, details=details)
    return payslip


def step8_integrity(report: SimulationReport, hr_user: User, emp_user: User | None) -> None:
    """Schema, migrations, API smoke, null-safety."""
    tables = set(connection.introspection.table_names())
    required = [
        'hr_employee', 'hr_dailyattendance', 'hr_leaverequest',
        'hr_payrollrun', 'hr_payslip', 'hr_salarystructure', 'hr_payrollauditlog',
        'hr_employeedocumentrequirement', 'hr_documenttype',
    ]
    missing_tables = [t for t in required if t not in tables]

    out = StringIO()
    call_command('showmigrations', 'hr', '--plan', stdout=out, no_color=True)
    unapplied = [line for line in out.getvalue().splitlines() if 'hr.' in line and '[ ]' in line]

    api_results = []
    for method, path, role in CORE_APIS:
        client = APIClient()
        if role == 'hr':
            client.force_authenticate(user=hr_user)
        elif emp_user:
            client.force_authenticate(user=emp_user)
        else:
            continue
        res = client.get(path) if method == 'GET' else client.post(path, {}, format='json')
        api_results.append({
            'path': path,
            'role': role,
            'status': res.status_code,
            'server_error': res.status_code >= 500,
        })

    server_errors = [a for a in api_results if a['server_error']]

    details = {
        'missing_tables': missing_tables,
        'unapplied_hr_migrations': len(unapplied),
        'api_checks': api_results,
        'server_errors': len(server_errors),
    }

    ok = not missing_tables and not unapplied and not server_errors
    if missing_tables:
        report.fail('step8_integrity', f'Missing tables: {missing_tables}')
    if unapplied:
        report.fail('step8_integrity', f'Unapplied HR migrations: {len(unapplied)}')
    for err in server_errors:
        report.fail('step8_integrity', f'API 5xx: {err["path"]} ({err["status"]})')

    report.step('step8_integrity', ok=ok, details=details)


def run_simulation() -> dict:
    report = SimulationReport()
    hr_client, hr_user = _hr_client()

    employee = step1_employee_creation(report, hr_client, hr_user)
    if not employee:
        report.step('step2_document_flow', ok=False, details={'skipped': 'no employee'})
        report.step('step3_employee_login', ok=False, details={'skipped': 'no employee'})
        report.step('step4_attendance', ok=False, details={'skipped': 'no employee'})
        report.step('step5_leave', ok=False, details={'skipped': 'no employee'})
        report.step('step6_payroll', ok=False, details={'skipped': 'no employee'})
        report.step('step7_payslip', ok=False, details={'skipped': 'no employee'})
        step8_integrity(report, hr_user, None)
        return _finalize(report)

    step2_document_flow(report, hr_user, employee)
    emp_user = step3_employee_login(report, employee)
    emp_client = _employee_client(emp_user) if emp_user else APIClient()

    step4_attendance_30_days(report, employee, hr_user)
    if emp_user:
        step5_leave_system(report, hr_client, emp_client, employee, hr_user)
    else:
        report.step('step5_leave', ok=False, details={'skipped': 'no portal user'})

    # Re-validate attendance survived portal calendar recalculation.
    post_leave_calc = PayrollCalculator(employee=employee, month=SIM_MONTH)
    if post_leave_calc.calculate_present_days() <= 0:
        report.fail('step4_attendance', 'Attendance data lost after leave/calendar recalculation', critical=False)

    payroll_run = step6_payroll(report, hr_user, employee)
    if payroll_run:
        step7_payslip(report, hr_user, employee, payroll_run)
    else:
        report.step('step7_payslip', ok=False, details={'skipped': 'no payroll run'})

    step8_integrity(report, hr_user, emp_user)

    return _finalize(report)


def _finalize(report: SimulationReport) -> dict:
    module_status = {
        name: 'PASS' if data.get('ok') else 'FAIL'
        for name, data in report.steps.items()
    }
    return {
        'verdict': report.verdict(),
        'module_status': module_status,
        'steps': report.steps,
        'critical_bugs': report.critical_bugs,
        'warnings': report.warnings,
        'performance_issues': report.performance,
    }


if __name__ == '__main__':
    result = run_simulation()
    print(json.dumps(result, indent=2, default=str))
    sys.exit(0 if result['verdict'] == 'PRODUCTION READY' else 1)
