import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import api, { payrollApi } from '../../api';
import toast from 'react-hot-toast';
import { Users, Search, RefreshCw, UserPlus, X } from 'lucide-react';
import { normalizeApiList } from '../../hr/recruitmentLifecycle';
import { TableSkeleton } from '../../components/HR/HRSkeleton';
import JourneyJobFilter from './JourneyJobFilter';
import { normalizePayrollList } from './payroll/payrollUtils';
import {
  buildPayrollReadyEmployeeIds,
  employeePassesHealthFilter,
  healthFilterLabel,
  readHealthFilter,
} from './healthFilterUtils';

function normalizeList(data) {
  return normalizeApiList(data);
}

const DIRECTORY_STATUSES = new Set(['active']);
const PAYROLL_HEALTH_FILTERS = new Set(['missing_salary', 'payroll_eligible', 'payroll_not_eligible']);

export default function EmployeeDirectoryPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const healthFilter = readHealthFilter(searchParams);
  const jobOpening = searchParams.get('job_opening') || '';
  const [employees, setEmployees] = useState([]);
  const [structures, setStructures] = useState([]);
  const [compensationAssignments, setCompensationAssignments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    const empParams = { limit: 500 };
    if (jobOpening) empParams.job_opening = jobOpening;
    const requests = [api.get('/hr/employees/', { params: empParams }).then((r) => r.data)];
    if (PAYROLL_HEALTH_FILTERS.has(healthFilter)) {
      requests.push(
        payrollApi.get('/structures/', { params: { active: 'true' } }).then((r) => r.data),
        payrollApi.get('/compensation-assignments/', { params: { active: 'true' } }).then((r) => r.data),
      );
    }
    const settled = await Promise.allSettled(requests);
    if (settled[0].status === 'fulfilled') {
      setEmployees(normalizeList(settled[0].value));
    } else {
      setEmployees([]);
      toast.error('Failed to load employees');
    }
    if (PAYROLL_HEALTH_FILTERS.has(healthFilter)) {
      if (settled[1]?.status === 'fulfilled') {
        setStructures(normalizePayrollList(settled[1].value));
      } else {
        setStructures([]);
        toast.error('Failed to load salary structures for filter');
      }
      if (settled[2]?.status === 'fulfilled') {
        setCompensationAssignments(normalizePayrollList(settled[2].value));
      } else {
        setCompensationAssignments([]);
      }
    } else {
      setStructures([]);
      setCompensationAssignments([]);
    }
    setLoading(false);
  }, [healthFilter, jobOpening]);

  useEffect(() => {
    load();
  }, [load]);

  const structureEmployeeIds = useMemo(
    () => buildPayrollReadyEmployeeIds(structures, compensationAssignments),
    [structures, compensationAssignments],
  );

  const directoryRows = useMemo(
    () => employees.filter((e) => DIRECTORY_STATUSES.has(e.status)),
    [employees],
  );

  const healthFilteredRows = useMemo(() => {
    if (!healthFilter) return directoryRows;
    return directoryRows.filter((emp) => employeePassesHealthFilter(emp, healthFilter, {
      structureEmployeeIds,
    }));
  }, [directoryRows, healthFilter, structureEmployeeIds]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return healthFilteredRows;
    return healthFilteredRows.filter((e) =>
      (e.name && e.name.toLowerCase().includes(q))
    || (e.employee_id && e.employee_id.toLowerCase().includes(q))
    || (e.email && e.email.toLowerCase().includes(q))
    || (e.job_title && e.job_title.toLowerCase().includes(q)),
    );
  }, [healthFilteredRows, search]);

  function clearHealthFilter() {
    setSearchParams({});
  }

  function handleJobChange(nextJobId) {
    const params = new URLSearchParams(searchParams);
    if (nextJobId) params.set('job_opening', nextJobId);
    else params.delete('job_opening');
    setSearchParams(params, { replace: true });
  }

  return (
    <div className="max-w-7xl mx-auto space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-800">Employee directory</h2>
          <p className="text-sm text-gray-600">
            Active employees only. People still in onboarding appear under Joining &amp; onboarding until HR activates them.
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-2 self-start">
          <JourneyJobFilter value={jobOpening} onChange={handleJobChange} />
          <Link
            to="/hr/employees/create"
            className="inline-flex items-center gap-2 rounded-lg bg-purple-600 px-3 py-2 text-xs font-semibold text-white shadow-sm hover:bg-purple-700"
          >
            <UserPlus size={14} />
            + Add Employee
          </Link>
          <button
            type="button"
            onClick={load}
            className="inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs font-semibold text-gray-700 shadow-sm hover:bg-gray-50"
          >
            <RefreshCw size={14} />
            Refresh
          </button>
        </div>
      </div>

      {healthFilter && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-violet-200 bg-violet-50 px-3 py-2 text-sm text-violet-900">
          <span>
            Showing: <strong>{healthFilterLabel(healthFilter)}</strong>
          </span>
          <button
            type="button"
            onClick={clearHealthFilter}
            className="inline-flex items-center gap-1 rounded-lg border border-violet-200 bg-white px-2 py-1 text-xs font-semibold text-violet-800 hover:bg-violet-100"
          >
            <X size={12} />
            Clear filter
          </button>
        </div>
      )}

      <div className="relative max-w-md">
        <Search className="absolute left-3 top-2.5 h-4 w-4 text-gray-400" />
        <input
          className="w-full rounded-xl border border-gray-200 py-2 pl-9 pr-3 text-sm focus:border-purple-500 focus:outline-none focus:ring-2 focus:ring-purple-100"
          placeholder="Search employees…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
        {loading ? (
          <TableSkeleton rows={8} cols={6} />
        ) : directoryRows.length === 0 ? (
          <div className="p-10 text-center text-gray-500">
            <Users className="mx-auto mb-2 h-10 w-10 text-gray-300" />
            <p className="font-medium text-gray-800">No active employees</p>
            <p className="mt-1 text-sm">When staff finish onboarding and are activated, they appear here. Pending joiners stay under Joining &amp; onboarding.</p>
          </div>
        ) : healthFilteredRows.length === 0 ? (
          <div className="p-10 text-center text-gray-500">
            <Users className="mx-auto mb-2 h-10 w-10 text-gray-300" />
            No active employees match this health filter.
          </div>
        ) : filtered.length === 0 ? (
          <div className="p-10 text-center text-gray-500">
            <Users className="mx-auto mb-2 h-10 w-10 text-gray-300" />
            No active employees match your search.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead className="border-b border-gray-100 bg-gray-50 text-xs font-semibold uppercase tracking-wide text-gray-500">
                <tr>
                  <th className="px-4 py-3">Name</th>
                  <th className="px-4 py-3">ID</th>
                  <th className="px-4 py-3">Role</th>
                  <th className="px-4 py-3">Department</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3 text-right">Open</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filtered.map((e) => (
                  <tr key={e.id} className="hover:bg-gray-50/80">
                    <td className="px-4 py-3">
                      <div className="font-medium text-gray-900">{e.name}</div>
                      <div className="text-xs text-gray-500">{e.email || '—'}</div>
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-gray-700">{e.employee_id || '—'}</td>
                    <td className="px-4 py-3 text-gray-700">{e.job_title || e.role_name || '—'}</td>
                    <td className="px-4 py-3 text-gray-700">{e.department || e.department_name || '—'}</td>
                    <td className="px-4 py-3">
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-800">
                        {e.status_display || e.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Link
                        to={`/hr/employees/${e.id}`}
                        className="text-sm font-semibold text-purple-600 hover:text-purple-800"
                      >
                        View
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
