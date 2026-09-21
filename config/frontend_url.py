"""Resolve the public frontend base URL for email and portal links."""

from django.conf import settings


def get_frontend_base_url() -> str:
    """FRONTEND_BASE_URL → SITE_BASE_URL (when SERVE_FRONTEND) → localhost:5173."""
    base = (getattr(settings, 'FRONTEND_BASE_URL', None) or '').rstrip('/')
    if base:
        return base
    if getattr(settings, 'SERVE_FRONTEND', False):
        site = (getattr(settings, 'SITE_BASE_URL', None) or '').rstrip('/')
        if site:
            return site
    return 'http://localhost:5173'


def get_site_base_url() -> str:
    """Public Django site origin for server-rendered pages (job apply, offers, etc.)."""
    site = (getattr(settings, 'SITE_BASE_URL', None) or '').rstrip('/')
    if site:
        return site
    if getattr(settings, 'SERVE_FRONTEND', False):
        return get_frontend_base_url()
    return 'http://127.0.0.1:8000'


def get_job_apply_url(job_code: str, request=None) -> str:
    """Absolute URL for the public job application form."""
    path = f'/jobs/{job_code}/apply/'
    if request is not None:
        return request.build_absolute_uri(path)
    return f'{get_site_base_url()}{path}'
