import api from '../api'

export const EXPENSE_QUICK_SERVICES_STORAGE_KEY = 'expense_quick_services'
export const EXPENSE_QUICK_CATEGORIES_STORAGE_KEY = 'expense_quick_service_categories'
export const EXPENSE_QUICK_DEFAULT_CATEGORY = 'Custom'
export const EXPENSE_QUICK_ALL_CATEGORY = 'All'

export const DEFAULT_EXPENSE_QUICK_SERVICES = [
  { label: 'Stationery', category: EXPENSE_QUICK_DEFAULT_CATEGORY, price: 500 },
  { label: 'Tea / Refreshments', category: EXPENSE_QUICK_DEFAULT_CATEGORY, price: 200 },
  { label: 'Courier', category: EXPENSE_QUICK_DEFAULT_CATEGORY, price: 150 },
  { label: 'Cleaning supplies', category: EXPENSE_QUICK_DEFAULT_CATEGORY, price: 300 },
  { label: 'Electricity bill', category: EXPENSE_QUICK_DEFAULT_CATEGORY, price: 2000 },
  { label: 'Water cans', category: EXPENSE_QUICK_DEFAULT_CATEGORY, price: 80 },
]

export function normalizeExpenseQuickService(service) {
  const label = String(service?.label || '').trim()
  const price = Number(service?.price || 0)
  const category = String(service?.category || EXPENSE_QUICK_DEFAULT_CATEGORY).trim() || EXPENSE_QUICK_DEFAULT_CATEGORY
  return { label, price, category }
}

export function normalizeExpenseQuickServices(rows) {
  return (rows || [])
    .map(normalizeExpenseQuickService)
    .filter((s) => s.label && Number.isFinite(s.price) && s.price >= 0)
}

function normalizeExpenseQuickCategories(rows) {
  return Array.from(
    new Set(
      (rows || [])
        .map((c) => String(c || '').trim())
        .filter((c) => c && c !== EXPENSE_QUICK_ALL_CATEGORY),
    ),
  )
}

function readExpenseCategoriesFromLocalStorage() {
  try {
    const rawCats = JSON.parse(localStorage.getItem(EXPENSE_QUICK_CATEGORIES_STORAGE_KEY) || '[]')
    if (Array.isArray(rawCats)) return normalizeExpenseQuickCategories(rawCats)
  } catch {
    // ignore
  }
  return []
}

export async function loadExpenseQuickServices() {
  try {
    const { data } = await api.get('/expenses/quick-services/')
    const payload = data?.data
    const rows = Array.isArray(payload?.services)
      ? payload.services
      : (Array.isArray(payload) ? payload : [])
    const serverCategories = Array.isArray(payload?.categories) ? payload.categories : []
    const normalized = normalizeExpenseQuickServices(rows)
    const categories = normalizeExpenseQuickCategories(serverCategories)
    if (normalized.length > 0) {
      return { services: normalized, categories }
    }
    if (categories.length > 0) {
      return { services: null, categories }
    }
  } catch {
    // fallback below
  }

  try {
    const raw = JSON.parse(localStorage.getItem(EXPENSE_QUICK_SERVICES_STORAGE_KEY) || '[]')
    if (Array.isArray(raw) && raw.length > 0) {
      const normalized = normalizeExpenseQuickServices(raw)
      if (normalized.length > 0) {
        return {
          services: normalized,
          categories: readExpenseCategoriesFromLocalStorage(),
        }
      }
    }
  } catch {
    // ignore
  }

  return {
    services: DEFAULT_EXPENSE_QUICK_SERVICES,
    categories: readExpenseCategoriesFromLocalStorage(),
  }
}
