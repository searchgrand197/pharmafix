import React, { memo, useCallback, useMemo, useRef, useState } from 'react'
import { Search, Trash2 } from 'lucide-react'
import { PurchaseSupplierPicker } from './PurchaseSupplierPicker'
import api from '../api'
import toast from 'react-hot-toast'
import { withTimeTokens } from '../utils/dateTimeFormat'
import { format, isValid, parseISO } from 'date-fns'
import {
  computeInvoiceRoundOff,
  computeMargGstOnBase,
  computeSaleGstTotals,
  isPartialPercentInput,
  lineDiscountRupeesFromPercent,
  lineSaleBaseAmount,
  lineSellingRateDisplay,
  normalizePercentInputString,
  parseApiError,
  parseCompletePercentInput,
  parseOutletDefaultGstPercent,
  resolveEffectiveGstPercent,
} from './pharmacyCalculations'
import { useDebouncedValue } from './useDebouncedValue'
import {
  computeBaseQtyFromPacksLoose,
  expiryBadgeClass,
  expiryMeta,
  formatBillQtyForOutlet,
  medicineBillAlias,
  medicineBillName,
  medicineNickName,
  qtySuffixFromMedicine,
  sanitizePackLooseInput,
} from './billingUtils'
import { resolveCategoryRules } from './categoryRulePresets'
import { categoryPathFromId } from './pharmacyCategoryNames'
import { resolveOutletForChannel } from './outletSettingsUtils'

const MIN_ROWS = 5
const TAIL_EMPTY = 1

function newBillingRowId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `br-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

/** # | Product | Batch | HSN | PACK | EXP | MRP | Pack | Loose | Disc | Rate | GST | Margin | Amount | Del */
const GRID_BILL =
  'grid-cols-[1.25rem_minmax(0,2fr)_1.1fr_0.9fr_0.9fr_0.9fr_0.9fr_0.8fr_0.8fr_0.9fr_0.8fr_0.8fr_0.9fr_1fr_1.25rem]'

const INP_NUM = 'w-full min-w-0 bg-transparent text-right tabular-nums text-[11px] outline-none py-1 px-1'
const CELL_NUM = 'px-0.5 text-right tabular-nums border-r border-slate-100 flex items-center justify-end min-w-0'
const CELL_INP_WRAP = 'px-0.5 border-r border-slate-100 flex items-center justify-end min-w-0'

const RupeesCell = memo(function RupeesCell({ value }) {
  if (value === null || value === undefined || value === '') return null
  const n = Number(value)
  if (!Number.isFinite(n)) return null
  return (
    <div className={`${CELL_NUM} font-semibold text-slate-900`}>
      <div className="flex w-full justify-end items-center gap-0.5">
        <span className="text-slate-500 shrink-0 text-[8px]">₹</span>
        <span className="tabular-nums text-[9px]">{n.toFixed(2)}</span>
      </div>
    </div>
  )
})

function safeFormat(dateVal, fmtStr) {
  if (!dateVal) return '--/--'
  try {
    let d
    if (typeof dateVal === 'string' && /^\d{4}-\d{2}-\d{2}/.test(dateVal.trim())) {
      d = parseISO(dateVal.trim().slice(0, 10))
    } else {
      d = new Date(dateVal)
    }
    if (!isValid(d)) return '--/--'
    return format(d, withTimeTokens(fmtStr))
  } catch {
    return '--/--'
  }
}

function invoiceDateTimeInputToIso(dateValue, timeValue) {
  if (!dateValue) return null
  const normalizedTime = timeValue || '00:00'
  const d = new Date(`${dateValue}T${normalizedTime}`)
  if (Number.isNaN(d.getTime())) return null
  return d.toISOString()
}

function preferredPackFromConversions(conversions = {}) {
  const c = conversions && typeof conversions === 'object' ? conversions : {}
  const tiers = [
    ['box', 'BOX'],
    ['carton', 'CARTON'],
    ['strip', 'STRIP'],
  ]
  for (const [low, up] of tiers) {
    const n = Number(c[low] ?? c[up]) || 0
    if (n > 0) {
      const labelKey = c[low] != null && c[low] !== '' ? low : up
      return { perPack: n, label: String(labelKey).toLowerCase() }
    }
  }
  return { perPack: 0, label: 'pack' }
}

function inventoryQtyLabelsForSale(medicine, categoryRows = []) {
  const rules = resolveCategoryRules(medicine?.form, categoryRows)
  const fromCat = String(rules.base_unit_label || '').trim()
  const baseLabel = (fromCat || String(medicine?.unit_name || 'unit').trim() || 'unit').toLowerCase()
  const conv = medicine?.unit_conversions || {}
  const packPref = preferredPackFromConversions(conv)
  const retail = String(rules.retail_pack_label || '').trim().toLowerCase()
  const packLabel =
    retail && ['strip', 'box', 'carton'].includes(packPref.label) ? retail : packPref.label
  return { baseLabel, packLabel, perPack: packPref.perPack }
}

function formatStockByCategoryRules(stock, pick, categoryRows = []) {
  const qty = Number(stock) || 0
  const { baseLabel, packLabel, perPack } = inventoryQtyLabelsForSale(pick?.medicine, categoryRows)
  if (qty <= 0) return `0 ${baseLabel}`
  if (!(perPack > 1)) {
    const n = qty % 1 === 0 ? qty : Number(qty.toFixed(2))
    return `${n} ${baseLabel}`
  }
  const packs = Math.floor(qty / perPack)
  const rem = Math.round((qty - packs * perPack) * 100) / 100
  const parts = []
  if (packs > 0) parts.push(`${packs} ${packLabel}${packs === 1 ? '' : 's'}`)
  if (rem > 0) parts.push(`${rem % 1 === 0 ? rem : Number(rem.toFixed(2))} ${baseLabel}`)
  return parts.length ? parts.join(' + ') : `0 ${baseLabel}`
}

/** Discount % between batch MRP and selling rate: ((MRP − rate) / MRP) × 100, rounded to 2 decimals. */
function discountPercentFromMrpAndRate(mrp, rate) {
  const m = Number(mrp) || 0
  const rt = Number(rate) || 0
  if (!(m > 0)) return 0
  const raw = ((m - rt) / m) * 100
  if (!Number.isFinite(raw)) return 0
  return Math.min(100, Math.max(0, Math.round(raw * 100) / 100))
}

function createNewRow() {
  return {
    id: newBillingRowId(),
    medicine: null,
    batch: null,
    packs: '',
    loose: '',
    pack_size: 1,
    qty: 0,
    free_qty: 0,
    rate: 0,
    amount: 0,
    hsn: '',
    pack: '',
    gst_percent: '',
    gst_type: 'exclusive',
    no_gst: false,
    line_discount: 0,
    discount_user_set: false,
    expiry_status: null,
  }
}

function normalizeRows(rows, createRow) {
  let lastMed = -1
  for (let i = 0; i < rows.length; i++) {
    if (rows[i]?.medicine) lastMed = i
  }
  const target = lastMed < 0 ? MIN_ROWS : Math.max(MIN_ROWS, lastMed + 1 + TAIL_EMPTY)
  const next = [...rows]
  while (next.length < target) next.push(createRow())
  return next
}

function clearRowByIdAndNormalize(id, setRows, setActiveRow) {
  setRows((prev) => {
    const idx = prev.findIndex((r) => r.id === id)
    if (idx < 0) return prev
    const next = [...prev]
    next[idx] = { ...createNewRow(), id }
    const normalized = normalizeRows(next, createNewRow)
    const nextLen = next.length
    queueMicrotask(() => {
      setActiveRow((ar) => {
        if (ar === idx) return idx
        return Math.min(ar, Math.max(0, nextLen - 1))
      })
    })
    return normalized
  })
}

function rowExpiryStatus(row) {
  if (row.expiry_status) return row.expiry_status
  return expiryMeta(row.batch?.expiry_date).status
}

const SearchHitRow = memo(function SearchHitRow({ pick, disabled, onPick, categoryRows }) {
  const categoryPath = React.useMemo(() => {
    const catId = pick?.medicine?.category
    if (catId) return categoryPathFromId(catId, categoryRows)
    return ''
  }, [pick?.medicine?.category, categoryRows])
  const st = pick.expiry_status
  const badge =
    st === 'expired' ? (
      <span className="text-[7px] font-bold px-1 py-0.5 rounded border bg-rose-100 text-rose-800 border-rose-200">EXP</span>
    ) : st === 'expiring' ? (
      <span className="text-[7px] font-bold px-1 py-0.5 rounded border bg-amber-100 text-amber-900 border-amber-200">60d</span>
    ) : (
      <span className="text-[7px] text-slate-300">·</span>
    )
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => onPick(pick)}
      className={`w-full text-left px-3 py-2 hover:bg-blue-50 hover:border-l-2 hover:border-l-blue-500 flex gap-2 items-start border-b border-slate-100 transition-colors ${disabled ? 'opacity-40 cursor-not-allowed' : ''}`}
    >
      <div className="min-w-0 flex-1">
        <div className="font-semibold text-[12px] uppercase text-slate-900 truncate">
          {medicineNickName(pick.medicine)}
          {medicineBillAlias(pick.medicine) ? (
            <span className="normal-case text-slate-400 font-normal ml-1">
              ({medicineBillAlias(pick.medicine)})
            </span>
          ) : null}
        </div>
        {categoryPath ? (
          <div className="text-[9px] text-slate-400 truncate mt-0.5" title={categoryPath}>
            {categoryPath}
          </div>
        ) : null}
        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] text-slate-600">
          <span className="font-mono bg-slate-100 px-1.5 py-0.5 rounded">Batch {pick.batch.batch_no}</span>
          {pick.medicine.form ? (
            <span className="bg-violet-50 text-violet-700 border border-violet-100 px-1.5 py-0.5 rounded">
              {pick.medicine.form}
            </span>
          ) : null}
          <span className="font-medium whitespace-nowrap">
            Exp {safeFormat(pick.batch.expiry_date, 'dd/MM/yyyy')}
          </span>
        </div>
        <div className="mt-0.5 text-[10px] font-semibold text-emerald-800 tabular-nums">
          Qty available (inventory): {formatStockByCategoryRules(pick.batch?.stock, pick, categoryRows)}
        </div>
      </div>
      <div className="shrink-0 flex flex-col items-end gap-1">
        {badge}
        <span className="text-[12px] font-semibold tabular-nums text-blue-700">₹{Number(pick.batch.sale_rate).toFixed(2)}</span>
      </div>
    </button>
  )
})

function mergePatientDetailsForInvoice(selectedPt, fromApi) {
  if (!selectedPt) return fromApi || null
  const base = fromApi && typeof fromApi === 'object' ? { ...fromApi } : {}
  return {
    ...base,
    ...selectedPt,
    phone: String(selectedPt.phone ?? base.phone ?? '').trim(),
    address_line1: String(selectedPt.address_line1 ?? base.address_line1 ?? '').trim(),
    city: String(selectedPt.city ?? base.city ?? '').trim(),
    state: String(selectedPt.state ?? base.state ?? '').trim(),
    _walkInBilling: Boolean(selectedPt._walkInBilling),
  }
}

function ErpBillingViewInner({
  medicines: _medicines,
  batches: _batches,
  setInvoices,
  setPrintingInvoice,
  setShowAddMedicine,
  openAddPatient,
  fetchInitialData,
  selectedPt,
  setSelectedPt,
  outletSettings,
  draftInvoiceToLoad,
  setDraftInvoiceToLoad,
}) {
  const now = new Date()
  const defaultInvoiceDate = format(now, 'yyyy-MM-dd')
  const defaultInvoiceTime = format(now, 'HH:mm')
  const [rows, setRows] = useState(() => normalizeRows(Array.from({ length: MIN_ROWS }, () => createNewRow()), createNewRow))
  const [activeRow, setActiveRow] = useState(0)
  const [activeField, setActiveField] = useState(null)
  const b2bEnabled = !!outletSettings?.b2b_enabled
  const channelOutlet = useMemo(
    () => resolveOutletForChannel(outletSettings, b2bEnabled ? 'b2b' : 'b2c'),
    [outletSettings, b2bEnabled],
  )
  const [partyId, setPartyId] = useState(null)
  const [partyName, setPartyName] = useState('')
  const [partyDetails, setPartyDetails] = useState(null)
  const [ptSearch, setPtSearch] = useState('')
  const debouncedPtSearch = useDebouncedValue(ptSearch, 320)
  const [ptResults, setPtResults] = useState([])
  const [pSearch, setPSearch] = useState('')
  const debouncedPSearch = useDebouncedValue(pSearch, 260)
  const [searchResults, setSearchResults] = useState([])
  const [searchLoading, setSearchLoading] = useState(false)
  /** When set, this row shows product search to replace medicine/batch (same row id). */
  const [replacingRowId, setReplacingRowId] = useState(null)
  const [gstEnabled, setGstEnabled] = useState(() => !!channelOutlet?.default_sale_gst_enabled)
  const [invoiceNo, setInvoiceNo] = useState('')
  const [invoiceDate, setInvoiceDate] = useState(defaultInvoiceDate)
  const [invoiceTime, setInvoiceTime] = useState(defaultInvoiceTime)
  const [allowExpiredSale, setAllowExpiredSale] = useState(false)
  const [paymentMethod, setPaymentMethod] = useState('cash')
  const [paidAmount, setPaidAmount] = useState('')
  const [billDiscountPercent, setBillDiscountPercent] = useState('')
  const [linkedAdmission, setLinkedAdmission] = useState(null)
  const [activeAdmissionByPatientId, setActiveAdmissionByPatientId] = useState({})
  const [doctorProfileIdByUserId, setDoctorProfileIdByUserId] = useState({})
  const [medicineCategoryRows, setMedicineCategoryRows] = useState([])

  const productRefs = useRef({})
  const packRefs = useRef({})
  const looseRefs = useRef({})
  const rateRefs = useRef({})
  const discRefs = useRef({})
  const gstRefs = useRef({})
  const patientSearchRef = useRef(null)

  const focusPatientSearch = useCallback(() => {
    if (b2bEnabled) return
    window.setTimeout(() => patientSearchRef.current?.focus(), 0)
  }, [b2bEnabled])

  const refreshInvoiceNo = useCallback(() => {
    const channel = b2bEnabled ? 'b2b' : 'b2c'
    api
      .get(`/pharmacy/invoice/next-number/?channel=${channel}`)
      .then((res) => {
        const d = res.data?.data ?? res.data
        setInvoiceNo(d?.invoice_no || '')
      })
      .catch(() => {})
  }, [b2bEnabled])

  React.useEffect(() => {
    refreshInvoiceNo()
  }, [refreshInvoiceNo])

  React.useEffect(() => {
    if (!b2bEnabled && !selectedPt) {
      focusPatientSearch()
    }
  }, [b2bEnabled, selectedPt, focusPatientSearch])

  React.useEffect(() => {
    setGstEnabled(!!channelOutlet?.default_sale_gst_enabled)
  }, [channelOutlet?.default_sale_gst_enabled])

  React.useEffect(() => {
    if (debouncedPtSearch.length <= 2) {
      setPtResults([])
      setActiveAdmissionByPatientId({})
      return
    }
    let cancelled = false
    Promise.all([
      api.get(`/patients/?search=${encodeURIComponent(debouncedPtSearch)}&limit=8`),
      api.get('/ipd-admissions/?status=admitted&limit=500').catch(() => ({ data: [] })),
    ])
      .then(([ptRes, adRes]) => {
        if (cancelled) return
        const pts = ptRes.data?.data || ptRes.data?.results || []
        setPtResults(pts)
        const admissions = adRes.data?.data || adRes.data?.results || []
        const amap = {}
        if (Array.isArray(admissions)) {
          admissions.forEach((a) => {
            if (a?.status === 'admitted' && a?.patient) {
              amap[String(a.patient)] = a
            }
          })
        }
        setActiveAdmissionByPatientId(amap)
      })
      .catch(() => {
        if (!cancelled) {
          setPtResults([])
          setActiveAdmissionByPatientId({})
        }
      })
    return () => {
      cancelled = true
    }
  }, [debouncedPtSearch])

  React.useEffect(() => {
    let cancelled = false
    api
      .get('/doctor-profiles/', { params: { limit: 500 } })
      .then((res) => {
        if (cancelled) return
        const rows = res.data?.data || res.data?.results || []
        const map = {}
        if (Array.isArray(rows)) {
          rows.forEach((doc) => {
            if (doc?.user && doc?.id) {
              map[String(doc.user)] = doc.id
            }
          })
        }
        setDoctorProfileIdByUserId(map)
      })
      .catch(() => {
        if (!cancelled) setDoctorProfileIdByUserId({})
      })
    return () => {
      cancelled = true
    }
  }, [])

  React.useEffect(() => {
    if (debouncedPSearch.length < 2) {
      setSearchResults([])
      return
    }
    let cancelled = false
    setSearchLoading(true)
    api
      .get('/medicines/search/', { params: { q: debouncedPSearch } })
      .then((res) => {
        if (cancelled) return
        const raw = res.data?.data ?? res.data
        setSearchResults(Array.isArray(raw) ? raw : [])
      })
      .catch(() => {
        if (!cancelled) setSearchResults([])
      })
      .finally(() => {
        if (!cancelled) setSearchLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [debouncedPSearch])

  React.useEffect(() => {
    if (!selectedPt?.id) {
      setLinkedAdmission(null)
      return
    }
    let cancelled = false
    api
      .get('/ipd-admissions/', { params: { status: 'admitted', limit: 500 } })
      .then((res) => {
        if (cancelled) return
        const rows = res.data?.data || res.data?.results || []
        const active = Array.isArray(rows)
          ? rows.find((a) => String(a.patient) === String(selectedPt.id) && a.status === 'admitted')
          : null
        setLinkedAdmission(active || null)
      })
      .catch(() => {
        if (!cancelled) setLinkedAdmission(null)
      })
    return () => {
      cancelled = true
    }
  }, [selectedPt?.id])

  React.useEffect(() => {
    let cancelled = false
    api
      .get('/medicine-categories/?limit=500')
      .then((res) => {
        if (cancelled) return
        const rows = res.data?.data || res.data?.results || []
        setMedicineCategoryRows(Array.isArray(rows) ? rows : [])
      })
      .catch(() => {
        if (!cancelled) setMedicineCategoryRows([])
      })
    return () => {
      cancelled = true
    }
  }, [])

  const defaultGst = parseOutletDefaultGstPercent(channelOutlet?.default_gst_percent)

  const patchRowById = useCallback((rowId, partial) => {
    setRows((prev) => {
      const ix = prev.findIndex((r) => r.id === rowId)
      if (ix < 0) return prev
      const merged = { ...prev[ix], ...partial }
      // Only blank loose when user explicitly edits packs on a single-unit medicine.
      // Do NOT blank it unconditionally — draft-loaded loose values must survive.
      if (Number(merged.pack_size) <= 1 && 'packs' in partial) {
        merged.loose = ''
      }
      if ('packs' in partial || 'loose' in partial || 'pack_size' in partial) {
        const { qty, freeQty } = computeBaseQtyFromPacksLoose(merged.packs, merged.loose, merged.pack_size)
        merged.qty = qty
        merged.free_qty = freeQty
      }
      const mrpNum = Number(merged.batch?.mrp)
      const hasMrp = Number.isFinite(mrpNum) && mrpNum > 0 && merged.medicine
      if (hasMrp) {
        if ('line_discount' in partial) {
          const pRaw = merged.line_discount
          if (!(typeof pRaw === 'string' && isPartialPercentInput(pRaw))) {
            const p = parseCompletePercentInput(pRaw) ?? 0
            merged.line_discount = p
            merged.rate = Math.round(mrpNum * (1 - p / 100) * 100) / 100
          }
        } else if ('rate' in partial) {
          merged.line_discount = discountPercentFromMrpAndRate(mrpNum, Number(merged.rate) || 0)
        }
      }
      const nr = [...prev]
      nr[ix] = merged
      return normalizeRows(nr, createNewRow)
    })
  }, [])

  const { taxableSubtotal, gst, grandTotal, cgst, sgst } = useMemo(
    () => computeSaleGstTotals(rows, defaultGst, gstEnabled),
    [rows, defaultGst, gstEnabled],
  )
  const billDiscountAmount = useMemo(() => {
    const pct = parseCompletePercentInput(billDiscountPercent)
    if (pct == null || pct <= 0) return 0
    return Math.round((grandTotal * pct) / 100 * 100) / 100
  }, [billDiscountPercent, grandTotal])
  const netGrandTotal = useMemo(
    () => Math.max(0, Math.round((grandTotal - billDiscountAmount) * 100) / 100),
    [grandTotal, billDiscountAmount],
  )
  /** Retail bills settle in whole rupees; party (B2B / GST) bills stay exact. */
  const { payable: payableTotal, roundOff } = useMemo(
    () => (b2bEnabled ? { payable: netGrandTotal, roundOff: 0 } : computeInvoiceRoundOff(netGrandTotal)),
    [netGrandTotal, b2bEnabled],
  )

  /** List-side gross: qty×selling rate — matches billing GST base. */
  const lineGrossTotal = useMemo(() => {
    let gross = 0
    for (const r of rows) {
      if (!r?.medicine) continue
      if (!(Number(r.qty) > 0)) continue
      gross += lineSaleBaseAmount(r)
    }
    return Math.round(gross * 100) / 100
  }, [rows])

  React.useEffect(() => {
    if (paymentMethod === 'credit' && linkedAdmission) {
      setPaidAmount('0.00')
      return
    }
    setPaidAmount(payableTotal.toFixed(2))
  }, [paymentMethod, payableTotal, linkedAdmission])

  React.useEffect(() => {
    if (!linkedAdmission && paymentMethod === 'credit') {
      setPaymentMethod('cash')
    }
  }, [linkedAdmission, paymentMethod])

  // Broadcast current bill to sales-display tab via localStorage
  React.useEffect(() => {
    const activeLines = rows.filter(
      (r) => r.medicine && (Number(r.qty) > 0 || Number(r.free_qty) > 0),
    )
    if (!activeLines.length && !selectedPt && !partyId) {
      localStorage.removeItem('pharmacy_bill_display')
      return
    }
    localStorage.setItem('pharmacy_bill_display', JSON.stringify({
      pharmacyName: channelOutlet?.business_name || outletSettings?.business_name || 'Pharmacy',
      customerName: b2bEnabled
        ? partyName
        : selectedPt ? `${selectedPt.first_name} ${selectedPt.last_name}` : '',
      customerDetails: b2bEnabled
        ? {
            type: 'party',
            id: partyId || '',
            phone: partyDetails?.phone || '',
            address: partyDetails?.address || '',
            gst_number: partyDetails?.gst_number || '',
            dl_number: partyDetails?.dl_number || '',
          }
        : selectedPt
          ? {
              type: 'patient',
              phone: selectedPt.phone || '',
              uhid: selectedPt.uhid || '',
              age: selectedPt.age ?? '',
              gender: selectedPt.gender || '',
            }
          : null,
      lines: activeLines.map((r) => {
        const netAmount = Math.round(Number(r.qty) * Number(r.rate) * 100) / 100
        const mrp = Number(r.batch?.mrp) || null
        const discPct = parseCompletePercentInput(r.line_discount) ?? (Number(r.line_discount) || 0)
        const packSize = Math.max(1, Number(r.pack_size) || 1)
        const qtyDisplayMode =
          channelOutlet?.sale_bill_qty_display === 'pack_and_loose' ? 'pack_and_loose' : 'base_units'
        const qtyLabel = formatBillQtyForOutlet({
          mode: qtyDisplayMode,
          packs: r.packs,
          loose: r.loose,
          qty: r.qty,
          freeQty: r.free_qty || 0,
          packSize,
          baseSuffix: qtySuffixFromMedicine(r.medicine),
        })
        return {
          name: medicineBillName(r.medicine) || r.medicine?.name || '',
          qty: r.qty,
          qtyLabel,
          mrp: mrp,
          rate: r.rate,
          discountPct: discPct,
          amount: netAmount,
        }
      }),
      subtotal: taxableSubtotal,
      cgst,
      sgst,
      roundOff,
      grandTotal: payableTotal,
      updatedAt: Date.now(),
    }))
  }, [rows, selectedPt, partyId, partyName, partyDetails, payableTotal, roundOff, taxableSubtotal, cgst, sgst, channelOutlet, outletSettings, b2bEnabled])

  React.useEffect(() => {
    if (!replacingRowId) return
    const t = window.setTimeout(() => {
      productRefs.current[replacingRowId]?.focus()
    }, 0)
    return () => window.clearTimeout(t)
  }, [replacingRowId])

  React.useEffect(() => {
    if (!replacingRowId) return
    const ix = rows.findIndex((r) => r.id === replacingRowId)
    if (ix < 0) {
      setReplacingRowId(null)
      return
    }
    if (activeRow !== ix) {
      setReplacingRowId(null)
      setPSearch('')
      setSearchResults([])
    }
  }, [activeRow, rows, replacingRowId])

  React.useEffect(() => {
    if (!draftInvoiceToLoad) return

    // ── Auto-select patient or party from draft ──────────────────────────────
    setPartyId(null)
    setPartyName('')
    setPartyDetails(null)
    const pd = draftInvoiceToLoad.patient_details
    if (pd && pd.id) {
      setSelectedPt({
        id: pd.id,
        name: `${pd.first_name || ''} ${pd.last_name || ''}`.trim(),
        phone: pd.phone || '',
        uhid: pd.uhid || '',
        age: pd.age || '',
        gender: pd.gender || '',
        ...pd,
      })
    }
    // Load party if the draft was a B2B invoice
    if (draftInvoiceToLoad.party) {
      setPartyId(draftInvoiceToLoad.party)
      setPartyName(draftInvoiceToLoad.party_name || draftInvoiceToLoad.party_name_snapshot || '')
      setPartyDetails(
        draftInvoiceToLoad.party_details ||
          (typeof draftInvoiceToLoad.party === 'object' ? draftInvoiceToLoad.party : null),
      )
    }

    // ── Map inline items (already in invoice serializer response) ────────────
    const draftItems = Array.isArray(draftInvoiceToLoad.items) ? draftInvoiceToLoad.items : []
    if (draftItems.length === 0) {
      toast('Draft has no medicines', { icon: '⚠️' })
      return
    }

    const newRows = draftItems.map(item => {
      const mId = typeof item.medicine === 'object' ? item.medicine?.id : item.medicine
      const bId = typeof item.batch === 'object' ? item.batch?.id : item.batch

      // Try to find full objects from already-loaded portal data (may be empty if cross-hospital)
      const m = _medicines.find(x => x.id === mId) || {
        id: mId,
        name: item.medicine_name || 'Unknown',
        pack_size: 1,
        hsn_code: '',
        pack_info: '',
        gst_percent: '0',
        unit_conversions: {},
      }
      const b = _batches.find(x => x.id === bId) || {
        id: bId,
        batch_no: item.batch_no || item.snapshot_batch_no || '',
        sale_rate: item.rate || '0',
        mrp: item.mrp || '0',
        expiry_date: item.expiry_date || item.snapshot_expiry_date || null,
      }

      const qty = Number(item.qty) || 0
      const packSize = Math.max(1, Number(m?.pack_size) || 1)

      // Doctors always prescribe in individual/loose units — always populate 'loose'.
      // qty is also set directly so amount calculation works immediately.
      // For single-unit medicines (pack_size=1) the loose field is visually hidden
      // but qty on the row is still correct for billing.
      return {
        id: newBillingRowId(),
        medicine: m,
        batch: b,
        packs: '',
        loose: String(qty),
        pack_size: packSize,
        qty: qty,
        rate: Number(b?.sale_rate || item.rate || 0),
        amount: 0,
        hsn: m?.hsn_code || '',
        pack: m?.pack_info || '',
        gst_percent: m?.gst_percent != null ? String(m.gst_percent) : '',
        gst_type: 'exclusive',
        no_gst: false,
        line_discount: discountPercentFromMrpAndRate(b?.mrp, b?.sale_rate),
        discount_user_set: false,
        expiry_status: null,
      }
    })

    setRows(normalizeRows(newRows, createNewRow))
    toast.success(`Loaded ${draftItems.length} medicine(s) from draft`)
  }, [draftInvoiceToLoad, setSelectedPt])


  const lineMarg = useMemo(() => {
    return rows.map((r) => {
      if (!r.medicine || !(Number(r.qty) > 0)) return null
      const base = lineSaleBaseAmount(r)
      const disc = lineDiscountRupeesFromPercent(r)
      if (!gstEnabled) {
        return computeMargGstOnBase({
          baseAmount: base,
          discount: disc,
          gstType: 'exclusive',
          gstPercent: 0,
          noGst: false,
        })
      }
      const resolved = resolveEffectiveGstPercent({
        rowGst: r.gst_percent,
        productGst: r.medicine?.gst_percent,
        defaultGst,
        noGst: !!r.no_gst,
      })
      return computeMargGstOnBase({
        baseAmount: base,
        discount: disc,
        gstType: r.gst_type,
        gstPercent: resolved,
        noGst: !!r.no_gst,
      })
    })
  }, [rows, defaultGst, gstEnabled])

  const applySearchPick = useCallback((rowId, pick) => {
    const batchId = pick.batch.id
    setRows((prev) => {
      if (prev.some((r) => r.id !== rowId && String(r.batch?.id) === String(batchId))) {
        toast.error('This batch is already on the bill')
        return prev
      }
      const m = {
        id: pick.medicine.id,
        name: pick.medicine.name,
        name_on_bill: pick.medicine.name_on_bill || '',
        category: pick.medicine.category,
        sku: pick.medicine.sku,
        pack_info: pick.medicine.pack_info,
        form: pick.medicine.form,
        hsn_code: pick.medicine.hsn_code,
        gst_percent: pick.medicine.gst_percent,
        unit_conversions: pick.medicine.unit_conversions,
        unit_name: pick.medicine.unit_name,
        pack_size: pick.medicine.pack_size,  // ← needed so isSingleUnitPack can fall back to this
      }
      const b = {
        id: pick.batch.id,
        medicine: m.id,
        batch_no: pick.batch.batch_no,
        expiry_date: pick.batch.expiry_date,
        mrp: pick.batch.mrp,
        unit_cost: pick.batch.unit_cost,
        sale_rate: pick.batch.sale_rate,
        quantity: pick.batch.stock,
      }
      const ix = prev.findIndex((r) => r.id === rowId)
      if (ix < 0) return prev
      const packSize = Math.max(1, Number(pick.medicine.pack_size) || 1)
      const saleRate = Number(b.sale_rate) || 0
      const merged = {
        ...prev[ix],
        medicine: m,
        batch: b,
        packs: '',
        loose: '',
        pack_size: packSize,
        qty: 0,
        expiry_status: pick.expiry_status,
        hsn: m.hsn_code,
        pack: m.pack_info,
        rate: saleRate,
        line_discount: discountPercentFromMrpAndRate(b.mrp, saleRate),
        discount_user_set: false,
        gst_percent: m.gst_percent !== undefined && m.gst_percent !== null ? String(m.gst_percent) : '',
      }
      const nr = [...prev]
      nr[ix] = merged
      return normalizeRows(nr, createNewRow)
    })
    setReplacingRowId(null)
    setPSearch('')
    setSearchResults([])
    const pickedPackSize = Math.max(1, Number(pick?.medicine?.pack_size) || 1)
    setActiveField(pickedPackSize > 1 ? 'loose' : 'packs')
    // Give React time to re-render the row (loose input only mounts when pack_size > 1)
    const focusWithRetry = (attempts = 0) => {
      setTimeout(() => {
        if (pickedPackSize > 1) {
          const el = looseRefs.current[rowId]
          if (el) { el.focus(); return }
          if (attempts < 8) focusWithRetry(attempts + 1)
        } else {
          packRefs.current[rowId]?.focus()
        }
      }, attempts === 0 ? 80 : 60)
    }
    focusWithRetry()
  }, [])

  function handleRowEnter(e, rowId, field) {
    const idx = rows.findIndex((r) => r.id === rowId)
    if (idx < 0) return
    if (e.key === 'Enter') {
      e.preventDefault()
      if (field === 'product') {
        const first =
          searchResults.find((p) => !(p.expiry_status === 'expired' && !allowExpiredSale)) ?? null
        if (first) applySearchPick(rowId, first)
      } else if (field === 'packs') {
        const row = rows[idx]
        if ((Number(row?.pack_size) || 1) <= 1) {
          setTimeout(() => discRefs.current[rowId]?.focus(), 40)
        } else {
          setTimeout(() => looseRefs.current[rowId]?.focus(), 40)
        }
      } else if (field === 'loose') {
        setTimeout(() => discRefs.current[rowId]?.focus(), 40)
      } else if (field === 'disc') {
        setTimeout(() => rateRefs.current[rowId]?.focus(), 40)
      } else if (field === 'rate') {
        setTimeout(() => gstRefs.current[rowId]?.focus(), 40)
      } else if (field === 'gst') {
        if (idx < rows.length - 1) {
          const nextId = rows[idx + 1].id
          setActiveRow(idx + 1)
          setActiveField('product')
          setTimeout(() => productRefs.current[nextId]?.focus(), 50)
        }
      }
    }
    if (e.key === 'ArrowDown' && field === 'product' && idx < rows.length - 1) {
      e.preventDefault()
      const nextId = rows[idx + 1].id
      setActiveRow(idx + 1)
      setTimeout(() => productRefs.current[nextId]?.focus(), 0)
    }
    if (e.key === 'ArrowUp' && field === 'product' && idx > 0) {
      e.preventDefault()
      const prevId = rows[idx - 1].id
      setActiveRow(idx - 1)
      setTimeout(() => productRefs.current[prevId]?.focus(), 0)
    }
  }

  async function handleSave() {
    if (b2bEnabled ? !partyId : !selectedPt) {
      toast.error(b2bEnabled ? 'Select Party' : 'Select Patient')
      return
    }
    const valid = rows.filter(
      (r) => r.medicine && r.batch && (Number(r.qty) > 0 || Number(r.free_qty) > 0),
    )
    if (!valid.length) {
      toast.error('No items')
      return
    }
    if (paymentMethod !== 'credit') {
      const paid = Number(paidAmount || 0)
      if (Math.abs(paid - payableTotal) > 0.009) {
        toast.error('For cash/upi/other, full amount must be paid')
        return
      }
    }

    let createdInvoice = null
    try {
      if (draftInvoiceToLoad?.id) {
        // Clean up draft before finalizing to prevent duplicate invoice numbers or logic tangles
        await api.delete(`/pharmacy/invoices/${draftInvoiceToLoad.id}/`).catch(() => {})
        setDraftInvoiceToLoad(null)
      }

      const walkInMeta = !b2bEnabled && selectedPt?._walkInBilling
      const invoiceDatetimeIso = invoiceDateTimeInputToIso(invoiceDate, invoiceTime)
      const { data: invData } = await api.post('/pharmacy/invoices/', {
        patient: b2bEnabled ? null : selectedPt.id,
        party: b2bEnabled ? partyId : null,
        ipd_admission: b2bEnabled ? null : (linkedAdmission?.id || null),
        // IPD assigned_doctor is a User id; invoice referred_by expects DoctorProfile id.
        referred_by: b2bEnabled ? null : (doctorProfileIdByUserId[String(linkedAdmission?.assigned_doctor || '')] || null),
        billing_doctor_name: walkInMeta ? (selectedPt._billingDoctorName || '') : '',
        billing_hospital_name: walkInMeta ? (selectedPt._billingHospitalName || '') : '',
        invoice_no: invoiceNo || undefined,
        date: invoiceDate || undefined,
        ...(invoiceDatetimeIso ? { invoice_datetime: invoiceDatetimeIso } : {}),
        gst_enabled: gstEnabled,
        subtotal: taxableSubtotal.toFixed(2),
        cgst: cgst.toFixed(2),
        sgst: sgst.toFixed(2),
        round_off: roundOff.toFixed(2),
        grand_total: payableTotal.toFixed(2),
        payment_method: paymentMethod,
        paid_amount: paymentMethod === 'credit' ? '0.00' : payableTotal.toFixed(2),
        status: 'finalized',
      })
      const invoice = invData?.data || invData
      createdInvoice = invoice
      const allowQ = allowExpiredSale ? { allow_expired: '1' } : {}
      const itemResults = []
      for (const r of valid) {
        const base = lineSaleBaseAmount(r)
        const disc = lineDiscountRupeesFromPercent(r)
        let marg
        let half = 0
        if (!gstEnabled) {
          marg = computeMargGstOnBase({
            baseAmount: base,
            discount: disc,
            gstType: 'exclusive',
            gstPercent: 0,
            noGst: false,
          })
        } else {
          const resolved = resolveEffectiveGstPercent({
            rowGst: r.gst_percent,
            productGst: r.medicine?.gst_percent,
            defaultGst,
            noGst: !!r.no_gst,
          })
          marg = computeMargGstOnBase({
            baseAmount: base,
            discount: disc,
            gstType: r.gst_type,
            gstPercent: resolved,
            noGst: !!r.no_gst,
          })
          half = resolved / 2
        }
        const posted = await api.post(
          '/pharmacy/items/',
          {
            invoice: invoice.id,
            medicine: r.medicine.id,
            batch: r.batch.id,
            qty: r.qty,
            free_qty: r.free_qty || 0,
            mrp: r.batch?.mrp ?? 0,
            rate: r.rate,
            amount: marg.taxableAmount.toFixed(2),
            cgst_rate: half.toFixed(2),
            sgst_rate: half.toFixed(2),
          },
          { params: allowQ },
        )
        itemResults.push(posted)
      }
      const builtItems = itemResults.map((res, i) => {
        const saved = res.data?.data || res.data
        const r = valid[i]
        return {
          ...r,
          ...saved,
          pack_size: r.pack_size,
          pack_info: r.pack || r.medicine?.pack_info || '',
          medicine: {
            ...r.medicine,
            pack_info: r.pack || r.medicine?.pack_info || '',
          },
          batch: r.batch,
          packs_display: r.packs,
          loose_display: r.loose,
          pack_size: r.pack_size,
          free_qty: r.free_qty || 0,
        }
      })
      let invForPrint = invoice
      try {
        const { data: fullRes } = await api.get(`/pharmacy/invoices/${invoice.id}/`)
        invForPrint = fullRes?.data || fullRes || invoice
      } catch {
        /* use create response */
      }
      setPrintingInvoice({
        ...invForPrint,
        gst_enabled: gstEnabled,
        items: builtItems,
        patient_details: b2bEnabled
          ? null
          : mergePatientDetailsForInvoice(selectedPt, invForPrint.patient_details),
        party_name: invForPrint.party_name || (b2bEnabled ? partyName : ''),
        party_details:
          invForPrint.party_details ||
          (typeof invForPrint.party === 'object' ? invForPrint.party : null) ||
          partyDetails ||
          null,
        subtotal: taxableSubtotal,
        cgst,
        sgst,
        round_off: roundOff,
        grand_total: payableTotal,
        payment_method: paymentMethod,
        paid_amount: paymentMethod === 'credit' ? 0 : payableTotal,
        due_amount: paymentMethod === 'credit' ? payableTotal : 0,
      })
      setRows(normalizeRows(Array.from({ length: MIN_ROWS }, () => createNewRow()), createNewRow))
      setSelectedPt(null)
      setPartyId(null)
      setPartyName('')
      setPartyDetails(null)
      setLinkedAdmission(null)
      setPaymentMethod('cash')
      setPaidAmount('')
      setBillDiscountPercent('')
      localStorage.removeItem('pharmacy_bill_display')
      setInvoices((prev) => [invoice, ...prev])
      fetchInitialData()
      refreshInvoiceNo()
      toast.success('Invoice Generated')
    } catch (err) {
      if (createdInvoice?.id) {
        try {
          await api.delete(`/pharmacy/invoices/${createdInvoice.id}/`)
        } catch {
          try {
            await api.patch(`/pharmacy/invoices/${createdInvoice.id}/`, { status: 'cancelled' })
          } catch {
            // best-effort cleanup only
          }
        }
      }
      refreshInvoiceNo()
      toast.error(parseApiError(err))
    }
  }

  return (
    <div className="h-full flex gap-3 overflow-hidden min-h-0 min-w-0 text-[14px] bg-gradient-to-br from-slate-50 via-white to-blue-50/40 rounded-xl p-2">
      <div className="flex-1 flex flex-col gap-3 min-w-0 min-h-0 overflow-hidden">
        <div className="relative z-[220] bg-white/95 border border-slate-200/80 px-3 py-2 rounded-xl shadow-sm flex flex-wrap items-center justify-between gap-2 shrink-0 backdrop-blur-sm">
          <div className="flex flex-wrap items-center gap-2 flex-1 min-w-0">
            <div className="min-w-0 flex-1 max-w-md">
              <p className="text-[8px] font-bold text-slate-500 uppercase mb-0.5">{b2bEnabled ? 'Party' : 'Patient'}</p>
              {b2bEnabled ? (
                <PurchaseSupplierPicker
                  supplierId={partyId}
                  supplierName={partyName}
                  onChange={(id, name, details) => {
                    setPartyId(id)
                    setPartyName(name)
                    setPartyDetails(details || null)
                  }}
                  required
                />
              ) : (
                <div className="space-y-1">
                  {selectedPt ? (
                    <div className="space-y-1">
                      <div className="flex items-center justify-between bg-blue-50 border border-blue-200 px-2 py-0.5 rounded text-[11px] font-semibold">
                        <span className="truncate text-blue-800">
                          {selectedPt.first_name} {selectedPt.last_name}
                          {!selectedPt._walkInBilling && selectedPt.uhid ? ` (${selectedPt.uhid})` : ''}
                        </span>
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedPt(null)
                            focusPatientSearch()
                          }}
                          className="text-blue-500 shrink-0 ml-1"
                        >
                          ×
                        </button>
                      </div>
                      <div className="grid grid-cols-2 gap-1">
                        <label className="min-w-0">
                          <span className="text-[8px] font-bold text-slate-500 uppercase">Mobile</span>
                          <input
                            type="text"
                            value={selectedPt.phone || ''}
                            onChange={(e) =>
                              setSelectedPt((prev) => (prev ? { ...prev, phone: e.target.value } : prev))
                            }
                            placeholder="Optional"
                            className="mt-0.5 w-full bg-white border border-slate-200 rounded px-1.5 py-0.5 text-[10px] outline-none focus:border-blue-500"
                          />
                        </label>
                        <label className="min-w-0">
                          <span className="text-[8px] font-bold text-slate-500 uppercase">Address</span>
                          <input
                            type="text"
                            value={selectedPt.address_line1 || ''}
                            onChange={(e) =>
                              setSelectedPt((prev) =>
                                prev ? { ...prev, address_line1: e.target.value } : prev,
                              )
                            }
                            placeholder="Optional"
                            className="mt-0.5 w-full bg-white border border-slate-200 rounded px-1.5 py-0.5 text-[10px] outline-none focus:border-blue-500"
                          />
                        </label>
                      </div>
                    </div>
                  ) : (
                    <div className="relative">
                      <Search className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-300" size={12} />
                      <input
                        ref={patientSearchRef}
                        type="text"
                        placeholder="NAME / UHID / MOBILE"
                        value={ptSearch}
                        onChange={(e) => setPtSearch(e.target.value)}
                        onFocus={() => setActiveField('patient')}
                        className="w-full bg-slate-50 border border-slate-200 pl-7 pr-2 py-0.5 rounded text-[11px] font-medium focus:bg-white focus:border-blue-500 outline-none uppercase"
                      />
                      {ptSearch.length > 2 && (
                        <div className="absolute top-full left-0 right-0 mt-0.5 bg-white border border-slate-200 shadow-lg z-[260] text-left">
                          <div className="max-h-40 overflow-y-auto">
                            {ptResults.length > 0 ? (
                              ptResults.map((p) => (
                                <button
                                  key={p.id}
                                  type="button"
                                  onClick={() => {
                                    setSelectedPt(p)
                                    setLinkedAdmission(activeAdmissionByPatientId[String(p.id)] || null)
                                    setPtResults([])
                                    setPtSearch('')
                                  }}
                                  className="w-full text-left px-2 py-1 hover:bg-slate-50 text-[11px]"
                                >
                                  <div className="font-semibold text-slate-900">
                                    {p.first_name} {p.last_name}
                                  </div>
                                  <div className="text-[9px] text-slate-400 flex items-center gap-1.5 flex-wrap">
                                    {p.phone ? <span>{p.phone}</span> : null}
                                    {p.phone && p.uhid ? <span>|</span> : null}
                                    {p.uhid ? <span>{p.uhid}</span> : null}
                                    {activeAdmissionByPatientId[String(p.id)] ? (
                                      <span className="px-1 py-0.5 rounded border border-emerald-200 bg-emerald-50 text-emerald-700 font-semibold">
                                        Admitted · {activeAdmissionByPatientId[String(p.id)]?.bed_code || 'IPD'}
                                      </span>
                                    ) : (
                                      <span className="px-1 py-0.5 rounded border border-slate-200 bg-slate-50 text-slate-500">
                                        Not admitted
                                      </span>
                                    )}
                                  </div>
                                </button>
                              ))
                            ) : (
                              <div className="p-2 text-center text-[10px] text-slate-600">No matches found.</div>
                            )}
                          </div>
                          <div className="border-t border-slate-100 p-1.5 bg-slate-50/70">
                            <button
                              type="button"
                              onClick={() => openAddPatient?.(ptSearch)}
                              className="w-full text-left text-[10px] font-semibold text-blue-600 hover:text-blue-700"
                            >
                              + Add patient
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
            <div className="shrink-0 border border-slate-200 rounded-lg px-2 py-1 bg-slate-50">
              <p className="text-[8px] font-bold text-slate-500 uppercase">Bill #</p>
              <p className="text-[11px] font-mono font-bold text-slate-900 leading-tight">{invoiceNo || '—'}</p>
            </div>
            <div className="shrink-0 border border-slate-200 rounded-lg px-2 py-1 bg-slate-50 min-w-[146px]">
              <p className="text-[8px] font-bold text-slate-500 uppercase">Invoice Date</p>
              <input
                type="date"
                value={invoiceDate}
                onChange={(e) => setInvoiceDate(e.target.value)}
                className="mt-0.5 w-full bg-white border border-slate-200 rounded px-1.5 py-0.5 text-[10px] outline-none focus:border-blue-500"
              />
            </div>
            <div className="shrink-0 border border-slate-200 rounded-lg px-2 py-1 bg-slate-50 min-w-[112px]">
              <p className="text-[8px] font-bold text-slate-500 uppercase">Invoice Time</p>
              <input
                type="time"
                value={invoiceTime}
                onChange={(e) => setInvoiceTime(e.target.value)}
                className="mt-0.5 w-full bg-white border border-slate-200 rounded px-1.5 py-0.5 text-[10px] outline-none focus:border-blue-500"
              />
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-1.5 shrink-0">
            <label className="flex items-center gap-1 text-[8px] text-slate-600 cursor-pointer whitespace-nowrap">
              <input type="checkbox" checked={allowExpiredSale} onChange={(e) => setAllowExpiredSale(e.target.checked)} />
              Sell expired
            </label>
            <div className="flex rounded border border-slate-200 overflow-hidden text-[8px] font-bold uppercase">
              <button
                type="button"
                onClick={() => setGstEnabled(true)}
                className={`px-1.5 py-0.5 ${gstEnabled ? 'bg-blue-600 text-white' : 'bg-white text-slate-600'}`}
              >
                GST
              </button>
              <button
                type="button"
                onClick={() => setGstEnabled(false)}
                className={`px-1.5 py-0.5 border-l border-slate-200 ${!gstEnabled ? 'bg-slate-800 text-white' : 'bg-white text-slate-600'}`}
              >
                Non-GST
              </button>
            </div>
            <button
              type="button"
              onClick={() => setShowAddMedicine(true)}
              className="bg-blue-600 text-white px-2 py-0.5 rounded text-[9px] font-semibold"
            >
              + Medicine
            </button>
          </div>
        </div>

        <div className="relative z-0 flex-1 flex flex-col min-h-0 bg-white border border-slate-200/90 rounded-xl overflow-hidden min-w-0 shadow-sm">
          <div className="overflow-x-hidden overflow-y-auto flex-1 min-h-0 min-w-0">
            <div
              className={`grid ${GRID_BILL} gap-0 text-[11px] font-bold text-slate-700 bg-gradient-to-b from-slate-100 to-slate-50 border-b border-slate-200 px-0.5 py-1.5 sticky top-0 z-20 min-w-0 shadow-[inset_0_-1px_0_rgba(255,255,255,0.8)]`}
            >
              <span className="text-center tabular-nums">#</span>
              <span>Product Name</span>
              <span className="text-center">Batch</span>
              <span className="text-center">HSN/SAC</span>
              <span className="text-center">PACK</span>
              <span className="text-center">Expiry</span>
              <span className="text-right pr-0.5">MRP</span>
              <span className="text-right pr-0.5">Qty/Pack</span>
              <span className="text-right pr-0.5">Loose</span>
              <span className="text-right pr-0.5">Disc %</span>
              <span className="text-right pr-0.5" title="Line rate (unit selling rate × qty sold)">Rate</span>
              <span className={`text-right pr-0.5 ${gstEnabled ? '' : 'text-slate-300'}`}>GST</span>
              <span
                className="text-right pr-0.5"
                title="Per line: (selling rate − batch unit cost) × qty when unit cost is set on the batch."
              >
                Margin
              </span>
              <span className="text-right pr-0.5">Amount</span>
              <span />
            </div>

            <div className="divide-y divide-slate-100 min-w-0">
              {rows.map((row, idx) => {
                const expSt = rowExpiryStatus(row)
                const badgeCls = expiryBadgeClass(expSt)
                // Resolve effective pack size: row.pack_size > medicine.pack_size > unit_conversions > 1
                const resolvedPackSize = (() => {
                  const rps = Number(row.pack_size)
                  if (rps > 1) return rps
                  const mps = Number(row.medicine?.pack_size)
                  if (mps > 1) return mps
                  const conv = row.medicine?.unit_conversions || {}
                  for (const k of ['strip', 'STRIP', 'box', 'BOX', 'carton', 'CARTON']) {
                    const v = Number(conv[k])
                    if (v > 1) return v
                  }
                  return 1
                })()
                const isSingleUnitPack = resolvedPackSize <= 1
                return (
                  <div
                    key={row.id}
                    className={`grid ${GRID_BILL} gap-0 items-stretch text-[11px] min-h-[40px] min-w-0 transition-colors ${
                      activeRow === idx ? 'bg-blue-50/80 ring-1 ring-inset ring-blue-200/70' : idx % 2 ? 'bg-slate-50/40' : 'hover:bg-blue-50/30'
                    }`}
                  >
                    <span className="flex items-center justify-center text-slate-400 tabular-nums">{idx + 1}</span>

                    <div className={`px-0.5 py-0.5 border-r border-slate-100 min-w-0 ${activeRow === idx ? 'relative overflow-visible' : ''}`}>
                      {!row.medicine || replacingRowId === row.id ? (
                        <div className="relative min-h-[22px]">
                          <input
                            ref={(el) => {
                              if (el) productRefs.current[row.id] = el
                              else delete productRefs.current[row.id]
                            }}
                            autoFocus={
                              (activeRow === idx && activeField === 'product' && !row.medicine) ||
                              replacingRowId === row.id
                            }
                            onFocus={() => {
                              setActiveRow(idx)
                              setActiveField('product')
                            }}
                            type="text"
                            placeholder={replacingRowId === row.id ? 'Search to replace…' : 'Search…'}
                            value={activeRow === idx || replacingRowId === row.id ? pSearch : ''}
                            onChange={(e) => {
                              setPSearch(e.target.value)
                              setActiveRow(idx)
                            }}
                            onKeyDown={(e) => handleRowEnter(e, row.id, 'product')}
                            className="w-full min-w-0 bg-transparent outline-none uppercase font-semibold text-slate-900 placeholder:text-slate-300 text-[11px] px-1"
                          />
                          {replacingRowId === row.id && (
                            <button
                              type="button"
                              onClick={() => {
                                setReplacingRowId(null)
                                setPSearch('')
                                setSearchResults([])
                              }}
                              className="mt-0.5 text-[9px] text-blue-600 font-semibold hover:underline"
                            >
                              Keep current medicine
                            </button>
                          )}
                          {activeRow === idx &&
                            pSearch.length >= 2 &&
                            (!row.medicine || replacingRowId === row.id) && (
                              <div className="absolute top-full left-0 mt-0.5 w-[min(100vw-1.5rem,22rem)] max-w-[90vw] bg-white border border-slate-200 shadow-xl z-[80] max-h-48 overflow-y-auto rounded">
                                {searchLoading && <div className="p-2 text-[9px] text-slate-400">Searching…</div>}
                                {!searchLoading && searchResults.length === 0 && (
                                  <div className="p-2 text-center text-[9px]">
                                    <button type="button" onClick={() => setShowAddMedicine(true)} className="text-blue-600 font-medium">
                                      + Add medicine
                                    </button>
                                  </div>
                                )}
                                {!searchLoading &&
                                  searchResults.map((pick, j) => {
                                    const dis = pick.expiry_status === 'expired' && !allowExpiredSale
                                    return (
                                      <SearchHitRow
                                        key={`${pick.batch.id}-${j}`}
                                        pick={pick}
                                        disabled={dis}
                                        categoryRows={medicineCategoryRows}
                                        onPick={(p) => applySearchPick(row.id, p)}
                                      />
                                    )
                                  })}
                              </div>
                            )}
                        </div>
                      ) : (
                        <button
                          type="button"
                          title="Tap to change product or batch"
                          onClick={() => {
                            setReplacingRowId(row.id)
                            setActiveRow(idx)
                            setActiveField('product')
                            setPSearch('')
                            setSearchResults([])
                          }}
                          className="text-left w-full min-w-0 flex flex-col gap-0.5 rounded px-0.5 py-0.5 -mx-0.5 hover:bg-blue-50/90 border border-transparent hover:border-blue-100/80 transition-colors cursor-pointer"
                        >
                          <div className="flex items-center gap-1 min-w-0">
                            <span className="font-semibold text-slate-900 uppercase truncate text-[11px]">
                              {medicineNickName(row.medicine)}
                              {medicineBillAlias(row.medicine) ? (
                                <span className="normal-case text-slate-400 font-normal ml-1">
                                  ({medicineBillAlias(row.medicine)})
                                </span>
                              ) : null}
                            </span>
                            {expSt === 'expired' && (
                              <span className="shrink-0 text-[6px] font-bold px-1 rounded bg-rose-600 text-white">EXPIRED</span>
                            )}
                            {expSt === 'expiring' && (
                              <span className="shrink-0 text-[6px] font-bold px-1 rounded bg-amber-500 text-white">EXP</span>
                            )}
                          </div>
                          <span className="text-[7px] text-slate-400 truncate">
                            {row.medicine.pack_info} | {row.medicine.hsn_code}
                          </span>
                        </button>
                      )}
                    </div>

                    <div className="px-0.5 py-0.5 text-center text-slate-600 font-mono text-[8px] tabular-nums truncate border-r border-slate-100 flex items-center justify-center">
                      {row.batch?.batch_no ?? '—'}
                    </div>
                    <div className="px-0.5 py-0.5 text-center font-mono text-[10px] tabular-nums border-r border-slate-100 flex items-center justify-center text-slate-600">
                      {row.hsn || row.medicine?.hsn_code || '—'}
                    </div>
                    <div className="px-0.5 py-0.5 text-center text-[10px] tabular-nums border-r border-slate-100 flex items-center justify-center text-slate-600">
                      {row.pack || row.medicine?.pack_info || '—'}
                    </div>
                    <div
                      className={`px-0.5 py-0.5 text-center font-mono text-[10px] tabular-nums border-r border-slate-100 flex items-center justify-center ${
                        expSt === 'expired' ? 'text-rose-700 bg-rose-50' : expSt === 'expiring' ? 'text-amber-800 bg-amber-50/80' : 'text-slate-500'
                      }`}
                    >
                      {safeFormat(row.batch?.expiry_date, 'dd/MM/yyyy')}
                    </div>
                    <div
                      className={`${CELL_NUM} text-[10px] text-slate-700`}
                      title="Line MRP (unit MRP × qty sold)"
                    >
                      {row.batch?.mrp != null && Number(row.batch.mrp) > 0
                        ? (() => {
                            const unitMrp = Number(row.batch.mrp)
                            const q = Number(row.qty) || 0
                            const lineMrp = q > 0 ? unitMrp * q : unitMrp
                            return lineMrp.toFixed(2)
                          })()
                        : ''}
                    </div>
                    <div className={CELL_INP_WRAP}>
                      <input
                        ref={(el) => {
                          if (el) packRefs.current[row.id] = el
                          else delete packRefs.current[row.id]
                        }}
                        disabled={!row.medicine}
                        autoFocus={activeRow === idx && activeField === 'packs'}
                        onFocus={() => {
                          setActiveRow(idx)
                          setActiveField('packs')
                        }}
                        inputMode="numeric"
                        value={row.packs}
                        onChange={(e) => patchRowById(row.id, { packs: sanitizePackLooseInput(e.target.value) })}
                        onKeyDown={(e) => handleRowEnter(e, row.id, 'packs')}
                        className={INP_NUM}
                        title={isSingleUnitPack ? 'Quantity' : 'Packs (integer)'}
                        placeholder={isSingleUnitPack ? 'Qty' : 'Pack'}
                      />
                    </div>
                    <div className={CELL_INP_WRAP}>
                      {isSingleUnitPack ? (
                        <div className="w-full h-full min-h-[28px] flex items-center justify-center rounded bg-slate-200 text-slate-700 font-semibold select-none">
                          -
                        </div>
                      ) : (
                        <input
                          ref={(el) => {
                            if (el) looseRefs.current[row.id] = el
                            else delete looseRefs.current[row.id]
                          }}
                          disabled={!row.medicine}
                          onFocus={() => {
                            setActiveRow(idx)
                            setActiveField('loose')
                          }}
                          inputMode="decimal"
                          value={row.loose}
                          onChange={(e) => patchRowById(row.id, { loose: sanitizePackLooseInput(e.target.value) })}
                          onKeyDown={(e) => handleRowEnter(e, row.id, 'loose')}
                          className={INP_NUM}
                          title="Loose units"
                        />
                      )}
                    </div>
                    <div className={`${CELL_INP_WRAP} gap-0.5`}>
                      <input
                        ref={(el) => {
                          if (el) discRefs.current[row.id] = el
                          else delete discRefs.current[row.id]
                        }}
                        disabled={!row.medicine}
                        type="text"
                        inputMode="decimal"
                        title="% off MRP vs rate: changes selling rate to MRP × (1 − %/100)"
                        value={
                          row.line_discount === 0 && typeof row.line_discount !== 'string'
                            ? ''
                            : String(row.line_discount)
                        }
                        onChange={(e) => {
                          const raw = normalizePercentInputString(e.target.value)
                          if (raw === '' || raw === '-' || raw === '.') {
                            patchRowById(row.id, { line_discount: 0, discount_user_set: true })
                            return
                          }
                          if (isPartialPercentInput(raw)) {
                            patchRowById(row.id, { line_discount: raw, discount_user_set: true })
                            return
                          }
                          const n = parseCompletePercentInput(raw)
                          if (n == null) return
                          patchRowById(row.id, {
                            line_discount: n,
                            discount_user_set: true,
                          })
                        }}
                        onKeyDown={(e) => handleRowEnter(e, row.id, 'disc')}
                        className={`${INP_NUM} flex-1 min-w-0`}
                      />
                      <span className="text-[8px] text-slate-400 shrink-0 pr-0.5">%</span>
                    </div>
                    <div className={CELL_INP_WRAP}>
                      <input
                        ref={(el) => {
                          if (el) rateRefs.current[row.id] = el
                          else delete rateRefs.current[row.id]
                        }}
                        disabled={!row.medicine}
                        autoFocus={activeRow === idx && activeField === 'rate'}
                        onFocus={() => {
                          setActiveRow(idx)
                          setActiveField('rate')
                        }}
                        type="text"
                        inputMode="decimal"
                        title="Line rate (unit selling rate × qty). Stored per unit for tax/margin."
                        value={
                          !row.medicine
                            ? ''
                            : (() => {
                                const q = Number(row.qty) || 0
                                const unit = Number(row.rate) || 0
                                if (unit === 0) return ''
                                const line = q > 0 ? lineSellingRateDisplay(row) : unit
                                return String(line)
                              })()
                        }
                        onChange={(e) => {
                          const raw = e.target.value.trim()
                          if (raw === '' || raw === '.' || raw === '-') {
                            patchRowById(row.id, { rate: 0 })
                            return
                          }
                          const v = Number(raw)
                          if (!Number.isFinite(v)) return
                          const q = Number(row.qty) || 0
                          const unitRate = q > 0 ? Math.round((v / q) * 100) / 100 : v
                          patchRowById(row.id, { rate: unitRate })
                        }}
                        onKeyDown={(e) => handleRowEnter(e, row.id, 'rate')}
                        className={INP_NUM}
                      />
                    </div>
                    <div className={CELL_INP_WRAP}>
                      <input
                        ref={(el) => {
                          if (el) gstRefs.current[row.id] = el
                          else delete gstRefs.current[row.id]
                        }}
                        type="text"
                        inputMode="decimal"
                        value={gstEnabled ? (row.gst_percent ?? '') : ''}
                        onChange={(e) => patchRowById(row.id, { gst_percent: e.target.value })}
                        disabled={!gstEnabled || row.no_gst}
                        onKeyDown={(e) => handleRowEnter(e, row.id, 'gst')}
                        className={`${INP_NUM} max-w-full`}
                        placeholder={gstEnabled ? '·' : '-'}
                      />
                    </div>
                    <div className={`${CELL_NUM} text-[10px] text-slate-700 flex flex-col items-end justify-center leading-tight`}>
                      {row.batch && Number(row.qty) > 0
                        ? (() => {
                            const unitSell = Number(row.rate)
                            const unitCost = Number(row.batch?.unit_cost)
                            const q = Number(row.qty || 0)
                            const hasCost =
                              row.batch &&
                              Number.isFinite(unitCost) &&
                              unitCost > 0 &&
                              Number.isFinite(unitSell) &&
                              unitSell > 0
                            const unitMg = hasCost ? unitSell - unitCost : null
                            const totalMg =
                              unitMg != null ? Math.round(unitMg * q * 100) / 100 : null
                            const unitRounded = unitMg != null ? Math.round(unitMg * 100) / 100 : null
                            return hasCost ? (
                              <>
                                <span className="tabular-nums font-semibold">{totalMg.toFixed(2)}</span>
                                {q > 1 && (
                                  <span className="text-[8px] text-slate-400 font-normal">
                                    total ({unitRounded.toFixed(2)} × {q % 1 === 0 ? String(q) : q.toFixed(2)})
                                  </span>
                                )}
                              </>
                            ) : (
                              <span className="text-[9px] text-slate-400 font-normal">—</span>
                            )
                          })()
                        : ''}
                    </div>
                    <RupeesCell value={lineMarg[idx]?.finalAmount} />
                    <div className="flex items-center justify-center">
                      {row.medicine && (
                        <button
                          type="button"
                          onClick={() => {
                            setReplacingRowId((rid) => (rid === row.id ? null : rid))
                            clearRowByIdAndNormalize(row.id, setRows, setActiveRow)
                          }}
                          className="p-0.5 text-slate-300 hover:text-rose-500"
                          title="Remove line"
                        >
                          <Trash2 size={12} />
                        </button>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      </div>

      <div className="w-64 flex flex-col gap-2 shrink-0 min-h-0">
        <div className="bg-white border border-slate-200/90 rounded-xl p-3 flex flex-col gap-2 sticky top-0 z-10 shadow-sm">
          <div className="text-xs font-extrabold tracking-wide text-slate-600 uppercase">Summary</div>
          <div className="space-y-1">
            <div className="text-[10px] font-semibold text-slate-500">Payment method</div>
            <div className={`grid gap-1 ${linkedAdmission ? 'grid-cols-4' : 'grid-cols-3'}`}>
              {[...(linkedAdmission ? ['cash', 'upi', 'other', 'credit'] : ['cash', 'upi', 'other'])].map((mode) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => setPaymentMethod(mode)}
                  className={`rounded-md border px-1 py-1 text-[9px] font-bold uppercase ${
                    paymentMethod === mode
                      ? 'border-blue-600 bg-blue-600 text-white'
                      : 'border-slate-200 bg-white text-slate-600'
                  }`}
                >
                  {mode}
                </button>
              ))}
            </div>
            {linkedAdmission ? (
              <div className="rounded-md border border-emerald-200 bg-emerald-50 px-2 py-1 text-[9px] text-emerald-700">
                Linked to IPD: {linkedAdmission.bed_code} ({linkedAdmission.patient_name})
              </div>
            ) : null}
          </div>
          <div className="space-y-1 text-sm">
            <div className="flex justify-between">
              <span className="text-slate-600">Items</span>
              <span className="font-semibold tabular-nums">{rows.filter((r) => r.medicine).length}</span>
            </div>
            <div
              className="flex justify-between items-baseline gap-2 text-[10px]"
              title="Sum of qty × batch MRP when MRP is set; otherwise qty × rate."
            >
              <span className="text-slate-600">List gross</span>
              <div className="flex justify-end items-center gap-0.5 min-w-0">
                <span className="text-slate-500 shrink-0 text-[9px]">₹</span>
                <span className="tabular-nums font-medium">{lineGrossTotal.toFixed(2)}</span>
              </div>
            </div>
            <div className="flex justify-between items-baseline gap-2">
              <span className="text-slate-600">{gstEnabled ? 'Taxable' : 'Subtotal'}</span>
              <div className="flex justify-end items-center gap-0.5 min-w-0">
                <span className="text-slate-500 shrink-0 text-[9px]">₹</span>
                <span className="tabular-nums font-medium">{taxableSubtotal.toFixed(2)}</span>
              </div>
            </div>
            <div className="space-y-1">
              <span className="text-[10px] font-bold tracking-wide text-slate-600 uppercase block">Discount %</span>
              <div className="relative w-full rounded-lg border border-blue-100 bg-gradient-to-r from-blue-50/70 to-indigo-50/60 px-2 py-1.5 shadow-sm">
                <input
                  type="text"
                  inputMode="decimal"
                  value={billDiscountPercent}
                  onChange={(e) => {
                    const raw = normalizePercentInputString(e.target.value)
                    if (raw === '' || raw === '-' || raw === '.') {
                      setBillDiscountPercent(raw === '.' ? '.' : '')
                      return
                    }
                    if (isPartialPercentInput(raw)) {
                      setBillDiscountPercent(raw)
                      return
                    }
                    const v = parseCompletePercentInput(raw)
                    if (v == null) return
                    setBillDiscountPercent(String(v))
                  }}
                  className="w-full bg-white/90 border border-blue-200 rounded-md px-2 pr-6 py-1.5 text-right tabular-nums text-[12px] font-semibold text-slate-900 outline-none shadow-inner transition-all focus:bg-white focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                  placeholder="0"
                />
                <span className="absolute right-4 top-1/2 -translate-y-1/2 text-blue-700 text-[11px] font-semibold">%</span>
              </div>
            </div>
            {gstEnabled ? (
              <>
                <div className="flex justify-between text-[9px] gap-2">
                  <span className="text-slate-600">CGST</span>
                  <span className="tabular-nums">₹{cgst.toFixed(2)}</span>
                </div>
                <div className="flex justify-between text-[9px] gap-2">
                  <span className="text-slate-600">SGST</span>
                  <span className="tabular-nums">₹{sgst.toFixed(2)}</span>
                </div>
                <div className="flex justify-between border-b border-slate-100 pb-1 text-[9px] gap-2">
                  <span className="text-slate-600">GST</span>
                  <span className="tabular-nums">₹{gst.toFixed(2)}</span>
                </div>
              </>
            ) : (
              <div className="flex justify-between border-b border-slate-100 pb-1 text-[9px] text-slate-500">
                <span>Non-GST</span>
                <span>No tax</span>
              </div>
            )}
            {roundOff !== 0 ? (
              <div className="flex justify-between text-[9px] gap-2">
                <span className="text-slate-600">Round off</span>
                <span className="tabular-nums">
                  {roundOff > 0 ? '+' : '−'}₹{Math.abs(roundOff).toFixed(2)}
                </span>
              </div>
            ) : null}
            <div className="flex justify-end items-center gap-0.5 text-[1.35rem] font-black text-slate-900 pt-1">
              <span className="text-slate-600 text-sm font-semibold">₹</span>
              <span className="tabular-nums">{payableTotal.toFixed(2)}</span>
            </div>
          </div>
          <button type="button" onClick={handleSave} className="w-full bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white py-2 rounded-lg text-sm font-bold shadow-md shadow-blue-200 transition-all">
            Save & Print
          </button>
          <button
            type="button"
            onClick={() => {
              setRows(normalizeRows(Array.from({ length: MIN_ROWS }, () => createNewRow()), createNewRow))
              setBillDiscountPercent('')
              localStorage.removeItem('pharmacy_bill_display')
            }}
            className="w-full border border-slate-200 py-1.5 rounded-lg text-sm font-medium text-slate-600 hover:bg-slate-50 transition-colors"
          >
            Clear
          </button>
        </div>
      </div>
    </div>
  )
}

const ErpBillingView = memo(ErpBillingViewInner)
export default ErpBillingView
