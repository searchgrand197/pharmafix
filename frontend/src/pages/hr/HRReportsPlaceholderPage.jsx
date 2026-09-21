import React, { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { BarChart3 } from 'lucide-react';

export default function HRReportsPlaceholderPage() {
  useEffect(() => {
    document.title = 'Reports & Analytics | HR';
  }, []);

  return (
    <div className="mx-auto flex max-w-lg flex-col items-center justify-center px-4 py-20 text-center">
      <BarChart3 size={48} className="text-indigo-400" />
      <h1 className="mt-4 text-2xl font-bold text-gray-900">Reports &amp; Analytics</h1>
      <p className="mt-3 text-sm text-gray-600">
        Reports module coming in next phase.
      </p>
      <Link
        to="/hr/journey-center"
        className="mt-6 inline-flex rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-semibold text-violet-700 hover:bg-violet-50"
      >
        Back to Hire Staff
      </Link>
    </div>
  );
}
