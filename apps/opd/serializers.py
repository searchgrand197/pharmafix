from django.utils import timezone
from rest_framework import serializers

from apps.opd.models import OPDVisit
from apps.opd.services import resolve_opd_doctor_name
from apps.patients.age_utils import dob_to_age_parts, is_child_age


class OPDVisitSerializer(serializers.ModelSerializer):
    patient_uhid = serializers.CharField(source="patient.uhid", read_only=True)
    patient_name = serializers.SerializerMethodField()
    patient_phone = serializers.CharField(source="patient.phone", read_only=True, default="")
    patient_registered_at = serializers.DateTimeField(source="patient.created_at", read_only=True)
    patient_age = serializers.SerializerMethodField()
    patient_age_unit = serializers.SerializerMethodField()
    patient_gender = serializers.CharField(source="patient.gender", read_only=True, default="")
    patient_address = serializers.SerializerMethodField()
    patient_city = serializers.SerializerMethodField()
    patient_state = serializers.SerializerMethodField()
    patient_guardian_name = serializers.SerializerMethodField()
    patient_guardian_relationship = serializers.SerializerMethodField()
    patient_salutation = serializers.SerializerMethodField()
    patient_opd_custom_fields = serializers.SerializerMethodField()
    token_number = serializers.IntegerField(source="queue_number", read_only=True)
    chief_complaint = serializers.CharField(source="visit_reason", read_only=True)
    room_code = serializers.SerializerMethodField()
    doctor_user_email = serializers.EmailField(source="doctor_user.email", read_only=True)
    doctor_name = serializers.SerializerMethodField()
    created_by_name = serializers.SerializerMethodField()
    cancelled_by_name = serializers.SerializerMethodField()
    hospital_id = serializers.UUIDField(read_only=True)

    class Meta:
        model = OPDVisit
        fields = [
            "id",
            "hospital_id",
            "patient",
            "patient_uhid",
            "opd_no",
            "patient_name",
            "patient_phone",
            "patient_registered_at",
            "patient_age",
            "patient_age_unit",
            "patient_gender",
            "patient_address",
            "patient_city",
            "patient_state",
            "patient_guardian_name",
            "patient_guardian_relationship",
            "patient_salutation",
            "patient_opd_custom_fields",
            "visit_date",
            "queue_number",
            "token_number",
            "doctor_user",
            "doctor_user_email",
            "doctor_name",
            "department",
            "visit_reason",
            "chief_complaint",
            "room_code",
            "symptoms",
            "vitals",
            "consultation_notes",
            "patient_notes",
            "diagnosis",
            "test_recommendations",
            "revisit_advice",
            "follow_up_date",
            "follow_up_completed",
            "status",
            "amount",
            "payment_mode",
            "opd_payment_slip_no",
            "created_by",
            "created_by_name",
            "cancel_reason",
            "cancelled_by",
            "cancelled_by_name",
            "cancelled_at",
            "voided",
            "created_at",
            "updated_at",
        ]

    def get_patient_name(self, obj):
        try:
            return obj.patient.full_name
        except Exception:
            first = getattr(obj.patient, "first_name", "") or ""
            last = getattr(obj.patient, "last_name", "") or ""
            name = f"{first} {last}".strip()
            return name or None

    def get_patient_age(self, obj):
        value, _unit = dob_to_age_parts(getattr(obj.patient, "dob", None))
        return value

    def get_patient_age_unit(self, obj):
        _value, unit = dob_to_age_parts(getattr(obj.patient, "dob", None))
        return unit or "years"

    def get_patient_address(self, obj):
        try:
            return obj.patient.address.line1 or ""
        except Exception:
            return ""

    def get_patient_city(self, obj):
        try:
            return obj.patient.address.city or ""
        except Exception:
            return ""

    def get_patient_state(self, obj):
        try:
            return obj.patient.address.state or ""
        except Exception:
            return ""

    def get_patient_guardian_name(self, obj):
        try:
            return obj.patient.guardian.name or ""
        except Exception:
            return ""

    def get_patient_guardian_relationship(self, obj):
        try:
            return (obj.patient.guardian.relationship or "").strip()
        except Exception:
            return ""

    def get_patient_salutation(self, obj):
        """
        Honorific for OPD slip: use Patient.preferred_salutation when set
        ('none' = no prefix; explicit Mr/Mrs/Master/Miss); otherwise age+gender rules.
        """
        pref = (getattr(obj.patient, "preferred_salutation", None) or "").strip()
        if pref == "none":
            return ""
        if pref in ("Mr", "Mrs", "Master", "Miss"):
            return pref
        gender = (getattr(obj.patient, "gender", None) or "").strip().lower()
        age = self.get_patient_age(obj)
        age_unit = self.get_patient_age_unit(obj)
        if is_child_age(age, age_unit):
            if gender == "male":
                return "Master"
            if gender == "female":
                return "Miss"
            return ""
        if gender == "male":
            return "Mr"
        if gender == "female":
            return "Mrs"
        return ""

    def get_patient_opd_custom_fields(self, obj):
        raw = getattr(obj.patient, "opd_custom_fields", None)
        if not isinstance(raw, dict):
            return {}
        return {str(k): "" if v is None else str(v) for k, v in raw.items() if str(k or "").strip()}

    def get_room_code(self, obj):
        # Backward-compatibility for old frontend payload/filters.
        return None

    def get_doctor_name(self, obj):
        return resolve_opd_doctor_name(
            doctor_user=obj.doctor_user,
            hospital_id=getattr(obj, "hospital_id", None),
        )

    def get_created_by_name(self, obj):
        if not obj.created_by:
            return ""
        first = getattr(obj.created_by, "first_name", "") or ""
        last = getattr(obj.created_by, "last_name", "") or ""
        name = f"{first} {last}".strip()
        return name or obj.created_by.email

    def get_cancelled_by_name(self, obj):
        if not obj.cancelled_by:
            return ""
        first = getattr(obj.cancelled_by, "first_name", "") or ""
        last = getattr(obj.cancelled_by, "last_name", "") or ""
        name = f"{first} {last}".strip()
        return name or obj.cancelled_by.email


class OPDVisitCreateUpdateSerializer(serializers.ModelSerializer):
    # Backward-compatibility aliases for existing frontend:
    # chief_complaint -> visit_reason, token_number -> queue_number.
    chief_complaint = serializers.CharField(write_only=True, required=False, allow_blank=True)
    token_number = serializers.IntegerField(write_only=True, required=False)
    room_code = serializers.CharField(write_only=True, required=False, allow_blank=True)
    visit_datetime = serializers.DateTimeField(write_only=True, required=False, allow_null=True)

    class Meta:
        model = OPDVisit
        fields = [
            "patient",
            "visit_date",
            "visit_datetime",
            "queue_number",
            "token_number",
            "doctor_user",
            "department",
            "chief_complaint",
            "room_code",
            "visit_reason",
            "symptoms",
            "vitals",
            "consultation_notes",
            "patient_notes",
            "diagnosis",
            "test_recommendations",
            "follow_up_date",
            "follow_up_completed",
            "status",
            "amount",
            "payment_mode",
            "cancel_reason",
        ]

    def validate(self, attrs):
        # Map chief_complaint alias to visit_reason.
        chief = attrs.pop("chief_complaint", None)
        if chief is not None and not attrs.get("visit_reason"):
            attrs["visit_reason"] = chief

        # Map token_number alias to queue_number if provided.
        token_number = attrs.pop("token_number", None)
        if token_number is not None and not attrs.get("queue_number"):
            attrs["queue_number"] = token_number

        # room_code is accepted for compatibility; currently not persisted.
        attrs.pop("room_code", None)

        visit_dt = attrs.pop("visit_datetime", None)
        if visit_dt is not None:
            visit_date = attrs.get("visit_date")
            if visit_date is None and self.instance is not None:
                visit_date = self.instance.visit_date
            local_date = timezone.localtime(visit_dt).date()
            if visit_date is not None and visit_date != local_date:
                raise serializers.ValidationError(
                    {"visit_datetime": ["Visit date must match the date portion of visit datetime."]}
                )
            if visit_date is None:
                attrs["visit_date"] = local_date
            self._visit_datetime = visit_dt
        else:
            self._visit_datetime = None

        # Map frontend status alias.
        if attrs.get("status") == "in_consultation":
            attrs["status"] = OPDVisit.Status.IN_PROGRESS

        instance = getattr(self, "instance", None)
        target_status = attrs.get("status", getattr(instance, "status", None))
        cancel_reason = (attrs.get("cancel_reason") or "").strip()

        if target_status == OPDVisit.Status.CANCELLED and not cancel_reason:
            raise serializers.ValidationError({"cancel_reason": ["Cancellation reason is required."]})

        if instance and instance.status == OPDVisit.Status.CANCELLED:
            incoming_status = attrs.get("status")
            if incoming_status and incoming_status != OPDVisit.Status.CANCELLED:
                raise serializers.ValidationError({"status": ["Cancelled OPD slips are view-only."]})

        return attrs

