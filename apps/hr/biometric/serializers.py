"""REST API serializers for biometric integration."""

from rest_framework import serializers

from apps.hr.biometric.biometric_parser import get_finger_map_for_employee
from apps.hr.biometric_models import (
    BiometricDevice,
    BiometricDeviceCommand,
    BiometricRejectedPunch,
    BiometricSyncLog,
    BiometricUnlinkedUser,
)
from apps.hr.models import Employee, Gender


class BiometricDeviceSerializer(serializers.ModelSerializer):
    is_online = serializers.SerializerMethodField()
    pending_commands = serializers.SerializerMethodField()
    hospital_name = serializers.CharField(source='hospital.name', read_only=True, default=None)

    class Meta:
        model = BiometricDevice
        fields = [
            'id', 'hospital', 'hospital_name', 'serial_number', 'name', 'ip_address',
            'firmware_version', 'last_seen', 'last_time_sync', 'last_time_sync_status',
            'is_active', 'is_online', 'pending_commands', 'created_at', 'updated_at',
        ]
        read_only_fields = [
            'serial_number', 'ip_address', 'firmware_version', 'last_seen',
            'last_time_sync', 'last_time_sync_status', 'is_online', 'pending_commands',
        ]

    def get_is_online(self, obj):
        from apps.hr.biometric.device_commands import device_is_online
        return device_is_online(obj)

    def get_pending_commands(self, obj):
        from apps.hr.biometric.device_commands import pending_command_count
        return pending_command_count(obj)


class BiometricUnlinkedUserSerializer(serializers.ModelSerializer):
    linked_employee_code = serializers.CharField(
        source='linked_employee.employee_id', read_only=True, default=None,
    )
    linked_employee_name = serializers.CharField(
        source='linked_employee.name', read_only=True, default=None,
    )
    device_serial = serializers.CharField(source='device.serial_number', read_only=True, default=None)
    status_display = serializers.CharField(source='get_status_display', read_only=True)

    class Meta:
        model = BiometricUnlinkedUser
        fields = [
            'id', 'hospital', 'device', 'device_serial', 'pin', 'name', 'card_number',
            'status', 'status_display', 'linked_employee', 'linked_employee_code',
            'linked_employee_name', 'first_seen_at', 'last_seen_at', 'resolved_at',
            'resolved_by', 'created_at', 'updated_at',
        ]
        read_only_fields = [
            'hospital', 'pin', 'name', 'card_number', 'device', 'first_seen_at',
            'last_seen_at', 'linked_employee', 'resolved_at', 'resolved_by', 'status',
        ]


class BiometricCreateAndLinkSerializer(serializers.Serializer):
    name = serializers.CharField(required=False, allow_blank=True, max_length=200)
    email = serializers.EmailField()
    phone = serializers.CharField(max_length=20)
    gender = serializers.ChoiceField(choices=Gender.choices)
    department = serializers.CharField(required=False, allow_blank=True)
    department_id = serializers.UUIDField(required=False, allow_null=True)
    designation = serializers.UUIDField(required=False, allow_null=True)
    compensation_level = serializers.UUIDField(required=False, allow_null=True)
    job_title = serializers.CharField(required=False, allow_blank=True, max_length=200)
    joining_date = serializers.DateField()
    employment_type = serializers.CharField(required=False, allow_blank=True, max_length=50)
    salary = serializers.DecimalField(
        required=False, allow_null=True, max_digits=12, decimal_places=2,
    )


class BiometricSyncLogSerializer(serializers.ModelSerializer):
    employee_code = serializers.CharField(source='employee.employee_id', read_only=True, default=None)
    device_serial = serializers.CharField(source='device.serial_number', read_only=True, default=None)

    class Meta:
        model = BiometricSyncLog
        fields = '__all__'


class BiometricRejectedPunchSerializer(serializers.ModelSerializer):
    employee_name = serializers.CharField(source='employee.name', read_only=True, default=None)
    employee_code = serializers.CharField(source='employee.employee_id', read_only=True, default=None)
    device_serial = serializers.CharField(source='device.serial_number', read_only=True, default=None)

    class Meta:
        model = BiometricRejectedPunch
        fields = '__all__'


class BiometricLinkSerializer(serializers.Serializer):
    employee_id = serializers.UUIDField()


class EmployeeBiometricSummarySerializer(serializers.Serializer):
    biometric_pin = serializers.CharField(read_only=True)
    biometric_attendance_enabled = serializers.BooleanField(read_only=True)
    biometric_sync_status = serializers.CharField(read_only=True)
    biometric_last_synced_at = serializers.DateTimeField(read_only=True)
    enrollment = serializers.SerializerMethodField()

    def get_enrollment(self, obj: Employee):
        return get_finger_map_for_employee(obj)
