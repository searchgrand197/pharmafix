import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { exitReasonLabel } from '../employeeExitUtils';

export function SummaryChip({ label, value, warn }) {
  return (
    <div className="min-w-0 rounded-lg border border-slate-200 bg-white px-3 py-2">
      <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">{label}</p>
      <p className={`mt-0.5 truncate text-sm font-semibold ${warn ? 'text-amber-800' : 'text-slate-900'}`}>
        {value || '—'}
      </p>
    </div>
  );
}

export function TabButton({ id, label, active, onClick }) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={() => onClick(id)}
      className={`shrink-0 rounded-lg px-3 py-2 text-sm font-semibold transition-colors ${
        active
          ? 'bg-white text-violet-800 shadow-sm'
          : 'text-slate-600 hover:text-slate-900'
      }`}
    >
      {label}
    </button>
  );
}

export function DetailRow({ label, value }) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-slate-100 py-2.5 last:border-0">
      <span className="text-sm text-slate-500">{label}</span>
      <span className="text-right text-sm font-medium text-slate-900">{value ?? '—'}</span>
    </div>
  );
}

export function LifecycleHistoryList({ statusHistory, formatDate, formatDateTime }) {
  if (!statusHistory?.length) {
    return <p className="text-sm text-slate-500">No lifecycle events yet.</p>;
  }
  return (
    <div className="space-y-3">
      {statusHistory.map((entry) => (
        <div key={entry.id} className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-2.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="text-sm font-semibold text-slate-900">
                {entry.event_type_display || entry.event_type}
                {' · '}
                {entry.previous_status_display || entry.previous_status || '—'}
                {' → '}
                {entry.new_status_display || entry.new_status || '—'}
              </p>
              <p className="text-xs text-slate-500">
                {formatDateTime(entry.changed_at)} by {entry.changed_by_name || 'System'}
              </p>
            </div>
            {entry.exit_reason && (
              <span className="rounded-full bg-white px-2 py-0.5 text-xs font-medium text-slate-700">
                {entry.exit_reason_display || exitReasonLabel(entry.exit_reason)}
              </span>
            )}
          </div>
          <div className="mt-2 grid gap-1 text-xs text-slate-600 sm:grid-cols-2">
            <span>Relieving date: {formatDate(entry.relieving_date)}</span>
            <span>Eligible for rehire: {entry.eligible_for_rehire ? 'Yes' : 'No'}</span>
          </div>
          {entry.notes && (
            <p className="mt-2 text-sm text-slate-700">{entry.notes}</p>
          )}
        </div>
      ))}
    </div>
  );
}

export function ExternalLink({ to, children, state }) {
  return (
    <Link to={to} state={state} className="text-sm font-semibold text-violet-700 hover:underline">
      {children}
    </Link>
  );
}

/** Shows when navigated from an employee profile via location.state.fromEmployeeId. */
export function BackToEmployeeLink() {
  const location = useLocation();
  const employeeId = location.state?.fromEmployeeId;
  if (!employeeId) return null;

  return (
    <Link
      to={`/hr/employees/${employeeId}`}
      className="mb-2 inline-flex items-center gap-1 text-sm font-semibold text-indigo-700 hover:underline"
    >
      <ArrowLeft className="h-4 w-4" /> Back to employee
    </Link>
  );
}
