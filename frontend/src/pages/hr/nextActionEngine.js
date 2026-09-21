import {
  buildAssignedEmployeeIds,
  buildPayrollReadyEmployeeIds,
  buildStructureEmployeeIds,
  designationsMissingSalary,
  employeeHasSalaryStructure,
  employeeMissingShift,
  employeeSalaryActionLabel,
  employeeSalaryActionRoute,
  employeeSalaryIssueText,
  employeeSalaryRecommendedAction,
  filterActiveEmployees,
  isDocumentExpiringSoon,
} from './healthFilterUtils';
import {
  buildOfferMap,
  employeeFromRow,
  employeeJoinDate,
  evaluatePayrollReadiness,
  isMandatoryDocumentIncomplete,
  isProbationEndingSoon,
} from './employeeJourneyUtils';
import { localTodayString } from '../../hr/recruitmentLifecycle';
import { interviewIsoToCalendarDate, todayISODate } from '../../utils/interviewDateTime';
import {
  OFFER_UNSENT_STATUSES,
  builderMarkedSent,
  candidateKey,
  candidateNeedsOfferLetter,
  candidateRecruitmentSubtitle,
  offerBuilderRoute,
} from './recruitmentOfferUtils';
import { buildOnboardingEmployeeTasks } from './onboardingTaskUtils';
import { buildPayrollMonthTasks } from './payrollMonthTaskUtils';

export const PRIORITY_ORDER = { critical: 0, medium: 1, low: 2 };

const ONBOARDING_DOCUMENT_CATEGORIES = new Set([
  'ready_to_activate',
  'pending_document_review',
  'onboarding_waiting_docs',
  'mandatory_docs',
  'delayed_joiner',
  'expired_document',
  'expiring_document',
]);

const ONBOARDING_DOCUMENT_CATEGORY_ORDER = {
  ready_to_activate: 0,
  pending_document_review: 1,
  delayed_joiner: 2,
  expired_document: 3,
  mandatory_docs: 4,
  onboarding_waiting_docs: 5,
  expiring_document: 6,
};

function safeString(value) {
  if (value === null || value === undefined) return '';
  return String(value);
}

function chooseBetterTask(current, candidate) {
  if (!current) return candidate;
  const p = (PRIORITY_ORDER[candidate.priority] ?? 99) - (PRIORITY_ORDER[current.priority] ?? 99);
  if (p < 0) return candidate;
  if (p > 0) return current;

  const co = ONBOARDING_DOCUMENT_CATEGORY_ORDER[candidate.category] ?? 99;
  const cu = ONBOARDING_DOCUMENT_CATEGORY_ORDER[current.category] ?? 99;
  if (co < cu) return candidate;
  if (co > cu) return current;

  const dueC = safeString(candidate.dueDate);
  const dueU = safeString(current.dueDate);
  if (dueC && dueU && dueC < dueU) return candidate;
  if (dueC && !dueU) return candidate;
  return current;
}

function dedupeTasks(rawTasks = []) {
  const uniqueById = new Map();
  (rawTasks || []).forEach((t) => {
    if (!t || !t.id) return;
    if (!uniqueById.has(t.id)) uniqueById.set(t.id, t);
  });
  const tasks = [...uniqueById.values()];

  const collapsed = [];
  const bestDocTaskByEmployee = new Map();

  tasks.forEach((task) => {
    const employeeId = safeString(task.employeeId);
    const shouldCollapse = employeeId && ONBOARDING_DOCUMENT_CATEGORIES.has(task.category);
    if (!shouldCollapse) {
      collapsed.push(task);
      return;
    }
    const key = employeeId;
    const current = bestDocTaskByEmployee.get(key);
    bestDocTaskByEmployee.set(key, chooseBetterTask(current, task));
  });

  bestDocTaskByEmployee.forEach((t) => collapsed.push(t));
  return collapsed;
}

export function groupTasksByUrgency(tasks = []) {
  const important = (tasks || []).filter((t) => t.priority === 'critical' || t.priority === 'medium');
  const upcoming = (tasks || []).filter((t) => t.priority === 'low');
  return { important, upcoming };
}

function taskBase(employee, fields) {
  return {
    employeeId: employee?.id || fields.employeeId || '',
    employeeCode: employee?.employee_id || fields.employeeCode || '—',
    employeeName: employee?.name || fields.employeeName || 'Unknown',
    ...fields,
  };
}

function candidateAlreadyHiredOrLinked(candidate) {
  if (!candidate) return false;
  if (candidate.status === 'hired') return true;
  if (candidate.employee_record) return true;
  return false;
}

function isUpcomingJoinerNeedingAction(emp, today, weekAhead) {
  if (!emp.joining_date) return false;
  const joinDay = String(emp.joining_date).split('T')[0];
  if (joinDay < today || joinDay > weekAhead) return false;
  if (emp.status === 'terminated' || emp.status === 'inactive') return false;
  if (
    emp.status === 'active'
    && (emp.onboarding_status === 'onboarded' || emp.onboarding_completed === true)
  ) {
    return false;
  }
  return true;
}

function buildRecruitmentTasks(context) {
  const tasks = [];
  const { candidates = [], offers = [], offerBuilders = [] } = context;

  (candidates || []).forEach((c) => {
    const name = c.name || 'Candidate';
    const code = c.email || name;
    const subjectSubtitle = candidateRecruitmentSubtitle(c);

    if (c.status === 'applied') {
      tasks.push(taskBase(null, {
        id: `review_application:${c.id}`,
        employeeId: c.id,
        employeeCode: code,
        employeeName: name,
        subjectType: 'candidate',
        subjectSubtitle,
        priority: 'medium',
        category: 'review_application',
        issue: 'New application to review',
        recommendedAction: 'Review candidate profile',
        actionLabel: 'Review',
        actionRoute: `/hr/candidates/${c.id}`,
      }));
    }

    if (c.status === 'shortlisted' && !c.interview_date) {
      tasks.push(taskBase(null, {
        id: `schedule_interview:${c.id}`,
        employeeId: c.id,
        employeeCode: code,
        employeeName: name,
        subjectType: 'candidate',
        subjectSubtitle,
        priority: 'medium',
        category: 'schedule_interview',
        issue: 'Interview not scheduled',
        recommendedAction: 'Schedule interview for shortlisted candidate',
        actionLabel: 'Schedule',
        actionRoute: `/hr/candidates/${c.id}`,
      }));
    }

    const interviewPending = c.status === 'interview'
      || (c.interview_date && c.interview_status === 'pending');
    if (interviewPending) {
      const interviewDay = c.interview_date ? interviewIsoToCalendarDate(c.interview_date) : null;
      const isToday = interviewDay === todayISODate();
      tasks.push(taskBase(null, {
        id: `pending_interview:${c.id}`,
        employeeId: c.id,
        employeeCode: code,
        employeeName: name,
        subjectType: 'candidate',
        subjectSubtitle,
        priority: isToday ? 'critical' : 'medium',
        category: 'pending_interview',
        issue: isToday ? 'Interview scheduled today' : 'Interview pending completion',
        recommendedAction: isToday ? 'Conduct or update interview status' : 'Follow up on scheduled interview',
        actionLabel: 'Open interview',
        actionRoute: `/hr/candidates/${c.id}`,
      }));
    }

    if (!candidateAlreadyHiredOrLinked(c) && candidateNeedsOfferLetter(c, offers, offerBuilders)) {
      tasks.push(taskBase(null, {
        id: `send_offer:${c.id}`,
        employeeId: c.id,
        employeeCode: code,
        employeeName: name,
        subjectType: 'candidate',
        subjectSubtitle,
        priority: 'medium',
        category: 'send_offer',
        issue: 'Selected — offer not sent',
        recommendedAction: 'Create and send offer letter',
        actionLabel: 'Create offer',
        actionRoute: offerBuilderRoute(c.id, offerBuilders),
      }));
    }
  });

  const pendingOfferCandidateIds = new Set();
  (offers || []).forEach((o) => {
    if (!OFFER_UNSENT_STATUSES.has(o.status)) return;
    const candidateId = candidateKey(o.candidate);
    if (!candidateId || pendingOfferCandidateIds.has(candidateId)) return;
    if (builderMarkedSent(offerBuilders, candidateId)) return;
    const matchedCandidate = (candidates || []).find((c) => String(c.id) === candidateId);
    if (candidateAlreadyHiredOrLinked(matchedCandidate)) return;
    pendingOfferCandidateIds.add(candidateId);
    const name = o.candidate_name || 'Candidate';
    tasks.push(taskBase(null, {
      id: `pending_offer:${o.id}`,
      employeeId: candidateId,
      employeeCode: name,
      employeeName: name,
      subjectType: 'candidate',
      subjectSubtitle: matchedCandidate
        ? candidateRecruitmentSubtitle(matchedCandidate)
        : 'Candidate',
      priority: 'medium',
      category: 'pending_offer',
      issue: o.status === 'draft' ? 'Offer draft not sent' : 'Offer created — send to candidate',
      recommendedAction: 'Review and send offer letter',
      actionLabel: 'Send offer',
      actionRoute: offerBuilderRoute(candidateId, offerBuilders, o.id),
    }));
  });

  return tasks;
}

function buildDesignationSalaryTasks(context) {
  const { designations = [], designationStructures = [] } = context;
  const tasks = [];

  designationsMissingSalary(designations, designationStructures).forEach((designation) => {
    tasks.push(taskBase(null, {
      id: `missing_designation_salary:${designation.id}`,
      employeeId: designation.id,
      employeeCode: designation.name,
      employeeName: designation.name,
      subjectType: 'designation',
      subjectSubtitle: designation.department_name || 'Designation',
      priority: 'critical',
      category: 'missing_designation_salary',
      issue: 'Default compensation level not set',
      recommendedAction: `Set a default compensation level for ${designation.name}`,
      actionLabel: 'Set level',
      actionRoute: `/hr/payroll/compensation-levels?designation=${designation.id}`,
    }));
  });

  return tasks;
}

function buildOnboardingGapTasks(context) {
  const tasks = [];
  const acceptedAwaiting = context.acceptedAwaiting || [];

  acceptedAwaiting.forEach((candidate) => {
    const name = candidate.name || 'Candidate';
    tasks.push(taskBase(null, {
      id: `pending_employee_creation:${candidate.id}`,
      employeeId: candidate.id,
      employeeCode: candidate.email || name,
      employeeName: name,
      subjectType: 'candidate',
      subjectSubtitle: candidate.job_title || 'Accepted offer',
      priority: 'medium',
      category: 'pending_employee_creation',
      issue: 'Accepted offer — employee not created',
      recommendedAction: 'Create employee record from accepted offer',
      actionLabel: 'Create employee',
      actionRoute: '/hr/onboarding/pending-documents',
    }));
  });

  return tasks;
}

function buildCriticalTasks(context) {
  const tasks = [];
  const {
    activeEmployees,
    structureEmployeeIds,
    assignedEmployeeIds,
    balanceEmployeeIds,
    documents,
    month,
    designations = [],
  } = context;

  activeEmployees.forEach((emp) => {
    if (!employeeHasSalaryStructure(emp, structureEmployeeIds)) {
      tasks.push(taskBase(emp, {
        id: `missing_salary:${emp.id}`,
        priority: 'critical',
        category: 'missing_salary',
        issue: employeeSalaryIssueText(emp, designations),
        recommendedAction: employeeSalaryRecommendedAction(emp, designations),
        actionLabel: employeeSalaryActionLabel(emp, designations),
        actionRoute: employeeSalaryActionRoute(emp, designations),
      }));
    }

    if (employeeMissingShift(emp, assignedEmployeeIds)) {
      tasks.push(taskBase(emp, {
        id: `missing_shift:${emp.id}`,
        priority: 'critical',
        category: 'missing_shift',
        issue: 'Shift not assigned',
        recommendedAction: 'Assign shift',
        actionLabel: 'Open employee',
        actionRoute: `/hr/employees/${emp.id}`,
      }));
    }

    if (!balanceEmployeeIds.has(String(emp.id))) {
      tasks.push(taskBase(emp, {
        id: `missing_policy:${emp.id}`,
        priority: 'critical',
        category: 'missing_policy',
        issue: 'Leave policy balances missing',
        recommendedAction: 'Assign leave policy',
        actionLabel: 'Leave policies',
        actionRoute: '/hr/leave/policies',
      }));
    }

    const readiness = evaluatePayrollReadiness(emp, {
      structureEmployeeIds,
      assignedEmployeeIds,
      month,
      designations,
    });
    const hasSalaryTask = !employeeHasSalaryStructure(emp, structureEmployeeIds);
    if (!readiness.eligible && emp.status === 'active' && !hasSalaryTask) {
      const primaryReason = readiness.reasons.find((r) => !r.startsWith('Shift not assigned'))
        || 'Payroll blocked';
      tasks.push(taskBase(emp, {
        id: `payroll_blocker:${emp.id}`,
        priority: 'critical',
        category: 'payroll_blocker',
        issue: primaryReason,
        recommendedAction: 'Resolve payroll blockers',
        actionLabel: readiness.primaryActionLabel,
        actionRoute: readiness.primaryActionRoute,
      }));
    }
  });

  const employeeDocMap = new Map();
  (documents || []).forEach((doc) => {
    if (!isMandatoryDocumentIncomplete(doc)) return;
    const empId = String(doc.employee);
    if (!employeeDocMap.has(empId)) employeeDocMap.set(empId, doc);
  });
  employeeDocMap.forEach((doc, empId) => {
    if (tasks.some((t) => t.id === `mandatory_docs:${empId}`)) return;
    const emp = activeEmployees.find((e) => String(e.id) === empId);
    if (!emp) return;
    tasks.push(taskBase(emp, {
      id: `mandatory_docs_active:${empId}`,
      priority: 'critical',
      category: 'mandatory_docs',
      issue: 'Mandatory documents incomplete',
      recommendedAction: 'Upload or verify documents',
      actionLabel: 'Open documents',
      actionRoute: `/hr/employees/${empId}/documents`,
    }));
  });

  return tasks;
}

function buildMediumTasks(context) {
  const tasks = [];
  const { leaveRequests, regularizations } = context;

  (leaveRequests || []).forEach((req) => {
    tasks.push(taskBase(null, {
      id: `pending_leave:${req.id}`,
      employeeId: req.employee,
      employeeCode: req.employee_id_display || req.employee_id || '—',
      employeeName: req.employee_name || 'Employee',
      priority: 'medium',
      category: 'pending_leave',
      issue: 'Leave request pending',
      recommendedAction: 'Review leave request',
      actionLabel: 'Review leaves',
      actionRoute: '/hr/leave/requests?status=PENDING',
    }));
  });

  (regularizations || []).forEach((row) => {
    tasks.push(taskBase(null, {
      id: `pending_miss_punch:${row.id}`,
      employeeId: row.employee,
      employeeCode: row.employee_code || row.employee_id || '—',
      employeeName: row.employee_name || 'Employee',
      priority: 'medium',
      category: 'pending_miss_punch',
      issue: 'Missed punch correction pending',
      recommendedAction: 'Review regularization request',
      actionLabel: 'Review requests',
      actionRoute: '/hr/operations/regularizations?status=pending',
    }));
  });

  return tasks;
}

function buildLowTasks(context) {
  const tasks = [];
  const { documents, activeEmployees, offerMap, employees } = context;
  const employeeById = new Map((employees || []).map((e) => [String(e.id), e]));

  const expiringByEmployee = new Map();
  (documents || []).forEach((doc) => {
    if (!isDocumentExpiringSoon(doc.expires_at)) return;
    const empId = String(doc.employee);
    if (!expiringByEmployee.has(empId)) {
      expiringByEmployee.set(empId, { doc, count: 1 });
    } else {
      expiringByEmployee.get(empId).count += 1;
    }
  });
  expiringByEmployee.forEach(({ doc, count }, empId) => {
    const emp = employeeById.get(empId);
    tasks.push(taskBase(emp, {
      id: `expiring_doc:${empId}`,
      employeeId: doc.employee,
      employeeCode: emp?.employee_id || '—',
      employeeName: emp?.name || doc.employee_name || 'Employee',
      priority: 'low',
      category: 'expiring_document',
      issue: count > 1
        ? `${count} documents expiring soon`
        : 'Document expiring soon',
      recommendedAction: 'Review expiring document(s)',
      actionLabel: 'Open documents',
      actionRoute: `/hr/employees/${empId}/documents`,
    }));
  });

  activeEmployees.forEach((emp) => {
    const offer = emp.offer ? offerMap.get(String(emp.offer)) : null;
    if (!offer?.probation_period) return;
    const join = employeeJoinDate(emp);
    if (!isProbationEndingSoon(join, offer.probation_period)) return;
    tasks.push(taskBase(emp, {
      id: `probation:${emp.id}`,
      priority: 'low',
      category: 'probation_review',
      issue: 'Probation ending soon',
      recommendedAction: 'Review probation status',
      actionLabel: 'Open employee',
      actionRoute: `/hr/employees/${emp.id}`,
    }));
  });

  return tasks;
}

function addDaysToToday(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().split('T')[0];
}

/** Additional per-item tasks from command-center gaps — extends without replacing existing builders. */
function buildExtendedGapTasks(context) {
  const tasks = [];
  const {
    offers = [],
    employees = [],
    activeEmployees,
    commandCenterCounts = {},
    payrollRuns = [],
    month,
  } = context;
  const today = localTodayString();
  const weekAhead = addDaysToToday(7);
  const offerExpiryEnd = addDaysToToday(7);

  (offers || []).forEach((o) => {
    if (o.status !== 'sent') return;
    const expiry = o.offer_expiry_date ? String(o.offer_expiry_date).split('T')[0] : null;
    const name = o.candidate_name || 'Candidate';
    tasks.push(taskBase(null, {
      id: `offer_awaiting_response:${o.id}`,
      employeeId: o.candidate || o.id,
      employeeCode: name,
      employeeName: name,
      subjectType: 'candidate',
      subjectSubtitle: 'Awaiting candidate',
      priority: 'critical',
      category: 'offer_awaiting_response',
      issue: 'Offer sent — awaiting candidate response',
      recommendedAction: 'Follow up with candidate on offer status',
      actionLabel: 'View offer',
      actionRoute: '/hr/recruitment/offers',
      dueDate: expiry,
    }));

    if (expiry && expiry >= today && expiry <= offerExpiryEnd) {
      tasks.push(taskBase(null, {
        id: `offer_expiring:${o.id}`,
        employeeId: o.candidate || o.id,
        employeeCode: name,
        employeeName: name,
        subjectType: 'candidate',
        subjectSubtitle: expiry ? `Expires ${expiry}` : 'Offer',
        priority: 'critical',
        category: 'offer_expiring_soon',
        issue: `Offer expires on ${expiry}`,
        recommendedAction: 'Follow up before offer expires',
        actionLabel: 'View offer',
        actionRoute: '/hr/recruitment/offers',
        dueDate: expiry,
      }));
    }
  });

  (employees || []).forEach((emp) => {
    if (emp.status !== 'pending_onboarding' || !emp.joining_date) return;
    const joinDay = String(emp.joining_date).split('T')[0];
    if (joinDay >= today) return;
    if (emp.onboarding_status === 'onboarded') return;
    tasks.push(taskBase(emp, {
      id: `delayed_joiner:${emp.id}`,
      priority: 'critical',
      category: 'delayed_joiner',
      issue: `Joining date passed (${joinDay})`,
      recommendedAction: 'Follow up on delayed joining',
      actionLabel: 'Open joiner',
      actionRoute: '/hr/onboarding/pending-documents',
      dueDate: joinDay,
    }));
  });

  (context.documents || []).forEach((doc) => {
    if (!doc.expires_at) return;
    const expiry = new Date(doc.expires_at);
    if (Number.isNaN(expiry.getTime()) || expiry > new Date()) return;
    const status = String(doc.status || '').toLowerCase();
    if (status === 'verified' || status === 'physically_verified') return;
    const empId = String(doc.employee);
    tasks.push(taskBase(null, {
      id: `expired_doc:${doc.id}`,
      employeeId: doc.employee,
      employeeCode: doc.employee_id_display || '—',
      employeeName: doc.employee_name || 'Employee',
      priority: 'critical',
      category: 'expired_document',
      issue: 'Document expired — renewal required',
      recommendedAction: 'Request updated document from employee',
      actionLabel: 'Review document',
      actionRoute: `/hr/employees/${empId}/documents`,
      dueDate: doc.expires_at,
    }));
  });

  (payrollRuns || []).forEach((run) => {
    if (run.status !== 'LOCKED') return;
    tasks.push(taskBase(null, {
      id: `payroll_locked:${run.id}`,
      employeeId: run.employee,
      employeeCode: run.employee_code || run.employee_id || '—',
      employeeName: run.employee_name || 'Employee',
      subjectType: 'payroll_run',
      subjectSubtitle: run.month || month,
      priority: 'critical',
      category: 'payroll_locked_publish',
      issue: 'Payroll locked — publish payslip to employee portal',
      recommendedAction: 'Generate and publish payslip',
      actionLabel: 'Publish',
      actionRoute: '/hr/payroll/payslips',
    }));
  });

  const emailFailureCount = Number(commandCenterCounts.email_failures) || 0;
  if (emailFailureCount > 0) {
    tasks.push(taskBase(null, {
      id: 'email_failures:aggregate',
      employeeName: 'Recruitment emails',
      employeeCode: '—',
      subjectType: 'system',
      subjectSubtitle: 'Failed dispatches',
      priority: 'critical',
      category: 'email_failures',
      issue: `${emailFailureCount} recruitment email(s) failed to send`,
      recommendedAction: 'Review candidates and retry communications',
      actionLabel: 'Review',
      actionRoute: '/hr/recruitment/candidates',
    }));
  }

  activeEmployees.forEach((emp) => {
    if (!emp.designation) {
      tasks.push(taskBase(emp, {
        id: `missing_designation:${emp.id}`,
        priority: 'medium',
        category: 'missing_designation',
        issue: 'Designation not linked to employee profile',
        recommendedAction: 'Link designation on employee profile',
        actionLabel: 'Open employee',
        actionRoute: `/hr/employees/${emp.id}`,
      }));
    }
    if (!emp.department_ref) {
      tasks.push(taskBase(emp, {
        id: `missing_department:${emp.id}`,
        priority: 'medium',
        category: 'missing_department',
        issue: 'Department not assigned',
        recommendedAction: 'Link employee to a department',
        actionLabel: 'Open employee',
        actionRoute: `/hr/employees/${emp.id}`,
      }));
    }
  });

  (context.jobs || []).forEach((job) => {
    if (job.status !== 'draft' || job.is_archived) return;
    tasks.push(taskBase(null, {
      id: `draft_job:${job.id}`,
      employeeId: job.id,
      employeeCode: job.job_code || '—',
      employeeName: job.title || 'Job opening',
      subjectType: 'job',
      subjectSubtitle: 'Draft',
      priority: 'medium',
      category: 'draft_job',
      issue: 'Job opening in draft — not accepting applications',
      recommendedAction: 'Review and publish job opening',
      actionLabel: 'Edit job',
      actionRoute: `/hr/jobs/${job.id}/edit`,
    }));
  });

  (employees || []).forEach((emp) => {
    if (!isUpcomingJoinerNeedingAction(emp, today, weekAhead)) return;
    const joinDay = String(emp.joining_date).split('T')[0];
    tasks.push(taskBase(emp, {
      id: `joining_this_week:${emp.id}`,
      priority: 'low',
      category: 'joining_this_week',
      issue: `Joining on ${joinDay}`,
      recommendedAction: 'Prepare onboarding for new joiner',
      actionLabel: 'Open joiner',
      actionRoute: '/hr/onboarding/pending-documents',
      dueDate: joinDay,
    }));
  });

  return tasks;
}

function buildBiometricConflictTasks(context) {
  const count = Number(context.biometricUnlinkedCount || 0);
  if (count <= 0) return [];

  return [{
    id: 'biometric_unlinked_users',
    employeeId: '',
    employeeCode: 'Biometric',
    employeeName: `${count} machine user${count === 1 ? '' : 's'}`,
    subjectType: 'system',
    priority: 'critical',
    category: 'biometric_conflict',
    issue: 'Machine user not in HR',
    recommendedAction: 'Create employee or reject device-created users',
    actionLabel: 'Review conflicts',
    actionRoute: '/hr/operations/biometric-conflicts',
  }];
}

export function buildNextActionTasks(context) {
  const tasks = [
    ...buildBiometricConflictTasks(context),
    ...buildRecruitmentTasks(context),
    ...buildDesignationSalaryTasks(context),
    ...buildCriticalTasks(context),
    ...buildMediumTasks(context),
    ...buildOnboardingEmployeeTasks(context.onboardingEmployees),
    ...buildOnboardingGapTasks(context),
    ...buildPayrollMonthTasks(context.payrollMonthReadiness),
    ...buildLowTasks(context),
    ...buildExtendedGapTasks(context),
  ];

  const deduped = dedupeTasks(tasks);
  return deduped.sort((a, b) => {
    const p = PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority];
    if (p !== 0) return p;
    return (a.employeeName || '').localeCompare(b.employeeName || '');
  });
}

export function groupTasksByPriority(tasks) {
  return {
    critical: tasks.filter((t) => t.priority === 'critical'),
    medium: tasks.filter((t) => t.priority === 'medium'),
    low: tasks.filter((t) => t.priority === 'low'),
  };
}

export function prepareActionContext(rawContext) {
  const {
    employees = [],
    structures = [],
    assignments = [],
    balances = [],
    leaveRequests = [],
    regularizations = [],
    onboarding = {},
    documents = [],
    offers = [],
    offerBuilders = [],
    candidates = [],
    designations = [],
    designationStructures = [],
    acceptedAwaitingEmployee = [],
    salaryAssignments = [],
    payrollMonthReadiness = null,
    payrollRuns = [],
    month,
    commandCenterCounts = {},
    attendanceSummary = {},
    jobs = [],
    biometricUnlinkedCount = 0,
  } = rawContext;

  const activeEmployees = filterActiveEmployees(employees);
  const structureEmployeeIds = buildPayrollReadyEmployeeIds(structures, salaryAssignments);
  const assignedEmployeeIds = buildAssignedEmployeeIds(assignments);
  const balanceEmployeeIds = new Set(
    balances.map((row) => String(row.employee)).filter(Boolean),
  );
  const onboardingEmployees = onboarding.employees || [];
  const acceptedAwaiting = acceptedAwaitingEmployee.length
    ? acceptedAwaitingEmployee
    : (onboarding.accepted_without_employee || []);
  const offerMap = buildOfferMap(offers);

  return {
    employees,
    activeEmployees,
    structures,
    assignments,
    balances,
    leaveRequests,
    regularizations,
    onboardingEmployees,
    documents,
    offers,
    offerBuilders,
    candidates,
    designations,
    designationStructures,
    acceptedAwaiting,
    payrollMonthReadiness,
    payrollRuns,
    offerMap,
    structureEmployeeIds,
    assignedEmployeeIds,
    balanceEmployeeIds,
    month,
    commandCenterCounts,
    attendanceSummary,
    jobs,
    biometricUnlinkedCount,
  };
}

export const PRIORITY_LABELS = {
  critical: 'Do today',
  medium: 'This week',
  low: 'When you can',
};

export const PRIORITY_VIEW_LINKS = {
  critical: '/hr/journey-center/dashboard',
  medium: '/hr/journey-center/dashboard',
  low: '/hr/journey-center/dashboard',
};

/** HR workflow phases for dashboard grouping — every task category maps to one phase. */
export const TASK_PHASES = [
  {
    id: 'recruitment',
    label: 'Recruitment',
    description: 'Applications, interviews, and offers',
    order: 1,
  },
  {
    id: 'onboarding',
    label: 'Onboarding',
    description: 'Documents, verification, and activation',
    order: 2,
  },
  {
    id: 'workforce',
    label: 'Workforce setup',
    description: 'Salary, shifts, leave policy, and probation',
    order: 3,
  },
  {
    id: 'attendance',
    label: 'Attendance & leave',
    description: 'Leave approvals and punch corrections',
    order: 4,
  },
  {
    id: 'payroll',
    label: 'Payroll',
    description: 'Payroll blockers and eligibility',
    order: 5,
  },
];

export const TASK_CATEGORY_META = {
  review_application: { phase: 'recruitment', typeLabel: 'Application' },
  schedule_interview: { phase: 'recruitment', typeLabel: 'Interview' },
  pending_interview: { phase: 'recruitment', typeLabel: 'Interview' },
  send_offer: { phase: 'recruitment', typeLabel: 'Offer' },
  pending_offer: { phase: 'recruitment', typeLabel: 'Offer' },
  pending_employee_creation: { phase: 'onboarding', typeLabel: 'Employee setup' },
  onboarding_waiting_docs: { phase: 'onboarding', typeLabel: 'Waiting upload' },
  mandatory_docs: { phase: 'onboarding', typeLabel: 'Documents' },
  pending_document_review: { phase: 'onboarding', typeLabel: 'Documents' },
  ready_to_activate: { phase: 'onboarding', typeLabel: 'Activation' },
  expired_document: { phase: 'onboarding', typeLabel: 'Documents' },
  expiring_document: { phase: 'onboarding', typeLabel: 'Documents' },
  offer_awaiting_response: { phase: 'recruitment', typeLabel: 'Offer' },
  offer_expiring_soon: { phase: 'recruitment', typeLabel: 'Offer' },
  delayed_joiner: { phase: 'onboarding', typeLabel: 'Joining' },
  email_failures: { phase: 'recruitment', typeLabel: 'Email' },
  draft_job: { phase: 'recruitment', typeLabel: 'Job' },
  missing_designation: { phase: 'workforce', typeLabel: 'Designation' },
  missing_department: { phase: 'workforce', typeLabel: 'Department' },
  absent_today: { phase: 'attendance', typeLabel: 'Attendance' },
  late_today: { phase: 'attendance', typeLabel: 'Attendance' },
  attendance_needs_review: { phase: 'attendance', typeLabel: 'Attendance' },
  payroll_locked_publish: { phase: 'payroll', typeLabel: 'Publish' },
  joining_this_week: { phase: 'onboarding', typeLabel: 'Joining' },
  missing_salary: { phase: 'workforce', typeLabel: 'Salary' },
  missing_designation_salary: { phase: 'workforce', typeLabel: 'Compensation' },
  missing_shift: { phase: 'workforce', typeLabel: 'Shift' },
  missing_policy: { phase: 'workforce', typeLabel: 'Leave policy' },
  probation_review: { phase: 'workforce', typeLabel: 'Probation' },
  pending_leave: { phase: 'attendance', typeLabel: 'Leave' },
  pending_miss_punch: { phase: 'attendance', typeLabel: 'Attendance' },
  payroll_blocker: { phase: 'payroll', typeLabel: 'Payroll' },
  finalize_attendance: { phase: 'payroll', typeLabel: 'Finalize' },
  calculate_payroll: { phase: 'payroll', typeLabel: 'Payroll' },
  review_payroll: { phase: 'payroll', typeLabel: 'Review' },
};

export function getTaskPhaseId(task) {
  return TASK_CATEGORY_META[task?.category]?.phase || 'workforce';
}

export function getTaskTypeLabel(task) {
  return TASK_CATEGORY_META[task?.category]?.typeLabel || 'Task';
}

export function groupTasksByPhase(tasks = []) {
  const grouped = Object.fromEntries(TASK_PHASES.map((phase) => [phase.id, []]));
  (tasks || []).forEach((task) => {
    const phaseId = getTaskPhaseId(task);
    if (grouped[phaseId]) {
      grouped[phaseId].push(task);
    } else {
      grouped.workforce.push(task);
    }
  });
  return grouped;
}

export function computeDashboardSummary(tasks = []) {
  const grouped = groupTasksByPriority(tasks);
  const byPhase = groupTasksByPhase(tasks);
  const phasesWithWork = TASK_PHASES.filter((phase) => (byPhase[phase.id]?.length || 0) > 0);

  return {
    total: tasks.length,
    critical: grouped.critical.length,
    medium: grouped.medium.length,
    low: grouped.low.length,
    phasesWithWork: phasesWithWork.length,
    byPhase: Object.fromEntries(
      TASK_PHASES.map((phase) => [phase.id, byPhase[phase.id]?.length || 0]),
    ),
  };
}

/** Summary counts for dashboard category chips — derived from tasks only (single source of truth). */
export function computeTaskDashboardMetrics(tasks = []) {
  const byCategory = (cat) => tasks.filter((t) => t.category === cat).length;

  return {
    pending_interviews: byCategory('pending_interview'),
    schedule_interview: byCategory('schedule_interview'),
    pending_offers: byCategory('pending_offer') + byCategory('send_offer'),
    review_applications: byCategory('review_application'),
    missing_salary: byCategory('missing_salary'),
    missing_designation_salary: byCategory('missing_designation_salary'),
    missing_shift: byCategory('missing_shift'),
    missing_policy: byCategory('missing_policy'),
    payroll_blocker: byCategory('payroll_blocker'),
    finalize_attendance: byCategory('finalize_attendance'),
    calculate_payroll: byCategory('calculate_payroll'),
    review_payroll: byCategory('review_payroll'),
    pending_documents: byCategory('pending_document_review'),
    onboarding_waiting: byCategory('onboarding_waiting_docs'),
    ready_to_activate: byCategory('ready_to_activate'),
    pending_employee_creation: byCategory('pending_employee_creation'),
    pending_leave: byCategory('pending_leave'),
    pending_miss_punch: byCategory('pending_miss_punch'),
    mandatory_docs: byCategory('mandatory_docs'),
    expiring_document: byCategory('expiring_document'),
    probation_review: byCategory('probation_review'),
  };
}
