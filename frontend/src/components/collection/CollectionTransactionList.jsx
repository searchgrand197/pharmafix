import React, { useMemo, useState } from 'react'
import ReceiptLongOutlinedIcon from '@mui/icons-material/ReceiptLongOutlined'
import { formatDateTime } from '../../utils/dateTimeFormat'
const ITEMS_PER_PAGE = 10

function parseAmount(value) {
  const n = parseFloat(String(value || '').replace(/,/g, ''))
  return Number.isFinite(n) ? n : 0
}

function formatEntryDateTime(iso) {
  return formatDateTime(iso)
}

function tokenLabel(entry) {
  if (entry.entry_type === 'payment') return 'P'
  if (entry.entry_type === 'expense') return 'EXP'
  if (entry.entry_type === 'handover') return 'HO'
  return `#${entry.token_number || entry.queue_number || '--'}`
}

function modeBadgeClass(mode, entry) {
  if (entry.entry_type === 'expense') return 'bg-rose-100 text-rose-700'
  if (entry.entry_type === 'handover') {
    if (entry.handover_status === 'pending') return 'bg-amber-100 text-amber-800'
    if (entry.handover_status === 'accepted') return 'bg-emerald-100 text-emerald-700'
    return 'bg-gray-100 text-gray-600'
  }
  if (mode === 'upi') return 'bg-blue-100 text-blue-700'
  if (mode === 'cash') return 'bg-emerald-100 text-emerald-700'
  return 'bg-gray-100 text-gray-600'
}

function modeBadgeLabel(entry) {
  if (entry.entry_type === 'expense') return 'expense'
  if (entry.entry_type === 'handover') {
    return entry.handover_status === 'pending' ? 'pending' : entry.handover_status || 'handover'
  }
  return entry.payment_mode || 'cash'
}

function CollectionRow({ entry, showDateTimeColumn }) {
  const isHandover = entry.entry_type === 'handover'
  const isExpense = entry.entry_type === 'expense'
  const isOtherFunds = isExpense && entry.expense_source === 'other_funds'
  const rowClass = isHandover
    ? 'grid grid-cols-12 px-4 py-2.5 items-center bg-amber-50/40 hover:bg-amber-50/70 text-sm transition-colors'
    : isOtherFunds
      ? 'grid grid-cols-12 px-4 py-2.5 items-center bg-slate-50/50 hover:bg-slate-50/80 text-sm transition-colors'
      : isExpense
        ? 'grid grid-cols-12 px-4 py-2.5 items-center bg-rose-50/30 hover:bg-rose-50/50 text-sm transition-colors'
        : 'grid grid-cols-12 px-4 py-2.5 items-center hover:bg-white text-sm transition-colors group'

  const amountDisplay = isOtherFunds
    ? <span className="text-slate-500 line-through">₹{Number(entry.amount || 0).toLocaleString('en-IN')}</span>
    : isExpense
      ? <span className="text-rose-700">₹{entry.amount}</span>
      : `₹${entry.amount}`

  if (showDateTimeColumn) {
    return (
      <div className={rowClass}>
        <div className="col-span-1 font-mono font-bold text-gray-500">{tokenLabel(entry)}</div>
        <div className="col-span-2 text-[11px] font-semibold text-gray-600 whitespace-nowrap">
          {formatEntryDateTime(entry.entry_time)}
        </div>
        <div className="col-span-3 font-bold text-gray-800 truncate" title={entry.patient_name}>
          {entry.patient_name}
          {isOtherFunds && <span className="ml-1 text-[9px] font-bold text-slate-500 bg-slate-100 px-1 py-0.5 rounded align-middle">Other Funds</span>}
        </div>
        <div className="col-span-2 text-right font-black text-gray-900">
          {amountDisplay}
        </div>
        <div className="col-span-2 text-right">
          <span
            className={`text-[10px] font-black uppercase tracking-tighter px-2 py-0.5 rounded-md ${isOtherFunds ? 'bg-slate-100 text-slate-600' : modeBadgeClass(entry.payment_mode, entry)}`}
          >
            {modeBadgeLabel(entry)}
          </span>
        </div>
        <div className="col-span-2 text-right">
          <span className="text-[10px] font-bold text-gray-500 uppercase truncate block" title={entry.created_by_name}>
            {entry.created_by_name || '—'}
          </span>
        </div>
      </div>
    )
  }

  return (
    <div className={rowClass}>
      <div className="col-span-1 font-mono font-bold text-gray-400 group-hover:text-emerald-600 transition-colors">
        {tokenLabel(entry)}
      </div>
      <div className="col-span-4 font-bold text-gray-800 truncate">
        {entry.patient_name}
        {isOtherFunds && <span className="ml-1 text-[9px] font-bold text-slate-500 bg-slate-100 px-1 py-0.5 rounded align-middle">Other Funds</span>}
      </div>
      <div className="col-span-2 text-right font-black text-gray-900">
        {amountDisplay}
      </div>
      <div className="col-span-2 text-right">
        <span
          className={`text-[10px] font-black uppercase tracking-tighter px-2 py-0.5 rounded-md ${isOtherFunds ? 'bg-slate-100 text-slate-600' : modeBadgeClass(entry.payment_mode, entry)}`}
        >
          {modeBadgeLabel(entry)}
        </span>
      </div>
      <div className="col-span-3 text-right">
        <span className="text-[10px] font-bold text-gray-400 uppercase">{entry.created_by_name || '—'}</span>
      </div>
    </div>
  )
}

export default function CollectionTransactionList({
  entries = [],
  stats = {},
  showOpeningCash = false,
  emptyMessage = 'No collections recorded for this period',
  className = '',
  showGrandTotalFooter = true,
  showDateTimeColumn = false,
  listCountLabel,
}) {
  const [currentPage, setCurrentPage] = useState(1)

  const paidEntries = useMemo(
    () => (entries || []).filter((v) => v.entry_type === 'expense' || parseAmount(v.amount) > 0),
    [entries],
  )

  const totalPages = Math.max(1, Math.ceil(paidEntries.length / ITEMS_PER_PAGE))
  const safePage = Math.min(currentPage, totalPages)
  const startIndex = (safePage - 1) * ITEMS_PER_PAGE
  const currentItems = paidEntries.slice(startIndex, startIndex + ITEMS_PER_PAGE)

  const openingCash = Number(stats.openingCash || 0)
  const hasOpeningCash = showOpeningCash && openingCash > 0
  const countLabel = listCountLabel || `${paidEntries.length} Payments`

  React.useEffect(() => {
    setCurrentPage(1)
  }, [entries])

  return (
    <div className={`bg-gray-50/50 rounded-2xl border border-gray-100 overflow-hidden ${className}`.trim()}>
      <div className="px-4 py-3 border-b border-gray-100 bg-white flex items-center justify-between">
        <h3 className="text-sm font-black text-gray-700 flex items-center gap-2">
          <ReceiptLongOutlinedIcon sx={{ fontSize: 16, color: 'success.main' }} />
          Transaction List
        </h3>
        <span className="text-[10px] font-black bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full uppercase">
          {countLabel}
        </span>
      </div>
      <div className="divide-y divide-gray-100/50 overflow-hidden">
        {showDateTimeColumn ? (
          <div className="grid grid-cols-12 px-4 py-2 text-[10px] font-black text-gray-400 uppercase tracking-widest bg-white/50">
            <div className="col-span-1">TKN</div>
            <div className="col-span-2">Date &amp; Time</div>
            <div className="col-span-3">Description</div>
            <div className="col-span-2 text-right">Amount</div>
            <div className="col-span-2 text-right">Mode</div>
            <div className="col-span-2 text-right">Staff</div>
          </div>
        ) : (
          <div className="grid grid-cols-12 px-4 py-2 text-[10px] font-black text-gray-400 uppercase tracking-widest bg-white/50">
            <div className="col-span-1">TKN</div>
            <div className="col-span-4">Patient Name</div>
            <div className="col-span-2 text-right">Amount</div>
            <div className="col-span-2 text-right">Mode</div>
            <div className="col-span-3 text-right">Created By</div>
          </div>
        )}
        <div className="max-h-[450px] overflow-y-auto">
          {paidEntries.length === 0 ? (
            <div className="px-4 py-12 text-center text-gray-400 italic text-sm">{emptyMessage}</div>
          ) : (
            <>
              {hasOpeningCash && (
                <div className="grid grid-cols-12 px-4 py-2.5 items-center bg-emerald-50/60 border-b border-emerald-100 text-sm">
                  <div className="col-span-1 font-mono font-bold text-emerald-700">#--</div>
                  {showDateTimeColumn ? <div className="col-span-2" /> : null}
                  <div className={showDateTimeColumn ? 'col-span-3' : 'col-span-4'}>
                    <span className="font-bold text-emerald-800 truncate">Opening Cash In Hand</span>
                  </div>
                  <div className="col-span-2 text-right font-black text-emerald-900">
                    ₹{openingCash.toLocaleString('en-IN')}
                  </div>
                  <div className="col-span-2 text-right">
                    <span className="text-[10px] font-black uppercase tracking-tighter px-2 py-0.5 rounded-md bg-emerald-100 text-emerald-700">
                      opening
                    </span>
                  </div>
                  <div className={showDateTimeColumn ? 'col-span-2 text-right' : 'col-span-3 text-right'}>
                    <span className="text-[10px] font-bold text-emerald-600 uppercase">handover</span>
                  </div>
                </div>
              )}
              {currentItems.map((v) => (
                <CollectionRow key={v.id} entry={v} showDateTimeColumn={showDateTimeColumn} />
              ))}
            </>
          )}
        </div>
      </div>

      {paidEntries.length > 0 && (
        <div className="px-4 py-3 bg-white border-t border-gray-100 flex items-center justify-between">
          <span className="text-sm text-gray-400 font-medium">
            {`Showing ${startIndex + 1}–${Math.min(startIndex + ITEMS_PER_PAGE, paidEntries.length)} of ${paidEntries.length}`}
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
              disabled={safePage === 1}
              className="px-4 py-1.5 rounded-full text-sm font-semibold bg-gray-200 text-gray-700 hover:bg-gray-300 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              Previous
            </button>
            <span className="text-sm text-gray-500 font-medium px-1">
              Page {safePage} of {totalPages || 1}
            </span>
            <button
              type="button"
              onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
              disabled={safePage >= totalPages || totalPages === 0}
              className="px-4 py-1.5 rounded-full text-sm font-semibold bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              Next
            </button>
          </div>
        </div>
      )}

      {showGrandTotalFooter ? (
        <div className="px-4 py-3 bg-gray-50 border-t border-gray-100 flex items-center justify-end gap-2">
          <span className="text-xs font-black text-gray-500 uppercase">Grand Total:</span>
          <span className="text-xl font-black text-emerald-700">
            ₹{Number(stats.total || 0).toLocaleString('en-IN')}
          </span>
        </div>
      ) : null}
    </div>
  )
}
