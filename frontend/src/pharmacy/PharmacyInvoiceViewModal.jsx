import React, { useCallback, useEffect, useState } from 'react'
import { X, Loader2, ChevronDown } from 'lucide-react'
import api from '../api'
import toast from 'react-hot-toast'
import { formatWithPattern } from '../utils/dateTimeFormat'
import { parseApiError } from './pharmacyCalculations'

function money(v) {
  return `₹${Number(v || 0).toFixed(2)}`
}

function statusBadge(status) {
  const s = String(status || '').toLowerCase()
  if (s === 'cancelled') return 'bg-red-100 text-red-700 border-red-200'
  if (s === 'finalized') return 'bg-emerald-100 text-emerald-700 border-emerald-200'
  if (s === 'draft') return 'bg-amber-100 text-amber-800 border-amber-200'
  return 'bg-slate-100 text-slate-600 border-slate-200'
}

function qtyLabel(item) {
  const qty = Number(item.qty || 0)
  const free = Number(item.free_qty || 0)
  if (free > 0) return `${qty} + ${free} free`
  return String(qty)
}

export default function PharmacyInvoiceViewModal({ invoiceId, onClose }) {
  const [invoice, setInvoice] = useState(null)
  const [returnSummary, setReturnSummary] = useState(null)
  const [loading, setLoading] = useState(true)
  const [expandedSessionKeys, setExpandedSessionKeys] = useState(() => new Set())

  useEffect(() => {
    if (!invoiceId) return
    let cancelled = false
    setLoading(true)
    setReturnSummary(null)
    setExpandedSessionKeys(new Set())

    Promise.all([
      api.get(`/pharmacy/invoices/${invoiceId}/`),
      api.get(`/pharmacy/invoices/${invoiceId}/return-summary/`).catch(() => null),
    ])
      .then(([invoiceRes, summaryRes]) => {
        if (cancelled) return
        setInvoice(invoiceRes.data?.data || invoiceRes.data || null)
        if (summaryRes) {
          setReturnSummary(summaryRes.data?.data || summaryRes.data || null)
        }
      })
      .catch((err) => {
        if (!cancelled) toast.error(`Failed to load receipt details: ${parseApiError(err)}`)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => { cancelled = true }
  }, [invoiceId])

  const toggleSession = useCallback((key) => {
    setExpandedSessionKeys((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }, [])

  if (!invoiceId) return null

  const isB2B = Boolean(invoice?.party || invoice?.party_details)
  const party = invoice?.party_details || (typeof invoice?.party === 'object' ? invoice.party : null)
  const patient = invoice?.patient_details || (typeof invoice?.patient === 'object' ? invoice.patient : null)
  const doctor = invoice?.doctor_details
  const items = Array.isArray(invoice?.items) ? invoice.items : []
  const isCancelled = String(invoice?.status || '').toLowerCase() === 'cancelled'
  const totalAmt = Number(invoice?.grand_total || 0)
  const roundOffAmt = Math.round((Number(invoice?.round_off) || 0) * 100) / 100
  const billDiscountAmt = Math.round((Number(invoice?.total_discount) || 0) * 100) / 100
  const paidAmt = Number(invoice?.paid_amount || 0)
  const dueAmt = Math.max(0, Number(invoice?.due_amount ?? totalAmt - paidAmt))
  const hasReturns = Boolean(returnSummary?.has_returns)
  const returnSessions = Array.isArray(returnSummary?.sessions) ? returnSummary.sessions : []

  const customerName = isB2B
    ? (party?.name || invoice?.party_name || invoice?.party_name_snapshot || '—')
    : `${patient?.first_name || ''} ${patient?.last_name || ''}`.trim() || '—'

  return (
    <div className="fixed inset-0 z-[1200] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between shrink-0 bg-slate-50">
          <div>
            <h3 className="font-bold text-slate-900">Pharmacy Receipt</h3>
            {invoice?.invoice_no && (
              <p className="text-[11px] text-slate-500 font-mono">#{invoice.invoice_no}</p>
            )}
          </div>
          <button type="button" onClick={onClose} className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100">
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4 text-[12px]">
          {loading ? (
            <div className="flex flex-col items-center justify-center py-16 text-slate-400">
              <Loader2 size={28} className="animate-spin mb-2" />
              <p>Loading receipt…</p>
            </div>
          ) : !invoice ? (
            <p className="text-center text-slate-500 py-12">Receipt not found.</p>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full uppercase border ${statusBadge(invoice.status)}`}>
                  {invoice.status || '—'}
                </span>
                {isCancelled && (
                  <span className="text-[10px] font-bold text-red-700">Cancelled (view only)</span>
                )}
                {invoice.created_at && (
                  <span className="text-[10px] text-slate-500 ml-auto">
                    {formatWithPattern(invoice.created_at, 'dd/MM/yyyy, HH:mm')}
                  </span>
                )}
              </div>

              {isCancelled && invoice.cancel_reason && (
                <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2">
                  <p className="text-[10px] font-bold text-red-800 uppercase tracking-wide">Cancellation reason</p>
                  <p className="text-[12px] text-red-900 mt-0.5 whitespace-pre-wrap">{invoice.cancel_reason}</p>
                  {(invoice.cancelled_by_name || invoice.cancelled_at) && (
                    <p className="text-[10px] text-red-700 mt-1">
                      {invoice.cancelled_by_name ? `By ${invoice.cancelled_by_name}` : ''}
                      {invoice.cancelled_by_name && invoice.cancelled_at ? ' · ' : ''}
                      {invoice.cancelled_at ? formatWithPattern(invoice.cancelled_at, 'dd/MM/yyyy, HH:mm') : ''}
                    </p>
                  )}
                </div>
              )}

              <div className={`grid grid-cols-1 gap-3 ${hasReturns ? 'sm:grid-cols-3' : 'sm:grid-cols-2'}`}>
                <div className="rounded-lg border border-slate-200 p-3">
                  <p className="text-[10px] font-bold text-slate-500 uppercase">Customer</p>
                  <p className="font-semibold text-slate-900 mt-1">{customerName}</p>
                  {isB2B ? (
                    <div className="mt-1 space-y-0.5 text-[11px] text-slate-600">
                      {party?.phone && <p>Phone: {party.phone}</p>}
                      {party?.gst_number && <p>GSTIN: {party.gst_number}</p>}
                      {party?.dl_number && <p>DL: {party.dl_number}</p>}
                      {party?.address && <p className="whitespace-pre-wrap">{party.address}</p>}
                    </div>
                  ) : (
                    <div className="mt-1 space-y-0.5 text-[11px] text-slate-600">
                      {patient?.uhid && <p>UHID: {patient.uhid}</p>}
                      {patient?.phone && <p>Phone: {patient.phone}</p>}
                    </div>
                  )}
                </div>

                <div className="rounded-lg border border-slate-200 p-3">
                  <p className="text-[10px] font-bold text-slate-500 uppercase">Payment</p>
                  <div className="mt-1 space-y-1 text-[11px]">
                    <div className="flex justify-between">
                      <span className="text-slate-600">Method</span>
                      <span className="font-semibold uppercase">{invoice.payment_method || 'cash'}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-600">Paid</span>
                      <span className="font-semibold text-emerald-700">{money(paidAmt)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-600">Due</span>
                      <span className="font-semibold text-amber-700">{money(dueAmt)}</span>
                    </div>
                    {billDiscountAmt > 0 && (
                      <div className="flex justify-between text-slate-500">
                        <span>Bill discount</span>
                        <span>−{money(billDiscountAmt)}</span>
                      </div>
                    )}
                    {roundOffAmt !== 0 && (
                      <div className="flex justify-between text-slate-500">
                        <span>Round off</span>
                        <span>{roundOffAmt > 0 ? '+' : '−'}{money(Math.abs(roundOffAmt))}</span>
                      </div>
                    )}
                    <div className="flex justify-between border-t border-slate-100 pt-1">
                      <span className="font-bold text-slate-800">Grand total</span>
                      <span className="font-bold">{money(totalAmt)}</span>
                    </div>
                    {invoice.gst_enabled && (
                      <>
                        <div className="flex justify-between text-slate-500">
                          <span>CGST</span>
                          <span>{money(invoice.cgst)}</span>
                        </div>
                        <div className="flex justify-between text-slate-500">
                          <span>SGST</span>
                          <span>{money(invoice.sgst)}</span>
                        </div>
                      </>
                    )}
                  </div>
                </div>

                {hasReturns && returnSummary && (
                  <div className="rounded-lg border border-slate-200 p-3">
                    <p className="text-[10px] font-bold text-slate-500 uppercase">Return</p>
                    <div className="mt-1 space-y-1 text-[11px]">
                      <div className="flex justify-between">
                        <span className="text-slate-600">Original</span>
                        <span className="font-semibold text-slate-800">{money(returnSummary.original_amount)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-rose-600">Returned</span>
                        <span className="font-semibold text-rose-700">{money(returnSummary.returned_amount)}</span>
                      </div>
                      <div className="flex justify-between border-t border-slate-100 pt-1">
                        <span className="font-bold text-emerald-600">New</span>
                        <span className="font-bold text-emerald-700">{money(returnSummary.new_amount)}</span>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {hasReturns && (
                <div className="rounded-lg border border-rose-200 bg-rose-50/30 overflow-hidden">
                  <div className="px-3 py-2 border-b border-rose-100 bg-rose-50">
                    <p className="text-[10px] font-bold text-rose-800 uppercase tracking-wide">Return History</p>
                  </div>
                  <div className="divide-y divide-rose-100">
                    {returnSessions.map((session) => {
                      const expanded = expandedSessionKeys.has(session.key)
                      const dateStr = session.returned_at
                        ? formatWithPattern(session.returned_at, 'dd/MM/yyyy, HH:mm')
                        : '—'
                      const itemCount = session.items?.length || 0
                      return (
                        <div key={session.key} className="bg-white/60">
                          <button
                            type="button"
                            onClick={() => toggleSession(session.key)}
                            className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-rose-50/50 transition-colors"
                          >
                            <span className={`shrink-0 text-slate-400 transition-transform ${expanded ? 'rotate-180' : ''}`}>
                              <ChevronDown size={14} />
                            </span>
                            <span className="flex-1 min-w-0 text-[11px] text-slate-700">{dateStr}</span>
                            <span className="shrink-0 text-[11px] font-semibold text-rose-700">{money(session.refund_amount)}</span>
                            <span className="shrink-0 text-[9px] text-slate-400">{itemCount} item{itemCount !== 1 ? 's' : ''}</span>
                          </button>
                          {expanded && (
                            <table className="w-full text-left text-[10px] border-t border-rose-100 bg-white/80">
                              <thead className="text-[9px] font-bold text-slate-500 uppercase">
                                <tr>
                                  <th className="px-3 py-1.5 pl-8">Medicine</th>
                                  <th className="px-3 py-1.5">Batch</th>
                                  <th className="px-3 py-1.5 text-right">Qty</th>
                                  <th className="px-3 py-1.5 text-right">Refund</th>
                                </tr>
                              </thead>
                              <tbody>
                                {(session.items || []).map((item, i) => (
                                  <tr key={`${session.key}-${i}`} className="border-t border-rose-50">
                                    <td className="px-3 py-1.5 pl-8 font-medium text-slate-800">{item.medicine_name}</td>
                                    <td className="px-3 py-1.5 text-slate-500 font-mono">{item.batch_no}</td>
                                    <td className="px-3 py-1.5 text-right text-rose-600 font-semibold">{item.qty_returned}</td>
                                    <td className="px-3 py-1.5 text-right font-semibold">{money(item.line_refund)}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          )}
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}

              {(doctor?.user?.first_name || invoice.billing_doctor_name || invoice.billing_hospital_name || invoice.ipd_admission) && (
                <div className="rounded-lg border border-slate-200 p-3 text-[11px] text-slate-600 space-y-0.5">
                  {doctor && (
                    <p>
                      Referred doctor:{' '}
                      <span className="font-medium text-slate-800">
                        {`${doctor.user?.first_name || ''} ${doctor.user?.last_name || ''}`.trim() || '—'}
                      </span>
                    </p>
                  )}
                  {invoice.billing_doctor_name && (
                    <p>Billing doctor: <span className="font-medium text-slate-800">{invoice.billing_doctor_name}</span></p>
                  )}
                  {invoice.billing_hospital_name && (
                    <p>Billing hospital: <span className="font-medium text-slate-800">{invoice.billing_hospital_name}</span></p>
                  )}
                  {invoice.ipd_admission && (
                    <p>IPD admission linked</p>
                  )}
                </div>
              )}

              {invoice.remarks && (
                <div className="rounded-lg border border-slate-200 p-3">
                  <p className="text-[10px] font-bold text-slate-500 uppercase">Remarks</p>
                  <p className="text-[11px] text-slate-700 mt-1 whitespace-pre-wrap">{invoice.remarks}</p>
                </div>
              )}

              <div className="rounded-lg border border-slate-200 overflow-hidden">
                <table className="w-full text-left text-[11px]">
                  <thead className="bg-slate-50 text-[10px] uppercase text-slate-500 font-bold">
                    <tr>
                      <th className="px-3 py-2">Medicine</th>
                      <th className="px-3 py-2">Batch</th>
                      <th className="px-3 py-2 text-right">Qty</th>
                      <th className="px-3 py-2 text-right">Rate</th>
                      <th className="px-3 py-2 text-right">MRP</th>
                      <th className="px-3 py-2 text-right">Amount</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {items.length === 0 ? (
                      <tr><td colSpan={6} className="px-3 py-4 text-center text-slate-400">No line items</td></tr>
                    ) : items.map((it) => (
                      <tr key={it.id} className="hover:bg-slate-50/80">
                        <td className="px-3 py-2 font-medium text-slate-800">
                          {it.medicine_name || it.medicine?.name || '—'}
                        </td>
                        <td className="px-3 py-2 text-slate-600">
                          {it.batch_no || it.snapshot_batch_no || '—'}
                          {it.expiry_date && (
                            <span className="block text-[10px] text-slate-400">
                              Exp: {formatWithPattern(it.expiry_date, 'MM/yy')}
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">{qtyLabel(it)}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{money(it.rate)}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{money(it.mrp)}</td>
                        <td className="px-3 py-2 text-right tabular-nums font-semibold">{money(it.amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>

        <div className="px-4 py-3 border-t border-slate-200 bg-slate-50 flex justify-end shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-xl text-sm font-bold text-slate-600 hover:bg-slate-200 transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  )
}
