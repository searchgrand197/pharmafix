import { formatShiftRange12h, formatShiftRange24h } from '../../utils/timeDisplay';

function ensureUniqueShiftCode(baseCode, existingCodes = []) {
  const existing = new Set(
    (existingCodes || []).map((code) => String(code || '').trim().toUpperCase()).filter(Boolean),
  );
  let candidate = String(baseCode || '').trim().toUpperCase();
  if (!candidate) candidate = 'SHIFT';
  if (!existing.has(candidate)) return candidate;

  let counter = 2;
  while (counter < 1000) {
    const suffix = String(counter);
    const nextCandidate = `${candidate.slice(0, Math.max(1, 8 - suffix.length))}${suffix}`;
    if (!existing.has(nextCandidate)) return nextCandidate;
    counter += 1;
  }
  return candidate;
}

export function suggestShiftCode(name, existingCodes = []) {
  const cleaned = (name || '').trim();
  if (!cleaned) return '';
  const words = cleaned.split(/\s+/).filter(Boolean);
  let base;
  if (words.length >= 2) {
    const first = words[0].replace(/[^a-zA-Z0-9]/g, '');
    const last = words[words.length - 1].replace(/[^a-zA-Z0-9]/g, '');
    base = `${first.slice(0, 4)}${last[0] || ''}`.toUpperCase();
  } else {
    base = cleaned.replace(/[^a-zA-Z0-9]/g, '').toUpperCase().slice(0, 6) || 'SHIFT';
  }
  return ensureUniqueShiftCode(base.slice(0, 8), existingCodes);
}

export function detectOvernight(startTime, endTime) {
  if (!startTime || !endTime) return false;
  return endTime <= startTime;
}

export function computeShiftHours(startTime, endTime, isOvernight) {
  if (!startTime || !endTime) return { full: 8, half: 4 };
  const [sh, sm] = startTime.split(':').map(Number);
  const [eh, em] = endTime.split(':').map(Number);
  let minutes = (eh * 60 + em) - (sh * 60 + sm);
  if (isOvernight || minutes <= 0) minutes += 24 * 60;
  const full = Math.max(1, Math.round((minutes / 60) * 4) / 4);
  const half = Math.max(0.5, Math.round((full / 2) * 4) / 4);
  return { full, half };
}

export function shiftPreviewText(form, timeFormat = '12h') {
  const overnight = form.is_overnight || detectOvernight(form.start_time, form.end_time);
  const range = timeFormat === '24h'
    ? formatShiftRange24h(form.start_time, form.end_time)
    : formatShiftRange12h(form.start_time, form.end_time);
  if (!form.start_time && !form.end_time) return 'Pick start and end times';
  return overnight ? `${range} (next-day checkout)` : range;
}

export function errorText(error, fallback) {
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
  collect(data.detail || data.error || data.errors || data);
  return messages.length ? messages.join(' · ') : fallback;
}

export function toApiTime(value) {
  if (!value) return value;
  return value.length === 5 ? `${value}:00` : value;
}
