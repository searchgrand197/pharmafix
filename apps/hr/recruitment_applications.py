"""Create candidate profiles and job applications with global CAND-/APP- codes."""
from __future__ import annotations

import logging
from typing import Any

from django.db import IntegrityError, transaction

from apps.hr.candidate_pipeline import normalize_application_email
from apps.hr.models import Candidate, CandidateProfile, JobOpening
from apps.hr.recruitment_ids import allocate_application_code, allocate_candidate_code
from apps.shared.email_normalization import normalize_email_address

logger = logging.getLogger(__name__)

DUPLICATE_JOB_APPLICATION_MSG = 'This candidate has already applied for this job.'


def get_or_create_profile(
    *,
    hospital,
    email: str,
    name: str,
    phone: str = '',
    gender: str = '',
) -> CandidateProfile:
    normalized = normalize_application_email(email) if email else ''
    if normalized:
        existing = CandidateProfile.objects.filter(
            hospital=hospital,
            email__iexact=normalized,
        ).first()
        if existing:
            update_fields = []
            if name and existing.name != name:
                existing.name = name
                update_fields.append('name')
            if phone and existing.phone != phone:
                existing.phone = phone
                update_fields.append('phone')
            if gender and existing.gender != gender:
                existing.gender = gender
                update_fields.append('gender')
            if update_fields:
                update_fields.append('updated_at')
                existing.save(update_fields=update_fields)
            return existing

    return CandidateProfile.objects.create(
        hospital=hospital,
        candidate_code=allocate_candidate_code(),
        name=name,
        email=normalized,
        phone=phone or '',
        gender=gender or '',
    )


def _queue_application_received_email(candidate_id, job_id) -> None:
    """Send confirmation after the application row is committed."""

    def _run():
        from apps.hr.recruitment_email_dispatcher import EmailEventDispatcher

        try:
            cand = Candidate.objects.select_related('job_opening').get(pk=candidate_id)
            job = JobOpening.objects.get(pk=job_id)
            EmailEventDispatcher.application_received(
                cand,
                job=job,
                on_commit=False,
            )
        except Exception:
            logger.exception(
                '[recruitment] application received email failed candidate_id=%s',
                candidate_id,
            )

    transaction.on_commit(_run)


@transaction.atomic
def create_application(
    job: JobOpening,
    profile: CandidateProfile,
    *,
    send_application_received_email: bool = False,
    **application_fields,
) -> Candidate:
    if Candidate.objects.filter(job_opening=job, profile=profile).exists():
        raise ValueError(DUPLICATE_JOB_APPLICATION_MSG)

    name = application_fields.pop('name', profile.name)
    email = application_fields.pop('email', profile.email)
    phone = application_fields.pop('phone', profile.phone)
    send_application_received_email = application_fields.pop(
        'send_application_received_email',
        send_application_received_email,
    )

    try:
        candidate = Candidate.objects.create(
            job_opening=job,
            profile=profile,
            application_code=allocate_application_code(),
            name=name,
            email=email or profile.email,
            phone=phone or profile.phone,
            **application_fields,
        )
    except IntegrityError as exc:
        if 'unique_job_application_per_profile' in str(exc):
            raise ValueError(DUPLICATE_JOB_APPLICATION_MSG) from exc
        raise

    if send_application_received_email:
        _queue_application_received_email(candidate.pk, job.pk)

    from apps.hr.job_document_requirements import snapshot_application_document_requirements

    snapshot_application_document_requirements(candidate)

    return candidate


def create_application_from_public_apply(job: JobOpening, **fields) -> Candidate:
    email = fields.get('email', '')
    normalized = normalize_email_address(email) if email else ''
    if normalized:
        duplicate = Candidate.objects.filter(
            job_opening=job,
            email__iexact=normalized,
        ).exists()
        if duplicate:
            raise ValueError(DUPLICATE_JOB_APPLICATION_MSG)

    hospital = job.hospital if job else None
    profile = get_or_create_profile(
        hospital=hospital,
        email=normalized,
        name=fields.get('name', ''),
        phone=fields.get('phone', ''),
        gender=fields.get('gender', ''),
    )
    return create_application(
        job,
        profile,
        send_application_received_email=True,
        **fields,
    )


def create_application_from_api(validated_data: dict) -> Candidate:
    data = dict(validated_data)
    job = data.pop('job_opening')
    email = data.get('email', '')
    normalized = normalize_email_address(email) if email else ''
    hospital = job.hospital if job else None
    profile = get_or_create_profile(
        hospital=hospital,
        email=normalized,
        name=data.get('name', ''),
        phone=data.get('phone', ''),
        gender=data.get('gender', ''),
    )
    return create_application(job, profile, **data)
