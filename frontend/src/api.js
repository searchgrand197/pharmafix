import axios from 'axios';
import { useAuthStore } from './stores/authStore';

const api = axios.create({ baseURL: '/api/v1' });
export const payrollApi = axios.create({ baseURL: '/api/payroll' });

export const USE_NEW_OFFER_BUILDER = true;

// Helper – read selected pharmacy branch id
export function getPharmacyBranchId() {
  return useAuthStore.getState().pharmacyBranchId || null;
}

function readHospitalIdFromAccessToken() {
  try {
    const access = useAuthStore.getState().tokens?.access;
    if (!access || typeof access !== 'string') return null;
    const parts = access.split('.');
    if (parts.length < 2) return null;
    const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
    const hid = payload?.hospital_id;
    return hid != null && String(hid).trim() !== '' ? String(hid) : null;
  } catch {
    return null;
  }
}

// Helper – read hospital_id from the stored user object or JWT claim
export function getHospitalId() {
  const user = useAuthStore.getState().user;
  const fromUser = user?.hospital_id;
  if (fromUser != null && String(fromUser).trim() !== '') return String(fromUser);
  return readHospitalIdFromAccessToken();
}

function attachAuthAndHospital(cfg) {
  const { tokens, role, pharmacyBranchId } = useAuthStore.getState();
  if (tokens.access) {
    cfg.headers.Authorization = `Bearer ${tokens.access}`;
  }

  const requestUrl = String(cfg.url || '');
  const method = (cfg.method || 'get').toLowerCase();
  const isAuthRoute = requestUrl.startsWith('/auth/');
  // doctor-stock-search takes pharmacy_id as a query param (doctor/reception discharge Rx)
  // and must work without a logged-in pharmacy branch context.
  const isDoctorStockSearch = requestUrl.includes('/pharmacy/doctor-stock-search');
  // Reception TPA / print preview loads a pharmacy invoice by id without a branch login.
  const pathOnly = requestUrl.split('?')[0];
  const isPharmacyInvoiceDetailGet =
    method === 'get' &&
    /^\/pharmacy\/invoices\/[^/]+\/?$/.test(pathOnly);
  const needsPharmacyBranch =
    !isAuthRoute &&
    !isDoctorStockSearch &&
    !isPharmacyInvoiceDetailGet &&
    (requestUrl.startsWith('/pharmacy/') ||
      requestUrl.startsWith('/medicines') ||
      requestUrl.startsWith('/batches') ||
      requestUrl.startsWith('/medicine-categories') ||
      requestUrl.startsWith('/units') ||
      requestUrl.startsWith('/stock-ledgers'));

  const headerBranch =
    cfg.headers?.['X-Pharmacy-Branch'] ||
    cfg.headers?.['x-pharmacy-branch'] ||
    null;
  // Prefer an explicit per-request branch (TPA pharmacy bill) over the login store.
  const resolvedBranch = headerBranch || pharmacyBranchId || null;
  if (resolvedBranch) {
    cfg.headers['X-Pharmacy-Branch'] = resolvedBranch;
  } else if (needsPharmacyBranch) {
    throw new Error('Pharmacy branch is required. Please re-login and select a branch.');
  }

  const hospitalId = getHospitalId();
  if (role !== 'pharmacy' && hospitalId && ['post', 'put', 'patch'].includes(method)) {
    if (cfg.data && typeof cfg.data === 'object' && !(cfg.data instanceof FormData)) {
      const existing = cfg.data.hospital_id;
      if (existing == null || String(existing).trim() === '') {
        cfg.data = { ...cfg.data, hospital_id: hospitalId };
      }
    }
  }

  return cfg;
}

api.interceptors.request.use(attachAuthAndHospital);
payrollApi.interceptors.request.use((cfg) => {
  const { tokens } = useAuthStore.getState();
  if (tokens.access) {
    cfg.headers.Authorization = `Bearer ${tokens.access}`;
  }
  return cfg;
});

let refreshPromise = null;

function isAuthCredentialRequest(config) {
  const url = String(config?.url || '');
  return url.includes('/auth/login/') || url.includes('/auth/refresh/');
}

async function handleUnauthorized(err, client) {
  const originalRequest = err.config;
  if (
    err.response?.status === 401 &&
    !originalRequest._retry &&
    !isAuthCredentialRequest(originalRequest)
  ) {
    originalRequest._retry = true;
    const { tokens } = useAuthStore.getState();
    if (!tokens.refresh) {
      useAuthStore.getState().logoutSilent();
      window.location.replace('/login');
      return Promise.reject(err);
    }

    if (!refreshPromise) {
      refreshPromise = axios
        .post('/api/v1/auth/refresh/', { refresh: tokens.refresh })
        .then(({ data }) => {
          const access = data?.access || data?.data?.access;
          const newRefresh = data?.refresh || data?.data?.refresh;
          if (!access) throw new Error('No access token in refresh response');
          useAuthStore.getState().setTokens(access, newRefresh);
          return access;
        })
        .catch((refreshErr) => {
          useAuthStore.getState().logoutSilent();
          window.location.replace('/login');
          return Promise.reject(refreshErr);
        })
        .finally(() => {
          refreshPromise = null;
        });
    }

    try {
      const newAccess = await refreshPromise;
      originalRequest.headers.Authorization = `Bearer ${newAccess}`;
      return client(originalRequest);
    } catch {
      return Promise.reject(err);
    }
  }
  return Promise.reject(err);
}

api.interceptors.response.use(
  (r) => r,
  (err) => handleUnauthorized(err, api),
);
payrollApi.interceptors.response.use(
  (r) => r,
  (err) => handleUnauthorized(err, payrollApi),
);

export default api;
