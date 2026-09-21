from datetime import timedelta
from pathlib import Path

import environ

BASE_DIR = Path(__file__).resolve().parent.parent

env = environ.Env(
    DEBUG=(bool, False),
    DJANGO_ENV=(str, "development"),
)

env_file = BASE_DIR / ".env"
if env_file.exists():
    import io as _io
    import re as _re_env

    def _normalize_env_text(text: str) -> str:
        """
        Rewrite multi-line Python list values in a .env file so django-environ
        can parse them without "Invalid line" warnings.

        Example — converts:
            CORS_ALLOWED_ORIGINS = [
                "https://a.com",
                "https://b.com"
            ]
        to:
            CORS_ALLOWED_ORIGINS=https://a.com,https://b.com
        """
        def _flatten(m: "_re_env.Match") -> str:
            key = m.group(1).strip()
            body = m.group(2)
            # Extract every quoted string from the bracket body
            values = _re_env.findall(r'["\']([^"\']+)["\']', body)
            return f"{key}={','.join(values)}"

        return _re_env.sub(
            r'^([\w]+)\s*=\s*\[([^\]]*)\]',
            _flatten,
            text,
            flags=_re_env.MULTILINE | _re_env.DOTALL,
        )

    _env_raw = env_file.read_text(encoding="utf-8")
    env.read_env(_io.StringIO(_normalize_env_text(_env_raw)))


# SECURITY
# In production, set SECRET_KEY in .env. This default is for local/dev only.
SECRET_KEY = env("SECRET_KEY", default="dev-insecure-change-me")


DEBUG = env("DEBUG", default=False)

ALLOWED_HOSTS = env.list("ALLOWED_HOSTS", default=["*"])


# Application definition
INSTALLED_APPS = [
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    # 3rd party
    "corsheaders",
    "rest_framework",
    "django_filters",
    "drf_spectacular",
    "rest_framework_simplejwt.token_blacklist",
    # HMS apps
    "apps.shared",
    "apps.accounts",
    "apps.roles_permissions",
    "apps.patients",
    "apps.opd",
    "apps.ipd",
    "apps.billing",
    "apps.payments",
    "apps.expenses",
    "apps.auditlogs",
    "apps.doctors",
    "apps.staff",
    "apps.appointments",
    "apps.tokens",
    "apps.inventory",
    "apps.prescriptions",
    "apps.pharmacy",
    "apps.lab",
    "apps.followups",
    "apps.attendance",
    "apps.beds",
    "apps.nursing",
    "apps.emergency",
    "apps.documents",
    "apps.notifications",
    "apps.reports",
    "apps.dashboard",
    "apps.settings_management",
    "apps.referrals",
    "apps.insurance",
    "apps.discharge",
    "apps.treatment",
    "apps.opd_templates",
    "apps.hr",
]

MIDDLEWARE = [
    "corsheaders.middleware.CorsMiddleware",
    "django.middleware.security.SecurityMiddleware",
    "whitenoise.middleware.WhiteNoiseMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    # Must come AFTER AuthenticationMiddleware so request.user is available
    "apps.shared.pharmacy_middleware.PharmacyBranchMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]

ROOT_URLCONF = "config.urls"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [BASE_DIR / "templates"],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.debug",
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ],
        },
    },
]

WSGI_APPLICATION = "config.wsgi.application"


# Database (PostgreSQL-ready with env vars)
POSTGRES_DB = env("POSTGRES_DB", default="")
if POSTGRES_DB:
    DATABASES = {
        "default": {
            "ENGINE": "django.db.backends.postgresql",
            "NAME": POSTGRES_DB,
            "USER": env("POSTGRES_USER", default="postgres"),
            "PASSWORD": env("POSTGRES_PASSWORD", default="postgres"),
            "HOST": env("POSTGRES_HOST", default="localhost"),
            "PORT": env("POSTGRES_PORT", default="5432"),
        }
    }
else:
    # Prefer SQLITE_PATH outside the git tree so pulls/resets cannot touch client data.
    _sqlite_name = env("SQLITE_PATH", default="") or str(BASE_DIR / "db.sqlite3")
    DATABASES = {
        "default": {
            "ENGINE": "django.db.backends.sqlite3",
            "NAME": _sqlite_name,
            "OPTIONS": {
                # Biometric device polling + HR writes contend on SQLite without this.
                "timeout": 30,
            },
        }
    }


# Password validation
AUTH_PASSWORD_VALIDATORS = [
    {
        "NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator",
    },
    {
        "NAME": "django.contrib.auth.password_validation.MinimumLengthValidator",
    },
    {
        "NAME": "django.contrib.auth.password_validation.CommonPasswordValidator",
    },
    {
        "NAME": "django.contrib.auth.password_validation.NumericPasswordValidator",
    },
]


# Internationalization
LANGUAGE_CODE = env("LANGUAGE_CODE", default="en-us")
TIME_ZONE = env("TIME_ZONE", default="Asia/Kolkata")
USE_I18N = True
USE_TZ = True

# Attendance: late_minutes = shift_start (default) | after_grace
ATTENDANCE_LATE_MINUTES_BASIS = env(
    "ATTENDANCE_LATE_MINUTES_BASIS",
    default="shift_start",
)

# Payroll: minutes above threshold incur late penalty (rate defaults to per-day / 480)
PAYROLL_LATE_PENALTY_THRESHOLD_MINUTES = env.int(
    "PAYROLL_LATE_PENALTY_THRESHOLD_MINUTES",
    default=15,
)
PAYROLL_LATE_PENALTY_RATE_PER_MINUTE = env(
    "PAYROLL_LATE_PENALTY_RATE_PER_MINUTE",
    default="0",
)


# Static/media
STATIC_URL = "static/"
STATIC_ROOT = BASE_DIR / "staticfiles"
STATICFILES_STORAGE = "whitenoise.storage.CompressedManifestStaticFilesStorage"

# Vite production build (`npm run build` in frontend/)
FRONTEND_BUILD_DIR = BASE_DIR / "frontend" / "dist"
SERVE_FRONTEND = env.bool("SERVE_FRONTEND", default=True)

MEDIA_URL = "/media/"
MEDIA_ROOT = BASE_DIR / "media"

DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"


# Auth / DRF / API format
AUTH_USER_MODEL = "accounts.User"

REST_FRAMEWORK = {
    "DEFAULT_AUTHENTICATION_CLASSES": (
        "rest_framework_simplejwt.authentication.JWTAuthentication",
    ),
    "DEFAULT_PERMISSION_CLASSES": (
        "rest_framework.permissions.IsAuthenticated",
    ),
    "DEFAULT_SCHEMA_CLASS": "drf_spectacular.openapi.AutoSchema",
    "DEFAULT_FILTER_BACKENDS": (
        "django_filters.rest_framework.DjangoFilterBackend",
        "rest_framework.filters.SearchFilter",
        "rest_framework.filters.OrderingFilter",
    ),
    "DEFAULT_PAGINATION_CLASS": "apps.shared.pagination.StandardLimitOffsetPagination",
    "PAGE_SIZE": env.int("PAGE_SIZE", default=20),
    "EXCEPTION_HANDLER": "apps.shared.exception_handler.api_exception_handler",
}


SIMPLE_JWT = {
    "ACCESS_TOKEN_LIFETIME": timedelta(minutes=env.int("ACCESS_TOKEN_LIFETIME_MINUTES", default=30)),
    "REFRESH_TOKEN_LIFETIME": timedelta(days=env.int("REFRESH_TOKEN_LIFETIME_DAYS", default=7)),
    "ROTATE_REFRESH_TOKENS": True,
    "BLACKLIST_AFTER_ROTATION": True,
    "AUTH_HEADER_TYPES": ("Bearer",),
    # Login JSON + JWT claims include hospital_id / hospital_name (see apps.accounts.token_serializers)
    "TOKEN_OBTAIN_SERIALIZER": "apps.accounts.token_serializers.HospitalTenantTokenObtainPairSerializer",
}


SPECTACULAR_SETTINGS = {
    "TITLE": "Hospital Management System API",
    "DESCRIPTION": "HMS backend REST API",
    "VERSION": "v1",
    "SERVE_INCLUDE_SCHEMA": False,
    "COMPONENT_SPLIT_REQUEST": True,
}


# Email / SMTP (loaded from .env for security)
EMAIL_BACKEND = env.str("EMAIL_BACKEND", default="django.core.mail.backends.smtp.EmailBackend")
EMAIL_HOST = env.str("EMAIL_HOST", default="smtpout.secureserver.net")
EMAIL_PORT = env.int("EMAIL_PORT", default=465)
EMAIL_USE_SSL = env.bool("EMAIL_USE_SSL", default=True)
EMAIL_USE_TLS = env.bool("EMAIL_USE_TLS", default=False)
EMAIL_HOST_USER = env.str("EMAIL_HOST_USER", default="")
EMAIL_HOST_PASSWORD = env.str("EMAIL_HOST_PASSWORD", default="")
DEFAULT_FROM_EMAIL = env.str("DEFAULT_FROM_EMAIL", default=EMAIL_HOST_USER or "webmaster@localhost")
SERVER_EMAIL = env.str("SERVER_EMAIL", default=DEFAULT_FROM_EMAIL)
EMAIL_USE_LOCALTIME = env.bool("EMAIL_USE_LOCALTIME", default=True)
EMAIL_TIMEOUT = 30

# Base URL used for building absolute links in emails (e.g. leave approval buttons).
# Override this in production with your actual domain.
SITE_BASE_URL = env.str("SITE_BASE_URL", default="http://127.0.0.1:8000")
# Public frontend origin for onboarding/portal links (e.g. http://192.168.x.x:8000 on LAN).
# When empty and SERVE_FRONTEND=1, falls back to SITE_BASE_URL; else http://localhost:5173.
FRONTEND_BASE_URL = env.str("FRONTEND_BASE_URL", default="")


# CORS
CORS_ALLOW_ALL_ORIGINS = env.bool("CORS_ALLOW_ALL_ORIGINS", default=False)

# CORS_ALLOWED_ORIGINS must be a comma-separated list in .env:
#   CORS_ALLOWED_ORIGINS=https://a.com,https://b.com
# Also accepts a JSON array on ONE line:
#   CORS_ALLOWED_ORIGINS=["https://a.com","https://b.com"]
# Multi-line Python list syntax in .env is NOT supported — use the formats above.
def _parse_cors_origins(raw: str) -> list:
    import json as _json
    raw = raw.strip()
    if not raw:
        return []
    # JSON array on one line
    if raw.startswith("["):
        try:
            parsed = _json.loads(raw)
            if isinstance(parsed, list):
                return [str(u).strip() for u in parsed if str(u).strip()]
        except Exception:
            pass
    # Comma-separated
    return [u.strip() for u in raw.split(",") if u.strip()]

CORS_ALLOWED_ORIGINS = _parse_cors_origins(env.str("CORS_ALLOWED_ORIGINS", default=""))
CORS_ALLOW_CREDENTIALS = True

CORS_ALLOW_HEADERS = [
    "accept",
    "accept-encoding",
    "authorization",
    "content-type",
    "dnt",
    "origin",
    "user-agent",
    "x-csrftoken",
    "x-requested-with",
    # Custom header for pharmacy branch selection on login page
    "x-pharmacy-branch",
]

# Allow PDFs to be displayed in iframes from same origin
X_FRAME_OPTIONS = "SAMEORIGIN"



# Minimal logging
LOGGING = {
    "version": 1,
    "disable_existing_loggers": False,
    "handlers": {"console": {"class": "logging.StreamHandler"}},
    "loggers": {
        "hr.security": {"handlers": ["console"], "level": "WARNING", "propagate": False},
        "apps.hr.biometric": {"handlers": ["console"], "level": "INFO", "propagate": False},
    },
    "root": {"handlers": ["console"], "level": env("LOG_LEVEL", default="INFO")},
}

# Web push (VAPID) for mobile/laptop notifications while app is backgrounded.
# Set these in .env to enable push delivery.
WEBPUSH_PUBLIC_KEY = env.str("WEBPUSH_PUBLIC_KEY", default="")
WEBPUSH_PRIVATE_KEY = env.str("WEBPUSH_PRIVATE_KEY", default="")
WEBPUSH_SUB_EMAIL = env.str("WEBPUSH_SUB_EMAIL", default="")

