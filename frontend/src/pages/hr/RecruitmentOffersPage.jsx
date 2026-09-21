import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import api, { USE_NEW_OFFER_BUILDER } from '../../api';
import toast from 'react-hot-toast';
import { FileText, RefreshCw, Search } from 'lucide-react';
import { normalizeApiList } from '../../hr/recruitmentLifecycle';
import { TableSkeleton } from '../../components/HR/HRSkeleton';

function candidateKey(value) {
  if (!value) return null;
  if (typeof value === 'object' && value.id != null) return String(value.id);
  return String(value);
}

/** Merge Offer rows with Offer Builder V2 drafts into one recruitment list. */
function mergeOffersAndBuilderDrafts(offers, builders) {
  const offerByCandidate = new Map();
  const builderByCandidate = new Map();
  offers.forEach((o) => {
    const key = candidateKey(o.candidate);
    if (key) offerByCandidate.set(key, o);
  });
  // API returns newest drafts first — keep the first match per candidate.
  builders.forEach((b) => {
    const key = candidateKey(b.candidate);
    if (key && !builderByCandidate.has(key)) builderByCandidate.set(key, b);
  });

  const merged = offers.map((o) => {
    const linkedBuilder = candidateKey(o.candidate)
      ? builderByCandidate.get(candidateKey(o.candidate))
      : null;
    return {
      ...o,
      source: 'offer',
      rowKey: `offer-${o.id}`,
      builder_id: linkedBuilder?.id ?? null,
    };
  });

  builders.forEach((b) => {
    const candId = candidateKey(b.candidate);
    const linkedOffer = candId ? offerByCandidate.get(candId) : null;
    if (b.is_sent && linkedOffer) return;

    merged.push({
      id: b.id,
      source: 'builder',
      rowKey: `builder-${b.id}`,
      candidate: b.candidate,
      candidate_name: b.candidate_name,
      job_title: b.job_title,
      status: b.is_sent ? 'sent' : 'draft',
      status_display: b.is_sent ? 'Sent' : 'Draft',
      offer_expiry_date: linkedOffer?.offer_expiry_date ?? null,
      created_at: b.created_at,
      is_sent: b.is_sent,
    });
  });

  return merged.sort(
    (a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime(),
  );
}

const STATUSES = [
  { id: 'all', label: 'All' },
  { id: 'draft', label: 'Draft' },
  { id: 'created', label: 'Created' },
  { id: 'sent', label: 'Sent' },
  { id: 'accepted', label: 'Accepted' },
  { id: 'rejected', label: 'Rejected' },
  { id: 'expired', label: 'Expired' },
];

function todayISODate() {
  return new Date().toISOString().slice(0, 10);
}

function isOfferExpired(o) {
  if (!o.offer_expiry_date) return false;
  if (['accepted', 'rejected'].includes(o.status)) return false;
  return o.offer_expiry_date < todayISODate();
}

function displayStatus(o) {
  if (isOfferExpired(o)) return 'Expired';
  return o.status_display || o.status || '—';
}

function statusBadgeClass(o) {
  if (isOfferExpired(o)) return 'bg-rose-100 text-rose-900';
  switch (o.status) {
    case 'accepted': return 'bg-emerald-100 text-emerald-900';
    case 'rejected': return 'bg-red-100 text-red-800';
    case 'sent': return 'bg-amber-100 text-amber-900';
    default: return 'bg-slate-100 text-slate-800';
  }
}

export default function RecruitmentOffersPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const [offers, setOffers] = useState([]);
  const [jobs, setJobs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState('all');
  const [search, setSearch] = useState('');
  const [appliedSearch, setAppliedSearch] = useState('');
  const [jobOpening, setJobOpening] = useState(() => searchParams.get('job_opening') || '');

  const jobParams = useMemo(() => {
    const p = { limit: 500 };
    if (jobOpening) p.job_opening = jobOpening;
    return p;
  }, [jobOpening]);

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

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [offersRes, buildersRes] = await Promise.all([
        api.get('/hr/offers/', { params: jobParams }),
        api.get('/hr/offer-builder-v2/', { params: jobParams }),
      ]);
      const offerRows = normalizeApiList(offersRes.data);
      const builderRows = normalizeApiList(buildersRes.data);
      setOffers(mergeOffersAndBuilderDrafts(offerRows, builderRows));
    } catch {
      setOffers([]);
      toast.error('Failed to load offers');
    } finally {
      setLoading(false);
    }
  }, [jobParams]);

  useEffect(() => {
    document.title = 'Offers | HR';
    loadJobs();
  }, [loadJobs]);

  useEffect(() => {
    load();
  }, [load]);

  const counts = useMemo(() => {
    const c = { all: offers.length };
    STATUSES.forEach((s) => {
      if (s.id === 'all') return;
      if (s.id === 'expired') {
        c.expired = offers.filter(isOfferExpired).length;
      } else {
        c[s.id] = offers.filter((o) => o.status === s.id && !isOfferExpired(o)).length;
      }
    });
    return c;
  }, [offers]);

  const filtered = useMemo(() => {
    let list = offers;
    if (status === 'expired') {
      list = list.filter(isOfferExpired);
    } else if (status !== 'all') {
      list = list.filter((o) => o.status === status && !isOfferExpired(o));
    }
    const q = appliedSearch.trim().toLowerCase();
    if (!q) return list;
    return list.filter(
      (o) =>
        (o.candidate_name && o.candidate_name.toLowerCase().includes(q))
        || (o.job_title && o.job_title.toLowerCase().includes(q)),
    );
  }, [offers, status, appliedSearch]);

  function runSearch() {
    setAppliedSearch(search);
  }

  function openOffer(row) {
    const builderId = row.source === 'builder' ? row.id : row.builder_id;
    if (builderId) {
      navigate(`/hr/builder/${builderId}`);
      return;
    }
    const candidateId = candidateKey(row.candidate);
    if (USE_NEW_OFFER_BUILDER && candidateId) {
      navigate(`/hr/builder?candidate_id=${candidateId}`);
      return;
    }
    if (row.source === 'offer' && row.id) {
      navigate(`/hr/builder?offer_id=${row.id}`);
      return;
    }
    navigate('/hr/builder');
  }

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h1 className="flex items-center gap-2 text-2xl font-bold text-slate-900">
          <FileText className="text-violet-600" size={22} />
          Offers
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
            placeholder="Search candidate or job"
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
          value={status}
          onChange={(e) => setStatus(e.target.value)}
        >
          {STATUSES.map((s) => {
            const n = counts[s.id];
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
        ) : filtered.length === 0 ? (
          <p className="py-12 text-center text-sm text-slate-500">No offers found.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="border-b border-slate-100 bg-slate-50 text-left text-xs font-semibold uppercase text-slate-500">
                <tr>
                  <th className="px-4 py-3">Candidate</th>
                  <th className="px-4 py-3">Job</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3 text-right"> </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.map((o) => (
                  <tr key={o.rowKey || o.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3 font-medium text-slate-900">{o.candidate_name || '—'}</td>
                    <td className="px-4 py-3 text-slate-700">{o.job_title || '—'}</td>
                    <td className="px-4 py-3">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${statusBadgeClass(o)}`}>
                        {displayStatus(o)}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        type="button"
                        onClick={() => openOffer(o)}
                        className="text-sm font-semibold text-violet-700 hover:underline"
                      >
                        Open
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
