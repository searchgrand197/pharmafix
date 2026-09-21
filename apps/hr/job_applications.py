"""Shared rules for whether a job opening accepts candidate applications."""

from django.utils import timezone

APPLICATION_CLOSED_MESSAGE = 'This job is no longer accepting applications.'
POSITION_CLOSED_MESSAGE = 'This position is no longer accepting applications.'
APPLICATIONS_CLOSED_LABEL = 'Applications Closed'
HR_EXPIRY_DATE_PAST_ERROR = 'Last date to apply cannot be in the past.'
HR_EXPIRY_DATE_REQUIRED_ERROR = 'Last date to apply is required.'
DEADLINE_PASSED_MESSAGE = 'The application deadline for this position has passed.'


def local_today():
    """Timezone-aware local date for deadline comparisons (midnight cutoff)."""
    return timezone.localdate()


def is_job_expired(job, *, on_date=None) -> bool:
    """True when today is after the last date to apply."""
    if job is None or not job.expiry_date:
        return False
    today = on_date or local_today()
    return job.expiry_date < today


def validate_hr_expiry_date(value, *, required=True):
    """
    HR create/edit: expiry_date must be today or in the future.
    Raises ValueError with message suitable for DRF ValidationError.
    """
    if value is None:
        if required:
            raise ValueError(HR_EXPIRY_DATE_REQUIRED_ERROR)
        return value
    if value < local_today():
        raise ValueError(HR_EXPIRY_DATE_PAST_ERROR)
    return value


def job_accepts_applications(job) -> bool:
    """Only open, active, non-archived jobs within the application window accept candidates."""
    if job is None:
        return False
    if job.is_archived:
        return False
    if not job.is_active:
        return False
    if job.status != 'open':
        return False
    if not job.expiry_date:
        return False
    if is_job_expired(job):
        return False
    return True


def get_application_block_message(job) -> str:
    """User-facing message when applications are not accepted."""
    if job is None:
        return APPLICATION_CLOSED_MESSAGE
    if is_job_expired(job):
        return DEADLINE_PASSED_MESSAGE
    if job.status == 'closed':
        return POSITION_CLOSED_MESSAGE
    if job.status == 'on_hold':
        return 'Recruitment for this position is temporarily on hold.'
    if job.status == 'draft':
        return 'This position is not yet open for applications.'
    if job.is_archived or job.status == 'archived':
        return APPLICATION_CLOSED_MESSAGE
    if not job.expiry_date:
        return APPLICATION_CLOSED_MESSAGE
    return APPLICATION_CLOSED_MESSAGE


def get_application_closed_title(job) -> str:
    """Heading for public apply page when applications are blocked."""
    if job and is_job_expired(job):
        return APPLICATIONS_CLOSED_LABEL
    return 'Applications closed'


def maybe_auto_close_expired_job(job) -> bool:
    """
    If an open job is past its deadline, mark it closed (optional pipeline hygiene).
    Returns True if the job was updated.
    """
    if job is None or job.status != 'open' or not is_job_expired(job):
        return False
    job.status = 'closed'
    job.is_active = False
    job.save(update_fields=['status', 'is_active', 'updated_at'])
    return True
