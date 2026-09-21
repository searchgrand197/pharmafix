/**
 * Client session helpers — derive access from login payload stored in localStorage.user.
 * Backend remains the source of truth; these guards only block UI navigation.
 */

export function getStoredUser() {
  try {
    return JSON.parse(localStorage.getItem('user') || '{}')
  } catch {
    return {}
  }
}

export function isAuthenticated() {
  return Boolean(localStorage.getItem('access'))
}

export function isHrStaff(user = getStoredUser()) {
  return Boolean(user.is_staff || user.is_superuser)
}

export function hasEmployeeProfile(user = getStoredUser()) {
  return Boolean(user.has_employee_profile)
}

export function mustChangePassword(user = getStoredUser()) {
  return Boolean(user.must_change_password)
}

export function portalAccessAllowed(user = getStoredUser()) {
  if (!user.has_employee_profile) return false
  return user.portal_access_allowed !== false
}

/** Persist tokens + profile from login response (does not store client role). */
export function persistSession(payload) {
  if (payload?.access) localStorage.setItem('access', payload.access)
  if (payload?.refresh) localStorage.setItem('refresh', payload.refresh)
  localStorage.setItem('user', JSON.stringify(payload || {}))
  localStorage.removeItem('role')
}

export function clearSession() {
  localStorage.clear()
}

/** Post-login destination from server fields only. Returns null when portal blocked. */
export function getPostLoginPath(user) {
  if (!user) return '/login'
  if (isHrStaff(user)) return '/hr'
  if (hasEmployeeProfile(user)) {
    if (!portalAccessAllowed(user)) return null
    if (mustChangePassword(user)) return '/employee/change-password'
    return '/employee/dashboard'
  }
  return '/staff'
}

/** null = allowed; otherwise redirect target path */
export function resolveHrAccessRedirect() {
  if (!isAuthenticated()) return '/login'
  if (!isHrStaff()) {
    return hasEmployeeProfile() ? '/employee/dashboard' : '/login'
  }
  return null
}

/** null = allowed; otherwise redirect target path */
export function resolveEmployeeAccessRedirect({ allowPasswordChange = false, pathname = '' } = {}) {
  if (!isAuthenticated()) return '/login'
  if (isHrStaff()) return '/hr'
  if (!hasEmployeeProfile() || !portalAccessAllowed()) return '/login'
  if (
    !allowPasswordChange
    && mustChangePassword()
    && pathname !== '/employee/change-password'
  ) {
    return '/employee/change-password'
  }
  return null
}
