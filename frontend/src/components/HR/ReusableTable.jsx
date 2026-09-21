import React from 'react';

export default function ReusableTable({
  columns,
  data,
  keyField = 'id',
  leadingColumn = null,
}) {
  if (!data || data.length === 0) {
    return (
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-8 text-center text-gray-500">
        No data available.
      </div>
    );
  }

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-x-auto">
      <table className="w-full text-left border-collapse">
        <thead>
          <tr className="bg-gray-50 border-b border-gray-100 text-xs uppercase tracking-wider text-gray-500">
            {leadingColumn ? (
              <th className="w-12 px-4 py-3 font-semibold">{leadingColumn.header}</th>
            ) : null}
            {columns.map((col, idx) => (
              <th key={idx} className="px-6 py-3 font-semibold">
                {col.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-50 text-sm">
          {data.map((row, index) => (
            <tr key={row[keyField]} className="hover:bg-gray-50/50 transition-colors">
              {leadingColumn ? (
                <td className="px-4 py-4 text-gray-700">{leadingColumn.render(row, index)}</td>
              ) : null}
              {columns.map((col, idx) => (
                <td key={idx} className="px-6 py-4 text-gray-700">
                  {col.render ? col.render(row, index) : row[col.accessor]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
