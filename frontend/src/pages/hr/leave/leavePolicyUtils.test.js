import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildPolicyLines,
  formatPolicyWho,
  isPolicyFormDirty,
  toggleIdInList,
  WHO_GETS_OPTIONS,
} from './leavePolicyUtils.js';

test('WHO_GETS_OPTIONS only includes departments and designations', () => {
  assert.deepEqual(
    WHO_GETS_OPTIONS.map((o) => o.value),
    ['DEPARTMENT', 'DESIGNATION'],
  );
});

test('formatPolicyWho lists department names', () => {
  assert.equal(
    formatPolicyWho({
      assignment_type: 'DEPARTMENT',
      department_names: ['HR', 'Nursing', 'Admin'],
    }),
    'Departments: HR, Nursing, Admin',
  );
});

test('formatPolicyWho lists designation names with truncation', () => {
  assert.equal(
    formatPolicyWho({
      assignment_type: 'DESIGNATION',
      designation_names: ['Nurse', 'Doctor', 'Clerk', 'Manager'],
    }),
    'Designations: Nurse, Doctor, Clerk +1 more',
  );
});

test('toggleIdInList adds and removes ids', () => {
  assert.deepEqual(toggleIdInList(['a'], 'b'), ['a', 'b']);
  assert.deepEqual(toggleIdInList(['a', 'b'], 'a'), ['b']);
});

test('isPolicyFormDirty is false for equivalent forms', () => {
  const baseline = {
    name: 'Standard',
    assignment_type: 'DEPARTMENT',
    departments: ['b', 'a'],
    designations: [],
    lines: [
      { leave_type: 'lt-2', allocated_days: '12', is_unlimited: false },
      { leave_type: 'lt-1', allocated_days: '10', is_unlimited: false },
    ],
  };
  const form = {
    name: ' Standard ',
    assignment_type: 'DEPARTMENT',
    departments: ['a', 'b'],
    designations: ['ignored-when-dept'],
    lines: [
      { leave_type: 'lt-1', allocated_days: '10', is_unlimited: false },
      { leave_type: 'lt-2', allocated_days: '12', is_unlimited: false },
    ],
  };
  assert.equal(isPolicyFormDirty(form, baseline), false);
});

test('isPolicyFormDirty is true when name changes', () => {
  const baseline = {
    name: 'Standard',
    assignment_type: 'DEPARTMENT',
    departments: ['a'],
    designations: [],
    lines: [],
  };
  assert.equal(
    isPolicyFormDirty({ ...baseline, name: 'Updated' }, baseline),
    true,
  );
});

test('buildPolicyLines standard includes standard and custom active types', () => {
  const lines = buildPolicyLines([
    { id: 'lt-cl', name: 'Casual Leave', code: 'CL', is_paid: true },
    { id: 'lt-custom', name: 'Study Leave', code: 'ST', is_paid: true },
  ], 'standard');

  assert.equal(lines.length, 2);
  assert.equal(lines[0].leave_type, 'lt-cl');
  assert.equal(lines[0].allocated_days, '12');
  assert.equal(lines[0].is_unlimited, false);
  assert.equal(lines[1].leave_type, 'lt-custom');
  assert.equal(lines[1].allocated_days, '12');
  assert.equal(lines[1].is_unlimited, false);
});

test('buildPolicyLines standard uses annual_limit for custom types', () => {
  const lines = buildPolicyLines([
    { id: 'lt-cl', name: 'Casual Leave', code: 'CL', is_paid: true },
    { id: 'lt-custom', name: 'Study Leave', code: 'ST', is_paid: true, annual_limit: '5' },
  ], 'standard');

  assert.equal(lines.length, 2);
  assert.equal(lines[1].allocated_days, '5');
});

test('buildPolicyLines standard marks unpaid custom types unlimited when no annual limit', () => {
  const lines = buildPolicyLines([
    { id: 'lt-lwp', name: 'Leave Without Pay', code: 'LWP', is_paid: false },
    { id: 'lt-custom', name: 'Special Unpaid', code: 'SU', is_paid: false },
  ], 'standard');

  assert.equal(lines.length, 2);
  assert.equal(lines[0].is_unlimited, true);
  assert.equal(lines[1].is_unlimited, true);
  assert.equal(lines[1].allocated_days, '');
});

test('buildPolicyLines standard with only custom types includes all', () => {
  const lines = buildPolicyLines([
    { id: 'lt-a', name: 'Type A', code: 'TA', is_paid: true, annual_limit: '8' },
    { id: 'lt-b', name: 'Type B', code: 'TB', is_paid: true },
  ], 'standard');

  assert.equal(lines.length, 2);
  assert.equal(lines[0].allocated_days, '8');
  assert.equal(lines[1].allocated_days, '12');
});

test('buildPolicyLines empty preset returns empty array', () => {
  assert.deepEqual(buildPolicyLines([{ id: '1', name: 'CL', code: 'CL' }], 'empty'), []);
});

test('buildPolicyLines with no leave types returns empty array', () => {
  assert.deepEqual(buildPolicyLines([], 'standard'), []);
  assert.deepEqual(buildPolicyLines(null, 'standard'), []);
});
