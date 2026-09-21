import React, { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { ArrowLeft, BookOpen, Plus, Save, X } from 'lucide-react';
import api, { getHospitalId } from '../../../api';
import { TableSkeleton } from '../../../components/HR/HRSkeleton';
import { withPreservedReturn } from '../setupWizardUtils';
import { errorText, normalizeList } from './leaveUtils';
import {
  buildPolicyLines,
  buildPolicyPayload,
  formFromPolicy,
  toggleIdInList,
  WHO_GETS_OPTIONS,
} from './leavePolicyUtils';

export default function LeavePolicyFormPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const listRoute = withPreservedReturn('/hr/leave/policies', searchParams);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [leaveTypes, setLeaveTypes] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [designations, setDesignations] = useState([]);
  const [form, setForm] = useState(() => formFromPolicy(null));

  const load = useCallback(async () => {
    setLoading(true);
    const results = await Promise.allSettled([
      api.get('/hr/leave-types/', { params: { active: 'true' } }),
      api.get('/hr/departments/'),
      api.get('/hr/designations/', { params: { active: 'true' } }),
    ]);
    let types = [];
    if (results[0].status === 'fulfilled') {
      types = normalizeList(results[0].value.data);
      setLeaveTypes(types);
    } else {
      setLeaveTypes([]);
      toast.error('Could not load leave types');
    }
    if (results[1].status === 'fulfilled') setDepartments(normalizeList(results[1].value.data));
    if (results[2].status === 'fulfilled') setDesignations(normalizeList(results[2].value.data));
    setForm((prev) => ({
      ...prev,
      lines: prev.lines.length ? prev.lines : buildPolicyLines(types, 'standard'),
    }));
    setLoading(false);
  }, []);

  useEffect(() => {
    document.title = 'New Leave Package | HR';
    load();
  }, [load]);

  function patchForm(patch) {
    setForm((prev) => ({ ...prev, ...patch }));
  }

  function availableTypes(lineIndex) {
    const used = form.lines.map((l, i) => (i !== lineIndex ? l.leave_type : null)).filter(Boolean);
    return leaveTypes.filter((lt) => !used.includes(lt.id));
  }

  async function setupDefaults() {
    try {
      const hospitalId = getHospitalId();
      await api.post('/hr/leave-types/seed-defaults/', hospitalId ? { hospital_id: hospitalId } : {});
      toast.success('Default leave types created');
      await load();
    } catch (err) {
      toast.error(errorText(err, 'Could not set up leave types'));
    }
  }

  async function handleCreateLeaveType(name) {
    try {
      const { data } = await api.post('/hr/leave-types/', {
        name,
        is_paid: true,
        is_active: true,
        code: '',
      });
      toast.success('Leave type created');
      await load();
      return data;
    } catch (err) {
      toast.error(errorText(err, 'Could not create leave type'));
      return null;
    }
  }

  async function handleSubmit(event) {
    event.preventDefault();
    if (!form.lines.filter((l) => l.leave_type).length) {
      toast.error('Add at least one leave type');
      return;
    }
    if (form.assignment_type === 'DEPARTMENT' && form.departments.length === 0) {
      toast.error('Select at least one department');
      return;
    }
    if (form.assignment_type === 'DESIGNATION' && form.designations.length === 0) {
      toast.error('Select at least one designation');
      return;
    }
    setSaving(true);
    try {
      const { data } = await api.post('/hr/leave-policies/', buildPolicyPayload(form));
      toast.success('Leave package created and applied to employees');
      navigate(listRoute, { state: { selectedPolicyId: data.id } });
    } catch (err) {
      toast.error(errorText(err, 'Could not create package'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-5 pb-12">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link
            to={listRoute}
            className="mb-2 inline-flex items-center gap-1.5 text-sm font-medium text-slate-600 hover:text-violet-700"
          >
            <ArrowLeft size={16} />
            Back to leave policies
          </Link>
          <h1 className="flex items-center gap-2 text-2xl font-bold text-slate-900">
            <BookOpen className="text-violet-600" size={24} />
            New leave package
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            Assign by departments or designations, set leave days, then create.
          </p>
        </div>
      </div>

      {loading ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-4">
          <TableSkeleton rows={6} cols={2} />
        </div>
      ) : leaveTypes.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-12 text-center">
          <BookOpen className="mx-auto h-10 w-10 text-slate-300" />
          <p className="mt-3 font-semibold text-slate-900">Set up leave types first</p>
          <p className="mt-1 text-sm text-slate-600">
            Creates Casual, Medical, Earned, and LWP leave types for your hospital.
          </p>
          <button
            type="button"
            onClick={setupDefaults}
            className="mt-4 rounded-xl bg-violet-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-violet-700"
          >
            Set up default leave types
          </button>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          {form.lines.length === 0 && (
            <button
              type="button"
              onClick={() => patchForm({ lines: buildPolicyLines(leaveTypes, 'standard') })}
              className="w-full rounded-xl border border-violet-200 bg-violet-50 px-3 py-2.5 text-left text-sm hover:bg-violet-100"
            >
              <span className="font-semibold text-violet-900">Use standard package</span>
              <span className="mt-0.5 block text-xs text-violet-700">
                Casual 12 · Medical 12 · Earned 18 · LWP unlimited
              </span>
            </button>
          )}

          <label className="block text-sm">
            <span className="font-medium text-slate-700">Package name *</span>
            <input
              required
              placeholder="e.g. Standard Leave Policy"
              className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-violet-400"
              value={form.name}
              onChange={(e) => patchForm({ name: e.target.value })}
            />
          </label>

          <fieldset className="space-y-2">
            <legend className="text-sm font-medium text-slate-700">Who gets this? *</legend>
            <div className="grid gap-2 sm:grid-cols-2">
              {WHO_GETS_OPTIONS.map((opt) => (
                <label
                  key={opt.value}
                  className={`flex cursor-pointer items-start gap-2 rounded-xl border px-3 py-2.5 text-sm ${
                    form.assignment_type === opt.value
                      ? 'border-violet-300 bg-violet-50'
                      : 'border-slate-200 bg-white'
                  }`}
                >
                  <input
                    type="radio"
                    name="assignment_type"
                    className="mt-0.5"
                    checked={form.assignment_type === opt.value}
                    onChange={() => patchForm({
                      assignment_type: opt.value,
                      departments: opt.value === 'DEPARTMENT' ? form.departments : [],
                      designations: opt.value === 'DESIGNATION' ? form.designations : [],
                    })}
                  />
                  <span>
                    <span className="font-semibold text-slate-900">{opt.label}</span>
                    {opt.value === 'DESIGNATION' && (
                      <span className="mt-0.5 block text-xs text-slate-600">
                        Overrides department packages for people in these designations.
                      </span>
                    )}
                  </span>
                </label>
              ))}
            </div>
          </fieldset>

          {form.assignment_type === 'DEPARTMENT' && (
            <div>
              <p className="text-sm font-medium text-slate-700">Departments *</p>
              <div className="mt-2 max-h-56 space-y-1 overflow-y-auto rounded-xl border border-slate-200 p-2">
                {departments.length === 0 ? (
                  <p className="px-2 py-3 text-sm text-slate-500">No departments found.</p>
                ) : departments.map((d) => {
                  const checked = form.departments.includes(String(d.id));
                  return (
                    <label
                      key={d.id}
                      className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-slate-50"
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => patchForm({
                          departments: toggleIdInList(form.departments, String(d.id)),
                        })}
                      />
                      <span>{d.name}</span>
                    </label>
                  );
                })}
              </div>
            </div>
          )}

          {form.assignment_type === 'DESIGNATION' && (
            <div>
              <p className="text-sm font-medium text-slate-700">Designations *</p>
              <div className="mt-2 max-h-56 space-y-1 overflow-y-auto rounded-xl border border-slate-200 p-2">
                {designations.length === 0 ? (
                  <p className="px-2 py-3 text-sm text-slate-500">No designations found.</p>
                ) : designations.map((d) => {
                  const checked = form.designations.includes(String(d.id));
                  return (
                    <label
                      key={d.id}
                      className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-slate-50"
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => patchForm({
                          designations: toggleIdInList(form.designations, String(d.id)),
                        })}
                      />
                      <span>{d.name}</span>
                    </label>
                  );
                })}
              </div>
            </div>
          )}

          <div>
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold text-slate-900">Leave types & days</p>
              <button
                type="button"
                onClick={() => patchForm({
                  lines: [...form.lines, { leave_type: '', allocated_days: '', is_unlimited: false }],
                })}
                className="inline-flex items-center gap-1 text-xs font-semibold text-violet-700 hover:underline"
              >
                <Plus size={12} />
                Add type
              </button>
            </div>
            <div className="mt-2 space-y-2">
              {form.lines.length === 0 ? (
                <p className="rounded-xl border border-dashed border-slate-200 px-3 py-4 text-center text-sm text-slate-500">
                  No leave types yet — add one or use standard package.
                </p>
              ) : form.lines.map((line, index) => (
                <div
                  key={line.id || `line-${index}`}
                  className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-100 bg-slate-50 px-3 py-2"
                >
                  <select
                    required
                    className="min-w-[120px] flex-1 rounded-lg border border-slate-200 px-2 py-1.5 text-sm"
                    value={line.leave_type}
                    onChange={async (e) => {
                      const val = e.target.value;
                      if (val === 'CREATE_NEW') {
                        const name = window.prompt('New leave type name (e.g. Study Leave):');
                        if (name?.trim()) {
                          const newType = await handleCreateLeaveType(name.trim());
                          if (newType) {
                            const lines = [...form.lines];
                            lines[index] = {
                              ...lines[index],
                              leave_type: newType.id,
                              leave_type_name: newType.name,
                            };
                            patchForm({ lines });
                          }
                        }
                        return;
                      }
                      const lines = [...form.lines];
                      const selected = leaveTypes.find((lt) => lt.id === val);
                      lines[index] = {
                        ...lines[index],
                        leave_type: val,
                        leave_type_name: selected?.name,
                      };
                      patchForm({ lines });
                    }}
                  >
                    <option value="">Select leave…</option>
                    {availableTypes(index).map((lt) => (
                      <option key={lt.id} value={lt.id}>{lt.name}</option>
                    ))}
                    {line.leave_type && !availableTypes(index).find((lt) => lt.id === line.leave_type) && (
                      <option value={line.leave_type}>{line.leave_type_name}</option>
                    )}
                    <option value="CREATE_NEW">+ Create new type…</option>
                  </select>
                  {line.is_unlimited ? (
                    <span className="w-20 text-sm font-medium text-emerald-700">Unlimited</span>
                  ) : (
                    <input
                      type="number"
                      required
                      min="0"
                      step="0.5"
                      placeholder="Days"
                      className="w-20 rounded-lg border border-slate-200 px-2 py-1.5 text-sm"
                      value={line.allocated_days}
                      onChange={(e) => {
                        const lines = [...form.lines];
                        lines[index] = {
                          ...lines[index],
                          allocated_days: e.target.value,
                          is_unlimited: false,
                        };
                        patchForm({ lines });
                      }}
                    />
                  )}
                  <label className="flex items-center gap-1 text-xs text-slate-600">
                    <input
                      type="checkbox"
                      checked={!!line.is_unlimited}
                      onChange={(e) => {
                        const lines = [...form.lines];
                        lines[index] = {
                          ...lines[index],
                          is_unlimited: e.target.checked,
                          allocated_days: e.target.checked ? '' : lines[index].allocated_days,
                        };
                        patchForm({ lines });
                      }}
                    />
                    No limit
                  </label>
                  <button
                    type="button"
                    onClick={() => patchForm({ lines: form.lines.filter((_, i) => i !== index) })}
                    className="ml-auto p-1 text-slate-400 hover:text-red-600"
                    aria-label="Remove leave type"
                  >
                    <X size={16} />
                  </button>
                </div>
              ))}
            </div>
          </div>

          <div className="flex gap-2 pt-2">
            <Link
              to={listRoute}
              className="flex min-h-[48px] flex-1 items-center justify-center rounded-xl border border-slate-200 text-sm font-semibold text-slate-700 hover:bg-slate-50"
            >
              Cancel
            </Link>
            <button
              type="submit"
              disabled={saving}
              className="flex min-h-[48px] flex-[2] items-center justify-center gap-2 rounded-xl bg-violet-600 text-sm font-semibold text-white hover:bg-violet-700 disabled:opacity-50"
            >
              <Save size={16} />
              {saving ? 'Creating…' : 'Create package'}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
