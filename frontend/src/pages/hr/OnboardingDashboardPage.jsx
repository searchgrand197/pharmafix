import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../../api';
import toast from 'react-hot-toast';
import { ClipboardList, RefreshCw } from 'lucide-react';
import { TableSkeleton } from '../../components/HR/HRSkeleton';

const ACTION_LABELS = {
  activate: { label: 'Activate', className: 'bg-emerald-600 text-white hover:bg-emerald-700' },
  review: { label: 'Review docs', className: 'bg-violet-600 text-white hover:bg-violet-700' },
  reupload: { label: 'View re-upload', className: 'bg-amber-600 text-white hover:bg-amber-700' },
  wait: { label: 'View', className: 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-50' },
  documents: { label: 'Open documents', className: 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-50' },
};

function statusBadge(status) {
  const map = {
    ready_to_join: 'bg-emerald-100 text-emerald-800',
    under_review: 'bg-blue-100 text-blue-800',
    documents_uploaded: 'bg-indigo-100 text-indigo-800',
    pending_documents: 'bg-amber-100 text-amber-900',
    partial_documents: 'bg-orange-100 text-orange-900',
  };
  return map[status] || 'bg-slate-100 text-slate-700';
}

function formatJoiningDate(value) {
  if (!value) return '—';
  return new Date(value).toLocaleDateString();
}

export default function OnboardingDashboardPage() {
  const [loading, setLoading] = useState(true);
  const [summary, setSummary] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get('/hr/onboarding-dashboard/');
      setSummary(data);
    } catch {
      toast.error('Failed to load onboarding summary');
      setSummary(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    document.title = 'Joining & Onboarding | HR';
    load();
  }, [load]);

  const stats = summary?.statistics || {};
  const employees = summary?.employees || [];
  const acceptedAwaiting = summary?.accepted_without_employee || [];

  const statCards = [
    { label: 'In onboarding', value: stats.in_onboarding, hint: 'Employees not yet active' },
    { label: 'Waiting for documents', value: stats.pending_documents, hint: 'Candidate has not uploaded yet' },
    { label: 'Needs HR review', value: stats.awaiting_review, hint: `${stats.documents_to_review ?? 0} file(s) in queue` },
    { label: 'Ready to activate', value: stats.ready_to_join, hint: 'All documents verified' },
  ];

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold text-slate-900">
            <ClipboardList className="text-violet-600" size={24} />
            Joining &amp; onboarding
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            Track new joiners from offer acceptance until they become active employees.
          </p>
        </div>
        <button
          type="button"
          onClick={load}
          className="inline-flex min-h-[44px] items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 shadow-sm hover:bg-slate-50"
        >
          <RefreshCw size={16} />
          Refresh
        </button>
      </div>

      {loading ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-4">
          <TableSkeleton rows={5} cols={4} />
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {statCards.map((card) => (
              <div key={card.label} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                <p className="text-xs font-medium text-slate-500">{card.label}</p>
                <p className="mt-1 text-2xl font-bold text-slate-900">{card.value ?? 0}</p>
                <p className="mt-1 text-xs text-slate-500">{card.hint}</p>
              </div>
            ))}
          </div>

          {acceptedAwaiting.length > 0 && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
              <p className="text-sm font-semibold text-amber-950">
                {acceptedAwaiting.length} accepted offer(s) without an employee profile
              </p>
              <p className="mt-1 text-xs text-amber-900">
                Open the candidate and complete hire setup — they will appear in the table below.
              </p>
              <ul className="mt-3 space-y-2">
                {acceptedAwaiting.map((c) => (
                  <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                    <span className="font-medium text-slate-900">{c.name} — {c.job_title || c.email}</span>
                    <Link
                      to={`/hr/candidates/${c.id}`}
                      state={{ returnTo: '/hr/onboarding' }}
                      className="font-semibold text-violet-700 hover:underline"
                    >
                      Open candidate
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-100 px-4 py-3">
              <h2 className="text-sm font-semibold text-slate-900">Joiners in progress</h2>
              <p className="text-xs text-slate-500">Only employees with status &quot;Pending onboarding&quot;</p>
            </div>

            {employees.length === 0 ? (
              <p className="px-4 py-10 text-center text-sm text-slate-600">
                No one is in onboarding right now. Active staff are in the{' '}
                <Link to="/hr/employees" className="font-semibold text-violet-700 underline">
                  Employee directory
                </Link>
                .
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                    <tr>
                      <th className="px-4 py-3">Employee</th>
                      <th className="px-4 py-3">Status</th>
                      <th className="px-4 py-3">Documents</th>
                      <th className="px-4 py-3">Joining</th>
                      <th className="px-4 py-3">What&apos;s next</th>
                      <th className="px-4 py-3 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {employees.map((row) => {
                      const action = ACTION_LABELS[row.next_action] || ACTION_LABELS.documents;
                      const progressLabel = row.total_required
                        ? `${row.verified_count}/${row.total_required} verified (${Math.round(row.progress_percentage)}%)`
                        : 'No requirements';
                      const nextText = row.next_action === 'activate'
                        ? 'All documents done — activate employee'
                        : row.next_action === 'review'
                          ? `${row.documents_awaiting_review} document(s) waiting for HR review`
                          : row.next_action === 'reupload'
                            ? `${row.reupload_pending} re-upload request(s) open`
                            : row.next_action === 'wait'
                              ? (row.missing_documents?.length
                                ? `Waiting: ${row.missing_documents.slice(0, 3).join(', ')}`
                                : 'Waiting for candidate uploads')
                              : 'Continue document verification';

                      return (
                        <tr key={row.id} className="hover:bg-slate-50/80">
                          <td className="px-4 py-3">
                            <p className="font-semibold text-slate-900">{row.name}</p>
                            <p className="text-xs text-slate-500">{row.job_title || row.department || row.email}</p>
                          </td>
                          <td className="px-4 py-3">
                            <span className={`inline-block rounded-full px-2.5 py-1 text-xs font-semibold ${statusBadge(row.onboarding_status)}`}>
                              {row.onboarding_status_display}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-slate-700">{progressLabel}</td>
                          <td className="px-4 py-3 text-slate-700">{formatJoiningDate(row.joining_date)}</td>
                          <td className="px-4 py-3 text-slate-600">{nextText}</td>
                          <td className="px-4 py-3 text-right">
                            <Link
                              to={`/hr/employees/${row.id}/documents`}
                              className={`inline-flex min-h-[36px] items-center rounded-lg px-3 text-xs font-semibold ${action.className}`}
                            >
                              {action.label}
                            </Link>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
