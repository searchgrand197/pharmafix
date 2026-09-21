import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import {
  Upload, CheckCircle2, AlertCircle, RefreshCw, Download, Eye, X, Shield, Clock,
  AlertTriangle, FileImage, FileType2, MapPin,
} from 'lucide-react';

function isUploadableDocument(doc) {
  return doc.verification_mode === 'upload' || doc.verification_mode === 'hybrid';
}

const WORKFLOW_STYLES = {
  NOT_UPLOADED: { badge: 'bg-slate-100 text-slate-700 border-slate-200', dot: 'bg-slate-400' },
  UPLOADED: { badge: 'bg-sky-50 text-sky-800 border-sky-200', dot: 'bg-sky-500' },
  VERIFIED: { badge: 'bg-emerald-50 text-emerald-800 border-emerald-200', dot: 'bg-emerald-500' },
  REUPLOAD_REQUIRED: { badge: 'bg-amber-50 text-amber-900 border-amber-200', dot: 'bg-amber-500' },
};

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

function IconAction({ title, onClick, disabled, children, className = '' }) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      disabled={disabled}
      onClick={onClick}
      className={`rounded-lg p-2 transition-colors hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-30 ${className}`}
    >
      {children}
    </button>
  );
}

function DocumentPreviewModal({ doc, previewBlobUrl, previewKind, onClose, onDownload }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4" onClick={onClose}>
      <div
        className="flex max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
          <div>
            <h3 className="text-lg font-semibold text-slate-900">{doc.document_label}</h3>
            <p className="text-sm text-slate-500">{doc.file_name}</p>
          </div>
          <div className="flex items-center gap-2">
            {doc.download_url && (
              <IconAction title="Download" onClick={() => onDownload(doc)} className="text-slate-600">
                <Download size={18} />
              </IconAction>
            )}
            <IconAction title="Close" onClick={onClose} className="text-slate-500">
              <X size={20} />
            </IconAction>
          </div>
        </div>
        <div className="flex min-h-[320px] flex-1 items-center justify-center bg-slate-100 p-4">
          {!previewBlobUrl ? (
            <p className="text-sm text-slate-500">Loading preview…</p>
          ) : previewKind === 'pdf' ? (
            <iframe title="Document preview" src={previewBlobUrl} className="h-[70vh] w-full rounded-lg bg-white" />
          ) : previewKind === 'image' ? (
            <img src={previewBlobUrl} alt={doc.document_label} className="max-h-[70vh] max-w-full rounded-lg object-contain" />
          ) : (
            <p className="text-sm text-slate-600">Preview not available. Please download the file.</p>
          )}
        </div>
      </div>
    </div>
  );
}

export default function DocumentUpload() {
  const { token } = useParams();
  const navigate = useNavigate();
  const [candidateData, setCandidateData] = useState(null);
  const [documents, setDocuments] = useState([]);
  const [progress, setProgress] = useState(null);
  const [resubmissionMode, setResubmissionMode] = useState(false);
  const [canSubmit, setCanSubmit] = useState(false);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState({});
  const [uploadPercent, setUploadPercent] = useState({});
  const [loadError, setLoadError] = useState(false);
  const [previewDoc, setPreviewDoc] = useState(null);
  const [previewUrl, setPreviewUrl] = useState('');
  const [previewKind, setPreviewKind] = useState('none');

  const applyOnboardingPayload = (data) => {
    setCandidateData({ name: data.candidate_name, jobTitle: data.job_title });
    setDocuments(data.documents || []);
    setProgress(data.progress || null);
    setResubmissionMode(Boolean(data.resubmission_mode));
    setCanSubmit(Boolean(data.can_submit));
  };

  const loadOnboardingData = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    try {
      const response = await fetch(`/api/onboarding/get-documents/${token}/`);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      if (data.success) applyOnboardingPayload(data);
      else { toast.error('Invalid or expired link'); navigate('/invalid-token'); }
    } catch (e) {
      console.error(e);
      setLoadError(true);
      toast.error('Failed to load verification portal');
    } finally {
      setLoading(false);
    }
  }, [token, navigate]);

  useEffect(() => {
    if (token) {
      localStorage.setItem('employee_onboarding_token', token);
      loadOnboardingData();
    }
  }, [token, loadOnboardingData]);
  useEffect(() => () => { if (previewUrl) URL.revokeObjectURL(previewUrl); }, [previewUrl]);

  const hasPhysicalDocuments = useMemo(
    () => documents.some((d) => d.verification_mode === 'physical'),
    [documents],
  );

  const handleFileSelect = async (doc, file) => {
    const mayReplace = doc.can_replace !== false && !doc.locked;
    if (!file || !mayReplace) return;
    setUploading((p) => ({ ...p, [doc.document_type]: true }));
    setUploadPercent((p) => ({ ...p, [doc.document_type]: 0 }));
    try {
      const formData = new FormData();
      formData.append('token', token);
      formData.append('document_type', doc.document_type);
      formData.append('file', file);
      const xhr = new XMLHttpRequest();
      const result = await new Promise((resolve, reject) => {
        xhr.upload.addEventListener('progress', (ev) => {
          if (ev.lengthComputable) {
            setUploadPercent((p) => ({ ...p, [doc.document_type]: Math.round((ev.loaded / ev.total) * 100) }));
          }
        });
        xhr.addEventListener('load', () => {
          try { resolve(JSON.parse(xhr.responseText)); } catch { reject(new Error('bad response')); }
        });
        xhr.addEventListener('error', () => reject(new Error('network')));
        xhr.open('POST', '/api/onboarding/upload-document/');
        xhr.send(formData);
      });
      if (result.success) {
        applyOnboardingPayload(result);
        toast.success(doc.file_name ? `${doc.document_label} replaced` : `${doc.document_label} uploaded`);
      }
      else toast.error(result.error || 'Upload failed');
    } catch {
      toast.error('Upload failed');
    } finally {
      setUploading((p) => ({ ...p, [doc.document_type]: false }));
      setUploadPercent((p) => ({ ...p, [doc.document_type]: 0 }));
    }
  };

  const openPreview = async (doc, url) => {
    if (!url) return toast.error('No file to preview');
    setPreviewDoc(doc);
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl('');
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error();
      const blob = await res.blob();
      const ext = (doc.file_name || '').split('.').pop()?.toLowerCase();
      setPreviewKind(ext === 'pdf' ? 'pdf' : ['jpg', 'jpeg', 'png', 'webp'].includes(ext) ? 'image' : 'unsupported');
      setPreviewUrl(URL.createObjectURL(blob));
    } catch {
      toast.error('Preview failed');
      setPreviewDoc(null);
    }
  };

  const downloadFile = async (doc, url) => {
    if (!url) return;
    try {
      const res = await fetch(url);
      const blob = await res.blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = doc.file_name || 'document';
      a.click();
      URL.revokeObjectURL(a.href);
    } catch { toast.error('Download failed'); }
  };

  const completeOnboarding = async () => {
    if (!canSubmit) return toast.error('Complete required uploads first');
    try {
      const res = await fetch('/api/onboarding/complete/', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token }),
      });
      const data = await res.json();
      if (data.success) { toast.success('Submitted for HR verification'); navigate('/onboarding/success'); }
      else toast.error(data.error || 'Failed');
    } catch { toast.error('Submission failed'); }
  };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-100">
        <div className="text-center">
          <RefreshCw className="mx-auto mb-3 h-8 w-8 animate-spin text-slate-600" />
          <p className="text-sm font-medium text-slate-700">Loading document verification portal…</p>
        </div>
      </div>
    );
  }

  if (loadError || !candidateData) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-100 p-4">
        <div className="max-w-md rounded-xl border border-slate-200 bg-white p-8 text-center shadow-lg">
          <AlertTriangle className="mx-auto mb-4 h-12 w-12 text-amber-500" />
          <h2 className="text-xl font-semibold text-slate-900">Unable to load portal</h2>
          <button type="button" onClick={loadOnboardingData} className="mt-6 rounded-lg bg-slate-800 px-5 py-2.5 text-sm font-medium text-white">Retry</button>
        </div>
      </div>
    );
  }

  const progressPercent = progress?.percent ?? 0;

  return (
    <div className="min-h-screen bg-slate-100">
      <header className="border-b border-slate-200 bg-white shadow-sm">
        <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex gap-4">
              <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-slate-800 text-white"><Shield size={24} /></div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Employee document verification</p>
                <h1 className="mt-0.5 text-xl font-bold text-slate-900 sm:text-2xl">{candidateData.name}</h1>
                <p className="text-sm text-slate-600">{candidateData.jobTitle}</p>
              </div>
            </div>
          </div>
          <div className="mt-6">
            <div className="mb-2 flex justify-between text-sm">
              <span className="font-medium text-slate-700">{progress?.label}</span>
              <span className="font-semibold">{progressPercent}%</span>
            </div>
            <div className="h-2.5 overflow-hidden rounded-full bg-slate-200">
              <div className="h-full rounded-full bg-slate-800 transition-all" style={{ width: `${progressPercent}%` }} />
            </div>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
        <div className="mb-6 rounded-lg border border-slate-200 bg-slate-50 p-4 text-slate-700">
          <p className="text-sm">
            <span className="font-semibold text-slate-900">Wrong file uploaded?</span>
            {' '}Use the eye icon to preview, then the refresh arrow to upload the correct file before HR verifies it.
          </p>
        </div>

        {resubmissionMode && (
          <div className="mb-6 flex gap-3 rounded-lg border border-amber-200 bg-amber-50 p-4 text-amber-950">
            <AlertCircle className="h-5 w-5 shrink-0" />
            <div>
              <p className="font-semibold">Re-upload required</p>
              <p className="mt-1 text-sm">HR requested updated documents. Read each note and use the refresh arrow to upload a new file.</p>
            </div>
          </div>
        )}

        {hasPhysicalDocuments && (
          <div className="mb-6 flex gap-3 rounded-lg border border-violet-200 bg-violet-50 p-4 text-violet-950">
            <MapPin className="h-5 w-5 shrink-0" />
            <div>
              <p className="font-semibold">In-person verification required</p>
              <p className="mt-1 text-sm">
                Some documents on this checklist must be verified in person at HR and do not require an online upload.
              </p>
            </div>
          </div>
        )}

        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="hidden border-b border-slate-200 bg-slate-50 px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-slate-500 md:grid md:grid-cols-12 md:items-center md:gap-2">
            <div className="md:col-span-3">Document</div>
            <div className="md:col-span-2">Requirement</div>
            <div className="md:col-span-2">Status</div>
            <div className="md:col-span-3">File</div>
            <div className="md:col-span-2 text-right">Actions</div>
          </div>
          <ul className="divide-y divide-slate-100">
            {documents.map((doc) => {
              const wf = WORKFLOW_STYLES[doc.workflow_status] || WORKFLOW_STYLES.NOT_UPLOADED;
              const isPhysicalOnly = doc.verification_mode === 'physical';

              if (isPhysicalOnly) {
                const physicalStatusLabel = doc.workflow_status === 'VERIFIED'
                  ? 'Verified at HR'
                  : doc.physical_verification_pending !== false
                    ? 'Bring to HR office'
                    : doc.workflow_status_label;

                return (
                  <li key={doc.id} className="px-4 py-5 bg-violet-50/30">
                    <div className="grid gap-4 md:grid-cols-12 md:items-start">
                      <div className="md:col-span-3 flex gap-3">
                        <div className="rounded-lg bg-violet-100 p-2 text-violet-700"><MapPin size={20} /></div>
                        <div>
                          <p className="font-semibold text-slate-900">{doc.document_label}</p>
                          {doc.description && <p className="text-xs text-slate-500">{doc.description}</p>}
                          <p className="mt-1 text-xs text-violet-800">Physical verification — bring this document to HR</p>
                        </div>
                      </div>
                      <div className="md:col-span-2">
                        <span className={`inline-flex rounded-md border px-2 py-0.5 text-xs font-medium ${doc.mandatory ? 'border-rose-200 bg-rose-50 text-rose-800' : 'border-slate-200 bg-slate-50 text-slate-600'}`}>
                          {doc.mandatory ? 'Required' : 'Optional'}
                        </span>
                      </div>
                      <div className="md:col-span-2">
                        <span className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium ${wf.badge}`}>
                          <span className={`h-1.5 w-1.5 rounded-full ${wf.dot}`} />{physicalStatusLabel}
                        </span>
                      </div>
                      <div className="md:col-span-5 text-sm text-slate-600">
                        <p className="text-slate-500">No online upload required. HR will verify this document in person.</p>
                        {doc.verification_notes && (
                          <p className="mt-2 text-xs text-slate-600">{doc.verification_notes}</p>
                        )}
                      </div>
                    </div>
                  </li>
                );
              }

              const busy = uploading[doc.document_type];
              const pct = uploadPercent[doc.document_type] || 0;
              const canReplace = (doc.can_replace !== false) && !doc.locked;
              const showFile = doc.file_name && doc.workflow_status !== 'NOT_UPLOADED';

              return (
                <li key={doc.id} className="px-4 py-5">
                  <div className="grid gap-4 md:grid-cols-12 md:items-start">
                    <div className="md:col-span-3 flex gap-3">
                      <div className="rounded-lg bg-slate-100 p-2 text-slate-600">{doc.previewable ? <FileImage size={20}/> : <FileType2 size={20}/>}</div>
                      <div>
                        <p className="font-semibold text-slate-900">{doc.document_label}</p>
                        {doc.description && <p className="text-xs text-slate-500">{doc.description}</p>}
                      </div>
                    </div>
                    <div className="md:col-span-2">
                      <span className={`inline-flex rounded-md border px-2 py-0.5 text-xs font-medium ${doc.mandatory ? 'border-rose-200 bg-rose-50 text-rose-800' : 'border-slate-200 bg-slate-50 text-slate-600'}`}>
                        {doc.mandatory ? 'Required' : 'Optional'}
                      </span>
                    </div>
                    <div className="md:col-span-2">
                      <span className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium ${wf.badge}`}>
                        <span className={`h-1.5 w-1.5 rounded-full ${wf.dot}`} />{doc.workflow_status_label}
                      </span>
                    </div>
                    <div className="md:col-span-3 text-sm text-slate-600">
                      {showFile ? (
                        <>
                          <p className="font-medium text-slate-800 truncate">{doc.file_name}</p>
                          <p className="mt-1 flex items-center gap-1 text-xs text-slate-500"><Clock size={12}/>{formatDateTime(doc.uploaded_at)}</p>
                          {doc.file_size ? <p className="text-xs text-slate-400">{formatBytes(doc.file_size)}</p> : null}
                        </>
                      ) : <p className="text-slate-400">No file uploaded</p>}
                      {doc.rejection_reason && doc.workflow_status === 'REUPLOAD_REQUIRED' && (
                        <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 p-2.5 text-xs text-amber-950">
                          <p className="font-semibold">HR rejection note</p><p className="mt-1">{doc.rejection_reason}</p>
                        </div>
                      )}
                      {doc.previous_upload && (
                        <div className="mt-3 rounded-md border border-slate-200 bg-slate-50 p-2.5 text-xs">
                          <p className="font-semibold text-slate-700">Previous submission</p>
                          <p className="text-slate-600">{doc.previous_upload.file_name}</p>
                          {doc.previous_upload.preview_url && (
                            <div className="mt-2 flex items-center gap-2">
                              <span className="text-slate-500">Previous file</span>
                              <IconAction
                                title="Preview previous submission"
                                onClick={() => openPreview(
                                  { ...doc, file_name: doc.previous_upload.file_name },
                                  doc.previous_upload.preview_url,
                                )}
                                className="text-slate-600"
                              >
                                <Eye size={16} />
                              </IconAction>
                            </div>
                          )}
                        </div>
                      )}
                      {busy && (
                        <div className="mt-3">
                          <div className="h-1.5 rounded-full bg-slate-200"><div className="h-full bg-slate-700 transition-all" style={{ width: `${pct}%` }}/></div>
                          <p className="mt-1 text-xs text-slate-500">Uploading… {pct}%</p>
                        </div>
                      )}
                    </div>
                    <div className="flex items-center justify-end gap-1 md:col-span-2">
                      {doc.preview_url && showFile && (
                        <>
                          <IconAction
                            title="Preview"
                            onClick={() => openPreview(doc, doc.preview_url)}
                            className="text-slate-600"
                          >
                            <Eye size={18} />
                          </IconAction>
                          <IconAction
                            title="Download"
                            onClick={() => downloadFile(doc, doc.download_url)}
                            className="text-slate-600"
                          >
                            <Download size={18} />
                          </IconAction>
                        </>
                      )}
                      {canReplace && isUploadableDocument(doc) && (
                        <label
                          title={doc.file_name ? 'Replace document' : 'Upload document'}
                          className={`inline-flex cursor-pointer rounded-lg p-2 hover:bg-slate-100 ${busy ? 'pointer-events-none opacity-30' : ''}`}
                        >
                          {busy ? (
                            <RefreshCw size={18} className="animate-spin text-slate-600" />
                          ) : doc.file_name ? (
                            <RefreshCw size={18} className="text-slate-700" />
                          ) : (
                            <Upload size={18} className="text-slate-700" />
                          )}
                          <input
                            type="file"
                            className="hidden"
                            accept=".pdf,.jpg,.jpeg,.png"
                            disabled={busy}
                            onChange={(e) => {
                              const f = e.target.files?.[0];
                              if (f) handleFileSelect(doc, f);
                              e.target.value = '';
                            }}
                          />
                        </label>
                      )}
                      {doc.workflow_status === 'VERIFIED' && (
                        <span className="rounded-lg p-2 text-emerald-600" title="Verified">
                          <CheckCircle2 size={18} />
                        </span>
                      )}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>

        <section className="mt-8 rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-slate-900">Submit for verification</h2>
          <p className="mt-1 text-sm text-slate-600">All required documents must be uploaded before HR review.</p>
          <button type="button" onClick={completeOnboarding} disabled={!canSubmit} className={`mt-5 rounded-lg px-6 py-3.5 text-sm font-semibold text-white ${canSubmit ? 'bg-slate-800 hover:bg-slate-900' : 'cursor-not-allowed bg-slate-300'}`}>
            {canSubmit ? (resubmissionMode ? 'Submit updated documents' : 'Submit for HR verification') : `Complete required uploads (${progress?.required_completed ?? 0}/${progress?.required_total ?? 0})`}
          </button>
        </section>
      </main>

      {previewDoc && (
        <DocumentPreviewModal doc={previewDoc} previewBlobUrl={previewUrl} previewKind={previewKind}
          onClose={() => { setPreviewDoc(null); if (previewUrl) URL.revokeObjectURL(previewUrl); setPreviewUrl(''); }}
          onDownload={downloadFile} />
      )}
    </div>
  );
}
