from __future__ import annotations

import uuid
from django.contrib.auth.base_user import AbstractBaseUser, BaseUserManager
from django.contrib.auth.models import PermissionsMixin
from django.db import models
from django.utils import timezone

from apps.shared.models import Hospital


class UserManager(BaseUserManager):
    use_in_migrations = True

    def normalize_email(self, email):
        from apps.shared.email_normalization import normalize_email_address
        if not email:
            return email
        return normalize_email_address(email)

    def _create_user(self, email: str, password: str | None, **extra_fields):
        if not email:
            raise ValueError("Email must be provided")

        email = self.normalize_email(email).strip().lower()
        user = self.model(email=email, **extra_fields)
        if password:
            user.set_password(password)
        user.save(using=self._db)
        return user

    def create_user(self, email: str, password: str | None = None, **extra_fields):
        extra_fields.setdefault("is_staff", False)
        extra_fields.setdefault("is_superuser", False)
        extra_fields.setdefault("is_active", True)
        return self._create_user(email=email, password=password, **extra_fields)

    def create_superuser(self, email: str, password: str | None = None, **extra_fields):
        extra_fields.setdefault("is_staff", True)
        extra_fields.setdefault("is_superuser", True)
        extra_fields.setdefault("is_active", True)

        if extra_fields.get("is_staff") is not True:
            raise ValueError("Superuser must have is_staff=True.")
        if extra_fields.get("is_superuser") is not True:
            raise ValueError("Superuser must have is_superuser=True.")

        return self._create_user(email=email, password=password, **extra_fields)


class User(AbstractBaseUser, PermissionsMixin):
    """
    Custom user model.

    Module-level access is configured via `roles_permissions.UserPermissionProfile`
    (and optionally via staff designation module links).
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    hospital = models.ForeignKey(
        Hospital,
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="users",
    )

    email = models.EmailField(unique=True)
    phone = models.CharField(max_length=25, null=True, blank=True, unique=True)
    first_name = models.CharField(max_length=100, blank=True, default="")
    last_name = models.CharField(max_length=100, blank=True, default="")

    is_staff = models.BooleanField(default=False)
    is_active = models.BooleanField(default=True)
    must_change_password = models.BooleanField(
        default=False,
        help_text='When true, employee portal blocks access until password is changed.',
    )
    date_joined = models.DateTimeField(default=timezone.now)
    last_login_at = models.DateTimeField(null=True, blank=True)

    objects = UserManager()

    USERNAME_FIELD = "email"
    REQUIRED_FIELDS: list[str] = []

    class Meta:
        indexes = [
            models.Index(fields=["email"]),
        ]

    @property
    def full_name(self) -> str:
        name = f"{self.first_name} {self.last_name}".strip()
        return name or self.email

    def has_permission(self, permission_code: str) -> bool:
        return bool(self.is_superuser)

    def has_module_permission(self, module_code: str) -> bool:
        return bool(self.is_superuser)

    def save(self, *args, **kwargs):
        if self.email:
            from apps.shared.email_normalization import normalize_email_address
            self.email = normalize_email_address(self.email)
        return super().save(*args, **kwargs)
