"""
Shared offer letter HTML renderer — single source for editor preview and PDF generation.
"""

from __future__ import annotations

import copy
import re
from datetime import date
from types import SimpleNamespace

from django.template.loader import render_to_string

from apps.hr.organization_branding import (
    build_branding_context,
    get_hr_organization_settings,
    resolve_hospital_id,
)
from apps.hr.utils.offer_dynamic_content import (
    DEFAULT_ENTERPRISE_TERMS_BLOCK,
    normalize_dynamic_content_for_offer_pdf,
    normalize_letter_section_fonts_for_pdf,
    normalize_letterhead_layout_for_pdf,
)

OFFER_LETTER_TEMPLATE = 'hr/offers/novo_offer_letter.html'
DEFAULT_LETTER_TITLE = 'OFFER OF EMPLOYMENT'

# Legacy bracket placeholders → context keys
BRACKET_ALIASES = {
    'your organization': 'company_name',
    'job title': 'job_title',
    'joining date': 'joining_date',
    'manager name': 'reporting_manager',
    'candidate name': 'candidate_name',
}


def _get_attr(data, key, default=''):
    if isinstance(data, dict):
        return data.get(key, default)
    return getattr(data, key, default) or default


def _format_joining_date(value) -> str:
    if not value:
        return date.today().strftime('%d %B %Y')
    if hasattr(value, 'strftime'):
        return value.strftime('%d %B %Y')
    return str(value)


def _resolve_job_title_and_department(data) -> tuple[str, str]:
    """Prefer explicit builder fields; fall back to the linked job opening."""
    job_title = _get_attr(data, 'job_title', '').strip()
    department = _get_attr(data, 'department', '').strip()
    if job_title and department:
        return job_title, department

    candidate = _candidate_from_builder_ref(_get_attr(data, 'candidate'))
    job_opening = getattr(candidate, 'job_opening', None) if candidate else None
    if not job_opening:
        return job_title, department

    if not job_title:
        designation = getattr(job_opening, 'designation', None)
        if getattr(job_opening, 'designation_id', None) and designation:
            job_title = (designation.name or '').strip()
        if not job_title:
            job_title = (getattr(job_opening, 'title', None) or '').strip()

    if not department:
        dept = getattr(job_opening, 'department', None)
        if getattr(job_opening, 'department_id', None) and dept:
            department = (dept.name or '').strip()

    return job_title, department


def build_substitution_context(data, *, request=None, hospital_id=None) -> dict:
    """Build variable map for {{key}} and [Key] substitution in letter body."""
    # Offer letters use global Organization Settings — never hospital display names.
    branding = build_branding_context(
        settings=get_hr_organization_settings(),
        request=request,
    )

    company_name = (branding.get('company_name') or _get_attr(data, 'company_name') or '').strip()
    company_contact = _get_attr(data, 'company_contact', '').strip()
    company_email = (_get_attr(data, 'company_email') or branding.get('company_email') or '').strip()
    company_phone = (_get_attr(data, 'company_phone') or branding.get('company_phone') or '').strip()
    if not company_contact and (company_email or company_phone):
        company_contact = ' | '.join(p for p in (company_email, company_phone) if p)

    job_title, department = _resolve_job_title_and_department(data)

    ctx = {
        'company_name': company_name,
        'organization_name': company_name,
        'company_address': (_get_attr(data, 'company_address') or branding.get('company_address') or '').strip(),
        'company_location': (_get_attr(data, 'company_location') or branding.get('organization_location') or '').strip(),
        'company_contact': company_contact,
        'company_website': (_get_attr(data, 'company_website') or branding.get('company_website') or '').strip(),
        'company_email': company_email,
        'company_phone': company_phone,
        'hr_name': (_get_attr(data, 'hr_name') or branding.get('hr_name') or '').strip(),
        'hr_designation': (_get_attr(data, 'hr_designation') or branding.get('hr_designation') or 'HR Manager').strip(),
        'hr_email': (_get_attr(data, 'hr_email') or branding.get('hr_email') or '').strip(),
        'hr_phone': (_get_attr(data, 'hr_phone') or branding.get('hr_phone') or '').strip(),
        'candidate_name': _get_attr(data, 'candidate_name', '').strip(),
        'candidate_email': _get_attr(data, 'candidate_email', '').strip(),
        'candidate_phone': _get_attr(data, 'candidate_phone', '').strip(),
        'candidate_address': _get_attr(data, 'candidate_address', '').strip(),
        'job_title': job_title,
        'designation': job_title,
        'department': department,
        'job_location': _get_attr(data, 'job_location', '').strip(),
        'reporting_manager': _get_attr(data, 'reporting_manager', '').strip(),
        'joining_date': _format_joining_date(_get_attr(data, 'joining_date')),
        'offer_expiry_date': _format_joining_date(_get_attr(data, 'offer_expiry_date')),
        'work_mode': _get_attr(data, 'work_mode', '').strip(),
        'ctc': _get_attr(data, 'ctc', '').strip(),
        'basic_salary': _get_attr(data, 'basic_salary', '').strip(),
        'hra': _get_attr(data, 'hra', '').strip(),
        'special_allowance': _get_attr(data, 'special_allowance', '').strip(),
        'bonus': _get_attr(data, 'bonus', '').strip(),
        'probation_period': _get_attr(data, 'probation_period', '').strip(),
        'notice_period': _get_attr(data, 'notice_period', '').strip(),
        'working_hours': _get_attr(data, 'working_hours', '').strip(),
        'weekly_off': _get_attr(data, 'weekly_off', '').strip(),
        'shift': _get_attr(data, 'shift', '').strip(),
    }
    ctx.update(branding)
    return ctx


def _is_joining_date_row_label(label: str) -> bool:
    normalized = (label or '').strip().lower()
    return normalized in ('date of joining', 'joining date')


def _is_offer_expiry_date_row_label(label: str) -> bool:
    normalized = (label or '').strip().lower()
    return normalized in (
        'last date to accept offer',
        'last date to accept',
        'offer validity',
    )


def _sync_position_details_table(block: dict, ctx: dict) -> dict:
    """Align Position Details rows with resolved job context (not only {{variables}})."""
    if block.get('type') != 'table':
        return block

    rows = block.get('rows') or []
    if not rows:
        return block

    dash = '—'
    values = {
        'designation': (ctx.get('designation') or ctx.get('job_title') or '').strip() or dash,
        'department': (ctx.get('department') or '').strip() or dash,
        'location': (ctx.get('job_location') or '').strip() or dash,
        'joining_date': (ctx.get('joining_date') or '').strip() or dash,
        'offer_expiry_date': (ctx.get('offer_expiry_date') or '').strip() or dash,
        'reporting_manager': (ctx.get('reporting_manager') or '').strip() or dash,
    }
    matchers = {
        'designation': lambda label: (label or '').strip().lower() == 'designation',
        'department': lambda label: (label or '').strip().lower() == 'department',
        'location': lambda label: (label or '').strip().lower() == 'location',
        'joining_date': _is_joining_date_row_label,
        'offer_expiry_date': _is_offer_expiry_date_row_label,
        'reporting_manager': lambda label: (label or '').strip().lower() == 'reporting manager',
    }

    new_rows = []
    for row in rows:
        if not isinstance(row, dict):
            continue
        cols = list(row.get('cols') or [])
        if not cols:
            new_rows.append(row)
            continue
        label = str(cols[0])
        updated = False
        for key, matcher in matchers.items():
            if matcher(label):
                value = values[key]
                if value != dash:
                    cols = [cols[0], value]
                    updated = True
                break
        new_rows.append({**row, 'cols': cols} if updated else row)

    return {**block, 'rows': new_rows}


def substitute_variables(text: str, ctx: dict) -> str:
    if not text or not isinstance(text, str):
        return text or ''

    result = text
    for key, value in ctx.items():
        if value in (None, ''):
            continue
        val = str(value)
        result = result.replace(f'{{{{{key}}}}}', val)
        result = result.replace(f'{{{{ {key} }}}}', val)

    def bracket_replacer(match):
        inner = match.group(1).strip()
        key = BRACKET_ALIASES.get(inner.lower())
        if key and ctx.get(key):
            return str(ctx[key])
        return match.group(0)

    result = re.sub(r'\[([^\]]+)\]', bracket_replacer, result)
    # Remove any unresolved {{placeholders}} — letters must not show raw variables
    result = re.sub(r'\{\{\s*\w+\s*\}\}', '', result)
    return result.strip()


def _substitute_block(block: dict, ctx: dict) -> dict:
    b = copy.deepcopy(block)
    btype = b.get('type')

    if btype in ('paragraph', 'heading') and 'content' in b:
        b['content'] = substitute_variables(b.get('content', ''), ctx)
    elif btype == 'table':
        if b.get('title'):
            b['title'] = substitute_variables(b['title'], ctx)
        rows = b.get('rows') or []
        new_rows = []
        for row in rows:
            if not isinstance(row, dict):
                continue
            cols = row.get('cols') or []
            new_rows.append({
                **row,
                'cols': [substitute_variables(str(c), ctx) for c in cols],
            })
        b['rows'] = new_rows
        b = _sync_position_details_table(b, ctx)
    elif btype == 'terms':
        if b.get('title'):
            b['title'] = substitute_variables(b['title'], ctx)
        items = b.get('items') or []
        b['items'] = [
            {
                **item,
                'label': substitute_variables(item.get('label', ''), ctx),
                'text': substitute_variables(item.get('text', ''), ctx),
            }
            for item in items
            if isinstance(item, dict)
        ]

    return b


def _ensure_terms_block(blocks: list, settings) -> list:
    has_terms = any(isinstance(b, dict) and b.get('type') == 'terms' for b in blocks)
    if has_terms:
        return blocks

    default_items = getattr(settings, 'default_terms_conditions', None) or []
    if default_items:
        terms_block = {
            'id': 'terms-default',
            'type': 'terms',
            'title': 'Terms & Conditions',
            'items': default_items,
            'marginTop': 12,
            'marginBottom': 20,
        }
    else:
        terms_block = copy.deepcopy(DEFAULT_ENTERPRISE_TERMS_BLOCK)

    return list(blocks) + [terms_block]


def _merge_org_footer_fields(data_ns: SimpleNamespace, settings) -> None:
    org_name = (getattr(data_ns, 'company_name', None) or settings.organization_name or '').strip()
    if not getattr(data_ns, 'company_name', None):
        data_ns.company_name = org_name

    footer_map = {
        'footer_registered_office': (settings.registered_office_address or settings.organization_address or '').strip(),
        'footer_corporate_office': (settings.corporate_office_address or '').strip(),
        'footer_company_registration': (settings.company_registration_number or '').strip(),
        'footer_confidentiality_note': (settings.footer_confidentiality_note or '').strip(),
        'footer_hr_email': (settings.hr_email or settings.company_email or '').strip(),
        'footer_website': (settings.organization_website or getattr(data_ns, 'company_website', '') or '').strip(),
    }
    for key, val in footer_map.items():
        if not getattr(data_ns, key, None):
            setattr(data_ns, key, val)

    if not getattr(data_ns, 'system_disclaimer', None):
        data_ns.system_disclaimer = (
            f'This is a system-generated offer letter issued by {org_name}. '
            'It is valid only when accompanied by an authorized signature.'
        )


def _builder_to_namespace(data) -> SimpleNamespace:
    if isinstance(data, SimpleNamespace):
        return data
    if isinstance(data, dict):
        return SimpleNamespace(**data)
    # Django model instance
    fields = {}
    for f in data._meta.fields:
        fields[f.name] = getattr(data, f.name)
    for key in (
        'logo_config', 'company_block_config', 'letter_section_fonts',
        'signature_config', 'dynamic_content',
    ):
        if hasattr(data, key):
            fields[key] = getattr(data, key)
    return SimpleNamespace(**fields)


def _candidate_from_builder_ref(candidate_ref):
    """
    Resolve Candidate from builder payload.

    OfferBuilderV2 model instances expose candidate as a Candidate FK object;
    API JSON uses a UUID string. Both must work — never pass __str__ to pk lookup.
    """
    if not candidate_ref:
        return None

    from apps.hr.models import Candidate

    if isinstance(candidate_ref, Candidate):
        if getattr(candidate_ref, 'job_opening_id', None) is None and candidate_ref.pk:
            return (
                Candidate.objects.select_related(
                    'job_opening',
                    'job_opening__department',
                    'job_opening__designation',
                )
                .filter(pk=candidate_ref.pk)
                .first()
                or candidate_ref
            )
        return candidate_ref

    pk = getattr(candidate_ref, 'pk', None) or candidate_ref
    if not pk:
        return None

    try:
        return Candidate.objects.select_related(
            'job_opening',
            'job_opening__department',
            'job_opening__designation',
        ).get(pk=pk)
    except (Candidate.DoesNotExist, ValueError, TypeError):
        return None


def _resolve_hospital_id_from_builder(data, hospital_id=None):
    if hospital_id:
        return hospital_id
    candidate = _candidate_from_builder_ref(_get_attr(data, 'candidate'))
    if not candidate:
        return None
    return resolve_hospital_id(candidate=candidate)


def _get_offer_letter_settings(data, *, request=None, hospital_id=None):
    """Organization Settings for offer letter PDFs (global HR record)."""
    return get_hr_organization_settings()


def prepare_builder_for_render(data, *, request=None, hospital_id=None) -> SimpleNamespace:
    """
    Normalize builder payload, merge organization branding, substitute variables.
    Returns a namespace ready for novo_offer_letter.html.
    """
    resolved_hospital_id = _resolve_hospital_id_from_builder(data, hospital_id)
    settings = _get_offer_letter_settings(data, request=request, hospital_id=resolved_hospital_id)
    ctx = build_substitution_context(
        data, request=request, hospital_id=resolved_hospital_id,
    )

    ns = _builder_to_namespace(data)

    # Defaults for fields expected by novo_offer_letter.html
    defaults = {
        'theme': 'corporate',
        'font_size': 14,
        'letter_title_font_size': 22,
        'company_name_font_size': 16,
        'company_meta_font_size': 13,
        'candidate_name_font_size': 18,
        'ref_label': 'Ref:',
        'date_label': 'Date:',
        'to_label': 'To,',
        'dear_label': 'Dear',
        'signatory_label': 'Authorized Signatory',
    }
    for key, val in defaults.items():
        if not getattr(ns, key, None):
            setattr(ns, key, val)

    normalize_letterhead_layout_for_pdf(ns)
    normalize_letter_section_fonts_for_pdf(ns)

    # Title: enterprise default, no subject line
    if not (getattr(ns, 'letter_title', None) or '').strip():
        ns.letter_title = DEFAULT_LETTER_TITLE
    ns.subject_value = ''
    ns.subject_label = ''

    # Organization settings + candidate context (no raw {{variables}} in output)
    org_name = (settings.organization_name or ctx.get('company_name') or '').strip()
    if org_name:
        ns.company_name = org_name
    elif not (getattr(ns, 'company_name', None) or '').strip():
        ns.company_name = ctx.get('company_name', '')

    if (settings.organization_address or '').strip():
        ns.company_address = settings.organization_address.strip()
    elif not (getattr(ns, 'company_address', None) or '').strip():
        ns.company_address = ctx.get('organization_address') or ctx.get('company_address', '')

    if (settings.organization_location or '').strip():
        ns.company_location = settings.organization_location.strip()
    elif not (getattr(ns, 'company_location', None) or '').strip():
        ns.company_location = ctx.get('organization_location', '')

    if not (getattr(ns, 'company_contact', None) or '').strip():
        ns.company_contact = ctx.get('company_contact', '')
    if not (getattr(ns, 'company_website', None) or '').strip():
        ns.company_website = (settings.organization_website or ctx.get('company_website', '')).strip()
    if not (getattr(ns, 'hr_name', None) or '').strip():
        ns.hr_name = (settings.hr_name or ctx.get('hr_name', '')).strip()
    if not (getattr(ns, 'hr_designation', None) or '').strip():
        ns.hr_designation = (settings.hr_designation or ctx.get('hr_designation', 'HR Manager')).strip()
    if not (getattr(ns, 'hr_email', None) or '').strip():
        ns.hr_email = (settings.hr_email or ctx.get('hr_email', '')).strip()

    if not (getattr(ns, 'job_title', None) or '').strip() and ctx.get('job_title'):
        ns.job_title = ctx['job_title']
    if not (getattr(ns, 'department', None) or '').strip() and ctx.get('department'):
        ns.department = ctx['department']

    # Logo / signature URLs from settings when missing
    logo_cfg = dict(getattr(ns, 'logo_config', None) or {})
    if not logo_cfg.get('url') and ctx.get('company_logo'):
        logo_cfg['url'] = ctx['company_logo']
    logo_cfg.setdefault('width', 120)
    logo_cfg.setdefault('height', 60)
    ns.logo_config = logo_cfg

    sig_cfg = dict(getattr(ns, 'signature_config', None) or {})
    if not sig_cfg.get('url') and ctx.get('hr_signature'):
        sig_cfg['url'] = ctx['hr_signature']
    sig_cfg.setdefault('size', 'md')
    ns.signature_config = sig_cfg

    # Ref / date defaults
    if not (getattr(ns, 'ref_value', None) or '').strip():
        builder_id = str(getattr(ns, 'id', '') or '')[:8].upper()
        ns.ref_value = f'HR/OFFER/{date.today().year}/{builder_id or "DRAFT"}'
    if not (getattr(ns, 'date_value', None) or '').strip():
        ns.date_value = date.today().strftime('%d %B %Y')

    if not (getattr(ns, 'candidate_name_salutation', None) or '').strip():
        name = (getattr(ns, 'candidate_name', None) or '').strip()
        ns.candidate_name_salutation = name.split()[0] if name else 'Candidate'

    _merge_org_footer_fields(ns, settings)

    blocks = list(getattr(ns, 'dynamic_content', None) or [])
    blocks = _ensure_terms_block(blocks, settings)
    blocks = [_substitute_block(b, ctx) for b in blocks if isinstance(b, dict)]
    ns.dynamic_content = normalize_dynamic_content_for_offer_pdf(blocks)

    return ns


def render_offer_letter_html(data, *, request=None, hospital_id=None) -> str:
    """Render offer letter HTML using the canonical template (preview + PDF)."""
    resolved_hospital_id = _resolve_hospital_id_from_builder(data, hospital_id)
    prepared = prepare_builder_for_render(
        data, request=request, hospital_id=resolved_hospital_id,
    )
    return render_to_string(
        OFFER_LETTER_TEMPLATE,
        {
            'data': prepared,
            'dynamic_content': prepared.dynamic_content,
        },
        request=request,
    )
