"""
In-app employee portal notifications — create, sync, and mark read.
"""

from __future__ import annotations

import logging

from django.utils import timezone

logger = logging.getLogger(__name__)


def _dedupe_exists(*, employee, source: str, entity_id, event: str) -> bool:
    from apps.hr.models import EmployeePortalNotification

    return EmployeePortalNotification.objects.filter(
        employee=employee,
        metadata__source=source,
        metadata__entity_id=str(entity_id),
        metadata__event=event,
    ).exists()


def create_portal_notification(
    *,
    employee,
    category: str,
    title: str,
    message: str,
    metadata: dict | None = None,
    source: str | None = None,
    entity_id=None,
    event: str | None = None,
) -> object | None:
    from apps.hr.models import EmployeePortalNotification

    meta = dict(metadata or {})
    if source and entity_id is not None and event:
        meta.setdefault('source', source)
        meta.setdefault('entity_id', str(entity_id))
        meta.setdefault('event', event)
        if _dedupe_exists(employee=employee, source=source, entity_id=entity_id, event=event):
            return None

    notification = EmployeePortalNotification.objects.create(
        employee=employee,
        category=category,
        title=title,
        message=message,
        metadata=meta,
    )
    logger.info(
        '[PortalNotify] created employee=%s category=%s id=%s',
        getattr(employee, 'employee_id', employee.id),
        category,
        notification.id,
    )
    return notification


def notify_leave_portal_event(leave_request, *, event: str) -> None:
    from apps.hr.models import EmployeePortalNotification

    employee = leave_request.employee
    leave_name = leave_request.leave_type.name
    date_range = f'{leave_request.start_date} → {leave_request.end_date}'
    remarks = (leave_request.remarks or '').strip()

    if event == 'submitted':
        create_portal_notification(
            employee=employee,
            category=EmployeePortalNotification.CATEGORY_LEAVE_SUBMITTED,
            title='Leave request submitted',
            message=f'Your {leave_name} request ({date_range}) is pending HR review.',
            source='leave_request',
            entity_id=leave_request.id,
            event='submitted',
            metadata={'leave_request_id': str(leave_request.id)},
        )
        return

    if event == 'approved':
        create_portal_notification(
            employee=employee,
            category=EmployeePortalNotification.CATEGORY_LEAVE_APPROVED,
            title='Leave approved',
            message=(
                f'Your {leave_name} request ({date_range}) was approved.'
                + (f' HR remarks: {remarks}' if remarks else '')
            ),
            source='leave_request',
            entity_id=leave_request.id,
            event='approved',
            metadata={'leave_request_id': str(leave_request.id), 'remarks': remarks},
        )
        return

    if event == 'rejected':
        create_portal_notification(
            employee=employee,
            category=EmployeePortalNotification.CATEGORY_LEAVE_REJECTED,
            title='Leave rejected',
            message=(
                f'Your {leave_name} request ({date_range}) was rejected.'
                + (f' HR remarks: {remarks}' if remarks else '')
            ),
            source='leave_request',
            entity_id=leave_request.id,
            event='rejected',
            metadata={'leave_request_id': str(leave_request.id), 'remarks': remarks},
        )


def notify_regularization_portal_event(regularization, *, event: str) -> None:
    from apps.hr.models import AttendanceRegularization, EmployeePortalNotification

    employee = regularization.employee
    att_date = None
    if regularization.attendance_id and regularization.attendance:
        att_date = regularization.attendance.date
    elif regularization.requested_check_in:
        att_date = timezone.localdate(regularization.requested_check_in)
    elif regularization.requested_check_out:
        att_date = timezone.localdate(regularization.requested_check_out)
    else:
        att_date = timezone.localdate(regularization.created_at)

    remarks = (regularization.reviewer_remarks or '').strip()
    date_label = att_date.isoformat() if att_date else '—'

    if event == 'submitted':
        create_portal_notification(
            employee=employee,
            category=EmployeePortalNotification.CATEGORY_REGULARIZATION_SUBMITTED,
            title='Attendance correction submitted',
            message=f'Your correction request for {date_label} is pending HR review.',
            source='regularization',
            entity_id=regularization.id,
            event='submitted',
            metadata={'regularization_id': str(regularization.id), 'date': date_label},
        )
        return

    if event == 'approved':
        create_portal_notification(
            employee=employee,
            category=EmployeePortalNotification.CATEGORY_REGULARIZATION_APPROVED,
            title='Attendance correction approved',
            message=(
                f'Your correction for {date_label} was approved.'
                + (f' HR remarks: {remarks}' if remarks else '')
            ),
            source='regularization',
            entity_id=regularization.id,
            event='approved',
            metadata={'regularization_id': str(regularization.id), 'remarks': remarks},
        )
        return

    if event == 'rejected':
        create_portal_notification(
            employee=employee,
            category=EmployeePortalNotification.CATEGORY_REGULARIZATION_REJECTED,
            title='Attendance correction rejected',
            message=(
                f'Your correction for {date_label} was rejected.'
                + (f' HR remarks: {remarks}' if remarks else '')
            ),
            source='regularization',
            entity_id=regularization.id,
            event='rejected',
            metadata={'regularization_id': str(regularization.id), 'remarks': remarks},
        )


def notify_document_portal_event(requirement, *, event: str, reason: str = '') -> None:
    from apps.hr.models import EmployeePortalNotification

    employee = requirement.employee
    doc_name = requirement.document_type.name

    if event == 'approved':
        create_portal_notification(
            employee=employee,
            category=EmployeePortalNotification.CATEGORY_DOCUMENT_APPROVED,
            title='Document approved',
            message=f'"{doc_name}" has been approved by HR.',
            source='document_requirement',
            entity_id=requirement.id,
            event='approved',
            metadata={'requirement_id': str(requirement.id)},
        )
        return

    if event == 'reupload':
        create_portal_notification(
            employee=employee,
            category=EmployeePortalNotification.CATEGORY_DOCUMENT_REUPLOAD,
            title='Document re-upload requested',
            message=(
                f'HR requested a new upload for "{doc_name}".'
                + (f' Reason: {reason.strip()}' if reason.strip() else '')
            ),
            source='document_requirement',
            entity_id=requirement.id,
            event='reupload',
            metadata={'requirement_id': str(requirement.id), 'reason': reason.strip()},
        )


def notify_portal_activation(employee) -> None:
    from apps.hr.models import EmployeePortalNotification

    create_portal_notification(
        employee=employee,
        category=EmployeePortalNotification.CATEGORY_PORTAL_ACTIVATION,
        title='Employee portal activated',
        message='Your employee self-service portal account is active. You can apply leave, view attendance, and manage documents.',
        source='employee',
        entity_id=employee.id,
        event='portal_activation',
    )


def notify_offer_accepted(employee) -> None:
    from apps.hr.models import EmployeePortalNotification

    create_portal_notification(
        employee=employee,
        category=EmployeePortalNotification.CATEGORY_OFFER_ACCEPTED,
        title='Offer accepted',
        message='Welcome aboard! Your offer has been accepted and your employee record is active.',
        source='employee',
        entity_id=employee.id,
        event='offer_accepted',
    )


def notify_payslip_published(payroll_run) -> None:
    """In-app alert when HR publishes a payslip to the employee portal."""
    from apps.hr.models import EmployeePortalNotification

    employee = payroll_run.employee
    month = payroll_run.month or ''
    payslip = getattr(payroll_run, 'payslip', None)
    try:
        if payslip is None:
            payslip = payroll_run.payslip
    except Exception:
        payslip = None

    net = payroll_run.final_salary
    message = f'Your payslip for {month} is available.'
    if net is not None:
        message = f'Your payslip for {month} is available (net pay ₹{net}).'

    create_portal_notification(
        employee=employee,
        category=EmployeePortalNotification.CATEGORY_PAYROLL,
        title='Payslip published',
        message=message,
        source='payroll_run',
        entity_id=payroll_run.id,
        event='published',
        metadata={
            'payroll_run_id': str(payroll_run.id),
            'payslip_id': str(payslip.id) if payslip else None,
            'month': month,
        },
    )


def sync_portal_notifications(employee) -> None:
    """Idempotently backfill notifications from HR records (dedupe via metadata)."""
    from apps.hr.models import (
        AttendanceRegularization,
        EmployeeDocumentRequirement,
        LeaveRequest,
    )

    for leave in LeaveRequest.objects.filter(employee=employee).select_related('leave_type'):
        if leave.status == LeaveRequest.STATUS_APPROVED and leave.reviewed_on:
            notify_leave_portal_event(leave, event='approved')
        elif leave.status == LeaveRequest.STATUS_REJECTED:
            notify_leave_portal_event(leave, event='rejected')
        elif leave.status == LeaveRequest.STATUS_PENDING:
            notify_leave_portal_event(leave, event='submitted')

    for reg in AttendanceRegularization.objects.filter(employee=employee):
        if reg.status == 'approved':
            notify_regularization_portal_event(reg, event='approved')
        elif reg.status == 'rejected':
            notify_regularization_portal_event(reg, event='rejected')
        elif reg.status == 'pending':
            notify_regularization_portal_event(reg, event='submitted')

    for req in EmployeeDocumentRequirement.objects.filter(employee=employee).select_related('document_type'):
        if req.status in {'verified', 'physically_verified'}:
            notify_document_portal_event(req, event='approved')
        elif req.status in {'reupload_requested', 'rejected'}:
            notify_document_portal_event(req, event='reupload', reason=req.rejection_reason or '')

    if employee.activated_at:
        notify_portal_activation(employee)

    if getattr(employee, 'candidate_id', None) or getattr(employee, 'offer_id', None):
        notify_offer_accepted(employee)
