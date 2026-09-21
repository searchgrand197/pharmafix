import React, { useCallback, useEffect, useMemo, useState } from 'react';
import api from '../../../api';
import toast from 'react-hot-toast';
import { Calendar, RefreshCw } from 'lucide-react';
import ReusableTable from '../../../components/HR/ReusableTable';
import ReusableCard from '../../../components/HR/ReusableCard';
import { useOutletContext, useSearchParams } from 'react-router-dom';
import { TableSkeleton } from '../../../components/HR/HRSkeleton';
import { BackToEmployeeLink } from '../employeeDetail/EmployeeDetailUi';
import { STATUS_BADGE, errorText, normalizeList } from './leaveUtils';

const STATUS_FILTERS = [
  { key: '', label: 'All' },
  { key: 'PENDING', label: 'Pending' },
  { key: 'APPROVED', label: 'Approved' },
  { key: 'REJECTED', label: 'Rejected' },
  { key: 'CANCELLED', label: 'Cancelled' },
];

export default function LeaveRequestsPage() {
  const { theme = 'purple' } = useOutletContext() || {};
  const [searchParams] = useSearchParams();
  const initialStatus = (searchParams.get('status') || 'PENDING').toUpperCase();
  const [loading, setLoading] = useState(true);
  const [leaves, setLeaves] = useState([]);
  const [statusFilter, setStatusFilter] = useState(initialStatus);
  const [search, setSearch] = useState('');
  const [reviewModal, setReviewModal] = useState(null);
  const [remarks, setRemarks] = useState('');
  const [reviewing, setReviewing] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const params = {};
    if (statusFilter) params.status = statusFilter;
    if (search) params.search = search;
    try {
      const res = await api.get('/hr/leave-requests/', { params });
      setLeaves(normalizeList(res.data));
    } catch {
      setLeaves([]);
      toast.error('Failed to load leave requests');
    }
    setLoading(false);
  }, [statusFilter, search]);

  useEffect(() => {
    document.title = 'Leave Requests | HR';
    load();
  }, [load]);

  const pendingCount = useMemo(
    () => leaves.filter((row) => row.status === 'PENDING').length,
    [leaves],
  );

  async function reviewLeave(action) {
    if (!reviewModal || reviewing) return;
    setReviewing(true);
    try {
      await api.post(`/hr/leave-requests/${reviewModal.id}/${action}/`, { remarks });
      toast.success(`Leave ${action === 'approve' ? 'approved' : 'rejected'}`);
      setReviewModal(null);
      setRemarks('');
      load();
    } catch (err) {
      toast.error(errorText(err, `Failed to ${action} leave`));
    } finally {
      setReviewing(false);
    }
  }

  const columns = [
    { header: 'Employee', accessor: 'employee_name' },
    { header: 'Type', accessor: 'leave_type_name' },
    { header: 'Start', accessor: 'start_date' },
    { header: 'End', accessor: 'end_date' },
    { header: 'Days', accessor: 'number_of_days' },
    { header: 'Balance', accessor: 'remaining_balance' },
    {
      header: 'Status',
      render: (row) => (
        <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${STATUS_BADGE[row.status] || STATUS_BADGE.PENDING}`}>
          {row.status_display || row.status}
        </span>
      ),
    },
    {
      header: 'Actions',
      render: (row) => (
        row.status === 'PENDING' ? (
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => { setReviewModal(row); setRemarks(''); }} className="rounded-lg bg-green-600 px-3 py-1.5 text-xs font-semibold text-white">Review</button>
            {row.attachment_url && (
              <a href={row.attachment_url} target="_blank" rel="noreferrer" className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-semibold text-gray-700">Attachment</a>
            )}
          </div>
        ) : (
          <span className="text-xs text-gray-500">{row.remarks || 'Reviewed'}</span>
        )
      ),
    },
  ];

  return (
    <div className="mx-auto max-w-7xl space-y-6 px-4 pb-10 pt-2">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <BackToEmployeeLink />
          <h1 className="flex items-center gap-2 text-2xl font-bold text-gray-900">
            <Calendar size={24} className="text-purple-600" /> Leave Requests
          </h1>
          <p className="mt-1 text-sm text-gray-600">
            Review employee requests. {statusFilter === 'PENDING' && pendingCount > 0 ? `${pendingCount} pending in view.` : ''}
          </p>
        </div>
        <button type="button" onClick={load} className="inline-flex min-h-[44px] items-center gap-2 rounded-xl border border-gray-200 px-4 text-sm font-semibold text-gray-700">
          <RefreshCw size={16} /> Refresh
        </button>
      </header>

      <div className="flex flex-wrap gap-2">
        {STATUS_FILTERS.map((f) => (
          <button
            key={f.key || 'all'}
            type="button"
            onClick={() => setStatusFilter(f.key)}
            className={`min-h-[40px] rounded-xl border px-4 text-sm font-semibold ${statusFilter === f.key ? 'border-purple-600 bg-purple-50 text-purple-800' : 'border-gray-200 text-gray-700'}`}
          >
            {f.label}
          </button>
        ))}
      </div>

      <input
        type="search"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search employee or reason"
        className="min-h-[44px] w-full max-w-md rounded-xl border border-gray-200 px-3 text-sm"
      />

      <ReusableCard title="Leave request queue" icon={Calendar} theme={theme}>
        {loading ? <TableSkeleton rows={5} /> : <ReusableTable columns={columns} data={leaves} />}
      </ReusableCard>

      {reviewModal && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center">
          <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-xl">
            <h3 className="text-lg font-semibold text-gray-900">Review leave request</h3>
            <p className="mt-1 text-sm text-gray-600">
              {reviewModal.employee_name} · {reviewModal.leave_type_name} · {reviewModal.start_date} → {reviewModal.end_date}
            </p>
            {reviewModal.reason && <p className="mt-2 text-sm text-gray-700">Reason: {reviewModal.reason}</p>}
            <label className="mt-4 block text-sm font-medium text-gray-700">
              HR remarks
              <textarea value={remarks} onChange={(e) => setRemarks(e.target.value)} rows={3} className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2 text-sm" placeholder="Optional comments for employee" />
            </label>
            <div className="mt-4 flex flex-col gap-2 sm:flex-row">
              <button type="button" onClick={() => reviewLeave('approve')} disabled={reviewing} className="min-h-[44px] flex-1 rounded-xl bg-green-600 text-sm font-semibold text-white disabled:opacity-50">Approve</button>
              <button type="button" onClick={() => reviewLeave('reject')} disabled={reviewing} className="min-h-[44px] flex-1 rounded-xl bg-red-600 text-sm font-semibold text-white disabled:opacity-50">Reject</button>
              <button type="button" onClick={() => setReviewModal(null)} disabled={reviewing} className="min-h-[44px] rounded-xl border border-gray-200 text-sm font-semibold text-gray-700 disabled:opacity-50">Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
