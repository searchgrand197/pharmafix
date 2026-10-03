import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useLocation, useNavigate } from 'react-router-dom'
import {
  ShoppingBag as ShoppingBagIcon,
  Search as SearchIcon,
  Add as AddIcon,
  Logout as LogoutIcon,
  Close as CloseIcon,
  Settings as SettingsIcon,
  Description as DescriptionIcon,
  PersonAdd as PersonAddIcon,
  Inventory2 as Inventory2Icon,
  LocalShipping as LocalShippingIcon,
  Visibility as VisibilityIcon,
  ChevronRight as ChevronRightIcon,
  Edit as EditIcon,
  Tune as TuneIcon,
  Delete as DeleteIcon,
  Dashboard as DashboardIcon,
  KeyboardDoubleArrowLeft as KeyboardDoubleArrowLeftIcon,
  KeyboardDoubleArrowRight as KeyboardDoubleArrowRightIcon,
  Sell as SellIcon,
  Groups as GroupsIcon,
  ExpandMore as ExpandMoreIcon,
  ExpandLess as ExpandLessIcon,
  AssignmentReturn as AssignmentReturnIcon,
  ArrowBack as ArrowBackMuiIcon,
  Person as PersonMuiIcon,
  Print as PrintMuiIcon,
  History as HistoryMuiIcon,
  Block as BlockMuiIcon,
  CheckCircleOutlined as CheckCircleOutlineMuiIcon,
} from '@mui/icons-material'
import api, { getHospitalId } from '../api'
import toast from 'react-hot-toast'
import { useAuthStore } from '../stores/authStore'
import { withTimeTokens, useTimeDisplayMode } from '../utils/dateTimeFormat'
import { format } from 'date-fns'
import { AmPmTimeInput, FormattedDateInput } from '../components/DateTimeInputs'
import { matchPharmacyPath, pathForSection, pathForPurchaseSubView } from './pharmacyRoutes'
import ErpBillingView from '../pharmacy/ErpBillingView'
import PharmacyInvoicePrint from '../pharmacy/PharmacyInvoicePrint'
import SettingsPanel, { UnsavedSettingsDialog } from '../pharmacy/SettingsPanel'
import { normalizeOutletSettingsFromApi, resolveOutletForChannel } from '../pharmacy/outletSettingsUtils'
import PurchaseChallanPanel from '../pharmacy/PurchaseChallanPanel'
import PurchaseHistoryDashboard from '../pharmacy/PurchaseHistoryDashboard'
import PharmacyDashboard from '../pharmacy/PharmacyDashboard'
import PharmacyCategoriesView from '../pharmacy/PharmacyCategoriesView'
import PartiesView from '../pharmacy/PartiesView'
import DraftsView from '../pharmacy/DraftsView'
import PharmacyInvoiceViewModal from '../pharmacy/PharmacyInvoiceViewModal'
import PharmacyInvoiceCancelModal from '../pharmacy/PharmacyInvoiceCancelModal'
import { computeInvoiceRoundOff, parseApiError } from '../pharmacy/pharmacyCalculations'
import { normalizeDiscountPercentInput, formatBillQtyForOutlet, packSizeFromInvoiceItem, qtySuffixFromMedicine, computeBaseQtyFromPacksLoose } from '../pharmacy/billingUtils'
import { calcLineRefund, calcPreviewTotals, buildReturnPayload, validateReturn, isFullBillReturn, groupReturnHistoryRows } from '../pharmacy/returnUtils'
import ReturnFullBillCancelModal from '../pharmacy/ReturnFullBillCancelModal'
import {
  resolveCategoryRules,
  packFieldLabel,
  baseFieldLabel,
  conversionHintLines,
  normalizeCategoryName,
} from '../pharmacy/categoryRulePresets'
import { mergeCategoryNames } from '../pharmacy/pharmacyCategoryNames'
import { ensurePharmacyBranchContext } from '../services/pharmacyService'

function asMuiIcon(IconComponent) {
  return function IconBridge({ size, className, sx, ...rest }) {
    return <IconComponent className={className} sx={{ ...(size ? { fontSize: size } : {}), ...sx }} {...rest} />
  }
}

const ShoppingBag = asMuiIcon(ShoppingBagIcon)
const Search = asMuiIcon(SearchIcon)
const Plus = asMuiIcon(AddIcon)
const LogOut = asMuiIcon(LogoutIcon)
const X = asMuiIcon(CloseIcon)
const Settings = asMuiIcon(SettingsIcon)
const FileText = asMuiIcon(DescriptionIcon)
const UserPlus = asMuiIcon(PersonAddIcon)
const Package = asMuiIcon(Inventory2Icon)
const Truck = asMuiIcon(LocalShippingIcon)
const Eye = asMuiIcon(VisibilityIcon)
const PencilLine = asMuiIcon(EditIcon)
const SlidersHorizontal = asMuiIcon(TuneIcon)
const Trash2 = asMuiIcon(DeleteIcon)
const BanIcon = asMuiIcon(BlockMuiIcon)
const UnblockIcon = asMuiIcon(CheckCircleOutlineMuiIcon)
const LayoutDashboard = asMuiIcon(DashboardIcon)
const PanelLeftClose = asMuiIcon(KeyboardDoubleArrowLeftIcon)
const PanelLeftOpen = asMuiIcon(KeyboardDoubleArrowRightIcon)
const Tags = asMuiIcon(SellIcon)
const ChevronRight = asMuiIcon(ChevronRightIcon)
const Groups = asMuiIcon(GroupsIcon)
const ExpandMore = asMuiIcon(ExpandMoreIcon)
const ExpandLess = asMuiIcon(ExpandLessIcon)
const ReturnIcon = asMuiIcon(AssignmentReturnIcon)
const ArrowBack = asMuiIcon(ArrowBackMuiIcon)
const PersonIcon = asMuiIcon(PersonMuiIcon)
const PrintIcon = asMuiIcon(PrintMuiIcon)
const HistoryIcon = asMuiIcon(HistoryMuiIcon)

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false, error: null, errorInfo: null }
  }
  static getDerivedStateFromError() {
    return { hasError: true }
  }
  componentDidCatch(error, errorInfo) {
    this.setState({ error, errorInfo })
    console.error('ErrorBoundary', error, errorInfo)
  }
  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: '20px', background: '#ffebee', color: '#c62828' }}>
          <h2>Something went wrong in {this.props.componentName || 'a component'}.</h2>
          <details style={{ whiteSpace: 'pre-wrap' }}>
            {this.state.error && this.state.error.toString()}
            <br />
            {this.state.errorInfo && this.state.errorInfo.componentStack}
          </details>
        </div>
      )
    }
    return this.props.children
  }
}

function safeFormat(dateVal, fmtStr) {
  if (!dateVal) return '--/--'
  try {
    const d = new Date(dateVal)
    if (isNaN(d.getTime())) return '--/--'
    return format(d, withTimeTokens(fmtStr))
  } catch {
    return '--/--'
  }
}

export default function PharmacyPortal() {
  useTimeDisplayMode()
  const nav = useNavigate()
  const location = useLocation()
  const { section: view, purchaseSubView, canonicalPath } = matchPharmacyPath(location.pathname)
  const [medicines, setMedicines] = useState([])
  const [batches, setBatches] = useState([])
  const [invoices, setInvoices] = useState([])
  const [loading, setLoading] = useState(true)
  const [printingInvoice, setPrintingInvoice] = useState(null)
  const [viewInvoiceId, setViewInvoiceId] = useState(null)
  const [cancelInvoice, setCancelInvoice] = useState(null)
  const [registerRefreshToken, setRegisterRefreshToken] = useState(0)
  const [showAddMedicine, setShowAddMedicine] = useState(false)
  const [showAddPatient, setShowAddPatient] = useState(false)
  const [addPatientSeedName, setAddPatientSeedName] = useState('')

  const openAddPatient = useCallback((seedName = '') => {
    setAddPatientSeedName(String(seedName || '').trim())
    setShowAddPatient(true)
  }, [])
  const [outletSettings, setOutletSettings] = useState(null)
  const [billingPatient, setBillingPatient] = useState(null)
  const [draftInvoiceToLoad, setDraftInvoiceToLoad] = useState(null)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => window.innerWidth < 1200)
  const [settingsNavOpen, setSettingsNavOpen] = useState(true)
  const [settingsDirty, setSettingsDirty] = useState(false)
  const [pendingView, setPendingView] = useState(null)
  const [settingsDialogSaving, setSettingsDialogSaving] = useState(false)
  const settingsPanelRef = useRef(null)

  const isSettingsView = (v) => v === 'settings_b2b' || v === 'settings_b2c'

  const goToSection = useCallback(
    (nextSection, subView = null) => {
      if (nextSection === 'purchase' && subView) {
        nav(pathForPurchaseSubView(subView))
      } else {
        nav(pathForSection(nextSection))
      }
    },
    [nav],
  )

  const requestView = useCallback(
    (next) => {
      if (isSettingsView(view) && !isSettingsView(next) && settingsDirty) {
        setPendingView(next)
        return
      }
      goToSection(next)
    },
    [view, settingsDirty, goToSection],
  )

  useEffect(() => {
    if (canonicalPath && location.pathname !== canonicalPath) {
      nav(canonicalPath, { replace: true })
    }
  }, [location.pathname, canonicalPath, nav])

  const mergeCreatedMedicine = useCallback((med) => {
    if (!med?.id) return
    const key = normalizeMedicineId(med.id)
    setMedicines((prev) => {
      if (prev.some((m) => normalizeMedicineId(m.id) === key)) return prev
      return [...prev, med]
    })
  }, [])

  const initialLoadDoneRef = useRef(false)
  // Only the first load blanks the screen; later refreshes keep the current view mounted.
  const fetchInitialData = useCallback(async () => {
    if (!initialLoadDoneRef.current) setLoading(true)
    try {
      await ensurePharmacyBranchContext()
      const [medRows, batchRows, iResp, sResp] = await Promise.all([
        fetchAllPaginated('/medicines/'),
        fetchAllPaginated('/batches/'),
        api.get('/pharmacy/invoices/?limit=100'),
        api.get('/pharmacy/settings/').catch(() => ({ data: null })),
      ])
      setMedicines(medRows)
      setBatches(batchRows)
      setInvoices(iResp.data?.data || iResp.data?.results || [])
      const rawS = sResp.data
      const sd = normalizeOutletSettingsFromApi(rawS) || (rawS?.data ?? rawS?.entity)
      if (sd) setOutletSettings(sd)
    } catch (err) {
      toast.error(err?.message || 'Failed to load pharmacy data')
    } finally {
      initialLoadDoneRef.current = true
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchInitialData()
  }, [fetchInitialData])

  const upsertBatch = useCallback((batch) => {
    if (!batch?.id) return
    setBatches((prev) => {
      const ix = prev.findIndex((b) => String(b.id) === String(batch.id))
      if (ix < 0) return [batch, ...prev]
      const next = [...prev]
      next[ix] = { ...prev[ix], ...batch }
      return next
    })
  }, [])

  const removeBatch = useCallback((batchId) => {
    setBatches((prev) => prev.filter((b) => String(b.id) !== String(batchId)))
  }, [])

  useEffect(() => {
    const onResize = () => {
      setSidebarCollapsed(window.innerWidth < 1200)
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  function handleLogout() {
    useAuthStore.getState().logoutSilent()
    window.location.replace('/login')
  }

  const b2cOutlet = useMemo(
    () => resolveOutletForChannel(outletSettings, 'b2c'),
    [outletSettings],
  )
  const brand = outletSettings?.business_name?.trim() || 'Pharmacy'

  const mergeInvoicePrintMeta = useCallback((invoiceId, meta) => {
    setInvoices((prev) =>
      prev.map((inv) => (inv.id === invoiceId ? { ...inv, ...meta, has_print_copy: !!meta?.has_print_copy } : inv)),
    )
    setPrintingInvoice((prev) =>
      prev && prev.id === invoiceId ? { ...prev, ...meta, has_print_copy: !!meta?.has_print_copy } : prev,
    )
  }, [])

  const openInvoicePreview = useCallback(async (inv, variant = 'original') => {
    try {
      const { data } = await api.get(`/pharmacy/invoices/${inv.id}/`)
      const full = data?.data || data || inv
      setPrintingInvoice({
        ...inv,
        ...full,
        _printVariant: variant,
        party_details:
          full?.party_details ||
          (typeof full?.party === 'object' ? full.party : null) ||
          inv?.party_details ||
          (typeof inv?.party === 'object' ? inv.party : null) ||
          null,
      })
    } catch {
      setPrintingInvoice({ ...inv, _printVariant: variant })
    }
  }, [])

  return (
    <div className="h-screen w-screen flex bg-slate-50 text-slate-900 font-sans overflow-hidden text-[14px]">
      <aside className={`bg-white border-r border-slate-200 flex flex-col shrink-0 transition-all duration-200 ${sidebarCollapsed ? 'w-0 overflow-hidden' : 'w-60'}`}>
        <div className="px-3 py-3 border-b border-slate-200">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 bg-blue-600 rounded flex items-center justify-center text-white text-xs font-bold">
              Rx
            </div>
            <div className="min-w-0">
              <h1 className="text-xs font-bold text-slate-800 truncate leading-tight">{brand}</h1>
              <p className="text-[10px] text-slate-500">ERP</p>
            </div>
          </div>
        </div>

        <nav className="flex-1 py-2 flex flex-col gap-0.5">
          {[
            { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
            { id: 'drafts', label: 'Drafts', icon: FileText },
            { id: 'billing', label: 'Sales', icon: ShoppingBag },
            { id: 'purchase', label: 'Purchase', icon: Truck },
            outletSettings?.b2b_enabled ? { id: 'parties', label: 'Parties', icon: Groups } : null,
            { id: 'inventory', label: 'Inventory', icon: Package },
            { id: 'categories', label: 'Categories', icon: Tags },
            { id: 'history', label: 'Register', icon: FileText },
            { id: 'returns', label: 'Returns', icon: ReturnIcon },
          ].filter(Boolean).map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => requestView(item.id)}
              className={`flex items-center gap-2 px-3 py-2 text-xs font-medium border-l-4 ${
                view === item.id
                  ? 'bg-blue-50 text-blue-700 border-blue-600'
                  : 'text-slate-600 border-transparent hover:bg-slate-50'
              }`}
            >
              <item.icon size={16} />
              {item.label}
            </button>
          ))}
          <div className="mt-0.5">
            <button
              type="button"
              onClick={() => setSettingsNavOpen((o) => !o)}
              className={`w-full flex items-center gap-2 px-3 py-2 text-xs font-medium border-l-4 ${
                view === 'settings_b2b' || view === 'settings_b2c'
                  ? 'bg-blue-50 text-blue-700 border-blue-600'
                  : 'text-slate-600 border-transparent hover:bg-slate-50'
              }`}
            >
              <Settings size={16} />
              <span className="flex-1 text-left">Settings</span>
              {settingsNavOpen ? <ExpandLess size={14} /> : <ExpandMore size={14} />}
            </button>
            {settingsNavOpen && (
              <div className="ml-4 border-l border-slate-100">
                {[
                  { id: 'settings_b2b', label: 'B to B' },
                  { id: 'settings_b2c', label: 'B to C' },
                ].map((sub) => (
                  <button
                    key={sub.id}
                    type="button"
                    onClick={() => requestView(sub.id)}
                    className={`w-full flex items-center gap-2 pl-3 pr-2 py-1.5 text-[11px] font-medium ${
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
            onClick={handleLogout}
            className="flex items-center gap-2 text-slate-600 hover:text-rose-600 text-xs font-medium"
          >
            <LogOut size={16} />
            Logout
          </button>
        </div>
      </aside>

      <div className="flex-1 flex flex-col min-w-0 min-h-0">
        <header className="h-11 bg-white border-b border-slate-200 px-4 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setSidebarCollapsed((v) => !v)}
              className="p-1.5 rounded border border-slate-200 text-slate-600 hover:bg-slate-50"
              title={sidebarCollapsed ? 'Show sidebar' : 'Hide sidebar'}
            >
              {sidebarCollapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
            </button>
            <span className="text-xs font-medium text-slate-500">Terminal · Pharmacy desk</span>
          </div>
          <span className="text-xs text-slate-400">v3.2</span>
        </header>

        <main className="flex-1 overflow-hidden p-3 min-h-0">
          {loading ? (
            <div className="p-6 text-sm text-slate-500">Loading…</div>
          ) : (
            <>
              <ErrorBoundary componentName="PharmacyDashboard">
                {view === 'dashboard' && <PharmacyDashboard />}
              </ErrorBoundary>
              <ErrorBoundary componentName="DraftsView">
                {view === 'drafts' && (
                  <DraftsView
                    onLoadDraft={(draft) => {
                      setDraftInvoiceToLoad(draft)
                      goToSection('billing')
                    }}
                    completedInvoices={invoices}
                    onViewInvoice={(inv) => setViewInvoiceId(inv.id)}
                    onCancelInvoice={setCancelInvoice}
                    onViewInvoicePrint={(inv) => openInvoicePreview(inv, 'original')}
                    onViewInvoicePrinted={(inv) => openInvoicePreview(inv, 'printed')}
                  />
                )}
              </ErrorBoundary>
              <ErrorBoundary componentName="ErpBillingView">
                {view === 'billing' && (
                  <ErpBillingView
                    medicines={medicines}
                    batches={batches}
                    setInvoices={setInvoices}
                    setPrintingInvoice={setPrintingInvoice}
                    setShowAddMedicine={setShowAddMedicine}
                    openAddPatient={openAddPatient}
                    fetchInitialData={fetchInitialData}
                    selectedPt={billingPatient}
                    setSelectedPt={setBillingPatient}
                    outletSettings={outletSettings}
                    draftInvoiceToLoad={draftInvoiceToLoad}
                    setDraftInvoiceToLoad={setDraftInvoiceToLoad}
                  />
                )}
              </ErrorBoundary>
              {view === 'purchase' && (
                <div className="h-full flex flex-col gap-2 min-h-0">
                  <div className="shrink-0 flex gap-1 bg-white border border-slate-200 rounded-lg p-1 w-fit">
                    <button
                      type="button"
                      onClick={() => goToSection('purchase', 'entry')}
                      className={`px-3 py-1.5 rounded-md text-[11px] font-bold ${
                        purchaseSubView === 'entry' ? 'bg-blue-600 text-white' : 'text-slate-600 hover:bg-slate-50'
                      }`}
                    >
                      New challan
                    </button>
                    <button
                      type="button"
                      onClick={() => goToSection('purchase', 'history')}
                      className={`px-3 py-1.5 rounded-md text-[11px] font-bold ${
                        purchaseSubView === 'history' ? 'bg-blue-600 text-white' : 'text-slate-600 hover:bg-slate-50'
                      }`}
                    >
                      Purchase history
                    </button>
                  </div>
                  <div className="flex-1 min-h-0 overflow-hidden">
                    {purchaseSubView === 'entry' ? (
                      <PurchaseChallanPanel onPosted={fetchInitialData} outletSettings={b2cOutlet} />
                    ) : (
                      <PurchaseHistoryDashboard />
                    )}
                  </div>
                </div>
              )}
              <ErrorBoundary componentName="InventoryView">
                {view === 'inventory' && (
                  <InventoryView
                    medicines={medicines}
                    batches={batches}
                    setShowAddMedicine={setShowAddMedicine}
                    fetchInitialData={fetchInitialData}
                    onBatchUpdated={upsertBatch}
                    onBatchRemoved={removeBatch}
                    outletSettings={b2cOutlet}
                  />
                )}
              </ErrorBoundary>
              <ErrorBoundary componentName="PartiesView">
                {view === 'parties' && <PartiesView />}
              </ErrorBoundary>
              <ErrorBoundary componentName="PharmacyCategoriesView">
                {view === 'categories' && <PharmacyCategoriesView batches={batches} />}
              </ErrorBoundary>
              <ErrorBoundary componentName="HistoryView">
                {view === 'history' && (
                  <HistoryView
                    invoices={invoices}
                    medicines={medicines}
                    batches={batches}
                    registerRefreshToken={registerRefreshToken}
                    onViewInvoice={(inv) => setViewInvoiceId(inv.id)}
                    onCancelInvoice={setCancelInvoice}
                    onViewInvoicePrint={(inv) => openInvoicePreview(inv, 'original')}
                    onViewInvoicePrinted={(inv) => openInvoicePreview(inv, 'printed')}
                  />
                )}
              </ErrorBoundary>
              <ErrorBoundary componentName="ReturnView">
                {view === 'returns' && (
                  <ReturnView
                    outletSettings={outletSettings}
                    onPrint={(inv) => openInvoicePreview(inv, 'original')}
                  />
                )}
              </ErrorBoundary>
              {isSettingsView(view) && (
                <SettingsPanel
                  ref={settingsPanelRef}
                  mode={view === 'settings_b2b' ? 'b2b' : 'b2c'}
                  onDirtyChange={setSettingsDirty}
                  onSaved={(f) => setOutletSettings((prev) => ({ ...(prev || {}), ...f }))}
                />
              )}
            </>
          )}
        </main>
      </div>

      <UnsavedSettingsDialog
        open={pendingView != null}
        saving={settingsDialogSaving}
        onCancel={() => setPendingView(null)}
        onDiscard={() => {
          settingsPanelRef.current?.discardChanges()
          const next = pendingView
          setPendingView(null)
          if (next) goToSection(next)
        }}
        onSave={async () => {
          setSettingsDialogSaving(true)
          const ok = await settingsPanelRef.current?.save()
          setSettingsDialogSaving(false)
          if (ok) {
            const next = pendingView
            setPendingView(null)
            if (next) goToSection(next)
          }
        }}
      />

      {printingInvoice && (
        <PharmacyInvoicePrint
          invoice={printingInvoice}
          outlet={outletSettings}
          variant={printingInvoice._printVariant === 'printed' ? 'printed' : 'original'}
          onPrintCopySaved={mergeInvoicePrintMeta}
          onClose={() => setPrintingInvoice(null)}
        />
      )}
      {viewInvoiceId && (
        <PharmacyInvoiceViewModal
          invoiceId={viewInvoiceId}
          onClose={() => setViewInvoiceId(null)}
        />
      )}
      <PharmacyInvoiceCancelModal
        invoice={cancelInvoice}
        onClose={() => setCancelInvoice(null)}
        onSuccess={(updated) => {
          if (updated?.voided) {
            setInvoices((prev) => prev.filter((inv) => inv.id !== updated.id))
          } else if (updated?.id) {
            setInvoices((prev) => prev.map((inv) => inv.id === updated.id ? { ...inv, status: 'cancelled' } : inv))
          }
          fetchInitialData()
          setRegisterRefreshToken((t) => t + 1)
        }}
      />
      {showAddMedicine && (
        <AddMedicineModal
          onClose={() => setShowAddMedicine(false)}
          onRefresh={fetchInitialData}
          onMedicineCreated={mergeCreatedMedicine}
          defaultGstPercent={b2cOutlet?.default_gst_percent}
          defaultSaleDiscountPercent={b2cOutlet?.default_sale_discount_percent}
        />
      )}
      {showAddPatient && (
        <AddPatientModal
          initialSearchName={addPatientSeedName}
          onClose={() => {
            setShowAddPatient(false)
            setAddPatientSeedName('')
          }}
          onAdd={(pt) => {
            const p = pt?.data || pt
            setBillingPatient({
              ...p,
              _walkInBilling: true,
              _billingDoctorName: p?._billingDoctorName || '',
              _billingHospitalName: p?._billingHospitalName || '',
            })
            setShowAddPatient(false)
            setAddPatientSeedName('')
            toast.success('Patient selected for billing')
          }}
        />
      )}
    </div>
  )
}

const INV_ALLOW_NEG_KEY = 'pharmacy_inventory_allow_negative_stock'
/** Matches API LargeLimitOffsetPagination.max_limit (inventory lists). */
const INVENTORY_LIST_PAGE_SIZE = 2000

function normalizeMedicineId(id) {
  const raw = String(id ?? '').trim().toLowerCase()
  if (!raw) return ''
  const hex = raw.replace(/-/g, '')
  if (hex.length === 32) {
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
  }
  return raw
}

function extractListPageRows(res) {
  const body = res?.data
  if (!body) return []
  if (Array.isArray(body)) return body
  if (Array.isArray(body.data)) return body.data
  if (Array.isArray(body.results)) return body.results
  if (body.data && Array.isArray(body.data.results)) return body.data.results
  if (body.entity && Array.isArray(body.entity)) return body.entity
  if (body.entity && Array.isArray(body.entity.results)) return body.entity.results
  return []
}

async function fetchAllPaginated(path) {
  const all = []
  let offset = 0
  for (;;) {
    const res = await api.get(`${path}?limit=${INVENTORY_LIST_PAGE_SIZE}&offset=${offset}`)
    const rows = extractListPageRows(res)
    if (!rows.length) break
    all.push(...rows)
    if (rows.length < INVENTORY_LIST_PAGE_SIZE) break
    offset += INVENTORY_LIST_PAGE_SIZE
    if (offset > 100_000) break
  }
  return all
}

function buildMedicineByIdMap(medicines) {
  const map = new Map()
  for (const m of medicines) {
    if (!m?.id) continue
    map.set(normalizeMedicineId(m.id), m)
  }
  return map
}

function batchMedicineId(batch) {
  const m = batch?.medicine
  if (m == null || m === '') return ''
  if (typeof m === 'object') return normalizeMedicineId(m.id)
  return normalizeMedicineId(m)
}

function productNameForBatch(batch, medicineById) {
  const fromBatch = String(batch?.medicine_name ?? '').trim()
  if (fromBatch) return fromBatch
  const id = batchMedicineId(batch)
  const mapped = id ? medicineById.get(id) : null
  const fromMap = String(mapped?.name ?? '').trim()
  return fromMap || '—'
}

function medicineForBatch(batch, medicineById) {
  const id = batchMedicineId(batch)
  const mapped = id ? medicineById.get(id) : null
  if (mapped) return mapped
  const name = productNameForBatch(batch, medicineById)
  if (name === '—' && !id) return null
  return {
    id: id || undefined,
    name: name === '—' ? '' : name,
    pack_info: '',
    unit_name: 'unit',
    form: '',
    unit_conversions: {},
  }
}

function expiryRowClass(expiryDate) {
  if (!expiryDate) return 'text-slate-500'
  const d = new Date(expiryDate)
  if (Number.isNaN(d.getTime())) return 'text-slate-500'
  const days = (d.getTime() - Date.now()) / 86400000
  if (days < 0) return 'text-rose-600 font-semibold'
  if (days <= 90) return 'text-amber-700 font-medium'
  return 'text-slate-600'
}

function isLowStockRow(qty, threshold) {
  const q = Number(qty) || 0
  const t = Number(threshold) > 0 ? Number(threshold) : 10
  return q < t
}

/** Prefer box > carton > strip; label matches JSON key (e.g. strip, box). */
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

/**
 * Human-readable stock: pack + remainder only when there is a real multi-pack (>1 base per pack).
 * If pack size is 1 (e.g. 1x1), show base count only — avoids misleading "50 strips" when strip = 1 tablet.
 */
function formatPackAndBaseStock(baseQty, perPack, packLabel, baseLabel) {
  const q = Number(baseQty) || 0
  const pp = Number(perPack) || 0
  const bl = (baseLabel || 'unit').toLowerCase()
  const pl = (packLabel || 'pack').toLowerCase()
  if (q <= 0) return `0 ${bl}`
  if (!(pp > 1)) {
    const n = q % 1 === 0 ? q : Number(q.toFixed(2))
    return `${n} ${bl}`
  }
  const packs = Math.floor(q / pp)
  const rem = Math.round((q - packs * pp) * 100) / 100
  const parts = []
  if (packs > 0) parts.push(`${packs} ${pl}${packs === 1 ? '' : 's'}`)
  if (rem > 0) parts.push(`${rem % 1 === 0 ? rem : Number(rem.toFixed(2))} ${bl}`)
  return parts.length ? parts.join(' + ') : `0 ${bl}`
}

/**
 * Labels for inventory qty display — same source as Add Medicine opening stock
 * (`resolveCategoryRules` → base_unit_label / retail_pack_label), falling back to `medicine.unit_name`.
 */
function inventoryQtyLabels(medicine, categoryRows = []) {
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

function normalizeStockLedgerList(res) {
  const raw = res?.data
  if (!raw) return []
  if (Array.isArray(raw)) return raw
  const inner = raw.data ?? raw.entity ?? raw
  if (Array.isArray(inner)) return inner
  if (Array.isArray(inner?.results)) return inner.results
  return []
}

function sortLedgerChronological(rows) {
  return [...(rows || [])].sort((a, b) => {
    const ta = new Date(a.created_at || 0).getTime()
    const tb = new Date(b.created_at || 0).getTime()
    return ta - tb
  })
}

/** Human label for a stock ledger row (inventory UI). */
function formatStockLedgerLabel(r) {
  const rt = String(r.reference_type || '').toLowerCase()
  if (rt === 'opening_stock') return 'Initial stock'
  if (r.reason === 'stock_in' && rt === 'pharmacy_purchase_challan') return 'Purchase (stock in)'
  if (r.reason === 'stock_in') return 'Stock in'
  if (r.reason === 'return_in') return 'Return in'
  if (r.reason === 'dispense_out') return 'Dispense out'
  if (r.reason === 'adjust') {
    return r.reference_id ? `Adjustment · ${r.reference_id}` : 'Adjustment'
  }
  return r.reason || '—'
}

function InventoryView({
  medicines,
  batches,
  setShowAddMedicine,
  fetchInitialData,
  onBatchUpdated,
  onBatchRemoved,
  outletSettings,
}) {
  const PAGE_SIZE = 15
  const [q, setQ] = useState('')
  const [invTab, setInvTab] = useState('all')
  const [page, setPage] = useState(0)
  const [lowStockItems, setLowStockItems] = useState([])
  const [lowStockLoading, setLowStockLoading] = useState(false)
  const [allowNegative, setAllowNegative] = useState(() => localStorage.getItem(INV_ALLOW_NEG_KEY) === '1')
  const [detailBatch, setDetailBatch] = useState(null)
  const [rateBatch, setRateBatch] = useState(null)
  const [adjustBatch, setAdjustBatch] = useState(null)
  const [deletingBatchId, setDeletingBatchId] = useState(null)
  const [blockBatch, setBlockBatch] = useState(null)
  const [medicineCategoryRows, setMedicineCategoryRows] = useState([])
  const [lowStockReload, setLowStockReload] = useState(0)

  const refreshBatch = useCallback(
    async (batchId) => {
      setLowStockReload((n) => n + 1)
      try {
        const res = await api.get(`/batches/${batchId}/`)
        const body = res.data
        const fresh = body?.id ? body : body?.data?.id ? body.data : body?.entity
        if (fresh?.id && onBatchUpdated) {
          onBatchUpdated(fresh)
          return
        }
      } catch {
        /* fall back to a full reload below */
      }
      fetchInitialData?.()
    },
    [onBatchUpdated, fetchInitialData],
  )

  useEffect(() => {
    let cancelled = false
    api
      .get('/medicine-categories/?limit=5000')
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

  useEffect(() => {
    try {
      localStorage.setItem(INV_ALLOW_NEG_KEY, allowNegative ? '1' : '0')
    } catch {
      /* ignore */
    }
  }, [allowNegative])

  useEffect(() => {
    if (invTab !== 'low_stock') return
    let cancelled = false
    setLowStockLoading(true)
    api
      .get('/medicines/low-stock/')
      .then((res) => {
        if (cancelled) return
        const rows = res.data?.data || res.data?.results || res.data || []
        setLowStockItems(Array.isArray(rows) ? rows : [])
      })
      .catch(() => { if (!cancelled) setLowStockItems([]) })
      .finally(() => { if (!cancelled) setLowStockLoading(false) })
    return () => { cancelled = true }
  }, [invTab, lowStockReload])

  const qLower = q.toLowerCase()
  const medicineById = buildMedicineByIdMap(medicines)
  const { idToRow: invCatIdToRow } = React.useMemo(
    () => buildMedicineCategoryLookups(medicineCategoryRows),
    [medicineCategoryRows],
  )
  const medIdsWithBatch = new Set(batches.map((b) => batchMedicineId(b)).filter(Boolean))

  function categoryPathForMedicine(med) {
    if (!med?.category) return '—'
    const path = categoryPathLabel(med.category, invCatIdToRow)
    return path ? path.replace(/ › /g, '>') : '—'
  }

  const filtered = batches
    .filter((b) => {
      const name = productNameForBatch(b, medicineById).toLowerCase()
      const bn = (b.batch_no ?? '').toLowerCase()
      return name.includes(qLower) || bn.includes(qLower)
    })
    .sort((a, b) => {
      const ta = new Date(a?.created_at || 0).getTime()
      const tb = new Date(b?.created_at || 0).getTime()
      return tb - ta
    })

  // Only show catalogue rows with no batch when searching — otherwise deleting the last
  // batch would leave the product stuck in the table as "No batch" with no way to clear it visually.
  const medicinesWithoutBatch = medicines.filter((m) => {
    if (medIdsWithBatch.has(String(m.id))) return false
    if (!qLower) return false
    return (
      (m.name || '').toLowerCase().includes(qLower) ||
      (m.name_on_bill || '').toLowerCase().includes(qLower) ||
      (m.sku || '').toLowerCase().includes(qLower)
    )
  })

  const inventoryRows = useMemo(() => {
    const rows = filtered.map((batch) => ({ kind: 'batch', batch }))
    for (const medicine of medicinesWithoutBatch) {
      rows.push({ kind: 'medicine', medicine })
    }
    return rows
  }, [filtered, medicinesWithoutBatch])

  const total = inventoryRows.length
  const pagedInventoryRows = useMemo(
    () => inventoryRows.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE),
    [inventoryRows, page],
  )

  useEffect(() => {
    setPage(0)
  }, [q, invTab])

  useEffect(() => {
    const maxPage = Math.max(0, Math.ceil(total / PAGE_SIZE) - 1)
    if (page > maxPage) setPage(maxPage)
  }, [total, page])

  async function handleDeleteBatch(batch, med) {
    const medName = med?.name || productNameForBatch(batch, medicineById) || 'this item'
    const ok = window.confirm(
      `Delete inventory batch ${batch.batch_no || ''} for ${medName}?\n\nThis removes the batch record from inventory.`,
    )
    if (!ok) return
    setDeletingBatchId(String(batch.id))
    try {
      await api.delete(`/batches/${batch.id}/`)
      toast.success('Inventory batch deleted')
      if (onBatchRemoved) onBatchRemoved(batch.id)
      else fetchInitialData?.()
      setLowStockReload((n) => n + 1)
    } catch (e) {
      toast.error(parseApiError(e) || 'Could not delete inventory batch')
    } finally {
      setDeletingBatchId(null)
    }
  }

  function handleToggleBlockBatch(batch, med) {
    setBlockBatch({ batch, medicine: med })
  }

  return (
    <div className="h-full flex flex-col gap-2 overflow-hidden min-w-0">
      <div className="flex flex-wrap items-center justify-between gap-2 shrink-0">
        <div className="flex items-center gap-2">
          <h2 className="text-base font-bold text-slate-900">Inventory</h2>
          <span className="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-600">
            {invTab === 'low_stock' ? lowStockItems.length : total} items
          </span>
          {/* Tab bar */}
          <div className="flex items-center gap-0.5 ml-2 bg-slate-100 rounded-lg p-0.5">
            <button
              type="button"
              onClick={() => {
                setInvTab('all')
                setPage(0)
              }}
              className={`px-3 py-1 rounded-md text-[11px] font-semibold transition-colors ${invTab === 'all' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
            >
              All
            </button>
            <button
              type="button"
              onClick={() => {
                setInvTab('low_stock')
                setPage(0)
              }}
              className={`px-3 py-1 rounded-md text-[11px] font-semibold transition-colors flex items-center gap-1 ${invTab === 'low_stock' ? 'bg-white text-amber-700 shadow-sm' : 'text-slate-500 hover:text-amber-600'}`}
            >
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-amber-500" />
              Low Stock
            </button>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-1.5 text-[10px] text-slate-600 cursor-pointer">
            <input
              type="checkbox"
              checked={allowNegative}
              onChange={(e) => setAllowNegative(e.target.checked)}
            />
            Allow negative stock (adjust)
          </label>
          <button
            type="button"
            onClick={() => setShowAddMedicine(true)}
            className="border border-blue-200 bg-blue-50 text-blue-700 px-2.5 py-1 rounded text-[11px] font-semibold hover:bg-blue-100"
          >
            + Medicine
          </button>
        </div>
      </div>

      {/* Low Stock Tab */}
      {invTab === 'low_stock' && (
        <div className="flex-1 bg-white border border-slate-200 rounded overflow-hidden flex flex-col min-h-0 min-w-0">
          {lowStockLoading ? (
            <div className="flex items-center justify-center h-full text-xs text-slate-400">Loading…</div>
          ) : lowStockItems.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full gap-2 text-slate-400">
              <span className="text-2xl">✓</span>
              <p className="text-xs font-semibold">No medicines below the low stock threshold ({outletSettings?.low_stock_threshold ?? 10} units)</p>
            </div>
          ) : (
            <div className="flex-1 overflow-y-auto overflow-x-hidden min-h-0">
              <table className="w-full text-left text-[11px] table-fixed border-collapse">
                <thead className="bg-slate-100 sticky top-0 z-10 font-bold text-slate-600 uppercase">
                  <tr>
                    <th className="px-2 py-1.5 w-[30%]">Medicine</th>
                    <th className="px-2 py-1.5 w-[12%]">SKU</th>
                    <th className="px-2 py-1.5 w-[10%] text-right">Total Stock</th>
                    <th className="px-2 py-1.5 w-[10%] text-right">Threshold</th>
                    <th className="px-2 py-1.5">Batches</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {lowStockItems.map((item) => (
                    <tr key={item.id} className="bg-amber-50/40 hover:bg-amber-50">
                      <td className="px-2 py-2 align-top font-semibold text-slate-900">
                        {item.name}
                        {item.pack_info ? <span className="ml-1 text-[10px] text-slate-400 font-normal">{item.pack_info}</span> : null}
                      </td>
                      <td className="px-2 py-2 align-top text-slate-500 font-mono">{item.sku || '—'}</td>
                      <td className="px-2 py-2 align-top text-right tabular-nums font-bold text-amber-700">
                        {item.total_stock}
                      </td>
                      <td className="px-2 py-2 align-top text-right tabular-nums text-slate-500">
                        {item.threshold}
                      </td>
                      <td className="px-2 py-2 align-top">
                        <div className="flex flex-wrap gap-1">
                          {item.batches.length === 0 ? (
                            <span className="text-slate-400">No batches</span>
                          ) : item.batches.map((b) => (
                            <span key={b.id} className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium border ${b.expiry_status === 'expired' ? 'bg-rose-50 border-rose-200 text-rose-700' : b.expiry_status === 'expiring' ? 'bg-amber-50 border-amber-200 text-amber-800' : 'bg-slate-50 border-slate-200 text-slate-700'}`}>
                              <span className="font-mono">{b.batch_no}</span>
                              <span>·</span>
                              <span>{b.quantity}</span>
                              {b.expiry_date && <span className="opacity-70">{b.expiry_date.slice(0,7)}</span>}
                            </span>
                          ))}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* All Inventory Tab */}
      {invTab === 'all' && (
      <div className="flex-1 bg-white border border-slate-200 rounded overflow-hidden flex flex-col min-h-0 min-w-0">
        <div className="px-3 py-2 border-b border-slate-100 flex items-center gap-2 bg-slate-50/70 shrink-0">
          <Search size={14} className="text-slate-400 shrink-0" />
          <input
            value={q}
            onChange={(e) => {
              setPage(0)
              setQ(e.target.value)
            }}
            placeholder="Search name / batch (includes products with no batch)"
            className="flex-1 bg-transparent text-[12px] font-medium outline-none min-w-0"
          />
        </div>
        <div className="flex-1 overflow-y-auto overflow-x-hidden min-h-0">
          <table className="w-full text-left text-[11px] table-fixed border-collapse">
            <thead className="bg-slate-100 sticky top-0 z-10 font-bold text-slate-600 uppercase">
              <tr>
                <th className="px-2 py-1.5 w-[14%]">Product</th>
                <th className="px-2 py-1.5 w-[12%]">Category</th>
                <th className="px-2 py-1.5 w-[8%]">Batch</th>
                <th className="px-2 py-1.5 w-[8%]">Expiry</th>
                <th className="px-2 py-1.5 w-[16%]">Stock</th>
                <th className="px-2 py-1.5 w-[7%] text-right">MRP</th>
                <th className="px-2 py-1.5 w-[7%] text-right">Sale</th>
                <th className="px-2 py-1.5 w-[7%] text-right">Pur.</th>
                <th className="px-2 py-1.5 w-[14%] text-center">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {pagedInventoryRows.map((row) => {
                if (row.kind === 'batch') {
                  const b = row.batch
                  const med = medicineForBatch(b, medicineById)
                  const productName = productNameForBatch(b, medicineById)
                  const { baseLabel, packLabel, perPack } = inventoryQtyLabels(med, medicineCategoryRows)
                  const qty = Number(b.quantity ?? 0)
                  const stockLabel = formatPackAndBaseStock(qty, perPack, packLabel, baseLabel)
                  const low = isLowStockRow(qty, outletSettings?.low_stock_threshold)
                  const expCls = expiryRowClass(b.expiry_date)
                  return (
                    <tr
                      key={b.id}
                      className={`hover:bg-slate-50 ${low ? 'bg-amber-50/50' : ''} ${qty < 0 ? 'bg-rose-50/70' : ''}`}
                    >
                      <td className="px-2 py-1 align-top min-w-0">
                        <div className="font-semibold text-slate-900 truncate" title={productName}>
                          {productName}
                        </div>
                        <div className="text-[10px] text-slate-400 truncate">{med?.pack_info}</div>
                      </td>
                      <td className="px-2 py-1 align-top min-w-0 text-[10px] text-slate-600 truncate" title={categoryPathForMedicine(med)}>
                        {categoryPathForMedicine(med)}
                      </td>
                      <td className="px-2 py-1 align-top min-w-0">
                        <span className="font-mono text-[10px] bg-slate-100 px-1 py-0.5 rounded inline-block max-w-full truncate" title={b.batch_no}>
                          {b.batch_no}
                        </span>
                        {b.is_sale_blocked && (
                          <span
                            className="mt-0.5 block w-fit text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-rose-100 text-rose-700 border border-rose-200"
                            title={b.sale_block_reason || 'Blocked for sale'}
                          >
                            Blocked
                          </span>
                        )}
                      </td>
                      <td className={`px-2 py-1 align-top tabular-nums ${expCls}`}>{safeFormat(b.expiry_date, 'MM/yy')}</td>
                      <td className="px-2 py-1 align-top text-emerald-800 font-medium leading-tight break-words">
                        <div>{stockLabel}</div>
                        {perPack > 1 && (
                          <div className="text-[9px] text-slate-400 font-mono tabular-nums">
                            {qty % 1 === 0 ? qty : qty.toFixed(2)} {baseLabel} (base)
                          </div>
                        )}
                        {qty < 0 && <div className="text-[9px] text-rose-600 font-semibold">Below zero</div>}
                        {low && qty >= 0 && <div className="text-[9px] text-amber-700">Low stock</div>}
                      </td>
                      <td className="px-2 py-1 text-right tabular-nums text-slate-700">₹{Number(b.mrp ?? 0).toFixed(2)}</td>
                      <td className="px-2 py-1 text-right tabular-nums text-blue-700 font-semibold">₹{Number(b.sale_rate ?? 0).toFixed(2)}</td>
                      <td className="px-2 py-1 text-right tabular-nums text-slate-500">₹{Number(b.unit_cost ?? 0).toFixed(2)}</td>
                      <td className="px-1 py-1 align-top">
                        <div className="flex flex-wrap items-center justify-center gap-1">
                          <button
                            type="button"
                            title="View details"
                            onClick={() => setDetailBatch({ batch: b, medicine: med })}
                            className="p-1 rounded border border-slate-200 text-slate-600 hover:bg-slate-100"
                          >
                            <Eye size={12} />
                          </button>
                          <button
                            type="button"
                            title="Edit rate"
                            onClick={() => setRateBatch({ batch: b, medicine: med })}
                            className="p-1 rounded border border-slate-200 text-slate-600 hover:bg-slate-100"
                          >
                            <PencilLine size={12} />
                          </button>
                          <button
                            type="button"
                            title="Adjust stock"
                            onClick={() => setAdjustBatch({ batch: b, medicine: med })}
                            className="p-1 rounded border border-slate-200 text-slate-600 hover:bg-slate-100"
                          >
                            <SlidersHorizontal size={12} />
                          </button>
                          <button
                            type="button"
                            title={b.is_sale_blocked ? 'Unblock for sale' : 'Block for sale'}
                            onClick={() => handleToggleBlockBatch(b, med)}
                            className={`p-1 rounded border disabled:opacity-50 disabled:cursor-not-allowed ${
                              b.is_sale_blocked
                                ? 'border-emerald-200 text-emerald-700 hover:bg-emerald-50'
                                : 'border-amber-200 text-amber-700 hover:bg-amber-50'
                            }`}
                          >
                            {b.is_sale_blocked ? <UnblockIcon size={12} /> : <BanIcon size={12} />}
                          </button>
                          <button
                            type="button"
                            title="Delete inventory"
                            disabled={deletingBatchId === String(b.id)}
                            onClick={() => handleDeleteBatch(b, med)}
                            className="p-1 rounded border border-rose-200 text-rose-600 hover:bg-rose-50 disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            <Trash2 size={12} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                }

                const m = row.medicine
                return (
                  <tr key={`no-batch-${m.id}`} className="bg-sky-50/30 hover:bg-sky-50/60">
                    <td className="px-2 py-1 align-top min-w-0">
                      <div className="font-semibold text-slate-900 truncate" title={m.name}>
                        {m.name || '—'}
                      </div>
                      <div className="text-[10px] text-slate-400 truncate">{m.pack_info}</div>
                    </td>
                    <td className="px-2 py-1 align-top min-w-0 text-[10px] text-slate-600 truncate" title={categoryPathForMedicine(m)}>
                      {categoryPathForMedicine(m)}
                    </td>
                    <td className="px-2 py-1 align-top text-[10px]">
                      <span className="inline-block rounded bg-amber-100 text-amber-800 px-1.5 py-0.5 font-semibold">
                        No batch
                      </span>
                    </td>
                    <td className="px-2 py-1 align-top text-slate-400">--/--</td>
                    <td className="px-2 py-1 align-top text-slate-500">Add batch to start stock</td>
                    <td className="px-2 py-1 text-right tabular-nums text-slate-700">₹{Number(m.default_mrp ?? 0).toFixed(2)}</td>
                    <td className="px-2 py-1 text-right tabular-nums text-slate-500">₹0.00</td>
                    <td className="px-2 py-1 text-right tabular-nums text-slate-500">₹0.00</td>
                    <td className="px-1 py-1 align-top">
                      <div className="flex items-center justify-center">
                        <button
                          type="button"
                          onClick={() => toast('Create purchase/batch entry for this medicine')}
                          className="px-2 py-1 rounded border border-blue-200 bg-white text-[10px] font-semibold text-blue-700 hover:bg-blue-50"
                        >
                          Add Batch
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })}
              {total === 0 && (
                <tr>
                  <td colSpan={9} className="px-2 py-6 text-center text-[11px] text-slate-500">
                    No inventory records found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="shrink-0 flex items-center justify-between text-xs text-slate-600 px-3 py-2 border-t border-slate-100 bg-slate-50/70">
          <span>
            {total === 0 ? 'No records' : `Showing ${page * PAGE_SIZE + 1}-${Math.min((page + 1) * PAGE_SIZE, total)} of ${total}`}
          </span>
          <div className="flex gap-1">
            <button
              type="button"
              disabled={page === 0}
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              className="px-2 py-1 rounded border border-slate-200 disabled:opacity-40"
            >
              Prev
            </button>
            <button
              type="button"
              disabled={(page + 1) * PAGE_SIZE >= total}
              onClick={() => setPage((p) => p + 1)}
              className="px-2 py-1 rounded border border-slate-200 disabled:opacity-40"
            >
              Next
            </button>
          </div>
        </div>
      </div>
      )}

      {detailBatch && (
        <InventoryBatchDetailModal
          batch={detailBatch.batch}
          medicine={detailBatch.medicine}
          medicineCategoryRows={medicineCategoryRows}
          onClose={() => setDetailBatch(null)}
        />
      )}
      {rateBatch && (
        <InventoryEditRateModal
          batch={rateBatch.batch}
          medicine={rateBatch.medicine}
          customCategories={medicineCategoryRows}
          onClose={() => setRateBatch(null)}
          onSaved={() => {
            const id = rateBatch.batch.id
            setRateBatch(null)
            refreshBatch(id)
            fetchInitialData?.()
          }}
        />
      )}
      {adjustBatch && (
        <InventoryAdjustStockModal
          batch={adjustBatch.batch}
          medicine={adjustBatch.medicine}
          medicineCategoryRows={medicineCategoryRows}
          allowNegative={allowNegative}
          onClose={() => setAdjustBatch(null)}
          onSaved={() => {
            const id = adjustBatch.batch.id
            setAdjustBatch(null)
            refreshBatch(id)
          }}
        />
      )}
      {blockBatch && (
        <InventoryBlockBatchModal
          batch={blockBatch.batch}
          medicine={blockBatch.medicine}
          productName={productNameForBatch(blockBatch.batch, medicineById)}
          medicineCategoryRows={medicineCategoryRows}
          onClose={() => setBlockBatch(null)}
          onSaved={() => {
            const id = blockBatch.batch.id
            setBlockBatch(null)
            refreshBatch(id)
          }}
        />
      )}
    </div>
  )
}

const BLOCK_REASON_PRESETS = ['Recall', 'Damaged', 'Quarantine', 'Supplier return', 'Quality check']

function InventoryBlockBatchModal({ batch, medicine, productName, medicineCategoryRows = [], onClose, onSaved }) {
  const blocking = !batch.is_sale_blocked
  const [reason, setReason] = useState('')
  const [saving, setSaving] = useState(false)
  const { baseLabel, packLabel, perPack } = inventoryQtyLabels(medicine, medicineCategoryRows)
  const qty = Number(batch.quantity ?? 0)
  const stockLabel = formatPackAndBaseStock(qty, perPack, packLabel, baseLabel)

  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape' && !saving) onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose, saving])

  async function save() {
    setSaving(true)
    try {
      await api.patch(`/batches/${batch.id}/`, {
        is_sale_blocked: blocking,
        sale_block_reason: blocking ? reason.trim().slice(0, 120) : '',
      })
      toast.success(blocking ? `Batch ${batch.batch_no} blocked for sale` : `Batch ${batch.batch_no} is sellable again`)
      onSaved?.()
    } catch (e) {
      toast.error(parseApiError(e) || 'Could not update batch')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div
      className="fixed inset-0 bg-slate-900/40 z-[200] flex items-center justify-center p-4"
      onClick={() => !saving && onClose()}
      role="presentation"
    >
      <div
        className="bg-white rounded-lg shadow-xl w-full max-w-sm border border-slate-200 p-3"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={blocking ? 'Block batch for sale' : 'Unblock batch'}
      >
        <div className="flex justify-between items-center mb-2">
          <h3 className={`text-xs font-bold flex items-center gap-1.5 ${blocking ? 'text-rose-700' : 'text-emerald-700'}`}>
            {blocking ? <BanIcon size={14} /> : <UnblockIcon size={14} />}
            {blocking ? 'Block batch for sale' : 'Unblock batch'}
          </h3>
          <button type="button" onClick={onClose} disabled={saving} className="text-slate-400 hover:text-slate-700">
            <X size={16} />
          </button>
        </div>

        <div className="space-y-2 text-[10px]">
          <div className="grid grid-cols-2 gap-2">
            <div className="col-span-2 min-w-0">
              <span className="text-slate-500">Medicine</span>
              <div className="font-semibold text-slate-900 truncate" title={productName || medicine?.name}>
                {productName || medicine?.name || '—'}
              </div>
            </div>
            <div>
              <span className="text-slate-500">Batch</span>
              <div className="font-mono">{batch.batch_no}</div>
            </div>
            <div>
              <span className="text-slate-500">Expiry</span>
              <div className="font-mono">{safeFormat(batch.expiry_date, 'dd/MM/yyyy')}</div>
            </div>
            <div className="col-span-2">
              <span className="text-slate-500">Current stock</span>
              <div className="font-semibold text-emerald-800">{stockLabel}</div>
            </div>
          </div>

          {blocking ? (
            <>
              <div className="rounded border border-rose-100 bg-rose-50 px-2 py-1.5 text-rose-800 leading-snug">
                This batch will stay in inventory with its stock, but it will <b>not be available for billing</b>. It
                will appear greyed out under “out-of-stock / blocked batches” on the sales screen. Returns against old
                bills are still allowed.
              </div>
              <div>
                <span className="text-[9px] font-semibold text-slate-600">Reason (optional)</span>
                <div className="mt-1 flex flex-wrap gap-1">
                  {BLOCK_REASON_PRESETS.map((p) => (
                    <button
                      key={p}
                      type="button"
                      onClick={() => setReason(p)}
                      className={`px-2 py-0.5 rounded-full border text-[10px] font-medium transition-colors ${
                        reason === p
                          ? 'bg-rose-600 border-rose-600 text-white'
                          : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                      }`}
                    >
                      {p}
                    </button>
                  ))}
                </div>
                <textarea
                  value={reason}
                  onChange={(e) => setReason(e.target.value.slice(0, 120))}
                  rows={2}
                  autoFocus
                  className="mt-1.5 w-full border border-slate-200 rounded px-2 py-1 text-xs resize-none"
                  placeholder="e.g. Manufacturer recall notice, broken strips…"
                />
                <div className="text-right text-[9px] text-slate-400">{reason.length}/120</div>
              </div>
            </>
          ) : (
            <>
              <div className="rounded border border-slate-200 bg-slate-50 px-2 py-1.5">
                <span className="text-slate-500">Blocked because</span>
                <div className="font-semibold text-slate-800">{batch.sale_block_reason || 'No reason given'}</div>
              </div>
              <div className="rounded border border-emerald-100 bg-emerald-50 px-2 py-1.5 text-emerald-800 leading-snug">
                After unblocking, this batch will be <b>available for billing again</b>
                {qty > 0 ? ' and will appear in the sales search.' : ', but it has no stock so it will stay in the out-of-stock section.'}
              </div>
            </>
          )}
        </div>

        <div className="flex gap-2 mt-3">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="flex-1 py-1.5 rounded border border-slate-200 text-[10px] font-semibold disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={save}
            className={`flex-1 py-1.5 rounded text-white text-[10px] font-semibold disabled:opacity-50 ${
              blocking ? 'bg-rose-600 hover:bg-rose-700' : 'bg-emerald-600 hover:bg-emerald-700'
            }`}
          >
            {saving ? 'Saving…' : blocking ? 'Block for sale' : 'Unblock batch'}
          </button>
        </div>
      </div>
    </div>
  )
}

function InventoryBatchDetailModal({ batch, medicine, medicineCategoryRows = [], onClose }) {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    api
      .get(`/stock-ledgers/?batch=${batch.id}&limit=80`)
      .then((res) => {
        const list = sortLedgerChronological(normalizeStockLedgerList(res))
        if (!cancelled) setRows(list)
      })
      .catch(() => {
        if (!cancelled) setRows([])
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [batch.id])

  const { baseLabel, packLabel, perPack } = inventoryQtyLabels(medicine, medicineCategoryRows)
  const qty = Number(batch.quantity ?? 0)

  return (
    <div className="fixed inset-0 bg-slate-900/40 z-[200] flex items-center justify-center p-4" onClick={onClose} role="presentation">
      <div
        className="bg-white rounded-lg shadow-xl max-w-lg w-full max-h-[85vh] overflow-hidden flex flex-col border border-slate-200"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Batch details"
      >
        <div className="px-3 py-2 border-b border-slate-100 flex justify-between items-center shrink-0">
          <h3 className="text-xs font-bold text-slate-800">Batch details</h3>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-700">
            <X size={16} />
          </button>
        </div>
        <div className="p-3 overflow-y-auto text-[10px] space-y-2">
          <dl className="grid grid-cols-2 gap-x-2 gap-y-1">
            <dt className="text-slate-500">Medicine</dt>
            <dd className="font-semibold text-slate-900">{medicine?.name ?? batch?.medicine_name ?? '—'}</dd>
            <dt className="text-slate-500">Batch</dt>
            <dd className="font-mono">{batch.batch_no}</dd>
            <dt className="text-slate-500">Expiry</dt>
            <dd className={expiryRowClass(batch.expiry_date)}>{safeFormat(batch.expiry_date, 'dd MMM yyyy')}</dd>
            <dt className="text-slate-500">Stock</dt>
            <dd>
              {formatPackAndBaseStock(qty, perPack, packLabel, baseLabel)}
              {perPack > 1 && (
                <span className="text-slate-400 ml-1 font-mono">
                  ({qty % 1 === 0 ? qty : qty.toFixed(2)} {baseLabel})
                </span>
              )}
            </dd>
            <dt className="text-slate-500">MRP</dt>
            <dd className="tabular-nums">₹{Number(batch.mrp ?? 0).toFixed(2)}</dd>
            <dt className="text-slate-500">Sale rate</dt>
            <dd className="tabular-nums">₹{Number(batch.sale_rate ?? 0).toFixed(2)}</dd>
            <dt className="text-slate-500">Purchase (cost)</dt>
            <dd className="tabular-nums text-slate-600">₹{Number(batch.unit_cost ?? 0).toFixed(2)}</dd>
          </dl>
          <div className="pt-2 border-t border-slate-100">
            <div className="text-[9px] font-bold text-slate-500 uppercase mb-1">Stock log (recent)</div>
            {loading && <div className="text-slate-400">Loading…</div>}
            {!loading && rows.length === 0 && <div className="text-slate-400">No ledger rows.</div>}
            {!loading && rows.length > 0 && (
              <ul className="space-y-1 max-h-40 overflow-y-auto">
                {rows.map((r) => (
                  <li key={r.id} className="flex justify-between gap-2 border-b border-slate-50 pb-0.5">
                    <span className="text-slate-600 truncate">
                      <span className="font-semibold text-slate-700">{formatStockLedgerLabel(r)}</span>
                      {r.created_at && (
                        <span className="text-slate-400 font-normal ml-1">
                          · {safeFormat(r.created_at, 'dd MMM yy HH:mm')}
                        </span>
                      )}
                    </span>
                    <span className={`font-mono shrink-0 ${Number(r.qty_change) < 0 ? 'text-rose-600' : 'text-emerald-700'}`}>
                      {Number(r.qty_change) > 0 ? '+' : ''}
                      {r.qty_change}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
        <div className="px-3 py-2 border-t border-slate-100">
          <button type="button" onClick={onClose} className="w-full py-1.5 rounded bg-slate-100 text-[10px] font-semibold text-slate-700">
            Close
          </button>
        </div>
      </div>
    </div>
  )
}

function InventoryEditRateModal({ batch, medicine, customCategories = [], onClose, onSaved }) {
  // Pack size for unit ↔ strip conversion
  const { perPack: packSize, label: packLabel } = preferredPackFromConversions(medicine?.unit_conversions)

  // Per-unit → display value in the currently selected pricing mode
  function toDisplay(unitVal, mode, ps) {
    const n = Number(unitVal) || 0
    return mode === 'strip' && ps > 1 ? (n * ps).toFixed(2) : n.toFixed(2)
  }

  // Display value → per-unit value for saving
  function toUnit(displayVal, mode, ps) {
    const n = Number(displayVal) || 0
    return mode === 'strip' && ps > 1 ? n / ps : n
  }

  const [pricingMode, setPricingMode] = useState(
    () => localStorage.getItem('inventory_pricing_mode') || 'unit'
  )

  const [nickname, setNickname] = useState(String(medicine?.name ?? ''))
  const [nameOnBill, setNameOnBill] = useState(String(medicine?.name_on_bill ?? ''))
  const [mrp, setMrp] = useState(() => toDisplay(batch.mrp ?? 0, localStorage.getItem('inventory_pricing_mode') || 'unit', packSize))
  const [sale, setSale] = useState(() => toDisplay(batch.sale_rate ?? 0, localStorage.getItem('inventory_pricing_mode') || 'unit', packSize))
  const [cost, setCost] = useState(() => toDisplay(batch.unit_cost ?? 0, localStorage.getItem('inventory_pricing_mode') || 'unit', packSize))
  const [saving, setSaving] = useState(false)

  function switchPricingMode(newMode) {
    if (newMode === pricingMode) return
    // Convert currently displayed values to the new mode
    setMrp(toDisplay(toUnit(mrp, pricingMode, packSize), newMode, packSize))
    setSale(toDisplay(toUnit(sale, pricingMode, packSize), newMode, packSize))
    setCost(toDisplay(toUnit(cost, pricingMode, packSize), newMode, packSize))
    setPricingMode(newMode)
    localStorage.setItem('inventory_pricing_mode', newMode)
  }

  const priceLabel = pricingMode === 'strip' && packSize > 1
    ? `₹ / ${packLabel || 'strip'}`
    : '₹'

  // Category picker state — mirrors AddMedicineModal
  const [pickerOpen, setPickerOpen] = useState(false)
  const [pickerSearch, setPickerSearch] = useState('')
  const [expandedCatIds, setExpandedCatIds] = useState(() => new Set())

  const { idToRow, childrenOf, roots } = React.useMemo(
    () => buildMedicineCategoryLookups(customCategories),
    [customCategories],
  )

  const [categoryPathIds, setCategoryPathIds] = useState(() => {
    const catId = medicine?.category ? String(medicine.category) : ''
    if (!catId) return []
    return categoryAncestorsPath(catId, (() => {
      const m = new Map()
      customCategories.forEach((c) => { if (c?.id) m.set(String(c.id), c) })
      return m
    })())
  })

  const breadcrumb = React.useMemo(
    () => categoryPathIds.map((id) => idToRow.get(id)?.name || '').filter(Boolean).join(' › '),
    [categoryPathIds, idToRow],
  )

  // Sorted flat list with full path labels for "ALL CATEGORY NAMES" section
  const allFlatOptions = React.useMemo(() => {
    return customCategories
      .map((row) => ({
        id: String(row.id),
        label: categoryPathLabel(row.id, idToRow) || row.name || '',
        name: row.name || '',
      }))
      .sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: 'base' }))
  }, [customCategories, idToRow])

  const filteredOptions = React.useMemo(() => {
    const q = pickerSearch.trim().toLowerCase()
    if (!q) return allFlatOptions
    return allFlatOptions.filter((o) => o.label.toLowerCase().includes(q))
  }, [allFlatOptions, pickerSearch])

  useEffect(() => {
    if (!pickerOpen) return undefined
    function onKey(e) { if (e.key === 'Escape') setPickerOpen(false) }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [pickerOpen])

  useEffect(() => {
    if (!pickerOpen) return
    setExpandedCatIds(() => {
      const next = new Set()
      categoryPathIds.slice(0, -1).forEach((id) => next.add(String(id)))
      return next
    })
  }, [pickerOpen]) // eslint-disable-line react-hooks/exhaustive-deps

  function selectCatRow(row) {
    if (!row?.id) return
    setCategoryPathIds(categoryAncestorsPath(row.id, idToRow))
    setPickerOpen(false)
    setPickerSearch('')
  }

  function toggleCatExpand(id) {
    setExpandedCatIds((prev) => {
      const next = new Set(prev)
      if (next.has(String(id))) next.delete(String(id))
      else next.add(String(id))
      return next
    })
  }

  async function save() {
    const trimmedNick = (nickname || '').trim()
    if (!trimmedNick) {
      toast.error('Nick name is required')
      return
    }
    setSaving(true)
    try {
      await api.patch(`/batches/${batch.id}/`, {
        mrp:       toUnit(mrp,  pricingMode, packSize),
        sale_rate: toUnit(sale, pricingMode, packSize),
        unit_cost: toUnit(cost, pricingMode, packSize),
      })
      const leafId = categoryPathIds.length ? categoryPathIds[categoryPathIds.length - 1] : null
      await api.patch(`/medicines/${medicine.id}/`, {
        name: trimmedNick,
        name_on_bill: (nameOnBill || '').trim(),
        category: leafId || null,
      })
      toast.success('Updated')
      onSaved?.()
    } catch (e) {
      toast.error(parseApiError(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-slate-900/40 z-[200] flex items-center justify-center p-4" onClick={onClose} role="presentation">
      <div
        className="bg-white rounded-lg shadow-xl w-full max-w-sm border border-slate-200 p-3 space-y-3"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Edit medicine"
      >
        <div className="flex justify-between items-center">
          <h3 className="text-xs font-bold text-slate-800">Edit medicine</h3>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-700">
            <X size={16} />
          </button>
        </div>
        <p className="text-[9px] text-slate-500 truncate font-mono">{batch.batch_no}</p>

        <div>
          <p className="text-[9px] font-bold text-slate-500 uppercase tracking-wide mb-1.5">Medicine names</p>
          <label className="block mb-2">
            <span className="text-[9px] font-semibold text-slate-600">Nick name</span>
            <input
              value={nickname}
              onChange={(e) => setNickname(e.target.value)}
              className="mt-0.5 w-full border border-slate-200 rounded px-2 py-1 text-xs"
            />
          </label>
          <label className="block">
            <span className="text-[9px] font-semibold text-slate-600">Name on bill (optional)</span>
            <input
              value={nameOnBill}
              onChange={(e) => setNameOnBill(e.target.value)}
              placeholder="Uses nick name on bill if empty"
              className="mt-0.5 w-full border border-slate-200 rounded px-2 py-1 text-xs"
            />
          </label>
        </div>

        {/* Rates */}
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <p className="text-[9px] font-bold text-slate-500 uppercase tracking-wide">Rates</p>
            {packSize > 1 && (
              <div className="flex gap-0.5 bg-slate-100 border border-slate-200 rounded p-0.5">
                <button
                  type="button"
                  onClick={() => switchPricingMode('unit')}
                  className={`px-2 py-0.5 rounded text-[9px] font-bold transition-colors ${
                    pricingMode === 'unit' ? 'bg-blue-600 text-white' : 'text-slate-600 hover:bg-slate-200'
                  }`}
                >
                  Unit
                </button>
                <button
                  type="button"
                  onClick={() => switchPricingMode('strip')}
                  className={`px-2 py-0.5 rounded text-[9px] font-bold transition-colors capitalize ${
                    pricingMode === 'strip' ? 'bg-blue-600 text-white' : 'text-slate-600 hover:bg-slate-200'
                  }`}
                >
                  {packLabel || 'Strip'}
                </button>
              </div>
            )}
          </div>
          <p className="text-[9px] text-amber-800 bg-amber-50 border border-amber-100 rounded px-1.5 py-1 mb-2">
            {packSize > 1 && pricingMode === 'strip'
              ? `Prices per ${packLabel || 'strip'} (${packSize} units). Saved as per-unit.`
              : 'Stock, batch and expiry come from purchase / system.'}
          </p>
          <label className="block mb-2">
            <span className="text-[9px] font-semibold text-slate-600">MRP ({priceLabel})</span>
            <input
              value={mrp}
              onChange={(e) => setMrp(e.target.value)}
              className="mt-0.5 w-full border border-slate-200 rounded px-2 py-1 text-xs tabular-nums"
              inputMode="decimal"
            />
          </label>
          <label className="block mb-2">
            <span className="text-[9px] font-semibold text-slate-600">Sale rate ({priceLabel})</span>
            <input
              value={sale}
              onChange={(e) => setSale(e.target.value)}
              className="mt-0.5 w-full border border-slate-200 rounded px-2 py-1 text-xs tabular-nums"
              inputMode="decimal"
            />
          </label>
          <label className="block">
            <span className="text-[9px] font-semibold text-slate-600">Cost price ({priceLabel})</span>
            <input
              value={cost}
              onChange={(e) => setCost(e.target.value)}
              className="mt-0.5 w-full border border-slate-200 rounded px-2 py-1 text-xs tabular-nums"
              inputMode="decimal"
            />
          </label>
        </div>

        {/* Category — same popup as Add Medicine */}
        <div>
          <p className="text-[9px] font-bold text-slate-500 uppercase tracking-wide mb-1.5">Category</p>
          <button
            type="button"
            onClick={() => setPickerOpen((o) => !o)}
            className="w-full flex items-center justify-between gap-2 min-h-8 border border-slate-300 rounded px-2 py-1 text-[11px] text-left bg-white hover:bg-slate-50 outline-none focus:border-blue-500"
          >
            <span className="truncate text-slate-800">{breadcrumb || 'Browse categories…'}</span>
            <ChevronRight size={14} className="text-slate-400 shrink-0" sx={{ transform: 'rotate(90deg)' }} />
          </button>
          {breadcrumb && (
            <button
              type="button"
              onClick={() => setCategoryPathIds([])}
              className="mt-0.5 text-[9px] text-rose-500 hover:underline"
            >
              Clear
            </button>
          )}
        </div>

        <div className="flex gap-2 pt-1">
          <button type="button" onClick={onClose} className="flex-1 py-1.5 rounded border border-slate-200 text-[10px] font-semibold">
            Cancel
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={save}
            className="flex-1 py-1.5 rounded bg-blue-600 text-white text-[10px] font-semibold disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>

      {/* Category picker popup — same as Add Medicine */}
      {pickerOpen && createPortal(
        <div
          className="fixed inset-0 z-[400] flex items-center justify-center p-4 bg-slate-900/45"
          onClick={() => setPickerOpen(false)}
          role="presentation"
        >
          <div
            className="flex h-[min(85vh,32rem)] w-full max-w-lg flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="inv-cat-picker-title"
          >
            <div className="flex shrink-0 items-center justify-between gap-2 border-b border-slate-100 px-3 py-2">
              <h4 id="inv-cat-picker-title" className="text-sm font-bold text-slate-900">Select category</h4>
              <button type="button" onClick={() => setPickerOpen(false)} className="rounded p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-800">
                <X size={18} />
              </button>
            </div>
            <div className="shrink-0 border-b border-slate-100 p-2">
              <input
                type="text"
                value={pickerSearch}
                onChange={(e) => setPickerSearch(e.target.value)}
                placeholder="Search all names or browse lists below…"
                className="h-7 w-full rounded border border-slate-200 px-2 text-[11px]"
                autoFocus
              />
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto py-1">
              {pickerSearch.trim() ? (
                filteredOptions.length === 0 ? (
                  <div className="px-3 py-4 text-[11px] text-slate-500">No matches</div>
                ) : (
                  filteredOptions.map((opt) => (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => selectCatRow(idToRow.get(opt.id))}
                      className="w-full border-b border-slate-50 px-3 py-1.5 text-left text-[11px] text-slate-800 last:border-b-0 hover:bg-slate-50"
                    >
                      <span className="block truncate" title={opt.label}>{opt.label}</span>
                    </button>
                  ))
                )
              ) : (
                <div className="flex flex-col gap-0">
                  {roots.length > 0 && (
                    <>
                      <div className="px-3 pb-0.5 pt-1 text-[9px] font-bold uppercase tracking-wide text-slate-500">Nested folders</div>
                      <CategoryPickerTreeRows
                        nodes={roots}
                        depth={0}
                        childrenOf={childrenOf}
                        expandedIds={expandedCatIds}
                        onToggleExpand={toggleCatExpand}
                        onSelectRow={selectCatRow}
                      />
                      <div className="mx-2 my-2 border-t border-slate-100" />
                    </>
                  )}
                  <div className="px-3 pb-0.5 pt-1 text-[9px] font-bold uppercase tracking-wide text-slate-500">
                    All category names (presets · medicines · folders)
                  </div>
                  {allFlatOptions.length === 0 ? (
                    <div className="px-3 py-2 text-[11px] text-slate-500">No labels loaded</div>
                  ) : (
                    allFlatOptions.map((opt) => (
                      <button
                        key={`flat-${opt.id}`}
                        type="button"
                        onClick={() => selectCatRow(idToRow.get(opt.id))}
                        className="w-full border-b border-slate-50 px-3 py-1.5 text-left text-[11px] text-slate-800 last:border-b-0 hover:bg-slate-50"
                      >
                        <span className="block truncate" title={opt.label}>{opt.label}</span>
                      </button>
                    ))
                  )}
                </div>
              )}
            </div>
          </div>
        </div>,
        document.body,
      )}
    </div>
  )
}

function InventoryAdjustStockModal({ batch, medicine, medicineCategoryRows = [], allowNegative, onClose, onSaved }) {
  const [adjustQty, setAdjustQty] = useState('')
  const [reason, setReason] = useState('')
  const [saving, setSaving] = useState(false)
  const [ledgerRows, setLedgerRows] = useState([])
  const [ledgerLoading, setLedgerLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    setLedgerLoading(true)
    api
      .get(`/stock-ledgers/?batch=${batch.id}&limit=80`)
      .then((res) => {
        const list = sortLedgerChronological(normalizeStockLedgerList(res))
        if (!cancelled) setLedgerRows(list)
      })
      .catch(() => {
        if (!cancelled) setLedgerRows([])
      })
      .finally(() => {
        if (!cancelled) setLedgerLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [batch.id])

  const current = Number(batch.quantity ?? 0)
  const { baseLabel: stockBaseLabel } = inventoryQtyLabels(medicine, medicineCategoryRows)
  const adj = adjustQty === '' || adjustQty === '-' ? 0 : Number(adjustQty)
  const projected = current + (Number.isFinite(adj) ? adj : 0)
  const invalidAdj = !Number.isFinite(adj) || adj === 0

  async function save() {
    if (!reason.trim()) {
      toast.error('Enter a reason for the adjustment')
      return
    }
    if (invalidAdj) {
      toast.error('Enter a non-zero adjustment (+ or −)')
      return
    }
    if (projected < 0 && !allowNegative) {
      toast.error('Would result in negative stock. Enable “Allow negative stock” or reduce the deduction.')
      return
    }
    setSaving(true)
    try {
      await api.post('/stock-ledgers/', {
        medicine: batch.medicine,
        batch: batch.id,
        reason: 'adjust',
        qty_change: String(adj),
        reference_type: 'inventory_adjust',
        reference_id: reason.trim().slice(0, 100),
        allow_negative_stock: allowNegative,
      })
      toast.success('Stock adjustment saved')
      try {
        const res = await api.get(`/stock-ledgers/?batch=${batch.id}&limit=80`)
        setLedgerRows(sortLedgerChronological(normalizeStockLedgerList(res)))
      } catch {
        /* ignore */
      }
      onSaved?.()
    } catch (e) {
      toast.error(parseApiError(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-slate-900/40 z-[200] flex items-center justify-center p-4" onClick={onClose} role="presentation">
      <div
        className="bg-white rounded-lg shadow-xl w-full max-w-sm border border-slate-200 p-3"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Adjust stock"
      >
        <div className="flex justify-between items-center mb-2">
          <h3 className="text-xs font-bold text-slate-800">Adjust stock</h3>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-700">
            <X size={16} />
          </button>
        </div>
        <div className="space-y-2 text-[10px]">
          <div>
            <span className="text-slate-500">Medicine</span>
            <div className="font-semibold text-slate-900 truncate">{medicine?.name ?? '—'}</div>
          </div>
          <div>
            <span className="text-slate-500">Batch</span>
            <div className="font-mono">{batch.batch_no}</div>
          </div>
          <div>
            <span className="text-slate-500">Current stock</span>
            <div className="font-mono font-semibold text-emerald-800">
              {current % 1 === 0 ? current : current.toFixed(3)} <span className="font-sans font-medium">{stockBaseLabel}</span>
            </div>
          </div>
          <div className="rounded border border-slate-100 bg-slate-50/80 px-2 py-1.5">
            <div className="text-[9px] font-bold text-slate-500 uppercase mb-1">Stock history</div>
            {ledgerLoading && <div className="text-slate-400 text-[10px]">Loading…</div>}
            {!ledgerLoading && ledgerRows.length === 0 && (
              <div className="text-slate-400 text-[10px]">No movements yet.</div>
            )}
            {!ledgerLoading && ledgerRows.length > 0 && (
              <ul className="space-y-1 max-h-32 overflow-y-auto text-[10px]">
                {ledgerRows.map((r) => (
                  <li key={r.id} className="flex justify-between gap-2 border-b border-slate-100/80 pb-0.5 last:border-0">
                    <span className="text-slate-600 min-w-0 truncate">
                      <span
                        className={
                          String(r.reference_type || '').toLowerCase() === 'opening_stock'
                            ? 'font-semibold text-indigo-800'
                            : 'font-medium text-slate-800'
                        }
                      >
                        {formatStockLedgerLabel(r)}
                      </span>
                      {r.created_at && (
                        <span className="text-slate-400 font-normal"> · {safeFormat(r.created_at, 'dd MMM yy HH:mm')}</span>
                      )}
                    </span>
                    <span
                      className={`font-mono shrink-0 ${Number(r.qty_change) < 0 ? 'text-rose-600' : 'text-emerald-700'}`}
                    >
                      {Number(r.qty_change) > 0 ? '+' : ''}
                      {r.qty_change}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <label className="block">
            <span className="text-[9px] font-semibold text-slate-600">
              Adjust qty (+ in / − out) · {stockBaseLabel}
            </span>
            <input
              value={adjustQty}
              onChange={(e) => setAdjustQty(e.target.value)}
              className="mt-0.5 w-full border border-slate-200 rounded px-2 py-1 text-xs font-mono"
              placeholder="e.g. -5 or 10"
              inputMode="decimal"
            />
          </label>
          <div className="rounded border border-slate-100 bg-slate-50 px-2 py-1">
            <span className="text-slate-500">New stock</span>
            <div className={`font-mono font-semibold ${projected < 0 ? 'text-rose-600' : 'text-slate-900'}`}>
              {Number.isFinite(projected) ? (projected % 1 === 0 ? projected : projected.toFixed(3)) : '—'}{' '}
              <span className="font-sans font-medium">{stockBaseLabel}</span>
            </div>
            {projected < 0 && !allowNegative && (
              <div className="text-[9px] text-rose-600 mt-0.5">Blocked: negative not allowed (see toolbar toggle).</div>
            )}
            {projected < 0 && allowNegative && (
              <div className="text-[9px] text-amber-700 mt-0.5">Warning: stock will be negative.</div>
            )}
          </div>
          <label className="block">
            <span className="text-[9px] font-semibold text-slate-600">Reason *</span>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={2}
              className="mt-0.5 w-full border border-slate-200 rounded px-2 py-1 text-xs resize-none"
              placeholder="e.g. Physical count variance, breakage…"
            />
          </label>
        </div>
        <div className="flex gap-2 mt-3">
          <button type="button" onClick={onClose} className="flex-1 py-1.5 rounded border border-slate-200 text-[10px] font-semibold">
            Cancel
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={save}
            className="flex-1 py-1.5 rounded bg-emerald-600 text-white text-[10px] font-semibold disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save adjustment'}
          </button>
        </div>
      </div>
    </div>
  )
}

function HistoryView({
  invoices: _invoices,
  medicines: portalMedicines = [],
  batches: portalBatches = [],
  registerRefreshToken = 0,
  onViewInvoice,
  onCancelInvoice,
  onViewInvoicePrint,
  onViewInvoicePrinted,
}) {
  const PAGE_SIZE = 15
  const [subView, setSubView] = useState('register')
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(false)
  const [page, setPage] = useState(0)
  const [total, setTotal] = useState(0)
  const [q, setQ] = useState('')
  const [editInv, setEditInv] = useState(null)
  const [pendingRows, setPendingRows] = useState([])
  const [pendingMeta, setPendingMeta] = useState({ total_pending_amount: '0.00', total_patients: 0 })
  const [pendingLoading, setPendingLoading] = useState(false)
  const [clearCreditBill, setClearCreditBill] = useState(null)
  const [clearPaymentMethod, setClearPaymentMethod] = useState('cash')
  const [clearingCredit, setClearingCredit] = useState(false)

  const fetchRows = useCallback(async () => {
    setLoading(true)
    try {
      const { data } = await api.get('/pharmacy/invoices/', {
        params: { limit: PAGE_SIZE, offset: page * PAGE_SIZE, search: q || undefined },
      })
      setRows(data?.data || data?.results || [])
      setTotal(Number(data?.count || data?.meta?.total || 0))
    } catch {
      toast.error('Failed to load sale register')
      setRows([])
      setTotal(0)
    } finally {
      setLoading(false)
    }
  }, [page, q])

  useEffect(() => {
    if (subView === 'register') fetchRows()
  }, [fetchRows, subView, registerRefreshToken])

  const fetchPendingRows = useCallback(async () => {
    setPendingLoading(true)
    try {
      const { data } = await api.get('/pharmacy/invoices/pending-credits/', {
        params: { search: q || undefined },
      })
      setPendingRows(data?.data || [])
      setPendingMeta({
        total_pending_amount: data?.meta?.total_pending_amount || '0.00',
        total_patients: Number(data?.meta?.total_patients || 0),
      })
    } catch {
      toast.error('Failed to load pending credit list')
      setPendingRows([])
      setPendingMeta({ total_pending_amount: '0.00', total_patients: 0 })
    } finally {
      setPendingLoading(false)
    }
  }, [q])

  useEffect(() => {
    if (subView === 'pending') fetchPendingRows()
  }, [fetchPendingRows, subView])

  const confirmClearCredit = useCallback(async () => {
    if (!clearCreditBill?.bill?.id) return
    setClearingCredit(true)
    try {
      await api.post(`/pharmacy/invoices/${clearCreditBill.bill.id}/clear-credit/`, {
        payment_method: clearPaymentMethod,
      })
      toast.success('Pending credit cleared')
      setClearCreditBill(null)
      setClearPaymentMethod('cash')
      fetchPendingRows()
    } catch (err) {
      toast.error(parseApiError(err, 'Failed to clear pending credit'))
    } finally {
      setClearingCredit(false)
    }
  }, [clearCreditBill, clearPaymentMethod, fetchPendingRows])

  return (
    <div className="h-full flex flex-col gap-3 overflow-hidden min-h-0 bg-gradient-to-br from-slate-50 via-white to-indigo-50/40 rounded-xl p-3">
      <div className="flex items-center justify-between gap-2 shrink-0">
        <div className="flex items-center gap-2">
          <h2 className="text-base font-bold text-slate-900">Pharmacy register</h2>
          <div className="flex gap-1 bg-white border border-slate-200 rounded-lg p-1">
            <button
              type="button"
              onClick={() => {
                setSubView('register')
                setPage(0)
              }}
              className={`px-2.5 py-1 rounded text-[10px] font-bold ${
                subView === 'register' ? 'bg-blue-600 text-white' : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              Sale register
            </button>
            <button
              type="button"
              onClick={() => setSubView('pending')}
              className={`px-2.5 py-1 rounded text-[10px] font-bold ${
                subView === 'pending' ? 'bg-blue-600 text-white' : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              Pending credit
            </button>
          </div>
        </div>
        <div className="relative w-full max-w-xs">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" size={14} />
          <input
            value={q}
            onChange={(e) => {
              setPage(0)
              setQ(e.target.value)
            }}
            placeholder={subView === 'pending' ? 'Search patient / UHID / invoice' : 'Search invoice / patient'}
            className="w-full rounded-lg border border-slate-200 bg-white pl-8 pr-2 py-1.5 text-xs outline-none focus:border-blue-500"
          />
        </div>
      </div>

      {subView === 'register' ? (
        <div className="flex-1 bg-white border border-slate-200 rounded-xl overflow-y-auto min-h-0 shadow-sm">
          <table className="w-full text-left text-[11px]">
            <thead className="bg-gradient-to-b from-slate-100 to-slate-50 sticky top-0 z-10 text-[10px] font-bold text-slate-500 uppercase">
              <tr>
                <th className="px-3 py-2">Invoice</th>
                <th className="px-3 py-2">Customer</th>
                <th className="px-3 py-2">Method</th>
                <th className="px-3 py-2 text-right">Paid</th>
                <th className="px-3 py-2 text-right">Due</th>
                <th className="px-3 py-2 text-right">Total</th>
                <th className="px-3 py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr><td colSpan={7} className="px-3 py-8 text-center text-slate-400">Loading…</td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={7} className="px-3 py-8 text-center text-slate-400">No invoices found</td></tr>
              ) : rows.map((inv) => {
                const totalAmt = Number(inv.grand_total || 0)
                const paidAmt = Number(inv.paid_amount || 0)
                const dueAmt = Math.max(0, Number(inv.due_amount ?? totalAmt - paidAmt))
                const isCancelled = inv.status === 'cancelled'
                const isFinalized = inv.status === 'finalized'
                const isB2B = Boolean(inv?.party)
                const party = inv?.party_details || (typeof inv?.party === 'object' ? inv.party : null)
                const customerName = isB2B
                  ? (party?.name || inv?.party_name || inv?.party_name_snapshot || '—')
                  : `${inv?.patient_details?.first_name || ''} ${inv?.patient_details?.last_name || ''}`.trim() || '—'
                const partyBits = []
                if (party?.phone) partyBits.push(`Phone: ${party.phone}`)
                if (party?.gst_number) partyBits.push(`GSTIN: ${party.gst_number}`)
                if (party?.address) partyBits.push(`Address: ${party.address}`)
                return (
                  <tr key={inv.id} className={isCancelled ? 'bg-red-50/70' : 'hover:bg-indigo-50/30'}>
                    <td className="px-3 py-2">
                      <div className="text-blue-700 font-mono text-[10px]">#{inv.invoice_no}</div>
                      {isCancelled && (
                        <span className="text-[9px] font-bold text-red-700">Cancelled (view only)</span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <div className="font-medium">{customerName}</div>
                      {isB2B ? (
                        <div className="text-[10px] text-slate-500 break-words">
                          {partyBits.length ? partyBits.join(' · ') : 'Party details unavailable'}
                        </div>
                      ) : null}
                      <div className="text-[10px] text-slate-400">{safeFormat(inv.created_at, 'dd MMM yy HH:mm')}</div>
                    </td>
                    <td className="px-3 py-2">
                      <span className="text-[10px] uppercase font-bold bg-slate-100 border border-slate-200 px-1.5 py-0.5 rounded">
                        {inv.payment_method || 'cash'}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right font-semibold text-emerald-700">₹{paidAmt.toFixed(2)}</td>
                    <td className="px-3 py-2 text-right font-semibold text-amber-700">₹{dueAmt.toFixed(2)}</td>
                    <td className="px-3 py-2 text-right font-semibold">₹{totalAmt.toFixed(2)}</td>
                    <td className="px-3 py-2">
                      <div className="flex justify-end flex-wrap gap-1">
                        <button
                          type="button"
                          onClick={() => onViewInvoice?.(inv)}
                          className="px-2 py-1 rounded-md border border-indigo-200 bg-indigo-50 text-indigo-700 text-[10px] font-semibold"
                        >
                          View
                        </button>
                        {!isCancelled && (
                          <button
                            type="button"
                            onClick={() => onViewInvoicePrint?.(inv)}
                            className="px-2 py-1 rounded-md border border-blue-200 bg-blue-50 text-blue-700 text-[10px] font-semibold"
                          >
                            Print
                          </button>
                        )}
                        {!isCancelled && inv.has_print_copy ? (
                          <button
                            type="button"
                            onClick={() => onViewInvoicePrinted?.(inv)}
                            className="px-2 py-1 rounded-md border border-violet-200 bg-violet-50 text-violet-700 text-[10px] font-semibold"
                          >
                            Printed
                          </button>
                        ) : null}
                        {!isCancelled && (
                          <button
                            type="button"
                            onClick={() => setEditInv(inv)}
                            className="px-2 py-1 rounded-md border border-amber-200 bg-amber-50 text-amber-700 text-[10px] font-semibold"
                          >
                            Edit
                          </button>
                        )}
                        {isFinalized && (
                          <button
                            type="button"
                            onClick={() => onCancelInvoice?.(inv)}
                            className="px-2 py-1 rounded-md border border-red-200 bg-red-50 text-red-700 text-[10px] font-semibold"
                          >
                            Cancel
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="flex-1 bg-white border border-slate-200 rounded-xl overflow-y-auto min-h-0 shadow-sm p-3">
          <div className="mb-3 flex items-center justify-between">
            <div className="text-xs text-slate-500">Patients with pending pharmacy credit</div>
            <div className="text-sm font-bold text-rose-700">
              Total pending: ₹{Number(pendingMeta.total_pending_amount || 0).toFixed(2)}
            </div>
          </div>
          {pendingLoading ? (
            <div className="px-3 py-8 text-center text-slate-400 text-sm">Loading pending credits…</div>
          ) : pendingRows.length === 0 ? (
            <div className="px-3 py-8 text-center text-slate-400 text-sm">No pending credit bills found</div>
          ) : (
            <div className="space-y-3">
              {pendingRows.map((pt) => (
                <div key={pt.patient_id} className="border border-slate-200 rounded-lg overflow-hidden">
                  <div className="bg-slate-50 px-3 py-2 flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <div className="font-semibold text-slate-900">{pt.patient_name}</div>
                      <div className="text-[10px] text-slate-500">
                        UHID: {pt.uhid || '—'}{pt.phone ? ` · ${pt.phone}` : ''} · Bills: {pt.bill_count}
                      </div>
                    </div>
                    <div className="text-sm font-bold text-amber-700">
                      ₹{Number(pt.total_pending_amount || 0).toFixed(2)}
                    </div>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-[11px]">
                      <thead className="bg-white text-[10px] uppercase text-slate-500">
                        <tr>
                          <th className="px-3 py-2">Invoice</th>
                          <th className="px-3 py-2">Date</th>
                          <th className="px-3 py-2 text-right">Total</th>
                          <th className="px-3 py-2 text-right">Paid</th>
                          <th className="px-3 py-2 text-right">Due</th>
                          <th className="px-3 py-2 text-right">Action</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {(pt.bills || []).map((bill) => (
                          <tr key={bill.id}>
                            <td className="px-3 py-2 font-mono text-blue-700">#{bill.invoice_no}</td>
                            <td className="px-3 py-2 text-slate-600">{safeFormat(bill.date, 'dd MMM yyyy')}</td>
                            <td className="px-3 py-2 text-right">₹{Number(bill.grand_total || 0).toFixed(2)}</td>
                            <td className="px-3 py-2 text-right">₹{Number(bill.paid_amount || 0).toFixed(2)}</td>
                            <td className="px-3 py-2 text-right font-semibold text-amber-700">
                              ₹{Number(bill.due_amount || 0).toFixed(2)}
                            </td>
                            <td className="px-3 py-2 text-right">
                              <button
                                type="button"
                                onClick={() => {
                                  setClearPaymentMethod('cash')
                                  setClearCreditBill({
                                    bill,
                                    patientName: pt.patient_name,
                                    patientUhid: pt.uhid,
                                  })
                                }}
                                className="px-2 py-1 rounded-md text-[10px] font-bold bg-emerald-600 text-white hover:bg-emerald-700"
                              >
                                Clear due
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {subView === 'register' ? (
        <div className="shrink-0 flex items-center justify-between text-xs text-slate-600">
          <span>
            {total === 0 ? 'No records' : `Showing ${page * PAGE_SIZE + 1}-${Math.min((page + 1) * PAGE_SIZE, total)} of ${total}`}
          </span>
          <div className="flex gap-1">
            <button
              type="button"
              disabled={page === 0}
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              className="px-2 py-1 rounded border border-slate-200 disabled:opacity-40"
            >
              Prev
            </button>
            <button
              type="button"
              disabled={(page + 1) * PAGE_SIZE >= total}
              onClick={() => setPage((p) => p + 1)}
              className="px-2 py-1 rounded border border-slate-200 disabled:opacity-40"
            >
              Next
            </button>
          </div>
        </div>
      ) : (
        <div className="shrink-0 text-xs text-slate-600">
          {pendingMeta.total_patients || 0} patient(s) with pending credit
        </div>
      )}

      {editInv ? (
        <EditSaleInvoiceModal
          invoice={editInv}
          initialMedicines={portalMedicines}
          initialBatches={portalBatches}
          onClose={() => setEditInv(null)}
          onSaved={() => {
            setEditInv(null)
            fetchRows()
          }}
        />
      ) : null}

      {clearCreditBill ? (
        <div className="fixed inset-0 z-[1200] flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm"
            onClick={() => { if (!clearingCredit) setClearCreditBill(null) }}
          />
          <div className="relative z-10 bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
            <div className="px-4 py-3 bg-emerald-600 text-white flex items-center justify-between">
              <h3 className="font-bold text-sm">Clear pending credit</h3>
              <button
                type="button"
                onClick={() => { if (!clearingCredit) setClearCreditBill(null) }}
                className="text-white/80 hover:text-white"
                disabled={clearingCredit}
              >
                <X size={16} />
              </button>
            </div>
            <div className="p-4 space-y-3">
              <p className="text-sm text-slate-700">
                Clear pending credit for invoice{' '}
                <span className="font-bold text-slate-900">#{clearCreditBill.bill.invoice_no}</span>
                {' '}of patient{' '}
                <span className="font-semibold">{clearCreditBill.patientName}</span>
                {clearCreditBill.patientUhid ? ` (${clearCreditBill.patientUhid})` : ''}?
              </p>
              <p className="text-sm font-semibold text-amber-700">
                Due amount: ₹{Number(clearCreditBill.bill.due_amount || 0).toFixed(2)}
              </p>
              <label className="block">
                <span className="text-[10px] font-semibold text-slate-500 uppercase">Payment method</span>
                <select
                  value={clearPaymentMethod}
                  onChange={(e) => setClearPaymentMethod(e.target.value)}
                  disabled={clearingCredit}
                  className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm bg-white"
                >
                  <option value="cash">Cash</option>
                  <option value="upi">UPI</option>
                  <option value="card">Card</option>
                  <option value="bank_transfer">Bank transfer</option>
                  <option value="other">Other</option>
                </select>
              </label>
              <p className="text-xs text-slate-500">
                This will mark the bill as fully paid and remove it from the pending credit list.
              </p>
              <div className="flex justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setClearCreditBill(null)}
                  disabled={clearingCredit}
                  className="px-3 py-1.5 rounded-lg border border-slate-200 text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={confirmClearCredit}
                  disabled={clearingCredit}
                  className="px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-xs font-bold hover:bg-emerald-700 disabled:opacity-50"
                >
                  {clearingCredit ? 'Clearing…' : 'Yes, clear due'}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}

function patientDisplayName(p) {
  if (!p) return ''
  return [p.first_name, p.middle_name, p.last_name].filter(Boolean).join(' ').trim()
}

function invoiceDateTimeInputToIso(dateValue, timeValue) {
  if (!dateValue) return null
  const normalizedTime = timeValue || '00:00'
  const d = new Date(`${dateValue}T${normalizedTime}`)
  if (Number.isNaN(d.getTime())) return null
  return d.toISOString()
}

function invoiceInstantParts(value) {
  const d = value ? new Date(value) : new Date()
  if (Number.isNaN(d.getTime())) {
    const now = new Date()
    return { date: format(now, 'yyyy-MM-dd'), time: format(now, 'HH:mm') }
  }
  return { date: format(d, 'yyyy-MM-dd'), time: format(d, 'HH:mm') }
}

const EDIT_PAYMENT_METHODS = [
  { value: 'cash', label: 'Cash' },
  { value: 'upi', label: 'UPI' },
  { value: 'card', label: 'Card' },
  { value: 'bank_transfer', label: 'Bank transfer' },
  { value: 'other', label: 'Other' },
  { value: 'credit', label: 'Credit' },
]

function EditSaleInvoiceModal({ invoice, onClose, onSaved, initialMedicines = [], initialBatches = [] }) {
  const patientInfo = invoice?.patient_details || {}
  const initialName = patientDisplayName(patientInfo)
  const [paymentMethod, setPaymentMethod] = useState(invoice.payment_method || 'cash')
  const [paidAmount, setPaidAmount] = useState(String(invoice.paid_amount ?? invoice.grand_total ?? '0'))
  const [remarks, setRemarks] = useState(invoice.remarks || '')
  const initialDiscount = Number(invoice.total_discount || 0)
  const [discountInput, setDiscountInput] = useState(initialDiscount > 0 ? String(initialDiscount) : '')
  const [afterDiscountInput, setAfterDiscountInput] = useState(() => {
    const after = Number(invoice.grand_total || 0)
    return after > 0 ? String(after) : ''
  })
  const [discountLastEdited, setDiscountLastEdited] = useState('discount')
  const [settlementType, setSettlementType] = useState(() => {
    const due = Number(invoice.due_amount ?? (Number(invoice.grand_total || 0) - Number(invoice.paid_amount || 0)))
    return due > 0 ? 'due' : 'paid'
  })
  const [patientName, setPatientName] = useState(initialName)
  const [patientPhone, setPatientPhone] = useState(patientInfo.phone || '')
  const [patientGender, setPatientGender] = useState(patientInfo.gender || 'male')
  const [patientAge, setPatientAge] = useState(
    patientInfo.age_value != null ? String(patientInfo.age_value) : patientInfo.age != null ? String(patientInfo.age) : '',
  )
  const [patientAgeUnit, setPatientAgeUnit] = useState(patientInfo.age_unit || 'years')
  const [guardianName, setGuardianName] = useState(patientInfo.guardian_name || '')
  const [addressLine1, setAddressLine1] = useState(patientInfo.address_line1 || '')
  const [city, setCity] = useState(patientInfo.city || '')
  const [state, setState] = useState(patientInfo.state || '')
  const [doctorName, setDoctorName] = useState(invoice.billing_doctor_name || '')
  const [hospitalName, setHospitalName] = useState(invoice.billing_hospital_name || '')
  const initialWhen = invoiceInstantParts(invoice.created_at)
  const [invoiceDate, setInvoiceDate] = useState(initialWhen.date)
  const [invoiceTime, setInvoiceTime] = useState(initialWhen.time)
  const [linkedPatientId, setLinkedPatientId] = useState(patientInfo.id || invoice.patient || '')
  const [linkedUhid, setLinkedUhid] = useState(patientInfo.uhid || '')
  const [ptResults, setPtResults] = useState([])
  const [ptSearching, setPtSearching] = useState(false)
  const [showPtResults, setShowPtResults] = useState(false)
  const [medicines, setMedicines] = useState(() => (Array.isArray(initialMedicines) ? initialMedicines : []))
  const [batches, setBatches] = useState(() => (Array.isArray(initialBatches) ? initialBatches : []))
  const [items, setItems] = useState(() =>
    Array.isArray(invoice.items) && invoice.items.length > 0
      ? invoice.items.map((it) => ({
          medicine: String(it.medicine || ''),
          batch: String(it.batch || ''),
          qty: String(it.qty ?? '1'),
          free_qty: String(it.free_qty ?? '0'),
          mrp: String(it.mrp ?? '0'),
          rate: String(it.rate ?? '0'),
          cgst_rate: String(it.cgst_rate ?? '0'),
          sgst_rate: String(it.sgst_rate ?? '0'),
        }))
      : [{ medicine: '', batch: '', qty: '1', free_qty: '0', mrp: '0', rate: '0', cgst_rate: '0', sgst_rate: '0' }],
  )
  const [saving, setSaving] = useState(false)

  // Refresh both lists independently: /batches/ computes live stock per row and can take
  // ~10s, and waiting on it used to leave every medicine dropdown blank until it landed.
  useEffect(() => {
    let cancelled = false
    fetchAllPaginated('/medicines/')
      .then((rows) => {
        if (!cancelled && rows.length) setMedicines(rows)
      })
      .catch(() => {})
    fetchAllPaginated('/batches/')
      .then((rows) => {
        if (!cancelled && rows.length) setBatches(rows)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  // The bill itself carries the medicine / batch labels, so a row can always name what it
  // sold even before the master lists arrive (or if the product was later deactivated).
  const invoiceItemLabels = useMemo(() => {
    const meds = new Map()
    const batchNos = new Map()
    for (const it of Array.isArray(invoice.items) ? invoice.items : []) {
      const medId = String(it.medicine || '')
      if (medId && !meds.has(medId)) meds.set(medId, String(it.medicine_name || '').trim() || 'Medicine')
      const batchId = String(it.batch || '')
      if (batchId && !batchNos.has(batchId)) {
        batchNos.set(batchId, String(it.batch_no || it.snapshot_batch_no || '').trim() || 'Batch')
      }
    }
    return { meds, batchNos }
  }, [invoice.items])

  useEffect(() => {
    const term = String(patientName || '').trim()
    if (term.length < 2) {
      setPtResults([])
      setPtSearching(false)
      return undefined
    }
    let cancelled = false
    setPtSearching(true)
    const timer = setTimeout(() => {
      api
        .get(`/patients/?search=${encodeURIComponent(term)}&limit=8`)
        .then((res) => {
          if (cancelled) return
          const rows = res.data?.data || res.data?.results || []
          setPtResults(Array.isArray(rows) ? rows : [])
        })
        .catch(() => {
          if (!cancelled) setPtResults([])
        })
        .finally(() => {
          if (!cancelled) setPtSearching(false)
        })
    }, 280)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [patientName])

  function applyExistingPatient(p) {
    if (!p) return
    setLinkedPatientId(p.id)
    setLinkedUhid(p.uhid || '')
    setPatientName(patientDisplayName(p))
    setPatientPhone(p.phone || '')
    setPatientGender(p.gender || 'male')
    setPatientAge(p.age_value != null ? String(p.age_value) : p.age != null ? String(p.age) : '')
    setPatientAgeUnit(p.age_unit || 'years')
    setGuardianName(p.guardian_name || '')
    setAddressLine1(p.address_line1 || '')
    setCity(p.city || '')
    setState(p.state || '')
    setPtResults([])
    setShowPtResults(false)
  }

  const totals = useMemo(() => {
    let subtotal = 0
    let cgst = 0
    let sgst = 0
    let rawMargin = 0
    items.forEach((row) => {
      const qty = Number(row.qty || 0)
      const rate = Number(row.rate || 0)
      const cg = Number(row.cgst_rate || 0)
      const sg = Number(row.sgst_rate || 0)
      const base = qty * rate
      subtotal += base
      cgst += (base * cg) / 100
      sgst += (base * sg) / 100
      const batch = batches.find((b) => String(b.id) === String(row.batch))
      const unitCost = batch && Number(batch.unit_cost) > 0 ? Number(batch.unit_cost) : null
      if (unitCost != null) {
        rawMargin += (rate - unitCost) * qty
      }
    })
    const grandTotal = subtotal + cgst + sgst
    let safeDiscount
    let afterDiscount
    if (discountLastEdited === 'after') {
      const afterVal = afterDiscountInput === '' || afterDiscountInput === '.'
        ? grandTotal
        : Math.max(0, Math.min(Number(afterDiscountInput) || 0, grandTotal))
      afterDiscount = afterVal
      safeDiscount = Math.max(0, grandTotal - afterVal)
    } else {
      safeDiscount = discountInput === '' || discountInput === '.'
        ? 0
        : Math.max(0, Math.min(Number(discountInput) || 0, grandTotal))
      afterDiscount = Math.max(0, grandTotal - safeDiscount)
    }
    const discountRatio = grandTotal > 0 ? afterDiscount / grandTotal : 1
    const margin = rawMargin * discountRatio
    // Retail bills settle in whole rupees; party (B2B / GST) bills stay exact.
    const { payable, roundOff } = invoice?.party
      ? { payable: afterDiscount, roundOff: 0 }
      : computeInvoiceRoundOff(afterDiscount)
    const paid = paymentMethod === 'credit' ? 0 : Number(paidAmount || 0)
    const due = Math.max(0, payable - Math.max(0, paid))
    return { subtotal, cgst, sgst, grandTotal, discount: safeDiscount, afterDiscount, roundOff, payable, due, rawMargin, margin }
  }, [items, batches, paymentMethod, paidAmount, discountInput, afterDiscountInput, discountLastEdited, invoice?.party])

  useEffect(() => {
    if (settlementType === 'due') {
      setPaymentMethod('credit')
      setPaidAmount('0')
    } else {
      if (paymentMethod === 'credit') {
        setPaymentMethod('cash')
      }
      // For "Paid", always use the latest recalculated edited bill total.
      setPaidAmount(String((totals?.payable || 0).toFixed(2)))
    }
  }, [settlementType, paymentMethod, totals?.payable])

  function updateItem(index, patch) {
    setItems((prev) => prev.map((row, i) => (i === index ? { ...row, ...patch } : row)))
  }

  function addItem() {
    setItems((prev) => [...prev, { medicine: '', batch: '', qty: '1', free_qty: '0', mrp: '0', rate: '0', cgst_rate: '0', sgst_rate: '0' }])
  }

  function removeItem(index) {
    if (items.length <= 1) {
      toast.error('At least one medicine is required. Cancel the receipt to remove the entire bill.')
      return
    }
    setItems((prev) => prev.filter((_, i) => i !== index))
  }

  function handleMedicineChange(index, medicineId) {
    const med = medicines.find((m) => String(m.id) === String(medicineId))
    const medBatches = batches
      .filter((b) => String(b.medicine) === String(medicineId))
      .sort((a, b) => new Date(a.expiry_date || 0).getTime() - new Date(b.expiry_date || 0).getTime())
    const firstBatch = medBatches[0] || null
    const gst = Number(med?.gst_percent || 0)
    const half = gst > 0 ? (gst / 2) : 0
    updateItem(index, {
      medicine: medicineId,
      batch: firstBatch ? String(firstBatch.id) : '',
      mrp: firstBatch ? String(firstBatch.mrp ?? 0) : '0',
      rate: firstBatch ? String(firstBatch.sale_rate ?? firstBatch.mrp ?? 0) : '0',
      cgst_rate: String(half),
      sgst_rate: String(half),
    })
  }

  function handleBatchChange(index, batchId) {
    const selectedBatch = batches.find((b) => String(b.id) === String(batchId))
    if (!selectedBatch) {
      updateItem(index, { batch: '' })
      return
    }
    const med = medicines.find((m) => String(m.id) === String(selectedBatch.medicine))
    const gst = Number(med?.gst_percent || 0)
    const half = gst > 0 ? (gst / 2) : 0
    updateItem(index, {
      batch: String(batchId),
      mrp: String(selectedBatch.mrp ?? 0),
      rate: String(selectedBatch.sale_rate ?? selectedBatch.mrp ?? 0),
      cgst_rate: String(half),
      sgst_rate: String(half),
    })
  }

  async function save() {
    const validItems = items
      .map((row) => ({
        medicine: row.medicine,
        batch: row.batch,
        qty: Number(row.qty || 0),
        free_qty: Number(row.free_qty || 0),
        mrp: Number(row.mrp || 0),
        rate: Number(row.rate || 0),
        cgst_rate: Number(row.cgst_rate || 0),
        sgst_rate: Number(row.sgst_rate || 0),
      }))
      .filter((row) => row.medicine && row.batch && row.qty > 0)
    if (validItems.length === 0) {
      toast.error('Add at least one valid medicine row')
      return
    }

    const fullName = String(patientName || '').trim()
    const parts = fullName.split(/\s+/).filter(Boolean)
    if (parts.length === 0) {
      toast.error('Patient name is required')
      return
    }

    setSaving(true)
    try {
      const invoiceDatetimeIso = invoiceDateTimeInputToIso(invoiceDate, invoiceTime)
      await api.patch(`/pharmacy/invoices/${invoice.id}/update-full/`, {
        patient: {
          id: linkedPatientId || undefined,
          first_name: parts[0],
          last_name: parts.slice(1).join(' '),
          phone: patientPhone || '',
          gender: patientGender || 'male',
          age: patientAge === '' ? null : Number(patientAge),
          age_unit: patientAgeUnit || 'years',
          guardian_name: guardianName || '',
          address_line1: addressLine1 || '',
          city: city || '',
          state: state || '',
        },
        invoice: {
          payment_method: settlementType === 'due' ? 'credit' : paymentMethod,
          paid_amount: settlementType === 'due' ? 0 : Number(totals.payable || 0),
          remarks,
          total_discount: Number(totals.discount || 0),
          date: invoiceDate || undefined,
          ...(invoiceDatetimeIso ? { invoice_datetime: invoiceDatetimeIso } : {}),
          billing_doctor_name: doctorName || '',
          billing_hospital_name: hospitalName || '',
        },
        items: validItems,
      })
      toast.success('Invoice updated and inventory adjusted')
      onSaved?.()
    } catch (err) {
      toast.error(parseApiError(err, 'Failed to update invoice'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[400] bg-black/50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-5xl p-4 border border-slate-200 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-bold text-slate-900">Edit sale invoice</h3>
          <button type="button" onClick={onClose} className="text-slate-500 hover:text-slate-800">
            <X size={16} />
          </button>
        </div>
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <label className="block relative">
              <span className="text-[10px] font-semibold text-slate-500 uppercase">Patient name</span>
              <input
                value={patientName}
                onChange={(e) => {
                  setPatientName(e.target.value)
                  setShowPtResults(true)
                }}
                onFocus={() => setShowPtResults(true)}
                onBlur={() => window.setTimeout(() => setShowPtResults(false), 180)}
                placeholder="Search existing patient or type a name"
                className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm"
              />
              {linkedUhid ? (
                <p className="text-[10px] text-emerald-700 font-semibold mt-0.5">UHID {linkedUhid} — linked hospital patient</p>
              ) : (
                <p className="text-[10px] text-slate-400 mt-0.5">Pick a match below, or fill the fields manually</p>
              )}
              {showPtResults && String(patientName || '').trim().length >= 2 && (
                <div className="absolute z-30 left-0 right-0 mt-1 bg-white border border-slate-200 rounded-lg shadow-lg max-h-48 overflow-y-auto">
                  {ptSearching && (
                    <div className="px-3 py-2 text-xs text-slate-400">Searching…</div>
                  )}
                  {!ptSearching && ptResults.length === 0 && (
                    <div className="px-3 py-2 text-xs text-slate-500">No existing patient found. Continue typing to fill manually.</div>
                  )}
                  {ptResults.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => applyExistingPatient(p)}
                      className="w-full text-left px-3 py-2 text-sm hover:bg-emerald-50 border-b border-slate-100 last:border-0"
                    >
                      <span className="font-semibold text-slate-900">{patientDisplayName(p) || '—'}</span>
                      {p.uhid ? <span className="ml-2 text-slate-500">{p.uhid}</span> : null}
                      {p.phone ? <span className="ml-2 text-slate-400">{p.phone}</span> : null}
                    </button>
                  ))}
                </div>
              )}
            </label>
            <label className="block">
              <span className="text-[10px] font-semibold text-slate-500 uppercase">Phone</span>
              <input value={patientPhone} onChange={(e) => setPatientPhone(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm" />
            </label>
            <label className="block">
              <span className="text-[10px] font-semibold text-slate-500 uppercase">Gender</span>
              <select value={patientGender} onChange={(e) => setPatientGender(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm bg-white">
                <option value="male">Male</option>
                <option value="female">Female</option>
                <option value="other">Other</option>
              </select>
            </label>
            <label className="block">
              <span className="text-[10px] font-semibold text-slate-500 uppercase">Age</span>
              <div className="mt-1 flex gap-2">
                <input type="number" min="0" value={patientAge} onChange={(e) => setPatientAge(e.target.value)} className="w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm" />
                <select value={patientAgeUnit} onChange={(e) => setPatientAgeUnit(e.target.value)} className="rounded-lg border border-slate-200 px-2 py-1.5 text-sm bg-white">
                  <option value="years">Years</option>
                  <option value="months">Months</option>
                  <option value="days">Days</option>
                </select>
              </div>
            </label>
            <label className="block">
              <span className="text-[10px] font-semibold text-slate-500 uppercase">Invoice date</span>
              <FormattedDateInput
                value={invoiceDate}
                onChange={setInvoiceDate}
                className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm"
              />
            </label>
            <label className="block">
              <span className="text-[10px] font-semibold text-slate-500 uppercase">Invoice time</span>
              <div className="mt-1">
                <AmPmTimeInput
                  value={invoiceTime}
                  onChange={setInvoiceTime}
                  selectClassName="border border-slate-200 rounded-lg text-sm bg-white"
                />
              </div>
            </label>
            <label className="block">
              <span className="text-[10px] font-semibold text-slate-500 uppercase">Doctor name</span>
              <input value={doctorName} onChange={(e) => setDoctorName(e.target.value)} placeholder="Optional" className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm" />
            </label>
            <label className="block">
              <span className="text-[10px] font-semibold text-slate-500 uppercase">Hospital name</span>
              <input value={hospitalName} onChange={(e) => setHospitalName(e.target.value)} placeholder="Optional" className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm" />
            </label>
            <label className="block md:col-span-2">
              <span className="text-[10px] font-semibold text-slate-500 uppercase">Guardian</span>
              <input value={guardianName} onChange={(e) => setGuardianName(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm" />
            </label>
            <label className="block md:col-span-2">
              <span className="text-[10px] font-semibold text-slate-500 uppercase">Address</span>
              <input value={addressLine1} onChange={(e) => setAddressLine1(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm" />
            </label>
            <label className="block">
              <span className="text-[10px] font-semibold text-slate-500 uppercase">City</span>
              <input value={city} onChange={(e) => setCity(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm" />
            </label>
            <label className="block">
              <span className="text-[10px] font-semibold text-slate-500 uppercase">State</span>
              <input value={state} onChange={(e) => setState(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm" />
            </label>
          </div>

          <div className="border border-slate-200 rounded-lg overflow-hidden">
            <div className="px-2 py-2 bg-slate-50 flex items-center justify-between">
              <span className="text-[11px] font-bold text-slate-700">
                Medicines
                {medicines.length === 0 ? (
                  <span className="ml-2 font-normal text-slate-400">Loading medicine list…</span>
                ) : null}
              </span>
              <button type="button" onClick={addItem} className="px-2 py-1 rounded border border-blue-200 bg-blue-50 text-blue-700 text-[10px] font-semibold">+ Add row</button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-[11px]">
                <thead className="bg-white text-slate-500 uppercase text-[10px]">
                  <tr>
                    <th className="px-2 py-1 text-left">Medicine</th>
                    <th className="px-2 py-1 text-left">Batch</th>
                    <th className="px-2 py-1 text-right">Qty</th>
                    <th className="px-2 py-1 text-right">Free</th>
                    <th className="px-2 py-1 text-right">MRP</th>
                    <th className="px-2 py-1 text-right">Rate</th>
                    <th className="px-2 py-1 text-right">CGST%</th>
                    <th className="px-2 py-1 text-right">SGST%</th>
                    <th className="px-2 py-1 text-right">Line</th>
                    <th className="px-2 py-1 text-right"> </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {items.map((row, idx) => {
                    const medBatches = batches.filter((b) => String(b.medicine) === String(row.medicine))
                    const medMissing = row.medicine && !medicines.some((m) => String(m.id) === String(row.medicine))
                    const batchMissing = row.batch && !medBatches.some((b) => String(b.id) === String(row.batch))
                    const line = (Number(row.qty || 0) * Number(row.rate || 0)) * (1 + (Number(row.cgst_rate || 0) + Number(row.sgst_rate || 0)) / 100)
                    const deleteBlocked = items.length <= 1
                    return (
                      <tr key={idx}>
                        <td className="px-2 py-1 min-w-[190px]">
                          <select value={row.medicine} onChange={(e) => handleMedicineChange(idx, e.target.value)} className="w-full rounded border border-slate-200 px-2 py-1 bg-white">
                            <option value="">Select</option>
                            {medMissing && (
                              <option value={String(row.medicine)}>
                                {invoiceItemLabels.meds.get(String(row.medicine)) || 'Medicine on bill'}
                              </option>
                            )}
                            {medicines.map((m) => <option key={m.id} value={String(m.id)}>{m.name}</option>)}
                          </select>
                        </td>
                        <td className="px-2 py-1 min-w-[160px]">
                          <select value={row.batch} onChange={(e) => handleBatchChange(idx, e.target.value)} className="w-full rounded border border-slate-200 px-2 py-1 bg-white">
                            <option value="">Select</option>
                            {batchMissing && (
                              <option value={String(row.batch)}>
                                {invoiceItemLabels.batchNos.get(String(row.batch)) || 'Batch on bill'}
                              </option>
                            )}
                            {medBatches.map((b) => <option key={b.id} value={String(b.id)}>{b.batch_no}</option>)}
                          </select>
                        </td>
                        <td className="px-2 py-1"><input type="number" min="0.01" step="0.01" value={row.qty} onChange={(e) => updateItem(idx, { qty: e.target.value })} className="w-20 rounded border border-slate-200 px-2 py-1 text-right" /></td>
                        <td className="px-2 py-1"><input type="number" min="0" step="0.01" value={row.free_qty} onChange={(e) => updateItem(idx, { free_qty: e.target.value })} className="w-16 rounded border border-slate-200 px-2 py-1 text-right" /></td>
                        <td className="px-2 py-1"><input type="number" min="0" step="0.01" value={row.mrp} onChange={(e) => updateItem(idx, { mrp: e.target.value })} className="w-20 rounded border border-slate-200 px-2 py-1 text-right" /></td>
                        <td className="px-2 py-1"><input type="number" min="0" step="0.01" value={row.rate} onChange={(e) => updateItem(idx, { rate: e.target.value })} className="w-20 rounded border border-slate-200 px-2 py-1 text-right" /></td>
                        <td className="px-2 py-1"><input type="number" min="0" step="0.01" value={row.cgst_rate} onChange={(e) => updateItem(idx, { cgst_rate: e.target.value })} className="w-16 rounded border border-slate-200 px-2 py-1 text-right" /></td>
                        <td className="px-2 py-1"><input type="number" min="0" step="0.01" value={row.sgst_rate} onChange={(e) => updateItem(idx, { sgst_rate: e.target.value })} className="w-16 rounded border border-slate-200 px-2 py-1 text-right" /></td>
                        <td className="px-2 py-1 text-right font-semibold">₹{Number.isFinite(line) ? line.toFixed(2) : '0.00'}</td>
                        <td className="px-2 py-1 text-right">
                          <button
                            type="button"
                            onClick={() => removeItem(idx)}
                            aria-disabled={deleteBlocked}
                            className={`px-2 py-1 rounded border text-[10px] font-semibold ${
                              deleteBlocked
                                ? 'border-rose-100 bg-rose-50/60 text-rose-400 cursor-not-allowed opacity-60'
                                : 'border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100'
                            }`}
                          >
                            Del
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <label className="block">
              <span className="text-[10px] font-semibold text-slate-500 uppercase">Settlement</span>
              <select
                value={settlementType}
                onChange={(e) => setSettlementType(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm bg-white"
              >
                <option value="paid">Paid</option>
                <option value="due">Due</option>
              </select>
            </label>
            <label className="block">
              <span className="text-[10px] font-semibold text-slate-500 uppercase">Payment method</span>
              <select
                value={paymentMethod}
                onChange={(e) => setPaymentMethod(e.target.value)}
                disabled={settlementType === 'due'}
                className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm bg-white"
              >
                {EDIT_PAYMENT_METHODS.map((m) => (
                  <option key={m.value} value={m.value}>{m.label}</option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="text-[10px] font-semibold text-slate-500 uppercase">Paid amount</span>
              <input
                type="number"
                value={settlementType === 'due' ? '0' : Number(totals.payable || 0).toFixed(2)}
                readOnly
                disabled
                className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm disabled:bg-slate-100"
              />
            </label>
            <label className="block">
              <span className="text-[10px] font-semibold text-slate-500 uppercase">Discount (₹)</span>
              <input
                type="text"
                inputMode="decimal"
                value={discountInput}
                onChange={(e) => {
                  const raw = e.target.value
                  if (raw === '' || /^\d*\.?\d*$/.test(raw)) {
                    setDiscountInput(raw)
                    setDiscountLastEdited('discount')
                    const disc = raw === '' || raw === '.' ? 0 : Math.max(0, Math.min(Number(raw) || 0, totals.grandTotal))
                    const after = totals.grandTotal - disc
                    setAfterDiscountInput(String(after))
                  }
                }}
                onBlur={() => {
                  const val = Math.max(0, Math.min(Number(discountInput) || 0, totals.grandTotal))
                  setDiscountInput(val > 0 ? String(val) : '')
                  setAfterDiscountInput(String((totals.grandTotal - val).toFixed(2)))
                }}
                className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm"
              />
            </label>
            <label className="block">
              <span className="text-[10px] font-semibold text-slate-500 uppercase">After discount (₹)</span>
              <input
                type="text"
                inputMode="decimal"
                value={afterDiscountInput}
                onChange={(e) => {
                  const raw = e.target.value
                  if (raw === '' || /^\d*\.?\d*$/.test(raw)) {
                    setAfterDiscountInput(raw)
                    setDiscountLastEdited('after')
                    const after = raw === '' || raw === '.' ? 0 : Math.max(0, Math.min(Number(raw) || 0, totals.grandTotal))
                    const disc = totals.grandTotal - after
                    setDiscountInput(disc > 0 ? String(disc) : '')
                  }
                }}
                onBlur={() => {
                  const after = Math.max(0, Math.min(Number(afterDiscountInput) || 0, totals.grandTotal))
                  setAfterDiscountInput(String(after.toFixed(2)))
                  const disc = totals.grandTotal - after
                  setDiscountInput(disc > 0 ? String(disc) : '')
                }}
                className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm"
              />
            </label>
            <label className="block md:col-span-1">
              <span className="text-[10px] font-semibold text-slate-500 uppercase">Remarks</span>
              <input value={remarks} onChange={(e) => setRemarks(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm" />
            </label>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-2 text-xs">
            <div className="rounded border border-slate-200 p-2"><div className="text-slate-500">Subtotal</div><div className="font-bold">₹{totals.subtotal.toFixed(2)}</div></div>
            <div className="rounded border border-slate-200 p-2"><div className="text-slate-500">CGST</div><div className="font-bold">₹{totals.cgst.toFixed(2)}</div></div>
            <div className="rounded border border-slate-200 p-2"><div className="text-slate-500">SGST</div><div className="font-bold">₹{totals.sgst.toFixed(2)}</div></div>
            <div className="rounded border border-amber-200 bg-amber-50 p-2"><div className="text-amber-700">Discount</div><div className="font-bold text-amber-800">₹{totals.discount.toFixed(2)}</div></div>
            <div className="rounded border border-slate-200 p-2"><div className="text-slate-500">After discount</div><div className="font-bold">₹{totals.afterDiscount.toFixed(2)}</div></div>
            <div className="rounded border border-slate-200 p-2">
              <div className="text-slate-500">Round off</div>
              <div className="font-bold">
                {totals.roundOff === 0 ? '—' : `${totals.roundOff > 0 ? '+' : '−'}₹${Math.abs(totals.roundOff).toFixed(2)}`}
              </div>
            </div>
            <div className="rounded border border-blue-200 bg-blue-50 p-2"><div className="text-blue-700">Payable</div><div className="font-bold text-blue-800">₹{totals.payable.toFixed(2)}</div></div>
            <div className="rounded border border-emerald-200 bg-emerald-50 p-2"><div className="text-emerald-700">Margin</div><div className="font-bold text-emerald-800">₹{totals.margin.toFixed(2)}</div></div>
            <div className="rounded border border-slate-200 p-2"><div className="text-slate-500">Due</div><div className="font-bold text-amber-700">₹{totals.due.toFixed(2)}</div></div>
          </div>

          <button
            type="button"
            onClick={save}
            disabled={saving}
            className="w-full py-2 rounded-lg bg-blue-600 text-white font-semibold disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      </div>
    </div>
  )
}

function resolveNewMedicineDefaultGst(defaultGstPercent) {
  const s = defaultGstPercent != null && String(defaultGstPercent).trim() !== '' ? String(defaultGstPercent).trim() : ''
  if (s === '') return '5'
  const n = Number(s)
  return Number.isFinite(n) && n >= 0 ? String(n) : '5'
}

function resolveNewMedicineDefaultDiscount(defaultDiscountPercent) {
  const s =
    defaultDiscountPercent != null && String(defaultDiscountPercent).trim() !== ''
      ? String(defaultDiscountPercent).trim()
      : ''
  if (s === '') return '0'
  const n = Number(s)
  return Number.isFinite(n) && n >= 0 ? String(n) : '0'
}

const DEFAULT_PRODUCT_FORMS = [
  'Tablet', 'Syrup', 'Capsule', 'Injection', 'Cream', 'Powder', 'Drops', 'Surgicals', 'Liquid', 'Gel',
  'Suspension', 'Lotion', 'Soap', 'Oil', 'Ointment', 'Kit', 'Bandage', 'Device', 'Spray', 'Shampoo',
  'Sachet', 'Packet', 'Bottle', 'Solution', 'Unit', 'Infusion', 'Box', 'Elixir', 'Paste', 'Balm',
  'Strip', 'Vaccine', 'Suppository', 'Patch', 'Jar', 'Tonic', 'Vial', 'Ampules', 'Pen',
]

function uniqText(values) {
  const seen = new Set()
  const out = []
  values.forEach((v) => {
    const raw = (v || '').trim()
    if (!raw) return
    const key = raw.toLowerCase()
    if (seen.has(key)) return
    seen.add(key)
    out.push(raw)
  })
  return out
}

const CATEGORY_TREE_ROOT = '__root__'

/** Parent FK may be a UUID string or a nested object from some serializers. */
function normalizeCategoryParentKey(row) {
  const p = row?.parent
  if (p == null || p === '') return CATEGORY_TREE_ROOT
  if (typeof p === 'object' && p !== null && 'id' in p) return String(p.id)
  return String(p)
}

/** One row per id (API/payload can repeat the same id). */
function dedupeCategoryRowsById(rows) {
  const m = new Map()
  ;(rows || []).forEach((r) => {
    if (r && r.id) m.set(String(r.id), r)
  })
  return Array.from(m.values())
}

/**
 * Under the same parent, (pharmacy, parent, name) should be unique; bad/legacy data can still repeat.
 * Match the Categories tab: one visible entry per name among siblings (keeps first by sort order).
 */
function dedupeSiblingsByNormalizedName(rows) {
  const out = []
  const seen = new Set()
  const sorted = [...(rows || [])].sort((a, b) =>
    String(a.name || '').localeCompare(String(b.name || ''), undefined, { sensitivity: 'base' }),
  )
  for (const r of sorted) {
    const key = normalizeCategoryName(r.name)
    if (seen.has(key)) continue
    seen.add(key)
    out.push(r)
  }
  return out
}

/**
 * Build parent→children maps for Add Medicine. Includes inactive rows.
 * Orphan rows (parent id missing from payload) are attached under root so they stay visible.
 */
function buildMedicineCategoryLookups(rows) {
  const list = dedupeCategoryRowsById((rows || []).filter((r) => r && r.id))
  const idToRow = new Map()
  list.forEach((r) => idToRow.set(String(r.id), r))

  const childrenOf = new Map()
  list.forEach((r) => {
    let pk = normalizeCategoryParentKey(r)
    if (pk !== CATEGORY_TREE_ROOT && !idToRow.has(pk)) {
      pk = CATEGORY_TREE_ROOT
    }
    if (!childrenOf.has(pk)) childrenOf.set(pk, [])
    childrenOf.get(pk).push(r)
  })
  for (const [parentKey, arr] of childrenOf.entries()) {
    const unique = dedupeSiblingsByNormalizedName(arr)
    unique.sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')))
    childrenOf.set(parentKey, unique)
  }
  const roots = childrenOf.get(CATEGORY_TREE_ROOT) || []
  return { idToRow, childrenOf, roots }
}

/** Breadcrumb path of ids from root to leaf for tree picker sync. */
function categoryAncestorsPath(leafId, idToRow) {
  const path = []
  let cur = idToRow.get(String(leafId))
  const seen = new Set()
  while (cur && !seen.has(String(cur.id))) {
    seen.add(String(cur.id))
    path.unshift(String(cur.id))
    const pk = normalizeCategoryParentKey(cur)
    if (pk === CATEGORY_TREE_ROOT) break
    cur = idToRow.get(pk)
  }
  return path
}

/** Display path like Parent › Child › Name for search results. */
function categoryPathLabel(leafId, idToRow) {
  const path = categoryAncestorsPath(leafId, idToRow)
  return path.map((id) => idToRow.get(id)?.name || '').filter(Boolean).join(' › ')
}

/** Recursive tree for category picker: chevron only when row has children; separate expand vs select. */
function CategoryPickerTreeRows({ nodes, depth, childrenOf, expandedIds, onToggleExpand, onSelectRow }) {
  if (!nodes?.length) return null
  return nodes.map((r) => {
    const id = String(r.id)
    const kids = childrenOf.get(id) || []
    const hasKids = kids.length > 0
    const expanded = expandedIds.has(id)
    return (
      <div key={id}>
        <div
          className="flex items-center min-h-[28px] pr-1"
          style={{ paddingLeft: `${8 + depth * 12}px` }}
        >
          <div className="w-6 shrink-0 flex items-center justify-center">
            {hasKids ? (
              <button
                type="button"
                aria-expanded={expanded}
                tabIndex={-1}
                onClick={(e) => {
                  e.stopPropagation()
                  onToggleExpand(id)
                }}
                className="p-0.5 rounded hover:bg-slate-100 text-slate-600"
              >
                <ChevronRight
                  size={14}
                  className="text-slate-500"
                  sx={{
                    transform: expanded ? 'rotate(90deg)' : 'none',
                    transition: 'transform 0.15s ease',
                  }}
                />
              </button>
            ) : (
              <span className="inline-block w-4 shrink-0" aria-hidden />
            )}
          </div>
          <button
            type="button"
            onClick={() => onSelectRow(r)}
            className="flex-1 text-left text-[11px] py-1 px-1 rounded hover:bg-slate-50 text-slate-800 truncate min-w-0"
          >
            {r.name}
          </button>
        </div>
        {hasKids && expanded ? (
          <CategoryPickerTreeRows
            nodes={kids}
            depth={depth + 1}
            childrenOf={childrenOf}
            expandedIds={expandedIds}
            onToggleExpand={onToggleExpand}
            onSelectRow={onSelectRow}
          />
        ) : null}
      </div>
    )
  })
}

/** Unit-level MRP, sale rate, cost, and discount % for Add Medicine (matches pack vs unit input mode). */
function discountPercentFromMrpAndRate(mrp, rate) {
  const m = Number(mrp) || 0
  const rt = Number(rate) || 0
  if (!(m > 0)) return 0
  const raw = ((m - rt) / m) * 100
  if (!Number.isFinite(raw)) return 0
  return Math.min(100, Math.max(0, Math.round(raw * 100) / 100))
}

function computeUnitPricingForAddMedicine(data, unitsPerPack) {
  const up = unitsPerPack > 0 ? unitsPerPack : 1
  const enteredMrp = Number(data.mrp) || 0
  const unitMrpRaw = data.mrp_input_type === 'pack' && up > 1 ? enteredMrp / up : enteredMrp
  const unitMrp = Math.round(unitMrpRaw * 100) / 100

  const saleStr = String(data.selling_price ?? '').trim()
  let unitSale
  if (saleStr === '') {
    unitSale = unitMrp
  } else {
    const enteredSale = Number(data.selling_price) || 0
    const raw = data.mrp_input_type === 'pack' && up > 1 ? enteredSale / up : enteredSale
    unitSale = Math.round(raw * 100) / 100
  }

  const costStr = String(data.cost_price ?? '').trim()
  let unitCost
  if (costStr === '') {
    unitCost = 0
  } else {
    const enteredCost = Number(data.cost_price) || 0
    const raw = data.mrp_input_type === 'pack' && up > 1 ? enteredCost / up : enteredCost
    unitCost = Math.round(raw * 100) / 100
  }

  const discountPct = unitMrp > 0 ? Math.round(((unitMrp - unitSale) / unitMrp) * 10000) / 100 : null

  return { unitMrp, unitSale, unitCost, discountPct }
}

function formatMoneyInput(v) {
  if (v == null || v === '') return ''
  const n = Number(v)
  if (!Number.isFinite(n)) return ''
  return n.toFixed(2)
}

function normalizeNonNegativeNumberInput(raw) {
  const text = String(raw ?? '').trim()
  if (text === '') return ''
  const value = Number(text)
  if (!Number.isFinite(value) || value < 0) return null
  return text
}

/** Whole numbers only (0, 1, 2, …) — rejects decimals and invalid characters. */
function normalizeNonNegativeIntegerInput(raw) {
  const text = String(raw ?? '').trim()
  if (text === '') return ''
  if (!/^\d+$/.test(text)) return null
  return text
}

function formatStockNumber(value) {
  if (!Number.isFinite(value)) return ''
  if (value % 1 === 0) return String(value)
  return String(Math.round(value * 1000) / 1000)
}

const HSN_HISTORY_KEY = 'pharma_hsn_history'
function getHsnHistory() {
  try { return JSON.parse(localStorage.getItem(HSN_HISTORY_KEY)) || [] } catch { return [] }
}
function saveHsnHistory(code) {
  const trimmed = code.trim()
  if (!trimmed) return
  const prev = getHsnHistory().filter((h) => h !== trimmed)
  localStorage.setItem(HSN_HISTORY_KEY, JSON.stringify([trimmed, ...prev].slice(0, 20)))
}

function AddMedicineModal({ onClose, onRefresh, onMedicineCreated, defaultGstPercent, defaultSaleDiscountPercent }) {
  const fallbackGstStr = resolveNewMedicineDefaultGst(defaultGstPercent)
  const fallbackDiscountStr = resolveNewMedicineDefaultDiscount(defaultSaleDiscountPercent)
  const [data, setData] = useState({
    name: '',
    name_on_bill: '',
    company_name: '',
    hsn_code: '',
    form: '',
    category: '',
    composition: '',
    mrp: '',
    selling_price: '',
    discount_percent: fallbackDiscountStr,
    cost_price: '',
    mrp_input_type: 'unit',
    price_tax_mode: 'exclusive',
    units_per_pack: '',
    gst_percent: fallbackGstStr,
    no_gst: false,
    add_batch: true,
    batch_mode: 'new',
    existing_batch_id: '',
    batch_no: '',
    expiry_date: '',
    opening_stock_qty: '',
    opening_stock_pack_qty: '',
  })
  const [units, setUnits] = useState([])
  const [forms, setForms] = useState([])
  const [batchOptions, setBatchOptions] = useState([])
  const [submitting, setSubmitting] = useState(false)
  /** Selected category ids from root → leaf for cascading dropdowns */
  const [categoryPathIds, setCategoryPathIds] = useState([])
  const [creatingForm, setCreatingForm] = useState(false)
  const [openingStockEditedBy, setOpeningStockEditedBy] = useState('units')
  const [medicineCategoryRows, setMedicineCategoryRows] = useState([])
  const [pricingEditedBy, setPricingEditedBy] = useState(
    Number(fallbackDiscountStr || 0) > 0 ? 'discount' : 'selling',
  )
  const [bootstrapMedicines, setBootstrapMedicines] = useState([])
  const [categoryPickerOpen, setCategoryPickerOpen] = useState(false)
  const [categorySearch, setCategorySearch] = useState('')
  /** Expanded folder ids in the nested tree (chevron toggles). */
  const [expandedCategoryIds, setExpandedCategoryIds] = useState(() => new Set())
  const [hsnHistory, setHsnHistory] = useState(() => getHsnHistory())
  const [hsnDropdownOpen, setHsnDropdownOpen] = useState(false)
  const hsnWrapperRef = React.useRef(null)

  const unitPricingPreview = useMemo(() => {
    const unitsPerPack =
      data.mrp_input_type === 'unit'
        ? 1
        : Math.max(0, Number(data.units_per_pack) || 0)
    if (data.mrp_input_type === 'pack' && !(unitsPerPack > 0)) return null
    return computeUnitPricingForAddMedicine(data, unitsPerPack)
  }, [data])

  useEffect(() => {
    let cancelled = false
    Promise.all([
      api.get('/units/?limit=100').catch(() => ({ data: [] })),
      api.get('/medicine-categories/?limit=5000').catch(() => ({ data: [] })),
      api.get('/medicines/?limit=2000').catch(() => ({ data: [] })),
      api.get('/batches/?limit=1000').catch(() => ({ data: [] })),
    ])
      .then(([uRes, cRes, mRes, bRes]) => {
        if (cancelled) return
        const unitsList = uRes.data?.data || uRes.data?.results || []
        setUnits(Array.isArray(unitsList) ? unitsList : [])

        const catRows = cRes.data?.data || cRes.data?.results || []
        const catList = Array.isArray(catRows) ? catRows : []
        setMedicineCategoryRows(catList)
        const catNames = catList.map((r) => r.name)

        const medRows = mRes.data?.data || mRes.data?.results || []
        const medForms = Array.isArray(medRows) ? medRows.map((m) => m.form) : []
        setBootstrapMedicines(Array.isArray(medRows) ? medRows : [])

        setForms(uniqText([...catNames, ...medForms, ...DEFAULT_PRODUCT_FORMS]))
        const bRows = bRes.data?.data || bRes.data?.results || []
        setBatchOptions(Array.isArray(bRows) ? bRows : [])
      })
      .catch(() => {
        if (cancelled) return
        setUnits([])
        setMedicineCategoryRows([])
        setBootstrapMedicines([])
        setForms(DEFAULT_PRODUCT_FORMS)
        setBatchOptions([])
      })
    return () => {
      cancelled = true
    }
  }, [])

  const { idToRow, childrenOf, roots } = useMemo(
    () => buildMedicineCategoryLookups(medicineCategoryRows),
    [medicineCategoryRows],
  )
  const allFlatCategoryNames = useMemo(
    () => mergeCategoryNames(bootstrapMedicines, medicineCategoryRows),
    [bootstrapMedicines, medicineCategoryRows],
  )
  const filteredFlatNames = useMemo(() => {
    const q = categorySearch.trim().toLowerCase()
    if (!q) return allFlatCategoryNames
    return allFlatCategoryNames.filter((n) => n.toLowerCase().includes(q))
  }, [allFlatCategoryNames, categorySearch])

  const sortedAllFlatCategoryNames = useMemo(
    () =>
      [...allFlatCategoryNames].sort((a, b) =>
        String(a || '').localeCompare(String(b || ''), undefined, { sensitivity: 'base' }),
      ),
    [allFlatCategoryNames],
  )

  const categoryBreadcrumb = useMemo(() => {
    if (!categoryPathIds.length) return ''
    return categoryPathIds
      .map((id) => idToRow.get(id)?.name || '')
      .filter(Boolean)
      .join(' › ')
  }, [categoryPathIds, idToRow])

  useEffect(() => {
    if (!categoryPickerOpen) return undefined
    function handleEscape(e) {
      if (e.key === 'Escape') setCategoryPickerOpen(false)
    }
    document.addEventListener('keydown', handleEscape)
    return () => document.removeEventListener('keydown', handleEscape)
  }, [categoryPickerOpen])

  useEffect(() => {
    if (!categoryPickerOpen) return
    setExpandedCategoryIds(() => {
      const next = new Set()
      categoryPathIds.slice(0, -1).forEach((id) => next.add(String(id)))
      return next
    })
  }, [categoryPickerOpen, categoryPathIds])

  function selectCategoryRow(row) {
    if (!row?.id) return
    setData((d) => ({ ...d, form: String(row.name || '').trim() }))
    setData((d) => ({ ...d, category: String(row.id) }))
    setCategoryPathIds(categoryAncestorsPath(row.id, idToRow))
    setCategoryPickerOpen(false)
  }

  function toggleCategoryExpand(categoryId) {
    setExpandedCategoryIds((prev) => {
      const next = new Set(prev)
      const id = String(categoryId)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function pickFlatCategoryName(name) {
    const trimmed = (name || '').trim()
    if (!trimmed) return
    setData((d) => ({ ...d, form: trimmed, category: '' }))
    const row = medicineCategoryRows.find(
      (r) => normalizeCategoryName(r.name) === normalizeCategoryName(trimmed),
    )
    if (row?.id) {
      setCategoryPathIds(categoryAncestorsPath(row.id, idToRow))
      setData((d) => ({ ...d, category: String(row.id) }))
    } else {
      setCategoryPathIds([])
    }
    setCategoryPickerOpen(false)
  }

  function pickFromSearchList(name) {
    const trimmed = (name || '').trim()
    if (!trimmed) return
    const row = medicineCategoryRows.find(
      (r) => normalizeCategoryName(r.name) === normalizeCategoryName(trimmed),
    )
    if (row?.id) selectCategoryRow(row)
    else pickFlatCategoryName(trimmed)
  }

  const pricingLocked = !!(data.add_batch && data.batch_mode === 'existing' && data.existing_batch_id)
  const openingUnitsPerPack = Math.max(0, Number(data.units_per_pack) || 0)
  const activeCategoryRules = useMemo(
    () => resolveCategoryRules(data.form, medicineCategoryRows),
    [data.form, medicineCategoryRows],
  )
  const conversionHints = useMemo(
    () => conversionHintLines(activeCategoryRules, data.units_per_pack, data.mrp_input_type),
    [activeCategoryRules, data.units_per_pack, data.mrp_input_type],
  )

  useEffect(() => {
    if (!data.add_batch || data.batch_mode !== 'existing' || !data.existing_batch_id) return
    const b = batchOptions.find((x) => String(x.id) === String(data.existing_batch_id))
    if (!b) return
    const uMrp = Number(b.mrp) || 0
    const uSale = Number(b.sale_rate) || 0
    const uCost = Number(b.unit_cost) || 0
    const up =
      data.mrp_input_type === 'unit'
        ? 1
        : Math.max(1, Number(data.units_per_pack) || 1)
    const mult = data.mrp_input_type === 'pack' && up > 1 ? up : 1
    setData((d) => ({
      ...d,
      mrp: formatMoneyInput(uMrp * mult),
      selling_price: formatMoneyInput(uSale * mult),
      discount_percent: discountPercentFromMrpAndRate(uMrp, uSale).toFixed(2),
      cost_price: formatMoneyInput(uCost * mult),
    }))
    setPricingEditedBy('selling')
  }, [data.add_batch, data.batch_mode, data.existing_batch_id, batchOptions, data.mrp_input_type, data.units_per_pack])

  useEffect(() => {
    if (pricingLocked) return
    if (pricingEditedBy !== 'discount') return
    const enteredMrp = Number(data.mrp)
    if (!(Number.isFinite(enteredMrp) && enteredMrp > 0)) return
    const discountRaw = String(data.discount_percent ?? '').trim()
    if (discountRaw === '' || discountRaw === '.' || discountRaw === '-') return
    const discountPct = Math.min(100, Math.max(0, Number(discountRaw) || 0))
    const saleEntered = enteredMrp * (1 - discountPct / 100)
    const saleNormalized = Math.round(saleEntered * 100) / 100
    const saleText = String(data.selling_price ?? '').trim()
    const currentSale = saleText === '' || saleText === '.' || saleText === '-' ? null : Number(saleText)
    if (currentSale != null && Number.isFinite(currentSale) && Math.abs(currentSale - saleNormalized) < 0.005) return
    setData((d) => ({ ...d, selling_price: formatMoneyInput(saleNormalized) }))
  }, [data.discount_percent, data.mrp, pricingEditedBy, pricingLocked])

  useEffect(() => {
    if (pricingLocked) return
    if (pricingEditedBy !== 'selling') return
    const discountRaw = String(data.discount_percent ?? '').trim()
    if (discountRaw === '' || discountRaw === '.') return
    const unitsPerPack =
      data.mrp_input_type === 'unit'
        ? 1
        : Math.max(0, Number(data.units_per_pack) || 0)
    if (data.mrp_input_type === 'pack' && !(unitsPerPack > 0)) return
    const preview = computeUnitPricingForAddMedicine(data, unitsPerPack)
    if (!(preview?.unitMrp > 0)) return
    const nextDiscount = preview.discountPct != null ? preview.discountPct.toFixed(2) : '0.00'
    if (String(data.discount_percent ?? '') === nextDiscount) return
    setData((d) => ({ ...d, discount_percent: nextDiscount }))
  }, [data.mrp, data.selling_price, data.mrp_input_type, data.units_per_pack, pricingEditedBy, pricingLocked, data.discount_percent])

  useEffect(() => {
    if (!data.add_batch) return
    if (data.mrp_input_type !== 'pack') {
      if (data.opening_stock_pack_qty !== '') {
        setData((d) => ({ ...d, opening_stock_pack_qty: '' }))
      }
      return
    }
    if (!(openingUnitsPerPack > 0)) {
      if (data.opening_stock_pack_qty !== '') {
        setData((d) => ({ ...d, opening_stock_pack_qty: '' }))
      }
      return
    }
    if (openingStockEditedBy === 'pack') {
      const packs = Number(data.opening_stock_pack_qty)
      if (data.opening_stock_pack_qty !== '' && Number.isFinite(packs) && packs >= 0) {
        const unitsValue = packs * openingUnitsPerPack
        const normalizedUnits = String(Math.round(unitsValue))
        if (normalizedUnits !== data.opening_stock_qty) {
          setData((d) => ({ ...d, opening_stock_qty: normalizedUnits }))
        }
      }
      return
    }
    const unitsValue = Number(data.opening_stock_qty)
    if (data.opening_stock_qty !== '' && Number.isFinite(unitsValue) && unitsValue >= 0) {
      const packs = unitsValue / openingUnitsPerPack
      const normalizedPacks = formatStockNumber(packs)
      if (normalizedPacks !== data.opening_stock_pack_qty) {
        setData((d) => ({ ...d, opening_stock_pack_qty: normalizedPacks }))
      }
    }
  }, [
    data.add_batch,
    data.mrp_input_type,
    data.opening_stock_pack_qty,
    data.opening_stock_qty,
    openingStockEditedBy,
    openingUnitsPerPack,
  ])

  function handleOpeningStockUnitsChange(rawValue) {
    const normalized = normalizeNonNegativeIntegerInput(rawValue)
    if (normalized === null) return
    setOpeningStockEditedBy('units')
    if (normalized === '') {
      setData((d) => ({ ...d, opening_stock_qty: '', opening_stock_pack_qty: '' }))
      return
    }
    const unitsValue = Number(normalized)
    if (data.mrp_input_type === 'pack' && openingUnitsPerPack > 0) {
      const packValue = formatStockNumber(unitsValue / openingUnitsPerPack)
      setData((d) => ({ ...d, opening_stock_qty: normalized, opening_stock_pack_qty: packValue }))
    } else {
      setData((d) => ({ ...d, opening_stock_qty: normalized, opening_stock_pack_qty: '' }))
    }
  }

  function handleOpeningStockPackChange(rawValue) {
    const normalized = normalizeNonNegativeNumberInput(rawValue)
    if (normalized === null) return
    setOpeningStockEditedBy('pack')
    if (normalized === '') {
      setData((d) => ({ ...d, opening_stock_pack_qty: '', opening_stock_qty: '' }))
      return
    }
    if (!(openingUnitsPerPack > 0)) {
      setData((d) => ({ ...d, opening_stock_pack_qty: normalized }))
      return
    }
    const packsValue = Number(normalized)
    const unitsValue = String(Math.round(packsValue * openingUnitsPerPack))
    setData((d) => ({ ...d, opening_stock_pack_qty: normalized, opening_stock_qty: unitsValue }))
  }

  async function handleAdd() {
    if (!data.name.trim()) return toast.error('Product name is required')
    if (!data.hsn_code.trim()) return toast.error('HSN code is required')
    if (!data.form.trim()) return toast.error('Category is required')
    if (!(Number(data.mrp) > 0)) return toast.error('MRP is required')
    const unitsPerPack =
      data.mrp_input_type === 'unit'
        ? 1
        : Math.max(0, Number(data.units_per_pack) || 0)
    if (!(unitsPerPack > 0)) return toast.error('Units per pack is required')
    if (data.add_batch && data.batch_mode === 'new' && !data.batch_no.trim()) return toast.error('Batch number is required')
    if (data.add_batch && data.batch_mode === 'new' && !data.expiry_date) return toast.error('Expiry date is required')
    if (data.add_batch && data.batch_mode === 'existing' && !data.existing_batch_id) {
      return toast.error('Select an existing batch')
    }
    const openStockRaw = String(data.opening_stock_qty ?? '').trim()
    if (data.add_batch && openStockRaw !== '') {
      const oq = Number(openStockRaw)
      if (!Number.isFinite(oq) || oq < 0) {
        return toast.error('Opening stock must be zero or a positive number')
      }
      if (!Number.isInteger(oq)) {
        return toast.error('Opening stock must be a whole number')
      }
    }
    const { unitMrp, unitSale, unitCost } = computeUnitPricingForAddMedicine(data, unitsPerPack)
    if (!(unitMrp > 0)) {
      return toast.error('Derived unit MRP must be greater than zero')
    }
    if (!(unitSale > 0)) {
      return toast.error('Selling price must be greater than zero')
    }
    if (unitCost < 0) {
      return toast.error('Cost cannot be negative')
    }
    const unitId = units[0]?.id
    setSubmitting(true)
    try {
      let gstNum
      if (data.no_gst) {
        gstNum = 0
      } else {
        const t = String(data.gst_percent ?? '').trim()
        gstNum = t === '' ? Number(fallbackGstStr) : Number(t)
        if (!Number.isFinite(gstNum) || gstNum < 0) {
          toast.error('GST % must be zero or a valid number')
          setSubmitting(false)
          return
        }
      }
      const createdSku = `SKU-${Date.now()}`
      const medRes = await api.post('/medicines/', {
        sku: createdSku,
        name: data.name.trim(),
        name_on_bill: (data.name_on_bill || '').trim(),
        company_name: data.company_name.trim(),
        hsn_code: data.hsn_code.trim(),
        form: data.form.trim(),
        ...(data.category ? { category: data.category } : {}),
        composition: data.composition.trim(),
        strength: data.composition.trim(),
        pack_info: `1x${unitsPerPack}`,
        default_mrp: unitMrp.toFixed(2),
        unit_conversions: { strip: unitsPerPack },
        gst_percent: String(gstNum),
        ...(unitId ? { unit: unitId } : {}),
      })
      const createdMedicine = medRes?.data?.data || medRes?.data?.entity || medRes?.data
      let createdMedicineId = createdMedicine?.id
      if (createdMedicineId) {
        onMedicineCreated?.({
          ...(createdMedicine && typeof createdMedicine === 'object' ? createdMedicine : {}),
          id: createdMedicineId,
          name: String(createdMedicine?.name || data.name || '').trim(),
          pack_info: createdMedicine?.pack_info || `1x${unitsPerPack}`,
        })
      }
      if (!createdMedicineId) {
        const lookupRes = await api.get(`/medicines/?search=${encodeURIComponent(createdSku)}&limit=5`)
        const lookupRows = lookupRes?.data?.data || lookupRes?.data?.results || []
        const matched = Array.isArray(lookupRows)
          ? lookupRows.find((m) => String(m?.sku || '').trim() === createdSku)
          : null
        createdMedicineId = matched?.id
      }
      if (!createdMedicineId) {
        throw new Error('Medicine saved, but could not resolve created id for batch creation')
      }
      if (data.add_batch) {
        const existing = batchOptions.find((b) => String(b.id) === String(data.existing_batch_id))
        const batchNo = data.batch_mode === 'existing' ? (existing?.batch_no || '').trim() : data.batch_no.trim()
        const expiryDate = data.batch_mode === 'existing' ? existing?.expiry_date : data.expiry_date
        const batchUnitCost =
          data.batch_mode === 'existing' ? String(existing?.unit_cost ?? '0') : unitCost.toFixed(2)
        const batchMrp = data.batch_mode === 'existing' ? String(existing?.mrp ?? unitMrp.toFixed(2)) : unitMrp.toFixed(2)
        const batchSaleRate =
          data.batch_mode === 'existing' ? String(existing?.sale_rate ?? unitMrp.toFixed(2)) : unitSale.toFixed(2)
        const batchRes = await api.post('/batches/', {
          medicine: createdMedicineId,
          batch_no: batchNo,
          expiry_date: expiryDate,
          unit_cost: batchUnitCost,
          mrp: batchMrp,
          sale_rate: batchSaleRate,
        })
        const batchPayload = batchRes?.data?.data ?? batchRes?.data?.entity ?? batchRes?.data
        const newBatchId = batchPayload?.id ?? batchRes?.data?.id
        const openStockRaw = String(data.opening_stock_qty ?? '').trim()
        const openQty = openStockRaw === '' ? 0 : Number(openStockRaw)
        let openingStockRecorded = false
        if (newBatchId && Number.isFinite(openQty) && openQty > 0) {
          try {
            await api.post('/stock-ledgers/', {
              medicine: createdMedicineId,
              batch: newBatchId,
              reason: 'stock_in',
              qty_change: String(openQty),
              reference_type: 'opening_stock',
              reference_id: 'create_product',
            })
            openingStockRecorded = true
          } catch (stockErr) {
            toast.error(
              parseApiError(stockErr) || 'Product saved, but opening stock could not be recorded. Adjust stock from Inventory.',
            )
          }
        } else if (openQty > 0 && !newBatchId) {
          toast.error('Batch was created but the response did not include an id; add stock from Inventory.')
        }
        const wantedOpening = Number.isFinite(openQty) && openQty > 0
        if (wantedOpening && openingStockRecorded) {
          toast.success('Medicine, batch, and opening stock saved')
        } else {
          toast.success('Medicine and batch created')
        }
      } else {
        toast.success('Medicine created (not visible in Inventory until a batch is added)')
      }
      saveHsnHistory(data.hsn_code)
      setHsnHistory(getHsnHistory())
      onRefresh()
      onClose()
    } catch (e) {
      const detail =
        e?.response?.data?.detail ||
        e?.response?.data?.message ||
        (typeof e?.response?.data === 'string' ? e.response.data : '') ||
        e?.message
      toast.error(detail || 'Could not create medicine')
    } finally {
      setSubmitting(false)
    }
  }

  const trimmedForm = (data.form || '').trim()
  const formExists = forms.some((f) => f.toLowerCase() === trimmedForm.toLowerCase())

  async function handleCreateForm() {
    const name = (data.form || '').trim()
    if (!name) {
      toast.error('Type a category name first')
      return
    }
    if (forms.some((f) => f.toLowerCase() === name.toLowerCase())) {
      toast('Category already exists')
      return
    }
    setCreatingForm(true)
    try {
      const res = await api.post('/medicine-categories/', { name, is_active: true })
      const created = res?.data?.data || res?.data?.entity || res?.data
      if (created?.id) {
        setMedicineCategoryRows((prev) => [...prev, created])
      }
      setForms((prev) => uniqText([name, ...prev]))
      setData((d) => ({ ...d, form: name }))
      setCategoryPathIds(created?.id ? [String(created.id)] : [])
      toast.success('Category added')
    } catch {
      toast.error('Could not add category')
    } finally {
      setCreatingForm(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-[200] flex items-center justify-center p-2 md:p-3">
      <div className="bg-white w-[94vw] md:w-[min(72rem,96vw)] max-w-6xl max-h-[90vh] flex flex-col rounded-xl shadow-xl border border-slate-200 overflow-hidden origin-center scale-[0.88] md:scale-[0.92] lg:scale-[0.95]">
        <div className="p-2 shrink-0 border-b border-slate-100 flex justify-between items-center">
          <h3 className="text-[15px] font-bold text-slate-900">Create New Product</h3>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-600">
            <X size={16} />
          </button>
        </div>
        <div className="p-2 overflow-y-auto min-h-0 flex-1">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 md:gap-4 md:items-start">
            <section className="space-y-1 min-w-0 md:border-r md:border-slate-200 md:pr-3">
              <p className="text-[10px] font-bold tracking-wide text-slate-500 uppercase">Product info</p>
              <div className="grid grid-cols-1 gap-1.5">
                <label className="block">
                  <span className="text-[10px] font-semibold text-slate-700">Nick name*</span>
                  <input
                    type="text"
                    value={data.name}
                    onChange={(e) => setData({ ...data, name: e.target.value })}
                    placeholder="Internal name for staff"
                    className="mt-1 w-full h-7 border border-slate-300 rounded px-2 text-[11px] outline-none focus:border-blue-500"
                  />
                </label>
                <label className="block">
                  <span className="text-[10px] font-semibold text-slate-700">Name on bill (optional)</span>
                  <input
                    type="text"
                    value={data.name_on_bill}
                    onChange={(e) => setData({ ...data, name_on_bill: e.target.value })}
                    placeholder="Printed on invoice; else nick name"
                    className="mt-1 w-full h-7 border border-slate-300 rounded px-2 text-[11px] outline-none focus:border-blue-500"
                  />
                </label>
                <label className="block">
                  <span className="text-[10px] font-semibold text-slate-700">Company Name</span>
                  <input
                    type="text"
                    value={data.company_name}
                    onChange={(e) => setData({ ...data, company_name: e.target.value })}
                    placeholder="Optional"
                    className="mt-1 w-full h-7 border border-slate-300 rounded px-2 text-[11px] outline-none focus:border-blue-500"
                  />
                </label>
                <label className="block">
                  <span className="text-[10px] font-semibold text-slate-700">HSN Code*</span>
                  <div className="relative mt-1" ref={hsnWrapperRef}>
                    <input
                      type="text"
                      value={data.hsn_code}
                      onChange={(e) => {
                        setData({ ...data, hsn_code: e.target.value })
                        setHsnDropdownOpen(true)
                      }}
                      onFocus={() => setHsnDropdownOpen(true)}
                      onBlur={(e) => {
                        if (!hsnWrapperRef.current?.contains(e.relatedTarget)) {
                          setHsnDropdownOpen(false)
                        }
                      }}
                      onKeyDown={(e) => { if (e.key === 'Escape') setHsnDropdownOpen(false) }}
                      placeholder="Enter HSN code"
                      className="w-full h-7 border border-slate-300 rounded px-2 text-[11px] outline-none focus:border-blue-500"
                    />
                    {hsnDropdownOpen && (() => {
                      const q = data.hsn_code.trim().toLowerCase()
                      const filtered = hsnHistory.filter((h) => !q || h.toLowerCase().includes(q))
                      if (!filtered.length) return null
                      return (
                        <ul
                          className="absolute z-50 left-0 right-0 top-full mt-0.5 bg-white border border-slate-200 rounded shadow-lg max-h-44 overflow-y-auto"
                          onMouseDown={(e) => e.preventDefault()}
                        >
                          {filtered.map((h) => (
                            <li
                              key={h}
                              className="px-2.5 py-1.5 text-[11px] text-slate-700 hover:bg-blue-50 hover:text-blue-700 cursor-pointer"
                              onClick={() => { setData({ ...data, hsn_code: h }); setHsnDropdownOpen(false) }}
                            >
                              {h}
                            </li>
                          ))}
                        </ul>
                      )
                    })()}
                  </div>
                </label>
                <div className="block">
                  <span className="text-[10px] font-semibold text-slate-700">Categories*</span>
                  <div className="mt-1 space-y-1.5">
                    <>
                      <button
                        type="button"
                        onClick={() => setCategoryPickerOpen((o) => !o)}
                        className="w-full flex items-center justify-between gap-2 min-h-8 border border-slate-300 rounded px-2 py-1 text-[11px] text-left bg-white hover:bg-slate-50 outline-none focus:border-blue-500"
                      >
                        <span className="truncate text-slate-800">
                          {categoryBreadcrumb || data.form?.trim() || 'Browse categories…'}
                        </span>
                        <ChevronRight size={14} className="text-slate-400 shrink-0" sx={{ transform: 'rotate(90deg)' }} />
                      </button>
                      {roots.length === 0 && medicineCategoryRows.length === 0 ? (
                        <p className="text-[10px] text-amber-800 bg-amber-50 border border-amber-100 rounded px-2 py-1">
                          No saved folders yet — open the picker for presets, or type below / add under Settings.
                        </p>
                      ) : null}
                      {categoryPickerOpen &&
                        createPortal(
                          <div
                            className="fixed inset-0 z-[400] flex items-center justify-center p-4 bg-slate-900/45"
                            onClick={() => setCategoryPickerOpen(false)}
                            role="presentation"
                          >
                            <div
                              className="flex h-[min(85vh,32rem)] w-full max-w-lg flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl"
                              onClick={(e) => e.stopPropagation()}
                              role="dialog"
                              aria-modal="true"
                              aria-labelledby="category-picker-title"
                            >
                              <div className="flex shrink-0 items-center justify-between gap-2 border-b border-slate-100 px-3 py-2">
                                <h4 id="category-picker-title" className="text-sm font-bold text-slate-900">
                                  Select category
                                </h4>
                                <button
                                  type="button"
                                  onClick={() => setCategoryPickerOpen(false)}
                                  className="rounded p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-800"
                                  aria-label="Close"
                                >
                                  <X size={18} />
                                </button>
                              </div>
                              <div className="shrink-0 border-b border-slate-100 p-2">
                                <input
                                  type="text"
                                  value={categorySearch}
                                  onChange={(e) => setCategorySearch(e.target.value)}
                                  placeholder="Search all names or browse lists below…"
                                  className="h-7 w-full rounded border border-slate-200 px-2 text-[11px]"
                                  autoFocus
                                />
                              </div>
                              <div className="min-h-0 flex-1 overflow-y-auto py-1">
                                {categorySearch.trim() ? (
                                  filteredFlatNames.length === 0 ? (
                                    <div className="px-3 py-4 text-[11px] text-slate-500">No matches</div>
                                  ) : (
                                    filteredFlatNames.slice(0, 500).map((n, idx) => {
                                      const row = medicineCategoryRows.find(
                                        (r) => normalizeCategoryName(r.name) === normalizeCategoryName(n),
                                      )
                                      const label =
                                        row?.id != null ? categoryPathLabel(row.id, idToRow) || n : n
                                      return (
                                        <button
                                          key={`${n}-${idx}`}
                                          type="button"
                                          onClick={() => pickFromSearchList(n)}
                                          className="w-full border-b border-slate-50 px-3 py-1.5 text-left text-[11px] text-slate-800 last:border-b-0 hover:bg-slate-50"
                                        >
                                          <span className="block truncate" title={label}>
                                            {label}
                                          </span>
                                        </button>
                                      )
                                    })
                                  )
                                ) : (
                                  <div className="flex flex-col gap-0">
                                    {roots.length > 0 ? (
                                      <>
                                        <div className="px-3 pb-0.5 pt-1 text-[9px] font-bold uppercase tracking-wide text-slate-500">
                                          Nested folders
                                        </div>
                                        <CategoryPickerTreeRows
                                          nodes={roots}
                                          depth={0}
                                          childrenOf={childrenOf}
                                          expandedIds={expandedCategoryIds}
                                          onToggleExpand={toggleCategoryExpand}
                                          onSelectRow={selectCategoryRow}
                                        />
                                        <div className="mx-2 my-2 border-t border-slate-100" />
                                      </>
                                    ) : null}
                                    <div className="px-3 pb-0.5 pt-1 text-[9px] font-bold uppercase tracking-wide text-slate-500">
                                      All category names (presets · medicines · folders)
                                    </div>
                                    {sortedAllFlatCategoryNames.length === 0 ? (
                                      <div className="px-3 py-2 text-[11px] text-slate-500">No labels loaded</div>
                                    ) : (
                                      sortedAllFlatCategoryNames.map((n, idx) => {
                                        const row = medicineCategoryRows.find(
                                          (r) => normalizeCategoryName(r.name) === normalizeCategoryName(n),
                                        )
                                        const label =
                                          row?.id != null ? categoryPathLabel(row.id, idToRow) || n : n
                                        return (
                                          <button
                                            key={`flat-${n}-${idx}`}
                                            type="button"
                                            onClick={() => pickFromSearchList(n)}
                                            className="w-full border-b border-slate-50 px-3 py-1.5 text-left text-[11px] text-slate-800 last:border-b-0 hover:bg-slate-50"
                                          >
                                            <span className="block truncate" title={label}>
                                              {label}
                                            </span>
                                          </button>
                                        )
                                      })
                                    )}
                                  </div>
                                )}
                              </div>
                            </div>
                          </div>,
                          document.body,
                        )}
                    </>
                    <label className="block">
                      <span className="text-[9px] text-slate-500">Or type manually</span>
                      <input
                        type="text"
                        value={data.form}
                        onChange={(e) => {
                          setCategoryPathIds([])
                          setData({ ...data, form: e.target.value, category: '' })
                        }}
                        placeholder="Category label stored on the medicine"
                        className="mt-0.5 w-full h-7 border border-slate-300 rounded px-2 text-[11px] outline-none focus:border-blue-500"
                      />
                    </label>
                    {!formExists && trimmedForm ? (
                      <button
                        type="button"
                        onClick={handleCreateForm}
                        disabled={creatingForm}
                        className="w-full text-left px-2 py-1.5 text-[11px] font-semibold text-blue-700 border border-blue-100 rounded bg-blue-50/80 hover:bg-blue-50 disabled:opacity-50"
                      >
                        {creatingForm ? 'Adding category…' : `+ Save "${trimmedForm}" as new top-level category`}
                      </button>
                    ) : null}
                  </div>
                </div>
                <label className="block">
                  <span className="text-[10px] font-semibold text-slate-700">Composition</span>
                  <input
                    type="text"
                    value={data.composition}
                    onChange={(e) => setData({ ...data, composition: e.target.value })}
                    placeholder="Optional"
                    className="mt-1 w-full h-7 border border-slate-300 rounded px-2 text-[11px] outline-none focus:border-blue-500"
                  />
                </label>
              </div>
            </section>

            <section className="space-y-1 min-w-0 border-t border-slate-100 pt-3 mt-1 md:mt-0 md:pt-0 md:border-t-0 md:border-r md:border-slate-200 md:pr-3">
              <p className="text-[10px] font-bold tracking-wide text-slate-500 uppercase">Pricing</p>
              {pricingLocked && (
                <p className="text-[9px] text-slate-600 bg-slate-100 border border-slate-200 rounded px-2 py-1">
                  MRP, selling price, and cost are taken from the selected batch and cannot be edited. You can still
                  switch <strong>1 unit</strong> vs <strong>Full pack</strong> and set <strong>Units / pack</strong> for
                  how amounts are shown; opening stock and tax in <strong>Stock and Tax info</strong> stay editable.
                </p>
              )}
              <div className="grid grid-cols-1 gap-1.5">
                <label className="block">
                  <span className="text-[10px] font-semibold text-slate-700">Price Input Type</span>
                  <div className="mt-1 grid grid-cols-2 gap-1.5 w-full">
                    <button
                      type="button"
                      onClick={() => {
                        setOpeningStockEditedBy('units')
                        setData((d) => ({ ...d, mrp_input_type: 'unit', units_per_pack: '1' }))
                      }}
                      className={`border rounded-md px-2 py-0.5 text-[10px] font-semibold ${
                        data.mrp_input_type === 'unit'
                          ? 'bg-blue-600 border-blue-600 text-white'
                          : 'bg-white border-slate-300 text-slate-700'
                      }`}
                    >
                      1 unit
                    </button>
                    <button
                      type="button"
                      onClick={() => setData((d) => ({ ...d, mrp_input_type: 'pack' }))}
                      className={`border rounded-md px-2 py-0.5 text-[10px] font-semibold ${
                        data.mrp_input_type === 'pack'
                          ? 'bg-blue-600 border-blue-600 text-white'
                          : 'bg-white border-slate-300 text-slate-700'
                      }`}
                    >
                      Full pack
                    </button>
                  </div>
                </label>
                <label className="block">
                  <span className="text-[10px] font-semibold text-slate-700">
                    MRP* {data.mrp_input_type === 'pack' ? '(per pack)' : '(per unit)'}
                  </span>
                  <input
                    type="number"
                    value={data.mrp}
                    onChange={(e) => setData({ ...data, mrp: e.target.value })}
                    placeholder="0.00"
                    disabled={pricingLocked}
                    className="mt-1 w-full h-7 border border-slate-300 rounded px-2 text-[11px] outline-none focus:border-blue-500 disabled:bg-slate-100 disabled:text-slate-600 disabled:cursor-not-allowed"
                  />
                </label>
                <label className="block">
                  <span className="text-[10px] font-semibold text-slate-700">Units / Pack*</span>
                  <input
                    type="number"
                    value={data.units_per_pack}
                    onChange={(e) => setData({ ...data, units_per_pack: e.target.value })}
                    placeholder={data.mrp_input_type === 'unit' ? '1 (fixed)' : 'e.g. 10'}
                    disabled={data.mrp_input_type === 'unit'}
                    className="mt-1 w-full h-7 border border-slate-300 rounded px-2 text-[11px] outline-none focus:border-blue-500 disabled:bg-slate-100 disabled:text-slate-500"
                  />
                  {data.form?.trim() && conversionHints.length > 0 && (
                    <ul className="mt-1 space-y-0.5 text-[9px] text-indigo-800 font-medium list-disc pl-3.5">
                      {conversionHints.map((line, idx) => (
                        <li key={`${idx}-${line}`}>{line}</li>
                      ))}
                    </ul>
                  )}
                </label>
                <label className="block">
                  <span className="text-[10px] font-semibold text-slate-700">
                    Selling price {data.mrp_input_type === 'pack' ? '(per pack)' : '(per unit)'}
                  </span>
                  <input
                    type="number"
                    value={data.selling_price}
                    onChange={(e) => {
                      setPricingEditedBy('selling')
                      setData({ ...data, selling_price: e.target.value })
                    }}
                    placeholder="Leave empty to use MRP"
                    disabled={pricingLocked}
                    className="mt-1 w-full h-7 border border-slate-300 rounded px-2 text-[11px] outline-none focus:border-blue-500 disabled:bg-slate-100 disabled:text-slate-600 disabled:cursor-not-allowed"
                  />
                </label>
                <label className="block">
                  <span className="text-[10px] font-semibold text-slate-700">
                    Cost price {data.mrp_input_type === 'pack' ? '(per pack)' : '(per unit)'}
                  </span>
                  <input
                    type="number"
                    min={0}
                    value={data.cost_price}
                    onChange={(e) => setData({ ...data, cost_price: e.target.value })}
                    placeholder="Optional — purchase rate"
                    disabled={pricingLocked}
                    className="mt-1 w-full h-7 border border-slate-300 rounded px-2 text-[11px] outline-none focus:border-blue-500 disabled:bg-slate-100 disabled:text-slate-600 disabled:cursor-not-allowed"
                  />
                </label>
                <label className="block">
                  <span className="text-[10px] font-semibold text-slate-700">Discount %</span>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={data.discount_percent}
                    onFocus={(e) => {
                      setPricingEditedBy('discount')
                      if (String(data.discount_percent) === '0') {
                        e.target.select()
                      }
                    }}
                    onChange={(e) => {
                      setPricingEditedBy('discount')
                      const v = normalizeDiscountPercentInput(e.target.value, data.discount_percent)
                      setData({ ...data, discount_percent: v })
                    }}
                    placeholder="0"
                    disabled={pricingLocked}
                    className="mt-1 w-full h-7 border border-slate-300 rounded px-2 text-[11px] outline-none focus:border-blue-500 disabled:bg-slate-100 disabled:text-slate-600 disabled:cursor-not-allowed"
                  />
                  <p className="mt-0.5 text-[9px] text-slate-400">
                    Enter selling price to auto-calc discount, or enter discount to auto-calc selling price.
                  </p>
                </label>
              </div>
            </section>

            <section className="space-y-1 min-w-0 border-t border-slate-100 pt-3 mt-1 md:mt-0 md:pt-0 md:border-t-0">
              <p className="text-[10px] font-bold tracking-wide text-slate-500 uppercase">Stock and Tax info</p>
              <p className="text-[9px] font-semibold text-slate-500 uppercase tracking-wide">Batch</p>
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={!!data.add_batch}
                  onChange={(e) => setData((d) => ({ ...d, add_batch: e.target.checked }))}
                  className="rounded border-slate-300"
                />
                <span className="text-[10px] text-slate-700 font-medium">Add opening batch now</span>
              </label>
              {data.add_batch && (
                <div className="space-y-1.5">
                  <div className="grid grid-cols-2 gap-1.5 w-full max-w-[320px]">
                    <button
                      type="button"
                      onClick={() => setData((d) => ({ ...d, batch_mode: 'new', existing_batch_id: '' }))}
                      className={`border rounded-md px-2 py-0.5 text-[10px] font-semibold ${
                        data.batch_mode === 'new'
                          ? 'bg-blue-600 border-blue-600 text-white'
                          : 'bg-white border-slate-300 text-slate-700'
                      }`}
                    >
                      Create new batch
                    </button>
                    <button
                      type="button"
                      onClick={() => setData((d) => ({ ...d, batch_mode: 'existing' }))}
                      className={`border rounded-md px-2 py-0.5 text-[10px] font-semibold ${
                        data.batch_mode === 'existing'
                          ? 'bg-blue-600 border-blue-600 text-white'
                          : 'bg-white border-slate-300 text-slate-700'
                      }`}
                    >
                      Use existing batch
                    </button>
                  </div>
                  {data.batch_mode === 'new' ? (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-1.5">
                      <label className="block">
                        <span className="text-[10px] font-semibold text-slate-700">Batch No*</span>
                        <input
                          type="text"
                          value={data.batch_no}
                          onChange={(e) => setData({ ...data, batch_no: e.target.value })}
                          placeholder="e.g. BATCH-001"
                          className="mt-1 w-full h-7 border border-slate-300 rounded px-2 text-[11px] outline-none focus:border-blue-500"
                        />
                      </label>
                      <label className="block">
                        <span className="text-[10px] font-semibold text-slate-700">Expiry Date*</span>
                        <input
                          type="date"
                          value={data.expiry_date}
                          onChange={(e) => setData({ ...data, expiry_date: e.target.value })}
                          className="mt-1 w-full h-7 border border-slate-300 rounded px-2 text-[11px] outline-none focus:border-blue-500"
                        />
                      </label>
                    </div>
                  ) : (
                    <label className="block">
                      <span className="text-[10px] font-semibold text-slate-700">Select Existing Batch*</span>
                      <select
                        value={data.existing_batch_id}
                        onChange={(e) => setData((d) => ({ ...d, existing_batch_id: e.target.value }))}
                        className="mt-1 w-full h-7 border border-slate-300 rounded px-2 text-[11px] outline-none focus:border-blue-500 bg-white"
                      >
                        <option value="">Choose batch...</option>
                        {batchOptions.map((b) => {
                          const q = b.quantity != null ? Number(b.quantity) : null
                          const qStr =
                            q != null && Number.isFinite(q) ? (q % 1 === 0 ? String(q) : q.toFixed(3)) : '—'
                          return (
                            <option key={b.id} value={b.id}>
                              {b.batch_no} | exp {b.expiry_date || '--/--'} | ₹{Number(b.sale_rate || 0).toFixed(2)} | stock{' '}
                              {qStr}
                            </option>
                          )
                        })}
                      </select>
                      <p className="mt-1 text-[10px] text-slate-500">
                        Copies selected batch details (batch no, expiry, rates) to this new product.
                      </p>
                    </label>
                  )}
                </div>
              )}
              <div className="grid grid-cols-1 gap-1.5 pt-1 border-t border-slate-50">
                {data.add_batch && (
                  <div className="block">
                    <span className="text-[9px] font-bold text-slate-500 uppercase tracking-wide">Opening stock</span>
                    <div
                      className={`mt-1 grid gap-1.5 ${data.mrp_input_type === 'pack' ? 'grid-cols-2' : 'grid-cols-1'}`}
                    >
                      {data.mrp_input_type === 'pack' && (
                        <label className="block">
                          <span className="text-[10px] font-semibold text-slate-600">{packFieldLabel(activeCategoryRules)}</span>
                          <input
                            type="number"
                            min={0}
                            step="any"
                            value={data.opening_stock_pack_qty}
                            onChange={(e) => handleOpeningStockPackChange(e.target.value)}
                            placeholder="0"
                            disabled={!(openingUnitsPerPack > 0)}
                            className="mt-0.5 w-full h-7 border border-slate-300 rounded px-2 text-[11px] outline-none focus:border-blue-500 disabled:bg-slate-100 disabled:text-slate-500"
                          />
                        </label>
                      )}
                      <label className="block">
                        <span className="text-[10px] font-semibold text-slate-600">{baseFieldLabel(activeCategoryRules)}</span>
                        <input
                          type="number"
                          min={0}
                          step={1}
                          value={data.opening_stock_qty}
                          onChange={(e) => handleOpeningStockUnitsChange(e.target.value)}
                          placeholder="0"
                          className="mt-0.5 w-full h-7 border border-slate-300 rounded px-2 text-[11px] outline-none focus:border-blue-500"
                        />
                      </label>
                    </div>
                    <p className="mt-0.5 text-[9px] text-slate-500">
                      {data.mrp_input_type === 'unit'
                        ? `Enter opening stock in ${baseFieldLabel(activeCategoryRules).toLowerCase()} (same as inventory when pricing per unit).`
                        : openingUnitsPerPack > 0
                          ? `Linked: 1 ${packFieldLabel(activeCategoryRules).toLowerCase()} = ${openingUnitsPerPack} ${baseFieldLabel(activeCategoryRules).toLowerCase()} (edit either side).`
                          : `Set Units / Pack in Pricing first${data.form?.trim() ? ` — labels follow category “${data.form.trim()}”` : ''}.`}
                    </p>
                  </div>
                )}
                <div>
                  <span className="text-[9px] font-bold text-slate-500 uppercase tracking-wide">Tax</span>
                </div>
                <label className="block">
                  <span className="text-[10px] font-semibold text-slate-700">Tax Mode</span>
                  <div className="mt-1 grid grid-cols-2 gap-1.5">
                    <button
                      type="button"
                      onClick={() => setData((d) => ({ ...d, price_tax_mode: 'exclusive' }))}
                      className={`border rounded-md px-2 py-0.5 text-[10px] font-semibold ${
                        data.price_tax_mode === 'exclusive'
                          ? 'bg-blue-600 border-blue-600 text-white'
                          : 'bg-white border-slate-300 text-slate-700'
                      }`}
                    >
                      Excluded
                    </button>
                    <button
                      type="button"
                      onClick={() => setData((d) => ({ ...d, price_tax_mode: 'inclusive' }))}
                      className={`border rounded-md px-2 py-0.5 text-[10px] font-semibold ${
                        data.price_tax_mode === 'inclusive'
                          ? 'bg-blue-600 border-blue-600 text-white'
                          : 'bg-white border-slate-300 text-slate-700'
                      }`}
                    >
                      Included
                    </button>
                  </div>
                </label>
                <label className="block">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-semibold text-slate-700">GST %</span>
                    <label className="flex items-center gap-1.5 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={!!data.no_gst}
                        onChange={(e) => {
                          const checked = e.target.checked
                          setData((d) => ({
                            ...d,
                            no_gst: checked,
                            gst_percent: checked ? '0' : d.gst_percent === '0' ? fallbackGstStr : d.gst_percent,
                          }))
                        }}
                        className="rounded border-slate-300"
                      />
                      <span className="text-[10px] text-slate-700">No GST</span>
                    </label>
                  </div>
                  <input
                    type="text"
                    value={data.gst_percent}
                    onChange={(e) => setData({ ...data, gst_percent: e.target.value, no_gst: false })}
                    placeholder={fallbackGstStr}
                    disabled={!!data.no_gst}
                    className="mt-1 w-full h-7 border border-slate-300 rounded px-2 text-[11px] outline-none focus:border-blue-500 disabled:bg-slate-100 disabled:text-slate-500"
                  />
                </label>
                <p className="text-[10px] text-slate-500">
                  {(() => {
                    if (!unitPricingPreview || !(unitPricingPreview.unitSale > 0)) {
                      return 'Enter MRP, units/pack, and selling price to preview GST on the unit sale rate.'
                    }
                    const unitBill = unitPricingPreview.unitSale
                    const gstPct = data.no_gst ? 0 : Math.max(0, Number(data.gst_percent || fallbackGstStr) || 0)
                    if (gstPct <= 0) return `Unit sale rate: ₹${unitBill.toFixed(2)} (No GST)`
                    if (data.price_tax_mode === 'inclusive') {
                      const base = unitBill / (1 + gstPct / 100)
                      const gstAmt = unitBill - base
                      return `GST included ${gstPct}% on sale rate: base ₹${base.toFixed(2)} + GST ₹${gstAmt.toFixed(2)}`
                    }
                    const gstAmt = unitBill * (gstPct / 100)
                    return `GST excluded ${gstPct}% on sale rate: taxable ₹${unitBill.toFixed(2)} + GST ₹${gstAmt.toFixed(2)}`
                  })()}
                </p>
              </div>
            </section>
          </div>
        </div>
        <div className="p-2 shrink-0 border-t border-slate-100 flex justify-end bg-white">
          <button
            type="button"
            onClick={handleAdd}
            disabled={submitting}
            className="bg-blue-600 text-white font-semibold h-8 rounded-md px-5 text-[13px] disabled:opacity-50 inline-flex items-center justify-center gap-2"
          >
            {submitting ? 'Creating…' : (
              <>
                <Plus size={16} /> Create
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  )
}

/** Split search text into first / last name (e.g. "john smith" → John + Smith). */
function splitPatientSearchName(raw) {
  const text = String(raw || '').trim()
  if (!text) return { first_name: '', last_name: '' }
  const parts = text.split(/\s+/).filter(Boolean)
  if (parts.length === 1) return { first_name: parts[0], last_name: '' }
  return { first_name: parts[0], last_name: parts.slice(1).join(' ') }
}

function AddPatientModal({ onClose, onAdd, initialSearchName = '' }) {
  const [data, setData] = useState({
    first_name: '',
    last_name: '',
    phone: '',
    address_line1: '',
    gender: 'male',
    age: '',
    age_unit: 'years',
    doctor_name: '',
    hospital_name: '',
  })
  const [submitting, setSubmitting] = useState(false)

  React.useEffect(() => {
    const { first_name, last_name } = splitPatientSearchName(initialSearchName)
    setData((prev) => ({
      ...prev,
      first_name: first_name || prev.first_name,
      last_name: last_name || prev.last_name,
    }))
  }, [initialSearchName])

  async function handleAdd() {
    const firstName = (data.first_name || '').trim()
    const lastName = (data.last_name || '').trim()
    const phone = (data.phone || '').trim()
    const addressLine1 = (data.address_line1 || '').trim()
    if (!firstName) {
      toast.error('First name is required')
      return
    }
    setSubmitting(true)
    try {
      const payload = {
        first_name: firstName,
        last_name: lastName,
        phone,
        gender: data.gender || 'other',
        hospital_id: getHospitalId(),
      }
      if (addressLine1) payload.address_line1 = addressLine1
      if (data.age !== '' && data.age != null) {
        payload.age = Number(data.age)
        payload.age_unit = data.age_unit || 'years'
      }
      const res = await api.post('/patients/', payload)
      toast.success('Patient registered')
      const created = res.data?.data || res.data
      onAdd({
        ...created,
        _billingDoctorName: (data.doctor_name || '').trim(),
        _billingHospitalName: (data.hospital_name || '').trim(),
      })
    } catch (err) {
      toast.error(parseApiError(err) || 'Registration failed')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-slate-950/60 z-[9999] flex items-center justify-center p-6">
      <div className="bg-white w-full max-w-md rounded-lg shadow-xl overflow-hidden">
        <div className="p-5">
          <div className="flex justify-between items-center mb-4 border-b border-slate-100 pb-3">
            <h3 className="text-sm font-semibold text-slate-800">New patient</h3>
            <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-600">
              <X size={18} />
            </button>
          </div>
          <div className="space-y-3 grid grid-cols-2 gap-3">
            <label className="col-span-1">
              <span className="text-[10px] font-semibold text-slate-600">First name *</span>
              <input
                value={data.first_name}
                onChange={(e) => setData({ ...data, first_name: e.target.value })}
                className="mt-0.5 w-full border border-slate-300 rounded px-2 py-1.5 text-sm"
              />
            </label>
            <label className="col-span-1">
              <span className="text-[10px] font-semibold text-slate-600">Last name</span>
              <input
                value={data.last_name}
                onChange={(e) => setData({ ...data, last_name: e.target.value })}
                className="mt-0.5 w-full border border-slate-300 rounded px-2 py-1.5 text-sm"
              />
            </label>
            <label className="col-span-1">
              <span className="text-[10px] font-semibold text-slate-600">Mobile</span>
              <input
                value={data.phone}
                onChange={(e) => setData({ ...data, phone: e.target.value })}
                placeholder="Optional"
                className="mt-0.5 w-full border border-slate-300 rounded px-2 py-1.5 text-sm"
              />
            </label>
            <label className="col-span-1">
              <span className="text-[10px] font-semibold text-slate-600">Gender</span>
              <select
                value={data.gender}
                onChange={(e) => setData({ ...data, gender: e.target.value })}
                className="mt-0.5 w-full border border-slate-300 rounded px-2 py-1.5 text-sm"
              >
                <option value="male">Male</option>
                <option value="female">Female</option>
                <option value="other">Other</option>
              </select>
            </label>
            <label className="col-span-1">
              <span className="text-[10px] font-semibold text-slate-600">Age</span>
              <div className="mt-0.5 flex gap-1.5">
                <input
                  type="number"
                  min="0"
                  value={data.age}
                  onChange={(e) => setData({ ...data, age: e.target.value })}
                  placeholder="Optional"
                  className="w-full border border-slate-300 rounded px-2 py-1.5 text-sm"
                />
                <select
                  value={data.age_unit}
                  onChange={(e) => setData({ ...data, age_unit: e.target.value })}
                  className="border border-slate-300 rounded px-2 py-1.5 text-sm bg-white"
                >
                  <option value="years">Years</option>
                  <option value="months">Months</option>
                  <option value="days">Days</option>
                </select>
              </div>
            </label>
            <label className="col-span-2">
              <span className="text-[10px] font-semibold text-slate-600">Address</span>
              <input
                value={data.address_line1}
                onChange={(e) => setData({ ...data, address_line1: e.target.value })}
                placeholder="Optional — shown on bill when filled"
                className="mt-0.5 w-full border border-slate-300 rounded px-2 py-1.5 text-sm"
              />
            </label>
            <label className="col-span-1">
              <span className="text-[10px] font-semibold text-slate-600">Doctor name</span>
              <input
                value={data.doctor_name}
                onChange={(e) => setData({ ...data, doctor_name: e.target.value })}
                placeholder="Optional"
                className="mt-0.5 w-full border border-slate-300 rounded px-2 py-1.5 text-sm"
              />
            </label>
            <label className="col-span-1">
              <span className="text-[10px] font-semibold text-slate-600">Hospital name</span>
              <input
                value={data.hospital_name}
                onChange={(e) => setData({ ...data, hospital_name: e.target.value })}
                placeholder="Optional"
                className="mt-0.5 w-full border border-slate-300 rounded px-2 py-1.5 text-sm"
              />
            </label>
          </div>
          <p className="text-[10px] text-slate-500 mt-2">
            Mobile and address are optional. Doctor and hospital appear on the bill only when filled.
          </p>
          <button
            type="button"
            onClick={handleAdd}
            disabled={submitting}
            className="w-full bg-blue-600 text-white font-medium py-2 rounded mt-4 text-sm disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {submitting ? 'Saving…' : (
              <>
                <UserPlus size={14} /> Register
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// ReturnView — three-screen return flow
// ---------------------------------------------------------------------------

const LIST_PAGE_SIZE = 10
const HIST_PAGE_SIZE = 15

function ReturnView({ outletSettings, onPrint }) {
  // screen: 'list' (search & pick patient) | 'invoices' (patient's bills) | 'detail' (return editor)
  const [screen, setScreen] = useState('list')
  const [q, setQ] = useState('')
  const [listRows, setListRows] = useState([])         // search results
  const [listLoading, setListLoading] = useState(false)
  const [defaultRows, setDefaultRows] = useState([])   // loaded on mount / after return
  const [defaultLoading, setDefaultLoading] = useState(false)
  const [defaultRefreshToken, setDefaultRefreshToken] = useState(0)
  const [listPage, setListPage] = useState(0)
  const [selectedPatient, setSelectedPatient] = useState(null)
  const [patientInvoices, setPatientInvoices] = useState([])
  const [patientLoading, setPatientLoading] = useState(false)
  const [selectedInvoice, setSelectedInvoice] = useState(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [returnQtyById, setReturnQtyById] = useState({})
  const [returnDisplayById, setReturnDisplayById] = useState({})
  const [returnOverById, setReturnOverById] = useState({})
  const [submitting, setSubmitting] = useState(false)
  const [returnDone, setReturnDone] = useState(false)
  const [updatedInvoice, setUpdatedInvoice] = useState(null)
  const [returnRefundAmt, setReturnRefundAmt] = useState(0)
  const [fullCancelModal, setFullCancelModal] = useState(null)
  const [billAutoCancelled, setBillAutoCancelled] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [historyGroups, setHistoryGroups] = useState([])
  const [historyLoading, setHistoryLoading] = useState(false)
  const [historyError, setHistoryError] = useState(null)
  const [histPage, setHistPage] = useState(0)
  const [expandedHistKeys, setExpandedHistKeys] = useState(() => new Set())

  // ── Screen 1: load recent patients on mount + after each return ──────────
  useEffect(() => {
    let cancelled = false
    setDefaultLoading(true)
    api.get('/pharmacy/invoices/', { params: { status: 'finalized', limit: 200 } })
      .then(({ data }) => {
        if (cancelled) return
        const rows = (data?.data || data?.results || []).filter((inv) => inv.patient && inv.patient_details)
        // Group by patient, preserve insertion order (newest first), cap at 50 unique patients
        const map = {}
        const order = []
        for (const inv of rows) {
          const pid = String(inv.patient)
          if (!map[pid]) {
            const pd = inv.patient_details || {}
            const name = [pd.first_name, pd.last_name].filter(Boolean).join(' ').trim() || '—'
            map[pid] = { patient_id: pid, patient_name: name, phone: pd.phone || '', uhid: pd.uhid || '', invoices: [] }
            order.push(pid)
          }
          map[pid].invoices.push(inv)
        }
        setDefaultRows(order.slice(0, 50).map((pid) => map[pid]))
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setDefaultLoading(false) })
    return () => { cancelled = true }
  }, [defaultRefreshToken])

  // ── Screen 1: debounced search ────────────────────────────────────────────
  useEffect(() => {
    if (screen !== 'list') return
    if (!q.trim()) { setListRows([]); return }

    let cancelled = false
    const timer = setTimeout(async () => {
      setListLoading(true)
      try {
        const { data } = await api.get('/pharmacy/invoices/', {
          params: { search: q.trim(), status: 'finalized', limit: 50 },
        })
        if (cancelled) return
        const rows = data?.data || data?.results || []
        setListRows(rows.filter((inv) => inv.patient && inv.patient_details))
      } catch {
        if (!cancelled) toast.error('Search failed')
      } finally {
        if (!cancelled) setListLoading(false)
      }
    }, 400)
    return () => { cancelled = true; clearTimeout(timer) }
  }, [q, screen])

  // Reset page when search query changes
  useEffect(() => { setListPage(0) }, [q])

  // ── Group search rows by patient ──────────────────────────────────────────
  const patientGroups = useMemo(() => {
    const map = {}
    const order = []
    for (const inv of listRows) {
      const pid = String(inv.patient)
      if (!map[pid]) {
        const pd = inv.patient_details || {}
        const name = [pd.first_name, pd.last_name].filter(Boolean).join(' ').trim() || '—'
        map[pid] = { patient_id: pid, patient_name: name, phone: pd.phone || '', uhid: pd.uhid || '', invoices: [] }
        order.push(pid)
      }
      map[pid].invoices.push(inv)
    }
    return order.map((pid) => map[pid])
  }, [listRows])

  // ── Screen 2: patient's finalized invoices ────────────────────────────────
  const loadPatientInvoices = useCallback(async (patient, noNavigate = false) => {
    if (!noNavigate) {
      setSelectedPatient(patient)
      setScreen('invoices')
    }
    setPatientLoading(true)
    try {
      const { data } = await api.get('/pharmacy/invoices/', {
        params: { patient: patient.patient_id, status: 'finalized', limit: 100 },
      })
      setPatientInvoices(data?.data || data?.results || [])
    } catch {
      toast.error('Failed to load invoices')
      setPatientInvoices([])
    } finally {
      setPatientLoading(false)
    }
  }, [])

  // ── Screen 3: full invoice detail ─────────────────────────────────────────
  const openReturnDetail = useCallback(async (inv) => {
    setScreen('detail')
    setReturnDone(false)
    setUpdatedInvoice(null)
    setReturnQtyById({})
    setReturnDisplayById({})
    setReturnOverById({})
    setFullCancelModal(null)
    setBillAutoCancelled(false)
    setDetailLoading(true)
    try {
      const { data } = await api.get(`/pharmacy/invoices/${inv.id}/`)
      const full = data?.data || data || inv
      setSelectedInvoice(full)
    } catch {
      toast.error('Failed to load invoice')
      setSelectedInvoice(inv)
    } finally {
      setDetailLoading(false)
    }
  }, [])

  // ── Shared: recreate missing batches before any return/cancel API call ─────
  const recreateMissingBatches = useCallback(async (invoice, qtyById) => {
    const overrides = {}
    for (const item of invoice.items || []) {
      if (item.batch !== null) continue
      if (!((qtyById[item.id] ?? 0) > 0)) continue
      if (!item.snapshot_batch_no) {
        toast.error(`Cannot return ${item.medicine_name || 'item'}: no batch info available`)
        return null
      }
      try {
        const { data: bd } = await api.post('/batches/', {
          medicine: item.medicine,
          batch_no: item.snapshot_batch_no,
          expiry_date: item.snapshot_expiry_date || null,
          unit_cost: item.snapshot_unit_cost || 0,
          mrp: item.mrp || 0,
          sale_rate: item.rate || 0,
        })
        overrides[item.id] = (bd?.data || bd)?.id
      } catch {
        try {
          const { data: found } = await api.get('/batches/', {
            params: { medicine: item.medicine, batch_no: item.snapshot_batch_no, limit: 1 },
          })
          const existing = (found?.data || found?.results || [])[0]
          if (existing?.id) {
            overrides[item.id] = existing.id
          } else {
            toast.error(`Cannot return ${item.medicine_name || 'item'}: batch could not be created`)
            return null
          }
        } catch {
          toast.error(`Cannot return ${item.medicine_name || 'item'}: batch could not be created`)
          return null
        }
      }
    }
    return overrides
  }, [])

  // ── Full-bill cancel (called after user confirms in the popup) ─────────────
  const confirmFullBillCancel = useCallback(async () => {
    if (!selectedInvoice) return
    setFullCancelModal((prev) => ({ ...prev, processing: true }))

    const overrides = await recreateMissingBatches(selectedInvoice, returnQtyById)
    if (overrides === null) {
      setFullCancelModal((prev) => ({ ...prev, processing: false }))
      return
    }

    try {
      const { data } = await api.post(`/pharmacy/invoices/${selectedInvoice.id}/cancel/`, {
        cancel_reason: 'Full return — all items returned',
      })
      const cancelled = data?.data || data
      const refundAmt = Number(selectedInvoice.grand_total || 0)
      setUpdatedInvoice(cancelled)
      setReturnRefundAmt(refundAmt)
      setBillAutoCancelled(true)
      setReturnDone(true)
      setFullCancelModal(null)
      toast.success(`Bill cancelled. Refund: ₹${refundAmt.toFixed(2)}`)
      setDefaultRefreshToken((n) => n + 1)
      if (selectedPatient) loadPatientInvoices(selectedPatient, true)
    } catch (err) {
      const msg = err?.response?.data?.detail || err?.response?.data?.message || 'Cancellation failed'
      toast.error(typeof msg === 'string' ? msg : 'Cancellation failed')
      setFullCancelModal((prev) => ({ ...prev, processing: false }))
    }
  }, [selectedInvoice, returnQtyById, selectedPatient, recreateMissingBatches])

  // ── Submit return ──────────────────────────────────────────────────────────
  const submitReturn = useCallback(async () => {
    if (!selectedInvoice) return
    if (Object.values(returnOverById).some(Boolean)) {
      toast.error('Return quantity exceeds sold quantity for one or more items. Please correct before confirming.')
      return
    }
    const err = validateReturn(selectedInvoice, returnQtyById)
    if (err) { toast.error(err); return }

    // Full return → show cancel confirmation popup instead of submitting
    if (isFullBillReturn(selectedInvoice, returnQtyById)) {
      setFullCancelModal({
        invoice: selectedInvoice,
        refundAmt: Number(selectedInvoice.grand_total || 0),
        processing: false,
      })
      return
    }

    const gstEnabled = Boolean(selectedInvoice.gst_enabled)
    const { newSubtotal, newCgst, newSgst, newGrandTotal } = calcPreviewTotals(
      selectedInvoice.items || [],
      returnQtyById,
      gstEnabled,
    )
    const previewSubtotalPlusTax = newSubtotal + newCgst + newSgst

    setSubmitting(true)

    const batchOverrideById = await recreateMissingBatches(selectedInvoice, returnQtyById)
    if (batchOverrideById === null) {
      setSubmitting(false)
      return
    }

    const invoiceForPayload = Object.keys(batchOverrideById).length > 0
      ? {
          ...selectedInvoice,
          items: (selectedInvoice.items || []).map((it) =>
            batchOverrideById[it.id] ? { ...it, batch: batchOverrideById[it.id] } : it,
          ),
        }
      : selectedInvoice

    const payload = buildReturnPayload(
      invoiceForPayload,
      returnQtyById,
      newGrandTotal,
      previewSubtotalPlusTax,
    )

    try {
      const { data } = await api.patch(`/pharmacy/invoices/${selectedInvoice.id}/update-full/`, payload)
      const updated = data?.data || data
      const refundAmt = Math.max(0, Number(selectedInvoice.grand_total || 0) - Number(updated?.grand_total || 0))
      toast.success(`Return processed. Refund: ₹${refundAmt.toFixed(2)}`)
      setUpdatedInvoice(updated)
      setReturnRefundAmt(refundAmt)
      setReturnDone(true)
      setDefaultRefreshToken((n) => n + 1)
    } catch (err) {
      const msg = err?.response?.data?.detail || err?.response?.data?.message || 'Return failed'
      toast.error(typeof msg === 'string' ? msg : 'Return failed')
    } finally {
      setSubmitting(false)
    }
  }, [selectedInvoice, returnQtyById, returnOverById, recreateMissingBatches])

  // ── Return history (stock ledger return_in + pharmacy_edit) ──────────────
  const openHistory = useCallback(async () => {
    setHistoryOpen(true)
    setHistoryLoading(true)
    setHistoryError(null)
    setHistPage(0)
    setExpandedHistKeys(new Set())
    try {
      const pickRows = (data) => data?.data || data?.results || []
      const [editRes, cancelRes] = await Promise.all([
        api.get('/stock-ledgers/', { params: { reason: 'return_in', reference_type: 'pharmacy_edit', limit: 500 } }),
        api.get('/stock-ledgers/', { params: { reason: 'return_in', reference_type: 'pharmacy_cancel', limit: 500 } }),
      ])
      const rows = [...pickRows(editRes.data), ...pickRows(cancelRes.data)]
      setHistoryGroups(groupReturnHistoryRows(rows))
    } catch (err) {
      const status = err?.response?.status
      if (status === 403) {
        setHistoryError('You do not have permission to view return history.')
      } else {
        setHistoryError('Failed to load return history.')
      }
      setHistoryGroups([])
    } finally {
      setHistoryLoading(false)
    }
  }, [])

  const toggleHistGroup = useCallback((key) => {
    setExpandedHistKeys((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }, [])

  const closeHistory = useCallback(() => {
    setHistoryOpen(false)
    setExpandedHistKeys(new Set())
  }, [])

  // ── Qty display helpers ────────────────────────────────────────────────────
  const b2cOutlet = useMemo(() => resolveOutletForChannel(outletSettings, 'b2c'), [outletSettings])
  const qtyDisplayMode = b2cOutlet?.sale_bill_qty_display || 'base_units'

  // ── Screen renderers ───────────────────────────────────────────────────────
  const gstEnabled = Boolean(selectedInvoice?.gst_enabled)
  const { newSubtotal, newCgst, newSgst, newGrandTotal, totalRefund } = useMemo(
    () => calcPreviewTotals(selectedInvoice?.items || [], returnQtyById, gstEnabled),
    [selectedInvoice, returnQtyById, gstEnabled],
  )
  /** Retail bills settle in whole rupees, matching what update-full will store. */
  const newPayableTotal = useMemo(
    () => (selectedInvoice?.party ? newGrandTotal : computeInvoiceRoundOff(newGrandTotal).payable),
    [newGrandTotal, selectedInvoice?.party],
  )

  if (screen === 'list') {
    const isSearching = q.trim().length > 0
    const activeGroups = isSearching ? patientGroups : defaultRows
    const totalPages = Math.ceil(activeGroups.length / LIST_PAGE_SIZE)
    const pageGroups = activeGroups.slice(listPage * LIST_PAGE_SIZE, (listPage + 1) * LIST_PAGE_SIZE)

    return (
      <div className="relative h-full flex flex-col gap-3 overflow-hidden min-h-0 bg-gradient-to-br from-slate-50 via-white to-rose-50/40 rounded-xl p-3">
        {/* Header row with title, search box and History button */}
        <div className="shrink-0 flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <h2 className="text-base font-bold text-slate-900 mb-2">Returns</h2>
            <div className="relative w-full max-w-sm">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" size={14} />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search by invoice no, patient name or phone…"
                className="w-full rounded-lg border border-slate-200 bg-white pl-8 pr-3 py-1.5 text-xs outline-none focus:border-blue-500"
              />
            </div>
          </div>
          <button
            type="button"
            onClick={openHistory}
            className="shrink-0 flex items-center gap-1 text-xs font-medium text-slate-600 hover:text-blue-600 border border-slate-200 hover:border-blue-400 rounded-lg px-3 py-2 bg-white transition-colors mt-0.5"
          >
            <HistoryIcon size={15} /> History
          </button>
        </div>

        {/* Patient list */}
        <div className="flex-1 min-h-0 overflow-y-auto">
          {(isSearching ? listLoading : defaultLoading) ? (
            <div className="flex items-center justify-center h-32 text-slate-400 text-sm">{isSearching ? 'Searching…' : 'Loading…'}</div>
          ) : activeGroups.length === 0 ? (
            isSearching ? (
              <div className="flex items-center justify-center h-32 text-slate-400 text-sm">No finalized invoices found</div>
            ) : (
              <div className="flex flex-col items-center justify-center h-full gap-3 text-slate-400">
                <ReturnIcon size={40} />
                <p className="text-sm">Search an invoice number, patient name or phone to start a return</p>
              </div>
            )
          ) : (
            <div className="grid gap-2 pt-1">
              {pageGroups.map((pt) => (
                <button
                  key={pt.patient_id}
                  type="button"
                  onClick={() => loadPatientInvoices(pt)}
                  className="w-full text-left bg-white border border-slate-200 hover:border-blue-400 hover:bg-blue-50/40 rounded-xl px-4 py-3 transition-colors group"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 bg-rose-100 rounded-full flex items-center justify-center shrink-0">
                      <PersonIcon size={16} className="text-rose-600" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="font-semibold text-slate-900 text-sm">{pt.patient_name}</div>
                      <div className="text-[10px] text-slate-500">
                        {pt.phone ? `${pt.phone} · ` : ''}{pt.uhid ? `UHID: ${pt.uhid} · ` : ''}{pt.invoices.length} invoice{pt.invoices.length !== 1 ? 's' : ''}
                      </div>
                    </div>
                    <ChevronRight size={16} className="text-slate-400 group-hover:text-blue-500 shrink-0" />
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Pagination */}
        {activeGroups.length > 0 && (
          <div className="shrink-0 flex items-center justify-between text-xs text-slate-600 pt-1 border-t border-slate-100">
            <span>
              {activeGroups.length === 0
                ? 'No patients'
                : `Showing ${listPage * LIST_PAGE_SIZE + 1}–${Math.min((listPage + 1) * LIST_PAGE_SIZE, activeGroups.length)} of ${activeGroups.length}`}
            </span>
            <div className="flex items-center gap-1">
              <button
                type="button"
                disabled={listPage === 0}
                onClick={() => setListPage((p) => p - 1)}
                className="px-2 py-0.5 rounded border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Prev
              </button>
              <span className="px-2">Page {listPage + 1} of {totalPages || 1}</span>
              <button
                type="button"
                disabled={(listPage + 1) * LIST_PAGE_SIZE >= activeGroups.length}
                onClick={() => setListPage((p) => p + 1)}
                className="px-2 py-0.5 rounded border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Next
              </button>
            </div>
          </div>
        )}

        {/* Return History slide-in panel — fixed portal so full viewport (including sidebar) is dimmed */}
        {historyOpen && createPortal(
          <div className="fixed inset-0 flex items-stretch z-[400]">
            {/* Backdrop — covers sidebar + content */}
            <div className="flex-1 bg-black/40" onClick={closeHistory} />
            {/* Panel */}
            <div className="w-full max-w-lg bg-white shadow-2xl flex flex-col overflow-hidden">
              <div className="shrink-0 flex items-center justify-between px-4 py-3 border-b border-slate-200 bg-gradient-to-r from-slate-50 to-white">
                <div className="flex items-center gap-2">
                  <HistoryIcon size={18} className="text-rose-500" />
                  <span className="font-bold text-slate-900 text-sm">Return History</span>
                </div>
                <button type="button" onClick={closeHistory} className="text-slate-400 hover:text-slate-700">
                  <CloseIcon fontSize="small" />
                </button>
              </div>
              <div className="flex-1 overflow-y-auto min-h-0">
                {historyLoading ? (
                  <div className="flex items-center justify-center h-32 text-slate-400 text-sm">Loading…</div>
                ) : historyError ? (
                  <div className="flex items-center justify-center h-32 text-slate-500 text-sm px-4 text-center">{historyError}</div>
                ) : historyGroups.length === 0 ? (
                  <div className="flex items-center justify-center h-32 text-slate-400 text-sm">No return records found</div>
                ) : (
                  <div className="divide-y divide-slate-100">
                    {historyGroups
                      .slice(histPage * HIST_PAGE_SIZE, (histPage + 1) * HIST_PAGE_SIZE)
                      .map((group) => {
                        const expanded = expandedHistKeys.has(group.key)
                        const customerName = group.customerName || 'Patient'
                        const invoiceLabel = group.invoiceNo ? `#${group.invoiceNo}` : (group.referenceId ? `#${String(group.referenceId).slice(0, 8)}` : '#—')
                        const dateStr = group.returnedAt ? safeFormat(group.returnedAt, 'dd MMM yyyy') : '—'
                        return (
                          <div key={group.key} className="bg-white">
                            <button
                              type="button"
                              onClick={() => toggleHistGroup(group.key)}
                              className="w-full flex items-center gap-2 px-3 py-2.5 text-left hover:bg-slate-50/80 transition-colors"
                            >
                              <span className={`shrink-0 text-slate-400 transition-transform ${expanded ? 'rotate-180' : ''}`}>
                                <ExpandMore size={16} />
                              </span>
                              <span className="flex-1 min-w-0 text-[11px]">
                                <span className="font-semibold text-slate-900">{customerName}</span>
                                <span className="text-slate-400 mx-1">·</span>
                                <span className="font-mono text-blue-700">{invoiceLabel}</span>
                                <span className="text-slate-400 mx-1">·</span>
                                <span className="text-slate-500">{dateStr}</span>
                              </span>
                              <span className="shrink-0 text-[11px] font-semibold text-rose-700">
                                {group.refundAmount > 0 ? `₹${group.refundAmount.toFixed(2)}` : '—'}
                              </span>
                              <span className="shrink-0 text-[9px] text-slate-400">{group.items.length} item{group.items.length !== 1 ? 's' : ''}</span>
                            </button>
                            {expanded && (
                              <table className="w-full text-left text-[10px] border-t border-slate-100 bg-slate-50/40">
                                <thead className="text-[9px] font-bold text-slate-500 uppercase">
                                  <tr>
                                    <th className="px-4 py-1.5 pl-9">Medicine</th>
                                    <th className="px-3 py-1.5">Batch</th>
                                    <th className="px-3 py-1.5 text-right">Qty Returned</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {group.items.map((item, i) => (
                                    <tr key={item.id ?? `${group.key}-${i}`} className="border-t border-slate-100/80">
                                      <td className="px-4 py-1.5 pl-9 font-medium text-slate-800">{item.medicine_name}</td>
                                      <td className="px-3 py-1.5 text-slate-500 font-mono">{item.batch_no}</td>
                                      <td className="px-3 py-1.5 text-right text-rose-600 font-semibold">{item.qty_change ?? '—'}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            )}
                          </div>
                        )
                      })}
                  </div>
                )}
              </div>
              {historyGroups.length > 0 && (
                <div className="shrink-0 flex items-center justify-between text-xs text-slate-600 px-3 py-2 border-t border-slate-100 bg-slate-50/70">
                  <span>
                    {`Showing ${histPage * HIST_PAGE_SIZE + 1}–${Math.min((histPage + 1) * HIST_PAGE_SIZE, historyGroups.length)} of ${historyGroups.length}`}
                  </span>
                  <div className="flex gap-1">
                    <button
                      type="button"
                      disabled={histPage === 0}
                      onClick={() => setHistPage((p) => p - 1)}
                      className="px-2 py-1 rounded border border-slate-200 disabled:opacity-40"
                    >
                      Prev
                    </button>
                    <button
                      type="button"
                      disabled={(histPage + 1) * HIST_PAGE_SIZE >= historyGroups.length}
                      onClick={() => setHistPage((p) => p + 1)}
                      className="px-2 py-1 rounded border border-slate-200 disabled:opacity-40"
                    >
                      Next
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>,
          document.body
        )}
      </div>
    )
  }

  if (screen === 'invoices') {
    return (
      <div className="h-full flex flex-col gap-3 overflow-hidden min-h-0 bg-gradient-to-br from-slate-50 via-white to-rose-50/40 rounded-xl p-3">
        <div className="shrink-0 flex items-center gap-2">
          <button
            type="button"
            onClick={() => { setScreen('list'); setSelectedPatient(null); setPatientInvoices([]) }}
            className="flex items-center gap-1 text-xs font-medium text-slate-600 hover:text-blue-600"
          >
            <ArrowBack size={16} /> Back
          </button>
          <span className="text-slate-300">|</span>
          <div>
            <h2 className="text-sm font-bold text-slate-900">{selectedPatient?.patient_name}</h2>
            {selectedPatient?.phone && (
              <span className="text-[10px] text-slate-500">{selectedPatient.phone}</span>
            )}
          </div>
        </div>

        <div className="flex-1 bg-white border border-slate-200 rounded-xl overflow-y-auto min-h-0 shadow-sm">
          <table className="w-full text-left text-[11px]">
            <thead className="bg-gradient-to-b from-slate-100 to-slate-50 sticky top-0 z-10 text-[10px] font-bold text-slate-500 uppercase">
              <tr>
                <th className="px-3 py-2">Invoice</th>
                <th className="px-3 py-2">Date</th>
                <th className="px-3 py-2">Method</th>
                <th className="px-3 py-2 text-right">Paid</th>
                <th className="px-3 py-2 text-right">Due</th>
                <th className="px-3 py-2 text-right">Total</th>
                <th className="px-3 py-2 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {patientLoading ? (
                <tr><td colSpan={7} className="px-3 py-8 text-center text-slate-400">Loading…</td></tr>
              ) : patientInvoices.length === 0 ? (
                <tr><td colSpan={7} className="px-3 py-8 text-center text-slate-400">No finalized invoices found</td></tr>
              ) : patientInvoices.map((inv) => {
                const total = Number(inv.grand_total || 0)
                const paid = Number(inv.paid_amount || 0)
                const due = Math.max(0, Number(inv.due_amount ?? total - paid))
                return (
                  <tr key={inv.id} className="hover:bg-rose-50/30">
                    <td className="px-3 py-2 font-mono text-blue-700">#{inv.invoice_no}</td>
                    <td className="px-3 py-2 text-slate-600">{safeFormat(inv.date, 'dd MMM yyyy')}</td>
                    <td className="px-3 py-2">
                      <span className="text-[10px] uppercase font-bold bg-slate-100 border border-slate-200 px-1.5 py-0.5 rounded">
                        {inv.payment_method || 'cash'}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right text-emerald-700 font-semibold">₹{paid.toFixed(2)}</td>
                    <td className="px-3 py-2 text-right text-amber-700 font-semibold">₹{due.toFixed(2)}</td>
                    <td className="px-3 py-2 text-right font-semibold">₹{total.toFixed(2)}</td>
                    <td className="px-3 py-2 text-right">
                      <button
                        type="button"
                        onClick={() => openReturnDetail(inv)}
                        className="px-2.5 py-1 rounded-md bg-rose-600 hover:bg-rose-700 text-white text-[10px] font-bold"
                      >
                        Open Return
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    )
  }

  // screen === 'detail'
  const invoice = returnDone ? (updatedInvoice || selectedInvoice) : selectedInvoice
  const displayItems = invoice?.items || []

  return (
    <div className="h-full flex flex-col overflow-hidden min-h-0 bg-gradient-to-br from-slate-50 via-white to-rose-50/40 rounded-xl">
      {/* Header bar */}
      <div className="shrink-0 bg-white border-b border-slate-200 px-4 py-2.5 flex items-center gap-3">
        <button
          type="button"
          onClick={async () => {
            setScreen('invoices')
            setSelectedInvoice(null)
            setReturnQtyById({})
            setReturnDisplayById({})
            setReturnOverById({})
            setFullCancelModal(null)
            setBillAutoCancelled(false)
            setReturnDone(false)
            setUpdatedInvoice(null)
            setReturnRefundAmt(0)
            if (returnDone && selectedPatient) await loadPatientInvoices(selectedPatient, true)
          }}
          className="flex items-center gap-1 text-xs font-medium text-slate-600 hover:text-blue-600"
        >
          <ArrowBack size={16} /> Back
        </button>
        <span className="text-slate-200">|</span>
        <div className="flex-1 min-w-0">
          <span className="text-sm font-bold text-slate-900">
            Return — #{invoice?.invoice_no}
          </span>
          {invoice?.patient_details && (
            <span className="ml-2 text-[11px] text-slate-500">
              {[invoice.patient_details.first_name, invoice.patient_details.last_name].filter(Boolean).join(' ')}
              {invoice.patient_details.phone ? ` · ${invoice.patient_details.phone}` : ''}
            </span>
          )}
        </div>
        <div className="flex items-center gap-3 shrink-0 text-[11px]">
          <span className="text-slate-500">
            Date: <strong>{safeFormat(invoice?.date, 'dd MMM yyyy')}</strong>
          </span>
          <span className="uppercase font-bold bg-slate-100 border border-slate-200 px-1.5 py-0.5 rounded text-[10px]">
            {invoice?.payment_method || 'cash'}
          </span>
          <span className="text-slate-700">
            Original: <strong>₹{Number(invoice?.grand_total || 0).toFixed(2)}</strong>
          </span>
        </div>
      </div>

      {detailLoading ? (
        <div className="flex-1 flex items-center justify-center text-slate-400">Loading invoice…</div>
      ) : (
        <>
          {/* Items grid */}
          <div className="flex-1 overflow-y-auto min-h-0 p-3">
            {returnDone && (
              <div className={`mb-3 rounded-xl px-5 py-4 border ${billAutoCancelled ? 'bg-red-50 border-red-200' : 'bg-emerald-50 border-emerald-200'}`}>
                <div className="flex items-center gap-2 mb-3">
                  <span className={`font-bold text-base ${billAutoCancelled ? 'text-red-700' : 'text-emerald-700'}`}>
                    {billAutoCancelled ? '✓ Bill Cancelled · Full Refund Issued' : '✓ Return Complete'}
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-4 max-w-xs">
                  <div>
                    <div className="text-xs text-rose-600 font-medium mb-0.5">Refund to customer</div>
                    <div className="text-lg font-bold text-rose-700">₹{returnRefundAmt.toFixed(2)}</div>
                  </div>
                  {!billAutoCancelled && (
                    <div>
                      <div className="text-xs text-emerald-600 font-medium mb-0.5">New bill total</div>
                      <div className="text-lg font-bold text-emerald-700">₹{Number(updatedInvoice?.grand_total || 0).toFixed(2)}</div>
                    </div>
                  )}
                  {billAutoCancelled && (
                    <div>
                      <div className="text-xs text-red-600 font-medium mb-0.5">Bill status</div>
                      <div className="text-sm font-bold text-red-700">Cancelled</div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {displayItems.some((it) => it.batch === null) && (
              <div className="text-[10px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mb-2">
                One or more items have deleted inventory batches. Confirming this return will automatically recreate those batches in inventory.
              </div>
            )}

            {!returnDone && isFullBillReturn(selectedInvoice || {}, returnQtyById) && (
              <div className="text-[10px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mb-2">
                Returning all items will automatically cancel this bill.
              </div>
            )}

            <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
              <table className="w-full text-left text-[11px]">
                <thead className="bg-gradient-to-b from-slate-100 to-slate-50 sticky top-0 text-[10px] font-bold text-slate-500 uppercase">
                  <tr>
                    <th className="px-3 py-2">Medicine</th>
                    <th className="px-3 py-2">Batch</th>
                    <th className="px-3 py-2">Expiry</th>
                    <th className="px-3 py-2 text-right">Pack</th>
                    <th className="px-3 py-2 text-right">Sold Qty</th>
                    <th className="px-3 py-2 text-right">Rate</th>
                    {invoice?.gst_enabled && (
                      <th className="px-3 py-2 text-right">GST%</th>
                    )}
                    <th className="px-3 py-2 text-right">Line Amt</th>
                    {!returnDone && (
                      <>
                        <th className="px-3 py-2 text-center bg-rose-50 text-rose-700">Return Qty</th>
                        <th className="px-3 py-2 text-right bg-rose-50 text-rose-700">Refund</th>
                      </>
                    )}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {displayItems.length === 0 ? (
                    <tr>
                      <td colSpan={returnDone ? 8 : 10} className="px-3 py-8 text-center text-slate-400">
                        {billAutoCancelled ? 'Bill cancelled — all items returned.' : returnDone ? 'All items returned. Bill is now empty.' : 'No items'}
                      </td>
                    </tr>
                  ) : displayItems.map((item) => {
                    const soldQty = Number(item.qty || 0)
                    const rQty = returnQtyById[item.id] ?? 0
                    const refund = calcLineRefund(item, rQty, invoice?.gst_enabled)
                    const lineAmt = Number(item.amount || 0)
                    const batchNo = item.batch_no || item.snapshot_batch_no || '—'
                    const expiry = item.expiry_date || item.snapshot_expiry_date
                    const gstPct = Number(item.cgst_rate || 0) + Number(item.sgst_rate || 0)
                    const packSize = Number(packSizeFromInvoiceItem(item)) || 1
                    const baseSuffix = qtySuffixFromMedicine(item.medicine_print || item.medicine_name)
                    const soldQtyLabel = formatBillQtyForOutlet({
                      mode: 'pack_and_loose',
                      qty: soldQty,
                      freeQty: item.free_qty || 0,
                      packSize,
                      baseSuffix,
                    })
                    const packInfo = item.medicine_print?.pack_info || (packSize > 1 ? `1×${packSize}` : '—')
                    return (
                      <tr key={item.id} className={rQty > 0 ? 'bg-rose-50/50' : 'hover:bg-slate-50/60'}>
                        <td className="px-3 py-2 font-medium text-slate-900">
                          {item.medicine_name || item.medicine_print || '—'}
                          {item.batch === null && (
                            <span className="ml-1 text-[9px] font-semibold text-amber-700 bg-amber-50 border border-amber-200 rounded px-1 whitespace-nowrap">
                              batch deleted · will auto-restore
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2 font-mono text-slate-600">{batchNo}</td>
                        <td className="px-3 py-2 text-slate-500">{expiry ? safeFormat(expiry, 'MM/yy') : '—'}</td>
                        <td className="px-3 py-2 text-right text-slate-500 font-mono text-[10px]">{packInfo}</td>
                        <td className="px-3 py-2 text-right font-semibold">
                          <div>{soldQtyLabel}</div>
                          {packSize > 1 && (
                            <div className="text-[9px] text-slate-400 font-normal">({soldQty} units)</div>
                          )}
                        </td>
                        <td className="px-3 py-2 text-right">₹{Number(item.rate || 0).toFixed(2)}</td>
                        {invoice?.gst_enabled && (
                          <td className="px-3 py-2 text-right text-slate-500">{gstPct}%</td>
                        )}
                        <td className="px-3 py-2 text-right font-semibold">₹{lineAmt.toFixed(2)}</td>
                        {!returnDone && (
                          <>
                            <td className="px-3 py-2 text-center bg-rose-50/40">
                              {packSize <= 1 ? (
                                <>
                                  <input
                                    type="number"
                                    min={0}
                                    max={soldQty}
                                    step="1"
                                    value={rQty === 0 ? '' : rQty}
                                    placeholder={soldQty > 0 ? String(soldQty) : '0'}
                                    onChange={(e) => {
                                      const raw = Number(e.target.value)
                                      const over = raw > soldQty
                                      setReturnOverById((prev) => ({ ...prev, [item.id]: over }))
                                      const capped = Math.min(Math.max(0, isNaN(raw) ? 0 : raw), soldQty)
                                      setReturnQtyById((prev) => ({ ...prev, [item.id]: capped }))
                                    }}
                                    className={`w-16 text-center border rounded px-1 py-0.5 text-[11px] bg-white focus:outline-none ${returnOverById[item.id] ? 'border-red-500 focus:border-red-500' : 'border-rose-300 focus:border-rose-500'}`}
                                  />
                                  {returnOverById[item.id] && (
                                    <div className="text-[9px] text-red-600 mt-0.5">Max: {soldQty}</div>
                                  )}
                                </>
                              ) : (
                                <div className="flex flex-col items-center gap-0.5">
                                  <div className="flex items-center gap-1 justify-center">
                                    <div className="flex flex-col items-center">
                                      <input
                                        type="number"
                                        min={0}
                                        step="1"
                                        placeholder="0"
                                        value={returnDisplayById[item.id]?.strips ?? ''}
                                        onChange={(e) => {
                                          const strips = Math.max(0, parseInt(e.target.value) || 0)
                                          const loose = parseInt(returnDisplayById[item.id]?.loose) || 0
                                          const over = strips * packSize + loose > soldQty
                                          setReturnOverById((prev) => ({ ...prev, [item.id]: over }))
                                          const base = Math.min(strips * packSize + loose, soldQty)
                                          setReturnDisplayById((prev) => ({ ...prev, [item.id]: { strips: String(strips), loose: prev[item.id]?.loose ?? '' } }))
                                          setReturnQtyById((prev) => ({ ...prev, [item.id]: base }))
                                        }}
                                        className={`w-12 text-center border rounded px-1 py-0.5 text-[11px] bg-white focus:outline-none ${returnOverById[item.id] ? 'border-red-500 focus:border-red-500' : 'border-rose-300 focus:border-rose-500'}`}
                                      />
                                      <span className="text-[8px] text-slate-400 leading-tight">strips</span>
                                    </div>
                                    <span className="text-slate-400 text-[10px] pb-3">+</span>
                                    <div className="flex flex-col items-center">
                                      <input
                                        type="number"
                                        min={0}
                                        step="1"
                                        placeholder="0"
                                        value={returnDisplayById[item.id]?.loose ?? ''}
                                        onChange={(e) => {
                                          const loose = Math.max(0, parseInt(e.target.value) || 0)
                                          const strips = parseInt(returnDisplayById[item.id]?.strips) || 0
                                          const over = strips * packSize + loose > soldQty
                                          setReturnOverById((prev) => ({ ...prev, [item.id]: over }))
                                          const base = Math.min(strips * packSize + loose, soldQty)
                                          setReturnDisplayById((prev) => ({ ...prev, [item.id]: { strips: prev[item.id]?.strips ?? '', loose: String(loose) } }))
                                          setReturnQtyById((prev) => ({ ...prev, [item.id]: base }))
                                        }}
                                        className={`w-12 text-center border rounded px-1 py-0.5 text-[11px] bg-white focus:outline-none ${returnOverById[item.id] ? 'border-red-500 focus:border-red-500' : 'border-rose-300 focus:border-rose-500'}`}
                                      />
                                      <span className="text-[8px] text-slate-400 leading-tight">units</span>
                                    </div>
                                  </div>
                                  {returnOverById[item.id] && (
                                    <div className="text-[9px] text-red-600">Max: {soldQty} units</div>
                                  )}
                                </div>
                              )}
                            </td>
                            <td className="px-3 py-2 text-right bg-rose-50/40 font-semibold text-rose-700">
                              {refund > 0 ? `₹${refund.toFixed(2)}` : '—'}
                            </td>
                          </>
                        )}
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Sticky footer */}
          <div className="shrink-0 bg-white border-t border-slate-200 px-4 py-3">
            {!returnDone ? (
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div className="flex flex-wrap gap-4 text-xs">
                  <div className="rounded border border-slate-200 px-3 py-2 min-w-[100px]">
                    <div className="text-slate-500">New subtotal</div>
                    <div className="font-bold">₹{newSubtotal.toFixed(2)}</div>
                  </div>
                  {gstEnabled && (
                    <>
                      <div className="rounded border border-slate-200 px-3 py-2 min-w-[80px]">
                        <div className="text-slate-500">CGST</div>
                        <div className="font-bold">₹{newCgst.toFixed(2)}</div>
                      </div>
                      <div className="rounded border border-slate-200 px-3 py-2 min-w-[80px]">
                        <div className="text-slate-500">SGST</div>
                        <div className="font-bold">₹{newSgst.toFixed(2)}</div>
                      </div>
                    </>
                  )}
                  <div className="rounded border border-slate-200 px-3 py-2 min-w-[100px]">
                    <div className="text-slate-500">New total</div>
                    <div className="font-bold">₹{newPayableTotal.toFixed(2)}</div>
                  </div>
                  <div className="rounded border border-rose-300 bg-rose-50 px-3 py-2 min-w-[120px]">
                    <div className="text-rose-600 font-semibold">Total refund</div>
                    <div className="font-bold text-rose-700 text-sm">₹{totalRefund.toFixed(2)}</div>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={submitReturn}
                  disabled={submitting || totalRefund <= 0}
                  className={`flex items-center gap-2 px-5 py-2 bg-rose-600 hover:bg-rose-700 text-white rounded-lg font-semibold text-sm transition-colors disabled:opacity-50 ${Object.values(returnOverById).some(Boolean) ? 'opacity-50 cursor-not-allowed' : ''}`}
                >
                  <ReturnIcon size={16} />
                  {submitting ? 'Processing…' : 'Confirm Return'}
                </button>
              </div>
            ) : (
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div className={`text-sm font-semibold ${billAutoCancelled ? 'text-red-700' : 'text-emerald-700'}`}>
                  {billAutoCancelled ? 'Stock restored · Bill cancelled.' : 'Stock restored · Bill updated.'}
                </div>
                <div className="flex gap-2">
                  {!billAutoCancelled && (
                    <button
                      type="button"
                      onClick={() => onPrint?.(updatedInvoice || selectedInvoice)}
                      className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-semibold text-sm"
                    >
                      <PrintIcon size={16} /> Print Updated Bill
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={async () => {
                      setScreen('invoices')
                      setSelectedInvoice(null)
                      setReturnQtyById({})
                      setReturnDisplayById({})
                      setReturnOverById({})
                      setFullCancelModal(null)
                      setBillAutoCancelled(false)
                      setReturnDone(false)
                      setUpdatedInvoice(null)
                      setReturnRefundAmt(0)
                      if (selectedPatient) await loadPatientInvoices(selectedPatient, true)
                    }}
                    className="px-4 py-2 border border-slate-200 hover:bg-slate-50 rounded-lg text-sm font-medium text-slate-700"
                  >
                    Back to Invoices
                  </button>
                </div>
              </div>
            )}
          </div>
        </>
      )}

      {fullCancelModal && createPortal(
        <ReturnFullBillCancelModal
          invoice={fullCancelModal.invoice}
          refundAmt={fullCancelModal.refundAmt}
          processing={Boolean(fullCancelModal.processing)}
          onConfirm={confirmFullBillCancel}
          onClose={() => setFullCancelModal(null)}
        />,
        document.body,
      )}
    </div>
  )
}
