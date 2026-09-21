import React from 'react';
import { Link } from 'react-router-dom';
import { ChevronRight, LayoutDashboard } from 'lucide-react';

export default function DashboardLaunchCard({ openTasks, loading }) {
  const count = loading ? '—' : openTasks;

  return (
    <section className="rounded-2xl border border-violet-200 bg-gradient-to-r from-violet-600 to-indigo-600 p-5 text-white shadow-md">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold uppercase tracking-wide text-violet-200">
            Start here for today&apos;s work
          </p>
          <h2 className="mt-1 flex items-center gap-2 text-lg font-bold">
            <LayoutDashboard size={20} />
            HR Dashboard
          </h2>
          <p className="mt-0.5 text-sm text-violet-100">
            Interviews, offers, salary, shifts, documents, and leave — everything you need to action today.
          </p>
          {!loading && (
            <p className="mt-2 text-sm font-semibold text-white/90">
              {openTasks === 0 ? 'No open tasks right now' : `${count} open task${openTasks === 1 ? '' : 's'} waiting`}
            </p>
          )}
        </div>
        <Link
          to="/hr/journey-center/dashboard"
          className="inline-flex shrink-0 items-center justify-center gap-1.5 rounded-lg bg-white px-5 py-2.5 text-sm font-bold text-violet-700 shadow-sm hover:bg-violet-50"
        >
          Open Dashboard
          <ChevronRight size={16} />
        </Link>
      </div>
    </section>
  );
}
