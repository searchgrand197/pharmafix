"""Recruitment candidate list: pipeline tabs, annotations, filters."""
from django.db.models import Exists, OuterRef, Q


def normalize_application_email(email: str) -> str:
    """Normalize candidate email for storage and duplicate checks (case-insensitive)."""
    from apps.shared.email_normalization import normalize_email_address
    return normalize_email_address(email)

INTERVIEW_SCHEDULED = 'interview_scheduled'
INTERVIEW_COMPLETED = 'interview_completed'
INTERVIEW_ALL = 'interview_all'

# Applied tab / journey step: pending applications plus early rejections for HR review.
APPLIED_PIPELINE_STATUSES = frozenset({'applied', 'rejected'})


def annotate_has_scheduled_interview(qs, interview_model):
    scheduled_sq = interview_model.objects.filter(
        candidate_id=OuterRef('pk'),
        status=interview_model.STATUS_SCHEDULED,
    )
    return qs.annotate(_has_scheduled_interview=Exists(scheduled_sq))


def apply_pipeline_filter(qs, pipeline, interview_model):
    """Narrow queryset by pipeline tab (pipeline is lowercased string or 'all')."""
    if not pipeline or pipeline == 'all':
        return qs
    pipeline = pipeline.lower().strip()

    if pipeline == 'applied':
        return qs.filter(status__in=APPLIED_PIPELINE_STATUSES)
    if pipeline == 'shortlisted':
        return qs.filter(status='shortlisted')
    if pipeline == INTERVIEW_ALL or pipeline == 'interviews':
        return qs.filter(status='interview')
    if pipeline == INTERVIEW_SCHEDULED:
        return qs.filter(status='interview', _has_scheduled_interview=True)
    if pipeline == INTERVIEW_COMPLETED:
        return qs.filter(
            status='interview',
            interview_status='completed',
            _has_scheduled_interview=False,
        )
    if pipeline == 'selected':
        return qs.filter(status='selected')
    if pipeline == 'offer_sent':
        return qs.filter(offer_status='sent')
    if pipeline == 'offer_accepted':
        return qs.filter(offer_status='accepted')
    if pipeline == 'hired':
        return qs.filter(status='hired')
    if pipeline == 'rejected':
        return qs.filter(status='rejected')
    return qs


def apply_search(qs, raw):
    if not raw:
        return qs
    s = raw.strip()
    if not s:
        return qs
    q = (
        Q(name__icontains=s)
        | Q(email__icontains=s)
        | Q(phone__icontains=s)
        | Q(application_code__icontains=s)
        | Q(profile__candidate_code__icontains=s)
    )
    if s.isdigit():
        try:
            q |= Q(serial_number=int(s))
        except (TypeError, ValueError):
            pass
    return qs.filter(q)


def compute_pipeline_stage(candidate, has_scheduled=None):
    """Derive stable pipeline stage code for UI badges (matches tab keys where possible)."""
    st = candidate.status
    if st == 'rejected':
        return 'rejected'
    if st == 'hired':
        return 'hired'
    if st == 'applied':
        return 'applied'
    if st == 'shortlisted':
        return 'shortlisted'
    if st == 'selected':
        os = candidate.offer_status or 'pending'
        if os == 'sent':
            return 'offer_sent'
        if os == 'accepted':
            return 'offer_accepted'
        if os == 'declined':
            return 'offer_declined'
        return 'selected'
    if st == 'interview':
        from apps.hr.models import Interview as InterviewModel

        if has_scheduled is None:
            has_scheduled = candidate.interviews.filter(
                status=InterviewModel.STATUS_SCHEDULED
            ).exists()
        if has_scheduled:
            return INTERVIEW_SCHEDULED
        if candidate.interview_status == 'completed':
            return INTERVIEW_COMPLETED
        return 'interview_pending'
    return st


def apply_shared_candidate_filters(qs, query_params, interview_model, *, apply_pipeline=True, apply_search_flag=True):
    """Apply URL filters shared between list and pipeline counts."""
    qp = query_params

    if qp.get('job_id'):
        qs = qs.filter(job_opening_id=qp.get('job_id'))
    if qp.get('job_opening'):
        qs = qs.filter(job_opening_id=qp.get('job_opening'))

    dept = qp.get('department') or qp.get('department_id')
    if dept:
        qs = qs.filter(job_opening__department_id=dept)

    if qp.get('interview_status'):
        qs = qs.filter(interview_status=qp.get('interview_status'))
    if qp.get('offer_status'):
        qs = qs.filter(offer_status=qp.get('offer_status'))

    exp = (qp.get('experience') or '').strip()
    if exp:
        qs = qs.filter(experience__icontains=exp)

    src = (qp.get('source') or qp.get('application_source') or '').strip()
    if src:
        qs = qs.filter(application_source__icontains=src)

    applied_from = qp.get('applied_from')
    applied_to = qp.get('applied_to')
    if applied_from:
        qs = qs.filter(created_at__date__gte=applied_from)
    if applied_to:
        qs = qs.filter(created_at__date__lte=applied_to)

    if apply_search_flag:
        search_raw = qp.get('search') or qp.get('q')
        qs = apply_search(qs, search_raw or '')

    if apply_pipeline:
        pipeline = qp.get('pipeline')
        qs = apply_pipeline_filter(qs, pipeline, interview_model)

    status_filter = qp.get('status')
    if status_filter:
        qs = qs.filter(status=status_filter)

    interview_round = (qp.get('interview_round') or '').strip().lower()
    if interview_round == 'scheduled':
        qs = qs.filter(status='interview', _has_scheduled_interview=True)
    elif interview_round == 'completed':
        qs = qs.filter(
            status='interview',
            interview_status='completed',
            _has_scheduled_interview=False,
        )

    return qs


PIPELINE_STAGE_LABEL = {
    'applied': 'Applied',
    'shortlisted': 'Shortlisted',
    INTERVIEW_SCHEDULED: 'Interview scheduled',
    'interview_pending': 'Interview',
    INTERVIEW_COMPLETED: 'Interview completed',
    'selected': 'Selected',
    'offer_sent': 'Offer sent',
    'offer_accepted': 'Offer accepted',
    'offer_declined': 'Offer declined',
    'hired': 'Hired',
    'rejected': 'Rejected',
}
