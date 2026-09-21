import React, { useCallback, useEffect, useMemo, useState } from 'react';
import api from '../../api';
import toast from 'react-hot-toast';
import {
  AlertTriangle,
  ArrowDownToLine,
  ArrowUpFromLine,
  Calendar,
  ChevronDown,
  Clock,
  Fingerprint,
  FlaskConical,
  Loader2,
  LogIn,
  LogOut,
  RefreshCw,
  Save,
  Search,
  User,
} from 'lucide-react';
import { normalizeApiList } from '../../hr/recruitmentLifecycle';
import { TableSkeleton } from '../../components/HR/HRSkeleton';
import {
  MARK_STATUSES,
  PUNCH_STATUSES,
  existingStatusClass,
  formatToday,
  getDefaultCheckTimes,
  isFutureDate,
  isWeekendDate,
  existingToMarkStatus,
  parseApiMarkError,
  statusLabel,
  validateAttendanceRow,
} from '../../utils/attendanceControl';
import {
  datetimeLocalToPunchPayload,
  formatAttendanceTime,
  formatBrowserClock,
  nowBrowserDatetimeLocal,
  nowDatetimeLocalForAttendance,
  toAttendanceTimeInputValue,
  ATTENDANCE_TIME_ZONE,
} from '../../utils/timeDisplay';
import MonthAttendanceGeneratorPanel from './MonthAttendanceGeneratorPanel';

const BATCH_SIZE = 5;
const DEVICE_ID = 'BIO_SIM';

function formatClock() {
  return formatBrowserClock();
}

function formatPunchTime(iso) {
  return formatAttendanceTime(iso);
}

function buildBulkRow(employee, dailyByEmployee, punchMetaByEmployee, shiftById) {
  const empId = String(employee.id);
  const daily = dailyByEmployee.get(empId);
  const punchMeta = punchMetaByEmployee.get(empId);
  const shift = employee.shift ? shiftById.get(String(employee.shift)) : null;
  const hasPunches = Boolean(punchMeta?.count);
  const hasSimulation = Boolean(punchMeta?.hasSimulation);
  const existingStatus = daily?.attendance_status || (hasPunches ? 'incomplete' : null);
  const locked = Boolean(daily?.calculation_locked || daily?.manually_corrected);
  const hasExisting = Boolean(
    hasPunches
    || hasSimulation
    || (existingStatus && !['incomplete', 'in_progress', 'missing_checkout'].includes(existingStatus)),
  );
  let checkIn = '';
  let checkOut = '';
  if (daily?.first_check_in) checkIn = toAttendanceTimeInputValue(daily.first_check_in);
  if (daily?.last_check_out) checkOut = toAttendanceTimeInputValue(daily.last_check_out);
  if (punchMeta?.inTime && !checkIn) checkIn = punchMeta.inTime;
  if (punchMeta?.outTime && !checkOut) checkOut = punchMeta.outTime;
  return {
    key: empId,
    employee,
    department: employee.department || '—',
    shiftName: employee.shift_name || shift?.name || '—',
    shiftId: employee.shift ? String(employee.shift) : '',
    shift,
    markStatus: existingToMarkStatus(existingStatus),
    checkIn,
    checkOut,
    existingStatus,
    locked,
    hasExisting,
    hasPunches,
    hasSimulation,
    rowError: '',
    saveState: locked ? 'locked' : hasExisting ? 'existing' : 'idle',
  };
}

export default function AttendanceControlPage() {
  const [clock, setClock] = useState(formatClock());
  const [employees, setEmployees] = useState([]);
  const [employeesLoading, setEmployeesLoading] = useState(true);
  const [scanCode, setScanCode] = useState('');
  const [search, setSearch] = useState('');
  const [selectedEmployee, setSelectedEmployee] = useState(null);
  const [consoleState, setConsoleState] = useState(null);
  const [consoleLoading, setConsoleLoading] = useState(false);
  const [punching, setPunching] = useState(null);
  const [useCustomPunchTime, setUseCustomPunchTime] = useState(false);
  const [customPunchTime, setCustomPunchTime] = useState('');
  const [showBulk, setShowBulk] = useState(false);
  const [showMonthGenerator, setShowMonthGenerator] = useState(true);

  const [selectedDate, setSelectedDate] = useState(formatToday());
  const [bulkLoading, setBulkLoading] = useState(false);
  const [bulkSaving, setBulkSaving] = useState(false);
  const [bulkRows, setBulkRows] = useState([]);
  const [bulkShifts, setBulkShifts] = useState([]);

  useEffect(() => {
    document.title = 'Biometric Simulator | HR';
    const id = setInterval(() => setClock(formatClock()), 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    setEmployeesLoading(true);
    api
      .get('/hr/employees/', { params: { limit: 500 } })
      .then((res) => setEmployees(normalizeApiList(res.data).filter((e) => e.status === 'active')))
      .catch(() => toast.error('Failed to load employees'))
      .finally(() => setEmployeesLoading(false));
  }, []);

  const filteredEmployees = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return employees.slice(0, 30);
    return employees.filter(
      (e) =>
        (e.name && e.name.toLowerCase().includes(q))
        || (e.employee_id && e.employee_id.toLowerCase().includes(q)),
    );
  }, [employees, search]);

  const loadConsole = useCallback(async (employee) => {
    if (!employee?.id) return;
    setConsoleLoading(true);
    try {
      const { data } = await api.get('/hr/attendance-control/console/', {
        params: { employee_id: employee.id },
      });
      setConsoleState(data);
    } catch (error) {
      toast.error(parseApiMarkError(error, 'Could not load punch console'));
      setConsoleState(null);
    } finally {
      setConsoleLoading(false);
    }
  }, []);

  function selectEmployee(employee) {
    setSelectedEmployee(employee);
    setScanCode(employee.employee_id || '');
    loadConsole(employee);
  }

  function lookupByScan() {
    const code = scanCode.trim().toUpperCase();
    if (!code) {
      toast.error('Enter or scan employee ID');
      return;
    }
    const match =
      employees.find((e) => (e.employee_id || '').toUpperCase() === code)
      || employees.find((e) => String(e.id) === code);
    if (!match) {
      toast.error(`No active employee found for ID: ${code}`);
      return;
    }
    selectEmployee(match);
    toast.success(`Employee: ${match.name}`);
  }

  async function recordPunch(punchType) {
    if (!selectedEmployee) {
      toast.error('Select an employee first');
      return;
    }
    if (consoleState && !consoleState.can_punch) {
      toast.error('Cannot punch for this employee or date');
      return;
    }
    setPunching(punchType);
    try {
      const payload = {
        employee_id: selectedEmployee.id,
        punch_type: punchType,
      };
      // Always send wall-clock time from the UI (PC taskbar), not server timezone.now().
      const wallSource = useCustomPunchTime && customPunchTime ? customPunchTime : nowBrowserDatetimeLocal();
      const wall = datetimeLocalToPunchPayload(wallSource);
      if (!wall) {
        toast.error('Invalid punch time');
        setPunching(null);
        return;
      }
      Object.assign(payload, wall);
      const { data } = await api.post('/hr/attendance-control/punch/', payload);
      setConsoleState((prev) => ({
        ...prev,
        suggested_next_punch_type: data.suggested_next_punch_type,
        today_punches: data.today_punches,
        daily_attendance: data.daily_attendance,
      }));
      const recorded = data.local_time
        ? formatAttendanceTime(data.timestamp)
        : formatPunchTime(data.timestamp);
      toast.success(
        `${punchType === 'IN' ? 'Check-in' : 'Check-out'} recorded at ${recorded} (${ATTENDANCE_TIME_ZONE})`,
      );
    } catch (error) {
      toast.error(parseApiMarkError(error, 'Punch failed'));
    } finally {
      setPunching(null);
    }
  }

  const suggested = consoleState?.suggested_next_punch_type || 'IN';
  const daily = consoleState?.daily_attendance;

  async function loadBulk() {
    setBulkLoading(true);
    const params = { date_from: selectedDate, date_to: selectedDate, limit: 500 };
    try {
      const settled = await Promise.allSettled([
        api.get('/hr/employees/', { params: { limit: 500 } }).then((r) => r.data),
        api.get('/hr/daily-attendance/', { params }).then((r) => r.data),
        api.get('/hr/attendance-punches/', { params: { ...params, limit: 2000 } }).then((r) => r.data),
        api.get('/hr/shifts/', { params: { limit: 500 } }).then((r) => r.data),
      ]);
      const empList = settled[0].status === 'fulfilled' ? normalizeApiList(settled[0].value) : [];
      const dailyList = settled[1].status === 'fulfilled' ? normalizeApiList(settled[1].value) : [];
      const punchList = settled[2].status === 'fulfilled' ? normalizeApiList(settled[2].value) : [];
      const shiftList = settled[3].status === 'fulfilled' ? normalizeApiList(settled[3].value) : [];
      const shiftById = new Map(shiftList.map((s) => [String(s.id), s]));
      const dailyByEmployee = new Map(dailyList.map((d) => [String(d.employee), d]));
      const punchMetaByEmployee = new Map();
      for (const punch of punchList) {
        if (punch.is_void) continue;
        const empId = String(punch.employee);
        const meta = punchMetaByEmployee.get(empId) || { count: 0, hasSimulation: false, inTime: '', outTime: '' };
        meta.count += 1;
        if (punch.source === 'MANUAL_BIOMETRIC_SIMULATION') meta.hasSimulation = true;
        if (punch.punch_type === 'IN' && punch.timestamp) {
          meta.inTime = punch.local_time?.slice(0, 5) || toAttendanceTimeInputValue(punch.timestamp);
        }
        if (punch.punch_type === 'OUT' && punch.timestamp) {
          meta.outTime = punch.local_time?.slice(0, 5) || toAttendanceTimeInputValue(punch.timestamp);
        }
        punchMetaByEmployee.set(empId, meta);
      }
      setBulkRows(
        empList
          .filter((e) => e.status === 'active' || e.status === 'inactive')
          .sort((a, b) => (a.name || '').localeCompare(b.name || ''))
          .map((emp) => buildBulkRow(emp, dailyByEmployee, punchMetaByEmployee, shiftById)),
      );
      setBulkShifts(shiftList);
    } catch {
      toast.error('Failed to load bulk table');
    } finally {
      setBulkLoading(false);
    }
  }

  useEffect(() => {
    if (showBulk) loadBulk();
  }, [showBulk, selectedDate]);

  function updateBulkRow(key, patch) {
    setBulkRows((prev) =>
      prev.map((row) => {
        if (row.key !== key) return row;
        const next = { ...row, ...patch, rowError: '' };
        if (patch.markStatus !== undefined) {
          if (patch.markStatus === 'ABSENT') {
            next.checkIn = '';
            next.checkOut = '';
          } else if (PUNCH_STATUSES.has(patch.markStatus)) {
            const defaults = getDefaultCheckTimes(row.employee, row.shift, patch.markStatus);
            if (!row.checkIn || patch.markStatus !== row.markStatus) next.checkIn = defaults.checkIn;
            if (!row.checkOut || patch.markStatus !== row.markStatus) next.checkOut = defaults.checkOut;
          }
        }
        return next;
      }),
    );
  }

  async function saveBulkRow(row) {
    const err = validateAttendanceRow(row, selectedDate);
    if (err) return { ok: false, error: err };
    const payload = { employee_id: row.employee.id, date: selectedDate, status: row.markStatus };
    if (PUNCH_STATUSES.has(row.markStatus)) {
      payload.check_in = row.checkIn;
      payload.check_out = row.checkOut;
    }
    if (row.hasExisting) {
      payload.replace_existing = true;
    }
    try {
      const { data } = await api.post('/hr/attendance-control/mark/', payload);
      return { ok: true, data, row };
    } catch (error) {
      return { ok: false, error: parseApiMarkError(error), row };
    }
  }

  async function handleBulkSave() {
    const targets = bulkRows.filter((r) => r.markStatus && !r.locked && r.employee.status === 'active');
    if (!targets.length) {
      toast.error('Select a status for at least one active employee');
      return;
    }
    if (isFutureDate(selectedDate)) {
      toast.error('Cannot save attendance for a future date');
      return;
    }
    setBulkSaving(true);
    let ok = 0;
    let fail = 0;
    for (let i = 0; i < targets.length; i += BATCH_SIZE) {
      const chunk = targets.slice(i, i + BATCH_SIZE);
      const results = await Promise.allSettled(chunk.map((row) => saveBulkRow(row)));
      results.forEach((result, idx) => {
        const row = chunk[idx];
        if (result.status === 'fulfilled' && result.value.ok) ok += 1;
        else fail += 1;
      });
    }
    setBulkSaving(false);
    if (ok) toast.success(`Bulk marked ${ok} employee(s)`);
    if (fail) toast.error(`${fail} failed`);
    if (ok) loadBulk();
  }

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-gradient-to-br from-slate-900 via-slate-800 to-indigo-950 text-white shadow-lg">
        <div className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-white/10 ring-1 ring-white/20">
              <Fingerprint className="h-7 w-7 text-indigo-200" />
            </div>
            <div>
              <h1 className="text-xl font-bold tracking-tight sm:text-2xl">Biometric Punch Simulator</h1>
              <p className="mt-1 max-w-xl text-sm text-slate-300">
                Tap <strong>Check in</strong> when arriving and <strong>Check out</strong> when leaving — one punch per
                tap, like a real device. Device: <code className="rounded bg-white/10 px-1">{DEVICE_ID}</code>
              </p>
            </div>
          </div>
          <div className="text-right">
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">Your PC time (used for punch)</p>
            <p className="font-mono text-3xl font-bold tabular-nums text-white">{clock}</p>
            <p className="text-xs text-slate-400">{formatToday()}</p>
          </div>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-5">
        <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm lg:col-span-2">
          <h2 className="flex items-center gap-2 text-sm font-bold text-slate-800">
            <User className="h-4 w-4 text-indigo-600" /> 1. Identify employee
          </h2>
          <div className="flex gap-2">
            <input
              type="text"
              placeholder="Scan / type employee ID (e.g. EMP0001)"
              value={scanCode}
              onChange={(e) => setScanCode(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && lookupByScan()}
              className="flex-1 rounded-lg border border-slate-200 px-3 py-2 text-sm uppercase"
            />
            <button
              type="button"
              onClick={lookupByScan}
              className="rounded-lg bg-indigo-600 px-3 py-2 text-sm font-bold text-white hover:bg-indigo-700"
            >
              OK
            </button>
          </div>
          <div className="relative">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
            <input
              type="search"
              placeholder="Search name…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full rounded-lg border border-slate-200 py-2 pl-9 pr-3 text-sm"
            />
          </div>
          <div className="max-h-48 overflow-y-auto rounded-lg border border-slate-100">
            {employeesLoading ? (
              <p className="p-3 text-xs text-slate-500">Loading…</p>
            ) : (
              filteredEmployees.map((emp) => (
                <button
                  key={emp.id}
                  type="button"
                  onClick={() => selectEmployee(emp)}
                  className={[
                    'flex w-full flex-col border-b border-slate-50 px-3 py-2 text-left text-sm last:border-0 hover:bg-indigo-50',
                    selectedEmployee?.id === emp.id ? 'bg-indigo-50 ring-1 ring-inset ring-indigo-200' : '',
                  ].join(' ')}
                >
                  <span className="font-semibold text-slate-900">{emp.name}</span>
                  <span className="text-xs text-slate-500">{emp.employee_id}</span>
                </button>
              ))
            )}
          </div>
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm lg:col-span-3">
          <h2 className="mb-4 flex items-center gap-2 text-sm font-bold text-slate-800">
            <Clock className="h-4 w-4 text-indigo-600" /> 2. Punch {useCustomPunchTime ? '(custom time)' : '(live device time)'}
          </h2>

          {!selectedEmployee ? (
            <p className="rounded-lg border border-dashed border-slate-200 bg-slate-50 px-4 py-12 text-center text-sm text-slate-500">
              Select or scan an employee to enable the punch buttons.
            </p>
          ) : (
            <>
              <div className="mb-4 rounded-lg bg-slate-50 px-4 py-3">
                <p className="text-lg font-bold text-slate-900">{selectedEmployee.name}</p>
                <p className="text-sm text-slate-600">
                  {selectedEmployee.employee_id}
                  {consoleState?.shift_name ? ` · ${consoleState.shift_name}` : ''}
                </p>
                {consoleLoading ? (
                  <p className="mt-2 text-xs text-slate-500">Updating…</p>
                ) : daily ? (
                  <p className="mt-2">
                    <span
                      className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ${existingStatusClass(daily.attendance_status)}`}
                    >
                      Today: {statusLabel(daily.attendance_status)}
                    </span>
                    {daily.total_work_hours && (
                      <span className="ml-2 text-xs text-slate-600">{daily.total_work_hours} hrs</span>
                    )}
                  </p>
                ) : (
                  <p className="mt-2 text-xs text-slate-500">No attendance calculated yet today.</p>
                )}
                {!consoleLoading && consoleState && (
                  <p className="mt-2 text-xs font-medium text-indigo-700">
                    Suggested next tap: <strong>{consoleState.suggested_next_punch_type === 'IN' ? 'Check in' : 'Check out'}</strong>
                  </p>
                )}
              </div>

              <div className="mb-4 rounded-lg border border-slate-200 bg-white p-3">
                <label className="flex items-center gap-2 text-sm text-slate-700">
                  <input
                    type="checkbox"
                    checked={useCustomPunchTime}
                    onChange={(e) => {
                      const on = e.target.checked;
                      setUseCustomPunchTime(on);
                      if (on && !customPunchTime) setCustomPunchTime(nowDatetimeLocalForAttendance());
                    }}
                  />
                  Use custom punch time (HR override)
                </label>
                {useCustomPunchTime && (
                  <input
                    type="datetime-local"
                    className="mt-2 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                    value={customPunchTime}
                    onChange={(e) => setCustomPunchTime(e.target.value)}
                  />
                )}
                <p className="mt-1 text-[11px] text-slate-500">
                  {useCustomPunchTime
                    ? 'Override time is saved as hospital time (Asia/Kolkata).'
                    : `Check in/out uses the device clock above (${formatBrowserClock()}) — same as your PC time.`}
                </p>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <button
                  type="button"
                  disabled={punching || consoleLoading || !consoleState?.can_punch}
                  onClick={() => recordPunch('IN')}
                  className="flex min-h-[120px] flex-col items-center justify-center gap-2 rounded-2xl bg-emerald-600 text-white shadow-lg transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {punching === 'IN' ? (
                    <Loader2 className="h-10 w-10 animate-spin" />
                  ) : (
                    <LogIn className="h-10 w-10" />
                  )}
                  <span className="text-lg font-bold">Check in</span>
                  <span className="text-xs opacity-90">IN punch</span>
                </button>
                <button
                  type="button"
                  disabled={punching || consoleLoading || !consoleState?.can_punch}
                  onClick={() => recordPunch('OUT')}
                  className="flex min-h-[120px] flex-col items-center justify-center gap-2 rounded-2xl bg-orange-600 text-white shadow-lg transition hover:bg-orange-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {punching === 'OUT' ? (
                    <Loader2 className="h-10 w-10 animate-spin" />
                  ) : (
                    <LogOut className="h-10 w-10" />
                  )}
                  <span className="text-lg font-bold">Check out</span>
                  <span className="text-xs opacity-90">OUT punch</span>
                </button>
              </div>

              <div className="mt-4">
                <div className="mb-2 flex items-center justify-between">
                  <h3 className="text-xs font-bold uppercase tracking-wide text-slate-500">Today&apos;s punches</h3>
                  <button
                    type="button"
                    onClick={() => loadConsole(selectedEmployee)}
                    className="inline-flex items-center gap-1 text-xs font-semibold text-indigo-600 hover:text-indigo-800"
                  >
                    <RefreshCw className={`h-3 w-3 ${consoleLoading ? 'animate-spin' : ''}`} /> Refresh
                  </button>
                </div>
                {consoleState?.today_punches?.length ? (
                  <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
                    {consoleState.today_punches.map((p) => (
                      <li key={p.id} className="flex items-center justify-between px-3 py-2 text-sm">
                        <span className="flex items-center gap-2 font-medium text-slate-800">
                          {p.punch_type === 'IN' ? (
                            <ArrowDownToLine className="h-4 w-4 text-emerald-600" />
                          ) : (
                            <ArrowUpFromLine className="h-4 w-4 text-orange-600" />
                          )}
                          {p.punch_type}
                        </span>
                        <span className="font-mono text-slate-600">
                          {formatPunchTime(p.timestamp)}
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="rounded-lg border border-dashed border-slate-200 py-6 text-center text-xs text-slate-500">
                    No punches yet — tap Check in to start.
                  </p>
                )}
              </div>
            </>
          )}
        </section>
      </div>

      <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
        <p className="font-semibold text-slate-900">How to test</p>
        <ol className="mt-2 list-decimal space-y-1 pl-5 text-xs sm:text-sm">
          <li>
            <strong>Quick month test:</strong> use <strong>Generate full month attendance</strong> below — fills the
            month from each employee&apos;s joining date (best for payroll testing).
          </li>
          <li>
            <strong>Day-by-day:</strong> scan employee ID → Check in → Check out (like a real biometric device).
          </li>
          <li>
            Verify on <strong>Attendance dashboard</strong>, then run payroll on <strong>Payroll Runs</strong> (attendance closes automatically).
          </li>
        </ol>
      </div>

      <details
        className="rounded-xl border border-indigo-200 bg-white shadow-sm"
        open={showMonthGenerator}
        onToggle={(e) => setShowMonthGenerator(e.target.open)}
      >
        <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-4 py-3 text-sm font-semibold text-indigo-900">
          <span className="flex items-center gap-2">
            <ChevronDown className={`h-4 w-4 transition ${showMonthGenerator ? 'rotate-180' : ''}`} />
            <FlaskConical className="h-4 w-4 text-indigo-600" />
            Generate full month attendance (payroll testing)
          </span>
        </summary>
        <div className="border-t border-indigo-100 p-4">
          <MonthAttendanceGeneratorPanel
            compact
            preselectedEmployeeId={selectedEmployee?.id ?? null}
            externalEmployees={employees}
            employeesLoading={employeesLoading}
          />
        </div>
      </details>

      <details
        className="rounded-xl border border-slate-200 bg-white shadow-sm"
        open={showBulk}
        onToggle={(e) => setShowBulk(e.target.open)}
      >
        <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-4 py-3 text-sm font-semibold text-slate-700">
          <span className="flex items-center gap-2">
            <ChevronDown className={`h-4 w-4 transition ${showBulk ? 'rotate-180' : ''}`} />
            Edit day attendance (change punch in / punch out)
          </span>
        </summary>
        <div className="border-t border-slate-100 p-4 space-y-3">
          <p className="text-xs text-slate-600">
            Pick a date, adjust status and check-in/out times, then save. Existing punches for that day are replaced
            and daily attendance is recalculated (present, late, absent, overtime).
          </p>
          <label className="flex items-center gap-2 text-sm">
            <Calendar className="h-4 w-4" />
            Working date
            <input
              type="date"
              value={selectedDate}
              max={formatToday()}
              onChange={(e) => setSelectedDate(e.target.value)}
              className="rounded border border-slate-200 px-2 py-1"
            />
          </label>
          {isFutureDate(selectedDate) && (
            <p className="flex items-center gap-2 text-xs text-amber-800">
              <AlertTriangle className="h-4 w-4" /> Future dates disabled.
            </p>
          )}
          {isWeekendDate(selectedDate) && !isFutureDate(selectedDate) && (
            <p className="text-xs text-amber-800">Weekend — override only if needed.</p>
          )}
          {bulkLoading ? (
            <TableSkeleton rows={5} cols={4} />
          ) : (
            <div className="max-h-64 overflow-auto">
              <table className="min-w-full text-xs">
                <thead>
                  <tr className="bg-slate-50 text-left">
                    <th className="px-2 py-1">Employee</th>
                    <th className="px-2 py-1">Mark</th>
                    <th className="px-2 py-1">In</th>
                    <th className="px-2 py-1">Out</th>
                  </tr>
                </thead>
                <tbody>
                  {bulkRows.slice(0, 20).map((row) => (
                    <tr key={row.key} className={`border-t ${row.locked ? 'opacity-60' : ''}`}>
                      <td className="px-2 py-1">
                        <div>{row.employee.name}</div>
                        {row.existingStatus && (
                          <span className={`mt-0.5 inline-flex rounded px-1.5 py-0.5 text-[10px] font-semibold ring-1 ${existingStatusClass(row.existingStatus)}`}>
                            {statusLabel(row.existingStatus)}
                          </span>
                        )}
                      </td>
                      <td className="px-2 py-1">
                        <select
                          value={row.markStatus}
                          disabled={row.locked}
                          onChange={(e) => updateBulkRow(row.key, { markStatus: e.target.value })}
                          className="w-full rounded border px-1 py-0.5"
                        >
                          {MARK_STATUSES.map((o) => (
                            <option key={o.value || 'e'} value={o.value}>{o.label}</option>
                          ))}
                        </select>
                      </td>
                      <td className="px-2 py-1">
                        <input
                          type="time"
                          value={row.checkIn}
                          disabled={row.locked || !PUNCH_STATUSES.has(row.markStatus)}
                          onChange={(e) => updateBulkRow(row.key, { checkIn: e.target.value })}
                          className="w-full rounded border px-1"
                        />
                      </td>
                      <td className="px-2 py-1">
                        <input
                          type="time"
                          value={row.checkOut}
                          disabled={row.locked || !PUNCH_STATUSES.has(row.markStatus)}
                          onChange={(e) => updateBulkRow(row.key, { checkOut: e.target.value })}
                          className="w-full rounded border px-1"
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <button
            type="button"
            onClick={handleBulkSave}
            disabled={bulkSaving || bulkLoading || isFutureDate(selectedDate)}
            className="inline-flex items-center gap-2 rounded-lg bg-slate-800 px-4 py-2 text-sm font-bold text-white disabled:opacity-50"
          >
            {bulkSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            Bulk save
          </button>
        </div>
      </details>
    </div>
  );
}
