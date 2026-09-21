import React, { useCallback, useEffect, useMemo, useState } from 'react';
import api from '../../api';
import toast from 'react-hot-toast';
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  RefreshCw,
  Search,
} from 'lucide-react';
import { normalizeApiList } from '../../hr/recruitmentLifecycle';
import { existingStatusClass, resolveDisplayAttendanceStatus } from '../../utils/attendanceControl';
import {
  DAY_HEALTH_STYLES,
  daysInMonth,
  fmtTime,
  monthKey,
  resolveDayHealth,
  todayIso,
} from '../../utils/attendanceCalendar';

const LEGEND = [
  { key: 'present', label: 'Mostly present', color: 'bg-emerald-400' },
  { key: 'absent', label: 'Many absent', color: 'bg-red-400' },
  { key: 'late', label: 'Many late', color: 'bg-amber-400' },
  { key: 'holiday', label: 'Holiday', color: 'bg-blue-400' },
  { key: 'weekend', label: 'Weekend', color: 'bg-slate-300' },
  { key: 'empty', label: 'No data', color: 'bg-white border border-slate-200' },
];

function formatDayHeading(dateStr) {
  if (!dateStr) return '';
  try {
    return new Date(`${dateStr}T12:00:00`).toLocaleDateString(undefined, {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });
  } catch {
    return dateStr;
  }
}

export default function AttendanceCalendarPage() {
  const [month, setMonth] = useState(monthKey());
  const [selectedDate, setSelectedDate] = useState(todayIso());
  const [calendar, setCalendar] = useState({ days: {}, month_totals: {} });
  const [dayRows, setDayRows] = useState([]);
  const [daySummary, setDaySummary] = useState(null);
  const [loadingCalendar, setLoadingCalendar] = useState(true);
  const [loadingDay, setLoadingDay] = useState(true);
  const [departments, setDepartments] = useState([]);
  const [department, setDepartment] = useState('');
  const [search, setSearch] = useState('');

  const [year, mon] = useMemo(() => {
    const [y, m] = month.split('-').map(Number);
    return [y, m];
  }, [month]);

  const loadCalendar = useCallback(async () => {
    setLoadingCalendar(true);
    try {
      const { data } = await api.get('/hr/daily-attendance/calendar/', {
        params: { month, department: department || undefined, force: 'true' },
      });
      setCalendar(data);
    } catch {
      toast.error('Could not load calendar');
      setCalendar({ days: {}, month_totals: {} });
    } finally {
      setLoadingCalendar(false);
    }
  }, [month, department]);

  const loadDay = useCallback(async (dateStr) => {
    if (!dateStr) return;
    setLoadingDay(true);
    try {
      const [summaryRes, listRes] = await Promise.all([
        api.get('/hr/daily-attendance/summary/', { params: { date: dateStr, force: 'true' } }),
        api.get('/hr/daily-attendance/', {
          params: {
            date_from: dateStr,
            date_to: dateStr,
            department: department || undefined,
            search: search.trim() || undefined,
            limit: 500,
            force: 'true',
          },
        }),
      ]);
      setDaySummary(summaryRes.data);
      setDayRows(normalizeApiList(listRes.data));
    } catch {
      toast.error('Could not load attendance for this day');
      setDaySummary(null);
      setDayRows([]);
    } finally {
      setLoadingDay(false);
    }
  }, [department, search]);

  useEffect(() => {
    document.title = 'Attendance Calendar | HR';
    api.get('/hr/departments/', { params: { limit: 500 } })
      .then((r) => setDepartments(normalizeApiList(r.data)))
      .catch(() => {});
  }, []);

  useEffect(() => {
    loadCalendar();
  }, [loadCalendar]);

  useEffect(() => {
    loadDay(selectedDate);
  }, [selectedDate, loadDay]);

  const gridCells = useMemo(() => {
    const total = daysInMonth(year, mon);
    const firstDow = new Date(year, mon - 1, 1).getDay();
    const cells = [];
    for (let i = 0; i < firstDow; i += 1) cells.push({ empty: true, key: `e-${i}` });
    for (let d = 1; d <= total; d += 1) {
      const iso = `${year}-${String(mon).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      const stats = calendar.days?.[iso];
      const hasAttendance = (stats?.total ?? 0) > 0;
      cells.push({
        empty: false,
        key: iso,
        date: iso,
        health: resolveDayHealth(stats, iso),
        isToday: iso === todayIso(),
        isFuture: iso > todayIso(),
        hasAttendance,
      });
    }
    return cells;
  }, [year, mon, calendar.days]);

  function shiftMonth(delta) {
    const d = new Date(year, mon - 1 + delta, 1);
    setMonth(monthKey(d));
  }

  function pickDate(dateStr) {
    setSelectedDate(dateStr);
    if (dateStr.slice(0, 7) !== month) setMonth(dateStr.slice(0, 7));
  }

  function goToToday() {
    const today = todayIso();
    setMonth(today.slice(0, 7));
    setSelectedDate(today);
  }

  async function refreshAll() {
    await Promise.all([loadCalendar(), loadDay(selectedDate)]);
    toast.success('Refreshed');
  }

  const summaryCards = [
    {
      label: 'Present',
      value: daySummary?.present_today ?? 0,
      className: 'border-emerald-200 bg-emerald-50 text-emerald-900',
    },
    {
      label: 'Absent',
      value: daySummary?.absent_today ?? 0,
      className: 'border-red-200 bg-red-50 text-red-900',
    },
    {
      label: 'Late',
      value: daySummary?.late_employees ?? 0,
      className: 'border-amber-200 bg-amber-50 text-amber-900',
    },
    {
      label: 'On roster',
      value: daySummary?.scheduled_employees ?? daySummary?.active_employees ?? dayRows.length,
      className: 'border-slate-200 bg-slate-50 text-slate-900',
    },
  ];

  return (
    <div className="mx-auto max-w-6xl space-y-4 pb-10">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold text-slate-900">
            <CalendarDays className="h-7 w-7 text-violet-600" />
            Attendance calendar
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            Pick a date, then review who was present, absent, or late.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={goToToday}
            className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Today
          </button>
          <button
            type="button"
            onClick={refreshAll}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            <RefreshCw className={`h-4 w-4 ${loadingCalendar || loadingDay ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>
      </div>

      <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
        {/* Calendar */}
        <aside className="w-full shrink-0 rounded-xl border border-slate-200 bg-white p-4 shadow-sm lg:w-72">
          <div className="mb-3 flex items-center justify-between">
            <button type="button" onClick={() => shiftMonth(-1)} className="rounded-lg border border-slate-200 p-2 hover:bg-slate-50" aria-label="Previous month">
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span className="text-sm font-bold text-slate-900">
              {new Date(year, mon - 1, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}
            </span>
            <button type="button" onClick={() => shiftMonth(1)} className="rounded-lg border border-slate-200 p-2 hover:bg-slate-50" aria-label="Next month">
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>

          {loadingCalendar ? (
            <p className="py-10 text-center text-sm text-slate-500">Loading…</p>
          ) : (
            <>
              <div className="grid grid-cols-7 gap-1 text-center text-xs font-semibold text-slate-400">
                {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => (
                  <div key={d}>{d}</div>
                ))}
              </div>
              <div className="mt-1 grid grid-cols-7 gap-1">
                {gridCells.map((cell) => {
                  if (cell.empty) return <div key={cell.key} className="aspect-square" />;
                  const style = DAY_HEALTH_STYLES[cell.health] || DAY_HEALTH_STYLES.neutral;
                  const selected = selectedDate === cell.date;
                  const lockedFuture = cell.isFuture && !cell.hasAttendance;
                  return (
                    <button
                      key={cell.key}
                      type="button"
                      disabled={lockedFuture}
                      onClick={() => pickDate(cell.date)}
                      className={[
                        'flex aspect-square items-center justify-center rounded-lg border text-sm font-semibold transition',
                        style,
                        selected ? 'ring-2 ring-violet-600 ring-offset-1' : '',
                        cell.isToday && !selected ? 'border-violet-400' : '',
                        lockedFuture ? 'cursor-not-allowed opacity-40' : 'hover:brightness-95',
                        cell.isFuture && cell.hasAttendance ? 'ring-1 ring-violet-300 ring-offset-1' : '',
                      ].join(' ')}
                    >
                      {Number(cell.date.slice(8))}
                    </button>
                  );
                })}
              </div>
              <div className="mt-4 space-y-1.5 border-t border-slate-100 pt-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Color guide</p>
                {LEGEND.map((item) => (
                  <div key={item.key} className="flex items-center gap-2 text-xs text-slate-600">
                    <span className={`h-3 w-3 shrink-0 rounded ${item.color}`} />
                    {item.label}
                  </div>
                ))}
              </div>
            </>
          )}
        </aside>

        {/* Day detail */}
        <div className="min-w-0 flex-1 space-y-4">
          <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <h2 className="text-lg font-semibold text-slate-900">{formatDayHeading(selectedDate)}</h2>

            <div className="mt-3 flex flex-col gap-3 sm:flex-row">
              <select
                className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
                value={department}
                onChange={(e) => setDepartment(e.target.value)}
              >
                <option value="">All departments</option>
                {departments.map((d) => (
                  <option key={d.id} value={d.name}>{d.name}</option>
                ))}
              </select>
              <div className="relative flex-1">
                <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
                <input
                  className="w-full rounded-lg border border-slate-200 py-2 pl-9 pr-3 text-sm"
                  placeholder="Search by name or employee ID"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
            </div>

            <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
              {summaryCards.map((card) => (
                <div key={card.label} className={`rounded-xl border px-3 py-3 ${card.className}`}>
                  <p className="text-xs font-medium opacity-80">{card.label}</p>
                  <p className="mt-1 text-2xl font-bold">{card.value}</p>
                </div>
              ))}
            </div>
          </section>

          <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
            {loadingDay ? (
              <p className="p-10 text-center text-sm text-slate-500">Loading employees…</p>
            ) : dayRows.length === 0 ? (
              <p className="p-10 text-center text-sm text-slate-500">
                No attendance records for this day. Try another date or clear filters.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                    <tr>
                      <th className="px-4 py-3">Employee</th>
                      <th className="px-4 py-3">Check in</th>
                      <th className="px-4 py-3">Check out</th>
                      <th className="px-4 py-3">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {dayRows.map((row) => {
                      const display = resolveDisplayAttendanceStatus(row, daySummary?.attendance_policy);
                      return (
                        <tr key={row.id} className="hover:bg-slate-50/80">
                          <td className="px-4 py-3">
                            <p className="font-medium text-slate-900">{row.employee_name}</p>
                            <p className="text-xs text-slate-500">{row.employee_id_display || row.department}</p>
                          </td>
                          <td className="px-4 py-3 text-slate-700">{fmtTime(row.first_check_in) || '—'}</td>
                          <td className="px-4 py-3 text-slate-700">{fmtTime(row.last_check_out) || '—'}</td>
                          <td className="px-4 py-3">
                            <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ${existingStatusClass(display.status)}`}>
                              {display.label}
                            </span>
                            {(row.late_minutes || 0) > 0 ? (
                              <p className="mt-0.5 text-xs text-amber-700">{row.late_minutes} min late</p>
                            ) : null}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
