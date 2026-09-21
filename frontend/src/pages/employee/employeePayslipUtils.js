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

export function monthLabel(month) {
  if (!month || month.length < 7) return month || '';
  const [year, mon] = month.split('-').map(Number);
  return new Date(year, mon - 1).toLocaleString('default', { month: 'long', year: 'numeric' });
}

export function normalizePayslipList(data) {
  if (Array.isArray(data)) return data;
  if (data?.results) return data.results;
  return [];
}

/** Format attendance % from API value or present/working day counts. */
export function formatAttendancePercentage(attendance) {
  if (!attendance) return '—';
  const raw = attendance.attendance_percentage;
  if (raw != null && raw !== '' && raw !== '—') {
    const s = String(raw);
    return s.includes('%') ? s : `${s}%`;
  }
  const working = Number(attendance.working_days);
  const present = Number(attendance.present_days);
  if (Number.isFinite(working) && working > 0 && Number.isFinite(present)) {
    const pct = Math.round((present / working) * 1000) / 10;
    return `${pct}%`;
  }
  return '—';
}

export function payslipErrorText(error, fallback) {
  const data = error?.response?.data;
  if (!data) return fallback;
  if (typeof data === 'string') return data;
  return data.error || data.detail || fallback;
}

export function splitEarnings(earnings = {}) {
  const basic = earnings.basic_salary;
  const hra = earnings.hra;
  const overtime = earnings.overtime;
  const allowanceEntries = [];
  const nested = earnings.allowances;
  if (nested && typeof nested === 'object') {
    Object.entries(nested).forEach(([key, value]) => allowanceEntries.push({ key, value }));
  }
  Object.entries(earnings).forEach(([key, value]) => {
    if (['basic_salary', 'hra', 'overtime', 'allowances'].includes(key)) return;
    if (typeof value === 'object') return;
    allowanceEntries.push({ key, value });
  });
  return { basic, hra, overtime, allowanceEntries };
}

export function splitDeductions(deductions = {}) {
  const entries = [];
  const fixed = deductions.fixed;
  if (fixed && typeof fixed === 'object') {
    Object.entries(fixed).forEach(([key, value]) => entries.push({ key, value }));
  }
  Object.entries(deductions).forEach(([key, value]) => {
    if (key === 'fixed' || typeof value === 'object') return;
    entries.push({ key, value });
  });
  return entries;
}
