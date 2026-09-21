from __future__ import annotations

import logging
import os

from django.conf import settings
from django.core.files.storage import default_storage
from django.utils import timezone

logger = logging.getLogger(__name__)

DOCUMENT_TYPE_ALIASES = {
    'aadhar': 'aadhaar',
    'aadhaar': 'aadhaar',
    'aadhar card': 'aadhaar',
    'pan': 'pan',
    'pan card': 'pan',
    'resume': 'resume',
    'resumes': 'resume',
    'cv': 'resume',
    # Default seeded DocumentType names normalize to multi-word keys; UI slugs must map to those.
    'degree': 'degree certificate',
    'education': 'degree certificate',
    'educational': 'degree certificate',
    'experience certificate': 'degree certificate',
    'experince certificate': 'degree certificate',
    'bank': 'bank details',
    'bank_details': 'bank details',
    'bank account': 'bank details',
    'bank copy': 'bank details',
    'cancelled cheque': 'bank details',
    'canceled cheque': 'bank details',
}


def normalize_document_type(document_type: str | None) -> str | None:
    if not document_type:
        return document_type
    if hasattr(document_type, 'name'):
        document_type = getattr(document_type, 'name', None) or ''
    if not isinstance(document_type, str):
        document_type = str(document_type)
    key = document_type.strip().lower()
    return DOCUMENT_TYPE_ALIASES.get(key, key)


def is_hr_reviewer(user) -> bool:
    return bool(user and user.is_authenticated and (user.is_superuser or user.is_staff))


def reviewer_display_name(user) -> str | None:
    if not user:
        return None
    return getattr(user, 'full_name', None) or getattr(user, 'email', None)


def document_label(document_type) -> str:
    normalized = normalize_document_type(document_type) or 'document'
    return normalized.replace('_', ' ').title()


def get_employee_offer(employee):
    from apps.hr.models import Offer

    if getattr(employee, 'offer_id', None):
        return employee.offer

    if employee.email:
        from apps.shared.email_normalization import normalize_email_address
        offer = (
            Offer.objects.filter(
                candidate__email__iexact=normalize_email_address(employee.email),
                status='accepted',
            )
            .order_by('-created_at')
            .first()
        )
        if offer:
            return offer
    return None


def get_employee_for_offer(offer):
    """Resolve the Employee row for this offer — prefer FK links, not candidate email alone."""
    from apps.hr.models import Employee

    if not offer:
        return None
    candidate = offer.candidate
    if not candidate:
        return None
    rec = getattr(candidate, 'employee_record', None)
    if rec:
        return rec
    emp = Employee.objects.filter(candidate=candidate).first()
    if emp:
        return emp
    return Employee.objects.filter(offer=offer).first()


def should_reset_onboarding_docs_for_offer(employee, candidate, offer) -> bool:
    """True when reusing an employee row for a different hire — old uploads must not carry over."""
    if employee.candidate_id and employee.candidate_id != candidate.id:
        return True
    if employee.offer_id and employee.offer_id != offer.id:
        return True
    return False


def clear_employee_onboarding_uploads(employee) -> None:
    """
    Remove onboarding files and reset requirement / legacy document state for this employee.
    Used when the same Employee row is linked to a new candidate or offer.
    """
    from apps.hr.models import EmployeeDocument, EmployeeDocumentRequirement

    for req in EmployeeDocumentRequirement.objects.filter(employee=employee):
        if req.uploaded_file:
            req.uploaded_file.delete(save=False)
        EmployeeDocumentRequirement.objects.filter(pk=req.pk).update(
            uploaded_file=None,
            uploaded_at=None,
            status='pending',
            verified_at=None,
            verified_by_id=None,
            rejection_reason='',
            verification_notes='',
            physically_verified=False,
            override_approved=False,
            expires_at=None,
        )

    for legacy in EmployeeDocument.objects.filter(employee=employee):
        if legacy.file:
            legacy.file.delete(save=False)
        EmployeeDocument.objects.filter(pk=legacy.pk).update(
            file=None,
            status='pending',
            verified_at=None,
            verified_by_id=None,
            rejection_reason='',
        )

    refresh_employee_onboarding_status(employee)


def get_employee_for_portal(offer):
    """
    Employee to show for this onboarding link without creating DB rows.
    Avoids attributing another candidate's uploads when email is reused but the row
    is tied to a different Candidate.
    """
    employee = get_employee_for_offer(offer)
    if employee:
        return employee
    candidate = offer.candidate
    if not candidate or not candidate.email:
        return None
    from apps.hr.models import Employee

    from apps.shared.email_normalization import email_iexact_filter
    emp = Employee.objects.filter(**email_iexact_filter(candidate.email)).first()
    if not emp:
        return None
    if emp.candidate_id and emp.candidate_id != candidate.id:
        return None
    return emp


def ensure_employee_for_offer(offer):
    """
    Employee row for onboarding mutations (upload, complete). Creates or relinks safely
    and clears stale document state when the row is reused for another hire.
    """
    from django.db import IntegrityError, transaction
    from apps.hr.models import Employee
    from apps.hr.payroll_api.department_structure_service import apply_department_from_offer

    candidate = offer.candidate
    if not candidate:
        return None

    employee = get_employee_for_offer(offer)
    if not employee and candidate.email:
        from apps.shared.email_normalization import email_iexact_filter
        employee = Employee.objects.filter(**email_iexact_filter(candidate.email)).first()

    if employee:
        if should_reset_onboarding_docs_for_offer(employee, candidate, offer):
            clear_employee_onboarding_uploads(employee)
        employee.candidate = candidate
        employee.offer = offer
        employee.name = candidate.name
        employee.email = candidate.email
        if candidate.phone:
            employee.phone = candidate.phone
        if candidate.gender:
            employee.gender = candidate.gender
        hospital = getattr(candidate.job_opening, 'hospital', None)
        if hospital is not None:
            employee.hospital = hospital
        if offer.job_title:
            employee.job_title = offer.job_title
        if offer.ctc is not None:
            employee.salary = offer.ctc
        if offer.joining_date:
            employee.joining_date = offer.joining_date
        apply_department_from_offer(employee, offer)
        employee.save()
        from apps.hr.designation_utils import apply_designation_from_hire_sources

        apply_designation_from_hire_sources(employee, offer=offer)
        return employee

    hospital = getattr(candidate.job_opening, 'hospital', None)
    try:
        with transaction.atomic():
            employee = Employee(
                name=candidate.name,
                email=candidate.email,
                phone=candidate.phone or '',
                gender=candidate.gender or '',
                hospital=hospital,
                candidate=candidate,
                offer=offer,
                job_title=offer.job_title or '',
                salary=offer.ctc,
                joining_date=offer.joining_date,
                status='pending_onboarding',
                onboarding_status='pending_documents',
            )
            apply_department_from_offer(employee, offer)
            employee.save()
            from apps.hr.designation_utils import apply_designation_from_hire_sources

            apply_designation_from_hire_sources(employee, offer=offer)
            return employee
    except IntegrityError:
        from apps.shared.email_normalization import email_iexact_filter
        existing = Employee.objects.filter(**email_iexact_filter(candidate.email)).first()
        if not existing:
            raise
        if should_reset_onboarding_docs_for_offer(existing, candidate, offer):
            clear_employee_onboarding_uploads(existing)
        existing.candidate = candidate
        existing.offer = offer
        existing.name = candidate.name
        existing.email = candidate.email
        if candidate.phone:
            existing.phone = candidate.phone
        if candidate.gender:
            existing.gender = candidate.gender
        if hospital is not None:
            existing.hospital = hospital
        if offer.job_title:
            existing.job_title = offer.job_title
        if offer.ctc is not None:
            existing.salary = offer.ctc
        if offer.joining_date:
            existing.joining_date = offer.joining_date
        apply_department_from_offer(existing, offer)
        existing.status = 'pending_onboarding'
        existing.onboarding_status = 'pending_documents'
        existing.save()
        from apps.hr.designation_utils import apply_designation_from_hire_sources

        apply_designation_from_hire_sources(existing, offer=offer)
        return existing


def get_onboarding_upload_url(employee) -> str | None:
    offer = get_employee_offer(employee)
    if not offer or getattr(offer, 'onboarding_token_expired', False):
        return None
    from config.frontend_url import get_frontend_base_url

    base_url = get_frontend_base_url()
    return f'{base_url}/offer/onboarding/{offer.token}'


# Standard onboarding checklist shown on /hr/checklist-rules and used when
# an employee has no job/application document snapshot.
DEFAULT_ONBOARDING_DOCUMENT_TYPES = (
    ('Aadhaar', 'Government ID proof', True, 'upload'),
    ('PAN', 'Tax identity document', True, 'upload'),
    ('Resume', 'Latest profile resume', True, 'upload'),
    ('Degree Certificate', 'Highest education certificate', True, 'upload'),
    ('Bank Details', 'Cancelled cheque or account proof', True, 'upload'),
)


def ensure_default_document_types(hospital) -> list:
    """
    Ensure the hospital has the standard onboarding DocumentType rows.

    Uses get_or_create so deactivated types are left alone; only missing
    names are created. Returns newly created DocumentType instances.
    """
    from apps.hr.models import DocumentType

    if not hospital:
        return []

    created = []
    for name, description, mandatory, verification_mode in DEFAULT_ONBOARDING_DOCUMENT_TYPES:
        document_type, was_created = DocumentType.objects.get_or_create(
            hospital=hospital,
            name=name,
            defaults={
                'description': description,
                'mandatory': mandatory,
                'verification_mode': verification_mode,
                'is_active': True,
            },
        )
        if was_created:
            created.append(document_type)
    return created


def _seed_default_document_types_for_employee(employee):
    hospital = getattr(employee, 'hospital', None)
    ensure_default_document_types(hospital)


def _document_type_priority(document_type, hospital_id) -> int:
    if hospital_id and document_type.hospital_id == hospital_id:
        return 100
    if document_type.hospital_id is None:
        return 10
    return 0


def _select_document_types_for_employee(employee):
    """One checklist row per logical document — prefer hospital-scoped types over global duplicates."""
    from django.db.models import Q
    from apps.hr.models import DocumentType

    hospital_id = getattr(employee, 'hospital_id', None)
    document_types_qs = DocumentType.objects.filter(is_active=True)
    if hospital_id:
        document_types_qs = document_types_qs.filter(Q(hospital_id=hospital_id) | Q(hospital__isnull=True))
    else:
        document_types_qs = document_types_qs.filter(hospital__isnull=True)

    by_key: dict[str, DocumentType] = {}
    for document_type in document_types_qs.order_by('name'):
        key = normalize_document_type(document_type.name) or document_type.name.strip().lower()
        existing = by_key.get(key)
        if existing is None or _document_type_priority(document_type, hospital_id) > _document_type_priority(
            existing, hospital_id,
        ):
            by_key[key] = document_type
    return list(by_key.values())


def _requirement_priority(requirement, hospital_id) -> int:
    score = _document_type_priority(requirement.document_type, hospital_id)
    if requirement.physically_verified or requirement.status in {'verified', 'physically_verified'}:
        score += 50
    if requirement.uploaded_file:
        score += 25
    if requirement.override_approved:
        score += 25
    return score


def _merge_requirement_into_keeper(keeper, duplicate) -> None:
    """Preserve verification/upload state when collapsing duplicate checklist rows."""
    changed = False
    fields: list[str] = []
    if duplicate.uploaded_file and not keeper.uploaded_file:
        keeper.uploaded_file = duplicate.uploaded_file
        keeper.uploaded_at = duplicate.uploaded_at
        keeper.file_hash = duplicate.file_hash or ''
        fields.extend(['uploaded_file', 'uploaded_at', 'file_hash'])
        changed = True
    if duplicate.physically_verified and not keeper.physically_verified:
        keeper.physically_verified = True
        fields.append('physically_verified')
        changed = True
    if duplicate.status in {'verified', 'physically_verified'} and keeper.status not in {
        'verified', 'physically_verified',
    }:
        keeper.status = duplicate.status
        fields.append('status')
        changed = True
    if duplicate.verified_at and not keeper.verified_at:
        keeper.verified_at = duplicate.verified_at
        keeper.verified_by = duplicate.verified_by
        fields.extend(['verified_at', 'verified_by'])
        changed = True
    if duplicate.verification_notes and not keeper.verification_notes:
        keeper.verification_notes = duplicate.verification_notes
        fields.append('verification_notes')
        changed = True
    if duplicate.override_approved and not keeper.override_approved:
        keeper.override_approved = True
        fields.append('override_approved')
        changed = True
    if changed:
        fields.append('updated_at')
        keeper.save(update_fields=fields)


def _dedupe_employee_requirements(employee) -> None:
    from apps.hr.models import EmployeeDocumentRequirement

    hospital_id = getattr(employee, 'hospital_id', None)
    reqs = list(
        EmployeeDocumentRequirement.objects.filter(employee=employee).select_related('document_type'),
    )
    groups: dict[str, list] = {}
    for req in reqs:
        key = normalize_document_type(req.document_type.name) or req.document_type.name.strip().lower()
        groups.setdefault(key, []).append(req)

    for group in groups.values():
        if len(group) <= 1:
            continue
        group.sort(key=lambda row: _requirement_priority(row, hospital_id), reverse=True)
        keeper = group[0]
        for duplicate in group[1:]:
            _merge_requirement_into_keeper(keeper, duplicate)
            duplicate.delete()


def _sync_employee_from_application_snapshot(employee):
    """Build employee checklist only from immutable application document requirements."""
    from apps.hr.job_document_requirements import (
        application_uses_job_document_snapshot,
        get_application_document_requirements,
    )
    from django.db.models import Q
    from apps.hr.models import EmployeeDocumentRequirement

    candidate = getattr(employee, 'candidate', None)
    if not candidate or not application_uses_job_document_snapshot(candidate):
        return None

    app_reqs = list(get_application_document_requirements(candidate))
    if not app_reqs:
        # Direct hire / jobs with no checklist still snapshot an empty application list.
        return None
    snapshot_type_ids = {req.document_type_id for req in app_reqs}

    for app_req in app_reqs:
        emp_req, created = EmployeeDocumentRequirement.objects.get_or_create(
            employee=employee,
            document_type=app_req.document_type,
            defaults={'mandatory': app_req.is_required, 'status': 'pending'},
        )
        if not created and emp_req.mandatory != app_req.is_required:
            emp_req.mandatory = app_req.is_required
            emp_req.save(update_fields=['mandatory', 'updated_at'])

    EmployeeDocumentRequirement.objects.filter(employee=employee).exclude(
        document_type_id__in=snapshot_type_ids,
    ).filter(status='pending').filter(
        Q(uploaded_file='') | Q(uploaded_file__isnull=True),
    ).delete()

    _sync_legacy_documents(employee)
    return EmployeeDocumentRequirement.objects.filter(
        employee=employee,
        document_type_id__in=snapshot_type_ids,
    ).select_related('document_type', 'verified_by').order_by(
        'document_type__name',
    )


def apply_direct_office_hire_verification(employee, reviewer=None) -> int:
    """
    Mark incomplete checklist items verified-at-office for walk-in direct hires.

    Direct office hire (manual create without portal onboarding) only auto-verifies
    at create time; this re-applies the same treatment when new DocumentTypes appear
    via sync. Skips onboarding-status refresh to avoid sync↔refresh recursion.
    """
    from apps.hr.manual_employee import get_direct_office_hire_context
    from apps.hr.models import EmployeeDocumentRequirement

    if not get_direct_office_hire_context(employee).get('is_direct_office_hire'):
        return 0

    notes = 'Direct hire — documents collected and verified in office.'
    updated = 0
    requirements = EmployeeDocumentRequirement.objects.filter(
        employee=employee,
    ).select_related('document_type')
    for req in requirements:
        if is_requirement_complete(req):
            continue
        mode = req.document_type.verification_mode
        if mode in {'physical', 'hybrid'}:
            mark_requirement_physically_verified(
                requirement=req,
                reviewer=reviewer,
                notes=notes,
                refresh_status=False,
            )
            updated += 1
        elif mode == 'upload':
            approve_requirement_override(
                requirement=req,
                reviewer=reviewer,
                notes=notes,
                refresh_status=False,
            )
            updated += 1
    return updated


def sync_employee_requirements(employee, *, reviewer=None):
    from django.db.models import Q
    from apps.hr.models import DocumentType, EmployeeDocumentRequirement

    _repair_inconsistent_upload_requirements(employee)

    snapshot_qs = _sync_employee_from_application_snapshot(employee)
    if snapshot_qs is not None:
        apply_direct_office_hire_verification(employee, reviewer=reviewer)
        return EmployeeDocumentRequirement.objects.filter(
            employee=employee,
            document_type_id__in={row.document_type_id for row in snapshot_qs},
        ).select_related('document_type', 'verified_by').order_by(
            'document_type__name',
        )

    _seed_default_document_types_for_employee(employee)

    selected_types = _select_document_types_for_employee(employee)
    selected_type_ids = {document_type.id for document_type in selected_types}

    for document_type in selected_types:
        EmployeeDocumentRequirement.objects.get_or_create(
            employee=employee,
            document_type=document_type,
            defaults={'mandatory': document_type.mandatory, 'status': 'pending'},
        )

    EmployeeDocumentRequirement.objects.filter(employee=employee).exclude(
        document_type_id__in=selected_type_ids,
    ).filter(status='pending').filter(
        Q(uploaded_file='') | Q(uploaded_file__isnull=True),
    ).delete()

    _dedupe_employee_requirements(employee)
    _sync_legacy_documents(employee)
    apply_direct_office_hire_verification(employee, reviewer=reviewer)
    return EmployeeDocumentRequirement.objects.filter(employee=employee).select_related('document_type', 'verified_by')


def _sync_legacy_documents(employee):
    """One-way sync from legacy EmployeeDocument into dynamic requirements."""
    from apps.hr.models import EmployeeDocument, EmployeeDocumentRequirement

    requirements = {
        normalize_document_type(req.document_type.name): req
        for req in EmployeeDocumentRequirement.objects.filter(employee=employee).select_related('document_type')
    }
    for legacy in EmployeeDocument.objects.filter(employee=employee):
        key = normalize_document_type(legacy.document_type)
        req = requirements.get(key)
        if not req:
            continue
        changed = False
        if legacy.file and not req.uploaded_file:
            req.uploaded_file = legacy.file
            req.uploaded_at = legacy.uploaded_at
            changed = True
        if legacy.status == 'verified' and req.status != 'verified':
            req.status = 'verified'
            req.verified_at = legacy.verified_at
            req.verified_by = legacy.verified_by
            req.verification_notes = legacy.rejection_reason or ''
            changed = True
        elif legacy.status in {'rejected', 'reupload_requested'}:
            req.status = legacy.status
            req.rejection_reason = legacy.rejection_reason
            req.verified_by = legacy.verified_by
            changed = True
        elif legacy.status in {'pending', 'uploaded'} and req.status == 'pending' and req.uploaded_file:
            req.status = 'uploaded'
            changed = True
        if changed:
            req.save()


def _requirement_has_upload(req) -> bool:
    return bool(req.uploaded_file)


def is_requirement_complete(req) -> bool:
    mode = req.document_type.verification_mode
    if req.override_approved:
        return True
    if mode == 'upload':
        return req.status == 'verified' and _requirement_has_upload(req)
    if mode == 'physical':
        return req.physically_verified or req.status == 'physically_verified'
    # hybrid
    return _requirement_has_upload(req) and req.physically_verified and req.status == 'verified'


def _repair_inconsistent_upload_requirements(employee) -> None:
    """Reset upload-only rows wrongly marked verified without a file (legacy manual-hire bug)."""
    from django.db.models import Q
    from apps.hr.models import EmployeeDocumentRequirement

    broken = EmployeeDocumentRequirement.objects.filter(
        employee=employee,
        document_type__verification_mode='upload',
        status__in={'verified', 'physically_verified'},
        override_approved=False,
    ).filter(
        Q(uploaded_file='') | Q(uploaded_file__isnull=True),
    )
    if not broken.exists():
        return
    broken.update(
        status='pending',
        physically_verified=False,
        verified_at=None,
        verified_by_id=None,
        verification_notes='',
    )


def calculate_onboarding_progress(employee) -> dict:
    requirements = list(sync_employee_requirements(employee))
    mandatory_requirements = [req for req in requirements if req.mandatory]
    completed = [req for req in mandatory_requirements if is_requirement_complete(req)]
    uploaded = [req for req in mandatory_requirements if _requirement_has_upload(req)]
    pending = [req for req in mandatory_requirements if not is_requirement_complete(req)]

    total_required = len(mandatory_requirements)
    completed_count = len(completed)
    progress_percentage = round((completed_count / total_required) * 100, 1) if total_required else 100.0

    return {
        'total_required': total_required,
        'uploaded_count': len(uploaded),
        'verified_count': completed_count,
        'progress_percentage': progress_percentage,
        'all_mandatory_verified': completed_count == total_required,
        'missing_types': [req.document_type.name for req in pending],
    }


def refresh_employee_onboarding_status(employee) -> str:
    progress = calculate_onboarding_progress(employee)
    if progress['all_mandatory_verified']:
        employee.onboarding_status = 'ready_to_join'
    elif progress['verified_count'] > 0:
        employee.onboarding_status = 'under_review'
    elif progress['uploaded_count'] > 0:
        employee.onboarding_status = 'documents_uploaded'
    else:
        employee.onboarding_status = 'pending_documents'
    employee.save(update_fields=['onboarding_status', 'updated_at'])
    return employee.onboarding_status


def log_document_audit(*, document=None, requirement=None, employee, action, performed_by, notes='', metadata=None):
    from apps.hr.models import EmployeeDocumentAuditLog

    audit_metadata = {
        'status': requirement.status if requirement else (document.status if document else None),
        'document_type': requirement.document_type.name if requirement else (document.document_type if document else None),
    }
    if metadata:
        audit_metadata.update(metadata)
    return EmployeeDocumentAuditLog.objects.create(
        document=document,
        requirement=requirement,
        employee=employee,
        action=action,
        performed_by=performed_by,
        notes=notes or '',
        metadata=audit_metadata,
    )


def find_employee_requirement(employee, document_type):
    normalized = normalize_document_type(document_type)
    for requirement in sync_employee_requirements(employee):
        if normalize_document_type(requirement.document_type.name) == normalized:
            return requirement
    return None


def find_employee_document(employee, document_type):
    """Backward compatibility alias used by existing views."""
    return find_employee_requirement(employee, document_type)


def document_allows_candidate_replace(requirement) -> bool:
    """True when candidate may upload a new file (first upload, correction, or HR re-upload)."""
    if requirement is None or requirement.override_approved:
        return False
    mode = requirement.document_type.verification_mode
    if mode == 'physical':
        return False
    if mode == 'upload':
        if requirement.status == 'verified' and _requirement_has_upload(requirement):
            return False
        if requirement.status == 'verified' and not _requirement_has_upload(requirement):
            return True
        return requirement.status in {'pending', 'uploaded', 'reupload_requested', 'rejected'}
    # hybrid — allow replace until fully verified (upload + physical when applicable)
    if requirement.status == 'verified' and requirement.physically_verified and _requirement_has_upload(requirement):
        return False
    if requirement.status == 'physically_verified' and not _requirement_has_upload(requirement):
        return False
    return requirement.status in {'pending', 'uploaded', 'reupload_requested', 'rejected'}


def document_requires_candidate_upload(requirement) -> bool:
    """True when a new upload is still required (missing file or HR requested re-upload)."""
    if requirement is None:
        return True
    if not document_allows_candidate_replace(requirement):
        return False
    mode = requirement.document_type.verification_mode
    if mode == 'upload':
        return not _requirement_has_upload(requirement) or requirement.status in {'reupload_requested', 'rejected'}
    # hybrid
    if requirement.status in {'reupload_requested', 'rejected'}:
        return True
    return not _requirement_has_upload(requirement)


EMPLOYEE_PORTAL_DOCUMENTS_BASE = '/api/v1/employee-portal/documents'


def save_requirement_upload(employee, requirement, file) -> None:
    """
    Validate and persist a document upload for an employee requirement.
    Raises ValueError with a user-facing message when upload is not allowed.
    """
    from datetime import datetime
    import uuid

    from django.core.files.storage import default_storage

    from apps.hr.document_verification import archive_requirement_upload, validate_candidate_upload
    if requirement.employee_id != employee.id:
        raise ValueError('You can only upload documents for your own profile.')

    if requirement.document_type.verification_mode == 'physical':
        raise ValueError(
            'This checklist item requires physical verification and does not accept uploads.',
        )

    if not document_allows_candidate_replace(requirement):
        raise ValueError(
            'This document has already been approved by HR and cannot be replaced. '
            'Use Request update if you need HR to reopen it.',
        )

    validation = validate_candidate_upload(file, requirement=requirement)
    if not validation['valid']:
        raise ValueError(validation['error'])

    allowed_extensions = ['.pdf', '.jpg', '.jpeg', '.png']
    file_extension = os.path.splitext(file.name)[1].lower()
    if file_extension not in allowed_extensions:
        raise ValueError(f'Invalid file type. Allowed: {", ".join(allowed_extensions)}')

    if requirement.uploaded_file:
        archive_requirement_upload(requirement, reason='replaced')

    normalized_type = normalize_document_type(requirement.document_type.name)
    upload_dir = f'onboarding/{employee.id}/{normalized_type}'
    timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
    unique_id = str(uuid.uuid4())[:8]
    filename = f"{normalized_type}_{timestamp}_{unique_id}{file_extension}"
    file_path = f"{upload_dir}/{filename}"
    saved_path = default_storage.save(file_path, file)

    requirement.uploaded_file = saved_path
    requirement.uploaded_at = timezone.now()
    requirement.file_hash = validation['file_hash']
    requirement.verified_at = None
    requirement.verified_by = None
    requirement.rejection_reason = ''
    requirement.verification_notes = ''
    requirement.override_approved = False
    if requirement.document_type.verification_mode == 'hybrid' and requirement.physically_verified:
        requirement.status = 'verified'
    else:
        requirement.status = 'uploaded'
    requirement.save()
    employee.update_onboarding_status()
    logger.info(
        '[Documents] uploaded type=%s employee=%s requirement=%s',
        normalized_type,
        employee.employee_id,
        requirement.id,
    )


def record_employee_document_update_request(employee, requirement, *, user, reason: str = '') -> None:
    """Log an employee request to change a verified/locked document."""
    if requirement.employee_id != employee.id:
        raise ValueError('You can only request updates for your own documents.')
    note = (reason or 'Employee requested a document update via portal.').strip()
    log_document_audit(
        requirement=requirement,
        employee=employee,
        action='uploaded',
        performed_by=user,
        notes=note,
        metadata={'event': 'employee_update_request'},
    )


def build_candidate_onboarding_payload(
    employee,
    *,
    offer_token: str | None = None,
    employee_portal: bool = False,
) -> dict:
    from apps.hr.document_verification import (
        WORKFLOW_LABELS,
        build_progress_summary,
        file_is_previewable,
        get_previous_upload_snapshot,
        resolve_workflow_status,
    )

    requirements = list(sync_employee_requirements(employee))
    rows = []
    pending_resubmissions = []
    token_segment = str(offer_token) if offer_token else None

    for req in requirements:
        requires_upload = document_requires_candidate_upload(req)
        can_replace = document_allows_candidate_replace(req)
        if req.status in {'reupload_requested', 'rejected'} and requires_upload:
            pending_resubmissions.append(req.document_type.name)

        workflow_status = resolve_workflow_status(req)
        file_name = os.path.basename(req.uploaded_file.name) if req.uploaded_file else None
        previous_upload = get_previous_upload_snapshot(req) if workflow_status == 'REUPLOAD_REQUIRED' else None

        preview_url = None
        download_url = None
        if employee_portal and req.uploaded_file and req.id:
            preview_url = f'{EMPLOYEE_PORTAL_DOCUMENTS_BASE}/{req.id}/preview/'
            download_url = f'{EMPLOYEE_PORTAL_DOCUMENTS_BASE}/{req.id}/download/'
        elif token_segment and req.uploaded_file and req.id:
            preview_url = f'/api/onboarding/files/{token_segment}/{req.id}/preview/'
            download_url = f'/api/onboarding/files/{token_segment}/{req.id}/download/'
        if previous_upload and employee_portal:
            previous_upload = {
                **previous_upload,
                'preview_url': (
                    f'{EMPLOYEE_PORTAL_DOCUMENTS_BASE}/{req.id}/versions/'
                    f'{previous_upload["version_id"]}/preview/'
                ),
                'download_url': (
                    f'{EMPLOYEE_PORTAL_DOCUMENTS_BASE}/{req.id}/versions/'
                    f'{previous_upload["version_id"]}/download/'
                ),
            }
        elif previous_upload and token_segment:
            previous_upload = {
                **previous_upload,
                'preview_url': f'/api/onboarding/files/{token_segment}/{req.id}/versions/{previous_upload["version_id"]}/preview/',
                'download_url': f'/api/onboarding/files/{token_segment}/{req.id}/versions/{previous_upload["version_id"]}/download/',
            }

        rows.append({
            'id': str(req.id),
            'document_type': normalize_document_type(req.document_type.name),
            'document_label': req.document_type.name,
            'description': req.document_type.description,
            'mandatory': req.mandatory,
            'is_required': req.mandatory,
            'verification_mode': req.document_type.verification_mode,
            'status': req.status,
            'workflow_status': workflow_status,
            'workflow_status_label': WORKFLOW_LABELS.get(workflow_status, workflow_status),
            'status_display': req.get_status_display(),
            'requires_upload': requires_upload,
            'can_replace': can_replace,
            'physical_verification_pending': req.document_type.verification_mode in {'physical', 'hybrid'} and not req.physically_verified,
            'locked': workflow_status == 'VERIFIED' and req.document_type.verification_mode == 'upload',
            'file_url': req.uploaded_file.url if req.uploaded_file else None,
            'file_name': file_name,
            'file_size': req.uploaded_file.size if req.uploaded_file else None,
            'preview_url': preview_url,
            'download_url': download_url,
            'previewable': file_is_previewable(file_name),
            'uploaded_at': req.uploaded_at.isoformat() if req.uploaded_at else None,
            'verified_at': req.verified_at.isoformat() if req.verified_at else None,
            'rejection_reason': req.rejection_reason or None,
            'verification_notes': req.verification_notes or None,
            'previous_upload': previous_upload,
            'expired': bool(req.expires_at and req.expires_at <= timezone.now()),
        })

    resubmission_mode = bool(pending_resubmissions)
    missing_uploads = [
        row['document_type'] for row in rows
        if row['mandatory'] and row['verification_mode'] in {'upload', 'hybrid'} and row['requires_upload']
    ]
    can_submit = not missing_uploads
    if resubmission_mode:
        can_submit = not any(
            row['document_type'] in pending_resubmissions and row['requires_upload']
            for row in rows
        )

    progress = build_progress_summary(rows, verified_only=employee_portal)
    return {
        'documents': rows,
        'progress': progress,
        'resubmission_mode': resubmission_mode,
        'pending_resubmissions': pending_resubmissions,
        'missing_uploads': missing_uploads,
        'can_submit': can_submit,
    }


def candidate_may_access_onboarding_portal(offer) -> bool:
    """
    True if the candidate should see the upload UI and may call upload APIs.
    When onboarding_completed is True but HR opened a re-upload flow, still True.
    """
    if not getattr(offer, 'onboarding_completed', False):
        return True

    employee = get_employee_for_portal(offer)
    if not employee:
        return False
    payload = build_candidate_onboarding_payload(employee)
    if payload.get('resubmission_mode'):
        return True
    return any(bool(row.get('requires_upload')) for row in payload.get('documents', []))


def reopen_offer_onboarding_portal(employee) -> None:
    """Let the candidate use the same offer link again after HR requests a new upload."""
    offer = get_employee_offer(employee)
    if not offer:
        return
    offer.onboarding_completed = False
    offer.onboarding_token_expired = False
    offer.save(update_fields=['onboarding_completed', 'onboarding_token_expired', 'updated_at'])


def build_employee_document_review_payload(employee) -> dict:
    requirements = list(sync_employee_requirements(employee))
    progress = calculate_onboarding_progress(employee)

    rows = []
    from apps.hr.document_moderation import enrich_document_row_for_hr, is_application_rejected

    for req in requirements:
        review_status = req.status
        if not req.uploaded_file and req.status == 'pending':
            review_status = 'missing'
        file_name = os.path.basename(req.uploaded_file.name) if req.uploaded_file else None
        extension = file_name.rsplit('.', 1)[-1].lower() if file_name and '.' in file_name else ''
        preview_supported = extension in {'pdf', 'jpg', 'jpeg', 'png', 'webp'}
        from apps.hr.document_verification import WORKFLOW_LABELS, resolve_workflow_status

        workflow_status = resolve_workflow_status(req)
        moderation = enrich_document_row_for_hr(req, employee)
        hr_status_label = moderation.get('hr_status_label')
        verified_at_office = bool(
            not req.uploaded_file
            and (req.physically_verified or req.override_approved)
        )
        if verified_at_office:
            hr_status_label = 'Verified at office'
        rows.append({
            'id': str(req.id),
            'document_type': normalize_document_type(req.document_type.name),
            'document_label': req.document_type.name,
            'description': req.document_type.description,
            'mandatory': req.mandatory,
            'is_required': req.mandatory,
            'verification_mode': req.document_type.verification_mode,
            'status': review_status,
            'workflow_status': workflow_status,
            'workflow_status_label': WORKFLOW_LABELS.get(workflow_status, workflow_status),
            'status_display': req.get_status_display() if review_status != 'missing' else 'Not uploaded',
            'uploaded_at': req.uploaded_at.isoformat() if req.uploaded_at else None,
            'verified_at': req.verified_at.isoformat() if req.verified_at else None,
            'verified_by': reviewer_display_name(req.verified_by),
            'rejection_reason': req.rejection_reason or None,
            'verification_notes': req.verification_notes or None,
            'physically_verified': req.physically_verified,
            'file_name': file_name,
            'has_file': bool(req.uploaded_file),
            'preview_supported': preview_supported and bool(req.uploaded_file),
            'can_review': req.status not in {'verified'},
            'can_mark_physical': req.document_type.verification_mode in {'physical', 'hybrid'} and not req.physically_verified,
            'expired': bool(req.expires_at and req.expires_at <= timezone.now()),
            'override_approved': req.override_approved,
            **moderation,
            'verified_at_office': verified_at_office,
            'hr_status_label': hr_status_label,
        })

    from apps.hr.manual_employee import get_direct_office_hire_context

    return {
        'application_rejected': is_application_rejected(employee),
        'hire_context': get_direct_office_hire_context(employee),
        'employee': {
            'id': str(employee.id),
            'name': employee.name,
            'employee_id': employee.employee_id,
            'department': employee.department or 'Not Assigned',
            'joining_date': employee.joining_date.isoformat() if employee.joining_date else None,
            'status': employee.status,
            'status_display': employee.get_status_display(),
            'onboarding_status': employee.onboarding_status,
            'onboarding_status_display': employee.get_onboarding_status_display(),
            'onboarding_completed': bool(getattr(employee, 'onboarding_completed', False)),
            'email': employee.email,
        },
        'progress': progress,
        'documents': rows,
        'can_activate': progress['all_mandatory_verified'] and employee.status != 'active',
        'upload_url': get_onboarding_upload_url(employee),
    }


def approve_document(*, document, reviewer):
    req = document
    req.verified_by = reviewer
    req.verified_at = timezone.now()
    req.rejection_reason = ''
    if req.document_type.verification_mode == 'physical':
        req.physically_verified = True
        req.status = 'physically_verified'
    elif req.document_type.verification_mode == 'hybrid':
        req.status = 'verified' if req.physically_verified and _requirement_has_upload(req) else 'uploaded'
    else:
        req.status = 'verified'
    req.save()
    refresh_employee_onboarding_status(req.employee)
    log_document_audit(requirement=req, employee=req.employee, action='approved', performed_by=reviewer)
    logger.info(
        '[DOCS] approved requirement=%s employee=%s by=%s',
        req.id,
        req.employee_id,
        getattr(reviewer, 'id', None),
    )
    from apps.hr.employee_portal_notifications import notify_document_portal_event

    notify_document_portal_event(req, event='approved')
    return req


def reject_document(*, document, reviewer, reason: str):
    req = document
    req.status = 'rejected'
    req.verified_by = reviewer
    req.verified_at = timezone.now()
    req.rejection_reason = reason.strip()
    req.verification_notes = reason.strip()
    if req.document_type.verification_mode == 'hybrid':
        req.physically_verified = False
    req.save()
    refresh_employee_onboarding_status(req.employee)
    log_document_audit(
        requirement=req,
        employee=req.employee,
        action='rejected',
        performed_by=reviewer,
        notes=reason.strip(),
    )
    reopen_offer_onboarding_portal(req.employee)
    logger.info(
        '[DOCS] rejected requirement=%s employee=%s by=%s',
        req.id,
        req.employee_id,
        getattr(reviewer, 'id', None),
    )
    return req


def request_document_reupload(*, document, reviewer, reason: str):
    from apps.hr.document_verification import archive_requirement_upload
    from apps.hr.email_utils import send_document_reupload_email

    req = document
    archive_requirement_upload(req, reason='reupload_cleared')

    req.status = 'reupload_requested'
    req.file_hash = ''
    req.uploaded_file = None
    req.uploaded_at = None
    req.verified_at = None
    req.verified_by = reviewer
    req.rejection_reason = reason.strip()
    req.verification_notes = reason.strip()
    if req.document_type.verification_mode == 'hybrid':
        req.physically_verified = False
    req.save()
    refresh_employee_onboarding_status(req.employee)
    log_document_audit(
        requirement=req,
        employee=req.employee,
        action='reupload_requested',
        performed_by=reviewer,
        notes=reason.strip(),
    )
    reopen_offer_onboarding_portal(req.employee)
    send_document_reupload_email(req.employee, req, reason.strip())
    logger.info(
        '[DOCS] reupload_requested requirement=%s employee=%s by=%s',
        req.id,
        req.employee_id,
        getattr(reviewer, 'id', None),
    )
    from apps.hr.employee_portal_notifications import notify_document_portal_event

    notify_document_portal_event(req, event='reupload', reason=reason.strip())
    return req


def mark_requirement_physically_verified(*, requirement, reviewer, notes='', refresh_status=True):
    mode = requirement.document_type.verification_mode
    if mode == 'upload':
        # Upload-only items need a candidate file + HR approval, not physical verification.
        return requirement

    requirement.physically_verified = True
    requirement.verified_by = reviewer
    requirement.verified_at = timezone.now()
    if mode == 'physical':
        requirement.status = 'physically_verified'
    else:
        requirement.status = 'verified' if _requirement_has_upload(requirement) else 'pending'
    if notes:
        requirement.verification_notes = notes
    requirement.save()
    if refresh_status:
        refresh_employee_onboarding_status(requirement.employee)
    log_document_audit(
        requirement=requirement,
        employee=requirement.employee,
        action='physically_verified',
        performed_by=reviewer,
        notes=notes or 'Physical verification marked complete.',
    )
    return requirement


def approve_requirement_override(*, requirement, reviewer, notes='', refresh_status=True):
    requirement.override_approved = True
    requirement.status = 'verified'
    requirement.verified_by = reviewer
    requirement.verified_at = timezone.now()
    if notes:
        requirement.verification_notes = notes
    requirement.save()
    if refresh_status:
        refresh_employee_onboarding_status(requirement.employee)
    log_document_audit(
        requirement=requirement,
        employee=requirement.employee,
        action='override_approved',
        performed_by=reviewer,
        notes=notes or 'HR override approval applied.',
    )
    return requirement


def activate_employee_after_verification(*, employee, reviewer, override_missing_designation=False):
    from apps.hr.portal_provisioning import provision_employee_portal, validate_activation_documents
    from apps.hr.designation_utils import (
        apply_designation_from_hire_sources,
        link_employee_designation_from_job_title,
        validate_active_employee_designation,
    )
    from apps.hr.payroll_api.department_structure_service import ensure_employee_department_ref_linked

    employee.refresh_from_db()
    already_active = employee.status == 'active' and employee.onboarding_completed

    if not already_active:
        docs_ok, docs_message = validate_activation_documents(employee)
        if not docs_ok:
            return {'success': False, 'message': docs_message}

        ensure_employee_department_ref_linked(employee)
        offer = get_employee_offer(employee)
        apply_designation_from_hire_sources(employee, offer=offer)
        if not employee.designation_id:
            link_employee_designation_from_job_title(employee, save=True)

        designation_ok, designation_message, designation_code = validate_active_employee_designation(
            employee,
            override=override_missing_designation,
        )
        if not designation_ok:
            return {
                'success': False,
                'message': designation_message,
                'code': designation_code,
                'requires_override': designation_code in {'missing_designation', 'ambiguous_designation'},
            }

        now = timezone.now()
        employee.status = 'active'
        employee.onboarding_status = 'onboarded'
        employee.onboarding_completed = True
        employee.activated_at = now
        update_fields = [
            'status', 'onboarding_status', 'onboarding_completed', 'activated_at', 'updated_at',
        ]
        if not employee.joining_date_confirmed:
            employee.joining_date_confirmed = employee.joining_date or timezone.localdate()
            update_fields.append('joining_date_confirmed')
        if employee.department_ref_id:
            update_fields.extend(['department_ref_id', 'department'])
        if employee.designation_id:
            update_fields.extend(['designation_id', 'job_title'])
        employee.save(update_fields=update_fields)

        from apps.hr.payroll_api.compensation_level_service import ensure_employee_compensation_assigned

        ensure_employee_compensation_assigned(employee)

        if offer:
            offer.onboarding_completed = True
            offer.onboarding_completed_at = now
            offer.onboarding_token_expired = True
            offer.save(update_fields=[
                'onboarding_completed', 'onboarding_completed_at', 'onboarding_token_expired', 'updated_at',
            ])

        activation_notes = 'Employee activated after checklist completion.'
        activation_metadata = {'activated_at': now.isoformat()}
        if override_missing_designation and not employee.designation_id:
            activation_notes = (
                'Employee activated with HR override — designation FK not linked.'
            )
            activation_metadata['override_missing_designation'] = True

        log_document_audit(
            employee=employee,
            action='employee_activated',
            performed_by=reviewer,
            notes=activation_notes,
            metadata=activation_metadata,
        )
    else:
        logger.info(
            '[Activation] idempotent activate employee_id=%s — ensuring portal provisioned',
            employee.employee_id,
        )

    portal_result = provision_employee_portal(employee, reviewer=reviewer, source='activation')

    from django.db import transaction as db_transaction
    from apps.hr.biometric.hooks import on_employee_activated

    if not already_active:
        db_transaction.on_commit(lambda: on_employee_activated(employee))

    message = (
        'Employee is already active and onboarding is complete.'
        if already_active and portal_result.get('skipped')
        else 'Employee activated successfully.'
    )

    return {
        'success': True,
        'message': message,
        'employee_id': employee.employee_id,
        'status': employee.status,
        'onboarding_completed': employee.onboarding_completed,
        'idempotent': already_active,
        'portal_account_created': portal_result.get('portal_account_created', False),
        'portal_account_linked': portal_result.get('portal_account_linked', False),
        'portal_provisioned': portal_result.get('portal_provisioned', False),
        'welcome_email_sent': portal_result.get('welcome_email_sent', False),
        'activated_at': employee.activated_at.isoformat() if employee.activated_at else None,
    }
