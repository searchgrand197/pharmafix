import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AlertTriangle, ArrowRight, Wallet } from 'lucide-react';

const REDIRECT_TARGET = '/hr/payroll/runs';
const REDIRECT_SECONDS = 5;

/**
 * Legacy /hr/operations/salary route — deprecated in favor of the Payroll module.
 * Kept for backward-compatible bookmarks and deep links only.
 */
export default function OperationsSalaryPage() {
  const navigate = useNavigate();
  const [secondsLeft, setSecondsLeft] = useState(REDIRECT_SECONDS);

  useEffect(() => {
    document.title = 'Salary (deprecated) | HR';
  }, []);

  useEffect(() => {
    if (secondsLeft <= 0) {
      navigate(REDIRECT_TARGET, { replace: true });
      return undefined;
    }
    const timer = setTimeout(() => setSecondsLeft((s) => s - 1), 1000);
    return () => clearTimeout(timer);
  }, [secondsLeft, navigate]);

  return (
    <div className="mx-auto flex max-w-lg flex-col items-center justify-center px-4 py-16 text-center">
      <div className="w-full rounded-2xl border border-amber-200 bg-amber-50 p-6 shadow-sm">
        <AlertTriangle className="mx-auto text-amber-600" size={40} />
        <h1 className="mt-4 text-xl font-bold text-amber-950">This page is deprecated. Use Payroll module.</h1>
        <p className="mt-2 text-sm text-amber-900/80">
          The legacy Salary screen has been replaced by the Payroll module (compensation levels, payroll runs, and payslips).
          Historical salary records remain in the database but are no longer managed here.
        </p>
        <p className="mt-4 text-xs font-medium text-amber-800">
          Redirecting to Payroll Runs in {secondsLeft}s…
        </p>
        <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:justify-center">
          <Link
            to={REDIRECT_TARGET}
            className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl bg-purple-600 px-5 text-sm font-semibold text-white hover:bg-purple-700"
          >
            <Wallet size={16} /> Go to Payroll Runs
            <ArrowRight size={16} />
          </Link>
          <Link
            to="/hr/payroll/compensation-levels"
            className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl border border-amber-300 bg-white px-5 text-sm font-semibold text-amber-950 hover:bg-amber-100"
          >
            Compensation Levels
          </Link>
        </div>
      </div>
    </div>
  );
}
