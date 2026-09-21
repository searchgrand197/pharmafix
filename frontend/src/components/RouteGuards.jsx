import React from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import {
  employeePortalPath,
  getStoredRole,
  getStoredUser,
  hasAccessToken,
  isEmployeeOnlyAccount,
  isEmployeePortalUser,
  isHmsStaffUser,
} from '../utils/auth'

function AuthRedirect({ to }) {
  return <Navigate to={to} replace />
}

/** Any authenticated HMS staff module (staff, doctor, receptionist, lab, pharmacy). */
export function StaffModuleRoute({ children, requiredRole }) {
  if (!hasAccessToken()) return <AuthRedirect to="/login" />

  const user = getStoredUser()
  const role = getStoredRole()

  if (isEmployeeOnlyAccount(user)) {
    return <AuthRedirect to={employeePortalPath(user)} />
  }
  if (!isHmsStaffUser(user)) {
    return <AuthRedirect to="/login" />
  }
  if (role !== requiredRole) {
    return <AuthRedirect to="/login" />
  }

  return children
}

/** HR portal — requires is_staff and role hr. */
export function HRRoute({ children }) {
  if (!hasAccessToken()) return <AuthRedirect to="/login" />

  const user = getStoredUser()

  if (isEmployeeOnlyAccount(user)) {
    return <AuthRedirect to={employeePortalPath(user)} />
  }
  if (!isHmsStaffUser(user) || getStoredRole() !== 'hr') {
    return <AuthRedirect to="/login" />
  }

  return children
}

/** Employee self-service portal. */
export function EmployeeRoute({ children }) {
  const location = useLocation()

  if (!hasAccessToken()) return <AuthRedirect to="/login" />

  const user = getStoredUser()

  if (!isEmployeePortalUser(user) || getStoredRole() !== 'employee') {
    if (isEmployeeOnlyAccount(user)) {
      return <AuthRedirect to={employeePortalPath(user)} />
    }
    return <AuthRedirect to="/login" />
  }

  if (user.must_change_password && location.pathname !== '/employee/change-password') {
    return <AuthRedirect to="/employee/change-password" />
  }

  return children
}

/** Change-password page — employee role only, before must_change_password cleared. */
export function EmployeeAuthRoute({ children }) {
  if (!hasAccessToken()) return <AuthRedirect to="/login" />

  const user = getStoredUser()
  if (!isEmployeePortalUser(user) || getStoredRole() !== 'employee') {
    return <AuthRedirect to="/login" />
  }

  return children
}

/** Public pages that still need a logged-in user (e.g. print slip). Blocks employee-only from HMS misuse. */
export function AuthenticatedRoute({ children, allowEmployee = false }) {
  if (!hasAccessToken()) return <AuthRedirect to="/login" />

  const user = getStoredUser()
  if (!allowEmployee && isEmployeeOnlyAccount(user)) {
    return <AuthRedirect to={employeePortalPath(user)} />
  }

  return children
}
