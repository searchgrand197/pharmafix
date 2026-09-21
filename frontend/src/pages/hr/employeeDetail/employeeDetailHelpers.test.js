import test from 'node:test';
import assert from 'node:assert/strict';
import {
  formatCompensationLabel,
  formatDocsProgress,
  formatPortalLabel,
  formatBiometricLabel,
  documentExpiryWarnings,
} from './employeeDetailHelpers.js';

test('formatCompensationLabel prefers assignment over custom structure', () => {
  assert.equal(
    formatCompensationLabel(
      { compensation_level_name: 'Nurse L0', compensation_level_code: 'NURSE_L0' },
      { basic_salary: 5000 },
      5000,
    ),
    'Nurse L0 (NURSE_L0)',
  );
});

test('formatCompensationLabel shows custom salary gross', () => {
  const label = formatCompensationLabel(null, { basic_salary: 5000 }, 5000);
  assert.match(label, /Custom salary/);
  assert.match(label, /5,000/);
});

test('formatDocsProgress uses percentage and complete flag', () => {
  assert.equal(formatDocsProgress({ all_mandatory_verified: true }), 'Complete');
  assert.equal(formatDocsProgress({ progress_percentage: 40 }), '40%');
});

test('formatPortalLabel and biometric labels', () => {
  assert.equal(formatPortalLabel({ portal_account_created_at: '2026-01-01' }), 'Portal active');
  assert.equal(formatPortalLabel({}), 'No portal');
  assert.equal(formatBiometricLabel({ biometric_attendance_enabled: false }), 'Disabled');
  assert.equal(
    formatBiometricLabel({ biometric_attendance_enabled: true, biometric_sync_status: 'synced' }),
    'synced',
  );
});

test('documentExpiryWarnings finds soon-expiring docs', () => {
  const soon = new Date();
  soon.setDate(soon.getDate() + 7);
  const iso = soon.toISOString().slice(0, 10);
  const warnings = documentExpiryWarnings({
    documents: [
      { id: 1, document_label: 'License', expires_at: iso },
      { id: 2, document_label: 'Far', expires_at: '2099-01-01' },
    ],
  });
  assert.equal(warnings.length, 1);
  assert.equal(warnings[0].document_label, 'License');
});
