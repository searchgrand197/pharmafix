import re
from datetime import timedelta
from decimal import Decimal

from django.conf import settings
from django.db import models, transaction
from django.utils import timezone
from rest_framework import serializers
from apps.shared.models import Hospital
from apps.hr.models import (
    Employee, Department, Designation, Role, Attendance, LeaveType, LeavePolicy, LeavePolicyLine,
    LeaveBalance, LeaveRequest, Leave, Salary,
    JobOpening, Candidate, Interview, PerformanceReview, OfferTemplate,
    Offer, ComponentOfferTemplate, OfferBuilderV2, OfferLetterSettings, EmployeeDocument,
    DocumentType, EmployeeDocumentRequirement, Shift,
    JobDocumentRequirement, ApplicationDocumentRequirement,
    EmployeeShift, AttendancePunch, DailyAttendance, AttendanceRegularization,
    EmployeeStatusHistory, record_employee_status_history,
)
from apps.hr.candidate_pipeline import compute_pipeline_stage, PIPELINE_STAGE_LABEL
from apps.hr.leave_services import (
    apply_policy_balances,
    get_assigned_leave_types,
    has_sufficient_balance,
    leave_type_allows_unpaid,
)
from apps.shared.email_normalization import normalize_email_address
from apps.shared.serializer_mixins import NormalizeEmailFieldsSerializerMixin, EmployeeEmailSerializerMixin
from apps.hr.designation_utils import (
    resolve_designation_display,
    sync_designation_from_job_title,
    sync_job_title_from_designation,
    sync_title_from_designation,
    validate_active_designation,
    validate_designation_hospital,
    resolve_designation_link_from_job_title,
    resolve_employee_hospital_id,
    LINK_LINKED,
)

class DepartmentSerializer(serializers.ModelSerializer):
    employee_count = serializers.SerializerMethodField()

    class Meta:
        model = Department
        fields = '__all__'
        extra_kwargs = {
            'hospital': {'required': False}
        }

    def get_employee_count(self, obj):
        if hasattr(obj, 'employee_count'):
            return obj.employee_count
        return obj.employees.count()

    def validate(self, attrs):
        request = self.context.get('request')
        if not request or not request.user:
            raise serializers.ValidationError('User authentication required.')

        # Allow superusers to bypass hospital requirement
        if not request.user.is_superuser:
            if not hasattr(request.user, 'hospital_id') or not request.user.hospital_id:
                raise serializers.ValidationError('User must be associated with a hospital.')

        return attrs

    def create(self, validated_data):
        request = self.context.get('request')
        if request and hasattr(request.user, 'hospital_id') and request.user.hospital_id:
            validated_data['hospital_id'] = request.user.hospital_id
        return super().create(validated_data)


class DesignationSerializer(serializers.ModelSerializer):
    department_name = serializers.CharField(source='department.name', read_only=True, default=None)
    employee_count = serializers.SerializerMethodField()
    job_opening_count = serializers.SerializerMethodField()
    salary_structure_count = serializers.SerializerMethodField()

    class Meta:
        model = Designation
        fields = '__all__'
        read_only_fields = ('hospital', 'code', 'level')

    def get_employee_count(self, obj):
        return obj.employees.count()

    def get_job_opening_count(self, obj):
        return obj.job_openings.count()

    def get_salary_structure_count(self, obj):
        return obj.salary_structures.count()

    def validate_name(self, value):
        name = (value or '').strip()
        if not name:
            raise serializers.ValidationError('Name is required.')
        hospital_id = self.context.get('hospital_id') or getattr(self.instance, 'hospital_id', None)
        qs = Designation.objects.filter(name__iexact=name)
        if hospital_id:
            qs = qs.filter(hospital_id=hospital_id)
        if self.instance:
            qs = qs.exclude(pk=self.instance.pk)
        if qs.exists():
            raise serializers.ValidationError('Designation name must be unique per hospital.')
        return name

    def validate_code(self, value):
        code = (value or '').strip().upper()
        if not code:
            return ''
        hospital_id = self.context.get('hospital_id') or getattr(self.instance, 'hospital_id', None)
        qs = Designation.objects.filter(code__iexact=code)
        if hospital_id:
            qs = qs.filter(hospital_id=hospital_id)
        if self.instance:
            qs = qs.exclude(pk=self.instance.pk)
        if qs.exists():
            raise serializers.ValidationError('Designation code must be unique per hospital.')
        return code

    def validate(self, attrs):
        request = self.context.get('request')
        if not request or not request.user:
            raise serializers.ValidationError('User authentication required.')
        if not request.user.is_superuser:
            if not getattr(request.user, 'hospital_id', None):
                raise serializers.ValidationError('User must be associated with a hospital.')

        hospital_id = self.context.get('hospital_id') or getattr(self.instance, 'hospital_id', None)
        department = attrs.get('department', getattr(self.instance, 'department', None))
        if department is not None and hospital_id and department.hospital_id and department.hospital_id != hospital_id:
            raise serializers.ValidationError({'department': 'Department must belong to the same hospital.'})
        return attrs

class RoleSerializer(serializers.ModelSerializer):
    class Meta:
        model = Role
        fields = '__all__'


class EmployeeStatusHistorySerializer(serializers.ModelSerializer):
    event_type_display = serializers.CharField(source='get_event_type_display', read_only=True)
    previous_status_display = serializers.SerializerMethodField()
    new_status_display = serializers.SerializerMethodField()
    exit_reason_display = serializers.SerializerMethodField()
    changed_by_name = serializers.SerializerMethodField()

    class Meta:
        model = EmployeeStatusHistory
        fields = (
            'id',
            'employee',
            'event_type',
            'event_type_display',
            'previous_status',
            'previous_status_display',
            'new_status',
            'new_status_display',
            'exit_reason',
            'exit_reason_display',
            'notes',
            'conduct_remarks',
            'relieving_date',
            'eligible_for_rehire',
            'changed_by',
            'changed_by_name',
            'changed_at',
            'created_at',
        )
        read_only_fields = fields

    def get_previous_status_display(self, obj):
        return dict(Employee.STATUS_CHOICES).get(obj.previous_status, obj.previous_status or '—')

    def get_new_status_display(self, obj):
        return dict(Employee.STATUS_CHOICES).get(obj.new_status, obj.new_status or '—')

    def get_exit_reason_display(self, obj):
        return dict(Employee.EXIT_REASON_CHOICES).get(obj.exit_reason, obj.exit_reason or '—')

    def get_changed_by_name(self, obj):
        if not obj.changed_by:
            return None
        return getattr(obj.changed_by, 'full_name', None) or getattr(obj.changed_by, 'email', None)

class EmployeeSerializer(EmployeeEmailSerializerMixin, serializers.ModelSerializer):
    onboarding_status_display = serializers.CharField(source='get_onboarding_status_display', read_only=True)
    status_display = serializers.CharField(source='get_status_display', read_only=True)
    exit_reason_display = serializers.CharField(source='get_exit_reason_display', read_only=True)
    hire_context = serializers.SerializerMethodField()
    application_rejected = serializers.SerializerMethodField()
    department_name = serializers.CharField(source='department_ref.name', read_only=True, default=None)
    designation_name = serializers.CharField(source='designation.name', read_only=True, default=None)
    shift_name = serializers.CharField(source='shift.name', read_only=True)
    shift_code = serializers.CharField(source='shift.code', read_only=True)
    shift_start_time = serializers.TimeField(source='shift.start_time', read_only=True)
    shift_end_time = serializers.TimeField(source='shift.end_time', read_only=True)
    shift_is_overnight = serializers.BooleanField(source='shift.is_overnight', read_only=True)
    shift_active = serializers.BooleanField(source='shift.active', read_only=True)
    biometric_enrollment = serializers.SerializerMethodField()
    last_working_day_confirmed_by_name = serializers.SerializerMethodField()
    auto_assign_department_salary = serializers.BooleanField(
        write_only=True,
        required=False,
        default=False,
        help_text='When true, assign the active department salary structure if the employee has none.',
    )
    compensation_level = serializers.UUIDField(
        write_only=True,
        required=False,
        allow_null=True,
        help_text='Optional compensation level to assign when creating or activating an employee.',
    )

    class Meta:
        model = Employee
        fields = '__all__'

    def get_hire_context(self, obj):
        from apps.hr.manual_employee import get_direct_office_hire_context

        return get_direct_office_hire_context(obj)

    def get_application_rejected(self, obj):
        from apps.hr.document_moderation import is_application_rejected

        return is_application_rejected(obj)

    def get_biometric_enrollment(self, obj):
        from apps.hr.biometric.biometric_parser import get_finger_map_for_employee
        if not obj.biometric_pin:
            return None
        return get_finger_map_for_employee(obj)

    def get_last_working_day_confirmed_by_name(self, obj):
        if not obj.last_working_day_confirmed_by:
            return None
        return (
            getattr(obj.last_working_day_confirmed_by, 'full_name', None)
            or getattr(obj.last_working_day_confirmed_by, 'email', None)
        )

    def _sync_department_fields(self, attrs):
        department_ref = attrs.get('department_ref', getattr(self.instance, 'department_ref', None))
        if department_ref is not None:
            attrs['department'] = department_ref.name
        return attrs

    def _validate_designation(self, attrs):
        hospital_id = attrs.get('hospital_id') or getattr(self.instance, 'hospital_id', None)
        if hospital_id is None and self.context.get('request'):
            from apps.hr.hospital_context import resolve_hr_hospital_id

            hospital_id = resolve_hr_hospital_id(self.context['request'])

        attrs = sync_designation_from_job_title(attrs, self.instance, hospital_id=hospital_id)

        designation = attrs.get('designation')
        if designation is None and self.instance is not None and 'designation' not in attrs:
            return attrs
        if designation is None:
            return attrs

        if hospital_id is None:
            hospital_id = attrs.get('hospital_id') or getattr(self.instance, 'hospital_id', None)
            if hospital_id is None and self.context.get('request'):
                from apps.hr.hospital_context import resolve_hr_hospital_id

                hospital_id = resolve_hr_hospital_id(self.context['request'])

        validate_active_designation(designation)
        validate_designation_hospital(designation, hospital_id)
        return sync_job_title_from_designation(attrs, self.instance)

    def validate(self, attrs):
        attrs = self._sync_department_fields(attrs)
        attrs = self._validate_designation(attrs)
        attrs = super().validate(attrs)

        new_status = attrs.get('status', getattr(self.instance, 'status', None))
        old_status = getattr(self.instance, 'status', None) if self.instance else None
        if new_status == 'active' and old_status != 'active':
            has_designation = attrs.get('designation') is not None
            if not has_designation and self.instance and self.instance.designation_id:
                has_designation = True
            if not has_designation:
                title = (attrs.get('job_title') or getattr(self.instance, 'job_title', None) or '').strip()
                hospital_id = attrs.get('hospital_id') or getattr(self.instance, 'hospital_id', None)
                if not hospital_id and self.instance:
                    hospital_id = resolve_employee_hospital_id(self.instance)
                result = resolve_designation_link_from_job_title(
                    hospital_id=hospital_id,
                    job_title=title,
                )
                if result.status == LINK_LINKED and result.designation is not None:
                    attrs['designation'] = result.designation
                    attrs['job_title'] = result.designation.name
                else:
                    if result.status == 'multiple_matches':
                        raise serializers.ValidationError({
                            'designation': (
                                f'Multiple designations match job title "{title}". '
                                'Assign one explicitly before activating.'
                            ),
                        })
                    raise serializers.ValidationError({
                        'designation': (
                            f'Cannot activate without a linked designation. '
                            f'No designation matches job title "{title or "—"}".'
                        ),
                    })
        return attrs

    def create(self, validated_data):
        auto_assign = validated_data.pop('auto_assign_department_salary', False)
        compensation_level_id = validated_data.pop('compensation_level', None)
        employee = super().create(validated_data)
        if auto_assign:
            from apps.hr.payroll_api.department_structure_service import auto_assign_from_employee_department

            auto_assign_from_employee_department(employee)
        elif employee.status == 'active' and employee.designation_id:
            from apps.hr.payroll_api.compensation_level_service import assign_employee_compensation_or_default

            assign_employee_compensation_or_default(
                employee=employee,
                compensation_level_id=compensation_level_id,
            )
        if employee.status == 'active':
            from apps.hr.leave_services import ensure_employee_leave_balances

            ensure_employee_leave_balances(employee)
        return employee

    def update(self, instance, validated_data):
        auto_assign = validated_data.pop('auto_assign_department_salary', False)
        compensation_level_id = validated_data.pop('compensation_level', None)
        previous_department_ref_id = instance.department_ref_id
        previous_status = instance.status
        previous_designation_id = instance.designation_id
        previous_exit_snapshot = {
            'exit_reason': instance.exit_reason,
            'exit_notes': getattr(instance, 'exit_notes', ''),
            'conduct_remarks': instance.conduct_remarks,
            'relieving_date': instance.relieving_date,
            'eligible_for_rehire': getattr(instance, 'eligible_for_rehire', True),
        }
        if 'joining_date' in validated_data:
            # HR edits joining_date on the profile — keep confirmed date in sync for display & payroll.
            validated_data['joining_date_confirmed'] = validated_data['joining_date']
        employee = super().update(instance, validated_data)
        department_changed = employee.department_ref_id != previous_department_ref_id
        designation_changed = (
            'designation' in validated_data
            and employee.designation_id != previous_designation_id
        )
        if auto_assign or department_changed or designation_changed:
            from apps.hr.payroll_api.department_structure_service import auto_assign_from_employee_department

            auto_assign_from_employee_department(employee)
        # Provision leave when activated, or when dept/designation changes while already active
        # (salary auto-assign already runs on dept change; leave must keep pace).
        if employee.status == 'active' and (
            previous_status != 'active' or department_changed or designation_changed
        ):
            from apps.hr.leave_services import ensure_employee_leave_balances

            ensure_employee_leave_balances(employee)
        if employee.status == 'active' and previous_status != 'active':
            if employee.designation_id:
                from apps.hr.payroll_api.compensation_level_service import assign_employee_compensation_or_default

                assign_employee_compensation_or_default(
                    employee=employee,
                    compensation_level_id=compensation_level_id,
                )
        elif compensation_level_id and employee.status == 'active' and employee.designation_id:
            from apps.hr.payroll_api.compensation_level_service import assign_employee_compensation_or_default

            assign_employee_compensation_or_default(
                employee=employee,
                compensation_level_id=compensation_level_id,
            )
        if employee.status != previous_status:
            request = self.context.get('request')
            changed_by = getattr(request, 'user', None) if request else None
            event_type = EmployeeStatusHistory.EVENT_STATUS_CHANGE
            exit_reason = ''
            notes = ''
            conduct_remarks = ''
            relieving_date = None
            eligible_for_rehire = getattr(employee, 'eligible_for_rehire', True)
            if employee.status in {'inactive', 'terminated'}:
                event_type = EmployeeStatusHistory.EVENT_EXIT
                exit_reason = employee.exit_reason
                notes = getattr(employee, 'exit_notes', '')
                conduct_remarks = employee.conduct_remarks
                relieving_date = employee.relieving_date
            elif previous_status in {'inactive', 'terminated'} and employee.status == 'active':
                event_type = EmployeeStatusHistory.EVENT_RESTORE
                exit_reason = previous_exit_snapshot['exit_reason']
                notes = 'Employee restored to active via profile update.'
                conduct_remarks = previous_exit_snapshot['conduct_remarks']
                relieving_date = previous_exit_snapshot['relieving_date']
                eligible_for_rehire = previous_exit_snapshot['eligible_for_rehire']
            record_employee_status_history(
                employee,
                previous_status=previous_status,
                new_status=employee.status,
                event_type=event_type,
                exit_reason=exit_reason,
                notes=notes,
                conduct_remarks=conduct_remarks,
                relieving_date=relieving_date,
                eligible_for_rehire=eligible_for_rehire,
                changed_by=changed_by,
            )
        return employee

class AttendanceSerializer(serializers.ModelSerializer):
    employee_name = serializers.CharField(source='employee.name', read_only=True)
    class Meta:
        model = Attendance
        fields = '__all__'


class ShiftSerializer(serializers.ModelSerializer):
    employee_count = serializers.SerializerMethodField()
    daily_attendance_count = serializers.SerializerMethodField()
    hospital_name = serializers.CharField(source='hospital.name', read_only=True)

    class Meta:
        model = Shift
        fields = '__all__'
        validators = []
        extra_kwargs = {
            'hospital': {'required': False},
        }

    @staticmethod
    def _unique_shift_code(hospital, base_code, *, exclude_pk=None):
        """Append a numeric suffix when the suggested code is already taken."""
        qs = Shift.objects.filter(hospital=hospital)
        if exclude_pk:
            qs = qs.exclude(pk=exclude_pk)
        existing = {str(code or '').upper() for code in qs.values_list('code', flat=True) if code}

        candidate = str(base_code or '').strip().upper()
        if not candidate:
            candidate = 'SHIFT'
        if candidate not in existing:
            return candidate

        counter = 2
        while counter < 1000:
            suffix = str(counter)
            prefix = candidate[: max(1, 30 - len(suffix))]
            next_candidate = f'{prefix}{suffix}'
            if next_candidate not in existing:
                return next_candidate
            counter += 1
        raise serializers.ValidationError({'code': 'Could not generate a unique shift code.'})

    def get_employee_count(self, obj):
        return obj.employees.count()

    def get_daily_attendance_count(self, obj):
        return obj.daily_attendance.count()

    def validate_code(self, value):
        if value is None:
            return value
        value = str(value).strip().upper()
        if not value:
            raise serializers.ValidationError('Shift code is required.')
        return value

    def validate(self, attrs):
        name = (attrs.get('name') or getattr(self.instance, 'name', '') or '').strip()
        code = (attrs.get('code') or getattr(self.instance, 'code', '') or '').strip().upper()
        hospital = attrs.get('hospital', getattr(self.instance, 'hospital', None))
        request = self.context.get('request')
        if not hospital and request and getattr(request.user, 'hospital_id', None):
            hospital = request.user.hospital
        start_time = attrs.get('start_time', getattr(self.instance, 'start_time', None))
        end_time = attrs.get('end_time', getattr(self.instance, 'end_time', None))
        half_day_hours = attrs.get('half_day_hours', getattr(self.instance, 'half_day_hours', Decimal('0')))
        full_day_hours = attrs.get('full_day_hours', getattr(self.instance, 'full_day_hours', Decimal('0')))
        grace_minutes = attrs.get('grace_minutes', getattr(self.instance, 'grace_minutes', 0))
        is_overnight = attrs.get('is_overnight', getattr(self.instance, 'is_overnight', False))

        if not name:
            raise serializers.ValidationError({'name': 'Shift name is required.'})
        if not code:
            raise serializers.ValidationError({'code': 'Shift code is required.'})
        if not start_time:
            raise serializers.ValidationError({'start_time': 'Start time is required.'})
        if not end_time:
            raise serializers.ValidationError({'end_time': 'End time is required.'})
        if not is_overnight and start_time >= end_time:
            raise serializers.ValidationError({
                'end_time': 'End time must be after start time unless overnight shift is enabled.',
            })
        if grace_minutes is not None and int(grace_minutes) < 0:
            raise serializers.ValidationError({'grace_minutes': 'Grace minutes cannot be negative.'})
        if Decimal(str(half_day_hours)) <= 0:
            raise serializers.ValidationError({'half_day_hours': 'Half-day hours must be greater than zero.'})
        if Decimal(str(full_day_hours)) <= 0:
            raise serializers.ValidationError({'full_day_hours': 'Full-day hours must be greater than zero.'})
        if Decimal(str(half_day_hours)) >= Decimal(str(full_day_hours)):
            raise serializers.ValidationError({
                'half_day_hours': 'Half-day hours must be less than full-day hours.',
            })
        if hospital:
            existing = Shift.objects.filter(hospital=hospital).exclude(pk=getattr(self.instance, 'pk', None))
            if existing.filter(code__iexact=code).exists():
                code = self._unique_shift_code(
                    hospital,
                    code,
                    exclude_pk=getattr(self.instance, 'pk', None),
                )
            if existing.filter(name__iexact=name).exists():
                raise serializers.ValidationError({'name': 'A shift with this name already exists.'})
        elif not self.instance:
            raise serializers.ValidationError({
                'hospital': 'Hospital is required. Select a hospital or assign a hospital to your user account.',
            })

        attrs['name'] = name
        attrs['code'] = code
        if hospital:
            attrs['hospital'] = hospital
        return attrs


class HospitalContextSerializer(serializers.ModelSerializer):
    class Meta:
        model = Hospital
        fields = ('id', 'name')


class EmployeeShiftSerializer(serializers.ModelSerializer):
    employee_name = serializers.CharField(source='employee.name', read_only=True)
    employee_id_display = serializers.CharField(source='employee.employee_id', read_only=True)
    shift_name = serializers.CharField(source='shift.name', read_only=True)
    shift_code = serializers.CharField(source='shift.code', read_only=True)
    shift_start_time = serializers.TimeField(source='shift.start_time', read_only=True)
    shift_end_time = serializers.TimeField(source='shift.end_time', read_only=True)
    shift_is_overnight = serializers.BooleanField(source='shift.is_overnight', read_only=True)
    assignment_status = serializers.SerializerMethodField()

    class Meta:
        model = EmployeeShift
        fields = '__all__'
        read_only_fields = ('assigned_by',)

    def get_assignment_status(self, obj):
        today = timezone.localdate()
        if obj.effective_from and obj.effective_from > today:
            return 'scheduled'
        if obj.effective_to and obj.effective_to < today:
            return 'ended'
        return 'active'

    def validate(self, attrs):
        employee = attrs.get('employee', getattr(self.instance, 'employee', None))
        shift = attrs.get('shift', getattr(self.instance, 'shift', None))
        effective_from = attrs.get('effective_from', getattr(self.instance, 'effective_from', None))
        effective_to = attrs.get('effective_to', getattr(self.instance, 'effective_to', None))

        if not employee:
            raise serializers.ValidationError({'employee': 'Employee is required.'})
        if not shift:
            raise serializers.ValidationError({'shift': 'Shift is required.'})
        if shift and not shift.active:
            raise serializers.ValidationError({'shift': 'Cannot assign an inactive shift.'})
        if effective_from and effective_to and effective_to < effective_from:
            raise serializers.ValidationError({'effective_to': 'End date cannot be before start date.'})
        if shift and employee and shift.hospital_id and employee.hospital_id and shift.hospital_id != employee.hospital_id:
            raise serializers.ValidationError({'shift': 'Shift and employee must belong to the same hospital.'})
        return attrs

    def create(self, validated_data):
        request = self.context.get('request')
        with transaction.atomic():
            employee = validated_data['employee']
            shift = validated_data['shift']

            EmployeeShift.objects.filter(employee=employee, is_primary=True).update(is_primary=False)
            assignment = EmployeeShift.objects.create(
                **validated_data,
                is_primary=True,
                assigned_by=getattr(request, 'user', None) if request else None,
            )
            employee.shift = shift
            employee.save(update_fields=['shift', 'updated_at'])
        return assignment

    def update(self, instance, validated_data):
        with transaction.atomic():
            assignment = super().update(instance, validated_data)
            if assignment.is_primary:
                assignment.employee.shift = assignment.shift
                assignment.employee.save(update_fields=['shift', 'updated_at'])
        return assignment


class AttendancePunchSerializer(serializers.ModelSerializer):
    employee_name = serializers.CharField(source='employee.name', read_only=True)
    employee_id_display = serializers.CharField(source='employee.employee_id', read_only=True)
    shift_name = serializers.CharField(source='shift.name', read_only=True)
    shift_code = serializers.CharField(source='shift.code', read_only=True)
    punch_type_display = serializers.CharField(source='get_punch_type_display', read_only=True)
    source_display = serializers.CharField(source='get_source_display', read_only=True)
    created_by_name = serializers.SerializerMethodField()
    punch_date = serializers.DateField(required=False, write_only=True, allow_null=True)
    punch_time = serializers.CharField(required=False, write_only=True, allow_blank=True, allow_null=True)

    class Meta:
        model = AttendancePunch
        fields = '__all__'
        read_only_fields = (
            'created_by',
            'shift',
            'attendance_date',
            'is_suspicious',
            'suspicious_reason',
            'duplicate_of',
            'voided_at',
            'voided_by',
        )
        extra_kwargs = {
            'timestamp': {'required': False, 'allow_null': True},
        }

    def get_created_by_name(self, obj):
        if not obj.created_by:
            return None
        return getattr(obj.created_by, 'full_name', None) or getattr(obj.created_by, 'email', None)

    def _attendance_date_for(self, employee, timestamp, punch_type):
        shift = employee.shift
        from apps.hr.attendance_policy import attendance_localtime

        local_ts = attendance_localtime(timestamp)
        attendance_date = local_ts.date()

        if (
            shift
            and shift.is_overnight
            and shift.start_time
            and shift.end_time
            and punch_type == 'OUT'
        ):
            local_time = local_ts.time()
            if local_time <= shift.end_time:
                attendance_date = (local_ts - timedelta(days=1)).date()
        return shift, attendance_date

    def _validate_employee_active_for_manual_punch(self, employee, source: str | None) -> None:
        if source not in {'HR_manual', 'employee_portal'}:
            return
        if employee.status != 'active':
            raise serializers.ValidationError(
                {'employee': f'Employee is not active (status={employee.status}).'},
            )

    def _validate_punch_sequence(self, employee, attendance_date, punch_type: str) -> None:
        from apps.hr.biometric.punch_pairing import punches_for_work_date, suggest_next_punch_type

        prior = punches_for_work_date(employee, attendance_date)
        expected = suggest_next_punch_type(prior)
        if punch_type != expected:
            raise serializers.ValidationError(
                {
                    'punch_type': (
                        f'Expected {expected} for this working day based on existing punches; '
                        f'got {punch_type}.'
                    ),
                },
            )

    def validate(self, attrs):
        employee = attrs.get('employee', getattr(self.instance, 'employee', None))
        timestamp = attrs.get('timestamp', getattr(self.instance, 'timestamp', None))
        punch_date = attrs.pop('punch_date', None)
        punch_time = (attrs.pop('punch_time', None) or '').strip() or None
        punch_type = attrs.get('punch_type', getattr(self.instance, 'punch_type', None))
        source = attrs.get('source', getattr(self.instance, 'source', None))
        correction_reason = attrs.get('correction_reason', getattr(self.instance, 'correction_reason', ''))

        if not employee:
            raise serializers.ValidationError({'employee': 'Employee is required.'})
        from apps.hr.attendance_policy import resolve_punch_timestamp

        if punch_date and punch_time:
            attrs['timestamp'] = resolve_punch_timestamp(punch_date=punch_date, punch_time=punch_time)
        elif timestamp:
            attrs['timestamp'] = resolve_punch_timestamp(timestamp=timestamp)
        else:
            raise serializers.ValidationError(
                {'timestamp': 'Punch timestamp or punch_date + punch_time is required.'},
            )
        timestamp = attrs['timestamp']
        if timestamp > timezone.now() + timedelta(minutes=1):
            raise serializers.ValidationError({'timestamp': 'Future punch timestamps are not allowed.'})
        if source == 'HR_manual' and not str(correction_reason or '').strip():
            raise serializers.ValidationError({'correction_reason': 'Correction reason is required for HR manual punches.'})

        self._validate_employee_active_for_manual_punch(employee, source)

        if self.instance is None and punch_type in {'IN', 'OUT'}:
            _, attendance_date = self._attendance_date_for(employee, timestamp, punch_type)
            self._validate_punch_sequence(employee, attendance_date, punch_type)

        return attrs

    def create(self, validated_data):
        request = self.context.get('request')
        employee = validated_data['employee']
        timestamp = validated_data['timestamp']
        punch_type = validated_data.get('punch_type')
        shift, attendance_date = self._attendance_date_for(employee, timestamp, punch_type)

        threshold = int(self.context.get('duplicate_threshold_minutes', 2))
        window_start = timestamp - timedelta(minutes=threshold)
        window_end = timestamp + timedelta(minutes=threshold)
        duplicate = AttendancePunch.objects.filter(
            employee=employee,
            punch_type=validated_data.get('punch_type'),
            timestamp__gte=window_start,
            timestamp__lte=window_end,
            is_void=False,
        ).order_by('timestamp').first()

        if duplicate:
            validated_data['is_suspicious'] = True
            validated_data['duplicate_of'] = duplicate
            validated_data['suspicious_reason'] = (
                f"Possible duplicate punch within {threshold} minute(s) of {duplicate.timestamp.isoformat()}."
            )

        validated_data['shift'] = shift
        validated_data['attendance_date'] = attendance_date
        if request and getattr(request, 'user', None) and request.user.is_authenticated:
            validated_data['created_by'] = request.user
        return super().create(validated_data)

    def update(self, instance, validated_data):
        validated_data.pop('punch_date', None)
        validated_data.pop('punch_time', None)
        employee = validated_data.get('employee', instance.employee)
        timestamp = validated_data.get('timestamp', instance.timestamp)
        punch_type = validated_data.get('punch_type', instance.punch_type)
        shift, attendance_date = self._attendance_date_for(employee, timestamp, punch_type)
        validated_data['shift'] = shift
        validated_data['attendance_date'] = attendance_date
        return super().update(instance, validated_data)


class DailyAttendanceSerializer(serializers.ModelSerializer):
    employee_name = serializers.CharField(source='employee.name', read_only=True)
    employee_id_display = serializers.CharField(source='employee.employee_id', read_only=True)
    employee_department = serializers.CharField(source='employee.department', read_only=True)
    shift_name = serializers.CharField(source='shift.name', read_only=True)
    shift_code = serializers.CharField(source='shift.code', read_only=True)
    shift_start_time = serializers.TimeField(source='shift.start_time', read_only=True)
    leave_type_name = serializers.CharField(source='leave_type.name', read_only=True)
    attendance_status_display = serializers.CharField(source='get_attendance_status_display', read_only=True)
    is_early_arrival = serializers.SerializerMethodField()
    worked_hours = serializers.DecimalField(
        source='total_work_hours',
        max_digits=6,
        decimal_places=2,
        read_only=True,
    )

    class Meta:
        model = DailyAttendance
        fields = '__all__'

    def get_is_early_arrival(self, obj) -> bool:
        from apps.hr.attendance_policy import is_early_arrival

        shift = obj.shift or getattr(obj.employee, 'shift', None)
        if not obj.first_check_in or not shift:
            return False
        return is_early_arrival(obj.first_check_in, obj.date, shift)


class AttendanceRegularizationSerializer(serializers.ModelSerializer):
    employee_name = serializers.CharField(source='employee.name', read_only=True)
    reviewed_by_name = serializers.SerializerMethodField()

    class Meta:
        model = AttendanceRegularization
        fields = '__all__'

    def get_reviewed_by_name(self, obj):
        if not obj.reviewed_by:
            return None
        return getattr(obj.reviewed_by, 'full_name', None) or getattr(obj.reviewed_by, 'email', None)


class AttendanceMarkSerializer(serializers.Serializer):
    """Payload for HR biometric simulation attendance control."""

    employee_id = serializers.CharField()
    date = serializers.DateField()
    status = serializers.ChoiceField(
        choices=[(value, value) for value in sorted({'PRESENT', 'ABSENT', 'LATE', 'HALF_DAY'})],
    )
    check_in = serializers.CharField(required=False, allow_blank=True, allow_null=True)
    check_out = serializers.CharField(required=False, allow_blank=True, allow_null=True)
    replace_existing = serializers.BooleanField(default=False)


class AttendanceSimulatePunchSerializer(serializers.Serializer):
    """Single tap on the biometric simulator (IN or OUT at current time)."""

    employee_id = serializers.CharField()
    punch_type = serializers.ChoiceField(choices=[('IN', 'IN'), ('OUT', 'OUT')])
    timestamp = serializers.DateTimeField(required=False, allow_null=True)
    punch_date = serializers.DateField(required=False, allow_null=True)
    punch_time = serializers.CharField(required=False, allow_blank=True, allow_null=True)

    def validate(self, attrs):
        punch_time = (attrs.get('punch_time') or '').strip()
        punch_date = attrs.get('punch_date')
        if not punch_date or not punch_time:
            raise serializers.ValidationError(
                'punch_date and punch_time are required (simulator uses your device clock, not server time).',
            )
        attrs['punch_time'] = punch_time
        return attrs


class GenerateTestAttendanceSerializer(serializers.Serializer):
    """Seed a month of real punches + engine-calculated DailyAttendance rows."""

    employee_ids = serializers.ListField(
        child=serializers.CharField(),
        required=False,
        allow_empty=True,
        help_text='Empty = all active employees with a shift.',
    )
    month = serializers.IntegerField(min_value=1, max_value=12)
    year = serializers.IntegerField(min_value=2000, max_value=2100)
    scenario = serializers.CharField()
    holiday_dates = serializers.ListField(
        child=serializers.DateField(),
        required=False,
        default=list,
    )
    replace_existing = serializers.BooleanField(default=True)


class EmployeeLeaveApplySerializer(serializers.Serializer):
    """Employee portal — apply leave for the authenticated employee only."""

    leave_type = serializers.PrimaryKeyRelatedField(queryset=LeaveType.objects.all())
    start_date = serializers.DateField()
    end_date = serializers.DateField()
    reason = serializers.CharField(required=False, allow_blank=True, default='')
    attachment = serializers.FileField(required=False, allow_null=True)

    def validate(self, attrs):
        employee = self.context.get('employee')
        if not employee:
            raise serializers.ValidationError('Employee profile is required.')
        if employee.status != 'active':
            raise serializers.ValidationError('Leave cannot be applied while employee status is not active.')

        leave_type = attrs['leave_type']
        start_date = attrs['start_date']
        end_date = attrs['end_date']

        if start_date > end_date:
            raise serializers.ValidationError({'end_date': 'End date cannot be before start date.'})
        if not getattr(settings, 'HR_ALLOW_PAST_LEAVE_REQUESTS', False) and start_date < timezone.localdate():
            raise serializers.ValidationError({'start_date': 'Past leave dates are not allowed.'})

        if getattr(employee, 'hospital_id', None) and getattr(leave_type, 'hospital_id', None):
            if employee.hospital_id != leave_type.hospital_id:
                raise serializers.ValidationError({'leave_type': 'Leave type is not available for your hospital.'})
        if not leave_type.is_active:
            raise serializers.ValidationError({'leave_type': 'This leave type is not active.'})

        assigned_ids = set(get_assigned_leave_types(employee).values_list('id', flat=True))
        if assigned_ids and leave_type.id not in assigned_ids:
            raise serializers.ValidationError({'leave_type': 'This leave type is not assigned to you via leave policy.'})

        number_of_days = LeaveRequestSerializer.calculate_days(start_date, end_date)
        overlap_qs = LeaveRequest.objects.filter(
            employee=employee,
            status__in=[LeaveRequest.STATUS_APPROVED, LeaveRequest.STATUS_PENDING],
            start_date__lte=end_date,
            end_date__gte=start_date,
        )
        if overlap_qs.exists():
            raise serializers.ValidationError({'date_range': 'You already have a pending or approved leave overlapping these dates.'})

        from apps.hr.holiday_services import leave_range_holiday_message

        holiday_message = leave_range_holiday_message(employee, start_date, end_date)
        if holiday_message:
            raise serializers.ValidationError({'date_range': holiday_message})

        balance = LeaveBalance.objects.filter(employee=employee, leave_type=leave_type).first()
        if not has_sufficient_balance(balance, number_of_days, leave_type):
            remaining = balance.remaining_days if balance else Decimal('0.00')
            raise serializers.ValidationError({
                'leave_type': f'Insufficient leave balance. Available: {remaining}, requested: {number_of_days}.',
            })

        attrs['number_of_days'] = number_of_days
        return attrs


class EmployeePortalLeaveSerializer(serializers.ModelSerializer):
    leave_type_name = serializers.CharField(source='leave_type.name', read_only=True)
    status_display = serializers.CharField(source='get_status_display', read_only=True)
    attachment_url = serializers.SerializerMethodField()

    class Meta:
        model = LeaveRequest
        fields = (
            'id',
            'leave_type',
            'leave_type_name',
            'start_date',
            'end_date',
            'number_of_days',
            'reason',
            'status',
            'status_display',
            'applied_on',
            'reviewed_on',
            'remarks',
            'attachment',
            'attachment_url',
        )
        read_only_fields = fields

    def get_attachment_url(self, obj):
        if obj.attachment:
            request = self.context.get('request')
            if request:
                return request.build_absolute_uri(obj.attachment.url)
            return obj.attachment.url
        return None


EMPLOYEE_REGULARIZATION_MAX_LOOKBACK_DAYS = 90


class EmployeePortalRegularizationSerializer(serializers.ModelSerializer):
    status_display = serializers.CharField(source='get_status_display', read_only=True)
    attendance_date = serializers.SerializerMethodField()

    class Meta:
        model = AttendanceRegularization
        fields = (
            'id',
            'attendance',
            'attendance_date',
            'requested_check_in',
            'requested_check_out',
            'reason',
            'status',
            'status_display',
            'reviewer_remarks',
            'reviewed_at',
            'created_at',
        )
        read_only_fields = fields

    def get_attendance_date(self, obj):
        if obj.attendance_id and obj.attendance:
            return obj.attendance.date.isoformat()
        for value in (obj.requested_check_in, obj.requested_check_out):
            if value:
                return timezone.localdate(value).isoformat()
        return None


class EmployeeRegularizationApplySerializer(serializers.Serializer):
    """Employee portal — submit missed punch correction for the authenticated employee."""

    date = serializers.DateField()
    requested_check_in = serializers.DateTimeField(required=False, allow_null=True)
    requested_check_out = serializers.DateTimeField(required=False, allow_null=True)
    requested_check_in_time = serializers.CharField(required=False, allow_blank=True)
    requested_check_out_time = serializers.CharField(required=False, allow_blank=True)
    reason = serializers.CharField(min_length=3, max_length=2000)

    def validate(self, attrs):
        from apps.hr.attendance_policy import parse_attendance_clock, resolve_punch_timestamp

        employee = self.context.get('employee')
        if not employee:
            raise serializers.ValidationError('Employee profile is required.')
        if employee.status != 'active':
            raise serializers.ValidationError('Regularization cannot be submitted while employee status is not active.')

        att_date = attrs['date']
        today = timezone.localdate()
        if att_date > today:
            raise serializers.ValidationError({'date': 'Future dates are not allowed.'})
        if att_date < today - timedelta(days=EMPLOYEE_REGULARIZATION_MAX_LOOKBACK_DAYS):
            raise serializers.ValidationError({
                'date': f'Requests are limited to the last {EMPLOYEE_REGULARIZATION_MAX_LOOKBACK_DAYS} days.',
            })

        initial = self.initial_data if isinstance(self.initial_data, dict) else {}
        check_in_time = (attrs.pop('requested_check_in_time', None) or initial.get('requested_check_in_time') or '').strip()
        check_out_time = (attrs.pop('requested_check_out_time', None) or initial.get('requested_check_out_time') or '').strip()

        check_in = attrs.get('requested_check_in')
        check_out = attrs.get('requested_check_out')

        if check_in_time:
            try:
                parse_attendance_clock(check_in_time)
            except ValueError as exc:
                raise serializers.ValidationError({'requested_check_in_time': str(exc)}) from exc
            check_in = resolve_punch_timestamp(punch_date=att_date, punch_time=check_in_time)
            attrs['requested_check_in'] = check_in
        elif check_in:
            check_in = resolve_punch_timestamp(timestamp=check_in)
            if timezone.localdate(check_in) != att_date:
                raise serializers.ValidationError({
                    'requested_check_in': 'Check-in must be on the selected date.',
                })
            attrs['requested_check_in'] = check_in

        if check_out_time:
            try:
                out_time_parsed = parse_attendance_clock(check_out_time)
            except ValueError as exc:
                raise serializers.ValidationError({'requested_check_out_time': str(exc)}) from exc
                
            out_date = att_date
            shift = employee.shift
            if shift and getattr(shift, 'is_overnight', False):
                if shift.start_time and out_time_parsed < shift.start_time:
                    out_date = att_date + timedelta(days=1)
                elif check_in_time:
                    in_time_parsed = parse_attendance_clock(check_in_time)
                    if out_time_parsed < in_time_parsed:
                        out_date = att_date + timedelta(days=1)
                        
            check_out = resolve_punch_timestamp(punch_date=out_date, punch_time=check_out_time)
            attrs['requested_check_out'] = check_out
        elif check_out:
            check_out = resolve_punch_timestamp(timestamp=check_out)
            if timezone.localdate(check_out) not in (att_date, att_date + timedelta(days=1)):
                raise serializers.ValidationError({
                    'requested_check_out': 'Check-out must be on the selected date or the following day.',
                })
            attrs['requested_check_out'] = check_out

        check_in = attrs.get('requested_check_in')
        check_out = attrs.get('requested_check_out')
        if not check_in and not check_out:
            raise serializers.ValidationError(
                'Provide requested check-in and/or check-out time.',
            )
        if check_in and check_out and check_out <= check_in:
            raise serializers.ValidationError({
                'requested_check_out': 'Check-out must be after check-in.',
            })

        attendance = DailyAttendance.objects.filter(employee=employee, date=att_date).first()
        pending_qs = AttendanceRegularization.objects.filter(employee=employee, status='pending')
        if attendance:
            pending_qs = pending_qs.filter(attendance=attendance)
        else:
            pending_qs = pending_qs.filter(
                models.Q(requested_check_in__date=att_date)
                | models.Q(requested_check_out__date=att_date)
            )
        if pending_qs.exists():
            raise serializers.ValidationError({
                'date': 'You already have a pending regularization request for this date.',
            })

        attrs['attendance'] = attendance
        return attrs


class EmployeePortalNotificationSerializer(serializers.ModelSerializer):
    category_display = serializers.CharField(source='get_category_display', read_only=True)
    is_read = serializers.BooleanField(read_only=True)

    class Meta:
        from apps.hr.models import EmployeePortalNotification

        model = EmployeePortalNotification
        fields = (
            'id',
            'category',
            'category_display',
            'title',
            'message',
            'read_at',
            'is_read',
            'metadata',
            'created_at',
        )
        read_only_fields = fields


class OrganizationHolidaySerializer(serializers.ModelSerializer):
    scope_display = serializers.CharField(source='get_scope_display', read_only=True)

    class Meta:
        from apps.hr.models import OrganizationHoliday

        model = OrganizationHoliday
        fields = (
            'id',
            'scope',
            'scope_display',
            'hospital',
            'name',
            'date',
            'description',
            'active',
            'is_paid_day',
            'created_at',
            'updated_at',
        )
        read_only_fields = ('id', 'created_at', 'updated_at')

    def validate(self, attrs):
        from apps.hr.models import OrganizationHoliday

        scope = attrs.get('scope') or getattr(self.instance, 'scope', None)
        if not scope and isinstance(self.initial_data, dict):
            scope = self.initial_data.get('holiday_type') or scope
            if scope:
                attrs['scope'] = scope
        hospital = attrs.get('hospital', getattr(self.instance, 'hospital', None))
        if scope == OrganizationHoliday.SCOPE_ORGANIZATION and not hospital:
            from apps.hr.hospital_context import resolve_hr_hospital_id

            request = self.context.get('request')
            if not resolve_hr_hospital_id(request):
                raise serializers.ValidationError({
                    'hospital': (
                        'Hospital context is required for organization holidays. '
                        'Link your account to a hospital or choose one before saving.'
                    ),
                })
        if scope == OrganizationHoliday.SCOPE_NATIONAL:
            attrs['hospital'] = None
        return attrs


class PayslipSerializer(serializers.ModelSerializer):
    employee_name = serializers.CharField(source='employee.name', read_only=True)
    employee_code = serializers.CharField(source='employee.employee_id', read_only=True)
    pdf_url = serializers.SerializerMethodField()
    attendance_summary = serializers.SerializerMethodField()

    class Meta:
        from apps.hr.payroll_models import Payslip

        model = Payslip
        fields = (
            'id',
            'payroll_run',
            'employee',
            'employee_name',
            'employee_code',
            'month',
            'earnings_breakdown',
            'deductions_breakdown',
            'gross_salary',
            'net_salary',
            'attendance_summary',
            'generated_at',
            'pdf_url',
            'created_at',
        )
        read_only_fields = fields

    def get_attendance_summary(self, obj):
        payroll_run = getattr(obj, 'payroll_run', None)
        if payroll_run is None:
            return {}
        from apps.hr.payslip_generator import attendance_summary_for_api

        return attendance_summary_for_api(payroll_run)

    def get_pdf_url(self, obj):
        if not obj.pdf_file:
            return None
        request = self.context.get('request')
        if request:
            return request.build_absolute_uri(obj.pdf_file.url)
        return obj.pdf_file.url


class PayrollAuditLogSerializer(serializers.ModelSerializer):
    performed_by_email = serializers.CharField(source='performed_by.email', read_only=True, default=None)

    class Meta:
        from apps.hr.payroll_models import PayrollAuditLog

        model = PayrollAuditLog
        fields = (
            'id',
            'payroll_run',
            'action',
            'performed_by',
            'performed_by_email',
            'old_value',
            'new_value',
            'notes',
            'created_at',
        )
        read_only_fields = fields


class PayrollRunSerializer(serializers.ModelSerializer):
    employee_name = serializers.CharField(source='employee.name', read_only=True)
    employee_code = serializers.CharField(source='employee.employee_id', read_only=True)
    has_payslip = serializers.SerializerMethodField()
    is_editable = serializers.BooleanField(read_only=True)
    approval_flags = serializers.SerializerMethodField()
    attendance_summary = serializers.SerializerMethodField()

    class Meta:
        from apps.hr.payroll_models import PayrollRun

        model = PayrollRun
        fields = (
            'id',
            'employee',
            'employee_name',
            'employee_code',
            'salary_structure',
            'month',
            'total_present_days',
            'total_absent_days',
            'total_leave_days',
            'overtime_hours',
            'gross_salary',
            'total_deductions',
            'final_salary',
            'status',
            'calculation_snapshot',
            'attendance_summary',
            'has_payslip',
            'is_editable',
            'approval_flags',
            'reviewed_at',
            'approved_at',
            'finalized_at',
            'locked_at',
            'published_at',
            'created_at',
        )
        read_only_fields = fields

    def get_attendance_summary(self, obj):
        try:
            from apps.hr.payslip_generator import attendance_summary_for_api

            return attendance_summary_for_api(obj)
        except Exception:
            snapshot = obj.calculation_snapshot or {}
            return snapshot.get('attendance_summary') or {}

    def get_has_payslip(self, obj):
        try:
            return obj.payslip is not None
        except Exception:
            return False

    def get_approval_flags(self, obj):
        snapshot = obj.calculation_snapshot or {}
        return snapshot.get('approval_flags') or {}


class LeaveTypeSerializer(serializers.ModelSerializer):
    class Meta:
        model = LeaveType
        fields = '__all__'
        read_only_fields = ('hospital',)

    def validate_code(self, value):
        code = (value or '').strip().upper()
        if not code:
            return code
        hospital_id = self.context.get('hospital_id') or getattr(self.instance, 'hospital_id', None)
        qs = LeaveType.objects.filter(code__iexact=code)
        if hospital_id:
            qs = qs.filter(hospital_id=hospital_id)
        if self.instance:
            qs = qs.exclude(pk=self.instance.pk)
        if qs.exists():
            raise serializers.ValidationError('Leave type code must be unique per hospital.')
        return code


class LeavePolicyLineSerializer(serializers.ModelSerializer):
    leave_type_name = serializers.CharField(source='leave_type.name', read_only=True)
    leave_type_code = serializers.CharField(source='leave_type.code', read_only=True)

    class Meta:
        model = LeavePolicyLine
        fields = ('id', 'policy', 'leave_type', 'leave_type_name', 'leave_type_code', 'allocated_days', 'is_unlimited', 'created_at', 'updated_at')
        read_only_fields = ('policy', 'created_at', 'updated_at', 'leave_type_name', 'leave_type_code')
        extra_kwargs = {'id': {'required': False, 'allow_null': True}}


class LeavePolicySerializer(serializers.ModelSerializer):
    lines = LeavePolicyLineSerializer(many=True, required=False)
    departments = serializers.PrimaryKeyRelatedField(
        many=True,
        queryset=Department.objects.all(),
        required=False,
    )
    designations = serializers.PrimaryKeyRelatedField(
        many=True,
        queryset=Designation.objects.all(),
        required=False,
    )
    department_names = serializers.SerializerMethodField()
    designation_names = serializers.SerializerMethodField()
    assignment_type_display = serializers.CharField(source='get_assignment_type_display', read_only=True)

    class Meta:
        model = LeavePolicy
        fields = (
            'id',
            'hospital',
            'name',
            'description',
            'assignment_type',
            'assignment_type_display',
            'departments',
            'designations',
            'department_names',
            'designation_names',
            'is_default',
            'is_active',
            'lines',
            'created_at',
            'updated_at',
        )
        read_only_fields = ('hospital', 'created_at', 'updated_at')

    def get_department_names(self, obj):
        return list(obj.departments.order_by('name').values_list('name', flat=True))

    def get_designation_names(self, obj):
        return list(obj.designations.order_by('name').values_list('name', flat=True))

    def validate(self, attrs):
        assignment_type = attrs.get(
            'assignment_type',
            getattr(self.instance, 'assignment_type', LeavePolicy.ASSIGNMENT_DEPARTMENT),
        )
        departments = attrs.get('departments', None)
        designations = attrs.get('designations', None)

        if self.instance is not None:
            if departments is None and 'departments' not in getattr(self, 'initial_data', {}):
                departments = list(self.instance.departments.all())
            if designations is None and 'designations' not in getattr(self, 'initial_data', {}):
                designations = list(self.instance.designations.all())

        if assignment_type == LeavePolicy.ASSIGNMENT_DEPARTMENT:
            if not departments:
                raise serializers.ValidationError({
                    'departments': 'Select at least one department for department packages.',
                })
            attrs['designations'] = []
        elif assignment_type == LeavePolicy.ASSIGNMENT_DESIGNATION:
            if not designations:
                raise serializers.ValidationError({
                    'designations': 'Select at least one designation for designation packages.',
                })
            attrs['departments'] = []
        else:
            raise serializers.ValidationError({
                'assignment_type': 'Assignment must be DEPARTMENT or DESIGNATION.',
            })
        return attrs

    @transaction.atomic
    def create(self, validated_data):
        lines_data = validated_data.pop('lines', [])
        departments = validated_data.pop('departments', [])
        designations = validated_data.pop('designations', [])
        policy = super().create(validated_data)
        policy.departments.set(departments)
        policy.designations.set(designations)
        self._sync_lines(policy, lines_data)
        self._maybe_apply_balances(policy)
        return policy

    @transaction.atomic
    def update(self, instance, validated_data):
        lines_data = validated_data.pop('lines', None)
        departments = validated_data.pop('departments', None)
        designations = validated_data.pop('designations', None)
        policy = super().update(instance, validated_data)
        if departments is not None:
            policy.departments.set(departments)
        if designations is not None:
            policy.designations.set(designations)
        if lines_data is not None:
            self._sync_lines(policy, lines_data)
        self._maybe_apply_balances(policy)
        return policy

    def _maybe_apply_balances(self, policy):
        if policy.is_active:
            apply_policy_balances(policy)

    def _sync_lines(self, policy, lines_data):
        if lines_data is None:
            return
        keep_ids = []
        for row in lines_data:
            line_id = row.get('id')
            leave_type = row['leave_type']
            if not isinstance(leave_type, LeaveType):
                leave_type = LeaveType.objects.get(pk=leave_type)
            payload = {
                'leave_type': leave_type,
                'allocated_days': row.get('allocated_days'),
                'is_unlimited': row.get('is_unlimited', False),
            }
            line = None
            if line_id:
                line = LeavePolicyLine.objects.filter(pk=line_id, policy=policy).first()
            if line is None:
                line = LeavePolicyLine.objects.filter(
                    policy=policy,
                    leave_type=leave_type,
                ).first()
            if line:
                for key, value in payload.items():
                    setattr(line, key, value)
                line.save()
            else:
                line = LeavePolicyLine.objects.create(policy=policy, **payload)
            keep_ids.append(line.id)
        LeavePolicyLine.objects.filter(policy=policy).exclude(id__in=keep_ids).delete()


class LeaveBalanceSerializer(serializers.ModelSerializer):
    employee_name = serializers.CharField(source='employee.name', read_only=True)
    employee_id_display = serializers.CharField(source='employee.employee_id', read_only=True)
    leave_type_name = serializers.CharField(source='leave_type.name', read_only=True)
    leave_type_code = serializers.CharField(source='leave_type.code', read_only=True)
    policy_name = serializers.CharField(source='policy.name', read_only=True, default=None)

    class Meta:
        model = LeaveBalance
        fields = '__all__'

    def validate(self, attrs):
        total = attrs.get('total_days', getattr(self.instance, 'total_days', Decimal('0.00')))
        used = attrs.get('used_days', getattr(self.instance, 'used_days', Decimal('0.00')))
        is_unlimited = attrs.get('is_unlimited', getattr(self.instance, 'is_unlimited', False))
        if not is_unlimited:
            attrs['remaining_days'] = max(Decimal('0.00'), Decimal(total) - Decimal(used)).quantize(Decimal('0.01'))
        return attrs


class LeaveRequestSerializer(serializers.ModelSerializer):
    employee_name = serializers.CharField(source='employee.name', read_only=True)
    employee_id_display = serializers.CharField(source='employee.employee_id', read_only=True)
    leave_type_name = serializers.CharField(source='leave_type.name', read_only=True)
    status_display = serializers.CharField(source='get_status_display', read_only=True)
    reviewed_by_name = serializers.SerializerMethodField()
    remaining_balance = serializers.SerializerMethodField()
    attachment_url = serializers.SerializerMethodField()

    class Meta:
        model = LeaveRequest
        fields = '__all__'
        read_only_fields = (
            'number_of_days',
            'status',
            'applied_on',
            'applied_by',
            'reviewed_by',
            'reviewed_on',
            'notification_events',
        )

    def get_reviewed_by_name(self, obj):
        if not obj.reviewed_by:
            return None
        return getattr(obj.reviewed_by, 'full_name', None) or getattr(obj.reviewed_by, 'email', None)

    def get_remaining_balance(self, obj):
        balance = LeaveBalance.objects.filter(employee=obj.employee, leave_type=obj.leave_type).first()
        if balance and balance.is_unlimited:
            return 'Unlimited'
        return str(balance.remaining_days) if balance else '0.00'

    def get_attachment_url(self, obj):
        if obj.attachment:
            request = self.context.get('request')
            if request:
                return request.build_absolute_uri(obj.attachment.url)
            return obj.attachment.url
        return None

    @staticmethod
    def calculate_days(start_date, end_date) -> Decimal:
        return Decimal((end_date - start_date).days + 1).quantize(Decimal('0.01'))

    @staticmethod
    def allows_lwp(leave_type) -> bool:
        if getattr(settings, 'HR_ALLOW_LEAVE_WITHOUT_PAY', False):
            return True
        return leave_type_allows_unpaid(leave_type)

    def validate(self, attrs):
        employee = attrs.get('employee', getattr(self.instance, 'employee', None))
        leave_type = attrs.get('leave_type', getattr(self.instance, 'leave_type', None))
        start_date = attrs.get('start_date', getattr(self.instance, 'start_date', None))
        end_date = attrs.get('end_date', getattr(self.instance, 'end_date', None))

        if self.instance and self.instance.status != LeaveRequest.STATUS_PENDING:
            raise serializers.ValidationError('Only pending leave requests can be modified.')
        if not employee:
            raise serializers.ValidationError({'employee': 'Employee is required.'})
        if not leave_type:
            raise serializers.ValidationError({'leave_type': 'Leave type is required.'})
        if not start_date or not end_date:
            raise serializers.ValidationError({'date_range': 'Start date and end date are required.'})
        if start_date > end_date:
            raise serializers.ValidationError({'end_date': 'End date cannot be before start date.'})
        if getattr(employee, 'hospital_id', None) and getattr(leave_type, 'hospital_id', None) and employee.hospital_id != leave_type.hospital_id:
            raise serializers.ValidationError({'leave_type': 'Leave type and employee must belong to the same hospital.'})
        if not getattr(settings, 'HR_ALLOW_PAST_LEAVE_REQUESTS', False) and start_date < timezone.localdate():
            raise serializers.ValidationError({'start_date': 'Past leave requests are not allowed.'})

        number_of_days = self.calculate_days(start_date, end_date)
        overlap_qs = LeaveRequest.objects.filter(
            employee=employee,
            status=LeaveRequest.STATUS_APPROVED,
            start_date__lte=end_date,
            end_date__gte=start_date,
        )
        if self.instance:
            overlap_qs = overlap_qs.exclude(pk=self.instance.pk)
        if overlap_qs.exists():
            raise serializers.ValidationError({'date_range': 'Employee already has approved leave overlapping this date range.'})

        from apps.hr.holiday_services import leave_range_holiday_message

        holiday_message = leave_range_holiday_message(employee, start_date, end_date)
        if holiday_message:
            raise serializers.ValidationError({'date_range': holiday_message})

        balance = LeaveBalance.objects.filter(employee=employee, leave_type=leave_type).first()
        if not has_sufficient_balance(balance, number_of_days, leave_type):
            remaining = balance.remaining_days if balance else Decimal('0.00')
            raise serializers.ValidationError({
                'leave_type': f'Insufficient leave balance. Available: {remaining}, requested: {number_of_days}.',
            })

        attrs['number_of_days'] = number_of_days
        return attrs

    def create(self, validated_data):
        from apps.hr.leave_notifications import (
            pending_notification_event,
            schedule_leave_submitted_notification,
        )

        request = self.context.get('request')
        if request and getattr(request, 'user', None) and request.user.is_authenticated:
            validated_data['applied_by'] = request.user
        validated_data['notification_events'] = [pending_notification_event('submitted')]
        instance = super().create(validated_data)
        schedule_leave_submitted_notification(instance.id)
        return instance


class LeaveSerializer(serializers.ModelSerializer):
    employee_name = serializers.CharField(source='employee.name', read_only=True)
    leave_type_name = serializers.CharField(source='leave_type.name', read_only=True)
    class Meta:
        model = Leave
        fields = '__all__'

class SalarySerializer(serializers.ModelSerializer):
    employee_name = serializers.CharField(source='employee.name', read_only=True)
    class Meta:
        model = Salary
        fields = '__all__'

class JobDocumentRequirementSerializer(serializers.ModelSerializer):
    document_type_name = serializers.CharField(source='document_type.name', read_only=True)
    document_type_description = serializers.CharField(source='document_type.description', read_only=True)
    verification_mode = serializers.CharField(source='document_type.verification_mode', read_only=True)

    class Meta:
        model = JobDocumentRequirement
        fields = (
            'id',
            'document_type',
            'document_type_name',
            'document_type_description',
            'verification_mode',
            'is_required',
            'allow_multiple',
            'display_order',
        )


class JobOpeningSerializer(serializers.ModelSerializer):
    department_name = serializers.CharField(source='department.name', read_only=True)
    designation_name = serializers.CharField(source='designation.name', read_only=True, default=None)
    employment_type_display = serializers.CharField(source='get_employment_type_display', read_only=True)
    status_display = serializers.CharField(source='get_status_display', read_only=True)
    candidate_count = serializers.SerializerMethodField()
    can_delete = serializers.SerializerMethodField()
    accepts_applications = serializers.SerializerMethodField()
    is_expired = serializers.SerializerMethodField()
    apply_url = serializers.SerializerMethodField()
    document_requirements = JobDocumentRequirementSerializer(many=True, read_only=True)
    document_requirements_input = serializers.ListField(
        child=serializers.DictField(),
        write_only=True,
        required=False,
        allow_null=True,
    )

    class Meta:
        model = JobOpening
        fields = '__all__'
        extra_kwargs = {
            'title': {'required': True},
            'department': {'required': True},
            'hospital': {'required': False},
            'vacancies': {'min_value': 1},
        }

    def validate(self, attrs):
        request = self.context.get('request')
        if not request or not request.user:
            raise serializers.ValidationError('User authentication required.')

        # Allow superusers to bypass hospital requirement
        if not request.user.is_superuser:
            if not hasattr(request.user, 'hospital_id') or not request.user.hospital_id:
                raise serializers.ValidationError('User must be associated with a hospital.')

        expiry = attrs.get('expiry_date')
        if self.instance is not None and expiry is None and 'expiry_date' not in attrs:
            expiry = self.instance.expiry_date
        status = attrs.get('status', getattr(self.instance, 'status', None) if self.instance else None)
        is_draft = status == 'draft'

        from apps.hr.job_applications import validate_hr_expiry_date

        if expiry is not None:
            try:
                validate_hr_expiry_date(expiry, required=True)
            except ValueError as exc:
                raise serializers.ValidationError({'expiry_date': str(exc)}) from exc
        elif not is_draft and (self.instance is None or 'expiry_date' in attrs):
            try:
                validate_hr_expiry_date(None, required=True)
            except ValueError as exc:
                raise serializers.ValidationError({'expiry_date': str(exc)}) from exc

        if status == 'open' and expiry is None:
            raise serializers.ValidationError({
                'expiry_date': 'Last date to apply is required for open job postings.',
            })

        designation = attrs.get('designation')
        if designation is None and self.instance is not None and 'designation' not in attrs:
            designation = getattr(self.instance, 'designation', None)
        if designation is not None:
            hospital_id = attrs.get('hospital_id') or getattr(self.instance, 'hospital_id', None)
            if hospital_id is None and request:
                from apps.hr.hospital_context import resolve_hr_hospital_id

                hospital_id = resolve_hr_hospital_id(request)
            validate_active_designation(designation)
            validate_designation_hospital(designation, hospital_id)
            attrs = sync_title_from_designation(attrs, self.instance)

        return attrs

    def get_candidate_count(self, obj):
        return obj.applications.count()

    def get_can_delete(self, obj):
        """Check if job can be hard deleted (no candidates)."""
        return obj.applications.count() == 0

    def get_accepts_applications(self, obj):
        from apps.hr.job_applications import job_accepts_applications

        return job_accepts_applications(obj)

    def get_is_expired(self, obj):
        from apps.hr.job_applications import is_job_expired

        return is_job_expired(obj)

    def get_apply_url(self, obj):
        if not obj.job_code:
            return None
        from config.frontend_url import get_job_apply_url

        request = self.context.get('request')
        return get_job_apply_url(obj.job_code, request=request)

    def validate_expiry_date(self, value):
        from apps.hr.job_applications import validate_hr_expiry_date

        if value is None:
            return value
        try:
            return validate_hr_expiry_date(value, required=True)
        except ValueError as exc:
            raise serializers.ValidationError(str(exc)) from exc

    def create(self, validated_data):
        request = self.context.get('request')
        if request and hasattr(request.user, 'hospital_id') and request.user.hospital_id:
            validated_data['hospital_id'] = request.user.hospital_id

        # Auto-generate job_code if not provided
        if not validated_data.get('job_code'):
            validated_data['job_code'] = self.generate_job_code()

        self._sync_status_flags(validated_data)
        requirements = validated_data.pop('document_requirements_input', None)
        job = super().create(validated_data)
        if requirements is not None:
            from apps.hr.job_document_requirements import save_job_document_requirements

            save_job_document_requirements(job, requirements)
        return job

    def update(self, instance, validated_data):
        from apps.hr.job_applications import local_today

        expiry = validated_data.get('expiry_date', instance.expiry_date)
        status = validated_data.get('status', instance.status)

        # Reopen when the application deadline is still valid but the job was left closed
        # (e.g. after auto-close on expiry, then HR extends the last date to apply).
        if (
            status == 'closed'
            and expiry is not None
            and expiry >= local_today()
            and not instance.is_archived
            and instance.status == 'closed'
            and not instance.is_active
        ):
            validated_data['status'] = 'open'
            status = 'open'

        if 'status' in validated_data:
            self._sync_status_flags(validated_data, status=status)
        requirements = validated_data.pop('document_requirements_input', None)
        job = super().update(instance, validated_data)
        if requirements is not None:
            from apps.hr.job_document_requirements import save_job_document_requirements

            save_job_document_requirements(job, requirements)
        return job

    def to_internal_value(self, data):
        mutable = data.copy() if hasattr(data, 'copy') else dict(data)
        if 'document_requirements' in mutable and 'document_requirements_input' not in mutable:
            mutable['document_requirements_input'] = mutable.pop('document_requirements')
        return super().to_internal_value(mutable)

    @staticmethod
    def _sync_status_flags(validated_data, status=None):
        """Keep is_active / is_archived aligned with status (matches close/reactivate actions)."""
        status = status or validated_data.get('status')
        if not status:
            return
        if status == 'open':
            validated_data['is_active'] = True
            validated_data['is_archived'] = False
        elif status == 'closed':
            validated_data['is_active'] = False
        elif status in ('draft', 'on_hold'):
            validated_data['is_active'] = False
        elif status == 'archived':
            validated_data['is_active'] = False
            validated_data['is_archived'] = True

    def generate_job_code(self):
        """Generate unique job code like JOB001, JOB002, etc."""
        prefix = "JOB"
        last_job = JobOpening.objects.filter(
            job_code__startswith=prefix
        ).order_by('-job_code').first()

        if last_job and last_job.job_code:
            try:
                last_number = int(last_job.job_code.replace(prefix, ''))
                new_number = last_number + 1
            except ValueError:
                new_number = JobOpening.objects.count() + 1
        else:
            new_number = 1

        return f"{prefix}{new_number:03d}"

    def validate_vacancies(self, value):
        """Validate vacancies is at least 1."""
        if value is not None and value < 1:
            raise serializers.ValidationError('Vacancies must be at least 1.')
        return value

    def validate_department(self, value):
        """Validate department exists."""
        if value and not Department.objects.filter(id=value.id).exists():
            raise serializers.ValidationError('Selected department does not exist.')
        return value

class InterviewSerializer(serializers.ModelSerializer):
    candidate_name = serializers.CharField(source='candidate.name', read_only=True)
    candidate_email = serializers.CharField(source='candidate.email', read_only=True)
    job_opening_title = serializers.CharField(source='candidate.job_opening.title', read_only=True)
    status_display = serializers.CharField(source='get_status_display', read_only=True)
    mode_display = serializers.CharField(source='get_mode_display', read_only=True)

    class Meta:
        model = Interview
        fields = '__all__'

class ApplicationDocumentRequirementSerializer(serializers.ModelSerializer):
    document_type_name = serializers.CharField(source='document_type.name', read_only=True)
    verification_mode = serializers.CharField(source='document_type.verification_mode', read_only=True)

    class Meta:
        model = ApplicationDocumentRequirement
        fields = (
            'id',
            'document_type',
            'document_type_name',
            'verification_mode',
            'is_required',
            'allow_multiple',
            'display_order',
        )


class CandidateSerializer(serializers.ModelSerializer):
    candidate_id = serializers.CharField(source='profile.candidate_code', read_only=True)
    application_id = serializers.CharField(source='application_code', read_only=True)
    job_opening_title = serializers.CharField(source='job_opening.title', read_only=True)
    department_name = serializers.CharField(source='job_opening.department.name', read_only=True)
    designation_name = serializers.CharField(source='job_opening.designation.name', read_only=True)
    document_requirements = ApplicationDocumentRequirementSerializer(many=True, read_only=True)
    document_requirements_snapshotted = serializers.SerializerMethodField()
    status_display = serializers.CharField(source='get_status_display', read_only=True)
    interview_type_display = serializers.CharField(source='get_interview_type_display', read_only=True)
    interview_status_display = serializers.CharField(source='get_interview_status_display', read_only=True)
    offer_status_display = serializers.CharField(source='get_offer_status_display', read_only=True)
    active_scheduled_interview = serializers.SerializerMethodField(read_only=True)
    pipeline_stage = serializers.SerializerMethodField(read_only=True)
    pipeline_stage_display = serializers.SerializerMethodField(read_only=True)
    has_active_offer = serializers.SerializerMethodField(read_only=True)

    class Meta:
        model = Candidate
        fields = '__all__'
        extra_kwargs = {
            'name': {'required': True},
            'job_opening': {'required': True},
            'profile': {'read_only': True},
            'application_code': {'read_only': True},
        }

    def get_document_requirements_snapshotted(self, obj):
        return bool(obj.document_requirements_snapshotted_at)

    def get_active_scheduled_interview(self, obj):
        cached = getattr(obj, '_prefetched_objects_cache', {}).get('interviews')
        if cached is not None:
            inv = cached[0] if cached else None
        else:
            inv = (
                obj.interviews.filter(status=Interview.STATUS_SCHEDULED)
                .order_by('-scheduled_start')
                .first()
            )
        if not inv:
            return None
        return InterviewSerializer(inv).data

    def get_pipeline_stage(self, obj):
        has = getattr(obj, '_has_scheduled_interview', None)
        return compute_pipeline_stage(obj, has_scheduled=has)

    def get_pipeline_stage_display(self, obj):
        code = self.get_pipeline_stage(obj)
        return PIPELINE_STAGE_LABEL.get(code, code)

    def get_has_active_offer(self, obj):
        v = getattr(obj, '_has_active_offer', None)
        if v is not None:
            return bool(v)
        return Offer.objects.filter(candidate_id=obj.pk, status__in=['sent', 'accepted']).exists()

    def validate_email(self, value):
        if value:
            return normalize_email_address(value)
        return value

    def validate(self, attrs):
        attrs = super().validate(attrs)
        email = attrs.get('email')
        if email is None and self.instance is not None:
            email = self.instance.email
        job = attrs.get('job_opening')
        if job is None and self.instance is not None:
            job = self.instance.job_opening

        if job and email:
            from apps.hr.models import CandidateProfile

            hospital = job.hospital if job else None
            profile = CandidateProfile.objects.filter(
                hospital=hospital,
                email__iexact=email,
            ).first()
            if profile:
                duplicate_qs = Candidate.objects.filter(job_opening=job, profile=profile)
                if self.instance is not None:
                    duplicate_qs = duplicate_qs.exclude(pk=self.instance.pk)
                if duplicate_qs.exists():
                    raise serializers.ValidationError({
                        'email': 'A candidate with this email has already applied for this job.',
                    })
            elif self.instance is None:
                legacy_dup = Candidate.objects.filter(job_opening=job, email__iexact=email)
                if legacy_dup.exists():
                    raise serializers.ValidationError({
                        'email': 'A candidate with this email has already applied for this job.',
                    })

        if self.instance is not None:
            return attrs
        if self.context.get('skip_job_application_check'):
            return attrs
        if job is None:
            return attrs
        from apps.hr.job_applications import get_application_block_message, job_accepts_applications

        if not job_accepts_applications(job):
            raise serializers.ValidationError({
                'job_opening': get_application_block_message(job),
            })
        return attrs

    def create(self, validated_data):
        from apps.hr.recruitment_applications import create_application_from_api

        return create_application_from_api(validated_data)

class PerformanceReviewSerializer(serializers.ModelSerializer):
    employee_name = serializers.CharField(source='employee.name', read_only=True)
    class Meta:
        model = PerformanceReview
        fields = '__all__'


class OfferTemplateSerializer(NormalizeEmailFieldsSerializerMixin, serializers.ModelSerializer):
    NORMALIZED_EMAIL_FIELDS = ('company_email',)
    layout_config = serializers.JSONField(required=False, allow_null=True)

    class Meta:
        model = OfferTemplate
        fields = '__all__'


class OfferSerializer(NormalizeEmailFieldsSerializerMixin, serializers.ModelSerializer):
    NORMALIZED_EMAIL_FIELDS = ('candidate_email', 'company_email')
    candidate_name = serializers.CharField(read_only=True)
    candidate_email = serializers.CharField(read_only=True)
    job_title = serializers.CharField(read_only=True)
    status_display = serializers.CharField(source='get_status_display', read_only=True)
    edited_layout_config = serializers.JSONField(required=False, allow_null=True)

    class Meta:
        model = Offer
        fields = '__all__'
        read_only_fields = ('candidate', 'job', 'template', 'token', 'onboarding_welcome_email_sent_at')

class ComponentOfferTemplateSerializer(serializers.ModelSerializer):
    class Meta:
        model = ComponentOfferTemplate
        fields = ['id', 'name', 'category', 'description', 'design_json', 'is_default', 'is_active']

class OfferBuilderV2Serializer(NormalizeEmailFieldsSerializerMixin, serializers.ModelSerializer):
    NORMALIZED_EMAIL_FIELDS = ('candidate_email',)

    class Meta:
        model = OfferBuilderV2
        fields = '__all__'


class OfferLetterSettingsSerializer(serializers.ModelSerializer):
    logo_url = serializers.SerializerMethodField()
    signature_url = serializers.SerializerMethodField()

    _IMAGE_MAX_BYTES = 5 * 1024 * 1024
    _IMAGE_CONTENT_TYPES = {'image/jpeg', 'image/png', 'image/gif', 'image/webp'}
    _CIN_RE = re.compile(r'^[A-Z]{1}[0-9]{5}[A-Z]{2}[0-9]{4}[A-Z]{3}[0-9]{6}$')

    class Meta:
        model = OfferLetterSettings
        fields = '__all__'
        read_only_fields = ('hospital',)

    def get_logo_url(self, obj):
        request = self.context.get('request')
        if not obj.logo:
            return ''
        url = obj.logo.url
        return request.build_absolute_uri(url) if request else url

    def get_signature_url(self, obj):
        request = self.context.get('request')
        if not obj.signature:
            return ''
        url = obj.signature.url
        return request.build_absolute_uri(url) if request else url

    @staticmethod
    def _clean_text(value):
        return (value or '').strip()

    @classmethod
    def _validate_required_name(cls, value, label, max_len):
        cleaned = cls._clean_text(value)
        if not cleaned:
            raise serializers.ValidationError(f'{label} is required.')
        if len(cleaned) < 2:
            raise serializers.ValidationError(f'{label} must be at least 2 characters.')
        if len(cleaned) > max_len:
            raise serializers.ValidationError(f'{label} must be at most {max_len} characters.')
        if not any(ch.isalpha() for ch in cleaned):
            raise serializers.ValidationError(f'{label} must include at least one letter.')
        return cleaned

    @classmethod
    def _validate_optional_email(cls, value, label, max_len):
        cleaned = cls._clean_text(value).lower()
        if not cleaned:
            return ''
        if len(cleaned) > max_len:
            raise serializers.ValidationError(f'{label} is too long.')
        try:
            from django.core.validators import validate_email
            from django.core.exceptions import ValidationError as DjangoValidationError

            validate_email(cleaned)
        except DjangoValidationError as exc:
            raise serializers.ValidationError(f'Enter a valid {label.lower()}.') from exc
        return cleaned

    @classmethod
    def _normalize_indian_mobile(cls, value):
        digits = ''.join(ch for ch in cls._clean_text(value) if ch.isdigit())
        if len(digits) == 12 and digits.startswith('91'):
            return digits[2:]
        if len(digits) == 11 and digits.startswith('0'):
            return digits[1:]
        return digits

    @classmethod
    def _validate_optional_phone(cls, value, label, max_len):
        cleaned = cls._clean_text(value)
        if not cleaned:
            return ''
        mobile = cls._normalize_indian_mobile(cleaned)
        if len(mobile) != 10:
            raise serializers.ValidationError(f'{label} must be exactly 10 digits.')
        if mobile[0] not in '6789':
            raise serializers.ValidationError(f'{label} must start with 6, 7, 8, or 9.')
        return mobile

    @classmethod
    def _validate_optional_website(cls, value):
        cleaned = cls._clean_text(value)
        if not cleaned:
            return ''
        if len(cleaned) > 255:
            raise serializers.ValidationError('Website must be at most 255 characters.')
        from urllib.parse import urlparse

        candidate = cleaned if '://' in cleaned else f'https://{cleaned}'
        parsed = urlparse(candidate)
        if not parsed.hostname or '.' not in parsed.hostname:
            raise serializers.ValidationError('Enter a valid website URL (e.g. https://yourhospital.com).')
        return cleaned

    @classmethod
    def _validate_optional_cin(cls, value):
        cleaned = cls._clean_text(value).upper()
        if not cleaned:
            return ''
        if len(cleaned) > 128:
            raise serializers.ValidationError('Registration number must be at most 128 characters.')
        if cls._CIN_RE.match(cleaned):
            return cleaned
        if re.fullmatch(r'[A-Z0-9/-]{5,128}', cleaned, flags=re.I):
            return cleaned
        raise serializers.ValidationError('Enter a valid registration number (e.g. U74999MH2020PTC123456).')

    @classmethod
    def _validate_image_upload(cls, value, label):
        if not value:
            return value
        content_type = getattr(value, 'content_type', '') or ''
        if content_type not in cls._IMAGE_CONTENT_TYPES:
            raise serializers.ValidationError('Upload a JPG, PNG, GIF, or WebP image.')
        if value.size > cls._IMAGE_MAX_BYTES:
            raise serializers.ValidationError('Image must be 5 MB or smaller.')
        return value

    def validate_logo(self, value):
        return self._validate_image_upload(value, 'logo')

    def validate_signature(self, value):
        return self._validate_image_upload(value, 'signature')

    def validate(self, attrs):
        merged = {}
        for field in (
            'organization_name',
            'organization_address',
            'organization_location',
            'organization_website',
            'company_email',
            'company_phone',
            'hr_name',
            'hr_designation',
            'hr_email',
            'hr_phone',
            'registered_office_address',
            'corporate_office_address',
            'company_registration_number',
            'footer_confidentiality_note',
        ):
            if field in attrs:
                merged[field] = attrs[field]
            elif self.instance is not None:
                merged[field] = getattr(self.instance, field, '')

        errors = {}

        try:
            attrs['organization_name'] = self._validate_required_name(
                merged.get('organization_name'), 'Hospital / company name', 255,
            )
        except serializers.ValidationError as exc:
            errors['organization_name'] = exc.detail

        address = self._clean_text(merged.get('organization_address'))
        if not address:
            errors['organization_address'] = 'Full address is required.'
        elif len(address) < 5:
            errors['organization_address'] = 'Full address must be at least 5 characters.'
        elif len(address) > 2000:
            errors['organization_address'] = 'Full address must be at most 2000 characters.'
        else:
            attrs['organization_address'] = address

        location = self._clean_text(merged.get('organization_location'))
        if location:
            if len(location) < 2:
                errors['organization_location'] = 'City & pincode must be at least 2 characters.'
            elif len(location) > 255:
                errors['organization_location'] = 'City & pincode must be at most 255 characters.'
            else:
                attrs['organization_location'] = location
        else:
            attrs['organization_location'] = ''

        for field_name, validator, args in (
            ('organization_website', self._validate_optional_website, (merged.get('organization_website'),)),
            ('company_email', self._validate_optional_email, (merged.get('company_email'), 'Company email', 255)),
            ('company_phone', self._validate_optional_phone, (merged.get('company_phone'), 'Main phone', 64)),
            ('hr_email', self._validate_optional_email, (merged.get('hr_email'), 'HR email', 255)),
            ('hr_phone', self._validate_optional_phone, (merged.get('hr_phone'), 'HR phone', 64)),
            ('company_registration_number', self._validate_optional_cin, (merged.get('company_registration_number'),)),
        ):
            try:
                attrs[field_name] = validator(*args)
            except serializers.ValidationError as exc:
                errors[field_name] = exc.detail

        try:
            attrs['hr_name'] = self._validate_required_name(
                merged.get('hr_name'), 'HR signatory name', 255,
            )
        except serializers.ValidationError as exc:
            errors['hr_name'] = exc.detail

        designation = self._clean_text(merged.get('hr_designation')) or 'HR Manager'
        if len(designation) < 2:
            errors['hr_designation'] = 'HR designation must be at least 2 characters.'
        elif len(designation) > 255:
            errors['hr_designation'] = 'HR designation must be at most 255 characters.'
        else:
            attrs['hr_designation'] = designation

        for field_name, label, max_len in (
            ('registered_office_address', 'Registered office address', 2000),
            ('corporate_office_address', 'Corporate office address', 2000),
        ):
            cleaned = self._clean_text(merged.get(field_name))
            if cleaned and len(cleaned) > max_len:
                errors[field_name] = f'{label} must be at most {max_len} characters.'
            else:
                attrs[field_name] = cleaned

        footer = self._clean_text(merged.get('footer_confidentiality_note'))
        if footer:
            if len(footer) < 10:
                errors['footer_confidentiality_note'] = 'Confidentiality note must be at least 10 characters.'
            elif len(footer) > 2000:
                errors['footer_confidentiality_note'] = 'Confidentiality note must be at most 2000 characters.'
            else:
                attrs['footer_confidentiality_note'] = footer
        else:
            attrs['footer_confidentiality_note'] = footer

        company_email = attrs.get('company_email', self._clean_text(merged.get('company_email')).lower())
        company_phone = attrs.get('company_phone', self._clean_text(merged.get('company_phone')))
        if not company_email and not company_phone:
            contact_error = 'Company email or main phone is required.'
            errors.setdefault('company_email', contact_error)
            errors.setdefault('company_phone', contact_error)

        if errors:
            raise serializers.ValidationError(errors)
        return attrs


class EmployeeDocumentSerializer(serializers.ModelSerializer):
    employee_name = serializers.CharField(source='employee.name', read_only=True)
    document_type_display = serializers.CharField(source='get_document_type_display', read_only=True)
    status_display = serializers.CharField(source='get_status_display', read_only=True)
    verified_by_name = serializers.SerializerMethodField()
    
    class Meta:
        model = EmployeeDocument
        fields = '__all__'
        read_only_fields = ('uploaded_at', 'verified_at', 'verified_by')

    def get_verified_by_name(self, obj):
        if not obj.verified_by:
            return None
        return getattr(obj.verified_by, 'full_name', None) or getattr(obj.verified_by, 'email', None)

    def validate_file(self, value):
        """Validate file type and size."""
        # Check file size (max 5MB)
        max_size = 5 * 1024 * 1024  # 5MB
        if value.size > max_size:
            raise serializers.ValidationError("File size cannot exceed 5MB.")
        
        # Check file type
        allowed_types = ['application/pdf', 'image/jpeg', 'image/png']
        if value.content_type not in allowed_types:
            raise serializers.ValidationError("Only PDF, JPG, and PNG files are allowed.")
        
        return value

    def validate(self, attrs):
        """Prevent duplicate document type upload unless replacing a rejected record."""
        employee = attrs.get('employee') or getattr(self.instance, 'employee', None)
        document_type = attrs.get('document_type') or getattr(self.instance, 'document_type', None)

        if not employee or not document_type:
            return attrs

        existing = EmployeeDocument.objects.filter(
            employee=employee,
            document_type=document_type,
        ).exclude(pk=getattr(self.instance, 'pk', None)).first()

        if existing and existing.status not in {'rejected', 'reupload_requested'}:
            raise serializers.ValidationError(
                f"Document type '{document_type}' already uploaded for this employee."
            )

        return attrs


class DocumentTypeSerializer(serializers.ModelSerializer):
    class Meta:
        model = DocumentType
        fields = '__all__'

    def create(self, validated_data):
        validated_data['verification_mode'] = 'upload'
        return super().create(validated_data)

    def update(self, instance, validated_data):
        validated_data['verification_mode'] = 'upload'
        return super().update(instance, validated_data)


class EmployeeDocumentRequirementSerializer(serializers.ModelSerializer):
    employee_name = serializers.CharField(source='employee.name', read_only=True)
    document_type_name = serializers.CharField(source='document_type.name', read_only=True)
    document_type_description = serializers.CharField(source='document_type.description', read_only=True)
    verification_mode = serializers.CharField(source='document_type.verification_mode', read_only=True)
    verified_by_name = serializers.SerializerMethodField()

    class Meta:
        model = EmployeeDocumentRequirement
        fields = '__all__'
        read_only_fields = ('uploaded_at', 'verified_at', 'verified_by')

    def get_verified_by_name(self, obj):
        if not obj.verified_by:
            return None
        return getattr(obj.verified_by, 'full_name', None) or getattr(obj.verified_by, 'email', None)

