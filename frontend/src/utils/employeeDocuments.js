import api from '../api';

export const ONBOARDING_TOKEN_KEY = 'employee_onboarding_token';

export function normalizePortalDocument(row) {
  const workflow =
    row.workflow_status
    || (row.status === 'verified' || row.status === 'physically_verified' ? 'VERIFIED'
      : row.status === 'reupload_requested' || row.status === 'rejected' ? 'REUPLOAD_REQUIRED'
        : row.status === 'uploaded' ? 'UPLOADED' : 'NOT_UPLOADED');

  return {
    id: String(row.id),
    document_label: row.document_label || row.document_type_name || 'Document',
    document_type: row.document_type || row.document_type_name,
    description: row.description || row.document_type_description || '',
    mandatory: row.mandatory ?? row.is_required ?? true,
    status: row.status || 'pending',
    workflow_status: workflow,
    uploaded_at: row.uploaded_at,
    rejection_reason: row.rejection_reason,
    verification_notes: row.verification_notes,
    file_name: row.file_name,
    file_size: row.file_size,
    can_replace: row.can_replace !== false && !row.locked,
    locked: Boolean(row.locked),
    requires_upload: row.requires_upload !== false,
    preview_url: row.preview_url || null,
    download_url: row.download_url || null,
    previous_upload: row.previous_upload || null,
    verified_at: row.verified_at || null,
    workflow_status_label: row.workflow_status_label || null,
    history: buildHistoryFromDoc(row),
  };
}

function buildHistoryFromDoc(doc) {
  const events = [];
  if (doc.previous_upload) {
    events.push({
      id: `prev-${doc.previous_upload.version_id || doc.previous_upload.uploaded_at}`,
      label: 'Previous version',
      at: doc.previous_upload.uploaded_at,
      detail: doc.previous_upload.file_name,
      status: doc.previous_upload.status_at_archive || 'archived',
      version_id: doc.previous_upload.version_id || null,
      preview_url: doc.previous_upload.preview_url || null,
      download_url: doc.previous_upload.download_url || null,
    });
  }
  if (doc.uploaded_at) {
    events.push({
      id: `upload-${doc.uploaded_at}`,
      label: 'Current upload',
      at: doc.uploaded_at,
      detail: doc.file_name,
      status: doc.workflow_status || doc.status,
    });
  }
  if (doc.rejection_reason) {
    events.push({
      id: `reject-${doc.rejection_reason}`,
      label: 'HR remark',
      at: doc.uploaded_at,
      detail: doc.rejection_reason,
      status: 'rejected',
    });
  }
  if (doc.verification_notes && doc.verification_notes !== doc.rejection_reason) {
    events.push({
      id: `note-${doc.verification_notes}`,
      label: 'HR note',
      at: doc.verified_at || doc.uploaded_at,
      detail: doc.verification_notes,
      status: 'note',
    });
  }
  return events;
}

function normalizeOnboardingDocument(row) {
  return normalizePortalDocument(row);
}

async function loadFromOnboardingApi(token) {
  const response = await fetch(`/api/onboarding/get-documents/${token}/`);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const data = await response.json();
  if (!data.success) throw new Error(data.error || 'Invalid onboarding token');
  return {
    documents: (data.documents || []).map(normalizeOnboardingDocument),
    progress: data.progress || null,
    source: 'onboarding',
  };
}

/** Primary: employee-portal session API. Legacy fallback: onboarding token. */
export async function fetchEmployeeDocuments() {
  try {
    const { data } = await api.get('/employee-portal/documents/');
    return {
      documents: (data.documents || []).map(normalizePortalDocument),
      progress: data.progress || null,
      source: 'portal',
      accessBlocked: false,
    };
  } catch (err) {
    if (err?.response?.status !== 403 && err?.response?.status !== 404) {
      throw err;
    }
    const token = localStorage.getItem(ONBOARDING_TOKEN_KEY);
    if (token) {
      const legacy = await loadFromOnboardingApi(token);
      return { ...legacy, accessBlocked: false };
    }
    return {
      documents: [],
      progress: null,
      source: 'none',
      accessBlocked: true,
    };
  }
}

export function documentStats(documents = []) {
  const required = documents.filter((d) => d.mandatory).length;
  const approved = documents.filter((d) => ['verified', 'physically_verified'].includes(d.status)
    || d.workflow_status === 'VERIFIED').length;
  const pending = documents.filter((d) => ['pending', 'uploaded'].includes(d.status)
    || d.workflow_status === 'UPLOADED' || d.workflow_status === 'NOT_UPLOADED').length;
  const reupload = documents.filter((d) => d.status === 'reupload_requested' || d.status === 'rejected'
    || d.workflow_status === 'REUPLOAD_REQUIRED').length;
  return { required, approved, pending, reupload, total: documents.length };
}
