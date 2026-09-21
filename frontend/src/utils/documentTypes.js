/** Keep in sync with DOCUMENT_TYPE_ALIASES in apps/hr/onboarding_documents.py */
const DOCUMENT_TYPE_ALIASES = {
  aadhar: 'aadhaar',
  aadhaar: 'aadhaar',
  'aadhar card': 'aadhaar',
  pan: 'pan',
  'pan card': 'pan',
  resume: 'resume',
  resumes: 'resume',
  cv: 'resume',
  degree: 'degree certificate',
  education: 'degree certificate',
  educational: 'degree certificate',
  'experience certificate': 'degree certificate',
  'experince certificate': 'degree certificate',
  bank: 'bank details',
  bank_details: 'bank details',
  'bank account': 'bank details',
  'bank copy': 'bank details',
  'cancelled cheque': 'bank details',
  'canceled cheque': 'bank details',
};

export function normalizeDocumentTypeName(name) {
  const key = (name || '').trim().toLowerCase();
  if (!key) return key;
  return DOCUMENT_TYPE_ALIASES[key] || key;
}

export function dedupeDocumentTypes(rows = []) {
  const chosen = new Map();
  const score = (row) =>
    (row.hospital ? 2 : 0) + (row.is_active !== false ? 1 : 0);

  for (const row of rows) {
    const key = normalizeDocumentTypeName(row.name);
    if (!key) continue;
    const existing = chosen.get(key);
    if (!existing || score(row) > score(existing)) {
      chosen.set(key, row);
    }
  }

  return [...chosen.values()].sort((a, b) => (a.name || '').localeCompare(b.name || ''));
}
