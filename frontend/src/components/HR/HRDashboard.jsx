import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../../api';
import toast from 'react-hot-toast';
import {
  Briefcase,
  FileSignature,
  UserCheck,
  UserPlus,
  ClipboardList,
  Calendar,
  RefreshCw,
} from 'lucide-react';
import { DashboardMetricSkeleton } from './HRSkeleton';
import { isRecruitmentStageCandidate, normalizeApiList } from '../../hr/recruitmentLifecycle';

function MetricCard({ title, value, icon: Icon, color, onClick, to }) {
  const inner = (
    <>
      <div className="mb-4 flex items-center justify-between">
        <div
          className="flex h-11 w-11 items-center justify-center rounded-lg"
          style={{ backgroundColor: `${color}18`, color }}
        >
          <Icon size={20} />
        </div>
      </div>
      <div className="mb-0.5 text-3xl font-bold tabular-nums text-gray-900">{value}</div>
      <div className="text-sm text-gray-600">{title}</div>
    </>
  );

  if (to) {
    return (
      <Link
        to={to}
        className="block w-full rounded-xl border border-gray-100 bg-white p-6 text-left shadow-sm transition-all hover:border-violet-200 hover:shadow-md"
      >
        {inner}
      </Link>
    );
  }

  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full rounded-xl border border-gray-100 bg-white p-6 text-left shadow-sm transition-all hover:border-violet-200 hover:shadow-md"
    >
      {inner}
    </button>
  );
}

const HRDashboard = ({ theme: _theme }) => {
  const [loading, setLoading] = useState(true);
  const [metrics, setMetrics] = useState({
    total_jobs: 0,
    active_jobs: 0,
    total_candidates: 0,
    interviews_scheduled: 0,
    pending_offers: 0,
    onboarding_pending: 0,
    active_employees: 0,
  });
  const [loadErrors, setLoadErrors] = useState([]);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadErrors([]);

    const settled = await Promise.allSettled([
      api.get('/hr/dashboard/').then((r) => r.data),
      api.get('/hr/job-openings/', { params: { status: 'all' } }).then((r) => r.data),
      api.get('/hr/candidates/', { params: { limit: 1000 } }).then((r) => r.data),
      api.get('/hr/offers/', { params: { limit: 500 } }).then((r) => r.data),
    ]);

    const errLabels = [];
    let kpi = {};
    if (settled[0].status === 'fulfilled') {
      kpi = settled[0].value.kpi || {};
    } else {
      errLabels.push('dashboard KPIs');
    }

    const jobs = settled[1].status === 'fulfilled' ? normalizeApiList(settled[1].value) : [];
    if (settled[1].status === 'rejected') errLabels.push('job openings');

    const candidates = settled[2].status === 'fulfilled' ? normalizeApiList(settled[2].value) : [];
    if (settled[2].status === 'rejected') errLabels.push('candidates');

    const offers = settled[3].status === 'fulfilled' ? normalizeApiList(settled[3].value) : [];
    if (settled[3].status === 'rejected') errLabels.push('offers');

    const recruitmentPool = candidates.filter(isRecruitmentStageCandidate);
    const interviewsScheduled = recruitmentPool.filter(
      (c) =>
        c.status === 'interview'
        || (c.interview_date && c.interview_status === 'pending'),
    ).length;

    const pendingOffers = offers.filter((o) =>
      ['draft', 'created', 'sent'].includes(o.status),
    ).length;

    const totalJobs = jobs.length;
    const activeJobs = jobs.filter(
      (j) => j.status === 'open' && j.is_active !== false && !j.is_archived,
    ).length;

    setMetrics({
      total_jobs: totalJobs,
      active_jobs: activeJobs,
      total_candidates: recruitmentPool.length,
      interviews_scheduled: interviewsScheduled,
      pending_offers: pendingOffers,
      onboarding_pending: Number(kpi.pending_onboarding) || 0,
      active_employees: Number(kpi.active_employees) || 0,
    });

    if (errLabels.length) {
      setLoadErrors(errLabels);
      toast.error(`Some data failed to load: ${errLabels.join(', ')}`);
    }

    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-2 text-sm text-gray-500">
          <RefreshCw className="h-4 w-4 animate-spin text-violet-600" />
          Loading recruitment metrics…
        </div>
        <DashboardMetricSkeleton count={7} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Recruitment dashboard</h1>
        <p className="mt-1 text-sm text-gray-600">
          At-a-glance hiring health. Detailed lists live under Job openings, Candidates, Offers,
          and Joining &amp; onboarding.
        </p>
        {loadErrors.length > 0 && (
          <p className="mt-2 text-xs text-amber-800">
            Partial data: failed to load {loadErrors.join(', ')}. Counts may be low — use Refresh or
            check the network.
          </p>
        )}
        <button
          type="button"
          onClick={load}
          className="mt-3 inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-semibold text-gray-700 shadow-sm hover:bg-gray-50"
        >
          <RefreshCw size={14} />
          Refresh
        </button>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        <MetricCard
          title="Total job postings"
          value={metrics.total_jobs}
          icon={Briefcase}
          color="#6366f1"
          to="/hr/recruitment/jobs"
        />
        <MetricCard
          title="Active jobs"
          value={metrics.active_jobs}
          icon={Briefcase}
          color="#10b981"
          to="/hr/recruitment/jobs"
        />
        <MetricCard
          title="Recruitment candidates"
          value={metrics.total_candidates}
          icon={UserPlus}
          color="#2563eb"
          to="/hr/recruitment/candidates"
        />
        <MetricCard
          title="Interviews scheduled"
          value={metrics.interviews_scheduled}
          icon={Calendar}
          color="#8b5cf6"
          to="/hr/recruitment/candidates"
        />
        <MetricCard
          title="Pending offers"
          value={metrics.pending_offers}
          icon={FileSignature}
          color="#f59e0b"
          to="/hr/recruitment/offers"
        />
        <MetricCard
          title="Onboarding pending"
          value={metrics.onboarding_pending}
          icon={ClipboardList}
          color="#ea580c"
          to="/hr/onboarding/document-verification"
        />
        <MetricCard
          title="Active employees"
          value={metrics.active_employees}
          icon={UserCheck}
          color="#059669"
          to="/hr/employees"
        />
      </div>

      <div className="flex flex-wrap gap-3 rounded-xl border border-gray-100 bg-white p-4 text-sm shadow-sm">
        <span className="font-medium text-gray-700">Next steps:</span>
        <Link className="font-semibold text-violet-700 hover:underline" to="/hr/recruitment/jobs">
          Manage jobs
        </Link>
        <span className="text-gray-300">·</span>
        <Link className="font-semibold text-violet-700 hover:underline" to="/hr/onboarding/document-verification">
          Joining &amp; onboarding
        </Link>
        <span className="text-gray-300">·</span>
        <Link className="font-semibold text-violet-700 hover:underline" to="/hr/employees">
          Directory
        </Link>
      </div>
    </div>
  );
};

export default HRDashboard;
