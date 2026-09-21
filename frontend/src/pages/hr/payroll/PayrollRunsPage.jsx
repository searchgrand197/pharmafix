import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import {
  ChevronLeft,
  ChevronRight,
  Play,
  RefreshCw,
  Search,
  Wallet,
} from 'lucide-react';
import api, { payrollApi } from '../../../api';
import { monthKey } from '../../../utils/attendanceCalendar';
import { TableSkeleton } from '../../../components/HR/HRSkeleton';
import JourneyJobFilter from '../JourneyJobFilter';
import { BackToEmployeeLink } from '../employeeDetail/EmployeeDetailUi';
import PayrollFlowSteps from './PayrollFlowSteps';
import {
  formatCurrency,
  monthLabel,
  normalizePayrollList,
  normalizePayrollRunIssues,
  PAYROLL_STATUS_BADGE,
  payrollErrorText,
} from './payrollUtils';

const TABLE_STATUS = {
  DRAFT: 'Needs review',
  CALCULATED: 'Needs review',
  UNDER_REVIEW: 'Needs review',
  APPROVED: 'Approve done — lock on review page',
  FINALIZED: 'Approve done — lock on review page',
  LOCKED: 'Ready for payslip',
  PUBLISHED: 'Sent',
};

function needsAction(status) {
  return ['DRAFT', 'CALCULATED', 'UNDER_REVIEW', 'APPROVED', 'FINALIZED'].includes(status);
}

function tableStatusLabel(status) {
  return TABLE_STATUS[status] || status;
}

function buildSummaryLine({ stats, readiness, issueCount }) {
  const parts = [`${stats.total} employee${stats.total === 1 ? '' : 's'}`];
  if (stats.action > 0) {
    parts.push(`${stats.action} need review`);
  }
  if (issueCount > 0) {
    parts.push(`${issueCount} could not be included`);
  }
  if (stats.total > 0) {
    parts.push(`${formatCurrency(stats.totalNet)} total payout`);
  } else if (readiness?.next_action === 'calculate_payroll') {
    parts.push('ready to run payroll');
  } else if (readiness?.next_action === 'finalize_attendance') {
    parts.push('attendance recorded — run payroll to close the month');
  } else if (readiness?.next_action === 'none' && stats.done > 0) {
    parts.push('all sent');
  }
  return parts.join(' · ');
}

export default function PayrollRunsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const monthFromUrl = searchParams.get('month');
  const jobOpening = searchParams.get('job_opening') || '';
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [month, setMonth] = useState(() => (
    monthFromUrl && /^\d{4}-\d{2}$/.test(monthFromUrl) ? monthFromUrl : monthKey()
  ));
  const [search, setSearch] = useState('');
  const [runs, setRuns] = useState([]);
  const [readiness, setReadiness] = useState(null);
  const [runIssues, setRunIssues] = useState([]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const runParams = { month };
      if (jobOpening) runParams.job_opening = jobOpening;
      const [runResult, readinessResult] = await Promise.allSettled([
        payrollApi.get('/runs/', { params: runParams }),
        api.get('/hr/payroll-month-readiness/', { params: { month } }),
      ]);

      if (runResult.status === 'fulfilled') {
        setRuns(normalizePayrollList(runResult.value.data));
      } else {
        toast.error('Could not load payroll runs');
        setRuns([]);
      }

      if (readinessResult.status === 'fulfilled') {
        setReadiness(readinessResult.value.data || null);
      } else {
        setReadiness(null);
      }
    } catch {
      toast.error('Could not load payroll');
      setRuns([]);
      setReadiness(null);
    } finally {
      setLoading(false);
    }
  }, [month, jobOpening]);

  useEffect(() => {
    document.title = 'Payroll Runs | HR Payroll';
    load();
  }, [load]);

  useEffect(() => {
    if (!monthFromUrl || !/^\d{4}-\d{2}$/.test(monthFromUrl)) return;
    if (monthFromUrl !== month) setMonth(monthFromUrl);
  }, [monthFromUrl, month]);

  useEffect(() => {
    setRunIssues([]);
  }, [month, jobOpening]);

  const stats = useMemo(() => {
    const actionCount = runs.filter((r) => needsAction(r.status)).length;
    const doneCount = runs.filter((r) => ['LOCKED', 'PUBLISHED'].includes(r.status)).length;
    const totalNet = runs.reduce((sum, row) => sum + Number(row.final_salary || 0), 0);
    return {
      total: runs.length,
      action: actionCount,
      done: doneCount,
      totalNet,
    };
  }, [runs]);

  const summaryLine = useMemo(
    () => buildSummaryLine({ stats, readiness, issueCount: runIssues.length }),
    [stats, readiness, runIssues.length],
  );

  const filteredRuns = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return runs;
    return runs.filter(
      (row) =>
        (row.employee_name || '').toLowerCase().includes(q)
        || (row.employee_code || '').toLowerCase().includes(q),
    );
  }, [runs, search]);

  function shiftMonth(delta) {
    const [year, mon] = month.split('-').map(Number);
    const dt = new Date(year, mon - 1 + delta, 1);
    setMonth(monthKey(dt));
  }

  async function runPayroll() {
    if (generating) return;
    const label = monthLabel(month);
    if (
      !window.confirm(
        `Run payroll for ${label}?\n\nPay will be calculated for all eligible employees. Attendance for this month will be closed automatically.`,
      )
    ) {
      return;
    }
    setGenerating(true);
    try {
      const { data } = await payrollApi.post('/run/', { month });
      const created = data.created_count || 0;
      const recalculated = data.recalculated_count || 0;
      const skipped = data.skipped?.length || 0;
      const errors = data.errors?.length || 0;
      const issues = normalizePayrollRunIssues(data.skipped, data.errors);
      setRunIssues(issues);

      let toastMessage = '';
      if (data.attendance_auto_finalized) {
        const rows = data.attendance_finalization?.rows_finalized || 0;
        toastMessage = `Attendance closed (${rows} row${rows === 1 ? '' : 's'}) and payroll calculated`;
      } else if (created > 0 && recalculated > 0) {
        toastMessage = `Pay calculated for ${created} employee${created === 1 ? '' : 's'}, refreshed ${recalculated} draft run${recalculated === 1 ? '' : 's'}`;
      } else if (created > 0) {
        toastMessage = `Pay calculated for ${created} employee${created === 1 ? '' : 's'}`;
      } else if (recalculated > 0) {
        toastMessage = `Refreshed ${recalculated} draft payroll run${recalculated === 1 ? '' : 's'}`;
      } else if (skipped > 0 && errors === 0) {
        toast('All payroll for this month is already locked or approved', { icon: 'ℹ️' });
      } else {
        toastMessage = 'Payroll run finished';
      }

      if (toastMessage) {
        if (issues.length > 0) {
          toastMessage += ` — ${issues.length} employee${issues.length === 1 ? '' : 's'} could not be included (see list below)`;
        }
        toast.success(toastMessage);
      } else if (issues.length > 0) {
        toast(`${issues.length} employee${issues.length === 1 ? '' : 's'} could not be included — see list below`, { icon: '⚠️' });
      }
      await load();
    } catch (error) {
      toast.error(payrollErrorText(error, 'Could not run payroll'));
    } finally {
      setGenerating(false);
    }
  }

  function handleJobChange(nextJobId) {
    const params = new URLSearchParams(searchParams);
    if (nextJobId) params.set('job_opening', nextJobId);
    else params.delete('job_opening');
    setSearchParams(params, { replace: true });
  }

  return (
    <div className="mx-auto max-w-6xl space-y-5 pb-12">
      <PayrollFlowSteps currentStep={2} />

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <BackToEmployeeLink />
          <h1 className="flex items-center gap-2 text-2xl font-bold text-slate-900">
            <Wallet className="text-violet-600" size={24} />
            Monthly payroll
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            Run payroll for the month, then review each employee.
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <JourneyJobFilter value={jobOpening} onChange={handleJobChange} />
          <div className="flex items-center rounded-xl border border-slate-200 bg-white">
            <button
              type="button"
              onClick={() => shiftMonth(-1)}
              className="rounded-l-xl p-2.5 text-slate-600 hover:bg-slate-50"
              aria-label="Previous month"
            >
              <ChevronLeft size={18} />
            </button>
            <span className="min-w-[130px] px-2 text-center text-sm font-bold text-slate-900">
              {monthLabel(month)}
            </span>
            <button
              type="button"
              onClick={() => shiftMonth(1)}
              className="rounded-r-xl p-2.5 text-slate-600 hover:bg-slate-50"
              aria-label="Next month"
            >
              <ChevronRight size={18} />
            </button>
          </div>
          <button
            type="button"
            onClick={load}
            className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            <RefreshCw size={14} />
            Refresh
          </button>
        </div>
      </div>

      <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm font-medium text-slate-700">{summaryLine}</p>
          <button
            type="button"
            onClick={runPayroll}
            disabled={generating}
            className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl bg-violet-600 px-5 text-sm font-semibold text-white hover:bg-violet-700 disabled:opacity-60"
          >
            <Play size={16} />
            {generating ? 'Running payroll…' : `Run payroll for ${monthLabel(month)}`}
          </button>
        </div>
      </section>

      {runIssues.length > 0 && (
        <section className="rounded-2xl border border-amber-200 bg-amber-50 p-4 shadow-sm">
          <h2 className="text-sm font-bold text-amber-950">Could not include in payroll</h2>
          <p className="mt-1 text-xs text-amber-900">
            These employees were skipped when payroll ran for {monthLabel(month)}.
          </p>
          <ul className="mt-3 divide-y divide-amber-200/80 rounded-xl border border-amber-200 bg-white">
            {runIssues.map((issue) => (
              <li key={issue.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5 text-sm">
                <div className="min-w-0">
                  <span className="font-semibold text-slate-900">{issue.employeeId}</span>
                  <span className="text-slate-600"> — {issue.label}</span>
                </div>
                {issue.fixLink && (
                  <Link
                    to={issue.fixLink}
                    className="shrink-0 font-semibold text-violet-700 hover:underline"
                  >
                    Fix
                  </Link>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {!loading && runs.length === 0 && (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-10 text-center">
          <Wallet className="mx-auto h-10 w-10 text-slate-300" />
          <p className="mt-3 font-semibold text-slate-900">No pay calculated for {monthLabel(month)}</p>
          <p className="mt-1 text-sm text-slate-600">
            Set up{' '}
            <Link to="/hr/payroll/compensation-levels" className="font-semibold text-violet-700 hover:underline">
              compensation levels
            </Link>
            , then click Run payroll.
          </p>
        </div>
      )}

      {(loading || runs.length > 0) && (
        <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-100 p-3">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
              <input
                type="search"
                placeholder="Search employees…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full rounded-xl border border-slate-200 py-2.5 pl-9 pr-3 text-sm outline-none focus:border-violet-400"
              />
            </div>
          </div>

          {loading ? (
            <div className="p-4">
              <TableSkeleton rows={6} cols={5} />
            </div>
          ) : filteredRuns.length === 0 ? (
            <p className="px-4 py-10 text-center text-sm text-slate-500">No employees match your search.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-left text-sm">
                <thead className="border-b border-slate-100 bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-4 py-3">Employee</th>
                    <th className="px-4 py-3">Code</th>
                    <th className="px-4 py-3">Net pay</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredRuns.map((row) => {
                    const statusLabel = tableStatusLabel(row.status);
                    return (
                      <tr key={row.id} className="hover:bg-slate-50">
                        <td className="px-4 py-3 font-semibold text-slate-900">{row.employee_name || '—'}</td>
                        <td className="px-4 py-3 text-slate-600">{row.employee_code || '—'}</td>
                        <td className="px-4 py-3 font-medium text-violet-800">{formatCurrency(row.final_salary)}</td>
                        <td className="px-4 py-3">
                          <span
                            className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                              PAYROLL_STATUS_BADGE[row.status] || PAYROLL_STATUS_BADGE.DRAFT
                            }`}
                          >
                            {statusLabel}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <Link
                            to={`/hr/payroll/runs/${row.id}`}
                            className="inline-flex items-center gap-1 font-semibold text-violet-700 hover:underline"
                          >
                            Review
                            <ChevronRight size={14} />
                          </Link>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
