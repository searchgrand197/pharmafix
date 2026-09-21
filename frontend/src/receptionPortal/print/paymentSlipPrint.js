import { formatGuardianLineForSlip } from './opdPrintFormat'
import { buildHmsPrintCloseScript, STANDALONE_PRINT_DOCUMENT_CSS } from '../../utils/triggerHMSPrint.js'

export const PAYMENT_SLIP_HALF_PAGE_HEIGHT = '148.5mm'
/** Max line items on non-last half-pages (no totals block). */
export const PAYMENT_SLIP_ITEMS_PER_PAGE = 12
/** Max line items on the final half-page (room reserved for totals + footer). */
export const PAYMENT_SLIP_ITEMS_LAST_PAGE_MAX = 7
/** @deprecated use PAYMENT_SLIP_ITEMS_PER_PAGE */
export const PAYMENT_SLIP_ITEMS_FIRST_PAGE = PAYMENT_SLIP_ITEMS_PER_PAGE
/** @deprecated use PAYMENT_SLIP_ITEMS_PER_PAGE */
export const PAYMENT_SLIP_ITEMS_CONTINUATION = PAYMENT_SLIP_ITEMS_PER_PAGE

export const PAYMENT_SLIP_PRINT_CLOSE_SCRIPT = buildHmsPrintCloseScript()

export function resolvePaymentSlipLogoUrl(profileOrUrl) {
  let raw = ''
  if (typeof profileOrUrl === 'string') {
    raw = profileOrUrl
  } else if (profileOrUrl && typeof profileOrUrl === 'object') {
    raw = profileOrUrl.hospital_logo_url || profileOrUrl.hospital_logo || ''
  }
  raw = String(raw || '').trim()
  if (!raw) return ''
  if (/^https?:\/\//i.test(raw)) return raw
  if (raw.startsWith('//')) return `${window.location.protocol}${raw}`
  if (raw.startsWith('/')) return `${window.location.origin}${raw}`
  return `${window.location.origin}/${raw.replace(/^\//, '')}`
}

export function buildPaymentSlipProfileLines(profile, escapeHtml) {
  const esc = escapeHtml || ((v) => String(v ?? ''))
  const address = esc(profile?.address || '')
  const pinCode = esc(profile?.pin_code || '')
  const phone = esc(profile?.phone || '')
  const email = esc(profile?.email || '')
  const website = esc(profile?.website || '')
  return [
    address ? `${address}<br/>` : '',
    pinCode ? `Pin Code: ${pinCode}<br/>` : '',
    phone ? `Phone: ${phone}<br/>` : '',
    email ? `Email: ${email}<br/>` : '',
    website ? `Website: ${website}` : '',
  ].filter(Boolean).join('')
}

export function formatPaymentSlipGenderAge(patient = {}) {
  const genderRaw = String(patient.gender || '').trim().toLowerCase()
  const gender =
    genderRaw === 'male' ? 'Male' : genderRaw === 'female' ? 'Female' : genderRaw === 'other' ? 'Other' : ''
  const ageVal =
    patient.age_value != null && patient.age_value !== ''
      ? patient.age_value
      : patient.age != null && patient.age !== ''
        ? patient.age
        : patient.patient_age
  const unit = String(patient.age_unit || patient.patient_age_unit || 'years').trim().toLowerCase()
  let ageLabel = ''
  if (ageVal != null && ageVal !== '' && !Number.isNaN(Number(ageVal))) {
    const u = unit === 'months' ? 'Mon' : unit === 'days' ? 'Days' : 'Yrs'
    ageLabel = `${ageVal} ${u}`
  }
  return [gender, ageLabel].filter(Boolean).join(' / ') || '—'
}

export function formatPaymentSlipGuardianLine(patient = {}) {
  const name = patient.guardian_name ?? patient.patient_guardian_name ?? ''
  const rel = patient.guardian_relationship ?? patient.patient_guardian_relationship ?? ''
  return formatGuardianLineForSlip(name, rel) || '—'
}

export function formatPaymentSlipAttributedDoctor(name) {
  const n = String(name || '').trim()
  if (!n || /^self\s*\(hospital\)$/i.test(n)) return 'Self (Hospital)'
  if (/^dr\.?\s/i.test(n)) return n
  return `Dr. ${n}`
}

export function resolvePaymentSlipLineTotal(item) {
  const lineTotal = Number(parseFloat(item?.line_total))
  if (Number.isFinite(lineTotal)) return lineTotal
  const amount = Number(parseFloat(item?.amount))
  if (Number.isFinite(amount)) return amount
  const quantity = Number(parseFloat(item?.quantity))
  const unitPrice = Number(parseFloat(item?.unit_price))
  if (Number.isFinite(quantity) && Number.isFinite(unitPrice)) return quantity * unitPrice
  return 0
}

export function chunkPaymentSlipItems(items, {
  perPage = PAYMENT_SLIP_ITEMS_PER_PAGE,
  lastPageMax = PAYMENT_SLIP_ITEMS_LAST_PAGE_MAX,
} = {}) {
  const list = Array.isArray(items) ? items : []
  if (list.length === 0) return [[]]
  if (list.length <= lastPageMax) return [list]

  const pages = []
  let index = 0
  while (index < list.length) {
    const remaining = list.length - index
    if (remaining <= lastPageMax) {
      pages.push(list.slice(index))
      break
    }
    if (remaining <= perPage + lastPageMax) {
      const firstPart = Math.min(perPage, remaining - 1)
      pages.push(list.slice(index, index + firstPart))
      pages.push(list.slice(index + firstPart))
      break
    }
    pages.push(list.slice(index, index + perPage))
    index += perPage
  }
  return pages
}

export function buildPaymentSlipContainerCss() {
  return `.slip {
        width: 210mm;
        height: ${PAYMENT_SLIP_HALF_PAGE_HEIGHT};
        min-height: ${PAYMENT_SLIP_HALF_PAGE_HEIGHT};
        max-height: ${PAYMENT_SLIP_HALF_PAGE_HEIGHT};
        overflow: hidden;
        padding: 6mm 8mm 4mm;
        display: flex;
        flex-direction: column;
        border-bottom: 2px dashed #aaa;
        page-break-after: always;
        page-break-inside: avoid;
      }
      .slip:last-child {
        page-break-after: auto;
      }`
}

export function buildPaymentSlipHeaderCss({ accentColor = '#1a6b3f', topBorderColor = '#111' } = {}) {
  return `
      .top {
        display: flex;
        justify-content: space-between;
        align-items: flex-start;
        padding-bottom: 4mm;
        border-bottom: 2px solid ${topBorderColor};
        margin-bottom: 3mm;
      }
      .brand {
        display: flex;
        align-items: center;
        gap: 3mm;
        min-width: 0;
      }
      .hosp-logo {
        height: 14mm;
        max-width: 28mm;
        object-fit: contain;
        flex-shrink: 0;
      }
      .brand-text {
        min-width: 0;
      }
      .hosp-name {
        font-size: 22px;
        font-weight: 900;
        color: ${accentColor};
        letter-spacing: -0.5px;
        line-height: 1;
        margin-bottom: 2px;
      }
      .hosp-tag {
        font-size: 9px;
        color: #555;
        letter-spacing: 0.5px;
        text-transform: uppercase;
      }
      .address {
        text-align: right;
        font-size: 9.5px;
        color: #333;
        line-height: 1.55;
      }
      .address strong { font-size: 10px; }
  `
}

export function buildPaymentSlipPrintStyles({ isCredit = false } = {}) {
  return `
      ${STANDALONE_PRINT_DOCUMENT_CSS}
      @page { size: A4 portrait; margin: 0; }
      * { box-sizing: border-box; margin: 0; padding: 0; }
      body {
        font-family: Arial, sans-serif;
        font-size: 11px;
        color: #111;
        width: 210mm;
        background: #fff;
      }
      ${buildPaymentSlipContainerCss()}
      ${buildPaymentSlipHeaderCss()}
      .receipt-title {
        text-align: center;
        font-size: 13px;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 2px;
        border-bottom: 1px solid #111;
        padding-bottom: 2mm;
        margin-bottom: 2.5mm;
      }
      .info-grid {
        display: grid;
        grid-template-columns: 1fr 1fr 1fr;
        gap: 1.5mm 4mm;
        margin-bottom: 2.5mm;
        font-size: 10px;
      }
      .info-cell { display: flex; flex-direction: column; gap: 1px; }
      .info-label { color: #666; font-size: 9px; }
      .info-val { font-weight: 700; color: #111; }
      .table-wrap { flex: 1; min-height: 0; overflow: hidden; }
      table { width: 100%; border-collapse: collapse; font-size: 10.5px; }
      thead tr { background: #1a6b3f; color: #fff; }
      th { padding: 3px 5px; font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: .5px; }
      th.c { text-align: center; width: 26px; }
      th.l { text-align: left; }
      th.r { text-align: right; width: 52px; }
      tbody tr { border-bottom: 1px solid #e5e7eb; }
      tbody tr:last-child { border-bottom: 1.5px solid #111; }
      td { padding: 3px 5px; }
      td.c { text-align: center; color: #555; }
      td.l { text-align: left; }
      td.r { text-align: right; font-weight: 600; }
      .totals { margin-left: auto; width: 160px; margin-top: 1mm; font-size: 10.5px; flex-shrink: 0; }
      .t-row { display: flex; justify-content: space-between; padding: 1px 5px; }
      .t-row.disc { color: #dc2626; }
      .t-row.final {
        font-weight: 800;
        font-size: 12px;
        border-top: 2px solid #111;
        padding-top: 2px;
        margin-top: 2px;
        color: #1a6b3f;
      }
      .footer {
        margin-top: auto;
        padding-top: 2mm;
        border-top: 1px dashed #aaa;
        display: flex;
        justify-content: space-between;
        align-items: flex-end;
        font-size: 9px;
        color: #555;
        flex-shrink: 0;
      }
      .note { max-width: 65%; line-height: 1.5; }
      .continued-note { font-style: italic; color: #666; }
      .paid-box {
        border: 2px solid #1a6b3f;
        color: #1a6b3f;
        font-weight: 900;
        font-size: 13px;
        padding: 2px 10px;
        border-radius: 4px;
        letter-spacing: 2px;
        flex-shrink: 0;
      }
      .due-box {
        border: 2px solid #b45309;
        color: #b45309;
        background: #fffbeb;
      }
      .page-num {
        text-align: center;
        font-size: 9px;
        color: #666;
        padding-top: 1.5mm;
        flex-shrink: 0;
      }
      .slip-body { flex: 1; min-height: 0; display: flex; flex-direction: column; }
  `
}

export function buildPaymentSlipTopHeaderHtml({
  hospitalName = '',
  logoUrl = '',
  tagline = 'Healthcare & Diagnostics',
  profileLines = '',
  leftExtraHtml = '',
  escapeHtml = (v) => String(v ?? ''),
}) {
  const esc = escapeHtml
  const logoBlock = logoUrl
    ? `<img class="hosp-logo" src="${esc(logoUrl)}" alt="" />`
    : ''
  const taglineHtml = String(tagline).includes('&')
    ? tagline
    : esc(tagline)

  return `
      <div class="top">
        <div class="brand">
          ${logoBlock}
          <div class="brand-text">
            <div class="hosp-name">${esc(hospitalName)}</div>
            <div class="hosp-tag">${taglineHtml}</div>
            ${leftExtraHtml}
          </div>
        </div>
        <div class="address">
          ${profileLines || '&mdash;'}
        </div>
      </div>`
}

export function buildPaymentSlipTableRows(items, startSlNo, escapeHtml) {
  const esc = escapeHtml || ((v) => String(v ?? ''))
  return (items || []).map((it, i) => {
    const quantity = Math.max(1, Number(parseFloat(it?.quantity)) || 1)
    const lineTotal = resolvePaymentSlipLineTotal(it)
    const unitPrice = Number.isFinite(Number(parseFloat(it?.unit_price)))
      ? Number(parseFloat(it?.unit_price))
      : (quantity > 0 ? lineTotal / quantity : lineTotal)
    return `<tr>
        <td class="c">${startSlNo + i + 1}</td>
        <td class="l">${esc(it?.description || 'Service')}</td>
        <td class="c">${quantity}</td>
        <td class="r">₹${unitPrice.toFixed(2)}</td>
        <td class="r">₹${lineTotal.toFixed(2)}</td>
      </tr>`
  }).join('')
}

function buildPaymentSlipInfoGridHtml(ctx, escapeHtml) {
  const esc = escapeHtml || ((v) => String(v ?? ''))
  return `
        <div class="info-grid">
          <div class="info-cell">
            <span class="info-label">Slip Number</span>
            <span class="info-val">${esc(ctx.slipNumber || '--')}</span>
          </div>
          <div class="info-cell">
            <span class="info-label">Invoice Number</span>
            <span class="info-val">${esc(ctx.invoiceNumber || '--')}</span>
          </div>
          <div class="info-cell">
            <span class="info-label">Name</span>
            <span class="info-val">${esc(ctx.patientName || 'PATIENT')}</span>
          </div>
          <div class="info-cell">
            <span class="info-label">Gender / Age</span>
            <span class="info-val">${esc(ctx.genderAge || '—')}</span>
          </div>
          <div class="info-cell">
            <span class="info-label">Pay Mode</span>
            <span class="info-val">${esc(ctx.payModeLabel || '—')}</span>
          </div>
          <div class="info-cell">
            <span class="info-label">Mobile No.</span>
            <span class="info-val">${esc(ctx.mobile || '—')}</span>
          </div>
          <div class="info-cell">
            <span class="info-label">Date</span>
            <span class="info-val">${esc(ctx.dateTimeStr || '—')}</span>
          </div>
          <div class="info-cell">
            <span class="info-label">Guardian</span>
            <span class="info-val">${esc(ctx.guardianLine || '—')}</span>
          </div>
          <div class="info-cell">
            <span class="info-label">Doctor</span>
            <span class="info-val">${esc(ctx.attributedDoctor || '—')}</span>
          </div>
          ${ctx.referredBy ? `<div class="info-cell">
            <span class="info-label">Referred By</span>
            <span class="info-val">${esc(String(ctx.referredBy).toUpperCase())}</span>
          </div>` : ''}
          ${ctx.purpose ? `<div class="info-cell" style="grid-column:span 2">
            <span class="info-label">Purpose</span>
            <span class="info-val">${esc(ctx.purpose)}</span>
          </div>` : ''}
        </div>`
}

export function buildPaymentSlipPageHtml({
  pageIndex,
  totalPages,
  pageItems,
  slNoOffset,
  isLastPage,
  hospitalName,
  logoUrl,
  profileLines,
  tagline = 'Healthcare &amp; Diagnostics',
  escapeHtml,
  slipNumber,
  invoiceNumber,
  patientName,
  genderAge,
  payModeLabel,
  mobile,
  dateTimeStr,
  guardianLine,
  attributedDoctor,
  referredBy,
  purpose,
  subtotal,
  discount,
  total,
  isCredit = false,
  paidBoxLabel = '✓ PAID',
}) {
  const esc = escapeHtml || ((v) => String(v ?? ''))
  const pageNum = pageIndex + 1
  const rows = buildPaymentSlipTableRows(pageItems, slNoOffset, esc)
  const subtotalFixed = Number(subtotal || 0).toFixed(2)
  const discountFixed = Number(discount || 0).toFixed(2)
  const totalFixed = Number(total || 0).toFixed(2)

  const totalsBlock = isLastPage
    ? `<div class="totals">
          <div class="t-row"><span>Total Amount:</span><span>₹${subtotalFixed}</span></div>
          <div class="t-row disc"><span>Discount:</span><span>₹${discountFixed}</span></div>
          <div class="t-row final"><span>Net Amount:</span><span>₹${totalFixed}</span></div>
        </div>`
    : ''

  const footerNote = isLastPage
    ? `<div class="note">
            <strong>Note:</strong> Your reports will be preserved only for 6 months.<br/>
            Please retain this receipt for future reference.
          </div>`
    : `<div class="note continued-note">Continued on next page…</div>`

  const paidBox = isLastPage
    ? `<div class="paid-box ${isCredit ? 'due-box' : ''}">${esc(paidBoxLabel)}</div>`
    : '<div></div>'

  return `
    <div class="slip">
      ${buildPaymentSlipTopHeaderHtml({
        hospitalName,
        logoUrl,
        tagline,
        profileLines,
        escapeHtml: esc,
      })}
      <div class="receipt-title">Receipt</div>
      ${buildPaymentSlipInfoGridHtml({
        slipNumber,
        invoiceNumber,
        patientName,
        genderAge,
        payModeLabel,
        mobile,
        dateTimeStr,
        guardianLine,
        attributedDoctor,
        referredBy,
        purpose,
      }, esc)}
      <div class="slip-body">
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th class="c">SL No.</th>
                <th class="l">Test Type / Service</th>
                <th class="c">Qty</th>
                <th class="r">Rate</th>
                <th class="r">Amount</th>
              </tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
        ${totalsBlock}
        <div class="footer">
          ${footerNote}
          ${paidBox}
        </div>
        <div class="page-num">Page ${pageNum} of ${totalPages}</div>
      </div>
    </div>`
}

export function buildPaymentSlipDocumentHtml(ctx) {
  const {
    title = 'Receipt',
    lineItems = [],
    escapeHtml,
    printCloseScript = PAYMENT_SLIP_PRINT_CLOSE_SCRIPT,
  } = ctx

  const pages = chunkPaymentSlipItems(lineItems)
  const totalPages = pages.length
  let slNoOffset = 0

  const slipsHtml = pages.map((pageItems, pageIndex) => {
    const html = buildPaymentSlipPageHtml({
      ...ctx,
      pageIndex,
      totalPages,
      pageItems,
      slNoOffset,
      isLastPage: pageIndex === totalPages - 1,
    })
    slNoOffset += pageItems.length
    return html
  }).join('')

  return `<!DOCTYPE html><html><head>
      <meta charset="utf-8"/>
      <title>${escapeHtml ? escapeHtml(title) : title}</title>
      <style>${buildPaymentSlipPrintStyles({ isCredit: ctx.isCredit })}</style>
    </head>
    <body>
      ${slipsHtml}
      ${printCloseScript}
    </body></html>`
}
