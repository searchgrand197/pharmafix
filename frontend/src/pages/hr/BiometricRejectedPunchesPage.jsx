import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../../api';
import toast from 'react-hot-toast';
import { AlertTriangle, RefreshCw, X } from 'lucide-react';
import { normalizeApiList } from '../../hr/recruitmentLifecycle';
import ReusableTable from '../../components/HR/ReusableTable';
import { TableSkeleton } from '../../components/HR/HRSkeleton';
import { BackToEmployeeLink } from './employeeDetail/EmployeeDetailUi';

function formatDateTime(value) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString();
}

export default function BiometricRejectedPunchesPage() {
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState([]);
  const [dismissingId, setDismissingId] = useState(null);
  const [dismissingAll, setDismissingAll] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get('/hr/biometric-rejected-punches/', {
        params: { limit: 500 },
      });
      setRows(normalizeApiList(data));
    } catch {
      toast.error('Failed to load rejected biometric punches');
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    document.title = 'Rejected biometric punches | HR';
    load();
  }, [load]);

  const dismissOne = useCallback(async (row) => {
    if (!row?.id || dismissingId || dismissingAll) return;
    setDismissingId(row.id);
    try {
      await api.post(`/hr/biometric-rejected-punches/${row.id}/dismiss/`);
      toast.success('Rejected punch dismissed');
      setRows((prev) => prev.filter((r) => r.id !== row.id));
    } catch {
      toast.error('Failed to dismiss rejected punch');
    } finally {
      setDismissingId(null);
    }
  }, [dismissingAll, dismissingId]);

  const dismissAll = useCallback(async () => {
    if (!rows.length || dismissingAll || dismissingId) return;
    if (!window.confirm(`Dismiss all ${rows.length} rejected punch(es)? They will be hidden from this list.`)) {
      return;
    }
    setDismissingAll(true);
    try {
      const { data } = await api.post('/hr/biometric-rejected-punches/dismiss-all/');
      const count = data?.dismissed_count ?? rows.length;
      toast.success(`Dismissed ${count} rejected punch(es)`);
      await load();
    } catch {
      toast.error('Failed to dismiss rejected punches');
    } finally {
      setDismissingAll(false);
    }
  }, [dismissingAll, dismissingId, load, rows.length]);

  const columns = useMemo(() => [
    {
      header: 'Employee / PIN',
      render: (row) => (
        <div className="min-w-0">
          {row.employee ? (
            <Link to={`/hr/employees/${row.employee}/attendance`} className="font-medium text-violet-700 hover:underline">
              {row.employee_name || row.employee_code || row.pin}
            </Link>
          ) : (
            <span className="font-medium text-slate-900">PIN {row.pin}</span>
          )}
          <p className="truncate text-xs text-slate-500">
            {row.employee_code ? `PIN ${row.pin} · ${row.employee_code}` : `PIN ${row.pin}`}
          </p>
        </div>
      ),
    },
    { header: 'Device', render: (row) => row.device_serial || '—' },
    { header: 'Punch time', render: (row) => formatDateTime(row.punch_time) },
    { header: 'Reason', accessor: 'reason' },
    {
      header: 'Actions',
      render: (row) => (
        <button
          type="button"
          onClick={() => dismissOne(row)}
          disabled={Boolean(dismissingId) || dismissingAll}
          className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <X size={14} />
          {dismissingId === row.id ? 'Dismissing…' : 'Dismiss'}
        </button>
      ),
    },
  ], [dismissOne, dismissingAll, dismissingId]);

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <BackToEmployeeLink />
          <h1 className="flex items-center gap-2 text-2xl font-bold text-slate-900">
            <AlertTriangle className="text-rose-600" size={24} />
            Rejected biometric punches
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            Punches blocked because of eligibility, PIN linkage, or device-time issues. Review these
            before payroll finalization. Dismiss after review to clear the queue.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {rows.length > 0 && (
            <button
              type="button"
              onClick={dismissAll}
              disabled={dismissingAll || Boolean(dismissingId)}
              className="inline-flex items-center gap-2 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-800 shadow-sm hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <X size={16} />
              {dismissingAll ? 'Dismissing…' : 'Dismiss all'}
            </button>
          )}
          <button
            type="button"
            onClick={load}
            className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 shadow-sm hover:bg-slate-50"
          >
            <RefreshCw size={16} />
            Refresh
          </button>
        </div>
      </div>

      {rows.length > 0 && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-900">
          <strong>{rows.length}</strong>
          {' '}
          rejected biometric punch(es) are visible here. Fix the root cause before expecting attendance to update.
        </div>
      )}

      {loading ? (
        <TableSkeleton rows={5} />
      ) : (
        <ReusableTable columns={columns} data={rows} />
      )}
    </div>
  );
}
