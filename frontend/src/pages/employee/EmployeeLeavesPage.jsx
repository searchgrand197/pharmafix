import React, { useCallback, useEffect, useMemo, useState } from 'react';
import api from '../../api';
import toast from 'react-hot-toast';
import {
  Calendar,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Clock,
  Paperclip,
  Plus,
  X,
} from 'lucide-react';
import { daysInMonth, monthKey } from '../../utils/attendanceCalendar';
import {
  computeLeaveDashboard,
  isUnlimitedLeaveType,
  leaveTypeSelectable,
  parseLeaveNum,
} from '../../utils/leaveDashboard';

function errorText(error, fallback = 'Something went wrong') {
  const data = error?.response?.data;
  if (!data) return fallback;
  if (typeof data === 'string') return data;
  if (data.error || data.detail) return data.error || data.detail;
  if (data.date_range) return Array.isArray(data.date_range) ? data.date_range.join(', ') : data.date_range;
  const firstKey = Object.keys(data)[0];
  const value = data[firstKey];
  if (Array.isArray(value)) return value.join(', ');
  if (typeof value === 'string') return value;
  return fallback;
}

const STATUS_STYLES = {
  PENDING: { badge: 'bg-amber-100 text-amber-900 border-amber-200', dot: 'bg-amber-400', calendar: 'bg-amber-100 border-amber-300 text-amber-900' },
  APPROVED: { badge: 'bg-blue-100 text-blue-900 border-blue-200', dot: 'bg-blue-500', calendar: 'bg-blue-100 border-blue-300 text-blue-900' },
  REJECTED: { badge: 'bg-red-100 text-red-900 border-red-200', dot: 'bg-red-500', calendar: 'bg-red-50 border-red-200 text-red-800' },
  CANCELLED: { badge: 'bg-slate-100 text-slate-700 border-slate-200', dot: 'bg-slate-400', calendar: 'bg-slate-50 border-slate-200 text-slate-600' },
};

const FILTERS = [
  { key: '', label: 'All' },
  { key: 'PENDING', label: 'Pending' },
  { key: 'APPROVED', label: 'Approved' },
  { key: 'REJECTED', label: 'Rejected' },
  { key: 'CANCELLED', label: 'Cancelled' },
];

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

function formatDateHeading(iso) {
  return new Date(iso).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
}

function dateInRange(iso, start, end) {
  return iso >= start && iso <= end;
}

function DetailRow({ label, value }) {
  return (
    <div className="flex items-center justify-between rounded-xl border border-gray-100 bg-gray-50 px-3 py-2.5">
      <span className="text-sm text-gray-500">{label}</span>
      <span className="text-sm font-semibold text-gray-900">{value || '—'}</span>
    </div>
  );
}

function LeaveDetailSheet({ leave, onClose, onCancel }) {
  if (!leave) return null;
  const style = STATUS_STYLES[leave.status] || STATUS_STYLES.PENDING;

  return (
    <div className="fixed inset-0 z-50 bg-black/40" onClick={onClose}>
      <div
        className="absolute bottom-0 left-0 right-0 max-h-[85vh] overflow-y-auto rounded-t-2xl bg-white p-4 shadow-2xl sm:left-1/2 sm:bottom-6 sm:w-[420px] sm:-translate-x-1/2 sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <p className="text-base font-semibold text-gray-900">{leave.leave_type_name}</p>
            <p className="text-sm text-gray-500">
              {leave.start_date} → {leave.end_date} · {leave.number_of_days} day(s)
            </p>
            <span className={`mt-2 inline-flex rounded-full border px-3 py-1 text-sm font-medium ${style.badge}`}>
              {leave.status_display || leave.status}
            </span>
          </div>
          <TouchButton onClick={onClose} className="min-w-[44px] shrink-0 border border-gray-200 text-gray-600">
            <X size={18} />
          </TouchButton>
        </div>

        <div className="space-y-2">
          <DetailRow label="Reason" value={leave.reason} />
          <DetailRow label="HR comments" value={leave.remarks} />
          <DetailRow label="Applied on" value={leave.applied_on ? formatDateHeading(leave.applied_on.slice(0, 10)) : null} />
          <DetailRow label="Reviewed on" value={leave.reviewed_on ? formatDateHeading(leave.reviewed_on.slice(0, 10)) : null} />
        </div>

        <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-3">
          <p className="text-sm font-semibold text-slate-800">Approval history</p>
          <ul className="mt-2 space-y-2 text-sm text-slate-600">
            <li className="flex gap-2">
              <Clock size={14} className="mt-0.5 shrink-0" />
              <span>Submitted {leave.applied_on ? new Date(leave.applied_on).toLocaleString() : '—'}</span>
            </li>
            {leave.reviewed_on && (
              <li className="flex gap-2">
                <Clock size={14} className="mt-0.5 shrink-0" />
                <span>
                  {leave.status === 'APPROVED' ? 'Approved' : leave.status === 'REJECTED' ? 'Rejected' : 'Reviewed'}
                  {' '}
                  {new Date(leave.reviewed_on).toLocaleString()}
                </span>
              </li>
            )}
            {leave.remarks && (
              <li className="rounded-lg bg-white px-2 py-1.5 text-slate-700">
                <span className="font-medium">HR:</span> {leave.remarks}
              </li>
            )}
          </ul>
        </div>

        {leave.attachment_url && (
          <a
            href={leave.attachment_url}
            target="_blank"
            rel="noreferrer"
            className="mt-4 flex min-h-[44px] items-center justify-center rounded-xl border border-teal-200 bg-teal-50 text-sm font-semibold text-teal-800"
          >
            View attachment
          </a>
        )}

        {leave.status === 'PENDING' && (
          <TouchButton
            onClick={() => onCancel(leave)}
            className="mt-3 w-full border border-red-200 bg-red-50 text-red-700 hover:bg-red-100"
          >
            Cancel request
          </TouchButton>
        )}
      </div>
    </div>
  );
}

export default function EmployeeLeavesPage() {
  const [leaveTypes, setLeaveTypes] = useState([]);
  const [leavePolicy, setLeavePolicy] = useState(null);
  const [allLeaves, setAllLeaves] = useState([]);
  const [tab, setTab] = useState('');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [showApplyForm, setShowApplyForm] = useState(false);
  const [selectedLeave, setSelectedLeave] = useState(null);
  const [calendarMonth, setCalendarMonth] = useState(monthKey());
  const [form, setForm] = useState({
    leave_type: '',
    start_date: '',
    end_date: '',
    reason: '',
    attachment: null,
  });

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [typesRes, leavesRes] = await Promise.all([
        api.get('/employee-portal/leave-types/'),
        api.get('/employee-portal/leaves/'),
      ]);
      setLeaveTypes(typesRes.data.leave_types || []);
      setLeavePolicy(typesRes.data.policy || null);
      setAllLeaves(leavesRes.data.results || []);
    } catch {
      toast.error('Failed to load leave data');
      setLeaveTypes([]);
      setLeavePolicy(null);
      setAllLeaves([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    document.title = 'Leaves | Employee Portal';
    fetchData();
  }, [fetchData]);

  const dashboard = useMemo(
    () => computeLeaveDashboard(leaveTypes, allLeaves),
    [allLeaves, leaveTypes],
  );

  const filteredLeaves = useMemo(() => {
    if (!tab) return allLeaves;
    return allLeaves.filter((row) => row.status === tab);
  }, [allLeaves, tab]);

  const selectedType = useMemo(
    () => leaveTypes.find((lt) => String(lt.id) === String(form.leave_type)),
    [form.leave_type, leaveTypes],
  );

  const requestedDays = useMemo(() => {
    if (!form.start_date || !form.end_date) return 0;
    const start = new Date(form.start_date);
    const end = new Date(form.end_date);
    if (start > end) return 0;
    return Math.floor((end - start) / (1000 * 60 * 60 * 24)) + 1;
  }, [form.end_date, form.start_date]);

  const clientValidationError = useMemo(() => {
    if (!form.leave_type || !form.start_date || !form.end_date) return null;
    if (form.start_date > form.end_date) return 'End date cannot be before start date.';
    const isUnlimited = isUnlimitedLeaveType(selectedType);
    const remaining = parseLeaveNum(selectedType?.balance?.remaining_days);
    if (requestedDays > 0 && !isUnlimited && remaining < requestedDays) {
      return `Insufficient balance. Available: ${remaining}, requested: ${requestedDays}.`;
    }
    const overlap = allLeaves.some(
      (row) => ['PENDING', 'APPROVED'].includes(row.status)
        && form.start_date <= row.end_date
        && form.end_date >= row.start_date,
    );
    if (overlap) return 'You already have a pending or approved leave overlapping these dates.';
    return null;
  }, [allLeaves, form.end_date, form.leave_type, form.start_date, requestedDays, selectedType]);

  const [calYear, calMon] = useMemo(() => calendarMonth.split('-').map(Number), [calendarMonth]);
  const calendarDays = useMemo(() => {
    const total = daysInMonth(calYear, calMon);
    const days = [];
    for (let d = 1; d <= total; d += 1) {
      const iso = `${calYear}-${String(calMon).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      const matches = allLeaves.filter(
        (row) => ['PENDING', 'APPROVED', 'REJECTED'].includes(row.status)
          && dateInRange(iso, row.start_date, row.end_date),
      );
      days.push({ iso, day: d, leaves: matches });
    }
    return days;
  }, [allLeaves, calMon, calYear]);

  const firstWeekday = new Date(calYear, calMon - 1, 1).getDay();
  const calendarCells = useMemo(() => {
    const cells = [];
    for (let i = 0; i < firstWeekday; i += 1) cells.push(null);
    calendarDays.forEach((item) => cells.push(item));
    return cells;
  }, [calendarDays, firstWeekday]);

  function shiftCalendarMonth(delta) {
    const dt = new Date(calYear, calMon - 1 + delta, 1);
    setCalendarMonth(monthKey(dt));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (clientValidationError) {
      toast.error(clientValidationError);
      return;
    }
    setSubmitting(true);
    try {
      const body = new FormData();
      body.append('leave_type', form.leave_type);
      body.append('start_date', form.start_date);
      body.append('end_date', form.end_date);
      body.append('reason', form.reason);
      if (form.attachment) body.append('attachment', form.attachment);
      await api.post('/employee-portal/leaves/', body);
      toast.success('Leave submitted. HR will be notified.');
      setForm({ leave_type: '', start_date: '', end_date: '', reason: '', attachment: null });
      setShowApplyForm(false);
      fetchData();
    } catch (err) {
      toast.error(errorText(err, 'Failed to submit leave'));
    } finally {
      setSubmitting(false);
    }
  }

  async function cancelLeave(row) {
    if (!window.confirm('Cancel this pending leave request?')) return;
    try {
      await api.post(`/employee-portal/leaves/${row.id}/cancel/`);
      toast.success('Leave cancelled. HR will be notified.');
      setSelectedLeave(null);
      fetchData();
    } catch (err) {
      toast.error(errorText(err, 'Failed to cancel leave'));
    }
  }

  const canSubmit = form.leave_type && form.start_date && form.end_date && !clientValidationError && !submitting;

  return (
    <div className="mx-auto w-full max-w-lg space-y-5 pb-8">
      <header>
        <h1 className="text-xl font-bold text-gray-900">Leave Portal</h1>
        <p className="mt-1 text-sm text-gray-600">Apply, track, and manage your leave requests.</p>
        {leavePolicy?.name && (
          <p className="mt-1 text-xs font-medium text-teal-700">Policy: {leavePolicy.name}</p>
        )}
      </header>

      {!loading && leaveTypes.length > 0 && (
        <section className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
          <div className="border-b border-gray-100 px-4 py-3">
            <h2 className="text-base font-semibold text-gray-900">Leave balances by type</h2>
            <p className="text-xs text-gray-500">Review balances before applying leave.</p>
          </div>
          <div className="divide-y divide-gray-100 md:hidden">
            {leaveTypes.map((lt) => {
              const unlimited = isUnlimitedLeaveType(lt);
              return (
                <div key={lt.id} className="px-4 py-3 text-sm">
                  <p className="font-semibold text-gray-900">{lt.name}</p>
                  <div className="mt-2 grid grid-cols-3 gap-2 text-center">
                    <div>
                      <p className="text-xs text-gray-500">Total</p>
                      <p className="font-semibold">{unlimited ? '∞' : (lt.balance?.total_days ?? '—')}</p>
                    </div>
                    <div>
                      <p className="text-xs text-gray-500">Used</p>
                      <p className="font-semibold">{lt.balance?.used_days ?? '0'}</p>
                    </div>
                    <div>
                      <p className="text-xs text-gray-500">Remaining</p>
                      <p className="font-semibold">{unlimited ? '∞' : (lt.balance?.remaining_days ?? '—')}</p>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
          <div className="hidden overflow-x-auto md:block">
            <table className="min-w-full text-left text-sm">
              <thead className="bg-gray-50 text-xs font-semibold uppercase text-gray-500">
                <tr>
                  <th className="px-4 py-3">Leave type</th>
                  <th className="px-4 py-3 text-right">Total</th>
                  <th className="px-4 py-3 text-right">Used</th>
                  <th className="px-4 py-3 text-right">Remaining</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {leaveTypes.map((lt) => {
                  const unlimited = isUnlimitedLeaveType(lt);
                  return (
                    <tr key={lt.id}>
                      <td className="px-4 py-3 font-medium text-gray-900">{lt.name}</td>
                      <td className="px-4 py-3 text-right">{unlimited ? 'Unlimited' : (lt.balance?.total_days ?? '—')}</td>
                      <td className="px-4 py-3 text-right">{lt.balance?.used_days ?? '0'}</td>
                      <td className="px-4 py-3 text-right">{unlimited ? 'Unlimited' : (lt.balance?.remaining_days ?? '—')}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {loading ? (
        <div className="grid grid-cols-2 gap-3">
          {Array.from({ length: 4 }).map((_, idx) => (
            <div key={idx} className="h-20 animate-pulse rounded-2xl bg-gray-100" />
          ))}
        </div>
      ) : (
        <>
          <section className="grid grid-cols-2 gap-3">
            {[
              ['Total balance', dashboard.totalBalance, 'Paid leave entitlements'],
              ['Used', dashboard.used, null],
              ['Remaining', dashboard.remaining, null],
              ['Pending', dashboard.pending, null],
            ].map(([label, value, hint]) => (
              <div key={label} className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
                <p className="text-sm text-gray-500">{label}</p>
                <p className="mt-1 text-2xl font-bold text-gray-900">{value}</p>
                {hint && <p className="mt-0.5 text-xs text-gray-400">{hint}</p>}
              </div>
            ))}
          </section>
          {dashboard.unlimitedCount > 0 && (
            <p className="text-xs text-gray-500">
              {dashboard.unlimitedCount} unlimited leave type{dashboard.unlimitedCount > 1 ? 's' : ''} (e.g. LWP) not included in totals above.
            </p>
          )}
        </>
      )}

      <section className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
        <div className="flex items-center justify-between gap-3">
          <h2 className="flex items-center gap-2 text-base font-semibold text-gray-900">
            <Plus size={18} /> Apply leave
          </h2>
          <TouchButton
            onClick={() => setShowApplyForm((v) => !v)}
            className="border border-teal-200 bg-teal-50 text-teal-800"
          >
            {showApplyForm ? 'Hide form' : 'New request'}
          </TouchButton>
        </div>

        {showApplyForm && (
          <form onSubmit={handleSubmit} className="mt-4 space-y-4">
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">Leave type</label>
              <select
                required
                value={form.leave_type}
                onChange={(e) => setForm((f) => ({ ...f, leave_type: e.target.value }))}
                className="min-h-[44px] w-full rounded-xl border border-gray-200 px-3 text-sm"
              >
                <option value="">{leaveTypes.length === 0 ? 'No leave types assigned — contact HR' : 'Select type'}</option>
                {leaveTypes.map((lt) => (
                  <option key={lt.id} value={lt.id} disabled={!leaveTypeSelectable(lt)}>
                    {lt.name}
                    {lt.balance?.is_unlimited ? ' (Unlimited)' : lt.balance?.remaining_days != null ? ` (${lt.balance.remaining_days} left)` : ''}
                  </option>
                ))}
              </select>
              {leaveTypes.length === 0 && !loading && (
                <p className="mt-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                  No leave types are assigned to your account yet. Ask HR to configure leave policies and apply balances.
                </p>
              )}
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">Start date</label>
                <input
                  type="date"
                  required
                  value={form.start_date}
                  onChange={(e) => setForm((f) => ({ ...f, start_date: e.target.value }))}
                  className="min-h-[44px] w-full rounded-xl border border-gray-200 px-3 text-sm"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">End date</label>
                <input
                  type="date"
                  required
                  min={form.start_date || undefined}
                  value={form.end_date}
                  onChange={(e) => setForm((f) => ({ ...f, end_date: e.target.value }))}
                  className="min-h-[44px] w-full rounded-xl border border-gray-200 px-3 text-sm"
                />
              </div>
            </div>

            {requestedDays > 0 && (
              <p className="text-sm text-gray-600">
                Requesting <span className="font-semibold">{requestedDays}</span> day(s)
                {selectedType?.balance?.remaining_days != null && (
                  <> · Balance after: {Math.max(0, parseLeaveNum(selectedType.balance.remaining_days) - requestedDays)}</>
                )}
              </p>
            )}

            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">Reason</label>
              <textarea
                value={form.reason}
                onChange={(e) => setForm((f) => ({ ...f, reason: e.target.value }))}
                rows={3}
                className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm"
                placeholder="Brief reason for leave"
              />
            </div>

            <div>
              <label className="mb-1 flex items-center gap-1 text-sm font-medium text-gray-700">
                <Paperclip size={14} /> Attachment (optional)
              </label>
              <input
                type="file"
                onChange={(e) => setForm((f) => ({ ...f, attachment: e.target.files?.[0] || null }))}
                className="w-full text-sm"
              />
            </div>

            {clientValidationError && (
              <p className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
                {clientValidationError}
              </p>
            )}

            <TouchButton
              type="submit"
              disabled={!canSubmit}
              className="w-full bg-teal-600 text-white hover:bg-teal-700"
            >
              {submitting ? 'Submitting…' : 'Submit request'}
            </TouchButton>
            <p className="text-xs text-gray-500">
              HR is notified automatically when you submit or cancel a leave request.
            </p>
          </form>
        )}
      </section>

      <section className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
        <h2 className="mb-3 text-base font-semibold text-gray-900">My leave requests</h2>
        <div className="mb-4 flex flex-wrap gap-2">
          {FILTERS.map((t) => (
            <TouchButton
              key={t.key || 'all'}
              onClick={() => setTab(t.key)}
              className={
                tab === t.key
                  ? 'border-teal-600 bg-teal-50 text-teal-800'
                  : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50'
              }
            >
              {t.label}
            </TouchButton>
          ))}
        </div>

        {loading ? (
          <div className="space-y-3">
            {Array.from({ length: 4 }).map((_, idx) => (
              <div key={idx} className="h-16 animate-pulse rounded-xl bg-gray-100" />
            ))}
          </div>
        ) : filteredLeaves.length === 0 ? (
          <p className="rounded-xl border border-dashed border-gray-300 px-4 py-6 text-center text-sm text-gray-500">
            No leave requests found.
          </p>
        ) : (
          <ul className="space-y-3">
            {filteredLeaves.map((row) => {
              const style = STATUS_STYLES[row.status] || STATUS_STYLES.PENDING;
              return (
                <li key={row.id}>
                  <button
                    type="button"
                    onClick={() => setSelectedLeave(row)}
                    className={`w-full rounded-xl border p-4 text-left transition hover:shadow-sm ${style.calendar}`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-semibold text-gray-900">{row.leave_type_name}</p>
                        <p className="mt-1 text-sm text-gray-700">
                          {row.start_date} → {row.end_date} · {row.number_of_days} day(s)
                        </p>
                        {row.reason && <p className="mt-1 truncate text-sm text-gray-600">{row.reason}</p>}
                        {row.remarks && (
                          <p className="mt-1 text-sm text-gray-500">
                            <span className="font-medium">HR:</span> {row.remarks}
                          </p>
                        )}
                      </div>
                      <span className={`shrink-0 rounded-full border px-2.5 py-1 text-xs font-semibold ${style.badge}`}>
                        {row.status_display || row.status}
                      </span>
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
        <div className="mb-4 flex items-center justify-between gap-2">
          <h2 className="flex items-center gap-2 text-base font-semibold text-gray-900">
            <CalendarDays size={18} /> Leave calendar
          </h2>
          <div className="flex items-center gap-1">
            <TouchButton onClick={() => shiftCalendarMonth(-1)} className="min-w-[44px] border border-gray-200 p-2">
              <ChevronLeft size={16} />
            </TouchButton>
            <span className="min-w-[130px] text-center text-sm font-semibold">
              {new Date(calYear, calMon - 1).toLocaleString('default', { month: 'long', year: 'numeric' })}
            </span>
            <TouchButton onClick={() => shiftCalendarMonth(1)} className="min-w-[44px] border border-gray-200 p-2">
              <ChevronRight size={16} />
            </TouchButton>
          </div>
        </div>

        <div className="mb-3 flex flex-wrap gap-2 text-sm">
          {[
            ['Approved', STATUS_STYLES.APPROVED],
            ['Pending', STATUS_STYLES.PENDING],
            ['Rejected', STATUS_STYLES.REJECTED],
          ].map(([label, style]) => (
            <span key={label} className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 ${style.badge}`}>
              <span className={`h-2 w-2 rounded-full ${style.dot}`} />
              {label}
            </span>
          ))}
        </div>

        {loading ? (
          <div className="h-48 animate-pulse rounded-xl bg-gray-100" />
        ) : (
          <>
            <div className="hidden grid-cols-7 gap-2 text-center text-sm font-semibold uppercase text-gray-500 md:grid">
              {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => (
                <div key={d}>{d}</div>
              ))}
            </div>
            <div className="hidden grid-cols-7 gap-2 md:grid">
              {calendarCells.map((item, idx) => {
                if (!item) return <div key={`empty-${idx}`} />;
                const primary = item.leaves[0];
                const style = primary ? (STATUS_STYLES[primary.status] || STATUS_STYLES.PENDING) : null;
                return (
                  <button
                    key={item.iso}
                    type="button"
                    onClick={() => primary && setSelectedLeave(primary)}
                    className={`min-h-[64px] rounded-xl border p-2 text-left text-sm ${
                      style ? style.calendar : 'border-gray-100 bg-white text-gray-400'
                    }`}
                  >
                    <span className="font-bold">{item.day}</span>
                    {primary && (
                      <div className="mt-1 truncate text-xs">{primary.leave_type_name}</div>
                    )}
                  </button>
                );
              })}
            </div>

            <div className="space-y-2 md:hidden">
              {calendarDays.filter((d) => d.leaves.length > 0).length === 0 ? (
                <p className="text-center text-sm text-gray-500">No leave on this month.</p>
              ) : (
                calendarDays
                  .filter((d) => d.leaves.length > 0)
                  .map((d) => d.leaves.map((leave) => {
                    const style = STATUS_STYLES[leave.status] || STATUS_STYLES.PENDING;
                    return (
                      <button
                        key={`${d.iso}-${leave.id}`}
                        type="button"
                        onClick={() => setSelectedLeave(leave)}
                        className={`flex min-h-[52px] w-full items-center justify-between rounded-xl border px-4 text-sm ${style.calendar}`}
                      >
                        <span>{formatDateHeading(d.iso)}</span>
                        <span className="font-medium">{leave.leave_type_name}</span>
                      </button>
                    );
                  }))
              )}
            </div>
          </>
        )}
      </section>

      <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
        <p className="flex items-center gap-2 font-semibold text-slate-700">
          <Calendar size={14} /> Email notifications
        </p>
        <p className="mt-1">
          Approval and rejection emails are sent automatically by the system when HR reviews your request.
        </p>
      </div>

      <LeaveDetailSheet
        leave={selectedLeave}
        onClose={() => setSelectedLeave(null)}
        onCancel={cancelLeave}
      />
    </div>
  );
}
