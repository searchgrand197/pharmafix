"""
URL configuration for config project.

The `urlpatterns` list routes URLs to views. For more information please see:
    https://docs.djangoproject.com/en/5.0/topics/http/urls/
Examples:
Function views
    1. Add an import:  from my_app import views
    2. Add a URL to urlpatterns:  path('', views.home, name='home')
Class-based views
    1. Add an import:  from other_app.views import Home
    2. Add a URL to urlpatterns:  path('', Home.as_view(), name='home')
Including another URLconf
    1. Import the include() function: from django.urls import include, path
    2. Add a URL to urlpatterns:  path('blog/', include('blog.urls'))
"""
from django.contrib import admin
from django.urls import include, path, re_path
from django.conf import settings
from django.conf.urls.static import static
from django.views.static import serve as static_serve

from drf_spectacular.views import SpectacularAPIView

from apps.attendance.leave_action_view import LeaveActionView
from apps.hr.views import accept_offer_view, reject_offer_view
from config.views import ApiConsoleView, FieldPermissionMatrixPageView, frontend_index

urlpatterns = [
    # Frontend (Vite build output)
    path("", frontend_index, name="frontend-home"),
    re_path(
        r"^assets/(?P<path>.*)$",
        static_serve,
        {"document_root": settings.BASE_DIR / "frontend" / "dist" / "assets"},
    ),
    re_path(
        r"^(?P<path>(favicon\.svg|icons\.svg|hero-3d\.png|manifest\.json|manifest-doctor\.json|manifest-staff\.json|manifest-pharmacy\.json|manifest-receptionist\.json|sw\.js|offline\.html))$",
        static_serve,
        {"document_root": settings.BASE_DIR / "frontend" / "dist"},
    ),
    re_path(
        r"^icons/(?P<path>.*)$",
        static_serve,
        {"document_root": settings.BASE_DIR / "frontend" / "dist" / "icons"},
    ),
    # One-click leave approve/deny from email — no login required
    path("leave/action/<str:token>/", LeaveActionView.as_view(), name="leave-action"),
    # Offer accept/reject via token — no login required
    path("offer/accept/<uuid:token>/", accept_offer_view, name="offer-accept"),
    path("offer/reject/<uuid:token>/", reject_offer_view, name="offer-reject"),
    # OpenAPI schema + branded Swagger UI (HTML/CSS in templates/api_console.html)
    path("api/schema/", SpectacularAPIView.as_view(), name="api-schema"),
    path("api/v1/schema/", SpectacularAPIView.as_view(), name="api-schema-v1"),
    path(
        "api/v1/docs/",
        ApiConsoleView.as_view(),
        name="swagger-ui",
    ),
    path("ui/field-permissions/", FieldPermissionMatrixPageView.as_view(), name="field-permissions-ui"),
    # Django admin (not at /admin — that URL is used by the React SPA admin portal)
    path("django-admin/", admin.site.urls),
    # API v1 — single router so GET /api/v1/ lists all ViewSet roots (see config.api_v1_router_urls)
    path("api/v1/", include("apps.accounts.api_urls")),
    path("api/v1/", include("apps.roles_permissions.api_urls")),
    path("api/v1/", include("apps.payments.api_urls")),
    path("api/v1/", include("config.api_v1_router_urls")),
    path("api/v1/", include("apps.prescriptions.api_urls")),
    path("api/v1/", include("apps.pharmacy.api_urls")),
    path("api/v1/", include("apps.lab.api_urls")),
    path("api/v1/", include("apps.attendance.api_urls")),
    path("api/v1/", include("apps.beds.api_urls")),
    path("api/v1/", include("apps.nursing.api_urls")),
    path("api/v1/", include("apps.emergency.api_urls")),
    path("api/v1/", include("apps.documents.api_urls")),
    path("api/v1/", include("apps.notifications.api_urls")),
    path("api/v1/reports/", include("apps.reports.api_urls")),
    path("api/v1/", include("apps.dashboard.api_urls")),
    path("api/v1/", include("apps.settings_management.api_urls")),
    path("api/v1/", include("apps.referrals.api_urls")),
    path("api/v1/", include("apps.insurance.api_urls")),
    path("api/v1/", include("apps.discharge.api_urls")),
    path("api/v1/", include("apps.hr.api_urls")),
    # ESSL K90 Pro / ZKTeco ADMS device protocol (CSRF-exempt, plain HTTP)
    path("iclock/", include("apps.hr.biometric.urls_iclock")),
    # Payroll engine REST exposure (wrappers around existing services)
    path("api/payroll/", include("apps.hr.payroll_api.urls")),
    # HR public job application URLs
    path("", include("apps.hr.urls")),
    # OPD Templates (replaces Node.js server.js — /api/templates, /api/print, etc.)
    path("", include("apps.opd_templates.urls")),
    # SPA fallback: direct browser refresh/open for frontend routes should load index.html
    re_path(
        r"^(?!api/|media/|static/|leave/|offer/|iclock/|ui/|django-admin/|template/|icons/|jobs/|sw\.js|manifest\.json|manifest-doctor\.json|manifest-staff\.json|manifest-pharmacy\.json|manifest-receptionist\.json|offline\.html).*$",
        frontend_index,
        name="frontend-spa-fallback",
    ),
] + static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)
