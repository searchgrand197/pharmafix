from config.settings_common import *  # noqa


DEBUG = True
ALLOWED_HOSTS = ["*"]

# For local development, allow all origins unless the user explicitly configures CORS.
CORS_ALLOW_ALL_ORIGINS = True

# Keep the backend configurable via .env (default comes from settings_common).
# Optional: force console email in local-only debugging:
# EMAIL_BACKEND = "django.core.mail.backends.console.EmailBackend"


