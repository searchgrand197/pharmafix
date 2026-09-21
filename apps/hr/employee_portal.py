"""
Employee self-service portal — resolve logged-in user to HR Employee and enforce ownership.
"""
from __future__ import annotations

from rest_framework.exceptions import NotFound, PermissionDenied

from apps.hr.models import Employee
from apps.hr.portal_provisioning import portal_login_allowed
from apps.shared.email_normalization import email_iexact_filter


class EmployeePortalError(Exception):
    def __init__(self, message: str, code: str = 'portal_error'):
        super().__init__(message)
        self.message = message
        self.code = code


def resolve_employee_for_user(user, *, require_active: bool = False) -> Employee | None:
    """Map auth User → Employee via explicit link or normalized email."""
    if not user or not getattr(user, 'is_authenticated', False) or not user.is_authenticated:
        return None

    employee = (
        Employee.objects.select_related('shift', 'hospital', 'user')
        .filter(user_id=user.id)
        .first()
    )
    if not employee:
        email = getattr(user, 'email', None)
        if not email:
            return None
        qs = Employee.objects.select_related('shift', 'hospital', 'user').filter(**email_iexact_filter(email))
        if getattr(user, 'hospital_id', None):
            qs = qs.filter(hospital_id=user.hospital_id)
        employee = qs.first()

    if not employee:
        return None
    if require_active and employee.status != 'active':
        return None
    return employee


def get_employee_for_request(request, *, require_active: bool = False) -> Employee:
    user = request.user
    employee = resolve_employee_for_user(user, require_active=require_active)
    if not employee:
        raise NotFound('No employee profile linked to this account. Use the email on your HR employee record.')
    if not portal_login_allowed(user, employee):
        raise PermissionDenied('Employee portal access is disabled for this account.')
    if getattr(user, 'must_change_password', False):
        raise PermissionDenied('Password change required before accessing the employee portal.')
    return employee


def assert_employee_owns(employee: Employee, obj_employee_id) -> None:
    if str(employee.id) != str(obj_employee_id):
        raise PermissionDenied('You can only access your own employee records.')
