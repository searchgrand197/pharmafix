"""
Employee portal account provisioning — unified entry point for manual create, activation, and status changes.
"""
from __future__ import annotations

import logging
import secrets
import string

from django.conf import settings
from django.contrib.auth import get_user_model
from django.db import transaction
from django.utils import timezone

from apps.hr.models import Employee
from apps.shared.email_normalization import email_iexact_filter, normalize_email_address

logger = logging.getLogger(__name__)
User = get_user_model()

BLOCKING_REQUIREMENT_STATUSES = frozenset({'pending', 'rejected', 'reupload_requested'})
INACTIVE_EMPLOYEE_STATUSES = frozenset({'inactive', 'terminated'})


def generate_secure_temporary_password(length: int = 14) -> str:
    """Minimum 12 chars with letters, numbers, and special characters."""
    length = max(length, 12)
    lowers = string.ascii_lowercase
    uppers = string.ascii_uppercase
    digits = string.digits
    special = '!@#$%&*-_'
    alphabet = lowers + uppers + digits + special
    rng = secrets.SystemRandom()
    chars = [
        rng.choice(lowers),
        rng.choice(uppers),
        rng.choice(digits),
        rng.choice(special),
    ]
    chars.extend(rng.choice(alphabet) for _ in range(length - len(chars)))
    rng.shuffle(chars)
    return ''.join(chars)


def ensure_employee_id(employee: Employee) -> None:
    if employee.employee_id:
        return
    employee.save()


def validate_activation_documents(employee: Employee) -> tuple[bool, str]:
    """Block activation when mandatory documents are pending, rejected, or awaiting re-upload."""
    from apps.hr.onboarding_documents import (
        calculate_onboarding_progress,
        is_requirement_complete,
        sync_employee_requirements,
    )

    requirements = list(sync_employee_requirements(employee))
    mandatory = [req for req in requirements if req.mandatory]
    if not mandatory:
        progress = calculate_onboarding_progress(employee)
        if progress['all_mandatory_verified']:
            return True, ''
        missing = ', '.join(progress['missing_types']) or 'mandatory checklist items'
        return False, f'Cannot activate employee. Pending mandatory checklist items: {missing}'

    blocking = []
    for req in mandatory:
        if req.status in BLOCKING_REQUIREMENT_STATUSES:
            blocking.append(f'{req.document_type.name} ({req.get_status_display()})')
        elif not is_requirement_complete(req):
            blocking.append(f'{req.document_type.name} (not verified)')

    if blocking:
        return False, (
            'Cannot activate employee. Required documents must be approved first: '
            + ', '.join(blocking)
        )
    return True, ''


def _audit(employee, action, reviewer, notes='', metadata=None):
    from apps.hr.onboarding_documents import log_document_audit
    return log_document_audit(
        employee=employee,
        action=action,
        performed_by=reviewer,
        notes=notes,
        metadata=metadata,
    )


def _split_employee_name(name: str) -> tuple[str, str]:
    parts = (name or '').strip().split()
    if not parts:
        return '', ''
    if len(parts) == 1:
        return parts[0], ''
    return parts[0], ' '.join(parts[1:])


def _find_user_for_employee(employee: Employee):
    if employee.user_id:
        return User.objects.filter(pk=employee.user_id).first()
    email = normalize_email_address(employee.email)
    if not email:
        return None
    return User.objects.filter(**email_iexact_filter(email)).first()


@transaction.atomic
def _link_or_create_user(*, employee: Employee, reviewer, temporary_password: str | None = None) -> dict:
    """Internal: create or link User. Idempotent for existing links."""
    ensure_employee_id(employee)
    employee.refresh_from_db()

    if not employee.email:
        raise ValueError('Employee email is required for portal provisioning.')

    email = normalize_email_address(employee.email)
    now = timezone.now()
    user = _find_user_for_employee(employee)
    created = False
    linked_existing = False
    linked_now = False
    temp_password = temporary_password
    had_user_before = bool(employee.user_id)

    if user is None:
        first_name, last_name = _split_employee_name(employee.name)
        temp_password = temp_password or generate_secure_temporary_password()
        user = User.objects.create_user(
            email=email,
            password=temp_password,
            first_name=first_name,
            last_name=last_name,
            hospital_id=employee.hospital_id,
            must_change_password=True,
            is_active=True,
            is_staff=False,
        )
        created = True
        if not employee.portal_account_created_at:
            employee.portal_account_created_at = now
    else:
        linked_existing = True
        user.is_active = True
        if employee.hospital_id and not user.hospital_id:
            user.hospital_id = employee.hospital_id
        if not user.first_name and employee.name:
            first_name, last_name = _split_employee_name(employee.name)
            user.first_name = first_name
            user.last_name = last_name
        user.save(update_fields=['is_active', 'hospital_id', 'first_name', 'last_name'])

    if employee.user_id != user.id:
        employee.user = user
        linked_now = True
        employee.save(update_fields=['user', 'portal_account_created_at', 'updated_at'])
    elif created and not employee.portal_account_created_at:
        employee.portal_account_created_at = now
        employee.save(update_fields=['portal_account_created_at', 'updated_at'])

    if created or linked_now or (linked_existing and not had_user_before):
        _audit(
            employee,
            'portal_provisioned',
            reviewer,
            notes='Employee portal account provisioned.',
            metadata={
                'user_id': str(user.id),
                'account_created': created,
                'linked_existing_user': linked_existing,
                'portal_account_created_at': (employee.portal_account_created_at or now).isoformat(),
            },
        )

    return {
        'user_id': str(user.id),
        'account_created': created,
        'linked_existing_user': linked_existing,
        'temporary_password': temp_password if created else None,
        'provisioned': created or linked_now,
    }


def _send_welcome_email_once(employee: Employee, *, temporary_password: str | None, reviewer) -> bool:
    """Send portal welcome email at most once per employee."""
    if employee.portal_welcome_email_sent_at:
        return False

    from apps.hr.email_utils import send_employee_portal_welcome_email

    sent = send_employee_portal_welcome_email(employee, temporary_password=temporary_password)
    if sent:
        employee.portal_welcome_email_sent_at = timezone.now()
        employee.save(update_fields=['portal_welcome_email_sent_at', 'updated_at'])
        _audit(
            employee,
            'welcome_email_sent',
            reviewer,
            notes='Portal welcome email sent with login instructions.',
            metadata={
                'email': employee.email,
                'portal_welcome_email_sent_at': employee.portal_welcome_email_sent_at.isoformat(),
                'included_temporary_password': bool(temporary_password),
            },
        )
    return sent


def provision_employee_portal(
    employee: Employee,
    *,
    reviewer=None,
    send_welcome: bool = True,
    source: str = 'unspecified',
    temporary_password: str | None = None,
) -> dict:
    """
    Unified portal provisioning for active employees.

    - No-op when employee.status != 'active'
    - Idempotent: no duplicate users or welcome emails
    """
    employee.refresh_from_db()

    if employee.status != 'active':
        logger.info(
            '[PortalProvision] skipped employee=%s status=%s source=%s',
            employee.employee_id,
            employee.status,
            source,
        )
        return {
            'success': True,
            'skipped': True,
            'reason': 'employee_not_active',
            'portal_provisioned': False,
            'welcome_email_sent': False,
            'source': source,
        }

    if not employee.email:
        return {
            'success': False,
            'skipped': True,
            'reason': 'missing_email',
            'portal_provisioned': False,
            'welcome_email_sent': False,
            'source': source,
        }

    leave_meta = {'leave_balances_updated': 0, 'leave_balances_skipped': True}
    try:
        from apps.hr.leave_services import ensure_employee_leave_balances

        leave_meta = ensure_employee_leave_balances(employee)
    except Exception:
        logger.exception(
            '[PortalProvision] leave balance provisioning failed employee=%s',
            employee.employee_id,
        )

    now = timezone.now()
    if not employee.activated_at:
        employee.activated_at = now
        employee.save(update_fields=['activated_at', 'updated_at'])

    try:
        portal_meta = _link_or_create_user(
            employee=employee,
            reviewer=reviewer,
            temporary_password=temporary_password,
        )
    except ValueError as exc:
        logger.warning('[PortalProvision] failed employee=%s error=%s', employee.employee_id, exc)
        return {
            'success': False,
            'skipped': False,
            'reason': str(exc),
            'portal_provisioned': False,
            'welcome_email_sent': False,
            'source': source,
        }

    welcome_sent = False
    if send_welcome and portal_meta.get('provisioned', portal_meta.get('account_created')):
        welcome_sent = _send_welcome_email_once(
            employee,
            temporary_password=portal_meta.get('temporary_password'),
            reviewer=reviewer,
        )

    if portal_meta.get('provisioned', False) or portal_meta.get('account_created', False):
        from apps.hr.employee_portal_notifications import notify_portal_activation

        notify_portal_activation(employee)

    logger.info(
        '[PortalProvision] employee=%s source=%s created=%s linked=%s welcome=%s',
        employee.employee_id,
        source,
        portal_meta.get('account_created'),
        portal_meta.get('linked_existing_user'),
        welcome_sent,
    )

    return {
        'success': True,
        'skipped': False,
        'portal_provisioned': portal_meta.get('provisioned', False) or portal_meta.get('account_created', False),
        'portal_account_created': portal_meta.get('account_created', False),
        'portal_account_linked': portal_meta.get('linked_existing_user', False),
        'welcome_email_sent': welcome_sent,
        'user_id': portal_meta.get('user_id'),
        'source': source,
        'leave_balances_updated': leave_meta.get('balances_updated', 0),
        'leave_balances_skipped': leave_meta.get('skipped', True),
    }


def provision_employee_portal_deferred(
    *,
    employee_id,
    reviewer_id=None,
    source: str = 'unspecified',
    send_welcome: bool = True,
    temporary_password: str | None = None,
) -> None:
    """Schedule portal provisioning after commit (avoids SQLite lock during API response)."""
    from apps.shared.deferred import run_after_commit

    def _run(**_kwargs):
        employee = Employee.objects.get(pk=employee_id)
        reviewer = User.objects.filter(pk=reviewer_id).first() if reviewer_id else None
        provision_employee_portal(
            employee,
            reviewer=reviewer,
            send_welcome=send_welcome,
            source=source,
            temporary_password=temporary_password,
        )

    run_after_commit(_run)


# Backward-compatible aliases
def provision_portal_account(*, employee: Employee, reviewer, temporary_password: str | None = None) -> dict:
    result = provision_employee_portal(
        employee,
        reviewer=reviewer,
        send_welcome=False,
        source='legacy_provision_portal_account',
        temporary_password=temporary_password,
    )
    return {
        'user_id': result.get('user_id'),
        'account_created': result.get('portal_account_created', False),
        'linked_existing_user': result.get('portal_account_linked', False),
        'temporary_password': temporary_password,
    }


def send_portal_welcome_email(employee: Employee, *, temporary_password: str | None, reviewer) -> bool:
    return _send_welcome_email_once(employee, temporary_password=temporary_password, reviewer=reviewer)


def enable_portal_access(employee: Employee) -> None:
    if employee.user_id:
        User.objects.filter(pk=employee.user_id, is_active=False).update(is_active=True)


def disable_portal_access(employee: Employee) -> None:
    """Disable login without deleting the user account."""
    if employee.user_id:
        User.objects.filter(pk=employee.user_id, is_active=True).update(is_active=False)


def on_employee_status_changed(employee: Employee, previous_status: str) -> None:
    if employee.status in INACTIVE_EMPLOYEE_STATUSES:
        disable_portal_access(employee)
    elif employee.status == 'active' and previous_status != 'active':
        provision_employee_portal(employee, reviewer=None, source='status_change')


def portal_login_allowed(user, employee: Employee | None) -> bool:
    if not user or not getattr(user, 'is_active', True):
        return False
    if not employee or employee.status != 'active':
        return False
    return True


def get_portal_login_url() -> str:
    from config.frontend_url import get_frontend_base_url

    return f'{get_frontend_base_url()}/login'
