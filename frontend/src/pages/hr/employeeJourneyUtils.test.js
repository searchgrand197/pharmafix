import test from 'node:test';
import assert from 'node:assert/strict';
import { payrollSalaryReadinessReasons } from './payrollSalaryReadiness.js';

const employeeWithDesignation = {
  id: 'f1c82b36-e1f9-4eab-8119-61aed9d7e8b1',
  designation: 'desig-1',
  designation_name: 'Nurse',
  status: 'active',
};

test('custom salary (structure only): no compensation-assignment warning', () => {
  const reasons = payrollSalaryReadinessReasons(employeeWithDesignation, {
    hasSalary: true,
    hasDesignationAssignment: false,
  });
  assert.deepEqual(reasons, []);
  // Eligible when structure exists even without compensation assignment.
  assert.equal(reasons.length === 0, true);
});

test('no structure + designation: missing salary and assignment warnings', () => {
  const reasons = payrollSalaryReadinessReasons(employeeWithDesignation, {
    hasSalary: false,
    hasDesignationAssignment: false,
  });
  assert.deepEqual(reasons, [
    'Missing salary structure',
    'Missing compensation level assignment',
  ]);
});

test('compensation assignment / structure present: eligible path has no salary warnings', () => {
  const withAssignment = payrollSalaryReadinessReasons(employeeWithDesignation, {
    hasSalary: true,
    hasDesignationAssignment: true,
  });
  assert.deepEqual(withAssignment, []);
});
