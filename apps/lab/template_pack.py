"""
Portable lab test template pack (JSON).

Export categories + tests + parameters without hospital/UUID IDs so packs can be
shared across hospitals. Import recreates/updates them on a target hospital.
"""
from __future__ import annotations

import json
from decimal import Decimal, InvalidOperation
from typing import Any

from django.db import transaction
from django.utils import timezone

from apps.lab.models import LabTest, LabTestCategory, LabTestParameter
from apps.shared.models import Hospital

PACK_FORMAT = "curevice.lab_templates"
PACK_VERSION = 2

# Must match LabTestSerializer / LabTest model fields used in the portal
TEST_FIELDS = (
    "name",
    "code",
    "unit",
    "reference_range",
    "price",
    "is_group_test",
    "procedure",
    "is_active",
    "sample_type",
    "method",
    "interpretation",
    "department_label",
)

PARAM_FIELDS = (
    "name",
    "code",
    "unit",
    "reference_range",
    "ref_low",
    "ref_high",
    "method",
    "section_title",
    "sort_order",
    "result_type",
)


def _dec(value):
    if value is None or value == "":
        return None
    if isinstance(value, Decimal):
        return value
    try:
        return Decimal(str(value))
    except (InvalidOperation, ValueError, TypeError):
        return None


def _json_safe(value):
    if isinstance(value, Decimal):
        return str(value)
    return value


def serialize_parameter(param: LabTestParameter) -> dict[str, Any]:
    row = {}
    for field in PARAM_FIELDS:
        val = getattr(param, field, None)
        if field in ("ref_low", "ref_high"):
            row[field] = _json_safe(val) if val is not None else None
        elif field == "sort_order":
            row[field] = int(val or 0)
        elif field == "result_type":
            row[field] = val or LabTestParameter.ResultType.NUMERIC
        else:
            row[field] = _json_safe(val if val is not None else "")
    return row


def serialize_test(test: LabTest) -> dict[str, Any]:
    data = {}
    for field in TEST_FIELDS:
        val = getattr(test, field, None)
        if field == "price":
            data[field] = _json_safe(val if val is not None else Decimal("0.00"))
        elif field in ("is_group_test", "is_active"):
            data[field] = bool(val) if val is not None else (field == "is_active")
        else:
            data[field] = _json_safe(val if val is not None else "")

    data["category_name"] = test.category.name if test.category_id else ""

    params = list(test.parameters.all().order_by("sort_order", "name"))
    if params:
        data["parameters"] = [serialize_parameter(p) for p in params]
    elif any(getattr(test, f, None) for f in ("unit", "reference_range", "method")):
        # Legacy single-row tests stored only on LabTest — preserve on export
        data["parameters"] = [{
            "name": test.name or "",
            "code": test.code or "",
            "unit": _json_safe(test.unit or ""),
            "reference_range": _json_safe(test.reference_range or ""),
            "ref_low": None,
            "ref_high": None,
            "method": _json_safe(test.method or ""),
            "section_title": "",
            "sort_order": 1,
            "result_type": LabTestParameter.ResultType.QUALITATIVE
            if not test.unit and test.reference_range
            else LabTestParameter.ResultType.NUMERIC,
        }]
    else:
        data["parameters"] = []

    return data


def export_tests_queryset(qs) -> dict[str, Any]:
    # Avoid order_by after a sliced queryset
    try:
        ordered = qs.select_related("category", "hospital").prefetch_related("parameters").order_by(
            "category__name", "name"
        )
        tests = list(ordered)
    except TypeError:
        tests = list(qs.select_related("category", "hospital").prefetch_related("parameters"))
        tests.sort(key=lambda t: ((t.category.name if t.category_id else ""), t.name or ""))
    hospitals = sorted({str(t.hospital_id) for t in tests if t.hospital_id})
    categories = sorted({
        (t.category.name if t.category_id else "General").strip() or "General"
        for t in tests
    })
    return {
        "format": PACK_FORMAT,
        "version": PACK_VERSION,
        "exported_at": timezone.now().isoformat(),
        "source_hospital_ids": hospitals,
        "categories": categories,
        "test_count": len(tests),
        "tests": [serialize_test(t) for t in tests],
    }


def export_hospital_templates(hospital: Hospital) -> dict[str, Any]:
    qs = LabTest.objects.filter(hospital=hospital)
    pack = export_tests_queryset(qs)
    pack["source_hospital_name"] = getattr(hospital, "name", "") or str(hospital.id)
    return pack


def dumps_pack(pack: dict[str, Any], *, indent: int = 2) -> str:
    return json.dumps(pack, indent=indent, ensure_ascii=False)


def loads_pack(raw: str | bytes) -> dict[str, Any]:
    if isinstance(raw, bytes):
        raw = raw.decode("utf-8-sig")
    data = json.loads(raw)
    if not isinstance(data, dict):
        raise ValueError("JSON root must be an object")
    if data.get("format") and data.get("format") != PACK_FORMAT:
        raise ValueError(f"Unsupported pack format: {data.get('format')}")
    tests = data.get("tests")
    if not isinstance(tests, list):
        raise ValueError("Pack must include a 'tests' array")
    return data


def _match_existing_test(hospital: Hospital, payload: dict[str, Any]) -> LabTest | None:
    code = (payload.get("code") or "").strip()
    name = (payload.get("name") or "").strip()
    qs = LabTest.objects.filter(hospital=hospital)
    if code:
        found = qs.filter(code__iexact=code).first()
        if found:
            return found
    if name:
        return qs.filter(name__iexact=name).first()
    return None


def _match_existing_param(test: LabTest, payload: dict[str, Any]) -> LabTestParameter | None:
    code = (payload.get("code") or "").strip()
    name = (payload.get("name") or "").strip()
    qs = LabTestParameter.objects.filter(test=test)
    if code:
        found = qs.filter(code__iexact=code).first()
        if found:
            return found
    if name:
        return qs.filter(name__iexact=name).first()
    return None


def _apply_test_fields(test: LabTest, payload: dict[str, Any]) -> None:
    for field in TEST_FIELDS:
        if field not in payload:
            continue
        value = payload[field]
        if field == "price":
            value = _dec(value) or Decimal("0.00")
        elif field == "is_group_test":
            value = bool(value)
        elif field == "is_active":
            value = True if value is None else bool(value)
        elif value is None:
            value = "" if field not in ("price",) else Decimal("0.00")
        setattr(test, field, value)


def _apply_param_fields(param: LabTestParameter, payload: dict[str, Any]) -> None:
    for field in PARAM_FIELDS:
        if field not in payload:
            continue
        value = payload[field]
        if field in ("ref_low", "ref_high"):
            value = _dec(value)
        elif field == "sort_order":
            try:
                value = int(value or 0)
            except (TypeError, ValueError):
                value = 0
        elif field == "result_type":
            allowed = {c.value for c in LabTestParameter.ResultType}
            value = value if value in allowed else LabTestParameter.ResultType.NUMERIC
        elif value is None:
            value = ""
        setattr(param, field, value)


@transaction.atomic
def import_templates_to_hospital(
    hospital: Hospital,
    pack: dict[str, Any],
    *,
    overwrite: bool = True,
    replace_parameters: bool = True,
) -> dict[str, int]:
    """
    Import a template pack into ``hospital``.

    - Matches existing tests by code (preferred) then name.
    - Creates missing categories by name.
    - If overwrite=False, skips existing tests.
    - If replace_parameters=True, syncs parameter rows for updated/created tests.
    """
    stats = {"created": 0, "updated": 0, "skipped": 0, "parameters_written": 0, "categories_created": 0}
    category_cache: dict[str, LabTestCategory] = {}

    def get_category(name: str) -> LabTestCategory:
        key = (name or "General").strip() or "General"
        if key in category_cache:
            return category_cache[key]
        cat = LabTestCategory.objects.filter(hospital=hospital, name__iexact=key).first()
        if not cat:
            cat = LabTestCategory.objects.create(hospital=hospital, name=key)
            stats["categories_created"] += 1
        category_cache[key] = cat
        return cat

    for raw in pack.get("tests") or []:
        if not isinstance(raw, dict):
            continue
        name = (raw.get("name") or "").strip()
        if not name:
            stats["skipped"] += 1
            continue

        existing = _match_existing_test(hospital, raw)
        if existing and not overwrite:
            stats["skipped"] += 1
            continue

        category = get_category(raw.get("category_name") or "General")
        if existing:
            test = existing
            test.category = category
            _apply_test_fields(test, raw)
            test.save()
            stats["updated"] += 1
        else:
            test = LabTest(hospital=hospital, category=category)
            _apply_test_fields(test, raw)
            if not test.name:
                test.name = name
            test.save()
            stats["created"] += 1

        params = raw.get("parameters") or []
        if not isinstance(params, list):
            params = []

        if replace_parameters:
            keep_ids = []
            for idx, prow in enumerate(params):
                if not isinstance(prow, dict):
                    continue
                pname = (prow.get("name") or "").strip()
                if not pname:
                    continue
                param = _match_existing_param(test, prow)
                if not param:
                    param = LabTestParameter(test=test)
                _apply_param_fields(param, prow)
                if not param.name:
                    param.name = pname
                if "sort_order" not in prow:
                    param.sort_order = idx + 1
                param.save()
                keep_ids.append(param.id)
                stats["parameters_written"] += 1
            # Drop params that were removed from the pack for this test
            LabTestParameter.objects.filter(test=test).exclude(id__in=keep_ids).delete()
        else:
            for idx, prow in enumerate(params):
                if not isinstance(prow, dict):
                    continue
                pname = (prow.get("name") or "").strip()
                if not pname:
                    continue
                if _match_existing_param(test, prow):
                    continue
                param = LabTestParameter(test=test)
                _apply_param_fields(param, prow)
                param.name = pname
                if "sort_order" not in prow:
                    param.sort_order = idx + 1
                param.save()
                stats["parameters_written"] += 1

    return stats
