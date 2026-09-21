import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useSearchParams } from 'react-router-dom';
import api from '../../api';
import toast from 'react-hot-toast';
import { ChevronLeft, ChevronRight, RefreshCw, Search, Users } from 'lucide-react';
import { normalizeApiList } from '../../hr/recruitmentLifecycle';
import { TableSkeleton } from '../../components/HR/HRSkeleton';
import CandidateBulkToolbar from '../../components/HR/CandidateBulkToolbar';

const LIMIT = 25;

const STAGES = [
  { id: 'all', label: 'All' },
  { id: 'applied', label: 'Applied & rejected' },
  { id: 'shortlisted', label: 'Shortlisted' },
  { id: 'interviews', label: 'Interview' },
  { id: 'selected', label: 'Selected' },
  { id: 'offer_sent', label: 'Offer sent' },
  { id: 'offer_accepted', label: 'Accepted' },
  { id: 'hired', label: 'Hired' },
  { id: 'rejected', label: 'Rejected' },
];

function stageBadgeClass(stage) {
  const map = {
    applied: 'bg-slate-100 text-slate-800',
    shortlisted: 'bg-sky-100 text-sky-900',
    interview_scheduled: 'bg-violet-100 text-violet-900',
    interview_pending: 'bg-indigo-100 text-indigo-900',
    interview_completed: 'bg-purple-100 text-purple-900',
    selected: 'bg-emerald-100 text-emerald-900',
    offer_sent: 'bg-amber-100 text-amber-950',
    offer_accepted: 'bg-green-100 text-green-900',
    offer_declined: 'bg-red-100 text-red-800',
    hired: 'bg-teal-100 text-teal-900',
    rejected: 'bg-red-100 text-red-900',
  };
  return map[stage] || 'bg-slate-100 text-slate-700';
}

export default function RecruitmentCandidatesPage() {
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const candidatesReturnTo = `${location.pathname}${location.search}`;

  const [stage, setStage] = useState(() => searchParams.get('pipeline') || 'all');
  const [search, setSearch] = useState('');
  const [appliedSearch, setAppliedSearch] = useState('');
  const [jobOpening, setJobOpening] = useState(() => searchParams.get('job_opening') || '');

  const [jobs, setJobs] = useState([]);
  const [counts, setCounts] = useState({});
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [selectedIds, setSelectedIds] = useState(() => new Set());

  const filterParams = useMemo(() => {
    const p = {};
    if (jobOpening) p.job_opening = jobOpening;
    if (appliedSearch) p.search = appliedSearch;
    if (stage !== 'all') p.pipeline = stage;
    return p;
  }, [jobOpening, appliedSearch, stage]);

  const countParams = useMemo(() => {
    const { pipeline, search: _s, ...rest } = filterParams;
    return rest;
  }, [filterParams]);

  const sortedJobs = useMemo(
    () =>
      [...jobs].sort((a, b) =>
        (a.title || '').localeCompare(b.title || '', undefined, { sensitivity: 'base' }),
      ),
    [jobs],
  );

  const loadMeta = useCallback(async () => {
    try {
      const [jr, cr] = await Promise.all([
        api.get('/hr/job-openings/', { params: { limit: 300 } }),
        api.get('/hr/candidates/pipeline_counts/', { params: countParams }),
      ]);
      setJobs(normalizeApiList(jr.data));
      setCounts(cr.data || {});
    } catch {
      /* non-fatal */
    }
  }, [countParams]);

  const loadRows = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get('/hr/candidates/', {
        params: { ...filterParams, limit: LIMIT, offset },
      });
      const list = normalizeApiList(data);
      setTotal(typeof data.count === 'number' ? data.count : list.length);
      setRows(list);
    } catch {
      setRows([]);
      toast.error('Failed to load candidates');
    } finally {
      setLoading(false);
    }
  }, [filterParams, offset]);

  const load = useCallback(async () => {
    await Promise.all([loadMeta(), loadRows()]);
  }, [loadMeta, loadRows]);

  useEffect(() => {
    document.title = 'Candidates | HR';
    loadMeta();
  }, [loadMeta]);

  useEffect(() => {
    loadRows();
  }, [loadRows]);

  useEffect(() => {
    setOffset(0);
    setSelectedIds(new Set());
  }, [stage, jobOpening, appliedSearch]);

  function runSearch() {
    setAppliedSearch(search.trim());
  }

  const selectedList = useMemo(() => rows.filter((c) => selectedIds.has(c.id)), [rows, selectedIds]);

  const toggleRow = (id) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectPage = () => {
    const ids = rows.map((r) => r.id);
    const allOn = ids.length && ids.every((id) => selectedIds.has(id));
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (allOn) ids.forEach((id) => next.delete(id));
      else ids.forEach((id) => next.add(id));
      return next;
    });
  };

  const pageCount = Math.max(1, Math.ceil(total / LIMIT));
  const pageIndex = Math.floor(offset / LIMIT) + 1;

  return (
    <div className="mx-auto max-w-6xl space-y-4 pb-28">
      <div className="flex items-center justify-between gap-3">
        <h1 className="flex items-center gap-2 text-2xl font-bold text-slate-900">
          <Users className="text-violet-600" size={22} />
          Candidates
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

      <div className="flex flex-col gap-2 rounded-xl border border-slate-200 bg-white p-3 sm:flex-row sm:items-center">
        <div className="relative min-w-0 flex-1">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
          <input
            className="w-full rounded-lg border border-slate-200 py-2 pl-9 pr-3 text-sm"
            placeholder="Search name or email"
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
          value={stage}
          onChange={(e) => setStage(e.target.value)}
        >
          {STAGES.map((s) => {
            const n = s.id === 'all' ? counts.all : counts[s.id];
            const suffix = typeof n === 'number' ? ` (${n})` : '';
            return (
              <option key={s.id} value={s.id}>
                {s.label}
                {suffix}
              </option>
            );
          })}
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
            <TableSkeleton rows={6} cols={4} />
          </div>
        ) : rows.length === 0 ? (
          <p className="py-12 text-center text-sm text-slate-500">No candidates found.</p>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="border-b border-slate-100 bg-slate-50 text-left text-xs font-semibold uppercase text-slate-500">
                  <tr>
                    <th className="w-10 px-4 py-3">
                      <input
                        type="checkbox"
                        checked={rows.length > 0 && rows.every((r) => selectedIds.has(r.id))}
                        onChange={toggleSelectPage}
                        className="h-4 w-4 rounded border-slate-300 text-violet-600"
                        aria-label="Select all"
                      />
                    </th>
                    <th className="px-4 py-3">Name</th>
                    <th className="px-4 py-3">Job</th>
                    <th className="px-4 py-3">Stage</th>
                    <th className="px-4 py-3 text-right"> </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {rows.map((c) => (
                    <tr key={c.id} className="hover:bg-slate-50">
                      <td className="px-4 py-3">
                        <input
                          type="checkbox"
                          checked={selectedIds.has(c.id)}
                          onChange={() => toggleRow(c.id)}
                          className="h-4 w-4 rounded border-slate-300 text-violet-600"
                        />
                      </td>
                      <td className="px-4 py-3">
                        <p className="font-medium text-slate-900">{c.name}</p>
                        <p className="text-xs text-slate-500">{c.email}</p>
                      </td>
                      <td className="px-4 py-3 text-slate-700">{c.job_opening_title || '—'}</td>
                      <td className="px-4 py-3">
                        <span
                          className={`rounded-full px-2 py-0.5 text-xs font-medium ${stageBadgeClass(
                            c.pipeline_stage,
                          )}`}
                        >
                          {c.pipeline_stage_display || c.pipeline_stage}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <Link
                          to={`/hr/candidates/${c.id}`}
                          state={{ returnTo: candidatesReturnTo }}
                          className="text-sm font-semibold text-violet-700 hover:underline"
                        >
                          Open
                        </Link>
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

      <CandidateBulkToolbar
        selectedList={selectedList}
        selectedCount={selectedIds.size}
        listFilterParams={filterParams}
        onClear={() => setSelectedIds(new Set())}
        onFinished={() => {
          setSelectedIds(new Set());
          load();
        }}
      />
    </div>
  );
}
