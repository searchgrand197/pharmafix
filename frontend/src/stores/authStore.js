import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import axios from 'axios';
import api from '@/api';

function readBootAuthState() {
  if (typeof window === 'undefined') {
    return {
      user: null,
      tokens: { access: null, refresh: null },
      role: null,
      pharmacyBranchId: null,
      pharmacyBranchLabel: null,
      allowedPharmacyIds: [],
    };
  }

  const fromPersist = {
    user: null,
    tokens: { access: null, refresh: null },
    role: null,
    pharmacyBranchId: null,
    pharmacyBranchLabel: null,
    allowedPharmacyIds: [],
  };
  try {
    const persistedRaw = localStorage.getItem('hms-auth');
    if (persistedRaw) {
      const parsed = JSON.parse(persistedRaw);
      const state = parsed?.state || {};
      fromPersist.user = state.user || null;
      fromPersist.tokens = {
        access: state?.tokens?.access || null,
        refresh: state?.tokens?.refresh || null,
      };
      fromPersist.role = state.role || null;
      fromPersist.pharmacyBranchId = state.pharmacyBranchId || null;
      fromPersist.pharmacyBranchLabel = state.pharmacyBranchLabel || null;
      fromPersist.allowedPharmacyIds = Array.isArray(state.allowedPharmacyIds)
        ? state.allowedPharmacyIds
        : [];
    }
  } catch {
    // Ignore malformed persisted payload and fall back to legacy keys.
  }

  const access = localStorage.getItem('access') || fromPersist.tokens.access || null;
  const refresh = localStorage.getItem('refresh') || fromPersist.tokens.refresh || null;
  const role = localStorage.getItem('role') || fromPersist.role || null;
  const pharmacyBranchId = localStorage.getItem('pharmacy_branch_id') || fromPersist.pharmacyBranchId || null;
  const pharmacyBranchLabel = localStorage.getItem('pharmacy_branch_label') || fromPersist.pharmacyBranchLabel || null;

  let user = fromPersist.user;
  const legacyUser = localStorage.getItem('user');
  if (legacyUser) {
    try {
      user = JSON.parse(legacyUser);
    } catch {
      // Ignore malformed legacy user JSON.
    }
  }

  const allowedPharmacyIds = Array.isArray(fromPersist.allowedPharmacyIds)
    ? fromPersist.allowedPharmacyIds
    : Array.isArray(user?.allowed_pharmacy_ids)
      ? user.allowed_pharmacy_ids
      : [];

  return {
    user,
    tokens: { access, refresh },
    role,
    pharmacyBranchId,
    pharmacyBranchLabel,
    allowedPharmacyIds,
  };
}

const bootAuthState = readBootAuthState();

/**
 * Normalize the login API response into a consistent user object.
 * Handles both the main project's response shape and admin-specific shapes.
 */
function normalizeUser(raw) {
  if (!raw) return null;
  const u = raw.user ?? raw.profile ?? raw;
  const isSuperuser = Boolean(u?.is_superuser ?? raw?.is_superuser);
  const isActive = u?.is_active ?? raw?.is_active;
  const isStaff = u?.is_staff ?? raw?.is_staff;

  const hospitalId =
    u?.hospital_id ?? raw?.hospital_id ?? u?.hospital?.id ?? null;
  const hospitalName =
    u?.hospital_name ?? raw?.hospital_name ?? u?.hospital?.name ?? null;

  const role = u?.role ?? raw?.role ?? u?.role_code ?? null;
  const email = u?.email ?? raw?.email ?? null;
  const id = u?.id ?? u?.pk ?? raw?.user_id ?? email ?? '';
  const name =
    [u?.first_name, u?.last_name].filter(Boolean).join(' ').trim() ||
    u?.name ||
    u?.full_name ||
    email ||
    'User';

  return {
    id: String(id),
    email,
    name,
    role,
    is_active: isActive !== false,
    is_staff: isStaff !== false,
    is_superuser: isSuperuser,
    allowed_portals: Array.isArray(raw?.allowed_portals)
      ? raw.allowed_portals
      : Array.isArray(u?.allowed_portals)
        ? u.allowed_portals
        : [],
    allowed_pharmacy_ids: Array.isArray(raw?.allowed_pharmacy_ids)
      ? raw.allowed_pharmacy_ids
      : Array.isArray(u?.allowed_pharmacy_ids)
        ? u.allowed_pharmacy_ids
        : [],
    has_employee_profile: Boolean(raw?.has_employee_profile ?? u?.has_employee_profile),
    employee_id: raw?.employee_id ?? u?.employee_id ?? null,
    employee_status: raw?.employee_status ?? u?.employee_status ?? null,
    employee_code: raw?.employee_code ?? u?.employee_code ?? null,
    portal_access_allowed: raw?.portal_access_allowed ?? u?.portal_access_allowed,
    must_change_password: Boolean(raw?.must_change_password ?? u?.must_change_password),
    ...(hospitalId != null && hospitalId !== ''
      ? { hospital_id: String(hospitalId), hospital_name: hospitalName ?? null }
      : {}),
  };
}

/**
 * Sync Zustand state to the OLD localStorage keys that existing portals use.
 * This ensures backward compatibility during the gradual migration.
 * Once all portals use Zustand, this can be removed.
 */
function syncToLegacyKeys(state) {
  if (state.tokens.access) {
    localStorage.setItem('access', state.tokens.access);
  } else {
    localStorage.removeItem('access');
  }
  if (state.tokens.refresh) {
    localStorage.setItem('refresh', state.tokens.refresh);
  } else {
    localStorage.removeItem('refresh');
  }
  if (state.role) {
    localStorage.setItem('role', state.role);
  } else {
    localStorage.removeItem('role');
  }
  if (state.user) {
    localStorage.setItem('user', JSON.stringify(state.user));
  } else {
    localStorage.removeItem('user');
  }
  if (state.pharmacyBranchId) {
    localStorage.setItem('pharmacy_branch_id', state.pharmacyBranchId);
  } else {
    localStorage.removeItem('pharmacy_branch_id');
  }
  if (state.pharmacyBranchLabel) {
    localStorage.setItem('pharmacy_branch_label', state.pharmacyBranchLabel);
  } else {
    localStorage.removeItem('pharmacy_branch_label');
  }
}

/**
 * Auth store — single source of truth for authentication state.
 * Persists to localStorage automatically via Zustand persist middleware.
 * Also syncs to legacy localStorage keys for backward compatibility.
 *
 * Usage:
 *   const { user, isAuthenticated, login, logout } = useAuthStore();
 *   const token = useAuthStore.getState().tokens.access;  // outside React
 */
export const useAuthStore = create(
  persist(
    (set, get) => ({
      user: bootAuthState.user,
      tokens: bootAuthState.tokens,
      role: bootAuthState.role,
      pharmacyBranchId: bootAuthState.pharmacyBranchId,
      pharmacyBranchLabel: bootAuthState.pharmacyBranchLabel,
      allowedPharmacyIds: bootAuthState.allowedPharmacyIds,
      hasHydrated: false,

      /** Internal: marks persist rehydration completion */
      setHasHydrated: (hydrated) => set({ hasHydrated: hydrated }),

      /** Derived — check if authenticated */
      get isAuthenticated() {
        return Boolean(get().tokens.access);
      },

      /**
       * Login: call the API, normalize response, store everything.
       * @param {string} email
       * @param {string} password
       * @param {string} role — the portal role the user selected on login
       * @param {{ id?: string, label?: string }} [pharmacyBranch] — for pharmacy role
       */
      login: async (email, password, role, pharmacyBranch = null) => {
        const body = {
          email,
          password,
          intended_portal: role,
        };
        if (role === 'pharmacy' && pharmacyBranch?.id) {
          body.pharmacy_branch_id = pharmacyBranch.id;
        }
        const { data } = await api.post('/auth/login/', body);
        const payload = data?.data || data;

        const accessToken = payload.access;
        const refreshToken = payload.refresh;
        if (!accessToken) {
          throw new Error('Invalid login response: missing access token');
        }

        const user = normalizeUser(payload);
        const allowedPharmacyIds = Array.isArray(payload.allowed_pharmacy_ids)
          ? payload.allowed_pharmacy_ids.map(String)
          : [];

        if (
          role === 'pharmacy' &&
          pharmacyBranch?.id &&
          allowedPharmacyIds.length > 0 &&
          !allowedPharmacyIds.includes(String(pharmacyBranch.id))
        ) {
          const err = new Error(
            'Your account is not allowed to access this pharmacy branch.'
          );
          err.response = {
            status: 403,
            data: {
              errors: {
                detail: [err.message],
                allowed_pharmacy_ids: allowedPharmacyIds,
              },
            },
          };
          throw err;
        }

        const newState = {
          user,
          tokens: { access: accessToken, refresh: refreshToken || null },
          role,
          pharmacyBranchId: pharmacyBranch?.id || null,
          pharmacyBranchLabel: pharmacyBranch?.label || null,
          allowedPharmacyIds,
        };

        set(newState);
        syncToLegacyKeys(newState);

        return { user, tokens: { access: accessToken, refresh: refreshToken }, allowedPharmacyIds };
      },

      /**
       * Logout: clear local session immediately (so redirects cannot race stale tokens),
       * then best-effort server-side refresh invalidation using captured tokens.
       */
      logout: async () => {
        const { tokens } = get();
        const refreshToken = tokens.refresh;
        const accessToken = tokens.access;
        const clearedState = {
          user: null,
          tokens: { access: null, refresh: null },
          role: null,
          pharmacyBranchId: null,
          pharmacyBranchLabel: null,
          allowedPharmacyIds: [],
        };
        set(clearedState);
        syncToLegacyKeys(clearedState);
        if (refreshToken) {
          try {
            await axios.post(
              '/api/v1/auth/logout/',
              { refresh_token: refreshToken },
              accessToken ? { headers: { Authorization: `Bearer ${accessToken}` } } : undefined
            );
          } catch {
            // ignore — session already cleared locally
          }
        }
      },

      /**
       * Silent logout: wipes localStorage WITHOUT calling set(), so no React
       * subscriber is notified and no re-render occurs.  The caller must
       * immediately do window.location.replace('/login') so the page reloads
       * and Zustand re-hydrates from the now-empty storage as unauthenticated.
       * Also fires a best-effort server-side refresh invalidation.
       */
      logoutSilent: () => {
        const { tokens } = get();
        // Clear the Zustand persist key and all legacy keys directly.
        // No set() → no Zustand subscriber notification → no React re-render.
        const KEYS = [
          'hms-auth',
          'access', 'refresh', 'role', 'user',
          'pharmacy_branch_id', 'pharmacy_branch_label',
        ];
        KEYS.forEach((k) => localStorage.removeItem(k));
        // Best-effort server-side invalidation (fire-and-forget)
        if (tokens.refresh) {
          axios.post(
            '/api/v1/auth/logout/',
            { refresh_token: tokens.refresh },
            tokens.access ? { headers: { Authorization: `Bearer ${tokens.access}` } } : undefined
          ).catch(() => {});
        }
      },

      /** Update tokens (used by api.js interceptors for token refresh) */
      setTokens: (access, refresh) => {
        const newState = {
          tokens: {
            access,
            refresh: refresh ?? get().tokens.refresh,
          },
        };
        set(newState);
        syncToLegacyKeys({ ...get(), ...newState });
      },

      /** Update user data (e.g., after profile fetch) */
      setUser: (user) => {
        set({ user });
        syncToLegacyKeys(get());
      },

      /** Persist active pharmacy branch for pharmacy/inventory API scoping */
      setPharmacyBranch: (id, label = null) => {
        const newState = {
          pharmacyBranchId: id ? String(id) : null,
          pharmacyBranchLabel: label ? String(label) : null,
        };
        set(newState);
        syncToLegacyKeys({ ...get(), ...newState });
      },

      /** Check if user has a specific role */
      hasRole: (allowedRoles) => {
        const { user } = get();
        if (!allowedRoles?.length) return false;
        if (user?.is_superuser) return true;
        if (!user?.role) return false;
        return allowedRoles.includes(user.role);
      },
    }),
    {
      name: 'hms-auth', // Zustand persist key
      partialize: (state) => ({
        user: state.user,
        tokens: state.tokens,
        role: state.role,
        pharmacyBranchId: state.pharmacyBranchId,
        pharmacyBranchLabel: state.pharmacyBranchLabel,
        allowedPharmacyIds: state.allowedPharmacyIds,
      }),
      // After rehydration, sync to legacy keys and always mark hydration
      // complete so route guards don't hang when storage is empty or errors.
      onRehydrateStorage: () => (state, error) => {
        if (!error && state) {
          syncToLegacyKeys(state);
        }
      },
    }
  )
);
