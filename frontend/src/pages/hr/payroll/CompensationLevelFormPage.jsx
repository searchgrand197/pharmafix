import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { ArrowLeft, Briefcase, Plus, Save } from 'lucide-react';
import api, { payrollApi } from '../../../api';
import { normalizeApiList } from '../../../hr/recruitmentLifecycle';
import {
  compensationLevelGross,
  formatCurrency,
  groupLatestLevelsPerCode,
  mapPayrollFieldErrors,
  normalizePayrollList,
  payrollErrorText,
  suggestLevelCode,
  suggestNextEffectiveFrom,
  suggestNextLevelRank,
  validateCompensationLevelField,
  validateCompensationLevelForm,
} from './payrollUtils';
import AttendanceComplianceFields, {
  complianceDefaults,
  compliancePayloadFromForm,
} from './AttendanceComplianceFields';
import { withPreservedReturn } from '../setupWizardUtils';

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

function suggestedFieldsForDesignation(designation, levels, structures) {
  const rank = suggestNextLevelRank(levels);
  return {
    code: suggestLevelCode(designation, rank),
    name: `${designation.name} Level ${rank}`,
    rank: String(rank),
    is_default_for_designation: levels.length === 0,
    effective_from: suggestNextEffectiveFrom(structures, designation.id, 'designation'),
  };
}

export default function CompensationLevelFormPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const listRoute = withPreservedReturn('/hr/payroll/compensation-levels', searchParams);
  const designationsRoute = withPreservedReturn('/hr/designations', searchParams);
  const prefillDesignationId = searchParams.get('designation') || '';

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [structures, setStructures] = useState([]);
  const [designations, setDesignations] = useState([]);
  const [form, setForm] = useState(() => makeBlankForm(prefillDesignationId));
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
      toast.error('Could not load compensation level form');
      setStructures([]);
      setDesignations([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    document.title = 'New Compensation Level | HR Payroll';
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

  const sortedDesignations = useMemo(
    () => [...designations].sort((a, b) => a.name.localeCompare(b.name)),
    [designations],
  );

  const applyDesignationSuggestions = useCallback((designationId) => {
    const designation = designations.find((row) => String(row.id) === String(designationId));
    if (!designation) return;
    const levels = levelsByDesignation.get(designation.id) || [];
    const suggested = suggestedFieldsForDesignation(designation, levels, structures);
    setForm((prev) => ({
      ...prev,
      designation: designation.id,
      ...suggested,
    }));
    setErrors({});
    setTouched({});
  }, [designations, levelsByDesignation, structures]);

  useEffect(() => {
    if (loading || designations.length === 0 || !prefillDesignationId) return;
    if (!designations.some((row) => String(row.id) === String(prefillDesignationId))) return;
    applyDesignationSuggestions(prefillDesignationId);
  }, [loading, designations, prefillDesignationId, applyDesignationSuggestions]);

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

  function handleDesignationChange(designationId) {
    if (!designationId) {
      setForm(makeBlankForm());
      setErrors({});
      setTouched({});
      return;
    }
    applyDesignationSuggestions(designationId);
  }

  const estimatedGross = useMemo(() => compensationLevelGross(form), [form]);

  async function handleSave(event) {
    event.preventDefault();
    setTouched({
      designation: true,
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
    if (!form.designation) {
      nextErrors.designation = 'Select a designation';
    }
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) {
      toast.error('Please fix the highlighted fields.');
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
        allowances: {},
        deductions: {},
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
          : 'Compensation level saved',
      );
      const returnRoute = withPreservedReturn(
        `/hr/payroll/compensation-levels?designation=${form.designation}`,
        searchParams,
      );
      navigate(returnRoute);
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
      <div className="mx-auto max-w-lg py-12 text-center text-sm text-slate-500">
        Loading…
      </div>
    );
  }

  if (designations.length === 0) {
    return (
      <div className="mx-auto max-w-lg space-y-5 pb-12">
        <Link
          to={listRoute}
          className="inline-flex items-center gap-1 text-sm font-semibold text-violet-700 hover:underline"
        >
          <ArrowLeft size={16} />
          Back to compensation levels
        </Link>
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-6 text-center shadow-sm">
          <Briefcase className="mx-auto h-12 w-12 text-amber-400" />
          <h2 className="mt-4 text-lg font-bold text-slate-900">Create designations first</h2>
          <p className="mt-2 text-sm text-slate-600">
            Job titles must exist before you can set compensation levels.
          </p>
          <Link
            to={designationsRoute}
            className="mt-5 inline-flex items-center gap-2 rounded-xl bg-violet-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-violet-700"
          >
            <Plus size={16} />
            Create designation
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-lg space-y-5 pb-12">
      <Link
        to={listRoute}
        className="inline-flex items-center gap-1 text-sm font-semibold text-violet-700 hover:underline"
      >
        <ArrowLeft size={16} />
        Back to compensation levels
      </Link>

      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold text-slate-900">
          <Briefcase className="text-violet-600" size={24} />
          New compensation level
        </h1>
        <p className="mt-1 text-sm text-slate-600">
          Pick a job title and define pay grade amounts for that designation.
        </p>
      </div>

      <form onSubmit={handleSave} className="space-y-4" noValidate>
        <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <label className="block text-sm">
            <span className="font-medium text-slate-700">Designation *</span>
            <select
              required
              value={form.designation}
              onChange={(e) => handleDesignationChange(e.target.value)}
              onBlur={() => markTouched('designation')}
              aria-invalid={Boolean(errors.designation)}
              className={`mt-1 w-full rounded-xl border px-3 py-2.5 text-sm outline-none focus:border-violet-400 ${
                errors.designation ? 'border-red-300' : 'border-slate-200'
              }`}
            >
              <option value="">Select designation</option>
              {sortedDesignations.map((designation) => (
                <option key={designation.id} value={designation.id}>
                  {designation.name}
                </option>
              ))}
            </select>
            {errors.designation ? (
              <p className="mt-1 text-xs text-red-600">{errors.designation}</p>
            ) : null}
          </label>

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
                placeholder="e.g. NURSE_L1"
                className={`mt-1 w-full rounded-xl border px-3 py-2.5 text-sm uppercase outline-none focus:border-violet-400 ${
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
              className={`mt-1 w-full rounded-xl border px-3 py-2.5 text-sm outline-none focus:border-violet-400 ${
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
        </section>

        <div className="flex gap-2">
          <Link
            to={listRoute}
            className="flex min-h-[48px] flex-1 items-center justify-center rounded-xl border border-slate-200 text-sm font-semibold text-slate-700 hover:bg-slate-50"
          >
            Cancel
          </Link>
          <button
            type="submit"
            disabled={saving}
            className="flex min-h-[48px] flex-1 items-center justify-center gap-2 rounded-xl bg-violet-600 text-sm font-semibold text-white hover:bg-violet-700 disabled:opacity-50"
          >
            <Save size={16} />
            {saving ? 'Saving…' : 'Save level'}
          </button>
        </div>
      </form>
    </div>
  );
}
