import { createSameTabPrintWindow, patchHtmlForMobile, writeHtmlToWindow, deliverMobilePrintHtml } from '../../utils/printHtmlInHiddenFrame'
import { STANDALONE_PRINT_DOCUMENT_CSS } from '../../utils/triggerHMSPrint.js'
import { formatDateTime } from '../../utils/dateTimeFormat'
import {
  PAYMENT_SLIP_PRINT_CLOSE_SCRIPT,
  buildPaymentSlipContainerCss,
  buildPaymentSlipHeaderCss,
  buildPaymentSlipProfileLines,
  buildPaymentSlipTableRows,
  buildPaymentSlipTopHeaderHtml,
  chunkPaymentSlipItems,
  resolvePaymentSlipLineTotal,
  resolvePaymentSlipLogoUrl,
} from './paymentSlipPrint'

function buildExpensePrintStyles() {
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
      ${buildPaymentSlipHeaderCss({ accentColor: '#b45309', topBorderColor: '#111' })}
      .receipt-title {
        text-align: center;
        font-size: 13px;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 2px;
        border-bottom: 1px solid #111;
        padding-bottom: 2mm;
        margin-bottom: 2.5mm;
        color: #b45309;
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
      thead tr { background: #b45309; color: #fff; }
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
        color: #b45309;
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
      .paid-box {
        border: 2px solid #b45309;
        color: #b45309;
        font-weight: 900;
        font-size: 13px;
        padding: 2px 10px;
        border-radius: 4px;
        letter-spacing: 2px;
        flex-shrink: 0;
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

function expensePayModeLabel(mode) {
  const normalized = String(mode || 'cash').toLowerCase()
  if (normalized === 'cash') return 'Cash'
  if (normalized === 'upi') return 'UPI'
  if (normalized === 'card') return 'Card'
  if (normalized === 'bank_transfer') return 'Bank Transfer'
  return 'Other'
}

function buildExpenseInfoGrid(ctx, escapeHtml) {
  const esc = escapeHtml || ((v) => String(v ?? ''))
  return `
    <div class="info-grid">
      <div class="info-cell">
        <span class="info-label">Voucher Number</span>
        <span class="info-val">${esc(ctx.slipNumber || '--')}</span>
      </div>
      <div class="info-cell">
        <span class="info-label">Paid To</span>
        <span class="info-val">${esc(ctx.paidTo || '—')}</span>
      </div>
      <div class="info-cell">
        <span class="info-label">Recorded By</span>
        <span class="info-val">${esc(ctx.recordedBy || '—')}</span>
      </div>
      <div class="info-cell">
        <span class="info-label">Pay Mode</span>
        <span class="info-val">${esc(ctx.payModeLabel || '—')}</span>
      </div>
      <div class="info-cell">
        <span class="info-label">Date</span>
        <span class="info-val">${esc(ctx.dateTimeStr || '—')}</span>
      </div>
      ${ctx.remarks ? `<div class="info-cell" style="grid-column: span 2">
        <span class="info-label">Remarks</span>
        <span class="info-val">${esc(ctx.remarks)}</span>
      </div>` : ''}
    </div>`
}

function buildExpensePageHtml({
  pageIndex,
  totalPages,
  pageItems,
  slNoOffset,
  isLastPage,
  hospitalName,
  logoUrl,
  profileLines,
  escapeHtml,
  slipNumber,
  paidTo,
  recordedBy,
  payModeLabel,
  dateTimeStr,
  remarks,
  subtotal,
  discount,
  total,
}) {
  const esc = escapeHtml || ((v) => String(v ?? ''))
  const pageNum = pageIndex + 1
  const rows = buildPaymentSlipTableRows(pageItems, slNoOffset, esc)
  const subtotalFixed = Number(subtotal || 0).toFixed(2)
  const discountFixed = Number(discount || 0).toFixed(2)
  const totalFixed = Number(total || 0).toFixed(2)

  const totalsBlock = isLastPage
    ? `<div class="totals">
          <div class="t-row"><span>Subtotal:</span><span>₹${subtotalFixed}</span></div>
          <div class="t-row disc"><span>Discount:</span><span>₹${discountFixed}</span></div>
          <div class="t-row final"><span>Total Paid:</span><span>₹${totalFixed}</span></div>
        </div>`
    : ''

  const footerNote = isLastPage
    ? `<div class="note">
            <strong>Note:</strong> This is a hospital expense voucher. Retain for accounts reference.
          </div>`
    : `<div class="note" style="font-style:italic;color:#666">Continued on next page…</div>`

  const paidBox = isLastPage ? '<div class="paid-box">EXPENSE</div>' : '<div></div>'

  return `
    <div class="slip">
      ${buildPaymentSlipTopHeaderHtml({
        hospitalName,
        logoUrl,
        tagline: 'Healthcare &amp; Diagnostics',
        profileLines,
        escapeHtml: esc,
      })}
      <div class="receipt-title">Expense Voucher</div>
      ${buildExpenseInfoGrid({
        slipNumber,
        paidTo,
        recordedBy,
        payModeLabel,
        dateTimeStr,
        remarks,
      }, esc)}
      <div class="slip-body">
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th class="c">SL No.</th>
                <th class="l">Description</th>
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

export function buildExpenseVoucherDocumentHtml(ctx) {
  const {
    lineItems = [],
    escapeHtml,
    printCloseScript = PAYMENT_SLIP_PRINT_CLOSE_SCRIPT,
  } = ctx

  const pages = chunkPaymentSlipItems(lineItems)
  const totalPages = pages.length
  let slNoOffset = 0

  const slipsHtml = pages.map((pageItems, pageIndex) => {
    const html = buildExpensePageHtml({
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
      <title>${escapeHtml ? escapeHtml('Expense Voucher') : 'Expense Voucher'}</title>
      <style>${buildExpensePrintStyles()}</style>
    </head>
    <body>
      ${slipsHtml}
      ${printCloseScript}
    </body></html>`
}

export function printExpenseVoucherImmediately(expense, options = {}) {
  const { onComplete, profile = {}, targetWindow = null, escapeHtml = (v) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') } = options
  const dateTimeStr = expense.paid_at
    ? formatDateTime(expense.paid_at, {})
    : formatDateTime(new Date(), {})
  const logoUrl = resolvePaymentSlipLogoUrl(profile)
  const profileLines = buildPaymentSlipProfileLines(profile, escapeHtml)
  const slipItems = (Array.isArray(expense.items) ? expense.items : []).map((it) => ({
    ...it,
    line_total: resolvePaymentSlipLineTotal(it),
  }))

  const docHtml = buildExpenseVoucherDocumentHtml({
    hospitalName: profile.hospital_name || 'Hospital',
    logoUrl,
    profileLines,
    escapeHtml,
    slipNumber: expense.slip_number || '--',
    paidTo: expense.paid_to || '—',
    recordedBy: expense.recorded_by_name || '—',
    payModeLabel: expensePayModeLabel(expense.payment_mode),
    dateTimeStr,
    remarks: expense.remarks || '',
    lineItems: slipItems,
    subtotal: expense.subtotal,
    discount: expense.discount_amount,
    total: expense.total_amount,
    // On mobile the print trigger comes from patchHtmlForMobile. The desktop close-script does
    // window.location.replace('about:blank') on afterprint/focus, which blanks the Android print
    // preview (it renders the live DOM) — so omit it for the mobile route.
    printCloseScript: targetWindow ? '' : PAYMENT_SLIP_PRINT_CLOSE_SCRIPT,
  })

  // Mobile: the caller opened /print-slip?job=payment synchronously (targetWindow). That page
  // polls localStorage for the finished voucher — hand it the fully mobile-patched HTML.
  if (targetWindow || shouldUseDedicatedPrintDocument()) {
    deliverMobilePrintHtml(docHtml, {
      targetWindow: shouldUseDedicatedPrintDocument() ? null : targetWindow,
      storageKey: shouldUseDedicatedPrintDocument() ? null : 'payment-slip-print-job',
      onComplete,
    })
    return
  }

  const w = createSameTabPrintWindow({ onComplete })
  w.document.write(docHtml)
  w.document.close()
}

export { resolvePaymentSlipLineTotal }
