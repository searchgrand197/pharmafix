import { useCallback, useEffect, useState } from 'react';
import api from '../../api';
import toast from 'react-hot-toast';
import { normalizeApiList } from '../../hr/recruitmentLifecycle';
import { isDocumentExpiringSoon } from './healthFilterUtils';

export const ONBOARDING_ACTION_LABELS = {
  activate: { label: 'Activate', className: 'bg-emerald-600 text-white hover:bg-emerald-700' },
  review: { label: 'Review docs', className: 'bg-violet-600 text-white hover:bg-violet-700' },
  reupload: { label: 'View re-upload', className: 'bg-amber-600 text-white hover:bg-amber-700' },
  wait: { label: 'View checklist', className: 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-50' },
  documents: { label: 'Open documents', className: 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-50' },
};

export function onboardingStatusBadgeClass(status) {
  const map = {
    ready_to_join: 'bg-emerald-100 text-emerald-800',
    under_review: 'bg-blue-100 text-blue-800',
    documents_uploaded: 'bg-indigo-100 text-indigo-800',
    pending_documents: 'bg-amber-100 text-amber-900',
    partial_documents: 'bg-orange-100 text-orange-900',
  };
  return map[status] || 'bg-slate-100 text-slate-700';
}

export function formatOnboardingJoiningDate(value) {
  if (!value) return '—';
  return new Date(value).toLocaleDateString();
}

export function employeeNeedsDocumentReview(row) {
  return (row.documents_awaiting_review || 0) > 0 || (row.reupload_pending || 0) > 0;
}

export function employeeReadyToActivate(row) {
  return row.next_action === 'activate' || row.onboarding_status === 'ready_to_join';
}

export function employeeWaitingForDocuments(row) {
  return (
    row.next_action === 'wait'
    || row.onboarding_status === 'pending_documents'
    || row.onboarding_status === 'partial_documents'
  );
}

export function onboardingNextStepText(row) {
  if (row.next_action === 'activate') return 'All documents done — activate employee';
  if (row.next_action === 'review') {
    return `${row.documents_awaiting_review} document(s) waiting for HR review`;
  }
  if (row.next_action === 'reupload') {
    return `${row.reupload_pending} re-upload request(s) open`;
  }
  if (row.next_action === 'wait') {
    return row.missing_documents?.length
      ? `Waiting: ${row.missing_documents.slice(0, 3).join(', ')}`
      : 'Waiting for candidate uploads';
  }
  return 'Continue document verification';
}

export function useOnboardingSummary({ includeExpiringDocs = false, jobOpening = '' } = {}) {
  const [loading, setLoading] = useState(true);
  const [summary, setSummary] = useState(null);
  const [expiringEmployeeIds, setExpiringEmployeeIds] = useState(new Set());

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const dashboardParams = jobOpening ? { job_opening: jobOpening } : {};
      const requests = [api.get('/hr/onboarding-dashboard/', { params: dashboardParams }).then((r) => r.data)];
      if (includeExpiringDocs) {
        requests.push(api.get('/hr/documents/', { params: { limit: 1000 } }).then((r) => r.data));
      }
      const settled = await Promise.allSettled(requests);
      if (settled[0].status === 'fulfilled') {
        setSummary(settled[0].value);
      } else {
        setSummary(null);
        toast.error('Failed to load onboarding summary');
      }
      if (includeExpiringDocs) {
        if (settled[1]?.status === 'fulfilled') {
          const docs = normalizeApiList(settled[1].value);
          const ids = new Set(
            docs
              .filter((doc) => isDocumentExpiringSoon(doc.expires_at))
              .map((doc) => String(doc.employee))
              .filter(Boolean),
          );
          setExpiringEmployeeIds(ids);
        } else {
          setExpiringEmployeeIds(new Set());
        }
      } else {
        setExpiringEmployeeIds(new Set());
      }
    } catch {
      toast.error('Failed to load onboarding summary');
      setSummary(null);
      setExpiringEmployeeIds(new Set());
    } finally {
      setLoading(false);
    }
  }, [includeExpiringDocs, jobOpening]);

  useEffect(() => {
    load();
  }, [load]);

  return {
    loading,
    summary,
    stats: summary?.statistics || {},
    employees: summary?.employees || [],
    acceptedAwaiting: summary?.accepted_without_employee || [],
    expiringEmployeeIds,
    reload: load,
  };
}
