"""
Post-reset HRMS system health audit (read-only).
Run: python scripts/validate_hrms_health.py
"""
from __future__ import annotations

import json
import os
import sys
from io import StringIO

import django

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')
django.setup()

from django.apps import apps
from django.contrib.auth import get_user_model
from django.core.management import call_command
from django.db import connection
from rest_framework.test import APIClient

from apps.hr.models import (
    DailyAttendance,
    Department,
    Employee,
    EmployeeDocument,
    JobOpening,
    LeaveRequest,
    LeaveType,
)
from apps.hr.payroll_models import PayrollAuditLog, PayrollRun, Payslip, SalaryStructure

User = get_user_model()

REQUIRED_TABLES = {
    'core': ['accounts_user', 'hr_employee', 'shared_hospital'],
    'attendance': ['hr_dailyattendance', 'hr_attendancepunch', 'hr_shift'],
    'leave': ['hr_leaverequest', 'hr_leavetype', 'hr_leavebalance'],
    'payroll': ['hr_salarystructure', 'hr_payrollrun', 'hr_payslip', 'hr_payrollauditlog'],
    'documents': ['hr_employeedocument', 'hr_documenttype'],
}

SEED_EXPECTATIONS = {
    'hr_user_email': 'hr@test.com',
    'employee_count_min': 3,
    'department_count_min': 3,
    'job_count_min': 2,
    'attendance_count_min': 1,
    'leave_count_min': 2,
    'salary_structure_count_min': 3,
}

CORE_API_ENDPOINTS = [
    ('GET', '/api/v1/hr/employees/', 'hr'),
    ('GET', '/api/v1/hr/departments/', 'hr'),
    ('GET', '/api/v1/hr/job-openings/', 'hr'),
    ('GET', '/api/v1/hr/daily-attendance/', 'hr'),
    ('GET', '/api/v1/hr/leave-requests/', 'hr'),
    ('GET', '/api/v1/hr/payroll-runs/', 'hr'),
    ('GET', '/api/v1/hr/dashboard/', 'hr'),
    ('GET', '/api/v1/employee-portal/dashboard/', 'employee'),
    ('GET', '/api/v1/employee-portal/profile/', 'employee'),
    ('GET', '/api/v1/employee-portal/attendance/', 'employee'),
    ('GET', '/api/v1/employee-portal/leaves/', 'employee'),
    ('GET', '/api/v1/employee-portal/payslips/', 'employee'),
    ('GET', '/api/v1/hr/documents/', 'hr'),
]


def get_tables() -> set[str]:
    return set(connection.introspection.table_names())


def migration_report() -> dict:
    out = StringIO()
    call_command('showmigrations', '--plan', stdout=out, no_color=True)
    lines = out.getvalue().splitlines()
    unapplied = [line.strip() for line in lines if '[ ]' in line]
    hr_lines = [line.strip() for line in lines if 'hr.' in line]
    hr_unapplied = [line for line in hr_lines if '[ ]' in line]
    return {
        'total_unapplied': len(unapplied),
        'unapplied': unapplied[:20],
        'hr_total': len(hr_lines),
        'hr_unapplied': hr_unapplied,
        'hr_fully_migrated': len(hr_unapplied) == 0,
    }


def schema_report(tables: set[str]) -> dict:
    missing = {}
    for group, names in REQUIRED_TABLES.items():
        group_missing = [t for t in names if t not in tables]
        if group_missing:
            missing[group] = group_missing
    return {
        'table_count': len(tables),
        'missing_by_group': missing,
        'all_required_present': not missing,
    }


def seed_report() -> dict:
    hr_user = User.objects.filter(email=SEED_EXPECTATIONS['hr_user_email']).first()
    employees = list(Employee.objects.values('name', 'status', 'employee_id', 'email'))
    return {
        'hr_user_exists': hr_user is not None,
        'hr_user_is_staff': bool(hr_user and hr_user.is_staff),
        'employee_count': Employee.objects.count(),
        'employees': employees,
        'department_count': Department.objects.count(),
        'job_count': JobOpening.objects.count(),
        'attendance_count': DailyAttendance.objects.count(),
        'leave_count': LeaveRequest.objects.count(),
        'salary_structure_count': SalaryStructure.objects.count(),
        'payroll_run_count': PayrollRun.objects.count(),
        'payslip_count': Payslip.objects.count(),
        'leave_types': LeaveType.objects.count(),
        'seed_complete': all([
            hr_user is not None,
            Employee.objects.count() >= SEED_EXPECTATIONS['employee_count_min'],
            Department.objects.count() >= SEED_EXPECTATIONS['department_count_min'],
            JobOpening.objects.count() >= SEED_EXPECTATIONS['job_count_min'],
            DailyAttendance.objects.count() >= SEED_EXPECTATIONS['attendance_count_min'],
            LeaveRequest.objects.count() >= SEED_EXPECTATIONS['leave_count_min'],
            SalaryStructure.objects.count() >= SEED_EXPECTATIONS['salary_structure_count_min'],
        ]),
    }


def auth_report() -> dict:
    client = APIClient()
    results = {'hr_login': None, 'employee_login': None, 'mapping': {}, 'rbac': {}}

    hr_user = User.objects.filter(email='hr@test.com').first()
    emp_user = User.objects.filter(email='employee-a@test.com').first()
    emp_record = Employee.objects.filter(email='employee-a@test.com').first()

    if hr_user:
        client.force_authenticate(user=hr_user)
        res = client.post('/api/v1/auth/login/', {'email': 'hr@test.com', 'password': 'dev-hr-pass-123'}, format='json')
        results['hr_login'] = {'status': res.status_code, 'ok': res.status_code == 200}
        if res.status_code == 200:
            token = res.data.get('access')
            results['hr_login']['has_token'] = bool(token)

        client.force_authenticate(user=hr_user)
        hr_res = client.get('/api/v1/hr/employees/')
        results['rbac']['hr_accesses_hr_api'] = hr_res.status_code == 200
        portal_res = client.get('/api/v1/employee-portal/dashboard/')
        results['rbac']['hr_blocked_from_portal'] = portal_res.status_code == 403

    if emp_user and emp_record:
        client = APIClient()
        res = client.post(
            '/api/v1/auth/login/',
            {'email': 'employee-a@test.com', 'password': 'dev-employee-pass-123'},
            format='json',
        )
        results['employee_login'] = {'status': res.status_code, 'ok': res.status_code == 200}

        client.force_authenticate(user=emp_user)
        profile = client.get('/api/v1/employee-portal/profile/')
        results['mapping']['profile_status'] = profile.status_code
        if profile.status_code == 200:
            results['mapping']['profile_matches_employee'] = profile.data.get('id') == str(emp_record.id)
        hr_block = client.get('/api/v1/hr/employees/')
        results['rbac']['employee_blocked_from_hr'] = hr_block.status_code == 403

    results['auth_ok'] = (
        results.get('hr_login', {}).get('ok')
        and results.get('employee_login', {}).get('ok')
        and results.get('rbac', {}).get('hr_accesses_hr_api')
        and results.get('rbac', {}).get('employee_blocked_from_hr')
    )
    return results


def api_report() -> dict:
    hr_user = User.objects.filter(email='hr@test.com').first()
    emp_user = User.objects.filter(email='employee-a@test.com').first()
    results = []

    for method, path, role in CORE_API_ENDPOINTS:
        client = APIClient()
        if role == 'hr' and hr_user:
            client.force_authenticate(user=hr_user)
        elif role == 'employee' and emp_user:
            client.force_authenticate(user=emp_user)
        else:
            continue
        res = client.get(path) if method == 'GET' else client.post(path, {}, format='json')
        entry = {
            'method': method,
            'path': path,
            'role': role,
            'status': res.status_code,
            'ok': res.status_code < 500,
            'healthy': res.status_code in {200, 201},
        }
        if res.status_code >= 500:
            entry['error'] = str(getattr(res, 'data', res.content[:200]))
        results.append(entry)

    broken = [r for r in results if not r['ok']]
    degraded = [r for r in results if r['ok'] and not r['healthy']]
    return {
        'endpoints_tested': len(results),
        'broken_5xx': broken,
        'non_200_ok': degraded,
        'all_no_500': len(broken) == 0,
    }


def module_report(tables: set[str], seed: dict, api: dict) -> dict:
    modules = {}

    modules['attendance'] = (
        'working' if 'hr_dailyattendance' in tables and seed['attendance_count'] > 0
        and any(r['path'] == '/api/v1/hr/daily-attendance/' and r['healthy'] for r in api.get('_results', []))
        else 'partially_working' if 'hr_dailyattendance' in tables else 'broken'
    )
    modules['leave'] = (
        'working' if 'hr_leaverequest' in tables and seed['leave_count'] > 0
        else 'partially_working' if 'hr_leaverequest' in tables else 'broken'
    )
    modules['documents'] = (
        'working' if 'hr_employeedocument' in tables else 'partially_working'
    )
    modules['payroll'] = (
        'working' if seed['salary_structure_count'] > 0 and 'hr_salarystructure' in tables
        else 'broken' if 'hr_salarystructure' not in tables else 'partially_working'
    )
    modules['dashboard'] = 'working'  # set below from API

    return modules


def main():
    tables = get_tables()
    migrations = migration_report()
    schema = schema_report(tables)
    seed = seed_report()
    auth = auth_report()
    api = api_report()

    # enrich module report with api results
    api['_results'] = [
        r for r in (
            [{'method': 'GET', 'path': p, 'role': role, 'status': 0, 'ok': True, 'healthy': False}]
            for _, p, role in CORE_API_ENDPOINTS
        )
    ]
    client_hr = APIClient()
    client_emp = APIClient()
    hr_user = User.objects.filter(email='hr@test.com').first()
    emp_user = User.objects.filter(email='employee-a@test.com').first()
    api_results = []
    for method, path, role in CORE_API_ENDPOINTS:
        c = APIClient()
        if role == 'hr' and hr_user:
            c.force_authenticate(user=hr_user)
        elif role == 'employee' and emp_user:
            c.force_authenticate(user=emp_user)
        else:
            continue
        res = c.get(path)
        api_results.append({'path': path, 'role': role, 'status': res.status_code, 'healthy': res.status_code in {200, 201}})

    modules = {
        'attendance': 'working' if any(r['path']=='/api/v1/hr/daily-attendance/' and r['healthy'] for r in api_results) and seed['attendance_count']>0 else 'partially_working',
        'leave': 'working' if any(r['path']=='/api/v1/hr/leave-requests/' and r['healthy'] for r in api_results) and seed['leave_count']>0 else 'partially_working',
        'employee_portal': 'working' if any(r['path']=='/api/v1/employee-portal/dashboard/' and r['healthy'] for r in api_results) else 'partially_working',
        'documents': 'partially_working' if 'hr_employeedocument' in tables else 'broken',
        'payroll': 'working' if seed['salary_structure_count']>0 and 'hr_salarystructure' in tables else 'broken',
        'dashboard_hr': 'working' if any(r['path']=='/api/v1/hr/dashboard/' and r['healthy'] for r in api_results) else 'partially_working',
    }

    critical = []
    if migrations['total_unapplied']:
        critical.append(f"{migrations['total_unapplied']} unapplied migrations")
    if not schema['all_required_present']:
        critical.append(f"Missing tables: {schema['missing_by_group']}")
    if not seed['seed_complete']:
        critical.append('Seed data incomplete')
    if not auth.get('auth_ok'):
        critical.append('Authentication or RBAC check failed')
    if not api['all_no_500']:
        critical.append(f"API 500 errors: {[b['path'] for b in api['broken_5xx']]}")

    if critical:
        verdict = 'SYSTEM BROKEN (FIX REQUIRED)'
    elif any(v == 'partially_working' for v in modules.values()) or api['non_200_ok']:
        verdict = 'SYSTEM STABLE (DEVELOPMENT READY)'
    else:
        verdict = 'SYSTEM STABLE (DEVELOPMENT READY)'

    if not critical and all(v == 'working' for v in modules.values()) and auth.get('auth_ok'):
        verdict = 'SYSTEM HEALTHY (PRODUCTION READY)'

    report = {
        'migrations': migrations,
        'schema': schema,
        'seed': seed,
        'auth': auth,
        'api': api,
        'modules': modules,
        'critical_issues': critical,
        'verdict': verdict,
        'installed_apps': len(apps.get_app_configs()),
    }
    print(json.dumps(report, indent=2, default=str))


if __name__ == '__main__':
    main()
