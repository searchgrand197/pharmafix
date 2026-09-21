import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { ArrowLeft, Briefcase, ChevronRight, Plus, Save, Search, Star } from 'lucide-react';
import api, { payrollApi } from '../../../api';
import { normalizeApiList } from '../../../hr/recruitmentLifecycle';
import { TableSkeleton } from '../../../components/HR/HRSkeleton';
import SetupWizardNav from '../../../components/HR/SetupWizardNav';
import {
  compensationLevelGross,
  formatCurrency,
  groupLatestLevelsPerCode,
  mapPayrollFieldErrors,
  normalizePayrollList,
  payrollErrorText,
  suggestNextEffectiveFrom,
  validateCompensationLevelField,
  validateCompensationLevelForm,
} from './payrollUtils';
import AttendanceComplianceFields, {
  complianceDefaults,
  complianceFormFromStructure,
  compliancePayloadFromForm,
} from './AttendanceComplianceFields';
import { isFromSetupWizard, withPreservedReturn } from '../setupWizardUtils';

function makeBlankForm(designationId = '') {
  return {
    designation: designationId,
    code: '',
    name: '',
    rank: '0',
    basic: '',
    hra: '',
    medical: '',
    special_allowance: '',
    effective_from: new Date().toISOString().slice(0, 10),
    assign_to_employees: true,
    is_default_for_designation: false,
    ...complianceDefaults,
  };
}

function formatDate(value) {
  if (!value) return '—';
  return new Date(value).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

function displayOptionalAmount(value) {
  if (value == null || value === '') return '';
  const num = Number(value);
  return Number.isFinite(num) && num === 0 ? '' : String(value);
}

function AmountInput({ label, value, onChange, required, error, onBlur }) {
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
          onBlur={onBlur}
          aria-invalid={Boolean(error)}
          className={`w-full rounded-xl border py-2.5 pl-7 pr-3 text-sm outline-none focus:border-violet-400 ${
            error ? 'border-red-300 focus:border-red-500' : 'border-slate-200'
          }`}
        />
      </div>
      {error ? <p className="mt-1 text-xs text-red-600">{error}</p> : null}
    </label>
  );
}

export default function CompensationLevelsPage() {
  const [searchParams] = useSearchParams();
  const fromSetupWizard = isFromSetupWizard(searchParams);
  const designationsRoute = withPreservedReturn('/hr/designations', searchParams);
  const newLevelRoute = withPreservedReturn('/hr/payroll/compensation-levels/new', searchParams);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [structures, setStructures] = useState([]);
  const [designations, setDesignations] = useState([]);
  const [search, setSearch] = useState('');
  const initialFilter = searchParams.get('filter') === 'missing' ? 'missing' : 'all';
  const [filter, setFilter] = useState(initialFilter);
  const [selectedDesignationId, setSelectedDesignationId] = useState(
    () => searchParams.get('designation') || null,
  );
  const [form, setForm] = useState(makeBlankForm());
  const [editingLevel, setEditingLevel] = useState(null);
  const [showMore, setShowMore] = useState(false);
  const [errors, setErrors] = useState({});
  const [touched, setTouched] = useState({});

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [{ data: structureData }, { data: designationData }] = await Promise.all([
        payrollApi.get('/compensation-levels/', { params: { active: 'true' } }),
        api.get('/hr/designations/', { params: { active: 'true' } }),
      ]);
      setStructures(normalizePayrollList(structureData));
      setDesignations(normalizeApiList(designationData));
    } catch {
      toast.error('Could not load compensation levels');
      setStructures([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    document.title = 'Compensation Levels | HR Payroll';
    load();
  }, [load]);

  const levelsByDesignation = useMemo(() => {
    const map = new Map();
    structures.forEach((row) => {
      const list = map.get(row.designation) || [];
      list.push(row);
      map.set(row.designation, list);
    });
    map.forEach((list, key) => {
      map.set(key, groupLatestLevelsPerCode(list));
    });
    return map;
  }, [structures]);

  const defaultLevelByDesignation = useMemo(() => {
    const map = new Map();
    levelsByDesignation.forEach((levels, designationId) => {
      const defaultLevel = levels.find((row) => row.is_default_for_designation)
        || levels.find((row) => Number(row.rank) === 0)
        || levels[0]
        || null;
      if (defaultLevel) map.set(designationId, defaultLevel);
    });
    return map;
  }, [levelsByDesignation]);

  const designationRows = useMemo(
    () => designations
      .map((designation) => ({
        designation,
        levels: levelsByDesignation.get(designation.id) || [],
        defaultLevel: defaultLevelByDesignation.get(designation.id) || null,
      }))
      .sort((a, b) => a.designation.name.localeCompare(b.designation.name)),
    [designations, levelsByDesignation, defaultLevelByDesignation],
  );

  const stats = useMemo(() => {
    const withSalary = designationRows.filter((row) => row.defaultLevel).length;
    return {
      total: designationRows.length,
      withSalary,
      missing: designationRows.length - withSalary,
    };
  }, [designationRows]);

  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return designationRows.filter(({ designation, defaultLevel }) => {
      if (filter === 'missing' && defaultLevel) return false;
      if (filter === 'has_salary' && !defaultLevel) return false;
      if (!q) return true;
      return designation.name.toLowerCase().includes(q);
    });
  }, [designationRows, filter, search]);

  const selectedRow = useMemo(
    () => designationRows.find((row) => row.designation.id === selectedDesignationId) || null,
    [designationRows, selectedDesignationId],
  );

  useEffect(() => {
    if (loading || selectedDesignationId) return;
    const first = designationRows.find((row) => !row.defaultLevel) || designationRows[0];
    if (first) setSelectedDesignationId(first.designation.id);
  }, [designationRows, loading, selectedDesignationId]);

  useEffect(() => {
    const designationId = searchParams.get('designation');
    if (!designationId || loading) return;
    if (designationRows.some((row) => String(row.designation.id) === designationId)) {
      setSelectedDesignationId(designationId);
    }
  }, [designationRows, loading, searchParams]);

  const applyFieldError = (field, nextForm) => {
    const message = validateCompensationLevelField(field, nextForm);
    setErrors((prev) => {
      const next = { ...prev };
      if (message) next[field] = message;
      else delete next[field];
      return next;
    });
  };

  function patchForm(patch) {
    const nextForm = { ...form, ...patch };
    setForm(nextForm);
    Object.keys(patch).forEach((field) => {
      if (touched[field]) applyFieldError(field, nextForm);
    });
  }

  function markTouched(field) {
    setTouched((prev) => ({ ...prev, [field]: true }));
    applyFieldError(field, form);
  }

  const estimatedGross = useMemo(
    () => compensationLevelGross(form),
    [form],
  );

  function loadLevelIntoForm(level) {
    setEditingLevel(level);
    setForm({
      designation: level.designation,
      code: level.code,
      name: level.name,
      rank: String(level.rank ?? 0),
      basic: level.basic,
      hra: displayOptionalAmount(level.hra),
      medical: displayOptionalAmount(level.medical),
      special_allowance: displayOptionalAmount(level.special_allowance),
      effective_from: suggestNextEffectiveFrom(
        structures.filter((row) => row.code === level.code),
        level.designation,
        'designation',
      ),
      assign_to_employees: false,
      is_default_for_designation: Boolean(level.is_default_for_designation),
      ...complianceFormFromStructure(level),
      overtime_rate: level.overtime_rate || complianceDefaults.overtime_rate,
    });
    setShowMore(false);
    setErrors({});
    setTouched({});
  }

  async function handleSetDefault(level) {
    setSaving(true);
    try {
      await payrollApi.patch(`/compensation-levels/${level.id}/`, {
        is_default_for_designation: true,
      });
      toast.success(`${level.name} is now the default level`);
      await load();
    } catch (error) {
      toast.error(payrollErrorText(error, 'Could not set default level'));
    } finally {
      setSaving(false);
    }
  }

  async function handleSave(event) {
    event.preventDefault();
    setTouched({
      code: true,
      name: true,
      rank: true,
      basic: true,
      hra: true,
      medical: true,
      special_allowance: true,
      overtime_rate: true,
      effective_from: true,
    });

    const nextErrors = validateCompensationLevelForm(form);
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) {
      toast.error('Please fix the highlighted fields.');
      return;
    }
    if (!form.designation) {
      toast.error('Select a designation first');
      return;
    }
    if (!form.overtime_rate || Number(form.overtime_rate) <= 0) {
      toast.error('Set overtime pay per hour in attendance rules');
      return;
    }
    if (Number(form.late_penalty_value) > 50) {
      toast.error('Late penalty per minute is too high (max ₹50)');
      return;
    }
    setSaving(true);
    try {
      const payload = {
        designation: form.designation,
        code: String(form.code).trim().toUpperCase(),
        name: String(form.name).trim(),
        rank: Number(form.rank) || 0,
        basic: form.basic,
        hra: form.hra || '0',
        medical: form.medical || '0',
        special_allowance: form.special_allowance || '0',
        allowances: editingLevel?.allowances || {},
        deductions: editingLevel?.deductions || {},
        overtime_rate: form.overtime_rate || '0',
        effective_from: form.effective_from,
        assign_to_employees: form.assign_to_employees,
        is_default_for_designation: form.is_default_for_designation,
        deactivate_previous: true,
        ...compliancePayloadFromForm(form, { variant: 'simple' }),
      };
      const { data } = await payrollApi.post('/compensation-levels/', payload);
      const assigned = data?.employee_assignment?.assigned_count ?? 0;
      toast.success(
        assigned > 0
          ? `Compensation level saved and applied to ${assigned} employee${assigned === 1 ? '' : 's'}`
          : 'Compensation level updated',
      );
      setEditingLevel(null);
      setErrors({});
      await load();
    } catch (error) {
      const apiErrors = mapPayrollFieldErrors(error?.response?.data);
      if (Object.keys(apiErrors).length > 0) {
        setErrors((prev) => ({ ...prev, ...apiErrors }));
      }
      toast.error(payrollErrorText(error, 'Could not save salary'));
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="mx-auto max-w-6xl space-y-5 pb-12">
        <div className="h-8 w-64 animate-pulse rounded bg-slate-100" />
        <TableSkeleton rows={5} cols={2} />
      </div>
    );
  }

  if (designations.length === 0) {
    return (
      <div className="mx-auto max-w-lg space-y-5 pb-12">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold text-slate-900">
            <Briefcase className="text-violet-600" size={24} />
            Compensation levels
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            Set pay levels (L0, L1, L2…) for each job title after you have created designations.
          </p>
        </div>

        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-6 text-center shadow-sm">
          <Briefcase className="mx-auto h-12 w-12 text-amber-400" />
          <h2 className="mt-4 text-lg font-bold text-slate-900">Create designations first</h2>
          <p className="mt-2 text-sm text-slate-600">
            Job titles (e.g. Nurse, Receptionist) must exist before you can set compensation levels.
          </p>
          <Link
            to={designationsRoute}
            className="mt-5 inline-flex items-center gap-2 rounded-xl bg-violet-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-violet-700"
          >
            <Plus size={16} />
            Create designation
          </Link>
          {fromSetupWizard && (
            <div className="mt-4">
              <Link
                to="/hr/settings/organization"
                className="inline-flex items-center gap-1.5 text-sm font-semibold text-violet-700 hover:underline"
              >
                <ArrowLeft size={16} />
                Back to Organization Settings
              </Link>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl space-y-5 pb-12">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold text-slate-900">
            <Briefcase className="text-violet-600" size={24} />
            Compensation levels
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-slate-600">
            Create multiple pay grades per job title (e.g. Nurse L0 junior, Nurse L1 senior).
            Mark one level as default for new hires.
          </p>
        </div>
        <Link
          to={newLevelRoute}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-xl bg-violet-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-violet-700"
        >
          <Plus size={16} />
          Add level
        </Link>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        {[
          { id: 'all', label: 'All designations', value: stats.total, tone: 'bg-slate-50 border-slate-200 text-slate-900' },
          { id: 'has_salary', label: 'Default set', value: stats.withSalary, tone: 'bg-emerald-50 border-emerald-200 text-emerald-900' },
          { id: 'missing', label: 'Need default', value: stats.missing, tone: 'bg-amber-50 border-amber-200 text-amber-900' },
        ].map((card) => (
          <button
            key={card.id}
            type="button"
            onClick={() => setFilter(card.id)}
            className={`rounded-2xl border px-4 py-3 text-left transition ${
              filter === card.id ? `${card.tone} ring-2 ring-violet-200` : `${card.tone} opacity-90 hover:opacity-100`
            }`}
          >
            <p className="text-2xl font-bold">{card.value}</p>
            <p className="mt-0.5 text-sm font-medium">{card.label}</p>
          </button>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
        <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-100 p-3">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
              <input
                type="search"
                placeholder="Search designations…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full rounded-xl border border-slate-200 py-2.5 pl-9 pr-3 text-sm outline-none focus:border-violet-400"
              />
            </div>
          </div>

          {filteredRows.length === 0 ? (
            <p className="px-4 py-10 text-center text-sm text-slate-500">No designations match your search.</p>
          ) : (
            <ul className="max-h-[32rem] divide-y divide-slate-100 overflow-y-auto">
              {filteredRows.map(({ designation, levels, defaultLevel }) => {
                const selected = selectedDesignationId === designation.id;
                const gross = compensationLevelGross(defaultLevel);
                return (
                  <li key={designation.id}>
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedDesignationId(designation.id);
                        setEditingLevel(null);
                      }}
                      className={`flex w-full items-center gap-3 px-4 py-3 text-left transition ${
                        selected ? 'bg-violet-50' : 'hover:bg-slate-50'
                      }`}
                    >
                      <div className="min-w-0 flex-1">
                        <p className="font-semibold text-slate-900">{designation.name}</p>
                        <p className="text-xs text-slate-500">
                          {levels.length > 0
                            ? `${levels.length} level${levels.length === 1 ? '' : 's'}`
                            : 'No levels yet'}
                          {designation.employee_count > 0 && (
                            <>
                              <span className="text-slate-300"> · </span>
                              {designation.employee_count} employee{designation.employee_count === 1 ? '' : 's'}
                            </>
                          )}
                        </p>
                        {defaultLevel ? (
                          <p className="mt-0.5 text-sm text-emerald-700">
                            Default: {formatCurrency(gross)} / month
                          </p>
                        ) : (
                          <p className="mt-0.5 text-sm font-medium text-amber-700">Default level not set</p>
                        )}
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
          {!selectedRow ? (
            <div className="flex min-h-[20rem] flex-col items-center justify-center text-center text-sm text-slate-500">
              <Briefcase className="mb-3 h-10 w-10 text-slate-300" />
              Select a designation to manage its compensation levels.
            </div>
          ) : (
            <>
              <div className="flex items-start justify-between gap-3 border-b border-slate-100 pb-4">
                <div>
                  <h2 className="text-lg font-bold text-slate-900">{selectedRow.designation.name}</h2>
                  <p className="mt-1 text-sm text-slate-600">
                    {selectedRow.levels.length > 0
                      ? `${selectedRow.levels.length} active level${selectedRow.levels.length === 1 ? '' : 's'}`
                      : 'No compensation levels yet — add the first level.'}
                  </p>
                </div>
                {selectedRow.levels.length > 0 ? (
                  <Link
                    to={withPreservedReturn(
                      `/hr/payroll/compensation-levels/new?designation=${selectedRow.designation.id}`,
                      searchParams,
                    )}
                    className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-violet-200 bg-violet-50 px-3 py-1.5 text-xs font-semibold text-violet-800 hover:bg-violet-100"
                  >
                    <Plus size={14} />
                    Add level
                  </Link>
                ) : null}
              </div>

              {selectedRow.levels.length === 0 && !editingLevel ? (
                <div className="mt-6 rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 py-8 text-center">
                  <p className="text-sm text-slate-600">No levels for this designation yet.</p>
                  <Link
                    to={withPreservedReturn(
                      `/hr/payroll/compensation-levels/new?designation=${selectedRow.designation.id}`,
                      searchParams,
                    )}
                    className="mt-3 inline-flex items-center gap-1.5 text-sm font-semibold text-violet-700 hover:underline"
                  >
                    <Plus size={14} />
                    Add first level
                  </Link>
                </div>
              ) : null}

              {selectedRow.levels.length > 0 && (
                <div className="mt-4 overflow-x-auto rounded-xl border border-slate-100">
                  <table className="w-full min-w-[28rem] text-left text-sm">
                    <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                      <tr>
                        <th className="px-3 py-2">Level</th>
                        <th className="px-3 py-2">Rank</th>
                        <th className="px-3 py-2">Gross</th>
                        <th className="px-3 py-2">From</th>
                        <th className="px-3 py-2">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {selectedRow.levels.map((level) => (
                        <tr key={level.id} className={editingLevel?.id === level.id ? 'bg-violet-50/50' : ''}>
                          <td className="px-3 py-2">
                            <div className="font-medium text-slate-900">{level.name}</div>
                            <div className="text-xs text-slate-500">{level.code}</div>
                            {level.is_default_for_designation ? (
                              <span className="mt-1 inline-flex items-center gap-0.5 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold uppercase text-amber-800">
                                <Star size={10} />
                                Default
                              </span>
                            ) : null}
                          </td>
                          <td className="px-3 py-2 text-slate-600">L{level.rank ?? 0}</td>
                          <td className="px-3 py-2 font-medium text-slate-800">
                            {formatCurrency(compensationLevelGross(level))}
                          </td>
                          <td className="px-3 py-2 text-slate-600">{formatDate(level.effective_from)}</td>
                          <td className="px-3 py-2">
                            <div className="flex flex-wrap gap-1">
                              <button
                                type="button"
                                onClick={() => loadLevelIntoForm(level)}
                                className="rounded border border-slate-200 px-2 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                              >
                                Edit
                              </button>
                              {!level.is_default_for_designation ? (
                                <button
                                  type="button"
                                  disabled={saving}
                                  onClick={() => handleSetDefault(level)}
                                  className="rounded border border-amber-200 px-2 py-1 text-xs font-semibold text-amber-800 hover:bg-amber-50 disabled:opacity-50"
                                >
                                  Set default
                                </button>
                              ) : null}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {editingLevel ? (
              <form onSubmit={handleSave} className="mt-4 space-y-4" noValidate>
                <p className="text-sm font-semibold text-slate-800">
                  Update {editingLevel.code}
                </p>

                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="block text-sm">
                    <span className="font-medium text-slate-700">Level name *</span>
                    <input
                      type="text"
                      required
                      value={form.name}
                      onChange={(e) => patchForm({ name: e.target.value })}
                      onBlur={() => markTouched('name')}
                      placeholder="e.g. Nurse Level 1"
                      className={`mt-1 w-full rounded-xl border px-3 py-2.5 text-sm outline-none focus:border-violet-400 ${
                        errors.name ? 'border-red-300' : 'border-slate-200'
                      }`}
                    />
                    {errors.name ? <p className="mt-1 text-xs text-red-600">{errors.name}</p> : null}
                  </label>
                  <label className="block text-sm">
                    <span className="font-medium text-slate-700">Code *</span>
                    <input
                      type="text"
                      required
                      value={form.code}
                      onChange={(e) => patchForm({ code: e.target.value.toUpperCase() })}
                      onBlur={() => markTouched('code')}
                      disabled
                      placeholder="e.g. NURSE_L1"
                      className={`mt-1 w-full rounded-xl border px-3 py-2.5 text-sm uppercase outline-none focus:border-violet-400 disabled:bg-slate-50 ${
                        errors.code ? 'border-red-300' : 'border-slate-200'
                      }`}
                    />
                    {errors.code ? <p className="mt-1 text-xs text-red-600">{errors.code}</p> : null}
                  </label>
                </div>

                <label className="block text-sm sm:max-w-[10rem]">
                  <span className="font-medium text-slate-700">Rank *</span>
                  <input
                    type="number"
                    min="0"
                    step="1"
                    required
                    value={form.rank}
                    onChange={(e) => patchForm({ rank: e.target.value })}
                    onBlur={() => markTouched('rank')}
                    disabled
                    className={`mt-1 w-full rounded-xl border px-3 py-2.5 text-sm outline-none focus:border-violet-400 disabled:bg-slate-50 ${
                      errors.rank ? 'border-red-300' : 'border-slate-200'
                    }`}
                  />
                  {errors.rank ? <p className="mt-1 text-xs text-red-600">{errors.rank}</p> : null}
                </label>

                <AmountInput
                  label="Basic salary (per month)"
                  required
                  value={form.basic}
                  error={errors.basic}
                  onChange={(e) => patchForm({ basic: e.target.value })}
                  onBlur={() => markTouched('basic')}
                />

                <div className="grid gap-3 sm:grid-cols-3">
                  <AmountInput
                    label="HRA"
                    value={form.hra}
                    error={errors.hra}
                    onChange={(e) => patchForm({ hra: e.target.value })}
                    onBlur={() => markTouched('hra')}
                  />
                  <AmountInput
                    label="Medical"
                    value={form.medical}
                    error={errors.medical}
                    onChange={(e) => patchForm({ medical: e.target.value })}
                    onBlur={() => markTouched('medical')}
                  />
                  <AmountInput
                    label="Special allowance"
                    value={form.special_allowance}
                    error={errors.special_allowance}
                    onChange={(e) => patchForm({ special_allowance: e.target.value })}
                    onBlur={() => markTouched('special_allowance')}
                  />
                </div>

                <div className="rounded-xl bg-violet-50 px-3 py-2.5 text-sm text-violet-900">
                  Total monthly pay: <strong>{formatCurrency(estimatedGross)}</strong>
                </div>

                <label className="block text-sm">
                  <span className="font-medium text-slate-700">Effective from *</span>
                  <input
                    type="date"
                    required
                    value={form.effective_from}
                    onChange={(e) => patchForm({ effective_from: e.target.value })}
                    onBlur={() => markTouched('effective_from')}
                    aria-invalid={Boolean(errors.effective_from)}
                    className={`mt-1 w-full rounded-xl border px-3 py-2.5 text-sm outline-none focus:border-violet-400 ${
                      errors.effective_from ? 'border-red-300 focus:border-red-500' : 'border-slate-200'
                    }`}
                  />
                  {errors.effective_from ? (
                    <p className="mt-1 text-xs text-red-600">{errors.effective_from}</p>
                  ) : null}
                </label>

                <label className="flex items-start gap-3 rounded-xl border border-slate-100 bg-slate-50 px-3 py-3 text-sm">
                  <input
                    type="checkbox"
                    checked={form.is_default_for_designation}
                    onChange={(e) => patchForm({ is_default_for_designation: e.target.checked })}
                    className="mt-0.5 h-4 w-4 rounded border-slate-300 text-violet-600"
                  />
                  <span>
                    <span className="font-medium text-slate-800">Default level for this designation</span>
                    <span className="block text-xs text-slate-500">
                      New employees with this job title get this level unless you pick another at hire.
                    </span>
                  </span>
                </label>

                <label className="flex items-start gap-3 rounded-xl border border-slate-100 bg-slate-50 px-3 py-3 text-sm">
                  <input
                    type="checkbox"
                    checked={form.assign_to_employees}
                    onChange={(e) => patchForm({ assign_to_employees: e.target.checked })}
                    className="mt-0.5 h-4 w-4 rounded border-slate-300 text-violet-600"
                  />
                  <span>
                    <span className="font-medium text-slate-800">Apply to employees with this designation</span>
                    <span className="block text-xs text-slate-500">
                      Bulk-assign this level to active employees who have this job title and no assignment yet.
                    </span>
                  </span>
                </label>

                <button
                  type="button"
                  onClick={() => setShowMore((v) => !v)}
                  className="text-sm font-semibold text-violet-700 hover:underline"
                >
                  {showMore ? 'Hide attendance rules' : 'Attendance rules (optional)'}
                </button>

                {showMore && (
                  <AttendanceComplianceFields
                    variant="simple"
                    form={form}
                    setForm={setForm}
                  />
                )}

                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setEditingLevel(null);
                      setForm(makeBlankForm());
                      setShowMore(false);
                      setErrors({});
                      setTouched({});
                    }}
                    className="min-h-[48px] flex-1 rounded-xl border border-slate-200 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                  >
                    Cancel edit
                  </button>
                  <button
                    type="submit"
                    disabled={saving}
                    className="flex min-h-[48px] flex-1 items-center justify-center gap-2 rounded-xl bg-violet-600 text-sm font-semibold text-white hover:bg-violet-700 disabled:opacity-50"
                  >
                    <Save size={16} />
                    {saving ? 'Saving…' : 'Save new version'}
                  </button>
                </div>
              </form>
              ) : null}
            </>
          )}
        </section>
      </div>

      <SetupWizardNav className="border-t border-slate-100 pt-4" />
    </div>
  );
}
