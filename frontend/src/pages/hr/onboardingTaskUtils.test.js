import test from 'node:test';
import assert from 'node:assert/strict';
import { buildOnboardingEmployeeTasks } from './onboardingTaskUtils.js';

test('buildOnboardingEmployeeTasks creates one task per joiner', () => {
  const tasks = buildOnboardingEmployeeTasks([
    {
      id: 'emp-1',
      name: 'Alice',
      email: 'alice@test.local',
      job_title: 'Nurse',
      next_action: 'review',
      documents_awaiting_review: 2,
    },
    {
      id: 'emp-2',
      name: 'Bob',
      email: 'bob@test.local',
      job_title: 'Admin',
      next_action: 'activate',
    },
  ]);

  assert.equal(tasks.length, 2);
  assert.equal(tasks[0].id, 'onboarding:emp-1');
  assert.equal(tasks[1].id, 'onboarding:emp-2');
  assert.match(tasks[0].actionRoute, /employee=emp-1/);
  assert.equal(tasks[0].category, 'pending_document_review');
  assert.equal(tasks[1].category, 'ready_to_activate');
  assert.equal(tasks[0].issue, '2 document(s) waiting for HR review');
});

test('buildOnboardingEmployeeTasks uses next_action not duplicate categories', () => {
  const row = {
    id: 'emp-3',
    name: 'Carol',
    email: 'carol@test.local',
    next_action: 'review',
    documents_awaiting_review: 1,
    missing_documents: ['PAN'],
    verified_count: 1,
    total_required: 3,
  };
  const tasks = buildOnboardingEmployeeTasks([row]);
  assert.equal(tasks.length, 1);
  assert.equal(tasks[0].category, 'pending_document_review');
  assert.equal(tasks[0].priority, 'critical');
});
