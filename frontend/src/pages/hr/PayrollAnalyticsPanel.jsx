import React from 'react';
import { Link } from 'react-router-dom';
import { Wallet } from 'lucide-react';
import { formatCurrency } from './payroll/payrollUtils';
import IntelligenceSection, { MetricGrid } from './IntelligenceSection';

export default function PayrollAnalyticsPanel({ data, loading }) {
  return (
    <IntelligenceSection
      title="Payroll analytics"
      description="Monthly payroll cost, trend, and deduction breakdown from payroll runs."
      icon={Wallet}
      loading={loading}
    >
      <MetricGrid metrics={data?.metrics} />

      {(data?.trend || []).length > 0 && (
        <div className="mt-4 overflow-hidden rounded-lg border border-gray-100">
          <h3 className="border-b border-gray-100 bg-gray-50 px-4 py-2 text-xs font-bold uppercase tracking-wide text-gray-500">
            Payroll trend
          </h3>
          <table className="min-w-full text-left text-sm">
            <thead className="text-xs font-semibold uppercase tracking-wide text-gray-500">
              <tr>
                <th className="px-4 py-2">Month</th>
                <th className="px-4 py-2 text-right">Total</th>
                <th className="px-4 py-2 text-right">Runs</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {data.trend.map((row) => (
                <tr key={row.month} className="hover:bg-gray-50/80">
                  <td className="px-4 py-2">
                    <Link to={row.route} className="font-medium text-violet-700 hover:underline">
                      {row.label}
                    </Link>
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums">{formatCurrency(row.total)}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{row.count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {(data?.deductionBreakdown || []).length > 0 && (
        <div className="mt-4 overflow-hidden rounded-lg border border-gray-100">
          <h3 className="border-b border-gray-100 bg-gray-50 px-4 py-2 text-xs font-bold uppercase tracking-wide text-gray-500">
            Deduction breakdown
          </h3>
          <table className="min-w-full text-left text-sm">
            <tbody className="divide-y divide-gray-100">
              {data.deductionBreakdown.map((row) => (
                <tr key={row.label}>
                  <td className="px-4 py-2 capitalize text-gray-700">{row.label}</td>
                  <td className="px-4 py-2 text-right tabular-nums font-medium text-red-700">
                    {formatCurrency(row.amount)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </IntelligenceSection>
  );
}
