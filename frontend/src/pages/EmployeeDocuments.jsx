import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import HRPageWrapper from '../components/HR/HRPageWrapper';
import api from '../api';
import toast from 'react-hot-toast';
import {
  ArrowLeft, Check, CheckCircle2, Eye, RefreshCw, RotateCcw, Shield, UserCheck, X,
} from 'lucide-react';

const HR_STATUS_STYLES = {
  pending: 'bg-slate-100 text-slate-700 border-slate-200',
  verified: 'bg-emerald-50 text-emerald-800 border-emerald-200',
  office_verified: 'bg-teal-50 text-teal-900 border-teal-200',
  reupload_required: 'bg-orange-50 text-orange-900 border-orange-200',
  rejected: 'bg-rose-50 text-rose-800 border-rose-200',
};

function RejectModal({ onClose, onReupload, onFinalReject, loading, reason, setReason }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/55 p-4">
      <div className="w-full max-w-lg rounded-xl border border-slate-200 bg-white shadow-2xl">
        <div className="border-b border-slate-200 px-6 py-4">
          <h3 className="text-lg font-semibold text-slate-900">Reject document</h3>
          <p className="mt-1 text-sm text-slate-600">Choose how to proceed. Re-upload notifies the candidate for this document only.</p>
        </div>
        <div className="px-6 py-4">
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={4}
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
            placeholder="Reason (required)"
          />
        </div>
        <div className="flex flex-col gap-2 border-t border-slate-200 px-6 py-4 sm:flex-row sm:justify-end">
          <button type="button" onClick={onClose} className="rounded-lg border px-4 py-2 text-sm">Cancel</button>
          <button type="button" disabled={loading} onClick={onReupload} className="rounded-lg bg-orange-600 px-4 py-2 text-sm font-medium text-white hover:bg-orange-700 disabled:opacity-50">
            Request reupload
          </button>
          <button type="button" disabled={loading} onClick={onFinalReject} className="rounded-lg bg-rose-600 px-4 py-2 text-sm font-medium text-white hover:bg-rose-700 disabled:opacity-50">
            Final reject candidate
          </button>
        </div>
      </div>
    </div>
  );
}

function PreviewModal({ doc, url, kind, onClose }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4" onClick={onClose}>
      <div className="max-h-[90vh] w-full max-w-4xl overflow-hidden rounded-xl bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b px-4 py-3">
          <div>
            <p className="font-semibold text-slate-900">{doc.document_label}</p>
            <p className="text-xs text-slate-500">{doc.file_name}</p>
          </div>
          <button type="button" onClick={onClose} className="rounded p-2 hover:bg-slate-100"><X size={18} /></button>
        </div>
        <div className="flex min-h-[300px] items-center justify-center bg-slate-100 p-4">
          {!url ? <p className="text-sm text-slate-500">Loading…</p> : kind === 'pdf' ? (
            <iframe title="preview" src={url} className="h-[70vh] w-full rounded bg-white" />
          ) : kind === 'image' ? (
            <img src={url} alt="" className="max-h-[70vh] max-w-full object-contain" />
          ) : <p className="text-sm">Preview not available</p>}
        </div>
      </div>
    </div>
  );
}

export default function EmployeeDocuments() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [payload, setPayload] = useState(null);
  const [selected, setSelected] = useState(new Set());
  const [actionLoading, setActionLoading] = useState({});
  const [rejectTarget, setRejectTarget] = useState(null);
  const [rejectReason, setRejectReason] = useState('');
  const [preview, setPreview] = useState(null);
  const [previewUrl, setPreviewUrl] = useState('');
  const [previewKind, setPreviewKind] = useState('none');
  const [lastUndo, setLastUndo] = useState(null);
  const [activating, setActivating] = useState(false);

  const loadReviewData = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get(`/hr/employees/${id}/documents/`);
      setPayload(data);
      setSelected(new Set());
    } catch (error) {
      if (error?.response?.status === 404 && error?.response?.data?.application_rejected) {
        toast.error('This application was rejected and is no longer in document verification.');
        navigate('/hr/onboarding/document-verification', { replace: true });
        return;
      }
      toast.error('Failed to load verification queue');
      navigate('/hr/journey-center');
    } finally {
      setLoading(false);
    }
  }, [id, navigate]);

  useEffect(() => { loadReviewData(); }, [loadReviewData]);
  useEffect(() => () => { if (previewUrl) URL.revokeObjectURL(previewUrl); }, [previewUrl]);

  const documents = payload?.documents || [];
  const locked = payload?.application_rejected;

  const toggleSelect = (docId) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(docId)) next.delete(docId); else next.add(docId);
      return next;
    });
  };

  const toggleAll = () => {
    if (selected.size === documents.length) setSelected(new Set());
    else setSelected(new Set(documents.map((d) => d.id)));
  };

  const openPreview = async (doc) => {
    if (!doc.has_file) return toast.error('No file uploaded');
    setPreview(doc);
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl('');
    try {
      const { data } = await api.get(`/hr/documents/${doc.id}/preview/`, { responseType: 'blob' });
      const ext = (doc.file_name || '').split('.').pop()?.toLowerCase();
      const kind = ext === 'pdf' ? 'pdf' : ['jpg', 'jpeg', 'png', 'webp'].includes(ext) ? 'image' : 'other';
      setPreviewKind(kind);
      setPreviewUrl(URL.createObjectURL(data));
    } catch {
      toast.error('Preview failed');
      setPreview(null);
    }
  };

  const runApprove = async (doc) => {
    setActionLoading((p) => ({ ...p, [doc.id]: true }));
    try {
      const { data } = await api.post(`/hr/documents/${doc.id}/approve/`);
      setLastUndo({ transition_id: data.transition_id, label: `Approved ${doc.document_label}` });
      toast.success('Document verified');
      await loadReviewData();
    } catch (e) {
      toast.error(e.response?.data?.error || 'Approve failed');
    } finally {
      setActionLoading((p) => ({ ...p, [doc.id]: false }));
    }
  };

  const runReject = async (mode) => {
    if (!rejectTarget) return;
    if (!rejectReason.trim()) return toast.error('Reason is required');
    const doc = rejectTarget;
    setActionLoading((p) => ({ ...p, [doc.id]: true }));
    try {
      const { data } = await api.post(`/hr/documents/${doc.id}/moderate-reject/`, { mode, reason: rejectReason });
      setLastUndo({ transition_id: data.transition_id, label: mode === 'final' ? 'Final rejection' : `Re-upload requested: ${doc.document_label}` });
      toast.success(data.message);
      setRejectTarget(null);
      setRejectReason('');
      await loadReviewData();
    } catch (e) {
      toast.error(e.response?.data?.error || 'Action failed');
    } finally {
      setActionLoading((p) => ({ ...p, [doc.id]: false }));
    }
  };

  const runUndo = async () => {
    if (!lastUndo?.transition_id) return;
    try {
      await api.post('/hr/documents/undo/', { transition_id: lastUndo.transition_id });
      toast.success('Action undone');
      setLastUndo(null);
      await loadReviewData();
    } catch (e) {
      toast.error(e.response?.data?.error || 'Undo failed');
    }
  };

  const activateEmployee = async () => {
    const name = payload?.employee?.name || 'this employee';
    if (!window.confirm(`Activate ${name}? They will be marked active and receive a welcome email.`)) return;
    setActivating(true);
    try {
      const { data } = await api.post(`/hr/employees/${id}/activate-onboarding/`);
      toast.success(data.message || 'Employee activated');
      await loadReviewData();
    } catch (e) {
      const data = e.response?.data || {};
      if (data.requires_override) {
        const proceed = window.confirm(
          `${data.message || 'Designation is not linked.'}\n\nActivate anyway with HR override?`,
        );
        if (proceed) {
          try {
            const { data: overrideData } = await api.post(`/hr/employees/${id}/activate-onboarding/`, {
              override_missing_designation: true,
            });
            toast.success(overrideData.message || 'Employee activated (designation override applied)');
            await loadReviewData();
            return;
          } catch (overrideErr) {
            toast.error(overrideErr.response?.data?.message || 'Unable to activate employee');
            return;
          }
        }
      } else {
        toast.error(data.message || data.error || 'Unable to activate employee');
      }
    } finally {
      setActivating(false);
    }
  };

  const runBulk = async (action, extra = {}) => {
    const ids = [...selected];
    if (!ids.length) return toast.error('Select documents first');
    if ((action === 'request_reupload' || action === 'final_reject') && !extra.reason?.trim()) {
      return toast.error('Reason required for bulk action');
    }
    try {
      const { data } = await api.post('/hr/documents/bulk-moderate/', {
        document_ids: ids,
        action,
        reason: extra.reason || '',
        reject_mode: extra.reject_mode,
      });
      const ok = data.succeeded?.length || 0;
      const fail = data.failed?.length || 0;
      if (fail) toast.error(`${fail} item(s) could not be processed`);
      if (ok) toast.success(`${ok} document(s) updated`);
      if (data.transitions?.[0]) {
        setLastUndo({ transition_id: data.transitions[data.transitions.length - 1], label: `Bulk ${action}` });
      }
      await loadReviewData();
    } catch (e) {
      toast.error(e.response?.data?.error || 'Bulk action failed');
    }
  };

  const selectedDocs = useMemo(() => documents.filter((d) => selected.has(d.id)), [documents, selected]);

  if (loading || !payload) {
    return (
      <HRPageWrapper color="purple">
        <div className="flex min-h-[50vh] items-center justify-center text-slate-500">Loading moderation queue…</div>
      </HRPageWrapper>
    );
  }

  const { employee, progress, can_activate: canActivate, hire_context: hireContext } = payload;
  const allMandatoryVerified = progress?.all_mandatory_verified;
  const isActive = employee.status === 'active';
  const isDirectOfficeHire = Boolean(hireContext?.is_direct_office_hire);

  return (
    <HRPageWrapper color="purple">
      <div className="mx-auto max-w-6xl space-y-6 p-4 md:p-6">
        <button type="button" onClick={() => navigate(`/hr/employees/${id}`)} className="inline-flex items-center gap-2 text-sm text-slate-600 hover:text-slate-900">
          <ArrowLeft size={16} /> Back to profile
        </button>

        <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Document verification</p>
              <h1 className="text-2xl font-bold text-slate-900">{employee.name}</h1>
              <p className="text-sm text-slate-600">{employee.employee_id} · {employee.department}</p>
            </div>
            <div className="flex items-center gap-2 rounded-lg bg-slate-800 px-3 py-2 text-white">
              <Shield size={18} />
              <span className="text-sm font-medium">KYC moderation</span>
            </div>
          </div>
          <div className="mt-4">
            <div className="mb-1 flex justify-between text-sm"><span>{progress.verified_count} / {progress.total_required} verified</span><span>{progress.progress_percentage}%</span></div>
            <div className="h-2 rounded-full bg-slate-200"><div className="h-full rounded-full bg-slate-800" style={{ width: `${progress.progress_percentage}%` }} /></div>
          </div>
        </div>

        {isDirectOfficeHire && (
          <div className="rounded-lg border border-teal-200 bg-teal-50 px-4 py-3 text-sm text-teal-950">
            <p className="font-semibold">{hireContext.label}</p>
            <p className="mt-1 text-teal-900/90">{hireContext.description}</p>
          </div>
        )}

        {locked && (
          <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-900">
            Application rejected — approve and re-upload actions are disabled.
          </div>
        )}

        {lastUndo && (
          <div className="flex items-center justify-between rounded-lg border border-indigo-200 bg-indigo-50 px-4 py-3 text-sm">
            <span className="text-indigo-900">Last action: {lastUndo.label}</span>
            <button type="button" onClick={runUndo} className="inline-flex items-center gap-1 rounded-lg bg-indigo-700 px-3 py-1.5 text-xs font-medium text-white">
              <RotateCcw size={14} /> Undo
            </button>
          </div>
        )}

        {selected.size > 0 && (
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
            <span className="text-sm font-medium text-slate-700">{selected.size} selected</span>
            <button type="button" disabled={locked} onClick={() => runBulk('approve')} className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50">Bulk approve</button>
            <button type="button" disabled={locked} onClick={() => {
              const reason = window.prompt('Re-upload reason for selected documents:');
              if (reason) runBulk('request_reupload', { reason });
            }} className="rounded-lg bg-orange-600 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50">Bulk reupload</button>
            <button type="button" disabled={locked} onClick={() => {
              const reason = window.prompt('Final rejection reason (rejects candidate):');
              if (reason) runBulk('final_reject', { reason, reject_mode: 'application' });
            }} className="rounded-lg bg-rose-600 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50">Bulk final reject</button>
          </div>
        )}

        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <table className="min-w-full text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3 w-10"><input type="checkbox" checked={selected.size === documents.length && documents.length > 0} onChange={toggleAll} /></th>
                <th className="px-4 py-3">Document name</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3 text-center w-12"></th>
                <th className="px-4 py-3 text-center w-12"></th>
                <th className="px-4 py-3 text-center w-12"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {documents.map((doc) => {
                const hrKey = doc.verified_at_office ? 'office_verified' : (doc.hr_status || 'pending');
                const busy = actionLoading[doc.id];
                const disabled = locked || busy;
                return (
                  <tr key={doc.id} className="hover:bg-slate-50/80">
                    <td className="px-4 py-3"><input type="checkbox" checked={selected.has(doc.id)} onChange={() => toggleSelect(doc.id)} /></td>
                    <td className="px-4 py-3">
                      <p className="font-medium text-slate-900">{doc.document_label}</p>
                      <p className="text-xs text-slate-500">
                        {doc.mandatory ? 'Required' : 'Optional'}
                        {doc.file_name ? ` · ${doc.file_name}` : doc.verified_at_office ? ' · No digital file (verified in office)' : ''}
                      </p>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex rounded-md border px-2 py-0.5 text-xs font-medium ${HR_STATUS_STYLES[hrKey] || HR_STATUS_STYLES.pending}`}>
                        {doc.hr_status_label || hrKey}
                      </span>
                      {doc.verified_at && doc.verified_by ? (
                        <p className="mt-1 text-[11px] text-slate-500">By {doc.verified_by}</p>
                      ) : null}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <button type="button" title="Preview" disabled={!doc.can_preview} onClick={() => openPreview(doc)} className="rounded-lg p-2 text-slate-600 hover:bg-slate-100 disabled:opacity-30">
                        <Eye size={18} />
                      </button>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <button type="button" title="Approve" disabled={disabled || !doc.can_approve} onClick={() => runApprove(doc)} className="rounded-lg p-2 text-emerald-600 hover:bg-emerald-50 disabled:opacity-30">
                        <Check size={18} />
                      </button>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <button type="button" title="Reject" disabled={disabled || !doc.can_reject} onClick={() => { setRejectTarget(doc); setRejectReason(''); }} className="rounded-lg p-2 text-rose-600 hover:bg-rose-50 disabled:opacity-30">
                        <X size={18} />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <section className="rounded-xl border border-emerald-200 bg-emerald-50/40 p-6 shadow-sm">
          {canActivate ? (
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex gap-3">
                <div className="rounded-lg bg-emerald-100 p-2.5 text-emerald-700">
                  <UserCheck size={22} />
                </div>
                <div>
                  <h2 className="text-lg font-semibold text-slate-900">Ready to activate</h2>
                  <p className="mt-1 text-sm text-slate-600">
                    All required documents are verified. Activate {employee.name} to complete onboarding.
                  </p>
                </div>
              </div>
              <button
                type="button"
                disabled={activating || locked}
                onClick={activateEmployee}
                className="inline-flex shrink-0 items-center justify-center gap-2 rounded-lg bg-emerald-600 px-6 py-3 text-sm font-semibold text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <CheckCircle2 size={18} />
                {activating ? 'Activating…' : 'Activate employee'}
              </button>
            </div>
          ) : isActive && (allMandatoryVerified || isDirectOfficeHire) ? (
            <div className="flex items-center gap-3">
              <CheckCircle2 size={22} className="shrink-0 text-emerald-600" />
              <div>
                <p className="font-semibold text-slate-900">Employee is active</p>
                <p className="text-sm text-slate-600">
                  {isDirectOfficeHire
                    ? 'Direct hire complete — documents verified at office and portal welcome email sent.'
                    : 'Onboarding is complete.'}
                </p>
              </div>
            </div>
          ) : isDirectOfficeHire ? null : (
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm text-slate-600">
                Verify all required documents ({progress.verified_count}/{progress.total_required}) to enable activation.
              </p>
              <button type="button" onClick={loadReviewData} className="inline-flex shrink-0 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm">
                <RefreshCw size={16} /> Refresh
              </button>
            </div>
          )}
        </section>
      </div>

      {rejectTarget && (
        <RejectModal
          reason={rejectReason}
          setReason={setRejectReason}
          loading={actionLoading[rejectTarget.id]}
          onClose={() => setRejectTarget(null)}
          onReupload={() => runReject('reupload')}
          onFinalReject={() => runReject('final')}
        />
      )}

      {preview && <PreviewModal doc={preview} url={previewUrl} kind={previewKind} onClose={() => { setPreview(null); if (previewUrl) URL.revokeObjectURL(previewUrl); setPreviewUrl(''); }} />}
    </HRPageWrapper>
  );
}
