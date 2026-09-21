import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { formatDateTime, formatWithPattern, useTimeDisplayMode } from '../../utils/dateTimeFormat'
import { format, subDays, startOfWeek, startOfMonth } from 'date-fns'
import toast from 'react-hot-toast'
import api from '../../api'
import { getPaymentSlipProfile, loadReceptionPortalProfileCache } from '../../utils/receptionPortalProfile'
import ReportsCharts from './ReportsCharts'
import {
  buildAmountByField,
  buildDailyAmountSeries,
  buildModeChartData,
  modeTotalsFromItems,
} from './reportsChartUtils'
import {
  aggregatePaymentSlipsByCategory,
  aggregatePaymentSlipsByItem,
  buildQuickServiceCatalog,
} from './reportSlipCategoryUtils'

function extractApiRows(data) {
  if (Array.isArray(data?.results)) return data.results
  if (Array.isArray(data?.data)) return data.data
  if (Array.isArray(data)) return data
  return []
}

function todayStr() {
  return format(new Date(), 'yyyy-MM-dd')
}

function doctorUserId(doc) {
  return String(doc?.user ?? doc?.user_id ?? doc?.userId ?? doc?.doctor_user ?? doc?.id ?? '')
}

function doctorLabel(doc) {
  return doc?.name || doc?.full_name || doc?.user_name || doc?.email || 'Doctor'
}

function fmtMoney(n) {
  const v = Number(n)
  if (!Number.isFinite(v)) return '0.00'
  return v.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function isActiveExpense(e) {
  return !e?.voided && e?.status !== 'cancelled'
}

function paymentEncounterLabel(p) {
  const invNo = String(p?.invoice_no || p?.invoice_details?.invoice_no || '')
  if (invNo.startsWith('IPDADV-')) return 'IPD Advance'
  const enc = String(p?.invoice_details?.encounter_type || '').toLowerCase()
  if (enc === 'opd') return 'OPD'
  if (enc === 'ipd') return 'IPD'
  if (enc === 'pharmacy') return 'Pharmacy'
  if (enc === 'lab') return 'Lab'
  return enc ? enc.toUpperCase() : 'Other'
}

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function getSlipItemNames(payment) {
  const items = payment?.invoice_details?.items
  if (Array.isArray(items) && items.length > 0) {
    return items
      .map((item) => String(item?.description || '').trim())
      .filter(Boolean)
      .join(', ') || '—'
  }
  return String(
    payment?.description
    || payment?.invoice_details?.description
    || '—',
  ).trim() || '—'
}

function getExpenseItemNames(expense) {
  const items = expense?.items
  if (Array.isArray(items) && items.length > 0) {
    return items
      .map((item) => String(item?.description || '').trim())
      .filter(Boolean)
      .join(', ') || '—'
  }
  return String(expense?.remarks || '').trim() || '—'
}

function renderPaymentSlipsByCategoryHtml(categories) {
  if (!categories?.length) return ''
  const categoryTotalItems = categories.reduce((sum, cat) => sum + (Number(cat.line_count) || 0), 0)
  const categoryTotalAmount = categories.reduce((sum, cat) => sum + (Number(cat.total) || 0), 0)
  return `
    <h2 class="sec">Payment slips by category</h2>
    <table class="tbl">
      <thead>
        <tr><th>Category</th><th class="c">Items</th><th class="r">Total</th></tr>
      </thead>
      <tbody>
        ${categories.map((cat) => `
          <tr>
            <td>${escapeHtml(cat.category || 'Uncategorized')}</td>
            <td class="c">${cat.line_count ?? 0}</td>
            <td class="r">₹${fmtMoney(cat.total)}</td>
          </tr>`).join('')}
      </tbody>
      <tfoot>
        <tr>
          <td><strong>Total</strong></td>
          <td class="c"><strong>${categoryTotalItems}</strong></td>
          <td class="r"><strong>₹${fmtMoney(categoryTotalAmount)}</strong></td>
        </tr>
      </tfoot>
    </table>`
}

function renderPaymentSlipsByItemsHtml(rows) {
  if (!rows?.length) return ''
  const totalQty = rows.reduce((sum, row) => sum + (Number(row.total_qty) || 0), 0)
  const totalAmount = rows.reduce((sum, row) => sum + (Number(row.total) || 0), 0)
  return `
    <h2 class="sec">Payment slips by item</h2>
    <table class="tbl">
      <thead>
        <tr><th>Item</th><th class="c">Qty</th><th class="r">Total</th></tr>
      </thead>
      <tbody>
        ${rows.map((row) => `
          <tr>
            <td>${escapeHtml(row.item || '—')}</td>
            <td class="c">${row.total_qty ?? 0}</td>
            <td class="r">₹${fmtMoney(row.total)}</td>
          </tr>`).join('')}
      </tbody>
      <tfoot>
        <tr>
          <td><strong>Total</strong></td>
          <td class="c"><strong>${totalQty}</strong></td>
          <td class="r"><strong>₹${fmtMoney(totalAmount)}</strong></td>
        </tr>
      </tfoot>
    </table>`
}

/** Print-only tweak: keep original table layout; prevent right border clipping at page edge. */
const REPORT_PRINT_RIGHT_BORDER_FIX = `
        @media print {
          body { padding-right: 2px; }
        }
        .info tr > *:last-child,
        table.tbl tr > *:last-child {
          border-right: 1px solid #000 !important;
        }
`

function isIpdAdvancePayment(p) {
  return paymentEncounterLabel(p) === 'IPD Advance'
}

function isRefundPayment(p) {
  const invNo = String(p?.invoice_no || p?.invoice_details?.invoice_no || '').toUpperCase()
  const desc = String(
    p?.description
    || p?.invoice_details?.description
    || p?.invoice_details?.items?.[0]?.description
    || '',
  ).toUpperCase()
  const amt = parseFloat(p?.amount) || 0
  return invNo.includes('IPDREF') || desc.includes('REFUND') || amt < 0
}

function refundPaymentAmount(p) {
  const amt = parseFloat(p?.amount) || 0
  if (amt < 0) return amt
  return -Math.abs(amt)
}

function addPaymentModeAmount(modeTotals, mode, amount) {
  const amt = Number(amount) || 0
  const m = String(mode || 'other').toLowerCase()
  if (m === 'cash') modeTotals.cash += amt
  else if (m === 'upi') modeTotals.upi += amt
  else if (m === 'card') modeTotals.card += amt
  else modeTotals.other += amt
  return modeTotals
}

function ReportPrintPreviewModal({ title, html, onClose }) {
  const iframeRef = useRef(null)

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  function triggerPrint() {
    const w = iframeRef.current?.contentWindow
    if (!w) return
    w.focus()
    w.print()
  }

  return createPortal(
    <div
      className="fixed inset-0 z-[1500] bg-slate-900/60 backdrop-blur-sm p-3 sm:p-5 flex items-center justify-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby="report-print-preview-title"
    >
      <div className="w-full max-w-[1200px] max-h-[94vh] bg-white rounded-2xl shadow-2xl overflow-hidden flex flex-col">
        <div className="shrink-0 px-4 py-3 border-b border-gray-200 bg-white flex flex-wrap items-center justify-between gap-2">
          <h3 id="report-print-preview-title" className="text-sm font-bold text-gray-900 truncate min-w-0">
            {title}
          </h3>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={triggerPrint}
              className="bg-emerald-600 text-white px-4 py-2 rounded-lg text-sm font-bold hover:bg-emerald-700"
            >
              Print
            </button>
            <button
              type="button"
              onClick={onClose}
              className="bg-gray-100 text-gray-700 px-4 py-2 rounded-lg text-sm font-bold hover:bg-gray-200"
            >
              Close
            </button>
          </div>
        </div>
        <div className="flex-1 min-h-0 overflow-hidden bg-gray-100 p-2 sm:p-3">
          <iframe
            ref={iframeRef}
            title={title}
            srcDoc={html}
            className="w-full h-full min-h-[70vh] border-0 bg-white rounded-lg shadow-inner"
          />
        </div>
      </div>
    </div>,
    document.body,
  )
}

export default function ReportsSection() {
  useTimeDisplayMode()
  const [fromDate, setFromDate] = useState(todayStr)
  const [toDate, setToDate] = useState(todayStr)
  const [doctorUser, setDoctorUser] = useState('')
  const [department, setDepartment] = useState('')
  const [reportTypes, setReportTypes] = useState(['all'])
  const [typeDropdownOpen, setTypeDropdownOpen] = useState(false)
  const typeDropdownRef = React.useRef(null)
  const [collectedBy, setCollectedBy] = useState('')
  const [dataTab, setDataTab] = useState('collection')
  const [dataView, setDataView] = useState('table')
  const [loading, setLoading] = useState(false)
  const [lastFetched, setLastFetched] = useState(null)
  const [opdVisits, setOpdVisits] = useState([])
  const [payments, setPayments] = useState([])
  const [doctors, setDoctors] = useState([])
  const [departments, setDepartments] = useState([])
  const [staff, setStaff] = useState([])
  const [collectionSummary, setCollectionSummary] = useState(null)
  const [expenses, setExpenses] = useState([])
  const [slipCategories, setSlipCategories] = useState([])
  const [quickServices, setQuickServices] = useState([])
  const [slipCategory, setSlipCategory] = useState('')
  const [slipPrintView, setSlipPrintView] = useState('category')
  const [showSlipItemNames, setShowSlipItemNames] = useState(false)
  const [printingDoctorRevenue, setPrintingDoctorRevenue] = useState(false)
  const [printPreview, setPrintPreview] = useState(null)

  const loadMeta = useCallback(async () => {
    try {
      const [dRes, depRes, stRes, quickRes] = await Promise.all([
        api.get('/doctor-profiles/?limit=500'),
        api.get('/departments/?limit=500'),
        api.get('/staff/?limit=500&employment_status=active'),
        api.get('/payments/quick-services/'),
      ])
      setDoctors(extractApiRows(dRes.data))
      setDepartments(extractApiRows(depRes.data))
      const staffRows = extractApiRows(stRes.data)
      setStaff(staffRows.filter((s) => s.user))
      const quickPayload = quickRes.data?.data || quickRes.data || {}
      const cats = Array.isArray(quickPayload.categories) ? quickPayload.categories : []
      const services = Array.isArray(quickPayload.services) ? quickPayload.services : []
      setSlipCategories(cats.filter(Boolean))
      setQuickServices(services)
    } catch {
      toast.error('Failed to load filter options')
    }
  }, [])

  // Resolve effective type set: if 'all' is included (or nothing), treat as all
  const effectiveTypes = useMemo(() => {
    if (!reportTypes.length || reportTypes.includes('all')) return ['all']
    return reportTypes
  }, [reportTypes])

  const fetchReport = useCallback(async () => {
    if (!fromDate || !toDate) {
      toast.error('Select from and to dates')
      return
    }
    if (fromDate > toDate) {
      toast.error('From date cannot be after to date')
      return
    }
    setLoading(true)
    try {
      const isAll = effectiveTypes.includes('all')
      const wantsOpd = isAll || effectiveTypes.includes('opd')
      const wantsSlips = isAll || effectiveTypes.includes('payment_slips')
      const wantsIpd = isAll || effectiveTypes.includes('ipd_advance')
      const wantsRefunds = isAll || effectiveTypes.includes('refunds')
      const wantsExpenses = isAll || effectiveTypes.includes('expenses')

      const opdParams = new URLSearchParams({
        limit: '2000',
        ordering: '-visit_date',
        visit_date__gte: fromDate,
        visit_date__lte: toDate,
      })
      if (doctorUser) opdParams.set('doctor_user', doctorUser)
      if (department) opdParams.set('department', department)

      const payParams = new URLSearchParams({
        limit: '2000',
        ordering: '-paid_at',
        paid_at__date__gte: fromDate,
        paid_at__date__lte: toDate,
        status: 'success',
      })
      if (collectedBy) payParams.set('collected_by', collectedBy)
      if (doctorUser) payParams.set('attributed_doctor_user', doctorUser)

      const summaryParams = new URLSearchParams({ date_from: fromDate, date_to: toDate })
      if (doctorUser) summaryParams.set('attributed_doctor_user', doctorUser)

      const expenseParams = new URLSearchParams({
        limit: '2000',
        ordering: '-paid_at',
        paid_at__date__gte: fromDate,
        paid_at__date__lte: toDate,
        voided: 'false',
        status: 'success',
      })

      const [opdRes, payRes, summaryRes, expenseRes] = await Promise.all([
        wantsOpd || isAll ? api.get(`/opd-visits/?${opdParams}`) : Promise.resolve({ data: { data: [] } }),
        wantsSlips || wantsIpd || wantsRefunds || isAll ? api.get(`/payments/?${payParams}`) : Promise.resolve({ data: { data: [] } }),
        api.get(`/reports/collection-summary/?${summaryParams}`),
        wantsExpenses || isAll ? api.get(`/expenses/?${expenseParams}`) : Promise.resolve({ data: { data: [] } }),
      ])
      let opdRows = extractApiRows(opdRes.data).filter((v) => v.status !== 'cancelled')
      let payRows = extractApiRows(payRes.data)

      // Apply multi-type filter
      if (!isAll) {
        // OPD VISITS (from opd-visits API): only include when 'opd' is selected
        if (!wantsOpd) {
          opdRows = []
        }

        // PAYMENT ROWS: classify only by isIpdAdvance / isRefund
        // Everything else is a regular payment slip (including OPD-encounter-type payments)
        const filteredPay = []
        for (const p of payRows) {
          const isAdvance = isIpdAdvancePayment(p)
          const isRefund = isRefundPayment(p)

          if (isAdvance) {
            if (wantsIpd) filteredPay.push(p)
          } else if (isRefund) {
            if (wantsRefunds) filteredPay.push(p)
          } else {
            // Regular payment slip — include if payment_slips is selected
            if (wantsSlips) filteredPay.push(p)
          }
        }
        payRows = filteredPay
      }

      setOpdVisits(opdRows)
      setPayments(payRows)
      setExpenses(
        wantsExpenses || isAll
          ? extractApiRows(expenseRes.data).filter(isActiveExpense)
          : [],
      )
      setCollectionSummary(summaryRes.data?.data || summaryRes.data || null)
      setLastFetched(new Date())
    } catch {
      toast.error('Failed to load report data')
    } finally {
      setLoading(false)
    }
  }, [fromDate, toDate, doctorUser, department, effectiveTypes, collectedBy])

  useEffect(() => {
    loadMeta()
  }, [loadMeta])

  useEffect(() => {
    fetchReport()
  }, [fetchReport])

  useEffect(() => {
    const t = setInterval(() => fetchReport(), 5 * 60 * 1000)
    return () => clearInterval(t)
  }, [fetchReport])

  useEffect(() => {
    if (!typeDropdownOpen) return
    function handleClickOutside(e) {
      if (typeDropdownRef.current && !typeDropdownRef.current.contains(e.target)) {
        setTypeDropdownOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [typeDropdownOpen])

  // Which tabs are visible based on the selected type filter
  const visibleTabs = useMemo(() => {
    const isAll = effectiveTypes.includes('all')
    return [
      { id: 'collection', label: 'By doctor' },
      { id: 'opd', label: 'OPD', type: 'opd' },
      { id: 'slips', label: 'Slips', type: 'payment_slips' },
      { id: 'refunds', label: 'Refunds', type: 'refunds' },
      { id: 'expenses', label: 'Expenses', type: 'expenses' },
      { id: 'ipd', label: 'IPD adv.', type: 'ipd_advance' },
    ].filter((t) => isAll || !t.type || effectiveTypes.includes(t.type))
  }, [effectiveTypes])

  // Auto-switch dataTab when the active tab is filtered out
  useEffect(() => {
    const ids = visibleTabs.map((t) => t.id)
    if (!ids.includes(dataTab)) {
      setDataTab(ids[0] || 'collection')
    }
  }, [visibleTabs, dataTab])

  const refundPayments = useMemo(
    () => payments.filter(isRefundPayment),
    [payments],
  )
  const paymentSlipsOnly = useMemo(
    () => payments.filter((p) => !isIpdAdvancePayment(p) && !isRefundPayment(p)),
    [payments],
  )
  const ipdAdvancePayments = useMemo(
    () => payments.filter(isIpdAdvancePayment),
    [payments],
  )

  const summary = useMemo(() => {
    const opdCount = opdVisits.length
    const opdRevenue = opdVisits.reduce((s, v) => s + (parseFloat(v.amount) || 0), 0)
    const slipCount = payments.length
    const slipTotal = payments.reduce((s, p) => s + (parseFloat(p.amount) || 0), 0)
    const advances = payments.filter(isIpdAdvancePayment)
    const advanceCount = advances.length
    const advanceTotal = advances.reduce((s, p) => s + (parseFloat(p.amount) || 0), 0)
    const slipCountExAdv = paymentSlipsOnly.length
    const slipTotalExAdv = paymentSlipsOnly.reduce((s, p) => s + (parseFloat(p.amount) || 0), 0)
    const refundCount = refundPayments.length
    const refundTotal = refundPayments.reduce((s, p) => s + refundPaymentAmount(p), 0)
    const modeTotals = { cash: 0, upi: 0, card: 0, other: 0 }
    for (const v of opdVisits) addPaymentModeAmount(modeTotals, v.payment_mode, v.amount)
    for (const p of payments) addPaymentModeAmount(modeTotals, p.payment_mode, p.amount)
    const modeGrand = modeTotals.cash + modeTotals.upi + modeTotals.card + modeTotals.other
    const grandCollection = opdRevenue + slipTotal
    return {
      opdCount, opdRevenue, slipCount, slipTotal, slipCountExAdv, slipTotalExAdv,
      advanceCount, advanceTotal, refundCount, refundTotal,
      modeTotals, modeGrand, grandCollection,
    }
  }, [opdVisits, payments, paymentSlipsOnly, refundPayments])

  const chartBundle = useMemo(() => {
    const overviewCategory = [
      { name: 'OPD', amount: summary.opdRevenue },
      { name: 'Slips', amount: summary.slipTotalExAdv },
      { name: 'IPD adv.', amount: summary.advanceTotal },
      { name: 'Refunds', amount: Math.abs(summary.refundTotal) },
    ].filter((d) => d.amount > 0)
    return {
      overview: {
        category: overviewCategory,
        mode: buildModeChartData(summary.modeTotals),
      },
      collection: {
        byAttribution: [
          ...(collectionSummary && !doctorUser
            ? [{ name: 'Self (Hospital)', amount: parseFloat(collectionSummary.hospital_self?.total) || 0 }]
            : []),
          ...(collectionSummary?.doctors || []).map((row) => ({
            name: row.doctor_name || 'Doctor',
            amount: parseFloat(row.total) || 0,
          })),
        ].filter((d) => d.amount > 0),
        opdVsSlips: collectionSummary
          ? [
              {
                name: 'OPD fees',
                amount:
                  (parseFloat(collectionSummary.hospital_self?.opd_fees) || 0)
                  + (collectionSummary.doctors || []).reduce((s, r) => s + (parseFloat(r.opd_fees) || 0), 0),
              },
              {
                name: 'Payment slips',
                amount:
                  (parseFloat(collectionSummary.hospital_self?.payments) || 0)
                  + (collectionSummary.doctors || []).reduce((s, r) => s + (parseFloat(r.payments) || 0), 0),
              },
            ].filter((d) => d.amount > 0)
          : [],
      },
      opd: {
        daily: buildDailyAmountSeries(opdVisits, (v) => v.visit_date, (v) => v.amount),
        byDept: buildAmountByField(opdVisits, (v) => v.department, (v) => v.amount),
        mode: buildModeChartData(modeTotalsFromItems(opdVisits, (v) => v.payment_mode, (v) => v.amount)),
      },
      slips: {
        daily: buildDailyAmountSeries(paymentSlipsOnly, (p) => p.paid_at, (p) => p.amount),
        byType: buildAmountByField(paymentSlipsOnly, paymentEncounterLabel, (p) => p.amount),
        mode: buildModeChartData(modeTotalsFromItems(paymentSlipsOnly, (p) => p.payment_mode, (p) => p.amount)),
      },
      ipd: {
        daily: buildDailyAmountSeries(ipdAdvancePayments, (p) => p.paid_at, (p) => p.amount),
        mode: buildModeChartData(modeTotalsFromItems(ipdAdvancePayments, (p) => p.payment_mode, (p) => p.amount)),
      },
      refunds: {
        daily: buildDailyAmountSeries(refundPayments, (p) => p.paid_at, (p) => Math.abs(refundPaymentAmount(p))),
        mode: buildModeChartData(modeTotalsFromItems(refundPayments, (p) => p.payment_mode, (p) => Math.abs(refundPaymentAmount(p)))),
      },
    }
  }, [summary, opdVisits, paymentSlipsOnly, ipdAdvancePayments, refundPayments, collectionSummary, doctorUser])

  function setQuickRange(kind) {
    const now = new Date()
    if (kind === 'today') {
      setFromDate(format(now, 'yyyy-MM-dd'))
      setToDate(format(now, 'yyyy-MM-dd'))
    } else if (kind === 'yesterday') {
      const y = subDays(now, 1)
      setFromDate(format(y, 'yyyy-MM-dd'))
      setToDate(format(y, 'yyyy-MM-dd'))
    } else if (kind === 'week') {
      setFromDate(format(startOfWeek(now, { weekStartsOn: 1 }), 'yyyy-MM-dd'))
      setToDate(format(now, 'yyyy-MM-dd'))
    } else if (kind === 'month') {
      setFromDate(format(startOfMonth(now), 'yyyy-MM-dd'))
      setToDate(format(now, 'yyyy-MM-dd'))
    }
  }

  function exportCsv() {
    let rows
    let header
    if (dataTab === 'collection') {
      header = ['Doctor / Self', 'OPD fees', 'Payment slips', 'Total']
      rows = []
      if (collectionSummary && !doctorUser) {
        rows.push([
          'Self (Hospital)',
          collectionSummary.hospital_self?.opd_fees ?? '',
          collectionSummary.hospital_self?.payments ?? '',
          collectionSummary.hospital_self?.total ?? '',
        ])
      }
      for (const row of collectionSummary?.doctors || []) {
        rows.push([row.doctor_name || 'Doctor', row.opd_fees ?? '', row.payments ?? '', row.total ?? ''])
      }
    } else if (dataTab === 'opd') {
      header = ['S.No', 'Date', 'Patient', 'UHID', 'Doctor', 'Department', 'Amount', 'Mode', 'OPD No']
      rows = opdVisits.map((v, i) => [
        i + 1,
        v.visit_date ? format(new Date(v.visit_date), 'dd/MM/yyyy') : '',
        v.patient_name || '',
        v.patient_uhid || '',
        v.doctor_name || '',
        v.department || '',
        v.amount ?? '',
        v.payment_mode || '',
        v.opd_no || '',
      ])
    } else if (dataTab === 'ipd') {
      header = ['S.No', 'Date', 'Slip No', 'Patient', 'Invoice', 'Mode', 'Amount']
      rows = ipdAdvancePayments.map((p, i) => [
        i + 1,
        p.paid_at ? formatDateTime(p.paid_at) : '',
        p.slip_number || '',
        p.patient_name || '',
        p.invoice_no || p.invoice_details?.invoice_no || '',
        p.payment_mode || '',
        p.amount ?? '',
      ])
    } else if (dataTab === 'expenses') {
      header = showSlipItemNames
        ? ['S.No', 'Date', 'Voucher #', 'Paid to', 'Items', 'Mode', 'Amount', 'Recorded by']
        : ['S.No', 'Date', 'Voucher #', 'Paid to', 'Mode', 'Amount', 'Recorded by']
      rows = expenses.map((e, i) => {
        const base = [
          i + 1,
          e.paid_at ? formatDateTime(e.paid_at) : '',
          e.slip_number || '',
          e.paid_to || '',
        ]
        if (showSlipItemNames) base.push(getExpenseItemNames(e))
        base.push(
          e.payment_mode || '',
          e.total_amount ?? '',
          e.recorded_by_name || '',
        )
        return base
      })
    } else if (dataTab === 'refunds') {
      header = ['S.No', 'Date', 'Slip No', 'Patient', 'Invoice', 'Mode', 'Refunded']
      rows = refundPayments.map((p, i) => [
        i + 1,
        p.paid_at ? formatDateTime(p.paid_at) : '',
        p.slip_number || '',
        p.patient_name || '',
        p.invoice_no || p.invoice_details?.invoice_no || '',
        p.payment_mode || '',
        refundPaymentAmount(p),
      ])
    } else {
      header = showSlipItemNames
        ? ['S.No', 'Date', 'Slip No', 'Patient', 'Items', 'Type', 'Mode', 'Amount', 'Status', 'Invoice']
        : ['S.No', 'Date', 'Slip No', 'Patient', 'Type', 'Mode', 'Amount', 'Status', 'Invoice']
      rows = paymentSlipsOnly.map((p, i) => {
        const base = [
          i + 1,
          p.paid_at ? formatDateTime(p.paid_at) : '',
          p.slip_number || '',
          p.patient_name || '',
        ]
        if (showSlipItemNames) base.push(getSlipItemNames(p))
        base.push(
          paymentEncounterLabel(p),
          p.payment_mode || '',
          p.amount ?? '',
          p.status || '',
          p.invoice_no || '',
        )
        return base
      })
    }
    const csv = [header, ...rows].map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `reception-report-${fromDate}-to-${toDate}.csv`
    a.click()
    URL.revokeObjectURL(url)
    toast.success('CSV downloaded')
  }

  async function printReport() {
    await loadReceptionPortalProfileCache()
    const profile = getPaymentSlipProfile()
    const hospitalName = escapeHtml(profile.hospital_name || 'Hospital')
    const address = escapeHtml(profile.address || '')
    const pinCode = escapeHtml(profile.pin_code || '')
    const phone = escapeHtml(profile.phone || '')
    const email = escapeHtml(profile.email || '')
    const printedAt = formatWithPattern(new Date(), 'd MMMM yyyy · HH:mm')
    const periodLabel = `${format(new Date(`${fromDate}T12:00:00`), 'd MMM yyyy')} – ${format(new Date(`${toDate}T12:00:00`), 'd MMM yyyy')}`

    const typeLabels = { all: 'All collections', opd: 'OPD slips', ipd_advance: 'IPD advances', payment_slips: 'Payment slips', refunds: 'Refunds', expenses: 'Expenses' }
    const scopeLabel = effectiveTypes.includes('all')
      ? 'All collections'
      : effectiveTypes.map((t) => typeLabels[t] || t).join(' + ')
    const doctorLabelText = doctorUser
      ? doctorLabel(doctors.find((d) => doctorUserId(d) === doctorUser) || {})
      : 'All doctors'
    const deptLabelText = department || 'All departments'
    const collectorText = collectedBy
      ? (staff.find((s) => String(s.user) === collectedBy)?.name || 'Selected staff')
      : 'All staff'
    const categoryLabelText = slipCategory || 'All categories'
    const slipDetailViewLabel = slipPrintView === 'items' ? 'By slip items' : 'By category'
    const slipCatalog = buildQuickServiceCatalog(quickServices)
    const slipsDetailHtml = slipPrintView === 'items'
      ? renderPaymentSlipsByItemsHtml(
          aggregatePaymentSlipsByItem(paymentSlipsOnly, slipCatalog, { categoryFilter: slipCategory }),
        )
      : renderPaymentSlipsByCategoryHtml(
          aggregatePaymentSlipsByCategory(paymentSlipsOnly, slipCatalog, { categoryFilter: slipCategory }),
        )

    const opdRowsHtml = opdVisits.length
      ? opdVisits.map((v, i) => `
        <tr>
          <td class="c">${i + 1}</td>
          <td>${escapeHtml(v.visit_date ? format(new Date(v.visit_date), 'dd/MM/yyyy') : '—')}</td>
          <td>${escapeHtml(v.patient_name || '—')}</td>
          <td>${escapeHtml(v.patient_uhid || '—')}</td>
          <td>${escapeHtml(v.opd_no || '—')}</td>
          <td>${escapeHtml(v.doctor_name || '—')}</td>
          <td>${escapeHtml(v.department || '—')}</td>
          <td class="c">${escapeHtml((v.payment_mode || '—').toUpperCase())}</td>
          <td class="r">₹${fmtMoney(v.amount)}</td>
        </tr>`).join('')
      : '<tr><td colspan="9" class="empty">No OPD visits in this period</td></tr>'

    const slipColCount = showSlipItemNames ? 10 : 9
    const allPayRowsHtml = paymentSlipsOnly.length
      ? paymentSlipsOnly.map((p, i) => `
        <tr>
          <td class="c">${i + 1}</td>
          <td>${escapeHtml(p.paid_at ? formatDateTime(p.paid_at) : '—')}</td>
          <td>${escapeHtml(p.slip_number || '—')}</td>
          <td>${escapeHtml(p.patient_name || '—')}</td>
          <td>${escapeHtml(p.patient_uhid || '—')}</td>
          ${showSlipItemNames ? `<td>${escapeHtml(getSlipItemNames(p))}</td>` : ''}
          <td>${escapeHtml(p.attributed_doctor_name || 'Self (Hospital)')}</td>
          <td>${escapeHtml(paymentEncounterLabel(p))}</td>
          <td class="c">${escapeHtml((p.payment_mode || '—').toUpperCase())}</td>
          <td class="r">₹${fmtMoney(p.amount)}</td>
        </tr>`).join('')
      : `<tr><td colspan="${slipColCount}" class="empty">No payment slips in this period</td></tr>`

    const ipdAdvRowsHtml = ipdAdvancePayments.length
      ? ipdAdvancePayments.map((p, i) => `
        <tr>
          <td class="c">${i + 1}</td>
          <td>${escapeHtml(p.paid_at ? formatDateTime(p.paid_at) : '—')}</td>
          <td>${escapeHtml(p.slip_number || '—')}</td>
          <td>${escapeHtml(p.patient_name || '—')}</td>
          <td>${escapeHtml(p.invoice_no || p.invoice_details?.invoice_no || '—')}</td>
          <td class="c">${escapeHtml((p.payment_mode || '—').toUpperCase())}</td>
          <td class="r">₹${fmtMoney(p.amount)}</td>
        </tr>`).join('')
      : '<tr><td colspan="7" class="empty">No IPD advance receipts in this period</td></tr>'

    const refundRowsHtml = refundPayments.length
      ? refundPayments.map((p, i) => `
        <tr>
          <td class="c">${i + 1}</td>
          <td>${escapeHtml(p.paid_at ? formatDateTime(p.paid_at) : '—')}</td>
          <td>${escapeHtml(p.slip_number || '—')}</td>
          <td>${escapeHtml(p.patient_name || '—')}</td>
          <td>${escapeHtml(p.patient_uhid || '—')}</td>
          <td>${escapeHtml(p.attributed_doctor_name || 'Self (Hospital)')}</td>
          <td>${escapeHtml(p.invoice_no || p.invoice_details?.invoice_no || '—')}</td>
          <td class="c">${escapeHtml((p.payment_mode || '—').toUpperCase())}</td>
          <td class="r">₹${fmtMoney(refundPaymentAmount(p))}</td>
        </tr>`).join('')
      : '<tr><td colspan="9" class="empty">No refunds in this period</td></tr>'

    const isAllPrint = effectiveTypes.includes('all')
    const printWantsOpd = isAllPrint || effectiveTypes.includes('opd')
    const printWantsSlips = isAllPrint || effectiveTypes.includes('payment_slips')
    const printWantsRefunds = isAllPrint || effectiveTypes.includes('refunds')
    const printWantsIpd = isAllPrint || effectiveTypes.includes('ipd_advance')
    const printWantsExpenses = isAllPrint || effectiveTypes.includes('expenses')
    const printWantsCollections = printWantsOpd || printWantsSlips || printWantsRefunds || printWantsIpd

    const expColCount = showSlipItemNames ? 9 : 8
    const expenseRowsHtml = expenses.length
      ? expenses.map((e, i) => `
        <tr>
          <td class="c">${i + 1}</td>
          <td>${escapeHtml(e.paid_at ? formatDateTime(e.paid_at) : '—')}</td>
          <td>${escapeHtml(e.slip_number || '—')}</td>
          <td>${escapeHtml(e.paid_to || '—')}</td>
          ${showSlipItemNames ? `<td>${escapeHtml(getExpenseItemNames(e))}</td>` : ''}
          <td class="c">${escapeHtml((e.payment_mode || '—').toUpperCase())}</td>
          <td class="c">${e.source === 'other_funds' ? 'Other Funds' : 'Collection'}</td>
          <td class="r">₹${fmtMoney(e.total_amount)}</td>
          <td>${escapeHtml(e.recorded_by_name || '—')}</td>
        </tr>`).join('')
      : `<tr><td colspan="${expColCount}" class="empty">No expenses in this period</td></tr>`
    const collectionExpenses = expenses.filter((e) => !e.source || e.source === 'collection')
    const expensesTotal = collectionExpenses.reduce((s, e) => s + (parseFloat(e.total_amount) || 0), 0)

    const tablesBodyHtml = [
      printWantsOpd ? `
      <h2 class="sec">OPD Visits (${opdVisits.length})</h2>
      <table class="tbl opd-tbl">
        <thead>
          <tr>
            <th class="c">#</th><th>Date</th><th>Patient</th><th>UHID</th><th>OPD no</th>
            <th>Doctor</th><th>Dept</th><th class="c">Mode</th><th class="r">Amount</th>
          </tr>
        </thead>
        <tbody>${opdRowsHtml}</tbody>
        <tfoot><tr><td colspan="8" class="r">Total</td><td class="r">₹${fmtMoney(summary.opdRevenue)}</td></tr></tfoot>
      </table>` : '',

      printWantsSlips ? `
      <h2 class="sec">Payment Slips (${paymentSlipsOnly.length})</h2>
      <table class="tbl">
        <thead>
          <tr>
            <th class="c">#</th><th>Date &amp; time</th><th>Slip no</th><th>Patient</th><th>UHID</th>
            ${showSlipItemNames ? '<th>Items</th>' : ''}
            <th>Doctor</th><th>Type</th><th class="c">Mode</th><th class="r">Amount</th>
          </tr>
        </thead>
        <tbody>${allPayRowsHtml}</tbody>
        <tfoot><tr><td colspan="${slipColCount - 1}" class="r">Total</td><td class="r">₹${fmtMoney(summary.slipTotalExAdv)}</td></tr></tfoot>
      </table>
      ${slipsDetailHtml}` : '',

      printWantsRefunds ? `
      <h2 class="sec">Refunds (${refundPayments.length})</h2>
      <table class="tbl">
        <thead>
          <tr>
            <th class="c">#</th><th>Date &amp; time</th><th>Slip no</th><th>Patient</th><th>UHID</th>
            <th>Doctor</th><th>Invoice</th><th class="c">Mode</th><th class="r">Refunded</th>
          </tr>
        </thead>
        <tbody>${refundRowsHtml}</tbody>
        <tfoot><tr><td colspan="8" class="r">Total refunded</td><td class="r">₹${fmtMoney(summary.refundTotal)}</td></tr></tfoot>
      </table>` : '',

      printWantsIpd ? `
      <h2 class="sec">IPD Advance Receipts (${ipdAdvancePayments.length})</h2>
      <table class="tbl">
        <thead>
          <tr>
            <th class="c">#</th><th>Date &amp; time</th><th>Slip no</th><th>Patient</th><th>Invoice</th>
            <th class="c">Mode</th><th class="r">Amount</th>
          </tr>
        </thead>
        <tbody>${ipdAdvRowsHtml}</tbody>
        <tfoot><tr><td colspan="6" class="r">Total</td><td class="r">₹${fmtMoney(summary.advanceTotal)}</td></tr></tfoot>
      </table>` : '',

      printWantsExpenses ? `
      <h2 class="sec">Expenses (${expenses.length})</h2>
      <table class="tbl">
        <thead>
          <tr>
            <th class="c">#</th><th>Date &amp; time</th><th>Voucher #</th><th>Paid to</th>
            ${showSlipItemNames ? '<th>Items</th>' : ''}
            <th class="c">Mode</th><th class="c">Source</th><th class="r">Amount</th><th>Recorded by</th>
          </tr>
        </thead>
        <tbody>${expenseRowsHtml}</tbody>
        <tfoot><tr><td colspan="${expColCount - 2}" class="r">Total (Collection source only)</td><td class="r">₹${fmtMoney(expensesTotal)}</td><td></td></tr></tfoot>
      </table>` : '',
    ].join('')


    const html = `<!DOCTYPE html><html><head>
      <meta charset="utf-8"/>
      <title>Collection Report — ${hospitalName}</title>
      <style>
        @page {
          size: A4 portrait;
          margin: 16mm 13mm 12mm 12mm;
          @top-right {
            content: "Page " counter(page) " of " counter(pages);
            font-family: Arial, Helvetica, sans-serif;
            font-size: 9px;
            font-weight: bold;
            color: #000;
          }
        }
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { font-family: Arial, Helvetica, sans-serif; font-size: 10px; color: #000; line-height: 1.3; }
        .hdr { text-align: center; margin-bottom: 10px; padding-bottom: 4px; }
        .hdr h1 { font-size: 14px; font-weight: bold; margin-bottom: 2px; }
        .hdr p { font-size: 9px; }
        .info { width: 100%; border-collapse: collapse; margin-bottom: 12px; font-size: 9px; }
        .info td { border: 1px solid #000; padding: 4px 6px; }
        .info .lbl { width: 28%; font-weight: bold; background: #f5f5f5; }
        h2.sec { font-size: 11px; font-weight: bold; margin: 14px 0 6px; }
        table.tbl { width: 100%; border-collapse: collapse; font-size: 9px; margin-bottom: 16px; }
        table.tbl thead { display: table-header-group; }
        table.tbl th, table.tbl td { border: 1px solid #000; padding: 4px 5px; text-align: left; }
        table.tbl th { font-weight: bold; }
        table.tbl thead th { background-color: #d1d5db !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        table.tbl.opd-tbl { font-size: 10px; }
        table.tbl.opd-tbl th, table.tbl.opd-tbl td { padding: 5px 6px; }
        table.tbl th.r, table.tbl td.r { text-align: right; }
        table.tbl th.c, table.tbl td.c { text-align: center; }
        table.tbl tfoot { display: table-row-group; }
        table.tbl tfoot td { font-weight: bold; }
        table.tbl td.empty { text-align: center; font-style: italic; padding: 10px; }
        ${REPORT_PRINT_RIGHT_BORDER_FIX}
        .foot { margin-top: 12px; font-size: 8px; color: #444; text-align: center; }
      </style>
    </head><body>

      <div class="hdr">
        <h1>${hospitalName}</h1>
        ${address ? `<p>${address}${pinCode ? ` · PIN ${pinCode}` : ''}</p>` : ''}
        ${phone || email ? `<p>${phone ? `Tel: ${phone}` : ''}${phone && email ? ' · ' : ''}${email || ''}</p>` : ''}
        <p style="margin-top:6px;font-weight:bold">Reception Collection Report — ${escapeHtml(periodLabel)}</p>
      </div>

      <table class="info">
        <tr><td class="lbl">Period</td><td>${escapeHtml(periodLabel)}</td><td class="lbl">Printed</td><td>${escapeHtml(printedAt)}</td></tr>
        <tr><td class="lbl">Scope</td><td>${escapeHtml(scopeLabel)}</td><td class="lbl">Department</td><td>${escapeHtml(deptLabelText)}</td></tr>
        <tr><td class="lbl">Doctor</td><td>${escapeHtml(doctorLabelText)}</td><td class="lbl">Collected by</td><td>${escapeHtml(collectorText)}</td></tr>
        <tr><td class="lbl">Slip detail view</td><td>${escapeHtml(slipDetailViewLabel)}</td><td class="lbl">Slip category</td><td>${escapeHtml(categoryLabelText)}</td></tr>
        ${(printWantsOpd || printWantsSlips) ? `<tr>${printWantsOpd ? `<td class="lbl">OPD visits</td><td>${summary.opdCount} (₹${fmtMoney(summary.opdRevenue)})</td>` : `<td class="lbl"></td><td></td>`}${printWantsSlips ? `<td class="lbl">Payment slips</td><td>${summary.slipCountExAdv} (₹${fmtMoney(summary.slipTotalExAdv)})</td>` : `<td class="lbl"></td><td></td>`}</tr>` : ''}
        ${(printWantsIpd || printWantsRefunds) ? `<tr>${printWantsIpd ? `<td class="lbl">IPD advances</td><td>${summary.advanceCount} (₹${fmtMoney(summary.advanceTotal)})</td>` : `<td class="lbl"></td><td></td>`}${printWantsRefunds ? `<td class="lbl">Refunds</td><td>${summary.refundCount} (₹${fmtMoney(summary.refundTotal)})</td>` : `<td class="lbl"></td><td></td>`}</tr>` : ''}
        ${printWantsCollections ? `<tr><td class="lbl">Gross collection</td><td colspan="3">₹${fmtMoney(summary.grandCollection)}</td></tr>` : ''}
        ${printWantsExpenses ? `<tr><td class="lbl">Expenses</td><td>${expenses.length} voucher(s) · ₹${fmtMoney(expensesTotal)}</td>${printWantsCollections ? `<td class="lbl" style="background:#fee2e2">Net collection</td><td style="font-weight:bold">${(() => { const net = collectionSummary?.net_total != null ? Number(collectionSummary.net_total) : (summary.grandCollection - expensesTotal); return (net < 0 ? '<span style="color:red">−₹' + fmtMoney(Math.abs(net)) + '</span>' : '₹' + fmtMoney(net)); })()}</td>` : `<td class="lbl">Total expenses</td><td style="font-weight:bold">₹${fmtMoney(expensesTotal)}</td>`}</tr>` : ''}
        ${printWantsCollections ? `<tr><td class="lbl" colspan="2">By mode (OPD + IPD advances + payment slips)</td><td colspan="2">Cash ₹${fmtMoney(summary.modeTotals.cash)} · UPI ₹${fmtMoney(summary.modeTotals.upi)} · Card ₹${fmtMoney(summary.modeTotals.card)} · Other ₹${fmtMoney(summary.modeTotals.other)}</td></tr>` : ''}
      </table>

      ${tablesBodyHtml}

      <p class="foot">Printed ${escapeHtml(printedAt)} · ${escapeHtml(hospitalName)}</p>
    </body></html>`

    setPrintPreview({ title: 'Reception Collection Report', html })
  }

  function renderDoctorRevenueOverviewHtml(report) {
    const rows = []
    if (report.hospital_self) {
      const s = report.hospital_self.summary || {}
      rows.push(`
        <tr>
          <td><strong>${escapeHtml(report.hospital_self.doctor_name || 'Self (Hospital)')}</strong></td>
          <td class="c">${s.opd?.count ?? 0}</td><td class="r">₹${fmtMoney(s.opd?.total)}</td>
          <td class="c">${s.ipd?.count ?? 0}</td><td class="r">₹${fmtMoney(s.ipd?.total)}</td>
          <td class="c">${s.payment_slips?.count ?? 0}</td><td class="r">₹${fmtMoney(s.payment_slips?.total)}</td>
          <td class="c">${s.refunds?.count ?? 0}</td><td class="r">₹${fmtMoney(s.refunds?.total)}</td>
          <td class="r"><strong>₹${fmtMoney(s.grand_total)}</strong></td>
        </tr>`)
    }
    for (const doc of report.doctors || []) {
      const s = doc.summary || {}
      rows.push(`
        <tr>
          <td><strong>${escapeHtml(doc.doctor_name || 'Doctor')}</strong></td>
          <td class="c">${s.opd?.count ?? 0}</td><td class="r">₹${fmtMoney(s.opd?.total)}</td>
          <td class="c">${s.ipd?.count ?? 0}</td><td class="r">₹${fmtMoney(s.ipd?.total)}</td>
          <td class="c">${s.payment_slips?.count ?? 0}</td><td class="r">₹${fmtMoney(s.payment_slips?.total)}</td>
          <td class="c">${s.refunds?.count ?? 0}</td><td class="r">₹${fmtMoney(s.refunds?.total)}</td>
          <td class="r"><strong>₹${fmtMoney(s.grand_total)}</strong></td>
        </tr>`)
    }
    if (!rows.length) {
      return '<p class="empty">No revenue data for this period.</p>'
    }
    return `
      <h2 class="sec">Revenue overview</h2>
      <table class="tbl overview">
        <thead>
          <tr>
            <th>Doctor / Self</th>
            <th class="c">OPD #</th><th class="r">OPD ₹</th>
            <th class="c">IPD #</th><th class="r">IPD ₹</th>
            <th class="c">Slips #</th><th class="r">Slips ₹</th>
            <th class="c">Refunds #</th><th class="r">Refunds ₹</th>
            <th class="r">Total</th>
          </tr>
        </thead>
        <tbody>${rows.join('')}</tbody>
        <tfoot>
          <tr>
            <td colspan="9" class="r"><strong>Grand total</strong></td>
            <td class="r"><strong>₹${fmtMoney(report.grand_total)}</strong></td>
          </tr>
        </tfoot>
      </table>`
  }

  function renderDoctorRevenueSectionHtml(section, { showDailyBreakdown = true } = {}) {
    if (!section) return ''
    const s = section.summary || {}
    const categories = section.payment_slips_by_category || []
    const categoryTableHtml = renderPaymentSlipsByCategoryHtml(categories)

    let dailyTableHtml = ''
    if (showDailyBreakdown) {
      const dailyRows = (section.daily || []).map((d) => `
      <tr>
        <td>${escapeHtml(d.date ? format(new Date(`${d.date}T12:00:00`), 'dd/MM/yyyy') : '—')}</td>
        <td class="r">₹${fmtMoney(d.opd_total)}</td>
        <td class="r">₹${fmtMoney(d.ipd_total)}</td>
        <td class="r">₹${fmtMoney(d.slips_total)}</td>
        <td class="r">₹${fmtMoney(d.refunds_total)}</td>
        <td class="r">₹${fmtMoney(d.day_total)}</td>
      </tr>`).join('')
      dailyTableHtml = `
        <h2 class="sec">Daily collection</h2>
        <table class="tbl">
          <thead>
            <tr><th>Date</th><th class="r">OPD</th><th class="r">IPD</th><th class="r">Slips</th><th class="r">Refunds</th><th class="r">Day total</th></tr>
          </thead>
          <tbody>${dailyRows || '<tr><td colspan="6" class="empty">No dates in range</td></tr>'}</tbody>
          <tfoot>
            <tr>
              <td><strong>Interval total</strong></td>
              <td class="r">₹${fmtMoney((section.daily || []).reduce((a, d) => a + (Number(d.opd_total) || 0), 0))}</td>
              <td class="r">₹${fmtMoney((section.daily || []).reduce((a, d) => a + (Number(d.ipd_total) || 0), 0))}</td>
              <td class="r">₹${fmtMoney((section.daily || []).reduce((a, d) => a + (Number(d.slips_total) || 0), 0))}</td>
              <td class="r">₹${fmtMoney((section.daily || []).reduce((a, d) => a + (Number(d.refunds_total) || 0), 0))}</td>
              <td class="r"><strong>₹${fmtMoney(section.interval_total)}</strong></td>
            </tr>
          </tfoot>
        </table>`
    }

    return `
      <div class="doctor-block">
        <h2 class="doctor-name">${escapeHtml(section.doctor_name || 'Doctor')}</h2>
        <table class="tbl summary-tbl">
          <thead><tr><th>Source</th><th class="c">Count</th><th class="r">Total</th></tr></thead>
          <tbody>
            <tr><td>OPD</td><td class="c">${s.opd?.count ?? 0}</td><td class="r">₹${fmtMoney(s.opd?.total)}</td></tr>
            <tr><td>IPD charges</td><td class="c">${s.ipd?.count ?? 0}</td><td class="r">₹${fmtMoney(s.ipd?.total)}</td></tr>
            <tr><td>Payment slips</td><td class="c">${s.payment_slips?.count ?? 0}</td><td class="r">₹${fmtMoney(s.payment_slips?.total)}</td></tr>
            <tr><td>Refunds</td><td class="c">${s.refunds?.count ?? 0}</td><td class="r">₹${fmtMoney(s.refunds?.total)}</td></tr>
          </tbody>
          <tfoot><tr><td><strong>Net total</strong></td><td></td><td class="r"><strong>₹${fmtMoney(s.grand_total)}</strong></td></tr></tfoot>
        </table>
        ${categoryTableHtml}
        ${dailyTableHtml}
      </div>`
  }

  async function printDoctorRevenue() {
    if (!fromDate || !toDate) {
      toast.error('Select from and to dates')
      return
    }
    if (fromDate > toDate) {
      toast.error('From date cannot be after to date')
      return
    }
    setPrintingDoctorRevenue(true)
    try {
      const params = new URLSearchParams({ date_from: fromDate, date_to: toDate })
      if (doctorUser) params.set('attributed_doctor_user', doctorUser)
      if (slipCategory) params.set('slip_category', slipCategory)
      const { data: res } = await api.get(`/reports/doctor-revenue/?${params}`)
      const report = res?.data ?? res?.entity ?? res

      await loadReceptionPortalProfileCache()
      const profile = getPaymentSlipProfile()
      const hospitalName = escapeHtml(profile.hospital_name || 'Hospital')
      const address = escapeHtml(profile.address || '')
      const pinCode = escapeHtml(profile.pin_code || '')
      const phone = escapeHtml(profile.phone || '')
      const email = escapeHtml(profile.email || '')
      const printedAt = formatWithPattern(new Date(), 'd MMMM yyyy · HH:mm')
      const showDailyBreakdown = fromDate !== toDate
      const periodLabel = fromDate === toDate
        ? format(new Date(`${fromDate}T12:00:00`), 'd MMM yyyy')
        : `${format(new Date(`${fromDate}T12:00:00`), 'd MMM yyyy')} – ${format(new Date(`${toDate}T12:00:00`), 'd MMM yyyy')}`
      const doctorLabelText = doctorUser
        ? doctorLabel(doctors.find((d) => doctorUserId(d) === doctorUser) || {})
        : 'All doctors'
      const categoryLabel = slipCategory || 'All categories'

      const sections = []
      for (const doc of report.doctors || []) {
        sections.push(renderDoctorRevenueSectionHtml(doc, { showDailyBreakdown }))
      }
      if (report.hospital_self) sections.push(renderDoctorRevenueSectionHtml(report.hospital_self, { showDailyBreakdown }))
      const overviewHtml = renderDoctorRevenueOverviewHtml(report)

      const html = `<!DOCTYPE html><html><head>
        <meta charset="utf-8"/>
        <title>Doctor Revenue — ${hospitalName}</title>
        <style>
          @page { size: A4 portrait; margin: 12mm 11mm 12mm 10mm; }
          * { box-sizing: border-box; margin: 0; padding: 0; }
          body { font-family: Arial, Helvetica, sans-serif; font-size: 10px; color: #000; line-height: 1.35; }
          .hdr { text-align: center; margin-bottom: 8px; padding-bottom: 4px; }
          .hdr h1 { font-size: 14px; font-weight: bold; }
          .hdr p { font-size: 9px; }
          .info { width: 100%; border-collapse: collapse; margin-bottom: 10px; font-size: 9px; }
          .info td { border: 1px solid #000; padding: 4px 6px; }
          .info .lbl { width: 28%; font-weight: bold; background: #f5f5f5; }
          h2.sec { font-size: 11px; font-weight: bold; margin: 12px 0 5px; }
          h3.sub { font-size: 10px; font-weight: bold; margin: 8px 0 4px; }
          .doctor-block { margin-bottom: 20px; padding-bottom: 14px; border-bottom: 2px solid #000; }
          .doctor-block + .doctor-block { margin-top: 8px; }
          .doctor-name { text-align: center; font-size: 18px; font-weight: bold; margin: 16px 0 10px; padding-bottom: 6px; page-break-after: avoid; }
          table.tbl { width: 100%; border-collapse: collapse; font-size: 9px; margin-bottom: 8px; }
          table.tbl.overview { margin-bottom: 14px; }
          table.tbl.compact { font-size: 8px; }
          table.tbl thead { display: table-header-group; }
          table.tbl th, table.tbl td { border: 1px solid #000; padding: 3px 5px; text-align: left; vertical-align: top; }
          table.tbl th { font-weight: bold; }
          table.tbl thead th { background-color: #d1d5db !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          table.tbl th.r, table.tbl td.r { text-align: right; }
          table.tbl th.c, table.tbl td.c { text-align: center; }
          table.tbl tfoot { display: table-footer-group; }
          table.tbl tfoot td { font-weight: bold; }
          table.tbl td.empty { text-align: center; font-style: italic; }
          table.summary-tbl { page-break-inside: avoid; }
          ${REPORT_PRINT_RIGHT_BORDER_FIX}
          p.empty { text-align: center; font-style: italic; padding: 12px; }
          .grand { margin-top: 10px; font-size: 12px; font-weight: bold; text-align: right; page-break-inside: avoid; }
          .foot { margin-top: 8px; font-size: 8px; color: #444; text-align: center; }
        </style>
      </head><body>
        <div class="hdr">
          <h1>${hospitalName}</h1>
          ${address ? `<p>${address}${pinCode ? ` · PIN ${pinCode}` : ''}</p>` : ''}
          ${phone || email ? `<p>${phone ? `Tel: ${phone}` : ''}${phone && email ? ' · ' : ''}${email || ''}</p>` : ''}
          <p style="margin-top:6px;font-weight:bold">Doctor Revenue Report — ${escapeHtml(periodLabel)}</p>
        </div>
        <table class="info">
          <tr><td class="lbl">Period</td><td>${escapeHtml(periodLabel)}</td><td class="lbl">Printed</td><td>${escapeHtml(printedAt)}</td></tr>
          <tr><td class="lbl">Doctor</td><td>${escapeHtml(doctorLabelText)}</td><td class="lbl">Slip category</td><td>${escapeHtml(categoryLabel)}</td></tr>
        </table>
        ${overviewHtml}
        ${sections.length ? `<h2 class="sec">Detailed breakdown</h2>${sections.join('')}` : ''}
        <p class="grand">Grand total: ₹${fmtMoney(report.grand_total)}</p>
        <p class="foot">Printed ${escapeHtml(printedAt)} · ${escapeHtml(hospitalName)}</p>
      </body></html>`

      setPrintPreview({ title: 'Doctor Revenue Report', html })
    } catch {
      toast.error('Failed to load doctor revenue report')
    } finally {
      setPrintingDoctorRevenue(false)
    }
  }

  const filterInputCls = 'border border-gray-200 rounded-md px-2 py-1 text-xs bg-white min-w-0'
  const modeBar = summary.modeGrand > 0 ? (
    <div className="flex h-1.5 rounded-full overflow-hidden bg-gray-200 shrink-0 w-24 sm:w-32">
      {summary.modeTotals.cash > 0 && (
        <div className="bg-emerald-500" style={{ width: `${(summary.modeTotals.cash / summary.modeGrand) * 100}%` }} title={`Cash ₹${fmtMoney(summary.modeTotals.cash)}`} />
      )}
      {summary.modeTotals.upi > 0 && (
        <div className="bg-blue-500" style={{ width: `${(summary.modeTotals.upi / summary.modeGrand) * 100}%` }} title={`UPI ₹${fmtMoney(summary.modeTotals.upi)}`} />
      )}
      {summary.modeTotals.card > 0 && (
        <div className="bg-violet-500" style={{ width: `${(summary.modeTotals.card / summary.modeGrand) * 100}%` }} title={`Card ₹${fmtMoney(summary.modeTotals.card)}`} />
      )}
      {summary.modeTotals.other > 0 && (
        <div className="bg-gray-400" style={{ width: `${(summary.modeTotals.other / summary.modeGrand) * 100}%` }} title={`Other ₹${fmtMoney(summary.modeTotals.other)}`} />
      )}
    </div>
  ) : null

  return (
    <>
    <div className="space-y-2 max-w-[1400px] mx-auto">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-bold text-gray-900">Daily Collection Report</h2>
        <div className="flex flex-wrap items-center gap-1.5">
          {lastFetched && (
            <span className="text-[10px] text-gray-400 tabular-nums" title="Auto-refresh every 5 min">
              {formatWithPattern(lastFetched, 'd/M HH:mm')}
            </span>
          )}
          <button type="button" onClick={fetchReport} disabled={loading}
            className="px-2.5 py-1 rounded-md bg-indigo-600 text-white text-xs font-semibold hover:bg-indigo-700 disabled:opacity-50">
            {loading ? '…' : 'Refresh'}
          </button>
          <button type="button" onClick={exportCsv}
            className="px-2.5 py-1 rounded-md border border-gray-200 bg-white text-xs font-semibold text-gray-700 hover:bg-gray-50">
            CSV
          </button>
          <button type="button" onClick={printReport}
            className="px-2.5 py-1 rounded-md border border-indigo-200 bg-indigo-50 text-xs font-semibold text-indigo-800 hover:bg-indigo-100">
            Print
          </button>
          <button type="button" onClick={printDoctorRevenue} disabled={printingDoctorRevenue}
            className="px-2.5 py-1 rounded-md border border-emerald-200 bg-emerald-50 text-xs font-semibold text-emerald-800 hover:bg-emerald-100 disabled:opacity-50">
            {printingDoctorRevenue ? '…' : 'Print doctor revenue'}
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-1.5 px-2 py-1.5 bg-gray-50 border border-gray-200 rounded-lg">
        {[
          { id: 'today', label: 'Today' },
          { id: 'yesterday', label: 'Yest.' },
          { id: 'week', label: 'Week' },
          { id: 'month', label: 'Month' },
        ].map((q) => (
          <button key={q.id} type="button" onClick={() => setQuickRange(q.id)}
            className="text-[11px] font-semibold px-2 py-0.5 rounded bg-white border border-gray-200 text-gray-600 hover:border-indigo-300 hover:text-indigo-700">
            {q.label}
          </button>
        ))}
        <span className="w-px h-4 bg-gray-300 hidden sm:block" aria-hidden />
        <input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} title="From date" className={filterInputCls} />
        <span className="text-[10px] text-gray-400">–</span>
        <input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} title="To date" className={filterInputCls} />
        <select value={doctorUser} onChange={(e) => setDoctorUser(e.target.value)} title="Doctor" className={`${filterInputCls} max-w-[140px]`}>
          <option value="">All doctors</option>
          {doctors.map((d) => (
            <option key={d.id} value={doctorUserId(d)}>{doctorLabel(d)}</option>
          ))}
        </select>
        <select value={department} onChange={(e) => setDepartment(e.target.value)} title="Department" className={`${filterInputCls} max-w-[120px]`}>
          <option value="">All dept</option>
          {departments.map((dep) => (
            <option key={dep.id} value={dep.name || dep.code || ''}>{dep.name || dep.code}</option>
          ))}
        </select>
        {/* Multi-select report type dropdown */}
        <div className="relative" ref={typeDropdownRef}>
          <button
            type="button"
            onClick={() => setTypeDropdownOpen((o) => !o)}
            className={`${filterInputCls} max-w-[160px] flex items-center gap-1 cursor-pointer select-none`}
            style={{ minWidth: 110 }}
          >
            <span className="flex-1 truncate text-left">
              {effectiveTypes.includes('all')
                ? 'All types'
                : effectiveTypes.map((t) => ({
                    opd: 'OPD',
                    payment_slips: 'Slips',
                    ipd_advance: 'IPD adv.',
                    refunds: 'Refunds',
                    expenses: 'Expenses',
                  }[t] || t)).join(', ')}
            </span>
            <svg className="w-3 h-3 text-gray-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
          </button>
          {typeDropdownOpen && (
            <div
              className="absolute z-50 left-0 top-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg py-1 min-w-[160px]"
              onMouseLeave={() => setTypeDropdownOpen(false)}
            >
              {[
                { id: 'all', label: 'All types' },
                { id: 'opd', label: 'OPD slips' },
                { id: 'payment_slips', label: 'Payment slips' },
                { id: 'ipd_advance', label: 'IPD advance' },
                { id: 'refunds', label: 'Refunds' },
                { id: 'expenses', label: 'Expenses' },
              ].map((opt) => {
                const isAll = opt.id === 'all'
                const checked = isAll
                  ? effectiveTypes.includes('all')
                  : !effectiveTypes.includes('all') && effectiveTypes.includes(opt.id)
                return (
                  <label
                    key={opt.id}
                    className="flex items-center gap-2 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-indigo-50 cursor-pointer"
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      className="rounded"
                      onChange={() => {
                        if (isAll) {
                          setReportTypes(['all'])
                        } else {
                          setReportTypes((prev) => {
                            const withoutAll = prev.filter((x) => x !== 'all')
                            const next = withoutAll.includes(opt.id)
                              ? withoutAll.filter((x) => x !== opt.id)
                              : [...withoutAll, opt.id]
                            if (!next.length) return ['all']
                            if (next.includes('refunds') && !prev.includes('refunds')) setDataTab('refunds')
                            return next
                          })
                        }
                      }}
                    />
                    {opt.label}
                  </label>
                )
              })}
            </div>
          )}
        </div>
        <select value={collectedBy} onChange={(e) => setCollectedBy(e.target.value)} title="Collected by" className={`${filterInputCls} max-w-[120px]`}>
          <option value="">All staff</option>
          {staff.map((s) => (
            <option key={s.id} value={s.user}>{s.name || s.employee_code || s.user}</option>
          ))}
        </select>
        <select value={slipCategory} onChange={(e) => setSlipCategory(e.target.value)} title="Payment slip category" className={`${filterInputCls} max-w-[130px]`}>
          <option value="">All categories</option>
          {slipCategories.map((cat) => (
            <option key={cat} value={cat}>{cat}</option>
          ))}
        </select>
        <select value={slipPrintView} onChange={(e) => setSlipPrintView(e.target.value)} title="Slip print view" className={`${filterInputCls} max-w-[130px]`}>
          <option value="category">By category</option>
          <option value="items">By slip items</option>
        </select>
        <button
          type="button"
          onClick={() => setShowSlipItemNames((v) => !v)}
          title="Toggle item names column in payment slips table"
          className={`text-[11px] font-semibold px-2 py-0.5 rounded border ${
            showSlipItemNames
              ? 'bg-indigo-600 text-white border-indigo-600'
              : 'bg-white text-gray-600 border-gray-200 hover:border-indigo-300 hover:text-indigo-700'
          }`}
        >
          {showSlipItemNames ? '✓ Item names' : 'Item names'}
        </button>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-1.5">
        {[
          { label: 'OPD', value: summary.opdCount, sub: `₹${fmtMoney(summary.opdRevenue)}`, color: 'border-blue-200/80 bg-blue-50/60' },
          { label: 'Slips', value: summary.slipCountExAdv, sub: `₹${fmtMoney(summary.slipTotalExAdv)}`, color: 'border-emerald-200/80 bg-emerald-50/60' },
          { label: 'IPD adv.', value: summary.advanceCount, sub: `₹${fmtMoney(summary.advanceTotal)}`, color: 'border-amber-200/80 bg-amber-50/60' },
          { label: 'Refunds', value: summary.refundCount, sub: `₹${fmtMoney(summary.refundTotal)}`, color: 'border-sky-200/80 bg-sky-50/60' },
          (() => { const cExp = expenses.filter((e) => !e.source || e.source === 'collection'); const cTotal = collectionSummary?.expenses_total != null ? Number(collectionSummary.expenses_total) : cExp.reduce((s, e) => s + (parseFloat(e.total_amount) || 0), 0); const othTotal = expenses.filter((e) => e.source === 'other_funds').reduce((s, e) => s + (parseFloat(e.total_amount) || 0), 0); return { label: 'Expenses', value: expenses.length, sub: `₹${fmtMoney(cTotal)} from collection${othTotal > 0 ? ` · ₹${fmtMoney(othTotal)} other` : ''}`, color: 'border-rose-200/80 bg-rose-50/60' } })(),
          (() => { const net = collectionSummary?.net_total != null ? Number(collectionSummary.net_total) : summary.grandCollection; return { label: 'Net', value: (net < 0 ? '−₹' : '₹') + fmtMoney(Math.abs(net)), sub: 'After expenses', color: net < 0 ? 'border-rose-300/80 bg-rose-100/60' : 'border-indigo-200/80 bg-indigo-50/60' } })()
        ].map((c) => (
          <div key={c.label} className={`rounded-lg border px-2.5 py-1.5 ${c.color}`}>
            <p className="text-[9px] font-semibold uppercase text-gray-500 leading-none">{c.label}</p>
            <p className="text-lg font-bold text-gray-900 tabular-nums leading-tight">{c.value}</p>
            <p className="text-[10px] text-gray-600 tabular-nums">{c.sub}</p>
          </div>
        ))}
      </div>

      {summary.modeGrand > 0 && (
        <div className="flex flex-wrap items-center gap-2 px-1 text-[10px] text-gray-500">
          {modeBar}
          <span className="tabular-nums">Cash ₹{fmtMoney(summary.modeTotals.cash)}</span>
          <span className="text-gray-300">·</span>
          <span className="tabular-nums">UPI ₹{fmtMoney(summary.modeTotals.upi)}</span>
          <span className="text-gray-300">·</span>
          <span className="tabular-nums">Card ₹{fmtMoney(summary.modeTotals.card)}</span>
          <span className="text-gray-300">·</span>
          <span className="tabular-nums">Other ₹{fmtMoney(summary.modeTotals.other)}</span>
        </div>
      )}

      <div className="bg-white border border-gray-200 rounded-lg shadow-sm overflow-hidden flex flex-col min-h-[420px]">
        <div className="flex flex-wrap items-stretch border-b border-gray-100 shrink-0">
          <div className="flex flex-1 min-w-0">
          {visibleTabs.map((t) => {
              const count = t.id === 'collection'
                ? (collectionSummary?.doctors?.length || 0) + 1
                : t.id === 'opd' ? opdVisits.length
                : t.id === 'slips' ? paymentSlipsOnly.length
                : t.id === 'refunds' ? refundPayments.length
                : t.id === 'expenses' ? expenses.length
                : ipdAdvancePayments.length
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setDataTab(t.id)}
                  className={`flex-1 py-2 text-xs font-semibold min-w-[72px] ${dataTab === t.id ? 'text-indigo-700 border-b-2 border-indigo-600 bg-indigo-50/40' : 'text-gray-500 hover:text-gray-700'}`}
                >
                  {t.label} ({count})
                </button>
              )
            })}
          </div>
          <div className="flex items-center border-l border-gray-100 px-1.5 gap-0.5 shrink-0">
            <button
              type="button"
              onClick={() => setDataView('table')}
              title="Table view"
              className={`px-2.5 py-1.5 text-[11px] font-semibold rounded-md ${dataView === 'table' ? 'bg-indigo-600 text-white' : 'text-gray-500 hover:bg-gray-100'}`}
            >
              Table
            </button>
            <button
              type="button"
              onClick={() => setDataView('chart')}
              title="Chart view"
              className={`px-2.5 py-1.5 text-[11px] font-semibold rounded-md ${dataView === 'chart' ? 'bg-indigo-600 text-white' : 'text-gray-500 hover:bg-gray-100'}`}
            >
              Chart
            </button>
          </div>
        </div>
        <div className="overflow-x-auto flex-1 min-h-0 max-h-[min(70vh,720px)] overflow-y-auto">
          {dataView === 'chart' ? (
            <ReportsCharts dataTab={dataTab} chartBundle={chartBundle} loading={loading} />
          ) : loading ? (
            <p className="p-6 text-center text-gray-400 text-sm">Loading…</p>
          ) : dataTab === 'collection' ? (
            <table className="w-full text-sm">
              <thead className="bg-gray-50 sticky top-0 text-[10px] uppercase text-gray-500">
                <tr>
                  <th className="px-3 py-2 text-left">Doctor / Self</th>
                  <th className="px-3 py-2 text-right">OPD fees</th>
                  <th className="px-3 py-2 text-right">Payment slips</th>
                  <th className="px-3 py-2 text-right">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {!collectionSummary ? (
                  <tr><td colSpan={4} className="px-3 py-6 text-center text-gray-400">No collection data</td></tr>
                ) : (
                  <>
                    {!doctorUser && (
                      <tr className="hover:bg-amber-50/40">
                        <td className="px-3 py-2 font-bold">Self (Hospital)</td>
                        <td className="px-3 py-2 text-right tabular-nums">₹{fmtMoney(collectionSummary.hospital_self?.opd_fees)}</td>
                        <td className="px-3 py-2 text-right tabular-nums">₹{fmtMoney(collectionSummary.hospital_self?.payments)}</td>
                        <td className="px-3 py-2 text-right font-bold tabular-nums">₹{fmtMoney(collectionSummary.hospital_self?.total)}</td>
                      </tr>
                    )}
                    {(collectionSummary.doctors || []).map((row) => (
                      <tr key={row.doctor_user_id} className="hover:bg-indigo-50/40">
                        <td className="px-3 py-2 font-medium">{row.doctor_name || 'Doctor'}</td>
                        <td className="px-3 py-2 text-right tabular-nums">₹{fmtMoney(row.opd_fees)}</td>
                        <td className="px-3 py-2 text-right tabular-nums">₹{fmtMoney(row.payments)}</td>
                        <td className="px-3 py-2 text-right font-bold text-indigo-700 tabular-nums">₹{fmtMoney(row.total)}</td>
                      </tr>
                    ))}
                  </>
                )}
              </tbody>
              {collectionSummary && (
                <tfoot className="bg-gray-50 border-t border-gray-200">
                  <tr>
                    <td className="px-3 py-2 font-bold text-right" colSpan={3}>Gross collection</td>
                    <td className="px-3 py-2 text-right font-black tabular-nums">₹{fmtMoney(collectionSummary.grand_total)}</td>
                  </tr>
                  {collectionSummary.expenses_total != null && (
                    <tr>
                      <td className="px-3 py-2 font-bold text-right text-rose-700" colSpan={3}>Less: Expenses</td>
                      <td className="px-3 py-2 text-right font-bold text-rose-700 tabular-nums">₹{fmtMoney(collectionSummary.expenses_total)}</td>
                    </tr>
                  )}
                  {collectionSummary.net_total != null && (
                    <tr>
                      <td className="px-3 py-2 font-bold text-right text-emerald-800" colSpan={3}>Net collection</td>
                      <td className="px-3 py-2 text-right font-black text-emerald-800 tabular-nums">₹{fmtMoney(collectionSummary.net_total)}</td>
                    </tr>
                  )}
                </tfoot>
              )}
            </table>
          ) : dataTab === 'opd' ? (
            <table className="w-full text-sm">
              <thead className="bg-gray-50 sticky top-0 text-[10px] uppercase text-gray-500">
                <tr>
                  <th className="px-3 py-2 text-left">#</th>
                  <th className="px-3 py-2 text-left">Date</th>
                  <th className="px-3 py-2 text-left">Patient</th>
                  <th className="px-3 py-2 text-left">UHID</th>
                  <th className="px-3 py-2 text-left">Doctor</th>
                  <th className="px-3 py-2 text-left">Dept</th>
                  <th className="px-3 py-2 text-right">Amount</th>
                  <th className="px-3 py-2 text-left">Mode</th>
                  <th className="px-3 py-2 text-left">OPD No</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {opdVisits.length === 0 ? (
                  <tr><td colSpan={9} className="px-3 py-6 text-center text-gray-400">No OPD visits in this range</td></tr>
                ) : opdVisits.map((v, i) => (
                  <tr key={v.id} className="hover:bg-blue-50/40">
                    <td className="px-3 py-2 text-gray-500">{i + 1}</td>
                    <td className="px-3 py-2 whitespace-nowrap">{v.visit_date ? format(new Date(v.visit_date), 'dd/MM/yyyy') : '—'}</td>
                    <td className="px-3 py-2 font-medium">{v.patient_name || '—'}</td>
                    <td className="px-3 py-2 font-mono text-xs">{v.patient_uhid || '—'}</td>
                    <td className="px-3 py-2">{v.doctor_name || '—'}</td>
                    <td className="px-3 py-2">{v.department || '—'}</td>
                    <td className="px-3 py-2 text-right font-bold tabular-nums">₹{fmtMoney(v.amount)}</td>
                    <td className="px-3 py-2 uppercase text-xs">{v.payment_mode || '—'}</td>
                    <td className="px-3 py-2 font-mono text-xs">{v.opd_no || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : dataTab === 'slips' ? (
            <table className="w-full text-sm">
              <thead className="bg-gray-50 sticky top-0 text-[10px] uppercase text-gray-500">
                <tr>
                  <th className="px-3 py-2 text-left">#</th>
                  <th className="px-3 py-2 text-left">Date</th>
                  <th className="px-3 py-2 text-left">Slip no</th>
                  <th className="px-3 py-2 text-left">Patient</th>
                  {showSlipItemNames && <th className="px-3 py-2 text-left">Items</th>}
                  <th className="px-3 py-2 text-left">Attributed to</th>
                  <th className="px-3 py-2 text-left">Type</th>
                  <th className="px-3 py-2 text-left">Mode</th>
                  <th className="px-3 py-2 text-right">Amount</th>
                  <th className="px-3 py-2 text-left">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {paymentSlipsOnly.length === 0 ? (
                  <tr><td colSpan={showSlipItemNames ? 10 : 9} className="px-3 py-6 text-center text-gray-400">No payment slips in this range</td></tr>
                ) : paymentSlipsOnly.map((p, i) => (
                  <tr key={p.id} className="hover:bg-emerald-50/40">
                    <td className="px-3 py-2 text-gray-500">{i + 1}</td>
                    <td className="px-3 py-2 whitespace-nowrap tabular-nums">{p.paid_at ? formatDateTime(p.paid_at) : '—'}</td>
                    <td className="px-3 py-2 font-mono text-xs font-semibold">{p.slip_number || '—'}</td>
                    <td className="px-3 py-2 font-medium">{p.patient_name || '—'}</td>
                    {showSlipItemNames && (
                      <td className="px-3 py-2 text-xs text-gray-700 max-w-[220px]">
                        {getSlipItemNames(p)}
                      </td>
                    )}
                    <td className="px-3 py-2 text-xs font-semibold text-indigo-700">{p.attributed_doctor_name || 'Self (Hospital)'}</td>
                    <td className="px-3 py-2"><span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-gray-100">{paymentEncounterLabel(p)}</span></td>
                    <td className="px-3 py-2 uppercase text-xs">{p.payment_mode || '—'}</td>
                    <td className="px-3 py-2 text-right font-bold text-emerald-700 tabular-nums">₹{fmtMoney(p.amount)}</td>
                    <td className="px-3 py-2 capitalize text-xs">{p.status || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : dataTab === 'refunds' ? (
            <table className="w-full text-sm">
              <thead className="bg-gray-50 sticky top-0 text-[10px] uppercase text-gray-500">
                <tr>
                  <th className="px-3 py-2 text-left">#</th>
                  <th className="px-3 py-2 text-left">Date</th>
                  <th className="px-3 py-2 text-left">Slip no</th>
                  <th className="px-3 py-2 text-left">Patient</th>
                  <th className="px-3 py-2 text-left">Attributed to</th>
                  <th className="px-3 py-2 text-left">Invoice</th>
                  <th className="px-3 py-2 text-left">Mode</th>
                  <th className="px-3 py-2 text-right">Refunded</th>
                  <th className="px-3 py-2 text-left">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {refundPayments.length === 0 ? (
                  <tr><td colSpan={9} className="px-3 py-6 text-center text-gray-400">No refunds in this range</td></tr>
                ) : refundPayments.map((p, i) => (
                  <tr key={p.id} className="hover:bg-sky-50/40">
                    <td className="px-3 py-2 text-gray-500">{i + 1}</td>
                    <td className="px-3 py-2 whitespace-nowrap tabular-nums">{p.paid_at ? formatDateTime(p.paid_at) : '—'}</td>
                    <td className="px-3 py-2 font-mono text-xs font-semibold">{p.slip_number || '—'}</td>
                    <td className="px-3 py-2 font-medium">{p.patient_name || '—'}</td>
                    <td className="px-3 py-2 text-xs font-semibold text-indigo-700">{p.attributed_doctor_name || 'Self (Hospital)'}</td>
                    <td className="px-3 py-2 font-mono text-xs">{p.invoice_no || p.invoice_details?.invoice_no || '—'}</td>
                    <td className="px-3 py-2 uppercase text-xs">{p.payment_mode || '—'}</td>
                    <td className="px-3 py-2 text-right font-bold text-sky-700 tabular-nums">₹{fmtMoney(refundPaymentAmount(p))}</td>
                    <td className="px-3 py-2 capitalize text-xs">{p.status || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : dataTab === 'ipd' ? (
            <table className="w-full text-sm">
              <thead className="bg-gray-50 sticky top-0 text-[10px] uppercase text-gray-500">
                <tr>
                  <th className="px-3 py-2 text-left">#</th>
                  <th className="px-3 py-2 text-left">Date</th>
                  <th className="px-3 py-2 text-left">Slip no</th>
                  <th className="px-3 py-2 text-left">Patient</th>
                  <th className="px-3 py-2 text-left">Invoice</th>
                  <th className="px-3 py-2 text-left">Mode</th>
                  <th className="px-3 py-2 text-right">Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {ipdAdvancePayments.length === 0 ? (
                  <tr><td colSpan={7} className="px-3 py-6 text-center text-gray-400">No IPD advances in this range</td></tr>
                ) : ipdAdvancePayments.map((p, i) => (
                  <tr key={p.id} className="hover:bg-amber-50/40">
                    <td className="px-3 py-2 text-gray-500">{i + 1}</td>
                    <td className="px-3 py-2 whitespace-nowrap tabular-nums">{p.paid_at ? formatDateTime(p.paid_at) : '—'}</td>
                    <td className="px-3 py-2 font-mono text-xs font-semibold">{p.slip_number || '—'}</td>
                    <td className="px-3 py-2 font-medium">{p.patient_name || '—'}</td>
                    <td className="px-3 py-2 font-mono text-xs">{p.invoice_no || p.invoice_details?.invoice_no || '—'}</td>
                    <td className="px-3 py-2 uppercase text-xs">{p.payment_mode || '—'}</td>
                    <td className="px-3 py-2 text-right font-bold text-amber-700 tabular-nums">₹{fmtMoney(p.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : dataTab === 'expenses' ? (
            <table className="w-full text-sm">
              <thead className="bg-gray-50 sticky top-0 text-[10px] uppercase text-gray-500">
                <tr>
                  <th className="px-3 py-2 text-left">#</th>
                  <th className="px-3 py-2 text-left">Date</th>
                  <th className="px-3 py-2 text-left">Voucher #</th>
                  <th className="px-3 py-2 text-left">Paid to</th>
                  {showSlipItemNames && <th className="px-3 py-2 text-left">Items</th>}
                  <th className="px-3 py-2 text-left">Mode</th>
                  <th className="px-3 py-2 text-right">Amount</th>
                  <th className="px-3 py-2 text-left">Recorded by</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {expenses.length === 0 ? (
                  <tr><td colSpan={showSlipItemNames ? 8 : 7} className="px-3 py-6 text-center text-gray-400">No expenses in this range</td></tr>
                ) : expenses.map((e, i) => (
                  <tr key={e.id} className="hover:bg-amber-50/40">
                    <td className="px-3 py-2 text-gray-500">{i + 1}</td>
                    <td className="px-3 py-2 whitespace-nowrap tabular-nums">{e.paid_at ? formatDateTime(e.paid_at) : '—'}</td>
                    <td className="px-3 py-2 font-mono text-xs font-semibold text-amber-800">{e.slip_number || '—'}</td>
                    <td className="px-3 py-2 font-medium">{e.paid_to || '—'}</td>
                    {showSlipItemNames && (
                      <td className="px-3 py-2 text-xs text-gray-700 max-w-[220px]">
                        {getExpenseItemNames(e)}
                      </td>
                    )}
                    <td className="px-3 py-2 uppercase text-xs">{e.payment_mode || '—'}</td>
                    <td className="px-3 py-2 text-right font-bold text-amber-700 tabular-nums">₹{fmtMoney(e.total_amount)}</td>
                    <td className="px-3 py-2 text-xs">{e.recorded_by_name || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}
        </div>
      </div>
    </div>
    {printPreview && (
      <ReportPrintPreviewModal
        title={printPreview.title}
        html={printPreview.html}
        onClose={() => setPrintPreview(null)}
      />
    )}
    </>
  )
}
