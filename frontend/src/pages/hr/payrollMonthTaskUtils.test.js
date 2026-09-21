import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildPayrollMonthTasks,
  formatPayrollMonthLabel,
  isPayrollMonthEndWindow,
  payrollRunsRoute,
} from './payrollMonthTaskUtils.js';

const juneEndWindow = new Date(2026, 5, 30);
const juneOutsideWindow = new Date(2026, 5, 27);

test('formatPayrollMonthLabel formats YYYY-MM', () => {
  assert.equal(formatPayrollMonthLabel('2026-06'), 'June 2026');
});

test('payrollRunsRoute includes month query param', () => {
  assert.equal(payrollRunsRoute('2026-06'), '/hr/payroll/runs?month=2026-06');
});

test('isPayrollMonthEndWindow is true on last 3 days of a 31-day month', () => {
  assert.equal(isPayrollMonthEndWindow(new Date(2026, 6, 29)), true);
  assert.equal(isPayrollMonthEndWindow(new Date(2026, 6, 30)), true);
  assert.equal(isPayrollMonthEndWindow(new Date(2026, 6, 31)), true);
});

test('isPayrollMonthEndWindow is false before the last 3 days', () => {
  assert.equal(isPayrollMonthEndWindow(new Date(2026, 6, 28)), false);
  assert.equal(isPayrollMonthEndWindow(new Date(2026, 6, 1)), false);
});

test('isPayrollMonthEndWindow handles shorter months', () => {
  assert.equal(isPayrollMonthEndWindow(new Date(2026, 1, 26)), true);
  assert.equal(isPayrollMonthEndWindow(new Date(2026, 1, 25)), false);
});

test('buildPayrollMonthTasks returns run payroll task when next_action is finalize_attendance', () => {
  const tasks = buildPayrollMonthTasks({
    month: '2026-06',
    next_action: 'finalize_attendance',
  }, { today: juneEndWindow });

  assert.equal(tasks.length, 1);
  assert.equal(tasks[0].id, 'finalize_attendance:2026-06');
  assert.equal(tasks[0].category, 'finalize_attendance');
  assert.equal(tasks[0].priority, 'critical');
  assert.equal(tasks[0].actionLabel, 'Run payroll');
  assert.equal(tasks[0].actionRoute, '/hr/payroll/runs?month=2026-06');
  assert.match(tasks[0].issue, /June 2026/);
});

test('buildPayrollMonthTasks returns calculate task when next_action is calculate_payroll', () => {
  const tasks = buildPayrollMonthTasks({
    month: '2026-05',
    next_action: 'calculate_payroll',
  }, { today: new Date(2026, 4, 31) });

  assert.equal(tasks.length, 1);
  assert.equal(tasks[0].category, 'calculate_payroll');
  assert.equal(tasks[0].actionLabel, 'Run payroll');
});

test('buildPayrollMonthTasks returns review task when next_action is review_payroll', () => {
  const tasks = buildPayrollMonthTasks({
    month: '2026-05',
    next_action: 'review_payroll',
  }, { today: new Date(2026, 4, 31) });

  assert.equal(tasks.length, 1);
  assert.equal(tasks[0].category, 'review_payroll');
  assert.equal(tasks[0].priority, 'medium');
});

test('buildPayrollMonthTasks returns empty array when next_action is none', () => {
  assert.deepEqual(buildPayrollMonthTasks({ next_action: 'none' }, { today: juneEndWindow }), []);
  assert.deepEqual(buildPayrollMonthTasks(null, { today: juneEndWindow }), []);
});

test('buildPayrollMonthTasks returns empty array outside payroll month-end window', () => {
  const readiness = {
    month: '2026-06',
    next_action: 'finalize_attendance',
  };

  assert.deepEqual(buildPayrollMonthTasks(readiness, { today: juneOutsideWindow }), []);
  assert.deepEqual(buildPayrollMonthTasks(readiness, { today: juneEndWindow }).length, 1);
});
