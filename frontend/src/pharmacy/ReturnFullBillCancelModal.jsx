import React from 'react'
import { X, AlertTriangle } from 'lucide-react'

/**
 * Confirmation modal for full-bill cancel via return.
 *
 * Props:
 *   invoice      — the invoice object
 *   refundAmt    — number: the full refund amount (original grand_total)
 *   processing   — bool: disables buttons while cancel API is in flight
 *   onConfirm    — called when user clicks "Cancel Bill"
 *   onClose      — called to dismiss
 */
export default function ReturnFullBillCancelModal({
  invoice,
  refundAmt = 0,
  processing = false,
  onConfirm,
  onClose,
}) {
  if (!invoice) return null

  const invoiceNo = invoice.invoice_no || invoice.id
  const patient = invoice.patient_details || {}
  const customerName =
    `${patient.first_name || ''} ${patient.last_name || ''}`.trim() || 'Patient'

  return (
    <div className="fixed inset-0 z-[1200] flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm"
        onClick={() => { if (!processing) onClose?.() }}
      />
      <div className="relative z-10 bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
        <div className="px-5 py-4 bg-red-600 text-white flex items-center justify-between">
          <div className="flex items-center gap-2">
            <AlertTriangle size={18} />
            <h3 className="font-bold text-base">Cancel Bill?</h3>
          </div>
          <button
            type="button"
            onClick={() => { if (!processing) onClose?.() }}
            disabled={processing}
            className="text-white/80 hover:text-white disabled:opacity-50"
          >
            <X size={18} />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <p className="text-sm text-slate-700">
            You are returning <strong>all medicines</strong> from receipt{' '}
            <span className="font-bold text-slate-900">#{invoiceNo}</span> for{' '}
            <span className="font-semibold">{customerName}</span>.
          </p>
          <p className="text-sm text-slate-700">
            Since all items are being returned, this receipt will be{' '}
            <span className="font-semibold text-red-700">automatically cancelled</span> and
            all dispensed stock will be restored to inventory.
          </p>
          <div className="bg-rose-50 border border-rose-200 rounded-xl px-4 py-3">
            <div className="text-xs text-rose-600 font-semibold mb-0.5">Full refund to customer</div>
            <div className="text-2xl font-bold text-rose-700">₹{refundAmt.toFixed(2)}</div>
          </div>
        </div>

        <div className="px-5 py-4 border-t border-slate-100 bg-slate-50 flex justify-end gap-2">
          <button
            type="button"
            onClick={() => { if (!processing) onClose?.() }}
            disabled={processing}
            className="px-4 py-2 rounded-xl text-sm font-bold text-slate-600 hover:bg-slate-200 transition-colors disabled:opacity-60"
          >
            Keep Editing
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={processing}
            className="px-4 py-2 rounded-xl text-sm font-bold bg-red-600 text-white hover:bg-red-700 transition-colors disabled:opacity-60"
          >
            {processing ? 'Cancelling…' : 'Cancel Bill'}
          </button>
        </div>
      </div>
    </div>
  )
}
