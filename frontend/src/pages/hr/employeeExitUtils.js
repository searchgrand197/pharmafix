export const EXIT_REASON_OPTIONS = [
  { value: 'resignation', label: 'Resignation' },
  { value: 'termination', label: 'Termination' },
  { value: 'retirement', label: 'Retirement' },
  { value: 'contract_end', label: 'Contract End' },
  { value: 'absconding', label: 'Absconding' },
  { value: 'death', label: 'Death' },
  { value: 'other', label: 'Other' },
];

export const EXIT_REASON_LABELS = EXIT_REASON_OPTIONS.reduce((acc, option) => {
  acc[option.value] = option.label;
  return acc;
}, {});

export const EXITED_EMPLOYEE_STATUSES = new Set(['terminated', 'inactive']);

export function exitReasonLabel(value) {
  return EXIT_REASON_LABELS[value] || value || '—';
}
