import api from '../../api'

export const QUICK_SERVICES_STORAGE_KEY = 'payment_quick_services'
export const QUICK_SERVICE_CATEGORIES_STORAGE_KEY = 'payment_quick_service_categories'
export const QUICK_SERVICE_DEFAULT_CATEGORY = 'Custom'
export const QUICK_SERVICE_ALL_CATEGORY = 'All'

export const DEFAULT_QUICK_SERVICES = [
  { label: 'X-Ray', category: QUICK_SERVICE_DEFAULT_CATEGORY, price: 300 },
  { label: 'ECG', category: QUICK_SERVICE_DEFAULT_CATEGORY, price: 200 },
  { label: 'Blood Test (CBC)', category: QUICK_SERVICE_DEFAULT_CATEGORY, price: 250 },
  { label: 'Urine Test', category: QUICK_SERVICE_DEFAULT_CATEGORY, price: 150 },
  { label: 'OPD Consultation', category: QUICK_SERVICE_DEFAULT_CATEGORY, price: 500 },
  { label: 'Dressing', category: QUICK_SERVICE_DEFAULT_CATEGORY, price: 100 },
  { label: 'Injection', category: QUICK_SERVICE_DEFAULT_CATEGORY, price: 80 },
  { label: 'Ultrasound', category: QUICK_SERVICE_DEFAULT_CATEGORY, price: 600 },
  { label: 'MRI', category: QUICK_SERVICE_DEFAULT_CATEGORY, price: 3500 },
  { label: 'CT Scan', category: QUICK_SERVICE_DEFAULT_CATEGORY, price: 2500 },
]

export function normalizeQuickService(service) {
  const label = String(service?.label || '').trim()
  const price = Number(service?.price || 0)
  const category = String(service?.category || QUICK_SERVICE_DEFAULT_CATEGORY).trim() || QUICK_SERVICE_DEFAULT_CATEGORY
  return { label, price, category }
}

export function normalizeQuickServices(rows) {
  return (rows || [])
    .map(normalizeQuickService)
    .filter((s) => s.label && Number.isFinite(s.price) && s.price >= 0)
}

function normalizeQuickServiceCategories(rows) {
  return Array.from(
    new Set(
      (rows || [])
        .map((c) => String(c || '').trim())
        .filter((c) => c && c !== QUICK_SERVICE_ALL_CATEGORY),
    ),
  )
}

function readQuickServiceCategoriesFromLocalStorage() {
  try {
    const rawCats = JSON.parse(localStorage.getItem(QUICK_SERVICE_CATEGORIES_STORAGE_KEY) || '[]')
    if (Array.isArray(rawCats)) return normalizeQuickServiceCategories(rawCats)
  } catch {
    // ignore
  }
  return []
}

/** Same load order as Payment Slip: API → localStorage → defaults. */
export async function loadPaymentQuickServices() {
  try {
    const { data } = await api.get('/payments/quick-services/')
    const payload = data?.data
    const rows = Array.isArray(payload?.services)
      ? payload.services
      : (Array.isArray(payload) ? payload : [])
    const serverCategories = Array.isArray(payload?.categories) ? payload.categories : []
    const normalized = normalizeQuickServices(rows)
    const categories = normalizeQuickServiceCategories(serverCategories)
    // Also merge any extra categories that were saved to localStorage
    // (belt-and-suspenders in case a standalone addQuickCategory didn't reach the server)
    const localCats = readQuickServiceCategoriesFromLocalStorage()
    const mergedCategories = normalizeQuickServiceCategories([...categories, ...localCats])
    if (normalized.length > 0) {
      return { services: normalized, categories: mergedCategories }
    }
    if (mergedCategories.length > 0) {
      return { services: null, categories: mergedCategories }
    }
  } catch {
    // fallback below
  }

  try {
    const raw = JSON.parse(localStorage.getItem(QUICK_SERVICES_STORAGE_KEY) || '[]')
    if (Array.isArray(raw) && raw.length > 0) {
      const normalized = normalizeQuickServices(raw)
      if (normalized.length > 0) {
        return {
          services: normalized,
          categories: readQuickServiceCategoriesFromLocalStorage(),
        }
      }
    }
  } catch {
    // ignore
  }

  return {
    services: DEFAULT_QUICK_SERVICES,
    categories: readQuickServiceCategoriesFromLocalStorage(),
  }
}

/** Stable id aligned with backend IPD charge catalog (`grp-{slug}`). */
export function serviceGroupIdFromLabel(label) {
  const base = String(label || '').trim().toLowerCase()
  const slug = base.replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'service'
  return `grp-${slug.slice(0, 64)}`
}
