import React, { useEffect, useState } from 'react';
import api from '../../api';
import toast from 'react-hot-toast';
import ScheduleInterviewFormFields from './ScheduleInterviewFormFields';
import {
  applyOfflineInterviewDefaults,
  buildBulkScheduleInterviewPayload,
  defaultScheduleInterviewForm,
  offlineInterviewDefaultsFromOrganization,
  validateScheduleInterviewForm,
} from './scheduleInterviewFormUtils';

const EMPTY_OFFLINE_INTERVIEW_DEFAULTS = {
  officeAddress: '',
  locationNotes: '',
};

/**
 * Enterprise bulk interview: schedule / reschedule / cancel for many candidates.
 * action: 'schedule' | 'reschedule' | 'cancel'
 */
export default function BulkInterviewModal({
  open,
  onClose,
  action,
  candidateIds,
  candidateLabels,
  listFilterParams,
  onFinished,
}) {
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState(() => defaultScheduleInterviewForm());
  const [offlineInterviewDefaults, setOfflineInterviewDefaults] = useState(
    EMPTY_OFFLINE_INTERVIEW_DEFAULTS,
  );

  useEffect(() => {
    if (!open) return;
    setForm(defaultScheduleInterviewForm());
    setSubmitting(false);
    setOfflineInterviewDefaults(EMPTY_OFFLINE_INTERVIEW_DEFAULTS);
  }, [open, action]);

  useEffect(() => {
    if (!open || action === 'cancel') return undefined;

    let cancelled = false;

    (async () => {
      try {
        const { data } = await api.get('/hr/organization-settings/current/');
        if (cancelled) return;
        const defaults = offlineInterviewDefaultsFromOrganization(data);
        setOfflineInterviewDefaults(defaults);
        setForm((current) => applyOfflineInterviewDefaults(current, defaults));
      } catch (error) {
        if (cancelled) return;
        setOfflineInterviewDefaults(EMPTY_OFFLINE_INTERVIEW_DEFAULTS);
        console.error('Failed to load bulk interview offline defaults', error);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [open, action]);

  if (!open) return null;

  const axiosListConfig = listFilterParams ? { params: listFilterParams } : {};

  const count = candidateIds.length;
  const title =
    action === 'schedule'
      ? 'Bulk schedule interview'
      : action === 'reschedule'
        ? 'Bulk reschedule interview'
        : 'Cancel scheduled interviews';

  const handleCancelInterviews = async () => {
    if (!count) return;
    setSubmitting(true);
    try {
      const { data } = await api.post('/hr/candidates/bulk_cancel_interviews/', {
        candidate_ids: candidateIds,
      }, axiosListConfig);
      toast.success(data.message || 'Interviews cancelled');
      onFinished?.();
      onClose();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Could not cancel interviews');
    } finally {
      setSubmitting(false);
    }
  };

  const handleSubmitSchedule = async (rescheduled) => {
    const validationError = validateScheduleInterviewForm(form);
    if (validationError) {
      toast.error(validationError);
      return;
    }
    const payload = buildBulkScheduleInterviewPayload(form, candidateIds, rescheduled);
    const url = rescheduled
      ? '/hr/candidates/bulk_reschedule_interviews/'
      : '/hr/candidates/bulk_schedule_interviews/';
    setSubmitting(true);
    try {
      const { data } = await api.post(url, payload, axiosListConfig);
      toast.success(data.message || 'Saved');
      onFinished?.();
      onClose();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Request failed');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-6 shadow-xl">
        <h3 className="text-lg font-semibold text-gray-900">{title}</h3>
        <p className="mt-1 text-sm text-gray-600">
          {count} candidate{count === 1 ? '' : 's'} selected
          {candidateLabels?.length ? `: ${candidateLabels.slice(0, 5).join(', ')}${count > 5 ? '…' : ''}` : ''}
        </p>

        {action === 'cancel' && (
          <div className="mt-6 space-y-4">
            <p className="text-sm text-gray-700">
              This will mark all current <strong>scheduled</strong> interview rows for these candidates as{' '}
              <strong>cancelled</strong> and clear their interview slot on the candidate record when nothing else is
              scheduled.
            </p>
            <div className="flex gap-3 pt-2">
              <button
                type="button"
                onClick={onClose}
                className="flex-1 rounded-lg border border-gray-200 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                Back
              </button>
              <button
                type="button"
                disabled={submitting}
                onClick={handleCancelInterviews}
                className="flex-1 rounded-lg bg-red-600 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:bg-gray-300"
              >
                {submitting ? 'Cancelling…' : 'Confirm cancel'}
              </button>
            </div>
          </div>
        )}

        {(action === 'schedule' || action === 'reschedule') && (
          <div className="mt-4">
            <ScheduleInterviewFormFields
              form={form}
              onChange={setForm}
              offlineDefaults={offlineInterviewDefaults}
            />
            <div className="flex gap-3 pt-4">
              <button
                type="button"
                onClick={onClose}
                className="flex-1 rounded-lg border border-gray-200 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={submitting || !count}
                onClick={() => handleSubmitSchedule(action === 'reschedule')}
                className="flex-1 rounded-lg bg-purple-600 py-2 text-sm font-semibold text-white hover:bg-purple-700 disabled:bg-gray-300"
              >
                {submitting ? 'Saving…' : action === 'reschedule' ? 'Reschedule all' : 'Schedule all'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
