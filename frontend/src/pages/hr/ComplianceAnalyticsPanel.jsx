import React from 'react';
import { FileCheck } from 'lucide-react';
import IntelligenceSection, { MetricGrid } from './IntelligenceSection';

export default function ComplianceAnalyticsPanel({ data, loading }) {
  return (
    <IntelligenceSection
      title="Compliance analytics"
      description="Document expiry and verification queue from onboarding data."
      icon={FileCheck}
      loading={loading}
    >
      <MetricGrid metrics={data?.metrics} />
    </IntelligenceSection>
  );
}
