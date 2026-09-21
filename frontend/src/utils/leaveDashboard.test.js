import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeLeaveDashboard,
  isUnlimitedLeaveType,
  leaveTypeSelectable,
} from './leaveDashboard.js';

test('limited balance is not unlimited when is_paid is false', () => {
  const lt = {
    name: 'Casual Leave',
    is_paid: false,
    balance: {
      total_days: '12.00',
      used_days: '0.00',
      remaining_days: '12.00',
      is_unlimited: false,
    },
  };
  assert.equal(isUnlimitedLeaveType(lt), false);
  assert.equal(leaveTypeSelectable(lt), true);
  const dash = computeLeaveDashboard([lt], []);
  assert.equal(dash.totalBalance, 12);
  assert.equal(dash.remaining, 12);
  assert.equal(dash.unlimitedCount, 0);
});

test('LWP with unlimited balance counts as unlimited', () => {
  const lt = {
    name: 'Leave Without Pay',
    is_paid: false,
    balance: {
      total_days: null,
      used_days: '1.00',
      remaining_days: null,
      is_unlimited: true,
    },
  };
  assert.equal(isUnlimitedLeaveType(lt), true);
  assert.equal(leaveTypeSelectable(lt), true);
  const dash = computeLeaveDashboard([lt], []);
  assert.equal(dash.totalBalance, 0);
  assert.equal(dash.unlimitedCount, 1);
  assert.equal(dash.used, 1);
});
