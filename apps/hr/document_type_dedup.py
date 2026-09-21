"""
Deduplicate DocumentType rows (legacy hospital=NULL vs hospital-scoped copies).
"""
from __future__ import annotations

from django.db import transaction

from apps.hr.models import (
    ApplicationDocumentRequirement,
    DocumentType,
    EmployeeDocumentRequirement,
    JobDocumentRequirement,
)
from apps.hr.onboarding_documents import normalize_document_type


def document_type_dedupe_key(document_type: DocumentType) -> str:
    return normalize_document_type(document_type.name) or (document_type.name or '').strip().lower()


def _pick_canonical(rows: list[DocumentType]) -> DocumentType:
    """Prefer hospital-scoped, active, then newest."""

    def score(dt: DocumentType) -> tuple:
        return (
            1 if dt.hospital_id else 0,
            1 if dt.is_active else 0,
            dt.updated_at or dt.created_at,
        )

    return max(rows, key=score)


def _repoint_job_requirements(from_type: DocumentType, to_type: DocumentType) -> int:
    moved = 0
    for row in JobDocumentRequirement.objects.filter(document_type=from_type):
        if JobDocumentRequirement.objects.filter(job=row.job, document_type=to_type).exists():
            row.delete()
        else:
            row.document_type = to_type
            row.save(update_fields=['document_type', 'updated_at'])
            moved += 1
    return moved


def _repoint_employee_requirements(from_type: DocumentType, to_type: DocumentType) -> int:
    moved = 0
    for row in EmployeeDocumentRequirement.objects.filter(document_type=from_type):
        if EmployeeDocumentRequirement.objects.filter(
            employee=row.employee,
            document_type=to_type,
        ).exists():
            row.delete()
        else:
            row.document_type = to_type
            row.save(update_fields=['document_type', 'updated_at'])
            moved += 1
    return moved


def _repoint_application_requirements(from_type: DocumentType, to_type: DocumentType) -> int:
    moved = 0
    for row in ApplicationDocumentRequirement.objects.filter(document_type=from_type):
        if ApplicationDocumentRequirement.objects.filter(
            application=row.application,
            document_type=to_type,
        ).exists():
            row.delete()
        else:
            row.document_type = to_type
            row.save(update_fields=['document_type', 'updated_at'])
            moved += 1
    return moved


def _repoint_all_fks(from_type: DocumentType, to_type: DocumentType) -> int:
    return (
        _repoint_job_requirements(from_type, to_type)
        + _repoint_employee_requirements(from_type, to_type)
        + _repoint_application_requirements(from_type, to_type)
    )


def dedupe_document_types(*, dry_run: bool = False) -> dict:
    """
    Merge duplicate document types that share the same name (case-insensitive).
    Keeps the best hospital-scoped row; removes legacy hospital=NULL copies when safe.
    """
    stats = {'groups': 0, 'deleted': 0, 'repointed': 0, 'kept': 0}

    by_name: dict[str, list[DocumentType]] = {}
    for dt in DocumentType.objects.all().order_by('name'):
        key = document_type_dedupe_key(dt)
        by_name.setdefault(key, []).append(dt)

    with transaction.atomic():
        for _name, rows in by_name.items():
            if len(rows) < 2:
                continue
            stats['groups'] += 1
            canonical = _pick_canonical(rows)
            stats['kept'] += 1
            for duplicate in rows:
                if duplicate.id == canonical.id:
                    continue
                if dry_run:
                    stats['deleted'] += 1
                    continue
                stats['repointed'] += _repoint_all_fks(duplicate, canonical)
                duplicate.delete()
                stats['deleted'] += 1

    return stats


def dedupe_queryset_for_list(qs):
    """Return one DocumentType per normalized name (prefer hospital-scoped)."""
    rows = list(qs)
    if not rows:
        return qs.none()
    chosen: dict[str, DocumentType] = {}
    for dt in rows:
        key = document_type_dedupe_key(dt)
        existing = chosen.get(key)
        if existing is None:
            chosen[key] = dt
        elif _pick_canonical([existing, dt]).id == dt.id:
            chosen[key] = dt
    return DocumentType.objects.filter(id__in=[dt.id for dt in chosen.values()]).order_by('name')
