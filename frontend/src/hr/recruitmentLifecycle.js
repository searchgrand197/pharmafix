/** Recruitment pipeline statuses — exclude hired / onboarding / conversion. */

export const RECRUITMENT_STAGE_STATUSES = new Set([

  'applied',

  'shortlisted',

  'interview',

  'selected',

  'rejected',

]);



export function isRecruitmentStageCandidate(c) {

  if (!c || !c.status) return false;

  return RECRUITMENT_STAGE_STATUSES.has(c.status);

}



/** Normalize email for client-side checks (matches backend strip + lower). */
export function normalizeEmailAddress(email) {
  if (!email) return '';
  return String(email).trim().toLowerCase();
}

export function normalizeApiList(data) {

  if (!data) return [];

  if (Array.isArray(data)) return data;

  return data.results || [];

}



/** Local calendar date YYYY-MM-DD (matches backend timezone.localdate). */

export function localTodayString() {

  const d = new Date();

  const y = d.getFullYear();

  const m = String(d.getMonth() + 1).padStart(2, '0');

  const day = String(d.getDate()).padStart(2, '0');

  return `${y}-${m}-${day}`;

}



export function parseDateOnly(value) {

  if (!value) return null;

  const raw = String(value).split('T')[0];

  const [y, m, d] = raw.split('-').map(Number);

  if (!y || !m || !d) return null;

  const date = new Date(y, m - 1, d);

  date.setHours(0, 0, 0, 0);

  return date;

}



/** True when today is after the last date to apply. */

export function isJobExpired(job) {

  if (!job?.expiry_date) return false;

  const expiry = parseDateOnly(job.expiry_date);

  const today = parseDateOnly(localTodayString());

  if (!expiry || !today) return false;

  return expiry < today;

}



/** True when candidates may apply (status open, active, not archived, not expired). */

export function jobAcceptsApplications(job) {

  if (!job) return false;

  if (job.is_archived || job.is_active === false) return false;

  if (job.status !== 'open') return false;

  if (!job.expiry_date) return false;

  if (isJobExpired(job)) return false;

  return true;

}



/** Badge label + styles for HR job listings (accounts for expiry vs DB status). */
export function getJobStatusPresentation(job) {
  if (!job) {
    return { label: '—', className: 'bg-gray-100 text-gray-800' };
  }

  const expired = job.is_expired ?? isJobExpired(job);
  const accepts = job.accepts_applications ?? jobAcceptsApplications(job);

  if (job.status === 'open' && !accepts) {
    if (expired) {
      return {
        label: 'Deadline passed',
        className: 'bg-amber-100 text-amber-900',
        title: 'Last date to apply has passed. Edit the job to set a future deadline and keep status Open.',
      };
    }
    return {
      label: 'Applications closed',
      className: 'bg-amber-100 text-amber-900',
      title: 'This job is open in the system but not accepting applications.',
    };
  }

  switch (job.status) {
    case 'open':
      return { label: job.status_display || 'Open', className: 'bg-green-100 text-green-800' };
    case 'closed':
      return { label: job.status_display || 'Closed', className: 'bg-red-100 text-red-800' };
    case 'draft':
      return { label: job.status_display || 'Draft', className: 'bg-gray-100 text-gray-800' };
    case 'archived':
      return { label: job.status_display || 'Archived', className: 'bg-slate-100 text-slate-800' };
    case 'on_hold':
      return { label: job.status_display || 'On hold', className: 'bg-amber-100 text-amber-800' };
    default:
      return {
        label: job.status_display || job.status || '—',
        className: 'bg-amber-100 text-amber-800',
      };
  }
}



export const HR_EXPIRY_DATE_PAST_ERROR = 'Last date to apply cannot be in the past.';



export function validateHrExpiryDate(value, { required = true } = {}) {

  if (!value) {

    if (required) {
      return 'Last date to apply is required.';
    }
    return null;

  }

  const expiry = parseDateOnly(value);

  const today = parseDateOnly(localTodayString());

  if (!expiry || !today) {

    return 'Please enter a valid date.';

  }

  if (expiry < today) {

    return HR_EXPIRY_DATE_PAST_ERROR;

  }

  return null;

}



/** Minimum fields to save a job opening as draft (title or designation + department). */
export function validateJobDraftFields(data, designations = []) {
  if (!data?.department) {
    return 'Department is required to save a draft.';
  }
  const hasTitle = Boolean(String(data.title || '').trim());
  if (hasTitle) {
    return null;
  }
  if (data.designation) {
    const selected = designations.find((item) => String(item.id) === String(data.designation));
    if (selected?.name) {
      return null;
    }
  }
  return 'Job title or designation is required to save a draft.';
}


