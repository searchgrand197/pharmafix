import React, { useCallback, useEffect, useMemo, useState } from 'react';
import api, { getHospitalId } from '../../../api';
import toast from 'react-hot-toast';
import {
  Calendar,
  ChevronRight,
  Plus,
  Power,
  Save,
  Search,
} from 'lucide-react';
import { TableSkeleton } from '../../../components/HR/HRSkeleton';
import SetupWizardNav from '../../../components/HR/SetupWizardNav';
import { errorText, isLockedUnpaidLeaveType, isUnpaidLeaveType, normalizeList } from './leaveUtils';

const blankType = {
  name: '',
  code: '',
  is_paid: true,
  annual_limit: '',
  description: '',
  is_active: true,
};

function typeSummary(row) {
  const parts = [];
  parts.push(row.is_paid ? 'Paid' : 'Unpaid');
  if (row.annual_limit != null && row.annual_limit !== '') {
    parts.push(`${row.annual_limit} days/year max`);
  } else {
    parts.push('No annual cap');
  }
  if (row.code) parts.push(row.code);
  return parts.join(' · ');
}

export default function LeaveTypesPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [types, setTypes] = useState([]);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');
  const [selectedId, setSelectedId] = useState(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState(blankType);
  const [editingId, setEditingId] = useState(null);
  const [showMore, setShowMore] = useState(false);
  const [togglingId, setTogglingId] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get('/hr/leave-types/');
      setTypes(normalizeList(data));
    } catch (err) {
      toast.error(errorText(err, 'Failed to load leave types'));
      setTypes([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    document.title = 'Leave Types | HR';
    load();
  }, [load]);

  const stats = useMemo(() => ({
    total: types.length,
    active: types.filter((t) => t.is_active !== false).length,
    inactive: types.filter((t) => t.is_active === false).length,
  }), [types]);

  const filteredTypes = useMemo(() => {
    const q = search.trim().toLowerCase();
    return types.filter((row) => {
      if (filter === 'active' && row.is_active === false) return false;
      if (filter === 'inactive' && row.is_active !== false) return false;
      if (!q) return true;
      return (row.name || '').toLowerCase().includes(q)
        || (row.code || '').toLowerCase().includes(q);
    });
  }, [types, filter, search]);

  const selectedType = useMemo(
    () => types.find((row) => row.id === selectedId) || null,
    [types, selectedId],
  );

  const formIsLockedUnpaid = useMemo(() => isLockedUnpaidLeaveType(form), [form]);

  const isDirty = useMemo(() => {
    if (!editingId || !selectedType) return true;
    const normLimit = (v) => (v === '' || v == null ? null : String(v));
    return (
      (form.name || '') !== (selectedType.name || '')
      || (form.code || '') !== (selectedType.code || '')
      || (form.is_paid !== false) !== (selectedType.is_paid !== false)
      || normLimit(form.annual_limit) !== normLimit(selectedType.annual_limit)
      || (form.description || '') !== (selectedType.description || '')
      || (form.is_active !== false) !== (selectedType.is_active !== false)
    );
  }, [editingId, form, selectedType]);

  useEffect(() => {
    setSelectedId(null);
    setCreating(false);
  }, [filter, search]);

  useEffect(() => {
    if (loading || creating || selectedId) return;
    const first = filteredTypes.find((t) => t.is_active !== false) || filteredTypes[0];
    if (first) setSelectedId(first.id);
  }, [creating, filteredTypes, loading, selectedId]);

  useEffect(() => {
    if (creating) return;
    if (!selectedType) {
      setEditingId(null);
      setForm(blankType);
      setShowMore(false);
      return;
    }
    setEditingId(selectedType.id);
    setForm({
      name: selectedType.name || '',
      code: selectedType.code || '',
      is_paid: selectedType.is_paid !== false,
      annual_limit: selectedType.annual_limit ?? '',
      description: selectedType.description || '',
      is_active: selectedType.is_active !== false,
    });
    setShowMore(Boolean(selectedType.description));
  }, [creating, selectedType]);

  function patchForm(patch) {
    setForm((prev) => ({ ...prev, ...patch }));
  }

  function startCreate() {
    setCreating(true);
    setSelectedId(null);
    setEditingId(null);
    setForm(blankType);
    setShowMore(false);
  }

  function selectType(id) {
    setCreating(false);
    setSelectedId(id);
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setSaving(true);
    const unpaid = isUnpaidLeaveType(form);
    const payload = {
      ...form,
      is_paid: unpaid ? false : form.is_paid !== false,
      annual_limit: form.annual_limit === '' ? null : form.annual_limit,
    };
    try {
      if (editingId) {
        await api.patch(`/hr/leave-types/${editingId}/`, payload);
        toast.success('Leave type updated');
      } else {
        const { data } = await api.post('/hr/leave-types/', payload);
        toast.success('Leave type created');
        setCreating(false);
        setSelectedId(data.id);
      }
      await load();
    } catch (err) {
      toast.error(errorText(err, 'Failed to save leave type'));
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive(row, event) {
    event?.stopPropagation();
    const wasActive = row.is_active !== false;
    const action = wasActive ? 'deactivate' : 'activate';

    setTogglingId(row.id);
    setTypes((prev) => prev.map((t) => (
      t.id === row.id ? { ...t, is_active: !wasActive } : t
    )));

    try {
      await api.post(`/hr/leave-types/${row.id}/${action}/`);
      toast.success(wasActive ? 'Leave type deactivated' : 'Leave type activated');
      await load();
    } catch (err) {
      setTypes((prev) => prev.map((t) => (
        t.id === row.id ? { ...t, is_active: wasActive } : t
      )));
      toast.error(errorText(err, 'Failed to update status'));
    } finally {
      setTogglingId(null);
    }
  }

  async function seedDefaults() {
    try {
      const hospitalId = getHospitalId();
      const { data } = await api.post(
        '/hr/leave-types/seed-defaults/',
        hospitalId ? { hospital_id: hospitalId } : {},
      );
      toast.success(`Created ${data.created_types} default leave type${data.created_types === 1 ? '' : 's'}`);
      await load();
    } catch (err) {
      toast.error(errorText(err, 'Could not set up defaults'));
    }
  }

  const showPanel = creating || selectedType;

  return (
    <div className="mx-auto max-w-6xl space-y-5 pb-12">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold text-slate-900">
            <Calendar className="text-violet-600" size={24} />
            Leave types
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            Categories like Casual, Medical, and Earned — used in policies and balances.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {!loading && types.length === 0 && (
            <button
              type="button"
              onClick={seedDefaults}
              className="inline-flex items-center gap-1.5 rounded-xl border border-violet-200 bg-violet-50 px-3 py-2 text-sm font-semibold text-violet-800 hover:bg-violet-100"
            >
              Set up defaults
            </button>
          )}
          <button
            type="button"
            onClick={startCreate}
            className="inline-flex items-center gap-1.5 rounded-xl bg-violet-600 px-4 py-2 text-sm font-semibold text-white hover:bg-violet-700"
          >
            <Plus size={16} />
            New type
          </button>
        </div>
      </div>

      {loading ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-4">
          <TableSkeleton rows={5} cols={2} />
        </div>
      ) : types.length === 0 && !creating ? (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-12 text-center">
          <Calendar className="mx-auto h-10 w-10 text-slate-300" />
          <p className="mt-3 font-semibold text-slate-900">No leave types yet</p>
          <p className="mt-1 text-sm text-slate-600">
            Set up Casual, Medical, Earned, and LWP in one click.
          </p>
          <div className="mt-4 flex flex-wrap justify-center gap-2">
            <button
              type="button"
              onClick={seedDefaults}
              className="rounded-xl bg-violet-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-violet-700"
            >
              Set up defaults
            </button>
            <button
              type="button"
              onClick={startCreate}
              className="rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50"
            >
              Create custom type
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-3">
            <div className="inline-flex rounded-xl border border-slate-200 bg-white p-1">
              {[
                { id: 'all', label: 'All', value: stats.total },
                { id: 'active', label: 'Active', value: stats.active },
                { id: 'inactive', label: 'Inactive', value: stats.inactive },
              ].map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setFilter(tab.id)}
                  className={`rounded-lg px-3 py-1.5 text-sm font-semibold transition ${
                    filter === tab.id
                      ? 'bg-violet-600 text-white'
                      : 'text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  {tab.label}
                  <span className="ml-1.5 text-xs opacity-80">({tab.value})</span>
                </button>
              ))}
            </div>
          </div>

          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
            <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
              <div className="border-b border-slate-100 p-3">
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
                  <input
                    type="search"
                    placeholder="Search leave types…"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    className="w-full rounded-xl border border-slate-200 py-2.5 pl-9 pr-3 text-sm outline-none focus:border-violet-400"
                  />
                </div>
              </div>

              {filteredTypes.length === 0 ? (
                <p className="px-4 py-10 text-center text-sm text-slate-500">No types match your search or filter.</p>
              ) : (
                <ul className="max-h-[32rem] space-y-2 overflow-y-auto p-3">
                  {filteredTypes.map((row) => {
                    const selected = selectedId === row.id && !creating;
                    const isActive = row.is_active !== false;
                    const isToggling = togglingId === row.id;
                    return (
                      <li key={row.id}>
                        <div
                          className={`rounded-xl border transition ${
                            selected
                              ? 'border-violet-300 ring-2 ring-violet-100'
                              : isActive
                                ? 'border-emerald-200 bg-emerald-50/50'
                                : 'border-slate-200 bg-slate-50'
                          }`}
                        >
                          <button
                            type="button"
                            onClick={() => selectType(row.id)}
                            className="flex w-full items-center gap-3 px-4 py-3 text-left"
                          >
                            <div className="min-w-0 flex-1">
                              <div className="flex flex-wrap items-center gap-2">
                                <p className={`font-semibold ${isActive ? 'text-slate-900' : 'text-slate-500'}`}>
                                  {row.name}
                                </p>
                                <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                                  isActive
                                    ? 'bg-emerald-100 text-emerald-800'
                                    : 'bg-slate-200 text-slate-600'
                                }`}
                                >
                                  {isActive ? 'Active' : 'Inactive'}
                                </span>
                                {!row.is_paid && (
                                  <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
                                    Unpaid
                                  </span>
                                )}
                              </div>
                              <p className={`mt-0.5 text-sm ${isActive ? 'text-slate-600' : 'text-slate-400'}`}>
                                {typeSummary(row)}
                              </p>
                            </div>
                            <ChevronRight size={16} className={`shrink-0 ${selected ? 'text-violet-500' : 'text-slate-300'}`} />
                          </button>
                          <div className="border-t border-slate-100/80 px-3 pb-3 pt-2">
                            <button
                              type="button"
                              disabled={isToggling}
                              onClick={(e) => toggleActive(row, e)}
                              className={`inline-flex w-full items-center justify-center gap-2 rounded-lg border px-3 py-2 text-sm font-semibold transition disabled:opacity-50 ${
                                isActive
                                  ? 'border-amber-300 text-amber-800 hover:bg-amber-50'
                                  : 'border-emerald-300 text-emerald-800 hover:bg-emerald-50'
                              }`}
                            >
                              <Power size={14} />
                              {isToggling ? 'Updating…' : isActive ? 'Deactivate' : 'Activate'}
                            </button>
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>

            <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              {!showPanel ? (
                <div className="flex min-h-[24rem] flex-col items-center justify-center text-center text-sm text-slate-500">
                  <Calendar className="mb-3 h-10 w-10 text-slate-300" />
                  Select a leave type or create a new one.
                </div>
              ) : (
                <form onSubmit={handleSubmit} className="space-y-4">
                  <div className="border-b border-slate-100 pb-4">
                    <h2 className="text-lg font-bold text-slate-900">
                      {creating ? 'New leave type' : 'Edit leave type'}
                    </h2>
                    <p className="mt-1 text-sm text-slate-600">
                      Used when building leave policies and employee balances.
                    </p>
                  </div>

                  <label className="block text-sm">
                    <span className="font-medium text-slate-700">Name *</span>
                    <input
                      required
                      placeholder="e.g. Casual Leave"
                      className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-violet-400"
                      value={form.name}
                      onChange={(e) => {
                        const name = e.target.value;
                        const patch = { name };
                        if (isLockedUnpaidLeaveType({ ...form, name })) {
                          patch.is_paid = false;
                        }
                        patchForm(patch);
                      }}
                    />
                  </label>

                  <label className="block text-sm">
                    <span className="font-medium text-slate-700">Code</span>
                    <input
                      placeholder="e.g. CL (auto if blank)"
                      className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm uppercase outline-none focus:border-violet-400"
                      value={form.code}
                      onChange={(e) => {
                        const code = e.target.value.toUpperCase();
                        const patch = { code };
                        if (isLockedUnpaidLeaveType({ ...form, code })) {
                          patch.is_paid = false;
                        }
                        patchForm(patch);
                      }}
                    />
                  </label>

                  <label className="block text-sm">
                    <span className="font-medium text-slate-700">Annual limit (days)</span>
                    <input
                      type="number"
                      min="0"
                      step="0.5"
                      placeholder="Leave blank for unlimited"
                      className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-violet-400"
                      value={form.annual_limit}
                      onChange={(e) => patchForm({ annual_limit: e.target.value })}
                    />
                  </label>

                  {formIsLockedUnpaid ? (
                    <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-3 text-sm">
                      <span className="font-medium text-amber-900">Unpaid leave</span>
                      <span className="mt-0.5 block text-xs text-amber-800">
                        This type does not count toward payroll working days.
                      </span>
                    </div>
                  ) : (
                    <div className="block text-sm">
                      <span className="font-medium text-slate-700">Pay type</span>
                      <div className="mt-2 inline-flex w-full rounded-xl border border-slate-200 bg-slate-50 p-1">
                        <button
                          type="button"
                          onClick={() => patchForm({ is_paid: true })}
                          className={`flex-1 rounded-lg px-3 py-2 text-sm font-semibold transition ${
                            form.is_paid !== false
                              ? 'bg-white text-violet-700 shadow-sm'
                              : 'text-slate-600 hover:text-slate-800'
                          }`}
                        >
                          Paid
                        </button>
                        <button
                          type="button"
                          onClick={() => patchForm({ is_paid: false })}
                          className={`flex-1 rounded-lg px-3 py-2 text-sm font-semibold transition ${
                            form.is_paid === false
                              ? 'bg-white text-amber-800 shadow-sm'
                              : 'text-slate-600 hover:text-slate-800'
                          }`}
                        >
                          Unpaid
                        </button>
                      </div>
                    </div>
                  )}

                  <button
                    type="button"
                    onClick={() => setShowMore((v) => !v)}
                    className="text-sm font-semibold text-violet-700 hover:underline"
                  >
                    {showMore ? 'Hide description' : 'Add description (optional)'}
                  </button>

                  {showMore && (
                    <label className="block text-sm">
                      <span className="font-medium text-slate-700">Description</span>
                      <textarea
                        rows={3}
                        className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-violet-400"
                        value={form.description}
                        onChange={(e) => patchForm({ description: e.target.value })}
                      />
                    </label>
                  )}

                  <button
                    type="submit"
                    disabled={saving || (Boolean(editingId) && !isDirty)}
                    className="flex w-full min-h-[48px] items-center justify-center gap-2 rounded-xl bg-violet-600 text-sm font-semibold text-white hover:bg-violet-700 disabled:opacity-50"
                  >
                    <Save size={16} />
                    {saving ? 'Saving…' : editingId ? 'Save changes' : 'Create type'}
                  </button>
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
