import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import api from '../../api';
import {
  CheckCircle,
  ChevronRight,
  Eye,
  FileCheck,
  RefreshCw,
  Search,
  UserCheck,
  X,
  XCircle,
} from 'lucide-react';
import { TableSkeleton } from './HRSkeleton';
import JourneyJobFilter from '../../pages/hr/JourneyJobFilter';

function normalizeList(data) {
  if (!data) return [];
  if (Array.isArray(data)) return data;
  return data.results || [];
}

const STATUS_STYLES = {
  uploaded: 'bg-amber-100 text-amber-900',
  verified: 'bg-emerald-100 text-emerald-800',
  physically_verified: 'bg-teal-100 text-teal-900',
  reupload_requested: 'bg-orange-100 text-orange-900',
  rejected: 'bg-rose-100 text-rose-800',
  missing: 'bg-slate-100 text-slate-600',
  pending: 'bg-slate-100 text-slate-600',
};

function statusLabel(status) {
  if (status === 'uploaded') return 'Needs review';
  if (status === 'reupload_requested') return 'Re-upload pending';
  if (status === 'verified' || status === 'physically_verified') return 'Verified';
  if (status === 'rejected') return 'Rejected';
  if (status === 'missing' || status === 'pending') return 'Not uploaded';
  return String(status || '—').replace(/_/g, ' ');
}

function ActionModal({ title, label, reason, setReason, onClose, onConfirm, confirmClass, confirmText }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
      <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-xl">
        <h3 className="text-lg font-semibold text-slate-900">{title}</h3>
        <p className="mt-1 text-sm text-slate-600">{label}</p>
        <textarea
          className="mt-4 w-full rounded-xl border border-slate-200 p-3 text-sm outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100"
          rows={3}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Add a short note for the joiner"
        />
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700">
            Cancel
          </button>
          <button type="button" onClick={onConfirm} className={`rounded-lg px-4 py-2 text-sm font-semibold text-white ${confirmClass}`}>
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
}

function PreviewModal({ doc, url, kind, onClose }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4" onClick={onClose}>
      <div
        className="max-h-[90vh] w-full max-w-3xl overflow-hidden rounded-2xl bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
          <p className="font-semibold text-slate-900">{doc.document_label}</p>
          <button type="button" onClick={onClose} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100">
            <X size={18} />
          </button>
        </div>
        <div className="flex min-h-[280px] items-center justify-center bg-slate-50 p-4">
          {!url ? (
            <p className="text-sm text-slate-500">Loading preview…</p>
          ) : kind === 'pdf' ? (
            <iframe title="preview" src={url} className="h-[65vh] w-full rounded-lg bg-white" />
          ) : kind === 'image' ? (
            <img src={url} alt="" className="max-h-[65vh] max-w-full rounded-lg object-contain" />
          ) : (
            <p className="text-sm text-slate-500">Preview not available for this file type.</p>
          )}
        </div>
      </div>
    </div>
  );
}

export default function DocumentVerification() {
  const [searchParams] = useSearchParams();
  const employeeParam = searchParams.get('employee');
  const [jobOpening, setJobOpening] = useState(() => searchParams.get('job_opening') || '');
  const [loading, setLoading] = useState(true);
  const [employees, setEmployees] = useState([]);
  const [documents, setDocuments] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detail, setDetail] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [actionLoading, setActionLoading] = useState({});
  const [modal, setModal] = useState(null);
  const [reason, setReason] = useState('');
  const [preview, setPreview] = useState(null);
  const [previewUrl, setPreviewUrl] = useState('');
  const [previewKind, setPreviewKind] = useState('none');

  const loadLists = useCallback(async () => {
    setLoading(true);
    const empParams = { limit: 500, status: 'pending_onboarding' };
    if (jobOpening) empParams.job_opening = jobOpening;
    const settled = await Promise.allSettled([
      api.get('/hr/employees/', { params: empParams }).then((r) => r.data),
      api.get('/hr/documents/', { params: { limit: 500 } }).then((r) => r.data),
    ]);
    const e = settled[0].status === 'fulfilled' ? normalizeList(settled[0].value) : [];
    const d = settled[1].status === 'fulfilled' ? normalizeList(settled[1].value) : [];
    setEmployees(e.filter((emp) => emp.status === 'pending_onboarding' && !emp.application_rejected));
    setDocuments(d);
    if (settled.some((r) => r.status === 'rejected')) toast.error('Some data could not be loaded');
    setLoading(false);
  }, [jobOpening]);

  const loadDetail = useCallback(async (employeeId) => {
    if (!employeeId) return;
    setDetailLoading(true);
    try {
      const { data } = await api.get(`/hr/employees/${employeeId}/documents/`);
      setDetail(data);
    } catch (error) {
      if (error?.response?.status === 404 && error?.response?.data?.application_rejected) {
        toast.error('This application was rejected and removed from verification.');
        setEmployees((prev) => prev.filter((emp) => String(emp.id) !== String(employeeId)));
        setSelectedId(null);
        setDetail(null);
        return;
      }
      toast.error('Failed to load documents');
      setDetail(null);
    } finally {
      setDetailLoading(false);
    }
  }, []);

  useEffect(() => {
    loadLists();
  }, [loadLists]);

  useEffect(() => () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
  }, [previewUrl]);

  useEffect(() => {
    if (selectedId) loadDetail(selectedId);
    else setDetail(null);
  }, [selectedId, loadDetail]);

  const pendingIds = useMemo(() => new Set(employees.map((e) => String(e.id))), [employees]);

  const scopedDocuments = useMemo(
    () => documents.filter((d) => pendingIds.has(String(d.employee))),
    [documents, pendingIds],
  );

  const countsByEmployee = useMemo(() => {
    const map = new Map();
    scopedDocuments.forEach((doc) => {
      const id = String(doc.employee);
      if (!map.has(id)) map.set(id, { review: 0, reupload: 0 });
      const row = map.get(id);
      if (doc.status === 'uploaded') row.review += 1;
      if (doc.status === 'reupload_requested') row.reupload += 1;
    });
    return map;
  }, [scopedDocuments]);

  const summary = useMemo(() => {
    const toReview = scopedDocuments.filter((d) => d.status === 'uploaded').length;
    const reupload = scopedDocuments.filter((d) => d.status === 'reupload_requested').length;
    const ready = employees.filter((e) => e.onboarding_status === 'ready_to_join').length;
    return { toReview, reupload, ready, joiners: employees.length };
  }, [scopedDocuments, employees]);

  const joinerList = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    const rows = employees
      .map((emp) => {
        const counts = countsByEmployee.get(String(emp.id)) || { review: 0, reupload: 0 };
        return {
          ...emp,
          reviewCount: counts.review,
          reuploadCount: counts.reupload,
          actionCount: counts.review + counts.reupload,
        };
      })
      .filter((emp) => {
        if (!q) return true;
        return (
          (emp.name && emp.name.toLowerCase().includes(q))
          || (emp.email && emp.email.toLowerCase().includes(q))
          || (emp.job_title && emp.job_title.toLowerCase().includes(q))
        );
      })
      .sort((a, b) => {
        if (b.actionCount !== a.actionCount) return b.actionCount - a.actionCount;
        return (a.name || '').localeCompare(b.name || '');
      });
    return rows;
  }, [employees, countsByEmployee, searchTerm]);

  useEffect(() => {
    if (loading) return;
    if (employeeParam && employees.some((emp) => String(emp.id) === employeeParam)) {
      setSelectedId(employeeParam);
      return;
    }
    if (selectedId) return;
    const first = joinerList.find((row) => row.reviewCount > 0) || joinerList[0];
    if (first) setSelectedId(first.id);
  }, [loading, joinerList, selectedId, employeeParam, employees]);

  const reviewDocs = useMemo(
    () => (detail?.documents || []).filter((d) => d.status === 'uploaded'),
    [detail],
  );

  const waitingDocs = useMemo(
    () => (detail?.documents || []).filter((d) => d.status === 'reupload_requested'),
    [detail],
  );

  const verifiedCount = useMemo(
    () => (detail?.documents || []).filter((d) => d.status === 'verified' || d.status === 'physically_verified').length,
    [detail],
  );

  async function runDocumentAction(action, documentId, body = {}) {
    if (!documentId) return;
    setActionLoading((c) => ({ ...c, [documentId]: true }));
    try {
      const endpoint =
        action === 'approve'
          ? `/hr/documents/${documentId}/approve/`
          : action === 'reject'
            ? `/hr/documents/${documentId}/reject/`
            : `/hr/documents/${documentId}/request-reupload/`;
      await api.post(endpoint, body);
      toast.success(
        action === 'approve' ? 'Document approved' : action === 'reject' ? 'Document rejected' : 'Re-upload requested',
      );
      setModal(null);
      setReason('');
      await Promise.allSettled([loadLists(), selectedId ? loadDetail(selectedId) : Promise.resolve()]);
    } catch (err) {
      toast.error(err.response?.data?.error || err.response?.data?.detail || 'Action failed');
    } finally {
      setActionLoading((c) => ({ ...c, [documentId]: false }));
    }
  }

  async function openPreview(doc) {
    if (!doc.id || !doc.has_file) return;
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreview(doc);
    setPreviewUrl('');
    setPreviewKind('none');
    try {
      const { data } = await api.get(`/hr/documents/${doc.id}/preview/`, { responseType: 'blob' });
      const ext = (doc.file_name || '').split('.').pop()?.toLowerCase();
      const kind = ext === 'pdf' ? 'pdf' : ['jpg', 'jpeg', 'png', 'webp'].includes(ext) ? 'image' : 'other';
      setPreviewKind(kind);
      setPreviewUrl(URL.createObjectURL(data));
    } catch {
      toast.error('Could not load preview');
      setPreview(null);
    }
  }

  function closePreview() {
    setPreview(null);
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl('');
    setPreviewKind('none');
  }

  async function activateEmployee() {
    if (!selectedId) return;
    if (!window.confirm('Activate this employee?')) return;
    try {
      await api.post(`/hr/employees/${selectedId}/activate-onboarding/`);
      toast.success('Employee activated');
      setSelectedId(null);
      await loadLists();
    } catch (err) {
      const data = err.response?.data || {};
      if (data.requires_override) {
        const proceed = window.confirm(
          `${data.message || 'Designation is not linked.'}\n\nActivate anyway with HR override?`,
        );
        if (!proceed) return;
        try {
          await api.post(`/hr/employees/${selectedId}/activate-onboarding/`, {
            override_missing_designation: true,
          });
          toast.success('Employee activated (designation override applied)');
          setSelectedId(null);
          await loadLists();
          return;
        } catch (overrideErr) {
          toast.error(overrideErr.response?.data?.message || 'Unable to activate');
          return;
        }
      }
      toast.error(data.message || 'Unable to activate');
    }
  }

  const progressPct = detail?.progress?.progress_percentage ?? 0;

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold text-slate-900">
            <FileCheck className="text-violet-600" size={24} />
            Document verification
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            Review uploaded documents and approve joiners for activation.
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <JourneyJobFilter value={jobOpening} onChange={setJobOpening} />
          <button
            type="button"
            onClick={loadLists}
            className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
          >
            <RefreshCw size={16} />
            Refresh
          </button>
        </div>
      </div>

      {loading ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-4">
          <TableSkeleton rows={6} cols={3} />
        </div>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-3">
            {[
              { label: 'Needs review', value: summary.toReview, tone: 'text-amber-700 bg-amber-50 border-amber-100' },
              { label: 'Re-upload pending', value: summary.reupload, tone: 'text-orange-700 bg-orange-50 border-orange-100' },
              { label: 'Ready to activate', value: summary.ready, tone: 'text-emerald-700 bg-emerald-50 border-emerald-100' },
            ].map((card) => (
              <div key={card.label} className={`rounded-xl border p-4 ${card.tone}`}>
                <p className="text-xs font-medium opacity-80">{card.label}</p>
                <p className="mt-1 text-2xl font-bold">{card.value}</p>
              </div>
            ))}
          </div>

          <div className="grid gap-4 lg:grid-cols-[300px_minmax(0,1fr)]">
            <aside className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
              <div className="border-b border-slate-100 p-4">
                <p className="text-sm font-semibold text-slate-900">Joiners ({summary.joiners})</p>
                <div className="relative mt-3">
                  <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
                  <input
                    className="w-full rounded-xl border border-slate-200 py-2 pl-9 pr-3 text-sm outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100"
                    placeholder="Search name or role"
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                  />
                </div>
              </div>
              <div className="max-h-[520px] divide-y divide-slate-100 overflow-y-auto">
                {joinerList.length === 0 ? (
                  <p className="px-4 py-10 text-center text-sm text-slate-500">No joiners in onboarding.</p>
                ) : (
                  joinerList.map((emp) => {
                    const active = String(selectedId) === String(emp.id);
                    return (
                      <button
                        key={emp.id}
                        type="button"
                        onClick={() => setSelectedId(emp.id)}
                        className={`flex w-full items-center gap-3 px-4 py-3 text-left transition hover:bg-slate-50 ${
                          active ? 'bg-violet-50' : ''
                        }`}
                      >
                        <div className="min-w-0 flex-1">
                          <p className="truncate font-semibold text-slate-900">{emp.name}</p>
                          <p className="truncate text-xs text-slate-500">{emp.job_title || '—'}</p>
                        </div>
                        {emp.reviewCount > 0 ? (
                          <span className="shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-bold text-amber-900">
                            {emp.reviewCount}
                          </span>
                        ) : emp.onboarding_status === 'ready_to_join' ? (
                          <span className="shrink-0 rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-bold text-emerald-800">
                            Ready
                          </span>
                        ) : (
                          <ChevronRight size={16} className="shrink-0 text-slate-300" />
                        )}
                      </button>
                    );
                  })
                )}
              </div>
            </aside>

            <main className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
              {!selectedId ? (
                <div className="flex flex-col items-center justify-center gap-2 px-6 py-24 text-center text-slate-500">
                  <UserCheck className="h-10 w-10 text-slate-300" />
                  <p className="font-medium text-slate-800">Select a joiner to review documents</p>
                </div>
              ) : detailLoading || !detail ? (
                <div className="p-6">
                  <TableSkeleton rows={4} cols={2} />
                </div>
              ) : (
                <div className="p-5">
                  <div className="flex flex-col gap-4 border-b border-slate-100 pb-4 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <h2 className="text-xl font-bold text-slate-900">{detail.employee?.name}</h2>
                      <p className="text-sm text-slate-600">{detail.employee?.job_title || '—'}</p>
                      <div className="mt-3">
                        <div className="flex items-center justify-between text-xs text-slate-500">
                          <span>
                            {detail.progress?.verified_count ?? 0} of {detail.progress?.total_required ?? 0} verified
                          </span>
                          <span>{Math.round(progressPct)}%</span>
                        </div>
                        <div className="mt-1 h-2 overflow-hidden rounded-full bg-slate-100">
                          <div
                            className="h-full rounded-full bg-violet-500 transition-all"
                            style={{ width: `${Math.min(100, progressPct)}%` }}
                          />
                        </div>
                      </div>
                    </div>
                    {detail.can_activate && (
                      <button
                        type="button"
                        onClick={activateEmployee}
                        className="inline-flex shrink-0 items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700"
                      >
                        <CheckCircle size={16} />
                        Activate employee
                      </button>
                    )}
                  </div>

                  {reviewDocs.length === 0 && waitingDocs.length === 0 ? (
                    <div className="py-16 text-center">
                      <p className="font-medium text-slate-800">Nothing to review right now</p>
                      <p className="mt-1 text-sm text-slate-500">
                        {verifiedCount > 0
                          ? `${verifiedCount} document(s) already verified.`
                          : 'Documents will appear here after the joiner uploads them.'}
                      </p>
                      <Link
                        to={`/hr/employees/${selectedId}/documents`}
                        className="mt-4 inline-block text-sm font-semibold text-violet-700 hover:underline"
                      >
                        Open full document workspace
                      </Link>
                    </div>
                  ) : (
                    <div className="mt-4 space-y-6">
                      {reviewDocs.length > 0 && (
                        <section>
                          <h3 className="mb-3 text-sm font-semibold text-slate-900">
                            Review now ({reviewDocs.length})
                          </h3>
                          <ul className="space-y-3">
                            {reviewDocs.map((doc) => {
                              const busy = doc.id && actionLoading[doc.id];
                              return (
                                <li
                                  key={doc.id}
                                  className="rounded-xl border border-amber-100 bg-amber-50/40 p-4"
                                >
                                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                                    <div className="min-w-0">
                                      <p className="font-semibold text-slate-900">{doc.document_label}</p>
                                      {doc.file_name ? (
                                        <p className="truncate text-xs text-slate-500">{doc.file_name}</p>
                                      ) : null}
                                    </div>
                                    <div className="flex flex-wrap items-center gap-2">
                                      {doc.has_file && doc.preview_supported ? (
                                        <button
                                          type="button"
                                          onClick={() => openPreview(doc)}
                                          className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                                        >
                                          <Eye size={14} />
                                          Preview
                                        </button>
                                      ) : null}
                                      <button
                                        type="button"
                                        disabled={busy}
                                        onClick={() => runDocumentAction('approve', doc.id)}
                                        className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
                                      >
                                        Approve
                                      </button>
                                      <button
                                        type="button"
                                        disabled={busy}
                                        onClick={() => {
                                          setModal({ type: 'reupload', document: doc });
                                          setReason('Please upload a clearer copy.');
                                        }}
                                        className="rounded-lg border border-orange-200 bg-white px-3 py-1.5 text-xs font-semibold text-orange-800 hover:bg-orange-50 disabled:opacity-50"
                                      >
                                        Ask re-upload
                                      </button>
                                      <button
                                        type="button"
                                        disabled={busy}
                                        onClick={() => {
                                          setModal({ type: 'reject', document: doc });
                                          setReason('');
                                        }}
                                        className="inline-flex items-center gap-1 rounded-lg border border-rose-200 bg-white px-3 py-1.5 text-xs font-semibold text-rose-700 hover:bg-rose-50 disabled:opacity-50"
                                      >
                                        <XCircle size={14} />
                                        Reject
                                      </button>
                                    </div>
                                  </div>
                                </li>
                              );
                            })}
                          </ul>
                        </section>
                      )}

                      {waitingDocs.length > 0 && (
                        <section>
                          <h3 className="mb-3 text-sm font-semibold text-slate-900">
                            Waiting for re-upload ({waitingDocs.length})
                          </h3>
                          <ul className="space-y-2">
                            {waitingDocs.map((doc) => (
                              <li
                                key={doc.id}
                                className="flex items-center justify-between rounded-xl border border-slate-200 px-4 py-3"
                              >
                                <span className="font-medium text-slate-800">{doc.document_label}</span>
                                <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS_STYLES.reupload_requested}`}>
                                  {statusLabel(doc.status)}
                                </span>
                              </li>
                            ))}
                          </ul>
                        </section>
                      )}

                      {verifiedCount > 0 && (
                        <p className="text-xs text-slate-500">
                          {verifiedCount} document{verifiedCount === 1 ? '' : 's'} already verified.{' '}
                          <Link
                            to={`/hr/employees/${selectedId}/documents`}
                            className="font-semibold text-violet-700 hover:underline"
                          >
                            View all
                          </Link>
                        </p>
                      )}
                    </div>
                  )}
                </div>
              )}
            </main>
          </div>
        </>
      )}

      {modal?.type === 'reject' && (
        <ActionModal
          title="Reject document"
          label={modal.document.document_label}
          reason={reason}
          setReason={setReason}
          onClose={() => setModal(null)}
          confirmClass="bg-rose-600 hover:bg-rose-700"
          confirmText="Reject"
          onConfirm={() => {
            if (!reason.trim()) {
              toast.error('Please add a reason');
              return;
            }
            runDocumentAction('reject', modal.document.id, { rejection_reason: reason.trim() });
          }}
        />
      )}

      {modal?.type === 'reupload' && (
        <ActionModal
          title="Request re-upload"
          label={modal.document.document_label}
          reason={reason}
          setReason={setReason}
          onClose={() => setModal(null)}
          confirmClass="bg-orange-600 hover:bg-orange-700"
          confirmText="Send request"
          onConfirm={() => {
            if (!reason.trim()) {
              toast.error('Please add instructions');
              return;
            }
            runDocumentAction('reupload', modal.document.id, { reason: reason.trim() });
          }}
        />
      )}

      {preview && (
        <PreviewModal
          doc={preview}
          url={previewUrl}
          kind={previewKind}
          onClose={closePreview}
        />
      )}
    </div>
  );
}
