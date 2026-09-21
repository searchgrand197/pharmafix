import React, { useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { AlertTriangle, Link2, UserPlus, X } from 'lucide-react';
import {
  GENDER_OPTIONS,
  todayIsoDate,
  validateManualEmployeeField,
  validateManualEmployeeForm,
} from '../../utils/employeeFormValidation';
import {
  formatCompensationLevelOption,
  useCompensationLevelsForDesignation,
} from '../../pages/hr/payroll/useCompensationLevels';

function ModalShell({ title, subtitle, onClose, children, footer }) {
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
              <h2 className="text-lg font-bold text-slate-900">{title}</h2>
              {subtitle && <p className="mt-1 text-sm text-slate-600">{subtitle}</p>}
            </div>
            <button type="button" onClick={onClose} className="rounded-lg p-1 text-slate-400 hover:bg-slate-100">
              <X size={18} />
            </button>
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">{children}</div>
        {footer && <div className="shrink-0 border-t border-slate-100 px-4 py-3">{footer}</div>}
      </div>
    </div>
  );
}

function WarningBanner({ tone = 'amber', children }) {
  const tones = {
    amber: 'border-amber-200 bg-amber-50 text-amber-900',
    red: 'border-rose-200 bg-rose-50 text-rose-900',
  };
  return (
    <div className={`flex gap-2 rounded-lg border px-3 py-2 text-sm ${tones[tone] || tones.amber}`}>
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
      <div>{children}</div>
    </div>
  );
}

export function LinkEmployeeModal({
  open,
  conflict,
  employees,
  saving,
  onClose,
  onConfirm,
}) {
  const [employeeId, setEmployeeId] = useState('');

  useEffect(() => {
    if (open) setEmployeeId('');
  }, [open, conflict?.id]);

  const selected = useMemo(
    () => employees.find((e) => String(e.id) === String(employeeId)),
    [employees, employeeId],
  );

  const pinMismatch = selected?.biometric_pin
    && String(selected.biometric_pin) !== String(conflict?.pin);

  if (!open || !conflict) return null;

  return (
    <ModalShell
      title="Link to existing employee"
      subtitle={`Machine PIN ${conflict.pin} · ${conflict.name || 'Unknown name'}`}
      onClose={onClose}
      footer={(
        <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={!employeeId || saving}
            onClick={() => onConfirm(employeeId)}
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
          >
            <Link2 size={16} />
            {saving ? 'Linking…' : 'Link employee'}
          </button>
        </div>
      )}
    >
      <div className="space-y-4">
        <WarningBanner>
          This user was created on the biometric device, not in HR. Linking assigns machine PIN
          {' '}
          <strong>{conflict.pin}</strong>
          {' '}
          to the selected employee. Their punches will start counting after link.
        </WarningBanner>

        <label className="block text-sm">
          <span className="font-medium text-slate-700">Employee</span>
          <select
            className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
            value={employeeId}
            onChange={(e) => setEmployeeId(e.target.value)}
          >
            <option value="">Select employee</option>
            {employees.map((emp) => (
              <option key={emp.id} value={emp.id}>
                {emp.name} ({emp.employee_id})
                {emp.biometric_pin ? ` · PIN ${emp.biometric_pin}` : ''}
              </option>
            ))}
          </select>
        </label>

        {pinMismatch && (
          <WarningBanner tone="red">
            Selected employee already has biometric PIN
            {' '}
            <strong>{selected.biometric_pin}</strong>
            . Linking will replace it with machine PIN
            {' '}
            <strong>{conflict.pin}</strong>
            .
          </WarningBanner>
        )}
      </div>
    </ModalShell>
  );
}

export function CreateEmployeeFromConflictModal({
  open,
  conflict,
  departments,
  designations,
  saving,
  serverErrors = {},
  onClose,
  onConfirm,
}) {
  const [form, setForm] = useState({
    name: '',
    email: '',
    phone: '',
    gender: '',
    department: '',
    designation: '',
    compensation_level: '',
    job_title: '',
    joining_date: todayIsoDate(),
    employment_type: 'full_time',
  });
  const [errors, setErrors] = useState({});

  const {
    levels: compensationLevels,
    loading: loadingCompensationLevels,
    defaultLevelId,
  } = useCompensationLevelsForDesignation(form.designation);

  useEffect(() => {
    if (!form.designation) return;
    if (!defaultLevelId) return;
    setForm((prev) => {
      const stillValid = prev.compensation_level
        && compensationLevels.some((row) => String(row.id) === String(prev.compensation_level));
      if (stillValid) return prev;
      return { ...prev, compensation_level: defaultLevelId };
    });
  }, [form.designation, defaultLevelId, compensationLevels]);

  useEffect(() => {
    if (!open || !conflict) return;
    setForm({
      name: conflict.name || '',
      email: '',
      phone: '',
      gender: '',
      department: '',
      designation: '',
      compensation_level: '',
      job_title: '',
      joining_date: todayIsoDate(),
      employment_type: 'full_time',
    });
    setErrors({});
  }, [open, conflict]);

  const displayErrors = useMemo(
    () => ({ ...errors, ...serverErrors }),
    [errors, serverErrors],
  );

  function updateField(key, value) {
    const nextForm = { ...form, [key]: value };
    setForm(nextForm);
    setErrors((prev) => ({
      ...prev,
      [key]: validateManualEmployeeField(key, nextForm, { departments, designations }),
    }));
  }

  function handleSubmit(event) {
    event.preventDefault();
    const nextErrors = validateManualEmployeeForm(form, { departments, designations });
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) {
      toast.error('Please complete all required fields.');
      return;
    }
    onConfirm(form);
  }

  if (!open || !conflict) return null;

  return (
    <ModalShell
      title="Create employee from device user"
      subtitle={`Machine PIN ${conflict.pin}`}
      onClose={onClose}
      footer={null}
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <WarningBanner>
          A new HR employee will be created and linked to machine PIN
          {' '}
          <strong>{conflict.pin}</strong>
          . Fingerprint enrollment on the device will be kept.
        </WarningBanner>

        {[
          ['name', 'Full name', 'text'],
          ['email', 'Email', 'email'],
          ['phone', 'Mobile', 'tel'],
        ].map(([key, label, type]) => (
          <label key={key} className="block text-sm">
            <span className="font-medium text-slate-700">{label}</span>
            <input
              type={type}
              className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
              value={form[key]}
              onChange={(e) => updateField(key, e.target.value)}
            />
            {displayErrors[key] && <p className="mt-1 text-xs text-rose-600">{displayErrors[key]}</p>}
          </label>
        ))}

        <label className="block text-sm">
          <span className="font-medium text-slate-700">Gender</span>
          <select
            className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
            value={form.gender}
            onChange={(e) => updateField('gender', e.target.value)}
          >
            <option value="">Select gender</option>
            {GENDER_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
          {displayErrors.gender && <p className="mt-1 text-xs text-rose-600">{displayErrors.gender}</p>}
        </label>

        <label className="block text-sm">
          <span className="font-medium text-slate-700">Department</span>
          <select
            className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
            value={form.department}
            onChange={(e) => updateField('department', e.target.value)}
          >
            <option value="">Select department</option>
            {departments.map((dept) => (
              <option key={dept.id} value={dept.id}>{dept.name}</option>
            ))}
          </select>
          {displayErrors.department && <p className="mt-1 text-xs text-rose-600">{displayErrors.department}</p>}
        </label>

        <label className="block text-sm">
          <span className="font-medium text-slate-700">Designation</span>
          <select
            className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
            value={form.designation}
            onChange={(e) => {
              const designationId = e.target.value;
              const picked = designations.find((d) => String(d.id) === String(designationId));
              setForm((prev) => ({
                ...prev,
                designation: designationId,
                compensation_level: '',
                job_title: picked?.name || prev.job_title,
              }));
              setErrors((prev) => ({ ...prev, designation: null, job_title: null, compensation_level: null }));
            }}
          >
            <option value="">Select designation</option>
            {designations.map((d) => (
              <option key={d.id} value={d.id}>{d.name}</option>
            ))}
          </select>
          {displayErrors.designation && <p className="mt-1 text-xs text-rose-600">{displayErrors.designation}</p>}
        </label>

        {form.designation && compensationLevels.length > 0 && (
          <label className="block text-sm">
            <span className="font-medium text-slate-700">Compensation level</span>
            <select
              className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
              value={form.compensation_level}
              onChange={(e) => updateField('compensation_level', e.target.value)}
              disabled={loadingCompensationLevels}
            >
              {compensationLevels.map((level) => (
                <option key={level.id} value={level.id}>
                  {formatCompensationLevelOption(level)}
                  {level.is_default_for_designation ? ' (default)' : ''}
                </option>
              ))}
            </select>
            {displayErrors.compensation_level && (
              <p className="mt-1 text-xs text-rose-600">{displayErrors.compensation_level}</p>
            )}
          </label>
        )}

        <label className="block text-sm">
          <span className="font-medium text-slate-700">Joining date</span>
          <input
            type="date"
            className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
            value={form.joining_date}
            onChange={(e) => updateField('joining_date', e.target.value)}
          />
          {displayErrors.joining_date && <p className="mt-1 text-xs text-rose-600">{displayErrors.joining_date}</p>}
        </label>

        <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={saving}
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
          >
            <UserPlus size={16} />
            {saving ? 'Creating…' : 'Create and link'}
          </button>
        </div>
      </form>
    </ModalShell>
  );
}

export function RejectConflictModal({
  open,
  conflict,
  saving,
  onClose,
  onConfirm,
}) {
  if (!open || !conflict) return null;

  return (
    <ModalShell
      title="Reject device user"
      subtitle={`PIN ${conflict.pin}`}
      onClose={onClose}
      footer={(
        <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={onConfirm}
            className="rounded-xl bg-rose-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
          >
            {saving ? 'Rejecting…' : 'Reject and remove from device'}
          </button>
        </div>
      )}
    >
      <WarningBanner tone="red">
        Rejecting removes PIN
        {' '}
        <strong>{conflict.pin}</strong>
        {' '}
        (
        {conflict.name || 'Unknown'}
        ) from the device. Attendance from this PIN will not be recorded. The user must be
        re-enrolled on the machine if needed later.
      </WarningBanner>
    </ModalShell>
  );
}
