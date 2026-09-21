from django.shortcuts import render, redirect, get_object_or_404
from django.http import HttpResponse, JsonResponse, FileResponse, StreamingHttpResponse
from django.core.validators import validate_email
from django.core.exceptions import ValidationError
from django.utils import timezone
from django.db import models, transaction
from django.db.models import Prefetch, Exists, OuterRef
from django.utils.dateparse import parse_datetime
from decimal import Decimal
import re
import json
import uuid
import os
import csv
import io
import logging
from calendar import monthrange
from datetime import datetime, timedelta, date

logger = logging.getLogger(__name__)
from rest_framework import viewsets, permissions, parsers
from rest_framework.decorators import action, permission_classes
from rest_framework.response import Response
from rest_framework.exceptions import PermissionDenied, NotFound, ValidationError as DRFValidationError
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_http_methods
from apps.shared.models import Hospital
from apps.hr.hospital_context import resolve_hr_hospital_id as _resolve_hr_hospital_id
from apps.hr.models import (
    Employee, Department, Designation, Role, Attendance, LeaveType, LeavePolicy, LeavePolicyLine,
    LeaveBalance, LeaveRequest, Leave, Salary,
    JobOpening, Candidate, Interview, PerformanceReview, Offer,
    OfferTemplate, ComponentOfferTemplate, OfferBuilderV2, OfferLetterSettings, EmployeeDocument,
    DocumentType, EmployeeDocumentRequirement, Shift,
    EmployeeShift, DailyAttendance, AttendancePunch, AttendanceRegularization,
    EmployeePortalNotification, OrganizationHoliday, record_employee_status_history,
)
from apps.hr.serializers import (
    EmployeeSerializer, DepartmentSerializer, DesignationSerializer, RoleSerializer, AttendanceSerializer,
    LeaveTypeSerializer, LeavePolicySerializer, LeaveBalanceSerializer, LeaveRequestSerializer, LeaveSerializer, SalarySerializer, JobOpeningSerializer,
    CandidateSerializer, InterviewSerializer, PerformanceReviewSerializer,
    OfferSerializer, OfferTemplateSerializer, ComponentOfferTemplateSerializer,
    OfferBuilderV2Serializer, OfferLetterSettingsSerializer, EmployeeDocumentSerializer, DocumentTypeSerializer,
    EmployeeDocumentRequirementSerializer,
    ShiftSerializer, EmployeeShiftSerializer, AttendancePunchSerializer,
    DailyAttendanceSerializer, AttendanceRegularizationSerializer, HospitalContextSerializer,
    AttendanceMarkSerializer,
    AttendanceSimulatePunchSerializer,
    GenerateTestAttendanceSerializer,
    EmployeeLeaveApplySerializer,
    EmployeePortalLeaveSerializer,
    EmployeePortalRegularizationSerializer,
    EmployeeRegularizationApplySerializer,
    EmployeePortalNotificationSerializer,
    OrganizationHolidaySerializer,
    EmployeeStatusHistorySerializer,
    PayslipSerializer,
    PayrollAuditLogSerializer,
    PayrollRunSerializer,
)
from apps.hr.services import convert_hired_candidate_to_employee
from apps.hr.services import convert_hired_candidate_to_employee
from apps.hr.manual_employee import create_manual_employee
from apps.hr.attendance_engine import AttendanceCalculationService, recalculate_daily_attendance, recalculate_for_punch, compute_metrics_from_check_times
from apps.hr.attendance_control import (
    AttendanceControlError,
    get_employee_punch_console_state,
    mark_attendance_via_biometric_simulation,
    simulate_biometric_punch,
)
from apps.hr.attendance_seeder import (
    AttendanceSeederError,
    generate_test_attendance,
    parse_holiday_dates,
    resolve_employees,
)
from apps.hr.attendance_policy import get_attendance_timezone, resolve_punch_timestamp
from apps.hr.designation_utils import resolve_designation_display

from django.utils.decorators import method_decorator
from django.views.decorators.cache import never_cache
from apps.hr.attendance_policy import policy_documentation
from apps.hr.attendance_analytics import (
    build_calendar_month,
    build_dashboard_summary,
    build_department_stats,
    build_employee_analytics,
    ensure_day_summaries,
    invalidate_day_rebuild_cache,
)
from apps.hr.employee_portal import get_employee_for_request, resolve_employee_for_user
from apps.hr.job_applications import (
    get_application_block_message,
    get_application_closed_title,
    job_accepts_applications,
    maybe_auto_close_expired_job,
)
from apps.hr.permissions import IsEmployeePortalUser, IsHRStaffUser
from apps.hr.onboarding_documents import (
    activate_employee_after_verification,
    approve_document,
    build_employee_document_review_payload,
    build_candidate_onboarding_payload,
    calculate_onboarding_progress,
    candidate_may_access_onboarding_portal,
    ensure_employee_for_offer,
    find_employee_document,
    find_employee_requirement,
    is_hr_reviewer,
    mark_requirement_physically_verified,
    normalize_document_type,
    approve_requirement_override,
    reject_document,
    sync_employee_requirements,
    request_document_reupload,
    save_requirement_upload,
    record_employee_document_update_request,
)


def _apply_job_context(job, *, applications_closed=False, applications_closed_message=None, **extra):
    ctx = {
        'job': job,
        'applications_closed': applications_closed,
        'applications_closed_message': applications_closed_message,
        'applications_closed_title': get_application_closed_title(job) if applications_closed else None,
    }
    ctx.update(extra)
    return ctx


def _coerce_bool(value, default=False):
    if value is None or value == '':
        return default
    if isinstance(value, bool):
        return value
    return str(value).strip().lower() in {'1', 'true', 'yes', 'on'}


def redirect_public_job_apply(request, job_code):
    """Redirect mistaken /hr/jobs/<code>/apply URLs to the public Django apply form."""
    resolved_code = job_code
    if not JobOpening.objects.filter(job_code=job_code).exists():
        job = JobOpening.objects.filter(pk=job_code).only('job_code').first()
        if job and job.job_code:
            resolved_code = job.job_code
    return redirect('hr:apply_job', job_code=resolved_code)


def apply_job(request, job_code):
    """
    Public job application form view.
    GET: Show job details and application form.
    POST: Save candidate application.
    """
    try:
        job = JobOpening.objects.select_related(
            'department',
            'designation',
        ).prefetch_related(
            'document_requirements__document_type',
        ).get(job_code=job_code)
    except JobOpening.DoesNotExist:
        return HttpResponse(f"Job with code {job_code} not found", status=404)

    maybe_auto_close_expired_job(job)
    job.refresh_from_db()

    if request.method != 'POST' and not job_accepts_applications(job):
        return render(
            request,
            'hr/apply_job.html',
            _apply_job_context(
                job,
                applications_closed=True,
                applications_closed_message=get_application_block_message(job),
            ),
        )

    if request.method == 'POST':
        job.refresh_from_db()
        maybe_auto_close_expired_job(job)
        job.refresh_from_db()
        if not job_accepts_applications(job):
            return render(
                request,
                'hr/apply_job.html',
                _apply_job_context(
                    job,
                    applications_closed=True,
                    applications_closed_message=get_application_block_message(job),
                    form_data=request.POST,
                ),
                status=403,
            )
        name = request.POST.get('name', '').strip()
        email = request.POST.get('email', '').strip()
        phone = request.POST.get('phone', '').strip()
        gender = request.POST.get('gender', '').strip()
        cover_letter = request.POST.get('cover_letter', '').strip()
        experience = request.POST.get('experience', '').strip()
        current_company = request.POST.get('current_company', '').strip()
        expected_salary = request.POST.get('expected_salary', '').strip()
        notice_period = request.POST.get('notice_period', '').strip()
        address = request.POST.get('address', '').strip()
        resume = request.FILES.get('resume')
        passport_photo = request.FILES.get('passport_photo')

        errors = {}

        # Validate name: Required, minimum 2 characters
        if not name:
            errors['name'] = 'Name is required'
        elif len(name) < 2:
            errors['name'] = 'Name must be at least 2 characters'

        # Validate email: Required, valid email format
        if not email:
            errors['email'] = 'Email is required'
        else:
            try:
                validate_email(email)
            except ValidationError:
                errors['email'] = 'Please enter a valid email address'
            else:
                from apps.shared.email_normalization import normalize_email_address
                email = normalize_email_address(email)

        # Validate phone: Required, numeric, exactly 10 digits
        if not phone:
            errors['phone'] = 'Phone number is required'
        elif not phone.isdigit():
            errors['phone'] = 'Phone number must contain only digits'
        elif len(phone) != 10:
            errors['phone'] = 'Phone number must be exactly 10 digits'

        # Validate gender: Required
        from apps.hr.models import Gender
        if not gender:
            errors['gender'] = 'Gender is required'
        elif gender not in Gender.values:
            errors['gender'] = 'Please select a valid gender'

        # Validate address: Required
        if not address:
            errors['address'] = 'Address is required'

        # Validate resume: Required, PDF only, max 5MB
        if not resume:
            errors['resume'] = 'Resume (PDF) is required'
        else:
            if not resume.name.lower().endswith('.pdf'):
                errors['resume'] = 'Only PDF files are allowed for resume upload'
            elif resume.size > 5 * 1024 * 1024:  # 5MB limit
                errors['resume'] = 'Resume file size must be less than 5MB'

        # Validate passport photo: Optional, image only, max 2MB
        if passport_photo:
            allowed_photo_ext = ('.jpg', '.jpeg', '.png', '.webp')
            photo_name = passport_photo.name.lower()
            if not any(photo_name.endswith(ext) for ext in allowed_photo_ext):
                errors['passport_photo'] = 'Only JPG, PNG, or WEBP images are allowed for passport photo'
            elif passport_photo.size > 2 * 1024 * 1024:
                errors['passport_photo'] = 'Passport photo file size must be less than 2MB'

        # Validate experience: Allow alphanumeric (e.g., "3 years", "6 months")
        if experience and len(experience) > 50:
            errors['experience'] = 'Experience must be less than 50 characters'

        # If there are errors, render form with errors
        if errors:
            import json
            return render(
                request,
                'hr/apply_job.html',
                _apply_job_context(
                    job,
                    errors=json.dumps(errors),
                    form_data=request.POST,
                ),
            )

        from apps.hr.recruitment_applications import (
            DUPLICATE_JOB_APPLICATION_MSG,
            create_application_from_public_apply,
        )

        try:
            candidate = create_application_from_public_apply(
                job,
                name=name,
                email=email,
                phone=phone,
                gender=gender,
                cover_letter=cover_letter,
                experience=experience,
                current_company=current_company,
                expected_salary=expected_salary,
                notice_period=notice_period,
                address=address,
                resume=resume,
                passport_photo=passport_photo,
                status='applied',
            )
        except ValueError as exc:
            if str(exc) == DUPLICATE_JOB_APPLICATION_MSG:
                return render(
                    request,
                    'hr/apply_job.html',
                    _apply_job_context(job, error='You have already applied for this job'),
                )
            raise

        return render(request, 'hr/apply_job.html', _apply_job_context(job, success=True))

    return render(request, 'hr/apply_job.html', _apply_job_context(job))


class HRBaseViewSet(viewsets.ModelViewSet):
    """Base viewset that automatically filters and sets hospital."""
    permission_classes = [permissions.IsAuthenticated, IsHRStaffUser]

    def get_queryset(self):
        qs = super().get_queryset()
        user = self.request.user
        if hasattr(user, 'hospital_id') and user.hospital_id:
            # If the model has a hospital field directly
            if hasattr(self.queryset.model, 'hospital'):
                qs = qs.filter(hospital_id=user.hospital_id)
            # If the model links to hospital via employee
            elif hasattr(self.queryset.model, 'employee'):
                qs = qs.filter(employee__hospital_id=user.hospital_id)
        return qs

    def perform_create(self, serializer):
        if hasattr(self.queryset.model, 'hospital'):
            hospital_id = _resolve_hr_hospital_id(self.request)
            if hospital_id:
                serializer.save(hospital_id=hospital_id)
                return
        serializer.save()

class DepartmentViewSet(HRBaseViewSet):
    queryset = Department.objects.annotate(
        employee_count=models.Count('employees', distinct=True),
    ).all()
    serializer_class = DepartmentSerializer

    def destroy(self, request, *args, **kwargs):
        department = self.get_object()
        employee_count = department.employees.count()
        if employee_count:
            return Response(
                {
                    'error': 'Cannot delete department while employees are assigned to it.',
                    'linked_counts': {'employees': employee_count},
                },
                status=409,
            )
        return super().destroy(request, *args, **kwargs)


class DesignationViewSet(HRBaseViewSet):
    queryset = Designation.objects.select_related('department', 'hospital').all()
    serializer_class = DesignationSerializer

    def get_queryset(self):
        qs = super().get_queryset()
        active = self.request.query_params.get('active')
        if active == 'true':
            qs = qs.filter(is_active=True)
        elif active == 'false':
            qs = qs.filter(is_active=False)
        search = (self.request.query_params.get('search') or '').strip()
        if search:
            qs = qs.filter(models.Q(name__icontains=search) | models.Q(code__icontains=search))
        department_id = (self.request.query_params.get('department') or '').strip()
        if department_id:
            qs = qs.filter(department_id=department_id)
        return qs.order_by('level', 'name')

    def get_serializer_context(self):
        ctx = super().get_serializer_context()
        ctx['hospital_id'] = _resolve_hr_hospital_id(self.request)
        return ctx

    def perform_create(self, serializer):
        hospital_id = _resolve_hr_hospital_id(self.request)
        if hospital_id:
            serializer.save(hospital_id=hospital_id)
        else:
            serializer.save()

    @action(detail=True, methods=['post'])
    def activate(self, request, pk=None):
        designation = self.get_object()
        designation.is_active = True
        designation.save(update_fields=['is_active', 'updated_at'])
        return Response(DesignationSerializer(designation, context=self.get_serializer_context()).data)

    @action(detail=True, methods=['post'])
    def deactivate(self, request, pk=None):
        designation = self.get_object()
        designation.is_active = False
        designation.save(update_fields=['is_active', 'updated_at'])
        return Response(DesignationSerializer(designation, context=self.get_serializer_context()).data)

    def destroy(self, request, *args, **kwargs):
        designation = self.get_object()
        employee_count = designation.employees.count()
        job_opening_count = designation.job_openings.count()
        salary_structure_count = designation.salary_structures.count()
        compensation_level_count = designation.compensation_levels.count()
        if employee_count or job_opening_count or salary_structure_count or compensation_level_count:
            return Response(
                {
                    'error': 'Cannot delete designation while it is assigned to employees, job openings, salary structures, or compensation levels.',
                    'linked_counts': {
                        'employees': employee_count,
                        'job_openings': job_opening_count,
                        'salary_structures': salary_structure_count,
                        'compensation_levels': compensation_level_count,
                    },
                },
                status=409,
            )
        return super().destroy(request, *args, **kwargs)


class RoleViewSet(HRBaseViewSet):
    queryset = Role.objects.all()
    serializer_class = RoleSerializer


class DocumentTypeViewSet(HRBaseViewSet):
    queryset = DocumentType.objects.all()
    serializer_class = DocumentTypeSerializer

    def get_queryset(self):
        from django.db.models import Q
        from apps.hr.document_type_dedup import dedupe_queryset_for_list

        user = self.request.user
        hospital_id = getattr(user, 'hospital_id', None)
        if hospital_id:
            qs = DocumentType.objects.filter(Q(hospital_id=hospital_id) | Q(hospital__isnull=True))
        else:
            qs = super().get_queryset()
        return dedupe_queryset_for_list(qs)

    def list(self, request, *args, **kwargs):
        """Seed standard onboarding docs so HR sees them on checklist-rules."""
        from apps.hr.onboarding_documents import ensure_default_document_types

        hospital_id = _resolve_hr_hospital_id(request)
        if hospital_id:
            hospital = Hospital.objects.filter(pk=hospital_id).first()
            if hospital:
                ensure_default_document_types(hospital)
        return super().list(request, *args, **kwargs)

    @action(detail=False, methods=['post'], url_path='seed-defaults')
    def seed_defaults(self, request):
        from apps.hr.onboarding_documents import ensure_default_document_types

        hospital_id = _resolve_hr_hospital_id(request)
        if not hospital_id:
            return Response({
                'error': 'Hospital context is required. Link your account to a hospital or pass hospital_id.',
            }, status=400)
        hospital = Hospital.objects.filter(pk=hospital_id).first()
        if not hospital:
            return Response({'error': 'Hospital not found.'}, status=404)
        created = ensure_default_document_types(hospital)
        return Response({
            'created': len(created),
            'names': [row.name for row in created],
        })


class HospitalContextViewSet(viewsets.ReadOnlyModelViewSet):
    serializer_class = HospitalContextSerializer
    permission_classes = [permissions.IsAuthenticated, IsHRStaffUser]

    def get_queryset(self):
        user = self.request.user
        if getattr(user, 'hospital_id', None):
            return Hospital.objects.filter(id=user.hospital_id).order_by('name')
        if is_hr_reviewer(user):
            return Hospital.objects.all().order_by('name')
        return Hospital.objects.none()


class EmployeeViewSet(HRBaseViewSet):
    queryset = Employee.objects.select_related(
        'designation',
        'department_ref',
        'shift',
        'last_working_day_confirmed_by',
    ).all()
    serializer_class = EmployeeSerializer

    def get_queryset(self):
        from apps.hr.document_moderation import exclude_rejected_applications

        qs = super().get_queryset()
        job_opening = (self.request.query_params.get('job_opening') or '').strip()
        if job_opening:
            qs = qs.filter(candidate__job_opening_id=job_opening)
        statuses_param = (
            self.request.query_params.get('statuses')
            or self.request.query_params.get('status__in')
            or ''
        ).strip()
        status = (self.request.query_params.get('status') or '').strip()
        if statuses_param:
            statuses = [value.strip() for value in statuses_param.split(',') if value.strip()]
            if statuses:
                qs = qs.filter(status__in=statuses)
                if set(statuses) == {'pending_onboarding'}:
                    qs = exclude_rejected_applications(qs)
        elif status:
            qs = qs.filter(status=status)
            if status == 'pending_onboarding':
                qs = exclude_rejected_applications(qs)
        if _coerce_bool(self.request.query_params.get('exited')):
            qs = qs.filter(status__in=['inactive', 'terminated'])
        exit_reason = (self.request.query_params.get('exit_reason') or '').strip()
        if exit_reason:
            qs = qs.filter(exit_reason=exit_reason)
        search = (self.request.query_params.get('search') or '').strip()
        if search:
            qs = qs.filter(
                models.Q(name__icontains=search)
                | models.Q(employee_id__icontains=search)
                | models.Q(email__icontains=search)
                | models.Q(job_title__icontains=search)
                | models.Q(department__icontains=search)
                | models.Q(designation__name__icontains=search)
            )
        return qs

    @action(detail=False, methods=['get'], url_path='manual-lookup')
    def manual_lookup(self, request):
        """Return whether an employee already exists for this email (manual hire duplicate check)."""
        from apps.shared.email_normalization import normalize_email_address
        email = normalize_email_address(request.query_params.get('email'))
        if not email:
            return Response({'exists': False})
        emp = Employee.objects.filter(email__iexact=email).first()
        if not emp:
            return Response({'exists': False})
        return Response({
            'exists': True,
            'employee': EmployeeSerializer(emp).data,
        })

    @action(detail=False, methods=['post'], url_path='manual-create')
    def manual_create(self, request):
        """
        Create an employee without recruitment (direct / walk-in / migrated hire).
        See apps.hr.manual_employee.create_manual_employee for payload contract.
        """
        user = request.user
        from apps.shared.models import Hospital

        hid = _resolve_hr_hospital_id(request)
        hospital = Hospital.objects.filter(pk=hid).first() if hid else getattr(user, 'hospital', None)
        try:
            employee, meta = create_manual_employee(hr_user=user, hospital=hospital, payload=request.data)
        except ValueError as exc:
            msg = str(exc)
            if msg == 'duplicate_email':
                from apps.shared.email_normalization import normalize_email_address
                email = normalize_email_address(request.data.get('email'))
                emp = Employee.objects.filter(email__iexact=email).first()
                return Response(
                    {
                        'code': 'duplicate_email',
                        'message': 'An employee with this email already exists.',
                        'existing_employee': EmployeeSerializer(emp).data if emp else None,
                    },
                    status=409,
                )
            if msg == 'hospital_required_for_portal':
                return Response(
                    {
                        'error': 'Your account must be linked to a hospital (or pass hospital_id) to enable document collection and onboarding links.',
                    },
                    status=400,
                )
            return Response({'error': msg}, status=400)
        return Response({
            'success': True,
            'employee': EmployeeSerializer(employee).data,
            **meta,
        })

    @action(detail=True, methods=['get'], url_path='documents')
    def documents(self, request, pk=None):
        from apps.hr.document_moderation import is_application_rejected

        employee = self.get_object()
        if is_application_rejected(employee):
            return Response(
                {'error': 'Application rejected.', 'application_rejected': True},
                status=404,
            )
        return Response(build_employee_document_review_payload(employee))

    @action(detail=True, methods=['post'], url_path='activate-onboarding')
    def activate_onboarding(self, request, pk=None):
        employee = self.get_object()
        override = request.data.get('override_missing_designation') in (True, 'true', '1', 1)
        result = activate_employee_after_verification(
            employee=employee,
            reviewer=request.user,
            override_missing_designation=override,
        )
        if result['success']:
            return Response(result)
        return Response(result, status=400)

    @action(detail=True, methods=['post'], url_path='biometric-sync')
    def biometric_sync(self, request, pk=None):
        employee = self.get_object()
        from apps.hr.biometric.sync import assign_biometric_pin, push_employee_to_hospital_devices

        if not employee.biometric_attendance_enabled:
            employee.biometric_attendance_enabled = True
            employee.save(update_fields=['biometric_attendance_enabled', 'updated_at'])
        if not (employee.biometric_pin or '').strip():
            assign_biometric_pin(employee)
            employee.refresh_from_db(fields=['biometric_pin'])
        results = push_employee_to_hospital_devices(employee)
        return Response({
            'success': True,
            'biometric_pin': employee.biometric_pin,
            'push_results': results,
        })

    @action(detail=True, methods=['post'], url_path='biometric-remove')
    def biometric_remove(self, request, pk=None):
        employee = self.get_object()
        from apps.hr.biometric.sync import remove_employee_from_hospital_devices

        results = remove_employee_from_hospital_devices(employee)
        employee.biometric_attendance_enabled = False
        employee.save(update_fields=['biometric_attendance_enabled', 'updated_at'])
        return Response({
            'success': True,
            'push_results': results,
        })

    @action(detail=True, methods=['post'], url_path='mark-exited')
    def mark_exited(self, request, pk=None):
        """Mark employee as terminated/inactive with exit details for experience letter."""
        from datetime import datetime

        employee = self.get_object()
        previous_status = employee.status
        status = (request.data.get('status') or '').strip()
        if status not in ('terminated', 'inactive'):
            return Response(
                {'error': 'status must be terminated or inactive'},
                status=400,
            )

        relieving_date_raw = (request.data.get('relieving_date') or '').strip()
        if not relieving_date_raw:
            return Response({'error': 'relieving_date is required'}, status=400)
        try:
            relieving_date = datetime.strptime(relieving_date_raw[:10], '%Y-%m-%d').date()
        except ValueError:
            return Response({'error': 'relieving_date must be YYYY-MM-DD'}, status=400)

        exit_reason = (request.data.get('exit_reason') or '').strip()
        if not exit_reason:
            return Response({'error': 'exit_reason is required'}, status=400)
        allowed_exit_reasons = {choice[0] for choice in Employee.EXIT_REASON_CHOICES if choice[0]}
        if exit_reason not in allowed_exit_reasons:
            return Response({'error': 'exit_reason is invalid'}, status=400)
        exit_notes = (request.data.get('exit_notes') or '').strip()
        conduct_remarks = (request.data.get('conduct_remarks') or 'satisfactory').strip() or 'satisfactory'
        eligible_for_rehire = _coerce_bool(request.data.get('eligible_for_rehire'), default=True)
        if status == 'terminated' and 'eligible_for_rehire' not in request.data:
            eligible_for_rehire = False

        employee.status = status
        employee.relieving_date = relieving_date
        employee.exit_reason = exit_reason
        employee.exit_notes = exit_notes
        employee.conduct_remarks = conduct_remarks
        employee.eligible_for_rehire = eligible_for_rehire
        employee.last_working_day_confirmed_by = request.user
        if employee.status not in ('inactive', 'terminated') or previous_status not in ('inactive', 'terminated'):
            employee.exited_at = timezone.now()
        employee.save(update_fields=[
            'status',
            'relieving_date',
            'exit_reason',
            'exit_notes',
            'conduct_remarks',
            'eligible_for_rehire',
            'last_working_day_confirmed_by',
            'exited_at',
            'updated_at',
        ])
        record_employee_status_history(
            employee,
            previous_status=previous_status,
            new_status=status,
            event_type='exit',
            exit_reason=exit_reason,
            notes=exit_notes,
            conduct_remarks=conduct_remarks,
            relieving_date=relieving_date,
            eligible_for_rehire=eligible_for_rehire,
            changed_by=request.user,
        )
        return Response({
            'success': True,
            'employee': EmployeeSerializer(employee, context={'request': request}).data,
        })

    @action(detail=True, methods=['post'], url_path='restore-active')
    def restore_active(self, request, pk=None):
        employee = self.get_object()
        if employee.status not in ('inactive', 'terminated'):
            return Response({'error': 'Only exited employees can be restored.'}, status=400)
        reason = (request.data.get('reason') or '').strip()
        if not reason:
            return Response({'error': 'reason is required'}, status=400)
        previous_status = employee.status
        previous_snapshot = {
            'exit_reason': employee.exit_reason,
            'exit_notes': employee.exit_notes,
            'conduct_remarks': employee.conduct_remarks,
            'relieving_date': employee.relieving_date,
            'eligible_for_rehire': employee.eligible_for_rehire,
        }
        employee.status = 'active'
        employee.relieving_date = None
        employee.exit_reason = ''
        employee.exit_notes = ''
        employee.conduct_remarks = 'satisfactory'
        employee.eligible_for_rehire = True
        employee.last_working_day_confirmed_by = None
        employee.exited_at = None
        employee.save(update_fields=[
            'status',
            'relieving_date',
            'exit_reason',
            'exit_notes',
            'conduct_remarks',
            'eligible_for_rehire',
            'last_working_day_confirmed_by',
            'exited_at',
            'updated_at',
        ])
        record_employee_status_history(
            employee,
            previous_status=previous_status,
            new_status='active',
            event_type='restore',
            exit_reason=previous_snapshot['exit_reason'],
            notes=reason,
            conduct_remarks=previous_snapshot['conduct_remarks'],
            relieving_date=previous_snapshot['relieving_date'],
            eligible_for_rehire=previous_snapshot['eligible_for_rehire'],
            changed_by=request.user,
        )
        return Response({
            'success': True,
            'employee': EmployeeSerializer(employee, context={'request': request}).data,
        })

    @action(detail=True, methods=['get'], url_path='status-history')
    def status_history(self, request, pk=None):
        employee = self.get_object()
        history = employee.status_history.select_related('changed_by').all()
        serializer = EmployeeStatusHistorySerializer(history, many=True)
        return Response(serializer.data)

    @action(detail=True, methods=['get'], url_path='experience-letter/preview')
    def experience_letter_preview(self, request, pk=None):
        from apps.hr.utils.experience_letter_renderer import (
            ExperienceLetterError,
            render_experience_letter_html,
        )

        employee = self.get_object()
        try:
            html = render_experience_letter_html(employee, request=request)
        except ExperienceLetterError as exc:
            return Response({'error': str(exc)}, status=400)
        return Response({'html': html})

    @action(detail=True, methods=['get'], url_path='experience-letter/download')
    def experience_letter_download(self, request, pk=None):
        from django.http import HttpResponse

        from apps.hr.utils.experience_letter_renderer import (
            ExperienceLetterError,
            experience_letter_filename,
            render_experience_letter_pdf_bytes,
        )

        employee = self.get_object()
        try:
            pdf_data = render_experience_letter_pdf_bytes(employee, request=request)
        except ExperienceLetterError as exc:
            return Response({'error': str(exc)}, status=400)
        if not pdf_data:
            return Response({'error': 'Failed to generate PDF'}, status=500)
        response = HttpResponse(pdf_data, content_type='application/pdf')
        response['Content-Disposition'] = f'attachment; filename="{experience_letter_filename(employee)}"'
        return response

class AttendanceViewSet(HRBaseViewSet):
    queryset = Attendance.objects.all()
    serializer_class = AttendanceSerializer


class AttendancePunchViewSet(HRBaseViewSet):
    queryset = AttendancePunch.objects.select_related('employee', 'shift', 'created_by', 'duplicate_of').all()
    serializer_class = AttendancePunchSerializer

    def get_queryset(self):
        qs = super().get_queryset()
        employee_id = self.request.query_params.get('employee')
        source = self.request.query_params.get('source')
        punch_type = self.request.query_params.get('punch_type')
        shift_id = self.request.query_params.get('shift')
        suspicious = self.request.query_params.get('suspicious')
        date_from = self.request.query_params.get('date_from')
        date_to = self.request.query_params.get('date_to')
        search = (self.request.query_params.get('search') or '').strip()

        if employee_id:
            qs = qs.filter(employee_id=employee_id)
        if source:
            qs = qs.filter(source=source)
        if punch_type:
            qs = qs.filter(punch_type=punch_type)
        if shift_id:
            qs = qs.filter(shift_id=shift_id)
        if suspicious in {'true', '1', 'yes'}:
            qs = qs.filter(is_suspicious=True)
        elif suspicious in {'false', '0', 'no'}:
            qs = qs.filter(is_suspicious=False)
        if date_from:
            qs = qs.filter(
                models.Q(attendance_date__gte=date_from)
                | models.Q(attendance_date__isnull=True, timestamp__date__gte=date_from)
            )
        if date_to:
            qs = qs.filter(
                models.Q(attendance_date__lte=date_to)
                | models.Q(attendance_date__isnull=True, timestamp__date__lte=date_to)
            )
        if search:
            qs = qs.filter(
                models.Q(employee__name__icontains=search)
                | models.Q(employee__employee_id__icontains=search)
                | models.Q(device_id__icontains=search)
            )
        return qs

    def get_serializer_context(self):
        ctx = super().get_serializer_context()
        ctx['duplicate_threshold_minutes'] = self.request.data.get(
            'duplicate_threshold_minutes',
            self.request.query_params.get('duplicate_threshold_minutes', 2),
        )
        return ctx

    def create(self, request, *args, **kwargs):
        logger.debug('[PunchCreate] payload=%s', request.data)
        serializer = self.get_serializer(data=request.data)
        if not serializer.is_valid():
            logger.warning('[PunchCreate] validation_errors=%s payload=%s', serializer.errors, request.data)
            return Response(serializer.errors, status=400)
        logger.debug('[PunchCreate] validated_data=%s', serializer.validated_data)
        self.perform_create(serializer)
        headers = self.get_success_headers(serializer.data)
        return Response(serializer.data, status=201, headers=headers)

    def perform_create(self, serializer):
        punch = serializer.save()
        logger.info(
            '[Punch] created punch=%s employee=%s type=%s source=%s suspicious=%s by=%s',
            punch.id,
            punch.employee_id,
            punch.punch_type,
            punch.source,
            punch.is_suspicious,
            getattr(self.request.user, 'id', None),
        )
        try:
            recalculate_for_punch(punch, force=True)
            invalidate_day_rebuild_cache()
        except Exception:
            logger.exception('[AttendanceEngine] failed after punch create punch=%s', punch.id)

    def perform_update(self, serializer):
        previous = self.get_object()
        previous_employee = previous.employee
        previous_day = previous.attendance_date or timezone.localtime(previous.timestamp).date()
        punch = serializer.save()
        logger.info('[Punch] updated punch=%s by=%s', punch.id, getattr(self.request.user, 'id', None))
        recalculation_targets = {(punch.employee_id, punch.attendance_date or timezone.localtime(punch.timestamp).date())}
        if previous_employee.id != punch.employee_id or previous_day != punch.attendance_date:
            recalculation_targets.add((previous_employee.id, previous_day))
        for employee_id, day in recalculation_targets:
            try:
                employee = Employee.objects.get(pk=employee_id)
                recalculate_daily_attendance(employee, day, force=True)
                invalidate_day_rebuild_cache()
            except Exception:
                logger.exception('[AttendanceEngine] failed after punch update punch=%s employee=%s date=%s', punch.id, employee_id, day)

    def destroy(self, request, *args, **kwargs):
        punch = self.get_object()
        reason = request.data.get('void_reason') if hasattr(request, 'data') else ''
        punch.is_void = True
        punch.void_reason = reason or 'Voided by HR. Raw punch preserved.'
        punch.voided_at = timezone.now()
        punch.voided_by = request.user if request.user.is_authenticated else None
        punch.save(update_fields=['is_void', 'void_reason', 'voided_at', 'voided_by', 'updated_at'])
        logger.info('[Punch] voided punch=%s by=%s', punch.id, getattr(request.user, 'id', None))
        try:
            recalculate_for_punch(punch, force=True)
            invalidate_day_rebuild_cache()
        except Exception:
            logger.exception('[AttendanceEngine] failed after punch void punch=%s', punch.id)
        return Response({'success': True, 'message': 'Punch voided. Raw record preserved.'})

    @action(detail=True, methods=['post'], url_path='mark-reviewed')
    def mark_reviewed(self, request, pk=None):
        punch = self.get_object()
        punch.is_suspicious = False
        note = request.data.get('notes') or 'Reviewed by HR.'
        punch.notes = f"{punch.notes}\n{note}".strip()
        punch.save(update_fields=['is_suspicious', 'notes', 'updated_at'])
        logger.info('[Punch] reviewed punch=%s by=%s', punch.id, getattr(request.user, 'id', None))
        try:
            recalculate_for_punch(punch, force=True)
            invalidate_day_rebuild_cache()
        except Exception:
            logger.exception('[AttendanceEngine] failed after punch review punch=%s', punch.id)
        return Response({'success': True, 'punch': self.get_serializer(punch).data})


class AttendanceControlViewSet(viewsets.ViewSet):
    """
    HR-only biometric device simulation.
    ``punch`` — one IN/OUT tap at a time (real machine flow).
    ``mark`` — legacy bulk day mark (both punches at once).
    """

    permission_classes = [permissions.IsAuthenticated, IsHRStaffUser]

    @action(detail=False, methods=['get'], url_path='console')
    def console(self, request):
        employee_id = request.query_params.get('employee_id')
        if not employee_id:
            return Response({'error': 'employee_id is required.'}, status=400)
        date_raw = request.query_params.get('date')
        work_date = None
        if date_raw:
            from django.utils.dateparse import parse_date
            work_date = parse_date(date_raw)
            if not work_date:
                return Response({'error': 'Invalid date.'}, status=400)
        try:
            payload = get_employee_punch_console_state(
                employee_id=employee_id,
                work_date=work_date,
                hospital_id=getattr(request.user, 'hospital_id', None),
            )
        except AttendanceControlError as exc:
            status_code = 403 if exc.code == 'forbidden' else 400
            return Response({'success': False, 'code': exc.code, 'message': exc.message}, status=status_code)
        return Response({'success': True, **payload})

    @action(detail=False, methods=['post'], url_path='punch')
    def punch(self, request):
        serializer = AttendanceSimulatePunchSerializer(data=request.data)
        if not serializer.is_valid():
            return Response(serializer.errors, status=400)
        data = serializer.validated_data
        try:
            result = simulate_biometric_punch(
                employee_id=data['employee_id'],
                punch_type=data['punch_type'],
                timestamp=data.get('timestamp'),
                punch_date=data.get('punch_date'),
                punch_time=(data.get('punch_time') or '').strip() or None,
                marked_by=request.user,
                hospital_id=getattr(request.user, 'hospital_id', None),
            )
        except AttendanceControlError as exc:
            status_code = 403 if exc.code == 'forbidden' else 400
            return Response({'success': False, 'code': exc.code, 'message': exc.message}, status=status_code)
        invalidate_day_rebuild_cache()
        return Response(
            {
                'success': True,
                'punch_id': result.punch_id,
                'punch_type': result.punch_type,
                'timestamp': result.timestamp,
                'local_time': result.local_time,
                'attendance_date': result.attendance_date,
                'suggested_next_punch_type': result.suggested_next_punch_type,
                'today_punches': result.today_punches,
                'daily_attendance': result.daily_attendance,
            },
            status=201,
        )

    @action(detail=False, methods=['post'], url_path='mark')
    def mark(self, request):
        serializer = AttendanceMarkSerializer(data=request.data)
        if not serializer.is_valid():
            return Response(serializer.errors, status=400)

        hospital_id = getattr(request.user, 'hospital_id', None)
        data = serializer.validated_data
        try:
            result = mark_attendance_via_biometric_simulation(
                employee_id=data['employee_id'],
                work_date=data['date'],
                status=data['status'],
                check_in=data.get('check_in') or None,
                check_out=data.get('check_out') or None,
                marked_by=request.user,
                hospital_id=hospital_id,
                replace_existing=bool(data.get('replace_existing', False)),
            )
        except AttendanceControlError as exc:
            status_code = 403 if exc.code == 'forbidden' else 400
            return Response(
                {'success': False, 'code': exc.code, 'message': exc.message},
                status=status_code,
            )

        invalidate_day_rebuild_cache()
        return Response(
            {
                'success': True,
                'employee_id': result.employee_id,
                'date': result.date,
                'requested_status': result.requested_status,
                'attendance_status': result.attendance_status,
                'punch_ids': result.punch_ids,
                'daily_attendance_id': result.daily_attendance_id,
                'audit_log_id': result.audit_log_id,
            },
            status=201,
        )


class AttendanceTestSeederViewSet(viewsets.ViewSet):
    """
    HR-only: generate realistic monthly attendance (real punches + engine summaries).
    """

    permission_classes = [permissions.IsAuthenticated, IsHRStaffUser]

    @action(detail=False, methods=['get'], url_path='scenarios')
    def scenarios(self, request):
        return Response({
            'scenarios': [
                {'id': 'perfect', 'label': 'Scenario A — Perfect Employee', 'description': '100% on-time attendance on working days.'},
                {'id': 'average', 'label': 'Scenario B — Average Employee', 'description': 'Mostly present with some late days and absences.'},
                {'id': 'problem', 'label': 'Scenario C — Problem Employee', 'description': 'Frequent late arrivals, absences, and half days.'},
                {'id': 'overtime', 'label': 'Scenario D — Overtime Employee', 'description': 'Regular extended checkout (when shift allows OT).'},
                {'id': 'payroll_stress', 'label': 'Payroll stress test', 'description': 'Mixed month for payroll validation.'},
            ],
        })

    @action(detail=False, methods=['post'], url_path='generate')
    def generate(self, request):
        serializer = GenerateTestAttendanceSerializer(data=request.data)
        if not serializer.is_valid():
            return Response(serializer.errors, status=400)

        data = serializer.validated_data
        hospital_id = getattr(request.user, 'hospital_id', None)
        employees = resolve_employees(
            employee_ids=data.get('employee_ids') or None,
            hospital_id=hospital_id,
        )
        if not employees:
            return Response(
                {'error': 'No eligible employees found (active, with shift, in scope).'},
                status=400,
            )

        try:
            summary = generate_test_attendance(
                employees=employees,
                year=int(data['year']),
                month=int(data['month']),
                scenario=data['scenario'],
                holiday_dates=parse_holiday_dates(data.get('holiday_dates')),
                replace_existing=bool(data.get('replace_existing', True)),
                created_by=request.user,
                hospital_id=hospital_id,
            )
        except AttendanceSeederError as exc:
            return Response({'success': False, 'code': exc.code, 'message': exc.message}, status=400)

        invalidate_day_rebuild_cache()

        payload = summary.as_dict()
        payload['success'] = True
        payload['month'] = f"{data['year']}-{int(data['month']):02d}"
        payload['scenario'] = data['scenario']
        payload['employee_codes'] = [e.employee_id for e in employees]
        logger.info('[AttendanceSeeder] generated month=%s scenario=%s summary=%s', payload['month'], payload['scenario'], payload)
        return Response(payload, status=201)


class EmployeePortalViewSet(viewsets.ViewSet):
    """
    Employee self-service portal — scoped to the logged-in user's Employee record (email mapping).
    """

    permission_classes = [permissions.IsAuthenticated, IsEmployeePortalUser]
    parser_classes = [parsers.JSONParser, parsers.MultiPartParser, parsers.FormParser]

    def _employee(self, request, *, require_active: bool = False):
        return get_employee_for_request(request, require_active=require_active)

    @action(detail=False, methods=['get'])
    def dashboard(self, request):
        employee = self._employee(request)
        today = timezone.localdate()
        month = today.strftime('%Y-%m')
        try:
            analytics = build_employee_analytics(str(employee.id), month=month)
        except Exception:
            logger.exception('[EmployeePortal] dashboard analytics failed employee=%s', employee.id)
            analytics = None
        from apps.hr.payslip_portal import published_payslips_for_employee

        recent_payslips = published_payslips_for_employee(employee)[:3]
        recent = (
            LeaveRequest.objects.filter(employee=employee)
            .select_related('leave_type')
            .order_by('-applied_on')[:5]
        )
        return Response({
            'employee': {
                'id': str(employee.id),
                'name': employee.name,
                'employee_id': employee.employee_id,
                'department': employee.department,
                'designation': resolve_designation_display(employee),
                'shift_name': employee.shift.name if employee.shift_id else None,
                'shift_start': str(employee.shift.start_time) if employee.shift_id and employee.shift.start_time else None,
                'shift_end': str(employee.shift.end_time) if employee.shift_id and employee.shift.end_time else None,
                'status': employee.status,
            },
            'attendance_summary': analytics.get('summary') if analytics else {},
            'attendance_period': analytics.get('period') if analytics else {},
            'recent_payslips': PayslipSerializer(
                recent_payslips, many=True, context={'request': request},
            ).data,
            'recent_leave_requests': EmployeePortalLeaveSerializer(
                recent, many=True, context={'request': request},
            ).data,
        })

    @action(detail=False, methods=['get'])
    def profile(self, request):
        employee = self._employee(request)
        return Response({
            'id': str(employee.id),
            'name': employee.name,
            'employee_id': employee.employee_id,
            'email': employee.email,
            'phone': employee.phone,
            'department': employee.department,
            'designation': resolve_designation_display(employee),
            'joining_date': employee.joining_date.isoformat() if employee.joining_date else None,
            'status': employee.status,
            'shift': {
                'name': employee.shift.name if employee.shift_id else None,
                'code': employee.shift.code if employee.shift_id else None,
                'start_time': str(employee.shift.start_time) if employee.shift_id and employee.shift.start_time else None,
                'end_time': str(employee.shift.end_time) if employee.shift_id and employee.shift.end_time else None,
            } if employee.shift_id else None,
            'hospital_id': str(employee.hospital_id) if employee.hospital_id else None,
        })

    @action(detail=False, methods=['get'])
    def attendance(self, request):
        employee = self._employee(request)
        month = request.query_params.get('month')
        if not month:
            month = timezone.localdate().strftime('%Y-%m')
        try:
            analytics = build_employee_analytics(str(employee.id), month=month)
        except Exception:
            logger.exception('[EmployeePortal] attendance analytics failed employee=%s month=%s', employee.id, month)
            return Response(
                {'error': 'Attendance data could not be loaded. Please try again.'},
                status=500,
            )
        if analytics is None:
            return Response({'error': 'Attendance data unavailable.'}, status=404)
        return Response(analytics)

    @action(detail=False, methods=['get', 'post'], url_path='regularizations')
    def regularizations(self, request):
        employee = self._employee(request)
        if request.method == 'GET':
            status_filter = (request.query_params.get('status') or '').strip().lower()
            month = (request.query_params.get('month') or '').strip()
            qs = (
                AttendanceRegularization.objects.filter(employee=employee)
                .select_related('attendance', 'reviewed_by')
                .order_by('-created_at')
            )
            if status_filter:
                qs = qs.filter(status=status_filter)
            if month and len(month) >= 7:
                year_s, month_s = month[:7].split('-')
                year, mon = int(year_s), int(month_s)
                start = date(year, mon, 1)
                _, last = monthrange(year, mon)
                end = date(year, mon, last)
                qs = qs.filter(
                    models.Q(attendance__date__gte=start, attendance__date__lte=end)
                    | models.Q(requested_check_in__date__gte=start, requested_check_in__date__lte=end)
                    | models.Q(requested_check_out__date__gte=start, requested_check_out__date__lte=end)
                )
            return Response({
                'results': EmployeePortalRegularizationSerializer(
                    qs[:100], many=True, context={'request': request},
                ).data,
            })

        employee = self._employee(request, require_active=True)
        serializer = EmployeeRegularizationApplySerializer(
            data=request.data,
            context={'employee': employee},
        )
        if not serializer.is_valid():
            return Response(serializer.errors, status=400)

        data = serializer.validated_data
        from apps.hr.regularization_notifications import schedule_regularization_submitted_notification

        regularization = AttendanceRegularization.objects.create(
            employee=employee,
            attendance=data.get('attendance'),
            requested_check_in=data.get('requested_check_in'),
            requested_check_out=data.get('requested_check_out'),
            reason=data['reason'].strip(),
            status='pending',
        )
        schedule_regularization_submitted_notification(regularization.id)
        logger.info(
            '[EmployeePortal] regularization submitted employee=%s request=%s date=%s',
            employee.employee_id,
            regularization.id,
            data['date'].isoformat(),
        )
        return Response(
            EmployeePortalRegularizationSerializer(regularization, context={'request': request}).data,
            status=201,
        )

    @action(detail=False, methods=['get'], url_path='leave-types')
    def leave_types(self, request):
        from apps.hr.leave_services import ensure_employee_leave_balances, get_assigned_leave_types, resolve_policy_for_employee

        employee = self._employee(request)
        try:
            ensure_employee_leave_balances(employee)
        except Exception:
            logger.exception(
                '[EmployeePortal] leave balance provisioning failed employee=%s',
                employee.employee_id,
            )
        qs = get_assigned_leave_types(employee)
        policy = resolve_policy_for_employee(employee)
        balances = {}
        for row in LeaveBalance.objects.filter(employee=employee).select_related('leave_type'):
            if row.is_unlimited:
                balances[str(row.leave_type_id)] = {
                    'total_days': None,
                    'used_days': str(row.used_days),
                    'remaining_days': None,
                    'is_unlimited': True,
                }
            else:
                balances[str(row.leave_type_id)] = {
                    'total_days': str(row.total_days),
                    'used_days': str(row.used_days),
                    'remaining_days': str(row.remaining_days),
                    'is_unlimited': False,
                }
        types = LeaveTypeSerializer(qs, many=True).data
        for row in types:
            row['balance'] = balances.get(str(row['id']))
        return Response({
            'leave_types': types,
            'policy': {
                'id': str(policy.id),
                'name': policy.name,
            } if policy else None,
        })

    @action(detail=False, methods=['get', 'post'], url_path='leaves')
    def leaves(self, request):
        employee = self._employee(request)
        if request.method == 'GET':
            status_filter = (request.query_params.get('status') or '').strip().upper()
            qs = LeaveRequest.objects.filter(employee=employee).select_related('leave_type').order_by('-applied_on')
            if status_filter:
                qs = qs.filter(status=status_filter)
            return Response({
                'results': EmployeePortalLeaveSerializer(
                    qs, many=True, context={'request': request},
                ).data,
            })

        employee = self._employee(request, require_active=True)
        serializer = EmployeeLeaveApplySerializer(
            data=request.data,
            context={'employee': employee, 'request': request},
        )
        if not serializer.is_valid():
            return Response(serializer.errors, status=400)

        data = serializer.validated_data
        from apps.hr.leave_notifications import (
            pending_notification_event,
            schedule_leave_submitted_notification,
        )

        leave_request = LeaveRequest.objects.create(
            employee=employee,
            leave_type=data['leave_type'],
            start_date=data['start_date'],
            end_date=data['end_date'],
            number_of_days=data['number_of_days'],
            reason=data.get('reason') or '',
            attachment=data.get('attachment'),
            status=LeaveRequest.STATUS_PENDING,
            applied_by=request.user,
            notification_events=[pending_notification_event('submitted')],
        )
        schedule_leave_submitted_notification(leave_request.id)
        logger.info(
            '[EmployeePortal] leave applied employee=%s request=%s by=%s',
            employee.employee_id,
            leave_request.id,
            request.user.id,
        )
        return Response(
            EmployeePortalLeaveSerializer(leave_request, context={'request': request}).data,
            status=201,
        )

    @action(detail=False, methods=['post'], url_path=r'leaves/(?P<leave_id>[^/.]+)/cancel')
    def cancel_leave(self, request, leave_id=None):
        employee = self._employee(request)
        leave_request = get_object_or_404(
            LeaveRequest.objects.select_related('leave_type'),
            pk=leave_id,
            employee=employee,
        )
        if leave_request.status != LeaveRequest.STATUS_PENDING:
            return Response({'error': 'Only pending leave requests can be cancelled.'}, status=400)
        leave_request.status = LeaveRequest.STATUS_CANCELLED
        leave_request.remarks = (request.data.get('remarks') or 'Cancelled by employee.').strip()
        events = list(leave_request.notification_events or [])
        events.append({
            'event': 'cancelled',
            'status': 'employee_portal',
            'message': 'Cancelled by employee via portal.',
            'at': timezone.now().isoformat(),
        })
        leave_request.notification_events = events
        leave_request.save(update_fields=['status', 'remarks', 'notification_events', 'updated_at'])
        return Response(EmployeePortalLeaveSerializer(leave_request, context={'request': request}).data)

    @action(detail=False, methods=['get'], url_path='payslips')
    def payslips(self, request):
        """List payslips for the logged-in employee."""
        from apps.hr.payslip_portal import published_payslips_for_employee

        employee = self._employee(request)
        month = (request.query_params.get('month') or '').strip()
        qs = published_payslips_for_employee(employee, month=month or None)
        return Response({
            'results': PayslipSerializer(qs, many=True, context={'request': request}).data,
        })

    @action(detail=False, methods=['get'], url_path=r'payslips/(?P<payslip_id>[^/.]+)')
    def payslip_detail(self, request, payslip_id=None):
        """Payslip breakdown for the logged-in employee."""
        from apps.hr.payroll_models import Payslip

        from apps.hr.payroll_models import PayrollRun

        employee = self._employee(request)
        payslip = get_object_or_404(
            Payslip.objects.select_related('payroll_run', 'employee'),
            pk=payslip_id,
            employee=employee,
            payroll_run__status=PayrollRun.STATUS_PUBLISHED,
        )
        return Response(PayslipSerializer(payslip, context={'request': request}).data)

    @action(detail=False, methods=['get'], url_path=r'payslips/(?P<payslip_id>[^/.]+)/download')
    def payslip_download(self, request, payslip_id=None):
        """Download payslip PDF (employee-scoped)."""
        from apps.hr.payroll_models import Payslip

        from apps.hr.payroll_models import PayrollRun

        employee = self._employee(request)
        payslip = get_object_or_404(
            Payslip,
            pk=payslip_id,
            employee=employee,
            payroll_run__status=PayrollRun.STATUS_PUBLISHED,
        )
        if not payslip.pdf_file:
            return Response({'error': 'Payslip PDF is not available.'}, status=404)
        return FileResponse(
            payslip.pdf_file.open('rb'),
            as_attachment=True,
            filename=os.path.basename(payslip.pdf_file.name),
            content_type='application/pdf',
        )

    def _employee_document_requirement(self, employee, requirement_id):
        from apps.hr.models import EmployeeDocumentRequirement

        return get_object_or_404(
            EmployeeDocumentRequirement.objects.select_related('document_type'),
            pk=requirement_id,
            employee=employee,
        )

    def _serve_employee_document_file(self, requirement, *, attachment: bool = False):
        from django.core.files.storage import default_storage

        if not requirement.uploaded_file or not default_storage.exists(requirement.uploaded_file.name):
            raise NotFound('Document file is unavailable.')
        file_handle = default_storage.open(requirement.uploaded_file.name, 'rb')
        filename = os.path.basename(requirement.uploaded_file.name)
        ext = filename.rsplit('.', 1)[-1].lower() if '.' in filename else ''
        content_types = {
            'pdf': 'application/pdf',
            'jpg': 'image/jpeg',
            'jpeg': 'image/jpeg',
            'png': 'image/png',
        }
        content_type = content_types.get(ext, 'application/octet-stream')
        return FileResponse(
            file_handle,
            as_attachment=attachment,
            filename=filename,
            content_type=content_type,
        )

    @action(detail=False, methods=['get'], url_path='documents')
    def documents(self, request):
        """List document requirements for the logged-in employee."""
        employee = self._employee(request)
        payload = build_candidate_onboarding_payload(employee, employee_portal=True)
        return Response({
            'employee': {
                'id': str(employee.id),
                'name': employee.name,
                'employee_id': employee.employee_id,
            },
            **payload,
        })

    @action(detail=False, methods=['post'], url_path=r'documents/(?P<requirement_id>[^/.]+)/upload')
    def upload_document(self, request, requirement_id=None):
        """Upload or replace a document for the logged-in employee."""
        employee = self._employee(request, require_active=True)
        requirement = self._employee_document_requirement(employee, requirement_id)
        uploaded = request.FILES.get('file')
        if not uploaded:
            return Response({'error': 'No file provided.'}, status=400)
        try:
            save_requirement_upload(employee, requirement, uploaded)
        except ValueError as exc:
            return Response({'error': str(exc)}, status=400)
        payload = build_candidate_onboarding_payload(employee, employee_portal=True)
        return Response({
            'success': True,
            'message': 'Document uploaded successfully.',
            **payload,
        }, status=201)

    @action(detail=False, methods=['get'], url_path=r'documents/(?P<requirement_id>[^/.]+)/preview')
    def preview_document(self, request, requirement_id=None):
        employee = self._employee(request)
        requirement = self._employee_document_requirement(employee, requirement_id)
        return self._serve_employee_document_file(requirement, attachment=False)

    @action(detail=False, methods=['get'], url_path=r'documents/(?P<requirement_id>[^/.]+)/download')
    def download_document(self, request, requirement_id=None):
        employee = self._employee(request)
        requirement = self._employee_document_requirement(employee, requirement_id)
        return self._serve_employee_document_file(requirement, attachment=True)

    @action(detail=False, methods=['get'], url_path=r'documents/(?P<requirement_id>[^/.]+)/versions/(?P<version_id>[^/.]+)/preview')
    def preview_document_version(self, request, requirement_id=None, version_id=None):
        from apps.hr.models import EmployeeDocumentUploadVersion

        employee = self._employee(request)
        requirement = self._employee_document_requirement(employee, requirement_id)
        version = get_object_or_404(
            EmployeeDocumentUploadVersion,
            pk=version_id,
            requirement=requirement,
        )
        if not version.file:
            raise NotFound('Archived file is unavailable.')
        return _file_response_for_field(
            version.file,
            download=False,
            filename=version.original_filename or os.path.basename(version.file.name),
        )

    @action(detail=False, methods=['get'], url_path=r'documents/(?P<requirement_id>[^/.]+)/versions/(?P<version_id>[^/.]+)/download')
    def download_document_version(self, request, requirement_id=None, version_id=None):
        from apps.hr.models import EmployeeDocumentUploadVersion

        employee = self._employee(request)
        requirement = self._employee_document_requirement(employee, requirement_id)
        version = get_object_or_404(
            EmployeeDocumentUploadVersion,
            pk=version_id,
            requirement=requirement,
        )
        if not version.file:
            raise NotFound('Archived file is unavailable.')
        return _file_response_for_field(
            version.file,
            download=True,
            filename=version.original_filename or os.path.basename(version.file.name),
        )

    @action(detail=False, methods=['post'], url_path=r'documents/(?P<requirement_id>[^/.]+)/request-update')
    def request_document_update(self, request, requirement_id=None):
        """Employee requests HR to reopen a verified document for replacement."""
        employee = self._employee(request)
        requirement = self._employee_document_requirement(employee, requirement_id)
        reason = (request.data.get('reason') or '').strip()
        try:
            record_employee_document_update_request(
                employee,
                requirement,
                user=request.user,
                reason=reason,
            )
        except ValueError as exc:
            return Response({'error': str(exc)}, status=400)
        return Response({
            'success': True,
            'message': 'Your update request has been recorded. HR will review and contact you if needed.',
        })

    def _employee_holidays_queryset(self, employee):
        from apps.hr.holiday_services import employee_holiday_q

        return (
            OrganizationHoliday.objects.filter(active=True)
            .filter(employee_holiday_q(employee))
            .order_by('date', 'name')
        )

    @action(detail=False, methods=['get'], url_path='holidays')
    def holidays(self, request):
        """Employee-scoped holiday calendar (national, festival, organization)."""
        employee = self._employee(request)
        month = (request.query_params.get('month') or '').strip()
        upcoming = (request.query_params.get('upcoming') or '').strip().lower() in {'1', 'true', 'yes'}
        qs = self._employee_holidays_queryset(employee)
        today = timezone.localdate()
        if month and len(month) >= 7:
            year_s, month_s = month[:7].split('-')
            year, mon = int(year_s), int(month_s)
            start = date(year, mon, 1)
            _, last = monthrange(year, mon)
            end = date(year, mon, last)
            qs = qs.filter(date__gte=start, date__lte=end)
        elif upcoming:
            qs = qs.filter(date__gte=today)
        return Response({
            'results': OrganizationHolidaySerializer(qs[:200], many=True).data,
        })

    @action(detail=False, methods=['get'], url_path='notifications')
    def notifications(self, request):
        employee = self._employee(request)
        from apps.hr.employee_portal_notifications import sync_portal_notifications

        sync_portal_notifications(employee)
        unread_only = (request.query_params.get('unread') or '').strip().lower() in {'1', 'true', 'yes'}
        qs = EmployeePortalNotification.objects.filter(employee=employee).order_by('-created_at')
        if unread_only:
            qs = qs.filter(read_at__isnull=True)
        unread_count = EmployeePortalNotification.objects.filter(employee=employee, read_at__isnull=True).count()
        return Response({
            'unread_count': unread_count,
            'results': EmployeePortalNotificationSerializer(qs[:100], many=True).data,
        })

    @action(detail=False, methods=['get'], url_path='notifications/unread-count')
    def notifications_unread_count(self, request):
        employee = self._employee(request)
        count = EmployeePortalNotification.objects.filter(employee=employee, read_at__isnull=True).count()
        return Response({'unread_count': count})

    @action(detail=False, methods=['post'], url_path='notifications/mark-all-read')
    def mark_all_notifications_read(self, request):
        employee = self._employee(request)
        now = timezone.now()
        updated = EmployeePortalNotification.objects.filter(
            employee=employee,
            read_at__isnull=True,
        ).update(read_at=now, updated_at=now)
        return Response({'success': True, 'marked_read': updated})

    @action(detail=False, methods=['post'], url_path=r'notifications/(?P<notification_id>[0-9a-f-]{36})/read')
    def mark_notification_read(self, request, notification_id=None):
        employee = self._employee(request)
        notification = get_object_or_404(
            EmployeePortalNotification,
            pk=notification_id,
            employee=employee,
        )
        if not notification.read_at:
            notification.read_at = timezone.now()
            notification.save(update_fields=['read_at', 'updated_at'])
        return Response(EmployeePortalNotificationSerializer(notification).data)


class OrganizationHolidayViewSet(HRBaseViewSet):
    queryset = OrganizationHoliday.objects.select_related('hospital').all()
    serializer_class = OrganizationHolidaySerializer

    def get_queryset(self):
        qs = OrganizationHoliday.objects.select_related('hospital').all()
        user = self.request.user
        hospital_id = getattr(user, 'hospital_id', None)
        if hospital_id:
            qs = qs.filter(
                models.Q(scope=OrganizationHoliday.SCOPE_NATIONAL)
                | models.Q(scope=OrganizationHoliday.SCOPE_FESTIVAL, hospital__isnull=True)
                | models.Q(hospital_id=hospital_id)
            )
        scope = (self.request.query_params.get('scope') or self.request.query_params.get('holiday_type') or '').strip()
        month = (self.request.query_params.get('month') or '').strip()
        active = self.request.query_params.get('active')
        if scope:
            qs = qs.filter(scope=scope)
        if month and len(month) >= 7:
            year_s, month_s = month[:7].split('-')
            year, mon = int(year_s), int(month_s)
            start = date(year, mon, 1)
            _, last = monthrange(year, mon)
            end = date(year, mon, last)
            qs = qs.filter(date__gte=start, date__lte=end)
        if active in {'true', '1', 'yes'}:
            qs = qs.filter(active=True)
        elif active in {'false', '0', 'no'}:
            qs = qs.filter(active=False)
        return qs.order_by('date', 'name')

    def _hospital_scoped_holidays_queryset(self):
        """Hospital visibility only — used by FY suggestions (no month/scope filters)."""
        qs = OrganizationHoliday.objects.select_related('hospital').all()
        hospital_id = getattr(self.request.user, 'hospital_id', None)
        if hospital_id:
            qs = qs.filter(
                models.Q(scope=OrganizationHoliday.SCOPE_NATIONAL)
                | models.Q(scope=OrganizationHoliday.SCOPE_FESTIVAL, hospital__isnull=True)
                | models.Q(hospital_id=hospital_id)
            )
        return qs

    def _resolve_hospital_for_holiday(self, serializer):
        scope = serializer.validated_data.get('scope') or getattr(serializer.instance, 'scope', None)
        if scope == OrganizationHoliday.SCOPE_NATIONAL:
            return None
        if scope == OrganizationHoliday.SCOPE_ORGANIZATION:
            hospital = serializer.validated_data.get('hospital')
            if hospital:
                return hospital.id
            return _resolve_hr_hospital_id(self.request)
        if scope == OrganizationHoliday.SCOPE_FESTIVAL:
            hospital = serializer.validated_data.get('hospital')
            return hospital.id if hospital else None
        return _resolve_hr_hospital_id(self.request)

    def perform_create(self, serializer):
        hospital_id = self._resolve_hospital_for_holiday(serializer)
        holiday = serializer.save(hospital_id=hospital_id)
        from apps.hr.holiday_services import sync_holiday_attendance

        transaction.on_commit(lambda: sync_holiday_attendance(holiday))

    def perform_update(self, serializer):
        hospital_id = self._resolve_hospital_for_holiday(serializer)
        holiday = serializer.save(hospital_id=hospital_id)
        from apps.hr.holiday_services import sync_holiday_attendance

        transaction.on_commit(lambda: sync_holiday_attendance(holiday))

    def destroy(self, request, *args, **kwargs):
        instance = self.get_object()
        if instance.date < timezone.localdate():
            return Response(
                {'detail': 'Only future holidays can be deleted. Deactivate past holidays instead.'},
                status=400,
            )
        from apps.hr.attendance_engine import recalculate_daily_attendance
        from apps.hr.holiday_services import employees_for_holiday

        holiday_date = instance.date
        affected_ids = list(employees_for_holiday(instance).values_list('id', flat=True))
        response = super().destroy(request, *args, **kwargs)

        def _recalc_deleted_holiday():
            for employee in Employee.objects.filter(id__in=affected_ids).iterator(chunk_size=200):
                recalculate_daily_attendance(employee, holiday_date)

        transaction.on_commit(_recalc_deleted_holiday)
        return response

    @action(detail=True, methods=['post'], url_path='toggle-active')
    def toggle_active(self, request, pk=None):
        holiday = self.get_object()
        holiday.active = not holiday.active
        holiday.save(update_fields=['active', 'updated_at'])
        from apps.hr.holiday_services import sync_holiday_attendance

        transaction.on_commit(lambda: sync_holiday_attendance(holiday))
        return Response(OrganizationHolidaySerializer(holiday).data)

    @action(detail=False, methods=['get'], url_path='suggestions')
    def suggestions(self, request):
        """India FY calendar suggestions from Nager.Date merged with saved holidays."""
        from apps.hr.holiday_suggestions import (
            HolidaySuggestionsError,
            build_holiday_suggestions,
        )

        fy = (request.query_params.get('fy') or '').strip() or None
        try:
            payload = build_holiday_suggestions(
                fy=fy,
                existing_holidays_qs=self._hospital_scoped_holidays_queryset(),
            )
        except HolidaySuggestionsError as exc:
            return Response({'detail': str(exc)}, status=400)
        return Response(payload)


class PayrollRunViewSet(HRBaseViewSet):
    """HR payroll run management, approval workflow, and payslip generation."""

    http_method_names = ['get', 'post', 'head', 'options']

    def get_queryset(self):
        from apps.hr.payroll_models import PayrollRun

        self.queryset = PayrollRun.objects.all()
        qs = PayrollRun.objects.select_related('employee', 'salary_structure').prefetch_related('payslip')
        user = self.request.user
        if getattr(user, 'hospital_id', None):
            qs = qs.filter(employee__hospital_id=user.hospital_id)
        month = (self.request.query_params.get('month') or '').strip()
        status = (self.request.query_params.get('status') or '').strip().upper()
        if month:
            qs = qs.filter(month=month)
        if status:
            qs = qs.filter(status=status)
        return qs.order_by('-month', '-created_at')

    def get_serializer_class(self):
        return PayrollRunSerializer

    def update(self, request, *args, **kwargs):
        payroll_run = self.get_object()
        if not payroll_run.is_editable:
            return Response(
                {'error': f'Payroll in {payroll_run.status} status cannot be modified.'},
                status=403,
            )
        return Response({'error': 'Direct payroll updates are disabled. Regenerate payroll instead.'}, status=405)

    def partial_update(self, request, *args, **kwargs):
        return self.update(request, *args, **kwargs)

    def destroy(self, request, *args, **kwargs):
        payroll_run = self.get_object()
        if payroll_run.is_immutable or payroll_run.status == payroll_run.STATUS_PUBLISHED:
            return Response({'error': 'Locked or published payroll cannot be deleted.'}, status=403)
        return super().destroy(request, *args, **kwargs)

    @action(detail=True, methods=['post'], url_path='submit-for-review')
    def submit_for_review(self, request, pk=None):
        from apps.hr.payroll_approval import PayrollApprovalService, PayrollStateError

        payroll_run = self.get_object()
        try:
            payroll_run = PayrollApprovalService().submit_for_review(payroll_run, performed_by=request.user)
        except PayrollStateError as exc:
            return Response({'error': str(exc)}, status=400)
        return Response(PayrollRunSerializer(payroll_run, context={'request': request}).data)

    @action(detail=True, methods=['post'], url_path='approve')
    def approve(self, request, pk=None):
        from apps.hr.payroll_approval import (
            PayrollApprovalService,
            PayrollStateError,
            PayrollValidationError,
        )

        payroll_run = self.get_object()
        try:
            payroll_run = PayrollApprovalService().approve_payroll(payroll_run, hr_user=request.user)
        except PayrollValidationError as exc:
            return Response({
                'error': str(exc),
                'validation_errors': exc.errors,
                'validation_warnings': exc.warnings,
            }, status=400)
        except PayrollStateError as exc:
            return Response({'error': str(exc)}, status=400)
        return Response(PayrollRunSerializer(payroll_run, context={'request': request}).data)

    @action(detail=True, methods=['post'], url_path='lock')
    def lock(self, request, pk=None):
        from apps.hr.payroll_approval import PayrollApprovalService, PayrollStateError

        payroll_run = self.get_object()
        try:
            payroll_run = PayrollApprovalService().lock_payroll(payroll_run, performed_by=request.user)
        except PayrollStateError as exc:
            return Response({'error': str(exc)}, status=400)
        return Response(PayrollRunSerializer(payroll_run, context={'request': request}).data)

    @action(detail=True, methods=['post'], url_path='publish')
    def publish(self, request, pk=None):
        from apps.hr.payroll_approval import PayrollApprovalError, PayrollApprovalService, PayrollStateError

        payroll_run = self.get_object()
        try:
            payroll_run = PayrollApprovalService().publish_payroll(payroll_run, performed_by=request.user)
        except PayrollStateError as exc:
            return Response({'error': str(exc)}, status=400)
        except PayrollApprovalError as exc:
            return Response({'error': str(exc)}, status=400)
        return Response(PayrollRunSerializer(payroll_run, context={'request': request}).data)

    @action(detail=True, methods=['get'], url_path='audit-trail')
    def audit_trail(self, request, pk=None):
        payroll_run = self.get_object()
        logs = payroll_run.audit_logs.select_related('performed_by').order_by('-created_at')
        return Response({
            'results': PayrollAuditLogSerializer(logs, many=True, context={'request': request}).data,
        })

    @action(detail=True, methods=['post'], url_path='validate')
    def validate_payroll(self, request, pk=None):
        from apps.hr.payroll_approval import PayrollApprovalService

        payroll_run = self.get_object()
        result = PayrollApprovalService().validate_for_approval(payroll_run)
        return Response({
            'ok': result.ok,
            'errors': result.errors,
            'warnings': result.warnings,
            'incomplete': result.incomplete,
        })

    @action(detail=True, methods=['post'], url_path='generate-payslip')
    def generate_payslip(self, request, pk=None):
        from apps.hr.payslip_generator import (
            DuplicatePayslipError,
            PayslipGenerator,
            PayslipGeneratorError,
            PayrollNotReadyError,
        )

        payroll_run = self.get_object()
        try:
            payslip = PayslipGenerator().generate_payslip(payroll_run.id, generated_by=request.user)
        except DuplicatePayslipError as exc:
            return Response({'error': str(exc)}, status=409)
        except PayrollNotReadyError as exc:
            return Response({'error': str(exc)}, status=400)
        except PayslipGeneratorError as exc:
            return Response({'error': str(exc)}, status=400)
        return Response(PayslipSerializer(payslip, context={'request': request}).data, status=201)

    @action(detail=True, methods=['post'], url_path='regenerate-payslip')
    def regenerate_payslip(self, request, pk=None):
        from apps.hr.payslip_generator import (
            PayslipGenerator,
            PayslipGeneratorError,
            PayrollNotReadyError,
        )

        payroll_run = self.get_object()
        try:
            payslip = PayslipGenerator().regenerate_payslip_pdf(
                payroll_run.id,
                generated_by=request.user,
            )
        except PayrollNotReadyError as exc:
            return Response({'error': str(exc)}, status=400)
        except PayslipGeneratorError as exc:
            return Response({'error': str(exc)}, status=400)
        return Response(PayslipSerializer(payslip, context={'request': request}).data)

    @action(detail=False, methods=['post'], url_path='generate-payslips')
    def generate_payslips(self, request):
        from apps.hr.payslip_generator import PayslipGenerator, PayslipGeneratorError

        month = (request.data.get('month') or '').strip()
        if not month:
            return Response({'error': 'month is required (YYYY-MM).'}, status=400)
        try:
            result = PayslipGenerator().generate_for_month(month, generated_by=request.user)
        except PayslipGeneratorError as exc:
            return Response({'error': str(exc)}, status=400)
        return Response({
            'month': result.month,
            'created': PayslipSerializer(result.created, many=True, context={'request': request}).data,
            'skipped': result.skipped,
            'errors': result.errors,
        }, status=201 if result.created else 200)


class DailyAttendanceViewSet(HRBaseViewSet):
    queryset = DailyAttendance.objects.select_related('employee', 'shift').all()
    serializer_class = DailyAttendanceSerializer

    def _active_employees_for_request(self, request):
        active_employees = Employee.objects.filter(status='active')
        user = request.user
        if getattr(user, 'hospital_id', None):
            active_employees = active_employees.filter(hospital_id=user.hospital_id)
        return active_employees

    def _reconcile_day(self, request, day, *, force=False):
        active_employees = self._active_employees_for_request(request)
        if day <= timezone.localdate():
            AttendanceCalculationService.rebuild_day(day, active_employees, force=force)

        employee_ids = list(active_employees.values_list('id', flat=True))
        punch_qs = AttendancePunch.objects.filter(employee_id__in=employee_ids, is_void=False).filter(
            models.Q(attendance_date=day)
            | models.Q(attendance_date__isnull=True, timestamp__date=day)
        ).order_by('employee_id', 'timestamp', 'created_at')
        attendance_qs = DailyAttendance.objects.filter(employee_id__in=employee_ids, date=day).select_related('employee')

        punch_map = {}
        for punch in punch_qs:
            row = punch_map.setdefault(str(punch.employee_id), {'IN': 0, 'OUT': 0, 'total': 0})
            row[punch.punch_type] = row.get(punch.punch_type, 0) + 1
            row['total'] += 1

        summary_map = {
            str(row.employee_id): {
                'employee_id_display': row.employee.employee_id,
                'status': row.attendance_status,
                'is_on_leave': row.is_on_leave,
                'requires_hr_review': row.requires_hr_review,
            }
            for row in attendance_qs
        }

        mismatches = []
        for employee in active_employees:
            key = str(employee.id)
            punches = punch_map.get(key, {'IN': 0, 'OUT': 0, 'total': 0})
            summary = summary_map.get(key)
            if punches['total'] and not summary:
                mismatches.append({'employee': employee.employee_id, 'reason': 'punch_exists_attendance_missing', 'punches': punches})
                continue
            if summary and not punches['total'] and summary['status'] not in {'absent', 'leave', 'holiday', 'weekend'}:
                mismatches.append({'employee': employee.employee_id, 'reason': 'attendance_without_punches', 'summary': summary})
            if summary and punches['IN'] and punches['OUT'] and summary['status'] == 'absent':
                mismatches.append({'employee': employee.employee_id, 'reason': 'in_out_but_absent', 'punches': punches, 'summary': summary})
            open_ok = {'incomplete', 'in_progress', 'missing_checkout', 'leave'}
            if summary and punches['IN'] and not punches['OUT'] and summary['status'] not in open_ok:
                mismatches.append({'employee': employee.employee_id, 'reason': 'in_without_out_not_incomplete', 'punches': punches, 'summary': summary})

        logger.info(
            '[AttendanceReconcile] date=%s punch_map=%s summary_map=%s mismatches=%s',
            day,
            punch_map,
            summary_map,
            mismatches,
        )
        return {
            'date': day.isoformat(),
            'employees_checked': len(employee_ids),
            'punches_count_per_employee': punch_map,
            'attendance_summary_per_employee': summary_map,
            'mismatches': mismatches,
        }

    def get_queryset(self):
        qs = super().get_queryset()
        employee_id = self.request.query_params.get('employee')
        status = self.request.query_params.get('status')
        shift_id = self.request.query_params.get('shift')
        department = self.request.query_params.get('department')
        late_only = self.request.query_params.get('late_only')
        overtime = self.request.query_params.get('overtime')
        incomplete_checkout = self.request.query_params.get('incomplete_checkout')
        review = self.request.query_params.get('requires_hr_review')
        date_from = self.request.query_params.get('date_from')
        date_to = self.request.query_params.get('date_to')
        search = (self.request.query_params.get('search') or '').strip()
        job_opening = (self.request.query_params.get('job_opening') or '').strip()
        if employee_id:
            qs = qs.filter(employee_id=employee_id)
        if job_opening:
            qs = qs.filter(employee__candidate__job_opening_id=job_opening)
        if status:
            if status == 'late':
                qs = qs.filter(models.Q(attendance_status='late') | models.Q(late_minutes__gt=0))
            else:
                qs = qs.filter(attendance_status=status)
        if shift_id:
            qs = qs.filter(shift_id=shift_id)
        if department:
            qs = qs.filter(employee__department__icontains=department)
        if late_only in {'true', '1', 'yes'}:
            qs = qs.filter(late_minutes__gt=0)
        if overtime in {'true', '1', 'yes'}:
            qs = qs.filter(models.Q(overtime_hours__gt=0) | models.Q(overtime_minutes__gt=0))
        if incomplete_checkout in {'true', '1', 'yes'}:
            qs = qs.filter(incomplete_checkout=True)
        if review in {'true', '1', 'yes'}:
            qs = qs.filter(requires_hr_review=True)
        elif review in {'false', '0', 'no'}:
            qs = qs.filter(requires_hr_review=False)
        if date_from:
            qs = qs.filter(date__gte=date_from)
        if date_to:
            qs = qs.filter(date__lte=date_to)
        if search:
            qs = qs.filter(
                models.Q(employee__name__icontains=search)
                | models.Q(employee__employee_id__icontains=search)
                | models.Q(employee__email__icontains=search)
            )
        return qs

    def list(self, request, *args, **kwargs):
        date_from = request.query_params.get('date_from')
        date_to = request.query_params.get('date_to')
        force = request.query_params.get('force', 'false').lower() in {'true', '1', 'yes'}
        if date_from and date_to and str(date_from)[:10] == str(date_to)[:10]:
            try:
                day = date.fromisoformat(str(date_from)[:10])
                if day <= timezone.localdate():
                    hospital_id = getattr(request.user, 'hospital_id', None)
                    ensure_day_summaries(day, hospital_id, force=force)
            except ValueError:
                pass
        return super().list(request, *args, **kwargs)

    @action(detail=False, methods=['get'])
    def policy(self, request):
        return Response(policy_documentation())

    @action(detail=False, methods=['get'])
    def summary(self, request):
        day_raw = request.query_params.get('date') or timezone.localdate().isoformat()
        try:
            day = date.fromisoformat(str(day_raw)[:10])
        except ValueError:
            return Response({'error': 'date must be YYYY-MM-DD.'}, status=400)

        hospital_id = getattr(request.user, 'hospital_id', None)
        force = request.query_params.get('force', 'true').lower() in {'true', '1', 'yes'}
        job_opening = (request.query_params.get('job_opening') or '').strip()
        payload = build_dashboard_summary(day, hospital_id=hospital_id, force_rebuild=force)
        if job_opening:
            from apps.hr.journey_center_counts import _employee_ids_for_job

            employee_ids = _employee_ids_for_job(hospital_id, job_opening)
            if employee_ids:
                from apps.hr.models import DailyAttendance

                day_rows = DailyAttendance.objects.filter(date=day, employee_id__in=employee_ids)
                scheduled_for_job = Employee.objects.filter(
                    id__in=employee_ids,
                    status='active',
                    shift__isnull=False,
                ).count()
                payload['scheduled_employees'] = scheduled_for_job
                payload['total_records'] = day_rows.count()
            else:
                payload['scheduled_employees'] = 0
                payload['total_records'] = 0
        reconciliation = self._reconcile_day(request, day, force=force) if request.query_params.get('include_mismatches') else None
        if reconciliation:
            payload['mismatch_count'] = len(reconciliation['mismatches'])
            payload['mismatches'] = reconciliation['mismatches']
        logger.info('[AttendanceDashboard] date=%s aggregation=%s', day, payload)
        return Response(payload)

    @action(detail=False, methods=['get'], url_path='department-stats')
    def department_stats(self, request):
        day_raw = request.query_params.get('date') or timezone.localdate().isoformat()
        try:
            day = date.fromisoformat(str(day_raw)[:10])
        except ValueError:
            return Response({'error': 'date must be YYYY-MM-DD.'}, status=400)
        hospital_id = getattr(request.user, 'hospital_id', None)
        force = request.query_params.get('force', 'false').lower() in {'true', '1', 'yes'}
        try:
            departments = build_department_stats(day, hospital_id=hospital_id, force_rebuild=force)
        except Exception as exc:
            logger.exception('[AttendanceDashboard] department-stats failed date=%s', day)
            return Response(
                {'error': 'Failed to load department attendance stats.', 'detail': str(exc)},
                status=500,
            )
        return Response({
            'date': day.isoformat(),
            'departments': departments,
        })

    @method_decorator(never_cache)
    @action(detail=False, methods=['get'])
    def calendar(self, request):
        month_raw = request.query_params.get('month')
        if not month_raw:
            return Response({'error': 'month query param required (YYYY-MM).'}, status=400)
        try:
            year_s, month_s = str(month_raw)[:7].split('-')
            year, month = int(year_s), int(month_s)
        except ValueError:
            return Response({'error': 'month must be YYYY-MM.'}, status=400)
        hospital_id = getattr(request.user, 'hospital_id', None)
        force = request.query_params.get('force', 'false').lower() in {'true', '1', 'yes'}
        payload = build_calendar_month(
            year,
            month,
            hospital_id=hospital_id,
            department=request.query_params.get('department', ''),
            shift_id=request.query_params.get('shift', ''),
            status=request.query_params.get('status', ''),
            force_rebuild=force,
        )
        return Response(payload)

    @method_decorator(never_cache)
    @action(detail=False, methods=['get'], url_path='employee-analytics')
    def employee_analytics(self, request):
        employee_id = request.query_params.get('employee')
        if not employee_id:
            return Response({'error': 'employee query param is required.'}, status=400)
        payload = build_employee_analytics(
            employee_id,
            month=request.query_params.get('month'),
            date_from=request.query_params.get('date_from'),
            date_to=request.query_params.get('date_to'),
        )
        if payload is None:
            return Response({'error': 'Employee not found.'}, status=404)
        return Response(payload)

    @action(detail=False, methods=['post'], url_path='reconcile-day')
    def reconcile_day(self, request):
        day_raw = request.data.get('date') or timezone.localdate().isoformat()
        force = bool(request.data.get('force', True))
        try:
            day = date.fromisoformat(str(day_raw)[:10])
        except ValueError:
            return Response({'error': 'date must be YYYY-MM-DD.'}, status=400)
        reconciliation = self._reconcile_day(request, day, force=force)
        return Response({'success': True, **reconciliation})

    @action(detail=False, methods=['post'])
    def recalculate(self, request):
        employee_id = request.data.get('employee')
        day_raw = request.data.get('date')
        force = bool(request.data.get('force', False))
        if not employee_id or not day_raw:
            return Response({'error': 'employee and date are required.'}, status=400)
        try:
            day = date.fromisoformat(str(day_raw)[:10])
        except ValueError:
            return Response({'error': 'date must be YYYY-MM-DD.'}, status=400)
        try:
            employee = Employee.objects.get(pk=employee_id)
        except Employee.DoesNotExist:
            return Response({'error': 'Employee not found.'}, status=404)

        attendance, calculated = recalculate_daily_attendance(employee, day, force=force)
        invalidate_day_rebuild_cache()
        return Response({
            'success': True,
            'attendance': self.get_serializer(attendance).data,
            'calculated': attendance.calculation_details or calculated,
        })

    @action(detail=True, methods=['post'])
    def recalculate_record(self, request, pk=None):
        attendance = self.get_object()
        force = bool(request.data.get('force', False))
        admin_override = bool(request.data.get('admin_override', force))
        attendance, calculated = recalculate_daily_attendance(attendance.employee, attendance.date, force=force, admin_override=admin_override)
        invalidate_day_rebuild_cache()
        return Response({
            'success': True,
            'attendance': self.get_serializer(attendance).data,
            'calculated': attendance.calculation_details or calculated,
        })

    @action(detail=True, methods=['post'])
    def correct(self, request, pk=None):
        attendance = self.get_object()
        reason = (request.data.get('reason') or '').strip()
        if not reason:
            return Response({'error': 'Correction reason is required.'}, status=400)

        original = {
            'first_check_in': attendance.first_check_in.isoformat() if attendance.first_check_in else None,
            'last_check_out': attendance.last_check_out.isoformat() if attendance.last_check_out else None,
            'attendance_status': attendance.attendance_status,
            'total_work_hours': str(attendance.total_work_hours) if attendance.total_work_hours is not None else None,
            'overtime_hours': str(attendance.overtime_hours) if attendance.overtime_hours is not None else None,
            'late_minutes': attendance.late_minutes,
        }
        if not attendance.original_calculated_values:
            attendance.original_calculated_values = original

        first_check_in = request.data.get('first_check_in')
        last_check_out = request.data.get('last_check_out')
        attendance_status = request.data.get('attendance_status')
        remarks = request.data.get('remarks')

        if first_check_in:
            dt = parse_datetime(str(first_check_in))
            if not dt:
                return Response({'error': 'Invalid first_check_in datetime.'}, status=400)
            from apps.hr.attendance_policy import resolve_punch_timestamp

            attendance.first_check_in = resolve_punch_timestamp(timestamp=dt)
        if last_check_out:
            dt = parse_datetime(str(last_check_out))
            if not dt:
                return Response({'error': 'Invalid last_check_out datetime.'}, status=400)
            from apps.hr.attendance_policy import resolve_punch_timestamp

            attendance.last_check_out = resolve_punch_timestamp(timestamp=dt)
        if attendance_status:
            valid_statuses = {key for key, _ in DailyAttendance.ATTENDANCE_STATUS_CHOICES}
            if attendance_status not in valid_statuses:
                return Response({'error': 'Invalid attendance_status.'}, status=400)
            attendance.attendance_status = attendance_status
        if remarks is not None:
            attendance.remarks = remarks

        attendance.manually_corrected = True
        attendance.calculation_locked = True
        attendance.requires_hr_review = False
        attendance.save(update_fields=[
            'first_check_in',
            'last_check_out',
            'attendance_status',
            'remarks',
            'manually_corrected',
            'calculation_locked',
            'requires_hr_review',
            'original_calculated_values',
            'updated_at',
        ])

        AttendanceRegularization.objects.create(
            employee=attendance.employee,
            attendance=attendance,
            requested_check_in=attendance.first_check_in,
            requested_check_out=attendance.last_check_out,
            reason=reason,
            status='approved',
            reviewed_by=request.user if request.user.is_authenticated else None,
            reviewed_at=timezone.now(),
            reviewer_remarks='HR manual attendance correction.',
        )
        invalidate_day_rebuild_cache()
        logger.info(
            '[AttendanceCorrection] attendance=%s employee=%s by=%s',
            attendance.id,
            attendance.employee_id,
            getattr(request.user, 'id', None),
        )
        return Response({'success': True, 'attendance': self.get_serializer(attendance).data})

    @action(detail=False, methods=['post'], url_path='bulk-correct')
    def bulk_correct(self, request):
        """Apply the same manual correction fields to multiple summary rows."""
        raw_ids = request.data.get('attendance_ids') or []
        if not isinstance(raw_ids, (list, tuple)) or not raw_ids:
            return Response({'error': 'attendance_ids is required.'}, status=400)
        reason = (request.data.get('reason') or '').strip()
        if not reason:
            return Response({'error': 'Correction reason is required.'}, status=400)

        attendance_status = request.data.get('attendance_status')
        remarks = request.data.get('remarks')
        first_check_in = request.data.get('first_check_in')
        last_check_out = request.data.get('last_check_out')
        valid_statuses = {key for key, _ in DailyAttendance.ATTENDANCE_STATUS_CHOICES}

        if attendance_status and attendance_status not in valid_statuses:
            return Response({'error': 'Invalid attendance_status.'}, status=400)

        qs = self.get_queryset().filter(pk__in=raw_ids)
        found_ids = set(str(pk) for pk in qs.values_list('pk', flat=True))
        missing = [str(i) for i in raw_ids if str(i) not in found_ids]
        if missing:
            return Response({'error': 'Some attendance records were not found or not accessible.', 'missing': missing}, status=400)

        updated = []
        errors = []
        for attendance in qs.select_related('employee'):
            try:
                if not attendance.original_calculated_values:
                    attendance.original_calculated_values = {
                        'first_check_in': attendance.first_check_in.isoformat() if attendance.first_check_in else None,
                        'last_check_out': attendance.last_check_out.isoformat() if attendance.last_check_out else None,
                        'attendance_status': attendance.attendance_status,
                        'total_work_hours': str(attendance.total_work_hours) if attendance.total_work_hours is not None else None,
                        'overtime_hours': str(attendance.overtime_hours) if attendance.overtime_hours is not None else None,
                        'late_minutes': attendance.late_minutes,
                    }
                if first_check_in:
                    dt = parse_datetime(str(first_check_in))
                    if not dt:
                        raise ValueError('Invalid first_check_in datetime.')
                    from apps.hr.attendance_policy import resolve_punch_timestamp

                    attendance.first_check_in = resolve_punch_timestamp(timestamp=dt)
                if last_check_out:
                    dt = parse_datetime(str(last_check_out))
                    if not dt:
                        raise ValueError('Invalid last_check_out datetime.')
                    from apps.hr.attendance_policy import resolve_punch_timestamp

                    attendance.last_check_out = resolve_punch_timestamp(timestamp=dt)
                if attendance_status:
                    attendance.attendance_status = attendance_status
                if remarks is not None:
                    attendance.remarks = remarks
                attendance.manually_corrected = True
                attendance.calculation_locked = True
                attendance.requires_hr_review = False
                attendance.save(update_fields=[
                    'first_check_in', 'last_check_out', 'attendance_status', 'remarks',
                    'manually_corrected', 'calculation_locked', 'requires_hr_review',
                    'original_calculated_values', 'updated_at',
                ])
                AttendanceRegularization.objects.create(
                    employee=attendance.employee,
                    attendance=attendance,
                    requested_check_in=attendance.first_check_in,
                    requested_check_out=attendance.last_check_out,
                    reason=reason,
                    status='approved',
                    reviewed_by=request.user if request.user.is_authenticated else None,
                    reviewed_at=timezone.now(),
                    reviewer_remarks='HR bulk attendance correction.',
                )
                updated.append(self.get_serializer(attendance).data)
            except Exception as exc:
                errors.append({'id': str(attendance.id), 'error': str(exc)})

        if updated:
            invalidate_day_rebuild_cache()

        logger.info('[AttendanceBulkCorrect] updated=%s errors=%s by=%s', len(updated), len(errors), getattr(request.user, 'id', None))
        return Response({
            'success': len(errors) == 0,
            'updated_count': len(updated),
            'error_count': len(errors),
            'attendance': updated,
            'errors': errors,
        })

    @action(detail=False, methods=['post'], url_path='bulk-mark')
    def bulk_mark(self, request):
        """Bulk set attendance status (absent, holiday, etc.) on summary rows."""
        mark_status = (request.data.get('attendance_status') or '').strip().lower()
        allowed = {'absent', 'holiday', 'weekend', 'present', 'late', 'half_day', 'leave'}
        if not mark_status:
            return Response({'error': 'attendance_status is required.'}, status=400)
        if mark_status not in allowed:
            return Response({'error': f'attendance_status must be one of: {", ".join(sorted(allowed))}.'}, status=400)
        return self.bulk_correct(request)


class AttendanceRegularizationViewSet(HRBaseViewSet):
    queryset = AttendanceRegularization.objects.select_related('employee', 'attendance', 'reviewed_by').all()
    serializer_class = AttendanceRegularizationSerializer

    def get_queryset(self):
        qs = super().get_queryset()
        employee_id = self.request.query_params.get('employee')
        status = self.request.query_params.get('status')
        date_from = self.request.query_params.get('date_from')
        date_to = self.request.query_params.get('date_to')
        if employee_id:
            qs = qs.filter(employee_id=employee_id)
        if status:
            qs = qs.filter(status=status)
        if date_from:
            qs = qs.filter(created_at__date__gte=date_from)
        if date_to:
            qs = qs.filter(created_at__date__lte=date_to)
        return qs

    @action(detail=True, methods=['post'])
    def approve(self, request, pk=None):
        regularization = self.get_object()
        if regularization.status != 'pending':
            return Response({'error': f'Request already {regularization.status}.'}, status=400)
        attendance = regularization.attendance
        if not attendance:
            day = timezone.localdate(regularization.requested_check_in or regularization.created_at)
            attendance, _ = DailyAttendance.objects.get_or_create(employee=regularization.employee, date=day)
        if attendance.finalized:
            return Response(
                {'error': 'Attendance for this date is finalized. Unfinalize the month before approving regularization.'},
                status=400,
            )
        if not attendance.original_calculated_values:
            attendance.original_calculated_values = {
                'first_check_in': attendance.first_check_in.isoformat() if attendance.first_check_in else None,
                'last_check_out': attendance.last_check_out.isoformat() if attendance.last_check_out else None,
                'attendance_status': attendance.attendance_status,
            }
        from apps.hr.attendance_engine import get_engine_punches, recalculate_daily_attendance
        from apps.hr.models import AttendancePunch

        # 1. Void existing punches for this date
        punches = get_engine_punches(attendance.employee, attendance.date, attendance.shift)
        for punch in punches:
            punch.is_void = True
            punch.save(update_fields=['is_void', 'updated_at'])

        # 2. Create corrected punch records (preserving existing valid punches if not requested to change)
        final_check_in = regularization.requested_check_in or attendance.first_check_in
        final_check_out = regularization.requested_check_out or attendance.last_check_out

        if final_check_in:
            AttendancePunch.objects.create(
                employee=attendance.employee,
                punch_type='IN',
                timestamp=final_check_in,
                attendance_date=attendance.date,
                source='HR_manual',
            )
        if final_check_out:
            AttendancePunch.objects.create(
                employee=attendance.employee,
                punch_type='OUT',
                timestamp=final_check_out,
                attendance_date=attendance.date,
                source='HR_manual',
            )

        # 3. Recalculate attendance using new punch data
        # We use admin_override=True to bypass any existing locks so the engine fully recalculates it
        attendance, _ = recalculate_daily_attendance(attendance.employee, attendance.date, force=True, admin_override=True)

        attendance.manually_corrected = True
        attendance.calculation_locked = True
        attendance.requires_hr_review = False
        attendance.remarks = request.data.get('remarks') or attendance.remarks
        
        logger.info('[Regularization] Saving attendance with first_check_in=%s last_check_out=%s', attendance.first_check_in, attendance.last_check_out)
        
        attendance.save(update_fields=[
            'manually_corrected',
            'calculation_locked',
            'requires_hr_review',
            'remarks',
            'updated_at',
        ])
        regularization.status = 'approved'
        regularization.reviewed_by = request.user if request.user.is_authenticated else None
        regularization.reviewed_at = timezone.now()
        regularization.reviewer_remarks = request.data.get('remarks') or ''
        regularization.attendance = attendance
        regularization.save(update_fields=['status', 'reviewed_by', 'reviewed_at', 'reviewer_remarks', 'attendance', 'updated_at'])
        from apps.hr.regularization_notifications import schedule_regularization_reviewed_notification

        schedule_regularization_reviewed_notification(regularization.id, action='approved')
        invalidate_day_rebuild_cache()
        logger.info('[Regularization] approved request=%s by=%s', regularization.id, getattr(request.user, 'id', None))
        return Response({'success': True, 'regularization': self.get_serializer(regularization).data})

    @action(detail=True, methods=['post'])
    def reject(self, request, pk=None):
        regularization = self.get_object()
        if regularization.status != 'pending':
            return Response({'error': f'Request already {regularization.status}.'}, status=400)
        regularization.status = 'rejected'
        regularization.reviewed_by = request.user if request.user.is_authenticated else None
        regularization.reviewed_at = timezone.now()
        regularization.reviewer_remarks = request.data.get('remarks') or ''
        regularization.save(update_fields=['status', 'reviewed_by', 'reviewed_at', 'reviewer_remarks', 'updated_at'])
        from apps.hr.regularization_notifications import schedule_regularization_reviewed_notification

        schedule_regularization_reviewed_notification(regularization.id, action='rejected')
        logger.info('[Regularization] rejected request=%s by=%s', regularization.id, getattr(request.user, 'id', None))
        return Response({'success': True, 'regularization': self.get_serializer(regularization).data})

class ShiftViewSet(HRBaseViewSet):
    queryset = Shift.objects.all()
    serializer_class = ShiftSerializer

    def get_queryset(self):
        qs = super().get_queryset()
        active = self.request.query_params.get('active')
        search = (self.request.query_params.get('search') or '').strip()
        if active in {'true', '1', 'yes'}:
            qs = qs.filter(active=True)
        elif active in {'false', '0', 'no'}:
            qs = qs.filter(active=False)
        if search:
            qs = qs.filter(models.Q(name__icontains=search) | models.Q(code__icontains=search))
        return qs

    def perform_create(self, serializer):
        super().perform_create(serializer)
        logger.info(
            '[Shift] created shift=%s by=%s',
            serializer.instance.id,
            getattr(self.request.user, 'id', None),
        )

    def perform_update(self, serializer):
        serializer.save()
        logger.info(
            '[Shift] updated shift=%s by=%s',
            serializer.instance.id,
            getattr(self.request.user, 'id', None),
        )

    def destroy(self, request, *args, **kwargs):
        shift = self.get_object()
        has_assignments = shift.employees.exists() or shift.employee_assignments.exists()
        has_attendance = DailyAttendance.objects.filter(shift=shift).exists()
        if has_assignments or has_attendance or shift.active:
            shift.active = False
            shift.save(update_fields=['active', 'updated_at'])
            logger.info(
                '[Shift] deactivated shift=%s by=%s assigned=%s attendance=%s',
                shift.id,
                getattr(request.user, 'id', None),
                has_assignments,
                has_attendance,
            )
            return Response({
                'success': True,
                'action': 'deactivated',
                'message': 'Shift deactivated. Historical assignments and attendance links are preserved.',
            })
        return super().destroy(request, *args, **kwargs)

    @action(detail=True, methods=['post'])
    def activate(self, request, pk=None):
        shift = self.get_object()
        shift.active = True
        shift.save(update_fields=['active', 'updated_at'])
        logger.info('[Shift] activated shift=%s by=%s', shift.id, getattr(request.user, 'id', None))
        return Response({'success': True, 'active': True})

    @action(detail=True, methods=['post'])
    def deactivate(self, request, pk=None):
        shift = self.get_object()
        shift.active = False
        shift.save(update_fields=['active', 'updated_at'])
        logger.info('[Shift] deactivated shift=%s by=%s', shift.id, getattr(request.user, 'id', None))
        return Response({'success': True, 'active': False})


class EmployeeShiftViewSet(HRBaseViewSet):
    queryset = EmployeeShift.objects.select_related('employee', 'shift', 'assigned_by').all()
    serializer_class = EmployeeShiftSerializer

    def get_queryset(self):
        qs = super().get_queryset()
        employee_id = self.request.query_params.get('employee')
        shift_id = self.request.query_params.get('shift')
        primary = self.request.query_params.get('is_primary')
        if employee_id:
            qs = qs.filter(employee_id=employee_id)
        if shift_id:
            qs = qs.filter(shift_id=shift_id)
        if primary in {'true', '1', 'yes'}:
            qs = qs.filter(is_primary=True)
        elif primary in {'false', '0', 'no'}:
            qs = qs.filter(is_primary=False)
        return qs

    def perform_create(self, serializer):
        assignment = serializer.save()
        if assignment.is_primary:
            day = timezone.localdate()
            if (not assignment.effective_from or assignment.effective_from <= day) and (not assignment.effective_to or assignment.effective_to >= day):
                try:
                    recalculate_daily_attendance(assignment.employee, day)
                except Exception:
                    logger.exception('[AttendanceEngine] failed after shift assignment employee=%s date=%s', assignment.employee_id, day)
        logger.info(
            '[ShiftAssignment] employee=%s shift=%s assignment=%s by=%s',
            assignment.employee_id,
            assignment.shift_id,
            assignment.id,
            getattr(self.request.user, 'id', None),
        )

    def perform_update(self, serializer):
        assignment = serializer.save()
        if assignment.is_primary:
            day = timezone.localdate()
            if (not assignment.effective_from or assignment.effective_from <= day) and (not assignment.effective_to or assignment.effective_to >= day):
                try:
                    recalculate_daily_attendance(assignment.employee, day)
                except Exception:
                    logger.exception('[AttendanceEngine] failed after shift assignment update employee=%s date=%s', assignment.employee_id, day)
        logger.info(
            '[ShiftAssignment] updated assignment=%s by=%s',
            assignment.id,
            getattr(self.request.user, 'id', None),
        )

class LeaveTypeViewSet(HRBaseViewSet):
    queryset = LeaveType.objects.all()
    serializer_class = LeaveTypeSerializer

    def get_queryset(self):
        qs = super().get_queryset()
        active = self.request.query_params.get('active')
        if active == 'true':
            qs = qs.filter(is_active=True)
        elif active == 'false':
            qs = qs.filter(is_active=False)
        search = (self.request.query_params.get('search') or '').strip()
        if search:
            qs = qs.filter(models.Q(name__icontains=search) | models.Q(code__icontains=search))
        return qs.order_by('name')

    def get_serializer_context(self):
        ctx = super().get_serializer_context()
        ctx['hospital_id'] = _resolve_hr_hospital_id(self.request)
        return ctx

    def perform_create(self, serializer):
        hospital_id = _resolve_hr_hospital_id(self.request)
        if hospital_id:
            serializer.save(hospital_id=hospital_id)
        else:
            serializer.save()

    @action(detail=True, methods=['post'])
    def activate(self, request, pk=None):
        leave_type = self.get_object()
        leave_type.is_active = True
        leave_type.save(update_fields=['is_active', 'updated_at'])
        return Response(LeaveTypeSerializer(leave_type).data)

    @action(detail=True, methods=['post'])
    def deactivate(self, request, pk=None):
        leave_type = self.get_object()
        leave_type.is_active = False
        leave_type.save(update_fields=['is_active', 'updated_at'])
        return Response(LeaveTypeSerializer(leave_type).data)

    @action(detail=False, methods=['post'], url_path='seed-defaults')
    def seed_defaults(self, request):
        from apps.hr.leave_services import seed_default_leave_types, seed_default_policy

        hospital_id = _resolve_hr_hospital_id(request)
        if not hospital_id:
            return Response({
                'error': 'Hospital context is required. Link your account to a hospital or pass hospital_id.',
            }, status=400)
        hospital = Hospital.objects.filter(pk=hospital_id).first()
        if not hospital:
            return Response({'error': 'Hospital not found.'}, status=404)
        created_types = seed_default_leave_types(hospital)
        policy = seed_default_policy(hospital)
        return Response({
            'created_types': len(created_types),
            'policy': LeavePolicySerializer(policy).data if policy else None,
        })


class LeavePolicyViewSet(HRBaseViewSet):
    queryset = LeavePolicy.objects.prefetch_related(
        'departments',
        'designations',
        'lines__leave_type',
    ).all()
    serializer_class = LeavePolicySerializer

    def get_queryset(self):
        qs = super().get_queryset()
        active = self.request.query_params.get('active')
        if active == 'true':
            qs = qs.filter(is_active=True)
        elif active == 'false':
            qs = qs.filter(is_active=False)
        assignment = (self.request.query_params.get('assignment_type') or '').strip().upper()
        if assignment:
            qs = qs.filter(assignment_type=assignment)
        return qs.order_by('-is_default', 'name')

    @action(detail=True, methods=['post'])
    def apply(self, request, pk=None):
        from apps.hr.leave_services import apply_policy_balances

        policy = self.get_object()
        if not policy.is_active:
            return Response({'error': 'Cannot apply an inactive policy.'}, status=400)
        count = apply_policy_balances(policy)
        return Response({'success': True, 'balances_updated': count, 'policy': self.get_serializer(policy).data})

    @action(detail=True, methods=['post'])
    def activate(self, request, pk=None):
        policy = self.get_object()
        policy.is_active = True
        policy.save(update_fields=['is_active', 'updated_at'])
        return Response(self.get_serializer(policy).data)

    @action(detail=True, methods=['post'])
    def deactivate(self, request, pk=None):
        policy = self.get_object()
        policy.is_active = False
        policy.save(update_fields=['is_active', 'updated_at'])
        return Response(self.get_serializer(policy).data)


class LeaveBalanceViewSet(HRBaseViewSet):
    queryset = LeaveBalance.objects.select_related('employee', 'leave_type', 'policy').all()
    serializer_class = LeaveBalanceSerializer

    def get_queryset(self):
        qs = super().get_queryset()
        employee_id = self.request.query_params.get('employee')
        leave_type_id = self.request.query_params.get('leave_type')
        search = (self.request.query_params.get('search') or '').strip()
        if employee_id:
            qs = qs.filter(employee_id=employee_id)
        if leave_type_id:
            qs = qs.filter(leave_type_id=leave_type_id)
        if search:
            qs = qs.filter(
                models.Q(employee__name__icontains=search)
                | models.Q(employee__employee_id__icontains=search)
                | models.Q(leave_type__name__icontains=search)
            )
        return qs.order_by('employee__name', 'leave_type__name')


class LeaveRequestViewSet(HRBaseViewSet):
    queryset = LeaveRequest.objects.select_related('employee', 'leave_type', 'applied_by', 'reviewed_by').all()
    serializer_class = LeaveRequestSerializer

    def get_queryset(self):
        qs = super().get_queryset()
        employee_id = self.request.query_params.get('employee')
        leave_type_id = self.request.query_params.get('leave_type')
        status = self.request.query_params.get('status')
        date_from = self.request.query_params.get('date_from')
        date_to = self.request.query_params.get('date_to')
        search = (self.request.query_params.get('search') or '').strip()

        if employee_id:
            qs = qs.filter(employee_id=employee_id)
        if leave_type_id:
            qs = qs.filter(leave_type_id=leave_type_id)
        if status:
            qs = qs.filter(status=str(status).upper())
        if date_from:
            qs = qs.filter(end_date__gte=date_from)
        if date_to:
            qs = qs.filter(start_date__lte=date_to)
        if search:
            qs = qs.filter(
                models.Q(employee__name__icontains=search)
                | models.Q(employee__employee_id__icontains=search)
                | models.Q(employee__email__icontains=search)
                | models.Q(reason__icontains=search)
            )
        return qs

    def _append_notification_placeholder(self, leave_request, event):
        events = list(leave_request.notification_events or [])
        events.append({
            'event': event,
            'status': 'placeholder',
            'message': f'Leave {event} notification placeholder.',
            'at': timezone.now().isoformat(),
        })
        leave_request.notification_events = events

    def _ensure_pending(self, leave_request):
        if leave_request.status != LeaveRequest.STATUS_PENDING:
            return Response(
                {'error': f'Only PENDING leave requests can be reviewed. Current status: {leave_request.status}.'},
                status=400,
            )
        return None

    def _leave_dates(self, leave_request):
        current = leave_request.start_date
        while current <= leave_request.end_date:
            yield current
            current += timedelta(days=1)

    def _recalculate_leave_dates(self, leave_request, *, force: bool = True):
        for day in self._leave_dates(leave_request):
            try:
                recalculate_daily_attendance(leave_request.employee, day, force=force)
            except Exception:
                logger.exception(
                    '[AttendanceEngine] failed after leave change request=%s employee=%s date=%s',
                    leave_request.id,
                    leave_request.employee_id,
                    day,
                )

    @transaction.atomic
    @action(detail=True, methods=['post'])
    def approve(self, request, pk=None):
        if not is_hr_reviewer(request.user):
            return Response({'error': 'Access denied. HR staff only.'}, status=403)
        leave_request = get_object_or_404(
            self.get_queryset().select_for_update().select_related('employee', 'leave_type'),
            pk=pk,
        )
        if leave_request.status == LeaveRequest.STATUS_APPROVED:
            return Response({'success': True, 'message': 'Leave request already approved.', 'leave_request': self.get_serializer(leave_request).data})
        pending_error = self._ensure_pending(leave_request)
        if pending_error:
            return pending_error

        overlap = LeaveRequest.objects.select_for_update().filter(
            employee=leave_request.employee,
            status=LeaveRequest.STATUS_APPROVED,
            start_date__lte=leave_request.end_date,
            end_date__gte=leave_request.start_date,
        ).exclude(pk=leave_request.pk)
        if overlap.exists():
            return Response({'error': 'Employee already has approved leave overlapping this date range.'}, status=400)

        from apps.hr.leave_notifications import (
            pending_notification_event,
            schedule_leave_reviewed_notification,
        )
        from apps.hr.leave_services import has_sufficient_balance, leave_type_allows_unpaid

        balance = LeaveBalance.objects.select_for_update().filter(
            employee=leave_request.employee,
            leave_type=leave_request.leave_type,
        ).first()
        deduct_balance = (
            balance
            and not balance.is_unlimited
            and not leave_type_allows_unpaid(leave_request.leave_type)
        )
        if deduct_balance:
            if not has_sufficient_balance(balance, leave_request.number_of_days, leave_request.leave_type):
                remaining = balance.remaining_days if balance else Decimal('0.00')
                return Response({
                    'error': f'Insufficient leave balance. Available: {remaining}, requested: {leave_request.number_of_days}.',
                }, status=400)
            balance.used_days += leave_request.number_of_days
            balance.remaining_days -= leave_request.number_of_days
            balance.save(update_fields=['used_days', 'remaining_days', 'updated_at'])

        leave_request.status = LeaveRequest.STATUS_APPROVED
        leave_request.reviewed_by = request.user if request.user.is_authenticated else None
        leave_request.reviewed_on = timezone.now()
        leave_request.remarks = request.data.get('remarks', leave_request.remarks or '')
        events = list(leave_request.notification_events or [])
        events.append(pending_notification_event('approved'))
        leave_request.notification_events = events
        leave_request.save(update_fields=[
            'status',
            'reviewed_by',
            'reviewed_on',
            'remarks',
            'notification_events',
            'updated_at',
        ])
        self._recalculate_leave_dates(leave_request, force=True)
        schedule_leave_reviewed_notification(leave_request.id, action='approved')
        logger.info('[LeaveRequest] approved request=%s employee=%s by=%s', leave_request.id, leave_request.employee_id, getattr(request.user, 'id', None))
        return Response({'success': True, 'leave_request': self.get_serializer(leave_request).data})

    @transaction.atomic
    @action(detail=True, methods=['post'])
    def reject(self, request, pk=None):
        if not is_hr_reviewer(request.user):
            return Response({'error': 'Access denied. HR staff only.'}, status=403)
        leave_request = get_object_or_404(
            self.get_queryset().select_for_update().select_related('employee', 'leave_type'),
            pk=pk,
        )
        if leave_request.status == LeaveRequest.STATUS_REJECTED:
            return Response({'success': True, 'message': 'Leave request already rejected.', 'leave_request': self.get_serializer(leave_request).data})
        pending_error = self._ensure_pending(leave_request)
        if pending_error:
            return pending_error

        from apps.hr.leave_notifications import (
            pending_notification_event,
            schedule_leave_reviewed_notification,
        )

        leave_request.status = LeaveRequest.STATUS_REJECTED
        leave_request.reviewed_by = request.user if request.user.is_authenticated else None
        leave_request.reviewed_on = timezone.now()
        leave_request.remarks = request.data.get('remarks', leave_request.remarks or '')
        events = list(leave_request.notification_events or [])
        events.append(pending_notification_event('rejected'))
        leave_request.notification_events = events
        leave_request.save(update_fields=[
            'status',
            'reviewed_by',
            'reviewed_on',
            'remarks',
            'notification_events',
            'updated_at',
        ])
        schedule_leave_reviewed_notification(leave_request.id, action='rejected')
        logger.info('[LeaveRequest] rejected request=%s employee=%s by=%s', leave_request.id, leave_request.employee_id, getattr(request.user, 'id', None))
        return Response({'success': True, 'leave_request': self.get_serializer(leave_request).data})

    @transaction.atomic
    @action(detail=True, methods=['post'])
    def cancel(self, request, pk=None):
        leave_request = get_object_or_404(
            self.get_queryset().select_for_update().select_related('employee', 'leave_type'),
            pk=pk,
        )
        if leave_request.status == LeaveRequest.STATUS_CANCELLED:
            return Response({'success': True, 'message': 'Leave request already cancelled.', 'leave_request': self.get_serializer(leave_request).data})
        if leave_request.status not in {LeaveRequest.STATUS_PENDING, LeaveRequest.STATUS_APPROVED}:
            return Response({'error': f'Only PENDING or APPROVED leave requests can be cancelled. Current status: {leave_request.status}.'}, status=400)
        was_approved = leave_request.status == LeaveRequest.STATUS_APPROVED
        if was_approved and not is_hr_reviewer(request.user):
            return Response({'error': 'Access denied. HR staff only.'}, status=403)

        leave_request.status = LeaveRequest.STATUS_CANCELLED
        leave_request.remarks = request.data.get('remarks', leave_request.remarks or '')
        self._append_notification_placeholder(leave_request, 'cancelled')
        leave_request.save(update_fields=['status', 'remarks', 'notification_events', 'updated_at'])

        if was_approved:
            balance = LeaveBalance.objects.select_for_update().filter(
                employee=leave_request.employee,
                leave_type=leave_request.leave_type,
            ).first()
            if balance:
                balance.used_days = max(Decimal('0.00'), balance.used_days - leave_request.number_of_days)
                balance.remaining_days += leave_request.number_of_days
                balance.save(update_fields=['used_days', 'remaining_days', 'updated_at'])
            self._recalculate_leave_dates(leave_request, force=True)
        logger.info('[LeaveRequest] cancelled request=%s employee=%s by=%s', leave_request.id, leave_request.employee_id, getattr(request.user, 'id', None))
        return Response({'success': True, 'leave_request': self.get_serializer(leave_request).data})

    def destroy(self, request, *args, **kwargs):
        leave_request = self.get_object()
        if leave_request.status != LeaveRequest.STATUS_PENDING:
            return Response({'error': 'Only PENDING leave requests can be deleted.'}, status=400)
        return super().destroy(request, *args, **kwargs)


class LeaveViewSet(HRBaseViewSet):
    queryset = Leave.objects.all()
    serializer_class = LeaveSerializer

    @action(detail=True, methods=['patch'])
    def approve(self, request, pk=None):
        leave = self.get_object()
        leave.status = 'approved'
        leave.save()
        return Response({'status': 'approved'})

    @action(detail=True, methods=['patch'])
    def reject(self, request, pk=None):
        leave = self.get_object()
        leave.status = 'rejected'
        leave.save()
        return Response({'status': 'rejected'})

class SalaryViewSet(HRBaseViewSet):
    queryset = Salary.objects.all()
    serializer_class = SalarySerializer

class JobOpeningViewSet(HRBaseViewSet):
    queryset = JobOpening.objects.prefetch_related(
        'document_requirements__document_type',
    )
    serializer_class = JobOpeningSerializer

    def get_queryset(self):
        qs = super().get_queryset()
        # Status filters apply to list only; retrieve/update must access any job by id.
        if self.action != 'list':
            return qs
        status_filter = self.request.query_params.get('status')
        if status_filter == 'archived':
            qs = qs.filter(is_archived=True)
        elif status_filter == 'closed':
            qs = qs.filter(status='closed', is_archived=False)
        elif status_filter == 'draft':
            qs = qs.filter(status='draft', is_archived=False)
        elif status_filter == 'on_hold':
            qs = qs.filter(status='on_hold', is_archived=False)
        elif status_filter == 'all':
            qs = qs
        else:
            # Default "active": only open jobs accepting applications (excludes draft)
            qs = qs.filter(
                status='open',
                is_active=True,
                is_archived=False,
            )
        return qs

    def destroy(self, request, *args, **kwargs):
        """Safe delete: Archive if candidates exist, hard delete if no candidates."""
        # Use base queryset to find job regardless of current filter
        job = JobOpening.objects.get(pk=self.kwargs['pk'])
        candidate_count = job.applications.count()

        if candidate_count > 0:
            # Archive instead of delete to preserve candidate data
            job.is_archived = True
            job.is_active = False
            job.status = 'archived'
            job.save()
            return Response({
                'message': f'Job archived successfully. {candidate_count} candidate(s) preserved.',
                'action': 'archived',
                'candidate_count': candidate_count
            }, status=200)
        else:
            # Hard delete if no candidates
            job.delete()
            return Response({
                'message': 'Job deleted successfully.',
                'action': 'deleted'
            }, status=200)

    @action(detail=True, methods=['post'])
    def close(self, request, pk=None):
        """Close a job opening."""
        job = self.get_object()
        job.status = 'closed'
        job.is_active = False
        job.save()
        return Response({
            'message': f'Job "{job.title}" closed successfully.',
            'status': 'closed'
        }, status=200)

    @action(detail=True, methods=['post'])
    def archive(self, request, pk=None):
        """Archive a job opening."""
        try:
            # Use base queryset to find job regardless of current filter
            job = JobOpening.objects.get(pk=pk)
            job.is_archived = True
            job.is_active = False
            job.status = 'archived'
            job.save()
            return Response({
                'message': f'Job "{job.title}" archived successfully.',
                'status': 'archived'
            }, status=200)
        except Exception as e:
            return Response({
                'error': str(e),
                'message': 'Failed to archive job'
            }, status=500)

    @action(detail=True, methods=['post'])
    def reactivate(self, request, pk=None):
        """Reactivate a closed or archived job."""
        try:
            # Use base queryset to find job regardless of current filter
            job = JobOpening.objects.get(pk=pk)
            print(f"[REACTIVATE] Job ID: {job.id}, Title: {job.title}")
            print(f"[REACTIVATE] Before - status: {job.status}, is_active: {job.is_active}, is_archived: {job.is_archived}")
            job.is_active = True
            job.is_archived = False
            job.status = 'open'
            job.save()
            print(f"[REACTIVATE] After - status: {job.status}, is_active: {job.is_active}, is_archived: {job.is_archived}")
            return Response({
                'message': f'Job "{job.title}" reactivated successfully.',
                'status': 'open'
            }, status=200)
        except Exception as e:
            import traceback
            print(f"[REACTIVATE ERROR] {str(e)}")
            print(f"[REACTIVATE TRACEBACK] {traceback.format_exc()}")
            return Response({
                'error': str(e),
                'message': 'Failed to reactivate job'
            }, status=500)

class CandidateViewSet(HRBaseViewSet):
    queryset = Candidate.objects.all()
    serializer_class = CandidateSerializer

    def get_queryset(self):
        from apps.hr.candidate_pipeline import annotate_has_scheduled_interview, apply_shared_candidate_filters

        qs = super().get_queryset()
        qs = qs.select_related(
            'job_opening',
            'job_opening__department',
            'job_opening__designation',
            'profile',
        )
        qs = annotate_has_scheduled_interview(qs, Interview)
        active_offer_sq = Offer.objects.filter(
            candidate_id=OuterRef('pk'),
            status__in=['sent', 'accepted'],
        )
        qs = qs.annotate(_has_active_offer=Exists(active_offer_sq))
        qs = qs.prefetch_related(
            Prefetch(
                'interviews',
                queryset=Interview.objects.filter(status=Interview.STATUS_SCHEDULED).order_by(
                    '-scheduled_start'
                ),
            ),
            'document_requirements__document_type',
        )
        qs = apply_shared_candidate_filters(qs, self.request.query_params, Interview)
        return qs

    def _reject_bulk_ids_outside_list_filter(self, raw_ids):
        """Bulk APIs must only mutate candidates visible under the same URL filters as the list (job, stage, etc.)."""
        if not raw_ids:
            return Response({'error': 'candidate_ids is required'}, status=400)
        ids = list(dict.fromkeys(str(x) for x in raw_ids))
        filtered = self.get_queryset().filter(id__in=ids)
        found = {str(pk) for pk in filtered.values_list('id', flat=True)}
        if found != set(ids):
            return Response(
                {
                    'error': (
                        'One or more selected candidates are not in your current filtered view '
                        '(for example, a different job opening). Refresh the list and try again.'
                    )
                },
                status=400,
            )
        return None

    def update(self, request, *args, **kwargs):
        candidate = self.get_object()
        old_status = candidate.status
        new_status = request.data.get('status')
        
        # Call parent update
        response = super().update(request, *args, **kwargs)
        
        # Send email only after the status update is committed.
        if new_status and new_status != old_status:
            from apps.hr.recruitment_email_dispatcher import EmailEventDispatcher

            updated_candidate = Candidate.objects.select_related('job_opening').get(pk=candidate.pk)
            if new_status == 'shortlisted':
                EmailEventDispatcher.shortlisted(updated_candidate)
            elif new_status == 'rejected':
                EmailEventDispatcher.rejected(
                    updated_candidate,
                    rejection_from_status=old_status,
                )
        
        return response

    @action(detail=True, methods=['post'])
    def move_to_interview(self, request, pk=None):
        """Move shortlisted candidate to interview stage."""
        candidate = self.get_object()
        
        if candidate.status != 'shortlisted':
            return Response({
                'error': f'Cannot move to interview from {candidate.status} status. Must be shortlisted first.'
            }, status=400)
        
        candidate.status = 'interview'
        candidate.interview_status = 'pending'
        candidate.save()
        
        return Response({
            'message': f'{candidate.name} moved to interview stage.',
            'status': candidate.status
        })

    @action(detail=True, methods=['post'])
    def schedule_interview(self, request, pk=None):
        """Schedule interview for candidate; creates an Interview row and sends invite email."""
        from apps.hr import interview_scheduling as inv_sched
        from apps.hr.recruitment_email_dispatcher import EmailEventDispatcher

        candidate = self.get_object()

        if candidate.status not in ('interview', 'shortlisted'):
            return Response({
                'error': f'Cannot schedule interview for candidate with status: {candidate.status}'
            }, status=400)

        # Allow direct scheduling from shortlisted state (single-candidate flow parity with bulk actions).
        if candidate.status == 'shortlisted':
            candidate.status = 'interview'
            candidate.interview_status = 'pending'
            candidate.save(update_fields=['status', 'interview_status', 'updated_at'])

        interview_date = request.data.get('interview_date')
        date_s = (request.data.get('date') or '').strip()
        time_s = (request.data.get('time') or '').strip()
        interview_type = request.data.get('interview_type', 'online') or 'online'
        if interview_type not in ('online', 'offline'):
            interview_type = 'online'

        meeting_link = (request.data.get('interview_meeting_link') or '').strip()
        venue_address = (request.data.get('interview_venue_address') or '').strip()

        if not interview_date and not (date_s and time_s):
            return Response({
                'error': 'interview_date is required'
            }, status=400)

        try:
            interview_type, meeting_link, venue_address, platform = inv_sched.validate_mode_fields(
                interview_type,
                meeting_link,
                venue_address,
                (request.data.get('platform') or '').strip(),
            )
        except inv_sched.InterviewSchedulingError as e:
            return Response({'error': e.message}, status=400)

        tz_name = inv_sched.hr_timezone_name()
        try:
            if date_s and time_s:
                parsed_date = inv_sched.parse_local_datetime(date_s, time_s, tz_name)
            else:
                raw = str(interview_date).strip()
                if 'T' in raw:
                    date_part, time_part = raw.split('T', 1)
                    parsed_date = inv_sched.parse_local_datetime(date_part, time_part, tz_name)
                else:
                    parsed_date = parse_datetime(interview_date)
                    if not parsed_date:
                        return Response({
                            'error': 'Invalid interview_date format'
                        }, status=400)
                    if timezone.is_naive(parsed_date):
                        from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

                        try:
                            parsed_date = parsed_date.replace(tzinfo=ZoneInfo(tz_name))
                        except ZoneInfoNotFoundError:
                            return Response({'error': f'Unknown timezone: {tz_name}'}, status=400)
        except inv_sched.InterviewSchedulingError as e:
            return Response({'error': e.message}, status=400)

        try:
            inv_sched.ensure_interview_not_in_past(
                parsed_date,
                tz_name,
                date_s=date_s,
                time_s=time_s,
                request_payload=inv_sched._schedule_audit_payload(request.data),
                audit_source=f'schedule_interview candidate={candidate.pk}',
            )
        except inv_sched.InterviewSchedulingError as e:
            return Response({'error': e.message}, status=400)

        duration = int(request.data.get('duration_minutes') or 60)
        end = inv_sched.compute_end(parsed_date, duration)

        existing_inv = (
            Interview.objects.filter(candidate_id=candidate.pk, status=Interview.STATUS_SCHEDULED)
            .order_by('-scheduled_start')
            .first()
        )
        exclude_inv_id = existing_inv.pk if existing_inv else None
        exclude_inv_ids = [exclude_inv_id] if exclude_inv_id else None

        overlap = inv_sched.find_scheduled_overlap_for_candidate(
            candidate.pk, parsed_date, end, exclude_interview_id=exclude_inv_id
        )
        if overlap:
            return Response({
                'error': 'This candidate already has a scheduled interview overlapping this time.'
            }, status=400)

        interviewer_name = (request.data.get('interviewer') or request.data.get('interviewer_name') or '').strip()
        conf = inv_sched.find_interviewer_conflict(
            interviewer_name, parsed_date, end, exclude_inv_ids
        )
        if conf:
            return Response({
                'error': f'Interviewer "{interviewer_name}" has an overlapping interview at {conf.scheduled_start}.'
            }, status=400)

        location_notes = (request.data.get('location_notes') or '').strip()
        notes = (request.data.get('notes') or '').strip()

        from apps.hr.interview_reminders import queue_sync_interview_reminders

        if existing_inv:
            existing_inv.scheduled_start = parsed_date
            existing_inv.scheduled_end = end
            existing_inv.duration_minutes = duration
            existing_inv.timezone = tz_name
            existing_inv.mode = interview_type
            existing_inv.platform = platform
            existing_inv.meeting_link = meeting_link
            existing_inv.office_address = venue_address
            existing_inv.location_notes = location_notes
            existing_inv.interviewer_name = interviewer_name
            existing_inv.notes = notes
            existing_inv.updated_by = request.user if request.user.is_authenticated else None
            existing_inv.save()
            inv = existing_inv
            inv_sched.sync_candidate_interview_snapshot(candidate, inv)
            queue_sync_interview_reminders(inv)

            cid, iid, start = candidate.pk, inv.pk, parsed_date
            transaction.on_commit(
                lambda cid=cid, iid=iid, start=start: EmailEventDispatcher.interview_rescheduled(
                    cid, iid, scheduled_start=start, on_commit=False
                )
            )
            message = f'Interview rescheduled for {candidate.name}.'
        else:
            inv = Interview.objects.create(
                candidate=candidate,
                scheduled_start=parsed_date,
                scheduled_end=end,
                duration_minutes=duration,
                timezone=tz_name,
                mode=interview_type,
                platform=platform,
                meeting_link=meeting_link,
                office_address=venue_address,
                location_notes=location_notes,
                interviewer_name=interviewer_name,
                notes=notes,
                status=Interview.STATUS_SCHEDULED,
                created_by=request.user if request.user.is_authenticated else None,
            )
            inv_sched.sync_candidate_interview_snapshot(candidate, inv)
            queue_sync_interview_reminders(inv)

            cid, iid = candidate.pk, inv.pk
            transaction.on_commit(
                lambda cid=cid, iid=iid: EmailEventDispatcher.interview_scheduled(cid, iid, on_commit=False)
            )
            message = f'Interview scheduled for {candidate.name}.'

        return Response({
            'message': message,
            'interview_id': str(inv.pk),
            'rescheduled': bool(existing_inv),
            'interview_date': candidate.interview_date.isoformat() if candidate.interview_date else None,
            'interview_type': interview_type,
            'interview_meeting_link': meeting_link,
            'interview_venue_address': venue_address,
        })

    @action(detail=False, methods=['post'], url_path='bulk_schedule_interviews')
    def bulk_schedule_interviews(self, request):
        from apps.hr import interview_scheduling as inv_sched
        from apps.hr.recruitment_email_dispatcher import EmailEventDispatcher

        bad = self._reject_bulk_ids_outside_list_filter(request.data.get('candidate_ids'))
        if bad:
            return bad
        try:
            result = inv_sched.run_bulk_schedule(request.user, request.data.get('candidate_ids'), request.data)
        except inv_sched.InterviewSchedulingError as e:
            return Response({'error': e.message}, status=400)

        for iid in result.get('created_interview_ids', []):
            inv_row = Interview.objects.filter(pk=iid).only('candidate_id').first()
            if inv_row:
                cid = inv_row.candidate_id
                transaction.on_commit(
                    lambda cid=cid, iid=iid: EmailEventDispatcher.interview_scheduled(
                        cid, iid, on_commit=False
                    )
                )

        return Response({
            'message': f"Scheduled {result['affected_count']} interview(s).",
            **result,
        })

    @action(detail=False, methods=['post'], url_path='bulk_reschedule_interviews')
    def bulk_reschedule_interviews(self, request):
        from apps.hr import interview_scheduling as inv_sched
        from apps.hr.recruitment_email_dispatcher import EmailEventDispatcher

        bad = self._reject_bulk_ids_outside_list_filter(request.data.get('candidate_ids'))
        if bad:
            return bad
        # Default True so reschedule emails match bulk schedule / single schedule behavior.
        notify_raw = request.data.get('notify_candidate')
        if notify_raw is None:
            notify_candidate = True
        else:
            notify_candidate = notify_raw in (True, 'true', 'True', '1', 1)
        try:
            result = inv_sched.run_bulk_reschedule(request.user, request.data.get('candidate_ids'), request.data)
        except inv_sched.InterviewSchedulingError as e:
            return Response({'error': e.message}, status=400)

        if notify_candidate:
            for iid in result.get('updated_interview_ids', []):
                inv_row = (
                    Interview.objects.filter(pk=iid)
                    .only('candidate_id', 'scheduled_start')
                    .first()
                )
                if inv_row:
                    cid = inv_row.candidate_id
                    start = inv_row.scheduled_start
                    transaction.on_commit(
                        lambda cid=cid, iid=iid, start=start: EmailEventDispatcher.interview_rescheduled(
                            cid,
                            iid,
                            scheduled_start=start,
                            on_commit=False,
                        )
                    )

        return Response({
            'message': f"Rescheduled {result['affected_count']} interview(s).",
            **result,
        })

    @action(detail=False, methods=['post'], url_path='bulk_cancel_interviews')
    def bulk_cancel_interviews(self, request):
        from apps.hr import interview_scheduling as inv_sched

        bad = self._reject_bulk_ids_outside_list_filter(request.data.get('candidate_ids'))
        if bad:
            return bad
        try:
            result = inv_sched.run_bulk_cancel(request.user, request.data.get('candidate_ids'))
        except inv_sched.InterviewSchedulingError as e:
            return Response({'error': e.message}, status=400)

        return Response({
            'message': f"Cancelled scheduled interviews for {result['affected_count']} candidate(s).",
            **result,
        })

    @action(detail=False, methods=['post'], url_path='bulk_shortlist')
    def bulk_shortlist(self, request):
        raw = request.data.get('candidate_ids')
        bad = self._reject_bulk_ids_outside_list_filter(raw)
        if bad:
            return bad
        ids = list(dict.fromkeys(str(x) for x in raw))
        from apps.hr.recruitment_email_dispatcher import EmailEventDispatcher

        try:
            with transaction.atomic():
                rows = list(
                    self.get_queryset()
                    .select_for_update()
                    .select_related('job_opening')
                    .filter(id__in=ids)
                    .order_by('created_at')
                )
                if len(rows) != len(ids):
                    return Response({'error': 'One or more candidates were not found.'}, status=404)
                for c in rows:
                    if c.status != 'applied':
                        return Response(
                            {'error': f'{c.name} must be in Applied stage to shortlist (currently {c.status}).'},
                            status=400,
                        )
                    if c.status in ('rejected', 'hired'):
                        return Response({'error': f'{c.name} cannot be shortlisted.'}, status=400)
                for c in rows:
                    c.status = 'shortlisted'
                    c.save(update_fields=['status', 'updated_at'])
                    pk = c.pk
                    transaction.on_commit(
                        lambda pk=pk: EmailEventDispatcher.shortlisted(
                            Candidate.objects.select_related('job_opening').get(pk=pk),
                            on_commit=False,
                        )
                    )
        except Candidate.DoesNotExist:
            return Response({'error': 'Candidate not found'}, status=404)

        return Response({'message': f'Shortlisted {len(ids)} candidate(s).', 'updated_ids': ids})

    @action(detail=False, methods=['post'], url_path='bulk_move_to_interview')
    def bulk_move_to_interview(self, request):
        """Move shortlisted candidates to interview stage without scheduling a slot."""
        raw = request.data.get('candidate_ids')
        bad = self._reject_bulk_ids_outside_list_filter(raw)
        if bad:
            return bad
        ids = list(dict.fromkeys(str(x) for x in raw))

        try:
            with transaction.atomic():
                rows = list(
                    self.get_queryset()
                    .select_for_update()
                    .filter(id__in=ids)
                    .order_by('created_at')
                )
                if len(rows) != len(ids):
                    return Response({'error': 'One or more candidates were not found.'}, status=404)
                for c in rows:
                    if c.status != 'shortlisted':
                        return Response(
                            {
                                'error': (
                                    f'{c.name} must be shortlisted to move to interview '
                                    f'(currently {c.status}).'
                                ),
                            },
                            status=400,
                        )
                for c in rows:
                    c.status = 'interview'
                    c.interview_status = 'pending'
                    c.save(update_fields=['status', 'interview_status', 'updated_at'])
        except Candidate.DoesNotExist:
            return Response({'error': 'Candidate not found'}, status=404)

        return Response({
            'message': f'Moved {len(ids)} candidate(s) to interview stage.',
            'updated_ids': ids,
        })

    @action(detail=False, methods=['post'], url_path='bulk_reject')
    def bulk_reject(self, request):
        raw = request.data.get('candidate_ids')
        bad = self._reject_bulk_ids_outside_list_filter(raw)
        if bad:
            return bad
        ids = list(dict.fromkeys(str(x) for x in raw))
        from apps.hr.recruitment_email_dispatcher import EmailEventDispatcher

        try:
            with transaction.atomic():
                rows = list(
                    self.get_queryset()
                    .select_for_update()
                    .select_related('job_opening')
                    .filter(id__in=ids)
                    .order_by('created_at')
                )
                if len(rows) != len(ids):
                    return Response({'error': 'One or more candidates were not found.'}, status=404)
                for c in rows:
                    if c.status in ('hired', 'rejected'):
                        return Response(
                            {'error': f'{c.name} is already {c.status}; cannot reject.'},
                            status=400,
                        )
                for c in rows:
                    old = c.status
                    c.status = 'rejected'
                    c.save(update_fields=['status', 'updated_at'])
                    pk = c.pk
                    transaction.on_commit(
                        lambda pk=pk, old_status=old: EmailEventDispatcher.rejected(
                            Candidate.objects.select_related('job_opening').get(pk=pk),
                            rejection_from_status=old_status,
                            on_commit=False,
                        )
                    )
        except Candidate.DoesNotExist:
            return Response({'error': 'Candidate not found'}, status=404)

        return Response({'message': f'Rejected {len(ids)} candidate(s).', 'updated_ids': ids})

    @action(detail=False, methods=['get'], url_path='export')
    def export_candidates(self, request):
        from apps.hr.candidate_pipeline import compute_pipeline_stage

        qs = self.get_queryset().iterator(chunk_size=300)
        out = io.StringIO()
        w = csv.writer(out)
        w.writerow(
            [
                'candidate_id',
                'application_id',
                'name',
                'email',
                'phone',
                'job',
                'department',
                'pipeline_stage',
                'status',
                'interview_status',
                'offer_status',
                'experience',
                'source',
                'applied_at',
            ]
        )
        for c in qs:
            has_s = getattr(c, '_has_scheduled_interview', None)
            stage = compute_pipeline_stage(c, has_scheduled=has_s)
            dept = ''
            if c.job_opening_id and c.job_opening.department_id:
                dept = c.job_opening.department.name
            cand_code = c.profile.candidate_code if getattr(c, 'profile_id', None) else ''
            w.writerow(
                [
                    cand_code,
                    c.application_code or '',
                    c.name,
                    c.email,
                    c.phone or '',
                    c.job_opening.title if c.job_opening_id else '',
                    dept,
                    stage,
                    c.status,
                    c.interview_status,
                    c.offer_status,
                    c.experience or '',
                    getattr(c, 'application_source', '') or '',
                    c.created_at.isoformat() if c.created_at else '',
                ]
            )
        resp = HttpResponse(out.getvalue(), content_type='text/csv; charset=utf-8')
        resp['Content-Disposition'] = 'attachment; filename="recruitment_candidates.csv"'
        return resp

    @action(detail=True, methods=['post'])
    def mark_interview_completed(self, request, pk=None):
        """Mark interview as completed."""
        try:
            candidate = self.get_object()
            print(f"[mark_interview_completed] Candidate found: {candidate.name}, id: {candidate.id}")

            if candidate.status != 'interview':
                return Response({
                    'success': False,
                    'error': f'Cannot mark interview completed for status: {candidate.status}'
                }, status=400)

            inv = (
                Interview.objects.filter(candidate=candidate, status=Interview.STATUS_SCHEDULED)
                .order_by('-scheduled_start')
                .first()
            )
            if inv:
                inv.status = Interview.STATUS_COMPLETED
                inv.updated_by = request.user if request.user.is_authenticated else None
                inv.save(update_fields=['status', 'updated_by', 'updated_at'])

            candidate.interview_status = 'completed'
            candidate.save()
            print(f"[mark_interview_completed] Interview status updated to completed")

            # Serialize and return full candidate data
            serializer = self.get_serializer(candidate)
            serialized_data = serializer.data
            print(f"[mark_interview_completed] Serialized candidate data keys: {serialized_data.keys()}")
            print(f"[mark_interview_completed] Candidate id in response: {serialized_data.get('id')}")
            print(f"[mark_interview_completed] Candidate name in response: {serialized_data.get('name')}")

            return Response({
                'success': True,
                'message': f'Interview marked as completed for {candidate.name}.',
                'candidate': serialized_data
            }, status=200)
        except Exception as e:
            print(f"[mark_interview_completed] Error: {e}")
            import traceback
            traceback.print_exc()
            return Response({
                'success': False,
                'error': str(e)
            }, status=400)

    @action(detail=True, methods=['post'])
    def select(self, request, pk=None):
        """Select candidate after interview."""
        try:
            candidate = self.get_object()
            
            if candidate.status != 'interview':
                return Response({
                    'success': False,
                    'error': f'Cannot select candidate with status: {candidate.status}. Must be in interview stage first.'
                }, status=400)
            
            candidate.status = 'selected'
            candidate.save()
            
            serializer = self.get_serializer(candidate)

            return Response({
                'success': True,
                'message': f'{candidate.name} has been selected.',
                'candidate': serializer.data
            }, status=200)
        except Exception as e:
            return Response({
                'success': False,
                'error': str(e)
            }, status=400)

    @action(detail=True, methods=['post'], url_path='request_documents')
    def request_documents(self, request, pk=None):
        """Manual HR trigger to request additional documents from a candidate (may be sent multiple times)."""
        candidate = self.get_object()
        message = (request.data.get('message') or '').strip()
        documents = request.data.get('documents') or request.data.get('document_types') or []
        if isinstance(documents, str):
            documents = [documents]

        from apps.hr.recruitment_email_dispatcher import EmailEventDispatcher
        EmailEventDispatcher.document_request(
            candidate,
            message=message,
            documents=documents,
        )
        return Response({
            'success': True,
            'message': f'Document request email queued for {candidate.name}.',
        })

    @action(detail=True, methods=['post'])
    def reject(self, request, pk=None):
        """Reject candidate."""
        try:
            candidate = self.get_object()
            
            if candidate.status in ['hired', 'rejected']:
                return Response({
                    'success': False,
                    'error': 'Cannot reject candidate who is already hired or rejected.'
                }, status=400)
            
            rejection_from = candidate.status
            candidate.status = 'rejected'
            candidate.save()

            serializer = self.get_serializer(candidate)

            from apps.hr.recruitment_email_dispatcher import EmailEventDispatcher
            EmailEventDispatcher.rejected(
                candidate,
                rejection_from_status=rejection_from,
            )

            return Response({
                'success': True,
                'message': f'{candidate.name} has been rejected.',
                'candidate': serializer.data
            }, status=200)
        except Exception as e:
            return Response({
                'success': False,
                'error': str(e)
            }, status=400)

    @action(detail=True, methods=['post'])
    def create_offer(self, request, pk=None):
        """Create offer for selected candidate."""
        candidate = self.get_object()
        
        if candidate.status != 'selected':
            return Response({
                'error': f'Cannot create offer for candidate with status: {candidate.status}. Must be selected first.'
            }, status=400)
        
        offered_salary = request.data.get('offered_salary')
        joining_date = request.data.get('joining_date')
        
        if not offered_salary or not joining_date:
            return Response({
                'error': 'offered_salary and joining_date are required'
            }, status=400)
        
        from decimal import Decimal
        try:
            candidate.offered_salary = Decimal(str(offered_salary))
        except:
            return Response({
                'error': 'Invalid offered_salary format'
            }, status=400)
        
        candidate.joining_date = joining_date
        candidate.offer_status = 'pending'
        candidate.save()
        
        return Response({
            'message': f'Offer created for {candidate.name}.',
            'offered_salary': str(candidate.offered_salary),
            'joining_date': joining_date,
            'offer_status': candidate.offer_status
        })

    @action(detail=True, methods=['post'])
    def revoke_offer(self, request, pk=None):
        """Revoke offer for selected candidate."""
        candidate = self.get_object()
        
        # Find the active sent offer
        offer = Offer.objects.filter(candidate=candidate, status='sent').first()
        if not offer:
            return Response({
                'success': False,
                'error': 'No sent offer found for this candidate to revoke.'
            }, status=400)
            
        # Revoke the offer
        offer.status = 'draft'
        offer.save()
        
        # Update candidate offer status back to pending
        candidate.offer_status = 'pending'
        candidate.save()
        
        # Send revocation email
        try:
            from apps.hr.email_utils import send_offer_revocation_email
            send_offer_revocation_email(offer)
            print(f"[revoke_offer] Revocation email queued for {candidate.email}")
        except Exception as e:
            print(f"[revoke_offer] Failed to queue revocation email: {e}")
        
        # Serialize and return
        serializer = self.get_serializer(candidate)
        
        return Response({
            'success': True,
            'message': f'Offer for {candidate.name} has been revoked.',
            'candidate': serializer.data
        })

    @action(detail=True, methods=['post'])
    def accept_offer(self, request, pk=None):
        """Accept offer - mark as hired."""
        candidate = self.get_object()
        
        if candidate.status != 'selected':
            return Response({
                'error': f'Cannot accept offer for candidate with status: {candidate.status}'
            }, status=400)
        
        if candidate.offer_status != 'pending':
            return Response({
                'error': f'Cannot accept offer with status: {candidate.offer_status}'
            }, status=400)
        
        candidate.offer_status = 'accepted'
        candidate.status = 'hired'
        candidate.save()
        
        # Step 2: Trigger Conversion (Offer -> Employee)
        employee, error = convert_hired_candidate_to_employee(candidate)
        
        if error:
            return Response({
                'message': f'Offer accepted, but employee conversion failed: {error}',
                'status': candidate.status,
                'offer_status': candidate.offer_status,
                'conversion_error': error
            }, status=200) # Still return 200 because offer was accepted
            
        return Response({
            'message': f'Offer accepted! {candidate.name} is now hired and converted to employee {employee.employee_id}.',
            'status': candidate.status,
            'offer_status': candidate.offer_status,
            'employee_id': employee.employee_id
        })

    @action(detail=True, methods=['post'])
    def decline_offer(self, request, pk=None):
        """Decline offer - mark as rejected."""
        candidate = self.get_object()
        
        if candidate.status != 'selected':
            return Response({
                'error': f'Cannot decline offer for candidate with status: {candidate.status}'
            }, status=400)
        
        if candidate.offer_status != 'pending':
            return Response({
                'error': f'Cannot decline offer with status: {candidate.offer_status}'
            }, status=400)
        
        candidate.offer_status = 'declined'
        candidate.status = 'rejected'
        candidate.save()
        
        return Response({
            'message': f'Offer declined. {candidate.name} has been rejected.',
            'status': candidate.status,
            'offer_status': candidate.offer_status
        })

    @action(detail=False, methods=['get'])
    def status_counts(self, request):
        """Get candidate counts by status (ignores pipeline tab so job dashboards stay accurate)."""
        from apps.hr.candidate_pipeline import annotate_has_scheduled_interview, apply_shared_candidate_filters

        qs = super().get_queryset()
        qs = qs.select_related(
            'job_opening',
            'job_opening__department',
            'job_opening__designation',
            'profile',
        )
        qs = annotate_has_scheduled_interview(qs, Interview)
        qs = apply_shared_candidate_filters(
            qs, request.query_params, Interview, apply_pipeline=False, apply_search_flag=False
        )
        job_id = request.query_params.get('job_id')
        if job_id:
            qs = qs.filter(job_opening_id=job_id)

        counts = {}
        for status_code, _label in Candidate.STATUS_CHOICES:
            counts[status_code] = qs.filter(status=status_code).count()

        return Response(counts)

    @action(detail=False, methods=['get'], url_path='pipeline_counts')
    def pipeline_counts(self, request):
        from apps.hr.candidate_pipeline import (
            annotate_has_scheduled_interview,
            apply_shared_candidate_filters,
            APPLIED_PIPELINE_STATUSES,
        )

        qs = super().get_queryset()
        qs = qs.select_related(
            'job_opening',
            'job_opening__department',
            'job_opening__designation',
            'profile',
        )
        qs = annotate_has_scheduled_interview(qs, Interview)
        qs = apply_shared_candidate_filters(
            qs, request.query_params, Interview, apply_pipeline=False, apply_search_flag=False
        )
        return Response(
            {
                'all': qs.count(),
                'applied': qs.filter(status__in=APPLIED_PIPELINE_STATUSES).count(),
                'shortlisted': qs.filter(status='shortlisted').count(),
                'interviews': qs.filter(status='interview').count(),
                'interview_scheduled': qs.filter(status='interview', _has_scheduled_interview=True).count(),
                'interview_completed': qs.filter(
                    status='interview',
                    interview_status='completed',
                    _has_scheduled_interview=False,
                ).count(),
                'selected': qs.filter(status='selected').count(),
                'offer_sent': qs.filter(offer_status='sent').count(),
                'offer_accepted': qs.filter(offer_status='accepted').count(),
                'hired': qs.filter(status='hired').count(),
                'rejected': qs.filter(status='rejected').count(),
            }
        )

class InterviewViewSet(HRBaseViewSet):
    queryset = Interview.objects.all()
    serializer_class = InterviewSerializer

    def get_queryset(self):
        qs = Interview.objects.select_related(
            'candidate',
            'candidate__job_opening',
        ).order_by('-scheduled_start')
        user = self.request.user
        hospital_id = getattr(user, 'hospital_id', None)
        if hospital_id:
            qs = qs.filter(candidate__job_opening__hospital_id=hospital_id)

        status = (self.request.query_params.get('status') or '').strip()
        if status and status != 'all':
            qs = qs.filter(status=status)

        job_opening = (self.request.query_params.get('job_opening') or '').strip()
        if job_opening:
            qs = qs.filter(candidate__job_opening_id=job_opening)

        search = (self.request.query_params.get('search') or '').strip()
        if search:
            qs = qs.filter(
                models.Q(candidate__name__icontains=search)
                | models.Q(candidate__email__icontains=search)
            )

        upcoming = (self.request.query_params.get('upcoming') or '').strip().lower()
        if upcoming == 'true':
            qs = qs.filter(
                status=Interview.STATUS_SCHEDULED,
                scheduled_start__gte=timezone.now(),
            )
        elif upcoming == 'false':
            qs = qs.filter(
                models.Q(
                    status__in=[
                        Interview.STATUS_COMPLETED,
                        Interview.STATUS_CANCELLED,
                        Interview.STATUS_NO_SHOW,
                    ]
                )
                | models.Q(
                    status=Interview.STATUS_SCHEDULED,
                    scheduled_start__lt=timezone.now(),
                )
            )

        return qs

class PerformanceReviewViewSet(HRBaseViewSet):
    queryset = PerformanceReview.objects.all()
    serializer_class = PerformanceReviewSerializer


class OfferBuilderV2ViewSet(viewsets.ModelViewSet):
    permission_classes = [permissions.IsAuthenticated, IsHRStaffUser]

    def get_queryset(self):
        from django.db.models import Q

        qs = OfferBuilderV2.objects.select_related(
            'candidate',
            'candidate__job_opening',
            'candidate__job_opening__department',
            'candidate__job_opening__designation',
        ).order_by('-created_at')
        user = self.request.user
        hospital_id = getattr(user, 'hospital_id', None)
        if hospital_id:
            qs = qs.filter(
                Q(candidate__isnull=True) | Q(candidate__job_opening__hospital_id=hospital_id)
            )
        candidate_id = self.request.query_params.get('candidate')
        if candidate_id:
            qs = qs.filter(candidate_id=candidate_id)
        job_opening = (self.request.query_params.get('job_opening') or '').strip()
        if job_opening:
            qs = qs.filter(candidate__job_opening_id=job_opening)
        return qs
        
    serializer_class = OfferBuilderV2Serializer

    @action(detail=False, methods=['post'], url_path='render-preview')
    def render_preview(self, request):
        """Render offer letter HTML from builder payload (same template as PDF)."""
        from apps.hr.utils.offer_letter_renderer import render_offer_letter_html

        payload = request.data
        if not isinstance(payload, dict):
            return Response({'error': 'Invalid payload'}, status=400)
        html = render_offer_letter_html(payload, request=request)
        return Response({'html': html})

    def _download_pdf_response(self, request, payload: dict):
        from django.http import HttpResponse
        from django.utils.text import slugify

        from apps.hr.utils.offer_letter_renderer import render_offer_letter_html
        from apps.hr.utils.pdf_generator import generate_pdf_bytes_from_html

        html = render_offer_letter_html(payload, request=request)
        pdf_data = generate_pdf_bytes_from_html(html)
        if not pdf_data:
            return Response({'error': 'Failed to generate PDF'}, status=500)

        candidate = (payload.get('candidate_name') or 'offer-letter').strip()
        safe_name = slugify(candidate) or 'offer-letter'
        filename = f'Offer_{safe_name}.pdf'

        response = HttpResponse(pdf_data, content_type='application/pdf')
        response['Content-Disposition'] = f'attachment; filename="{filename}"'
        return response

    @action(detail=False, methods=['post'], url_path='download-pdf')
    def download_pdf(self, request):
        """Generate and download offer letter PDF without sending email."""
        payload = request.data
        if not isinstance(payload, dict):
            return Response({'error': 'Invalid payload'}, status=400)
        return self._download_pdf_response(request, payload)

    @action(detail=True, methods=['post'], url_path='download-pdf')
    def download_pdf_detail(self, request, pk=None):
        """Download PDF for a saved builder draft (optional body overrides)."""
        builder = self.get_object()
        payload = request.data if isinstance(request.data, dict) else {}
        merged = self.get_serializer(builder).data
        merged.update({k: v for k, v in payload.items() if v is not None})
        if builder.id and not merged.get('id'):
            merged['id'] = str(builder.id)
        return self._download_pdf_response(request, merged)

    @action(detail=True, methods=['post'])
    def generate_offer(self, request, pk=None):
        """
        Generate a final Offer instance from builder data, 
        create PDF, and send email.
        """
        from django.db import IntegrityError
        from decimal import Decimal, InvalidOperation
        import traceback
        
        try:
            builder_data = self.get_object()
            print(f"[OFFER GENERATE] Starting for builder_id: {pk}")
            
            # 1. Map builder data to a new Offer instance
            from apps.hr.models import Offer, Candidate, JobOpening
            
            candidate = builder_data.candidate
            if not candidate:
                print(f"[OFFER GENERATE] ERROR: No candidate found for builder {pk}")
                return Response({'error': 'This draft is not linked to a candidate. Please edit it and ensure a candidate is selected.'}, status=400)
            
            print(f"[OFFER GENERATE] Found candidate: {candidate.name} (ID: {candidate.id})")
            
            # Snapshot current data into an Offer model
            offer = Offer.objects.filter(candidate=candidate, status__in=['draft', 'created', 'sent']).first()
            if not offer:
                print(f"[OFFER GENERATE] Creating new Offer instance")
                offer = Offer(candidate=candidate)
            else:
                print(f"[OFFER GENERATE] Updating existing Offer instance: {offer.id}")
                
            offer.job = candidate.job_opening
            if not offer.job:
                # Fallback if candidate has no job linked (shouldn't happen usually)
                print(f"[OFFER GENERATE] WARNING: Candidate has no job_opening linked")
            
            offer.candidate_name = builder_data.candidate_name or candidate.name
            offer.candidate_email = builder_data.candidate_email or candidate.email
            offer.candidate_address = builder_data.candidate_address or candidate.address or ""
            
            # Company Info (Snapshot) — Offer model requires non-empty email/address; letter PDF uses builder fields.
            from apps.hr.organization_branding import get_hr_organization_settings

            org_settings = get_hr_organization_settings()
            offer.company_name = (
                org_settings.organization_name or builder_data.company_name or ''
            ).strip() or 'Organization'
            offer.company_address = (
                builder_data.company_address or org_settings.organization_address or ''
            ).strip() or '—'

            fallback_email = (
                org_settings.company_email or org_settings.hr_email or ''
            ).strip()
            if builder_data.company_contact:
                if '|' in builder_data.company_contact:
                    parts = builder_data.company_contact.split('|')
                    offer.company_email = parts[0].strip() or fallback_email
                    offer.company_phone = parts[1].strip() if len(parts) > 1 else ""
                else:
                    offer.company_email = builder_data.company_contact.strip() or fallback_email
                    offer.company_phone = ""
            else:
                offer.company_email = fallback_email
                offer.company_phone = (org_settings.company_phone or '').strip()
            
            # HR Snapshot
            offer.hr_name = builder_data.hr_name
            offer.hr_designation = builder_data.hr_designation
            
            # Job Snapshot
            job_title = (builder_data.job_title or '').strip()
            department = (builder_data.department or '').strip()
            job_opening = candidate.job_opening
            if job_opening and (not job_title or not department):
                if not job_title:
                    if getattr(job_opening, 'designation_id', None) and job_opening.designation:
                        job_title = job_opening.designation.name
                    else:
                        job_title = job_opening.title or ''
                if not department and getattr(job_opening, 'department_id', None):
                    department = job_opening.department.name

            offer.job_title = job_title
            offer.department = department
            offer.job_location = builder_data.job_location
            offer.work_mode = builder_data.work_mode
            
            # Date Handling
            offer.joining_date = builder_data.joining_date or date.today() + timedelta(days=7)
            expiry = builder_data.offer_expiry_date or (date.today() + timedelta(days=7))
            if expiry < date.today():
                return Response(
                    {'error': 'Last date to accept offer cannot be in the past.'},
                    status=400,
                )
            offer.offer_expiry_date = expiry
            
            # Salary Details
            def safe_decimal(val):
                if not val or str(val).strip() == '': return Decimal('0')
                try:
                    return Decimal(str(val).replace(',', ''))
                except (InvalidOperation, ValueError):
                    return Decimal('0')

            offer.ctc = safe_decimal(builder_data.ctc)
            offer.basic_salary = safe_decimal(builder_data.basic_salary)
            offer.hra = safe_decimal(builder_data.hra)
            offer.allowances = safe_decimal(builder_data.special_allowance)
            offer.bonus = safe_decimal(builder_data.bonus)
                
            # Work Details
            offer.work_shift = builder_data.shift
            offer.working_hours = builder_data.working_hours
            offer.weekly_off = builder_data.weekly_off
            offer.probation_period = builder_data.probation_period
            offer.notice_period = builder_data.notice_period
            
            # Control
            import uuid
            offer.status = 'created'
            if not offer.token:
                offer.token = str(uuid.uuid4())
            
            # 2. Render HTML via shared offer letter renderer (preview = PDF)
            from apps.hr.utils.offer_letter_renderer import render_offer_letter_html

            from apps.hr.utils.offer_letter_renderer import _resolve_hospital_id_from_builder

            hospital_id = _resolve_hospital_id_from_builder(builder_data)
            html_content = render_offer_letter_html(
                builder_data, request=request, hospital_id=hospital_id,
            )
            offer.edited_html = html_content
            
            try:
                offer.save()
                print(f"[OFFER GENERATE] Offer saved successfully: {offer.id}")
            except IntegrityError as ie:
                print(f"[OFFER GENERATE] Integrity Error: {ie}")
                return Response({'error': 'An active offer already exists for this candidate. Please revoke it before sending a new one.'}, status=400)
            
            # 3. Generate PDF using xhtml2pdf (robust for Windows)
            from apps.hr.utils.pdf_generator import generate_offer_pdf
            pdf_success = generate_offer_pdf(offer)
            
            if not pdf_success:
                print(f"[OFFER GENERATE] PDF generation failed for offer {offer.id}")
                return Response({'error': 'Failed to generate PDF letter. Please contact admin.'}, status=500)
            
            # Refresh to get updated PDF field
            offer.refresh_from_db()
            print(f"[OFFER GENERATE] PDF saved successfully: {offer.pdf.name}")
                
            from apps.hr.recruitment_email_dispatcher import EmailEventDispatcher

            base_url = request.build_absolute_uri('/')
            email_success = EmailEventDispatcher.offer_sent(
                offer,
                base_url=base_url,
                sync=True,
                on_commit=False,
            )
            
            if not email_success:
                print(f"[OFFER GENERATE] Email failed for offer {offer.id}")
                return Response({'error': 'Failed to send email. Please check your SMTP settings.'}, status=500)
                
            # 5. Update Statuses
            from django.utils import timezone
            from django.db import transaction

            offer_pk = offer.pk
            with transaction.atomic():
                locked = Offer.objects.select_for_update().get(pk=offer_pk)
                if locked.status == 'sent':
                    logger.warning('[OFFER GENERATE] concurrent send offer=%s', offer_pk)
                    return Response(
                        {'error': 'Offer was already sent by another request.'},
                        status=409,
                    )
                locked.status = 'sent'
                locked.save(update_fields=['status', 'updated_at'])
                candidate = locked.candidate
                candidate.offer_status = 'sent'
                candidate.save(update_fields=['offer_status', 'updated_at'])

            builder_data.is_sent = True
            builder_data.sent_at = timezone.now()
            builder_data.save()

            logger.info('[OFFER GENERATE] Success for offer %s', offer_pk)
            return Response({
                'success': True, 
                'message': 'Offer generated and sent successfully',
                'offer_id': offer.id
            })
        except Exception as e:
            print(f"[OFFER GENERATE] Unexpected Error: {e}")
            traceback.print_exc()
            return Response({'error': f'An unexpected error occurred: {str(e)}'}, status=500)


class OfferTemplateViewSet(HRBaseViewSet):
    queryset = OfferTemplate.objects.all()
    serializer_class = OfferTemplateSerializer

    def list(self, request, *args, **kwargs):
        queryset = self.get_queryset()
        serializer = self.get_serializer(queryset, many=True)
        return Response(serializer.data)

    def _normalize_layout_config(self, data):
        payload = data.copy()
        layout_config = payload.get('layout_config')
        if isinstance(layout_config, str):
            try:
                payload['layout_config'] = json.loads(layout_config)
            except json.JSONDecodeError:
                payload['layout_config'] = {}
        return payload

    def create(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=self._normalize_layout_config(request.data))
        serializer.is_valid(raise_exception=True)
        self.perform_create(serializer)
        return Response(serializer.data, status=201)

    def update(self, request, *args, **kwargs):
        partial = kwargs.pop('partial', False)
        instance = self.get_object()
        serializer = self.get_serializer(instance, data=self._normalize_layout_config(request.data), partial=partial)
        serializer.is_valid(raise_exception=True)
        self.perform_update(serializer)
        return Response(serializer.data)


class ComponentOfferTemplateViewSet(HRBaseViewSet):
    queryset = ComponentOfferTemplate.objects.all()
    serializer_class = ComponentOfferTemplateSerializer

    @action(detail=False, methods=['post'])
    def render_preview(self, request):
        """Render a preview of the component template."""
        from apps.hr.utils.component_renderer import render_offer_template
        
        design_json = request.data
        
        # Mock context
        context = {
            "company_name": "Curevice Pvt Ltd",
            "candidate_name": "John Doe",
            "job_title": "Software Engineer",
            "job_location": "Delhi",
            "joining_date": "10 May 2026",
            "ctc": "6,00,000",
            "hr_name": "Jane Smith"
        }
        
        html = render_offer_template(design_json, context)
        return Response({'html': html})


class OfferLetterSettingsViewSet(viewsets.ModelViewSet):
    serializer_class = OfferLetterSettingsSerializer
    permission_classes = [permissions.IsAuthenticated, IsHRStaffUser]
    parser_classes = [parsers.MultiPartParser, parsers.FormParser, parsers.JSONParser]

    def get_queryset(self):
        qs = OfferLetterSettings.objects.select_related('hospital').all()
        user = self.request.user
        if getattr(user, 'hospital_id', None):
            qs = qs.filter(hospital_id=user.hospital_id)
        return qs

    def _current_settings(self):
        from apps.hr.hospital_context import resolve_hr_hospital

        hospital = resolve_hr_hospital(self.request)
        hospital_id = hospital.id if hospital else None
        settings_obj, _ = OfferLetterSettings.objects.get_or_create(hospital_id=hospital_id)
        return settings_obj

    @staticmethod
    def _coerce_settings_multipart_fields(data, settings_obj):
        """Multipart form sends JSON fields as invalid strings — keep existing values when unparsable."""
        import json

        if hasattr(data, 'dict'):
            cleaned = data.dict()
        else:
            cleaned = dict(data)

        if not cleaned.get('hospital'):
            cleaned.pop('hospital', None)

        json_fields = {
            'default_terms_conditions': list,
            'logo_config': dict,
            'signature_config': dict,
        }
        for field_name, expected_type in json_fields.items():
            if field_name not in cleaned:
                continue
            raw = cleaned.pop(field_name)
            if raw in (None, ''):
                continue
            if isinstance(raw, (list, dict)):
                cleaned[field_name] = raw
                continue
            try:
                parsed = json.loads(raw)
            except (TypeError, json.JSONDecodeError):
                continue
            if isinstance(parsed, expected_type):
                cleaned[field_name] = parsed
        return cleaned

    @action(detail=False, methods=['get', 'patch', 'post'])
    def current(self, request):
        settings_obj = self._current_settings()
        if request.method == 'GET':
            return Response(self.get_serializer(settings_obj).data)

        data = request.data.copy()
        if hasattr(data, 'dict'):
            data = data.dict()
        for drop_key in ('logo_url', 'signature_url', 'id', 'created_at', 'updated_at'):
            data.pop(drop_key, None)
        if data.get('clear_logo') in {'true', '1', True}:
            settings_obj.logo.delete(save=False)
            data.pop('logo', None)
        if data.get('clear_signature') in {'true', '1', True}:
            settings_obj.signature.delete(save=False)
            data.pop('signature', None)
        data = self._coerce_settings_multipart_fields(data, settings_obj)
        serializer = self.get_serializer(settings_obj, data=data, partial=True)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        logger.info('[OfferSettings] saved settings=%s by=%s', settings_obj.id, getattr(request.user, 'id', None))
        return Response(serializer.data)

    @action(detail=False, methods=['get'], url_path='current/branding-variables')
    def branding_variables(self, request):
        from apps.hr.organization_branding import BRANDING_TEMPLATE_KEYS, build_branding_context

        settings_obj = self._current_settings()
        return Response({
            'keys': list(BRANDING_TEMPLATE_KEYS),
            'variables': build_branding_context(settings_obj, request=request),
        })


class OfferViewSet(HRBaseViewSet):
    queryset = Offer.objects.all()
    serializer_class = OfferSerializer

    def get_queryset(self):
        qs = Offer.objects.select_related('candidate', 'job', 'candidate__job_opening').order_by('-created_at')
        user = self.request.user
        hospital_id = getattr(user, 'hospital_id', None)
        if hospital_id:
            qs = qs.filter(candidate__job_opening__hospital_id=hospital_id)
        job_opening = (self.request.query_params.get('job_opening') or '').strip()
        if job_opening:
            qs = qs.filter(
                models.Q(job_id=job_opening) | models.Q(candidate__job_opening_id=job_opening),
            )
        return qs

    def _sanitize_editor_html(self, raw_html):
        if not raw_html:
            return ''

        cleaned = re.sub(r'<\s*script[^>]*>.*?<\s*/\s*script\s*>', '', raw_html, flags=re.I | re.S)
        cleaned = re.sub(r'on\w+="[^"]*"', '', cleaned, flags=re.I)
        cleaned = re.sub(r"on\w+='[^']*'", '', cleaned, flags=re.I)
        cleaned = re.sub(r'javascript:', '', cleaned, flags=re.I)
        return cleaned.strip()

    def _build_offer_editor_html(self, candidate, template, joining_date):
        template_html = template.content or (
            "<h2>Offer Letter</h2>"
            "<p>Dear {candidate_name},</p>"
            "<p>We are pleased to offer you the role of <strong>{job_title}</strong> at <strong>{company_name}</strong>.</p>"
            "<p><strong>Date of Joining:</strong> {joining_date}</p>"
        )
        from apps.hr.organization_branding import merge_branding_into_context, resolve_hospital_id

        hospital_id = resolve_hospital_id(candidate=candidate)
        replacements = merge_branding_into_context({
            'candidate_name': candidate.name or '',
            'job_title': template.job_title or '',
            'company_name': template.company_name or '',
            'joining_date': joining_date.strftime('%B %d, %Y') if joining_date else '',
            'job_location': template.job_location or '',
            'department': template.department or '',
            'company_address': template.company_address or '',
            'hr_name': template.hr_name or '',
            'hr_designation': template.hr_designation or '',
        }, hospital_id=hospital_id, request=self.request)
        rendered = template_html
        for key, value in replacements.items():
            rendered = rendered.replace(f'{{{key}}}', str(value))
        return rendered

    @action(detail=True, methods=['get'])
    def preview(self, request, pk=None):
        """
        Preview an offer - returns rendered HTML for preview.
        HR can view the offer before sending email.
        """
        try:
            from django.template.loader import render_to_string
            
            offer = self.get_object()
            print(f"[OFFER PREVIEW] Previewing offer {offer.id}")
            
            # Render edited HTML first (WYSIWYG), fallback to Django template.
            if offer.edited_html:
                html_content = offer.edited_html
            else:
                html_content = render_to_string(
                    'hr/offers/offer_letter.html',
                    {'offer': offer}
                )
            
            template_layout = {}
            if offer.template and getattr(offer.template, 'layout_config', None):
                template_layout = offer.template.layout_config or {}

            return Response({
                'success': True,
                'offer_id': str(offer.id),
                'html': html_content,
                'layout_config': offer.edited_layout_config or template_layout,
                'company_logo_url': offer.company_logo.url if offer.company_logo else None,
                'pdf_url': offer.pdf.url if offer.pdf else None
            })
            
        except Exception as e:
            print(f"[OFFER PREVIEW] Error: {e}")
            import traceback
            traceback.print_exc()
            return Response({
                'success': False,
                'error': str(e)
            }, status=400)

    @action(detail=True, methods=['post'])
    def update_preview_content(self, request, pk=None):
        """
        Save in-preview editor changes before sending the offer.
        """
        offer = self.get_object()
        html = self._sanitize_editor_html(request.data.get('html', ''))
        layout_config = request.data.get('layout_config')
        if isinstance(layout_config, str):
            try:
                layout_config = json.loads(layout_config)
            except json.JSONDecodeError:
                layout_config = {}

        offer.edited_html = html
        offer.edited_layout_config = layout_config or {}
        offer.save(update_fields=['edited_html', 'edited_layout_config', 'updated_at'])

        return Response({
            'success': True,
            'message': 'Preview changes saved',
        })

    @action(detail=True, methods=['post'])
    def send(self, request, pk=None):
        """
        Send offer email after preview.
        Generates PDF and sends email.
        """
        try:
            from django.db import transaction

            self.get_object()
            offer_pk = self.kwargs.get('pk') or pk

            with transaction.atomic():
                offer = Offer.objects.select_for_update().get(pk=offer_pk)
                logger.info('[OFFER SEND] offer=%s current_status=%s', offer.id, offer.status)
                if offer.status == 'sent':
                    return Response({
                        'success': False,
                        'error': 'Offer has already been sent',
                    }, status=400)

            offer_id = offer.pk

            from apps.hr.utils.pdf_generator import generate_offer_pdf
            pdf_result = generate_offer_pdf(offer)
            if not pdf_result:
                return Response({
                    'success': False,
                    'error': 'Failed to generate PDF',
                }, status=500)

            offer.refresh_from_db()

            from apps.hr.recruitment_email_dispatcher import EmailEventDispatcher

            base_url = request.build_absolute_uri('/').rstrip('/')
            email_result = EmailEventDispatcher.offer_sent(
                offer,
                base_url=base_url,
                sync=True,
                on_commit=False,
            )
            if not email_result:
                return Response({
                    'success': False,
                    'error': 'Failed to send email',
                }, status=500)

            with transaction.atomic():
                offer = Offer.objects.select_for_update().get(pk=offer_id)
                if offer.status == 'sent':
                    logger.warning('[OFFER SEND] concurrent send detected offer=%s', offer_id)
                    return Response({
                        'success': False,
                        'error': 'Offer was already sent by another request.',
                    }, status=409)
                offer.status = 'sent'
                offer.save(update_fields=['status', 'updated_at'])
                candidate = offer.candidate
                candidate.offer_status = 'sent'
                candidate.save(update_fields=['offer_status', 'updated_at'])

            logger.info('[OFFER SEND] completed offer=%s', offer_id)

            return Response({
                'success': True,
                'message': 'Offer sent successfully',
            })

        except Exception as e:
            logger.exception('[OFFER SEND] error offer=%s', pk)
            return Response({
                'success': False,
                'error': str(e),
            }, status=500)
    @action(detail=True, methods=['post'])
    def revoke(self, request, pk=None):
        """
        Revoke a sent offer.
        """
        try:
            offer = self.get_object()
            if offer.status != 'sent':
                return Response({
                    'success': False,
                    'error': f'Cannot revoke offer with status: {offer.status}. Only sent offers can be revoked.'
                }, status=400)
            
            # Update offer status to draft (or we could delete it, but draft is safer)
            offer.status = 'draft'
            offer.save()
            
            # Update candidate status back to pending
            candidate = offer.candidate
            candidate.offer_status = 'pending'
            candidate.save()
            
            # Send revocation email
            try:
                from apps.hr.email_utils import send_offer_revocation_email
                send_offer_revocation_email(offer)
                print(f"[revoke] Revocation email queued for {candidate.email}")
            except Exception as e:
                print(f"[revoke] Failed to queue revocation email: {e}")
            
            return Response({
                'success': True,
                'message': 'Offer revoked successfully'
            })
        except Exception as e:
            return Response({
                'success': False,
                'error': str(e)
            }, status=500)
    @action(detail=False, methods=['post'])
    def create_offer(self, request):
        """
        Create an offer for a selected candidate using a template.
        Copies all data from template and candidate into the offer as snapshots.
        """
        try:

            # Get input data
            candidate_id = request.data.get('candidate_id')
            template_id = request.data.get('template_id')
            joining_date = request.data.get('joining_date')
            offer_expiry_date = request.data.get('offer_expiry_date')
            
            # Optional salary overrides
            ctc = request.data.get('ctc')
            basic_salary = request.data.get('basic_salary')
            hra = request.data.get('hra')
            allowances = request.data.get('allowances')
            bonus = request.data.get('bonus')
            work_shift = request.data.get('work_shift')
            working_hours = request.data.get('working_hours')
            probation_period = request.data.get('probation_period')
            notice_period = request.data.get('notice_period')

            # Validation
            if not candidate_id:
                return Response({'success': False, 'error': 'candidate_id is required'}, status=400)
            if not joining_date:
                return Response({'success': False, 'error': 'joining_date is required'}, status=400)
            if not offer_expiry_date:
                return Response({'success': False, 'error': 'offer_expiry_date is required'}, status=400)
                
            component_template_id = request.data.get('component_template_id')
            if not template_id and not component_template_id:
                return Response({'success': False, 'error': 'Either template_id or component_template_id is required'}, status=400)

            # Parse dates
            try:
                joining_date_parsed = datetime.strptime(joining_date, '%Y-%m-%d').date()
                offer_expiry_date_parsed = datetime.strptime(offer_expiry_date, '%Y-%m-%d').date()
            except ValueError:
                return Response({'success': False, 'error': 'Invalid date format. Use YYYY-MM-DD'}, status=400)

            if offer_expiry_date_parsed < date.today():
                return Response({
                    'success': False,
                    'error': 'Last date to accept offer cannot be in the past.',
                }, status=400)

            # Fetch candidate
            try:
                candidate = Candidate.objects.get(id=candidate_id)
            except Candidate.DoesNotExist:
                return Response({'success': False, 'error': 'Candidate not found'}, status=404)

            # Validate candidate status
            if candidate.status != 'selected':
                return Response({
                    'success': False,
                    'error': f'Cannot create offer for candidate with status: {candidate.status}. Must be selected first.'
                }, status=400)

            # Check for existing active offer
            existing_active_offer = Offer.objects.filter(
                candidate=candidate,
                status__in=['sent', 'accepted']
            ).first()
            
            if existing_active_offer:
                return Response({
                    'success': False,
                    'error': f'An active offer already exists (Status: {existing_active_offer.status}). Please revoke it first if you wish to create a new one.'
                }, status=400)

            # Clean up any existing created/draft/rejected offers to avoid duplicates
            Offer.objects.filter(
                candidate=candidate,
                status__in=['created', 'draft', 'rejected']
            ).delete()

            if component_template_id:
                try:
                    component_template = ComponentOfferTemplate.objects.get(id=component_template_id)
                except ComponentOfferTemplate.DoesNotExist:
                    return Response({'success': False, 'error': 'Component template not found'}, status=404)

                from apps.hr import offer_generation as offer_gen

                offer = offer_gen.create_offer_from_component_template(
                    candidate,
                    component_template,
                    joining_date=joining_date_parsed,
                    offer_expiry_date=offer_expiry_date_parsed,
                    ctc=ctc,
                    basic_salary=basic_salary,
                    hra=hra,
                    allowances=allowances,
                    bonus=bonus,
                    work_shift=work_shift,
                    working_hours=working_hours,
                    probation_period=probation_period,
                    notice_period=notice_period,
                )

                serializer = self.get_serializer(offer)
                return Response(
                    {
                        'success': True,
                        'offer_id': str(offer.id),
                        'message': 'Offer created successfully. Please preview and send.',
                        'offer': serializer.data,
                        'pdf_url': offer.pdf.url if offer.pdf else None,
                        'template_used': 'component',
                    },
                    status=201,
                )

            # Existing flow
            try:
                template = OfferTemplate.objects.get(id=template_id)
            except OfferTemplate.DoesNotExist:
                return Response({'success': False, 'error': 'Template not found'}, status=404)

            # Parse dates
            try:
                joining_date_parsed = datetime.strptime(joining_date, '%Y-%m-%d').date()
                offer_expiry_date_parsed = datetime.strptime(offer_expiry_date, '%Y-%m-%d').date()
            except ValueError:
                return Response({'success': False, 'error': 'Invalid date format. Use YYYY-MM-DD'}, status=400)

            # Create offer with data from template (use overrides if provided)
            offer = Offer.objects.create(
                candidate=candidate,
                job=candidate.job_opening,
                template=template,
                
                # Candidate Snapshot
                candidate_name=candidate.name,
                candidate_email=candidate.email,
                candidate_address=candidate.address or '',
                
                # Company Snapshot
                company_name=template.company_name,
                company_address=template.company_address,
                company_email=template.company_email,
                company_phone=template.company_phone,
                company_logo=template.company_logo,
                
                # HR Signature Snapshot
                hr_name=template.hr_name,
                hr_designation=template.hr_designation,
                hr_signature=template.hr_signature,
                
                # Job Snapshot
                job_title=template.job_title,
                department=template.department,
                job_location=template.job_location,
                employment_type=template.employment_type,
                
                # Salary Details (use overrides if provided, else template defaults)
                ctc=Decimal(ctc) if ctc else (template.default_ctc or Decimal('0')),
                basic_salary=Decimal(basic_salary) if basic_salary else template.default_basic_salary,
                hra=Decimal(hra) if hra else template.default_hra,
                allowances=Decimal(allowances) if allowances else template.default_allowances,
                bonus=Decimal(bonus) if bonus else template.default_bonus,
                
                # Work Details
                joining_date=joining_date_parsed,
                work_shift=work_shift or template.default_work_shift,
                working_hours=working_hours or template.default_working_hours,
                weekly_off=template.default_weekly_off,
                
                # Policies
                probation_period=probation_period or template.default_probation_period,
                notice_period=notice_period or template.default_notice_period,
                terms_conditions=template.terms_conditions,
                responsibilities=template.responsibilities,  # Added missing responsibilities snapshot
                edited_layout_config=template.layout_config or {},
                edited_html=self._build_offer_editor_html(candidate, template, joining_date_parsed),
                
                # Offer Control
                offer_expiry_date=offer_expiry_date_parsed,
                status='created'
            )

            # Serialize and return
            serializer = self.get_serializer(offer)

            # Generate PDF after offer creation (for preview)
            try:
                from apps.hr.utils.pdf_generator import generate_offer_pdf
                pdf_result = generate_offer_pdf(offer)
                if pdf_result:
                    # Refresh offer object to get the PDF field
                    offer.refresh_from_db()
                else:
                    print(f"[Offer Creation] PDF generation failed for offer {offer.id}")
            except Exception as e:
                print(f"[Offer Creation] Error generating PDF: {e}")
                import traceback
                traceback.print_exc()

            # NOTE: Email is NOT sent automatically anymore
            # HR must preview and manually send using the /send/ endpoint
            print(f"[Offer Creation] Offer created with status 'created' - awaiting preview and send")

            return Response({
                'success': True,
                'offer_id': str(offer.id),
                'message': 'Offer created successfully. Please preview before sending.',
                'offer': serializer.data
            }, status=201)

        except Exception as e:
            return Response({
                'success': False,
                'error': str(e)
            }, status=400)


def accept_offer_view(request, token):
    """
    Handle offer acceptance via token link.
    No login required - token-based authentication.
    Idempotent: already-accepted offers return the success page without re-running conversion.
    """
    from django.shortcuts import render
    from django.http import HttpResponse
    from django.db import transaction

    from apps.hr.onboarding_documents import get_employee_for_offer

    employee = None

    try:
        with transaction.atomic():
            try:
                offer = Offer.objects.select_for_update().select_related('candidate').get(token=token)
            except Offer.DoesNotExist:
                logger.warning('[OFFER ACCEPT] invalid token=%s', token)
                return HttpResponse('Invalid or expired offer link')

            if offer.status == 'rejected':
                return HttpResponse('Offer already rejected')

            if offer.status == 'accepted':
                employee = get_employee_for_offer(offer)
                if not employee and offer.candidate and offer.candidate.email:
                    employee = Employee.objects.filter(email__iexact=offer.candidate.email).first()
                logger.info(
                    '[OFFER ACCEPT] already accepted offer=%s employee=%s',
                    offer.id,
                    getattr(employee, 'employee_id', None),
                )
                return render(
                    request,
                    'hr/offers/offer_accepted.html',
                    {'offer': offer, 'employee': employee},
                )

            if offer.offer_expiry_date < date.today():
                logger.info('[OFFER ACCEPT] expired offer=%s', offer.id)
                return HttpResponse('Offer expired')

            offer.status = 'accepted'
            offer.save(update_fields=['status', 'updated_at'])

            candidate = offer.candidate
            employee, conversion_error = convert_hired_candidate_to_employee(candidate)
            if conversion_error:
                logger.warning(
                    '[OFFER ACCEPT] conversion issue offer=%s candidate=%s detail=%s',
                    offer.id,
                    candidate.id,
                    conversion_error,
                )

            candidate.status = 'hired'
            candidate.offer_status = 'accepted'
            candidate.save(update_fields=['status', 'offer_status', 'updated_at'])

            logger.info(
                '[OFFER ACCEPT] accepted offer=%s candidate=%s employee=%s',
                offer.id,
                candidate.id,
                getattr(employee, 'employee_id', None) if employee else None,
            )

        return render(
            request,
            'hr/offers/offer_accepted.html',
            {'offer': offer, 'employee': employee},
        )

    except Offer.DoesNotExist:
        return render(
            request,
            'hr/offers/offer_not_found.html',
            {'token': token},
        )
    except Exception as e:
        logger.exception('[OFFER ACCEPT] failed token=%s err=%s', token, e)
        return HttpResponse(
            f"""
        <html>
        <body style="font-family: Arial; padding: 40px; text-align: center;">
            <h1>Error</h1>
            <p>An error occurred: {str(e)}</p>
        </body>
        </html>
        """
        )


def reject_offer_view(request, token):
    """
    Handle offer rejection via token link.
    No login required - token-based authentication.
    """
    from django.shortcuts import render
    from django.http import HttpResponse
    from datetime import date
    
    try:
        print(f"[OFFER REJECT] ==========================================")
        print(f"[OFFER REJECT] Starting reject process for token: {token}")
        
        # Find offer by token
        offer = Offer.objects.get(token=token)
        print(f"[OFFER REJECT] Found offer: {offer.id}")
        print(f"[OFFER REJECT] Candidate: {offer.candidate_name}")
        print(f"[OFFER REJECT] Job Title: {offer.job_title}")
        print(f"[OFFER REJECT] Current Status: {offer.status}")
        
        # Check if already processed
        if offer.status in ['accepted', 'rejected']:
            print(f"[OFFER REJECT] Offer already processed: {offer.status}")
            return render(request, 'hr/offers/offer_already_processed.html', {
                'offer': offer,
                'message': f"This offer has already been {offer.status}."
            })
        
        # Check if expired
        if offer.offer_expiry_date < date.today():
            print(f"[OFFER REJECT] Offer expired: {offer.offer_expiry_date}")
            return render(request, 'hr/offers/offer_expired.html', {
                'offer': offer
            })
        
        # Reject the offer
        offer.status = 'rejected'
        offer.save()
        print(f"[OFFER REJECT] Offer status updated to: rejected")
        
        # Update candidate status
        candidate = offer.candidate
        candidate.status = 'rejected'
        candidate.offer_status = 'rejected'
        candidate.save()
        print(f"[OFFER REJECT] Candidate status updated to: rejected")

        from apps.hr.recruitment_email_dispatcher import EmailEventDispatcher
        EmailEventDispatcher.rejected(
            candidate,
            rejection_from_status='selected',
            on_commit=False,
        )

        print(f"[OFFER REJECT] Offer {offer.id} rejected by {offer.candidate_name}")
        print(f"[OFFER REJECT] ==========================================")
        
        return render(request, 'hr/offers/offer_rejected.html', {
            'offer': offer
        })
        
    except Offer.DoesNotExist:
        print(f"[OFFER REJECT] Offer not found for token: {token}")
        return render(request, 'hr/offers/offer_not_found.html', {
            'token': token
        })
    except Exception as e:
        print(f"[OFFER REJECT] Error: {e}")
        import traceback
        traceback.print_exc()
        # Return simple HTML error if template fails
        return HttpResponse(f"""
        <html>
        <body style="font-family: Arial; padding: 40px; text-align: center;">
            <h1>Error</h1>
            <p>An error occurred: {str(e)}</p>
        </body>
        </html>
        """)




class EmployeeDocumentViewSet(HRBaseViewSet):
    """
    API endpoint for employee document management.
    - Employees can upload their own documents
    - HR can verify/reject documents
    """
    serializer_class = EmployeeDocumentRequirementSerializer
    queryset = EmployeeDocumentRequirement.objects.select_related('document_type', 'employee', 'verified_by').all()
    
    def get_queryset(self):
        user = self.request.user
        if user.is_superuser or user.is_staff:
            qs = super().get_queryset().exclude(employee__candidate__status='rejected')
            return qs
        from apps.shared.email_normalization import normalize_email_address
        employee = Employee.objects.filter(
            email__iexact=normalize_email_address(user.email),
        ).first()
        if not employee:
            return EmployeeDocumentRequirement.objects.none()
        return sync_employee_requirements(employee)

    def _serve_document_file(self, request, document, attachment=False):
        from django.core.files.storage import default_storage

        if not document.uploaded_file or not default_storage.exists(document.uploaded_file.name):
            raise NotFound('Document file is unavailable.')

        if not is_hr_reviewer(request.user):
            from apps.shared.email_normalization import normalize_email_address
            employee = Employee.objects.filter(
                email__iexact=normalize_email_address(request.user.email),
            ).first()
            if not employee:
                raise PermissionDenied('You do not have access to this file.')
            if document.employee_id != employee.id:
                raise PermissionDenied('You do not have access to this file.')

        file_handle = default_storage.open(document.uploaded_file.name, 'rb')
        filename = os.path.basename(document.uploaded_file.name)
        content_type = 'application/pdf' if filename.lower().endswith('.pdf') else 'application/octet-stream'
        return FileResponse(
            file_handle,
            as_attachment=attachment,
            filename=filename,
            content_type=content_type,
        )
    
    def perform_create(self, serializer):
        raise DRFValidationError("Use the onboarding upload API for document uploads.")

    @action(detail=True, methods=['post'])
    def verify(self, request, pk=None):
        return self.approve(request, pk=pk)

    @action(detail=True, methods=['post'])
    def approve(self, request, pk=None):
        from apps.hr.document_moderation import moderate_approve

        document = self.get_object()
        try:
            result = moderate_approve(requirement=document, reviewer=request.user)
        except ValueError as exc:
            return Response({'error': str(exc)}, status=400)
        document = result['requirement']
        return Response({
            'success': True,
            'message': 'Document verified successfully.',
            'transition_id': result['transition_id'],
            'undo_available': result['undo_available'],
            'document': EmployeeDocumentRequirementSerializer(document).data,
        })
    
    @action(detail=True, methods=['post'])
    def reject(self, request, pk=None):
        document = self.get_object()
        rejection_reason = request.data.get('rejection_reason', '')
        if not str(rejection_reason).strip():
            return Response({'error': 'Rejection reason is required.'}, status=400)
        reject_document(document=document, reviewer=request.user, reason=rejection_reason)
        return Response({
            'success': True,
            'message': 'Document rejected successfully.',
            'document': EmployeeDocumentRequirementSerializer(document).data,
        })

    @action(detail=True, methods=['post'], url_path='request-reupload')
    def request_reupload(self, request, pk=None):
        from apps.hr.document_moderation import moderate_request_reupload

        document = self.get_object()
        reason = request.data.get('reason', '')
        try:
            result = moderate_request_reupload(requirement=document, reviewer=request.user, reason=reason)
        except ValueError as exc:
            return Response({'error': str(exc)}, status=400)
        document = result['requirement']
        return Response({
            'success': True,
            'message': 'Re-upload requested successfully.',
            'transition_id': result['transition_id'],
            'undo_available': result['undo_available'],
            'document': EmployeeDocumentRequirementSerializer(document).data,
        })

    @action(detail=True, methods=['post'], url_path='moderate-reject')
    def moderate_reject(self, request, pk=None):
        """Reject with mode: reupload | final"""
        from apps.hr.document_moderation import moderate_final_reject, moderate_request_reupload

        document = self.get_object()
        mode = (request.data.get('mode') or 'reupload').strip().lower()
        reason = request.data.get('reason', '')
        try:
            if mode == 'final':
                result = moderate_final_reject(
                    employee=document.employee,
                    reviewer=request.user,
                    reason=reason,
                    requirement=document,
                )
                payload = build_employee_document_review_payload(document.employee)
                return Response({
                    'success': True,
                    'message': 'Candidate rejected and notified.',
                    'transition_id': result['transition_id'],
                    'undo_available': result['undo_available'],
                    'review': payload,
                })
            result = moderate_request_reupload(requirement=document, reviewer=request.user, reason=reason)
            document = result['requirement']
            return Response({
                'success': True,
                'message': 'Re-upload requested; candidate notified.',
                'transition_id': result['transition_id'],
                'undo_available': result['undo_available'],
                'document': EmployeeDocumentRequirementSerializer(document).data,
            })
        except ValueError as exc:
            return Response({'error': str(exc)}, status=400)

    @action(detail=False, methods=['post'], url_path='bulk-moderate')
    def bulk_moderate(self, request):
        from apps.hr.document_moderation import bulk_moderate as run_bulk

        document_ids = request.data.get('document_ids') or []
        action = request.data.get('action', '')
        reason = request.data.get('reason', '')
        reject_mode = request.data.get('reject_mode')
        if not document_ids:
            return Response({'error': 'document_ids is required'}, status=400)
        results = run_bulk(
            document_ids=document_ids,
            reviewer=request.user,
            action=action,
            reason=reason,
            reject_mode=reject_mode,
        )
        return Response({'success': True, **results})

    @action(detail=False, methods=['post'], url_path='undo')
    def undo_moderation(self, request):
        from apps.hr.document_moderation import undo_transition

        transition_id = request.data.get('transition_id')
        if not transition_id:
            return Response({'error': 'transition_id is required'}, status=400)
        try:
            undo_transition(transition_id=transition_id, reviewer=request.user)
        except ValueError as exc:
            return Response({'error': str(exc)}, status=400)
        return Response({'success': True, 'message': 'Action undone successfully.'})

    @action(detail=True, methods=['post'], url_path='physical-verify')
    def physical_verify(self, request, pk=None):
        document = self.get_object()
        notes = request.data.get('notes', '')
        mark_requirement_physically_verified(requirement=document, reviewer=request.user, notes=notes)
        return Response({
            'success': True,
            'message': 'Physical verification completed.',
            'document': EmployeeDocumentRequirementSerializer(document).data,
        })

    @action(detail=True, methods=['post'], url_path='override-approve')
    def override_approve(self, request, pk=None):
        document = self.get_object()
        notes = request.data.get('notes', '')
        approve_requirement_override(requirement=document, reviewer=request.user, notes=notes)
        return Response({
            'success': True,
            'message': 'HR override approved.',
            'document': EmployeeDocumentRequirementSerializer(document).data,
        })

    @action(detail=True, methods=['get'])
    def download(self, request, pk=None):
        document = self.get_object()
        return self._serve_document_file(request, document, attachment=True)

    @action(detail=True, methods=['get'])
    def preview(self, request, pk=None):
        document = self.get_object()
        return self._serve_document_file(request, document, attachment=False)


class OnboardingDashboardViewSet(viewsets.ReadOnlyModelViewSet):
    """
    HR Dashboard for onboarding management.
    Shows pending documents, ready to join employees, etc.
    """
    permission_classes = [permissions.IsAuthenticated, IsHRStaffUser]
    
    def _filter_by_hospital(self, queryset, request):
        """Filter queryset by user's hospital if applicable."""
        user = request.user
        if hasattr(user, 'hospital_id') and user.hospital_id:
            if hasattr(queryset.model, 'hospital'):
                queryset = queryset.filter(hospital_id=user.hospital_id)
            elif hasattr(queryset.model, 'employee'):
                queryset = queryset.filter(employee__hospital_id=user.hospital_id)
        return queryset
    
    def _onboarding_action(self, *, onboarding_status: str, awaiting_review: int, reupload_pending: int) -> str:
        if onboarding_status == 'ready_to_join':
            return 'activate'
        if awaiting_review > 0:
            return 'review'
        if reupload_pending > 0:
            return 'reupload'
        if onboarding_status == 'pending_documents':
            return 'wait'
        return 'documents'

    def list(self, request):
        """Onboarding dashboard — counts and joiner rows for HR (pending_onboarding only)."""
        from apps.hr.document_moderation import exclude_rejected_applications

        job_opening = (request.query_params.get('job_opening') or '').strip()
        employee_qs = self._filter_by_hospital(Employee.objects.all(), request)
        onboarding_qs = exclude_rejected_applications(
            employee_qs.filter(status='pending_onboarding'),
        ).order_by('-created_at')
        if job_opening:
            onboarding_qs = onboarding_qs.filter(candidate__job_opening_id=job_opening)
        onboarding_ids = list(onboarding_qs.values_list('id', flat=True))

        doc_qs = self._filter_by_hospital(EmployeeDocumentRequirement.objects.all(), request)
        if onboarding_ids:
            doc_qs = doc_qs.filter(employee_id__in=onboarding_ids)
        else:
            doc_qs = doc_qs.none()

        documents_to_review = doc_qs.filter(status='uploaded').count()
        reupload_requests = doc_qs.filter(status='reupload_requested').count()

        statistics = {
            'in_onboarding': onboarding_qs.count(),
            'pending_documents': onboarding_qs.filter(onboarding_status='pending_documents').count(),
            'awaiting_review': onboarding_qs.filter(
                onboarding_status__in=['documents_uploaded', 'under_review', 'partial_documents'],
            ).count(),
            'ready_to_join': onboarding_qs.filter(onboarding_status='ready_to_join').count(),
            'documents_to_review': documents_to_review,
            'reupload_requests': reupload_requests,
        }

        review_by_employee: dict = {}
        reupload_by_employee: dict = {}
        for row in doc_qs.filter(status='uploaded').values('employee_id').annotate(count=models.Count('id')):
            review_by_employee[row['employee_id']] = row['count']
        for row in doc_qs.filter(status='reupload_requested').values('employee_id').annotate(count=models.Count('id')):
            reupload_by_employee[row['employee_id']] = row['count']

        employees = []
        for emp in onboarding_qs:
            progress = calculate_onboarding_progress(emp)
            awaiting_review = review_by_employee.get(emp.id, 0)
            reupload_pending = reupload_by_employee.get(emp.id, 0)
            employees.append({
                'id': str(emp.id),
                'name': emp.name,
                'email': emp.email or '',
                'job_title': emp.job_title or '',
                'department': emp.department or '',
                'joining_date': emp.joining_date.isoformat() if emp.joining_date else None,
                'onboarding_status': emp.onboarding_status,
                'onboarding_status_display': emp.get_onboarding_status_display(),
                'progress_percentage': progress['progress_percentage'],
                'verified_count': progress['verified_count'],
                'total_required': progress['total_required'],
                'missing_documents': progress['missing_types'],
                'documents_awaiting_review': awaiting_review,
                'reupload_pending': reupload_pending,
                'next_action': self._onboarding_action(
                    onboarding_status=emp.onboarding_status,
                    awaiting_review=awaiting_review,
                    reupload_pending=reupload_pending,
                ),
            })

        candidate_qs = Candidate.objects.select_related('job_opening')
        user = request.user
        if getattr(user, 'hospital_id', None):
            candidate_qs = candidate_qs.filter(job_opening__hospital_id=user.hospital_id)

        linked_candidate_ids = set(
            employee_qs.exclude(candidate__isnull=True).values_list('candidate_id', flat=True),
        )
        accepted_without_employee = []
        for candidate in candidate_qs.filter(
            models.Q(status='hired') | models.Q(offer_status='accepted'),
        ).exclude(status='rejected').exclude(id__in=linked_candidate_ids).order_by('-updated_at')[:20]:
            if job_opening and str(candidate.job_opening_id) != str(job_opening):
                continue
            accepted_without_employee.append({
                'id': str(candidate.id),
                'name': candidate.name,
                'email': candidate.email or '',
                'job_title': getattr(candidate.job_opening, 'title', '') or '',
            })

        return Response({
            'statistics': statistics,
            'employees': employees,
            'accepted_without_employee': accepted_without_employee,
        })


def mark_employee_joined(employee_id, hr_user=None, override_onboarding=False):
    """
    Mark employee as joined with validation and logging.
    Returns success message or error.
    """
    from datetime import date
    
    try:
        # STEP 3: FETCH EMPLOYEE SAFELY
        employee = Employee.objects.get(id=employee_id)
        print(f"[JOINING] Processing employee: {employee.employee_id} - {employee.name}")
        
        # STEP 3: CHECK IF ALREADY PROCESSED
        if employee.status in ['joined', 'active']:
            print(f"[JOINING] Employee already processed: {employee.status}")
            return {
                'success': False,
                'message': f"Employee already {employee.status}",
                'employee': employee.employee_id
            }
        
        # STEP 3: VALIDATE ONBOARDING
        if employee.onboarding_status != 'ready_to_join' and not override_onboarding:
            print(f"[JOINING] Onboarding not ready: {employee.onboarding_status}")
            return {
                'success': False,
                'message': f"Onboarding incomplete: {employee.onboarding_status}",
                'employee': employee.employee_id,
                'requires_override': True
            }
        
        if employee.onboarding_status != 'ready_to_join' and override_onboarding:
            print(f"[JOINING] HR override applied for onboarding: {employee.onboarding_status}")
        
        # STEP 4: UPDATE JOINING STATUS
        employee.status = 'joined'
        employee.joining_date_confirmed = date.today()
        employee.onboarding_status = 'joined'
        employee.save()
        
        print(f"[JOINING] Employee marked as joined: {employee.employee_id}")
        
        return {
            'success': True,
            'message': 'Employee marked as joined successfully',
            'employee': employee.employee_id,
            'joining_date': employee.joining_date_confirmed
        }
        
    except Employee.DoesNotExist:
        print(f"[JOINING] Employee not found: {employee_id}")
        return {
            'success': False,
            'message': 'Employee not found'
        }
    except Exception as e:
        print(f"[JOINING] Error: {e}")
        return {
            'success': False,
            'message': f'Error: {str(e)}'
        }


def activate_employee(employee_id, hr_user=None):
    """
    Activate employee after joining confirmation.
    This means employee is now part of company and appears in active lists.
    """
    try:
        employee = Employee.objects.get(id=employee_id)
        print(f"[ACTIVATION] Activating employee: {employee.employee_id} - {employee.name}")
        
        # Validate employee is joined
        if employee.status != 'joined':
            print(f"[ACTIVATION] Employee not joined yet: {employee.status}")
            return {
                'success': False,
                'message': f'Employee must be joined first. Current status: {employee.status}'
            }
        
        # STEP 4: ACTIVATE EMPLOYEE
        employee.status = 'active'
        employee.save()

        try:
            from apps.hr.leave_services import ensure_employee_leave_balances

            ensure_employee_leave_balances(employee)
        except Exception:
            logger.exception('[ACTIVATION] leave balance provisioning failed employee=%s', employee.employee_id)
        
        print(f"[ACTIVATION] Employee activated: {employee.employee_id}")
        
        return {
            'success': True,
            'message': 'Employee activated successfully',
            'employee': employee.employee_id,
            'status': employee.status
        }
        
    except Employee.DoesNotExist:
        print(f"[ACTIVATION] Employee not found: {employee_id}")
        return {
            'success': False,
            'message': 'Employee not found'
        }
    except Exception as e:
        print(f"[ACTIVATION] Error: {e}")
        return {
            'success': False,
            'message': f'Error: {str(e)}'
        }


def mark_no_show(employee_id, hr_user=None, reason="No Show"):
    """
    Mark employee as no-show - handles failed joining.
    """
    try:
        employee = Employee.objects.get(id=employee_id)
        print(f"[NO SHOW] Processing employee: {employee.employee_id} - {employee.name}")
        
        # STEP 5: HANDLE NO-SHOW CASE
        employee.status = 'inactive'
        employee.onboarding_status = 'not_joined'
        employee.save()
        
        print(f"[NO SHOW] Employee marked as no-show: {employee.employee_id}")
        print(f"[NO SHOW] Reason: {reason}")
        
        return {
            'success': True,
            'message': 'Employee marked as no-show',
            'employee': employee.employee_id,
            'reason': reason
        }
        
    except Employee.DoesNotExist:
        print(f"[NO SHOW] Employee not found: {employee_id}")
        return {
            'success': False,
            'message': 'Employee not found'
        }
    except Exception as e:
        print(f"[NO SHOW] Error: {e}")
        return {
            'success': False,
            'message': f'Error: {str(e)}'
        }


def check_delayed_joining():
    """
    STEP 7: AUTOMATION - Check for delayed joining employees.
    Should be called daily via cron or management command.
    """
    from datetime import date
    
    today = date.today()
    delayed_employees = Employee.objects.filter(
        joining_date__lt=today,
        status__in=['not_joined', 'ready_to_join']
    )
    
    delayed_count = delayed_employees.count()
    if delayed_count > 0:
        print(f"[DELAYED] Found {delayed_count} employees with delayed joining")
        
        for employee in delayed_employees:
            print(f"[DELAYED] Employee {employee.employee_id} - {employee.name}")
            print(f"[DELAYED] Expected: {employee.joining_date}, Today: {today}")
            
            # Here you could send email reminders to HR
            # For now, just log the delay
    
    return delayed_count


class EmployeeJoiningViewSet(viewsets.ViewSet):
    """
    API endpoints for employee joining and activation management.
    HR only - handles the final step of employee lifecycle.
    """
    permission_classes = [permissions.IsAuthenticated, IsHRStaffUser]
    
    def _filter_by_hospital(self, queryset, request):
        """Filter queryset by user's hospital if applicable."""
        user = request.user
        if hasattr(user, 'hospital_id') and user.hospital_id:
            if hasattr(queryset.model, 'hospital'):
                queryset = queryset.filter(hospital_id=user.hospital_id)
        return queryset
    
    def list(self, request):
        """Get employees ready for joining actions."""
        # Get employees in different joining stages
        employee_qs = self._filter_by_hospital(Employee.objects.all(), request)
        ready_to_join = employee_qs.filter(status='ready_to_join').values(
            'id', 'employee_id', 'name', 'email', 'joining_date', 'created_at'
        )
        
        joined = employee_qs.filter(status='joined').values(
            'id', 'employee_id', 'name', 'email', 'joining_date_confirmed', 'created_at'
        )
        
        delayed = employee_qs.filter(
            joining_date__lt=timezone.now().date(),
            status__in=['not_joined', 'ready_to_join']
        ).values(
            'id', 'employee_id', 'name', 'email', 'joining_date', 'created_at'
        )
        
        return Response({
            'ready_to_join': list(ready_to_join),
            'joined': list(joined),
            'delayed': list(delayed),
            'statistics': {
                'ready_to_join_count': ready_to_join.count(),
                'joined_count': joined.count(),
                'delayed_count': delayed.count()
            }
        })
    
    @action(detail=True, methods=['post'])
    def mark_joined(self, request, pk=None):
        """Mark employee as joined."""
        override_onboarding = request.data.get('override_onboarding', False)
        result = mark_employee_joined(pk, request.user, override_onboarding)
        
        if result['success']:
            return Response(result)
        else:
            return Response(result, status=400)
    
    @action(detail=True, methods=['post'])
    def activate(self, request, pk=None):
        """Activate employee (final step)."""
        result = activate_employee(pk, request.user)
        
        if result['success']:
            return Response(result)
        else:
            return Response(result, status=400)
    
    @action(detail=True, methods=['post'])
    def mark_no_show(self, request, pk=None):
        """Mark employee as no-show."""
        reason = request.data.get('reason', 'No Show')
        result = mark_no_show(pk, request.user, reason)
        
        if result['success']:
            return Response(result)
        else:
            return Response(result, status=400)
    
    @action(detail=True, methods=['post'])
    def reschedule_joining(self, request, pk=None):
        """Reschedule employee joining date."""
        try:
            employee = Employee.objects.get(id=pk)
            new_date = request.data.get('new_joining_date')
            
            if not new_date:
                return Response({'error': 'New joining date is required'}, status=400)
            
            new_date = datetime.strptime(new_date, '%Y-%m-%d').date()
            
            employee.joining_date = new_date
            employee.save()
            
            print(f"[RESCHEDULE] Employee {employee.employee_id} rescheduled to {new_date}")
            
            return Response({
                'success': True,
                'message': 'Joining date rescheduled successfully',
                'employee': employee.employee_id,
                'new_joining_date': new_date
            })
            
        except Employee.DoesNotExist:
            return Response({'error': 'Employee not found'}, status=404)
        except ValueError:
            return Response({'error': 'Invalid date format. Use YYYY-MM-DD'}, status=400)
        except Exception as e:
            return Response({'error': str(e)}, status=500)
    
    @action(detail=False, methods=['post'])
    def check_delayed(self, request):
        """Check for delayed joining employees (automation trigger)."""
        delayed_count = check_delayed_joining()
        
        return Response({
            'success': True,
            'message': f'Checked for delayed joining. Found {delayed_count} delayed employees.',
            'delayed_count': delayed_count
        })


def hr_dashboard_view(request):
    """
    Main HR Dashboard view - serves the modern dashboard UI.
    """
    from django.shortcuts import render
    
    # Check if user is authenticated and has HR permissions
    if not request.user.is_authenticated:
        return redirect('/login/')
    
    if not (request.user.is_superuser or request.user.is_staff):
        return render(request, 'hr/dashboard.html', {
            'error': 'Access denied. HR staff only.'
        })
    
    return render(request, 'hr/dashboard.html')


class HRDashboardViewSet(viewsets.ViewSet):
    """
    API endpoints for HR Dashboard data.
    Provides KPIs, pipeline data, employee lists, and activity feed.
    """
    permission_classes = [permissions.IsAuthenticated, IsHRStaffUser]
    
    def _filter_by_hospital(self, queryset, request):
        """Filter queryset by user's hospital if applicable."""
        user = request.user
        if hasattr(user, 'hospital_id') and user.hospital_id:
            if hasattr(queryset.model, 'hospital'):
                queryset = queryset.filter(hospital_id=user.hospital_id)
            elif hasattr(queryset.model, 'employee'):
                queryset = queryset.filter(employee__hospital_id=user.hospital_id)
            elif hasattr(queryset.model, 'job_opening'):
                queryset = queryset.filter(job_opening__hospital_id=user.hospital_id)
            elif hasattr(queryset.model, 'job'):
                queryset = queryset.filter(job__hospital_id=user.hospital_id)
            elif hasattr(queryset.model, 'candidate'):
                queryset = queryset.filter(candidate__job_opening__hospital_id=user.hospital_id)
        return queryset
    
    def list(self, request):
        """Get dashboard KPIs and summary data."""
        candidates_qs = self._filter_by_hospital(Candidate.objects.all(), request)
        offers_qs = self._filter_by_hospital(Offer.objects.all(), request)
        employees_qs = self._filter_by_hospital(Employee.objects.all(), request)
        interviews_qs = self._filter_by_hospital(Interview.objects.all(), request)

        # Get KPI data
        total_candidates = candidates_qs.count()
        offers_sent = offers_qs.filter(status='sent').count()
        offers_accepted = offers_qs.filter(status='accepted').count()
        active_employees = employees_qs.filter(status='active').count()
        pending_onboarding = employees_qs.filter(
            onboarding_status__in=['pending_documents', 'documents_uploaded', 'under_review']
        ).count()
        not_joined = employees_qs.filter(status='pending_onboarding').count()
        
        # Get pipeline data
        pipeline_data = {
            'applied': candidates_qs.count(),
            'interview': interviews_qs.count(),
            'selected': candidates_qs.filter(status='selected').count(),
            'offer': offers_qs.filter(status='sent').count(),
            'accepted': offers_qs.filter(status='accepted').count(),
            'joined': employees_qs.filter(status__in=['pending_onboarding', 'active']).count(),
            'active': active_employees,
        }
        
        return Response({
            'kpi': {
                'total_candidates': total_candidates,
                'offers_sent': offers_sent,
                'offers_accepted': offers_accepted,
                'active_employees': active_employees,
                'pending_onboarding': pending_onboarding,
                'not_joined': not_joined
            },
            'pipeline': pipeline_data
        })
    
    @action(detail=False, methods=['get'])
    def employees(self, request):
        """Get employee list with filtering and pagination."""
        # Get filter parameters
        status = request.query_params.get('status', '')
        department = request.query_params.get('department', '')
        date_filter = request.query_params.get('date', '')
        page = int(request.query_params.get('page', 1))
        per_page = 10
        
        # Build query
        queryset = self._filter_by_hospital(Employee.objects.all(), request)
        
        if status:
            queryset = queryset.filter(status=status)
        
        if department:
            queryset = queryset.filter(department__icontains=department)
        
        if date_filter:
            queryset = queryset.filter(joining_date=date_filter)
        
        # Pagination
        total = queryset.count()
        start = (page - 1) * per_page
        end = start + per_page
        employees = queryset[start:end]
        
        # Serialize data
        from apps.hr.designation_utils import resolve_designation_display

        employee_data = []
        for emp in employees:
            employee_data.append({
                'id': emp.id,
                'name': emp.name,
                'email': emp.email,
                'role': resolve_designation_display(emp) or 'Not Assigned',
                'status': emp.status,
                'joining_date': emp.joining_date.strftime('%Y-%m-%d') if emp.joining_date else '-',
                'department': emp.department,
                'onboarding_status': emp.onboarding_status
            })
        
        return Response({
            'employees': employee_data,
            'total': total,
            'page': page,
            'per_page': per_page,
            'total_pages': (total + per_page - 1) // per_page
        })
    
    @action(detail=False, methods=['get'], url_path='command-center-counts')
    def command_center_counts(self, request):
        """Validated aggregate counts for HR Command Center — mirrors source-page queries."""
        from apps.hr.dashboard_command_center import compute_command_center_counts
        from apps.hr.payroll_month_readiness import default_payroll_month

        month = (request.query_params.get('month') or '').strip() or default_payroll_month()
        return Response(compute_command_center_counts(user=request.user, month=month))

    @action(detail=False, methods=['get'])
    def tasks(self, request):
        """Get tasks and alerts for HR dashboard."""
        # Get pending documents
        pending_docs = Employee.objects.filter(
            onboarding_status__in=['pending_documents', 'documents_uploaded']
        ).count()
        
        # Get offers expiring soon (next 7 days)
        from datetime import date, timedelta
        next_week = date.today() + timedelta(days=7)
        expiring_offers = Offer.objects.filter(
            status='sent',
            offer_expiry_date__lte=next_week,
            offer_expiry_date__gte=date.today()
        ).count()
        
        # Get no response candidates (offers sent > 7 days ago, no response)
        week_ago = date.today() - timedelta(days=7)
        no_response = Offer.objects.filter(
            status='sent',
            created_at__date__lte=week_ago
        ).count()
        
        return Response({
            'pending_documents': {
                'count': pending_docs,
                'priority': 'high',
                'description': f'{pending_docs} employees need document verification'
            },
            'offers_expiring': {
                'count': expiring_offers,
                'priority': 'medium',
                'description': f'{expiring_offers} offers expire in 7 days'
            },
            'no_response': {
                'count': no_response,
                'priority': 'low',
                'description': f'{no_response} candidates haven\'t responded'
            },
            'email_failures': {
                'count': 0,  # Would integrate with email system
                'priority': 'high',
                'description': '0 email delivery failures'
            }
        })
    
    @action(detail=False, methods=['get'])
    def activity(self, request):
        """Get recent activity feed."""
        activities = []
        
        # Get recent offers sent
        recent_offers = Offer.objects.filter(
            status='sent'
        ).order_by('-created_at')[:5]
        
        for offer in recent_offers:
            activities.append({
                'icon': 'fa-envelope',
                'color': '#2563eb',
                'text': f'Offer sent to {offer.candidate_name}',
                'time': self._get_time_ago(offer.created_at)
            })
        
        # Get recent offer acceptances
        recent_accepted = Offer.objects.filter(
            status='accepted'
        ).order_by('-updated_at')[:3]
        
        for offer in recent_accepted:
            activities.append({
                'icon': 'fa-check-circle',
                'color': '#10b981',
                'text': f'Offer accepted by {offer.candidate_name}',
                'time': self._get_time_ago(offer.updated_at)
            })
        
        # Get recent employee activations
        recent_active = Employee.objects.filter(
            status='active'
        ).order_by('-updated_at')[:2]
        
        for emp in recent_active:
            activities.append({
                'icon': 'fa-user-check',
                'color': '#6366f1',
                'text': f'{emp.name} marked as active',
                'time': self._get_time_ago(emp.updated_at)
            })
        
        # Sort by time
        activities.sort(key=lambda x: x['time'], reverse=True)
        
        return Response({
            'activities': activities[:10]  # Return latest 10 activities
        })
    
    def _get_time_ago(self, datetime_obj):
        """Helper method to get time ago string."""
        from django.utils import timezone
        import datetime
        
        if not datetime_obj:
            return 'Unknown time'
        
        now = timezone.now()
        diff = now - datetime_obj
        
        if diff.days > 0:
            return f'{diff.days} days ago'
        elif diff.seconds > 3600:
            hours = diff.seconds // 3600
            return f'{hours} hours ago'
        elif diff.seconds > 60:
            minutes = diff.seconds // 60
            return f'{minutes} minutes ago'
        else:
            return 'Just now'


def onboarding_document_upload_view(request, token):
    """
    Token-based document upload view for candidates.
    No authentication required - token validates access.
    """
    from django.shortcuts import render
    from django.utils.text import slugify
    import json

    # Validate token and get offer/candidate info
    try:
        offer = Offer.objects.get(token=token, status='accepted')
        candidate = offer.candidate
    except Offer.DoesNotExist:
        return render(request, 'hr/onboarding/invalid_token.html', status=404)
    
    # Completed — unless HR has asked for new document(s) (re-upload flow)
    if hasattr(offer, 'onboarding_completed') and offer.onboarding_completed:
        if not candidate_may_access_onboarding_portal(offer):
            return render(request, 'hr/onboarding/completed.html', {
                'candidate_name': candidate.name,
                'job_title': offer.job_title
            })

    if getattr(offer, 'onboarding_token_expired', False):
        return render(request, 'hr/onboarding/invalid_token.html', status=403)

    default_documents = [
        {'type': 'aadhaar', 'label': 'Aadhaar Card', 'required': True, 'slug': 'aadhaar', 'requires_upload': True, 'verification_mode': 'upload'},
        {'type': 'pan', 'label': 'PAN Card', 'required': True, 'slug': 'pan', 'requires_upload': True, 'verification_mode': 'upload'},
        {'type': 'resume', 'label': 'Resume', 'required': True, 'slug': 'resume', 'requires_upload': True, 'verification_mode': 'upload'},
        {'type': 'degree', 'label': 'Degree Certificate', 'required': True, 'slug': 'degree', 'requires_upload': True, 'verification_mode': 'upload'},
        {'type': 'bank', 'label': 'Bank Details', 'required': True, 'slug': 'bank', 'requires_upload': True, 'verification_mode': 'upload'},
    ]
    required_documents = list(default_documents)
    employee = ensure_employee_for_offer(offer)
    if employee:
        sync_employee_requirements(employee)
        payload = build_candidate_onboarding_payload(employee, offer_token=str(token))
        dynamic = []
        for row in payload['documents']:
            raw_type = row['document_type']
            slug = slugify(raw_type) or 'doc'
            requires_upload = row['verification_mode'] in ('upload', 'hybrid')
            dynamic.append({
                'type': raw_type,
                'label': row['document_label'],
                'required': row['mandatory'],
                'slug': slug,
                'requires_upload': requires_upload,
                'verification_mode': row['verification_mode'],
            })
        if dynamic:
            required_documents = dynamic
    
    context = {
        'token': token,
        'candidate_name': candidate.name,
        'job_title': offer.job_title,
        'candidate_email': candidate.email,
        'required_documents': required_documents,
        'required_document_slugs_json': json.dumps([
            d['slug'] for d in required_documents
            if d.get('requires_upload', True) and d.get('required', True)
        ]),
        'has_physical_documents': any(
            not d.get('requires_upload', True) for d in required_documents
        ),
    }
    
    return render(request, 'hr/onboarding/document_upload.html', context)


@csrf_exempt
@require_http_methods(["POST"])
def onboarding_upload_document_api(request):
    """
    API endpoint for document upload during onboarding.
    Token-based authentication, no login required.
    """
    from django.conf import settings
    from django.core.files.storage import default_storage
    from django.core.files.base import ContentFile
    
    try:
        # Parse request data (prefer FILES — some clients send odd/missing Content-Type)
        if request.FILES.get('file'):
            token = request.POST.get('token')
            document_type = request.POST.get('document_type')
            file = request.FILES.get('file')
        elif request.content_type and 'application/json' in request.content_type:
            data = json.loads(request.body)
            token = data.get('token')
            document_type = data.get('document_type')
            file = request.FILES.get('file')
        else:
            token = request.POST.get('token')
            document_type = request.POST.get('document_type')
            file = request.FILES.get('file')
        
        # Validate required fields
        if not token or not document_type or not file:
            return JsonResponse({
                'success': False,
                'error': 'Missing required fields: token, document_type, file'
            }, status=400)
        
        # Validate token
        try:
            offer = Offer.objects.get(token=token, status='accepted')
        except Offer.DoesNotExist:
            return JsonResponse({
                'success': False,
                'error': 'Invalid or expired token'
            }, status=401)
        
        # Block only when truly finished — not when HR requested a new upload
        if hasattr(offer, 'onboarding_completed') and offer.onboarding_completed:
            if not candidate_may_access_onboarding_portal(offer):
                return JsonResponse({
                    'success': False,
                    'error': 'Onboarding already completed'
                }, status=400)

        if getattr(offer, 'onboarding_token_expired', False):
            return JsonResponse({
                'success': False,
                'error': 'Onboarding link has expired. Please contact HR.'
            }, status=403)
        
        normalized_type = normalize_document_type(document_type)
        
        # Validate file extension
        allowed_extensions = ['.pdf', '.jpg', '.jpeg', '.png']
        file_extension = os.path.splitext(file.name)[1].lower()
        if file_extension not in allowed_extensions:
            return JsonResponse({
                'success': False,
                'error': f'Invalid file type. Allowed: {", ".join(allowed_extensions)}'
            }, status=400)
        
        # Validate file size (5MB limit)
        max_size = 5 * 1024 * 1024  # 5MB
        if file.size > max_size:
            return JsonResponse({
                'success': False,
                'error': 'File size exceeds 5MB limit'
            }, status=400)
        
        employee = ensure_employee_for_offer(offer)
        if not employee:
            return JsonResponse({
                'success': False,
                'error': 'Could not resolve employee for this offer',
            }, status=400)

        requirement = find_employee_requirement(employee, normalized_type)
        if not requirement:
            sync_employee_requirements(employee)
            requirement = find_employee_requirement(employee, normalized_type)
        if not requirement:
            allowed = [normalize_document_type(req.document_type.name) for req in sync_employee_requirements(employee)]
            return JsonResponse({
                'success': False,
                'error': f'Invalid document type for this onboarding checklist. Allowed: {", ".join(allowed)}'
            }, status=400)

        if requirement.document_type.verification_mode == 'physical':
            return JsonResponse({
                'success': False,
                'error': 'This checklist item requires physical verification and does not accept uploads.'
            }, status=400)

        from apps.hr.onboarding_documents import document_allows_candidate_replace

        if not document_allows_candidate_replace(requirement):
            return JsonResponse({
                'success': False,
                'error': (
                    'This document has already been approved by HR and cannot be replaced. '
                    'Contact HR if you need to submit a different file.'
                ),
            }, status=400)

        from apps.hr.document_verification import archive_requirement_upload, validate_candidate_upload

        validation = validate_candidate_upload(file, requirement=requirement)
        if not validation['valid']:
            return JsonResponse({'success': False, 'error': validation['error']}, status=400)

        if requirement.uploaded_file:
            archive_requirement_upload(requirement, reason='replaced')

        upload_dir = f'onboarding/{employee.id}/{normalized_type}'
        timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
        unique_id = str(uuid.uuid4())[:8]
        filename = f"{normalized_type}_{timestamp}_{unique_id}{file_extension}"
        file_path = f"{upload_dir}/{filename}"
        saved_path = default_storage.save(file_path, file)

        requirement.uploaded_file = saved_path
        requirement.uploaded_at = timezone.now()
        requirement.file_hash = validation['file_hash']
        requirement.verified_at = None
        requirement.verified_by = None
        requirement.rejection_reason = ''
        requirement.verification_notes = ''
        requirement.override_approved = False
        if requirement.document_type.verification_mode == 'hybrid' and requirement.physically_verified:
            requirement.status = 'verified'
        else:
            requirement.status = 'uploaded'
        requirement.save()
        
        # Update employee onboarding status
        employee.update_onboarding_status()
        
        logger.info(f"[Onboarding] Requirement {normalized_type} uploaded for employee {employee.employee_id} ({employee.name})")
        
        return JsonResponse({
            'success': True,
            'message': 'Document uploaded successfully',
            'document_id': str(requirement.id),
            'document_type': normalized_type,
            'file_url': requirement.uploaded_file.url if requirement.uploaded_file else None,
            'uploaded_at': requirement.uploaded_at.isoformat() if requirement.uploaded_at else None,
            **build_candidate_onboarding_payload(employee, offer_token=str(token)),
        })
        
    except Exception as e:
        return JsonResponse({
            'success': False,
            'error': f'Upload failed: {str(e)}'
        }, status=500)


@csrf_exempt
@require_http_methods(["GET"])
def onboarding_get_documents_api(request, token):
    """
    Get uploaded documents for a candidate during onboarding.
    """
    try:
        # Validate token
        offer = Offer.objects.get(token=token, status='accepted')

        if offer.candidate and offer.candidate.status == 'rejected':
            return JsonResponse({
                'success': False,
                'error': 'Your application has been rejected. Document upload is no longer available.',
                'application_rejected': True,
            }, status=403)
        
        employee = ensure_employee_for_offer(offer)
        if not employee:
            return JsonResponse({
                'success': True,
                'documents': [],
                'candidate_name': offer.candidate.name,
                'job_title': offer.job_title,
                'resubmission_mode': False,
                'pending_resubmissions': [],
                'missing_uploads': ['aadhaar', 'pan', 'resume', 'degree', 'bank'],
                'can_submit': False,
            })

        payload = build_candidate_onboarding_payload(employee, offer_token=str(token))
        return JsonResponse({
            'success': True,
            'candidate_name': offer.candidate.name,
            'job_title': offer.job_title,
            **payload,
        })
        
    except Offer.DoesNotExist:
        return JsonResponse({
            'success': False,
            'error': 'Invalid or expired token'
        }, status=401)
    except Exception as e:
        return JsonResponse({
            'success': False,
            'error': f'Failed to get documents: {str(e)}'
        }, status=500)


def _onboarding_offer_and_requirement(token, requirement_id):
    offer = Offer.objects.get(token=token, status='accepted')
    if getattr(offer, 'onboarding_token_expired', False):
        raise PermissionError('expired')
    employee = ensure_employee_for_offer(offer)
    if not employee:
        raise Employee.DoesNotExist()
    requirement = EmployeeDocumentRequirement.objects.select_related('document_type').get(
        pk=requirement_id,
        employee=employee,
    )
    return offer, employee, requirement


def _file_response_for_field(file_field, *, download: bool, filename: str | None = None):
    name = filename or os.path.basename(file_field.name)
    ext = name.rsplit('.', 1)[-1].lower() if '.' in name else ''
    content_types = {
        'pdf': 'application/pdf',
        'jpg': 'image/jpeg',
        'jpeg': 'image/jpeg',
        'png': 'image/png',
    }
    content_type = content_types.get(ext, 'application/octet-stream')
    disposition = 'attachment' if download else 'inline'
    response = FileResponse(file_field.open('rb'), content_type=content_type)
    response['Content-Disposition'] = f'{disposition}; filename="{name}"'
    return response


@csrf_exempt
@require_http_methods(["GET"])
def onboarding_document_file_api(request, token, requirement_id, action):
    """Token-authenticated preview/download for current requirement upload."""
    try:
        _, _, requirement = _onboarding_offer_and_requirement(token, requirement_id)
        if not requirement.uploaded_file:
            return JsonResponse({'success': False, 'error': 'No file uploaded'}, status=404)
        download = action == 'download'
        return _file_response_for_field(
            requirement.uploaded_file,
            download=download,
            filename=os.path.basename(requirement.uploaded_file.name),
        )
    except Offer.DoesNotExist:
        return JsonResponse({'success': False, 'error': 'Invalid token'}, status=401)
    except EmployeeDocumentRequirement.DoesNotExist:
        return JsonResponse({'success': False, 'error': 'Document not found'}, status=404)
    except PermissionError:
        return JsonResponse({'success': False, 'error': 'Link expired'}, status=403)
    except Exception as exc:
        return JsonResponse({'success': False, 'error': str(exc)}, status=500)


@csrf_exempt
@require_http_methods(["GET"])
def onboarding_document_version_file_api(request, token, requirement_id, version_id, action):
    """Preview/download archived upload version (e.g. before HR re-upload request)."""
    from apps.hr.models import EmployeeDocumentUploadVersion

    try:
        _, _, requirement = _onboarding_offer_and_requirement(token, requirement_id)
        version = EmployeeDocumentUploadVersion.objects.get(pk=version_id, requirement=requirement)
        if not version.file:
            return JsonResponse({'success': False, 'error': 'Version file not found'}, status=404)
        download = action == 'download'
        return _file_response_for_field(
            version.file,
            download=download,
            filename=version.original_filename or os.path.basename(version.file.name),
        )
    except Offer.DoesNotExist:
        return JsonResponse({'success': False, 'error': 'Invalid token'}, status=401)
    except (EmployeeDocumentRequirement.DoesNotExist, EmployeeDocumentUploadVersion.DoesNotExist):
        return JsonResponse({'success': False, 'error': 'Document not found'}, status=404)
    except PermissionError:
        return JsonResponse({'success': False, 'error': 'Link expired'}, status=403)
    except Exception as exc:
        return JsonResponse({'success': False, 'error': str(exc)}, status=500)


@csrf_exempt
@require_http_methods(["POST"])
def onboarding_complete_api(request):
    """
    Mark onboarding as completed for a candidate.
    """
    try:
        data = json.loads(request.body)
        token = data.get('token')
        
        # Validate token
        offer = Offer.objects.get(token=token, status='accepted')
        
        employee = ensure_employee_for_offer(offer)
        if not employee:
            return JsonResponse({
                'success': False,
                'error': 'Employee record could not be created for this offer',
            }, status=404)

        payload = build_candidate_onboarding_payload(employee, offer_token=str(token))
        if not payload['can_submit']:
            missing = ', '.join(payload['missing_uploads']) or 'requested documents'
            return JsonResponse({
                'success': False,
                'error': f'Please upload the remaining required documents: {missing}'
            }, status=400)

        if payload['resubmission_mode']:
            employee.update_onboarding_status()
            return JsonResponse({
                'success': True,
                'message': 'Requested documents submitted successfully for HR review.',
                'candidate_name': offer.candidate.name,
                **payload,
            })
        
        # Mark onboarding as completed
        offer.onboarding_completed = True
        offer.onboarding_completed_at = timezone.now()
        offer.save()
        
        # Update employee status
        employee.onboarding_status = 'ready_to_join'
        employee.save()
        
        return JsonResponse({
            'success': True,
            'message': 'Onboarding completed successfully',
            'candidate_name': offer.candidate.name,
            'completed_at': offer.onboarding_completed_at.isoformat()
        })
        
    except Offer.DoesNotExist:
        return JsonResponse({
            'success': False,
            'error': 'Invalid or expired token'
        }, status=401)
    except Employee.DoesNotExist:
        return JsonResponse({
            'success': False,
            'error': 'Employee record not found'
        }, status=404)
    except Exception as e:
        return JsonResponse({
            'success': False,
            'error': f'Failed to complete onboarding: {str(e)}'
        }, status=500)


def onboarding_success_view(request):
    """
    Render a generic success page after onboarding is completed.
    """
    return render(request, 'hr/onboarding/completed.html', {
        'candidate_name': 'New Employee',
        'job_title': 'Your Position'
    })


def hr_document_verification_view(request):
    """
    HR Document Verification Dashboard - Main view
    Shows employee list with onboarding status and document verification interface
    """
    from django.shortcuts import render
    from django.contrib.auth.decorators import login_required
    
    if not request.user.is_authenticated or not (request.user.is_superuser or request.user.is_staff):
        return render(request, 'hr/verification/unauthorized.html', status=403)
    
    return render(request, 'hr/verification/dashboard.html')


@csrf_exempt
@require_http_methods(["GET"])
def verification_get_employees_api(request):
    """
    Get list of employees in onboarding queue for HR verification
    """
    if not request.user.is_authenticated or not (request.user.is_superuser or request.user.is_staff):
        return JsonResponse({
            'success': False,
            'error': 'Unauthorized access'
        }, status=403)
    
    try:
        # Get employees with onboarding status
        employees = Employee.objects.filter(
            onboarding_status__in=['pending_documents', 'under_review', 'ready_to_join']
        ).select_related('department').prefetch_related('documents')
        
        employee_list = []
        for emp in employees:
            # Get document counts
            total_docs = emp.documents.count()
            verified_docs = emp.documents.filter(status='verified').count()
            pending_docs = emp.documents.filter(status='uploaded').count()
            rejected_docs = emp.documents.filter(status='rejected').count()
            
            # Calculate progress
            progress = (verified_docs / 5) * 100 if total_docs > 0 else 0  # 5 required docs
            
            employee_list.append({
                'id': emp.id,
                'name': emp.name,
                'email': emp.email,
                'phone': emp.phone,
                'job_title': emp.role_name if hasattr(emp, 'role_name') else 'Not Assigned',
                'department': emp.department_name if hasattr(emp, 'department_name') else 'Not Assigned',
                'onboarding_status': emp.onboarding_status,
                'status_display': emp.get_onboarding_status_display(),
                'total_documents': total_docs,
                'verified_documents': verified_docs,
                'pending_documents': pending_docs,
                'rejected_documents': rejected_docs,
                'progress_percentage': round(progress, 1),
                'joining_date': emp.joining_date.strftime('%Y-%m-%d') if emp.joining_date else None,
                'created_at': emp.created_at.strftime('%Y-%m-%d') if emp.created_at else None
            })
        
        # Sort by onboarding status and progress
        employee_list.sort(key=lambda x: (
            {'pending_documents': 0, 'under_review': 1, 'ready_to_join': 2}.get(x['onboarding_status'], 3),
            -x['progress_percentage']
        ))
        
        return JsonResponse({
            'success': True,
            'employees': employee_list,
            'total_count': len(employee_list)
        })
        
    except Exception as e:
        return JsonResponse({
            'success': False,
            'error': f'Failed to fetch employees: {str(e)}'
        }, status=500)


@csrf_exempt
@require_http_methods(["GET"])
def verification_get_employee_documents_api(request, employee_id):
    """
    Get all documents for a specific employee for verification
    """
    if not request.user.is_authenticated or not (request.user.is_superuser or request.user.is_staff):
        return JsonResponse({
            'success': False,
            'error': 'Unauthorized access'
        }, status=403)
    
    try:
        employee = Employee.objects.get(id=employee_id)
        documents = EmployeeDocument.objects.filter(employee=employee)
        
        document_list = []
        required_types = ['aadhaar', 'pan', 'resume', 'degree', 'bank']
        
        for doc_type in required_types:
            doc = documents.filter(document_type=doc_type).first()
            
            if doc:
                document_list.append({
                    'id': doc.id,
                    'document_type': doc.document_type,
                    'document_label': doc.get_document_type_display(),
                    'file_url': doc.file.url if doc.file else None,
                    'file_name': os.path.basename(doc.file.name) if doc.file else None,
                    'status': doc.status,
                    'status_display': doc.get_status_display(),
                    'uploaded_at': doc.uploaded_at.strftime('%Y-%m-%d %H:%M') if doc.uploaded_at else None,
                    'verified_at': doc.verified_at.strftime('%Y-%m-%d %H:%M') if doc.verified_at else None,
                    'verified_by': (
                        getattr(doc.verified_by, 'full_name', None) or getattr(doc.verified_by, 'email', None)
                    ) if doc.verified_by else None,
                    'rejection_reason': doc.rejection_reason,
                    'is_required': True
                })
            else:
                document_list.append({
                    'id': None,
                    'document_type': doc_type,
                    'document_label': doc.get_document_type_display() if hasattr(EmployeeDocument(), 'get_document_type_display') else doc_type.title(),
                    'file_url': None,
                    'file_name': None,
                    'status': 'missing',
                    'status_display': 'Not Uploaded',
                    'uploaded_at': None,
                    'verified_at': None,
                    'verified_by': None,
                    'rejection_reason': None,
                    'is_required': True
                })
        
        # Get employee info
        employee_info = {
            'id': employee.id,
            'name': employee.name,
            'email': employee.email,
            'phone': employee.phone,
            'job_title': employee.role_name if hasattr(employee, 'role_name') else 'Not Assigned',
            'department': employee.department_name if hasattr(employee, 'department_name') else 'Not Assigned',
            'onboarding_status': employee.onboarding_status,
            'status_display': employee.get_onboarding_status_display(),
            'joining_date': employee.joining_date.strftime('%Y-%m-%d') if employee.joining_date else None
        }
        
        return JsonResponse({
            'success': True,
            'employee': employee_info,
            'documents': document_list
        })
        
    except Employee.DoesNotExist:
        return JsonResponse({
            'success': False,
            'error': 'Employee not found'
        }, status=404)
    except Exception as e:
        return JsonResponse({
            'success': False,
            'error': f'Failed to fetch documents: {str(e)}'
        }, status=500)


@csrf_exempt
@require_http_methods(["POST"])
def verification_approve_document_api(request, document_id):
    """
    Approve a document and update verification status
    """
    if not request.user.is_authenticated or not (request.user.is_superuser or request.user.is_staff):
        return JsonResponse({
            'success': False,
            'error': 'Unauthorized access'
        }, status=403)
    
    try:
        document = EmployeeDocument.objects.get(id=document_id)
        
        # Update document status
        document.status = 'verified'
        document.verified_at = timezone.now()
        document.verified_by = request.user
        document.rejection_reason = None
        document.save()
        
        # Update employee onboarding status
        document.employee.update_onboarding_status()
        
        logger.info(f"[Verification] Document {document.document_type} approved for employee {document.employee.employee_id} by {request.user.username}")
        
        return JsonResponse({
            'success': True,
            'message': 'Document approved successfully',
            'document_id': document.id,
            'document_type': document.document_type,
            'verified_at': document.verified_at.isoformat(),
            'employee_status': document.employee.onboarding_status
        })
        
    except EmployeeDocument.DoesNotExist:
        return JsonResponse({
            'success': False,
            'error': 'Document not found'
        }, status=404)
    except Exception as e:
        return JsonResponse({
            'success': False,
            'error': f'Failed to approve document: {str(e)}'
        }, status=500)


@csrf_exempt
@require_http_methods(["POST"])
def verification_reject_document_api(request, document_id):
    """
    Reject a document with reason
    """
    if not request.user.is_authenticated or not (request.user.is_superuser or request.user.is_staff):
        return JsonResponse({
            'success': False,
            'error': 'Unauthorized access'
        }, status=403)
    
    try:
        data = json.loads(request.body)
        rejection_reason = data.get('rejection_reason', '')
        
        if not rejection_reason.strip():
            return JsonResponse({
                'success': False,
                'error': 'Rejection reason is required'
            }, status=400)
        
        document = EmployeeDocument.objects.get(id=document_id)
        
        # Update document status
        document.status = 'rejected'
        document.verified_at = None
        document.verified_by = request.user
        document.rejection_reason = rejection_reason.strip()
        document.save()
        
        # Update employee onboarding status
        document.employee.update_onboarding_status()
        
        return JsonResponse({
            'success': True,
            'message': 'Document rejected successfully',
            'document_id': document.id,
            'document_type': document.document_type,
            'rejection_reason': document.rejection_reason,
            'employee_status': document.employee.onboarding_status
        })
        
    except EmployeeDocument.DoesNotExist:
        return JsonResponse({
            'success': False,
            'error': 'Document not found'
        }, status=404)
    except Exception as e:
        return JsonResponse({
            'success': False,
            'error': f'Failed to reject document: {str(e)}'
        }, status=500)


@csrf_exempt
@require_http_methods(["POST"])
def verification_request_reupload_api(request, document_id):
    """
    Request re-upload for a document
    """
    if not request.user.is_authenticated or not (request.user.is_superuser or request.user.is_staff):
        return JsonResponse({
            'success': False,
            'error': 'Unauthorized access'
        }, status=403)
    
    try:
        data = json.loads(request.body)
        reason = str(data.get('reason', 'Please re-upload this document')).strip()

        try:
            requirement = EmployeeDocumentRequirement.objects.get(id=document_id)
        except EmployeeDocumentRequirement.DoesNotExist:
            try:
                legacy = EmployeeDocument.objects.get(id=document_id)
            except EmployeeDocument.DoesNotExist:
                return JsonResponse({
                    'success': False,
                    'error': 'Document not found'
                }, status=404)
            requirement = find_employee_requirement(legacy.employee, legacy.document_type)
            if not requirement:
                return JsonResponse({
                    'success': False,
                    'error': 'Legacy document has no matching onboarding checklist row. Open the employee documents page in HR.',
                }, status=400)

        request_document_reupload(
            document=requirement,
            reviewer=request.user,
            reason=reason or 'Please re-upload this document',
        )
        requirement.refresh_from_db()

        logger.info(
            '[DOCS] reupload requested requirement=%s employee=%s by=%s',
            requirement.id,
            requirement.employee_id,
            getattr(request.user, 'id', None),
        )

        return JsonResponse({
            'success': True,
            'message': 'Re-upload requested successfully',
            'document_id': str(requirement.id),
            'document_type': requirement.document_type.name if requirement.document_type_id else None,
            'reason': requirement.rejection_reason,
            'employee_status': requirement.employee.onboarding_status
        })

    except Exception as e:
        logger.exception('[DOCS] reupload request failed document_id=%s', document_id)
        return JsonResponse({
            'success': False,
            'error': f'Failed to request re-upload: {str(e)}'
        }, status=500)


@csrf_exempt
@require_http_methods(["POST"])
def verification_mark_ready_to_join_api(request, employee_id):
    """
    Mark employee as ready to join (final onboarding step)
    """
    if not request.user.is_authenticated or not (request.user.is_superuser or request.user.is_staff):
        return JsonResponse({
            'success': False,
            'error': 'Unauthorized access'
        }, status=403)
    
    try:
        employee = Employee.objects.get(id=employee_id)
        
        # Check if all required documents are verified
        required_types = ['aadhaar', 'pan', 'resume', 'degree', 'bank']
        verified_docs = EmployeeDocument.objects.filter(
            employee=employee,
            document_type__in=required_types,
            status='verified'
        ).values_list('document_type', flat=True)
        
        missing_docs = set(required_types) - set(verified_docs)
        if missing_docs:
            return JsonResponse({
                'success': False,
                'error': f'Cannot mark as ready to join. Missing verified documents: {", ".join(missing_docs)}'
            }, status=400)

        import json
        payload = {}
        if request.body:
            try:
                payload = json.loads(request.body.decode('utf-8') or '{}')
            except json.JSONDecodeError:
                payload = {}
        override = payload.get('override_missing_designation') in (True, 'true', '1', 1)

        result = activate_employee_after_verification(
            employee=employee,
            reviewer=request.user,
            override_missing_designation=override,
        )
        if not result.get('success'):
            return JsonResponse({
                'success': False,
                'error': result.get('message'),
                'code': result.get('code'),
                'requires_override': result.get('requires_override', False),
            }, status=400)

        logger.info(
            '[Activation] Employee %s (%s) ACTIVATED by %s',
            employee.employee_id,
            employee.name,
            request.user.username,
        )

        return JsonResponse({
            'success': True,
            'message': result.get('message', 'Employee activated successfully'),
            'employee_id': employee.id,
            'employee_name': employee.name,
            'status': employee.status,
            'marked_at': timezone.now().isoformat(),
            'portal_account_created': result.get('portal_account_created', False),
            'welcome_email_sent': result.get('welcome_email_sent', False),
        })
        
    except Employee.DoesNotExist:
        return JsonResponse({
            'success': False,
            'error': 'Employee not found'
        }, status=404)
    except Exception as e:
        return JsonResponse({
            'success': False,
            'error': f'Failed to mark as ready to join: {str(e)}'
        }, status=500)


@csrf_exempt
@require_http_methods(["GET"])
def verification_get_summary_api(request):
    """
    Get summary statistics for the verification dashboard
    """
    if not request.user.is_authenticated or not (request.user.is_superuser or request.user.is_staff):
        return JsonResponse({
            'success': False,
            'error': 'Unauthorized access'
        }, status=403)
    
    try:
        # Get overall statistics
        total_employees = Employee.objects.filter(
            onboarding_status__in=['pending_documents', 'under_review', 'ready_to_join']
        ).count()
        
        # Document statistics
        total_documents = EmployeeDocument.objects.filter(
            employee__onboarding_status__in=['pending_documents', 'under_review', 'ready_to_join']
        ).count()
        
        verified_documents = EmployeeDocument.objects.filter(
            employee__onboarding_status__in=['pending_documents', 'under_review', 'ready_to_join'],
            status='verified'
        ).count()
        
        pending_documents = EmployeeDocument.objects.filter(
            employee__onboarding_status__in=['pending_documents', 'under_review', 'ready_to_join'],
            status='uploaded'
        ).count()
        
        rejected_documents = EmployeeDocument.objects.filter(
            employee__onboarding_status__in=['pending_documents', 'under_review', 'ready_to_join'],
            status='rejected'
        ).count()
        
        # Status breakdown
        pending_docs_employees = Employee.objects.filter(onboarding_status='pending_documents').count()
        under_review_employees = Employee.objects.filter(onboarding_status='under_review').count()
        ready_to_join_employees = Employee.objects.filter(onboarding_status='ready_to_join').count()
        
        return JsonResponse({
            'success': True,
            'summary': {
                'total_employees': total_employees,
                'total_documents': total_documents,
                'verified_documents': verified_documents,
                'pending_documents': pending_documents,
                'rejected_documents': rejected_documents,
                'verification_progress': round((verified_documents / total_documents) * 100, 1) if total_documents > 0 else 0,
                'employees_by_status': {
                    'pending_documents': pending_docs_employees,
                    'under_review': under_review_employees,
                    'ready_to_join': ready_to_join_employees
                }
            }
        })
        
    except Exception as e:
        return JsonResponse({
            'success': False,
            'error': f'Failed to fetch summary: {str(e)}'
        }, status=500)
