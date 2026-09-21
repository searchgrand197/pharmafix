import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import { ChevronLeft, ChevronRight, RefreshCw, Wallet } from 'lucide-react';
import api from '../../api';
import { monthKey } from '../../utils/attendanceCalendar';
import {
  formatCurrency,
  monthLabel,
  normalizePayslipList,
  payslipErrorText,
} from './employeePayslipUtils';

function PayslipCard({ payslip }) {
  return (
    <Link
      to={`/employee/payslips/${payslip.id}`}
      className="block rounded-2xl border border-gray-200 bg-white p-4 shadow-sm transition hover:border-teal-300 hover:shadow-md"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-teal-700">Payslip</p>
          <p className="mt-1 text-lg font-bold text-gray-900">{monthLabel(payslip.month)}</p>
          <p className="mt-1 text-xs text-gray-500">{payslip.month}</p>
        </div>
        <div className="text-right">
          <p className="text-xs text-gray-500">Net pay</p>
          <p className="text-xl font-extrabold text-emerald-700">{formatCurrency(payslip.net_salary)}</p>
        </div>
      </div>
      <div className="mt-4 flex items-center justify-between border-t border-gray-100 pt-3 text-sm">
        <span className="text-gray-500">Gross {formatCurrency(payslip.gross_salary)}</span>
        <span className="font-semibold text-teal-700">View details →</span>
      </div>
    </Link>
  );
}

export default function EmployeePayslipsPage() {
  const [loading, setLoading] = useState(true);
  const [month, setMonth] = useState('');
  const [payslips, setPayslips] = useState([]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = {};
      if (month) params.month = month;
      const { data } = await api.get('/employee-portal/payslips/', { params });
      setPayslips(normalizePayslipList(data));
    } catch (error) {
      toast.error(payslipErrorText(error, 'Failed to load payslips'));
      setPayslips([]);
    } finally {
      setLoading(false);
    }
  }, [month]);

  useEffect(() => {
    document.title = 'My Payslips | Employee Portal';
    load();
  }, [load]);

  function shiftMonth(delta) {
    const base = month ? month.split('-').map(Number) : monthKey().split('-').map(Number);
    const [year, mon] = base;
    const dt = new Date(year, mon - 1 + delta, 1);
    setMonth(monthKey(dt));
  }

  function clearMonthFilter() {
    setMonth('');
  }

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-bold text-gray-900 sm:text-2xl">
            <Wallet size={22} className="text-teal-600" /> My Payslips
          </h1>
          <p className="mt-1 text-sm text-gray-600">Published payslips for your account only.</p>
        </div>
        <button
          type="button"
          onClick={load}
          className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl border border-gray-200 bg-white px-4 text-sm font-semibold text-gray-700"
        >
          <RefreshCw size={16} /> Refresh
        </button>
      </header>

      <section className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
        <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Filter by month</p>
        <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="flex items-center justify-center gap-2">
            <button
              type="button"
              onClick={() => shiftMonth(-1)}
              className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-xl border border-gray-200"
              aria-label="Previous month"
            >
              <ChevronLeft size={18} />
            </button>
            <div className="min-w-[160px] text-center">
              <p className="font-semibold text-gray-900">{month ? monthLabel(month) : 'All months'}</p>
              {month ? <p className="text-xs text-gray-500">{month}</p> : null}
            </div>
            <button
              type="button"
              onClick={() => shiftMonth(1)}
              className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-xl border border-gray-200"
              aria-label="Next month"
            >
              <ChevronRight size={18} />
            </button>
          </div>
          {month ? (
            <button
              type="button"
              onClick={clearMonthFilter}
              className="min-h-[44px] rounded-xl border border-gray-200 px-4 text-sm font-semibold text-gray-700"
            >
              Show all
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setMonth(monthKey())}
              className="min-h-[44px] rounded-xl bg-teal-600 px-4 text-sm font-semibold text-white"
            >
              Current month
            </button>
          )}
        </div>
      </section>

      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-28 animate-pulse rounded-2xl bg-gray-100" />
          ))}
        </div>
      ) : payslips.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-gray-200 bg-white p-10 text-center">
          <Wallet size={32} className="mx-auto text-gray-300" />
          <p className="mt-3 font-semibold text-gray-800">No payslips yet</p>
          <p className="mt-1 text-sm text-gray-500">
            {month
              ? `No published payslip for ${monthLabel(month)}.`
              : 'Payslips appear here after HR publishes your monthly payroll.'}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {payslips.map((payslip) => (
            <PayslipCard key={payslip.id} payslip={payslip} />
          ))}
        </div>
      )}
    </div>
  );
}
