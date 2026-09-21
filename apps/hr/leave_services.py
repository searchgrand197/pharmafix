"""
Leave policy resolution, balance provisioning, and default seeding.
"""
from __future__ import annotations

from decimal import Decimal

from django.db import transaction
from django.db.models import Q

from apps.hr.models import Department, Employee, LeaveBalance, LeavePolicy, LeavePolicyLine, LeaveType

logger = __import__('logging').getLogger(__name__)

UNLIMITED_DAYS = Decimal('9999.00')
DAY_QUANTIZE = Decimal('0.01')

DEFAULT_LEAVE_TYPES = [
    {
        'name': 'Casual Leave',
        'code': 'CL',
        'is_paid': True,
        'annual_limit': Decimal('12.00'),
        'description': 'Short personal leave for planned or unplanned absences.',
    },
    {
        'name': 'Medical Leave',
        'code': 'SL',
        'is_paid': True,
        'annual_limit': Decimal('12.00'),
        'description': 'Medical leave for illness or health recovery.',
    },
    {
        'name': 'Earned Leave',
        'code': 'EL',
        'is_paid': True,
        'annual_limit': Decimal('18.00'),
        'description': 'Accrued earned/privilege leave.',
    },
    {
        'name': 'Leave Without Pay',
        'code': 'LWP',
        'is_paid': False,
        'annual_limit': None,
        'description': 'Unpaid leave when paid balance is exhausted.',
    },
]

DEFAULT_POLICY_NAME = 'Standard Employee Policy'


def leave_type_allows_unpaid(leave_type: LeaveType) -> bool:
    if leave_type.is_paid is False:
        return True
    name = (leave_type.name or '').strip().lower()
    code = (leave_type.code or '').strip().lower()
    return code == 'lwp' or name in {'lwp', 'leave without pay', 'unpaid leave', 'unpaid'}


def _hospital_policies(employee: Employee):
    return LeavePolicy.objects.filter(
        hospital_id=employee.hospital_id,
        is_active=True,
    ).prefetch_related('lines__leave_type', 'departments', 'designations')


def resolve_policy_for_employee(employee: Employee) -> LeavePolicy | None:
    if not employee.hospital_id:
        return None

    base = _hospital_policies(employee)

    if employee.designation_id:
        designation_policy = base.filter(
            assignment_type=LeavePolicy.ASSIGNMENT_DESIGNATION,
            designations=employee.designation_id,
        ).order_by('-updated_at').first()
        if designation_policy:
            return designation_policy

    dept_qs = base.filter(assignment_type=LeavePolicy.ASSIGNMENT_DEPARTMENT)
    if employee.department_ref_id:
        dept_policy = dept_qs.filter(
            departments=employee.department_ref_id,
        ).order_by('-updated_at').first()
        if dept_policy:
            return dept_policy

    dept_name = (employee.department or '').strip()
    if dept_name:
        dept_policy = dept_qs.filter(
            departments__name__iexact=dept_name,
        ).order_by('-updated_at').first()
        if dept_policy:
            return dept_policy

    return None


def get_assigned_leave_types(employee: Employee):
    policy = resolve_policy_for_employee(employee)
    if policy:
        type_ids = policy.lines.filter(leave_type__is_active=True).values_list('leave_type_id', flat=True)
        return LeaveType.objects.filter(id__in=type_ids, is_active=True).order_by('name')
    return LeaveType.objects.filter(hospital_id=employee.hospital_id, is_active=True).order_by('name')


def _active_employees_for_policy_hospital(policy: LeavePolicy):
    """Active employees in policy hospital, including records missing hospital (legacy data)."""
    qs = Employee.objects.filter(status='active')
    if policy.hospital_id:
        qs = qs.filter(Q(hospital_id=policy.hospital_id) | Q(hospital_id__isnull=True))
    return qs


def employees_for_policy(policy: LeavePolicy):
    qs = _active_employees_for_policy_hospital(policy)

    if policy.assignment_type == LeavePolicy.ASSIGNMENT_DESIGNATION:
        designation_ids = list(policy.designations.values_list('pk', flat=True))
        if not designation_ids:
            return Employee.objects.none()
        return qs.filter(designation_id__in=designation_ids)

    if policy.assignment_type == LeavePolicy.ASSIGNMENT_DEPARTMENT:
        departments = list(policy.departments.all())
        if not departments:
            return Employee.objects.none()
        dept_ids = [d.pk for d in departments]
        match = Q(department_ref_id__in=dept_ids)
        for dept in departments:
            if dept.name:
                match |= Q(department__iexact=dept.name)
        return qs.filter(match)

    return Employee.objects.none()


def _employees_resolved_to_policy(policy: LeavePolicy, employees):
    """Keep only employees whose resolved package is this policy (designation overrides department)."""
    matched = []
    for employee in employees:
        resolved = resolve_policy_for_employee(employee)
        if resolved is not None and resolved.pk == policy.pk:
            matched.append(employee)
    return matched


def _sync_employee_hospital_from_policy(employee: Employee, policy: LeavePolicy) -> None:
    if employee.hospital_id or not policy.hospital_id:
        return
    employee.hospital_id = policy.hospital_id
    employee.save(update_fields=['hospital_id', 'updated_at'])
    logger.info(
        '[LeavePolicy] linked employee=%s to hospital=%s during balance apply',
        employee.id,
        policy.hospital_id,
    )


def _allocation_for_line(line: LeavePolicyLine) -> tuple[Decimal, bool]:
    if line.is_unlimited or line.allocated_days is None:
        return UNLIMITED_DAYS, True
    return Decimal(line.allocated_days).quantize(DAY_QUANTIZE), False


@transaction.atomic
def provision_missing_balances(policy: LeavePolicy, *, employees=None) -> int:
    """
    Create missing leave balance rows from a policy without overwriting existing ones.

    Used when an employee opens the portal or is activated so HR manual balance edits
    are preserved. Does not change total_days, used_days, or is_unlimited on existing rows.
    """
    if employees is not None:
        target_employees = list(employees)
    else:
        target_employees = list(employees_for_policy(policy))
    target_employees = _employees_resolved_to_policy(policy, target_employees)

    lines = list(policy.lines.select_related('leave_type').filter(leave_type__is_active=True))
    created_count = 0
    for employee in target_employees:
        _sync_employee_hospital_from_policy(employee, policy)
        for line in lines:
            total_days, is_unlimited = _allocation_for_line(line)
            _, created = LeaveBalance.objects.select_for_update().get_or_create(
                employee=employee,
                leave_type=line.leave_type,
                defaults={
                    'policy': policy,
                    'total_days': total_days,
                    'used_days': Decimal('0.00'),
                    'remaining_days': total_days,
                    'is_unlimited': is_unlimited,
                },
            )
            if created:
                created_count += 1
    return created_count


@transaction.atomic
def apply_policy_balances(policy: LeavePolicy, *, employees=None) -> int:
    """Create or update leave balances for employees covered by the policy."""
    if employees is not None:
        target_employees = list(employees)
    else:
        target_employees = list(employees_for_policy(policy))
    target_employees = _employees_resolved_to_policy(policy, target_employees)

    lines = list(policy.lines.select_related('leave_type').filter(leave_type__is_active=True))
    updated = 0
    for employee in target_employees:
        _sync_employee_hospital_from_policy(employee, policy)
        for line in lines:
            total_days, is_unlimited = _allocation_for_line(line)
            balance, created = LeaveBalance.objects.select_for_update().get_or_create(
                employee=employee,
                leave_type=line.leave_type,
                defaults={
                    'policy': policy,
                    'total_days': total_days,
                    'used_days': Decimal('0.00'),
                    'remaining_days': total_days,
                    'is_unlimited': is_unlimited,
                },
            )
            if not created:
                used = balance.used_days
                balance.policy = policy
                balance.total_days = total_days
                balance.is_unlimited = is_unlimited
                if is_unlimited:
                    balance.remaining_days = UNLIMITED_DAYS
                else:
                    balance.remaining_days = max(Decimal('0.00'), total_days - used).quantize(DAY_QUANTIZE)
                balance.save(update_fields=[
                    'policy', 'total_days', 'remaining_days', 'is_unlimited', 'updated_at',
                ])
            updated += 1
    return updated


def seed_default_leave_types(hospital) -> list[LeaveType]:
    created = []
    for spec in DEFAULT_LEAVE_TYPES:
        leave_type, was_created = LeaveType.objects.get_or_create(
            hospital=hospital,
            code=spec['code'],
            defaults={
                'name': spec['name'],
                'is_paid': spec['is_paid'],
                'annual_limit': spec['annual_limit'],
                'description': spec['description'],
                'is_active': True,
            },
        )
        if was_created:
            created.append(leave_type)
    return created


@transaction.atomic
def seed_default_policy(hospital, *, apply_balances: bool = True) -> LeavePolicy | None:
    """
    Create a standard DEPARTMENT package covering all hospital departments.

    Returns None when the hospital has no departments yet.
    """
    dept_ids = list(Department.objects.filter(hospital=hospital).values_list('pk', flat=True))
    if not dept_ids:
        return None

    leave_types = {
        lt.code: lt
        for lt in LeaveType.objects.filter(hospital=hospital, code__in=[s['code'] for s in DEFAULT_LEAVE_TYPES])
    }
    if len(leave_types) < len(DEFAULT_LEAVE_TYPES):
        seed_default_leave_types(hospital)
        leave_types = {
            lt.code: lt
            for lt in LeaveType.objects.filter(hospital=hospital, code__in=[s['code'] for s in DEFAULT_LEAVE_TYPES])
        }

    policy = LeavePolicy.objects.filter(
        hospital=hospital,
        name=DEFAULT_POLICY_NAME,
        assignment_type=LeavePolicy.ASSIGNMENT_DEPARTMENT,
    ).first()
    if policy is None:
        policy = LeavePolicy.objects.create(
            hospital=hospital,
            name=DEFAULT_POLICY_NAME,
            assignment_type=LeavePolicy.ASSIGNMENT_DEPARTMENT,
            description='Default leave entitlements for employees in hospital departments.',
            is_default=True,
            is_active=True,
        )
    else:
        changed = False
        if not policy.is_default:
            policy.is_default = True
            changed = True
        if not policy.is_active:
            policy.is_active = True
            changed = True
        if changed:
            policy.save(update_fields=['is_default', 'is_active', 'updated_at'])

    policy.departments.set(dept_ids)
    policy.designations.clear()

    allocations = {
        'CL': (Decimal('12.00'), False),
        'SL': (Decimal('12.00'), False),
        'EL': (Decimal('18.00'), False),
        'LWP': (None, True),
    }
    for code, (days, unlimited) in allocations.items():
        leave_type = leave_types.get(code)
        if not leave_type:
            continue
        LeavePolicyLine.objects.update_or_create(
            policy=policy,
            leave_type=leave_type,
            defaults={
                'allocated_days': days,
                'is_unlimited': unlimited,
            },
        )

    if apply_balances:
        apply_policy_balances(policy)
    return policy


def has_sufficient_balance(balance: LeaveBalance | None, days: Decimal, leave_type: LeaveType) -> bool:
    if leave_type_allows_unpaid(leave_type):
        return True
    if balance and balance.is_unlimited:
        return True
    remaining = balance.remaining_days if balance else Decimal('0.00')
    return remaining >= days


def ensure_employee_leave_balances(employee: Employee) -> dict:
    """
    Assign leave policy balances to one active employee (idempotent).

    Called when an employee is activated/created so HR does not need to manually
    apply policy balances. Does not invent a company-wide policy.
    """
    employee.refresh_from_db()

    if employee.status != 'active':
        return {'skipped': True, 'reason': 'employee_not_active', 'balances_updated': 0}

    if not employee.hospital_id:
        logger.warning(
            '[LeaveBalance] skipped employee=%s — no hospital linked',
            employee.employee_id,
        )
        return {'skipped': True, 'reason': 'no_hospital', 'balances_updated': 0}

    policy = resolve_policy_for_employee(employee)
    if not policy or not policy.is_active:
        logger.warning(
            '[LeaveBalance] no matching policy for employee=%s hospital=%s',
            employee.employee_id,
            employee.hospital_id,
        )
        return {'skipped': True, 'reason': 'no_matching_policy', 'balances_updated': 0}

    count = provision_missing_balances(policy, employees=[employee])
    logger.info(
        '[LeaveBalance] provisioned employee=%s policy=%s balances_created=%s',
        employee.employee_id,
        policy.id,
        count,
    )
    return {
        'skipped': False,
        'balances_updated': count,
        'balances_created': count,
        'policy_id': str(policy.pk),
    }
