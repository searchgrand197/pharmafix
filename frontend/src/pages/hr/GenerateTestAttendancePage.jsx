import React from 'react';
import { FlaskConical } from 'lucide-react';
import MonthAttendanceGeneratorPanel from './MonthAttendanceGeneratorPanel';

export default function GenerateTestAttendancePage() {
  return (
    <div className="mx-auto max-w-4xl space-y-6 p-4 md:p-6">
      <div className="flex items-start gap-3">
        <div className="rounded-lg bg-indigo-50 p-2 text-indigo-700">
          <FlaskConical size={22} />
        </div>
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Generate Test Attendance</h1>
          <p className="mt-1 text-sm text-gray-600">
            Standalone page for bulk month generation. You can also use Biometric Simulator → Generate full month.
          </p>
        </div>
      </div>

      <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
        <MonthAttendanceGeneratorPanel />
      </div>
    </div>
  );
}
