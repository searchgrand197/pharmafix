import api from '@/api';
import { unwrapListPayload } from '@/utils/unwrapList';
import { useAuthStore } from '@/stores/authStore';
import { pickDefaultPharmacyBranchId } from '@/pharmacy/rxConstants';

function pharmacyBranchLabel(row) {
  return String(row?.label || row?.display_name || row?.name || '').trim() || 'Pharmacy';
}

/**
 * Ensure X-Pharmacy-Branch is available before pharmacy/inventory API calls.
 * Auto-selects a default branch when the user opened the portal without one.
 */
export async function ensurePharmacyBranchContext() {
  const { pharmacyBranchId, allowedPharmacyIds, setPharmacyBranch } = useAuthStore.getState();
  if (pharmacyBranchId) return pharmacyBranchId;

  const { data } = await api.get('/auth/pharmacies/');
  const rows = unwrapListPayload(data);
  let branches = Array.isArray(rows) ? rows : [];

  if (Array.isArray(allowedPharmacyIds) && allowedPharmacyIds.length) {
    const allowed = new Set(allowedPharmacyIds.map(String));
    branches = branches.filter((b) => allowed.has(String(b.id)));
  }

  if (!branches.length) {
    throw new Error('No pharmacy branch available for your account.');
  }

  const pickedId = pickDefaultPharmacyBranchId(branches);
  const picked = branches.find((b) => String(b.id) === String(pickedId)) || branches[0];
  setPharmacyBranch(String(picked.id), pharmacyBranchLabel(picked));
  return String(picked.id);
}

/**
 * Active pharmacy branches (login picker + admin assignment).
 */
export async function fetchPharmacyBranches() {
  const { data } = await api.get('/auth/pharmacies/');
  const rows = unwrapListPayload(data);
  return { data: rows };
}
