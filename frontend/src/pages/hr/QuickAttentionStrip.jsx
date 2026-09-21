import React from 'react';
import { Link } from 'react-router-dom';
import { ListTodo } from 'lucide-react';
import { groupTasksByPriority } from './nextActionEngine';
import { withJourneyCenterReturn } from './journeyCenterUtils';

export default function QuickAttentionStrip({ tasks, loading }) {
  const grouped = groupTasksByPriority(tasks || []);
  const urgent = [...grouped.critical, ...grouped.medium].slice(0, 6);

  if (loading || urgent.length === 0) return null;

  return (
    <section className="rounded-2xl border border-amber-200 bg-amber-50/60 p-5">
      <h2 className="flex items-center gap-2 text-base font-bold text-amber-950">
        <ListTodo size={18} />
        Do these first ({urgent.length})
      </h2>
      <p className="mt-0.5 text-sm text-amber-900/80">
        Highest-priority items across recruitment, onboarding, and payroll.
      </p>
      <ul className="mt-3 space-y-2">
        {urgent.map((task) => (
          <li key={task.id}>
            <Link
              to={withJourneyCenterReturn(task.actionRoute)}
              className="flex items-center justify-between gap-3 rounded-lg border border-amber-100 bg-white px-4 py-3 text-sm hover:border-amber-300"
            >
              <div className="min-w-0">
                <span className="font-semibold text-gray-900">{task.employeeName}</span>
                {task.subjectType !== 'candidate' && task.employeeCode !== task.employeeName && (
                  <>
                    <span className="mx-1.5 text-gray-400">·</span>
                    <span className="text-gray-500">{task.employeeCode}</span>
                  </>
                )}
                <span className="mx-1.5 text-gray-400">·</span>
                <span className="text-gray-700">{task.issue}</span>
              </div>
              <span className="shrink-0 font-semibold text-violet-700">{task.actionLabel} →</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
