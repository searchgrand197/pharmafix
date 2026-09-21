"""
Hospital-scoped organization branding for offer letters and HR emails.
"""

from __future__ import annotations

from django.utils.html import escape

from apps.hr.models import OfferLetterSettings

BRANDING_TEMPLATE_KEYS = (
    'company_name',
    'company_logo',
    'company_address',
    'company_email',
    'company_phone',
    'company_website',
    'hr_name',
    'hr_designation',
    'hr_email',
    'hr_phone',
    'hr_signature',
    'registered_office_address',
    'corporate_office_address',
    'company_registration_number',
    'footer_confidentiality_note',
)


def media_url(file_field, request=None) -> str:
    if not file_field:
        return ''
    try:
        url = file_field.url
    except Exception:
        return ''
    if request and url and not url.startswith(('http://', 'https://')):
        return request.build_absolute_uri(url)
    return url or ''


def get_organization_settings(hospital_id=None) -> OfferLetterSettings:
    settings_obj, _ = OfferLetterSettings.objects.select_related('hospital').get_or_create(
        hospital_id=hospital_id,
    )
    return settings_obj


def get_hr_organization_settings() -> OfferLetterSettings:
    """HR module Organization Settings (global record, not tied to a job hospital)."""
    return get_organization_settings(hospital_id=None)


def resolve_hospital_id(
    *,
    hospital_id=None,
    job=None,
    candidate=None,
    offer=None,
    employee=None,
    user=None,
):
    if hospital_id:
        return hospital_id
    if job is not None and getattr(job, 'hospital_id', None):
        return job.hospital_id
    if candidate is not None:
        jo = getattr(candidate, 'job_opening', None)
        if jo is not None and getattr(jo, 'hospital_id', None):
            return jo.hospital_id
    if offer is not None:
        hid = resolve_hospital_id(candidate=getattr(offer, 'candidate', None))
        if hid:
            return hid
        if getattr(offer, 'hospital_id', None):
            return offer.hospital_id
    if employee is not None and getattr(employee, 'hospital_id', None):
        return employee.hospital_id
    if user is not None and getattr(user, 'hospital_id', None):
        return user.hospital_id
    return None


def build_branding_context(settings: OfferLetterSettings | None = None, *, hospital_id=None, request=None) -> dict:
    if settings is None:
        settings = get_organization_settings(hospital_id)
    return settings.to_branding_dict(request=request)


def build_email_branding_context(request=None) -> dict:
    """Branding for all HR emails — global Organization Settings only."""
    return get_hr_organization_settings().to_email_branding_dict(request=request)


def _signatory_line(ctx: dict) -> str:
    hr_name = (ctx.get('hr_name') or '').strip()
    designation = (ctx.get('hr_designation') or '').strip()
    if hr_name and designation:
        return f'{hr_name}\n{designation}'
    if hr_name:
        return hr_name
    if designation:
        return designation
    return 'HR Team\nHR Manager'


def _footer_company_name(ctx: dict) -> str:
    return (ctx.get('organization_name') or ctx.get('company_name') or '').strip()


def render_email_footer_plain(ctx: dict) -> str:
    parts = ['Best regards,', _signatory_line(ctx)]
    company = _footer_company_name(ctx)
    if company:
        parts.append('')
        parts.append(company)
    address = (ctx.get('company_address') or '').strip()
    if address:
        parts.append('')
        parts.append(address)
    return '\n'.join(parts)


def render_automated_notice_plain(ctx: dict) -> str:
    company = _footer_company_name(ctx)
    if company:
        return f'{company} — automated notification — do not reply'
    return 'Automated notification — do not reply'


def render_email_footer_html(ctx: dict) -> str:
    hr_name = (ctx.get('hr_name') or '').strip() or 'HR Team'
    designation = (ctx.get('hr_designation') or '').strip() or 'HR Manager'
    company = escape(_footer_company_name(ctx))
    signatory = f'<strong>{escape(hr_name)}</strong><br>{escape(designation)}'
    lines = [
        '<p style="font-size: 14px; color: #64748b; margin: 0;">Best regards,<br>',
        signatory,
        '</p>',
    ]
    if company:
        lines.append(f'<p style="font-size: 13px; color: #64748b; margin: 16px 0 0;">{company}</p>')
    address = (ctx.get('company_address') or '').strip()
    if address:
        addr_html = '<br>'.join(escape(line) for line in address.split('\n') if line.strip())
        lines.append(f'<p style="font-size: 12px; color: #94a3b8; margin: 16px 0 0;">{addr_html}</p>')
    return '\n'.join(lines)


def render_automated_notice_html(ctx: dict) -> str:
    notice = escape(render_automated_notice_plain(ctx))
    return f'<div style="text-align: center; margin-top: 20px; font-size: 12px; color: #94a3b8;">{notice}</div>'


def append_branded_signature(
    plain_body: str,
    html_inner: str,
    *,
    hospital_id=None,
    job=None,
    candidate=None,
    offer=None,
    employee=None,
    request=None,
) -> tuple[str, str]:
    """Append standardized plain/HTML signature blocks to HR emails."""
    ctx = build_email_branding_context(request=request)
    footer_plain = render_email_footer_plain(ctx)
    notice_plain = render_automated_notice_plain(ctx)
    full_plain = f'{plain_body.rstrip()}\n\n{footer_plain}\n\n{notice_plain}'

    footer_html = render_email_footer_html(ctx)
    notice_html = render_automated_notice_html(ctx)
    full_html = f"""<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <style type="text/css">
    body, table, td, a {{ -webkit-text-size-adjust: 100%; -ms-text-size-adjust: 100%; }}
    table, td {{ mso-table-lspace: 0pt; mso-table-rspace: 0pt; }}
    img {{ -ms-interpolation-mode: bicubic; border: 0; height: auto; line-height: 100%; outline: none; text-decoration: none; }}
    @media only screen and (max-width: 600px) {{
      .email-container {{ padding: 12px !important; }}
      .email-card {{ padding: 20px !important; }}
    }}
  </style>
</head>
<body style="font-family: Arial, sans-serif; line-height: 1.6; color: #1f2937; max-width: 600px; margin: 0 auto; padding: 20px;" class="email-container">
  <div style="border: 1px solid #e5e7eb; border-radius: 12px; padding: 28px; background: #ffffff;" class="email-card">
    {html_inner}
    <hr style="border: 0; border-top: 1px solid #e5e7eb; margin: 24px 0;">
    {footer_html}
  </div>
  {notice_html}
</body>
</html>"""
    return full_plain, full_html


def merge_branding_into_context(base: dict, *, hospital_id=None, request=None) -> dict:
    """Merge branding template variables; non-empty base values win."""
    branding = build_branding_context(hospital_id=hospital_id, request=request)
    merged = dict(branding)
    for key, value in base.items():
        if value not in (None, ''):
            merged[key] = value
    return merged


def _non_empty(value) -> str:
    return (value or '').strip() if isinstance(value, str) else ''


def _settings_has_branding(settings: OfferLetterSettings) -> bool:
    return bool(_non_empty(settings.organization_name) or settings.logo)


def _payslip_settings_sources(*, employee=None, hospital_id=None) -> list[OfferLetterSettings]:
    """
    Organization Settings rows to merge for payslips.

    Priority: employee hospital → global (HR Organization Settings) → any row
    with a company name or logo (handles empty hospital shells from get_or_create).
    """
    seen: set = set()
    sources: list[OfferLetterSettings] = []

    def add(hid):
        settings = get_organization_settings(hid)
        if settings.pk not in seen:
            seen.add(settings.pk)
            sources.append(settings)

    resolved_hospital_id = hospital_id
    if resolved_hospital_id is None and employee is not None:
        resolved_hospital_id = getattr(employee, 'hospital_id', None)

    if resolved_hospital_id:
        add(resolved_hospital_id)
    add(None)

    if not any(_settings_has_branding(row) for row in sources):
        extras = (
            OfferLetterSettings.objects.select_related('hospital')
            .filter(organization_name__gt='')
            .order_by('-updated_at')
        )
        for row in extras:
            if row.pk not in seen:
                seen.add(row.pk)
                sources.append(row)
                break

        if not any(row.logo for row in sources):
            logo_row = (
                OfferLetterSettings.objects.exclude(logo='')
                .exclude(logo__isnull=True)
                .order_by('-updated_at')
                .first()
            )
            if logo_row and logo_row.pk not in seen:
                sources.append(logo_row)

    return sources


def get_payslip_branding(*, employee=None, hospital_id=None, request=None) -> dict:
    """
    Branding for payslip PDFs from HR Organization Settings.

    Merges hospital-scoped and global settings; non-empty values win in priority
    order so empty hospital shells do not hide global organization name/logo.
    """
    sources = _payslip_settings_sources(employee=employee, hospital_id=hospital_id)
    merged: dict = {}
    logo_settings: OfferLetterSettings | None = None

    for settings in sources:
        branding = settings.to_branding_dict(request=request)
        for key, value in branding.items():
            if key in {'logo_url', 'signature_url', 'company_logo', 'hr_signature'}:
                continue
            if _non_empty(value) and not _non_empty(merged.get(key)):
                merged[key] = value
        if settings.logo:
            logo_settings = settings

    hospital_name = ''
    if employee is not None:
        hospital = getattr(employee, 'hospital', None)
        if hospital is not None:
            hospital_name = _non_empty(getattr(hospital, 'name', None))
        elif getattr(employee, 'hospital_id', None):
            from apps.shared.models import Hospital

            hospital_name = _non_empty(
                Hospital.objects.filter(pk=employee.hospital_id).values_list('name', flat=True).first()
            )

    company_name = (
        _non_empty(merged.get('company_name'))
        or _non_empty(merged.get('organization_name'))
        or hospital_name
        or 'Company'
    )
    merged['company_name'] = company_name
    merged['organization_name'] = company_name

    if logo_settings and logo_settings.logo:
        merged['logo_url'] = media_url(logo_settings.logo, request)
        merged['_settings_logo'] = logo_settings.logo
    else:
        merged['_settings_logo'] = None

    # HR Organization Settings (global) always wins for company identity on payslips.
    global_settings = get_hr_organization_settings()
    global_branding = global_settings.to_branding_dict(request=request)
    for key in (
        'company_name',
        'organization_name',
        'company_address',
        'company_email',
        'company_phone',
        'company_website',
        'registered_office_address',
        'corporate_office_address',
        'company_registration_number',
        'footer_confidentiality_note',
        'hr_name',
        'hr_designation',
    ):
        if _non_empty(global_branding.get(key)):
            merged[key] = global_branding[key]

    if _non_empty(global_branding.get('company_name')):
        merged['company_name'] = global_branding['company_name']
        merged['organization_name'] = global_branding['company_name']

    signature_field = None
    if global_settings.signature:
        signature_field = global_settings.signature
    else:
        for settings in sources:
            if settings.signature:
                signature_field = settings.signature
                break

    if signature_field:
        merged['signature_url'] = media_url(signature_field, request)
        merged['_settings_signature'] = signature_field
    else:
        merged['signature_url'] = ''
        merged['_settings_signature'] = None

    return merged
