import api from '../../api';
import { monthKey } from '../../utils/attendanceCalendar';

export const JOURNEY_SECTIONS = [
  {
    id: 'hiring',
    order: 1,
    title: 'Phase 1 — Hire',
    subtitle: 'Direct hire or steps 1–7',
    description: 'Post job openings and run recruitment, or use direct hire for walk-ins already in the office. Then verify documents and create employee records.',
    stages: [
      {
        id: 'direct_hire',
        label: 'Direct Hire',
        pageLabel: 'Add Employee (Direct Hire)',
        hint: 'Walk-in already in the office — create an active employee, mark documents verified in HR, and send portal welcome email. Skips job posting and recruitment.',
        route: '/hr/employees/create',
        color: '#7c3aed',
        alternate: true,
      },
      {
        step: 1,
        id: 'jobs_open',
        label: 'Post a Job',
        pageLabel: 'Add New Job',
        hint: 'Create and publish a job opening — candidates can only apply after a role is live.',
        route: '/hr/jobs/new',
        color: '#4f46e5',
        countKey: 'jobs_open',
      },
      {
        step: 2,
        id: 'applied',
        label: 'Applied',
        pageLabel: 'Candidates',
        hint: 'Review new applications and rejected candidates from this job.',
        route: '/hr/recruitment/candidates',
        color: '#6366f1',
        countKey: 'applied',
      },
      {
        step: 3,
        id: 'shortlisted',
        label: 'Shortlisted',
        pageLabel: 'Candidates',
        hint: 'Candidates marked ready for the next hiring step.',
        route: '/hr/recruitment/candidates',
        color: '#8b5cf6',
        countKey: 'shortlisted',
      },
      {
        step: 4,
        id: 'interview',
        label: 'Interview',
        pageLabel: 'Interviews',
        hint: 'Schedule interviews and record outcomes.',
        route: '/hr/recruitment/interviews',
        color: '#2563eb',
        countKey: 'interview',
      },
      {
        step: 5,
        id: 'offer',
        label: 'Offer',
        pageLabel: 'Offers',
        hint: 'Send offer letters and track acceptances.',
        route: '/hr/recruitment/offers',
        color: '#0ea5e9',
        countKey: 'offer',
      },
      {
        step: 6,
        id: 'kyc',
        label: 'KYC',
        pageLabel: 'Document Verification',
        hint: 'Verify identity and compliance documents before onboarding.',
        route: '/hr/onboarding/document-verification',
        color: '#14b8a6',
        countKey: 'kyc',
      },
      {
        step: 7,
        id: 'employee_created',
        label: 'Employee Created',
        pageLabel: 'Employee Directory',
        hint: 'Active employees now in your workforce.',
        route: '/hr/employees',
        color: '#10b981',
        countKey: 'employee_created',
      },
    ],
  },
  {
    id: 'employee',
    order: 2,
    title: 'Phase 2 — Onboard & prepare',
    subtitle: 'Steps 8–11',
    description: 'Finish onboarding paperwork, assign salary, and get attendance running before payroll.',
    stages: [
      {
        step: 8,
        id: 'documents',
        label: 'Documents',
        pageLabel: 'Pending Documents',
        hint: 'Collect remaining onboarding documents from new hires.',
        route: '/hr/onboarding/pending-documents',
        color: '#f59e0b',
        countKey: 'documents',
      },
      {
        step: 9,
        id: 'salary_assigned',
        label: 'Salary Assigned',
        pageLabel: 'Employee Directory',
        hint: 'Employees with an active salary structure assigned.',
        route: '/hr/employees',
        color: '#eab308',
        countKey: 'salary_assigned',
      },
      {
        step: 10,
        id: 'attendance_active',
        label: 'Attendance Active',
        pageLabel: 'Attendance',
        hint: 'Employees scheduled and punching in today.',
        route: '/hr/operations/attendance',
        color: '#f97316',
        countKey: 'attendance_active',
      },
      {
        step: 11,
        id: 'payroll_eligible',
        label: 'Payroll Eligible',
        pageLabel: 'Payroll Runs',
        hint: 'Active employees ready to be included in payroll.',
        route: '/hr/payroll/runs',
        color: '#ef4444',
        countKey: 'payroll_eligible',
      },
    ],
  },
  {
    id: 'payroll',
    order: 3,
    title: 'Phase 3 — Pay',
    subtitle: 'Steps 12–14',
    description: 'Close attendance for the month, run payroll, and publish payslips.',
    stages: [
      {
        step: 12,
        id: 'attendance_ready',
        label: 'Attendance Ready',
        pageLabel: 'Attendance',
        hint: 'Daily attendance records captured for payroll.',
        route: '/hr/operations/attendance',
        color: '#06b6d4',
        countKey: 'attendance_ready',
      },
      {
        step: 13,
        id: 'payroll_draft',
        label: 'Payroll Draft',
        pageLabel: 'Payroll Runs',
        hint: 'Monthly payroll runs awaiting review or approval.',
        route: '/hr/payroll/runs',
        color: '#64748b',
        countKey: 'payroll_draft',
      },
      {
        step: 14,
        id: 'published',
        label: 'Published',
        pageLabel: 'Payslips',
        hint: 'Payslips published and available to employees.',
        route: '/hr/payroll/payslips',
        color: '#22c55e',
        countKey: 'published',
      },
    ],
  },
];

export const JOURNEY_WORKFLOW_STEPS = JOURNEY_SECTIONS.flatMap((section) =>
  section.stages.map((stage) => ({ ...stage, phaseId: section.id, phaseTitle: section.title })),
);

/** Shorter labels for accordion headers on Journey Center home. */
export const JOURNEY_PHASE_SHORT_LABELS = {
  hiring: 'Hire staff',
  employee: 'Onboard & prepare',
  payroll: 'Run payroll',
};

export function computePhaseTotal(section, counts = {}, loading = false) {
  if (loading) return 0;
  return section.stages.reduce(
    (sum, stage) => sum + (Number(counts[stage.countKey]) || 0),
    0,
  );
}

/** First phase with pending records, else hiring. */
export function computeDefaultExpandedPhase(counts = {}, loading = false) {
  if (loading) return 'hiring';
  for (const section of JOURNEY_SECTIONS) {
    if (computePhaseTotal(section, counts, false) > 0) {
      return section.id;
    }
  }
  return 'hiring';
}

export const JOURNEY_CENTER_JOB_STORAGE_KEY = 'journeyCenterJobOpening';

export function getPersistedJourneyJobOpening() {
  try {
    return sessionStorage.getItem(JOURNEY_CENTER_JOB_STORAGE_KEY) || '';
  } catch {
    return '';
  }
}

export function persistJourneyJobOpening(jobOpeningId) {
  try {
    if (jobOpeningId) {
      sessionStorage.setItem(JOURNEY_CENTER_JOB_STORAGE_KEY, jobOpeningId);
    } else {
      sessionStorage.removeItem(JOURNEY_CENTER_JOB_STORAGE_KEY);
    }
  } catch {
    /* ignore quota / private mode */
  }
}

/** Journey Center path, preferring an explicit job id then the last selected job. */
export function journeyCenterPath(jobOpening) {
  const id = jobOpening || getPersistedJourneyJobOpening();
  return id ? `/hr/journey-center?job_opening=${encodeURIComponent(id)}` : '/hr/journey-center';
}

/** Sync URL job filter with session storage (restore last job when URL has none). */
export function syncJourneyJobFromSearchParams(searchParams, setSearchParams) {
  const fromUrl = searchParams.get('job_opening');
  if (fromUrl) {
    persistJourneyJobOpening(fromUrl);
    return;
  }
  const saved = getPersistedJourneyJobOpening();
  if (!saved) return;
  const params = new URLSearchParams(searchParams);
  params.set('job_opening', saved);
  setSearchParams(params, { replace: true });
}

export const JOURNEY_STAGE_PIPELINE = {
  applied: 'applied',
  shortlisted: 'shortlisted',
};

export function pipelineQueryForStage(stageId) {
  return JOURNEY_STAGE_PIPELINE[stageId] || null;
}

/** Append query flag so destination pages can show "Back to Journey Center". */
export function withJourneyCenterReturn(route, options = {}) {
  if (!route) return journeyCenterPath(options.jobOpening);
  const { jobOpening, pipeline } = options;
  const [path, query = ''] = route.split('?');
  const params = new URLSearchParams(query);
  params.set('from', 'journey-center');
  if (jobOpening) params.set('job_opening', jobOpening);
  if (pipeline) params.set('pipeline', pipeline);
  const qs = params.toString();
  return qs ? `${path}?${qs}` : path;
}

/** Append query flag so destination pages can show "Back to HR Dashboard". */
export function withHrDashboardReturn(route) {
  if (!route) return '/hr/journey-center/dashboard';
  const [path, query = ''] = route.split('?');
  const params = new URLSearchParams(query);
  params.set('from', 'hr-dashboard');
  const qs = params.toString();
  return qs ? `${path}?${qs}` : path;
}

export function isFromHrDashboard(searchParams) {
  return searchParams?.get('from') === 'hr-dashboard';
}

export function isFromJourneyCenter(searchParams) {
  return searchParams?.get('from') === 'journey-center';
}

/** Stage IDs that participate in vacancy funnel completion (excludes direct_hire). */
export const JOURNEY_COMPLETION_STAGE_IDS = [
  'jobs_open', 'applied', 'shortlisted', 'interview', 'offer', 'kyc', 'employee_created',
  'documents', 'salary_assigned', 'attendance_active', 'payroll_eligible',
  'attendance_ready', 'payroll_draft', 'published',
];

export const COMPLETION_STATUS_ROW_CLASS = {
  complete: 'border-emerald-200 bg-emerald-50/70',
  almost: 'border-amber-200 bg-amber-50/60',
  in_progress: 'border-violet-200 bg-violet-50/40',
  not_started: 'border-gray-100 bg-white',
};

export const COMPLETION_STATUS_BAR_CLASS = {
  complete: 'bg-emerald-500',
  almost: 'bg-amber-500',
  in_progress: 'bg-violet-500',
  not_started: 'bg-gray-200',
};

export function completionRowClass(stepCompletion) {
  if (!stepCompletion) return COMPLETION_STATUS_ROW_CLASS.not_started;
  return COMPLETION_STATUS_ROW_CLASS[stepCompletion.status] || COMPLETION_STATUS_ROW_CLASS.not_started;
}

export function completionBarClass(stepCompletion) {
  if (!stepCompletion) return COMPLETION_STATUS_BAR_CLASS.not_started;
  return COMPLETION_STATUS_BAR_CLASS[stepCompletion.status] || COMPLETION_STATUS_BAR_CLASS.not_started;
}

export function completionTooltip(stage, stepCompletion) {
  if (!stepCompletion) return stage.hint;
  const { current, target, percent, extra, awaiting_hire } = stepCompletion;
  if (awaiting_hire) {
    return `${stage.hint} — complete hiring first to track this step.`;
  }
  const extraNote = extra > 0 ? ` (${extra} over target)` : '';
  return `${current} of ${target} toward goal — ${percent}% complete${extraNote}`;
}

/** Average % for measurable steps in a phase section. */
export function computePhaseCompletionPercent(section, completion) {
  if (!completion?.steps) return null;
  const ids = section.stages
    .filter((s) => !s.alternate && s.countKey)
    .map((s) => s.id)
    .filter((id) => completion.steps[id]);
  if (!ids.length) return null;
  const sum = ids.reduce((acc, id) => acc + (completion.steps[id].percent || 0), 0);
  return Math.round(sum / ids.length);
}

/** First funnel step (after jobs_open) below 100% — highlight as bottleneck. */
export function computeBottleneckStageId(completion) {
  if (!completion?.steps) return null;
  const funnel = ['jobs_open', 'applied', 'shortlisted', 'interview', 'offer', 'kyc', 'employee_created'];
  for (const id of funnel) {
    const step = completion.steps[id];
    if (step && step.percent < 100) return id;
  }
  return null;
}

export async function fetchJourneyCenterCounts({ jobOpening } = {}) {
  const errors = [];
  try {
    const params = {};
    if (jobOpening) params.job_opening = jobOpening;
    const { data } = await api.get('/hr/journey-center/counts/', { params });
    return {
      counts: data.counts || {},
      completion: data.completion || null,
      errors,
      month: data.month,
      jobOpening: data.job_opening || null,
      jobTitle: data.job_title || null,
    };
  } catch {
    errors.push('journey center counts');
    return { counts: {}, completion: null, errors, month: monthKey() };
  }
}
