import React from 'react';
import { BarChart3 } from 'lucide-react';
import { computeTaskDashboardMetrics } from './nextActionEngine';

export default function HRDashboardMetrics({ tasks, commandCenterCounts, loading }) {
  if (loading) return null;

  const taskMetrics = computeTaskDashboardMetrics(tasks || []);
  const cc = commandCenterCounts || {};

  const metrics = [
    { label: 'Open tasks', value: (tasks || []).length },
    { label: 'Leave pending', value: cc.leave_requests ?? taskMetrics.pending_leave },
    { label: 'Doc reviews', value: cc.document_reviews ?? taskMetrics.pending_documents },
    { label: 'On leave today', value: cc.on_leave_today ?? 0 },
    { label: 'Payroll locked', value: cc.payroll_locked ?? 0 },
    { label: 'Active joiners', value: cc.onboarding_reviews ?? 0 },
  ];

  return (
    <section className="rounded-xl border border-gray-100 bg-white p-5 shadow-sm">
      <h2 className="mb-3 flex items-center gap-2 text-sm font-bold text-gray-900">
        <BarChart3 size={16} className="text-gray-500" />
        Analytics snapshot
      </h2>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {metrics.map((m) => (
          <div key={m.label} className="rounded-lg border border-gray-100 bg-gray-50 px-3 py-2">
            <div className="text-lg font-bold tabular-nums text-gray-900">{m.value}</div>
            <div className="text-xs text-gray-600">{m.label}</div>
          </div>
        ))}
      </div>
    </section>
  );
}
