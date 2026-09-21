/**
 * Interview date/time — IST only. Reuses attendance helpers (proven in production).
 */
import {
  ATTENDANCE_TIME_ZONE,
  todayIsoForAttendance,
} from './timeDisplay';

export { ATTENDANCE_TIME_ZONE as HR_SYSTEM_TIMEZONE };

/** HH:mm with zero-padded hour and minute. */
export function padTimeValue(time) {
  if (!time) return '';
  const raw = time.trim().slice(0, 8);
  const [hRaw, mRaw = '0'] = raw.split(':');
  const h = Number(hRaw);
  const m = Number(mRaw);
  if (Number.isNaN(h) || Number.isNaN(m)) return '';
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** Minutes since midnight from HH:mm. */
export function timeToMinutes(time) {
  const padded = padTimeValue(time);
  if (!padded) return 0;
  const [h, m] = padded.split(':').map(Number);
  return h * 60 + m;
}

/** Calendar date YYYY-MM-DD and time HH:mm in IST. */
export function getZonedDateTimeParts(date, tz = ATTENDANCE_TIME_ZONE) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date);
  const get = (type) => parts.find((p) => p.type === type)?.value || '00';
  const hour = get('hour') === '24' ? '00' : get('hour');
  return {
    date: `${get('year')}-${get('month')}-${get('day')}`,
    time: padTimeValue(`${hour}:${get('minute')}`),
  };
}

/** Today YYYY-MM-DD in IST. */
export function todayISODate() {
  return todayIsoForAttendance();
}

export function todayInTimezone() {
  return todayISODate();
}

export function normalizeTimeValue(time) {
  return padTimeValue(time);
}

export function dateTimeLocalToParts(value) {
  if (!value) return { date: '', time: '' };
  const v = value.slice(0, 16);
  const [date, time] = v.split('T');
  return { date: date || '', time: padTimeValue(time) };
}

export function isoToDateAndTimeInTimezone(iso, tz = ATTENDANCE_TIME_ZONE) {
  if (!iso) return { date: '', time: '' };
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return { date: '', time: '' };
  return getZonedDateTimeParts(d, tz);
}

/** Calendar date YYYY-MM-DD in hospital timezone (default IST). */
export function interviewIsoToCalendarDate(iso, tz = ATTENDANCE_TIME_ZONE) {
  return isoToDateAndTimeInTimezone(iso, tz).date || null;
}

/** Human-readable interview datetime in hospital timezone with IST suffix. */
export function formatInterviewDateTime(iso, tz = ATTENDANCE_TIME_ZONE) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const formatted = new Intl.DateTimeFormat('en-IN', {
    timeZone: tz,
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  }).format(d);
  return tz === ATTENDANCE_TIME_ZONE ? `${formatted} IST` : formatted;
}

export function isoToDateTimeLocal(iso) {
  const { date, time } = isoToDateAndTimeInTimezone(iso);
  if (!date || !time) return '';
  return `${date}T${time}`;
}

/** Current datetime YYYY-MM-DDTHH:mm in IST. */
export function currentDateTimeLocal() {
  const { date, time } = getZonedDateTimeParts(new Date());
  return `${date}T${time}`;
}

/** Human-readable current IST clock for the schedule form. */
export function currentISTClockLabel() {
  const { date, time } = getZonedDateTimeParts(new Date());
  return `${date} ${time} IST`;
}

export function compareDateTimeSlots(dateA, timeA, dateB, timeB) {
  if (dateA !== dateB) return dateA < dateB ? -1 : 1;
  const diff = timeToMinutes(timeA) - timeToMinutes(timeB);
  if (diff < 0) return -1;
  if (diff > 0) return 1;
  return 0;
}

/** Past check — prefer backend; kept for optional UI hints only. */
export function isInterviewSlotInPast(date, time, graceMinutes = 2) {
  if (!date) return false;
  const slotTime = padTimeValue(time);
  if (!slotTime) return false;
  const today = todayISODate();
  if (date < today) return true;
  if (date > today) return false;
  const floorInstant = new Date(Date.now() - Math.max(0, graceMinutes) * 60_000);
  const floor = getZonedDateTimeParts(floorInstant);
  return compareDateTimeSlots(date, slotTime, floor.date, floor.time) < 0;
}

export function isDateTimeLocalInPast(value, graceMinutes = 2) {
  const { date, time } = dateTimeLocalToParts(value);
  return isInterviewSlotInPast(date, time, graceMinutes);
}
