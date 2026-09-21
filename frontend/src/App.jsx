import React, { Suspense, lazy, useEffect, useState } from 'react'
import { Routes, Route, Navigate, useLocation, useParams } from 'react-router-dom'
import Login from './pages/Login'
import ChangePassword from './pages/ChangePassword'
import api from './api'
import { useAuthStore } from './stores/authStore'
import { resolvePortalFromPath } from './themes'
import {
  getHospitalNameForTab,
  getPwaManifestUrl,
  HOSPITAL_BRANDING_CHANGED,
  syncHospitalBrandingFromApiRow,
} from './utils/hospitalBranding'
import { syncTimeDisplayModeFromRow } from './utils/dateTimeFormat'
import { AppRoutes as AdminRoutes } from './adminPortal/routes/AppRoutes'
import { ToastProvider } from './adminPortal/context/ToastContext'

// Lazy-load all HR and Employee pages to keep the initial bundle tiny
const HRShellLayout = lazy(() => import('./components/HR/HRShellLayout'))
const HRHomeRedirect = lazy(() => import('./pages/hr/HRHomeRedirect'))
const JourneyCenterPage = lazy(() => import('./pages/hr/JourneyCenterPage'))
const JourneyCenterDashboardPage = lazy(() => import('./pages/hr/JourneyCenterDashboardPage'))
const HRReportsPlaceholderPage = lazy(() => import('./pages/hr/HRReportsPlaceholderPage'))
const RecruitmentJobsPage = lazy(() => import('./pages/hr/RecruitmentJobsPage'))
const RecruitmentCandidatesPage = lazy(() => import('./pages/hr/RecruitmentCandidatesPage'))
const RecruitmentInterviewsPage = lazy(() => import('./pages/hr/RecruitmentInterviewsPage'))
const RecruitmentOffersPage = lazy(() => import('./pages/hr/RecruitmentOffersPage'))
const OnboardingLegacyRedirect = lazy(() => import('./pages/hr/OnboardingLegacyRedirect'))
const OnboardingDocumentVerificationPage = lazy(() => import('./pages/hr/OnboardingDocumentVerificationPage'))
const OnboardingPendingDocumentsPage = lazy(() => import('./pages/hr/OnboardingPendingDocumentsPage'))
const ManualEmployeeCreatePage = lazy(() => import('./pages/hr/ManualEmployeeCreatePage'))
const DesignationsPage = lazy(() => import('./pages/hr/DesignationsPage'))
const EmployeeDirectoryPage = lazy(() => import('./pages/hr/EmployeeDirectoryPage'))
const InactiveEmployeeDirectoryPage = lazy(() => import('./pages/hr/InactiveEmployeeDirectoryPage'))
const OperationsDepartmentsPage = lazy(() => import('./pages/hr/OperationsDepartmentsPage'))
const OperationsAttendancePage = lazy(() => import('./pages/hr/OperationsAttendancePage'))
const ShiftManagementPage = lazy(() => import('./pages/hr/ShiftManagementPage'))
const ShiftFormPage = lazy(() => import('./pages/hr/ShiftFormPage'))
const PunchLogsPage = lazy(() => import('./pages/hr/PunchLogsPage'))
const BiometricUnlinkedUsersPage = lazy(() => import('./pages/hr/BiometricUnlinkedUsersPage'))
const BiometricRejectedPunchesPage = lazy(() => import('./pages/hr/BiometricRejectedPunchesPage'))
const AttendanceControlPage = lazy(() => import('./pages/hr/AttendanceControlPage'))
const AttendanceCalendarPage = lazy(() => import('./pages/hr/AttendanceCalendarPage'))
const GenerateTestAttendancePage = lazy(() => import('./pages/hr/GenerateTestAttendancePage'))
const EmployeeAttendancePage = lazy(() => import('./pages/hr/EmployeeAttendancePage'))
const RegularizationRequestsPage = lazy(() => import('./pages/hr/RegularizationRequestsPage'))
const LeaveTypesPage = lazy(() => import('./pages/hr/leave/LeaveTypesPage'))
const LeavePoliciesPage = lazy(() => import('./pages/hr/leave/LeavePoliciesPage'))
const LeavePolicyFormPage = lazy(() => import('./pages/hr/leave/LeavePolicyFormPage'))
const LeaveBalancesPage = lazy(() => import('./pages/hr/leave/LeaveBalancesPage'))
const LeaveRequestsPage = lazy(() => import('./pages/hr/leave/LeaveRequestsPage'))
const OperationsSalaryPage = lazy(() => import('./pages/hr/OperationsSalaryPage'))
const OperationsPerformancePage = lazy(() => import('./pages/hr/OperationsPerformancePage'))
const JobCandidates = lazy(() => import('./pages/JobCandidates'))
const CandidateDetail = lazy(() => import('./pages/CandidateDetail'))
const JobForm = lazy(() => import('./pages/JobForm'))
const DepartmentForm = lazy(() => import('./pages/DepartmentForm'))
const OfferTemplateBuilder = lazy(() => import('./pages/OfferTemplateBuilder'))
const OfferLetterBuilderV2 = lazy(() => import('./pages/OfferLetterBuilderV2'))
const OfferDrafts = lazy(() => import('./pages/OfferDrafts'))
const DocumentUpload = lazy(() => import('./components/Onboarding/DocumentUpload'))
const EmployeeDetail = lazy(() => import('./pages/EmployeeDetail'))
const EmployeeDocuments = lazy(() => import('./pages/EmployeeDocuments'))
const ChecklistRules = lazy(() => import('./pages/ChecklistRules'))
const OrganizationSettingsPage = lazy(() => import('./pages/hr/OrganizationSettingsPage'))
const OrganizationDetailsPage = lazy(() => import('./pages/hr/OrganizationDetailsPage'))
const EmployeeShellLayout = lazy(() => import('./components/Employee/EmployeeShellLayout'))
const EmployeeDashboardPage = lazy(() => import('./pages/employee/EmployeeDashboardPage'))
const EmployeePortalAttendancePage = lazy(() => import('./pages/employee/EmployeePortalAttendancePage'))
const EmployeeLeavesPage = lazy(() => import('./pages/employee/EmployeeLeavesPage'))
const EmployeeProfilePage = lazy(() => import('./pages/employee/EmployeeProfilePage'))
const EmployeeChangePasswordPage = lazy(() => import('./pages/employee/EmployeeChangePasswordPage'))
const EmployeeDocumentsPage = lazy(() => import('./pages/employee/EmployeeDocumentsPage'))
const EmployeeNotificationsPage = lazy(() => import('./pages/employee/EmployeeNotificationsPage'))
const EmployeeHolidaysPage = lazy(() => import('./pages/employee/EmployeeHolidaysPage'))
const EmployeePayslipsPage = lazy(() => import('./pages/employee/EmployeePayslipsPage'))
const EmployeePayslipDetailPage = lazy(() => import('./pages/employee/EmployeePayslipDetailPage'))
const HolidayManagementPage = lazy(() => import('./pages/hr/HolidayManagementPage'))
const SalaryStructuresPage = lazy(() => import('./pages/hr/payroll/SalaryStructuresPage'))
const CompensationLevelsPage = lazy(() => import('./pages/hr/payroll/DesignationSalaryStructuresPage'))
const CompensationLevelFormPage = lazy(() => import('./pages/hr/payroll/CompensationLevelFormPage'))
const PayrollRunsPage = lazy(() => import('./pages/hr/payroll/PayrollRunsPage'))
const PayrollRunDetailPage = lazy(() => import('./pages/hr/payroll/PayrollRunDetailPage'))
const PayrollPayslipsPage = lazy(() => import('./pages/hr/payroll/PayrollPayslipsPage'))
const AssignSalaryStructurePage = lazy(() => import('./pages/hr/payroll/AssignSalaryStructurePage'))
import { USE_NEW_OFFER_BUILDER } from './api'
import {
  AuthenticatedRoute,
  EmployeeAuthRoute,
  EmployeeRoute,
  HRRoute,
} from './components/RouteGuards'

const StaffPortal = lazy(() => import('./pages/StaffPortal'))
const DoctorPortal = lazy(() => import('./pages/DoctorPortal'))
const ReceptionistPortal = lazy(() => import('./pages/ReceptionistPortal'))
const TVDisplay = lazy(() => import('./pages/TVDisplay'))
const LabPortal = lazy(() => import('./pages/LabPortal'))
const PrintSlipPage = lazy(() => import('./pages/PrintSlipPage'))
const PharmacyPortal = lazy(() => import('./pages/PharmacyPortal'))
const PharmacySalesDisplay = lazy(() => import('./pages/PharmacySalesDisplay'))

const ROLE_PATHS = {
  staff: '/staff',
  doctor: '/doctor',
  receptionist: '/receptionist',
  lab: '/lab',
  pharmacy: '/pharmacy',
  admin: '/admin',
  hr: '/hr/journey-center/dashboard',
  employee: '/employee/dashboard',
}

/** Legacy URLs — keep bookmarks working after renaming Offer Builder V2 → Offer Builder */
function BuilderLegacyRedirect() {
  const { builderId } = useParams()
  return <Navigate to={builderId ? `/hr/builder/${builderId}` : '/hr/builder'} replace />
}

/** Pharmacy API requires X-Pharmacy-Branch; without it every request fails and must not auto-bounce from /login */
function pharmacyPortalReady(role, pharmacyBranchId) {
  return role !== 'pharmacy' || Boolean(pharmacyBranchId)
}

function PrivateRoute({ children }) {
  const isAuthenticated = useAuthStore((s) => Boolean(s.tokens.access))
  return isAuthenticated ? children : <Navigate to="/login" replace />
}

function PortalAccessRoute({ portalCode, children }) {
  const isAuthenticated = useAuthStore((s) => Boolean(s.tokens.access))
  const user = useAuthStore((s) => s.user)
  const selectedRole = useAuthStore((s) => s.role)

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />
  }

  if (user?.is_superuser) {
    return children
  }

  const allowedPortals = Array.isArray(user?.allowed_portals) ? user.allowed_portals : []
  const portalToCheck = portalCode || selectedRole
  if (portalToCheck && !allowedPortals.includes(portalToCheck)) {
    return <Navigate to="/login" replace />
  }

  return children
}

function PharmacyRequiresBranch({ children }) {
  // Branch is resolved inside PharmacyPortal before API calls (supports multi-portal access).
  return children
}

function HomeRedirect() {
  const hasAccess = useAuthStore((s) => Boolean(s.tokens.access))
  const role = useAuthStore((s) => s.role) || 'staff'
  const pharmacyBranchId = useAuthStore((s) => s.pharmacyBranchId)
  if (hasAccess && !pharmacyPortalReady(role, pharmacyBranchId)) {
    return <Navigate to="/login" replace />
  }
  if (hasAccess) {
    return <Navigate to={ROLE_PATHS[role] || '/staff'} replace />
  }
  return <Navigate to="/login" replace />
}

function LoginRoute() {
  const hasAccess = useAuthStore((s) => Boolean(s.tokens.access))
  const role = useAuthStore((s) => s.role) || 'staff'
  const pharmacyBranchId = useAuthStore((s) => s.pharmacyBranchId)

  if (hasAccess && pharmacyPortalReady(role, pharmacyBranchId)) {
    return <Navigate to={ROLE_PATHS[role] || '/staff'} replace />
  }
  return <Login />
}

function PageLoading() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 text-slate-600 text-sm">
      Loading…
    </div>
  )
}

const PORTAL_TITLE_PREFIX = {
  doctor: 'Doctor Portal',
  pharmacy: 'Pharmacy Portal',
  receptionist: 'Reception Portal',
  admin: 'Admin Portal',
  staff: 'Staff Portal',
  lab: 'Lab Portal',
}

function AppHeadManager() {
  const location = useLocation()
  const [hospitalBrandingBump, setHospitalBrandingBump] = useState(0)
  const access = useAuthStore((s) => s.tokens.access)
  const hospitalId = useAuthStore((s) => s.user?.hospital_id)

  useEffect(() => {
    const bump = () => setHospitalBrandingBump((n) => n + 1)
    window.addEventListener(HOSPITAL_BRANDING_CHANGED, bump)
    return () => window.removeEventListener(HOSPITAL_BRANDING_CHANGED, bump)
  }, [])

  useEffect(() => {
    if (!access || location.pathname.startsWith('/login')) return
    let cancelled = false
    ;(async () => {
      try {
        const { data } = await api.get('/settings/reception-portal/')
        const row = data?.data ?? data
        if (!cancelled && row && typeof row === 'object') {
          syncHospitalBrandingFromApiRow(row)
          syncTimeDisplayModeFromRow(row)
        }
      } catch {
        /* e.g. admin without hospital — keep cached / fallback branding */
      }
    })()
    return () => {
      cancelled = true
    }
  }, [access, location.pathname])

  useEffect(() => {
    const roleKey = resolvePortalFromPath(location.pathname) || 'staff'

    const roleMeta = {
      doctor: {
        iconHref: '/icons/icon-doctor-192.png?v=4',
        manifestFallback: '/manifest-doctor.json?v=4',
      },
      pharmacy: {
        iconHref: '/icons/icon-pharmacy-192.png?v=4',
        manifestFallback: '/manifest-pharmacy.json?v=4',
      },
      receptionist: {
        iconHref: '/icons/icon-reception-192.png?v=5',
        manifestFallback: '/manifest-receptionist.json?v=5',
      },
      admin: {
        iconHref: '/icons/icon-staff-192.png?v=4',
        manifestFallback: '/manifest-staff.json?v=4',
      },
      staff: {
        iconHref: '/icons/icon-staff-192.png?v=4',
        manifestFallback: '/manifest-staff.json?v=4',
      },
      lab: {
        iconHref: '/icons/icon-staff-192.png?v=4',
        manifestFallback: '/manifest-staff.json?v=4',
      },
    }[roleKey]

    const titlePrefix = PORTAL_TITLE_PREFIX[roleKey] || PORTAL_TITLE_PREFIX.staff
    document.title = `${titlePrefix} - ${getHospitalNameForTab()}`

    // Force-refresh favicon links so browser tab icon updates reliably.
    document
      .querySelectorAll('link[rel="icon"], link[rel="shortcut icon"], link[rel="apple-touch-icon"]')
      .forEach((node) => node.parentNode?.removeChild(node))

    const cacheBust = `cb=${Date.now()}`
    const iconUrl = roleMeta.iconHref.includes('?')
      ? `${roleMeta.iconHref}&${cacheBust}`
      : `${roleMeta.iconHref}?${cacheBust}`

    const appendLink = (rel, href, type) => {
      const link = document.createElement('link')
      link.setAttribute('rel', rel)
      link.setAttribute('href', href)
      if (type) link.setAttribute('type', type)
      document.head.appendChild(link)
    }

    appendLink('icon', iconUrl, 'image/png')
    appendLink('shortcut icon', iconUrl, 'image/png')
    appendLink('apple-touch-icon', iconUrl)

    const hospitalName = getHospitalNameForTab()
    const appleTitleMeta = document.querySelector('meta[name="apple-mobile-web-app-title"]')
    if (appleTitleMeta) {
      appleTitleMeta.setAttribute('content', hospitalName)
    }

    let manifestLink = document.querySelector('link[rel="manifest"]')
    if (!manifestLink) {
      manifestLink = document.createElement('link')
      manifestLink.setAttribute('rel', 'manifest')
      document.head.appendChild(manifestLink)
    }

    manifestLink.setAttribute(
      'href',
      hospitalId ? getPwaManifestUrl(roleKey, hospitalId) : roleMeta.manifestFallback,
    )
  }, [location.pathname, hospitalBrandingBump, hospitalId])

  return null
}

function toBase64Url(uint8Array) {
  const binString = String.fromCharCode(...uint8Array)
  return btoa(binString).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

function PushNotificationBootstrap() {
  const location = useLocation()

  useEffect(() => {
    const token = useAuthStore.getState().tokens.access
    if (!token) return
    if (location.pathname.startsWith('/login')) return
    if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) return

    let cancelled = false

    const urlBase64ToUint8Array = (base64String) => {
      const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
      const normalized = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
      const rawData = atob(normalized)
      return Uint8Array.from([...rawData].map((char) => char.charCodeAt(0)))
    }

    const subscribe = async () => {
      try {
        let permission = Notification.permission
        if (permission === 'default') {
          permission = await Notification.requestPermission()
        }
        if (permission !== 'granted') return

        const { data } = await api.get('/notifications/push/public-key/')
        const publicKey = data?.public_key
        if (!publicKey) return

        const registration = await navigator.serviceWorker.ready
        if (cancelled) return

        let subscription = await registration.pushManager.getSubscription()
        if (!subscription) {
          subscription = await registration.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: urlBase64ToUint8Array(publicKey),
          })
        }
        if (!subscription) return

        const subJson = subscription.toJSON()
        const endpoint = subJson.endpoint
        const p256dh = subJson.keys?.p256dh || toBase64Url(new Uint8Array(subscription.getKey('p256dh')))
        const auth = subJson.keys?.auth || toBase64Url(new Uint8Array(subscription.getKey('auth')))
        if (!endpoint || !p256dh || !auth) return

        await api.post('/notifications/push/subscribe/', {
          endpoint,
          p256dh_key: p256dh,
          auth_key: auth,
        })
      } catch {
        // Best-effort registration only.
      }
    }

    subscribe()
    return () => {
      cancelled = true
    }
  }, [location.pathname])

  return null
}

export default function App() {
  return (
    <ToastProvider>
      <Suspense fallback={<PageLoading />}>
        <AppHeadManager />
        <PushNotificationBootstrap />
        <Routes>
          <Route path="/login" element={<LoginRoute />} />
          <Route path="/change-password" element={<ChangePassword />} />
          <Route path="/staff" element={<PortalAccessRoute portalCode="staff"><StaffPortal /></PortalAccessRoute>} />
          <Route path="/doctor" element={<PortalAccessRoute portalCode="doctor"><DoctorPortal /></PortalAccessRoute>} />
          <Route path="/receptionist/*" element={<PortalAccessRoute portalCode="receptionist"><ReceptionistPortal /></PortalAccessRoute>} />
          <Route path="/lab" element={<PortalAccessRoute portalCode="lab"><LabPortal /></PortalAccessRoute>} />
          <Route
            path="/pharmacy/*"
            element={
              <PortalAccessRoute portalCode="pharmacy">
                <PharmacyRequiresBranch>
                  <PharmacyPortal />
                </PharmacyRequiresBranch>
              </PortalAccessRoute>
            }
          />
          <Route
            path="/admin/*"
            element={
              <PortalAccessRoute portalCode="admin">
                <AdminRoutes />
              </PortalAccessRoute>
            }
          />

          <Route path="/employee/change-password" element={<EmployeeAuthRoute><EmployeeChangePasswordPage /></EmployeeAuthRoute>} />
          <Route path="/employee" element={<EmployeeRoute><EmployeeShellLayout /></EmployeeRoute>}>
            <Route path="dashboard" element={<EmployeeDashboardPage />} />
            <Route path="attendance" element={<EmployeePortalAttendancePage />} />
            <Route path="leaves" element={<EmployeeLeavesPage />} />
            <Route path="profile" element={<EmployeeProfilePage />} />
            <Route path="documents" element={<EmployeeDocumentsPage />} />
            <Route path="notifications" element={<EmployeeNotificationsPage />} />
            <Route path="holidays" element={<EmployeeHolidaysPage />} />
            <Route path="payslips" element={<EmployeePayslipsPage />} />
            <Route path="payslips/:id" element={<EmployeePayslipDetailPage />} />
            <Route index element={<Navigate to="/employee/dashboard" replace />} />
          </Route>
          <Route path="/hr" element={<HRRoute><HRShellLayout /></HRRoute>}>
            <Route index element={<HRHomeRedirect />} />
            <Route path="journey-center" element={<JourneyCenterPage />} />
            <Route path="journey-center/dashboard" element={<JourneyCenterDashboardPage />} />
            <Route path="journey-center/setup-wizard" element={<Navigate to="/hr/settings/organization" replace />} />
            <Route path="journey-center/intelligence" element={<Navigate to="/hr/journey-center" replace />} />
            <Route path="reports" element={<HRReportsPlaceholderPage />} />
            <Route path="recruitment/dashboard" element={<Navigate to="/hr/journey-center" replace />} />
            <Route path="recruitment/jobs" element={<RecruitmentJobsPage />} />
            <Route path="recruitment/candidates" element={<RecruitmentCandidatesPage />} />
            <Route path="recruitment/interviews" element={<RecruitmentInterviewsPage />} />
            <Route path="recruitment/offers" element={<RecruitmentOffersPage />} />
            <Route path="recruitment/offer-settings" element={<Navigate to="/hr/settings/organization/details" replace />} />
            <Route path="settings/organization" element={<OrganizationSettingsPage />} />
            <Route path="settings/organization/details" element={<OrganizationDetailsPage />} />
            <Route path="recruitment/job/:jobId/candidates" element={<JobCandidates />} />
            <Route path="onboarding" element={<OnboardingLegacyRedirect />} />
            <Route path="onboarding/document-verification" element={<OnboardingDocumentVerificationPage />} />
            <Route path="onboarding/pending-documents" element={<OnboardingPendingDocumentsPage />} />
            <Route path="onboarding/document-expiry" element={<Navigate to="/hr/onboarding/document-verification" replace />} />
            <Route path="verification" element={<Navigate to="/hr/onboarding/document-verification" replace />} />
            <Route path="checklist-rules" element={<ChecklistRules />} />
            <Route path="employees/create" element={<ManualEmployeeCreatePage />} />
            <Route path="designations" element={<DesignationsPage />} />
            <Route path="employees" element={<EmployeeDirectoryPage />} />
            <Route path="employees/inactive" element={<InactiveEmployeeDirectoryPage />} />
            <Route path="employees/:id" element={<EmployeeDetail />} />
            <Route path="employees/:id/edit" element={<EmployeeDetail />} />
            <Route path="employees/:id/documents" element={<EmployeeDocuments />} />
            <Route path="operations/departments" element={<OperationsDepartmentsPage />} />
            <Route path="operations/attendance" element={<OperationsAttendancePage />} />
            <Route path="operations/attendance/daily" element={<Navigate to="/hr/operations/attendance" replace />} />
            <Route path="attendance/calendar" element={<AttendanceCalendarPage />} />
            <Route path="attendance/generate-test" element={<GenerateTestAttendancePage />} />
            <Route path="operations/attendance/calendar" element={<Navigate to="/hr/attendance/calendar" replace />} />
            <Route path="employees/:id/attendance" element={<EmployeeAttendancePage />} />
            <Route path="operations/shifts" element={<ShiftManagementPage />} />
            <Route path="operations/shifts/new" element={<ShiftFormPage />} />
            <Route path="operations/shifts/:shiftId/edit" element={<ShiftFormPage />} />
            <Route path="operations/punch-logs" element={<PunchLogsPage />} />
            <Route path="operations/biometric-conflicts" element={<BiometricUnlinkedUsersPage />} />
            <Route path="operations/biometric-rejected-punches" element={<BiometricRejectedPunchesPage />} />
            <Route path="attendance-control" element={<AttendanceControlPage />} />
            <Route path="operations/regularizations" element={<RegularizationRequestsPage />} />
            <Route path="operations/holidays" element={<HolidayManagementPage />} />
            <Route path="leave/types" element={<LeaveTypesPage />} />
            <Route path="leave/policies/new" element={<LeavePolicyFormPage />} />
            <Route path="leave/policies" element={<LeavePoliciesPage />} />
            <Route path="leave/balances" element={<LeaveBalancesPage />} />
            <Route path="leave/requests" element={<LeaveRequestsPage />} />
            <Route path="operations/leave" element={<Navigate to="/hr/leave/requests" replace />} />
            <Route path="operations/salary" element={<OperationsSalaryPage />} />
            <Route path="payroll/compensation-levels" element={<CompensationLevelsPage />} />
            <Route path="payroll/compensation-levels/new" element={<CompensationLevelFormPage />} />
            <Route path="payroll/department-structures" element={<Navigate to="/hr/payroll/compensation-levels" replace />} />
            <Route path="payroll/structures" element={<SalaryStructuresPage />} />
            <Route path="payroll/assign" element={<AssignSalaryStructurePage />} />
            <Route path="payroll/assign/:employeeId" element={<AssignSalaryStructurePage />} />
            <Route path="payroll/runs" element={<PayrollRunsPage />} />
            <Route path="payroll/runs/:id" element={<PayrollRunDetailPage />} />
            <Route path="payroll/payslips" element={<PayrollPayslipsPage />} />
            <Route path="payroll/settings" element={<Navigate to="/hr/payroll/compensation-levels" replace />} />
            <Route path="operations/performance" element={<OperationsPerformancePage />} />
            <Route path="jobs/new" element={<JobForm />} />
            <Route path="jobs/:jobId/edit" element={<JobForm />} />
            <Route path="departments/new" element={<DepartmentForm />} />
            <Route path="candidates/:candidateId" element={<CandidateDetail />} />
            <Route path="offer-templates" element={<Navigate to="/hr/builder" replace />} />
            <Route path="builder" element={USE_NEW_OFFER_BUILDER ? <OfferLetterBuilderV2 /> : <OfferTemplateBuilder />} />
            <Route path="builder/:builderId" element={USE_NEW_OFFER_BUILDER ? <OfferLetterBuilderV2 /> : <OfferTemplateBuilder />} />
            <Route path="builder-v2" element={<BuilderLegacyRedirect />} />
            <Route path="builder-v2/:builderId" element={<BuilderLegacyRedirect />} />
            <Route path="offer-drafts" element={<OfferDrafts />} />
          </Route>
          <Route path="/offer/onboarding/:token" element={<DocumentUpload />} />
          <Route path="/tv/:roomCode" element={<TVDisplay />} />
          <Route path="/print-slip" element={<AuthenticatedRoute><PrintSlipPage /></AuthenticatedRoute>} />
          <Route path="/pharmacy-display" element={<PharmacySalesDisplay />} />
          <Route path="/" element={<HomeRedirect />} />
        </Routes>
      </Suspense>
    </ToastProvider>
  )
}
