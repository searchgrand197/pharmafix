/**
 * ReceptionistPortalMobile.jsx
 *
 * Dedicated mobile layout shell for the Receptionist Portal.
 *
 * Design system applied:
 *  - Title / patient name:  18–20px  font-extrabold
 *  - Section title:         16px     font-bold
 *  - Body text:             14–15px  font-medium
 *  - Labels / meta:         13px     font-medium
 *  - Min text size:         12px     (never below)
 *  - Card padding:          p-4 (16px)
 *  - Form field spacing:    gap-4 (16px)
 *  - Vertical rhythm:       space-y-4 between sections
 *  - Button grid:           grid-cols-3 for multiple actions
 */

import React, { useState, useEffect, useRef, useCallback } from 'react'
import {
  LocalHospital as LocalHospitalIcon,
  Logout as LogoutIcon,
  Notifications as NotificationsIcon,
  Close as CloseIcon,
  Phone as PhoneIcon,
  CheckCircle as CheckCircleIcon,
  Groups as GroupsIcon,
  Bed as BedIcon,
  WarningAmber as WarningAmberIcon,
  ReceiptLong as ReceiptLongIcon,
  Checklist as ChecklistIcon,
  ExpandMore as ExpandMoreIcon,
  ChevronRight as ChevronRightIcon,
  MedicalServices as MedicalServicesIcon,
  PersonAdd as PersonAddIcon,
  History as HistoryIcon,
  BarChart as BarChartIcon,
  Settings as SettingsIcon,
  ExitToApp as ExitToAppIcon,
  MoneyOff as MoneyOffIcon,
  Visibility as VisibilityIcon,
  Print as PrintIcon,
  Edit as EditIcon,
  Refresh as RefreshIcon,
  Search as SearchIcon,
  CurrencyRupee as CurrencyRupeeIcon,
  Description as DescriptionIcon,
  MonitorHeart as MonitorHeartIcon,
} from '@mui/icons-material'

// ─── MUI Icon Bridge ───────────────────────────────────────────────────────────
function asMuiIcon(IconComponent) {
  return function IconBridge({ size, className, sx, ...rest }) {
    return (
      <IconComponent
        className={className}
        sx={{ ...(size ? { fontSize: size } : {}), ...sx }}
        {...rest}
      />
    )
  }
}

const Hospital     = asMuiIcon(LocalHospitalIcon)
const LogOut       = asMuiIcon(LogoutIcon)
const Bell         = asMuiIcon(NotificationsIcon)
const X            = asMuiIcon(CloseIcon)
const Phone        = asMuiIcon(PhoneIcon)
const CheckCircle  = asMuiIcon(CheckCircleIcon)
const ChevronDown  = asMuiIcon(ExpandMoreIcon)
const ChevronRight = asMuiIcon(ChevronRightIcon)

// Bottom nav icons
const IcoOPD       = asMuiIcon(GroupsIcon)
const IcoIPD       = asMuiIcon(BedIcon)
const IcoPatients  = asMuiIcon(ChecklistIcon)
const IcoBilling   = asMuiIcon(ReceiptLongIcon)
const IcoEmergency = asMuiIcon(WarningAmberIcon)

// OPD slip list icons
const IcoView    = asMuiIcon(VisibilityIcon)
const IcoPrint   = asMuiIcon(PrintIcon)
const IcoEdit    = asMuiIcon(EditIcon)
const IcoRefresh = asMuiIcon(RefreshIcon)
const IcoSearch  = asMuiIcon(SearchIcon)
const IcoRupee   = asMuiIcon(CurrencyRupeeIcon)
const IcoBed     = asMuiIcon(BedIcon)
const IcoLedger  = asMuiIcon(DescriptionIcon)
const IcoProcess = asMuiIcon(MonitorHeartIcon)
const IcoHistory = asMuiIcon(HistoryIcon)
const IcoReceipt = asMuiIcon(ReceiptLongIcon)

// ─── useIsMobile ───────────────────────────────────────────────────────────────
/**
 * Returns true when viewport width is < 768 px (Tailwind `md` breakpoint).
 * Re-evaluates on resize via MediaQueryList.
 */
export function useIsMobile() {
  const [isMobile, setIsMobile] = useState(() => {
    if (typeof window === 'undefined') return false
    if (window.Android && typeof window.Android.printPage === 'function') return true
    return window.innerWidth < 768
  })

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 767px)')
    const handler = () => {
      const inHmsApp = window.Android && typeof window.Android.printPage === 'function'
      setIsMobile(inHmsApp || mq.matches)
    }
    handler()
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [])

  return isMobile
}

// ─── MobileSidebarDrawer ───────────────────────────────────────────────────────
function MobileSidebarDrawer({ isOpen, onClose, activeSection, onSelect, navGroups }) {
  const [collapsed, setCollapsed] = useState({})

  function toggleGroup(label) {
    setCollapsed((prev) => ({ ...prev, [label]: !prev[label] }))
  }

  function handleSelect(id) {
    onSelect(id)
    onClose()
  }

  return (
    <>
      {/* Backdrop */}
      <div
        className={`fixed inset-0 bg-black/60 backdrop-blur-sm z-40 transition-opacity duration-300 ${
          isOpen ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
        }`}
        onClick={onClose}
      />

      {/* Drawer panel — wider for better tap targets */}
      <aside
        className={`fixed top-0 left-0 h-full w-[300px] bg-white z-50 flex flex-col
          transition-transform duration-300 ease-out
          ${isOpen ? 'translate-x-0 shadow-2xl' : '-translate-x-full'}`}
        style={{ height: '100dvh' }}
      >
        {/* ── Drawer header ── */}
        <div className="bg-gradient-to-br from-emerald-600 via-emerald-600 to-teal-700 px-5 py-5 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3 text-white">
            <div className="w-10 h-10 rounded-2xl bg-white/20 flex items-center justify-center shadow-inner">
              <Hospital size={22} className="text-white" />
            </div>
            <div>
              {/* Section title: 16px */}
              <p className="font-bold text-base leading-tight">Reception Menu</p>
              {/* Label: 13px */}
              <p className="text-[13px] text-emerald-100/80 mt-0.5">Tap a section to open</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-9 h-9 flex items-center justify-center rounded-xl bg-white/15 hover:bg-white/25 text-white transition-colors"
            aria-label="Close menu"
          >
            <X size={20} />
          </button>
        </div>

        {/* ── Navigation list ── */}
        <nav className="flex-1 overflow-y-auto py-3" style={{ scrollbarWidth: 'none' }}>
          {navGroups.map((group) => (
            <div key={group.label} className="mb-1">
              {/* Group heading — 13px label */}
              <button
                onClick={() => toggleGroup(group.label)}
                className="w-full flex items-center justify-between px-5 py-2 text-[13px] font-black text-gray-400 uppercase tracking-widest hover:text-gray-600 transition-colors"
              >
                <span>{group.label}</span>
                {collapsed[group.label] ? (
                  <ChevronRight size={14} />
                ) : (
                  <ChevronDown size={14} />
                )}
              </button>

              {!collapsed[group.label] && (
                /* ── Grid layout for multiple items — 1 column list with large tap targets ── */
                <div className="px-3 space-y-0.5">
                  {group.items.map((item) => {
                    const Icon = item.icon
                    const active = activeSection === item.id
                    return (
                      <button
                        key={item.id}
                        onClick={() => handleSelect(item.id)}
                        className={`w-full flex items-center gap-3.5 px-3.5 py-3.5 rounded-xl text-[15px] font-semibold transition-all ${
                          active
                            ? 'bg-emerald-600 text-white shadow-sm'
                            : 'text-gray-700 hover:bg-emerald-50 hover:text-emerald-700'
                        }`}
                      >
                        {/* Icon container — clear visual anchor */}
                        <div
                          className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${
                            active ? 'bg-white/20' : 'bg-gray-100'
                          }`}
                        >
                          <Icon size={18} className={active ? 'text-white' : 'text-gray-500'} />
                        </div>

                        {/* Item label — body: 15px */}
                        <span className="flex-1 text-left">{item.label}</span>

                        {active && (
                          <div className="w-1.5 h-6 rounded-full bg-white/60 shrink-0" />
                        )}
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
          ))}
        </nav>

        {/* ── Drawer footer ── */}
        <div className="border-t border-gray-100 px-5 py-4 shrink-0 bg-gray-50/60">
          {/* Label: 13px */}
          <p className="text-[13px] text-gray-400 text-center font-medium">
            All navigation sections listed above
          </p>
        </div>
      </aside>
    </>
  )
}

// ─── Alert Card (used inside MobileBellDropdown) ───────────────────────────────
function AlertCard({ alert, markFollowUpDone }) {
  return (
    <div
      className={`px-4 py-4 space-y-3 ${
        alert.is_today
          ? 'bg-red-50 border-l-4 border-red-400'
          : 'bg-amber-50 border-l-4 border-amber-400'
      }`}
    >
      {/* ── Row 1: hierarchy — large name, medium doctor, small ID ── */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          {/* Patient name — Title: 18px */}
          <p className="text-[18px] font-extrabold text-gray-900 truncate leading-tight">
            {alert.patient_name}
          </p>

          {/* Doctor — Body: 14px */}
          {alert.doctor_name && (
            <p className="text-[14px] font-medium text-gray-600 mt-0.5 truncate">
              Dr. {alert.doctor_name}
            </p>
          )}

          {/* Visit reason — Body: 14px italic */}
          {(alert.visit_reason || alert.revisit_advice) && (
            <p className="text-[14px] text-gray-500 italic mt-0.5 line-clamp-1">
              "{alert.visit_reason || alert.revisit_advice}"
            </p>
          )}

          {/* ID / date row — Label: 13px */}
          <div className="flex items-center gap-2 mt-1.5 flex-wrap">
            <span className="text-[13px] text-gray-400 font-mono">#{alert.uhid}</span>
            {alert.patient_phone && (
              <span className="text-[13px] text-emerald-700 font-semibold bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200 flex items-center gap-1">
                <Phone size={11} /> {alert.patient_phone}
              </span>
            )}
          </div>
        </div>

        {/* Status badge — urgency indicator */}
        <span
          className={`text-[12px] font-black px-2.5 py-1 rounded-full shrink-0 ${
            alert.is_today ? 'bg-red-500 text-white' : 'bg-amber-400 text-white'
          }`}
        >
          {alert.is_today ? 'TODAY' : 'TOMORROW'}
        </span>
      </div>

      {/* ── Primary CTA grid: 2 equal columns ── */}
      <div className="grid grid-cols-2 gap-2.5">
        {alert.patient_phone ? (
          <a
            href={`tel:${alert.patient_phone}`}
            className="flex items-center justify-center gap-2 bg-emerald-600 text-white py-2.5 rounded-xl text-[14px] font-bold hover:bg-emerald-700 active:scale-95 transition-all shadow-sm"
          >
            <Phone size={14} /> Call
          </a>
        ) : (
          <div />
        )}
        <button
          onClick={() => markFollowUpDone(alert.id)}
          className="flex items-center justify-center gap-2 bg-white text-gray-700 py-2.5 rounded-xl text-[14px] font-bold hover:bg-gray-50 active:scale-95 transition-all border-2 border-gray-200"
        >
          <CheckCircle size={14} /> Done
        </button>
      </div>
    </div>
  )
}

// ─── MobileBellDropdown ────────────────────────────────────────────────────────
function MobileBellDropdown({ alerts, bellOpen, setBellOpen, bellRef, markFollowUpDone }) {
  const todayAlerts    = alerts.filter((a) => a.is_today)
  const tomorrowAlerts = alerts.filter((a) => a.is_tomorrow)
  const urgentCount    = todayAlerts.length

  return (
    <div className="relative" ref={bellRef}>
      {/* Bell trigger button */}
      <button
        onClick={() => setBellOpen((o) => !o)}
        className={`relative w-10 h-10 flex items-center justify-center rounded-xl transition-all ${
          urgentCount > 0
            ? 'bg-red-500 hover:bg-red-600 text-white animate-pulse'
            : tomorrowAlerts.length > 0
            ? 'bg-amber-400 hover:bg-amber-500 text-white'
            : 'bg-white/20 hover:bg-white/30 text-white'
        }`}
        aria-label="Follow-up alerts"
      >
        <Bell size={20} />
        {alerts.length > 0 && (
          <span className="absolute -top-1 -right-1 w-5 h-5 bg-white text-emerald-700 text-[11px] font-black rounded-full flex items-center justify-center shadow-md border-2 border-emerald-600">
            {alerts.length > 9 ? '9+' : alerts.length}
          </span>
        )}
      </button>

      {/* Centered modal panel (not left/right anchored dropdown) */}
      {bellOpen && (
        <div
          className="fixed inset-0 z-[200] flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Follow-up alerts"
        >
          <div
            className="absolute inset-0 bg-black/45 backdrop-blur-[1px]"
            onClick={() => setBellOpen(false)}
          />
          <div className="relative w-full max-w-[360px] bg-white rounded-2xl shadow-2xl border border-gray-100 overflow-hidden">
            {/* Panel header — section title: 16px */}
            <div className="bg-gradient-to-r from-emerald-600 to-teal-600 px-4 py-3.5 flex items-center justify-between">
              <div className="flex items-center gap-2.5 text-white">
                <Bell size={16} />
                <div>
                  <span className="text-[16px] font-bold">Follow-up Alerts</span>
                  {alerts.length > 0 && (
                    <span className="ml-2 text-[13px] text-emerald-200">
                      {alerts.length} pending
                    </span>
                  )}
                </div>
              </div>
              <button
                onClick={() => setBellOpen(false)}
                className="w-8 h-8 flex items-center justify-center rounded-xl bg-white/15 hover:bg-white/25 text-white transition-colors"
              >
                <X size={16} />
              </button>
            </div>

            {alerts.length === 0 ? (
              <div className="py-10 text-center space-y-2">
                <CheckCircle size={32} className="text-emerald-300 mx-auto" />
                {/* Body: 15px */}
                <p className="text-[15px] text-gray-500 font-medium">No follow-up alerts</p>
                {/* Label: 13px */}
                <p className="text-[13px] text-gray-400">All patients attended ✓</p>
              </div>
            ) : (
              <div className="max-h-[70vh] overflow-y-auto divide-y divide-gray-100">
                {alerts.map((alert) => (
                  <AlertCard
                    key={alert.id}
                    alert={alert}
                    markFollowUpDone={markFollowUpDone}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// ─── MobileHeader ──────────────────────────────────────────────────────────────
function MobileHeader({
  user,
  sectionTitle,
  onMenuOpen,
  alerts,
  bellOpen,
  setBellOpen,
  bellRef,
  markFollowUpDone,
  onLogout,
}) {
  return (
    <header className="bg-gradient-to-r from-emerald-600 to-teal-600 text-white px-4 py-3 flex items-center justify-between shadow-lg shrink-0 z-10">
      {/* Left: hamburger + user info */}
      <div className="flex items-center gap-3 min-w-0 flex-1">
        {/* Hamburger — large tap target */}
        <button
          onClick={onMenuOpen}
          className="flex flex-col justify-center items-center w-10 h-10 rounded-xl bg-white/15 hover:bg-white/25 active:scale-95 transition-all gap-[5px] shrink-0"
          aria-label="Open navigation menu"
        >
          <span className="block bg-white rounded-full" style={{ width: 20, height: 2 }} />
          <span className="block bg-white rounded-full" style={{ width: 14, height: 2 }} />
          <span className="block bg-white rounded-full" style={{ width: 20, height: 2 }} />
        </button>

        <div className="min-w-0">
          {/* Title: 18px */}
          <h1 className="text-[18px] font-extrabold text-white leading-tight truncate">
            {user?.first_name
              ? `${user.first_name} ${user.last_name || ''}`
              : 'Receptionist'}
          </h1>
          {/* Label: 13px — current section */}
          <p className="text-[13px] font-medium text-emerald-100/80 truncate leading-none mt-0.5">
            {sectionTitle}
          </p>
        </div>
      </div>

      {/* Right: bell + logout */}
      <div className="flex items-center gap-2 shrink-0">
        <MobileBellDropdown
          alerts={alerts}
          bellOpen={bellOpen}
          setBellOpen={setBellOpen}
          bellRef={bellRef}
          markFollowUpDone={markFollowUpDone}
        />

        <button
          onClick={onLogout}
          className="w-10 h-10 flex items-center justify-center rounded-xl bg-white/15 hover:bg-white/25 active:scale-95 transition-all"
          aria-label="Logout"
        >
          <LogOut size={20} />
        </button>
      </div>
    </header>
  )
}

// ─── MobileBottomNav ───────────────────────────────────────────────────────────
/**
 * 5-tab bottom navigation rendered as a responsive grid.
 * Each tab has: icon pill (active highlight) + label (13px).
 */
const BOTTOM_TABS = [
  { id: 'opd',          label: 'OPD',       Icon: IcoOPD,       color: 'emerald' },
  { id: 'new_admission', label: 'IPD',       Icon: IcoIPD,       color: 'blue'    },
  { id: 'patients',     label: 'Patients',  Icon: IcoPatients,  color: 'violet'  },
  { id: 'payment_slip', label: 'Billing',   Icon: IcoBilling,   color: 'amber'   },
  { id: 'emergency',    label: 'SOS',       Icon: IcoEmergency, color: 'red'     },
]

const TAB_ACTIVE_COLORS = {
  emerald: 'bg-emerald-100 text-emerald-700',
  blue:    'bg-blue-100 text-blue-700',
  violet:  'bg-violet-100 text-violet-700',
  amber:   'bg-amber-100 text-amber-700',
  red:     'bg-red-100 text-red-700',
}

const TAB_LABEL_COLORS = {
  emerald: 'text-emerald-600',
  blue:    'text-blue-600',
  violet:  'text-violet-600',
  amber:   'text-amber-600',
  red:     'text-red-600',
}

function MobileBottomNav({ activeSection, onSelect }) {
  return (
    /* Grid: 5 equal columns — proper grid layout for multiple buttons */
    <nav className="bg-white border-t border-gray-100 grid grid-cols-5 shrink-0 shadow-[0_-3px_16px_rgba(0,0,0,0.10)]">
      {BOTTOM_TABS.map(({ id, label, Icon, color }) => {
        const active = activeSection === id
        return (
          <button
            key={id}
            onClick={() => onSelect(id)}
            className={`flex flex-col items-center justify-center py-2 gap-1 min-h-[58px] transition-all active:scale-95 ${
              active ? '' : 'text-gray-400 hover:text-gray-600'
            }`}
          >
            {/* Icon pill — color per tab when active */}
            <div
              className={`flex items-center justify-center w-9 h-7 rounded-xl transition-all ${
                active ? TAB_ACTIVE_COLORS[color] : ''
              }`}
            >
              <Icon size={22} />
            </div>

            {/* Label — 13px, never below 12px */}
            <span
              className={`text-[13px] font-bold leading-none transition-colors ${
                active ? TAB_LABEL_COLORS[color] : 'text-gray-400'
              }`}
            >
              {label}
            </span>
          </button>
        )
      })}
    </nav>
  )
}

// ─── Mobile list — shared card layout for sidebar sections ─────────────────────

/** Scrollable list area with spaced bordered cards */
export function MobileCardList({ children, className = '' }) {
  return (
    <div className={`flex-1 min-h-0 overflow-y-auto p-2 space-y-2 bg-gray-50/50 ${className}`}>
      {children}
    </div>
  )
}

/** Bordered card shell — visually separates each record */
export function MobileRecordCard({ children, tone = 'default', onClick, className = '' }) {
  const tones = {
    default:   'bg-white border-gray-200',
    cancelled: 'bg-red-50/40 border-red-200',
    emergency: 'bg-white border-red-100',
    ipd:       'bg-white border-blue-100',
  }
  const Tag = onClick ? 'button' : 'article'
  return (
    <Tag
      type={onClick ? 'button' : undefined}
      onClick={onClick}
      className={`block w-full text-left rounded-xl border px-3 py-3 space-y-2.5 shadow-sm ${tones[tone] || tones.default} ${className}`}
    >
      {children}
    </Tag>
  )
}

export function MobileDetailRow({ label, children }) {
  return (
    <div className="flex items-start gap-2 text-[13px]">
      <span className="text-[11px] font-bold text-gray-400 uppercase shrink-0 w-14 pt-0.5">{label}</span>
      <span className="text-gray-700 font-medium break-words min-w-0 flex-1">{children}</span>
    </div>
  )
}

export function MobileActionBtn({ label, icon: Icon, onClick, disabled, tone = 'indigo' }) {
  const tones = {
    indigo:  'text-indigo-700 bg-indigo-50 border-indigo-100 active:bg-indigo-100',
    blue:    'text-blue-700 bg-blue-50 border-blue-100 active:bg-blue-100',
    sky:     'text-sky-700 bg-sky-50 border-sky-100 active:bg-sky-100',
    emerald: 'text-emerald-700 bg-emerald-50 border-emerald-100 active:bg-emerald-100',
    amber:   'text-amber-700 bg-amber-50 border-amber-100 active:bg-amber-100',
    violet:  'text-violet-700 bg-violet-50 border-violet-100 active:bg-violet-100',
    red:     'text-red-700 bg-red-50 border-red-100 active:bg-red-100',
    rose:    'text-rose-700 bg-rose-50 border-rose-100 active:bg-rose-100',
    gray:    'text-gray-400 bg-gray-100 border-gray-200 cursor-not-allowed',
  }
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`flex flex-col items-center justify-center gap-0.5 min-h-[44px] rounded-xl border text-[11px] font-bold transition-all active:scale-95 ${
        disabled ? tones.gray : tones[tone]
      }`}
    >
      <Icon size={16} />
      <span>{label}</span>
    </button>
  )
}

/**
 * Stacked search + date filters for mobile list sections.
 */
export function MobileListFilters({
  search,
  onSearchChange,
  dateFrom,
  dateTo,
  onDateFromChange,
  onDateToChange,
  onClearDates,
  loading,
  onRefresh,
  total,
  totalLabel = 'records',
  searchPlaceholder = 'Search…',
  showDates = true,
}) {
  return (
    <div className="px-3 py-3 border-b border-gray-100 bg-gray-50/60 space-y-2.5 shrink-0">
      <div className="flex items-center gap-2 bg-white rounded-xl border border-gray-200 px-3 py-2">
        <IcoSearch size={16} className="text-gray-400 shrink-0" />
        <input
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder={searchPlaceholder}
          className="flex-1 min-w-0 text-[14px] outline-none bg-transparent placeholder:text-gray-400"
        />
        {loading && (
          <span className="w-3.5 h-3.5 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin shrink-0" />
        )}
        {onRefresh && (
          <button
            type="button"
            onClick={onRefresh}
            className="w-8 h-8 flex items-center justify-center rounded-lg text-gray-400 hover:text-emerald-600 hover:bg-emerald-50 transition-colors shrink-0"
            aria-label="Refresh list"
          >
            <IcoRefresh size={16} />
          </button>
        )}
      </div>

      {showDates && (
        <div className="flex items-center gap-2">
          <div className="flex-1 min-w-0">
            <label className="block text-[11px] font-bold text-gray-400 uppercase tracking-wide mb-1">From</label>
            <input
              type="date"
              value={dateFrom}
              max={dateTo || undefined}
              onChange={(e) => onDateFromChange(e.target.value)}
              className="w-full text-[13px] border border-gray-200 rounded-lg px-2 py-1.5 text-gray-700 bg-white focus:outline-none focus:ring-2 focus:ring-emerald-400"
            />
          </div>
          <div className="flex-1 min-w-0">
            <label className="block text-[11px] font-bold text-gray-400 uppercase tracking-wide mb-1">To</label>
            <input
              type="date"
              value={dateTo}
              min={dateFrom || undefined}
              onChange={(e) => onDateToChange(e.target.value)}
              className="w-full text-[13px] border border-gray-200 rounded-lg px-2 py-1.5 text-gray-700 bg-white focus:outline-none focus:ring-2 focus:ring-emerald-400"
            />
          </div>
          {(dateFrom || dateTo) && onClearDates && (
            <button
              type="button"
              onClick={onClearDates}
              className="self-end text-[11px] font-bold text-red-500 hover:text-red-700 bg-red-50 hover:bg-red-100 px-2.5 py-1.5 rounded-lg border border-red-100 shrink-0"
            >
              Clear
            </button>
          )}
        </div>
      )}

      {total != null && (
        <p className="text-[12px] text-gray-400 font-medium">{total} {totalLabel}</p>
      )}
    </div>
  )
}

/** @deprecated use MobileListFilters */
export const OpdSlipsMobileFilters = MobileListFilters

export function OpdSlipMobileCard({
  visit,
  doctorName,
  statusColors,
  visitDateLabel,
  isCancelled,
  onView,
  onMoveToIpd,
  onPrint,
  onEdit,
  onCancel,
}) {
  const statusClass = statusColors[visit.status] || 'bg-gray-100 text-gray-800'

  return (
    <MobileRecordCard tone={isCancelled ? 'cancelled' : 'default'}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-[16px] font-extrabold text-gray-900 leading-snug break-words">
            {visit.patient_name || 'Patient'}
          </p>
          {visit.patient_uhid && (
            <p className="text-[12px] text-gray-500 font-mono mt-0.5 break-all">{visit.patient_uhid}</p>
          )}
        </div>
        <span className={`text-[11px] font-black px-2.5 py-1 rounded-full uppercase shrink-0 ${statusClass}`}>
          {visit.status.replace('_', ' ')}
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        {visit.opd_no && (
          <span className="text-[11px] text-blue-700 font-bold bg-blue-50 px-2 py-0.5 rounded-md border border-blue-100">
            {visit.opd_no}
          </span>
        )}
        <span className="text-[11px] text-emerald-700 font-bold bg-emerald-50 px-2 py-0.5 rounded-md border border-emerald-100">
          #{visit.queue_number || visit.token_number || '—'}
        </span>
        <span className="text-[12px] text-gray-500 font-medium">{visitDateLabel}</span>
      </div>

      <div className="space-y-1.5">
        <MobileDetailRow label="Doctor">{doctorName}</MobileDetailRow>
        {visit.visit_reason && <MobileDetailRow label="Issue">{visit.visit_reason}</MobileDetailRow>}
        {visit.amount != null && visit.amount !== '' && (
          <MobileDetailRow label="Amount">
            <span className="inline-flex items-center gap-0.5 font-bold text-gray-800">
              <IcoRupee size={12} />
              {visit.amount}
              <span className="text-[10px] font-semibold text-gray-500 uppercase ml-1">
                ({visit.payment_mode || 'CASH'})
              </span>
            </span>
          </MobileDetailRow>
        )}
        {visit.created_by_name && (
          <p className="text-[12px] text-gray-400">
            By: <span className="font-medium text-gray-500 break-all">{visit.created_by_name}</span>
          </p>
        )}
      </div>

      {isCancelled && <p className="text-[12px] font-bold text-red-700">Cancelled — view only</p>}

      <div className="grid grid-cols-3 gap-1.5 pt-0.5">
        <MobileActionBtn label="View" icon={IcoView} onClick={onView} tone="indigo" />
        <MobileActionBtn label="IPD" icon={IcoBed} onClick={onMoveToIpd} disabled={isCancelled} tone="blue" />
        <MobileActionBtn label="Print" icon={IcoPrint} onClick={onPrint} disabled={isCancelled} tone="sky" />
        <MobileActionBtn label="Edit" icon={IcoEdit} onClick={onEdit} disabled={isCancelled} tone="emerald" />
        {!isCancelled && <MobileActionBtn label="Cancel" icon={X} onClick={onCancel} tone="red" />}
      </div>
    </MobileRecordCard>
  )
}

export function PatientMobileCard({
  patient,
  displayName,
  initials,
  avatarClass,
  age,
  regDate,
  genderLabel,
  genderClass,
  onView,
  onEdit,
  onTimeline,
}) {
  return (
    <MobileRecordCard onClick={onView}>
      <div className="flex items-start gap-3">
        <div className={`w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold shrink-0 ${avatarClass}`}>
          {initials}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[16px] font-extrabold text-gray-900 leading-snug break-words">{displayName}</p>
          {patient.uhid && (
            <p className="text-[12px] text-gray-500 font-mono mt-0.5 break-all">{patient.uhid}</p>
          )}
        </div>
        {genderLabel && (
          <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full border shrink-0 ${genderClass}`}>
            {genderLabel}
          </span>
        )}
      </div>

      <div className="space-y-1.5">
        {patient.phone && (
          <MobileDetailRow label="Phone">
            <span className="inline-flex items-center gap-1">
              <Phone size={12} className="text-emerald-600" />
              {patient.phone}
            </span>
          </MobileDetailRow>
        )}
        {age != null && <MobileDetailRow label="Age">{age}</MobileDetailRow>}
        <MobileDetailRow label="Joined">{regDate}</MobileDetailRow>
      </div>

      <div className="grid grid-cols-3 gap-1.5 pt-0.5" onClick={(e) => e.stopPropagation()}>
        <MobileActionBtn label="View" icon={IcoView} onClick={onView} tone="emerald" />
        <MobileActionBtn label="Edit" icon={IcoEdit} onClick={onEdit} tone="amber" />
        <MobileActionBtn label="Timeline" icon={IcoHistory} onClick={onTimeline} tone="indigo" />
      </div>
    </MobileRecordCard>
  )
}

export function PaymentSlipMobileCard({
  payment,
  dateLabel,
  statusColors,
  payModeLabel,
  isCancelled,
  onView,
  onEdit,
  onCancel,
}) {
  const statusClass = statusColors[payment.status] || 'bg-gray-100 text-gray-800'

  return (
    <MobileRecordCard tone={isCancelled ? 'cancelled' : 'default'}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-[16px] font-extrabold text-gray-900 leading-snug break-words">
            {payment.patient_name || 'Patient'}
          </p>
          {payment.patient_uhid && (
            <p className="text-[12px] text-gray-500 font-mono mt-0.5 break-all">{payment.patient_uhid}</p>
          )}
        </div>
        <span className={`text-[11px] font-black px-2.5 py-1 rounded-full uppercase shrink-0 ${statusClass}`}>
          {payment.status}
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        {payment.receipt_no && (
          <span className="text-[11px] text-emerald-700 font-bold bg-emerald-50 px-2 py-0.5 rounded-md border border-emerald-100">
            {payment.receipt_no}
          </span>
        )}
        <span className="text-[12px] text-gray-500 font-medium">{dateLabel}</span>
      </div>

      <div className="space-y-1.5">
        {payment.attributed_doctor_name && (
          <MobileDetailRow label="Doctor">{payment.attributed_doctor_name}</MobileDetailRow>
        )}
        {payment.invoice_no && <MobileDetailRow label="Invoice">{payment.invoice_no}</MobileDetailRow>}
        <MobileDetailRow label="Mode">{payModeLabel}</MobileDetailRow>
        <MobileDetailRow label="Amount">
          <span className="inline-flex items-center gap-0.5 font-bold text-gray-800">
            <IcoRupee size={12} />
            {payment.amount || '0'}
          </span>
        </MobileDetailRow>
        {payment.transaction_reference && (
          <MobileDetailRow label="Ref">{payment.transaction_reference}</MobileDetailRow>
        )}
        {payment.collected_by_name && (
          <p className="text-[12px] text-gray-400">
            By: <span className="font-medium text-gray-500 break-all">{payment.collected_by_name}</span>
          </p>
        )}
      </div>

      <div className="grid grid-cols-3 gap-1.5 pt-0.5">
        <MobileActionBtn label="View" icon={IcoView} onClick={onView} tone="indigo" />
        {!isCancelled && <MobileActionBtn label="Edit" icon={IcoEdit} onClick={onEdit} tone="emerald" />}
        {!isCancelled && <MobileActionBtn label="Cancel" icon={X} onClick={onCancel} tone="red" />}
      </div>
    </MobileRecordCard>
  )
}

export function IpdAdmissionMobileCard({
  admission,
  admissionDateLabel,
  statusClass,
  summaryBadge,
  onTimeline,
  onDischarge,
  onProcess,
  onEdit,
  onPrint,
  onOpenLedger,
  showDischarge,
  showProcess,
}) {
  return (
    <MobileRecordCard tone="ipd">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-[16px] font-extrabold text-gray-900 leading-snug break-words">
            {admission.patient_name || admission.patient}
          </p>
          {admission.patient_uhid && (
            <p className="text-[12px] text-gray-500 font-mono mt-0.5 break-all">{admission.patient_uhid}</p>
          )}
        </div>
        <span className={`text-[11px] font-black px-2.5 py-1 rounded-full capitalize shrink-0 ${statusClass}`}>
          {admission.status}
        </span>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {admission.scheme_name && (
          <span className="text-[10px] px-2 py-0.5 rounded font-bold uppercase bg-yellow-100 text-yellow-900 border border-yellow-200">
            {admission.scheme_name}
          </span>
        )}
        {summaryBadge}
      </div>

      <div className="space-y-1.5">
        <MobileDetailRow label="Ward">{admission.ward_name || 'No ward'}</MobileDetailRow>
        <MobileDetailRow label="Bed">{admission.bed_code || '—'}</MobileDetailRow>
        <MobileDetailRow label="Doctor">Dr. {admission.assigned_doctor_name || '—'}</MobileDetailRow>
        <MobileDetailRow label="Admitted">{admissionDateLabel}</MobileDetailRow>
        {admission.admission_diagnosis && (
          <MobileDetailRow label="Dx">{admission.admission_diagnosis}</MobileDetailRow>
        )}
      </div>

      <div className="grid grid-cols-3 gap-1.5 pt-0.5">
        <MobileActionBtn label="Ledger" icon={IcoLedger} onClick={onOpenLedger} tone="blue" />
        <MobileActionBtn label="Timeline" icon={IcoHistory} onClick={onTimeline} tone="indigo" disabled={!admission.patient_uhid} />
        {showDischarge && <MobileActionBtn label="Discharge" icon={CheckCircle} onClick={onDischarge} tone="emerald" />}
        {showProcess && <MobileActionBtn label="Process" icon={IcoProcess} onClick={onProcess} tone="violet" />}
        <MobileActionBtn label="Edit" icon={IcoEdit} onClick={onEdit} tone="amber" />
        <MobileActionBtn label="Print" icon={IcoPrint} onClick={onPrint} tone="sky" />
      </div>
    </MobileRecordCard>
  )
}

export function EmergencyCaseMobileCard({
  caseRow,
  triageLabel,
  triageBadgeClass,
  triageDotClass,
  dateLabel,
  isWaiting,
  onView,
  onPrint,
  onAdmit,
  onAttend,
}) {
  return (
    <MobileRecordCard tone="emergency">
      <div className="flex items-start gap-2">
        <span className={`w-2.5 h-2.5 rounded-full shrink-0 mt-2 ${triageDotClass}`} />
        <div className="min-w-0 flex-1">
          <p className="text-[16px] font-extrabold text-gray-900 leading-snug break-words">
            {caseRow.patient_name}
          </p>
          <p className="text-[12px] text-gray-500 mt-0.5">{dateLabel}</p>
        </div>
        <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full border shrink-0 ${triageBadgeClass}`}>
          {triageLabel}
        </span>
      </div>

      <div className="space-y-1.5">
        {caseRow.complaint && <MobileDetailRow label="Issue">{caseRow.complaint}</MobileDetailRow>}
        {caseRow.contact && (
          <MobileDetailRow label="Phone">
            <span className="inline-flex items-center gap-1">
              <Phone size={12} className="text-red-500" />
              {caseRow.contact}
            </span>
          </MobileDetailRow>
        )}
        <MobileDetailRow label="Status">{(caseRow.status || 'waiting').replace(/_/g, ' ')}</MobileDetailRow>
      </div>

      <div className="grid grid-cols-3 gap-1.5 pt-0.5">
        <MobileActionBtn label="View" icon={IcoView} onClick={onView} tone="indigo" />
        <MobileActionBtn label="Print" icon={IcoPrint} onClick={onPrint} tone="rose" />
        {isWaiting && <MobileActionBtn label="Admit" icon={IcoBed} onClick={onAdmit} tone="blue" />}
        {isWaiting && <MobileActionBtn label="Attend" icon={CheckCircle} onClick={onAttend} tone="emerald" />}
      </div>
    </MobileRecordCard>
  )
}

export function ExpenseSlipMobileCard({
  row,
  dateLabel,
  isCancelled,
  onView,
  onPrint,
  onEdit,
  onCancel,
}) {
  return (
    <MobileRecordCard tone={isCancelled ? 'cancelled' : 'default'}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-[16px] font-extrabold text-gray-900 leading-snug break-words">
            {row.paid_to || '—'}
          </p>
          {row.slip_number && (
            <p className="text-[12px] text-amber-700 font-mono mt-0.5 break-all">{row.slip_number}</p>
          )}
        </div>
        {isCancelled ? (
          <span className="text-[11px] font-black px-2.5 py-1 rounded-full uppercase shrink-0 bg-red-100 text-red-800">
            Cancelled
          </span>
        ) : row.source === 'other_funds' ? (
          <span className="text-[11px] font-bold px-2 py-0.5 rounded-full shrink-0 bg-slate-100 text-slate-700 border border-slate-200">
            Other Funds
          </span>
        ) : null}
      </div>

      <div className="space-y-1.5">
        <MobileDetailRow label="Date">{dateLabel}</MobileDetailRow>
        {row.remarks && <MobileDetailRow label="Note">{row.remarks}</MobileDetailRow>}
        <MobileDetailRow label="Mode">{(row.payment_mode || '—').toUpperCase()}</MobileDetailRow>
        <MobileDetailRow label="Amount">
          <span className="inline-flex items-center gap-0.5 font-bold text-gray-800">
            <IcoRupee size={12} />
            {row.total_amount}
          </span>
        </MobileDetailRow>
        {row.recorded_by_name && (
          <p className="text-[12px] text-gray-400">
            By: <span className="font-medium text-gray-500 break-all">{row.recorded_by_name}</span>
          </p>
        )}
      </div>

      <div className="grid grid-cols-3 gap-1.5 pt-0.5">
        <MobileActionBtn label="View" icon={IcoView} onClick={onView} tone="indigo" />
        {!isCancelled && <MobileActionBtn label="Print" icon={IcoPrint} onClick={onPrint} tone="amber" />}
        {!isCancelled && <MobileActionBtn label="Edit" icon={IcoEdit} onClick={onEdit} tone="emerald" />}
        {!isCancelled && <MobileActionBtn label="Cancel" icon={X} onClick={onCancel} tone="red" />}
      </div>
    </MobileRecordCard>
  )
}

export function DischargeHistoryMobileCard({
  row,
  admissionDateLabel,
  schemeName,
  balanceAmount,
  balanceTone,
  onEditAdmission,
  onEditSummary,
  onPrintBill,
  onViewSlip,
  editAdmissionDisabled,
  editSummaryDisabled,
  billPrintDisabled,
}) {
  const balanceBadgeClass =
    balanceTone === 'scheme'
      ? 'bg-yellow-100 text-yellow-900 border-yellow-200'
      : balanceTone === 'due'
        ? 'bg-red-50 text-red-700 border-red-100'
        : 'bg-emerald-50 text-emerald-700 border-emerald-100'

  return (
    <MobileRecordCard tone="ipd">
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-xl bg-blue-100 text-blue-700 flex items-center justify-center font-bold text-lg shrink-0">
          {row.patient_name ? row.patient_name[0].toUpperCase() : <IcoLedger size={18} />}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[16px] font-extrabold text-gray-900 leading-snug break-words">
            {row.patient_name || 'Unknown Patient'}
          </p>
          <p className="text-[12px] text-gray-500 mt-0.5">
            Admitted {admissionDateLabel}
          </p>
          {row.id && (
            <p className="text-[11px] text-gray-400 font-mono mt-0.5 break-all">ID: {String(row.id).slice(0, 8)}</p>
          )}
        </div>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {schemeName ? (
          <span className="text-[10px] px-2 py-0.5 rounded-full font-bold uppercase tracking-wide bg-yellow-100 text-yellow-900 border border-yellow-200">
            Scheme: {schemeName}
          </span>
        ) : (
          <span className={`text-[11px] px-2.5 py-0.5 rounded-full font-bold border ${balanceBadgeClass}`}>
            Balance: ₹{balanceAmount}
          </span>
        )}
      </div>

      <div className="grid grid-cols-2 gap-1.5 pt-0.5">
        <MobileActionBtn label="Edit" icon={IcoEdit} onClick={onEditAdmission} disabled={editAdmissionDisabled} tone="amber" />
        <MobileActionBtn label="Summary" icon={IcoEdit} onClick={onEditSummary} disabled={editSummaryDisabled} tone="emerald" />
        <MobileActionBtn label="Bill" icon={IcoReceipt} onClick={onPrintBill} disabled={billPrintDisabled} tone="blue" />
        <MobileActionBtn label="Slip" icon={IcoPrint} onClick={onViewSlip} tone="sky" />
      </div>
    </MobileRecordCard>
  )
}

const BILLING_MODE_LABELS = {
  cash: 'Cash',
  card: 'Card',
  upi: 'UPI',
  credit: 'Credit',
  bank_transfer: 'Bank',
  other: 'Other',
}

const BILLING_BOTTOM_THEMES = {
  emerald: {
    expandedBadge: 'bg-emerald-100 text-emerald-700 border border-emerald-200',
    collapsedBadge: 'bg-indigo-50 text-indigo-700 border border-indigo-100',
    totalText: 'text-emerald-700',
    submitBtn: 'bg-emerald-600 hover:bg-emerald-700',
    submittingLabel: 'Generating…',
  },
  amber: {
    expandedBadge: 'bg-amber-100 text-amber-800 border border-amber-200',
    collapsedBadge: 'bg-amber-50 text-amber-800 border border-amber-100',
    totalText: 'text-amber-700',
    submitBtn: 'bg-amber-600 hover:bg-amber-700',
    submittingLabel: 'Saving…',
  },
}

/**
 * Fixed bottom sheet for billing forms — details expand upward (reverse dropdown).
 */
export function PaymentSlipMobileBottomPanel({
  expanded,
  onToggle,
  total,
  subtotal,
  discountAmt,
  paymentMode,
  submitting,
  canSubmit,
  detailsContent,
  totalsContent,
  submitLabel = 'Generate Payment Slip',
  detailsTitle = 'Payment Details',
  theme = 'emerald',
  SubmitIcon = IcoReceipt,
}) {
  const modeLabel = BILLING_MODE_LABELS[paymentMode] || String(paymentMode || 'Cash')
  const palette = BILLING_BOTTOM_THEMES[theme] || BILLING_BOTTOM_THEMES.emerald

  return (
    <div className="shrink-0 z-30 bg-white border border-gray-200 border-b-0 rounded-t-2xl shadow-[0_-8px_28px_rgba(0,0,0,0.12)]">
      <div
        className={`overflow-hidden transition-[max-height] duration-300 ease-out ${
          expanded ? 'max-h-[min(72vh,560px)]' : 'max-h-0'
        }`}
      >
        <div className="px-3 pt-3 pb-2 overflow-y-auto max-h-[min(68vh,520px)] border-b border-gray-100 bg-gray-50/80">
          <p className="text-[11px] font-bold text-gray-400 uppercase tracking-wide mb-2.5">
            {detailsTitle}
          </p>
          {detailsContent}
          <div className="mt-3">{totalsContent}</div>
        </div>
      </div>

      <button
        type="button"
        onClick={onToggle}
        className="w-full px-4 py-2.5 flex items-center justify-between gap-3 active:bg-gray-50/80 border-b border-gray-200"
        aria-expanded={expanded}
        aria-label={expanded ? `Minimize ${detailsTitle.toLowerCase()}` : `View all ${detailsTitle.toLowerCase()}`}
      >
        <div className="flex items-center gap-2 min-w-0">
          <span
            className={`text-[11px] font-black px-2.5 py-1 rounded-full uppercase shrink-0 ${
              expanded ? palette.expandedBadge : palette.collapsedBadge
            }`}
          >
            {expanded ? 'Minimize' : 'View details'}
          </span>
          <span className="text-[12px] font-semibold text-gray-500 uppercase truncate">{modeLabel}</span>
        </div>
        <div className="flex items-center gap-2.5 shrink-0">
          <div className="text-right">
            <p className="text-[10px] font-bold text-gray-400 uppercase leading-none">Total</p>
            <p className={`text-[20px] font-black leading-tight ${palette.totalText}`}>₹{total.toFixed(2)}</p>
          </div>
          <ChevronDown
            size={22}
            className={`text-gray-400 transition-transform duration-300 ${expanded ? 'rotate-180' : ''}`}
          />
        </div>
      </button>

      {!expanded && discountAmt > 0 && (
        <div className="px-4 py-1.5 flex justify-between text-[12px] text-gray-500 border-b border-gray-50">
          <span>Subtotal ₹{subtotal.toFixed(2)}</span>
          <span className="text-red-500">−₹{discountAmt.toFixed(2)} discount</span>
        </div>
      )}

      <div className="p-3 pt-2">
        <button
          type="submit"
          disabled={submitting || !canSubmit}
          className={`w-full py-3 rounded-xl text-white font-bold text-[15px] disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2 active:scale-[0.98] transition-all shadow-md ${palette.submitBtn}`}
        >
          {submitting ? (
            <>
              <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
              {palette.submittingLabel}
            </>
          ) : (
            <>
              <SubmitIcon size={18} />
              {submitLabel}
            </>
          )}
        </button>
      </div>
    </div>
  )
}

// ─── MobilePortalShell (main export) ──────────────────────────────────────────
/**
 * The complete mobile layout shell.
 *
 * @param {object}   user              - auth user object
 * @param {string}   section           - current active section id
 * @param {string}   sectionTitle      - human-readable label of active section
 * @param {array}    navGroups         - NAV_GROUPS from parent (all nav items)
 * @param {array}    alerts            - follow-up alert objects
 * @param {function} onSelect          - section navigation handler
 * @param {function} onLogout          - logout handler
 * @param {function} markFollowUpDone  - mark alert as done handler
 * @param {node}     children          - the active section content
 */
export function MobilePortalShell({
  user,
  section,
  sectionTitle,
  navGroups,
  alerts = [],
  onSelect,
  onLogout,
  markFollowUpDone,
  children,
}) {
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [bellOpen, setBellOpen]       = useState(false)
  const bellRef                       = useRef(null)

  // Close bell dropdown on outside click
  useEffect(() => {
    function handler(e) {
      if (bellRef.current && !bellRef.current.contains(e.target)) setBellOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  // Wrap onSelect to also close sidebar
  const handleSelect = useCallback(
    (id) => {
      onSelect(id)
      setSidebarOpen(false)
    },
    [onSelect],
  )

  // Content area layout per section
  const listSections = new Set([
    'opd',
    'opd_history',
    'patients',
    'payment_slip_list',
    'payment_slip',
    'expense',
    'discharge',
    'ipd',
    'new_admission',
    'emergency',
    'reports',
  ])
  const contentClass = listSections.has(section)
    ? 'overflow-hidden p-0'
    : 'overflow-auto p-3'

  return (
    <div
      className="flex flex-col bg-gray-50"
      style={{ height: '100dvh', maxHeight: '100dvh', overflow: 'hidden' }}
    >
      {/* ── Top Header ── */}
      <MobileHeader
        user={user}
        sectionTitle={sectionTitle}
        onMenuOpen={() => setSidebarOpen(true)}
        alerts={alerts}
        bellOpen={bellOpen}
        setBellOpen={setBellOpen}
        bellRef={bellRef}
        markFollowUpDone={markFollowUpDone}
        onLogout={onLogout}
      />

      {/* ── Sidebar Drawer ── */}
      <MobileSidebarDrawer
        isOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        activeSection={section}
        onSelect={handleSelect}
        navGroups={navGroups}
      />

      {/* ── Main Content Area ── */}
      <main className={`flex-1 min-h-0 flex flex-col ${contentClass}`}>
        {children}
      </main>

      {/* ── Bottom Navigation (grid) ── */}
      <MobileBottomNav activeSection={section} onSelect={handleSelect} />
    </div>
  )
}

export default MobilePortalShell
