import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import api from '../../api';
import toast from 'react-hot-toast';
import { CalendarClock, ChevronRight, Plus, Power, Users } from 'lucide-react';
import { isFromSetupWizard, withPreservedReturn } from './setupWizardUtils';
import { normalizeApiList } from '../../hr/recruitmentLifecycle';
import { TableSkeleton } from '../../components/HR/HRSkeleton';
import SetupWizardNav from '../../components/HR/SetupWizardNav';
import { formatShiftRange12h } from '../../utils/timeDisplay';
import { errorText } from './shiftUtils';
import {
  buildAssignedEmployeeIds,
  employeeMissingShift,
  healthFilterLabel,
  readHealthFilter,
} from './healthFilterUtils';

export default function ShiftManagementPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const healthFilter = readHealthFilter(searchParams);
  const fromSetupWizard = isFromSetupWizard(searchParams);
  const shiftRoute = (path) => withPreservedReturn(path, searchParams);

  const [loading, setLoading] = useState(true);
  const [shifts, setShifts] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [assignments, setAssignments] = useState([]);
  const [assignmentForm, setAssignmentForm] = useState({
    employee: '',
    shift: '',
    effective_from: new Date().toISOString().slice(0, 10),
  });
  const [assigning, setAssigning] = useState(false);

  const activeShifts = useMemo(() => shifts.filter((shift) => shift.active), [shifts]);
  const employeeOptions = useMemo(
    () => employees.filter((emp) => emp.status === 'active' || emp.status === 'pending_onboarding'),
    [employees],
  );
  const assignedEmployeeIds = useMemo(
    () => buildAssignedEmployeeIds(assignments),
    [assignments],
  );
  const unassignedCount = useMemo(
    () => employeeOptions.filter(
      (emp) => emp.status === 'active' && employeeMissingShift(emp, assignedEmployeeIds),
    ).length,
    [assignedEmployeeIds, employeeOptions],
  );
  const filteredEmployeeOptions = useMemo(() => {
    if (healthFilter !== 'missing_shift') return employeeOptions;
    return employeeOptions.filter(
      (emp) => emp.status === 'active' && employeeMissingShift(emp, assignedEmployeeIds),
    );
  }, [assignedEmployeeIds, employeeOptions, healthFilter]);

  const load = useCallback(async () => {
    setLoading(true);
    const settled = await Promise.allSettled([
      api.get('/hr/shifts/', { params: { limit: 500 } }).then((res) => res.data),
      ...(fromSetupWizard ? [] : [
        api.get('/hr/employees/', { params: { limit: 1000 } }).then((res) => res.data),
        api.get('/hr/employee-shifts/', { params: { limit: 1000, is_primary: true } }).then((res) => res.data),
      ]),
    ]);

    if (settled[0].status === 'fulfilled') setShifts(normalizeApiList(settled[0].value));
    else toast.error('Could not load shifts');

    if (!fromSetupWizard) {
      if (settled[1].status === 'fulfilled') setEmployees(normalizeApiList(settled[1].value));
      if (settled[2].status === 'fulfilled') setAssignments(normalizeApiList(settled[2].value));
    }

    setLoading(false);
  }, [fromSetupWizard]);

  useEffect(() => {
    document.title = 'Shifts | HR';
    load();
  }, [load]);

  async function toggleShift(shift) {
    try {
      const action = shift.active ? 'deactivate' : 'activate';
      await api.post(`/hr/shifts/${shift.id}/${action}/`);
      toast.success(shift.active ? 'Shift turned off' : 'Shift turned on');
      await load();
    } catch (error) {
      toast.error(errorText(error, 'Could not update shift'));
    }
  }

  async function assignShift(event) {
    event.preventDefault();
    if (!assignmentForm.employee || !assignmentForm.shift) {
      toast.error('Choose an employee and a shift');
      return;
    }
    setAssigning(true);
    try {
      await api.post('/hr/employee-shifts/', {
        ...assignmentForm,
        effective_to: null,
      });
      toast.success('Shift assigned');
      setAssignmentForm((prev) => ({ ...prev, employee: '', shift: '' }));
      await load();
    } catch (error) {
      toast.error(errorText(error, 'Could not assign shift'));
    } finally {
      setAssigning(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-5 pb-12">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold text-slate-900">
            <CalendarClock className="text-violet-600" size={24} />
            Work shifts
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            {fromSetupWizard
              ? 'Define office hours for your hospital.'
              : 'Define office hours, then assign each employee to a shift for attendance.'}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {!loading && shifts.length > 0 && (
            <Link
              to={shiftRoute('/hr/operations/shifts/new')}
              className="inline-flex items-center gap-1.5 rounded-xl bg-violet-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-violet-700"
            >
              <Plus size={16} />
              Create shift
            </Link>
          )}
        </div>
      </div>

      {!fromSetupWizard && healthFilter === 'missing_shift' && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-violet-200 bg-violet-50 px-3 py-2 text-sm text-violet-900">
          <span>
            Showing: <strong>{healthFilterLabel(healthFilter)}</strong>
          </span>
          <button
            type="button"
            onClick={() => setSearchParams(fromSetupWizard ? { from: 'setup-wizard' } : {})}
            className="rounded-lg border border-violet-200 bg-white px-2 py-1 text-xs font-semibold text-violet-800 hover:bg-violet-100"
          >
            Clear filter
          </button>
        </div>
      )}

      {!fromSetupWizard && unassignedCount > 0 && (
        <div className="rounded-xl border border-amber-100 bg-amber-50 px-4 py-3 text-sm text-amber-950">
          <span className="font-semibold">{unassignedCount}</span> active employee{unassignedCount === 1 ? '' : 's'} still need a shift assigned.
        </div>
      )}

      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-100 px-4 py-3">
          <h2 className="text-sm font-semibold text-slate-900">Your shifts ({shifts.length})</h2>
        </div>

        {loading ? (
          <div className="p-4">
            <TableSkeleton rows={3} cols={2} />
          </div>
        ) : shifts.length === 0 ? (
          <div className="px-6 py-12 text-center">
            <CalendarClock className="mx-auto h-10 w-10 text-slate-300" />
            <p className="mt-3 font-medium text-slate-800">No shifts yet</p>
            <p className="mt-1 text-sm text-slate-500">
              Add a name and check-in / check-out times for your first shift.
            </p>
            <Link
              to={shiftRoute('/hr/operations/shifts/new')}
              className="mt-4 inline-flex items-center gap-2 rounded-xl bg-violet-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-violet-700"
            >
              <Plus size={16} />
              Create your first shift
            </Link>
          </div>
        ) : (
          <ul className="divide-y divide-slate-100">
            {shifts.map((shift) => (
              <li
                key={shift.id}
                className={`flex items-center gap-3 border-l-4 px-4 py-3 ${
                  shift.active
                    ? 'border-l-emerald-400 hover:bg-slate-50'
                    : 'border-l-slate-300 bg-slate-50/80'
                }`}
              >
                <button
                  type="button"
                  onClick={() => navigate(shiftRoute(`/hr/operations/shifts/${shift.id}/edit`))}
                  className="min-w-0 flex-1 text-left"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-semibold text-slate-900">{shift.name}</p>
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                        shift.active
                          ? 'bg-emerald-100 text-emerald-800'
                          : 'bg-slate-100 text-slate-600'
                      }`}
                    >
                      {shift.active ? 'Active' : 'Inactive'}
                    </span>
                  </div>
                  <p className="text-sm text-slate-600">
                    {formatShiftRange12h(shift.start_time, shift.end_time)}
                    {!fromSetupWizard && (
                      <>
                        <span className="text-slate-300"> · </span>
                        {shift.employee_count || 0} assigned
                      </>
                    )}
                  </p>
                </button>
                <button
                  type="button"
                  onClick={() => toggleShift(shift)}
                  className={`inline-flex shrink-0 items-center gap-1 rounded-lg border px-3 py-1.5 text-xs font-semibold ${
                    shift.active
                      ? 'border-amber-200 text-amber-800 hover:bg-amber-50'
                      : 'border-emerald-200 text-emerald-800 hover:bg-emerald-50'
                  }`}
                >
                  <Power size={14} />
                  {shift.active ? 'Deactivate' : 'Activate'}
                </button>
                <ChevronRight size={16} className="shrink-0 text-slate-300" />
              </li>
            ))}
          </ul>
        )}
      </section>

      {!fromSetupWizard && activeShifts.length > 0 && (
        <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex items-center gap-2">
            <Users className="text-violet-600" size={18} />
            <h2 className="text-sm font-semibold text-slate-900">Assign employee to shift</h2>
          </div>
          <p className="mt-1 text-xs text-slate-500">
            Each employee needs a shift so attendance knows their expected check-in time.
          </p>

          <form onSubmit={assignShift} className="mt-4 space-y-3">
            <select
              className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-violet-400"
              value={assignmentForm.employee}
              onChange={(e) => setAssignmentForm((f) => ({ ...f, employee: e.target.value }))}
            >
              <option value="">Select employee</option>
              {filteredEmployeeOptions.map((emp) => (
                <option key={emp.id} value={emp.id}>
                  {emp.name} ({emp.employee_id})
                </option>
              ))}
            </select>
            <select
              className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-violet-400"
              value={assignmentForm.shift}
              onChange={(e) => setAssignmentForm((f) => ({ ...f, shift: e.target.value }))}
            >
              <option value="">Select shift</option>
              {activeShifts.map((shift) => (
                <option key={shift.id} value={shift.id}>
                  {shift.name} — {formatShiftRange12h(shift.start_time, shift.end_time)}
                </option>
              ))}
            </select>
            <button
              type="submit"
              disabled={assigning}
              className="w-full rounded-xl bg-slate-900 py-2.5 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
            >
              {assigning ? 'Assigning…' : 'Assign shift'}
            </button>
          </form>

          {assignments.length > 0 && (
            <div className="mt-4 border-t border-slate-100 pt-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Recent assignments</p>
              <ul className="mt-2 max-h-40 space-y-1 overflow-y-auto text-sm">
                {assignments.slice(0, 10).map((row) => (
                  <li key={row.id} className="text-slate-700">
                    <span className="font-medium text-slate-900">{row.employee_name}</span>
                    <span className="text-slate-500"> → {row.shift_name}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}

      <SetupWizardNav className="border-t border-slate-100 pt-4" />
    </div>
  );
}
