import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import {
  ChevronLeft,
  ChevronRight,
  FileText,
  RefreshCw,
  Search,
  Send,
  Sparkles,
} from 'lucide-react';
import api, { payrollApi } from '../../../api';
import { monthKey } from '../../../utils/attendanceCalendar';
import { TableSkeleton } from '../../../components/HR/HRSkeleton';
import JourneyJobFilter from '../JourneyJobFilter';
import { BackToEmployeeLink } from '../employeeDetail/EmployeeDetailUi';
import {
  formatCurrency,
  monthLabel,
  normalizePayrollList,
  payrollErrorText,
} from './payrollUtils';

function payslipStatus(row) {
  if (row.status === 'PUBLISHED') {
    return { text: 'Sent', className: 'bg-emerald-100 text-emerald-800', step: 'done' };
  }
  if (row.status === 'APPROVED' || row.status === 'FINALIZED') {
    return { text: 'Lock pay first', className: 'bg-orange-100 text-orange-800', step: 'lock' };
  }
  if (row.status === 'LOCKED' && row.has_payslip) {
    return { text: 'Ready to send', className: 'bg-blue-100 text-blue-800', step: 'send' };
  }
  if (row.status === 'LOCKED' && !row.has_payslip) {
    return { text: 'Make PDF', className: 'bg-amber-100 text-amber-800', step: 'pdf' };
  }
  return { text: 'Not ready', className: 'bg-slate-100 text-slate-600', step: 'wait' };
}

function nextStepHint(row) {
  if (!row) return '';
  const status = payslipStatus(row);
  if (status.step === 'done') return 'Employee can view this payslip in their portal.';
  if (status.step === 'lock') return 'Approve and lock pay on Payroll Runs before creating a PDF.';
  if (status.step === 'send') return 'PDF is ready — send it to the employee portal.';
  if (status.step === 'pdf') return 'Create the payslip PDF, then send to the employee.';
  return 'Complete payroll approval and lock pay first.';
}

function matchesFilter(row, filter) {
  const status = payslipStatus(row);
  if (filter === 'need_pdf') return status.step === 'pdf';
  if (filter === 'ready') return status.step === 'send';
  if (filter === 'sent') return status.step === 'done';
  if (filter === 'todo') return status.step !== 'done';
  return true;
}

function needsAttention(row) {
  return payslipStatus(row).step !== 'done';
}

export default function PayrollPayslipsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const jobOpening = searchParams.get('job_opening') || '';
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [month, setMonth] = useState(monthKey());
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');
  const [runs, setRuns] = useState([]);
  const [selectedId, setSelectedId] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = { month };
      if (jobOpening) params.job_opening = jobOpening;
      const { data } = await payrollApi.get('/runs/', { params });
      const list = normalizePayrollList(data).filter((row) =>
        ['LOCKED', 'PUBLISHED', 'APPROVED', 'FINALIZED'].includes(row.status),
      );
      setRuns(list);
    } catch {
      toast.error('Could not load payslips');
      setRuns([]);
    } finally {
      setLoading(false);
    }
  }, [month, jobOpening]);

  useEffect(() => {
    document.title = 'Payslips | HR Payroll';
    load();
  }, [load]);

  const stats = useMemo(() => {
    const sent = runs.filter((r) => r.status === 'PUBLISHED').length;
    const ready = runs.filter((r) => r.status === 'LOCKED' && r.has_payslip).length;
    const needPdf = runs.filter((r) => r.status === 'LOCKED' && !r.has_payslip).length;
    const needLock = runs.filter((r) => ['APPROVED', 'FINALIZED'].includes(r.status)).length;
    return { total: runs.length, sent, ready, needPdf, needLock };
  }, [runs]);

  const filteredRuns = useMemo(() => {
    let list = runs.filter((row) => matchesFilter(row, filter));
    const q = search.trim().toLowerCase();
    if (!q) return list;
    return list.filter(
      (row) =>
        (row.employee_name || '').toLowerCase().includes(q)
        || (row.employee_code || '').toLowerCase().includes(q),
    );
  }, [runs, search, filter]);

  const selected = useMemo(
    () => runs.find((row) => row.id === selectedId) || null,
    [runs, selectedId],
  );

  useEffect(() => {
    setSelectedId(null);
  }, [month, filter, search]);

  useEffect(() => {
    if (loading || selectedId) return;
    const first = filteredRuns.find(needsAttention) || filteredRuns[0];
    if (first) setSelectedId(first.id);
  }, [filteredRuns, loading, selectedId]);

  function shiftMonth(delta) {
    const [year, mon] = month.split('-').map(Number);
    const dt = new Date(year, mon - 1 + delta, 1);
    setMonth(monthKey(dt));
  }

  async function generateOne(run) {
    if (run.status !== 'LOCKED') {
      toast.error('Lock this employee\'s pay first');
      return;
    }
    setGenerating(run.id);
    try {
      await api.post(`/hr/payroll-runs/${run.id}/generate-payslip/`);
      toast.success(`PDF ready for ${run.employee_name}`);
      await load();
    } catch (error) {
      toast.error(payrollErrorText(error, 'Could not make PDF'));
    } finally {
      setGenerating(false);
    }
  }

  async function publishOne(run) {
    if (run.status !== 'LOCKED' || !run.has_payslip) {
      toast.error('Make the PDF first, then send');
      return;
    }
    setPublishing(run.id);
    try {
      await api.post(`/hr/payroll-runs/${run.id}/publish/`);
      toast.success(`Sent to ${run.employee_name}`);
      await load();
    } catch (error) {
      toast.error(payrollErrorText(error, 'Could not send payslip'));
    } finally {
      setPublishing(false);
    }
  }

  async function generateBatch() {
    if (generating) return;
    setGenerating('batch');
    try {
      const { data } = await api.post('/hr/payroll-runs/generate-payslips/', { month });
      const count = (data.created || []).length;
      if (count > 0) {
        toast.success(`PDFs created for ${count} employee${count === 1 ? '' : 's'}`);
      } else {
        toast('No new PDFs needed — everyone locked already has one or pay is not locked yet', { icon: 'ℹ️' });
      }
      await load();
    } catch (error) {
      toast.error(payrollErrorText(error, 'Could not make PDFs'));
    } finally {
      setGenerating(false);
    }
  }

  async function publishBatch() {
    const pending = runs.filter((row) => row.status === 'LOCKED' && row.has_payslip);
    if (!pending.length) {
      toast.error('No payslips ready to send — make PDFs first');
      return;
    }
    if (
      !window.confirm(
        `Send ${pending.length} payslip${pending.length === 1 ? '' : 's'} to the employee portal?`,
      )
    ) {
      return;
    }
    setPublishing('batch');
    let ok = 0;
    try {
      for (const row of pending) {
        try {
          await api.post(`/hr/payroll-runs/${row.id}/publish/`);
          ok += 1;
        } catch (error) {
          toast.error(`${row.employee_name}: ${payrollErrorText(error, 'Send failed')}`);
        }
      }
      if (ok) toast.success(`Sent ${ok} payslip${ok === 1 ? '' : 's'} to employees`);
      await load();
    } finally {
      setPublishing(false);
    }
  }

  const selectedStatus = selected ? payslipStatus(selected) : null;
  const isGeneratingSelected = generating === selected?.id;
  const isPublishingSelected = publishing === selected?.id;

  function handleJobChange(nextJobId) {
    const params = new URLSearchParams(searchParams);
    if (nextJobId) params.set('job_opening', nextJobId);
    else params.delete('job_opening');
    setSearchParams(params, { replace: true });
  }

  return (
    <div className="mx-auto max-w-6xl space-y-5 pb-12">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <BackToEmployeeLink />
          <h1 className="flex items-center gap-2 text-2xl font-bold text-slate-900">
            <FileText className="text-violet-600" size={24} />
            Payslips
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            Create PDF payslips and send them to employees after pay is locked.
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
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <p className="text-sm text-slate-600">
            Lock pay on{' '}
            <Link to="/hr/payroll/runs" className="font-semibold text-violet-700 hover:underline">
              Payroll Runs
            </Link>
            {' '}first, then make PDFs and send to the employee portal.
          </p>
          <div className="flex flex-col gap-2 sm:flex-row">
            <button
              type="button"
              onClick={generateBatch}
              disabled={!!generating || !!publishing}
              className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl bg-violet-600 px-4 text-sm font-semibold text-white hover:bg-violet-700 disabled:opacity-60"
            >
              <Sparkles size={16} />
              {generating === 'batch' ? 'Making PDFs…' : 'Make all PDFs'}
            </button>
            <button
              type="button"
              onClick={publishBatch}
              disabled={!!generating || !!publishing || stats.ready === 0}
              className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-60"
            >
              <Send size={16} />
              {publishing === 'batch' ? 'Sending…' : `Send all (${stats.ready})`}
            </button>
          </div>
        </div>
      </section>

      {!loading && runs.length === 0 && (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-10 text-center">
          <FileText className="mx-auto h-10 w-10 text-slate-300" />
          <p className="mt-3 font-semibold text-slate-900">Nothing ready for {monthLabel(month)}</p>
          <p className="mt-1 text-sm text-slate-600">
            Go to{' '}
            <Link to="/hr/payroll/runs" className="font-semibold text-violet-700 hover:underline">
              Payroll Runs
            </Link>
            , calculate pay, approve, and lock each employee first.
          </p>
        </div>
      )}

      {(loading || runs.length > 0) && (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {[
              { id: 'all', label: 'Employees', value: stats.total, tone: 'bg-slate-50 border-slate-200 text-slate-900' },
              { id: 'need_pdf', label: 'Need PDF', value: stats.needPdf, tone: 'bg-amber-50 border-amber-200 text-amber-900' },
              { id: 'ready', label: 'Ready to send', value: stats.ready, tone: 'bg-blue-50 border-blue-200 text-blue-900' },
              { id: 'sent', label: 'Sent', value: stats.sent, tone: 'bg-emerald-50 border-emerald-200 text-emerald-900' },
            ].map((card) => (
              <button
                key={card.id}
                type="button"
                onClick={() => setFilter(card.id)}
                className={`rounded-2xl border px-4 py-3 text-left transition ${
                  filter === card.id
                    ? `${card.tone} ring-2 ring-violet-200`
                    : `${card.tone} opacity-90 hover:opacity-100`
                }`}
              >
                <p className="text-2xl font-bold">{card.value}</p>
                <p className="mt-0.5 text-sm font-medium">{card.label}</p>
              </button>
            ))}
          </div>

          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
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
                  <TableSkeleton rows={6} cols={1} />
                </div>
              ) : filteredRuns.length === 0 ? (
                <p className="px-4 py-10 text-center text-sm text-slate-500">No employees match your search or filter.</p>
              ) : (
                <ul className="max-h-[32rem] divide-y divide-slate-100 overflow-y-auto">
                  {filteredRuns.map((row) => {
                    const selectedRow = selectedId === row.id;
                    const status = payslipStatus(row);
                    return (
                      <li key={row.id}>
                        <button
                          type="button"
                          onClick={() => setSelectedId(row.id)}
                          className={`flex w-full items-center gap-3 px-4 py-3 text-left transition ${
                            selectedRow ? 'bg-violet-50' : 'hover:bg-slate-50'
                          }`}
                        >
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <p className="font-semibold text-slate-900">{row.employee_name || '—'}</p>
                              <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${status.className}`}>
                                {status.text}
                              </span>
                            </div>
                            <p className="text-xs text-slate-500">{row.employee_code || '—'}</p>
                            <p className="mt-0.5 text-sm font-medium text-violet-800">
                              {formatCurrency(row.final_salary)}
                            </p>
                          </div>
                          <ChevronRight size={16} className={`shrink-0 ${selectedRow ? 'text-violet-500' : 'text-slate-300'}`} />
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>

            <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              {!selected ? (
                <div className="flex min-h-[20rem] flex-col items-center justify-center text-center text-sm text-slate-500">
                  <FileText className="mb-3 h-10 w-10 text-slate-300" />
                  Select an employee to manage their payslip for {monthLabel(month)}.
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="border-b border-slate-100 pb-4">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <h2 className="text-lg font-bold text-slate-900">{selected.employee_name}</h2>
                        <p className="text-sm text-slate-600">{selected.employee_code || '—'}</p>
                      </div>
                      {selectedStatus && (
                        <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${selectedStatus.className}`}>
                          {selectedStatus.text}
                        </span>
                      )}
                    </div>
                    <p className="mt-3 text-2xl font-bold text-slate-900">
                      {formatCurrency(selected.final_salary)}
                      <span className="ml-1 text-sm font-normal text-slate-500">net pay</span>
                    </p>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div className="rounded-xl bg-slate-50 px-3 py-2.5 text-center">
                      <p className="text-sm font-bold text-slate-900">{selected.has_payslip ? 'Yes' : 'No'}</p>
                      <p className="text-xs text-slate-500">PDF created</p>
                    </div>
                    <div className="rounded-xl bg-slate-50 px-3 py-2.5 text-center">
                      <p className="text-sm font-bold text-slate-900">
                        {selected.status === 'PUBLISHED' ? 'Sent' : 'Pending'}
                      </p>
                      <p className="text-xs text-slate-500">Portal delivery</p>
                    </div>
                  </div>

                  <div className="rounded-xl bg-violet-50 px-3 py-2.5 text-sm text-violet-900">
                    <span className="font-semibold">Next:</span> {nextStepHint(selected)}
                  </div>

                  {selectedStatus?.step === 'lock' && (
                    <Link
                      to={`/hr/payroll/runs/${selected.id}`}
                      className="flex w-full min-h-[48px] items-center justify-center rounded-xl border border-orange-200 bg-orange-50 text-sm font-semibold text-orange-900 hover:bg-orange-100"
                    >
                      Lock pay on Payroll Runs
                    </Link>
                  )}

                  {selectedStatus?.step === 'pdf' && (
                    <button
                      type="button"
                      onClick={() => generateOne(selected)}
                      disabled={isGeneratingSelected}
                      className="flex w-full min-h-[48px] items-center justify-center gap-2 rounded-xl bg-violet-600 text-sm font-semibold text-white hover:bg-violet-700 disabled:opacity-60"
                    >
                      <Sparkles size={16} />
                      {isGeneratingSelected ? 'Making PDF…' : 'Make PDF'}
                    </button>
                  )}

                  {selectedStatus?.step === 'send' && (
                    <button
                      type="button"
                      onClick={() => publishOne(selected)}
                      disabled={isPublishingSelected}
                      className="flex w-full min-h-[48px] items-center justify-center gap-2 rounded-xl bg-emerald-600 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-60"
                    >
                      <Send size={16} />
                      {isPublishingSelected ? 'Sending…' : 'Send to employee'}
                    </button>
                  )}

                  {selectedStatus?.step === 'done' && (
                    <div className="rounded-xl border border-emerald-100 bg-emerald-50 px-3 py-3 text-center text-sm font-medium text-emerald-800">
                      Payslip delivered — visible in employee portal
                    </div>
                  )}

                  <Link
                    to={`/hr/payroll/runs/${selected.id}`}
                    className="block text-center text-sm font-semibold text-violet-700 hover:underline"
                  >
                    Open payroll review
                  </Link>
                </div>
              )}
            </section>
          </div>
        </>
      )}
    </div>
  );
}
