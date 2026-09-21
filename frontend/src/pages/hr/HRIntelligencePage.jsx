import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import { ArrowLeft, BarChart3, RefreshCw } from 'lucide-react';
import { monthLabel } from './payroll/payrollUtils';
import {
  buildIntelligenceViewModel,
  fetchIntelligenceContext,
} from './hrIntelligenceUtils';
import CeoKpiStrip from './CeoKpiStrip';
import WorkforceAnalyticsPanel from './WorkforceAnalyticsPanel';
import HiringAnalyticsPanel from './HiringAnalyticsPanel';
import AttendanceAnalyticsPanel from './AttendanceAnalyticsPanel';
import LeaveAnalyticsPanel from './LeaveAnalyticsPanel';
import PayrollAnalyticsPanel from './PayrollAnalyticsPanel';
import ComplianceAnalyticsPanel from './ComplianceAnalyticsPanel';
import PayrollRiskAnalyticsPanel from './PayrollRiskAnalyticsPanel';

export default function HRIntelligencePage() {
  const [loading, setLoading] = useState(true);
  const [loadErrors, setLoadErrors] = useState([]);
  const [warnings, setWarnings] = useState([]);
  const [month, setMonth] = useState('');
  const [viewModel, setViewModel] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadErrors([]);
    setWarnings([]);
    try {
      const result = await fetchIntelligenceContext();
      setMonth(result.month);
      setViewModel(buildIntelligenceViewModel(result));
      if (result.errors?.length) {
        setLoadErrors(result.errors);
        toast.error(`Some data failed to load: ${result.errors.join(', ')}`);
      }
      if (result.warnings?.length) {
        setWarnings(result.warnings);
      }
    } catch {
      toast.error('Failed to load HR Intelligence Center');
      setViewModel(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    document.title = 'HR Intelligence Center | Hire Staff';
    load();
  }, [load]);

  return (
    <div className="mx-auto max-w-6xl space-y-6 pb-12">
      <div>
        <Link
          to="/hr/journey-center"
          className="mb-3 inline-flex items-center gap-1 text-sm font-medium text-violet-700 hover:underline"
        >
          <ArrowLeft size={14} />
          Back to Hire Staff
        </Link>
        <h1 className="flex items-center gap-2 text-2xl font-bold text-gray-900">
          <BarChart3 size={24} className="text-violet-600" />
          HR Intelligence Center
        </h1>
        <p className="mt-1 text-sm text-gray-600">
          Executive HR analytics from live data — guidance only, no calculation changes.
        </p>
        {month && (
          <p className="mt-1 text-xs text-gray-500">
            Payroll metrics use {monthLabel(month)}. Attendance uses today&apos;s summary.
          </p>
        )}
        {loadErrors.length > 0 && (
          <p className="mt-2 text-xs text-amber-800">
            Partial data: failed to load {loadErrors.join(', ')}. Some panels may be incomplete.
          </p>
        )}
        {warnings.length > 0 && (
          <p className="mt-1 text-xs text-gray-500">{warnings.join('; ')}</p>
        )}
        <button
          type="button"
          onClick={load}
          disabled={loading}
          className="mt-3 inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-semibold text-gray-700 shadow-sm hover:bg-gray-50 disabled:opacity-60"
        >
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          Refresh
        </button>
      </div>

      <CeoKpiStrip kpis={viewModel?.ceoKpis} loading={loading} />

      <WorkforceAnalyticsPanel data={viewModel?.workforce} loading={loading} />
      <HiringAnalyticsPanel data={viewModel?.hiring} loading={loading} />
      <AttendanceAnalyticsPanel data={viewModel?.attendance} loading={loading} />
      <LeaveAnalyticsPanel data={viewModel?.leave} loading={loading} />
      <PayrollAnalyticsPanel data={viewModel?.payroll} loading={loading} />
      <ComplianceAnalyticsPanel data={viewModel?.compliance} loading={loading} />
      <PayrollRiskAnalyticsPanel data={viewModel?.payrollRisk} loading={loading} />

      <p className="text-xs text-gray-500">
        Loads ~12–14 parallel API calls on refresh. Large lists may be capped at 500–1000 rows.
        Metrics are aggregated client-side for navigation guidance — not audited financial reports.
      </p>
    </div>
  );
}
