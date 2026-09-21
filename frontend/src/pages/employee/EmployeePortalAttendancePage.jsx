import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import api from '../../api';
import toast from 'react-hot-toast';
import { ChevronLeft, ChevronRight, Plus, X } from 'lucide-react';
import { daysInMonth, monthKey, todayIso } from '../../utils/attendanceCalendar';
import { statusLabel } from '../../utils/attendanceControl';
import { formatAttendanceTime, formatShiftRange12h, toAttendanceTimeInputValue } from '../../utils/timeDisplay';
import AttendanceTrendChart from '../../components/Employee/AttendanceTrendChart';

const STATUS_STYLES = {
  present: 'bg-emerald-100 text-emerald-800 border-emerald-200',
  absent: 'bg-red-100 text-red-800 border-red-200',
  late: 'bg-amber-100 text-amber-800 border-amber-200',
  leave: 'bg-violet-100 text-violet-800 border-violet-200',
  holiday: 'bg-blue-100 text-blue-800 border-blue-200',
  weekend: 'bg-slate-100 text-slate-600 border-slate-200',
  half_day: 'bg-orange-100 text-orange-800 border-orange-200',
  incomplete: 'bg-orange-50 text-orange-700 border-orange-200',
  in_progress: 'bg-sky-100 text-sky-800 border-sky-200',
  overtime: 'bg-indigo-100 text-indigo-800 border-indigo-200',
  empty: 'bg-white text-gray-400 border-gray-100',
};

const REG_STATUS_STYLES = {
  pending: 'bg-amber-100 text-amber-900 border-amber-200',
  approved: 'bg-emerald-100 text-emerald-800 border-emerald-200',
  rejected: 'bg-red-100 text-red-800 border-red-200',
};

const FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'present', label: 'Present' },
  { key: 'absent', label: 'Absent' },
  { key: 'leave', label: 'Leave' },
  { key: 'late', label: 'Late' },
];

const REGULARIZATION_MAX_LOOKBACK_DAYS = 90;

function shiftIsoDate(iso, deltaDays) {
  const dt = new Date(`${iso}T12:00:00`);
  dt.setDate(dt.getDate() + deltaDays);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}

function displayStatus(raw) {
  if (!raw) return { key: 'empty', label: '—' };
  if (raw === 'leave' || raw === 'on_leave') return { key: 'leave', label: 'Leave' };
  if (raw === 'weekend') return { key: 'weekend', label: 'Weekend' };
  if (raw === 'holiday') return { key: 'holiday', label: 'Holiday' };
  if (raw === 'late') return { key: 'late', label: 'Late' };
  if (raw === 'absent') return { key: 'absent', label: 'Absent' };
  if (raw === 'overtime') return { key: 'overtime', label: 'Overtime' };
  if (['present', 'work_from_office'].includes(raw)) return { key: 'present', label: 'Present' };
  return { key: raw, label: statusLabel(raw) };
}

function formatDateHeading(iso) {
  const dt = new Date(`${iso}T12:00:00`);
  return dt.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
}

function errorText(error, fallback = 'Something went wrong') {
  const data = error?.response?.data;
  if (!data) return fallback;
  if (typeof data === 'string') return data;
  if (data.error || data.detail) return data.error || data.detail;
  const firstKey = Object.keys(data)[0];
  const value = data[firstKey];
  if (Array.isArray(value)) return value.join(', ');
  if (typeof value === 'string') return value;
  return fallback;
}

function DetailRow({ label, value }) {
  return (
    <div className="flex items-center justify-between rounded-xl border border-gray-100 bg-gray-50 px-3 py-2">
      <span className="text-sm text-gray-500">{label}</span>
      <span className="text-sm font-semibold text-gray-900">{value || '—'}</span>
    </div>
  );
}

function TouchButton({ children, className = '', ...props }) {
  return (
    <button
      type="button"
      className={`inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl px-4 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-50 ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}

export default function EmployeePortalAttendancePage() {
  const [month, setMonth] = useState(monthKey());
  const [analytics, setAnalytics] = useState(null);
  const [regularizations, setRegularizations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [selectedDay, setSelectedDay] = useState(null);
  const [activeFilter, setActiveFilter] = useState('all');
  const [showRequestForm, setShowRequestForm] = useState(false);
  const [showPickDate, setShowPickDate] = useState(false);
  const [pickDateValue, setPickDateValue] = useState('');
  const [requestDate, setRequestDate] = useState('');
  const [requestForm, setRequestForm] = useState({
    check_in: '',
    check_out: '',
    reason: '',
  });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [attendanceRes, regRes] = await Promise.all([
        api.get('/employee-portal/attendance/', { params: { month } }),
        api.get('/employee-portal/regularizations/', { params: { month } }),
      ]);
      setAnalytics(attendanceRes.data);
      setRegularizations(regRes.data.results || []);
    } catch {
      toast.error('Failed to load attendance');
      setAnalytics(null);
      setRegularizations([]);
    } finally {
      setLoading(false);
    }
  }, [month]);

  useEffect(() => {
    document.title = 'Attendance | Employee Portal';
    load();
  }, [load]);

  const pendingByDate = useMemo(() => {
    const map = {};
    regularizations
      .filter((row) => row.status === 'pending')
      .forEach((row) => {
        if (row.attendance_date) map[row.attendance_date] = row;
      });
    return map;
  }, [regularizations]);

  const [year, mon] = useMemo(() => month.split('-').map(Number), [month]);
  const historyByDate = useMemo(() => {
    const map = {};
    (analytics?.history || []).forEach((row) => {
      map[row.date] = row;
    });
    return map;
  }, [analytics]);

  const firstWeekday = new Date(year, mon - 1, 1).getDay();
  const totalDays = daysInMonth(year, mon);
  const todayDate = todayIso();

  const monthDays = useMemo(() => {
    const rows = [];
    for (let d = 1; d <= totalDays; d += 1) {
      const iso = `${year}-${String(mon).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      const row = historyByDate[iso] || null;
      const disp = row ? displayStatus(row.status) : displayStatus(null);
      rows.push({ iso, day: d, row, disp });
    }
    return rows;
  }, [historyByDate, mon, totalDays, year]);

  const filteredMonthDays = useMemo(() => {
    if (activeFilter === 'all') return monthDays;
    return monthDays.filter((item) => item.disp.key === activeFilter);
  }, [activeFilter, monthDays]);

  const cells = useMemo(() => {
    const next = [];
    for (let i = 0; i < firstWeekday; i += 1) next.push(null);
    monthDays.forEach((item) => next.push(item.iso));
    return next;
  }, [firstWeekday, monthDays]);

  function shiftMonth(delta) {
    const dt = new Date(year, mon - 1 + delta, 1);
    setMonth(monthKey(dt));
    setSelectedDay(null);
    setShowRequestForm(false);
    setShowPickDate(false);
  }

  const earliestRequestDate = useMemo(
    () => shiftIsoDate(todayDate, -REGULARIZATION_MAX_LOOKBACK_DAYS),
    [todayDate],
  );

  const requestBlockedReason = useCallback(
    (iso) => {
      if (!iso) return 'Select a date first.';
      if (iso > todayDate) return 'Correction requests are not available for future dates.';
      if (iso < earliestRequestDate) {
        return `Requests are limited to the last ${REGULARIZATION_MAX_LOOKBACK_DAYS} days.`;
      }
      if (pendingByDate[iso]) return 'A correction request for this date is already pending HR review.';
      return null;
    },
    [earliestRequestDate, pendingByDate, todayDate],
  );

  function canRequestForDate(iso) {
    return !requestBlockedReason(iso);
  }

  function openRequestForm(iso) {
    if (!canRequestForDate(iso)) {
      toast.error(requestBlockedReason(iso) || 'Cannot request correction for this date.');
      return;
    }
    const row = historyByDate[iso];
    setRequestDate(iso);
    setRequestForm({
      check_in: toAttendanceTimeInputValue(row?.check_in),
      check_out: toAttendanceTimeInputValue(row?.check_out),
      reason: '',
    });
    setShowPickDate(false);
    setShowRequestForm(true);
  }

  function startCorrectionRequest(iso = selectedDay) {
    if (iso && canRequestForDate(iso)) {
      openRequestForm(iso);
      return;
    }
    setPickDateValue(iso && iso <= todayDate ? iso : todayDate);
    setShowPickDate(true);
  }

  function confirmPickDate() {
    if (!pickDateValue) {
      toast.error('Choose a date for your correction request.');
      return;
    }
    if (!canRequestForDate(pickDateValue)) {
      toast.error(requestBlockedReason(pickDateValue) || 'Cannot request correction for this date.');
      return;
    }
    openRequestForm(pickDateValue);
  }

  async function submitRequest() {
    if (!requestForm.check_in && !requestForm.check_out) {
      toast.error('Enter at least a check-in or check-out time.');
      return;
    }
    if (!requestForm.reason.trim() || requestForm.reason.trim().length < 3) {
      toast.error('Please provide a reason (at least 3 characters).');
      return;
    }
    setSubmitting(true);
    try {
      const payload = {
        date: requestDate,
        reason: requestForm.reason.trim(),
      };
      if (requestForm.check_in) payload.requested_check_in_time = requestForm.check_in;
      if (requestForm.check_out) payload.requested_check_out_time = requestForm.check_out;

      await api.post('/employee-portal/regularizations/', payload);
      toast.success('Regularization request submitted for HR review.');
      setShowRequestForm(false);
      setSelectedDay(null);
      await load();
    } catch (error) {
      toast.error(errorText(error, 'Could not submit request'));
    } finally {
      setSubmitting(false);
    }
  }

  const summary = analytics?.summary || {};
  const selected = selectedDay ? historyByDate[selectedDay] : null;
  const selectedDisplay = selected ? displayStatus(selected.status) : displayStatus(null);
  const selectedPending = selectedDay ? pendingByDate[selectedDay] : null;

  const selectedShiftTiming = useMemo(() => {
    if (!selected && !analytics?.employee) return '—';
    const name = selected?.shift_name || analytics?.employee?.shift_name;
    const range = formatShiftRange12h(
      selected?.shift_start || analytics?.employee?.shift_start,
      selected?.shift_end || analytics?.employee?.shift_end,
    );
    if (name && range !== '—') return `${name} · ${range}`;
    return name || range;
  }, [analytics?.employee, selected]);

  const summaryCards = [
    ['Present', summary.present_days ?? 0],
    ['Absent', summary.absent_days ?? 0],
    ['Leave', summary.leave_days ?? 0],
    ['Late', summary.late_days ?? 0],
    ['OT Hours', summary.total_overtime_hours ?? 0],
    ['Attendance %', summary.attendance_percentage != null ? `${summary.attendance_percentage}%` : '—'],
  ];

  return (
    <div className="mx-auto w-full max-w-lg space-y-5 pb-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-xl font-bold text-gray-900">My Attendance</h2>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => shiftMonth(-1)}
            className="min-h-[44px] min-w-[44px] rounded-xl border border-gray-200 bg-white p-2 hover:bg-gray-50"
          >
            <ChevronLeft size={18} />
          </button>
          <span className="min-w-[165px] text-center text-base font-semibold">
            {new Date(year, mon - 1).toLocaleString('default', { month: 'long', year: 'numeric' })}
          </span>
          <button
            type="button"
            onClick={() => shiftMonth(1)}
            className="min-h-[44px] min-w-[44px] rounded-xl border border-gray-200 bg-white p-2 hover:bg-gray-50"
          >
            <ChevronRight size={18} />
          </button>
        </div>
      </div>

      {analytics?.attendance_compliance && (
        <section className="rounded-2xl border border-amber-200 bg-amber-50 p-4 shadow-sm">
          <h3 className="mb-2 text-sm font-bold uppercase tracking-wide text-amber-900">Attendance compliance</h3>
          <div className="grid grid-cols-2 gap-3 text-sm">
            <DetailRow label="Monthly late count" value={analytics.attendance_compliance.monthly_late_count} />
            <DetailRow label="OT hours" value={analytics.attendance_compliance.overtime_hours} />
            <DetailRow label="Status" value={analytics.attendance_compliance.status} />
            <DetailRow label="Late equivalent days" value={analytics.attendance_compliance.late_equivalent_leave_days} />
          </div>
          {(analytics.attendance_compliance.late_warnings || []).length > 0 && (
            <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-amber-950">
              {analytics.attendance_compliance.late_warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          )}
        </section>
      )}

      {summary.month_finalized && (
        <p className="rounded-xl border border-sky-200 bg-sky-50 px-3 py-2 text-xs text-sky-900">
          This month is finalized for payroll. Summary totals match HR payroll (locked attendance rows).
        </p>
      )}

      <section className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
        <h3 className="mb-3 text-sm font-bold uppercase tracking-wide text-gray-500">Monthly summary</h3>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {summaryCards.map(([label, value]) => (
            <div key={label} className="rounded-xl border border-gray-100 bg-gray-50 p-3 text-center">
              <p className="text-xs text-gray-500">{label}</p>
              <p className="mt-1 text-xl font-bold text-gray-900">{value}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
        <h3 className="mb-3 text-sm font-bold uppercase tracking-wide text-gray-500">Attendance trend</h3>
        <AttendanceTrendChart history={analytics?.history || []} />
      </section>

      <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm sm:p-5">
        <p className="mb-3 text-sm text-gray-500">
          Tap a day to view punch details.
        </p>

        <div className="mb-4 flex flex-wrap gap-2">
          {FILTERS.map((filter) => (
            <button
              key={filter.key}
              type="button"
              onClick={() => setActiveFilter(filter.key)}
              className={`min-h-[44px] rounded-xl border px-4 text-sm font-medium transition ${
                activeFilter === filter.key
                  ? 'border-teal-600 bg-teal-50 text-teal-800'
                  : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50'
              }`}
            >
              {filter.label}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="space-y-3">
            {Array.from({ length: 6 }).map((_, idx) => (
              <div key={idx} className="h-14 animate-pulse rounded-xl bg-gray-100" />
            ))}
          </div>
        ) : (
          <>
            <div className="mb-2 hidden grid-cols-7 gap-2 text-center text-sm font-semibold uppercase text-gray-500 md:grid">
              {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => (
                <div key={d}>{d}</div>
              ))}
            </div>
            <div className="hidden grid-cols-7 gap-2 md:grid">
              {cells.map((iso, idx) => {
                if (!iso) return <div key={`empty-${idx}`} />;
                const item = monthDays.find((row) => row.iso === iso);
                const disp = item?.disp || displayStatus(null);
                const style = STATUS_STYLES[disp.key] || STATUS_STYLES.empty;
                const isSelected = selectedDay === iso;
                const mutedByFilter = activeFilter !== 'all' && disp.key !== activeFilter;
                const hasPending = Boolean(pendingByDate[iso]);
                return (
                  <button
                    key={iso}
                    type="button"
                    onClick={() => setSelectedDay(iso)}
                    className={`min-h-[76px] rounded-xl border p-2 text-left text-sm transition ${style} ${
                      isSelected ? 'ring-2 ring-teal-500' : ''
                    } ${mutedByFilter ? 'opacity-35' : ''}`}
                  >
                    <span className="font-bold">{Number(iso.slice(-2))}</span>
                    <div className="mt-1 truncate text-sm">{disp.label}</div>
                    {hasPending && (
                      <div className="mt-1 truncate text-xs font-medium text-amber-700">Pending</div>
                    )}
                  </button>
                );
              })}
            </div>

            <div className="space-y-2 md:hidden">
              {filteredMonthDays.length === 0 ? (
                <p className="rounded-xl border border-dashed border-gray-300 px-4 py-6 text-center text-sm text-gray-500">
                  No records for this filter.
                </p>
              ) : (
                filteredMonthDays.map((item) => {
                  const style = STATUS_STYLES[item.disp.key] || STATUS_STYLES.empty;
                  const hasPending = Boolean(pendingByDate[item.iso]);
                  return (
                    <button
                      key={item.iso}
                      type="button"
                      onClick={() => setSelectedDay(item.iso)}
                      className={`flex min-h-[56px] w-full items-center justify-between rounded-xl border px-4 text-left text-sm transition ${style}`}
                    >
                      <span className="font-semibold">
                        {formatDateHeading(item.iso)}
                        {hasPending && <span className="ml-2 text-xs text-amber-700">· Pending</span>}
                      </span>
                      <span className="text-sm font-medium">{item.disp.label}</span>
                    </button>
                  );
                })
              )}
            </div>
          </>
        )}
      </div>

      {!loading && monthDays.every((item) => item.disp.key === 'empty') && (
        <div className="rounded-xl border border-dashed border-gray-300 bg-white p-6 text-center text-sm text-gray-500">
          No records for this month.
        </div>
      )}

      <section className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm sm:p-5">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-base font-semibold text-gray-900">My correction requests</h3>
          <div className="flex items-center gap-2">
            <span className="text-sm text-gray-500">{regularizations.length} this month</span>
          </div>
        </div>
        {loading ? (
          <div className="h-20 animate-pulse rounded-xl bg-gray-100" />
        ) : regularizations.length === 0 ? (
          <p className="rounded-xl border border-dashed border-gray-300 px-4 py-6 text-center text-sm text-gray-500">
            No correction requests for this month. Tap a day in the calendar to request a correction.
          </p>
        ) : (
          <div className="space-y-2">
            {regularizations.map((row) => {
              const style = REG_STATUS_STYLES[row.status] || REG_STATUS_STYLES.pending;
              return (
                <div key={row.id} className="rounded-xl border border-gray-100 bg-gray-50 px-3 py-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <p className="text-sm font-semibold text-gray-900">
                        {row.attendance_date ? formatDateHeading(row.attendance_date) : '—'}
                      </p>
                      <p className="mt-1 text-xs text-gray-500">
                        In: {formatAttendanceTime(row.requested_check_in)} · Out: {formatAttendanceTime(row.requested_check_out)}
                      </p>
                      <p className="mt-1 text-sm text-gray-600">{row.reason}</p>
                      {row.reviewer_remarks && (
                        <p className="mt-1 text-xs text-gray-500">HR: {row.reviewer_remarks}</p>
                      )}
                    </div>
                    <span className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${style}`}>
                      {row.status_display || row.status}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <div className="flex flex-wrap gap-2 text-sm">
        {['Present', 'Absent', 'Late', 'Leave', 'Holiday', 'Weekend'].map((label) => {
          const key = label.toLowerCase();
          return (
            <span key={label} className={`rounded-full border px-3 py-1.5 ${STATUS_STYLES[key] || STATUS_STYLES.empty}`}>
              {label}
            </span>
          );
        })}
      </div>

      {selectedDay && !showRequestForm && createPortal(
        <div className="fixed inset-0 z-[100] bg-black/40" onClick={() => setSelectedDay(null)}>
          <div
            className="absolute bottom-0 left-0 right-0 max-h-[85vh] overflow-y-auto rounded-t-2xl bg-white p-4 shadow-2xl sm:left-1/2 sm:bottom-6 sm:w-[420px] sm:-translate-x-1/2 sm:rounded-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-center justify-between">
              <div>
                <p className="text-base font-semibold text-gray-900">{formatDateHeading(selectedDay)}</p>
                <p className="text-sm text-gray-500">Status: {selectedDisplay?.label || '—'}</p>
              </div>
              <button
                type="button"
                onClick={() => setSelectedDay(null)}
                className="min-h-[44px] min-w-[44px] rounded-xl border border-gray-200 p-2 text-gray-600"
              >
                <X size={18} />
              </button>
            </div>
            <div className="space-y-2">
              <DetailRow label="Check-in" value={formatAttendanceTime(selected?.check_in)} />
              <DetailRow label="Check-out" value={formatAttendanceTime(selected?.check_out)} />
              <DetailRow label="Shift timing" value={selectedShiftTiming} />
              <DetailRow
                label="Working hours"
                value={
                  selected?.worked_hours != null && selected.worked_hours !== ''
                    ? `${selected.worked_hours} hrs`
                    : null
                }
              />
              <DetailRow
                label="Late minutes"
                value={
                  selected?.late_minutes != null && Number(selected.late_minutes) > 0
                    ? `${selected.late_minutes} min`
                    : '0'
                }
              />
              <DetailRow
                label="Overtime"
                value={
                  selected?.overtime_hours != null && selected.overtime_hours !== ''
                    ? `${selected.overtime_hours} hrs`
                    : '0'
                }
              />
              <DetailRow label="Status" value={selectedDisplay?.label} />
            </div>

            {selectedPending && (
              <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                A correction request for this date is pending HR review.
              </div>
            )}
            
            {!selectedPending && (
              <div className="mt-4">
                <TouchButton
                  disabled={!canRequestForDate(selectedDay)}
                  onClick={() => startCorrectionRequest(selectedDay)}
                  className="w-full bg-teal-600 text-white hover:bg-teal-700"
                >
                  Request correction
                </TouchButton>
                {!canRequestForDate(selectedDay) && requestBlockedReason(selectedDay) && (
                  <p className="mt-2 text-center text-xs text-gray-500">{requestBlockedReason(selectedDay)}</p>
                )}
              </div>
            )}
          </div>
        </div>,
        document.body,
      )}

      {showPickDate && createPortal(
        <div className="fixed inset-0 z-[100] bg-black/40" onClick={() => setShowPickDate(false)}>
          <div
            className="absolute bottom-0 left-0 right-0 rounded-t-2xl bg-white p-4 shadow-2xl sm:left-1/2 sm:bottom-6 sm:w-[420px] sm:-translate-x-1/2 sm:rounded-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-center justify-between">
              <div>
                <p className="text-base font-semibold text-gray-900">Request correction</p>
                <p className="text-sm text-gray-500">Choose the attendance date to correct</p>
              </div>
              <button
                type="button"
                onClick={() => setShowPickDate(false)}
                className="min-h-[44px] min-w-[44px] rounded-xl border border-gray-200 p-2 text-gray-600"
              >
                <X size={18} />
              </button>
            </div>
            <label className="block">
              <span className="text-sm font-medium text-gray-700">Date</span>
              <input
                type="date"
                value={pickDateValue}
                min={earliestRequestDate}
                max={todayDate}
                onChange={(e) => setPickDateValue(e.target.value)}
                className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm"
              />
            </label>
            <div className="mt-4 flex gap-2">
              <TouchButton
                onClick={() => setShowPickDate(false)}
                className="flex-1 border border-gray-200 bg-white text-gray-700"
              >
                Cancel
              </TouchButton>
              <TouchButton
                onClick={confirmPickDate}
                className="flex-1 bg-teal-600 text-white hover:bg-teal-700"
              >
                Continue
              </TouchButton>
            </div>
          </div>
        </div>,
        document.body,
      )}

      {showRequestForm && requestDate && createPortal(
        <div className="fixed inset-0 z-[100] bg-black/40" onClick={() => setShowRequestForm(false)}>
          <div
            className="absolute bottom-0 left-0 right-0 max-h-[90vh] overflow-y-auto rounded-t-2xl bg-white p-4 shadow-2xl sm:left-1/2 sm:bottom-6 sm:w-[420px] sm:-translate-x-1/2 sm:rounded-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-center justify-between">
              <div>
                <p className="text-base font-semibold text-gray-900">Request correction</p>
                <p className="text-sm text-gray-500">{formatDateHeading(requestDate)}</p>
              </div>
              <button
                type="button"
                onClick={() => setShowRequestForm(false)}
                className="min-h-[44px] min-w-[44px] rounded-xl border border-gray-200 p-2 text-gray-600"
              >
                <X size={18} />
              </button>
            </div>

            <p className="mb-3 text-sm text-gray-500">
              Enter the correct check-in and/or check-out time. HR will review before updating your attendance.
            </p>

            <div className="space-y-3">
              <label className="block">
                <span className="text-sm font-medium text-gray-700">Check-in time</span>
                <input
                  type="time"
                  value={requestForm.check_in}
                  onChange={(e) => setRequestForm((prev) => ({ ...prev, check_in: e.target.value }))}
                  className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm"
                />
              </label>
              <label className="block">
                <span className="text-sm font-medium text-gray-700">Check-out time</span>
                <input
                  type="time"
                  value={requestForm.check_out}
                  onChange={(e) => setRequestForm((prev) => ({ ...prev, check_out: e.target.value }))}
                  className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm"
                />
              </label>
              <label className="block">
                <span className="text-sm font-medium text-gray-700">Reason</span>
                <textarea
                  rows={3}
                  value={requestForm.reason}
                  onChange={(e) => setRequestForm((prev) => ({ ...prev, reason: e.target.value }))}
                  placeholder="e.g. Forgot to punch out after shift"
                  className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm"
                />
              </label>
            </div>

            <div className="mt-4 flex gap-2">
              <TouchButton
                onClick={() => setShowRequestForm(false)}
                className="flex-1 border border-gray-200 bg-white text-gray-700"
              >
                Cancel
              </TouchButton>
              <TouchButton
                onClick={submitRequest}
                disabled={submitting}
                className="flex-1 bg-teal-600 text-white hover:bg-teal-700"
              >
                {submitting ? 'Submitting…' : 'Submit request'}
              </TouchButton>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}
