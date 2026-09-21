import React, { useMemo, useState } from 'react';
import { AlertTriangle, ChevronDown, ChevronRight, Clock, Info } from 'lucide-react';
import {
  COMPLIANCE_PRESETS,
  computeLatePenaltyPreview,
  computeOvertimePreview,
  formatCurrency,
} from './payrollUtils';

export const complianceDefaults = {
  late_policy_enabled: false,
  grace_minutes: '',
  late_penalty_threshold_minutes: 15,
  late_penalty_type: 'per_minute',
  late_penalty_value: '0',
  late_conversion_enabled: false,
  late_count_for_half_day: '',
  late_count_for_full_day: '',
  warning_after_n_lates: '',
  half_day_after_n_lates: '',
  full_day_after_n_lates: '',
  overtime_enabled: true,
  overtime_type: 'fixed_per_hour',
  overtime_rate: '100',
  weekend_ot_multiplier: '1',
  holiday_ot_multiplier: '1',
};

export function compliancePayloadFromForm(form, { variant = 'full' } = {}) {
  const latePenaltyValue = form.late_penalty_value || '0';
  const overtimeRate = Number(form.overtime_rate) || 0;

  const payload = variant === 'simple'
    ? {
      late_policy_enabled: Number(latePenaltyValue) > 0,
      late_penalty_threshold_minutes: 0,
      late_penalty_type: 'per_minute',
      late_penalty_value: latePenaltyValue,
      late_conversion_enabled: !!form.late_conversion_enabled,
      overtime_enabled: overtimeRate > 0,
      overtime_type: 'fixed_per_hour',
      weekend_ot_multiplier: '1',
      holiday_ot_multiplier: '1',
    }
    : {
      late_policy_enabled: !!form.late_policy_enabled,
      late_penalty_threshold_minutes: Number(form.late_penalty_threshold_minutes) || 15,
      late_penalty_type: form.late_penalty_type || 'per_minute',
      late_penalty_value: latePenaltyValue,
      late_conversion_enabled: !!form.late_conversion_enabled,
      overtime_enabled: form.overtime_enabled !== false,
      overtime_type: form.overtime_type || 'fixed_per_hour',
      weekend_ot_multiplier: form.weekend_ot_multiplier || '1',
      holiday_ot_multiplier: form.holiday_ot_multiplier || '1',
    };
  if (form.grace_minutes !== '' && form.grace_minutes != null) {
    payload.grace_minutes = Number(form.grace_minutes);
  }
  ['late_count_for_half_day', 'late_count_for_full_day', 'warning_after_n_lates', 'half_day_after_n_lates', 'full_day_after_n_lates'].forEach((key) => {
    if (form[key] !== '' && form[key] != null) {
      payload[key] = Number(form[key]);
    }
  });
  return payload;
}

export function complianceFormFromStructure(row = {}) {
  return {
    ...complianceDefaults,
    late_policy_enabled: !!row.late_policy_enabled,
    grace_minutes: row.grace_minutes ?? '',
    late_penalty_threshold_minutes: row.late_penalty_threshold_minutes ?? 15,
    late_penalty_type: row.late_penalty_type || 'per_minute',
    late_penalty_value: row.late_penalty_value ?? '0',
    late_conversion_enabled: !!row.late_conversion_enabled,
    late_count_for_half_day: row.late_count_for_half_day ?? '',
    late_count_for_full_day: row.late_count_for_full_day ?? '',
    warning_after_n_lates: row.warning_after_n_lates ?? '',
    half_day_after_n_lates: row.half_day_after_n_lates ?? '',
    full_day_after_n_lates: row.full_day_after_n_lates ?? '',
    overtime_enabled: row.overtime_enabled !== false,
    overtime_type: row.overtime_type || 'fixed_per_hour',
    overtime_rate: row.overtime_rate ?? '100',
    weekend_ot_multiplier: row.weekend_ot_multiplier ?? '1',
    holiday_ot_multiplier: row.holiday_ot_multiplier ?? '1',
  };
}

function Field({ label, hint, children }) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block font-medium text-gray-800">{label}</span>
      {children}
      {hint && <p className="mt-1 text-xs text-gray-500">{hint}</p>}
    </label>
  );
}

function SectionCard({ title, subtitle, open, onToggle, children }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white overflow-hidden">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center justify-between px-4 py-3 text-left hover:bg-gray-50"
      >
        <div>
          <p className="text-sm font-bold text-gray-900">{title}</p>
          {subtitle && <p className="mt-0.5 text-xs text-gray-500">{subtitle}</p>}
        </div>
        {open ? <ChevronDown size={18} className="text-gray-400" /> : <ChevronRight size={18} className="text-gray-400" />}
      </button>
      {open && <div className="space-y-4 border-t border-gray-100 px-4 py-4">{children}</div>}
    </div>
  );
}

function PenaltyTypeCard({ value, selected, title, description, onSelect }) {
  const active = selected === value;
  return (
    <button
      type="button"
      onClick={() => onSelect(value)}
      className={`rounded-lg border p-3 text-left text-sm transition-colors ${
        active ? 'border-purple-400 bg-purple-50 ring-2 ring-purple-100' : 'border-gray-200 hover:border-purple-200'
      }`}
    >
      <p className="font-semibold text-gray-900">{title}</p>
      <p className="mt-1 text-xs text-gray-600">{description}</p>
    </button>
  );
}

function SimpleComplianceFields({ form, setForm }) {
  const inputClass =
    'min-h-[40px] w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-purple-400 focus:outline-none focus:ring-2 focus:ring-purple-100';

  function update(key, value) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  return (
    <div className="rounded-xl border border-purple-100 bg-purple-50/50 p-4">
      <h3 className="text-sm font-bold text-gray-900">Attendance rules (optional)</h3>
      <p className="mt-1 text-xs text-gray-600">
        Overtime hours are calculated from attendance. Set pay rates and late penalties here.
      </p>
      <div className="mt-4 grid gap-4 sm:grid-cols-3">
        <Field label="Overtime per hour (₹)" hint="Extra pay per overtime hour (from attendance)">
          <input
            type="number"
            step="0.01"
            min="0"
            value={form.overtime_rate}
            onChange={(e) => update('overtime_rate', e.target.value)}
            className={inputClass}
          />
        </Field>
        <Field label="Grace minutes" hint="Free minutes before a late is counted">
          <input
            type="number"
            min="0"
            value={form.grace_minutes}
            onChange={(e) => update('grace_minutes', e.target.value)}
            className={inputClass}
            placeholder="0"
          />
        </Field>
        <Field label="Late penalty per minute (₹)" hint="₹ deducted per minute after grace period">
          <input
            type="number"
            step="0.01"
            min="0"
            value={form.late_penalty_value}
            onChange={(e) => update('late_penalty_value', e.target.value)}
            className={inputClass}
            placeholder="0"
          />
        </Field>
      </div>
    </div>
  );
}

export default function AttendanceComplianceFields({ form, setForm, estimatedPerDaySalary = 0, variant = 'full' }) {
  if (variant === 'simple') {
    return <SimpleComplianceFields form={form} setForm={setForm} />;
  }
  return (
    <FullComplianceFields
      form={form}
      setForm={setForm}
      estimatedPerDaySalary={estimatedPerDaySalary}
    />
  );
}

function FullComplianceFields({ form, setForm, estimatedPerDaySalary = 0 }) {
  const [preset, setPreset] = useState('custom');
  const [lateOpen, setLateOpen] = useState(true);
  const [otOpen, setOtOpen] = useState(true);
  const [advancedOpen, setAdvancedOpen] = useState(false);

  function update(key, value) {
    setPreset('custom');
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function applyPreset(key) {
    const p = COMPLIANCE_PRESETS[key];
    if (!p) return;
    setPreset(key);
    setForm((prev) => ({ ...prev, ...p.values }));
  }

  const latePreview = useMemo(
    () => computeLatePenaltyPreview(form, { perDaySalary: estimatedPerDaySalary }),
    [form, estimatedPerDaySalary],
  );
  const otPreview = useMemo(() => computeOvertimePreview(form), [form]);

  const inputClass =
    'min-h-[40px] w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-purple-400 focus:outline-none focus:ring-2 focus:ring-purple-100';

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-purple-100 bg-purple-50/50 p-4">
        <h3 className="text-sm font-bold text-gray-900">Attendance & overtime rules</h3>
        <p className="mt-1 text-xs text-gray-600">
          Set how late arrivals reduce pay and how overtime is paid. OT hours are counted automatically from attendance — you only set the pay rate here.
        </p>
        <label className="mt-3 block text-sm">
          <span className="mb-1 block font-medium text-gray-800">Start from template</span>
          <select
            value={preset}
            onChange={(e) => {
              const val = e.target.value;
              if (val === 'custom') setPreset('custom');
              else applyPreset(val);
            }}
            className={inputClass}
          >
            <option value="custom">Custom (edit fields below)</option>
            {Object.entries(COMPLIANCE_PRESETS).map(([key, p]) => (
              <option key={key} value={key}>{p.label} — {p.description}</option>
            ))}
          </select>
        </label>
      </div>

      <SectionCard
        title="Late arrival deductions"
        subtitle="When an employee arrives late, how should pay be reduced?"
        open={lateOpen}
        onToggle={() => setLateOpen((v) => !v)}
      >
        <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-gray-100 bg-gray-50 p-3 text-sm">
          <input
            type="checkbox"
            checked={!!form.late_policy_enabled}
            onChange={(e) => update('late_policy_enabled', e.target.checked)}
            className="mt-0.5 h-4 w-4"
          />
          <span>
            <span className="font-medium text-gray-900">Use custom late deduction rules</span>
            <span className="mt-0.5 block text-xs text-gray-500">Off = system default penalty at payroll (recommended for most teams)</span>
          </span>
        </label>

        {form.late_policy_enabled && (
          <>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Free minutes before late counts" hint="Leave empty to use employee shift default">
                <input type="number" min="0" value={form.grace_minutes} onChange={(e) => update('grace_minutes', e.target.value)} className={inputClass} placeholder="From shift" />
              </Field>
              <Field label="Penalty starts after (minutes)" hint="Minutes above free time before ₹ penalty applies">
                <input type="number" min="0" value={form.late_penalty_threshold_minutes} onChange={(e) => update('late_penalty_threshold_minutes', e.target.value)} className={inputClass} />
              </Field>
            </div>

            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">Penalty style</p>
              <div className="grid gap-2 sm:grid-cols-3">
                <PenaltyTypeCard
                  value="per_minute"
                  selected={form.late_penalty_type}
                  title="Per minute"
                  description="₹X for each minute after the free threshold"
                  onSelect={(v) => update('late_penalty_type', v)}
                />
                <PenaltyTypeCard
                  value="fixed_per_late_day"
                  selected={form.late_penalty_type}
                  title="Fixed per late day"
                  description="Same ₹ amount each day marked late"
                  onSelect={(v) => update('late_penalty_type', v)}
                />
                <PenaltyTypeCard
                  value="percentage_daily_salary"
                  selected={form.late_penalty_type}
                  title="% of daily pay"
                  description="Percent of one day's salary per late day"
                  onSelect={(v) => update('late_penalty_type', v)}
                />
              </div>
            </div>

            <Field
              label={form.late_penalty_type === 'percentage_daily_salary' ? 'Penalty percent (%)' : 'Penalty amount (₹)'}
              hint={form.late_penalty_type === 'per_minute' ? 'Typical: ₹1–₹5 per minute. Values above ₹50/min are unusual.' : undefined}
            >
              <input type="number" step="0.01" min="0" value={form.late_penalty_value} onChange={(e) => update('late_penalty_value', e.target.value)} className={inputClass} />
            </Field>

            <div className="rounded-lg border border-amber-100 bg-amber-50 px-3 py-2 text-sm text-amber-950">
              <p className="font-semibold">Example preview</p>
              <p className="mt-1 text-xs">{latePreview.explanation}</p>
              <p className="mt-1 font-bold">≈ {formatCurrency(latePreview.amount)} for one {latePreview.exampleMinutes}-minute late day</p>
            </div>
          </>
        )}
      </SectionCard>

      <SectionCard
        title="Overtime pay"
        subtitle="How much extra pay per overtime hour?"
        open={otOpen}
        onToggle={() => setOtOpen((v) => !v)}
      >
        <div className="flex gap-2 rounded-lg border border-blue-100 bg-blue-50 px-3 py-2 text-xs text-blue-900">
          <Info size={16} className="mt-0.5 shrink-0" />
          <p>
            <strong>OT hours are not entered here.</strong> They are calculated automatically from employee check-in/check-out in attendance. You only set how much to pay per hour.
          </p>
        </div>

        <label className="flex cursor-pointer items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={form.overtime_enabled !== false}
            onChange={(e) => update('overtime_enabled', e.target.checked)}
            className="h-4 w-4"
          />
          <span className="font-medium text-gray-900">Pay overtime</span>
        </label>

        {form.overtime_enabled !== false && (
          <>
            <Field label="Rate per OT hour (₹)" hint="Required — if ₹0, employees with OT hours receive no extra pay">
              <input type="number" step="0.01" min="0" value={form.overtime_rate} onChange={(e) => update('overtime_rate', e.target.value)} className={inputClass} />
            </Field>

            {otPreview.warning && (
              <div className="flex gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-900">
                <AlertTriangle size={16} className="mt-0.5 shrink-0" />
                <p>{otPreview.warning}</p>
              </div>
            )}

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Weekend multiplier" hint="2 = double pay on weekends">
                <input type="number" step="0.01" min="0" value={form.weekend_ot_multiplier} onChange={(e) => update('weekend_ot_multiplier', e.target.value)} className={inputClass} />
              </Field>
              <Field label="Holiday multiplier" hint="2 = double pay on holidays">
                <input type="number" step="0.01" min="0" value={form.holiday_ot_multiplier} onChange={(e) => update('holiday_ot_multiplier', e.target.value)} className={inputClass} />
              </Field>
            </div>

            <div className="rounded-lg border border-emerald-100 bg-emerald-50 px-3 py-2 text-sm text-emerald-950">
              <p className="flex items-center gap-1 font-semibold"><Clock size={14} /> Pay examples (hours from attendance)</p>
              <ul className="mt-2 space-y-1 text-xs">
                {otPreview.examples.map((ex) => (
                  <li key={ex.label}>{ex.label} → <strong>{formatCurrency(ex.amount)}</strong></li>
                ))}
              </ul>
            </div>
          </>
        )}
      </SectionCard>

      <SectionCard
        title="Optional monthly late rules"
        subtitle="Convert repeated lates to leave days or send warnings"
        open={advancedOpen}
        onToggle={() => setAdvancedOpen((v) => !v)}
      >
        <label className="flex cursor-pointer items-center gap-2 text-sm">
          <input type="checkbox" checked={!!form.late_conversion_enabled} onChange={(e) => update('late_conversion_enabled', e.target.checked)} className="h-4 w-4" />
          <span className="font-medium">Convert monthly late count to leave-day deductions</span>
        </label>
        {form.late_conversion_enabled && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Lates for half-day deduction" hint="e.g. 3 lates = 0.5 day pay cut">
              <input type="number" min="1" value={form.late_count_for_half_day} onChange={(e) => update('late_count_for_half_day', e.target.value)} className={inputClass} />
            </Field>
            <Field label="Lates for full-day deduction" hint="e.g. 6 lates = 1 day pay cut">
              <input type="number" min="1" value={form.late_count_for_full_day} onChange={(e) => update('late_count_for_full_day', e.target.value)} className={inputClass} />
            </Field>
          </div>
        )}
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Warn employee after N lates">
            <input type="number" min="1" value={form.warning_after_n_lates} onChange={(e) => update('warning_after_n_lates', e.target.value)} className={inputClass} />
          </Field>
          <Field label="Half-day escalation after N lates">
            <input type="number" min="1" value={form.half_day_after_n_lates} onChange={(e) => update('half_day_after_n_lates', e.target.value)} className={inputClass} />
          </Field>
          <Field label="Full-day escalation after N lates">
            <input type="number" min="1" value={form.full_day_after_n_lates} onChange={(e) => update('full_day_after_n_lates', e.target.value)} className={inputClass} />
          </Field>
        </div>
      </SectionCard>
    </div>
  );
}
