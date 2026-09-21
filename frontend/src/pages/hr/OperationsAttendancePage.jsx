import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import api from '../../api';
import toast from 'react-hot-toast';
import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Clock,
  LogIn,
  LogOut,
  RefreshCw,
  Search,
} from 'lucide-react';
import { normalizeApiList } from '../../hr/recruitmentLifecycle';
import { TableSkeleton } from '../../components/HR/HRSkeleton';
import BiometricDeviceStatusBar from '../../components/HR/BiometricDeviceStatusBar';
import JourneyJobFilter from './JourneyJobFilter';
import { resolveDisplayAttendanceStatus } from '../../utils/attendanceControl';
import { formatAttendanceDateTime, formatAttendanceTime, todayIsoForAttendance } from '../../utils/timeDisplay';

const today = todayIsoForAttendance();
const AUTO_REFRESH_MS = 10000;
const DASHBOARD_FILTERS = new Set(['all', 'present', 'late', 'absent', 'leave', 'needs_attention']);

function normalizeFilter(value) {
  return DASHBOARD_FILTERS.has(value) ? value : 'all';
}

function statusClass(status, review) {
  if (review) return 'bg-amber-100 text-amber-900';
  switch (status) {
    case 'present': return 'bg-emerald-100 text-emerald-800';
    case 'late': return 'bg-orange-100 text-orange-800';
    case 'half_day': return 'bg-yellow-100 text-yellow-800';
    case 'incomplete':
    case 'in_progress': return 'bg-sky-100 text-sky-800';
    case 'missing_checkout': return 'bg-rose-100 text-rose-800';
    case 'overtime': return 'bg-indigo-100 text-indigo-800';
    case 'leave': return 'bg-blue-100 text-blue-800';
    case 'not_started': return 'bg-slate-100 text-slate-600';
    case 'early_arrival': return 'bg-cyan-100 text-cyan-900';
    case 'absent': return 'bg-rose-100 text-rose-800';
    default: return 'bg-slate-100 text-slate-700';
  }
}

function fmtTime(value) {
  return formatAttendanceTime(value) === '—' ? '—' : formatAttendanceTime(value);
}

function fmtDateTime(value) {
  return formatAttendanceDateTime(value) === '—' ? '—' : formatAttendanceDateTime(value);
}

function rowNeedsAttention(row) {
  return (
    row.requires_hr_review
    || row.incomplete_punches
    || ['late', 'in_progress', 'missing_checkout', 'incomplete'].includes(row.attendance_status)
  );
}

function rowIsLate(row) {
  return row.attendance_status === 'late' || Number(row.late_minutes || 0) > 0;
}

function rowCountsAsPresent(row) {
  if (row.is_on_leave) return false;
  if (row.attendance_status === 'absent') return false;
  if (['in_progress', 'missing_checkout', 'incomplete', 'unscheduled', 'not_started'].includes(row.attendance_status)) return false;
  return (
    ['present', 'late', 'half_day', 'overtime', 'work_from_office'].includes(row.attendance_status)
    || rowIsLate(row)
  );
}

function matchesFilter(row, filterId) {
  if (filterId === 'all') return true;
  if (filterId === 'needs_attention') return rowNeedsAttention(row);
  if (filterId === 'present') return rowCountsAsPresent(row);
  if (filterId === 'late') return rowIsLate(row);
  if (filterId === 'absent') return row.attendance_status === 'absent';
  if (filterId === 'leave') return row.is_on_leave || row.attendance_status === 'leave';
  return true;
}

function reviewReasons(row) {
  const details = row?.calculation_details || {};
  const explicit = Array.isArray(details.review_reasons) ? details.review_reasons : [];
  if (explicit.length > 0) return explicit.filter((item) => item?.code !== 'missing_checkout');
  const invalid = Array.isArray(details.invalid_punches) ? details.invalid_punches : [];
  const reasons = [];
  if (invalid.some((item) => ['consecutive_in_without_checkout', 'out_without_matching_in', 'checkout_before_checkin'].includes(item.reason))) {
    reasons.push({ code: 'invalid_punch_sequence', message: 'Punch order is inconsistent and needs HR review.' });
  }
  return reasons;
}

export default function OperationsAttendancePage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const jobOpening = searchParams.get('job_opening') || '';
  const filterParam = searchParams.get('filter') || '';
  const [loading, setLoading] = useState(true);
  const [summary, setSummary] = useState(null);
  const [attendance, setAttendance] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [punches, setPunches] = useState([]);
  const [showAllPunches, setShowAllPunches] = useState(false);
  const [date, setDate] = useState(today);
  const [search, setSearch] = useState('');
  const [appliedSearch, setAppliedSearch] = useState('');
  const [filter, setFilter] = useState(() => normalizeFilter(filterParam));
  const selectedRef = useRef(null);

  const refreshPunches = useCallback(async (row) => {
    if (!row) return;
    try {
      const { data } = await api.get('/hr/attendance-punches/', {
        params: {
          date_from: row.date,
          date_to: row.date,
          employee: row.employee,
          limit: 200,
        },
      });
      setPunches(normalizeApiList(data));
    } catch {
      setPunches([]);
    }
  }, []);

  const load = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setLoading(true);
    try {
      const params = {
        date_from: date,
        date_to: date,
        search: appliedSearch.trim() || undefined,
        limit: 500,
        force: 'true',
      };
      if (jobOpening) params.job_opening = jobOpening;
      const summaryParams = { date, force: 'true' };
      if (jobOpening) summaryParams.job_opening = jobOpening;
      const summaryRes = await api.get('/hr/daily-attendance/summary/', { params: summaryParams });
      setSummary(summaryRes.data);
      const attendanceRes = await api.get('/hr/daily-attendance/', { params });
      setAttendance(normalizeApiList(attendanceRes.data));
    } catch {
      if (!silent) {
        toast.error('Failed to load attendance');
        setSummary(null);
        setAttendance([]);
      }
    } finally {
      if (!silent) setLoading(false);
    }
  }, [date, appliedSearch, jobOpening]);

  useEffect(() => {
    document.title = 'Attendance | HR';
    load();
  }, [load]);

  useEffect(() => {
    if (date !== today) return undefined;
    const timer = setInterval(async () => {
      await load({ silent: true });
      if (selectedRef.current) {
        await refreshPunches(selectedRef.current);
      }
    }, AUTO_REFRESH_MS);
    return () => clearInterval(timer);
  }, [date, load, refreshPunches]);

  useEffect(() => {
    const next = normalizeFilter(filterParam);
    setFilter((current) => (current === next ? current : next));
  }, [filterParam]);

  const filteredRows = useMemo(
    () => attendance.filter((row) => matchesFilter(row, filter)),
    [attendance, filter],
  );

  const selected = useMemo(
    () => attendance.find((row) => row.id === selectedId) || null,
    [attendance, selectedId],
  );

  selectedRef.current = selected;

  useEffect(() => {
    setShowAllPunches(false);
    if (!selected) {
      setPunches([]);
      return;
    }
    refreshPunches(selected);
  }, [selected, refreshPunches]);

  useEffect(() => {
    if (loading || selectedId) return;
    const first = filteredRows.find(rowNeedsAttention) || filteredRows[0];
    if (first) setSelectedId(first.id);
  }, [loading, filteredRows, selectedId]);

  useEffect(() => {
    setSelectedId(null);
  }, [date, appliedSearch, filter]);

  function runSearch() {
    setAppliedSearch(search.trim());
  }

  function handleJobChange(nextJobId) {
    const params = new URLSearchParams(searchParams);
    if (nextJobId) params.set('job_opening', nextJobId);
    else params.delete('job_opening');
    setSearchParams(params, { replace: true });
  }

  function handleFilterClick(cardId) {
    setFilter((current) => {
      const next = current === cardId && cardId !== 'all' ? 'all' : cardId;
      const params = new URLSearchParams(searchParams);
      if (next === 'all') {
        params.delete('filter');
      } else {
        params.set('filter', next);
      }
      setSearchParams(params, { replace: true });
      return next;
    });
  }

  const displayDate = useMemo(() => {
    try {
      return new Date(`${date}T12:00:00`).toLocaleDateString(undefined, {
        weekday: 'short',
        day: 'numeric',
        month: 'short',
        year: 'numeric',
      });
    } catch {
      return date;
    }
  }, [date]);

  const statCards = useMemo(() => {
    const s = summary || {};
    return [
      {
        id: 'all',
        label: 'All',
        value: s.active_employees ?? attendance.length,
        tone: 'text-slate-800 bg-slate-50 border-slate-200',
      },
      { id: 'present', label: 'Present', value: s.present_today ?? 0, tone: 'text-emerald-800 bg-emerald-50 border-emerald-100' },
      { id: 'late', label: 'Late', value: s.late_employees ?? 0, tone: 'text-orange-800 bg-orange-50 border-orange-100' },
      { id: 'absent', label: 'Absent', value: s.absent_today ?? 0, tone: 'text-rose-800 bg-rose-50 border-rose-100' },
      { id: 'leave', label: 'On leave', value: s.on_leave_today ?? 0, tone: 'text-blue-800 bg-blue-50 border-blue-100' },
    ];
  }, [summary, attendance.length]);

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <BiometricDeviceStatusBar />
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold text-slate-900">
            <Clock className="text-violet-600" size={24} />
            Attendance
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            Daily attendance overview · {displayDate}
            {date === today && (
              <span className="text-slate-500"> · auto-refreshes every 10s</span>
            )}
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <JourneyJobFilter value={jobOpening} onChange={handleJobChange} />
          <input
            type="date"
            value={date}
            max={today}
            onChange={(e) => setDate(e.target.value)}
            className="rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100"
          />
          <button
            type="button"
            onClick={() => load()}
            className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
          >
            <RefreshCw size={16} />
            Refresh
          </button>
        </div>
      </div>

      {loading ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-4">
          <TableSkeleton rows={6} cols={3} />
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
            {statCards.map((card) => (
              <button
                key={card.id}
                type="button"
                onClick={() => handleFilterClick(card.id)}
                className={`rounded-xl border p-4 text-left transition hover:opacity-90 ${card.tone} ${
                  filter === card.id ? 'ring-2 ring-violet-400 ring-offset-1' : ''
                }`}
              >
                <p className="text-xs font-medium opacity-80">{card.label}</p>
                <p className="mt-1 text-2xl font-bold">{card.value}</p>
              </button>
            ))}
          </div>

          {(summary?.not_started_today ?? 0) > 0 && (
            <p className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-2 text-sm text-slate-700">
              <span className="font-semibold">{summary.not_started_today}</span> employee(s) are scheduled but their shift has not started yet — not counted as absent.
            </p>
          )}

          {(summary?.not_joined_yet_today ?? 0) > 0 && (
            <p className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-2 text-sm text-slate-700">
              <span className="font-semibold">{summary.not_joined_yet_today}</span> employee(s) have not joined yet — not counted in today&apos;s attendance.
            </p>
          )}

          {(summary?.unscheduled_today ?? 0) > 0 && (
            <p className="rounded-xl border border-violet-100 bg-violet-50 px-4 py-2 text-sm text-violet-900">
              <span className="font-semibold">{summary.unscheduled_today}</span> employee(s) have no shift today — not counted as absent.
            </p>
          )}

          <div className="grid gap-4 lg:grid-cols-[300px_minmax(0,1fr)]">
            <aside className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
              <div className="border-b border-slate-100 p-4">
                <div className="relative">
                  <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
                  <input
                    className="w-full rounded-xl border border-slate-200 py-2 pl-9 pr-3 text-sm outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100"
                    placeholder="Search name or ID"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && runSearch()}
                  />
                </div>
              </div>

              <div className="max-h-[520px] divide-y divide-slate-100 overflow-y-auto">
                {filteredRows.length === 0 ? (
                  <p className="px-4 py-12 text-center text-sm text-slate-500">No records for this filter.</p>
                ) : (
                  filteredRows.map((row) => {
                    const display = resolveDisplayAttendanceStatus(row, summary?.attendance_policy);
                    const attention = rowNeedsAttention(row);
                    const active = selectedId === row.id;
                    return (
                      <button
                        key={row.id}
                        type="button"
                        onClick={() => setSelectedId(row.id)}
                        className={`flex w-full items-center gap-3 px-4 py-3 text-left transition hover:bg-slate-50 ${
                          active ? 'bg-violet-50' : attention ? 'bg-amber-50/50' : ''
                        }`}
                      >
                        <div className="min-w-0 flex-1">
                          <p className="truncate font-semibold text-slate-900">{row.employee_name}</p>
                          <p className="truncate text-xs text-slate-500">
                            {row.employee_department || 'No dept'} · In {fmtTime(row.first_check_in)}
                          </p>
                        </div>
                        <span
                          className={`max-w-[45%] shrink-0 truncate whitespace-nowrap rounded-full px-2 py-0.5 text-[10px] font-bold ${statusClass(display.status, row.requires_hr_review)}`}
                          title={display.label}
                        >
                          {display.shortLabel}
                        </span>
                      </button>
                    );
                  })
                )}
              </div>
            </aside>

            <main className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
              {!selected ? (
                <div className="flex flex-col items-center justify-center gap-2 px-6 py-24 text-center text-slate-500">
                  <Clock className="h-10 w-10 text-slate-300" />
                  <p className="font-medium text-slate-800">Select an employee from the list</p>
                </div>
              ) : (
                <div className="p-5">
                  {(() => {
                    const display = resolveDisplayAttendanceStatus(selected, summary?.attendance_policy);
                    return (
                      <>
                        <div className="flex flex-col gap-4 border-b border-slate-100 pb-4 sm:flex-row sm:items-start sm:justify-between">
                          <div>
                            <h2 className="text-xl font-bold text-slate-900">{selected.employee_name}</h2>
                            <p className="text-sm text-slate-600">
                              {selected.employee_department || '—'} · {selected.shift_name || 'No shift'}
                            </p>
                            <span
                              className={`mt-2 inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold ${statusClass(display.status, selected.requires_hr_review)}`}
                            >
                              {rowNeedsAttention(selected) && <AlertTriangle size={12} />}
                              {display.label}
                            </span>
                          </div>
                          <Link
                            to={`/hr/employees/${selected.employee}/attendance`}
                            className="inline-flex shrink-0 items-center gap-1 rounded-xl border border-slate-200 px-3 py-2 text-sm font-semibold text-violet-700 hover:bg-slate-50"
                          >
                            Full history
                            <ChevronRight size={14} />
                          </Link>
                        </div>

                        {selected.is_early_arrival && selected.attendance_status === 'in_progress' && (
                          <p className="mt-4 rounded-xl border border-cyan-200 bg-cyan-50 px-4 py-2 text-sm text-cyan-900">
                            Early arrival — check-in recorded. Worked hours are credited from shift start, not from punch time.
                          </p>
                        )}

                        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
                          {[
                            ['First punch', fmtTime(selected.first_check_in), LogIn],
                            ['Last punch', fmtTime(selected.last_check_out), LogOut],
                            ['Hours', selected.total_work_hours ? `${selected.total_work_hours}h` : '—', Clock],
                            ['Late', selected.late_minutes ? `${selected.late_minutes}m` : '—', AlertTriangle],
                          ].map(([label, value, Icon]) => (
                            <div key={label} className="rounded-xl border border-slate-100 bg-slate-50/80 p-3">
                              <div className="flex items-center gap-1.5 text-xs text-slate-500">
                                <Icon size={13} />
                                {label}
                              </div>
                              <p className="mt-1 text-lg font-bold text-slate-900">{value}</p>
                            </div>
                          ))}
                        </div>

                        {(selected.remarks || reviewReasons(selected).length > 0) && (
                          <section className="mt-5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
                            <h3 className="text-sm font-semibold text-amber-950">Needs review</h3>
                            {selected.remarks && (
                              <p className="mt-1 text-sm text-amber-900">{selected.remarks}</p>
                            )}
                            {reviewReasons(selected).length > 0 && (
                              <ul className="mt-2 space-y-1 text-sm text-amber-900">
                                {reviewReasons(selected).map((reason) => (
                                  <li key={reason.code}>• {reason.message}</li>
                                ))}
                              </ul>
                            )}
                          </section>
                        )}

                        <section className="mt-5">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <h3 className="text-sm font-semibold text-slate-900">Punch log</h3>
                            {punches.length > 2 && (
                              <button
                                type="button"
                                onClick={() => setShowAllPunches((open) => !open)}
                                className="inline-flex items-center gap-1 rounded-xl border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                              >
                                {showAllPunches ? (
                                  <>
                                    Hide punches
                                    <ChevronUp size={14} />
                                  </>
                                ) : (
                                  <>
                                    View all punches
                                    <ChevronDown size={14} />
                                  </>
                                )}
                              </button>
                            )}
                          </div>
                          {punches.length === 0 ? (
                            <p className="mt-2 rounded-xl border border-dashed border-slate-200 px-4 py-6 text-center text-sm text-slate-500">
                              No punches recorded for this day.
                            </p>
                          ) : punches.length > 2 && !showAllPunches ? (
                            <p className="mt-2 rounded-xl border border-slate-100 bg-slate-50/80 px-4 py-3 text-sm text-slate-600">
                              {punches.length} punches today. First and last punch are shown above.
                              Use View all punches to see middle punches.
                            </p>
                          ) : (
                            <ul className="mt-2 space-y-2">
                              {punches.map((p) => (
                                <li
                                  key={p.id}
                                  className="flex items-center justify-between rounded-xl border border-slate-100 px-4 py-2.5 text-sm"
                                >
                                  <span
                                    className={`rounded-full px-2 py-0.5 text-xs font-bold ${
                                      p.punch_type === 'IN'
                                        ? 'bg-emerald-100 text-emerald-800'
                                        : 'bg-blue-100 text-blue-800'
                                    }`}
                                  >
                                    {p.punch_type}
                                  </span>
                                  <span className="text-slate-700">{fmtDateTime(p.timestamp)}</span>
                                </li>
                              ))}
                            </ul>
                          )}
                        </section>
                      </>
                    );
                  })()}
                </div>
              )}
            </main>
          </div>
        </>
      )}
    </div>
  );
}
