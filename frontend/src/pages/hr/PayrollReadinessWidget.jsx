import React from 'react';
import { Link } from 'react-router-dom';
import { Wallet } from 'lucide-react';

export default function PayrollReadinessWidget({ readiness }) {
  if (!readiness) return null;

  const eligible = readiness.eligible;
  const badgeClass = eligible
    ? 'bg-emerald-100 text-emerald-800 border-emerald-200'
    : 'bg-amber-100 text-amber-900 border-amber-200';

  return (
    <section className={`rounded-lg border px-4 py-3 ${badgeClass}`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-sm font-bold">
            <Wallet size={16} />
            Payroll readiness
          </h2>
          <p className="mt-1 text-sm font-semibold">{readiness.statusLabel}</p>
        </div>
        {!eligible && readiness.primaryActionRoute && (
          <Link
            to={readiness.primaryActionRoute}
            className="shrink-0 rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-800"
          >
            {readiness.primaryActionLabel}
          </Link>
        )}
      </div>
      <ul className="mt-2 list-disc space-y-1 pl-4 text-xs">
        {(readiness.reasons || []).map((reason) => (
          <li key={reason}>{reason}</li>
        ))}
      </ul>
    </section>
  );
}
