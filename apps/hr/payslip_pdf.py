"""
Fixed-layout payslip PDF renderer (xhtml2pdf).

Uses table-based positioning to avoid dynamic layout shifting in PDF output.
"""
from __future__ import annotations

import calendar
import os
from datetime import date, datetime
from decimal import Decimal
from pathlib import Path
from typing import TYPE_CHECKING

from django.conf import settings
from django.core.files.base import ContentFile
from django.template.loader import render_to_string

from apps.hr.organization_branding import get_payslip_branding, media_url
from apps.hr.utils.pdf_generator import generate_pdf_bytes_from_html

if TYPE_CHECKING:
    from apps.hr.payslip_generator import PayslipBreakdown
    from apps.hr.payroll_models import PayrollRun, Payslip

_ONES = (
    '', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine',
    'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen',
    'Seventeen', 'Eighteen', 'Nineteen',
)
_TENS = ('', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety')


def _format_money(value) -> str:
    amount = Decimal(str(value or '0')).quantize(Decimal('0.01'))
    return f'{amount:,.2f}'


def _two_digit_words(num: int) -> str:
    if num < 20:
        return _ONES[num]
    return f'{_TENS[num // 10]} {_ONES[num % 10]}'.strip()


def _three_digit_words(num: int) -> str:
    if num >= 100:
        return f'{_ONES[num // 100]} Hundred {_two_digit_words(num % 100)}'.strip()
    return _two_digit_words(num)


def amount_in_words_inr(value) -> str:
    """Convert rupee amount to Indian English words (whole rupees + paise)."""
    amount = Decimal(str(value or '0')).quantize(Decimal('0.01'))
    rupees = int(amount)
    paise = int((amount - Decimal(rupees)) * 100)

    if rupees == 0 and paise == 0:
        return 'Zero Rupees Only'

    parts: list[str] = []
    crore = rupees // 10_000_000
    lakh = (rupees % 10_000_000) // 100_000
    thousand = (rupees % 100_000) // 1000
    hundred = rupees % 1000

    if crore:
        parts.append(f'{_two_digit_words(crore)} Crore')
    if lakh:
        parts.append(f'{_two_digit_words(lakh)} Lakh')
    if thousand:
        parts.append(f'{_two_digit_words(thousand)} Thousand')
    if hundred:
        parts.append(_three_digit_words(hundred))

    words = ' '.join(parts).strip() or 'Zero'
    result = f'{words} Rupees'
    if paise:
        result += f' and {_two_digit_words(paise)} Paise'
    return f'{result} Only'


def _month_label(month: str) -> str:
    year_str, month_str = month.split('-', 1)
    month_name = calendar.month_name[int(month_str)]
    return f'{month_name} {year_str}'


def _format_period_date(value) -> str | None:
    if not value:
        return None
    if isinstance(value, date):
        return value.strftime('%d-%b-%Y')
    text = str(value).strip()
    if not text:
        return None
    for fmt in ('%Y-%m-%d', '%d-%m-%Y', '%d/%m/%Y', '%d-%b-%Y'):
        try:
            if fmt == '%Y-%m-%d':
                return date.fromisoformat(text).strftime('%d-%b-%Y')
            return datetime.strptime(text, fmt).strftime('%d-%b-%Y')
        except ValueError:
            continue
    return text


def _pay_period_range(month: str, attendance: dict) -> str:
    year_str, month_str = month.split('-', 1)
    year = int(year_str)
    month_num = int(month_str)
    last_day = calendar.monthrange(year, month_num)[1]
    start = _format_period_date(attendance.get('period_start')) or date(year, month_num, 1).strftime('%d-%b-%Y')
    end = _format_period_date(attendance.get('period_end')) or date(year, month_num, last_day).strftime('%d-%b-%Y')
    return f'{start} to {end}'


def _pdf_logo_src(file_field, *, request=None) -> str:
    """Local filesystem path for xhtml2pdf (Windows-safe forward slashes)."""
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


def build_payslip_context(
    *,
    payroll_run: 'PayrollRun',
    payslip: 'Payslip | None',
    breakdown: 'PayslipBreakdown',
    request=None,
) -> dict:
    employee = payroll_run.employee
    branding = get_payslip_branding(employee=employee, request=request)
    attendance = breakdown.attendance_summary or {}

    earnings_rows = [
        {'label': key.replace('_', ' ').title(), 'amount': _format_money(value)}
        for key, value in breakdown.earnings.items()
    ]
    deductions_rows = [
        {'label': key.replace('_', ' ').title(), 'amount': _format_money(value)}
        for key, value in breakdown.deductions.items()
    ]

    logo_field = branding.pop('_settings_logo', None)
    logo_url = _pdf_logo_src(logo_field, request=request)
    if not logo_url:
        logo_url = branding.get('logo_url') or ''

    from django.utils import timezone as dj_timezone

    generated_on = dj_timezone.localtime(dj_timezone.now()).strftime('%d-%b-%Y')
    if payslip is not None and payslip.generated_at:
        generated_on = payslip.generated_at.strftime('%d-%b-%Y')

    year_str, month_str = payroll_run.month.split('-', 1)
    last_day = calendar.monthrange(int(year_str), int(month_str))[1]
    date_of_payment = _format_period_date(attendance.get('period_end')) or date(
        int(year_str), int(month_str), last_day,
    ).strftime('%d-%b-%Y')

    payslip_number = f'{employee.employee_id or employee.pk}-{payroll_run.month.replace("-", "")}'
    company_name = branding.get('company_name') or branding.get('organization_name') or 'Company'

    from apps.hr.designation_utils import resolve_designation_display

    return {
        'company_name': company_name,
        'logo_url': logo_url,
        'payslip_number': payslip_number,
        'employee_name': employee.name,
        'employee_code': employee.employee_id,
        'department': employee.department or '—',
        'designation': resolve_designation_display(employee) or '—',
        'pay_period': _month_label(payroll_run.month),
        'pay_period_range': _pay_period_range(payroll_run.month, attendance),
        'pay_month_code': payroll_run.month,
        'generated_on': generated_on,
        'earnings_rows': earnings_rows,
        'deductions_rows': deductions_rows,
        'gross_salary': _format_money(breakdown.gross_salary),
        'total_deductions': _format_money(breakdown.total_deductions),
        'net_salary': _format_money(breakdown.net_salary),
        'net_salary_words': amount_in_words_inr(breakdown.net_salary),
        'per_day_salary': attendance.get('per_day_salary', '—'),
        'payment_mode': 'Bank Transfer',
        'bank_account': '—',
        'date_of_payment': date_of_payment,
        'MEDIA_ROOT': settings.MEDIA_ROOT,
    }


def render_payslip_pdf_bytes(
    *,
    payroll_run: 'PayrollRun',
    payslip: 'Payslip | None',
    breakdown: 'PayslipBreakdown',
    request=None,
) -> ContentFile | None:
    html = render_to_string(
        'hr/payroll/payslip.html',
        build_payslip_context(
            payroll_run=payroll_run,
            payslip=payslip,
            breakdown=breakdown,
            request=request,
        ),
    )
    pdf_data = generate_pdf_bytes_from_html(html)
    if not pdf_data:
        return None
    return ContentFile(pdf_data)
