"""Login portal codes shown on the HMS login page."""

from __future__ import annotations

ALL_PORTAL_CODES: tuple[str, ...] = (
    "staff",
    "doctor",
    "receptionist",
    "lab",
    "pharmacy",
    "admin",
    "hr",
    "employee",
)

PORTAL_LABELS: dict[str, str] = {
    "staff": "Staff",
    "doctor": "Doctor",
    "receptionist": "Receptionist",
    "lab": "Lab",
    "pharmacy": "Pharmacy",
    "admin": "Admin",
    "hr": "HR",
    "employee": "Employee",
}
