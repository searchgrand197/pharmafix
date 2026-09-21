import { monthKey } from '../../utils/attendanceCalendar';
import { formatPayrollMonthLabel, isPayrollMonthEndWindow, payrollRunsRoute } from './payrollMonthTaskUtils';
import { PRIORITY_ORDER } from './nextActionEngine';

/** Aggregate card — count matches backend command-center-counts or task list. */
export const PRIORITY_TIERS = {
  urgent: {
    id: 'urgent',
    label: 'Urgent',
    description: 'Requires action today or is overdue',
    accent: 'border-red-200 bg-red-50',
    titleClass: 'text-red-900',
  },
  attention: {
    id: 'attention',
    label: 'Attention required',
    description: 'Pending approvals and reviews this week',
    accent: 'border-amber-200 bg-amber-50',
    titleClass: 'text-amber-900',
  },
  upcoming: {
    id: 'upcoming',
    label: 'Upcoming',
    description: 'Due soon — plan ahead',
    accent: 'border-blue-200 bg-blue-50',
    titleClass: 'text-blue-900',
  },
};

export const WORK_QUEUE_ITEMS = [
  {
    id: 'document_reviews',
    countKey: 'document_reviews',
    label: 'Document reviews',
    route: '/hr/onboarding/document-verification',
    actionLabel: 'Review documents',
    priority: 'critical',
  },
  {
    id: 'leave_requests',
    countKey: 'leave_requests',
    label: 'Leave requests',
    route: '/hr/leave/requests?status=PENDING',
    actionLabel: 'Review requests',
    priority: 'medium',
  },
  {
    id: 'regularizations',
    countKey: 'regularizations',
    label: 'Regularizations',
    route: '/hr/operations/regularizations?status=pending',
    actionLabel: 'Review corrections',
    priority: 'medium',
  },
  {
    id: 'onboarding_reviews',
    countKey: 'onboarding_reviews',
    label: 'Onboarding reviews',
    route: '/hr/onboarding/document-verification',
    actionLabel: 'Open onboarding',
    priority: 'critical',
  },
  {
    id: 'offers_to_send',
    countKey: 'offers_to_send',
    label: 'Offers to send',
    route: '/hr/recruitment/offers',
    actionLabel: 'Send offers',
    priority: 'medium',
  },
  {
    id: 'offers_awaiting_response',
    countKey: 'offers_awaiting_response',
    label: 'Offers awaiting response',
    route: '/hr/recruitment/offers',
    actionLabel: 'View offers',
    priority: 'medium',
  },
  {
    id: 'payroll_actions',
    countKey: 'payroll_actions',
    label: 'Payroll actions',
    route: '/hr/payroll/runs',
    actionLabel: 'Open payroll',
    priority: 'critical',
  },
];

const URGENT_CARDS = [
  {
    id: 'offers_awaiting_response',
    countKey: 'offers_awaiting_response',
    label: 'Offers awaiting response',
    route: '/hr/recruitment/offers',
    actionLabel: 'View offers',
    priority: 'critical',
    dueHint: 'Candidate has not responded',
  },
  {
    id: 'offers_expiring_soon',
    countKey: 'offers_expiring_soon',
    label: 'Offers expiring soon',
    route: '/hr/recruitment/offers',
    actionLabel: 'View offers',
    priority: 'critical',
    dueHint: 'Expires within 7 days',
  },
  {
    id: 'delayed_joiners',
    countKey: 'delayed_joiners',
    label: 'Delayed joiners',
    route: '/hr/onboarding/pending-documents',
    actionLabel: 'Follow up',
    priority: 'critical',
    dueHint: 'Past expected joining date',
  },
  {
    id: 'expired_documents',
    countKey: 'expired_documents',
    label: 'Expired documents',
    route: '/hr/onboarding/document-verification',
    actionLabel: 'Review documents',
    priority: 'critical',
    dueHint: 'Compliance documents past expiry',
  },
  {
    id: 'payroll_locked',
    countKey: 'payroll_locked',
    label: 'Payroll awaiting publish',
    route: '/hr/payroll/payslips',
    actionLabel: 'Publish payslips',
    priority: 'critical',
    dueHint: 'Locked runs not yet published',
  },
  {
    id: 'email_failures',
    countKey: 'email_failures',
    label: 'Recruitment email failures',
    route: '/hr/recruitment/candidates',
    actionLabel: 'Review candidates',
    priority: 'critical',
    dueHint: 'Failed recruitment emails',
  },
];

const ATTENTION_CARDS = [
  {
    id: 'missing_designation',
    countKey: 'missing_designation',
    label: 'Designation not linked',
    route: '/hr/employees?filter=missing_designation',
    actionLabel: 'Link designations',
    priority: 'medium',
  },
  {
    id: 'missing_department',
    countKey: 'missing_department',
    label: 'Missing department',
    route: '/hr/employees?filter=missing_department',
    actionLabel: 'Assign departments',
    priority: 'medium',
  },
  {
    id: 'draft_jobs',
    countKey: 'draft_jobs',
    label: 'Draft job openings',
    route: '/hr/jobs?status=draft',
    actionLabel: 'Publish jobs',
    priority: 'medium',
  },
  {
    id: 'expiring_documents',
    countKey: 'expiring_documents',
    label: 'Documents expiring within 30 days',
    route: '/hr/onboarding/document-verification',
    actionLabel: 'Review documents',
    priority: 'low',
  },
];

function resolvePayrollRoute(month, readiness) {
  if (!month) return '/hr/payroll/runs';
  return payrollRunsRoute(month);
}

function buildUpcomingCards(counts, context) {
  const month = context?.month || counts?.month || monthKey();
  const monthLabel = formatPayrollMonthLabel(month);
  const readiness = context?.payrollMonthReadiness || {};
  const cards = [];

  const probationCount = (context?.tasks || []).filter((t) => t.category === 'probation_review').length;
  if (probationCount > 0) {
    cards.push({
      id: 'probation_reviews',
      count: probationCount,
      label: 'Probation reviews due',
      route: '/hr/employees',
      actionLabel: 'Review employees',
      priority: 'low',
      dueHint: 'Within 30 days',
      tier: 'upcoming',
    });
  }

  if ((counts?.joining_this_week || 0) > 0) {
    cards.push({
      id: 'joining_this_week',
      count: counts.joining_this_week,
      label: 'Joining dates this week',
      route: '/hr/onboarding/pending-documents',
      actionLabel: 'View joiners',
      priority: 'low',
      dueHint: 'Next 7 days',
      tier: 'upcoming',
    });
  }

  if (isPayrollMonthEndWindow(context?.today ?? new Date()) && readiness.next_action === 'finalize_attendance') {
    cards.push({
      id: 'attendance_finalization_due',
      count: 1,
      label: 'Payroll ready to run',
      route: resolvePayrollRoute(month, readiness),
      actionLabel: 'Run payroll',
      priority: 'critical',
      dueHint: monthLabel,
      tier: 'upcoming',
    });
  }

  if (
    isPayrollMonthEndWindow(context?.today ?? new Date())
    && ['calculate_payroll', 'review_payroll'].includes(readiness.next_action)
  ) {
    cards.push({
      id: 'payroll_processing_window',
      count: counts?.payroll_runs_needing_action || 1,
      label: 'Payroll processing window',
      route: resolvePayrollRoute(month, readiness),
      actionLabel: readiness.next_action === 'calculate_payroll' ? 'Run payroll' : 'Review payroll',
      priority: 'medium',
      dueHint: monthLabel,
      tier: 'upcoming',
    });
  }

  return cards;
}

function enrichCard(def, counts, tier, hint = null) {
  const count = Number(counts?.[def.countKey]) || 0;
  return {
    ...def,
    count,
    tier,
    dueDate: def.dueDate ?? null,
    hint: hint || null,
  };
}

const WORK_QUEUE_HINT_CATEGORIES = {
  offers_to_send: ['send_offer', 'pending_offer'],
  offers_awaiting_response: ['offer_awaiting_response'],
  missing_department: ['missing_department'],
  document_reviews: ['pending_document_review', 'mandatory_docs'],
  onboarding_reviews: ['ready_to_activate', 'onboarding_waiting_docs'],
};

function formatWorkQueueHint(cardId, matchingTasks) {
  const names = [...new Set(
    matchingTasks.map((task) => task.employeeName).filter(Boolean),
  )];
  if (!names.length) return null;
  if (cardId === 'offers_to_send' && names.length === 1) {
    return `${names[0]} — offer not sent`;
  }
  if (names.length <= 3) {
    return names.join(', ');
  }
  return `${names.slice(0, 3).join(', ')} +${names.length - 3} more`;
}

function resolveWorkQueueHint(cardId, count, tasks = []) {
  if (count <= 0 || count > 3) return null;
  const categories = WORK_QUEUE_HINT_CATEGORIES[cardId];
  if (!categories?.length) return null;
  const matchingTasks = (tasks || []).filter((task) => categories.includes(task.category));
  return formatWorkQueueHint(cardId, matchingTasks);
}

/** Merge API counts with derived payroll / offer totals for work queue. */
export function normalizeCommandCenterCounts(apiCounts = {}, context = {}) {
  const readiness = context.payrollMonthReadiness || {};
  const today = context.today ?? new Date();
  let payrollActions = Number(apiCounts.payroll_locked) || 0;
  if (
    isPayrollMonthEndWindow(today)
    && readiness.next_action
    && readiness.next_action !== 'none'
  ) {
    payrollActions += 1;
  }

  const tasks = context?.tasks || [];
  const offersToSendFromTasks = tasks.filter(
    (t) => t.category === 'send_offer' || t.category === 'pending_offer',
  ).length;
  const offersToSend = offersToSendFromTasks + (Number(apiCounts.offers_unsent) || 0);

  return {
    ...apiCounts,
    payrollMonthReadiness: readiness,
    payroll_actions: payrollActions,
    payroll_runs_needing_action: readiness.payroll_runs_needing_action || 0,
    offers_to_send: offersToSend,
    offers_awaiting_response: Number(apiCounts.offers_awaiting_response) || 0,
    pending_offers: offersToSend,
  };
}

export function buildWorkQueue(counts = {}, tasks = []) {
  const items = WORK_QUEUE_ITEMS.map((def) => {
    const count = Number(counts?.[def.countKey]) || 0;
    const hint = resolveWorkQueueHint(def.id, count, tasks);
    return enrichCard(def, counts, 'work_queue', hint);
  }).filter((item) => item.count > 0);

  const total = items.reduce((sum, item) => sum + item.count, 0);
  return { items, total };
}

export function buildPriorityTierCards(counts = {}, context = {}) {
  const urgent = URGENT_CARDS.map((def) => enrichCard(def, counts, 'urgent')).filter((c) => c.count > 0);
  const attention = ATTENTION_CARDS.map((def) => enrichCard(def, counts, 'attention')).filter((c) => c.count > 0);
  const upcoming = buildUpcomingCards(counts, { ...context, tasks: context.tasks || [] });

  return { urgent, attention, upcoming };
}

export function sortAggregateCards(cards = []) {
  return [...cards].sort((a, b) => {
    const p = (PRIORITY_ORDER[a.priority] ?? 1) - (PRIORITY_ORDER[b.priority] ?? 1);
    if (p !== 0) return p;
    return b.count - a.count;
  });
}

export const PRIORITY_LABEL_MAP = {
  critical: 'High',
  medium: 'Medium',
  low: 'Low',
};
