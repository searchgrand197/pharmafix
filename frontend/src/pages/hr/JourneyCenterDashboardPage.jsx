import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import { ArrowLeft, LayoutDashboard, RefreshCw } from 'lucide-react';
import { DashboardMetricSkeleton } from '../../components/HR/HRSkeleton';
import {
  buildNextActionTasks,
  computeDashboardSummary,
  prepareActionContext,
} from './nextActionEngine';
import {
  buildPriorityTierCards,
  buildWorkQueue,
  normalizeCommandCenterCounts,
} from './dashboardCommandCenter';
import { buildWizardViewModel, fetchWizardContext } from './setupWizardUtils';
import HRDashboardPhaseTasks from './HRDashboardPhaseTasks';
import HRDashboardSummary from './HRDashboardSummary';
import HRDashboardWorkQueue from './HRDashboardWorkQueue';
import HRDashboardPriorityLayers from './HRDashboardPriorityLayers';
import HRDashboardMetrics from './HRDashboardMetrics';
import { journeyCenterPath } from './journeyCenterUtils';
import { useReloadOnReturn } from './useReloadOnReturn';
import api from '../../api';

export default function JourneyCenterDashboardPage() {
  const [loading, setLoading] = useState(true);
  const [nextActions, setNextActions] = useState([]);
  const [commandCenterCounts, setCommandCenterCounts] = useState({});
  const [loadErrors, setLoadErrors] = useState([]);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadErrors([]);
    try {
      const [wizardResult, biometricStatus] = await Promise.all([
        fetchWizardContext(),
        api.get('/hr/biometric-devices/connection-status/').then((r) => r.data).catch(() => null),
      ]);
      buildWizardViewModel(wizardResult);
      const actionContext = prepareActionContext({
        ...wizardResult.context,
        biometricUnlinkedCount: biometricStatus?.pending_unlinked_users ?? 0,
      });
      const tasks = buildNextActionTasks(actionContext);
      const counts = normalizeCommandCenterCounts(
        wizardResult.context.commandCenterCounts || {},
        { ...actionContext, tasks },
      );
      setNextActions(tasks);
      setCommandCenterCounts(counts);
      if (wizardResult.errors?.length) {
        setLoadErrors(wizardResult.errors);
        toast.error(`Some data failed to load: ${wizardResult.errors.join(', ')}`);
      }
    } catch {
      toast.error('Failed to load dashboard');
      setNextActions([]);
      setCommandCenterCounts({});
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    document.title = 'HR Dashboard | Hire Staff';
  }, []);

  useReloadOnReturn(load);

  const summary = useMemo(
    () => computeDashboardSummary(nextActions),
    [nextActions],
  );

  const workQueue = useMemo(
    () => buildWorkQueue(commandCenterCounts, nextActions),
    [commandCenterCounts, nextActions],
  );

  const priorityTiers = useMemo(
    () => buildPriorityTierCards(commandCenterCounts, {
      month: commandCenterCounts.month,
      payrollMonthReadiness: commandCenterCounts.payrollMonthReadiness,
      tasks: nextActions,
    }),
    [commandCenterCounts, nextActions],
  );

  return (
    <div className="mx-auto max-w-5xl space-y-6 pb-12">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <Link
            to={journeyCenterPath()}
            className="mb-3 inline-flex items-center gap-1 text-sm font-medium text-violet-700 hover:underline"
          >
            <ArrowLeft size={14} />
            Back to Hire Staff
          </Link>
          <h1 className="flex items-center gap-2 text-2xl font-bold text-gray-900">
            <LayoutDashboard size={24} className="text-violet-600" />
            HR Command Center
          </h1>
          <p className="mt-1 max-w-xl text-sm text-gray-600">
            Your work queue, urgent priorities, and full task list — every pending HR action in one place.
          </p>
          {loadErrors.length > 0 && (
            <p className="mt-2 text-xs text-amber-800">
              Partial data: failed to load {loadErrors.join(', ')}. Some tasks may be missing — use Refresh.
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={load}
          disabled={loading}
          className="inline-flex shrink-0 items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs font-semibold text-gray-700 shadow-sm hover:bg-gray-50 disabled:opacity-60"
        >
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          Refresh
        </button>
      </div>

      {loading && nextActions.length === 0 ? (
        <div className="space-y-4">
          <DashboardMetricSkeleton count={1} />
          <DashboardMetricSkeleton count={3} />
          <DashboardMetricSkeleton count={5} />
        </div>
      ) : (
        <div className="space-y-6">
          <HRDashboardWorkQueue workQueue={workQueue} loading={loading} />
          <HRDashboardSummary summary={summary} loading={loading} />
          <HRDashboardPriorityLayers tiers={priorityTiers} loading={loading} />
          <HRDashboardPhaseTasks tasks={nextActions} loading={loading} />
          <HRDashboardMetrics
            tasks={nextActions}
            commandCenterCounts={commandCenterCounts}
            loading={loading}
          />
        </div>
      )}
    </div>
  );
}
