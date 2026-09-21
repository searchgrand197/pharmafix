import React, { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { CheckCircle2, Circle, ChevronRight } from 'lucide-react';
import {
  computeSetupProgress,
  DEFAULT_SETUP_PROGRESS,
  SETUP_WIZARD_PHASES,
  withSetupWizardReturn,
} from './setupWizardUtils';

function StatusBadge({ status }) {
  const complete = status === 'complete';
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-bold ${
        complete
          ? 'bg-emerald-100 text-emerald-800'
          : 'bg-amber-100 text-amber-900'
      }`}
    >
      {complete ? <CheckCircle2 size={12} /> : <Circle size={12} />}
      {complete ? 'Complete' : 'Incomplete'}
    </span>
  );
}

export default function SetupWizardStepsPanel({ steps, progress, nextStep, activeStepId, loading }) {
  const resolvedProgress = steps?.length
    ? computeSetupProgress(steps)
    : (progress || DEFAULT_SETUP_PROGRESS);

  const phasedSteps = useMemo(() => {
    const stepList = steps || [];
    return SETUP_WIZARD_PHASES.map((phase) => ({
      ...phase,
      steps: stepList.filter((step) => phase.stepOrders.includes(step.order)),
    })).filter((phase) => phase.steps.length > 0);
  }, [steps]);

  function isStepActive(step) {
    const isIncomplete = step.status === 'incomplete';
    return isIncomplete && (
      step.id === activeStepId
      || (step.id === nextStep?.id && !activeStepId)
    );
  }

  if (loading) {
    return (
      <section className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
        <div className="mb-4 h-6 w-48 animate-pulse rounded bg-gray-100" />
        <div className="mb-6 h-3 animate-pulse rounded-full bg-gray-100" />
        <div className="space-y-3">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-16 animate-pulse rounded-lg bg-gray-50" />
          ))}
        </div>
      </section>
    );
  }

  return (
    <section className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-lg font-bold text-gray-900">Initial setup</h2>
          <p className="mt-0.5 text-sm text-gray-600">
            {resolvedProgress.completed} of {resolvedProgress.total} configuration steps complete ({resolvedProgress.percent}%)
          </p>
        </div>
        {nextStep && nextStep.status === 'incomplete' && (
          <Link
            to={withSetupWizardReturn(nextStep.route)}
            className="inline-flex items-center justify-center gap-1 rounded-lg bg-violet-600 px-4 py-2 text-sm font-semibold text-white hover:bg-violet-700"
          >
            Continue setup
            <ChevronRight size={16} />
          </Link>
        )}
      </div>

      <div className="mb-6">
        <div className="mb-1 flex justify-between text-xs font-medium text-gray-600">
          <span>Setup progress</span>
          <span>{resolvedProgress.percent}%</span>
        </div>
        <div className="h-3 overflow-hidden rounded-full bg-gray-100">
          <div
            className="h-full rounded-full bg-violet-600 transition-all duration-500"
            style={{ width: `${resolvedProgress.percent}%` }}
          />
        </div>
      </div>

      <div className="space-y-6">
        {phasedSteps.map((phase) => (
          <div key={phase.id}>
            <h3 className="mb-2 text-xs font-bold uppercase tracking-wide text-gray-500">
              {phase.label}
            </h3>
            <ol className="space-y-2">
              {phase.steps.map((step) => (
                <li key={step.id}>
                  <Link
                    to={withSetupWizardReturn(step.route)}
                    className={`group flex items-start gap-3 rounded-xl border px-4 py-3 transition-colors ${
                      isStepActive(step)
                        ? 'border-violet-300 bg-violet-50'
                        : 'border-gray-100 bg-gray-50/50 hover:border-violet-200 hover:bg-violet-50/40'
                    }`}
                  >
                    <span
                      className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-sm font-bold ${
                        step.status === 'complete'
                          ? 'bg-emerald-100 text-emerald-800'
                          : 'bg-white text-violet-700 ring-1 ring-violet-200'
                      }`}
                    >
                      {step.order}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-semibold text-gray-900">{step.label}</span>
                        <StatusBadge status={step.status} />
                      </div>
                      <p className="mt-0.5 text-sm text-gray-600">{step.hint}</p>
                    </div>
                    <ChevronRight
                      size={18}
                      className="mt-1 shrink-0 text-gray-300 group-hover:text-violet-500"
                    />
                  </Link>
                </li>
              ))}
            </ol>
          </div>
        ))}
      </div>
    </section>
  );
}
