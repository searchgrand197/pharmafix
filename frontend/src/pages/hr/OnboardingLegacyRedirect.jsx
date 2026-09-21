import { Navigate, useSearchParams } from 'react-router-dom';

const FILTER_REDIRECTS = {
  pending_documents: '/hr/onboarding/document-verification',
  expiring_documents: '/hr/onboarding/document-verification',
};

const DEFAULT_ONBOARDING_ROUTE = '/hr/onboarding/document-verification';

export default function OnboardingLegacyRedirect() {
  const [searchParams] = useSearchParams();
  const filter = (searchParams.get('filter') || '').trim();
  const target = FILTER_REDIRECTS[filter] || DEFAULT_ONBOARDING_ROUTE;
  return <Navigate to={target} replace />;
}
