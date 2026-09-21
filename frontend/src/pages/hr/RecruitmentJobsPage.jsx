import React, { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import api from '../../api';
import toast from 'react-hot-toast';
import {
  Briefcase,
  Users,
  Share2,
  Edit,
  Archive,
  Power,
  Trash2,
  RotateCcw,
  RefreshCw,
  Search,
  Map,
} from 'lucide-react';
import { getJobStatusPresentation, jobAcceptsApplications, normalizeApiList } from '../../hr/recruitmentLifecycle';
import { TableSkeleton } from '../../components/HR/HRSkeleton';
import { shareJobApplyLink } from '../../utils/shareJobApplyLink';

function jobPipelineCounts(job, candidates) {
  const jid = String(job.id);
  const forJob = candidates.filter((c) => {
    const jo = c.job_opening;
    const cid = typeof jo === 'object' && jo !== null ? jo.id ?? jo.pk : jo;
    return String(cid) === jid;
  });
  return {
    applicants: forJob.length,
    shortlisted: forJob.filter((c) => c.status === 'shortlisted').length,
    hired: forJob.filter((c) => c.status === 'hired').length,
  };
}

export default function RecruitmentJobsPage() {
  const navigate = useNavigate();
  const [jobOpenings, setJobOpenings] = useState([]);
  const [candidates, setCandidates] = useState([]);
  const [loading, setLoading] = useState(false);
  const [partial, setPartial] = useState(false);
  const [statusFilter, setStatusFilter] = useState('all');
  const [titleSearch, setTitleSearch] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setPartial(false);
      const settled = await Promise.allSettled([
        api.get(`/hr/job-openings/?status=${statusFilter}`).then((r) => r.data),
        api.get('/hr/candidates/', { params: { limit: 2000 } }).then((r) => r.data),
      ]);
      if (cancelled) return;
      const jobsData = settled[0].status === 'fulfilled' ? normalizeApiList(settled[0].value) : [];
      const candData = settled[1].status === 'fulfilled' ? normalizeApiList(settled[1].value) : [];
      setJobOpenings(jobsData);
      setCandidates(candData);
      if (settled[0].status === 'rejected') toast.error('Failed to load job openings');
      if (settled[1].status === 'rejected') {
        toast.error('Could not load candidates — pipeline counts may be wrong');
        setPartial(true);
      }
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [statusFilter]);

  const rows = useMemo(
    () =>
      jobOpenings.map((job) => ({
        job,
        ...jobPipelineCounts(job, candidates),
      })),
    [jobOpenings, candidates],
  );

  const filteredRows = useMemo(() => {
    const q = titleSearch.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(({ job }) =>
      (job.title && job.title.toLowerCase().includes(q))
      || (job.job_code && job.job_code.toLowerCase().includes(q)),
    );
  }, [rows, titleSearch]);

  function handleEditJob(job) {
    navigate(`/hr/jobs/${job.id}/edit`);
  }

  async function handleDeleteJob(job) {
    const candidateCount = job.candidate_count || 0;
    const message = candidateCount > 0
      ? `This job has ${candidateCount} candidate(s). It will be archived instead of deleted to preserve candidate data. Continue?`
      : 'Are you sure you want to permanently delete this job opening?';

    if (!window.confirm(message)) {
      return;
    }

    try {
      const response = await api.delete(`/hr/job-openings/${job.id}/`);
      if (response.data.action === 'archived') {
        toast.success(response.data.message || 'Job archived successfully');
      } else {
        toast.success(response.data.message || 'Job deleted successfully');
      }
      const jobsRes = await api.get(`/hr/job-openings/?status=${statusFilter}`);
      setJobOpenings(normalizeApiList(jobsRes.data));
    } catch (error) {
      const errorMessage = error.response?.data?.detail || error.response?.data?.error || 'Failed to process job';
      toast.error(errorMessage);
    }
  }

  async function handleCloseJob(job) {
    if (!window.confirm(`Are you sure you want to close "${job.title}"?`)) {
      return;
    }
    try {
      await api.post(`/hr/job-openings/${job.id}/close/`);
      toast.success('Job closed successfully');
      const jobsRes = await api.get(`/hr/job-openings/?status=${statusFilter}`);
      setJobOpenings(normalizeApiList(jobsRes.data));
    } catch (error) {
      toast.error(error.response?.data?.detail || error.response?.data?.error || 'Failed to close job');
    }
  }

  async function handleArchiveJob(job) {
    if (!window.confirm(`Are you sure you want to archive "${job.title}"?`)) {
      return;
    }
    try {
      await api.post(`/hr/job-openings/${job.id}/archive/`);
      toast.success('Job archived successfully');
      const jobsRes = await api.get(`/hr/job-openings/?status=${statusFilter}`);
      setJobOpenings(normalizeApiList(jobsRes.data));
    } catch (error) {
      toast.error(error.response?.data?.detail || error.response?.data?.error || 'Failed to archive job');
    }
  }

  async function handleReactivateJob(job) {
    if (!window.confirm(`Are you sure you want to reactivate "${job.title}"?`)) {
      return;
    }
    try {
      await api.post(`/hr/job-openings/${job.id}/reactivate/`);
      toast.success('Job reactivated successfully');
      const jobsRes = await api.get(`/hr/job-openings/?status=${statusFilter}`);
      setJobOpenings(normalizeApiList(jobsRes.data));
    } catch (error) {
      toast.error(error.response?.data?.detail || error.response?.data?.error || 'Failed to reactivate job');
    }
  }

  async function handleShareJob(job) {
    if (!jobAcceptsApplications(job)) {
      toast.error('This job is not accepting applications. Only open jobs can share an apply link.');
      return;
    }
    await shareJobApplyLink(job);
  }

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-800">Job openings</h2>
          <p className="mt-1 text-sm text-gray-600">
            Role overview with applicant pipeline counts. Manage postings and application links.
          </p>
          {partial && (
            <p className="mt-2 text-xs text-amber-700">
              Candidate data partially failed to load — Applicant / Shortlisted / Hired counts may be incomplete.
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={() => {
            api.get(`/hr/job-openings/?status=${statusFilter}`).then((r) => setJobOpenings(normalizeApiList(r.data)));
          }}
          className="inline-flex items-center gap-2 self-start rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs font-semibold text-gray-700 shadow-sm hover:bg-gray-50"
        >
          <RefreshCw size={14} />
          Refresh list
        </button>
      </div>

      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
        <div className="relative min-w-0 flex-1 sm:max-w-xs">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-gray-400" />
          <input
            className="w-full rounded-lg border border-gray-300 py-2 pl-9 pr-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="Search job title or code"
            value={titleSearch}
            onChange={(e) => setTitleSearch(e.target.value)}
          />
        </div>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="rounded-lg border border-gray-300 px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="all">All jobs</option>
          <option value="active">Open jobs</option>
          <option value="draft">Draft jobs</option>
          <option value="on_hold">On hold</option>
          <option value="closed">Closed jobs</option>
          <option value="archived">Archived jobs</option>
        </select>
        <button
          type="button"
          onClick={() => navigate('/hr/jobs/new')}
          className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"
        >
          <Briefcase size={16} />
          Add new job
        </button>
      </div>

      <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
        {loading ? (
          <TableSkeleton rows={7} cols={7} />
        ) : filteredRows.length === 0 ? (
          <div className="p-12 text-center">
            <Briefcase size={48} className="mx-auto mb-4 text-gray-300" />
            <p className="mb-2 font-medium text-gray-700">No job openings in this view</p>
            <p className="text-sm text-gray-500">Change the status filter, search, or add a new job.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead className="border-b border-gray-100 bg-gray-50 text-xs font-semibold uppercase tracking-wide text-gray-500">
                <tr>
                  <th className="px-4 py-3">Title</th>
                  <th className="px-4 py-3">Department</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3 text-right">Applicants</th>
                  <th className="px-4 py-3 text-right">Shortlisted</th>
                  <th className="px-4 py-3 text-right">Hired</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filteredRows.map(({ job, applicants, shortlisted, hired }) => {
                  const statusPresentation = getJobStatusPresentation(job);
                  return (
                  <tr key={job.id} className="hover:bg-gray-50/80">
                    <td className="px-4 py-3">
                      <div className="font-semibold text-gray-900">{job.title}</div>
                      <div className="text-xs font-mono text-gray-500">{job.job_code || '—'}</div>
                    </td>
                    <td className="px-4 py-3 text-gray-700">{job.department_name || '—'}</td>
                    <td className="px-4 py-3">
                      <span
                        title={statusPresentation.title || undefined}
                        className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${statusPresentation.className}`}
                      >
                        {statusPresentation.label}
                      </span>
                      {job.expiry_date && (
                        <p className="mt-1 text-xs text-gray-500">
                          Apply by {String(job.expiry_date).split('T')[0]}
                        </p>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-gray-800">{applicants}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-gray-800">{shortlisted}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-gray-800">{hired}</td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex flex-wrap items-center justify-end gap-1">
                        <Link
                          to={`/hr/journey-center?job_opening=${job.id}`}
                          title="View in Hire Staff"
                          className="rounded-lg p-1.5 text-violet-600 hover:bg-violet-50"
                        >
                          <Map size={16} />
                        </Link>
                        <button
                          type="button"
                          title="View candidates"
                          onClick={() => navigate(`/hr/recruitment/job/${job.id}/candidates`)}
                          className="rounded-lg p-1.5 text-blue-600 hover:bg-blue-50"
                        >
                          <Users size={16} />
                        </button>
                        {jobAcceptsApplications(job) ? (
                          <button
                            type="button"
                            title="Copy apply link"
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              handleShareJob(job);
                            }}
                            className="rounded-lg p-1.5 text-purple-600 hover:bg-purple-50"
                          >
                            <Share2 size={16} />
                          </button>
                        ) : (
                          <button
                            type="button"
                            title="Applications closed — link unavailable"
                            disabled
                            className="cursor-not-allowed rounded-lg p-1.5 text-gray-300"
                          >
                            <Share2 size={16} />
                          </button>
                        )}
                        <button
                          type="button"
                          title="Edit job"
                          onClick={() => handleEditJob(job)}
                          className="rounded-lg p-1.5 text-blue-600 hover:bg-blue-50"
                        >
                          <Edit size={16} />
                        </button>
                        {job.status === 'open' && (
                          <button
                            type="button"
                            title="Close job"
                            onClick={() => handleCloseJob(job)}
                            className="rounded-lg p-1.5 text-amber-600 hover:bg-amber-50"
                          >
                            <Power size={16} />
                          </button>
                        )}
                        {job.status !== 'archived' && (
                          <button
                            type="button"
                            title="Archive job"
                            onClick={() => handleArchiveJob(job)}
                            className="rounded-lg p-1.5 text-purple-600 hover:bg-purple-50"
                          >
                            <Archive size={16} />
                          </button>
                        )}
                        {(job.status === 'closed' || job.status === 'archived') && (
                          <button
                            type="button"
                            title="Reactivate job"
                            onClick={() => handleReactivateJob(job)}
                            className="rounded-lg p-1.5 text-green-600 hover:bg-green-50"
                          >
                            <RotateCcw size={16} />
                          </button>
                        )}
                        <button
                          type="button"
                          title={job.candidate_count > 0 ? 'Archive (has candidates)' : 'Delete job'}
                          onClick={() => handleDeleteJob(job)}
                          className="rounded-lg p-1.5 text-red-600 hover:bg-red-50"
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
