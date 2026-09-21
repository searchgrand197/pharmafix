import { monthKey } from '../../utils/attendanceCalendar';
import {
  buildStructureEmployeeIds,
  employeeEffectiveJoinDate,
  employeeEligibleForPayrollMonth,
  employeeHasSalaryStructure,
  employeeMissingShift,
  employeeSalaryActionLabel,
  employeeSalaryActionRoute,
  employeeSalaryRecommendedAction,
  isPayrollEligibleEmployee,
} from './healthFilterUtils';
import { payrollSalaryReadinessReasons } from './payrollSalaryReadiness';

const VERIFIED_DOC_STATUSES = new Set(['verified', 'physically_verified']);

export { payrollSalaryReadinessReasons };

export function evaluatePayrollReadiness(employee, context = {}) {
  const month = context.month || monthKey();
  const structureEmployeeIds = context.structureEmployeeIds || new Set();
  const assignedEmployeeIds = context.assignedEmployeeIds || new Set();
  const reasons = [];

  if (!employee) {
    return { eligible: false, statusLabel: 'Payroll Blocked', reasons: ['Employee record unavailable'] };
  }

  if (employee.status !== 'active') {
    reasons.push('Employee is not active');
  }
  const hasSalary = employeeHasSalaryStructure(employee, structureEmployeeIds);
  reasons.push(
    ...payrollSalaryReadinessReasons(employee, {
      hasSalary,
      hasDesignationAssignment: context.hasDesignationAssignment,
    }),
  );
  if (!employeeEligibleForPayrollMonth(employee, month)) {
    reasons.push(`Joined after payroll month (${month})`);
  }
  if (employeeMissingShift(employee, assignedEmployeeIds)) {
    reasons.push('Shift not assigned (informational — attendance may be affected)');
  }

  const blockingReasons = reasons.filter((r) => !r.startsWith('Shift not assigned'));
  const eligible = blockingReasons.length === 0 && employee.status === 'active'
    && hasSalary
    && employeeEligibleForPayrollMonth(employee, month);

  return {
    eligible,
    statusLabel: eligible ? 'Payroll Eligible' : 'Payroll Blocked',
    reasons: reasons.length ? reasons : (eligible ? ['Ready for payroll this month'] : ['Unknown blocker']),
    primaryActionRoute: !hasSalary
      ? employeeSalaryActionRoute(employee, context.designations)
      : `/hr/employees/${employee.id}`,
    primaryActionLabel: !hasSalary
      ? employeeSalaryActionLabel(employee, context.designations)
      : 'Open employee',
  };
}

export function evaluateEmployeeJourneySteps(employee, context = {}) {
  if (!employee) return [];

  const structureEmployeeIds = context.structureEmployeeIds || new Set();
  const assignedEmployeeIds = context.assignedEmployeeIds || new Set();
  const documentProgress = context.documentProgress || {};
  const analytics = context.analytics || null;
  const hasSalaryStructure = context.hasSalaryStructure != null
    ? context.hasSalaryStructure
    : employeeHasSalaryStructure(employee, structureEmployeeIds);
  const hasShift = Boolean(employee.shift) || !employeeMissingShift(employee, assignedEmployeeIds);

  const documentsComplete = Boolean(documentProgress.all_mandatory_verified);
  const summary = analytics?.summary || {};
  const hasAttendanceData = Boolean(
    summary.has_attendance_data
    || Number(summary.present_days) > 0
    || Number(summary.total_records) > 0,
  );
  const attendanceComplete = hasShift && hasAttendanceData;
  let attendanceStatus = 'incomplete';
  let attendanceHint = 'Assign a work shift';
  if (attendanceComplete) {
    attendanceStatus = 'complete';
    attendanceHint = 'Attendance data recorded this month';
  } else if (hasShift) {
    attendanceStatus = 'in_progress';
    attendanceHint = 'Attendance accumulating this month';
  }

  const payrollEligible = isPayrollEligibleEmployee(
    employee,
    structureEmployeeIds,
    context.month || monthKey(),
  );

  return [
    {
      key: 'documents',
      label: 'Documents',
      status: documentsComplete ? 'complete' : 'incomplete',
      route: `/hr/employees/${employee.id}/documents`,
      hint: documentsComplete ? 'Mandatory documents verified' : 'Mandatory documents still pending',
    },
    {
      key: 'shift',
      label: 'Shift',
      status: hasShift ? 'complete' : 'incomplete',
      route: `/hr/employees/${employee.id}`,
      hint: hasShift ? (employee.shift_name || 'Shift assigned') : 'Assign a work shift',
    },
    {
      key: 'salary',
      label: 'Salary',
      status: hasSalaryStructure ? 'complete' : 'incomplete',
      route: employeeSalaryActionRoute(employee, context.designations),
      hint: hasSalaryStructure
        ? 'Pay grade assigned'
        : employeeSalaryRecommendedAction(employee, context.designations),
    },
    {
      key: 'attendance',
      label: 'Attendance',
      status: attendanceStatus,
      route: `/hr/employees/${employee.id}/attendance`,
      hint: attendanceHint,
    },
    {
      key: 'payroll',
      label: 'Payroll',
      status: payrollEligible ? 'ready' : 'incomplete',
      route: `/hr/payroll/runs`,
      hint: payrollEligible ? 'Ready for payroll this month' : 'Resolve payroll blockers first',
    },
  ];
}

export function parseProbationPeriodEnd(joinDateValue, probationPeriodText) {
  if (!joinDateValue || !probationPeriodText) return null;
  const join = new Date(joinDateValue);
  if (Number.isNaN(join.getTime())) return null;

  const text = String(probationPeriodText).trim().toLowerCase();
  const match = text.match(/(\d+)\s*(day|days|week|weeks|month|months|year|years)/);
  if (!match) return null;

  const amount = Number(match[1]);
  const unit = match[2];
  const end = new Date(join);
  if (unit.startsWith('day')) end.setDate(end.getDate() + amount);
  else if (unit.startsWith('week')) end.setDate(end.getDate() + amount * 7);
  else if (unit.startsWith('month')) end.setMonth(end.getMonth() + amount);
  else if (unit.startsWith('year')) end.setFullYear(end.getFullYear() + amount);
  return end;
}

export function isProbationEndingSoon(joinDateValue, probationPeriodText, withinDays = 30) {
  const end = parseProbationPeriodEnd(joinDateValue, probationPeriodText);
  if (!end) return false;
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() + withinDays);
  return end <= cutoff;
}

export function buildOfferMap(offers) {
  const map = new Map();
  (offers || []).forEach((offer) => {
    if (offer?.id) map.set(String(offer.id), offer);
  });
  return map;
}

export function employeeFromRow(row) {
  return {
    id: row.id,
    employee_id: row.employee_id,
    name: row.name,
    status: row.status,
    shift: row.shift,
    shift_name: row.shift_name,
    offer: row.offer,
    joining_date: row.joining_date,
    joining_date_confirmed: row.joining_date_confirmed,
  };
}

export function isMandatoryDocumentIncomplete(doc) {
  if (!doc?.mandatory) return false;
  const status = String(doc.status || '').toLowerCase();
  return !VERIFIED_DOC_STATUSES.has(status);
}

export function buildStructureIdsFromList(structures) {
  return buildStructureEmployeeIds(structures);
}

export function employeeJoinDate(employee) {
  return employeeEffectiveJoinDate(employee);
}
