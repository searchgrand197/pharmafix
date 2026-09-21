import React, { useCallback, useEffect, useState } from 'react';
import api from '../../api';
import toast from 'react-hot-toast';
import { Bell, CheckCheck, RefreshCw } from 'lucide-react';
import { formatSystemDateTime } from '../../utils/timeDisplay';

const CATEGORY_STYLES = {
  leave_approved: 'border-emerald-200 bg-emerald-50',
  leave_rejected: 'border-red-200 bg-red-50',
  leave_submitted: 'border-amber-200 bg-amber-50',
  regularization_approved: 'border-emerald-200 bg-emerald-50',
  regularization_rejected: 'border-red-200 bg-red-50',
  regularization_submitted: 'border-amber-200 bg-amber-50',
  document_approved: 'border-emerald-200 bg-emerald-50',
  document_reupload: 'border-orange-200 bg-orange-50',
  offer_accepted: 'border-blue-200 bg-blue-50',
  portal_activation: 'border-teal-200 bg-teal-50',
  payroll: 'border-violet-200 bg-violet-50',
  general: 'border-slate-200 bg-slate-50',
};

function TouchButton({ children, className = '', ...props }) {
  return (
    <button
      type="button"
      className={`inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl px-4 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-50 ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}

export default function EmployeeNotificationsPage() {
  const [loading, setLoading] = useState(true);
  const [markingAll, setMarkingAll] = useState(false);
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get('/employee-portal/notifications/');
      setNotifications(data.results || []);
      setUnreadCount(data.unread_count || 0);
    } catch {
      toast.error('Failed to load notifications');
      setNotifications([]);
      setUnreadCount(0);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    document.title = 'Notifications | Employee Portal';
    load();
  }, [load]);

  async function markRead(row) {
    if (row.is_read) return;
    try {
      const { data } = await api.post(`/employee-portal/notifications/${row.id}/read/`);
      setNotifications((prev) => prev.map((n) => (n.id === row.id ? data : n)));
      setUnreadCount((c) => Math.max(0, c - 1));
    } catch {
      toast.error('Could not mark notification as read');
    }
  }

  async function markAllRead() {
    setMarkingAll(true);
    try {
      await api.post('/employee-portal/notifications/mark-all-read/');
      toast.success('All notifications marked as read');
      await load();
    } catch {
      toast.error('Could not mark all as read');
    } finally {
      setMarkingAll(false);
    }
  }

  return (
    <div className="mx-auto w-full max-w-lg space-y-4 pb-8">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Notifications</h1>
          <p className="mt-1 text-sm text-gray-600">
            {unreadCount > 0 ? `${unreadCount} unread` : 'You are all caught up'}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <TouchButton onClick={load} className="border border-gray-200 bg-white text-gray-700">
            <RefreshCw size={16} /> Refresh
          </TouchButton>
          {unreadCount > 0 && (
            <TouchButton
              onClick={markAllRead}
              disabled={markingAll}
              className="border border-teal-200 bg-teal-50 text-teal-800"
            >
              <CheckCheck size={16} /> Mark all read
            </TouchButton>
          )}
        </div>
      </header>

      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-20 animate-pulse rounded-2xl bg-gray-100" />
          ))}
        </div>
      ) : notifications.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-gray-300 bg-white p-8 text-center">
          <Bell className="mx-auto h-10 w-10 text-gray-300" />
          <p className="mt-3 font-medium text-gray-800">No notifications yet</p>
          <p className="mt-1 text-sm text-gray-500">Updates about leave, attendance, and documents will appear here.</p>
        </div>
      ) : (
        <ul className="space-y-3">
          {notifications.map((row) => {
            const style = CATEGORY_STYLES[row.category] || CATEGORY_STYLES.general;
            return (
              <li key={row.id}>
                <button
                  type="button"
                  onClick={() => markRead(row)}
                  className={`w-full rounded-2xl border p-4 text-left shadow-sm transition hover:shadow-md ${style} ${
                    !row.is_read ? 'ring-2 ring-teal-400/40' : 'opacity-90'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <p className="font-semibold text-gray-900">{row.title}</p>
                    {!row.is_read && (
                      <span className="shrink-0 rounded-full bg-teal-600 px-2 py-0.5 text-[10px] font-bold uppercase text-white">
                        New
                      </span>
                    )}
                  </div>
                  <p className="mt-1 text-sm text-gray-700">{row.message}</p>
                  <p className="mt-2 text-xs text-gray-500">
                    {row.category_display || row.category} · {formatSystemDateTime(row.created_at)}
                  </p>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
