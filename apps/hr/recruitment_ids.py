"""Race-safe allocation of global recruitment display codes."""
from __future__ import annotations

from django.db import transaction

from apps.hr.models import RecruitmentIdSequence

PREFIX_CANDIDATE = 'CAND'
PREFIX_APPLICATION = 'APP'
DEFAULT_WIDTH = 6


@transaction.atomic
def allocate_code(prefix: str, *, width: int = DEFAULT_WIDTH) -> str:
    row = (
        RecruitmentIdSequence.objects.select_for_update()
        .filter(prefix=prefix)
        .first()
    )
    if row is None:
        row = RecruitmentIdSequence.objects.create(prefix=prefix, last_seq=0)
        row = RecruitmentIdSequence.objects.select_for_update().get(pk=row.pk)
    row.last_seq += 1
    row.save(update_fields=['last_seq', 'updated_at'])
    return f'{prefix}-{row.last_seq:0{width}d}'


def allocate_candidate_code() -> str:
    return allocate_code(PREFIX_CANDIDATE)


def allocate_application_code() -> str:
    return allocate_code(PREFIX_APPLICATION)
