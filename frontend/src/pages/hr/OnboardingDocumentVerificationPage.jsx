import { useEffect } from 'react';
import DocumentVerification from '../../components/HR/DocumentVerification';

export default function OnboardingDocumentVerificationPage() {
  useEffect(() => {
    document.title = 'Document Verification | HR';
  }, []);

  return <DocumentVerification />;
}
