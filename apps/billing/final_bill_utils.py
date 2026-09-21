from __future__ import annotations

from django.db import transaction
from django.utils import timezone

from apps.billing.models import IPDFinalBillSequence
from apps.settings_management.document_number_service import render_document_number


def _resolve_bill_year(admission) -> int:
    return int(getattr(getattr(admission, "admission_date", None), "year", None) or timezone.now().year)


def preview_ipd_final_bill_number(admission, seq: int) -> str:
    bill_year = _resolve_bill_year(admission)
    return render_document_number(admission.hospital, "ipd_final_bill", bill_year, int(seq))


@transaction.atomic
def next_ipd_final_bill_number(admission) -> str:
    bill_year = _resolve_bill_year(admission)
    seq_obj, _ = IPDFinalBillSequence.objects.select_for_update().get_or_create(
        hospital=admission.hospital,
        year=bill_year,
    )
    seq_obj.last_seq += 1
    seq_obj.save(update_fields=["last_seq", "updated_at"])
    return preview_ipd_final_bill_number(admission, seq_obj.last_seq)
