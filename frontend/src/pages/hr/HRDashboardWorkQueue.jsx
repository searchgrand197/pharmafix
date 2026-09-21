import React from 'react';
import { Inbox } from 'lucide-react';
import HRDashboardAggregateCard from './HRDashboardAggregateCard';

export default function HRDashboardWorkQueue({ workQueue, loading }) {
  const { items = [], total = 0 } = workQueue || {};

  if (loading) {
    return (
      <section className="rounded-2xl border border-violet-200 bg-white p-5 shadow-sm">
        <div className="h-24 animate-pulse rounded-lg bg-gray-100" />
      </section>
    );
  }

  return (
    <section className="rounded-2xl border border-violet-200 bg-gradient-to-br from-violet-50 to-white p-5 shadow-sm">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-bold text-gray-900">
            <Inbox size={20} className="text-violet-600" />
            My Work Queue
          </h2>
          <p className="mt-0.5 text-sm text-gray-600">
            Everything waiting on HR approval or review right now.
          </p>
        </div>
        <span className="rounded-full border border-violet-200 bg-white px-3 py-1 text-sm font-bold text-violet-800">
          {total} pending task{total === 1 ? '' : 's'}
        </span>
      </div>

      {items.length === 0 ? (
        <p className="rounded-lg border border-dashed border-gray-200 bg-gray-50 px-4 py-6 text-center text-sm text-gray-600">
          No approval queues pending — you are caught up on reviews.
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((item) => (
            <HRDashboardAggregateCard key={item.id} card={item} compact />
          ))}
        </div>
      )}
    </section>
  );
}
