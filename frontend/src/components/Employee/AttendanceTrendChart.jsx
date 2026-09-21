import React, { useMemo } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

export default function AttendanceTrendChart({ history = [] }) {
  const data = useMemo(() => {
    return (history || []).map((row) => ({
      day: Number(row.date?.slice(-2) || 0),
      hours: Number(row.worked_hours || 0),
      late: Number(row.late_minutes || 0),
      ot: Number(row.overtime_hours || 0),
    }));
  }, [history]);

  if (!data.length) {
    return (
      <p className="rounded-xl border border-dashed border-gray-300 px-4 py-6 text-center text-sm text-gray-500">
        No attendance data for this month.
      </p>
    );
  }

  return (
    <div className="h-56 w-full min-w-0">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e7eb" />
          <XAxis dataKey="day" tick={{ fontSize: 11 }} />
          <YAxis tick={{ fontSize: 11 }} width={32} />
          <Tooltip
            formatter={(value, name) => {
              if (name === 'hours') return [`${value} hrs`, 'Worked'];
              if (name === 'ot') return [`${value} hrs`, 'Overtime'];
              if (name === 'late') return [`${value} min`, 'Late'];
              return [value, name];
            }}
            labelFormatter={(label) => `Day ${label}`}
          />
          <Bar dataKey="hours" fill="#0d9488" radius={[4, 4, 0, 0]} name="hours" />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
