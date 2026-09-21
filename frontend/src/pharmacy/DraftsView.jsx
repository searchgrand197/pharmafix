import React, { useEffect, useState } from 'react'
import {
  FileText, Eye, User, Pill, RefreshCw, Trash2, Loader2,
  AlertTriangle, X, CheckCircle2, Receipt, Clock, Printer,
} from 'lucide-react'
import api from '../api'
import toast from 'react-hot-toast'
import { formatWithPattern, formatTime, withTimeTokens } from '../utils/dateTimeFormat'
import { format, isToday, isYesterday } from 'date-fns'

// ── Delete Confirmation Modal ─────────────────────────────────────────────────
function DeleteConfirmModal({ draft, onCancel, onConfirm, deleting }) {
  if (!draft) return null
  const patientName = draft.patient_details?.first_name
    ? `${draft.patient_details.first_name} ${draft.patient_details.last_name || ''}`.trim()
    : 'Walk-in Patient'
  const itemCount = Array.isArray(draft.items) ? draft.items.length : (draft.items_count || '?')

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm" onClick={!deleting ? onCancel : undefined} />
      <div className="relative z-10 bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-sm overflow-hidden">
        <div className="h-1.5 bg-gradient-to-r from-rose-500 to-red-600" />
        <div className="px-6 pt-5 pb-6">
          <div className="flex items-start gap-4 mb-5">
            <div className="w-11 h-11 rounded-xl bg-rose-100 flex items-center justify-center shrink-0">
              <AlertTriangle size={22} className="text-rose-600" />
            </div>
            <div>
              <h3 className="text-[15px] font-bold text-slate-900 leading-tight">Delete Draft Prescription?</h3>
              <p className="text-[12px] text-slate-500 mt-0.5">This action cannot be undone.</p>
            </div>
            <button onClick={onCancel} disabled={deleting} className="ml-auto p-1 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors shrink-0">
              <X size={15} />
            </button>
          </div>
          <div className="bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 mb-5 space-y-1.5">
            <div className="flex items-center gap-2">
              <User size={12} className="text-slate-400 shrink-0" />
              <span className="text-[12px] font-semibold text-slate-800 truncate">{patientName}</span>
            </div>
            <div className="flex items-center gap-2">
              <Pill size={12} className="text-emerald-500 shrink-0" />
              <span className="text-[11px] text-slate-600">{itemCount} medicine{itemCount !== 1 ? 's' : ''} prescribed</span>
            </div>
            <div className="flex items-center gap-2">
              <FileText size={12} className="text-slate-400 shrink-0" />
              <span className="text-[11px] font-mono text-slate-500">#{draft.invoice_no}</span>
              {draft.created_at && (
                <span className="text-[10px] text-slate-400 ml-auto">{formatWithPattern(new Date(draft.created_at), 'dd/MM/yyyy · HH:mm')}</span>
              )}
            </div>
          </div>
          <div className="flex gap-2.5">
            <button onClick={onCancel} disabled={deleting} className="flex-1 py-2 rounded-xl text-[12px] font-bold bg-slate-100 text-slate-700 hover:bg-slate-200 transition-colors disabled:opacity-50">
              Cancel
            </button>
            <button onClick={onConfirm} disabled={deleting} className="flex-1 py-2 rounded-xl text-[12px] font-bold bg-rose-600 text-white hover:bg-rose-700 transition-colors disabled:opacity-60 flex items-center justify-center gap-1.5 shadow-sm">
              {deleting ? <><Loader2 size={13} className="animate-spin" />Deleting…</> : <><Trash2 size={13} />Yes, Delete</>}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function dateLabel(dateStr) {
  if (!dateStr) return '—'
  try {
    const d = new Date(dateStr)
    if (isToday(d)) return formatTime(d)
    if (isYesterday(d)) return 'Yesterday'
    return format(d, 'dd MMM')
  } catch { return '—' }
}

function extractDraftTextParts(remarks = '') {
  const raw = String(remarks || '')
  if (!raw.trim()) return { prescriptionLines: [], notesLines: [] }
  const lines = raw.split('\n').map((l) => l.trim()).filter(Boolean)
  const notesIndex = lines.findIndex((l) => l.toLowerCase() === 'notes/advice:')
  if (notesIndex === -1) {
    return { prescriptionLines: lines, notesLines: [] }
  }
  return {
    prescriptionLines: lines.slice(0, notesIndex),
    notesLines: lines.slice(notesIndex + 1).map((l) => l.replace(/^-\s*/, '')).filter(Boolean),
  }
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function buildDraftPrintHtml(draft) {
  const patientName = draft.patient_details?.first_name
    ? `${draft.patient_details.first_name} ${draft.patient_details.last_name || ''}`.trim()
    : draft.patient_name || 'Walk-in Patient'
  const createdAt = draft.created_at ? formatWithPattern(draft.created_at, 'dd/MM/yyyy, HH:mm') : '—'
  const { prescriptionLines, notesLines } = extractDraftTextParts(draft.remarks)
  const fallbackItems = Array.isArray(draft.items) ? draft.items : []
  const rxLines = prescriptionLines.length
    ? prescriptionLines.filter((l) => !/^doctor prescription/i.test(l))
    : fallbackItems.map((it) => `${it.medicine?.name || 'Medicine'} x${it.qty || 0}`)
  const notes = notesLines

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>Prescription Draft ${escapeHtml(draft.invoice_no || '')}</title>
  <style>
    body { font-family: Arial, sans-serif; color: #111; margin: 0; padding: 24px; }
    .card { max-width: 760px; margin: 0 auto; border: 1px solid #d9d9d9; border-radius: 10px; overflow: hidden; }
    .head { padding: 14px 16px; background: #f8fafc; border-bottom: 1px solid #e5e7eb; }
    .title { margin: 0; font-size: 18px; }
    .muted { color: #64748b; font-size: 12px; margin-top: 4px; }
    .section { padding: 14px 16px; border-bottom: 1px solid #f1f5f9; }
    .section:last-child { border-bottom: 0; }
    .section h4 { margin: 0 0 8px; font-size: 13px; text-transform: uppercase; color: #334155; letter-spacing: .06em; }
    ul { margin: 0; padding-left: 18px; }
    li { margin-bottom: 6px; font-size: 14px; line-height: 1.4; }
  </style>
</head>
<body>
  <div class="card">
    <div class="head">
      <h3 class="title">Prescription Draft</h3>
      <div class="muted">Draft No: ${escapeHtml(draft.invoice_no || '—')} · Date: ${escapeHtml(createdAt)}</div>
      <div class="muted">Patient: ${escapeHtml(patientName)}</div>
    </div>
    <div class="section">
      <h4>Medicines</h4>
      <ul>
        ${rxLines.length ? rxLines.map((l) => `<li>${escapeHtml(l)}</li>`).join('') : '<li>—</li>'}
      </ul>
    </div>
    <div class="section">
      <h4>Notes / Advice</h4>
      <ul>
        ${notes.length ? notes.map((l) => `<li>${escapeHtml(l)}</li>`).join('') : '<li>No additional notes</li>'}
      </ul>
    </div>
  </div>
</body>
</html>`
}

async function printDraftPrescription(draft) {
  const iframe = document.createElement('iframe')
  iframe.style.cssText = 'position:fixed;left:-9999px;top:-9999px;width:210mm;height:297mm;border:none;'
  document.body.appendChild(iframe)
  const doc = iframe.contentDocument || iframe.contentWindow.document
  doc.open()
  doc.write(buildDraftPrintHtml(draft))
  doc.close()
  const win = iframe.contentWindow
  setTimeout(() => {
    try { win.focus(); win.print() } catch { /* noop */ }
    setTimeout(() => {
      try { document.body.removeChild(iframe) } catch { /* noop */ }
    }, 1000)
  }, 120)
}

// ── Completed Invoice Card ────────────────────────────────────────────────────
function CompletedCard({
  invoice,
  onView,
  onViewPrint,
  onViewPrinted,
  onCancel,
}) {
  const isCancelled = invoice.status === 'cancelled'
  const isFinalized = invoice.status === 'finalized'
  const isB2B = Boolean(invoice?.party || invoice?.party_details)
  const party = invoice?.party_details || (typeof invoice?.party === 'object' ? invoice.party : null)
  const patientName = isB2B
    ? (party?.name || invoice?.party_name || invoice?.party_name_snapshot || 'Party')
    : invoice.patient_details?.first_name
      ? `${invoice.patient_details.first_name} ${invoice.patient_details.last_name || ''}`.trim()
      : 'Patient'
  const itemCount = Array.isArray(invoice.items) ? invoice.items.length : (invoice.items_count || '—')
  const grandTotal = Number(invoice.grand_total || 0).toFixed(2)
  const hasPrintCopy = !!(invoice.has_print_copy || (invoice.print_html && String(invoice.print_html).trim()))
  const actionCount = 1 + (isCancelled ? 0 : 1) + (!isCancelled && hasPrintCopy ? 1 : 0) + (isFinalized ? 1 : 0)

  return (
    <div className={`bg-white border rounded-xl p-3 flex flex-col gap-2.5 relative overflow-hidden hover:shadow-md transition-all ${
      isCancelled ? 'border-red-200 bg-red-50/40' : 'border-emerald-200'
    }`}>
      <div className={`absolute top-0 left-0 w-1 h-full rounded-l-xl ${isCancelled ? 'bg-red-500' : 'bg-emerald-500'}`} />

      {/* Top row */}
      <div className="flex justify-between items-start pl-2">
        <div>
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wide">#{invoice.invoice_no}</p>
          <p className="text-[10px] text-slate-400 mt-0.5">{dateLabel(invoice.created_at)}</p>
        </div>
        <div className="flex items-center gap-1.5">
          {isCancelled ? (
            <span className="flex items-center gap-0.5 bg-red-100 text-red-700 text-[9px] font-bold px-1.5 py-0.5 rounded-full uppercase">
              Cancelled
            </span>
          ) : (
            <span className="flex items-center gap-0.5 bg-emerald-100 text-emerald-700 text-[9px] font-bold px-1.5 py-0.5 rounded-full uppercase">
              <CheckCircle2 size={9} />DONE
            </span>
          )}
        </div>
      </div>

      {/* Patient */}
      <div className="pl-2 flex items-center gap-1.5">
        <User size={13} className="text-slate-400 shrink-0" />
        <span className="text-[12px] font-bold text-slate-900 truncate">{patientName}</span>
      </div>

      {/* Amount + items */}
      <div className="pl-2 flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <Pill size={12} className="text-emerald-500 shrink-0" />
          <span className="text-[11px] text-slate-600">{itemCount} item{itemCount !== 1 ? 's' : ''}</span>
        </div>
        <span className="text-[13px] font-bold text-emerald-700 tabular-nums">₹{grandTotal}</span>
      </div>

      {isCancelled && (
        <p className="pl-2 text-[10px] font-bold text-red-700">Cancelled (view only)</p>
      )}

      <div
        className={`ml-2 mt-auto grid gap-1.5 w-full ${
          actionCount >= 3 ? 'grid-cols-2' : actionCount === 2 ? 'grid-cols-2' : 'grid-cols-1'
        }`}
      >
        <button
          onClick={() => onView?.(invoice)}
          className="flex items-center justify-center gap-1 py-1.5 rounded-lg text-[10px] font-bold bg-indigo-600 text-white hover:bg-indigo-700 transition-colors"
        >
          <Eye size={11} />
          View
        </button>
        {!isCancelled && (
          <button
            onClick={() => onViewPrint?.(invoice)}
            className="flex items-center justify-center gap-1 py-1.5 rounded-lg text-[10px] font-bold bg-emerald-600 text-white hover:bg-emerald-700 transition-colors"
          >
            <Receipt size={11} />
            Print
          </button>
        )}
        {!isCancelled && hasPrintCopy ? (
          <button
            onClick={() => onViewPrinted?.(invoice)}
            className="flex items-center justify-center gap-1 py-1.5 rounded-lg text-[10px] font-bold bg-violet-600 text-white hover:bg-violet-700 transition-colors"
          >
            <Printer size={11} />
            Printed
          </button>
        ) : null}
        {isFinalized && (
          <button
            onClick={() => onCancel?.(invoice)}
            className="flex items-center justify-center gap-1 py-1.5 rounded-lg text-[10px] font-bold bg-red-600 text-white hover:bg-red-700 transition-colors"
          >
            <X size={11} />
            Cancel
          </button>
        )}
      </div>
    </div>
  )
}

// ── Draft Card ────────────────────────────────────────────────────────────────
function DraftCard({ draft, onOpen, onDelete, onPrint, isBeingDeleted }) {
  const patientName = draft.patient_details?.first_name
    ? `${draft.patient_details.first_name} ${draft.patient_details.last_name || ''}`.trim()
    : draft.patient_name || 'Walk-in Patient'
  const itemCount = Array.isArray(draft.items) ? draft.items.length : (draft.items_count || '?')

  return (
    <div className={`bg-white border rounded-xl p-3 transition-all flex flex-col gap-2.5 relative overflow-hidden ${
      isBeingDeleted ? 'border-rose-200 opacity-60 scale-95' : 'border-slate-200 hover:shadow-md hover:border-amber-300'
    }`}>
      <div className={`absolute top-0 left-0 w-1 h-full rounded-l-xl ${isBeingDeleted ? 'bg-rose-400' : 'bg-amber-400'}`} />

      <div className="flex justify-between items-start pl-2">
        <div>
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wide">#{draft.invoice_no}</p>
          <p className="text-[10px] text-slate-400 mt-0.5">{dateLabel(draft.created_at)}</p>
        </div>
        <div className="flex items-center gap-1">
          <span className="flex items-center gap-0.5 bg-amber-100 text-amber-800 text-[9px] font-bold px-1.5 py-0.5 rounded-full uppercase">
            <Clock size={8} />PENDING
          </span>
          <button
            onClick={e => { e.stopPropagation(); onDelete(draft) }}
            disabled={isBeingDeleted}
            title="Delete draft"
            className="w-6 h-6 flex items-center justify-center rounded-lg text-slate-300 hover:text-rose-500 hover:bg-rose-50 transition-colors disabled:opacity-40"
          >
            {isBeingDeleted ? <Loader2 size={11} className="animate-spin text-rose-400" /> : <Trash2 size={11} />}
          </button>
        </div>
      </div>

      <div className="pl-2 flex items-center gap-1.5">
        <User size={13} className="text-slate-400 shrink-0" />
        <span className="text-[12px] font-bold text-slate-900 truncate">{patientName}</span>
      </div>

      <div className="pl-2 flex items-center gap-1.5">
        <Pill size={12} className="text-emerald-500 shrink-0" />
        <span className="text-[11px] text-slate-600">{itemCount} medicine{itemCount !== 1 ? 's' : ''} prescribed</span>
      </div>

      {draft.remarks && (
        <div className="pl-2 text-[10px] text-slate-400 italic truncate">
          {draft.remarks.split('\n')[1] || ''}
        </div>
      )}

      <div className="ml-2 mt-auto grid grid-cols-2 gap-1.5 w-full">
        <button
          onClick={() => onPrint(draft)}
          disabled={isBeingDeleted}
          className="flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-[11px] font-bold bg-slate-100 text-slate-700 hover:bg-slate-200 transition-colors disabled:opacity-50"
        >
          <Printer size={12} />
          Print
        </button>
        <button
          onClick={() => onOpen(draft)}
          disabled={isBeingDeleted}
          className="flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-[11px] font-bold bg-blue-600 text-white hover:bg-blue-700 transition-colors disabled:opacity-50"
        >
          <Eye size={12} />
          Open in Billing
        </button>
      </div>
    </div>
  )
}

// ── Section Header ────────────────────────────────────────────────────────────
function SectionHeader({ icon: Icon, title, count, countColor = 'bg-slate-100 text-slate-600' }) {
  return (
    <div className="flex items-center gap-2 mb-3">
      <Icon size={15} className="text-slate-500" />
      <h3 className="text-[13px] font-bold text-slate-700">{title}</h3>
      {count !== undefined && (
        <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold ${countColor}`}>
          {count}
        </span>
      )}
      <div className="flex-1 h-px bg-slate-200" />
    </div>
  )
}

// ── Main Component ────────────────────────────────────────────────────────────
export default function DraftsView({
  onLoadDraft,
  completedInvoices = [],
  onViewInvoice,
  onCancelInvoice,
  onViewInvoicePrint,
  onViewInvoicePrinted,
}) {
  const [drafts, setDrafts] = useState([])
  const [loading, setLoading] = useState(true)
  const [confirmTarget, setConfirmTarget] = useState(null)
  const [deleting, setDeleting] = useState(false)

  const loadDrafts = async () => {
    setLoading(true)
    try {
      const res = await api.get('/pharmacy/invoices/all-drafts/')
      const list = res.data?.data || res.data?.results || res.data || []
      setDrafts(Array.isArray(list) ? list : [])
    } catch {
      toast.error('Failed to load draft prescriptions')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { loadDrafts() }, [])

  const handleOpenInBilling = (draft) => {
    if (!Array.isArray(draft.items) || draft.items.length === 0) {
      toast('Draft has no medicines yet', { icon: '⚠️' })
      return
    }
    onLoadDraft(draft)
  }

  const handlePrintDraft = async (draft) => {
    try {
      await printDraftPrescription(draft)
    } catch {
      toast.error('Failed to open print preview')
    }
  }

  const confirmDelete = async () => {
    if (!confirmTarget) return
    setDeleting(true)
    try {
      await api.delete(`/pharmacy/invoices/${confirmTarget.id}/delete-draft/`)
      setDrafts(prev => prev.filter(d => d.id !== confirmTarget.id))
      toast.success('Draft prescription deleted')
      setConfirmTarget(null)
    } catch {
      toast.error('Failed to delete draft — please try again')
    } finally {
      setDeleting(false)
    }
  }

  // Recent completed: today + yesterday, sorted newest first
  const recentCompleted = completedInvoices
    .filter(inv => inv.status === 'finalized' || inv.status === 'completed' || inv.status === 'cancelled')
    .slice(0, 20)

  const hasDrafts = drafts.length > 0
  const hasCompleted = recentCompleted.length > 0

  return (
    <>
      <DeleteConfirmModal
        draft={confirmTarget}
        onCancel={() => { if (!deleting) setConfirmTarget(null) }}
        onConfirm={confirmDelete}
        deleting={deleting}
      />

      <div className="h-full flex flex-col gap-4 overflow-hidden min-w-0 p-1">
        {/* Header */}
        <div className="flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2">
            <h2 className="text-base font-bold text-slate-900">Prescription Queue</h2>
            {drafts.length > 0 && (
              <span className="inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-700">
                {drafts.length} pending
              </span>
            )}
            {recentCompleted.length > 0 && (
              <span className="inline-flex items-center rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">
                {recentCompleted.length} done
              </span>
            )}
          </div>
          <button
            onClick={loadDrafts}
            disabled={loading}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"
            title="Refresh drafts"
          >
            <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto min-h-0 space-y-6">
          {/* ── Pending Drafts ── */}
          <div>
            <SectionHeader
              icon={Clock}
              title="Pending Prescriptions"
              count={loading ? '…' : drafts.length}
              countColor="bg-amber-100 text-amber-700"
            />

            {loading ? (
              <div className="flex flex-col items-center justify-center py-10 text-slate-400">
                <Loader2 className="animate-spin mb-2" size={24} />
                <p className="text-sm">Loading drafts...</p>
              </div>
            ) : !hasDrafts ? (
              <div className="flex flex-col items-center justify-center py-10 text-slate-400 bg-slate-50/60 rounded-xl border border-slate-100">
                <div className="w-12 h-12 rounded-xl bg-slate-100 flex items-center justify-center mb-3">
                  <FileText size={24} className="text-slate-300" />
                </div>
                <p className="text-sm font-medium text-slate-500">No pending prescriptions</p>
                <p className="text-[11px] mt-1 text-slate-400 text-center max-w-xs">
                  Doctors will send prescriptions here from the OPD portal.
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
                {drafts.map(draft => (
                  <DraftCard
                    key={draft.id}
                    draft={draft}
                    onOpen={handleOpenInBilling}
                    onPrint={handlePrintDraft}
                    onDelete={setConfirmTarget}
                    isBeingDeleted={deleting && confirmTarget?.id === draft.id}
                  />
                ))}
              </div>
            )}
          </div>

          {/* ── Completed Bills ── */}
          <div>
            <SectionHeader
              icon={CheckCircle2}
              title="Completed Bills"
              count={recentCompleted.length}
              countColor="bg-emerald-100 text-emerald-700"
            />

            {!hasCompleted ? (
              <div className="flex flex-col items-center justify-center py-8 text-slate-400 bg-slate-50/60 rounded-xl border border-slate-100">
                <div className="w-10 h-10 rounded-xl bg-slate-100 flex items-center justify-center mb-2">
                  <Receipt size={20} className="text-slate-300" />
                </div>
                <p className="text-[12px] font-medium text-slate-500">No bills generated yet</p>
                <p className="text-[11px] mt-0.5 text-slate-400">Bills appear here after invoices are generated.</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
                {recentCompleted.map(inv => (
                  <CompletedCard
                    key={inv.id}
                    invoice={inv}
                    onView={onViewInvoice}
                    onViewPrint={onViewInvoicePrint}
                    onViewPrinted={onViewInvoicePrinted}
                    onCancel={onCancelInvoice}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  )
}
