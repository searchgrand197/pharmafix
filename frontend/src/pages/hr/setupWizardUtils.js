import api, { payrollApi } from '../../api';
import { normalizeApiList } from '../../hr/recruitmentLifecycle';
import { normalizePayrollList } from './payroll/payrollUtils';
import { evaluatePayrollReadiness } from './employeeJourneyUtils';
import {
  countMissingLeavePolicy,
  countPayrollEligible,
  designationsMissingSalary,
} from './healthFilterUtils';
import {
  fetchJourneyCenterCounts,
  withHrDashboardReturn,
  withJourneyCenterReturn,
} from './journeyCenterUtils';
import { buildNextActionTasks, prepareActionContext } from './nextActionEngine';
import { fetchHealthContext } from './systemHealthUtils';

/** Append query flag so destination pages can show "Back to Organization Settings". */
export function withSetupWizardReturn(route) {
  if (!route) return '/hr/settings/organization';
  const [path, query = ''] = route.split('?');
  const params = new URLSearchParams(query);
  params.set('from', 'setup-wizard');
  const qs = params.toString();
  return qs ? `${path}?${qs}` : path;
}

export function isFromSetupWizard(searchParams) {
  return searchParams?.get('from') === 'setup-wizard';
}

/** Keep return context when navigating within a flow (wizard, dashboard, journey center). */
export function withPreservedReturn(route, searchParams) {
  const from = searchParams?.get('from');
  if (from === 'setup-wizard') return withSetupWizardReturn(route);
  if (from === 'hr-dashboard') return withHrDashboardReturn(route);
  if (from === 'journey-center') return withJourneyCenterReturn(route);
  return route;
}

export const SETUP_WIZARD_HUB = {
  id: 'hub',
  label: 'Organization Settings',
  route: '/hr/settings/organization',
};

export function resolveSetupWizardStep(pathname) {
  const normalized = (pathname || '').replace(/\/$/, '');
  return SETUP_WIZARD_STEPS.find(
    (step) => normalized === step.route || normalized.startsWith(`${step.route}/`),
  ) || null;
}

export function getSetupWizardNeighbors(pathname) {
  const current = resolveSetupWizardStep(pathname);
  if (!current) {
    return { current: null, previous: null, next: null };
  }
  const index = SETUP_WIZARD_STEPS.findIndex((step) => step.id === current.id);
  const previous = index > 0
    ? SETUP_WIZARD_STEPS[index - 1]
    : SETUP_WIZARD_HUB;
  const next = index < SETUP_WIZARD_STEPS.length - 1
    ? SETUP_WIZARD_STEPS[index + 1]
    : SETUP_WIZARD_HUB;
  return { current, previous, next };
}

export const SETUP_WIZARD_PHASES = [
  { id: 'foundation', label: 'Foundation', stepOrders: [1, 2] },
  { id: 'workforce', label: 'Workforce & hiring', stepOrders: [3, 4, 5] },
  { id: 'operations', label: 'Attendance & leave', stepOrders: [6, 7, 8, 9] },
];

export const SETUP_WIZARD_STEPS = [
  {
    id: 'organization_settings',
    order: 1,
    label: 'Hospital Details',
    route: '/hr/settings/organization/details',
    completeHint: 'Hospital name, HR signatory, and contact details are set',
    incompleteHint: 'Configure company identity for offers, payslips, and emails',
  },
  {
    id: 'departments',
    order: 2,
    label: 'Departments',
    route: '/hr/operations/departments',
    completeHint: 'At least one department exists',
    incompleteHint: 'Create hospital departments before adding employees',
  },
  {
    id: 'designations',
    order: 3,
    label: 'Designations',
    route: '/hr/designations',
    completeHint: 'Job titles / roles are defined',
    incompleteHint: 'Create job titles (e.g. Nurse, Receptionist) for jobs, offers, and employees',
  },
  {
    id: 'document_types',
    order: 4,
    label: 'Onboarding Documents',
    route: '/hr/checklist-rules',
    completeHint: 'Required document types are configured for every employee',
    incompleteHint: 'Configure before candidates reach KYC — define mandatory documents (e.g. ID proof, PAN, degree)',
  },
  {
    id: 'salary_structures',
    order: 5,
    label: 'Compensation Levels',
    route: '/hr/payroll/compensation-levels',
    completeHint: 'Every active designation has a default compensation level',
    incompleteHint: 'Set a default pay level for each job title',
  },
  {
    id: 'shifts',
    order: 6,
    label: 'Shifts',
    route: '/hr/operations/shifts',
    completeHint: 'Work shifts are configured',
    incompleteHint: 'Define shift timings for attendance tracking',
  },
  {
    id: 'holidays',
    order: 7,
    label: 'Holidays',
    route: '/hr/operations/holidays',
    completeHint: 'Active holidays are configured',
    incompleteHint: 'Add national, festival, or organization holidays for attendance',
  },
  {
    id: 'leave_types',
    order: 8,
    label: 'Leave Types',
    route: '/hr/leave/types',
    completeHint: 'Leave types are configured',
    incompleteHint: 'Set up paid and unpaid leave categories',
  },
  {
    id: 'leave_policies',
    order: 9,
    label: 'Leave Policies',
    route: '/hr/leave/policies',
    completeHint: 'Leave policies exist',
    incompleteHint: 'Create leave packages for employees — final setup step',
  },
];

export const DEFAULT_SETUP_PROGRESS = {
  completed: 0,
  total: SETUP_WIZARD_STEPS.length,
  percent: 0,
  allComplete: false,
};

const WIZARD_RECOMMENDATION_LABELS = {
  missing_shift: 'Assign Shift',
  missing_salary: 'Assign Salary Structure',
  missing_designation_salary: 'Set Compensation Level',
  missing_policy: 'Assign Leave Policy',
  mandatory_docs: 'Upload / Verify Documents',
  payroll_blocker: 'Fix Blockers',
  pending_leave: 'Review Leave Requests',
  pending_miss_punch: 'Review Miss Punch Requests',
  pending_document_review: 'Review Documents',
  ready_to_activate: 'Activate Employee',
  expiring_document: 'Review Expiring Documents',
  probation_review: 'Review Probation',
  review_application: 'Review Application',
  schedule_interview: 'Schedule Interview',
  pending_interview: 'Complete Interview',
  send_offer: 'Send Offer',
  pending_offer: 'Send Offer',
  pending_employee_creation: 'Create Employee',
};

const WIZARD_RECOMMENDATION_ROUTES = {
  missing_shift: '/hr/operations/shifts?filter=missing_shift',
  missing_salary: '/hr/payroll/compensation-levels',
  missing_designation_salary: '/hr/payroll/compensation-levels?filter=missing',
  missing_policy: '/hr/leave/policies',
  payroll_blocker: '/hr/employees?filter=payroll_not_eligible',
  pending_leave: '/hr/leave/requests?status=PENDING',
  pending_miss_punch: '/hr/operations/regularizations?status=pending',
  pending_document_review: '/hr/onboarding/document-verification',
  ready_to_activate: '/hr/onboarding/document-verification',
  expiring_document: '/hr/onboarding/document-verification',
  review_application: '/hr/recruitment/candidates?stage=applied',
  schedule_interview: '/hr/recruitment/candidates?stage=shortlisted',
  pending_interview: '/hr/recruitment/interviews',
  send_offer: '/hr/recruitment/offers',
  pending_offer: '/hr/recruitment/offers',
  pending_employee_creation: '/hr/onboarding/pending-documents',
};

function isRecordActive(record) {
  if (record == null) return false;
  if (record.is_active === false) return false;
  if (record.active === false) return false;
  return true;
}

function stepStatus(complete) {
  return complete ? 'complete' : 'incomplete';
}

export function isOrganizationSettingsComplete(settings = {}) {
  const hasName = Boolean(settings.organization_name?.trim());
  const hasHrSignatory = Boolean(settings.hr_name?.trim());
  const hasContact = Boolean(
    settings.company_email?.trim() || settings.company_phone?.trim(),
  );
  return hasName && hasHrSignatory && hasContact;
}

export async function fetchWizardContext() {
  const errors = [];
  const warnings = [];

  const [healthResult, journeyResult, setupSettled] = await Promise.all([
    fetchHealthContext(),
    fetchJourneyCenterCounts(),
    Promise.allSettled([
      api.get('/hr/organization-settings/current/').then((r) => r.data),
      api.get('/hr/departments/', { params: { limit: 500 } }).then((r) => r.data),
      api.get('/hr/shifts/', { params: { limit: 500 } }).then((r) => r.data),
      api.get('/hr/organization-holidays/', { params: { active: 'true', limit: 500 } }).then((r) => r.data),
      api.get('/hr/leave-types/').then((r) => r.data),
      api.get('/hr/leave-policies/').then((r) => r.data),
      api.get('/hr/designations/', { params: { active: 'true' } }).then((r) => r.data),
      payrollApi.get('/compensation-levels/', { params: { active: 'true' } }).then((r) => r.data),
      api.get('/hr/document-types/', { params: { limit: 500 } }).then((r) => r.data),
    ]),
  ]);

  errors.push(...healthResult.errors, ...journeyResult.errors);
  if (healthResult.warnings?.length) {
    warnings.push(...healthResult.warnings);
  }

  const organizationSettings = setupSettled[0].status === 'fulfilled'
    ? (setupSettled[0].value || {})
    : {};
  if (setupSettled[0].status === 'rejected') errors.push('organization settings');

  const departments = setupSettled[1].status === 'fulfilled'
    ? normalizeApiList(setupSettled[1].value)
    : [];
  if (setupSettled[1].status === 'rejected') errors.push('departments');

  const shifts = setupSettled[2].status === 'fulfilled'
    ? normalizeApiList(setupSettled[2].value)
    : [];
  if (setupSettled[2].status === 'rejected') errors.push('shifts');

  const holidaysRaw = setupSettled[3].status === 'fulfilled'
    ? normalizeApiList(setupSettled[3].value)
    : [];
  if (setupSettled[3].status === 'rejected') errors.push('holidays');

  const leaveTypes = setupSettled[4].status === 'fulfilled'
    ? normalizeApiList(setupSettled[4].value)
    : [];
  if (setupSettled[4].status === 'rejected') errors.push('leave types');

  const leavePolicies = setupSettled[5].status === 'fulfilled'
    ? normalizeApiList(setupSettled[5].value)
    : [];
  if (setupSettled[5].status === 'rejected') errors.push('leave policies');

  const designationStructures = setupSettled[7].status === 'fulfilled'
    ? normalizePayrollList(setupSettled[7].value)
    : [];
  if (setupSettled[7].status === 'rejected') errors.push('compensation levels');

  const documentTypesRaw = setupSettled[8].status === 'fulfilled'
    ? normalizeApiList(setupSettled[8].value)
    : [];
  if (setupSettled[8].status === 'rejected') errors.push('document types');

  const designationsRaw = setupSettled[6].status === 'fulfilled'
    ? normalizeApiList(setupSettled[6].value)
    : [];
  if (setupSettled[6].status === 'rejected') errors.push('designations');
  const designations = designationsRaw.filter(isRecordActive);

  const activeShifts = shifts.filter(isRecordActive);
  const activeLeaveTypes = leaveTypes.filter(isRecordActive);
  const activeHolidays = holidaysRaw.filter(isRecordActive);
  const documentTypes = documentTypesRaw.filter(isRecordActive);

  const month = healthResult.month || journeyResult.month;
  const context = {
    ...healthResult.context,
    month,
    journeyCounts: journeyResult.counts,
    organizationSettings,
    departments,
    shifts: activeShifts,
    holidays: activeHolidays,
    leaveTypes: activeLeaveTypes,
    leavePolicies,
    designations,
    designationStructures,
    documentTypes,
    employeeStructures: healthResult.context.structures || [],
    payrollRunsMonth: month,
    acceptedAwaitingEmployee: healthResult.context.onboarding?.accepted_without_employee || [],
  };

  return {
    context,
    healthCounts: healthResult.counts,
    journeyCounts: journeyResult.counts,
    errors,
    warnings,
    month,
  };
}

export function evaluateSetupSteps(context) {
  const {
    organizationSettings = {},
    departments = [],
    shifts = [],
    holidays = [],
    leaveTypes = [],
    leavePolicies = [],
    designations = [],
    designationStructures = [],
    documentTypes = [],
    employeeStructures = [],
  } = context;

  const missingSalaryDesignations = designationsMissingSalary(designations, designationStructures);
  const mandatoryDocumentTypes = documentTypes.filter((row) => row.mandatory !== false);
  const salaryStructuresComplete = designations.length > 0
    ? missingSalaryDesignations.length === 0
    : (designationStructures.length > 0 || employeeStructures.length > 0);

  const completionMap = {
    organization_settings: isOrganizationSettingsComplete(organizationSettings),
    departments: departments.length >= 1,
    shifts: shifts.length >= 1,
    holidays: holidays.length >= 1,
    leave_types: leaveTypes.length >= 1,
    leave_policies: leavePolicies.length >= 1,
    designations: designations.length >= 1,
    salary_structures: salaryStructuresComplete,
    document_types: mandatoryDocumentTypes.length >= 1,
  };

  return SETUP_WIZARD_STEPS.map((step) => {
    const complete = completionMap[step.id];
    let hint = complete ? step.completeHint : step.incompleteHint;
    if (!complete && step.id === 'salary_structures' && missingSalaryDesignations.length > 0) {
      const names = missingSalaryDesignations.map((row) => row.name).slice(0, 4);
      const extra = missingSalaryDesignations.length > names.length
        ? ` +${missingSalaryDesignations.length - names.length} more`
        : '';
      hint = `${missingSalaryDesignations.length} designation(s) need salary: ${names.join(', ')}${extra}`;
    }
    return {
      ...step,
      status: stepStatus(complete),
      hint,
      count: {
        organization_settings: isOrganizationSettingsComplete(organizationSettings) ? 1 : 0,
        departments: departments.length,
        shifts: shifts.length,
        holidays: holidays.length,
        leave_types: leaveTypes.length,
        leave_policies: leavePolicies.length,
        designations: designations.length,
        salary_structures: designations.length > 0
          ? designations.length - missingSalaryDesignations.length
          : designationStructures.length + employeeStructures.length,
        document_types: mandatoryDocumentTypes.length,
      }[step.id],
    };
  });
}

export function computeSetupProgress(steps) {
  const evaluated = (steps || []).length ? steps : [];
  const total = evaluated.length || SETUP_WIZARD_STEPS.length;
  const completed = evaluated.filter((s) => s.status === 'complete').length;
  const allComplete = total > 0 && completed === total;
  const percent = total
    ? (allComplete ? 100 : Math.round((completed / total) * 100))
    : 0;

  return {
    completed,
    total,
    percent,
    allComplete,
  };
}

export function isSetupComplete(steps) {
  const evaluated = (steps || []).filter(Boolean);
  if (!evaluated.length) return false;
  return evaluated.every((step) => step.status === 'complete');
}

export function firstIncompleteStep(steps) {
  return (steps || []).find((s) => s.status === 'incomplete') || null;
}

function clampPercent(value) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

const SETUP_READINESS_GROUPS = {
  employees: ['organization_settings', 'departments', 'designations', 'document_types'],
  attendance: ['shifts', 'holidays'],
  leave: ['leave_types', 'leave_policies'],
  payroll: ['salary_structures'],
};

function stepGroupPercent(steps, stepIds) {
  if (!steps?.length || !stepIds?.length) return 0;
  const group = steps.filter((step) => stepIds.includes(step.id));
  if (!group.length) return 0;
  const done = group.filter((step) => step.status === 'complete').length;
  return clampPercent((done / group.length) * 100);
}

function computeSetupStepReadiness(context, steps) {
  const { journeyCounts = {} } = context;
  const pipelineActivity = (Number(journeyCounts.applied) || 0)
    + (Number(journeyCounts.offer) || 0)
    + (Number(journeyCounts.kyc) || 0)
    + (Number(journeyCounts.employee_created) || 0);
  const recruitment = pipelineActivity > 0 ? 100 : 0;

  const domains = [
    { key: 'recruitment', label: 'Recruitment', percent: recruitment },
    { key: 'employees', label: 'Employees', percent: stepGroupPercent(steps, SETUP_READINESS_GROUPS.employees) },
    { key: 'attendance', label: 'Attendance', percent: stepGroupPercent(steps, SETUP_READINESS_GROUPS.attendance) },
    { key: 'leave', label: 'Leave', percent: stepGroupPercent(steps, SETUP_READINESS_GROUPS.leave) },
    { key: 'payroll', label: 'Payroll', percent: stepGroupPercent(steps, SETUP_READINESS_GROUPS.payroll) },
  ];

  const overall = clampPercent(
    domains.reduce((sum, domain) => sum + domain.percent, 0) / domains.length,
  );

  return { domains, overall };
}

function computeOperationalReadiness(context) {
  const {
    activeEmployees = [],
    structureEmployeeIds,
    leaveTypes = [],
    leavePolicies = [],
    journeyCounts = {},
    balanceEmployeeIds,
    month,
  } = context;

  const activeCount = activeEmployees.length;
  const payrollEligible = countPayrollEligible(activeEmployees, structureEmployeeIds, month);
  const missingPolicy = countMissingLeavePolicy(activeEmployees, balanceEmployeeIds || new Set());

  const pipelineActivity = (Number(journeyCounts.applied) || 0)
    + (Number(journeyCounts.offer) || 0)
    + (Number(journeyCounts.kyc) || 0)
    + (Number(journeyCounts.employee_created) || 0);
  const recruitment = pipelineActivity > 0 ? 100 : 0;

  const employees = activeCount
    ? clampPercent((payrollEligible / activeCount) * 100)
    : 0;
  const attendance = activeCount
    ? clampPercent(((Number(journeyCounts.attendance_active) || 0) / activeCount) * 100)
    : 0;

  let leave = 0;
  if (leaveTypes.length > 0) leave += 50;
  if (leavePolicies.length > 0) leave += 50;
  if (missingPolicy > 0 && activeCount > 0) {
    const penalty = clampPercent((missingPolicy / activeCount) * 50);
    leave = Math.max(0, leave - penalty);
  }

  const payroll = activeCount
    ? clampPercent((payrollEligible / activeCount) * 100)
    : 0;

  const domains = [
    { key: 'recruitment', label: 'Recruitment', percent: recruitment },
    { key: 'employees', label: 'Employees', percent: employees },
    { key: 'attendance', label: 'Attendance', percent: attendance },
    { key: 'leave', label: 'Leave', percent: leave },
    { key: 'payroll', label: 'Payroll', percent: payroll },
  ];

  const overall = clampPercent(
    domains.reduce((sum, domain) => sum + domain.percent, 0) / domains.length,
  );

  return { domains, overall };
}

export function computeHospitalReadiness(context, steps = null) {
  if (steps?.length) {
    return computeSetupStepReadiness(context, steps);
  }
  return computeOperationalReadiness(context);
}

export function summarizePayrollReadiness(context, displayLimit = 10) {
  const {
    activeEmployees = [],
    structureEmployeeIds,
    assignedEmployeeIds,
    month,
  } = context;

  const blockedEmployees = [];
  const reasonCounts = new Map();
  let readyCount = 0;

  activeEmployees.forEach((emp) => {
    const readiness = evaluatePayrollReadiness(emp, {
      structureEmployeeIds,
      assignedEmployeeIds,
      month,
    });
    if (readiness.eligible) {
      readyCount += 1;
      return;
    }

    const blockingReasons = (readiness.reasons || []).filter(
      (r) => !r.startsWith('Shift not assigned'),
    );
    blockingReasons.forEach((reason) => {
      reasonCounts.set(reason, (reasonCounts.get(reason) || 0) + 1);
    });

    blockedEmployees.push({
      employeeId: emp.id,
      employeeCode: emp.employee_id || '—',
      employeeName: emp.name || 'Employee',
      reasons: blockingReasons.length ? blockingReasons : readiness.reasons,
      actionRoute: readiness.primaryActionRoute,
      actionLabel: readiness.primaryActionLabel,
    });
  });

  const topReasons = [...reasonCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([reason, count]) => ({ reason, count }));

  return {
    readyCount,
    blockedCount: blockedEmployees.length,
    blockedEmployees: blockedEmployees.slice(0, displayLimit),
    totalBlocked: blockedEmployees.length,
    topReasons,
  };
}

export function summarizeOnboardingReadiness(context) {
  const onboarding = context.onboarding || {};
  const stats = onboarding.statistics || {};
  const acceptedAwaiting = context.acceptedAwaitingEmployee
    || onboarding.accepted_without_employee
    || [];

  const pendingDocuments = Number(stats.pending_documents) || 0;
  const pendingVerification = (Number(stats.awaiting_review) || 0)
    + (Number(stats.documents_to_review) || 0);
  const pendingEmployeeCreation = acceptedAwaiting.length
    || Math.max(0, (Number(stats.in_onboarding) || 0) - (Number(stats.ready_to_join) || 0));

  return {
    metrics: [
      {
        key: 'pending_documents',
        label: 'Candidates pending documents',
        count: pendingDocuments,
        route: '/hr/onboarding/pending-documents',
        hint: 'Waiting for candidate uploads',
      },
      {
        key: 'pending_verification',
        label: 'Pending verification',
        count: pendingVerification,
        route: '/hr/onboarding/document-verification',
        hint: 'Documents awaiting HR review',
      },
      {
        key: 'ready_to_activate',
        label: 'Ready to activate',
        count: Number(stats.ready_to_join) || 0,
        route: '/hr/onboarding/document-verification',
        hint: 'Documents approved — activate employee',
      },
      {
        key: 'pending_employee_creation',
        label: 'Pending employee creation',
        count: pendingEmployeeCreation,
        route: '/hr/onboarding/pending-documents',
        hint: 'Accepted offers not yet converted to employees',
      },
    ],
  };
}

export function buildWizardRecommendations(context, limit = 5) {
  const actionContext = prepareActionContext(context);
  const tasks = buildNextActionTasks(actionContext);
  const seen = new Set();
  const recommendations = [];

  tasks.forEach((task) => {
    if (seen.has(task.category)) return;
    seen.add(task.category);

    const route = WIZARD_RECOMMENDATION_ROUTES[task.category] || task.actionRoute;

    recommendations.push({
      id: task.category,
      category: task.category,
      label: WIZARD_RECOMMENDATION_LABELS[task.category] || task.recommendedAction,
      description: task.issue,
      route,
      priority: task.priority,
      employeeCode: task.employeeCode,
      employeeName: task.employeeName,
    });
  });

  return recommendations.slice(0, limit);
}

export function buildSetupStepsViewModel(wizardResult) {
  const steps = evaluateSetupSteps(wizardResult.context);
  return {
    steps,
    progress: computeSetupProgress(steps),
    nextStep: firstIncompleteStep(steps),
  };
}

export function buildWizardViewModel(wizardResult) {
  const setup = buildSetupStepsViewModel(wizardResult);
  const { context } = wizardResult;
  return {
    ...setup,
    readiness: computeHospitalReadiness(context, setup.steps),
    payrollSummary: summarizePayrollReadiness(context),
    onboardingSummary: summarizeOnboardingReadiness(context),
    recommendations: buildWizardRecommendations(context),
  };
}
