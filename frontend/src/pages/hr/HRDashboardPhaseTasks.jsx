import React, { useMemo } from 'react';
import { ChevronDown } from 'lucide-react';
import {
  groupTasksByPhase,
  PRIORITY_ORDER,
  TASK_PHASES,
} from './nextActionEngine';
import HRDashboardTaskRow from './HRDashboardTaskRow';

const PHASE_ACCENTS = {
  recruitment: 'border-indigo-200 bg-indigo-50 text-indigo-800',
  onboarding: 'border-amber-200 bg-amber-50 text-amber-900',
  workforce: 'border-orange-200 bg-orange-50 text-orange-900',
  attendance: 'border-cyan-200 bg-cyan-50 text-cyan-900',
  payroll: 'border-emerald-200 bg-emerald-50 text-emerald-900',
};

function sortTasksByPriority(tasks) {
  const onboardingOrder = {
    ready_to_activate: 0,
    pending_document_review: 1,
    onboarding_waiting_docs: 2,
    mandatory_docs: 3,
  };
  return [...tasks].sort((a, b) => {
    const p = (PRIORITY_ORDER[a.priority] ?? 1) - (PRIORITY_ORDER[b.priority] ?? 1);
    if (p !== 0) return p;
    const onboardingA = onboardingOrder[a.category] ?? 99;
    const onboardingB = onboardingOrder[b.category] ?? 99;
    if (onboardingA !== onboardingB) return onboardingA - onboardingB;
    return (a.employeeName || '').localeCompare(b.employeeName || '');
  });
}

function PhaseSection({ phase, tasks }) {
  const sorted = sortTasksByPriority(tasks);
  const count = sorted.length;
  const accent = PHASE_ACCENTS[phase.id] || PHASE_ACCENTS.workforce;
  const criticalCount = sorted.filter((t) => t.priority === 'critical').length;

  if (count === 0) return null;

  return (
    <details open className="group overflow-hidden rounded-xl border border-gray-100 bg-white shadow-sm">
      <summary
        className={`flex cursor-pointer list-none items-center gap-3 border-b px-4 py-3.5 ${accent} [&::-webkit-details-marker]:hidden`}
      >
        <div className="min-w-0 flex-1">
          <div className="text-base font-bold">{phase.label}</div>
          <p className="text-sm opacity-80">{phase.description}</p>
        </div>
        {criticalCount > 0 && (
          <span className="shrink-0 rounded-full bg-red-600 px-2 py-0.5 text-[10px] font-bold uppercase text-white">
            {criticalCount} urgent
          </span>
        )}
        <span className="shrink-0 rounded-full border border-current/20 bg-white/60 px-2.5 py-0.5 text-xs font-bold">
          {count} task{count === 1 ? '' : 's'}
        </span>
        <ChevronDown
          size={18}
          className="shrink-0 opacity-60 transition-transform group-open:rotate-180"
        />
      </summary>
      <div className="space-y-2 p-3">
        {sorted.map((task) => (
          <HRDashboardTaskRow key={task.id} task={task} />
        ))}
      </div>
    </details>
  );
}

export default function HRDashboardPhaseTasks({ tasks, loading }) {
  const byPhase = useMemo(() => groupTasksByPhase(tasks), [tasks]);
  const totalTasks = (tasks || []).length;

  if (loading) return null;

  if (totalTasks === 0) {
    return (
      <section className="rounded-xl border border-dashed border-gray-200 bg-gray-50 px-6 py-10 text-center">
        <p className="text-sm font-medium text-gray-700">No pending tasks across any HR phase.</p>
        <p className="mt-1 text-xs text-gray-500">New work will appear here automatically.</p>
      </section>
    );
  }

  return (
    <section>
      <div className="mb-3">
        <h2 className="text-base font-bold text-gray-900">
          All {totalTasks} pending task{totalTasks === 1 ? '' : 's'} by phase
        </h2>
        <p className="text-sm text-gray-600">
          Nothing is hidden — recruitment, onboarding, workforce setup, attendance, and payroll.
          Urgent items are marked and sorted to the top within each phase.
        </p>
      </div>
      <div className="space-y-3">
        {TASK_PHASES.map((phase) => (
          <PhaseSection
            key={phase.id}
            phase={phase}
            tasks={byPhase[phase.id] || []}
          />
        ))}
      </div>
    </section>
  );
}
