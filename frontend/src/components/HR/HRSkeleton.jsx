import React from 'react';

export function DashboardMetricSkeleton({ count = 7 }) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          className="animate-pulse rounded-xl border border-gray-100 bg-white p-6 shadow-sm"
        >
          <div className="mb-4 h-10 w-10 rounded-lg bg-gray-200" />
          <div className="mb-2 h-8 w-20 rounded bg-gray-200" />
          <div className="h-4 w-32 rounded bg-gray-100" />
        </div>
      ))}
    </div>
  );
}

export function TableSkeleton({ rows = 6, cols = 5 }) {
  return (
    <div className="animate-pulse space-y-3 p-4">
      <div className="flex gap-2 border-b border-gray-100 pb-3">
        {Array.from({ length: cols }).map((_, i) => (
          <div key={i} className="h-3 flex-1 rounded bg-gray-200" />
        ))}
      </div>
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className="flex gap-2">
          {Array.from({ length: cols }).map((_, c) => (
            <div key={c} className="h-9 flex-1 rounded bg-gray-50" />
          ))}
        </div>
      ))}
    </div>
  );
}
