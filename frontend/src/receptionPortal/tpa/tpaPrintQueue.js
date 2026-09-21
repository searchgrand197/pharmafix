import api from '../../api'
import { printHtmlInHiddenIframe } from '../../utils/printHtmlInHiddenFrame'
import {
  buildPaymentSlipDocumentHtml,
  buildPaymentSlipProfileLines,
  formatPaymentSlipAttributedDoctor,
  formatPaymentSlipGenderAge,
  formatPaymentSlipGuardianLine,
  resolvePaymentSlipLogoUrl,
} from '../print/paymentSlipPrint'
import { formatDateTime } from '../../utils/dateTimeFormat'

const FALLBACK_PROFILE = {
  hospital_name: 'Hospital',
  address: '',
  pin_code: '',
  phone: '',
  email: '',
  website: '',
  hospital_logo_url: '',
}

async function loadSlipProfile() {
  try {
    const { data } = await api.get('/settings/reception-portal/')
    const row = data?.data || data || {}
    return {
      ...FALLBACK_PROFILE,
      hospital_name: row.hospital_name || FALLBACK_PROFILE.hospital_name,
      address: row.address || '',
      pin_code: row.pin_code || '',
      phone: row.phone || '',
      email: row.email || '',
      website: row.website || '',
      hospital_logo_url: row.hospital_logo_url || row.hospital_logo || '',
    }
  } catch {
    return { ...FALLBACK_PROFILE }
  }
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function isDocPrintable(doc) {
  if (!doc?.id) return false
  if (doc.meta?.available === false) return false
  return true
}

/** Flatten pack groups into printable docs in fixed order. */
export function flattenPrintableDocs(pack) {
  const groups = pack?.groups || []
  const out = []
  for (const g of groups) {
    for (const item of g.items || []) {
      if (isDocPrintable(item)) out.push(item)
    }
  }
  return out
}

/** Types that can render an HTML preview iframe in-page. */
export function supportsInlinePreview(doc) {
  return doc?.type === 'payment_slip' || doc?.type === 'lab'
}

async function buildPaymentDocHtml(doc) {
  const { data } = await api.get(`/payments/${doc.id}/`)
  const payment = data?.data || data
  if (!payment) throw new Error('Payment not found')

  const dateTimeStr = payment.paid_at ? formatDateTime(payment.paid_at) : formatDateTime(new Date())
  const patientName = (payment.patient_name || 'PATIENT').toUpperCase()
  const isCreditDue = payment.status === 'pending' && /credit/i.test(String(payment.transaction_reference || ''))
  const payModeLabel = isCreditDue
    ? 'Credit / Due'
    : payment.payment_mode === 'cash'
      ? 'Cash Payment'
      : payment.payment_mode === 'card'
        ? 'Card Payment'
        : payment.payment_mode === 'upi'
          ? 'UPI Payment'
          : (payment.payment_mode || 'Payment').toUpperCase()
  const amountNum = Number(payment.amount || 0)
  const amountFixed = Number.isFinite(amountNum) ? amountNum : 0
  const slipProfile = await loadSlipProfile()
  const logoUrl = resolvePaymentSlipLogoUrl(slipProfile)
  const profileLines = buildPaymentSlipProfileLines(slipProfile, escapeHtml)
  const invoiceDetails = payment.invoice_details || null
  let lineItems = []
  if (Array.isArray(invoiceDetails?.items) && invoiceDetails.items.length) {
    lineItems = invoiceDetails.items.map((it) => ({
      description: it.description || it.service_name || 'Item',
      quantity: Number(it.quantity || 1),
      unit_price: Number(it.unit_price ?? it.amount ?? 0),
      line_total: Number(it.line_total ?? it.amount ?? 0),
    }))
  }
  if (!lineItems.length) {
    lineItems = [{
      description: payment.transaction_reference || payment.receipt_no || 'Payment',
      quantity: 1,
      unit_price: amountFixed,
      line_total: amountFixed,
    }]
  }
  const discountFixed = Number(invoiceDetails?.discount_amount ?? 0)
  const patientFields = {
    gender: payment.patient_gender,
    age_value: payment.patient_age,
    age_unit: payment.patient_age_unit,
    guardian_name: payment.patient_guardian_name,
    guardian_relationship: payment.patient_guardian_relationship,
  }

  return buildPaymentSlipDocumentHtml({
    title: `Receipt — ${payment.slip_number || payment.invoice_no || payment.receipt_no || 'Payment'}`,
    hospitalName: slipProfile.hospital_name || FALLBACK_PROFILE.hospital_name,
    logoUrl,
    profileLines,
    escapeHtml,
    slipNumber: payment.slip_number || '--',
    invoiceNumber: payment.invoice_no || '--',
    patientName,
    genderAge: formatPaymentSlipGenderAge(patientFields),
    payModeLabel,
    mobile: payment.patient_phone || payment.mobile || '—',
    dateTimeStr,
    guardianLine: formatPaymentSlipGuardianLine(patientFields),
    attributedDoctor: formatPaymentSlipAttributedDoctor(
      payment.attributed_doctor_name || payment.invoice_details?.attributed_doctor_name,
    ),
    lineItems,
    subtotal: amountFixed,
    discount: discountFixed,
    total: amountFixed,
    isCredit: isCreditDue,
    paidBoxLabel: isCreditDue ? 'CREDIT / DUE' : '✓ PAID',
    printCloseScript: '',
  })
}

async function buildLabDocHtml(doc) {
  const [{ data: reportRes }, { data: settingsRes }] = await Promise.all([
    api.get(`/lab/reports/${doc.id}/`),
    api.get('/lab/settings/').catch(() => ({ data: null })),
  ])
  const report = reportRes?.data || reportRes
  const settings = settingsRes?.data || settingsRes || {}
  if (!report) throw new Error('Lab report not found')
  const mod = await import('../../pages/LabPortal.jsx')
  return mod.buildLabReportPrintHtml(report, settings)
}

/** Load HTML for in-page iframe preview (payment / lab). Returns null for portal-mounted types. */
export async function loadTpaDocPreviewHtml(doc) {
  if (!isDocPrintable(doc)) return null
  if (doc.type === 'payment_slip') return buildPaymentDocHtml(doc)
  if (doc.type === 'lab') return buildLabDocHtml(doc)
  return null
}

async function printPaymentDoc(doc) {
  const docHtml = await buildPaymentDocHtml(doc)
  await new Promise((resolve) => {
    printHtmlInHiddenIframe(docHtml, { onComplete: resolve })
    setTimeout(resolve, 4000)
  })
}

async function printLabDoc(doc) {
  const [{ data: reportRes }, { data: settingsRes }] = await Promise.all([
    api.get(`/lab/reports/${doc.id}/`),
    api.get('/lab/settings/').catch(() => ({ data: null })),
  ])
  const report = reportRes?.data || reportRes
  const settings = settingsRes?.data || settingsRes || {}
  if (!report) throw new Error('Lab report not found')
  const mod = await import('../../pages/LabPortal.jsx')
  await mod.printLabReportViaIframe(report, settings)
}

/**
 * Print a single pack document.
 * For final_bill / discharge_summary / opd, calls onPortalPrint so ReceptionistPortal
 * can mount PrintIpdLedger / PrintDischargeSummary / PrintSlip.
 */
export async function printTpaDocument(doc, handlers = {}, options = {}) {
  if (!isDocPrintable(doc)) return { skipped: true }
  const { onPortalPrint, onPharmacyPrint } = handlers
  const previewOnly = Boolean(options.previewOnly)

  switch (doc.type) {
    case 'opd':
    case 'final_bill':
    case 'discharge_summary':
      if (typeof onPortalPrint !== 'function') throw new Error('Portal print handler missing')
      await onPortalPrint(doc, { previewOnly })
      break
    case 'payment_slip':
      if (previewOnly) break
      await printPaymentDoc(doc)
      break
    case 'pharmacy':
      if (typeof onPharmacyPrint !== 'function') throw new Error('Pharmacy print handler missing')
      await onPharmacyPrint(doc.id, {
        previewOnly,
        pharmacyId: doc?.meta?.pharmacy_id || '',
      })
      break
    case 'lab':
      if (previewOnly) break
      await printLabDoc(doc)
      break
    default:
      throw new Error(`Unknown document type: ${doc.type}`)
  }
  return { skipped: false }
}

/** Print all printable docs sequentially with a short gap between jobs. */
export async function printAllTpaDocuments(pack, handlers = {}, { gapMs = 1200, onProgress } = {}) {
  const docs = flattenPrintableDocs(pack)
  for (let i = 0; i < docs.length; i += 1) {
    const doc = docs[i]
    if (onProgress) onProgress({ index: i, total: docs.length, doc })
    try {
      await printTpaDocument(doc, handlers)
    } catch (err) {
      console.error('TPA print failed', doc, err)
      if (handlers.onError) handlers.onError(err, doc)
    }
    if (i < docs.length - 1) await sleep(gapMs)
  }
  return docs.length
}
