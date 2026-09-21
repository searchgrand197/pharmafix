"""Document verification workflow helpers for candidate onboarding."""
from __future__ import annotations

import hashlib
import os
from typing import Any

from django.core.files.uploadedfile import UploadedFile
from django.utils import timezone

WORKFLOW_NOT_UPLOADED = 'NOT_UPLOADED'
WORKFLOW_UPLOADED = 'UPLOADED'
WORKFLOW_VERIFIED = 'VERIFIED'
WORKFLOW_REUPLOAD_REQUIRED = 'REUPLOAD_REQUIRED'

WORKFLOW_LABELS = {
    WORKFLOW_NOT_UPLOADED: 'Not uploaded',
    WORKFLOW_UPLOADED: 'Uploaded — pending verification',
    WORKFLOW_VERIFIED: 'Verified by HR',
    WORKFLOW_REUPLOAD_REQUIRED: 'Re-upload required',
}

ALLOWED_EXTENSIONS = {'.pdf', '.jpg', '.jpeg', '.png'}
ALLOWED_CONTENT_TYPES = {
    'application/pdf',
    'image/jpeg',
    'image/jpg',
    'image/png',
}
MAX_UPLOAD_BYTES = 5 * 1024 * 1024

MAGIC_SIGNATURES = (
    (b'%PDF', '.pdf'),
    (b'\xff\xd8\xff', '.jpg'),
    (b'\x89PNG\r\n\x1a\n', '.png'),
)


def compute_file_sha256(file_obj) -> str:
    hasher = hashlib.sha256()
    if hasattr(file_obj, 'chunks'):
        for chunk in file_obj.chunks():
            hasher.update(chunk)
    else:
        hasher.update(file_obj.read())
    if hasattr(file_obj, 'seek'):
        file_obj.seek(0)
    return hasher.hexdigest()


def _detect_extension_from_magic(header: bytes) -> str | None:
    for signature, ext in MAGIC_SIGNATURES:
        if header.startswith(signature):
            return ext
    return None


def validate_candidate_upload(file: UploadedFile, *, requirement=None) -> dict[str, Any]:
    """Validate type, size, integrity, and duplicate content."""
    name = getattr(file, 'name', '') or 'upload'
    extension = os.path.splitext(name)[1].lower()
    if extension not in ALLOWED_EXTENSIONS:
        return {
            'valid': False,
            'error': 'Invalid file type. Allowed formats: PDF, JPG, PNG.',
        }

    content_type = (getattr(file, 'content_type', '') or '').lower()
    if content_type and content_type not in ALLOWED_CONTENT_TYPES:
        return {
            'valid': False,
            'error': 'Invalid file type. Please upload a PDF or image (JPG/PNG).',
        }

    size = getattr(file, 'size', 0) or 0
    if size <= 0:
        return {'valid': False, 'error': 'The file appears empty or corrupted.'}
    if size > MAX_UPLOAD_BYTES:
        return {'valid': False, 'error': 'File size exceeds 5 MB limit.'}

    header = file.read(16)
    file.seek(0)
    magic_ext = _detect_extension_from_magic(header)
    if not magic_ext:
        return {
            'valid': False,
            'error': 'The file could not be read or is corrupted. Upload a valid PDF or image.',
        }
    if magic_ext != extension and not (magic_ext == '.jpg' and extension in {'.jpg', '.jpeg'}):
        return {
            'valid': False,
            'error': f'File content does not match extension. Expected {magic_ext} content.',
        }

    file_hash = compute_file_sha256(file)
    if requirement:
        from apps.hr.models import EmployeeDocumentUploadVersion

        if requirement.file_hash and requirement.file_hash == file_hash:
            return {
                'valid': False,
                'error': 'This file is identical to your current upload. Choose a different file.',
            }
        if EmployeeDocumentUploadVersion.objects.filter(
            requirement=requirement,
            file_hash=file_hash,
        ).exists():
            return {
                'valid': False,
                'error': 'You already uploaded this exact file before. Please upload an updated document.',
            }

    return {
        'valid': True,
        'file_hash': file_hash,
        'extension': extension,
        'size': size,
    }


def resolve_workflow_status(requirement) -> str:
    from apps.hr.onboarding_documents import _requirement_has_upload

    mode = requirement.document_type.verification_mode
    if (
        mode == 'upload'
        and requirement.status in {'verified', 'physically_verified'}
        and not _requirement_has_upload(requirement)
        and not requirement.override_approved
    ):
        return WORKFLOW_NOT_UPLOADED

    if requirement.override_approved or requirement.status in {'verified', 'physically_verified'}:
        return WORKFLOW_VERIFIED
    if requirement.status in {'reupload_requested', 'rejected'}:
        return WORKFLOW_REUPLOAD_REQUIRED
    if _requirement_has_upload(requirement) and requirement.status in {
        'uploaded',
        'pending',
    }:
        return WORKFLOW_UPLOADED
    return WORKFLOW_NOT_UPLOADED


def archive_requirement_upload(requirement, *, reason: str = 'replaced') -> None:
    """Move current upload into version history without deleting the file."""
    from django.core.files.base import File

    from apps.hr.models import EmployeeDocumentUploadVersion

    if not requirement.uploaded_file:
        return

    last_version = (
        EmployeeDocumentUploadVersion.objects.filter(requirement=requirement)
        .order_by('-version_number')
        .first()
    )
    next_version = (last_version.version_number + 1) if last_version else 1

    with requirement.uploaded_file.open('rb') as src:
        stored_hash = requirement.file_hash or ''
        if not stored_hash:
            with requirement.uploaded_file.open('rb') as fh:
                stored_hash = compute_file_sha256(fh)

        version = EmployeeDocumentUploadVersion(
            requirement=requirement,
            original_filename=os.path.basename(requirement.uploaded_file.name),
            file_size=requirement.uploaded_file.size or 0,
            file_hash=stored_hash,
            version_number=next_version,
            uploaded_at=requirement.uploaded_at or timezone.now(),
            archived_reason=reason,
            status_at_archive=requirement.status,
        )
        version.file.save(
            os.path.basename(requirement.uploaded_file.name),
            File(src),
            save=False,
        )
        version.save()

    requirement.uploaded_file = None
    requirement.uploaded_at = None
    requirement.file_hash = ''


def get_previous_upload_snapshot(requirement) -> dict | None:
    from apps.hr.models import EmployeeDocumentUploadVersion

    version = (
        EmployeeDocumentUploadVersion.objects.filter(requirement=requirement)
        .order_by('-version_number')
        .first()
    )
    if not version or not version.file:
        return None
    return {
        'version_id': str(version.id),
        'version_number': version.version_number,
        'file_name': version.original_filename or os.path.basename(version.file.name),
        'uploaded_at': version.uploaded_at.isoformat() if version.uploaded_at else None,
        'archived_at': version.archived_at.isoformat() if version.archived_at else None,
        'archived_reason': version.archived_reason,
    }


def file_is_previewable(file_name: str | None) -> bool:
    if not file_name:
        return False
    ext = file_name.rsplit('.', 1)[-1].lower() if '.' in file_name else ''
    return ext in {'pdf', 'jpg', 'jpeg', 'png', 'webp'}


def build_progress_summary(rows: list[dict], *, verified_only: bool = False) -> dict:
    uploadable = [
        r for r in rows
        if r.get('verification_mode') in {'upload', 'hybrid'}
    ]
    required = [r for r in uploadable if r.get('mandatory')]
    optional = [r for r in uploadable if not r.get('mandatory')]

    def is_complete(row):
        if verified_only:
            return row.get('workflow_status') == WORKFLOW_VERIFIED
        return row.get('workflow_status') in {WORKFLOW_UPLOADED, WORKFLOW_VERIFIED}

    required_done = sum(1 for r in required if is_complete(r))
    optional_done = sum(1 for r in optional if is_complete(r))
    required_verified = sum(1 for r in required if r.get('workflow_status') == WORKFLOW_VERIFIED)
    all_required_verified = bool(required) and required_verified == len(required)

    if verified_only and required:
        label = f'{required_verified} / {len(required)} required documents verified by HR'
    elif required:
        label = f'{required_done} / {len(required)} required documents completed'
    else:
        label = 'No required uploads for this role'

    return {
        'required_total': len(required),
        'required_completed': required_done,
        'required_verified': required_verified,
        'all_required_verified': all_required_verified,
        'optional_total': len(optional),
        'optional_completed': optional_done,
        'label': label,
        'percent': round((required_done / len(required)) * 100) if required else 100,
        'verified_percent': round((required_verified / len(required)) * 100) if required else 100,
    }
