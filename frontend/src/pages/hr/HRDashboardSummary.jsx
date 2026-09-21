import React from 'react';
import { AlertCircle, CheckCircle2, LayoutDashboard } from 'lucide-react';
import { PRIORITY_LABELS } from './nextActionEngine';

export default function HRDashboardSummary({ summary, loading }) {
  const total = summary?.total ?? 0;
  const critical = summary?.critical ?? 0;
  const allClear = !loading && total === 0;

  return (
    <section className="rounded-2xl border border-violet-200 bg-gradient-to-br from-violet-600 to-indigo-700 p-5 text-white shadow-md">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-violet-200">
            Your complete task list
          </p>
          <h2 className="mt-1 flex items-center gap-2 text-xl font-bold">
            {allClear ? (
              <CheckCircle2 size={22} className="text-emerald-300" />
            ) : (
              <LayoutDashboard size={22} />
            )}
            {allClear ? 'All caught up' : `${loading ? '—' : total} pending task${total === 1 ? '' : 's'}`}
          </h2>
          <p className="mt-1 max-w-xl text-sm text-violet-100">
            {allClear
              ? 'Nothing needs action right now. Check back after new applications, leave requests, or payroll runs.'
              : 'Every open item across recruitment, onboarding, workforce, attendance, and payroll — nothing is hidden.'}
          </p>
        </div>
        {!loading && !allClear && (
          <div className="flex flex-wrap gap-2">
            {critical > 0 && (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-red-500/90 px-3 py-1 text-sm font-bold text-white">
                <AlertCircle size={14} />
                {critical} {PRIORITY_LABELS.critical.toLowerCase()}
              </span>
            )}
            {(summary?.medium ?? 0) > 0 && (
              <span className="rounded-full bg-white/20 px-3 py-1 text-sm font-semibold">
                {summary.medium} {PRIORITY_LABELS.medium.toLowerCase()}
              </span>
            )}
            {(summary?.low ?? 0) > 0 && (
              <span className="rounded-full bg-white/15 px-3 py-1 text-sm font-semibold text-violet-100">
                {summary.low} {PRIORITY_LABELS.low.toLowerCase()}
              </span>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
