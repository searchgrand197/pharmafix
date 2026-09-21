import React from 'react';
import { Link } from 'react-router-dom';
import { Briefcase } from 'lucide-react';
import IntelligenceSection, { MetricGrid } from './IntelligenceSection';

export default function HiringAnalyticsPanel({ data, loading }) {
  return (
    <IntelligenceSection
      title="Hiring analytics"
      description="Pipeline volume and conversion rates from recruitment data."
      icon={Briefcase}
      loading={loading}
    >
      <MetricGrid metrics={data?.metrics} />
      {(data?.conversions || []).length > 0 && (
        <div className="mt-4 overflow-hidden rounded-lg border border-gray-100">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-gray-50 text-xs font-semibold uppercase tracking-wide text-gray-500">
              <tr>
                <th className="px-4 py-2">Conversion</th>
                <th className="px-4 py-2 text-right">Rate</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {data.conversions.map((row) => (
                <tr key={row.label} className="hover:bg-gray-50/80">
                  <td className="px-4 py-2">
                    <Link to={row.route} className="font-medium text-violet-700 hover:underline">
                      {row.label}
                    </Link>
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums font-semibold">{row.percent}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </IntelligenceSection>
  );
}
