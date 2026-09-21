import React, { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import api from '../../api';
import toast from 'react-hot-toast';
import { ArrowLeft, BarChart3, RefreshCw } from 'lucide-react';
import { existingStatusClass, statusLabel } from '../../utils/attendanceControl';
import { heatmapLevel, HEATMAP_CLASSES, monthKey } from '../../utils/attendanceCalendar';
import { formatAttendanceTime } from '../../utils/timeDisplay';

export default function EmployeeAttendancePage() {
  const { id } = useParams();
  const [month, setMonth] = useState(monthKey());
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const currentMonth = monthKey();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data: payload } = await api.get('/hr/daily-attendance/employee-analytics/', {
        params: { employee: id, month, _t: Date.now() },
      });
      setData(payload);
    } catch {
      toast.error('Failed to load employee attendance analytics');
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [id, month]);

  useEffect(() => {
    document.title = 'Employee Attendance | HR';
    load();
  }, [load]);

  const summary = data?.summary;
  const history = data?.history || [];

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <Link to={`/hr/employees/${id}`} className="mb-2 inline-flex items-center gap-1 text-sm font-semibold text-indigo-700 hover:underline">
            <ArrowLeft className="h-4 w-4" /> Back to employee
          </Link>
          <h1 className="flex items-center gap-2 text-2xl font-bold text-slate-900">
            <BarChart3 className="h-7 w-7 text-indigo-600" />
            {data?.employee?.name || 'Employee'} — attendance
          </h1>
          <p className="text-sm text-slate-600">
            {data?.employee?.employee_id} · {data?.employee?.department || 'No department'}
            {data?.employee?.shift_name ? ` · ${data.employee.shift_name}` : ''}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <input
            type="month"
            value={month}
            max={currentMonth}
            onChange={(e) => setMonth(e.target.value)}
            className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
          />
          <button
            type="button"
            onClick={load}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 shadow-sm hover:bg-slate-50"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>
      </div>

      {loading ? (
        <p className="text-sm text-slate-500">Loading analytics…</p>
      ) : !data ? (
        <p className="text-sm text-red-600">No data available.</p>
      ) : (
        <>
          {summary.month_finalized && (
            <p className="rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-sm text-sky-900">
              Month finalized for payroll — totals use locked attendance rows (same as payroll calculation).
            </p>
          )}
          <p className="text-sm text-slate-600">
            Summary cards show totals for the selected month through {data.period?.end}.
          </p>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {[
              ['Attendance %', `${summary.attendance_percentage}%`],
              ['Present days', summary.present_days],
              ['Late days', summary.late_days],
              ['Absent days', summary.absent_days],
              ['Half days', summary.half_days],
              ['Incomplete', summary.incomplete_days],
              ['Total hours', `${summary.total_work_hours}h`],
              ['Overtime', `${summary.total_overtime_hours}h`],
            ].map(([label, value]) => (
              <div key={label} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p>
                <p className="mt-1 text-2xl font-bold text-slate-900">{value}</p>
              </div>
            ))}
          </div>

          <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <h2 className="font-semibold text-slate-900">Monthly heatmap</h2>
            <p className="mt-1 text-xs text-slate-500">Darker green = present; amber/orange = late/half day; gray = weekend/absent</p>
            <div className="mt-3 flex flex-wrap gap-1">
              {history.map((row) => {
                const lvl = heatmapLevel(row.status);
                return (
                  <span
                    key={row.date}
                    title={`${row.date}: ${statusLabel(row.status)} · ${row.worked_hours ?? '—'}h`}
                    className={`h-7 w-7 rounded-md ${HEATMAP_CLASSES[lvl]}`}
                  />
                );
              })}
            </div>
          </section>

          <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-100 px-4 py-3">
              <h2 className="font-semibold text-slate-900">Attendance history for selected month</h2>
              <p className="text-xs text-slate-500">{data.period?.start} — {data.period?.end}</p>
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-slate-50 text-xs font-semibold uppercase text-slate-500">
                  <tr>
                    <th className="px-4 py-3 text-left">Date</th>
                    <th className="px-4 py-3 text-left">Status</th>
                    <th className="px-4 py-3 text-left">Check in</th>
                    <th className="px-4 py-3 text-left">Check out</th>
                    <th className="px-4 py-3 text-left">Hours</th>
                    <th className="px-4 py-3 text-left">Late</th>
                    <th className="px-4 py-3 text-left">OT</th>
                    <th className="px-4 py-3 text-left">Source</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {history.map((row) => (
                    <tr key={row.date}>
                      <td className="px-4 py-3 font-medium text-slate-900">{row.date}</td>
                      <td className="px-4 py-3">
                        <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ring-1 ${existingStatusClass(row.status)}`}>
                          {statusLabel(row.status)}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-600">
                        {row.check_in ? formatAttendanceTime(row.check_in) : '—'}
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-600">
                        {row.check_out ? formatAttendanceTime(row.check_out) : '—'}
                      </td>
                      <td className="px-4 py-3">{row.worked_hours ?? '—'}h</td>
                      <td className="px-4 py-3">{row.late_minutes || 0}m</td>
                      <td className="px-4 py-3">{row.overtime_hours || '0'}h</td>
                      <td className="px-4 py-3 text-xs">{row.attendance_source || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {history.length === 0 && (
                <p className="p-8 text-center text-sm text-slate-500">No attendance records in this period.</p>
              )}
            </div>
          </section>
        </>
      )}
    </div>
  );
}
