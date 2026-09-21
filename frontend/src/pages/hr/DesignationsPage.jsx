import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import api from '../../api';
import toast from 'react-hot-toast';
import { Briefcase, Edit2, Plus, Power, Save, Trash2, X } from 'lucide-react';
import { TableSkeleton } from '../../components/HR/HRSkeleton';
import SetupWizardNav from '../../components/HR/SetupWizardNav';
import { normalizeApiList } from '../../hr/recruitmentLifecycle';
import { isFromSetupWizard } from './setupWizardUtils';

const blankDesignation = {
  name: '',
  is_active: true,
};

function errorText(err, fallback) {
  const data = err?.response?.data;
  if (typeof data?.error === 'string') return data.error;
  if (data?.name?.[0]) return data.name[0];
  if (data?.code?.[0]) return data.code[0];
  if (data?.department?.[0]) return data.department[0];
  if (typeof data?.detail === 'string') return data.detail;
  const first = Object.values(data || {})[0];
  if (Array.isArray(first) && first[0]) return first[0];
  return fallback;
}

export default function DesignationsPage() {
  const [searchParams] = useSearchParams();
  const fromSetupWizard = isFromSetupWizard(searchParams);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [designations, setDesignations] = useState([]);
  const [form, setForm] = useState(blankDesignation);
  const [editingId, setEditingId] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const autoOpenedFromWizard = useRef(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data: desData } = await api.get('/hr/designations/');
      setDesignations(normalizeApiList(desData));
    } catch (err) {
      toast.error(errorText(err, 'Failed to load designations'));
      setDesignations([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    document.title = 'Designations | HR';
    load();
  }, [load]);

  useEffect(() => {
    if (fromSetupWizard && !loading && designations.length === 0 && !autoOpenedFromWizard.current) {
      autoOpenedFromWizard.current = true;
      setEditingId(null);
      setForm(blankDesignation);
      setShowForm(true);
    }
  }, [fromSetupWizard, loading, designations.length]);

  function openCreate() {
    setEditingId(null);
    setForm(blankDesignation);
    setShowForm(true);
  }

  function openEdit(row) {
    setEditingId(row.id);
    setForm({
      name: row.name || '',
      is_active: row.is_active !== false,
    });
    setShowForm(true);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setSaving(true);
    const payload = {
      name: form.name.trim(),
      is_active: form.is_active !== false,
    };
    try {
      if (editingId) {
        await api.patch(`/hr/designations/${editingId}/`, payload);
        toast.success('Designation updated');
      } else {
        await api.post('/hr/designations/', payload);
        toast.success('Designation created');
      }
      setShowForm(false);
      setForm(blankDesignation);
      setEditingId(null);
      load();
    } catch (err) {
      toast.error(errorText(err, 'Failed to save designation'));
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive(row) {
    try {
      const action = row.is_active ? 'deactivate' : 'activate';
      await api.post(`/hr/designations/${row.id}/${action}/`);
      toast.success(row.is_active ? 'Designation deactivated' : 'Designation activated');
      load();
    } catch (err) {
      toast.error(errorText(err, 'Failed to update status'));
    }
  }

  async function handleDelete(row) {
    if (!window.confirm(`Delete designation "${row.name}"?`)) return;
    try {
      await api.delete(`/hr/designations/${row.id}/`);
      toast.success('Designation deleted');
      load();
    } catch (err) {
      const counts = err?.response?.data?.linked_counts;
      if (counts) {
        toast.error(
          `Cannot delete — assigned to ${counts.employees || 0} employee(s), `
          + `${counts.job_openings || 0} job(s), ${counts.salary_structures || 0} salary structure(s).`,
        );
      } else {
        toast.error(errorText(err, 'Failed to delete designation'));
      }
    }
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6 px-4 pb-10 pt-2">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold text-gray-900">
            <Briefcase size={24} className="text-purple-600" /> Designations
          </h1>
          <p className="mt-1 text-sm text-gray-600">Manage job roles used across recruitment, employees, and payroll.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={openCreate} className="inline-flex min-h-[44px] items-center gap-2 rounded-xl bg-purple-600 px-4 text-sm font-semibold text-white">
            <Plus size={16} /> New designation
          </button>
        </div>
      </header>

      {showForm && (
        <form onSubmit={handleSubmit} className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm sm:p-6">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg font-semibold text-gray-900">{editingId ? 'Edit designation' : 'Create designation'}</h2>
            <button type="button" onClick={() => setShowForm(false)} className="rounded-lg border border-gray-200 p-2 text-gray-500">
              <X size={18} />
            </button>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block text-sm">
              <span className="font-medium text-gray-700">Name *</span>
              <input required value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} className="mt-1 min-h-[44px] w-full rounded-xl border border-gray-200 px-3" />
            </label>
          </div>
          <button type="submit" disabled={saving} className="mt-4 inline-flex min-h-[44px] w-full items-center justify-center gap-2 rounded-xl bg-purple-600 px-4 text-sm font-semibold text-white sm:w-auto">
            <Save size={16} /> {saving ? 'Saving…' : 'Save'}
          </button>
        </form>
      )}

      {loading ? (
        <TableSkeleton rows={5} />
      ) : designations.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-gray-300 bg-white p-8 text-center">
          <Briefcase className="mx-auto h-10 w-10 text-gray-300" />
          <p className="mt-3 font-medium text-gray-800">No designations yet</p>
          <p className="mt-1 text-sm text-gray-500">
            Create job titles (e.g. Nurse, Receptionist) before setting pay or adding employees.
          </p>
          <button
            type="button"
            onClick={openCreate}
            className="mt-4 inline-flex min-h-[44px] items-center gap-2 rounded-xl bg-purple-600 px-5 text-sm font-semibold text-white hover:bg-purple-700"
          >
            <Plus size={16} />
            Create your first designation
          </button>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-gray-200 bg-white shadow-sm">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead className="bg-gray-50 text-xs uppercase text-gray-500">
              <tr>
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Code</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {designations.map((row) => (
                <tr key={row.id} className="hover:bg-gray-50/60">
                  <td className="px-4 py-3 font-medium text-gray-900">{row.name}</td>
                  <td className="px-4 py-3 text-gray-600">{row.code || '—'}</td>
                  <td className="px-4 py-3">
                    <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${row.is_active ? 'bg-green-100 text-green-800' : 'bg-slate-100 text-slate-600'}`}>
                      {row.is_active ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-2">
                      <button type="button" onClick={() => openEdit(row)} className="inline-flex items-center gap-1 rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-semibold text-gray-700">
                        <Edit2 size={14} /> Edit
                      </button>
                      <button type="button" onClick={() => toggleActive(row)} className="inline-flex items-center gap-1 rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-semibold text-gray-700">
                        <Power size={14} /> {row.is_active ? 'Deactivate' : 'Activate'}
                      </button>
                      <button type="button" onClick={() => handleDelete(row)} className="inline-flex items-center gap-1 rounded-lg border border-red-200 px-3 py-1.5 text-xs font-semibold text-red-700">
                        <Trash2 size={14} /> Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <SetupWizardNav className="border-t border-slate-100 pt-4" />
    </div>
  );
}
