import json
from rest_framework import serializers
from django.contrib.auth import get_user_model
import re

from apps.settings_management.models import LeaveApprover, ReceptionPortalSettings
from apps.settings_management.document_number_service import (
    normalize_document_number_formats,
    validate_document_number_formats,
)
from apps.settings_management.opd_field_catalog import (
    OPD_CORE_FIELD_KEYS,
    normalize_opd_field_config,
)
from apps.settings_management.ipd_process_field_config import normalize_ipd_process_field_config, normalize_ipd_process_templates

OPD_FORM_VISIBLE_FIELD_KEYS = frozenset(OPD_CORE_FIELD_KEYS)


class LeaveApproverSerializer(serializers.ModelSerializer):
    user_email = serializers.EmailField(source="user.email", read_only=True)
    user_name = serializers.SerializerMethodField()
    hospital_name = serializers.CharField(source="hospital.name", read_only=True)

    class Meta:
        model = LeaveApprover
        fields = [
            "id",
            "hospital",
            "hospital_name",
            "user",
            "user_email",
            "user_name",
            "is_active",
            "notes",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "created_at", "updated_at"]

    def get_user_name(self, obj) -> str:
        u = obj.user
        full = f"{getattr(u, 'first_name', '')} {getattr(u, 'last_name', '')}".strip()
        return full or u.email


class ReceptionPortalSettingsSerializer(serializers.ModelSerializer):
    default_doctor_user = serializers.PrimaryKeyRelatedField(
        queryset=get_user_model().objects.all(),
        required=False,
        allow_null=True,
    )
    opd_fee_slots = serializers.ListField(required=False)
    opd_visible_fields = serializers.ListField(child=serializers.CharField(), required=False)
    opd_field_config = serializers.JSONField(required=False)
    ipd_process_field_config = serializers.JSONField(required=False)
    current_opd_slot_fee = serializers.SerializerMethodField()
    current_opd_slot = serializers.SerializerMethodField()
    hospital_logo_url = serializers.SerializerMethodField()

    class Meta:
        model = ReceptionPortalSettings
        fields = [
            "id",
            "default_city",
            "default_state",
            "default_doctor_user",
            "hospital_name",
            "address",
            "pin_code",
            "phone",
            "email",
            "website",
            "hospital_logo",
            "hospital_logo_url",
            "uhid_prefix",
            "invoice_prefix",
            "invoice_next_number",
            "document_number_formats",
            "print_with_background",
            "opd_fee_mode",
            "opd_fee_slots",
            "opd_visible_fields",
            "opd_field_config",
            "ipd_process_field_config",
            "admission_bed_label_mode",
            "time_display_mode",
            "reception_collection_enabled",
            "reception_daily_report_enabled",
            "current_opd_slot_fee",
            "current_opd_slot",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "created_at", "updated_at"]

    def get_current_opd_slot(self, obj):
        return obj.get_current_opd_slot()

    def get_current_opd_slot_fee(self, obj):
        return obj.get_current_opd_slot_fee()

    def get_hospital_logo_url(self, obj):
        if not obj.hospital_logo:
            return ""
        request = self.context.get("request")
        if request is not None:
            return request.build_absolute_uri(obj.hospital_logo.url)
        return obj.hospital_logo.url

    def validate_uhid_prefix(self, value):
        if value in (None, ""):
            return "DEF"
        cleaned = str(value).strip().upper()
        if not re.fullmatch(r"[A-Z0-9]{2,8}", cleaned):
            raise serializers.ValidationError("Use 2-8 letters or numbers.")
        return cleaned

    def validate_invoice_prefix(self, value):
        if value in (None, ""):
            return "INV"
        cleaned = str(value).strip().upper()
        if not re.fullmatch(r"[A-Z0-9]{2,20}", cleaned):
            raise serializers.ValidationError("Use 2-20 letters or numbers.")
        return cleaned

    def validate_invoice_next_number(self, value):
        try:
            num = int(value)
        except (TypeError, ValueError):
            raise serializers.ValidationError("Must be a positive integer.")
        if num < 1:
            raise serializers.ValidationError("Must be at least 1.")
        return num

    def validate_document_number_formats(self, value):
        if isinstance(value, str):
            try:
                value = json.loads(value)
            except json.JSONDecodeError as exc:
                raise serializers.ValidationError("Invalid JSON for document number formats.") from exc
        if value in (None, ""):
            return normalize_document_number_formats({})
        if not isinstance(value, dict):
            raise serializers.ValidationError("Document number formats must be an object.")
        try:
            return validate_document_number_formats(value)
        except ValueError as exc:
            raise serializers.ValidationError(str(exc)) from exc

    def validate_admission_bed_label_mode(self, value):
        allowed = {"bed_code", "bed_number"}
        mode = str(value or "bed_code").strip()
        if mode not in allowed:
            raise serializers.ValidationError("Must be bed_code or bed_number.")
        return mode

    def validate_time_display_mode(self, value):
        allowed = {"12h", "24h"}
        mode = str(value or "24h").strip()
        if mode not in allowed:
            raise serializers.ValidationError("Must be 12h or 24h.")
        return mode

    def validate_opd_visible_fields(self, value):
        if value in (None, ""):
            return []
        if not isinstance(value, list):
            raise serializers.ValidationError("Field visibility must be a list.")
        cleaned = []
        for item in value:
            key = str(item or "").strip()
            if not key or key not in OPD_FORM_VISIBLE_FIELD_KEYS or key in cleaned:
                continue
            cleaned.append(key)
        return cleaned

    def validate_opd_field_config(self, value):
        if value in (None, ""):
            return normalize_opd_field_config({})
        if not isinstance(value, dict):
            raise serializers.ValidationError("Field config must be an object.")
        return normalize_opd_field_config(value)

    def validate_ipd_process_field_config(self, value):
        if value in (None, ""):
            return normalize_ipd_process_templates({})
        if not isinstance(value, dict):
            raise serializers.ValidationError("IPD process field config must be an object.")
        return normalize_ipd_process_templates(value)

    def validate_opd_fee_slots(self, value):
        if value in (None, ""):
            return []
        if not isinstance(value, list):
            raise serializers.ValidationError("Slots must be a list.")
        cleaned = []
        for idx, row in enumerate(value):
            if not isinstance(row, dict):
                raise serializers.ValidationError(f"Slot #{idx + 1} must be an object.")
            start = str(row.get("start", "")).strip()
            end = str(row.get("end", "")).strip()
            amount = row.get("amount", "")
            if not start or not end:
                raise serializers.ValidationError(f"Slot #{idx + 1} needs start and end time.")
            if ":" not in start or ":" not in end:
                raise serializers.ValidationError(f"Slot #{idx + 1} time must be HH:MM.")
            try:
                amount_value = float(str(amount).strip())
            except Exception:
                raise serializers.ValidationError(f"Slot #{idx + 1} amount must be numeric.")
            if amount_value < 0:
                raise serializers.ValidationError(f"Slot #{idx + 1} amount cannot be negative.")
            # Preserve optional per-doctor scope and days fields (added by frontend).
            doctor_user_id = row.get("doctor_user_id")
            if doctor_user_id is not None:
                doctor_user_id = str(doctor_user_id).strip() or None
            days = row.get("days")
            if not isinstance(days, list):
                days = None
            entry = {
                "start": start[:5],
                "end": end[:5],
                "amount": round(amount_value, 2),
            }
            if doctor_user_id is not None:
                entry["doctor_user_id"] = doctor_user_id
            if days is not None:
                entry["days"] = days
            cleaned.append(entry)
        return cleaned
