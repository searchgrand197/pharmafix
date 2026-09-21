"""Resolve hospital context for HR write operations."""

from __future__ import annotations

from django.conf import settings

from apps.hr.models import Department, Employee, LeaveType
from apps.hr.onboarding_documents import is_hr_reviewer
from apps.shared.models import Hospital

DEFAULT_HOSPITAL_NAME = 'Default Hospital'
DEFAULT_HOSPITAL_SLUG = 'default-hospital'


def ensure_tenant_hospital() -> Hospital:
    """
    Return the active tenant hospital, creating a default one when the DB has none.

    Single-tenant dev/demo installs can lose Hospital rows while users/settings remain;
    HR APIs need a stable hospital scope.
    """
    existing = Hospital.objects.filter(is_active=True).order_by('name').first()
    if existing:
        return existing
    timezone_name = getattr(settings, 'ATTENDANCE_TIME_ZONE', None) or 'Asia/Kolkata'
    hospital, _ = Hospital.objects.get_or_create(
        slug=DEFAULT_HOSPITAL_SLUG,
        defaults={
            'name': DEFAULT_HOSPITAL_NAME,
            'timezone': timezone_name,
            'is_active': True,
        },
    )
    return hospital


def attach_hospital_to_hr_user(user, hospital: Hospital | None = None) -> Hospital | None:
    """Persist hospital on HR staff accounts that were created without tenant scope."""
    if not user or not getattr(user, 'is_staff', False):
        return None
    if getattr(user, 'hospital_id', None):
        return user.hospital
    hospital = hospital or ensure_tenant_hospital()
    user.hospital = hospital
    user.save(update_fields=['hospital'])
    return hospital


def resolve_hr_hospital_id(request):
    """
    Resolve hospital for HR write operations.

    HR staff without user.hospital_id may pass hospital / hospital_id in the body,
    or we infer from existing tenant data.
    """
    if not request:
        return None
    user = getattr(request, 'user', None)
    data = getattr(request, 'data', None) or {}
    query = getattr(request, 'query_params', None) or {}
    body_id = (
        data.get('hospital_id') or data.get('hospital')
        or query.get('hospital_id') or query.get('hospital')
    )
    user_hospital_id = getattr(user, 'hospital_id', None) if user else None

    # Prefer the authenticated user's hospital — stale client hospital_id must not override.
    if user_hospital_id:
        return user_hospital_id
    if body_id:
        return body_id

    dept_id = data.get('department_id')
    if dept_id:
        dept_hospital_id = (
            Department.objects.filter(pk=dept_id)
            .exclude(hospital_id__isnull=True)
            .values_list('hospital_id', flat=True)
            .first()
        )
        if dept_hospital_id:
            return dept_hospital_id

    dept_name = (data.get('department') or '').strip()
    if dept_name:
        dept_hospital_id = (
            Department.objects.filter(name__iexact=dept_name)
            .exclude(hospital_id__isnull=True)
            .values_list('hospital_id', flat=True)
            .first()
        )
        if dept_hospital_id:
            return dept_hospital_id

    if not user or not is_hr_reviewer(user):
        return None
    for model in (LeaveType, Employee, Department):
        hospital_id = (
            model.objects.exclude(hospital_id__isnull=True)
            .values_list('hospital_id', flat=True)
            .first()
        )
        if hospital_id:
            return hospital_id
    hospital = ensure_tenant_hospital()
    attach_hospital_to_hr_user(user, hospital)
    return hospital.id


def resolve_hr_hospital(request) -> Hospital | None:
    hospital_id = resolve_hr_hospital_id(request)
    if not hospital_id:
        return None
    return Hospital.objects.filter(pk=hospital_id).first()
