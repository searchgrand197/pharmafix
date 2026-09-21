import React from 'react';
import { Clock } from 'lucide-react';
import IntelligenceSection, { MetricGrid } from './IntelligenceSection';

export default function AttendanceAnalyticsPanel({ data, loading }) {
  return (
    <IntelligenceSection
      title="Attendance analytics"
      description="Today's attendance health from daily summary records."
      icon={Clock}
      loading={loading}
    >
      <MetricGrid metrics={data?.metrics} />
    </IntelligenceSection>
  );
}
