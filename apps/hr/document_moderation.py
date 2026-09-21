"""HR document moderation workflow with history, undo, and bulk actions."""
from __future__ import annotations

import logging
from typing import Any

from django.db import transaction
from django.utils import timezone

logger = logging.getLogger(__name__)

HR_STATUS_PENDING = 'pending'
HR_STATUS_VERIFIED = 'verified'
HR_STATUS_REUPLOAD = 'reupload_required'
HR_STATUS_REJECTED = 'rejected'

HR_STATUS_LABELS = {
    HR_STATUS_PENDING: 'Pending',
    HR_STATUS_VERIFIED: 'Verified',
    HR_STATUS_REUPLOAD: 'Reupload Required',
    HR_STATUS_REJECTED: 'Rejected',
}


def _requirement_snapshot(requirement) -> dict:
    from apps.hr.onboarding_documents import _requirement_has_upload

    uploaded_file = ''
    if requirement.uploaded_file:
        uploaded_file = requirement.uploaded_file.name
    return {
        'status': requirement.status,
        'rejection_reason': requirement.rejection_reason or '',
        'verification_notes': requirement.verification_notes or '',
        'verified_by_id': str(requirement.verified_by_id) if requirement.verified_by_id else None,
        'verified_at': requirement.verified_at.isoformat() if requirement.verified_at else None,
        'physically_verified': requirement.physically_verified,
        'override_approved': requirement.override_approved,
        'uploaded_file': uploaded_file,
        'uploaded_at': requirement.uploaded_at.isoformat() if requirement.uploaded_at else None,
        'file_hash': requirement.file_hash or '',
        'has_upload': _requirement_has_upload(requirement),
    }


def _candidate_snapshot(candidate) -> dict | None:
    if not candidate:
        return None
    return {'status': candidate.status, 'offer_status': getattr(candidate, 'offer_status', '')}


def _offer_snapshot(employee) -> dict | None:
    from apps.hr.onboarding_documents import get_employee_offer

    offer = get_employee_offer(employee)
    if not offer:
        return None
    return {
        'onboarding_completed': bool(getattr(offer, 'onboarding_completed', False)),
        'onboarding_token_expired': bool(getattr(offer, 'onboarding_token_expired', False)),
    }


def get_linked_candidate(employee):
    return getattr(employee, 'candidate', None)


def is_application_rejected(employee) -> bool:
    candidate = get_linked_candidate(employee)
    return bool(candidate and candidate.status == 'rejected')


def exclude_rejected_applications(qs):
    """Drop employees tied to rejected recruitment applications. Manual hires (no candidate) stay."""
    return qs.exclude(candidate__status='rejected')


def resolve_hr_display_status(requirement) -> str:
    if requirement.status in {'verified', 'physically_verified'} or requirement.override_approved:
        return HR_STATUS_VERIFIED
    if requirement.status == 'reupload_requested':
        return HR_STATUS_REUPLOAD
    if requirement.status == 'rejected':
        return HR_STATUS_REJECTED
    return HR_STATUS_PENDING


def can_approve_document(requirement, employee) -> bool:
    from apps.hr.onboarding_documents import _requirement_has_upload

    if is_application_rejected(employee):
        return False
    if resolve_hr_display_status(requirement) == HR_STATUS_VERIFIED:
        return False
    if requirement.document_type.verification_mode in {'upload', 'hybrid'} and not _requirement_has_upload(requirement):
        return False
    return requirement.status in {'uploaded', 'pending'}


def can_reject_document(requirement, employee) -> bool:
    if is_application_rejected(employee):
        return False
    if resolve_hr_display_status(requirement) == HR_STATUS_VERIFIED:
        return False
    return True


def record_transition(
    *,
    requirement,
    employee,
    reviewer,
    action_type: str,
    previous_status: str,
    new_status: str,
    reason: str = '',
    email_sent: bool = False,
    candidate=None,
    previous_candidate_status: str = '',
    new_candidate_status: str = '',
    scope: str = 'document',
) -> 'DocumentStatusTransition':
    from apps.hr.models import DocumentStatusTransition

    return DocumentStatusTransition.objects.create(
        requirement=requirement,
        employee=employee,
        candidate=candidate or get_linked_candidate(employee),
        scope=scope,
        previous_status=previous_status,
        new_status=new_status,
        previous_candidate_status=previous_candidate_status or '',
        new_candidate_status=new_candidate_status or '',
        action_type=action_type,
        changed_by=reviewer,
        reason=reason or '',
        email_sent=email_sent,
        snapshot={
            'requirement': _requirement_snapshot(requirement) if requirement else None,
            'candidate': _candidate_snapshot(candidate or get_linked_candidate(employee)),
            'offer': _offer_snapshot(employee),
        },
    )


def get_latest_undoable_transition(requirement) -> 'DocumentStatusTransition | None':
    from apps.hr.models import DocumentStatusTransition

    if not requirement:
        return None
    return (
        DocumentStatusTransition.objects.filter(
            requirement=requirement,
            undone_at__isnull=True,
        )
        .exclude(action_type=DocumentStatusTransition.ACTION_UNDO)
        .order_by('-created_at')
        .first()
    )


@transaction.atomic
def moderate_approve(*, requirement, reviewer) -> dict[str, Any]:
    from apps.hr.models import DocumentStatusTransition
    from apps.hr.onboarding_documents import approve_document, log_document_audit

    employee = requirement.employee
    if not can_approve_document(requirement, employee):
        raise ValueError('This document cannot be approved in its current state.')

    prev = requirement.status
    transition = record_transition(
        requirement=requirement,
        employee=employee,
        reviewer=reviewer,
        action_type=DocumentStatusTransition.ACTION_APPROVE,
        previous_status=prev,
        new_status='verified',
        email_sent=False,
    )
    approve_document(document=requirement, reviewer=reviewer)
    requirement.refresh_from_db()
    transition.new_status = requirement.status
    transition.save(update_fields=['new_status', 'updated_at'])

    return {
        'requirement': requirement,
        'transition_id': str(transition.id),
        'undo_available': True,
    }


@transaction.atomic
def moderate_request_reupload(*, requirement, reviewer, reason: str) -> dict[str, Any]:
    from apps.hr.models import DocumentStatusTransition
    from apps.hr.onboarding_documents import request_document_reupload

    employee = requirement.employee
    if is_application_rejected(employee):
        raise ValueError('Application is rejected; re-upload cannot be requested.')
    if not str(reason).strip():
        raise ValueError('Reason is required for re-upload request.')

    prev = requirement.status
    transition = record_transition(
        requirement=requirement,
        employee=employee,
        reviewer=reviewer,
        action_type=DocumentStatusTransition.ACTION_REQUEST_REUPLOAD,
        previous_status=prev,
        new_status='reupload_requested',
        reason=reason.strip(),
        email_sent=True,
    )
    request_document_reupload(document=requirement, reviewer=reviewer, reason=reason.strip())
    requirement.refresh_from_db()

    return {
        'requirement': requirement,
        'transition_id': str(transition.id),
        'undo_available': True,
    }


@transaction.atomic
def moderate_final_reject(
    *,
    employee,
    reviewer,
    reason: str,
    requirement=None,
) -> dict[str, Any]:
    from apps.hr.models import DocumentStatusTransition
    from apps.hr.onboarding_documents import log_document_audit
    from apps.hr.recruitment_email_dispatcher import EmailEventDispatcher

    candidate = get_linked_candidate(employee)
    if not candidate:
        raise ValueError('No recruitment application linked to this employee.')
    if candidate.status == 'rejected':
        raise ValueError('Candidate is already rejected.')
    if not str(reason).strip():
        raise ValueError('Rejection reason is required.')

    prev_candidate = candidate.status
    prev_req = requirement.status if requirement else ''

    transition = record_transition(
        requirement=requirement,
        employee=employee,
        reviewer=reviewer,
        action_type=DocumentStatusTransition.ACTION_FINAL_REJECT,
        previous_status=prev_req,
        new_status='rejected' if requirement else '',
        reason=reason.strip(),
        email_sent=True,
        candidate=candidate,
        previous_candidate_status=prev_candidate,
        new_candidate_status='rejected',
        scope=DocumentStatusTransition.SCOPE_APPLICATION
        if not requirement
        else DocumentStatusTransition.SCOPE_DOCUMENT,
    )

    if requirement:
        requirement.status = 'rejected'
        requirement.rejection_reason = reason.strip()
        requirement.verified_by = reviewer
        requirement.verified_at = timezone.now()
        requirement.save()

    candidate.status = 'rejected'
    candidate.save(update_fields=['status', 'updated_at'])

    offer = getattr(employee, 'offer', None) or getattr(candidate, 'offer', None)
    if offer is None:
        from apps.hr.models import Offer

        offer = Offer.objects.filter(candidate=candidate).order_by('-created_at').first()
    if offer:
        offer.onboarding_token_expired = True
        offer.save(update_fields=['onboarding_token_expired', 'updated_at'])

    EmailEventDispatcher.rejected(
        candidate,
        rejection_from_status=prev_candidate,
        on_commit=False,
    )
    log_document_audit(
        requirement=requirement,
        employee=employee,
        action='final_reject',
        performed_by=reviewer,
        notes=reason.strip(),
    )

    return {
        'candidate': candidate,
        'transition_id': str(transition.id),
        'undo_available': True,
    }


def _restore_requirement_from_snapshot(requirement, snap: dict) -> None:
    from django.core.files.storage import default_storage

    requirement.status = snap.get('status', 'pending')
    requirement.rejection_reason = snap.get('rejection_reason', '')
    requirement.verification_notes = snap.get('verification_notes', '')
    requirement.physically_verified = snap.get('physically_verified', False)
    requirement.override_approved = snap.get('override_approved', False)
    requirement.file_hash = snap.get('file_hash', '')

    path = snap.get('uploaded_file') or ''
    if path and default_storage.exists(path):
        requirement.uploaded_file = path
    else:
        requirement.uploaded_file = None

    from django.utils.dateparse import parse_datetime

    uploaded_at = snap.get('uploaded_at')
    requirement.uploaded_at = parse_datetime(uploaded_at) if uploaded_at else None

    verified_at = snap.get('verified_at')
    requirement.verified_at = parse_datetime(verified_at) if verified_at else None

    vid = snap.get('verified_by_id')
    requirement.verified_by_id = vid if vid else None
    requirement.save()


@transaction.atomic
def undo_transition(*, transition_id, reviewer) -> dict[str, Any]:
    from apps.hr.models import DocumentStatusTransition
    from apps.hr.onboarding_documents import log_document_audit, refresh_employee_onboarding_status, reopen_offer_onboarding_portal

    transition = DocumentStatusTransition.objects.select_related(
        'requirement', 'employee', 'candidate'
    ).get(pk=transition_id)

    if not transition.is_undoable:
        raise ValueError('This action cannot be undone.')

    snap = transition.snapshot or {}
    requirement = transition.requirement
    employee = transition.employee
    candidate = transition.candidate or get_linked_candidate(employee)

    if snap.get('requirement') and requirement:
        _restore_requirement_from_snapshot(requirement, snap['requirement'])

    cand_snap = snap.get('candidate')
    if cand_snap and candidate:
        candidate.status = cand_snap.get('status', candidate.status)
        candidate.save(update_fields=['status', 'updated_at'])

    offer_snap = snap.get('offer')
    if offer_snap:
        from apps.hr.onboarding_documents import get_employee_offer

        offer = get_employee_offer(employee)
        if offer:
            offer.onboarding_completed = offer_snap.get('onboarding_completed', offer.onboarding_completed)
            offer.onboarding_token_expired = offer_snap.get('onboarding_token_expired', False)
            offer.save(update_fields=['onboarding_completed', 'onboarding_token_expired', 'updated_at'])
            if not offer.onboarding_token_expired:
                reopen_offer_onboarding_portal(employee)

    transition.undone_at = timezone.now()
    transition.undone_by = reviewer
    transition.save(update_fields=['undone_at', 'undone_by', 'updated_at'])

    DocumentStatusTransition.objects.create(
        requirement=requirement,
        employee=employee,
        candidate=candidate,
        scope=transition.scope,
        previous_status=transition.new_status,
        new_status=transition.previous_status,
        previous_candidate_status=transition.new_candidate_status,
        new_candidate_status=transition.previous_candidate_status,
        action_type=DocumentStatusTransition.ACTION_UNDO,
        changed_by=reviewer,
        reason=f'Undo of {transition.action_type}',
        email_sent=False,
        snapshot=snap,
    )

    refresh_employee_onboarding_status(employee)
    log_document_audit(
        requirement=requirement,
        employee=employee,
        action='undo',
        performed_by=reviewer,
        notes=f'Reverted {transition.action_type}',
    )

    return {'success': True, 'transition_id': str(transition.id)}


def bulk_moderate(
    *,
    document_ids: list,
    reviewer,
    action: str,
    reason: str = '',
    reject_mode: str | None = None,
) -> dict[str, Any]:
    from apps.hr.models import DocumentStatusTransition, EmployeeDocumentRequirement

    results = {'succeeded': [], 'failed': [], 'transitions': []}
    qs = EmployeeDocumentRequirement.objects.filter(pk__in=document_ids).select_related(
        'employee', 'document_type', 'employee__candidate'
    )
    by_id = {str(r.id): r for r in qs}

    for doc_id in document_ids:
        req = by_id.get(str(doc_id))
        if not req:
            results['failed'].append({'id': doc_id, 'error': 'Not found'})
            continue
        try:
            if action == 'approve':
                out = moderate_approve(requirement=req, reviewer=reviewer)
            elif action == 'request_reupload':
                out = moderate_request_reupload(requirement=req, reviewer=reviewer, reason=reason)
            elif action == 'final_reject':
                if reject_mode == 'application':
                    out = moderate_final_reject(employee=req.employee, reviewer=reviewer, reason=reason)
                    results['succeeded'].append(str(doc_id))
                    results['transitions'].append(out.get('transition_id'))
                    break
                out = moderate_final_reject(
                    employee=req.employee,
                    reviewer=reviewer,
                    reason=reason,
                    requirement=req,
                )
            else:
                raise ValueError(f'Unknown action: {action}')
            results['succeeded'].append(str(doc_id))
            results['transitions'].append(out.get('transition_id'))
        except Exception as exc:
            results['failed'].append({'id': str(doc_id), 'error': str(exc)})

    return results


def enrich_document_row_for_hr(req, employee) -> dict[str, Any]:
    from apps.hr.document_verification import resolve_workflow_status, WORKFLOW_LABELS
    from apps.hr.onboarding_documents import normalize_document_type

    hr_status = resolve_hr_display_status(req)
    undo = get_latest_undoable_transition(req)
    review_status = req.status
    if not req.uploaded_file and req.status == 'pending':
        review_status = 'missing'

    return {
        'hr_status': hr_status,
        'hr_status_label': HR_STATUS_LABELS.get(hr_status, hr_status),
        'can_approve': can_approve_document(req, employee),
        'can_reject': can_reject_document(req, employee),
        'can_preview': bool(req.uploaded_file),
        'undo_transition_id': str(undo.id) if undo else None,
        'workflow_status': resolve_workflow_status(req),
        'workflow_status_label': WORKFLOW_LABELS.get(resolve_workflow_status(req), ''),
    }
