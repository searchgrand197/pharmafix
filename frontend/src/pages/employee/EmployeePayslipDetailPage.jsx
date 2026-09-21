import React, { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { ArrowLeft, Download, Wallet } from 'lucide-react';
import api from '../../api';
import {
  formatAttendancePercentage,
  formatCurrency,
  monthLabel,
  payslipErrorText,
  splitDeductions,
  splitEarnings,
} from './employeePayslipUtils';

function LineItem({ label, value }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-gray-50 py-2.5 last:border-0">
      <span className="text-sm capitalize text-gray-600">{label.replace(/_/g, ' ')}</span>
      <span className="text-sm font-semibold text-gray-900">{formatCurrency(value)}</span>
    </div>
  );
}

function StatCard({ label, value }) {
  return (
    <div className="rounded-xl border border-gray-100 bg-gray-50 p-3 text-center">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">{label}</p>
      <p className="mt-1 text-lg font-bold text-gray-900">{value ?? '—'}</p>
    </div>
  );
}

export default function EmployeePayslipDetailPage() {
  const { id } = useParams();
  const [loading, setLoading] = useState(true);
  const [downloading, setDownloading] = useState(false);
  const [payslip, setPayslip] = useState(null);
  const [attendance, setAttendance] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get(`/employee-portal/payslips/${id}/`);
      setPayslip(data);
      if (data.attendance_summary && Object.keys(data.attendance_summary).length) {
        setAttendance(data.attendance_summary);
      } else {
        try {
          const attRes = await api.get('/employee-portal/attendance/', { params: { month: data.month } });
          setAttendance(attRes.data?.summary || null);
        } catch {
          setAttendance(null);
        }
      }
    } catch (error) {
      toast.error(payslipErrorText(error, 'Failed to load payslip'));
      setPayslip(null);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    document.title = 'Payslip Details | Employee Portal';
    load();
  }, [load]);

  async function downloadPdf() {
    if (!payslip || downloading) return;
    setDownloading(true);
    try {
      const { data } = await api.get(`/employee-portal/payslips/${payslip.id}/download/`, {
        responseType: 'blob',
      });
      const url = window.URL.createObjectURL(data);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `payslip-${payslip.month}.pdf`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.URL.revokeObjectURL(url);
      toast.success('Payslip downloaded');
    } catch (error) {
      if (payslip.pdf_url) {
        window.open(payslip.pdf_url, '_blank', 'noopener,noreferrer');
        return;
      }
      toast.error(payslipErrorText(error, 'PDF not available'));
    } finally {
      setDownloading(false);
    }
  }

  if (loading) {
    return (
      <div className="mx-auto max-w-3xl space-y-4">
        <div className="h-8 w-48 animate-pulse rounded bg-gray-100" />
        <div className="h-40 animate-pulse rounded-2xl bg-gray-100" />
        <div className="h-64 animate-pulse rounded-2xl bg-gray-100" />
      </div>
    );
  }

  if (!payslip) {
    return (
      <div className="mx-auto max-w-3xl rounded-2xl border border-gray-200 bg-white p-8 text-center">
        <p className="text-gray-600">Payslip not found or not available.</p>
        <Link to="/employee/payslips" className="mt-4 inline-block text-sm font-semibold text-teal-700">
          ← Back to payslips
        </Link>
      </div>
    );
  }

  const earnings = splitEarnings(payslip.earnings_breakdown || {});
  const deductions = splitDeductions(payslip.deductions_breakdown || {});

  return (
    <div className="mx-auto max-w-3xl space-y-5 pb-8">
      <Link
        to="/employee/payslips"
        className="inline-flex min-h-[44px] items-center gap-1 text-sm font-semibold text-teal-700"
      >
        <ArrowLeft size={16} /> Back to My Payslips
      </Link>

      <header className="rounded-2xl bg-gradient-to-br from-teal-600 to-emerald-600 p-5 text-white shadow-md">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide opacity-90">
              <Wallet size={14} /> Payslip
            </p>
            <h1 className="mt-1 text-2xl font-bold">{monthLabel(payslip.month)}</h1>
            <p className="mt-1 text-sm opacity-90">
              {payslip.employee_name} · {payslip.employee_code}
            </p>
          </div>
          <div className="text-left sm:text-right">
            <p className="text-xs opacity-90">Net salary</p>
            <p className="text-3xl font-extrabold">{formatCurrency(payslip.net_salary)}</p>
          </div>
        </div>
        <button
          type="button"
          onClick={downloadPdf}
          disabled={downloading}
          className="mt-4 inline-flex min-h-[44px] w-full items-center justify-center gap-2 rounded-xl bg-white/15 px-4 text-sm font-bold text-white hover:bg-white/25 disabled:opacity-60 sm:w-auto"
        >
          <Download size={16} /> {downloading ? 'Downloading…' : 'Download PDF'}
        </button>
      </header>

      <section className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
        <h2 className="text-sm font-bold uppercase tracking-wide text-gray-500">Earnings</h2>
        <div className="mt-3">
          <LineItem label="Basic salary" value={earnings.basic} />
          <LineItem label="HRA" value={earnings.hra} />
          {earnings.allowanceEntries.map((row) => (
            <LineItem key={row.key} label={row.key} value={row.value} />
          ))}
          {earnings.overtime ? <LineItem label="Overtime" value={earnings.overtime} /> : null}
        </div>
        <div className="mt-3 flex items-center justify-between border-t border-gray-100 pt-3">
          <span className="text-sm font-semibold text-gray-700">Gross salary</span>
          <span className="text-lg font-bold text-gray-900">{formatCurrency(payslip.gross_salary)}</span>
        </div>
      </section>

      <section className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
        <h2 className="text-sm font-bold uppercase tracking-wide text-gray-500">Deductions</h2>
        <div className="mt-3">
          {deductions.length === 0 ? (
            <p className="text-sm text-gray-500">No deductions recorded.</p>
          ) : (
            deductions.map((row) => <LineItem key={row.key} label={row.key} value={row.value} />)
          )}
        </div>
      </section>

      <section className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
        <div className="flex items-center justify-between">
          <span className="text-sm font-semibold text-emerald-900">Net salary (take home)</span>
          <span className="text-2xl font-extrabold text-emerald-800">{formatCurrency(payslip.net_salary)}</span>
        </div>
      </section>

      <section className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
        <h2 className="text-sm font-bold uppercase tracking-wide text-gray-500">Attendance summary</h2>
        <p className="mt-1 text-xs text-gray-500">For {monthLabel(payslip.month)}</p>
        {attendance ? (
          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
            <StatCard label="Working days" value={attendance.working_days} />
            <StatCard label="Present" value={attendance.present_days} />
            <StatCard label="Absent" value={attendance.absent_days} />
            <StatCard label="Leave days" value={attendance.leave_days} />
            <StatCard label="Late days" value={attendance.late_days} />
            <StatCard label="Work hours" value={attendance.total_work_hours} />
            <StatCard label="OT hours" value={attendance.overtime_hours || attendance.total_overtime_hours} />
            <StatCard label="Attendance %" value={formatAttendancePercentage(attendance)} />
          </div>
        ) : (
          <p className="mt-3 text-sm text-gray-500">Attendance summary is not available for this period.</p>
        )}
      </section>

      {payslip.generated_at ? (
        <p className="text-center text-xs text-gray-400">
          Generated {new Date(payslip.generated_at).toLocaleString()}
        </p>
      ) : null}
    </div>
  );
}
