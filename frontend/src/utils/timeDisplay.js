/**
 * Attendance display + API helpers — always use hospital timezone (Django TIME_ZONE).
 * DB stores UTC; wall-clock punches use punch_date + punch_time (not browser toISOString).
 */

/** Must match Django TIME_ZONE / .env (default Asia/Kolkata). */
export const ATTENDANCE_TIME_ZONE = 'Asia/Kolkata';

/** @param {Date} [d] @param {string} [timeZone] */
export function attendanceDateParts(d = new Date(), timeZone = ATTENDANCE_TIME_ZONE) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(d);
  return {
    year: parts.find((p) => p.type === 'year')?.value,
    month: parts.find((p) => p.type === 'month')?.value,
    day: parts.find((p) => p.type === 'day')?.value,
  };
}

/** Today's date (YYYY-MM-DD) in hospital timezone — matches Django timezone.localdate(). */
export function todayIsoForAttendance(d = new Date(), timeZone = ATTENDANCE_TIME_ZONE) {
  const { year, month, day } = attendanceDateParts(d, timeZone);
  return `${year}-${month}-${day}`;
}

/** Current month key (YYYY-MM) in hospital timezone. */
export function monthKeyForAttendance(d = new Date(), timeZone = ATTENDANCE_TIME_ZONE) {
  const { year, month } = attendanceDateParts(d, timeZone);
  return `${year}-${month}`;
}

const timeFmt = {
  hour: '2-digit',
  minute: '2-digit',
  hour12: true,
  timeZone: ATTENDANCE_TIME_ZONE,
};

const dateTimeFmt = {
  ...timeFmt,
  year: 'numeric',
  month: 'short',
  day: 'numeric',
};

/** @param {string|Date|null|undefined} value */
export function formatAttendanceTime(value, timeZone = ATTENDANCE_TIME_ZONE) {
  if (!value) return '—';
  try {
    const d = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(d.getTime())) return '—';
    return d.toLocaleTimeString('en-IN', { ...timeFmt, timeZone });
  } catch {
    return '—';
  }
}

/** @param {string|Date|null|undefined} value */
export function formatAttendanceDateTime(value, timeZone = ATTENDANCE_TIME_ZONE) {
  if (!value) return '—';
  try {
    const d = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(d.getTime())) return '—';
    return d.toLocaleString('en-IN', { ...dateTimeFmt, timeZone });
  } catch {
    return '—';
  }
}

/** @param {string|Date|null|undefined} value */
export function formatSystemDateTime(value) {
  if (!value) return '—';
  try {
    const d = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(d.getTime())) return '—';
    return d.toLocaleString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    });
  } catch {
    return '—';
  }
}

/**
 * Wall clock from the browser/OS (matches Windows taskbar).
 * Use for biometric simulator taps so punch time = what HR sees on their PC.
 */
export function nowBrowserDatetimeLocal() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}`;
}

export function formatBrowserClock(date = new Date()) {
  return date.toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });
}

/** `datetime-local` value for now in hospital timezone (YYYY-MM-DDTHH:mm). */
export function nowDatetimeLocalForAttendance() {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: ATTENDANCE_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date());
  const y = parts.find((p) => p.type === 'year')?.value;
  const mo = parts.find((p) => p.type === 'month')?.value;
  const d = parts.find((p) => p.type === 'day')?.value;
  const h = parts.find((p) => p.type === 'hour')?.value;
  const mi = parts.find((p) => p.type === 'minute')?.value;
  return `${y}-${mo}-${d}T${h}:${mi}`;
}

/**
 * datetime-local value is wall clock with no TZ — send as attendance-local date + time.
 * @param {string} datetimeLocal e.g. "2026-06-04T11:53"
 */
export function datetimeLocalToPunchPayload(datetimeLocal) {
  if (!datetimeLocal || !datetimeLocal.includes('T')) return null;
  const [punch_date, timePart] = datetimeLocal.split('T');
  const punch_time = (timePart || '').slice(0, 5);
  if (!punch_date || !punch_time) return null;
  return { punch_date, punch_time };
}

/** @param {string|null|undefined} t ISO or HH:MM */
export function toAttendanceTimeInputValue(t) {
  if (!t) return '';
  const s = String(t);
  if (s.includes('T')) {
    try {
      const d = new Date(s);
      const parts = new Intl.DateTimeFormat('en-GB', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
        timeZone: ATTENDANCE_TIME_ZONE,
      }).formatToParts(d);
      const hour = parts.find((p) => p.type === 'hour')?.value ?? '00';
      const minute = parts.find((p) => p.type === 'minute')?.value ?? '00';
      return `${hour}:${minute}`;
    } catch {
      return s.slice(11, 16);
    }
  }
  return s.slice(0, 5);
}

/** @param {string|null|undefined} start @param {string|null|undefined} end */
export function formatShiftRange12h(start, end) {
  if (!start && !end) return '—';
  if (!start) return formatTime12h(end);
  if (!end) return formatTime12h(start);
  return `${formatTime12h(start)} – ${formatTime12h(end)}`;
}

/** @param {string|null|undefined} value 24h HH:MM */
export function time24ToParts12(value) {
  if (!value) return { hour12: '', minute: '', period: '' };
  const match = String(value).trim().match(/^(\d{1,2}):(\d{2})/);
  if (!match) return { hour12: '', minute: '', period: '' };
  const h = Number(match[1]);
  const minute = match[2];
  return {
    hour12: String(h % 12 || 12),
    minute,
    period: h >= 12 ? 'PM' : 'AM',
  };
}

/** @param {string|number} hour12 1–12 @param {string|number} minute 00–59 @param {'AM'|'PM'} period */
export function parts12ToTime24(hour12, minute, period) {
  if (hour12 === '' || minute === '' || !period) return '';
  let h = Number(hour12) % 12;
  if (period === 'PM') h += 12;
  const m = String(minute).padStart(2, '0');
  return `${String(h).padStart(2, '0')}:${m}`;
}

/** @param {string|null|undefined} value 24h HH:MM */
export function time24ToParts24(value) {
  if (!value) return { hour: '', minute: '' };
  const match = String(value).trim().match(/^(\d{1,2}):(\d{2})/);
  if (!match) return { hour: '', minute: '' };
  return {
    hour: String(Number(match[1])).padStart(2, '0'),
    minute: match[2],
  };
}

/** @param {string|number} hour 00–23 @param {string|number} minute 00–59 */
export function parts24ToTime24(hour, minute) {
  if (hour === '' || minute === '') return '';
  return `${String(Number(hour)).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

/** @param {string|null|undefined} start @param {string|null|undefined} end */
export function formatShiftRange24h(start, end) {
  if (!start && !end) return '—';
  const fmt = (v) => {
    if (!v) return '—';
    const match = String(v).trim().match(/^(\d{1,2}):(\d{2})/);
    if (!match) return v;
    return `${String(Number(match[1])).padStart(2, '0')}:${match[2]}`;
  };
  if (!start) return fmt(end);
  if (!end) return fmt(start);
  return `${fmt(start)} – ${fmt(end)}`;
}

/** @param {string|Date|null|undefined} value 24h DB time HH:MM */
export function formatTime12h(value) {
  if (!value) return '—';
  if (value instanceof Date) {
    return value.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true });
  }
  const raw = String(value).trim();
  if (raw.includes('T')) {
    return formatAttendanceTime(raw);
  }
  const match = raw.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (!match) return raw;
  const h = Number(match[1]);
  const m = match[2];
  const period = h >= 12 ? 'PM' : 'AM';
  const hour12 = h % 12 || 12;
  return `${hour12}:${m} ${period}`;
}
