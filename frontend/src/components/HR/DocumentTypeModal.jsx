import React, { useEffect, useState } from 'react';
import api from '../../api';
import toast from 'react-hot-toast';

export const DEFAULT_DOCUMENT_TYPE_VALUES = {
  name: '',
  description: '',
  mandatory: true,
  verification_mode: 'upload',
  is_active: true,
};

export function pickDocumentTypeErrorMessage(error) {
  const data = error.response?.data;
  if (!data) return error.message || 'Request failed';
  if (typeof data === 'string') return data;
  if (data.detail) return String(data.detail);
  const firstKey = Object.keys(data)[0];
  if (firstKey) {
    const val = data[firstKey];
    if (Array.isArray(val)) return `${firstKey}: ${val[0]}`;
    if (typeof val === 'string') return val;
  }
  return 'Request failed';
}

export default function DocumentTypeModal({
  open,
  mode = 'create',
  initialValues = DEFAULT_DOCUMENT_TYPE_VALUES,
  onClose,
  onSaved,
}) {
  const [docForm, setDocForm] = useState(DEFAULT_DOCUMENT_TYPE_VALUES);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setDocForm({
      ...DEFAULT_DOCUMENT_TYPE_VALUES,
      ...initialValues,
    });
  }, [open, initialValues]);

  if (!open) return null;

  async function handleSave() {
    if (!docForm.name.trim()) {
      toast.error('Name is required');
      return;
    }
    setSaving(true);
    try {
      const payload = {
        name: docForm.name.trim(),
        description: docForm.description || '',
        mandatory: true,
        verification_mode: docForm.verification_mode,
        is_active: docForm.is_active,
      };
      let saved;
      if (mode === 'edit' && docForm.id) {
        const { data } = await api.patch(`/hr/document-types/${docForm.id}/`, payload);
        saved = data;
        toast.success('Document type updated');
      } else {
        const { data } = await api.post('/hr/document-types/', payload);
        saved = data;
        toast.success('Document type created');
      }
      onSaved?.(saved);
      onClose?.();
    } catch (error) {
      toast.error(pickDocumentTypeErrorMessage(error));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
      <div className="w-full max-w-lg rounded-2xl bg-white shadow-2xl">
        <div className="border-b border-slate-200 px-6 py-4">
          <h3 className="text-lg font-semibold text-slate-900">
            {mode === 'edit' ? 'Edit document type' : 'New document type'}
          </h3>
          <p className="mt-1 text-sm text-slate-600">
            Candidates and HR both see this label on the onboarding checklist.
          </p>
        </div>
        <div className="space-y-4 px-6 py-4">
          <div>
            <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">Name</label>
            <input
              className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
              value={docForm.name}
              onChange={(e) => setDocForm((f) => ({ ...f, name: e.target.value }))}
              placeholder="e.g. Aadhaar Card"
            />
          </div>
          <div>
            <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">Description</label>
            <textarea
              rows={3}
              className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
              value={docForm.description}
              onChange={(e) => setDocForm((f) => ({ ...f, description: e.target.value }))}
              placeholder="Optional instructions for the candidate"
            />
          </div>
          <label className="flex items-center gap-2 text-sm text-slate-800">
            <input
              type="checkbox"
              checked={docForm.is_active}
              onChange={(e) => setDocForm((f) => ({ ...f, is_active: e.target.checked }))}
            />
            Active
          </label>
        </div>
        <div className="flex justify-end gap-3 border-t border-slate-200 px-6 py-4">
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-60"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}
