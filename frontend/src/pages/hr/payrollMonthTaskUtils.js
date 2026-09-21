const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

function daysInMonth(year, month) {
  return new Date(year, month, 0).getDate();
}

/** True during the last N calendar days of the month (default: last 3). */
export function isPayrollMonthEndWindow(date = new Date(), daysBeforeEnd = 3) {
  const year = date.getFullYear();
  const month = date.getMonth() + 1;
  const day = date.getDate();
  const lastDay = daysInMonth(year, month);
  return day >= lastDay - (daysBeforeEnd - 1);
}

export function formatPayrollMonthLabel(month) {
  if (!month || month.length < 7) return month || 'This month';
  const [year, mon] = month.split('-').map(Number);
  if (!year || !mon) return month;
  return `${MONTH_NAMES[mon - 1] || month} ${year}`;
}

export function payrollRunsRoute(month) {
  return `/hr/payroll/runs?month=${month}`;
}

const PAYROLL_MONTH_TASKS = {
  finalize_attendance: {
    category: 'finalize_attendance',
    priority: 'critical',
    actionLabel: 'Run payroll',
    recommendedAction: 'Run monthly payroll — attendance closes automatically',
    issue: (label) => `Ready to run payroll for ${label}`,
  },
  calculate_payroll: {
    category: 'calculate_payroll',
    priority: 'critical',
    actionLabel: 'Run payroll',
    recommendedAction: 'Run monthly payroll for eligible employees',
    issue: (label) => `Run payroll for ${label}`,
  },
  review_payroll: {
    category: 'review_payroll',
    priority: 'medium',
    actionLabel: 'Review payroll',
    recommendedAction: 'Review calculated pay amounts and approve',
    issue: (label) => `Payroll needs review for ${label}`,
  },
};

function taskBase(fields) {
  return {
    employeeId: '',
    employeeCode: '—',
    employeeName: 'Payroll month',
    subjectType: 'payroll_month',
    ...fields,
  };
}

/** One month-level payroll pipeline task from readiness API next_action. */
export function buildPayrollMonthTasks(payrollMonthReadiness, { today } = {}) {
  const readiness = payrollMonthReadiness || {};
  const action = readiness.next_action || 'none';
  if (action === 'none') return [];
  if (!isPayrollMonthEndWindow(today ?? new Date())) return [];

  const config = PAYROLL_MONTH_TASKS[action];
  if (!config) return [];

  const month = readiness.month || '';
  const label = formatPayrollMonthLabel(month);

  return [
    taskBase({
      id: `${config.category}:${month}`,
      priority: config.priority,
      category: config.category,
      subjectSubtitle: label,
      issue: config.issue(label),
      recommendedAction: config.recommendedAction,
      actionLabel: config.actionLabel,
      actionRoute: payrollRunsRoute(month),
    }),
  ];
}
