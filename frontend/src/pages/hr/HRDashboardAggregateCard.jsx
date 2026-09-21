import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { withHrDashboardReturn } from './journeyCenterUtils';
import { PRIORITY_LABEL_MAP } from './dashboardCommandCenter';

function formatDueDate(value) {
  if (!value) return null;
  const day = String(value).split('T')[0];
  if (!day || day === 'undefined') return null;
  try {
    const parsed = new Date(`${day}T12:00:00`);
    if (Number.isNaN(parsed.getTime())) return null;
    return parsed.toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  } catch {
    return null;
  }
}

export default function HRDashboardAggregateCard({ card, compact = false }) {
  if (!card || card.count <= 0) return null;

  const priorityLabel = PRIORITY_LABEL_MAP[card.priority] || 'Medium';
  const due = formatDueDate(card.dueDate);

  return (
    <div
      className={`flex flex-col rounded-xl border border-gray-100 bg-white shadow-sm transition-shadow hover:shadow-md ${
        compact ? 'p-3' : 'p-4'
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="text-sm font-bold text-gray-900">{card.label}</h3>
          <p className="mt-1 text-2xl font-bold tabular-nums text-violet-700">
            {card.count}
            <span className="ml-1 text-sm font-medium text-gray-500">
              {card.count === 1 ? 'item' : 'items'}
            </span>
          </p>
        </div>
        <span className="shrink-0 rounded-full border border-gray-200 bg-gray-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-gray-600">
          {priorityLabel}
        </span>
      </div>
      {due && (
        <p className="mt-2 text-xs text-gray-500">
          {card.dueHint ? `${card.dueHint}${card.dueDate ? ` · ${due}` : ''}` : `Due ${due}`}
        </p>
      )}
      {!due && card.dueHint && (
        <p className="mt-2 text-xs text-gray-500">{card.dueHint}</p>
      )}
      {!due && !card.dueHint && card.hint && (
        <p className="mt-2 text-xs text-gray-600">{card.hint}</p>
      )}
      <Link
        to={withHrDashboardReturn(card.route)}
        className="mt-3 inline-flex items-center justify-center gap-1.5 rounded-lg bg-violet-600 px-3 py-2 text-xs font-semibold text-white hover:bg-violet-700"
      >
        {card.actionLabel}
        <ArrowRight size={14} />
      </Link>
    </div>
  );
}
