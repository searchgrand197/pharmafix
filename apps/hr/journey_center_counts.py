"""Journey Center aggregate counts — org-wide or scoped to a single job opening."""
from __future__ import annotations

from datetime import date

from django.db import models
from django.utils import timezone

from apps.hr.attendance_analytics import build_dashboard_summary
from apps.hr.candidate_pipeline import annotate_has_scheduled_interview, APPLIED_PIPELINE_STATUSES
from apps.hr.models import (
    Candidate,
    DailyAttendance,
    Employee,
    EmployeeDocumentRequirement,
    Interview,
    JobOpening,
)
from apps.hr.payroll_models import PayrollRun, SalaryStructure

PAYROLL_NEEDS_ACTION = frozenset({'DRAFT', 'UNDER_REVIEW', 'APPROVED', 'FINALIZED'})

SHORTLISTED_PLUS_STATUSES = frozenset({'shortlisted', 'interview', 'selected', 'hired'})
INTERVIEW_PLUS_STATUSES = frozenset({'interview', 'selected', 'hired'})


def _step_completion(current, target, *, cap=True):
    """Build a completion payload for one journey step."""
    target = max(1, int(target or 1))
    current = max(0, int(current or 0))
    raw_percent = round((current / target) * 100)
    percent = min(100, raw_percent) if cap else raw_percent
    extra = max(0, current - target) if current > target else 0
    if percent >= 100:
        status = 'complete'
    elif percent >= 70:
        status = 'almost'
    elif percent > 0:
        status = 'in_progress'
    else:
        status = 'not_started'
    return {
        'current': current,
        'target': target,
        'percent': percent,
        'status': status,
        'extra': extra,
    }


def _candidates_for_job(hospital_id, job_opening_id):
    qs = Candidate.objects.filter(job_opening_id=job_opening_id)
    if hospital_id:
        qs = qs.filter(job_opening__hospital_id=hospital_id)
    return qs


def _count_shortlisted_plus(candidate_qs):
    return candidate_qs.filter(
        models.Q(status__in=SHORTLISTED_PLUS_STATUSES)
        | models.Q(offer_status__in=['sent', 'accepted']),
    ).count()


def _count_interview_plus(candidate_qs):
    return candidate_qs.filter(
        models.Q(status__in=INTERVIEW_PLUS_STATUSES)
        | models.Q(status='interview', interview_status='completed'),
    ).count()


def _count_offer_plus(candidate_qs):
    return candidate_qs.filter(
        models.Q(offer_status__in=['sent', 'accepted']) | models.Q(status='hired'),
    ).count()


def _jobs_open_completion(job: JobOpening | None) -> dict:
    if not job:
        return _step_completion(0, 1)
    if job.status == 'open' and job.is_active and not job.is_archived:
        return {**_step_completion(1, 1), 'percent': 100, 'status': 'complete'}
    if job.status == 'draft':
        return {**_step_completion(0, 1), 'percent': 50, 'status': 'in_progress'}
    if job.status in {'closed', 'on_hold', 'archived', 'open'}:
        return {**_step_completion(1, 1), 'percent': 100, 'status': 'complete'}
    return _step_completion(0, 1)


def _employee_phase_completion(current, hired_count):
    """Phase 2/3 steps use hired headcount as target; 0% when nobody hired yet."""
    if hired_count <= 0:
        return {
            'current': 0,
            'target': 0,
            'percent': 0,
            'status': 'not_started',
            'extra': 0,
            'awaiting_hire': True,
        }
    return _step_completion(current, hired_count)


def compute_job_completion(
    *,
    job: JobOpening | None,
    hospital_id,
    job_opening_id,
    today: date,
    month: str,
    stats: dict,
    kpi: dict,
    employee_ids: list,
    active_employee_ids: set,
    structure_employee_ids: set,
    scheduled_for_job: int,
    attendance_ready: int,
    payroll_runs: list,
) -> dict:
    """Vacancy-based funnel completion for a single job opening."""
    vacancies = max(1, int(getattr(job, 'vacancies', None) or 1))
    candidate_qs = _candidates_for_job(hospital_id, job_opening_id)
    applicants_total = candidate_qs.count()

    emp_qs = _employees_for_job(hospital_id, job_opening_id)
    hired_count = emp_qs.count()
    active_count = len(active_employee_ids)

    kyc_current = emp_qs.filter(
        models.Q(status='active')
        | models.Q(onboarding_status='ready_to_join'),
    ).count()

    docs_complete = emp_qs.exclude(
        onboarding_status__in=['pending_documents', 'partial_documents'],
    ).count()
    salary_complete = len(structure_employee_ids)
    attendance_active_complete = scheduled_for_job
    payroll_eligible_complete = _count_payroll_eligible(active_employee_ids, structure_employee_ids)

    payroll_draft_count = sum(1 for run in payroll_runs if run.status in PAYROLL_NEEDS_ACTION)
    published_count = sum(1 for run in payroll_runs if run.status == 'PUBLISHED')

    steps = {
        'jobs_open': _jobs_open_completion(job),
        'applied': _step_completion(applicants_total, vacancies),
        'shortlisted': _step_completion(_count_shortlisted_plus(candidate_qs), vacancies),
        'interview': _step_completion(_count_interview_plus(candidate_qs), vacancies),
        'offer': _step_completion(_count_offer_plus(candidate_qs), vacancies),
        'kyc': _step_completion(kyc_current, vacancies),
        'employee_created': _step_completion(active_count, vacancies),
        'documents': _employee_phase_completion(docs_complete, hired_count),
        'salary_assigned': _employee_phase_completion(salary_complete, hired_count),
        'attendance_active': _employee_phase_completion(attendance_active_complete, hired_count),
        'payroll_eligible': _employee_phase_completion(payroll_eligible_complete, hired_count),
        'attendance_ready': _employee_phase_completion(attendance_ready, hired_count),
        'payroll_draft': _employee_phase_completion(payroll_draft_count, hired_count),
        'published': _employee_phase_completion(published_count, hired_count),
    }

    funnel_ids = ['jobs_open', 'applied', 'shortlisted', 'interview', 'offer', 'kyc', 'employee_created']
    funnel_percents = [steps[sid]['percent'] for sid in funnel_ids]
    phase_hiring_percent = round(sum(funnel_percents) / len(funnel_percents)) if funnel_percents else 0

    return {
        'vacancies': vacancies,
        'hired_employees': hired_count,
        'payroll_month': month,
        'phase_hiring_percent': phase_hiring_percent,
        'steps': steps,
    }


def _hospital_id_for_user(user):
    return getattr(user, 'hospital_id', None)


def _is_active_job(job: JobOpening) -> bool:
    return job.status == 'open' and job.is_active and not job.is_archived


def _employees_for_job(hospital_id, job_opening_id):
    qs = Employee.objects.filter(candidate__job_opening_id=job_opening_id)
    if hospital_id:
        qs = qs.filter(hospital_id=hospital_id)
    return qs


def _employee_ids_for_job(hospital_id, job_opening_id):
    return list(_employees_for_job(hospital_id, job_opening_id).values_list('id', flat=True))


def _compute_pipeline_counts(qs):
    return {
        'applied': qs.filter(status__in=APPLIED_PIPELINE_STATUSES).count(),
        'shortlisted': qs.filter(status='shortlisted').count(),
        'interviews': qs.filter(status='interview').count(),
        'offer_sent': qs.filter(offer_status='sent').count(),
    }


def _global_pipeline_counts(hospital_id):
    qs = Candidate.objects.all()
    if hospital_id:
        qs = qs.filter(job_opening__hospital_id=hospital_id)
    qs = annotate_has_scheduled_interview(qs, Interview)
    return _compute_pipeline_counts(qs)


def _job_pipeline_counts(hospital_id, job_opening_id):
    qs = Candidate.objects.filter(job_opening_id=job_opening_id)
    if hospital_id:
        qs = qs.filter(job_opening__hospital_id=hospital_id)
    qs = annotate_has_scheduled_interview(qs, Interview)
    return _compute_pipeline_counts(qs)


def _global_onboarding_stats(hospital_id):
    emp_qs = Employee.objects.all()
    if hospital_id:
        emp_qs = emp_qs.filter(hospital_id=hospital_id)
    onboarding_qs = emp_qs.filter(status='pending_onboarding')
    onboarding_ids = list(onboarding_qs.values_list('id', flat=True))
    doc_qs = EmployeeDocumentRequirement.objects.filter(employee_id__in=onboarding_ids) if onboarding_ids else EmployeeDocumentRequirement.objects.none()
    documents_to_review = doc_qs.filter(status='uploaded').count()
    awaiting_review = onboarding_qs.filter(
        onboarding_status__in=['documents_uploaded', 'under_review', 'partial_documents'],
    ).count()
    return {
        'documents_to_review': documents_to_review,
        'awaiting_review': awaiting_review,
        'in_onboarding': onboarding_qs.count(),
    }


def _job_onboarding_stats(hospital_id, job_opening_id):
    onboarding_qs = _employees_for_job(hospital_id, job_opening_id).filter(status='pending_onboarding')
    onboarding_ids = list(onboarding_qs.values_list('id', flat=True))
    doc_qs = EmployeeDocumentRequirement.objects.filter(employee_id__in=onboarding_ids) if onboarding_ids else EmployeeDocumentRequirement.objects.none()
    documents_to_review = doc_qs.filter(status='uploaded').count()
    awaiting_review = onboarding_qs.filter(
        onboarding_status__in=['documents_uploaded', 'under_review', 'partial_documents'],
    ).count()

    emp_qs = Employee.objects.all()
    if hospital_id:
        emp_qs = emp_qs.filter(hospital_id=hospital_id)
    linked_candidate_ids = set(
        emp_qs.exclude(candidate__isnull=True).values_list('candidate_id', flat=True),
    )
    accepted_without_employee = Candidate.objects.filter(
        job_opening_id=job_opening_id,
    ).filter(
        models.Q(status='hired') | models.Q(offer_status='accepted'),
    ).exclude(id__in=linked_candidate_ids).count()

    return {
        'documents_to_review': documents_to_review,
        'awaiting_review': awaiting_review,
        'in_onboarding': onboarding_qs.count(),
        'accepted_without_employee': accepted_without_employee,
    }


def _global_hr_kpi(hospital_id):
    emp_qs = Employee.objects.all()
    if hospital_id:
        emp_qs = emp_qs.filter(hospital_id=hospital_id)
    active_employees = emp_qs.filter(status='active').count()
    pending_onboarding = emp_qs.filter(
        onboarding_status__in=['pending_documents', 'documents_uploaded', 'under_review'],
    ).count()
    return {'active_employees': active_employees, 'pending_onboarding': pending_onboarding}


def _job_hr_kpi(hospital_id, job_opening_id):
    emp_qs = _employees_for_job(hospital_id, job_opening_id)
    active_employees = emp_qs.filter(status='active').count()
    pending_onboarding = emp_qs.filter(status='pending_onboarding').count()
    return {'active_employees': active_employees, 'pending_onboarding': pending_onboarding}


def _unique_structure_employees(structures_qs):
    return structures_qs.values('employee_id').distinct().count()


def _count_payroll_eligible(active_employee_ids, structure_employee_ids):
    if not active_employee_ids:
        return 0
    return len(set(active_employee_ids) & structure_employee_ids)


def compute_journey_center_counts(
    user,
    *,
    job_opening_id=None,
    month: str | None = None,
    today: date | None = None,
) -> dict:
    """Return journey step counts and metadata for Journey Center."""
    today = today or timezone.localdate()
    if not month:
        month = today.strftime('%Y-%m')
    hospital_id = _hospital_id_for_user(user)

    if job_opening_id:
        return _compute_job_scoped_counts(hospital_id, job_opening_id, month=month, today=today)

    return _compute_global_counts(hospital_id, month=month, today=today)


def _compute_global_counts(hospital_id, *, month: str, today: date) -> dict:
    pipeline = _global_pipeline_counts(hospital_id)
    stats = _global_onboarding_stats(hospital_id)
    kpi = _global_hr_kpi(hospital_id)

    structures_qs = SalaryStructure.objects.filter(is_active=True)
    if hospital_id:
        structures_qs = structures_qs.filter(employee__hospital_id=hospital_id)

    attendance_summary = build_dashboard_summary(today, hospital_id=hospital_id, force_rebuild=False)

    emp_qs = Employee.objects.filter(status='active')
    if hospital_id:
        emp_qs = emp_qs.filter(hospital_id=hospital_id)
    active_employee_ids = set(emp_qs.values_list('id', flat=True))
    structure_employee_ids = set(structures_qs.values_list('employee_id', flat=True))

    payroll_runs_qs = PayrollRun.objects.filter(month=month)
    if hospital_id:
        payroll_runs_qs = payroll_runs_qs.filter(employee__hospital_id=hospital_id)
    payroll_runs = list(payroll_runs_qs)

    jobs_qs = JobOpening.objects.all()
    if hospital_id:
        jobs_qs = jobs_qs.filter(hospital_id=hospital_id)
    jobs_open = sum(1 for job in jobs_qs if _is_active_job(job))

    counts = {
        'jobs_open': jobs_open,
        'applied': pipeline['applied'],
        'shortlisted': pipeline['shortlisted'],
        'interview': pipeline['interviews'],
        'offer': pipeline['offer_sent'],
        'kyc': stats['documents_to_review'] + stats['awaiting_review'],
        'employee_created': kpi['active_employees'] + kpi['pending_onboarding'],
        'documents': stats['in_onboarding'],
        'salary_assigned': _unique_structure_employees(structures_qs),
        'attendance_active': attendance_summary.get('scheduled_employees', 0),
        'payroll_eligible': _count_payroll_eligible(active_employee_ids, structure_employee_ids),
        'attendance_ready': attendance_summary.get('total_records', 0),
        'payroll_draft': sum(1 for run in payroll_runs if run.status in PAYROLL_NEEDS_ACTION),
        'payroll_locked': sum(1 for run in payroll_runs if run.status == 'LOCKED'),
        'published': sum(1 for run in payroll_runs if run.status == 'PUBLISHED'),
        'payroll_runs': len(payroll_runs),
    }
    return {'counts': counts, 'month': month, 'job_opening': None}


def _compute_job_scoped_counts(hospital_id, job_opening_id, *, month: str, today: date) -> dict:
    job = JobOpening.objects.filter(pk=job_opening_id).first()
    if hospital_id and job and job.hospital_id and job.hospital_id != hospital_id:
        job = None

    pipeline = _job_pipeline_counts(hospital_id, job_opening_id)
    stats = _job_onboarding_stats(hospital_id, job_opening_id)
    kpi = _job_hr_kpi(hospital_id, job_opening_id)

    employee_ids = _employee_ids_for_job(hospital_id, job_opening_id)

    structures_qs = SalaryStructure.objects.filter(is_active=True, employee_id__in=employee_ids)
    structure_employee_ids = set(structures_qs.values_list('employee_id', flat=True))

    active_employee_ids = set(
        _employees_for_job(hospital_id, job_opening_id).filter(status='active').values_list('id', flat=True),
    )

    scheduled_for_job = _employees_for_job(hospital_id, job_opening_id).filter(
        status='active',
        shift__isnull=False,
    ).count()

    attendance_qs = DailyAttendance.objects.filter(date=today, employee_id__in=employee_ids)
    attendance_ready = attendance_qs.count()

    payroll_runs_qs = PayrollRun.objects.filter(month=month, employee_id__in=employee_ids)
    payroll_runs = list(payroll_runs_qs)

    jobs_open = 1 if job and _is_active_job(job) else 0

    kyc_extra = stats.get('accepted_without_employee', 0)
    counts = {
        'jobs_open': jobs_open,
        'applied': pipeline['applied'],
        'shortlisted': pipeline['shortlisted'],
        'interview': pipeline['interviews'],
        'offer': pipeline['offer_sent'],
        'kyc': stats['documents_to_review'] + stats['awaiting_review'] + kyc_extra,
        'employee_created': kpi['active_employees'] + kpi['pending_onboarding'],
        'documents': stats['in_onboarding'],
        'salary_assigned': _unique_structure_employees(structures_qs),
        'attendance_active': scheduled_for_job,
        'payroll_eligible': _count_payroll_eligible(active_employee_ids, structure_employee_ids),
        'attendance_ready': attendance_ready,
        'payroll_draft': sum(1 for run in payroll_runs if run.status in PAYROLL_NEEDS_ACTION),
        'payroll_locked': sum(1 for run in payroll_runs if run.status == 'LOCKED'),
        'published': sum(1 for run in payroll_runs if run.status == 'PUBLISHED'),
        'payroll_runs': len(payroll_runs),
    }
    job_title = job.title if job else None
    completion = compute_job_completion(
        job=job,
        hospital_id=hospital_id,
        job_opening_id=job_opening_id,
        today=today,
        month=month,
        stats=stats,
        kpi=kpi,
        employee_ids=employee_ids,
        active_employee_ids=active_employee_ids,
        structure_employee_ids=structure_employee_ids,
        scheduled_for_job=scheduled_for_job,
        attendance_ready=attendance_ready,
        payroll_runs=payroll_runs,
    )
    return {
        'counts': counts,
        'month': month,
        'job_opening': str(job_opening_id),
        'job_title': job_title,
        'completion': completion,
    }
