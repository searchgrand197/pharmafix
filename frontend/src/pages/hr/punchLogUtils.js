import { formatAttendanceDateTime, formatTime12h } from '../../utils/timeDisplay';

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

export function sourceLabel(punch) {
  if (punch.source_display) return punch.source_display;
  const map = {
    biometric: 'Biometric',
    HR_manual: 'Added by HR',
    employee_portal: 'Employee app',
    import: 'Import',
    MANUAL_BIOMETRIC_SIMULATION: 'Simulator',
    system: 'System',
  };
  return map[punch.source] || punch.source || 'Unknown';
}

export function punchTypeLabel(type) {
  return type === 'IN' ? 'Check in' : 'Check out';
}

export function formatPunchTime(punch) {
  if (punch.punch_time) return formatTime12h(punch.punch_time);
  const formatted = formatAttendanceDateTime(punch.timestamp);
  if (formatted === '—') return '—';
  const parts = formatted.split(', ');
  return parts[parts.length - 1] || formatted;
}

export function groupPunchesByEmployee(punches) {
  const map = new Map();
  for (const punch of punches) {
    const key = punch.employee;
    if (!map.has(key)) {
      map.set(key, {
        employeeId: key,
        name: punch.employee_name,
        code: punch.employee_id_display,
        punches: [],
      });
    }
    map.get(key).punches.push(punch);
  }
  for (const group of map.values()) {
    group.punches.sort((a, b) => String(a.timestamp || '').localeCompare(String(b.timestamp || '')));
  }
  return [...map.values()].sort((a, b) => (a.name || '').localeCompare(b.name || ''));
}

export function shiftDateIso(isoDate, days) {
  const d = new Date(`${isoDate}T12:00:00`);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}
