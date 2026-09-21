import React from 'react';
import { Compass, LayoutDashboard, Map, PanelLeft, UserPlus } from 'lucide-react';
import { Link } from 'react-router-dom';
import { withJourneyCenterReturn } from './journeyCenterUtils';

const STEPS = [
  {
    icon: LayoutDashboard,
    title: 'Daily work',
    description: 'Use HR Dashboard in the sidebar for today\'s tasks — interviews, offers, salary, shifts, and leave.',
  },
  {
    icon: Map,
    title: 'Learn the flow',
    description: 'Expand a phase below when you need the full path from hiring through payroll.',
  },
  {
    icon: PanelLeft,
    title: 'Jump anywhere',
    description: 'Use the sidebar for direct access to Jobs, Employees, Attendance, and Payroll.',
  },
];

export default function JourneyStartHereCard() {
  return (
    <section className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
      <h2 className="flex items-center gap-2 text-base font-bold text-gray-900">
        <Compass size={18} className="text-violet-600" />
        Start here
      </h2>
      <p className="mt-0.5 text-sm text-gray-600">
        Three simple ways to use Hire Staff after setup is complete.
      </p>
      <ol className="mt-4 space-y-3">
        {STEPS.map((step, index) => {
          const Icon = step.icon;
          return (
            <li key={step.title} className="flex gap-3">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-violet-100 text-xs font-bold text-violet-700">
                {index + 1}
              </span>
              <div className="min-w-0">
                <div className="flex items-center gap-1.5 text-sm font-semibold text-gray-900">
                  <Icon size={14} className="text-violet-600" />
                  {step.title}
                </div>
                <p className="mt-0.5 text-sm text-gray-600">{step.description}</p>
              </div>
            </li>
          );
        })}
      </ol>

      <div className="mt-5 rounded-xl border border-violet-200 bg-violet-50/80 p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <h3 className="text-sm font-bold text-gray-900">Direct hire</h3>
            <p className="mt-0.5 text-sm text-gray-600">
              Walk-in candidate already in the office? Skip job posting and recruitment — add them as an active employee with documents verified in HR.
            </p>
          </div>
          <Link
            to={withJourneyCenterReturn('/hr/employees/create')}
            className="inline-flex shrink-0 items-center justify-center gap-2 rounded-lg bg-violet-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-violet-700"
          >
            <UserPlus size={16} />
            Start direct hire
          </Link>
        </div>
      </div>
    </section>
  );
}
