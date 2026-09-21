/** Payment slip line category resolution — mirrors apps/reports/doctor_revenue.py */

export const UNCATEGORIZED = 'Uncategorized'

export function moneyKey(value) {
  const n = Number(value)
  if (!Number.isFinite(n)) return '0.00'
  return n.toFixed(2)
}

export function buildQuickServiceCatalog(services) {
  const catalog = new Map()
  for (const svc of services || []) {
    const label = String(svc?.label || '').trim().toLowerCase()
    const price = moneyKey(svc?.price)
    const category = String(svc?.category || 'Custom').trim() || 'Custom'
    if (label) catalog.set(`${label}|${price}`, category)
  }
  return catalog
}

export function resolveItemCategory(item, catalog) {
  const stored = String(item?.category || '').trim()
  if (stored) return stored
  const label = String(item?.description || '').trim().toLowerCase()
  const price = moneyKey(item?.unit_price)
  if (label && catalog.has(`${label}|${price}`)) {
    return catalog.get(`${label}|${price}`)
  }
  return UNCATEGORIZED
}

function lineAmount(item) {
  const lineTotal = Number(item?.line_total)
  if (Number.isFinite(lineTotal)) return lineTotal
  const qty = Number(item?.quantity) || 0
  const rate = Number(item?.unit_price) || 0
  return qty * rate
}

/**
 * Aggregate payment slip invoice lines by category.
 * @returns {{ category: string, line_count: number, total: number }[]}
 */
export function aggregatePaymentSlipsByCategory(payments, catalog, { categoryFilter = '' } = {}) {
  const byCategory = new Map()
  const filter = String(categoryFilter || '').trim()

  for (const payment of payments || []) {
    const items = payment?.invoice_details?.items
    const lines = Array.isArray(items) && items.length > 0
      ? items.map((item) => ({
          category: resolveItemCategory(item, catalog),
          amount: lineAmount(item),
        }))
      : [{
          category: UNCATEGORIZED,
          amount: Number(payment?.amount) || 0,
        }]

    for (const line of lines) {
      if (filter && line.category !== filter) continue
      const bucket = byCategory.get(line.category) || { line_count: 0, total: 0 }
      bucket.line_count += 1
      bucket.total += line.amount
      byCategory.set(line.category, bucket)
    }
  }

  return [...byCategory.entries()]
    .sort(([a], [b]) => a.localeCompare(b, undefined, { sensitivity: 'base' }))
    .map(([category, { line_count, total }]) => ({
      category,
      line_count,
      total: moneyKey(total),
    }))
}

/**
 * Flatten payment slip invoice lines into one row per billed item.
 * @returns {{ paid_at, slip_number, patient_name, patient_uhid, description, category, quantity, unit_price, amount }[]}
 */
export function flattenPaymentSlipItems(payments, catalog, { categoryFilter = '' } = {}) {
  const filter = String(categoryFilter || '').trim()
  const rows = []

  for (const payment of payments || []) {
    const items = payment?.invoice_details?.items
    const slipMeta = {
      paid_at: payment?.paid_at ?? null,
      slip_number: payment?.slip_number ?? '',
      patient_name: payment?.patient_name ?? '',
      patient_uhid: payment?.patient_uhid ?? '',
    }

    const lines = Array.isArray(items) && items.length > 0
      ? items.map((item) => ({
          ...slipMeta,
          description: String(item?.description || '').trim() || '—',
          category: resolveItemCategory(item, catalog),
          quantity: Number(item?.quantity) || 0,
          unit_price: Number(item?.unit_price) || 0,
          amount: lineAmount(item),
        }))
      : [{
          ...slipMeta,
          description: String(
            payment?.description
            || payment?.invoice_details?.description
            || payment?.invoice_details?.items?.[0]?.description
            || 'Payment',
          ).trim() || 'Payment',
          category: UNCATEGORIZED,
          quantity: 1,
          unit_price: Number(payment?.amount) || 0,
          amount: Number(payment?.amount) || 0,
        }]

    for (const line of lines) {
      if (filter && line.category !== filter) continue
      rows.push(line)
    }
  }

  return rows
}

/**
 * Aggregate payment slip lines by item description (total qty and amount collected).
 * @returns {{ item: string, total_qty: number, total: string }[]}
 */
export function aggregatePaymentSlipsByItem(payments, catalog, { categoryFilter = '' } = {}) {
  const filter = String(categoryFilter || '').trim()
  const byItem = new Map()

  for (const payment of payments || []) {
    const items = payment?.invoice_details?.items
    const lines = Array.isArray(items) && items.length > 0
      ? items.map((item) => ({
          description: String(item?.description || '').trim() || '—',
          category: resolveItemCategory(item, catalog),
          quantity: Number(item?.quantity) || 0,
          amount: lineAmount(item),
        }))
      : [{
          description: String(
            payment?.description
            || payment?.invoice_details?.description
            || payment?.invoice_details?.items?.[0]?.description
            || 'Payment',
          ).trim() || 'Payment',
          category: UNCATEGORIZED,
          quantity: 1,
          amount: Number(payment?.amount) || 0,
        }]

    for (const line of lines) {
      if (filter && line.category !== filter) continue
      const key = line.description.toLowerCase()
      const bucket = byItem.get(key) || { description: line.description, total_qty: 0, total: 0 }
      bucket.total_qty += line.quantity
      bucket.total += line.amount
      byItem.set(key, bucket)
    }
  }

  return [...byItem.values()]
    .sort((a, b) => a.description.localeCompare(b.description, undefined, { sensitivity: 'base' }))
    .map(({ description, total_qty, total }) => ({
      item: description,
      total_qty,
      total: moneyKey(total),
    }))
}
