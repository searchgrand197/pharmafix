import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import api from '../../../api';
import toast from 'react-hot-toast';
import {
  Calendar,
  ChevronRight,
  Plus,
  RefreshCw,
  Save,
  Search,
} from 'lucide-react';
import { TableSkeleton } from '../../../components/HR/HRSkeleton';
import { BackToEmployeeLink } from '../employeeDetail/EmployeeDetailUi';
import { errorText, formatLeaveDays, groupBalancesByEmployee, normalizeList } from './leaveUtils';
import { healthFilterLabel, readHealthFilter } from '../healthFilterUtils';

function daysLeft(row) {
  if (row.is_unlimited) return 'Unlimited';
  const total = Number(row.total_days) || 0;
  const used = Number(row.used_days) || 0;
  return `${formatLeaveDays(Math.max(0, total - used))} left`;
}

function remainingDays(row) {
  if (row.is_unlimited) return Infinity;
  const total = Number(row.total_days) || 0;
  const used = Number(row.used_days) || 0;
  return Math.max(0, total - used);
}

function isLowBalance(row) {
  if (row.is_unlimited) return false;
  const remaining = remainingDays(row);
  const total = Number(row.total_days) || 0;
  if (total <= 0) return remaining <= 0;
  return remaining <= 2 || remaining / total <= 0.2;
}

function employeeHasLowBalance(rows = []) {
  return rows.some(isLowBalance);
}

const blankCreateForm = {
  employee: '',
  leave_type: '',
  total_days: '',
  is_unlimited: false,
};

export default function LeaveBalancesPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const healthFilter = readHealthFilter(searchParams);

  const [loading, setLoading] = useState(true);
  const [balances, setBalances] = useState([]);
  const [activeEmployees, setActiveEmployees] = useState([]);
  const [leaveTypes, setLeaveTypes] = useState([]);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');
  const [selectedEmployeeId, setSelectedEmployeeId] = useState(null);
  const [creating, setCreating] = useState(false);
  const [createForm, setCreateForm] = useState(blankCreateForm);
  const [editRows, setEditRows] = useState([]);
  const [saving, setSaving] = useState(false);

  const loadBalances = useCallback(async () => {
    setLoading(true);
    try {
      const requests = [
        api.get('/hr/leave-balances/').then((r) => r.data),
        api.get('/hr/employees/', { params: { limit: 500 } }).then((r) => r.data),
        api.get('/hr/leave-types/', { params: { active: 'true' } }).then((r) => r.data),
      ];
      const settled = await Promise.allSettled(requests);

      if (settled[0].status === 'fulfilled') {
        setBalances(normalizeList(settled[0].value));
      } else {
        setBalances([]);
        toast.error('Could not load leave balances');
      }

      if (settled[1].status === 'fulfilled') {
        setActiveEmployees(normalizeList(settled[1].value).filter((emp) => emp.status === 'active'));
      } else {
        setActiveEmployees([]);
      }

      if (settled[2].status === 'fulfilled') {
        setLeaveTypes(normalizeList(settled[2].value));
      } else {
        setLeaveTypes([]);
      }
    } catch {
      setBalances([]);
      setActiveEmployees([]);
      toast.error('Could not load leave balances');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    document.title = 'Leave Balances | HR';
    loadBalances();
  }, [loadBalances]);

  useEffect(() => {
    if (healthFilter === 'missing_policy') setFilter('missing_policy');
  }, [healthFilter]);

  const employees = useMemo(() => groupBalancesByEmployee(balances), [balances]);

  const missingPolicyEmployees = useMemo(() => {
    const balanceIds = new Set(balances.map((row) => String(row.employee)));
    return activeEmployees.filter((emp) => !balanceIds.has(String(emp.id)));
  }, [activeEmployees, balances]);

  const stats = useMemo(() => ({
    employees: employees.length,
    low: employees.filter((emp) => employeeHasLowBalance(emp.rows)).length,
    missing: missingPolicyEmployees.length,
    types: leaveTypes.length,
  }), [employees, missingPolicyEmployees.length, leaveTypes.length]);

  const filteredEmployees = useMemo(() => {
    const q = search.trim().toLowerCase();

    if (filter === 'missing_policy' || healthFilter === 'missing_policy') {
      return missingPolicyEmployees
        .filter((emp) => {
          if (!q) return true;
          return (emp.name || '').toLowerCase().includes(q)
            || (emp.employee_id || '').toLowerCase().includes(q);
        })
        .map((emp) => ({
          employeeId: emp.id,
          name: emp.name,
          employeeCode: emp.employee_id,
          rows: [],
          missing: true,
        }));
    }

    return employees.filter((emp) => {
      if (filter === 'low' && !employeeHasLowBalance(emp.rows)) return false;
      if (!q) return true;
      return (emp.name || '').toLowerCase().includes(q)
        || (emp.employeeCode || '').toLowerCase().includes(q);
    });
  }, [employees, filter, healthFilter, missingPolicyEmployees, search]);

  const selectedEmployee = useMemo(
    () => filteredEmployees.find((emp) => emp.employeeId === selectedEmployeeId)
      || employees.find((emp) => emp.employeeId === selectedEmployeeId)
      || null,
    [employees, filteredEmployees, selectedEmployeeId],
  );

  useEffect(() => {
    setSelectedEmployeeId(null);
    setCreating(false);
  }, [filter, search, healthFilter]);

  useEffect(() => {
    if (loading || creating || selectedEmployeeId) return;
    if (filteredEmployees[0]) setSelectedEmployeeId(filteredEmployees[0].employeeId);
  }, [creating, filteredEmployees, loading, selectedEmployeeId]);

  useEffect(() => {
    if (creating || !selectedEmployee || selectedEmployee.missing) {
      setEditRows([]);
      return;
    }
    setEditRows(selectedEmployee.rows.map((row) => ({ ...row })));
  }, [creating, selectedEmployee]);

  function startCreate(employeeId = '') {
    setCreating(true);
    setSelectedEmployeeId(null);
    setCreateForm({
      ...blankCreateForm,
      employee: employeeId || '',
    });
  }

  function selectEmployee(employeeId) {
    setCreating(false);
    setSelectedEmployeeId(employeeId);
  }

  function changeEditRow(rowId, patch) {
    setEditRows((rows) => rows.map((row) => (row.id === rowId ? { ...row, ...patch } : row)));
  }

  async function saveEdit() {
    if (!editRows.length) return;
    setSaving(true);
    try {
      await Promise.all(
        editRows.map((row) => api.patch(`/hr/leave-balances/${row.id}/`, {
          total_days: row.total_days,
          used_days: row.used_days,
          is_unlimited: row.is_unlimited,
        })),
      );
      toast.success('Leave updated');
      await loadBalances();
    } catch (err) {
      toast.error(errorText(err, 'Could not save leave'));
    } finally {
      setSaving(false);
    }
  }

  async function handleCreateLeave(event) {
    event.preventDefault();
    setSaving(true);
    try {
      await api.post('/hr/leave-balances/', {
        employee: createForm.employee,
        leave_type: createForm.leave_type,
        total_days: createForm.is_unlimited ? 0 : createForm.total_days,
        is_unlimited: createForm.is_unlimited,
        used_days: 0,
      });
      toast.success('Leave added to employee');
      setCreating(false);
      setCreateForm(blankCreateForm);
      await loadBalances();
    } catch (err) {
      toast.error(errorText(err, 'Could not add leave'));
    } finally {
      setSaving(false);
    }
  }

  async function handleCreateLeaveType(name) {
    try {
      const { data } = await api.post('/hr/leave-types/', {
        name,
        is_paid: true,
        is_active: true,
      });
      toast.success('Leave type created');
      setLeaveTypes((prev) => [...prev, data]);
      setCreateForm((prev) => ({ ...prev, leave_type: data.id }));
      return data;
    } catch (err) {
      toast.error(errorText(err, 'Could not create leave type'));
      return null;
    }
  }

  const showRightPanel = creating || selectedEmployee;

  return (
    <div className="mx-auto max-w-6xl space-y-5 pb-12">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <BackToEmployeeLink />
          <h1 className="flex items-center gap-2 text-2xl font-bold text-slate-900">
            <Calendar className="text-violet-600" size={24} />
            Leave balances
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            See how many leave days each employee has left.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={loadBalances}
            className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            <RefreshCw size={14} />
            Refresh
          </button>
          <Link
            to="/hr/leave/policies"
            className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Leave policies
          </Link>
          <button
            type="button"
            onClick={() => startCreate()}
            className="inline-flex items-center gap-1.5 rounded-xl bg-violet-600 px-4 py-2 text-sm font-semibold text-white hover:bg-violet-700"
          >
            <Plus size={16} />
            Add leave
          </button>
        </div>
      </div>

      {(healthFilter === 'missing_policy' || filter === 'missing_policy') && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-violet-200 bg-violet-50 px-3 py-2 text-sm text-violet-900">
          <span>
            Showing: <strong>{healthFilterLabel('missing_policy')}</strong>
          </span>
          <button
            type="button"
            onClick={() => {
              setFilter('all');
              setSearchParams({});
            }}
            className="rounded-lg border border-violet-200 bg-white px-2 py-1 text-xs font-semibold text-violet-800 hover:bg-violet-100"
          >
            Clear filter
          </button>
        </div>
      )}

      {loading ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-4">
          <TableSkeleton rows={6} cols={2} />
        </div>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {[
              { id: 'all', label: 'With balances', value: stats.employees, tone: 'bg-slate-50 border-slate-200 text-slate-900' },
              { id: 'low', label: 'Low balance', value: stats.low, tone: 'bg-amber-50 border-amber-200 text-amber-900' },
              { id: 'missing_policy', label: 'No leave set', value: stats.missing, tone: 'bg-rose-50 border-rose-200 text-rose-900' },
              { id: 'types', label: 'Leave types', value: stats.types, tone: 'bg-violet-50 border-violet-200 text-violet-900', static: true },
            ].map((card) => (
              <button
                key={card.id}
                type="button"
                onClick={() => { if (!card.static) setFilter(card.id); }}
                className={`rounded-2xl border px-4 py-3 text-left transition ${
                  !card.static && filter === card.id
                    ? `${card.tone} ring-2 ring-violet-200`
                    : `${card.tone} ${card.static ? '' : 'opacity-90 hover:opacity-100'}`
                }`}
              >
                <p className="text-2xl font-bold">{card.value}</p>
                <p className="mt-0.5 text-sm font-medium">{card.label}</p>
              </button>
            ))}
          </div>

          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
            <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
              <div className="border-b border-slate-100 p-3">
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
                  <input
                    type="search"
                    placeholder="Search employees…"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    className="w-full rounded-xl border border-slate-200 py-2.5 pl-9 pr-3 text-sm outline-none focus:border-violet-400"
                  />
                </div>
              </div>

              {filteredEmployees.length === 0 ? (
                <div className="px-4 py-10 text-center text-sm text-slate-500">
                  {employees.length === 0 && filter !== 'missing_policy' ? (
                    <>
                      <p className="font-medium text-slate-800">No leave balances yet</p>
                      <Link
                        to="/hr/leave/policies"
                        className="mt-2 inline-block font-semibold text-violet-700 hover:underline"
                      >
                        Apply a leave policy first
                      </Link>
                    </>
                  ) : (
                    'No employees match your search or filter.'
                  )}
                </div>
              ) : (
                <ul className="max-h-[32rem] divide-y divide-slate-100 overflow-y-auto">
                  {filteredEmployees.map((emp) => {
                    const selected = selectedEmployeeId === emp.employeeId && !creating;
                    const low = employeeHasLowBalance(emp.rows);
                    return (
                      <li key={emp.employeeId}>
                        <button
                          type="button"
                          onClick={() => selectEmployee(emp.employeeId)}
                          className={`flex w-full items-center gap-3 px-4 py-3 text-left transition ${
                            selected ? 'bg-violet-50' : 'hover:bg-slate-50'
                          }`}
                        >
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <p className="font-semibold text-slate-900">{emp.name || '—'}</p>
                              {emp.missing && (
                                <span className="rounded-full bg-rose-100 px-2 py-0.5 text-xs font-medium text-rose-800">
                                  No leave
                                </span>
                              )}
                              {low && !emp.missing && (
                                <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
                                  Low
                                </span>
                              )}
                            </div>
                            <p className="text-xs text-slate-500">{emp.employeeCode || '—'}</p>
                            <p className="mt-0.5 line-clamp-2 text-sm text-slate-600">
                              {emp.missing
                                ? 'No leave balances provisioned'
                                : emp.rows.map((row) => {
                                    const label = row.leave_type_name || 'Leave';
                                    if (row.is_unlimited) return `${label}: Unlimited`;
                                    return `${label}: ${daysLeft(row)}`;
                                  }).join(' · ')}
                            </p>
                          </div>
                          <ChevronRight size={16} className={`shrink-0 ${selected ? 'text-violet-500' : 'text-slate-300'}`} />
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>

            <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              {!showRightPanel ? (
                <div className="flex min-h-[24rem] flex-col items-center justify-center text-center text-sm text-slate-500">
                  <Calendar className="mb-3 h-10 w-10 text-slate-300" />
                  Select an employee to view or edit leave balances.
                </div>
              ) : creating ? (
                <form onSubmit={handleCreateLeave} className="space-y-4">
                  <div className="border-b border-slate-100 pb-4">
                    <h2 className="text-lg font-bold text-slate-900">Add leave to employee</h2>
                    <p className="mt-1 text-sm text-slate-600">For one-off adjustments outside a policy.</p>
                  </div>

                  <label className="block text-sm">
                    <span className="font-medium text-slate-700">Employee *</span>
                    <select
                      required
                      className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm"
                      value={createForm.employee}
                      onChange={(e) => setCreateForm((f) => ({ ...f, employee: e.target.value }))}
                    >
                      <option value="">Select employee</option>
                      {activeEmployees.map((emp) => (
                        <option key={emp.id} value={emp.id}>
                          {emp.name} ({emp.employee_id})
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="block text-sm">
                    <span className="font-medium text-slate-700">Leave type *</span>
                    <select
                      required
                      className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm"
                      value={createForm.leave_type}
                      onChange={async (e) => {
                        const val = e.target.value;
                        if (val === 'CREATE_NEW') {
                          const name = window.prompt('New leave type name:');
                          if (name?.trim()) await handleCreateLeaveType(name.trim());
                          return;
                        }
                        setCreateForm((f) => ({ ...f, leave_type: val }));
                      }}
                    >
                      <option value="">Select type</option>
                      {leaveTypes.map((type) => (
                        <option key={type.id} value={type.id}>{type.name}</option>
                      ))}
                      <option value="CREATE_NEW">+ Create new type…</option>
                    </select>
                  </label>

                  <label className="flex items-center gap-3 rounded-xl border border-slate-100 bg-slate-50 px-3 py-3 text-sm">
                    <input
                      type="checkbox"
                      checked={createForm.is_unlimited}
                      onChange={(e) => setCreateForm((f) => ({ ...f, is_unlimited: e.target.checked }))}
                      className="h-4 w-4 rounded border-slate-300 text-violet-600"
                    />
                    <span className="font-medium text-slate-800">Unlimited leave</span>
                  </label>

                  {!createForm.is_unlimited && (
                    <label className="block text-sm">
                      <span className="font-medium text-slate-700">Total days *</span>
                      <input
                        type="number"
                        required
                        min="0"
                        step="0.5"
                        className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm"
                        value={createForm.total_days}
                        onChange={(e) => setCreateForm((f) => ({ ...f, total_days: e.target.value }))}
                      />
                    </label>
                  )}

                  <button
                    type="submit"
                    disabled={saving}
                    className="flex w-full min-h-[48px] items-center justify-center gap-2 rounded-xl bg-violet-600 text-sm font-semibold text-white hover:bg-violet-700 disabled:opacity-50"
                  >
                    <Save size={16} />
                    {saving ? 'Saving…' : 'Add leave'}
                  </button>
                </form>
              ) : selectedEmployee?.missing ? (
                <div className="space-y-4">
                  <div className="border-b border-slate-100 pb-4">
                    <h2 className="text-lg font-bold text-slate-900">{selectedEmployee.name}</h2>
                    <p className="text-sm text-slate-600">{selectedEmployee.employeeCode || '—'}</p>
                  </div>
                  <div className="rounded-xl bg-rose-50 px-3 py-3 text-sm text-rose-900">
                    This employee has no leave balances yet.
                  </div>
                  <Link
                    to="/hr/leave/policies"
                    className="flex w-full min-h-[48px] items-center justify-center rounded-xl bg-violet-600 text-sm font-semibold text-white hover:bg-violet-700"
                  >
                    Apply leave policy
                  </Link>
                  <button
                    type="button"
                    onClick={() => startCreate(selectedEmployee.employeeId)}
                    className="flex w-full min-h-[44px] items-center justify-center rounded-xl border border-slate-200 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                  >
                    Add leave manually
                  </button>
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="border-b border-slate-100 pb-4">
                    <h2 className="text-lg font-bold text-slate-900">{selectedEmployee.name}</h2>
                    <p className="text-sm text-slate-600">{selectedEmployee.employeeCode || '—'}</p>
                  </div>

                  <div className="space-y-3">
                    {editRows.map((row) => (
                      <div key={row.id} className="rounded-xl border border-slate-100 bg-slate-50 p-3">
                        <div className="flex items-center justify-between gap-2">
                          <p className="font-semibold text-slate-900">{row.leave_type_name}</p>
                          <span className={`text-sm font-medium ${row.is_unlimited ? 'text-emerald-700' : isLowBalance(row) ? 'text-amber-700' : 'text-slate-700'}`}>
                            {daysLeft(row)}
                          </span>
                        </div>

                        <label className="mt-2 flex items-center gap-2 text-sm text-slate-700">
                          <input
                            type="checkbox"
                            checked={!!row.is_unlimited}
                            onChange={(e) => changeEditRow(row.id, { is_unlimited: e.target.checked })}
                            className="h-4 w-4 rounded border-slate-300 text-violet-600"
                          />
                          Unlimited
                        </label>

                        {!row.is_unlimited && (
                          <div className="mt-2 grid grid-cols-2 gap-2">
                            <label className="text-xs text-slate-600">
                              Allowed days
                              <input
                                type="number"
                                step="0.5"
                                min="0"
                                value={row.total_days}
                                onChange={(e) => changeEditRow(row.id, { total_days: e.target.value })}
                                className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm"
                              />
                            </label>
                            <label className="text-xs text-slate-600">
                              Used days
                              <input
                                type="number"
                                step="0.5"
                                min="0"
                                value={row.used_days}
                                onChange={(e) => changeEditRow(row.id, { used_days: e.target.value })}
                                className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm"
                              />
                            </label>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>

                  <button
                    type="button"
                    onClick={saveEdit}
                    disabled={saving || editRows.length === 0}
                    className="flex w-full min-h-[48px] items-center justify-center gap-2 rounded-xl bg-violet-600 text-sm font-semibold text-white hover:bg-violet-700 disabled:opacity-50"
                  >
                    <Save size={16} />
                    {saving ? 'Saving…' : 'Save changes'}
                  </button>

                  <button
                    type="button"
                    onClick={() => startCreate(selectedEmployee.employeeId)}
                    className="flex w-full min-h-[44px] items-center justify-center gap-2 rounded-xl border border-slate-200 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                  >
                    <Plus size={16} />
                    Add another leave type
                  </button>
                </div>
              )}
            </section>
          </div>
        </>
      )}
    </div>
  );
}
