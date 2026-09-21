from __future__ import annotations

from decimal import Decimal

from rest_framework import serializers

from apps.hr.attendance_compliance import COMPLIANCE_FIELD_NAMES
from apps.hr.models import Department, Designation, Employee

COMPLIANCE_API_FIELDS = COMPLIANCE_FIELD_NAMES


class AttendanceComplianceSerializerMixin(serializers.Serializer):
    late_policy_enabled = serializers.BooleanField(default=False, required=False)
    grace_minutes = serializers.IntegerField(required=False, allow_null=True, min_value=0)
    late_penalty_threshold_minutes = serializers.IntegerField(default=15, required=False, min_value=0)
    late_penalty_type = serializers.ChoiceField(
        choices=['per_minute', 'fixed_per_late_day', 'percentage_daily_salary'],
        default='per_minute',
        required=False,
    )
    late_penalty_value = serializers.DecimalField(
        max_digits=10,
        decimal_places=2,
        default=Decimal('0.00'),
        required=False,
    )
    late_conversion_enabled = serializers.BooleanField(default=False, required=False)
    late_count_for_half_day = serializers.IntegerField(required=False, allow_null=True, min_value=1)
    late_count_for_full_day = serializers.IntegerField(required=False, allow_null=True, min_value=1)
    warning_after_n_lates = serializers.IntegerField(required=False, allow_null=True, min_value=1)
    half_day_after_n_lates = serializers.IntegerField(required=False, allow_null=True, min_value=1)
    full_day_after_n_lates = serializers.IntegerField(required=False, allow_null=True, min_value=1)
    overtime_enabled = serializers.BooleanField(default=True, required=False)
    overtime_type = serializers.ChoiceField(
        choices=['fixed_per_hour', 'percentage_hourly_rate'],
        default='fixed_per_hour',
        required=False,
    )
    weekend_ot_multiplier = serializers.DecimalField(
        max_digits=5,
        decimal_places=2,
        default=Decimal('1.00'),
        required=False,
    )
    holiday_ot_multiplier = serializers.DecimalField(
        max_digits=5,
        decimal_places=2,
        default=Decimal('1.00'),
        required=False,
    )


class DepartmentSalaryStructureSerializer(serializers.ModelSerializer):
    department_name = serializers.CharField(source='department.name', read_only=True)
    designation_name = serializers.CharField(source='designation.name', read_only=True, default=None)

    class Meta:
        from apps.hr.payroll_models import DepartmentSalaryStructure

        model = DepartmentSalaryStructure
        fields = (
            'id',
            'department',
            'department_name',
            'designation',
            'designation_name',
            'name',
            'basic_salary',
            'hra',
            'allowances',
            'deductions',
            'overtime_rate',
            *COMPLIANCE_API_FIELDS,
            'effective_from',
            'effective_to',
            'is_active',
            'notes',
            'created_at',
            'updated_at',
        )
        read_only_fields = ('id', 'department_name', 'designation_name', 'created_at', 'updated_at')


class DepartmentSalaryStructureSaveSerializer(AttendanceComplianceSerializerMixin, serializers.Serializer):
    department = serializers.PrimaryKeyRelatedField(queryset=Department.objects.all())
    designation = serializers.PrimaryKeyRelatedField(
        queryset=Designation.objects.all(),
        required=False,
        allow_null=True,
    )
    name = serializers.CharField(required=False, allow_blank=True, default='')
    basic_salary = serializers.DecimalField(max_digits=12, decimal_places=2)
    hra = serializers.DecimalField(
        max_digits=12,
        decimal_places=2,
        default=Decimal('0.00'),
        required=False,
    )
    allowances = serializers.JSONField(required=False, default=dict)
    deductions = serializers.JSONField(required=False, default=dict)
    overtime_rate = serializers.DecimalField(
        max_digits=10,
        decimal_places=2,
        default=Decimal('0.00'),
        required=False,
    )
    effective_from = serializers.DateField()
    effective_to = serializers.DateField(required=False, allow_null=True)
    notes = serializers.CharField(required=False, allow_blank=True, default='')
    deactivate_previous = serializers.BooleanField(default=True, required=False)
    assign_to_employees = serializers.BooleanField(default=True, required=False)

    def validate(self, attrs):
        attrs = super().validate(attrs) if hasattr(super(), 'validate') else attrs
        designation = attrs.get('designation')
        department = attrs.get('department')
        if designation is not None:
            from apps.hr.designation_utils import validate_active_designation

            validate_active_designation(designation)
            if department and designation.hospital_id and department.hospital_id and designation.hospital_id != department.hospital_id:
                raise serializers.ValidationError({
                    'designation': 'Designation must belong to the same hospital as the department.',
                })
        if attrs.get('overtime_enabled', True) and attrs.get('overtime_type', 'fixed_per_hour') == 'fixed_per_hour':
            rate = attrs.get('overtime_rate', Decimal('0.00'))
            if rate is not None and Decimal(str(rate)) <= 0:
                raise serializers.ValidationError({
                    'overtime_rate': 'Set overtime rate per hour (₹) or disable overtime pay.',
                })
        if attrs.get('late_policy_enabled') and attrs.get('late_penalty_type') == 'per_minute':
            value = Decimal(str(attrs.get('late_penalty_value') or '0'))
            if value > Decimal('50'):
                raise serializers.ValidationError({
                    'late_penalty_value': 'Per-minute late penalty above ₹50 is unusually high. Use a lower value.',
                })
        return attrs


class DepartmentSalaryStructureAssignSerializer(serializers.Serializer):
    effective_from = serializers.DateField(required=False, allow_null=True)
    notes = serializers.CharField(required=False, allow_blank=True, default='')
    skip_employees_with_structure = serializers.BooleanField(default=True, required=False)


class SalaryStructureSerializer(serializers.ModelSerializer):
    employee_name = serializers.CharField(source='employee.name', read_only=True)
    employee_code = serializers.CharField(source='employee.employee_id', read_only=True)
    employee_department = serializers.CharField(source='employee.department', read_only=True)
    source_department_structure_name = serializers.CharField(
        source='source_department_structure.name',
        read_only=True,
        default=None,
    )

    class Meta:
        from apps.hr.payroll_models import SalaryStructure

        model = SalaryStructure
        fields = (
            'id',
            'employee',
            'employee_name',
            'employee_code',
            'employee_department',
            'source_department_structure',
            'source_department_structure_name',
            'basic_salary',
            'hra',
            'allowances',
            'deductions',
            'overtime_rate',
            *COMPLIANCE_API_FIELDS,
            'effective_from',
            'effective_to',
            'is_active',
            'notes',
            'created_at',
            'updated_at',
        )
        read_only_fields = fields


class DepartmentSalaryStructureOptionSerializer(serializers.Serializer):
    id = serializers.UUIDField()
    label = serializers.CharField()
    department_name = serializers.CharField()
    name = serializers.CharField()
    basic_salary = serializers.DecimalField(max_digits=12, decimal_places=2)
    hra = serializers.DecimalField(max_digits=12, decimal_places=2)
    allowances = serializers.JSONField()
    deductions = serializers.JSONField()
    overtime_rate = serializers.DecimalField(max_digits=10, decimal_places=2)
    effective_from = serializers.DateField()
    is_active = serializers.BooleanField()


class SalaryStructureOptionSerializer(serializers.Serializer):
    id = serializers.UUIDField()
    label = serializers.CharField()
    employee_name = serializers.CharField()
    employee_code = serializers.CharField()
    basic_salary = serializers.DecimalField(max_digits=12, decimal_places=2)
    hra = serializers.DecimalField(max_digits=12, decimal_places=2)
    allowances = serializers.JSONField()
    deductions = serializers.JSONField()
    overtime_rate = serializers.DecimalField(max_digits=10, decimal_places=2)
    effective_from = serializers.DateField()
    is_active = serializers.BooleanField()


class SalaryStructureAssignSerializer(AttendanceComplianceSerializerMixin, serializers.Serializer):
    employee = serializers.PrimaryKeyRelatedField(queryset=Employee.objects.all())
    source_structure_id = serializers.UUIDField(required=False, allow_null=True)
    source_department_structure_id = serializers.UUIDField(required=False, allow_null=True)
    basic_salary = serializers.DecimalField(
        max_digits=12,
        decimal_places=2,
        required=False,
        allow_null=True,
    )
    hra = serializers.DecimalField(
        max_digits=12,
        decimal_places=2,
        default=Decimal('0.00'),
        required=False,
    )
    allowances = serializers.JSONField(required=False, default=dict)
    deductions = serializers.JSONField(required=False, default=dict)
    overtime_rate = serializers.DecimalField(
        max_digits=10,
        decimal_places=2,
        default=Decimal('0.00'),
        required=False,
    )
    effective_from = serializers.DateField()
    effective_to = serializers.DateField(required=False, allow_null=True)
    notes = serializers.CharField(required=False, allow_blank=True, default='')
    deactivate_previous = serializers.BooleanField(default=True, required=False)

    def validate_allowances(self, value):
        if value is None:
            return {}
        return value

    def validate_deductions(self, value):
        if value is None:
            return {}
        return value

    def validate(self, attrs):
        source_id = attrs.get('source_structure_id')
        dept_source_id = attrs.get('source_department_structure_id')
        if source_id and dept_source_id:
            raise serializers.ValidationError(
                'Provide only one of source_structure_id or source_department_structure_id.',
            )
        if source_id:
            from apps.hr.payroll_models import SalaryStructure

            try:
                attrs['source_structure'] = SalaryStructure.objects.select_related('employee').get(pk=source_id)
            except SalaryStructure.DoesNotExist as exc:
                raise serializers.ValidationError({'source_structure_id': 'Salary structure not found.'}) from exc
        elif dept_source_id:
            from apps.hr.payroll_models import DepartmentSalaryStructure

            try:
                attrs['source_department_structure'] = (
                    DepartmentSalaryStructure.objects.select_related('department').get(pk=dept_source_id)
                )
            except DepartmentSalaryStructure.DoesNotExist as exc:
                raise serializers.ValidationError({
                    'source_department_structure_id': 'Department salary structure not found.',
                }) from exc
        elif attrs.get('basic_salary') is None:
            raise serializers.ValidationError({
                'basic_salary': 'Required when no source structure is provided.',
            })
        if attrs.get('source_structure') is None and attrs.get('source_department_structure') is None:
            if attrs.get('overtime_enabled', True) and attrs.get('overtime_type', 'fixed_per_hour') == 'fixed_per_hour':
                rate = attrs.get('overtime_rate', Decimal('0.00'))
                if rate is not None and Decimal(str(rate)) <= 0:
                    raise serializers.ValidationError({
                        'overtime_rate': 'Set overtime rate per hour (₹) or disable overtime pay.',
                    })
            if attrs.get('late_policy_enabled') and attrs.get('late_penalty_type') == 'per_minute':
                value = Decimal(str(attrs.get('late_penalty_value') or '0'))
                if value > Decimal('50'):
                    raise serializers.ValidationError({
                        'late_penalty_value': 'Per-minute late penalty above ₹50 is unusually high.',
                    })
        return attrs


class CompensationLevelSerializer(serializers.ModelSerializer):
    designation_name = serializers.CharField(source='designation.name', read_only=True, default=None)
    hospital_name = serializers.CharField(source='hospital.name', read_only=True)

    class Meta:
        from apps.hr.payroll_models import CompensationLevel

        model = CompensationLevel
        fields = (
            'id',
            'hospital',
            'hospital_name',
            'designation',
            'designation_name',
            'code',
            'name',
            'rank',
            'basic',
            'hra',
            'medical',
            'special_allowance',
            'allowances',
            'deductions',
            'overtime_rate',
            *COMPLIANCE_API_FIELDS,
            'effective_from',
            'effective_to',
            'is_active',
            'is_default_for_designation',
            'notes',
            'created_at',
            'updated_at',
        )
        read_only_fields = ('id', 'hospital_name', 'designation_name', 'created_at', 'updated_at')


class CompensationLevelSaveSerializer(AttendanceComplianceSerializerMixin, serializers.Serializer):
    designation = serializers.PrimaryKeyRelatedField(
        queryset=Designation.objects.all(),
        required=False,
        allow_null=True,
    )
    code = serializers.CharField()
    name = serializers.CharField(required=False, allow_blank=True, default='')
    rank = serializers.IntegerField(required=False, default=0, min_value=0)
    basic = serializers.DecimalField(max_digits=12, decimal_places=2)
    hra = serializers.DecimalField(max_digits=12, decimal_places=2, default=Decimal('0.00'), required=False)
    medical = serializers.DecimalField(max_digits=12, decimal_places=2, default=Decimal('0.00'), required=False)
    special_allowance = serializers.DecimalField(
        max_digits=12,
        decimal_places=2,
        default=Decimal('0.00'),
        required=False,
    )
    allowances = serializers.JSONField(required=False, default=dict)
    deductions = serializers.JSONField(required=False, default=dict)
    overtime_rate = serializers.DecimalField(
        max_digits=10,
        decimal_places=2,
        default=Decimal('0.00'),
        required=False,
    )
    effective_from = serializers.DateField()
    effective_to = serializers.DateField(required=False, allow_null=True)
    is_default_for_designation = serializers.BooleanField(default=False, required=False)
    notes = serializers.CharField(required=False, allow_blank=True, default='')
    deactivate_previous = serializers.BooleanField(default=True, required=False)
    assign_to_employees = serializers.BooleanField(default=False, required=False)

    def validate_basic(self, value):
        if value <= 0:
            raise serializers.ValidationError('Basic salary must be greater than zero.')
        return value

    def validate(self, attrs):
        attrs = super().validate(attrs) if hasattr(super(), 'validate') else attrs
        designation = attrs.get('designation')
        if designation is not None:
            from apps.hr.designation_utils import validate_active_designation

            validate_active_designation(designation)
        # On partial updates, designation may be omitted; only reject an explicit null.
        if attrs.get('is_default_for_designation') and 'designation' in attrs and designation is None:
            raise serializers.ValidationError({
                'designation': 'A default level must be linked to a designation.',
            })
        for field in ('hra', 'medical', 'special_allowance', 'overtime_rate'):
            amount = attrs.get(field)
            if amount is not None and amount < 0:
                raise serializers.ValidationError({field: 'Amount cannot be negative.'})
        effective_from = attrs.get('effective_from')
        effective_to = attrs.get('effective_to')
        if effective_from and effective_to and effective_to < effective_from:
            raise serializers.ValidationError({'effective_to': 'End date cannot be before start date.'})
        initial = getattr(self, 'initial_data', {}) or {}
        # Defaults on optional fields must not trigger overtime checks on partial PATCHes.
        if (
            ('overtime_rate' in initial or 'overtime_enabled' in initial)
            and attrs.get('overtime_enabled', True)
            and attrs.get('overtime_type', 'fixed_per_hour') == 'fixed_per_hour'
        ):
            rate = attrs.get('overtime_rate', Decimal('0.00'))
            if rate is not None and Decimal(str(rate)) <= 0:
                raise serializers.ValidationError({
                    'overtime_rate': 'Set overtime rate per hour (₹) or disable overtime pay.',
                })
        if (
            'late_policy_enabled' in initial
            and attrs.get('late_policy_enabled')
            and attrs.get('late_penalty_type') == 'per_minute'
        ):
            value = Decimal(str(attrs.get('late_penalty_value') or '0'))
            if value > Decimal('50'):
                raise serializers.ValidationError({
                    'late_penalty_value': 'Per-minute late penalty above ₹50 is unusually high. Use a lower value.',
                })
        return attrs


class CompensationLevelAssignSerializer(serializers.Serializer):
    effective_from = serializers.DateField(required=False, allow_null=True)
    skip_employees_with_assignment = serializers.BooleanField(default=True, required=False)


class EmployeeCompensationAssignmentSerializer(serializers.ModelSerializer):
    employee_name = serializers.CharField(source='employee.name', read_only=True)
    employee_code = serializers.CharField(source='employee.employee_id', read_only=True)
    compensation_level_code = serializers.CharField(source='compensation_level.code', read_only=True)
    compensation_level_name = serializers.CharField(source='compensation_level.name', read_only=True)
    designation_name = serializers.CharField(
        source='compensation_level.designation.name',
        read_only=True,
        default=None,
    )

    class Meta:
        from apps.hr.payroll_models import EmployeeCompensationAssignment

        model = EmployeeCompensationAssignment
        fields = (
            'id',
            'employee',
            'employee_name',
            'employee_code',
            'compensation_level',
            'compensation_level_code',
            'compensation_level_name',
            'designation_name',
            'effective_from',
            'effective_to',
            'is_active',
            'created_at',
            'updated_at',
        )
        read_only_fields = fields


class EmployeeCompensationAssignmentCreateSerializer(serializers.Serializer):
    employee = serializers.PrimaryKeyRelatedField(queryset=Employee.objects.all())
    compensation_level = serializers.UUIDField()
    effective_from = serializers.DateField()


class EmployeeCompensationOverrideSerializer(serializers.ModelSerializer):
    employee_name = serializers.CharField(source='employee.name', read_only=True)
    employee_code = serializers.CharField(source='employee.employee_id', read_only=True)
    approved_by_name = serializers.SerializerMethodField()

    class Meta:
        from apps.hr.payroll_models import EmployeeCompensationOverride

        model = EmployeeCompensationOverride
        fields = (
            'id',
            'employee',
            'employee_name',
            'employee_code',
            'basic',
            'hra',
            'medical',
            'special_allowance',
            'allowances',
            'deductions',
            'overtime_rate',
            'reason',
            'approved_by',
            'approved_by_name',
            'effective_from',
            'effective_to',
            'is_active',
            'created_at',
            'updated_at',
        )
        read_only_fields = fields

    def get_approved_by_name(self, obj):
        if not obj.approved_by:
            return None
        return getattr(obj.approved_by, 'full_name', None) or getattr(obj.approved_by, 'email', None)


class EmployeeCompensationOverrideCreateSerializer(serializers.Serializer):
    employee = serializers.PrimaryKeyRelatedField(queryset=Employee.objects.all())
    basic = serializers.DecimalField(max_digits=12, decimal_places=2, required=False, allow_null=True)
    hra = serializers.DecimalField(max_digits=12, decimal_places=2, required=False, allow_null=True)
    medical = serializers.DecimalField(max_digits=12, decimal_places=2, required=False, allow_null=True)
    special_allowance = serializers.DecimalField(
        max_digits=12,
        decimal_places=2,
        required=False,
        allow_null=True,
    )
    allowances = serializers.JSONField(required=False, allow_null=True)
    deductions = serializers.JSONField(required=False, allow_null=True)
    overtime_rate = serializers.DecimalField(max_digits=10, decimal_places=2, required=False, allow_null=True)
    effective_from = serializers.DateField()
    effective_to = serializers.DateField(required=False, allow_null=True)
    reason = serializers.CharField(required=False, allow_blank=True, default='')
    deactivate_previous = serializers.BooleanField(default=True, required=False)

    def validate(self, attrs):
        if attrs.get('effective_to') and attrs['effective_to'] < attrs['effective_from']:
            raise serializers.ValidationError({'effective_to': 'End date cannot be before start date.'})
        override_fields = (
            'basic',
            'hra',
            'medical',
            'special_allowance',
            'allowances',
            'deductions',
            'overtime_rate',
        )
        if not any(attrs.get(field) is not None for field in override_fields):
            raise serializers.ValidationError('At least one override field is required.')
        for field in ('basic', 'hra', 'medical', 'special_allowance', 'overtime_rate'):
            value = attrs.get(field)
            if value is not None and Decimal(str(value)) < Decimal('0.00'):
                raise serializers.ValidationError({field: 'Amount cannot be negative.'})
        return attrs


class PayrollGenerateSerializer(serializers.Serializer):
    month = serializers.RegexField(regex=r'^\d{4}-(0[1-9]|1[0-2])$', max_length=7)
