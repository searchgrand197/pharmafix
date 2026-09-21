import { Navigate, useSearchParams } from 'react-router-dom';

const TAB_REDIRECTS = {
  recruitment: '/hr/journey-center',
  onboarding: '/hr/onboarding/document-verification',
  attendance: '/hr/operations/attendance',
  leave: '/hr/leave/requests',
  salary: '/hr/payroll/runs',
  performance: '/hr/operations/performance',
};

export default function HRHomeRedirect() {
  const [params] = useSearchParams();
  const tab = params.get('tab');
  const target = TAB_REDIRECTS[tab] || '/hr/journey-center/dashboard';
  return <Navigate to={target} replace />;
}
