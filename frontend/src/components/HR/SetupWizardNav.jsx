import React from 'react';
import { Link, useLocation, useSearchParams } from 'react-router-dom';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import {
  getSetupWizardNeighbors,
  isFromSetupWizard,
  withSetupWizardReturn,
} from '../../pages/hr/setupWizardUtils';

export default function SetupWizardNav({ className = '' }) {
  const { pathname } = useLocation();
  const [searchParams] = useSearchParams();

  if (!isFromSetupWizard(searchParams)) return null;

  const { previous, next } = getSetupWizardNeighbors(pathname);
  if (!previous && !next) return null;

  return (
    <div className={`flex flex-wrap items-center justify-between gap-3 ${className}`}>
      {previous ? (
        <Link
          to={withSetupWizardReturn(previous.route)}
          className="inline-flex items-center gap-1.5 rounded-lg border border-violet-200 px-4 py-2.5 text-sm font-semibold text-violet-700 hover:bg-violet-50"
        >
          <ChevronLeft size={16} />
          Previous: {previous.label}
        </Link>
      ) : (
        <span />
      )}
      {next ? (
        <Link
          to={withSetupWizardReturn(next.route)}
          className="inline-flex items-center gap-1.5 rounded-lg bg-violet-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-violet-700"
        >
          Next: {next.label}
          <ChevronRight size={16} />
        </Link>
      ) : null}
    </div>
  );
}
