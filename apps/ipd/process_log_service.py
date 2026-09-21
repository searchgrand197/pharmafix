from __future__ import annotations

from datetime import datetime

from django.utils import timezone

from apps.ipd.models import IPDAdmission, IPDDailyProcessLog
from apps.ipd.process_log_validation import (
    format_field_value_for_timeline,
    validate_custom_fields_against_config,
)
from apps.settings_management.ipd_process_field_config import (
    DEFAULT_TEMPLATE_ID,
    builtin_storage_key,
    get_default_template_id,
    get_hospital_process_templates,
    get_template_by_id,
    get_template_config,
    normalize_ipd_process_field_config,
    walk_process_fields,
)
from apps.treatment.models import PatientTimeline
from apps.treatment.services import create_patient_timeline_event


def compute_process_day_number(admission: IPDAdmission, log_date) -> int:
    delta = (log_date - admission.admission_date).days
    return max(delta + 1, 1)


def get_process_config_for_log(log: IPDDailyProcessLog) -> dict:
    snapshot = getattr(log, "process_field_config", None) or {}
    if isinstance(snapshot, dict) and snapshot.get("fields"):
        return normalize_ipd_process_field_config(snapshot)
    templates = get_hospital_process_templates(log.hospital_id)
    template_id = getattr(log, "process_template_id", None) or get_default_template_id(templates)
    return get_template_config(templates, template_id)


def resolve_process_config_for_save(
    *,
    hospital_id,
    process_template_id: str | None,
    existing: IPDDailyProcessLog | None = None,
) -> tuple[str, dict]:
    templates = get_hospital_process_templates(hospital_id)
    template_id = str(process_template_id or "").strip()
    if not template_id and existing:
        template_id = str(existing.process_template_id or "").strip()
    if not template_id:
        template_id = get_default_template_id(templates)
    if not get_template_by_id(templates, template_id):
        template_id = get_default_template_id(templates)
    config = get_template_config(templates, template_id)
    return template_id, normalize_ipd_process_field_config(config)


def _process_log_timeline_description(log: IPDDailyProcessLog, config: dict | None = None) -> str:
    config = config or get_process_config_for_log(log)
    parts = []
    for field, _parent in walk_process_fields(config):
        if not field.get("enabled", True):
            continue
        fid = field.get("id")
        ftype = field.get("type")
        if ftype == "builtin_vitals":
            vitals = log.vitals or {}
            vital_bits = []
            for key, label in (
                ("bp", "BP"),
                ("pulse", "Pulse"),
                ("spo2", "SpO2"),
                ("temp", "Temp"),
                ("weight", "Weight"),
                ("rbs", "RBS"),
            ):
                val = str(vitals.get(key) or "").strip()
                if val:
                    vital_bits.append(f"{label}: {val}")
            if vital_bits:
                parts.append(f"{field.get('label', 'Vitals')} — " + ", ".join(vital_bits))
            continue
        if ftype == "builtin_text":
            storage = builtin_storage_key(field) or ""
            val = str(getattr(log, storage, "") or "").strip()
            if val:
                parts.append(f"{field.get('label', storage)} — {val}")
            continue
        if ftype == "group":
            continue
        custom = log.custom_fields or {}
        val = custom.get(fid)
        line = format_field_value_for_timeline(field, val)
        if line:
            parts.append(line)
    return "\n".join(parts)


def upsert_process_log_timeline_event(*, log: IPDDailyProcessLog, created_by=None, is_update: bool = False) -> None:
    day_label = f"Day {log.day_number}" if log.day_number else str(log.log_date)
    title = f"IPD Process {day_label} ({log.log_date})"
    if is_update:
        title = f"IPD Process updated — {day_label} ({log.log_date})"
    description = _process_log_timeline_description(log, get_process_config_for_log(log))
    ts = timezone.make_aware(
        datetime.combine(log.log_date, datetime.min.time()),
        timezone.get_current_timezone(),
    )
    admission = log.admission
    existing = PatientTimeline.objects.filter(
        ipd_process_log_id=log.id,
        event_type=PatientTimeline.EventType.PROCESS_LOG_SAVED,
    ).first()
    if existing:
        existing.title = title
        existing.description = description
        existing.timestamp = ts
        existing.created_by = created_by or existing.created_by
        existing.save(update_fields=["title", "description", "timestamp", "created_by", "updated_at"])
        return
    create_patient_timeline_event(
        patient=admission.patient,
        hospital_id=admission.hospital_id,
        ipd_admission=admission,
        event_type=PatientTimeline.EventType.PROCESS_LOG_SAVED,
        title=title,
        description=description,
        timestamp=ts,
        created_by=created_by,
        ipd_process_log=log,
    )


def save_ipd_process_log(
    *,
    admission: IPDAdmission,
    log_date,
    data: dict,
    user,
    existing: IPDDailyProcessLog | None = None,
    process_template_id: str | None = None,
    process_config: dict | None = None,
) -> IPDDailyProcessLog:
    template_id, config = resolve_process_config_for_save(
        hospital_id=admission.hospital_id,
        process_template_id=process_template_id or data.get("process_template_id"),
        existing=existing,
    )
    if process_config:
        config = normalize_ipd_process_field_config(process_config)
    day_number = compute_process_day_number(admission, log_date)

    validated_custom = validate_custom_fields_against_config(
        data.get("custom_fields") if "custom_fields" in data else (existing.custom_fields if existing else {}),
        config,
    )

    patch: dict = {
        "hospital_id": admission.hospital_id,
        "day_number": day_number,
        "recorded_by": user,
        "process_template_id": template_id or DEFAULT_TEMPLATE_ID,
        "process_field_config": config,
    }

    if existing is None:
        patch.update({
            "vitals": data.get("vitals") or {},
            "medication_procedure_notes": data.get("medication_procedure_notes") or "",
            "completed_notes": data.get("completed_notes") or "",
            "pending_notes": data.get("pending_notes") or "",
            "general_notes": data.get("general_notes") or "",
            "custom_fields": validated_custom,
        })
        log = IPDDailyProcessLog.objects.create(
            admission=admission,
            log_date=log_date,
            **patch,
        )
    else:
        if "vitals" in data:
            patch["vitals"] = data.get("vitals") or {}
        if "medication_procedure_notes" in data:
            patch["medication_procedure_notes"] = data.get("medication_procedure_notes") or ""
        if "completed_notes" in data:
            patch["completed_notes"] = data.get("completed_notes") or ""
        if "pending_notes" in data:
            patch["pending_notes"] = data.get("pending_notes") or ""
        if "general_notes" in data:
            patch["general_notes"] = data.get("general_notes") or ""
        if "custom_fields" in data:
            patch["custom_fields"] = validated_custom
        for key, val in patch.items():
            setattr(existing, key, val)
        existing.save()
        log = existing

    upsert_process_log_timeline_event(log=log, created_by=user, is_update=existing is not None)
    return log
