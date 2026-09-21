"""
Normalize offer builder dynamic_content so PDF renderers (xhtml2pdf / ReportLab)
never see <tr> rows without <td> cells — that case raises
"must have at least a row and column" when column count is zero.
"""

DEFAULT_ENTERPRISE_TERMS_BLOCK = {
    'id': 'terms-enterprise',
    'type': 'terms',
    'title': 'Terms & Conditions',
    'marginTop': 12,
    'marginBottom': 20,
    'items': [
        {
            'label': 'Probation Period',
            'text': (
                'You will be on probation for {{probation_period}} from your date of joining. '
                'During this period, either party may terminate employment with shorter notice as per company policy.'
            ),
        },
        {
            'label': 'Confidentiality',
            'text': (
                'You shall maintain strict confidentiality of all proprietary, patient, and business information '
                'and shall not disclose any such information during or after your employment.'
            ),
        },
        {
            'label': 'Code of Conduct',
            'text': (
                'You are required to adhere to the organization\'s code of conduct, ethics policy, '
                'and all applicable workplace policies at all times.'
            ),
        },
        {
            'label': 'Employment Conditions',
            'text': (
                'Your employment is subject to satisfactory verification of credentials, medical fitness, '
                'and compliance with statutory requirements. Working hours: {{working_hours}}; weekly off: {{weekly_off}}.'
            ),
        },
        {
            'label': 'Termination',
            'text': (
                'After confirmation, either party may terminate employment by giving {{notice_period}} written notice '
                'or salary in lieu thereof, subject to applicable law and company policy.'
            ),
        },
        {
            'label': 'Joining Conditions',
            'text': (
                'Please accept this offer on or before {{offer_expiry_date}} by using the link in your email. '
                'This offer is contingent upon your joining on or before the agreed date, submission of required documents, '
                'and acceptance of this letter in writing. Failure to join on the agreed date may result in withdrawal of this offer.'
            ),
        },
    ],
}


def normalize_dynamic_content_for_offer_pdf(blocks):
    """
    Ensure every table block row has at least one column (string cell).
    Mutates copies only; returns a new list safe to pass to templates.
    """
    if not isinstance(blocks, list):
        return []

    normalized = []
    for block in blocks:
        if not isinstance(block, dict):
            normalized.append(block)
            continue
        b = dict(block)
        if b.get("type") != "table":
            normalized.append(b)
            continue

        rows = b.get("rows")
        if not isinstance(rows, list):
            rows = []

        new_rows = []
        for row in rows:
            if not isinstance(row, dict):
                new_rows.append({"id": "", "cols": [""]})
                continue
            row_copy = dict(row)
            cols = row_copy.get("cols")
            if not isinstance(cols, list) or len(cols) == 0:
                row_copy["cols"] = [""]
            else:
                row_copy["cols"] = ["" if c is None else str(c) for c in cols]
            new_rows.append(row_copy)

        if not new_rows:
            new_rows = [{"id": "", "cols": [""]}]
        b["rows"] = new_rows
        normalized.append(b)

    return normalized


def normalize_letterhead_layout_for_pdf(builder_data):
    """
    Ensure logo_config has fixed dimensions for table-based PDF letterhead.
    Mutates the builder in memory only (does not write to the database).
    """
    lg = dict(getattr(builder_data, "logo_config", None) or {})
    lg.setdefault("width", 120)
    lg.setdefault("height", 60)
    builder_data.logo_config = lg


def normalize_letter_section_fonts_for_pdf(builder_data):
    """Defaults for section-level font sizes (px) used by novo_offer_letter.html."""
    lf = dict(getattr(builder_data, "letter_section_fonts", None) or {})
    defaults = {
        "ref_date": 13,
        "candidate_meta": 14,
        "subject": 14,
        "salutation": 14,
        "footer_note": 9,
        "table_title": 13,
        "table_cell": 14,
        "signatory_name": 14,
        "signatory_line": 12,
    }
    for key, val in defaults.items():
        lf.setdefault(key, val)
    builder_data.letter_section_fonts = lf
