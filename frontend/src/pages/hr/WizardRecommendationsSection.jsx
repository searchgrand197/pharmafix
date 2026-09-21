import React from 'react';
import { Link } from 'react-router-dom';
import { Lightbulb } from 'lucide-react';

import { withSetupWizardReturn } from './setupWizardUtils';

const PRIORITY_STYLES = {
  critical: 'border-red-200 bg-red-50',
  medium: 'border-amber-200 bg-amber-50',
  low: 'border-slate-200 bg-slate-50',
};

export default function WizardRecommendationsSection({ recommendations, loading }) {
  if (loading) {
    return (
      <section className="rounded-2xl border border-gray-100 bg-gray-50/80 p-5">
        <div className="mb-4 h-6 w-48 animate-pulse rounded bg-gray-100" />
        <div className="space-y-2">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-14 animate-pulse rounded-lg bg-white" />
          ))}
        </div>
      </section>
    );
  }

  const items = recommendations || [];

  return (
    <section className="rounded-2xl border border-gray-100 bg-gray-50/80 p-5">
      <div className="mb-4">
        <h2 className="flex items-center gap-2 text-lg font-bold text-gray-900">
          <Lightbulb size={20} className="text-amber-500" />
          Smart recommendations
        </h2>
        <p className="mt-0.5 text-sm text-gray-600">
          Top actions based on current system health — resolve blockers before running payroll.
        </p>
      </div>

      {items.length === 0 ? (
        <p className="rounded-lg border border-dashed border-gray-200 bg-white px-4 py-6 text-sm text-gray-500">
          No urgent recommendations right now. Your setup looks healthy.
        </p>
      ) : (
        <ul className="space-y-2">
          {items.map((rec) => (
            <li key={rec.id}>
              <Link
                to={withSetupWizardReturn(rec.route)}
                className={`flex flex-col gap-2 rounded-xl border px-4 py-3 transition-colors hover:shadow-sm sm:flex-row sm:items-center sm:justify-between ${
                  PRIORITY_STYLES[rec.priority] || PRIORITY_STYLES.low
                }`}
              >
                <div>
                  <div className="font-semibold text-gray-900">{rec.label}</div>
                  <div className="text-sm text-gray-600">{rec.description}</div>
                  {rec.employeeCode && rec.employeeCode !== '—' && (
                    <div className="mt-0.5 text-xs text-gray-500">
                      {rec.employeeCode} — {rec.employeeName}
                    </div>
                  )}
                </div>
                <span className="shrink-0 text-sm font-semibold text-violet-700">Go →</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
