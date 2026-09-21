"""
Experience / relieving letter HTML and PDF renderer.
"""

from __future__ import annotations

import os
from datetime import date
from pathlib import Path

from django.template.loader import render_to_string
from django.utils import timezone

from apps.hr.designation_utils import resolve_designation_display
from apps.hr.organization_branding import get_payslip_branding, media_url
from apps.hr.utils.pdf_generator import generate_pdf_bytes_from_html

EXPERIENCE_LETTER_TEMPLATE = 'hr/letters/experience_letter.html'

class ExperienceLetterError(ValueError):
    pass


def assert_experience_letter_eligible(employee) -> None:
    if employee.status not in ('terminated', 'inactive'):
        raise ExperienceLetterError('employee_not_exited')
    if not employee.relieving_date:
        raise ExperienceLetterError('relieving_date_required')


def _format_letter_date(value) -> str:
    if not value:
        return ''
    if hasattr(value, 'strftime'):
        return value.strftime('%d %B %Y')
    return str(value)


def _resolve_joining_date(employee) -> date | None:
    return employee.joining_date_confirmed or employee.joining_date


def _resolve_department(employee) -> str:
    dept_ref = getattr(employee, 'department_ref', None)
    if dept_ref is not None and getattr(dept_ref, 'name', None):
        return dept_ref.name
    return (employee.department or '').strip() or '—'


def _compute_tenure(joining: date | None, relieving: date | None) -> str:
    if not joining or not relieving or relieving < joining:
        return ''
    months = (relieving.year - joining.year) * 12 + (relieving.month - joining.month)
    if relieving.day < joining.day:
        months -= 1
    if months < 0:
        return ''
    if months == 0:
        return 'less than a month'
    years, rem_months = divmod(months, 12)
    parts: list[str] = []
    if years:
        parts.append(f'{years} year{"s" if years != 1 else ""}')
    if rem_months:
        parts.append(f'{rem_months} month{"s" if rem_months != 1 else ""}')
    if len(parts) == 2:
        return f'{parts[0]} and {parts[1]}'
    return parts[0]


def _pdf_logo_src(file_field, *, request=None) -> str:
    if not file_field:
        return ''
    try:
        path = file_field.path
        if path and os.path.isfile(path):
            return Path(path).as_posix()
    except Exception:
        pass
    url = media_url(file_field, request)
    if url.startswith('/'):
        return url
    return ''


def _pdf_signature_src(file_field, *, request=None) -> str:
    return _pdf_logo_src(file_field, request=request)


def build_experience_letter_context(employee, *, request=None) -> dict:
    assert_experience_letter_eligible(employee)

    branding = get_payslip_branding(employee=employee, request=request)
    logo_field = branding.pop('_settings_logo', None)
    logo_url = _pdf_logo_src(logo_field, request=request) or branding.get('logo_url') or ''

    signature_field = branding.pop('_settings_signature', None)
    signature_url = _pdf_signature_src(signature_field, request=request) or branding.get('signature_url') or ''

    joining = _resolve_joining_date(employee)
    relieving = employee.relieving_date
    exit_reason_label = (employee.get_exit_reason_display() or '').strip()
    if exit_reason_label == 'Not specified':
        exit_reason_label = ''

    return {
        **branding,
        'letter_date': _format_letter_date(timezone.localdate()),
        'employee_name': employee.name,
        'employee_id': employee.employee_id or '—',
        'designation': resolve_designation_display(employee) or employee.job_title or '—',
        'department': _resolve_department(employee),
        'joining_date': _format_letter_date(joining) or '—',
        'relieving_date': _format_letter_date(relieving) or '—',
        'tenure': _compute_tenure(joining, relieving),
        'conduct_remarks': (employee.conduct_remarks or 'satisfactory').strip(),
        'exit_reason': exit_reason_label,
        'show_exit_reason': bool(exit_reason_label),
        'company_name': branding.get('company_name') or branding.get('organization_name') or 'Company',
        'logo_url': logo_url,
        'signature_url': signature_url,
        'hr_name': (branding.get('hr_name') or '').strip() or 'HR Team',
        'hr_designation': (branding.get('hr_designation') or '').strip() or 'HR Manager',
    }


def render_experience_letter_html(employee, *, request=None) -> str:
    context = build_experience_letter_context(employee, request=request)
    return render_to_string(EXPERIENCE_LETTER_TEMPLATE, context)


def render_experience_letter_pdf_bytes(employee, *, request=None) -> bytes | None:
    html = render_experience_letter_html(employee, request=request)
    return generate_pdf_bytes_from_html(html)


def experience_letter_filename(employee) -> str:
    safe_name = ''.join(c if c.isalnum() or c in (' ', '-', '_') else '_' for c in (employee.name or 'Employee'))
    safe_name = '_'.join(safe_name.split())
    emp_id = (employee.employee_id or 'employee').replace('/', '-')
    return f'Experience_Letter_{emp_id}_{safe_name}.pdf'
