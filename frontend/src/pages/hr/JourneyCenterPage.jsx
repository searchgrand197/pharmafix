import React, { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { ChevronRight, RefreshCw, Star } from 'lucide-react';
import { DashboardMetricSkeleton } from '../../components/HR/HRSkeleton';
import { buildWizardViewModel, DEFAULT_SETUP_PROGRESS, fetchWizardContext } from './setupWizardUtils';
import JourneyPhaseAccordion from './JourneyPhaseAccordion';
import JourneyStartHereCard from './JourneyStartHereCard';
import JourneyJobFilter from './JourneyJobFilter';
import { fetchJourneyCenterCounts, getPersistedJourneyJobOpening, persistJourneyJobOpening, syncJourneyJobFromSearchParams } from './journeyCenterUtils';
import { useReloadOnReturn } from './useReloadOnReturn';

const SKIP_SETUP_KEY = 'journeyCenterSkipSetup';

export default function JourneyCenterPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const jobOpening = searchParams.get('job_opening') || getPersistedJourneyJobOpening() || '';

  const [loading, setLoading] = useState(true);
  const [counts, setCounts] = useState({});
  const [completion, setCompletion] = useState(null);
  const [jobTitle, setJobTitle] = useState('');
  const [loadErrors, setLoadErrors] = useState([]);
  const [payrollMonth, setPayrollMonth] = useState('');
  const [setupProgress, setSetupProgress] = useState(DEFAULT_SETUP_PROGRESS);

  useEffect(() => {
    if (searchParams.get('skipSetup') === '1') {
      sessionStorage.setItem(SKIP_SETUP_KEY, '1');
    }
  }, [searchParams]);

  useEffect(() => {
    syncJourneyJobFromSearchParams(searchParams, setSearchParams);
  }, [searchParams, setSearchParams]);

  const loadSetup = useCallback(async () => {
    try {
      const wizardResult = await fetchWizardContext();
      const viewModel = buildWizardViewModel(wizardResult);
      setSetupProgress(viewModel.progress);
      if (wizardResult.errors?.length) {
        setLoadErrors((prev) => {
          const merged = [...prev, ...wizardResult.errors];
          return [...new Set(merged)];
        });
      }
    } catch {
      setSetupProgress(DEFAULT_SETUP_PROGRESS);
    }
  }, []);

  const loadCounts = useCallback(async (selectedJob) => {
    setLoading(true);
    setLoadErrors([]);
    try {
      const result = await fetchJourneyCenterCounts({
        jobOpening: selectedJob || undefined,
      });
      setCounts(result.counts);
      setCompletion(result.completion || null);
      setJobTitle(result.jobTitle || '');
      setPayrollMonth(result.month || '');
      if (result.errors?.length) {
        setLoadErrors(result.errors);
        toast.error(`Some data failed to load: ${result.errors.join(', ')}`);
      }
    } catch {
      toast.error('Failed to load Hire Staff');
      setCounts({});
      setCompletion(null);
    } finally {
      setLoading(false);
    }
  }, []);

  const load = useCallback(async () => {
    await Promise.all([loadSetup(), loadCounts(jobOpening)]);
  }, [loadSetup, loadCounts, jobOpening]);

  useEffect(() => {
    document.title = 'Hire Staff | HR';
  }, []);

  useEffect(() => {
    loadCounts(jobOpening);
  }, [jobOpening, loadCounts]);

  useEffect(() => {
    loadSetup();
  }, [loadSetup]);

  useReloadOnReturn(load);

  const handleJobChange = (nextJobId) => {
    persistJourneyJobOpening(nextJobId);
    const params = new URLSearchParams(searchParams);
    if (nextJobId) {
      params.set('job_opening', nextJobId);
    } else {
      params.delete('job_opening');
    }
    setSearchParams(params, { replace: true });
  };

  const setupComplete = setupProgress?.allComplete === true
    || (setupProgress?.percent ?? 0) >= 100;

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold text-gray-900">
            <Star size={24} className="fill-amber-400 text-amber-500" />
            Hire Staff
          </h1>
          <p className="mt-1 max-w-xl text-sm text-gray-600">
            {setupComplete
              ? 'Open a phase below for the full hiring-to-payroll path. Use the sidebar for HR Dashboard and daily tasks.'
              : 'Complete initial setup in Organization Settings (sidebar), then work through the phases below.'}
          </p>
          {setupComplete && payrollMonth && (
            <p className="mt-1 text-xs text-gray-500">
              Payroll counts use month {payrollMonth}.
            </p>
          )}
          {loadErrors.length > 0 && (
            <p className="mt-2 text-xs text-amber-800">
              Partial data: failed to load {loadErrors.join(', ')}. Counts may be low — use Refresh.
            </p>
          )}
        </div>
        <div className="flex shrink-0 flex-wrap items-end gap-2">
          <JourneyJobFilter value={jobOpening} onChange={handleJobChange} />
          <button
            type="button"
            onClick={load}
            disabled={loading}
            className="inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs font-semibold text-gray-700 shadow-sm hover:bg-gray-50 disabled:opacity-60"
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            Refresh
          </button>
        </div>
      </div>

      {loading && counts.applied == null ? (
        <div className="space-y-4">
          <DashboardMetricSkeleton count={2} />
        </div>
      ) : (
        <div className="space-y-6">
          {!setupComplete && !loading && (
            <div className="flex flex-col gap-3 rounded-xl border border-violet-200 bg-violet-50 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="text-sm text-violet-900">
                <p className="font-semibold">Setup incomplete — {setupProgress.percent ?? 0}% done</p>
                <p className="mt-0.5 text-violet-800">
                  {setupProgress.completed ?? 0} of {setupProgress.total ?? 9} configuration steps complete.
                </p>
              </div>
              <Link
                to="/hr/settings/organization"
                className="inline-flex shrink-0 items-center justify-center gap-1 rounded-lg bg-violet-600 px-4 py-2 text-sm font-semibold text-white hover:bg-violet-700"
              >
                Organization Settings
                <ChevronRight size={16} />
              </Link>
            </div>
          )}
          {setupComplete && <JourneyStartHereCard />}
          {jobOpening && completion && !loading && (
            <div className="rounded-xl border border-violet-200 bg-gradient-to-r from-violet-50 to-indigo-50 px-4 py-3">
              <p className="text-sm font-semibold text-violet-950">
                {jobTitle || 'Selected job'} — {completion.phase_hiring_percent ?? 0}% hire progress
              </p>
              <p className="mt-0.5 text-xs text-violet-800">
                {completion.vacancies} vacancy{completion.vacancies === 1 ? '' : 'ies'}
                {completion.hired_employees > 0
                  ? ` · ${completion.hired_employees} employee${completion.hired_employees === 1 ? '' : 's'} linked to this job`
                  : ' · no employees created yet'}
              </p>
            </div>
          )}
          <JourneyPhaseAccordion
            counts={counts}
            loading={loading}
            jobOpening={jobOpening}
            completion={completion}
          />
        </div>
      )}
    </div>
  );
}
