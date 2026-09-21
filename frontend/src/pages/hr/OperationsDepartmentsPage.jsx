import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../../api';
import toast from 'react-hot-toast';
import { Building2, Edit2, Plus, Save, Trash2, X } from 'lucide-react';
import { normalizeApiList } from '../../hr/recruitmentLifecycle';
import { TableSkeleton } from '../../components/HR/HRSkeleton';
import SetupWizardNav from '../../components/HR/SetupWizardNav';

function errorText(err, fallback) {
  const data = err?.response?.data;
  if (typeof data?.error === 'string') return data.error;
  if (typeof data?.detail === 'string') return data.detail;
  const first = Object.values(data || {})[0];
  if (Array.isArray(first) && first[0]) return first[0];
  return fallback;
}

export default function OperationsDepartmentsPage() {
  const [departments, setDepartments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [newName, setNewName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [editName, setEditName] = useState('');
  const [savingEdit, setSavingEdit] = useState(false);
  const [deletingId, setDeletingId] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get('/hr/departments/', { params: { limit: 200 } });
      setDepartments(normalizeApiList(data));
    } catch {
      toast.error('Could not load departments');
      setDepartments([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    document.title = 'Departments | HR';
    load();
  }, [load]);

  async function handleAdd(e) {
    e.preventDefault();
    const name = newName.trim();
    if (!name) return;

    setSubmitting(true);
    try {
      await api.post('/hr/departments/', { name });
      toast.success(`"${name}" added`);
      setNewName('');
      await load();
    } catch (error) {
      toast.error(errorText(error, 'Could not add department'));
    } finally {
      setSubmitting(false);
    }
  }

  function startEdit(dept) {
    setEditingId(dept.id);
    setEditName(dept.name);
  }

  function cancelEdit() {
    setEditingId(null);
    setEditName('');
  }

  async function handleSaveEdit(dept) {
    const name = editName.trim();
    if (!name) {
      toast.error('Department name cannot be empty');
      return;
    }
    if (name === dept.name) {
      cancelEdit();
      return;
    }

    setSavingEdit(true);
    try {
      await api.patch(`/hr/departments/${dept.id}/`, { name });
      toast.success('Department updated');
      cancelEdit();
      await load();
    } catch (error) {
      toast.error(errorText(error, 'Could not update department'));
    } finally {
      setSavingEdit(false);
    }
  }

  async function handleDelete(dept) {
    if (!window.confirm(`Delete department "${dept.name}"? This cannot be undone.`)) return;

    setDeletingId(dept.id);
    try {
      await api.delete(`/hr/departments/${dept.id}/`);
      toast.success('Department deleted');
      if (editingId === dept.id) cancelEdit();
      await load();
    } catch (error) {
      const counts = error?.response?.data?.linked_counts;
      if (counts?.employees) {
        toast.error(`Cannot delete — ${counts.employees} employee(s) are assigned to this department.`);
      } else {
        toast.error(errorText(error, 'Could not delete department'));
      }
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6 pb-12">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold text-slate-900">
          <Building2 className="text-violet-600" size={24} />
          Departments
        </h1>
        <p className="mt-1 text-sm text-slate-600">
          Teams and units in your hospital — Nursing, Pharmacy, HR, and so on.
        </p>
      </div>

      <p className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-2 text-xs text-slate-600">
        Create departments here first. They appear when you{' '}
        <Link to="/hr/employees/create" className="font-medium text-violet-700 hover:underline">
          add employees
        </Link>
        , post jobs        , group attendance, and set{' '}
        <Link to="/hr/payroll/compensation-levels" className="font-medium text-violet-700 hover:underline">
          compensation levels
        </Link>
        . You only need to set each department up once.
      </p>

      <form
        onSubmit={handleAdd}
        className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:flex-row sm:items-end"
      >
        <label className="flex-1">
          <span className="text-xs font-medium text-slate-600">New department name</span>
          <input
            type="text"
            required
            placeholder="e.g. Cardiology, Nursing, Pharmacy"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
          />
        </label>
        <button
          type="submit"
          disabled={submitting || !newName.trim()}
          className="inline-flex min-h-[42px] items-center justify-center gap-2 rounded-lg bg-violet-600 px-4 text-sm font-semibold text-white hover:bg-violet-700 disabled:opacity-50"
        >
          <Plus size={16} />
          {submitting ? 'Adding…' : 'Add department'}
        </button>
      </form>

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-100 px-4 py-3">
          <h2 className="text-sm font-semibold text-slate-900">
            {loading ? 'Loading…' : `${departments.length} department${departments.length === 1 ? '' : 's'}`}
          </h2>
        </div>

        {loading ? (
          <div className="p-4">
            <TableSkeleton rows={4} cols={2} />
          </div>
        ) : departments.length === 0 ? (
          <div className="p-10 text-center text-slate-500">
            <Building2 className="mx-auto mb-2 h-10 w-10 text-slate-300" />
            <p className="font-semibold text-slate-800">No departments yet</p>
            <p className="mt-1 text-sm">Add your first department above — for example Nursing or Administration.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-4 py-3">Department</th>
                  <th className="px-4 py-3">Added</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {departments.map((dept) => {
                  const isEditing = editingId === dept.id;
                  const employeeCount = dept.employee_count ?? 0;
                  const canDelete = employeeCount === 0;

                  return (
                    <tr key={dept.id} className="hover:bg-slate-50/60">
                      <td className="px-4 py-3">
                        {isEditing ? (
                          <input
                            type="text"
                            value={editName}
                            onChange={(e) => setEditName(e.target.value)}
                            className="w-full min-w-[180px] rounded-lg border border-violet-200 px-3 py-1.5 text-sm font-medium text-slate-900 focus:border-violet-400 focus:outline-none"
                            autoFocus
                          />
                        ) : (
                          <div>
                            <span className="font-medium text-slate-900">{dept.name}</span>
                            {employeeCount > 0 && (
                              <span className="ml-2 text-xs text-slate-500">
                                {employeeCount} employee{employeeCount === 1 ? '' : 's'}
                              </span>
                            )}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-500">
                        {new Date(dept.created_at).toLocaleDateString()}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap justify-end gap-2">
                          {isEditing ? (
                            <>
                              <button
                                type="button"
                                onClick={() => handleSaveEdit(dept)}
                                disabled={savingEdit || !editName.trim()}
                                className="inline-flex items-center gap-1 rounded-lg bg-violet-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-violet-700 disabled:opacity-50"
                              >
                                <Save size={14} />
                                {savingEdit ? 'Saving…' : 'Save'}
                              </button>
                              <button
                                type="button"
                                onClick={cancelEdit}
                                disabled={savingEdit}
                                className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                              >
                                <X size={14} />
                                Cancel
                              </button>
                            </>
                          ) : (
                            <>
                              <button
                                type="button"
                                onClick={() => startEdit(dept)}
                                className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                              >
                                <Edit2 size={14} />
                                Edit
                              </button>
                              {canDelete ? (
                                <button
                                  type="button"
                                  onClick={() => handleDelete(dept)}
                                  disabled={deletingId === dept.id}
                                  className="inline-flex items-center gap-1 rounded-lg border border-red-200 px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-50 disabled:opacity-50"
                                >
                                  <Trash2 size={14} />
                                  {deletingId === dept.id ? 'Deleting…' : 'Delete'}
                                </button>
                              ) : (
                                <span className="inline-flex items-center px-2 py-1.5 text-xs text-slate-400" title="Remove employees from this department before deleting">
                                  Delete unavailable
                                </span>
                              )}
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <SetupWizardNav className="border-t border-slate-100 pt-4" />
    </div>
  );
}
