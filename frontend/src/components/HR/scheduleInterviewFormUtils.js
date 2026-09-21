import {
  HR_SYSTEM_TIMEZONE,
  isoToDateAndTimeInTimezone,
  padTimeValue,
} from '../../utils/interviewDateTime';

export function defaultScheduleInterviewForm(overrides = {}) {
  return {
    interviewType: 'online',
    date: '',
    time: '',
    durationMinutes: 60,
    interviewer: '',
    notes: '',
    platform: '',
    meetingLink: '',
    officeAddress: '',
    locationNotes: '',
    offlineDefaultsApplied: false,
    ...overrides,
  };
}

export function offlineInterviewDefaultsFromOrganization(settings) {
  return {
    officeAddress: (settings?.organization_address || '').trim(),
    locationNotes: (settings?.organization_location || '').trim(),
  };
}

export function applyOfflineInterviewDefaults(form, offlineDefaults = {}) {
  const hasDefaults = Boolean(
    (offlineDefaults.officeAddress || '').trim() ||
    (offlineDefaults.locationNotes || '').trim(),
  );
  if (!form || !hasDefaults || form.offlineDefaultsApplied) {
    return form;
  }
  return {
    ...form,
    officeAddress: (form.officeAddress || '').trim()
      ? form.officeAddress
      : (offlineDefaults.officeAddress || ''),
    locationNotes: (form.locationNotes || '').trim()
      ? form.locationNotes
      : (offlineDefaults.locationNotes || ''),
    offlineDefaultsApplied: true,
  };
}

/** Prefill from candidate detail record (schedule / reschedule). */
export function scheduleInterviewFormFromCandidate(candidate) {
  if (!candidate) return defaultScheduleInterviewForm();
  const inv = candidate.active_scheduled_interview;
  const parts = isoToDateAndTimeInTimezone(
    candidate.interview_date || inv?.scheduled_start,
  );
  return defaultScheduleInterviewForm({
    interviewType: candidate.interview_type === 'offline' ? 'offline' : 'online',
    date: parts.date,
    time: parts.time,
    durationMinutes: inv?.duration_minutes || 60,
    interviewer: inv?.interviewer_name || '',
    notes: inv?.notes || '',
    platform: inv?.platform || '',
    meetingLink: candidate.interview_meeting_link || inv?.meeting_link || '',
    officeAddress: candidate.interview_venue_address || inv?.office_address || '',
    locationNotes: inv?.location_notes || '',
  });
}

export function validateScheduleInterviewForm(form) {
  if (!form.date || !form.time) {
    return 'Choose interview date and time';
  }
  // Past-time check is enforced on the server (IST). Do not block here — browser
  // clocks/timezone APIs can disagree with the Django server and caused false rejects.
  if (form.interviewType === 'online' && !form.meetingLink.trim()) {
    return 'Meeting link is required for online interviews';
  }
  if (form.interviewType === 'offline' && !form.officeAddress.trim()) {
    return 'Office address is required for offline interviews';
  }
  return null;
}

/** Payload for POST /hr/candidates/:id/schedule_interview/ */
export function buildSingleScheduleInterviewPayload(form) {
  const date = form.date;
  const time = padTimeValue(form.time);
  return {
    date,
    time,
    interview_date: `${date}T${time}`,
    interview_type: form.interviewType,
    timezone: HR_SYSTEM_TIMEZONE,
    duration_minutes: form.durationMinutes,
    interviewer: form.interviewer,
    interviewer_name: form.interviewer,
    notes: form.notes,
    platform: form.interviewType === 'online' ? form.platform : '',
    interview_meeting_link: form.interviewType === 'online' ? form.meetingLink.trim() : '',
    interview_venue_address: form.interviewType === 'offline' ? form.officeAddress.trim() : '',
    location_notes: form.interviewType === 'offline' ? form.locationNotes : '',
  };
}

/** Payload for bulk schedule / reschedule endpoints. */
export function buildBulkScheduleInterviewPayload(form, candidateIds, rescheduled = false) {
  const date = form.date;
  const time = padTimeValue(form.time);
  return {
    candidate_ids: candidateIds,
    notify_candidate: rescheduled,
    interview_type: form.interviewType,
    date,
    time,
    timezone: HR_SYSTEM_TIMEZONE,
    duration_minutes: form.durationMinutes,
    interviewer: form.interviewer,
    interviewer_name: form.interviewer,
    notes: form.notes,
    platform: form.interviewType === 'online' ? form.platform : '',
    meeting_link: form.interviewType === 'online' ? form.meetingLink.trim() : '',
    office_address: form.interviewType === 'offline' ? form.officeAddress.trim() : '',
    location_notes: form.interviewType === 'offline' ? form.locationNotes : '',
  };
}
