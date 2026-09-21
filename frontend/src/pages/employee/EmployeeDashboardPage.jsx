import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import api from '../../api';
import toast from 'react-hot-toast';
import { monthKey, todayIso } from '../../utils/attendanceCalendar';
import { computeLeaveDashboard } from '../../utils/leaveDashboard';
import { documentStats as computeDocumentStats, fetchEmployeeDocuments } from '../../utils/employeeDocuments';
import {
  formatAttendanceDateTime,
  formatAttendanceTime,
  formatShiftRange12h,
} from '../../utils/timeDisplay';
import {
  Bell,
  Calendar,
  CalendarDays,
  Clock,
  FileText,
  LogIn,
  User,
  Wallet,
} from 'lucide-react';
import { formatCurrency, monthLabel, normalizePayslipList } from './employeePayslipUtils';

function statusBadge(status) {
  const map = {
    PENDING: 'bg-amber-100 text-amber-900',
    APPROVED: 'bg-blue-100 text-blue-900',
    REJECTED: 'bg-red-100 text-red-900',
    CANCELLED: 'bg-slate-100 text-slate-700',
  };
  return map[status] || 'bg-gray-100 text-gray-700';
}

function attendanceStatusLabel(status) {
  if (!status) return 'Not marked';
  const map = {
    present: 'Present',
    absent: 'Absent',
    late: 'Late',
    leave: 'On leave',
    holiday: 'Holiday',
    weekend: 'Weekend',
    half_day: 'Half day',
    in_progress: 'In progress',
    incomplete: 'Incomplete',
    unscheduled: 'Not marked',
  };
  return map[status] || status.replace(/_/g, ' ');
}

function formatCheckPunch(value) {
  const formatted = formatAttendanceTime(value);
  return formatted === '—' ? 'Not marked' : formatted;
}

function SectionCard({ title, icon: Icon, children, action }) {
  return (
    <section className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-base font-semibold text-gray-900">
          {Icon ? <Icon size={18} className="text-teal-700" /> : null}
          {title}
        </h2>
        {action}
      </div>
      {children}
    </section>
  );
}

function TouchLink({ to, children, className = '', onClick }) {
  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        className={`inline-flex min-h-[44px] w-full items-center justify-center gap-2 rounded-xl px-4 text-sm font-semibold transition ${className}`}
      >
        {children}
      </button>
    );
  }
  return (
    <Link
      to={to}
      className={`inline-flex min-h-[44px] w-full items-center justify-center gap-2 rounded-xl px-4 text-sm font-semibold transition ${className}`}
    >
      {children}
    </Link>
  );
}

function SkeletonBlock({ className = 'h-20' }) {
  return <div className={`animate-pulse rounded-xl bg-gray-100 ${className}`} />;
}

export default function EmployeeDashboardPage() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [dashboard, setDashboard] = useState(null);
  const [profile, setProfile] = useState(null);
  const [attendance, setAttendance] = useState(null);
  const [leaveTypes, setLeaveTypes] = useState([]);
  const [leaves, setLeaves] = useState([]);
  const [documents, setDocuments] = useState([]);
  const [documentsAccessBlocked, setDocumentsAccessBlocked] = useState(false);
  const [loadErrors, setLoadErrors] = useState({});

  const loadAll = useCallback(async () => {
    setLoading(true);
    setLoadErrors({});
    const month = monthKey();
    const results = await Promise.allSettled([
      api.get('/employee-portal/profile/'),
      api.get('/employee-portal/dashboard/'),
      api.get('/employee-portal/attendance/', { params: { month } }),
      api.get('/employee-portal/leave-types/'),
      api.get('/employee-portal/leaves/'),
      fetchEmployeeDocuments(),
    ]);

    const errors = {};
    if (results[0].status === 'fulfilled') setProfile(results[0].value.data);
    else { setProfile(null); errors.profile = true; }

    if (results[1].status === 'fulfilled') setDashboard(results[1].value.data);
    else { setDashboard(null); errors.dashboard = true; }

    if (results[2].status === 'fulfilled') setAttendance(results[2].value.data);
    else { setAttendance(null); errors.attendance = true; }

    if (results[3].status === 'fulfilled') setLeaveTypes(results[3].value.data.leave_types || []);
    else { setLeaveTypes([]); errors.leaves = true; }

    if (results[4].status === 'fulfilled') setLeaves(results[4].value.data.results || []);
    else { setLeaves([]); errors.leaves = true; }

    if (results[5].status === 'fulfilled') {
      setDocuments(results[5].value.documents || []);
      setDocumentsAccessBlocked(Boolean(results[5].value.accessBlocked));
    } else {
      setDocuments([]);
      setDocumentsAccessBlocked(false);
      errors.documents = true;
    }

    setLoadErrors(errors);
    if (errors.profile) toast.error('No employee profile linked to this account');
    else if (errors.dashboard) toast.error('Some dashboard data could not be loaded');
    setLoading(false);
  }, []);

  useEffect(() => {
    document.title = 'HRMS Control Center | Employee Portal';
    loadAll();
  }, [loadAll]);

  const employee = dashboard?.employee || (profile ? {
    id: profile.id,
    name: profile.name,
    employee_id: profile.employee_id,
    department: profile.department,
    designation: profile.designation,
    shift_name: profile.shift?.name,
    shift_start: profile.shift?.start_time,
    shift_end: profile.shift?.end_time,
    status: profile.status,
  } : null);
  const todayDate = todayIso();

  const todayAttendance = useMemo(() => {
    const row = (attendance?.history || []).find((item) => item.date === todayDate);
    return row || null;
  }, [attendance, todayDate]);

  const todayLeave = useMemo(() => {
    return leaves.find(
      (row) => row.status === 'APPROVED' && row.start_date <= todayDate && row.end_date >= todayDate,
    ) || null;
  }, [leaves, todayDate]);

  const shiftTimingLabel = useMemo(() => {
    const range = formatShiftRange12h(employee?.shift_start, employee?.shift_end);
    if (employee?.shift_name && range !== '—') return `${employee.shift_name} (${range})`;
    return employee?.shift_name || range;
  }, [employee]);

  const leaveSnapshot = useMemo(
    () => computeLeaveDashboard(leaveTypes, leaves),
    [leaveTypes, leaves],
  );

  const documentStats = useMemo(() => computeDocumentStats(documents), [documents]);

  const recentPayslips = useMemo(
    () => normalizePayslipList({ results: dashboard?.recent_payslips || [] }),
    [dashboard],
  );

  const notifications = useMemo(() => {
    const items = [];

    if (todayAttendance?.check_in) {
      items.push({
        id: `att-in-${todayDate}`,
        type: 'attendance',
        message: `Checked in at ${formatAttendanceTime(todayAttendance.check_in)}`,
        at: todayAttendance.check_in,
      });
    }
    if (todayAttendance?.check_out) {
      items.push({
        id: `att-out-${todayDate}`,
        type: 'attendance',
        message: `Checked out at ${formatAttendanceTime(todayAttendance.check_out)}`,
        at: todayAttendance.check_out,
      });
    }
    if (!todayAttendance?.check_in && !todayLeave) {
      items.push({
        id: 'att-missing',
        type: 'attendance',
        message: 'No attendance marked for today yet',
        at: `${todayDate}T00:00:00`,
      });
    }

    leaves.slice(0, 8).forEach((row) => {
      if (row.status === 'PENDING') {
        items.push({
          id: `leave-pending-${row.id}`,
          type: 'leave',
          message: `Leave pending: ${row.leave_type_name} (${row.start_date} → ${row.end_date})`,
          at: row.applied_on,
        });
      }
      if (row.status === 'APPROVED' && row.reviewed_on) {
        items.push({
          id: `leave-approved-${row.id}`,
          type: 'leave',
          message: `Leave approved: ${row.leave_type_name}`,
          at: row.reviewed_on,
        });
      }
      if (row.status === 'REJECTED') {
        items.push({
          id: `leave-rejected-${row.id}`,
          type: 'leave',
          message: `Leave rejected: ${row.leave_type_name}${row.remarks ? ` — ${row.remarks}` : ''}`,
          at: row.reviewed_on || row.applied_on,
        });
      }
      if (row.remarks && row.status !== 'REJECTED') {
        items.push({
          id: `leave-hr-${row.id}`,
          type: 'hr',
          message: `HR note on leave: ${row.remarks}`,
          at: row.reviewed_on || row.applied_on,
        });
      }
    });

    documents.forEach((doc) => {
      if (doc.status === 'reupload_requested' || doc.workflow_status === 'REUPLOAD_REQUIRED') {
        items.push({
          id: `doc-reupload-${doc.id}`,
          type: 'document',
          message: `Re-upload requested: ${doc.document_label}`,
          at: doc.uploaded_at,
        });
      } else if (['pending', 'uploaded'].includes(doc.status) || doc.workflow_status === 'NOT_UPLOADED') {
        items.push({
          id: `doc-pending-${doc.id}`,
          type: 'document',
          message: `Document pending: ${doc.document_label}`,
          at: doc.uploaded_at,
        });
      } else if (['verified', 'physically_verified'].includes(doc.status) || doc.workflow_status === 'VERIFIED') {
        items.push({
          id: `doc-approved-${doc.id}`,
          type: 'document',
          message: `Document verified by HR: ${doc.document_label}`,
          at: doc.verified_at || doc.uploaded_at,
        });
      }
    });

    return items
      .filter((item) => item.at)
      .sort((a, b) => new Date(b.at) - new Date(a.at))
      .slice(0, 12);
  }, [documents, leaves, todayAttendance, todayDate, todayLeave]);

  const activityTimeline = useMemo(() => {
    const events = [];

    (attendance?.history || []).slice(-14).forEach((row) => {
      if (row.check_in) {
        events.push({
          id: `tl-in-${row.date}`,
          kind: 'check-in',
          label: 'Check-in',
          detail: formatAttendanceTime(row.check_in),
          at: row.check_in,
        });
      }
      if (row.check_out) {
        events.push({
          id: `tl-out-${row.date}`,
          kind: 'check-out',
          label: 'Check-out',
          detail: formatAttendanceTime(row.check_out),
          at: row.check_out,
        });
      }
    });

    leaves.forEach((row) => {
      if (row.applied_on) {
        events.push({
          id: `tl-leave-apply-${row.id}`,
          kind: 'leave',
          label: 'Leave applied',
          detail: `${row.leave_type_name} · ${row.start_date} → ${row.end_date}`,
          at: row.applied_on,
        });
      }
      if (row.reviewed_on && ['APPROVED', 'REJECTED'].includes(row.status)) {
        events.push({
          id: `tl-leave-review-${row.id}`,
          kind: 'hr',
          label: row.status === 'APPROVED' ? 'Leave approved' : 'Leave rejected',
          detail: row.remarks || row.leave_type_name,
          at: row.reviewed_on,
        });
      }
    });

    documents.forEach((doc) => {
      if (doc.uploaded_at) {
        events.push({
          id: `tl-doc-${doc.id}`,
          kind: 'document',
          label: 'Document uploaded',
          detail: doc.document_label,
          at: doc.uploaded_at,
        });
      }
    });

    return events
      .filter((e) => e.at)
      .sort((a, b) => new Date(b.at) - new Date(a.at))
      .slice(0, 15);
  }, [attendance, documents, leaves]);

  const todayStatusLabel = todayLeave
    ? 'On approved leave'
    : attendanceStatusLabel(todayAttendance?.status);

  if (loading) {
    return (
      <div className="mx-auto w-full max-w-lg space-y-4 pb-8">
        <SkeletonBlock className="h-24" />
        <div className="grid grid-cols-2 gap-3">
          <SkeletonBlock className="h-16" />
          <SkeletonBlock className="h-16" />
          <SkeletonBlock className="h-16" />
          <SkeletonBlock className="h-16" />
        </div>
        <SkeletonBlock className="h-32" />
        <SkeletonBlock className="h-40" />
        <SkeletonBlock className="h-36" />
      </div>
    );
  }

  if (!employee) {
    return (
      <div className="mx-auto max-w-lg rounded-xl border border-amber-200 bg-amber-50 p-6 text-sm text-amber-900">
        <p className="font-semibold">Employee profile not found</p>
        <p className="mt-2">
          No employee record is linked to your login email. Ask HR to confirm your portal email matches your employee record.
        </p>
        <button
          type="button"
          onClick={loadAll}
          className="mt-4 rounded-lg bg-amber-800 px-4 py-2 text-sm font-semibold text-white"
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-lg space-y-4 pb-8">
      <header className="rounded-2xl border border-teal-200 bg-gradient-to-br from-teal-50 to-emerald-50 p-4">
        <p className="text-xs font-bold uppercase tracking-wider text-teal-700">HRMS Control Center</p>
        <h1 className="mt-1 text-xl font-bold text-gray-900">{employee.name}</h1>
        <p className="text-sm text-gray-600">{employee.employee_id} · {employee.department || '—'}</p>
        <p className="mt-1 text-sm text-gray-500">{employee.designation || '—'}</p>
      </header>

      <SectionCard title="Today" icon={Clock}>
        <div className="space-y-3 text-sm">
          <div className="flex items-center justify-between rounded-xl bg-gray-50 px-3 py-2.5">
            <span className="text-gray-500">Attendance</span>
            <span className="font-semibold text-gray-900">{todayStatusLabel}</span>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-xl border border-gray-100 px-3 py-2.5">
              <p className="text-gray-500">Check-in</p>
              <p className="font-semibold text-gray-900">{formatCheckPunch(todayAttendance?.check_in)}</p>
            </div>
            <div className="rounded-xl border border-gray-100 px-3 py-2.5">
              <p className="text-gray-500">Check-out</p>
              <p className="font-semibold text-gray-900">{formatCheckPunch(todayAttendance?.check_out)}</p>
            </div>
          </div>
          <div className="rounded-xl border border-gray-100 px-3 py-2.5">
            <p className="text-gray-500">Shift</p>
            <p className="font-semibold text-gray-900">{shiftTimingLabel}</p>
          </div>
          <div className="rounded-xl border border-gray-100 px-3 py-2.5">
            <p className="text-gray-500">Leave today</p>
            <p className="font-semibold text-gray-900">
              {todayLeave ? `${todayLeave.leave_type_name} (approved)` : 'No approved leave'}
            </p>
          </div>
        </div>
      </SectionCard>

      <SectionCard title="Quick actions" icon={CalendarDays}>
        <div className="grid grid-cols-2 gap-2">
          <TouchLink
            to="/employee/attendance"
            className="border border-teal-200 bg-teal-50 text-teal-900 hover:bg-teal-100"
          >
            <LogIn size={16} /> View attendance
          </TouchLink>
          <TouchLink
            to="/employee/notifications"
            className="border border-teal-200 bg-teal-50 text-teal-900 hover:bg-teal-100"
          >
            <Bell size={16} /> Notifications
          </TouchLink>
          <TouchLink
            to="/employee/leaves"
            className="border border-gray-200 bg-white text-gray-800 hover:bg-gray-50"
          >
            <Calendar size={16} /> Apply Leave
          </TouchLink>
          <TouchLink
            to="/employee/attendance"
            className="border border-gray-200 bg-white text-gray-800 hover:bg-gray-50"
          >
            <CalendarDays size={16} /> Attendance
          </TouchLink>
          <TouchLink
            to="/employee/documents"
            className="border border-gray-200 bg-white text-gray-800 hover:bg-gray-50"
          >
            <FileText size={16} /> Documents
          </TouchLink>
          <TouchLink
            to="/employee/profile"
            className="border border-gray-200 bg-white text-gray-800 hover:bg-gray-50"
          >
            <User size={16} /> Profile
          </TouchLink>
        </div>
        <p className="mt-2 text-xs text-gray-500">
          Attendance is recorded by workplace systems. Use Attendance to view history or request corrections.
        </p>
      </SectionCard>

      <SectionCard
        title="Payslips"
        icon={Wallet}
        action={(
          <Link to="/employee/payslips" className="text-sm font-medium text-teal-700 hover:underline">
            View all
          </Link>
        )}
      >
        {recentPayslips.length === 0 ? (
          <p className="rounded-xl border border-dashed border-gray-300 px-4 py-4 text-center text-sm text-gray-500">
            No published payslips yet. They appear here after HR publishes your monthly payroll.
          </p>
        ) : (
          <ul className="space-y-2">
            {recentPayslips.map((payslip) => (
              <li key={payslip.id}>
                <Link
                  to={`/employee/payslips/${payslip.id}`}
                  className="flex items-center justify-between gap-3 rounded-xl border border-gray-100 bg-gray-50 px-3 py-2.5 text-sm transition hover:border-teal-200 hover:bg-teal-50/50"
                >
                  <div>
                    <p className="font-semibold text-gray-900">{monthLabel(payslip.month)}</p>
                    <p className="text-xs text-gray-500">{payslip.month}</p>
                  </div>
                  <span className="font-bold text-emerald-700">{formatCurrency(payslip.net_salary)}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>

      <SectionCard
        title="Leave snapshot"
        icon={Calendar}
        action={(
          <Link to="/employee/leaves" className="text-sm font-medium text-teal-700 hover:underline">
            Manage
          </Link>
        )}
      >
        {loadErrors.leaves ? (
          <p className="text-sm text-gray-500">Leave data unavailable — showing 0.</p>
        ) : null}
        <div className="grid grid-cols-2 gap-3">
          {[
            ['Total', leaveSnapshot.totalBalance],
            ['Used', leaveSnapshot.used],
            ['Remaining', leaveSnapshot.remaining],
            ['Pending', leaveSnapshot.pending],
          ].map(([label, value]) => (
            <div key={label} className="rounded-xl border border-gray-100 bg-gray-50 p-3 text-center">
              <p className="text-sm text-gray-500">{label}</p>
              <p className="mt-1 text-xl font-bold text-gray-900">{value}</p>
            </div>
          ))}
        </div>
      </SectionCard>

      <SectionCard
        title="Document status"
        icon={FileText}
        action={(
          <Link to="/employee/documents" className="text-sm font-medium text-teal-700 hover:underline">
            Open
          </Link>
        )}
      >
        {documentStats.total === 0 ? (
          <p className="rounded-xl border border-dashed border-gray-300 px-4 py-4 text-center text-sm text-gray-500">
            {loadErrors.documents
              ? 'Document data could not be loaded. Open Documents to retry.'
              : documentsAccessBlocked
                ? 'Your document checklist could not be loaded. Open Documents or contact HR.'
                : 'No documents required for your role.'}
          </p>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            {[
              ['Required', documentStats.required],
              ['Verified', documentStats.approved],
              ['Pending', documentStats.pending],
              ['Re-upload', documentStats.reupload],
            ].map(([label, value]) => (
              <div key={label} className="rounded-xl border border-gray-100 bg-gray-50 p-3 text-center">
                <p className="text-sm text-gray-500">{label}</p>
                <p className="mt-1 text-xl font-bold text-gray-900">{value}</p>
              </div>
            ))}
          </div>
        )}
      </SectionCard>

      <SectionCard
        title="Notifications"
        icon={Bell}
        action={(
          <Link to="/employee/notifications" className="text-sm font-medium text-teal-700 hover:underline">
            View all
          </Link>
        )}
      >
        {notifications.length === 0 ? (
          <p className="text-sm text-gray-500">No recent updates.</p>
        ) : (
          <ul className="space-y-2">
            {notifications.map((item) => (
              <li key={item.id} className="rounded-xl border border-gray-100 bg-gray-50 px-3 py-2.5 text-sm">
                <p className="font-medium text-gray-900">{item.message}</p>
                <p className="mt-0.5 text-xs text-gray-500">{formatAttendanceDateTime(item.at)}</p>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>

      <SectionCard title="Activity timeline" icon={Clock}>
        {activityTimeline.length === 0 ? (
          <p className="text-sm text-gray-500">No recent activity recorded.</p>
        ) : (
          <ul className="space-y-3 border-l-2 border-teal-200 pl-4">
            {activityTimeline.map((event) => (
              <li key={event.id} className="relative text-sm">
                <span className="absolute -left-[21px] top-1.5 h-2.5 w-2.5 rounded-full bg-teal-500" />
                <p className="font-semibold text-gray-900">{event.label}</p>
                <p className="text-gray-600">{event.detail}</p>
                <p className="text-xs text-gray-400">{formatAttendanceDateTime(event.at)}</p>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>

      {(dashboard?.recent_leave_requests || []).length > 0 && (
        <SectionCard
          title="Recent leave requests"
          icon={Calendar}
          action={(
            <button
              type="button"
              onClick={() => navigate('/employee/leaves')}
              className="text-sm font-medium text-teal-700 hover:underline"
            >
              View all
            </button>
          )}
        >
          <ul className="space-y-2">
            {(dashboard.recent_leave_requests || []).map((row) => (
              <li key={row.id} className="flex items-center justify-between gap-2 rounded-xl border border-gray-100 px-3 py-2.5 text-sm">
                <div className="min-w-0">
                  <p className="font-medium text-gray-900">{row.leave_type_name}</p>
                  <p className="truncate text-gray-500">{row.start_date} → {row.end_date}</p>
                </div>
                <span className={`shrink-0 rounded-full px-2 py-1 text-xs font-semibold ${statusBadge(row.status)}`}>
                  {row.status_display || row.status}
                </span>
              </li>
            ))}
          </ul>
        </SectionCard>
      )}
    </div>
  );
}
