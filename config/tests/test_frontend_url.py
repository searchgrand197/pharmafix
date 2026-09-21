from django.test import SimpleTestCase, override_settings

from config.frontend_url import get_frontend_base_url, get_job_apply_url, get_site_base_url


class FrontendBaseUrlTests(SimpleTestCase):
    @override_settings(FRONTEND_BASE_URL='http://192.168.1.10:8000')
    def test_explicit_frontend_base_url(self):
        self.assertEqual(get_frontend_base_url(), 'http://192.168.1.10:8000')

    @override_settings(FRONTEND_BASE_URL='', SERVE_FRONTEND=True, SITE_BASE_URL='http://192.168.1.10:8000')
    def test_falls_back_to_site_base_when_serving_frontend(self):
        self.assertEqual(get_frontend_base_url(), 'http://192.168.1.10:8000')

    @override_settings(FRONTEND_BASE_URL='', SERVE_FRONTEND=False, SITE_BASE_URL='http://127.0.0.1:8000')
    def test_falls_back_to_vite_dev_default(self):
        self.assertEqual(get_frontend_base_url(), 'http://localhost:5173')

    @override_settings(FRONTEND_BASE_URL='', SERVE_FRONTEND=True, SITE_BASE_URL='http://192.168.29.93:8000')
    def test_onboarding_upload_url_uses_site_base_on_lan(self):
        from types import SimpleNamespace
        from unittest.mock import patch

        from apps.hr.onboarding_documents import get_onboarding_upload_url

        employee = SimpleNamespace()
        offer = SimpleNamespace(token='00000000-0000-0000-0000-000000000001', onboarding_token_expired=False)

        with patch('apps.hr.onboarding_documents.get_employee_offer', return_value=offer):
            url = get_onboarding_upload_url(employee)

        self.assertEqual(
            url,
            'http://192.168.29.93:8000/offer/onboarding/00000000-0000-0000-0000-000000000001',
        )

    @override_settings(SITE_BASE_URL='http://192.168.29.79:8000')
    def test_job_apply_url_uses_site_base(self):
        self.assertEqual(
            get_job_apply_url('JOB001'),
            'http://192.168.29.79:8000/jobs/JOB001/apply/',
        )

    @override_settings(SITE_BASE_URL='http://192.168.29.79:8000')
    def test_site_base_url(self):
        self.assertEqual(get_site_base_url(), 'http://192.168.29.79:8000')
