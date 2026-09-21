/**
 * OPD slip display: patient honorific + guardian relation labels (must match backend OPDVisitSerializer salutation rules).
 */

const GUARDIAN_REL_LABEL = {
  s_o: 'S/o',
  d_o: 'D/o',
  w_o: 'W/o',
  f_o: 'F/o',
  m_o: 'M/o',
  h_o: 'H/o',
  guardian: 'Guardian',
}

/** Dropdown options for OPD / patient guardian relationship (stored code → DB `PatientGuardian.relationship`). */
export const GUARDIAN_RELATIONSHIP_OPTIONS = [
  { value: '', label: '—' },
  { value: 's_o', label: 'S/o (Son of)' },
  { value: 'd_o', label: 'D/o (Daughter of)' },
  { value: 'w_o', label: 'W/o (Wife of)' },
  { value: 'h_o', label: 'H/o (Husband of)' },
  { value: 'f_o', label: 'F/o (Father of)' },
  { value: 'm_o', label: 'M/o (Mother of)' },
  { value: 'guardian', label: 'Guardian' },
]

/**
 * Patient title dropdown. First option is blank (stored as ''): use age+gender rules.
 * `none` = explicitly no honorific on slip (stored as 'none' on Patient).
 */
export const SALUTATION_CHOICE_OPTIONS = [
  { value: 'none', label: '—' },
  { value: 'Mr', label: 'Mr.' },
  { value: 'Mrs', label: 'Mrs.' },
  { value: 'Master', label: 'Master.' },
  { value: 'Miss', label: 'Miss.' },
]

/**
 * Honorific for slips from form + Patient.preferred_salutation.
 * '' | unset → {@link formatPatientSalutation}; 'none' → no prefix; else explicit title.
 */
export function resolveSalutationForSlip(choice, gender, age, ageUnit = 'years') {
  const c = String(choice ?? '').trim()
  if (c === 'none') return ''
  if (!c || c === 'auto') return formatPatientSalutation(gender, age, ageUnit)
  return c
}

export function formatPatientSalutation(gender, age, ageUnit = 'years') {
  const g = String(gender || '').trim().toLowerCase()
  const a = age === null || age === undefined || age === '' ? null : Number(age)
  const ageNum = Number.isFinite(a) ? a : null
  const unit = String(ageUnit || 'years').trim().toLowerCase()
  const isChild = unit === 'months' || unit === 'days' || (ageNum !== null && ageNum < 18)
  if (isChild) {
    if (g === 'male') return 'Master'
    if (g === 'female') return 'Miss'
    return ''
  }
  if (g === 'male') return 'Mr'
  if (g === 'female') return 'Mrs'
  return ''
}

export function formatGuardianPrefix(relCode) {
  const key = String(relCode || '').trim().toLowerCase()
  if (!key) return ''
  return GUARDIAN_REL_LABEL[key] || ''
}

/**
 * Full patient line for slip: "Mr First Last"
 */
export function formatPatientLineForSlip(patientName, gender, age, salutationOverride, ageUnit = 'years') {
  const name = String(patientName || '').trim()
  const sal = salutationOverride !== undefined && salutationOverride !== null
    ? String(salutationOverride).trim()
    : formatPatientSalutation(gender, age, ageUnit)
  if (!name) return ''
  return sal ? `${sal} ${name}` : name
}

/**
 * Guardian line: "S/o Ram Kumar" when relationship code set; otherwise plain name.
 */
export function formatGuardianLineForSlip(guardianName, relationshipCode) {
  const name = String(guardianName || '').trim()
  if (!name) return ''
  const prefix = formatGuardianPrefix(relationshipCode)
  return prefix ? `${prefix} ${name}` : name
}
