import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import api from '../../api'
import toast from 'react-hot-toast'
import {
  Add as AddIcon,
  Close as CloseIcon,
  Delete as DeleteIcon,
  List as ListIcon,
  ReceiptLong as ReceiptLongIcon,
  Search as SearchIcon,
} from '@mui/icons-material'
import { formatDateTime } from '../../utils/dateTimeFormat'
import { getPaymentSlipProfile, loadReceptionPortalProfileCache } from '../../utils/receptionPortalProfile'
import {
  EXPENSE_QUICK_ALL_CATEGORY,
  EXPENSE_QUICK_CATEGORIES_STORAGE_KEY,
  EXPENSE_QUICK_DEFAULT_CATEGORY,
  EXPENSE_QUICK_SERVICES_STORAGE_KEY,
  DEFAULT_EXPENSE_QUICK_SERVICES,
  loadExpenseQuickServices,
  normalizeExpenseQuickServices,
} from '../../utils/expenseQuickServices'
import { printExpenseVoucherImmediately, resolvePaymentSlipLineTotal } from '../../utils/expenseSlipPrint'
import { Edit2, Eye, GripVertical, Plus, Printer, Tag, Trash2, X } from 'lucide-react'
import ExpensePartyField from './ExpensePartyField'

function handleCancelReasonKeyDown(e, onSubmit, { disabled = false } = {}) {
  if (disabled || e.key !== 'Enter' || e.shiftKey) return
  e.preventDefault()
  onSubmit()
}

function toDateTimeInputValue(v) {
  if (!v) return ''
  const d = new Date(v)
  if (Number.isNaN(d.getTime())) return ''
  const yyyy = d.getFullYear()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  const hh = String(d.getHours()).padStart(2, '0')
  const min = String(d.getMinutes()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}T${hh}:${min}`
}

function dateTimeInputToIso(value) {
  if (!value) return null
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return null
  return d.toISOString()
}

function consolidateExpenseItems(items) {
  const map = new Map()
  for (const raw of items || []) {
    const description = String(raw?.description || '').trim()
    if (!description) continue
    const unitPrice = Number(parseFloat(raw?.unit_price))
    const quantity = Number(parseFloat(raw?.quantity))
    if (!Number.isFinite(unitPrice) || unitPrice <= 0) continue
    if (!Number.isFinite(quantity) || quantity <= 0) continue
    const key = `${description.toLowerCase()}::${unitPrice.toFixed(4)}`
    const existing = map.get(key)
    if (existing) {
      existing.quantity += quantity
      if (!existing.category && raw?.category) existing.category = raw.category
    } else {
      map.set(key, {
        description,
        unit_price: unitPrice,
        quantity,
        category: String(raw?.category || '').trim(),
      })
    }
  }
  return Array.from(map.values()).map((row) => ({
    ...row,
    line_total: row.quantity * row.unit_price,
  }))
}

function formatApiError(err, fallback) {
  const d = err?.response?.data
  if (!d) return fallback
  if (typeof d.detail === 'string') return d.detail
  if (d.errors && typeof d.errors === 'object') {
    const first = Object.values(d.errors).flat()[0]
    if (typeof first === 'string') return first
  }
  if (d.message && typeof d.message === 'string') return d.message
  return fallback
}

function computeExpenseEditSubtotal(editItems) {
  return (editItems || []).reduce(
    (sum, it) => sum + (Number(it.quantity) || 0) * (Number(it.unit_price) || 0),
    0,
  )
}

function computeExpenseEditTotal(editItems, discount) {
  const subtotal = computeExpenseEditSubtotal(editItems)
  const disc = Number(discount) || 0
  return Math.max(0, subtotal - disc)
}

function isExpenseCancelled(row) {
  return row?.voided || row?.status === 'cancelled'
}

function extractApiRows(data) {
  if (Array.isArray(data?.results)) return data.results
  if (Array.isArray(data?.data)) return data.data
  if (Array.isArray(data)) return data
  return []
}

function ExpenseListDrawer({
  open,
  onClose,
  onPrint,
}) {
  const [rows, setRows] = useState([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [search, setSearch] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [page, setPage] = useState(0)
  const [viewExpense, setViewExpense] = useState(null)
  const [editingExpense, setEditingExpense] = useState(null)
  const [cancelExpense, setCancelExpense] = useState(null)
  const [cancelReason, setCancelReason] = useState('')
  const [cancelling, setCancelling] = useState(false)
  const [quickServices, setQuickServices] = useState([])
  const [itemDropdownIdx, setItemDropdownIdx] = useState(null)
  const [itemDropdownPos, setItemDropdownPos] = useState(null)
  const itemDescRefs = useRef({})
  const PAGE_SIZE = 10
  const debounceRef = useRef(null)

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  const fetchRows = useCallback(async (pg = 0, q = '') => {
    setLoading(true)
    try {
      const params = new URLSearchParams({
        limit: String(PAGE_SIZE),
        offset: String(pg * PAGE_SIZE),
        ordering: '-paid_at',
        voided: 'false',
      })
      const query = q.trim()
      if (query) params.set('search', query)
      if (dateFrom) params.set('paid_at__date__gte', dateFrom)
      if (dateTo) params.set('paid_at__date__lte', dateTo)
      const { data } = await api.get(`/expenses/?${params}`)
      const list = extractApiRows(data)
      setRows(list)
      setTotal(Number.isFinite(Number(data?.count)) ? Number(data.count) : list.length)
    } catch {
      toast.error('Failed to load expense slips')
    } finally {
      setLoading(false)
    }
  }, [dateFrom, dateTo])

  useEffect(() => {
    if (!open) return
    loadExpenseQuickServices().then(({ services }) => {
      if (services) setQuickServices(services)
    })
  }, [open])

  useEffect(() => {
    if (!open) return
    setPage(0)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => fetchRows(0, search), 300)
    return () => clearTimeout(debounceRef.current)
  }, [open, search, fetchRows])

  useEffect(() => {
    if (!open) return
    setPage(0)
    fetchRows(0, search)
  }, [open, dateFrom, dateTo, fetchRows, search])

  useEffect(() => {
    if (!open) return
    fetchRows(page, search)
  }, [open, page, fetchRows, search])

  function openEditExpense(row) {
    const rawItems = Array.isArray(row.items) ? row.items : []
    const editItems = rawItems.map((it) => ({
      id: it.id,
      description: it.description || '',
      category: it.category || '',
      quantity: String(it.quantity ?? 1),
      unit_price: String(it.unit_price ?? 0),
    }))
    setEditingExpense({
      ...row,
      paid_at: toDateTimeInputValue(row.paid_at),
      _editItems: editItems.length > 0 ? editItems : [{ description: '', category: '', quantity: '1', unit_price: '0' }],
      _discount: row.discount_amount ?? 0,
    })
  }

  async function handleSaveEdit(e) {
    e.preventDefault()
    if (!editingExpense) return
    try {
      const editItems = (editingExpense._editItems || []).filter((it) => String(it.description || '').trim())
      if (!editItems.length) {
        toast.error('Add at least one item')
        return
      }
      await api.patch(`/expenses/${editingExpense.id}/`, {
        paid_to: editingExpense.paid_to,
        paid_at: dateTimeInputToIso(editingExpense.paid_at),
        payment_mode: editingExpense.payment_mode,
        source: editingExpense.source || 'collection',
        remarks: editingExpense.remarks || '',
        discount_amount: editingExpense._discount ?? 0,
        items: editItems.map((it) => ({
          description: it.description,
          category: it.category || '',
          quantity: Number(it.quantity) || 1,
          unit_price: Number(it.unit_price) || 0,
        })),
      })
      toast.success('Expense slip updated!')
      setEditingExpense(null)
      fetchRows(page, search)
    } catch (err) {
      toast.error(formatApiError(err, 'Failed to update expense slip'))
    }
  }

  async function submitCancel() {
    if (!cancelExpense || cancelling) return
    const reason = cancelReason.trim()
    if (!reason) {
      toast.error('Please enter cancellation reason')
      return
    }
    setCancelling(true)
    try {
      const res = await api.post(`/expenses/${cancelExpense.id}/void/`, { void_reason: reason })
      toast.success('Expense slip cancelled')
      const updated = res?.data?.data ?? res?.data?.entity ?? res?.data
      const cancelledId = cancelExpense.id
      setCancelExpense(null)
      setCancelReason('')
      if (viewExpense?.id === cancelledId) {
        if (updated?.voided) {
          setViewExpense(null)
        } else {
          setViewExpense((v) => ({ ...v, status: 'cancelled', void_reason: reason }))
        }
      }
      fetchRows(page, search)
    } catch (err) {
      toast.error(formatApiError(err, 'Failed to cancel expense slip'))
    } finally {
      setCancelling(false)
    }
  }

  if (!open) return null

  return createPortal(
    <>
      <div className="fixed inset-0 flex items-stretch z-[400]">
        <div className="flex-1 bg-black/40" onClick={onClose} />
        <div className="w-full max-w-4xl bg-white shadow-2xl flex flex-col overflow-hidden h-full">
          <div className="shrink-0 flex items-center justify-between px-4 py-3 border-b border-gray-200 bg-gradient-to-r from-amber-50 to-white">
            <div className="flex items-center gap-2">
              <ReceiptLongIcon sx={{ fontSize: 18, color: '#b45309' }} />
              <span className="font-bold text-gray-900 text-sm">Expense Slips</span>
            </div>
            <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-700">
              <CloseIcon fontSize="small" />
            </button>
          </div>

          <div className="shrink-0 px-4 py-2.5 border-b border-gray-100 flex items-center gap-2 bg-gray-50/60 flex-wrap">
            <SearchIcon sx={{ fontSize: 15, color: '#9ca3af' }} />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search paid to, voucher #…"
              className="flex-1 min-w-[120px] text-sm outline-none bg-transparent placeholder:text-gray-400"
            />
            <span className="w-px h-4 bg-gray-200 shrink-0" />
            <label className="text-[11px] text-gray-400 font-semibold uppercase tracking-wide shrink-0">From</label>
            <input type="date" value={dateFrom} max={dateTo || undefined} onChange={(e) => setDateFrom(e.target.value)} className="text-xs border border-gray-200 rounded-lg px-2 py-1" />
            <label className="text-[11px] text-gray-400 font-semibold uppercase tracking-wide shrink-0">To</label>
            <input type="date" value={dateTo} min={dateFrom || undefined} onChange={(e) => setDateTo(e.target.value)} className="text-xs border border-gray-200 rounded-lg px-2 py-1" />
            {loading && <span className="w-3.5 h-3.5 border-2 border-amber-500 border-t-transparent rounded-full animate-spin shrink-0" />}
            <span className="text-xs text-gray-400 shrink-0">{total} slips</span>
          </div>

          <div className="grid grid-cols-12 gap-y-1 px-4 py-2 bg-gray-100/80 border-b border-gray-200 text-[11px] font-semibold text-gray-500 uppercase tracking-wide shrink-0">
            <div className="col-span-2 min-w-0">Date / Voucher</div>
            <div className="col-span-1" aria-hidden />
            <div className="col-span-1 min-w-0 justify-self-center text-center">Paid to</div>
            <div className="col-span-1" aria-hidden />
            <div className="col-span-1 min-w-0 justify-self-center text-center">Mode</div>
            <div className="col-span-1" aria-hidden />
            <div className="col-span-1 min-w-0 justify-self-center text-center">Amount</div>
            <div className="col-span-2 min-w-0 justify-self-center text-center">By</div>
            <div className="col-span-2 min-w-0 justify-self-end text-right">Action</div>
          </div>

          <div className="flex-1 overflow-y-auto min-h-0 divide-y divide-gray-50">
            {loading ? (
              <div className="py-12 text-center text-sm text-gray-400">Loading…</div>
            ) : rows.length === 0 ? (
              <div className="py-12 text-center text-sm text-gray-400">No expense slips found</div>
            ) : (
              rows.map((row) => {
                const cancelled = isExpenseCancelled(row)
                return (
                <div key={row.id} className={`grid grid-cols-12 gap-y-1 px-4 py-3 items-center text-sm hover:bg-gray-50/50 transition-colors ${cancelled ? 'opacity-70' : ''}`}>
                  <div className="col-span-2 min-w-0">
                    <span className="font-bold text-gray-800 block text-xs leading-snug whitespace-normal">{row.paid_at ? formatDateTime(row.paid_at, { paren: true }) : '--'}</span>
                    <span className="text-[11px] text-amber-700 font-bold bg-amber-50 px-1.5 py-0.5 mt-1 rounded inline-block break-all">{row.slip_number || '--'}</span>
                    {cancelled ? (
                      <span className="text-[10px] text-red-600 font-bold bg-red-50 px-1.5 py-0.5 mt-1 rounded inline-block uppercase tracking-wide">Cancelled</span>
                    ) : null}
                    {!cancelled && row.source === 'other_funds' ? (
                      <span className="text-[10px] text-slate-600 font-bold bg-slate-100 px-1.5 py-0.5 mt-1 rounded inline-block">Other Funds</span>
                    ) : null}
                  </div>
                  <div className="col-span-1" aria-hidden />
                  <div className="col-span-1 min-w-0 justify-self-center text-center">
                    <p className="font-bold text-gray-800 truncate">{row.paid_to || '--'}</p>
                    {row.remarks ? <p className="text-[10px] text-gray-400 truncate">{row.remarks}</p> : null}
                  </div>
                  <div className="col-span-1" aria-hidden />
                  <div className="col-span-1 min-w-0 justify-self-center text-center">
                    <span className="text-[10px] text-indigo-600 font-bold uppercase">{row.payment_mode || '--'}</span>
                  </div>
                  <div className="col-span-1" aria-hidden />
                  <div className="col-span-1 min-w-0 justify-self-center text-center">
                    <span className="text-[10px] font-bold text-gray-600 border border-gray-200 px-1 py-0.5 rounded bg-gray-50 inline-block whitespace-nowrap">₹{row.total_amount}</span>
                  </div>
                  <div className="col-span-2 min-w-0 justify-self-center text-center">
                    <p className="text-[10px] text-gray-500 truncate" title={row.recorded_by_name}>{row.recorded_by_name || '--'}</p>
                  </div>
                  <div className="col-span-2 min-w-0 justify-self-end flex flex-row flex-wrap gap-0.5 items-center justify-end">
                    <button
                      type="button"
                      onClick={() => setViewExpense(row)}
                      title="View"
                      aria-label="View expense slip"
                      className="h-7 w-7 flex items-center justify-center text-indigo-600 hover:text-white bg-indigo-50 hover:bg-indigo-600 rounded-md border border-indigo-100 active:scale-95"
                    >
                      <Eye size={12} />
                    </button>
                    {!cancelled ? (
                      <>
                        <button
                          type="button"
                          onClick={() => onPrint(row)}
                          title="Print"
                          aria-label="Print expense slip"
                          className="h-7 w-7 flex items-center justify-center text-amber-700 hover:text-white bg-amber-50 hover:bg-amber-600 rounded-md border border-amber-200 active:scale-95"
                        >
                          <Printer size={12} />
                        </button>
                        <button
                          type="button"
                          onClick={() => openEditExpense(row)}
                          title="Edit"
                          aria-label="Edit expense slip"
                          className="h-7 w-7 flex items-center justify-center text-emerald-600 hover:text-white bg-emerald-50 hover:bg-emerald-600 rounded-md border border-emerald-100 active:scale-95"
                        >
                          <Edit2 size={12} />
                        </button>
                        <button
                          type="button"
                          onClick={() => { setCancelExpense(row); setCancelReason('') }}
                          title="Cancel"
                          aria-label="Cancel expense slip"
                          className="h-7 w-7 flex items-center justify-center text-red-600 hover:text-white bg-red-50 hover:bg-red-600 rounded-md border border-red-100 active:scale-95"
                        >
                          <X size={12} />
                        </button>
                      </>
                    ) : null}
                  </div>
                </div>
                )
              })
            )}
          </div>

          <div className="shrink-0 flex items-center justify-between px-4 py-2 border-t border-gray-100 bg-gray-50 text-xs">
            <span>{total === 0 ? 'No slips found' : `Showing ${page * PAGE_SIZE + 1}–${Math.min((page + 1) * PAGE_SIZE, total)} of ${total}`}</span>
            <div className="flex items-center gap-2">
              <button type="button" disabled={page === 0} onClick={() => setPage((p) => p - 1)} className="px-4 py-1.5 rounded-full text-sm font-semibold bg-gray-200 text-gray-700 hover:bg-gray-300 disabled:opacity-40">Previous</button>
              <span className="text-sm text-gray-500 font-medium px-1">Page {page + 1} of {totalPages}</span>
              <button type="button" disabled={page >= totalPages - 1 || total === 0} onClick={() => setPage((p) => p + 1)} className="px-4 py-1.5 rounded-full text-sm font-semibold bg-amber-600 text-white hover:bg-amber-700 disabled:opacity-40">Next</button>
            </div>
          </div>
        </div>
      </div>

      {viewExpense && (
        <div className="fixed inset-0 z-[450] bg-gray-900/40 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl overflow-hidden flex flex-col max-h-[92vh]">
            <div className="bg-gray-800 px-5 py-4 flex items-center justify-between text-white">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-amber-500 flex items-center justify-center font-black text-lg shadow-inner">
                  <ReceiptLongIcon sx={{ fontSize: 18, color: '#fff' }} />
                </div>
                <div>
                  <h2 className="font-bold text-lg leading-tight">{viewExpense.paid_to || 'Expense Slip'}</h2>
                  <p className="text-xs text-gray-400 font-mono tracking-tighter">{viewExpense.slip_number || 'No voucher #'}</p>
                </div>
              </div>
              <button type="button" onClick={() => setViewExpense(null)} className="text-gray-400 hover:text-white transition-colors p-1.5 hover:bg-white/10 rounded-lg">
                <X size={20} />
              </button>
            </div>

            <div className="p-4 grid grid-cols-2 md:grid-cols-4 gap-2.5">
              <div className="bg-gray-50 rounded-lg p-2 border border-gray-100 md:col-span-2">
                <p className="text-[9px] font-black text-gray-400 uppercase tracking-widest mb-0.5">Voucher No</p>
                <p className="text-xs font-bold text-gray-800 break-all">{viewExpense.slip_number || '--'}</p>
              </div>
              <div className="bg-amber-50 border border-amber-100 rounded-lg p-2 md:col-span-2">
                <p className="text-[9px] font-black text-amber-600/70 uppercase tracking-widest mb-0.5">Amount</p>
                <p className="text-lg font-black text-amber-700">₹{Number(viewExpense.total_amount || 0).toLocaleString('en-IN')}</p>
              </div>
              <div className="bg-gray-50 rounded-lg p-2 border border-gray-100">
                <p className="text-[9px] font-black text-gray-400 uppercase tracking-widest mb-0.5">Payment Mode</p>
                <p className="text-xs font-bold text-gray-800 uppercase">{viewExpense.payment_mode || '--'}</p>
              </div>
              <div className={`rounded-lg p-2 border ${viewExpense.source === 'other_funds' ? 'bg-slate-50 border-slate-200' : 'bg-green-50 border-green-100'}`}>
                <p className="text-[9px] font-black text-gray-400 uppercase tracking-widest mb-0.5">Source</p>
                <p className={`text-xs font-bold ${viewExpense.source === 'other_funds' ? 'text-slate-700' : 'text-green-700'}`}>{viewExpense.source === 'other_funds' ? 'Other Funds' : 'Collection'}</p>
              </div>
              <div className="bg-gray-50 rounded-lg p-2 border border-gray-100">
                <p className="text-[9px] font-black text-gray-400 uppercase tracking-widest mb-0.5">Recorded By</p>
                <p className="text-xs font-bold text-gray-800 truncate">{viewExpense.recorded_by_name || '--'}</p>
              </div>
              <div className="bg-gray-50 rounded-lg p-2 border border-gray-100 md:col-span-2">
                <p className="text-[9px] font-black text-gray-400 uppercase tracking-widest mb-0.5">Paid At</p>
                <p className="text-xs font-bold text-gray-800">{viewExpense.paid_at ? formatDateTime(viewExpense.paid_at, { paren: true }) : '--'}</p>
              </div>
              <div className="bg-gray-50 rounded-lg p-2 border border-gray-100 md:col-span-2">
                <p className="text-[9px] font-black text-gray-400 uppercase tracking-widest mb-0.5">Remarks</p>
                <p className="text-xs font-bold text-gray-800 break-all">{viewExpense.remarks || '--'}</p>
              </div>
            </div>

            <div className="px-4 pb-3 flex-1 min-h-0">
              <div className="bg-white rounded-xl border border-gray-100 overflow-hidden h-full flex flex-col">
                <div className="px-3 py-2 border-b border-gray-100 text-[10px] font-black text-gray-500 uppercase tracking-widest">Expense Items</div>
                {Array.isArray(viewExpense?.items) && viewExpense.items.length > 0 ? (
                  <div className="min-h-[240px] max-h-[44vh] overflow-y-auto">
                    <table className="w-full text-xs">
                      <thead className="bg-gray-50 text-gray-500 uppercase text-[10px] sticky top-0 z-10">
                        <tr>
                          <th className="text-left px-3 py-2">Description</th>
                          <th className="text-right px-3 py-2">Qty</th>
                          <th className="text-right px-3 py-2">Rate</th>
                          <th className="text-right px-3 py-2">Amount</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {viewExpense.items.map((it) => (
                          <tr key={it.id}>
                            <td className="px-3 py-2.5 text-gray-800">{it.description || '--'}</td>
                            <td className="px-3 py-2.5 text-right text-gray-600">{it.quantity || 0}</td>
                            <td className="px-3 py-2.5 text-right text-gray-600">₹{Number(it.unit_price || 0).toFixed(2)}</td>
                            <td className="px-3 py-2.5 text-right font-semibold text-gray-900">₹{Number(it.line_total || 0).toFixed(2)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="min-h-[240px] flex items-center justify-center text-sm text-gray-400">No items</div>
                )}
              </div>
            </div>

            <div className="p-5 border-t border-gray-100 bg-gray-50 flex gap-4">
              <button type="button" onClick={() => setViewExpense(null)} className="flex-1 py-3 px-4 rounded-xl font-black text-xs text-gray-500 hover:bg-white hover:text-gray-800 hover:shadow-md transition-all flex items-center justify-center gap-2 uppercase tracking-[0.2em] border border-transparent hover:border-gray-200 active:scale-95 group">
                <X size={16} className="group-hover:rotate-90 transition-transform duration-300" /> Close
              </button>
              {!isExpenseCancelled(viewExpense) ? (
                <>
                  <button type="button" onClick={() => onPrint(viewExpense)} className="flex-1 py-3 px-4 bg-indigo-600 text-white rounded-xl font-black text-xs hover:bg-indigo-700 transition-all shadow-md hover:shadow-xl hover:-translate-y-0.5 flex items-center justify-center gap-2 uppercase tracking-[0.2em] active:scale-95 group">
                    <Printer size={16} className="group-hover:scale-110 transition-transform" /> Print Slip
                  </button>
                  <button type="button" onClick={() => { openEditExpense(viewExpense); setViewExpense(null) }} className="flex-[1.5] py-3 px-4 bg-emerald-600 text-white rounded-xl font-black text-xs hover:bg-emerald-700 transition-all shadow-md hover:shadow-xl hover:-translate-y-0.5 flex items-center justify-center gap-2 uppercase tracking-[0.2em] active:scale-95 group">
                    <Edit2 size={16} className="group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-transform" /> Edit Slip Details
                  </button>
                </>
              ) : null}
            </div>
          </div>
        </div>
      )}

      {cancelExpense && (
        <div className="fixed inset-0 z-[460] bg-gray-900/50 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden">
            <div className="px-4 py-3 bg-red-600 text-white flex items-center justify-between">
              <h3 className="font-bold">Cancel Expense Slip</h3>
              <button type="button" onClick={() => { if (!cancelling) { setCancelExpense(null); setCancelReason('') } }} className="text-white/80 hover:text-white" disabled={cancelling}>
                <X size={18} />
              </button>
            </div>
            <div className="p-4 space-y-3">
              <p className="text-sm text-gray-700">
                You are cancelling slip <span className="font-black text-gray-900">{cancelExpense.slip_number || `#${cancelExpense.id}`}</span> for{' '}
                <span className="font-semibold">{cancelExpense.paid_to || 'Party'}</span> of amount <span className="font-black text-red-600">₹{Number(cancelExpense.total_amount || 0).toLocaleString('en-IN')}</span>. This will mark the slip as cancelled.
              </p>
              <div>
                <label className="block text-xs font-bold text-gray-600 mb-1">Cancellation Reason *</label>
                <textarea
                  value={cancelReason}
                  onChange={(e) => setCancelReason(e.target.value)}
                  onKeyDown={(e) => handleCancelReasonKeyDown(e, submitCancel, { disabled: cancelling })}
                  rows={4}
                  className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:border-red-500 focus:ring-1 focus:ring-red-500 outline-none resize-none"
                  placeholder="Enter reason for cancellation"
                  disabled={cancelling}
                />
              </div>
            </div>
            <div className="p-4 border-t border-gray-100 flex justify-end gap-2 bg-gray-50">
              <button type="button" onClick={() => { if (!cancelling) { setCancelExpense(null); setCancelReason('') } }} disabled={cancelling} className="px-4 py-2 rounded-xl text-sm font-bold text-gray-600 hover:bg-gray-200 transition-colors disabled:opacity-60">Close</button>
              <button type="button" onClick={submitCancel} disabled={cancelling} className="px-4 py-2 rounded-xl text-sm font-bold bg-red-600 text-white hover:bg-red-700 transition-colors disabled:opacity-60">
                {cancelling ? 'Cancelling...' : 'Confirm Cancel'}
              </button>
            </div>
          </div>
        </div>
      )}

      {editingExpense && (
        <div className="fixed inset-0 z-[460] bg-gray-900/40 backdrop-blur-sm flex items-center justify-center p-4">
          <form onSubmit={handleSaveEdit} className="bg-white rounded-2xl shadow-xl w-full max-w-lg overflow-hidden flex flex-col max-h-[92vh]">
            <div className="bg-emerald-600 px-4 py-3 flex items-center justify-between pointer-events-none">
              <h2 className="text-white font-bold pointer-events-auto">Edit Expense Slip</h2>
              <button type="button" onClick={() => setEditingExpense(null)} className="text-white/80 hover:text-white pointer-events-auto"><X size={18} /></button>
            </div>
            <div className="p-4 overflow-y-auto space-y-4">
              <div className="bg-gray-50 border border-gray-200 rounded-xl p-3 grid grid-cols-3 gap-3">
                <div>
                  <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-0.5">Paid To</p>
                  <p className="text-xs font-bold text-gray-800 truncate">{editingExpense.paid_to || '—'}</p>
                </div>
                <div>
                  <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-0.5">Voucher No</p>
                  <p className="text-xs font-bold text-gray-800 break-all">{editingExpense.slip_number || '—'}</p>
                </div>
                <div>
                  <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-0.5">Recorded By</p>
                  <p className="text-xs font-bold text-gray-800 truncate">{editingExpense.recorded_by_name || '—'}</p>
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-gray-600 mb-1">Paid At</label>
                <input type="datetime-local" value={editingExpense.paid_at || ''} onChange={(e) => setEditingExpense({ ...editingExpense, paid_at: e.target.value })} className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 outline-none" />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-gray-600 mb-1">Total (₹)</label>
                  <input
                    type="text"
                    readOnly
                    value={computeExpenseEditTotal(editingExpense._editItems, editingExpense._discount).toFixed(2)}
                    className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm bg-gray-50 text-gray-700 outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-600 mb-1">Payment Mode</label>
                  <select value={editingExpense.payment_mode || 'cash'} onChange={(e) => setEditingExpense({ ...editingExpense, payment_mode: e.target.value })} className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 outline-none">
                    <option value="cash">Cash</option>
                    <option value="upi">UPI</option>
                    <option value="card">Card</option>
                    <option value="bank_transfer">Bank Transfer</option>
                    <option value="other">Other</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-bold text-gray-600 mb-1">Discount (₹)</label>
                  <input type="number" min="0" step="0.01" value={editingExpense._discount ?? 0} onChange={(e) => setEditingExpense({ ...editingExpense, _discount: e.target.value })} className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 outline-none" />
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-600 mb-1">Source</label>
                  <div className="flex gap-1">
                    {[['collection', 'Collection'], ['other_funds', 'Other Funds']].map(([v, l]) => (
                      <button
                        key={v}
                        type="button"
                        onClick={() => setEditingExpense({ ...editingExpense, source: v })}
                        className={`flex-1 py-2 rounded-lg border text-xs font-medium transition-colors ${
                          (editingExpense.source || 'collection') === v
                            ? v === 'collection' ? 'bg-green-600 text-white border-green-600' : 'bg-slate-600 text-white border-slate-600'
                            : 'border-gray-200 text-gray-600 hover:border-gray-400'
                        }`}
                      >
                        {l}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-600 mb-1">Status</label>
                  <input type="text" readOnly value={editingExpense.status || 'success'} className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm bg-gray-50 text-gray-700 capitalize outline-none" />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-gray-600 mb-1">Remarks</label>
                <input type="text" value={editingExpense.remarks || ''} onChange={(e) => setEditingExpense({ ...editingExpense, remarks: e.target.value })} className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 outline-none" placeholder="Notes, reference, etc." />
              </div>

              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-xs font-bold text-gray-600">Expense Items</label>
                  <button
                    type="button"
                    onClick={() => setEditingExpense((prev) => ({ ...prev, _editItems: [...(prev._editItems || []), { description: '', category: '', quantity: '1', unit_price: '0' }] }))}
                    className="text-xs font-bold text-emerald-600 hover:text-emerald-700 flex items-center gap-1 px-2 py-0.5 rounded-lg hover:bg-emerald-50 transition-colors border border-emerald-200"
                  >
                    <Plus size={11} /> Add Item
                  </button>
                </div>
                <div className="border border-gray-200 rounded-xl overflow-hidden">
                  <div className="grid grid-cols-12 bg-gray-100 px-2 py-1.5 text-[10px] font-black text-gray-500 uppercase tracking-widest">
                    <div className="col-span-5">Description</div>
                    <div className="col-span-2">Category</div>
                    <div className="col-span-2 text-center">Qty</div>
                    <div className="col-span-2 text-right">Price</div>
                    <div className="col-span-1" />
                  </div>
                  {(editingExpense._editItems || []).map((item, idx) => {
                    const lineTotal = (Number(item.quantity) || 0) * (Number(item.unit_price) || 0)
                    return (
                      <div key={idx} className="grid grid-cols-12 gap-1 px-2 py-1.5 border-t border-gray-100 items-center">
                        <div className="col-span-5">
                          <input
                            ref={(el) => { itemDescRefs.current[idx] = el }}
                            type="text"
                            value={item.description}
                            onChange={(e) => {
                              const next = [...editingExpense._editItems]
                              next[idx] = { ...next[idx], description: e.target.value }
                              setEditingExpense((prev) => ({ ...prev, _editItems: next }))
                              const rect = itemDescRefs.current[idx]?.getBoundingClientRect()
                              if (rect) setItemDropdownPos({ top: rect.bottom + 4, left: rect.left, width: Math.max(rect.width, 240) })
                              setItemDropdownIdx(idx)
                            }}
                            onFocus={() => {
                              const rect = itemDescRefs.current[idx]?.getBoundingClientRect()
                              if (rect) setItemDropdownPos({ top: rect.bottom + 4, left: rect.left, width: Math.max(rect.width, 240) })
                              setItemDropdownIdx(idx)
                            }}
                            onBlur={() => setTimeout(() => setItemDropdownIdx(null), 160)}
                            placeholder="Service name or type to search…"
                            className="w-full border border-gray-200 rounded-lg px-2 py-1 text-xs focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 outline-none"
                          />
                        </div>
                        <div className="col-span-2">
                          <input
                            type="text"
                            value={item.category}
                            onChange={(e) => {
                              const next = [...editingExpense._editItems]
                              next[idx] = { ...next[idx], category: e.target.value }
                              setEditingExpense((prev) => ({ ...prev, _editItems: next }))
                            }}
                            placeholder="Category"
                            className="w-full border border-gray-200 rounded-lg px-2 py-1 text-xs focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 outline-none"
                          />
                        </div>
                        <div className="col-span-2">
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            value={item.quantity}
                            onChange={(e) => {
                              const next = [...editingExpense._editItems]
                              next[idx] = { ...next[idx], quantity: e.target.value }
                              setEditingExpense((prev) => ({ ...prev, _editItems: next }))
                            }}
                            className="w-full border border-gray-200 rounded-lg px-2 py-1 text-xs text-center focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 outline-none"
                          />
                        </div>
                        <div className="col-span-2">
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            value={item.unit_price}
                            onChange={(e) => {
                              const next = [...editingExpense._editItems]
                              next[idx] = { ...next[idx], unit_price: e.target.value }
                              setEditingExpense((prev) => ({ ...prev, _editItems: next }))
                            }}
                            className="w-full border border-gray-200 rounded-lg px-2 py-1 text-xs text-right focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 outline-none"
                          />
                        </div>
                        <div className="col-span-1 flex justify-end">
                          {editingExpense._editItems.length > 1 && (
                            <button
                              type="button"
                              onClick={() => {
                                const next = editingExpense._editItems.filter((_, i) => i !== idx)
                                setEditingExpense((prev) => ({ ...prev, _editItems: next }))
                              }}
                              className="text-red-400 hover:text-red-600 transition-colors p-0.5"
                            >
                              <Trash2 size={12} />
                            </button>
                          )}
                        </div>
                        {lineTotal > 0 && (
                          <div className="col-span-12 text-right text-[10px] text-gray-400 pr-5 -mt-0.5">
                            = ₹{lineTotal.toFixed(2)}
                          </div>
                        )}
                      </div>
                    )
                  })}
                  <div className="px-2 py-1.5 bg-gray-50 border-t border-gray-200 flex justify-between items-center">
                    <span className="text-[10px] text-gray-400 font-semibold">
                      {editingExpense._editItems?.length || 0} item(s)
                    </span>
                    <span className="text-xs font-black text-emerald-700">
                      Total: ₹{computeExpenseEditTotal(editingExpense._editItems, editingExpense._discount).toFixed(2)}
                    </span>
                  </div>
                </div>
              </div>
            </div>
            <div className="p-4 border-t border-gray-100 flex gap-2 justify-end bg-gray-50 mt-auto shrink-0">
              <button type="button" onClick={() => setEditingExpense(null)} className="px-4 py-2 rounded-xl text-sm font-bold text-gray-600 hover:bg-gray-200 transition-colors">Close</button>
              <button type="submit" className="px-4 py-2 rounded-xl text-sm font-bold bg-emerald-600 text-white hover:bg-emerald-700 transition-colors">Save Changes</button>
            </div>
          </form>
        </div>
      )}

      {itemDropdownIdx !== null && itemDropdownPos && editingExpense && (() => {
        const item = editingExpense._editItems?.[itemDropdownIdx]
        if (!item) return null
        const descLower = (item.description || '').toLowerCase()
        const filteredSvc = quickServices.filter((s) => !descLower || s.label.toLowerCase().includes(descLower))
        if (filteredSvc.length === 0) return null

        const grouped = {}
        filteredSvc.forEach((svc) => {
          const cat = svc.category || 'Custom'
          if (!grouped[cat]) grouped[cat] = []
          grouped[cat].push(svc)
        })
        const categories = Object.keys(grouped)

        return createPortal(
          <div
            style={{ position: 'fixed', top: itemDropdownPos.top, left: itemDropdownPos.left, width: Math.max(itemDropdownPos.width, 280), zIndex: 9999 }}
            className="bg-white border border-gray-200 rounded-xl shadow-2xl max-h-64 overflow-y-auto"
          >
            {categories.map((cat, ci) => (
              <div key={ci}>
                {ci > 0 && <div className="border-t-2 border-gray-200" />}
                <div className="sticky top-0 px-3 py-1.5 bg-gray-100 border-b border-gray-200 flex items-center gap-2">
                  <span className="text-[9px] font-black text-gray-600 uppercase tracking-widest bg-gray-300 px-2 py-0.5 rounded">{cat}</span>
                  <span className="text-[9px] text-gray-400 font-medium">{grouped[cat].length} item{grouped[cat].length !== 1 ? 's' : ''}</span>
                </div>
                {grouped[cat].map((svc, si) => (
                  <button
                    key={si}
                    type="button"
                    onMouseDown={(e) => {
                      e.preventDefault()
                      const next = [...editingExpense._editItems]
                      next[itemDropdownIdx] = {
                        ...next[itemDropdownIdx],
                        description: svc.label,
                        category: svc.category || '',
                        unit_price: String(svc.price ?? 0),
                      }
                      setEditingExpense((prev) => ({ ...prev, _editItems: next }))
                      setItemDropdownIdx(null)
                    }}
                    className="w-full text-left px-4 py-2 hover:bg-emerald-50 flex items-center justify-between gap-2 border-b border-gray-50 last:border-0 transition-colors"
                  >
                    <p className="text-xs font-semibold text-gray-800 truncate">{svc.label}</p>
                    <span className="text-xs font-black text-emerald-600 shrink-0">₹{Number(svc.price || 0).toFixed(2)}</span>
                  </button>
                ))}
              </div>
            ))}
          </div>,
          document.body,
        )
      })()}
    </>,
    document.body,
  )
}

export default function ExpenseSection() {
  const [paidTo, setPaidTo] = useState('')
  const [remarks, setRemarks] = useState('')
  const [items, setItems] = useState([{ description: '', unit_price: '', quantity: 1, category: '' }])
  const [discount, setDiscount] = useState('')
  const [paymentMode, setPaymentMode] = useState('cash')
  const [expenseSource, setExpenseSource] = useState('collection')
  const [paidAt, setPaidAt] = useState(() => toDateTimeInputValue(new Date()))
  const [submitting, setSubmitting] = useState(false)
  const [drawerOpen, setDrawerOpen] = useState(false)

  const [activeServiceSearchRow, setActiveServiceSearchRow] = useState(null)
  const [quickServices, setQuickServices] = useState(DEFAULT_EXPENSE_QUICK_SERVICES)
  const [quickCategoryExtras, setQuickCategoryExtras] = useState([])
  const [activeQuickCategory, setActiveQuickCategory] = useState(EXPENSE_QUICK_ALL_CATEGORY)
  const [showQuickServiceEditor, setShowQuickServiceEditor] = useState(false)
  const [newQuickLabel, setNewQuickLabel] = useState('')
  const [newQuickPrice, setNewQuickPrice] = useState('')
  const [newQuickCategory, setNewQuickCategory] = useState(EXPENSE_QUICK_DEFAULT_CATEGORY)
  const [newQuickCategoryName, setNewQuickCategoryName] = useState('')
  const [editorQuickCategory, setEditorQuickCategory] = useState(EXPENSE_QUICK_DEFAULT_CATEGORY)
  const [showCategoryCreator, setShowCategoryCreator] = useState(false)
  const [showQuickItemCreator, setShowQuickItemCreator] = useState(false)
  const [draggingQuickIndex, setDraggingQuickIndex] = useState(null)

  useEffect(() => {
    loadReceptionPortalProfileCache()
    let cancelled = false
    ;(async () => {
      const { services, categories } = await loadExpenseQuickServices()
      if (cancelled) return
      if (services) setQuickServices(services)
      if (categories?.length > 0) setQuickCategoryExtras(categories)
    })()
    return () => { cancelled = true }
  }, [])

  async function persistQuickServices(nextList, extraCategoriesOverride = null) {
    const payload = normalizeExpenseQuickServices(nextList)
    const categorySet = new Set([EXPENSE_QUICK_DEFAULT_CATEGORY])
    const extraCategories = Array.isArray(extraCategoriesOverride) ? extraCategoriesOverride : quickCategoryExtras
    extraCategories.forEach((c) => categorySet.add(String(c || '').trim()))
    payload.forEach((svc) => categorySet.add(String(svc.category || EXPENSE_QUICK_DEFAULT_CATEGORY).trim() || EXPENSE_QUICK_DEFAULT_CATEGORY))
    const categoriesPayload = Array.from(categorySet).filter((c) => c && c !== EXPENSE_QUICK_ALL_CATEGORY)
    setQuickServices(payload)
    localStorage.setItem(EXPENSE_QUICK_SERVICES_STORAGE_KEY, JSON.stringify(payload))
    try {
      await api.put('/expenses/quick-services/', { services: payload, categories: categoriesPayload })
    } catch {
      toast.error('Could not sync expense quick services to server')
    }
  }

  const quickServiceCategories = useMemo(() => {
    const seen = new Set([EXPENSE_QUICK_DEFAULT_CATEGORY])
    quickCategoryExtras.forEach((cat) => seen.add(String(cat || '').trim()))
    quickServices.forEach((svc) => seen.add(String(svc.category || EXPENSE_QUICK_DEFAULT_CATEGORY)))
    return [EXPENSE_QUICK_ALL_CATEGORY, ...Array.from(seen)]
  }, [quickCategoryExtras, quickServices])

  const visibleQuickServices = useMemo(() => {
    if (activeQuickCategory === EXPENSE_QUICK_ALL_CATEGORY) return quickServices
    return quickServices.filter((svc) => String(svc.category || EXPENSE_QUICK_DEFAULT_CATEGORY) === activeQuickCategory)
  }, [activeQuickCategory, quickServices])

  useEffect(() => {
    if (!quickServiceCategories.includes(activeQuickCategory)) {
      setActiveQuickCategory(EXPENSE_QUICK_ALL_CATEGORY)
    }
  }, [activeQuickCategory, quickServiceCategories])

  useEffect(() => {
    const allowed = quickServiceCategories.filter((c) => c !== EXPENSE_QUICK_ALL_CATEGORY)
    if (!allowed.includes(newQuickCategory)) {
      setNewQuickCategory(EXPENSE_QUICK_DEFAULT_CATEGORY)
    }
  }, [newQuickCategory, quickServiceCategories])

  useEffect(() => {
    const allowed = quickServiceCategories.filter((c) => c !== EXPENSE_QUICK_ALL_CATEGORY)
    if (!allowed.includes(editorQuickCategory)) {
      setEditorQuickCategory(EXPENSE_QUICK_DEFAULT_CATEGORY)
    }
  }, [editorQuickCategory, quickServiceCategories])

  const editorCategories = useMemo(
    () => quickServiceCategories.filter((c) => c !== EXPENSE_QUICK_ALL_CATEGORY),
    [quickServiceCategories],
  )

  const editorQuickRows = useMemo(
    () => quickServices
      .map((svc, idx) => ({ svc, idx }))
      .filter(({ svc }) => String(svc.category || EXPENSE_QUICK_DEFAULT_CATEGORY) === editorQuickCategory),
    [editorQuickCategory, quickServices],
  )

  function addQuickService() {
    const label = newQuickLabel.trim()
    const price = parseFloat(newQuickPrice)
    const category = (newQuickCategory || EXPENSE_QUICK_DEFAULT_CATEGORY).trim()
    if (!label) { toast.error('Service label is required'); return }
    if (Number.isNaN(price) || price < 0) { toast.error('Enter valid price'); return }
    if (!category) { toast.error('Select category'); return }
    setQuickServices((prev) => [...prev, { label, price, category }])
    setNewQuickLabel('')
    setNewQuickPrice('')
    setShowQuickItemCreator(false)
  }

  function addQuickCategory() {
    const normalized = newQuickCategoryName.trim()
    if (!normalized) {
      toast.error('Category name is required')
      return
    }
    const exists = quickServiceCategories.some((cat) => cat.toLowerCase() === normalized.toLowerCase())
    if (exists) {
      toast.error('Category already exists')
      return
    }
    setNewQuickCategory(normalized)
    setActiveQuickCategory(normalized)
    setEditorQuickCategory(normalized)
    const mergedCategories = Array.from(new Set([...quickCategoryExtras, normalized]))
    setQuickCategoryExtras(mergedCategories)
    localStorage.setItem(EXPENSE_QUICK_CATEGORIES_STORAGE_KEY, JSON.stringify(mergedCategories))
    setNewQuickCategoryName('')
    setShowCategoryCreator(false)
    toast.success('Category added')
  }

  function removeQuickService(index) {
    setQuickServices((prev) => prev.filter((_, i) => i !== index))
  }

  function handleQuickServiceDrop(targetIndex) {
    if (draggingQuickIndex === null || draggingQuickIndex === targetIndex) return
    setQuickServices((prev) => {
      if (draggingQuickIndex < 0 || draggingQuickIndex >= prev.length) return prev
      if (targetIndex < 0 || targetIndex >= prev.length) return prev
      const copy = [...prev]
      const [moved] = copy.splice(draggingQuickIndex, 1)
      copy.splice(targetIndex, 0, moved)
      return copy
    })
    setDraggingQuickIndex(null)
  }

  const searchableServiceItems = useMemo(() => {
    const seen = new Set()
    const out = []
    quickServices.forEach((svc) => {
      const label = String(svc?.label || '').trim()
      const price = Number(svc?.price || 0)
      if (!label || !Number.isFinite(price) || price < 0) return
      const key = label.toLowerCase()
      if (seen.has(key)) return
      seen.add(key)
      out.push({
        label,
        price,
        category: String(svc?.category || EXPENSE_QUICK_DEFAULT_CATEGORY).trim() || EXPENSE_QUICK_DEFAULT_CATEGORY,
      })
    })
    return out
  }, [quickServices])

  function applyServiceSuggestion(rowIndex, suggestion) {
    const category = String(suggestion.category || EXPENSE_QUICK_DEFAULT_CATEGORY).trim() || EXPENSE_QUICK_DEFAULT_CATEGORY
    setItems((prev) => {
      const next = prev.map((it, idx) =>
        idx === rowIndex
          ? { ...it, description: suggestion.label, unit_price: String(suggestion.price), category }
          : it,
      )
      const hasEmptyRow = next.some((it) => !String(it.description || '').trim())
      if (!hasEmptyRow) {
        next.push({ description: '', unit_price: '', quantity: 1, category: '' })
      }
      return next
    })
    setActiveServiceSearchRow(null)
  }

  const consolidatedItems = useMemo(() => consolidateExpenseItems(items), [items])
  const subtotal = consolidatedItems.reduce((sum, it) => sum + resolvePaymentSlipLineTotal(it), 0)
  const discountAmt = Math.min(parseFloat(discount) || 0, subtotal)
  const total = subtotal - discountAmt

  function addItem() {
    setItems((prev) => [...prev, { description: '', unit_price: '', quantity: 1, category: '' }])
  }

  function removeItem(i) {
    setItems((prev) => {
      if (prev.length <= 1) return [{ description: '', unit_price: '', quantity: 1, category: '' }]
      const next = prev.filter((_, idx) => idx !== i)
      return next.length > 0 ? next : [{ description: '', unit_price: '', quantity: 1, category: '' }]
    })
  }

  function updateItem(i, field, val) {
    if (field === 'unit_price' || field === 'quantity') {
      if (val === '') {
        setItems((prev) => prev.map((it, idx) => (idx === i ? { ...it, [field]: val } : it)))
        return
      }
      const numericVal = Number(val)
      if (!Number.isFinite(numericVal) || numericVal < 0) return
    }
    setItems((prev) => prev.map((it, idx) => (idx === i ? { ...it, [field]: val } : it)))
  }

  function quickAdd(svc) {
    const label = String(svc.label || '').trim()
    const price = Number(svc.price)
    const category = String(svc.category || EXPENSE_QUICK_DEFAULT_CATEGORY).trim() || EXPENSE_QUICK_DEFAULT_CATEGORY
    setItems((prev) => {
      const empty = prev.findIndex((it) => !it.description)
      if (empty !== -1) {
        return prev.map((it, i) => (i === empty ? { description: label, unit_price: String(price), quantity: 1, category } : it))
      }
      return [...prev, { description: label, unit_price: String(price), quantity: 1, category }]
    })
  }

  function resetForm() {
    setPaidTo('')
    setRemarks('')
    setItems([{ description: '', unit_price: '', quantity: 1, category: '' }])
    setDiscount('')
    setPaymentMode('cash')
    setExpenseSource('collection')
    setPaidAt(toDateTimeInputValue(new Date()))
  }

  function printExpense(row) {
    printExpenseVoucherImmediately(row, { profile: getPaymentSlipProfile() })
  }

  async function handleSubmit(e) {
    e.preventDefault()
    if (!paidTo.trim()) {
      toast.error('Paid to is required')
      return
    }
    const validItems = consolidatedItems
    if (!validItems.length) {
      toast.error('Add at least one item with a price')
      return
    }
    if (!paidAt || !dateTimeInputToIso(paidAt)) {
      toast.error('Enter a valid payment date and time')
      return
    }

    setSubmitting(true)
    try {
      const { data } = await api.post('/expenses/', {
        paid_at: dateTimeInputToIso(paidAt),
        paid_to: paidTo.trim(),
        payment_mode: paymentMode,
        source: expenseSource,
        remarks: remarks.trim(),
        discount_amount: discountAmt.toFixed(2),
        items: validItems.map((it) => ({
          description: it.description,
          quantity: it.quantity,
          unit_price: it.unit_price,
          category: it.category || '',
        })),
      })
      const expense = data?.data || data?.entity || data
      toast.success(`Expense voucher ${expense.slip_number} created`)
      printExpenseVoucherImmediately(expense, {
        profile: getPaymentSlipProfile(),
        onComplete: resetForm,
      })
    } catch (err) {
      const msg = err?.response?.data?.errors
        ? JSON.stringify(err.response.data.errors)
        : (err?.response?.data?.detail || 'Failed to create expense')
      toast.error(msg)
    } finally {
      setSubmitting(false)
    }
  }

  const inp = 'w-full border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:ring-2 focus:ring-amber-500 focus:outline-none'
  const itemInp = 'w-full border border-gray-200 rounded-md px-2 py-1 text-[11px] leading-tight text-gray-900 placeholder:text-gray-400 focus:ring-2 focus:ring-amber-500 focus:outline-none'

  return (
    <div className="flex-1 min-h-0 flex flex-col gap-3 overflow-hidden">
      <div className="flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2">
          <ReceiptLongIcon sx={{ fontSize: 18, color: '#b45309' }} />
          <h2 className="text-base font-semibold text-gray-900">Expense</h2>
        </div>
        <button
          type="button"
          onClick={() => setDrawerOpen(true)}
          className="flex items-center gap-1.5 text-sm font-bold text-amber-800 px-4 py-2 rounded-lg border border-amber-200 bg-amber-50 hover:bg-amber-100"
        >
          <ListIcon sx={{ fontSize: 18 }} />
          List
        </button>
      </div>

      <form onSubmit={handleSubmit} className="flex-1 min-h-0 grid grid-cols-[3fr_2fr] grid-rows-1 gap-3 overflow-hidden min-w-0">
        <div className="flex flex-col gap-3 min-h-0 h-full min-w-0 overflow-hidden">
          <div className="bg-white rounded-xl border border-gray-200 p-3 shrink-0">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Paid to</p>
            <ExpensePartyField value={paidTo} onChange={setPaidTo} inputClassName={inp} />
          </div>

          <div className="bg-white rounded-xl border border-gray-200 p-3 shrink-0">
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Quick Add</p>
              <button
                type="button"
                onClick={() => {
                  const initial = activeQuickCategory === EXPENSE_QUICK_ALL_CATEGORY ? EXPENSE_QUICK_DEFAULT_CATEGORY : activeQuickCategory
                  setEditorQuickCategory(initial)
                  setShowCategoryCreator(false)
                  setShowQuickItemCreator(false)
                  setNewQuickCategory(initial)
                  setShowQuickServiceEditor(true)
                }}
                className="text-[11px] font-bold text-indigo-600 hover:text-indigo-800 px-2 py-1 rounded border border-indigo-200 bg-indigo-50"
              >
                Edit Quick Add
              </button>
            </div>
            <div className="flex flex-wrap gap-1.5 mb-2 pb-2 border-b border-gray-200">
              {quickServiceCategories.map((category) => (
                <button
                  key={category}
                  type="button"
                  onClick={() => setActiveQuickCategory(category)}
                  className={`text-[11px] px-2.5 py-1 rounded-md border transition-colors ${
                    activeQuickCategory === category
                      ? 'border-amber-600 bg-amber-600 text-white'
                      : 'border-gray-200 bg-gray-50 text-gray-600 hover:border-amber-300'
                  }`}
                >
                  {category}
                </button>
              ))}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {visibleQuickServices.map((svc, idx) => (
                <button
                  key={`${svc.category}-${svc.label}-${idx}`}
                  type="button"
                  onClick={() => quickAdd(svc)}
                  className="text-[11px] px-2.5 py-1 rounded-full border border-gray-200 bg-gray-50 hover:border-amber-400 hover:bg-amber-50 text-gray-600"
                >
                  {svc.label} <span className="text-gray-400">₹{svc.price}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="bg-white rounded-xl border border-gray-200 p-3 flex-1 min-h-0 flex flex-col overflow-hidden">
            <div className="flex items-center justify-between mb-1 shrink-0">
              <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide">Items</p>
              <button
                type="button"
                onClick={addItem}
                className="text-xs font-bold text-amber-700 flex items-center gap-1 px-2.5 py-1 rounded-lg border border-amber-300 bg-amber-50 hover:bg-amber-100"
              >
                <AddIcon sx={{ fontSize: 14 }} /> Add
              </button>
            </div>
            <div className="grid grid-cols-12 gap-1 text-[9px] font-semibold text-gray-400 uppercase tracking-wide py-1.5 px-0.5 border-b border-gray-300 mb-1 shrink-0">
              <div className="col-span-6">Description</div>
              <div className="col-span-2 text-center">Qty</div>
              <div className="col-span-3">₹ Price</div>
              <div className="col-span-1" />
            </div>
            <div className="space-y-1 overflow-y-auto overscroll-contain flex-1 min-h-0">
              {[...items].reverse().map((it, revI) => {
                const i = items.length - 1 - revI
                return (
                  <div key={i} className="grid grid-cols-12 gap-1 items-center">
                    {(() => {
                      const q = String(it.description || '').trim().toLowerCase()
                      const suggestions = q
                        ? searchableServiceItems.filter((s) => s.label.toLowerCase().includes(q)).slice(0, 8)
                        : []
                      const showSuggestions = activeServiceSearchRow === i && suggestions.length > 0
                      return (
                        <div className="col-span-6 relative">
                          <input
                            className={itemInp}
                            placeholder="Description"
                            value={it.description}
                            onFocus={() => setActiveServiceSearchRow(i)}
                            onBlur={() => setTimeout(() => setActiveServiceSearchRow((prev) => (prev === i ? null : prev)), 120)}
                            onChange={(e) => {
                              updateItem(i, 'description', e.target.value)
                              setActiveServiceSearchRow(i)
                            }}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' && suggestions.length > 0) {
                                e.preventDefault()
                                applyServiceSuggestion(i, suggestions[0])
                              }
                            }}
                          />
                          {showSuggestions && (
                            <div className="absolute z-20 mt-1 w-full bg-white border border-gray-200 rounded-lg shadow-lg max-h-40 overflow-y-auto">
                              {suggestions.map((s, idx) => (
                                <button
                                  key={`${s.label}-${idx}`}
                                  type="button"
                                  onMouseDown={(e) => e.preventDefault()}
                                  onClick={() => applyServiceSuggestion(i, s)}
                                  className="w-full px-2 py-1.5 text-left text-xs hover:bg-amber-50 flex items-center justify-between"
                                >
                                  <span className="text-gray-700 truncate">{s.label}</span>
                                  <span className="text-gray-400 ml-2 shrink-0">₹{s.price}</span>
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                      )
                    })()}
                    <input type="number" min="1" className={`${itemInp} col-span-2 text-center`} value={it.quantity} onChange={(e) => updateItem(i, 'quantity', e.target.value)} />
                    <input type="number" min="0" step="1" className={`${itemInp} col-span-3`} placeholder="0" value={it.unit_price} onChange={(e) => updateItem(i, 'unit_price', e.target.value)} />
                    <button
                      type="button"
                      onClick={() => removeItem(i)}
                      className="col-span-1 flex justify-center items-center p-1 rounded-md border border-rose-200 text-rose-400 hover:bg-rose-50 hover:text-rose-600 hover:border-rose-400 transition-colors"
                    >
                      <DeleteIcon sx={{ fontSize: 14 }} />
                    </button>
                  </div>
                )
              })}
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-3 min-h-0 h-full min-w-0 overflow-y-auto">
          <div className="bg-white rounded-xl border border-gray-200 p-3 shrink-0 space-y-3">
            <div>
              <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Payment mode</label>
              <div className="flex gap-1.5 flex-wrap mt-1">
                {[
                  ['cash', 'Cash'],
                  ['upi', 'UPI'],
                  ['card', 'Card'],
                  ['bank_transfer', 'Bank'],
                  ['other', 'Other'],
                ].map(([v, l]) => (
                  <button
                    key={v}
                    type="button"
                    onClick={() => setPaymentMode(v)}
                    className={`flex-1 py-1.5 rounded-lg border text-xs font-medium transition-colors ${
                      paymentMode === v
                        ? 'bg-amber-600 text-white border-amber-600'
                        : 'border-gray-200 text-gray-600 hover:border-amber-300'
                    }`}
                  >
                    {l}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Source</label>
              <div className="flex gap-1.5 mt-1">
                <button
                  type="button"
                  onClick={() => setExpenseSource('collection')}
                  className={`flex-1 py-1.5 rounded-lg border text-xs font-medium transition-colors ${
                    expenseSource === 'collection'
                      ? 'bg-green-600 text-white border-green-600'
                      : 'border-gray-200 text-gray-600 hover:border-green-300'
                  }`}
                >
                  Collection
                </button>
                <button
                  type="button"
                  onClick={() => setExpenseSource('other_funds')}
                  className={`flex-1 py-1.5 rounded-lg border text-xs font-medium transition-colors ${
                    expenseSource === 'other_funds'
                      ? 'bg-slate-600 text-white border-slate-600'
                      : 'border-gray-200 text-gray-600 hover:border-slate-300'
                  }`}
                >
                  Other Funds
                </button>
              </div>
            </div>
            <div>
              <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Paid at</label>
              <input type="datetime-local" value={paidAt} onChange={(e) => setPaidAt(e.target.value)} className={`${inp} mt-1`} />
            </div>
            <div>
              <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Discount (optional)</label>
              <input type="number" min="0" step="0.01" value={discount} onChange={(e) => setDiscount(e.target.value)} className={`${inp} mt-1`} />
            </div>
            <div>
              <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Remarks (optional)</label>
              <textarea value={remarks} onChange={(e) => setRemarks(e.target.value)} rows={2} className={`${inp} mt-1 resize-none`} />
            </div>
          </div>

          <div className="bg-amber-50 rounded-xl border border-amber-200 p-3 shrink-0">
            <div className="flex justify-between text-sm text-gray-600"><span>Subtotal</span><span>₹{subtotal.toFixed(2)}</span></div>
            <div className="flex justify-between text-sm text-rose-600"><span>Discount</span><span>₹{discountAmt.toFixed(2)}</span></div>
            <div className="flex justify-between text-base font-black text-amber-900 mt-2 pt-2 border-t border-amber-200">
              <span>Total</span><span>₹{total.toFixed(2)}</span>
            </div>
          </div>

          <button
            type="submit"
            disabled={submitting}
            className="shrink-0 w-full py-3 rounded-xl bg-amber-600 hover:bg-amber-700 text-white font-bold text-sm disabled:opacity-50"
          >
            {submitting ? 'Saving…' : 'Save & Print Voucher'}
          </button>
        </div>
      </form>

      {showQuickServiceEditor && (
        <div className="fixed inset-0 z-[350] bg-black/40 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl overflow-hidden">
            <div className="bg-indigo-600 px-4 py-3 flex items-center justify-between">
              <h3 className="text-white font-bold">Edit Quick Add Services</h3>
              <button
                type="button"
                onClick={() => { setShowCategoryCreator(false); setShowQuickItemCreator(false); setShowQuickServiceEditor(false) }}
                className="text-white/80 hover:text-white"
              >
                <X size={18} />
              </button>
            </div>
            <div className="p-4 space-y-3 max-h-[75vh] overflow-y-auto">
              <div className="sticky top-0 z-10 rounded-xl border border-indigo-100 bg-white/95 backdrop-blur p-3 space-y-2 shadow-sm">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-[11px] font-black text-indigo-700 uppercase tracking-wide">Categories</p>
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => {
                        setNewQuickCategory(editorQuickCategory)
                        setShowQuickItemCreator((v) => !v)
                      }}
                      className="text-[11px] px-2.5 py-1 rounded-full border border-indigo-300 bg-indigo-100 text-indigo-700 font-bold hover:bg-indigo-200"
                    >
                      + Add Item
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowCategoryCreator((v) => !v)}
                      className="text-[11px] px-2.5 py-1 rounded-full border border-emerald-300 bg-emerald-100 text-emerald-700 font-bold hover:bg-emerald-200"
                    >
                      + Add Category
                    </button>
                  </div>
                </div>
                <div className="flex items-center gap-2 overflow-x-auto pb-1">
                  {editorCategories.map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => { setEditorQuickCategory(c); setNewQuickCategory(c) }}
                      className={`text-[11px] px-2.5 py-1 rounded-full border font-semibold transition-colors ${
                        editorQuickCategory === c
                          ? 'border-indigo-600 bg-indigo-600 text-white'
                          : 'border-indigo-200 bg-white text-indigo-700 hover:border-indigo-300'
                      }`}
                    >
                      <span className="inline-flex items-center gap-1 whitespace-nowrap">
                        <Tag size={12} />
                        {c}
                      </span>
                    </button>
                  ))}
                </div>
                {showQuickItemCreator && (
                  <div className="grid grid-cols-12 gap-2">
                    <input
                      value={newQuickLabel}
                      onChange={(e) => setNewQuickLabel(e.target.value)}
                      placeholder="Service name"
                      className="col-span-5 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none"
                    />
                    <select
                      value={newQuickCategory}
                      onChange={(e) => setNewQuickCategory(e.target.value)}
                      className="col-span-3 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none"
                    >
                      {editorCategories.map((c) => (
                        <option key={c} value={c}>{c}</option>
                      ))}
                    </select>
                    <input
                      type="number"
                      min="0"
                      step="1"
                      value={newQuickPrice}
                      onChange={(e) => setNewQuickPrice(e.target.value)}
                      placeholder="Price"
                      className="col-span-2 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none"
                    />
                    <button type="button" onClick={addQuickService} className="col-span-2 bg-indigo-600 text-white rounded-lg text-sm font-bold hover:bg-indigo-700">
                      Add
                    </button>
                  </div>
                )}
                {showCategoryCreator && (
                  <div className="grid grid-cols-12 gap-2">
                    <input
                      value={newQuickCategoryName}
                      onChange={(e) => setNewQuickCategoryName(e.target.value)}
                      placeholder="Category name"
                      className="col-span-9 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none bg-white"
                    />
                    <button type="button" onClick={addQuickCategory} className="col-span-2 bg-gray-700 text-white rounded-lg text-sm font-bold hover:bg-gray-800">
                      Add
                    </button>
                    <button type="button" onClick={() => setShowCategoryCreator(false)} className="col-span-1 border border-gray-200 rounded-lg text-sm font-bold text-gray-500 hover:bg-gray-100">
                      <X size={14} />
                    </button>
                  </div>
                )}
              </div>

              <div className="flex items-center justify-between px-1">
                <p className="text-[10px] font-black uppercase tracking-wider text-gray-400">Quick Items</p>
                <p className="text-[10px] text-gray-400">Drag handle to reorder</p>
              </div>
              <div className="grid grid-cols-12 gap-2 text-[10px] font-black uppercase tracking-wider text-gray-400 px-1">
                <div className="col-span-1 text-center">Drag</div>
                <div className="col-span-4">Service</div>
                <div className="col-span-3">Category</div>
                <div className="col-span-3">Price</div>
                <div className="col-span-1 text-right">Delete</div>
              </div>
              {editorQuickRows.map(({ svc, idx }) => (
                <div
                  key={`${svc.label}-${idx}`}
                  className={`grid grid-cols-12 gap-2 items-center border rounded-xl p-2 transition-colors ${
                    draggingQuickIndex === idx ? 'border-indigo-300 bg-indigo-50/40' : 'border-gray-100'
                  }`}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={() => handleQuickServiceDrop(idx)}
                >
                  <button
                    type="button"
                    draggable
                    onDragStart={() => setDraggingQuickIndex(idx)}
                    onDragEnd={() => setDraggingQuickIndex(null)}
                    className="col-span-1 h-9 rounded-lg border border-gray-200 bg-gray-50 text-gray-500 hover:text-indigo-600 hover:border-indigo-300 flex items-center justify-center cursor-grab active:cursor-grabbing"
                    title="Drag to reorder"
                  >
                    <GripVertical size={16} />
                  </button>
                  <input
                    value={svc.label}
                    onChange={(e) => setQuickServices((prev) => prev.map((x, i) => (i === idx ? { ...x, label: e.target.value } : x)))}
                    className="col-span-4 border border-gray-200 rounded-lg px-2 py-1.5 text-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none"
                  />
                  <select
                    value={svc.category || EXPENSE_QUICK_DEFAULT_CATEGORY}
                    onChange={(e) => setQuickServices((prev) => prev.map((x, i) => (i === idx ? { ...x, category: e.target.value } : x)))}
                    className="col-span-3 border border-gray-200 rounded-lg px-2 py-1.5 text-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none"
                  >
                    {editorCategories.map((c) => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                  <input
                    type="number"
                    min="0"
                    step="1"
                    value={svc.price}
                    onChange={(e) => setQuickServices((prev) => prev.map((x, i) => (i === idx ? { ...x, price: Number(e.target.value || 0) } : x)))}
                    className="col-span-3 border border-gray-200 rounded-lg px-2 py-1.5 text-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none"
                  />
                  <button type="button" onClick={() => removeQuickService(idx)} className="col-span-1 h-9 rounded-lg bg-red-50 text-red-600 hover:bg-red-100 flex items-center justify-center">
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
            </div>
            <div className="px-4 py-3 border-t border-gray-100 bg-gray-50 flex justify-end">
              <button
                type="button"
                onClick={() => {
                  void persistQuickServices(quickServices)
                  setShowCategoryCreator(false)
                  setShowQuickItemCreator(false)
                  setShowQuickServiceEditor(false)
                  toast.success('Quick Add services updated')
                }}
                className="px-4 py-2 rounded-lg bg-emerald-600 text-white text-sm font-bold hover:bg-emerald-700"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      <ExpenseListDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        onPrint={printExpense}
      />
    </div>
  )
}
