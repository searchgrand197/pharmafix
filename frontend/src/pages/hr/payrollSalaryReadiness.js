/** Salary / assignment blockers for payroll readiness (pure — no app imports). */

export function payrollSalaryReadinessReasons(employee, { hasSalary, hasDesignationAssignment } = {}) {
  const reasons = [];
  if (!hasSalary) {
    reasons.push('Missing salary structure');
    if (employee?.designation && hasDesignationAssignment === false) {
      reasons.push('Missing compensation level assignment');
    }
  }
  return reasons;
}
