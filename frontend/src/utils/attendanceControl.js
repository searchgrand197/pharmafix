/**
 * Helpers for HR Attendance Control Console (biometric simulation).
 */

import { toAttendanceTimeInputValue } from './timeDisplay';

export const MARK_STATUSES = [
  { value: '', label: '— Not marked —' },
  { value: 'PRESENT', label: 'Present' },
  { value: 'ABSENT', label: 'Absent' },
  { value: 'LATE', label: 'Late' },
  { value: 'HALF_DAY', label: 'Half day' },
];

export const PUNCH_STATUSES = new Set(['PRESENT', 'LATE', 'HALF_DAY']);

/** Map stored daily status to bulk-mark dropdown value. */
export function existingToMarkStatus(status) {
  if (!status) return '';
  const map = {
    present: 'PRESENT',
    late: 'LATE',
    half_day: 'HALF_DAY',
    absent: 'ABSENT',
    overtime: 'PRESENT',
  };
  return map[status] || '';
}

/** @param {string|null|undefined} t */
export function toTimeInputValue(t) {
  return toAttendanceTimeInputValue(t);
}

/** @param {string} hhmm */
export function compareTimes(hhmmA, hhmmB) {
  if (!hhmmA || !hhmmB) return 0;
  const [ah, am] = hhmmA.split(':').map(Number);
  const [bh, bm] = hhmmB.split(':').map(Number);
  return ah * 60 + am - (bh * 60 + bm);
}

/**
 * @param {object} employee
 * @param {object|null} shift - full shift from /hr/shifts/
 * @param {string} status
 */
export function getDefaultCheckTimes(employee, shift, status) {
  if (!PUNCH_STATUSES.has(status)) {
    return { checkIn: '', checkOut: '' };
  }

  const start = toTimeInputValue(shift?.start_time || employee?.shift_start_time);
  const end = toTimeInputValue(shift?.end_time || employee?.shift_end_time);
  const grace = Number(shift?.grace_minutes ?? 0);
  const halfHours = Number(shift?.half_day_hours ?? 4);

  if (start && end) {
    if (status === 'LATE') {
      const [h, m] = start.split(':').map(Number);
      const total = h * 60 + m + grace + 1;
      const lateIn = `${String(Math.floor(total / 60) % 24).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
      return { checkIn: lateIn, checkOut: end };
    }
    if (status === 'HALF_DAY') {
      const [h, m] = start.split(':').map(Number);
      const total = h * 60 + m + Math.round(halfHours * 60);
      const halfOut = `${String(Math.floor(total / 60) % 24).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
      return { checkIn: start, checkOut: halfOut };
    }
    return { checkIn: start, checkOut: end };
  }

  if (status === 'HALF_DAY') return { checkIn: '09:00', checkOut: '13:00' };
  if (status === 'LATE') return { checkIn: '09:15', checkOut: '18:00' };
  return { checkIn: '09:00', checkOut: '18:00' };
}

/** @param {string} dateStr YYYY-MM-DD */
export function isWeekendDate(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const day = new Date(y, m - 1, d).getDay();
  return day === 0 || day === 6;
}

/** @param {string} dateStr */
export function isFutureDate(dateStr) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const [y, m, d] = dateStr.split('-').map(Number);
  const picked = new Date(y, m - 1, d);
  picked.setHours(0, 0, 0, 0);
  return picked > today;
}

/**
 * @param {object} row
 * @param {string} selectedDate
 */
export function validateAttendanceRow(row, selectedDate) {
  if (!row.markStatus) return null;
  if (row.employee.status !== 'active') {
    return 'Employee is not active.';
  }
  if (row.locked) {
    return 'Attendance is locked or manually corrected for this date.';
  }
  if (isFutureDate(selectedDate)) {
    return 'Future dates are not allowed.';
  }
  if (PUNCH_STATUSES.has(row.markStatus)) {
    if (!row.checkIn || !row.checkOut) {
      return 'Check-in and check-out times are required.';
    }
    if (compareTimes(row.checkOut, row.checkIn) <= 0) {
      return 'Check-out must be after check-in.';
    }
    if (selectedDate === formatToday()) {
      const now = new Date();
      const nowHm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
      if (compareTimes(row.checkIn, nowHm) > 0 || compareTimes(row.checkOut, nowHm) > 0) {
        return 'Cannot use future times for today.';
      }
    }
  }
  return null;
}

export function formatToday() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function statusLabel(status) {
  if (!status) return '—';
  return String(status).replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Badge label/class for dashboard & calendar rows.
 * Shows Late when late_minutes > 0 even if stored status was half_day (pre-fix rows).
 * @param {object} row
 */
/** @param {object|null|undefined} policy from summary API */
export function lateMinutesCaption(policy) {
  if (!policy) return '';
  return policy.late_minutes_basis === 'after_grace'
    ? 'after grace'
    : 'after shift start';
}

function formatShiftStartLabel(shiftStart) {
  if (!shiftStart) return '';
  const parts = String(shiftStart).slice(0, 8).split(':').map(Number);
  const [h, m] = parts;
  if (Number.isNaN(h) || Number.isNaN(m)) return '';
  const d = new Date();
  d.setHours(h, m, 0, 0);
  return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

function earlyArrivalDisplay(row) {
  if (!row?.is_early_arrival || row.attendance_status !== 'in_progress') {
    return null;
  }
  const startLabel = formatShiftStartLabel(row.shift_start_time);
  const suffix = startLabel ? ` — shift starts ${startLabel}` : '';
  return {
    label: `Early arrival${suffix}`,
    shortLabel: 'Early',
    classKey: 'early_arrival',
    status: 'early_arrival',
  };
}

export function resolveDisplayAttendanceStatus(row, policy = null) {
  if (!row) return { label: '—', shortLabel: '—', classKey: 'default', status: '' };
  if (row.is_on_leave) {
    const leave = row.leave_type_name ? `On Leave — ${row.leave_type_name}` : 'On Leave';
    return { label: leave, shortLabel: 'On Leave', classKey: 'leave', status: 'leave' };
  }
  const lateMin = Number(row.late_minutes || 0);
  const lateSuffix = lateMin > 0 ? ` (${lateMin} min ${lateMinutesCaption(policy)})` : '';
  const stored = row.attendance_status || '';

  if (stored === 'not_started') {
    return { label: 'Shift Not Started', shortLabel: 'Not Started', classKey: 'not_started', status: 'not_started' };
  }
  if (stored === 'in_progress') {
    const early = earlyArrivalDisplay(row);
    if (early) return early;
    const label = lateMin > 0 ? `In Progress · Late${lateSuffix}` : 'In Progress';
    return { label, shortLabel: 'In Progress', classKey: 'in_progress', status: 'in_progress' };
  }
  if (stored === 'missing_checkout' || row.incomplete_checkout) {
    const label = lateMin > 0 ? `Missing Checkout · Late${lateSuffix}` : 'Missing Checkout';
    return { label, shortLabel: 'Missing Checkout', classKey: 'missing_checkout', status: 'missing_checkout' };
  }
  if (row.incomplete_punches || row.requires_hr_review || stored === 'incomplete') {
    const label = lateMin > 0 ? `Incomplete · Late${lateSuffix}` : 'Incomplete';
    return { label, shortLabel: 'Incomplete', classKey: 'incomplete', status: 'incomplete' };
  }
  if (stored === 'late' || lateMin > 0) {
    const label = lateMin > 0 ? `Late${lateSuffix}` : 'Late';
    return { label, shortLabel: 'Late', classKey: 'late', status: 'late' };
  }
  const label = statusLabel(stored);
  return { label, shortLabel: label, classKey: stored || 'default', status: stored };
}

export function existingStatusClass(status) {
  switch (status) {
    case 'present':
      return 'bg-emerald-50 text-emerald-800 ring-emerald-200';
    case 'late':
      return 'bg-orange-50 text-orange-800 ring-orange-200';
    case 'half_day':
      return 'bg-amber-50 text-amber-900 ring-amber-200';
    case 'absent':
      return 'bg-slate-100 text-slate-700 ring-slate-200';
    case 'leave':
      return 'bg-sky-50 text-sky-800 ring-sky-200';
    case 'incomplete':
      return 'bg-red-50 text-red-800 ring-red-200';
    case 'in_progress':
      return 'bg-sky-50 text-sky-800 ring-sky-200';
    case 'not_started':
      return 'bg-slate-50 text-slate-600 ring-slate-200';
    case 'early_arrival':
      return 'bg-cyan-50 text-cyan-900 ring-cyan-200';
    case 'missing_checkout':
      return 'bg-red-50 text-red-800 ring-red-200';
    default:
      return 'bg-violet-50 text-violet-900 ring-violet-200';
  }
}

export function parseApiMarkError(error) {
  const data = error?.response?.data;
  if (!data) return error?.message || 'Request failed';
  if (data.message) return data.message;
  if (data.code) return data.message || data.code;
  if (typeof data === 'string') return data;
  if (data.errors?.detail) return data.errors.detail;
  return 'Request failed';
}
