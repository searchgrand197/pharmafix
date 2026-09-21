import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import { Archive, RefreshCw, Search } from 'lucide-react';
import api from '../../api';
import { normalizeApiList } from '../../hr/recruitmentLifecycle';
import { TableSkeleton } from '../../components/HR/HRSkeleton';
import {
  EXITED_EMPLOYEE_STATUSES,
  EXIT_REASON_OPTIONS,
  exitReasonLabel,
} from './employeeExitUtils';

function formatDate(iso) {
  if (!iso) return '—';
  try {
    return new Date(`${String(iso).slice(0, 10)}T12:00:00`).toLocaleDateString('en-IN', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
  } catch {
    return iso;
  }
}

function normalizeList(data) {
  return normalizeApiList(data);
}

export default function InactiveEmployeeDirectoryPage() {
  const [employees, setEmployees] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [exitReasonFilter, setExitReasonFilter] = useState('all');
  const [departmentFilter, setDepartmentFilter] = useState('all');
  const [relievingFrom, setRelievingFrom] = useState('');
  const [relievingTo, setRelievingTo] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get('/hr/employees/', {
        params: { statuses: 'inactive,terminated', limit: 500 },
      });
      const rows = normalizeList(data).filter((employee) => EXITED_EMPLOYEE_STATUSES.has(employee.status));
      setEmployees(rows);
    } catch {
      setEmployees([]);
      toast.error('Failed to load inactive employees');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    document.title = 'Inactive employee archive | HR';
    load();
  }, [load]);

  const departmentOptions = useMemo(() => (
    Array.from(new Set(
      employees
        .map((employee) => employee.department_name || employee.department || '')
        .filter(Boolean),
    )).sort((a, b) => a.localeCompare(b))
  ), [employees]);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return employees.filter((employee) => {
      const department = employee.department_name || employee.department || '';
      const relievingDate = String(employee.relieving_date || '').slice(0, 10);

      if (statusFilter !== 'all' && employee.status !== statusFilter) return false;
      if (exitReasonFilter !== 'all' && employee.exit_reason !== exitReasonFilter) return false;
      if (departmentFilter !== 'all' && department !== departmentFilter) return false;
      if (relievingFrom && (!relievingDate || relievingDate < relievingFrom)) return false;
      if (relievingTo && (!relievingDate || relievingDate > relievingTo)) return false;
      if (!query) return true;

      return (
        (employee.name && employee.name.toLowerCase().includes(query))
        || (employee.employee_id && employee.employee_id.toLowerCase().includes(query))
        || (employee.email && employee.email.toLowerCase().includes(query))
        || (employee.job_title && employee.job_title.toLowerCase().includes(query))
        || (department && department.toLowerCase().includes(query))
      );
    });
  }, [
    departmentFilter,
    employees,
    exitReasonFilter,
    relievingFrom,
    relievingTo,
    search,
    statusFilter,
  ]);

  return (
    <div className="max-w-7xl mx-auto space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-800">Inactive employee archive</h2>
          <p className="text-sm text-gray-600">
            Former employees remain searchable here for audit, payroll, documents, and future restore decisions.
          </p>
        </div>
        <button
          type="button"
          onClick={load}
          className="inline-flex items-center gap-2 self-start rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs font-semibold text-gray-700 shadow-sm hover:bg-gray-50"
        >
          <RefreshCw size={14} />
          Refresh
        </button>
      </div>

      <div className="grid gap-3 rounded-2xl border border-gray-200 bg-white p-4 shadow-sm lg:grid-cols-5">
        <div className="relative lg:col-span-2">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-gray-400" />
          <input
            className="w-full rounded-xl border border-gray-200 py-2 pl-9 pr-3 text-sm focus:border-purple-500 focus:outline-none focus:ring-2 focus:ring-purple-100"
            placeholder="Search inactive employees…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="rounded-xl border border-gray-200 px-3 py-2 text-sm focus:border-purple-500 focus:outline-none focus:ring-2 focus:ring-purple-100"
        >
          <option value="all">All exit statuses</option>
          <option value="inactive">Inactive</option>
          <option value="terminated">Terminated</option>
        </select>
        <select
          value={exitReasonFilter}
          onChange={(e) => setExitReasonFilter(e.target.value)}
          className="rounded-xl border border-gray-200 px-3 py-2 text-sm focus:border-purple-500 focus:outline-none focus:ring-2 focus:ring-purple-100"
        >
          <option value="all">All exit reasons</option>
          {EXIT_REASON_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </select>
        <select
          value={departmentFilter}
          onChange={(e) => setDepartmentFilter(e.target.value)}
          className="rounded-xl border border-gray-200 px-3 py-2 text-sm focus:border-purple-500 focus:outline-none focus:ring-2 focus:ring-purple-100"
        >
          <option value="all">All departments</option>
          {departmentOptions.map((department) => (
            <option key={department} value={department}>{department}</option>
          ))}
        </select>
        <input
          type="date"
          value={relievingFrom}
          onChange={(e) => setRelievingFrom(e.target.value)}
          className="rounded-xl border border-gray-200 px-3 py-2 text-sm focus:border-purple-500 focus:outline-none focus:ring-2 focus:ring-purple-100"
        />
        <input
          type="date"
          value={relievingTo}
          onChange={(e) => setRelievingTo(e.target.value)}
          className="rounded-xl border border-gray-200 px-3 py-2 text-sm focus:border-purple-500 focus:outline-none focus:ring-2 focus:ring-purple-100"
        />
      </div>

      <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
        {loading ? (
          <TableSkeleton rows={8} cols={8} />
        ) : filtered.length === 0 ? (
          <div className="p-10 text-center text-gray-500">
            <Archive className="mx-auto mb-2 h-10 w-10 text-gray-300" />
            <p className="font-medium text-gray-800">No inactive employees found</p>
            <p className="mt-1 text-sm">Former employees will appear here after HR marks them as exited.</p>
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
                  <th className="px-4 py-3">Exit reason</th>
                  <th className="px-4 py-3">Relieving date</th>
                  <th className="px-4 py-3 text-right">Open</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filtered.map((employee) => (
                  <tr key={employee.id} className="hover:bg-gray-50/80">
                    <td className="px-4 py-3">
                      <div className="font-medium text-gray-900">{employee.name}</div>
                      <div className="text-xs text-gray-500">{employee.email || '—'}</div>
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-gray-700">{employee.employee_id || '—'}</td>
                    <td className="px-4 py-3 text-gray-700">{employee.designation_name || employee.job_title || employee.role_name || '—'}</td>
                    <td className="px-4 py-3 text-gray-700">{employee.department_name || employee.department || '—'}</td>
                    <td className="px-4 py-3">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                        employee.status === 'terminated'
                          ? 'bg-red-100 text-red-800'
                          : 'bg-slate-100 text-slate-800'
                      }`}
                      >
                        {employee.status_display || employee.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-700">
                      <div>{employee.exit_reason_display || exitReasonLabel(employee.exit_reason)}</div>
                      {employee.eligible_for_rehire ? (
                        <div className="text-xs text-emerald-700">Eligible for rehire</div>
                      ) : (
                        <div className="text-xs text-slate-500">Not eligible for rehire</div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-gray-700">{formatDate(employee.relieving_date)}</td>
                    <td className="px-4 py-3 text-right">
                      <Link
                        to={`/hr/employees/${employee.id}`}
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
