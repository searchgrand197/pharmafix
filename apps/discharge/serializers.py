from rest_framework import serializers

from apps.discharge.models import (
    DischargeInvestigation,
    DischargeMedication,
    DischargeSummary,
    DischargeSummaryTemplate,
    DischargeSurgery,
)
from apps.patients.age_utils import dob_to_age_parts


class DischargeMedicationSerializer(serializers.ModelSerializer):
    class Meta:
        model = DischargeMedication
        fields = ["id", "drug_name", "dose", "route", "frequency", "duration", "instructions", "sort_order", "rx_meta"]


class DischargeInvestigationSerializer(serializers.ModelSerializer):
    class Meta:
        model = DischargeInvestigation
        fields = ["id", "category", "test_name", "value", "reference_range", "test_date", "sort_order"]


class DischargeSurgerySerializer(serializers.ModelSerializer):
    class Meta:
        model = DischargeSurgery
        fields = [
            "id",
            "surgery_date",
            "procedure_name",
            "surgeon_name",
            "assistant_name",
            "anaesthetist_name",
            "anaesthesia_type",
            "operative_findings",
            "intra_op_complications",
            "sort_order",
        ]


class DischargeSummarySerializer(serializers.ModelSerializer):
    patient_name = serializers.SerializerMethodField()
    patient_uhid = serializers.CharField(source="admission.patient.uhid", read_only=True)
    patient_age = serializers.SerializerMethodField()
    patient_age_unit = serializers.SerializerMethodField()
    patient_gender = serializers.CharField(source="admission.patient.gender", read_only=True, default="")
    admission_date = serializers.DateField(source="admission.admission_date", read_only=True)
    admission_time = serializers.TimeField(source="admission.admission_time", read_only=True, allow_null=True)
    admission_ipd_no = serializers.CharField(source="admission.ipd_no", read_only=True)
    scheme = serializers.UUIDField(source="admission.scheme_id", read_only=True, allow_null=True)
    scheme_name = serializers.SerializerMethodField()
    discharged_at = serializers.DateTimeField(source="admission.discharged_at", read_only=True)
    medication_rows = DischargeMedicationSerializer(many=True, read_only=True)
    investigation_rows = DischargeInvestigationSerializer(many=True, read_only=True)
    surgery_rows = DischargeSurgerySerializer(many=True, read_only=True)

    class Meta:
        model = DischargeSummary
        fields = [
            "id",
            "admission",
            "hospital",
            "patient_name",
            "patient_uhid",
            "patient_age",
            "patient_age_unit",
            "patient_gender",
            "admission_date",
            "admission_time",
            "admission_ipd_no",
            "scheme",
            "scheme_name",
            "discharged_at",
            "summary_notes",
            "treatment_given",
            "condition_at_discharge",
            "medications_on_discharge",
            "follow_up_advice",
            "reason_for_admission",
            "diagnosis",
            "allergies",
            "procedure_surgery",
            "medical_history",
            "physical_examination",
            "investigations",
            "course_in_hospital",
            "diet_advice",
            "activity_advice",
            "warning_signs",
            "chief_complaints",
            "co_morbidities",
            "family_history",
            "personal_history",
            "complications_during_stay",
            "blood_transfusion_details",
            "implants_used",
            "indwelling_devices_on_discharge",
            "vaccination_given",
            "wound_care_instructions",
            "stitch_removal_date",
            "vitals_at_discharge",
            "surgery_date",
            "surgeon_name",
            "assistant_name",
            "anaesthetist_name",
            "anaesthesia_type",
            "operative_findings",
            "intra_op_complications",
            "discharge_date",
            "discharge_time",
            "discharge_type",
            "discharge_status",
            "mode_of_admission",
            "referred_to_facility",
            "referral_reason",
            "treating_consultant",
            "consultant_registration_no",
            "rmo_signed_by",
            "next_follow_up_date",
            "follow_up_doctor",
            "follow_up_department",
            "cause_of_death",
            "time_of_death",
            "notified_to",
            "autopsy_required",
            "abha_id",
            "insurance_provider",
            "tpa_name",
            "policy_number",
            "claim_number",
            "patient_education_given",
            "attendant_counselled_by",
            "total_billed",
            "total_paid",
            "outstanding_balance",
            "medication_rows",
            "investigation_rows",
            "surgery_rows",
            "is_draft",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["hospital"]

    def get_scheme_name(self, obj):
        scheme = getattr(getattr(obj, "admission", None), "scheme", None)
        return (getattr(scheme, "name", "") or "").strip() or None

    def get_patient_name(self, obj):
        if obj.admission and obj.admission.patient:
            parts = [obj.admission.patient.first_name, obj.admission.patient.last_name]
            name = " ".join(filter(None, parts)).strip()
            return name or obj.admission.patient.uhid
        return ""

    def _admission_patient(self, obj):
        return getattr(getattr(obj, "admission", None), "patient", None)

    def get_patient_age(self, obj):
        patient = self._admission_patient(obj)
        if not patient:
            return None
        value, _unit = dob_to_age_parts(getattr(patient, "dob", None))
        return value

    def get_patient_age_unit(self, obj):
        patient = self._admission_patient(obj)
        if not patient:
            return "years"
        _value, unit = dob_to_age_parts(getattr(patient, "dob", None))
        return unit or "years"


class DischargeSummaryTemplateSerializer(serializers.ModelSerializer):
    class Meta:
        model = DischargeSummaryTemplate
        fields = [
            "id",
            "hospital",
            "name",
            "payload",
            "created_by",
            "updated_by",
            "is_active",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["hospital", "created_by", "updated_by", "created_at", "updated_at"]
