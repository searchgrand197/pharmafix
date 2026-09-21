import { useCallback, useEffect, useMemo, useState } from 'react';
import { payrollApi } from '../../../api';
import {
  compensationLevelGross,
  formatCurrency,
  groupLatestLevelsPerCode,
  normalizePayrollList,
} from './payrollUtils';

export function pickDefaultCompensationLevelId(levels = []) {
  if (!levels.length) return '';
  const grouped = groupLatestLevelsPerCode(levels);
  const defaultLevel = grouped.find((row) => row.is_default_for_designation)
    || grouped.find((row) => Number(row.rank) === 0)
    || grouped[0];
  return defaultLevel?.id || '';
}

export function formatCompensationLevelOption(level) {
  if (!level) return '';
  const gross = formatCurrency(compensationLevelGross(level));
  return `${level.name} (${level.code}) — ${gross}`;
}

export function useCompensationLevelsForDesignation(designationId) {
  const [levels, setLevels] = useState([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!designationId) {
      setLevels([]);
      return;
    }
    setLoading(true);
    try {
      const { data } = await payrollApi.get('/compensation-levels/', {
        params: { active: 'true', designation: designationId },
      });
      setLevels(groupLatestLevelsPerCode(normalizePayrollList(data)));
    } catch {
      setLevels([]);
    } finally {
      setLoading(false);
    }
  }, [designationId]);

  useEffect(() => {
    load();
  }, [load]);

  const defaultLevelId = useMemo(() => pickDefaultCompensationLevelId(levels), [levels]);

  return { levels, loading, defaultLevelId, reload: load };
}
