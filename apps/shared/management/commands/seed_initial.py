from __future__ import annotations

from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand
from django.db import transaction

from apps.roles_permissions.models import (
    Module,
    Permission,
    Role,
    RolePermission,
    UserModulePermission,
    UserPermissionProfile,
)
from apps.shared.models import Hospital
from apps.staff.models import Department


PERMISSIONS = {
    # module_code: {permission_code: action}
    "patients": {
        "patients.view_patient": "view",
        "patients.create_patient": "create",
        "patients.update_patient": "update",
        "patients.delete_patient": "delete",
    },
    "opd": {
        "opd.view_opd_visit": "view",
        "opd.create_opd_visit": "create",
        "opd.update_opd_visit": "update",
        "opd.delete_opd_visit": "delete",
    },
    "ipd": {
        "ipd.view_admission": "view",
        "ipd.create_admission": "create",
        "ipd.update_admission": "update",
        "ipd.delete_admission": "delete",
    },
    "billing": {
        "billing.view_invoice": "view",
        "billing.create_invoice": "create",
        "billing.update_invoice": "update",
        "billing.delete_invoice": "delete",
        "billing.approve_invoice": "approve",
    },
    "payments": {
        "payments.view_transaction": "view",
        "payments.create_transaction": "create",
    },
    "expenses": {
        "expenses.view_transaction": "view",
        "expenses.create_transaction": "create",
        "expenses.void_transaction": "delete",
    },
    "staff": {
        "staff.view_department": "view",
        "staff.create_department": "create",
        "staff.update_department": "update",
        "staff.delete_department": "delete",

        "staff.view_designation": "view",
        "staff.create_designation": "create",
        "staff.update_designation": "update",
        "staff.delete_designation": "delete",

        "staff.view_shift": "view",
        "staff.create_shift": "create",
        "staff.update_shift": "update",
        "staff.delete_shift": "delete",

        "staff.view_staff": "view",
        "staff.create_staff": "create",
        "staff.update_staff": "update",
        "staff.delete_staff": "delete",

        "staff.view_emergency_contact": "view",
        "staff.create_emergency_contact": "create",
        "staff.update_emergency_contact": "update",
        "staff.delete_emergency_contact": "delete",
    },
    "doctors": {
        "doctors.view_specialty": "view",
        "doctors.create_specialty": "create",
        "doctors.update_specialty": "update",
        "doctors.delete_specialty": "delete",

        "doctors.view_doctor": "view",
        "doctors.create_doctor": "create",
        "doctors.update_doctor": "update",
        "doctors.delete_doctor": "delete",

        "doctors.view_schedule": "view",
        "doctors.create_schedule": "create",
        "doctors.update_schedule": "update",
        "doctors.delete_schedule": "delete",

        "doctors.view_daily_availability": "view",
        "doctors.create_daily_availability": "create",
        "doctors.update_daily_availability": "update",
        "doctors.delete_daily_availability": "delete",
    },
    "appointments": {
        "appointments.view_appointment": "view",
        "appointments.create_appointment": "create",
        "appointments.update_appointment": "update",
        "appointments.cancel_appointment": "delete",
        "appointments.reschedule_appointment": "update",
    },
    "tokens": {
        "tokens.view_token": "view",
        "tokens.generate_token": "create",
        "tokens.update_token_status": "update",
        "tokens.call_next_token": "approve",
    },
    "inventory": {
        "inventory.view_unit": "view",
        "inventory.create_unit": "create",
        "inventory.update_unit": "update",
        "inventory.delete_unit": "delete",

        "inventory.view_medicine": "view",
        "inventory.create_medicine": "create",
        "inventory.update_medicine": "update",
        "inventory.delete_medicine": "delete",

        "inventory.view_batch": "view",
        "inventory.create_batch": "create",
        "inventory.update_batch": "update",
        "inventory.delete_batch": "delete",

        "inventory.view_stock_ledger": "view",
        "inventory.create_stock_ledger": "create",
    },
    "followups": {
        "followups.view_followup": "view",
        "followups.create_followup": "create",
        "followups.update_followup": "update",
        "followups.delete_followup": "delete",
        "followups.mark_called": "approve",
        "followups.mark_missed": "approve",
        "followups.schedule_reminder": "update",
        "followups.link_appointment": "approve",
    },
    "attendance": {
        "attendance.view_attendance": "view",
        "attendance.punch_attendance": "create",
        "attendance.submit_regularization": "update",
        "attendance.approve_regularization": "approve",
        "attendance.submit_leave": "create",
        "attendance.approve_leave": "approve",
        "attendance.manage_earned_leave": "update",
    },
}

DEPARTMENTS = [
    ("ED", "Emergency Department (ED)"),
    ("OPD", "Outpatient Department (OPD)"),
    ("IPD", "Inpatient Department (IPD)"),
    ("ICU", "Intensive Care Unit (ICU)"),
    ("OT", "Operation Theatre (OT)"),
    ("CARDIOLOGY", "Cardiology"),
    ("NEUROLOGY", "Neurology"),
    ("ORTHOPEDICS", "Orthopedics"),
    ("PEDIATRICS", "Pediatrics"),
    ("GYNE_OBS", "Gynecology & Obstetrics"),
    ("DERMATOLOGY", "Dermatology"),
    ("ENT", "ENT (Ear, Nose, Throat)"),
    ("OPHTHALMOLOGY", "Ophthalmology"),
    ("RADIOLOGY", "Radiology"),
    ("PATHOLOGY", "Pathology"),
    ("PHARMACY", "Pharmacy"),
    ("PHYSIOTHERAPY", "Physiotherapy"),
    ("BLOOD_BANK", "Blood Bank"),
    ("RECEPTION", "Reception / Registration"),
    ("BILLING", "Billing Department"),
    ("MEDICAL_RECORDS", "Medical Records Department"),
]


class Command(BaseCommand):
    help = "Seeds initial hospital tenant, master modules/permissions, and an admin role."

    def add_arguments(self, parser):
        parser.add_argument("--hospital-name", default="Default Hospital")
        parser.add_argument("--hospital-slug", default="")
        parser.add_argument("--admin-email", required=True)
        parser.add_argument("--admin-password", default="Admin@1234")
        parser.add_argument("--admin-phone", default="")
        parser.add_argument("--admin-first-name", default="Hospital")
        parser.add_argument("--admin-last-name", default="Admin")

    @transaction.atomic
    def handle(self, *args, **options):
        hospital_name = options["hospital_name"].strip()
        hospital_slug = options["hospital_slug"].strip() or hospital_name.lower().replace(" ", "-")

        hospital, _ = Hospital.objects.get_or_create(name=hospital_name, slug=hospital_slug, defaults={"timezone": "UTC"})

        # Department master data for the hospital.
        for code, name in DEPARTMENTS:
            Department.objects.update_or_create(
                hospital=hospital,
                code=code,
                defaults={
                    "name": name,
                    "is_active": True,
                },
            )

        admin_email = options["admin_email"].strip()
        admin_password = options["admin_password"]

        User = get_user_model()
        user, created = User.objects.get_or_create(
            email__iexact=admin_email,
            defaults={
                "email": admin_email,
                "phone": options["admin_phone"],
                "first_name": options["admin_first_name"],
                "last_name": options["admin_last_name"],
                "hospital": hospital,
                "is_active": True,
                "is_staff": True,
                "is_superuser": False,
            },
        )

        if user.hospital_id != hospital.id:
            user.hospital = hospital
            user.save(update_fields=["hospital"])

        if created:
            user.set_password(admin_password)
            user.save(update_fields=["password"])

        # Modules
        modules_by_code = {}
        for module_code, perms in PERMISSIONS.items():
            module_obj, _ = Module.objects.get_or_create(code=module_code, defaults={"name": module_code.title()})
            modules_by_code[module_code] = module_obj

            # Permissions
            for perm_code, action in perms.items():
                permission_obj, _ = Permission.objects.get_or_create(
                    code=perm_code,
                    defaults={
                        "module": module_obj,
                        "action": action,
                        "description": perm_code,
                        "is_active": True,
                    },
                )
                # Permissions are assigned to a role in the next section.

        # Role
        role, _ = Role.objects.get_or_create(hospital=hospital, code="hospital_admin", defaults={"name": "Hospital Admin"})

        # Assign permissions to role
        for module_code, perms in PERMISSIONS.items():
            module_obj = modules_by_code[module_code]
            for perm_code, _action in perms.items():
                permission_obj = Permission.objects.get(code=perm_code)
                RolePermission.objects.get_or_create(role=role, permission=permission_obj)

        # Module permissions for admin user (replaces former UserRole link).
        profile, _ = UserPermissionProfile.objects.get_or_create(user=user)
        for module_code in PERMISSIONS:
            module_obj = modules_by_code[module_code]
            UserModulePermission.objects.update_or_create(
                profile=profile,
                module=module_obj,
                defaults={
                    "is_active": True,
                    "can_add": True,
                    "can_edit": True,
                    "can_delete": True,
                    "can_view": True,
                    "can_print": True,
                    "can_download": True,
                },
            )

        self.stdout.write(self.style.SUCCESS("Seed completed successfully."))

