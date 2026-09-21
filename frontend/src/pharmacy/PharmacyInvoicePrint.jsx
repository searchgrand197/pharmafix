import React, { useCallback, useEffect, useRef, useState } from 'react'
import { withTimeTokens } from '../utils/dateTimeFormat'
import { format } from 'date-fns'
import api from '../api'
import toast from 'react-hot-toast'
import {
  formatBillQtyForOutlet,
  formatInvoiceTotalQtyForOutlet,
  medicineBillName,
  qtySuffixFromMedicine,
} from './billingUtils'
import { invoiceOutletChannel, resolveOutletForChannel } from './outletSettingsUtils'

const EDITABLE_CLASS = 'pharm-invoice-editable'
const INVOICE_SHELL_CLASS = 'pharm-invoice-print-shell'
const INVOICE_ROOT_CLASS = 'pharm-invoice-print-root'
const INVOICE_HEADER_CLASS = 'pharm-invoice-header'
const INVOICE_FOOTER_CLASS = 'pharm-invoice-footer'
/** Solid black 1px borders — light grays do not render reliably in browser print / B&W. */
const B_ORDER = '1px solid #000'

const INVOICE_SHELL_STYLE = {
  maxWidth: '210mm',
  width: '100%',
  margin: '0 auto',
  border: B_ORDER,
  boxSizing: 'border-box',
  overflow: 'hidden',
  fontFamily: 'Arial, sans-serif',
  fontSize: '10px',
  color: '#000',
  background: '#fff',
}

const INVOICE_ROOT_STYLE = {
  width: '100%',
  boxSizing: 'border-box',
}

const INVOICE_LAYOUT_CSS = `
  .${INVOICE_SHELL_CLASS} {
    box-sizing: border-box !important;
    width: 100% !important;
    max-width: 210mm !important;
    margin: 0 auto !important;
    border: ${B_ORDER} !important;
    overflow: hidden !important;
    background: #fff !important;
  }
  .${INVOICE_ROOT_CLASS} {
    width: 100% !important;
    box-sizing: border-box !important;
    border: none !important;
  }
  .${INVOICE_ROOT_CLASS} > table {
    width: 100% !important;
    max-width: 100% !important;
    table-layout: fixed !important;
    border-collapse: separate !important;
    border-spacing: 0 !important;
    border-top: ${B_ORDER} !important;
    border-bottom: ${B_ORDER} !important;
    border-left: ${B_ORDER} !important;
    border-right: ${B_ORDER} !important;
  }
  .${INVOICE_ROOT_CLASS} table th,
  .${INVOICE_ROOT_CLASS} table td {
    border: ${B_ORDER} !important;
    box-sizing: border-box !important;
  }
  .${INVOICE_ROOT_CLASS} table tr th:first-child,
  .${INVOICE_ROOT_CLASS} table tr td:first-child {
    border-left: ${B_ORDER} !important;
  }
  .${INVOICE_ROOT_CLASS} table tr th:last-child,
  .${INVOICE_ROOT_CLASS} table tr td:last-child {
    border-right: ${B_ORDER} !important;
  }
  .${INVOICE_ROOT_CLASS} table thead tr th {
    border-top: ${B_ORDER} !important;
  }
  .${INVOICE_ROOT_CLASS} table tfoot tr td {
    border-bottom: ${B_ORDER} !important;
  }
  .${INVOICE_ROOT_CLASS} table tbody tr { border-bottom: none !important; }
  .pharm-inv-cell-wrap {
    white-space: normal !important;
    word-break: break-word !important;
    overflow-wrap: anywhere !important;
    line-height: 1.25 !important;
    vertical-align: top !important;
  }
  .pharm-inv-cell-qty {
    white-space: normal !important;
    word-break: break-word !important;
    overflow-wrap: anywhere !important;
    line-height: 1.2 !important;
    vertical-align: top !important;
    font-size: 8px !important;
  }
  .pharm-inv-cell-amount {
    white-space: normal !important;
    word-break: break-word !important;
    overflow-wrap: anywhere !important;
    line-height: 1.25 !important;
    vertical-align: top !important;
  }
  .${INVOICE_HEADER_CLASS} {
    border-left: ${B_ORDER} !important;
    border-right: ${B_ORDER} !important;
    box-sizing: border-box !important;
  }
  .${INVOICE_HEADER_CLASS} > div:not(:last-child),
  .${INVOICE_FOOTER_CLASS} > div:not(:last-child) { border-right: ${B_ORDER} !important; }
  .${INVOICE_FOOTER_CLASS} {
    border-left: ${B_ORDER} !important;
    border-right: ${B_ORDER} !important;
    box-sizing: border-box !important;
  }
  .${INVOICE_FOOTER_CLASS} .pharm-invoice-totals > div { border-bottom: ${B_ORDER} !important; }
`

const PREVIEW_EDIT_STYLES = `
  .${EDITABLE_CLASS} { outline: none; border-radius: 2px; cursor: text; min-height: 1em; }
  .${EDITABLE_CLASS}:focus { background: rgba(37, 99, 235, 0.05); box-shadow: inset 0 0 0 1px rgba(37, 99, 235, 0.18); }
  td.${EDITABLE_CLASS}:focus { background: rgba(37, 99, 235, 0.04); }
  ${INVOICE_LAYOUT_CSS}
`

function preventEditableNewline(e) {
  if (e.key === 'Enter') e.preventDefault()
}

function handleEditablePaste(e) {
  e.preventDefault()
  const text = (e.clipboardData || window.clipboardData)?.getData('text/plain') || ''
  const flat = text.replace(/\r?\n/g, ' ')
  if (flat) document.execCommand('insertText', false, flat)
}

/** Match bold / size / italic at caret so newly typed characters follow local formatting. */
function ensureInheritedTypingStyles(e) {
  const type = e.inputType
  if (!e.data && type !== 'insertFromPaste') return
  if (
    type !== 'insertText' &&
    type !== 'insertCompositionText' &&
    type !== 'insertFromPaste' &&
    type !== 'insertReplacementText'
  ) {
    return
  }
  const sel = window.getSelection()
  if (!sel?.rangeCount || !sel.isCollapsed) return
  let node = sel.anchorNode
  if (!node) return
  if (node.nodeType === Node.TEXT_NODE) node = node.parentElement
  if (!node?.closest) return
  const host = node.closest(`.${EDITABLE_CLASS}`)
  if (!host) return
  const cs = window.getComputedStyle(node)
  const weight = parseInt(cs.fontWeight, 10)
  const isBold = cs.fontWeight === 'bold' || (Number.isFinite(weight) && weight >= 600)
  if (isBold) {
    try {
      document.execCommand('bold', false, null)
    } catch {
      /* noop */
    }
  }
  if (cs.fontStyle === 'italic') {
    try {
      document.execCommand('italic', false, null)
    } catch {
      /* noop */
    }
  }
}

function EditableBlock({ style, children, multiline = false, as: Tag = 'div', ...rest }) {
  return (
    <Tag
      contentEditable
      suppressContentEditableWarning
      className={EDITABLE_CLASS}
      style={style}
      onKeyDown={multiline ? undefined : preventEditableNewline}
      onPaste={handleEditablePaste}
      onBeforeInput={ensureInheritedTypingStyles}
      {...rest}
    >
      {children}
    </Tag>
  )
}

function safeFormat(dateVal, fmtStr) {
  if (!dateVal) return '--/--'
  try {
    const d = new Date(dateVal)
    if (isNaN(d.getTime())) return '--/--'
    return format(d, withTimeTokens(fmtStr))
  } catch {
    return '--/--'
  }
}

function itemMedicineMeta(it) {
  if (it?.medicine && typeof it.medicine === 'object') return it.medicine
  return it?.medicine_print || null
}

function stripSizeFromItem(it) {
  const forced = Number(it?.strip_size_for_print)
  if (Number.isFinite(forced) && forced > 0) return forced
  const fromField = Number(it?.pack_size)
  if (Number.isFinite(fromField) && fromField > 0) return fromField
  const med = itemMedicineMeta(it)
  const convStrip =
    Number(med?.unit_conversions?.strip) ||
    Number(med?.unit_conversions?.STRIP) ||
    Number(it?.unit_conversions?.strip) ||
    Number(it?.unit_conversions?.STRIP)
  if (Number.isFinite(convStrip) && convStrip > 0) return convStrip
  const packInfo = String(itemMedicineMeta(it)?.pack_info || it?.pack_info || it?.pack || '')
  const m = packInfo.match(/x\s*(\d+(?:\.\d+)?)/i)
  if (m) {
    const n = Number(m[1])
    if (Number.isFinite(n) && n > 0) return n
  }
  return 1
}

function stripMrpFromItem(it, rateFallback = 0) {
  const forcedStripMrp = Number(it?.mrp_strip_for_print)
  if (Number.isFinite(forcedStripMrp) && forcedStripMrp > 0) return forcedStripMrp
  const unitMrp = Number(it?.mrp ?? it?.batch?.mrp ?? rateFallback)
  const size = stripSizeFromItem(it)
  return unitMrp * size
}

function unitMrpFromItem(it, rateFallback = 0) {
  const u = Number(it?.mrp ?? it?.batch?.mrp ?? rateFallback)
  return Number.isFinite(u) ? u : 0
}

/** % off unit MRP vs selling rate (same basis as billing screen). */
function lineDiscountPercentFromItem(it) {
  const unitMrp = unitMrpFromItem(it, Number(it?.rate ?? 0))
  const rate = Number(it?.rate ?? 0)
  if (!(unitMrp > 0)) return 0
  const raw = ((unitMrp - rate) / unitMrp) * 100
  if (!Number.isFinite(raw)) return 0
  return Math.min(100, Math.max(0, Math.round(raw * 100) / 100))
}

function formatQtyCell(it, displayMode = 'base_units') {
  const ps = Number(it?.pack_size) || stripSizeFromItem(it)
  const baseSuffix = qtySuffixFromMedicine(itemMedicineMeta(it) || it)
  const mode = displayMode === 'pack_and_loose' ? 'pack_and_loose' : 'base_units'
  const common = { mode, packSize: ps, baseSuffix }

  if (it?.packs_display != null || it?.loose_display != null) {
    return formatBillQtyForOutlet({
      ...common,
      packs: it.packs_display,
      loose: it.loose_display,
    })
  }

  const free = Number(it?.free_qty || 0)
  const q = Number(it?.qty || 0)
  if (q <= 0 && free > 0) {
    return formatBillQtyForOutlet({
      ...common,
      packs: '0',
      loose: String(free),
    })
  }

  return formatBillQtyForOutlet({
    ...common,
    qty: q,
    freeQty: free,
  })
}

function productNameForInvoiceItem(it) {
  const fromApi = String(it?.medicine_name ?? '').trim()
  if (fromApi) return fromApi
  return medicineBillName(it?.medicine) || '—'
}

function isWalkInRetailInvoice(inv) {
  if (!inv || Boolean(inv?.party)) return false
  if (inv.ipd_admission) return false
  const doc = String(inv.billing_doctor_name || '').trim()
  const hosp = String(inv.billing_hospital_name || '').trim()
  return Boolean(doc || hosp)
}

/** B2C bill header lines — omit label/value when field is empty (phone, address, UHID on quick register). */
function b2cPatientHeaderLines(inv) {
  if (!inv || Boolean(inv?.party)) return []
  const pd = inv.patient_details
  if (!pd || typeof pd !== 'object') return []

  const lines = []
  const name = patientDisplayName(pd)
  if (name) lines.push({ key: 'name', label: 'Patient Name', value: name })

  lines.push({ key: 'age', label: 'Age', value: formatPatientAge(pd) || '\u00a0' })
  lines.push({ key: 'gender', label: 'Gender', value: formatPatientGender(pd) || '\u00a0' })

  const phone = String(pd.phone || '').trim()
  if (phone) lines.push({ key: 'phone', label: 'Patient Phone', value: phone })

  const addr = patientDisplayAddress(pd)
  if (addr && addr !== '—') lines.push({ key: 'address', label: 'Patient Address', value: addr })

  const hideUhid = Boolean(pd._walkInBilling)
  const uhid = String(pd.uhid || '').trim()
  if (!hideUhid && uhid) lines.push({ key: 'uhid', label: 'UHID No.', value: uhid })

  if (isWalkInRetailInvoice(inv)) {
    const doc = String(inv.billing_doctor_name || '').trim()
    const hosp = String(inv.billing_hospital_name || '').trim()
    lines.push({ key: 'doc', label: 'Doctor Name', value: doc || '\u00a0' })
    lines.push({ key: 'hosp', label: 'Hospital Name', value: hosp || '\u00a0' })
  }
  return lines
}

function retailPatientHeaderHtml(inv) {
  return b2cPatientHeaderLines(inv)
    .map(
      ({ label, value }) =>
        `<div><strong>${escapeHtml(label)} :</strong> ${escapeHtml(value)}</div>`,
    )
    .join('')
}

function retailPatientHeaderReact(inv) {
  const lines = b2cPatientHeaderLines(inv)
  if (!lines.length) return null
  return (
    <>
      {lines.map(({ key, label, value }) => (
        <EditableBlock key={key}>
          <strong>{label} :</strong> {value}
        </EditableBlock>
      ))}
    </>
  )
}

function formatInvoiceTotalQty(items, displayMode = 'base_units') {
  return formatInvoiceTotalQtyForOutlet(items, displayMode)
}

function formatMoney(n) {
  const v = Number(n || 0)
  return `Rs ${v.toFixed(2)}`
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function extractNotesAdviceFromRemarks(remarks) {
  const raw = String(remarks || '')
  if (!raw.trim()) return ''
  const lower = raw.toLowerCase()
  const key = 'notes/advice:'
  const idx = lower.indexOf(key)
  if (idx < 0) return ''
  return raw.slice(idx + key.length).trim()
}

function formatPatientGender(pd) {
  const g = String(pd?.gender || '').trim().toLowerCase()
  if (g === 'male') return 'Male'
  if (g === 'female') return 'Female'
  if (g === 'other') return 'Other'
  return ''
}

function formatPatientAge(pd) {
  if (!pd || typeof pd !== 'object') return ''
  const rawUnit = String(pd.age_unit || 'years').trim().toLowerCase()
  const unit =
    rawUnit === 'month' || rawUnit === 'months'
      ? 'Months'
      : rawUnit === 'day' || rawUnit === 'days'
        ? 'Days'
        : 'Years'
  const value = pd.age_value != null && pd.age_value !== '' ? pd.age_value : pd.age
  if (value == null || value === '') return ''
  const n = Number(value)
  if (!Number.isFinite(n)) return ''
  return `${n} ${unit}`
}

/** Patient name from API / billing (PatientSerializer includes middle_name). */
function patientDisplayName(pd) {
  if (!pd || typeof pd !== 'object') return ''
  const parts = [pd.first_name, pd.middle_name, pd.last_name].filter(
    (x) => x != null && String(x).trim() !== '',
  )
  return parts.map((x) => String(x).trim()).join(' ').trim()
}

/** One line: flat address or address_line1 + city + state from PatientSerializer. */
function patientDisplayAddress(pd) {
  if (!pd || typeof pd !== 'object') return '—'
  const flat = String(pd.address ?? '').trim()
  if (flat) return flat
  const line1 = String(pd.address_line1 ?? '').trim()
  const city = String(pd.city ?? '').trim()
  const state = String(pd.state ?? '').trim()
  const tail = [city, state].filter(Boolean).join(', ')
  const joined = [line1, tail].filter(Boolean).join(', ').trim()
  return joined || '—'
}

function partyDetailsObject(inv) {
  if (!inv || typeof inv !== 'object') return null
  const pd = inv.party_details
  if (pd && typeof pd === 'object') return pd
  if (inv.party && typeof inv.party === 'object') return inv.party
  return null
}

function invoicePartyDisplayName(inv) {
  const details = partyDetailsObject(inv)
  const fromDetails = details?.name
  if (fromDetails != null && String(fromDetails).trim() !== '') return String(fromDetails).trim()
  const fromNamedField = inv?.party_name
  if (fromNamedField != null && String(fromNamedField).trim() !== '') return String(fromNamedField).trim()
  const fromSnapshot = inv?.party_name_snapshot
  if (fromSnapshot != null && String(fromSnapshot).trim() !== '') return String(fromSnapshot).trim()
  return '—'
}

function invoicePartyDisplayAddress(inv) {
  const details = partyDetailsObject(inv)
  const addr = details?.address
  if (addr != null && String(addr).trim() !== '') return String(addr).trim()
  return '—'
}

function invoicePartyDisplayPhone(inv) {
  const details = partyDetailsObject(inv)
  const phone = details?.phone
  if (phone != null && String(phone).trim() !== '') return String(phone).trim()
  return '—'
}

function invoicePartyDisplayGst(inv) {
  const details = partyDetailsObject(inv)
  const gst = details?.gst_number
  if (gst != null && String(gst).trim() !== '') return String(gst).trim()
  return '—'
}

function invoicePartyDisplayDl(inv) {
  const details = partyDetailsObject(inv)
  const dl = details?.dl_number
  if (dl != null && String(dl).trim() !== '') return String(dl).trim()
  return '—'
}

const DEFAULT_INVOICE_TERMS = [
  'Please consult the Doctor before using medicine.',
  'Medicine without batch and expiry date will not be taken back.',
  'All disputes subject to local Jurisdiction only.',
]

function invoiceTermsLines(outlet) {
  const raw = String(outlet?.invoice_terms || '').trim()
  if (!raw) return DEFAULT_INVOICE_TERMS
  return raw
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean)
}

function formatTermsHtml(outlet) {
  return invoiceTermsLines(outlet)
    .map((line) => `<div>${escapeHtml(line)}</div>`)
    .join('')
}

function hasBankDetails(outlet) {
  const o = outlet || {}
  return Boolean(
    String(o.bank_name || '').trim() ||
      String(o.bank_branch || '').trim() ||
      String(o.bank_account_no || '').trim() ||
      String(o.bank_ifsc || '').trim(),
  )
}

function formatBankHtml(outlet) {
  const o = outlet || {}
  const rows = [
    ['Bank Name', o.bank_name],
    ['Branch Name', o.bank_branch],
    ['Account No', o.bank_account_no],
    ['IFSC Code', o.bank_ifsc],
  ].filter(([, v]) => v != null && String(v).trim() !== '')
  if (!rows.length) return '<div style="color:#888">—</div>'
  return rows
    .map(
      ([label, val]) =>
        `<div><strong>${escapeHtml(label)} :</strong> ${escapeHtml(String(val).trim())}</div>`,
    )
    .join('')
}

function absoluteMediaUrl(url) {
  if (!url) return ''
  if (/^https?:\/\//i.test(url)) return url
  if (typeof window !== 'undefined' && window.location?.origin) {
    return `${window.location.origin}${url.startsWith('/') ? url : `/${url}`}`
  }
  return url
}

function formatSignatureHtml(outlet, businessTitle) {
  const signUrl = absoluteMediaUrl(outlet?.signature_url || '')
  if (signUrl) {
    return `<div style="min-height:52px;display:flex;align-items:center;justify-content:center;margin:8px 0">
      <img src="${escapeHtml(signUrl)}" alt="Signature" style="max-height:52px;max-width:140px;object-fit:contain" />
    </div>`
  }
  return `<div style="min-height:52px;margin:8px 0">&nbsp;</div>`
}

/** Line MRP for qty sold (unit MRP × qty), not full pack/strip MRP. */
function lineMrpFromItem(it, rateFallback = 0) {
  const unitMrp = unitMrpFromItem(it, rateFallback)
  const qty = Number(it?.qty || 0)
  if (unitMrp > 0 && qty > 0) return Math.round(unitMrp * qty * 100) / 100
  return unitMrp
}

/** Line selling rate for qty sold (unit rate × qty), matches billing MRP column basis. */
function lineRateFromItem(it) {
  const qty = Number(it?.qty || 0)
  const unitRate = Number(it?.rate || 0)
  if (qty > 0) return Math.round(unitRate * qty * 100) / 100
  return unitRate
}

function bankDetailRows(outlet) {
  const o = outlet || {}
  return [
    ['Bank Name', o.bank_name],
    ['Branch Name', o.bank_branch],
    ['Account No', o.bank_account_no],
    ['IFSC Code', o.bank_ifsc],
  ].filter(([, v]) => v != null && String(v).trim() !== '')
}

function InvoiceFooterPreview({
  outlet,
  title,
  notesAdvice,
  showGst,
  subtotal,
  totalDiscount,
  totalDiscountPercent,
  cgst,
  sgst,
  roundOff,
  paidAmount,
  dueAmount,
  grandTotal,
}) {
  const terms = invoiceTermsLines(outlet)
  const bankRows = bankDetailRows(outlet)
  const signUrl = absoluteMediaUrl(outlet?.signature_url || '')

  return (
    <div
      className={INVOICE_FOOTER_CLASS}
      style={{
        display: 'flex',
        borderBottom: B_ORDER,
        alignItems: 'stretch',
        borderLeft: B_ORDER,
        borderRight: B_ORDER,
        boxSizing: 'border-box',
      }}
    >
      <div style={{ flex: 1, padding: '8px 10px', borderRight: B_ORDER, fontSize: '8px', minWidth: 0 }}>
        <div style={{ fontWeight: 'bold', marginBottom: '4px', textDecoration: 'underline' }}>Terms & Conditions</div>
        <div style={{ lineHeight: 1.6 }}>
          {terms.map((line, i) => (
            <EditableBlock key={i} style={{ fontSize: '8px' }}>
              {line}
            </EditableBlock>
          ))}
        </div>
        <div style={{ marginTop: '8px' }}>
          {notesAdvice ? (
            <>
              <strong>Notes/Advice :</strong>
              <EditableBlock
                multiline
                style={{ marginTop: '3px', lineHeight: 1.4, whiteSpace: 'pre-wrap', fontSize: '8px' }}
              >
                {notesAdvice}
              </EditableBlock>
            </>
          ) : (
            <EditableBlock style={{ fontSize: '8px' }}>
              <strong>Remark :</strong> ___________________________
            </EditableBlock>
          )}
        </div>
      </div>

      <div style={{ flex: 1, padding: '8px 10px', borderRight: B_ORDER, fontSize: '8px', minWidth: 0 }}>
        <div style={{ fontWeight: 'bold', marginBottom: '4px', textDecoration: 'underline' }}>BANK DETAILS :-</div>
        <div style={{ lineHeight: 1.6 }}>
          {bankRows.length ? (
            bankRows.map(([label, val]) => (
              <EditableBlock key={label} style={{ fontSize: '8px' }}>
                <strong>{label} :</strong> {String(val).trim()}
              </EditableBlock>
            ))
          ) : (
            <div style={{ color: '#888' }}>—</div>
          )}
        </div>
      </div>

      <div
        style={{
          flex: 1,
          padding: '8px 10px',
          borderRight: B_ORDER,
          textAlign: 'center',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          minHeight: '100px',
        }}
      >
        <EditableBlock style={{ fontSize: '8px', marginBottom: '4px' }}>For {title}</EditableBlock>
        {signUrl ? (
          <div style={{ minHeight: '52px', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '8px 0' }}>
            <img src={signUrl} alt="Signature" style={{ maxHeight: '52px', maxWidth: '140px', objectFit: 'contain' }} />
          </div>
        ) : (
          <div style={{ minHeight: '52px', margin: '8px 0' }}>&nbsp;</div>
        )}
        <div style={{ borderTop: B_ORDER, paddingTop: '4px', fontSize: '8px', marginTop: 'auto' }}>
          Authorised Signatory
        </div>
      </div>

      <div className="pharm-invoice-totals" style={{ width: '160px', flexShrink: 0, fontSize: '9px', borderLeft: B_ORDER }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 8px', borderBottom: B_ORDER }}>
          <span>SUB TOTAL</span><span style={{ fontWeight: 'bold' }}>{formatMoney(subtotal)}</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 8px', borderBottom: B_ORDER }}>
          <span>ADD. DIS ({totalDiscountPercent.toFixed(2)}%)</span><span>{formatMoney(totalDiscount)}</span>
        </div>
        {showGst ? (
          <>
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 8px', borderBottom: B_ORDER }}>
              <span>CGST</span><span>{formatMoney(cgst)}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 8px', borderBottom: B_ORDER }}>
              <span>SGST</span><span>{formatMoney(sgst)}</span>
            </div>
          </>
        ) : null}
        {roundOff ? (
          <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 8px', borderBottom: B_ORDER }}>
            <span>ROUND OFF</span>
            <span>{roundOff > 0 ? '+' : '-'}{formatMoney(Math.abs(roundOff))}</span>
          </div>
        ) : null}
        <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 8px', borderBottom: B_ORDER }}>
          <span>PAID</span><span>{formatMoney(paidAmount)}</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 8px', borderBottom: B_ORDER }}>
          <span>DUE</span><span>{formatMoney(dueAmount)}</span>
        </div>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            padding: '6px 8px',
            background: '#000',
            color: '#fff',
            fontWeight: 'bold',
            fontSize: '10px',
          }}
        >
          <span>GRAND TOTAL</span><span>{formatMoney(grandTotal)}</span>
        </div>
        <div style={{ padding: '4px 8px', fontSize: '8px', textAlign: 'center', fontStyle: 'italic' }}>
          Computer Generated Invoice
        </div>
      </div>
    </div>
  )
}

/** Referred doctor: nested doctor_details.name (API) or legacy string. */
function invoiceDoctorDisplayName(inv) {
  if (!inv || typeof inv !== 'object') return '—'
  const fromNested = inv.doctor_details?.name
  if (fromNested != null && String(fromNested).trim() !== '') return String(fromNested).trim()
  const rb = inv.referred_by
  if (rb != null && typeof rb === 'object' && rb.name != null && String(rb.name).trim() !== '') {
    return String(rb.name).trim()
  }
  if (typeof rb === 'string' && rb.trim() !== '' && !/^[0-9a-f-]{36}$/i.test(rb.trim())) {
    return rb.trim()
  }
  return '—'
}

/** Number of columns before QTY in the invoice grid. */
function qtyColumnColspan(showGst) {
  return showGst ? 11 : 9
}

/** Column widths (sum 100%) — wider name/qty/amount for multi-line strip qty and long amounts. */
const INVOICE_COLS_NO_GST = ['4%', '20%', '6%', '5%', '7%', '5%', '8%', '5%', '7%', '16%', '17%']
const INVOICE_COLS_GST = ['4%', '15%', '5%', '5%', '6%', '5%', '7%', '4%', '6%', '4%', '4%', '16%', '19%']

function invoiceColgroupHtml(showGst) {
  const widths = showGst ? INVOICE_COLS_GST : INVOICE_COLS_NO_GST
  return `<colgroup>${widths.map((w) => `<col style="width:${w}" />`).join('')}</colgroup>`
}

function InvoiceColgroupJsx({ showGst }) {
  const widths = showGst ? INVOICE_COLS_GST : INVOICE_COLS_NO_GST
  return (
    <colgroup>
      {widths.map((w, i) => (
        <col key={i} style={{ width: w }} />
      ))}
    </colgroup>
  )
}

const CELL_WRAP_STYLE = {
  whiteSpace: 'normal',
  wordBreak: 'break-word',
  overflowWrap: 'anywhere',
  lineHeight: 1.25,
  verticalAlign: 'top',
}

const CELL_QTY_STYLE = {
  ...CELL_WRAP_STYLE,
  lineHeight: 1.2,
  fontSize: '8px',
  textAlign: 'center',
}

const CELL_AMOUNT_STYLE = {
  ...CELL_WRAP_STYLE,
  textAlign: 'right',
  fontWeight: 'bold',
}

function printViaIframe(htmlString) {
  return new Promise((resolve) => {
    const iframe = document.createElement('iframe')
    iframe.style.cssText = 'position:fixed;left:-9999px;top:-9999px;width:210mm;height:297mm;border:none;'
    document.body.appendChild(iframe)

    const doc = iframe.contentDocument || iframe.contentWindow.document
    doc.open()
    doc.write(htmlString)
    doc.close()

    const win = iframe.contentWindow
    const cleanup = () => {
      try { document.body.removeChild(iframe) } catch { /* already removed */ }
      resolve()
    }
    win.addEventListener('afterprint', cleanup)

    const tryPrint = () => {
      try { win.focus(); win.print() } catch { /* noop */ }
      setTimeout(() => cleanup(), 8000)
    }

    if (doc.readyState === 'complete') {
      setTimeout(tryPrint, 80)
    } else {
      iframe.onload = () => setTimeout(tryPrint, 80)
    }
  })
}

function buildInvoiceHtml({ invoice, outlet }) {
  const showGst = invoice.gst_enabled !== false
  const subtotal = Number(invoice.subtotal || 0)
  const cgst = Number(invoice.cgst || 0)
  const sgst = Number(invoice.sgst || 0)
  const tax = cgst + sgst
  const grandTotal = Number(invoice.grand_total || 0)
  const roundOff = Math.round((Number(invoice.round_off) || 0) * 100) / 100
  const grossBeforeBillDiscount = showGst ? subtotal + tax : subtotal
  // grand_total already carries the round-off, so add it back to keep the discount honest.
  const totalDiscount = Math.max(0, Math.round((grossBeforeBillDiscount - grandTotal + roundOff) * 100) / 100)
  const totalDiscountPercent =
    grossBeforeBillDiscount > 0
      ? Math.max(0, Math.round((totalDiscount / grossBeforeBillDiscount) * 100 * 100) / 100)
      : 0
  const paidAmount = Number(invoice.paid_amount || 0)
  const dueAmount = Math.max(0, Number(invoice.due_amount ?? grandTotal - paidAmount))
  const items = invoice.items || []

  const biz = outlet || {}
  const qtyDisplayMode = biz.sale_bill_qty_display === 'pack_and_loose' ? 'pack_and_loose' : 'base_units'
  const title = (biz.business_name || 'Pharmacy').toUpperCase()
  const termsHtml = formatTermsHtml(biz)
  const bankHtml = formatBankHtml(biz)
  const signatureHtml = formatSignatureHtml(biz, title)
  const addrLines = (biz.address || '')
    .split(/\n/)
    .map((s) => s.trim())
    .filter(Boolean)

  const gstColCount = showGst ? 13 : 11

  const gstHeaderCols = showGst
    ? `<th style="border:1px solid #000;padding:4px 2px;text-align:center">SGST%</th>
       <th style="border:1px solid #000;padding:4px 2px;text-align:center">CGST%</th>`
    : ''

  const itemRows = items
    .map((it, idx) => {
      const qty = Number(it.qty || 0)
      const unitRate = Number(it.rate || 0)
      const mrpLine = lineMrpFromItem(it, unitRate)
      const lineRate = lineRateFromItem(it)
      const discPct = lineDiscountPercentFromItem(it)
      const amount = qty > 0 ? lineRate : 0
      const sgstR = showGst ? Number(it.sgst_rate ?? 0) : 0
      const cgstR = showGst ? Number(it.cgst_rate ?? 0) : 0
      const gstCols = showGst
        ? `<td style="border:1px solid #000;padding:3px;text-align:center">${sgstR.toFixed(2)}</td>
           <td style="border:1px solid #000;padding:3px;text-align:center">${cgstR.toFixed(2)}</td>`
        : ''
      return `<tr>
        <td style="border:1px solid #000;padding:3px;text-align:center">${idx + 1}</td>
        <td class="pharm-inv-cell-wrap" style="border:1px solid #000;padding:3px;font-weight:bold">${escapeHtml(productNameForInvoiceItem(it))}</td>
        <td style="border:1px solid #000;padding:3px;text-align:center">${itemMedicineMeta(it)?.pack_info || it.pack_info || '—'}</td>
        <td style="border:1px solid #000;padding:3px;text-align:center;font-size:8px">${it.medicine?.hsn_code || it.hsn_code || '—'}</td>
        <td style="border:1px solid #000;padding:3px;text-align:center;font-size:8px">${it.batch?.batch_no ?? it.batch_no ?? '—'}</td>
        <td style="border:1px solid #000;padding:3px;text-align:center;font-size:8px">${safeFormat(it.batch?.expiry_date || it.expiry_date, 'MM/yy')}</td>
        <td style="border:1px solid #000;padding:3px;text-align:right">${formatMoney(mrpLine)}</td>
        <td style="border:1px solid #000;padding:3px;text-align:center">${discPct.toFixed(2)}</td>
        <td style="border:1px solid #000;padding:3px;text-align:right">${formatMoney(lineRate)}</td>
        ${gstCols}
        <td class="pharm-inv-cell-qty" style="border:1px solid #000;padding:3px;text-align:center">${escapeHtml(formatQtyCell(it, qtyDisplayMode))}</td>
        <td class="pharm-inv-cell-amount" style="border:1px solid #000;padding:3px;text-align:right;font-weight:bold">${formatMoney(amount)}</td>
      </tr>`
    })
    .join('')

  const totalQtyLine = formatInvoiceTotalQty(items, qtyDisplayMode)
  const fillerRowCount = Math.max(0, 8 - items.length)
  const emptyRows =
    fillerRowCount > 0
      ? Array.from({ length: fillerRowCount })
          .map(
            () =>
              `<tr style="height:18px">${Array.from({ length: gstColCount })
                .map(() => `<td style="border:1px solid #000;padding:3px">&nbsp;</td>`)
                .join('')}</tr>`,
          )
          .join('')
      : ''

  const taxSummaryLine = showGst
    ? `Taxable ${formatMoney(subtotal)} &middot; CGST ${formatMoney(cgst)} &middot; SGST ${formatMoney(sgst)} &middot; GST ${formatMoney(tax)}`
    : `Subtotal ${formatMoney(subtotal)} &middot; Non-GST bill (no tax)`
  const qtyColspan = qtyColumnColspan(showGst)

  const gstTotalRows = showGst
    ? `<div style="display:flex;justify-content:space-between;padding:4px 8px;border-bottom:1px solid #000">
         <span>CGST</span><span>${formatMoney(cgst)}</span>
       </div>
       <div style="display:flex;justify-content:space-between;padding:4px 8px;border-bottom:1px solid #000">
         <span>SGST</span><span>${formatMoney(sgst)}</span>
       </div>`
    : ''

  const headerGstInfo = showGst
    ? `${biz.gst_number ? `<div>GSTIN : ${biz.gst_number}</div>` : ''}${biz.dl_number ? `<div>D.L.NO. : ${biz.dl_number}</div>` : ''}`
    : `${biz.dl_number ? `<div>D.L.NO. : ${biz.dl_number}</div>` : ''}`

  const isB2B = Boolean(invoice?.party)
  const pd = invoice.patient_details
  const partyName = invoicePartyDisplayName(invoice)
  const partyAddr = invoicePartyDisplayAddress(invoice)
  const partyPhone = invoicePartyDisplayPhone(invoice)
  const partyGst = invoicePartyDisplayGst(invoice)
  const partyDl = invoicePartyDisplayDl(invoice)
  const patientNameHtml = escapeHtml(patientDisplayName(pd) || '—')
  const patientAddrHtml = escapeHtml(patientDisplayAddress(pd))
  const partyNameHtml = escapeHtml(partyName)
  const partyAddrHtml = escapeHtml(partyAddr)
  const partyPhoneHtml = escapeHtml(partyPhone)
  const partyGstHtml = escapeHtml(partyGst)
  const partyDlHtml = escapeHtml(partyDl)
  const doctorNameHtml = escapeHtml(invoiceDoctorDisplayName(invoice))
  const invoiceDate = safeFormat(invoice.created_at || new Date(), 'dd/MM/yyyy HH:mm')
  const notesAdviceText = extractNotesAdviceFromRemarks(invoice.remarks)
  const notesAdviceHtml = notesAdviceText ? escapeHtml(notesAdviceText).replace(/\n/g, '<br/>') : ''

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8"/>
  <title>Invoice ${invoice.invoice_no || ''}</title>
  <style>
    * { margin:0; padding:0; box-sizing:border-box; -webkit-print-color-adjust:exact !important; print-color-adjust:exact !important; color-adjust:exact !important; }
    html, body { width:100%; background:#fff; color:#000; font-family:Arial,sans-serif; font-size:10px; }
    @page { size:A4; margin:8mm; }
    ${INVOICE_LAYOUT_CSS}
    @media print {
      html, body { background:#fff !important; -webkit-print-color-adjust:exact !important; print-color-adjust:exact !important; color-adjust:exact !important; }
      ${INVOICE_LAYOUT_CSS}
    }
  </style>
</head>
<body>
  <div class="${INVOICE_SHELL_CLASS}" style="max-width:210mm;width:100%;margin:0 auto;border:1px solid #000;box-sizing:border-box;overflow:hidden;background:#fff">
  <div class="${INVOICE_ROOT_CLASS}" style="width:100%;box-sizing:border-box">

    <div class="${INVOICE_HEADER_CLASS}" style="display:flex;border-bottom:1px solid #000;border-left:1px solid #000;border-right:1px solid #000;box-sizing:border-box">
      <div style="flex:1;padding:8px 10px;border-right:1px solid #000">
        <div style="font-size:14px;font-weight:bold">${title}</div>
        ${showGst ? '<div style="font-size:8px;font-style:italic;margin-bottom:4px">GST Invoice</div>' : ''}
        <div style="font-size:8px;line-height:1.5">
          ${addrLines.length > 0 ? addrLines.map((l) => `<div>${l}</div>`).join('') : '<div>&mdash;</div>'}
          ${biz.mobile ? `<div>Phone: ${biz.mobile}</div>` : ''}
          ${biz.email ? `<div>E-Mail: ${biz.email}</div>` : ''}
          ${biz.website ? `<div>Web: ${biz.website}</div>` : ''}
        </div>
        <div style="font-size:8px;margin-top:4px;line-height:1.5">${headerGstInfo}</div>
      </div>
      <div style="flex:1;display:flex;flex-direction:column;justify-content:center;align-items:center;border-right:1px solid #000;padding:8px">
        <div style="font-size:16px;font-weight:bold;text-align:center">${showGst ? 'GST INVOICE' : 'INVOICE'}</div>
      </div>
      <div style="flex:1.2;padding:8px 10px;font-size:9px;line-height:1.8">
        ${
          isB2B
            ? `<div><strong>Party Name :</strong> ${partyNameHtml}</div>
               <div><strong>Party Address :</strong> ${partyAddrHtml}</div>
               <div><strong>Party Phone :</strong> ${partyPhoneHtml}</div>
               <div><strong>Party D.L.No. :</strong> ${partyDlHtml}</div>
               <div><strong>Party GSTIN :</strong> ${partyGstHtml}</div>`
            : retailPatientHeaderHtml(invoice)
        }
        <div style="display:flex;justify-content:space-between;margin-top:4px;border-top:1px solid #000;padding-top:4px">
          <span><strong>Invoice No. : ${invoice.invoice_no || ''}</strong></span>
          <span><strong>Date: ${invoiceDate}</strong></span>
        </div>
      </div>
    </div>

    <table style="width:100%;border-collapse:separate;border-spacing:0;font-size:9px;table-layout:fixed;border-top:1px solid #000;border-bottom:1px solid #000;border-left:1px solid #000;border-right:1px solid #000">
      ${invoiceColgroupHtml(showGst)}
      <thead>
        <tr style="background:#f0f0f0;border-bottom:1px solid #000;border-top:1px solid #000">
          <th style="border:1px solid #000;padding:4px 2px;text-align:center">SN.</th>
          <th style="border:1px solid #000;padding:4px 2px;text-align:left">PRODUCT NAME</th>
          <th style="border:1px solid #000;padding:4px 2px;text-align:center">PACK</th>
          <th style="border:1px solid #000;padding:4px 2px;text-align:center">HSN</th>
          <th style="border:1px solid #000;padding:4px 2px;text-align:center">BATCH</th>
          <th style="border:1px solid #000;padding:4px 2px;text-align:center">EXP.</th>
          <th style="border:1px solid #000;padding:4px 2px;text-align:right">MRP</th>
          <th style="border:1px solid #000;padding:4px 2px;text-align:center">DISC%</th>
          <th style="border:1px solid #000;padding:4px 2px;text-align:right">RATE</th>
          ${gstHeaderCols}
          <th style="border:1px solid #000;padding:4px 2px;text-align:center">QTY</th>
          <th style="border:1px solid #000;padding:4px 2px;text-align:right">AMOUNT</th>
        </tr>
      </thead>
      <tbody>
        ${itemRows}
        ${emptyRows}
      </tbody>
      <tfoot>
        <tr style="border-top:1px solid #000;border-bottom:1px solid #000;background:#fff">
          <td colspan="${qtyColspan}" style="padding:4px 8px;font-size:8px;border:1px solid #000">${taxSummaryLine}</td>
          <td style="padding:3px 2px;text-align:center;font-size:8px;font-weight:700;border:1px solid #000;line-height:1.2">
            <div style="font-size:7px;color:#555">Total Qty</div>
            <div>${totalQtyLine}</div>
          </td>
          <td style="padding:3px 2px;border:1px solid #000">&nbsp;</td>
        </tr>
      </tfoot>
    </table>

    <div class="${INVOICE_FOOTER_CLASS}" style="display:flex;border-bottom:1px solid #000;align-items:stretch;border-left:1px solid #000;border-right:1px solid #000;box-sizing:border-box">
      <div style="flex:1;padding:8px 10px;border-right:1px solid #000;font-size:8px;min-width:0">
        <div style="font-weight:bold;margin-bottom:4px;text-decoration:underline">Terms &amp; Conditions</div>
        <div style="line-height:1.6">${termsHtml}</div>
        ${
          notesAdviceHtml
            ? `<div style="margin-top:8px"><strong>Notes/Advice :</strong><div style="margin-top:3px;line-height:1.4">${notesAdviceHtml}</div></div>`
            : `<div style="margin-top:8px"><strong>Remark :</strong> ___________________________</div>`
        }
      </div>
      <div style="flex:1;padding:8px 10px;border-right:1px solid #000;font-size:8px;min-width:0">
        <div style="font-weight:bold;margin-bottom:4px;text-decoration:underline">BANK DETAILS :-</div>
        <div style="line-height:1.6">${bankHtml}</div>
      </div>
      <div style="flex:1;padding:8px 10px;border-right:1px solid #000;text-align:center;display:flex;flex-direction:column;justify-content:space-between;min-height:100px">
        <div style="font-size:8px;margin-bottom:4px">For ${title}</div>
        ${signatureHtml}
        <div style="border-top:1px solid #000;padding-top:4px;font-size:8px;margin-top:auto">Authorised Signatory</div>
      </div>
      <div class="pharm-invoice-totals" style="width:160px;flex-shrink:0;font-size:9px;border-left:1px solid #000">
        <div style="display:flex;justify-content:space-between;padding:4px 8px;border-bottom:1px solid #000">
          <span>SUB TOTAL</span><span style="font-weight:bold">${formatMoney(subtotal)}</span>
        </div>
        <div style="display:flex;justify-content:space-between;padding:4px 8px;border-bottom:1px solid #000">
          <span>ADD. DIS. (${totalDiscountPercent.toFixed(2)}%)</span><span>${formatMoney(totalDiscount)}</span>
        </div>
        ${gstTotalRows}
        ${
          roundOff !== 0
            ? `<div style="display:flex;justify-content:space-between;padding:4px 8px;border-bottom:1px solid #000">
          <span>ROUND OFF</span><span>${roundOff > 0 ? '+' : '-'}${formatMoney(Math.abs(roundOff))}</span>
        </div>`
            : ''
        }
        <div style="display:flex;justify-content:space-between;padding:4px 8px;border-bottom:1px solid #000">
          <span>PAID</span><span>${formatMoney(paidAmount)}</span>
        </div>
        <div style="display:flex;justify-content:space-between;padding:4px 8px;border-bottom:1px solid #000">
          <span>DUE</span><span>${formatMoney(dueAmount)}</span>
        </div>
        <div style="display:flex;justify-content:space-between;padding:6px 8px;background:#000;color:#fff;font-weight:bold;font-size:10px">
          <span>GRAND TOTAL</span><span>${formatMoney(grandTotal)}</span>
        </div>
        <div style="padding:4px 8px;font-size:8px;text-align:center;font-style:italic">Computer Generated Invoice</div>
      </div>
    </div>

  </div>
  </div>
</body>
</html>`
}

const PRINT_DOC_STYLES = `
  * { margin:0; padding:0; box-sizing:border-box; -webkit-print-color-adjust:exact !important; print-color-adjust:exact !important; color-adjust:exact !important; }
  html, body { width:100%; background:#fff; color:#000; font-family:Arial,sans-serif; font-size:10px; }
  body { display:block; padding:0; margin:0; }
  @page { size:A4; margin:8mm; }
  ${INVOICE_LAYOUT_CSS}
  @media print {
    html, body { background:#fff !important; -webkit-print-color-adjust:exact !important; print-color-adjust:exact !important; color-adjust:exact !important; }
    .${INVOICE_SHELL_CLASS} { border: ${B_ORDER} !important; }
    ${INVOICE_LAYOUT_CSS}
  }
`

function reinforceInvoiceShellForPrint(rootEl) {
  if (!rootEl) return
  rootEl.style.setProperty('box-sizing', 'border-box', 'important')
  rootEl.style.setProperty('width', '100%', 'important')
  rootEl.style.setProperty('max-width', '210mm', 'important')
  rootEl.style.setProperty('border', B_ORDER, 'important')
  rootEl.style.setProperty('overflow', 'hidden', 'important')
  rootEl.style.setProperty('background', '#fff', 'important')
  const inner = rootEl.querySelector(`.${INVOICE_ROOT_CLASS}`)
  if (inner) {
    inner.style.setProperty('width', '100%', 'important')
    inner.style.setProperty('border', 'none', 'important')
  }
}

function normalizePrintHtml(html) {
  return String(html || '').replace(/\s+/g, ' ').trim()
}

function getPreviewShellRoot(previewRoot) {
  if (!previewRoot) return null
  if (previewRoot.classList?.contains(INVOICE_SHELL_CLASS)) return previewRoot
  return previewRoot.querySelector(`.${INVOICE_SHELL_CLASS}`) || previewRoot
}

function buildPrintHtmlFromPreview(previewRoot, invoiceNo) {
  const shell = getPreviewShellRoot(previewRoot)
  if (!shell) return ''
  const clone = shell.cloneNode(true)
  clone.querySelectorAll('[contenteditable]').forEach((el) => {
    el.removeAttribute('contenteditable')
  })
  clone.querySelectorAll('style[data-preview-only]').forEach((el) => el.remove())
  reinforceInvoiceShellForPrint(clone)
  const bodyHtml = clone.outerHTML
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8"/>
  <title>Invoice ${invoiceNo || ''}</title>
  <style>${PRINT_DOC_STYLES}</style>
</head>
<body>
  ${bodyHtml}
</body>
</html>`
}

function extractShellHtmlFromPrintDocument(html) {
  if (!html) return ''
  try {
    const parser = new DOMParser()
    const doc = parser.parseFromString(html, 'text/html')
    const shell = doc.querySelector(`.${INVOICE_SHELL_CLASS}`)
    return shell ? shell.outerHTML : doc.body?.innerHTML || ''
  } catch {
    return ''
  }
}

function enableEditableOnShell(root) {
  if (!root) return () => {}
  const cleanups = []
  root.querySelectorAll(`.${EDITABLE_CLASS}`).forEach((el) => {
    el.setAttribute('contenteditable', 'true')
    el.addEventListener('keydown', preventEditableNewline)
    el.addEventListener('paste', handleEditablePaste)
    el.addEventListener('beforeinput', ensureInheritedTypingStyles)
    cleanups.push(() => {
      el.removeEventListener('keydown', preventEditableNewline)
      el.removeEventListener('paste', handleEditablePaste)
      el.removeEventListener('beforeinput', ensureInheritedTypingStyles)
    })
  })
  return () => cleanups.forEach((fn) => fn())
}

const SavedPrintHtmlPreview = React.memo(
  React.forwardRef(function SavedPrintHtmlPreview({ printHtml }, ref) {
    const shellHtml = extractShellHtmlFromPrintDocument(printHtml)
    useEffect(() => {
      const root = ref?.current
      if (!root) return undefined
      return enableEditableOnShell(getPreviewShellRoot(root))
    }, [ref, shellHtml])
    if (!shellHtml) {
      return <p style={{ textAlign: 'center', color: '#64748b' }}>No printed copy saved yet.</p>
    }
    return <div ref={ref} dangerouslySetInnerHTML={{ __html: shellHtml }} />
  }),
)

const InvoicePreviewDocument = React.memo(
  React.forwardRef(function InvoicePreviewDocument({ invoice, outlet }, previewRef) {
  const showGst = invoice.gst_enabled !== false
  const subtotal = Number(invoice.subtotal || 0)
  const cgst = Number(invoice.cgst || 0)
  const sgst = Number(invoice.sgst || 0)
  const tax = cgst + sgst
  const grandTotal = Number(invoice.grand_total || 0)
  const roundOff = Math.round((Number(invoice.round_off) || 0) * 100) / 100
  const grossBeforeBillDiscount = showGst ? subtotal + tax : subtotal
  // grand_total already carries the round-off, so add it back to keep the discount honest.
  const totalDiscount = Math.max(0, Math.round((grossBeforeBillDiscount - grandTotal + roundOff) * 100) / 100)
  const totalDiscountPercent =
    grossBeforeBillDiscount > 0
      ? Math.max(0, Math.round((totalDiscount / grossBeforeBillDiscount) * 100 * 100) / 100)
      : 0
  const paidAmount = Number(invoice.paid_amount || 0)
  const dueAmount = Math.max(0, Number(invoice.due_amount ?? grandTotal - paidAmount))
  const items = invoice.items || []
  const qtyDisplayMode = outlet?.sale_bill_qty_display === 'pack_and_loose' ? 'pack_and_loose' : 'base_units'
  const isB2B = Boolean(invoice?.party)
  const partyNameLabel = invoicePartyDisplayName(invoice)
  const partyAddrLabel = invoicePartyDisplayAddress(invoice)
  const partyPhoneLabel = invoicePartyDisplayPhone(invoice)
  const partyGstLabel = invoicePartyDisplayGst(invoice)
  const partyDlLabel = invoicePartyDisplayDl(invoice)
  const notesAdvice = extractNotesAdviceFromRemarks(invoice.remarks)

  const biz = outlet || {}
  const title = (biz.business_name || 'Pharmacy').toUpperCase()
  const addrLines = (biz.address || '')
    .split(/\n/)
    .map((s) => s.trim())
    .filter(Boolean)

  const tableCols = showGst ? 13 : 11
  const totalQtyLine = formatInvoiceTotalQty(items, qtyDisplayMode)
  const fillerRowCount = Math.max(0, 8 - items.length)
  const taxSummaryLine = showGst
    ? `Taxable ${formatMoney(subtotal)} · CGST ${formatMoney(cgst)} · SGST ${formatMoney(sgst)} · GST ${formatMoney(tax)}`
    : `Subtotal ${formatMoney(subtotal)} · Non-GST bill (no tax)`
  const qtyColspan = qtyColumnColspan(showGst)

  return (
    <div ref={previewRef} className={INVOICE_SHELL_CLASS} style={INVOICE_SHELL_STYLE}>
      <div className={INVOICE_ROOT_CLASS} style={INVOICE_ROOT_STYLE}>

        <div
          className={INVOICE_HEADER_CLASS}
          style={{ display: 'flex', borderBottom: B_ORDER, borderLeft: B_ORDER, borderRight: B_ORDER, boxSizing: 'border-box' }}
        >
          <div style={{ flex: 1, padding: '8px 10px', borderRight: B_ORDER }}>
            <EditableBlock style={{ fontSize: '14px', fontWeight: 'bold' }}>{title}</EditableBlock>
            {showGst ? (
              <EditableBlock style={{ fontSize: '8px', fontStyle: 'italic', marginBottom: '4px' }}>
                GST Invoice
              </EditableBlock>
            ) : null}
            <div style={{ fontSize: '8px', lineHeight: '1.5' }}>
              {addrLines.length > 0 ? (
                addrLines.map((line, i) => (
                  <EditableBlock key={i} style={{ fontSize: '8px' }}>
                    {line}
                  </EditableBlock>
                ))
              ) : (
                <EditableBlock style={{ fontSize: '8px' }}>—</EditableBlock>
              )}
              {biz.mobile ? (
                <EditableBlock style={{ fontSize: '8px' }}>Phone: {biz.mobile}</EditableBlock>
              ) : null}
              {biz.email ? (
                <EditableBlock style={{ fontSize: '8px' }}>E-Mail: {biz.email}</EditableBlock>
              ) : null}
              {biz.website ? (
                <EditableBlock style={{ fontSize: '8px' }}>Web: {biz.website}</EditableBlock>
              ) : null}
            </div>
            {showGst ? (
              <div style={{ fontSize: '8px', marginTop: '4px', lineHeight: '1.5' }}>
                {biz.gst_number ? (
                  <EditableBlock style={{ fontSize: '8px' }}>GSTIN : {biz.gst_number}</EditableBlock>
                ) : null}
                {biz.dl_number ? (
                  <EditableBlock style={{ fontSize: '8px' }}>D.L.NO. : {biz.dl_number}</EditableBlock>
                ) : null}
              </div>
            ) : (
              <div style={{ fontSize: '8px', marginTop: '4px', lineHeight: '1.5' }}>
                {biz.dl_number ? (
                  <EditableBlock style={{ fontSize: '8px' }}>D.L.NO. : {biz.dl_number}</EditableBlock>
                ) : null}
              </div>
            )}
          </div>

          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', borderRight: B_ORDER, padding: '8px' }}>
            <EditableBlock style={{ fontSize: '16px', fontWeight: 'bold', textAlign: 'center' }}>
              {showGst ? 'GST INVOICE' : 'INVOICE'}
            </EditableBlock>
          </div>

          <div style={{ flex: 1.2, padding: '8px 10px', fontSize: '9px', lineHeight: '1.8' }}>
            {isB2B ? (
              <>
                <EditableBlock>
                  <strong>Party Name :</strong> {partyNameLabel}
                </EditableBlock>
                <EditableBlock>
                  <strong>Party Address :</strong> {partyAddrLabel}
                </EditableBlock>
                <EditableBlock>
                  <strong>Party Phone :</strong> {partyPhoneLabel}
                </EditableBlock>
                <EditableBlock>
                  <strong>Party D.L.No. :</strong> {partyDlLabel}
                </EditableBlock>
                <EditableBlock>
                  <strong>Party GSTIN :</strong> {partyGstLabel}
                </EditableBlock>
              </>
            ) : (
              retailPatientHeaderReact(invoice)
            )}
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '4px', borderTop: B_ORDER, paddingTop: '4px' }}>
              <EditableBlock as="span">
                <strong>Invoice No. : {invoice.invoice_no}</strong>
              </EditableBlock>
              <EditableBlock as="span">
                <strong>Date: {safeFormat(invoice.created_at || new Date(), 'dd/MM/yyyy HH:mm')}</strong>
              </EditableBlock>
            </div>
          </div>
        </div>

        <table
          style={{
            width: '100%',
            borderCollapse: 'separate',
            borderSpacing: 0,
            fontSize: '9px',
            tableLayout: 'fixed',
            borderTop: B_ORDER,
            borderBottom: B_ORDER,
            borderLeft: B_ORDER,
            borderRight: B_ORDER,
          }}
        >
          <InvoiceColgroupJsx showGst={showGst} />
          <thead>
            <tr style={{ background: '#f0f0f0', borderBottom: B_ORDER, borderTop: B_ORDER }}>
              <th style={{ border: B_ORDER, padding: '4px 2px', textAlign: 'center' }}>SN.</th>
              <th style={{ border: B_ORDER, padding: '4px 2px', textAlign: 'left' }}>PRODUCT NAME</th>
              <th style={{ border: B_ORDER, padding: '4px 2px', textAlign: 'center' }}>PACK</th>
              <th style={{ border: B_ORDER, padding: '4px 2px', textAlign: 'center' }}>HSN</th>
              <th style={{ border: B_ORDER, padding: '4px 2px', textAlign: 'center' }}>BATCH</th>
              <th style={{ border: B_ORDER, padding: '4px 2px', textAlign: 'center' }}>EXP.</th>
              <th style={{ border: B_ORDER, padding: '4px 2px', textAlign: 'right' }}>MRP</th>
              <th style={{ border: B_ORDER, padding: '4px 2px', textAlign: 'center' }}>DISC%</th>
              <th style={{ border: B_ORDER, padding: '4px 2px', textAlign: 'right' }}>RATE</th>
              {showGst ? (
                <>
                  <th style={{ border: B_ORDER, padding: '4px 2px', textAlign: 'center' }}>SGST%</th>
                  <th style={{ border: B_ORDER, padding: '4px 2px', textAlign: 'center' }}>CGST%</th>
                </>
              ) : null}
              <th style={{ border: B_ORDER, padding: '4px 2px', textAlign: 'center' }}>QTY</th>
              <th style={{ border: B_ORDER, padding: '4px 2px', textAlign: 'right' }}>AMOUNT</th>
            </tr>
          </thead>
          <tbody>
            {items.map((it, idx) => {
              const qty = Number(it.qty || 0)
              const mrpLine = lineMrpFromItem(it, Number(it.rate || 0))
              const lineRate = lineRateFromItem(it)
              const discPct = lineDiscountPercentFromItem(it)
              const amount = qty > 0 ? lineRate : 0
              const sgstR = showGst ? Number(it.sgst_rate ?? 0) : 0
              const cgstR = showGst ? Number(it.cgst_rate ?? 0) : 0
              return (
                <tr key={idx}>
                  <td style={{ border: B_ORDER, padding: '3px', textAlign: 'center' }}>{idx + 1}</td>
                  <td
                    contentEditable
                    suppressContentEditableWarning
                    className={EDITABLE_CLASS}
                    style={{ border: B_ORDER, padding: '3px', fontWeight: 'bold', ...CELL_WRAP_STYLE }}
                    onKeyDown={preventEditableNewline}
                    onPaste={handleEditablePaste}
                    onBeforeInput={ensureInheritedTypingStyles}
                  >
                    {productNameForInvoiceItem(it)}
                  </td>
                  <td style={{ border: B_ORDER, padding: '3px', textAlign: 'center' }}>
                    {itemMedicineMeta(it)?.pack_info || it.pack_info || '—'}
                  </td>
                  <td style={{ border: B_ORDER, padding: '3px', textAlign: 'center', fontSize: '8px' }}>
                    {it.medicine?.hsn_code || it.hsn_code || '—'}
                  </td>
                  <td style={{ border: B_ORDER, padding: '3px', textAlign: 'center', fontSize: '8px' }}>
                    {it.batch?.batch_no ?? it.batch_no ?? '—'}
                  </td>
                  <td style={{ border: B_ORDER, padding: '3px', textAlign: 'center', fontSize: '8px' }}>
                    {safeFormat(it.batch?.expiry_date || it.expiry_date, 'MM/yy')}
                  </td>
                  <td style={{ border: B_ORDER, padding: '3px', textAlign: 'right' }}>{formatMoney(mrpLine)}</td>
                  <td style={{ border: B_ORDER, padding: '3px', textAlign: 'center' }}>{discPct.toFixed(2)}</td>
                  <td style={{ border: B_ORDER, padding: '3px', textAlign: 'right' }}>{formatMoney(lineRate)}</td>
                  {showGst ? (
                    <>
                      <td style={{ border: B_ORDER, padding: '3px', textAlign: 'center' }}>{sgstR.toFixed(2)}</td>
                      <td style={{ border: B_ORDER, padding: '3px', textAlign: 'center' }}>{cgstR.toFixed(2)}</td>
                    </>
                  ) : null}
                  <td style={{ border: B_ORDER, padding: '3px', ...CELL_QTY_STYLE }}>{formatQtyCell(it, qtyDisplayMode)}</td>
                  <td style={{ border: B_ORDER, padding: '3px', ...CELL_AMOUNT_STYLE }}>{formatMoney(amount)}</td>
                </tr>
              )
            })}
            {fillerRowCount > 0 &&
              Array.from({ length: fillerRowCount }).map((_, i) => (
                <tr key={`empty-${i}`} style={{ height: '18px' }}>
                  {Array.from({ length: tableCols }).map((_, j) => (
                    <td key={j} style={{ border: B_ORDER, padding: '3px', minHeight: '18px' }}>&nbsp;</td>
                  ))}
                </tr>
              ))}
          </tbody>
          <tfoot>
            <tr style={{ borderTop: B_ORDER, borderBottom: B_ORDER, background: '#fff' }}>
              <td colSpan={qtyColspan} style={{ padding: '4px 8px', fontSize: '8px', border: B_ORDER }}>
                {taxSummaryLine}
              </td>
              <td
                style={{
                  padding: '3px 2px',
                  textAlign: 'center',
                  fontSize: '8px',
                  fontWeight: 700,
                  border: B_ORDER,
                  lineHeight: 1.2,
                }}
              >
                <div style={{ fontSize: '7px', color: '#555' }}>Total Qty</div>
                <div>{totalQtyLine}</div>
              </td>
              <td style={{ padding: '3px 2px', border: B_ORDER }}>&nbsp;</td>
            </tr>
          </tfoot>
        </table>

        <InvoiceFooterPreview
          outlet={biz}
          title={title}
          notesAdvice={notesAdvice}
          showGst={showGst}
          subtotal={subtotal}
          totalDiscount={totalDiscount}
          totalDiscountPercent={totalDiscountPercent}
          cgst={cgst}
          sgst={sgst}
          roundOff={roundOff}
          paidAmount={paidAmount}
          dueAmount={dueAmount}
          grandTotal={grandTotal}
        />


      </div>
    </div>
  )
  }),
)

export default function PharmacyInvoicePrint({
  invoice,
  outlet,
  onClose,
  variant = 'original',
  onPrintCopySaved,
  embedded = false,
  autoPrint = false,
}) {
  const [printing, setPrinting] = useState(false)
  const [persisting, setPersisting] = useState(false)
  const previewRef = useRef(null)
  const baselineHtmlRef = useRef('')
  const isPrintedVariant = variant === 'printed'
  const savedPrintHtml = invoice?.print_html || ''
  const printOutlet = React.useMemo(
    () => resolveOutletForChannel(outlet, invoiceOutletChannel(invoice)),
    [outlet, invoice],
  )

  const captureBaseline = useCallback(() => {
    if (isPrintedVariant && savedPrintHtml) {
      baselineHtmlRef.current = savedPrintHtml
      return
    }
    const root = previewRef.current
    if (!root) return
    const html = buildPrintHtmlFromPreview(root, invoice?.invoice_no)
    if (html) baselineHtmlRef.current = html
  }, [invoice?.invoice_no, isPrintedVariant, savedPrintHtml])

  useEffect(() => {
    const t = window.setTimeout(captureBaseline, 50)
    return () => window.clearTimeout(t)
  }, [captureBaseline, invoice?.id, variant])

  const persistPrintCopyIfChanged = useCallback(async () => {
    if (!invoice?.id) return false
    const root = previewRef.current
    const current = root
      ? buildPrintHtmlFromPreview(root, invoice.invoice_no)
      : isPrintedVariant
        ? savedPrintHtml
        : ''
    if (!current) return false
    if (normalizePrintHtml(current) === normalizePrintHtml(baselineHtmlRef.current)) {
      return false
    }
    setPersisting(true)
    try {
      const { data } = await api.patch(`/pharmacy/invoices/${invoice.id}/print-copy/`, {
        print_html: current,
      })
      const saved = data?.data || data
      onPrintCopySaved?.(invoice.id, {
        has_print_copy: true,
        print_html: saved?.print_html ?? current,
        print_html_updated_at: saved?.print_html_updated_at ?? null,
      })
      baselineHtmlRef.current = current
      return true
    } catch {
      toast.error('Could not save printed copy')
      return false
    } finally {
      setPersisting(false)
    }
  }, [invoice, isPrintedVariant, savedPrintHtml, onPrintCopySaved])

  const handleClose = useCallback(async () => {
    await persistPrintCopyIfChanged()
    onClose?.()
  }, [persistPrintCopyIfChanged, onClose])

  const doPrint = useCallback(async () => {
    if (!invoice || printing) return
    setPrinting(true)
    try {
      const root = previewRef.current
      const html = root
        ? buildPrintHtmlFromPreview(root, invoice.invoice_no)
        : buildInvoiceHtml({ invoice, outlet: printOutlet })
      await printViaIframe(html)
      await persistPrintCopyIfChanged()
    } catch {
      /* noop */
    } finally {
      setPrinting(false)
    }
  }, [invoice, printOutlet, printing, persistPrintCopyIfChanged])

  // TPA pack printing mounts this off-screen just to fire the print — no operator input.
  const doPrintRef = useRef(doPrint)
  useEffect(() => { doPrintRef.current = doPrint }, [doPrint])
  const autoPrintStartedRef = useRef(false)
  useEffect(() => {
    if (!autoPrint || embedded || !invoice?.id) return undefined
    if (autoPrintStartedRef.current) return undefined
    autoPrintStartedRef.current = true
    const timer = window.setTimeout(async () => {
      try {
        await doPrintRef.current()
      } finally {
        onClose?.()
      }
    }, 400)
    return () => window.clearTimeout(timer)
  }, [autoPrint, embedded, invoice?.id, onClose])

  if (!invoice) return null

  const variantLabel = isPrintedVariant ? 'Printed copy' : 'Original bill'

  return (
    <div
      style={embedded
        ? { background: 'white', overflow: 'visible', padding: '8px 0 24px' }
        : autoPrint
          // Unattended (TPA pack) printing: stay off-screen — the bill is cloned into a
          // print iframe, so it must render but must not cover the pack screen.
          ? {
              position: 'fixed',
              top: 0,
              left: '-10000px',
              width: '230mm',
              background: 'white',
              zIndex: -1,
              opacity: 0,
              pointerEvents: 'none',
            }
          : {
              position: 'fixed',
              inset: 0,
              background: 'white',
              zIndex: 9999,
              overflowY: 'auto',
              padding: '20px',
            }}
    >
      <style data-preview-only>{PREVIEW_EDIT_STYLES}</style>
      <p style={{ textAlign: 'center', marginBottom: '8px', fontSize: '11px', fontWeight: 700, color: '#475569' }}>
        {variantLabel} · #{invoice.invoice_no || '—'}
      </p>
      {isPrintedVariant && savedPrintHtml ? (
        <SavedPrintHtmlPreview ref={previewRef} printHtml={savedPrintHtml} />
      ) : (
        <InvoicePreviewDocument ref={previewRef} invoice={invoice} outlet={printOutlet} />
      )}
      <p style={{ textAlign: 'center', marginTop: '12px', fontSize: '12px', color: '#64748b' }}>
        Click any text on the bill to edit before printing. Changes to the printed copy are saved when you close or print.
      </p>
      <div style={{ textAlign: 'center', marginTop: '10px', display: 'flex', justifyContent: 'center', gap: '12px', flexWrap: 'wrap' }}>
        <button
          type="button"
          onClick={doPrint}
          disabled={printing || persisting}
          style={{ background: '#16a34a', color: 'white', border: 'none', padding: '10px 28px', borderRadius: '6px', cursor: 'pointer', fontSize: '14px', fontWeight: 'bold' }}
        >
          {printing ? 'Printing…' : '🖨 Print Invoice'}
        </button>
        {!embedded && (
          <button
            type="button"
            onClick={handleClose}
            disabled={printing || persisting}
            style={{ background: '#1e40af', color: 'white', border: 'none', padding: '10px 24px', borderRadius: '6px', cursor: 'pointer', fontSize: '14px' }}
          >
            {persisting ? 'Saving…' : '✕ Close Preview'}
          </button>
        )}
      </div>
    </div>
  )
}
