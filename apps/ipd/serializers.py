from rest_framework import serializers

from apps.ipd.models import IPDAdmission, IPDDailyProcessLog
from apps.ipd.process_log_validation import validate_custom_fields_against_config
from apps.ipd.process_log_service import get_process_config_for_log, resolve_process_config_for_save
from apps.settings_management.ipd_process_field_config import (
    get_hospital_process_templates,
    get_template_name,
)
from apps.ipd.services import resolve_ipd_doctor_name


class IPDAdmissionSerializer(serializers.ModelSerializer):
    patient_uhid = serializers.CharField(source="patient.uhid", read_only=True)
    patient_name = serializers.SerializerMethodField()
    assigned_doctor_email = serializers.EmailField(source="assigned_doctor.email", read_only=True)
    assigned_doctor_name = serializers.SerializerMethodField()
    assigned_nurse_email = serializers.EmailField(source="assigned_nurse.email", read_only=True)
    guardian_name = serializers.SerializerMethodField()
    guardian_relationship = serializers.SerializerMethodField()
    address = serializers.SerializerMethodField()
    mobile_number = serializers.SerializerMethodField()
    hospital_id = serializers.UUIDField(read_only=True)
    scheme_name = serializers.SerializerMethodField()
    final_bill_no = serializers.CharField(source="final_bill.bill_no", read_only=True, default="")

    class Meta:
        model = IPDAdmission
        fields = [
            "id",
            "hospital_id",
            "patient",
            "patient_name",
            "patient_uhid",
            "ipd_no",
            "opd_visit",
            "admission_date",
            "admission_time",
            "expected_discharge_date",
            "assigned_doctor",
            "assigned_doctor_name",
            "assigned_doctor_email",
            "assigned_nurse",
            "assigned_nurse_email",
            "guardian_name",
            "guardian_relationship",
            "address",
            "mobile_number",
            "ward_name",
            "department",
            "room_name",
            "bed_code",
            "final_bill_no",
            "admission_diagnosis",
            "admission_notes",
            "status",
            "discharged_at",
            "discharge_notes",
            "scheme",
            "scheme_name",
            "room_rent_override",
            "room_rent_daily_charge_override",
            "room_rent_days_override",
            "created_at",
            "updated_at",
        ]

    def get_patient_name(self, obj):
        if obj.patient:
            parts = [obj.patient.first_name, obj.patient.last_name]
            name = " ".join(filter(None, parts)).strip()
            return name or obj.patient.uhid
        return ""

    def get_scheme_name(self, obj):
        scheme = getattr(obj, "scheme", None)
        return (getattr(scheme, "name", "") or "").strip() or None

    def get_assigned_doctor_name(self, obj):
        return resolve_ipd_doctor_name(
            assigned_doctor=obj.assigned_doctor,
            hospital_id=getattr(obj, "hospital_id", None),
        )

    def get_guardian_name(self, obj):
        patient = getattr(obj, "patient", None)
        guardian = getattr(patient, "guardian", None) if patient is not None else None
        return (getattr(guardian, "name", "") or "").strip()

    def get_guardian_relationship(self, obj):
        patient = getattr(obj, "patient", None)
        guardian = getattr(patient, "guardian", None) if patient is not None else None
        return (getattr(guardian, "relationship", "") or "").strip()

    def get_mobile_number(self, obj):
        patient = getattr(obj, "patient", None)
        return (getattr(patient, "phone", "") or "").strip()

    def get_address(self, obj):
        patient = getattr(obj, "patient", None)
        addr = getattr(patient, "address", None) if patient is not None else None
        if addr is None:
            return ""
        parts = [
            getattr(addr, "line1", "") or "",
            getattr(addr, "line2", "") or "",
            getattr(addr, "city", "") or "",
            getattr(addr, "state", "") or "",
            getattr(addr, "postal_code", "") or "",
        ]
        return ", ".join([p.strip() for p in parts if str(p).strip()])


class IPDAdmissionCreateUpdateSerializer(serializers.ModelSerializer):
    """Write serializer; `id` and `ipd_no` are read-only so create/update responses include them (e.g. for IPD slip = ledger ID)."""

    class Meta:
        model = IPDAdmission
        fields = [
            "id",
            "ipd_no",
            "patient",
            "opd_visit",
            "admission_date",
            "admission_time",
            "expected_discharge_date",
            "assigned_doctor",
            "assigned_nurse",
            "ward_name",
            "department",
            "room_name",
            "bed_code",
            "admission_diagnosis",
            "admission_notes",
            "scheme",
            "status",
            "discharge_notes",
            "discharged_at",
        ]
        read_only_fields = ("id", "ipd_no")

    def validate(self, attrs):
        attrs = super().validate(attrs)
        instance = getattr(self, "instance", None)

        admission_date = attrs.get("admission_date") if "admission_date" in attrs else (
            instance.admission_date if instance else None
        )
        discharged_at = attrs.get("discharged_at") if "discharged_at" in attrs else (
            instance.discharged_at if instance else None
        )
        status = attrs.get("status") if "status" in attrs else (
            instance.status if instance else IPDAdmission.Status.ADMITTED
        )
        if discharged_at and admission_date and status in (
            IPDAdmission.Status.DISCHARGED,
            IPDAdmission.Status.CANCELLED,
        ):
            discharged_date = discharged_at.date() if hasattr(discharged_at, "date") else discharged_at
            if discharged_date < admission_date:
                raise serializers.ValidationError({
                    "discharged_at": ["Discharge date cannot be before admission date."],
                })

        if instance:
            return attrs

        patient = attrs.get("patient")
        scheme = attrs.get("scheme")
        if scheme is not None:
            hospital_id_for_scheme = (
                getattr(patient, "hospital_id", None)
                or getattr(attrs.get("opd_visit"), "hospital_id", None)
                or getattr(getattr(self, "instance", None), "hospital_id", None)
            )
            request = self.context.get("request")
            if not hospital_id_for_scheme and request is not None:
                hospital_id_for_scheme = getattr(request.user, "hospital_id", None)
            if hospital_id_for_scheme and scheme.hospital_id != hospital_id_for_scheme:
                raise serializers.ValidationError({"scheme": ["Scheme does not belong to this hospital."]})

        if not patient:
            return attrs

        hospital_id = getattr(patient, "hospital_id", None) or getattr(attrs.get("opd_visit"), "hospital_id", None)
        request = self.context.get("request")
        if not hospital_id and request is not None:
            hospital_id = getattr(request.user, "hospital_id", None)

        active_exists = IPDAdmission.objects.filter(
            hospital_id=hospital_id,
            patient=patient,
            is_deleted=False,
        ).exclude(
            status__in=[IPDAdmission.Status.DISCHARGED, IPDAdmission.Status.CANCELLED]
        ).first()
        if active_exists:
            raise serializers.ValidationError({
                "patient": [
                    f"Patient already has an active IPD admission ({active_exists.ipd_no or active_exists.id}) in "
                    f"{active_exists.ward_name or 'ward'} / {active_exists.bed_code or 'bed'}."
                ]
            })

        return attrs


class IPDDailyProcessLogSerializer(serializers.ModelSerializer):
    recorded_by_name = serializers.SerializerMethodField()
    day_label = serializers.SerializerMethodField()
    process_template_name = serializers.SerializerMethodField()

    class Meta:
        model = IPDDailyProcessLog
        fields = [
            "id",
            "admission",
            "hospital",
            "log_date",
            "day_number",
            "day_label",
            "process_template_id",
            "process_template_name",
            "process_field_config",
            "vitals",
            "medication_procedure_notes",
            "completed_notes",
            "pending_notes",
            "general_notes",
            "custom_fields",
            "recorded_by",
            "recorded_by_name",
            "created_at",
            "updated_at",
        ]
        read_only_fields = (
            "id",
            "admission",
            "hospital",
            "recorded_by",
            "recorded_by_name",
            "day_label",
            "process_template_name",
            "process_field_config",
            "created_at",
            "updated_at",
        )

    def get_recorded_by_name(self, obj):
        user = getattr(obj, "recorded_by", None)
        if not user:
            return ""
        full = f"{getattr(user, 'first_name', '')} {getattr(user, 'last_name', '')}".strip()
        return full or getattr(user, "email", "") or ""

    def get_day_label(self, obj):
        if obj.day_number:
            return f"Day {obj.day_number}"
        return ""

    def get_process_template_name(self, obj):
        templates = get_hospital_process_templates(obj.hospital_id)
        return get_template_name(templates, obj.process_template_id)

    def validate_process_template_id(self, value):
        if value in (None, ""):
            return ""
        return str(value).strip()[:64]

    def validate_vitals(self, value):
        if value is None:
            return {}
        if not isinstance(value, dict):
            raise serializers.ValidationError("Vitals must be an object.")
        return value

    def validate_custom_fields(self, value):
        if value in (None, ""):
            return {}
        if not isinstance(value, dict):
            raise serializers.ValidationError("custom_fields must be an object.")
        config = self.context.get("process_config")
        if not config:
            admission = (
                self.context.get("admission")
                or getattr(self.instance, "admission", None)
            )
            hospital_id = getattr(admission, "hospital_id", None) if admission else None
            if hospital_id:
                if self.instance:
                    config = get_process_config_for_log(self.instance)
                else:
                    template_id = self.initial_data.get("process_template_id")
                    _, config = resolve_process_config_for_save(
                        hospital_id=hospital_id,
                        process_template_id=template_id,
                        existing=None,
                    )
        if not config:
            return value
        try:
            return validate_custom_fields_against_config(value, config)
        except ValueError as exc:
            raise serializers.ValidationError(str(exc)) from exc

    def validate(self, attrs):
        attrs = super().validate(attrs)
        admission = (
            attrs.get("admission")
            or getattr(self.instance, "admission", None)
            or self.context.get("admission")
        )
        log_date = attrs.get("log_date") or getattr(self.instance, "log_date", None)
        if admission and log_date and log_date < admission.admission_date:
            raise serializers.ValidationError({"log_date": ["Process log date cannot be before admission date."]})
        return attrs
