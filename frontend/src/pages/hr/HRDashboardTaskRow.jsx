import React from 'react';
import { Link } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import { getTaskTypeLabel } from './nextActionEngine';
import { withHrDashboardReturn } from './journeyCenterUtils';
import { PRIORITY_LABEL_MAP } from './dashboardCommandCenter';

const PRIORITY_BADGE = {
  critical: 'bg-red-100 text-red-800 border-red-200',
  medium: 'bg-amber-100 text-amber-900 border-amber-200',
  low: 'bg-slate-100 text-slate-700 border-slate-200',
};

function formatDueDate(value) {
  if (!value) return null;
  const day = String(value).split('T')[0];
  try {
    return new Date(`${day}T12:00:00`).toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return null;
  }
}

export default function HRDashboardTaskRow({ task, compact = false }) {
  const typeLabel = getTaskTypeLabel(task);
  const isToday = task.issue?.toLowerCase().includes('today');
  const dueLabel = formatDueDate(task.dueDate);
  const priorityLabel = PRIORITY_LABEL_MAP[task.priority] || 'Medium';

  return (
    <Link
      to={withHrDashboardReturn(task.actionRoute)}
      className={`group flex items-center gap-3 rounded-lg border border-gray-100 bg-white transition-colors hover:border-violet-200 hover:bg-violet-50/40 ${
        compact ? 'px-3 py-2.5' : 'px-4 py-3'
      }`}
    >
      <span
        className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${
          PRIORITY_BADGE[task.priority] || PRIORITY_BADGE.medium
        }`}
      >
        {typeLabel}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
          <span className="font-semibold text-gray-900">{task.employeeName}</span>
          {task.subjectType !== 'candidate' && task.employeeCode && task.employeeCode !== task.employeeName && (
            <span className="text-xs text-gray-500">{task.employeeCode}</span>
          )}
          {task.subjectSubtitle && (
            <span className="text-xs text-gray-500">{task.subjectSubtitle}</span>
          )}
          {isToday && (
            <span className="rounded bg-violet-600 px-1.5 py-0.5 text-[10px] font-bold uppercase text-white">
              Today
            </span>
          )}
        </div>
        <p className={`text-gray-700 ${compact ? 'text-xs' : 'text-sm'}`}>{task.issue}</p>
        {!compact && (
          <p className="mt-0.5 text-xs text-gray-500">
            {task.recommendedAction}
            {dueLabel ? ` · Due ${dueLabel}` : ''}
            {` · Priority: ${priorityLabel}`}
          </p>
        )}
      </div>
      <span className="flex shrink-0 items-center gap-1 text-sm font-semibold text-violet-700">
        {task.actionLabel}
        <ChevronRight size={14} className="text-gray-300 group-hover:text-violet-500" />
      </span>
    </Link>
  );
}
