export function errorText(error, fallback = 'Something went wrong') {
  const data = error?.response?.data;
  if (!data) return fallback;
  if (typeof data === 'string') return data;
  if (data.error || data.detail) return data.error || data.detail;
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
  collect(data);
  return messages.length ? messages.join(' · ') : fallback;
}

export function normalizeList(data) {
  if (!data) return [];
  if (Array.isArray(data)) return data;
  return data.results || [];
}

export function formatLeaveDays(value) {
  if (value == null || value === '') return '0';
  const n = Number(value);
  if (!Number.isFinite(n)) return '0';
  return Number.isInteger(n) ? String(n) : n.toFixed(1).replace(/\.0$/, '');
}

export function groupBalancesByEmployee(balances) {
  const map = new Map();
  for (const row of balances) {
    const key = row.employee;
    if (!map.has(key)) {
      map.set(key, {
        employeeId: key,
        name: row.employee_name,
        employeeCode: row.employee_id_display,
        rows: [],
      });
    }
    map.get(key).rows.push(row);
  }
  return [...map.values()].sort((a, b) => (a.name || '').localeCompare(b.name || ''));
}

export function leaveUsagePercent(row) {
  if (row.is_unlimited) return 0;
  const total = Number(row.total_days) || 0;
  const used = Number(row.used_days) || 0;
  if (total <= 0) return used > 0 ? 100 : 0;
  return Math.min(100, (used / total) * 100);
}

export const ASSIGNMENT_OPTIONS = [
  { value: 'DEPARTMENT', label: 'By departments' },
  { value: 'DESIGNATION', label: 'By designation' },
];

export const STATUS_BADGE = {
  PENDING: 'bg-amber-100 text-amber-800',
  APPROVED: 'bg-green-100 text-green-800',
  REJECTED: 'bg-red-100 text-red-800',
  CANCELLED: 'bg-slate-100 text-slate-700',
};

/** Mirrors backend leave_type_allows_unpaid() — unpaid/LWP types hide paid controls in the UI. */
export function isUnpaidLeaveType({ name, code, is_paid }) {
  if (is_paid === false) return true;
  const n = (name || '').trim().toLowerCase();
  const c = (code || '').trim().toLowerCase();
  return c === 'lwp' || ['lwp', 'leave without pay', 'unpaid leave', 'unpaid'].includes(n);
}

/** LWP-style types — paid/unpaid toggle is hidden (read-only unpaid strip instead). */
export function isLockedUnpaidLeaveType({ name, code }) {
  const n = (name || '').trim().toLowerCase();
  const c = (code || '').trim().toLowerCase();
  return c === 'lwp' || ['lwp', 'leave without pay', 'unpaid leave', 'unpaid'].includes(n);
}
