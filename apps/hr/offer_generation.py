"""
Shared Offer Letter Builder pipeline (component / block templates).

Used by individual POST /hr/offers/create_offer/ (component_template_id branch).

Legacy OfferTemplate (HTML/WYSIWYG) flow remains in OfferViewSet.create_offer when template_id is used.
"""
from __future__ import annotations

import logging
from decimal import Decimal

from django.core.files.base import ContentFile
from django.db import transaction

logger = logging.getLogger(__name__)


def _money_display(val) -> str:
    if val is None or val == '':
        return ''
    try:
        d = Decimal(str(val))
        if d == d.to_integral():
            return f'{int(d):,}'
        return f'{d:,.2f}'
    except Exception:
        return str(val)


def build_component_offer_context(offer) -> dict:
    """Variables available in Offer Builder block templates ({{ key }})."""
    jd = offer.joining_date
    joining_fmt = jd.strftime('%B %d, %Y') if jd else ''
    od = offer.offer_expiry_date
    expiry_fmt = od.strftime('%B %d, %Y') if od else ''
    jo = getattr(offer, 'job', None)
    if jo is None and getattr(offer, 'candidate_id', None):
        try:
            jo = offer.candidate.job_opening
        except Exception:
            jo = None

    emp_type = (offer.employment_type or '').strip()
    if jo and hasattr(jo, 'get_employment_type_display'):
        emp_type = jo.get_employment_type_display() or emp_type or str(getattr(jo, 'employment_type', '') or '')
    elif jo and not emp_type:
        emp_type = str(getattr(jo, 'employment_type', '') or '')

    from apps.hr.organization_branding import merge_branding_into_context, resolve_hospital_id

    hospital_id = resolve_hospital_id(offer=offer, candidate=getattr(offer, 'candidate', None))
    return merge_branding_into_context({
        'company_name': offer.company_name or '',
        'candidate_name': offer.candidate_name or '',
        'candidate_email': offer.candidate_email or '',
        'job_title': offer.job_title or '',
        'designation': offer.job_title or '',
        'job_location': offer.job_location or '',
        'department': offer.department or '',
        'joining_date': joining_fmt,
        'offer_expiry_date': expiry_fmt,
        'ctc': _money_display(offer.ctc),
        'basic_salary': _money_display(offer.basic_salary),
        'hra': _money_display(offer.hra),
        'allowances': _money_display(offer.allowances),
        'bonus': _money_display(offer.bonus),
        'hr_name': offer.hr_name or '',
        'hr_designation': offer.hr_designation or '',
        'employment_type': emp_type or (offer.employment_type or ''),
        'work_shift': offer.work_shift or '',
        'working_hours': offer.working_hours or '',
        'probation_period': offer.probation_period or '',
        'notice_period': offer.notice_period or '',
        'weekly_off': offer.weekly_off or '',
    }, hospital_id=hospital_id)


def render_component_offer_html(component_template, offer) -> str:
    from apps.hr.utils.component_renderer import render_offer_template

    ctx = build_component_offer_context(offer)
    return render_offer_template(component_template.design_json, ctx)


def delete_stale_draft_offers_for_candidate(candidate) -> None:
    from apps.hr.models import Offer

    Offer.objects.filter(
        candidate=candidate,
        status__in=['created', 'draft', 'rejected'],
    ).delete()


def create_offer_from_component_template(
    candidate,
    component_template,
    *,
    joining_date,
    offer_expiry_date,
    ctc=None,
    basic_salary=None,
    hra=None,
    allowances=None,
    bonus=None,
    work_shift=None,
    working_hours=None,
    probation_period=None,
    notice_period=None,
):
    """
    Create an Offer row from a ComponentOfferTemplate: snapshot fields, render HTML, initial PDF.
    Mirrors the historical create_offer(component) behaviour (company defaults unchanged).
    """
    from apps.hr.models import Offer

    jo = candidate.job_opening
    dept_name = ''
    if jo and jo.department_id:
        dept_name = jo.department.name
    job_title = 'Position'
    if jo:
        if getattr(jo, 'designation_id', None) and jo.designation:
            job_title = jo.designation.name
        else:
            job_title = jo.title or 'Position'
    emp_type = 'Full Time'
    if jo:
        if hasattr(jo, 'get_employment_type_display'):
            emp_type = jo.get_employment_type_display() or 'Full Time'
        else:
            emp_type = str(getattr(jo, 'employment_type', '') or 'Full Time')

    delete_stale_draft_offers_for_candidate(candidate)

    from apps.hr.organization_branding import build_branding_context, resolve_hospital_id

    hospital_id = resolve_hospital_id(job=jo, candidate=candidate)
    branding = build_branding_context(hospital_id=hospital_id)

    offer = Offer.objects.create(
        candidate=candidate,
        job=jo,
        component_template=component_template,
        candidate_name=candidate.name,
        candidate_email=candidate.email,
        candidate_address=candidate.address or '',
        company_name=branding.get('company_name') or 'Organization',
        company_address=branding.get('company_address') or '',
        company_email=branding.get('company_email') or branding.get('organization_contact') or '',
        company_phone=branding.get('company_phone') or '',
        hr_name=branding.get('hr_name') or 'HR Manager',
        hr_designation=branding.get('hr_designation') or 'HR',
        job_title=job_title,
        department=dept_name,
        job_location='HQ',
        employment_type=emp_type,
        ctc=Decimal(ctc) if ctc not in (None, '') else Decimal('0'),
        basic_salary=Decimal(basic_salary) if basic_salary not in (None, '') else Decimal('0'),
        hra=Decimal(hra) if hra not in (None, '') else Decimal('0'),
        allowances=Decimal(allowances) if allowances not in (None, '') else Decimal('0'),
        bonus=Decimal(bonus) if bonus not in (None, '') else Decimal('0'),
        joining_date=joining_date,
        work_shift=work_shift or '',
        working_hours=working_hours or '',
        weekly_off='Saturday, Sunday',
        probation_period=probation_period or '',
        notice_period=notice_period or '',
        terms_conditions='',
        responsibilities='',
        offer_expiry_date=offer_expiry_date,
        status='created',
    )

    html = render_component_offer_html(component_template, offer)
    offer.edited_html = html
    offer.save(update_fields=['edited_html', 'updated_at'])

    from apps.hr.utils.pdf_generator_v2 import generate_pdf_from_html

    pdf_bytes = generate_pdf_from_html(html)
    if pdf_bytes:
        offer.pdf.save(f'offer_{offer.id}.pdf', ContentFile(pdf_bytes))
    else:
        logger.warning('[offer-generation] initial PDF failed offer=%s', offer.id)

    return offer


def send_created_offer(offer):
    """
    Finalize send: PDF from edited HTML, email with attachment + token links, status → sent.

    Returns:
        (success: bool, error_message: str | None)
    """
    from apps.hr.models import Offer
    from apps.hr.utils.pdf_generator import generate_offer_pdf
    from apps.hr.recruitment_email_dispatcher import EmailEventDispatcher

    offer_pk = offer.pk

    try:
        with transaction.atomic():
            o_lock = Offer.objects.select_for_update().get(pk=offer_pk)
            if o_lock.status == 'sent':
                return False, 'Offer has already been sent'

        offer_row = Offer.objects.get(pk=offer_pk)
        pdf_result = generate_offer_pdf(offer_row)
        if not pdf_result:
            return False, 'Failed to generate PDF'

        offer_row.refresh_from_db()

        email_result = EmailEventDispatcher.offer_sent(
            offer_row,
            sync=True,
            on_commit=False,
        )
        if not email_result:
            return False, 'Failed to send email'

        with transaction.atomic():
            o2 = Offer.objects.select_for_update().get(pk=offer_pk)
            if o2.status == 'sent':
                return False, 'Offer was already sent by another request.'
            o2.status = 'sent'
            o2.save(update_fields=['status', 'updated_at'])
            candidate = o2.candidate
            candidate.offer_status = 'sent'
            candidate.save(update_fields=['offer_status', 'updated_at'])

        logger.info('[offer-generation] offer sent id=%s', offer_pk)
        return True, None
    except Exception as e:
        logger.exception('[offer-generation] send failed offer=%s', offer_pk)
        return False, str(e)
