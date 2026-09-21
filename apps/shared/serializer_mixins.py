"""DRF serializer mixins for normalized emails."""

from rest_framework import serializers

from apps.shared.email_normalization import (
    employee_email_exists,
    normalize_email_address,
    user_email_exists,
)


class NormalizeEmailFieldsSerializerMixin:
    """Normalize configured email fields in validate() before save."""

    NORMALIZED_EMAIL_FIELDS: tuple[str, ...] = ('email',)

    def normalize_email_attrs(self, attrs: dict) -> dict:
        for field in self.NORMALIZED_EMAIL_FIELDS:
            if field in attrs and attrs[field]:
                attrs[field] = normalize_email_address(attrs[field])
        return attrs

    def validate(self, attrs):
        attrs = self.normalize_email_attrs(attrs)
        return super().validate(attrs)


class EmployeeEmailSerializerMixin(NormalizeEmailFieldsSerializerMixin):
    NORMALIZED_EMAIL_FIELDS = ('email',)

    def validate_email(self, value):
        if not value:
            return value
        value = normalize_email_address(value)
        exclude_pk = getattr(self.instance, 'pk', None) if self.instance else None
        if employee_email_exists(value, exclude_pk=exclude_pk):
            raise serializers.ValidationError(
                'An employee with this email already exists.',
            )
        return value


class UserEmailSerializerMixin(NormalizeEmailFieldsSerializerMixin):
    NORMALIZED_EMAIL_FIELDS = ('email',)

    def validate_email(self, value):
        if not value:
            return value
        value = normalize_email_address(value)
        exclude_pk = getattr(self.instance, 'pk', None) if self.instance else None
        if user_email_exists(value, exclude_pk=exclude_pk):
            raise serializers.ValidationError(
                'A user with this email already exists.',
            )
        return value
