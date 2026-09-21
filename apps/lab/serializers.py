from rest_framework import serializers
from apps.lab.models import (
    LabTestCategory, LabTest, LabTestParameter, LabReport, LabTestResult, LabSettings,
)
from apps.patients.serializers import PatientSerializer
from apps.doctors.serializers import DoctorProfileSerializer


class LabSettingsSerializer(serializers.ModelSerializer):
    logo_url = serializers.SerializerMethodField()
    signature_url = serializers.SerializerMethodField()
    watermark_url = serializers.SerializerMethodField()
    next_visit_id_preview = serializers.SerializerMethodField()

    class Meta:
        model = LabSettings
        fields = (
            "id", "lab_name", "tagline", "address", "phone", "email", "website",
            "gstin", "nabl_reg_no", "processed_at_label",
            "pathologist_name", "pathologist_qualification", "pathologist_reg_no",
            "footer_note", "logo", "logo_url", "signature", "signature_url",
            "watermark", "watermark_url", "watermark_enabled", "watermark_source",
            "watermark_opacity", "watermark_size", "watermark_rotation",
            "visit_id_prefix", "visit_id_next_number", "visit_id_padding",
            "next_visit_id_preview",
        )
        read_only_fields = ("id", "logo_url", "signature_url", "watermark_url", "next_visit_id_preview")
        extra_kwargs = {
            "logo": {"write_only": True, "required": False},
            "signature": {"write_only": True, "required": False},
            "watermark": {"write_only": True, "required": False},
        }

    def _abs_url(self, file_field):
        if not file_field:
            return ""
        name = getattr(file_field, "name", None)
        if not name:
            return ""
        try:
            storage = getattr(file_field, "storage", None)
            if storage is not None and hasattr(storage, "exists") and not storage.exists(name):
                return ""
            url = file_field.url
        except (ValueError, OSError, FileNotFoundError):
            return ""
        if not url:
            return ""
        request = self.context.get("request")
        return request.build_absolute_uri(url) if request else url

    def get_logo_url(self, obj):
        return self._abs_url(obj.logo)

    def get_signature_url(self, obj):
        return self._abs_url(obj.signature)

    def get_watermark_url(self, obj):
        return self._abs_url(obj.watermark)

    def get_next_visit_id_preview(self, obj):
        return obj.peek_next_visit_id()

    def validate_watermark_source(self, value):
        if value not in ("logo", "custom"):
            return "logo"
        return value

    def validate_watermark_opacity(self, value):
        if value is None:
            return 15
        return max(5, min(40, int(value)))

    def validate_watermark_size(self, value):
        if value is None:
            return 55
        return max(20, min(90, int(value)))

    def validate_watermark_rotation(self, value):
        if value is None:
            return 0
        return max(-90, min(90, int(value)))


class LabTestCategorySerializer(serializers.ModelSerializer):
    class Meta:
        model = LabTestCategory
        fields = ("id", "name")


class LabTestParameterSerializer(serializers.ModelSerializer):
    id = serializers.UUIDField(required=False)

    class Meta:
        model = LabTestParameter
        fields = (
            "id", "name", "code", "unit", "reference_range",
            "ref_low", "ref_high", "method", "section_title",
            "sort_order", "result_type",
        )

    def validate_ref_low(self, value):
        return value if value not in ("", None) else None

    def validate_ref_high(self, value):
        return value if value not in ("", None) else None


class LabTestSerializer(serializers.ModelSerializer):
    category_name = serializers.ReadOnlyField(source="category.name")
    parameters = LabTestParameterSerializer(many=True, required=False)
    report_usage_count = serializers.IntegerField(read_only=True, default=0)

    class Meta:
        model = LabTest
        fields = (
            "id", "name", "code", "category", "category_name",
            "unit", "reference_range", "price",
            "is_group_test", "procedure", "is_active",
            "sample_type", "method", "interpretation", "department_label",
            "report_usage_count", "parameters",
        )

    def create(self, validated_data):
        params_data = validated_data.pop("parameters", [])
        test = LabTest.objects.create(**validated_data)
        for p in params_data:
            LabTestParameter.objects.create(test=test, **p)
        return test

    def update(self, instance, validated_data):
        params_data = validated_data.pop("parameters", None)
        for attr, val in validated_data.items():
            setattr(instance, attr, val)
        instance.save()

        if params_data is not None:
            existing_ids = {str(p.id) for p in instance.parameters.all()}
            incoming_ids = set()
            for p in params_data:
                pid = str(p.get("id", ""))
                if pid and pid in existing_ids:
                    LabTestParameter.objects.filter(id=pid).update(**{k: v for k, v in p.items() if k != "id"})
                    incoming_ids.add(pid)
                else:
                    obj = LabTestParameter.objects.create(test=instance, **{k: v for k, v in p.items() if k != "id"})
                    incoming_ids.add(str(obj.id))
            # Delete removed parameters
            for pid in existing_ids - incoming_ids:
                LabTestParameter.objects.filter(id=pid).delete()

        return instance


class LabTestResultSerializer(serializers.ModelSerializer):
    # Live fields from parameter
    test_name = serializers.SerializerMethodField()
    ordered_test_name = serializers.ReadOnlyField(source="test.name")
    parameter_name = serializers.ReadOnlyField(source="parameter.name")
    test_unit = serializers.SerializerMethodField()
    test_ref = serializers.SerializerMethodField()
    test_method = serializers.SerializerMethodField()
    section_title = serializers.SerializerMethodField()
    sort_order = serializers.SerializerMethodField()
    category_name = serializers.ReadOnlyField(source="test.category.name")
    department_label = serializers.ReadOnlyField(source="test.department_label")
    sample_type = serializers.ReadOnlyField(source="test.sample_type")
    interpretation = serializers.ReadOnlyField(source="test.interpretation")

    class Meta:
        model = LabTestResult
        fields = (
            "id", "report", "test", "parameter",
            "test_name", "ordered_test_name", "parameter_name",
            "test_unit", "test_ref", "test_method", "section_title", "sort_order",
            "category_name", "department_label", "sample_type", "interpretation",
            "result_value", "is_abnormal", "flag",
            "unit_snapshot", "reference_range_snapshot", "method_snapshot",
            "section_title_snapshot", "sort_order_snapshot",
        )
        read_only_fields = ("flag", "is_abnormal", "unit_snapshot", "reference_range_snapshot",
                            "method_snapshot", "section_title_snapshot", "sort_order_snapshot")

    def get_test_name(self, obj):
        if obj.parameter:
            return obj.parameter.name
        return obj.test.name

    def get_test_unit(self, obj):
        return obj.unit_snapshot or (obj.parameter.unit if obj.parameter else obj.test.unit)

    def get_test_ref(self, obj):
        return obj.reference_range_snapshot or (obj.parameter.reference_range if obj.parameter else obj.test.reference_range)

    def get_test_method(self, obj):
        return obj.method_snapshot or (obj.parameter.method if obj.parameter else obj.test.method)

    def get_section_title(self, obj):
        return obj.section_title_snapshot or (obj.parameter.section_title if obj.parameter else "")

    def get_sort_order(self, obj):
        return obj.sort_order_snapshot if obj.sort_order_snapshot else (obj.parameter.sort_order if obj.parameter else 0)


class LabReportSerializer(serializers.ModelSerializer):
    patient_details = PatientSerializer(source="patient", read_only=True)
    doctor_details = DoctorProfileSerializer(source="referred_by", read_only=True)
    results = LabTestResultSerializer(many=True, read_only=True)
    # Accept test_ids on create
    test_ids = serializers.ListField(child=serializers.UUIDField(), write_only=True, required=False)

    class Meta:
        model = LabReport
        fields = (
            "id", "patient", "patient_details", "referred_by", "doctor_details",
            "lab_no", "collected_at", "received_at", "reported_at",
            "status", "validation_status", "notes",
            "barcode_no", "visit_id", "processed_at_label",
            "results", "test_ids", "created_at",
        )
        read_only_fields = ("lab_no",)

    def create(self, validated_data):
        # Must pop write-only helper field — it is not a LabReport column.
        validated_data.pop("test_ids", None)
        return super().create(validated_data)
