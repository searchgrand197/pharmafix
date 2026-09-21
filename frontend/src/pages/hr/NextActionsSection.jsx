import React from 'react';
import { Link } from 'react-router-dom';
import { ListTodo } from 'lucide-react';
import { TableSkeleton } from '../../components/HR/HRSkeleton';
import {
  groupTasksByPriority,
  PRIORITY_LABELS,
} from './nextActionEngine';
import { withJourneyCenterReturn } from './journeyCenterUtils';

const DISPLAY_LIMIT = Number.MAX_SAFE_INTEGER;

const PRIORITY_STYLES = {
  critical: 'border-red-200 bg-red-50 text-red-900',
  medium: 'border-amber-200 bg-amber-50 text-amber-950',
  low: 'border-slate-200 bg-slate-50 text-slate-800',
};

function TaskTable({ tasks, priority }) {
  if (tasks.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-gray-200 bg-white px-4 py-6 text-sm text-gray-500">
        No {PRIORITY_LABELS[priority].toLowerCase()} tasks right now.
      </p>
    );
  }

  const visible = tasks.slice(0, DISPLAY_LIMIT);
  const hiddenCount = tasks.length - visible.length;

  return (
    <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
      <div className="overflow-x-auto">
        <table className="min-w-full text-left text-sm">
          <thead className="border-b border-gray-100 bg-gray-50 text-xs font-semibold uppercase tracking-wide text-gray-500">
            <tr>
              <th className="px-4 py-3">Person</th>
              <th className="px-4 py-3">Issue</th>
              <th className="px-4 py-3">Recommended action</th>
              <th className="px-4 py-3 text-right">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {visible.map((task) => (
              <tr key={task.id} className="hover:bg-gray-50/80">
                <td className="px-4 py-3">
                  <div className="font-medium text-gray-900">{task.employeeName}</div>
                  <div className="text-xs text-gray-500">
                    {task.subjectType === 'candidate'
                      ? (task.subjectSubtitle || 'Candidate')
                      : task.employeeCode}
                  </div>
                </td>
                <td className="px-4 py-3 text-gray-700">{task.issue}</td>
                <td className="px-4 py-3 text-gray-600">{task.recommendedAction}</td>
                <td className="px-4 py-3 text-right">
                  <Link
                    to={withJourneyCenterReturn(task.actionRoute)}
                    className="inline-flex rounded-lg bg-violet-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-violet-700"
                  >
                    {task.actionLabel}
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {hiddenCount > 0 && (
        <div className="border-t border-gray-100 px-4 py-2 text-xs text-gray-600">
          Showing {visible.length} of {tasks.length} tasks in this group.
        </div>
      )}
    </div>
  );
}

export default function NextActionsSection({ tasks, loading }) {
  const grouped = groupTasksByPriority(tasks || []);

  return (
    <section className="rounded-2xl border border-gray-100 bg-gray-50/80 p-5">
      <div className="mb-4">
        <h2 className="flex items-center gap-2 text-lg font-bold text-gray-900">
          <ListTodo size={20} className="text-violet-600" />
          All open tasks
        </h2>
        <p className="mt-0.5 text-sm text-gray-600">
          Full list of recruitment, onboarding, attendance, and payroll items — each row opens where you can fix it.
        </p>
      </div>

      {loading ? (
        <TableSkeleton rows={5} cols={4} />
      ) : (
        <div className="space-y-5">
          {(['critical', 'medium', 'low']).map((priority) => (
            <div key={priority}>
              <div className="mb-2 flex items-center justify-between gap-2">
                <h3 className={`inline-flex rounded-full border px-2.5 py-0.5 text-xs font-bold uppercase tracking-wide ${PRIORITY_STYLES[priority]}`}>
                  {PRIORITY_LABELS[priority]} ({grouped[priority].length})
                </h3>
              </div>
              <TaskTable tasks={grouped[priority]} priority={priority} />
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
