"""Model mixins for normalized email storage."""

from apps.shared.email_normalization import normalize_model_email_fields


class NormalizeEmailFieldsMixin:
    """
    Lowercase email fields on save.
    Set NORMALIZED_EMAIL_FIELDS on each concrete model.
    """

    NORMALIZED_EMAIL_FIELDS: tuple[str, ...] = ('email',)

    def normalize_email_fields(self) -> list[str]:
        return normalize_model_email_fields(self, self.NORMALIZED_EMAIL_FIELDS)

    def save(self, *args, **kwargs):
        self.normalize_email_fields()
        return super().save(*args, **kwargs)
