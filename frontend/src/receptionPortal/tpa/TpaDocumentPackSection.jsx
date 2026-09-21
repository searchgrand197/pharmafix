import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import toast from 'react-hot-toast'
import api from '../../api'
import { formatDateTime, formatDateOnly } from '../../utils/dateTimeFormat'
import {
  flattenPrintableDocs,
  loadTpaDocPreviewHtml,
  printAllTpaDocuments,
  printTpaDocument,
} from './tpaPrintQueue'

function formatWindowLabel(window) {
  if (!window?.start) return '—'
  const start = formatDateTime(window.start)
  const end = window.end ? formatDateTime(window.end) : '—'
  return `${start} → ${end}`
}

function admissionMatchesFilter(row, term) {
  if (!term) return true
  const hay = [
    row.patient_name,
    row.patient_uhid,
    row.mobile_number,
    row.ipd_no,
    row.bed_code,
    row.ward_name,
    row.department,
    row.assigned_doctor_name,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
  return hay.includes(term)
}

function patientPackName(pack, row) {
  if (pack?.patient) {
    return [pack.patient.first_name, pack.patient.last_name].filter(Boolean).join(' ') || pack.patient.uhid || 'Patient'
  }
  return row?.patient_name || 'Patient'
}

function isPrintable(doc) {
  return Boolean(doc?.id) && doc.meta?.available !== false
}

function docAmount(doc) {
  const meta = doc?.meta || {}
  const raw = meta.amount ?? meta.grand_total ?? meta.net_amount
  const n = Number(raw)
  return Number.isFinite(n) ? n : null
}

function pageAmount(page) {
  if (!page?.items?.length) return null
  let sum = 0
  let any = false
  for (const doc of page.items) {
    const n = docAmount(doc)
    if (n == null) continue
    sum += n
    any = true
  }
  return any ? sum : null
}

function packTotalAmount(pack) {
  let sum = 0
  let any = false
  for (const group of pack?.groups || []) {
    // Advance payment slips are not part of pack total.
    if (group.type === 'payment_slip') continue
    for (const doc of group.items || []) {
      if (!isPrintable(doc)) continue
      const n = docAmount(doc)
      if (n == null) continue
      sum += n
      any = true
    }
  }
  return any ? sum : null
}

function formatInr(amount) {
  if (amount == null || !Number.isFinite(Number(amount))) return '—'
  return `₹${Number(amount).toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`
}

function pageBillNumber(page) {
  if (!page?.items?.length) return '—'
  if (page.type === 'payment_slip' && page.items.length > 1) {
    return `${page.items.length} advance payment slips`
  }
  const doc = page.items[0]
  const meta = doc?.meta || {}
  return (
    meta.invoice_no
    || meta.slip_number
    || meta.receipt_no
    || meta.lab_no
    || meta.bill_no
    || doc?.label
    || '—'
  )
}

function pageDateTime(page) {
  if (!page?.items?.length) return '—'
  if (page.type === 'payment_slip' && page.items.length > 1) {
    const dates = page.items.map((d) => d.date).filter(Boolean)
    if (!dates.length) return '—'
    const first = formatDateTime(dates[0])
    const last = formatDateTime(dates[dates.length - 1])
    return first === last ? first : `${first} → ${last}`
  }
  const d = page.items[0]?.date
  return d ? formatDateTime(d) : '—'
}

const CATEGORY_LABELS = {
  opd: 'OPD',
  final_bill: 'Final Bill',
  discharge_summary: 'Discharge Summary',
  payment_slip: 'Advance Payment Slip',
  pharmacy: 'Pharmacy Bills',
  lab: 'Lab Reports',
}

function categoryTitle(type, fallbackLabel) {
  return CATEGORY_LABELS[type] || fallbackLabel || 'Documents'
}

/** Group flat preview pages into collapsible category sections (preserves pack order). */
function buildSidebarCategories(pages) {
  const cats = []
  for (let i = 0; i < pages.length; i += 1) {
    const page = pages[i]
    const key = page.type || page.label || 'other'
    const last = cats[cats.length - 1]
    if (last && last.key === key) {
      last.entries.push({ page, pageIndex: i })
      continue
    }
    cats.push({
      key,
      type: page.type,
      label: categoryTitle(page.type, page.label),
      entries: [{ page, pageIndex: i }],
    })
  }
  return cats.map((cat) => {
    let sum = 0
    let any = false
    for (const { page } of cat.entries) {
      const n = pageAmount(page)
      if (n == null) continue
      sum += n
      any = true
    }
    return { ...cat, total: any ? sum : null }
  })
}

function buildPreviewPages(pack) {
  const pages = []
  for (const group of pack?.groups || []) {
    const items = (group.items || []).filter(isPrintable)
    if (!items.length) continue
    if (group.type === 'payment_slip') {
      pages.push({ type: group.type, label: group.label, items })
      continue
    }
    for (const item of items) {
      pages.push({ type: group.type, label: group.label, items: [item] })
    }
  }
  return pages
}

function usesPortalPreview(type) {
  return type === 'opd' || type === 'final_bill' || type === 'discharge_summary' || type === 'pharmacy'
}

function DocPreviewFrame({ doc }) {
  const iframeRef = useRef(null)
  const [html, setHtml] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError('')
    setHtml('')
    loadTpaDocPreviewHtml(doc)
      .then((result) => {
        if (cancelled) return
        if (!result) {
          setError('Preview not available')
          return
        }
        setHtml(result)
      })
      .catch((err) => {
        if (!cancelled) setError(err?.message || 'Failed to load preview')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [doc])

  useEffect(() => {
    if (!html || !iframeRef.current) return
    const iframe = iframeRef.current
    const docEl = iframe.contentDocument || iframe.contentWindow?.document
    if (!docEl) return
    docEl.open()
    docEl.write(html)
    docEl.close()
    const resize = () => {
      try {
        const h = docEl.documentElement?.scrollHeight || docEl.body?.scrollHeight || 640
        iframe.style.height = `${Math.max(520, h + 24)}px`
      } catch {
        iframe.style.height = '640px'
      }
    }
    resize()
    const t = setTimeout(resize, 250)
    return () => clearTimeout(t)
  }, [html])

  if (loading) {
    return <div className="py-16 text-center text-sm text-slate-500">Loading preview…</div>
  }
  if (error) {
    return <div className="py-10 text-center text-sm text-amber-700">{error}</div>
  }
  return (
    <iframe
      ref={iframeRef}
      title={doc.label || 'Document preview'}
      className="w-full bg-white border border-slate-200 rounded-xl shadow-sm"
      style={{ minHeight: 520 }}
    />
  )
}

export default function TpaDocumentPackSection({
  onPortalPrint,
  onPharmacyPrint,
  onClearPreview,
  onPreviewHost,
}) {
  const [filter, setFilter] = useState('')
  const [rows, setRows] = useState([])
  const [loadingList, setLoadingList] = useState(true)
  const [admissionId, setAdmissionId] = useState('')
  const [selectedRow, setSelectedRow] = useState(null)
  const [pack, setPack] = useState(null)
  const [loadingPack, setLoadingPack] = useState(false)
  const [modalOpen, setModalOpen] = useState(false)
  const [pageIndex, setPageIndex] = useState(0)
  const [previewEpoch, setPreviewEpoch] = useState(0)
  const [printing, setPrinting] = useState(false)
  const [printProgress, setPrintProgress] = useState(null)
  const [collapsedCats, setCollapsedCats] = useState({})
  const bodyRef = useRef(null)

  const printableDocs = useMemo(() => flattenPrintableDocs(pack), [pack])
  const pages = useMemo(() => buildPreviewPages(pack), [pack])
  const sidebarCategories = useMemo(() => buildSidebarCategories(pages), [pages])
  const currentPage = pages[pageIndex] || null
  const currentAmount = useMemo(() => pageAmount(currentPage), [currentPage])
  const packTotal = useMemo(() => packTotalAmount(pack), [pack])

  // On patient / pack open, collapse every category.
  useEffect(() => {
    if (!sidebarCategories.length) return
    const next = {}
    for (const cat of sidebarCategories) next[cat.key] = true
    setCollapsedCats(next)
  }, [pack])

  // Stable ref callback — an inline arrow would detach (null) and re-attach the host on
  // every render, remounting the portaled preview and killing in-flight print timers.
  const attachPreviewHost = useCallback(
    (el) => {
      if (typeof onPreviewHost === 'function') onPreviewHost(el)
    },
    [onPreviewHost],
  )

  function toggleCategory(key) {
    setCollapsedCats((prev) => ({ ...prev, [key]: !(prev[key] !== false) }))
  }

  function goToPage(idx) {
    const page = pages[idx]
    if (!page) return
    const key = page.type || page.label || 'other'
    setPageIndex(idx)
    setCollapsedCats((prev) => ({ ...prev, [key]: false }))
  }

  const loadDischargedList = useCallback(async () => {
    setLoadingList(true)
    try {
      const { data } = await api.get('/ipd-admissions/?status=discharged&limit=500')
      let list = data?.data || data?.results || data || []
      if (!Array.isArray(list)) list = []
      list = list.filter((a) => String(a.status || '').toLowerCase() === 'discharged')
      list.sort((a, b) => {
        const da = String(b.discharged_at || b.admission_date || '')
        const db = String(a.discharged_at || a.admission_date || '')
        return da.localeCompare(db)
      })
      setRows(list)
    } catch {
      toast.error('Could not load discharged patients')
      setRows([])
    } finally {
      setLoadingList(false)
    }
  }, [])

  useEffect(() => {
    loadDischargedList()
  }, [loadDischargedList])

  const filteredRows = useMemo(() => {
    const term = String(filter || '').trim().toLowerCase()
    if (!term) return rows
    return rows.filter((r) => admissionMatchesFilter(r, term))
  }, [rows, filter])

  async function loadPackAndOpen(admId) {
    if (!admId) return
    setLoadingPack(true)
    setPack(null)
    setPageIndex(0)
    setCollapsedCats({})
    setModalOpen(true)
    try {
      const { data } = await api.get(`/patients/tpa-document-pack/?admission_id=${encodeURIComponent(admId)}`)
      const payload = data?.data || data
      setPack(payload)
    } catch (err) {
      toast.error(err?.response?.data?.errors?.admission?.[0] || err?.response?.data?.detail || 'Failed to load TPA pack')
      setAdmissionId('')
      setSelectedRow(null)
      setModalOpen(false)
    } finally {
      setLoadingPack(false)
    }
  }

  function selectAdmission(row) {
    const id = String(row.id)
    setSelectedRow(row)
    setAdmissionId(id)
    loadPackAndOpen(id)
  }

  function closeModal() {
    setModalOpen(false)
    setPageIndex(0)
    setCollapsedCats({})
    if (typeof onClearPreview === 'function') onClearPreview()
    if (typeof onPreviewHost === 'function') onPreviewHost(null)
  }

  const handlers = useMemo(
    () => ({
      onPortalPrint: async (doc, options) => {
        if (typeof onPortalPrint === 'function') {
          await onPortalPrint(doc, pack, options || {})
        }
      },
      onPharmacyPrint: async (id, options) => {
        if (typeof onPharmacyPrint === 'function') {
          await onPharmacyPrint(id, options || {})
        }
      },
      onError: (err, doc) => {
        toast.error(`${doc?.label || 'Document'}: ${err?.message || 'Print failed'}`)
      },
    }),
    [onPortalPrint, onPharmacyPrint, pack],
  )

  useEffect(() => {
    if (!modalOpen || loadingPack || !currentPage) {
      if (typeof onClearPreview === 'function') onClearPreview()
      return undefined
    }
    const type = currentPage.type
    const doc = currentPage.items[0]
    if (!usesPortalPreview(type) || !doc) {
      if (typeof onClearPreview === 'function') onClearPreview()
      return undefined
    }
    let cancelled = false
    ;(async () => {
      try {
        if (type === 'pharmacy') {
          await handlers.onPharmacyPrint(doc.id, {
            previewOnly: true,
            embed: true,
            pharmacyId: doc?.meta?.pharmacy_id || '',
          })
        } else {
          await handlers.onPortalPrint(doc, { previewOnly: true, embed: true })
        }
      } catch {
        if (!cancelled) toast.error('Could not open preview')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [modalOpen, loadingPack, pageIndex, currentPage, handlers, onClearPreview, previewEpoch])

  useEffect(() => {
    if (bodyRef.current) bodyRef.current.scrollTop = 0
  }, [pageIndex])

  useEffect(() => {
    if (!modalOpen) return undefined
    function onKey(e) {
      if (e.key === 'Escape') closeModal()
      if (e.key === 'ArrowRight') goToPage(Math.min(pages.length - 1, pageIndex + 1))
      if (e.key === 'ArrowLeft') goToPage(Math.max(0, pageIndex - 1))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [modalOpen, pages.length, pageIndex])

  async function handlePrintPage() {
    if (!currentPage) return
    setPrinting(true)
    try {
      for (const doc of currentPage.items) {
        await printTpaDocument(doc, handlers)
      }
    } catch (err) {
      toast.error(err?.message || 'Print failed')
    } finally {
      setPrinting(false)
      setPreviewEpoch((n) => n + 1)
    }
  }

  async function handlePrintAll() {
    if (!pack || !printableDocs.length) {
      toast.error('No documents to print')
      return
    }
    setPrinting(true)
    setPrintProgress({ index: 0, total: printableDocs.length })
    try {
      await printAllTpaDocuments(pack, handlers, {
        gapMs: 1400,
        onProgress: setPrintProgress,
      })
      toast.success(`Printed ${printableDocs.length} document(s)`)
    } finally {
      setPrinting(false)
      setPrintProgress(null)
      setPreviewEpoch((n) => n + 1)
    }
  }

  const showInlineStack = currentPage && (currentPage.type === 'payment_slip' || currentPage.type === 'lab')
  const canPrev = pageIndex > 0
  const canNext = pageIndex < pages.length - 1

  return (
    <div className="flex-1 min-h-0 flex flex-col overflow-hidden bg-slate-50">
      <div className="shrink-0 border-b border-slate-200 bg-white px-4 py-3 sm:px-6">
        <h2 className="text-lg font-black text-slate-900 tracking-tight">TPA Document Pack</h2>
        <p className="text-xs text-slate-500 mt-0.5">
          Choose a discharged patient to open the document pack. Use Previous / Next to move between categories.
        </p>
      </div>

      <div className="flex-1 min-h-0 overflow-hidden flex flex-col bg-white">
        <div className="px-4 py-3 border-b border-slate-200 flex flex-wrap items-center gap-3 justify-between bg-slate-50">
          <div>
            <p className="text-sm font-bold text-slate-900">Discharged patients</p>
            <p className="text-xs text-slate-500">
              {loadingList ? 'Loading…' : `${filteredRows.length} of ${rows.length} shown`}
            </p>
          </div>
          <div className="flex items-center gap-2 w-full sm:w-auto">
            <input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Filter by name, UHID, IPD no…"
              className="flex-1 sm:w-64 border border-slate-200 rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-teal-600 focus:border-teal-600 focus:outline-none"
            />
            <button
              type="button"
              onClick={loadDischargedList}
              disabled={loadingList}
              className="px-3 py-2 rounded-xl text-sm font-bold text-teal-800 bg-teal-50 hover:bg-teal-100 border border-teal-100 disabled:opacity-50 transition-colors"
            >
              Refresh
            </button>
          </div>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto bg-slate-50/40">
          {loadingList ? (
            <div className="py-12 text-center text-sm text-slate-500">Loading discharged patients…</div>
          ) : filteredRows.length === 0 ? (
            <div className="py-12 text-center text-sm text-slate-500">
              {rows.length === 0 ? 'No discharged patients found.' : 'No matches for this filter.'}
            </div>
          ) : (
            <ul className="p-2.5 space-y-1.5">
              {filteredRows.map((row) => {
                const active = String(row.id) === String(admissionId) && modalOpen
                return (
                  <li key={row.id}>
                    <button
                      type="button"
                      onClick={() => selectAdmission(row)}
                      className={`w-full text-left px-3.5 py-3 rounded-xl transition-all duration-200 flex flex-wrap items-center gap-x-4 gap-y-1 justify-between border ${
                        active
                          ? 'bg-teal-700 text-white border-teal-800 shadow-sm'
                          : 'bg-white border-slate-200/80 hover:border-teal-200 hover:bg-teal-50/40'
                      }`}
                    >
                      <div className="min-w-0">
                        <p className={`text-sm font-bold truncate ${active ? 'text-white' : 'text-slate-900'}`}>
                          {row.patient_name || '—'}
                          <span className={`ml-2 font-semibold ${active ? 'text-teal-100' : 'text-slate-500'}`}>
                            {row.patient_uhid || ''}
                          </span>
                        </p>
                        <p className={`text-xs mt-0.5 ${active ? 'text-teal-100/85' : 'text-slate-500'}`}>
                          IPD {row.ipd_no || '—'}
                          {row.bed_code ? ` · ${row.ward_name || 'Ward'} / ${row.bed_code}` : ''}
                          {row.assigned_doctor_name ? ` · Dr. ${row.assigned_doctor_name}` : ''}
                        </p>
                      </div>
                      <div className="text-right shrink-0">
                        <p className={`text-xs ${active ? 'text-teal-100/70' : 'text-slate-500'}`}>
                          Admitted {formatDateOnly(row.admission_date) || '—'}
                        </p>
                        <p className={`text-xs font-semibold ${active ? 'text-white' : 'text-teal-700'}`}>
                          Discharged {formatDateOnly(row.discharged_at) || formatDateTime(row.discharged_at) || '—'}
                        </p>
                      </div>
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      </div>

      {modalOpen && (
        <div className="fixed inset-0 z-[550] bg-slate-900/45 backdrop-blur-[1px] flex items-stretch sm:items-center justify-center p-0 sm:p-4">
          <div className="w-full max-w-7xl bg-white shadow-2xl flex flex-col h-[100dvh] sm:h-[92vh] sm:rounded-2xl overflow-hidden border border-slate-200">
            <div className="shrink-0 border-b border-teal-800/20 px-3 sm:px-5 py-3 flex items-center gap-2 bg-teal-700">
              <button
                type="button"
                disabled={!canPrev || printing}
                onClick={() => goToPage(Math.max(0, pageIndex - 1))}
                className="px-3 py-2 rounded-xl text-sm font-bold bg-white/15 text-white hover:bg-white/25 disabled:opacity-40 shrink-0 transition-colors"
              >
                ← Previous
              </button>
              <div className="flex-1 min-w-0 text-left">
                <p className="text-base sm:text-lg font-black text-white truncate">
                  {currentPage?.label || (loadingPack ? 'Loading…' : 'No documents')}
                </p>
                <p className="text-[11px] text-teal-50/85 truncate">
                  {patientPackName(pack, selectedRow)}
                  {pack?.patient?.uhid || selectedRow?.patient_uhid
                    ? ` · ${pack?.patient?.uhid || selectedRow?.patient_uhid}`
                    : ''}
                  {pages.length ? ` · ${pageIndex + 1} / ${pages.length}` : ''}
                </p>
              </div>
              <div className="shrink-0 text-right px-2 min-w-[7.5rem]">
                <p className="text-[10px] font-bold uppercase tracking-wide text-teal-100/80">Amount</p>
                <p className="text-base sm:text-lg font-black text-white tabular-nums">
                  {formatInr(currentAmount)}
                </p>
              </div>
              <button
                type="button"
                disabled={!canNext || printing}
                onClick={() => goToPage(Math.min(pages.length - 1, pageIndex + 1))}
                className="px-3 py-2 rounded-xl text-sm font-bold bg-white/15 text-white hover:bg-white/25 disabled:opacity-40 shrink-0 transition-colors"
              >
                Next →
              </button>
              <button
                type="button"
                onClick={closeModal}
                className="ml-1 px-3 py-2 rounded-xl text-sm font-bold bg-white text-teal-900 hover:bg-teal-50 shrink-0 transition-colors"
              >
                Close
              </button>
            </div>

            {pack && !loadingPack && (
              <div className="shrink-0 px-4 py-2.5 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2 bg-slate-50">
                <p className="text-xs text-slate-500">
                  {formatWindowLabel(pack.window)} · IPD {pack.admission?.ipd_no || '—'}
                  {currentPage?.type === 'payment_slip' && currentPage.items.length > 1
                    ? ` · ${currentPage.items.length} advance payment slips (scroll)`
                    : ''}
                </p>
                <div className="flex items-center gap-3">
                  <p className="text-xs font-bold text-slate-700 tabular-nums">
                    Pack total{' '}
                    <span className="text-teal-700">{formatInr(packTotal)}</span>
                  </p>
                  <button
                    type="button"
                    disabled={printing || !currentPage}
                    onClick={handlePrintPage}
                    className="px-3 py-1.5 rounded-lg text-xs font-bold bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 disabled:opacity-40 transition-colors"
                  >
                    Print this
                  </button>
                  <button
                    type="button"
                    disabled={printing || printableDocs.length === 0}
                    onClick={handlePrintAll}
                    className="px-3 py-1.5 rounded-lg text-xs font-black text-white bg-teal-700 hover:bg-teal-800 disabled:opacity-40 transition-colors"
                  >
                    {printing
                      ? printProgress
                        ? `Printing ${printProgress.index + 1}/${printProgress.total}…`
                        : 'Printing…'
                      : `Print All (${printableDocs.length})`}
                  </button>
                </div>
              </div>
            )}

            <div className="flex-1 min-h-0 flex overflow-hidden bg-slate-100">
              {!loadingPack && pages.length > 0 && (
                <aside className="w-[240px] sm:w-[280px] shrink-0 border-r border-slate-200 bg-white flex flex-col min-h-0">
                  <div className="shrink-0 px-3.5 py-3 border-b border-slate-200 bg-slate-50">
                    <p className="text-[10px] font-black uppercase tracking-[0.14em] text-teal-800">Documents</p>
                    <p className="text-[11px] text-slate-500 mt-0.5">
                      {pages.length} in {sidebarCategories.length} categor{sidebarCategories.length === 1 ? 'y' : 'ies'}
                    </p>
                  </div>
                  <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain p-2 space-y-2">
                    {sidebarCategories.map((cat) => {
                      const collapsed = collapsedCats[cat.key] !== false
                      const hasActive = cat.entries.some((e) => e.pageIndex === pageIndex)
                      return (
                        <div
                          key={cat.key}
                          className={`rounded-xl overflow-hidden border transition-all duration-200 ${
                            hasActive
                              ? 'border-teal-600/50 shadow-sm ring-1 ring-teal-600/15'
                              : 'border-slate-200'
                          }`}
                        >
                          <button
                            type="button"
                            onClick={() => toggleCategory(cat.key)}
                            className={`w-full flex items-center gap-2.5 px-3 py-2.5 text-left transition-colors duration-200 ${
                              hasActive
                                ? 'bg-teal-700 hover:bg-teal-800'
                                : 'bg-teal-600 hover:bg-teal-700'
                            }`}
                          >
                            <span
                              className={`flex h-5 w-5 items-center justify-center rounded-md bg-white/15 text-white text-[9px] transition-transform duration-300 ease-out ${
                                collapsed ? 'rotate-0' : 'rotate-90'
                              }`}
                              aria-hidden
                            >
                              ▶
                            </span>
                            <div className="flex-1 min-w-0">
                              <p className="text-xs font-black truncate text-white tracking-tight">
                                {cat.label}
                              </p>
                              <p className="text-[10px] text-teal-50/80 mt-0.5">
                                {cat.entries.length} item{cat.entries.length === 1 ? '' : 's'}
                                {cat.total != null ? ` · ${formatInr(cat.total)}` : ''}
                              </p>
                            </div>
                          </button>
                          <div
                            className={`grid transition-[grid-template-rows] duration-300 ease-out ${
                              collapsed ? 'grid-rows-[0fr]' : 'grid-rows-[1fr]'
                            }`}
                          >
                            <div className="overflow-hidden">
                              <ul className="bg-white py-1">
                                {cat.entries.map(({ page, pageIndex: idx }) => {
                                  const active = idx === pageIndex
                                  const billNo = pageBillNumber(page)
                                  const when = pageDateTime(page)
                                  const amt = pageAmount(page)
                                  return (
                                    <li key={`${page.type}:${page.items.map((d) => d.id).join(',')}:${idx}`}>
                                      <button
                                        type="button"
                                        onClick={() => goToPage(idx)}
                                        disabled={printing}
                                        className={`w-full text-left px-3 py-2.5 transition-all duration-200 border-l-[3px] ${
                                          active
                                            ? 'border-teal-600 bg-teal-50'
                                            : 'border-transparent hover:bg-slate-50 hover:border-slate-200'
                                        }`}
                                      >
                                        <p className={`text-xs font-black truncate ${active ? 'text-teal-900' : 'text-slate-800'}`}>
                                          {billNo}
                                        </p>
                                        <p className="text-[10px] text-slate-500 mt-0.5 leading-snug">{when}</p>
                                        <p className={`text-xs font-black tabular-nums mt-1 ${active ? 'text-teal-800' : 'text-slate-700'}`}>
                                          {formatInr(amt)}
                                        </p>
                                      </button>
                                    </li>
                                  )
                                })}
                              </ul>
                            </div>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </aside>
              )}

              <div ref={bodyRef} className="flex-1 min-h-0 overflow-y-auto p-3 sm:p-5 scroll-smooth bg-slate-100">
                {loadingPack && (
                  <div className="py-20 text-center text-sm text-slate-500">Gathering documents…</div>
                )}
                {!loadingPack && pages.length === 0 && (
                  <div className="py-20 text-center text-sm text-slate-500">No documents found for this stay.</div>
                )}
                {showInlineStack && (
                  <div className="space-y-6 max-w-[210mm] mx-auto pb-8">
                    {currentPage.items.map((doc) => (
                      <div key={`${doc.type}:${doc.id}`}>
                        {currentPage.items.length > 1 && (
                          <p className="text-xs font-bold text-slate-500 mb-2">{doc.label}</p>
                        )}
                        <DocPreviewFrame doc={doc} />
                      </div>
                    ))}
                  </div>
                )}
                {currentPage && usesPortalPreview(currentPage.type) && (
                  <div
                    id="tpa-preview-host"
                    className="tpa-preview-host max-w-[210mm] mx-auto pb-8"
                    ref={attachPreviewHost}
                  />
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
