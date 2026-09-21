"""Job-specific document requirements and immutable application snapshots."""
from __future__ import annotations

from typing import Any

from django.db import transaction
from django.utils import timezone

from apps.hr.models import (
    ApplicationDocumentRequirement,
    Candidate,
    JobDocumentRequirement,
    JobOpening,
)


def _normalize_requirement_payload(item: dict) -> dict | None:
    document_type_id = item.get('document_type') or item.get('document_type_id')
    if not document_type_id:
        return None
    return {
        'document_type_id': document_type_id,
        'is_required': bool(item.get('is_required', item.get('mandatory', True))),
        'allow_multiple': bool(item.get('allow_multiple', False)),
        'display_order': int(item.get('display_order', 0)),
    }


def save_job_document_requirements(job: JobOpening, requirements: list[dict] | None) -> list[JobDocumentRequirement]:
    """Replace job document checklist from HR job form payload."""
    if requirements is None:
        return list(job.document_requirements.select_related('document_type').order_by('display_order', 'document_type__name'))

    normalized = []
    for index, raw in enumerate(requirements):
        row = _normalize_requirement_payload(raw)
        if not row:
            continue
        row['display_order'] = row.get('display_order') or index
        normalized.append(row)

    type_ids = [row['document_type_id'] for row in normalized]
    with transaction.atomic():
        job.document_requirements.exclude(document_type_id__in=type_ids).delete()
        saved = []
        for row in normalized:
            obj, _ = JobDocumentRequirement.objects.update_or_create(
                job=job,
                document_type_id=row['document_type_id'],
                defaults={
                    'is_required': row['is_required'],
                    'allow_multiple': row['allow_multiple'],
                    'display_order': row['display_order'],
                },
            )
            saved.append(obj)
    return saved


def snapshot_application_document_requirements(application: Candidate) -> list[ApplicationDocumentRequirement]:
    """
    Copy the job's document checklist into the application (immutable after apply).
  """
    if application.document_requirements_snapshotted_at:
        return list(
            application.document_requirements.select_related('document_type').order_by(
                'display_order', 'document_type__name'
            )
        )

    job = application.job_opening
    job_requirements = list(
        job.document_requirements.select_related('document_type').order_by('display_order', 'document_type__name')
    )

    created: list[ApplicationDocumentRequirement] = []
    with transaction.atomic():
        for job_req in job_requirements:
            app_req, _ = ApplicationDocumentRequirement.objects.get_or_create(
                application=application,
                document_type=job_req.document_type,
                defaults={
                    'is_required': job_req.is_required,
                    'allow_multiple': job_req.allow_multiple,
                    'display_order': job_req.display_order,
                },
            )
            created.append(app_req)
        application.document_requirements_snapshotted_at = timezone.now()
        application.save(update_fields=['document_requirements_snapshotted_at', 'updated_at'])

    return created


def application_uses_job_document_snapshot(application: Candidate) -> bool:
    return bool(application.document_requirements_snapshotted_at)


def get_application_document_requirements(application: Candidate):
    return application.document_requirements.select_related('document_type').order_by(
        'display_order', 'document_type__name'
    )


def serialize_job_document_requirements(job: JobOpening) -> list[dict[str, Any]]:
    return [
        {
            'id': str(req.id),
            'document_type': str(req.document_type_id),
            'document_type_name': req.document_type.name,
            'document_type_description': req.document_type.description,
            'verification_mode': req.document_type.verification_mode,
            'is_required': req.is_required,
            'allow_multiple': req.allow_multiple,
            'display_order': req.display_order,
        }
        for req in job.document_requirements.select_related('document_type').order_by(
            'display_order', 'document_type__name'
        )
    ]
