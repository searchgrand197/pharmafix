/**
 * HR Intelligence Center — client-side analytics from existing HR APIs.
 *
 * Queries (no backend changes):
 * - Workforce: /hr/employees/, /hr/dashboard/, /hr/offers/
 * - Hiring: /hr/candidates/pipeline_counts/, /hr/job-openings/
 * - Attendance: /hr/daily-attendance/summary/, /hr/daily-attendance/, /hr/attendance-regularizations/
 * - Leave: /hr/leave-requests/
 * - Payroll: /api/payroll/runs/?month=
 * - Compliance: /hr/documents/, /hr/onboarding-dashboard/
 * - Risk: health context + evaluatePayrollReadiness
 */

import api, { payrollApi } from '../../api';
import { localTodayString, normalizeApiList } from '../../hr/recruitmentLifecycle';
import { monthKey } from '../../utils/attendanceCalendar';
import {
  buildOfferMap,
  employeeJoinDate,
  isMandatoryDocumentIncomplete,
  parseProbationPeriodEnd,
} from './employeeJourneyUtils';
import {
  countMissingSalary,
  employeeEffectiveJoinDate,
  employeeMissingShift,
  filterActiveEmployees,
  isDocumentExpiringSoon,
} from './healthFilterUtils';
import { fetchJourneyCenterCounts } from './journeyCenterUtils';
import { formatCurrency, flattenPayrollBreakdown, monthLabel, normalizePayrollList } from './payroll/payrollUtils';
import { summarizePayrollReadiness } from './setupWizardUtils';
import { fetchHealthContext } from './systemHealthUtils';

const MEDICAL_LICENSE_PATTERN = /medical|license|registration/i;
const VERIFIED_DOC_STATUSES = new Set(['verified', 'physically_verified']);

function shiftMonthKey(month, delta) {
  if (!month || month.length < 7) return monthKey();
  const [year, mon] = month.split('-').map(Number);
  const dt = new Date(year, mon - 1 + delta, 1);
  return monthKey(dt);
}

function safePercent(numerator, denominator) {
  const den = Math.max(Number(denominator) || 0, 1);
  return Math.round((Number(numerator) || 0) / den * 100);
}

function metric(label, value, route, hint = '') {
  return { label, value, route, hint };
}

function isActiveJob(job) {
  return job?.status === 'open' && job?.is_active !== false && !job?.is_archived;
}

function isJoinDateInMonth(employee, month) {
  const join = employeeEffectiveJoinDate(employee);
  if (!join) return false;
  return String(join).slice(0, 7) === month;
}

function isOnProbation(employee, offerMap) {
  const offer = employee?.offer ? offerMap.get(String(employee.offer)) : null;
  if (!offer?.probation_period) return false;
  const join = employeeJoinDate(employee);
  const end = parseProbationPeriodEnd(join, offer.probation_period);
  if (!end) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return end > today;
}

function hasNoticePeriodInfo(employee, offerMap) {
  const offer = employee?.offer ? offerMap.get(String(employee.offer)) : null;
  return Boolean(offer?.notice_period?.trim());
}

function sumOvertimeHours(rows) {
  return (rows || []).reduce((sum, row) => {
    const hours = Number(row.overtime_hours) || 0;
    const minutes = Number(row.overtime_minutes) || 0;
    return sum + hours + minutes / 60;
  }, 0);
}

export async function fetchIntelligenceContext() {
  const errors = [];
  const warnings = [];
  const today = localTodayString();
  const month = monthKey();

  const trendMonths = [shiftMonthKey(month, -2), shiftMonthKey(month, -1), month];

  const [healthResult, journeyResult, extraSettled] = await Promise.all([
    fetchHealthContext(),
    fetchJourneyCenterCounts(),
    Promise.allSettled([
      api.get('/hr/job-openings/', { params: { status: 'all' } }).then((r) => r.data),
      api.get('/hr/candidates/pipeline_counts/').then((r) => r.data),
      api.get('/hr/leave-requests/', { params: { limit: 1000 } }).then((r) => r.data),
      api.get('/hr/daily-attendance/summary/', { params: { date: today } }).then((r) => r.data),
      api.get('/hr/daily-attendance/', { params: { date: today, limit: 1000 } }).then((r) => r.data),
      ...trendMonths.map((m) => payrollApi.get('/runs/', { params: { month: m } }).then((r) => r.data)),
    ]),
  ]);

  errors.push(...healthResult.errors, ...journeyResult.errors);
  if (healthResult.warnings?.length) warnings.push(...healthResult.warnings);

  const jobs = extraSettled[0].status === 'fulfilled'
    ? normalizeApiList(extraSettled[0].value)
    : [];
  if (extraSettled[0].status === 'rejected') errors.push('job openings');

  const pipelineCounts = extraSettled[1].status === 'fulfilled' ? extraSettled[1].value : {};
  if (extraSettled[1].status === 'rejected') errors.push('pipeline counts');

  const leaveRequests = extraSettled[2].status === 'fulfilled'
    ? normalizeApiList(extraSettled[2].value)
    : [];
  if (extraSettled[2].status === 'rejected') errors.push('leave requests');
  if (leaveRequests.length >= 1000) warnings.push('leave request list may be truncated at 1000 rows');

  const attendanceSummary = extraSettled[3].status === 'fulfilled' ? extraSettled[3].value : {};
  if (extraSettled[3].status === 'rejected') errors.push('attendance summary');

  const dailyAttendance = extraSettled[4].status === 'fulfilled'
    ? normalizeApiList(extraSettled[4].value)
    : [];
  if (extraSettled[4].status === 'rejected') errors.push('daily attendance');
  if (dailyAttendance.length >= 1000) warnings.push('daily attendance list may be truncated at 1000 rows');

  const payrollRunsByMonth = {};
  trendMonths.forEach((m, idx) => {
    const settled = extraSettled[5 + idx];
    payrollRunsByMonth[m] = settled?.status === 'fulfilled'
      ? normalizePayrollList(settled.value)
      : [];
    if (settled?.status === 'rejected') errors.push(`payroll runs (${m})`);
  });

  const context = {
    ...healthResult.context,
    month,
    today,
    journeyCounts: journeyResult.counts,
    jobs,
    pipelineCounts,
    leaveRequests,
    attendanceSummary,
    dailyAttendance,
    payrollRunsByMonth,
    payrollRunsCurrent: payrollRunsByMonth[month] || [],
    offerMap: buildOfferMap(healthResult.context.offers || []),
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

export function computeWorkforceAnalytics(context) {
  const {
    employees = [],
    activeEmployees = [],
    offerMap = new Map(),
    month,
  } = context;

  const onProbation = activeEmployees.filter((emp) => isOnProbation(emp, offerMap)).length;
  const noticePeriodInfo = activeEmployees.filter((emp) => hasNoticePeriodInfo(emp, offerMap)).length;
  const newJoiners = activeEmployees.filter((emp) => isJoinDateInMonth(emp, month)).length;
  const resigned = employees.filter((emp) => emp.status === 'terminated').length;
  const inactive = employees.filter((emp) => emp.status === 'inactive').length;

  return {
    metrics: [
      metric('Total employees', employees.length, '/hr/employees'),
      metric('Active employees', activeEmployees.length, '/hr/employees'),
      metric('On probation', onProbation, '/hr/employees', 'Derived from offer probation period + join date'),
      metric(
        'Notice period',
        noticePeriodInfo || '—',
        '/hr/employees',
        noticePeriodInfo ? 'Offer notice period on file (informational)' : 'Not tracked on employee exit workflow',
      ),
      metric('New joiners', newJoiners, '/hr/employees/create', `Joined in ${month}`),
      metric('Resigned', resigned, '/hr/employees', inactive ? `${inactive} inactive` : ''),
    ],
  };
}

export function computeHiringAnalytics(context) {
  const { jobs = [], pipelineCounts = {} } = context;

  const jobsOpen = jobs.filter(isActiveJob).length;
  const applied = Number(pipelineCounts.applied) || 0;
  const shortlisted = Number(pipelineCounts.shortlisted) || 0;
  const interviewed = Number(pipelineCounts.interviews) || 0;
  const offers = Number(pipelineCounts.offer_sent) || 0;
  const joined = Number(pipelineCounts.hired) || 0;

  const conversions = [
    {
      label: 'Applied → Shortlisted',
      percent: safePercent(shortlisted, applied),
      route: '/hr/recruitment/candidates',
    },
    {
      label: 'Shortlisted → Interview',
      percent: safePercent(interviewed, shortlisted),
      route: '/hr/recruitment/interviews',
    },
    {
      label: 'Interview → Offer',
      percent: safePercent(offers, interviewed),
      route: '/hr/recruitment/offers',
    },
    {
      label: 'Offer → Joined',
      percent: safePercent(joined, offers),
      route: '/hr/onboarding/pending-documents',
    },
  ];

  return {
    metrics: [
      metric('Jobs open', jobsOpen, '/hr/recruitment/jobs'),
      metric('Applied', applied, '/hr/recruitment/candidates'),
      metric('Shortlisted', shortlisted, '/hr/recruitment/candidates'),
      metric('Interviewed', interviewed, '/hr/recruitment/interviews'),
      metric('Offers', offers, '/hr/recruitment/offers'),
      metric('Joined', joined, '/hr/onboarding/pending-documents'),
    ],
    conversions,
  };
}

export function computeAttendanceAnalytics(context) {
  const {
    attendanceSummary = {},
    dailyAttendance = [],
    regularizations = [],
  } = context;

  const scheduled = Number(attendanceSummary.scheduled_employees) || 0;
  const present = Number(attendanceSummary.present_today) || 0;
  const late = Number(attendanceSummary.late_employees) || 0;
  const absent = Number(attendanceSummary.absent_today) || 0;
  const missPunch = regularizations.length;
  let overtimeHours = sumOvertimeHours(dailyAttendance);
  if (overtimeHours === 0 && Number(attendanceSummary.overtime_employees) > 0) {
    overtimeHours = Number(attendanceSummary.overtime_employees);
  }

  const attendancePercent = safePercent(present, scheduled);

  return {
    metrics: [
      metric('Attendance %', `${attendancePercent}%`, '/hr/operations/attendance', `${present} present of ${scheduled} scheduled`),
      metric('Late employees', late, '/hr/operations/attendance'),
      metric('Absent today', absent, '/hr/operations/attendance'),
      metric('Miss punch pending', missPunch, '/hr/operations/regularizations?status=pending'),
      metric('Overtime hours', overtimeHours.toFixed(1), '/hr/operations/punch-logs', 'Today\'s recorded overtime'),
    ],
    attendancePercent,
  };
}

export function computeLeaveAnalytics(context) {
  const { leaveRequests = [], employees = [] } = context;
  const employeeById = new Map(employees.map((e) => [String(e.id), e]));

  const pending = leaveRequests.filter((r) => r.status === 'PENDING').length;
  const approved = leaveRequests.filter((r) => r.status === 'APPROVED').length;
  const rejected = leaveRequests.filter((r) => r.status === 'REJECTED').length;

  const approvedByEmployee = new Map();
  leaveRequests.filter((r) => r.status === 'APPROVED').forEach((req) => {
    const key = String(req.employee);
    const existing = approvedByEmployee.get(key) || {
      employeeId: req.employee,
      name: req.employee_name || employeeById.get(key)?.name || 'Employee',
      code: req.employee_id_display || req.employee_id || employeeById.get(key)?.employee_id || '—',
      count: 0,
      days: 0,
    };
    existing.count += 1;
    existing.days += Number(req.total_days || req.days || 0);
    approvedByEmployee.set(key, existing);
  });

  const topLeaveUsers = [...approvedByEmployee.values()]
    .sort((a, b) => b.count - a.count || b.days - a.days)
    .slice(0, 5);

  const deptUsage = new Map();
  leaveRequests.filter((r) => r.status === 'APPROVED').forEach((req) => {
    const emp = employeeById.get(String(req.employee));
    const dept = req.employee_department || emp?.department || 'Unassigned';
    deptUsage.set(dept, (deptUsage.get(dept) || 0) + 1);
  });

  const topDepartments = [...deptUsage.entries()]
    .map(([department, count]) => ({ department, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  return {
    metrics: [
      metric('Pending', pending, '/hr/leave/requests?status=PENDING'),
      metric('Approved', approved, '/hr/leave/requests?status=APPROVED'),
      metric('Rejected', rejected, '/hr/leave/requests?status=REJECTED'),
    ],
    topLeaveUsers,
    topDepartments,
  };
}

export function computePayrollAnalytics(context) {
  const { payrollRunsByMonth = {}, payrollRunsCurrent = [], month } = context;

  const payrollCost = payrollRunsCurrent.reduce(
    (sum, row) => sum + Number(row.final_salary || 0),
    0,
  );
  const averageSalary = payrollRunsCurrent.length
    ? payrollCost / payrollRunsCurrent.length
    : 0;

  const trend = Object.entries(payrollRunsByMonth)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([m, runs]) => ({
      month: m,
      label: monthLabel(m),
      total: runs.reduce((sum, row) => sum + Number(row.final_salary || 0), 0),
      count: runs.length,
      route: `/hr/payroll/runs`,
    }));

  let overtimeCost = 0;
  const deductionTotals = new Map();

  payrollRunsCurrent.forEach((run) => {
    const earnings = run.earnings_breakdown || {};
    overtimeCost += Number(earnings.overtime || 0);

    const breakdown = run.deductions_breakdown || run.deductions || {};
    flattenPayrollBreakdown(breakdown).forEach(([key, value]) => {
      const label = String(key);
      deductionTotals.set(label, (deductionTotals.get(label) || 0) + Number(value || 0));
    });
    if (Number(run.total_deductions) > 0 && deductionTotals.size === 0) {
      deductionTotals.set('Total deductions', Number(run.total_deductions));
    }
  });

  const deductionBreakdown = [...deductionTotals.entries()]
    .map(([label, amount]) => ({ label, amount }))
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 8);

  return {
    metrics: [
      metric('Payroll cost', formatCurrency(payrollCost), '/hr/payroll/runs', monthLabel(month)),
      metric('Average salary', formatCurrency(averageSalary), '/hr/payroll/runs'),
      metric('Overtime cost', formatCurrency(overtimeCost), '/hr/payroll/runs'),
    ],
    trend,
    deductionBreakdown,
    payrollCost,
  };
}

export function computeComplianceAnalytics(context) {
  const { documents = [], onboarding = {} } = context;
  const stats = onboarding.statistics || {};

  const expiring = documents.filter((doc) => isDocumentExpiringSoon(doc.expires_at)).length;
  const medicalExpiring = documents.filter(
    (doc) => isDocumentExpiringSoon(doc.expires_at)
      && MEDICAL_LICENSE_PATTERN.test(doc.document_type_name || doc.document_type || ''),
  ).length;

  const missingMandatory = documents.filter((doc) => isMandatoryDocumentIncomplete(doc)).length;
  const missingDocuments = (Number(stats.pending_documents) || 0) + missingMandatory;
  const pendingVerification = (Number(stats.awaiting_review) || 0)
    + (Number(stats.documents_to_review) || 0);

  return {
    metrics: [
      metric('Documents expiring', expiring, '/hr/onboarding/document-verification'),
      metric(
        'Medical licenses expiring',
        medicalExpiring,
        '/hr/onboarding/document-verification',
        'Matched by document type name',
      ),
      metric('Missing documents', missingDocuments, '/hr/onboarding/pending-documents'),
      metric('Pending verification', pendingVerification, '/hr/onboarding/document-verification'),
    ],
  };
}

export function computePayrollRiskAnalytics(context) {
  const {
    activeEmployees = [],
    structureEmployeeIds,
    assignedEmployeeIds,
    dailyAttendance = [],
    leaveRequests = [],
  } = context;

  const missingSalary = countMissingSalary(activeEmployees, structureEmployeeIds);
  const attendanceEmployeeIds = new Set(
    dailyAttendance.map((row) => String(row.employee)).filter(Boolean),
  );
  const missingAttendance = activeEmployees.filter((emp) => {
    const hasShift = !employeeMissingShift(emp, assignedEmployeeIds);
    return hasShift && !attendanceEmployeeIds.has(String(emp.id));
  }).length;

  const pendingLeave = leaveRequests.filter((r) => r.status === 'PENDING').length;
  const payrollSummary = summarizePayrollReadiness(context);

  return {
    metrics: [
      metric('Missing salary structure', missingSalary, '/hr/employees?filter=missing_salary'),
      metric('Missing attendance', missingAttendance, '/hr/operations/attendance', 'Scheduled employees with no row today'),
      metric('Pending leave impact', pendingLeave, '/hr/leave/requests?status=PENDING'),
      metric('Blocked employees', payrollSummary.blockedCount, '/hr/employees?filter=payroll_not_eligible'),
    ],
    topBlockReasons: payrollSummary.topReasons,
  };
}

export function computeCeoKpis(context, sections = {}) {
  const { activeEmployees = [], attendanceSummary = {}, pipelineCounts = {} } = context;
  const attendance = sections.attendance || computeAttendanceAnalytics(context);
  const payroll = sections.payroll || computePayrollAnalytics(context);

  const scheduled = Number(attendanceSummary.scheduled_employees) || 0;
  const onLeave = Number(attendanceSummary.on_leave_today) || 0;
  const applied = Number(pipelineCounts.applied) || 0;
  const hired = Number(pipelineCounts.hired) || 0;

  return [
    {
      key: 'employees',
      label: 'Employee count',
      value: activeEmployees.length,
      route: '/hr/employees',
    },
    {
      key: 'attendance',
      label: 'Attendance %',
      value: `${attendance.attendancePercent ?? 0}%`,
      route: '/hr/operations/attendance',
    },
    {
      key: 'payroll',
      label: 'Payroll cost',
      value: formatCurrency(payroll.payrollCost || 0),
      route: '/hr/payroll/runs',
    },
    {
      key: 'hiring',
      label: 'Hiring rate',
      value: `${safePercent(hired, applied)}%`,
      route: '/hr/recruitment/candidates',
      hint: 'Joined / applied',
    },
    {
      key: 'leave',
      label: 'Leave %',
      value: `${safePercent(onLeave, scheduled)}%`,
      route: '/hr/leave/requests',
      hint: 'On leave today',
    },
  ];
}

/** Lightweight CEO KPI preview from Journey Center counts (no extra API calls). */
export function computeJourneyCenterIntelPreview(journeyCounts = {}, healthCounts = {}) {
  const active = Number(journeyCounts.employee_created) || Number(healthCounts.payroll_eligible) || 0;
  const scheduled = Number(journeyCounts.attendance_active) || 1;
  const present = Math.max(0, scheduled - (Number(healthCounts.missing_shift) || 0));
  const attendancePercent = safePercent(present, scheduled);

  return [
    { label: 'Active workforce', value: active },
    { label: 'Attendance signal', value: `${attendancePercent}%` },
    { label: 'Payroll eligible', value: Number(healthCounts.payroll_eligible) || 0 },
  ];
}

export function buildIntelligenceViewModel(intelResult) {
  const { context } = intelResult;
  const workforce = computeWorkforceAnalytics(context);
  const hiring = computeHiringAnalytics(context);
  const attendance = computeAttendanceAnalytics(context);
  const leave = computeLeaveAnalytics(context);
  const payroll = computePayrollAnalytics(context);
  const compliance = computeComplianceAnalytics(context);
  const payrollRisk = computePayrollRiskAnalytics(context);
  const ceoKpis = computeCeoKpis(context, { attendance, payroll });

  return {
    workforce,
    hiring,
    attendance,
    leave,
    payroll,
    compliance,
    payrollRisk,
    ceoKpis,
  };
}
