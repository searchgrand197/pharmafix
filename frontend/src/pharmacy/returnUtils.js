/**
 * Utility helpers for the pharmacy Returns tab.
 * Keep all calculation logic here so PharmacyPortal.jsx stays lean and these are unit-testable.
 */

/**
 * Live per-line refund amount. Matches the backend update_full calculation:
 *   base = returnQty * rate
 *   cgst = base * cgst_rate / 100
 *   sgst = base * sgst_rate / 100
 *   total = base + cgst + sgst   (when gst_enabled; else just base)
 */
export function calcLineRefund(item, returnQty, gstEnabled) {
  const rQty = Number(returnQty || 0)
  if (rQty <= 0) return 0
  const base = rQty * Number(item.rate || 0)
  if (!gstEnabled) return base
  const cgst = (base * Number(item.cgst_rate || 0)) / 100
  const sgst = (base * Number(item.sgst_rate || 0)) / 100
  return base + cgst + sgst
}

/**
 * Preview totals for the return detail screen.
 * Returns: { newSubtotal, newCgst, newSgst, newGrandTotal, totalRefund }
 * previewGrandTotal is approximate — server is authoritative on save.
 */
export function calcPreviewTotals(items, returnQtyById, gstEnabled) {
  let newSubtotal = 0
  let newCgst = 0
  let newSgst = 0
  let totalRefund = 0

  for (const item of items) {
    const soldQty = Number(item.qty || 0)
    const rQty = Number(returnQtyById[item.id] || 0)
    const keepQty = soldQty - rQty
    if (keepQty > 0) {
      const base = keepQty * Number(item.rate || 0)
      const cg = (base * Number(item.cgst_rate || 0)) / 100
      const sg = (base * Number(item.sgst_rate || 0)) / 100
      newSubtotal += base
      newCgst += gstEnabled ? cg : 0
      newSgst += gstEnabled ? sg : 0
    }
    totalRefund += calcLineRefund(item, rQty, gstEnabled)
  }

  const newGrandTotal = Math.max(0, newSubtotal + newCgst + newSgst)
  return { newSubtotal, newCgst, newSgst, newGrandTotal, totalRefund }
}

/**
 * Build the update-full payload for a return.
 *   - Reduces item qty by returnQty (lines that hit 0 are dropped)
 *   - Preserves free_qty on each line
 *   - Caps paid_amount at new grand_total to avoid backend validation error
 *   - Caps total_discount at new pre-discount total
 */
export function buildReturnPayload(invoice, returnQtyById, previewNewGrandTotal, previewSubtotalPlusTax) {
  const patient = invoice.patient_details || {}

  const newItems = (invoice.items || [])
    .map((it) => {
      const rQty = Number(returnQtyById[it.id] || 0)
      const newQty = Number(it.qty || 0) - rQty
      return {
        medicine: it.medicine,
        batch: it.batch,
        qty: newQty,
        free_qty: Number(it.free_qty || 0),
        mrp: Number(it.mrp || 0),
        rate: Number(it.rate || 0),
        cgst_rate: Number(it.cgst_rate || 0),
        sgst_rate: Number(it.sgst_rate || 0),
      }
    })
    .filter((row) => row.qty > 0)

  const isCredit = invoice.payment_method === 'credit'
  const cappedPaid = isCredit
    ? 0
    : Math.min(Number(invoice.paid_amount || 0), previewNewGrandTotal)

  const cappedDiscount = Math.min(
    Number(invoice.total_discount || 0),
    Math.max(0, previewSubtotalPlusTax),
  )

  return {
    patient: {
      first_name: patient.first_name || '',
      last_name: patient.last_name || '',
      phone: patient.phone || '',
      gender: patient.gender || 'male',
    },
    invoice: {
      payment_method: invoice.payment_method || 'cash',
      paid_amount: cappedPaid,
      total_discount: cappedDiscount,
      remarks: invoice.remarks || '',
    },
    items: newItems,
  }
}

/**
 * Returns true when every invoice line would be reduced to qty 0 by the given returnQtyById.
 * Requires at least one return qty to be set.
 */
export function isFullBillReturn(invoice, returnQtyById) {
  const items = invoice.items || []
  if (items.length === 0) return false
  const hasAny = items.some((it) => Number(returnQtyById[it.id] || 0) > 0)
  if (!hasAny) return false
  return items.every((it) => Number(it.qty || 0) - Number(returnQtyById[it.id] || 0) <= 0)
}

/**
 * Validate a return before submission.
 * Returns null if ok, or an error message string.
 * Full returns (all items) are allowed — caller must handle the cancel flow.
 */
export function validateReturn(invoice, returnQtyById) {
  const hasAny = Object.values(returnQtyById).some((v) => Number(v) > 0)
  if (!hasAny) return 'Select at least one item to return.'

  for (const item of invoice.items || []) {
    const rQty = Number(returnQtyById[item.id] || 0)
    if (rQty < 0) return `Return quantity cannot be negative for ${item.medicine_name || 'item'}.`
    if (rQty > Number(item.qty || 0)) {
      return `Return quantity exceeds sold quantity for ${item.medicine_name || 'item'}.`
    }
  }

  return null
}

/**
 * Group flat stock-ledger return rows by patient/invoice return session.
 * Key: reference_id + reference_type + created_at second bucket.
 */
export function groupReturnHistoryRows(rows) {
  const byKey = new Map()

  for (const row of rows || []) {
    const refId = row.reference_id || ''
    const refType = row.reference_type || ''
    const createdAt = row.created_at || ''
    const secondBucket = String(createdAt).slice(0, 19)
    const key = `${refId}|${refType}|${secondBucket}`

    if (!byKey.has(key)) {
      byKey.set(key, {
        key,
        referenceId: refId,
        invoiceNo: row.invoice_no || null,
        customerName: row.customer_name || null,
        returnedAt: createdAt,
        refundAmount: 0,
        items: [],
      })
    }

    const group = byKey.get(key)
    if (createdAt && (!group.returnedAt || new Date(createdAt) > new Date(group.returnedAt))) {
      group.returnedAt = createdAt
    }
    if (!group.invoiceNo && row.invoice_no) group.invoiceNo = row.invoice_no
    if (!group.customerName && row.customer_name) group.customerName = row.customer_name

    const lineRefund = Number(row.line_refund || 0)
    group.refundAmount += lineRefund

    group.items.push({
      id: row.id,
      medicine_name: row.medicine_name || row.medicine || '—',
      batch_no: row.batch_no || row.batch || '—',
      qty_change: row.qty_change,
      line_refund: lineRefund,
      created_at: createdAt,
    })
  }

  return Array.from(byKey.values()).sort(
    (a, b) => new Date(b.returnedAt || 0) - new Date(a.returnedAt || 0),
  )
}
