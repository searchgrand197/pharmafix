"""Configurable document number formats for reception portal settings."""

from __future__ import annotations

from typing import Any

from apps.settings_management.models import ReceptionPortalSettings
from apps.shared.models import Hospital

DEFAULT_DOCUMENT_NUMBER_PARTS: dict[str, dict[str, Any]] = {
    "uhid": {
        "kind": "",
        "prefix": "",
        "use_hospital_prefix": True,
        "use_invoice_prefix": False,
        "include_year": False,
        "include_slug": False,
        "separator": "-",
        "seq_padding": 4,
    },
    "opd": {
        "kind": "OPD",
        "prefix": "",
        "use_hospital_prefix": True,
        "use_invoice_prefix": False,
        "include_year": True,
        "include_slug": False,
        "separator": "-",
        "seq_padding": 0,
    },
    "ipd": {
        "kind": "IPD",
        "prefix": "",
        "use_hospital_prefix": True,
        "use_invoice_prefix": False,
        "include_year": True,
        "include_slug": False,
        "separator": "-",
        "seq_padding": 0,
    },
    "payment_slip": {
        "kind": "PSL",
        "prefix": "",
        "use_hospital_prefix": True,
        "use_invoice_prefix": False,
        "include_year": True,
        "include_slug": False,
        "separator": "-",
        "seq_padding": 0,
    },
    "expense_voucher": {
        "kind": "EXP",
        "prefix": "",
        "use_hospital_prefix": True,
        "use_invoice_prefix": False,
        "include_year": True,
        "include_slug": False,
        "separator": "-",
        "seq_padding": 0,
    },
    "receipt": {
        "kind": "",
        "prefix": "",
        "use_hospital_prefix": False,
        "use_invoice_prefix": True,
        "include_year": False,
        "include_slug": False,
        "separator": "",
        "seq_padding": 0,
    },
    "ipd_advance": {
        "kind": "IPDADV",
        "prefix": "",
        "use_hospital_prefix": False,
        "use_invoice_prefix": False,
        "include_year": True,
        "include_slug": True,
        "separator": "-",
        "seq_padding": 4,
    },
    "ipd_service": {
        "kind": "IPDSRV",
        "prefix": "",
        "use_hospital_prefix": False,
        "use_invoice_prefix": False,
        "include_year": True,
        "include_slug": True,
        "separator": "-",
        "seq_padding": 4,
    },
    "ipd_refund": {
        "kind": "IPDREF",
        "prefix": "",
        "use_hospital_prefix": False,
        "use_invoice_prefix": False,
        "include_year": True,
        "include_slug": True,
        "separator": "-",
        "seq_padding": 4,
    },
    "ipd_room": {
        "kind": "IPDROOM",
        "prefix": "",
        "use_hospital_prefix": False,
        "use_invoice_prefix": False,
        "include_year": True,
        "include_slug": True,
        "separator": "-",
        "seq_padding": 4,
    },
    "ipd_final_bill": {
        "kind": "IPDFIN",
        "prefix": "IPD",
        "use_hospital_prefix": True,
        "use_invoice_prefix": False,
        "include_year": True,
        "include_slug": False,
        "separator": "-",
        "seq_padding": 0,
    },
    "opd_payment_slip": {
        "kind": "OPDPS",
        "prefix": "",
        "use_hospital_prefix": True,
        "use_invoice_prefix": False,
        "include_year": True,
        "include_slug": False,
        "separator": "-",
        "seq_padding": 0,
    },
}

DEFAULT_DOCUMENT_NUMBER_FORMATS = DEFAULT_DOCUMENT_NUMBER_PARTS

DOCUMENT_TYPE_LABELS = {
    "uhid": "UHID",
    "opd": "OPD Number",
    "ipd": "IPD Number",
    "payment_slip": "Payment Slip",
    "expense_voucher": "Expense Voucher",
    "receipt": "Receipt / Invoice",
    "ipd_advance": "IPD Advance Slip",
    "ipd_service": "IPD Service Charge",
    "ipd_refund": "IPD Discharge Refund",
    "ipd_room": "IPD Room Charge",
    "ipd_final_bill": "IPD Final Bill",
    "opd_payment_slip": "OPD Payment Slip",
}

MAX_LENGTH_BY_DOC_TYPE = {
    "uhid": 40,
    "opd": 50,
    "ipd": 50,
    "payment_slip": 80,
    "expense_voucher": 80,
    "receipt": 60,
    "ipd_advance": 60,
    "ipd_service": 60,
    "ipd_refund": 60,
    "ipd_room": 60,
    "ipd_final_bill": 80,
    "opd_payment_slip": 80,
}


def _coerce_bool(value: Any, fallback: bool = False) -> bool:
    if isinstance(value, bool):
        return value
    if value in (1, "1", "true", "True", "yes", "on"):
        return True
    if value in (0, "0", "false", "False", "no", "off"):
        return False
    return fallback


def _coerce_padding(value: Any, fallback: int = 0) -> int:
    try:
        num = int(value)
    except (TypeError, ValueError):
        return fallback
    return max(0, min(num, 8))


def _template_to_parts(template: str, legacy_kind: str = "") -> dict[str, Any]:
    cleaned = str(template or "").strip()
    parts: dict[str, Any] = {
        "kind": str(legacy_kind or "").strip().upper(),
        "prefix": "",
        "use_hospital_prefix": False,
        "use_invoice_prefix": False,
        "include_year": False,
        "include_slug": False,
        "separator": "-",
        "seq_padding": 0,
    }
    if not cleaned:
        return parts

    if "{PREFIX}" in cleaned and "{KIND}" not in cleaned and "{SEQ:06d}" in cleaned:
        parts["use_invoice_prefix"] = True
        parts["include_year"] = "{YEAR}" in cleaned
        parts["separator"] = "-" if "-{YEAR}" in cleaned or "-{SEQ" in cleaned else ""
        parts["seq_padding"] = 6 if "{SEQ:06d}" in cleaned else 0
        return parts

    parts["use_hospital_prefix"] = "{PREFIX}" in cleaned
    parts["include_year"] = "{YEAR}" in cleaned
    parts["include_slug"] = "{SLUG}" in cleaned
    if "{SEQ:04d}" in cleaned:
        parts["seq_padding"] = 4
    elif "{SEQ:06d}" in cleaned:
        parts["seq_padding"] = 6
    parts["separator"] = "-" if "-" in cleaned else ""
    return parts


def normalize_document_number_formats(raw: Any) -> dict[str, dict[str, Any]]:
    merged: dict[str, dict[str, Any]] = {}
    source = raw if isinstance(raw, dict) else {}
    for doc_type, defaults in DEFAULT_DOCUMENT_NUMBER_PARTS.items():
        row = source.get(doc_type) if isinstance(source.get(doc_type), dict) else {}
        if row.get("template"):
            parts = _template_to_parts(str(row.get("template") or ""), str(row.get("kind") or defaults.get("kind") or ""))
        else:
            parts = {
                "kind": str(row.get("kind", defaults.get("kind", "")) or "").strip().upper(),
                "prefix": str(row.get("prefix", defaults.get("prefix", "")) or "").strip().upper(),
                "use_hospital_prefix": _coerce_bool(row.get("use_hospital_prefix"), defaults["use_hospital_prefix"]),
                "use_invoice_prefix": _coerce_bool(row.get("use_invoice_prefix"), defaults["use_invoice_prefix"]),
                "include_year": _coerce_bool(row.get("include_year"), defaults["include_year"]),
                "include_slug": _coerce_bool(row.get("include_slug"), defaults["include_slug"]),
                "separator": str(row.get("separator") if row.get("separator") is not None else defaults["separator"]),
                "seq_padding": _coerce_padding(row.get("seq_padding"), defaults["seq_padding"]),
            }
        merged[doc_type] = parts
    return merged


def _format_sequence(seq: int, padding: int) -> str:
    pad = _coerce_padding(padding, 0)
    if pad > 0:
        return f"{int(seq):0{pad}d}"
    return str(int(seq))


def build_document_number_from_parts(
    doc_type: str,
    parts: dict[str, Any],
    *,
    uhid_prefix: str,
    invoice_prefix: str,
    slug: str,
    year: int,
    seq: int,
) -> str:
    segments: list[str] = []

    kind = str(parts.get("kind") or "").strip().upper()
    if kind:
        segments.append(kind)

    custom_prefix = str(parts.get("prefix") or "").strip().upper()
    if custom_prefix:
        segments.append(custom_prefix)

    if _coerce_bool(parts.get("use_hospital_prefix")) and uhid_prefix:
        segments.append(str(uhid_prefix).strip().upper())
    if _coerce_bool(parts.get("use_invoice_prefix")) and invoice_prefix:
        segments.append(str(invoice_prefix).strip().upper())
    if _coerce_bool(parts.get("include_slug")) and slug:
        segments.append(str(slug).strip().upper())
    if _coerce_bool(parts.get("include_year")):
        segments.append(str(int(year)))

    segments.append(_format_sequence(seq, parts.get("seq_padding", 0)))

    separator = parts.get("separator")
    separator = "" if separator is None else str(separator)
    return separator.join(segments) if separator != "" else "".join(segments)


def validate_document_number_parts(doc_type: str, parts: dict[str, Any]) -> None:
    sample = build_document_number_from_parts(
        doc_type,
        parts,
        uhid_prefix="VAR",
        invoice_prefix="INV",
        slug="VARD",
        year=2026,
        seq=42,
    )
    if not sample:
        raise ValueError("At least one segment is required.")
    max_len = MAX_LENGTH_BY_DOC_TYPE.get(doc_type, 80)
    if len(sample) > max_len:
        raise ValueError(f"Rendered sample exceeds {max_len} characters.")


def validate_document_number_formats(raw: Any) -> dict[str, dict[str, Any]]:
    normalized = normalize_document_number_formats(raw)
    errors: list[str] = []
    for doc_type, row in normalized.items():
        try:
            validate_document_number_parts(doc_type, row)
        except ValueError as exc:
            label = DOCUMENT_TYPE_LABELS.get(doc_type, doc_type)
            errors.append(f"{label}: {exc}")
    if errors:
        raise ValueError("; ".join(errors))
    return normalized


def _resolve_uhid_prefix(settings: ReceptionPortalSettings | None, hospital: Hospital) -> str:
    raw = getattr(settings, "uhid_prefix", None) if settings else None
    prefix = str(raw or "").strip().upper()
    if prefix:
        return prefix[:8]
    slug_prefix = (hospital.slug or "").upper()[:3]
    return slug_prefix or "DEF"


def _resolve_invoice_prefix(settings: ReceptionPortalSettings | None) -> str:
    raw = getattr(settings, "invoice_prefix", None) if settings else None
    prefix = str(raw or "").strip().upper()
    return prefix[:20] if prefix else "INV"


def _resolve_slug(hospital: Hospital) -> str:
    return (hospital.slug or hospital.name or "HOSP")[:5].upper()


def _get_settings(hospital: Hospital) -> ReceptionPortalSettings | None:
    settings = getattr(hospital, "reception_portal_settings", None)
    if settings is None:
        settings = (
            ReceptionPortalSettings.objects.filter(hospital=hospital)
            .only("uhid_prefix", "invoice_prefix", "document_number_formats")
            .first()
        )
    return settings


def get_format_config(hospital: Hospital, doc_type: str) -> dict[str, Any]:
    defaults = DEFAULT_DOCUMENT_NUMBER_PARTS.get(doc_type, {})
    settings = _get_settings(hospital)
    formats = normalize_document_number_formats(
        getattr(settings, "document_number_formats", None) if settings else None
    )
    return formats.get(doc_type) or defaults


def render_document_number(hospital: Hospital, doc_type: str, year: int, seq: int) -> str:
    settings = _get_settings(hospital)
    config = get_format_config(hospital, doc_type)
    return build_document_number_from_parts(
        doc_type,
        config,
        uhid_prefix=_resolve_uhid_prefix(settings, hospital),
        invoice_prefix=_resolve_invoice_prefix(settings),
        slug=_resolve_slug(hospital),
        year=year,
        seq=seq,
    )
