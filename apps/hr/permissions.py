"""
Central authorization for HRMS and employee-portal APIs.

Backend is the single source of truth: role checks, hospital scoping, and
object-level access must not rely on frontend state.
"""
from __future__ import annotations

import logging
from typing import Any

from rest_framework.permissions import BasePermission

from apps.hr.employee_portal import resolve_employee_for_user
from apps.hr.onboarding_documents import is_hr_reviewer
from apps.hr.portal_provisioning import portal_login_allowed  # used by is_authenticated_employee

security_logger = logging.getLogger('hr.security')


def log_security_event(
    event_type: str,
    *,
    request=None,
    user=None,
    detail: str | None = None,
    denied: bool = False,
    extra: dict[str, Any] | None = None,
) -> None:
    """Record security-relevant API access outcomes."""
    payload: dict[str, Any] = {
        'event': event_type,
        'denied': denied,
    }
    if user is not None:
        payload['user_id'] = getattr(user, 'pk', None)
        payload['email'] = getattr(user, 'email', None)
        payload['is_staff'] = getattr(user, 'is_staff', False)
        payload['hospital_id'] = getattr(user, 'hospital_id', None)
    if request is not None:
        payload['path'] = getattr(request, 'path', None)
        payload['method'] = getattr(request, 'method', None)
    if detail:
        payload['detail'] = detail
    if extra:
        payload.update(extra)
    security_logger.warning('hr_security_event %s', payload)


def is_hr_user(user) -> bool:
    """HR or admin reviewer (staff / superuser)."""
    return is_hr_reviewer(user)


def is_employee_user(user) -> bool:
    """Non-HR authenticated user with a linked employee profile."""
    if not user or not getattr(user, 'is_authenticated', False) or not user.is_authenticated:
        return False
    if is_hr_user(user):
        return False
    return resolve_employee_for_user(user) is not None


def is_authenticated_employee(user, *, require_active: bool = False) -> bool:
    employee = resolve_employee_for_user(user, require_active=require_active)
    if not employee:
        return False
    if not portal_login_allowed(user, employee):
        return False
    if getattr(user, 'must_change_password', False):
        return False
    return True


def belongs_to_hospital(user, hospital_id) -> bool:
    """True when the user may access data for the given hospital."""
    if not user or not getattr(user, 'is_authenticated', False) or not user.is_authenticated:
        return False
    if getattr(user, 'is_superuser', False):
        return True
    user_hospital_id = getattr(user, 'hospital_id', None)
    if not user_hospital_id or hospital_id is None:
        return False
    return str(user_hospital_id) == str(hospital_id)


class IsHRStaffUser(BasePermission):
    """Restrict access to HR staff (is_staff or is_superuser)."""

    message = 'Access denied. HR staff only.'

    def has_permission(self, request, view) -> bool:
        user = request.user
        if not user or not user.is_authenticated:
            log_security_event(
                'unauthenticated_hr_access',
                request=request,
                detail=getattr(view, '__class__', type(view)).__name__,
                denied=True,
            )
            return False
        if not is_hr_user(user):
            log_security_event(
                'forbidden_hr_access',
                request=request,
                user=user,
                detail=getattr(view, '__class__', type(view)).__name__,
                denied=True,
            )
            return False
        return True


class IsEmployeePortalUser(BasePermission):
    """
    Employee self-service portal — non-HR users only.

    Profile resolution and ownership checks remain in ``get_employee_for_request``.
    """

    message = 'Employee portal access denied.'

    def has_permission(self, request, view) -> bool:
        user = request.user
        if not user or not user.is_authenticated:
            log_security_event(
                'unauthenticated_portal_access',
                request=request,
                detail=getattr(view, '__class__', type(view)).__name__,
                denied=True,
            )
            return False
        if is_hr_user(user):
            log_security_event(
                'hr_user_blocked_from_portal',
                request=request,
                user=user,
                detail=getattr(view, '__class__', type(view)).__name__,
                denied=True,
            )
            return False
        return True
