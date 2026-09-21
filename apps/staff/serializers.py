from rest_framework import serializers

from apps.pharmacy.models import Pharmacy
from apps.roles_permissions.portal_registry import ALL_PORTAL_CODES
from apps.staff.models import (
    Department,
    Designation,
    EmergencyContact,
    Shift,
    StaffAvailabilityOverride,
    StaffIDProof,
    StaffProfile,
    StaffShiftAssignment,
)


class DepartmentSerializer(serializers.ModelSerializer):
    hospital_id = serializers.UUIDField(read_only=True)

    class Meta:
        model = Department
        fields = [
            "id",
            "hospital_id",
            "code",
            "name",
            "description",
            "is_active",
            "created_at",
            "updated_at",
        ]


class DepartmentCreateUpdateSerializer(serializers.ModelSerializer):
    class Meta:
        model = Department
        fields = ["code", "name", "description", "is_active"]


class DepartmentBriefSerializer(serializers.ModelSerializer):
    """
    Lightweight department representation for nesting on other resources (e.g. doctors, specialties).
    """

    class Meta:
        model = Department
        fields = ["id", "code", "name", "description", "is_active"]


class DesignationSerializer(serializers.ModelSerializer):
    hospital_id = serializers.UUIDField(read_only=True)
    allowed_pharmacy_ids = serializers.SerializerMethodField()

    class Meta:
        model = Designation
        fields = [
            "id",
            "hospital_id",
            "code",
            "name",
            "is_active",
            "allowed_portals",
            "allowed_pharmacy_ids",
            "created_at",
            "updated_at",
        ]

    def get_allowed_pharmacy_ids(self, obj) -> list[str]:
        return [
            str(pk)
            for pk in obj.allowed_pharmacies.filter(is_active=True).values_list("id", flat=True)
        ]


class DesignationCreateUpdateSerializer(serializers.ModelSerializer):
    allowed_portals = serializers.ListField(
        child=serializers.CharField(max_length=32),
        required=False,
    )
    allowed_pharmacies = serializers.ListField(
        child=serializers.UUIDField(),
        required=False,
        write_only=True,
        help_text="Pharmacy branch UUIDs when pharmacy portal is enabled. Empty = all branches.",
    )

    class Meta:
        model = Designation
        fields = ["code", "name", "is_active", "allowed_portals", "allowed_pharmacies"]

    def validate_allowed_portals(self, value):
        if value is None:
            return []
        cleaned: list[str] = []
        seen: set[str] = set()
        for portal_code in value:
            code = str(portal_code).strip().lower()
            if not code or code in seen:
                continue
            if code not in ALL_PORTAL_CODES:
                raise serializers.ValidationError(f"Unknown portal: {portal_code}")
            seen.add(code)
            cleaned.append(code)
        return cleaned

    def validate_allowed_pharmacies(self, value):
        if value is None:
            return []
        seen: set[str] = set()
        cleaned: list = []
        for raw_id in value:
            key = str(raw_id)
            if key in seen:
                continue
            seen.add(key)
            cleaned.append(raw_id)
        if not cleaned:
            return []
        existing = set(
            Pharmacy.objects.filter(id__in=cleaned, is_active=True).values_list("id", flat=True)
        )
        missing = [str(pk) for pk in cleaned if pk not in existing]
        if missing:
            raise serializers.ValidationError(f"Unknown or inactive pharmacy branch: {missing[0]}")
        return cleaned

    def _set_allowed_pharmacies(self, instance, pharmacy_ids):
        if pharmacy_ids is None:
            return
        instance.allowed_pharmacies.set(pharmacy_ids)

    def create(self, validated_data):
        pharmacy_ids = validated_data.pop("allowed_pharmacies", None)
        instance = super().create(validated_data)
        if pharmacy_ids is not None:
            self._set_allowed_pharmacies(instance, pharmacy_ids)
        return instance

    def update(self, instance, validated_data):
        pharmacy_ids = validated_data.pop("allowed_pharmacies", None)
        instance = super().update(instance, validated_data)
        if pharmacy_ids is not None:
            self._set_allowed_pharmacies(instance, pharmacy_ids)
        return instance


class ShiftSerializer(serializers.ModelSerializer):
    hospital_id = serializers.UUIDField(read_only=True)

    class Meta:
        model = Shift
        fields = ["id", "hospital_id", "name", "start_time", "end_time", "is_active", "created_at", "updated_at"]


class ShiftCreateUpdateSerializer(serializers.ModelSerializer):
    class Meta:
        model = Shift
        fields = ["name", "start_time", "end_time", "is_active"]


class StaffProfileSerializer(serializers.ModelSerializer):
    hospital_id = serializers.UUIDField(read_only=True)
    user_email = serializers.EmailField(source="user.email", read_only=True)
    department_name = serializers.CharField(source="department.name", read_only=True)
    designation_name = serializers.CharField(source="designation.name", read_only=True)
    allowed_pharmacy_ids = serializers.SerializerMethodField()

    class Meta:
        model = StaffProfile
        fields = [
            "id",
            "hospital_id",
            "user",
            "user_email",
            "department",
            "department_name",
            "designation",
            "designation_name",
            "employee_code",
            "first_name",
            "last_name",
            "phone",
            "address",
            "joining_date",
            "employment_status",
            "allowed_pharmacy_ids",
            "is_deleted",
            "created_at",
            "updated_at",
        ]

    def get_allowed_pharmacy_ids(self, obj) -> list[str]:
        return [str(pk) for pk in obj.allowed_pharmacies.filter(is_active=True).values_list("id", flat=True)]


class StaffProfileCreateUpdateSerializer(serializers.ModelSerializer):
    # Optional email used when auto-creating a user for this staff profile.
    email = serializers.EmailField(write_only=True, required=False)
    allowed_pharmacies = serializers.ListField(
        child=serializers.UUIDField(),
        required=False,
        write_only=True,
        help_text="Pharmacy branch UUIDs this staff may access. Empty = all branches.",
    )

    class Meta:
        model = StaffProfile
        fields = [
            "user",
            "department",
            "designation",
            "employee_code",
            "first_name",
            "last_name",
            "phone",
            "address",
            "joining_date",
            "employment_status",
            "email",
            "allowed_pharmacies",
        ]

    def validate_email(self, value):
        if value in (None, ""):
            return value
        return value.strip().lower()

    def validate_allowed_pharmacies(self, value):
        if value is None:
            return []
        seen: set[str] = set()
        cleaned: list = []
        for raw_id in value:
            key = str(raw_id)
            if key in seen:
                continue
            seen.add(key)
            cleaned.append(raw_id)
        if not cleaned:
            return []
        existing = set(
            Pharmacy.objects.filter(id__in=cleaned, is_active=True).values_list("id", flat=True)
        )
        missing = [str(pk) for pk in cleaned if pk not in existing]
        if missing:
            raise serializers.ValidationError(f"Unknown or inactive pharmacy branch: {missing[0]}")
        return cleaned

    def _set_allowed_pharmacies(self, instance, pharmacy_ids):
        if pharmacy_ids is None:
            return
        instance.allowed_pharmacies.set(pharmacy_ids)

    def create(self, validated_data):
        pharmacy_ids = validated_data.pop("allowed_pharmacies", None)
        validated_data.pop("email", None)
        instance = super().create(validated_data)
        if pharmacy_ids is not None:
            self._set_allowed_pharmacies(instance, pharmacy_ids)
        return instance

    def update(self, instance, validated_data):
        pharmacy_ids = validated_data.pop("allowed_pharmacies", None)
        validated_data.pop("email", None)
        instance = super().update(instance, validated_data)
        if pharmacy_ids is not None:
            self._set_allowed_pharmacies(instance, pharmacy_ids)
        return instance


class EmergencyContactSerializer(serializers.ModelSerializer):
    hospital_id = serializers.UUIDField(source="staff.hospital_id", read_only=True)

    class Meta:
        model = EmergencyContact
        fields = [
            "id",
            "hospital_id",
            "staff",
            "name",
            "relationship",
            "phone",
            "notes",
            "created_at",
            "updated_at",
        ]


class EmergencyContactCreateUpdateSerializer(serializers.ModelSerializer):
    class Meta:
        model = EmergencyContact
        fields = ["staff", "name", "relationship", "phone", "notes"]


class StaffIDProofSerializer(serializers.ModelSerializer):
    hospital_id = serializers.UUIDField(source="staff.hospital_id", read_only=True)

    class Meta:
        model = StaffIDProof
        fields = [
            "id",
            "hospital_id",
            "staff",
            "proof_type",
            "number",
            "issued_at",
            "expires_at",
            "document_metadata",
        ]


class StaffShiftAssignmentSerializer(serializers.ModelSerializer):
    hospital_id = serializers.UUIDField(read_only=True)
    staff_employee_code = serializers.CharField(source="staff.employee_code", read_only=True)
    shift_name = serializers.CharField(source="shift.name", read_only=True)

    class Meta:
        model = StaffShiftAssignment
        fields = [
            "id",
            "hospital_id",
            "staff",
            "staff_employee_code",
            "date",
            "end_date",
            "shift",
            "shift_name",
            "status",
            "assigned_by",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["assigned_by", "hospital_id"]


class StaffShiftAssignmentCreateUpdateSerializer(serializers.ModelSerializer):
    class Meta:
        model = StaffShiftAssignment
        fields = ["staff", "date", "end_date", "shift", "status"]


class StaffAvailabilityOverrideSerializer(serializers.ModelSerializer):
    hospital_id = serializers.UUIDField(read_only=True)
    staff_employee_code = serializers.CharField(source="staff.employee_code", read_only=True)

    class Meta:
        model = StaffAvailabilityOverride
        fields = [
            "id",
            "hospital_id",
            "staff",
            "staff_employee_code",
            "date",
            "is_available",
            "notes",
            "updated_by",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["updated_by", "hospital_id"]


class StaffAvailabilityOverrideCreateUpdateSerializer(serializers.ModelSerializer):
    class Meta:
        model = StaffAvailabilityOverride
        fields = ["staff", "date", "is_available", "notes"]

