import React from 'react';
import { Users } from 'lucide-react';
import IntelligenceSection, { MetricGrid } from './IntelligenceSection';

export default function WorkforceAnalyticsPanel({ data, loading }) {
  return (
    <IntelligenceSection
      title="Workforce analytics"
      description="Headcount and lifecycle signals from employee records."
      icon={Users}
      loading={loading}
    >
      <MetricGrid metrics={data?.metrics} />
    </IntelligenceSection>
  );
}
