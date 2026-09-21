"""Build portal PWA manifest JSON with hospital branding from Reception settings."""

from __future__ import annotations

from apps.settings_management.models import ReceptionPortalSettings
from apps.shared.models import Hospital

ROLE_MANIFEST_SUFFIX = {
    "doctor": "Doctor",
    "pharmacy": "Pharmacy",
    "receptionist": "Reception",
    "staff": "Staff",
    "lab": "Lab",
    "admin": "Admin",
}

FALLBACK_SHORT = {
    "doctor": "Doctor",
    "pharmacy": "Pharmacy",
    "receptionist": "Reception",
    "staff": "Staff",
    "lab": "Lab",
    "admin": "Admin",
}

MANIFEST_BASE = {
    "doctor": {
        "start_url": "/doctor",
        "scope": "/",
        "display": "standalone",
        "orientation": "any",
        "theme_color": "#0f172a",
        "background_color": "#ffffff",
        "icons": [
            {"src": "/icons/icon-doctor-192.png", "sizes": "192x192", "type": "image/png", "purpose": "any maskable"},
            {"src": "/icons/icon-doctor-512.png", "sizes": "512x512", "type": "image/png", "purpose": "any maskable"},
        ],
        "description": "Doctor web app",
    },
    "pharmacy": {
        "start_url": "/pharmacy",
        "scope": "/",
        "display": "standalone",
        "orientation": "any",
        "theme_color": "#0f172a",
        "background_color": "#ffffff",
        "icons": [
            {"src": "/icons/icon-pharmacy-192.png", "sizes": "192x192", "type": "image/png", "purpose": "any maskable"},
            {"src": "/icons/icon-pharmacy-512.png", "sizes": "512x512", "type": "image/png", "purpose": "any maskable"},
        ],
        "description": "Pharmacy web app",
    },
    "receptionist": {
        "start_url": "/receptionist",
        "scope": "/",
        "display": "standalone",
        "orientation": "any",
        "theme_color": "#0f172a",
        "background_color": "#ffffff",
        "icons": [
            {"src": "/icons/icon-reception-192.png", "sizes": "192x192", "type": "image/png", "purpose": "any maskable"},
            {"src": "/icons/icon-reception-512.png", "sizes": "512x512", "type": "image/png", "purpose": "any maskable"},
        ],
        "description": "Reception web app",
    },
    "staff": {
        "start_url": "/staff",
        "scope": "/",
        "display": "standalone",
        "orientation": "any",
        "theme_color": "#0f172a",
        "background_color": "#ffffff",
        "icons": [
            {"src": "/icons/icon-staff-192.png", "sizes": "192x192", "type": "image/png", "purpose": "any maskable"},
            {"src": "/icons/icon-staff-512.png", "sizes": "512x512", "type": "image/png", "purpose": "any maskable"},
        ],
        "description": "Staff web app",
    },
}

MANIFEST_BASE["lab"] = {
    **MANIFEST_BASE["staff"],
    "start_url": "/lab",
    "description": "Lab web app",
}

MANIFEST_BASE["admin"] = {
    **MANIFEST_BASE["staff"],
    "start_url": "/admin",
    "description": "Admin web app",
}

VALID_PORTALS = frozenset(MANIFEST_BASE.keys())
DEFAULT_HOSPITAL_NAME = "Vardaan"


def _truncate_short_name(name: str, max_len: int = 12) -> str:
    text = (name or "").strip()
    if not text:
        return ""
    if len(text) <= max_len:
        return text
    return f"{text[: max_len - 1]}…"


def _build_description(settings: ReceptionPortalSettings | None) -> str:
    if settings is None:
        return ""
    parts = [
        p
        for p in (settings.address, settings.pin_code, settings.phone)
        if p and str(p).strip()
    ]
    return " · ".join(parts)


def _load_reception_settings(hospital_id: str | None) -> ReceptionPortalSettings | None:
    if not hospital_id:
        return None
    try:
        hospital = Hospital.objects.filter(pk=hospital_id).first()
    except (ValueError, TypeError):
        return None
    if hospital is None:
        return None
    return ReceptionPortalSettings.objects.filter(hospital=hospital).first()


def build_pwa_manifest(portal: str, hospital_id: str | None = None) -> dict:
    role_key = portal if portal in VALID_PORTALS else "staff"
    base = MANIFEST_BASE[role_key]
    suffix = ROLE_MANIFEST_SUFFIX[role_key]

    settings = _load_reception_settings(hospital_id)
    hospital_name = DEFAULT_HOSPITAL_NAME
    if settings and settings.hospital_name and settings.hospital_name.strip():
        hospital_name = settings.hospital_name.strip()
    elif settings and settings.hospital and settings.hospital.name:
        hospital_name = settings.hospital.name.strip()

    short_name = _truncate_short_name(hospital_name, 12) or FALLBACK_SHORT[role_key]
    description = _build_description(settings) or base["description"]

    return {
        **base,
        "name": f"{hospital_name} – {suffix}",
        "short_name": short_name,
        "description": description,
    }
