const ONBOARDING_ACTION_LABELS = {
  activate: 'Activate',
  review: 'Review docs',
  reupload: 'View re-upload',
  wait: 'View checklist',
  documents: 'Open documents',
};

function onboardingIssueText(row) {
  if (row.next_action === 'activate') return 'All documents done — activate employee';
  if (row.next_action === 'review') {
    return `${row.documents_awaiting_review} document(s) waiting for HR review`;
  }
  if (row.next_action === 'reupload') {
    return `${row.reupload_pending} re-upload request(s) open`;
  }
  if (row.next_action === 'wait') {
    return row.missing_documents?.length
      ? `Waiting: ${row.missing_documents.slice(0, 3).join(', ')}`
      : 'Waiting for candidate uploads';
  }
  return 'Continue document verification';
}

const ONBOARDING_TASK_CONFIG = {
  activate: {
    category: 'ready_to_activate',
    priority: 'medium',
    recommendedAction: 'Activate employee to complete onboarding',
  },
  review: {
    category: 'pending_document_review',
    priority: 'critical',
    recommendedAction: 'Review and verify uploaded documents',
  },
  reupload: {
    category: 'pending_document_review',
    priority: 'critical',
    recommendedAction: 'Follow up on re-upload requests',
  },
  wait: {
    category: 'onboarding_waiting_docs',
    priority: 'low',
    recommendedAction: 'Track missing uploads or open the joiner checklist',
  },
  documents: {
    category: 'mandatory_docs',
    priority: 'medium',
    recommendedAction: 'Complete mandatory document checklist',
  },
};

function taskBase(employee, fields) {
  return {
    employeeId: employee?.id || fields.employeeId || '',
    employeeCode: employee?.employee_id || fields.employeeCode || '—',
    employeeName: employee?.name || fields.employeeName || 'Unknown',
    ...fields,
  };
}

function employeeFromOnboardingRow(row) {
  return {
    id: row.id,
    employee_id: row.employee_id || row.email,
    name: row.name,
    status: row.status,
  };
}

/** One onboarding document task per joiner — uses API next_action to avoid duplicate rows. */
export function buildOnboardingEmployeeTasks(onboardingEmployees = []) {
  const tasks = [];

  onboardingEmployees.forEach((row) => {
    const action = row.next_action || 'documents';
    const config = ONBOARDING_TASK_CONFIG[action] || ONBOARDING_TASK_CONFIG.documents;
    const emp = employeeFromOnboardingRow(row);
    const actionLabel = ONBOARDING_ACTION_LABELS[action] || ONBOARDING_ACTION_LABELS.documents;

    tasks.push(taskBase(emp, {
      id: `onboarding:${emp.id}`,
      employeeCode: row.email || row.employee_id || emp.name,
      subjectSubtitle: row.job_title || row.department || 'Onboarding',
      priority: config.priority,
      category: config.category,
      issue: onboardingIssueText(row),
      recommendedAction: config.recommendedAction,
      actionLabel,
      actionRoute: `/hr/onboarding/document-verification?employee=${emp.id}`,
    }));
  });

  return tasks;
}

export function onboardingDocumentVerificationRoute(employeeId) {
  return `/hr/onboarding/document-verification?employee=${employeeId}`;
}
