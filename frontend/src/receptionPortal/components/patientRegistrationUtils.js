import api from '../../api'

export const INDIAN_STATE_OPTIONS = [
  'Andhra Pradesh',
  'Arunachal Pradesh',
  'Assam',
  'Bihar',
  'Chhattisgarh',
  'Goa',
  'Gujarat',
  'Haryana',
  'Himachal Pradesh',
  'Jharkhand',
  'Karnataka',
  'Kerala',
  'Madhya Pradesh',
  'Maharashtra',
  'Manipur',
  'Meghalaya',
  'Mizoram',
  'Nagaland',
  'Odisha',
  'Punjab',
  'Rajasthan',
  'Sikkim',
  'Tamil Nadu',
  'Telangana',
  'Tripura',
  'Uttar Pradesh',
  'Uttarakhand',
  'West Bengal',
  'Andaman and Nicobar Islands',
  'Chandigarh',
  'Dadra and Nagar Haveli and Daman and Diu',
  'Delhi',
  'Jammu and Kashmir',
  'Ladakh',
  'Lakshadweep',
  'Puducherry',
]

const AGE_UNIT_OPTIONS = [
  { value: 'years', label: 'Yrs' },
  { value: 'months', label: 'Mon' },
  { value: 'days', label: 'Days' },
]

export function normalizeAgeUnit(unit) {
  const u = String(unit || 'years').trim().toLowerCase()
  return u === 'months' || u === 'days' ? u : 'years'
}

export function sanitizePersonName(value) {
  return String(value || '').replace(/[0-9]/g, '')
}

export function capitalizePersonName(value) {
  return String(value || '')
    .split(' ')
    .map((part) => (part ? `${part.charAt(0).toUpperCase()}${part.slice(1).toLowerCase()}` : ''))
    .join(' ')
}

export function isPhoneLikeSearch(raw) {
  const trimmed = String(raw || '').trim()
  if (!trimmed) return false
  const digitsOnly = trimmed.replace(/\D/g, '')
  const looksLikePhone = /^[\d\s\-+()]+$/.test(trimmed) && digitsOnly.length > 0
  return looksLikePhone && digitsOnly.length >= 10 && !/[a-zA-Z]/.test(trimmed)
}

export function splitFullName(fullName) {
  const cleaned = capitalizePersonName(sanitizePersonName(String(fullName || '').trim())).replace(/\s+/g, ' ')
  const parts = cleaned.split(' ').filter(Boolean)
  return {
    first_name: parts[0] || '',
    last_name: parts.slice(1).join(' ') || '',
  }
}

export function buildPatientRegistrationInitialFromSearch(searchText = '', defaults = {}) {
  if (isPhoneLikeSearch(searchText)) {
    const digits = String(searchText).replace(/\D/g, '').slice(-10)
    return { ...buildPatientRegistrationInitial('', defaults), phone: digits }
  }
  return buildPatientRegistrationInitial(searchText, defaults)
}

export function buildPatientRegistrationInitial(initialFullName = '', defaults = {}) {
  const { defaultCity = '', defaultState = '' } = defaults
  const cleaned = capitalizePersonName(sanitizePersonName(String(initialFullName || '').trim())).replace(/\s+/g, ' ')
  return {
    salutation_choice: '',
    full_name: cleaned,
    age: '',
    ageUnit: 'years',
    gender: 'male',
    phone: '',
    blood_group: '',
    guardian_name: '',
    guardian_relationship: '',
    address_line1: '',
    city: defaultCity,
    state: defaultState,
    registration_note: '',
    emergency_tags: '',
  }
}

export function buildPatientRegistrationPayload(form) {
  const { first_name, last_name } = splitFullName(form.full_name)
  const normalizedLastName =
    String(last_name || '').trim().toLowerCase() === 'patient' ? '' : last_name.trim()
  const phoneDigits = String(form.phone || '').replace(/\D/g, '')
  return {
    first_name: first_name.trim(),
    last_name: normalizedLastName,
    gender: form.gender || 'male',
    patient_type: 'outpatient',
    phone: phoneDigits ? phoneDigits.slice(-10) : '',
    blood_group: form.blood_group || '',
    ...(form.age ? { age: parseInt(form.age, 10), age_unit: normalizeAgeUnit(form.ageUnit) } : {}),
    address_line1: String(form.address_line1 || '').trim(),
    city: String(form.city || '').trim(),
    state: String(form.state || '').trim(),
    guardian_name: capitalizePersonName(form.guardian_name).trim(),
    guardian_relationship: form.guardian_relationship || '',
    preferred_salutation: form.salutation_choice ?? '',
    registration_note: String(form.registration_note || '').trim() || undefined,
    emergency_tags: String(form.emergency_tags || '').trim(),
  }
}

export function validatePatientRegistrationForm(form) {
  if (!String(form.full_name || '').trim()) {
    return 'Full name is required'
  }
  const phoneDigits = String(form.phone || '').replace(/\D/g, '')
  if (phoneDigits && phoneDigits.length < 10) {
    return 'Enter a valid 10-digit mobile number'
  }
  return null
}

export async function findExistingPatientByPhone(phoneDigits) {
  if (!phoneDigits || phoneDigits.length < 10) return null
  try {
    const ten = phoneDigits.slice(-10)
    const { data } = await api.get(`/patients/by-phone/?phone=${encodeURIComponent(ten)}`)
    const matches = Array.isArray(data?.data) ? data.data : []
    return matches.length > 0 ? matches[0] : null
  } catch {
    return null
  }
}

export async function registerPatientFromForm(form) {
  const validationError = validatePatientRegistrationForm(form)
  if (validationError) {
    throw new Error(validationError)
  }
  const phoneDigits = String(form.phone || '').replace(/\D/g, '')
  const existing = await findExistingPatientByPhone(phoneDigits)
  if (existing) {
    throw new Error(`Patient already exists with this phone. Select existing patient UHID ${existing.uhid}.`)
  }
  const payload = buildPatientRegistrationPayload(form)
  const { data } = await api.post('/patients/', payload)
  return data?.data || data?.entity || data
}

export { AGE_UNIT_OPTIONS }
