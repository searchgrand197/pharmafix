import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Check, ChevronDown, ChevronRight, ClipboardList, UserPlus, Wallet } from 'lucide-react';
import {
  completionBarClass,
  completionRowClass,
  completionTooltip,
  computeBottleneckStageId,
  computeDefaultExpandedPhase,
  computePhaseCompletionPercent,
  computePhaseTotal,
  JOURNEY_PHASE_SHORT_LABELS,
  JOURNEY_SECTIONS,
  pipelineQueryForStage,
  withJourneyCenterReturn,
} from './journeyCenterUtils';

const PHASE_ACCENTS = {
  hiring: { bg: 'bg-indigo-50', border: 'border-indigo-200', text: 'text-indigo-700', icon: UserPlus },
  employee: { bg: 'bg-amber-50', border: 'border-amber-200', text: 'text-amber-800', icon: ClipboardList },
  payroll: { bg: 'bg-emerald-50', border: 'border-emerald-200', text: 'text-emerald-800', icon: Wallet },
};

const SESSION_KEY = 'journeyCenterExpandedPhase';

function StepProgress({ stepCompletion }) {
  if (!stepCompletion || stepCompletion.awaiting_hire) {
    return (
      <span className="shrink-0 text-xs text-gray-400">—</span>
    );
  }
  const { percent, current, target, status, extra } = stepCompletion;
  return (
    <div className="flex w-24 shrink-0 flex-col items-end gap-1">
      <div className="flex items-center gap-1">
        {status === 'complete' && <Check size={12} className="text-emerald-600" />}
        <span className="text-xs font-bold tabular-nums text-gray-700">{percent}%</span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-gray-100">
        <div
          className={`h-full rounded-full transition-all ${completionBarClass(stepCompletion)}`}
          style={{ width: `${percent}%` }}
        />
      </div>
      <span className="text-[10px] tabular-nums text-gray-500">
        {current}/{target}
        {extra > 0 ? ` (+${extra})` : ''}
      </span>
    </div>
  );
}

function CompactStepRow({
  stage,
  value,
  loading,
  highlight,
  jobOpening,
  stepCompletion,
  showCompletion,
}) {
  const showCount = Boolean(stage.countKey);
  const displayValue = loading ? '—' : (value ?? 0);
  const pipeline = pipelineQueryForStage(stage.id);
  const linkTo = withJourneyCenterReturn(stage.route, { jobOpening, pipeline });
  const rowClass = showCompletion && stepCompletion
    ? completionRowClass(stepCompletion)
    : (highlight ? 'border-violet-200 bg-violet-50/40' : stage.alternate ? 'border-violet-100 bg-violet-50/30' : 'border-gray-100 bg-white');

  return (
    <Link
      to={linkTo}
      className={`group flex items-center gap-3 rounded-lg border px-3 py-2.5 text-sm transition-colors hover:border-violet-200 hover:bg-violet-50/50 ${rowClass}`}
      title={showCompletion ? completionTooltip(stage, stepCompletion) : stage.hint}
    >
      <span
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-white"
        style={{ backgroundColor: stage.color }}
      >
        {stage.alternate ? 'DH' : stage.step}
      </span>
      <span className="min-w-0 flex-1">
        <span className="font-medium text-gray-900">{stage.label}</span>
        {stage.alternate && (
          <span className="mt-0.5 block text-xs text-gray-500">Skip recruitment — walk-in hire</span>
        )}
        {showCompletion && stepCompletion && !stepCompletion.awaiting_hire && (
          <span className="mt-1 block text-[10px] text-gray-500">
            {stepCompletion.current} of {stepCompletion.target} toward goal
          </span>
        )}
      </span>
      {showCompletion && !stage.alternate && (
        <StepProgress stepCompletion={stepCompletion} />
      )}
      {showCount && !showCompletion && (
        <span className="shrink-0 tabular-nums font-bold text-gray-700">{displayValue}</span>
      )}
      {showCount && showCompletion && (
        <span className="shrink-0 text-xs tabular-nums text-gray-500" title="Pending in this stage">
          {displayValue}
        </span>
      )}
      <ChevronRight size={14} className="shrink-0 text-gray-300 group-hover:text-violet-500" />
    </Link>
  );
}

function PhasePanel({
  section,
  counts,
  loading,
  expanded,
  onToggle,
  jobOpening,
  completion,
  bottleneckStageId,
}) {
  const accent = PHASE_ACCENTS[section.id] || PHASE_ACCENTS.hiring;
  const PhaseIcon = accent.icon;
  const shortLabel = JOURNEY_PHASE_SHORT_LABELS[section.id] || section.title;
  const total = computePhaseTotal(section, counts, loading);
  const phasePercent = computePhaseCompletionPercent(section, completion);
  const showCompletion = Boolean(jobOpening && completion?.steps);
  const panelId = `journey-phase-${section.id}`;

  const firstStageWithCount = section.stages.find(
    (stage) => stage.countKey && !loading && Number(counts[stage.countKey]) > 0,
  );
  const defaultStage = section.stages.find((stage) => !stage.alternate) || section.stages[0];
  const highlightStageId = showCompletion
    ? bottleneckStageId
    : (firstStageWithCount?.id || defaultStage?.id);

  return (
    <div className={`overflow-hidden rounded-xl border ${accent.border} bg-white shadow-sm`}>
      <button
        type="button"
        id={`${panelId}-header`}
        aria-expanded={expanded}
        aria-controls={panelId}
        onClick={onToggle}
        className={`flex w-full items-center gap-3 px-4 py-4 text-left transition-colors hover:bg-gray-50/80 ${accent.bg}`}
      >
        <PhaseIcon size={20} className={`shrink-0 ${accent.text}`} />
        <div className="min-w-0 flex-1">
          <div className={`text-base font-bold ${accent.text}`}>{shortLabel}</div>
          <p className="mt-0.5 text-sm text-gray-600">{section.description}</p>
        </div>
        {showCompletion && phasePercent != null ? (
          <span className={`shrink-0 rounded-full border px-2.5 py-0.5 text-xs font-bold ${accent.border} bg-white ${accent.text}`}>
            {phasePercent}% complete
          </span>
        ) : (
          <span className={`shrink-0 rounded-full border px-2.5 py-0.5 text-xs font-bold ${accent.border} bg-white ${accent.text}`}>
            {loading ? '—' : total} records
          </span>
        )}
        <ChevronDown
          size={18}
          className={`shrink-0 text-gray-400 transition-transform ${expanded ? 'rotate-180' : ''}`}
        />
      </button>
      {expanded && (
        <div id={panelId} className="space-y-2 border-t border-gray-100 p-3" role="region" aria-labelledby={`${panelId}-header`}>
          {section.stages.map((stage) => (
            <CompactStepRow
              key={stage.id}
              stage={stage}
              value={counts[stage.countKey]}
              loading={loading}
              highlight={!stage.alternate && stage.id === highlightStageId}
              jobOpening={jobOpening}
              stepCompletion={completion?.steps?.[stage.id]}
              showCompletion={showCompletion && !stage.alternate}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export default function JourneyPhaseAccordion({ counts, loading, jobOpening = '', completion = null }) {
  const defaultPhase = computeDefaultExpandedPhase(counts, loading);
  const [expandedPhase, setExpandedPhase] = useState(defaultPhase);
  const bottleneckStageId = useMemo(
    () => computeBottleneckStageId(completion),
    [completion],
  );

  useEffect(() => {
    if (loading) return;
    const saved = sessionStorage.getItem(SESSION_KEY);
    if (saved && JOURNEY_SECTIONS.some((s) => s.id === saved)) {
      setExpandedPhase(saved);
    } else if (jobOpening && completion) {
      const phaseWithBottleneck = JOURNEY_SECTIONS.find((section) =>
        section.stages.some((s) => s.id === bottleneckStageId),
      );
      setExpandedPhase(phaseWithBottleneck?.id || defaultPhase);
    } else {
      setExpandedPhase(defaultPhase);
    }
  }, [defaultPhase, loading, jobOpening, completion, bottleneckStageId]);

  const togglePhase = (phaseId) => {
    setExpandedPhase((current) => {
      const next = current === phaseId ? null : phaseId;
      if (next) {
        sessionStorage.setItem(SESSION_KEY, next);
      } else {
        sessionStorage.removeItem(SESSION_KEY);
      }
      return next;
    });
  };

  return (
    <section>
      <div className="mb-3">
        <h2 className="text-base font-bold text-gray-900">HR workflow map</h2>
        <p className="mt-0.5 text-sm text-gray-600">
          {jobOpening && completion
            ? 'Colored rows show progress toward filling this job\'s vacancies. Click a step to work the queue.'
            : 'Expand a phase to see all steps. Each step opens the right page — use Back to Hire Staff to return.'}
        </p>
        {jobOpening && completion && (
          <p className="mt-1.5 text-xs text-gray-500">
            <span className="inline-block rounded border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 text-emerald-800">Green</span>
            {' '}= goal met ·{' '}
            <span className="inline-block rounded border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-amber-900">Amber</span>
            {' '}= almost ·{' '}
            <span className="inline-block rounded border border-violet-200 bg-violet-50 px-1.5 py-0.5 text-violet-800">Blue</span>
            {' '}= in progress · Gray = not started
          </p>
        )}
      </div>
      <div className="space-y-3">
        {JOURNEY_SECTIONS.map((section) => (
          <PhasePanel
            key={section.id}
            section={section}
            counts={counts}
            loading={loading}
            expanded={expandedPhase === section.id}
            onToggle={() => togglePhase(section.id)}
            jobOpening={jobOpening}
            completion={completion}
            bottleneckStageId={bottleneckStageId}
          />
        ))}
      </div>
    </section>
  );
}
