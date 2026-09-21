"""
Manual (direct) employee creation — no recruitment or offer letter workflow.

Designed so a future CSV/Excel importer can call create_manual_employee() with row payloads.
"""
from __future__ import annotations

import re
from datetime import date, timedelta
from decimal import Decimal, InvalidOperation
from typing import Any

from django.conf import settings
from django.core.exceptions import ValidationError as DjangoValidationError
from django.core.validators import validate_email
from django.db import transaction
from django.utils import timezone as dj_tz

from apps.hr.designation_utils import (
    ensure_employee_designation_linked,
    validate_active_designation,
    validate_active_employee_designation,
)
from apps.hr.models import (
    Candidate,
    Designation,
    Employee,
    EmployeeDocumentAuditLog,
    Gender,
    JobOpening,
    Offer,
)
from apps.hr.onboarding_documents import (
    get_onboarding_upload_url,
    mark_requirement_physically_verified,
    refresh_employee_onboarding_status,
    sync_employee_requirements,
)


def get_direct_office_hire_context(employee) -> dict:
    """HR-facing context for walk-in manual hires verified in office."""
    created = (
        EmployeeDocumentAuditLog.objects.filter(employee=employee, action='employee_created')
        .order_by('created_at')
        .first()
    )
    if not created:
        return {'is_direct_office_hire': False}
    meta = created.metadata or {}
    if meta.get('source') != 'manual_create' or meta.get('start_onboarding'):
        return {'is_direct_office_hire': False}
    return {
        'is_direct_office_hire': True,
        'label': 'Direct hire — documents verified at office',
        'description': (
            'This employee was added manually while present in the office. '
            'Required documents were marked verified in HR records; no online upload or onboarding link was used.'
        ),
    }


def manual_employee_row_to_payload(row: dict) -> dict:
    """
    Future: normalize an import row into the payload expected by create_manual_employee().
    For now, returns the row unchanged.
    """
    return dict(row)


def ensure_direct_hire_job_opening(hospital) -> JobOpening | None:
    """Stable internal job used only for linking Candidate + Offer for self-service onboarding tokens."""
    from apps.hr.models import Department

    if not hospital:
        return None
    dept = Department.objects.filter(hospital=hospital).first()
    if not dept:
        return None
    code = f'DH-{hospital.id}'
    job = JobOpening.objects.filter(hospital=hospital, job_code=code).first()
    if job:
        return job
    return JobOpening.objects.create(
        hospital=hospital,
        department=dept,
        title='Direct hire (HR)',
        job_code=code,
        description='System job for manual hires — not shown in public recruitment.',
        status='closed',
        is_active=False,
        is_archived=False,
        vacancies=1,
        employment_type='full_time',
    )


def _parse_decimal(val) -> Decimal | None:
    if val is None or val == '':
        return None
    try:
        return Decimal(str(val))
    except (InvalidOperation, ValueError):
        return None


def _parse_date(val) -> date | None:
    if not val:
        return None
    if isinstance(val, date):
        return val
    from datetime import datetime as dt

    try:
        return dt.strptime(str(val)[:10], '%Y-%m-%d').date()
    except ValueError:
        return None


NAME_LETTER_RE = re.compile(r'[a-zA-Z\u00C0-\u024F\u0900-\u097F]')
PHONE_DIGITS_RE = re.compile(r'\D')
INDIAN_MOBILE_RE = re.compile(r'^[6-9]\d{9}$')
ALLOWED_EMPLOYMENT_TYPES = {'full_time', 'part_time', 'contract', 'internship'}
MAX_SALARY = Decimal('99999999.99')


class ManualEmployeeValidationError(ValueError):
    """Raised when manual employee payload fails field validation."""

    def __init__(self, field_errors: dict[str, str]):
        self.field_errors = field_errors
        super().__init__('validation_failed')


def _clean_phone_digits(raw: str) -> str:
    return PHONE_DIGITS_RE.sub('', raw or '')


def _normalize_indian_mobile(raw: str) -> str:
    digits = _clean_phone_digits(raw)
    if len(digits) == 12 and digits.startswith('91'):
        return digits[2:]
    if len(digits) == 11 and digits.startswith('0'):
        return digits[1:]
    return digits


def _resolve_department(payload: dict[str, Any], *, hospital=None):
    """Return (Department|None, error_message|None)."""
    from apps.hr.models import Department

    department_id = payload.get('department_id')
    department_name = (payload.get('department') or '').strip()
    hospital_id = getattr(hospital, 'id', hospital) if hospital else None

    if department_id:
        dept = Department.objects.filter(pk=department_id).first()
        if not dept:
            return None, 'Select a valid department from the list'
        if hospital_id and dept.hospital_id and str(dept.hospital_id) != str(hospital_id):
            return None, 'Select a valid department for this hospital'
        return dept, None

    if not department_name:
        return None, 'Department is required'

    if hospital_id:
        dept = Department.objects.filter(hospital_id=hospital_id, name__iexact=department_name).first()
        if not dept:
            return None, 'Select a valid department for this hospital'
        return dept, None

    dept = Department.objects.filter(name__iexact=department_name).first()
    if dept:
        return dept, None
    return None, 'Select a valid department from the list'


def _custom_salary_dict(payload: dict[str, Any]) -> dict[str, Any] | None:
    raw = payload.get('custom_salary')
    if raw is None or raw == '':
        return None
    if not isinstance(raw, dict):
        return {}
    return raw


def _parse_custom_salary_components(custom: dict[str, Any] | None) -> dict[str, Decimal | None]:
    if not custom:
        return {
            'basic': None,
            'hra': None,
            'medical': None,
            'special_allowance': None,
        }
    return {
        'basic': _parse_decimal(custom.get('basic')),
        'hra': _parse_decimal(custom.get('hra')) if custom.get('hra') not in (None, '') else Decimal('0'),
        'medical': _parse_decimal(custom.get('medical')) if custom.get('medical') not in (None, '') else Decimal('0'),
        'special_allowance': (
            _parse_decimal(custom.get('special_allowance'))
            if custom.get('special_allowance') not in (None, '')
            else Decimal('0')
        ),
    }


def _monthly_gross_from_components(*, basic, hra, medical, special_allowance) -> Decimal:
    total = Decimal('0')
    for amount in (basic, hra, medical, special_allowance):
        if amount is not None:
            total += Decimal(str(amount))
    return total.quantize(Decimal('0.01'))


def _compensation_level_monthly_gross(level) -> Decimal:
    return _monthly_gross_from_components(
        basic=level.basic,
        hra=level.hra,
        medical=level.medical,
        special_allowance=level.special_allowance,
    )


def validate_manual_employee_payload(payload: dict[str, Any], *, hospital=None) -> dict[str, str]:
    """Return a map of field name -> error message. Empty dict means valid."""
    from apps.shared.email_normalization import normalize_email_address

    errors: dict[str, str] = {}

    name = (payload.get('name') or '').strip()
    email = normalize_email_address(payload.get('email'))
    phone_raw = (payload.get('phone') or '').strip()
    phone_digits = _clean_phone_digits(phone_raw)
    department = (payload.get('department') or '').strip()
    job_title = (payload.get('job_title') or '').strip()
    joining_date = _parse_date(payload.get('joining_date'))
    salary = _parse_decimal(payload.get('salary'))
    employment_raw = (payload.get('employment_type') or '').strip().lower().replace('-', '_')
    pay_mode = (payload.get('pay_mode') or '').strip().lower()
    custom_salary_raw = _custom_salary_dict(payload)
    has_custom_salary = custom_salary_raw is not None

    if not name:
        errors['name'] = 'Name is required'
    elif len(name) < 2:
        errors['name'] = 'Name must be at least 2 characters'
    elif len(name) > 200:
        errors['name'] = 'Name must be at most 200 characters'
    elif not NAME_LETTER_RE.search(name):
        errors['name'] = 'Name must include at least one letter'

    if not email:
        errors['email'] = 'Email is required'
    elif len(email) > 254:
        errors['email'] = 'Email is too long'
    else:
        try:
            validate_email(email)
        except DjangoValidationError:
            errors['email'] = 'Enter a valid email address'

    if not phone_digits:
        errors['phone'] = 'Mobile number is required'
    else:
        mobile = _normalize_indian_mobile(phone_raw)
        if len(mobile) != 10:
            errors['phone'] = 'Enter a valid 10-digit mobile number'
        elif not INDIAN_MOBILE_RE.match(mobile):
            errors['phone'] = 'Mobile number must start with 6, 7, 8, or 9'
        elif len(phone_raw) > 20:
            errors['phone'] = 'Mobile number must be at most 20 characters'

    gender = (payload.get('gender') or '').strip()
    if not gender:
        errors['gender'] = 'Gender is required'
    elif gender not in Gender.values:
        errors['gender'] = 'Select a valid gender'

    _dept, dept_error = _resolve_department(payload, hospital=hospital)
    if dept_error:
        errors['department'] = dept_error

    designation_id = (payload.get('designation') or payload.get('designation_id') or '').strip()
    job_title = (payload.get('job_title') or '').strip()
    designation = None
    if designation_id:
        designation_qs = Designation.objects.filter(pk=designation_id)
        if hospital:
            designation_qs = designation_qs.filter(hospital_id=hospital.id)
        designation = designation_qs.first()
        if designation is None:
            errors['designation'] = 'Select a valid designation'
        else:
            try:
                validate_active_designation(designation)
            except Exception as exc:
                detail = getattr(exc, 'detail', None)
                if isinstance(detail, dict) and detail.get('designation'):
                    errors['designation'] = detail['designation'][0] if isinstance(detail['designation'], list) else detail['designation']
                else:
                    errors['designation'] = 'Designation must be active to assign.'
            else:
                job_title = designation.name
    elif not job_title:
        errors['job_title'] = 'Job title or designation is required'
    elif len(job_title) < 2:
        errors['job_title'] = 'Job title must be at least 2 characters'
    elif len(job_title) > 200:
        errors['job_title'] = 'Job title must be at most 200 characters'

    compensation_level_id = (payload.get('compensation_level') or payload.get('compensation_level_id') or '').strip()
    if pay_mode == 'custom' or has_custom_salary:
        if compensation_level_id:
            errors['custom_salary'] = 'Choose either a compensation level or custom salary, not both'
        if custom_salary_raw is None:
            errors['custom_basic'] = 'Basic salary is required'
        elif not isinstance(custom_salary_raw, dict) or custom_salary_raw == {}:
            errors['custom_salary'] = 'Custom salary must include basic, HRA, medical, and special allowance'
        else:
            components = _parse_custom_salary_components(custom_salary_raw)
            if custom_salary_raw.get('basic') in (None, '') or components['basic'] is None:
                errors['custom_basic'] = 'Basic salary is required'
            elif components['basic'] <= 0:
                errors['custom_basic'] = 'Basic salary must be greater than 0'
            elif components['basic'] > MAX_SALARY:
                errors['custom_basic'] = 'Basic salary is too large'
            for key, field_key, label in (
                ('hra', 'custom_hra', 'HRA'),
                ('medical', 'custom_medical', 'Medical allowance'),
                ('special_allowance', 'custom_special_allowance', 'Special allowance'),
            ):
                amount = components[key]
                raw_val = custom_salary_raw.get(key)
                if raw_val not in (None, '') and amount is None:
                    errors[field_key] = f'{label} must be a valid number'
                elif amount is not None and amount < 0:
                    errors[field_key] = f'{label} cannot be negative'
                elif amount is not None and amount > MAX_SALARY:
                    errors[field_key] = f'{label} is too large'
    elif compensation_level_id:
        if not designation_id:
            errors['compensation_level'] = 'Select a designation before choosing a compensation level'
        else:
            from apps.hr.payroll_models import CompensationLevel

            level_qs = CompensationLevel.objects.filter(pk=compensation_level_id, is_active=True)
            if hospital:
                level_qs = level_qs.filter(hospital_id=hospital.id)
            level = level_qs.first()
            if level is None:
                errors['compensation_level'] = 'Select a valid compensation level'
            elif level.designation_id and str(level.designation_id) != str(designation_id):
                errors['compensation_level'] = 'Compensation level does not match the selected designation'

    if not joining_date:
        errors['joining_date'] = 'Joining date is required'
    else:
        today = dj_tz.localdate()
        if joining_date < today.replace(year=today.year - 50):
            errors['joining_date'] = 'Joining date is too far in the past'

    if employment_raw and employment_raw not in ALLOWED_EMPLOYMENT_TYPES:
        errors['employment_type'] = 'Select a valid employment type'

    if payload.get('salary') not in (None, ''):
        if salary is None:
            errors['salary'] = 'Salary must be a valid number'
        elif salary < 0:
            errors['salary'] = 'Salary cannot be negative'
        elif salary > MAX_SALARY:
            errors['salary'] = 'Salary is too large'

    optional_limits = (
        ('manager_name', 'Manager name', 200),
        ('address', 'Address', 500),
        ('emergency_contact', 'Emergency contact', 200),
    )
    for key, label, max_len in optional_limits:
        val = (payload.get(key) or '').strip()
        if val and len(val) > max_len:
            errors[key] = f'{label} must be at most {max_len} characters'

    return errors


def _employment_label(raw: str | None) -> str:
    m = (raw or 'full_time').strip().lower().replace('-', '_')
    labels = {
        'full_time': 'Full Time',
        'part_time': 'Part Time',
        'contract': 'Contract',
        'internship': 'Internship',
        'fulltime': 'Full Time',
        'parttime': 'Part Time',
    }
    return labels.get(m, 'Full Time')


def create_manual_employee(
    *,
    hr_user,
    hospital,
    payload: dict[str, Any],
    skip_biometric_activation: bool = False,
) -> tuple[Employee, dict]:
    """
    Create an employee from HR form / future bulk import.

    payload keys:
      - name, email, phone (required)
      - department (str), job_title, joining_date (required)
      - employment_type (optional, default full_time)
      - salary (optional legacy; prefer compensation_level or custom_salary)
      - compensation_level (optional; XOR with custom_salary)
      - custom_salary: { basic, hra, medical, special_allowance } (optional; XOR with compensation_level)
      - pay_mode: 'level' | 'custom' (optional hint)
      - manager_name, address, emergency_contact (optional — stored in audit metadata)
      - start_onboarding (bool)
      - document_timing: 'collect_now' | 'later' | 'skip'
      - offline_physical_verify_all (bool)
      - send_welcome_email (bool, default True when online onboarding artifacts exist)
    """
    field_errors = validate_manual_employee_payload(payload, hospital=hospital)
    if field_errors:
        raise ManualEmployeeValidationError(field_errors)

    name = (payload.get('name') or '').strip()
    from apps.shared.email_normalization import normalize_email_address
    email = normalize_email_address(payload.get('email'))
    phone = _normalize_indian_mobile(payload.get('phone') or '')
    gender = (payload.get('gender') or '').strip()
    department_ref, dept_error = _resolve_department(payload, hospital=hospital)
    if dept_error:
        raise ManualEmployeeValidationError({'department': dept_error})

    department = department_ref.name if department_ref else (payload.get('department') or '').strip()
    designation_id = (payload.get('designation') or payload.get('designation_id') or '').strip()
    job_title = (payload.get('job_title') or '').strip()
    designation = None
    if designation_id:
        designation_qs = Designation.objects.filter(pk=designation_id)
        if hospital:
            designation_qs = designation_qs.filter(hospital_id=hospital.id)
        designation = designation_qs.first()
        if designation:
            job_title = designation.name
    joining_date = _parse_date(payload.get('joining_date'))
    employment_type = _employment_label(payload.get('employment_type'))
    salary = _parse_decimal(payload.get('salary'))
    pay_mode = (payload.get('pay_mode') or '').strip().lower()
    custom_salary_raw = _custom_salary_dict(payload)
    use_custom_salary = pay_mode == 'custom' or custom_salary_raw is not None
    custom_components = _parse_custom_salary_components(custom_salary_raw) if use_custom_salary else None
    compensation_level_id = (
        payload.get('compensation_level') or payload.get('compensation_level_id') or ''
    ).strip() or None
    if use_custom_salary:
        compensation_level_id = None

    offer_basic = None
    offer_hra = None
    offer_ctc = salary if salary is not None else Decimal('0')
    if use_custom_salary and custom_components:
        offer_basic = custom_components['basic']
        offer_hra = custom_components['hra']
        monthly = _monthly_gross_from_components(
            basic=custom_components['basic'],
            hra=custom_components['hra'],
            medical=custom_components['medical'],
            special_allowance=custom_components['special_allowance'],
        )
        offer_ctc = (monthly * Decimal('12')).quantize(Decimal('0.01'))
    elif compensation_level_id:
        from apps.hr.payroll_models import CompensationLevel

        level_qs = CompensationLevel.objects.filter(pk=compensation_level_id, is_active=True)
        if hospital:
            level_qs = level_qs.filter(hospital_id=hospital.id)
        level = level_qs.first()
        if level is not None:
            offer_basic = level.basic
            offer_hra = level.hra
            monthly = _compensation_level_monthly_gross(level)
            offer_ctc = (monthly * Decimal('12')).quantize(Decimal('0.01'))
            if salary is None:
                salary = offer_ctc

    start_onboarding = bool(payload.get('start_onboarding'))
    document_timing = (payload.get('document_timing') or 'collect_now').strip().lower()
    if document_timing not in {'collect_now', 'later', 'skip'}:
        document_timing = 'collect_now'
    offline_physical = bool(payload.get('offline_physical_verify_all'))
    send_welcome = bool(payload.get('send_welcome_email', True))

    needs_portal = start_onboarding and document_timing != 'skip'
    if needs_portal and not hospital:
        raise ValueError(
            'hospital_required_for_portal',
        )
    dept_display = department
    if payload.get('employment_type'):
        dept_display = f'{department} · {_employment_label(payload.get("employment_type"))}'

    extra_profile = {
        'manager_name': (payload.get('manager_name') or '').strip() or None,
        'address': (payload.get('address') or '').strip() or None,
        'emergency_contact': (payload.get('emergency_contact') or '').strip() or None,
        'employment_type_raw': payload.get('employment_type'),
    }

    if Employee.objects.filter(email__iexact=email).exists():
        raise ValueError('duplicate_email')

    meta_out: dict = {'onboarding_link_sent': False, 'portal_url': None}

    with transaction.atomic():
        if start_onboarding:
            status = 'pending_onboarding'
            onboarding_status = 'pending_documents'
            onboarding_completed = False
        else:
            status = 'active'
            onboarding_status = 'pending_documents'
            onboarding_completed = False

        employee = Employee(
            hospital=hospital,
            name=name,
            email=email,
            phone=phone,
            gender=gender,
            department=department_ref.name if department_ref else dept_display,
            department_ref=department_ref,
            designation=designation,
            job_title=job_title,
            joining_date=joining_date,
            joining_date_confirmed=joining_date if not start_onboarding else None,
            salary=salary,
            status=status,
            onboarding_status=onboarding_status,
            onboarding_completed=onboarding_completed,
        )
        employee.save()
        ensure_employee_designation_linked(employee)
        employee.refresh_from_db()

        if employee.status == 'active':
            designation_ok, designation_message, _designation_code = validate_active_employee_designation(
                employee,
            )
            if not designation_ok:
                raise ManualEmployeeValidationError({'designation': designation_message})

        from apps.hr.onboarding_documents import log_document_audit

        log_document_audit(
            employee=employee,
            action='employee_created',
            performed_by=hr_user,
            notes='Employee created via HR manual hire.',
            metadata={
                'source': 'manual_create',
                'status': employee.status,
                'start_onboarding': start_onboarding,
            },
        )

        if employee.status == 'active':
            # Audit above must exist first so sync can detect direct office hire context.
            sync_employee_requirements(employee, reviewer=hr_user)
            employee.onboarding_completed = True
            employee.onboarding_status = 'onboarded'
            employee.save(update_fields=['onboarding_completed', 'onboarding_status', 'updated_at'])

            if use_custom_salary and custom_components:
                from apps.hr.payroll_api.assignment_service import (
                    SalaryStructureAssignmentError,
                    assign_salary_structure,
                )

                allowances = {}
                if custom_components['medical'] is not None:
                    allowances['medical'] = str(custom_components['medical'])
                if custom_components['special_allowance'] is not None:
                    allowances['special_allowance'] = str(custom_components['special_allowance'])
                try:
                    assign_salary_structure(
                        employee=employee,
                        effective_from=joining_date,
                        basic_salary=custom_components['basic'],
                        hra=custom_components['hra'] or Decimal('0'),
                        allowances=allowances,
                        deductions={},
                        overtime_rate=Decimal('0'),
                        notes='Direct hire custom salary',
                    )
                except SalaryStructureAssignmentError as exc:
                    raise ManualEmployeeValidationError({'custom_salary': exc.message}) from exc
            else:
                from apps.hr.payroll_api.compensation_level_service import (
                    assign_employee_compensation_or_default,
                    EmployeeCompensationAssignmentError,
                )

                try:
                    assign_employee_compensation_or_default(
                        employee=employee,
                        compensation_level_id=compensation_level_id,
                        effective_from=joining_date,
                    )
                except EmployeeCompensationAssignmentError as exc:
                    raise ManualEmployeeValidationError({'compensation_level': exc.message}) from exc

            from apps.hr.portal_provisioning import provision_employee_portal_deferred

            provision_employee_portal_deferred(
                employee_id=employee.pk,
                reviewer_id=getattr(hr_user, 'pk', None),
                source='manual_create',
            )
            if not skip_biometric_activation:
                from apps.hr.biometric.hooks import on_employee_activated_deferred

                on_employee_activated_deferred(employee_id=employee.pk)
            meta_out['portal_provisioning_scheduled'] = True
            meta_out['portal_welcome_email_scheduled'] = True

        if needs_portal:
            job = ensure_direct_hire_job_opening(hospital)
            if not job:
                raise ValueError(
                    'Cannot enable document portal: add at least one department for this hospital, then retry.'
                )

            company_email = getattr(settings, 'DEFAULT_FROM_EMAIL', None) or 'hr@example.com'
            hr_display = getattr(hr_user, 'full_name', None) or getattr(hr_user, 'email', None) or 'HR'

            expiry = joining_date + timedelta(days=365)

            from apps.hr.recruitment_applications import get_or_create_profile, create_application

            profile = get_or_create_profile(
                hospital=hospital,
                email=email,
                name=name,
                phone=phone,
                gender=gender,
            )
            candidate = create_application(
                job,
                profile,
                name=name,
                email=email,
                phone=phone,
                gender=gender,
                address=(extra_profile.get('address') or '')[:500],
                status='hired',
                offer_status='accepted',
                joining_date=joining_date,
            )

            offer = Offer.objects.create(
                candidate=candidate,
                job=job,
                candidate_name=name,
                candidate_email=email,
                candidate_address=(extra_profile.get('address') or '')[:2000],
                company_name=getattr(hospital, 'name', None) or 'Organization',
                company_address='',
                company_email=company_email,
                company_phone='',
                hr_name=hr_display,
                hr_designation='Human Resources',
                job_title=job_title,
                department=department,
                job_location='',
                employment_type=employment_type,
                ctc=offer_ctc,
                basic_salary=offer_basic,
                hra=offer_hra,
                allowances=None,
                bonus=None,
                joining_date=joining_date,
                work_shift='',
                working_hours='',
                responsibilities='',
                terms_conditions='Direct hire — standard employment terms apply.',
                offer_expiry_date=expiry,
                status='accepted',
                onboarding_completed=False,
            )

            employee.candidate = candidate
            employee.offer = offer
            employee.save(update_fields=['candidate', 'offer', 'updated_at'])

            if document_timing in {'collect_now', 'later'}:
                sync_employee_requirements(employee)
                if offline_physical:
                    for req in employee.document_requirements.select_related('document_type').all():
                        mode = req.document_type.verification_mode
                        if mode == 'upload':
                            # Portal onboarding still needs the candidate to upload files.
                            continue
                        mark_requirement_physically_verified(
                            requirement=req,
                            reviewer=hr_user,
                            notes='Direct hire — collected / verified offline.',
                        )
                refresh_employee_onboarding_status(employee)

            meta_out['portal_url'] = get_onboarding_upload_url(employee)

            if send_welcome:
                transaction.on_commit(
                    lambda emp=employee, off=offer: EmailEventDispatcher.offer_accepted(
                        emp, offer=off, on_commit=False
                    ),
                )
                meta_out['onboarding_link_sent'] = True

        elif start_onboarding and document_timing == 'skip':
            refresh_employee_onboarding_status(employee)

        if any(v for v in extra_profile.values() if v):
            EmployeeDocumentAuditLog.objects.create(
                employee=employee,
                action='override_approved',
                performed_by=hr_user,
                requirement=None,
                document=None,
                notes='Manual hire — additional profile fields',
                metadata={'manual_hire_profile': extra_profile, 'ts': dj_tz.now().isoformat()},
            )

    return employee, meta_out
