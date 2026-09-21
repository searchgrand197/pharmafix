import React, { useState } from 'react'
import { X } from 'lucide-react'
import api from '../api'
import toast from 'react-hot-toast'
import { parseApiError } from './pharmacyCalculations'

export default function PharmacyInvoiceCancelModal({ invoice, onClose, onSuccess }) {
  const [reason, setReason] = useState('')
  const [cancelling, setCancelling] = useState(false)

  if (!invoice) return null

  const isB2B = Boolean(invoice?.party || invoice?.party_details)
  const party = invoice?.party_details || (typeof invoice?.party === 'object' ? invoice.party : null)
  const patient = invoice?.patient_details || (typeof invoice?.patient === 'object' ? invoice.patient : null)
  const customerName = isB2B
    ? (party?.name || invoice?.party_name || invoice?.party_name_snapshot || 'Party')
    : `${patient?.first_name || ''} ${patient?.last_name || ''}`.trim() || 'Patient'

  const submit = async () => {
    const trimmed = reason.trim()
    if (!trimmed) {
      toast.error('Cancellation reason is required')
      return
    }
    setCancelling(true)
    try {
      const res = await api.post(`/pharmacy/invoices/${invoice.id}/cancel/`, { cancel_reason: trimmed })
      toast.success('Pharmacy receipt cancelled')
      const updated = res?.data?.data ?? res?.data?.entity ?? res?.data
      onSuccess?.(updated)
      onClose()
    } catch (err) {
      toast.error(parseApiError(err) || 'Failed to cancel receipt')
    } finally {
      setCancelling(false)
    }
  }

  function handleReasonKeyDown(e) {
    if (e.key !== 'Enter' || e.shiftKey) return
    e.preventDefault()
    if (cancelling) return
    submit()
  }

  return (
    <div className="fixed inset-0 z-[1200] flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm"
        onClick={() => { if (!cancelling) onClose() }}
      />
      <div className="relative z-10 bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden">
        <div className="px-4 py-3 bg-red-600 text-white flex items-center justify-between">
          <h3 className="font-bold">Cancel Pharmacy Receipt</h3>
          <button
            type="button"
            onClick={() => { if (!cancelling) onClose() }}
            className="text-white/80 hover:text-white"
            disabled={cancelling}
          >
            <X size={18} />
          </button>
        </div>
        <div className="p-4 space-y-3">
          <p className="text-sm text-slate-700">
            You are cancelling receipt{' '}
            <span className="font-bold text-slate-900">#{invoice.invoice_no}</span> for{' '}
            <span className="font-semibold">{customerName}</span>.
            This will make the receipt view-only, remove it from sales totals, and restore dispensed stock to inventory.
          </p>
          <div>
            <label className="block text-xs font-bold text-slate-600 mb-1">Cancellation Reason *</label>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              onKeyDown={handleReasonKeyDown}
              rows={4}
              className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:border-red-500 focus:ring-1 focus:ring-red-500 outline-none resize-none"
              placeholder="Enter reason for cancellation"
              disabled={cancelling}
            />
          </div>
        </div>
        <div className="p-4 border-t border-slate-100 flex justify-end gap-2 bg-slate-50">
          <button
            type="button"
            onClick={() => { if (!cancelling) onClose() }}
            disabled={cancelling}
            className="px-4 py-2 rounded-xl text-sm font-bold text-slate-600 hover:bg-slate-200 transition-colors disabled:opacity-60"
          >
            Close
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={cancelling}
            className="px-4 py-2 rounded-xl text-sm font-bold bg-red-600 text-white hover:bg-red-700 transition-colors disabled:opacity-60"
          >
            {cancelling ? 'Cancelling…' : 'Confirm Cancel'}
          </button>
        </div>
      </div>
    </div>
  )
}
