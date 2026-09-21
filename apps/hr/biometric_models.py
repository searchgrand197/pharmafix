"""
Biometric device integration models (ESSL K90 Pro / ZKTeco ADMS).
"""

from django.conf import settings
from django.db import models
from django.db.models import Q

from apps.shared.models import Hospital, TimeStampedModel, UUIDPrimaryKeyModel


FINGER_LABELS = {
    0: 'Left Little',
    1: 'Left Ring',
    2: 'Left Middle',
    3: 'Left Index',
    4: 'Left Thumb',
    5: 'Right Thumb',
    6: 'Right Index',
    7: 'Right Middle',
    8: 'Right Ring',
    9: 'Right Little',
}


class BiometricDevice(TimeStampedModel, UUIDPrimaryKeyModel):
    """Registered ESSL / ZKTeco biometric device."""

    hospital = models.ForeignKey(
        Hospital,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='biometric_devices',
        help_text='Assign after first handshake so punches map to the correct tenant.',
    )
    serial_number = models.CharField(
        max_length=100,
        unique=True,
        db_index=True,
        help_text='Device serial number (SN) from ADMS query params.',
    )
    name = models.CharField(max_length=150, blank=True, default='')
    ip_address = models.GenericIPAddressField(null=True, blank=True)
    firmware_version = models.CharField(max_length=50, blank=True, default='')
    last_seen = models.DateTimeField(null=True, blank=True, db_index=True)
    last_time_sync = models.DateTimeField(null=True, blank=True)
    last_time_sync_status = models.CharField(max_length=20, blank=True, default='')
    is_active = models.BooleanField(default=True, db_index=True)
    userinfo_sync_requested = models.BooleanField(
        default=False,
        help_text='Whether DATA QUERY USERINFO was queued on last handshake.',
    )

    class Meta:
        ordering = ['name', 'serial_number']
        verbose_name = 'Biometric Device'
        verbose_name_plural = 'Biometric Device Connections'
        indexes = [
            models.Index(fields=['hospital', 'is_active']),
        ]

    def __str__(self):
        label = self.name or self.serial_number
        return f'{label} ({self.serial_number})'

    def touch(self, ip=None):
        from django.utils import timezone

        self.last_seen = timezone.now()
        if ip:
            self.ip_address = ip
        self.save(update_fields=['last_seen', 'ip_address', 'updated_at'])


class BiometricDeviceCommand(TimeStampedModel, UUIDPrimaryKeyModel):
    """Persistent ADMS command queue (survives server restarts)."""

    STATUS_PENDING = 'pending'
    STATUS_SENT = 'sent'
    STATUS_ACKED = 'acked'
    STATUS_FAILED = 'failed'

    STATUS_CHOICES = [
        (STATUS_PENDING, 'Pending'),
        (STATUS_SENT, 'Sent'),
        (STATUS_ACKED, 'Acked'),
        (STATUS_FAILED, 'Failed'),
    ]

    device = models.ForeignKey(
        BiometricDevice,
        on_delete=models.CASCADE,
        related_name='commands',
    )
    command_id = models.PositiveIntegerField(
        help_text='ADMS command id (C:<id>:...).',
    )
    command_body = models.TextField()
    status = models.CharField(
        max_length=20,
        choices=STATUS_CHOICES,
        default=STATUS_PENDING,
        db_index=True,
    )
    return_code = models.CharField(max_length=20, blank=True, default='')
    attempts = models.PositiveSmallIntegerField(default=0)
    sent_at = models.DateTimeField(null=True, blank=True)
    acked_at = models.DateTimeField(null=True, blank=True)
    error_message = models.TextField(blank=True, default='')

    class Meta:
        ordering = ['created_at']
        constraints = [
            models.UniqueConstraint(
                fields=['device', 'command_id'],
                name='unique_biometric_device_command_id',
            ),
        ]
        indexes = [
            models.Index(fields=['device', 'status', 'created_at']),
        ]

    def __str__(self):
        return f'CMD {self.command_id} [{self.status}] {self.device.serial_number}'


class BiometricEnrollment(TimeStampedModel, UUIDPrimaryKeyModel):
    """Fingerprint enrollment metadata (templates stay on device)."""

    employee = models.ForeignKey(
        'Employee',
        on_delete=models.CASCADE,
        related_name='biometric_enrollments',
    )
    device = models.ForeignKey(
        BiometricDevice,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='enrollments',
    )
    finger_id = models.PositiveSmallIntegerField()
    is_enrolled = models.BooleanField(default=False)
    template_size = models.PositiveIntegerField(null=True, blank=True)
    source = models.CharField(max_length=30, blank=True, default='')
    enrolled_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=['employee', 'device', 'finger_id'],
                name='unique_biometric_enrollment_per_finger',
            ),
        ]
        indexes = [
            models.Index(fields=['employee', 'is_enrolled']),
        ]

    def __str__(self):
        label = FINGER_LABELS.get(self.finger_id, f'Finger {self.finger_id}')
        return f'{self.employee_id} {label} enrolled={self.is_enrolled}'


class BiometricUnlinkedUser(TimeStampedModel, UUIDPrimaryKeyModel):
    """User seen on device but not linked to an HR Employee."""

    STATUS_PENDING = 'pending'
    STATUS_LINKED = 'linked'
    STATUS_REJECTED = 'rejected'

    STATUS_CHOICES = [
        (STATUS_PENDING, 'Pending'),
        (STATUS_LINKED, 'Linked'),
        (STATUS_REJECTED, 'Rejected'),
    ]

    hospital = models.ForeignKey(
        Hospital,
        on_delete=models.CASCADE,
        related_name='biometric_unlinked_users',
    )
    device = models.ForeignKey(
        BiometricDevice,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='unlinked_users',
    )
    pin = models.CharField(max_length=20, db_index=True)
    name = models.CharField(max_length=200, blank=True, default='')
    card_number = models.CharField(max_length=50, blank=True, default='')
    status = models.CharField(
        max_length=20,
        choices=STATUS_CHOICES,
        default=STATUS_PENDING,
        db_index=True,
    )
    linked_employee = models.ForeignKey(
        'Employee',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='linked_biometric_unlinked_users',
    )
    first_seen_at = models.DateTimeField(auto_now_add=True)
    last_seen_at = models.DateTimeField(auto_now=True)
    resolved_at = models.DateTimeField(null=True, blank=True)
    resolved_by = models.ForeignKey(
        'accounts.User',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='resolved_biometric_unlinked_users',
    )

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=['hospital', 'pin'],
                condition=Q(status='pending'),
                name='unique_pending_unlinked_pin_per_hospital',
            ),
        ]
        indexes = [
            models.Index(fields=['hospital', 'status']),
        ]

    def __str__(self):
        return f'Unlinked PIN={self.pin} ({self.status})'


class BiometricSyncLog(TimeStampedModel, UUIDPrimaryKeyModel):
    """Audit trail for biometric sync and ingestion events."""

    LEVEL_INFO = 'info'
    LEVEL_WARNING = 'warning'
    LEVEL_ERROR = 'error'

    LEVEL_CHOICES = [
        (LEVEL_INFO, 'Info'),
        (LEVEL_WARNING, 'Warning'),
        (LEVEL_ERROR, 'Error'),
    ]

    hospital = models.ForeignKey(
        Hospital,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='biometric_sync_logs',
    )
    device = models.ForeignKey(
        BiometricDevice,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='sync_logs',
    )
    employee = models.ForeignKey(
        'Employee',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='biometric_sync_logs',
    )
    action = models.CharField(max_length=80, db_index=True)
    level = models.CharField(max_length=10, choices=LEVEL_CHOICES, default=LEVEL_INFO)
    message = models.TextField()
    metadata = models.JSONField(default=dict, blank=True)

    class Meta:
        ordering = ['-created_at']
        indexes = [
            models.Index(fields=['action', 'level', 'created_at']),
        ]

    def __str__(self):
        return f'{self.action} [{self.level}]'


class BiometricRejectedPunch(TimeStampedModel, UUIDPrimaryKeyModel):
    """Soft-blocked punch attempts (employee exists but not eligible)."""

    hospital = models.ForeignKey(
        Hospital,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='biometric_rejected_punches',
    )
    device = models.ForeignKey(
        BiometricDevice,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='rejected_punches',
    )
    employee = models.ForeignKey(
        'Employee',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='biometric_rejected_punches',
    )
    pin = models.CharField(max_length=20, db_index=True)
    punch_time = models.DateTimeField(db_index=True)
    reason = models.CharField(max_length=80, db_index=True)
    raw_line = models.TextField(blank=True, default='')
    metadata = models.JSONField(default=dict, blank=True)
    dismissed_at = models.DateTimeField(null=True, blank=True, db_index=True)
    dismissed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='dismissed_biometric_rejected_punches',
    )

    class Meta:
        ordering = ['-punch_time']
        indexes = [
            models.Index(fields=['pin', 'punch_time']),
            models.Index(fields=['hospital', 'dismissed_at'], name='hr_biometri_hospita_d2f81a_idx'),
        ]

    def __str__(self):
        return f'Rejected PIN={self.pin} {self.reason}'
