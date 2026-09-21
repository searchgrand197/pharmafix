export const PAYROLL_STATUS_BADGE = {
  DRAFT: 'bg-slate-100 text-slate-800',
  CALCULATED: 'bg-indigo-100 text-indigo-900',
  UNDER_REVIEW: 'bg-amber-100 text-amber-900',
  APPROVED: 'bg-blue-100 text-blue-900',
  LOCKED: 'bg-violet-100 text-violet-900',
  PUBLISHED: 'bg-emerald-100 text-emerald-900',
  FINALIZED: 'bg-blue-100 text-blue-900',
};

export const PAYROLL_STATUS_LABEL = {
  DRAFT: 'Draft',
  CALCULATED: 'Calculated',
  UNDER_REVIEW: 'Under review',
  APPROVED: 'Approved',
  LOCKED: 'Locked',
  PUBLISHED: 'Published',
  FINALIZED: 'Finalized',
};

/** Returns workflow progress for a payroll run (0–5 completed steps). */
export function payrollRunWorkflow(run) {
  if (!run) return { completed: 0, steps: [], isComplete: false };

  const steps = [
    { id: 'review', label: 'Review', hint: 'Check attendance & amounts' },
    { id: 'approve', label: 'Approve', hint: 'Confirm payroll is correct' },
    { id: 'lock', label: 'Lock', hint: 'Freeze for payslip generation' },
    { id: 'payslip', label: 'Payslip', hint: 'Generate PDF' },
    { id: 'publish', label: 'Publish', hint: 'Send to employee portal' },
  ];

  let completed = 0;
  if (run.status === 'PUBLISHED') completed = 5;
  else if (run.status === 'LOCKED' && run.has_payslip) completed = 4;
  else if (run.status === 'LOCKED') completed = 3;
  else if (['APPROVED', 'FINALIZED'].includes(run.status)) completed = 2;

  return { completed, steps, isComplete: run.status === 'PUBLISHED' };
}

export function payrollErrorText(error, fallback) {
  const data = error?.response?.data;
  if (!data) return fallback;
  if (typeof data === 'string') return data;
  const messages = [];
  const collect = (value, prefix = '') => {
    if (!value) return;
    if (typeof value === 'string') {
      messages.push(prefix ? `${prefix}: ${value}` : value);
      return;
    }
    if (Array.isArray(value)) {
      value.forEach((item) => collect(item, prefix));
      return;
    }
    if (typeof value === 'object') {
      Object.entries(value).forEach(([key, item]) => collect(item, key));
    }
  };
  collect(data.detail || data.error || data);
  if (data.validation_errors?.length) {
    messages.push(...data.validation_errors);
  }
  return messages.length ? messages.join(' · ') : fallback;
}

export function formatCurrency(value) {
  if (value == null || value === '') return '—';
  const num = Number(value);
  if (!Number.isFinite(num)) return String(value);
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 2,
  }).format(num);
}

export function formatDecimal(value, digits = 1) {
  if (value == null || value === '') return '—';
  const num = Number(value);
  if (!Number.isFinite(num)) return String(value);
  return num.toFixed(digits);
}

export function normalizePayrollList(data) {
  if (Array.isArray(data)) return data;
  if (data?.results) return data.results;
  return [];
}

export function objectToRows(obj) {
  if (!obj || typeof obj !== 'object') return [{ key: '', value: '' }];
  const entries = Object.entries(obj);
  if (!entries.length) return [{ key: '', value: '' }];
  return entries.map(([key, value]) => ({ key, value: String(value) }));
}

export function rowsToObject(rows) {
  const out = {};
  rows.forEach(({ key, value }) => {
    const k = (key || '').trim();
    if (!k) return;
    out[k] = value === '' ? '0' : value;
  });
  return out;
}

export function monthLabel(month) {
  if (!month || month.length < 7) return month || '';
  const [year, mon] = month.split('-').map(Number);
  return new Date(year, mon - 1).toLocaleString('default', { month: 'long', year: 'numeric' });
}

/** Flatten payroll earnings/deductions JSON for table display (expands nested allowances/fixed). */
export function flattenPayrollBreakdown(data) {
  if (!data || typeof data !== 'object') return [];
  const rows = [];
  const push = (key, value) => {
    if (value == null || value === '') return;
    if (typeof value === 'object') return;
    rows.push([key, value]);
  };

  Object.entries(data).forEach(([key, value]) => {
    if (key === 'allowances' && value && typeof value === 'object') {
      Object.entries(value).forEach(([allowKey, allowVal]) => {
        push(allowKey.replace(/_/g, ' '), allowVal);
      });
      return;
    }
    if (key === 'fixed' && value && typeof value === 'object') {
      Object.entries(value).forEach(([dedKey, dedVal]) => {
        push(dedKey.replace(/_/g, ' '), dedVal);
      });
      return;
    }
    push(key.replace(/_/g, ' '), value);
  });
  return rows;
}

/** Suggested effective date for a new salary structure version (day after latest or tomorrow). */
export function suggestNextEffectiveFrom(existingStructures = [], entityId = '', entityField = 'department') {
  const today = new Date();
  today.setHours(12, 0, 0, 0);
  const iso = (d) => d.toISOString().slice(0, 10);
  const relevant = (existingStructures || []).filter(
    (row) => !entityId || String(row[entityField]) === String(entityId),
  );
  if (!relevant.length) return iso(today);
  const latest = relevant.reduce((max, row) => {
    const d = row.effective_from?.slice?.(0, 10) || row.effective_from;
    return !max || (d && d > max) ? d : max;
  }, '');
  if (!latest) return iso(today);
  const next = new Date(`${latest}T12:00:00`);
  next.setDate(next.getDate() + 1);
  const nextIso = iso(next);
  return nextIso >= iso(today) ? nextIso : iso(today);
}

const LATE_EXAMPLE_MINUTES = 52;

export function computeLatePenaltyPreview(form, { perDaySalary = 0 } = {}) {
  if (!form?.late_policy_enabled) {
    return { enabled: false, amount: 0, explanation: 'Late policy off — system default penalty applies at payroll.' };
  }
  const threshold = Number(form.late_penalty_threshold_minutes) || 15;
  const value = Number(form.late_penalty_value) || 0;
  const type = form.late_penalty_type || 'per_minute';
  const lateMinutes = LATE_EXAMPLE_MINUTES;
  let amount = 0;
  let explanation = '';

  if (type === 'fixed_per_late_day') {
    amount = value;
    explanation = `1 late day → ${formatCurrency(amount)} fixed deduction`;
  } else if (type === 'percentage_daily_salary') {
    amount = (Number(perDaySalary) || 0) * (value / 100);
    explanation = `${value}% of daily pay (${formatCurrency(perDaySalary)}) per late day`;
  } else {
    const billable = Math.max(0, lateMinutes - threshold);
    amount = billable * value;
    explanation = `${lateMinutes} min late − ${threshold} min free = ${billable} min × ${formatCurrency(value)}/min`;
  }

  return {
    enabled: true,
    amount,
    explanation,
    exampleMinutes: lateMinutes,
  };
}

export function computeOvertimePreview(form) {
  const hours = 12;
  const rate = Number(form.overtime_rate) || 0;
  const enabled = form.overtime_enabled !== false;
  const weekendMult = Number(form.weekend_ot_multiplier) || 1;
  const holidayMult = Number(form.holiday_ot_multiplier) || 1;

  if (!enabled) {
    return { enabled: false, amount: 0, warning: null, examples: [] };
  }

  const weekdayPay = hours * rate;
  const warning = rate <= 0
    ? 'Overtime rate is ₹0 — employees with OT hours will not receive extra pay.'
    : null;

  return {
    enabled: true,
    amount: weekdayPay,
    warning,
    examples: [
      { label: `${hours} weekday OT hrs`, amount: weekdayPay },
      { label: `5 holiday OT hrs × ${holidayMult}×`, amount: 5 * rate * holidayMult },
      { label: `8 weekend OT hrs × ${weekendMult}×`, amount: 8 * rate * weekendMult },
    ],
  };
}

export const COMPLIANCE_PRESETS = {
  standard: {
    label: 'Standard (recommended)',
    description: 'System default late rules; OT ₹100/hr',
    values: {
      late_policy_enabled: false,
      late_penalty_threshold_minutes: 15,
      late_penalty_type: 'per_minute',
      late_penalty_value: '0',
      late_conversion_enabled: false,
      late_count_for_half_day: '',
      late_count_for_full_day: '',
      warning_after_n_lates: '',
      half_day_after_n_lates: '',
      full_day_after_n_lates: '',
      overtime_enabled: true,
      overtime_type: 'fixed_per_hour',
      overtime_rate: '100',
      weekend_ot_multiplier: '1',
      holiday_ot_multiplier: '1',
    },
  },
  strict: {
    label: 'Strict late policy',
    description: '₹2/min after 15 min; 3 lates = half day',
    values: {
      late_policy_enabled: true,
      grace_minutes: '',
      late_penalty_threshold_minutes: 15,
      late_penalty_type: 'per_minute',
      late_penalty_value: '2',
      late_conversion_enabled: true,
      late_count_for_half_day: '3',
      late_count_for_full_day: '6',
      warning_after_n_lates: '2',
      half_day_after_n_lates: '',
      full_day_after_n_lates: '',
      overtime_enabled: true,
      overtime_type: 'fixed_per_hour',
      overtime_rate: '100',
      weekend_ot_multiplier: '1',
      holiday_ot_multiplier: '1',
    },
  },
  no_late: {
    label: 'No late penalty',
    description: 'No custom late deductions; OT enabled',
    values: {
      late_policy_enabled: false,
      late_conversion_enabled: false,
      overtime_enabled: true,
      overtime_type: 'fixed_per_hour',
      overtime_rate: '100',
      weekend_ot_multiplier: '1',
      holiday_ot_multiplier: '1',
    },
  },
};

export function buildComplianceReviewSummary(form, { perDaySalary = 0 } = {}) {
  const late = computeLatePenaltyPreview(form, { perDaySalary });
  const ot = computeOvertimePreview(form);
  const lines = [];
  if (form.late_policy_enabled) {
    lines.push(`Late: ${late.explanation} → about ${formatCurrency(late.amount)}`);
  } else {
    lines.push('Late: system default (no custom policy)');
  }
  if (ot.enabled) {
    lines.push(`OT: ${formatCurrency(form.overtime_rate || 0)}/hr — hours counted from attendance automatically`);
    if (ot.warning) lines.push(`⚠ ${ot.warning}`);
  } else {
    lines.push('OT: disabled');
  }
  return lines;
}

export function formatCompliancePolicySummary(snapshot = {}, attendance = {}) {
  const compliance = snapshot.compliance || {};
  const otHours = attendance.overtime_hours ?? snapshot.overtime_hours ?? '0';
  const otPay = compliance.overtime_pay ?? snapshot.overtime_amount ?? '0';
  const otRate = snapshot.overtime_rate ?? compliance.effective_ot_rate ?? '0';
  const latePenalty = compliance.late_penalty ?? snapshot.late_penalty ?? '0';
  const lateDays = attendance.late_days ?? compliance.monthly_late_count ?? '0';
  const lines = [];

  if (Number(otHours) > 0) {
    if (Number(otPay) > 0) {
      lines.push(`${otHours} OT hours from attendance × ${formatCurrency(otRate)}/hr = ${formatCurrency(otPay)}`);
    } else {
      const deptRate = snapshot.department_overtime_rate;
      if (deptRate && Number(deptRate) > 0) {
        lines.push(
          `${otHours} OT hours recorded from attendance, but this employee's salary has OT rate ${formatCurrency(otRate)}/hr (department template: ${formatCurrency(deptRate)}/hr)`,
        );
      } else {
        lines.push(
          `${otHours} OT hours recorded from attendance, but OT pay rate on this employee's salary is ${formatCurrency(otRate)}/hr`,
        );
      }
    }
  }
  if (Number(lateDays) > 0 || Number(latePenalty) > 0) {
    lines.push(`${lateDays} late day(s) → ${formatCurrency(latePenalty)} penalty`);
  }
  return lines;
}

function parseSalaryAmount(value, label, { required = false, min = 0 } = {}) {
  const raw = String(value ?? '').trim();
  if (!raw) {
    return required ? `${label} is required` : null;
  }
  const num = Number(raw);
  if (!Number.isFinite(num)) return `${label} must be a valid number`;
  if (num < min) {
    return min > 0 ? `${label} must be greater than zero` : `${label} cannot be negative`;
  }
  return null;
}

export function validateCompensationLevelField(field, form) {
  switch (field) {
    case 'basic':
      return parseSalaryAmount(form.basic, 'Basic salary', { required: true, min: 0.01 });
    case 'hra':
      return parseSalaryAmount(form.hra, 'HRA');
    case 'medical':
      return parseSalaryAmount(form.medical, 'Medical allowance');
    case 'special_allowance':
      return parseSalaryAmount(form.special_allowance, 'Special allowance');
    case 'overtime_rate':
      if (form.overtime_enabled === false) return null;
      return parseSalaryAmount(form.overtime_rate, 'Overtime rate', { min: 0.01 });
    case 'effective_from':
      if (!form.effective_from) return 'Effective from date is required';
      return null;
    case 'code':
      if (!String(form.code || '').trim()) return 'Level code is required';
      if (!/^[A-Z0-9_]+$/i.test(String(form.code).trim())) {
        return 'Code may only contain letters, numbers, and underscores';
      }
      return null;
    case 'name':
      if (!String(form.name || '').trim()) return 'Level name is required';
      return null;
    case 'rank': {
      const raw = String(form.rank ?? '').trim();
      if (!raw && raw !== '0') return 'Rank is required';
      const num = Number(raw);
      if (!Number.isFinite(num) || num < 0 || !Number.isInteger(num)) {
        return 'Rank must be a whole number 0 or greater';
      }
      return null;
    }
    default:
      return null;
  }
}

export function validateCompensationLevelForm(form) {
  const fields = ['code', 'name', 'rank', 'basic', 'hra', 'medical', 'special_allowance', 'overtime_rate', 'effective_from'];
  const errors = {};
  fields.forEach((field) => {
    const message = validateCompensationLevelField(field, form);
    if (message) errors[field] = message;
  });
  if (form.late_policy_enabled && form.late_penalty_type === 'per_minute') {
    const value = Number(form.late_penalty_value);
    if (Number.isFinite(value) && value > 50) {
      errors.late_penalty_value = 'Per-minute late penalty above ₹50 is unusually high';
    }
  }
  return errors;
}

/** Suggest next rank for a new compensation level (max existing rank + 1). */
export function suggestNextLevelRank(levels = []) {
  if (!levels.length) return 0;
  const maxRank = levels.reduce((max, row) => Math.max(max, Number(row.rank) || 0), 0);
  return maxRank + 1;
}

/** Suggest compensation level code from designation and rank, e.g. NURSE_L1. */
export function suggestLevelCode(designation, rank = 0) {
  const base = String(designation?.code || designation?.name || 'LEVEL')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return `${base || 'LEVEL'}_L${rank}`;
}

/** Keep only the latest active version per code. */
export function groupLatestLevelsPerCode(levels = []) {
  const byCode = new Map();
  (levels || []).forEach((row) => {
    const existing = byCode.get(row.code);
    if (!existing || String(row.effective_from) > String(existing.effective_from)) {
      byCode.set(row.code, row);
    }
  });
  return Array.from(byCode.values()).sort(
    (a, b) => (Number(a.rank) || 0) - (Number(b.rank) || 0) || String(a.code).localeCompare(String(b.code)),
  );
}

/** Gross monthly pay from a compensation level row. */
export function compensationLevelGross(row) {
  if (!row) return 0;
  return (
    (Number(row.basic) || 0)
    + (Number(row.hra) || 0)
    + (Number(row.medical) || 0)
    + (Number(row.special_allowance) || 0)
  );
}

export function mapPayrollFieldErrors(data) {
  if (!data || typeof data !== 'object') return {};
  const mapped = {};
  Object.entries(data).forEach(([key, val]) => {
    if (key === 'detail' || key === 'error' || key === 'code') return;
    mapped[key] = Array.isArray(val) ? val.join(', ') : String(val);
  });
  return mapped;
}

export const PAYROLL_SKIP_LABELS = {
  missing_salary_structure: 'No salary set up',
  missing_compensation_assignment: 'Compensation level not assigned',
  missing_salary_assignment: 'Compensation level not assigned',
  joined_after_month: 'Joined after this month',
  duplicate_locked: 'Already locked or published',
  attendance_not_finalized: 'Attendance not closed',
  duplicate: 'Payroll already exists',
};

export const PAYROLL_SKIP_FIX_LINKS = {
  missing_salary_structure: '/hr/payroll/compensation-levels',
  missing_compensation_assignment: '/hr/payroll/compensation-levels',
  missing_salary_assignment: '/hr/payroll/compensation-levels',
  attendance_not_finalized: '/hr/operations/attendance',
};

export function payrollSkipLabel(reason, message) {
  if (reason && PAYROLL_SKIP_LABELS[reason]) return PAYROLL_SKIP_LABELS[reason];
  if (message) return message;
  return reason || 'Could not include in payroll';
}

export function payrollSkipFixLink(reason) {
  return PAYROLL_SKIP_FIX_LINKS[reason] || null;
}

/** Merge API skipped + errors into a single list for the payroll runs page. */
export function normalizePayrollRunIssues(skipped = [], errors = []) {
  const issues = [];
  (skipped || []).forEach((row, index) => {
    issues.push({
      id: `skipped-${row.employee_id || index}`,
      employeeId: row.employee_id || '—',
      reason: row.reason || '',
      label: payrollSkipLabel(row.reason, row.message),
      fixLink: payrollSkipFixLink(row.reason),
    });
  });
  (errors || []).forEach((row, index) => {
    const reason = row.reason || 'error';
    issues.push({
      id: `error-${row.employee_id || index}`,
      employeeId: row.employee_id || '—',
      reason,
      label: payrollSkipLabel(reason, row.message),
      fixLink: payrollSkipFixLink(reason),
    });
  });
  return issues;
}
