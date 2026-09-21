import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import api from '../../api';
import {
  ChevronRight,
  ClipboardList,
  ExternalLink,
  FileUp,
  RefreshCw,
  Search,
  Upload,
} from 'lucide-react';
import { TableSkeleton } from '../../components/HR/HRSkeleton';
import JourneyJobFilter from './JourneyJobFilter';
import {
  employeeWaitingForDocuments,
  formatOnboardingJoiningDate,
  onboardingStatusBadgeClass,
  useOnboardingSummary,
} from './onboardingShared';

function missingCount(row) {
  return (row.missing_documents || []).length;
}

export default function OnboardingPendingDocumentsPage() {
  const [searchParams] = useSearchParams();
  const [jobOpening, setJobOpening] = useState(() => searchParams.get('job_opening') || '');
  const { loading, stats, employees, acceptedAwaiting, reload } = useOnboardingSummary({ jobOpening });
  const [selectedId, setSelectedId] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [detailLoading, setDetailLoading] = useState(false);
  const [detail, setDetail] = useState(null);

  useEffect(() => {
    document.title = 'Pending Documents | HR';
  }, []);

  const waitingEmployees = useMemo(
    () => employees.filter(employeeWaitingForDocuments),
    [employees],
  );

  const partialCount = useMemo(
    () => employees.filter((row) => row.onboarding_status === 'partial_documents').length,
    [employees],
  );

  const totalMissingItems = useMemo(
    () => waitingEmployees.reduce((sum, row) => sum + missingCount(row), 0),
    [waitingEmployees],
  );

  const joinerList = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    return waitingEmployees
      .map((emp) => ({
        ...emp,
        missingCount: missingCount(emp),
      }))
      .filter((emp) => {
        if (!q) return true;
        return (
          (emp.name && emp.name.toLowerCase().includes(q))
          || (emp.email && emp.email.toLowerCase().includes(q))
          || (emp.job_title && emp.job_title.toLowerCase().includes(q))
        );
      })
      .sort((a, b) => {
        if (b.missingCount !== a.missingCount) return b.missingCount - a.missingCount;
        return (a.name || '').localeCompare(b.name || '');
      });
  }, [waitingEmployees, searchTerm]);

  const loadDetail = useCallback(async (employeeId) => {
    if (!employeeId) return;
    setDetailLoading(true);
    try {
      const { data } = await api.get(`/hr/employees/${employeeId}/documents/`);
      setDetail(data);
    } catch {
      toast.error('Failed to load document checklist');
      setDetail(null);
    } finally {
      setDetailLoading(false);
    }
  }, []);

  useEffect(() => {
    if (loading || selectedId) return;
    if (joinerList[0]) setSelectedId(joinerList[0].id);
  }, [loading, joinerList, selectedId]);

  useEffect(() => {
    if (selectedId) loadDetail(selectedId);
    else setDetail(null);
  }, [selectedId, loadDetail]);

  const selectedRow = useMemo(
    () => joinerList.find((row) => String(row.id) === String(selectedId)),
    [joinerList, selectedId],
  );

  const pendingDocs = useMemo(
    () => (detail?.documents || []).filter((d) => d.status === 'missing' || d.status === 'pending'),
    [detail],
  );

  const reuploadDocs = useMemo(
    () => (detail?.documents || []).filter((d) => d.status === 'reupload_requested'),
    [detail],
  );

  const uploadedAwaitingReview = useMemo(
    () => (detail?.documents || []).filter((d) => d.status === 'uploaded').length,
    [detail],
  );

  const progressPct = detail?.progress?.progress_percentage ?? 0;

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold text-slate-900">
            <ClipboardList className="text-amber-600" size={24} />
            Pending documents
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            Track joiners who still need to upload required onboarding documents.
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <JourneyJobFilter value={jobOpening} onChange={setJobOpening} />
          <button
            type="button"
            onClick={reload}
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
              {
                label: 'Awaiting uploads',
                value: waitingEmployees.length,
                tone: 'text-amber-800 bg-amber-50 border-amber-100',
              },
              {
                label: 'Not started',
                value: stats.pending_documents ?? 0,
                tone: 'text-slate-700 bg-slate-50 border-slate-200',
              },
              {
                label: 'Documents missing',
                value: totalMissingItems,
                tone: 'text-orange-800 bg-orange-50 border-orange-100',
              },
            ].map((card) => (
              <div key={card.label} className={`rounded-xl border p-4 ${card.tone}`}>
                <p className="text-xs font-medium opacity-80">{card.label}</p>
                <p className="mt-1 text-2xl font-bold">{card.value}</p>
                {card.label === 'Not started' && partialCount > 0 ? (
                  <p className="mt-1 text-xs opacity-70">{partialCount} partially uploaded</p>
                ) : null}
              </div>
            ))}
          </div>

          {acceptedAwaiting.length > 0 && (
            <div className="rounded-2xl border border-violet-200 bg-violet-50 p-4 shadow-sm">
              <p className="text-sm font-semibold text-violet-950">
                {acceptedAwaiting.length} accepted offer{acceptedAwaiting.length === 1 ? '' : 's'} — employee not created yet
              </p>
              <p className="mt-1 text-xs text-violet-900">
                Complete hire setup on the candidate before document collection can start.
              </p>
              <ul className="mt-3 space-y-2">
                {acceptedAwaiting.map((c) => (
                  <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-violet-100 bg-white px-3 py-2 text-sm">
                    <span className="font-medium text-slate-900">
                      {c.name} — {c.job_title || c.email}
                    </span>
                    <Link
                      to={`/hr/candidates/${c.id}`}
                      state={{ returnTo: '/hr/onboarding/pending-documents' }}
                      className="font-semibold text-violet-700 hover:underline"
                    >
                      Set up hire
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {waitingEmployees.length === 0 ? (
            <div className="rounded-2xl border border-slate-200 bg-white px-6 py-16 text-center shadow-sm">
              <Upload className="mx-auto h-10 w-10 text-slate-300" />
              <p className="mt-3 font-medium text-slate-800">No pending document uploads</p>
              <p className="mt-1 text-sm text-slate-500">
                When joiners upload files, review them on{' '}
                <Link
                  to="/hr/onboarding/document-verification"
                  className="font-semibold text-violet-700 hover:underline"
                >
                  Document verification
                </Link>
                .
              </p>
            </div>
          ) : (
            <div className="grid gap-4 lg:grid-cols-[300px_minmax(0,1fr)]">
              <aside className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
                <div className="border-b border-slate-100 p-4">
                  <p className="text-sm font-semibold text-slate-900">
                    Joiners waiting ({waitingEmployees.length})
                  </p>
                  <div className="relative mt-3">
                    <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
                    <input
                      className="w-full rounded-xl border border-slate-200 py-2 pl-9 pr-3 text-sm outline-none focus:border-amber-400 focus:ring-2 focus:ring-amber-100"
                      placeholder="Search name or role"
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                    />
                  </div>
                </div>
                <div className="max-h-[520px] divide-y divide-slate-100 overflow-y-auto">
                  {joinerList.length === 0 ? (
                    <p className="px-4 py-10 text-center text-sm text-slate-500">No matches.</p>
                  ) : (
                    joinerList.map((emp) => {
                      const active = String(selectedId) === String(emp.id);
                      return (
                        <button
                          key={emp.id}
                          type="button"
                          onClick={() => setSelectedId(emp.id)}
                          className={`flex w-full items-center gap-3 px-4 py-3 text-left transition hover:bg-slate-50 ${
                            active ? 'bg-amber-50' : ''
                          }`}
                        >
                          <div className="min-w-0 flex-1">
                            <p className="truncate font-semibold text-slate-900">{emp.name}</p>
                            <p className="truncate text-xs text-slate-500">{emp.job_title || '—'}</p>
                          </div>
                          {emp.missingCount > 0 ? (
                            <span className="shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-bold text-amber-900">
                              {emp.missingCount}
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
                    <FileUp className="h-10 w-10 text-slate-300" />
                    <p className="font-medium text-slate-800">Select a joiner to view missing documents</p>
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
                        {selectedRow ? (
                          <span
                            className={`mt-2 inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${onboardingStatusBadgeClass(selectedRow.onboarding_status)}`}
                          >
                            {selectedRow.onboarding_status_display}
                          </span>
                        ) : null}
                        <div className="mt-3">
                          <div className="flex items-center justify-between text-xs text-slate-500">
                            <span>
                              {detail.progress?.verified_count ?? 0} of {detail.progress?.total_required ?? 0} uploaded &amp; verified
                            </span>
                            <span>{Math.round(progressPct)}%</span>
                          </div>
                          <div className="mt-1 h-2 overflow-hidden rounded-full bg-slate-100">
                            <div
                              className="h-full rounded-full bg-amber-500 transition-all"
                              style={{ width: `${Math.min(100, progressPct)}%` }}
                            />
                          </div>
                        </div>
                        {detail.employee?.joining_date || selectedRow?.joining_date ? (
                          <p className="mt-2 text-xs text-slate-500">
                            Joining: {formatOnboardingJoiningDate(detail.employee?.joining_date || selectedRow?.joining_date)}
                          </p>
                        ) : null}
                      </div>
                      <Link
                        to={`/hr/employees/${selectedId}/documents`}
                        state={{ returnTo: '/hr/onboarding/pending-documents' }}
                        className="inline-flex shrink-0 items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-violet-700 hover:bg-slate-50"
                      >
                        <ExternalLink size={16} />
                        Open checklist
                      </Link>
                    </div>

                    {uploadedAwaitingReview > 0 && (
                      <div className="mt-4 rounded-xl border border-violet-100 bg-violet-50 px-4 py-3 text-sm text-violet-900">
                        {uploadedAwaitingReview} document{uploadedAwaitingReview === 1 ? '' : 's'} uploaded and waiting for HR review.{' '}
                        <Link
                          to="/hr/onboarding/document-verification"
                          className="font-semibold underline hover:text-violet-700"
                        >
                          Go to verification
                        </Link>
                      </div>
                    )}

                    {pendingDocs.length === 0 && reuploadDocs.length === 0 ? (
                      <div className="py-16 text-center">
                        <p className="font-medium text-slate-800">No outstanding uploads for this joiner</p>
                        <p className="mt-1 text-sm text-slate-500">
                          They may have finished uploading — check verification or the full checklist.
                        </p>
                      </div>
                    ) : (
                      <div className="mt-4 space-y-6">
                        {pendingDocs.length > 0 && (
                          <section>
                            <h3 className="mb-3 text-sm font-semibold text-slate-900">
                              Still needed ({pendingDocs.length})
                            </h3>
                            <ul className="space-y-2">
                              {pendingDocs.map((doc) => (
                                <li
                                  key={doc.id || doc.document_type}
                                  className="flex items-center justify-between rounded-xl border border-amber-100 bg-amber-50/50 px-4 py-3"
                                >
                                  <div>
                                    <p className="font-medium text-slate-900">{doc.document_label}</p>
                                    {doc.mandatory ? (
                                      <p className="text-xs text-amber-800">Required</p>
                                    ) : (
                                      <p className="text-xs text-slate-500">Optional</p>
                                    )}
                                  </div>
                                  <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-900">
                                    Not uploaded
                                  </span>
                                </li>
                              ))}
                            </ul>
                          </section>
                        )}

                        {reuploadDocs.length > 0 && (
                          <section>
                            <h3 className="mb-3 text-sm font-semibold text-slate-900">
                              Re-upload requested ({reuploadDocs.length})
                            </h3>
                            <ul className="space-y-2">
                              {reuploadDocs.map((doc) => (
                                <li
                                  key={doc.id}
                                  className="rounded-xl border border-orange-100 bg-orange-50/40 px-4 py-3"
                                >
                                  <div className="flex items-start justify-between gap-3">
                                    <div>
                                      <p className="font-medium text-slate-900">{doc.document_label}</p>
                                      {doc.rejection_reason || doc.verification_notes ? (
                                        <p className="mt-1 text-xs text-orange-900">
                                          {doc.rejection_reason || doc.verification_notes}
                                        </p>
                                      ) : (
                                        <p className="mt-1 text-xs text-orange-800">Waiting for joiner to upload again</p>
                                      )}
                                    </div>
                                    <span className="shrink-0 rounded-full bg-orange-100 px-2 py-0.5 text-xs font-semibold text-orange-900">
                                      Re-upload
                                    </span>
                                  </div>
                                </li>
                              ))}
                            </ul>
                          </section>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </main>
            </div>
          )}
        </>
      )}
    </div>
  );
}
