import React, { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import api from '../../api';
import toast from 'react-hot-toast';
import { CheckCircle2, ClipboardCheck, RefreshCw, X, XCircle } from 'lucide-react';
import { normalizeApiList } from '../../hr/recruitmentLifecycle';
import { TableSkeleton } from '../../components/HR/HRSkeleton';
import { formatAttendanceDateTime } from '../../utils/timeDisplay';
import { BackToEmployeeLink } from './employeeDetail/EmployeeDetailUi';

function fmt(value) {
  if (!value) return '--';
  return formatAttendanceDateTime(value);
}

function errorText(error, fallback) {
  const data = error?.response?.data;
  if (!data) return fallback;
  return data.error || data.detail || fallback;
}

export default function RegularizationRequestsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const initialStatus = searchParams.get('status') || 'pending';
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState([]);
  const [status, setStatus] = useState(initialStatus);
  const [processingId, setProcessingId] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get('/hr/attendance-regularizations/', {
        params: { status: status || undefined, limit: 500, _t: Date.now() },
      });
      setRows(normalizeApiList(data));
    } catch {
      toast.error('Failed to load regularization requests');
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [status]);

  useEffect(() => {
    load();
  }, [load]);

  async function decide(row, action) {
    const remarks = window.prompt(action === 'approve' ? 'Approval remarks (optional)' : 'Rejection remarks (optional)', '');
    if (remarks === null) return;

    setProcessingId(row.id);
    try {
      await api.post(`/hr/attendance-regularizations/${row.id}/${action}/`, { remarks: remarks || '' });
      toast.success(`Request ${action}d`);
      await load();
    } catch (error) {
      toast.error(errorText(error, `Could not ${action} request`));
    } finally {
      setProcessingId(null);
    }
  }

  function clearStatusFilter() {
    setSearchParams({});
    setStatus('');
  }

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <BackToEmployeeLink />
          <h1 className="text-2xl font-bold text-slate-900">Regularization Requests</h1>
          <p className="text-sm text-slate-600">Review missed check-in/check-out correction requests and preserve audit history.</p>
        </div>
        <button onClick={load} className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 shadow-sm hover:bg-slate-50">
          <RefreshCw size={16} /> Refresh
        </button>
      </div>

      {searchParams.get('status') && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-violet-200 bg-violet-50 px-3 py-2 text-sm text-violet-900">
          <span>
            Showing: <strong>{status || 'all'} requests</strong>
          </span>
          <button
            type="button"
            onClick={clearStatusFilter}
            className="inline-flex items-center gap-1 rounded-lg border border-violet-200 bg-white px-2 py-1 text-xs font-semibold text-violet-800 hover:bg-violet-100"
          >
            <X size={12} />
            Clear filter
          </button>
        </div>
      )}

      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <select className="rounded-xl border border-slate-200 px-3 py-2 text-sm" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">All requests</option>
          <option value="pending">Pending</option>
          <option value="approved">Approved</option>
          <option value="rejected">Rejected</option>
        </select>
        <button onClick={load} className="ml-2 rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white">Apply</button>
      </div>

      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-100 px-5 py-4">
          <h2 className="flex items-center gap-2 font-semibold text-slate-900"><ClipboardCheck size={18} /> Requests</h2>
        </div>
        {loading ? (
          <div className="p-5"><TableSkeleton rows={6} cols={6} /></div>
        ) : rows.length === 0 ? (
          <div className="p-10 text-center text-slate-500">
            <ClipboardCheck className="mx-auto mb-2 h-10 w-10 text-slate-300" />
            <p className="font-semibold text-slate-800">No regularization requests</p>
            <p className="mt-1 text-sm">Missed punch requests will appear here for HR approval.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead className="border-b border-slate-100 bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-3">Employee</th>
                  <th className="px-4 py-3">Requested Check-In</th>
                  <th className="px-4 py-3">Requested Check-Out</th>
                  <th className="px-4 py-3">Reason</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((row) => (
                  <tr key={row.id}>
                    <td className="px-4 py-3 font-semibold text-slate-900">{row.employee_name}</td>
                    <td className="px-4 py-3">{fmt(row.requested_check_in)}</td>
                    <td className="px-4 py-3">{fmt(row.requested_check_out)}</td>
                    <td className="px-4 py-3 text-slate-600">{row.reason}</td>
                    <td className="px-4 py-3">
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-700">{row.status}</span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      {row.status === 'pending' && (
                        <div className="flex justify-end gap-2">
                          {processingId === row.id ? (
                            <span className="inline-flex items-center gap-2 rounded-lg bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-500">
                              <RefreshCw size={14} className="animate-spin" /> Processing...
                            </span>
                          ) : (
                            <>
                              <button disabled={processingId !== null} onClick={() => decide(row, 'approve')} className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"><CheckCircle2 size={14} /> Approve</button>
                              <button disabled={processingId !== null} onClick={() => decide(row, 'reject')} className="inline-flex items-center gap-1 rounded-lg bg-red-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"><XCircle size={14} /> Reject</button>
                            </>
                          )}
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
