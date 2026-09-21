import React from 'react';
import { Link } from 'react-router-dom';

export default function CeoKpiStrip({ kpis, loading }) {
  if (loading) {
    return (
      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {[1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="h-24 animate-pulse rounded-xl bg-gray-100" />
        ))}
      </section>
    );
  }

  return (
    <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
      {(kpis || []).map((kpi) => (
        <Link
          key={kpi.key}
          to={kpi.route}
          className="rounded-xl border border-violet-100 bg-gradient-to-br from-violet-50 to-white px-4 py-4 shadow-sm transition-colors hover:border-violet-200"
        >
          <div className="text-xs font-bold uppercase tracking-wide text-violet-700">{kpi.label}</div>
          <div className="mt-1 text-2xl font-bold tabular-nums text-gray-900">{kpi.value}</div>
          {kpi.hint && <div className="mt-0.5 text-xs text-gray-500">{kpi.hint}</div>}
        </Link>
      ))}
    </section>
  );
}
