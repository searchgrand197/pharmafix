"""Aggregate insurance/TPA print documents for one IPD admission stay window."""

from __future__ import annotations

from datetime import datetime, time, timedelta
from decimal import Decimal

from django.db.models import Q
from django.utils import timezone


DOC_ORDER = (
    "opd",
    "final_bill",
    "discharge_summary",
    "payment_slip",
    "pharmacy",
    "lab",
)


def _aware(dt: datetime) -> datetime:
    if timezone.is_naive(dt):
        return timezone.make_aware(dt)
    return dt


def resolve_stay_window(admission, discharge_summary=None):
    """Return (start, end) datetimes inclusive for the admission stay."""
    date_part = admission.admission_date
    time_part = admission.admission_time or time.min
    start = _aware(datetime.combine(date_part, time_part))
    if not admission.admission_time and admission.created_at:
        # Prefer created_at wall-clock when admission_time was never set.
        created = timezone.localtime(admission.created_at)
        if created.date() == date_part:
            start = created

    end = None
    if discharge_summary and discharge_summary.discharge_date:
        d_time = discharge_summary.discharge_time or time.max.replace(microsecond=0)
        end = _aware(datetime.combine(discharge_summary.discharge_date, d_time))
    elif admission.discharged_at:
        end = timezone.localtime(admission.discharged_at)
    else:
        end = timezone.localtime()

    if end < start:
        end = start
    return start, end


def _iso(dt):
    if not dt:
        return None
    return timezone.localtime(dt).isoformat()


def _money(val):
    if val is None:
        return None
    try:
        return float(Decimal(val))
    except Exception:
        return None


def build_tpa_document_pack(*, admission, patient):
    from apps.discharge.models import DischargeSummary
    from apps.lab.models import LabReport
    from apps.opd.models import OPDVisit
    from apps.opd.services import resolve_opd_doctor_name
    from apps.payments.models import PaymentTransaction
    from apps.pharmacy.models import PharmacyInvoice
    from apps.ipd.services import resolve_ipd_doctor_name
    from apps.patients.serializers import PatientSerializer

    hospital_id = admission.hospital_id
    summary = (
        DischargeSummary.objects.filter(
            admission_id=admission.id,
            hospital_id=hospital_id,
            is_deleted=False,
            is_draft=False,
        )
        .order_by("-updated_at", "-created_at")
        .first()
    )
    if summary is None:
        summary = (
            DischargeSummary.objects.filter(
                admission_id=admission.id,
                hospital_id=hospital_id,
                is_deleted=False,
            )
            .order_by("-updated_at", "-created_at")
            .first()
        )

    start, end = resolve_stay_window(admission, summary if summary and not getattr(summary, "is_draft", False) else summary)
    # Inclusive end-of-day cushion when end has no seconds precision from date-only sources
    end_query = end + timedelta(seconds=59)

    start_date = timezone.localtime(start).date()
    end_date = timezone.localtime(end).date()

    documents = []

    # 1) OPD visits in window
    opd_qs = (
        OPDVisit.objects.filter(
            patient=patient,
            hospital_id=hospital_id,
            is_deleted=False,
            visit_date__gte=start_date,
            visit_date__lte=end_date,
        )
        .select_related("doctor_user")
        .order_by("visit_date", "created_at")
    )
    for v in opd_qs:
        visit_dt = _aware(datetime.combine(v.visit_date, time.min))
        if v.created_at:
            visit_dt = timezone.localtime(v.created_at)
        documents.append(
            {
                "type": "opd",
                "id": str(v.id),
                "label": f"OPD — {v.visit_date.isoformat()}"
                + (
                    f" · Dr. {resolve_opd_doctor_name(doctor_user=v.doctor_user, hospital_id=hospital_id)}"
                    if v.doctor_user_id
                    else ""
                ),
                "date": _iso(visit_dt),
                "meta": {
                    "visit_date": v.visit_date.isoformat() if v.visit_date else None,
                    "queue_number": v.queue_number,
                    "amount": _money(v.amount),
                    "payment_mode": v.payment_mode,
                    "status": v.status,
                },
            }
        )

    # 2) Final bill (always for this admission when it exists / ledger can load)
    from apps.billing.models import IPDFinalBill

    final_bill = (
        IPDFinalBill.objects.filter(admission_id=admission.id, hospital_id=hospital_id)
        .order_by("-updated_at", "-created_at")
        .first()
    )
    documents.append(
        {
            "type": "final_bill",
            "id": str(admission.id),
            "label": f"Final Bill — {admission.ipd_no or admission.id}",
            "date": _iso(end),
            "meta": {
                "admission_id": str(admission.id),
                "ipd_no": admission.ipd_no,
                "status": admission.status,
                "available": True,
                "amount": _money(final_bill.net_amount) if final_bill else None,
                "bill_no": final_bill.bill_no if final_bill else None,
            },
        }
    )

    # 3) Discharge summary (non-draft preferred; include draft as unavailable flag)
    if summary and not getattr(summary, "is_draft", False):
        disc_dt = end
        if summary.discharge_date:
            t = summary.discharge_time or time.min
            disc_dt = _aware(datetime.combine(summary.discharge_date, t))
        documents.append(
            {
                "type": "discharge_summary",
                "id": str(summary.id),
                "label": "Discharge Summary",
                "date": _iso(disc_dt),
                "meta": {
                    "admission_id": str(admission.id),
                    "is_draft": False,
                    "discharge_date": summary.discharge_date.isoformat() if summary.discharge_date else None,
                    "discharge_time": str(summary.discharge_time)[:5] if summary.discharge_time else None,
                },
            }
        )
    else:
        documents.append(
            {
                "type": "discharge_summary",
                "id": None,
                "label": "Discharge Summary",
                "date": None,
                "meta": {
                    "admission_id": str(admission.id),
                    "available": False,
                    "reason": "No finalized discharge summary",
                    "draft_id": str(summary.id) if summary else None,
                },
            }
        )

    # 4) Payment slips
    pay_qs = (
        PaymentTransaction.objects.filter(
            hospital_id=hospital_id,
            is_deleted=False,
            voided=False,
            invoice__patient_id=patient.id,
            paid_at__gte=start,
            paid_at__lte=end_query,
        )
        .select_related("invoice")
        .order_by("paid_at")
    )
    for p in pay_qs:
        documents.append(
            {
                "type": "payment_slip",
                "id": str(p.id),
                "label": f"Advance Payment Slip — {p.slip_number or p.receipt_no or p.id}",
                "date": _iso(p.paid_at),
                "meta": {
                    "slip_number": p.slip_number,
                    "receipt_no": p.receipt_no,
                    "amount": _money(p.amount),
                    "payment_mode": p.payment_mode,
                    "invoice_no": getattr(p.invoice, "invoice_no", None),
                },
            }
        )

    # 5) Pharmacy invoices (this admission or unlinked patient sales in window)
    pharm_qs = (
        PharmacyInvoice.objects.filter(
            patient_id=patient.id,
            status=PharmacyInvoice.Status.FINALIZED,
            voided=False,
            date__gte=start_date,
            date__lte=end_date,
            pharmacy__hospital_id=hospital_id,
        )
        .filter(Q(ipd_admission_id=admission.id) | Q(ipd_admission__isnull=True))
        .order_by("date", "created_at")
    )
    for inv in pharm_qs:
        inv_dt = _aware(datetime.combine(inv.date, time.min))
        if inv.created_at and timezone.localtime(inv.created_at).date() == inv.date:
            inv_dt = timezone.localtime(inv.created_at)
        documents.append(
            {
                "type": "pharmacy",
                "id": str(inv.id),
                "label": f"Pharmacy — {inv.invoice_no}",
                "date": _iso(inv_dt),
                "meta": {
                    "invoice_no": inv.invoice_no,
                    "amount": _money(inv.grand_total),
                    "grand_total": _money(inv.grand_total),
                    "status": inv.status,
                    "pharmacy_id": str(inv.pharmacy_id) if inv.pharmacy_id else None,
                    "ipd_admission_id": str(inv.ipd_admission_id) if inv.ipd_admission_id else None,
                },
            }
        )

    # 6) Lab reports
    lab_qs = LabReport.objects.filter(
        patient_id=patient.id,
        hospital_id=hospital_id,
    ).exclude(status=LabReport.Status.CANCELLED).order_by("created_at")
    for r in lab_qs:
        stamp = r.reported_at or r.collected_at or r.created_at
        if not stamp:
            continue
        local_stamp = timezone.localtime(stamp)
        if not (start <= local_stamp <= end_query):
            continue
        documents.append(
            {
                "type": "lab",
                "id": str(r.id),
                "label": f"Lab Report — {r.lab_no}",
                "date": _iso(local_stamp),
                "meta": {
                    "lab_no": r.lab_no,
                    "status": r.status,
                },
            }
        )

    # Stable category order, preserve chronological within type via append order
    type_rank = {t: i for i, t in enumerate(DOC_ORDER)}
    documents.sort(key=lambda d: (type_rank.get(d["type"], 99), d.get("date") or ""))

    groups = []
    for t in DOC_ORDER:
        items = [d for d in documents if d["type"] == t]
        available_count = sum(1 for d in items if d.get("id") and d.get("meta", {}).get("available", True) is not False)
        groups.append(
            {
                "type": t,
                "label": {
                    "opd": "OPD",
                    "final_bill": "Final Bill",
                    "discharge_summary": "Discharge Summary",
                    "payment_slip": "Advance Payment Slip",
                    "pharmacy": "Pharmacy Bills",
                    "lab": "Lab Reports",
                }[t],
                "count": available_count,
                "items": items,
            }
        )

    doctor_name = resolve_ipd_doctor_name(
        assigned_doctor=admission.assigned_doctor,
        hospital_id=hospital_id,
    )

    return {
        "patient": PatientSerializer(patient).data,
        "admission": {
            "id": str(admission.id),
            "ipd_no": admission.ipd_no,
            "admission_date": admission.admission_date.isoformat() if admission.admission_date else None,
            "admission_time": str(admission.admission_time)[:5] if admission.admission_time else None,
            "discharged_at": _iso(admission.discharged_at) if admission.discharged_at else None,
            "status": admission.status,
            "department": admission.department,
            "ward_name": admission.ward_name,
            "room_name": admission.room_name,
            "bed_code": admission.bed_code,
            "assigned_doctor_name": doctor_name,
            "scheme_id": str(admission.scheme_id) if admission.scheme_id else None,
        },
        "window": {
            "start": _iso(start),
            "end": _iso(end),
        },
        "groups": groups,
        "documents": documents,
    }
