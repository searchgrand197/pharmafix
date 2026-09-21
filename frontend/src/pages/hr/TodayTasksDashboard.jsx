import React from 'react';
import { Link } from 'react-router-dom';
import {
  Calendar,
  Briefcase,
  ClipboardList,
  Clock,
  DollarSign,
  FileSignature,
  LayoutDashboard,
  UserCheck,
  UserPlus,
  UserRoundCheck,
} from 'lucide-react';
import { withJourneyCenterReturn } from './journeyCenterUtils';

function MetricCard({ title, value, icon: Icon, color, to, loading }) {
  const display = loading ? '—' : value;

  return (
    <Link
      to={withJourneyCenterReturn(to)}
      className="block rounded-xl border border-gray-100 bg-white p-5 shadow-sm transition-all hover:border-violet-200 hover:shadow-md"
    >
      <div
        className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg"
        style={{ backgroundColor: `${color}18`, color }}
      >
        <Icon size={18} />
      </div>
      <div className="text-3xl font-bold tabular-nums text-gray-900">{display}</div>
      <div className="mt-0.5 text-sm text-gray-600">{title}</div>
    </Link>
  );
}

const DASHBOARD_CARDS = [
  {
    key: 'pending_interviews',
    title: 'Interviews pending',
    icon: Calendar,
    color: '#8b5cf6',
    to: '/hr/recruitment/interviews',
  },
  {
    key: 'pending_offers',
    title: 'Offers to send',
    icon: FileSignature,
    color: '#f59e0b',
    to: '/hr/recruitment/offers',
  },
  {
    key: 'review_applications',
    title: 'Applications to review',
    icon: UserPlus,
    color: '#2563eb',
    to: '/hr/recruitment/candidates?stage=applied',
  },
  {
    key: 'schedule_interview',
    title: 'Schedule interview',
    icon: UserCheck,
    color: '#6366f1',
    to: '/hr/recruitment/candidates?stage=shortlisted',
  },
  {
    key: 'missing_salary',
    title: 'Employees missing salary',
    icon: DollarSign,
    color: '#059669',
    to: '/hr/employees?filter=missing_salary',
  },
  {
    key: 'missing_designation_salary',
    title: 'Compensation levels',
    icon: Briefcase,
    color: '#047857',
    to: '/hr/payroll/compensation-levels?filter=missing',
  },
  {
    key: 'missing_shift',
    title: 'Assign shift',
    icon: Clock,
    color: '#ea580c',
    to: '/hr/operations/shifts?filter=missing_shift',
  },
  {
    key: 'mandatory_docs',
    title: 'Documents incomplete',
    icon: ClipboardList,
    color: '#dc2626',
    to: '/hr/onboarding/document-verification',
  },
  {
    key: 'pending_documents',
    title: 'Documents to review',
    icon: ClipboardList,
    color: '#d97706',
    to: '/hr/onboarding/document-verification',
  },
  {
    key: 'ready_to_activate',
    title: 'Ready to activate',
    icon: UserRoundCheck,
    color: '#059669',
    to: '/hr/onboarding/document-verification',
  },
  {
    key: 'pending_employee_creation',
    title: 'Create employee',
    icon: UserPlus,
    color: '#7c3aed',
    to: '/hr/onboarding/pending-documents',
  },
  {
    key: 'pending_leave',
    title: 'Leave requests',
    icon: Calendar,
    color: '#0891b2',
    to: '/hr/leave/requests?status=PENDING',
  },
];

export default function TodayTasksDashboard({ metrics, loading, totalTasks }) {
  const actionableTotal = loading
    ? '—'
    : (totalTasks ?? DASHBOARD_CARDS.reduce((sum, card) => sum + (Number(metrics?.[card.key]) || 0), 0));

  return (
    <section className="rounded-2xl border border-violet-100 bg-gradient-to-br from-violet-50/80 to-white p-5">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-bold text-gray-900">
            <LayoutDashboard size={20} className="text-violet-600" />
            Today&apos;s tasks
          </h2>
          <p className="mt-0.5 text-sm text-gray-600">
            Everything HR needs to action today — recruitment, onboarding, shifts, salary, and leave.
          </p>
        </div>
        {!loading && (
          <span className="rounded-full border border-violet-200 bg-white px-3 py-1 text-sm font-bold text-violet-800">
            {actionableTotal} open
          </span>
        )}
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {DASHBOARD_CARDS.map((card) => (
          <MetricCard
            key={card.key}
            title={card.title}
            value={metrics?.[card.key] ?? 0}
            icon={card.icon}
            color={card.color}
            to={card.to}
            loading={loading}
          />
        ))}
      </div>
    </section>
  );
}
