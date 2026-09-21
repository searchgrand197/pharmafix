/**
 * Client-side session helpers. Backend permission checks remain authoritative;
 * these guards block wrong-portal navigation and login role mismatches.
 */

export const HMS_MODULE_ROLES = ['staff', 'doctor', 'receptionist', 'lab', 'pharmacy', 'hr']

export function getStoredUser() {
  try {
    return JSON.parse(localStorage.getItem('user') || '{}')
  } catch {
    return {}
  }
}

export function hasAccessToken() {
  return Boolean(localStorage.getItem('access'))
}

export function isHmsStaffUser(user = getStoredUser()) {
  return Boolean(user?.is_staff || user?.is_superuser)
}

export function isEmployeePortalUser(user = getStoredUser()) {
  if (!user?.has_employee_profile) return false
  if (user.portal_access_allowed === false) return false
  return true
}

/** Non-HR employee — may use employee portal only. */
export function isEmployeeOnlyAccount(user = getStoredUser()) {
  return isEmployeePortalUser(user) && !isHmsStaffUser(user)
}

export function getStoredRole() {
  return localStorage.getItem('role') || ''
}

export function canLoginAs(role, user) {
  if (role === 'employee') {
    return isEmployeePortalUser(user)
  }
  return isHmsStaffUser(user)
}

export function loginRoleLabel(role) {
  const labels = {
    staff: 'Staff',
    doctor: 'Doctor',
    receptionist: 'Receptionist',
    lab: 'Lab',
    pharmacy: 'Pharmacy',
    employee: 'Employee',
    hr: 'HR',
  }
  return labels[role] || role
}

export function employeePortalPath(user = getStoredUser()) {
  if (user?.must_change_password) return '/employee/change-password'
  return '/employee/dashboard'
}

export function defaultPathForRole(role, user = getStoredUser()) {
  if (role === 'employee') return employeePortalPath(user)
  const paths = {
    staff: '/staff',
    doctor: '/doctor',
    receptionist: '/receptionist',
    lab: '/lab',
    pharmacy: '/pharmacy',
    admin: '/admin',
    hr: '/hr/journey-center/dashboard',
  }
  return paths[role] || '/staff'
}

export function clearSession() {
  localStorage.removeItem('access')
  localStorage.removeItem('refresh')
  localStorage.removeItem('role')
  localStorage.removeItem('user')
}
