"""
Employee portal payslip queries — single source for published payslip visibility.
"""

from __future__ import annotations

from apps.hr.payroll_models import PayrollRun, Payslip


def published_payslips_for_employee(employee, *, month: str | None = None):
    """Published payslips only (payroll run status PUBLISHED)."""
    qs = (
        Payslip.objects.filter(
            employee=employee,
            payroll_run__status=PayrollRun.STATUS_PUBLISHED,
        )
        .select_related('payroll_run', 'employee')
        .order_by('-month', '-generated_at')
    )
    if month:
        qs = qs.filter(month=str(month).strip()[:7])
    return qs
