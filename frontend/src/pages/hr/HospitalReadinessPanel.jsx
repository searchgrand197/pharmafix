import React from 'react';
import { Activity } from 'lucide-react';

function DomainBar({ domain }) {
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-sm">
        <span className="font-medium text-gray-800">{domain.label}</span>
        <span className="tabular-nums font-semibold text-gray-900">{domain.percent}%</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-gray-100">
        <div
          className="h-full rounded-full bg-violet-500 transition-all duration-500"
          style={{ width: `${domain.percent}%` }}
        />
      </div>
    </div>
  );
}

export default function HospitalReadinessPanel({ readiness, loading }) {
  if (loading) {
    return (
      <section className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
        <div className="mb-4 h-6 w-56 animate-pulse rounded bg-gray-100" />
        <div className="space-y-4">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="h-8 animate-pulse rounded bg-gray-50" />
          ))}
        </div>
      </section>
    );
  }

  const { domains = [], overall = 0 } = readiness || {};

  return (
    <section className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
      <div className="mb-4 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-bold text-gray-900">
            <Activity size={20} className="text-violet-600" />
            Hospital readiness score
          </h2>
          <p className="mt-0.5 text-sm text-gray-600">
            Based on setup step completion across recruitment, workforce, attendance, leave, and payroll.
          </p>
        </div>
        <div className="flex shrink-0 flex-col items-center rounded-xl border border-violet-100 bg-violet-50 px-5 py-3">
          <span className="text-3xl font-bold tabular-nums text-violet-900">{overall}%</span>
          <span className="text-xs font-semibold uppercase tracking-wide text-violet-700">Overall</span>
        </div>
      </div>

      <div className="space-y-4">
        {domains.map((domain) => (
          <DomainBar key={domain.key} domain={domain} />
        ))}
      </div>

      <p className="mt-4 text-xs text-gray-500">
        Each bar reflects related setup wizard steps — not live payroll or attendance calculations.
      </p>
    </section>
  );
}
