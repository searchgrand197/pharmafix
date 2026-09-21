import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import HRPageWrapper from '../components/HR/HRPageWrapper';
import SetupWizardNav from '../components/HR/SetupWizardNav';
import DocumentTypeModal, {
  DEFAULT_DOCUMENT_TYPE_VALUES,
  pickDocumentTypeErrorMessage,
} from '../components/HR/DocumentTypeModal';
import api from '../api';
import toast from 'react-hot-toast';
import {
  ArrowLeft,
  Layers,
  Pencil,
  Plus,
  RefreshCw,
  ToggleLeft,
  ToggleRight,
} from 'lucide-react';
import { dedupeDocumentTypes } from '../utils/documentTypes';
import { isFromSetupWizard } from './hr/setupWizardUtils';

function normalizeList(response) {
  const d = response?.data;
  if (!d) return [];
  if (Array.isArray(d)) return d;
  return d.results || [];
}

export default function ChecklistRules() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const fromSetupWizard = isFromSetupWizard(searchParams);
  const autoOpenedFromWizard = useRef(false);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState(null);
  const [documentTypes, setDocumentTypes] = useState([]);

  const [docModal, setDocModal] = useState(null);
  const [docModalInitial, setDocModalInitial] = useState(DEFAULT_DOCUMENT_TYPE_VALUES);

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const dtRes = await api.get('/hr/document-types/', { params: { limit: 500 } });
      setDocumentTypes(normalizeList(dtRes));
    } catch (error) {
      console.error(error);
      toast.error(pickDocumentTypeErrorMessage(error));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  const docTypeOptions = useMemo(
    () => dedupeDocumentTypes(documentTypes),
    [documentTypes],
  );

  function openNewDocType() {
    setDocModalInitial(DEFAULT_DOCUMENT_TYPE_VALUES);
    setDocModal('create');
  }

  useEffect(() => {
    if (fromSetupWizard && !loading && docTypeOptions.length === 0 && !autoOpenedFromWizard.current) {
      autoOpenedFromWizard.current = true;
      openNewDocType();
    }
  }, [fromSetupWizard, loading, docTypeOptions.length]);

  function openEditDocType(row) {
    setDocModalInitial({
      id: row.id,
      name: row.name || '',
      description: row.description || '',
      verification_mode: row.verification_mode || 'upload',
      is_active: row.is_active !== false,
    });
    setDocModal('edit');
  }

  async function toggleDocTypeActive(row) {
    setSavingId(row.id);
    try {
      await api.patch(`/hr/document-types/${row.id}/`, { is_active: !row.is_active });
      toast.success(row.is_active ? 'Document type deactivated' : 'Document type activated');
      await loadAll();
    } catch (error) {
      toast.error(pickDocumentTypeErrorMessage(error));
    } finally {
      setSavingId(null);
    }
  }

  const headerExtra = fromSetupWizard ? null : (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        onClick={() => navigate('/hr/journey-center')}
        className="flex items-center gap-1 rounded bg-white/15 px-2 py-1 text-[11px] font-bold hover:bg-white/25"
      >
        <ArrowLeft size={12} />
        HR home
      </button>
      <button
        type="button"
        onClick={loadAll}
        className="flex items-center gap-1 rounded bg-white/15 px-2 py-1 text-[11px] font-bold hover:bg-white/25"
      >
        <RefreshCw size={12} />
        Refresh
      </button>
    </div>
  );

  return (
    <HRPageWrapper
      title="Onboarding checklist"
      subtitle="Document types for onboarding"
      color="purple"
      headerExtra={headerExtra}
    >
      <div className="mx-auto max-w-6xl space-y-8 overflow-y-auto px-4 py-6 pb-16">
        {fromSetupWizard && (
          <div className="rounded-xl border border-violet-200 bg-violet-50 px-4 py-3 text-sm text-violet-900">
            <strong>Organization Settings setup — Step 4:</strong> Standard onboarding documents (Aadhaar, PAN, Resume,
            Degree Certificate, Bank Details) are listed below. Review them, deactivate any you do not need, or add new
            types before candidates reach KYC. Active types appear on every checklist.
          </div>
        )}
        {loading ? (
          <div className="flex min-h-[40vh] items-center justify-center text-slate-500">
            Loading configuration…
          </div>
        ) : (
          <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="flex flex-col gap-3 border-b border-slate-100 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-start gap-3">
                <div className="mt-0.5 flex h-9 w-9 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600">
                  <Layers size={18} />
                </div>
                <div>
                  <h2 className="text-base font-semibold text-slate-900">Document types</h2>
                  <p className="text-sm text-slate-600">
                    Standard onboarding documents are preloaded. Activate, deactivate, or add types as needed.
                    Active types appear on every checklist.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={openNewDocType}
                className="inline-flex items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow hover:bg-indigo-700"
              >
                <Plus size={16} />
                New document type
              </button>
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full text-left text-sm">
                <thead className="bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-4 py-3">Name</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {docTypeOptions.length === 0 ? (
                    <tr>
                      <td colSpan={3} className="px-4 py-10 text-center text-slate-500">
                        No document types yet. Create one to start configuring onboarding.
                      </td>
                    </tr>
                  ) : (
                    docTypeOptions.map((row) => (
                      <tr key={row.id} className={!row.is_active ? 'bg-slate-50/80 text-slate-500' : ''}>
                        <td className="px-4 py-3">
                          <div className="font-medium text-slate-900">{row.name}</div>
                          {row.description ? (
                            <div className="mt-0.5 line-clamp-2 text-xs text-slate-500">{row.description}</div>
                          ) : null}
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                              row.is_active
                                ? 'bg-emerald-100 text-emerald-800'
                                : 'bg-slate-200 text-slate-600'
                            }`}
                          >
                            {row.is_active ? 'Active' : 'Inactive'}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <div className="flex justify-end gap-2">
                            <button
                              type="button"
                              onClick={() => toggleDocTypeActive(row)}
                              disabled={savingId === row.id}
                              className="rounded-lg border border-slate-200 p-2 text-slate-600 hover:bg-slate-50 disabled:opacity-50"
                              title={row.is_active ? 'Deactivate' : 'Activate'}
                            >
                              {row.is_active ? <ToggleRight size={18} /> : <ToggleLeft size={18} />}
                            </button>
                            <button
                              type="button"
                              onClick={() => openEditDocType(row)}
                              className="rounded-lg border border-slate-200 p-2 text-indigo-600 hover:bg-indigo-50"
                              title="Edit"
                            >
                              <Pencil size={18} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>
        )}

        <DocumentTypeModal
          open={!!docModal}
          mode={docModal === 'edit' ? 'edit' : 'create'}
          initialValues={docModalInitial}
          onClose={() => setDocModal(null)}
          onSaved={loadAll}
        />

        <SetupWizardNav className="border-t border-slate-100 pt-4" />
      </div>
    </HRPageWrapper>
  );
}
