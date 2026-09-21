import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizePayrollRunIssues, payrollSkipLabel } from './payrollUtils.js';

test('payrollSkipLabel maps known reasons', () => {
  assert.equal(payrollSkipLabel('missing_compensation_assignment'), 'Compensation level not assigned');
});

test('normalizePayrollRunIssues merges skipped and errors', () => {
  const issues = normalizePayrollRunIssues(
    [{ employee_id: 'EMP0002', reason: 'missing_compensation_assignment', message: 'x' }],
    [{ employee_id: 'EMP0003', message: 'Calculation failed' }],
  );
  assert.equal(issues.length, 2);
  assert.equal(issues[0].employeeId, 'EMP0002');
  assert.equal(issues[0].label, 'Compensation level not assigned');
  assert.equal(issues[0].fixLink, '/hr/payroll/compensation-levels');
});
