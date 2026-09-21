import React from 'react';
import { Link } from 'react-router-dom';
import { Calendar } from 'lucide-react';
import IntelligenceSection, { MetricGrid } from './IntelligenceSection';

export default function LeaveAnalyticsPanel({ data, loading }) {
  return (
    <IntelligenceSection
      title="Leave analytics"
      description="Leave request volumes and usage patterns."
      icon={Calendar}
      loading={loading}
    >
      <MetricGrid metrics={data?.metrics} />

      {(data?.topLeaveUsers || []).length > 0 && (
        <div className="mt-4">
          <h3 className="mb-2 text-xs font-bold uppercase tracking-wide text-gray-500">Top leave users</h3>
          <ul className="divide-y divide-gray-100 rounded-lg border border-gray-100">
            {data.topLeaveUsers.map((row) => (
              <li key={row.employeeId} className="flex items-center justify-between px-4 py-2 text-sm">
                <div>
                  <span className="font-medium text-gray-900">{row.code}</span>
                  <span className="text-gray-600"> — {row.name}</span>
                </div>
                <span className="tabular-nums text-gray-700">{row.count} approved</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {(data?.topDepartments || []).length > 0 && (
        <div className="mt-4">
          <h3 className="mb-2 text-xs font-bold uppercase tracking-wide text-gray-500">Department leave usage</h3>
          <ul className="divide-y divide-gray-100 rounded-lg border border-gray-100">
            {data.topDepartments.map((row) => (
              <li key={row.department} className="flex items-center justify-between px-4 py-2 text-sm">
                <Link to="/hr/leave/balances" className="font-medium text-violet-700 hover:underline">
                  {row.department}
                </Link>
                <span className="tabular-nums text-gray-700">{row.count}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </IntelligenceSection>
  );
}
