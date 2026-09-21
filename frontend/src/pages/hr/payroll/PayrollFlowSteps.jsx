import React from 'react';
import { Link } from 'react-router-dom';

export const PAYROLL_FLOW = [
  {
    step: 1,
    label: 'Compensation levels',
    description: 'Set default pay levels per job title',
    to: '/hr/payroll/compensation-levels',
  },
  {
    step: 2,
    label: 'Payroll runs',
    description: 'Run payroll and review employees',
    to: '/hr/payroll/runs',
  },
  {
    step: 3,
    label: 'Payslips',
    description: 'Create PDFs and send to employees',
    to: '/hr/payroll/payslips',
  },
];

export default function PayrollFlowSteps({ currentStep }) {
  return (
    <nav aria-label="Payroll workflow" className="rounded-xl border border-gray-200 bg-white p-3 sm:p-4">
      <ol className="grid gap-2 sm:grid-cols-3">
        {PAYROLL_FLOW.map((item) => {
          const isActive = item.step === currentStep;
          return (
            <li key={item.step}>
              <Link
                to={item.to}
                className={`block rounded-lg border px-3 py-2.5 transition-colors ${
                  isActive
                    ? 'border-purple-300 bg-purple-50'
                    : 'border-gray-100 bg-gray-50 hover:border-purple-200 hover:bg-purple-50/60'
                }`}
              >
                <span className={`text-xs font-bold uppercase tracking-wide ${isActive ? 'text-purple-700' : 'text-gray-500'}`}>
                  Step {item.step}
                </span>
                <span className={`mt-0.5 block text-sm font-semibold ${isActive ? 'text-purple-900' : 'text-gray-900'}`}>
                  {item.label}
                </span>
                <span className="mt-0.5 block text-xs text-gray-600">{item.description}</span>
              </Link>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
