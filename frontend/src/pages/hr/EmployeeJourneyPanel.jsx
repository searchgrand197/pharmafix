import React from 'react';
import { Link } from 'react-router-dom';

const STATUS_BADGES = {
  complete: { label: 'Complete', className: 'bg-emerald-100 text-emerald-800' },
  ready: { label: 'Ready', className: 'bg-emerald-100 text-emerald-800' },
  in_progress: { label: 'In progress', className: 'bg-slate-100 text-slate-700' },
  incomplete: { label: 'Incomplete', className: 'bg-amber-100 text-amber-900' },
};

function stepBadge(status) {
  return STATUS_BADGES[status] || STATUS_BADGES.incomplete;
}

function isActionableIncomplete(step) {
  return step.status === 'incomplete';
}

function isEmployeeScopedRoute(route, employeeId) {
  if (!employeeId || !route) return false;
  return String(route).startsWith(`/hr/employees/${employeeId}`);
}

export default function EmployeeJourneyPanel({ steps, onAssignShift, employeeId }) {
  if (!steps?.length) return null;

  return (
    <section className="rounded-lg border border-slate-200 bg-white px-4 py-3">
      <h2 className="text-sm font-bold text-slate-900">Employee journey</h2>
      <p className="mt-0.5 text-xs text-slate-500">
        Setup checklist — payroll and attendance accrue through the month.
      </p>
      <ul className="mt-3 space-y-2">
        {steps.map((step) => {
          const badge = stepBadge(step.status);

          const content = (
            <>
              <div>
                <span className="font-medium text-slate-900">{step.label}</span>
                <p className="text-xs text-slate-500">{step.hint}</p>
              </div>
              <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${badge.className}`}>
                {badge.label}
              </span>
            </>
          );

          if (step.key === 'shift' && isActionableIncomplete(step) && onAssignShift) {
            return (
              <li key={step.key}>
                <button
                  type="button"
                  onClick={onAssignShift}
                  className="flex w-full items-center justify-between gap-3 rounded-lg border border-slate-100 px-3 py-2 text-left hover:bg-slate-50"
                >
                  {content}
                </button>
              </li>
            );
          }

          const linkState = employeeId && !isEmployeeScopedRoute(step.route, employeeId)
            ? { fromEmployeeId: employeeId }
            : undefined;

          return (
            <li key={step.key}>
              <Link
                to={step.route}
                state={linkState}
                className="flex items-center justify-between gap-3 rounded-lg border border-slate-100 px-3 py-2 hover:bg-slate-50"
              >
                {content}
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
