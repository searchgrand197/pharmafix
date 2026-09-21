import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import api, { getHospitalId } from '../../../api';
import toast from 'react-hot-toast';
import {
  BookOpen,
  ChevronRight,
  Plus,
  Save,
  Search,
  Trash2,
  X,
} from 'lucide-react';
import { TableSkeleton } from '../../../components/HR/HRSkeleton';
import SetupWizardNav from '../../../components/HR/SetupWizardNav';
import { withPreservedReturn } from '../setupWizardUtils';
import { errorText, normalizeList } from './leaveUtils';
import {
  buildPolicyPayload,
  formatEntitlementSummary,
  formatPolicyWho,
  formFromPolicy,
  isPolicyFormDirty,
  toggleIdInList,
  WHO_GETS_OPTIONS,
} from './leavePolicyUtils';

function assignmentFilterType(row) {
  return row.assignment_type || 'DEPARTMENT';
}

export default function LeavePoliciesPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const newPackageRoute = withPreservedReturn('/hr/leave/policies/new', searchParams);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [policies, setPolicies] = useState([]);
  const [leaveTypes, setLeaveTypes] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [designations, setDesignations] = useState([]);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');
  const [selectedId, setSelectedId] = useState(location.state?.selectedPolicyId || null);
  const [form, setForm] = useState(() => formFromPolicy(null));
  const [baseline, setBaseline] = useState(() => formFromPolicy(null));
  const autoOpenedCreate = useRef(false);

  const load = useCallback(async () => {
    setLoading(true);
    const results = await Promise.allSettled([
      api.get('/hr/leave-policies/'),
      api.get('/hr/leave-types/', { params: { active: 'true' } }),
      api.get('/hr/departments/'),
      api.get('/hr/designations/', { params: { active: 'true' } }),
    ]);
    if (results[0].status === 'fulfilled') setPolicies(normalizeList(results[0].value.data));
    else {
      setPolicies([]);
      toast.error('Could not load leave packages');
    }
    if (results[1].status === 'fulfilled') setLeaveTypes(normalizeList(results[1].value.data));
    if (results[2].status === 'fulfilled') setDepartments(normalizeList(results[2].value.data));
    if (results[3].status === 'fulfilled') setDesignations(normalizeList(results[3].value.data));
    setLoading(false);
  }, []);

  useEffect(() => {
    document.title = 'Leave Policies | HR';
    load();
  }, [load]);

  const activePolicies = useMemo(
    () => policies.filter((p) => p.is_active !== false),
    [policies],
  );

  const stats = useMemo(() => ({
    total: activePolicies.length,
    department: activePolicies.filter((p) => assignmentFilterType(p) === 'DEPARTMENT').length,
    designation: activePolicies.filter((p) => assignmentFilterType(p) === 'DESIGNATION').length,
  }), [activePolicies]);

  const filteredPolicies = useMemo(() => {
    const q = search.trim().toLowerCase();
    return activePolicies.filter((row) => {
      if (filter !== 'all' && assignmentFilterType(row) !== filter) return false;
      if (!q) return true;
      return (row.name || '').toLowerCase().includes(q)
        || formatPolicyWho(row).toLowerCase().includes(q)
        || formatEntitlementSummary(row.lines).toLowerCase().includes(q);
    });
  }, [activePolicies, filter, search]);

  const selectedPolicy = useMemo(
    () => activePolicies.find((row) => row.id === selectedId) || null,
    [activePolicies, selectedId],
  );

  const isDirty = useMemo(
    () => isPolicyFormDirty(form, baseline),
    [form, baseline],
  );

  useEffect(() => {
    if (loading || selectedId) return;
    if (activePolicies[0]) setSelectedId(activePolicies[0].id);
  }, [activePolicies, loading, selectedId]);

  useEffect(() => {
    if (loading || leaveTypes.length === 0 || autoOpenedCreate.current) return;
    if (activePolicies.length === 0) {
      autoOpenedCreate.current = true;
      navigate(newPackageRoute, { replace: true });
    }
  }, [activePolicies.length, leaveTypes.length, loading, navigate, newPackageRoute]);

  useEffect(() => {
    if (!selectedPolicy) {
      const empty = formFromPolicy(null);
      setForm(empty);
      setBaseline(empty);
      return;
    }
    const next = formFromPolicy(selectedPolicy);
    setForm(next);
    setBaseline(next);
  }, [selectedPolicy]);

  function patchForm(patch) {
    setForm((prev) => ({ ...prev, ...patch }));
  }

  function selectPolicy(id) {
    setSelectedId(id);
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

  async function handleDelete() {
    if (!selectedPolicy) return;
    const name = form.name?.trim() || 'this package';
    if (!window.confirm(`Delete leave package “${name}”? Employees keep existing balances, but this package will no longer apply.`)) {
      return;
    }
    setSaving(true);
    try {
      await api.delete(`/hr/leave-policies/${selectedPolicy.id}/`);
      toast.success('Leave package deleted');
      setSelectedId(null);
      await load();
    } catch (err) {
      toast.error(errorText(err, 'Could not delete package'));
    } finally {
      setSaving(false);
    }
  }

  async function handleSubmit(event) {
    event.preventDefault();
    if (!selectedPolicy || !isDirty) return;
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
      await api.patch(`/hr/leave-policies/${selectedPolicy.id}/`, buildPolicyPayload(form));
      toast.success('Leave package saved and applied to employees');
      await load();
    } catch (err) {
      toast.error(errorText(err, 'Could not save'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mx-auto max-w-6xl space-y-5 pb-12">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold text-slate-900">
            <BookOpen className="text-violet-600" size={24} />
            Leave policies
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            Define annual leave days per package for departments or designations.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {leaveTypes.length > 0 && (
            <Link
              to={newPackageRoute}
              className="inline-flex items-center gap-1.5 rounded-xl bg-violet-600 px-4 py-2 text-sm font-semibold text-white hover:bg-violet-700"
            >
              <Plus size={16} />
              New package
            </Link>
          )}
        </div>
      </div>

      {loading ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-4">
          <TableSkeleton rows={5} cols={2} />
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
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            {[
              { id: 'all', label: 'All packages', value: stats.total, tone: 'bg-slate-50 border-slate-200 text-slate-900' },
              { id: 'DEPARTMENT', label: 'By department', value: stats.department, tone: 'bg-blue-50 border-blue-200 text-blue-900' },
              { id: 'DESIGNATION', label: 'By designation', value: stats.designation, tone: 'bg-violet-50 border-violet-200 text-violet-900' },
            ].map((card) => (
              <button
                key={card.id}
                type="button"
                onClick={() => setFilter(card.id)}
                className={`rounded-2xl border px-4 py-3 text-left transition ${
                  filter === card.id
                    ? `${card.tone} ring-2 ring-violet-200`
                    : `${card.tone} opacity-90 hover:opacity-100`
                }`}
              >
                <p className="text-2xl font-bold">{card.value}</p>
                <p className="mt-0.5 text-sm font-medium">{card.label}</p>
              </button>
            ))}
          </div>

          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
            <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
              <div className="border-b border-slate-100 p-3">
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
                  <input
                    type="search"
                    placeholder="Search packages…"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    className="w-full rounded-xl border border-slate-200 py-2.5 pl-9 pr-3 text-sm outline-none focus:border-violet-400"
                  />
                </div>
              </div>

              {filteredPolicies.length === 0 ? (
                <div className="px-4 py-10 text-center text-sm text-slate-500">
                  {activePolicies.length === 0 ? (
                    <p className="font-medium text-slate-800">
                      No packages yet.{' '}
                      <Link to={newPackageRoute} className="font-semibold text-violet-700 hover:underline">
                        Create your first package
                      </Link>
                    </p>
                  ) : (
                    'No packages match your search or filter.'
                  )}
                </div>
              ) : (
                <ul className="max-h-[32rem] divide-y divide-slate-100 overflow-y-auto">
                  {filteredPolicies.map((row) => {
                    const selected = selectedId === row.id;
                    return (
                      <li key={row.id}>
                        <button
                          type="button"
                          onClick={() => selectPolicy(row.id)}
                          className={`flex w-full items-center gap-3 px-4 py-3 text-left transition ${
                            selected ? 'bg-violet-50' : 'hover:bg-slate-50'
                          }`}
                        >
                          <div className="min-w-0 flex-1">
                            <p className="font-semibold text-slate-900">{row.name}</p>
                            <p className="text-xs text-slate-500">{formatPolicyWho(row)}</p>
                            <p className="mt-0.5 line-clamp-2 text-sm text-slate-600">
                              {formatEntitlementSummary(row.lines)}
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
              {!selectedPolicy ? (
                <div className="flex min-h-[24rem] flex-col items-center justify-center text-center text-sm text-slate-500">
                  <BookOpen className="mb-3 h-10 w-10 text-slate-300" />
                  Select a package or create a new one.
                </div>
              ) : (
                <form onSubmit={handleSubmit} className="space-y-4">
                  <div className="border-b border-slate-100 pb-4">
                    <h2 className="text-lg font-bold text-slate-900">Edit package</h2>
                    <p className="mt-1 text-sm text-slate-600">
                      Set leave days per year for this package.
                      {isDirty ? (
                        <span className="ml-1 font-medium text-amber-700">Unsaved changes</span>
                      ) : null}
                    </p>
                  </div>

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
                      <div className="mt-2 max-h-48 space-y-1 overflow-y-auto rounded-xl border border-slate-200 p-2">
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
                      <div className="mt-2 max-h-48 space-y-1 overflow-y-auto rounded-xl border border-slate-200 p-2">
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
                        className="text-xs font-semibold text-violet-700 hover:underline"
                      >
                        + Add type
                      </button>
                    </div>
                    <div className="mt-2 space-y-2">
                      {form.lines.length === 0 ? (
                        <p className="rounded-xl border border-dashed border-slate-200 px-3 py-4 text-center text-sm text-slate-500">
                          No leave types yet — add one.
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

                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={handleDelete}
                      disabled={saving}
                      className="inline-flex min-h-[48px] items-center justify-center gap-2 rounded-xl border border-red-200 px-4 text-sm font-semibold text-red-700 hover:bg-red-50 disabled:opacity-50"
                    >
                      <Trash2 size={16} />
                      Delete
                    </button>
                    <button
                      type="submit"
                      disabled={!isDirty || saving}
                      className="flex min-h-[48px] flex-1 items-center justify-center gap-2 rounded-xl bg-violet-600 text-sm font-semibold text-white hover:bg-violet-700 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <Save size={16} />
                      {saving ? 'Saving…' : 'Save changes'}
                    </button>
                  </div>
                </form>
              )}
            </section>
          </div>
        </>
      )}

      <SetupWizardNav className="border-t border-slate-100 pt-4" />
    </div>
  );
}
