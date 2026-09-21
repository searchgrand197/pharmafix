"""
Production payroll calculation service.
Reads from Employee, SalaryStructure, DailyAttendance, and LeaveRequest.
Attendance is the source of truth; approved leave overrides absence on working days.
"""
from __future__ import annotations
import calendar
from dataclasses import dataclass, field
from datetime import date, timedelta
from decimal import Decimal
from typing import TYPE_CHECKING
from django.conf import settings
from django.db import transaction
from django.utils import timezone
from apps.hr.attendance_compliance import (
    ComplianceCalculationResult,
    build_compliance_audit,
    calculate_escalation,
    calculate_late_equivalent_days,
    calculate_late_penalty_with_policy,
    calculate_overtime_pay,
    resolve_compliance_policy,
)
from apps.hr.serializers import LeaveRequestSerializer
if TYPE_CHECKING:

    from apps.hr.models import DailyAttendance, Employee, LeaveRequest
    from apps.hr.payroll_models import PayrollRun, SalaryStructure
MONEY_QUANTIZE = Decimal('0.01')
DAY_QUANTIZE = Decimal('0.01')
PRESENT_STATUSES = frozenset({'present', 'late', 'overtime', 'work_from_office'})
NON_WORKING_STATUSES = frozenset({'weekend', 'holiday'})
HALF_DAY_STATUS = 'half_day'
LEAVE_STATUS = 'leave'
def employee_effective_join_date(employee: 'Employee') -> date | None:

    """Same join-date rule as employee portal attendance summaries."""
    return employee.joining_date_confirmed or employee.joining_date
def employee_eligible_for_payroll_month(employee: 'Employee', month: str) -> bool:

    """False when employee joined after the payroll month ends (Case 3)."""
    _, month_end = parse_payroll_month(month)
    join = employee_effective_join_date(employee)
    return not (join and join > month_end)
@dataclass
class LeaveDaysBreakdown:

    paid: Decimal = Decimal('0.00')
    unpaid: Decimal = Decimal('0.00')
    @property
    def total(self) -> Decimal:

        return (self.paid + self.unpaid).quantize(DAY_QUANTIZE)
@dataclass
class AttendancePayrollSummary:

    """Aggregated attendance inputs for a payroll month."""
    present_days: Decimal = Decimal('0.00')
    absent_days: Decimal = Decimal('0.00')
    leave_days: Decimal = Decimal('0.00')
    paid_leave_days: Decimal = Decimal('0.00')
    unpaid_leave_days: Decimal = Decimal('0.00')
    holiday_days: Decimal = Decimal('0.00')
    half_days: Decimal = Decimal('0.00')
    late_days: Decimal = Decimal('0.00')
    overtime_hours: Decimal = Decimal('0.00')
    total_work_hours: Decimal = Decimal('0.00')
    late_penalty: Decimal = Decimal('0.00')
    monthly_late_count: int = 0
    working_days_in_month: int = 0
    has_attendance_data: bool = False
    period_start: date | None = None
    period_end: date | None = None
@dataclass
class PayrollCalculationResult:

    """Output of a payroll calculation pass (not persisted unless caller saves)."""
    gross_salary: Decimal = Decimal('0.00')
    total_deductions: Decimal = Decimal('0.00')
    final_salary: Decimal = Decimal('0.00')
    per_day_salary: Decimal = Decimal('0.00')
    lop_amount: Decimal = Decimal('0.00')
    overtime_amount: Decimal = Decimal('0.00')
    late_penalty: Decimal = Decimal('0.00')
    late_equivalent_leave_days: Decimal = Decimal('0.00')
    late_conversion_deduction: Decimal = Decimal('0.00')
    attendance_compliance_deduction: Decimal = Decimal('0.00')
    monthly_late_count: int = 0
    compliance_warnings: list[str] = field(default_factory=list)
    compliance_audit: dict = field(default_factory=dict)
    attendance_summary: AttendancePayrollSummary = field(default_factory=AttendancePayrollSummary)
    leave_breakdown: LeaveDaysBreakdown = field(default_factory=LeaveDaysBreakdown)
    earnings_breakdown: dict = field(default_factory=dict)
    deductions_breakdown: dict = field(default_factory=dict)
    warnings: list[str] = field(default_factory=list)
@dataclass
class PayrollGenerationResult:

    """Batch output from generate_monthly_payroll."""
    month: str
    created: list['PayrollRun'] = field(default_factory=list)
    recalculated: list['PayrollRun'] = field(default_factory=list)
    skipped: list[dict] = field(default_factory=list)
    errors: list[dict] = field(default_factory=list)
class PayrollCalculatorError(Exception):

    """Raised when payroll cannot be calculated (missing structure, locked run, etc.)."""
class DuplicatePayrollError(PayrollCalculatorError):

    """Raised when payroll already exists for employee + month."""
class PayrollPeriodError(PayrollCalculatorError):

    """Raised when employee is not eligible for the requested payroll month."""
def parse_payroll_month(month: str) -> tuple[date, date]:

    """Return inclusive (month_start, month_end) for YYYY-MM."""
    try:

        year_str, month_str = month.split('-', 1)
        year, month_num = int(year_str), int(month_str)
        if month_num < 1 or month_num > 12:

            raise ValueError
        last_day = calendar.monthrange(year, month_num)[1]
        return date(year, month_num, 1), date(year, month_num, last_day)
    except (ValueError, AttributeError) as exc:

        raise PayrollCalculatorError(f'Invalid payroll month {month!r}. Expected YYYY-MM.') from exc
def is_calendar_weekend(day: date) -> bool:

    return day.weekday() >= 5


class PayrollCalculator:

    """
    Monthly payroll calculator for a single employee.
    Deterministic: same inputs always yield the same monetary outputs.
    """
    def __init__(
        self,
        *,
        employee: 'Employee',
        month: str,
        salary_structure: 'SalaryStructure | None' = None,
        period_start: date | None = None,
        period_end: date | None = None,
        require_finalized_attendance: bool = False,
    ):

        self.employee = employee
        self.month = month
        self.salary_structure = salary_structure
        self._period_start_override = period_start
        self._period_end_override = period_end
        self.require_finalized_attendance = require_finalized_attendance
        self._attendance_by_date: dict[date, 'DailyAttendance'] | None = None
        self._approved_leaves: list['LeaveRequest'] | None = None
        self._period_bounds: tuple[date, date] | None = None
        self._holiday_dates_cache: set[date] | None = None
        self._compliance_result: ComplianceCalculationResult | None = None
        self._resolved_compensation = None
    @property
    def employee_code(self) -> str:

        return self.employee.employee_id or str(self.employee.pk)
    # --- Period helpers ---
    def get_payroll_period(self, month: str | None = None) -> tuple[date, date]:

        """
        Inclusive payroll window aligned with portal attendance summaries.
        Case 1: joined before month → 1st to last day of month.
        Case 2: joined during month → joining date to last day of month.
        Case 3: joined after month → raises PayrollPeriodError.
        """
        if self._period_bounds is not None and month in (None, self.month):

            return self._period_bounds
        if self._period_start_override is not None and self._period_end_override is not None:
            join = employee_effective_join_date(self.employee)
            period_start = self._period_start_override
            if join and join > period_start:
                period_start = join
            period_end = self._period_end_override
            if join and join > period_end:
                raise PayrollPeriodError(
                    f'Employee {self.employee_code} joined after attendance period ending {period_end}.',
                )
            if month is None or month == self.month:
                self._period_bounds = (period_start, period_end)
            return period_start, period_end
        target_month = month or self.month
        month_start, month_end = parse_payroll_month(target_month)
        join = employee_effective_join_date(self.employee)
        if join and join > month_end:

            raise PayrollPeriodError(
                f'Employee {self.employee_code} joined after payroll month {target_month}.',
            )
        period_start = month_start
        if join and join > period_start:

            period_start = join
        period_end = month_end
        if month is None or month == self.month:

            self._period_bounds = (period_start, period_end)
        return period_start, period_end
    def _iter_period_days(self, month: str | None = None):

        period_start, period_end = self.get_payroll_period(month)
        day = period_start
        while day <= period_end:

            yield day
            day += timedelta(days=1)

    def _iter_days_in_range(self, start: date, end: date):

        day = start
        while day <= end:

            yield day
            day += timedelta(days=1)
    def _attendance_rows(self, month: str | None = None) -> dict[date, 'DailyAttendance']:

        if self._attendance_by_date is not None and month in (None, self.month):

            return self._attendance_by_date
        from apps.hr.models import DailyAttendance
        period_start, period_end = self.get_payroll_period(month)
        rows = DailyAttendance.objects.filter(
            employee=self.employee,
            date__gte=period_start,
            date__lte=period_end,
        )
        if self.require_finalized_attendance:
            rows = rows.filter(finalized=True)
        mapping = {row.date: row for row in rows}
        if month is None or month == self.month:

            self._attendance_by_date = mapping
        return mapping
    def _approved_leave_requests(self, month: str | None = None) -> list['LeaveRequest']:

        if self._approved_leaves is not None and month in (None, self.month):

            return self._approved_leaves
        from apps.hr.models import LeaveRequest
        period_start, period_end = self.get_payroll_period(month)
        leaves = list(
            LeaveRequest.objects.filter(
                employee=self.employee,
                status=LeaveRequest.STATUS_APPROVED,
                start_date__lte=period_end,
                end_date__gte=period_start,
            ).select_related('leave_type')
        )
        if month is None or month == self.month:

            self._approved_leaves = leaves
        return leaves
    def _holiday_dates_in_period(self, month: str | None = None) -> set[date]:

        if self._holiday_dates_cache is not None and month in (None, self.month):

            return self._holiday_dates_cache
        from apps.hr.holiday_services import holidays_in_range_for_employee
        period_start, period_end = self.get_payroll_period(month)
        dates: set[date] = set()
        for holiday in holidays_in_range_for_employee(self.employee, period_start, period_end):

            dates.add(holiday.date)
        for day, row in self._attendance_rows(month).items():

            if row.attendance_status == 'holiday':

                dates.add(day)
        if month is None or month == self.month:

            self._holiday_dates_cache = dates
        return dates

    def _holiday_dates_for_range(self, start: date, end: date) -> set[date]:

        from apps.hr.holiday_services import holidays_in_range_for_employee
        from apps.hr.models import DailyAttendance

        dates: set[date] = set()
        for holiday in holidays_in_range_for_employee(self.employee, start, end):

            dates.add(holiday.date)
        for day in DailyAttendance.objects.filter(
            employee=self.employee,
            date__gte=start,
            date__lte=end,
            attendance_status='holiday',
        ).values_list('date', flat=True):

            dates.add(day)
        return dates
    def _is_working_day(self, day: date, month: str | None = None) -> bool:

        if day in self._holiday_dates_in_period(month):

            return False
        attendance = self._attendance_rows(month).get(day)
        if attendance is not None:

            return attendance.attendance_status not in NON_WORKING_STATUSES
        return not is_calendar_weekend(day)
    def _iter_working_days(self, month: str | None = None):

        for day in self._iter_period_days(month):

            if self._is_working_day(day, month):

                yield day
    def _leave_on_date(self, day: date, month: str | None = None) -> 'LeaveRequest | None':

        for leave in self._approved_leave_requests(month):

            if leave.start_date <= day <= leave.end_date:

                return leave
        return None
    def _resolved_metrics(self, day: date, month: str | None = None) -> dict | None:

        row = self._attendance_rows(month).get(day)
        if row is None:

            return None
        from apps.hr.attendance_analytics import resolve_daily_attendance_display
        return resolve_daily_attendance_display(row, self.employee)
    def _display_status(self, day: date, month: str | None = None) -> str | None:

        metrics = self._resolved_metrics(day, month)
        if metrics is not None:

            return metrics.get('status')
        row = self._attendance_rows(month).get(day)
        return row.attendance_status if row is not None else None
    def _present_weight_for_day(self, day: date, month: str | None = None) -> Decimal:

        status = self._display_status(day, month)
        if status in PRESENT_STATUSES:

            return Decimal('1.00')
        if status == HALF_DAY_STATUS:

            return Decimal('0.50')
        # Checked-in but day not closed yet (in progress / missing checkout) still counts as present.
        if status in {'in_progress', 'missing_checkout'}:
            row = self._attendance_rows(month).get(day)
            if row is not None and row.first_check_in is not None:
                return Decimal('1.00')
        return Decimal('0.00')
    def _is_leave_day(self, day: date, month: str | None = None) -> tuple[bool, bool]:

        """
        Return (is_leave, is_unpaid) for a working day.
        Approved LeaveRequest wins; otherwise DailyAttendance leave flags apply.
        """
        if self._present_weight_for_day(day, month) >= Decimal('1.00'):

            return False, False
        leave = self._leave_on_date(day, month)
        if leave is not None:

            return True, LeaveRequestSerializer.allows_lwp(leave.leave_type)
        row = self._attendance_rows(month).get(day)
        if row is not None and (row.attendance_status == LEAVE_STATUS or row.is_on_leave):

            leave_type = row.leave_type
            if leave_type is not None:

                return True, LeaveRequestSerializer.allows_lwp(leave_type)
            return True, False
        return False, False
    # --- Required calculation methods ---
    def calculate_working_days(self, month: str | None = None) -> int:

        """Total working days excluding weekends and holidays within the payroll window."""
        return sum(1 for _ in self._iter_working_days(month))

    def calculate_full_month_working_days(self, month: str | None = None) -> int:

        """Total working days across the full calendar month, regardless of join date."""
        month_start, month_end = parse_payroll_month(month or self.month)
        holidays = self._holiday_dates_for_range(month_start, month_end)
        total = 0
        for day in self._iter_days_in_range(month_start, month_end):

            if day in holidays or is_calendar_weekend(day):
                continue
            total += 1
        return total
    def calculate_holiday_days(self, month: str | None = None) -> Decimal:

        """Paid holidays in the payroll period (OrganizationHoliday + attendance holiday rows)."""
        return Decimal(len(self._holiday_dates_in_period(month))).quantize(DAY_QUANTIZE)
    def calculate_half_days(self, month: str | None = None) -> Decimal:

        total = Decimal('0.00')
        for day in self._iter_working_days(month):

            if self._display_status(day, month) == HALF_DAY_STATUS:

                total += Decimal('1.00')
        return total.quantize(DAY_QUANTIZE)
    def calculate_late_days(self, month: str | None = None) -> Decimal:

        total = Decimal('0.00')
        for day in self._iter_working_days(month):

            metrics = self._resolved_metrics(day, month)
            status = self._display_status(day, month)
            late_minutes = 0
            if metrics is not None:

                late_minutes = int(metrics.get('late_minutes') or 0)
            else:

                row = self._attendance_rows(month).get(day)
                late_minutes = int(row.late_minutes or 0) if row else 0
            if status == 'late' or late_minutes > 0:

                total += Decimal('1.00')
        return total.quantize(DAY_QUANTIZE)
    def calculate_present_days(self, employee: 'Employee | None' = None, month: str | None = None) -> Decimal:

        """Present days from DailyAttendance (portal-aligned status; half-day = 0.5)."""
        if employee is not None and employee.pk != self.employee.pk:

            return PayrollCalculator(employee=employee, month=month or self.month).calculate_present_days(month=month)
        total = Decimal('0.00')
        for day in self._iter_working_days(month):

            total += self._present_weight_for_day(day, month)
        return total.quantize(DAY_QUANTIZE)
    def calculate_leave_days(self, employee: 'Employee | None' = None, month: str | None = None) -> LeaveDaysBreakdown:

        """Approved leave and attendance leave status on working days."""
        if employee is not None and employee.pk != self.employee.pk:

            return PayrollCalculator(employee=employee, month=month or self.month).calculate_leave_days(month=month)
        paid = Decimal('0.00')
        unpaid = Decimal('0.00')
        for day in self._iter_working_days(month):

            is_leave, is_unpaid = self._is_leave_day(day, month)
            if not is_leave:

                continue
            if is_unpaid:

                unpaid += Decimal('1.00')
            else:

                paid += Decimal('1.00')
        return LeaveDaysBreakdown(
            paid=paid.quantize(DAY_QUANTIZE),
            unpaid=unpaid.quantize(DAY_QUANTIZE),
        )
    def calculate_absent_days(self, employee: 'Employee | None' = None, month: str | None = None) -> Decimal:

        """Unexcused absences: working_days − (present + leave on working days)."""
        if employee is not None and employee.pk != self.employee.pk:

            return PayrollCalculator(employee=employee, month=month or self.month).calculate_absent_days(month=month)
        working = Decimal(self.calculate_working_days(month))
        present = self.calculate_present_days(month=month)
        leave = self.calculate_leave_days(month=month)
        not_started = self._not_started_days(month=month)
        absent = working - present - leave.total - not_started
        return max(absent, Decimal('0.00')).quantize(DAY_QUANTIZE)

    def _not_started_days(self, month: str | None = None) -> Decimal:
        """Today-only rows still before shift+grace — not counted as absent yet."""
        total = Decimal('0.00')
        for day in self._iter_working_days(month):
            if self._display_status(day, month) == 'not_started':
                total += Decimal('1.00')
        return total.quantize(DAY_QUANTIZE)
    def get_active_salary_structure(self) -> 'SalaryStructure | None':

        """Return salary structure effective for this payroll month."""
        if self.salary_structure is not None:

            return self.salary_structure
        from apps.hr.payroll_structure_resolver import (
            compensation_adapter,
            resolve_compensation,
        )

        if self._resolved_compensation is None:
            self._resolved_compensation = resolve_compensation(self.employee, self.month)
        adapter = compensation_adapter(self.employee, self.month)
        if adapter is not None:
            return adapter
        return None

    def get_resolved_compensation(self):
        from apps.hr.payroll_structure_resolver import resolve_compensation

        if self._resolved_compensation is None:
            self._resolved_compensation = resolve_compensation(self.employee, self.month)
        return self._resolved_compensation
    def calculate_per_day_salary(self, *, gross_monthly: Decimal | None = None, working_days: int | None = None) -> Decimal:

        structure = self.get_active_salary_structure()
        if structure is None:

            return Decimal('0.00')
        if gross_monthly is None:

            gross_monthly = self._gross_from_structure(structure)
        if working_days is None:

            working_days = self.calculate_working_days()
        if working_days <= 0:

            return Decimal('0.00')
        return (gross_monthly / Decimal(working_days)).quantize(MONEY_QUANTIZE)

    def calculate_prorated_gross_salary(
        self,
        *,
        gross_monthly: Decimal | None = None,
        month: str | None = None,
    ) -> Decimal:

        structure = self.get_active_salary_structure()
        if structure is None:

            return Decimal('0.00')
        if gross_monthly is None:

            gross_monthly = self._gross_from_structure(structure)
        full_month_working_days = self.calculate_full_month_working_days(month)
        payable_working_days = self.calculate_working_days(month)
        if full_month_working_days <= 0 or payable_working_days <= 0:

            return Decimal('0.00')
        period_start, _ = self.get_payroll_period(month)
        month_start, _ = parse_payroll_month(month or self.month)
        if period_start <= month_start:

            return gross_monthly.quantize(MONEY_QUANTIZE)
        return (
            gross_monthly * Decimal(payable_working_days) / Decimal(full_month_working_days)
        ).quantize(MONEY_QUANTIZE)
    def calculate_lop(self, employee: 'Employee | None' = None, month: str | None = None) -> Decimal:

        """
        Loss of pay: unexcused absences + unpaid leave days, at per-day rate.
        Paid approved leave and holidays do not attract LOP.
        """
        if employee is not None and employee.pk != self.employee.pk:

            return PayrollCalculator(employee=employee, month=month or self.month).calculate_lop(month=month)
        leave = self.calculate_leave_days(month=month)
        absent = self.calculate_absent_days(month=month)
        lop_days = absent + leave.unpaid
        gross = self.calculate_prorated_gross_salary(month=month)
        per_day = self.calculate_per_day_salary(
            gross_monthly=gross,
            working_days=self.calculate_working_days(month),
        )
        return (lop_days * per_day).quantize(MONEY_QUANTIZE)
    def calculate_overtime(self, employee: 'Employee | None' = None, month: str | None = None) -> Decimal:

        """Sum overtime_hours from DailyAttendance across payroll period × overtime_rate."""
        if employee is not None and employee.pk != self.employee.pk:

            return PayrollCalculator(employee=employee, month=month or self.month).calculate_overtime(month=month)
        structure = self.get_active_salary_structure()
        if structure is None:

            return Decimal('0.00')
        total_hours = self._sum_overtime_hours(month)
        return (total_hours * structure.overtime_rate).quantize(MONEY_QUANTIZE)
    def calculate_late_penalty(self, employee: 'Employee | None' = None, month: str | None = None) -> Decimal:

        """
        Late penalty from attendance late_minutes above configured threshold.
        Rate per minute defaults to per_day_salary / 480 when not set in settings.
        """
        if employee is not None and employee.pk != self.employee.pk:

            return PayrollCalculator(employee=employee, month=month or self.month).calculate_late_penalty(month=month)
        threshold = int(getattr(settings, 'PAYROLL_LATE_PENALTY_THRESHOLD_MINUTES', 15))
        configured_rate = getattr(settings, 'PAYROLL_LATE_PENALTY_RATE_PER_MINUTE', None)
        per_day = self.calculate_per_day_salary(working_days=self.calculate_working_days(month))
        rate_per_minute = (
            Decimal(str(configured_rate))
            if configured_rate not in (None, '', 0, '0')
            else (per_day / Decimal('480') if per_day > 0 else Decimal('0.00'))
        )
        penalty = Decimal('0.00')
        for row in self._attendance_rows(month).values():

            metrics = self._resolved_metrics(row.date, month)
            late_minutes = int((metrics or {}).get('late_minutes') or row.late_minutes or 0)
            if late_minutes <= threshold:

                continue
            billable_minutes = late_minutes - threshold
            penalty += Decimal(billable_minutes) * rate_per_minute
        return penalty.quantize(MONEY_QUANTIZE)
    def calculate_final_salary(self, employee: 'Employee | None' = None, month: str | None = None) -> Decimal:

        """
        Net payable:

        basic + allowances + overtime − LOP − fixed deductions − late_penalty
        """
        if employee is not None and employee.pk != self.employee.pk:

            return PayrollCalculator(employee=employee, month=month or self.month).calculate_final_salary(month=month)
        structure = self.get_active_salary_structure()
        if structure is None:

            raise PayrollCalculatorError(
                f'No active salary structure for employee {self.employee_code} in {month or self.month}.',
            )
        gross = self.calculate_prorated_gross_salary(month=month)
        fixed_deductions = self._fixed_deductions_from_structure(structure)
        lop = self.calculate_lop(month=month)
        compliance = self.compute_attendance_compliance(month=month)
        net = (
            gross
            + compliance.overtime_pay
            - lop
            - fixed_deductions
            - compliance.late_penalty
            - compliance.late_conversion_deduction
            - compliance.attendance_compliance_deduction
        )
        return max(net, Decimal('0.00')).quantize(MONEY_QUANTIZE)

    def _collect_late_day_metrics(self, month: str | None = None) -> list[dict]:
        rows: list[dict] = []
        for day in self._iter_working_days(month):
            metrics = self._resolved_metrics(day, month)
            late_minutes = 0
            if metrics is not None:
                late_minutes = int(metrics.get('late_minutes') or 0)
            else:
                row = self._attendance_rows(month).get(day)
                late_minutes = int(row.late_minutes or 0) if row else 0
            status = self._display_status(day, month)
            if status == 'late' or late_minutes > 0:
                rows.append({'date': day, 'late_minutes': late_minutes, 'status': status})
        return rows

    def _collect_ot_by_day(self, month: str | None = None) -> list[tuple[date, Decimal]]:
        ot_rows: list[tuple[date, Decimal]] = []
        for day, row in self._attendance_rows(month).items():
            metrics = self._resolved_metrics(day, month)
            ot = (metrics or {}).get('overtime_hours')
            if ot not in (None, ''):
                hours = Decimal(str(ot))
            elif row.overtime_hours:
                hours = Decimal(str(row.overtime_hours))
            else:
                hours = Decimal('0.00')
            if hours > 0:
                ot_rows.append((day, hours))
        return ot_rows

    def compute_attendance_compliance(self, month: str | None = None) -> ComplianceCalculationResult:
        if self._compliance_result is not None and month in (None, self.month):
            return self._compliance_result
        structure = self.get_active_salary_structure()
        policy = resolve_compliance_policy(structure, self.employee)
        working_days = self.calculate_working_days(month)
        gross = self.calculate_prorated_gross_salary(month=month) if structure else Decimal('0.00')
        per_day = self.calculate_per_day_salary(gross_monthly=gross, working_days=working_days)
        monthly_late_count = int(self.calculate_late_days(month))
        late_metrics = self._collect_late_day_metrics(month)

        legacy_penalty = self.calculate_late_penalty(month=month)
        late_penalty, penalty_rates = calculate_late_penalty_with_policy(
            policy=policy,
            late_day_metrics=late_metrics,
            per_day_salary=per_day,
            legacy_penalty=legacy_penalty,
        )

        late_equiv = calculate_late_equivalent_days(policy, monthly_late_count)
        late_conversion_deduction = (late_equiv * per_day).quantize(MONEY_QUANTIZE)
        esc_warnings, _, escalation_deduction = calculate_escalation(
            policy,
            monthly_late_count,
            per_day,
        )

        legacy_ot = Decimal('0.00')
        if structure is not None:
            legacy_ot = (self._sum_overtime_hours(month) * structure.overtime_rate).quantize(MONEY_QUANTIZE)
        ot_pay, ot_hours, ot_rates = calculate_overtime_pay(
            policy=policy,
            ot_by_day=self._collect_ot_by_day(month),
            holiday_dates=self._holiday_dates_in_period(month),
            is_weekend_fn=is_calendar_weekend,
            gross_monthly=gross,
            working_days=working_days,
            legacy_amount=legacy_ot,
        )

        rates_used = {
            'late_penalty': penalty_rates,
            'overtime': ot_rates,
            'per_day_salary': str(per_day),
            'monthly_late_count': monthly_late_count,
            'late_equivalent_leave_days': str(late_equiv),
        }
        calc_warnings = list(esc_warnings)
        if ot_hours > 0 and ot_pay <= 0 and policy.overtime_enabled:
            if policy.overtime_type == 'fixed_per_hour' and policy.overtime_rate <= 0:
                calc_warnings.append(
                    f'{ot_hours} OT hour(s) recorded from attendance, but this employee\'s salary '
                    'has overtime rate ₹0/hr — no OT pay applied. Set the rate per hour on the '
                    'employee\'s salary structure (Custom Salaries), not in attendance.',
                )
        if policy.late_policy_enabled and legacy_penalty > 0 and late_penalty > legacy_penalty * 3:
            calc_warnings.append(
                f'Structure late penalty ({late_penalty}) is much higher than system default ({legacy_penalty}). '
                'Review attendance compliance settings.',
            )
        elif policy.late_policy_enabled and per_day > 0 and late_penalty > per_day * Decimal('0.5'):
            calc_warnings.append(
                f'Structure late penalty ({late_penalty}) exceeds half a day\'s salary ({per_day}). '
                'Review attendance compliance settings.',
            )

        result = ComplianceCalculationResult(
            monthly_late_count=monthly_late_count,
            late_penalty=late_penalty,
            late_equivalent_leave_days=late_equiv,
            late_conversion_deduction=late_conversion_deduction,
            attendance_compliance_deduction=escalation_deduction,
            overtime_pay=ot_pay,
            overtime_hours=ot_hours,
            effective_ot_rate=policy.overtime_rate,
            warnings=calc_warnings,
            policy=policy,
            rates_used=rates_used,
        )
        if month in (None, self.month):
            self._compliance_result = result
        return result

    def compliance_snapshot_dict(self, compliance: ComplianceCalculationResult) -> dict:
        return {
            'monthly_late_count': compliance.monthly_late_count,
            'late_equivalent_leave_days': str(compliance.late_equivalent_leave_days),
            'late_penalty': str(compliance.late_penalty),
            'late_conversion_deduction': str(compliance.late_conversion_deduction),
            'attendance_compliance_deduction': str(compliance.attendance_compliance_deduction),
            'overtime_pay': str(compliance.overtime_pay),
            'overtime_hours': str(compliance.overtime_hours),
            'effective_ot_rate': str(compliance.effective_ot_rate),
            'warnings': list(compliance.warnings),
        }

    def _department_overtime_rate_for_month(self) -> Decimal | None:
        from apps.hr.payroll_api.department_structure_service import (
            get_active_department_structure,
            resolve_employee_department,
        )

        department = resolve_employee_department(self.employee)
        if department is None:
            return None
        _, month_end = parse_payroll_month(self.month)
        dept_structure = get_active_department_structure(department, as_of=month_end)
        if dept_structure is None:
            return None
        rate = Decimal(str(dept_structure.overtime_rate or '0'))
        return rate if rate > 0 else None

    def build_calculation_snapshot(self, result: PayrollCalculationResult, structure: 'SalaryStructure') -> dict:
        attendance = result.attendance_summary
        compliance = self.compute_attendance_compliance()
        audit = build_compliance_audit(
            policy=compliance.policy or resolve_compliance_policy(structure, self.employee),
            rates_used=compliance.rates_used,
        )
        dept_ot_rate = self._department_overtime_rate_for_month()
        employee_ot_rate = Decimal(str(structure.overtime_rate or '0'))
        snapshot = {
            'per_day_salary': str(result.per_day_salary),
            'lop_amount': str(result.lop_amount),
            'overtime_amount': str(result.overtime_amount),
            'late_penalty': str(result.late_penalty),
            'late_equivalent_leave_days': str(result.late_equivalent_leave_days),
            'late_conversion_deduction': str(result.late_conversion_deduction),
            'attendance_compliance_deduction': str(result.attendance_compliance_deduction),
            'monthly_late_count': result.monthly_late_count,
            'paid_leave_days': str(attendance.paid_leave_days),
            'unpaid_leave_days': str(attendance.unpaid_leave_days),
            'working_days': attendance.working_days_in_month,
            'total_work_hours': str(attendance.total_work_hours),
            'overtime_rate': str(structure.overtime_rate),
            'warnings': result.warnings + result.compliance_warnings,
            'compliance_warnings': result.compliance_warnings,
            'earnings_breakdown': result.earnings_breakdown,
            'deductions_breakdown': result.deductions_breakdown,
            'attendance_summary': self.attendance_summary_dict(attendance),
            'compliance': self.compliance_snapshot_dict(compliance),
            'compliance_audit': audit,
        }
        if dept_ot_rate is not None and employee_ot_rate <= 0:
            snapshot['department_overtime_rate'] = str(dept_ot_rate)
        return snapshot

    # --- Aggregation ---
    def gather_attendance_summary(self) -> AttendancePayrollSummary:

        from apps.hr.attendance_service import get_attendance_summary

        period_start, period_end = self.get_payroll_period()
        canonical = get_attendance_summary(
            self.employee.pk,
            period_start,
            period_end,
            require_finalized_attendance=self.require_finalized_attendance,
        )
        compliance = self.compute_attendance_compliance()
        return AttendancePayrollSummary(
            present_days=canonical.present_days,
            absent_days=canonical.absent_days,
            leave_days=canonical.leave_days,
            paid_leave_days=canonical.paid_leave_days,
            unpaid_leave_days=canonical.unpaid_leave_days,
            holiday_days=canonical.holiday_days,
            half_days=canonical.half_days,
            late_days=canonical.late_days,
            overtime_hours=canonical.overtime_hours,
            total_work_hours=canonical.working_hours,
            late_penalty=compliance.late_penalty,
            monthly_late_count=compliance.monthly_late_count,
            working_days_in_month=canonical.working_days,
            has_attendance_data=bool(self._attendance_rows()),
            period_start=canonical.period_start,
            period_end=canonical.period_end,
        )
    def attendance_summary_dict(self, summary: AttendancePayrollSummary) -> dict:
        working = summary.working_days_in_month
        present = float(summary.present_days or 0)
        attendance_pct = round((present / working) * 100, 1) if working else None

        return {
            'present_days': str(summary.present_days),
            'absent_days': str(summary.absent_days),
            'leave_days': str(summary.leave_days),
            'paid_leave_days': str(summary.paid_leave_days),
            'unpaid_leave_days': str(summary.unpaid_leave_days),
            'holiday_days': str(summary.holiday_days),
            'half_days': str(summary.half_days),
            'late_days': str(summary.late_days),
            'overtime_hours': str(summary.overtime_hours),
            'total_work_hours': str(summary.total_work_hours),
            'working_days': summary.working_days_in_month,
            'attendance_percentage': attendance_pct,
            'period_start': summary.period_start.isoformat() if summary.period_start else None,
            'period_end': summary.period_end.isoformat() if summary.period_end else None,
        }
    def calculate(self) -> PayrollCalculationResult:

        """Run full calculation pipeline and return result (does not save PayrollRun)."""
        structure = self.get_active_salary_structure()
        if structure is None:

            raise PayrollCalculatorError(
                f'No active salary structure for employee {self.employee_code} in {self.month}.',
            )
        compliance = self.compute_attendance_compliance()
        attendance = self.gather_attendance_summary()
        leave = self.calculate_leave_days()
        warnings: list[str] = []
        if not attendance.has_attendance_data:

            warnings.append('No attendance data found for this month.')
        if attendance.working_days_in_month == 0:

            warnings.append('No working days in payroll window (join date or period may be empty).')
        gross_monthly = self._gross_from_structure(structure)
        prorated_gross = self.calculate_prorated_gross_salary(gross_monthly=gross_monthly)
        fixed_deductions = self._fixed_deductions_from_structure(structure)
        per_day = self.calculate_per_day_salary(
            gross_monthly=prorated_gross,
            working_days=attendance.working_days_in_month,
        )
        lop = self.calculate_lop()
        ot_amount = compliance.overtime_pay
        late_penalty = compliance.late_penalty
        late_conversion = compliance.late_conversion_deduction
        compliance_deduction = compliance.attendance_compliance_deduction
        final = self.calculate_final_salary()
        audit = build_compliance_audit(
            policy=compliance.policy or resolve_compliance_policy(structure, self.employee),
            rates_used=compliance.rates_used,
        )
        return PayrollCalculationResult(
            gross_salary=prorated_gross,
            total_deductions=fixed_deductions + lop + late_penalty + late_conversion + compliance_deduction,
            final_salary=final,
            per_day_salary=per_day,
            lop_amount=lop,
            overtime_amount=ot_amount,
            late_penalty=late_penalty,
            late_equivalent_leave_days=compliance.late_equivalent_leave_days,
            late_conversion_deduction=late_conversion,
            attendance_compliance_deduction=compliance_deduction,
            monthly_late_count=compliance.monthly_late_count,
            compliance_warnings=list(compliance.warnings),
            compliance_audit=audit,
            attendance_summary=attendance,
            leave_breakdown=leave,
            earnings_breakdown={
                'basic_salary': str(structure.basic_salary),
                'hra': str(structure.hra),
                'allowances': structure.allowances or {},
                'overtime': str(ot_amount),
            },
            deductions_breakdown={
                'fixed': structure.deductions or {},
                'lop': str(lop),
                'late_penalty': str(late_penalty),
                'late_conversion': str(late_conversion),
                'attendance_compliance': str(compliance_deduction),
            },
            warnings=warnings,
        )
    def build_payroll_run(self, *, calculated_by=None, lock: bool = False) -> 'PayrollRun':

        """Calculate and return a payroll run via reconciliation engine."""
        from apps.hr.payroll_models import PayrollRun
        from apps.hr.payroll_reconciliation_engine import PayrollReconciliationEngine

        self._ensure_no_duplicate_run()
        engine = PayrollReconciliationEngine()
        bundle = engine.load_inputs(self.employee, self.month)
        reconciliation = engine.reconcile(bundle)
        payroll_run = engine.persist_run(
            bundle,
            reconciliation,
            calculated_by=calculated_by,
        )
        if lock:
            payroll_run.status = PayrollRun.STATUS_LOCKED
            payroll_run.locked_at = timezone.now()
            payroll_run.save(update_fields=['status', 'locked_at', 'updated_at'])
        return payroll_run
    def _ensure_no_duplicate_run(self) -> None:

        from apps.hr.payroll_models import PayrollRun
        if PayrollRun.objects.filter(employee=self.employee, month=self.month).exists():

            raise DuplicatePayrollError(
                f'Payroll already exists for {self.employee_code} in {self.month}.',
            )
    def _sum_overtime_hours(self, month: str | None = None) -> Decimal:

        total = Decimal('0.00')
        for row in self._attendance_rows(month).values():

            metrics = self._resolved_metrics(row.date, month)
            ot = (metrics or {}).get('overtime_hours')
            if ot not in (None, ''):

                total += Decimal(str(ot))
            elif row.overtime_hours:

                total += Decimal(str(row.overtime_hours))
        return total.quantize(DAY_QUANTIZE)
    def _sum_work_hours(self, month: str | None = None) -> Decimal:

        total = Decimal('0.00')
        for row in self._attendance_rows(month).values():

            metrics = self._resolved_metrics(row.date, month)
            worked = (metrics or {}).get('worked_hours')
            if worked not in (None, ''):

                total += Decimal(str(worked))
            elif row.total_work_hours:

                total += Decimal(str(row.total_work_hours))
        return total.quantize(DAY_QUANTIZE)
    @staticmethod
    def _gross_from_structure(structure: 'SalaryStructure') -> Decimal:

        allowance_total = sum(
            (Decimal(str(v)) for v in (structure.allowances or {}).values()),
            Decimal('0.00'),
        )
        return (
            structure.basic_salary
            + structure.hra
            + allowance_total
        ).quantize(MONEY_QUANTIZE)
    @staticmethod
    def _fixed_deductions_from_structure(structure: 'SalaryStructure') -> Decimal:

        return sum(
            (Decimal(str(v)) for v in (structure.deductions or {}).values()),
            Decimal('0.00'),
        ).quantize(MONEY_QUANTIZE)
def models_q_effective_to(month_start: date):

    from django.db.models import Q
    return Q(effective_to__isnull=True) | Q(effective_to__gte=month_start)
def generate_monthly_payroll(
    month: str,
    *,
    calculated_by=None,
    employee_queryset=None,
) -> PayrollGenerationResult:

    """
    Generate CALCULATED payroll runs for all active employees in a month.
    Requires attendance month finalization and finalized DailyAttendance rows.
    """
    from apps.hr.models import Employee
    from apps.hr.payroll_approval import PayrollApprovalService
    from apps.hr.payroll_models import PayrollRun
    from apps.hr.payroll_reconciliation_engine import (
        PayrollReconciliationEngine,
        employee_payroll_blocked_reason,
    )

    parse_payroll_month(month)
    month_start, _ = parse_payroll_month(month)
    if month_start > timezone.localdate():
        raise PayrollCalculatorError(f'Cannot generate payroll for future month {month}.')

    employees = employee_queryset
    if employees is None:
        employees = Employee.objects.filter(status='active').order_by('employee_id')

    engine = PayrollReconciliationEngine()
    result = PayrollGenerationResult(month=month)
    for employee in employees:
        existing_run = PayrollRun.objects.filter(employee=employee, month=month).first()
        if existing_run is not None:
            if existing_run.is_editable:
                try:
                    with transaction.atomic():
                        recalculate_payroll_run(existing_run, calculated_by=calculated_by)
                        result.recalculated.append(existing_run)
                except PayrollCalculatorError as exc:
                    result.errors.append({
                        'employee_id': employee.employee_id,
                        'message': str(exc),
                    })
            else:
                result.skipped.append({
                    'employee_id': employee.employee_id,
                    'reason': 'duplicate_locked',
                    'message': (
                        f'Payroll for {month} is {existing_run.status} and cannot be recalculated.',
                    ),
                })
            continue

        if not employee_eligible_for_payroll_month(employee, month):
            result.skipped.append({
                'employee_id': employee.employee_id,
                'reason': 'joined_after_month',
                'message': f'Employee joined after {month}.',
            })
            continue

        blocked = employee_payroll_blocked_reason(employee, month)
        if blocked:
            result.skipped.append({
                'employee_id': employee.employee_id,
                'reason': blocked,
                'message': (
                    'Attendance month is not finalized.'
                    if blocked == 'attendance_not_finalized'
                    else 'Employee is missing a compensation level assignment.'
                    if blocked == 'missing_compensation_assignment'
                    else 'No active salary structure for payroll month.'
                ),
            })
            continue

        try:
            with transaction.atomic():
                bundle = engine.load_inputs(employee, month)
                reconciliation = engine.reconcile(bundle)
                payroll_run = engine.persist_run(
                    bundle,
                    reconciliation,
                    calculated_by=calculated_by,
                )
                PayrollApprovalService().log_create(payroll_run, performed_by=calculated_by)
                log_payroll_compliance_audit(
                    payroll_run,
                    performed_by=calculated_by,
                    notes='Monthly payroll generated',
                )
                result.created.append(payroll_run)
        except DuplicatePayrollError:
            result.skipped.append({
                'employee_id': employee.employee_id,
                'reason': 'duplicate',
                'message': f'Payroll already exists for {month}.',
            })
        except PayrollPeriodError as exc:
            result.skipped.append({
                'employee_id': employee.employee_id,
                'reason': 'joined_after_month',
                'message': str(exc),
            })
        except PayrollCalculatorError as exc:
            result.errors.append({
                'employee_id': employee.employee_id,
                'message': str(exc),
            })
    return result


def log_payroll_compliance_audit(
    payroll_run: 'PayrollRun',
    *,
    performed_by=None,
    notes: str = '',
) -> None:
    from apps.hr.payroll_models import PayrollAuditLog

    snapshot = payroll_run.calculation_snapshot or {}
    PayrollAuditLog.objects.create(
        payroll_run=payroll_run,
        action=PayrollAuditLog.ACTION_CALCULATE,
        performed_by=performed_by,
        old_value={},
        new_value={
            'compliance_audit': snapshot.get('compliance_audit') or {},
            'compliance': snapshot.get('compliance') or {},
        },
        notes=notes or 'Payroll compliance calculation',
    )


def recalculate_payroll_run(payroll_run: 'PayrollRun', *, calculated_by=None) -> 'PayrollRun':
    """Re-run reconciliation for an existing editable payroll run."""
    from apps.hr.payroll_reconciliation_engine import PayrollReconciliationEngine

    if not payroll_run.is_editable:
        raise PayrollCalculatorError(
            f'PayrollRun in {payroll_run.status} status cannot be recalculated.',
        )
    engine = PayrollReconciliationEngine()
    bundle = engine.load_inputs(payroll_run.employee, payroll_run.month)
    reconciliation = engine.reconcile(bundle)
    updated = engine.persist_run(
        bundle,
        reconciliation,
        calculated_by=calculated_by,
        existing_run=payroll_run,
    )
    log_payroll_compliance_audit(updated, performed_by=calculated_by, notes='Payroll recalculated')
    return updated
