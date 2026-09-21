export const WHO_GETS_OPTIONS = [
  { value: 'DEPARTMENT', label: 'By departments' },
  { value: 'DESIGNATION', label: 'By designation' },
];

/** Default days per leave type code (matches backend seed). */
export const STANDARD_DAYS_BY_CODE = {
  CL: { days: '12', unlimited: false },
  SL: { days: '12', unlimited: false },
  EL: { days: '18', unlimited: false },
  LWP: { days: '', unlimited: true },
};

function defaultLineForLeaveType(lt) {
  const hasLimit = lt.annual_limit != null && lt.annual_limit !== '';
  return {
    leave_type: lt.id,
    leave_type_name: lt.name,
    allocated_days: hasLimit ? String(lt.annual_limit) : (lt.is_paid === false ? '' : '12'),
    is_unlimited: !hasLimit && lt.is_paid === false,
  };
}

export function buildPolicyLines(leaveTypes, preset = 'standard') {
  if (preset === 'empty') return [];
  if (!leaveTypes?.length) return [];

  if (preset === 'standard') {
    const included = new Set();
    const lines = [];

    for (const lt of leaveTypes) {
      const code = (lt.code || '').toUpperCase();
      const standard = STANDARD_DAYS_BY_CODE[code];
      if (standard) {
        lines.push({
          leave_type: lt.id,
          leave_type_name: lt.name,
          allocated_days: standard.days,
          is_unlimited: standard.unlimited,
        });
        included.add(lt.id);
      }
    }

    for (const lt of leaveTypes) {
      if (included.has(lt.id)) continue;
      lines.push(defaultLineForLeaveType(lt));
    }

    return lines;
  }

  return leaveTypes.map((lt) => ({
    leave_type: lt.id,
    leave_type_name: lt.name,
    allocated_days: lt.annual_limit != null && lt.annual_limit !== '' ? String(lt.annual_limit) : '12',
    is_unlimited: false,
  }));
}

function formatNameList(names = [], singular, plural) {
  const clean = (names || []).filter(Boolean);
  if (!clean.length) return singular;
  if (clean.length <= 3) return `${plural}: ${clean.join(', ')}`;
  return `${plural}: ${clean.slice(0, 3).join(', ')} +${clean.length - 3} more`;
}

export function formatPolicyWho(row) {
  if (row.assignment_type === 'DESIGNATION') {
    return formatNameList(row.designation_names, 'By designation', 'Designations');
  }
  return formatNameList(row.department_names, 'By departments', 'Departments');
}

export function formatEntitlementSummary(lines = []) {
  if (!lines.length) return 'No leave types set';
  return lines
    .map((line) => {
      const label = line.leave_type_name || 'Leave';
      if (line.is_unlimited) return `${label}: Unlimited`;
      const days = line.allocated_days ?? '0';
      return `${label}: ${days} days/year`;
    })
    .join(' · ');
}

export function assignmentLabel(value) {
  return WHO_GETS_OPTIONS.find((o) => o.value === value)?.label || value;
}

export function toggleIdInList(list, id) {
  const next = new Set(list || []);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return [...next];
}

/** Stable snapshot for dirty-checking the leave package form. */
export function normalizePolicyFormSnapshot(form) {
  const sorted = (ids = []) => [...ids].map(String).sort();
  const lines = (form.lines || [])
    .filter((line) => line.leave_type)
    .map((line) => ({
      leave_type: String(line.leave_type),
      allocated_days: line.is_unlimited ? '' : String(line.allocated_days ?? ''),
      is_unlimited: !!line.is_unlimited,
    }))
    .sort((a, b) => a.leave_type.localeCompare(b.leave_type));

  return {
    name: (form.name || '').trim(),
    assignment_type: form.assignment_type || 'DEPARTMENT',
    departments: form.assignment_type === 'DEPARTMENT' ? sorted(form.departments) : [],
    designations: form.assignment_type === 'DESIGNATION' ? sorted(form.designations) : [],
    lines,
  };
}

export function isPolicyFormDirty(form, baseline) {
  if (!baseline) return false;
  return JSON.stringify(normalizePolicyFormSnapshot(form))
    !== JSON.stringify(normalizePolicyFormSnapshot(baseline));
}

export function formFromPolicy(policy) {
  if (!policy) {
    return {
      name: '',
      assignment_type: 'DEPARTMENT',
      departments: [],
      designations: [],
      is_default: false,
      is_active: true,
      lines: [],
    };
  }
  return {
    name: policy.name || '',
    assignment_type: policy.assignment_type || 'DEPARTMENT',
    departments: (policy.departments || []).map(String),
    designations: (policy.designations || []).map(String),
    is_default: !!policy.is_default,
    is_active: policy.is_active !== false,
    lines: (policy.lines || []).map((line) => ({
      id: line.id,
      leave_type: line.leave_type,
      leave_type_name: line.leave_type_name,
      allocated_days: line.allocated_days ?? '',
      is_unlimited: !!line.is_unlimited,
    })),
  };
}

export function buildPolicyPayload(form) {
  return {
    name: form.name.trim(),
    description: '',
    assignment_type: form.assignment_type,
    departments: form.assignment_type === 'DEPARTMENT' ? form.departments : [],
    designations: form.assignment_type === 'DESIGNATION' ? form.designations : [],
    is_default: false,
    is_active: true,
    lines: form.lines.filter((l) => l.leave_type).map((line) => ({
      id: line.id,
      leave_type: line.leave_type,
      allocated_days: line.is_unlimited || line.allocated_days === '' ? null : line.allocated_days,
      is_unlimited: line.is_unlimited,
    })),
  };
}
