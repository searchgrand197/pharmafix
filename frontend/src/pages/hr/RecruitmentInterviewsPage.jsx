import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import api from '../../api';
import toast from 'react-hot-toast';
import { Calendar, ChevronLeft, ChevronRight, RefreshCw, Search, Video } from 'lucide-react';
import { normalizeApiList } from '../../hr/recruitmentLifecycle';
import { TableSkeleton } from '../../components/HR/HRSkeleton';
import { ATTENDANCE_TIME_ZONE } from '../../utils/timeDisplay';
import { formatInterviewDateTime } from '../../utils/interviewDateTime';

const LIMIT = 25;

const STATUS_FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'upcoming', label: 'Upcoming', params: { status: 'scheduled', upcoming: 'true' } },
  { id: 'scheduled', label: 'Scheduled', params: { status: 'scheduled' } },
  { id: 'completed', label: 'Completed', params: { status: 'completed' } },
  { id: 'cancelled', label: 'Cancelled', params: { status: 'cancelled' } },
  { id: 'no_show', label: 'No show', params: { status: 'no_show' } },
];

function statusBadgeClass(status) {
  const map = {
    scheduled: 'bg-violet-100 text-violet-900',
    completed: 'bg-emerald-100 text-emerald-900',
    cancelled: 'bg-slate-100 text-slate-700',
    no_show: 'bg-amber-100 text-amber-950',
    selected: 'bg-green-100 text-green-900',
    rejected: 'bg-red-100 text-red-900',
  };
  return map[status] || 'bg-slate-100 text-slate-700';
}

export default function RecruitmentInterviewsPage() {
  const location = useLocation();
  const returnTo = `${location.pathname}${location.search}`;

  const [statusFilter, setStatusFilter] = useState('upcoming');
  const [search, setSearch] = useState('');
  const [appliedSearch, setAppliedSearch] = useState('');
  const [jobOpening, setJobOpening] = useState(() => {
    const params = new URLSearchParams(location.search);
    return params.get('job_opening') || '';
  });

  const [jobs, setJobs] = useState([]);
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);

  const filterParams = useMemo(() => {
    const selected = STATUS_FILTERS.find((s) => s.id === statusFilter) || STATUS_FILTERS[0];
    const p = { ...(selected.params || {}) };
    if (jobOpening) p.job_opening = jobOpening;
    if (appliedSearch) p.search = appliedSearch;
    return p;
  }, [statusFilter, jobOpening, appliedSearch]);

  const sortedJobs = useMemo(
    () =>
      [...jobs].sort((a, b) =>
        (a.title || '').localeCompare(b.title || '', undefined, { sensitivity: 'base' }),
      ),
    [jobs],
  );

  const loadJobs = useCallback(async () => {
    try {
      const { data } = await api.get('/hr/job-openings/', { params: { limit: 300 } });
      setJobs(normalizeApiList(data));
    } catch {
      /* non-fatal */
    }
  }, []);

  const loadRows = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get('/hr/interviews/', {
        params: { ...filterParams, limit: LIMIT, offset },
      });
      const list = normalizeApiList(data);
      setTotal(typeof data.count === 'number' ? data.count : list.length);
      setRows(list);
    } catch {
      setRows([]);
      toast.error('Failed to load interviews');
    } finally {
      setLoading(false);
    }
  }, [filterParams, offset]);

  const load = useCallback(async () => {
    await Promise.all([loadJobs(), loadRows()]);
  }, [loadJobs, loadRows]);

  useEffect(() => {
    document.title = 'Interviews | HR';
    loadJobs();
  }, [loadJobs]);

  useEffect(() => {
    loadRows();
  }, [loadRows]);

  useEffect(() => {
    setOffset(0);
  }, [statusFilter, jobOpening, appliedSearch]);

  function runSearch() {
    setAppliedSearch(search.trim());
  }

  const pageCount = Math.max(1, Math.ceil(total / LIMIT));
  const pageIndex = Math.floor(offset / LIMIT) + 1;

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h1 className="flex items-center gap-2 text-2xl font-bold text-slate-900">
          <Calendar className="text-violet-600" size={22} />
          Interviews
        </h1>
        <button
          type="button"
          onClick={load}
          className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          <RefreshCw size={15} />
          Refresh
        </button>
      </div>

      <p className="text-sm text-slate-600">
        Scheduled interview slots across all candidates. Open a row to manage scheduling on the candidate profile.
      </p>

      <div className="flex flex-col gap-2 rounded-xl border border-slate-200 bg-white p-3 sm:flex-row sm:items-center">
        <div className="relative min-w-0 flex-1">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
          <input
            className="w-full rounded-lg border border-slate-200 py-2 pl-9 pr-3 text-sm"
            placeholder="Search candidate name or email"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && runSearch()}
          />
        </div>
        <select
          className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
          value={jobOpening}
          onChange={(e) => setJobOpening(e.target.value)}
        >
          <option value="">All jobs</option>
          {sortedJobs.map((j) => (
            <option key={j.id} value={j.id}>
              {j.title}
            </option>
          ))}
        </select>
        <select
          className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
        >
          {STATUS_FILTERS.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={runSearch}
          className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
        >
          Search
        </button>
      </div>

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        {loading ? (
          <div className="p-4">
            <TableSkeleton rows={6} cols={5} />
          </div>
        ) : rows.length === 0 ? (
          <div className="py-12 text-center">
            <p className="text-sm text-slate-500">No interviews found for this filter.</p>
            <Link
              to="/hr/recruitment/candidates?pipeline=interviews"
              className="mt-2 inline-block text-sm font-semibold text-violet-700 hover:underline"
            >
              View candidates in interview stage
            </Link>
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="border-b border-slate-100 bg-slate-50 text-left text-xs font-semibold uppercase text-slate-500">
                  <tr>
                    <th className="px-4 py-3">Candidate</th>
                    <th className="px-4 py-3">Job</th>
                    <th className="px-4 py-3">When</th>
                    <th className="px-4 py-3">Mode</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3 text-right"> </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {rows.map((row) => (
                    <tr key={row.id} className="hover:bg-slate-50">
                      <td className="px-4 py-3">
                        <p className="font-medium text-slate-900">{row.candidate_name || '—'}</p>
                        <p className="text-xs text-slate-500">{row.candidate_email || '—'}</p>
                      </td>
                      <td className="px-4 py-3 text-slate-700">{row.job_opening_title || '—'}</td>
                      <td className="px-4 py-3 text-slate-700">
                        {formatInterviewDateTime(row.scheduled_start, row.timezone || ATTENDANCE_TIME_ZONE)}
                        {row.duration_minutes ? (
                          <span className="block text-xs text-slate-500">{row.duration_minutes} min</span>
                        ) : null}
                      </td>
                      <td className="px-4 py-3">
                        <span className="inline-flex items-center gap-1 text-slate-700">
                          {row.mode === 'online' ? <Video size={14} className="text-violet-600" /> : null}
                          {row.mode_display || row.mode || '—'}
                        </span>
                        {row.mode === 'online' && row.meeting_link ? (
                          <a
                            href={row.meeting_link}
                            target="_blank"
                            rel="noreferrer"
                            className="mt-0.5 block text-xs font-medium text-violet-700 hover:underline"
                          >
                            Join link
                          </a>
                        ) : null}
                        {row.mode === 'offline' && row.office_address ? (
                          <p className="mt-0.5 text-xs text-slate-500">{row.office_address}</p>
                        ) : null}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`rounded-full px-2 py-0.5 text-xs font-medium ${statusBadgeClass(row.status)}`}
                        >
                          {row.status_display || row.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        {row.candidate ? (
                          <Link
                            to={`/hr/candidates/${row.candidate}`}
                            state={{ returnTo }}
                            className="text-sm font-semibold text-violet-700 hover:underline"
                          >
                            Open
                          </Link>
                        ) : (
                          '—'
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {total > LIMIT && (
              <div className="flex items-center justify-between border-t border-slate-100 px-4 py-2 text-xs text-slate-600">
                <span>
                  {pageIndex} / {pageCount} · {total} total
                </span>
                <div className="flex gap-1">
                  <button
                    type="button"
                    disabled={offset === 0}
                    onClick={() => setOffset((o) => Math.max(0, o - LIMIT))}
                    className="rounded border border-slate-200 px-2 py-1 disabled:opacity-40"
                  >
                    <ChevronLeft size={14} />
                  </button>
                  <button
                    type="button"
                    disabled={offset + LIMIT >= total}
                    onClick={() => setOffset((o) => o + LIMIT)}
                    className="rounded border border-slate-200 px-2 py-1 disabled:opacity-40"
                  >
                    <ChevronRight size={14} />
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
