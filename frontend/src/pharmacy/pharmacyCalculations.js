/** Shared billing / GST helpers for pharmacy ERP (used in UI + unit tests). */

/** Global default when outlet + product do not apply (Marg-style). */
export const DEFAULT_OUTLET_GST_PERCENT = 5

/** Normalize percent text (comma decimal → dot). */
export function normalizePercentInputString(raw) {
  return String(raw ?? '').trim().replace(',', '.')
}

/** True while user is typing a decimal (e.g. "23.") — avoid coercing to integer mid-entry. */
export function isPartialPercentInput(raw) {
  const t = normalizePercentInputString(raw)
  return t === '.' || /^\d+\.$/.test(t) || /^\d*\.$/.test(t)
}

/** Parse a finished percent value; returns null for empty/invalid/partial input. */
export function parseCompletePercentInput(raw, max = 100, min = 0) {
  const t = normalizePercentInputString(raw)
  if (!t || t === '-' || isPartialPercentInput(t)) return null
  if (!/^\d*\.?\d+$/.test(t)) return null
  const n = Number(t)
  if (!Number.isFinite(n)) return null
  return Math.min(max, Math.max(min, n))
}

/** Outlet setting: supports 0% (unlike `Number(x) || fallback`, which treats 0 as missing). */
export function parseOutletDefaultGstPercent(raw, fallback = DEFAULT_OUTLET_GST_PERCENT) {
  if (raw === null || raw === undefined) return fallback
  const s = String(raw).trim()
  if (s === '') return fallback
  const n = Number(s)
  return Number.isFinite(n) && n >= 0 ? n : fallback
}

/** @deprecated Use computeSaleGstTotals for Marg billing */
export const DEFAULT_GST_TOTAL_RATE = 12

/** @deprecated Use computeSaleGstTotals */
export function computeBillingTotals(rows, gstTotalRate = DEFAULT_GST_TOTAL_RATE) {
  const subtotal = rows
    .filter((r) => r.medicine)
    .reduce((s, r) => s + (Number(r.amount) || 0), 0)
  const gst = subtotal * (gstTotalRate / 100)
  const grandTotal = subtotal + gst
  return { subtotal, gst, grandTotal, cgst: gst / 2, sgst: gst / 2 }
}

export function normalizeGstType(s) {
  if (s == null || s === '') return 'exclusive'
  const v = String(s).trim().toUpperCase()
  return v === 'INCLUSIVE' ? 'inclusive' : 'exclusive'
}

/**
 * Priority: row (if set) → product → default. no_gst forces 0.
 * @param {object} p
 * @param {string|number|null|undefined} p.rowGst
 * @param {string|number|null|undefined} p.productGst
 * @param {string|number|null|undefined} p.defaultGst
 * @param {boolean} p.noGst
 */
export function resolveEffectiveGstPercent({ rowGst, productGst, defaultGst, noGst }) {
  if (noGst) return 0
  const row =
    rowGst === '' || rowGst === null || rowGst === undefined ? null : Number(rowGst)
  if (row !== null && !Number.isNaN(row) && row >= 0) return row
  const pg =
    productGst === '' || productGst === null || productGst === undefined ? null : Number(productGst)
  if (pg !== null && !Number.isNaN(pg) && pg >= 0) return pg
  const d = defaultGst === '' || defaultGst == null ? NaN : Number(defaultGst)
  if (Number.isFinite(d) && d >= 0) return d
  return DEFAULT_OUTLET_GST_PERCENT
}

export function splitGstEqually(gstAmount) {
  const g = Math.round((Number(gstAmount) || 0) * 100) / 100
  if (g <= 0) return { cgst: 0, sgst: 0 }
  const half = Math.round((g / 2) * 100) / 100
  return { cgst: half, sgst: Math.round((g - half) * 100) / 100 }
}

/**
 * Marg GST: tax on base first, then final = result − discount.
 */
export function computeMargGstOnBase({
  baseAmount,
  discount = 0,
  gstType,
  gstPercent,
  noGst,
}) {
  const base = Math.max(0, Number(baseAmount) || 0)
  const disc = Math.max(0, Number(discount) || 0)
  const pct = Math.max(0, Number(gstPercent) || 0)
  const gt = normalizeGstType(gstType)
  if (noGst || pct <= 0) {
    const finalAmount = Math.max(0, Math.round((base - disc) * 100) / 100)
    return {
      taxableAmount: finalAmount,
      gstAmount: 0,
      finalAmount,
      cgst: 0,
      sgst: 0,
    }
  }
  if (gt === 'inclusive') {
    const divisor = 1 + pct / 100
    const taxableAmount = Math.round((base / divisor) * 100) / 100
    const gstAmount = Math.round((base - taxableAmount) * 100) / 100
    const finalAmount = Math.max(0, Math.round((base - disc) * 100) / 100)
    const { cgst, sgst } = splitGstEqually(gstAmount)
    return { taxableAmount, gstAmount, finalAmount, cgst, sgst }
  }
  const taxableAmount = Math.round(base * 100) / 100
  const gstAmount = Math.round(taxableAmount * (pct / 100) * 100) / 100
  const finalAmount = Math.max(0, Math.round((taxableAmount + gstAmount - disc) * 100) / 100)
  const { cgst, sgst } = splitGstEqually(gstAmount)
  return { taxableAmount, gstAmount, finalAmount, cgst, sgst }
}

/**
 * GST base for sale line: always qty × selling rate.
 */
export function lineSaleBaseAmount(row) {
  const q = Number(row?.qty) || 0
  if (q <= 0) return 0
  const rate = Number(row?.rate) || 0
  return Math.round(q * rate * 100) / 100
}

/** Line selling rate for invoice/grid display: unit rate × qty (same basis as line MRP). */
export function lineSellingRateDisplay(rowOrItem) {
  const q = Number(rowOrItem?.qty) || 0
  const unitRate = Number(rowOrItem?.rate) || 0
  if (q > 0) return Math.round(q * unitRate * 100) / 100
  return unitRate
}

/**
 * Line discount in ₹ applied in totals:
 * - If batch MRP exists, line_discount% already updates selling rate from MRP in the editor,
 *   so do not subtract discount again here (prevents double-discount).
 * - Without MRP, apply line_discount% on qty × selling rate.
 */
export function lineDiscountRupeesFromPercent(row) {
  const q = Number(row?.qty) || 0
  if (q <= 0) return 0
  const mrp = Number(row?.batch?.mrp)
  if (Number.isFinite(mrp) && mrp > 0) return 0
  const base = Math.round(q * (Number(row?.rate) || 0) * 100) / 100
  const pct = parseCompletePercentInput(row?.line_discount) ?? (Number(row?.line_discount) || 0)
  return Math.round((base * pct) / 100 * 100) / 100
}

/**
 * Billing grid: per-line GST + discount on selling price.
 * @param {boolean} [invoiceGstEnabled=true] — false = non-GST bill (no tax, final = base − discount).
 */
export function computeSaleGstTotals(
  rows,
  defaultGstPercent = DEFAULT_OUTLET_GST_PERCENT,
  invoiceGstEnabled = true,
) {
  let taxableSubtotal = 0
  let cgst = 0
  let sgst = 0
  let grandTotal = 0
  for (const r of rows) {
    if (!r?.medicine) continue
    const q = Number(r.qty) || 0
    if (q <= 0) continue
    const base = lineSaleBaseAmount(r)
    const disc = lineDiscountRupeesFromPercent(r)
    if (!invoiceGstEnabled) {
      const m = computeMargGstOnBase({
        baseAmount: base,
        discount: disc,
        gstType: 'exclusive',
        gstPercent: 0,
        noGst: false,
      })
      taxableSubtotal += m.taxableAmount
      grandTotal += m.finalAmount
      continue
    }
    const resolved = resolveEffectiveGstPercent({
      rowGst: r.gst_percent,
      productGst: r.medicine?.gst_percent,
      defaultGst: defaultGstPercent,
      noGst: !!r.no_gst,
    })
    const m = computeMargGstOnBase({
      baseAmount: base,
      discount: disc,
      gstType: r.gst_type,
      gstPercent: resolved,
      noGst: !!r.no_gst,
    })
    taxableSubtotal += m.taxableAmount
    cgst += m.cgst
    sgst += m.sgst
    grandTotal += m.finalAmount
  }
  return {
    taxableSubtotal: Math.round(taxableSubtotal * 100) / 100,
    cgst: Math.round(cgst * 100) / 100,
    sgst: Math.round(sgst * 100) / 100,
    gst: Math.round((cgst + sgst) * 100) / 100,
    grandTotal: Math.round(grandTotal * 100) / 100,
  }
}

/**
 * Retail bill round-off: settle in whole rupees, nearest rupee (0.50 rounds up).
 * Mirrors apps.pharmacy.calculations.invoice_round_off.
 * @returns {{ payable: number, roundOff: number }} roundOff = payable − exact (the ± shown on the bill)
 */
export function computeInvoiceRoundOff(amount) {
  const exact = Math.round((Number(amount) || 0) * 100) / 100
  const payable = Math.round(exact)
  return { payable, roundOff: Math.round((payable - exact) * 100) / 100 }
}

/**
 * @param {number} baseQty - stock in base units (e.g. tablets)
 * @param {Record<string, number>} conversions - e.g. { strip: 10, box: 100 }
 * @param {string} baseLabel - e.g. "tablet"
 */
export function formatStockDual(baseQty, conversions = {}, baseLabel = 'units') {
  const q = Number(baseQty) || 0
  if (q <= 0) return `0 ${baseLabel}`
  const parts = [`${q.toFixed(q % 1 === 0 ? 0 : 2)} ${baseLabel}`]
  const strip = Number(conversions.strip || conversions.STRIP)
  if (strip > 0) {
    const strips = q / strip
    parts.push(`${strips.toFixed(strips % 1 === 0 ? 0 : 2)} strip(s)`)
  }
  const box = Number(conversions.box || conversions.BOX)
  if (box > 0) {
    const boxes = q / box
    parts.push(`${boxes.toFixed(boxes % 1 === 0 ? 0 : 2)} box`)
  }
  return parts.join(' · ')
}

/**
 * ERP display: whole strips + remainder tablets (base unit).
 * @param {number} baseQty - tablets (or base units)
 * @param {number} tabletsPerStrip - from unit_conversions.strip
 * @param {string} baseLabel - e.g. "tab"
 */
export function formatStripsAndTablets(baseQty, tabletsPerStrip, baseLabel = 'tab') {
  const q = Number(baseQty) || 0
  const sp = Number(tabletsPerStrip) || 0
  const label = (baseLabel || 'tab').toLowerCase()
  if (q <= 0) return `0 ${label}`
  if (!(sp > 0)) return `${q % 1 === 0 ? q : q.toFixed(2)} ${label}`
  const strips = Math.floor(q / sp)
  const tabs = q % sp
  const parts = []
  if (strips > 0) parts.push(`${strips} strip${strips === 1 ? '' : 's'}`)
  if (tabs > 0) parts.push(`${tabs % 1 === 0 ? tabs : Number(tabs.toFixed(2))} ${label}`)
  return parts.length ? parts.join(' + ') : `0 ${label}`
}

/**
 * Marg-style purchase line preview (matches backend compute_marg_gst_on_base + rate_type).
 * total_qty = qty * conversion; base = STRIP ? qty * rate : total_qty * rate.
 */
export function computeMargPurchaseLineAmounts({
  qty,
  conversion,
  rateType,
  purchaseRate,
  discount,
  gstType,
  gstPercent,
  skipGst,
  noGst,
  rowGstPercent,
  productGstPercent,
  defaultGstPercent,
  challanGstEnabled = true,
}) {
  const q = Number(qty) || 0
  const c = Number(conversion) || 0
  const rate = Number(purchaseRate) || 0
  const disc = Number(discount) || 0
  const rt = (rateType || 'STRIP').toUpperCase()
  const noGstEff = !!(noGst || skipGst || !challanGstEnabled)
  if (q <= 0 || rate <= 0) {
    return { totalQty: 0, taxableAmount: 0, gstAmount: 0, finalAmount: 0, cgst: 0, sgst: 0 }
  }
  if (c <= 0) {
    return { totalQty: 0, taxableAmount: 0, gstAmount: 0, finalAmount: 0, cgst: 0, sgst: 0 }
  }
  const totalQty = q * c
  const lineGross = rt === 'TABLET' ? totalQty * rate : q * rate
  const resolved = resolveEffectiveGstPercent({
    rowGst: rowGstPercent !== undefined && rowGstPercent !== null ? rowGstPercent : gstPercent,
    productGst: productGstPercent,
    defaultGst: defaultGstPercent ?? DEFAULT_OUTLET_GST_PERCENT,
    noGst: noGstEff,
  })
  const m = computeMargGstOnBase({
    baseAmount: lineGross,
    discount: disc,
    gstType,
    gstPercent: resolved,
    noGst: noGstEff,
  })
  return { totalQty, ...m }
}

/** Mirrors backend apps.pharmacy.calculations.calculate_purchase_line_amounts */
export function computePurchaseLineAmounts({
  qtyPacks,
  purchaseRate,
  discount,
  gstType,
  gstPercent,
  skipGst,
}) {
  let gross = Number(qtyPacks) * Number(purchaseRate) - Number(discount || 0)
  if (gross < 0) gross = 0
  if (skipGst || Number(gstPercent) <= 0) {
    const g = Math.round(gross * 100) / 100
    return { taxableAmount: g, gstAmount: 0, finalAmount: g }
  }
  const pct = Number(gstPercent)
  if (gstType === 'inclusive') {
    const divisor = 1 + pct / 100
    const taxable = Math.round((gross / divisor) * 100) / 100
    const gstAmount = Math.round((gross - taxable) * 100) / 100
    return { taxableAmount: taxable, gstAmount, finalAmount: Math.round(gross * 100) / 100 }
  }
  const taxable = Math.round(gross * 100) / 100
  const gstAmount = Math.round(taxable * (pct / 100) * 100) / 100
  const finalAmount = Math.round((taxable + gstAmount) * 100) / 100
  return { taxableAmount: taxable, gstAmount, finalAmount }
}

export function parseApiError(err) {
  const d = err?.response?.data
  if (!d) return err?.message || 'Request failed'
  if (typeof d.errors === 'string') return d.errors
  if (typeof d.detail === 'string') return d.detail
  if (Array.isArray(d.non_field_errors)) return d.non_field_errors.join(' ')
  const payload = d.errors && typeof d.errors === 'object' ? d.errors : d
  const flat = Object.values(payload)
    .flat()
    .filter((x) => x != null && x !== '')
  if (flat.length) {
    const msg = flat.map((x) => (Array.isArray(x) ? x[0] : x)).filter(Boolean)[0]
    if (msg) return String(msg)
  }
  try {
    return JSON.stringify(d)
  } catch {
    return 'Request failed'
  }
}
