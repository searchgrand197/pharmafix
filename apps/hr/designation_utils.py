from __future__ import annotations

from dataclasses import dataclass
from typing import TYPE_CHECKING

from rest_framework import serializers

if TYPE_CHECKING:
    from apps.hr.models import Designation, Employee

LINK_ALREADY_LINKED = 'already_linked'
LINK_LINKED = 'linked'
LINK_NO_MATCH = 'no_match'
LINK_MULTIPLE_MATCHES = 'multiple_matches'
LINK_NO_JOB_TITLE = 'no_job_title'
LINK_NO_HOSPITAL = 'no_hospital'


@dataclass
class DesignationLinkResult:
    status: str
    designation: Designation | None = None
    ambiguous_ids: list | None = None

    @property
    def linked(self) -> bool:
        return self.status in {LINK_LINKED, LINK_ALREADY_LINKED}


def resolve_designation_display(employee) -> str | None:
    if employee is None:
        return None
    if getattr(employee, 'designation_id', None) and getattr(employee, 'designation', None):
        return employee.designation.name
    return employee.job_title or None


def resolve_employee_hospital_id(employee) -> str | None:
    hospital_id = getattr(employee, 'hospital_id', None)
    if hospital_id:
        return hospital_id
    if getattr(employee, 'department_ref_id', None) and getattr(employee, 'department_ref', None):
        return getattr(employee.department_ref, 'hospital_id', None)
    return None


def validate_active_designation(designation, *, field: str = 'designation') -> None:
    if designation is None:
        return
    if not designation.is_active:
        raise serializers.ValidationError({field: 'Designation must be active to assign.'})


def validate_designation_hospital(designation, hospital_id, *, field: str = 'designation') -> None:
    if designation is None or not hospital_id:
        return
    if designation.hospital_id != hospital_id:
        raise serializers.ValidationError({field: 'Designation must belong to the same hospital.'})


def sync_job_title_from_designation(attrs, instance=None):
    designation = attrs.get('designation')
    if designation is None and instance is not None:
        designation = getattr(instance, 'designation', None)
    if designation is not None:
        attrs['job_title'] = designation.name
    return attrs


def sync_title_from_designation(attrs, instance=None):
    designation = attrs.get('designation')
    if designation is None and instance is not None:
        designation = getattr(instance, 'designation', None)
    if designation is not None:
        attrs['title'] = designation.name
    return attrs


def _resolve_hospital_id(attrs, instance=None, hospital_id=None):
    if hospital_id:
        return hospital_id
    hospital = attrs.get('hospital')
    if hospital is not None:
        return getattr(hospital, 'id', hospital)
    if instance is not None:
        return getattr(instance, 'hospital_id', None)
    return None


def find_designations_for_job_title(*, hospital_id, job_title, active_only=False):
    from apps.hr.models import Designation

    title = (job_title or '').strip()
    if not title or not hospital_id:
        return Designation.objects.none()

    qs = Designation.objects.filter(hospital_id=hospital_id, name__iexact=title)
    if active_only:
        qs = qs.filter(is_active=True)
    return qs.order_by('name', 'id')


def resolve_designation_link_from_job_title(*, hospital_id, job_title) -> DesignationLinkResult:
    title = (job_title or '').strip()
    if not title:
        return DesignationLinkResult(status=LINK_NO_JOB_TITLE)
    if not hospital_id:
        return DesignationLinkResult(status=LINK_NO_HOSPITAL)

    active_matches = list(find_designations_for_job_title(
        hospital_id=hospital_id,
        job_title=title,
        active_only=True,
    ))
    if len(active_matches) == 1:
        return DesignationLinkResult(status=LINK_LINKED, designation=active_matches[0])
    if len(active_matches) > 1:
        return DesignationLinkResult(
            status=LINK_MULTIPLE_MATCHES,
            ambiguous_ids=[row.id for row in active_matches],
        )

    all_matches = list(find_designations_for_job_title(
        hospital_id=hospital_id,
        job_title=title,
        active_only=False,
    ))
    if len(all_matches) == 1:
        return DesignationLinkResult(status=LINK_LINKED, designation=all_matches[0])
    if len(all_matches) > 1:
        return DesignationLinkResult(
            status=LINK_MULTIPLE_MATCHES,
            ambiguous_ids=[row.id for row in all_matches],
        )
    return DesignationLinkResult(status=LINK_NO_MATCH)


def sync_designation_from_job_title(attrs, instance=None, *, hospital_id=None):
    """Link designation FK when job_title matches exactly one hospital designation name."""
    if attrs.get('designation') is not None:
        return attrs
    if instance is not None and getattr(instance, 'designation_id', None) and 'designation' not in attrs:
        return attrs

    title = (attrs.get('job_title') or getattr(instance, 'job_title', None) or '').strip()
    if not title:
        return attrs

    hospital_id = _resolve_hospital_id(attrs, instance, hospital_id)
    if not hospital_id:
        return attrs

    result = resolve_designation_link_from_job_title(hospital_id=hospital_id, job_title=title)
    if result.status == LINK_LINKED and result.designation is not None:
        attrs['designation'] = result.designation
    return attrs


def link_employee_designation_from_job_title(employee, *, save: bool = True) -> DesignationLinkResult:
    """Link designation FK when job_title matches exactly one hospital designation."""
    if employee.designation_id:
        return DesignationLinkResult(status=LINK_ALREADY_LINKED, designation=employee.designation)

    title = (employee.job_title or '').strip()
    if not title:
        return DesignationLinkResult(status=LINK_NO_JOB_TITLE)

    hospital_id = resolve_employee_hospital_id(employee)
    if not hospital_id:
        return DesignationLinkResult(status=LINK_NO_HOSPITAL)

    result = resolve_designation_link_from_job_title(hospital_id=hospital_id, job_title=title)
    if result.status != LINK_LINKED or result.designation is None:
        return result

    employee.designation = result.designation
    employee.job_title = result.designation.name
    if save:
        employee.save(update_fields=['designation_id', 'job_title', 'updated_at'])
    return DesignationLinkResult(status=LINK_LINKED, designation=result.designation)


def ensure_employee_designation_linked(employee) -> bool:
    """Link designation FK when job_title text matches exactly one hospital designation."""
    return link_employee_designation_from_job_title(employee, save=True).status == LINK_LINKED


def apply_designation_from_hire_sources(employee, offer=None) -> bool:
    """
    Assign designation from job opening FK (preferred) or exactly one job_title name match.
    Returns True when designation_id was set on this call.
    """
    if employee.designation_id:
        return False

    linked = False
    designation = None

    if offer is not None:
        job = getattr(offer, 'job', None)
        if job is None and getattr(offer, 'job_id', None):
            from apps.hr.models import JobOpening

            job = JobOpening.objects.filter(pk=offer.job_id).select_related('designation').first()
        if job and getattr(job, 'designation_id', None):
            designation = job.designation
            linked = True

    if not linked:
        result = link_employee_designation_from_job_title(employee, save=False)
        if result.status == LINK_LINKED and result.designation is not None:
            designation = result.designation
            linked = True

    if linked and designation is not None:
        employee.designation = designation
        employee.job_title = designation.name
        employee.save(update_fields=['designation_id', 'job_title', 'updated_at'])
        return True
    return False


def validate_active_employee_designation(employee, *, override: bool = False) -> tuple[bool, str, str | None]:
    """
    Ensure an employee has designation FK before becoming active.
    Returns (ok, message, error_code).
    """
    if employee.designation_id:
        return True, '', None
    if override:
        return True, '', None

    title = (employee.job_title or '').strip()
    if not title:
        return (
            False,
            'Cannot activate: assign a designation or job title before activation.',
            'missing_designation',
        )

    hospital_id = resolve_employee_hospital_id(employee)
    if not hospital_id:
        return (
            False,
            'Cannot activate: employee must belong to a hospital to resolve designation.',
            'missing_designation',
        )

    result = resolve_designation_link_from_job_title(hospital_id=hospital_id, job_title=title)
    if result.status == LINK_MULTIPLE_MATCHES:
        return (
            False,
            f'Cannot activate: multiple designations match job title "{title}". '
            'Assign one explicitly on the employee profile or use HR override.',
            'ambiguous_designation',
        )
    return (
        False,
        f'Cannot activate: no designation matches job title "{title}". '
        'Create the designation master or assign one on the employee profile.',
        'missing_designation',
    )
