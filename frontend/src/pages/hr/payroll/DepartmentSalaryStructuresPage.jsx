import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import { Building2, Edit2, Plus, Save, Users, X } from 'lucide-react';
import api, { payrollApi } from '../../../api';
import { normalizeApiList } from '../../../hr/recruitmentLifecycle';
import {
  formatCurrency,
  normalizePayrollList,
  payrollErrorText,
  suggestNextEffectiveFrom,
} from './payrollUtils';
import AttendanceComplianceFields, {
  complianceDefaults,
  complianceFormFromStructure,
  compliancePayloadFromForm,
} from './AttendanceComplianceFields';

const blankForm = {
  department: '',
  designation: '',
  basic_salary: '',
  hra: '0',
  overtime_rate: '100',
  effective_from: new Date().toISOString().slice(0, 10),
  assign_to_employees: true,
  deactivate_previous: true,
  ...complianceDefaults,
};

function computeGross(basic, hra, allowances = {}) {
  const allowanceTotal = Object.values(allowances).reduce((s, v) => s + (Number(v) || 0), 0);
  return (Number(basic) || 0) + (Number(hra) || 0) + allowanceTotal;
}

function formatDate(value) {
  if (!value) return '—';
  return new Date(value).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

function AmountField({ label, hint, value, onChange, required }) {
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
          className="min-h-[44px] w-full rounded-lg border border-slate-200 py-2 pl-7 pr-3 text-sm"
        />
      </div>
      {hint && <p className="mt-1 text-xs text-slate-500">{hint}</p>}
    </label>
  );
}

function SalaryFormModal({
  open,
  saving,
  form,
  departments,
  designations,
  editingFromStructure,
  estimatedGross,
  onClose,
  onChange,
  setForm,
  onSubmit,
}) {
  const [showMore, setShowMore] = useState(false);
  const deptName = departments.find((d) => d.id === form.department)?.name;

  useEffect(() => {
    if (!open) setShowMore(false);
  }, [open]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-3 sm:items-center sm:p-4"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="flex max-h-[90dvh] w-full max-w-lg flex-col overflow-hidden rounded-xl bg-white shadow-lg"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <div className="shrink-0 border-b border-slate-100 px-4 py-3">
          <div className="flex items-start justify-between gap-2">
            <div>
              <h2 className="text-lg font-bold text-slate-900">
                {deptName ? `Salary for ${deptName}` : 'Department salary'}
              </h2>
              <p className="mt-1 text-sm text-slate-600">
                {editingFromStructure
                  ? 'Saving creates a new version from this date — old records stay unchanged.'
                  : 'Monthly pay package for everyone in this department.'}
              </p>
            </div>
            <button type="button" onClick={onClose} className="rounded-lg p-1 text-slate-400 hover:bg-slate-100">
              <X size={18} />
            </button>
          </div>
        </div>

        <form onSubmit={onSubmit} className="flex min-h-0 flex-1 flex-col">
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-3">
            <label className="block text-sm">
              <span className="font-medium text-slate-700">Department *</span>
              <select
                required
                disabled={Boolean(editingFromStructure)}
                value={form.department}
                onChange={(e) => onChange({ department: e.target.value })}
                className="mt-1 min-h-[44px] w-full rounded-lg border border-slate-200 px-3 text-sm disabled:bg-slate-50"
              >
                <option value="">Select department</option>
                {departments.map((dept) => (
                  <option key={dept.id} value={dept.id}>{dept.name}</option>
                ))}
              </select>
            </label>

            <label className="block text-sm">
              <span className="font-medium text-slate-700">Designation (optional)</span>
              <select
                value={form.designation}
                onChange={(e) => onChange({ designation: e.target.value })}
                className="mt-1 min-h-[44px] w-full rounded-lg border border-slate-200 px-3 text-sm"
              >
                <option value="">Any designation in department</option>
                {designations.map((item) => (
                  <option key={item.id} value={item.id}>{item.name}</option>
                ))}
              </select>
            </label>

            <AmountField
              label="Basic salary (per month)"
              required
              value={form.basic_salary}
              onChange={(e) => onChange({ basic_salary: e.target.value })}
            />

            <AmountField
              label="HRA"
              hint="House rent allowance — optional"
              value={form.hra}
              onChange={(e) => onChange({ hra: e.target.value })}
            />

            {form.basic_salary && (
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => onChange({ hra: String(Math.round(Number(form.basic_salary) * 0.4)) })}
                  className="rounded-full border border-slate-200 px-3 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
                >
                  Suggest HRA = 40% of basic
                </button>
              </div>
            )}

            {estimatedGross > 0 && (
              <div className="rounded-lg bg-violet-50 px-3 py-2 text-sm text-violet-900">
                Estimated monthly gross: <strong>{formatCurrency(estimatedGross)}</strong>
              </div>
            )}

            <label className="block text-sm">
              <span className="font-medium text-slate-700">Starts from *</span>
              <input
                type="date"
                required
                value={form.effective_from}
                onChange={(e) => onChange({ effective_from: e.target.value })}
                className="mt-1 min-h-[44px] w-full rounded-lg border border-slate-200 px-3 text-sm"
              />
              <p className="mt-1 text-xs text-slate-500">
                Use today for a new department. When updating, pick a new date (e.g. tomorrow).
              </p>
            </label>

            <label className="flex items-start gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                className="mt-1"
                checked={form.assign_to_employees}
                onChange={(e) => onChange({ assign_to_employees: e.target.checked })}
              />
              <span>
                <span className="font-medium">Apply to all employees in this department</span>
                <span className="mt-0.5 block text-xs text-slate-500">
                  Skips people who already have a custom salary.
                </span>
              </span>
            </label>

            <button
              type="button"
              onClick={() => setShowMore((v) => !v)}
              className="text-sm font-medium text-violet-700 underline"
            >
              {showMore ? 'Hide overtime & late rules' : 'Overtime & late rules (optional)'}
            </button>

            {showMore && (
              <AttendanceComplianceFields
                form={form}
                setForm={setForm}
                estimatedPerDaySalary={estimatedGross > 0 ? estimatedGross / 30 : 0}
              />
            )}
          </div>

          <div className="shrink-0 border-t border-slate-100 px-4 py-3">
            <button
              type="submit"
              disabled={saving}
              className="flex w-full min-h-[44px] items-center justify-center gap-2 rounded-lg bg-violet-600 text-sm font-semibold text-white hover:bg-violet-700 disabled:opacity-50"
            >
              <Save size={16} />
              {saving ? 'Saving…' : 'Save salary'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function DepartmentSalaryStructuresPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [assigningId, setAssigningId] = useState(null);
  const [structures, setStructures] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [designations, setDesignations] = useState([]);
  const [search, setSearch] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(blankForm);
  const [editingFromStructure, setEditingFromStructure] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [{ data: structureData }, { data: departmentData }, { data: designationData }] = await Promise.all([
        payrollApi.get('/department-structures/', { params: { active: 'true' } }),
        api.get('/hr/departments/', { params: { limit: 500 } }),
        api.get('/hr/designations/', { params: { active: 'true' } }),
      ]);
      setStructures(normalizePayrollList(structureData));
      setDepartments(normalizeApiList(departmentData));
      setDesignations(normalizeApiList(designationData));
    } catch {
      toast.error('Could not load department salaries');
      setStructures([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    document.title = 'Department Salaries | HR Payroll';
    load();
  }, [load]);

  useEffect(() => {
    if (!showForm) return undefined;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [showForm]);

  const departmentRows = useMemo(() => {
    const byDept = new Map();
    structures.forEach((s) => {
      const existing = byDept.get(s.department);
      if (!existing || s.effective_from > existing.effective_from) {
        byDept.set(s.department, s);
      }
    });
    return departments
      .map((dept) => ({ department: dept, structure: byDept.get(dept.id) || null }))
      .sort((a, b) => a.department.name.localeCompare(b.department.name));
  }, [departments, structures]);

  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return departmentRows;
    return departmentRows.filter(({ department }) => department.name.toLowerCase().includes(q));
  }, [departmentRows, search]);

  const estimatedGross = useMemo(
    () => computeGross(form.basic_salary, form.hra),
    [form.basic_salary, form.hra],
  );

  function openCreate(departmentId = '') {
    setEditingFromStructure(null);
    setForm({
      ...blankForm,
      department: departmentId,
      effective_from: suggestNextEffectiveFrom(structures, departmentId),
    });
    setShowForm(true);
  }

  function openUpdate(structure) {
    setEditingFromStructure(structure);
    setForm({
      department: structure.department,
      designation: structure.designation || '',
      basic_salary: structure.basic_salary,
      hra: structure.hra || '0',
      overtime_rate: structure.overtime_rate || '100',
      effective_from: suggestNextEffectiveFrom(structures, structure.department),
      assign_to_employees: true,
      deactivate_previous: true,
      ...complianceFormFromStructure(structure),
    });
    setShowForm(true);
  }

  function closeForm() {
    setShowForm(false);
    setEditingFromStructure(null);
    setForm(blankForm);
  }

  async function handleSave(e) {
    e.preventDefault();
    if (!form.department || !form.basic_salary || !form.effective_from) {
      toast.error('Department, basic salary, and start date are required');
      return;
    }
    if (form.overtime_enabled !== false && (!form.overtime_rate || Number(form.overtime_rate) <= 0)) {
      toast.error('Set overtime pay per hour, or turn off overtime in optional settings');
      return;
    }
    if (form.late_policy_enabled && form.late_penalty_type === 'per_minute' && Number(form.late_penalty_value) > 50) {
      toast.error('Late penalty per minute is too high (max ₹50)');
      return;
    }
    setSaving(true);
    try {
      const payload = {
        department: form.department,
        designation: form.designation || null,
        name: '',
        basic_salary: form.basic_salary,
        hra: form.hra || '0',
        overtime_rate: form.overtime_rate || '0',
        allowances: {},
        deductions: {},
        effective_from: form.effective_from,
        notes: '',
        assign_to_employees: form.assign_to_employees,
        deactivate_previous: form.deactivate_previous,
        ...compliancePayloadFromForm(form),
      };
      const { data } = await payrollApi.post('/department-structures/', payload);
      const assigned = data?.employee_assignment?.assigned_count ?? 0;
      toast.success(
        assigned > 0
          ? `Salary saved and applied to ${assigned} employee${assigned === 1 ? '' : 's'}`
          : 'Department salary saved',
      );
      closeForm();
      await load();
    } catch (error) {
      const code = error?.response?.data?.code;
      if (code === 'duplicate_effective_from') {
        toast.error('This start date already exists — pick a different date');
      } else {
        toast.error(payrollErrorText(error, 'Could not save salary'));
      }
    } finally {
      setSaving(false);
    }
  }

  async function handleAssignEmployees(row) {
    setAssigningId(row.id);
    try {
      const { data } = await payrollApi.post(`/department-structures/${row.id}/assign-employees/`, {
        skip_employees_with_structure: true,
      });
      const { assigned_count: assigned = 0, skipped_count: skipped = 0, eligible_count: eligible = 0 } = data;
      if (assigned > 0) {
        toast.success(`Applied salary to ${assigned} employee${assigned === 1 ? '' : 's'}`);
      } else if (eligible === 0) {
        toast.error('No active employees in this department');
      } else if (skipped > 0) {
        toast('Everyone already has a salary assigned', { icon: 'ℹ️' });
      } else {
        toast.error('Could not apply salary');
      }
      await load();
    } catch (error) {
      toast.error(payrollErrorText(error, 'Could not apply salary'));
    } finally {
      setAssigningId(null);
    }
  }

  const pendingCount = departmentRows.filter((r) => !r.structure).length;

  return (
    <div className="mx-auto max-w-2xl space-y-4 pb-10 pt-2">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold text-slate-900">
            <Building2 className="text-violet-600" size={24} />
            Department Salaries
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            Default monthly pay for each department.
          </p>
        </div>
        <button
          type="button"
          onClick={() => openCreate()}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-violet-600 px-3 py-2 text-sm font-semibold text-white hover:bg-violet-700"
        >
          <Plus size={16} />
          Add salary
        </button>
      </div>

      <div className="rounded-lg border border-violet-100 bg-violet-50 px-3 py-2.5 text-sm text-violet-950">
        <p className="font-medium">What is this page for?</p>
        <ol className="mt-1.5 list-decimal space-y-1 pl-4 text-violet-900">
          <li>Set <strong>basic salary + HRA</strong> for a department (e.g. IT, Nursing).</li>
          <li>Click <strong>Apply to employees</strong> so everyone in that department gets this pay.</li>
          <li>Run monthly payroll from{' '}
            <Link to="/hr/payroll/runs" className="font-semibold underline">Payroll Runs</Link>.
          </li>
        </ol>
      </div>

      <input
        type="search"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search department"
        className="w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm"
      />

      {!loading && pendingCount > 0 && (
        <p className="text-sm text-amber-800">
          {pendingCount} department{pendingCount === 1 ? '' : 's'} still need a salary setup.
        </p>
      )}

      {loading ? (
        <p className="py-10 text-center text-sm text-slate-500">Loading…</p>
      ) : filteredRows.length === 0 ? (
        <div className="rounded-lg border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-600">
          {departments.length === 0 ? 'Create departments first under HR → Departments.' : 'No department matches your search.'}
        </div>
      ) : (
        <ul className="divide-y divide-slate-100 overflow-hidden rounded-lg border border-slate-200 bg-white">
          {filteredRows.map(({ department, structure }) => {
            const gross = structure ? computeGross(structure.basic_salary, structure.hra, structure.allowances) : 0;
            return (
              <li key={department.id} className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="font-medium text-slate-900">{department.name}</p>
                  {structure ? (
                    <p className="mt-0.5 text-sm text-slate-600">
                      {formatCurrency(gross)}/month · from {formatDate(structure.effective_from)}
                    </p>
                  ) : (
                    <p className="mt-0.5 text-sm text-amber-700">Not set up yet</p>
                  )}
                </div>
                <div className="flex shrink-0 flex-wrap gap-2">
                  {structure ? (
                    <>
                      <button
                        type="button"
                        onClick={() => openUpdate(structure)}
                        className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                      >
                        <Edit2 size={14} />
                        Update
                      </button>
                      <button
                        type="button"
                        onClick={() => handleAssignEmployees(structure)}
                        disabled={assigningId === structure.id}
                        className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
                      >
                        <Users size={14} />
                        {assigningId === structure.id ? 'Applying…' : 'Apply to employees'}
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      onClick={() => openCreate(department.id)}
                      className="rounded-lg bg-violet-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-violet-700"
                    >
                      Set up salary
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <p className="text-center text-xs text-slate-500">
        For one person&apos;s custom pay, use{' '}
        <Link to="/hr/payroll/assign-salary" className="font-medium text-violet-700 underline">
          Assign Salary
        </Link>
        .
      </p>

      <SalaryFormModal
        open={showForm}
        saving={saving}
        form={form}
        departments={departments}
        designations={designations}
        editingFromStructure={editingFromStructure}
        estimatedGross={estimatedGross}
        onClose={closeForm}
        onChange={(patch) => setForm((prev) => ({ ...prev, ...patch }))}
        setForm={setForm}
        onSubmit={handleSave}
      />
    </div>
  );
}
