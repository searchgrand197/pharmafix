import api, { payrollApi } from '../../api';
import { isRecruitmentStageCandidate, localTodayString, normalizeApiList } from '../../hr/recruitmentLifecycle';
import { monthKey } from '../../utils/attendanceCalendar';
import { normalizePayrollList } from './payroll/payrollUtils';
import {
  buildAssignedEmployeeIds,
  buildPayrollReadyEmployeeIds,
  buildStructureEmployeeIds,
  countMissingLeavePolicy,
  countMissingSalary,
  countMissingShift,
  countDesignationsMissingSalary,
  countPayrollEligible,
  filterActiveEmployees,
  isDocumentExpiringSoon,
} from './healthFilterUtils';

export const SYSTEM_HEALTH_CHECKS = [
  {
    id: 'missing_salary',
    label: 'Employees Missing Salary Structure',
    countKey: 'missing_salary',
    route: '/hr/employees',
    filterQuery: 'filter=missing_salary',
    severity: 'problem',
  },
  {
    id: 'missing_designation_salary',
    label: 'Designations Missing Compensation Level',
    countKey: 'missing_designation_salary',
    route: '/hr/payroll/compensation-levels',
    filterQuery: 'filter=missing',
    severity: 'problem',
  },
  {
    id: 'missing_shift',
    label: 'Employees Missing Shift',
    countKey: 'missing_shift',
    route: '/hr/operations/shifts',
    filterQuery: 'filter=missing_shift',
    severity: 'problem',
  },
  {
    id: 'missing_policy',
    label: 'Employees Missing Leave Policy',
    countKey: 'missing_policy',
    route: '/hr/leave/balances',
    filterQuery: 'filter=missing_policy',
    severity: 'problem',
  },
  {
    id: 'pending_leave',
    label: 'Pending Leave Requests',
    countKey: 'pending_leave',
    route: '/hr/leave/requests',
    filterQuery: 'status=PENDING',
    severity: 'problem',
  },
  {
    id: 'pending_miss_punch',
    label: 'Pending Miss Punch Requests',
    countKey: 'pending_miss_punch',
    route: '/hr/operations/regularizations',
    filterQuery: 'status=pending',
    severity: 'problem',
  },
  {
    id: 'pending_documents',
    label: 'Pending Document Requests',
    countKey: 'pending_documents',
    route: '/hr/onboarding/document-verification',
    filterQuery: '',
    severity: 'problem',
  },
  {
    id: 'ready_to_activate',
    label: 'Ready to Activate',
    countKey: 'ready_to_activate',
    route: '/hr/onboarding/document-verification',
    filterQuery: '',
    severity: 'problem',
  },
  {
    id: 'expiring_documents',
    label: 'Expiring Documents',
    countKey: 'expiring_documents',
    route: '/hr/onboarding/document-verification',
    filterQuery: '',
    severity: 'problem',
  },
  {
    id: 'payroll_eligible',
    label: 'Payroll Eligible Employees',
    countKey: 'payroll_eligible',
    route: '/hr/employees',
    filterQuery: 'filter=payroll_eligible',
    severity: 'positive',
  },
  {
    id: 'payroll_not_eligible',
    label: 'Employees Not Payroll Eligible',
    countKey: 'payroll_not_eligible',
    route: '/hr/employees',
    filterQuery: 'filter=payroll_not_eligible',
    severity: 'problem',
  },
];

const HEALTH_COLORS = {
  green: { border: '#22c55e', bg: '#22c55e18', text: '#15803d' },
  yellow: { border: '#eab308', bg: '#eab30818', text: '#a16207' },
  red: { border: '#ef4444', bg: '#ef444418', text: '#b91c1c' },
};

export function buildHealthLink(check) {
  if (!check.filterQuery) return check.route;
  return `${check.route}?${check.filterQuery}`;
}

export function healthCardColor(count, check) {
  const value = Number(count) || 0;
  if (check.severity === 'positive') {
    return HEALTH_COLORS.green;
  }
  if (value === 0) return HEALTH_COLORS.green;
  if (value <= 2) return HEALTH_COLORS.yellow;
  return HEALTH_COLORS.red;
}

function computeHealthCounts(context) {
  const {
    activeEmployees,
    structureEmployeeIds,
    assignedEmployeeIds,
    balanceEmployeeIds,
    leaveRequests,
    regularizations,
    onboarding,
    documents,
    designations,
    designationStructures,
    month,
  } = context;

  const stats = onboarding.statistics || {};
  const payrollEligible = countPayrollEligible(activeEmployees, structureEmployeeIds, month);

  return {
    missing_salary: countMissingSalary(activeEmployees, structureEmployeeIds),
    missing_designation_salary: countDesignationsMissingSalary(
      designations,
      designationStructures,
    ),
    missing_shift: countMissingShift(activeEmployees, assignedEmployeeIds),
    missing_policy: countMissingLeavePolicy(activeEmployees, balanceEmployeeIds),
    pending_leave: leaveRequests.length,
    pending_miss_punch: regularizations.length,
    pending_documents:
      (Number(stats.documents_to_review) || 0) + (Number(stats.reupload_requests) || 0),
    ready_to_activate: Number(stats.ready_to_join) || 0,
    expiring_documents: documents.filter((doc) => isDocumentExpiringSoon(doc.expires_at)).length,
    payroll_eligible: payrollEligible,
    payroll_not_eligible: Math.max(0, activeEmployees.length - payrollEligible),
  };
}

export async function fetchHealthContext() {
  const month = monthKey();
  const errors = [];
  const warnings = [];

  const settled = await Promise.allSettled([
    api.get('/hr/employees/', { params: { limit: 500 } }).then((r) => r.data),
    payrollApi.get('/structures/', { params: { active: 'true' } }).then((r) => r.data),
    api.get('/hr/employee-shifts/', { params: { limit: 1000, is_primary: true } }).then((r) => r.data),
    api.get('/hr/leave-balances/', { params: { limit: 1000 } }).then((r) => r.data),
    api.get('/hr/leave-requests/', { params: { status: 'PENDING', limit: 500 } }).then((r) => r.data),
    api.get('/hr/attendance-regularizations/', { params: { status: 'pending', limit: 500 } }).then((r) => r.data),
    api.get('/hr/onboarding-dashboard/').then((r) => r.data),
    api.get('/hr/documents/', { params: { limit: 1000 } }).then((r) => r.data),
    api.get('/hr/offers/', { params: { limit: 500 } }).then((r) => r.data),
    api.get('/hr/candidates/', { params: { limit: 1000 } }).then((r) => r.data),
    payrollApi.get('/compensation-assignments/', { params: { active: 'true', limit: 1000 } }).then((r) => r.data),
    api.get('/hr/offer-builder-v2/', { params: { limit: 500 } }).then((r) => r.data),
    api.get('/hr/designations/', { params: { active: 'true' } }).then((r) => r.data),
    payrollApi.get('/compensation-levels/', { params: { active: 'true' } }).then((r) => r.data),
    api.get('/hr/payroll-month-readiness/', { params: { month } }).then((r) => r.data),
    payrollApi.get('/runs/', { params: { month } }).then((r) => r.data),
    api.get('/hr/dashboard/command-center-counts/', { params: { month } }).then((r) => r.data),
    api.get('/hr/daily-attendance/summary/', { params: { date: localTodayString() } }).then((r) => r.data),
    api.get('/hr/job-openings/', { params: { status: 'all' } }).then((r) => r.data),
  ]);

  const employees = settled[0].status === 'fulfilled' ? normalizeApiList(settled[0].value) : [];
  if (settled[0].status === 'rejected') errors.push('employees');

  const structures = settled[1].status === 'fulfilled' ? normalizePayrollList(settled[1].value) : [];
  if (settled[1].status === 'rejected') errors.push('salary structures');

  const assignments = settled[2].status === 'fulfilled' ? normalizeApiList(settled[2].value) : [];
  if (settled[2].status === 'rejected') errors.push('shift assignments');

  const balances = settled[3].status === 'fulfilled' ? normalizeApiList(settled[3].value) : [];
  if (settled[3].status === 'rejected') errors.push('leave balances');

  const leaveRequests = settled[4].status === 'fulfilled' ? normalizeApiList(settled[4].value) : [];
  if (settled[4].status === 'rejected') errors.push('leave requests');

  const regularizations = settled[5].status === 'fulfilled' ? normalizeApiList(settled[5].value) : [];
  if (settled[5].status === 'rejected') errors.push('regularizations');

  const onboarding = settled[6].status === 'fulfilled' ? settled[6].value : {};
  if (settled[6].status === 'rejected') errors.push('onboarding');

  const documents = settled[7].status === 'fulfilled' ? normalizeApiList(settled[7].value) : [];
  if (settled[7].status === 'rejected') errors.push('documents');
  if (documents.length >= 1000) {
    warnings.push('document list may be truncated at 1000 rows');
  }

  const offers = settled[8].status === 'fulfilled' ? normalizeApiList(settled[8].value) : [];
  if (settled[8].status === 'rejected') errors.push('offers');

  const candidatesRaw = settled[9].status === 'fulfilled' ? normalizeApiList(settled[9].value) : [];
  if (settled[9].status === 'rejected') errors.push('candidates');
  const candidates = candidatesRaw.filter(isRecruitmentStageCandidate);

  const salaryAssignments = settled[10].status === 'fulfilled'
    ? normalizePayrollList(settled[10].value)
    : [];
  if (settled[10].status === 'rejected') errors.push('compensation assignments');

  const offerBuilders = settled[11].status === 'fulfilled'
    ? normalizeApiList(settled[11].value)
    : [];
  if (settled[11].status === 'rejected') errors.push('offer builder drafts');

  const designations = settled[12].status === 'fulfilled'
    ? normalizeApiList(settled[12].value)
    : [];
  if (settled[12].status === 'rejected') errors.push('designations');

  const designationStructures = settled[13].status === 'fulfilled'
    ? normalizePayrollList(settled[13].value)
    : [];
  if (settled[13].status === 'rejected') errors.push('compensation levels');

  const payrollMonthReadiness = settled[14].status === 'fulfilled'
    ? (settled[14].value || {})
    : { month, next_action: 'none' };
  if (settled[14].status === 'rejected') errors.push('payroll month readiness');

  const payrollRuns = settled[15].status === 'fulfilled'
    ? normalizePayrollList(settled[15].value)
    : [];
  if (settled[15].status === 'rejected') errors.push('payroll runs');

  const commandCenterCounts = settled[16].status === 'fulfilled'
    ? (settled[16].value || {})
    : {};
  if (settled[16].status === 'rejected') errors.push('command center counts');

  const attendanceSummary = settled[17].status === 'fulfilled'
    ? (settled[17].value || {})
    : {};
  if (settled[17].status === 'rejected') errors.push('attendance summary');

  const jobsRaw = settled[18].status === 'fulfilled'
    ? normalizeApiList(settled[18].value)
    : [];
  if (settled[18].status === 'rejected') errors.push('job openings');

  const activeEmployees = filterActiveEmployees(employees);
  const structureEmployeeIds = buildPayrollReadyEmployeeIds(structures, salaryAssignments);
  const assignedEmployeeIds = buildAssignedEmployeeIds(assignments);
  const balanceEmployeeIds = new Set(
    balances.map((row) => String(row.employee)).filter(Boolean),
  );

  const context = {
    month,
    employees,
    activeEmployees,
    structures,
    salaryAssignments,
    assignments,
    balances,
    leaveRequests,
    regularizations,
    onboarding,
    documents,
    offers,
    offerBuilders,
    candidates,
    designations,
    designationStructures,
    payrollMonthReadiness,
    payrollRuns,
    commandCenterCounts,
    attendanceSummary,
    jobs: jobsRaw,
    structureEmployeeIds,
    assignedEmployeeIds,
    balanceEmployeeIds,
  };

  return {
    context,
    counts: computeHealthCounts(context),
    errors,
    warnings,
    month,
  };
}

export async function fetchSystemHealthCounts() {
  const { counts, errors, warnings, month } = await fetchHealthContext();
  return { counts, errors, warnings, month };
}
