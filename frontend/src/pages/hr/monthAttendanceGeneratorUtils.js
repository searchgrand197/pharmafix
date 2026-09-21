export const ATTENDANCE_TEST_SCENARIOS = [
  { id: 'perfect', label: 'Perfect — always on time', hint: '100% on-time attendance on working days.' },
  { id: 'average', label: 'Average — mostly present', hint: 'Mostly present with a few late days and absences.' },
  {
    id: 'problem',
    label: 'Problem — edge cases',
    hint: 'Late, absent, half days, missing punches, and regularization cases.',
  },
  {
    id: 'overtime',
    label: 'Overtime — extended hours',
    hint: 'Extended checkout when shift allows OT.',
  },
  {
    id: 'payroll_stress',
    label: 'Payroll stress test',
    hint: 'Mixed month: present, late, leave, holiday, OT, and missing punches.',
  },
];

export function attendanceGeneratorError(error, fallback) {
  const data = error?.response?.data;
  if (!data) return fallback;
  if (typeof data === 'string') return data;
  return data.message || data.error || data.detail || fallback;
}

export function parseHolidayDatesInput(text) {
  return (text || '')
    .split(/[\n,;]+/)
    .map((s) => s.trim())
    .filter((s) => /^\d{4}-\d{2}-\d{2}$/.test(s));
}

export const GENERATION_SUMMARY_METRICS = [
  ['Present', 'present'],
  ['Absent', 'absent'],
  ['Late', 'late'],
  ['Half day', 'half_day'],
  ['Leave', 'leave_days'],
  ['OT days', 'overtime'],
  ['Regular hours', 'regular_work_hours'],
  ['OT hours', 'overtime_hours'],
  ['Weekend', 'weekend'],
  ['Holiday', 'holiday'],
  ['HR review', 'hr_review_days'],
  ['Incomplete punches', 'incomplete_punch_days'],
  ['Regularizations', 'regularizations_created'],
  ['OT skipped days', 'ot_simulation_skipped_days'],
  ['Generated punches', 'generated_punches'],
  ['Generated summaries', 'generated_summaries'],
];
