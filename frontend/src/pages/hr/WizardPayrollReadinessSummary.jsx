import React from 'react';
import { Link } from 'react-router-dom';
import { Wallet } from 'lucide-react';

import { withSetupWizardReturn } from './setupWizardUtils';

export default function WizardPayrollReadinessSummary({ summary, loading }) {
  if (loading) {
    return (
      <section className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
        <div className="mb-4 h-6 w-48 animate-pulse rounded bg-gray-100" />
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="h-20 animate-pulse rounded-lg bg-gray-50" />
          <div className="h-20 animate-pulse rounded-lg bg-gray-50" />
        </div>
      </section>
    );
  }

  const {
    readyCount = 0,
    blockedCount = 0,
    blockedEmployees = [],
    totalBlocked = 0,
    topReasons = [],
  } = summary || {};

  return (
    <section className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
      <div className="mb-4">
        <h2 className="flex items-center gap-2 text-lg font-bold text-gray-900">
          <Wallet size={20} className="text-violet-600" />
          Payroll readiness
        </h2>
        <p className="mt-0.5 text-sm text-gray-600">
          Active employees eligible for payroll this month vs those blocked.
        </p>
      </div>

      <div className="mb-4 grid gap-3 sm:grid-cols-2">
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3">
          <div className="text-2xl font-bold tabular-nums text-emerald-900">{readyCount}</div>
          <div className="text-sm font-medium text-emerald-800">Ready employees</div>
        </div>
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
          <div className="text-2xl font-bold tabular-nums text-amber-900">{blockedCount}</div>
          <div className="text-sm font-medium text-amber-900">Blocked employees</div>
        </div>
      </div>

      {topReasons.length > 0 && (
        <div className="mb-4">
          <h3 className="mb-2 text-xs font-bold uppercase tracking-wide text-gray-500">
            Top block reasons
          </h3>
          <ul className="list-disc space-y-1 pl-4 text-sm text-gray-700">
            {topReasons.map(({ reason, count }) => (
              <li key={reason}>
                {reason} ({count})
              </li>
            ))}
          </ul>
        </div>
      )}

      {blockedEmployees.length > 0 && (
        <div>
          <h3 className="mb-2 text-xs font-bold uppercase tracking-wide text-gray-500">
            Blocked employees
          </h3>
          <ul className="divide-y divide-gray-100 rounded-lg border border-gray-100">
            {blockedEmployees.map((emp) => (
              <li key={emp.employeeId} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <div className="font-medium text-gray-900">{emp.employeeCode}</div>
                  <div className="text-sm text-gray-600">{emp.employeeName}</div>
                  <ul className="mt-1 list-disc pl-4 text-xs text-gray-500">
                    {(emp.reasons || []).map((r) => (
                      <li key={r}>{r}</li>
                    ))}
                  </ul>
                </div>
                {emp.actionRoute && (
                  <Link
                    to={withSetupWizardReturn(emp.actionRoute)}
                    className="shrink-0 rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-800"
                  >
                    {emp.actionLabel || 'Fix'}
                  </Link>
                )}
              </li>
            ))}
          </ul>
          {totalBlocked > blockedEmployees.length && (
            <p className="mt-2 text-xs text-gray-500">
              Showing {blockedEmployees.length} of {totalBlocked}.{' '}
              <Link to={withSetupWizardReturn('/hr/employees?filter=payroll_not_eligible')} className="font-semibold text-violet-700 underline">
                View all blocked
              </Link>
            </p>
          )}
        </div>
      )}
    </section>
  );
}
