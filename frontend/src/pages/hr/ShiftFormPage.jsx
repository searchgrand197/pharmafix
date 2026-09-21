import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import api from '../../api';
import toast from 'react-hot-toast';
import { ArrowLeft, CalendarClock } from 'lucide-react';
import { normalizeApiList } from '../../hr/recruitmentLifecycle';
import {
  computeShiftHours,
  detectOvernight,
  errorText,
  shiftPreviewText,
  suggestShiftCode,
  toApiTime,
} from './shiftUtils';
import { withPreservedReturn } from './setupWizardUtils';
import ShiftTimeField from '../../components/HR/ShiftTimeField';

const blankForm = {
  hospital: '',
  name: '',
  start_time: '',
  end_time: '',
  overtime_allowed: false,
};

export default function ShiftFormPage() {
  const navigate = useNavigate();
  const { shiftId } = useParams();
  const [searchParams] = useSearchParams();
  const isEdit = Boolean(shiftId);
  const shiftsListRoute = withPreservedReturn('/hr/operations/shifts', searchParams);

  const [loading, setLoading] = useState(isEdit);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState(blankForm);
  const [hospitals, setHospitals] = useState([]);
  const [existingShiftCodes, setExistingShiftCodes] = useState([]);
  const [timeFormat, setTimeFormat] = useState('12h');

  const user = useMemo(() => {
    try {
      return JSON.parse(localStorage.getItem('user') || '{}');
    } catch {
      return {};
    }
  }, []);
  const needsHospitalSelection = !user.hospital_id;

  const loadShift = useCallback(async () => {
    if (!shiftId) return;
    setLoading(true);
    try {
      const { data } = await api.get(`/hr/shifts/${shiftId}/`);
      setForm({
        hospital: data.hospital || '',
        name: data.name || '',
        start_time: String(data.start_time || '').slice(0, 5),
        end_time: String(data.end_time || '').slice(0, 5),
        overtime_allowed: Boolean(data.overtime_allowed),
      });
    } catch {
      toast.error('Could not load shift');
      navigate(shiftsListRoute);
    } finally {
      setLoading(false);
    }
  }, [navigate, shiftId, shiftsListRoute]);

  useEffect(() => {
    document.title = isEdit ? 'Edit Shift | HR' : 'Create Shift | HR';
    if (isEdit) loadShift();
    if (needsHospitalSelection) {
      api.get('/hr/hospitals/', { params: { limit: 100 } })
        .then((res) => setHospitals(normalizeApiList(res.data)))
        .catch(() => {});
    }
    api.get('/hr/shifts/', { params: { limit: 500 } })
      .then((res) => {
        const shifts = normalizeApiList(res.data);
        setExistingShiftCodes(
          shifts
            .filter((shift) => !isEdit || String(shift.id) !== String(shiftId))
            .map((shift) => shift.code)
            .filter(Boolean),
        );
      })
      .catch(() => {});
  }, [isEdit, loadShift, needsHospitalSelection, shiftId]);

  function patchForm(patch) {
    setForm((prev) => ({ ...prev, ...patch }));
  }

  async function handleSubmit(event) {
    event.preventDefault();
    if (!form.name.trim()) {
      toast.error('Enter a shift name');
      return;
    }
    if (!form.start_time || !form.end_time) {
      toast.error('Enter check-in and check-out times');
      return;
    }
    setSaving(true);
    try {
      const overnight = detectOvernight(form.start_time, form.end_time);
      const { full, half } = computeShiftHours(form.start_time, form.end_time, overnight);
      const payload = {
        name: form.name.trim(),
        code: suggestShiftCode(form.name, existingShiftCodes),
        start_time: toApiTime(form.start_time),
        end_time: toApiTime(form.end_time),
        is_overnight: overnight,
        full_day_hours: String(full),
        half_day_hours: String(half),
        grace_minutes: 15,
        overtime_allowed: Boolean(form.overtime_allowed),
        active: true,
        description: '',
      };
      if (form.hospital) payload.hospital = form.hospital;

      if (isEdit) {
        await api.patch(`/hr/shifts/${shiftId}/`, payload);
        toast.success('Shift updated');
      } else {
        await api.post('/hr/shifts/', payload);
        toast.success('Shift created');
      }
      navigate(shiftsListRoute);
    } catch (error) {
      toast.error(errorText(error, 'Could not save shift'));
    } finally {
      setSaving(false);
    }
  }

  const overnight = detectOvernight(form.start_time, form.end_time);

  if (loading) {
    return (
      <div className="mx-auto max-w-lg py-12 text-center text-sm text-slate-500">
        Loading shift…
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-lg space-y-5 pb-12">
      <div className="flex flex-wrap items-center gap-3">
        <Link
          to={shiftsListRoute}
          className="inline-flex items-center gap-1 text-sm font-semibold text-violet-700 hover:underline"
        >
          <ArrowLeft size={16} />
          Back to shifts
        </Link>
      </div>

      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold text-slate-900">
          <CalendarClock className="text-violet-600" size={24} />
          {isEdit ? 'Edit shift' : 'Create a shift'}
        </h1>
        <p className="mt-1 text-sm text-slate-600">
          {isEdit
            ? 'Update the shift name and working hours.'
            : 'Enter a name and check-in / check-out times. You can assign employees after saving.'}
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-5">
        <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          {needsHospitalSelection && (
            <label className="block text-sm">
              <span className="font-medium text-slate-700">Hospital</span>
              <select
                className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
                value={form.hospital}
                onChange={(e) => patchForm({ hospital: e.target.value })}
                required
              >
                <option value="">Select hospital</option>
                {hospitals.map((hospital) => (
                  <option key={hospital.id} value={hospital.id}>{hospital.name}</option>
                ))}
              </select>
            </label>
          )}

          <label className="block text-sm">
            <span className="font-medium text-slate-700">Shift name</span>
            <input
              required
              placeholder="e.g. Reception, Nursing, Night duty"
              className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100"
              value={form.name}
              onChange={(e) => patchForm({ name: e.target.value })}
            />
          </label>

          <div className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm font-medium text-slate-700">Time format</span>
              <div className="inline-flex rounded-xl border border-slate-200 bg-slate-50 p-0.5 text-xs font-semibold">
                <button
                  type="button"
                  onClick={() => setTimeFormat('12h')}
                  className={`rounded-lg px-3 py-1.5 transition ${
                    timeFormat === '12h'
                      ? 'bg-white text-violet-700 shadow-sm'
                      : 'text-slate-600 hover:text-slate-800'
                  }`}
                >
                  12-hour
                </button>
                <button
                  type="button"
                  onClick={() => setTimeFormat('24h')}
                  className={`rounded-lg px-3 py-1.5 transition ${
                    timeFormat === '24h'
                      ? 'bg-white text-violet-700 shadow-sm'
                      : 'text-slate-600 hover:text-slate-800'
                  }`}
                >
                  24-hour
                </button>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <ShiftTimeField
                label="Check-in time"
                format={timeFormat}
                required
                value={form.start_time}
                onChange={(start_time) => patchForm({ start_time })}
              />
              <ShiftTimeField
                label="Check-out time"
                format={timeFormat}
                required
                value={form.end_time}
                onChange={(end_time) => patchForm({ end_time })}
              />
            </div>
          </div>

          {(form.start_time || form.end_time) && (
            <div className="rounded-xl bg-violet-50 px-3 py-2.5 text-sm text-violet-900">
              <span className="font-semibold">Working hours:</span>{' '}
              {shiftPreviewText({ ...form, is_overnight: overnight }, timeFormat)}
            </div>
          )}

          <label className="flex items-center gap-3 rounded-xl border border-slate-100 bg-slate-50 px-3 py-3 text-sm">
            <input
              type="checkbox"
              checked={form.overtime_allowed}
              onChange={(e) => patchForm({ overtime_allowed: e.target.checked })}
              className="h-4 w-4 rounded border-slate-300 text-violet-600"
            />
            <span>
              <span className="font-medium text-slate-800">Allow overtime</span>
              <span className="block text-xs text-slate-500">Work past shift end counts as overtime</span>
            </span>
          </label>
        </section>

        <button
          type="submit"
          disabled={saving}
          className="flex w-full min-h-[48px] items-center justify-center rounded-xl bg-violet-600 text-sm font-semibold text-white hover:bg-violet-700 disabled:opacity-50"
        >
          {saving ? 'Saving…' : isEdit ? 'Save changes' : 'Create shift'}
        </button>
      </form>

      {!isEdit && (
        <p className="text-center text-xs text-slate-500">
          After creating, assign this shift to employees from the shifts list.
        </p>
      )}
    </div>
  );
}
