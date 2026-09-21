"""IPD Process form builder field definitions (mirrored on the frontend)."""

from __future__ import annotations

import re
import uuid
from copy import deepcopy

BUILTIN_FIELD_IDS = frozenset({"vitals", "medications", "completed", "pending", "notes"})

BUILTIN_STORAGE_BY_ID = {
    "medications": "medication_procedure_notes",
    "completed": "completed_notes",
    "pending": "pending_notes",
    "notes": "general_notes",
}

CUSTOM_FIELD_TYPES = frozenset({
    "group",
    "text",
    "number",
    "boolean",
    "datetime",
    "user",
    "choices",
})

BUILTIN_FIELD_TYPES = frozenset({"builtin_vitals", "builtin_text"})

ALL_FIELD_TYPES = CUSTOM_FIELD_TYPES | BUILTIN_FIELD_TYPES

COL_SPAN_OPTIONS = frozenset({3, 4, 6, 8, 12})

MAX_CUSTOM_FIELDS = 30
MAX_NESTING_DEPTH = 2
MIN_HEIGHT_PX = 32
MAX_HEIGHT_PX = 400
MAX_TEMPLATES = 20
DEFAULT_TEMPLATE_ID = "default"


def _default_layout(field_type: str, *, multiline: bool = False) -> dict:
    if field_type == "builtin_vitals":
        return {"col_span": 12, "min_height_px": 120}
    if field_type == "builtin_text" or field_type == "group":
        return {"col_span": 12, "min_height_px": 120 if multiline or field_type == "group" else 96}
    if field_type == "text":
        return {"col_span": 12, "min_height_px": 96 if multiline else 40}
    if field_type == "choices":
        return {"col_span": 12, "min_height_px": 80}
    if field_type == "user":
        return {"col_span": 12, "min_height_px": 100}
    return {"col_span": 12, "min_height_px": 40}


def default_ipd_process_field_config() -> dict:
    return {
        "version": 1,
        "fields": [
            {
                "id": "vitals",
                "builtin": True,
                "enabled": True,
                "label": "Vitals",
                "type": "builtin_vitals",
                "order": 0,
                "layout": _default_layout("builtin_vitals"),
            },
            {
                "id": "medications",
                "builtin": True,
                "enabled": True,
                "label": "Medications / Procedures",
                "type": "builtin_text",
                "storage": "medication_procedure_notes",
                "multiline": True,
                "order": 1,
                "layout": _default_layout("builtin_text", multiline=True),
            },
            {
                "id": "completed",
                "builtin": True,
                "enabled": True,
                "label": "Done Today",
                "type": "builtin_text",
                "storage": "completed_notes",
                "multiline": True,
                "order": 2,
                "layout": _default_layout("builtin_text", multiline=True),
            },
            {
                "id": "pending",
                "builtin": True,
                "enabled": True,
                "label": "Pending / Left To Do",
                "type": "builtin_text",
                "storage": "pending_notes",
                "multiline": True,
                "order": 3,
                "layout": _default_layout("builtin_text", multiline=True),
            },
            {
                "id": "notes",
                "builtin": True,
                "enabled": True,
                "label": "Notes",
                "type": "builtin_text",
                "storage": "general_notes",
                "multiline": True,
                "order": 4,
                "layout": _default_layout("builtin_text", multiline=True),
            },
        ],
    }


def _slugify_id(label: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "_", str(label or "").strip().lower()).strip("_")
    return slug[:40] or "field"


def _normalize_layout(raw: dict | None, field_type: str, multiline: bool = False) -> dict:
    base = _default_layout(field_type, multiline=multiline)
    if not isinstance(raw, dict):
        return base
    col = raw.get("col_span", base["col_span"])
    try:
        col = int(col)
    except (TypeError, ValueError):
        col = base["col_span"]
    if col not in COL_SPAN_OPTIONS:
        col = base["col_span"]
    try:
        h = int(raw.get("min_height_px", base["min_height_px"]))
    except (TypeError, ValueError):
        h = base["min_height_px"]
    h = max(MIN_HEIGHT_PX, min(MAX_HEIGHT_PX, h))
    return {"col_span": col, "min_height_px": h}


def _normalize_field(raw: dict, *, depth: int = 0) -> dict | None:
    if not isinstance(raw, dict):
        return None
    field_id = str(raw.get("id") or "").strip()
    if not field_id:
        return None
    field_type = str(raw.get("type") or "").strip()
    if field_type not in ALL_FIELD_TYPES:
        return None
    is_builtin = field_id in BUILTIN_FIELD_IDS
    if is_builtin and field_type not in BUILTIN_FIELD_TYPES:
        return None
    if not is_builtin and field_type in BUILTIN_FIELD_TYPES:
        return None
    if is_builtin and field_id in BUILTIN_STORAGE_BY_ID and field_type == "builtin_text":
        storage = BUILTIN_STORAGE_BY_ID[field_id]
    else:
        storage = str(raw.get("storage") or "").strip() or None

    label = str(raw.get("label") or field_id).strip()[:120] or field_id
    multiline = bool(raw.get("multiline", field_type in ("builtin_text", "text")))
    out: dict = {
        "id": field_id,
        "builtin": is_builtin,
        "enabled": bool(raw.get("enabled", True)),
        "label": label,
        "type": field_type,
        "order": int(raw.get("order", 0)) if str(raw.get("order", "")).isdigit() else 0,
        "layout": _normalize_layout(raw.get("layout"), field_type, multiline=multiline),
    }
    if storage:
        out["storage"] = storage
    if multiline:
        out["multiline"] = True
    if field_type == "text":
        out["placeholder"] = str(raw.get("placeholder") or "").strip()[:200]
    if field_type == "number":
        mode = str(raw.get("number_mode") or "integer").strip()
        out["number_mode"] = "decimal" if mode == "decimal" else "integer"
        for key in ("min", "max"):
            if raw.get(key) is not None and str(raw.get(key)).strip() != "":
                try:
                    out[key] = float(raw[key])
                except (TypeError, ValueError):
                    pass
    if field_type == "boolean":
        out["true_label"] = str(raw.get("true_label") or "Yes").strip()[:40] or "Yes"
        out["false_label"] = str(raw.get("false_label") or "No").strip()[:40] or "No"
    if field_type == "datetime":
        mode = str(raw.get("datetime_mode") or "date").strip()
        out["datetime_mode"] = mode if mode in ("date", "time", "datetime") else "date"
    if field_type == "user":
        out["show_name"] = bool(raw.get("show_name", True))
        out["show_phone"] = bool(raw.get("show_phone", True))
        out["show_email"] = bool(raw.get("show_email", True))
    if field_type == "choices":
        mode = str(raw.get("choice_mode") or "single").strip()
        out["choice_mode"] = "multi" if mode == "multi" else "single"
        opts = raw.get("options") or []
        if isinstance(opts, list):
            out["options"] = [str(o).strip()[:80] for o in opts if str(o).strip()][:20]
        else:
            out["options"] = []
    if field_type == "group" and depth < MAX_NESTING_DEPTH:
        children_raw = raw.get("children") or []
        children = []
        if isinstance(children_raw, list):
            for idx, child in enumerate(children_raw):
                normalized = _normalize_field(child, depth=depth + 1)
                if normalized:
                    normalized["order"] = idx
                    children.append(normalized)
        out["children"] = children
    elif field_type == "group":
        out["children"] = []
    return out


def _merge_builtin_fields(fields: list[dict], *, fill_missing: bool = False) -> list[dict]:
    defaults = default_ipd_process_field_config()["fields"]
    seen: set[str] = set()
    merged: list[dict] = []
    for field in fields:
        fid = field.get("id")
        if not fid or fid in seen:
            continue
        merged.append(field)
        seen.add(fid)
    if fill_missing:
        for default in defaults:
            if default["id"] not in seen:
                merged.append(deepcopy(default))
                seen.add(default["id"])
    for idx, field in enumerate(merged):
        field["order"] = idx
    return merged


def normalize_ipd_process_field_config(value) -> dict:
    if value in (None, ""):
        return default_ipd_process_field_config()
    if not isinstance(value, dict):
        return default_ipd_process_field_config()
    fields_raw = value.get("fields")
    if not isinstance(fields_raw, list) or len(fields_raw) == 0:
        return default_ipd_process_field_config()
    fields = []
    seen_ids: set[str] = set()
    for raw in fields_raw:
        normalized = _normalize_field(raw, depth=0)
        if not normalized:
            continue
        if normalized["id"] in seen_ids:
            continue
        if not normalized["builtin"] and normalized["id"] in BUILTIN_FIELD_IDS:
            continue
        seen_ids.add(normalized["id"])
        fields.append(normalized)
    fields = _merge_builtin_fields(fields, fill_missing=False)
    custom_count = _count_custom_fields(fields)
    if custom_count > MAX_CUSTOM_FIELDS:
        fields = _trim_custom_fields(fields, MAX_CUSTOM_FIELDS)
    return {"version": 1, "fields": fields}


def _count_custom_fields(fields: list[dict]) -> int:
    count = 0
    for field in fields:
        if not field.get("builtin"):
            count += 1
        if field.get("type") == "group":
            for child in field.get("children") or []:
                if not child.get("builtin"):
                    count += 1
    return count


def _trim_custom_fields(fields: list[dict], limit: int) -> list[dict]:
    count = 0
    out = []
    for field in fields:
        if field.get("builtin"):
            if field.get("type") == "group":
                children = []
                for child in field.get("children") or []:
                    if child.get("builtin"):
                        children.append(child)
                    elif count < limit:
                        children.append(child)
                        count += 1
                field = {**field, "children": children}
            out.append(field)
        elif count < limit:
            if field.get("type") == "group":
                children = []
                for child in field.get("children") or []:
                    if count < limit:
                        children.append(child)
                        if not child.get("builtin"):
                            count += 1
                field = {**field, "children": children}
            out.append(field)
            count += 1
    return out


def walk_process_fields(config: dict):
    """Yield (field, parent) for all fields in tree."""
    fields = (config or {}).get("fields") or []
    for field in fields:
        yield field, None
        if field.get("type") == "group":
            for child in field.get("children") or []:
                yield child, field


def builtin_storage_key(field: dict) -> str | None:
    if field.get("type") != "builtin_text":
        return None
    return field.get("storage") or BUILTIN_STORAGE_BY_ID.get(field.get("id"))


def default_ipd_process_templates() -> dict:
    return {
        "version": 2,
        "default_template_id": DEFAULT_TEMPLATE_ID,
        "templates": [
            {
                "id": DEFAULT_TEMPLATE_ID,
                "name": "Standard",
                "config": default_ipd_process_field_config(),
            },
        ],
    }


def make_template_id() -> str:
    return f"tpl_{uuid.uuid4().hex[:12]}"


def _is_v2_templates(value: dict) -> bool:
    return (
        isinstance(value, dict)
        and int(value.get("version") or 0) == 2
        and isinstance(value.get("templates"), list)
    )


def normalize_ipd_process_templates(value) -> dict:
    if value in (None, ""):
        return default_ipd_process_templates()
    if not isinstance(value, dict):
        return default_ipd_process_templates()

    if _is_v2_templates(value):
        templates_raw = value.get("templates") or []
        templates: list[dict] = []
        seen_ids: set[str] = set()
        for raw in templates_raw:
            if not isinstance(raw, dict):
                continue
            tid = str(raw.get("id") or "").strip()[:64]
            if not tid or tid in seen_ids:
                continue
            name = str(raw.get("name") or tid).strip()[:80] or tid
            config = normalize_ipd_process_field_config(raw.get("config"))
            templates.append({"id": tid, "name": name, "config": config})
            seen_ids.add(tid)
        if not templates:
            return default_ipd_process_templates()
        if len(templates) > MAX_TEMPLATES:
            templates = templates[:MAX_TEMPLATES]
        default_id = str(value.get("default_template_id") or DEFAULT_TEMPLATE_ID).strip()
        if default_id not in seen_ids:
            default_id = templates[0]["id"]
        return {
            "version": 2,
            "default_template_id": default_id,
            "templates": templates,
        }

    fields_raw = value.get("fields")
    if isinstance(fields_raw, list) and len(fields_raw) > 0:
        return {
            "version": 2,
            "default_template_id": DEFAULT_TEMPLATE_ID,
            "templates": [
                {
                    "id": DEFAULT_TEMPLATE_ID,
                    "name": "Standard",
                    "config": normalize_ipd_process_field_config(value),
                },
            ],
        }

    return default_ipd_process_templates()


def get_default_template_id(templates_root: dict) -> str:
    root = normalize_ipd_process_templates(templates_root)
    return root.get("default_template_id") or DEFAULT_TEMPLATE_ID


def get_template_by_id(templates_root: dict, template_id: str | None) -> dict | None:
    root = normalize_ipd_process_templates(templates_root)
    tid = str(template_id or "").strip()
    for tpl in root.get("templates") or []:
        if tpl.get("id") == tid:
            return tpl
    default_id = get_default_template_id(root)
    for tpl in root.get("templates") or []:
        if tpl.get("id") == default_id:
            return tpl
    templates = root.get("templates") or []
    return templates[0] if templates else None


def get_template_config(templates_root: dict, template_id: str | None) -> dict:
    tpl = get_template_by_id(templates_root, template_id)
    if not tpl:
        return default_ipd_process_field_config()
    return normalize_ipd_process_field_config(tpl.get("config"))


def get_template_name(templates_root: dict, template_id: str | None) -> str:
    tpl = get_template_by_id(templates_root, template_id)
    return str(tpl.get("name") or template_id or "Standard") if tpl else "Standard"


def get_hospital_process_templates(hospital_id):
    from apps.settings_management.models import ReceptionPortalSettings

    settings = ReceptionPortalSettings.objects.filter(hospital_id=hospital_id).first()
    raw = settings.ipd_process_field_config if settings else {}
    return normalize_ipd_process_templates(raw)


def get_hospital_process_config(hospital_id, template_id: str | None = None) -> dict:
    templates = get_hospital_process_templates(hospital_id)
    tid = template_id or get_default_template_id(templates)
    return get_template_config(templates, tid)
