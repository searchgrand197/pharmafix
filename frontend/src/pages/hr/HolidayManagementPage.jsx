import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import api, { getHospitalId } from '../../api';
import toast from 'react-hot-toast';
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Edit2,
  List,
  Plus,
  Power,
  RefreshCw,
  Save,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';
import { normalizeApiList } from '../../hr/recruitmentLifecycle';
import SetupWizardNav from '../../components/HR/SetupWizardNav';
import { daysInMonth } from '../../utils/attendanceCalendar';

const HOLIDAY_TYPES = [
  { value: 'national', label: 'National Holiday' },
  { value: 'festival', label: 'Festival Holiday' },
  { value: 'organization', label: 'Organization Holiday' },
];

const TYPE_STYLES = {
  national: 'bg-blue-100 text-blue-900',
  festival: 'bg-amber-100 text-amber-900',
  organization: 'bg-violet-100 text-violet-900',
};

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function blankForm(overrides = {}) {
  return {
    scope: 'organization',
    hospital: '',
    name: '',
    date: '',
    description: '',
    active: true,
    is_paid_day: true,
    ...overrides,
  };
}

function errorText(error, fallback) {
  const data = error?.response?.data;
  if (!data) return fallback;
  if (typeof data === 'string') return data;
  const messages = [];
  const collect = (value, prefix = '') => {
    if (!value) return;
    if (typeof value === 'string') {
      messages.push(prefix ? `${prefix}: ${value}` : value);
      return;
    }
    if (Array.isArray(value)) {
      value.forEach((item) => collect(item, prefix));
      return;
    }
    if (typeof value === 'object') {
      Object.entries(value).forEach(([key, item]) => collect(item, key));
    }
  };
  collect(data.detail || data.error || data);
  return messages.length ? messages.join(' · ') : fallback;
}

function formatDate(iso) {
  if (!iso) return '--';
  return new Date(`${iso}T12:00:00`).toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function isFutureDate(iso) {
  if (!iso) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const dt = new Date(`${iso}T12:00:00`);
  return dt >= today;
}

function scopeLabel(scope) {
  return HOLIDAY_TYPES.find((item) => item.value === scope)?.label || scope;
}

function currentIndiaFyLabel(d = new Date()) {
  const year = d.getFullYear();
  const startYear = d.getMonth() >= 3 ? year : year - 1;
  return `${startYear}-${String((startYear + 1) % 100).padStart(2, '0')}`;
}

function shiftFyLabel(fy, delta) {
  const startYear = Number(String(fy).slice(0, 4)) + delta;
  return `${startYear}-${String((startYear + 1) % 100).padStart(2, '0')}`;
}

function fyBounds(fy) {
  const startYear = Number(String(fy).slice(0, 4));
  return {
    startYear,
    start: `${startYear}-04-01`,
    end: `${startYear + 1}-03-31`,
  };
}

function fyMonthKeys(fy) {
  const { startYear } = fyBounds(fy);
  const months = [];
  for (let m = 4; m <= 12; m += 1) {
    months.push(`${startYear}-${String(m).padStart(2, '0')}`);
  }
  for (let m = 1; m <= 3; m += 1) {
    months.push(`${startYear + 1}-${String(m).padStart(2, '0')}`);
  }
  return months;
}

function fyDisplayLabel(fy) {
  const { startYear } = fyBounds(fy);
  return `Apr ${startYear} – Mar ${startYear + 1}`;
}

function monthDisplayLabel(monthKey) {
  const [y, m] = monthKey.split('-').map(Number);
  return new Date(y, m - 1).toLocaleString('default', { month: 'long', year: 'numeric' });
}

function formatConflictLabel(holiday) {
  return `"${holiday.name}" (${holiday.scope_display || scopeLabel(holiday.scope)})`;
}

function SavedHolidayRow({ row, onEdit, onToggle, onRemove, compact = false }) {
  return (
    <article className={`rounded-xl border border-slate-200 ${compact ? 'p-2.5' : 'p-3'}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-semibold text-slate-900">{row.name}</p>
          {!compact ? (
            <p className="mt-0.5 text-sm text-slate-600">{formatDate(row.date)}</p>
          ) : null}
          <div className="mt-1 flex flex-wrap gap-2">
            <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${TYPE_STYLES[row.scope] || TYPE_STYLES.organization}`}>
              {row.scope_display || scopeLabel(row.scope)}
            </span>
            <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${row.active ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-600'}`}>
              {row.active ? 'Active' : 'Inactive'}
            </span>
          </div>
          {row.description ? <p className="mt-2 text-sm text-slate-500">{row.description}</p> : null}
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => onEdit(row)} className="inline-flex min-h-[36px] items-center gap-1 rounded-lg border border-slate-200 px-2.5 text-xs font-semibold">
            <Edit2 size={14} /> Edit
          </button>
          <button type="button" onClick={() => onToggle(row)} className="inline-flex min-h-[36px] items-center gap-1 rounded-lg border border-slate-200 px-2.5 text-xs font-semibold">
            <Power size={14} /> {row.active ? 'Deactivate' : 'Activate'}
          </button>
          {isFutureDate(row.date) ? (
            <button type="button" onClick={() => onRemove(row)} className="inline-flex min-h-[36px] items-center gap-1 rounded-lg border border-red-200 px-2.5 text-xs font-semibold text-red-700">
              <Trash2 size={14} /> Delete
            </button>
          ) : null}
        </div>
      </div>
    </article>
  );
}

function CompactHolidayForm({
  editingId,
  form,
  setForm,
  formSourceHint,
  alreadyCreated,
  needsHospitalSelection,
  hospitals,
  saving,
  onSave,
  onClose,
  onBack,
}) {
  return (
    <form onSubmit={onSave} className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="font-semibold text-slate-900">
          {editingId ? 'Edit Holiday' : 'Create Holiday'}
        </h3>
        <button type="button" onClick={onClose} className="rounded-lg p-1.5 hover:bg-slate-100" aria-label="Close">
          <X size={16} />
        </button>
      </div>
      {formSourceHint ? (
        <p className="text-xs font-medium text-teal-800">{formSourceHint}</p>
      ) : null}
      {!editingId && alreadyCreated ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-950">
          A holiday is already created on this date. Saving will create another if you confirm.
        </div>
      ) : null}
      <div className="grid grid-cols-1 gap-3">
        <label className="block text-sm">
          <span className="font-medium text-slate-700">Holiday Type</span>
          <select
            className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
            value={form.scope}
            onChange={(e) => setForm((f) => ({ ...f, scope: e.target.value }))}
          >
            {HOLIDAY_TYPES.map((item) => (
              <option key={item.value} value={item.value}>{item.label}</option>
            ))}
          </select>
        </label>
        <label className="block text-sm">
          <span className="font-medium text-slate-700">Date</span>
          <input
            type="date"
            required
            className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
            value={form.date}
            onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))}
          />
        </label>
        {needsHospitalSelection && form.scope !== 'national' ? (
          <label className="block text-sm">
            <span className="font-medium text-slate-700">
              Hospital {form.scope === 'organization' ? '' : '(optional)'}
            </span>
            <select
              className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
              value={form.hospital}
              onChange={(e) => setForm((f) => ({ ...f, hospital: e.target.value }))}
              required={form.scope === 'organization'}
            >
              <option value="">
                {form.scope === 'organization' ? 'Select hospital' : 'Global festival holiday'}
              </option>
              {hospitals.map((hospital) => (
                <option key={hospital.id} value={hospital.id}>{hospital.name}</option>
              ))}
            </select>
          </label>
        ) : null}
        <label className="block text-sm">
          <span className="font-medium text-slate-700">Name</span>
          <input
            type="text"
            required
            maxLength={255}
            className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
          />
        </label>
        <label className="block text-sm">
          <span className="font-medium text-slate-700">Description</span>
          <textarea
            rows={2}
            className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
            value={form.description}
            onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
          />
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={form.active}
            onChange={(e) => setForm((f) => ({ ...f, active: e.target.checked }))}
          />
          <span className="font-medium text-slate-700">Is Active</span>
        </label>
        <p className="text-xs text-slate-500">Paid day: always on</p>
      </div>
      <div className="flex flex-wrap gap-2 pt-1">
        <button
          type="submit"
          disabled={saving}
          className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg bg-teal-600 px-3.5 text-sm font-semibold text-white disabled:opacity-60"
        >
          <Save size={14} /> {saving ? 'Saving…' : editingId ? 'Update' : 'Create'}
        </button>
        <button
          type="button"
          onClick={onBack || onClose}
          className="min-h-[40px] rounded-lg border border-slate-200 bg-white px-3.5 text-sm font-semibold text-slate-700"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

export default function HolidayManagementPage() {
  const storedHospitalId = useMemo(() => getHospitalId(), []);
  const needsHospitalSelection = !storedHospitalId;
  const hoverCloseTimer = useRef(null);
  const hoverOpenTimer = useRef(null);

  const [fy, setFy] = useState(() => currentIndiaFyLabel());
  const monthKeys = useMemo(() => fyMonthKeys(fy), [fy]);
  const [monthKey, setMonthKey] = useState(() => {
    const now = new Date();
    const label = currentIndiaFyLabel(now);
    const keys = fyMonthKeys(label);
    const current = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    return keys.includes(current) ? current : keys[0];
  });

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [daysPayload, setDaysPayload] = useState([]);
  const [sourceError, setSourceError] = useState(null);
  const [fyMeta, setFyMeta] = useState({ start: '', end: '' });
  const [hospitals, setHospitals] = useState([]);
  const [showAllHolidays, setShowAllHolidays] = useState(false);

  const [hoveredIso, setHoveredIso] = useState(null);
  const [popoverIso, setPopoverIso] = useState(null);
  const [popoverMode, setPopoverMode] = useState('view'); // 'view' | 'create'
  const [form, setForm] = useState(() => blankForm());
  const [editingId, setEditingId] = useState(null);
  const [formSourceHint, setFormSourceHint] = useState('');
  const [tickedSuggestionKey, setTickedSuggestionKey] = useState(null);
  const popoverModeRef = useRef(popoverMode);

  useEffect(() => {
    popoverModeRef.current = popoverMode;
  }, [popoverMode]);

  const daysByDate = useMemo(() => {
    const map = {};
    daysPayload.forEach((row) => {
      map[row.date] = row;
    });
    return map;
  }, [daysPayload]);

  const popoverDay = popoverIso ? daysByDate[popoverIso] : null;

  const allSavedHolidays = useMemo(
    () => daysPayload
      .flatMap((d) => d.existing || [])
      .sort((a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name)),
    [daysPayload],
  );

  const [year, mon] = useMemo(() => monthKey.split('-').map(Number), [monthKey]);

  const calendarCells = useMemo(() => {
    const total = daysInMonth(year, mon);
    const firstWeekday = new Date(year, mon - 1, 1).getDay();
    const cells = [];
    for (let i = 0; i < firstWeekday; i += 1) cells.push(null);
    for (let d = 1; d <= total; d += 1) {
      const iso = `${year}-${String(mon).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      cells.push({
        iso,
        day: d,
        info: daysByDate[iso] || null,
      });
    }
    return cells;
  }, [daysByDate, mon, year]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get('/hr/organization-holidays/suggestions/', { params: { fy } });
      setDaysPayload(Array.isArray(data?.days) ? data.days : []);
      setSourceError(data?.source_error || null);
      setFyMeta({ start: data?.start || '', end: data?.end || '' });
      if (data?.fy && data.fy !== fy) setFy(data.fy);
    } catch (error) {
      toast.error(errorText(error, 'Failed to load holiday calendar'));
      setDaysPayload([]);
      setSourceError(null);
    } finally {
      setLoading(false);
    }
  }, [fy]);

  useEffect(() => {
    document.title = 'Holiday Management | HR';
    load();
  }, [load]);

  useEffect(() => {
    if (!monthKeys.includes(monthKey)) {
      setMonthKey(monthKeys[0]);
      closePopover();
    }
  }, [monthKey, monthKeys]);

  useEffect(() => {
    if (!needsHospitalSelection) return undefined;
    api.get('/hr/hospitals/', { params: { limit: 100 } })
      .then((res) => setHospitals(normalizeApiList(res.data)))
      .catch(() => setHospitals([]));
    return undefined;
  }, [needsHospitalSelection]);

  useEffect(() => () => {
    if (hoverCloseTimer.current) window.clearTimeout(hoverCloseTimer.current);
    if (hoverOpenTimer.current) window.clearTimeout(hoverOpenTimer.current);
  }, []);

  function clearHoverCloseTimer() {
    if (hoverCloseTimer.current) {
      window.clearTimeout(hoverCloseTimer.current);
      hoverCloseTimer.current = null;
    }
  }

  function clearHoverOpenTimer() {
    if (hoverOpenTimer.current) {
      window.clearTimeout(hoverOpenTimer.current);
      hoverOpenTimer.current = null;
    }
  }

  function clearHoverTimers() {
    clearHoverCloseTimer();
    clearHoverOpenTimer();
  }

  function closePopover() {
    clearHoverTimers();
    setPopoverIso(null);
    setHoveredIso(null);
    setPopoverMode('view');
    setEditingId(null);
    setForm(blankForm());
    setFormSourceHint('');
    setTickedSuggestionKey(null);
  }

  function openDayPopover(iso, { mode = 'view' } = {}) {
    clearHoverTimers();
    setPopoverIso(iso);
    setHoveredIso(iso);
    setPopoverMode(mode);
    setTickedSuggestionKey(null);
    if (mode === 'view') {
      setEditingId(null);
      setForm(blankForm({ date: iso }));
      setFormSourceHint('');
    }
  }

  function openCreateForm({ iso = '', suggestion = null, editRow = null } = {}) {
    clearHoverTimers();
    if (editRow) {
      setPopoverIso(editRow.date);
      setHoveredIso(editRow.date);
      setEditingId(editRow.id);
      setFormSourceHint('');
      setForm({
        scope: editRow.scope,
        hospital: editRow.hospital || '',
        name: editRow.name,
        date: editRow.date,
        description: editRow.description || '',
        active: editRow.active,
        is_paid_day: true,
      });
      setPopoverMode('create');
      setTickedSuggestionKey(null);
      return;
    }

    const dateIso = iso || '';
    setPopoverIso(dateIso || null);
    setHoveredIso(dateIso || null);
    setEditingId(null);
    if (suggestion) {
      const types = Array.isArray(suggestion.types) ? suggestion.types.join(', ') : '';
      setFormSourceHint(types ? `Suggestion · ${types}` : 'Holiday suggestion');
      setForm(blankForm({
        name: suggestion.name || suggestion.local_name || '',
        date: dateIso,
        description: suggestion.local_name && suggestion.local_name !== suggestion.name
          ? suggestion.local_name
          : '',
        scope: 'organization',
        is_paid_day: true,
      }));
      setTickedSuggestionKey(`${dateIso}::${suggestion.name}`);
    } else {
      setFormSourceHint('');
      setForm(blankForm({ date: dateIso }));
      setTickedSuggestionKey(null);
    }
    setPopoverMode('create');
  }

  function schedulePopoverClose() {
    clearHoverTimers();
    hoverCloseTimer.current = window.setTimeout(() => {
      if (popoverModeRef.current === 'create') return;
      setPopoverIso(null);
      setHoveredIso(null);
      setPopoverMode('view');
    }, 220);
  }

  function handleDayEnter(iso, hasContent) {
    if (!hasContent) return;
    if (popoverModeRef.current === 'create') return;
    clearHoverTimers();
    // Grow first, then open the overlay so the scale-up is visible.
    setHoveredIso(iso);
    hoverOpenTimer.current = window.setTimeout(() => {
      if (popoverModeRef.current === 'create') return;
      setPopoverIso(iso);
      setPopoverMode('view');
      setTickedSuggestionKey(null);
      setEditingId(null);
      setForm(blankForm({ date: iso }));
      setFormSourceHint('');
    }, 380);
  }

  function handleDayLeave() {
    if (popoverModeRef.current === 'create') return;
    clearHoverOpenTimer();
    // Overlay not open yet — just shrink back.
    if (!popoverIso) {
      setHoveredIso(null);
      return;
    }
    schedulePopoverClose();
  }

  function handleDayClick(iso, hasContent) {
    if (hasContent) {
      openDayPopover(iso, { mode: 'view' });
      return;
    }
    openCreateForm({ iso });
  }

  function handleSuggestionTick(suggestion, iso, checked) {
    const key = `${iso}::${suggestion.name}`;
    if (!checked) {
      setTickedSuggestionKey(null);
      if (popoverMode === 'create' && !editingId) {
        setPopoverMode('view');
        setForm(blankForm({ date: iso }));
        setFormSourceHint('');
      }
      return;
    }
    setTickedSuggestionKey(key);
    openCreateForm({ iso, suggestion });
  }

  async function handleSave(e) {
    e.preventDefault();
    if (!form.name.trim() || !form.date) {
      toast.error('Name and date are required');
      return;
    }
    const effectiveHospitalId = form.hospital || storedHospitalId;
    if (form.scope === 'organization' && !effectiveHospitalId) {
      toast.error('Select a hospital before creating an organization holiday.');
      return;
    }

    const dayInfo = daysByDate[form.date];
    const conflicts = (dayInfo?.existing || []).filter((row) => row.id !== editingId);
    if (!editingId && conflicts.length > 0) {
      const labels = conflicts.map(formatConflictLabel).join(', ');
      const proceed = window.confirm(
        `${formatDate(form.date)} already has ${labels}.\n\nCreate another holiday on this date anyway?`,
      );
      if (!proceed) return;
    }

    setSaving(true);
    try {
      const payload = {
        scope: form.scope,
        name: form.name.trim(),
        date: form.date,
        description: form.description.trim(),
        active: form.active,
        is_paid_day: true,
      };
      if (form.scope !== 'national' && form.hospital) {
        payload.hospital = form.hospital;
      } else if (form.scope === 'organization' && storedHospitalId) {
        payload.hospital = storedHospitalId;
      }
      if (editingId) {
        await api.patch(`/hr/organization-holidays/${editingId}/`, payload);
        toast.success('Holiday updated');
      } else {
        await api.post('/hr/organization-holidays/', payload);
        toast.success('Holiday created');
      }
      closePopover();
      await load();
    } catch (error) {
      toast.error(errorText(error, 'Failed to save holiday'));
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive(row) {
    try {
      await api.post(`/hr/organization-holidays/${row.id}/toggle-active/`);
      toast.success(row.active ? 'Holiday deactivated' : 'Holiday activated');
      await load();
    } catch (error) {
      toast.error(errorText(error, 'Failed to update holiday status'));
    }
  }

  async function remove(row) {
    if (!isFutureDate(row.date)) {
      toast.error('Only future holidays can be deleted. Deactivate past holidays instead.');
      return;
    }
    if (!window.confirm(`Delete "${row.name}" on ${formatDate(row.date)}?`)) return;
    try {
      await api.delete(`/hr/organization-holidays/${row.id}/`);
      toast.success('Holiday deleted');
      await load();
      if (popoverIso === row.date) {
        // Stay on day view if other content remains after reload
        setPopoverMode('view');
        setEditingId(null);
        setTickedSuggestionKey(null);
      }
    } catch (error) {
      toast.error(errorText(error, 'Failed to delete holiday'));
    }
  }

  function shiftFy(delta) {
    const next = shiftFyLabel(fy, delta);
    setFy(next);
    setMonthKey(fyMonthKeys(next)[0]);
    closePopover();
  }

  function shiftMonth(delta) {
    const idx = monthKeys.indexOf(monthKey);
    const nextIdx = idx + delta;
    if (nextIdx < 0 || nextIdx >= monthKeys.length) return;
    setMonthKey(monthKeys[nextIdx]);
    closePopover();
  }

  const monthIndex = monthKeys.indexOf(monthKey);
  const todayIso = new Date().toISOString().slice(0, 10);
  const showPopover = Boolean(popoverIso) || popoverMode === 'create';

  return (
    <div className="mx-auto max-w-7xl space-y-6 overflow-x-hidden">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Attendance Management</p>
          <h1 className="text-2xl font-bold text-slate-900">Holiday Management</h1>
          <p className="text-sm text-slate-600">
            Hover or tap a marked day to preview suggestions and create holidays without scrolling.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={load}
            className="inline-flex min-h-[44px] items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 shadow-sm hover:bg-slate-50"
          >
            <RefreshCw size={16} /> Refresh
          </button>
          <button
            type="button"
            onClick={() => setShowAllHolidays((v) => !v)}
            className="inline-flex min-h-[44px] items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 shadow-sm hover:bg-slate-50"
          >
            <List size={16} /> {showAllHolidays ? 'Hide all holidays' : 'View all holidays'}
          </button>
          <button
            type="button"
            onClick={() => openCreateForm({ iso: '' })}
            className="inline-flex min-h-[44px] items-center gap-2 rounded-xl bg-teal-600 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-700"
          >
            <Plus size={16} /> Create Custom Holiday
          </button>
        </div>
      </div>

      <div className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center justify-between gap-2 rounded-xl border border-slate-200 px-3 py-2 sm:w-auto">
          <button type="button" onClick={() => shiftFy(-1)} className="rounded-lg p-2 hover:bg-slate-50" aria-label="Previous financial year">
            <ChevronLeft size={16} />
          </button>
          <div className="px-2 text-center">
            <p className="text-sm font-semibold text-slate-900">{fyDisplayLabel(fy)}</p>
            <p className="text-[11px] text-slate-500">FY {fy}{fyMeta.start ? ` · ${fyMeta.start} → ${fyMeta.end}` : ''}</p>
          </div>
          <button type="button" onClick={() => shiftFy(1)} className="rounded-lg p-2 hover:bg-slate-50" aria-label="Next financial year">
            <ChevronRight size={16} />
          </button>
        </div>
        <div className="flex min-w-0 items-center justify-between gap-2 rounded-xl border border-slate-200 px-3 py-2 sm:w-auto">
          <button
            type="button"
            onClick={() => shiftMonth(-1)}
            disabled={monthIndex <= 0}
            className="rounded-lg p-2 hover:bg-slate-50 disabled:opacity-40"
            aria-label="Previous month"
          >
            ‹
          </button>
          <span className="truncate px-2 text-sm font-semibold text-slate-900">{monthDisplayLabel(monthKey)}</span>
          <button
            type="button"
            onClick={() => shiftMonth(1)}
            disabled={monthIndex >= monthKeys.length - 1}
            className="rounded-lg p-2 hover:bg-slate-50 disabled:opacity-40"
            aria-label="Next month"
          >
            ›
          </button>
        </div>
      </div>

      {sourceError ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
          {sourceError}
        </div>
      ) : null}

      <div className="flex flex-wrap gap-3 text-xs text-slate-600">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-sky-500" /> Suggestion
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-emerald-500" /> Saved holiday
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-violet-500" /> Both
        </span>
        <span className="text-slate-400">Hover/tap a marked day — details expand over the calendar</span>
      </div>

      <div className="mx-auto w-full max-w-md sm:mx-0 sm:max-w-lg">
        <section
          className={[
            'relative min-h-[17rem] rounded-2xl border border-slate-200 bg-white p-3 shadow-sm sm:min-h-[18rem] sm:p-3.5',
            showPopover ? 'overflow-hidden' : 'overflow-visible',
          ].join(' ')}
          onMouseEnter={() => {
            if (showPopover) clearHoverCloseTimer();
          }}
          onMouseLeave={() => {
            if (showPopover || hoveredIso) handleDayLeave();
          }}
        >
          {loading ? (
            <div className="h-48 animate-pulse rounded-xl bg-slate-100" />
          ) : (
            <>
              <div className="grid grid-cols-7 gap-1 text-center text-[10px] font-semibold uppercase text-slate-400">
                {WEEKDAYS.map((label) => (
                  <div key={label} className="py-0.5">{label}</div>
                ))}
              </div>
              <div className="mt-1 grid grid-cols-7 gap-1">
                {calendarCells.map((cell, idx) => {
                  if (!cell) return <div key={`empty-${idx}`} className="h-9 sm:h-10" />;
                  const hasSuggestion = Boolean(cell.info?.suggestions?.length);
                  const hasExisting = Boolean(cell.info?.existing?.length);
                  const hasContent = hasSuggestion || hasExisting;
                  const isToday = cell.iso === todayIso;
                  const isActive = !showPopover && (popoverIso === cell.iso || hoveredIso === cell.iso);
                  let tone = 'border-slate-100 bg-white text-slate-700';
                  if (hasSuggestion && hasExisting) tone = 'border-violet-300 bg-violet-50 text-violet-950';
                  else if (hasExisting) tone = 'border-emerald-300 bg-emerald-50 text-emerald-950';
                  else if (hasSuggestion) tone = 'border-sky-300 bg-sky-50 text-sky-950';
                  return (
                    <button
                      key={cell.iso}
                      type="button"
                      onMouseEnter={() => handleDayEnter(cell.iso, hasContent)}
                      onMouseLeave={() => {
                        if (popoverModeRef.current === 'create' || showPopover) return;
                        clearHoverOpenTimer();
                        setHoveredIso((current) => (current === cell.iso ? null : current));
                      }}
                      onFocus={() => handleDayEnter(cell.iso, hasContent)}
                      onClick={() => handleDayClick(cell.iso, hasContent)}
                      className={[
                        'relative flex h-9 origin-center flex-col items-center justify-center rounded-md border text-[11px] font-semibold transition-[transform,box-shadow] duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] will-change-transform sm:h-10 sm:rounded-lg sm:text-xs',
                        tone,
                        isToday ? 'ring-2 ring-teal-500 ring-offset-1' : '',
                        hasContent && !showPopover ? 'hover:z-30 hover:scale-[1.35] hover:shadow-lg hover:shadow-slate-300/60' : '',
                        isActive && hasContent
                          ? 'z-30 scale-[1.35] shadow-lg shadow-slate-300/60 ring-2 ring-indigo-400 ring-offset-1'
                          : '',
                      ].join(' ')}
                      title={
                        hasContent
                          ? [
                            ...(cell.info?.suggestions || []).map((s) => `Suggested: ${s.name}`),
                            ...(cell.info?.existing || []).map((e) => `Saved: ${e.name}`),
                          ].join(' · ')
                          : `Create custom on ${cell.iso}`
                      }
                    >
                      <span>{cell.day}</span>
                      {hasContent ? (
                        <span className="mt-0.5 flex gap-0.5">
                          {hasSuggestion ? <span className="h-1.5 w-1.5 rounded-full bg-sky-500" /> : null}
                          {hasExisting ? <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> : null}
                        </span>
                      ) : null}
                    </button>
                  );
                })}
              </div>
            </>
          )}

          {showPopover ? (
            <div
              className="absolute inset-0 z-30 flex flex-col bg-white/97 p-3 backdrop-blur-[2px] sm:p-3.5"
              role="dialog"
              aria-label="Holiday details"
            >
              <div className="min-h-0 flex-1 overflow-y-auto">
                {popoverMode === 'create' ? (
                  <CompactHolidayForm
                    editingId={editingId}
                    form={form}
                    setForm={setForm}
                    formSourceHint={formSourceHint}
                    alreadyCreated={Boolean(daysByDate[form.date]?.already_created)}
                    needsHospitalSelection={needsHospitalSelection}
                    hospitals={hospitals}
                    saving={saving}
                    onSave={handleSave}
                    onClose={closePopover}
                    onBack={popoverIso && daysByDate[popoverIso]
                      ? () => {
                        setPopoverMode('view');
                        setEditingId(null);
                        setTickedSuggestionKey(null);
                        setForm(blankForm({ date: popoverIso }));
                        setFormSourceHint('');
                      }
                      : closePopover}
                  />
                ) : (
                  <div className="space-y-3">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <h3 className="font-semibold text-slate-900">{formatDate(popoverIso)}</h3>
                        <p className="text-[11px] text-slate-500">Tick a suggestion to create on this calendar.</p>
                      </div>
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => openCreateForm({ iso: popoverIso })}
                          className="inline-flex min-h-[32px] items-center gap-1 rounded-lg border border-slate-200 px-2 text-[11px] font-semibold"
                        >
                          <Plus size={12} /> Custom
                        </button>
                        <button type="button" onClick={closePopover} className="rounded-lg p-1.5 hover:bg-slate-100" aria-label="Close">
                          <X size={16} />
                        </button>
                      </div>
                    </div>

                    {popoverDay?.already_created ? (
                      <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-950">
                        A holiday is already created on this date.
                        {popoverDay.existing?.length
                          ? ` Saved: ${popoverDay.existing.map((h) => h.name).join(', ')}.`
                          : ''}
                      </div>
                    ) : null}

                    {(popoverDay?.suggestions || []).length > 0 ? (
                      <div className="space-y-2">
                        <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Suggestions</p>
                        {popoverDay.suggestions.map((suggestion, idx) => {
                          const key = `${popoverIso}::${suggestion.name}`;
                          const checked = tickedSuggestionKey === key;
                          return (
                            <label
                              key={`${suggestion.name}-${idx}`}
                              className="flex cursor-pointer items-start gap-2.5 rounded-xl border border-sky-200 bg-sky-50/80 p-2.5"
                            >
                              <input
                                type="checkbox"
                                className="mt-1 h-4 w-4 rounded border-slate-300 text-teal-600"
                                checked={checked}
                                onChange={(e) => handleSuggestionTick(suggestion, popoverIso, e.target.checked)}
                              />
                              <div className="min-w-0 flex-1">
                                <p className="text-sm font-semibold text-slate-900">{suggestion.name}</p>
                                {suggestion.local_name && suggestion.local_name !== suggestion.name ? (
                                  <p className="text-xs text-slate-600">{suggestion.local_name}</p>
                                ) : null}
                                <p className="mt-0.5 text-[11px] text-slate-500">
                                  <Sparkles size={11} className="mr-1 inline" />
                                  {(suggestion.types || []).join(', ') || 'Public'}
                                  {' · '}
                                  {suggestion.source === 'nager' ? 'Nager.Date' : 'India holiday list'}
                                </p>
                              </div>
                            </label>
                          );
                        })}
                      </div>
                    ) : (
                      <p className="text-xs text-slate-500">No suggestion for this day.</p>
                    )}

                    {(popoverDay?.existing || []).length > 0 ? (
                      <div className="space-y-2">
                        <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Saved holidays</p>
                        {popoverDay.existing.map((row) => (
                          <SavedHolidayRow
                            key={row.id}
                            row={row}
                            compact
                            onEdit={(r) => openCreateForm({ editRow: r })}
                            onToggle={toggleActive}
                            onRemove={remove}
                          />
                        ))}
                      </div>
                    ) : null}
                  </div>
                )}
              </div>
            </div>
          ) : null}
        </section>
      </div>

      {showAllHolidays ? (
        <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-100 px-4 py-4 sm:px-5">
            <h2 className="font-semibold text-slate-900">All saved holidays — {fyDisplayLabel(fy)}</h2>
            <p className="text-xs text-slate-500">{allSavedHolidays.length} holiday(s) created by HR</p>
          </div>
          {loading ? (
            <div className="h-40 animate-pulse bg-slate-50" />
          ) : allSavedHolidays.length === 0 ? (
            <div className="p-10 text-center text-slate-500">
              <CalendarDays className="mx-auto mb-2 h-10 w-10 text-slate-300" />
              <p className="font-semibold text-slate-800">No saved holidays in this financial year</p>
              <p className="mt-1 text-sm">Adopt suggestions from the calendar or create a custom holiday.</p>
            </div>
          ) : (
            <>
              <div className="space-y-3 p-4 md:hidden">
                {allSavedHolidays.map((row) => (
                  <SavedHolidayRow
                    key={row.id}
                    row={row}
                    onEdit={(r) => openCreateForm({ editRow: r })}
                    onToggle={toggleActive}
                    onRemove={remove}
                  />
                ))}
              </div>
              <div className="hidden overflow-x-auto md:block">
                <table className="min-w-full text-left text-sm">
                  <thead className="border-b border-slate-100 bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-500">
                    <tr>
                      <th className="px-4 py-3">Name</th>
                      <th className="px-4 py-3">Date</th>
                      <th className="px-4 py-3">Type</th>
                      <th className="px-4 py-3">Status</th>
                      <th className="px-4 py-3 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {allSavedHolidays.map((row) => (
                      <tr key={row.id}>
                        <td className="px-4 py-3 font-semibold text-slate-900">{row.name}</td>
                        <td className="whitespace-nowrap px-4 py-3">{formatDate(row.date)}</td>
                        <td className="px-4 py-3">
                          <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${TYPE_STYLES[row.scope] || TYPE_STYLES.organization}`}>
                            {row.scope_display || scopeLabel(row.scope)}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${row.active ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-600'}`}>
                            {row.active ? 'Active' : 'Inactive'}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex justify-end gap-2">
                            <button type="button" onClick={() => openCreateForm({ editRow: row })} className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold hover:bg-slate-50">
                              <Edit2 size={14} /> Edit
                            </button>
                            <button type="button" onClick={() => toggleActive(row)} className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold hover:bg-slate-50">
                              <Power size={14} /> {row.active ? 'Deactivate' : 'Activate'}
                            </button>
                            {isFutureDate(row.date) ? (
                              <button type="button" onClick={() => remove(row)} className="inline-flex items-center gap-1 rounded-lg border border-red-200 px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-50">
                                <Trash2 size={14} /> Delete
                              </button>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </section>
      ) : null}

      <SetupWizardNav className="border-t border-slate-100 pt-4" />
    </div>
  );
}
