/** Pure helpers for Employee Detail redesign (no React). */

function formatMoney(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return String(value ?? '');
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 2,
  }).format(num);
}

export function salaryStructureMonthlyGross(structure) {
  if (!structure) return 0;
  const allowances = structure.allowances || {};
  const allowanceTotal = Object.values(allowances).reduce(
    (sum, val) => sum + (Number(val) || 0),
    0,
  );
  return (
    (Number(structure.basic_salary) || 0)
    + (Number(structure.hra) || 0)
    + allowanceTotal
  );
}

export function formatCompensationLabel(assignment, structure, gross) {
  if (assignment) {
    return `${assignment.compensation_level_name || 'Level'} (${assignment.compensation_level_code || '—'})`;
  }
  if (structure) {
    return `Custom salary${gross > 0 ? ` · ${formatMoney(gross)}/mo` : ''}`;
  }
  return 'Not assigned';
}

export function formatDocsProgress(progress) {
  if (!progress) return '—';
  if (progress.all_mandatory_verified) return 'Complete';
  const pct = progress.progress_percentage;
  if (pct != null) return `${pct}%`;
  const verified = progress.verified_count;
  const total = progress.total_required ?? progress.total;
  if (verified != null && total != null) return `${verified}/${total}`;
  return '—';
}

export function formatPortalLabel(employee) {
  if (!employee) return '—';
  if (employee.user || employee.portal_account_created_at) return 'Portal active';
  return 'No portal';
}

export function formatBiometricLabel(employee) {
  if (!employee) return '—';
  if (!employee.biometric_attendance_enabled) return 'Disabled';
  const status = employee.biometric_sync_status || '—';
  return String(status).replace(/_/g, ' ');
}

export function documentExpiryWarnings(documentPayload) {
  const rows = documentPayload?.documents
    || documentPayload?.requirements
    || documentPayload?.items
    || [];
  if (!Array.isArray(rows)) return [];
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return rows.filter((row) => {
    const expires = row.expires_at || row.expiry_date || row.document_type?.expires_at;
    if (!expires) return false;
    const d = new Date(`${String(expires).slice(0, 10)}T12:00:00`);
    if (Number.isNaN(d.getTime())) return false;
    const days = (d - today) / (1000 * 60 * 60 * 24);
    return days <= 30;
  }).slice(0, 5);
}
