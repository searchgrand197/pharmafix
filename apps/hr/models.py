import uuid
from decimal import Decimal
from django.db import models
from django.conf import settings
from django.utils import timezone
from apps.shared.models import TimeStampedModel, UUIDPrimaryKeyModel, Hospital
from apps.shared.email_mixins import NormalizeEmailFieldsMixin


class Gender(models.TextChoices):
    MALE = 'male', 'Male'
    FEMALE = 'female', 'Female'
    OTHER = 'other', 'Other'


class ComponentOfferTemplate(models.Model):
    """Model for component‑based offer letter templates used by the new builder."""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    name = models.CharField(max_length=255)
    category = models.CharField(
        max_length=100,
        blank=True,
        default='',
        help_text='Optional grouping (e.g. Teaching, Engineering, Internship)',
    )
    description = models.TextField(blank=True)
    design_json = models.JSONField()
    is_default = models.BooleanField(default=False)
    is_active = models.BooleanField(default=True)
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = "Component Offer Template"
        verbose_name_plural = "Component Offer Templates"
        ordering = ["-created_at"]

    def __str__(self):
        return self.name

def create_default_component_templates():
    """Ensure at least one default component template exists.
    This is called on app ready; it is safe to run multiple times because it checks existence.
    """
    from django.db import transaction
    default_json = {
        "blocks": [
            {"type": "header", "data": {"company_name": "{{company_name}}"}},
            {"type": "title", "data": {"text": "Offer Letter"}},
            {
                "type": "section_card",
                "data": {
                    "title": "Position Details",
                    "items": [
                        {"label": "Designation", "value": "{{job_title}}"},
                        {"label": "Location", "value": "{{job_location}}"},
                        {"label": "Joining Date", "value": "{{joining_date}}"},
                    ],
                },
            },
            {
                "type": "table",
                "data": {
                    "title": "Compensation",
                    "columns": ["Component", "Amount"],
                    "rows": [["Salary", "{{ctc}}"]],
                },
            },
        ]
    }
    with transaction.atomic():
        if not ComponentOfferTemplate.objects.filter(is_default=True).exists():
            ComponentOfferTemplate.objects.create(
                name="Default Component Offer Template",
                description="Auto‑generated default template for component builder",
                design_json=default_json,
                is_default=True,
                is_active=True,
            )

class Department(TimeStampedModel, UUIDPrimaryKeyModel):
    hospital = models.ForeignKey(Hospital, on_delete=models.CASCADE, null=True, blank=True)
    name = models.CharField(max_length=100)

    def __str__(self):
        return self.name


class Designation(TimeStampedModel, UUIDPrimaryKeyModel):
    hospital = models.ForeignKey(Hospital, on_delete=models.PROTECT, related_name='hr_designations')
    name = models.CharField(max_length=200)
    code = models.CharField(max_length=50, blank=True, default='')
    department = models.ForeignKey(
        Department,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='designations',
    )
    level = models.PositiveSmallIntegerField(default=0)
    is_active = models.BooleanField(default=True, db_index=True)

    class Meta:
        ordering = ['level', 'name']
        constraints = [
            models.UniqueConstraint(
                fields=['hospital', 'name'],
                name='unique_hr_designation_name_per_hospital',
            ),
            models.UniqueConstraint(
                fields=['hospital', 'code'],
                condition=models.Q(code__gt=''),
                name='unique_hr_designation_code_per_hospital',
            ),
        ]
        indexes = [
            models.Index(fields=['hospital', 'is_active']),
        ]

    def __str__(self):
        return self.name

    def save(self, *args, **kwargs):
        if not self.code:
            self.code = self._generate_code()
        super().save(*args, **kwargs)

    def _generate_code(self) -> str:
        base = ''.join(part[0] for part in self.name.upper().split() if part)[:6] or 'DSG'
        candidate = base
        suffix = 1
        while Designation.objects.filter(hospital_id=self.hospital_id, code=candidate).exclude(pk=self.pk).exists():
            candidate = f'{base}{suffix}'
            suffix += 1
        return candidate

class Role(TimeStampedModel, UUIDPrimaryKeyModel):
    hospital = models.ForeignKey(Hospital, on_delete=models.CASCADE)
    name = models.CharField(max_length=100)

class Employee(NormalizeEmailFieldsMixin, TimeStampedModel, UUIDPrimaryKeyModel):
    """
    Employee model for HR module.
    Auto-generates employee_id in format EMP0001, EMP0002, etc.
    """
    NORMALIZED_EMAIL_FIELDS = ('email',)
    STATUS_CHOICES = [
        ('pending_onboarding', 'Pending Onboarding'),
        ('active', 'Active'),
        ('inactive', 'Inactive'),
        ('terminated', 'Terminated'),
    ]
    EXIT_REASON_RESIGNATION = 'resignation'
    EXIT_REASON_TERMINATION = 'termination'
    EXIT_REASON_RETIREMENT = 'retirement'
    EXIT_REASON_CONTRACT_END = 'contract_end'
    EXIT_REASON_ABSCONDING = 'absconding'
    EXIT_REASON_DEATH = 'death'
    EXIT_REASON_OTHER = 'other'
    EXIT_REASON_CHOICES = [
        ('', 'Not specified'),
        (EXIT_REASON_RESIGNATION, 'Resignation'),
        (EXIT_REASON_TERMINATION, 'Termination'),
        (EXIT_REASON_RETIREMENT, 'Retirement'),
        (EXIT_REASON_CONTRACT_END, 'Contract End'),
        (EXIT_REASON_ABSCONDING, 'Absconding'),
        (EXIT_REASON_DEATH, 'Death'),
        (EXIT_REASON_OTHER, 'Other'),
    ]

    ONBOARDING_STATUS_CHOICES = [
        ('pending_documents', 'Pending Documents'),
        ('partial_documents', 'Partial Documents'),
        ('documents_uploaded', 'Documents Uploaded'),
        ('under_review', 'Under Review'),
        ('ready_to_join', 'Ready to Join'),
        ('onboarded', 'Onboarded'),
    ]

    hospital = models.ForeignKey(Hospital, on_delete=models.CASCADE, null=True, blank=True)

    # Auto-generated employee ID (EMP0001, EMP0002, ...)
    employee_id = models.CharField(
        max_length=20,
        unique=True,
        db_index=True,
        blank=True,
        help_text="Auto-generated: EMP0001, EMP0002, ..."
    )

    # Basic Information
    name = models.CharField(max_length=200)
    email = models.EmailField(unique=True, null=True, blank=True)
    phone = models.CharField(max_length=20, blank=True, default='')
    gender = models.CharField(max_length=10, choices=Gender.choices, blank=True, default='')

    # Job Details
    job_title = models.CharField(max_length=200, null=True, blank=True)
    designation = models.ForeignKey(
        'Designation',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='employees',
    )
    department = models.CharField(max_length=200, blank=True, default='')
    department_ref = models.ForeignKey(
        'Department',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='employees',
        help_text='Canonical department link for payroll and policy assignment.',
    )
    shift = models.ForeignKey(
        'Shift',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='employees',
        help_text='Primary assigned shift. Future shift rotation can be tracked in EmployeeShift.',
    )

    # Salary
    salary = models.DecimalField(
        max_digits=10,
        decimal_places=2,
        null=True,
        blank=True,
        help_text="Annual salary"
    )

    # Dates
    joining_date = models.DateField(null=True, blank=True)
    joining_date_confirmed = models.DateField(null=True, blank=True, help_text="Actual date employee joined")

    # Exit / offboarding
    relieving_date = models.DateField(null=True, blank=True, help_text="Last working day")
    exit_reason = models.CharField(max_length=100, choices=EXIT_REASON_CHOICES, blank=True, default='')
    exit_notes = models.TextField(blank=True, default='')
    conduct_remarks = models.CharField(max_length=255, blank=True, default='satisfactory')
    eligible_for_rehire = models.BooleanField(
        default=True,
        help_text='Whether HR marked the employee as eligible for future rehire.',
    )
    last_working_day_confirmed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='employees_last_working_day_confirmed',
        help_text='HR user who last confirmed the exit details.',
    )
    exited_at = models.DateTimeField(null=True, blank=True, help_text="When HR marked the employee as exited")

    # Status
    status = models.CharField(
        max_length=30,
        choices=STATUS_CHOICES,
        default='pending_onboarding',
        db_index=True
    )

    # Onboarding Status
    onboarding_status = models.CharField(
        max_length=30,
        choices=ONBOARDING_STATUS_CHOICES,
        default='pending_documents',
        db_index=True,
        help_text="Track employee onboarding progress"
    )
    onboarding_completed = models.BooleanField(default=False)

    # Recruitment Links (Step 5)
    candidate = models.OneToOneField(
        'Candidate', 
        on_delete=models.SET_NULL, 
        null=True, 
        blank=True, 
        related_name='employee_record'
    )
    offer = models.OneToOneField(
        'Offer', 
        on_delete=models.SET_NULL, 
        null=True, 
        blank=True, 
        related_name='employee_record'
    )
    user = models.OneToOneField(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='hr_employee_profile',
        help_text='Linked portal login account (provisioned on HR activation).',
    )
    activated_at = models.DateTimeField(null=True, blank=True)
    portal_account_created_at = models.DateTimeField(null=True, blank=True)
    portal_welcome_email_sent_at = models.DateTimeField(null=True, blank=True)

    # Biometric device (ESSL K90 Pro) — PIN unique per hospital
    biometric_pin = models.CharField(
        max_length=20,
        blank=True,
        default='',
        db_index=True,
        help_text='Numeric device PIN; auto-assigned on first biometric sync.',
    )
    biometric_attendance_enabled = models.BooleanField(
        default=False,
        help_text='When true and employee is active/onboarded, punches are accepted and user is pushed to devices.',
    )
    biometric_card_number = models.CharField(max_length=50, blank=True, default='')
    biometric_device_privilege = models.PositiveSmallIntegerField(
        default=0,
        help_text='ZKTeco Pri: 0=User, 1=Enroller, 2=Manager, 14=Admin',
    )
    biometric_last_synced_at = models.DateTimeField(null=True, blank=True)
    BIOMETRIC_SYNC_PENDING = 'pending'
    BIOMETRIC_SYNC_SYNCED = 'synced'
    BIOMETRIC_SYNC_FAILED = 'failed'
    BIOMETRIC_SYNC_REMOVED = 'removed'
    BIOMETRIC_SYNC_STATUS_CHOICES = [
        (BIOMETRIC_SYNC_PENDING, 'Pending'),
        (BIOMETRIC_SYNC_SYNCED, 'Synced'),
        (BIOMETRIC_SYNC_FAILED, 'Failed'),
        (BIOMETRIC_SYNC_REMOVED, 'Removed'),
    ]
    biometric_sync_status = models.CharField(
        max_length=20,
        choices=BIOMETRIC_SYNC_STATUS_CHOICES,
        blank=True,
        default='',
    )

    class Meta:
        ordering = ['-created_at']
        verbose_name = "Employee"
        verbose_name_plural = "Employees"
        constraints = [
            models.UniqueConstraint(
                fields=['hospital', 'biometric_pin'],
                condition=models.Q(biometric_pin__gt=''),
                name='unique_biometric_pin_per_hospital',
            ),
        ]

    def __str__(self):
        return f"{self.employee_id} - {self.name}"

    def update_onboarding_status(self):
        """Calculate and update onboarding status based on uploaded documents."""
        from apps.hr.onboarding_documents import refresh_employee_onboarding_status

        return refresh_employee_onboarding_status(self)

    def save(self, *args, **kwargs):
        """
        Auto-generate employee_id if not provided.
        Format: EMP0001, EMP0002, EMP0003, ...
        Thread-safe implementation using select_for_update and transaction.atomic()
        """
        from django.db import transaction

        previous_status = None
        previous_biometric_enabled = None
        if self.pk:
            prev = Employee.objects.filter(pk=self.pk).values(
                'status', 'biometric_attendance_enabled',
            ).first()
            if prev:
                previous_status = prev['status']
                previous_biometric_enabled = prev['biometric_attendance_enabled']

        if not self.employee_id:
            with transaction.atomic():
                # Get the last employee with a lock to prevent race conditions
                last_employee = Employee.objects.select_for_update().order_by('-employee_id').first()

                if last_employee and last_employee.employee_id:
                    # Extract the number from EMP#### format
                    try:
                        last_number = int(last_employee.employee_id.replace('EMP', ''))
                        new_number = last_number + 1
                    except (ValueError, AttributeError):
                        new_number = 1
                else:
                    new_number = 1

                # Format as EMP0001, EMP0002, etc.
                self.employee_id = f"EMP{new_number:04d}"

        super().save(*args, **kwargs)

        if previous_status and previous_status != self.status:
            from apps.hr.portal_provisioning import on_employee_status_changed
            on_employee_status_changed(self, previous_status)

        biometric_changed = (
            previous_biometric_enabled is not None
            and previous_biometric_enabled != self.biometric_attendance_enabled
        )
        status_changed = previous_status is not None and previous_status != self.status
        if biometric_changed or status_changed:
            from django.db import transaction as db_transaction
            from apps.hr.biometric.hooks import on_employee_biometric_state_changed

            db_transaction.on_commit(
                lambda: on_employee_biometric_state_changed(
                    self,
                    previous_status=previous_status,
                    previous_biometric_enabled=previous_biometric_enabled,
                )
            )


class EmployeeStatusHistory(TimeStampedModel, UUIDPrimaryKeyModel):
    EVENT_STATUS_CHANGE = 'status_change'
    EVENT_EXIT = 'exit'
    EVENT_RESTORE = 'restore'
    EVENT_TYPE_CHOICES = [
        (EVENT_STATUS_CHANGE, 'Status Change'),
        (EVENT_EXIT, 'Exit'),
        (EVENT_RESTORE, 'Restore'),
    ]

    employee = models.ForeignKey(Employee, on_delete=models.CASCADE, related_name='status_history')
    event_type = models.CharField(max_length=30, choices=EVENT_TYPE_CHOICES, default=EVENT_STATUS_CHANGE, db_index=True)
    previous_status = models.CharField(max_length=30, blank=True, default='')
    new_status = models.CharField(max_length=30, blank=True, default='')
    exit_reason = models.CharField(max_length=100, choices=Employee.EXIT_REASON_CHOICES, blank=True, default='')
    notes = models.TextField(blank=True, default='')
    conduct_remarks = models.CharField(max_length=255, blank=True, default='')
    relieving_date = models.DateField(null=True, blank=True)
    eligible_for_rehire = models.BooleanField(default=True)
    changed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='employee_status_history_events',
    )
    changed_at = models.DateTimeField(default=timezone.now, db_index=True)

    class Meta:
        ordering = ['-changed_at', '-created_at']
        indexes = [
            models.Index(fields=['employee', 'changed_at']),
            models.Index(fields=['employee', 'event_type']),
        ]

    def __str__(self):
        previous = self.previous_status or 'unknown'
        current = self.new_status or 'unknown'
        return f'{self.employee.employee_id} {previous} -> {current}'


def record_employee_status_history(
    employee,
    *,
    previous_status='',
    new_status='',
    event_type=EmployeeStatusHistory.EVENT_STATUS_CHANGE,
    exit_reason='',
    notes='',
    conduct_remarks='',
    relieving_date=None,
    eligible_for_rehire=True,
    changed_by=None,
):
    return EmployeeStatusHistory.objects.create(
        employee=employee,
        previous_status=(previous_status or '').strip(),
        new_status=(new_status or '').strip(),
        event_type=event_type,
        exit_reason=(exit_reason or '').strip(),
        notes=(notes or '').strip(),
        conduct_remarks=(conduct_remarks or '').strip(),
        relieving_date=relieving_date,
        eligible_for_rehire=bool(eligible_for_rehire),
        changed_by=changed_by,
        changed_at=timezone.now(),
    )


class DocumentType(TimeStampedModel, UUIDPrimaryKeyModel):
    VERIFICATION_MODE_CHOICES = [
        ('upload', 'Upload'),
        ('physical', 'Physical'),
        ('hybrid', 'Hybrid'),
    ]

    hospital = models.ForeignKey(Hospital, on_delete=models.CASCADE, null=True, blank=True)
    name = models.CharField(max_length=120)
    description = models.TextField(blank=True, default='')
    mandatory = models.BooleanField(default=True)
    verification_mode = models.CharField(max_length=20, choices=VERIFICATION_MODE_CHOICES, default='upload')
    is_active = models.BooleanField(default=True)

    class Meta:
        ordering = ['name']
        constraints = [
            models.UniqueConstraint(fields=['hospital', 'name'], name='unique_document_type_per_hospital')
        ]

    def __str__(self):
        return self.name


class JobDocumentRequirement(TimeStampedModel, UUIDPrimaryKeyModel):
    """Per-job document checklist configured by HR."""

    job = models.ForeignKey(
        'JobOpening',
        on_delete=models.CASCADE,
        related_name='document_requirements',
    )
    document_type = models.ForeignKey(
        DocumentType,
        on_delete=models.PROTECT,
        related_name='job_requirements',
    )
    is_required = models.BooleanField(default=True)
    allow_multiple = models.BooleanField(default=False)
    display_order = models.PositiveSmallIntegerField(default=0)

    class Meta:
        ordering = ['display_order', 'document_type__name']
        constraints = [
            models.UniqueConstraint(
                fields=['job', 'document_type'],
                name='unique_job_document_requirement',
            ),
        ]

    def __str__(self):
        req = 'required' if self.is_required else 'optional'
        return f'{self.job_id} - {self.document_type.name} ({req})'


class EmployeeDocumentRequirement(TimeStampedModel, UUIDPrimaryKeyModel):
    STATUS_CHOICES = [
        ('pending', 'Pending'),
        ('uploaded', 'Uploaded'),
        ('verified', 'Verified'),
        ('rejected', 'Rejected'),
        ('reupload_requested', 'Re-upload Requested'),
        ('physically_verified', 'Physically Verified'),
    ]

    employee = models.ForeignKey(Employee, on_delete=models.CASCADE, related_name='document_requirements')
    document_type = models.ForeignKey(DocumentType, on_delete=models.CASCADE, related_name='employee_requirements')
    mandatory = models.BooleanField(default=True)
    status = models.CharField(max_length=30, choices=STATUS_CHOICES, default='pending')
    uploaded_file = models.FileField(upload_to='employee_requirements/%Y/%m/', null=True, blank=True)
    verified_by = models.ForeignKey(
        'accounts.User',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='verified_requirements',
    )
    verification_notes = models.TextField(blank=True, default='')
    physically_verified = models.BooleanField(default=False)
    uploaded_at = models.DateTimeField(null=True, blank=True)
    verified_at = models.DateTimeField(null=True, blank=True)
    rejection_reason = models.TextField(blank=True, default='')
    expires_at = models.DateTimeField(null=True, blank=True)
    override_approved = models.BooleanField(default=False)
    file_hash = models.CharField(max_length=64, blank=True, default='', db_index=True)

    class Meta:
        ordering = ['-created_at']
        constraints = [
            models.UniqueConstraint(
                fields=['employee', 'document_type'],
                name='unique_employee_document_requirement',
            )
        ]

    def __str__(self):
        return f'{self.employee.employee_id} - {self.document_type.name}'


class EmployeeDocumentUploadVersion(TimeStampedModel, UUIDPrimaryKeyModel):
    """Immutable history of uploads for audit — current file stays on the requirement row."""

    ARCHIVE_REASON_CHOICES = [
        ('replaced', 'Replaced by candidate'),
        ('reupload_cleared', 'Cleared for HR re-upload request'),
        ('hr_rejected', 'Archived on HR rejection'),
    ]

    requirement = models.ForeignKey(
        EmployeeDocumentRequirement,
        on_delete=models.CASCADE,
        related_name='upload_versions',
    )
    file = models.FileField(upload_to='employee_requirements/versions/%Y/%m/')
    original_filename = models.CharField(max_length=255, blank=True, default='')
    file_size = models.PositiveIntegerField(default=0)
    file_hash = models.CharField(max_length=64, blank=True, default='', db_index=True)
    version_number = models.PositiveIntegerField(default=1)
    uploaded_at = models.DateTimeField()
    archived_at = models.DateTimeField(auto_now_add=True)
    archived_reason = models.CharField(max_length=32, choices=ARCHIVE_REASON_CHOICES, default='replaced')
    status_at_archive = models.CharField(max_length=30, blank=True, default='')

    class Meta:
        ordering = ['-version_number']

    def __str__(self):
        return f'v{self.version_number} - {self.requirement_id}'


class EmployeeDocument(TimeStampedModel, UUIDPrimaryKeyModel):
    """
    Track employee onboarding documents with verification status.
    """
    DOCUMENT_TYPE_CHOICES = [
        ('aadhaar', 'Aadhaar Card'),
        ('aadhar', 'Aadhar Card'),
        ('pan', 'PAN Card'),
        ('resume', 'Resume'),
        ('degree', 'Degree Certificate'),
        ('bank', 'Bank Details'),
        ('address_proof', 'Address Proof'),
        ('experience_letter', 'Experience Letter'),
        ('salary_slip', 'Previous Salary Slip'),
        ('photo', 'Passport Size Photo'),
        ('other', 'Other Document'),
    ]

    STATUS_CHOICES = [
        ('pending', 'Pending Review'),
        ('uploaded', 'Uploaded'),
        ('verified', 'Verified'),
        ('rejected', 'Rejected'),
        ('reupload_requested', 'Re-upload Requested'),
    ]

    employee = models.ForeignKey(Employee, on_delete=models.CASCADE, related_name='documents')
    document_type = models.CharField(max_length=20, choices=DOCUMENT_TYPE_CHOICES)
    file = models.FileField(upload_to='employee_documents/%Y/%m/', blank=True, null=True)
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='pending')
    uploaded_at = models.DateTimeField(auto_now_add=True)
    verified_at = models.DateTimeField(null=True, blank=True)
    verified_by = models.ForeignKey(
        'accounts.User', 
        on_delete=models.SET_NULL, 
        null=True, 
        blank=True,
        related_name='verified_documents'
    )
    rejection_reason = models.TextField(blank=True, default='')

    class Meta:
        ordering = ['-created_at']
        verbose_name = "Employee Document"
        verbose_name_plural = "Employee Documents"
        constraints = [
            models.UniqueConstraint(
                fields=['employee', 'document_type'],
                name='unique_employee_document_type'
            )
        ]

    def __str__(self):
        return f"{self.employee.name} - {self.get_document_type_display()}"

    def save(self, *args, **kwargs):
        super().save(*args, **kwargs)
        self.update_employee_onboarding_status()

    def update_employee_onboarding_status(self):
        from apps.hr.onboarding_documents import refresh_employee_onboarding_status

        refresh_employee_onboarding_status(self.employee)


class DocumentStatusTransition(TimeStampedModel, UUIDPrimaryKeyModel):
    SCOPE_DOCUMENT = 'document'
    SCOPE_APPLICATION = 'application'
    SCOPE_CHOICES = [
        (SCOPE_DOCUMENT, 'Document'),
        (SCOPE_APPLICATION, 'Application'),
    ]

    ACTION_APPROVE = 'approve'
    ACTION_REQUEST_REUPLOAD = 'request_reupload'
    ACTION_FINAL_REJECT = 'final_reject'
    ACTION_UNDO = 'undo'
    ACTION_CHOICES = [
        (ACTION_APPROVE, 'Approve'),
        (ACTION_REQUEST_REUPLOAD, 'Request Reupload'),
        (ACTION_FINAL_REJECT, 'Final Reject'),
        (ACTION_UNDO, 'Undo'),
    ]

    requirement = models.ForeignKey(
        EmployeeDocumentRequirement,
        on_delete=models.CASCADE,
        related_name='status_transitions',
        null=True,
        blank=True,
    )
    employee = models.ForeignKey(Employee, on_delete=models.CASCADE, related_name='document_status_transitions')
    candidate = models.ForeignKey(
        'Candidate',
        on_delete=models.CASCADE,
        related_name='document_status_transitions',
        null=True,
        blank=True,
    )
    scope = models.CharField(max_length=20, choices=SCOPE_CHOICES, default=SCOPE_DOCUMENT)
    previous_status = models.CharField(max_length=40, blank=True, default='')
    new_status = models.CharField(max_length=40, blank=True, default='')
    previous_candidate_status = models.CharField(max_length=30, blank=True, default='')
    new_candidate_status = models.CharField(max_length=30, blank=True, default='')
    action_type = models.CharField(max_length=30, choices=ACTION_CHOICES)
    changed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='document_status_transitions',
    )
    reason = models.TextField(blank=True, default='')
    snapshot = models.JSONField(default=dict, blank=True)
    undone_at = models.DateTimeField(null=True, blank=True)
    undone_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='undone_document_transitions',
    )
    email_sent = models.BooleanField(default=False)

    class Meta:
        ordering = ['-created_at']

    @property
    def is_undoable(self) -> bool:
        return self.undone_at is None and self.action_type != DocumentStatusTransition.ACTION_UNDO


class EmployeeDocumentAuditLog(TimeStampedModel, UUIDPrimaryKeyModel):
    ACTION_CHOICES = [
        ('uploaded', 'Uploaded'),
        ('approved', 'Approved'),
        ('rejected', 'Rejected'),
        ('reupload_requested', 'Re-upload Requested'),
        ('physically_verified', 'Physically Verified'),
        ('override_approved', 'Override Approved'),
        ('employee_created', 'Employee Created'),
        ('employee_activated', 'Employee Activated'),
        ('portal_account_created', 'Portal Account Created'),
        ('portal_provisioned', 'Portal Provisioned'),
        ('welcome_email_sent', 'Welcome Email Sent'),
        ('password_changed', 'Password Changed'),
        ('final_reject', 'Final Reject'),
        ('undo', 'Undo'),
    ]

    document = models.ForeignKey(
        EmployeeDocument,
        on_delete=models.CASCADE,
        related_name='audit_logs',
        null=True,
        blank=True,
    )
    requirement = models.ForeignKey(
        EmployeeDocumentRequirement,
        on_delete=models.CASCADE,
        related_name='audit_logs',
        null=True,
        blank=True,
    )
    employee = models.ForeignKey(Employee, on_delete=models.CASCADE, related_name='document_audit_logs')
    action = models.CharField(max_length=30, choices=ACTION_CHOICES)
    performed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='employee_document_audit_logs',
    )
    notes = models.TextField(blank=True, default='')
    metadata = models.JSONField(default=dict, blank=True)

    class Meta:
        ordering = ['-created_at']


class Shift(TimeStampedModel, UUIDPrimaryKeyModel):
    hospital = models.ForeignKey(Hospital, on_delete=models.CASCADE)
    name = models.CharField(max_length=120)
    code = models.CharField(max_length=30, null=True, blank=True)
    description = models.TextField(blank=True, default='')
    start_time = models.TimeField(null=True, blank=True)
    end_time = models.TimeField(null=True, blank=True)
    grace_minutes = models.PositiveSmallIntegerField(default=0)
    early_punch_minutes = models.PositiveSmallIntegerField(
        default=240,
        help_text='Minutes before shift start that biometric punches are accepted (default 4 hours).',
    )
    half_day_hours = models.DecimalField(max_digits=5, decimal_places=2, default=4)
    full_day_hours = models.DecimalField(max_digits=5, decimal_places=2, default=8)
    overtime_allowed = models.BooleanField(default=False)
    is_overnight = models.BooleanField(default=False)
    active = models.BooleanField(default=True)

    class Meta:
        ordering = ['name']
        constraints = [
            models.UniqueConstraint(fields=['hospital', 'code'], name='unique_shift_code_per_hospital'),
            models.UniqueConstraint(fields=['hospital', 'name'], name='unique_shift_name_per_hospital'),
        ]

    def __str__(self):
        return f'{self.code} - {self.name}'

class EmployeeShift(TimeStampedModel, UUIDPrimaryKeyModel):
    """
    Shift history model reserved for future rotation support.
    For now, Employee.shift is the active assignment.
    """
    employee = models.ForeignKey(Employee, on_delete=models.CASCADE, related_name='shift_assignments')
    shift = models.ForeignKey(Shift, on_delete=models.CASCADE, related_name='employee_assignments')
    effective_from = models.DateField(null=True, blank=True)
    effective_to = models.DateField(null=True, blank=True)
    is_primary = models.BooleanField(default=False)
    assigned_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='employee_shift_assignments',
    )
    notes = models.TextField(blank=True, default='')

    class Meta:
        ordering = ['-created_at']
        indexes = [
            models.Index(fields=['employee', 'effective_from']),
            models.Index(fields=['shift', 'effective_from']),
        ]


class Attendance(TimeStampedModel, UUIDPrimaryKeyModel):
    """
    Legacy simplified attendance record.
    New attendance foundation should use AttendancePunch + DailyAttendance.
    """
    employee = models.ForeignKey(Employee, on_delete=models.CASCADE)
    date = models.DateField()
    check_in = models.TimeField(null=True, blank=True)
    check_out = models.TimeField(null=True, blank=True)


class AttendancePunch(TimeStampedModel, UUIDPrimaryKeyModel):
    PUNCH_TYPE_CHOICES = [
        ('IN', 'IN'),
        ('OUT', 'OUT'),
    ]
    SOURCE_CHOICES = [
        ('biometric', 'Biometric'),
        ('employee_portal', 'Employee Portal'),
        ('HR_manual', 'HR Manual'),
        ('MANUAL_BIOMETRIC_SIMULATION', 'Manual Biometric Simulation'),
        ('import', 'Import'),
        ('system', 'System'),
    ]
    SOURCE_MANUAL_BIOMETRIC_SIMULATION = 'MANUAL_BIOMETRIC_SIMULATION'

    employee = models.ForeignKey(Employee, on_delete=models.PROTECT, related_name='attendance_punches')
    shift = models.ForeignKey(
        Shift,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='attendance_punches',
        help_text='Shift snapshot at punch creation time; supports future shift rotation.',
    )
    attendance_date = models.DateField(
        null=True,
        blank=True,
        db_index=True,
        help_text='Working date bucket for future attendance engine; supports overnight shifts.',
    )
    timestamp = models.DateTimeField(db_index=True, help_text='Timezone-aware punch timestamp.')
    punch_type = models.CharField(max_length=3, choices=PUNCH_TYPE_CHOICES)
    source = models.CharField(max_length=30, choices=SOURCE_CHOICES, default='import')
    device_id = models.CharField(max_length=120, blank=True, default='')
    notes = models.TextField(blank=True, default='')
    correction_reason = models.TextField(blank=True, default='')
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='attendance_punches_created',
    )
    gps_latitude = models.DecimalField(max_digits=9, decimal_places=6, null=True, blank=True)
    gps_longitude = models.DecimalField(max_digits=9, decimal_places=6, null=True, blank=True)
    device_metadata = models.JSONField(default=dict, blank=True)
    is_suspicious = models.BooleanField(default=False)
    suspicious_reason = models.TextField(blank=True, default='')
    duplicate_of = models.ForeignKey(
        'self',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='duplicate_candidates',
    )
    is_void = models.BooleanField(default=False)
    void_reason = models.TextField(blank=True, default='')
    voided_at = models.DateTimeField(null=True, blank=True)
    voided_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='attendance_punches_voided',
    )

    class Meta:
        ordering = ['-timestamp']
        indexes = [
            models.Index(fields=['employee', 'timestamp']),
            models.Index(fields=['employee', 'attendance_date']),
            models.Index(fields=['source', 'timestamp']),
            models.Index(fields=['shift', 'attendance_date']),
            models.Index(fields=['is_suspicious', 'timestamp']),
            models.Index(fields=['is_void', 'timestamp']),
        ]


class DailyAttendance(TimeStampedModel, UUIDPrimaryKeyModel):
    ATTENDANCE_STATUS_CHOICES = [
        ('present', 'Present'),
        ('absent', 'Absent'),
        ('late', 'Late'),
        ('half_day', 'Half Day'),
        ('in_progress', 'In Progress'),
        ('missing_checkout', 'Missing Checkout'),
        ('incomplete', 'Incomplete'),
        ('overtime', 'Overtime'),
        ('leave', 'On Leave'),
        ('holiday', 'Holiday'),
        ('weekend', 'Weekend'),
        ('work_from_office', 'Work From Office'),
        ('unscheduled', 'No Shift Assigned'),
        ('not_started', 'Shift Not Started'),
    ]
    ATTENDANCE_SOURCE_CHOICES = [
        ('NONE', 'None'),
        ('HR_MANUAL', 'HR Manual'),
        ('MANUAL_BIOMETRIC_SIMULATION', 'Manual Biometric Simulation'),
        ('BIOMETRIC_DEVICE', 'Biometric Device'),
        ('EMPLOYEE_PORTAL', 'Employee Portal'),
        ('IMPORT', 'Import'),
        ('SYSTEM', 'System'),
        ('MIXED', 'Mixed'),
    ]

    employee = models.ForeignKey(Employee, on_delete=models.PROTECT, related_name='daily_attendance')
    date = models.DateField()
    shift = models.ForeignKey(Shift, on_delete=models.SET_NULL, null=True, blank=True, related_name='daily_attendance')
    first_check_in = models.DateTimeField(null=True, blank=True)
    last_check_out = models.DateTimeField(null=True, blank=True)
    total_work_hours = models.DecimalField(
        max_digits=6,
        decimal_places=2,
        null=True,
        blank=True,
        help_text='Total worked hours (summary engine output).',
    )
    overtime_hours = models.DecimalField(max_digits=6, decimal_places=2, null=True, blank=True)
    overtime_minutes = models.PositiveIntegerField(default=0)
    late_minutes = models.PositiveIntegerField(default=0)
    attendance_source = models.CharField(
        max_length=40,
        choices=ATTENDANCE_SOURCE_CHOICES,
        default='NONE',
        db_index=True,
    )
    incomplete_checkout = models.BooleanField(default=False, db_index=True)
    attendance_status = models.CharField(
        max_length=30,
        choices=ATTENDANCE_STATUS_CHOICES,
        default='absent',
        db_index=True,
    )
    is_on_leave = models.BooleanField(default=False, db_index=True)
    leave_type = models.ForeignKey(
        'LeaveType',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='daily_attendance',
    )
    leave_request = models.ForeignKey(
        'LeaveRequest',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='daily_attendance',
    )
    calculation_locked = models.BooleanField(default=False)
    manually_corrected = models.BooleanField(default=False)
    finalized = models.BooleanField(
        default=False,
        db_index=True,
        help_text='When True, row is frozen for payroll and attendance recalculation.',
    )
    finalized_at = models.DateTimeField(null=True, blank=True)
    finalized_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='finalized_daily_attendance',
    )
    incomplete_punches = models.BooleanField(default=False)
    requires_hr_review = models.BooleanField(default=False)
    last_calculated_at = models.DateTimeField(null=True, blank=True)
    calculation_details = models.JSONField(default=dict, blank=True)
    original_calculated_values = models.JSONField(default=dict, blank=True)
    remarks = models.TextField(blank=True, default='')

    class Meta:
        ordering = ['-date', 'employee_id']
        constraints = [
            models.UniqueConstraint(fields=['employee', 'date'], name='unique_daily_attendance_per_employee_date'),
        ]
        indexes = [
            models.Index(fields=['date', 'attendance_status']),
            models.Index(fields=['employee', 'date']),
            models.Index(fields=['date', 'is_on_leave']),
            models.Index(fields=['calculation_locked']),
            models.Index(fields=['requires_hr_review']),
            models.Index(fields=['finalized', 'date']),
        ]


class AttendanceMonthFinalization(TimeStampedModel, UUIDPrimaryKeyModel):
    """Hospital-level attendance month close — required before payroll generation."""

    hospital = models.ForeignKey(
        Hospital,
        on_delete=models.PROTECT,
        related_name='attendance_month_finalizations',
    )
    month = models.CharField(
        max_length=7,
        db_index=True,
        help_text='Payroll period in YYYY-MM format.',
    )
    finalized_at = models.DateTimeField()
    finalized_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='attendance_months_finalized',
    )
    summary = models.JSONField(default=dict, blank=True)

    class Meta:
        ordering = ['-month', '-finalized_at']
        constraints = [
            models.UniqueConstraint(
                fields=['hospital', 'month'],
                name='unique_attendance_month_finalization',
            ),
        ]
        indexes = [
            models.Index(fields=['hospital', 'month']),
        ]

    def __str__(self):
        return f'{self.hospital_id} attendance {self.month} finalized'


class AttendanceRegularization(TimeStampedModel, UUIDPrimaryKeyModel):
    STATUS_CHOICES = [
        ('pending', 'Pending'),
        ('approved', 'Approved'),
        ('rejected', 'Rejected'),
    ]

    employee = models.ForeignKey(Employee, on_delete=models.CASCADE, related_name='attendance_regularizations')
    attendance = models.ForeignKey(
        DailyAttendance,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='regularizations',
    )
    requested_check_in = models.DateTimeField(null=True, blank=True)
    requested_check_out = models.DateTimeField(null=True, blank=True)
    reason = models.TextField()
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='pending', db_index=True)
    reviewed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='attendance_regularizations_reviewed',
    )
    reviewed_at = models.DateTimeField(null=True, blank=True)
    reviewer_remarks = models.TextField(blank=True, default='')

    class Meta:
        ordering = ['-created_at']
        indexes = [
            models.Index(fields=['employee', 'status']),
            models.Index(fields=['created_at']),
        ]


class EmployeePortalNotification(TimeStampedModel, UUIDPrimaryKeyModel):
    """In-app notifications for employee self-service portal."""

    CATEGORY_LEAVE_APPROVED = 'leave_approved'
    CATEGORY_LEAVE_REJECTED = 'leave_rejected'
    CATEGORY_LEAVE_SUBMITTED = 'leave_submitted'
    CATEGORY_REGULARIZATION_APPROVED = 'regularization_approved'
    CATEGORY_REGULARIZATION_REJECTED = 'regularization_rejected'
    CATEGORY_REGULARIZATION_SUBMITTED = 'regularization_submitted'
    CATEGORY_DOCUMENT_APPROVED = 'document_approved'
    CATEGORY_DOCUMENT_REUPLOAD = 'document_reupload'
    CATEGORY_OFFER_ACCEPTED = 'offer_accepted'
    CATEGORY_PORTAL_ACTIVATION = 'portal_activation'
    CATEGORY_PAYROLL = 'payroll'
    CATEGORY_GENERAL = 'general'

    CATEGORY_CHOICES = [
        (CATEGORY_LEAVE_APPROVED, 'Leave Approved'),
        (CATEGORY_LEAVE_REJECTED, 'Leave Rejected'),
        (CATEGORY_LEAVE_SUBMITTED, 'Leave Submitted'),
        (CATEGORY_REGULARIZATION_APPROVED, 'Miss Punch Approved'),
        (CATEGORY_REGULARIZATION_REJECTED, 'Miss Punch Rejected'),
        (CATEGORY_REGULARIZATION_SUBMITTED, 'Miss Punch Submitted'),
        (CATEGORY_DOCUMENT_APPROVED, 'Document Approved'),
        (CATEGORY_DOCUMENT_REUPLOAD, 'Document Reupload Requested'),
        (CATEGORY_OFFER_ACCEPTED, 'Offer Accepted'),
        (CATEGORY_PORTAL_ACTIVATION, 'Portal Activation'),
        (CATEGORY_PAYROLL, 'Payroll'),
        (CATEGORY_GENERAL, 'General'),
    ]

    employee = models.ForeignKey(
        Employee,
        on_delete=models.CASCADE,
        related_name='portal_notifications',
    )
    category = models.CharField(max_length=40, choices=CATEGORY_CHOICES, db_index=True)
    title = models.CharField(max_length=255)
    message = models.TextField()
    read_at = models.DateTimeField(null=True, blank=True, db_index=True)
    metadata = models.JSONField(default=dict, blank=True)

    class Meta:
        ordering = ['-created_at']
        indexes = [
            models.Index(fields=['employee', 'read_at']),
            models.Index(fields=['employee', 'created_at']),
        ]

    @property
    def is_read(self) -> bool:
        return self.read_at is not None


class OrganizationHoliday(TimeStampedModel, UUIDPrimaryKeyModel):
    """Master holiday calendar — national, festival, or organization (hospital-scoped)."""

    SCOPE_NATIONAL = 'national'
    SCOPE_FESTIVAL = 'festival'
    SCOPE_ORGANIZATION = 'organization'
    SCOPE_CHOICES = [
        (SCOPE_NATIONAL, 'National Holiday'),
        (SCOPE_FESTIVAL, 'Festival Holiday'),
        (SCOPE_ORGANIZATION, 'Organization Holiday'),
    ]

    scope = models.CharField(max_length=20, choices=SCOPE_CHOICES, db_index=True)
    hospital = models.ForeignKey(
        Hospital,
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name='organization_holidays',
    )
    name = models.CharField(max_length=255)
    date = models.DateField(db_index=True)
    description = models.TextField(blank=True, default='')
    active = models.BooleanField(default=True, db_index=True)
    is_paid_day = models.BooleanField(
        default=True,
        db_index=True,
        help_text='Reserved for payroll: whether this holiday counts as a paid working day.',
    )

    class Meta:
        ordering = ['date', 'name']
        indexes = [
            models.Index(fields=['scope', 'date']),
            models.Index(fields=['hospital', 'date']),
        ]
        constraints = [
            models.UniqueConstraint(
                fields=['scope', 'hospital', 'date', 'name'],
                name='hr_org_holiday_unique_scope_date_name',
            ),
        ]

    def __str__(self):
        return f'{self.name} ({self.date})'


class AttendanceControlAuditLog(TimeStampedModel, UUIDPrimaryKeyModel):
    """Audit trail for HR attendance control / biometric simulation marks."""

    ACTION_MARK = 'mark_attendance'

    employee = models.ForeignKey(
        Employee,
        on_delete=models.CASCADE,
        related_name='attendance_control_audit_logs',
    )
    attendance_date = models.DateField(db_index=True)
    requested_status = models.CharField(max_length=20)
    action = models.CharField(max_length=40, default=ACTION_MARK, db_index=True)
    marked_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='attendance_control_marks',
    )
    payload = models.JSONField(default=dict, blank=True)
    punch_ids = models.JSONField(default=list, blank=True)
    daily_attendance = models.ForeignKey(
        DailyAttendance,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='control_audit_logs',
    )
    result_status = models.CharField(max_length=30, blank=True, default='')
    success = models.BooleanField(default=True)
    error_message = models.TextField(blank=True, default='')

    class Meta:
        ordering = ['-created_at']
        indexes = [
            models.Index(fields=['employee', 'attendance_date']),
            models.Index(fields=['marked_by', 'created_at']),
            models.Index(fields=['action', 'created_at']),
        ]
        constraints = [
            models.UniqueConstraint(
                fields=['employee', 'attendance_date'],
                condition=models.Q(success=True, action='mark_attendance'),
                name='unique_successful_attendance_control_mark_per_day',
            ),
        ]


class LeaveType(TimeStampedModel, UUIDPrimaryKeyModel):
    hospital = models.ForeignKey(Hospital, on_delete=models.CASCADE, related_name='leave_types')
    name = models.CharField(max_length=100)
    code = models.CharField(max_length=20, blank=True, default='')
    is_paid = models.BooleanField(default=True)
    annual_limit = models.DecimalField(
        max_digits=6,
        decimal_places=2,
        null=True,
        blank=True,
        help_text='Max days per year. Leave blank for unlimited.',
    )
    description = models.TextField(blank=True, default='')
    is_active = models.BooleanField(default=True, db_index=True)

    class Meta:
        ordering = ['name']
        constraints = [
            models.UniqueConstraint(
                fields=['hospital', 'code'],
                condition=models.Q(code__gt=''),
                name='unique_leave_type_code_per_hospital',
            ),
        ]
        indexes = [
            models.Index(fields=['hospital', 'is_active']),
        ]

    def __str__(self):
        return self.name

    def save(self, *args, **kwargs):
        if not self.code:
            self.code = self._generate_code()
        super().save(*args, **kwargs)

    def _generate_code(self) -> str:
        base = ''.join(part[0] for part in self.name.upper().split() if part)[:6] or 'LT'
        candidate = base
        suffix = 1
        while LeaveType.objects.filter(hospital_id=self.hospital_id, code=candidate).exclude(pk=self.pk).exists():
            candidate = f'{base}{suffix}'
            suffix += 1
        return candidate


class LeavePolicy(TimeStampedModel, UUIDPrimaryKeyModel):
    ASSIGNMENT_DEPARTMENT = 'DEPARTMENT'
    ASSIGNMENT_DESIGNATION = 'DESIGNATION'
    ASSIGNMENT_CHOICES = [
        (ASSIGNMENT_DEPARTMENT, 'Departments'),
        (ASSIGNMENT_DESIGNATION, 'Designations'),
    ]

    hospital = models.ForeignKey(Hospital, on_delete=models.CASCADE, related_name='leave_policies')
    name = models.CharField(max_length=120)
    description = models.TextField(blank=True, default='')
    assignment_type = models.CharField(
        max_length=20,
        choices=ASSIGNMENT_CHOICES,
        default=ASSIGNMENT_DEPARTMENT,
    )
    departments = models.ManyToManyField(
        'Department',
        blank=True,
        related_name='department_leave_policies',
    )
    designations = models.ManyToManyField(
        'Designation',
        blank=True,
        related_name='designation_leave_policies',
    )
    is_default = models.BooleanField(default=False)
    is_active = models.BooleanField(default=True, db_index=True)

    class Meta:
        ordering = ['-is_default', 'name']
        indexes = [
            models.Index(fields=['hospital', 'assignment_type', 'is_active']),
        ]

    def __str__(self):
        return self.name


class LeavePolicyLine(TimeStampedModel, UUIDPrimaryKeyModel):
    policy = models.ForeignKey(LeavePolicy, on_delete=models.CASCADE, related_name='lines')
    leave_type = models.ForeignKey(LeaveType, on_delete=models.CASCADE, related_name='policy_lines')
    allocated_days = models.DecimalField(
        max_digits=6,
        decimal_places=2,
        null=True,
        blank=True,
        help_text='Annual allocation. Leave blank for unlimited.',
    )
    is_unlimited = models.BooleanField(default=False)

    class Meta:
        ordering = ['leave_type__name']
        constraints = [
            models.UniqueConstraint(fields=['policy', 'leave_type'], name='unique_policy_leave_type'),
        ]


class LeaveBalance(TimeStampedModel, UUIDPrimaryKeyModel):
    employee = models.ForeignKey(Employee, on_delete=models.CASCADE, related_name='leave_balances')
    leave_type = models.ForeignKey(LeaveType, on_delete=models.CASCADE, related_name='balances')
    policy = models.ForeignKey(
        LeavePolicy,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='balances',
    )
    total_days = models.DecimalField(max_digits=6, decimal_places=2, default=0)
    used_days = models.DecimalField(max_digits=6, decimal_places=2, default=0)
    remaining_days = models.DecimalField(max_digits=6, decimal_places=2, default=0)
    is_unlimited = models.BooleanField(default=False)

    class Meta:
        ordering = ['employee__name', 'leave_type__name']
        constraints = [
            models.UniqueConstraint(fields=['employee', 'leave_type'], name='unique_leave_balance_per_employee_type'),
        ]
        indexes = [
            models.Index(fields=['employee', 'leave_type']),
        ]


class LeaveRequest(TimeStampedModel, UUIDPrimaryKeyModel):
    STATUS_PENDING = 'PENDING'
    STATUS_APPROVED = 'APPROVED'
    STATUS_REJECTED = 'REJECTED'
    STATUS_CANCELLED = 'CANCELLED'
    STATUS_CHOICES = [
        (STATUS_PENDING, 'Pending'),
        (STATUS_APPROVED, 'Approved'),
        (STATUS_REJECTED, 'Rejected'),
        (STATUS_CANCELLED, 'Cancelled'),
    ]

    employee = models.ForeignKey(Employee, on_delete=models.PROTECT, related_name='leave_requests')
    leave_type = models.ForeignKey(LeaveType, on_delete=models.PROTECT, related_name='leave_requests')
    start_date = models.DateField()
    end_date = models.DateField()
    number_of_days = models.DecimalField(max_digits=6, decimal_places=2)
    reason = models.TextField(blank=True, default='')
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default=STATUS_PENDING, db_index=True)
    applied_on = models.DateTimeField(auto_now_add=True)
    applied_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='leave_requests_applied',
    )
    reviewed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='leave_requests_reviewed',
    )
    reviewed_on = models.DateTimeField(null=True, blank=True)
    remarks = models.TextField(blank=True, default='')
    attachment = models.FileField(
        upload_to='leave_requests/%Y/%m/',
        null=True,
        blank=True,
        help_text='Optional supporting document for leave application.',
    )
    notification_events = models.JSONField(default=list, blank=True)

    class Meta:
        ordering = ['-applied_on']
        indexes = [
            models.Index(fields=['employee', 'status']),
            models.Index(fields=['start_date', 'end_date']),
            models.Index(fields=['status', 'applied_on']),
        ]

    def save(self, *args, **kwargs):
        if self.start_date and self.end_date:
            self.number_of_days = Decimal((self.end_date - self.start_date).days + 1).quantize(Decimal('0.01'))
        return super().save(*args, **kwargs)


class Leave(TimeStampedModel, UUIDPrimaryKeyModel):
    employee = models.ForeignKey(Employee, on_delete=models.CASCADE)
    leave_type = models.ForeignKey(LeaveType, on_delete=models.SET_NULL, null=True)
    start_date = models.DateField()
    end_date = models.DateField()
    status = models.CharField(max_length=50, choices=[('pending', 'Pending'), ('approved', 'Approved'), ('rejected', 'Rejected')], default='pending')
    reason = models.TextField(blank=True, default='')


class Salary(TimeStampedModel, UUIDPrimaryKeyModel):
    employee = models.ForeignKey(Employee, on_delete=models.CASCADE, related_name='salary_records')
    basic_pay = models.DecimalField(max_digits=10, decimal_places=2)
    allowance = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    deductions = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    overtime = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    month = models.DateField()

class Training(TimeStampedModel, UUIDPrimaryKeyModel):
    hospital = models.ForeignKey(Hospital, on_delete=models.CASCADE)
    name = models.CharField(max_length=200)

class EmployeeTraining(TimeStampedModel, UUIDPrimaryKeyModel):
    employee = models.ForeignKey(Employee, on_delete=models.CASCADE)
    training = models.ForeignKey(Training, on_delete=models.CASCADE)

class Policy(TimeStampedModel, UUIDPrimaryKeyModel):
    hospital = models.ForeignKey(Hospital, on_delete=models.CASCADE)
    title = models.CharField(max_length=200)

class EmployeePolicy(TimeStampedModel, UUIDPrimaryKeyModel):
    employee = models.ForeignKey(Employee, on_delete=models.CASCADE)
    policy = models.ForeignKey(Policy, on_delete=models.CASCADE)

class JobOpening(TimeStampedModel, UUIDPrimaryKeyModel):
    EMPLOYMENT_TYPE_CHOICES = [
        ('full_time', 'Full Time'),
        ('part_time', 'Part Time'),
        ('contract', 'Contract'),
        ('internship', 'Internship'),
    ]

    STATUS_CHOICES = [
        ('draft', 'Draft'),
        ('open', 'Open'),
        ('closed', 'Closed'),
        ('on_hold', 'On Hold'),
        ('archived', 'Archived'),
    ]

    hospital = models.ForeignKey(Hospital, on_delete=models.CASCADE, null=True, blank=True)
    title = models.CharField(max_length=200)
    designation = models.ForeignKey(
        'Designation',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='job_openings',
    )
    department = models.ForeignKey(Department, on_delete=models.CASCADE)
    job_code = models.CharField(max_length=50, unique=True, blank=True, null=True)
    description = models.TextField(blank=True, default='')
    required_skills = models.TextField(blank=True, default='')
    experience_required = models.CharField(max_length=200, blank=True, default='')
    salary_range = models.CharField(max_length=100, blank=True, default='')
    location = models.CharField(max_length=200, blank=True, default='')
    employment_type = models.CharField(max_length=20, choices=EMPLOYMENT_TYPE_CHOICES, default='full_time')
    vacancies = models.PositiveIntegerField(default=1)
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='draft')
    expiry_date = models.DateField(null=True, blank=True)
    is_active = models.BooleanField(default=True)
    is_archived = models.BooleanField(default=False)

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        return f"{self.job_code or 'N/A'} - {self.title}" if self.job_code else self.title


class ApplicationDocumentRequirement(TimeStampedModel, UUIDPrimaryKeyModel):
    """Immutable per-application document checklist (snapshot at apply time)."""

    application = models.ForeignKey(
        'Candidate',
        on_delete=models.CASCADE,
        related_name='document_requirements',
    )
    document_type = models.ForeignKey(
        DocumentType,
        on_delete=models.PROTECT,
        related_name='application_requirements',
    )
    is_required = models.BooleanField(default=True)
    allow_multiple = models.BooleanField(default=False)
    display_order = models.PositiveSmallIntegerField(default=0)

    class Meta:
        ordering = ['display_order', 'document_type__name']
        constraints = [
            models.UniqueConstraint(
                fields=['application', 'document_type'],
                name='unique_application_document_requirement',
            ),
        ]

    def __str__(self):
        req = 'required' if self.is_required else 'optional'
        return f'{self.application_id} - {self.document_type.name} ({req})'


class RecruitmentIdSequence(TimeStampedModel):
    """Global counters for CAND-* and APP-* codes (race-safe via select_for_update)."""

    prefix = models.CharField(max_length=8, unique=True)
    last_seq = models.PositiveIntegerField(default=0)

    def __str__(self):
        return f'{self.prefix}:{self.last_seq}'


class CandidateProfile(NormalizeEmailFieldsMixin, TimeStampedModel, UUIDPrimaryKeyModel):
    """Person identity — one profile may have many job applications."""

    NORMALIZED_EMAIL_FIELDS = ('email',)

    hospital = models.ForeignKey(
        Hospital,
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name='candidate_profiles',
    )
    candidate_code = models.CharField(max_length=20, unique=True, db_index=True)
    name = models.CharField(max_length=200)
    email = models.EmailField(blank=True, default='')
    phone = models.CharField(max_length=50, blank=True, default='')
    gender = models.CharField(max_length=10, choices=Gender.choices, blank=True, default='')

    class Meta:
        ordering = ['-created_at']
        constraints = [
            models.UniqueConstraint(
                fields=['hospital', 'email'],
                condition=models.Q(email__gt=''),
                name='unique_candidate_profile_email_per_hospital',
            ),
        ]

    def __str__(self):
        return f'{self.candidate_code} - {self.name}'


class Candidate(NormalizeEmailFieldsMixin, TimeStampedModel, UUIDPrimaryKeyModel):
    NORMALIZED_EMAIL_FIELDS = ('email',)
    STATUS_CHOICES = [
        ('applied', 'Applied'),
        ('shortlisted', 'Shortlisted'),
        ('interview', 'Interview'),
        ('selected', 'Selected'),
        ('rejected', 'Rejected'),
        ('hired', 'Hired'),
    ]

    INTERVIEW_TYPE_CHOICES = [
        ('online', 'Online'),
        ('offline', 'Offline'),
    ]

    INTERVIEW_STATUS_CHOICES = [
        ('pending', 'Pending'),
        ('completed', 'Completed'),
    ]

    OFFER_STATUS_CHOICES = [
        ('pending', 'Pending'),
        ('sent', 'Sent'),
        ('accepted', 'Accepted'),
        ('declined', 'Declined'),
    ]

    job_opening = models.ForeignKey(JobOpening, on_delete=models.CASCADE, related_name='applications')
    profile = models.ForeignKey(
        CandidateProfile,
        on_delete=models.PROTECT,
        related_name='applications',
    )
    application_code = models.CharField(max_length=20, unique=True, db_index=True)
    serial_number = models.IntegerField(
        null=True,
        blank=True,
        help_text='Deprecated per-job counter; use application_code instead.',
    )
    name = models.CharField(max_length=200)
    email = models.EmailField(blank=True, default='')
    phone = models.CharField(max_length=50, blank=True, default='')
    gender = models.CharField(max_length=10, choices=Gender.choices, blank=True, default='')
    resume = models.FileField(upload_to='resumes/', blank=True, null=True)
    passport_photo = models.FileField(
        upload_to='candidate_photos/',
        blank=True,
        null=True,
        help_text='Optional passport-size photo uploaded with the job application.',
    )
    cover_letter = models.TextField(blank=True, default='')
    experience = models.CharField(max_length=200, blank=True, default='')
    current_company = models.CharField(max_length=200, blank=True, default='')
    expected_salary = models.CharField(max_length=100, blank=True, default='')
    notice_period = models.CharField(max_length=100, blank=True, default='')
    address = models.TextField(blank=True, default='')
    application_source = models.CharField(
        max_length=120,
        blank=True,
        default='',
        help_text='How the candidate applied (referral, job board, etc.)',
    )
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='applied')
    document_requirements_snapshotted_at = models.DateTimeField(
        null=True,
        blank=True,
        help_text='Set when job document requirements were frozen for this application.',
    )

    # Interview fields
    interview_date = models.DateTimeField(null=True, blank=True)
    interview_type = models.CharField(max_length=20, choices=INTERVIEW_TYPE_CHOICES, null=True, blank=True)
    interview_status = models.CharField(max_length=20, choices=INTERVIEW_STATUS_CHOICES, default='pending')
    interview_meeting_link = models.URLField(max_length=2000, blank=True, default='')
    interview_venue_address = models.TextField(blank=True, default='')

    # Offer fields
    offered_salary = models.DecimalField(max_digits=10, decimal_places=2, null=True, blank=True)
    joining_date = models.DateField(null=True, blank=True)
    offer_status = models.CharField(max_length=20, choices=OFFER_STATUS_CHOICES, default='pending')

    class Meta:
        ordering = ['-created_at']
        constraints = [
            models.UniqueConstraint(
                fields=['job_opening', 'profile'],
                name='unique_job_application_per_profile',
            ),
        ]

    def __str__(self):
        code = self.application_code or '—'
        return f'{code} - {self.name} - {self.job_opening.title}'

class Interview(TimeStampedModel, UUIDPrimaryKeyModel):
    """
    One row per candidate per interview slot. Bulk scheduling creates identical slots
    as separate rows (never a shared interview entity).
    """
    STATUS_SCHEDULED = 'scheduled'
    STATUS_COMPLETED = 'completed'
    STATUS_CANCELLED = 'cancelled'
    STATUS_NO_SHOW = 'no_show'
    STATUS_SELECTED = 'selected'
    STATUS_REJECTED = 'rejected'

    INTERVIEW_STATUS_CHOICES = [
        (STATUS_SCHEDULED, 'Scheduled'),
        (STATUS_COMPLETED, 'Completed'),
        (STATUS_CANCELLED, 'Cancelled'),
        (STATUS_NO_SHOW, 'No show'),
        (STATUS_SELECTED, 'Selected'),
        (STATUS_REJECTED, 'Rejected'),
    ]

    MODE_CHOICES = Candidate.INTERVIEW_TYPE_CHOICES

    candidate = models.ForeignKey(Candidate, on_delete=models.CASCADE, related_name='interviews')
    scheduled_start = models.DateTimeField(default=timezone.now)
    scheduled_end = models.DateTimeField(null=True, blank=True, help_text='Computed end; used for overlap checks.')
    duration_minutes = models.PositiveSmallIntegerField(default=60)
    timezone = models.CharField(
        max_length=64,
        default='Asia/Kolkata',
        help_text='IANA timezone used when interpreting date/time for this interview.',
    )
    mode = models.CharField(max_length=20, choices=MODE_CHOICES, default='online')
    platform = models.CharField(max_length=100, blank=True, default='', help_text='e.g. Google Meet, Zoom')
    meeting_link = models.URLField(max_length=2000, blank=True, default='')
    office_address = models.TextField(blank=True, default='', help_text='For in-person interviews')
    location_notes = models.TextField(blank=True, default='')
    interviewer_name = models.CharField(max_length=255, blank=True, default='')
    notes = models.TextField(blank=True, default='')
    status = models.CharField(max_length=20, choices=INTERVIEW_STATUS_CHOICES, default=STATUS_SCHEDULED)
    result = models.CharField(max_length=100, blank=True, default='', help_text='Legacy / short outcome note')
    bulk_batch_id = models.UUIDField(null=True, blank=True, db_index=True)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name='interviews_created',
    )
    updated_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name='interviews_updated',
    )

    class Meta:
        ordering = ['-scheduled_start']
        indexes = [
            models.Index(fields=['candidate', 'status', 'scheduled_start']),
            models.Index(fields=['status', 'scheduled_start']),
        ]

    def __str__(self):
        return f"{self.candidate.name} — {self.scheduled_start} ({self.get_status_display()})"


class InterviewReminder(TimeStampedModel, UUIDPrimaryKeyModel):
    """Scheduled email reminder before an interview (candidate + HR)."""

    REMINDER_1_HOUR = '1_HOUR_BEFORE'
    REMINDER_10_MIN = '10_MIN_BEFORE'

    REMINDER_TYPE_CHOICES = [
        (REMINDER_1_HOUR, '1 hour before'),
        (REMINDER_10_MIN, '10 minutes before'),
    ]

    interview = models.ForeignKey(
        Interview,
        on_delete=models.CASCADE,
        related_name='reminders',
    )
    reminder_type = models.CharField(max_length=20, choices=REMINDER_TYPE_CHOICES)
    scheduled_time = models.DateTimeField(
        db_index=True,
        help_text='UTC time when this reminder should fire.',
    )
    is_sent = models.BooleanField(default=False, db_index=True)
    sent_at = models.DateTimeField(null=True, blank=True)
    error_message = models.TextField(blank=True, default='')

    class Meta:
        ordering = ['scheduled_time']
        constraints = [
            models.UniqueConstraint(
                fields=['interview', 'reminder_type'],
                name='unique_interview_reminder',
            ),
        ]
        indexes = [
            models.Index(fields=['is_sent', 'scheduled_time']),
        ]

    def __str__(self):
        return f'{self.reminder_type} @ {self.scheduled_time} (sent={self.is_sent})'


class InterviewBulkAuditLog(TimeStampedModel, UUIDPrimaryKeyModel):
    ACTION_SCHEDULE = 'schedule'
    ACTION_RESCHEDULE = 'reschedule'
    ACTION_CANCEL = 'cancel'

    ACTION_CHOICES = [
        (ACTION_SCHEDULE, 'Schedule'),
        (ACTION_RESCHEDULE, 'Reschedule'),
        (ACTION_CANCEL, 'Cancel'),
    ]

    action = models.CharField(max_length=20, choices=ACTION_CHOICES)
    performed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name='interview_bulk_audit_logs',
    )
    candidate_ids = models.JSONField(default=list, help_text='UUID strings of candidates affected')
    affected_count = models.PositiveIntegerField(default=0)
    detail = models.JSONField(default=dict, blank=True)

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        return f"{self.action} x{self.affected_count} @ {self.created_at}"


class RecruitmentEmailEvent(TimeStampedModel, UUIDPrimaryKeyModel):
    """
    Audit log and idempotency guard for recruitment candidate emails.
    Uniqueness: (candidate, event_type, stage).
    """

    EVENT_APPLICATION_RECEIVED = 'APPLICATION_RECEIVED'
    EVENT_SHORTLISTED = 'SHORTLISTED'
    EVENT_INTERVIEW_SCHEDULED = 'INTERVIEW_SCHEDULED'
    EVENT_INTERVIEW_RESCHEDULED = 'INTERVIEW_RESCHEDULED'
    EVENT_OFFER_SENT = 'OFFER_SENT'
    EVENT_OFFER_ACCEPTED = 'OFFER_ACCEPTED'
    EVENT_DOCUMENT_REQUEST = 'DOCUMENT_REQUEST'
    EVENT_REJECTED = 'REJECTED'

    EVENT_TYPE_CHOICES = [
        (EVENT_APPLICATION_RECEIVED, 'Application received'),
        (EVENT_SHORTLISTED, 'Shortlisted'),
        (EVENT_INTERVIEW_SCHEDULED, 'Interview scheduled'),
        (EVENT_INTERVIEW_RESCHEDULED, 'Interview rescheduled'),
        (EVENT_OFFER_SENT, 'Offer sent'),
        (EVENT_OFFER_ACCEPTED, 'Offer accepted (welcome)'),
        (EVENT_DOCUMENT_REQUEST, 'Document request'),
        (EVENT_REJECTED, 'Rejected'),
    ]

    STATUS_PENDING = 'pending'
    STATUS_SENT = 'sent'
    STATUS_FAILED = 'failed'
    STATUS_SKIPPED_DUPLICATE = 'skipped_duplicate'

    EMAIL_STATUS_CHOICES = [
        (STATUS_PENDING, 'Pending'),
        (STATUS_SENT, 'Sent'),
        (STATUS_FAILED, 'Failed'),
        (STATUS_SKIPPED_DUPLICATE, 'Skipped (duplicate)'),
    ]

    candidate = models.ForeignKey(
        Candidate,
        on_delete=models.CASCADE,
        related_name='recruitment_email_events',
    )
    event_type = models.CharField(max_length=40, choices=EVENT_TYPE_CHOICES, db_index=True)
    stage = models.CharField(
        max_length=160,
        help_text='Idempotency key segment (pipeline stage, interview id, offer id, etc.).',
    )
    email_status = models.CharField(
        max_length=24,
        choices=EMAIL_STATUS_CHOICES,
        default=STATUS_PENDING,
        db_index=True,
    )
    error_message = models.TextField(blank=True, default='')
    metadata = models.JSONField(default=dict, blank=True)

    class Meta:
        ordering = ['-created_at']
        constraints = [
            models.UniqueConstraint(
                fields=['candidate', 'event_type', 'stage'],
                name='unique_recruitment_email_event',
            ),
        ]
        indexes = [
            models.Index(fields=['candidate', 'event_type']),
            models.Index(fields=['event_type', 'email_status']),
        ]

    def __str__(self):
        return f'{self.event_type} @ {self.stage} ({self.email_status})'


class PerformanceReview(TimeStampedModel, UUIDPrimaryKeyModel):
    employee = models.ForeignKey(Employee, on_delete=models.CASCADE)
    remarks = models.TextField()


class OfferTemplate(NormalizeEmailFieldsMixin, TimeStampedModel, UUIDPrimaryKeyModel):
    """
    Reusable offer letter template with company details, HR signature, and job defaults.
    Used to generate offer letters for selected candidates.
    """
    NORMALIZED_EMAIL_FIELDS = ('company_email',)
    # Basic Info
    name = models.CharField(max_length=200, help_text="Template name (e.g., 'Standard Offer Letter')")
    content = models.TextField(
        help_text="Template content with placeholders: {candidate_name}, {job_title}, {company_name}, etc."
    )

    # Company Details
    company_name = models.CharField(max_length=200, help_text="Company name")
    company_address = models.TextField(help_text="Full company address")
    company_email = models.EmailField(help_text="Company email address")
    company_phone = models.CharField(max_length=20, help_text="Company phone number")
    company_logo = models.ImageField(
        upload_to='company_logos/',
        null=True,
        blank=True,
        help_text="Company logo image"
    )

    # HR Signature Details
    hr_name = models.CharField(max_length=200, help_text="HR manager name for signature")
    hr_designation = models.CharField(max_length=200, help_text="HR manager designation")
    hr_signature = models.ImageField(
        upload_to='hr_signatures/',
        null=True,
        blank=True,
        help_text="HR signature image"
    )

    # Job Defaults
    job_title = models.CharField(max_length=200, help_text="Default job title")
    department = models.CharField(max_length=200, help_text="Default department")
    job_location = models.CharField(max_length=200, help_text="Default job location")
    employment_type = models.CharField(
        max_length=50,
        help_text="Default employment type (e.g., Full-time, Part-time)"
    )

    # Salary Structure (Default Values)
    default_ctc = models.DecimalField(
        max_digits=12,
        decimal_places=2,
        null=True,
        blank=True,
        help_text="Default CTC (Cost to Company)"
    )
    default_basic_salary = models.DecimalField(
        max_digits=12,
        decimal_places=2,
        null=True,
        blank=True,
        help_text="Default basic salary"
    )
    default_hra = models.DecimalField(
        max_digits=12,
        decimal_places=2,
        null=True,
        blank=True,
        help_text="Default HRA (House Rent Allowance)"
    )
    default_allowances = models.DecimalField(
        max_digits=12,
        decimal_places=2,
        null=True,
        blank=True,
        help_text="Default allowances"
    )
    default_bonus = models.DecimalField(
        max_digits=12,
        decimal_places=2,
        null=True,
        blank=True,
        help_text="Default bonus"
    )

    # Work Details
    default_work_shift = models.CharField(
        max_length=100,
        null=True,
        blank=True,
        help_text="Default work shift (e.g., 'Morning 9 AM - 6 PM')"
    )
    default_working_hours = models.CharField(
        max_length=50,
        null=True,
        blank=True,
        help_text="Default working hours per day (e.g., '8 hours')"
    )
    default_weekly_off = models.CharField(
        max_length=50,
        default='Saturday, Sunday',
        help_text="Default weekly off days"
    )

    # Policies
    default_probation_period = models.CharField(
        max_length=100,
        default='6 months',
        help_text="Default probation period"
    )
    default_notice_period = models.CharField(
        max_length=100,
        default='30 days',
        help_text="Default notice period"
    )
    responsibilities = models.TextField(
        blank=True,
        default="""<ul>
    <li><strong>Product Development:</strong>
        <ul>
            <li>Assist in the design, development, and testing of new products or enhancements.</li>
            <li>Contribute innovative ideas to improve product features and functionalities.</li>
        </ul>
    </li>
    <li><strong>Documentation:</strong>
        <ul>
            <li>Maintain accurate and up-to-date documentation for all engineering processes and project work.</li>
            <li>Create and update technical documentation, including manuals and specifications.</li>
        </ul>
    </li>
    <li><strong>Quality Assurance:</strong>
        <ul>
            <li>Participate in quality assurance processes to ensure that products meet established standards and customer requirements.</li>
            <li>Conduct thorough testing and analysis to identify and resolve potential issues.</li>
        </ul>
    </li>
    <li><strong>Continuous Learning:</strong>
        <ul>
            <li>Stay updated on industry trends, technologies, and best practices.</li>
            <li>Participate in ongoing professional development activities to enhance skills and knowledge.</li>
        </ul>
    </li>
    <li><strong>Collaborative Problem Solving:</strong>
        <ul>
            <li>Work closely with team members to identify and address technical challenges.</li>
            <li>Contribute to brainstorming sessions and offer solutions for complex engineering problems.</li>
        </ul>
    </li>
</ul>""",
        help_text="Default job responsibilities (bullet points)"
    )
    terms_conditions = models.TextField(
        default="This offer is subject to satisfactory completion of background verification and submission of required documents.",
        help_text="Terms and conditions for the offer"
    )
    layout_config = models.JSONField(
        null=True,
        blank=True,
        default=dict,
        help_text="Optional editor layout metadata (logo position, typography defaults)"
    )

    class Meta:
        ordering = ['-created_at']
        verbose_name = "Offer Template"
        verbose_name_plural = "Offer Templates"

    def __str__(self):
        return self.name


class Offer(NormalizeEmailFieldsMixin, TimeStampedModel, UUIDPrimaryKeyModel):
    NORMALIZED_EMAIL_FIELDS = ('candidate_email', 'company_email')
    """
    Offer letter created for a selected candidate.
    Contains snapshots of all data from template and candidate - no dependency after creation.
    """
    OFFER_STATUS_CHOICES = [
        ('draft', 'Draft'),
        ('created', 'Created'),
        ('sent', 'Sent'),
        ('accepted', 'Accepted'),
        ('rejected', 'Rejected'),
    ]

    # Relations
    candidate = models.ForeignKey(Candidate, on_delete=models.PROTECT, related_name='offers')
    job = models.ForeignKey(JobOpening, on_delete=models.PROTECT, related_name='offers')
    template = models.ForeignKey(OfferTemplate, on_delete=models.PROTECT, related_name='offers', null=True, blank=True)
    component_template = models.ForeignKey(
        'ComponentOfferTemplate',
        on_delete=models.SET_NULL,
        null=True,
        blank=True
    )

    # Candidate Snapshot
    candidate_name = models.CharField(max_length=200)
    candidate_email = models.EmailField()
    candidate_address = models.TextField(blank=True, default='')

    # Company Snapshot
    company_name = models.CharField(max_length=200)
    company_address = models.TextField()
    company_email = models.EmailField()
    company_phone = models.CharField(max_length=20)
    company_logo = models.ImageField(upload_to='offer_company_logos/', null=True, blank=True)

    # HR Signature Snapshot
    hr_name = models.CharField(max_length=200)
    hr_designation = models.CharField(max_length=200)
    hr_signature = models.ImageField(upload_to='offer_hr_signatures/', null=True, blank=True)

    # Job Snapshot
    job_title = models.CharField(max_length=200)
    department = models.CharField(max_length=200)
    job_location = models.CharField(max_length=200)
    employment_type = models.CharField(max_length=50)

    # Salary Details
    ctc = models.DecimalField(max_digits=12, decimal_places=2)
    basic_salary = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    hra = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    allowances = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    bonus = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)

    # Work Details
    joining_date = models.DateField()
    work_shift = models.CharField(max_length=100, null=True, blank=True)
    working_hours = models.CharField(max_length=50, null=True, blank=True)
    weekly_off = models.CharField(max_length=50, default='Saturday, Sunday')

    # Policies
    probation_period = models.CharField(max_length=100, default='6 months')
    notice_period = models.CharField(max_length=100, default='30 days')
    responsibilities = models.TextField(blank=True, default='')
    terms_conditions = models.TextField()

    # Offer Control
    offer_expiry_date = models.DateField()
    status = models.CharField(max_length=20, choices=OFFER_STATUS_CHOICES, default='draft')
    token = models.UUIDField(default=uuid.uuid4, editable=False, unique=True)
    pdf = models.FileField(upload_to='offers/', null=True, blank=True)
    edited_html = models.TextField(blank=True, default='')
    edited_layout_config = models.JSONField(
        null=True,
        blank=True,
        default=dict,
        help_text="Per-offer layout overrides from editor"
    )
    onboarding_completed = models.BooleanField(default=False)
    onboarding_completed_at = models.DateTimeField(null=True, blank=True)
    onboarding_token_expired = models.BooleanField(default=False)
    onboarding_welcome_email_sent_at = models.DateTimeField(
        null=True,
        blank=True,
        help_text=(
            'Set when onboarding welcome email dispatch is claimed (idempotent send). '
            'Cleared if SMTP dispatch fails so HR can retry.'
        ),
    )

    class Meta:
        ordering = ['-created_at']
        verbose_name = "Offer"
        verbose_name_plural = "Offers"
        constraints = [
            models.UniqueConstraint(
                fields=['candidate'],
                condition=models.Q(status__in=['created', 'sent', 'accepted']),
                name='unique_active_offer_per_candidate'
            )
        ]

    def __str__(self):
        return f"Offer for {self.candidate_name} - {self.job_title}"


class OfferBuilderV2(NormalizeEmailFieldsMixin, TimeStampedModel, UUIDPrimaryKeyModel):
    """
    NovoResume-style Offer Builder V2 data.
    Stores the state of an offer letter being built by HR.
    """
    NORMALIZED_EMAIL_FIELDS = ('candidate_email',)
    template = models.ForeignKey(OfferTemplate, on_delete=models.SET_NULL, null=True, blank=True)
    candidate = models.ForeignKey(Candidate, on_delete=models.SET_NULL, null=True, blank=True)

    # Candidate
    candidate_name = models.CharField(max_length=255, blank=True, default='')
    candidate_email = models.EmailField(blank=True, default='')
    candidate_phone = models.CharField(max_length=20, blank=True, default='')
    candidate_address = models.TextField(blank=True, default='')
    candidate_name_salutation = models.CharField(max_length=255, blank=True, default='')

    # Company
    company_name = models.CharField(max_length=255, blank=True, default='')
    company_address = models.TextField(blank=True, default='')
    company_location = models.CharField(max_length=255, blank=True, default='')
    company_contact = models.CharField(max_length=255, blank=True, default='')
    company_website = models.CharField(max_length=255, blank=True, default='')

    # Job
    job_title = models.CharField(max_length=255, blank=True, default='')
    department = models.CharField(max_length=255, blank=True, default='')
    reporting_manager = models.CharField(max_length=255, blank=True, default='')
    job_location = models.CharField(max_length=255, blank=True, default='')
    work_mode = models.CharField(max_length=100, blank=True, default='')
    joining_date = models.DateField(null=True, blank=True)
    offer_expiry_date = models.DateField(null=True, blank=True)

    # Salary
    basic_salary = models.CharField(max_length=50, blank=True, default='')
    hra = models.CharField(max_length=50, blank=True, default='')
    special_allowance = models.CharField(max_length=50, blank=True, default='')
    bonus = models.CharField(max_length=50, blank=True, default='')
    ctc = models.CharField(max_length=50, blank=True, default='')

    # Work
    working_hours = models.CharField(max_length=100, blank=True, default='')
    shift = models.CharField(max_length=100, blank=True, default='')
    weekly_off = models.CharField(max_length=100, blank=True, default='')

    # Terms
    probation_period = models.CharField(max_length=100, blank=True, default='')
    notice_period = models.CharField(max_length=100, blank=True, default='')

    # HR
    hr_name = models.CharField(max_length=255, blank=True, default='')
    hr_designation = models.CharField(max_length=255, blank=True, default='')

    # Letter Labels & Config
    letter_title = models.CharField(max_length=255, blank=True, default='')
    subject_label = models.CharField(max_length=255, blank=True, default='')
    subject_value = models.CharField(max_length=255, blank=True, default='')
    ref_label = models.CharField(max_length=255, blank=True, default='')
    ref_value = models.CharField(max_length=255, blank=True, default='')
    date_label = models.CharField(max_length=255, blank=True, default='')
    date_value = models.CharField(max_length=255, blank=True, default='')
    to_label = models.CharField(max_length=255, blank=True, default='')
    dear_label = models.CharField(max_length=255, blank=True, default='')
    signatory_label = models.CharField(max_length=255, blank=True, default='')
    candidate_sig_label = models.CharField(max_length=255, blank=True, default='')
    date_line_label = models.CharField(max_length=255, blank=True, default='')

    # Design Configuration
    theme = models.CharField(max_length=50, default='corporate')
    font_size = models.IntegerField(default=14)
    letter_title_font_size = models.IntegerField(default=24)
    company_name_font_size = models.IntegerField(default=16)
    candidate_name_font_size = models.IntegerField(default=18)
    company_meta_font_size = models.IntegerField(default=16)

    logo_config = models.JSONField(default=dict, blank=True) # {x, y, width, height, url}
    company_block_config = models.JSONField(default=dict, blank=True)  # {x, y, maxWidth} in px
    letter_section_fonts = models.JSONField(
        default=dict,
        blank=True,
    )  # ref_date, candidate_meta, subject, salutation, footer_note, table_title, table_cell, signatory_line
    signature_config = models.JSONField(default=dict, blank=True) # {position, size, url}
    dynamic_content = models.JSONField(default=list, blank=True) # List of blocks: {type, content, settings}

    # Status
    is_sent = models.BooleanField(default=False)
    sent_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ['-created_at']
        verbose_name = "Offer Builder"
        verbose_name_plural = "Offer Builder"

    def __str__(self):
        return f"Builder V2: {self.candidate_name} - {self.job_title}"


class OfferLetterSettings(TimeStampedModel, UUIDPrimaryKeyModel):
    hospital = models.OneToOneField(
        Hospital,
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name='offer_letter_settings',
    )
    organization_name = models.CharField(max_length=255, blank=True, default='')
    organization_address = models.TextField(blank=True, default='')
    organization_location = models.CharField(max_length=255, blank=True, default='')
    organization_contact = models.CharField(max_length=255, blank=True, default='')
    organization_website = models.CharField(max_length=255, blank=True, default='')
    company_email = models.CharField(max_length=255, blank=True, default='')
    company_phone = models.CharField(max_length=64, blank=True, default='')
    hr_name = models.CharField(max_length=255, blank=True, default='')
    hr_designation = models.CharField(max_length=255, blank=True, default='HR Manager')
    hr_email = models.CharField(max_length=255, blank=True, default='')
    hr_phone = models.CharField(max_length=64, blank=True, default='')
    registered_office_address = models.TextField(blank=True, default='')
    corporate_office_address = models.TextField(blank=True, default='')
    company_registration_number = models.CharField(
        max_length=128,
        blank=True,
        default='',
        help_text='Company registration / CIN number shown on offer letter footer.',
    )
    footer_confidentiality_note = models.TextField(
        blank=True,
        default='CONFIDENTIAL — This document is intended solely for the named recipient.',
    )
    default_terms_conditions = models.JSONField(
        default=list,
        blank=True,
        help_text='Default Terms & Conditions blocks for new offer letters.',
    )
    logo = models.ImageField(upload_to='offer_settings/logos/', null=True, blank=True)
    signature = models.ImageField(upload_to='offer_settings/signatures/', null=True, blank=True)
    logo_config = models.JSONField(default=dict, blank=True)
    signature_config = models.JSONField(default=dict, blank=True)

    class Meta:
        ordering = ['-updated_at']
        verbose_name = 'Organization Settings'
        verbose_name_plural = 'Organization Settings'

    def __str__(self):
        return self.organization_name or 'Organization Settings'

    @property
    def company_name(self):
        return self.organization_name

    @property
    def company_address(self):
        parts = [p for p in (self.organization_address, self.organization_location) if (p or '').strip()]
        return '\n'.join(parts)

    def to_email_branding_dict(self, request=None):
        """Branding for HR emails — Organization Settings fields only (no Hospital data)."""
        from apps.hr.organization_branding import media_url

        logo_url = media_url(self.logo, request)
        signature_url = media_url(self.signature, request)
        org_name = (self.organization_name or '').strip()

        return {
            'company_name': org_name,
            'company_logo': logo_url,
            'company_address': self.company_address,
            'company_email': (self.company_email or '').strip(),
            'company_phone': (self.company_phone or '').strip(),
            'company_website': (self.organization_website or '').strip(),
            'hr_name': (self.hr_name or '').strip(),
            'hr_designation': (self.hr_designation or '').strip() or 'HR Manager',
            'hr_email': (self.hr_email or '').strip(),
            'hr_phone': (self.hr_phone or '').strip(),
            'hr_signature': signature_url,
            'organization_name': org_name,
            'organization_address': (self.organization_address or '').strip(),
            'organization_location': (self.organization_location or '').strip(),
            'organization_contact': (self.organization_contact or '').strip(),
            'organization_website': (self.organization_website or '').strip(),
            'logo_url': logo_url,
            'signature_url': signature_url,
        }

    def to_branding_dict(self, request=None):
        """Canonical branding fields for offer letters and hospital-scoped documents."""
        from apps.hr.organization_branding import media_url

        logo_url = media_url(self.logo, request)
        signature_url = media_url(self.signature, request)
        org_name = (self.organization_name or '').strip()
        company_name = org_name

        return {
            'company_name': company_name,
            'company_logo': logo_url,
            'company_address': self.company_address,
            'company_email': (self.company_email or '').strip(),
            'company_phone': (self.company_phone or '').strip(),
            'company_website': (self.organization_website or '').strip(),
            'hr_name': (self.hr_name or '').strip(),
            'hr_designation': (self.hr_designation or '').strip() or 'HR Manager',
            'hr_email': (self.hr_email or '').strip(),
            'hr_phone': (self.hr_phone or '').strip(),
            'hr_signature': signature_url,
            'organization_name': company_name,
            'organization_address': (self.organization_address or '').strip(),
            'organization_location': (self.organization_location or '').strip(),
            'organization_contact': (self.organization_contact or '').strip(),
            'organization_website': (self.organization_website or '').strip(),
            'registered_office_address': (self.registered_office_address or '').strip(),
            'corporate_office_address': (self.corporate_office_address or '').strip(),
            'company_registration_number': (self.company_registration_number or '').strip(),
            'footer_confidentiality_note': (self.footer_confidentiality_note or '').strip(),
            'logo_url': logo_url,
            'signature_url': signature_url,
        }


# Payroll engine foundation (see payroll_calculator.py for calculation skeleton)
from apps.hr.payroll_models import PayrollAuditLog, Payslip, PayrollRun, SalaryStructure  # noqa: E402, F401
