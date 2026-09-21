from rest_framework import serializers

from apps.doctors.models import (
    DoctorDailyAvailability,
    DoctorPortalPreference,
    DoctorProfile,
    DoctorWeeklySchedule,
    HospitalCustomRxSalt,
    Specialty,
)
from apps.staff.models import Department
from apps.staff.serializers import DepartmentBriefSerializer


class SpecialtySerializer(serializers.ModelSerializer):
    hospital_id = serializers.UUIDField(read_only=True)
    department_name = serializers.CharField(source="department.name", read_only=True)
    department_entity = DepartmentBriefSerializer(source="department", read_only=True)

    class Meta:
        model = Specialty
        fields = [
            "id",
            "hospital_id",
            "code",
            "name",
            "department",
            "department_name",
            "department_entity",
            "is_active",
            "created_at",
            "updated_at",
        ]


class SpecialtyCreateUpdateSerializer(serializers.ModelSerializer):
    class Meta:
        model = Specialty
        fields = ["code", "name", "department", "is_active"]


class DoctorProfileSerializer(serializers.ModelSerializer):
    hospital_id = serializers.UUIDField(read_only=True)
    user_email = serializers.EmailField(source="user.email", read_only=True)
    departments_entities = DepartmentBriefSerializer(source="departments", many=True, read_only=True)
    specialty_name = serializers.CharField(source="specialty.name", read_only=True)

    class Meta:
        model = DoctorProfile
        fields = [
            "id",
            "hospital_id",
            "user",
            "user_email",
            "departments",
            "departments_entities",
            "specialty",
            "specialty_name",
            "doctor_type",
            "doctor_code",
            "name",
            "mobile_number",
            "alternate_mobile_number",
            "address",
            "consultation_fee",
            "is_active",
            "is_deleted",
            "created_at",
            "updated_at",
        ]


class DoctorProfileCreateUpdateSerializer(serializers.ModelSerializer):
    departments = serializers.PrimaryKeyRelatedField(
        many=True, queryset=Department.objects.all()
    )

    class Meta:
        model = DoctorProfile
        fields = [
            "user",
            "departments",
            "specialty",
            "doctor_type",
            "doctor_code",
            "name",
            "mobile_number",
            "alternate_mobile_number",
            "address",
            "consultation_fee",
            "is_active",
        ]

    def validate_doctor_code(self, value):
        code = (value or "").strip()
        if not code:
            raise serializers.ValidationError("Doctor code is required.")
        return code

    def validate(self, attrs):
        attrs = super().validate(attrs)
        request = self.context.get("request")
        hospital_id = (
            getattr(request.user, "hospital_id", None)
            if request and getattr(request, "user", None) and request.user.is_authenticated
            else None
        )

        code = attrs.get("doctor_code")
        if code is None and self.instance is not None:
            code = self.instance.doctor_code
        code = (code or "").strip()
        if not code:
            raise serializers.ValidationError({"doctor_code": "Doctor code is required."})
        attrs["doctor_code"] = code

        if hospital_id is None:
            return attrs

        qs = DoctorProfile.objects.filter(
            hospital_id=hospital_id,
            is_deleted=False,
            doctor_code__iexact=code,
        )
        if self.instance is not None:
            qs = qs.exclude(pk=self.instance.pk)
        if qs.exists():
            raise serializers.ValidationError(
                {"doctor_code": "A doctor with this code already exists at your hospital."}
            )
        return attrs


class DoctorWeeklyScheduleSerializer(serializers.ModelSerializer):
    hospital_id = serializers.UUIDField(read_only=True)
    doctor_name = serializers.CharField(source="doctor.name", read_only=True)

    class Meta:
        model = DoctorWeeklySchedule
        fields = ["id", "hospital_id", "doctor", "doctor_name", "day_of_week", "start_time", "end_time", "slot_minutes", "is_available", "created_at", "updated_at"]


class DoctorWeeklyScheduleCreateUpdateSerializer(serializers.ModelSerializer):
    class Meta:
        model = DoctorWeeklySchedule
        fields = ["doctor", "day_of_week", "start_time", "end_time", "slot_minutes", "is_available"]


class DoctorDailyAvailabilitySerializer(serializers.ModelSerializer):
    hospital_id = serializers.UUIDField(read_only=True)
    doctor_name = serializers.CharField(source="doctor.name", read_only=True)

    class Meta:
        model = DoctorDailyAvailability
        fields = ["id", "hospital_id", "doctor", "doctor_name", "date", "is_available", "open_from_time", "open_to_time", "closed_reason", "updated_by", "created_at", "updated_at"]


class DoctorDailyAvailabilityCreateUpdateSerializer(serializers.ModelSerializer):
    class Meta:
        model = DoctorDailyAvailability
        fields = ["doctor", "date", "is_available", "open_from_time", "open_to_time", "closed_reason"]


class DoctorPortalPreferenceSerializer(serializers.ModelSerializer):
    class Meta:
        model = DoctorPortalPreference
        fields = [
            "id",
            "followup_day_options",
            "rx_default_day_options",
            "dosage_pattern_options",
            "food_timing_options",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "created_at", "updated_at"]

    @staticmethod
    def _normalize_days(value, fallback):
        arr = value if isinstance(value, list) else []
        cleaned = sorted({int(n) for n in arr if isinstance(n, (int, float)) and 1 <= int(n) <= 365})
        return cleaned or fallback

    def validate_followup_day_options(self, value):
        return self._normalize_days(value, [3, 5, 7, 10, 14, 30])

    def validate_rx_default_day_options(self, value):
        return self._normalize_days(value, [1, 3, 5, 7, 10, 14, 30])

    @staticmethod
    def _normalize_option_pairs(value, fallback):
        arr = value if isinstance(value, list) else []
        cleaned = []
        seen = set()
        for row in arr:
            if not isinstance(row, dict):
                continue
            code = str(row.get("v", "")).strip()[:20]
            label = str(row.get("l", "")).strip()[:80]
            if not code or not label or code in seen:
                continue
            seen.add(code)
            cleaned.append({"v": code, "l": label})
        return cleaned or fallback

    @staticmethod
    def _normalize_dosage_option_pairs(value, fallback):
        arr = value if isinstance(value, list) else []
        cleaned = []
        seen = set()
        for row in arr:
            if not isinstance(row, dict):
                continue
            code = str(row.get("v", "")).strip()[:20]
            label = str(row.get("l", "")).strip()[:80]
            qty = row.get("q", 0)
            try:
                qty = float(qty)
            except (TypeError, ValueError):
                qty = 0
            if not code or not label or code in seen:
                continue
            if qty <= 0:
                continue
            seen.add(code)
            cleaned.append({"v": code, "l": label, "q": qty})
        return cleaned or fallback

    def validate_dosage_pattern_options(self, value):
        return self._normalize_dosage_option_pairs(
            value,
            [
                {"v": "1", "l": "1 (OD)", "q": 1},
                {"v": "1-0-1", "l": "1-0-1 (BD)", "q": 2},
                {"v": "1-1", "l": "1-1 (BD)", "q": 2},
            ],
        )

    def validate_food_timing_options(self, value):
        return self._normalize_option_pairs(
            value,
            [
                {"v": "AF", "l": "After Food"},
                {"v": "BF", "l": "Before Food"},
                {"v": "EM", "l": "Empty Stomach"},
            ],
        )


class HospitalCustomRxSaltSerializer(serializers.ModelSerializer):
    class Meta:
        model = HospitalCustomRxSalt
        fields = ["id", "name", "last_used_at", "use_count", "created_at"]
        read_only_fields = ["id", "last_used_at", "use_count", "created_at"]

    def validate_name(self, value):
        name = str(value or "").strip()[:200]
        if len(name) < 2:
            raise serializers.ValidationError("Medicine name must be at least 2 characters.")
        return name

