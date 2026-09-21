import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../../api';
import toast from 'react-hot-toast';
import { Calendar, RefreshCw, Users } from 'lucide-react';
import { normalizeApiList } from '../../hr/recruitmentLifecycle';
import {
  ATTENDANCE_TEST_SCENARIOS,
  attendanceGeneratorError,
  GENERATION_SUMMARY_METRICS,
  parseHolidayDatesInput,
} from './monthAttendanceGeneratorUtils';
import { withJourneyCenterReturn } from './journeyCenterUtils';
import { payrollRunsRoute } from './payrollMonthTaskUtils';

const now = new Date();
const defaultMonth = now.getMonth() + 1;
const defaultYear = now.getFullYear();

export default function MonthAttendanceGeneratorPanel({
  compact = false,
  preselectedEmployeeId = null,
  externalEmployees = null,
  employeesLoading: externalLoading = false,
}) {
  const [employees, setEmployees] = useState([]);
  const [loadingEmployees, setLoadingEmployees] = useState(!externalEmployees);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState(null);
  const [form, setForm] = useState(() => ({
    month: defaultMonth,
    year: defaultYear,
    scenario: 'perfect',
    employeeIds: preselectedEmployeeId ? [preselectedEmployeeId] : [],
    allEmployees: !preselectedEmployeeId,
    replaceExisting: true,
    holidayDates: '',
  }));

  useEffect(() => {
    if (externalEmployees) {
      setEmployees(externalEmployees);
      setLoadingEmployees(externalLoading);
      return;
    }
    (async () => {
      setLoadingEmployees(true);
      try {
        const { data } = await api.get('/hr/employees/', { params: { limit: 500, status: 'active' } });
        setEmployees(normalizeApiList(data));
      } catch (err) {
        toast.error(attendanceGeneratorError(err, 'Failed to load employees.'));
      } finally {
        setLoadingEmployees(false);
      }
    })();
  }, [externalEmployees, externalLoading]);

  useEffect(() => {
    if (!preselectedEmployeeId) return;
    setForm((f) => ({
      ...f,
      employeeIds: [preselectedEmployeeId],
      allEmployees: false,
    }));
  }, [preselectedEmployeeId]);

  const eligibleEmployees = useMemo(
    () => employees.filter((e) => e.shift || e.shift_id),
    [employees],
  );

  const ineligibleEmployees = useMemo(
    () => employees.filter((e) => !e.shift && !e.shift_id),
    [employees],
  );

  const selectedCount = form.allEmployees ? eligibleEmployees.length : form.employeeIds.length;

  const holidayList = useMemo(
    () => parseHolidayDatesInput(form.holidayDates),
    [form.holidayDates],
  );

  async function handleGenerate(e) {
    e.preventDefault();
    if (!selectedCount) {
      toast.error('Select at least one employee with an assigned shift.');
      return;
    }
    setSubmitting(true);
    setResult(null);
    try {
      const payload = {
        month: Number(form.month),
        year: Number(form.year),
        scenario: form.scenario,
        replace_existing: form.replaceExisting,
        holiday_dates: holidayList,
      };
      if (!form.allEmployees) {
        payload.employee_ids = form.employeeIds;
      }
      const { data } = await api.post('/hr/attendance-test-seeder/generate/', payload);
      setResult(data);
      const processed = data.employees_processed ?? 0;
      const skipped = data.employees_skipped?.length ?? 0;
      if (processed === 0) {
        toast.error(
          skipped
            ? 'No attendance generated. Check skipped employees (e.g. joining date after this month).'
            : 'No attendance was generated for the selected employees.',
        );
      } else if (skipped > 0) {
        toast.success(`Attendance generated for ${processed} employee(s). ${skipped} skipped.`);
      } else if (data.warnings?.length > 0) {
        toast.success('Month attendance generated. See warnings in the summary.');
      } else {
        toast.success(`Month attendance generated for ${processed} employee(s).`);
      }
    } catch (err) {
      toast.error(attendanceGeneratorError(err, 'Generation failed.'));
    } finally {
      setSubmitting(false);
    }
  }

  function toggleEmployee(id) {
    setForm((f) => {
      const set = new Set(f.employeeIds);
      if (set.has(id)) set.delete(id);
      else set.add(id);
      return { ...f, employeeIds: [...set], allEmployees: false };
    });
  }

  return (
    <div className={compact ? 'space-y-4' : 'space-y-5'}>
      {!compact && (
        <p className="text-sm text-gray-600">
          Creates real punch-in / punch-out records from each employee&apos;s joining date through the end of the
          selected month, then calculates daily summaries. Use this to test attendance and payroll.
        </p>
      )}

      {compact && (
        <p className="text-xs text-slate-600">
          Fills the whole month with realistic punches starting from each employee&apos;s <strong>joining date</strong>.
          Then run payroll on Payroll Runs. Pick <strong>Perfect</strong> for a clean payroll test.
        </p>
      )}

      <form onSubmit={handleGenerate} className="space-y-4">
        <div className={`grid gap-3 ${compact ? 'sm:grid-cols-3' : 'gap-4 sm:grid-cols-3'}`}>
          <label className="block text-sm">
            <span className="font-medium text-gray-700">Month</span>
            <select
              className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
              value={form.month}
              onChange={(e) => setForm((f) => ({ ...f, month: Number(e.target.value) }))}
            >
              {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                <option key={m} value={m}>
                  {new Date(2000, m - 1, 1).toLocaleString('default', { month: 'long' })}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm">
            <span className="font-medium text-gray-700">Year</span>
            <input
              type="number"
              min={2020}
              max={2100}
              className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
              value={form.year}
              onChange={(e) => setForm((f) => ({ ...f, year: Number(e.target.value) }))}
            />
          </label>
          <label className="block text-sm">
            <span className="font-medium text-gray-700">Scenario</span>
            <select
              className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
              value={form.scenario}
              onChange={(e) => setForm((f) => ({ ...f, scenario: e.target.value }))}
            >
              {ATTENDANCE_TEST_SCENARIOS.map((s) => (
                <option key={s.id} value={s.id}>{s.label}</option>
              ))}
            </select>
          </label>
        </div>
        <p className="text-xs text-gray-500">
          {ATTENDANCE_TEST_SCENARIOS.find((s) => s.id === form.scenario)?.hint}
        </p>

        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={form.replaceExisting}
            onChange={(e) => setForm((f) => ({ ...f, replaceExisting: e.target.checked }))}
          />
          Replace existing punches for this month (recommended)
        </label>

        {!compact && (
          <label className="block text-sm">
            <span className="font-medium text-gray-700">Holiday dates (optional, YYYY-MM-DD per line)</span>
            <textarea
              rows={2}
              className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 font-mono text-xs"
              placeholder="2026-01-26"
              value={form.holidayDates}
              onChange={(e) => setForm((f) => ({ ...f, holidayDates: e.target.value }))}
            />
          </label>
        )}

        <div>
          <div className="mb-2 flex items-center justify-between">
            <span className="flex items-center gap-1 text-sm font-medium text-gray-700">
              <Users size={16} /> Employees ({selectedCount} selected)
            </span>
            {eligibleEmployees.length > 0 && (
              <label className="flex items-center gap-2 text-sm text-gray-600">
                <input
                  type="checkbox"
                  checked={form.allEmployees}
                  onChange={(e) => setForm((f) => ({
                    ...f,
                    allEmployees: e.target.checked,
                    employeeIds: e.target.checked ? [] : f.employeeIds,
                  }))}
                />
                All active with shift
              </label>
            )}
          </div>
          {loadingEmployees ? (
            <p className="text-sm text-gray-500">Loading employees…</p>
          ) : employees.length === 0 ? (
            <p className="text-sm text-amber-700">No active employees found.</p>
          ) : eligibleEmployees.length === 0 ? (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
              No employees have a shift assigned.{' '}
              <Link to="/hr/operations/shifts" className="font-semibold text-violet-700 underline">
                Assign shifts
              </Link>{' '}
              first.
            </div>
          ) : (
            <div className={`overflow-y-auto rounded-lg border border-gray-200 divide-y ${compact ? 'max-h-36' : 'max-h-48'}`}>
              {eligibleEmployees.map((emp) => (
                <label
                  key={emp.id}
                  className="flex cursor-pointer items-center gap-3 px-3 py-2 text-sm hover:bg-gray-50"
                >
                  <input
                    type="checkbox"
                    disabled={form.allEmployees}
                    checked={form.allEmployees || form.employeeIds.includes(emp.id)}
                    onChange={() => toggleEmployee(emp.id)}
                  />
                  <span className="font-medium text-gray-800">{emp.employee_id}</span>
                  <span className="truncate text-gray-700">{emp.name}</span>
                  {(emp.date_of_joining || emp.joining_date) && (
                    <span className="hidden text-xs text-gray-400 sm:inline">
                      joined {(emp.date_of_joining || emp.joining_date).slice(0, 10)}
                    </span>
                  )}
                  {emp.shift_name && (
                    <span className="ml-auto shrink-0 rounded-full bg-indigo-50 px-2 py-0.5 text-xs font-medium text-indigo-600">
                      {emp.shift_name}
                    </span>
                  )}
                </label>
              ))}
              {ineligibleEmployees.map((emp) => (
                <label
                  key={emp.id}
                  className="flex cursor-not-allowed items-center gap-3 bg-gray-50/50 px-3 py-2 text-sm opacity-60"
                >
                  <input type="checkbox" disabled checked={false} />
                  <span className="font-medium text-gray-500">{emp.employee_id}</span>
                  <span className="text-gray-500">{emp.name}</span>
                  <span className="ml-auto text-xs text-amber-700">No shift</span>
                </label>
              ))}
            </div>
          )}
        </div>

        <button
          type="submit"
          disabled={submitting || selectedCount === 0}
          className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold text-white disabled:opacity-50 ${
            compact ? 'bg-indigo-600 hover:bg-indigo-700' : 'bg-indigo-600 hover:bg-indigo-700'
          }`}
        >
          {submitting ? <RefreshCw size={16} className="animate-spin" /> : <Calendar size={16} />}
          {submitting ? 'Generating…' : 'Generate full month attendance'}
        </button>
      </form>

      {result?.success && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50/80 p-4">
          <h3 className="text-sm font-semibold text-emerald-900">Done — {result.month}</h3>
          <p className="mt-1 text-xs text-emerald-800">
            Scenario: {result.scenario} · Employees: {result.employees_processed ?? 0}
          </p>
          <dl className={`mt-3 grid gap-2 text-sm ${compact ? 'grid-cols-2 sm:grid-cols-4' : 'grid-cols-2 sm:grid-cols-4'}`}>
            {GENERATION_SUMMARY_METRICS.map(([label, key]) => (
              <div key={label} className="rounded-lg bg-white/80 px-2 py-1.5 ring-1 ring-emerald-100">
                <dt className="text-[10px] text-gray-500">{label}</dt>
                <dd className="text-base font-semibold text-gray-900">{result[key] ?? 0}</dd>
              </div>
            ))}
          </dl>
          {result.employees_skipped?.length > 0 && (
            <p className="mt-2 text-xs text-amber-800">
              Skipped: {result.employees_skipped.map((s) => `${s.employee_id} (${s.reason})`).join(', ')}
            </p>
          )}
          <p className="mt-2 text-xs text-gray-600">
            Next: run payroll on{' '}
            <Link
              to={withJourneyCenterReturn(payrollRunsRoute(result.month))}
              className="font-semibold text-violet-700 underline"
            >
              Payroll Runs
            </Link>
            .
          </p>
        </div>
      )}
    </div>
  );
}
