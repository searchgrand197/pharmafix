"""
Payroll engine foundation models.

Integrates with existing Employee, DailyAttendance, and LeaveRequest data
without modifying those models. Business rules are enforced in PayrollCalculator
(see payroll_calculator.py) — not yet fully implemented.
"""
from __future__ import annotations

from decimal import Decimal

from django.conf import settings
from django.core.validators import RegexValidator
from django.db import models

from apps.shared.models import TimeStampedModel, UUIDPrimaryKeyModel

MONTH_FORMAT_VALIDATOR = RegexValidator(
    regex=r'^\d{4}-(0[1-9]|1[0-2])$',
    message='Month must be in YYYY-MM format.',
)


class AttendanceCompliancePolicyFields(models.Model):
    """Shared attendance compliance settings for salary structure templates."""

    class Meta:
        abstract = True

    late_policy_enabled = models.BooleanField(
        default=False,
        help_text='When enabled, late penalty uses structure fields instead of global payroll settings.',
    )
    grace_minutes = models.PositiveSmallIntegerField(
        null=True,
        blank=True,
        help_text='Grace minutes before late applies; defaults to employee shift when empty.',
    )
    late_penalty_threshold_minutes = models.PositiveSmallIntegerField(
        default=15,
        help_text='Minutes above grace before per-minute penalty billing starts.',
    )
    late_penalty_type = models.CharField(
        max_length=32,
        default='per_minute',
        choices=[
            ('per_minute', 'Per minute'),
            ('fixed_per_late_day', 'Fixed per late day'),
            ('percentage_daily_salary', 'Percentage of daily salary'),
        ],
    )
    late_penalty_value = models.DecimalField(
        max_digits=10,
        decimal_places=2,
        default=Decimal('0.00'),
        help_text='Rate per minute, fixed amount per late day, or percentage of daily salary.',
    )
    late_conversion_enabled = models.BooleanField(
        default=False,
        help_text='Convert monthly late count into equivalent leave-day deductions.',
    )
    late_count_for_half_day = models.PositiveSmallIntegerField(null=True, blank=True)
    late_count_for_full_day = models.PositiveSmallIntegerField(null=True, blank=True)
    warning_after_n_lates = models.PositiveSmallIntegerField(null=True, blank=True)
    half_day_after_n_lates = models.PositiveSmallIntegerField(null=True, blank=True)
    full_day_after_n_lates = models.PositiveSmallIntegerField(null=True, blank=True)
    overtime_enabled = models.BooleanField(default=True)
    overtime_type = models.CharField(
        max_length=32,
        default='fixed_per_hour',
        choices=[
            ('fixed_per_hour', 'Fixed per hour'),
            ('percentage_hourly_rate', 'Percentage of hourly rate'),
        ],
    )
    weekend_ot_multiplier = models.DecimalField(
        max_digits=5,
        decimal_places=2,
        default=Decimal('1.00'),
    )
    holiday_ot_multiplier = models.DecimalField(
        max_digits=5,
        decimal_places=2,
        default=Decimal('1.00'),
    )


class DepartmentSalaryStructure(AttendanceCompliancePolicyFields, TimeStampedModel, UUIDPrimaryKeyModel):
    """
    Default compensation template for a department.

    Employees inherit this structure unless they have their own employee-level
    SalaryStructure assignment (override).
    """

    department = models.ForeignKey(
        'hr.Department',
        on_delete=models.PROTECT,
        related_name='salary_structures',
    )
    designation = models.ForeignKey(
        'hr.Designation',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='salary_structures',
    )
    name = models.CharField(max_length=120, blank=True, default='')
    basic_salary = models.DecimalField(max_digits=12, decimal_places=2)
    hra = models.DecimalField(max_digits=12, decimal_places=2, default=Decimal('0.00'))
    allowances = models.JSONField(
        default=dict,
        blank=True,
        help_text='Flexible allowance breakdown, e.g. {"transport": 1500, "medical": 800}.',
    )
    deductions = models.JSONField(
        default=dict,
        blank=True,
        help_text='Fixed monthly deductions, e.g. {"pf": 1800, "professional_tax": 200}.',
    )
    overtime_rate = models.DecimalField(
        max_digits=10,
        decimal_places=2,
        default=Decimal('0.00'),
        help_text='Hourly overtime rate applied when shift policy allows OT.',
    )
    effective_from = models.DateField(db_index=True)
    effective_to = models.DateField(null=True, blank=True)
    is_active = models.BooleanField(default=True, db_index=True)
    notes = models.TextField(blank=True, default='')

    class Meta:
        ordering = ['-effective_from', '-created_at']
        indexes = [
            models.Index(fields=['department', 'effective_from']),
            models.Index(fields=['department', 'is_active']),
        ]

    def __str__(self):
        label = self.name or self.department.name
        return f'{label} structure from {self.effective_from}'


class CompensationLevel(AttendanceCompliancePolicyFields, TimeStampedModel, UUIDPrimaryKeyModel):
    """
    Enterprise-style pay grade / level independent from the employee job title.

    Multiple active levels (for example Nurse L0, L1, L2) can coexist for the
    same designation. Versioning is handled per code/effective date.
    """

    hospital = models.ForeignKey(
        'shared.Hospital',
        on_delete=models.PROTECT,
        related_name='compensation_levels',
    )
    designation = models.ForeignKey(
        'hr.Designation',
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name='compensation_levels',
    )
    code = models.CharField(max_length=50)
    name = models.CharField(max_length=120)
    rank = models.PositiveSmallIntegerField(default=0)
    basic = models.DecimalField(max_digits=12, decimal_places=2)
    hra = models.DecimalField(max_digits=12, decimal_places=2, default=Decimal('0.00'))
    medical = models.DecimalField(max_digits=12, decimal_places=2, default=Decimal('0.00'))
    special_allowance = models.DecimalField(max_digits=12, decimal_places=2, default=Decimal('0.00'))
    allowances = models.JSONField(
        default=dict,
        blank=True,
        help_text='Flexible allowance breakdown, e.g. {"transport": 1500, "meal": 800}.',
    )
    deductions = models.JSONField(
        default=dict,
        blank=True,
        help_text='Fixed monthly deductions, e.g. {"pf": 1800, "tax": 200}.',
    )
    overtime_rate = models.DecimalField(
        max_digits=10,
        decimal_places=2,
        default=Decimal('0.00'),
        help_text='Hourly overtime rate applied when shift policy allows OT.',
    )
    effective_from = models.DateField(db_index=True)
    effective_to = models.DateField(null=True, blank=True)
    is_active = models.BooleanField(default=True, db_index=True)
    is_default_for_designation = models.BooleanField(
        default=False,
        db_index=True,
        help_text='Auto-assign this level to new employees for the linked designation.',
    )
    notes = models.TextField(blank=True, default='')

    class Meta:
        ordering = ['designation__name', 'rank', '-effective_from', '-created_at']
        constraints = [
            models.UniqueConstraint(
                fields=['hospital', 'code', 'effective_from'],
                name='unique_compensation_level_code_from_date',
            ),
        ]
        indexes = [
            models.Index(fields=['hospital', 'designation', 'is_active']),
            models.Index(fields=['hospital', 'code', 'is_active']),
            models.Index(fields=['designation', 'rank', 'effective_from']),
            models.Index(fields=['hospital', 'is_default_for_designation']),
        ]

    def __str__(self):
        return f'{self.code} — {self.name} from {self.effective_from}'


class EmployeeCompensationAssignment(TimeStampedModel, UUIDPrimaryKeyModel):
    """Effective-dated employee mapping to a compensation level."""

    employee = models.ForeignKey(
        'hr.Employee',
        on_delete=models.PROTECT,
        related_name='compensation_assignments',
    )
    compensation_level = models.ForeignKey(
        CompensationLevel,
        on_delete=models.PROTECT,
        related_name='employee_compensation_assignments',
    )
    effective_from = models.DateField(db_index=True)
    effective_to = models.DateField(null=True, blank=True)
    is_active = models.BooleanField(default=True, db_index=True)

    class Meta:
        ordering = ['-effective_from', '-created_at']
        indexes = [
            models.Index(fields=['employee', 'effective_from']),
            models.Index(fields=['employee', 'is_active']),
        ]

    def __str__(self):
        return f'{self.employee_id} → {self.compensation_level_id} from {self.effective_from}'


class EmployeeCompensationOverride(TimeStampedModel, UUIDPrimaryKeyModel):
    """
    Optional employee-specific pay override layered on top of a compensation level.

    Null fields mean "inherit from base assignment". JSON fields use null to
    distinguish "no override" from an explicit empty dict.
    """

    employee = models.ForeignKey(
        'hr.Employee',
        on_delete=models.PROTECT,
        related_name='compensation_overrides',
    )
    basic = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    hra = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    medical = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    special_allowance = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    allowances = models.JSONField(
        null=True,
        blank=True,
        default=None,
        help_text='Only supplied keys override inherited allowances.',
    )
    deductions = models.JSONField(
        null=True,
        blank=True,
        default=None,
        help_text='Only supplied keys override inherited deductions.',
    )
    overtime_rate = models.DecimalField(max_digits=10, decimal_places=2, null=True, blank=True)
    reason = models.TextField(blank=True, default='')
    approved_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='approved_compensation_overrides',
    )
    effective_from = models.DateField(db_index=True)
    effective_to = models.DateField(null=True, blank=True)
    is_active = models.BooleanField(default=True, db_index=True)

    class Meta:
        ordering = ['-effective_from', '-created_at']
        indexes = [
            models.Index(fields=['employee', 'effective_from']),
            models.Index(fields=['employee', 'is_active']),
        ]

    def __str__(self):
        return f'{self.employee_id} override from {self.effective_from}'


class SalaryStructure(AttendanceCompliancePolicyFields, TimeStampedModel, UUIDPrimaryKeyModel):
    """
    Employee compensation structure effective from a given date.

    Legacy ``Salary`` rows remain for historical monthly snapshots; this model
    is the canonical source for payroll calculation inputs going forward.
    """

    employee = models.ForeignKey(
        'hr.Employee',
        on_delete=models.PROTECT,
        related_name='salary_structures',
    )
    source_department_structure = models.ForeignKey(
        DepartmentSalaryStructure,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='employee_assignments',
        help_text='Department template this assignment was copied from, if any.',
    )
    basic_salary = models.DecimalField(max_digits=12, decimal_places=2)
    hra = models.DecimalField(max_digits=12, decimal_places=2, default=Decimal('0.00'))
    allowances = models.JSONField(
        default=dict,
        blank=True,
        help_text='Flexible allowance breakdown, e.g. {"transport": 1500, "medical": 800}.',
    )
    deductions = models.JSONField(
        default=dict,
        blank=True,
        help_text='Fixed monthly deductions, e.g. {"pf": 1800, "professional_tax": 200}.',
    )
    overtime_rate = models.DecimalField(
        max_digits=10,
        decimal_places=2,
        default=Decimal('0.00'),
        help_text='Hourly overtime rate applied when shift policy allows OT.',
    )
    effective_from = models.DateField(db_index=True)
    effective_to = models.DateField(null=True, blank=True)
    is_active = models.BooleanField(default=True, db_index=True)
    notes = models.TextField(blank=True, default='')

    class Meta:
        ordering = ['-effective_from', '-created_at']
        indexes = [
            models.Index(fields=['employee', 'effective_from']),
            models.Index(fields=['employee', 'is_active']),
        ]

    def __str__(self):
        return f'{self.employee_id} structure from {self.effective_from}'


class PayrollRun(TimeStampedModel, UUIDPrimaryKeyModel):
    """Monthly payroll computation record per employee."""

    STATUS_DRAFT = 'DRAFT'
    STATUS_CALCULATED = 'CALCULATED'
    STATUS_UNDER_REVIEW = 'UNDER_REVIEW'
    STATUS_APPROVED = 'APPROVED'
    STATUS_LOCKED = 'LOCKED'
    STATUS_PUBLISHED = 'PUBLISHED'
    STATUS_FINALIZED = 'FINALIZED'  # legacy — treated as APPROVED in workflow
    STATUS_CHOICES = [
        (STATUS_DRAFT, 'Draft'),
        (STATUS_CALCULATED, 'Calculated'),
        (STATUS_UNDER_REVIEW, 'Under Review'),
        (STATUS_APPROVED, 'Approved'),
        (STATUS_LOCKED, 'Locked'),
        (STATUS_PUBLISHED, 'Published'),
        (STATUS_FINALIZED, 'Finalized (legacy)'),
    ]
    EDITABLE_STATUSES = frozenset({STATUS_DRAFT, STATUS_CALCULATED, STATUS_UNDER_REVIEW})
    PAYSLIP_ELIGIBLE_STATUSES = frozenset({STATUS_LOCKED, STATUS_PUBLISHED, STATUS_FINALIZED})

    employee = models.ForeignKey(
        'hr.Employee',
        on_delete=models.PROTECT,
        related_name='payroll_runs',
    )
    salary_structure = models.ForeignKey(
        SalaryStructure,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='payroll_runs',
    )
    employee_compensation_assignment = models.ForeignKey(
        EmployeeCompensationAssignment,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='payroll_runs',
        help_text='Compensation-level assignment used for this payroll run (audit).',
    )
    month = models.CharField(
        max_length=7,
        validators=[MONTH_FORMAT_VALIDATOR],
        db_index=True,
        help_text='Payroll period in YYYY-MM format.',
    )
    total_present_days = models.DecimalField(max_digits=6, decimal_places=2, default=Decimal('0.00'))
    total_absent_days = models.DecimalField(max_digits=6, decimal_places=2, default=Decimal('0.00'))
    total_leave_days = models.DecimalField(max_digits=6, decimal_places=2, default=Decimal('0.00'))
    overtime_hours = models.DecimalField(max_digits=8, decimal_places=2, default=Decimal('0.00'))
    gross_salary = models.DecimalField(max_digits=12, decimal_places=2, default=Decimal('0.00'))
    total_deductions = models.DecimalField(max_digits=12, decimal_places=2, default=Decimal('0.00'))
    final_salary = models.DecimalField(max_digits=12, decimal_places=2, default=Decimal('0.00'))
    status = models.CharField(
        max_length=16,
        choices=STATUS_CHOICES,
        default=STATUS_DRAFT,
        db_index=True,
    )
    calculation_snapshot = models.JSONField(
        default=dict,
        blank=True,
        help_text='Intermediate values from PayrollCalculator (attendance/leave inputs, LOP, OT, etc.).',
    )
    calculated_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='payroll_runs_calculated',
    )
    reviewed_at = models.DateTimeField(null=True, blank=True)
    reviewed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='payroll_runs_reviewed',
    )
    approved_at = models.DateTimeField(null=True, blank=True)
    approved_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='payroll_runs_approved',
    )
    finalized_at = models.DateTimeField(null=True, blank=True)
    locked_at = models.DateTimeField(null=True, blank=True)
    published_at = models.DateTimeField(null=True, blank=True)
    published_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='payroll_runs_published',
    )

    class Meta:
        ordering = ['-month', '-created_at']
        constraints = [
            models.UniqueConstraint(
                fields=['employee', 'month'],
                name='unique_payroll_run_per_employee_month',
            ),
        ]
        indexes = [
            models.Index(fields=['month', 'status']),
            models.Index(fields=['employee', 'month']),
        ]

    @property
    def is_editable(self) -> bool:
        return self.status in self.EDITABLE_STATUSES

    @property
    def is_immutable(self) -> bool:
        return self.status in {self.STATUS_LOCKED, self.STATUS_PUBLISHED}

    def save(self, *args, **kwargs):
        if self.pk and not self._state.adding:
            allowed = kwargs.get('update_fields')
            workflow_only = allowed and set(allowed).issubset({
                'status', 'reviewed_at', 'reviewed_by', 'approved_at', 'approved_by',
                'locked_at', 'published_at', 'published_by', 'finalized_at',
                'calculation_snapshot', 'updated_at',
            })
            if not workflow_only:
                previous = PayrollRun.objects.filter(pk=self.pk).values_list('status', flat=True).first()
                if previous and previous not in self.EDITABLE_STATUSES:
                    raise ValueError(
                        f'PayrollRun in {previous} status cannot be modified. HR override is required.',
                    )
        return super().save(*args, **kwargs)

    def __str__(self):
        return f'{self.employee_id} payroll {self.month} ({self.status})'


class PayrollAuditLog(TimeStampedModel, UUIDPrimaryKeyModel):
    """Immutable audit trail for payroll workflow and data changes."""

    ACTION_CREATE = 'CREATE'
    ACTION_UPDATE = 'UPDATE'
    ACTION_CALCULATE = 'CALCULATE'
    ACTION_SUBMIT_REVIEW = 'SUBMIT_REVIEW'
    ACTION_APPROVE = 'APPROVE'
    ACTION_LOCK = 'LOCK'
    ACTION_PUBLISH = 'PUBLISH'
    ACTION_CHOICES = [
        (ACTION_CREATE, 'Create'),
        (ACTION_UPDATE, 'Update'),
        (ACTION_CALCULATE, 'Calculate'),
        (ACTION_SUBMIT_REVIEW, 'Submit for Review'),
        (ACTION_APPROVE, 'Approve'),
        (ACTION_LOCK, 'Lock'),
        (ACTION_PUBLISH, 'Publish'),
    ]

    payroll_run = models.ForeignKey(
        PayrollRun,
        on_delete=models.CASCADE,
        related_name='audit_logs',
    )
    action = models.CharField(max_length=20, choices=ACTION_CHOICES, db_index=True)
    performed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='payroll_audit_logs',
    )
    old_value = models.JSONField(default=dict, blank=True)
    new_value = models.JSONField(default=dict, blank=True)
    notes = models.TextField(blank=True, default='')

    class Meta:
        ordering = ['-created_at']
        indexes = [
            models.Index(fields=['payroll_run', 'action']),
            models.Index(fields=['payroll_run', 'created_at']),
        ]

    def save(self, *args, **kwargs):
        if not self._state.adding:
            raise ValueError('PayrollAuditLog entries are append-only.')
        return super().save(*args, **kwargs)

    def __str__(self):
        return f'{self.payroll_run_id} {self.action}'


class Payslip(TimeStampedModel, UUIDPrimaryKeyModel):
    """Immutable payslip artifact generated from a locked PayrollRun."""

    payroll_run = models.OneToOneField(
        PayrollRun,
        on_delete=models.CASCADE,
        related_name='payslip',
    )
    employee = models.ForeignKey(
        'hr.Employee',
        on_delete=models.PROTECT,
        related_name='payslips',
    )
    month = models.CharField(
        max_length=7,
        validators=[MONTH_FORMAT_VALIDATOR],
        db_index=True,
    )
    earnings_breakdown = models.JSONField(
        default=dict,
        blank=True,
        help_text='Earnings line items, e.g. {"basic_salary": 30000, "hra": 12000, "overtime": 500}.',
    )
    deductions_breakdown = models.JSONField(
        default=dict,
        blank=True,
        help_text='Deduction line items, e.g. {"lop": 2000, "pf": 1800, "late_penalty": 75}.',
    )
    gross_salary = models.DecimalField(
        max_digits=12,
        decimal_places=2,
        default=Decimal('0.00'),
        help_text='Total earnings before deductions (includes overtime).',
    )
    net_salary = models.DecimalField(
        max_digits=12,
        decimal_places=2,
        default=Decimal('0.00'),
        help_text='Net payable salary after all deductions.',
    )
    pdf_file = models.FileField(
        upload_to='payslips/%Y/%m/',
        null=True,
        blank=True,
        help_text='Generated payslip PDF.',
    )
    generated_at = models.DateTimeField(null=True, blank=True, db_index=True)

    class Meta:
        ordering = ['-month', '-created_at']
        indexes = [
            models.Index(fields=['employee', 'month']),
        ]

    def save(self, *args, **kwargs):
        if not self._state.adding:
            raise ValueError('Payslip records are immutable after generation. HR override is required to change.')
        return super().save(*args, **kwargs)

    def __str__(self):
        return f'Payslip {self.employee_id} {self.month}'
