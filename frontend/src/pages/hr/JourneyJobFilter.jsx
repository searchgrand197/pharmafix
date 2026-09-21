import React, { useCallback, useEffect, useMemo, useState } from 'react';
import api from '../../api';
import { normalizeApiList } from '../../hr/recruitmentLifecycle';

/**
 * Shared job-opening filter dropdown for Journey Center and related HR flows.
 */
export default function JourneyJobFilter({
  value,
  onChange,
  className = '',
  id = 'journey-job-filter',
}) {
  const [jobs, setJobs] = useState([]);
  const [loading, setLoading] = useState(true);

  const loadJobs = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get('/hr/job-openings/', { params: { limit: 300 } });
      setJobs(normalizeApiList(data));
    } catch {
      setJobs([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadJobs();
  }, [loadJobs]);

  const sortedJobs = useMemo(
    () =>
      [...jobs].sort((a, b) =>
        (a.title || '').localeCompare(b.title || '', undefined, { sensitivity: 'base' }),
      ),
    [jobs],
  );

  const selectedTitle = sortedJobs.find((j) => String(j.id) === String(value))?.title;

  return (
    <div className={`flex flex-col gap-1 ${className}`}>
      <label htmlFor={id} className="text-xs font-semibold uppercase tracking-wide text-gray-500">
        Filter by job
      </label>
      <select
        id={id}
        className="min-w-[12rem] rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm"
        value={value || ''}
        onChange={(e) => onChange(e.target.value)}
        disabled={loading}
      >
        <option value="">All jobs</option>
        {sortedJobs.map((j) => (
          <option key={j.id} value={j.id}>
            {j.title}
          </option>
        ))}
      </select>
      {value && selectedTitle && (
        <p className="text-xs text-gray-500">
          Counts are for <span className="font-medium text-gray-700">{selectedTitle}</span>. Direct hires are not included.
        </p>
      )}
    </div>
  );
}
