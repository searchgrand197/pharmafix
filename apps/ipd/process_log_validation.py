from __future__ import annotations

from apps.settings_management.ipd_process_field_config import (
    BUILTIN_FIELD_IDS,
    builtin_storage_key,
    normalize_ipd_process_field_config,
    walk_process_fields,
)


def _is_custom_field(field: dict) -> bool:
    return not field.get("builtin") and field.get("type") not in ("builtin_vitals", "builtin_text")


def validate_custom_fields_against_config(custom_fields, config: dict) -> dict:
    if custom_fields in (None, ""):
        return {}
    if not isinstance(custom_fields, dict):
        raise ValueError("custom_fields must be an object.")
    normalized_config = normalize_ipd_process_field_config(config)
    allowed: dict[str, dict] = {}
    for field, _parent in walk_process_fields(normalized_config):
        if _is_custom_field(field):
            allowed[field["id"]] = field
    out = {}
    for key, raw_val in custom_fields.items():
        fid = str(key).strip()
        if fid not in allowed:
            continue
        field_def = allowed[fid]
        out[fid] = _coerce_custom_value(field_def, raw_val)
    return out


def _coerce_custom_value(field_def: dict, raw_val):
    ftype = field_def.get("type")
    if ftype == "text":
        return str(raw_val or "").strip()
    if ftype == "number":
        if raw_val in (None, ""):
            return None
        try:
            num = float(raw_val)
        except (TypeError, ValueError):
            raise ValueError(f"Invalid number for {field_def.get('label')}.")
        if field_def.get("number_mode") == "integer":
            num = int(num)
        return num
    if ftype == "boolean":
        if isinstance(raw_val, bool):
            return raw_val
        s = str(raw_val).strip().lower()
        if s in ("true", "1", "yes"):
            return True
        if s in ("false", "0", "no"):
            return False
        return None
    if ftype == "datetime":
        return str(raw_val or "").strip() or None
    if ftype == "user":
        if not isinstance(raw_val, dict):
            return {"name": "", "phone": "", "email": ""}
        return {
            "name": str(raw_val.get("name") or "").strip(),
            "phone": str(raw_val.get("phone") or "").strip(),
            "email": str(raw_val.get("email") or "").strip(),
        }
    if ftype == "choices":
        mode = field_def.get("choice_mode", "single")
        opts = set(field_def.get("options") or [])
        if mode == "multi":
            if not isinstance(raw_val, list):
                return []
            return [str(v).strip() for v in raw_val if str(v).strip() in opts]
        val = str(raw_val or "").strip()
        return val if val in opts else ""
    return raw_val


def extract_builtin_payload_from_data(data: dict, config: dict) -> dict:
    """Map incoming flat payload to built-in column keys."""
    normalized_config = normalize_ipd_process_field_config(config)
    payload = {}
    if "vitals" in data:
        payload["vitals"] = data.get("vitals") or {}
    if "custom_fields" in data:
        payload["custom_fields"] = data.get("custom_fields") or {}
    for field, _parent in walk_process_fields(normalized_config):
        if field.get("id") not in BUILTIN_FIELD_IDS:
            continue
        if field.get("type") == "builtin_vitals" and "vitals" not in data:
            continue
        storage = builtin_storage_key(field)
        if storage and storage in data:
            payload[storage] = data.get(storage) or ""
    return payload


def format_field_value_for_timeline(field_def: dict, value) -> str:
    if value is None or value == "" or value == {} or value == []:
        return ""
    ftype = field_def.get("type")
    label = field_def.get("label") or field_def.get("id")
    if ftype == "boolean":
        if value is True:
            return f"{label}: {field_def.get('true_label', 'Yes')}"
        if value is False:
            return f"{label}: {field_def.get('false_label', 'No')}"
        return ""
    if ftype == "user" and isinstance(value, dict):
        bits = [value.get("name"), value.get("phone"), value.get("email")]
        bits = [str(b).strip() for b in bits if str(b or "").strip()]
        return f"{label}: {', '.join(bits)}" if bits else ""
    if ftype == "choices" and isinstance(value, list):
        return f"{label}: {', '.join(value)}" if value else ""
    return f"{label}: {value}"
