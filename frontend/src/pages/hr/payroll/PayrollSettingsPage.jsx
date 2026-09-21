import React from 'react';
import { Link, useOutletContext } from 'react-router-dom';
import { Calendar, DollarSign, Settings, ShieldCheck, Wallet } from 'lucide-react';
import ReusableCard from '../../../components/HR/ReusableCard';

const WORKFLOW_STEPS = [
  {
    step: 1,
    title: 'Assign salary structures',
    description: 'Set basic, HRA, allowances, deductions, and overtime rate per employee.',
    to: '/hr/payroll/structures',
    icon: DollarSign,
  },
  {
    step: 2,
    title: 'Generate monthly payroll',
    description: 'Run payroll for a month using attendance and leave data.',
    to: '/hr/payroll/runs',
    icon: Wallet,
  },
  {
    step: 3,
    title: 'Approve & lock',
    description: 'HR reviews each run, approves totals, then locks for payslip generation.',
    to: '/hr/payroll/runs',
    icon: ShieldCheck,
  },
  {
    step: 4,
    title: 'Generate payslips',
    description: 'Create immutable PDF payslips for locked runs.',
    to: '/hr/payroll/payslips',
    icon: Calendar,
  },
];

export default function PayrollSettingsPage() {
  const { theme = 'purple' } = useOutletContext() || {};

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <header>
        <h1 className="flex items-center gap-2 text-2xl font-bold text-gray-900">
          <Settings size={24} className="text-purple-600" /> Payroll Settings
        </h1>
        <p className="mt-1 text-sm text-gray-600">Workflow reference and related configuration links.</p>
      </header>

      <ReusableCard title="Payroll workflow" icon={Wallet} theme={theme}>
        <ol className="space-y-4">
          {WORKFLOW_STEPS.map((item) => {
            const Icon = item.icon;
            return (
              <li key={item.step} className="flex gap-4 rounded-xl border border-gray-100 bg-gray-50 p-4">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-purple-100 text-sm font-bold text-purple-700">
                  {item.step}
                </div>
                <div className="min-w-0 flex-1">
                  <h3 className="flex items-center gap-2 font-semibold text-gray-900">
                    <Icon size={16} className="text-purple-600" /> {item.title}
                  </h3>
                  <p className="mt-1 text-sm text-gray-600">{item.description}</p>
                  <Link to={item.to} className="mt-2 inline-block text-sm font-semibold text-purple-600 hover:underline">
                    Open screen →
                  </Link>
                </div>
              </li>
            );
          })}
        </ol>
      </ReusableCard>

      <ReusableCard title="Related settings" icon={Settings} theme={theme}>
        <ul className="space-y-3 text-sm text-gray-700">
          <li>
            <Link to="/hr/operations/holidays" className="font-semibold text-purple-600 hover:underline">
              Holiday management
            </Link>
            <span className="text-gray-500"> — paid-day flags for future payroll integration</span>
          </li>
          <li>
            <Link to="/hr/settings/organization/details" className="font-semibold text-purple-600 hover:underline">
              Organization settings
            </Link>
            <span className="text-gray-500"> — hospital branding and letterhead</span>
          </li>
          <li>
            <Link to="/hr/operations/shifts" className="font-semibold text-purple-600 hover:underline">
              Shift management
            </Link>
            <span className="text-gray-500"> — affects overtime and attendance calculations</span>
          </li>
          <li>
            <Link to="/hr/leave/policies" className="font-semibold text-purple-600 hover:underline">
              Leave policies
            </Link>
            <span className="text-gray-500"> — paid vs unpaid leave in payroll</span>
          </li>
        </ul>
      </ReusableCard>

      <ReusableCard title="API reference (read-only)" icon={Settings} theme={theme}>
        <p className="text-sm text-gray-600">
          This module consumes <code className="rounded bg-gray-100 px-1">/api/payroll/</code> endpoints for structures,
          runs, and approval. Payslip PDF generation uses <code className="rounded bg-gray-100 px-1">/api/v1/hr/payroll-runs/</code> actions.
        </p>
      </ReusableCard>
    </div>
  );
}
