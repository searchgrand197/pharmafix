import React, { useState, useEffect, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import HRPageWrapper from '../components/HR/HRPageWrapper';
import api from '../api';
import toast from 'react-hot-toast';
import { Users, ArrowLeft, Download, Briefcase, UserCheck, UserX, Calendar, Award } from 'lucide-react';
import ReusableTable from '../components/HR/ReusableTable';
import ReusableCard from '../components/HR/ReusableCard';
import CandidateBulkToolbar from '../components/HR/CandidateBulkToolbar';
import { getJobStatusPresentation } from '../hr/recruitmentLifecycle';

export default function JobCandidates() {
  const { jobId } = useParams();
  const navigate = useNavigate();
  const [candidates, setCandidates] = useState([]);
  const [job, setJob] = useState(null);
  const [loading, setLoading] = useState(false);
  const [statusFilter, setStatusFilter] = useState('all');
  const [statusCounts, setStatusCounts] = useState({});
  const [selectedIds, setSelectedIds] = useState(() => new Set());

  const selectedList = useMemo(
    () => candidates.filter((c) => selectedIds.has(c.id)),
    [candidates, selectedIds],
  );

  useEffect(() => {
    fetchJobDetails();
    fetchCandidates();
    fetchStatusCounts();
  }, [jobId, statusFilter]);

  async function fetchJobDetails() {
    try {
      const { data } = await api.get(`/hr/job-openings/${jobId}/`);
      setJob(data);
    } catch (error) {
      toast.error('Failed to load job details');
    }
  }

  async function fetchCandidates() {
    setLoading(true);
    try {
      const statusParam = statusFilter !== 'all' ? `&status=${statusFilter}` : '';
      const { data } = await api.get(`/hr/candidates/?job_id=${jobId}${statusParam}`);
      setCandidates(data.results || data);
      setSelectedIds(new Set());
    } catch (error) {
      toast.error('Failed to load candidates');
    } finally {
      setLoading(false);
    }
  }

  async function fetchStatusCounts() {
    try {
      const { data } = await api.get(`/hr/candidates/status_counts/?job_id=${jobId}`);
      setStatusCounts(data);
    } catch (error) {
      console.error('Failed to fetch status counts');
    }
  }

  const handleViewResume = (resumeUrl) => {
    if (resumeUrl) {
      window.open(resumeUrl, '_blank');
    } else {
      toast.error('No resume available');
    }
  };

  const handleDownloadResume = async (resumeUrl) => {
    if (resumeUrl) {
      const baseUrl = import.meta.env.VITE_API_URL || 'http://localhost:8000';
      let fullUrl;
      
      if (resumeUrl.startsWith('http')) {
        fullUrl = resumeUrl;
      } else {
        const path = resumeUrl.startsWith('/') ? resumeUrl : `/${resumeUrl}`;
        fullUrl = `${baseUrl}${path}`;
      }
      
      try {
        const response = await fetch(fullUrl);
        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = 'resume.pdf';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        window.URL.revokeObjectURL(url);
      } catch (error) {
        console.error('Download failed:', error);
        toast.error('Failed to download resume');
      }
    } else {
      toast.error('No resume available');
    }
  };

  const toggleRow = (id) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    const ids = candidates.map((c) => c.id);
    const allOn = ids.length && ids.every((id) => selectedIds.has(id));
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (allOn) ids.forEach((id) => next.delete(id));
      else ids.forEach((id) => next.add(id));
      return next;
    });
  };

  const columns = [
    { header: 'Candidate ID', render: (row) => row.candidate_id || '—' },
    { header: 'Application ID', render: (row) => row.application_id || '—' },
    { header: 'Name', render: (row) => row.name || 'N/A' },
    { header: 'Email', render: (row) => row.email || 'N/A' },
    { header: 'Phone', render: (row) => row.phone || 'N/A' },
    { header: 'Status', render: (row) => (
      <span className={`px-2 py-1 text-xs font-semibold rounded-full ${
        row.status === 'applied' ? 'bg-blue-100 text-blue-700' :
        row.status === 'shortlisted' ? 'bg-green-100 text-green-700' :
        row.status === 'interview' ? 'bg-purple-100 text-purple-700' :
        row.status === 'selected' ? 'bg-emerald-100 text-emerald-700' :
        row.status === 'hired' ? 'bg-amber-100 text-amber-700' :
        'bg-red-100 text-red-700'
      }`}>
        {row.status_display || row.status || 'N/A'}
      </span>
    )},
    { header: 'Actions', render: (row) => (
      <div className="flex gap-2">
        <button
          onClick={() =>
            navigate(`/hr/candidates/${row.id}`, {
              state: { returnTo: `/hr/recruitment/job/${jobId}/candidates` },
            })
          }
          className="px-3 py-1.5 text-xs font-medium text-blue-600 bg-blue-50 hover:bg-blue-100 rounded-lg transition-colors"
        >
          View
        </button>
        <button
          onClick={() => handleDownloadResume(row.resume)}
          disabled={!row.resume}
          className={`px-3 py-1.5 text-xs font-medium text-green-600 bg-green-50 hover:bg-green-100 rounded-lg transition-colors ${
            !row.resume ? 'opacity-50 cursor-not-allowed' : ''
          }`}
        >
          Download
        </button>
      </div>
    )},
  ];

  return (
    <HRPageWrapper color="purple" layoutSidebar={true}>
      <div className="max-w-6xl mx-auto pb-28 animate-in fade-in slide-in-from-bottom-4 duration-300">
        <div className="mb-6">
          <button
            onClick={() => navigate('/hr/recruitment/jobs')}
            className="flex items-center gap-2 text-sm font-medium text-gray-600 hover:text-gray-800 transition-colors"
          >
            <ArrowLeft size={16} />
            Back to Recruitment
          </button>
        </div>

        {job && (
          <div className="bg-gradient-to-br from-purple-50 to-white border border-purple-100 rounded-xl p-6 mb-6 shadow-sm">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-xs font-mono text-purple-600 mb-1">{job.job_code || 'N/A'}</p>
                <h1 className="text-2xl font-bold text-gray-800 mb-2">{job.title}</h1>
                <p className="text-gray-600">{job.description || 'No description provided'}</p>
              </div>
              <span
                title={getJobStatusPresentation(job).title || undefined}
                className={`px-3 py-1.5 text-sm font-semibold rounded-full ${getJobStatusPresentation(job).className}`}
              >
                {getJobStatusPresentation(job).label}
              </span>
            </div>
          </div>
        )}

        {/* Status Filter Tabs */}
        <div className="mb-6">
          <div className="flex flex-wrap gap-2">
            {[
              { key: 'all', label: 'All', icon: Users, count: Object.values(statusCounts).reduce((a, b) => a + b, 0) },
              { key: 'applied', label: 'Applied', icon: Briefcase, count: statusCounts.applied || 0 },
              { key: 'shortlisted', label: 'Shortlisted', icon: UserCheck, count: statusCounts.shortlisted || 0 },
              { key: 'interview', label: 'Interview', icon: Calendar, count: statusCounts.interview || 0 },
              { key: 'selected', label: 'Selected', icon: Award, count: statusCounts.selected || 0 },
              { key: 'rejected', label: 'Rejected', icon: UserX, count: statusCounts.rejected || 0 },
              { key: 'hired', label: 'Hired', icon: Award, count: statusCounts.hired || 0 },
            ].map((tab) => (
              <button
                key={tab.key}
                onClick={() => setStatusFilter(tab.key)}
                className={`flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
                  statusFilter === tab.key
                    ? 'bg-purple-600 text-white'
                    : 'bg-white text-gray-600 hover:bg-gray-50 border border-gray-200'
                }`}
              >
                <tab.icon size={16} />
                <span>{tab.label}</span>
                <span className={`px-2 py-0.5 text-xs rounded-full ${
                  statusFilter === tab.key ? 'bg-white/20' : 'bg-gray-100'
                }`}>
                  {tab.count}
                </span>
              </button>
            ))}
          </div>
        </div>

          <ReusableCard title={`${statusFilter === 'all' ? 'All' : statusFilter.charAt(0).toUpperCase() + statusFilter.slice(1)} Candidates`} icon={Users} theme="purple">
          {loading ? (
            <div className="p-8 text-center text-gray-500">Loading candidates...</div>
          ) : candidates.length === 0 ? (
            <div className="p-8 text-center text-gray-500">
              <Users size={48} className="mx-auto mb-4 text-gray-300" />
              <p className="font-medium text-gray-700 mb-2">No candidates applied yet</p>
              <p className="text-sm text-gray-500">Share the application link to start receiving applications</p>
            </div>
          ) : (
            <ReusableTable
              leadingColumn={{
                header: (
                  <input
                    type="checkbox"
                    aria-label="Select all"
                    checked={candidates.every((c) => selectedIds.has(c.id))}
                    onChange={toggleSelectAll}
                    className="h-4 w-4 rounded border-gray-300 text-purple-600 focus:ring-purple-500"
                  />
                ),
                render: (row) => (
                  <input
                    type="checkbox"
                    aria-label={`Select ${row.name}`}
                    checked={selectedIds.has(row.id)}
                    onChange={() => toggleRow(row.id)}
                    className="h-4 w-4 rounded border-gray-300 text-purple-600 focus:ring-purple-500"
                  />
                ),
              }}
              columns={columns}
              data={candidates}
            />
          )}
        </ReusableCard>

        <CandidateBulkToolbar
          selectedList={selectedList}
          selectedCount={selectedIds.size}
          listFilterParams={{
            job_id: jobId,
            ...(statusFilter !== 'all' ? { status: statusFilter } : {}),
          }}
          onClear={() => setSelectedIds(new Set())}
          onFinished={() => {
            setSelectedIds(new Set());
            fetchCandidates();
            fetchStatusCounts();
          }}
        />
      </div>
    </HRPageWrapper>
  );
}
