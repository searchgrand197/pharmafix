"""One-off audit script — DO NOT commit to repo long-term."""
import json
import os
import sys

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")

import django

django.setup()

from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.utils import timezone
from rest_framework.test import APIClient

from apps.hr.manual_employee import create_manual_employee
from apps.hr.models import (
    Employee,
    EmployeeDocumentAuditLog,
    DocumentType,
    EmployeeDocumentRequirement,
)
from apps.hr.onboarding_documents import activate_employee_after_verification
from apps.hr.portal_provisioning import provision_employee_portal
from apps.shared.models import Hospital

User = get_user_model()
hr = User.objects.filter(is_staff=True).first()
hospital = Hospital.objects.first()
client = APIClient()
results = {}


def cleanup(email):
    Employee.objects.filter(email__iexact=email).delete()
    User.objects.filter(email__iexact=email).delete()


# TEST 1: Active manual create
email1 = "audit.active@test.local"
cleanup(email1)
with patch("apps.hr.email_utils._safe_smtp_send", return_value=True):
    with patch(
        "apps.hr.portal_provisioning.generate_secure_temporary_password",
        return_value="Audit1!234567",
    ):
        emp1, meta1 = create_manual_employee(
            hr_user=hr,
            hospital=hospital,
            payload={
                "name": "Audit Active",
                "email": email1,
                "phone": "1111111111",
                "department": "Nursing",
                "job_title": "Nurse",
                "joining_date": timezone.localdate().isoformat(),
                "start_onboarding": False,
            },
        )
emp1.refresh_from_db()
u1 = User.objects.filter(email__iexact=email1).first()
results["test1_active_create"] = {
    "status": emp1.status,
    "user_exists": bool(u1),
    "linked": str(emp1.user_id) == str(u1.id) if u1 else False,
    "must_change_password": getattr(u1, "must_change_password", None) if u1 else None,
    "welcome_sent_at": str(emp1.portal_welcome_email_sent_at),
    "portal_account_created_at": str(emp1.portal_account_created_at),
    "meta": meta1,
}
if u1:
    r = client.post(
        "/api/v1/auth/login/",
        {"email": email1, "password": "Audit1!234567"},
        format="json",
    )
    payload = (r.data.get("data") or {}) if hasattr(r, "data") else {}
    results["test1_active_create"]["login_status"] = r.status_code
    results["test1_active_create"]["login"] = {
        k: payload.get(k)
        for k in (
            "has_employee_profile",
            "portal_access_allowed",
            "must_change_password",
            "employee_status",
        )
    }

# TEST 2a: Pending onboarding (UI path for non-active)
email2 = "audit.pending@test.local"
cleanup(email2)
with patch("apps.hr.email_utils._safe_smtp_send", return_value=True):
    emp2, meta2 = create_manual_employee(
        hr_user=hr,
        hospital=hospital,
        payload={
            "name": "Audit Pending",
            "email": email2,
            "phone": "2222222222",
            "department": "Nursing",
            "job_title": "Nurse",
            "joining_date": timezone.localdate().isoformat(),
            "start_onboarding": True,
            "document_timing": "skip",
        },
    )
emp2.refresh_from_db()
results["test2_pending_create"] = {
    "status": emp2.status,
    "user_exists": User.objects.filter(email__iexact=email2).exists(),
    "welcome_sent": bool(emp2.portal_welcome_email_sent_at),
    "meta": meta2,
}

# TEST 2b: Explicit inactive status
email2b = "audit.inactive@test.local"
cleanup(email2b)
emp2b = Employee.objects.create(
    hospital=hospital, name="Inactive", email=email2b, status="inactive"
)
with patch("apps.hr.email_utils._safe_smtp_send", return_value=True):
    pr = provision_employee_portal(emp2b, reviewer=hr, source="audit")
results["test2_inactive"] = {
    "status": emp2b.status,
    "user_exists": User.objects.filter(email__iexact=email2b).exists(),
    "provision": pr,
}

# TEST 3: Activation + idempotency
email3 = "audit.activate@test.local"
cleanup(email3)
emp3 = Employee.objects.create(
    hospital=hospital,
    name="Activate Me",
    email=email3,
    status="pending_onboarding",
    onboarding_status="under_review",
)
dt = DocumentType.objects.filter(hospital=hospital).first()
if dt:
    EmployeeDocumentRequirement.objects.update_or_create(
        employee=emp3,
        document_type=dt,
        defaults={
            "mandatory": True,
            "status": "verified",
            "uploaded_at": timezone.now(),
            "verified_at": timezone.now(),
        },
    )
with patch("apps.hr.email_utils._safe_smtp_send", return_value=True):
    with patch(
        "apps.hr.portal_provisioning.generate_secure_temporary_password",
        return_value="Audit3!234567",
    ):
        a1 = activate_employee_after_verification(employee=emp3, reviewer=hr)
        a2 = activate_employee_after_verification(employee=emp3, reviewer=hr)
emp3.refresh_from_db()
results["test3_activation"] = {
    "first": {
        k: a1.get(k)
        for k in (
            "success",
            "portal_account_created",
            "welcome_email_sent",
            "idempotent",
        )
    },
    "second": {
        k: a2.get(k)
        for k in (
            "success",
            "portal_account_created",
            "welcome_email_sent",
            "idempotent",
        )
    },
    "user_count": User.objects.filter(email__iexact=email3).count(),
    "welcome_sent_once": bool(emp3.portal_welcome_email_sent_at),
    "welcome_audit_count": EmployeeDocumentAuditLog.objects.filter(
        employee=emp3, action="welcome_email_sent"
    ).count(),
}

# TEST 4: Login security
email4 = "ankitshird56+test1@gmail.com"
u4 = User.objects.filter(email__iexact=email4).first()
results["test4_login"] = {}
if u4:
    wrong = client.post(
        "/api/v1/auth/login/",
        {"email": email4, "password": "wrong-password-xyz"},
        format="json",
    )
    results["test4_login"]["wrong_password_status"] = wrong.status_code
    results["test4_login"]["wrong_password_exposes_trace"] = "traceback" in str(
        wrong.content.decode().lower()
    )
    emp4 = Employee.objects.filter(email__iexact=email4).first()
    if emp4:
        old_status = emp4.status
        emp4.status = "inactive"
        emp4.save(update_fields=["status"])
        u4.refresh_from_db()
        results["test4_login"]["inactive_user_is_active_flag"] = u4.is_active
        inactive_login = client.post(
            "/api/v1/auth/login/",
            {"email": email4, "password": "x"},
            format="json",
        )
        if inactive_login.status_code == 200:
            p = inactive_login.data.get("data") or {}
            results["test4_login"]["inactive_login_status"] = 200
            results["test4_login"]["portal_access_allowed"] = p.get(
                "portal_access_allowed"
            )
        else:
            results["test4_login"]["inactive_login_status"] = inactive_login.status_code
        emp4.status = old_status
        emp4.save(update_fields=["status"])
        if old_status == "active":
            provision_employee_portal(emp4, reviewer=hr, source="restore")

# TEST 5: Access control with employee token
if u1:
    client.force_authenticate(user=u1)
    other_emp = Employee.objects.exclude(pk=emp1.pk).first()
    endpoints = [
        ("GET", "/api/v1/hr/employees/"),
        ("GET", f"/api/v1/hr/employees/{emp1.id}/"),
        (
            "GET",
            f"/api/v1/hr/employees/{other_emp.id}/" if other_emp else "/api/v1/hr/employees/none/",
        ),
        ("GET", "/api/v1/hr/leave-requests/"),
        ("GET", "/api/v1/hr/salary/"),
        ("GET", "/api/v1/hr/dashboard/"),
        ("GET", "/api/v1/hr/departments/"),
        ("GET", "/api/v1/employee-portal/dashboard/"),
        ("GET", "/api/v1/employee-portal/leaves/"),
    ]
    results["test5_access"] = {}
    for method, path in endpoints:
        resp = client.generic(method, path)
        results["test5_access"][f"{method} {path}"] = resp.status_code

    # must_change_password should block portal until password changed
    results["test5_must_change_pw_blocks_portal"] = results["test5_access"].get(
        "GET /api/v1/employee-portal/dashboard/"
    )

# TEST 6: Email audit for test3
results["test6_email"] = {
    "welcome_audit_logs_test3": results["test3_activation"]["welcome_audit_count"],
    "portal_welcome_email_sent_at_test3": str(emp3.portal_welcome_email_sent_at),
}

# TEST 7: Data consistency
results["test7_consistency"] = {
    "emp1_email": emp1.email,
    "user1_email": u1.email if u1 else None,
    "emails_match": (
        emp1.email.lower() == u1.email.lower() if u1 and emp1.email else False
    ),
    "duplicate_users_audit_active": User.objects.filter(
        email__iexact=email1
    ).count(),
}

print(json.dumps(results, indent=2, default=str))
