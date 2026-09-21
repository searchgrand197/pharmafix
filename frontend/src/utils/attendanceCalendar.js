/**
 * Attendance calendar helpers (summary-driven UI).
 */

import { isWeekendDate } from './attendanceControl';
import {
  formatAttendanceDateTime,
  formatAttendanceTime,
  monthKeyForAttendance,
  todayIsoForAttendance,
} from './timeDisplay';

export const DAY_HEALTH_STYLES = {
  present: 'bg-emerald-50 border-emerald-300 hover:bg-emerald-100',
  absent: 'bg-red-50 border-red-300 hover:bg-red-100',
  late: 'bg-amber-50 border-amber-400 hover:bg-amber-100',
  holiday: 'bg-blue-50 border-blue-400 hover:bg-blue-100',
  weekend: 'bg-slate-100 border-slate-300 hover:bg-slate-200',
  overtime: 'bg-indigo-50 border-indigo-300 hover:bg-indigo-100',
  incomplete: 'bg-orange-50 border-orange-300 hover:bg-orange-100',
  empty: 'bg-white border-slate-200 hover:border-slate-300',
  neutral: 'bg-slate-50 border-slate-200 hover:bg-white',
};

export const LEGEND_ITEMS = [
  { key: 'present', label: 'Mostly present', color: 'bg-emerald-400' },
  { key: 'absent', label: 'High absences', color: 'bg-red-400' },
  { key: 'late', label: 'High late count', color: 'bg-amber-400' },
  { key: 'holiday', label: 'Holiday', color: 'bg-blue-400' },
  { key: 'weekend', label: 'Weekend', color: 'bg-slate-400' },
  { key: 'overtime', label: 'Overtime-heavy', color: 'bg-indigo-400' },
  { key: 'incomplete', label: 'Incomplete punches', color: 'bg-orange-400' },
];

/** @param {object|null|undefined} stats */
export function resolveDayHealth(stats, dateStr) {
  if (stats?.health) return stats.health;
  if (!stats || !stats.total) {
    return isWeekendDate(dateStr) ? 'weekend' : 'empty';
  }
  const total = stats.total || 1;
  if ((stats.holiday || 0) >= total * 0.5) return 'holiday';
  if ((stats.absent || 0) / total >= 0.35) return 'absent';
  if ((stats.late || 0) / total >= 0.2) return 'late';
  if ((stats.missing_checkout || 0) / total >= 0.1) return 'incomplete';
  if (((stats.incomplete || 0) + (stats.in_progress || 0)) / total >= 0.15) return 'incomplete';
  if ((stats.overtime || 0) / total >= 0.25) return 'overtime';
  if ((stats.present || 0) / total >= 0.55) return 'present';
  if (isWeekendDate(dateStr)) return 'weekend';
  return 'neutral';
}

export function monthKey(d = new Date()) {
  return monthKeyForAttendance(d);
}

export function daysInMonth(year, month) {
  return new Date(year, month, 0).getDate();
}

export function todayIso() {
  return todayIsoForAttendance();
}

/** @param {string|null|undefined} value */
export function fmtTime(value) {
  return formatAttendanceTime(value);
}

/** @param {string|null|undefined} value */
export function fmtDateTime(value) {
  return formatAttendanceDateTime(value);
}

export function getError(error, fallback) {
  const data = error?.response?.data;
  if (!data) return fallback;
  if (typeof data === 'string') return data;
  return data.error || data.detail || fallback;
}

/** Heatmap intensity 0–4 from attendance status */
export function heatmapLevel(status) {
  switch (status) {
    case 'present':
    case 'work_from_office':
      return 4;
    case 'late':
    case 'overtime':
      return 3;
    case 'half_day':
      return 2;
    case 'leave':
    case 'holiday':
      return 1;
    case 'weekend':
      return 0;
    default:
      return 0;
  }
}

export const HEATMAP_CLASSES = [
  'bg-slate-100',
  'bg-sky-200',
  'bg-amber-200',
  'bg-orange-300',
  'bg-emerald-400',
];
