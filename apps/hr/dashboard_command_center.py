"""Aggregate counts for HR Command Center dashboard — mirrors source-page queries."""
from __future__ import annotations

from datetime import date, timedelta

from django.db import models
from django.utils import timezone

from apps.hr.attendance_analytics import build_dashboard_summary
from apps.hr.models import (
    AttendanceRegularization,
    Candidate,
    Employee,
    EmployeeDocumentRequirement,
    JobOpening,
    LeaveRequest,
    Offer,
    RecruitmentEmailEvent,
)
from apps.hr.payroll_models import PayrollRun


def _hospital_id_for_user(user):
    return getattr(user, 'hospital_id', None)


def _employee_qs(hospital_id):
    qs = Employee.objects.all()
    if hospital_id:
        qs = qs.filter(hospital_id=hospital_id)
    return qs


def _offer_qs(hospital_id):
    qs = Offer.objects.all()
    if hospital_id:
        qs = qs.filter(job__hospital_id=hospital_id)
    return qs


def _document_requirement_qs(hospital_id):
    qs = EmployeeDocumentRequirement.objects.all()
    if hospital_id:
        qs = qs.filter(employee__hospital_id=hospital_id)
    return qs


def compute_command_center_counts(*, user, month: str, today: date | None = None) -> dict:
    from apps.hr.document_moderation import exclude_rejected_applications

    today = today or timezone.localdate()
    hospital_id = _hospital_id_for_user(user)
    week_ahead = today + timedelta(days=7)
    offer_expiry_end = today + timedelta(days=7)

    onboarding_qs = exclude_rejected_applications(
        _employee_qs(hospital_id).filter(status='pending_onboarding'),
    )
    onboarding_ids = list(onboarding_qs.values_list('id', flat=True))
    doc_qs = _document_requirement_qs(hospital_id)
    if onboarding_ids:
        onboarding_doc_qs = doc_qs.filter(employee_id__in=onboarding_ids)
    else:
        onboarding_doc_qs = doc_qs.none()

    documents_to_review = onboarding_doc_qs.filter(status='uploaded').count()
    reupload_requests = onboarding_doc_qs.filter(status='reupload_requested').count()
    awaiting_review = onboarding_qs.filter(
        onboarding_status__in=['documents_uploaded', 'under_review', 'partial_documents'],
    ).count()
    ready_to_join = onboarding_qs.filter(onboarding_status='ready_to_join').count()

    leave_pending = LeaveRequest.objects.filter(status=LeaveRequest.STATUS_PENDING)
    if hospital_id:
        leave_pending = leave_pending.filter(employee__hospital_id=hospital_id)

    regularization_pending = AttendanceRegularization.objects.filter(status='pending')
    if hospital_id:
        regularization_pending = regularization_pending.filter(employee__hospital_id=hospital_id)

    offers_qs = _offer_qs(hospital_id)
    offers_awaiting_response = offers_qs.filter(status='sent').count()
    offers_expiring_soon = offers_qs.filter(
        status='sent',
        offer_expiry_date__gte=today,
        offer_expiry_date__lte=offer_expiry_end,
    ).count()
    offers_unsent = offers_qs.filter(status__in=['draft', 'created']).count()

    active_qs = _employee_qs(hospital_id).filter(status='active')
    missing_designation = active_qs.filter(designation__isnull=True).count()
    missing_department = active_qs.filter(department_ref__isnull=True).count()

    delayed_joiners = exclude_rejected_applications(
        _employee_qs(hospital_id).filter(
            status='pending_onboarding',
            joining_date__lt=today,
            joining_date__isnull=False,
        ),
    ).exclude(onboarding_status='onboarded').count()

    joining_this_week = _employee_qs(hospital_id).filter(
        joining_date__gte=today,
        joining_date__lte=week_ahead,
    ).exclude(status='terminated').exclude(
        models.Q(status='active')
        & (models.Q(onboarding_status='onboarded') | models.Q(onboarding_completed=True)),
    ).count()

    now = timezone.now()
    expired_documents = _document_requirement_qs(hospital_id).filter(
        expires_at__isnull=False,
        expires_at__lte=now,
    ).exclude(status__in=['verified', 'physically_verified']).count()

    expiring_documents = _document_requirement_qs(hospital_id).filter(
        expires_at__isnull=False,
        expires_at__gt=now,
        expires_at__lte=now + timedelta(days=30),
    ).count()

    payroll_locked = PayrollRun.objects.filter(status=PayrollRun.STATUS_LOCKED, month=month)
    if hospital_id:
        payroll_locked = payroll_locked.filter(employee__hospital_id=hospital_id)

    email_failures = RecruitmentEmailEvent.objects.filter(email_status=RecruitmentEmailEvent.STATUS_FAILED)
    if hospital_id:
        email_failures = email_failures.filter(
            models.Q(candidate__job_opening__hospital_id=hospital_id)
            | models.Q(candidate__profile__hospital_id=hospital_id),
        )

    jobs_qs = JobOpening.objects.filter(is_archived=False)
    if hospital_id:
        jobs_qs = jobs_qs.filter(hospital_id=hospital_id)
    draft_jobs = jobs_qs.filter(status='draft').count()

    attendance = build_dashboard_summary(today, hospital_id=hospital_id, force_rebuild=False)

    accepted_without_employee = 0
    candidate_qs = Candidate.objects.select_related('job_opening')
    if hospital_id:
        candidate_qs = candidate_qs.filter(job_opening__hospital_id=hospital_id)
    linked = set(
        _employee_qs(hospital_id).exclude(candidate__isnull=True).values_list('candidate_id', flat=True),
    )
    accepted_without_employee = candidate_qs.filter(
        models.Q(status='hired') | models.Q(offer_status='accepted'),
    ).exclude(id__in=linked).count()

    return {
        'document_reviews': documents_to_review + reupload_requests,
        'documents_to_review': documents_to_review,
        'reupload_requests': reupload_requests,
        'leave_requests': leave_pending.count(),
        'regularizations': regularization_pending.count(),
        'onboarding_reviews': awaiting_review + ready_to_join,
        'awaiting_review': awaiting_review,
        'ready_to_join': ready_to_join,
        'offers_unsent': offers_unsent,
        'offers_awaiting_response': offers_awaiting_response,
        'offers_expiring_soon': offers_expiring_soon,
        'accepted_without_employee': accepted_without_employee,
        'delayed_joiners': delayed_joiners,
        'expired_documents': expired_documents,
        'expiring_documents': expiring_documents,
        'payroll_locked': payroll_locked.count(),
        'email_failures': email_failures.count(),
        'missing_designation': missing_designation,
        'missing_department': missing_department,
        'draft_jobs': draft_jobs,
        'absent_today': attendance.get('absent_today', 0),
        'late_today': attendance.get('late_employees', 0),
        'needs_attention': attendance.get('needs_attention', 0),
        'on_leave_today': attendance.get('on_leave_today', 0),
        'joining_this_week': joining_this_week,
        'month': month,
        'date': today.isoformat(),
    }
