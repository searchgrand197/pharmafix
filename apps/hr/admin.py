from django.contrib import admin
from apps.hr.models import (
    JobOpening, Candidate, CandidateProfile, OfferTemplate, Offer,
    Department, Role, Employee, Attendance, LeaveType, LeavePolicy, LeavePolicyLine,
    LeaveBalance, LeaveRequest, Leave, Salary,
    Interview, InterviewReminder, InterviewBulkAuditLog, RecruitmentEmailEvent, PerformanceReview,
    ComponentOfferTemplate, OfferBuilderV2, OfferLetterSettings,
    EmployeeDocument, Shift, EmployeeShift, AttendancePunch, DailyAttendance,
    EmployeeStatusHistory,
    AttendanceRegularization,
)
from apps.hr.payroll_models import (
    CompensationLevel,
    DepartmentSalaryStructure,
    EmployeeCompensationAssignment,
    EmployeeCompensationOverride,
    PayrollAuditLog,
    Payslip,
    PayrollRun,
    SalaryStructure,
)
from apps.hr.biometric_models import (
    BiometricDevice,
    BiometricDeviceCommand,
    BiometricEnrollment,
    BiometricRejectedPunch,
    BiometricSyncLog,
    BiometricUnlinkedUser,
)


class CandidateInline(admin.TabularInline):
    """
    Inline admin for adding candidates directly inside JobOpening.
    """
    model = Candidate
    extra = 0
    fields = ('application_code', 'name', 'email', 'phone', 'status')
    readonly_fields = ('application_code', 'name', 'created_at')

    def name(self, obj):
        from django.urls import reverse
        from django.utils.safestring import mark_safe
        url = reverse('admin:hr_candidate_change', args=[obj.id])
        return mark_safe(f'<a href="{url}" target="_blank">{obj.name}</a>')
    name.short_description = 'Name'


@admin.register(Department)
class DepartmentAdmin(admin.ModelAdmin):
    list_display = ('name', 'hospital', 'created_at')
    list_filter = ('hospital',)
    search_fields = ('name',)


@admin.register(Role)
class RoleAdmin(admin.ModelAdmin):
    list_display = ('name', 'hospital', 'created_at')
    list_filter = ('hospital',)
    search_fields = ('name',)


@admin.register(Employee)
class EmployeeAdmin(admin.ModelAdmin):
    list_display = (
        'employee_id', 'name', 'email', 'job_title', 'department', 'status',
        'biometric_pin', 'biometric_attendance_enabled', 'onboarding_status', 'created_at',
    )
    list_filter = ('status', 'onboarding_status', 'biometric_attendance_enabled', 'hospital', 'department')
    search_fields = ('name', 'email', 'employee_id', 'job_title', 'biometric_pin')


@admin.register(EmployeeStatusHistory)
class EmployeeStatusHistoryAdmin(admin.ModelAdmin):
    list_display = (
        'employee',
        'event_type',
        'previous_status',
        'new_status',
        'exit_reason',
        'eligible_for_rehire',
        'changed_by',
        'changed_at',
    )
    list_filter = ('event_type', 'new_status', 'exit_reason', 'eligible_for_rehire')
    search_fields = ('employee__name', 'employee__employee_id', 'notes')
    readonly_fields = ('created_at', 'updated_at', 'changed_at')


@admin.register(Attendance)
class AttendanceAdmin(admin.ModelAdmin):
    list_display = ('employee', 'date', 'check_in', 'check_out', 'created_at')
    list_filter = ('date',)
    search_fields = ('employee__name',)


@admin.register(Shift)
class ShiftAdmin(admin.ModelAdmin):
    list_display = (
        'name', 'code', 'hospital', 'start_time', 'end_time', 'grace_minutes',
        'full_day_hours', 'half_day_hours', 'overtime_allowed', 'active',
    )
    list_filter = ('hospital', 'active', 'overtime_allowed')
    search_fields = ('name', 'code')


@admin.register(EmployeeShift)
class EmployeeShiftAdmin(admin.ModelAdmin):
    list_display = ('employee', 'shift', 'effective_from', 'effective_to', 'is_primary', 'assigned_by')
    list_filter = ('is_primary', 'shift', 'effective_from')
    search_fields = ('employee__name', 'employee__employee_id', 'shift__name', 'shift__code')


@admin.register(AttendancePunch)
class AttendancePunchAdmin(admin.ModelAdmin):
    list_display = ('employee', 'timestamp', 'punch_type', 'source', 'device_id', 'is_void', 'created_by')
    list_filter = ('punch_type', 'source', 'is_void')
    search_fields = ('employee__name', 'employee__employee_id', 'device_id')
    readonly_fields = ('created_at', 'updated_at')


@admin.register(DailyAttendance)
class DailyAttendanceAdmin(admin.ModelAdmin):
    list_display = (
        'employee', 'date', 'shift', 'attendance_status', 'total_work_hours',
        'overtime_hours', 'late_minutes', 'calculation_locked', 'manually_corrected',
    )
    list_filter = ('attendance_status', 'calculation_locked', 'manually_corrected', 'date')
    search_fields = ('employee__name', 'employee__employee_id', 'remarks')


@admin.register(AttendanceRegularization)
class AttendanceRegularizationAdmin(admin.ModelAdmin):
    list_display = ('employee', 'status', 'requested_check_in', 'requested_check_out', 'reviewed_by', 'reviewed_at')
    list_filter = ('status', 'reviewed_at')
    search_fields = ('employee__name', 'employee__employee_id', 'reason')


@admin.register(LeaveType)
class LeaveTypeAdmin(admin.ModelAdmin):
    list_display = ('name', 'code', 'is_paid', 'annual_limit', 'is_active', 'hospital', 'created_at')
    list_filter = ('hospital', 'is_active', 'is_paid')
    search_fields = ('name', 'code')


class LeavePolicyLineInline(admin.TabularInline):
    model = LeavePolicyLine
    extra = 0


@admin.register(LeavePolicy)
class LeavePolicyAdmin(admin.ModelAdmin):
    list_display = ('name', 'assignment_type', 'is_default', 'is_active', 'hospital')
    list_filter = ('assignment_type', 'is_active', 'is_default', 'hospital')
    search_fields = ('name',)
    filter_horizontal = ('departments', 'designations')
    inlines = [LeavePolicyLineInline]


@admin.register(LeaveBalance)
class LeaveBalanceAdmin(admin.ModelAdmin):
    list_display = ('employee', 'leave_type', 'total_days', 'used_days', 'remaining_days', 'updated_at')
    list_filter = ('leave_type',)
    search_fields = ('employee__name', 'employee__employee_id', 'leave_type__name')


@admin.register(LeaveRequest)
class LeaveRequestAdmin(admin.ModelAdmin):
    list_display = ('employee', 'leave_type', 'start_date', 'end_date', 'number_of_days', 'status', 'reviewed_by', 'reviewed_on')
    list_filter = ('status', 'leave_type', 'start_date', 'end_date')
    search_fields = ('employee__name', 'employee__employee_id', 'reason', 'remarks')
    readonly_fields = ('number_of_days', 'applied_on', 'reviewed_on', 'notification_events')


@admin.register(Leave)
class LeaveAdmin(admin.ModelAdmin):
    list_display = ('employee', 'leave_type', 'start_date', 'end_date', 'status', 'created_at')
    list_filter = ('status', 'start_date', 'end_date')
    search_fields = ('employee__name',)


@admin.register(Salary)
class SalaryAdmin(admin.ModelAdmin):
    list_display = ('employee', 'month', 'basic_pay', 'allowance', 'deductions', 'created_at')
    list_filter = ('month',)
    search_fields = ('employee__name',)


@admin.register(DepartmentSalaryStructure)
class DepartmentSalaryStructureAdmin(admin.ModelAdmin):
    list_display = ('department', 'name', 'basic_salary', 'hra', 'effective_from', 'is_active')
    list_filter = ('is_active', 'department')
    search_fields = ('department__name', 'name')


@admin.register(CompensationLevel)
class CompensationLevelAdmin(admin.ModelAdmin):
    list_display = (
        'code',
        'name',
        'designation',
        'rank',
        'basic',
        'effective_from',
        'is_active',
        'is_default_for_designation',
    )
    list_filter = ('is_active', 'is_default_for_designation', 'hospital', 'designation')
    search_fields = ('code', 'name', 'designation__name')


@admin.register(EmployeeCompensationAssignment)
class EmployeeCompensationAssignmentAdmin(admin.ModelAdmin):
    list_display = ('employee', 'compensation_level', 'effective_from', 'effective_to', 'is_active')
    list_filter = ('is_active', 'effective_from')
    search_fields = ('employee__name', 'employee__employee_id', 'compensation_level__code', 'compensation_level__name')


@admin.register(EmployeeCompensationOverride)
class EmployeeCompensationOverrideAdmin(admin.ModelAdmin):
    list_display = ('employee', 'effective_from', 'effective_to', 'approved_by', 'is_active')
    list_filter = ('is_active', 'effective_from')
    search_fields = ('employee__name', 'employee__employee_id', 'reason')


@admin.register(SalaryStructure)
class SalaryStructureAdmin(admin.ModelAdmin):
    list_display = ('employee', 'basic_salary', 'hra', 'overtime_rate', 'effective_from', 'is_active')
    list_filter = ('is_active', 'effective_from')
    search_fields = ('employee__name', 'employee__employee_id')


@admin.register(PayrollRun)
class PayrollRunAdmin(admin.ModelAdmin):
    list_display = (
        'employee', 'month', 'final_salary', 'status',
        'total_present_days', 'total_absent_days', 'overtime_hours',
    )
    list_filter = ('status', 'month')
    search_fields = ('employee__name', 'employee__employee_id')
    readonly_fields = (
        'calculation_snapshot', 'reviewed_at', 'approved_at',
        'finalized_at', 'locked_at', 'published_at',
    )


@admin.register(PayrollAuditLog)
class PayrollAuditLogAdmin(admin.ModelAdmin):
    list_display = ('payroll_run', 'action', 'performed_by', 'created_at')
    list_filter = ('action',)
    search_fields = ('payroll_run__employee__employee_id', 'notes')
    readonly_fields = ('payroll_run', 'action', 'performed_by', 'old_value', 'new_value', 'notes', 'created_at')

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False

    def has_delete_permission(self, request, obj=None):
        return False


@admin.register(Payslip)
class PayslipAdmin(admin.ModelAdmin):
    list_display = ('employee', 'month', 'gross_salary', 'net_salary', 'generated_at', 'payroll_run')
    list_filter = ('month',)
    search_fields = ('employee__name', 'employee__employee_id')
    readonly_fields = (
        'payroll_run', 'employee', 'month', 'earnings_breakdown', 'deductions_breakdown',
        'gross_salary', 'net_salary', 'pdf_file', 'generated_at', 'created_at', 'updated_at',
    )

    def has_change_permission(self, request, obj=None):
        return False

    def has_delete_permission(self, request, obj=None):
        return False


@admin.register(JobOpening)
class JobOpeningAdmin(admin.ModelAdmin):
    """
    JobOpening Admin with Department dropdown and Candidate inline.
    """
    list_display = ('job_code', 'title', 'department', 'employment_type', 'vacancies', 'status', 'created_at')
    list_filter = ('department', 'employment_type', 'status', 'hospital')
    search_fields = ('title', 'job_code', 'description', 'required_skills')
    ordering = ('-created_at',)
    inlines = [CandidateInline]

    fieldsets = (
        ('Basic Information', {
            'fields': ('title', 'department', 'job_code', 'hospital')
        }),
        ('Job Details', {
            'fields': ('description', 'required_skills', 'experience_required')
        }),
        ('Employment Information', {
            'fields': ('employment_type', 'vacancies', 'salary_range', 'location')
        }),
        ('Status', {
            'fields': ('status', 'expiry_date', 'is_active', 'is_archived')
        }),
    )


@admin.register(CandidateProfile)
class CandidateProfileAdmin(admin.ModelAdmin):
    list_display = ('candidate_code', 'name', 'email', 'phone', 'hospital', 'created_at')
    search_fields = ('candidate_code', 'name', 'email', 'phone')
    ordering = ('-created_at',)


@admin.register(Candidate)
class CandidateAdmin(admin.ModelAdmin):
    """
    Job application records (linked to CandidateProfile for person identity).
    """
    list_display = (
        'application_code',
        'profile',
        'name',
        'job_opening',
        'email',
        'phone',
        'status',
        'created_at',
    )
    list_filter = ('status', 'job_opening')
    search_fields = ('application_code', 'name', 'email', 'phone', 'profile__candidate_code')
    ordering = ('-created_at',)
    raw_id_fields = ('profile', 'job_opening')


@admin.register(Interview)
class InterviewAdmin(admin.ModelAdmin):
    list_display = ('candidate', 'scheduled_start', 'mode', 'status', 'interviewer_name', 'created_at')
    list_filter = ('status', 'mode')
    search_fields = ('candidate__name', 'interviewer_name', 'bulk_batch_id')


@admin.register(InterviewReminder)
class InterviewReminderAdmin(admin.ModelAdmin):
    list_display = ('interview', 'reminder_type', 'scheduled_time', 'is_sent', 'sent_at', 'created_at')
    list_filter = ('reminder_type', 'is_sent')
    search_fields = ('interview__candidate__name',)
    readonly_fields = ('created_at', 'updated_at')


@admin.register(InterviewBulkAuditLog)
class InterviewBulkAuditLogAdmin(admin.ModelAdmin):
    list_display = ('action', 'affected_count', 'performed_by', 'created_at')
    readonly_fields = ('created_at', 'updated_at')


@admin.register(RecruitmentEmailEvent)
class RecruitmentEmailEventAdmin(admin.ModelAdmin):
    list_display = ('candidate', 'event_type', 'stage', 'email_status', 'created_at')
    list_filter = ('event_type', 'email_status')
    search_fields = ('candidate__name', 'candidate__email', 'stage')
    readonly_fields = ('created_at', 'updated_at')


@admin.register(PerformanceReview)
class PerformanceReviewAdmin(admin.ModelAdmin):
    list_display = ('employee', 'created_at')
    search_fields = ('employee__name',)


@admin.register(OfferTemplate)
class OfferTemplateAdmin(admin.ModelAdmin):
    list_display = ('name', 'company_name', 'hr_name', 'job_title', 'created_at')
    list_filter = ('employment_type', 'created_at')
    search_fields = ('name', 'company_name', 'hr_name', 'job_title', 'department')
    ordering = ('-created_at',)


@admin.register(ComponentOfferTemplate)
class ComponentOfferTemplateAdmin(admin.ModelAdmin):
    list_display = ('name', 'category', 'is_default', 'is_active', 'created_at')
    list_filter = ('is_default', 'is_active', 'category')
    search_fields = ('name', 'category')


@admin.register(OfferBuilderV2)
class OfferBuilderV2Admin(admin.ModelAdmin):
    list_display = ('candidate_name', 'job_title', 'is_sent', 'sent_at', 'created_at')
    list_filter = ('is_sent',)
    search_fields = ('candidate_name', 'job_title')


@admin.register(OfferLetterSettings)
class OfferLetterSettingsAdmin(admin.ModelAdmin):
    list_display = ('organization_name', 'hospital', 'hr_name', 'hr_designation', 'updated_at')
    search_fields = ('organization_name', 'hr_name', 'hr_designation')
    list_filter = ('hospital',)


@admin.register(Offer)
class OfferAdmin(admin.ModelAdmin):
    list_display = ('candidate_name', 'job_title', 'status', 'joining_date', 'offer_expiry_date', 'created_at')
    list_filter = ('status', 'employment_type', 'created_at')
    search_fields = ('candidate_name', 'candidate_email', 'job_title', 'company_name')
    ordering = ('-created_at',)


@admin.register(EmployeeDocument)
class EmployeeDocumentAdmin(admin.ModelAdmin):
    list_display = ('employee', 'document_type', 'status', 'created_at')
    list_filter = ('document_type', 'status')
    search_fields = ('employee__name',)


@admin.register(BiometricDevice)
class BiometricDeviceAdmin(admin.ModelAdmin):
    list_display = ('serial_number', 'name', 'hospital', 'ip_address', 'last_seen', 'is_active')
    list_filter = ('is_active', 'hospital')
    search_fields = ('serial_number', 'name')
    readonly_fields = ('last_seen', 'ip_address', 'firmware_version', 'created_at', 'updated_at')


@admin.register(BiometricUnlinkedUser)
class BiometricUnlinkedUserAdmin(admin.ModelAdmin):
    list_display = ('pin', 'name', 'hospital', 'device', 'status', 'last_seen_at')
    list_filter = ('status', 'hospital')
    search_fields = ('pin', 'name')
    raw_id_fields = ('linked_employee', 'resolved_by')


@admin.register(BiometricSyncLog)
class BiometricSyncLogAdmin(admin.ModelAdmin):
    list_display = ('action', 'level', 'hospital', 'device', 'employee', 'created_at')
    list_filter = ('level', 'action')
    search_fields = ('message',)
    readonly_fields = ('created_at', 'updated_at')

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False


@admin.register(BiometricDeviceCommand)
class BiometricDeviceCommandAdmin(admin.ModelAdmin):
    list_display = ('device', 'command_id', 'status', 'attempts', 'return_code', 'created_at')
    list_filter = ('status',)
    readonly_fields = ('created_at', 'updated_at')


@admin.register(BiometricEnrollment)
class BiometricEnrollmentAdmin(admin.ModelAdmin):
    list_display = ('employee', 'device', 'finger_id', 'is_enrolled', 'enrolled_at')
    list_filter = ('is_enrolled',)
