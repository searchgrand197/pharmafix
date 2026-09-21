import React from 'react';
import { AlertTriangle } from 'lucide-react';
import IntelligenceSection, { MetricGrid } from './IntelligenceSection';

export default function PayrollRiskAnalyticsPanel({ data, loading }) {
  return (
    <IntelligenceSection
      title="Payroll risk analytics"
      description="Operational blockers that may affect payroll processing."
      icon={AlertTriangle}
      loading={loading}
    >
      <MetricGrid metrics={data?.metrics} />
      {(data?.topBlockReasons || []).length > 0 && (
        <div className="mt-4">
          <h3 className="mb-2 text-xs font-bold uppercase tracking-wide text-gray-500">Top block reasons</h3>
          <ul className="list-disc space-y-1 pl-4 text-sm text-gray-700">
            {data.topBlockReasons.map(({ reason, count }) => (
              <li key={reason}>{reason} ({count})</li>
            ))}
          </ul>
        </div>
      )}
    </IntelligenceSection>
  );
}
