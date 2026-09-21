import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../../api';
import toast from 'react-hot-toast';
import { AlertTriangle, Clock, Plus, X } from 'lucide-react';
import { normalizeApiList } from '../../hr/recruitmentLifecycle';
import {
  datetimeLocalToPunchPayload,
  nowDatetimeLocalForAttendance,
  todayIsoForAttendance,
} from '../../utils/timeDisplay';
import {
  errorText,
  formatPunchTime,
  groupPunchesByEmployee,
  punchTypeLabel,
  shiftDateIso,
  sourceLabel,
} from './punchLogUtils';
import { BackToEmployeeLink } from './employeeDetail/EmployeeDetailUi';

function AddPunchModal({
  open,
  saving,
  form,
  employees,
  onClose,
  onChange,
  onSubmit,
}) {
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-3 sm:items-center sm:p-4"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="flex max-h-[90dvh] w-full max-w-md flex-col overflow-hidden rounded-xl bg-white shadow-lg"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <div className="shrink-0 border-b border-slate-100 px-4 py-3">
          <div className="flex items-start justify-between gap-2">
            <div>
              <h2 className="text-lg font-bold text-slate-900">Add missing punch</h2>
              <p className="mt-1 text-sm text-slate-600">
                When someone forgot to check in or out.
              </p>
            </div>
            <button type="button" onClick={onClose} className="rounded-lg p-1 text-slate-400 hover:bg-slate-100">
              <X size={18} />
            </button>
          </div>
        </div>

        <form onSubmit={onSubmit} className="flex min-h-0 flex-1 flex-col">
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-3">
            <label className="block text-sm">
              <span className="font-medium text-slate-700">Employee</span>
              <select
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                value={form.employee}
                onChange={(e) => onChange({ employee: e.target.value })}
                required
              >
                <option value="">Select employee</option>
                {employees.map((emp) => (
                  <option key={emp.id} value={emp.id}>
                    {emp.name} ({emp.employee_id})
                  </option>
                ))}
              </select>
            </label>

            <div>
              <span className="text-sm font-medium text-slate-700">What happened?</span>
              <div className="mt-2 grid grid-cols-2 gap-2">
                {[
                  { value: 'IN', label: 'Check in' },
                  { value: 'OUT', label: 'Check out' },
                ].map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => onChange({ punch_type: opt.value })}
                    className={`rounded-lg border px-3 py-2.5 text-sm font-semibold ${
                      form.punch_type === opt.value
                        ? 'border-violet-600 bg-violet-600 text-white'
                        : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            <label className="block text-sm">
              <span className="font-medium text-slate-700">Date &amp; time</span>
              <input
                type="datetime-local"
                max={nowDatetimeLocalForAttendance()}
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                value={form.timestamp}
                onChange={(e) => onChange({ timestamp: e.target.value })}
                required
              />
            </label>

            <label className="block text-sm">
              <span className="font-medium text-slate-700">Why are you adding this?</span>
              <input
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                placeholder="e.g. Forgot to punch at gate"
                value={form.correction_reason}
                onChange={(e) => onChange({ correction_reason: e.target.value })}
                required
              />
            </label>
          </div>

          <div className="shrink-0 border-t border-slate-100 px-4 py-3">
            <button
              type="submit"
              disabled={saving}
              className="flex w-full min-h-[44px] items-center justify-center gap-2 rounded-lg bg-violet-600 text-sm font-semibold text-white hover:bg-violet-700 disabled:opacity-50"
            >
              <Plus size={16} />
              {saving ? 'Saving…' : 'Save punch'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function PunchLogsPage() {
  const today = todayIsoForAttendance();
  const [loading, setLoading] = useState(true);
  const [punches, setPunches] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [date, setDate] = useState(today);
  const [search, setSearch] = useState('');
  const [issuesOnly, setIssuesOnly] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    employee: '',
    timestamp: '',
    punch_type: 'IN',
    correction_reason: '',
  });

  const activeEmployees = useMemo(
    () => employees.filter((emp) => emp.status === 'active'),
    [employees],
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [punchRes, empRes] = await Promise.all([
        api.get('/hr/attendance-punches/', {
          params: { date_from: date, date_to: date, limit: 500 },
        }),
        api.get('/hr/employees/', { params: { limit: 1000 } }),
      ]);
      setPunches(normalizeApiList(punchRes.data));
      setEmployees(normalizeApiList(empRes.data));
    } catch {
      toast.error('Could not load punches');
      setPunches([]);
    } finally {
      setLoading(false);
    }
  }, [date]);

  useEffect(() => {
    document.title = 'Punch Log | HR';
    load();
  }, [load]);

  useEffect(() => {
    if (!showAdd) return undefined;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [showAdd]);

  const filteredPunches = useMemo(() => {
    let rows = punches;
    if (issuesOnly) rows = rows.filter((p) => p.is_suspicious);
    const q = search.trim().toLowerCase();
    if (q) {
      rows = rows.filter(
        (p) => p.employee_name?.toLowerCase().includes(q)
          || p.employee_id_display?.toLowerCase().includes(q),
      );
    }
    return rows;
  }, [punches, search, issuesOnly]);

  const groups = useMemo(
    () => groupPunchesByEmployee(filteredPunches),
    [filteredPunches],
  );

  const issueCount = useMemo(
    () => punches.filter((p) => p.is_suspicious).length,
    [punches],
  );

  function openAdd() {
    setForm({
      employee: '',
      timestamp: nowDatetimeLocalForAttendance(),
      punch_type: 'IN',
      correction_reason: '',
    });
    setShowAdd(true);
  }

  async function addPunch(event) {
    event.preventDefault();
    if (!form.employee || !form.timestamp || !form.correction_reason.trim()) {
      toast.error('Fill all fields');
      return;
    }
    setSaving(true);
    const wall = datetimeLocalToPunchPayload(form.timestamp);
    if (!wall) {
      toast.error('Invalid time');
      setSaving(false);
      return;
    }
    try {
      await api.post('/hr/attendance-punches/', {
        employee: form.employee,
        punch_type: form.punch_type,
        punch_date: wall.punch_date,
        punch_time: wall.punch_time,
        correction_reason: form.correction_reason.trim(),
        source: 'HR_manual',
      });
      toast.success('Punch saved');
      setShowAdd(false);
      if (wall.punch_date !== date) setDate(wall.punch_date);
      else await load();
    } catch (error) {
      toast.error(errorText(error, 'Could not save punch'));
    } finally {
      setSaving(false);
    }
  }

  async function markReviewed(punch) {
    try {
      await api.post(`/hr/attendance-punches/${punch.id}/mark-reviewed/`, {
        notes: 'Reviewed by HR.',
      });
      toast.success('Marked as OK');
      await load();
    } catch (error) {
      toast.error(errorText(error, 'Could not update'));
    }
  }

  const dateLabel = date === today
    ? 'Today'
    : date === shiftDateIso(today, -1)
      ? 'Yesterday'
      : date;

  return (
    <div className="mx-auto max-w-2xl space-y-4 pb-12">
      <div className="flex items-start justify-between gap-3">
        <div>
          <BackToEmployeeLink />
          <h1 className="flex items-center gap-2 text-2xl font-bold text-slate-900">
            <Clock className="text-violet-600" size={24} />
            Punch Log
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            Who checked in and out each day.
          </p>
        </div>
        <button
          type="button"
          onClick={openAdd}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-violet-600 px-3 py-2 text-sm font-semibold text-white hover:bg-violet-700"
        >
          <Plus size={16} />
          Add punch
        </button>
      </div>

      <div className="rounded-lg border border-slate-200 bg-white p-3">
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setDate(today)}
            className={`rounded-full px-3 py-1.5 text-xs font-semibold ${
              date === today ? 'bg-violet-600 text-white' : 'bg-slate-100 text-slate-700'
            }`}
          >
            Today
          </button>
          <button
            type="button"
            onClick={() => setDate(shiftDateIso(today, -1))}
            className={`rounded-full px-3 py-1.5 text-xs font-semibold ${
              date === shiftDateIso(today, -1) ? 'bg-violet-600 text-white' : 'bg-slate-100 text-slate-700'
            }`}
          >
            Yesterday
          </button>
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="rounded-lg border border-slate-200 px-2 py-1.5 text-sm"
          />
        </div>

        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search employee name or ID"
          className="mt-3 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
        />

        {issueCount > 0 && (
          <label className="mt-3 flex items-center gap-2 text-sm text-amber-800">
            <input
              type="checkbox"
              checked={issuesOnly}
              onChange={(e) => setIssuesOnly(e.target.checked)}
            />
            Show only {issueCount} that need review
          </label>
        )}
      </div>

      {!loading && (
        <p className="text-sm text-slate-500">
          {filteredPunches.length} punch{filteredPunches.length === 1 ? '' : 'es'} on{' '}
          <strong>{dateLabel}</strong>
          {groups.length > 0 && ` · ${groups.length} employee${groups.length === 1 ? '' : 's'}`}
        </p>
      )}

      {loading ? (
        <p className="py-10 text-center text-sm text-slate-500">Loading…</p>
      ) : groups.length === 0 ? (
        <div className="rounded-lg border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-600">
          {search || issuesOnly ? (
            'No punches match your filter.'
          ) : (
            <>
              No punches on this day.
              {' '}
              <button type="button" onClick={openAdd} className="font-semibold text-violet-700 underline">
                Add one manually
              </button>
              {' '}
              or use{' '}
              <Link to="/hr/attendance-control" className="font-semibold text-violet-700 underline">
                Attendance Control
              </Link>
              .
            </>
          )}
        </div>
      ) : (
        <ul className="space-y-3">
          {groups.map((group) => (
            <li key={group.employeeId} className="rounded-lg border border-slate-200 bg-white p-4">
              <p className="font-medium text-slate-900">
                {group.name}
                {group.code ? (
                  <span className="ml-2 text-sm font-normal text-slate-400">{group.code}</span>
                ) : null}
              </p>
              <ul className="mt-2 space-y-2">
                {group.punches.map((punch) => (
                  <li
                    key={punch.id}
                    className={`flex items-start justify-between gap-2 rounded-lg px-2 py-1.5 text-sm ${
                      punch.is_suspicious ? 'bg-amber-50' : ''
                    }`}
                  >
                    <div className="min-w-0">
                      <p className="text-slate-800">
                        <span className={`font-semibold ${punch.punch_type === 'IN' ? 'text-emerald-700' : 'text-blue-700'}`}>
                          {punchTypeLabel(punch.punch_type)}
                        </span>
                        {' '}
                        at {formatPunchTime(punch)}
                        <span className="text-slate-400"> · </span>
                        <span className="text-slate-500">{sourceLabel(punch)}</span>
                      </p>
                      {punch.is_suspicious && punch.suspicious_reason && (
                        <p className="mt-0.5 flex items-center gap-1 text-xs text-amber-800">
                          <AlertTriangle size={12} />
                          {punch.suspicious_reason}
                        </p>
                      )}
                    </div>
                    {punch.is_suspicious && (
                      <button
                        type="button"
                        onClick={() => markReviewed(punch)}
                        className="shrink-0 rounded-lg border border-amber-200 bg-white px-2 py-1 text-xs font-semibold text-amber-800 hover:bg-amber-100"
                      >
                        Looks OK
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}

      <p className="text-center text-xs text-slate-500">
        To mark attendance for testing, use{' '}
        <Link to="/hr/attendance-control" className="font-medium text-violet-700 underline">
          Attendance Control
        </Link>
        . Daily summary is on{' '}
        <Link to="/hr/operations/attendance" className="font-medium text-violet-700 underline">
          Attendance dashboard
        </Link>
        .
      </p>

      <AddPunchModal
        open={showAdd}
        saving={saving}
        form={form}
        employees={activeEmployees}
        onClose={() => setShowAdd(false)}
        onChange={(patch) => setForm((prev) => ({ ...prev, ...patch }))}
        onSubmit={addPunch}
      />
    </div>
  );
}
