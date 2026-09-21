import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Building2, ChevronRight, RefreshCw, Star } from 'lucide-react';
import {
  buildSetupStepsViewModel,
  DEFAULT_SETUP_PROGRESS,
  fetchWizardContext,
  isSetupComplete,
  withSetupWizardReturn,
} from './setupWizardUtils';
import SetupWizardStepsPanel from './SetupWizardStepsPanel';
import { useReloadOnReturn } from './useReloadOnReturn';

export default function OrganizationSettingsPage() {
  const [searchParams] = useSearchParams();
  const activeStepId = searchParams.get('step') || '';

  const [wizardLoading, setWizardLoading] = useState(true);
  const [wizardLoadErrors, setWizardLoadErrors] = useState([]);
  const [viewModel, setViewModel] = useState(null);

  const loadWizard = useCallback(async () => {
    setWizardLoading(true);
    setWizardLoadErrors([]);
    try {
      const result = await fetchWizardContext();
      setViewModel(buildSetupStepsViewModel(result));
      if (result.errors?.length) {
        setWizardLoadErrors(result.errors);
      }
    } catch {
      setViewModel(null);
    } finally {
      setWizardLoading(false);
    }
  }, []);

  useEffect(() => {
    document.title = 'Organization Settings | HR';
    loadWizard();
  }, [loadWizard]);

  useReloadOnReturn(loadWizard);

  const progress = viewModel?.progress || DEFAULT_SETUP_PROGRESS;
  const allSetupComplete = isSetupComplete(viewModel?.steps);

  const nextStepLabel = useMemo(() => {
    if (!viewModel?.nextStep || viewModel.nextStep.status !== 'incomplete') return null;
    return `Step ${viewModel.nextStep.order}: ${viewModel.nextStep.label}`;
  }, [viewModel?.nextStep]);

  return (
    <div className="mx-auto max-w-4xl space-y-6 pb-12">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold text-slate-900">
          <Building2 className="text-violet-600" size={24} />
          Organization Settings
        </h1>
        <p className="mt-1 text-sm text-slate-600">
          Complete these 9 steps to configure your hospital. Each step opens on its own page.
        </p>
        {wizardLoadErrors.length > 0 && (
          <p className="mt-2 text-xs text-amber-800">
            Partial data: failed to load {wizardLoadErrors.join(', ')}. Progress may be incomplete.
          </p>
        )}
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={loadWizard}
            disabled={wizardLoading}
            className="inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-semibold text-gray-700 shadow-sm hover:bg-gray-50 disabled:opacity-60"
          >
            <RefreshCw size={14} className={wizardLoading ? 'animate-spin' : ''} />
            Refresh setup progress
          </button>
          {!wizardLoading && nextStepLabel && viewModel?.nextStep?.status === 'incomplete' && (
            <Link
              to={withSetupWizardReturn(viewModel.nextStep.route)}
              className="inline-flex items-center gap-1 rounded-lg bg-violet-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-violet-700"
            >
              Continue: {nextStepLabel}
            </Link>
          )}
          {!allSetupComplete && !wizardLoading && (
            <Link
              to="/hr/journey-center?skipSetup=1"
              className="text-sm text-gray-500 hover:text-gray-700 hover:underline"
            >
              Skip for now
            </Link>
          )}
        </div>
      </div>

      {!wizardLoading && allSetupComplete && (
        <div className="flex flex-col gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-2 text-sm text-emerald-900">
            <Star size={16} className="mt-0.5 shrink-0 fill-amber-400 text-amber-500" />
            <span>Initial setup is complete. You can now hire employees and run HR operations from Hire Staff.</span>
          </div>
          <Link
            to="/hr/journey-center"
            className="inline-flex shrink-0 items-center justify-center gap-1 rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800"
          >
            Go to Hire Staff
            <ChevronRight size={16} />
          </Link>
        </div>
      )}

      <SetupWizardStepsPanel
        steps={viewModel?.steps}
        progress={progress}
        nextStep={viewModel?.nextStep}
        activeStepId={activeStepId}
        loading={wizardLoading}
      />
    </div>
  );
}
