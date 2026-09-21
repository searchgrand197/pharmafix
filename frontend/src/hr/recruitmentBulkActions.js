/** Shared eligibility checks for recruitment bulk actions. */

const TERMINAL_STATUSES = new Set(['hired', 'rejected']);

export function getSelectionStageContext(list) {
  if (!list?.length) {
    return { homogeneous: false, status: null, hasScheduledInterview: false };
  }

  const status = list[0].status;
  const homogeneous = list.every((c) => c.status === status);

  if (!homogeneous) {
    return { homogeneous: false, status: null, hasScheduledInterview: false };
  }

  const hasScheduledInterview =
    status === 'interview' &&
    list.every((c) => Boolean(c.active_scheduled_interview));

  return { homogeneous: true, status, hasScheduledInterview };
}

export function canBulkMoveToInterview(list) {
  if (!list?.length) return false;
  return list.every((c) => c.status === 'shortlisted');
}

export function canBulkSchedule(list) {
  if (!list?.length) return false;
  return list.every(
    (c) =>
      (c.status === 'shortlisted' || c.status === 'interview') &&
      !c.active_scheduled_interview,
  );
}

export function canBulkRescheduleOrCancel(list) {
  if (!list?.length) return false;
  return list.every((c) => c.status === 'interview' && c.active_scheduled_interview);
}

export function canBulkShortlist(list) {
  return list?.length && list.every((c) => c.status === 'applied');
}

export function canBulkReject(list) {
  if (!list?.length) return false;
  return list.every((c) => c.status !== 'hired' && c.status !== 'rejected');
}

export function getVisibleBulkActions(list) {
  const { homogeneous, status, hasScheduledInterview } = getSelectionStageContext(list);

  if (!homogeneous || !status || TERMINAL_STATUSES.has(status)) {
    return {
      shortlist: false,
      reject: false,
      moveToInterview: false,
      schedule: false,
      reschedule: false,
      cancel: false,
    };
  }

  return {
    shortlist: canBulkShortlist(list),
    reject: canBulkReject(list),
    moveToInterview: canBulkMoveToInterview(list),
    schedule: canBulkSchedule(list),
    reschedule: status === 'interview' && hasScheduledInterview,
    cancel: status === 'interview' && hasScheduledInterview,
  };
}
