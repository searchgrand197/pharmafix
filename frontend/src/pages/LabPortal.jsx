import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import api, { getHospitalId } from '../api'
import toast from 'react-hot-toast'
import { formatDateTime, formatDateOnly, useTimeDisplayMode } from '../utils/dateTimeFormat'
import { getApiErrorMessage } from '../utils/apiError'
import { useAuthStore } from '../stores/authStore'

/* ── helpers ─────────────────────────────────────────────────── */
const fmt = (dt) => {
  if (!dt) return ''
  try {
    // dateStyle must be date-only; formatDateTime appends time itself
    return formatDateTime(dt, { dateStyle: 'dd/MMM/yyyy' })
  } catch {
    try {
      return new Date(dt).toLocaleString('en-IN')
    } catch {
      return ''
    }
  }
}

function toLocalDateInput(d = new Date()) {
  const dt = d instanceof Date ? d : new Date(d)
  if (Number.isNaN(dt.getTime())) return toLocalDateInput(new Date())
  const pad = (n) => String(n).padStart(2, '0')
  return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`
}

function dateInputToIso(dateValue) {
  if (!dateValue) return new Date().toISOString()
  const d = new Date(`${dateValue}T12:00:00`)
  if (Number.isNaN(d.getTime())) return new Date().toISOString()
  return d.toISOString()
}

function formatLabReportDate(dt) {
  return formatDateOnly(dt, { dateStyle: 'dd/MM/yyyy' })
}

async function fetchLabReport(id) {
  const { data } = await api.get(`/lab/reports/${id}/`)
  return data?.data || data
}

function splitPatientSearchName(text) {
  const parts = String(text || '').trim().split(/\s+/).filter(Boolean)
  if (!parts.length) return { first_name: '', last_name: '' }
  if (parts.length === 1) return { first_name: parts[0], last_name: '' }
  return { first_name: parts[0], last_name: parts.slice(1).join(' ') }
}

const STATUS = {
  draft: 'bg-amber-50 text-amber-700 border border-amber-200',
  final: 'bg-emerald-50 text-emerald-700 border border-emerald-200',
  cancelled: 'bg-rose-50 text-rose-700 border border-rose-200',
}

function useDebounced(value, ms = 350) {
  const [v, setV] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms)
    return () => clearTimeout(t)
  }, [value, ms])
  return v
}

/* ═══════════════════════════════════════════════════════════════
   LAB PORTAL — pharmacy-style shell
═══════════════════════════════════════════════════════════════ */
export default function LabPortal() {
  useTimeDisplayMode()
  const user = useAuthStore((s) => s.user)
  const [view, setView] = useState('work')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [tests, setTests] = useState([])
  const [categories, setCategories] = useState([])
  const [reports, setReports] = useState([])
  const [labSettings, setLabSettings] = useState(null)
  const [printReport, setPrintReport] = useState(null)
  const [pendingEditReportId, setPendingEditReportId] = useState(null)
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const [rR, tR, cR, sR] = await Promise.all([
        api.get('/lab/reports/?limit=200'),
        api.get('/lab/tests/?limit=500'),
        api.get('/lab/categories/?limit=100'),
        api.get('/lab/settings/'),
      ])
      setReports(rR.data?.data || rR.data?.results || [])
      setTests(tR.data?.data || tR.data?.results || [])
      setCategories(cR.data?.data || cR.data?.results || [])
      setLabSettings(sR.data?.data || sR.data || null)
    } catch {
      toast.error('Failed to load lab data')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { refresh() }, [refresh])

  const brand = labSettings?.lab_name || 'Lab'

  const navMain = [
    { id: 'work', label: 'Register / Results' },
    { id: 'reports', label: 'Reports' },
  ]
  const navSettings = [
    { id: 'settings_brand', label: 'Lab Branding' },
    { id: 'settings_templates', label: 'Test Templates' },
    { id: 'settings_categories', label: 'Categories' },
  ]

  return (
    <div className="h-screen w-screen flex bg-slate-50 text-slate-900 font-sans overflow-hidden text-[14px]">
      {/* Sidebar */}
      <aside className="w-56 bg-white border-r border-slate-200 flex flex-col shrink-0">
        <div className="px-3 py-3 border-b border-slate-200">
          <div className="flex items-center gap-2">
            {usableLabMediaUrl(labSettings?.logo_url) ? (
              <img
                src={usableLabMediaUrl(labSettings.logo_url)}
                alt=""
                className="w-7 h-7 rounded object-contain bg-slate-50"
                onError={(e) => { e.currentTarget.style.display = 'none' }}
              />
            ) : (
              <div className="w-7 h-7 bg-blue-600 rounded flex items-center justify-center text-white text-[10px] font-bold">Lb</div>
            )}
            <div className="min-w-0">
              <h1 className="text-xs font-bold text-slate-800 truncate leading-tight">{brand}</h1>
              <p className="text-[10px] text-slate-500">Laboratory</p>
            </div>
          </div>
        </div>

        <nav className="flex-1 py-2 flex flex-col gap-0.5 overflow-y-auto">
          {navMain.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setView(item.id)}
              className={`flex items-center gap-2 px-3 py-2 text-xs font-medium border-l-4 ${
                view === item.id
                  ? 'bg-blue-50 text-blue-700 border-blue-600'
                  : 'text-slate-600 border-transparent hover:bg-slate-50'
              }`}
            >
              {item.label}
            </button>
          ))}

          <div className="mt-1">
            <button
              type="button"
              onClick={() => setSettingsOpen((o) => !o)}
              className={`w-full flex items-center gap-2 px-3 py-2 text-xs font-medium border-l-4 ${
                view.startsWith('settings_')
                  ? 'bg-blue-50 text-blue-700 border-blue-600'
                  : 'text-slate-600 border-transparent hover:bg-slate-50'
              }`}
            >
              <span className="flex-1 text-left">Settings</span>
              <span className="text-[10px] text-slate-400">{settingsOpen || view.startsWith('settings_') ? '▾' : '▸'}</span>
            </button>
            {(settingsOpen || view.startsWith('settings_')) && (
              <div className="ml-4 border-l border-slate-100">
                {navSettings.map((sub) => (
                  <button
                    key={sub.id}
                    type="button"
                    onClick={() => setView(sub.id)}
                    className={`w-full text-left pl-3 pr-2 py-1.5 text-[11px] font-medium ${
                      view === sub.id ? 'text-blue-700 bg-blue-50/80' : 'text-slate-600 hover:bg-slate-50'
                    }`}
                  >
                    {sub.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        </nav>

        <div className="p-3 border-t border-slate-200">
          <button
            type="button"
            onClick={() => { useAuthStore.getState().logoutSilent(); window.location.replace('/login') }}
            className="w-full text-left text-xs font-medium text-slate-500 hover:text-rose-600"
          >
            Exit
          </button>
        </div>
      </aside>

      {/* Main */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <header className="h-10 bg-white border-b border-slate-200 px-4 flex items-center justify-between shrink-0">
          <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">
            {loading ? 'Loading…' : `${reports.filter((r) => r.status === 'draft').length} drafts · ${tests.length} templates`}
          </span>
          <span className="text-[11px] text-slate-500 font-medium">{user?.full_name || user?.username || ''}</span>
        </header>

        <main className="flex-1 overflow-hidden">
          {view === 'work' && (
            <WorkBillingView
              tests={tests}
              reports={reports}
              labSettings={labSettings}
              refresh={refresh}
              setPrintReport={setPrintReport}
              pendingEditReportId={pendingEditReportId}
              onPendingEditConsumed={() => setPendingEditReportId(null)}
            />
          )}
          {view === 'reports' && (
            <ReportsView
              reports={reports}
              setPrintReport={setPrintReport}
              refresh={refresh}
              onEditReport={(r) => {
                setPendingEditReportId(r.id)
                setView('work')
              }}
            />
          )}
          {view === 'settings_brand' && (
            <LabBrandingSettings settings={labSettings} onSaved={refresh} />
          )}
          {view === 'settings_templates' && (
            <TemplatesSettings tests={tests} categories={categories} refresh={refresh} />
          )}
          {view === 'settings_categories' && (
            <CategoriesSettings categories={categories} refresh={refresh} />
          )}
        </main>
      </div>

      {printReport && (
        <LabReportPrint
          report={printReport}
          settings={labSettings}
          onClose={() => setPrintReport(null)}
        />
      )}
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════════
   WORK — billing-style: patient → tests → values → live preview
═══════════════════════════════════════════════════════════════ */
function WorkBillingView({
  tests,
  reports,
  labSettings,
  refresh,
  setPrintReport,
  pendingEditReportId,
  onPendingEditConsumed,
}) {
  const [ptQuery, setPtQuery] = useState('')
  const debouncedQ = useDebounced(ptQuery)
  const [ptHits, setPtHits] = useState([])
  const [patient, setPatient] = useState(null)
  const [selectedTests, setSelectedTests] = useState([]) // catalog tests before save
  const [testSearch, setTestSearch] = useState('')
  const [report, setReport] = useState(null) // active draft/final being edited
  const [results, setResults] = useState([])
  const [meta, setMeta] = useState({
    barcode_no: '',
    sample_received_at: toLocalDateInput(),
    report_date: toLocalDateInput(),
  })
  const [saving, setSaving] = useState(false)
  const [showPreview, setShowPreview] = useState(true)
  const [showAddPatient, setShowAddPatient] = useState(false)

  const nextVisitPreview = labSettings?.next_visit_id_preview || `${labSettings?.visit_id_prefix || 'LABV'}-0001`

  // Patient search
  useEffect(() => {
    if (!debouncedQ || debouncedQ.length < 2 || patient) { setPtHits([]); return }
    let cancelled = false
    ;(async () => {
      try {
        const { data } = await api.get(`/patients/?search=${encodeURIComponent(debouncedQ)}&limit=8`)
        if (!cancelled) setPtHits(data?.data || data?.results || [])
      } catch { if (!cancelled) setPtHits([]) }
    })()
    return () => { cancelled = true }
  }, [debouncedQ, patient])

  // Patient drafts for quick reopen
  const patientDrafts = useMemo(() => {
    if (!patient) return []
    return reports.filter((r) => r.patient === patient.id || r.patient_details?.id === patient.id)
  }, [patient, reports])

  function pickPatient(p) {
    setPatient(p)
    setPtQuery('')
    setPtHits([])
    setShowAddPatient(false)
    setReport(null)
    setResults([])
    setSelectedTests([])
    setMeta({
      barcode_no: '',
      sample_received_at: toLocalDateInput(),
      report_date: toLocalDateInput(),
    })
  }

  function clearPatient() {
    setPatient(null)
    setReport(null)
    setResults([])
    setSelectedTests([])
  }

  async function openReportForEdit(reportRef, { reopenIfFinal = false } = {}) {
    const id = typeof reportRef === 'string' ? reportRef : reportRef?.id
    if (!id) return
    try {
      let full = await fetchLabReport(id)

      if (reopenIfFinal && full.status === 'final') {
        const ok = window.confirm(
          `Report #${full.lab_no} is finalized.\n\nReopen as draft to edit results and dates?`
        )
        if (!ok) return
        await api.patch(`/lab/reports/${id}/`, { status: 'draft', validation_status: 'Pending' })
        full = await fetchLabReport(id)
        await refresh()
        toast.success('Report reopened as draft')
      }

      if (full.patient_details) {
        setPatient(full.patient_details)
        setPtQuery('')
        setPtHits([])
        setShowAddPatient(false)
      }
      setReport(full)
      setResults(full.results || [])
      setSelectedTests([])
      setMeta({
        barcode_no: full.barcode_no || '',
        sample_received_at: toLocalDateInput(full.received_at || full.collected_at || new Date()),
        report_date: toLocalDateInput(full.reported_at || new Date()),
      })
      setShowPreview(true)
    } catch {
      toast.error('Could not open report')
    }
  }

  async function openReport(r) {
    await openReportForEdit(r)
  }

  useEffect(() => {
    if (!pendingEditReportId) return
    let cancelled = false
    ;(async () => {
      await openReportForEdit(pendingEditReportId, { reopenIfFinal: true })
      if (!cancelled) onPendingEditConsumed?.()
    })()
    return () => { cancelled = true }
  }, [pendingEditReportId]) // eslint-disable-line react-hooks/exhaustive-deps -- open once per pending id

  function toggleTest(t) {
    setSelectedTests((prev) =>
      prev.some((x) => x.id === t.id) ? prev.filter((x) => x.id !== t.id) : [...prev, t]
    )
  }

  const filteredCatalog = useMemo(() => {
    const q = testSearch.toLowerCase().trim()
    if (!q) return tests.filter((t) => t.is_active !== false)
    return tests.filter(
      (t) =>
        t.is_active !== false &&
        (t.name.toLowerCase().includes(q) || t.code?.toLowerCase().includes(q) || t.category_name?.toLowerCase().includes(q))
    )
  }, [tests, testSearch])

  const totalPrice = selectedTests.reduce((s, t) => s + (Number(t.price) || 0), 0)

  async function registerCollection() {
    if (!patient) return toast.error('Select a patient')
    if (!selectedTests.length) return toast.error('Add at least one test')
    setSaving(true)
    try {
      const sampleIso = dateInputToIso(meta.sample_received_at)
      const reportIso = dateInputToIso(meta.report_date)
      const { data } = await api.post('/lab/reports/', {
        patient: patient.id,
        collected_at: sampleIso,
        received_at: sampleIso,
        reported_at: reportIso,
        barcode_no: meta.barcode_no || '',
        // Leave blank so backend allocates Visit ID like UHID
        visit_id: '',
        test_ids: selectedTests.map((t) => t.id),
      })
      const created = data?.data || data
      toast.success('Registered — enter results')
      await refresh()
      await openReport(created)
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Registration failed')
    } finally {
      setSaving(false)
    }
  }

  async function patchResult(id, value) {
    try {
      const { data } = await api.patch(`/lab/results/${id}/`, { result_value: value })
      const updated = data?.data || data
      setResults((prev) => prev.map((r) => (r.id === id ? { ...r, ...updated } : r)))
    } catch {
      toast.error('Save failed')
    }
  }

  async function finalizeAndPrint() {
    if (!report) return
    setSaving(true)
    try {
      if (report.status !== 'final') {
        await api.patch(`/lab/reports/${report.id}/`, {
          status: 'final',
          collected_at: dateInputToIso(meta.sample_received_at),
          received_at: dateInputToIso(meta.sample_received_at),
          reported_at: dateInputToIso(meta.report_date),
          validation_status: 'Certified',
          barcode_no: meta.barcode_no,
        })
      }
      const { data } = await api.get(`/lab/reports/${report.id}/`)
      const full = data?.data || data
      setReport(full)
      setResults(full.results || [])
      await refresh()
      setPrintReport(full)
    } catch {
      toast.error('Could not finalize')
    } finally {
      setSaving(false)
    }
  }

  // Live preview report object from local results
  const previewReport = useMemo(() => {
    if (!report) return null
    const sampleIso = meta.sample_received_at ? dateInputToIso(meta.sample_received_at) : report.received_at
    const reportIso = meta.report_date ? dateInputToIso(meta.report_date) : report.reported_at
    return {
      ...report,
      results,
      barcode_no: meta.barcode_no || report.barcode_no,
      collected_at: sampleIso || report.collected_at,
      received_at: sampleIso || report.received_at,
      reported_at: reportIso || report.reported_at,
      patient_details: report.patient_details || patient,
    }
  }, [report, results, meta, patient])

  return (
    <div className="h-full flex flex-col overflow-hidden bg-gradient-to-br from-slate-50 via-white to-blue-50/30">
      {/* Top patient bar */}
      <div className="shrink-0 bg-white border-b border-slate-200 px-4 py-2.5 flex items-center gap-3 flex-wrap">
        {patient ? (
          <div className="flex items-center gap-2 bg-blue-50 border border-blue-200 rounded-lg px-3 py-1.5">
            <div>
              <p className="text-xs font-bold text-slate-900 leading-tight">
                {patient.first_name} {patient.last_name}
              </p>
              <p className="text-[10px] text-blue-700 font-medium">
                {patient.uhid} · {patient.age || '--'}Y / {patient.gender} · {patient.phone || ''}
              </p>
            </div>
            <button type="button" onClick={clearPatient} className="text-[10px] font-semibold text-blue-600 hover:underline ml-2">
              Change
            </button>
          </div>
        ) : (
          <div className="relative flex-1 max-w-md">
            <input
              value={ptQuery}
              onChange={(e) => setPtQuery(e.target.value)}
              placeholder="Search patient by name / UHID / mobile…"
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-xs font-medium outline-none focus:border-blue-500 bg-white"
              autoFocus
            />
            {(ptHits.length > 0 || (ptQuery.trim().length >= 1)) && (
              <div className="absolute z-40 top-full left-0 right-0 mt-1 bg-white border border-slate-200 rounded-lg shadow-lg max-h-72 overflow-hidden flex flex-col">
                <div className="overflow-y-auto divide-y max-h-56">
                  {ptHits.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => pickPatient(p)}
                      className="w-full text-left px-3 py-2.5 hover:bg-blue-50"
                    >
                      <p className="text-xs font-bold text-slate-900">{p.first_name} {p.last_name}</p>
                      <p className="text-[10px] text-slate-500">{p.uhid} · {p.phone}</p>
                    </button>
                  ))}
                  {debouncedQ.length >= 2 && ptHits.length === 0 && (
                    <div className="px-3 py-2 text-[10px] text-slate-400">No matches found</div>
                  )}
                </div>
                <div className="border-t border-slate-100 p-1.5 bg-slate-50/80">
                  <button
                    type="button"
                    onClick={() => setShowAddPatient(true)}
                    className="w-full text-left text-[10px] font-semibold text-blue-600 hover:text-blue-700 px-2 py-1"
                  >
                    + Add new patient{ptQuery.trim() ? ` “${ptQuery.trim()}”` : ''}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {patient && !report && (
          <>
            <label className="border border-slate-200 rounded-lg px-2 py-1 bg-white min-w-[130px]">
              <span className="block text-[8px] font-bold text-slate-400 uppercase leading-none">Sample Received</span>
              <input
                type="date"
                value={meta.sample_received_at}
                onChange={(e) => setMeta((m) => ({ ...m, sample_received_at: e.target.value }))}
                className="mt-0.5 w-full text-[11px] outline-none bg-transparent"
              />
            </label>
            <label className="border border-slate-200 rounded-lg px-2 py-1 bg-white min-w-[130px]">
              <span className="block text-[8px] font-bold text-slate-400 uppercase leading-none">Report Date</span>
              <input
                type="date"
                value={meta.report_date}
                onChange={(e) => setMeta((m) => ({ ...m, report_date: e.target.value }))}
                className="mt-0.5 w-full text-[11px] outline-none bg-transparent"
              />
            </label>
            <input
              value={meta.barcode_no}
              onChange={(e) => setMeta((m) => ({ ...m, barcode_no: e.target.value }))}
              placeholder="Barcode (optional)"
              className="w-28 border border-slate-200 rounded-lg px-2 py-1.5 text-[11px] outline-none focus:border-blue-500"
            />
            <div className="border border-slate-200 rounded-lg px-2 py-1 bg-slate-50 min-w-[110px]">
              <p className="text-[8px] font-bold text-slate-400 uppercase leading-none">Visit ID</p>
              <p className="text-[11px] font-mono font-bold text-slate-800 mt-0.5">{nextVisitPreview}</p>
            </div>
          </>
        )}

        {report && report.status !== 'final' && (
          <>
            <label className="border border-slate-200 rounded-lg px-2 py-1 bg-white min-w-[130px]">
              <span className="block text-[8px] font-bold text-slate-400 uppercase leading-none">Sample Received</span>
              <input
                type="date"
                value={meta.sample_received_at}
                onChange={(e) => setMeta((m) => ({ ...m, sample_received_at: e.target.value }))}
                className="mt-0.5 w-full text-[11px] outline-none bg-transparent"
              />
            </label>
            <label className="border border-slate-200 rounded-lg px-2 py-1 bg-white min-w-[130px]">
              <span className="block text-[8px] font-bold text-slate-400 uppercase leading-none">Report Date</span>
              <input
                type="date"
                value={meta.report_date}
                onChange={(e) => setMeta((m) => ({ ...m, report_date: e.target.value }))}
                className="mt-0.5 w-full text-[11px] outline-none bg-transparent"
              />
            </label>
          </>
        )}

        {report && (
          <div className="flex items-center gap-2 ml-auto">
            <span className="font-mono text-[11px] font-bold text-blue-700">#{report.lab_no}</span>
            {report.visit_id && (
              <span className="text-[10px] font-semibold text-slate-600 border border-slate-200 rounded px-2 py-0.5">
                Visit {report.visit_id}
              </span>
            )}
            <span className={`px-2 py-0.5 rounded text-[9px] font-bold uppercase ${STATUS[report.status]}`}>{report.status}</span>
            <button
              type="button"
              onClick={() => setShowPreview((v) => !v)}
              className="text-[10px] font-semibold text-slate-600 border border-slate-200 rounded px-2 py-1 hover:bg-slate-50"
            >
              {showPreview ? 'Hide preview' : 'Show preview'}
            </button>
          </div>
        )}
      </div>

      {showAddPatient && (
        <LabAddPatientModal
          initialSearchName={ptQuery}
          onClose={() => setShowAddPatient(false)}
          onAdded={(p) => pickPatient(p)}
        />
      )}

      {!patient ? (
        <div className="flex-1 flex items-center justify-center text-slate-400 text-xs font-medium">
          Search and select a patient to start
        </div>
      ) : (
        <div className="flex-1 flex min-h-0 overflow-hidden">
          {/* Left column */}
          <div className="flex-1 flex flex-col min-w-0 min-h-0 border-r border-slate-200">
            {/* Existing reports for patient */}
            {!report && patientDrafts.length > 0 && (
              <div className="shrink-0 px-4 py-2 bg-white border-b border-slate-100 flex gap-2 overflow-x-auto">
                <span className="text-[10px] font-semibold text-slate-400 uppercase self-center shrink-0">Open:</span>
                {patientDrafts.slice(0, 8).map((r) => (
                  <button
                    key={r.id}
                    type="button"
                    onClick={() => openReport(r)}
                    className="shrink-0 text-[10px] font-semibold border border-slate-200 rounded-lg px-2.5 py-1 hover:border-blue-400 hover:bg-blue-50"
                  >
                    #{r.lab_no} <span className="text-slate-400">({r.status})</span>
                  </button>
                ))}
              </div>
            )}

            {!report ? (
              /* Test picker — register new */
              <div className="flex-1 flex flex-col min-h-0">
                <div className="px-4 py-2 border-b border-slate-100 bg-white flex items-center gap-2 shrink-0">
                  <input
                    value={testSearch}
                    onChange={(e) => setTestSearch(e.target.value)}
                    placeholder="Search tests to add…"
                    className="flex-1 border border-slate-200 rounded-lg px-3 py-1.5 text-xs outline-none focus:border-blue-500"
                  />
                  <span className="text-[10px] font-semibold text-slate-500">{selectedTests.length} selected · ₹{totalPrice.toLocaleString()}</span>
                  <button
                    type="button"
                    disabled={saving || !selectedTests.length}
                    onClick={registerCollection}
                    className="bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white text-[11px] font-bold uppercase tracking-wide px-4 py-1.5 rounded-lg"
                  >
                    {saving ? 'Saving…' : 'Register'}
                  </button>
                </div>
                <div className="flex-1 overflow-y-auto bg-white">
                  <table className="w-full text-left text-xs">
                    <thead className="sticky top-0 bg-slate-50 border-b border-slate-200 text-[9px] font-bold uppercase tracking-wider text-slate-400">
                      <tr>
                        <th className="px-4 py-2 w-8"></th>
                        <th className="px-2 py-2">Test</th>
                        <th className="px-2 py-2">Category</th>
                        <th className="px-2 py-2">Sample</th>
                        <th className="px-4 py-2 text-right">Price</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-50">
                      {filteredCatalog.map((t) => {
                        const on = selectedTests.some((x) => x.id === t.id)
                        return (
                          <tr
                            key={t.id}
                            onClick={() => toggleTest(t)}
                            className={`cursor-pointer ${on ? 'bg-blue-50' : 'hover:bg-slate-50'}`}
                          >
                            <td className="px-4 py-2">
                              <input type="checkbox" checked={on} readOnly className="accent-blue-600" />
                            </td>
                            <td className="px-2 py-2">
                              <p className={`font-semibold ${on ? 'text-blue-800' : 'text-slate-800'}`}>{t.name}</p>
                              {t.is_group_test && <span className="text-[9px] text-blue-600 font-bold">PANEL · {t.parameters?.length || 0} params</span>}
                            </td>
                            <td className="px-2 py-2 text-slate-500">{t.category_name}</td>
                            <td className="px-2 py-2 text-slate-500">{t.sample_type || '—'}</td>
                            <td className="px-4 py-2 text-right font-semibold tabular-nums">₹{Number(t.price).toLocaleString()}</td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : (
              /* Result entry */
              <div className="flex-1 flex flex-col min-h-0">
                <div className="px-4 py-2 border-b border-slate-100 bg-white flex items-center gap-2 shrink-0">
                  <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider flex-1">Enter results</p>
                  {report.status !== 'final' && (
                    <button
                      type="button"
                      onClick={() => { setReport(null); setResults([]); setSelectedTests([]) }}
                      className="text-[10px] font-semibold text-slate-500 hover:text-slate-800"
                    >
                      ← New collection
                    </button>
                  )}
                  <button
                    type="button"
                    disabled={saving}
                    onClick={finalizeAndPrint}
                    className="bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white text-[11px] font-bold uppercase tracking-wide px-4 py-1.5 rounded-lg"
                  >
                    {saving ? '…' : report.status === 'final' ? 'Print' : 'Finalize & Print'}
                  </button>
                </div>
                <div className="flex-1 overflow-y-auto p-3 space-y-3">
                  <ResultGroups results={results} onPatch={patchResult} locked={report.status === 'final'} />
                </div>
              </div>
            )}
          </div>

          {/* Right: live preview */}
          {showPreview && report && previewReport && (
            <div className="w-[420px] xl:w-[480px] shrink-0 bg-slate-100 border-l border-slate-200 overflow-y-auto p-3">
              <p className="text-[9px] font-bold text-slate-400 uppercase tracking-wider mb-2 px-1">Live preview</p>
              <div className="bg-white shadow-sm border border-slate-200 rounded-lg overflow-hidden scale-[0.92] origin-top">
                <ReportPreviewBody report={previewReport} settings={labSettings} compact />
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function ResultGroups({ results, onPatch, locked }) {
  const groups = {}
  results.forEach((r) => {
    const key = r.test
    if (!groups[key]) {
      groups[key] = {
        dept: r.department_label || r.category_name || 'Investigations',
        sample: r.sample_type,
        rows: [],
      }
    }
    groups[key].rows.push(r)
  })

  if (!results.length) {
    return <p className="text-xs text-slate-400 text-center py-10">No parameters on this report</p>
  }

  return Object.values(groups).map((g, i) => (
    <div key={i} className="bg-white border border-slate-200 rounded-xl overflow-hidden">
      <div className="px-3 py-2 bg-slate-50 border-b border-slate-100 flex items-center justify-between">
        <p className="text-[10px] font-bold text-slate-700 uppercase tracking-wide">{g.dept}</p>
        {g.sample && <p className="text-[9px] text-slate-400 font-semibold">{g.sample}</p>}
      </div>
      <div className="divide-y divide-slate-50">
        {g.rows.map((res) => (
          <ResultInputRow key={res.id} res={res} onPatch={onPatch} locked={locked} />
        ))}
      </div>
    </div>
  ))
}

function ResultInputRow({ res, onPatch, locked }) {
  const [val, setVal] = useState(res.result_value || '')
  const timer = useRef(null)

  useEffect(() => { setVal(res.result_value || '') }, [res.result_value])

  function change(v) {
    setVal(v)
    clearTimeout(timer.current)
    timer.current = setTimeout(() => onPatch(res.id, v), 600)
  }

  const flag = res.flag || ''
  const bad = flag === 'H' || flag === 'L'

  return (
    <div className={`grid grid-cols-12 gap-2 items-center px-3 py-2 ${bad ? 'bg-rose-50/60' : ''}`}>
      <div className="col-span-5 min-w-0">
        {res.section_title && (
          <p className="text-[8px] font-bold text-slate-400 uppercase tracking-wide truncate">{res.section_title}</p>
        )}
        <p className={`text-[11px] font-semibold truncate ${bad ? 'text-rose-800' : 'text-slate-800'}`}>
          {res.test_name || res.parameter_name}
        </p>
      </div>
      <div className="col-span-3">
        <input
          value={val}
          onChange={(e) => change(e.target.value)}
          disabled={locked}
          className={`w-full border rounded px-2 py-1 text-xs font-bold text-center outline-none ${
            bad ? 'border-rose-300 text-rose-700 bg-white' : 'border-slate-200 text-slate-900 bg-white'
          } focus:border-blue-500 disabled:bg-slate-50`}
        />
      </div>
      <div className="col-span-1 text-center text-[10px] font-black leading-none">
        {flag === 'H' && <span className="text-emerald-600" title="High">▲</span>}
        {flag === 'L' && <span className="text-rose-600" title="Low">▼</span>}
      </div>
      <div className="col-span-3 text-right min-w-0">
        <p className="text-[9px] text-slate-500 font-medium truncate">{res.test_ref || '—'}</p>
        <p className="text-[8px] text-slate-400 truncate">{res.test_unit || ''}</p>
      </div>
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════════
   REPORTS LIST
═══════════════════════════════════════════════════════════════ */
function ReportsView({ reports, setPrintReport, refresh, onEditReport }) {
  const [q, setQ] = useState('')
  const [status, setStatus] = useState('all')
  const [deletingId, setDeletingId] = useState(null)
  const [printingId, setPrintingId] = useState(null)

  async function printReport(r) {
    if (!r?.id) return
    setPrintingId(r.id)
    try {
      const full = await fetchLabReport(r.id)
      setPrintReport(full)
    } catch {
      toast.error('Could not load report for printing')
    } finally {
      setPrintingId(null)
    }
  }

  async function deleteReport(r) {
    if (!r?.id) return
    const isFinal = r.status === 'final'
    const label = `#${r.lab_no} · ${r.patient_details?.first_name || ''} ${r.patient_details?.last_name || ''}`.trim()
    const ok = window.confirm(
      isFinal
        ? `Delete final report ${label}?\n\nThis permanently removes the report and all entered results. This cannot be undone.`
        : `Delete report ${label}?\n\nThis cannot be undone.`
    )
    if (!ok) return
    setDeletingId(r.id)
    try {
      await api.delete(`/lab/reports/${r.id}/`)
      toast.success('Report deleted')
      refresh()
    } catch (err) {
      toast.error(getApiErrorMessage(err) || 'Could not delete report')
    } finally {
      setDeletingId(null)
    }
  }

  const list = reports.filter((r) => {
    if (status !== 'all' && r.status !== status) return false
    const s = q.toLowerCase()
    if (!s) return true
    return (
      r.lab_no?.toLowerCase().includes(s) ||
      r.patient_details?.first_name?.toLowerCase().includes(s) ||
      r.patient_details?.uhid?.toLowerCase().includes(s)
    )
  })

  return (
    <div className="h-full flex flex-col p-4 gap-3 overflow-hidden">
      <div className="flex items-center gap-2 shrink-0">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search reports…"
          className="flex-1 max-w-sm border border-slate-200 rounded-lg px-3 py-2 text-xs outline-none focus:border-blue-500 bg-white"
        />
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          className="border border-slate-200 rounded-lg px-2 py-2 text-xs bg-white outline-none focus:border-blue-500"
        >
          <option value="final">Final</option>
          <option value="draft">Draft</option>
          <option value="all">All</option>
        </select>
      </div>
      <div className="flex-1 bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="overflow-y-auto h-full">
          <table className="w-full text-xs text-left">
            <thead className="sticky top-0 bg-slate-50 border-b border-slate-200 text-[9px] font-bold uppercase text-slate-400 tracking-wider">
              <tr>
                <th className="px-4 py-2.5">Lab No</th>
                <th className="px-4 py-2.5">Patient</th>
                <th className="px-4 py-2.5">Status</th>
                <th className="px-4 py-2.5">Reported</th>
                <th className="px-4 py-2.5 text-right w-44">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {list.map((r) => (
                <tr key={r.id} className="hover:bg-slate-50">
                  <td className="px-4 py-2.5 font-mono font-bold text-blue-700">#{r.lab_no}</td>
                  <td className="px-4 py-2.5">
                    <p className="font-semibold text-slate-800">{r.patient_details?.first_name} {r.patient_details?.last_name}</p>
                    <p className="text-[10px] text-slate-400">{r.patient_details?.uhid}</p>
                  </td>
                  <td className="px-4 py-2.5">
                    <span className={`px-2 py-0.5 rounded text-[9px] font-bold uppercase ${STATUS[r.status]}`}>{r.status}</span>
                  </td>
                  <td className="px-4 py-2.5 text-slate-500">{fmt(r.reported_at) || '—'}</td>
                  <td className="px-4 py-2.5 text-right">
                    <div className="flex items-center justify-end gap-1.5">
                      <button
                        type="button"
                        onClick={() => onEditReport?.(r)}
                        className="text-[10px] font-bold text-slate-700 border border-slate-200 rounded px-2 py-1 hover:bg-slate-50"
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => printReport(r)}
                        disabled={printingId === r.id}
                        className="text-[10px] font-bold text-blue-700 border border-blue-200 rounded px-2 py-1 hover:bg-blue-50 disabled:opacity-40"
                      >
                        {printingId === r.id ? 'Loading…' : 'Print'}
                      </button>
                      <button
                        type="button"
                        onClick={() => deleteReport(r)}
                        disabled={deletingId === r.id}
                        className="text-[10px] font-bold text-rose-700 border border-rose-200 rounded px-2 py-1 hover:bg-rose-50 disabled:opacity-40"
                      >
                        {deletingId === r.id ? 'Deleting…' : 'Delete'}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {!list.length && (
                <tr><td colSpan={5} className="px-4 py-12 text-center text-slate-300 text-xs">No reports</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════════
   SETTINGS — Branding
═══════════════════════════════════════════════════════════════ */
function brandingFormFromSettings(settings) {
  return {
    lab_name: settings?.lab_name || '',
    tagline: settings?.tagline || '',
    address: settings?.address || '',
    phone: settings?.phone || '',
    email: settings?.email || '',
    website: settings?.website || '',
    gstin: settings?.gstin || '',
    nabl_reg_no: settings?.nabl_reg_no || '',
    processed_at_label: settings?.processed_at_label || '',
    pathologist_name: settings?.pathologist_name || '',
    pathologist_qualification: settings?.pathologist_qualification || '',
    pathologist_reg_no: settings?.pathologist_reg_no || '',
    footer_note: settings?.footer_note || '',
    visit_id_prefix: settings?.visit_id_prefix || 'LABV',
    visit_id_next_number: settings?.visit_id_next_number ?? 1,
    visit_id_padding: settings?.visit_id_padding ?? 4,
    watermark_enabled: !!settings?.watermark_enabled,
    watermark_opacity: settings?.watermark_opacity ?? 15,
    watermark_size: settings?.watermark_size ?? 55,
    watermark_rotation: settings?.watermark_rotation ?? 0,
    watermark_source: settings?.watermark_source === 'custom' ? 'custom' : 'logo',
  }
}

function BrandingField({ label, name, value, onChange, ...rest }) {
  return (
    <label className="block">
      <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wide">{label}</span>
      <input
        name={name}
        value={value}
        onChange={onChange}
        className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 text-xs outline-none focus:border-blue-500 bg-white"
        {...rest}
      />
    </label>
  )
}

function LabBrandingSettings({ settings, onSaved }) {
  const [form, setForm] = useState(() => brandingFormFromSettings(settings))
  const [logoFile, setLogoFile] = useState(null)
  const [sigFile, setSigFile] = useState(null)
  const [wmFile, setWmFile] = useState(null)
  const [saving, setSaving] = useState(false)
  const settingsId = settings?.id

  useEffect(() => {
    if (!settingsId) return
    setForm(brandingFormFromSettings(settings))
    // Only re-hydrate when the saved settings row identity changes (after load / save),
    // not on every parent re-render of the settings object.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settingsId])

  function onFieldChange(e) {
    const { name, value, type, checked } = e.target
    setForm((f) => ({ ...f, [name]: type === 'checkbox' ? checked : value }))
  }

  async function save() {
    setSaving(true)
    try {
      const fd = new FormData()
      Object.entries(form).forEach(([k, v]) => {
        if (k === 'watermark_enabled') {
          fd.append(k, v ? 'true' : 'false')
          return
        }
        fd.append(k, v ?? '')
      })
      if (logoFile) fd.append('logo', logoFile)
      if (sigFile) fd.append('signature', sigFile)
      if (wmFile) fd.append('watermark', wmFile)
      await api.patch('/lab/settings/', fd, { headers: { 'Content-Type': 'multipart/form-data' } })
      toast.success('Lab settings saved')
      setLogoFile(null)
      setSigFile(null)
      setWmFile(null)
      onSaved()
    } catch {
      toast.error('Save failed')
    } finally {
      setSaving(false)
    }
  }

  const wmPreview = wmFile
    ? URL.createObjectURL(wmFile)
    : (form.watermark_source === 'logo' ? settings?.logo_url : settings?.watermark_url)

  return (
    <div className="h-full overflow-y-auto p-4">
      <div className="max-w-3xl bg-white border border-slate-200 rounded-xl p-5 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-sm font-bold text-slate-900">Lab Branding</h2>
            <p className="text-[11px] text-slate-500 mt-0.5">Shown on printed reports (name, logo, pathologist)</p>
          </div>
          <button
            type="button"
            onClick={save}
            disabled={saving}
            className="bg-blue-600 hover:bg-blue-700 text-white text-[11px] font-bold uppercase px-4 py-2 rounded-lg disabled:opacity-40"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <BrandingField label="Lab name" name="lab_name" value={form.lab_name} onChange={onFieldChange} />
          <BrandingField label="Tagline" name="tagline" value={form.tagline} onChange={onFieldChange} placeholder="ISO accredited…" />
          <label className="block col-span-2">
            <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wide">Address</span>
            <textarea
              name="address"
              value={form.address}
              onChange={onFieldChange}
              rows={2}
              className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 text-xs outline-none focus:border-blue-500"
            />
          </label>
          <BrandingField label="Phone" name="phone" value={form.phone} onChange={onFieldChange} />
          <BrandingField label="Email" name="email" value={form.email} onChange={onFieldChange} />
          <BrandingField label="Website" name="website" value={form.website} onChange={onFieldChange} />
          <BrandingField label="GSTIN" name="gstin" value={form.gstin} onChange={onFieldChange} />
          <BrandingField label="NABL / Reg No" name="nabl_reg_no" value={form.nabl_reg_no} onChange={onFieldChange} />
          <BrandingField label="Processed at label" name="processed_at_label" value={form.processed_at_label} onChange={onFieldChange} placeholder="Test Processed At : …" />
          <BrandingField label="Pathologist name" name="pathologist_name" value={form.pathologist_name} onChange={onFieldChange} />
          <BrandingField label="Qualification" name="pathologist_qualification" value={form.pathologist_qualification} onChange={onFieldChange} placeholder="MD (PATH)" />
          <BrandingField label="Reg No" name="pathologist_reg_no" value={form.pathologist_reg_no} onChange={onFieldChange} />
          <BrandingField label="Footer note" name="footer_note" value={form.footer_note} onChange={onFieldChange} />
        </div>

        <div className="border border-slate-100 rounded-xl p-4 space-y-3 bg-slate-50/50">
          <div>
            <h3 className="text-xs font-bold text-slate-800">Visit ID numbering</h3>
            <p className="text-[10px] text-slate-500 mt-0.5">Auto-assigned on register, same style as UHID (PREFIX-0001)</p>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <BrandingField label="Prefix" name="visit_id_prefix" value={form.visit_id_prefix} onChange={onFieldChange} />
            <BrandingField label="Next number" name="visit_id_next_number" type="number" min="1" value={form.visit_id_next_number} onChange={onFieldChange} />
            <BrandingField label="Zero padding" name="visit_id_padding" type="number" min="1" max="10" value={form.visit_id_padding} onChange={onFieldChange} />
          </div>
          <p className="text-[11px] font-mono font-semibold text-blue-700">
            Next: {`${(form.visit_id_prefix || 'LABV').trim() || 'LABV'}-${String(Math.max(1, Number(form.visit_id_next_number) || 1)).padStart(Math.max(1, Math.min(10, Number(form.visit_id_padding) || 4)), '0')}`}
          </p>
        </div>

        <div className="border border-slate-100 rounded-xl p-4 space-y-3 bg-slate-50/50">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 className="text-xs font-bold text-slate-800">Report watermark</h3>
              <p className="text-[10px] text-slate-500 mt-0.5">Shown faintly behind results on print / preview</p>
            </div>
            <label className="flex items-center gap-2 text-xs font-semibold text-slate-700 shrink-0 cursor-pointer">
              <input
                type="checkbox"
                name="watermark_enabled"
                checked={!!form.watermark_enabled}
                onChange={onFieldChange}
                className="rounded border-slate-300"
              />
              Show on report
            </label>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wide">Watermark image</span>
              <select
                name="watermark_source"
                value={form.watermark_source}
                onChange={onFieldChange}
                className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 text-xs outline-none focus:border-blue-500 bg-white"
              >
                <option value="logo">Use lab logo</option>
                <option value="custom">Upload custom image</option>
              </select>
            </label>
            <label className="block">
              <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wide">Opacity ({form.watermark_opacity}%)</span>
              <input
                type="range"
                name="watermark_opacity"
                min="5"
                max="40"
                value={form.watermark_opacity}
                onChange={onFieldChange}
                className="mt-3 w-full"
              />
            </label>
            <label className="block">
              <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wide">Size ({form.watermark_size}%)</span>
              <input
                type="range"
                name="watermark_size"
                min="20"
                max="90"
                value={form.watermark_size}
                onChange={onFieldChange}
                className="mt-3 w-full"
              />
            </label>
            <label className="block">
              <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wide">Rotation ({form.watermark_rotation}°)</span>
              <input
                type="range"
                name="watermark_rotation"
                min="-90"
                max="90"
                value={form.watermark_rotation}
                onChange={onFieldChange}
                className="mt-3 w-full"
              />
              <button
                type="button"
                onClick={() => setForm((f) => ({ ...f, watermark_rotation: 0 }))}
                className="mt-1 text-[10px] font-semibold text-blue-600 hover:underline"
              >
                Reset to straight (0°)
              </button>
            </label>
          </div>

          {form.watermark_source === 'custom' && (
            <label className="block">
              <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wide">Custom watermark file</span>
              <input type="file" accept="image/*" onChange={(e) => setWmFile(e.target.files?.[0] || null)} className="mt-2 text-xs" />
            </label>
          )}

          {wmPreview && (
            <div className="relative h-36 rounded-lg border border-slate-200 bg-white overflow-hidden flex items-center justify-center">
              <img
                src={wmPreview}
                alt=""
                className="object-contain"
                style={{
                  maxWidth: `${Math.max(20, Math.min(90, Number(form.watermark_size) || 55))}%`,
                  maxHeight: `${Math.max(20, Math.min(90, Number(form.watermark_size) || 55))}%`,
                  opacity: Math.max(0.05, Math.min(0.4, Number(form.watermark_opacity) / 100)),
                  transform: `rotate(${Number(form.watermark_rotation) || 0}deg)`,
                }}
              />
              <span className="absolute bottom-1 right-2 text-[9px] text-slate-400 font-semibold">Preview</span>
            </div>
          )}
          {form.watermark_enabled && !wmPreview && (
            <p className="text-[11px] text-amber-700">Upload a logo or custom watermark image to show it on reports.</p>
          )}
        </div>

        <div className="grid grid-cols-2 gap-4 pt-2 border-t border-slate-100">
          <label className="block">
            <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wide">Logo</span>
            {usableLabMediaUrl(settings?.logo_url) && !logoFile && (
              <img src={usableLabMediaUrl(settings.logo_url)} alt="" className="mt-2 h-14 object-contain border border-slate-100 rounded bg-slate-50 p-1" onError={(e) => { e.currentTarget.style.display = 'none' }} />
            )}
            <input type="file" accept="image/*" onChange={(e) => setLogoFile(e.target.files?.[0] || null)} className="mt-2 text-xs" />
          </label>
          <label className="block">
            <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wide">Signature</span>
            {settings?.signature_url && !sigFile && (
              <img src={settings.signature_url} alt="" className="mt-2 h-14 object-contain border border-slate-100 rounded bg-slate-50 p-1" />
            )}
            <input type="file" accept="image/*" onChange={(e) => setSigFile(e.target.files?.[0] || null)} className="mt-2 text-xs" />
          </label>
        </div>
      </div>
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════════
   SETTINGS — Templates
═══════════════════════════════════════════════════════════════ */
function TemplatesSettings({ tests, categories, refresh }) {
  const [search, setSearch] = useState('')
  const [editing, setEditing] = useState(null)
  const [exporting, setExporting] = useState(false)
  const [importing, setImporting] = useState(false)
  const [exportMode, setExportMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState(() => new Set())
  const importRef = useRef(null)
  const filtered = tests.filter((t) => {
    const q = search.toLowerCase()
    return !q || t.name.toLowerCase().includes(q) || t.code?.toLowerCase().includes(q)
  })
  const filteredIds = filtered.map((t) => t.id)
  const allFilteredSelected = filteredIds.length > 0 && filteredIds.every((id) => selectedIds.has(id))
  const someFilteredSelected = filteredIds.some((id) => selectedIds.has(id))

  function cancelExportMode() {
    setExportMode(false)
    setSelectedIds(new Set())
  }

  function toggleOne(id) {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function toggleAllFiltered() {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (allFilteredSelected) {
        filteredIds.forEach((id) => next.delete(id))
      } else {
        filteredIds.forEach((id) => next.add(id))
      }
      return next
    })
  }

  async function runExport(ids) {
    setExporting(true)
    try {
      const res = await api.get('/lab/tests/export-pack/', {
        params: { ids: ids.join(',') },
        responseType: 'blob',
      })
      const blob = new Blob([res.data], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      const cd = res.headers['content-disposition'] || ''
      const match = cd.match(/filename="?([^"]+)"?/)
      a.href = url
      a.download = match?.[1] || `lab_templates_${ids.length}.json`
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
      toast.success(`Exported ${ids.length} template(s) as JSON`)
      cancelExportMode()
    } catch {
      toast.error('Export failed')
    } finally {
      setExporting(false)
    }
  }

  function onExportClick() {
    if (!exportMode) {
      setExportMode(true)
      setSelectedIds(new Set())
      return
    }
    const ids = [...selectedIds]
    if (!ids.length) {
      toast.error('Tick at least one template, then click Export again')
      return
    }
    runExport(ids)
  }

  async function deactivateTemplate(t) {
    await api.patch(`/lab/tests/${t.id}/`, { is_active: false })
    toast.success('Template deactivated — hidden from new registrations')
    refresh()
  }

  async function deleteTemplate(t) {
    if (!t?.id) return
    const usage = Number(t.report_usage_count || 0)
    if (usage > 0) {
      const ok = window.confirm(
        `"${t.name}" is used on ${usage} lab report${usage === 1 ? '' : 's'} and cannot be deleted.\n\nDeactivate it instead? Old reports stay unchanged; it will no longer appear for new tests.`
      )
      if (!ok) return
      try {
        await deactivateTemplate(t)
      } catch (err) {
        toast.error(getApiErrorMessage(err) || 'Could not deactivate template')
      }
      return
    }
    const ok = window.confirm(`Delete template "${t.name}"? This cannot be undone.`)
    if (!ok) return
    try {
      await api.delete(`/lab/tests/${t.id}/`)
      toast.success('Template deleted')
      setSelectedIds((prev) => {
        const next = new Set(prev)
        next.delete(t.id)
        return next
      })
      refresh()
    } catch (err) {
      const msg = getApiErrorMessage(err)
      if (err?.response?.status === 409) {
        const deactivate = window.confirm(
          `${msg}\n\nDeactivate this template instead?`
        )
        if (deactivate) {
          try {
            await deactivateTemplate(t)
          } catch (deactivateErr) {
            toast.error(getApiErrorMessage(deactivateErr) || 'Could not deactivate template')
          }
          return
        }
      }
      toast.error(msg || 'Delete failed')
    }
  }

  async function onImportFile(e) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setImporting(true)
    try {
      const fd = new FormData()
      fd.append('pack_file', file)
      fd.append('overwrite', 'true')
      fd.append('replace_parameters', 'true')
      const { data } = await api.post('/lab/tests/import-pack/', fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
      const stats = data?.data || data
      toast.success(
        `Imported: ${stats.created || 0} created, ${stats.updated || 0} updated`
      )
      refresh()
    } catch (err) {
      toast.error(err?.response?.data?.detail || 'Import failed')
    } finally {
      setImporting(false)
    }
  }

  return (
    <div className="h-full flex flex-col p-4 gap-3 overflow-hidden">
      <div className="flex items-center gap-2 shrink-0 flex-wrap">
        <div className="flex-1 min-w-[180px]">
          <h2 className="text-sm font-bold text-slate-900">Test Templates</h2>
          <p className="text-[11px] text-slate-500">Parameters, ranges, methods & interpretation</p>
        </div>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Filter…"
          className="border border-slate-200 rounded-lg px-3 py-1.5 text-xs outline-none focus:border-blue-500 bg-white w-48"
        />
        <button
          type="button"
          onClick={onExportClick}
          disabled={exporting}
          className={`text-[11px] font-bold uppercase px-3 py-1.5 rounded-lg disabled:opacity-40 ${
            exportMode
              ? 'bg-blue-600 hover:bg-blue-700 text-white'
              : 'bg-white border border-slate-200 hover:bg-slate-50 text-slate-700'
          }`}
        >
          {exporting
            ? 'Exporting…'
            : exportMode
              ? `Export${selectedIds.size ? ` (${selectedIds.size})` : ''}`
              : 'Export'}
        </button>
        {exportMode && (
          <button
            type="button"
            onClick={cancelExportMode}
            className="text-[11px] font-bold text-slate-500 hover:text-slate-800 px-2 py-1.5"
          >
            Cancel
          </button>
        )}
        <button
          type="button"
          onClick={() => importRef.current?.click()}
          disabled={importing}
          className="bg-white border border-emerald-200 hover:bg-emerald-50 text-emerald-800 text-[11px] font-bold uppercase px-3 py-1.5 rounded-lg disabled:opacity-40"
        >
          {importing ? 'Importing…' : 'Import JSON'}
        </button>
        <input ref={importRef} type="file" accept=".json,application/json" className="hidden" onChange={onImportFile} />
        <button
          type="button"
          onClick={() => setEditing({})}
          className="bg-blue-600 hover:bg-blue-700 text-white text-[11px] font-bold uppercase px-3 py-1.5 rounded-lg"
        >
          + New
        </button>
      </div>
      <p className="text-[10px] text-slate-500 shrink-0 -mt-1">
        {exportMode
          ? 'Tick the templates you want, then click Export again to download JSON.'
          : 'Click Export to choose templates to share with another hospital.'}
      </p>
      <div className="flex-1 bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="overflow-y-auto h-full">
          <table className="w-full text-xs text-left">
            <thead className="sticky top-0 bg-slate-50 border-b border-slate-200 text-[9px] font-bold uppercase text-slate-400">
              <tr>
                {exportMode && (
                  <th className="px-3 py-2.5 w-10">
                    <input
                      type="checkbox"
                      checked={allFilteredSelected}
                      ref={(el) => {
                        if (el) el.indeterminate = someFilteredSelected && !allFilteredSelected
                      }}
                      onChange={toggleAllFiltered}
                      title="Select all shown"
                      className="rounded border-slate-300"
                    />
                  </th>
                )}
                <th className="px-4 py-2.5">Name</th>
                <th className="px-4 py-2.5">Category</th>
                <th className="px-4 py-2.5">Sample</th>
                <th className="px-4 py-2.5 text-center">Params</th>
                <th className="px-4 py-2.5 text-right">Price</th>
                <th className="px-4 py-2.5 text-right w-28">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {filtered.map((t) => (
                <tr key={t.id} className={`hover:bg-slate-50 ${exportMode && selectedIds.has(t.id) ? 'bg-blue-50/50' : ''}`}>
                  {exportMode && (
                    <td className="px-3 py-2.5">
                      <input
                        type="checkbox"
                        checked={selectedIds.has(t.id)}
                        onChange={() => toggleOne(t.id)}
                        className="rounded border-slate-300"
                      />
                    </td>
                  )}
                  <td className="px-4 py-2.5">
                    <p className="font-semibold text-slate-800">{t.name}</p>
                    <div className="flex flex-wrap gap-1.5 mt-0.5">
                      {t.is_group_test && <span className="text-[9px] text-blue-600 font-bold">PANEL</span>}
                      {t.is_active === false && (
                        <span className="text-[9px] text-slate-500 font-bold uppercase">Inactive</span>
                      )}
                      {Number(t.report_usage_count || 0) > 0 && (
                        <span className="text-[9px] text-amber-700 font-bold">
                          On {t.report_usage_count} report{t.report_usage_count === 1 ? '' : 's'}
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-2.5 text-slate-500">{t.category_name}</td>
                  <td className="px-4 py-2.5 text-slate-500">{t.sample_type || '—'}</td>
                  <td className="px-4 py-2.5 text-center font-semibold text-blue-700">{t.parameters?.length || 0}</td>
                  <td className="px-4 py-2.5 text-right font-semibold">₹{Number(t.price).toLocaleString()}</td>
                  <td className="px-4 py-2.5 text-right">
                    <div className="flex items-center justify-end gap-1.5">
                      <button
                        type="button"
                        onClick={() => setEditing(t)}
                        className="text-[10px] font-bold text-blue-700 border border-blue-200 rounded px-2 py-1 hover:bg-blue-50"
                      >
                        Edit
                      </button>
                      {!exportMode && (
                        <button
                          type="button"
                          onClick={() => deleteTemplate(t)}
                          className="text-[10px] font-bold text-rose-700 border border-rose-200 rounded px-2 py-1 hover:bg-rose-50"
                        >
                          Delete
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      {editing !== null && (
        <TemplateEditor
          test={editing}
          categories={categories}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); refresh() }}
        />
      )}
    </div>
  )
}

function TemplateEditor({ test, categories, onClose, onSaved }) {
  const isNew = !test.id
  const [form, setForm] = useState({
    name: test.name || '',
    code: test.code || '',
    category: test.category || categories[0]?.id || '',
    price: test.price ?? '0',
    is_group_test: !!test.is_group_test,
    sample_type: test.sample_type || '',
    method: test.method || '',
    procedure: test.procedure || '',
    interpretation: test.interpretation || '',
    department_label: test.department_label || '',
    is_active: test.is_active !== false,
  })
  const [params, setParams] = useState(
    (test.parameters || []).map((p) => ({ ...p, _key: p.id || Math.random() }))
  )
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)

  function addParam() {
    setParams((prev) => [...prev, {
      _key: Math.random(), name: '', code: '', unit: '', reference_range: '',
      ref_low: '', ref_high: '', method: '', section_title: '',
      sort_order: prev.length, result_type: 'numeric',
    }])
  }

  async function save() {
    if (!form.name.trim()) return toast.error('Name required')
    if (!form.category) return toast.error('Category required')
    setSaving(true)
    try {
      const payload = {
        ...form,
        parameters: params.map(({ _key, id, ...rest }) => (id ? { id, ...rest } : rest)),
      }
      if (isNew) await api.post('/lab/tests/', payload)
      else await api.put(`/lab/tests/${test.id}/`, payload)
      toast.success(isNew ? 'Created' : 'Updated')
      onSaved()
    } catch {
      toast.error('Save failed')
    } finally {
      setSaving(false)
    }
  }

  async function deactivateCurrent() {
    await api.patch(`/lab/tests/${test.id}/`, { is_active: false })
    toast.success('Template deactivated — hidden from new registrations')
    onSaved()
  }

  async function remove() {
    if (isNew || !test.id) return
    const usage = Number(test.report_usage_count || 0)
    if (usage > 0) {
      const ok = window.confirm(
        `"${form.name || test.name}" is used on ${usage} lab report${usage === 1 ? '' : 's'} and cannot be deleted.\n\nDeactivate it instead? Old reports stay unchanged; it will no longer appear for new tests.`
      )
      if (!ok) return
      setDeleting(true)
      try {
        await deactivateCurrent()
      } catch (err) {
        toast.error(getApiErrorMessage(err) || 'Could not deactivate template')
      } finally {
        setDeleting(false)
      }
      return
    }
    const ok = window.confirm(`Delete template "${form.name || test.name}"? This cannot be undone.`)
    if (!ok) return
    setDeleting(true)
    try {
      await api.delete(`/lab/tests/${test.id}/`)
      toast.success('Template deleted')
      onSaved()
    } catch (err) {
      const msg = getApiErrorMessage(err)
      if (err?.response?.status === 409) {
        const deactivate = window.confirm(`${msg}\n\nDeactivate this template instead?`)
        if (deactivate) {
          try {
            await deactivateCurrent()
          } catch (deactivateErr) {
            toast.error(getApiErrorMessage(deactivateErr) || 'Could not deactivate template')
          }
          return
        }
      }
      toast.error(msg || 'Delete failed')
    } finally {
      setDeleting(false)
    }
  }

  return (
    <Modal title={isNew ? 'New test template' : `Edit: ${test.name}`} onClose={onClose} size="max-w-5xl">
      <div className="grid grid-cols-2 gap-5">
        <div className="space-y-2.5">
          <p className="text-[10px] font-bold text-slate-400 uppercase">Test info</p>
          {[
            ['name', 'Name *'],
            ['code', 'Code'],
            ['sample_type', 'Sample type'],
            ['method', 'Default method'],
            ['department_label', 'Department label'],
          ].map(([k, label]) => (
            <label key={k} className="block">
              <span className="text-[10px] font-semibold text-slate-500">{label}</span>
              <input
                value={form[k]}
                onChange={(e) => setForm((f) => ({ ...f, [k]: e.target.value }))}
                className="mt-0.5 w-full border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs outline-none focus:border-blue-500"
              />
            </label>
          ))}
          <div className="grid grid-cols-2 gap-2">
            <label className="block">
              <span className="text-[10px] font-semibold text-slate-500">Category *</span>
              <select
                value={form.category}
                onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}
                className="mt-0.5 w-full border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs bg-white outline-none focus:border-blue-500"
              >
                {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="text-[10px] font-semibold text-slate-500">Price ₹</span>
              <input type="number" value={form.price} onChange={(e) => setForm((f) => ({ ...f, price: e.target.value }))}
                className="mt-0.5 w-full border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs outline-none focus:border-blue-500" />
            </label>
          </div>
          <label className="block">
            <span className="text-[10px] font-semibold text-slate-500">Procedure / notes</span>
            <textarea
              value={form.procedure}
              onChange={(e) => setForm((f) => ({ ...f, procedure: e.target.value }))}
              rows={2}
              className="mt-0.5 w-full border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs outline-none focus:border-blue-500"
            />
          </label>
          <label className="block">
            <span className="text-[10px] font-semibold text-slate-500">Interpretation / comments</span>
            <textarea
              value={form.interpretation}
              onChange={(e) => setForm((f) => ({ ...f, interpretation: e.target.value }))}
              rows={3}
              className="mt-0.5 w-full border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs outline-none focus:border-blue-500"
            />
          </label>
          <div className="flex gap-4">
            <label className="flex items-center gap-1.5 text-xs font-medium">
              <input type="checkbox" checked={form.is_group_test} onChange={(e) => setForm((f) => ({ ...f, is_group_test: e.target.checked }))} className="accent-blue-600" />
              Panel
            </label>
            <label className="flex items-center gap-1.5 text-xs font-medium">
              <input type="checkbox" checked={form.is_active} onChange={(e) => setForm((f) => ({ ...f, is_active: e.target.checked }))} className="accent-blue-600" />
              Active
            </label>
          </div>
        </div>

        <div className="flex flex-col min-h-0">
          <div className="flex items-center justify-between mb-2">
            <p className="text-[10px] font-bold text-slate-400 uppercase">Parameters</p>
            <button type="button" onClick={addParam} className="text-[10px] font-bold text-blue-600">+ Add</button>
          </div>
          <div className="flex-1 overflow-y-auto space-y-2 max-h-[55vh]">
            {params.map((p) => (
              <div key={p._key} className="border border-slate-100 rounded-lg p-2 bg-slate-50/50 space-y-1.5">
                <div className="flex gap-1.5">
                  <input value={p.section_title} onChange={(e) => setParams((prev) => prev.map((x) => x._key === p._key ? { ...x, section_title: e.target.value } : x))}
                    placeholder="Section" className="flex-1 border border-slate-200 rounded px-2 py-1 text-[11px] outline-none bg-white" />
                  <input type="number" value={p.sort_order} onChange={(e) => setParams((prev) => prev.map((x) => x._key === p._key ? { ...x, sort_order: e.target.value } : x))}
                    className="w-12 border border-slate-200 rounded px-1 py-1 text-[11px] text-center outline-none bg-white" />
                  <button type="button" onClick={() => setParams((prev) => prev.filter((x) => x._key !== p._key))} className="text-rose-400 px-1">✕</button>
                </div>
                <div className="grid grid-cols-2 gap-1.5">
                  <input value={p.name} onChange={(e) => setParams((prev) => prev.map((x) => x._key === p._key ? { ...x, name: e.target.value } : x))}
                    placeholder="Parameter name *" className="border border-slate-200 rounded px-2 py-1 text-[11px] outline-none bg-white" />
                  <input value={p.code || ''} onChange={(e) => setParams((prev) => prev.map((x) => x._key === p._key ? { ...x, code: e.target.value } : x))}
                    placeholder="Code" className="border border-slate-200 rounded px-2 py-1 text-[11px] outline-none bg-white" />
                </div>
                <div className="grid grid-cols-4 gap-1.5">
                  <input value={p.unit} onChange={(e) => setParams((prev) => prev.map((x) => x._key === p._key ? { ...x, unit: e.target.value } : x))} placeholder="Unit" className="border border-slate-200 rounded px-1.5 py-1 text-[11px] outline-none bg-white" />
                  <input value={p.reference_range} onChange={(e) => setParams((prev) => prev.map((x) => x._key === p._key ? { ...x, reference_range: e.target.value } : x))} placeholder="Range" className="border border-slate-200 rounded px-1.5 py-1 text-[11px] outline-none bg-white" />
                  <input type="number" step="any" value={p.ref_low ?? ''} onChange={(e) => setParams((prev) => prev.map((x) => x._key === p._key ? { ...x, ref_low: e.target.value } : x))} placeholder="Low" className="border border-slate-200 rounded px-1.5 py-1 text-[11px] outline-none bg-white" />
                  <input type="number" step="any" value={p.ref_high ?? ''} onChange={(e) => setParams((prev) => prev.map((x) => x._key === p._key ? { ...x, ref_high: e.target.value } : x))} placeholder="High" className="border border-slate-200 rounded px-1.5 py-1 text-[11px] outline-none bg-white" />
                </div>
                <div className="grid grid-cols-2 gap-1.5">
                  <input value={p.method} onChange={(e) => setParams((prev) => prev.map((x) => x._key === p._key ? { ...x, method: e.target.value } : x))} placeholder="Method" className="border border-slate-200 rounded px-1.5 py-1 text-[11px] outline-none bg-white" />
                  <select value={p.result_type} onChange={(e) => setParams((prev) => prev.map((x) => x._key === p._key ? { ...x, result_type: e.target.value } : x))}
                    className="border border-slate-200 rounded px-1.5 py-1 text-[11px] outline-none bg-white">
                    <option value="numeric">Numeric</option>
                    <option value="text">Text</option>
                    <option value="qualitative">Qualitative</option>
                  </select>
                </div>
              </div>
            ))}
            {!params.length && (
              <p className="text-[11px] text-slate-400 text-center py-6 border border-dashed border-slate-200 rounded-lg">Add parameter rows (one for simple tests, many for panels)</p>
            )}
          </div>
        </div>
      </div>
      <div className="flex justify-between gap-2 pt-4 mt-4 border-t border-slate-100">
        {!isNew ? (
          <button
            type="button"
            onClick={remove}
            disabled={deleting || saving}
            className="px-4 py-2 text-xs font-bold text-rose-600 border border-rose-200 rounded-lg hover:bg-rose-50 disabled:opacity-40"
          >
            {deleting ? 'Deleting…' : 'Delete template'}
          </button>
        ) : <span />}
        <div className="flex gap-2">
          <button type="button" onClick={onClose} className="px-4 py-2 text-xs font-semibold border border-slate-200 rounded-lg hover:bg-slate-50">Cancel</button>
          <button type="button" onClick={save} disabled={saving || deleting} className="px-5 py-2 bg-blue-600 text-white text-xs font-bold rounded-lg disabled:opacity-40">
            {saving ? 'Saving…' : 'Save template'}
          </button>
        </div>
      </div>
    </Modal>
  )
}

/* ═══════════════════════════════════════════════════════════════
   SETTINGS — Categories
═══════════════════════════════════════════════════════════════ */
function CategoriesSettings({ categories, refresh }) {
  const [name, setName] = useState('')
  const [saving, setSaving] = useState(false)

  async function add() {
    if (!name.trim()) return
    setSaving(true)
    try {
      await api.post('/lab/categories/', { name })
      toast.success('Added')
      setName('')
      refresh()
    } catch {
      toast.error('Failed')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="h-full overflow-y-auto p-4">
      <div className="max-w-lg bg-white border border-slate-200 rounded-xl p-5">
        <h2 className="text-sm font-bold text-slate-900 mb-3">Categories</h2>
        <div className="flex gap-2 mb-4">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="New category name"
            className="flex-1 border border-slate-200 rounded-lg px-3 py-2 text-xs outline-none focus:border-blue-500"
          />
          <button type="button" onClick={add} disabled={saving} className="bg-blue-600 text-white text-[11px] font-bold uppercase px-4 py-2 rounded-lg disabled:opacity-40">
            Add
          </button>
        </div>
        <ul className="divide-y divide-slate-100 border border-slate-100 rounded-lg overflow-hidden">
          {categories.map((c, i) => (
            <li key={c.id} className="px-3 py-2.5 text-xs font-semibold text-slate-800 flex gap-3">
              <span className="text-slate-300 w-5">{i + 1}</span>
              {c.name}
            </li>
          ))}
          {!categories.length && <li className="px-3 py-8 text-center text-slate-300 text-xs">No categories yet</li>}
        </ul>
      </div>
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════════
   PRINT + PREVIEW BODY — classic TEST REPORT layout (Soni Ram style)
═══════════════════════════════════════════════════════════════ */
function normalizeDeptLabel(raw) {
  let s = String(raw || '').trim()
  if (!s) return 'INVESTIGATIONS'
  s = s.replace(/^DEPARTMENT\s+OF\s+/i, '')
  if (/SEROLOGY/i.test(s)) return 'SEROLOGY'
  if (/HAEMATOLOGY|HEMATOLOGY/i.test(s)) return 'HAEMATOLOGY'
  return s.toUpperCase()
}

/** Group results by department, then by ordered test (Soni Ram layout). */
function buildReportDepartments(report) {
  const depts = []
  const deptMap = {}
  const testMap = {}
  ;(report.results || []).forEach((res) => {
    if (!String(res.result_value || '').trim()) return
    const deptName = normalizeDeptLabel(res.department_label || res.category_name || 'INVESTIGATIONS')
    if (!deptMap[deptName]) {
      deptMap[deptName] = { dept: deptName, tests: [] }
      depts.push(deptMap[deptName])
    }
    const tk = `${deptName}::${res.test}`
    if (!testMap[tk]) {
      testMap[tk] = {
        testId: res.test,
        panelTitle: res.ordered_test_name || '',
        interpretation: res.interpretation || '',
        rows: [],
      }
      deptMap[deptName].tests.push(testMap[tk])
    }
    const t = testMap[tk]
    t.rows.push(res)
    if (!t.interpretation && res.interpretation) t.interpretation = res.interpretation
    if (!t.panelTitle && res.ordered_test_name) t.panelTitle = res.ordered_test_name
  })
  return depts
}

function withResultSections(rows, panelTitle) {
  const out = []
  // Multi-param panels: show ordered test name as section (e.g. CBC)
  if (panelTitle && rows.length > 1) {
    out.push({ type: 'section', label: panelTitle })
  }
  let cur = null
  rows.forEach((r) => {
    const sec = r.section_title || r.section_title_snapshot || ''
    if (sec && sec !== cur) {
      out.push({ type: 'section', label: sec })
      cur = sec
    }
    out.push({ type: 'row', data: r })
  })
  return out
}

function fmtReport(dt) {
  if (!dt) return ''
  return formatLabReportDate(dt)
}

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function formatAgeSex(pt) {
  let unit = String(pt.age_unit || 'years').toLowerCase()
  if (unit === 'y' || unit === 'year') unit = 'Years'
  else if (unit === 'years') unit = 'Years'
  else if (unit === 'months' || unit === 'month') unit = 'Months'
  else if (unit === 'days' || unit === 'day') unit = 'Days'
  else unit = unit.charAt(0).toUpperCase() + unit.slice(1)
  const agePart = pt.age != null && pt.age !== '' ? `${pt.age} ${unit}` : ''
  const sex = pt.gender ? String(pt.gender).charAt(0).toUpperCase() + String(pt.gender).slice(1).toLowerCase() : ''
  return [agePart, sex].filter(Boolean).join(' / ')
}

function usableLabMediaUrl(url) {
  const s = String(url || '').trim()
  if (!s || s === 'null' || s === 'undefined' || s === '/') return ''
  if (/\/media\/?$/i.test(s)) return ''
  return s
}

function resolveWatermarkUrl(settings) {
  if (!settings?.watermark_enabled) return ''
  if (settings.watermark_source === 'custom') return usableLabMediaUrl(settings.watermark_url)
  return usableLabMediaUrl(settings.logo_url) || usableLabMediaUrl(settings.watermark_url)
}

function LabLetterheadLogo({ url, className = 'h-11 w-11 shrink-0 border-[1.5px] border-slate-900 rounded-sm bg-white flex items-center justify-center overflow-hidden' }) {
  const src = usableLabMediaUrl(url)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    setFailed(false)
  }, [src])
  if (!src || failed) return null
  return (
    <div className={className}>
      <img
        src={src}
        alt=""
        className="h-full w-full object-contain p-0.5"
        onError={() => setFailed(true)}
      />
    </div>
  )
}

function watermarkStyleValues(settings) {
  const opacity = Math.max(5, Math.min(40, Number(settings?.watermark_opacity) || 15)) / 100
  const size = Math.max(20, Math.min(90, Number(settings?.watermark_size) || 55))
  const rotation = Math.max(-90, Math.min(90, Number(settings?.watermark_rotation) || 0))
  return { opacity, size, rotation }
}

function formatPatientDisplayName(pt) {
  const name = `${pt.first_name || ''} ${pt.last_name || ''}`.trim()
  if (!name) return ''
  const g = String(pt.gender || '').toLowerCase()
  if (g === 'male' && !/^mr\.?\s/i.test(name)) return `MR. ${name.toUpperCase()}`
  if (g === 'female' && !/^(mrs|ms|miss)\.?\s/i.test(name)) return `MRS. ${name.toUpperCase()}`
  return name.toUpperCase()
}

function infoCellHtml(label, value) {
  if (value == null || String(value).trim() === '') return ''
  return `<tr>
    <td style="padding:2px 0;font-size:9pt;color:#000;white-space:nowrap;width:28mm;vertical-align:top">${escapeHtml(label)}</td>
    <td style="padding:2px 6px 2px 0;font-size:9pt;color:#000;width:8px;vertical-align:top">:</td>
    <td style="padding:2px 0;font-size:9pt;font-weight:700;color:#000;vertical-align:top">${escapeHtml(value)}</td>
  </tr>`
}

function renderResultRowHtml(item) {
  if (item.type === 'section') {
    return `<tr>
      <td colspan="4" style="padding:8px 0 3px;font-size:9.5pt;font-weight:700;color:#000;border-bottom:1px solid #000">${escapeHtml(item.label)}</td>
    </tr>`
  }
  const r = item.data
  const flag = r.flag || ''
  const bad = !!(r.is_abnormal || flag)
  const name = r.test_name || r.parameter_name || ''
  const unit = r.test_unit || r.unit_snapshot || ''
  const ref = r.test_ref || r.reference_range_snapshot || ''
  const method = r.test_method || r.method_snapshot || ''
  const triangle = flag === 'H'
    ? `<span style="margin-left:4px;font-size:7.5pt;color:#16a34a;font-weight:900;line-height:1;vertical-align:middle">&#9650;</span>`
    : flag === 'L'
      ? `<span style="margin-left:4px;font-size:7.5pt;color:#b91c1c;font-weight:900;line-height:1;vertical-align:middle">&#9660;</span>`
      : ''
  return `<tr>
    <td style="padding:3px 8px 3px 0;font-size:9pt;vertical-align:top;${bad ? 'font-weight:700' : ''}">
      ${escapeHtml(name)}
      ${method ? `<div style="font-size:7.5pt;color:#444;font-weight:400;margin-top:1px">${escapeHtml(method)}</div>` : ''}
    </td>
    <td style="padding:3px 8px;font-size:9pt;font-weight:${bad ? '700' : '600'};vertical-align:top;color:#000">
      ${escapeHtml(r.result_value)}${triangle}
    </td>
    <td style="padding:3px 8px;font-size:9pt;vertical-align:top;color:#000">${escapeHtml(unit)}</td>
    <td style="padding:3px 0 3px 8px;font-size:9pt;vertical-align:top;color:#000;text-align:right">${escapeHtml(ref)}</td>
  </tr>`
}

export function buildLabReportPrintHtml(report, settings) {
  const pt = report.patient_details || {}
  const departments = buildReportDepartments(report)
  const labName = settings?.lab_name || 'Clinical Laboratory'
  const patientName = formatPatientDisplayName(pt)
  const ageSex = formatAgeSex(pt)
  const sampleReceived = fmtReport(report.received_at || report.collected_at)
  const reportingDate = fmtReport(report.reported_at)
  const referredBy = report.doctor_details?.name || ''
  const uhid = String(pt.uhid || '').trim()
  const mobile = pt.phone || ''

  const panelHtml = departments.map((dept, idx) => {
    const bodyParts = dept.tests.map((test) => {
      const items = withResultSections(test.rows, test.panelTitle)
      const rowsHtml = items.map(renderResultRowHtml).join('')
      const desc = test.interpretation
        ? `<tr><td colspan="4" style="padding:10px 0 4px">
            <div class="report-desc-box" style="border:1px solid #000;padding:8px 10px;background:transparent">
              <div style="font-size:9pt;font-weight:700;color:#000;margin-bottom:4px">Description :</div>
              <div style="font-size:8.5pt;color:#222;line-height:1.45;text-align:justify;white-space:pre-line">${escapeHtml(test.interpretation)}</div>
            </div>
          </td></tr>`
        : ''
      return rowsHtml + desc
    }).join('')

    return `<div class="dept-panel" style="margin-top:${idx === 0 ? '10px' : '16px'};page-break-inside:avoid;position:relative;z-index:2">
      <div style="font-size:11pt;font-weight:700;text-transform:uppercase;letter-spacing:0.04em;color:#000;border-bottom:2px solid #000;padding-bottom:3px;margin-bottom:2px">
        ${escapeHtml(dept.dept)}
      </div>
      <table style="width:100%;border-collapse:collapse;table-layout:fixed">
        <thead>
          <tr>
            <th style="padding:4px 8px 4px 0;text-align:left;font-size:9pt;font-weight:700;border-bottom:1px solid #000;width:42%">Test Name</th>
            <th style="padding:4px 8px;text-align:left;font-size:9pt;font-weight:700;border-bottom:1px solid #000;width:18%">Result</th>
            <th style="padding:4px 8px;text-align:left;font-size:9pt;font-weight:700;border-bottom:1px solid #000;width:18%">Unit</th>
            <th style="padding:4px 0 4px 8px;text-align:right;font-size:9pt;font-weight:700;border-bottom:1px solid #000;width:22%">Reference Range</th>
          </tr>
        </thead>
        <tbody>${bodyParts}</tbody>
      </table>
    </div>`
  }).join('')

  const pathologistQual = settings?.pathologist_qualification || ''
  const pathologistReg = settings?.pathologist_reg_no ? `H No : ${settings.pathologist_reg_no}` : ''

  const patientBoxHtml = `<div class="patient-grid">
    <div class="patient-grid-left">
      <table class="info-table">
        ${infoCellHtml('Patient Name', patientName)}
        ${infoCellHtml('Reffered By', referredBy)}
        ${infoCellHtml('Age / Sex', ageSex)}
        ${infoCellHtml('Mobile No', mobile)}
        ${infoCellHtml('UHID', uhid)}
      </table>
    </div>
    <div class="patient-grid-right">
      <div class="report-stamp">TEST REPORT</div>
      <table class="meta-table">
        <tr>
          <td>
            <div class="meta-k">Sample Received</div>
            <div class="meta-v">${escapeHtml(sampleReceived || '—')}</div>
          </td>
        </tr>
        <tr>
          <td>
            <div class="meta-k">Reporting Date</div>
            <div class="meta-v">${escapeHtml(reportingDate || '—')}</div>
          </td>
        </tr>
      </table>
    </div>
  </div>`

  const logoUrl = usableLabMediaUrl(settings?.logo_url)
  const letterheadHtml = `<div class="letterhead">
    <div class="accent-bar"></div>
    <div class="letterhead-body">
      <div class="letterhead-brand">
        ${logoUrl ? `<div class="logo-frame"><img src="${escapeHtml(logoUrl)}" alt="" onerror="var p=this.parentNode;if(p)p.remove();"/></div>` : ''}
        <div class="brand-text">
          <div class="letterhead-name">${escapeHtml(labName)}</div>
          ${settings?.tagline ? `<div class="letterhead-tag">${escapeHtml(settings.tagline)}</div>` : ''}
          ${settings?.address ? `<div class="letterhead-sub" style="white-space:pre-line">${escapeHtml(settings.address)}</div>` : ''}
          <div class="letterhead-sub">${escapeHtml([settings?.phone && `Ph: ${settings.phone}`, settings?.website].filter(Boolean).join(' · '))}</div>
        </div>
      </div>
      <div class="letterhead-meta">
        <div class="meta-label">Document</div>
        <div class="meta-value">Clinical Report</div>
        ${settings?.gstin ? `<div class="meta-line">GSTIN: ${escapeHtml(settings.gstin)}</div>` : ''}
        ${settings?.nabl_reg_no ? `<div class="meta-line">${escapeHtml(settings.nabl_reg_no)}</div>` : ''}
      </div>
    </div>
  </div>`

  const wmUrl = resolveWatermarkUrl(settings)
  const { opacity: wmOpacity, size: wmSize, rotation: wmRotation } = watermarkStyleValues(settings)
  const watermarkHtml = wmUrl
    ? `<div class="watermark" aria-hidden="true"><img src="${escapeHtml(wmUrl)}" alt="" onerror="var p=this.parentNode;if(p)p.remove();"/></div>`
    : ''

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8"/>
  <title>TEST REPORT ${escapeHtml(patientName || report.lab_no || '')}</title>
  <style>
    * { box-sizing: border-box; -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
    @page { size: A4; margin: 8mm; }
    html, body { margin: 0; padding: 0; background: #fff; color: #000; font-family: Arial, Helvetica, sans-serif; }

    .watermark {
      position: fixed; inset: 0; display: flex; align-items: center; justify-content: center;
      pointer-events: none; z-index: 1; opacity: ${wmOpacity};
    }
    .watermark img {
      max-width: ${wmSize}%; max-height: ${wmSize}%; object-fit: contain;
      transform: rotate(${wmRotation}deg);
    }

    .sheet { width: 100%; border-collapse: collapse; position: relative; z-index: 2; }
    .sheet > thead { display: table-header-group; }
    .sheet > tfoot { display: table-footer-group; }
    .sheet > tbody { display: table-row-group; }
    .sheet > thead > tr > td,
    .sheet > tbody > tr > td { padding: 0; vertical-align: top; }

    .report-desc-box {
      position: relative; z-index: 2; background: transparent !important;
    }
    .dept-panel { position: relative; z-index: 2; }

    /* Payment-slip style header frame */
    .report-header {
      position: relative; z-index: 5; background: #fff;
      border: 1.5px solid #0f172a;
      margin-bottom: 12px;
      overflow: hidden;
    }
    .accent-bar {
      height: 5px;
      background: linear-gradient(90deg, #0f766e 0%, #0ea5e9 55%, #0369a1 100%);
    }
    .letterhead { background: #fff; }
    .letterhead-body {
      display: flex; justify-content: space-between; align-items: stretch; gap: 12px;
      padding: 10px 12px 10px;
      border-bottom: 1.5px solid #0f172a;
      background: linear-gradient(180deg, #f8fafc 0%, #ffffff 70%);
    }
    .letterhead-brand { display: flex; gap: 10px; align-items: center; min-width: 0; }
    .logo-frame {
      width: 48px; height: 48px; border: 1.5px solid #0f172a; border-radius: 4px;
      background: #fff; display: flex; align-items: center; justify-content: center;
      overflow: hidden; flex-shrink: 0;
    }
    .logo-frame img { width: 100%; height: 100%; object-fit: contain; padding: 3px; }
    .logo-fallback {
      font-size: 9pt; font-weight: 800; letter-spacing: 0.08em; color: #0f766e;
    }
    .brand-text { min-width: 0; }
    .letterhead-name {
      font-size: 16pt; font-weight: 800; line-height: 1.1; color: #0f172a;
      letter-spacing: 0.01em;
    }
    .letterhead-tag {
      display: inline-block; margin-top: 3px; font-size: 7pt; font-weight: 700;
      text-transform: uppercase; letter-spacing: 0.08em; color: #0f766e;
      background: #ecfdf5; border: 1px solid #99f6e4; padding: 1px 6px; border-radius: 2px;
    }
    .letterhead-sub { font-size: 7.5pt; color: #475569; margin-top: 2px; line-height: 1.35; }
    .letterhead-meta {
      text-align: right; border-left: 1.5px dashed #94a3b8; padding-left: 12px;
      min-width: 38mm; display: flex; flex-direction: column; justify-content: center;
    }
    .meta-label {
      font-size: 7pt; font-weight: 700; text-transform: uppercase; letter-spacing: 0.1em; color: #64748b;
    }
    .meta-value { font-size: 10pt; font-weight: 800; color: #0f172a; margin: 2px 0 4px; }
    .meta-line { font-size: 7.5pt; color: #64748b; line-height: 1.35; }

    .patient-grid { display: flex; align-items: stretch; background: #fff; }
    .patient-grid-left { flex: 1; padding: 9px 11px; }
    .patient-grid-right {
      width: 54mm; padding: 9px 10px; border-left: 1.5px solid #0f172a;
      background: #f8fafc; display: flex; flex-direction: column; gap: 7px;
    }
    .info-table { border-collapse: collapse; width: 100%; }
    .info-table td { padding: 2px 0; font-size: 9pt; vertical-align: top; color: #0f172a; }
    .report-stamp {
      font-size: 10.5pt; font-weight: 800; letter-spacing: 0.14em; text-align: center;
      color: #0f172a; border: 1.5px solid #0f172a; background: #fff;
      padding: 6px 4px; line-height: 1.1;
    }
    .meta-table { width: 100%; border-collapse: collapse; }
    .meta-table tr + tr td { padding-top: 5px; }
    .meta-table td { padding: 0; vertical-align: top; }
    .meta-k {
      font-size: 7pt; font-weight: 700; text-transform: uppercase;
      letter-spacing: 0.05em; color: #64748b; margin-bottom: 1px;
    }
    .meta-v {
      font-size: 9pt; font-weight: 700; color: #0f172a; line-height: 1.25;
    }

    .page-footer {
      background: #fff;
      padding-top: 8px;
      border-top: 1px solid #e2e8f0;
      page-break-inside: avoid;
    }
    .page-footer-inner { min-height: 18mm; }
    .report-body { position: relative; z-index: 2; padding-top: 2px; padding-bottom: 4px; }
    .end-of-report {
      text-align: center; font-size: 10pt; font-weight: 700; letter-spacing: 0.06em;
      margin-top: 18px; margin-bottom: 8px;
    }
  </style>
</head>
<body>
  ${watermarkHtml}

  <table class="sheet">
    <thead>
      <tr>
        <td>
          <div class="report-header">
            ${letterheadHtml}
            ${patientBoxHtml}
          </div>
        </td>
      </tr>
    </thead>
    <tfoot>
      <tr>
        <td>
          <div class="page-footer">
            <div class="page-footer-inner">
              <div style="display:flex;justify-content:flex-end">
                <div style="text-align:center;min-width:48mm">
                  ${settings?.signature_url ? `<img src="${escapeHtml(settings.signature_url)}" alt="" style="height:38px;margin:0 auto 3px;object-fit:contain;display:block"/>` : '<div style="height:22px"></div>'}
                  ${settings?.pathologist_name ? `<div style="font-size:10pt;font-weight:700">${escapeHtml(settings.pathologist_name)}</div>` : ''}
                  ${pathologistQual ? `<div style="font-size:8.5pt">${escapeHtml(pathologistQual)}</div>` : ''}
                  ${pathologistReg ? `<div style="font-size:8.5pt">${escapeHtml(pathologistReg)}</div>` : ''}
                  <div style="font-size:8.5pt;margin-top:2px">Consultant Pathologist</div>
                </div>
              </div>
              ${settings?.footer_note ? `<div style="margin-top:6px;text-align:center;font-size:7pt;color:#444">${escapeHtml(settings.footer_note)}</div>` : ''}
            </div>
          </div>
        </td>
      </tr>
    </tfoot>
    <tbody>
      <tr>
        <td>
          <div class="report-body">
            ${panelHtml || '<div style="font-size:10pt;color:#666;text-align:center;padding:28px 0">No results entered</div>'}
            <div class="end-of-report">************End Of Report ************</div>
          </div>
        </td>
      </tr>
    </tbody>
  </table>
</body>
</html>`
}

export function printLabReportViaIframe(report, settings) {
  return new Promise((resolve) => {
    const iframe = document.createElement('iframe')
    iframe.setAttribute('title', 'lab-report-print')
    iframe.style.cssText = 'position:fixed;left:-12000px;top:0;width:210mm;height:297mm;border:0;opacity:0;pointer-events:none;'
    document.body.appendChild(iframe)
    const doc = iframe.contentDocument || iframe.contentWindow.document
    doc.open()
    doc.write(buildLabReportPrintHtml(report, settings))
    doc.close()

    const win = iframe.contentWindow
    const cleanup = () => {
      try { document.body.removeChild(iframe) } catch { /* already removed */ }
      resolve()
    }
    win.addEventListener('afterprint', cleanup)

    const tryPrint = () => {
      try {
        win.focus()
        win.print()
      } catch { /* noop */ }
      setTimeout(cleanup, 8000)
    }

    const imgs = Array.from(doc.images || [])
    if (!imgs.length) {
      setTimeout(tryPrint, 150)
      return
    }
    let left = imgs.length
    const done = () => {
      left -= 1
      if (left <= 0) setTimeout(tryPrint, 100)
    }
    imgs.forEach((img) => {
      if (img.complete) done()
      else {
        img.addEventListener('load', done)
        img.addEventListener('error', done)
      }
    })
  })
}

function ReportPreviewBody({ report, settings, compact }) {
  const pt = report.patient_details || {}
  const departments = buildReportDepartments(report)
  const pad = compact ? 'px-3 py-2' : 'px-4 py-3'
  const patientName = formatPatientDisplayName(pt)
  const ageSex = formatAgeSex(pt)
  const sampleReceived = fmtReport(report.received_at || report.collected_at)
  const reportingDate = fmtReport(report.reported_at)
  const referredBy = report.doctor_details?.name || ''
  const uhid = String(pt.uhid || '').trim()
  const mobile = pt.phone || ''
  const labName = settings?.lab_name || 'Clinical Laboratory'
  const wmUrl = resolveWatermarkUrl(settings)
  const { opacity: wmOpacity, size: wmSize, rotation: wmRotation } = watermarkStyleValues(settings)

  return (
    <div className={`relative text-black font-sans ${pad} ${compact ? '' : 'min-h-[297mm] flex flex-col'}`}>
      {wmUrl && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center z-[1]" aria-hidden>
          <img
            src={wmUrl}
            alt=""
            className="object-contain"
            style={{
              maxWidth: `${wmSize}%`,
              maxHeight: `${wmSize}%`,
              opacity: wmOpacity,
              transform: `rotate(${wmRotation}deg)`,
            }}
            onError={(e) => { e.currentTarget.style.display = 'none' }}
          />
        </div>
      )}
      <div className="relative z-[2] flex flex-col flex-1">
      {/* Payment-slip style header frame */}
      <div className="relative z-[5] bg-white mb-3 border-[1.5px] border-slate-900 overflow-hidden">
        <div className="h-1.5 bg-gradient-to-r from-teal-700 via-sky-500 to-sky-700" />
        <div className="flex items-stretch justify-between gap-3 px-3 py-2.5 border-b-[1.5px] border-slate-900 bg-gradient-to-b from-slate-50 to-white">
          <div className="flex items-center gap-2.5 min-w-0">
            <LabLetterheadLogo url={settings?.logo_url} />
            <div className="min-w-0">
              <h1 className={`${compact ? 'text-sm' : 'text-[17px]'} font-extrabold leading-tight text-slate-900`}>{labName}</h1>
              {settings?.tagline && (
                <span className="inline-block mt-0.5 text-[9px] font-bold uppercase tracking-wider text-teal-700 bg-emerald-50 border border-emerald-200 px-1.5 py-px">
                  {settings.tagline}
                </span>
              )}
              {settings?.address && <p className="text-[10px] text-slate-500 whitespace-pre-line leading-snug mt-0.5">{settings.address}</p>}
              {(settings?.phone || settings?.website) && (
                <p className="text-[10px] text-slate-500">
                  {[settings?.phone && `Ph: ${settings.phone}`, settings?.website].filter(Boolean).join(' · ')}
                </p>
              )}
            </div>
          </div>
          <div className="text-right border-l border-dashed border-slate-400 pl-3 min-w-[120px] flex flex-col justify-center">
            <p className="text-[9px] font-bold uppercase tracking-widest text-slate-500">Document</p>
            <p className="text-[12px] font-extrabold text-slate-900 mt-0.5">Clinical Report</p>
            {settings?.gstin && <p className="text-[10px] text-slate-500 mt-1">GSTIN: {settings.gstin}</p>}
            {settings?.nabl_reg_no && <p className="text-[10px] text-slate-500">{settings.nabl_reg_no}</p>}
          </div>
        </div>

        <div className="flex">
          <div className="flex-1 space-y-0.5 text-[11px] px-2.5 py-2">
            <PreviewInfoRow label="Patient Name" value={patientName} />
            <PreviewInfoRow label="Reffered By" value={referredBy} />
            <PreviewInfoRow label="Age / Sex" value={ageSex} />
            <PreviewInfoRow label="Mobile No" value={mobile} />
            <PreviewInfoRow label="UHID" value={uhid} />
          </div>
          <div className="w-[175px] px-2.5 py-2.5 bg-slate-50 border-l-[1.5px] border-slate-900 flex flex-col gap-1.5">
            <p className="text-[11px] font-extrabold tracking-[0.14em] text-center text-slate-900 border-[1.5px] border-slate-900 bg-white py-1.5">
              TEST REPORT
            </p>
            <div>
              <p className="text-[9px] font-bold uppercase tracking-wide text-slate-500">Sample Received</p>
              <p className="text-[11px] font-bold text-slate-900 leading-snug">{sampleReceived || '—'}</p>
            </div>
            <div>
              <p className="text-[9px] font-bold uppercase tracking-wide text-slate-500">Reporting Date</p>
              <p className="text-[11px] font-bold text-slate-900 leading-snug">{reportingDate || '—'}</p>
            </div>
          </div>
        </div>
      </div>

      <div className="flex-1">
        {departments.map((dept, pi) => (
          <div key={pi} className="mt-3 relative z-[2]">
            <p className="text-[12px] font-extrabold uppercase tracking-wider border-b-2 border-slate-900 pb-0.5 mb-1 text-slate-900">{dept.dept}</p>
            <table className="w-full text-[11px]">
              <thead>
                <tr className="border-b border-black">
                  <th className="py-1 pr-2 text-left font-bold w-[42%]">Test Name</th>
                  <th className="py-1 px-2 text-left font-bold w-[18%]">Result</th>
                  <th className="py-1 px-2 text-left font-bold w-[18%]">Unit</th>
                  <th className="py-1 pl-2 text-right font-bold w-[22%]">Reference Range</th>
                </tr>
              </thead>
              <tbody>
                {dept.tests.map((test) => (
                  <React.Fragment key={test.testId}>
                    {withResultSections(test.rows, test.panelTitle).map((item, idx) => {
                      if (item.type === 'section') {
                        return (
                          <tr key={`s-${test.testId}-${idx}`}>
                            <td colSpan={4} className="pt-2 pb-1 font-bold border-b border-black">{item.label}</td>
                          </tr>
                        )
                      }
                      const r = item.data
                      const flag = r.flag || ''
                      const bad = !!(r.is_abnormal || flag)
                      const method = r.test_method || r.method_snapshot || ''
                      return (
                        <tr key={r.id}>
                          <td className={`py-1 pr-2 align-top ${bad ? 'font-bold' : ''}`}>
                            {r.test_name || r.parameter_name}
                            {method && <div className="text-[9px] font-normal text-slate-600">{method}</div>}
                          </td>
                          <td className="py-1 px-2 align-top font-semibold">
                            <span className={bad ? 'font-bold' : ''}>{r.result_value}</span>
                            {flag === 'H' && <span className="ml-1 text-[8px] text-emerald-600 font-black leading-none align-middle">▲</span>}
                            {flag === 'L' && <span className="ml-1 text-[8px] text-rose-600 font-black leading-none align-middle">▼</span>}
                          </td>
                          <td className="py-1 px-2 align-top">{r.test_unit || r.unit_snapshot || ''}</td>
                          <td className="py-1 pl-2 text-right align-top">{r.test_ref || r.reference_range_snapshot || ''}</td>
                        </tr>
                      )
                    })}
                    {test.interpretation && (
                      <tr>
                        <td colSpan={4} className="pt-2 pb-1">
                          <div className="relative border border-black px-3 py-2 bg-transparent">
                            <p className="text-[11px] font-bold mb-1">Description :</p>
                            <p className="text-[10px] leading-relaxed text-justify whitespace-pre-line">{test.interpretation}</p>
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          </div>
        ))}
        <p className="text-center text-[11px] font-bold tracking-wide mt-5 mb-6">************End Of Report ************</p>
      </div>

      <div className="mt-8 pt-4 border-t border-slate-200 flex justify-end text-center text-[11px] shrink-0">
        <div className="min-w-[150px]">
          {settings?.signature_url && <img src={settings.signature_url} alt="" className="h-10 mx-auto mb-1 object-contain" />}
          {settings?.pathologist_name && <p className="font-bold">{settings.pathologist_name}</p>}
          {settings?.pathologist_qualification && <p className="text-[10px]">{settings.pathologist_qualification}</p>}
          {settings?.pathologist_reg_no && <p className="text-[10px]">H No : {settings.pathologist_reg_no}</p>}
          <p className="text-[10px]">Consultant Pathologist</p>
        </div>
      </div>
      </div>
    </div>
  )
}

function PreviewInfoRow({ label, value }) {
  if (!value) return null
  return (
    <div className="flex text-[11px] leading-snug">
      <span className="w-[108px] shrink-0">{label}</span>
      <span className="w-3 shrink-0">:</span>
      <span className="font-bold">{value}</span>
    </div>
  )
}

function LabReportPrint({ report, settings, onClose }) {
  const [fullReport, setFullReport] = useState(null)
  const [loadingReport, setLoadingReport] = useState(true)
  const [printing, setPrinting] = useState(false)

  useEffect(() => {
    if (!report?.id) {
      setLoadingReport(false)
      return
    }
    let cancelled = false
    ;(async () => {
      try {
        const full = await fetchLabReport(report.id)
        if (!cancelled) setFullReport(full)
      } catch {
        if (!cancelled) toast.error('Could not load report')
      } finally {
        if (!cancelled) setLoadingReport(false)
      }
    })()
    return () => { cancelled = true }
  }, [report?.id])

  const activeReport = fullReport || report

  const runPrint = useCallback(async () => {
    if (!activeReport || printing) return
    setPrinting(true)
    try {
      await printLabReportViaIframe(activeReport, settings)
    } finally {
      setPrinting(false)
    }
  }, [activeReport, settings, printing])

  useEffect(() => {
    if (loadingReport || !activeReport) return
    const t = setTimeout(() => { runPrint() }, 250)
    return () => clearTimeout(t)
  }, [loadingReport, activeReport?.id]) // eslint-disable-line react-hooks/exhaustive-deps -- auto-print once loaded

  return (
    <div className="fixed inset-0 bg-white z-[300] overflow-y-auto">
      <div className="sticky top-0 z-[1] bg-white/95 border-b border-slate-200 px-4 py-2 flex items-center justify-end gap-2">
        <button type="button" onClick={onClose} className="bg-white border border-slate-200 shadow px-3 py-1.5 rounded-lg text-xs font-bold">
          Back
        </button>
        <button
          type="button"
          onClick={runPrint}
          disabled={printing || loadingReport}
          className="bg-blue-600 text-white px-3 py-1.5 rounded-lg text-xs font-bold disabled:opacity-50"
        >
          {printing ? 'Printing…' : 'Print'}
        </button>
      </div>
      <div className="max-w-[210mm] mx-auto bg-white">
        {loadingReport ? (
          <p className="text-center text-sm text-slate-400 py-20">Loading report…</p>
        ) : (
          <ReportPreviewBody report={activeReport} settings={settings} />
        )}
      </div>
    </div>
  )
}


/* ── Modal ───────────────────────────────────────────────────── */
function LabAddPatientModal({ onClose, onAdded, initialSearchName = '' }) {
  const [data, setData] = useState(() => {
    const { first_name, last_name } = splitPatientSearchName(initialSearchName)
    return {
      first_name: first_name || '',
      last_name: last_name || '',
      phone: '',
      gender: 'male',
      age: '',
      address_line1: '',
    }
  })
  const [submitting, setSubmitting] = useState(false)

  async function handleAdd() {
    const firstName = (data.first_name || '').trim()
    if (!firstName) return toast.error('First name is required')
    setSubmitting(true)
    try {
      const payload = {
        first_name: firstName,
        last_name: (data.last_name || '').trim(),
        phone: (data.phone || '').trim(),
        gender: data.gender || 'other',
        hospital_id: getHospitalId(),
      }
      if (data.address_line1?.trim()) payload.address_line1 = data.address_line1.trim()
      if (data.age !== '' && data.age != null) {
        payload.age = Number(data.age)
        payload.age_unit = 'years'
      }
      const res = await api.post('/patients/', payload)
      const created = res.data?.data || res.data
      toast.success('Patient registered')
      onAdded(created)
      onClose()
    } catch (err) {
      const msg = err?.response?.data?.errors
        ? Object.values(err.response.data.errors).flat().join(', ')
        : (err?.response?.data?.message || 'Registration failed')
      toast.error(msg)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Modal title="New patient" onClose={onClose} size="max-w-md">
      <div className="grid grid-cols-2 gap-3">
        <label className="block">
          <span className="text-[10px] font-semibold text-slate-600">First name *</span>
          <input value={data.first_name} onChange={(e) => setData({ ...data, first_name: e.target.value })}
            className="mt-0.5 w-full border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs outline-none focus:border-blue-500" />
        </label>
        <label className="block">
          <span className="text-[10px] font-semibold text-slate-600">Last name</span>
          <input value={data.last_name} onChange={(e) => setData({ ...data, last_name: e.target.value })}
            className="mt-0.5 w-full border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs outline-none focus:border-blue-500" />
        </label>
        <label className="block">
          <span className="text-[10px] font-semibold text-slate-600">Mobile</span>
          <input value={data.phone} onChange={(e) => setData({ ...data, phone: e.target.value })}
            className="mt-0.5 w-full border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs outline-none focus:border-blue-500" />
        </label>
        <label className="block">
          <span className="text-[10px] font-semibold text-slate-600">Gender</span>
          <select value={data.gender} onChange={(e) => setData({ ...data, gender: e.target.value })}
            className="mt-0.5 w-full border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs outline-none focus:border-blue-500 bg-white">
            <option value="male">Male</option>
            <option value="female">Female</option>
            <option value="other">Other</option>
          </select>
        </label>
        <label className="block">
          <span className="text-[10px] font-semibold text-slate-600">Age (years)</span>
          <input type="number" min="0" value={data.age} onChange={(e) => setData({ ...data, age: e.target.value })}
            className="mt-0.5 w-full border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs outline-none focus:border-blue-500" />
        </label>
        <label className="block col-span-2">
          <span className="text-[10px] font-semibold text-slate-600">Address</span>
          <input value={data.address_line1} onChange={(e) => setData({ ...data, address_line1: e.target.value })}
            className="mt-0.5 w-full border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs outline-none focus:border-blue-500" />
        </label>
      </div>
      <div className="flex justify-end gap-2 pt-4 mt-2 border-t border-slate-100">
        <button type="button" onClick={onClose} className="px-4 py-2 text-xs font-semibold border border-slate-200 rounded-lg hover:bg-slate-50">Cancel</button>
        <button type="button" onClick={handleAdd} disabled={submitting}
          className="px-5 py-2 bg-blue-600 text-white text-xs font-bold rounded-lg disabled:opacity-40">
          {submitting ? 'Saving…' : 'Add patient'}
        </button>
      </div>
    </Modal>
  )
}

function Modal({ title, onClose, children, size = 'max-w-2xl' }) {
  useEffect(() => {
    const h = (e) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', h)
    return () => document.removeEventListener('keydown', h)
  }, [onClose])

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-[200]">
      <div className={`bg-white rounded-xl shadow-xl w-full ${size} max-h-[90vh] overflow-hidden flex flex-col`}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100 shrink-0">
          <h3 className="text-sm font-bold text-slate-900">{title}</h3>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-700 text-lg leading-none">×</button>
        </div>
        <div className="flex-1 overflow-y-auto p-4">{children}</div>
      </div>
    </div>
  )
}
