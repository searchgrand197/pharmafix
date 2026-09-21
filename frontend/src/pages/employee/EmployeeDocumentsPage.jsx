import React, { useCallback, useEffect, useMemo, useState } from 'react';
import api from '../../api';
import toast from 'react-hot-toast';
import {
  AlertCircle,
  Camera,
  ChevronDown,
  ChevronUp,
  Download,
  Eye,
  FileText,
  History,
  Link2,
  RefreshCw,
  RotateCcw,
  Upload,
} from 'lucide-react';
import {
  documentStats,
  fetchEmployeeDocuments,
  normalizePortalDocument,
  ONBOARDING_TOKEN_KEY,
} from '../../utils/employeeDocuments';

const MAX_FILE_BYTES = 5 * 1024 * 1024;

const STATUS_UI = {
  pending: { label: 'Pending upload', badge: 'bg-amber-50 text-amber-900 border-amber-200' },
  uploaded: { label: 'Pending HR review', badge: 'bg-amber-50 text-amber-900 border-amber-200' },
  verified: { label: 'Verified by HR', badge: 'bg-emerald-50 text-emerald-800 border-emerald-200' },
  physically_verified: { label: 'Verified by HR', badge: 'bg-emerald-50 text-emerald-800 border-emerald-200' },
  rejected: { label: 'Rejected', badge: 'bg-rose-50 text-rose-800 border-rose-200' },
  reupload_requested: { label: 'Reupload needed', badge: 'bg-orange-50 text-orange-900 border-orange-200' },
  missing: { label: 'Not uploaded', badge: 'bg-slate-50 text-slate-700 border-slate-200' },
};

const WORKFLOW_UI = {
  NOT_UPLOADED: STATUS_UI.pending,
  UPLOADED: STATUS_UI.uploaded,
  VERIFIED: STATUS_UI.verified,
  REUPLOAD_REQUIRED: STATUS_UI.reupload_requested,
};

function formatDate(value) {
  if (!value) return '—';
  return new Date(value).toLocaleDateString(undefined, { dateStyle: 'medium' });
}

function formatDateTime(value) {
  if (!value) return '—';
  return new Date(value).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

function formatBytes(bytes) {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function resolveStatusUi(doc) {
  if (doc.workflow_status && WORKFLOW_UI[doc.workflow_status]) {
    return WORKFLOW_UI[doc.workflow_status];
  }
  const key = (doc.status || 'pending').toLowerCase();
  return STATUS_UI[key] || STATUS_UI.pending;
}

function isDocumentVerified(doc) {
  return doc.workflow_status === 'VERIFIED'
    || ['verified', 'physically_verified'].includes(doc.status);
}

function TouchButton({ children, className = '', ...props }) {
  return (
    <button
      type="button"
      className={`inline-flex min-h-[44px] min-w-[44px] items-center justify-center gap-2 rounded-xl px-4 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}

function PreviewModal({ doc, url, kind, onClose }) {
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/60 p-0 sm:items-center sm:p-4" onClick={onClose}>
      <div
        className="flex max-h-[92vh] w-full max-w-lg flex-col overflow-hidden rounded-t-2xl bg-white shadow-2xl sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
          <div className="min-w-0 pr-3">
            <p className="truncate font-semibold text-slate-900">{doc.document_label}</p>
            <p className="truncate text-xs text-slate-500">{doc.file_name || 'Document'}</p>
          </div>
          <TouchButton onClick={onClose} className="shrink-0 border border-slate-200 text-slate-600">
            Close
          </TouchButton>
        </div>
        <div className="flex min-h-[240px] flex-1 items-center justify-center bg-slate-100 p-3">
          {!url ? (
            <p className="text-sm text-slate-500">Loading preview…</p>
          ) : kind === 'pdf' ? (
            <iframe title="Document preview" src={url} className="h-[60vh] w-full rounded-lg bg-white" />
          ) : kind === 'image' ? (
            <img src={url} alt={doc.document_label} className="max-h-[60vh] max-w-full rounded-lg object-contain" />
          ) : (
            <p className="px-4 text-center text-sm text-slate-600">Preview not available for this file type.</p>
          )}
        </div>
      </div>
    </div>
  );
}

function DocumentCard({
  doc,
  dataSource,
  uploading,
  uploadPercent,
  onUpload,
  onPreview,
  onDownload,
  onPreviewVersion,
  onDownloadVersion,
  onRequestUpdate,
  requestingUpdate,
}) {
  const [historyOpen, setHistoryOpen] = useState(false);
  const statusUi = resolveStatusUi(doc);
  const busy = uploading[doc.id];
  const pct = uploadPercent[doc.id] || 0;
  const canUpload = doc.requires_upload && doc.can_replace && !doc.locked;
  const canView = Boolean(doc.file_name);
  const showRequestUpdate = doc.locked || doc.status === 'verified' || doc.workflow_status === 'VERIFIED';

  return (
    <article className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-start gap-3">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-teal-50 text-teal-700">
          <FileText size={20} />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="font-semibold text-slate-900">{doc.document_label}</h3>
          {doc.description ? (
            <p className="mt-0.5 text-xs text-slate-500">{doc.description}</p>
          ) : null}
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <span className={`inline-flex rounded-lg border px-2.5 py-1 text-xs font-medium ${statusUi.badge}`}>
              {statusUi.label}
            </span>
            {doc.mandatory ? (
              <span className="rounded-lg bg-slate-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-600">
                Required
              </span>
            ) : null}
          </div>
          <p className="mt-2 text-xs text-slate-500">
            {isDocumentVerified(doc) && doc.verified_at
              ? `Verified by HR: ${formatDate(doc.verified_at)}`
              : `Last updated: ${formatDate(doc.uploaded_at)}`}
          </p>
          {doc.file_name ? (
            <p className="mt-1 truncate text-xs text-slate-600">
              {doc.file_name}{doc.file_size ? ` · ${formatBytes(doc.file_size)}` : ''}
            </p>
          ) : null}
        </div>
      </div>

      {(doc.rejection_reason || doc.verification_notes) && (
        <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-950">
          {doc.rejection_reason ? <p><span className="font-semibold">HR:</span> {doc.rejection_reason}</p> : null}
          {doc.verification_notes && doc.verification_notes !== doc.rejection_reason ? (
            <p className="mt-1"><span className="font-semibold">Note:</span> {doc.verification_notes}</p>
          ) : null}
        </div>
      )}

      <div className="mt-4 flex flex-wrap gap-2">
        <TouchButton
          title="Preview document"
          aria-label="Preview document"
          disabled={!canView}
          onClick={() => onPreview(doc)}
          className="border border-slate-200 text-slate-700 hover:bg-slate-50"
        >
          <Eye size={18} />
        </TouchButton>

        {canView && dataSource === 'portal' ? (
          <TouchButton
            title="Download document"
            aria-label="Download document"
            onClick={() => onDownload(doc)}
            className="border border-slate-200 text-slate-700 hover:bg-slate-50"
          >
            <Download size={18} />
          </TouchButton>
        ) : null}

        {canUpload ? (
          <label className="inline-flex min-h-[44px] cursor-pointer items-center gap-2 rounded-xl bg-teal-600 px-4 text-sm font-semibold text-white hover:bg-teal-700">
            <Upload size={16} />
            {doc.file_name ? 'Reupload' : 'Upload'}
            <input
              type="file"
              accept="image/*,application/pdf,.pdf,.jpg,.jpeg,.png"
              capture="environment"
              className="hidden"
              disabled={busy || dataSource === 'onboarding'}
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = '';
                if (file) onUpload(doc, file);
              }}
            />
          </label>
        ) : null}

        {showRequestUpdate ? (
          <TouchButton
            onClick={() => onRequestUpdate(doc)}
            disabled={requestingUpdate[doc.id]}
            className="border border-violet-200 bg-violet-50 text-violet-800 hover:bg-violet-100"
          >
            {requestingUpdate[doc.id] ? 'Sending…' : 'Request update'}
          </TouchButton>
        ) : null}
      </div>

      {busy ? (
        <div className="mt-3">
          <div className="mb-1 flex justify-between text-xs text-slate-500">
            <span>Uploading…</span>
            <span>{pct}%</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-slate-200">
            <div className="h-full rounded-full bg-teal-600 transition-all" style={{ width: `${pct}%` }} />
          </div>
        </div>
      ) : null}

      <button
        type="button"
        onClick={() => setHistoryOpen((v) => !v)}
        className="mt-4 flex min-h-[44px] w-full items-center justify-between rounded-xl border border-slate-100 bg-slate-50 px-3 text-sm font-medium text-slate-700"
      >
        <span className="flex items-center gap-2">
          <History size={16} /> Document history
        </span>
        {historyOpen ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
      </button>

      {historyOpen ? (
        <ul className="mt-2 space-y-2 border-l-2 border-slate-200 pl-4">
          {doc.history?.length ? doc.history.map((event) => (
            <li key={event.id} className="text-xs text-slate-600">
              <p className="font-semibold text-slate-800">{event.label}</p>
              <p className="text-slate-500">{formatDateTime(event.at)}</p>
              {event.detail ? <p className="mt-0.5">{event.detail}</p> : null}
              {event.version_id && dataSource === 'portal' ? (
                <div className="mt-2 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => onPreviewVersion(doc, event)}
                    className="min-h-[36px] rounded-lg border border-slate-200 px-2 py-1 text-xs font-semibold text-slate-700"
                  >
                    Preview version
                  </button>
                  <button
                    type="button"
                    onClick={() => onDownloadVersion(doc, event)}
                    className="min-h-[36px] rounded-lg border border-slate-200 px-2 py-1 text-xs font-semibold text-slate-700"
                  >
                    Download version
                  </button>
                </div>
              ) : null}
            </li>
          )) : (
            <li className="text-xs text-slate-500">No history recorded yet.</li>
          )}
        </ul>
      ) : null}
    </article>
  );
}

export default function EmployeeDocumentsPage() {
  const [documents, setDocuments] = useState([]);
  const [progress, setProgress] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [accessBlocked, setAccessBlocked] = useState(false);
  const [dataSource, setDataSource] = useState('portal');
  const [onboardingToken, setOnboardingToken] = useState(() => localStorage.getItem(ONBOARDING_TOKEN_KEY) || '');
  const [tokenInput, setTokenInput] = useState('');
  const [showTokenLink, setShowTokenLink] = useState(false);
  const [uploading, setUploading] = useState({});
  const [uploadPercent, setUploadPercent] = useState({});
  const [requestingUpdate, setRequestingUpdate] = useState({});
  const [preview, setPreview] = useState(null);
  const [previewUrl, setPreviewUrl] = useState('');
  const [previewKind, setPreviewKind] = useState('none');

  const documentSummary = useMemo(() => documentStats(documents), [documents]);

  const allRequiredVerified = useMemo(() => {
    if (progress?.all_required_verified != null) {
      return Boolean(progress.all_required_verified);
    }
    const { required, approved, reupload } = documentSummary;
    return required > 0 && approved >= required && reupload === 0;
  }, [progress, documentSummary]);

  const applyPayload = useCallback((payload) => {
    setDocuments(payload.documents || []);
    setProgress(payload.progress || null);
    setDataSource(payload.source || 'portal');
    setAccessBlocked(Boolean(payload.accessBlocked));
  }, []);

  const loadDocuments = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    try {
      const payload = await fetchEmployeeDocuments();
      applyPayload(payload);
    } catch {
      setLoadError(true);
      setDocuments([]);
      setProgress(null);
      toast.error('Failed to load documents');
    } finally {
      setLoading(false);
    }
  }, [applyPayload]);

  useEffect(() => {
    document.title = 'Documents | Employee Portal';
    loadDocuments();
  }, [loadDocuments]);

  useEffect(() => () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
  }, [previewUrl]);

  function saveOnboardingToken() {
    const trimmed = tokenInput.trim();
    if (!trimmed) return toast.error('Paste your onboarding link token');
    localStorage.setItem(ONBOARDING_TOKEN_KEY, trimmed);
    setOnboardingToken(trimmed);
    setShowTokenLink(false);
    loadDocuments();
  }

  async function handleUpload(doc, file) {
    if (file.size > MAX_FILE_BYTES) {
      toast.error('File exceeds 5 MB limit. Choose a smaller file.');
      return;
    }

    if (dataSource === 'onboarding') {
      toast.error('Upload via onboarding link is read-only here. Use employee portal session upload.');
      return;
    }

    setUploading((p) => ({ ...p, [doc.id]: true }));
    setUploadPercent((p) => ({ ...p, [doc.id]: 0 }));
    try {
      const formData = new FormData();
      formData.append('file', file);
      const { data } = await api.post(
        `/employee-portal/documents/${doc.id}/upload/`,
        formData,
        {
          headers: { 'Content-Type': 'multipart/form-data' },
          onUploadProgress: (ev) => {
            if (ev.total) {
              setUploadPercent((p) => ({
                ...p,
                [doc.id]: Math.round((ev.loaded / ev.total) * 100),
              }));
            }
          },
        },
      );
      applyPayload({
        documents: (data.documents || []).map(normalizePortalDocument),
        progress: data.progress,
        source: 'portal',
        accessBlocked: false,
      });
      toast.success(doc.file_name ? `${doc.document_label} replaced` : `${doc.document_label} uploaded`);
    } catch (err) {
      const msg = err?.response?.data?.error || 'Upload failed. Tap Reupload to try again.';
      toast.error(msg);
    } finally {
      setUploading((p) => ({ ...p, [doc.id]: false }));
      setUploadPercent((p) => ({ ...p, [doc.id]: 0 }));
    }
  }

  async function downloadBlob(url, filename) {
    const { data } = await api.get(url, { responseType: 'blob' });
    const blobUrl = URL.createObjectURL(data);
    const anchor = document.createElement('a');
    anchor.href = blobUrl;
    anchor.download = filename || 'document';
    anchor.click();
    URL.revokeObjectURL(blobUrl);
  }

  async function handleDownload(doc) {
    if (!doc.file_name) return toast.error('No file uploaded yet');
    try {
      await downloadBlob(`/employee-portal/documents/${doc.id}/download/`, doc.file_name);
    } catch {
      toast.error('Download failed');
    }
  }

  async function handlePreviewVersion(doc, event) {
    if (!event.version_id) return;
    setPreview(doc);
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl('');
    setPreviewKind('none');
    try {
      const { data } = await api.get(
        `/employee-portal/documents/${doc.id}/versions/${event.version_id}/preview/`,
        { responseType: 'blob' },
      );
      const ext = (event.detail || '').split('.').pop()?.toLowerCase();
      setPreviewKind(ext === 'pdf' ? 'pdf' : ['jpg', 'jpeg', 'png', 'webp'].includes(ext) ? 'image' : 'unsupported');
      setPreviewUrl(URL.createObjectURL(data));
    } catch {
      toast.error('Version preview failed');
      setPreview(null);
    }
  }

  async function handleDownloadVersion(doc, event) {
    if (!event.version_id) return;
    try {
      await downloadBlob(
        `/employee-portal/documents/${doc.id}/versions/${event.version_id}/download/`,
        event.detail || 'document-version',
      );
    } catch {
      toast.error('Version download failed');
    }
  }

  async function handlePreview(doc) {
    if (!doc.file_name) {
      return toast.error('No file uploaded yet');
    }

    setPreview(doc);
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl('');
    setPreviewKind('none');

    try {
      let blob;
      if (dataSource === 'onboarding' && doc.preview_url) {
        const res = await fetch(doc.preview_url);
        if (!res.ok) throw new Error();
        blob = await res.blob();
      } else {
        const { data } = await api.get(
          `/employee-portal/documents/${doc.id}/preview/`,
          { responseType: 'blob' },
        );
        blob = data;
      }
      const ext = (doc.file_name || '').split('.').pop()?.toLowerCase();
      setPreviewKind(ext === 'pdf' ? 'pdf' : ['jpg', 'jpeg', 'png', 'webp'].includes(ext) ? 'image' : 'unsupported');
      setPreviewUrl(URL.createObjectURL(blob));
    } catch {
      toast.error('Preview failed. Try again later.');
      setPreview(null);
    }
  }

  async function handleRequestUpdate(doc) {
    const reason = window.prompt(
      `Why do you need to update "${doc.document_label}"? (optional)`,
      '',
    );
    if (reason === null) return;

    setRequestingUpdate((p) => ({ ...p, [doc.id]: true }));
    try {
      await api.post(`/employee-portal/documents/${doc.id}/request-update/`, { reason });
      toast.success('Update request sent to HR.');
    } catch (err) {
      toast.error(err?.response?.data?.error || 'Failed to send update request.');
    } finally {
      setRequestingUpdate((p) => ({ ...p, [doc.id]: false }));
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-[40vh] flex-col items-center justify-center gap-3 text-slate-600">
        <RefreshCw className="h-8 w-8 animate-spin text-teal-600" />
        <p className="text-sm font-medium">Loading your documents…</p>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-lg space-y-4 pb-8">
      <header>
        <h1 className="text-xl font-bold text-slate-900">Document Center</h1>
        <p className="mt-1 text-sm text-slate-600">
          Required documents for your role — view, upload, and track verification status.
        </p>
      </header>

      {allRequiredVerified && documents.length > 0 ? (
        <section className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-950">
          <p className="font-semibold">All required documents are verified by HR</p>
          <p className="mt-1 text-emerald-900/80">
            Your document checklist is complete. You can still view or download your files below.
          </p>
        </section>
      ) : null}

      {progress && documents.length > 0 && !allRequiredVerified ? (
        <section className="rounded-2xl border border-teal-200 bg-teal-50 p-4">
          <div className="flex items-center justify-between gap-2 text-sm font-semibold text-teal-900">
            <span>{progress.label || 'Document progress'}</span>
            <span>{progress.verified_percent ?? progress.percent ?? 0}%</span>
          </div>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-teal-100">
            <div
              className="h-full rounded-full bg-teal-600 transition-all"
              style={{ width: `${progress.verified_percent ?? progress.percent ?? 0}%` }}
            />
          </div>
        </section>
      ) : null}

      {accessBlocked && dataSource === 'none' ? (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
          <div className="flex gap-2">
            <AlertCircle className="mt-0.5 h-5 w-5 shrink-0" />
            <div>
              <p className="font-semibold">Could not load your document checklist</p>
              <p className="mt-1">
                Your employee profile may not be linked yet. Contact HR, or link your onboarding token below as a fallback.
              </p>
              <button
                type="button"
                onClick={() => setShowTokenLink((v) => !v)}
                className="mt-3 inline-flex min-h-[44px] items-center gap-2 rounded-xl bg-amber-900 px-4 text-sm font-semibold text-white"
              >
                <Link2 size={16} /> {showTokenLink ? 'Hide' : 'Link onboarding token (legacy)'}
              </button>
            </div>
          </div>
          {showTokenLink ? (
            <div className="mt-3 flex flex-col gap-2 sm:flex-row">
              <input
                type="text"
                value={tokenInput}
                onChange={(e) => setTokenInput(e.target.value)}
                placeholder="Paste onboarding token (UUID)"
                className="min-h-[44px] flex-1 rounded-xl border border-amber-300 bg-white px-3 text-sm"
              />
              <TouchButton onClick={saveOnboardingToken} className="bg-teal-600 text-white hover:bg-teal-700">
                Save & reload
              </TouchButton>
            </div>
          ) : null}
        </div>
      ) : null}

      {dataSource === 'onboarding' ? (
        <p className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
          Showing documents via legacy onboarding link. Upload here is disabled — use your employee login for uploads.
        </p>
      ) : null}

      {loadError ? (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-center">
          <p className="text-sm font-medium text-rose-900">Could not load documents</p>
          <TouchButton onClick={loadDocuments} className="mt-3 border border-rose-300 text-rose-800">
            <RotateCcw size={16} /> Retry
          </TouchButton>
        </div>
      ) : null}

      {!loadError && !accessBlocked && documents.length === 0 ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm">
          <FileText className="mx-auto h-10 w-10 text-slate-300" />
          <p className="mt-3 font-medium text-slate-800">No documents required for your role</p>
          <p className="mt-1 text-sm text-slate-500">
            If you believe this is incorrect, contact HR.
          </p>
        </div>
      ) : null}

      {documents.length > 0 ? (
        <section className="space-y-3">
          <h2 className="text-sm font-bold uppercase tracking-wide text-slate-500">Your documents</h2>
          {documents.map((doc) => (
            <DocumentCard
              key={doc.id}
              doc={doc}
              dataSource={dataSource}
              uploading={uploading}
              uploadPercent={uploadPercent}
              onUpload={handleUpload}
              onPreview={handlePreview}
              onDownload={handleDownload}
              onPreviewVersion={handlePreviewVersion}
              onDownloadVersion={handleDownloadVersion}
              onRequestUpdate={handleRequestUpdate}
              requestingUpdate={requestingUpdate}
            />
          ))}
        </section>
      ) : null}

      <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-xs text-slate-600">
        <p className="flex items-center gap-2 font-semibold text-slate-700">
          <Camera size={14} /> Mobile uploads
        </p>
        <p className="mt-1">
          Use Upload / Reupload to take a photo or pick a PDF. Maximum file size is 5 MB.
        </p>
      </div>

      {preview ? (
        <PreviewModal doc={preview} url={previewUrl} kind={previewKind} onClose={() => setPreview(null)} />
      ) : null}
    </div>
  );
}
