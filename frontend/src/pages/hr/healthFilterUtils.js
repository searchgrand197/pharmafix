import { monthKey } from '../../utils/attendanceCalendar';

export const HEALTH_FILTER_LABELS = {
  missing_salary: 'Missing salary structure',
  missing_shift: 'Missing shift assignment',
  missing_policy: 'Missing leave policy balances',
  pending_documents: 'Pending document review',
  expiring_documents: 'Expiring documents',
  payroll_eligible: 'Payroll eligible',
  payroll_not_eligible: 'Not payroll eligible',
  missing_designation: 'Designation not linked',
  missing_department: 'Missing department',
};

export function readHealthFilter(searchParams) {
  return (searchParams.get('filter') || '').trim();
}

export function healthFilterLabel(filter) {
  return HEALTH_FILTER_LABELS[filter] || filter;
}

export function employeeEffectiveJoinDate(employee) {
  return employee?.joining_date_confirmed || employee?.joining_date || null;
}

export function parsePayrollMonthEnd(month) {
  if (!month || month.length < 7) return null;
  const [year, mon] = month.split('-').map(Number);
  if (!year || !mon) return null;
  return new Date(year, mon, 0);
}

export function employeeEligibleForPayrollMonth(employee, month = monthKey()) {
  const monthEnd = parsePayrollMonthEnd(month);
  if (!monthEnd) return true;
  const join = employeeEffectiveJoinDate(employee);
  if (!join) return true;
  const joinDate = new Date(join);
  if (Number.isNaN(joinDate.getTime())) return true;
  return joinDate <= monthEnd;
}

export function buildStructureEmployeeIds(structures) {
  const ids = new Set();
  (structures || []).forEach((row) => {
    if (row?.employee) ids.add(String(row.employee));
  });
  return ids;
}

/** Legacy structures plus compensation assignments both count as payroll-ready inputs. */
export function buildPayrollReadyEmployeeIds(structures, compensationAssignments) {
  const ids = buildStructureEmployeeIds(structures);
  (compensationAssignments || []).forEach((row) => {
    if (row?.employee && row.is_active !== false) {
      ids.add(String(row.employee));
    }
  });
  return ids;
}

export function employeeHasSalaryStructure(employee, structureEmployeeIds) {
  return structureEmployeeIds.has(String(employee.id));
}

export function employeeDesignationId(employee) {
  const value = employee?.designation;
  if (!value) return null;
  if (typeof value === 'object' && value.id != null) return String(value.id);
  return String(value);
}

export function employeeDesignationName(employee) {
  if (employee?.designation_name) return employee.designation_name;
  if (typeof employee?.designation === 'object' && employee.designation?.name) {
    return employee.designation.name;
  }
  return null;
}

function normalizeDesignationLabel(value) {
  return String(value || '').trim().toLowerCase();
}

/** Resolve designation id from FK, or match job_title / designation_name to hospital designations. */
export function resolveEmployeeDesignationId(employee, designations = []) {
  const direct = employeeDesignationId(employee);
  if (direct) return direct;

  const nameCandidates = [
    employee?.designation_name,
    employee?.job_title,
  ]
    .map(normalizeDesignationLabel)
    .filter(Boolean);

  if (!nameCandidates.length) return null;

  for (const designation of designations) {
    const designationName = normalizeDesignationLabel(designation.name);
    if (designationName && nameCandidates.includes(designationName)) {
      return String(designation.id);
    }
  }
  return null;
}

export function resolveEmployeeDesignationName(employee, designations = []) {
  const direct = employeeDesignationName(employee);
  if (direct) return direct;

  const id = resolveEmployeeDesignationId(employee, designations);
  if (!id) return employee?.job_title || null;

  const match = (designations || []).find((row) => String(row.id) === id);
  return match?.name || employee?.job_title || null;
}

/** Route HR to employee salary assignment (pay grade or custom amounts). */
export function employeeSalaryActionRoute(employee, designations = []) {
  if (employee?.id) {
    const designationId = resolveEmployeeDesignationId(employee, designations);
    return designationId
      ? `/hr/payroll/assign/${employee.id}?mode=level`
      : `/hr/payroll/assign/${employee.id}`;
  }
  return '/hr/payroll/compensation-levels';
}

export function employeeSalaryActionLabel(employee, designations = []) {
  return resolveEmployeeDesignationId(employee, designations) ? 'Set compensation level' : 'Assign salary';
}

export function employeeSalaryIssueText(employee, designations = []) {
  const designationName = resolveEmployeeDesignationName(employee, designations);
  if (designationName) {
    return `Salary missing — ${designationName}`;
  }
  return 'Salary structure missing';
}

export function employeeSalaryRecommendedAction(employee, designations = []) {
  const designationName = resolveEmployeeDesignationName(employee, designations);
  if (designationName) {
    return `Set compensation level for ${designationName}`;
  }
  return 'Assign salary structure';
}

export function employeeMissingShift(employee, assignedEmployeeIds) {
  if (employee?.shift) return false;
  return !assignedEmployeeIds.has(String(employee.id));
}

export function buildAssignedEmployeeIds(assignments) {
  const ids = new Set();
  (assignments || []).forEach((row) => {
    if (row?.employee) ids.add(String(row.employee));
  });
  return ids;
}

export function isPayrollEligibleEmployee(employee, structureEmployeeIds, month = monthKey()) {
  if (employee?.status !== 'active') return false;
  if (!employeeHasSalaryStructure(employee, structureEmployeeIds)) return false;
  return employeeEligibleForPayrollMonth(employee, month);
}

export function employeePassesHealthFilter(employee, filter, context = {}) {
  if (!filter) return true;
  const {
    structureEmployeeIds = new Set(),
    assignedEmployeeIds = new Set(),
    month = monthKey(),
  } = context;

  switch (filter) {
    case 'missing_salary':
      return employee?.status === 'active'
        && !employeeHasSalaryStructure(employee, structureEmployeeIds);
    case 'missing_shift':
      return employee?.status === 'active'
        && employeeMissingShift(employee, assignedEmployeeIds);
    case 'payroll_eligible':
      return isPayrollEligibleEmployee(employee, structureEmployeeIds, month);
    case 'payroll_not_eligible':
      return employee?.status === 'active'
        && !isPayrollEligibleEmployee(employee, structureEmployeeIds, month);
    case 'missing_designation':
      return employee?.status === 'active' && !employee?.designation;
    case 'missing_department':
      return employee?.status === 'active' && !employee?.department_ref;
    default:
      return true;
  }
}

export function filterActiveEmployees(employees) {
  return (employees || []).filter((emp) => emp?.status === 'active');
}

export function countMissingSalary(activeEmployees, structureEmployeeIds) {
  return activeEmployees.filter(
    (emp) => !employeeHasSalaryStructure(emp, structureEmployeeIds),
  ).length;
}

export function countMissingShift(activeEmployees, assignedEmployeeIds) {
  return activeEmployees.filter(
    (emp) => employeeMissingShift(emp, assignedEmployeeIds),
  ).length;
}

export function countPayrollEligible(activeEmployees, structureEmployeeIds, month) {
  return activeEmployees.filter(
    (emp) => isPayrollEligibleEmployee(emp, structureEmployeeIds, month),
  ).length;
}

export function countMissingLeavePolicy(activeEmployees, balanceEmployeeIds) {
  return activeEmployees.filter(
    (emp) => !balanceEmployeeIds.has(String(emp.id)),
  ).length;
}

/** Latest active default compensation level per designation id. */
export function buildDesignationStructureMap(compensationLevels) {
  const map = new Map();
  (compensationLevels || []).forEach((row) => {
    if (row?.is_active === false) return;
    if (row?.is_default_for_designation === false) return;
    const designationId = String(row.designation || '');
    if (!designationId) return;
    const existing = map.get(designationId);
    if (!existing || (row.effective_from || '') > (existing.effective_from || '')) {
      map.set(designationId, row);
    }
  });
  return map;
}

export function designationsMissingSalary(designations, designationStructures) {
  const structureMap = buildDesignationStructureMap(designationStructures);
  return (designations || []).filter((designation) => !structureMap.has(String(designation.id)));
}

export function countDesignationsMissingSalary(designations, designationStructures) {
  return designationsMissingSalary(designations, designationStructures).length;
}

export function isDocumentExpiringSoon(expiresAt, withinDays = 30) {
  if (!expiresAt) return false;
  const expiry = new Date(expiresAt);
  if (Number.isNaN(expiry.getTime())) return false;
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() + withinDays);
  return expiry <= cutoff;
}
