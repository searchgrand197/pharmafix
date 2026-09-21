/**
 * HR sidebar navigation — Phase A structure.
 * Routes unchanged; labels and grouping only.
 */

export const HR_SIDEBAR_TOP_LINKS = [
  { id: 'hr-dashboard', label: 'HR Dashboard', to: '/hr/journey-center/dashboard', icon: 'layoutDashboard', end: true },
];

export const HR_SIDEBAR_JOURNEY_SUB_LINKS = [
  { label: 'Hire Staff', to: '/hr/journey-center', icon: 'star' },
];

export const HR_SIDEBAR_SECTIONS = [
  {
    id: 'recruitment',
    label: 'Recruitment',
    pathPrefixes: [
      '/hr/recruitment/jobs',
      '/hr/recruitment/candidates',
      '/hr/recruitment/interviews',
      '/hr/recruitment/offers',
    ],
    items: [
      { label: 'Jobs', to: '/hr/recruitment/jobs', icon: 'briefcase' },
      { label: 'Candidates', to: '/hr/recruitment/candidates', icon: 'userPlus' },
      { label: 'Interviews', to: '/hr/recruitment/interviews', icon: 'calendar' },
      { label: 'Offers', to: '/hr/recruitment/offers', icon: 'fileCheck' },
    ],
  },
  {
    id: 'onboarding',
    label: 'Onboarding',
    pathPrefixes: [
      '/hr/onboarding',
    ],
    items: [
      { label: 'Document Verification', to: '/hr/onboarding/document-verification', icon: 'fileCheck' },
      { label: 'Pending Documents', to: '/hr/onboarding/pending-documents', icon: 'clipboardList' },
    ],
  },
  {
    id: 'workforce',
    label: 'Workforce',
    pathPrefixes: ['/hr/employees', '/hr/designations'],
    items: [
      { label: 'Employee Directory', to: '/hr/employees', icon: 'users' },
      { label: 'Inactive Employees', to: '/hr/employees/inactive', icon: 'fileCheck' },
      { label: 'Designations', to: '/hr/designations', icon: 'briefcase' },
    ],
  },
  {
    id: 'attendance',
    label: 'Attendance',
    pathPrefixes: [
      '/hr/operations/attendance',
      '/hr/attendance/calendar',
      '/hr/operations/punch-logs',
      '/hr/operations/biometric-conflicts',
      '/hr/operations/regularizations',
      '/hr/operations/shifts',
      '/hr/operations/holidays',
      '/hr/attendance-control',
    ],
    items: [
      { label: 'Attendance Dashboard', to: '/hr/operations/attendance', icon: 'clock' },
      { label: 'Calendar', to: '/hr/attendance/calendar', icon: 'calendar' },
      { label: 'Punch Logs', to: '/hr/operations/punch-logs', icon: 'clock' },
      { label: 'Device conflicts', to: '/hr/operations/biometric-conflicts', icon: 'clipboardList' },
      { label: 'Regularizations', to: '/hr/operations/regularizations', icon: 'clipboardList' },
      { label: 'Shifts', to: '/hr/operations/shifts', icon: 'calendar' },
      { label: 'Holidays', to: '/hr/operations/holidays', icon: 'calendar' },
      { label: 'Simulation', to: '/hr/attendance-control', icon: 'flask' },
    ],
  },
  {
    id: 'leave',
    label: 'Leave',
    pathPrefixes: ['/hr/leave'],
    items: [
      { label: 'Leave Requests', to: '/hr/leave/requests', icon: 'calendar' },
      { label: 'Leave Policies', to: '/hr/leave/policies', icon: 'calendar' },
      { label: 'Leave Balances', to: '/hr/leave/balances', icon: 'calendar' },
      { label: 'Leave Types', to: '/hr/leave/types', icon: 'calendar' },
    ],
  },
  {
    id: 'payroll',
    label: 'Payroll',
    pathPrefixes: ['/hr/payroll'],
    items: [
      { label: 'Compensation Levels', to: '/hr/payroll/compensation-levels', icon: 'briefcase' },
      { label: 'Payroll Runs', to: '/hr/payroll/runs', icon: 'wallet' },
      { label: 'Payslips', to: '/hr/payroll/payslips', icon: 'fileCheck' },
    ],
  },
];

export const HR_SIDEBAR_REPORTS_LINK = {
  id: 'reports',
  label: 'Reports & Analytics',
  to: '/hr/reports',
  icon: 'barChart',
};

export const HR_SIDEBAR_ORG_SETTINGS_LINK = {
  id: 'organization-settings',
  label: 'Organization Settings',
  to: '/hr/settings/organization',
  icon: 'settings',
};

export const HR_MOBILE_NAV_LINKS = [
  { label: 'HR Dashboard', to: '/hr/journey-center/dashboard' },
  { label: 'Hire Staff', to: '/hr/journey-center' },
  { label: 'Jobs', to: '/hr/recruitment/jobs' },
  { label: 'Onboarding', to: '/hr/onboarding/document-verification' },
  { label: 'Employees', to: '/hr/employees' },
  { label: 'Inactive Employees', to: '/hr/employees/inactive' },
  { label: 'Attendance', to: '/hr/operations/attendance' },
  { label: 'Leave', to: '/hr/leave/requests' },
  { label: 'Payroll', to: '/hr/payroll/runs' },
  { label: 'Reports', to: '/hr/reports' },
  { label: 'Organization Settings', to: '/hr/settings/organization' },
];

export function isSectionPathActive(pathname, section) {
  return (section.pathPrefixes || []).some((prefix) => pathname.startsWith(prefix));
}
