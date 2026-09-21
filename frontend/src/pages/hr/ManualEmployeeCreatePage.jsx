import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { isFromJourneyCenter, journeyCenterPath } from './journeyCenterUtils';
import { isFromSetupWizard, withPreservedReturn } from './setupWizardUtils';
import api, { getHospitalId } from '../../api';
import toast from 'react-hot-toast';
import { UserPlus } from 'lucide-react';
import { normalizeApiList } from '../../hr/recruitmentLifecycle';
import {
  buildManualEmployeePayload,
  EMPLOYEE_FIELD_LIMITS,
  GENDER_OPTIONS,
  validateManualEmployeeField,
  validateManualEmployeeForm,
} from '../../utils/employeeFormValidation';
import {
  formatCompensationLevelOption,
  useCompensationLevelsForDesignation,
} from './payroll/useCompensationLevels';
import { compensationLevelGross, formatCurrency } from './payroll/payrollUtils';

const EMP_TYPES = [
  { value: 'full_time', label: 'Full time' },
  { value: 'part_time', label: 'Part time' },
  { value: 'contract', label: 'Contract' },
  { value: 'internship', label: 'Internship' },
];

const BLANK_CUSTOM_SALARY = {
  basic: '',
  hra: '',
  medical: '',
  special_allowance: '',
};

const VALIDATED_FIELDS = [
  'name',
  'email',
  'phone',
  'gender',
  'department',
  'designation',
  'job_title',
  'joining_date',
  'employment_type',
  'custom_basic',
  'custom_hra',
  'custom_medical',
  'custom_special_allowance',
  'manager_name',
  'address',
  'emergency_contact',
];

function FieldError({ message }) {
  if (!message) return null;
  return <p className="mt-1 text-xs text-red-600">{message}</p>;
}

function AmountField({ label, value, onChange, onBlur, error, required, inputClassName }) {
  return (
    <label className="block">
      <span className="text-xs font-medium text-slate-600">
        {label}
        {required ? ' *' : ''}
      </span>
      <div className="relative mt-1">
        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-slate-400">₹</span>
        <input
          type="number"
          step="0.01"
          min="0"
          className={`${inputClassName} pl-7`}
          value={value}
          onChange={onChange}
          onBlur={onBlur}
        />
      </div>
      <FieldError message={error} />
    </label>
  );
}

export default function ManualEmployeeCreatePage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const fromSetupWizard = isFromSetupWizard(searchParams);
  const fromJourneyCenter = isFromJourneyCenter(searchParams);
  const cancelRoute = fromSetupWizard
    ? '/hr/settings/organization'
    : fromJourneyCenter
      ? journeyCenterPath(searchParams.get('job_opening'))
      : '/hr/employees';
  const [departments, setDepartments] = useState([]);
  const [designations, setDesignations] = useState([]);
  const [loadingDeps, setLoadingDeps] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [duplicate, setDuplicate] = useState(null);
  const [errors, setErrors] = useState({});
  const [touched, setTouched] = useState({});

  const [form, setForm] = useState({
    name: '',
    email: '',
    phone: '',
    gender: '',
    department: '',
    designation: '',
    compensation_level: '',
    pay_mode: 'level',
    custom_salary: { ...BLANK_CUSTOM_SALARY },
    job_title: '',
    joining_date: '',
    employment_type: 'full_time',
    manager_name: '',
    address: '',
    emergency_contact: '',
  });

  const validationOptions = useMemo(
    () => ({ departments, designations }),
    [departments, designations],
  );

  const {
    levels: compensationLevels,
    loading: loadingCompensationLevels,
    defaultLevelId,
  } = useCompensationLevelsForDesignation(form.designation);

  const customGross = useMemo(
    () => compensationLevelGross(form.custom_salary),
    [form.custom_salary],
  );

  useEffect(() => {
    if (!form.designation) return;
    if (form.pay_mode !== 'level') return;
    if (!defaultLevelId) return;
    setForm((prev) => {
      const stillValid = prev.compensation_level
        && compensationLevels.some((row) => String(row.id) === String(prev.compensation_level));
      if (stillValid) return prev;
      return { ...prev, compensation_level: defaultLevelId };
    });
  }, [form.designation, form.pay_mode, defaultLevelId, compensationLevels]);

  useEffect(() => {
    document.title = 'Add employee | HR';
    let cancelled = false;
    (async () => {
      setLoadingDeps(true);
      try {
        const [{ data: deptData }, { data: desData }] = await Promise.all([
          api.get('/hr/departments/', { params: { limit: 200 } }),
          api.get('/hr/designations/', { params: { active: 'true' } }),
        ]);
        if (!cancelled) {
          setDepartments(normalizeApiList(deptData));
          setDesignations(normalizeApiList(desData));
        }
      } catch {
        if (!cancelled) toast.error('Could not load departments');
      } finally {
        if (!cancelled) setLoadingDeps(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const applyFieldError = (field, nextForm) => {
    const message = validateManualEmployeeField(field, nextForm, validationOptions);
    setErrors((prev) => {
      const next = { ...prev };
      if (message) next[field] = message;
      else delete next[field];
      return next;
    });
  };

  const set = (k, v) => {
    const nextForm = { ...form, [k]: v };
    setForm(nextForm);
    if (touched[k] || k === 'phone') {
      applyFieldError(k, nextForm);
    }
  };

  const setCustomAmount = (key, value) => {
    const nextForm = {
      ...form,
      custom_salary: { ...form.custom_salary, [key]: value },
    };
    setForm(nextForm);
    const fieldKey = `custom_${key}`;
    if (touched[fieldKey]) {
      applyFieldError(fieldKey, nextForm);
    }
  };

  const setPayMode = (mode) => {
    setForm((prev) => {
      if (mode === 'custom') {
        return {
          ...prev,
          pay_mode: 'custom',
          compensation_level: '',
        };
      }
      return {
        ...prev,
        pay_mode: 'level',
        custom_salary: { ...BLANK_CUSTOM_SALARY },
        compensation_level: defaultLevelId || prev.compensation_level || '',
      };
    });
    setErrors((prev) => {
      const next = { ...prev };
      delete next.custom_basic;
      delete next.custom_hra;
      delete next.custom_medical;
      delete next.custom_special_allowance;
      return next;
    });
  };

  const markTouched = (field, value) => {
    const nextForm = value !== undefined ? { ...form, [field]: value } : form;
    setTouched((prev) => ({ ...prev, [field]: true }));
    applyFieldError(field, nextForm);
  };

  const checkDuplicate = useCallback(async (emailRaw) => {
    const email = (emailRaw || '').trim().toLowerCase();
    if (!email || validateManualEmployeeField('email', { email }, validationOptions)) {
      setDuplicate(null);
      return;
    }
    try {
      const { data } = await api.get('/hr/employees/manual-lookup/', { params: { email } });
      setDuplicate(data.exists ? data : null);
    } catch {
      setDuplicate(null);
    }
  }, [validationOptions]);

  async function handleSubmit(e) {
    e.preventDefault();
    setTouched(Object.fromEntries(VALIDATED_FIELDS.map((field) => [field, true])));

    const nextErrors = validateManualEmployeeForm(form, validationOptions);
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) {
      toast.error('Please fix the highlighted fields.');
      return;
    }
    if (duplicate?.exists) {
      toast.error('This email is already used.');
      return;
    }

    const payload = buildManualEmployeePayload(form, { hospitalId: getHospitalId(), departments, designations });

    setSubmitting(true);
    try {
      const { data } = await api.post('/hr/employees/manual-create/', payload);
      toast.success(`Employee created (${data.employee?.employee_id || ''}) — portal welcome email sent`);
      navigate(`/hr/employees/${data.employee.id}`);
    } catch (err) {
      const body = err.response?.data;
      if (err.response?.status === 409 && body?.code === 'duplicate_email') {
        setDuplicate({ exists: true, employee: body.existing_employee });
        toast.error(body.message || 'This email is already in use.');
      } else if (body?.field_errors) {
        setErrors(body.field_errors);
        toast.error(body.error || 'Please fix the highlighted fields.');
      } else {
        toast.error(body?.error || body?.detail || 'Unable to create employee');
      }
    } finally {
      setSubmitting(false);
    }
  }

  const inputClass = (field) => [
    'mt-1 w-full rounded-lg border px-3 py-2 text-sm',
    errors[field] ? 'border-red-300 focus:border-red-500 focus:ring-red-200' : 'border-slate-200',
  ].join(' ');
  const labelClass = 'text-xs font-medium text-slate-600';

  return (
    <div className="mx-auto max-w-xl space-y-4 pb-12">
      <div className="flex items-center justify-between gap-3">
        <h1 className="flex items-center gap-2 text-2xl font-bold text-slate-900">
          <UserPlus className="text-violet-600" size={22} />
          {fromJourneyCenter ? 'Direct hire' : 'Add employee'}
        </h1>
        <Link
          to={withPreservedReturn(cancelRoute, searchParams)}
          className="text-sm font-medium text-slate-600 hover:text-slate-900"
        >
          Cancel
        </Link>
      </div>

      <p className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-2 text-xs text-slate-600">
        For walk-in hires already in the office: the employee is created as active, required documents are
        marked verified in HR records, and a portal welcome email with login details is sent automatically.
        No onboarding document link is used.
      </p>

      {duplicate?.exists && duplicate.employee && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950">
          <span className="font-medium">{duplicate.employee.name}</span> already exists ({duplicate.employee.email}).
          {' '}
          <Link to={`/hr/employees/${duplicate.employee.id}`} className="font-semibold text-violet-700 underline">
            Open
          </Link>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4 rounded-xl border border-slate-200 bg-white p-4" noValidate>
        <label className="block">
          <span className={labelClass}>Name *</span>
          <input
            className={inputClass('name')}
            value={form.name}
            maxLength={EMPLOYEE_FIELD_LIMITS.name}
            onChange={(e) => set('name', e.target.value)}
            onBlur={() => markTouched('name')}
          />
          <FieldError message={errors.name} />
        </label>

        <label className="block">
          <span className={labelClass}>Email *</span>
          <input
            type="email"
            className={inputClass('email')}
            value={form.email}
            maxLength={EMPLOYEE_FIELD_LIMITS.email}
            onChange={(e) => { set('email', e.target.value); setDuplicate(null); }}
            onBlur={(e) => { markTouched('email'); checkDuplicate(e.target.value); }}
          />
          <FieldError message={errors.email} />
        </label>

        <label className="block">
          <span className={labelClass}>Mobile *</span>
          <input
            type="tel"
            inputMode="numeric"
            autoComplete="tel"
            className={inputClass('phone')}
            value={form.phone}
            maxLength={EMPLOYEE_FIELD_LIMITS.phone}
            placeholder="10-digit mobile, e.g. 9876543210"
            onChange={(e) => set('phone', e.target.value)}
            onBlur={(e) => markTouched('phone', e.target.value)}
          />
          <FieldError message={errors.phone} />
        </label>

        <label className="block">
          <span className={labelClass}>Gender *</span>
          <select
            className={inputClass('gender')}
            value={form.gender}
            onChange={(e) => set('gender', e.target.value)}
            onBlur={() => markTouched('gender')}
          >
            <option value="">Select gender</option>
            {GENDER_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
          <FieldError message={errors.gender} />
        </label>

        <label className="block">
          <span className={labelClass}>Department *</span>
          <select
            className={inputClass('department')}
            value={form.department}
            onChange={(e) => set('department', e.target.value)}
            onBlur={() => markTouched('department')}
            disabled={loadingDeps}
          >
            <option value="">{loadingDeps ? 'Loading…' : 'Select department'}</option>
            {departments.map((d) => (
              <option key={d.id} value={d.id}>{d.name}</option>
            ))}
          </select>
          <FieldError message={errors.department} />
        </label>

        <label className="block">
          <span className={labelClass}>Designation *</span>
          <select
            className={inputClass('designation')}
            value={form.designation}
            onChange={(e) => {
              const designationId = e.target.value;
              setForm((prev) => ({
                ...prev,
                designation: designationId,
                compensation_level: '',
                custom_salary: { ...BLANK_CUSTOM_SALARY },
              }));
              if (touched.designation) {
                applyFieldError('designation', { ...form, designation: designationId });
              }
            }}
            onBlur={() => markTouched('designation')}
            disabled={loadingDeps}
          >
            <option value="">{loadingDeps ? 'Loading…' : 'Select designation'}</option>
            {designations.map((d) => (
              <option key={d.id} value={d.id}>{d.name}</option>
            ))}
          </select>
          <FieldError message={errors.designation} />
        </label>

        {form.designation ? (
          <div className="space-y-3">
            <span className={labelClass}>Pay</span>
            <div className="flex gap-2 rounded-xl border border-slate-200 bg-slate-50 p-1">
              <button
                type="button"
                onClick={() => setPayMode('level')}
                className={`flex-1 rounded-lg px-3 py-2 text-sm font-semibold transition-colors ${
                  form.pay_mode === 'level'
                    ? 'bg-white text-violet-800 shadow-sm'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Compensation level
              </button>
              <button
                type="button"
                onClick={() => setPayMode('custom')}
                className={`flex-1 rounded-lg px-3 py-2 text-sm font-semibold transition-colors ${
                  form.pay_mode === 'custom'
                    ? 'bg-white text-violet-800 shadow-sm'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Custom salary
              </button>
            </div>

            {form.pay_mode === 'level' ? (
              loadingCompensationLevels ? (
                <p className="text-sm text-slate-500">Loading levels…</p>
              ) : compensationLevels.length === 0 ? (
                <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                  No compensation levels for this designation.{' '}
                  <Link
                    to={`/hr/payroll/compensation-levels/new?designation=${form.designation}`}
                    className="font-semibold text-violet-700 underline"
                  >
                    Create one
                  </Link>
                  {' '}or use custom salary.
                </p>
              ) : (
                <label className="block">
                  <span className={labelClass}>Compensation level</span>
                  <select
                    className={inputClass('compensation_level')}
                    value={form.compensation_level}
                    onChange={(e) => set('compensation_level', e.target.value)}
                  >
                    {compensationLevels.map((level) => (
                      <option key={level.id} value={level.id}>
                        {formatCompensationLevelOption(level)}
                        {level.is_default_for_designation ? ' (default)' : ''}
                      </option>
                    ))}
                  </select>
                  <FieldError message={errors.compensation_level} />
                </label>
              )
            ) : (
              <div className="space-y-3">
                <p className="text-xs text-slate-500">
                  Set specific pay for this employee. Same components as a compensation level.
                </p>
                <div className="grid gap-3 sm:grid-cols-2">
                  <AmountField
                    label="Basic salary"
                    required
                    value={form.custom_salary.basic}
                    onChange={(e) => setCustomAmount('basic', e.target.value)}
                    onBlur={() => markTouched('custom_basic')}
                    error={errors.custom_basic}
                    inputClassName={inputClass('custom_basic').replace(/^mt-1 /, '')}
                  />
                  <AmountField
                    label="HRA"
                    value={form.custom_salary.hra}
                    onChange={(e) => setCustomAmount('hra', e.target.value)}
                    onBlur={() => markTouched('custom_hra')}
                    error={errors.custom_hra}
                    inputClassName={inputClass('custom_hra').replace(/^mt-1 /, '')}
                  />
                  <AmountField
                    label="Medical allowance"
                    value={form.custom_salary.medical}
                    onChange={(e) => setCustomAmount('medical', e.target.value)}
                    onBlur={() => markTouched('custom_medical')}
                    error={errors.custom_medical}
                    inputClassName={inputClass('custom_medical').replace(/^mt-1 /, '')}
                  />
                  <AmountField
                    label="Special allowance"
                    value={form.custom_salary.special_allowance}
                    onChange={(e) => setCustomAmount('special_allowance', e.target.value)}
                    onBlur={() => markTouched('custom_special_allowance')}
                    error={errors.custom_special_allowance}
                    inputClassName={inputClass('custom_special_allowance').replace(/^mt-1 /, '')}
                  />
                </div>
                {customGross > 0 ? (
                  <p className="text-sm text-slate-600">
                    Monthly gross: <span className="font-semibold text-slate-900">{formatCurrency(customGross)}</span>
                  </p>
                ) : null}
              </div>
            )}
          </div>
        ) : null}

        {!form.designation && (
          <label className="block">
            <span className={labelClass}>Job title (if not in list) *</span>
            <input
              className={inputClass('job_title')}
              value={form.job_title}
              maxLength={EMPLOYEE_FIELD_LIMITS.job_title}
              onChange={(e) => set('job_title', e.target.value)}
              onBlur={() => markTouched('job_title')}
            />
            <FieldError message={errors.job_title} />
          </label>
        )}

        <label className="block">
          <span className={labelClass}>Joining date *</span>
          <input
            type="date"
            className={inputClass('joining_date')}
            value={form.joining_date}
            onChange={(e) => set('joining_date', e.target.value)}
            onBlur={(e) => markTouched('joining_date', e.target.value)}
          />
          <FieldError message={errors.joining_date} />
        </label>

        <details className="rounded-lg border border-slate-100 p-3">
          <summary className="cursor-pointer text-sm font-medium text-slate-700">More fields</summary>
          <div className="mt-3 space-y-3">
            <label className="block">
              <span className={labelClass}>Employment type</span>
              <select
                className={inputClass('employment_type')}
                value={form.employment_type}
                onChange={(e) => set('employment_type', e.target.value)}
                onBlur={() => markTouched('employment_type')}
              >
                {EMP_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>
              <FieldError message={errors.employment_type} />
            </label>
            <label className="block">
              <span className={labelClass}>Manager</span>
              <input
                className={inputClass('manager_name')}
                value={form.manager_name}
                maxLength={EMPLOYEE_FIELD_LIMITS.manager_name}
                onChange={(e) => set('manager_name', e.target.value)}
                onBlur={() => markTouched('manager_name')}
              />
              <FieldError message={errors.manager_name} />
            </label>
            <label className="block">
              <span className={labelClass}>Address</span>
              <textarea
                rows={2}
                className={inputClass('address')}
                value={form.address}
                maxLength={EMPLOYEE_FIELD_LIMITS.address}
                onChange={(e) => set('address', e.target.value)}
                onBlur={() => markTouched('address')}
              />
              <FieldError message={errors.address} />
            </label>
            <label className="block">
              <span className={labelClass}>Emergency contact</span>
              <input
                className={inputClass('emergency_contact')}
                value={form.emergency_contact}
                maxLength={EMPLOYEE_FIELD_LIMITS.emergency_contact}
                onChange={(e) => set('emergency_contact', e.target.value)}
                onBlur={() => markTouched('emergency_contact')}
              />
              <FieldError message={errors.emergency_contact} />
            </label>
          </div>
        </details>

        <button
          type="submit"
          disabled={submitting || duplicate?.exists}
          className="w-full rounded-lg bg-violet-600 py-2.5 text-sm font-semibold text-white hover:bg-violet-700 disabled:opacity-50"
        >
          {submitting ? 'Creating…' : 'Create employee'}
        </button>
      </form>
    </div>
  );
}
