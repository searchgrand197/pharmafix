import React from 'react';
import { Link } from 'react-router-dom';
import { ClipboardList } from 'lucide-react';

import { withSetupWizardReturn } from './setupWizardUtils';

export default function WizardOnboardingReadinessPanel({ summary, loading }) {
  if (loading) {
    return (
      <section className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
        <div className="mb-4 h-6 w-48 animate-pulse rounded bg-gray-100" />
        <div className="grid gap-3 sm:grid-cols-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-24 animate-pulse rounded-lg bg-gray-50" />
          ))}
        </div>
      </section>
    );
  }

  const metrics = summary?.metrics || [];

  return (
    <section className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
      <div className="mb-4">
        <h2 className="flex items-center gap-2 text-lg font-bold text-gray-900">
          <ClipboardList size={20} className="text-violet-600" />
          Onboarding readiness
        </h2>
        <p className="mt-0.5 text-sm text-gray-600">
          Candidates and joiners still moving through document and activation steps.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        {metrics.map((metric) => (
          <Link
            key={metric.key}
            to={withSetupWizardReturn(metric.route)}
            className="rounded-xl border border-gray-100 bg-gray-50/80 px-4 py-4 transition-colors hover:border-violet-200 hover:bg-violet-50/40"
          >
            <div className="text-2xl font-bold tabular-nums text-gray-900">{metric.count}</div>
            <div className="mt-1 text-sm font-semibold text-gray-800">{metric.label}</div>
            <div className="mt-0.5 text-xs text-gray-500">{metric.hint}</div>
          </Link>
        ))}
      </div>
    </section>
  );
}
