import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useOutletContext, useParams, useSearchParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { ArrowLeft, ChevronDown, ChevronRight, History, Save, User, Wallet } from 'lucide-react';
import api, { payrollApi } from '../../../api';
import { normalizeApiList } from '../../../hr/recruitmentLifecycle';
import ReusableCard from '../../../components/HR/ReusableCard';
import ReusableTable from '../../../components/HR/ReusableTable';
import { TableSkeleton } from '../../../components/HR/HRSkeleton';
import {
  compensationLevelGross,
  formatCurrency,
  normalizePayrollList,
  payrollErrorText,
} from './payrollUtils';
import { useCompensationLevelsForDesignation } from './useCompensationLevels';

const todayIso = () => new Date().toISOString().slice(0, 10);

function resolveInitialTab(searchParams) {
  const mode = searchParams.get('mode');
  if (mode === 'custom') return 'custom';
  return 'grade';
}

function AmountInput({ label, value, onChange, required }) {
  return (
    <label className="block text-sm">
      <span className="font-medium text-slate-700">
        {label}
        {required ? ' *' : ''}
      </span>
      <div className="relative mt-1">
        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-slate-400">₹</span>
        <input
          type="number"
          step="0.01"
          min="0"
          required={required}
          value={value}
          onChange={onChange}
          className="min-h-[44px] w-full rounded-lg border border-gray-200 py-2.5 pl-7 pr-3 text-sm outline-none focus:border-violet-400"
        />
      </div>
    </label>
  );
}

function grossFromCompensation(compensation) {
  if (!compensation) return 0;
  const allowances = Object.values(compensation.allowances || {}).reduce(
    (sum, value) => sum + (Number(value) || 0),
    0,
  );
  return (Number(compensation.basic_salary) || 0) + (Number(compensation.hra) || 0) + allowances;
}

function customFormFromPreview(preview) {
  const compensation = preview?.compensation;
  if (!compensation) {
    return {
      basic: '',
      hra: '',
      medical: '',
      special_allowance: '',
      overtime_rate: '',
    };
  }
  const allowances = compensation.allowances || {};
  return {
    basic: compensation.basic_salary ?? '',
    hra: compensation.hra ?? '',
    medical: allowances.medical ?? '',
    special_allowance: allowances.special_allowance ?? '',
    overtime_rate: compensation.overtime_rate ?? '',
  };
}

function mergeHistory(assignments, overrides) {
  const rows = [];
  (assignments || []).forEach((row) => {
    rows.push({
      id: `assignment-${row.id}`,
      effective_from: row.effective_from,
      effective_to: row.effective_to,
      type: 'Grade change',
      summary: `${row.compensation_level_name || 'Level'} (${row.compensation_level_code || '—'})`,
      is_active: row.is_active,
      detail: row.designation_name || '—',
    });
  });
  (overrides || []).forEach((row) => {
    const parts = [
      row.basic != null ? `Basic ${formatCurrency(row.basic)}` : null,
      row.hra != null ? `HRA ${formatCurrency(row.hra)}` : null,
    ].filter(Boolean);
    rows.push({
      id: `override-${row.id}`,
      effective_from: row.effective_from,
      effective_to: row.effective_to,
      type: 'Custom pay',
      summary: parts.length ? parts.join(' · ') : 'Custom amounts',
      is_active: row.is_active,
      detail: row.reason || '—',
    });
  });
  return rows.sort((a, b) => String(b.effective_from).localeCompare(String(a.effective_from)));
}

function CompensationPreviewCard({ preview, activeAssignment, loading, onCreateLevels, designationId }) {
  if (loading) {
    return (
      <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-500">
        Loading current pay…
      </div>
    );
  }

  if (!preview?.compensation) {
    return (
      <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
        <p className="font-medium">No pay assigned yet</p>
        <p className="mt-1">
          Choose a pay grade below, or set custom amounts if this employee needs different pay.
        </p>
        {designationId && onCreateLevels ? (
          <button
            type="button"
            onClick={onCreateLevels}
            className="mt-2 font-semibold text-violet-700 underline"
          >
            Create pay grades for this job title
          </button>
        ) : null}
      </div>
    );
  }

  const compensation = preview.compensation;
  const allowances = compensation.allowances || {};
  const hasOverride = Boolean(preview.source?.compensation_override_id);
  const levelLabel = activeAssignment
    ? `${activeAssignment.compensation_level_name || 'Level'} (${activeAssignment.compensation_level_code || '—'})`
    : 'Not assigned';

  return (
    <div className="rounded-xl border border-violet-100 bg-violet-50 p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-violet-700">Current pay</p>
          <p className="mt-1 text-sm text-violet-950">
            Pay grade: <span className="font-semibold">{levelLabel}</span>
          </p>
        </div>
        {hasOverride ? (
          <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-semibold text-amber-900">
            Custom override active
          </span>
        ) : null}
      </div>
      <div className="mt-3 grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-4">
        <div><span className="text-violet-700">Basic:</span> {formatCurrency(compensation.basic_salary)}</div>
        <div><span className="text-violet-700">HRA:</span> {formatCurrency(compensation.hra)}</div>
        <div><span className="text-violet-700">Medical:</span> {formatCurrency(allowances.medical)}</div>
        <div><span className="text-violet-700">Special:</span> {formatCurrency(allowances.special_allowance)}</div>
      </div>
      <p className="mt-3 text-base font-bold text-violet-950">
        Monthly gross: {formatCurrency(grossFromCompensation(compensation))}
      </p>
    </div>
  );
}

function PayGradeCard({ level, selected, onSelect }) {
  const gross = compensationLevelGross(level);
  return (
    <button
      type="button"
      onClick={() => onSelect(level.id)}
      className={`w-full rounded-xl border p-4 text-left transition-colors ${
        selected
          ? 'border-violet-500 bg-violet-50 ring-2 ring-violet-200'
          : 'border-slate-200 bg-white hover:border-violet-200 hover:bg-violet-50/40'
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="font-semibold text-slate-900">{level.name}</p>
          <p className="text-sm text-slate-600">{level.code}</p>
        </div>
        <p className="text-sm font-bold text-violet-700">{formatCurrency(gross)}/mo</p>
      </div>
      {level.is_default_for_designation ? (
        <span className="mt-2 inline-block rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-800">
          Default
        </span>
      ) : null}
      {selected ? (
        <div className="mt-3 grid gap-1 border-t border-violet-100 pt-3 text-xs text-slate-600 sm:grid-cols-2">
          <div>Basic: {formatCurrency(level.basic)}</div>
          <div>HRA: {formatCurrency(level.hra)}</div>
          <div>Medical: {formatCurrency(level.medical)}</div>
          <div>Special: {formatCurrency(level.special_allowance)}</div>
        </div>
      ) : null}
    </button>
  );
}

export default function AssignSalaryStructurePage() {
  const { employeeId: routeEmployeeId } = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { theme = 'purple' } = useOutletContext() || {};

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [employees, setEmployees] = useState([]);
  const [preview, setPreview] = useState(null);
  const [activeAssignment, setActiveAssignment] = useState(null);
  const [history, setHistory] = useState([]);
  const [activeTab, setActiveTab] = useState(() => resolveInitialTab(searchParams));
  const [showMoreOptions, setShowMoreOptions] = useState(false);
  const [employeeId, setEmployeeId] = useState(
    routeEmployeeId || searchParams.get('employee') || '',
  );
  const [effectiveFrom, setEffectiveFrom] = useState(todayIso());
  const [selectedLevelId, setSelectedLevelId] = useState('');
  const [customForm, setCustomForm] = useState({
    basic: '',
    hra: '',
    medical: '',
    special_allowance: '',
    overtime_rate: '',
    reason: '',
  });

  const selectedEmployee = useMemo(
    () => employees.find((row) => row.id === employeeId),
    [employees, employeeId],
  );

  const {
    levels: compensationLevels,
    loading: loadingCompensationLevels,
    defaultLevelId,
  } = useCompensationLevelsForDesignation(selectedEmployee?.designation);

  const selectedLevel = useMemo(
    () => compensationLevels.find((row) => String(row.id) === String(selectedLevelId)),
    [compensationLevels, selectedLevelId],
  );

  const loadEmployees = useCallback(async () => {
    const { data } = await api.get('/hr/employees/', { params: { status: 'active', limit: 500 } });
    setEmployees(normalizeApiList(data));
  }, []);

  const loadPreview = useCallback(async (id) => {
    if (!id) {
      setPreview(null);
      setActiveAssignment(null);
      return;
    }
    setPreviewLoading(true);
    try {
      const [previewRes, assignmentRes] = await Promise.all([
        payrollApi.get('/compensation/preview/', { params: { employee: id } }),
        payrollApi.get('/compensation-assignments/', { params: { active: 'true', employee: id } }),
      ]);
      setPreview(previewRes.data);
      const assignments = normalizePayrollList(assignmentRes.data);
      setActiveAssignment(assignments[0] || null);
    } catch {
      setPreview(null);
      setActiveAssignment(null);
    } finally {
      setPreviewLoading(false);
    }
  }, []);

  const loadHistory = useCallback(async (id) => {
    if (!id) {
      setHistory([]);
      return;
    }
    try {
      const [assignmentRes, overrideRes] = await Promise.all([
        payrollApi.get('/compensation-assignments/', { params: { employee: id } }),
        payrollApi.get('/compensation-overrides/', { params: { employee: id } }),
      ]);
      const assignments = normalizePayrollList(assignmentRes.data);
      const overrides = normalizePayrollList(overrideRes.data);
      setHistory(mergeHistory(assignments, overrides));
    } catch {
      setHistory([]);
    }
  }, []);

  const refreshEmployeeData = useCallback(async (id) => {
    await Promise.all([loadPreview(id), loadHistory(id)]);
  }, [loadHistory, loadPreview]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      await loadEmployees();
      const id = employeeId || routeEmployeeId || searchParams.get('employee') || '';
      if (id) {
        await refreshEmployeeData(id);
      }
    } catch {
      toast.error('Failed to load employee salary data');
    } finally {
      setLoading(false);
    }
  }, [employeeId, loadEmployees, refreshEmployeeData, routeEmployeeId, searchParams]);

  useEffect(() => {
    document.title = 'Employee Salary | HR Payroll';
    load();
  }, [load]);

  useEffect(() => {
    if (employeeId) {
      refreshEmployeeData(employeeId);
    }
  }, [employeeId, refreshEmployeeData]);

  useEffect(() => {
    setCustomForm({
      basic: '',
      hra: '',
      medical: '',
      special_allowance: '',
      overtime_rate: '',
      reason: '',
    });
    setSelectedLevelId('');
  }, [employeeId]);

  useEffect(() => {
    if (activeTab !== 'grade' || !defaultLevelId) return;
    setSelectedLevelId((prev) => {
      if (prev && compensationLevels.some((row) => String(row.id) === String(prev))) return prev;
      if (activeAssignment?.compensation_level) return String(activeAssignment.compensation_level);
      return defaultLevelId;
    });
  }, [activeTab, activeAssignment, compensationLevels, defaultLevelId]);

  useEffect(() => {
    if (activeTab !== 'custom' || !preview?.compensation) return;
    setCustomForm((prev) => {
      const hasValues = prev.basic || prev.hra || prev.medical || prev.special_allowance;
      if (hasValues) return prev;
      return { ...prev, ...customFormFromPreview(preview) };
    });
  }, [activeTab, preview]);

  async function handleGradeSubmit(e) {
    e.preventDefault();
    if (!employeeId) {
      toast.error('Select an employee');
      return;
    }
    if (!effectiveFrom) {
      toast.error('Effective from date is required');
      return;
    }
    if (!selectedLevelId) {
      toast.error('Select a pay grade');
      return;
    }

    setSaving(true);
    try {
      await payrollApi.post('/compensation-assignments/', {
        employee: employeeId,
        compensation_level: selectedLevelId,
        effective_from: effectiveFrom,
      });
      toast.success(`Pay grade assigned to ${selectedEmployee?.name || 'employee'}`);
      await refreshEmployeeData(employeeId);
    } catch (error) {
      toast.error(payrollErrorText(error, 'Failed to assign pay grade'));
    } finally {
      setSaving(false);
    }
  }

  async function handleCustomSubmit(e) {
    e.preventDefault();
    if (!employeeId) {
      toast.error('Select an employee');
      return;
    }
    if (!effectiveFrom) {
      toast.error('Effective from date is required');
      return;
    }
    if (!activeAssignment && !preview?.source?.compensation_assignment_id) {
      toast.error('Assign a pay grade first before setting custom amounts');
      setActiveTab('grade');
      return;
    }
    if (!customForm.basic) {
      toast.error('Basic salary is required');
      return;
    }

    setSaving(true);
    try {
      await payrollApi.post('/compensation-overrides/', {
        employee: employeeId,
        basic: customForm.basic,
        hra: customForm.hra || '0',
        medical: customForm.medical || '0',
        special_allowance: customForm.special_allowance || '0',
        overtime_rate: customForm.overtime_rate || null,
        effective_from: effectiveFrom,
        reason: customForm.reason || '',
        deactivate_previous: true,
      });
      toast.success(`Custom pay saved for ${selectedEmployee?.name || 'employee'}`);
      await refreshEmployeeData(employeeId);
    } catch (error) {
      toast.error(payrollErrorText(error, 'Failed to save custom pay'));
    } finally {
      setSaving(false);
    }
  }

  const historyColumns = [
    { header: 'Effective from', accessor: 'effective_from' },
    { header: 'Type', accessor: 'type' },
    { header: 'Summary', accessor: 'summary' },
    { header: 'Detail', render: (row) => row.detail || '—' },
    { header: 'Effective to', render: (row) => row.effective_to || '—' },
    {
      header: 'Status',
      render: (row) => (
        <span
          className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
            row.is_active ? 'bg-emerald-100 text-emerald-800' : 'bg-gray-100 text-gray-600'
          }`}
        >
          {row.is_active ? 'Active' : 'Historical'}
        </span>
      ),
    },
  ];

  const designationLabel = selectedEmployee?.designation_name
    || selectedEmployee?.job_title
    || 'No job title';

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <header>
        <button
          type="button"
          onClick={() => navigate(routeEmployeeId ? `/hr/employees/${routeEmployeeId}` : '/hr/payroll/structures')}
          className="mb-2 inline-flex items-center gap-1 text-sm font-semibold text-purple-600"
        >
          <ArrowLeft size={16} />
          {routeEmployeeId ? 'Back to employee' : 'Back to custom salaries'}
        </button>
        <h1 className="flex items-center gap-2 text-2xl font-bold text-gray-900">
          <User size={24} className="text-purple-600" />
          Employee Salary
        </h1>
        <p className="mt-1 text-sm text-gray-600">
          Set this employee&apos;s pay. Most staff use a pay grade; use custom amounts only when this person needs different pay.
        </p>
      </header>

      <ReusableCard title="Employee" icon={Wallet} theme={theme}>
        {loading ? (
          <TableSkeleton rows={2} cols={2} />
        ) : (
          <div className="space-y-4">
            <label className="block text-sm">
              <span className="mb-1 block font-medium text-gray-700">Employee *</span>
              <select
                required
                value={employeeId}
                onChange={(e) => setEmployeeId(e.target.value)}
                disabled={Boolean(routeEmployeeId)}
                className="min-h-[44px] w-full rounded-lg border border-gray-200 px-3 disabled:bg-gray-50"
              >
                <option value="">Select employee</option>
                {employees.map((emp) => (
                  <option key={emp.id} value={emp.id}>
                    {emp.name} ({emp.employee_id})
                  </option>
                ))}
              </select>
            </label>

            {selectedEmployee ? (
              <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
                <span className="font-medium text-slate-900">{selectedEmployee.name}</span>
                {' · '}
                {selectedEmployee.employee_id}
                {' · '}
                {designationLabel}
              </div>
            ) : null}

            {employeeId ? (
              <CompensationPreviewCard
                preview={preview}
                activeAssignment={activeAssignment}
                loading={previewLoading}
                designationId={selectedEmployee?.designation}
                onCreateLevels={() => navigate(
                  `/hr/payroll/compensation-levels?designation=${selectedEmployee?.designation}`,
                )}
              />
            ) : null}
          </div>
        )}
      </ReusableCard>

      {employeeId && !loading ? (
        <ReusableCard title="Set pay" icon={Wallet} theme={theme}>
          <div className="mb-5 flex gap-2 rounded-xl border border-slate-200 bg-slate-50 p-1">
            <button
              type="button"
              onClick={() => setActiveTab('grade')}
              className={`flex-1 rounded-lg px-3 py-2.5 text-sm font-semibold transition-colors ${
                activeTab === 'grade'
                  ? 'bg-white text-violet-800 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Pay grade
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('custom')}
              className={`flex-1 rounded-lg px-3 py-2.5 text-sm font-semibold transition-colors ${
                activeTab === 'custom'
                  ? 'bg-white text-violet-800 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Custom amounts
            </button>
          </div>

          {activeTab === 'grade' ? (
            <form onSubmit={handleGradeSubmit} className="space-y-5">
              {!selectedEmployee?.designation ? (
                <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                  This employee has no job title.{' '}
                  <Link
                    to={`/hr/employees/${employeeId}`}
                    className="font-semibold text-violet-700 underline"
                  >
                    Update their profile
                  </Link>{' '}
                  before assigning a pay grade.
                </p>
              ) : loadingCompensationLevels ? (
                <p className="text-sm text-slate-500">Loading pay grades…</p>
              ) : compensationLevels.length === 0 ? (
                <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                  No pay grades exist for this job title yet.{' '}
                  <button
                    type="button"
                    onClick={() => navigate(
                      `/hr/payroll/compensation-levels?designation=${selectedEmployee.designation}`,
                    )}
                    className="font-semibold text-violet-700 underline"
                  >
                    Create pay grades
                  </button>
                </p>
              ) : (
                <div className="space-y-3">
                  <p className="text-sm text-slate-600">Select a pay grade for {designationLabel}.</p>
                  <div className="grid gap-3 sm:grid-cols-2">
                    {compensationLevels.map((level) => (
                      <PayGradeCard
                        key={level.id}
                        level={level}
                        selected={String(selectedLevelId) === String(level.id)}
                        onSelect={setSelectedLevelId}
                      />
                    ))}
                  </div>
                  {selectedLevel ? (
                    <p className="text-sm text-slate-600">
                      Selected: <span className="font-semibold text-slate-900">{selectedLevel.name}</span>
                      {' — '}
                      {formatCurrency(compensationLevelGross(selectedLevel))}/month
                    </p>
                  ) : null}
                </div>
              )}

              <label className="block text-sm">
                <span className="mb-1 block font-medium text-gray-700">Effective from *</span>
                <input
                  type="date"
                  required
                  value={effectiveFrom}
                  onChange={(e) => setEffectiveFrom(e.target.value)}
                  className="min-h-[44px] w-full rounded-lg border border-gray-200 px-3"
                />
              </label>

              <button
                type="submit"
                disabled={saving || !selectedEmployee?.designation || compensationLevels.length === 0}
                className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl bg-purple-600 px-4 text-sm font-semibold text-white hover:bg-purple-700 disabled:opacity-60"
              >
                <Save size={16} />
                {saving ? 'Saving…' : 'Save pay grade'}
              </button>
            </form>
          ) : (
            <form onSubmit={handleCustomSubmit} className="space-y-5">
              <p className="text-sm text-slate-600">
                Set different pay for this employee. Amounts below replace the pay grade values for payroll.
              </p>

              {!activeAssignment && !preview?.source?.compensation_assignment_id ? (
                <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                  Assign a pay grade first, then you can customize amounts here.
                </p>
              ) : null}

              <div className="grid gap-4 sm:grid-cols-2">
                <AmountInput
                  label="Basic salary"
                  required
                  value={customForm.basic}
                  onChange={(e) => setCustomForm((f) => ({ ...f, basic: e.target.value }))}
                />
                <AmountInput
                  label="HRA"
                  value={customForm.hra}
                  onChange={(e) => setCustomForm((f) => ({ ...f, hra: e.target.value }))}
                />
                <AmountInput
                  label="Medical allowance"
                  value={customForm.medical}
                  onChange={(e) => setCustomForm((f) => ({ ...f, medical: e.target.value }))}
                />
                <AmountInput
                  label="Special allowance"
                  value={customForm.special_allowance}
                  onChange={(e) => setCustomForm((f) => ({ ...f, special_allowance: e.target.value }))}
                />
              </div>

              <button
                type="button"
                onClick={() => setShowMoreOptions((open) => !open)}
                className="inline-flex items-center gap-1 text-sm font-semibold text-violet-700"
              >
                {showMoreOptions ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                More options
              </button>

              {showMoreOptions ? (
                <AmountInput
                  label="Overtime rate (per hour)"
                  value={customForm.overtime_rate}
                  onChange={(e) => setCustomForm((f) => ({ ...f, overtime_rate: e.target.value }))}
                />
              ) : null}

              <label className="block text-sm">
                <span className="mb-1 block font-medium text-gray-700">Effective from *</span>
                <input
                  type="date"
                  required
                  value={effectiveFrom}
                  onChange={(e) => setEffectiveFrom(e.target.value)}
                  className="min-h-[44px] w-full rounded-lg border border-gray-200 px-3"
                />
              </label>

              <label className="block text-sm">
                <span className="mb-1 block font-medium text-gray-700">Reason (optional)</span>
                <textarea
                  value={customForm.reason}
                  onChange={(e) => setCustomForm((f) => ({ ...f, reason: e.target.value }))}
                  rows={2}
                  className="w-full rounded-lg border border-gray-200 px-3 py-2"
                  placeholder="e.g. Senior hire, special HRA agreement"
                />
              </label>

              <button
                type="submit"
                disabled={saving}
                className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl bg-purple-600 px-4 text-sm font-semibold text-white hover:bg-purple-700 disabled:opacity-60"
              >
                <Save size={16} />
                {saving ? 'Saving…' : 'Save custom pay'}
              </button>
            </form>
          )}
        </ReusableCard>
      ) : null}

      {employeeId ? (
        <ReusableCard
          title={`Pay history — ${selectedEmployee?.name || 'Employee'}`}
          icon={History}
          subtitle={`${history.length} record(s)`}
          theme={theme}
        >
          {history.length === 0 ? (
            <p className="text-sm text-gray-500">No pay changes recorded yet.</p>
          ) : (
            <ReusableTable columns={historyColumns} data={history} />
          )}
        </ReusableCard>
      ) : null}
    </div>
  );
}
