import React from 'react';
import { Link } from 'react-router-dom';

export default function IntelligenceSection({ title, description, icon: Icon, children, loading }) {
  if (loading) {
    return (
      <section className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
        <div className="mb-4 h-6 w-48 animate-pulse rounded bg-gray-100" />
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-20 animate-pulse rounded-lg bg-gray-50" />
          ))}
        </div>
      </section>
    );
  }

  return (
    <section className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
      <div className="mb-4">
        <h2 className="flex items-center gap-2 text-lg font-bold text-gray-900">
          {Icon && <Icon size={20} className="text-violet-600" />}
          {title}
        </h2>
        {description && (
          <p className="mt-0.5 text-sm text-gray-600">{description}</p>
        )}
      </div>
      {children}
    </section>
  );
}

export function MetricGrid({ metrics }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {(metrics || []).map((item) => (
        <MetricCard key={item.label} {...item} />
      ))}
    </div>
  );
}

export function MetricCard({ label, value, route, hint }) {
  const inner = (
    <>
      <div className="text-2xl font-bold tabular-nums text-gray-900">{value ?? '—'}</div>
      <div className="mt-1 text-sm font-medium text-gray-700">{label}</div>
      {hint && <div className="mt-0.5 text-xs text-gray-500">{hint}</div>}
    </>
  );

  if (route) {
    return (
      <Link
        to={route}
        className="block rounded-xl border border-gray-100 bg-gray-50/80 px-4 py-3 transition-colors hover:border-violet-200 hover:bg-violet-50/40"
      >
        {inner}
      </Link>
    );
  }

  return (
    <div className="rounded-xl border border-gray-100 bg-gray-50/80 px-4 py-3">
      {inner}
    </div>
  );
}
