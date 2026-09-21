import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import api, { payrollApi } from '../api';
import toast from 'react-hot-toast';
import {
  ArrowLeft,
  Download,
  Edit3,
  FileText,
  LogOut,
  Save,
  X,
} from 'lucide-react';
import { normalizeApiList } from '../hr/recruitmentLifecycle';
import { statusLabel } from '../utils/attendanceControl';
import { monthKey } from '../utils/attendanceCalendar';
import {
  formatAttendanceTime,
  formatShiftRange12h,
  todayIsoForAttendance,
} from '../utils/timeDisplay';
import EmployeeJourneyPanel from './hr/EmployeeJourneyPanel';
import PayrollReadinessWidget from './hr/PayrollReadinessWidget';
import {
  buildAssignedEmployeeIds,
  buildPayrollReadyEmployeeIds,
} from './hr/healthFilterUtils';
import {
  evaluateEmployeeJourneySteps,
  evaluatePayrollReadiness,
} from './hr/employeeJourneyUtils';
import { normalizePayrollList } from './hr/payroll/payrollUtils';
import {
  EXIT_REASON_OPTIONS,
  EXITED_EMPLOYEE_STATUSES,
  exitReasonLabel,
} from './hr/employeeExitUtils';
import {
  documentExpiryWarnings,
  formatBiometricLabel,
  formatCompensationLabel,
  formatDocsProgress,
  formatPortalLabel,
  salaryStructureMonthlyGross,
} from './hr/employeeDetail/employeeDetailHelpers';
import {
  DetailRow as Row,
  ExternalLink,
  LifecycleHistoryList,
  SummaryChip,
  TabButton,
} from './hr/employeeDetail/EmployeeDetailUi';

const STATUS_STYLES = {
  active: 'bg-emerald-100 text-emerald-800',
  pending_onboarding: 'bg-amber-100 text-amber-900',
  inactive: 'bg-slate-100 text-slate-700',
  terminated: 'bg-red-100 text-red-800',
};

function buildEmployeeUpdatePayload(form, departments = []) {
  const deptId = form.department_ref || null;
  const selected = departments.find((d) => String(d.id) === String(deptId));
  return {
    name: (form.name || '').trim(),
    email: (form.email || '').trim().toLowerCase(),
    phone: form.phone || '',
    gender: form.gender || '',
    designation: form.designation || null,
    job_title: (form.job_title || form.role || '').trim(),
    joining_date: form.joining_date || null,
    department_ref: deptId || null,
    department: selected?.name || (form.department || '').trim(),
    auto_assign_department_salary: true,
  };
}

function displayJoiningDate(employee) {
  return employee?.joining_date || employee?.joining_date_confirmed;
}

function formatDate(iso) {
  if (!iso) return '—';
  try {
    return new Date(`${iso.slice(0, 10)}T12:00:00`).toLocaleDateString('en-IN', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
  } catch {
    return iso;
  }
}

function formatDateTime(iso) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('en-IN', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

const GENDER_LABELS = {
  male: 'Male',
  female: 'Female',
  other: 'Other',
};

function formatGender(value) {
  return GENDER_LABELS[value] || value || '—';
}

function MarkAsExitedModal({
  open,
  employee,
  saving,
  onClose,
  onSubmit,
  form,
  onChange,
}) {
  useEffect(() => {
    if (!open) return undefined;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  if (!open || !employee) return null;

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
        <div className="flex shrink-0 items-start justify-between border-b border-slate-100 px-4 py-3">
          <div>
            <h2 className="text-lg font-bold text-slate-900">Mark as exited</h2>
            <p className="mt-1 text-sm text-slate-600">
              For <strong>{employee.name}</strong> — required before generating an experience letter.
            </p>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-1 text-slate-400 hover:bg-slate-100">
            <X size={18} />
          </button>
        </div>

        <form onSubmit={onSubmit} className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4">
            <label className="block text-sm">
              <span className="font-medium text-slate-700">Exit status *</span>
              <select
                required
                value={form.status}
                onChange={(e) => onChange('status', e.target.value)}
                className="mt-1 min-h-[44px] w-full rounded-lg border border-slate-200 px-3 text-sm"
              >
                <option value="terminated">Terminated</option>
                <option value="inactive">Inactive</option>
              </select>
            </label>

            <label className="block text-sm">
              <span className="font-medium text-slate-700">Relieving date *</span>
              <input
                type="date"
                required
                value={form.relieving_date}
                onChange={(e) => onChange('relieving_date', e.target.value)}
                className="mt-1 min-h-[44px] w-full rounded-lg border border-slate-200 px-3 text-sm"
              />
            </label>

            <label className="block text-sm">
              <span className="font-medium text-slate-700">Reason for leaving</span>
              <select
                required
                value={form.exit_reason}
                onChange={(e) => onChange('exit_reason', e.target.value)}
                className="mt-1 min-h-[44px] w-full rounded-lg border border-slate-200 px-3 text-sm"
              >
                <option value="">Select reason</option>
                {EXIT_REASON_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </label>

            <label className="block text-sm">
              <span className="font-medium text-slate-700">Conduct / performance</span>
              <input
                type="text"
                value={form.conduct_remarks}
                onChange={(e) => onChange('conduct_remarks', e.target.value)}
                placeholder="satisfactory"
                className="mt-1 min-h-[44px] w-full rounded-lg border border-slate-200 px-3 text-sm"
              />
            </label>

            <label className="block text-sm">
              <span className="font-medium text-slate-700">Exit notes</span>
              <textarea
                rows={3}
                value={form.exit_notes}
                onChange={(e) => onChange('exit_notes', e.target.value)}
                placeholder="Optional HR notes for this exit"
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
              />
            </label>

            <label className="flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={Boolean(form.eligible_for_rehire)}
                onChange={(e) => onChange('eligible_for_rehire', e.target.checked)}
              />
              Eligible for future rehire
            </label>
          </div>

          <div className="flex shrink-0 gap-2 border-t border-slate-100 px-4 py-3">
            <button
              type="button"
              onClick={onClose}
              className="min-h-[44px] flex-1 rounded-lg border border-slate-200 text-sm font-semibold text-slate-700 hover:bg-slate-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="min-h-[44px] flex-1 rounded-lg bg-red-600 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50"
            >
              {saving ? 'Saving…' : 'Confirm exit'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function RestoreEmployeeModal({
  open,
  employee,
  saving,
  form,
  onClose,
  onSubmit,
  onChange,
}) {
  useEffect(() => {
    if (!open) return undefined;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  if (!open || !employee) return null;

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
        <div className="flex items-start justify-between border-b border-slate-100 px-4 py-3">
          <div>
            <h2 className="text-lg font-bold text-slate-900">Restore to active</h2>
            <p className="mt-1 text-sm text-slate-600">
              This will reactivate <strong>{employee.name}</strong> and clear the current exit snapshot.
            </p>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-1 text-slate-400 hover:bg-slate-100">
            <X size={18} />
          </button>
        </div>

        <form onSubmit={onSubmit} className="space-y-4 px-4 py-4">
          <label className="block text-sm">
            <span className="font-medium text-slate-700">Reason for restoring *</span>
            <textarea
              required
              rows={4}
              value={form.reason}
              onChange={(e) => onChange('reason', e.target.value)}
              placeholder="Explain why this employee is being restored to active."
              className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
            />
          </label>

          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="min-h-[44px] flex-1 rounded-lg border border-slate-200 text-sm font-semibold text-slate-700 hover:bg-slate-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="min-h-[44px] flex-1 rounded-lg bg-emerald-600 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
            >
              {saving ? 'Restoring…' : 'Restore employee'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function ExperienceLetterPreviewModal({ open, html, loading, onClose, onDownload, downloading }) {
  useEffect(() => {
    if (!open) return undefined;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-3 sm:items-center sm:p-4"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="flex max-h-[90dvh] w-full max-w-3xl flex-col overflow-hidden rounded-xl bg-white shadow-lg"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
          <h2 className="text-lg font-bold text-slate-900">Experience letter preview</h2>
          <button type="button" onClick={onClose} className="rounded-lg p-1 text-slate-400 hover:bg-slate-100">
            <X size={18} />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto bg-slate-50 p-4">
          {loading ? (
            <p className="text-sm text-slate-500">Loading preview…</p>
          ) : (
            <div
              className="mx-auto max-w-2xl rounded-lg border border-slate-200 bg-white p-6 shadow-sm"
              dangerouslySetInnerHTML={{ __html: html || '' }}
            />
          )}
        </div>
        <div className="flex gap-2 border-t border-slate-100 px-4 py-3">
          <button
            type="button"
            onClick={onClose}
            className="min-h-[44px] flex-1 rounded-lg border border-slate-200 text-sm font-semibold text-slate-700 hover:bg-slate-50"
          >
            Close
          </button>
          <button
            type="button"
            onClick={onDownload}
            disabled={downloading || loading}
            className="min-h-[44px] flex-1 rounded-lg bg-violet-600 text-sm font-semibold text-white hover:bg-violet-700 disabled:opacity-50"
          >
            {downloading ? 'Downloading…' : 'Download PDF'}
          </button>
        </div>
      </div>
    </div>
  );
}

function AssignShiftModal({ open, employee, shifts, saving, onClose, onSubmit, selectedShift, onShiftChange }) {
  useEffect(() => {
    if (!open) return undefined;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  if (!open || !employee) return null;

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
        <div className="flex items-start justify-between border-b border-slate-100 px-4 py-3">
          <div>
            <h2 className="text-lg font-bold text-slate-900">Assign shift</h2>
            <p className="mt-1 text-sm text-slate-600">
              For <strong>{employee.name}</strong> — sets expected check-in time for attendance.
            </p>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-1 text-slate-400 hover:bg-slate-100">
            <X size={18} />
          </button>
        </div>

        <form onSubmit={onSubmit} className="space-y-4 px-4 py-4">
          {shifts.length === 0 ? (
            <p className="text-sm text-slate-600">
              No shifts set up yet.{' '}
              <Link to="/hr/operations/shifts" className="font-semibold text-violet-700 underline">
                Create a shift first
              </Link>
              .
            </p>
          ) : (
            <label className="block text-sm">
              <span className="font-medium text-slate-700">Work shift *</span>
              <select
                required
                value={selectedShift}
                onChange={(e) => onShiftChange(e.target.value)}
                className="mt-1 min-h-[44px] w-full rounded-lg border border-slate-200 px-3 text-sm"
              >
                <option value="">Select shift</option>
                {shifts.map((shift) => (
                  <option key={shift.id} value={shift.id}>
                    {shift.name} — {formatShiftRange12h(shift.start_time, shift.end_time)}
                  </option>
                ))}
              </select>
            </label>
          )}

          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="min-h-[44px] flex-1 rounded-lg border border-slate-200 text-sm font-semibold text-slate-700 hover:bg-slate-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving || shifts.length === 0 || !selectedShift}
              className="min-h-[44px] flex-1 rounded-lg bg-violet-600 text-sm font-semibold text-white hover:bg-violet-700 disabled:opacity-50"
            >
              {saving ? 'Saving…' : 'Assign shift'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function EditModal({ open, formData, departments, designations, saving, onClose, onChange, onSave }) {
  useEffect(() => {
    if (!open) return undefined;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-3 sm:items-center sm:p-4"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="flex max-h-[90dvh] w-full max-w-lg flex-col overflow-hidden rounded-xl bg-white shadow-lg"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <div className="flex items-start justify-between border-b border-slate-100 px-4 py-3">
          <h2 className="text-lg font-bold text-slate-900">Edit profile</h2>
          <button type="button" onClick={onClose} className="rounded-lg p-1 text-slate-400 hover:bg-slate-100">
            <X size={18} />
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-3">
          {[
            { key: 'name', label: 'Full name', type: 'text' },
            { key: 'email', label: 'Email', type: 'email' },
            { key: 'phone', label: 'Phone', type: 'tel' },
            { key: 'joining_date', label: 'Joining date', type: 'date' },
          ].map(({ key, label, type }) => (
            <label key={key} className="block text-sm">
              <span className="font-medium text-slate-700">{label}</span>
              <input
                type={type}
                value={
                  key === 'joining_date'
                    ? (formData.joining_date || displayJoiningDate(formData) || '').slice(0, 10)
                    : (formData[key] || '')
                }
                onChange={(e) => onChange(key, e.target.value)}
                className="mt-1 min-h-[44px] w-full rounded-lg border border-slate-200 px-3 text-sm"
              />
            </label>
          ))}
          <label className="block text-sm">
            <span className="font-medium text-slate-700">Gender</span>
            <select
              value={formData.gender || ''}
              onChange={(e) => onChange('gender', e.target.value)}
              className="mt-1 min-h-[44px] w-full rounded-lg border border-slate-200 px-3 text-sm"
            >
              <option value="">Select gender</option>
              <option value="male">Male</option>
              <option value="female">Female</option>
              <option value="other">Other</option>
            </select>
          </label>
          <label className="block text-sm">
            <span className="font-medium text-slate-700">Designation</span>
            <select
              value={String(formData.designation || '')}
              onChange={(e) => onChange('designation', e.target.value || null)}
              className="mt-1 min-h-[44px] w-full rounded-lg border border-slate-200 px-3 text-sm"
            >
              <option value="">Select designation</option>
              {designations.map((item) => (
                <option key={item.id} value={item.id}>{item.name}</option>
              ))}
            </select>
          </label>
          {!formData.designation && (
            <label className="block text-sm">
              <span className="font-medium text-slate-700">Job title (legacy)</span>
              <input
                type="text"
                value={formData.job_title || formData.role || ''}
                onChange={(e) => onChange('job_title', e.target.value)}
                className="mt-1 min-h-[44px] w-full rounded-lg border border-slate-200 px-3 text-sm"
              />
            </label>
          )}
          <label className="block text-sm">
            <span className="font-medium text-slate-700">Department</span>
            <select
              value={String(formData.department_ref || '')}
              onChange={(e) => {
                const selected = departments.find((d) => String(d.id) === String(e.target.value));
                onChange('department_ref', e.target.value || null, {
                  department: selected?.name || '',
                });
              }}
              className="mt-1 min-h-[44px] w-full rounded-lg border border-slate-200 px-3 text-sm"
            >
              <option value="">Select department</option>
              {departments.map((dept) => (
                <option key={dept.id} value={dept.id}>{dept.name}</option>
              ))}
            </select>
          </label>
        </div>

        <div className="border-t border-slate-100 px-4 py-3">
          <button
            type="button"
            onClick={onSave}
            disabled={saving}
            className="flex w-full min-h-[44px] items-center justify-center gap-2 rounded-lg bg-violet-600 text-sm font-semibold text-white hover:bg-violet-700 disabled:opacity-50"
          >
            <Save size={16} />
            {saving ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function EmployeeDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const today = todayIsoForAttendance();
  const currentMonth = monthKey();

  const [employee, setEmployee] = useState(null);
  const [departments, setDepartments] = useState([]);
  const [designations, setDesignations] = useState([]);
  const [shifts, setShifts] = useState([]);
  const [analytics, setAnalytics] = useState(null);
  const [documentPayload, setDocumentPayload] = useState(null);
  const [employeeStructures, setEmployeeStructures] = useState([]);
  const [salaryAssignments, setSalaryAssignments] = useState([]);
  const [shiftAssignments, setShiftAssignments] = useState([]);
  const [statusHistory, setStatusHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showEdit, setShowEdit] = useState(false);
  const [showAssignShift, setShowAssignShift] = useState(false);
  const [formData, setFormData] = useState({});
  const [selectedShift, setSelectedShift] = useState('');
  const [saving, setSaving] = useState(false);
  const [assigningShift, setAssigningShift] = useState(false);
  const [showMarkExited, setShowMarkExited] = useState(false);
  const [markExitedForm, setMarkExitedForm] = useState({
    status: 'terminated',
    relieving_date: '',
    exit_reason: '',
    exit_notes: '',
    conduct_remarks: 'satisfactory',
    eligible_for_rehire: false,
  });
  const [markingExited, setMarkingExited] = useState(false);
  const [showRestore, setShowRestore] = useState(false);
  const [restoreForm, setRestoreForm] = useState({ reason: '' });
  const [restoring, setRestoring] = useState(false);
  const [downloadingLetter, setDownloadingLetter] = useState(false);
  const [showLetterPreview, setShowLetterPreview] = useState(false);
  const [letterPreviewHtml, setLetterPreviewHtml] = useState('');
  const [loadingLetterPreview, setLoadingLetterPreview] = useState(false);
  const [activeTab, setActiveTab] = useState('overview');
  const [leaveBalances, setLeaveBalances] = useState([]);
  const [leaveRequests, setLeaveRequests] = useState([]);
  const [leaveLoading, setLeaveLoading] = useState(false);

  const loadEmployee = useCallback(async () => {
    setLoading(true);
    try {
      const results = await Promise.allSettled([
        api.get(`/hr/employees/${id}/`),
        api.get('/hr/daily-attendance/employee-analytics/', { params: { employee: id, month: currentMonth } }),
        api.get(`/hr/employees/${id}/documents/`),
        payrollApi.get('/structures/', { params: { active: 'true', employee: id } }),
        payrollApi.get('/compensation-assignments/', { params: { active: 'true', employee: id } }),
        api.get('/hr/employee-shifts/', { params: { employee: id, is_primary: true, limit: 50 } }),
        api.get(`/hr/employees/${id}/status-history/`),
      ]);

      if (results[0].status !== 'fulfilled') {
        toast.error('Employee not found');
        navigate('/hr/employees');
        return;
      }

      const employeeData = results[0].value.data;
      setEmployee(employeeData);
      setFormData(employeeData);
      setAnalytics(results[1].status === 'fulfilled' ? results[1].value.data : null);
      setDocumentPayload(results[2].status === 'fulfilled' ? results[2].value.data : null);
      setEmployeeStructures(
        results[3].status === 'fulfilled' ? normalizePayrollList(results[3].value.data) : [],
      );
      setSalaryAssignments(
        results[4].status === 'fulfilled' ? normalizePayrollList(results[4].value.data) : [],
      );
      setShiftAssignments(
        results[5].status === 'fulfilled' ? normalizeApiList(results[5].value.data) : [],
      );
      setStatusHistory(
        results[6].status === 'fulfilled' ? normalizeApiList(results[6].value.data) : [],
      );
    } catch {
      toast.error('Could not load employee');
      navigate('/hr/employees');
    } finally {
      setLoading(false);
    }
  }, [currentMonth, id, navigate]);

  const loadDepartments = useCallback(async () => {
    try {
      const [{ data: deptData }, { data: desData }] = await Promise.all([
        api.get('/hr/departments/', { params: { limit: 500 } }),
        api.get('/hr/designations/', { params: { active: 'true' } }),
      ]);
      setDepartments(normalizeApiList(deptData));
      setDesignations(normalizeApiList(desData));
    } catch {
      toast.error('Could not load departments');
    }
  }, []);

  const loadShifts = useCallback(async () => {
    try {
      const { data } = await api.get('/hr/shifts/', { params: { limit: 500 } });
      setShifts(normalizeApiList(data).filter((s) => s.active));
    } catch {
      toast.error('Could not load shifts');
      setShifts([]);
    }
  }, []);

  useEffect(() => {
    document.title = 'Employee profile | HR';
    loadEmployee();
  }, [loadEmployee]);

  useEffect(() => {
    if (!employee) return;
    const exited = EXITED_EMPLOYEE_STATUSES.has(employee.status);
    setActiveTab((prev) => {
      if (exited && (prev === 'overview' || !prev)) return 'exit';
      if (!exited && prev === 'exit') return 'overview';
      return prev;
    });
  }, [employee?.status, employee?.id]);

  useEffect(() => {
    if (!id || activeTab !== 'leave') return undefined;
    let cancelled = false;
    (async () => {
      setLeaveLoading(true);
      try {
        const [balRes, reqRes] = await Promise.allSettled([
          api.get('/hr/leave-balances/', { params: { employee: id } }),
          api.get('/hr/leave-requests/', { params: { employee: id } }),
        ]);
        if (cancelled) return;
        setLeaveBalances(
          balRes.status === 'fulfilled' ? normalizeApiList(balRes.value.data) : [],
        );
        setLeaveRequests(
          reqRes.status === 'fulfilled' ? normalizeApiList(reqRes.value.data) : [],
        );
      } finally {
        if (!cancelled) setLeaveLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [activeTab, id]);

  const todayAttendance = useMemo(
    () => (analytics?.history || []).find((row) => row.date === today) || null,
    [analytics, today],
  );

  const jobTitle = employee?.designation_name || employee?.job_title || employee?.role || '—';
  const departmentLabel = employee?.department_name || employee?.department || 'Not set';
  const activeCompensationAssignment = salaryAssignments[0] || null;
  const activeSalaryStructure = employeeStructures[0] || null;
  const hasPayAssigned = Boolean(activeCompensationAssignment || activeSalaryStructure);
  const customSalaryGross = salaryStructureMonthlyGross(activeSalaryStructure);
  const shiftRange = formatShiftRange12h(employee?.shift_start_time, employee?.shift_end_time);
  const statusClass = STATUS_STYLES[employee?.status] || 'bg-slate-100 text-slate-700';

  const journeyContext = useMemo(() => {
    const payrollReadyIds = buildPayrollReadyEmployeeIds(employeeStructures, salaryAssignments);
    const assignedEmployeeIds = buildAssignedEmployeeIds(shiftAssignments);
    const hasSalary = employee?.id
      ? payrollReadyIds.has(String(employee.id))
      : employeeStructures.length > 0;
    return {
      structureEmployeeIds: payrollReadyIds,
      assignedEmployeeIds,
      documentProgress: documentPayload?.progress || {},
      analytics,
      hasSalaryStructure: hasSalary,
      hasDesignationAssignment: employee?.designation
        ? salaryAssignments.length > 0
        : undefined,
      month: currentMonth,
      designations,
    };
  }, [analytics, currentMonth, designations, documentPayload, employee, employeeStructures, salaryAssignments, shiftAssignments]);

  const journeySteps = useMemo(
    () => (employee ? evaluateEmployeeJourneySteps(employee, journeyContext) : []),
    [employee, journeyContext],
  );

  const payrollReadiness = useMemo(
    () => (employee ? evaluatePayrollReadiness(employee, journeyContext) : null),
    [employee, journeyContext],
  );

  async function handleSave() {
    setSaving(true);
    try {
      await api.patch(`/hr/employees/${id}/`, buildEmployeeUpdatePayload(formData, departments));
      setShowEdit(false);
      toast.success('Profile updated');
      await loadEmployee();
    } catch (err) {
      const body = err.response?.data;
      toast.error(body?.detail || body?.error || 'Could not save changes');
    } finally {
      setSaving(false);
    }
  }

  async function handleAssignShift(e) {
    e.preventDefault();
    if (!selectedShift) {
      toast.error('Choose a shift');
      return;
    }
    setAssigningShift(true);
    try {
      await api.post('/hr/employee-shifts/', {
        employee: id,
        shift: selectedShift,
        effective_from: today,
        effective_to: null,
      });
      toast.success('Shift assigned');
      setShowAssignShift(false);
      setSelectedShift('');
      await loadEmployee();
    } catch (err) {
      toast.error(err.response?.data?.shift?.[0] || err.response?.data?.detail || 'Could not assign shift');
    } finally {
      setAssigningShift(false);
    }
  }

  function openEdit() {
    loadDepartments();
    setFormData({
      ...employee,
      department_ref: employee.department_ref || '',
      joining_date: (displayJoiningDate(employee) || '').slice(0, 10),
    });
    setShowEdit(true);
  }

  function openAssignShift() {
    loadShifts();
    setSelectedShift('');
    setShowAssignShift(true);
  }

  function openMarkExited() {
    setMarkExitedForm({
      status: employee?.status === 'inactive' ? 'inactive' : 'terminated',
      relieving_date: (employee?.relieving_date || '').slice(0, 10),
      exit_reason: employee?.exit_reason || '',
      exit_notes: employee?.exit_notes || '',
      conduct_remarks: employee?.conduct_remarks || 'satisfactory',
      eligible_for_rehire: employee?.status === 'active' ? false : Boolean(employee?.eligible_for_rehire),
    });
    setShowMarkExited(true);
  }

  function openRestore() {
    setRestoreForm({ reason: '' });
    setShowRestore(true);
  }

  async function handleMarkExited(e) {
    e.preventDefault();
    if (!markExitedForm.relieving_date) {
      toast.error('Relieving date is required');
      return;
    }
    if (!markExitedForm.exit_reason) {
      toast.error('Exit reason is required');
      return;
    }
    setMarkingExited(true);
    try {
      const { data } = await api.post(`/hr/employees/${id}/mark-exited/`, markExitedForm);
      setEmployee(data.employee);
      setShowMarkExited(false);
      toast.success('Employee marked as exited');
      await loadEmployee();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Could not mark employee as exited');
    } finally {
      setMarkingExited(false);
    }
  }

  async function handleRestoreEmployee(e) {
    e.preventDefault();
    if (!restoreForm.reason.trim()) {
      toast.error('Restore reason is required');
      return;
    }
    setRestoring(true);
    try {
      const { data } = await api.post(`/hr/employees/${id}/restore-active/`, restoreForm);
      setEmployee(data.employee);
      setShowRestore(false);
      toast.success('Employee restored to active');
      await loadEmployee();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Could not restore employee');
    } finally {
      setRestoring(false);
    }
  }

  async function downloadExperienceLetter() {
    if (downloadingLetter) return;
    setDownloadingLetter(true);
    try {
      const { data } = await api.get(`/hr/employees/${id}/experience-letter/download/`, {
        responseType: 'blob',
      });
      const url = window.URL.createObjectURL(data);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `Experience_Letter_${employee?.employee_id || id}.pdf`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.URL.revokeObjectURL(url);
      toast.success('Experience letter downloaded');
    } catch (err) {
      const message = err.response?.data?.error
        || (err.response?.status === 400 ? 'Cannot generate letter — check exit details' : 'Could not download letter');
      toast.error(message);
    } finally {
      setDownloadingLetter(false);
    }
  }

  async function openExperienceLetterPreview() {
    setShowLetterPreview(true);
    setLoadingLetterPreview(true);
    setLetterPreviewHtml('');
    try {
      const { data } = await api.get(`/hr/employees/${id}/experience-letter/preview/`);
      setLetterPreviewHtml(data.html || '');
    } catch (err) {
      toast.error(err.response?.data?.error || 'Could not load preview');
      setShowLetterPreview(false);
    } finally {
      setLoadingLetterPreview(false);
    }
  }

  const isExited = EXITED_EMPLOYEE_STATUSES.has(employee?.status);
  const canDownloadLetter = isExited && Boolean(employee?.relieving_date);

  if (loading) {
    return <p className="py-16 text-center text-sm text-slate-500">Loading…</p>;
  }

  if (!employee) return null;

  const shiftLabel = employee.shift_name
    ? `${employee.shift_name} · ${shiftRange}${employee.shift_is_overnight ? ' (overnight)' : ''}`
    : null;
  const backLink = isExited ? '/hr/employees/inactive' : '/hr/employees';
  const backLabel = isExited ? 'Inactive employees' : 'All employees';
  const compensationLabel = formatCompensationLabel(
    activeCompensationAssignment,
    activeSalaryStructure,
    customSalaryGross,
  );
  const assignPayMode = activeCompensationAssignment
    ? 'level'
    : activeSalaryStructure
      ? 'custom'
      : 'level';
  const assignPayHref = `/hr/payroll/assign/${employee.id}?mode=${assignPayMode}`;
  const docsProgress = documentPayload?.progress || {};
  const docsLabel = formatDocsProgress(docsProgress);
  const todayLabel = todayAttendance
    ? statusLabel(todayAttendance.status)
    : 'No record';
  const portalLabel = formatPortalLabel(employee);
  const biometricLabel = formatBiometricLabel(employee);
  const expiryWarnings = documentExpiryWarnings(documentPayload);
  const pendingLeaves = leaveRequests.filter((r) => String(r.status || '').toUpperCase() === 'PENDING');
  const effectiveTab = isExited
    ? (activeTab === 'overview' ? 'exit' : activeTab)
    : (activeTab === 'exit' ? 'overview' : activeTab);

  const tabs = [
    !isExited && { id: 'overview', label: 'Overview' },
    isExited && { id: 'exit', label: 'Exit' },
    { id: 'attendance', label: 'Attendance' },
    { id: 'payroll', label: 'Payroll' },
    { id: 'leave', label: 'Leave' },
    { id: 'documents', label: 'Documents' },
    { id: 'biometric', label: 'Biometric' },
    { id: 'activity', label: 'Activity' },
  ].filter(Boolean);

  return (
    <div className="mx-auto max-w-3xl space-y-3 pb-10 pt-2">
      <Link
        to={backLink}
        className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-600 hover:text-violet-700"
      >
        <ArrowLeft size={16} />
        {backLabel}
      </Link>

      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-bold text-slate-900">{employee.name}</h1>
            <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold ${statusClass}`}>
              {employee.status_display || employee.status?.replace(/_/g, ' ')}
            </span>
          </div>
          <p className="mt-1 text-sm text-slate-600">
            {employee.employee_id || 'No ID'} · {jobTitle} · {departmentLabel}
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
          <button
            type="button"
            onClick={openEdit}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
          >
            <Edit3 size={15} />
            Edit
          </button>
          {!isExited && employee.status === 'active' && (
            <button
              type="button"
              onClick={openMarkExited}
              className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-semibold text-red-800 hover:bg-red-100"
            >
              <LogOut size={15} />
              Mark as exited
            </button>
          )}
          {isExited && (
            <>
              <button
                type="button"
                onClick={openRestore}
                className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-800 hover:bg-emerald-100"
              >
                <Save size={15} />
                Restore to active
              </button>
              <button
                type="button"
                onClick={openExperienceLetterPreview}
                disabled={!canDownloadLetter}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <FileText size={15} />
                Preview letter
              </button>
              <button
                type="button"
                onClick={downloadExperienceLetter}
                disabled={!canDownloadLetter || downloadingLetter}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Download size={15} />
                {downloadingLetter ? 'Downloading…' : 'Download letter'}
              </button>
              <button
                type="button"
                onClick={openMarkExited}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
              >
                <Edit3 size={15} />
                Edit exit details
              </button>
            </>
          )}
        </div>
      </div>

      {employee.hire_context?.is_direct_office_hire && (
        <div className="rounded-lg border border-teal-200 bg-teal-50 px-3 py-2.5 text-sm text-teal-950">
          <p className="font-medium">{employee.hire_context.label}</p>
        </div>
      )}

      {isExited && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-950">
          <p className="font-medium">Archived employee record</p>
          <p className="mt-0.5 text-xs">
            This profile stays available for historical attendance, documents, payroll context, and controlled restore decisions.
          </p>
        </div>
      )}

      {isExited && !employee.relieving_date && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-950">
          <p className="font-medium">Relieving date required</p>
          <p className="mt-0.5 text-xs">Update exit details before downloading the experience letter.</p>
          <button
            type="button"
            onClick={openMarkExited}
            className="mt-2 text-xs font-semibold text-amber-900 underline"
          >
            Update exit details
          </button>
        </div>
      )}

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
        <SummaryChip label="Compensation" value={compensationLabel} warn={!hasPayAssigned} />
        <SummaryChip label="Shift" value={employee.shift_name || 'Not assigned'} warn={!employee.shift_name} />
        <SummaryChip label="Documents" value={docsLabel} warn={!docsProgress.all_mandatory_verified} />
        <SummaryChip label="Today" value={isExited ? '—' : todayLabel} />
        <SummaryChip label="Portal" value={portalLabel} warn={portalLabel === 'No portal'} />
      </div>

      <div className="flex gap-1 overflow-x-auto rounded-xl border border-slate-200 bg-slate-50 p-1" role="tablist">
        {tabs.map((tab) => (
          <TabButton
            key={tab.id}
            id={tab.id}
            label={tab.label}
            active={effectiveTab === tab.id}
            onClick={setActiveTab}
          />
        ))}
      </div>

      {effectiveTab === 'overview' && !isExited && (
        <div className="space-y-3">
          <PayrollReadinessWidget readiness={payrollReadiness} />
          <EmployeeJourneyPanel steps={journeySteps} onAssignShift={openAssignShift} employeeId={id} />
          <section className="rounded-lg border border-slate-200 bg-white px-4 py-2">
            <h2 className="py-2 text-sm font-bold text-slate-900">Profile</h2>
            <Row
              label="Email"
              value={
                employee.email ? (
                  <a href={`mailto:${employee.email}`} className="text-violet-700 hover:underline">
                    {employee.email}
                  </a>
                ) : null
              }
            />
            <Row
              label="Phone"
              value={
                employee.phone ? (
                  <a href={`tel:${employee.phone}`} className="text-violet-700 hover:underline">
                    {employee.phone}
                  </a>
                ) : (
                  'Not set'
                )
              }
            />
            <Row label="Gender" value={formatGender(employee.gender)} />
            <Row label="Joined" value={formatDate(displayJoiningDate(employee))} />
            <div className="flex items-start justify-between gap-3 py-2.5">
              <span className="text-sm text-slate-500">Work shift</span>
              <div className="flex items-start gap-2 text-right">
                <span className={`text-sm font-medium ${shiftLabel ? 'text-slate-900' : 'text-amber-800'}`}>
                  {shiftLabel || 'Not assigned'}
                </span>
                <button
                  type="button"
                  onClick={openAssignShift}
                  className="shrink-0 text-xs font-semibold text-violet-700 hover:underline"
                >
                  {employee.shift_name ? 'Change' : 'Assign'}
                </button>
              </div>
            </div>
            <Row label="Portal" value={portalLabel} />
            {(employee.portal_account_created_at || employee.activated_at) && (
              <>
                <Row label="Portal created" value={formatDateTime(employee.portal_account_created_at)} />
                <Row label="Activated" value={formatDateTime(employee.activated_at)} />
              </>
            )}
          </section>
        </div>
      )}

      {effectiveTab === 'exit' && isExited && (
        <section className="rounded-lg border border-slate-200 bg-white px-4 py-2">
          <h2 className="py-2 text-sm font-bold text-slate-900">Exit details</h2>
          <Row label="Relieving date" value={formatDate(employee.relieving_date)} />
          <Row label="Exit reason" value={employee.exit_reason_display || exitReasonLabel(employee.exit_reason)} />
          <Row label="Conduct" value={employee.conduct_remarks || 'satisfactory'} />
          <Row label="Eligible for rehire" value={employee.eligible_for_rehire ? 'Yes' : 'No'} />
          <Row label="Exit notes" value={employee.exit_notes || '—'} />
          <Row label="Exit confirmed by" value={employee.last_working_day_confirmed_by_name || '—'} />
          <Row label="Exited on" value={employee.exited_at ? formatDate(employee.exited_at.slice(0, 10)) : '—'} />
          <div className="border-t border-slate-100 pt-3">
            <h3 className="mb-2 text-sm font-bold text-slate-900">Lifecycle</h3>
            <LifecycleHistoryList
              statusHistory={statusHistory}
              formatDate={formatDate}
              formatDateTime={formatDateTime}
            />
          </div>
        </section>
      )}

      {effectiveTab === 'attendance' && (
        <section className="rounded-lg border border-slate-200 bg-white px-4 py-3 space-y-3">
          <h2 className="text-sm font-bold text-slate-900">Attendance</h2>
          {!isExited ? (
            <>
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Today</p>
                {todayAttendance ? (
                  <p className="mt-1 text-sm text-slate-700">
                    <strong>{statusLabel(todayAttendance.status)}</strong>
                    {todayAttendance.check_in && (
                      <>
                        {' · In '}
                        {formatAttendanceTime(todayAttendance.check_in)}
                      </>
                    )}
                    {todayAttendance.check_out && (
                      <>
                        {' · Out '}
                        {formatAttendanceTime(todayAttendance.check_out)}
                      </>
                    )}
                  </p>
                ) : (
                  <p className="mt-1 text-sm text-slate-500">No attendance recorded yet today.</p>
                )}
              </div>
              {analytics?.summary && (
                <p className="text-xs text-slate-500">
                  This month: {analytics.summary.present_days ?? 0} present · {analytics.summary.absent_days ?? 0} absent
                  {analytics.summary.attendance_percentage != null && (
                    <> · {analytics.summary.attendance_percentage}% attendance</>
                  )}
                </p>
              )}
              <div className="flex flex-wrap gap-3">
                <ExternalLink to={`/hr/employees/${id}/attendance`}>View full attendance</ExternalLink>
                <ExternalLink to="/hr/operations/punch-logs" state={{ fromEmployeeId: id }}>Punch logs</ExternalLink>
                <ExternalLink to="/hr/operations/regularizations" state={{ fromEmployeeId: id }}>Regularizations</ExternalLink>
              </div>
              <div className="border-t border-slate-100 pt-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm text-slate-600">
                    Shift: <span className="font-medium text-slate-900">{shiftLabel || 'Not assigned'}</span>
                  </p>
                  <button
                    type="button"
                    onClick={openAssignShift}
                    className="text-xs font-semibold text-violet-700 hover:underline"
                  >
                    {employee.shift_name ? 'Change' : 'Assign'}
                  </button>
                </div>
              </div>
            </>
          ) : (
            <div className="space-y-2">
              <p className="text-sm text-slate-600">Historical attendance remains available for this exited employee.</p>
              <ExternalLink to={`/hr/employees/${id}/attendance`}>View attendance history</ExternalLink>
            </div>
          )}
        </section>
      )}

      {effectiveTab === 'payroll' && (
        <section className="rounded-lg border border-slate-200 bg-white px-4 py-3 space-y-3">
          <h2 className="text-sm font-bold text-slate-900">Payroll</h2>
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Compensation</p>
              <p className={`mt-1 text-sm font-medium ${hasPayAssigned ? 'text-slate-900' : 'text-amber-800'}`}>
                {compensationLabel}
              </p>
            </div>
            {!isExited && employee.designation && (
              <Link
                to={assignPayHref}
                className="shrink-0 text-xs font-semibold text-violet-700 hover:underline"
              >
                {hasPayAssigned ? 'Change' : 'Assign'}
              </Link>
            )}
          </div>
          {!isExited && <PayrollReadinessWidget readiness={payrollReadiness} />}
          <div className="flex flex-wrap gap-3 border-t border-slate-100 pt-3">
            {!isExited && employee.designation && (
              <ExternalLink to={assignPayHref}>Open salary assign</ExternalLink>
            )}
            <ExternalLink to="/hr/payroll/runs" state={{ fromEmployeeId: id }}>Payroll runs</ExternalLink>
            <ExternalLink to="/hr/payroll/payslips" state={{ fromEmployeeId: id }}>Payslips</ExternalLink>
          </div>
        </section>
      )}

      {effectiveTab === 'leave' && (
        <section className="rounded-lg border border-slate-200 bg-white px-4 py-3 space-y-3">
          <h2 className="text-sm font-bold text-slate-900">Leave</h2>
          {leaveLoading ? (
            <p className="text-sm text-slate-500">Loading leave…</p>
          ) : (
            <>
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Balances</p>
                {leaveBalances.length === 0 ? (
                  <p className="mt-1 text-sm text-slate-500">No leave balances found.</p>
                ) : (
                  <ul className="mt-1 space-y-1 text-sm text-slate-700">
                    {leaveBalances.slice(0, 6).map((row) => {
                      const total = Number(row.total_days) || 0;
                      const used = Number(row.used_days) || 0;
                      const left = row.is_unlimited ? 'Unlimited' : Math.max(0, total - used);
                      return (
                        <li key={row.id || `${row.leave_type}-${row.employee}`}>
                          {row.leave_type_name || row.leave_type || 'Leave'}: {left}
                          {!row.is_unlimited && ` left (${used}/${total} used)`}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Pending requests</p>
                <p className="mt-1 text-sm text-slate-700">
                  {pendingLeaves.length} pending of {leaveRequests.length} total
                </p>
              </div>
            </>
          )}
          <div className="flex flex-wrap gap-3 border-t border-slate-100 pt-3">
            <ExternalLink to="/hr/leave/balances" state={{ fromEmployeeId: id }}>Leave balances</ExternalLink>
            <ExternalLink to="/hr/leave/requests" state={{ fromEmployeeId: id }}>Leave requests</ExternalLink>
          </div>
        </section>
      )}

      {effectiveTab === 'documents' && (
        <section className="rounded-lg border border-slate-200 bg-white px-4 py-3 space-y-3">
          <h2 className="text-sm font-bold text-slate-900">Documents</h2>
          <Row label="Progress" value={docsLabel} />
          <Row
            label="Mandatory complete"
            value={docsProgress.all_mandatory_verified ? 'Yes' : 'No'}
          />
          {docsProgress.verified_count != null && (
            <Row
              label="Verified"
              value={`${docsProgress.verified_count}${docsProgress.total_required != null ? ` / ${docsProgress.total_required}` : ''}`}
            />
          )}
          {expiryWarnings.length > 0 && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950">
              <p className="font-medium">Expiring soon</p>
              <ul className="mt-1 list-disc pl-4 text-xs">
                {expiryWarnings.map((row) => (
                  <li key={row.id || row.document_label}>
                    {row.document_label || row.document_type_name || row.name || 'Document'}
                    {(row.expires_at || row.expiry_date) && (
                      <> · {formatDate(String(row.expires_at || row.expiry_date).slice(0, 10))}</>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <ExternalLink to={`/hr/employees/${id}/documents`}>Open document verification</ExternalLink>
        </section>
      )}

      {effectiveTab === 'biometric' && (
        <section className="rounded-lg border border-slate-200 bg-white px-4 py-3 space-y-1">
          <h2 className="py-2 text-sm font-bold text-slate-900">Biometric</h2>
          <Row label="Attendance enabled" value={employee.biometric_attendance_enabled ? 'Yes' : 'No'} />
          <Row label="Sync status" value={biometricLabel} />
          <Row label="PIN" value={employee.biometric_pin || '—'} />
          <Row label="Last synced" value={formatDateTime(employee.biometric_last_synced_at)} />
          {employee.biometric_enrollment?.status && (
            <Row label="Enrollment" value={employee.biometric_enrollment.status} />
          )}
          <div className="flex flex-wrap gap-3 border-t border-slate-100 pt-3">
            <ExternalLink to="/hr/operations/biometric-conflicts" state={{ fromEmployeeId: id }}>Biometric conflicts</ExternalLink>
            <ExternalLink to="/hr/operations/biometric-rejected-punches" state={{ fromEmployeeId: id }}>Rejected punches</ExternalLink>
          </div>
        </section>
      )}

      {effectiveTab === 'activity' && (
        <section className="rounded-lg border border-slate-200 bg-white px-4 py-3">
          <h2 className="mb-2 text-sm font-bold text-slate-900">Lifecycle history</h2>
          <LifecycleHistoryList
            statusHistory={statusHistory}
            formatDate={formatDate}
            formatDateTime={formatDateTime}
          />
        </section>
      )}

      <EditModal
        open={showEdit}
        formData={formData}
        departments={departments}
        designations={designations}
        saving={saving}
        onClose={() => setShowEdit(false)}
        onChange={(key, value, extra = {}) => setFormData((prev) => ({ ...prev, [key]: value, ...extra }))}
        onSave={handleSave}
      />

      <AssignShiftModal
        open={showAssignShift}
        employee={employee}
        shifts={shifts}
        saving={assigningShift}
        onClose={() => setShowAssignShift(false)}
        onSubmit={handleAssignShift}
        selectedShift={selectedShift}
        onShiftChange={setSelectedShift}
      />

      <MarkAsExitedModal
        open={showMarkExited}
        employee={employee}
        saving={markingExited}
        onClose={() => setShowMarkExited(false)}
        onSubmit={handleMarkExited}
        form={markExitedForm}
        onChange={(key, value) => setMarkExitedForm((prev) => ({ ...prev, [key]: value }))}
      />

      <RestoreEmployeeModal
        open={showRestore}
        employee={employee}
        saving={restoring}
        form={restoreForm}
        onClose={() => setShowRestore(false)}
        onSubmit={handleRestoreEmployee}
        onChange={(key, value) => setRestoreForm((prev) => ({ ...prev, [key]: value }))}
      />

      <ExperienceLetterPreviewModal
        open={showLetterPreview}
        html={letterPreviewHtml}
        loading={loadingLetterPreview}
        onClose={() => setShowLetterPreview(false)}
        onDownload={downloadExperienceLetter}
        downloading={downloadingLetter}
      />
    </div>
  );
}
