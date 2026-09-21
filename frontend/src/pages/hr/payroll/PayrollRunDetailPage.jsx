import React, { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import {
  ArrowLeft,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronDown,
  FileText,
  Lock,
  RefreshCw,
  Send,
  User,
  Wallet,
} from 'lucide-react';
import api, { payrollApi } from '../../../api';
import { TableSkeleton } from '../../../components/HR/HRSkeleton';
import {
  formatCompliancePolicySummary,
  formatCurrency,
  formatDecimal,
  flattenPayrollBreakdown,
  monthLabel,
  PAYROLL_STATUS_LABEL,
  payrollErrorText,
  payrollRunWorkflow,
} from './payrollUtils';

function LineItem({ label, value, tone = 'default' }) {
  const valueClass =
    tone === 'deduction'
      ? 'text-red-700'
      : tone === 'total'
        ? 'text-lg font-bold text-gray-900'
        : 'font-semibold text-gray-900';
  return (
    <div className="flex items-center justify-between gap-3 border-b border-gray-50 py-2.5 last:border-0">
      <span className="text-sm capitalize text-gray-600">{label.replace(/_/g, ' ')}</span>
      <span className={`text-sm ${valueClass}`}>{formatCurrency(value)}</span>
    </div>
  );
}

function StatPill({ label, value }) {
  return (
    <div className="rounded-xl border border-white/20 bg-white/10 px-3 py-2.5 text-center backdrop-blur-sm">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-white/70">{label}</p>
      <p className="mt-0.5 text-lg font-bold text-white">{formatDecimal(value)}</p>
    </div>
  );
}

function WorkflowStepper({ run, acting, onApprove, onLock, onGeneratePayslip, onPublish }) {
  const { completed, steps, isComplete } = payrollRunWorkflow(run);
  const canApprove = ['DRAFT', 'CALCULATED', 'UNDER_REVIEW'].includes(run.status);
  const canLock = ['APPROVED', 'FINALIZED'].includes(run.status);
  const canGeneratePayslip = run.status === 'LOCKED' && !run.has_payslip;
  const canPublish = run.status === 'LOCKED' && run.has_payslip;

  const actionMap = {
    approve: { label: 'Approve payroll', icon: CheckCircle2, handler: onApprove, loading: acting === 'approve', show: canApprove },
    lock: { label: 'Lock payroll', icon: Lock, handler: onLock, loading: acting === 'lock', show: canLock },
    payslip: { label: 'Generate payslip', icon: FileText, handler: onGeneratePayslip, loading: acting === 'payslip', show: canGeneratePayslip },
    publish: { label: 'Publish to employee', icon: Send, handler: onPublish, loading: acting === 'publish', show: canPublish },
  };
  const nextAction = Object.values(actionMap).find((a) => a.show);

  return (
    <section className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm sm:p-5">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <ol className="flex flex-1 flex-wrap items-center gap-1 sm:gap-0">
          {steps.map((s, i) => {
            const done = i < completed;
            const active = i === completed && !isComplete;
            return (
              <li key={s.id} className="flex items-center">
                <div className="flex items-center gap-2">
                  <span
                    className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                      done
                        ? 'bg-emerald-500 text-white'
                        : active
                          ? 'bg-purple-600 text-white ring-4 ring-purple-100'
                          : 'bg-gray-100 text-gray-400'
                    }`}
                  >
                    {done ? <Check size={14} /> : i + 1}
                  </span>
                  <div className="hidden min-w-0 sm:block">
                    <p className={`text-xs font-semibold ${active ? 'text-purple-900' : done ? 'text-gray-800' : 'text-gray-400'}`}>
                      {s.label}
                    </p>
                    <p className="text-[10px] text-gray-500">{s.hint}</p>
                  </div>
                </div>
                {i < steps.length - 1 && (
                  <div className={`mx-2 hidden h-0.5 w-6 sm:block lg:w-10 ${done ? 'bg-emerald-300' : 'bg-gray-200'}`} />
                )}
              </li>
            );
          })}
        </ol>

        {nextAction ? (
          <button
            type="button"
            onClick={nextAction.handler}
            disabled={!!acting}
            className="inline-flex min-h-[44px] shrink-0 items-center justify-center gap-2 rounded-xl bg-purple-600 px-5 text-sm font-semibold text-white hover:bg-purple-700 disabled:opacity-60"
          >
            <nextAction.icon size={16} />
            {nextAction.loading ? 'Working…' : nextAction.label}
          </button>
        ) : isComplete ? (
          <span className="inline-flex items-center gap-2 rounded-xl bg-emerald-50 px-4 py-2.5 text-sm font-semibold text-emerald-800">
            <CheckCircle2 size={16} /> Published to employee portal
          </span>
        ) : null}
      </div>
    </section>
  );
}

function CalculationDetails({ snapshot, run }) {
  const [open, setOpen] = useState(false);
  const fields = [
    { label: 'Per-day salary', value: formatCurrency(snapshot.per_day_salary) },
    { label: 'Working days', value: snapshot.working_days ?? '—' },
    { label: 'Paid leave days', value: snapshot.paid_leave_days ?? '—' },
    { label: 'Unpaid leave days', value: snapshot.unpaid_leave_days ?? '—' },
    { label: 'Has payslip', value: run.has_payslip ? 'Yes' : 'No' },
  ];

  return (
    <section className="rounded-2xl border border-gray-200 bg-white shadow-sm">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between px-4 py-3 text-left text-sm font-semibold text-gray-700 hover:bg-gray-50"
      >
        Calculation details
        <ChevronDown size={18} className={`text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <dl className="grid gap-3 border-t border-gray-100 px-4 py-4 text-sm sm:grid-cols-2">
          {fields.map((f) => (
            <div key={f.label}>
              <dt className="text-gray-500">{f.label}</dt>
              <dd className="font-semibold text-gray-900">{f.value}</dd>
            </div>
          ))}
        </dl>
      )}
    </section>
  );
}

export default function PayrollRunDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState('');
  const [run, setRun] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await payrollApi.get(`/run/${id}/`);
      setRun(data);
    } catch {
      toast.error('Failed to load payroll run');
      setRun(null);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    document.title = 'Payroll Run Detail | HR Payroll';
    load();
  }, [load]);

  async function approveRun() {
    if (acting || !run) return;
    setActing('approve');
    try {
      const { data } = await payrollApi.post(`/run/${run.id}/approve/`);
      setRun(data);
      toast.success('Payroll approved');
    } catch (error) {
      toast.error(payrollErrorText(error, 'Failed to approve payroll'));
    } finally {
      setActing('');
    }
  }

  async function lockRun() {
    if (acting || !run) return;
    if (!window.confirm('Lock this payroll? Payslip generation requires a locked run.')) return;
    setActing('lock');
    try {
      const { data } = await payrollApi.post(`/run/${run.id}/lock/`);
      setRun(data);
      toast.success('Payroll locked');
    } catch (error) {
      toast.error(payrollErrorText(error, 'Failed to lock payroll'));
    } finally {
      setActing('');
    }
  }

  async function generatePayslip() {
    if (acting || !run) return;
    setActing('payslip');
    try {
      await api.post(`/hr/payroll-runs/${run.id}/generate-payslip/`);
      toast.success('Payslip generated');
      await load();
    } catch (error) {
      toast.error(payrollErrorText(error, 'Failed to generate payslip'));
    } finally {
      setActing('');
    }
  }

  async function recalculateRun() {
    if (acting || !run) return;
    if (!window.confirm('Recalculate this payroll from current attendance and salary structure?')) return;
    setActing('recalculate');
    try {
      const { data } = await payrollApi.post(`/run/${run.id}/recalculate/`);
      setRun(data);
      toast.success('Payroll recalculated with latest attendance');
    } catch (error) {
      toast.error(payrollErrorText(error, 'Failed to recalculate payroll'));
    } finally {
      setActing('');
    }
  }

  async function publishPayroll() {
    if (acting || !run) return;
    if (!window.confirm('Publish payslip to the employee portal? The employee will be able to view and download it.')) return;
    setActing('publish');
    try {
      const { data } = await payrollApi.post(`/run/${run.id}/publish/`);
      setRun(data);
      toast.success('Payslip published — visible in employee portal');
    } catch (error) {
      toast.error(payrollErrorText(error, 'Failed to publish payslip'));
    } finally {
      setActing('');
    }
  }

  if (loading) {
    return (
      <div className="mx-auto max-w-3xl space-y-4">
        <div className="h-8 w-40 animate-pulse rounded bg-gray-100" />
        <div className="h-44 animate-pulse rounded-2xl bg-gray-100" />
        <div className="h-24 animate-pulse rounded-2xl bg-gray-100" />
        <TableSkeleton rows={6} cols={2} />
      </div>
    );
  }

  if (!run) {
    return (
      <div className="mx-auto max-w-3xl rounded-2xl border border-gray-200 bg-white p-8 text-center">
        <p className="text-gray-600">Payroll run not found.</p>
        <Link to="/hr/payroll/runs" className="mt-4 inline-block text-sm font-semibold text-purple-600">
          ← Back to payroll runs
        </Link>
      </div>
    );
  }

  const snapshot = run.calculation_snapshot || {};
  const compliance = snapshot.compliance || {};
  const earnings = snapshot.earnings_breakdown || {};
  const deductions = snapshot.deductions_breakdown || {};
  const warnings = snapshot.warnings || [];
  const complianceWarnings = compliance.warnings || snapshot.compliance_warnings || [];
  const attendance = run.attendance_summary || snapshot.attendance_summary || {};
  const hasNoAttendanceWarning = warnings.some((w) =>
    String(w).toLowerCase().includes('no attendance data'),
  );
  const isStaleAttendance =
    (['DRAFT', 'UNDER_REVIEW'].includes(run.status) &&
      (!snapshot.attendance_summary || hasNoAttendanceWarning));
  const canRecalculate = ['DRAFT', 'UNDER_REVIEW'].includes(run.status);
  const earningsRows = flattenPayrollBreakdown(earnings);
  const deductionsRows = flattenPayrollBreakdown(deductions);
  const statusLabel = PAYROLL_STATUS_LABEL[run.status] || run.status;

  const attendanceStats = [
    { label: 'Present', value: attendance.present_days ?? run.total_present_days },
    { label: 'Absent', value: attendance.absent_days ?? run.total_absent_days },
    { label: 'Leave', value: attendance.leave_days ?? run.total_leave_days },
    { label: 'Holiday', value: attendance.holiday_days },
    { label: 'Late', value: attendance.late_days },
    { label: 'OT hours (attendance)', value: attendance.overtime_hours ?? run.overtime_hours },
    {
      label: 'OT rate (salary)',
      value: formatCurrency(snapshot.overtime_rate ?? compliance.effective_ot_rate ?? 0),
      isText: true,
    },
  ];

  const policySummaryLines = formatCompliancePolicySummary(snapshot, attendance);
  const otHoursNum = Number(attendance.overtime_hours ?? run.overtime_hours ?? 0);
  const otPayNum = Number(compliance.overtime_pay ?? snapshot.overtime_amount ?? 0);
  const otRateNum = Number(snapshot.overtime_rate ?? compliance.effective_ot_rate ?? 0);
  const deptOtRateNum = Number(snapshot.department_overtime_rate ?? 0);
  const showOtUnpaidBanner = otHoursNum > 0 && otPayNum <= 0 && otRateNum <= 0;

  return (
    <div className="mx-auto max-w-3xl space-y-5 pb-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <button
          type="button"
          onClick={() => navigate('/hr/payroll/runs')}
          className="inline-flex min-h-[44px] items-center gap-1 text-sm font-semibold text-purple-600"
        >
          <ArrowLeft size={16} /> Back to payroll runs
        </button>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={load}
            className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg border border-gray-200 px-3 text-sm font-medium text-gray-600 hover:bg-gray-50"
          >
            <RefreshCw size={15} /> Refresh
          </button>
          {canRecalculate && (
            <button
              type="button"
              onClick={recalculateRun}
              disabled={!!acting}
              className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg border border-purple-200 bg-purple-50 px-3 text-sm font-medium text-purple-800 hover:bg-purple-100 disabled:opacity-60"
            >
              <RefreshCw size={15} /> {acting === 'recalculate' ? 'Recalculating…' : 'Recalculate'}
            </button>
          )}
        </div>
      </div>

      <header className="rounded-2xl bg-gradient-to-br from-purple-600 to-violet-700 p-5 text-white shadow-md">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-white/80">
              <User size={14} /> {run.employee_code}
            </p>
            <h1 className="mt-1 text-2xl font-bold">{run.employee_name}</h1>
            <p className="mt-1 flex items-center gap-1.5 text-sm text-white/85">
              <CalendarDays size={14} /> {monthLabel(run.month)}
            </p>
            <span className="mt-3 inline-block rounded-full bg-white/20 px-3 py-1 text-xs font-semibold text-white ring-1 ring-white/30">
              {statusLabel}
            </span>
          </div>
          <div className="text-left sm:text-right">
            <p className="text-xs font-medium text-white/80">Net salary (take home)</p>
            <p className="text-3xl font-extrabold tracking-tight">{formatCurrency(run.final_salary)}</p>
            <p className="mt-1 text-sm text-white/70">
              Gross {formatCurrency(run.gross_salary)} · Deductions {formatCurrency(run.total_deductions)}
            </p>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-3 gap-2 sm:grid-cols-6">
          {attendanceStats.map((item) => (
            <StatPill key={item.label} label={item.label} value={item.value} />
          ))}
        </div>
        {(attendance.period_start || attendance.period_end) && (
          <p className="mt-3 text-xs text-white/60">
            Period {attendance.period_start || '—'} → {attendance.period_end || '—'}
            {attendance.working_days != null ? ` · ${attendance.working_days} working days` : ''}
          </p>
        )}
      </header>

      {showOtUnpaidBanner && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-950">
          <p className="font-semibold">Overtime pay rate not set on this employee&apos;s salary</p>
          <p className="mt-0.5">
            {otHoursNum} OT hour(s) are already recorded from attendance (see above). OT pay is ₹0 because
            this employee&apos;s salary structure has an OT rate of {formatCurrency(otRateNum)}/hr.
            {deptOtRateNum > 0 ? (
              <>
                {' '}
                Their default compensation level is {formatCurrency(deptOtRateNum)}/hr — update it under{' '}
                <Link to="/hr/payroll/compensation-levels" className="font-semibold underline">
                  Compensation Levels
                </Link>
                , then click <strong>Recalculate</strong>.
              </>
            ) : (
              <>
                {' '}
                Set the rate per hour under{' '}
                <Link to="/hr/payroll/assign" className="font-semibold underline">
                  Custom Salaries
                </Link>{' '}
                (not in attendance), then click <strong>Recalculate</strong>.
              </>
            )}
          </p>
        </div>
      )}

      {isStaleAttendance && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
          <p className="font-semibold">Attendance may be outdated</p>
          <p className="mt-0.5 text-amber-900/90">
            Use <strong>Recalculate</strong> to refresh present days, overtime, and salary from current attendance.
          </p>
        </div>
      )}

      {warnings.length > 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
          <p className="font-semibold">Calculation warnings</p>
          <ul className="mt-1.5 list-disc space-y-0.5 pl-5">
            {warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </div>
      )}

      <WorkflowStepper
        run={run}
        acting={acting}
        onApprove={approveRun}
        onLock={lockRun}
        onGeneratePayslip={generatePayslip}
        onPublish={publishPayroll}
      />

      <section className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
        <h2 className="text-sm font-bold uppercase tracking-wide text-gray-500">Attendance Summary</h2>
        <div className="mt-3 grid gap-2 sm:grid-cols-3">
          {attendanceStats.map((item) => (
            <div key={item.label} className="rounded-lg bg-gray-50 px-3 py-2">
              <p className="text-xs text-gray-500">{item.label}</p>
              <p className="text-lg font-bold text-gray-900">
                {item.isText ? item.value : (item.value ?? '—')}
              </p>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-2xl border border-amber-200 bg-amber-50/60 p-4 shadow-sm">
        <h2 className="text-sm font-bold uppercase tracking-wide text-amber-900">Compliance</h2>
        {policySummaryLines.length > 0 && (
          <ul className="mt-2 space-y-1 text-sm text-amber-950">
            {policySummaryLines.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        )}
        <div className="mt-3 space-y-2 text-sm">
          <LineItem label="Monthly late count" value={compliance.monthly_late_count ?? snapshot.monthly_late_count ?? '0'} />
          <LineItem label="Late penalty" value={compliance.late_penalty ?? snapshot.late_penalty} tone="deduction" />
          <LineItem label="Late conversion" value={compliance.late_conversion_deduction ?? snapshot.late_conversion_deduction} tone="deduction" />
          <LineItem label="Escalation deduction" value={compliance.attendance_compliance_deduction ?? snapshot.attendance_compliance_deduction} tone="deduction" />
          <LineItem label="OT pay" value={compliance.overtime_pay ?? snapshot.overtime_amount} />
        </div>
        {complianceWarnings.length > 0 && (
          <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-amber-950">
            {complianceWarnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
        <h2 className="flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-gray-500">
          <Wallet size={14} /> Earnings
        </h2>
        <div className="mt-3">
          {earningsRows.length ? (
            earningsRows.map(([key, value]) => <LineItem key={key} label={key} value={value} />)
          ) : (
            <p className="text-sm text-gray-500">No earnings breakdown available.</p>
          )}
          {(snapshot.lop_amount || snapshot.overtime_amount || snapshot.late_penalty) && (
            <div className="mt-2 space-y-0 border-t border-gray-100 pt-2">
              {snapshot.lop_amount ? <LineItem label="Loss of pay (LOP)" value={snapshot.lop_amount} tone="deduction" /> : null}
              {snapshot.overtime_amount ? <LineItem label="Overtime pay" value={snapshot.overtime_amount} /> : null}
              {snapshot.late_penalty ? <LineItem label="Late penalty" value={snapshot.late_penalty} tone="deduction" /> : null}
            </div>
          )}
        </div>
        <div className="mt-3 flex items-center justify-between border-t border-gray-100 pt-3">
          <span className="text-sm font-semibold text-gray-700">Gross salary</span>
          <span className="text-lg font-bold text-gray-900">{formatCurrency(run.gross_salary)}</span>
        </div>
      </section>

      <section className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
        <h2 className="text-sm font-bold uppercase tracking-wide text-gray-500">Deductions</h2>
        <div className="mt-3">
          {deductionsRows.length ? (
            deductionsRows.map(([key, value]) => <LineItem key={key} label={key} value={value} tone="deduction" />)
          ) : (
            <p className="text-sm text-gray-500">No deductions recorded.</p>
          )}
        </div>
        <div className="mt-3 flex items-center justify-between border-t border-gray-100 pt-3">
          <span className="text-sm font-semibold text-gray-700">Total deductions</span>
          <span className="text-lg font-bold text-red-700">{formatCurrency(run.total_deductions)}</span>
        </div>
      </section>

      <section className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
        <div className="flex items-center justify-between">
          <span className="text-sm font-semibold text-emerald-900">Net salary (take home)</span>
          <span className="text-2xl font-extrabold text-emerald-800">{formatCurrency(run.final_salary)}</span>
        </div>
      </section>

      <CalculationDetails snapshot={snapshot} run={run} />
    </div>
  );
}
