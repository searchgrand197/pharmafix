import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import { createPortal } from 'react-dom'
import {
  useIsMobile,
  MobilePortalShell,
  OpdSlipMobileCard,
  MobileListFilters,
  MobileCardList,
  PatientMobileCard,
  PaymentSlipMobileCard,
  IpdAdmissionMobileCard,
  EmergencyCaseMobileCard,
  DischargeHistoryMobileCard,
  PaymentSlipMobileBottomPanel,
} from './mobile'
import { useLocation, useNavigate } from 'react-router-dom'
import {
  matchReceptionPath,
  pathForSection,
  pathForSettingsTab,
  SECTION_PATHS,
} from './receptionRoutes'
import api from '../api'
import toast from 'react-hot-toast'
import { format } from 'date-fns'
import { useAuthStore } from '../stores/authStore'
import {
  Groups as GroupsIcon,
  Print as PrintIcon,
  Add as AddIcon,
  Tv as TvIcon,
  ArrowForward as ArrowForwardIcon,
  Search as SearchIcon,
  Monitor as MonitorIcon,
  Bed as BedIcon,
  WarningAmber as WarningAmberIcon,
  Description as DescriptionIcon,
  PersonAdd as PersonAddIcon,
  LocalHospital as LocalHospitalIcon,
  Logout as LogoutIcon,
  ExpandMore as ExpandMoreIcon,
  ChevronRight as ChevronRightIcon,
  ChevronLeft as ChevronLeftIcon,
  Checklist as ChecklistIcon,
  MonitorHeart as MonitorHeartIcon,
  Cancel as CancelIcon,
  CheckCircle as CheckCircleIcon,
  AccessTime as AccessTimeIcon,
  Refresh as RefreshIcon,
  Visibility as VisibilityIcon,
  AddCircle as AddCircleIcon,
  Edit as EditIcon,
  Air as AirIcon,
  CurrencyRupee as CurrencyRupeeIcon,
  ReceiptLong as ReceiptLongIcon,
  Delete as DeleteIcon,
  CreditCard as CreditCardIcon,
  Notifications as NotificationsIcon,
  Phone as PhoneIcon,
  Close as CloseIcon,
  LocalOffer as LocalOfferIcon,
  Person as PersonIcon,
  Favorite as FavoriteIcon,
  Report as ReportIcon,
  Article as ArticleIcon,
  Vaccines as VaccinesIcon,
  Science as ScienceIcon,
  Medication as MedicationIcon,
  Message as MessageIcon,
  DragIndicator as DragIndicatorIcon,
  Assessment as AssessmentIcon,
  FileDownload as FileDownloadIcon,
} from '@mui/icons-material'
import { getRoomsConfig, saveRoomsConfig, getTvGroupsConfig, saveTvGroupsConfig } from '../utils/rooms'
import BedSelector from '../components/BedSelector'
import { AmPmTimeInput, FormattedDateInput, toHtmlTimeValue } from '../components/DateTimeInputs'
import OpdGeneratorTab from '../components/OpdTemplateEditor/OpdGeneratorTab'
import DischargeClinicalForm from '../components/discharge/DischargeClinicalForm'
import { useDischargeFieldCatalog } from '../components/discharge/useDischargeFieldCatalog'
import { rxItemsToMedicationRows, medicationRowsToRxItems } from '../pharmacy/rxMedicationMapping'
import { DEFAULT_DOSAGE_PATTERNS, DEFAULT_TIMING_OPTIONS } from '../pharmacy/rxConstants'
import { syncHospitalBrandingFromApiRow } from '../utils/hospitalBranding'
import {
  SALUTATION_CHOICE_OPTIONS,
  resolveSalutationForSlip,
  formatPatientLineForSlip,
  formatGuardianLineForSlip,
  GUARDIAN_RELATIONSHIP_OPTIONS,
} from './print/opdPrintFormat'
import {
  getDefaultOpdFieldConfig,
  normalizeOpdFieldConfig,
  getCoreFieldByTemplateName,
  formatAgeSexForSlip,
} from '../components/OpdTemplateEditor/opdCoreFields.js'
import {
  syncCoreFieldsIntoLayout,
  filterLayoutFieldsForSlip,
} from '../components/OpdTemplateEditor/syncCoreFieldsIntoLayout.js'
import {
  buildOpdCustomFieldPayload,
  normalizeOpdCustomFields,
} from '../components/OpdTemplateEditor/opdTemplateData.js'
import { createSameTabPrintWindow, printHtmlInHiddenIframe, writeHtmlToWindow, deliverMobilePrintHtml } from '../utils/printHtmlInHiddenFrame'
import { mergeReceptionPortalProfileFromRow } from './settings/receptionPortalProfile'
import {
  DEFAULT_DOCUMENT_NUMBER_PARTS,
  DEFAULT_DOCUMENT_NEXT_NUMBERS,
  DOCUMENT_NUMBER_FORMAT_ROWS,
  normalizeDocumentNumberFormats,
  normalizeDocumentNextNumbers,
  validateAllDocumentNumberFormats,
  getDocumentNumberPreview,
  onFormatPartChange,
  getDefaultDocumentNumberParts,
} from './settings/documentNumberFormat'
import { getBedDisplayLabel } from '../utils/bedDisplay'
import {
  resolvePaymentSlipLogoUrl,
  buildPaymentSlipHeaderCss,
  buildPaymentSlipTopHeaderHtml,
  buildPaymentSlipProfileLines,
  buildPaymentSlipDocumentHtml,
  formatPaymentSlipAttributedDoctor,
  formatPaymentSlipGenderAge,
  formatPaymentSlipGuardianLine,
  PAYMENT_SLIP_PRINT_CLOSE_SCRIPT,
} from './print/paymentSlipPrint'
import { buildHmsPrintCloseScript, triggerHMSPrint, schedulePrintCleanup, shouldUseDedicatedPrintDocument, STANDALONE_PRINT_DOCUMENT_CSS } from '../utils/triggerHMSPrint'
import {
  QUICK_SERVICES_STORAGE_KEY,
  QUICK_SERVICE_CATEGORIES_STORAGE_KEY,
  QUICK_SERVICE_DEFAULT_CATEGORY,
  QUICK_SERVICE_ALL_CATEGORY,
  DEFAULT_QUICK_SERVICES,
  normalizeQuickServices,
  loadPaymentQuickServices,
  serviceGroupIdFromLabel,
} from './shared/paymentQuickServices'
import {
  formatTime,
  formatDateTime,
  formatReceiptDateTime,
  withTimeTokens,
  syncTimeDisplayModeFromRow,
  useTimeDisplayMode,
  getTimeDisplayMode,
} from '../utils/dateTimeFormat'
import CollectionTransactionList from '../components/collection/CollectionTransactionList'
import ReportsSection from './components/ReportsSection'
import ExpenseSection from './components/ExpenseSection'
import IpdProcessModal from '../components/ipd/IpdProcessModal'
import ProcessCompletionRing from '../components/ipd/ProcessCompletionRing'
import IpdProcessSettingsSection, { DiscardChangesConfirmModal } from './components/IpdProcessSettingsSection'
import {
  defaultIpdProcessTemplates,
  buildProcessLogDisplayEntries,
  finalizeIpdProcessTemplates,
  getProcessCompletionMeta,
  getTemplateConfig,
  normalizeIpdProcessTemplates,
  resolveLogProcessConfig,
} from '../utils/ipdProcessFieldConfig'
import PatientRegistrationForm from './components/PatientRegistrationForm'
import {
  buildPatientRegistrationInitial,
  buildPatientRegistrationInitialFromSearch,
  registerPatientFromForm,
  validatePatientRegistrationForm,
} from './components/patientRegistrationUtils'
import { printOpdSheet } from '../utils/printOpdSheet'
import TpaDocumentPackSection from './tpa/TpaDocumentPackSection'
import PharmacyInvoicePrint from '../pharmacy/PharmacyInvoicePrint'
import { normalizeOutletSettingsFromApi } from '../pharmacy/outletSettingsUtils'

/** Returns true when running inside a mobile browser (Android or iOS). */
function isMobileDevice() {
  return /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent)
}

/** Maps Patient.preferred_salutation from API to salutation dropdown value. */
function normalizeSalutationChoiceFromApi(raw) {
  if (raw == null || raw === '') return ''
  const s = String(raw).trim()
  if (s === 'none' || ['Mr', 'Mrs', 'Master', 'Miss'].includes(s)) return s
  return ''
}

const AGE_UNIT_OPTIONS = [
  { value: 'years', label: 'Yrs' },
  { value: 'months', label: 'Mon' },
  { value: 'days', label: 'Days' },
]

function normalizeAgeUnit(unit) {
  const u = String(unit || 'years').trim().toLowerCase()
  return u === 'months' || u === 'days' ? u : 'years'
}

function hydrateAgeFieldsFromPatient(p) {
  if (!p) return { age: '', ageUnit: 'years' }
  return {
    age: p.age_value != null && p.age_value !== ''
      ? String(p.age_value)
      : (p.age != null && p.age !== '' ? String(p.age) : ''),
    ageUnit: normalizeAgeUnit(p.age_unit),
  }
}

function formatAgeDisplayLabel(value, unit) {
  if (value == null || value === '') return '--'
  const labels = { years: 'Years', months: 'Months', days: 'Days' }
  return `${value} ${labels[normalizeAgeUnit(unit)] || 'Years'}`
}

function AgeWithUnitInput({
  value,
  unit,
  onValueChange,
  onUnitChange,
  inputClassName,
  selectClassName,
  maxLength = 3,
}) {
  return (
    <div className="flex gap-1">
      <input
        type="number"
        min="0"
        value={value}
        onChange={(e) => onValueChange(e.target.value.replace(/\D/g, '').slice(0, maxLength))}
        placeholder="0"
        className={inputClassName}
        style={{ flex: 1, minWidth: 0 }}
      />
      <select
        value={normalizeAgeUnit(unit)}
        onChange={(e) => onUnitChange(e.target.value)}
        className={selectClassName || inputClassName}
        style={{ width: 'auto', minWidth: '4.5rem' }}
      >
        {AGE_UNIT_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </div>
  )
}

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

const Users = asMuiIcon(GroupsIcon)
const Printer = asMuiIcon(PrintIcon)
const Plus = asMuiIcon(AddIcon)
const Tv = asMuiIcon(TvIcon)
const ArrowRight = asMuiIcon(ArrowForwardIcon)
const Search = asMuiIcon(SearchIcon)
const Monitor = asMuiIcon(MonitorIcon)
const Bed = asMuiIcon(BedIcon)
const AlertTriangle = asMuiIcon(WarningAmberIcon)
const FileText = asMuiIcon(DescriptionIcon)
const UserPlus = asMuiIcon(PersonAddIcon)
const Hospital = asMuiIcon(LocalHospitalIcon)
const LogOut = asMuiIcon(LogoutIcon)
const ChevronDown = asMuiIcon(ExpandMoreIcon)
const ChevronRight = asMuiIcon(ChevronRightIcon)
const ChevronLeft = asMuiIcon(ChevronLeftIcon)
const ClipboardList = asMuiIcon(ChecklistIcon)
const Activity = asMuiIcon(MonitorHeartIcon)
const XCircle = asMuiIcon(CancelIcon)
const CheckCircle = asMuiIcon(CheckCircleIcon)
const Clock = asMuiIcon(AccessTimeIcon)
const RefreshCw = asMuiIcon(RefreshIcon)
const Eye = asMuiIcon(VisibilityIcon)
const PlusCircle = asMuiIcon(AddCircleIcon)
const Edit2 = asMuiIcon(EditIcon)
const Wind = asMuiIcon(AirIcon)
const IndianRupee = asMuiIcon(CurrencyRupeeIcon)
const Receipt = asMuiIcon(ReceiptLongIcon)
const Trash2 = asMuiIcon(DeleteIcon)
const TpaPack = asMuiIcon(ArticleIcon)
const CreditCard = asMuiIcon(CreditCardIcon)
const Bell = asMuiIcon(NotificationsIcon)
const Phone = asMuiIcon(PhoneIcon)
const X = asMuiIcon(CloseIcon)
const Tag = asMuiIcon(LocalOfferIcon)
const User = asMuiIcon(PersonIcon)
const HeartPulse = asMuiIcon(FavoriteIcon)
const Skull = asMuiIcon(ReportIcon)
const ScrollText = asMuiIcon(ArticleIcon)
const Syringe = asMuiIcon(VaccinesIcon)
const FlaskConical = asMuiIcon(ScienceIcon)
const Pill = asMuiIcon(MedicationIcon)
const MessageSquare = asMuiIcon(MessageIcon)
const GripVertical = asMuiIcon(DragIndicatorIcon)
const BarChart2 = asMuiIcon(AssessmentIcon)
const Download = asMuiIcon(FileDownloadIcon)

const DEFAULT_PAYMENT_SLIP_PROFILE = {
  hospital_name: '',
  address: '',
  pin_code: '',
  phone: '',
  email: '',
  website: '',
  hospital_logo_url: '',
  uhid_prefix: 'DEF',
  invoice_prefix: 'INV',
  invoice_next_number: 1,
  document_number_formats: normalizeDocumentNumberFormats(DEFAULT_DOCUMENT_NUMBER_PARTS),
  document_next_numbers: normalizeDocumentNextNumbers(DEFAULT_DOCUMENT_NEXT_NUMBERS),
}

const DEFAULT_RECEPTION_OPD_SETTINGS = {
  default_city: 'Jind',
  default_state: 'Haryana',
  default_doctor_user: '',
  default_department: '',
  print_with_background: true,
  opd_fee_mode: 'doctor',
  opd_fee_slots: [],
  opd_visible_fields: [],
  opd_field_config: getDefaultOpdFieldConfig(),
  current_opd_slot_fee: null,
  current_opd_slot: null,
  admission_bed_label_mode: 'bed_code',
  time_display_mode: '12h',
  reception_collection_enabled: true,
  reception_daily_report_enabled: true,
  ipd_process_field_config: defaultIpdProcessTemplates(),
}

let receptionPortalSettingsCache = {
  ...DEFAULT_RECEPTION_OPD_SETTINGS,
  ...DEFAULT_PAYMENT_SLIP_PROFILE,
}

/** Discharge preview registers afterprint; bill print must not close preview (`ipd_ledger` vs `discharge`). */
let receptionistLastPrintKind = null

function clearAuthStorage() {
  useAuthStore.getState().logout()
}

function getReceptionOpdSettings() {
  return {
    default_city: receptionPortalSettingsCache.default_city || DEFAULT_RECEPTION_OPD_SETTINGS.default_city,
    default_state: receptionPortalSettingsCache.default_state || DEFAULT_RECEPTION_OPD_SETTINGS.default_state,
    default_doctor_user: receptionPortalSettingsCache.default_doctor_user || '',
    default_department: receptionPortalSettingsCache.default_department || '',
    print_with_background: receptionPortalSettingsCache.print_with_background === true,
    opd_fee_mode: receptionPortalSettingsCache.opd_fee_mode || 'doctor',
    opd_fee_slots: Array.isArray(receptionPortalSettingsCache.opd_fee_slots) ? receptionPortalSettingsCache.opd_fee_slots : [],
    opd_visible_fields: Array.isArray(receptionPortalSettingsCache.opd_visible_fields) ? receptionPortalSettingsCache.opd_visible_fields : [],
    opd_field_config: normalizeOpdFieldConfig(
      receptionPortalSettingsCache.opd_field_config,
      receptionPortalSettingsCache.opd_visible_fields,
    ),
    current_opd_slot_fee: receptionPortalSettingsCache.current_opd_slot_fee ?? null,
    current_opd_slot: receptionPortalSettingsCache.current_opd_slot ?? null,
    admission_bed_label_mode: receptionPortalSettingsCache.admission_bed_label_mode === 'bed_number' ? 'bed_number' : 'bed_code',
    time_display_mode: receptionPortalSettingsCache.time_display_mode === '12h' ? '12h' : '24h',
    reception_collection_enabled: receptionPortalSettingsCache.reception_collection_enabled !== false,
    reception_daily_report_enabled: receptionPortalSettingsCache.reception_daily_report_enabled !== false,
  }
}

function getIpdProcessTemplates() {
  return normalizeIpdProcessTemplates(
    receptionPortalSettingsCache.ipd_process_field_config || defaultIpdProcessTemplates(),
  )
}

function getIpdProcessFieldConfig() {
  return getTemplateConfig(getIpdProcessTemplates(), null)
}

async function saveIpdProcessFieldConfig(templatesRoot) {
  const payload = {
    ipd_process_field_config: finalizeIpdProcessTemplates(templatesRoot),
  }
  const { data } = await api.patch('/settings/reception-portal/', payload)
  const row = data?.data || data || {}
  receptionPortalSettingsCache = {
    ...receptionPortalSettingsCache,
    ipd_process_field_config: normalizeIpdProcessTemplates(
      row.ipd_process_field_config ?? payload.ipd_process_field_config,
    ),
  }
  return receptionPortalSettingsCache.ipd_process_field_config
}

async function loadReceptionPortalSettings() {
  try {
    const { data } = await api.get('/settings/reception-portal/')
    const row = data?.data || data || {}
    receptionPortalSettingsCache = {
      ...receptionPortalSettingsCache,
      default_city: row.default_city ?? receptionPortalSettingsCache.default_city,
      default_state: row.default_state ?? receptionPortalSettingsCache.default_state,
      default_doctor_user: row.default_doctor_user ? String(row.default_doctor_user) : '',
      default_department: row.default_department ?? receptionPortalSettingsCache.default_department ?? '',
      hospital_name: row.hospital_name ?? '',
      address: row.address ?? '',
      pin_code: row.pin_code ?? '',
      phone: row.phone ?? '',
      email: row.email ?? '',
      website: row.website ?? '',
      hospital_logo: row.hospital_logo ?? receptionPortalSettingsCache.hospital_logo ?? '',
      hospital_logo_url: row.hospital_logo_url ?? receptionPortalSettingsCache.hospital_logo_url ?? '',
      uhid_prefix: row.uhid_prefix ?? receptionPortalSettingsCache.uhid_prefix ?? DEFAULT_PAYMENT_SLIP_PROFILE.uhid_prefix,
      invoice_prefix: row.invoice_prefix ?? receptionPortalSettingsCache.invoice_prefix ?? DEFAULT_PAYMENT_SLIP_PROFILE.invoice_prefix,
      invoice_next_number: Number(row.invoice_next_number) > 0
        ? Number(row.invoice_next_number)
        : (receptionPortalSettingsCache.invoice_next_number ?? DEFAULT_PAYMENT_SLIP_PROFILE.invoice_next_number),
      document_number_formats: normalizeDocumentNumberFormats(
        row.document_number_formats ?? receptionPortalSettingsCache.document_number_formats,
      ),
      document_next_numbers: normalizeDocumentNextNumbers(
        row.document_next_numbers ?? receptionPortalSettingsCache.document_next_numbers,
      ),
      print_with_background: row.print_with_background ?? receptionPortalSettingsCache.print_with_background,
      opd_fee_mode: row.opd_fee_mode || receptionPortalSettingsCache.opd_fee_mode || 'doctor',
      opd_fee_slots: Array.isArray(row.opd_fee_slots) ? row.opd_fee_slots : (receptionPortalSettingsCache.opd_fee_slots || []),
      opd_visible_fields: Array.isArray(row.opd_visible_fields) ? row.opd_visible_fields : (receptionPortalSettingsCache.opd_visible_fields || []),
      opd_field_config: normalizeOpdFieldConfig(row.opd_field_config, row.opd_visible_fields),
      current_opd_slot_fee: row.current_opd_slot_fee ?? null,
      current_opd_slot: row.current_opd_slot ?? null,
      admission_bed_label_mode: row.admission_bed_label_mode === 'bed_number' ? 'bed_number' : 'bed_code',
      time_display_mode: row.time_display_mode === '12h' ? '12h' : '24h',
      reception_collection_enabled: row.reception_collection_enabled !== false,
      reception_daily_report_enabled: row.reception_daily_report_enabled !== false,
      ipd_process_field_config: normalizeIpdProcessTemplates(
        row.ipd_process_field_config ?? receptionPortalSettingsCache.ipd_process_field_config,
      ),
    }
    syncHospitalBrandingFromApiRow(receptionPortalSettingsCache)
    mergeReceptionPortalProfileFromRow(row)
    syncTimeDisplayModeFromRow(row)
  } catch {
    // keep defaults if API fails
  }
}

async function saveReceptionOpdSettings(settings) {
  const payload = {
    default_city: settings.default_city || '',
    default_state: settings.default_state || '',
    default_doctor_user: settings.default_doctor_user || null,
    print_with_background: settings.print_with_background === true,
    opd_fee_mode: settings.opd_fee_mode === 'slot' ? 'slot' : 'doctor',
    opd_fee_slots: Array.isArray(settings.opd_fee_slots) ? settings.opd_fee_slots : [],
  }
  const { data } = await api.patch('/settings/reception-portal/', payload)
  const row = data?.data || data || {}
  receptionPortalSettingsCache = {
    ...receptionPortalSettingsCache,
    ...payload,
    default_doctor_user: row.default_doctor_user ? String(row.default_doctor_user) : (payload.default_doctor_user || ''),
    opd_field_config: normalizeOpdFieldConfig(row.opd_field_config, row.opd_visible_fields),
    opd_fee_slots: Array.isArray(row.opd_fee_slots) ? row.opd_fee_slots : payload.opd_fee_slots,
  }
}

function getPaymentSlipProfile() {
  return {
    hospital_name: receptionPortalSettingsCache.hospital_name || DEFAULT_PAYMENT_SLIP_PROFILE.hospital_name,
    address: receptionPortalSettingsCache.address || DEFAULT_PAYMENT_SLIP_PROFILE.address,
    pin_code: receptionPortalSettingsCache.pin_code || DEFAULT_PAYMENT_SLIP_PROFILE.pin_code,
    phone: receptionPortalSettingsCache.phone || DEFAULT_PAYMENT_SLIP_PROFILE.phone,
    email: receptionPortalSettingsCache.email || DEFAULT_PAYMENT_SLIP_PROFILE.email,
    website: receptionPortalSettingsCache.website || DEFAULT_PAYMENT_SLIP_PROFILE.website,
    hospital_logo_url:
      receptionPortalSettingsCache.hospital_logo_url
      || receptionPortalSettingsCache.hospital_logo
      || DEFAULT_PAYMENT_SLIP_PROFILE.hospital_logo_url,
    uhid_prefix: receptionPortalSettingsCache.uhid_prefix || DEFAULT_PAYMENT_SLIP_PROFILE.uhid_prefix,
    invoice_prefix: receptionPortalSettingsCache.invoice_prefix || DEFAULT_PAYMENT_SLIP_PROFILE.invoice_prefix,
    invoice_next_number: Number(receptionPortalSettingsCache.invoice_next_number) > 0
      ? Number(receptionPortalSettingsCache.invoice_next_number)
      : DEFAULT_PAYMENT_SLIP_PROFILE.invoice_next_number,
    document_number_formats: normalizeDocumentNumberFormats(
      receptionPortalSettingsCache.document_number_formats ?? DEFAULT_PAYMENT_SLIP_PROFILE.document_number_formats,
    ),
    document_next_numbers: normalizeDocumentNextNumbers(
      receptionPortalSettingsCache.document_next_numbers ?? DEFAULT_PAYMENT_SLIP_PROFILE.document_next_numbers,
    ),
  }
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

function ipdAdmissionSortTime(admission) {
  for (const value of [admission?.created_at, admission?.admission_date, admission?.updated_at]) {
    if (!value) continue
    const ts = new Date(value).getTime()
    if (!Number.isNaN(ts)) return ts
  }
  return 0
}

function sortAdmissionsLatestFirst(rows) {
  return [...(Array.isArray(rows) ? rows : [])].sort((a, b) => {
    const timeDiff = ipdAdmissionSortTime(b) - ipdAdmissionSortTime(a)
    if (timeDiff !== 0) return timeDiff
    return String(b?.ipd_no || '').localeCompare(String(a?.ipd_no || ''))
  })
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
  try {
    return JSON.stringify(d)
  } catch {
    return fallback
  }
}

async function savePaymentSlipProfile(profile) {
  const payload = new FormData()
  payload.append('hospital_name', profile.hospital_name || '')
  payload.append('address', profile.address || '')
  payload.append('pin_code', profile.pin_code || '')
  payload.append('phone', profile.phone || '')
  payload.append('email', profile.email || '')
  payload.append('website', profile.website || '')
  payload.append('uhid_prefix', String(profile.uhid_prefix || DEFAULT_PAYMENT_SLIP_PROFILE.uhid_prefix).trim().toUpperCase())
  payload.append('invoice_prefix', String(profile.invoice_prefix || DEFAULT_PAYMENT_SLIP_PROFILE.invoice_prefix).trim().toUpperCase())
  payload.append('invoice_next_number', String(
    Number(profile.invoice_next_number) > 0
      ? Number(profile.invoice_next_number)
      : DEFAULT_PAYMENT_SLIP_PROFILE.invoice_next_number,
  ))
  payload.append(
    'document_number_formats',
    JSON.stringify(normalizeDocumentNumberFormats(profile.document_number_formats)),
  )
  payload.append(
    'document_next_numbers',
    JSON.stringify(normalizeDocumentNextNumbers(profile.document_next_numbers)),
  )
  if (profile.hospital_logo_file) {
    payload.append('hospital_logo', profile.hospital_logo_file)
  } else if (profile.remove_hospital_logo) {
    payload.append('hospital_logo', '')
  }
  const { data } = await api.patch('/settings/reception-portal/', payload)
  const row = data?.data || data || {}
  receptionPortalSettingsCache = {
    ...receptionPortalSettingsCache,
    hospital_name: row.hospital_name ?? profile.hospital_name ?? '',
    address: row.address ?? profile.address ?? '',
    pin_code: row.pin_code ?? profile.pin_code ?? '',
    phone: row.phone ?? profile.phone ?? '',
    email: row.email ?? profile.email ?? '',
    website: row.website ?? profile.website ?? '',
    uhid_prefix: row.uhid_prefix ?? profile.uhid_prefix ?? receptionPortalSettingsCache.uhid_prefix,
    invoice_prefix: row.invoice_prefix ?? profile.invoice_prefix ?? receptionPortalSettingsCache.invoice_prefix,
    invoice_next_number: Number(row.invoice_next_number) > 0
      ? Number(row.invoice_next_number)
      : (Number(profile.invoice_next_number) > 0 ? Number(profile.invoice_next_number) : DEFAULT_PAYMENT_SLIP_PROFILE.invoice_next_number),
    document_number_formats: normalizeDocumentNumberFormats(
      row.document_number_formats ?? profile.document_number_formats,
    ),
    document_next_numbers: normalizeDocumentNextNumbers(
      row.document_next_numbers ?? profile.document_next_numbers,
    ),
    hospital_logo: row.hospital_logo ?? '',
    hospital_logo_url: row.hospital_logo_url ?? row.hospital_logo ?? '',
  }
  syncHospitalBrandingFromApiRow(receptionPortalSettingsCache)
  mergeReceptionPortalProfileFromRow(row)
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function sanitizePersonName(value) {
  return String(value || '').replace(/[0-9]/g, '')
}

/** Enter submits cancel modals; Shift+Enter allows a new line in the reason field. */
function handleCancelReasonKeyDown(e, onSubmit, { disabled = false } = {}) {
  if (disabled || e.key !== 'Enter' || e.shiftKey) return
  e.preventDefault()
  onSubmit()
}

const INDIAN_STATE_CODE_MAP = {
  andhrapradesh: 'AP',
  arunachalpradesh: 'AR',
  assam: 'AS',
  bihar: 'BR',
  chhattisgarh: 'CG',
  goa: 'GA',
  gujarat: 'GJ',
  haryana: 'HR',
  himachalpradesh: 'HP',
  jharkhand: 'JH',
  karnataka: 'KA',
  kerala: 'KL',
  madhyapradesh: 'MP',
  maharashtra: 'MH',
  manipur: 'MN',
  meghalaya: 'ML',
  mizoram: 'MZ',
  nagaland: 'NL',
  odisha: 'OD',
  orissa: 'OD',
  punjab: 'PB',
  rajasthan: 'RJ',
  sikkim: 'SK',
  tamilnadu: 'TN',
  telangana: 'TS',
  tripura: 'TR',
  uttarpradesh: 'UP',
  uttarakhand: 'UK',
  uttaranchal: 'UK',
  westbengal: 'WB',
  andamannicobarislands: 'AN',
  chandigarh: 'CH',
  dadraandnagarhavelianddamananddiu: 'DH',
  dadraandnagarhaveli: 'DN',
  damananddiu: 'DD',
  delhi: 'DL',
  nctofdelhi: 'DL',
  jammuandkashmir: 'JK',
  ladakh: 'LA',
  lakshadweep: 'LD',
  puducherry: 'PY',
  pondicherry: 'PY',
}

const INDIAN_STATE_OPTIONS = [
  'Andhra Pradesh',
  'Arunachal Pradesh',
  'Assam',
  'Bihar',
  'Chhattisgarh',
  'Goa',
  'Gujarat',
  'Haryana',
  'Himachal Pradesh',
  'Jharkhand',
  'Karnataka',
  'Kerala',
  'Madhya Pradesh',
  'Maharashtra',
  'Manipur',
  'Meghalaya',
  'Mizoram',
  'Nagaland',
  'Odisha',
  'Punjab',
  'Rajasthan',
  'Sikkim',
  'Tamil Nadu',
  'Telangana',
  'Tripura',
  'Uttar Pradesh',
  'Uttarakhand',
  'West Bengal',
  'Andaman and Nicobar Islands',
  'Chandigarh',
  'Dadra and Nagar Haveli and Daman and Diu',
  'Delhi',
  'Jammu and Kashmir',
  'Ladakh',
  'Lakshadweep',
  'Puducherry',
]

function toStateCode(stateValue) {
  const raw = String(stateValue || '').trim()
  if (!raw) return ''
  const compact = raw.toLowerCase().replace(/[^a-z]/g, '')
  if (INDIAN_STATE_CODE_MAP[compact]) return INDIAN_STATE_CODE_MAP[compact]
  if (/^[a-z]{2}$/i.test(raw)) return raw.toUpperCase()
  const parts = raw.split(/\s+/).filter(Boolean)
  if (parts.length >= 2) return `${parts[0][0] || ''}${parts[1][0] || ''}`.toUpperCase()
  return raw.slice(0, 2).toUpperCase()
}

const CITY_CODE_MAP = {
  chandigarh: 'CHD',
  delhi: 'DEL',
  newdelhi: 'DEL',
  gurugram: 'GGN',
  gurgaon: 'GGN',
  faridabad: 'FDB',
  rohtak: 'RTK',
  jind: 'JND',
  hisar: 'HSR',
  panipat: 'PNP',
  sonipat: 'SNP',
  karnal: 'KNL',
  ambala: 'AMB',
  kurukshetra: 'KUK',
  mumbai: 'MUM',
  pune: 'PUN',
  bengaluru: 'BLR',
  bangalore: 'BLR',
  hyderabad: 'HYD',
  chennai: 'CHE',
  kolkata: 'CCU',
  lucknow: 'LKO',
  jaipur: 'JAI',
  patna: 'PAT',
  bhopal: 'BPL',
  indore: 'IDR',
  ahmedabad: 'AMD',
  surat: 'STV',
  kochi: 'COK',
  trivandrum: 'TRV',
  thiruvananthapuram: 'TRV',
}

function toCityCode(cityValue) {
  const raw = String(cityValue || '').trim()
  if (!raw) return ''
  const compact = raw.toLowerCase().replace(/[^a-z]/g, '')
  if (CITY_CODE_MAP[compact]) return CITY_CODE_MAP[compact]
  if (/^[a-z]{2,4}$/i.test(raw)) return raw.toUpperCase()
  const token = raw.split(/\s+/).filter(Boolean).join('')
  return token.slice(0, 3).toUpperCase()
}

function resolveOpdTemplateAutofill(fieldName, ctx) {
  const core = getCoreFieldByTemplateName(fieldName)
  if (core?.autofillType) return { type: core.autofillType }

  const f = String(fieldName || '')
  const lower = f.toLowerCase()
  const compact = lower.replace(/[\s._-]/g, '')

  // NOTE: guardian must be checked BEFORE generic 'name' check
  if (lower.includes('guardian') || lower.includes('relative') || lower.includes('attendant')) return { type: 'guardian' }
  if (lower.includes('patient') && !lower.includes('guardian')) return { type: 'patient' }
  if (lower === 'name' || (lower.includes('name') && !lower.includes('guardian'))) return { type: 'patient' }

  if ((lower.includes('token') && lower.includes('date')) || compact.includes('tokendate')) return { type: 'token_datetime' }
  if (lower.includes('registration') || compact.includes('registeredat') || compact.includes('regdate')) return { type: 'registered_at' }
  if (lower.includes('date') || compact === 'dt' || compact.includes('visitdate')) return { type: 'visit_datetime' }

  if (lower.includes('reg') || lower.includes('uhid') || compact.includes('mrno') || compact.includes('uhidno')) return { type: 'uhid' }
  if (lower.includes('phone') || lower.includes('mobile') || lower.includes('contact') || compact.includes('phoneno') || compact.includes('mobileno')) return { type: 'phone' }

  if (lower === 'no' || lower.includes('token') || lower.includes('queue') || lower.includes('opd') || lower.includes('slip') || lower.includes('visit') || lower.includes('no.')) return { type: 'token' }

  if (compact.includes('chiefcomplaint') || lower.includes('complaint') || lower.includes('reason') || lower.includes('chief')) return { type: 'chief_complaint' }
  if (lower.includes('doctor') || lower.includes('doc')) return { type: 'doctor' }
  if (lower.includes('department') || lower.includes('dept')) return { type: 'department' }

  if (lower.includes('age') || lower.includes('sex') || compact.includes('agesex')) return { type: 'age_sex' }
  if (lower.includes('gender') || lower.includes('sex')) return { type: 'gender' }

  if (lower.includes('address') || lower.includes('addr')) return { type: 'address' }
  if (lower.includes('city') || lower.includes('town')) return { type: 'city' }
  if (lower.includes('state')) return { type: 'state' }

  if (lower.includes('amount') || lower.includes('fee') || lower.includes('charge') || lower.includes('paid')) return { type: 'amount_mode' }

  // no match
  return null
}

function getOpdAutofillValue(fieldName, ctx) {
  const rule = resolveOpdTemplateAutofill(fieldName, ctx)
  if (!rule) return ''
  const displayToken = ctx.displayToken || ''
  if (rule.type === 'guardian') return ctx.guardianLine || ''
  if (rule.type === 'patient') return ctx.patientLine || ''
  if (rule.type === 'token') return displayToken
  if (rule.type === 'uhid') return ctx.uhid || ''
  if (rule.type === 'phone') return ctx.phone || ''
  if (rule.type === 'doctor') return ctx.doctorName || ''
  if (rule.type === 'department') return ctx.department || ''
  if (rule.type === 'gender') return ctx.gender || ''
  if (rule.type === 'city') return ctx.city || ''
  if (rule.type === 'state') return ctx.state || ''
  if (rule.type === 'address') return ctx.address || ''
  if (rule.type === 'chief_complaint') return ctx.chiefComplaint || ''
  if (rule.type === 'age_sex') return ctx.ageSex || ''
  if (rule.type === 'amount_mode') return ctx.amountMode || ''
  if (rule.type === 'registered_at') return ctx.registeredAt || ''
  if (rule.type === 'visit_datetime') return ctx.visitDateTime || ''
  if (rule.type === 'token_datetime') return ctx.tokenDateTime || displayToken
  return ''
}

const PRINT_WINDOW_CLOSE_SCRIPT = buildHmsPrintCloseScript()

// ─── Sidebar Nav Config ───────────────────────────────────────────────────────
const NAV_GROUPS = [
  {
    label: 'OPD',
    items: [
      { id: 'opd', label: 'Create OPD', icon: Users, path: SECTION_PATHS.opd },
      { id: 'opd_history', label: 'OPD Slips', icon: FileText, path: SECTION_PATHS.opd_history },
    ],
  },
  {
    label: 'IPD',
    items: [
      { id: 'ipd', label: 'Active Admissions', icon: Bed, path: SECTION_PATHS.ipd },
      { id: 'new_admission', label: 'New Admission', icon: PlusCircle, path: SECTION_PATHS.new_admission },
    ],
  },
  {
    label: 'Emergency',
    items: [{ id: 'emergency', label: 'Emergency Cases', icon: AlertTriangle, path: SECTION_PATHS.emergency }],
  },
  {
    label: 'Patients',
    items: [
      { id: 'patients', label: 'Patient List', icon: ClipboardList, path: SECTION_PATHS.patients },
      { id: 'register', label: 'Register Patient', icon: UserPlus, path: SECTION_PATHS.register },
    ],
  },
  {
    label: 'Billing',
    items: [
      { id: 'payment_slip', label: 'Payment Slip', icon: Receipt, path: SECTION_PATHS.payment_slip },
      { id: 'payment_slip_list', label: 'Payment Slips List', icon: FileText, path: SECTION_PATHS.payment_slip_list },
      { id: 'expense', label: 'Expense', icon: IndianRupee, path: SECTION_PATHS.expense },
    ],
  },
  {
    label: 'Reports',
    items: [{ id: 'reports', label: 'Daily Report', icon: BarChart2, path: SECTION_PATHS.reports }],
  },
  {
    label: 'Discharge',
    items: [{ id: 'discharge', label: 'Discharge Summary', icon: FileText, path: SECTION_PATHS.discharge }],
  },
  {
    label: 'TPA',
    items: [{ id: 'tpa', label: 'Document Pack', icon: TpaPack, path: SECTION_PATHS.tpa }],
  },
  {
    label: 'Setup',
    items: [
      { id: 'settings', label: 'Settings', icon: Tag, path: SECTION_PATHS.settings },
    ],
  },
  {
    label: 'Staff',
    items: [{ id: 'attendance', label: 'Attendance', icon: Clock, path: SECTION_PATHS.attendance }],
  },
]

// ─── Follow-Up Alert Banner ────────────────────────────────────────────────────
function FollowUpAlertBanner() {
  const [alerts, setAlerts] = useState([]);
  const [dismissed, setDismissed] = useState(new Set());
  const [minimized, setMinimized] = useState(false);

  useEffect(() => {
    fetchAlerts();
    const interval = setInterval(fetchAlerts, 5 * 60 * 1000); // refresh every 5 min
    return () => clearInterval(interval);
  }, []);

  async function fetchAlerts() {
    try {
      const { data } = await api.get('/follow-up-alerts/');
      setAlerts(data);
    } catch { }
  }

  const visible = alerts.filter(a => !dismissed.has(a.id));
  const todayAlerts = visible.filter(a => a.is_today);
  const tomorrowAlerts = visible.filter(a => a.is_tomorrow);

  if (visible.length === 0) return null;

  return (
    <div className={`border-b shadow-sm ${
      todayAlerts.length > 0 ? 'bg-red-50 border-red-200' : 'bg-amber-50 border-amber-200'
    }`}>
      {/* Header row */}
      <div className="flex items-center justify-between px-4 py-2">
        <div className="flex items-center gap-2">
          <div className={`relative flex items-center justify-center w-7 h-7 rounded-full ${
            todayAlerts.length > 0 ? 'bg-red-500' : 'bg-amber-500'
          } text-white`}>
            <Bell size={13} />
            <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-white border-2 border-current text-[9px] font-black flex items-center justify-center ${
              todayAlerts.length > 0 ? 'text-red-600 border-red-500' : 'text-amber-600 border-amber-500'
            }">{visible.length}</span>
          </div>
          <span className={`text-xs font-extrabold uppercase tracking-wider ${
            todayAlerts.length > 0 ? 'text-red-700' : 'text-amber-700'
          }`}>
            {todayAlerts.length > 0 ? `🚨 ${todayAlerts.length} Follow-up Due TODAY` : ''}
            {todayAlerts.length > 0 && tomorrowAlerts.length > 0 ? '  •  ' : ''}
            {tomorrowAlerts.length > 0 ? `🔔 ${tomorrowAlerts.length} Follow-up Tomorrow` : ''}
          </span>
        </div>
        <button onClick={() => setMinimized(m => !m)}
          className="text-xs text-gray-500 hover:text-gray-800 font-bold px-2 py-1 rounded hover:bg-white/60 transition-all">
          {minimized ? 'Show ▼' : 'Hide ▲'}
        </button>
      </div>

      {/* Alert cards */}
      {!minimized && (
        <div className="flex gap-2 overflow-x-auto px-4 pb-3 pt-1">
          {visible.map(alert => (
            <div key={alert.id} className={`flex-shrink-0 w-72 rounded-xl border p-3 shadow-sm relative ${
              alert.is_today
                ? 'bg-red-100 border-red-300'
                : 'bg-amber-100 border-amber-300'
            }`}>
              {/* Dismiss */}
              <button onClick={() => setDismissed(d => new Set([...d, alert.id]))}
                className="absolute top-2 right-2 text-gray-400 hover:text-gray-700">
                <X size={12} />
              </button>

              <div className="flex items-start gap-2 mb-2">
                <div className={`w-8 h-8 rounded-lg flex items-center justify-center text-white font-black text-sm shrink-0 ${
                  alert.is_today ? 'bg-red-500' : 'bg-amber-500'
                }`}>
                  {alert.is_today ? '🔔' : '📅'}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-bold text-sm text-gray-800 truncate">{alert.patient_name}</p>
                  <p className="text-[10px] text-gray-500 font-mono">{alert.uhid}</p>
                </div>
              </div>

              <p className="text-[10px] text-gray-600 mb-1 line-clamp-2">
                {alert.visit_reason || alert.revisit_advice || 'Follow-up consultation'}
              </p>

              <div className="flex items-center justify-between mt-2">
                <span className={`text-[10px] font-extrabold px-2 py-0.5 rounded-full ${
                  alert.is_today
                    ? 'bg-red-200 text-red-800'
                    : 'bg-amber-200 text-amber-800'
                }`}>
                  {alert.is_today ? 'DUE TODAY' : 'DUE TOMORROW'}
                </span>

                {alert.patient_phone && (
                  <a href={`tel:${alert.patient_phone}`}
                    className="flex items-center gap-1.5 text-[11px] font-bold bg-green-600 text-white px-3 py-1.5 rounded-lg hover:bg-green-700 transition-all shadow-sm">
                    <Phone size={11} /> Call
                  </a>
                )}
              </div>

              {alert.doctor_name && (
                <p className="text-[10px] text-gray-400 mt-1.5">Dr. {alert.doctor_name}</p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── OPD Slip Print ──────────────────────────────────────────────────────────
function PrintSlip({ visit, onClose, embedded = false, autoPrint = false }) {
  const [layoutFields, setLayoutFields] = useState([])
  const [slipLayout, setSlipLayout] = useState(null)
  const [fieldValues, setFieldValues] = useState({})
  const [loadingTemplate, setLoadingTemplate] = useState(true)
  const displayToken = visit.display_token || `${visit.room?.prefix || ''}${visit.token_number || visit.queue_number || ''}`
  const patientLine = formatPatientLineForSlip(
    visit.patient_name,
    visit.patient_gender,
    visit.patient_age,
    visit.patient_salutation,
    visit.patient_age_unit,
  )
  const guardianLine = formatGuardianLineForSlip(visit.patient_guardian_name, visit.patient_guardian_relationship)

  useEffect(() => {
    const loadOpdLayout = async () => {
      try {
        const res = await fetch('/api/templates')
        if (res.ok) {
          const data = await res.json()
          const single = (data.templates || []).find(t => t.key === 'single')
          const cfg = normalizeOpdFieldConfig(
            getReceptionOpdSettings().opd_field_config,
            getReceptionOpdSettings().opd_visible_fields,
          )
          if (single?.layout) {
            const synced = syncCoreFieldsIntoLayout(single.layout, cfg)
            setSlipLayout(synced)
            const slipFields = filterLayoutFieldsForSlip(synced, cfg)
            const fields = Object.keys(slipFields)
            setLayoutFields(fields)
            const initValues = {}
            const savedCustom = normalizeOpdCustomFields(
              visit.patient_opd_custom_fields || visit.opd_custom_fields,
            )
            const visitDateDisplay = visit.visit_date
              ? format(new Date(`${visit.visit_date}T12:00:00`), 'dd/MM/yyyy')
              : ''
            const visitTimeDisplay = visit.created_at
              ? formatTime(visit.created_at)
              : formatTime(new Date())
            const visitDateTimeDisplay = visitDateDisplay
              ? `${visitDateDisplay} (${visitTimeDisplay})`
              : ''
            for (const f of fields) {
              const tokenDateTime = visitDateTimeDisplay ? `${displayToken} · ${visitDateTimeDisplay}` : displayToken
              const registeredAtRaw = visit.patient_registered_at || ''
              const registeredAt = registeredAtRaw ? formatDateTime(registeredAtRaw, { paren: true }) : ''
              const ageSexVal = formatAgeSexForSlip(visit.patient_age, visit.patient_gender, visit.patient_age_unit)
              const cityCode = toCityCode(visit.patient_city)
              const stateCode = toStateCode(visit.patient_state)
              let fullAddress = [visit.patient_address, cityCode, stateCode].filter(Boolean).join(', ')
              if (fullAddress.length > 35) fullAddress = fullAddress.substring(0, 32) + '...'
              const auto = getOpdAutofillValue(f, {
                displayToken,
                patientLine,
                guardianLine,
                tokenDateTime,
                registeredAt,
                visitDateTime: visitDateTimeDisplay,
                uhid: visit.patient_uhid || '',
                phone: visit.patient_phone || '',
                doctorName: visit.doc_name || '',
                department: visit.department || '',
                ageSex: ageSexVal,
                gender: visit.patient_gender || '',
                address: fullAddress,
                city: cityCode,
                state: stateCode,
                chiefComplaint: visit.chief_complaint || '',
                amountMode: visit.amount ? `${visit.amount} (${visit.payment_mode || 'cash'})` : '',
              })
              initValues[f] = templateFieldUsesMainFormOnly(f)
                ? (auto || '')
                : (savedCustom[f] ?? '')
            }
            setFieldValues(initValues)
          }
        }
      } catch (err) {
        // silently fail and fallback to basic slip
      } finally {
        setLoadingTemplate(false)
      }
    }
    loadOpdLayout()
  }, [visit, patientLine, guardianLine])

  function printBasicSlip() {
    const isMobile = isMobileDevice()
    const slipDateTime =
      visit.visit_date
        ? `${format(new Date(visit.visit_date), 'dd/MM/yyyy')} ${
            visit.created_at ? formatTime(visit.created_at) : formatTime(new Date())
          }`
        : ''
    const docHtml = `
      <html><head><title>OPD Slip</title>
      <style>
        body { font-family: Arial, sans-serif; padding: 20px; max-width: 300px; }
        .logo { font-size: 18px; font-weight: bold; color: #1d4ed8; border-bottom: 2px solid #1d4ed8; padding-bottom: 8px; margin-bottom: 12px; }
        .token { font-size: 64px; font-weight: 900; color: #1d4ed8; text-align: center; margin: 10px 0; }
        .row { display: flex; justify-content: space-between; font-size: 12px; margin: 4px 0; }
        .label { color: #6b7280; }
        .footer { margin-top: 16px; padding-top: 8px; border-top: 1px dashed #ccc; font-size: 11px; color: #9ca3af; text-align: center; }
      </style></head>
      <body>
      <div class="logo">🏥 HMS Hospital</div>
      <div class="token">${displayToken}</div>
      <div class="row"><span class="label">OPD No.</span><span>${displayToken}</span></div>
      <div class="row"><span class="label">UHID</span><span>${visit.patient_uhid || ''}</span></div>
      <div class="row"><span class="label">Patient</span><span>${patientLine}</span></div>
      ${guardianLine ? `<div class="row"><span class="label">Guardian</span><span>${guardianLine}</span></div>` : ''}
      <div class="row"><span class="label">Date</span><span>${slipDateTime}</span></div>
      <div class="row"><span class="label">Doctor</span><span>${visit.room?.label || visit.doc_name || 'OPD'}</span></div>
      <div class="row"><span class="label">Complaint</span><span>${visit.chief_complaint || '-'}</span></div>
      ${visit.patient_city ? `<div class="row"><span class="label">City</span><span>${toCityCode(visit.patient_city)}${toStateCode(visit.patient_state) ? ', ' + toStateCode(visit.patient_state) : ''}</span></div>` : ''}
      ${visit.amount ? `<div class="row"><span class="label">Amount</span><span>₹${visit.amount}</span></div>` : ''}
      <div class="footer">Please wait for your token to be called<br>Keep this slip safe</div>
      ${isMobile ? '' : PRINT_WINDOW_CLOSE_SCRIPT}
      </body></html>
    `

    // Mobile: render the thermal slip on a real same-origin page (/print-slip?job=payment) so the
    // print dialog shows the content. The desktop close-script (about:blank replace on afterprint)
    // is omitted above because it blanks the live-rendered mobile print preview.
    if (isMobile) {
      const win = shouldUseDedicatedPrintDocument() ? null : window.open('/print-slip?job=payment', '_blank')
      deliverMobilePrintHtml(docHtml, {
        targetWindow: win,
        storageKey: 'payment-slip-print-job',
        onComplete: onClose,
      })
      return
    }

    const w = createSameTabPrintWindow()
    w.document.write(docHtml)
    w.document.close()
    onClose()
  }

  async function printOpdPaymentSlip() {
    if (!visit.amount) {
      toast.error('No payment amount on this visit')
      return
    }
    let slipNumber
    try {
      const res = await api.post(`/opd-visits/${visit.id}/payment-slip/`)
      slipNumber = res.data?.data?.slip_number || res.data?.slip_number
    } catch {
      toast.error('Could not allocate OPD payment slip number')
      return
    }

    const slipProfile = getPaymentSlipProfile()
    const logoUrl = resolvePaymentSlipLogoUrl(slipProfile)
    const profileLines = buildPaymentSlipProfileLines(slipProfile, escapeHtml)
    const patientName = (visit.patient_name || patientLine || 'PATIENT').toUpperCase()
    const genderAge = formatPaymentSlipGenderAge({
      gender: visit.patient_gender || '',
      age: visit.patient_age,
      age_unit: visit.patient_age_unit,
    })
    const guardianSlipLine = formatPaymentSlipGuardianLine({
      guardian_name: visit.patient_guardian_name || '',
      guardian_relationship: visit.patient_guardian_relationship || '',
    })
    const doctorName = visit.doctor_name || visit.doc_name || ''
    const attributedDoctor = formatPaymentSlipAttributedDoctor(doctorName)
    const payModeLabel = visit.payment_mode === 'upi'
      ? 'UPI Payment'
      : visit.payment_mode === 'other'
        ? 'Other Payment'
        : 'Cash Payment'
    const dateTimeStr = visit.created_at
      ? formatDateTime(visit.created_at, {})
      : formatDateTime(new Date(), {})

    const isMobile = isMobileDevice()
    const docHtml = buildPaymentSlipDocumentHtml({
      title: `OPD Receipt — ${slipNumber}`,
      hospitalName: slipProfile.hospital_name || DEFAULT_PAYMENT_SLIP_PROFILE.hospital_name,
      logoUrl,
      profileLines,
      escapeHtml,
      slipNumber,
      invoiceNumber: visit.opd_no || displayToken,
      patientName,
      genderAge,
      payModeLabel,
      mobile: visit.patient_phone || '—',
      dateTimeStr,
      guardianLine: guardianSlipLine,
      attributedDoctor,
      referredBy: '',
      purpose: 'OPD Consultation',
      lineItems: [{ description: 'OPD Consultation Fee', unit_price: Number(visit.amount), quantity: 1, category: 'OPD' }],
      subtotal: Number(visit.amount),
      discount: 0,
      total: Number(visit.amount),
      isCredit: false,
      paidBoxLabel: '✓ PAID',
      printCloseScript: isMobile ? '' : PAYMENT_SLIP_PRINT_CLOSE_SCRIPT,
    })

    if (isMobile) {
      const win = shouldUseDedicatedPrintDocument() ? null : window.open('/print-slip?job=payment', '_blank')
      deliverMobilePrintHtml(docHtml, { targetWindow: win, storageKey: 'payment-slip-print-job', onComplete: onClose })
      return
    }
    const w = createSameTabPrintWindow({ onComplete: onClose })
    w.document.write(docHtml)
    w.document.close()
  }

  async function printFullOpdSheet() {
    const opdSettings = getReceptionOpdSettings()
    const withBg = opdSettings.print_with_background === true
    const cfg = normalizeOpdFieldConfig(
      opdSettings.opd_field_config,
      opdSettings.opd_visible_fields,
    )
    // On mobile: open the tab synchronously here (before any await) so the browser
    // treats it as a user-gesture popup. On desktop targetWindow stays null and the
    // existing hidden-iframe path is used unchanged.
    const targetWindow = isMobileDevice() ? window.open('', '_blank') : null
    try {
      await printOpdSheet({
        values: fieldValues,
        withBackground: withBg,
        layout: slipLayout,
        opdFieldConfig: cfg,
        targetWindow,
      })
    } catch (err) {
      if (targetWindow && !targetWindow.closed) targetWindow.close()
      toast.error(err?.message || 'Could not print OPD sheet')
      // Unattended (TPA pack) printing must not leave the slip mounted on failure,
      // otherwise the pack queue waits forever on this document.
      if (autoPrint) onClose()
      return
    }
    onClose()
  }

  // TPA pack printing mounts this slip only to print the A4 sheet — no operator input.
  const autoPrintStartedRef = useRef(false)
  useEffect(() => {
    if (!autoPrint || embedded || loadingTemplate) return undefined
    if (autoPrintStartedRef.current) return undefined
    autoPrintStartedRef.current = true
    const timer = setTimeout(() => { printFullOpdSheet() }, 250)
    return () => clearTimeout(timer)
  }, [autoPrint, embedded, loadingTemplate])

  return (
    <div
      className={embedded
        ? 'flex flex-col items-center p-2'
        : 'fixed inset-0 bg-black/50 flex flex-col items-center justify-center z-[500] p-4 overflow-y-auto'}
      style={autoPrint && !embedded ? { display: 'none' } : undefined}
    >
      <div className={`bg-white rounded-2xl shadow-xl w-full max-w-md my-auto flex flex-col ${embedded ? '' : 'max-h-[90vh]'}`}>
        <div className="p-5 border-b border-gray-100 flex items-center justify-between shrink-0">
          <h2 className="text-lg font-bold text-gray-800 flex items-center gap-2">
            <Printer size={18} className="text-emerald-600"/> Print Options
          </h2>
          {!embedded && (
            <button onClick={onClose} className="p-1.5 rounded-full hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors">
              <XCircle size={22} strokeWidth={1.8} />
            </button>
          )}
        </div>

        <div className="p-5 flex-1 overflow-y-auto">
          <div className="text-center mb-5 bg-blue-50/50 rounded-xl py-4 border border-blue-100/50">
            <div className="text-5xl font-black text-blue-600 mb-1">
              {displayToken}
            </div>
            <p className="font-bold text-gray-900 text-lg">{patientLine}</p>
            <p className="text-sm font-medium text-gray-500">{visit.room?.label || visit.doc_name || 'OPD'}</p>
          </div>

          {loadingTemplate ? (
            <div className="flex justify-center py-4">
              <span className="w-5 h-5 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : layoutFields.length > 0 ? (
            <div className="mt-2">
              <h3 className="text-sm font-bold text-gray-700 mb-3 flex items-center gap-2">
                A4 OPD Print Fields <span className="px-1.5 py-0.5 rounded-sm bg-emerald-100 text-emerald-700 text-[10px] font-bold">LIVE</span>
              </h3>
              <p className="text-xs text-gray-400 mb-4 leading-relaxed">
                These fields reflect your OPD template configuration. Fill in any missing details before printing the main OPD slip.
              </p>
              <div className="grid grid-cols-2 gap-3">
                {layoutFields.map(f => (
                  <div key={f} className="flex flex-col">
                    <label className="text-xs font-bold text-gray-600 mb-1 capitalize tracking-tight">{f}</label>
                    <input
                      type="text"
                      className="border border-gray-200 bg-gray-50/50 rounded-lg px-3 py-2 text-sm font-medium focus:bg-white focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none transition-all"
                      value={fieldValues[f] || ''}
                      onChange={e => setFieldValues({...fieldValues, [f]: e.target.value})}
                      placeholder={f}
                    />
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </div>

        <div className="p-4 border-t border-gray-100 shrink-0 flex gap-2">
          <button onClick={printOpdPaymentSlip} className="flex-1 bg-white border border-gray-200 text-gray-700 rounded-xl py-2.5 text-sm font-bold hover:bg-gray-50 hover:border-gray-300 transition-colors flex items-center justify-center gap-2">
            OPD Payment Slip
          </button>
          <button onClick={printFullOpdSheet} className="flex-[2] bg-emerald-600 text-white rounded-xl py-2.5 text-sm font-extrabold flex items-center justify-center gap-2 hover:bg-emerald-700 shadow-md transition-colors">
            <Printer size={16} strokeWidth={2.5} /> A4 Print Sheet
          </button>
        </div>
      </div>
    </div>
  )
}

/**
 * True when a template field is filled on the slip from the main Create OPD form only
 * (same rules as A4 print merge) — no extra input row needed on Create OPD.
 */
function templateFieldUsesMainFormOnly(f) {
  return Boolean(resolveOpdTemplateAutofill(f))
}

// ─── OPD Section ──────────────────────────────────────────────────────────────
function OPDSection({ rooms }) {
  const isMobile = useIsMobile()
  const [opdSettings, setOpdSettings] = useState(() => getReceptionOpdSettings())
  const receptionCollectionEnabled = opdSettings.reception_collection_enabled !== false
  const defaultCity = opdSettings.default_city || ''
  const defaultState = opdSettings.default_state || ''
  const defaultDoctorUser = opdSettings.default_doctor_user || ''
  const defaultDepartment = opdSettings.default_department || ''
  const opdFieldConfig = useMemo(
    () => normalizeOpdFieldConfig(opdSettings.opd_field_config, opdSettings.opd_visible_fields),
    [opdSettings.opd_field_config, opdSettings.opd_visible_fields],
  )
  const isOpdFieldVisible = (key) => opdFieldConfig[key]?.createForm !== false
  const fetchNextOpdNo = useCallback(async () => {
    if (!isOpdFieldVisible('opd_no')) {
      setNextOpdNoPreview('')
      return
    }
    try {
      const { data } = await api.get('/opd-visits/next-opd-no/')
      const payload = data?.data || data
      setNextOpdNoPreview(payload?.opd_no || '')
    } catch {
      setNextOpdNoPreview('')
    }
  }, [opdFieldConfig])
  useEffect(() => {
    fetchNextOpdNo()
  }, [fetchNextOpdNo])
  const phoneInputRef = useRef(null)
  const [visits, setVisits] = useState([])
  const [doctors, setDoctors] = useState([])
  const [departments, setDepartments] = useState([])
  const [queueSearch, setQueueSearch] = useState('')
  const [printVisit, setPrintVisit] = useState(null)
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [showQueue, setShowQueue] = useState(false)
  const [showCollectionModal, setShowCollectionModal] = useState(false)
  const [handoverSummary, setHandoverSummary] = useState({
    opening_cash_in_hand: '0.00',
    cash_total: '0.00',
    upi_total: '0.00',
    other_total: '0.00',
    grand_total: '0.00',
  })
  const [handoverRecipients, setHandoverRecipients] = useState([])
  const [pendingHandovers, setPendingHandovers] = useState([])
  const [collectionEntries, setCollectionEntries] = useState([])

  // Unified patient+OPD form
  const buildEmptyForm = () => ({
    phone: '',
    patient_name: '',
    salutation_choice: 'none',
    gender: 'male',
    age: '',
    ageUnit: 'years',
    guardian_name: '',
    guardian_relationship: '',
    address_line1: '',
    city: defaultCity,
    state: defaultState,
    doctor: defaultDoctorUser,
    department: defaultDepartment,
    amount: '',
    payment_mode: 'cash',
    chief_complaint: '',
    visit_datetime: toDateTimeInputValue(new Date()),
  })
  const [form, setForm] = useState(() => buildEmptyForm())
  const [nextOpdNoPreview, setNextOpdNoPreview] = useState('')

  useEffect(() => {
    // When entering Create OPD section, focus phone input.
    // The slight delay helps if layout/portal animations are still settling.
    const t = setTimeout(() => {
      phoneInputRef.current?.focus?.()
      phoneInputRef.current?.select?.()
    }, 0)
    return () => clearTimeout(t)
  }, [])

  // UI control: hide/disable the thermal option submit button from the OPD form.
  // Re-enable by changing this flag to `true`.
  const SHOW_THERMAL_ASSIGN_BUTTON = false
  const [matchedPatient, setMatchedPatient] = useState(null)  // existing patient found by phone
  const [lookupCandidates, setLookupCandidates] = useState([])
  const [opdNewPersonSamePhone, setOpdNewPersonSamePhone] = useState(false) // register different person; same mobile → family link
  const samePhoneModeDigitsRef = useRef(null)
  const [samePhoneFamilyModalOpen, setSamePhoneFamilyModalOpen] = useState(false)
  const samePhoneModalDismissedKeyRef = useRef('')
  const samePhoneFamilyUseConfirmedKeyRef = useRef('')
  /** All patients in this hospital sharing the entered mobile (from /patients/by-phone/). */
  const [samePhoneFamilyList, setSamePhoneFamilyList] = useState([])
  const [lookingUp, setLookingUp] = useState(false)
  const isExistingPatientSelected = Boolean(matchedPatient?.id)
  const today = format(new Date(), 'yyyy-MM-dd')
  const pollingRef = useRef(null)

  const submitActionRef = useRef('thermal')
  const slipLayoutRef = useRef(null)
  const [layoutFields, setLayoutFields] = useState([])
  const [templateValues, setTemplateValues] = useState({})
  const loadOpdLayout = useCallback(async () => {
    try {
      const res = await fetch('/api/templates')
      if (res.ok) {
        const data = await res.json()
        const single = (data.templates || []).find((t) => t.key === 'single')
        const cfg = normalizeOpdFieldConfig(
          getReceptionOpdSettings().opd_field_config,
          getReceptionOpdSettings().opd_visible_fields,
        )
        if (single?.layout) {
          const synced = syncCoreFieldsIntoLayout(single.layout, cfg)
          slipLayoutRef.current = synced
          const slipFields = filterLayoutFieldsForSlip(synced, cfg)
          setLayoutFields(Object.keys(slipFields))
        } else {
          setLayoutFields([])
        }
      }
    } catch {
      /* keep existing fields on failure */
    }
  }, [])
  const opdExtraTemplateFields = useMemo(
    () => layoutFields.filter((f) => !templateFieldUsesMainFormOnly(f)),
    [layoutFields],
  )
  const opdAmountManuallyEditedRef = useRef(false)
  const normalizeId = (value) => {
    if (value == null) return ''
    if (typeof value === 'object') {
      return String(value.id ?? value.pk ?? value.user_id ?? '')
    }
    return String(value)
  }
  const getDoctorUserId = (doctorRow) =>
    normalizeId(doctorRow?.user ?? doctorRow?.user_id ?? doctorRow?.userId ?? doctorRow?.doctor_user)
  const doctorMatchesSelectedId = (doctorRow, selectedId) => {
    const target = normalizeId(selectedId)
    if (!target) return false
    const ids = [
      doctorRow?.user,
      doctorRow?.user_id,
      doctorRow?.userId,
      doctorRow?.doctor_user,
      doctorRow?.id,
      doctorRow?.pk,
    ].map(normalizeId).filter(Boolean)
    return ids.includes(target)
  }
  const findDoctorBySelectedId = (doctorRows, selectedId) =>
    (doctorRows || []).find((doctorRow) => doctorMatchesSelectedId(doctorRow, selectedId))
  const getDoctorFee = (doctorRow) => {
    const rawFee = doctorRow?.consultation_fee ?? doctorRow?.consultationFee ?? doctorRow?.fee
    if (rawFee == null || rawFee === '') return null
    const numericFee = Number(String(rawFee).replace(/[^0-9.]/g, ''))
    return Number.isFinite(numericFee) && numericFee > 0 ? numericFee : null
  }
  const getDoctorFeeBySelectedId = (doctorRows, selectedId) => {
    const matched = findDoctorBySelectedId(doctorRows, selectedId)
    const matchedFee = getDoctorFee(matched)
    if (matchedFee != null) return matchedFee
    const target = normalizeId(selectedId)
    if (!target) return null
    const fallback = (doctorRows || []).find((doctorRow) =>
      normalizeId(getDoctorUserId(doctorRow)) === target
      || normalizeId(doctorRow?.id) === target
      || normalizeId(doctorRow?.pk) === target
    )
    return getDoctorFee(fallback)
  }
  const getDoctorDepartmentValue = (doctorRows, selectedId) => {
    const matched = findDoctorBySelectedId(doctorRows, selectedId)
    if (!matched) return ''
    const entities = Array.isArray(matched.departments_entities) ? matched.departments_entities : []
    if (entities.length > 0) {
      const first = entities[0]
      return String(first?.name || first?.code || '').trim()
    }
    const deptIds = Array.isArray(matched.departments) ? matched.departments : []
    if (deptIds.length > 0) {
      const id = normalizeId(deptIds[0])
      const dep = (departments || []).find((row) => normalizeId(row.id) === id)
      if (dep) return String(dep.name || dep.code || '').trim()
    }
    return ''
  }
  const parseSlotTimeMinutes = (hhmm) => {
    const m = String(hhmm || '').trim().match(/^(\d{1,2}):(\d{2})$/)
    if (!m) return null
    const h = Number(m[1])
    const mm = Number(m[2])
    if (h < 0 || h > 23 || mm < 0 || mm > 59) return null
    return h * 60 + mm
  }
  const getSlotFeeForNow = (slots, now = new Date()) => {
    const list = Array.isArray(slots) ? slots : []
    if (!list.length) return null
    const minsNow = now.getHours() * 60 + now.getMinutes()
    for (const row of list) {
      const start = parseSlotTimeMinutes(row?.start)
      const end = parseSlotTimeMinutes(row?.end)
      const amount = Number(row?.amount)
      if (start == null || end == null || !Number.isFinite(amount) || amount < 0) continue
      const inRange = start <= end
        ? minsNow >= start && minsNow < end
        : minsNow >= start || minsNow < end
      if (inRange) return amount
    }
    return null
  }
  const getRoomForDoctorUser = (doctorUser) => {
    const id = normalizeId(doctorUser)
    if (!id) return null
    return (rooms || []).find(r => normalizeId(r.doctor_user) === id) || null
  }
  const buildDisplayToken = (visitLike, roomOverride = null) => {
    const tokenRaw = visitLike?.token_number ?? visitLike?.queue_number ?? ''
    const tokenStr = String(tokenRaw || '')
    const roomRow = roomOverride || visitLike?.room || getRoomForDoctorUser(visitLike?.doctor_user)
    const prefix = roomRow?.prefix || ''
    return `${prefix}${tokenStr}`
  }
  const capitalizePersonName = (value) => String(value || '')
    .split(' ')
    .map((part) => (part ? `${part.charAt(0).toUpperCase()}${part.slice(1).toLowerCase()}` : ''))
    .join(' ')

  const hydratePatientIntoForm = useCallback(async (pt) => {
    if (!pt?.id) return
    try {
      const detail = await api.get(`/patients/${pt.id}/`)
      const p = detail.data?.data || detail.data
      if (p) {
        const ageFields = hydrateAgeFieldsFromPatient(p)
        setForm(f => ({
          ...f,
          patient_name: capitalizePersonName([p.first_name, p.last_name].filter(Boolean).join(' ') || ''),
          gender: p.gender || 'male',
          age: ageFields.age,
          ageUnit: ageFields.ageUnit,
          address_line1: p.address_line1 || '',
          city: p.city || '',
          state: p.state || '',
          guardian_name: capitalizePersonName(p.guardian_name || ''),
          guardian_relationship: p.guardian_relationship || '',
          salutation_choice: normalizeSalutationChoiceFromApi(p.preferred_salutation),
        }))
        setTemplateValues((prev) => ({
          ...prev,
          ...normalizeOpdCustomFields(p.opd_custom_fields),
        }))
      }
    } catch {
      setForm(f => ({
        ...f,
        patient_name: capitalizePersonName([pt.first_name, pt.last_name].filter(Boolean).join(' ') || ''),
        gender: pt.gender || 'male',
        guardian_name: capitalizePersonName(pt.guardian_name || ''),
        guardian_relationship: pt.guardian_relationship || '',
        salutation_choice: normalizeSalutationChoiceFromApi(pt.preferred_salutation),
      }))
    }
  }, [])

  async function selectLookupCandidate(pt) {
    if (!pt?.id) return
    setMatchedPatient(pt)
    setLookupCandidates([])
    await hydratePatientIntoForm(pt)
  }

  function startAddAnotherPersonSamePhone() {
    const ten = form.phone.replace(/\D/g, '').slice(-10)
    if (ten.length < 10) return
    samePhoneModeDigitsRef.current = ten
    setSamePhoneFamilyModalOpen(false)
    setOpdNewPersonSamePhone(true)
    setMatchedPatient(null)
    setSamePhoneFamilyList([])
    samePhoneModalDismissedKeyRef.current = ''
    samePhoneFamilyUseConfirmedKeyRef.current = ''
    setForm(f => ({
      ...f,
      patient_name: '',
      gender: 'male',
      age: '',
      ageUnit: 'years',
      guardian_name: '',
      guardian_relationship: '',
      salutation_choice: 'none',
      address_line1: '',
      city: defaultCity,
      state: defaultState,
    }))
  }

  useEffect(() => {
    fetchQueue()
    fetchDoctors()
    fetchDepartments()
    if (getReceptionOpdSettings().reception_collection_enabled !== false) {
      fetchHandoverSummary()
    }
    pollingRef.current = setInterval(fetchQueue, 15000)
    // Keep OPD settings in sync while staying on this page.
    const refreshSettings = async () => {
      await loadReceptionPortalSettings()
      setOpdSettings(getReceptionOpdSettings())
      void loadOpdLayout()
    }
    refreshSettings()
    // Fast polling so slot fee changes at boundaries; also refreshes OPD template field list.
    const settingsPoll = setInterval(refreshSettings, 15000)

    return () => {
      clearInterval(pollingRef.current)
      clearInterval(settingsPoll)
    }
  }, [loadOpdLayout])

  useEffect(() => {
    setTemplateValues((prev) => {
      const allowed = new Set(layoutFields)
      const next = {}
      for (const k of Object.keys(prev)) {
        if (allowed.has(k)) next[k] = prev[k]
      }
      const prevKeys = Object.keys(prev)
      const nextKeys = Object.keys(next)
      if (
        prevKeys.length === nextKeys.length
        && nextKeys.every((k) => next[k] === prev[k])
      ) {
        return prev
      }
      return next
    })
  }, [layoutFields])

  async function fetchDoctors() {
    try {
      const { data } = await api.get('/doctor-profiles/?limit=500')
      setDoctors(Array.isArray(data?.data) ? data.data : (data?.results || data || []))
    } catch {}
  }

  async function fetchDepartments() {
    try {
      const { data } = await api.get('/departments/?limit=500')
      setDepartments(Array.isArray(data?.data) ? data.data : (data?.results || data || []))
    } catch {}
  }

  useEffect(() => {
    // Auto-fill consultation amount based on OPD fee mode until user edits manually.
    // Slot mode: prefer doctor-specific slot, then default (no doctor) slot, then doctor fee.
    const mode = opdSettings.opd_fee_mode === 'slot' ? 'slot' : 'doctor'
    // If user has typed an amount, do not auto-overwrite it.
    // This makes amount truly editable in both doctor and slot fee modes.
    if (opdAmountManuallyEditedRef.current) return

    let fee = null
    if (mode === 'slot') {
      const allSlots = Array.isArray(opdSettings.opd_fee_slots) ? opdSettings.opd_fee_slots : []
      const selectedDocId = normalizeId(form.doctor)
      const doctorSlots = allSlots.filter(s => s.doctor_user_id && normalizeId(s.doctor_user_id) === selectedDocId)
      const defaultSlots = allSlots.filter(s => !s.doctor_user_id)
      fee = getSlotFeeForNow(doctorSlots) ?? getSlotFeeForNow(defaultSlots) ?? null
      // Last resort: if no slot matched at all, use doctor consultation fee
      if (fee == null) fee = getDoctorFeeBySelectedId(doctors, form.doctor)
    } else {
      fee = getDoctorFeeBySelectedId(doctors, form.doctor)
    }

    if (fee == null) return
    setForm(f => {
      if (mode === 'doctor' && normalizeId(f.doctor) !== normalizeId(form.doctor)) return f
      const nextAmount = String(fee)
      if (String(f.amount ?? '') === nextAmount) return f
      return { ...f, amount: nextAmount }
    })
  }, [doctors, form.doctor, form.amount, opdSettings.opd_fee_mode, opdSettings.opd_fee_slots, opdSettings.current_opd_slot_fee])

  useEffect(() => {
    // On hard refresh, settings load async. Backfill defaults into an untouched form.
    setForm((f) => {
      const next = { ...f }
      let changed = false

      if (!f.city && defaultCity) {
        next.city = defaultCity
        changed = true
      }
      if (!f.state && defaultState) {
        next.state = defaultState
        changed = true
      }
      if (!f.doctor && defaultDoctorUser) {
        next.doctor = defaultDoctorUser
        changed = true
      }

      const doctorId = normalizeId(next.doctor || f.doctor || defaultDoctorUser)
      if (doctorId) {
        const deptFromDoctor = getDoctorDepartmentValue(doctors, doctorId)
        if (deptFromDoctor && !next.department) {
          next.department = deptFromDoctor
          changed = true
        }
      } else if (!next.department && defaultDepartment) {
        next.department = defaultDepartment
        changed = true
      }

      return changed ? next : f
    })
  }, [defaultCity, defaultState, defaultDepartment, defaultDoctorUser, doctors, departments])

  async function fetchQueue() {
    setLoading(true)
    try {
      const [v, d] = await Promise.all([
        api.get(`/opd-visits/?visit_date=${today}&limit=500`),
        api.get('/doctor-profiles/?limit=500'),
      ])
      const rawVisits = Array.isArray(v.data?.data) ? v.data.data : (v.data?.results || v.data || [])
      const doctorRows = Array.isArray(d.data?.data) ? d.data.data : (d.data?.results || d.data || [])
      setDoctors(doctorRows)
      setVisits(rawVisits.map(vis => {
        const room = getRoomForDoctorUser(vis.doctor_user)
        return {
          ...vis,
          room,
          display_token: buildDisplayToken(vis, room),
          doc_name: findDoctorBySelectedId(doctorRows, vis.doctor_user)?.name || '—',
        }
      }))
      if (receptionCollectionEnabled) {
        await fetchHandoverSummary()
      }
    } catch {
      toast.error('Failed to load OPD queue')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (!receptionCollectionEnabled) {
      setShowCollectionModal(false)
    }
  }, [receptionCollectionEnabled])

  useEffect(() => {
    if (showCollectionModal && receptionCollectionEnabled) {
      fetchHandoverSummary()
    }
  }, [showCollectionModal, receptionCollectionEnabled])

  async function fetchHandoverSummary() {
    if (!receptionCollectionEnabled) return
    try {
      const { data } = await api.get('/handovers/balance/')
      const payload = data?.data || {}
      setHandoverSummary(payload.collection || {
        opening_cash_in_hand: '0.00',
        cash_total: '0.00',
        upi_total: '0.00',
        other_total: '0.00',
        grand_total: '0.00',
      })
      setHandoverRecipients(Array.isArray(payload.handover_recipients) ? payload.handover_recipients : [])
      setPendingHandovers(Array.isArray(payload.pending_received) ? payload.pending_received : [])
      setCollectionEntries(Array.isArray(payload.collection_entries) ? payload.collection_entries : [])
    } catch {}
  }

  // Collection is now shift-based (includes accepted handover opening cash)
  const collectionStats = {
    cash: parseFloat(handoverSummary.cash_total) || 0,
    upi: parseFloat(handoverSummary.upi_total) || 0,
    other: parseFloat(handoverSummary.other_total) || 0,
    total: parseFloat(handoverSummary.grand_total) || 0,
    openingCash: parseFloat(handoverSummary.opening_cash_in_hand) || 0,
  }

  // Patient lookup by phone or UHID; then load full record so receptionist can edit all fields
  useEffect(() => {
    const raw = form.phone.trim()
    if (raw.length < 3) {
      setMatchedPatient(null)
      setLookupCandidates([])
      setSamePhoneFamilyList([])
      setOpdNewPersonSamePhone(false)
      samePhoneModeDigitsRef.current = null
      samePhoneModalDismissedKeyRef.current = ''
      samePhoneFamilyUseConfirmedKeyRef.current = ''
      setSamePhoneFamilyModalOpen(false)
      setForm(f => ({
        ...f,
        first_name: '',
        last_name: '',
        gender: 'male',
        age: '',
        ageUnit: 'years',
        address_line1: '',
        city: defaultCity,
        state: defaultState,
      }))
      return
    }
    const digitsOnly = raw.replace(/\D/g, '')
    const looksLikePhone = /^[\d\s\-+()]+$/.test(raw) && digitsOnly.length > 0
    if (looksLikePhone && digitsOnly.length < 10) {
      setMatchedPatient(null)
      setLookupCandidates([])
      setSamePhoneFamilyList([])
      setOpdNewPersonSamePhone(false)
      samePhoneModeDigitsRef.current = null
      samePhoneModalDismissedKeyRef.current = ''
      samePhoneFamilyUseConfirmedKeyRef.current = ''
      setSamePhoneFamilyModalOpen(false)
      return
    }

    if (opdNewPersonSamePhone && samePhoneModeDigitsRef.current) {
      const ten = digitsOnly.slice(-10)
      if (ten.length === 10 && ten !== samePhoneModeDigitsRef.current) {
        setOpdNewPersonSamePhone(false)
        samePhoneModeDigitsRef.current = null
        // fall through — phone changed; run normal search again
      } else if (ten.length === 10 && ten === samePhoneModeDigitsRef.current) {
        setLookingUp(false)
        return
      }
    }

    let cancelled = false
    const t = setTimeout(async () => {
      setLookingUp(true)
      try {
        const isTenDigitPhone =
          looksLikePhone && digitsOnly.length >= 10 && !/[a-zA-Z]/.test(raw)
        const ten = digitsOnly.slice(-10)

        let familyList = []

        if (isTenDigitPhone) {
          try {
            const bp = await api.get(`/patients/by-phone/?phone=${encodeURIComponent(ten)}`)
            familyList = Array.isArray(bp.data?.data)
              ? bp.data.data
              : Array.isArray(bp.data?.entity)
                ? bp.data.entity
                : []
          } catch { /* use fallback below */ }

          if (familyList.length === 0) {
            const { data } = await api.get(`/patients/?search=${encodeURIComponent(raw)}&limit=50`)
            const rows = Array.isArray(data?.data) ? data.data : (data?.results || data || [])
            familyList = rows.filter(row => {
              const d = String(row.phone || '').replace(/\D/g, '')
              return d.length >= 10 && d.slice(-10) === ten
            })
          }
        }

        if (cancelled) return

        if (familyList.length > 0) {
          setLookupCandidates([])
          setSamePhoneFamilyList(familyList)
          const pt = familyList[0]
          setMatchedPatient(pt)
          await hydratePatientIntoForm(pt)
        } else {
          setSamePhoneFamilyList([])
          const { data } = await api.get(`/patients/?search=${encodeURIComponent(raw)}&limit=5`)
          const rows = Array.isArray(data?.data) ? data.data : (data?.results || data || [])
          if (cancelled) return
          if (rows.length > 0) {
            setLookupCandidates(rows)
            const normalizedRaw = raw.replace(/\s+/g, '').toLowerCase()
            const exactUhidMatch = rows.find((row) => String(row.uhid || '').replace(/\s+/g, '').toLowerCase() === normalizedRaw)
            if (exactUhidMatch) {
              setMatchedPatient(exactUhidMatch)
              setLookupCandidates([])
              await hydratePatientIntoForm(exactUhidMatch)
            } else {
              setMatchedPatient(null)
            }
          } else {
            setLookupCandidates([])
            setMatchedPatient(null)
            setForm(f => ({
              ...f,
              patient_name: '',
              gender: 'male',
              age: '',
              ageUnit: 'years',
              guardian_name: '',
              guardian_relationship: '',
              salutation_choice: 'none',
              address_line1: '',
              // Keep OPD defaults for brand-new patient flow.
              city: defaultCity,
              state: defaultState,
            }))
          }
        }
      } catch {
        if (!cancelled) {
          setMatchedPatient(null)
          setLookupCandidates([])
          setSamePhoneFamilyList([])
        }
      } finally {
        if (!cancelled) setLookingUp(false)
      }
    }, 500)
    return () => {
      cancelled = true
      clearTimeout(t)
    }
  }, [form.phone, opdNewPersonSamePhone, hydratePatientIntoForm, defaultCity, defaultState])

  function openSelectOnEnter(selectEl) {
    if (!selectEl) return false
    if (typeof selectEl.showPicker === 'function') {
      selectEl.showPicker()
      return true
    }
    selectEl.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))
    return true
  }

  function handleOpdFormKeyDown(e) {
    if (e.key !== 'Enter') return
    const target = e.target
    if (target instanceof HTMLTextAreaElement) return
    if (target instanceof HTMLButtonElement) return
    if (target instanceof HTMLSelectElement) {
      e.preventDefault()
      openSelectOnEnter(target)
      return
    }
    e.preventDefault()
  }

  async function handleSubmit(e) {
    e.preventDefault()
    if (/\d/.test(form.patient_name || '')) {
      toast.error('Patient name cannot contain numbers')
      return
    }
    if (/\d/.test(form.guardian_name || '')) {
      toast.error('Guardian name cannot contain numbers')
      return
    }
    if (form.amount !== '' && Number(form.amount) < 0) {
      toast.error('Amount cannot be negative')
      return
    }
    setSubmitting(true)
    try {
      let patientId = matchedPatient?.id
      const rawLookup = form.phone.trim()
      const digitsOnly = rawLookup.replace(/\D/g, '')
      const looksLikeUhid = /[a-zA-Z]/.test(rawLookup) || /^[A-Z0-9]+-[A-Z0-9-]+$/i.test(rawLookup.replace(/\s/g, ''))

      // UHID typed but no match — do not create a fake patient with UHID as phone
      if (!patientId && looksLikeUhid) {
        toast.error('No patient found for this UHID. Check the number or use a mobile number to register a new patient.')
        setSubmitting(false)
        return
      }

      // Create patient if not found (phone path only)
      if (!patientId) {
        if (digitsOnly.length < 10) {
          toast.error('Enter at least 10 digits for a new patient mobile number, or a valid UHID to find an existing patient.')
          setSubmitting(false)
          return
        }
        const normalizedPatientName = capitalizePersonName(form.patient_name).trim()
        const normalizedGuardianName = capitalizePersonName(form.guardian_name).trim()
        const nameParts = normalizedPatientName.split(' ');
        const fName = nameParts[0] || '';
        const lName = nameParts.slice(1).join(' ') || '';
        const patRes = await api.post('/patients/', {
          first_name: fName,
          last_name: lName,
          phone: digitsOnly.slice(-10),
          gender: form.gender,
          patient_type: 'outpatient',
          ...(opdNewPersonSamePhone ? { link_with_existing_phone_patients: true } : {}),
          ...(form.age ? { age: parseInt(form.age, 10), age_unit: normalizeAgeUnit(form.ageUnit) } : {}),
          ...(form.address_line1 ? { address_line1: form.address_line1 } : {}),
          ...(form.city        ? { city: form.city }            : {}),
          ...(form.state       ? { state: form.state }          : {}),
          guardian_name: normalizedGuardianName,
          guardian_relationship: form.guardian_relationship || '',
          preferred_salutation: form.salutation_choice ?? '',
        })
        patientId = (patRes.data?.data || patRes.data)?.id
        if (patientId && opdExtraTemplateFields.length > 0) {
          await api.patch(`/patients/${patientId}/`, {
            opd_custom_fields: buildOpdCustomFieldPayload(opdExtraTemplateFields, templateValues),
          })
        }
      } else {
        // Existing patient — lock identity/profile edits in Create OPD.
        // Only allow age updates back to the patient master record.
        const patch = {}
        if (form.age !== '' && form.age != null) {
          const a = parseInt(form.age, 10)
          if (!Number.isNaN(a)) {
            patch.age = a
            patch.age_unit = normalizeAgeUnit(form.ageUnit)
          }
        }
        if (Object.keys(patch).length > 0) {
          await api.patch(`/patients/${patientId}/`, patch)
        }
      }

      // Create OPD visit
      const visitDate = form.visit_datetime?.slice(0, 10) || format(new Date(), 'yyyy-MM-dd')
      const visitDatetimeIso = dateTimeInputToIso(form.visit_datetime)
      const { data } = await api.post('/opd-visits/', {
        patient: patientId,
        visit_date: visitDate,
        ...(visitDatetimeIso ? { visit_datetime: visitDatetimeIso } : {}),
        chief_complaint: form.chief_complaint,
        doctor_user: form.doctor || null,
        department: form.department || '',
        amount: form.amount || null,
        payment_mode: form.payment_mode || 'cash',
        status: 'waiting',
      })
      const payload = data?.data || data
      const selectedDoc = findDoctorBySelectedId(doctors, form.doctor)
      const selectedRoom = getRoomForDoctorUser(form.doctor)
      // Use form.patient_name if filled; otherwise fall back to the matched patient's name
      const ptName = capitalizePersonName((form.patient_name || '').trim()) ||
        capitalizePersonName([matchedPatient?.first_name, matchedPatient?.last_name].filter(Boolean).join(' ')) ||
        'Patient'
      const tokenNum = payload?.token_number || payload?.queue_number || ''
      const displayToken = buildDisplayToken({ ...payload, doctor_user: form.doctor, token_number: tokenNum }, selectedRoom)
      toast.success(`Token #${tokenNum} assigned!`)

      if (submitActionRef.current === 'a4') {
        let printUhid = payload?.patient_uhid || matchedPatient?.uhid || '';
        let printPhone = payload?.patient_phone || matchedPatient?.phone || '';
        let printCity = toCityCode(payload?.patient_city || form.city || '');
        let printState = toStateCode(payload?.patient_state || form.state || '');
        const slipSalutation = resolveSalutationForSlip(form.salutation_choice, form.gender, form.age, form.ageUnit)
        const printPatientLine = formatPatientLineForSlip(ptName, form.gender, form.age, slipSalutation, form.ageUnit)
        const printGuardianLine = formatGuardianLineForSlip(
          capitalizePersonName(payload?.patient_guardian_name || form.guardian_name || ''),
          payload?.patient_guardian_relationship ?? form.guardian_relationship ?? '',
        )

        const ageSex = formatAgeSexForSlip(form.age, form.gender, form.ageUnit)
        let ptAddress = [form.address_line1, printCity, printState].filter(Boolean).join(', ')
        if (ptAddress.length > 35) ptAddress = ptAddress.substring(0, 32) + '...'

        const finalValues = { ...templateValues }
        const chosenVisitDt = form.visit_datetime ? new Date(form.visit_datetime) : new Date()
        const visitDateTimeStr = visitDate && !Number.isNaN(chosenVisitDt.getTime())
          ? formatDateTime(chosenVisitDt, { paren: true })
          : ''
        for (const f of layoutFields) {
          const tokenDateTime = visitDateTimeStr
            ? `${displayToken} · ${visitDateTimeStr}`
            : displayToken
          const patientRegisteredAtRaw = payload?.patient_registered_at || matchedPatient?.created_at || ''
          const patientRegisteredAt = patientRegisteredAtRaw ? formatDateTime(patientRegisteredAtRaw, { paren: true }) : ''
          // NOTE: guardian must be checked BEFORE generic 'name' check
          const auto = getOpdAutofillValue(f, {
            displayToken,
            patientLine: printPatientLine,
            guardianLine: printGuardianLine,
            tokenDateTime,
            registeredAt: patientRegisteredAt,
            visitDateTime: visitDateTimeStr,
            uhid: printUhid || '',
            phone: (printPhone || form.phone.replace(/\D/g, '') || '').trim(),
            doctorName: selectedDoc?.name || '',
            department: form.department || '',
            ageSex,
            gender: form.gender || '',
            address: ptAddress,
            city: printCity,
            state: printState,
            chiefComplaint: form.chief_complaint || '',
            amountMode: form.amount ? `${form.amount} (${form.payment_mode})` : '',
          })
          if (auto && !finalValues[f]) finalValues[f] = auto
        }
        const withBg = getReceptionOpdSettings().print_with_background === true
        const cfg = normalizeOpdFieldConfig(
          getReceptionOpdSettings().opd_field_config,
          getReceptionOpdSettings().opd_visible_fields,
        )
        // Open the print tab synchronously before any await on mobile.
        const targetWindow = isMobileDevice() ? window.open('', '_blank') : null
        try {
          await printOpdSheet({
            values: finalValues,
            withBackground: withBg,
            layout: slipLayoutRef.current,
            opdFieldConfig: cfg,
            targetWindow,
          })
        } catch (err) {
          if (targetWindow && !targetWindow.closed) targetWindow.close()
          toast.error(err?.message || 'Could not print OPD sheet')
        }
      } else {
        setPrintVisit({
          ...payload,
          patient_name: ptName,
          patient_gender: payload?.patient_gender ?? form.gender,
          patient_age: payload?.patient_age ?? form.age,
          patient_age_unit: payload?.patient_age_unit ?? normalizeAgeUnit(form.ageUnit),
          patient_salutation: resolveSalutationForSlip(form.salutation_choice, form.gender, form.age, form.ageUnit),
          patient_guardian_relationship: payload?.patient_guardian_relationship ?? form.guardian_relationship ?? '',
          doc_name: selectedDoc?.name || '',
          patient_uhid: payload?.patient_uhid || matchedPatient?.uhid || '',
          patient_city: printCity,
          patient_state: printState,
          patient_guardian_name: capitalizePersonName(payload?.patient_guardian_name || form.guardian_name || ''),
          room: selectedRoom || undefined,
          display_token: displayToken,
          token_number: tokenNum,
          amount: form.amount || '',
        })
      }

      setForm(buildEmptyForm())
      fetchNextOpdNo()
      opdAmountManuallyEditedRef.current = false
      setTemplateValues({})
      setMatchedPatient(null)
      setOpdNewPersonSamePhone(false)
      samePhoneModeDigitsRef.current = null
      samePhoneModalDismissedKeyRef.current = ''
      samePhoneFamilyUseConfirmedKeyRef.current = ''
      setSamePhoneFamilyModalOpen(false)
      setSamePhoneFamilyList([])
      await fetchQueue()
    } catch (err) {
      const detail = err.response?.data?.detail || JSON.stringify(err.response?.data) || 'Failed'
      toast.error(detail)
    } finally { setSubmitting(false) }
  }

  const filteredVisits = visits.filter(v =>
    !queueSearch || (v.patient_name || '').toLowerCase().includes(queueSearch.toLowerCase()) ||
    String(v.token_number || v.queue_number || '').includes(queueSearch)
  )

  const statusBadge = {
    waiting: 'bg-amber-100 text-amber-700',
    in_progress: 'bg-blue-100 text-blue-700',
    in_consultation: 'bg-blue-100 text-blue-700',
    completed: 'bg-green-100 text-green-600',
  }

  const lookupRaw = form.phone.trim()
  const lookupDigits = lookupRaw.replace(/\D/g, '')
  const looksLikeUhidInput = /[a-zA-Z]/.test(lookupRaw)
  const showNewPatientHint = !matchedPatient && !opdNewPersonSamePhone && !lookingUp && lookupDigits.length >= 10 && !looksLikeUhidInput
  const showUhidNoMatchHint = !matchedPatient && !lookingUp && looksLikeUhidInput && lookupRaw.length >= 4
  const showSamePhoneNewHint = opdNewPersonSamePhone && !matchedPatient && lookupDigits.length >= 10 && !looksLikeUhidInput
  const phoneFamilySessionKey =
    !looksLikeUhidInput && lookupDigits.length >= 10
      ? `phone-${lookupDigits.slice(-10)}`
      : ''

  const canOfferSamePhoneNew = Boolean(
    (samePhoneFamilyList.length > 0 || matchedPatient) &&
      lookupDigits.length >= 10 &&
      !looksLikeUhidInput,
  )

  const showReopenSamePhoneFamilyModal = Boolean(
    phoneFamilySessionKey &&
      samePhoneFamilyList.length > 0 &&
      !samePhoneFamilyModalOpen &&
      !opdNewPersonSamePhone,
  )

  function closeSamePhoneFamilyModalBackdrop() {
    if (phoneFamilySessionKey && samePhoneFamilyList.length > 0) {
      samePhoneModalDismissedKeyRef.current = phoneFamilySessionKey
    }
    setSamePhoneFamilyModalOpen(false)
  }

  function confirmSamePhoneUseExistingPatient() {
    if (phoneFamilySessionKey) {
      samePhoneModalDismissedKeyRef.current = phoneFamilySessionKey
      samePhoneFamilyUseConfirmedKeyRef.current = phoneFamilySessionKey
    }
    setSamePhoneFamilyModalOpen(false)
  }

  function reopenSamePhoneFamilyModal() {
    samePhoneModalDismissedKeyRef.current = ''
    setSamePhoneFamilyModalOpen(true)
  }

  async function selectPatientFromFamilyModal(pt) {
    if (!pt?.id) return
    setMatchedPatient(pt)
    try {
      const detail = await api.get(`/patients/${pt.id}/`)
      const p = detail.data?.data || detail.data
      if (p) {
        const fullName = [p.first_name, p.last_name].filter(Boolean).join(' ')
        setForm(f => ({
          ...f,
          patient_name: capitalizePersonName(fullName || f.patient_name),
          gender: p.gender || 'male',
          age: p.age != null && p.age !== '' ? String(p.age) : '',
          address_line1: p.address_line1 || '',
          city: p.city || '',
          state: p.state || '',
          guardian_name: capitalizePersonName(p.guardian_name || ''),
        }))
      }
    } catch {
      const fullName = [pt.first_name, pt.last_name].filter(Boolean).join(' ')
      setForm(f => ({
        ...f,
        patient_name: capitalizePersonName(fullName || f.patient_name),
        gender: pt.gender || 'male',
        guardian_name: capitalizePersonName(pt.guardian_name || ''),
      }))
    }
  }

  useEffect(() => {
    if (lookingUp || opdNewPersonSamePhone || looksLikeUhidInput) return
    const ten = lookupDigits.slice(-10)
    if (ten.length < 10) return
    if (!samePhoneFamilyList.length) return
    const key = `phone-${ten}`
    if (samePhoneModalDismissedKeyRef.current === key) return
    setSamePhoneFamilyModalOpen(true)
  }, [lookingUp, opdNewPersonSamePhone, lookupDigits, looksLikeUhidInput, samePhoneFamilyList.length])

  const inp = 'w-full border border-gray-200 rounded-xl px-3.5 py-2.5 text-[15px] font-semibold text-gray-900 placeholder:text-gray-400 placeholder:font-normal focus:ring-2 focus:ring-emerald-500 focus:outline-none'
  const inpCompact = 'w-full min-w-0 border border-gray-200 rounded-xl px-3 py-2 text-[14px] font-semibold text-gray-900 placeholder:text-gray-400 placeholder:font-normal focus:ring-2 focus:ring-emerald-500 focus:outline-none'
  const lbl = 'text-[13px] font-bold text-gray-600 mb-1.5 block tracking-tight uppercase'
  const lblCompact = 'text-[13px] font-bold text-gray-600 mb-1 block tracking-tight'
  // Light fill when record was loaded from lookup (receptionist sees “prefilled” fields)
  const filledBg = matchedPatient
    ? 'bg-emerald-50/90 border-emerald-200/90 ring-1 ring-inset ring-emerald-100/60 focus:bg-white focus:ring-2 focus:ring-emerald-500 focus:border-emerald-400'
    : opdNewPersonSamePhone
      ? 'bg-amber-50/90 border-amber-200/90 ring-1 ring-inset ring-amber-100/60 focus:bg-white focus:ring-2 focus:ring-amber-500 focus:border-amber-400'
      : ''
  const inpFilled = `${inp} ${filledBg}`
  const lblFilled = matchedPatient ? `${lbl} text-emerald-900` : opdNewPersonSamePhone ? `${lbl} text-amber-900` : lbl

  return (
    <>
      <div className="flex flex-col flex-1 min-h-0">

      {/* ── Body ── */}
      <div className="flex gap-0 flex-1 min-h-0 overflow-hidden">

      {/* ── LEFT: Quick OPD Form ── */}
      <form onSubmit={handleSubmit} onKeyDown={handleOpdFormKeyDown}
        className="flex-1 w-full min-w-0 bg-white flex flex-col min-h-0 overflow-hidden">

        {/* Form header — flush under top bar; queue toggle inline */}
        <div className="bg-gradient-to-r from-emerald-500 to-teal-600 px-3 sm:px-4 py-2.5 text-white shrink-0 flex flex-wrap items-center justify-between gap-2">
          <div className="min-w-0">
            <h3 className="font-extrabold text-base sm:text-lg flex items-center gap-2"><Plus size={18} strokeWidth={2.5} /> New OPD Visit</h3>
            <p className="text-xs sm:text-sm font-semibold text-emerald-100/95 leading-snug mt-0.5 hidden sm:block">Search by mobile or UHID, or register a new patient</p>
          </div>
          
          <div className="flex items-center gap-2">
            {receptionCollectionEnabled ? (
              <button
                type="button"
                onClick={() => setShowCollectionModal(true)}
                className="flex items-center gap-1.5 sm:gap-2 px-2 sm:px-3 py-1.5 bg-white/10 hover:bg-white/20 border border-white/20 rounded-full transition-all group shrink-0"
              >
                <div className="w-5 h-5 rounded-full bg-white text-emerald-600 flex items-center justify-center">
                  <IndianRupee size={10} strokeWidth={3} />
                </div>
                <div className="flex flex-col items-start leading-none pr-0.5 sm:pr-1">
                  <span className="text-[9px] font-black text-emerald-50/70 uppercase tracking-tighter hidden sm:block">Collection Summary</span>
                  <span className="text-xs font-black text-white leading-tight">
                    ₹{collectionStats.total.toLocaleString('en-IN')}
                  </span>
                </div>
              </button>
            ) : null}

            <button
              type="button"
              onClick={() => setShowQueue(q => !q)}
              className={`shrink-0 flex items-center gap-1.5 sm:gap-2 px-2.5 sm:px-3 py-1.5 sm:py-2 rounded-lg text-xs sm:text-sm font-extrabold border-2 transition-all ${
                showQueue
                  ? 'bg-white text-emerald-700 border-white'
                  : 'bg-white/15 text-white border-white/50 hover:bg-white/25'
              }`}
            >
              <Activity size={14} strokeWidth={2.5} />
              Queue
            </button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-4 grid grid-cols-12 gap-x-3 gap-y-4 content-start auto-rows-min">

          {/* Row 1: Phone + Patient + Guardian. Row 2: Age + Gender. */}
          {/* Phone / UHID — compact input; hints on the right in wide layout */}
          {(isOpdFieldVisible('phone') || isOpdFieldVisible('uhid')) && (
          <div className="col-span-12 lg:col-span-3 min-w-0">
            <label className={`${lblFilled} flex items-center gap-1.5`}>
              {isOpdFieldVisible('phone') && isOpdFieldVisible('uhid')
                ? 'Phone or UHID *'
                : isOpdFieldVisible('uhid')
                  ? 'UHID *'
                  : 'Phone *'}
              {showSamePhoneNewHint && (
                <span title="Registering new family member on this number" className="inline-flex items-center gap-1 text-[10px] font-medium text-amber-700 bg-amber-100 border border-amber-200 rounded-full px-1.5 py-0.5 leading-none">
                  <span className="w-1 h-1 rounded-full bg-amber-500 shrink-0" />
                  New · Family link
                </span>
              )}
              {showNewPatientHint && (
                <span title="No existing record — will register as new patient" className="inline-flex items-center gap-1 text-[10px] font-medium text-blue-700 bg-blue-50 border border-blue-200 rounded-full px-1.5 py-0.5 leading-none">
                  <span className="w-1 h-1 rounded-full bg-blue-400 shrink-0" />
                  New patient
                </span>
              )}
              {showUhidNoMatchHint && (
                <span title="No patient found for this UHID" className="inline-flex items-center gap-1 text-[10px] font-medium text-red-700 bg-red-50 border border-red-200 rounded-full px-1.5 py-0.5 leading-none">
                  <span className="w-1 h-1 rounded-full bg-red-400 shrink-0" />
                  No match
                </span>
              )}
            </label>
            <div className="relative w-full">
              <input
                ref={phoneInputRef}
                autoFocus
                value={form.phone}
                onChange={e => {
                  let v = e.target.value;
                  // If it's purely digits, cap at 10. If it has letters (UHID), allow up to 40.
                  if (/^\d+$/.test(v) && v.length > 10) v = v.slice(0, 10);
                  const prevPhone = form.phone
                  const phoneChanged = v !== prevPhone
                  if (isExistingPatientSelected && phoneChanged) {
                    setMatchedPatient(null)
                    setLookupCandidates([])
                    setSamePhoneFamilyList([])
                    setOpdNewPersonSamePhone(false)
                    samePhoneModeDigitsRef.current = null
                    samePhoneModalDismissedKeyRef.current = ''
                    samePhoneFamilyUseConfirmedKeyRef.current = ''
                    setSamePhoneFamilyModalOpen(false)
                    setTemplateValues({})
                    setForm(f => ({
                      ...f,
                      phone: v,
                      patient_name: '',
                      gender: 'male',
                      age: '',
                      ageUnit: 'years',
                      guardian_name: '',
                      guardian_relationship: '',
                      salutation_choice: 'none',
                      address_line1: '',
                      city: defaultCity,
                      state: defaultState,
                    }))
                    return
                  }
                  setForm(f => ({ ...f, phone: v }))
                }}
                placeholder="Mobile or UHID"
                maxLength={40}
                className={`${inpFilled} pr-8 w-full`}
                required
              />
              {lookingUp && (
                <span className="absolute right-2 top-2 w-3.5 h-3.5 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
              )}
              {lookupCandidates.length > 0 && !matchedPatient && (
                <ul className="absolute left-0 top-full z-50 mt-1 w-full bg-white rounded-xl shadow-xl border border-gray-100 divide-y divide-gray-50 max-h-48 overflow-y-auto">
                  {lookupCandidates.map((p) => (
                    <li key={p.id}>
                      <button
                        type="button"
                        onClick={() => { void selectLookupCandidate(p) }}
                        className="w-full text-left px-3 py-2 hover:bg-emerald-50/60"
                      >
                        <p className="text-xs font-semibold text-gray-900 truncate">
                          {[p.first_name, p.last_name].filter(Boolean).join(' ') || 'Patient'}
                        </p>
                        <p className="text-[11px] text-gray-500 truncate">
                          {p.uhid || 'No UHID'} · {p.phone || 'No phone'}
                        </p>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            {matchedPatient && looksLikeUhidInput && (
              <div className="mt-1 flex items-center gap-1.5 bg-emerald-50 border border-emerald-200 rounded-md px-2 py-1 text-xs">
                <CheckCircle size={12} className="text-emerald-600 shrink-0" strokeWidth={2.5} />
                <span className="font-medium text-emerald-800 truncate">
                  {[matchedPatient.first_name, matchedPatient.last_name].filter(Boolean).join(' ')} · {matchedPatient.uhid}
                </span>
              </div>
            )}
            {showReopenSamePhoneFamilyModal && (
              <button
                type="button"
                onClick={reopenSamePhoneFamilyModal}
                className="mt-1 inline-flex items-center gap-1 text-[11px] text-emerald-700 hover:text-emerald-900 hover:underline"
              >
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0" />
                Family members on this number
              </button>
            )}
          </div>
          )}

          {isOpdFieldVisible('uhid') && (
          <div className="col-span-12 lg:col-span-2 min-w-0">
            <label className={lblFilled}>UHID</label>
            <input
              value={matchedPatient?.uhid || ''}
              readOnly
              placeholder="Assigned after match"
              className={`${inpFilled} bg-gray-50/80`}
            />
          </div>
          )}

          {isOpdFieldVisible('opd_no') && (
          <div className="col-span-12 sm:col-span-6 lg:col-span-3 min-w-0">
            <label className={lblFilled}>{opdFieldConfig.opd_no?.label || 'OPD No'}</label>
            <input
              value={nextOpdNoPreview}
              readOnly
              placeholder="Loading…"
              className={`${inpFilled} bg-gray-50/80 font-mono`}
            />
            <p className="text-[10px] text-gray-400 mt-0.5">Auto-assigned on save</p>
          </div>
          )}

          {isOpdFieldVisible('visit_date') && (
          <div className="col-span-12 sm:col-span-6 lg:col-span-3 min-w-0">
            <label className={lblFilled}>{opdFieldConfig.visit_date?.label ? `${opdFieldConfig.visit_date.label} & time` : 'Visit date & time'}</label>
            <input
              type="datetime-local"
              value={form.visit_datetime || ''}
              onChange={e => setForm(f => ({ ...f, visit_datetime: e.target.value }))}
              className={inpFilled}
            />
          </div>
          )}

          {isOpdFieldVisible('patient_name') && (
          <div className="col-span-12 lg:col-span-4 min-w-0">
              <label className={lblFilled}>Patient Name</label>
              <div
                className={`flex w-full min-w-0 rounded-lg border overflow-hidden items-stretch focus-within:ring-2 focus-within:ring-emerald-500 focus-within:border-emerald-400 ${filledBg || 'border-gray-200 bg-white'}`}
              >
                <select
                  value={form.salutation_choice}
                  disabled={isExistingPatientSelected}
                  onChange={e => setForm(f => ({ ...f, salutation_choice: e.target.value }))}
                  className="shrink-0 w-[5.25rem] sm:w-28 border-0 border-r border-gray-200/90 bg-gray-50/95 py-2 pl-2 pr-1 text-xs sm:text-sm font-bold text-gray-800 focus:outline-none focus:bg-gray-50 cursor-pointer"
                  aria-label="Patient title (Mr, Mrs, …)"
                >
                  {SALUTATION_CHOICE_OPTIONS.map((o) => (
                    <option key={o.value || '_none'} value={o.value}>{o.label}</option>
                  ))}
                </select>
                <input
                  value={form.patient_name}
                  readOnly={isExistingPatientSelected}
                  onChange={e => setForm(f => ({ ...f, patient_name: capitalizePersonName(sanitizePersonName(e.target.value)) }))}
                  placeholder="Full name"
                  className="flex-1 min-w-0 border-0 rounded-none bg-transparent py-2 px-3 text-base font-semibold text-gray-900 placeholder:text-gray-400 placeholder:font-medium focus:outline-none focus:ring-0"
                />
              </div>
          </div>
          )}
          {isOpdFieldVisible('guardian') && (
          <div className="col-span-12 lg:col-span-5 min-w-0">
              <label className={lblFilled}>Guardian</label>
              <div
                className={`flex w-full min-w-0 rounded-lg border overflow-hidden items-stretch focus-within:ring-2 focus-within:ring-emerald-500 focus-within:border-emerald-400 ${filledBg || 'border-gray-200 bg-white'}`}
              >
                <select
                  value={form.guardian_relationship}
                  disabled={isExistingPatientSelected}
                  onChange={e => setForm(f => ({ ...f, guardian_relationship: e.target.value }))}
                  className="shrink-0 w-[6.5rem] sm:min-w-[7.5rem] sm:max-w-[9.5rem] sm:w-36 border-0 border-r border-gray-200/90 bg-gray-50/95 py-2 pl-1.5 pr-0.5 text-[11px] sm:text-xs font-bold text-gray-800 focus:outline-none focus:bg-gray-50 cursor-pointer"
                  aria-label="Relation to guardian (S/o, W/o, …)"
                >
                  {GUARDIAN_RELATIONSHIP_OPTIONS.map((o) => (
                    <option key={o.value || '_'} value={o.value}>{o.label}</option>
                  ))}
                </select>
                <input
                  value={form.guardian_name}
                  readOnly={isExistingPatientSelected}
                  onChange={e => setForm(f => ({ ...f, guardian_name: capitalizePersonName(sanitizePersonName(e.target.value)) }))}
                  placeholder="Guardian name"
                  className="flex-1 min-w-0 border-0 rounded-none bg-transparent py-2 px-3 text-base font-semibold text-gray-900 placeholder:text-gray-400 placeholder:font-medium focus:outline-none focus:ring-0"
                />
              </div>
          </div>
          )}
          {isOpdFieldVisible('age_sex') && (
          <div className="col-span-6 sm:col-span-3 lg:col-span-3 min-w-0">
            <label className={lblFilled}>Age and Sex</label>
            <AgeWithUnitInput
              value={form.age}
              unit={form.ageUnit}
              onValueChange={(next) => setForm((f) => ({ ...f, age: next }))}
              onUnitChange={(next) => setForm((f) => ({ ...f, ageUnit: next }))}
              inputClassName={inpFilled}
            />
          </div>
          )}
          {isOpdFieldVisible('age_sex') && (
          <div className="col-span-6 sm:col-span-9 lg:col-span-9 min-w-0">
            <label className={lblFilled}>Sex</label>
            <div className={`flex gap-2 w-full max-w-none rounded-lg p-1 ${
              matchedPatient ? 'bg-emerald-50/80 ring-1 ring-inset ring-emerald-100/70'
                : opdNewPersonSamePhone ? 'bg-amber-50/80 ring-1 ring-inset ring-amber-100/70'
                : ''
            }`}>
              {[['male','Male'],['female','Female'],['other','Other']].map(([val, lblShort]) => (
                <button type="button" key={val}
                  disabled={isExistingPatientSelected}
                  onClick={() => {
                    if (isExistingPatientSelected) return
                    setForm(f => ({ ...f, gender: val }))
                  }}
                  className={`flex-1 py-2 rounded-lg text-sm font-semibold border-2 transition-colors ${
                    form.gender === val
                      ? opdNewPersonSamePhone
                        ? 'bg-amber-600 text-white border-amber-600'
                        : 'bg-emerald-600 text-white border-emerald-600'
                      : matchedPatient
                        ? 'bg-emerald-50/90 text-emerald-900 border-emerald-200/90'
                        : opdNewPersonSamePhone
                          ? 'bg-amber-50/90 text-amber-900 border-amber-200/90'
                          : 'bg-white text-gray-600 border-gray-200'
                  }`}>
                  {lblShort}
                </button>
              ))}
            </div>
          </div>
          )}

          {isOpdFieldVisible('address') && (
          <div className="col-span-12">
            <label className={lblFilled}>Address</label>
            <input
              value={form.address_line1}
              readOnly={isExistingPatientSelected}
              onChange={e => setForm(f => ({ ...f, address_line1: e.target.value }))}
              placeholder="House / street / locality"
              className={`${inpFilled} mb-1`}
            />
            <div className={showQueue ? 'space-y-2' : 'grid grid-cols-2 gap-2'}>
              <input
                value={form.city}
                readOnly={isExistingPatientSelected}
                onChange={e => setForm(f => ({ ...f, city: e.target.value }))}
                placeholder="City / town"
                className={inpFilled}
              />
              <select
                value={form.state}
                disabled={isExistingPatientSelected}
                onChange={e => setForm(f => ({ ...f, state: e.target.value }))}
                className={inpFilled}
              >
                {INDIAN_STATE_OPTIONS.map(st => (
                  <option key={st} value={st}>{st}</option>
                ))}
              </select>
            </div>
          </div>
          )}

          {isOpdFieldVisible('doctor') && (
          <div className="col-span-6 sm:col-span-4 lg:col-span-2 min-w-0">
            <label className={lblCompact}>Doctor</label>
            <select value={form.doctor} onChange={e => {
              opdAmountManuallyEditedRef.current = false
              const selectedDocId = e.target.value
              const feeAttr = e.target.selectedOptions?.[0]?.getAttribute('data-fee')
              const feeFromOption = feeAttr != null && String(feeAttr).trim() !== '' ? Number(feeAttr) : Number.NaN
              let fee = null
              if (opdSettings.opd_fee_mode === 'slot') {
                const allSlots = Array.isArray(opdSettings.opd_fee_slots) ? opdSettings.opd_fee_slots : []
                const docSlots = allSlots.filter(s => s.doctor_user_id && normalizeId(s.doctor_user_id) === normalizeId(selectedDocId))
                const defSlots = allSlots.filter(s => !s.doctor_user_id)
                fee = getSlotFeeForNow(docSlots) ?? getSlotFeeForNow(defSlots) ?? null
                if (fee == null) fee = Number.isFinite(feeFromOption) ? feeFromOption : getDoctorFeeBySelectedId(doctors, selectedDocId)
              } else {
                fee = Number.isFinite(feeFromOption) ? feeFromOption : getDoctorFeeBySelectedId(doctors, selectedDocId)
              }
              const departmentValue = selectedDocId
                ? getDoctorDepartmentValue(doctors, selectedDocId)
                : defaultDepartment
              setForm(f => ({
                ...f,
                doctor: selectedDocId,
                amount: fee != null ? String(fee) : '',
                department: departmentValue,
              }))
            }} className={inpCompact}>
              <option value="">Walk-in / Any</option>
              {doctors.filter(d => getDoctorUserId(d)).map(d => (
                <option
                  key={getDoctorUserId(d)}
                  value={getDoctorUserId(d)}
                  data-fee={getDoctorFee(d) ?? ''}
                >
                  {d.name}
                </option>
              ))}
            </select>
          </div>
          )}
          {isOpdFieldVisible('department') && (
          <div className="col-span-6 sm:col-span-4 lg:col-span-2 min-w-0">
            <label className={lblCompact}>Department</label>
            <select value={form.department} onChange={e => setForm(f => ({ ...f, department: e.target.value }))} className={inpCompact}>
              <option value="">-- Select --</option>
              {departments.map(dep => (
                <option key={dep.id} value={dep.name || dep.code || ''}>{dep.name || dep.code}</option>
              ))}
            </select>
          </div>
          )}
          {isOpdFieldVisible('amount') && (
          <div className="col-span-4 sm:col-span-3 lg:col-span-2 min-w-0">
            <label className={lblCompact}>Amount</label>
            <div className="relative">
              <span className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400 font-bold text-xs">₹</span>
              <input
                type="number"
                min="0"
                step="1"
                value={form.amount}
                onKeyDown={e => {
                  if (['-', '+', 'e', 'E'].includes(e.key)) e.preventDefault()
                }}
                onChange={e => {
                  opdAmountManuallyEditedRef.current = true
                  const next = e.target.value
                  if (next === '' || (/^\d+$/.test(next) && Number(next) >= 0)) {
                    setForm(f => ({ ...f, amount: next }))
                  }
                }}
                placeholder="0"
                className={`${inpCompact} pl-6`}
              />
            </div>
          </div>
          )}
          {isOpdFieldVisible('amount') && (
          <div className="col-span-4 sm:col-span-3 lg:col-span-2 min-w-0">
            <label className={lblCompact}>Payment</label>
            <select value={form.payment_mode} onChange={e => setForm(f => ({ ...f, payment_mode: e.target.value }))} className={inpCompact}>
              <option value="cash">Cash</option>
              <option value="upi">UPI</option>
              <option value="other">Other</option>
            </select>
          </div>
          )}
          {isOpdFieldVisible('chief_complaint') && (
          <div className="col-span-12 sm:col-span-6 lg:col-span-4 min-w-0">
            <label className={lblCompact}>Chief complaint</label>
            <input value={form.chief_complaint} onChange={e => setForm(f => ({ ...f, chief_complaint: e.target.value }))} placeholder="e.g. fever, follow-up" className={inpCompact} />
          </div>
          )}

          {opdExtraTemplateFields.length > 0 && (
            <div className="col-span-12 border-t border-gray-100 pt-3 mt-1">
              <p className="text-xs font-bold text-gray-500 mb-2 tracking-tight">
                Slip template fields
                <span className="font-normal text-gray-400 ml-1">
                  (from OPD editor — saved on the patient record)
                </span>
              </p>
              <div className="grid grid-cols-12 gap-x-3 gap-y-2">
                {opdExtraTemplateFields.map((f) => (
                  <div key={f} className="col-span-12 lg:col-span-3 min-w-0">
                    <label className={`${lbl} flex flex-col gap-1`}>
                      <span>{f}</span>
                      <input
                        type="text"
                        value={templateValues[f] ?? ''}
                        readOnly={isExistingPatientSelected}
                        onChange={(e) =>
                          setTemplateValues((tv) => ({ ...tv, [f]: e.target.value }))
                        }
                        placeholder={`Enter ${f}`}
                        className={inp}
                        autoComplete="off"
                      />
                    </label>
                  </div>
                ))}
              </div>
            </div>
          )}

        </div>

        {/* Submit — clear CTA hierarchy */}
        <div className="p-4 border-t border-gray-200 shrink-0 space-y-2.5">
          {/* PRIMARY CTA — most prominent, 18px font */}
          <button type="submit" disabled={submitting} onClick={() => { submitActionRef.current = 'a4' }}
            className="w-full bg-emerald-600 text-white py-3.5 rounded-2xl text-[18px] font-extrabold hover:bg-emerald-700 active:scale-[0.98] disabled:opacity-60 flex items-center justify-center gap-2.5 shadow-lg shadow-emerald-600/30 transition-all">
            {submitting && submitActionRef.current === 'a4'
              ? <><span className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" /> Processing…</>
              : <><Printer size={20} strokeWidth={2.5} /> {matchedPatient ? 'Assign Token & Print' : 'Register & Print Slip'}</>
            }
          </button>

          {/* SECONDARY CTA — thermal option, visually subordinate, 14px */}
          {SHOW_THERMAL_ASSIGN_BUTTON && (
            <button type="submit" disabled={submitting} onClick={() => { submitActionRef.current = 'thermal' }}
              className="w-full bg-white border-2 border-gray-200 text-gray-700 py-2.5 rounded-xl text-[14px] font-bold hover:bg-gray-50 hover:border-gray-300 active:scale-[0.98] disabled:opacity-60 flex items-center justify-center gap-2 transition-all">
              {submitting && submitActionRef.current === 'thermal'
                ? <span className="w-4 h-4 border-2 border-emerald-600 border-t-transparent rounded-full animate-spin" />
                : 'Assign Token — Show Thermal Option'
              }
            </button>
          )}

          {/* Help text — label hierarchy: 13px */}
          <p className="text-center text-[13px] font-medium text-gray-400 leading-snug px-2">
            {matchedPatient
              ? 'Existing patient — only age editable'
              : opdNewPersonSamePhone
                ? 'New patient linked to existing family number'
                : 'New phone → patient record created automatically'}
          </p>
        </div>
      </form>

      </div>{/* end body */}

      {/* ── Queue popup overlay ── */}
      {showQueue && (
        <div
          className={`fixed inset-0 z-[150] flex bg-black/40 ${isMobile ? 'items-stretch p-0' : 'items-start justify-end'}`}
          onClick={() => setShowQueue(false)}
        >
          <div
            className={`relative bg-white shadow-2xl flex flex-col overflow-hidden ${
              isMobile
                ? 'w-full h-[100dvh] max-h-[100dvh] rounded-none'
                : 'h-full w-full max-w-lg border-l border-gray-200'
            }`}
            onClick={e => e.stopPropagation()}
          >
            {/* Header */}
            <div className={`border-b border-gray-100 flex items-center gap-2 shrink-0 bg-gray-50/80 ${isMobile ? 'px-3 py-3 flex-wrap' : 'px-5 py-3 gap-3'}`}>
              <Activity size={16} className="text-emerald-600 shrink-0" strokeWidth={2.5} />
              <span className="font-semibold text-gray-800 text-sm flex-1 min-w-0">Today's OPD Queue</span>
              
              {receptionCollectionEnabled ? (
                <button
                  type="button"
                  onClick={() => setShowCollectionModal(true)}
                  className="flex items-center gap-2 px-2.5 py-1 bg-white border border-emerald-100 rounded-full shadow-sm hover:shadow-md hover:bg-emerald-50 transition-all group shrink-0"
                >
                  <div className="w-5 h-5 rounded-full bg-emerald-500 text-white flex items-center justify-center">
                    <IndianRupee size={10} strokeWidth={3} />
                  </div>
                  <div className="flex flex-col items-start leading-none pr-1">
                    <span className="text-[9px] font-black text-emerald-600/70 uppercase tracking-tighter hidden sm:block">Collection</span>
                    <span className="text-xs font-black text-emerald-700 leading-tight">
                      ₹{collectionStats.total.toLocaleString('en-IN')}
                    </span>
                  </div>
                </button>
              ) : null}
              <div className={`flex items-center gap-1.5 shrink-0 ${isMobile ? 'w-full order-last' : ''}`}>
                <Search size={15} className="text-gray-400 shrink-0" strokeWidth={2} />
                <input
                  value={queueSearch}
                  onChange={e => setQueueSearch(e.target.value)}
                  placeholder="Search patient, token…"
                  className={`text-sm outline-none border-b border-gray-200 pb-0.5 focus:border-emerald-500 placeholder:text-gray-400 ${isMobile ? 'flex-1 min-w-0' : 'w-36'}`}
                />
                <button type="button" onClick={fetchQueue} className="text-gray-400 hover:text-emerald-600 p-1">
                  <RefreshCw size={15} strokeWidth={2} />
                </button>
                <button type="button" onClick={() => setShowQueue(false)} className="text-gray-400 hover:text-gray-700 p-1">
                  <XCircle size={20} strokeWidth={1.8} />
                </button>
              </div>
            </div>

            {/* Column headers — desktop only */}
            {!isMobile && (
              <div className="grid grid-cols-12 px-4 py-2 bg-gray-100/80 border-b border-gray-200 text-[11px] font-semibold text-gray-500 uppercase tracking-wide shrink-0">
                <div className="col-span-1">Token</div>
                <div className="col-span-4">Patient</div>
                <div className="col-span-3">Doctor</div>
                <div className="col-span-2">Complaint</div>
                <div className="col-span-2 text-right">Status</div>
              </div>
            )}

            {/* Rows */}
            <div className="flex-1 min-h-0 overflow-y-auto divide-y divide-gray-50">
              {loading ? (
                <div className="text-center py-12 text-sm text-gray-400">Loading…</div>
              ) : filteredVisits.length === 0 ? (
                <div className="text-center py-16 text-gray-400">
                  <Activity size={36} className="mx-auto mb-3 opacity-30" strokeWidth={2} />
                  <p className="text-sm font-medium text-gray-500">No visits today yet</p>
                </div>
              ) : filteredVisits.map(v => (
                isMobile ? (
                  <div key={v.id} className="px-3 py-3 hover:bg-gray-50 transition-colors">
                    <div className="flex items-start gap-3">
                      <div className={`w-10 h-10 rounded-lg font-bold text-sm flex items-center justify-center shrink-0 ${
                        ['in_progress','in_consultation'].includes(v.status) ? 'bg-blue-600 text-white' :
                        v.status === 'completed' ? 'bg-green-100 text-green-800' : 'bg-amber-100 text-amber-800'
                      }`}>
                        {v.token_number || v.queue_number || '—'}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between gap-2">
                          <p className="text-sm font-semibold text-gray-900 leading-snug">
                            {capitalizePersonName(v.patient_name || 'Patient')}
                          </p>
                          <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium capitalize shrink-0 ${statusBadge[v.status] || 'bg-gray-100 text-gray-600'}`}>
                            {v.status?.replace(/_/g, ' ')}
                          </span>
                        </div>
                        {v.patient_uhid && (
                          <p className="text-[11px] font-mono text-gray-400 mt-0.5">{v.patient_uhid}</p>
                        )}
                        {v.patient_guardian_name && (
                          <p className="text-[10px] text-gray-500 mt-0.5 truncate">
                            G: {formatGuardianLineForSlip(capitalizePersonName(v.patient_guardian_name), v.patient_guardian_relationship)}
                          </p>
                        )}
                        <p className="text-xs text-gray-500 mt-1 truncate">{v.doc_name || '—'}</p>
                        {v.chief_complaint && (
                          <p className="text-xs text-gray-400 mt-0.5 line-clamp-2">{v.chief_complaint}</p>
                        )}
                        {v.created_by_name && (
                          <p className="text-[10px] text-gray-400 font-bold mt-1">By: {v.created_by_name}</p>
                        )}
                      </div>
                      <button
                        type="button"
                        onClick={() => setPrintVisit(v)}
                        className="shrink-0 p-2 rounded-lg text-gray-400 hover:text-blue-600 hover:bg-blue-50 transition-colors"
                        aria-label="Print slip"
                      >
                        <Printer size={16} strokeWidth={2} />
                      </button>
                    </div>
                  </div>
                ) : (
                  <div key={v.id} className="grid grid-cols-12 px-4 py-2.5 items-center hover:bg-gray-50 group transition-colors">
                    <div className="col-span-1">
                      <div className={`w-9 h-9 rounded-lg font-bold text-sm flex items-center justify-center ${
                        ['in_progress','in_consultation'].includes(v.status) ? 'bg-blue-600 text-white' :
                        v.status === 'completed' ? 'bg-green-100 text-green-800' : 'bg-amber-100 text-amber-800'
                      }`}>
                        {v.token_number || v.queue_number || '—'}
                      </div>
                    </div>
                    <div className="col-span-4 pl-1 min-w-0">
                      <p className="text-sm font-medium text-gray-900 truncate">
                        {capitalizePersonName(v.patient_name || 'Patient')}
                        {v.patient_uhid && <span className="ml-1 text-[11px] font-mono text-gray-400">({v.patient_uhid})</span>}
                      </p>
                      {v.patient_guardian_name && (
                        <p className="text-[10px] text-gray-500 truncate">
                          G: {formatGuardianLineForSlip(capitalizePersonName(v.patient_guardian_name), v.patient_guardian_relationship)}
                        </p>
                      )}
                      {v.created_by_name && <p className="text-[10px] text-gray-400 font-bold">By: {v.created_by_name}</p>}
                    </div>
                    <div className="col-span-3 min-w-0">
                      <p className="text-xs text-gray-500 truncate">{v.doc_name || '—'}</p>
                    </div>
                    <div className="col-span-2 min-w-0">
                      <p className="text-xs text-gray-400 truncate">{v.chief_complaint || '—'}</p>
                    </div>
                    <div className="col-span-2 flex items-center justify-end gap-1.5">
                      <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium capitalize ${statusBadge[v.status] || 'bg-gray-100 text-gray-600'}`}>
                        {v.status?.replace(/_/g, ' ')}
                      </span>
                      <button onClick={() => setPrintVisit(v)}
                        className="text-gray-300 hover:text-blue-500 opacity-0 group-hover:opacity-100 transition-opacity">
                        <Printer size={14} strokeWidth={2} />
                      </button>
                    </div>
                  </div>
                )
              ))}
            </div>
          </div>
        </div>
      )}
      {printVisit && <PrintSlip visit={printVisit} onClose={() => setPrintVisit(null)} />}
      {samePhoneFamilyModalOpen && samePhoneFamilyList.length > 0 && (
        <div
          className="fixed inset-0 z-[200] flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/40 backdrop-blur-[2px]"
          role="dialog"
          aria-modal="true"
          aria-labelledby="same-phone-family-title"
          onClick={closeSamePhoneFamilyModalBackdrop}
        >
          <div
            className="bg-white w-full sm:max-w-sm rounded-t-2xl sm:rounded-2xl shadow-2xl flex flex-col overflow-hidden"
            onClick={e => e.stopPropagation()}
            style={{ maxHeight: 'min(90vh, 30rem)' }}
          >
            {/* ── Header ── */}
            <div className="flex items-center justify-between px-5 pt-4 pb-3 border-b border-gray-100 shrink-0">
              <div>
                <p id="same-phone-family-title" className="text-base font-semibold text-gray-900">
                  {samePhoneFamilyList.length === 1 ? 'Patient on this number' : `${samePhoneFamilyList.length} patients on this number`}
                </p>
                <p className="text-xs text-gray-400 mt-0.5">Select a patient or register a new one</p>
              </div>
              <button
                type="button"
                onClick={closeSamePhoneFamilyModalBackdrop}
                className="p-1.5 rounded-full text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-colors"
                aria-label="Close"
              >
                <XCircle size={20} strokeWidth={1.8} />
              </button>
            </div>

            {/* ── Patient list ── */}
            <ul className="px-4 py-3 space-y-2 overflow-y-auto flex-1 min-h-0">
              {samePhoneFamilyList.map((p, idx) => {
                const name = [p.first_name, p.last_name].filter(Boolean).join(' ') || 'Patient'
                const genderLabel = p.gender === 'female' ? 'Female' : p.gender === 'male' ? 'Male' : 'Other'
                const genderColor = p.gender === 'female'
                  ? 'bg-pink-50 text-pink-700 border-pink-200'
                  : p.gender === 'male'
                    ? 'bg-blue-50 text-blue-700 border-blue-200'
                    : 'bg-gray-50 text-gray-600 border-gray-200'
                const selected = matchedPatient?.id === p.id
                const initials = ((p.first_name?.[0] || '') + (p.last_name?.[0] || '')).toUpperCase() || '#'
                const avatarColor = [
                  'bg-emerald-100 text-emerald-700',
                  'bg-violet-100 text-violet-700',
                  'bg-amber-100 text-amber-700',
                  'bg-sky-100 text-sky-700',
                  'bg-rose-100 text-rose-700',
                ][idx % 5]
                return (
                  <li key={p.id}>
                    <button
                      type="button"
                      onClick={() => selectPatientFromFamilyModal(p)}
                      onDoubleClick={async () => {
                        await selectPatientFromFamilyModal(p);
                        confirmSamePhoneUseExistingPatient();
                      }}
                      className={`w-full text-left rounded-xl px-3 py-2.5 flex items-center gap-3 transition-all border ${
                        selected
                          ? 'border-emerald-400 bg-emerald-50 shadow-sm'
                          : 'border-gray-100 bg-gray-50/60 hover:border-emerald-200 hover:bg-emerald-50/40'
                      }`}
                    >
                      {/* Avatar */}
                      <span className={`shrink-0 w-9 h-9 rounded-full flex items-center justify-center text-sm font-semibold ${avatarColor}`}>
                        {initials}
                      </span>
                      {/* Info */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <p className={`text-sm truncate ${selected ? 'font-semibold text-gray-900' : 'font-normal text-gray-800'}`}>
                            {name}
                          </p>
                          {selected && <CheckCircle size={14} className="text-emerald-500 shrink-0" strokeWidth={2.5} />}
                        </div>
                        <p className="text-xs text-gray-400 truncate mt-0.5">{p.uhid}</p>
                      </div>
                      {/* Gender badge */}
                      <span className={`shrink-0 text-[11px] font-medium px-2 py-0.5 rounded-full border ${genderColor}`}>
                        {genderLabel}
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>

            {/* ── Actions ── */}
            <div className="px-4 pb-4 pt-2 space-y-2 border-t border-gray-100 shrink-0">
              <button
                type="button"
                onClick={confirmSamePhoneUseExistingPatient}
                disabled={!matchedPatient}
                className="w-full py-2.5 rounded-xl bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700 active:bg-emerald-800 disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2 transition-colors"
              >
                <CheckCircle size={16} strokeWidth={2} />
                Continue with selected patient
              </button>
              <button
                type="button"
                onClick={startAddAnotherPersonSamePhone}
                className="w-full py-2.5 rounded-xl border border-gray-200 bg-white text-gray-700 text-sm font-medium hover:bg-gray-50 active:bg-gray-100 flex items-center justify-center gap-2 transition-colors"
              >
                <UserPlus size={16} strokeWidth={2} className="text-emerald-600" />
                Register new person on this number
              </button>
            </div>
          </div>
        </div>
      )}

      {receptionCollectionEnabled && showCollectionModal && (
        <CollectionSummaryModal 
          stats={collectionStats} 
          entries={collectionEntries}
          recipients={handoverRecipients}
          pendingHandovers={pendingHandovers}
          onHandoverSuccess={fetchHandoverSummary}
          onClose={() => setShowCollectionModal(false)} 
        />
      )}
      </div>
    </>
  )
}

function CollectionSummaryModal({ stats, entries, recipients, pendingHandovers, onHandoverSuccess, onClose }) {
  const isMobile = useIsMobile()
  const [showHandoverModal, setShowHandoverModal] = useState(false)
  const [selectedRecipient, setSelectedRecipient] = useState('')
  const [declaredCashAmount, setDeclaredCashAmount] = useState(stats.cash > 0 ? String(stats.cash) : '')
  const [handoverNotes, setHandoverNotes] = useState('')
  const [actionLoading, setActionLoading] = useState(false)

  async function submitHandover() {
    if (!selectedRecipient) {
      toast.error('Select recipient first')
      return
    }
    setActionLoading(true)
    try {
      await api.post('/handovers/initiate/', {
        to_user_id: selectedRecipient,
        declared_cash_amount: declaredCashAmount || '0',
        notes: handoverNotes,
      })
      toast.success('Handover request sent')
      setDeclaredCashAmount('')
      setHandoverNotes('')
      setSelectedRecipient('')
      if (onHandoverSuccess) await onHandoverSuccess()
    } catch (err) {
      toast.error(err?.response?.data?.errors?.detail?.[0] || 'Failed to initiate handover')
    } finally {
      setActionLoading(false)
    }
  }

  async function verifyPending(handoverId, action) {
    setActionLoading(true)
    try {
      await api.post('/handovers/verify/', { handover_id: handoverId, action })
      toast.success(action === 'accept' ? 'Handover accepted' : 'Handover rejected')
      if (onHandoverSuccess) await onHandoverSuccess()
    } catch {
      toast.error('Failed to process handover')
    } finally {
      setActionLoading(false)
    }
  }

  return (
    <div className={`fixed inset-0 z-[300] flex bg-black/40 backdrop-blur-[2px] ${isMobile ? 'items-stretch p-0' : 'items-center justify-center p-4'}`} onClick={onClose}>
      <div className={`bg-white w-full shadow-2xl flex flex-col overflow-hidden animate-in fade-in zoom-in duration-200 ${isMobile ? 'h-[100dvh] max-h-[100dvh] rounded-none' : 'max-w-2xl rounded-2xl'}`} onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className={`border-b border-gray-100 flex items-center gap-2 bg-emerald-600 shrink-0 ${isMobile ? 'px-4 py-3' : 'px-6 py-4'}`}>
          <div className="flex items-center gap-3 min-w-0 flex-1">
            <div className="w-10 h-10 rounded-xl bg-white/20 backdrop-blur-md flex items-center justify-center text-white shrink-0">
              <Receipt size={24} strokeWidth={2.5} />
            </div>
            <div className="min-w-0">
              <h2 className="text-base sm:text-lg font-black text-white leading-tight truncate">Daily Collection Summary</h2>
              <p className="text-emerald-100 text-[10px] sm:text-xs font-bold tracking-wide uppercase truncate">{format(new Date(), 'EEEE, d MMMM yyyy')}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setShowHandoverModal(true)}
            className="shrink-0 px-2.5 sm:px-3 py-1.5 rounded-lg bg-white/15 border border-white/20 text-white text-[10px] sm:text-xs font-black uppercase tracking-wide hover:bg-white/25 transition-colors"
          >
            {isMobile ? 'Handover' : 'Shift Handover'}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 p-2 rounded-full hover:bg-white/10 text-white/80 hover:text-white transition-colors"
            aria-label="Close"
          >
            <XCircle size={24} strokeWidth={2} />
          </button>
        </div>

        <div className={`flex-1 min-h-0 overflow-y-auto ${isMobile ? 'p-3 bg-slate-50' : 'p-6 bg-slate-50/60'}`}>
          {/* Grand total — primary read at a glance */}
          <div className="rounded-2xl bg-emerald-600 text-white px-4 py-4 sm:px-5 sm:py-5 shadow-sm mb-4">
            <p className="text-sm font-medium text-emerald-100">Today's total collection</p>
            <p className="text-3xl sm:text-4xl font-black mt-1 tabular-nums leading-none">
              ₹{stats.total.toLocaleString('en-IN')}
            </p>
            <p className="text-xs text-emerald-100/90 mt-2 leading-relaxed">
              Unsettled shift total from cash, UPI, and other payments recorded today.
            </p>
          </div>

          {/* Payment mode breakdown — 3-column grid on mobile for quick scan */}
          <div className="grid grid-cols-3 gap-2 sm:gap-3 mb-4">
            <div className="rounded-xl border border-emerald-200 bg-white p-3 sm:p-4 shadow-sm text-center sm:text-left">
              <div className="flex items-center justify-center sm:justify-between gap-2 mb-1.5 sm:mb-2">
                <span className="text-xs sm:text-sm font-semibold text-gray-700">Cash</span>
                <div className="hidden sm:flex w-8 h-8 rounded-lg bg-emerald-50 items-center justify-center text-emerald-600">
                  <CreditCard size={16} />
                </div>
              </div>
              <p className="text-base sm:text-2xl font-bold text-gray-900 tabular-nums leading-tight">₹{stats.cash.toLocaleString('en-IN')}</p>
            </div>
            <div className="rounded-xl border border-blue-200 bg-white p-3 sm:p-4 shadow-sm text-center sm:text-left">
              <div className="flex items-center justify-center sm:justify-between gap-2 mb-1.5 sm:mb-2">
                <span className="text-xs sm:text-sm font-semibold text-gray-700">UPI</span>
                <div className="hidden sm:flex w-8 h-8 rounded-lg bg-blue-50 items-center justify-center text-blue-600">
                  <RefreshCw size={16} />
                </div>
              </div>
              <p className="text-base sm:text-2xl font-bold text-gray-900 tabular-nums leading-tight">₹{stats.upi.toLocaleString('en-IN')}</p>
            </div>
            <div className="rounded-xl border border-gray-200 bg-white p-3 sm:p-4 shadow-sm text-center sm:text-left">
              <div className="flex items-center justify-center sm:justify-between gap-2 mb-1.5 sm:mb-2">
                <span className="text-xs sm:text-sm font-semibold text-gray-700">Other</span>
                <div className="hidden sm:flex w-8 h-8 rounded-lg bg-gray-100 items-center justify-center text-gray-600">
                  <Tag size={16} />
                </div>
              </div>
              <p className="text-base sm:text-2xl font-bold text-gray-900 tabular-nums leading-tight">₹{stats.other.toLocaleString('en-IN')}</p>
            </div>
          </div>

          <CollectionTransactionList
            entries={entries}
            stats={stats}
            showOpeningCash
            showGrandTotalFooter={false}
            emptyMessage="No collections recorded today"
            className="shadow-sm"
            mobileCardLayout={isMobile}
          />
        </div>

        <div className="bg-white border-t border-gray-200 shrink-0 px-4 py-3 sm:px-6 sm:py-4">
          <div className="flex items-center justify-between gap-3 rounded-xl bg-emerald-50 border border-emerald-100 px-4 py-3">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-gray-700">Grand total</p>
              <p className="text-xs text-gray-500 mt-0.5">Unsettled amount for this shift</p>
            </div>
            <p className="text-2xl sm:text-3xl font-black text-emerald-700 tabular-nums shrink-0">
              ₹{stats.total.toLocaleString('en-IN')}
            </p>
          </div>
        </div>
      </div>
      {showHandoverModal && (
        <div className={`fixed inset-0 z-[320] flex bg-black/45 backdrop-blur-[2px] ${isMobile ? 'items-stretch p-0' : 'items-center justify-center p-4'}`} onClick={() => setShowHandoverModal(false)}>
          <div className={`bg-white w-full shadow-2xl overflow-hidden flex flex-col ${isMobile ? 'h-[100dvh] max-h-[100dvh] rounded-none' : 'max-w-xl rounded-2xl'}`} onClick={e => e.stopPropagation()}>
            <div className="px-4 sm:px-5 py-4 border-b border-gray-100 bg-emerald-600 text-white flex items-center justify-between shrink-0">
              <div>
                <h3 className="text-base font-black leading-tight">Shift Handover</h3>
                <p className="text-[11px] font-bold text-emerald-100 uppercase tracking-wide">Transfer and verify cash responsibility</p>
              </div>
              <button type="button" onClick={() => setShowHandoverModal(false)} className="p-1.5 rounded-full hover:bg-white/10">
                <XCircle size={20} />
              </button>
            </div>

            <div className="p-4 sm:p-5 space-y-4 flex-1 min-h-0 overflow-y-auto">
              <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2">
                <p className="text-[11px] font-black uppercase tracking-wider text-emerald-700">Current Cash In Hand</p>
                <p className="text-xl font-black text-emerald-800">₹{Number(stats.cash || 0).toLocaleString('en-IN')}</p>
              </div>

              {pendingHandovers?.length > 0 && (
                <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 space-y-2">
                  <p className="text-xs font-black uppercase tracking-wider text-amber-700">Pending Verification</p>
                  {pendingHandovers.map(h => (
                    <div key={h.id} className="rounded-lg bg-white border border-amber-100 p-3">
                      <p className="text-sm font-bold text-gray-800">
                        {h.from_user_name} is handing over ₹{Number(h.declared_cash_amount || 0).toLocaleString('en-IN')} cash
                      </p>
                      <p className="text-xs text-gray-500 mt-1">
                        System Cash: ₹{Number(h.system_cash_amount || 0).toLocaleString('en-IN')} | UPI: ₹{Number(h.system_upi_amount || 0).toLocaleString('en-IN')}
                      </p>
                      <div className="mt-2 flex gap-2">
                        <button
                          type="button"
                          disabled={actionLoading}
                          onClick={() => verifyPending(h.id, 'accept')}
                          className="px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-xs font-bold hover:bg-emerald-700 disabled:opacity-50"
                        >
                          Verify & Accept
                        </button>
                        <button
                          type="button"
                          disabled={actionLoading}
                          onClick={() => verifyPending(h.id, 'reject')}
                          className="px-3 py-1.5 rounded-lg border border-red-300 text-red-700 text-xs font-bold hover:bg-red-50 disabled:opacity-50"
                        >
                          Reject
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <div className="rounded-xl border border-gray-200 p-3 space-y-2">
                <p className="text-xs font-black uppercase tracking-wider text-gray-600">Initiate Handover</p>
                <select
                  value={selectedRecipient}
                  onChange={e => setSelectedRecipient(e.target.value)}
                  className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 outline-none"
                >
                  <option value="">Select recipient</option>
                  {(recipients || []).map(r => <option key={r.id} value={r.id}>{r.name} ({r.email})</option>)}
                </select>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={declaredCashAmount}
                  onChange={e => setDeclaredCashAmount(e.target.value)}
                  placeholder="Physical Cash Counted"
                  className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 outline-none"
                />
                <input
                  type="text"
                  value={handoverNotes}
                  onChange={e => setHandoverNotes(e.target.value)}
                  placeholder="Optional note (shortage/excess remarks)"
                  className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 outline-none"
                />
                <button
                  type="button"
                  disabled={actionLoading}
                  onClick={submitHandover}
                  className="w-full py-2.5 rounded-xl bg-emerald-600 text-white text-sm font-bold hover:bg-emerald-700 disabled:opacity-50"
                >
                  Send Handover Request
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Staff Attendance ────────────────────────────────────────────────────────
function StaffAttendanceSection() {
  const [staff, setStaff] = useState([])
  const [records, setRecords] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const today = format(new Date(), 'yyyy-MM-dd')

  useEffect(() => { fetchData() }, [])

  async function fetchData() {
    setLoading(true)
    try {
      const [sRes, aRes] = await Promise.all([
        api.get('/staff/?limit=1000&employment_status=active'),
        api.get(`/attendance/daily-records/?attendance_date=${today}&limit=1000`)
      ])
      // Backend returns { success: true, data: [...] } or results: [...]
      const sData = sRes.data?.data || sRes.data?.results || sRes.data || []
      const aData = aRes.data?.data || aRes.data?.results || aRes.data || []
      setStaff(Array.isArray(sData) ? sData : [])
      setRecords(Array.isArray(aData) ? aData : [])
    } catch { toast.error('Failed to load data') }
    finally { setLoading(false) }
  }

  async function handlePunch(staffId, action) {
    try {
      await api.post(`/attendance/daily-records/${action}/`, { staff_id: staffId })
      toast.success(action === 'check-in' ? 'Staff clocked in' : 'Staff clocked out')
      fetchData()
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Punch failed')
    }
  }

  const filteredStaff = staff.filter(s => 
    !search || 
    `${s.first_name} ${s.last_name}`.toLowerCase().includes(search.toLowerCase()) ||
    (s.employee_code || '').toLowerCase().includes(search.toLowerCase())
  )

  const staffWithStatus = filteredStaff.map(s => {
    const record = records.find(r => r.staff === s.id)
    return { ...s, record }
  })

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 flex flex-col min-h-0 h-full overflow-hidden">
      <div className="p-4 border-b border-gray-100 flex items-center justify-between gap-4 bg-gray-50/50 shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-emerald-100 text-emerald-600 flex items-center justify-center shadow-inner">
            <Clock size={20} strokeWidth={2.5} />
          </div>
          <div>
            <h3 className="font-extrabold text-gray-800 tracking-tight">Staff Attendance</h3>
            <p className="text-xs text-gray-500 font-bold uppercase tracking-widest opacity-60">
              {format(new Date(), 'EEEE, dd MMMM')}
            </p>
          </div>
        </div>
        <div className="relative max-w-xs w-full">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
          <input 
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search staff..."
            className="w-full pl-9 pr-4 py-2 bg-white border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-emerald-500 focus:outline-none font-semibold text-gray-700 shadow-sm transition-all"
          />
        </div>
        <button onClick={fetchData} className="p-2 text-gray-400 hover:text-emerald-600 transition-colors">
          <RefreshCw size={18} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 custom-scrollbar bg-gray-50/30">
        {loading ? (
          <div className="flex flex-col items-center justify-center h-64 text-gray-400 gap-3">
            <div className="w-8 h-8 border-4 border-emerald-500 border-t-transparent rounded-full animate-spin" />
            <p className="text-sm font-bold uppercase tracking-widest opacity-50">Syncing Records...</p>
          </div>
        ) : staffWithStatus.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 text-gray-400 opacity-60">
            <Users size={48} className="mb-4" />
            <p className="text-lg font-bold">No Staff Found</p>
            <p className="text-sm">Try a different search term</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {staffWithStatus.map(s => {
              const checkedIn = s.record?.check_in_at
              const checkedOut = s.record?.check_out_at
              const initials = ((s.first_name?.[0] || '') + (s.last_name?.[0] || '')).toUpperCase()
              return (
                <div key={s.id} className={`group rounded-2xl border transition-all duration-300 relative overflow-hidden flex flex-col ${
                  checkedIn ? 'bg-white border-emerald-200 ring-4 ring-emerald-50 shadow-lg shadow-emerald-100/50 scale-[1.02] z-10' :
                  'bg-white border-gray-100 hover:border-emerald-300 hover:shadow-xl hover:shadow-emerald-50 hover:-translate-y-1'
                }`}>
                  {/* Status Indicator Bar */}
                  <div className={`h-1 w-full absolute top-0 left-0 transition-colors ${
                    checkedIn ? 'bg-emerald-500' : 'bg-red-400'
                  }`} />

                  <div className="p-4 flex-1">
                    <div className="flex items-start justify-between mb-4">
                      <div className="flex items-center gap-3">
                        <div className={`w-12 h-12 rounded-2xl flex items-center justify-center font-black text-lg transition-all shadow-md ${
                          checkedIn ? 'bg-emerald-600 text-white rotate-3 group-hover:rotate-0' :
                          'bg-red-600 text-white -rotate-3 group-hover:rotate-0'
                        }`}>
                          {initials || <User size={20} />}
                        </div>
                        <div className="min-w-0">
                          <h4 className="font-black text-gray-800 text-sm truncate leading-tight">
                            {s.first_name} {s.last_name}
                          </h4>
                          <p className="text-[10px] text-gray-400 font-extrabold uppercase tracking-widest mt-0.5 truncate">
                            {s.designation_name || s.employee_code || 'Staff'}
                          </p>
                        </div>
                      </div>
                      <span className={`text-[9px] font-black px-2.5 py-1 rounded-lg uppercase tracking-widest shadow-sm ${
                        checkedIn ? 'bg-emerald-100 text-emerald-700' : 'bg-red-50 text-red-600 border border-red-100'
                      }`}>
                        {checkedIn ? 'Present' : 'Absent'}
                      </span>
                    </div>

                    <div className="grid grid-cols-2 gap-2 mb-4">
                      <div className="bg-gray-50/80 rounded-xl p-2 border border-gray-100 text-center transition-colors group-hover:bg-white group-hover:shadow-inner">
                        <p className="text-[9px] text-gray-400 font-black uppercase tracking-tighter mb-0.5 opacity-60 text-left">Shift Start</p>
                        <p className={`text-sm font-black ${checkedIn ? 'text-emerald-700' : 'text-gray-400'}`}>
                          {checkedIn ? formatTime(checkedIn) : '--:--'}
                        </p>
                      </div>
                      <div className="bg-gray-50/80 rounded-xl p-2 border border-gray-100 text-center transition-colors group-hover:bg-white group-hover:shadow-inner">
                        <p className="text-[9px] text-gray-400 font-black uppercase tracking-tighter mb-0.5 opacity-60 text-left">Shift End</p>
                        <p className={`text-sm font-black ${checkedOut ? 'text-emerald-700' : 'text-gray-400'}`}>
                          {checkedOut ? formatTime(checkedOut) : '--:--'}
                        </p>
                      </div>
                    </div>

                    {!checkedOut ? (
                      <button
                        onClick={() => handlePunch(s.id, checkedIn ? 'check-out' : 'check-in')}
                        className={`w-full py-3 rounded-xl text-[10px] font-black uppercase tracking-[0.2em] transition-all flex items-center justify-center gap-2 border-2 ${
                          checkedIn 
                            ? 'bg-red-50 text-red-600 border-red-200 hover:bg-red-600 hover:text-white hover:border-red-600'
                            : 'bg-emerald-600 text-white border-emerald-600 hover:bg-emerald-700 hover:border-emerald-700 shadow-lg shadow-emerald-100'
                        }`}
                      >
                        {checkedIn ? <LogOut size={14} /> : <Clock size={14} />}
                        {checkedIn ? 'Punch Out' : 'Punch In Now'}
                      </button>
                    ) : (
                      <div className="py-3 text-center text-[10px] font-black uppercase tracking-[0.2em] text-gray-400 bg-gray-50 rounded-xl border border-dashed border-gray-200 flex items-center justify-center gap-2">
                        <CheckCircle size={14} className="text-green-500" /> Complete
                      </div>
                    )}
                  </div>

                  {checkedIn && !checkedOut && (
                    <div className="px-4 py-2 bg-emerald-600 text-[9px] text-white font-black text-center uppercase tracking-widest">
                      Session Active
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

/** When ward and room match (e.g. bed picker sets room = ward), show one label + bed, not "Ward / Ward / Bed". */
function formatIpdBedAllocationLine(wardName, roomName, bedCode) {
  const w = String(wardName ?? '').trim()
  const r = String(roomName ?? '').trim()
  const b = String(bedCode ?? '').trim()
  if (w && r && w.toLowerCase() === r.toLowerCase()) {
    return `${w || '--'} / ${b || '--'}`
  }
  return `${w || '--'} / ${r || '--'} / ${b || '--'}`
}

function formatWardRoomReceiptLabel(wardName, roomName) {
  const w = String(wardName ?? '').trim()
  const r = String(roomName ?? '').trim()
  if (w && r && w.toLowerCase() === r.toLowerCase()) return w
  if (!w && !r) return '—'
  return `${w || '—'} / ${r || '—'}`
}

/** IPD admit slip: use `ipdNo` (ledger IPD ID), not the admission UUID. */
function printIpdAdmitSlip({
  ipdNo,
  admissionDate,
  patientName,
  patientUhid,
  patientPhone,
  doctorName,
  department,
  wardName,
  roomName,
  bedCode,
  bedPrice,
  diagnosis,
  notes,
  targetWindow = null,
}) {
  const isMobile = isMobileDevice()
  const slipProfile = getPaymentSlipProfile()
  const hospitalName = slipProfile.hospital_name || DEFAULT_PAYMENT_SLIP_PROFILE.hospital_name
  const address = slipProfile.address || DEFAULT_PAYMENT_SLIP_PROFILE.address
  const pinCode = slipProfile.pin_code || DEFAULT_PAYMENT_SLIP_PROFILE.pin_code
  const phone = slipProfile.phone || DEFAULT_PAYMENT_SLIP_PROFILE.phone
  const email = slipProfile.email || DEFAULT_PAYMENT_SLIP_PROFILE.email
  const website = slipProfile.website || DEFAULT_PAYMENT_SLIP_PROFILE.website
  const now = formatDateTime(new Date(), {})
  const admitDate = admissionDate ? format(new Date(admissionDate), 'dd/MM/yyyy') : format(new Date(), 'dd/MM/yyyy')
  const bedPriceNum = Number(String(bedPrice || '').replace(/,/g, ''))
  const hasBedPrice = Number.isFinite(bedPriceNum) && bedPriceNum > 0
  const bedPriceFixed = hasBedPrice ? bedPriceNum.toFixed(2) : '0.00'
  const safe = (v) => String(v || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const bedAllocationLine = formatIpdBedAllocationLine(wardName, roomName, bedCode)
  const logoUrl = resolvePaymentSlipLogoUrl(slipProfile)
  const profileLines = `<strong>${safe(address)}</strong><br/>
          Pincode: ${safe(pinCode)}<br/>
          Phone: ${safe(phone)}<br/>
          Email: ${safe(email)}${website ? `<br/>Website: ${safe(website)}` : ''}`

  const docHtml = `<!DOCTYPE html><html><head>
    <meta charset="utf-8"/>
    <title>IPD Admit Slip — ${safe(ipdNo || 'New')}</title>
    <style>
      @page { size: A4 portrait; margin: 0; }
      * { box-sizing: border-box; margin: 0; padding: 0; }
      body { font-family: Arial, sans-serif; color: #111; width: 210mm; background: #fff; }
      .slip { width: 210mm; min-height: 148.5mm; padding: 6mm 8mm 5mm; display: flex; flex-direction: column; border-bottom: 2px dashed #aaa; }
      ${buildPaymentSlipHeaderCss()}
      .receipt-title { text-align: center; font-size: 13px; font-weight: 700; text-transform: uppercase; letter-spacing: 2px; border-bottom: 1px solid #111; padding-bottom: 2mm; margin-bottom: 2.5mm; }
      .info-grid { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 1.5mm 4mm; margin-bottom: 2.5mm; font-size: 10px; }
      .info-cell { display: flex; flex-direction: column; gap: 1px; }
      .info-label { color: #666; font-size: 9px; }
      .info-val { font-weight: 700; color: #111; word-break: break-word; }
      table { width: 100%; border-collapse: collapse; font-size: 10.5px; margin-top: 2.5mm; }
      thead tr { background: #1a6b3f; color: #fff; }
      th { padding: 3px 5px; font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: .5px; }
      th.c { text-align: center; width: 26px; }
      th.l { text-align: left; }
      th.r { text-align: right; width: 80px; }
      tbody tr { border-bottom: 1px solid #e5e7eb; }
      tbody tr:last-child { border-bottom: 1.5px solid #111; }
      td { padding: 3px 5px; }
      td.c { text-align: center; color: #555; }
      td.l { text-align: left; }
      td.r { text-align: right; font-weight: 700; }
      .totals { margin-left: auto; width: 170px; margin-top: 1.5mm; font-size: 10.5px; }
      .t-row { display: flex; justify-content: space-between; padding: 1px 5px; }
      .t-row.disc { color: #dc2626; }
      .t-row.final { font-weight: 800; font-size: 12px; border-top: 2px solid #111; padding-top: 2px; margin-top: 2px; color: #1a6b3f; }
      .section-wrap { margin-top: 3mm; display: grid; grid-template-columns: 1fr 1fr; gap: 3mm; }
      .section { margin-top: 0; }
      .section-lbl { font-size: 10px; color: #6b7280; text-transform: uppercase; font-weight: 700; letter-spacing: .4px; }
      .section-val { margin-top: 1.5mm; font-size: 11.5px; color: #111; line-height: 1.6; white-space: pre-wrap; }
      .footer { margin-top: auto; padding-top: 2.5mm; border-top: 1px dashed #aaa; display: flex; justify-content: space-between; align-items: flex-end; gap: 8mm; font-size: 9px; color: #555; }
      .note { max-width: 62%; line-height: 1.5; }
      .status-box { border: 2px solid #1a6b3f; color: #1a6b3f; font-weight: 900; font-size: 12px; padding: 2px 10px; border-radius: 4px; letter-spacing: 1.5px; }
      .sig { text-align: right; margin-top: 6mm; }
      .sig-line { width: 45mm; border-top: 1px solid #9ca3af; margin-left: auto; margin-bottom: 2px; }
    </style>
  </head><body>
    <div class="slip">
      ${buildPaymentSlipTopHeaderHtml({
        hospitalName,
        logoUrl,
        tagline: 'Healthcare &amp; Diagnostics',
        profileLines,
        escapeHtml: safe,
      })}

      <div class="receipt-title">IPD Admission Slip</div>

        <div class="info-grid">
        <div class="info-cell"><span class="info-label">IPD ID</span><span class="info-val">${safe(ipdNo || '--')}</span></div>
        <div class="info-cell"><span class="info-label">Admission Date</span><span class="info-val">${safe(admitDate)}</span></div>
        <div class="info-cell"><span class="info-label">Generated At</span><span class="info-val">${safe(now)}</span></div>
        <div class="info-cell"><span class="info-label">Patient Name</span><span class="info-val">${safe(patientName || 'Patient')}</span></div>
        <div class="info-cell"><span class="info-label">UHID</span><span class="info-val">${safe(patientUhid || '--')}</span></div>
        <div class="info-cell"><span class="info-label">Mobile No.</span><span class="info-val">${safe(patientPhone || '--')}</span></div>
        <div class="info-cell"><span class="info-label">Department</span><span class="info-val">${safe(department || '--')}</span></div>
        <div class="info-cell"><span class="info-label">Assigned Doctor</span><span class="info-val">${safe(doctorName || '--')}</span></div>
        <div class="info-cell"><span class="info-label">Bed Allocation</span><span class="info-val">${safe(bedAllocationLine)}</span></div>
          <div class="info-cell"><span class="info-label">Bed Price (Per Day)</span><span class="info-val">₹${hasBedPrice ? bedPriceFixed : '--'}</span></div>
      </div>

      <div class="section-wrap">
        <div class="section">
          <div class="section-lbl">Admission Diagnosis</div>
          <div class="section-val">${safe(diagnosis || '--')}</div>
        </div>
        <div class="section">
          <div class="section-lbl">Admission Notes</div>
          <div class="section-val">${safe(notes || '--')}</div>
        </div>
      </div>

      <table>
        <thead>
          <tr>
            <th class="c">SL No.</th>
            <th class="l">Charge Head</th>
            <th class="r">Amount</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td class="c">1</td>
            <td class="l">Bed Charge (Per Day)</td>
            <td class="r">₹${bedPriceFixed}</td>
          </tr>
        </tbody>
      </table>
      <div class="totals">
        <div class="t-row"><span>Total Amount:</span><span>₹${bedPriceFixed}</span></div>
        <div class="t-row disc"><span>Discount:</span><span>₹0.00</span></div>
        <div class="t-row final"><span>Net Amount:</span><span>₹${bedPriceFixed}</span></div>
      </div>

      <div class="footer">
        <div class="note">
          <strong>Note:</strong> Please keep this slip for IPD desk verification, billing, and internal ward handover records.
        </div>
        <div>
          <div class="status-box">ADMITTED</div>
          <div class="sig">
            <div class="sig-line"></div>
            Authorized Signature
          </div>
        </div>
      </div>
    </div>
    ${isMobile ? '' : PRINT_WINDOW_CLOSE_SCRIPT}
  </body></html>`

  // Mobile: render the slip on a real same-origin page (/print-slip?job=payment) so the Android
  // print dialog shows the content. The desktop close-script (about:blank replace on afterprint)
  // is omitted above because it blanks the live-rendered mobile print preview.
  if (isMobile) {
    const win = shouldUseDedicatedPrintDocument()
      ? null
      : ((targetWindow && !targetWindow.closed)
        ? targetWindow
        : window.open('/print-slip?job=payment', '_blank'))
    deliverMobilePrintHtml(docHtml, {
      targetWindow: win,
      storageKey: 'payment-slip-print-job',
    })
    return
  }

  const w = createSameTabPrintWindow()
  w.document.write(docHtml)
  w.document.close()
}

function registrationDefaultsFromOpd() {
  const opd = getReceptionOpdSettings()
  return { defaultCity: opd.default_city || '', defaultState: opd.default_state || '' }
}

function NewPatientRegistrationModal({
  open,
  initialSearch = '',
  title = 'Register New Patient',
  onClose,
  onCreated,
}) {
  const [form, setForm] = useState(() =>
    buildPatientRegistrationInitialFromSearch(initialSearch, registrationDefaultsFromOpd()),
  )
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (!open) return
    setForm(buildPatientRegistrationInitialFromSearch(initialSearch, registrationDefaultsFromOpd()))
  }, [open, initialSearch])

  async function handleSubmit(e) {
    e.preventDefault()
    const validationError = validatePatientRegistrationForm(form)
    if (validationError) {
      toast.error(validationError)
      return
    }
    setSubmitting(true)
    try {
      const created = await registerPatientFromForm(form)
      toast.success(`Patient registered! UHID: ${created?.uhid || '—'}`)
      onCreated?.(created)
      onClose?.()
    } catch (err) {
      if (err?.response?.data) {
        const errData = err.response.data
        toast.error(errData?.detail || (errData?.errors ? JSON.stringify(errData.errors) : null) || 'Registration failed')
      } else {
        toast.error(err?.message || 'Registration failed')
      }
    } finally {
      setSubmitting(false)
    }
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-[360] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl max-h-[94vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="bg-gradient-to-r from-emerald-600 to-teal-600 px-5 py-3 flex items-center justify-between text-white shrink-0">
          <h3 className="font-black text-base">{title}</h3>
          <button type="button" onClick={onClose} className="text-white/85 hover:text-white"><XCircle size={20} /></button>
        </div>
        <div className="p-5 overflow-y-auto flex-1 min-h-0">
          <PatientRegistrationForm
            form={form}
            setForm={setForm}
            onSubmit={handleSubmit}
            submitting={submitting}
            submitLabel="Register Patient"
            footerExtra={(
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 rounded-xl text-sm font-bold text-gray-600 bg-gray-100 hover:bg-gray-200"
              >
                Cancel
              </button>
            )}
          />
        </div>
      </div>
    </div>
  )
}

// ─── IPD Admissions ───────────────────────────────────────────────────────────
function IPDSection({ mode, initialAdmissionDraft }) {
  const isMobile = useIsMobile()
  const [admissions, setAdmissions] = useState([])
  const [patients, setPatients] = useState([])
  const [doctors, setDoctors] = useState([])
  const [departments, setDepartments] = useState([])
  const [schemes, setSchemes] = useState([])
  const [bedPriceMap, setBedPriceMap] = useState({})
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(0)
  const PAGE_SIZE = 10

  useEffect(() => {
    setPage(0)
  }, [search])

  const [form, setForm] = useState({
    patient: '', assigned_doctor: '', department: '', scheme: '', ward_name: '', bed_code: '',
    admission_date: format(new Date(), 'yyyy-MM-dd'),
    admission_time: format(new Date(), 'HH:mm'),
    admission_diagnosis: '', admission_notes: '',
  })
  const [submitting, setSubmitting] = useState(false)
  const [selected, setSelected] = useState(null)
  const [autoDischarge, setAutoDischarge] = useState(false)
  const [showBedPicker, setShowBedPicker] = useState(false)
  const [pickedBed, setPickedBed] = useState(null)

  const [ptSearch, setPtSearch] = useState('')
  const [ptResults, setPtResults] = useState([])
  const [ptSearching, setPtSearching] = useState(false)
  const [selectedPatient, setSelectedPatient] = useState(null)
  const [isAddingNew, setIsAddingNew] = useState(false)
  const [newPt, setNewPt] = useState({ search: '' })

  const [showPayments, setShowPayments] = useState(null) // admission object
  const [showAddCharge, setShowAddCharge] = useState(null) // admission object
  const [editingAdmission, setEditingAdmission] = useState(null)
  const [processAdmission, setProcessAdmission] = useState(null)
  const [autoPrintAdmitSlip, setAutoPrintAdmitSlip] = useState(false)
  const [timelineFor, setTimelineFor] = useState(null)
  const lastAppliedDraftRef = useRef('')
  const splitName = (fullName) => {
    const parts = String(fullName || '').trim().split(/\s+/).filter(Boolean)
    return {
      first_name: parts[0] || '',
      last_name: parts.slice(1).join(' ') || '',
    }
  }

  const [summaryMap, setSummaryMap] = useState({}) // admission_id → summary

  async function fetchSummaries() {
    try {
      const { data } = await api.get('/summaries/?limit=500')
      const list = data?.data || data?.results || data || []
      const map = {}
      list.forEach((s) => { map[String(s.admission)] = s })
      setSummaryMap(map)
    } catch {}
  }

  useEffect(() => {
    fetchAdmissions()
    fetchPatients()
    fetchDoctors()
    fetchDepartments()
    fetchSchemes()
    fetchBedPrices()
    fetchSummaries()
  }, [mode])

  useEffect(() => {
    function handleRefreshAdmissions() {
      fetchAdmissions()
      fetchSummaries()
    }
    window.addEventListener('refresh-admissions', handleRefreshAdmissions)
    return () => window.removeEventListener('refresh-admissions', handleRefreshAdmissions)
  }, [])

  useEffect(() => {
    if (mode !== 'new_admission') return
    const draft = initialAdmissionDraft
    if (!draft?.id) return
    const draftKey = String(draft.id)
    if (lastAppliedDraftRef.current === draftKey) return

    const nameParts = splitName(draft.patient_name)
    const instantPatient = {
      id: draft.patient_id || '',
      uhid: draft.patient_uhid || '',
      phone: draft.patient_phone || '',
      first_name: nameParts.first_name,
      last_name: nameParts.last_name,
    }

    // Instant prefill: do not wait for full patient list API.
    setSelectedPatient(instantPatient)
    setIsAddingNew(false)
    setPtSearch('')
    setPtResults([])
    setForm((prev) => ({
      ...prev,
      patient: draft.patient_id || prev.patient || '',
      assigned_doctor: draft.doctor_user || prev.assigned_doctor || '',
      admission_date: format(new Date(), 'yyyy-MM-dd'),
      admission_time: format(new Date(), 'HH:mm'),
      admission_diagnosis: draft.visit_reason || prev.admission_diagnosis || '',
      admission_notes: draft.notes || prev.admission_notes || '',
    }))
    lastAppliedDraftRef.current = draftKey

    // Optional enrichment in background (when patient list arrives).
    const matchedPatient = patients.find((p) => String(p.id) === String(draft.patient_id))
      || patients.find((p) => String(p.uhid || '').toLowerCase() === String(draft.patient_uhid || '').toLowerCase())
    if (matchedPatient) {
      setSelectedPatient(matchedPatient)
      setForm((prev) => ({ ...prev, patient: matchedPatient.id }))
    }
  }, [mode, initialAdmissionDraft, patients])

  async function fetchAdmissions() {
    setLoading(true)
    try {
      const { data } = await api.get('/ipd-admissions/?status=admitted&limit=500')
      const rows = data?.data || data?.results || data || []
      setAdmissions(sortAdmissionsLatestFirst(rows))
    } catch { toast.error('Failed to load IPD admissions') }
    finally { setLoading(false) }
  }

  async function fetchPatients() {
    try {
      const { data } = await api.get('/patients/?limit=500')
      setPatients(data?.data || data?.results || data || [])
    } catch {}
  }

  async function fetchDoctors() {
    try {
      const { data } = await api.get('/doctor-profiles/?limit=500')
      setDoctors(data?.data || data?.results || data || [])
    } catch {}
  }

  async function fetchDepartments() {
    try {
      const { data } = await api.get('/departments/?limit=500')
      setDepartments(Array.isArray(data?.data) ? data.data : (data?.results || data || []))
    } catch {}
  }

  async function fetchSchemes() {
    try {
      const { data } = await api.get('/schemes/?limit=500')
      setSchemes(Array.isArray(data?.data) ? data.data : (data?.results || data || []))
    } catch {}
  }

  async function fetchBedPrices() {
    try {
      const { data } = await api.get('/beds/beds/by-floor/')
      const floors = Array.isArray(data?.data) ? data.data : (data || [])
      const priceByCode = {}
      for (const floor of floors) {
        for (const room of (floor?.rooms || [])) {
          const roomCharge = Number(room?.daily_charge || 0)
          for (const bed of (room?.beds || [])) {
            if (bed?.bed_code) priceByCode[String(bed.bed_code)] = roomCharge
          }
        }
      }
      setBedPriceMap(priceByCode)
    } catch {}
  }

  useEffect(() => {
    if (ptSearch.trim().length < 2) { setPtResults([]); return }
    const t = setTimeout(async () => {
      setPtSearching(true)
      try {
        const { data } = await api.get(`/patients/?search=${encodeURIComponent(ptSearch)}&limit=8`)
        setPtResults(Array.isArray(data?.data) ? data.data : (data?.results || []))
      } catch { setPtResults([]) }
      finally { setPtSearching(false) }
    }, 400)
    return () => clearTimeout(t)
  }, [ptSearch])

  function handleBedSelect(bedInfo) {
    setPickedBed(bedInfo)
    setForm(f => ({
      ...f,
      bed_code: bedInfo.bed_code,
      ward_name: bedInfo.ward_name,
      room_name: bedInfo.room_name,
    }))
  }

  async function submitAdmission(e) {
    e.preventDefault()
    
    let targetPatientId = selectedPatient?.id
    let currentPatient = selectedPatient

    if (isAddingNew) { toast.error('Complete patient registration popup first'); return }

    if (!targetPatientId) { toast.error('Select or Register a patient first'); return }
    if (!form.department) { toast.error('Select department'); return }
    if (!form.bed_code) { toast.error('Select a bed first'); return }

    // Mobile: open the print tab synchronously in the click gesture (before the await) so the
    // browser doesn't block it. The slip HTML is handed over via localStorage after admission.
    let admitSlipWindow = null
    if (autoPrintAdmitSlip && isMobileDevice()) {
      try { localStorage.removeItem('payment-slip-print-job') } catch { /* ignore */ }
      admitSlipWindow = window.open('/print-slip?job=payment', '_blank')
    }

    setSubmitting(true)
    try {
      const payload = {
        ...form,
        patient: targetPatientId,
        scheme: form.scheme || null,
      }
      const { data } = await api.post('/ipd-admissions/', payload)
      const admitted = data?.data || data?.entity || data
      if (autoPrintAdmitSlip) {
        const doc = doctors.find(d => (d.user || d.id) === form.assigned_doctor)
        printIpdAdmitSlip({
          ipdNo: admitted?.ipd_no,
          admissionDate: admitted?.admission_date || form.admission_date,
          patientName: [currentPatient?.first_name, currentPatient?.last_name].filter(Boolean).join(' ') || currentPatient?.name,
          patientUhid: currentPatient?.uhid,
          patientPhone: currentPatient?.phone || '',
          doctorName: doc?.name || [doc?.first_name, doc?.last_name].filter(Boolean).join(' '),
          department: form.department,
          wardName: form.ward_name,
          roomName: form.room_name,
          bedCode: form.bed_code,
          bedPrice: pickedBed?.daily_charge ? Number(pickedBed.daily_charge).toLocaleString('en-IN') : '--',
          diagnosis: form.admission_diagnosis,
          notes: form.admission_notes,
          targetWindow: admitSlipWindow,
        })
      } else if (admitSlipWindow && !admitSlipWindow.closed) {
        admitSlipWindow.close()
      }
      toast.success('Patient admitted successfully!')
      setForm({
        patient: '', assigned_doctor: '', department: '', scheme: '', ward_name: '', bed_code: '',
        admission_date: format(new Date(), 'yyyy-MM-dd'),
        admission_time: format(new Date(), 'HH:mm'),
        admission_diagnosis: '', admission_notes: '',
      })
      setAutoPrintAdmitSlip(false)
      setSelectedPatient(null)
      setIsAddingNew(false)
      setNewPt({ search: '' })
      setPickedBed(null)
      fetchAdmissions()
    } catch (err) {
      if (admitSlipWindow && !admitSlipWindow.closed) admitSlipWindow.close()
      const patientErr = err?.response?.data?.patient?.[0] || err?.response?.data?.errors?.patient?.[0]
      toast.error(patientErr || err?.response?.data?.detail || JSON.stringify(err?.response?.data) || 'Error admitting patient')
    } finally { setSubmitting(false) }
  }

  function reprintAdmitSlip(admission) {
    const patientRow = patients.find(p => String(p.id) === String(admission.patient))
    const doc = doctors.find(d => (d.user || d.id) === admission.assigned_doctor)
    const bedPrice = bedPriceMap[String(admission.bed_code || '')]
    printIpdAdmitSlip({
      ipdNo: admission.ipd_no,
      admissionDate: admission.admission_date,
      patientName: admission.patient_name || [patientRow?.first_name, patientRow?.last_name].filter(Boolean).join(' '),
      patientUhid: admission.patient_uhid || patientRow?.uhid,
      patientPhone: patientRow?.phone || '',
      doctorName: doc?.name || [doc?.first_name, doc?.last_name].filter(Boolean).join(' ') || admission.assigned_doctor_email,
      department: admission.department,
      wardName: admission.ward_name,
      roomName: admission.room_name,
      bedCode: admission.bed_code,
      bedPrice: Number.isFinite(bedPrice) && bedPrice > 0 ? Number(bedPrice).toLocaleString('en-IN') : '--',
      diagnosis: admission.admission_diagnosis,
      notes: admission.admission_notes,
    })
  }

  // Removed old simple discharge function

  const statusColors = {
    admitted: 'bg-blue-100 text-blue-700',
    discharged: 'bg-green-100 text-green-700',
    transferred: 'bg-amber-100 text-amber-700',
    cancelled: 'bg-red-100 text-red-700',
  }

  if (mode === 'new_admission') {
    return (
      <div className="max-w-2xl">
        <h2 className="text-lg font-bold text-gray-800 mb-4 flex items-center gap-2">
          <PlusCircle size={20} className="text-blue-500" /> New IPD Admission
        </h2>
        <form onSubmit={submitAdmission} className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="relative">
              <label className="text-xs text-gray-500 mb-1 block">Patient *</label>
              
              {selectedPatient ? (
                <div className="flex items-center gap-2.5 bg-blue-50 border border-blue-200 rounded-xl px-3 py-2">
                  <div className="w-7 h-7 rounded-full bg-blue-100 text-blue-700 font-bold text-xs flex items-center justify-center shrink-0 uppercase">
                    {(selectedPatient.first_name?.[0] || '') + (selectedPatient.last_name?.[0] || '')}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-bold text-gray-900 truncate">{[selectedPatient.first_name, selectedPatient.last_name].filter(Boolean).join(' ')}</p>
                    <p className="text-xs text-gray-400">{selectedPatient.uhid} · {selectedPatient.phone || 'No phone'}</p>
                  </div>
                  <button type="button" onClick={() => setSelectedPatient(null)} className="text-gray-300 hover:text-red-500">
                    <XCircle size={16} />
                  </button>
                </div>
              ) : (
                <div className="relative">
                  <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                  <input 
                    value={ptSearch}
                    onChange={e => setPtSearch(e.target.value)}
                    placeholder="Search by name or UHID..."
                    className="w-full pl-9 pr-4 py-2 bg-white border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none font-medium"
                    autoComplete="off"
                  />
                  {ptSearching && <RefreshCw size={12} className="absolute right-3 top-1/2 -translate-y-1/2 text-blue-500 animate-spin" />}
                  
                  {(ptResults.length > 0 || (ptSearch.length > 1 && !ptSearching)) && (
                    <ul className="absolute z-50 mt-1 w-full bg-white rounded-xl shadow-2xl border border-gray-100 divide-y divide-gray-50 max-h-60 overflow-y-auto">
                      {ptResults.map(p => (
                        <li key={p.id}>
                          <button type="button" onClick={() => { setSelectedPatient(p); setPtSearch(''); setPtResults([]) }}
                            className="w-full text-left px-3 py-2.5 hover:bg-blue-50/50 flex items-center gap-3 group">
                            <div className="w-8 h-8 rounded-full bg-gray-100 text-gray-400 group-hover:bg-blue-600 group-hover:text-white flex items-center justify-center font-bold text-xs uppercase transition-all shrink-0">
                              {(p.first_name?.[0] || '') + (p.last_name?.[0] || '')}
                            </div>
                            <div className="min-w-0">
                              <p className="text-sm font-bold text-gray-800">{[p.first_name, p.last_name].filter(Boolean).join(' ')}</p>
                              <p className="text-[10px] text-gray-400 font-mono italic">{p.uhid} · {p.phone || 'No phone'}</p>
                            </div>
                          </button>
                        </li>
                      ))}
                      <li className="bg-blue-50/50">
                        <button type="button" onClick={() => { setIsAddingNew(true); setNewPt({ search: ptSearch }); setPtSearch(''); setPtResults([]) }}
                          className="w-full text-left px-3 py-3 flex items-center gap-3 group transition-all">
                          <div className="w-8 h-8 rounded-xl bg-blue-600 text-white flex items-center justify-center group-hover:scale-110 transition-transform shrink-0">
                            <Plus size={16} strokeWidth={3} />
                          </div>
                          <div className="min-w-0">
                            <p className="text-[10px] font-black text-blue-700 uppercase tracking-widest">Register & Admit As New</p>
                            <p className="text-xs text-blue-600 font-bold italic truncate opacity-70">"{ptSearch}"</p>
                          </div>
                        </button>
                      </li>
                    </ul>
                  )}
                </div>
              )}
            </div>
            <div>
              <label className="text-xs text-gray-500 mb-1 block">Assigned Doctor</label>
              <select value={form.assigned_doctor} onChange={e => setForm(f => ({ ...f, assigned_doctor: e.target.value }))}
                className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none">
                <option value="">-- Select doctor --</option>
                {doctors.map(d => (
                  <option key={d.user || d.id} value={d.user || d.id}>
                    {d.name || [d.first_name, d.last_name].filter(Boolean).join(' ') || d.user}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs text-gray-500 mb-1 block">Department *</label>
              <select
                value={form.department}
                onChange={e => setForm(f => ({ ...f, department: e.target.value }))}
                className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none"
                required
              >
                <option value="">-- Select department --</option>
                {departments.map(dep => (
                  <option key={dep.id} value={dep.name || dep.code || ''}>
                    {dep.name || dep.code}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs text-gray-500 mb-1 block">Scheme</label>
              <select
                value={form.scheme}
                onChange={e => setForm(f => ({ ...f, scheme: e.target.value }))}
                className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none"
              >
                <option value="">-- No scheme --</option>
                {schemes.map(s => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </div>
            {/* Bed picker */}
            <div className="col-span-2">
              <label className="text-xs text-gray-500 mb-1 block">Bed Assignment *</label>
              {pickedBed ? (
                <div className="flex items-center gap-3 bg-blue-50 border-2 border-blue-300 rounded-xl p-3">
                  <div className="w-10 h-10 rounded-xl bg-blue-600 text-white flex items-center justify-center">
                    <Bed size={18} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-bold text-gray-800">
                      {getBedDisplayLabel(pickedBed, getReceptionOpdSettings().admission_bed_label_mode)} · {pickedBed.room_name}
                      {pickedBed.is_ac && (
                        <span className="ml-2 text-xs bg-cyan-100 text-cyan-700 px-1.5 py-0.5 rounded-full font-semibold">
                          <Wind size={9} className="inline mr-0.5" />AC
                        </span>
                      )}
                    </p>
                    <p className="text-xs text-gray-500">
                      {pickedBed.floor_name} ·{' '}
                      <span className="text-emerald-600 font-semibold">₹{Number(pickedBed.daily_charge).toLocaleString()}/day</span>
                    </p>
                  </div>
                  <button type="button" onClick={() => { setPickedBed(null); setForm(f => ({ ...f, bed_code: '', ward_name: '' })) }}
                    className="text-gray-400 hover:text-red-500"><XCircle size={18} /></button>
                  <button type="button" onClick={() => setShowBedPicker(true)}
                    className="text-xs bg-blue-100 text-blue-700 px-3 py-1.5 rounded-lg font-semibold hover:bg-blue-200">
                    Change
                  </button>
                </div>
              ) : (
                <button type="button" onClick={() => setShowBedPicker(true)}
                  className="w-full border-2 border-dashed border-blue-300 bg-blue-50/50 hover:bg-blue-50 rounded-xl py-4 text-sm text-blue-600 font-semibold flex items-center justify-center gap-2 transition-all hover:border-blue-400">
                  <Bed size={16} /> Select Floor & Bed
                </button>
              )}
            </div>
            <div>
              <label className="text-xs text-gray-500 mb-1 block">Admission Date *</label>
              <FormattedDateInput
                value={form.admission_date}
                onChange={(v) => setForm((f) => ({ ...f, admission_date: v }))}
                required
                className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none"
                placeholder="Select admission date..."
              />
            </div>
            <div>
              <label className="text-xs text-gray-500 mb-1 block">Admission Time *</label>
              <AmPmTimeInput
                value={form.admission_time}
                onChange={(v) => setForm((f) => ({ ...f, admission_time: v }))}
                required
              />
            </div>
            <div>
              <label className="text-xs text-gray-500 mb-1 block">Admission Diagnosis</label>
              <input value={form.admission_diagnosis} onChange={e => setForm(f => ({ ...f, admission_diagnosis: e.target.value }))}
                placeholder="Primary diagnosis"
                className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none" />
            </div>
          </div>
          <div>
            <label className="text-xs text-gray-500 mb-1 block">Admission Notes</label>
            <textarea value={form.admission_notes} onChange={e => setForm(f => ({ ...f, admission_notes: e.target.value }))}
              rows={3} placeholder="Additional notes..."
              className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none resize-none" />
          </div>
          <label className="flex items-center gap-2 text-sm text-gray-700 select-none">
            <input
              type="checkbox"
              checked={autoPrintAdmitSlip}
              onChange={e => setAutoPrintAdmitSlip(e.target.checked)}
              className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
            />
            Print admit slip automatically
          </label>
          <button type="submit" disabled={submitting || !selectedPatient || !form.department || !form.bed_code}
            className="bg-blue-600 text-white px-6 py-3 rounded-xl text-sm font-black uppercase tracking-widest hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-blue-200 transition-all active:scale-95 flex items-center gap-2">
            <Bed size={16} /> {submitting ? 'Processing…' : 'Admit Patient'}
          </button>
        </form>

        {isAddingNew && (
          <NewPatientRegistrationModal
            open={isAddingNew}
            title="Register & Admit As New Patient"
            initialSearch={newPt.search}
            onClose={() => setIsAddingNew(false)}
            onCreated={(created) => {
              setSelectedPatient(created)
              setForm((f) => ({ ...f, patient: created?.id || '' }))
              setNewPt({ search: '' })
            }}
          />
        )}

        {showBedPicker && (
          <BedSelector
            onSelect={handleBedSelect}
            onClose={() => setShowBedPicker(false)}
          />
        )}
      </div>
    )
  }

  // Active admissions list
  const [admDateFrom, setAdmDateFrom] = useState('')
  const [admDateTo, setAdmDateTo] = useState('')

  const filtered = admissions.filter(a => {
    if (a.status !== 'admitted') return false;
    const q = search.toLowerCase()
    const matchSearch = !q || (a.patient_name || '').toLowerCase().includes(q) || (a.bed_code || '').toLowerCase().includes(q) || (a.ward_name || '').toLowerCase().includes(q)
    if (!matchSearch) return false
    if (admDateFrom || admDateTo) {
      const admDate = a.admission_date || (a.created_at ? a.created_at.slice(0, 10) : '')
      if (admDateFrom && admDate < admDateFrom) return false
      if (admDateTo && admDate > admDateTo) return false
    }
    return true
  })

  // Pagination calculations
  const total = filtered.length
  const totalPages = Math.ceil(total / PAGE_SIZE)
  const paginated = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)

  return (
    <div className={`flex flex-col min-h-0 ${isMobile ? 'h-full space-y-0' : 'flex-1 gap-4'}`}>
      {!isMobile && (
        <div className="grid grid-cols-2 gap-3">
          <div className="bg-blue-50 rounded-2xl p-4 border border-blue-100">
            <p className="text-xs text-blue-500 font-semibold">Admitted</p>
            <p className="text-2xl font-black text-blue-700">{admissions.filter(a => a.status === 'admitted').length}</p>
          </div>
          <div className="bg-amber-50 rounded-2xl p-4 border border-amber-100">
            <p className="text-xs text-amber-500 font-semibold">Expected Discharge Today</p>
            <p className="text-2xl font-black text-amber-700">
              {admissions.filter(a => a.expected_discharge_date === format(new Date(), 'yyyy-MM-dd')).length}
            </p>
          </div>
        </div>
      )}

      <div className={`bg-white shadow-sm border border-gray-100 overflow-hidden flex flex-col min-h-0 flex-1 ${isMobile ? 'rounded-none border-x-0' : 'rounded-2xl'}`}>
        {isMobile ? (
          <MobileListFilters
            search={search}
            onSearchChange={setSearch}
            dateFrom={admDateFrom}
            dateTo={admDateTo}
            onDateFromChange={setAdmDateFrom}
            onDateToChange={setAdmDateTo}
            onClearDates={() => { setAdmDateFrom(''); setAdmDateTo('') }}
            loading={loading}
            onRefresh={() => { fetchAdmissions(); fetchSummaries() }}
            total={filtered.length}
            totalLabel="admissions"
            searchPlaceholder="Search patient, bed, ward…"
          />
        ) : (
          <div className="px-4 py-3 border-b border-gray-100 flex items-center gap-2 flex-wrap">
            <Search size={16} className="text-gray-400 shrink-0" />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search patient, bed, ward…"
              className="flex-1 min-w-[120px] text-sm outline-none" />
            <span className="w-px h-4 bg-gray-200 shrink-0" />
            <div className="flex items-center gap-1.5 shrink-0">
              <label className="text-[11px] text-gray-400 font-semibold uppercase tracking-wide shrink-0">From</label>
              <input
                type="date"
                value={admDateFrom}
                max={admDateTo || undefined}
                onChange={e => setAdmDateFrom(e.target.value)}
                className="text-xs border border-gray-200 rounded-lg px-2 py-1 text-gray-700 bg-white focus:outline-none focus:ring-2 focus:ring-blue-400 focus:border-blue-400 transition-all cursor-pointer"
              />
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              <label className="text-[11px] text-gray-400 font-semibold uppercase tracking-wide shrink-0">To</label>
              <input
                type="date"
                value={admDateTo}
                min={admDateFrom || undefined}
                onChange={e => setAdmDateTo(e.target.value)}
                className="text-xs border border-gray-200 rounded-lg px-2 py-1 text-gray-700 bg-white focus:outline-none focus:ring-2 focus:ring-blue-400 focus:border-blue-400 transition-all cursor-pointer"
              />
            </div>
            {(admDateFrom || admDateTo) && (
              <button
                onClick={() => { setAdmDateFrom(''); setAdmDateTo('') }}
                className="text-[11px] font-bold text-red-500 hover:text-red-700 bg-red-50 hover:bg-red-100 px-2 py-1 rounded-lg transition-colors border border-red-100 shrink-0"
              >
                ✕ Clear
              </button>
            )}
            <span className="w-px h-4 bg-gray-200 shrink-0" />
            <button onClick={() => { fetchAdmissions(); fetchSummaries() }} className="text-gray-400 hover:text-blue-600 shrink-0"><RefreshCw size={14} /></button>
            <span className="text-xs text-gray-400 shrink-0">{filtered.length} patients</span>
          </div>
        )}
        {loading ? (
          <div className="text-center py-10 text-gray-400 text-sm">Loading…</div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-10 text-gray-400 text-sm">No active IPD admissions</div>
        ) : isMobile ? (
          <MobileCardList>
            {paginated.map((a) => {
              const summary = summaryMap[String(a.id)]
              const summaryBadge = summary ? (
                summary.is_draft ? (
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 font-semibold border border-amber-200">Draft Summary</span>
                ) : (
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 font-semibold border border-emerald-200">Summary Ready</span>
                )
              ) : null
              return (
                <IpdAdmissionMobileCard
                  key={a.id}
                  admission={a}
                  admissionDateLabel={formatAdmissionDateLabel(a.admission_date)}
                  statusClass={statusColors[a.status] || 'bg-gray-100 text-gray-600'}
                  summaryBadge={summaryBadge}
                  showDischarge={a.status === 'admitted'}
                  showProcess={a.status === 'admitted'}
                  onTimeline={() => {
                    if (!a.patient_uhid) {
                      toast.error('UHID not available for this patient')
                      return
                    }
                    const parts = String(a.patient_name || '').trim().split(/\s+/).filter(Boolean)
                    setTimelineFor({
                      uhid: a.patient_uhid,
                      first_name: parts[0] || '',
                      last_name: parts.slice(1).join(' ') || '',
                    })
                  }}
                  onDischarge={() => { setSelected(a); setAutoDischarge(true) }}
                  onProcess={() => setProcessAdmission(a)}
                  onEdit={() => setEditingAdmission(a)}
                  onPrint={() => reprintAdmitSlip(a)}
                  onOpenLedger={() => setSelected(selected?.id === a.id ? null : a)}
                />
              )
            })}
          </MobileCardList>
        ) : (
          <div className="divide-y divide-gray-50 flex-1 overflow-y-auto min-h-0">
            {paginated.map(a => (
              <div key={a.id} className="px-4 py-3 flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-blue-100 text-blue-700 flex items-center justify-center">
                  <Bed size={18} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 min-w-0">
                    <p className="text-sm font-semibold text-gray-800 truncate">{a.patient_name || a.patient}</p>
                    <span className={`shrink-0 text-[10px] px-2 py-0.5 rounded-full font-medium capitalize ${statusColors[a.status] || 'bg-gray-100 text-gray-600'}`}>
                      {a.status}
                    </span>
                    {a.scheme_name ? (
                      <span className="shrink-0 text-[10px] px-2 py-0.5 rounded font-bold uppercase tracking-widest bg-yellow-400 text-yellow-950 border border-yellow-300">
                        Scheme: {a.scheme_name}
                      </span>
                    ) : null}
                    {summaryMap[String(a.id)] ? (
                      summaryMap[String(a.id)].is_draft ? (
                        <span className="shrink-0 text-[9px] px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 font-semibold">📋 Draft Summary</span>
                      ) : (
                        <span className="shrink-0 text-[9px] px-1.5 py-0.5 rounded-full bg-emerald-100 text-emerald-700 font-semibold">✅ Summary Ready</span>
                      )
                    ) : null}
                  </div>
                  <p className="text-xs text-gray-400 truncate">
                    {a.ward_name || 'No Ward'} · Bed {a.bed_code || '—'} · Dr. {a.assigned_doctor_name || '—'} · Admitted {formatAdmissionDateLabel(a.admission_date)}
                  </p>
                  {a.admission_diagnosis && (
                    <p className="text-xs text-gray-500 truncate mt-0.5">Dx: {a.admission_diagnosis}</p>
                  )}
                </div>
                <button
                  onClick={() => {
                    if (!a.patient_uhid) {
                      toast.error('UHID not available for this patient')
                      return
                    }
                    const parts = String(a.patient_name || '').trim().split(/\s+/).filter(Boolean)
                    setTimelineFor({
                      uhid: a.patient_uhid,
                      first_name: parts[0] || '',
                      last_name: parts.slice(1).join(' ') || '',
                    })
                  }}
                  disabled={!a.patient_uhid}
                  className="text-xs bg-indigo-100 text-indigo-700 px-2 py-1 rounded-lg hover:bg-indigo-200 font-semibold flex items-center gap-1 disabled:opacity-50"
                >
                  <FileText size={12} /> Timeline
                </button>
                {a.status === 'admitted' && (
                  <button onClick={() => { setSelected(a); setAutoDischarge(true); }}
                    className="text-xs bg-green-100 text-green-700 px-2 py-1 rounded-lg hover:bg-green-200 font-semibold flex items-center gap-1">
                    <CheckCircle size={12} /> Discharge
                  </button>
                )}
                {a.status === 'admitted' && (
                  <button
                    onClick={() => setProcessAdmission(a)}
                    className="text-xs bg-violet-100 text-violet-700 px-2 py-1 rounded-lg hover:bg-violet-200 font-semibold flex items-center gap-1"
                  >
                    <Activity size={12} /> Process
                  </button>
                )}
                <button
                  onClick={() => setEditingAdmission(a)}
                  className="text-xs bg-amber-100 text-amber-700 px-2 py-1 rounded-lg hover:bg-amber-200 font-semibold flex items-center gap-1"
                >
                  <Edit2 size={12} /> Edit
                </button>
                <button
                  onClick={() => reprintAdmitSlip(a)}
                  className="text-xs bg-blue-100 text-blue-700 px-2 py-1 rounded-lg hover:bg-blue-200 font-semibold flex items-center gap-1"
                >
                  <Printer size={12} /> Print Slip
                </button>
                <button onClick={() => setSelected(selected?.id === a.id ? null : a)}
                  className="shrink-0 text-gray-400 hover:text-blue-500 rounded-xl px-2">
                  <div className="flex items-center gap-1.5 text-xs bg-gray-100 hover:bg-blue-100 text-gray-700 hover:text-blue-700 px-3 py-1.5 rounded-lg font-bold transition-colors">
                    <FileText size={14} /> Open Ledger / Pay
                  </div>
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Pagination */}
      {filtered.length > 0 && !loading && (
        <div className={`flex items-center justify-between py-1 shrink-0 ${isMobile ? 'px-3 pb-2 bg-white border-t border-gray-100' : 'px-1'}`}>
          <span className="text-sm text-gray-400 font-medium">
            {total === 0 ? 'No admissions found' : `Showing ${page * PAGE_SIZE + 1}–${Math.min((page + 1) * PAGE_SIZE, total)} of ${total}`}
          </span>
          <div className="flex items-center gap-2">
            <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0}
              className="px-4 py-1.5 rounded-full text-sm font-semibold bg-gray-200 text-gray-700 hover:bg-gray-300 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
              Previous
            </button>
            <span className="text-sm text-gray-500 font-medium px-1">
              Page {page + 1} of {totalPages || 1}
            </span>
            <button onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))} disabled={page >= totalPages - 1 || totalPages === 0}
              className="px-4 py-1.5 rounded-full text-sm font-semibold bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
              Next
            </button>
          </div>
        </div>
      )}

      {selected && (
        <AdmissionLedgerModal 
          admission={selected} 
          onClose={() => { setSelected(null); setAutoDischarge(false); }} 
          onDischarged={() => {
            setSelected(null)
            setAutoDischarge(false)
            fetchAdmissions()
            fetchSummaries()
          }}
          autoDischarge={autoDischarge}
          onDischargeInitiated={() => setAutoDischarge(false)}
        />
      )}
      {editingAdmission && (
        <EditAdmissionModal
          admission={editingAdmission}
          doctors={doctors}
          departments={departments}
          onClose={() => setEditingAdmission(null)}
          onSaved={() => {
            setEditingAdmission(null)
            fetchAdmissions()
          }}
        />
      )}
      {processAdmission && (
        <IpdProcessModal
          admission={processAdmission}
          templates={getIpdProcessTemplates()}
          onLoadTemplates={async () => {
            await loadReceptionPortalSettings()
            return getIpdProcessTemplates()
          }}
          onClose={() => setProcessAdmission(null)}
          onSaved={() => {}}
        />
      )}
      {timelineFor && (
        <PatientLifetimeTimelineModal
          patient={timelineFor}
          onClose={() => setTimelineFor(null)}
        />
      )}
    </div>
  )
}

/** Values for `<input type="date" />` must be YYYY-MM-DD (API may return ISO datetime strings). */
function toHtmlDateInputValue(v) {
  if (v == null || v === '') return ''
  const s = String(v).trim()
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (m) return `${m[1]}-${m[2]}-${m[3]}`
  const d = new Date(s)
  if (Number.isNaN(d.getTime())) return ''
  return format(d, 'yyyy-MM-dd')
}

/** IPD API expects YYYY-MM-DD; optional fields should be `null`, not `''`. */
function toApiDateOrNull(v) {
  if (v == null || String(v).trim() === '') return null
  const s = String(v).trim()
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (m) return `${m[1]}-${m[2]}-${m[3]}`
  const d = new Date(s)
  if (Number.isNaN(d.getTime())) return null
  return format(d, 'yyyy-MM-dd')
}

function formatAdmissionDateLabel(dateStr) {
  if (!dateStr) return '—'
  return format(new Date(`${String(dateStr).slice(0, 10)}T12:00:00`), 'dd/MM/yyyy')
}

function toDischargedAtIso(dateStr, timeStr, existingDischargedAt) {
  const date = toApiDateOrNull(dateStr)
  if (!date) return null
  const normalizedTime = toHtmlTimeValue(timeStr)
  if (normalizedTime) return `${date}T${normalizedTime}:00`
  const existing = String(existingDischargedAt || '').trim()
  const timeMatch = existing.match(/T(\d{2}:\d{2}:\d{2})/)
  const timePart = timeMatch ? timeMatch[1] : '12:00:00'
  return `${date}T${timePart}`
}

function resolveAdmissionTimeValue(admission) {
  const direct = toHtmlTimeValue(admission?.admission_time)
  if (direct) return direct
  return toHtmlTimeValue(admission?.created_at) || format(new Date(), 'HH:mm')
}

function resolveDischargeTimeValue(admission, dischargeRecord) {
  const fromSummary = toHtmlTimeValue(dischargeRecord?.discharge_time)
  if (fromSummary) return fromSummary
  return toHtmlTimeValue(admission?.discharged_at) || ''
}

function resolveInitialDischargedOn(admission, dischargeRecord) {
  if (dischargeRecord?.discharge_date) return toHtmlDateInputValue(dischargeRecord.discharge_date)
  if (admission?.discharged_at) return toHtmlDateInputValue(admission.discharged_at)
  return ''
}

function combineDateAndHtmlTime(dateRaw, timeRaw) {
  if (!dateRaw) return null
  const datePart = String(dateRaw).slice(0, 10)
  const t = toHtmlTimeValue(timeRaw)
  if (t) {
    const withTime = new Date(`${datePart}T${t}:00`)
    if (!Number.isNaN(withTime.getTime())) return { date: withTime, hasTime: true }
  }
  const dateOnly = new Date(`${datePart}T12:00:00`)
  if (Number.isNaN(dateOnly.getTime())) return null
  return { date: dateOnly, hasTime: false }
}

/** Print label: date + time via hospital 12h/24h tokens (includes AM/PM in 12h mode). */
function formatPrintDateTimeLabel(dateRaw, timeRaw, { dateStyle = 'd/M/yyyy' } = {}) {
  const combined = combineDateAndHtmlTime(dateRaw, timeRaw)
  if (!combined) return '—'
  if (combined.hasTime) return formatDateTime(combined.date, { dateStyle })
  try {
    return format(combined.date, dateStyle)
  } catch {
    return '—'
  }
}

function resolveStayStartDateTimeLabel(admission) {
  if (!admission?.admission_date) return '—'
  return formatPrintDateTimeLabel(
    admission.admission_date,
    admission.admission_time || admission.created_at,
    { dateStyle: 'd/M/yy' },
  )
}

function resolveStayEndDateTimeLabel(admission, dischargeSummary = null) {
  const summary = dischargeSummary || admission?.discharge_summary || null
  if (summary?.discharge_date) {
    return formatPrintDateTimeLabel(summary.discharge_date, summary.discharge_time, { dateStyle: 'd/M/yy' })
  }
  if (admission?.discharged_at) {
    return formatDateTime(admission.discharged_at, { dateStyle: 'd/M/yy' })
  }
  const d = admission?.discharge_date
  if (d) {
    return formatPrintDateTimeLabel(d, admission?.discharge_time, { dateStyle: 'd/M/yy' })
  }
  return formatDateTime(new Date(), { dateStyle: 'd/M/yy' })
}

function resolveIpdBillDateTime(admission, dischargeSummary = null) {
  const summary = dischargeSummary || admission?.discharge_summary || null
  if (summary?.discharge_date) {
    const datePart = String(summary.discharge_date).slice(0, 10)
    let timePart = '12:00:00'
    if (summary.discharge_time) {
      const t = toHtmlTimeValue(summary.discharge_time) || String(summary.discharge_time)
      timePart = t.length <= 5 ? `${t}:00` : t.slice(0, 8)
    }
    const dt = new Date(`${datePart}T${timePart}`)
    if (!Number.isNaN(dt.getTime())) return formatReceiptDateTime(dt)
  }
  const dischargedAt = summary?.discharged_at || admission?.discharged_at
  if (dischargedAt) {
    const dt = new Date(dischargedAt)
    if (!Number.isNaN(dt.getTime())) return formatReceiptDateTime(dt)
  }
  return formatReceiptDateTime(new Date())
}

function capitalizePersonNameGlobal(value) {
  return String(value || '')
    .split(' ')
    .map((part) => (part ? `${part.charAt(0).toUpperCase()}${part.slice(1).toLowerCase()}` : ''))
    .join(' ')
}

const EMPTY_PATIENT_FORM = {
  first_name: '',
  last_name: '',
  phone: '',
  age: '',
  ageUnit: 'years',
  gender: '',
  guardian_name: '',
  guardian_relationship: '',
  address_line1: '',
  city: '',
  state: '',
  email: '',
  blood_group: '',
  dob: '',
  registration_note: '',
  emergency_tags: '',
  preferred_salutation: '',
}

function mapPatientApiToForm(p) {
  if (!p || typeof p !== 'object') return { ...EMPTY_PATIENT_FORM }
  const ageFields = hydrateAgeFieldsFromPatient(p)
  return {
    first_name: String(p.first_name ?? '').trim(),
    last_name: String(p.last_name ?? '').trim(),
    phone: String(p.phone ?? '').trim(),
    age: ageFields.age,
    ageUnit: ageFields.ageUnit,
    gender: String(p.gender ?? '').trim(),
    guardian_name: String(p.guardian_name ?? '').trim(),
    guardian_relationship: String(p.guardian_relationship ?? '').trim(),
    address_line1: String(p.address_line1 ?? '').trim(),
    city: String(p.city ?? '').trim(),
    state: String(p.state ?? '').trim(),
    email: String(p.email ?? '').trim(),
    blood_group: String(p.blood_group ?? '').trim(),
    dob: toHtmlDateInputValue(p.dob) || '',
    registration_note: String(p.registration_note ?? '').trim(),
    emergency_tags: String(p.emergency_tags ?? '').trim(),
    preferred_salutation: String(p.preferred_salutation ?? '').trim(),
  }
}

function buildPatientPatchPayload(baseline, current) {
  const patientPayload = {}
  const scalarKeys = [
    'first_name', 'last_name', 'phone', 'gender', 'guardian_name', 'guardian_relationship',
    'address_line1', 'city', 'state', 'email', 'blood_group', 'registration_note',
    'emergency_tags', 'preferred_salutation',
  ]
  scalarKeys.forEach((key) => {
    const nextVal = String(current[key] ?? '').trim()
    const prevVal = String(baseline[key] ?? '').trim()
    if (nextVal !== prevVal) patientPayload[key] = nextVal
  })
  const nextDob = String(current.dob ?? '').trim()
  const prevDob = String(baseline.dob ?? '').trim()
  if (nextDob !== prevDob) {
    patientPayload.dob = nextDob ? toApiDateOrNull(nextDob) : null
  }
  const nextAge = String(current.age ?? '').trim()
  const prevAge = String(baseline.age ?? '').trim()
  const nextUnit = normalizeAgeUnit(current.ageUnit)
  const prevUnit = normalizeAgeUnit(baseline.ageUnit)
  if (nextAge !== prevAge) {
    if (nextAge === '') {
      patientPayload.age = null
    } else {
      const parsed = parseInt(nextAge, 10)
      if (!Number.isNaN(parsed) && parsed >= 0) patientPayload.age = parsed
    }
  } else if (nextUnit !== prevUnit && nextAge !== '') {
    const parsed = parseInt(nextAge, 10)
    if (!Number.isNaN(parsed) && parsed >= 0) {
      patientPayload.age = parsed
      patientPayload.age_unit = nextUnit
    }
  }
  if (patientPayload.age != null && patientPayload.age_unit == null) {
    patientPayload.age_unit = nextUnit
  }
  return patientPayload
}

function fallbackPatientFormFromAdmissionName(patientName) {
  const parts = String(patientName || '').trim().split(/\s+/).filter(Boolean)
  return {
    ...EMPTY_PATIENT_FORM,
    first_name: parts[0] || '',
    last_name: parts.slice(1).join(' ') || '',
  }
}

const patientFieldInputCls = 'w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none'

function PatientEditFormFields({ patientForm, setPatientForm, loading }) {
  return (
    <div className="p-5 grid grid-cols-1 md:grid-cols-2 gap-3 relative">
      {loading && (
        <div className="absolute inset-0 z-10 bg-white/70 backdrop-blur-[1px] flex items-center justify-center rounded-b-2xl">
          <span className="text-sm font-semibold text-blue-600">Loading patient…</span>
        </div>
      )}
      <div>
        <label className="text-xs text-gray-500 mb-1 block">First Name</label>
        <input value={patientForm.first_name} onChange={e => setPatientForm(p => ({ ...p, first_name: e.target.value }))}
          className={patientFieldInputCls} />
      </div>
      <div>
        <label className="text-xs text-gray-500 mb-1 block">Last Name</label>
        <input value={patientForm.last_name} onChange={e => setPatientForm(p => ({ ...p, last_name: e.target.value }))}
          className={patientFieldInputCls} />
      </div>
      <div>
        <label className="text-xs text-gray-500 mb-1 block">Phone</label>
        <input value={patientForm.phone} onChange={e => setPatientForm(p => ({ ...p, phone: e.target.value.replace(/\D/g, '').slice(0, 10) }))}
          className={patientFieldInputCls} />
      </div>
      <div>
        <label className="text-xs text-gray-500 mb-1 block">Email</label>
        <input type="email" value={patientForm.email} onChange={e => setPatientForm(p => ({ ...p, email: e.target.value }))}
          className={patientFieldInputCls} />
      </div>
      <div>
        <label className="text-xs text-gray-500 mb-1 block">Date of Birth</label>
        <input type="date" value={patientForm.dob || ''} onChange={e => setPatientForm(p => ({ ...p, dob: e.target.value }))}
          className={patientFieldInputCls} />
      </div>
      <div>
        <label className="text-xs text-gray-500 mb-1 block">Age (if no DOB)</label>
        <AgeWithUnitInput
          value={patientForm.age}
          unit={patientForm.ageUnit}
          onValueChange={(next) => setPatientForm((p) => ({ ...p, age: next }))}
          onUnitChange={(next) => setPatientForm((p) => ({ ...p, ageUnit: next }))}
          inputClassName={patientFieldInputCls}
        />
      </div>
      <div>
        <label className="text-xs text-gray-500 mb-1 block">Gender</label>
        <select value={patientForm.gender} onChange={e => setPatientForm(p => ({ ...p, gender: e.target.value }))}
          className={patientFieldInputCls}>
          <option value="">-- Select gender --</option>
          <option value="male">Male</option>
          <option value="female">Female</option>
          <option value="other">Other</option>
        </select>
      </div>
      <div>
        <label className="text-xs text-gray-500 mb-1 block">Blood Group</label>
        <select value={patientForm.blood_group} onChange={e => setPatientForm(p => ({ ...p, blood_group: e.target.value }))}
          className={patientFieldInputCls}>
          <option value="">Unknown</option>
          {['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'].map(g => <option key={g} value={g}>{g}</option>)}
        </select>
      </div>
      <div>
        <label className="text-xs text-gray-500 mb-1 block">Guardian</label>
        <input value={patientForm.guardian_name} onChange={e => setPatientForm(p => ({ ...p, guardian_name: e.target.value }))}
          className={patientFieldInputCls} />
      </div>
      <div>
        <label className="text-xs text-gray-500 mb-1 block">Guardian relationship</label>
        <select value={patientForm.guardian_relationship} onChange={e => setPatientForm(p => ({ ...p, guardian_relationship: e.target.value }))}
          className={patientFieldInputCls}>
          {GUARDIAN_RELATIONSHIP_OPTIONS.map((opt) => (
            <option key={opt.value || 'none'} value={opt.value}>{opt.label}</option>
          ))}
        </select>
      </div>
      <div className="md:col-span-2">
        <label className="text-xs text-gray-500 mb-1 block">Address</label>
        <input value={patientForm.address_line1} onChange={e => setPatientForm(p => ({ ...p, address_line1: e.target.value }))}
          className={patientFieldInputCls} />
      </div>
      <div>
        <label className="text-xs text-gray-500 mb-1 block">City</label>
        <input value={patientForm.city} onChange={e => setPatientForm(p => ({ ...p, city: e.target.value }))}
          className={patientFieldInputCls} />
      </div>
      <div>
        <label className="text-xs text-gray-500 mb-1 block">State</label>
        <input value={patientForm.state} onChange={e => setPatientForm(p => ({ ...p, state: e.target.value }))}
          className={patientFieldInputCls} />
      </div>
      <div className="md:col-span-2">
        <label className="text-xs text-gray-500 mb-1 block">Registration note</label>
        <textarea rows={3} value={patientForm.registration_note} onChange={e => setPatientForm(p => ({ ...p, registration_note: e.target.value }))}
          maxLength={2000}
          className={`${patientFieldInputCls} resize-y min-h-[72px]`} />
      </div>
      <div className="md:col-span-2">
        <label className="text-xs text-gray-500 mb-1 block">Emergency tags</label>
        <input value={patientForm.emergency_tags} onChange={e => setPatientForm(p => ({ ...p, emergency_tags: e.target.value }))}
          placeholder="Comma-separated"
          className={patientFieldInputCls} />
      </div>
    </div>
  )
}

function PatientEditModal({ patientId, onClose, onSaved, zIndexClass = 'z-[530]' }) {
  const [submitting, setSubmitting] = useState(false)
  const [loading, setLoading] = useState(true)
  const [patientForm, setPatientForm] = useState(() => ({ ...EMPTY_PATIENT_FORM }))
  const [baselinePatientForm, setBaselinePatientForm] = useState(() => ({ ...EMPTY_PATIENT_FORM }))
  const [uhidLabel, setUhidLabel] = useState('')

  useEffect(() => {
    if (!patientId) return
    let cancelled = false
    setLoading(true)
    ;(async () => {
      try {
        const { data } = await api.get(`/patients/${patientId}/`)
        const p = data?.data ?? data ?? {}
        if (cancelled) return
        const next = mapPatientApiToForm(p)
        setPatientForm(next)
        setBaselinePatientForm(next)
        setUhidLabel(p.uhid || '')
      } catch {
        if (!cancelled) toast.error('Failed to load patient')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [patientId])

  async function handleSave() {
    if (!patientId) return
    setSubmitting(true)
    try {
      const patientPayload = buildPatientPatchPayload(baselinePatientForm, patientForm)
      if (Object.keys(patientPayload).length === 0) {
        onClose()
        return
      }
      await api.patch(`/patients/${patientId}/`, patientPayload)
      toast.success('Patient details updated')
      setBaselinePatientForm({ ...patientForm })
      onSaved?.({ patientForm, uhid: uhidLabel })
      onClose()
    } catch (err) {
      const apiErrors = err?.response?.data?.errors
      const firstFieldError =
        apiErrors && typeof apiErrors === 'object'
          ? Object.values(apiErrors).flat().find(Boolean)
          : null
      toast.error(firstFieldError || err?.response?.data?.detail || 'Failed to update patient')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className={`fixed inset-0 ${zIndexClass} flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm`} onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[92vh] overflow-hidden flex flex-col border border-gray-100" onClick={e => e.stopPropagation()}>
        <div className="bg-gradient-to-r from-blue-600 to-blue-500 px-5 py-3 flex items-center justify-between text-white shrink-0">
          <div>
            <h4 className="font-black text-base">Edit Patient</h4>
            {uhidLabel ? <p className="text-blue-100 text-xs font-mono">{uhidLabel}</p> : null}
          </div>
          <button type="button" onClick={onClose} className="text-white/80 hover:text-white">
            <XCircle size={20} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto">
          <PatientEditFormFields patientForm={patientForm} setPatientForm={setPatientForm} loading={loading} />
        </div>
        <div className="px-5 py-4 flex items-center justify-end gap-3 border-t border-gray-100 shrink-0">
          <button type="button" onClick={onClose}
            className="px-4 py-2 rounded-xl text-sm font-bold text-gray-600 bg-gray-100 hover:bg-gray-200">
            Cancel
          </button>
          <button type="button" disabled={submitting || loading} onClick={handleSave}
            className="px-5 py-2.5 rounded-xl text-sm font-black text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-60 disabled:cursor-not-allowed">
            {submitting ? 'Saving...' : 'Save Patient'}
          </button>
        </div>
      </div>
    </div>
  )
}

function EditAdmissionModal({
  admission,
  dischargeRecord = null,
  mode = 'active',
  doctors,
  departments,
  onClose,
  onSaved,
}) {
  const isDischargedMode = mode === 'discharged'
  const [submitting, setSubmitting] = useState(false)
  const [showBedPicker, setShowBedPicker] = useState(false)
  const [showPatientEditModal, setShowPatientEditModal] = useState(false)
  const [patientPreview, setPatientPreview] = useState({
    patient_name: admission.patient_name || '--',
    patient_uhid: admission.patient_uhid || 'UHID unavailable',
  })
  const [form, setForm] = useState({
    assigned_doctor: admission.assigned_doctor || '',
    department: admission.department || '',
    ward_name: admission.ward_name || '',
    room_name: admission.room_name || '',
    bed_code: admission.bed_code || '',
    admission_date: toHtmlDateInputValue(admission.admission_date) || format(new Date(), 'yyyy-MM-dd'),
    admission_time: resolveAdmissionTimeValue(admission),
    discharged_on: isDischargedMode ? resolveInitialDischargedOn(admission, dischargeRecord) : '',
    discharged_time: isDischargedMode ? resolveDischargeTimeValue(admission, dischargeRecord) : '',
    expected_discharge_date: toHtmlDateInputValue(admission.expected_discharge_date),
    admission_diagnosis: admission.admission_diagnosis || '',
    admission_notes: admission.admission_notes || '',
  })
  const [bedBaseline] = useState(() => ({
    bed_code: admission.bed_code || '',
    room_name: admission.room_name || '',
    ward_name: admission.ward_name || '',
  }))
  const bedAssignmentDirty = useMemo(() => {
    const n = (s) => String(s ?? '').trim()
    return (
      n(form.bed_code) !== n(bedBaseline.bed_code) ||
      n(form.room_name) !== n(bedBaseline.room_name) ||
      n(form.ward_name) !== n(bedBaseline.ward_name)
    )
  }, [form.bed_code, form.room_name, form.ward_name, bedBaseline])
  async function refreshPatientPreview() {
    if (!admission?.patient) return
    try {
      const { data } = await api.get(`/patients/${admission.patient}/`)
      const p = data?.data ?? data ?? {}
      const fullName = [p.first_name, p.last_name].filter(Boolean).join(' ').trim()
      setPatientPreview({
        patient_name: fullName || admission.patient_name || '--',
        patient_uhid: p.uhid || admission.patient_uhid || 'UHID unavailable',
      })
    } catch { /* keep existing preview */ }
  }

  function handleBedSelect(bedInfo) {
    setForm(f => ({
      ...f,
      bed_code: bedInfo.bed_code,
      ward_name: bedInfo.ward_name || '',
      room_name: bedInfo.room_name || '',
    }))
    setShowBedPicker(false)
  }

  async function handleSave(e) {
    e.preventDefault()
    if (!form.department) { toast.error('Department is required'); return }
    if (!form.bed_code) { toast.error('Bed assignment is required'); return }
    const admissionDate = toApiDateOrNull(form.admission_date)
    if (!admissionDate) {
      toast.error('Admission date must be a valid date (YYYY-MM-DD)')
      return
    }
    if (isDischargedMode) {
      if (!form.discharged_on) {
        toast.error('Discharge date is required')
        return
      }
      if (form.discharged_on < form.admission_date) {
        toast.error('Discharge date cannot be before admission date')
        return
      }
    }
    setSubmitting(true)
    try {
      const payload = {
        assigned_doctor: form.assigned_doctor || null,
        department: form.department,
        ward_name: form.ward_name,
        room_name: form.room_name,
        bed_code: form.bed_code,
        admission_date: admissionDate,
        admission_time: toHtmlTimeValue(form.admission_time) || null,
        admission_diagnosis: form.admission_diagnosis || '',
        admission_notes: form.admission_notes || '',
      }
      if (isDischargedMode) {
        payload.discharged_at = toDischargedAtIso(form.discharged_on, form.discharged_time, admission.discharged_at)
      } else {
        payload.expected_discharge_date = toApiDateOrNull(form.expected_discharge_date)
      }
      await api.patch(`/ipd-admissions/${admission.id}/`, payload)
      if (isDischargedMode && dischargeRecord?.id) {
        await api.patch(`/summaries/${dischargeRecord.id}/`, {
          discharge_date: toApiDateOrNull(form.discharged_on),
          discharge_time: toHtmlTimeValue(form.discharged_time) || null,
        })
      }
      toast.success(isDischargedMode ? 'Discharged admission updated' : 'Admission details updated')
      onSaved()
    } catch (err) {
      const apiErrors = err?.response?.data?.errors
      const firstFieldError =
        apiErrors && typeof apiErrors === 'object'
          ? Object.values(apiErrors).flat().find(Boolean)
          : null
      toast.error(firstFieldError || err?.response?.data?.detail || 'Failed to update admission')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[520] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="bg-white rounded-3xl shadow-2xl w-full max-w-3xl overflow-hidden border border-gray-100">
        <div className="bg-gradient-to-r from-amber-600 to-amber-500 px-6 py-4 flex items-center justify-between text-white">
          <div>
            <h3 className="font-black text-lg tracking-tight">
              {isDischargedMode ? 'Edit Discharged Admission' : 'Edit Active Admission'}
            </h3>
            <p className="text-amber-100 text-xs font-medium">{admission.patient_name || admission.patient} · Bed {admission.bed_code || '--'}</p>
          </div>
          <button onClick={onClose} className="text-white/80 hover:text-white">
            <XCircle size={24} />
          </button>
        </div>

        <form onSubmit={handleSave} className="p-6 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2 bg-slate-50 border border-slate-200 rounded-xl p-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs text-slate-500 font-semibold">Patient</p>
                  <p className="text-sm font-bold text-slate-900">{patientPreview.patient_name || '--'}</p>
                  <p className="text-xs text-slate-500">{patientPreview.patient_uhid || 'UHID unavailable'}</p>
                </div>
                <button
                  type="button"
                  onClick={() => setShowPatientEditModal(true)}
                  className="text-xs bg-amber-100 text-amber-700 px-3 py-1.5 rounded-lg font-bold hover:bg-amber-200"
                >
                  Edit Patient
                </button>
              </div>
            </div>

            <div>
              <label className="text-xs text-gray-500 mb-1 block">Assigned Doctor</label>
              <select value={form.assigned_doctor} onChange={e => setForm(f => ({ ...f, assigned_doctor: e.target.value }))}
                className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-amber-500 focus:outline-none">
                <option value="">-- Select doctor --</option>
                {doctors.map(d => (
                  <option key={d.user || d.id} value={d.user || d.id}>
                    {d.name || [d.first_name, d.last_name].filter(Boolean).join(' ') || d.user}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="text-xs text-gray-500 mb-1 block">Department *</label>
              <select value={form.department} onChange={e => setForm(f => ({ ...f, department: e.target.value }))}
                className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-amber-500 focus:outline-none" required>
                <option value="">-- Select department --</option>
                {departments.map(dep => (
                  <option key={dep.id} value={dep.name || dep.code || ''}>
                    {dep.name || dep.code}
                  </option>
                ))}
              </select>
            </div>

            <div className="col-span-2">
              <label className="text-xs text-gray-500 mb-1 block">Bed Assignment *</label>
              <div className={`flex items-start justify-between gap-3 rounded-xl px-3 py-2.5 border ${bedAssignmentDirty ? 'bg-amber-50 border-amber-400/70' : 'bg-amber-50 border-amber-200'}`}>
                <div className="min-w-0 flex-1">
                  {bedAssignmentDirty ? (
                    <>
                      <p className="font-black text-amber-900 mb-1.5 uppercase tracking-wide text-[10px]">Bed assignment changed</p>
                      <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-2 items-start text-xs">
                        <span className="text-amber-600 font-bold shrink-0">From</span>
                        <div className="min-w-0">
                          <p className="font-bold text-amber-900">{bedBaseline.bed_code || '—'} · {bedBaseline.room_name || '—'}</p>
                          <p className="text-amber-800/90">{bedBaseline.ward_name || 'Ward not set'}</p>
                        </div>
                        <span className="text-amber-600 font-bold shrink-0">To</span>
                        <div className="min-w-0">
                          <p className="font-bold text-amber-900">{form.bed_code || '—'} · {form.room_name || '—'}</p>
                          <p className="text-amber-800/90">{form.ward_name || 'Ward not set'}</p>
                        </div>
                      </div>
                    </>
                  ) : (
                    <>
                      <p className="text-sm font-bold text-amber-900">{form.bed_code || '--'} · {form.room_name || '--'}</p>
                      <p className="text-xs text-amber-700">{form.ward_name || 'Ward not set'}</p>
                    </>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => setShowBedPicker(true)}
                  className="shrink-0 text-xs bg-amber-100 text-amber-700 px-3 py-1.5 rounded-lg font-bold hover:bg-amber-200"
                >
                  Change Bed
                </button>
              </div>
            </div>

            <div>
              <label className="text-xs text-gray-500 mb-1 block">Admission Date *</label>
              <FormattedDateInput
                value={form.admission_date}
                onChange={(v) => setForm((f) => ({ ...f, admission_date: v }))}
                required
                className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-amber-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="text-xs text-gray-500 mb-1 block">Admission Time *</label>
              <AmPmTimeInput
                value={form.admission_time}
                onChange={(v) => setForm((f) => ({ ...f, admission_time: v }))}
                required
                selectClassName="w-full border border-gray-200 rounded-xl px-2 py-2 text-sm bg-white focus:ring-2 focus:ring-amber-500 focus:outline-none"
              />
            </div>

            {isDischargedMode ? (
              <>
                <div>
                  <label className="text-xs text-gray-500 mb-1 block">Discharge date *</label>
                  <FormattedDateInput
                    value={form.discharged_on || ''}
                    min={form.admission_date || undefined}
                    onChange={(v) => setForm((f) => ({ ...f, discharged_on: v }))}
                    required
                    className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-amber-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="text-xs text-gray-500 mb-1 block">Discharge time</label>
                  <AmPmTimeInput
                    value={form.discharged_time}
                    onChange={(v) => setForm((f) => ({ ...f, discharged_time: v }))}
                    selectClassName="w-full border border-gray-200 rounded-xl px-2 py-2 text-sm bg-white focus:ring-2 focus:ring-amber-500 focus:outline-none"
                  />
                </div>
              </>
            ) : (
              <div>
                <label className="text-xs text-gray-500 mb-1 block">Expected Discharge Date <span className="text-gray-400 font-normal">(optional)</span></label>
                <FormattedDateInput
                  value={form.expected_discharge_date || ''}
                  onChange={(v) => setForm((f) => ({ ...f, expected_discharge_date: v }))}
                  className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-amber-500 focus:outline-none"
                />
              </div>
            )}

            <div className="col-span-2">
              <label className="text-xs text-gray-500 mb-1 block">Admission Diagnosis</label>
              <input value={form.admission_diagnosis} onChange={e => setForm(f => ({ ...f, admission_diagnosis: e.target.value }))}
                className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-amber-500 focus:outline-none"
                placeholder="Primary diagnosis" />
            </div>

            <div className="col-span-2">
              <label className="text-xs text-gray-500 mb-1 block">Admission Notes</label>
              <textarea rows={4} value={form.admission_notes} onChange={e => setForm(f => ({ ...f, admission_notes: e.target.value }))}
                className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-amber-500 focus:outline-none resize-none"
                placeholder="Additional notes..." />
            </div>
          </div>

          <div className="flex items-center justify-end gap-3 pt-2">
            <button type="button" onClick={onClose}
              className="px-4 py-2 rounded-xl text-sm font-bold text-gray-600 bg-gray-100 hover:bg-gray-200">
              Cancel
            </button>
            <button type="submit" disabled={submitting}
              className="px-5 py-2.5 rounded-xl text-sm font-black text-white bg-amber-600 hover:bg-amber-700 disabled:opacity-60 disabled:cursor-not-allowed">
              {submitting ? 'Saving...' : 'Save Changes'}
            </button>
          </div>
        </form>
      </div>

      {showBedPicker && (
        <BedSelector onSelect={handleBedSelect} onClose={() => setShowBedPicker(false)} />
      )}
      {showPatientEditModal && admission.patient && (
        <PatientEditModal
          patientId={admission.patient}
          onClose={() => setShowPatientEditModal(false)}
          onSaved={() => {
            refreshPatientPreview()
            onSaved()
          }}
        />
      )}
    </div>
  )
}

function AddChargeModal({ admission, onClose }) {
  const [desc, setDesc] = useState('')
  const [amount, setAmount] = useState('')
  const [submitting, setSubmitting] = useState(false)

  async function handleAdd(e) {
    e.preventDefault()
    if (!desc || !amount) return
    setSubmitting(true)
    try {
      await api.post(`/ipd-admissions/${admission.id}/add-charge/`, {
        description: desc, amount
      })
      toast.success('Charge added successfully!')
      onClose()
    } catch { toast.error('Failed to add charge') }
    finally { setSubmitting(false) }
  }

  return (
    <div className="fixed inset-0 z-[400] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
      <div className="bg-white rounded-3xl shadow-xl w-full max-w-md overflow-hidden animate-in fade-in zoom-in duration-200">
        <div className="bg-blue-600 px-6 py-4 flex items-center justify-between text-white">
          <h3 className="font-bold">Add Service Charge</h3>
          <button onClick={onClose} className="hover:rotate-90 transition-transform"><X size={20} /></button>
        </div>
        <form onSubmit={handleAdd} className="p-6 space-y-4">
          <div>
            <div className="bg-blue-50 p-3 rounded-2xl mb-4 border border-blue-100">
              <p className="text-[10px] font-bold text-blue-400 uppercase">Patient</p>
              <p className="text-sm font-bold text-blue-900">{admission.patient_name}</p>
            </div>
            <label className="text-[11px] font-bold text-gray-400 uppercase ml-1">Service Description</label>
            <input value={desc} onChange={e => setDesc(e.target.value)} required placeholder="e.g. Surgery Fee, Nursing Charge..."
              className="w-full border rounded-xl p-3 text-sm focus:ring-2 focus:ring-blue-500 outline-none mt-1" />
          </div>
          <div>
            <label className="text-[11px] font-bold text-gray-400 uppercase ml-1">Amount (₹)</label>
            <input type="number" value={amount} onChange={e => setAmount(e.target.value)} required placeholder="0.00"
              className="w-full border rounded-xl p-3 text-sm focus:ring-2 focus:ring-blue-500 outline-none mt-1" />
          </div>
          <button type="submit" disabled={submitting}
            className="w-full py-4 bg-blue-600 text-white rounded-xl font-bold hover:bg-blue-700 transition-all flex items-center justify-center gap-2 shadow-lg shadow-blue-100 active:scale-95">
            {submitting ? 'Adding...' : <><Plus size={18} /> Confirm Charge</>}
          </button>
        </form>
      </div>
    </div>
  )
}

function AdmissionPaymentsModal({ admission, onClose }) {
  const [payments, setPayments] = useState([])
  const [loading, setLoading] = useState(true)
  const [amount, setAmount] = useState('')
  const [mode, setMode] = useState('cash')
  const [ref, setRef] = useState('')
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => { fetchPayments() }, [admission.id])

  async function fetchPayments() {
    setLoading(true)
    try {
      const { data } = await api.get(`/ipd-admissions/${admission.id}/payments/`)
      setPayments(data)
    } catch { toast.error('Failed to load payments') }
    finally { setLoading(false) }
  }

  async function handleAddAdvance(e) {
    e.preventDefault()
    const amountValue = parseMoneyInput(amount)
    if (!Number.isFinite(amountValue) || amountValue <= 0) {
      toast.error('Enter a valid amount greater than zero')
      return
    }
    const amountText = String(amountValue)
    setSubmitting(true)
    try {
      await api.post(`/ipd-admissions/${admission.id}/capture-advance/`, {
        amount: amountText, payment_mode: mode, reference: ref
      })
      toast.success('Advance captured successfully!')
      setAmount(''); setRef('')
      fetchPayments()
    } catch (err) { toast.error('Failed to capture advance') }
    finally { setSubmitting(false) }
  }

  const totalPaid = payments.reduce((sum, p) => sum + parseFloat(p.amount), 0)

  return (
    <div className="fixed inset-0 z-[400] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="bg-white rounded-3xl shadow-2xl w-full max-w-2xl overflow-hidden flex flex-col max-h-[90vh]">
        <div className="bg-gradient-to-r from-amber-500 to-orange-600 px-6 py-5 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-2xl bg-white/20 backdrop-blur-md flex items-center justify-center text-white">
              <IndianRupee size={24} strokeWidth={2.5} />
            </div>
            <div>
              <h3 className="text-white font-bold text-lg leading-tight">{admission.patient_name}</h3>
              <p className="text-amber-100 text-xs">IPD Payments & Advances · {admission.bed_code}</p>
            </div>
          </div>
          <button onClick={onClose} className="text-white/70 hover:text-white transition-colors">
            <XCircle size={26} strokeWidth={1.5} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 grid grid-cols-1 md:grid-cols-2 gap-8">
          {/* History Section */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-bold text-gray-800 flex items-center gap-2">
                <Clock size={16} className="text-amber-500" /> Payment History
              </h4>
              <span className="text-[10px] font-bold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-100 uppercase tracking-wider">
                Total Paid: ₹{totalPaid.toLocaleString()}
              </span>
            </div>

            <div className="space-y-2 pr-2 custom-scrollbar">
              {loading ? (
                <div className="py-10 text-center text-xs text-gray-400">Loading history...</div>
              ) : payments.length === 0 ? (
                <div className="py-12 bg-gray-50 rounded-2xl border-2 border-dashed border-gray-200 text-center">
                  <p className="text-xs text-gray-400">No payments recorded yet</p>
                </div>
              ) : (
                payments.map(p => (
                  <div key={p.id} className="bg-white border border-gray-100 rounded-xl p-3 shadow-sm flex items-center justify-between group hover:border-amber-200 transition-colors">
                    <div>
                      <p className="text-xs font-bold text-gray-800">₹{parseFloat(p.amount).toLocaleString()}</p>
                      <p className="text-[10px] text-gray-400">{format(new Date(p.created_at), withTimeTokens('dd MMM, HH:mm'))}</p>
                    </div>
                    <div className="text-right">
                      <span className="text-[10px] font-bold text-gray-500 uppercase px-1.5 py-0.5 bg-gray-50 rounded border border-gray-100">{p.payment_mode}</span>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* New Advance Section */}
          <div className="space-y-4">
            <h4 className="text-sm font-bold text-gray-800 flex items-center gap-2">
              <PlusCircle size={16} className="text-emerald-500" /> Record New Advance
            </h4>
            <form onSubmit={handleAddAdvance} className="bg-gray-50/50 rounded-2xl border border-gray-200 p-5 space-y-4">
              <div>
                <label className="text-[11px] font-bold text-gray-500 uppercase mb-1.5 block">Amount (₹) *</label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 font-bold">₹</span>
                  <input
                    type="text"
                    inputMode="decimal"
                    autoComplete="off"
                    value={amount}
                    onChange={e => {
                      const next = e.target.value
                      if (isAllowedMoneyInput(next)) setAmount(next)
                    }}
                    required
                    placeholder="0.00"
                    className="w-full pl-7 pr-4 py-2.5 bg-white border border-gray-200 rounded-xl text-sm font-bold focus:ring-2 focus:ring-emerald-500 focus:outline-none transition-all"
                  />
                </div>
              </div>

              <div>
                <label className="text-[11px] font-bold text-gray-500 uppercase mb-1.5 block">Payment Mode</label>
                <div className="grid grid-cols-3 gap-2">
                  {['cash', 'upi', 'card'].map(m => (
                    <button
                      key={m} type="button" onClick={() => setMode(m)}
                      className={`py-2 rounded-xl text-[10px] font-bold uppercase transition-all border ${
                        mode === m ? 'bg-emerald-600 border-emerald-600 text-white shadow-md' : 'bg-white border-gray-200 text-gray-500 hover:border-emerald-200'
                      }`}
                    >
                      {m}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="text-[11px] font-bold text-gray-500 uppercase mb-1.5 block">Reference / Remarks</label>
                <input
                  value={ref} onChange={e => setRef(e.target.value)}
                  placeholder="Txn ID, Cheque no, etc."
                  className="w-full px-4 py-2.5 bg-white border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-emerald-500 focus:outline-none transition-all"
                />
              </div>

              <button
                type="submit" disabled={submitting || !amount}
                className="w-full py-3 bg-emerald-600 text-white rounded-xl text-sm font-bold hover:bg-emerald-700 disabled:opacity-40 shadow-lg shadow-emerald-200 transition-all active:scale-[0.98] flex items-center justify-center gap-2"
              >
                <CheckCircle size={16} strokeWidth={2.5} />
                {submitting ? 'Processing...' : 'Confirm Payment'}
              </button>
            </form>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Emergency Cases ──────────────────────────────────────────────────────────
function EmergencySection() {
  const isMobile = useIsMobile()
  const [cases, setCases] = useState([])
  const [loading, setLoading] = useState(true)
  const [form, setForm] = useState({ patient_name: '', gender: '', contact: '', complaint: '', triage: 'yellow' })
  const [selectedCase, setSelectedCase] = useState(null)
  const [admitCase, setAdmitCase] = useState(null)
  const [doctors, setDoctors] = useState([])
  const [departments, setDepartments] = useState([])
  const [showBedPicker, setShowBedPicker] = useState(false)
  const [pickedBed, setPickedBed] = useState(null)
  const [admitting, setAdmitting] = useState(false)
  const [chargeCase, setChargeCase] = useState(null)
  const [charging, setCharging] = useState(false)
  const [admitForm, setAdmitForm] = useState({
    assigned_doctor: '',
    department: '',
    admission_diagnosis: '',
    admission_notes: '',
    auto_print_admit_slip: false,
  })
  const [chargeForm, setChargeForm] = useState({
    description: 'Emergency Consultation',
    amount: '',
    payment_mode: 'cash',
    auto_print: false,
  })
  const [autoPrintEmergencySlip, setAutoPrintEmergencySlip] = useState(true)

  useEffect(() => {
    loadCases()
    fetchDoctors()
    fetchDepartments()
  }, [])

  async function fetchDoctors() {
    try {
      const { data } = await api.get('/doctor-profiles/?limit=500')
      setDoctors(Array.isArray(data?.data) ? data.data : (data?.results || data || []))
    } catch {}
  }

  async function fetchDepartments() {
    try {
      const { data } = await api.get('/departments/?limit=500')
      setDepartments(Array.isArray(data?.data) ? data.data : (data?.results || data || []))
    } catch {}
  }

  async function loadCases() {
    setLoading(true)
    try {
      const { data } = await api.get('/emergency/cases/?limit=500')
      const rows = Array.isArray(data?.data) ? data.data : (data?.results || data || [])
      setCases(rows)
    } catch {
      toast.error('Failed to load emergency cases')
      setCases([])
    } finally {
      setLoading(false)
    }
  }

  async function addCase(e) {
    e.preventDefault()
    if (!form.gender) {
      toast.error('Please select patient gender')
      return
    }

    // Mobile: open the print tab synchronously in the click gesture (before the await) so the
    // browser doesn't block it. The slip HTML is handed over via localStorage after logging.
    let slipWindow = null
    if (autoPrintEmergencySlip && isMobileDevice()) {
      try { localStorage.removeItem('payment-slip-print-job') } catch { /* ignore */ }
      slipWindow = window.open('/print-slip?job=payment', '_blank')
    }

    try {
      const { data } = await api.post('/emergency/cases/', {
        patient_name: form.patient_name,
        gender: form.gender,
        contact: form.contact || '',
        complaint: form.complaint || '',
        triage: form.triage || 'yellow',
        status: 'waiting',
      })
      const entry = data?.data || data || {}
      setCases((prev) => [entry, ...prev])
      toast.success('Emergency case logged')
      if (autoPrintEmergencySlip) {
        printEmergencyCaseSlip(entry, slipWindow)
      } else if (slipWindow && !slipWindow.closed) {
        slipWindow.close()
      }
      setForm({ patient_name: '', gender: '', contact: '', complaint: '', triage: 'yellow' })
    } catch (err) {
      if (slipWindow && !slipWindow.closed) slipWindow.close()
      toast.error(err?.response?.data?.detail || 'Failed to log emergency case')
    }
  }

  async function updateStatus(id, status) {
    try {
      await api.patch(`/emergency/cases/${id}/`, { status })
      setCases((prev) => prev.map(c => c.id === id ? { ...c, status } : c))
    } catch {
      toast.error('Failed to update emergency status')
    }
  }

  function openChargeModal(c) {
    setChargeCase(c)
    setChargeForm({
      description: 'Emergency Consultation',
      amount: '',
      payment_mode: 'cash',
      auto_print: false,
    })
  }

  function printEmergencyReceipt({ invoiceNo, slipNumber, patientName, patientGender, patientUhid, patientPhone, description, amount, paymentMode }) {
    const w = createSameTabPrintWindow()
    const slipProfile = getPaymentSlipProfile()
    const address = escapeHtml(slipProfile.address || DEFAULT_PAYMENT_SLIP_PROFILE.address)
    const pinCode = escapeHtml(slipProfile.pin_code || DEFAULT_PAYMENT_SLIP_PROFILE.pin_code)
    const phone = escapeHtml(slipProfile.phone || DEFAULT_PAYMENT_SLIP_PROFILE.phone)
    const email = escapeHtml(slipProfile.email || DEFAULT_PAYMENT_SLIP_PROFILE.email)
    const website = escapeHtml(slipProfile.website || DEFAULT_PAYMENT_SLIP_PROFILE.website)
    const dateTimeStr = formatDateTime(new Date(), {})
    const upPatient = (patientName || 'PATIENT').toUpperCase()
    const payModeLabel =
      paymentMode === 'cash'
        ? 'Cash Payment'
        : paymentMode === 'card'
          ? 'Card Payment'
          : paymentMode === 'upi'
            ? 'UPI Payment'
            : (paymentMode || 'Payment').toUpperCase()
    const genderLabel = patientGender === 'female' ? 'Female' : patientGender === 'male' ? 'Male' : patientGender === 'other' ? 'Other' : ''
    const amountFixed = Number(amount || 0).toFixed(2)
    const logoUrl = resolvePaymentSlipLogoUrl(slipProfile)
    const profileLines = `<strong>${address}</strong><br/>
            Pincode: ${pinCode}<br/>
            Phone: ${phone}<br/>
            Email: ${email}${website ? `<br/>Website: ${website}` : ''}`

    w.document.write(`<!DOCTYPE html><html><head>
      <meta charset="utf-8"/>
      <title>Receipt — ${invoiceNo || 'Payment'}</title>
      <style>
        @page { size: A4 portrait; margin: 0; }
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { font-family: Arial, sans-serif; font-size: 11px; color: #111; width: 210mm; background: #fff; }
        .slip { width: 210mm; min-height: 148.5mm; padding: 6mm 8mm 4mm; display: flex; flex-direction: column; border-bottom: 2px dashed #aaa; }
        ${buildPaymentSlipHeaderCss()}
        .receipt-title { text-align: center; font-size: 13px; font-weight: 700; text-transform: uppercase; letter-spacing: 2px; border-bottom: 1px solid #111; padding-bottom: 2mm; margin-bottom: 2.5mm; }
        .info-grid { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 1.5mm 4mm; margin-bottom: 2.5mm; font-size: 10px; }
        .info-cell { display: flex; flex-direction: column; gap: 1px; }
        .info-label { color: #666; font-size: 9px; }
        .info-val { font-weight: 700; color: #111; }
        table { width: 100%; border-collapse: collapse; font-size: 10.5px; }
        thead tr { background: #1a6b3f; color: #fff; }
        th { padding: 3px 5px; font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: .5px; }
        th.c { text-align: center; width: 26px; }
        th.l { text-align: left; }
        th.r { text-align: right; width: 52px; }
        tbody tr { border-bottom: 1px solid #e5e7eb; }
        tbody tr:last-child { border-bottom: 1.5px solid #111; }
        td { padding: 3px 5px; }
        td.c { text-align: center; color: #555; }
        td.l { text-align: left; }
        td.r { text-align: right; font-weight: 600; }
        .totals { margin-left: auto; width: 160px; margin-top: 1mm; font-size: 10.5px; }
        .t-row { display: flex; justify-content: space-between; padding: 1px 5px; }
        .t-row.disc { color: #dc2626; }
        .t-row.final { font-weight: 800; font-size: 12px; border-top: 2px solid #111; padding-top: 2px; margin-top: 2px; color: #1a6b3f; }
        .footer { margin-top: auto; padding-top: 2mm; border-top: 1px dashed #aaa; display: flex; justify-content: space-between; align-items: flex-end; font-size: 9px; color: #555; }
        .note { max-width: 65%; line-height: 1.5; }
        .paid-box { border: 2px solid #1a6b3f; color: #1a6b3f; font-weight: 900; font-size: 13px; padding: 2px 10px; border-radius: 4px; letter-spacing: 2px; }
      </style>
    </head><body>
      <div class="slip">
        ${buildPaymentSlipTopHeaderHtml({
          hospitalName: slipProfile.hospital_name || DEFAULT_PAYMENT_SLIP_PROFILE.hospital_name,
          logoUrl,
          tagline: 'Healthcare &amp; Diagnostics',
          profileLines,
          escapeHtml,
        })}
        <div class="receipt-title">Receipt</div>
        <div class="info-grid">
          <div class="info-cell"><span class="info-label">Slip Number</span><span class="info-val">${slipNumber || '--'}</span></div>
          <div class="info-cell"><span class="info-label">Invoice Number</span><span class="info-val">${invoiceNo || '--'}</span></div>
          <div class="info-cell"><span class="info-label">Name</span><span class="info-val">${upPatient}</span></div>
          <div class="info-cell"><span class="info-label">Gender / Age</span><span class="info-val">${genderLabel || '—'}</span></div>
          <div class="info-cell"><span class="info-label">Pay Mode</span><span class="info-val">${payModeLabel}</span></div>
          <div class="info-cell"><span class="info-label">Mobile No.</span><span class="info-val">${patientPhone || '—'}</span></div>
          <div class="info-cell"><span class="info-label">Date</span><span class="info-val">${dateTimeStr}</span></div>
        </div>
        <table>
          <thead><tr><th class="c">SL No.</th><th class="l">Test Type / Service</th><th class="r">Amount</th></tr></thead>
          <tbody><tr><td class="c">1</td><td class="l">${description || 'Payment'}</td><td class="r">₹${amountFixed}</td></tr></tbody>
        </table>
        <div class="totals">
          <div class="t-row"><span>Total Amount:</span><span>₹${amountFixed}</span></div>
          <div class="t-row disc"><span>Discount:</span><span>₹0.00</span></div>
          <div class="t-row final"><span>Net Amount:</span><span>₹${amountFixed}</span></div>
        </div>
        <div class="footer">
          <div class="note"><strong>Note:</strong> Your reports will be preserved only for 6 months.<br/>Please retain this receipt for future reference.</div>
          <div class="paid-box">✓ PAID</div>
        </div>
      </div>
      ${PRINT_WINDOW_CLOSE_SCRIPT}
    </body></html>`)
    w.document.close()
  }

  /** ER registration / triage slip (no payment) — given to patient at triage. */
  function printEmergencyCaseSlip(c, targetWindow = null) {
    const esc = (s) =>
      String(s ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
    const isMobile = isMobileDevice()
    const slipProfile = getPaymentSlipProfile()
    const address = escapeHtml(slipProfile.address || DEFAULT_PAYMENT_SLIP_PROFILE.address)
    const pinCode = escapeHtml(slipProfile.pin_code || DEFAULT_PAYMENT_SLIP_PROFILE.pin_code)
    const phone = escapeHtml(slipProfile.phone || DEFAULT_PAYMENT_SLIP_PROFILE.phone)
    const email = escapeHtml(slipProfile.email || DEFAULT_PAYMENT_SLIP_PROFILE.email)
    const website = escapeHtml(slipProfile.website || DEFAULT_PAYMENT_SLIP_PROFILE.website)
    const arrived = c.arrived_at ? formatDateTime(c.arrived_at, {}) : formatDateTime(new Date(), {})
    const caseRef = `ER-${c.id}`
    const triageLabel =
      c.triage === 'red' ? 'CRITICAL (Red)' : c.triage === 'green' ? 'Minor (Green)' : 'Moderate (Yellow)'
    const patientUp = esc((c.patient_name || 'PATIENT').toUpperCase())
    const complaintEsc = esc(c.complaint || '—')
    const contactEsc = esc(c.contact || '—')
    const statusEsc = esc((c.status || 'waiting').replace(/_/g, ' ').toUpperCase())
    const logoUrl = resolvePaymentSlipLogoUrl(slipProfile)
    const profileLines = `<strong>${address}</strong><br/>
            Pincode: ${pinCode}<br/>
            Phone: ${phone}<br/>
            Email: ${email}${website ? `<br/>Website: ${website}` : ''}`

    const docHtml = `<!DOCTYPE html><html><head>
      <meta charset="utf-8"/>
      <title>Emergency Slip — ${caseRef}</title>
      <style>
        @page { size: A4 portrait; margin: 0; }
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { font-family: Arial, sans-serif; font-size: 11px; color: #111; width: 210mm; background: #fff; }
        .slip { width: 210mm; min-height: 148.5mm; padding: 6mm 8mm 4mm; display: flex; flex-direction: column; }
        ${buildPaymentSlipHeaderCss({ accentColor: '#b91c1c', topBorderColor: '#b91c1c' })}
        .er-badge { background: #b91c1c; color: #fff; font-weight: 900; font-size: 11px; padding: 4px 10px; border-radius: 4px; letter-spacing: 1px; }
        .slip-title { text-align: center; font-size: 14px; font-weight: 800; text-transform: uppercase; letter-spacing: 2px; border-bottom: 1px solid #111; padding-bottom: 2mm; margin-bottom: 3mm; color: #991b1b; }
        .info-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 2.5mm 5mm; margin-bottom: 3mm; font-size: 10.5px; }
        .info-cell { display: flex; flex-direction: column; gap: 2px; }
        .info-cell.full { grid-column: 1 / -1; }
        .info-label { color: #666; font-size: 9px; text-transform: uppercase; letter-spacing: 0.3px; }
        .info-val { font-weight: 700; color: #111; word-break: break-word; }
        .complaint-box { border: 1px solid #e5e7eb; border-radius: 6px; padding: 3mm; margin-top: 1mm; font-size: 10.5px; line-height: 1.45; min-height: 18mm; }
        .footer { margin-top: auto; padding-top: 3mm; border-top: 1px dashed #aaa; font-size: 9px; color: #555; line-height: 1.5; }
        .note-strong { color: #991b1b; font-weight: 700; }
      </style>
    </head><body>
      <div class="slip">
        ${buildPaymentSlipTopHeaderHtml({
          hospitalName: slipProfile.hospital_name || DEFAULT_PAYMENT_SLIP_PROFILE.hospital_name,
          logoUrl,
          tagline: 'Emergency &amp; Trauma',
          profileLines,
          leftExtraHtml: '<div style="margin-top:6px"><span class="er-badge">EMERGENCY</span></div>',
          escapeHtml,
        })}
        <div class="slip-title">Emergency registration slip</div>
        <div class="info-grid">
          <div class="info-cell"><span class="info-label">Case reference</span><span class="info-val">${caseRef}</span></div>
          <div class="info-cell"><span class="info-label">Date &amp; time</span><span class="info-val">${arrived}</span></div>
          <div class="info-cell"><span class="info-label">Patient name</span><span class="info-val">${patientUp}</span></div>
          <div class="info-cell"><span class="info-label">Contact</span><span class="info-val">${contactEsc}</span></div>
          <div class="info-cell"><span class="info-label">Triage category</span><span class="info-val">${triageLabel}</span></div>
          <div class="info-cell"><span class="info-label">Queue status</span><span class="info-val">${statusEsc}</span></div>
          <div class="info-cell full">
            <span class="info-label">Chief complaint</span>
            <div class="complaint-box">${complaintEsc}</div>
          </div>
        </div>
        <div class="footer">
          <p class="note-strong">Please keep this slip until you are seen by the doctor.</p>
          <p>Show this slip at billing if any emergency charges apply. This is not a payment receipt.</p>
        </div>
      </div>
      ${isMobile ? '' : PRINT_WINDOW_CLOSE_SCRIPT}
    </body></html>`

    // Mobile: render the slip on a real same-origin page (/print-slip?job=payment) so the Android
    // print dialog shows the content. The desktop close-script (about:blank replace on afterprint)
    // is omitted above because it blanks the live-rendered mobile print preview.
    if (isMobile) {
      const win = shouldUseDedicatedPrintDocument()
        ? null
        : ((targetWindow && !targetWindow.closed)
          ? targetWindow
          : window.open('/print-slip?job=payment', '_blank'))
      deliverMobilePrintHtml(docHtml, {
        targetWindow: win,
        storageKey: 'payment-slip-print-job',
      })
      return
    }

    const w = createSameTabPrintWindow()
    w.document.write(docHtml)
    w.document.close()
  }

  async function resolveEmergencyPatient(caseRow) {
    const digits = String(caseRow?.contact || '').replace(/\D/g, '').slice(-10)
    if (digits.length === 10) {
      try {
        const { data } = await api.get(`/patients/?search=${encodeURIComponent(digits)}&limit=10`)
        const rows = Array.isArray(data?.data) ? data.data : (data?.results || [])
        const exact = rows.find(p => String(p.phone || '').replace(/\D/g, '').slice(-10) === digits)
        if (exact?.id) return exact
      } catch {}
    }

    const parts = String(caseRow?.patient_name || 'Emergency Patient').trim().split(/\s+/)
    const payload = {
      first_name: parts[0] || 'Emergency',
      last_name: parts.slice(1).join(' ') || '',
      gender: caseRow?.gender || 'other',
      phone: digits || '',
    }
    const { data } = await api.post('/patients/', payload)
    return data?.data || data?.entity || data
  }

  async function saveChargeAndAttend(e) {
    e.preventDefault()
    if (!chargeCase) return
    const amount = parseFloat(chargeForm.amount)
    if (!amount || amount <= 0) {
      toast.error('Enter valid charge amount')
      return
    }

    setCharging(true)
    try {
      const patient = await resolveEmergencyPatient(chargeCase)
      if (!patient?.id) {
        toast.error('Could not resolve patient for payment slip')
        setCharging(false)
        return
      }

      const invoicePayload = {
        patient: patient.id,
        // Backend does not support "emergency" encounter_type; use OPD bucket for ER slips.
        encounter_type: 'opd',
        status: 'finalized',
        discount_amount: '0.00',
        items: [{
          description: chargeForm.description?.trim() || 'Emergency Service',
          quantity: 1,
          unit_price: amount,
        }],
      }
      const { data } = await api.post('/invoices/', invoicePayload)
      const inv = data?.data || data?.entity || data

      const paymentRes = await api.post('/payments/', {
        invoice: inv.id,
        payment_mode: chargeForm.payment_mode || 'cash',
        amount: amount.toFixed(2),
        status: 'success',
      })
      const payment = paymentRes?.data?.data || paymentRes?.data?.entity || paymentRes?.data

      const patchData = {
        status: 'attended',
        attended_at: new Date().toISOString(),
        charge_amount: amount.toFixed(2),
        charge_invoice_no: inv.invoice_no || '',
      }
      await api.patch(`/emergency/cases/${chargeCase.id}/`, patchData)
      setCases((prev) => prev.map(c => c.id === chargeCase.id ? { ...c, ...patchData } : c))

      if (chargeForm.auto_print) {
        printEmergencyReceipt({
          invoiceNo: inv.invoice_no,
          slipNumber: payment?.slip_number || '',
          patientName: [patient.first_name, patient.last_name].filter(Boolean).join(' '),
          patientGender: patient.gender,
          patientUhid: patient.uhid,
          patientPhone: patient.phone,
          description: chargeForm.description,
          amount,
          paymentMode: chargeForm.payment_mode,
        })
      }

      toast.success(`Payment slip generated: ${inv.invoice_no || 'Saved'}`)
      toast.success('Emergency case marked attended')
      setChargeCase(null)
    } catch (err) {
      toast.error(err?.response?.data?.detail || JSON.stringify(err?.response?.data) || 'Failed to generate payment slip')
    } finally {
      setCharging(false)
    }
  }

  function handleBedSelect(bedInfo) {
    setPickedBed(bedInfo)
  }

  function openAdmitModal(c) {
    setAdmitCase(c)
    setAdmitForm({
      assigned_doctor: '',
      department: '',
      admission_diagnosis: c.complaint || '',
      admission_notes: '',
      auto_print_admit_slip: false,
    })
    setPickedBed(null)
  }

  async function admitToIpd(e) {
    e.preventDefault()
    if (!admitCase) return
    if (!pickedBed?.bed_code) {
      toast.error('Select a bed first')
      return
    }
    if (!admitForm.department) {
      toast.error('Select department')
      return
    }

    // Mobile: open the print tab synchronously in the click gesture (before the awaits) so the
    // browser doesn't block it. The slip HTML is handed over via localStorage after admission.
    let admitSlipWindow = null
    if (admitForm.auto_print_admit_slip && isMobileDevice()) {
      try { localStorage.removeItem('payment-slip-print-job') } catch { /* ignore */ }
      admitSlipWindow = window.open('/print-slip?job=payment', '_blank')
    }

    setAdmitting(true)
    try {
      const digits = String(admitCase.contact || '').replace(/\D/g, '').slice(-10)
      let patientId = null
      let patientRecord = null

      if (digits.length === 10) {
        try {
          const { data } = await api.get(`/patients/?search=${encodeURIComponent(digits)}&limit=10`)
          const rows = Array.isArray(data?.data) ? data.data : (data?.results || [])
          const exact = rows.find(p => String(p.phone || '').replace(/\D/g, '').slice(-10) === digits)
          if (exact?.id) {
            patientId = exact.id
            patientRecord = exact
          }
        } catch {}
      }

      if (!patientId) {
        const parts = String(admitCase.patient_name || 'Emergency Patient').trim().split(/\s+/)
        const payload = {
          first_name: parts[0] || 'Emergency',
          last_name: parts.slice(1).join(' ') || '',
          gender: admitCase?.gender || 'other',
          phone: digits || '',
        }
        const { data } = await api.post('/patients/', payload)
        const created = data?.data || data?.entity || data
        patientId = created?.id
        patientRecord = created
      }

      if (!patientId) {
        if (admitSlipWindow && !admitSlipWindow.closed) admitSlipWindow.close()
        toast.error('Could not resolve patient for admission')
        setAdmitting(false)
        return
      }
      const diagnosis = admitForm.admission_diagnosis?.trim() || admitCase.complaint || 'Emergency admission'
      const notes = [
        admitForm.admission_notes?.trim(),
        `Emergency triage: ${(admitCase.triage || '').toUpperCase()}`,
        `Arrival: ${admitCase.arrived_at ? formatDateTime(admitCase.arrived_at) : 'N/A'}`,
        admitCase.complaint ? `Chief complaint: ${admitCase.complaint}` : '',
      ].filter(Boolean).join('\n')

      const { data } = await api.post('/ipd-admissions/', {
        patient: patientId,
        assigned_doctor: admitForm.assigned_doctor || null,
        department: admitForm.department,
        ward_name: pickedBed.ward_name,
        room_name: pickedBed.room_name,
        bed_code: pickedBed.bed_code,
        admission_date: format(new Date(), 'yyyy-MM-dd'),
        admission_time: format(new Date(), 'HH:mm'),
        admission_diagnosis: diagnosis,
        admission_notes: notes,
      })
      const admitted = data?.data || data?.entity || data

      if (admitForm.auto_print_admit_slip) {
        const doc = doctors.find(d => (d.user || d.id) === admitForm.assigned_doctor)
        printIpdAdmitSlip({
          ipdNo: admitted?.ipd_no,
          admissionDate: admitted?.admission_date || format(new Date(), 'yyyy-MM-dd'),
          patientName: [patientRecord?.first_name, patientRecord?.last_name].filter(Boolean).join(' ') || admitCase.patient_name,
          patientUhid: patientRecord?.uhid,
          patientPhone: patientRecord?.phone || admitCase.contact,
          doctorName: doc?.name || [doc?.first_name, doc?.last_name].filter(Boolean).join(' '),
          department: admitForm.department,
          wardName: pickedBed.ward_name,
          roomName: pickedBed.room_name,
          bedCode: pickedBed.bed_code,
          bedPrice: pickedBed?.daily_charge ? Number(pickedBed.daily_charge).toLocaleString('en-IN') : '--',
          diagnosis,
          notes,
          targetWindow: admitSlipWindow,
        })
      } else if (admitSlipWindow && !admitSlipWindow.closed) {
        admitSlipWindow.close()
      }

      const patchData = {
        status: 'admitted',
        admitted_at: new Date().toISOString(),
        admitted_bed: pickedBed.bed_code,
      }
      await api.patch(`/emergency/cases/${admitCase.id}/`, patchData)
      setCases((prev) => prev.map(c => c.id === admitCase.id ? { ...c, ...patchData } : c))

      toast.success('Emergency patient admitted to IPD')
      setAdmitCase(null)
      setPickedBed(null)
    } catch (err) {
      if (admitSlipWindow && !admitSlipWindow.closed) admitSlipWindow.close()
      const patientErr = err?.response?.data?.patient?.[0] || err?.response?.data?.errors?.patient?.[0]
      toast.error(patientErr || err?.response?.data?.detail || JSON.stringify(err?.response?.data) || 'Failed to admit patient')
    } finally {
      setAdmitting(false)
    }
  }

  const triageColors = {
    red: 'bg-red-100 text-red-700 border-red-200',
    yellow: 'bg-amber-100 text-amber-700 border-amber-200',
    green: 'bg-green-100 text-green-700 border-green-200',
  }

  const triageDot = { red: 'bg-red-500', yellow: 'bg-amber-400', green: 'bg-green-500' }

  const erFormSectionCls = isMobile
    ? 'rounded-xl border border-gray-200 bg-gray-50/60 p-3'
    : ''

  return (
    <div className={`${isMobile ? 'flex flex-col min-h-0 h-full overflow-hidden' : 'space-y-4'}`}>
      {isMobile ? (
        <div className="shrink-0 px-3 pt-2 pb-1 grid grid-cols-3 gap-2">
          {['red', 'yellow', 'green'].map((t) => (
            <div key={t} className={`rounded-xl p-2.5 border ${triageColors[t]}`}>
              <div className="flex items-center gap-1.5 mb-0.5">
                <div className={`w-2 h-2 rounded-full ${triageDot[t]}`} />
                <p className="text-[10px] font-bold capitalize truncate">{t === 'red' ? 'Critical' : t === 'yellow' ? 'Moderate' : 'Minor'}</p>
              </div>
              <p className="text-xl font-black tabular-nums">{cases.filter((c) => c.triage === t && c.status === 'waiting').length}</p>
            </div>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-3">
          {['red', 'yellow', 'green'].map(t => (
            <div key={t} className={`rounded-2xl p-4 border ${triageColors[t]}`}>
              <div className="flex items-center gap-2 mb-1">
                <div className={`w-2.5 h-2.5 rounded-full ${triageDot[t]}`} />
                <p className="text-xs font-bold capitalize">{t === 'red' ? 'Critical' : t === 'yellow' ? 'Moderate' : 'Minor'}</p>
              </div>
              <p className="text-2xl font-black">{cases.filter(c => c.triage === t && c.status === 'waiting').length}</p>
            </div>
          ))}
        </div>
      )}

      <form onSubmit={addCase} className={`bg-white shadow-sm border border-gray-100 shrink-0 ${isMobile ? 'rounded-none border-x-0 p-3 space-y-3' : 'rounded-2xl p-4'}`}>
        <h3 className="font-bold text-gray-800 mb-1 flex items-center gap-2">
          <AlertTriangle size={16} className="text-red-500" /> Log Emergency Case
        </h3>
        {isMobile ? (
          <div className="space-y-3">
            <div className={`${erFormSectionCls} grid grid-cols-2 gap-3`}>
              <div>
                <label className="text-xs text-gray-500 mb-1 block">Patient Name *</label>
                <input value={form.patient_name} onChange={e => setForm(f => ({ ...f, patient_name: e.target.value }))} required
                  placeholder="Patient name"
                  className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:ring-2 focus:ring-red-400 focus:outline-none bg-white" />
              </div>
              <div>
                <label className="text-xs text-gray-500 mb-1 block">Gender *</label>
                <select
                  value={form.gender}
                  onChange={e => setForm(f => ({ ...f, gender: e.target.value }))}
                  required
                  className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:ring-2 focus:ring-red-400 focus:outline-none bg-white"
                >
                  <option value="">Select</option>
                  <option value="male">Male</option>
                  <option value="female">Female</option>
                  <option value="other">Other</option>
                </select>
              </div>
            </div>
            <div className={`${erFormSectionCls} grid grid-cols-2 gap-3`}>
              <div>
                <label className="text-xs text-gray-500 mb-1 block">Contact</label>
                <input value={form.contact} onChange={e => setForm(f => ({ ...f, contact: e.target.value }))}
                  placeholder="Phone number"
                  className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:ring-2 focus:ring-red-400 focus:outline-none bg-white" />
              </div>
              <div>
                <label className="text-xs text-gray-500 mb-1 block">Triage Level</label>
                <select value={form.triage} onChange={e => setForm(f => ({ ...f, triage: e.target.value }))}
                  className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:ring-2 focus:ring-red-400 focus:outline-none bg-white">
                  <option value="red">🔴 Critical</option>
                  <option value="yellow">🟡 Moderate</option>
                  <option value="green">🟢 Minor</option>
                </select>
              </div>
            </div>
            <div className={erFormSectionCls}>
              <label className="text-xs text-gray-500 mb-1 block">Chief Complaint *</label>
              <input value={form.complaint} onChange={e => setForm(f => ({ ...f, complaint: e.target.value }))} required
                placeholder="Brief complaint description"
                className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:ring-2 focus:ring-red-400 focus:outline-none bg-white" />
            </div>
          </div>
        ) : (
        <div className="grid grid-cols-4 gap-3">
          <div>
            <label className="text-xs text-gray-500 mb-1 block">Patient Name *</label>
            <input value={form.patient_name} onChange={e => setForm(f => ({ ...f, patient_name: e.target.value }))} required
              placeholder="Enter patient name"
              className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-red-400 focus:outline-none" />
          </div>
          <div>
            <label className="text-xs text-gray-500 mb-1 block">Gender *</label>
            <select
              value={form.gender}
              onChange={e => setForm(f => ({ ...f, gender: e.target.value }))}
              required
              className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-red-400 focus:outline-none"
            >
              <option value="">Select gender</option>
              <option value="male">Male</option>
              <option value="female">Female</option>
              <option value="other">Other</option>
            </select>
          </div>
          <div>
            <label className="text-xs text-gray-500 mb-1 block">Contact</label>
            <input value={form.contact} onChange={e => setForm(f => ({ ...f, contact: e.target.value }))}
              placeholder="Phone number"
              className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-red-400 focus:outline-none" />
          </div>
          <div>
            <label className="text-xs text-gray-500 mb-1 block">Triage Level</label>
            <select value={form.triage} onChange={e => setForm(f => ({ ...f, triage: e.target.value }))}
              className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-red-400 focus:outline-none">
              <option value="red">🔴 Critical</option>
              <option value="yellow">🟡 Moderate</option>
              <option value="green">🟢 Minor</option>
            </select>
          </div>
          <div className="col-span-4">
            <label className="text-xs text-gray-500 mb-1 block">Chief Complaint *</label>
            <input value={form.complaint} onChange={e => setForm(f => ({ ...f, complaint: e.target.value }))} required
              placeholder="Brief complaint description"
              className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-red-400 focus:outline-none" />
          </div>
        </div>
        )}
        <label className={`flex items-center gap-2 text-sm text-gray-700 cursor-pointer select-none ${isMobile ? 'pt-1' : 'mt-3'}`}>
          <input
            type="checkbox"
            checked={autoPrintEmergencySlip}
            onChange={(e) => setAutoPrintEmergencySlip(e.target.checked)}
            className="rounded border-gray-300 text-red-600 focus:ring-red-500"
          />
          Print emergency registration slip after logging (A4 / browser print)
        </label>
        <button type="submit"
          className={`bg-red-600 text-white px-6 py-2.5 rounded-xl text-sm font-semibold hover:bg-red-700 flex items-center justify-center gap-2 w-full sm:w-auto ${isMobile ? 'mt-1' : 'mt-3'}`}>
          <AlertTriangle size={14} /> Log Case
        </button>
      </form>

      <div className={`bg-white shadow-sm border border-gray-100 overflow-hidden flex flex-col min-h-0 flex-1 ${isMobile ? 'rounded-none border-x-0' : 'rounded-2xl'}`}>
        <div className="px-4 py-3 border-b border-gray-100 shrink-0">
          <p className="text-sm font-semibold text-gray-700">Active Emergency Cases ({cases.filter(c => c.status === 'waiting').length})</p>
        </div>
        {isMobile ? (
          <MobileCardList>
            {cases.length === 0 ? (
              <div className="text-center py-8 text-gray-400 text-sm">No emergency cases</div>
            ) : (
              cases.map((c) => (
                <EmergencyCaseMobileCard
                  key={c.id}
                  caseRow={c}
                  triageLabel={c.triage === 'red' ? 'Critical' : c.triage === 'yellow' ? 'Moderate' : 'Minor'}
                  triageBadgeClass={triageColors[c.triage]}
                  triageDotClass={triageDot[c.triage]}
                  dateLabel={formatDateTime(c.arrived_at, { paren: true })}
                  isWaiting={c.status === 'waiting'}
                  onView={() => setSelectedCase(c)}
                  onPrint={() => printEmergencyCaseSlip(c)}
                  onAdmit={() => openAdmitModal(c)}
                  onAttend={() => openChargeModal(c)}
                />
              ))
            )}
          </MobileCardList>
        ) : (
          <div className="divide-y divide-gray-50 custom-scrollbar">
            {cases.length === 0 ? (
              <div className="text-center py-8 text-gray-400 text-sm">No emergency cases</div>
            ) : cases.map(c => (
              <div key={c.id} className="px-4 py-3 flex items-center gap-3">
              <div className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${triageDot[c.triage]}`} />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-gray-800">{c.patient_name}</p>
                <p className="text-xs text-gray-400">{c.complaint} · {formatDateTime(c.arrived_at, { paren: true })} · {c.contact || 'No contact'}</p>
              </div>
              <span className={`text-xs px-2 py-0.5 rounded-full font-medium border ${triageColors[c.triage]}`}>
                {c.triage === 'red' ? 'Critical' : c.triage === 'yellow' ? 'Moderate' : 'Minor'}
              </span>
              <button
                onClick={() => setSelectedCase(c)}
                className="text-xs bg-blue-100 text-blue-700 px-2 py-1 rounded-lg font-semibold hover:bg-blue-200"
              >
                View
              </button>
              <button
                type="button"
                onClick={() => printEmergencyCaseSlip(c)}
                className="text-xs bg-rose-50 text-rose-700 border border-rose-200 px-2 py-1 rounded-lg font-semibold hover:bg-rose-100 flex items-center gap-1"
                title="Print ER registration slip"
              >
                <Printer size={12} strokeWidth={2.5} /> Print slip
              </button>
              {c.status === 'waiting' && (
                <button
                  onClick={() => openAdmitModal(c)}
                  className="text-xs bg-indigo-100 text-indigo-700 px-2 py-1 rounded-lg font-semibold hover:bg-indigo-200"
                >
                  Admit to IPD
                </button>
              )}
              {c.status === 'waiting' ? (
                <button onClick={() => openChargeModal(c)}
                  className="text-xs bg-green-100 text-green-700 px-2 py-1 rounded-lg font-semibold hover:bg-green-200">
                  Mark Attended
                </button>
              ) : (
                <span className="text-xs bg-gray-100 text-gray-500 px-2 py-1 rounded-lg capitalize">{c.status}</span>
              )}
            </div>
          ))}
        </div>
        )}
      </div>

      {selectedCase && (
        <div className={`fixed inset-0 z-[300] flex bg-black/40 ${isMobile ? 'items-stretch p-0' : 'items-center justify-center p-4'}`} onClick={() => setSelectedCase(null)}>
          <div className={`bg-white shadow-2xl w-full overflow-hidden flex flex-col ${isMobile ? 'h-[100dvh] max-h-[100dvh] rounded-none' : 'max-w-lg rounded-2xl'}`} onClick={e => e.stopPropagation()}>
            <div className="px-4 py-3 sm:px-5 sm:py-4 bg-gradient-to-r from-red-500 to-rose-600 text-white flex items-center justify-between shrink-0">
              <div className="min-w-0">
                <p className="text-lg font-bold leading-tight truncate">{selectedCase.patient_name}</p>
                <p className="text-red-100 text-xs">Emergency Case Details</p>
              </div>
              <button onClick={() => setSelectedCase(null)} className="text-white/80 hover:text-white shrink-0 ml-2">
                <XCircle size={20} />
              </button>
            </div>
            <div className={`flex-1 min-h-0 overflow-y-auto ${isMobile ? 'p-3 space-y-3' : 'p-5'}`}>
              <div className={`grid grid-cols-2 gap-3 ${isMobile ? '' : ''}`}>
                <div className="rounded-xl border border-gray-200 bg-gray-50 p-3">
                  <p className="text-[11px] text-gray-400 uppercase">Contact</p>
                  <p className="text-sm font-semibold text-gray-800 mt-0.5">{selectedCase.contact || 'No contact'}</p>
                </div>
                <div className="rounded-xl border border-gray-200 bg-gray-50 p-3">
                  <p className="text-[11px] text-gray-400 uppercase">Gender</p>
                  <p className="text-sm font-semibold text-gray-800 capitalize mt-0.5">{selectedCase.gender || '—'}</p>
                </div>
                <div className="rounded-xl border border-gray-200 bg-gray-50 p-3">
                  <p className="text-[11px] text-gray-400 uppercase">Triage</p>
                  <p className={`text-sm font-semibold mt-0.5 ${selectedCase.triage === 'red' ? 'text-red-700' : selectedCase.triage === 'yellow' ? 'text-amber-700' : 'text-green-700'}`}>
                    {selectedCase.triage === 'red' ? 'Critical' : selectedCase.triage === 'yellow' ? 'Moderate' : 'Minor'}
                  </p>
                </div>
                <div className="rounded-xl border border-gray-200 bg-gray-50 p-3">
                  <p className="text-[11px] text-gray-400 uppercase">Status</p>
                  <p className="text-sm font-semibold text-gray-800 capitalize mt-0.5">{selectedCase.status || 'waiting'}</p>
                </div>
                <div className="rounded-xl border border-gray-200 bg-gray-50 p-3 col-span-2">
                  <p className="text-[11px] text-gray-400 uppercase">Chief Complaint</p>
                  <p className="text-sm font-semibold text-gray-800 mt-0.5 leading-relaxed">{selectedCase.complaint || '—'}</p>
                </div>
                <div className="rounded-xl border border-gray-200 bg-gray-50 p-3 col-span-2">
                  <p className="text-[11px] text-gray-400 uppercase">Arrived At</p>
                  <p className="text-sm font-semibold text-gray-800 mt-0.5">{selectedCase.arrived_at ? formatDateTime(selectedCase.arrived_at, { paren: true }) : '—'}</p>
                </div>
              </div>
            </div>
            <div className={`shrink-0 border-t border-gray-100 flex flex-wrap gap-2 ${isMobile ? 'p-3 bg-white/95 backdrop-blur-sm' : 'px-5 pb-4'}`}>
              <button onClick={() => setSelectedCase(null)} className="flex-1 min-w-[100px] py-2.5 rounded-xl border border-gray-200 text-sm text-gray-600 hover:bg-gray-50 font-medium">
                Close
              </button>
              <button
                type="button"
                onClick={() => printEmergencyCaseSlip(selectedCase)}
                className="flex-1 min-w-[120px] py-2.5 rounded-xl border border-rose-200 bg-rose-50 text-rose-800 text-sm font-semibold hover:bg-rose-100 flex items-center justify-center gap-1.5"
              >
                <Printer size={16} strokeWidth={2.5} /> Print ER slip
              </button>
              {selectedCase.status === 'waiting' && (
                <button
                  onClick={() => {
                    setSelectedCase(null)
                    openAdmitModal(selectedCase)
                  }}
                  className="flex-1 min-w-[120px] py-2.5 rounded-xl bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-700"
                >
                  Admit to IPD
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {admitCase && (
        <div className="fixed inset-0 z-[320] flex items-center justify-center p-4 bg-black/50" onClick={() => setAdmitCase(null)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl overflow-hidden" onClick={e => e.stopPropagation()}>
            <div className="px-5 py-4 bg-gradient-to-r from-indigo-600 to-blue-700 text-white flex items-center justify-between">
              <div>
                <p className="text-lg font-bold leading-tight">Admit Emergency Patient</p>
                <p className="text-indigo-100 text-xs">{admitCase.patient_name} · {admitCase.contact || 'No contact'}</p>
              </div>
              <button onClick={() => setAdmitCase(null)} className="text-white/80 hover:text-white">
                <XCircle size={20} />
              </button>
            </div>
            <form onSubmit={admitToIpd} className="p-5 space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-gray-500 mb-1 block">Assigned Doctor</label>
                  <select
                    value={admitForm.assigned_doctor}
                    onChange={e => setAdmitForm(f => ({ ...f, assigned_doctor: e.target.value }))}
                    className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                  >
                    <option value="">-- Select doctor --</option>
                    {doctors.map(d => (
                      <option key={d.user || d.id} value={d.user || d.id}>
                        {d.name || [d.first_name, d.last_name].filter(Boolean).join(' ') || d.user}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-xs text-gray-500 mb-1 block">Department *</label>
                  <select
                    value={admitForm.department}
                    onChange={e => setAdmitForm(f => ({ ...f, department: e.target.value }))}
                    className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                    required
                  >
                    <option value="">-- Select department --</option>
                    {departments.map(dep => (
                      <option key={dep.id} value={dep.name || dep.code || ''}>
                        {dep.name || dep.code}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-xs text-gray-500 mb-1 block">Admission Diagnosis</label>
                  <input
                    value={admitForm.admission_diagnosis}
                    onChange={e => setAdmitForm(f => ({ ...f, admission_diagnosis: e.target.value }))}
                    className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                    placeholder="Primary diagnosis"
                  />
                </div>
              </div>

              <div>
                <label className="text-xs text-gray-500 mb-1 block">Bed Assignment *</label>
                {pickedBed ? (
                  <div className="flex items-center gap-3 bg-indigo-50 border border-indigo-200 rounded-xl p-3">
                    <div className="w-9 h-9 rounded-lg bg-indigo-600 text-white flex items-center justify-center shrink-0">
                      <Bed size={16} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-bold text-gray-800">{getBedDisplayLabel(pickedBed, getReceptionOpdSettings().admission_bed_label_mode)} · {pickedBed.room_name}</p>
                      <p className="text-xs text-gray-500">{pickedBed.floor_name} · ₹{Number(pickedBed.daily_charge || 0).toLocaleString()}/day</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setShowBedPicker(true)}
                      className="text-xs bg-indigo-100 text-indigo-700 px-3 py-1.5 rounded-lg font-semibold hover:bg-indigo-200"
                    >
                      Change
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setShowBedPicker(true)}
                    className="w-full border-2 border-dashed border-indigo-300 bg-indigo-50/50 hover:bg-indigo-50 rounded-xl py-3 text-sm text-indigo-700 font-semibold"
                  >
                    Select Floor & Bed
                  </button>
                )}
              </div>

              <div>
                <label className="text-xs text-gray-500 mb-1 block">Admission Notes</label>
                <textarea
                  rows={3}
                  value={admitForm.admission_notes}
                  onChange={e => setAdmitForm(f => ({ ...f, admission_notes: e.target.value }))}
                  className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500 focus:outline-none resize-none"
                  placeholder="Additional admission notes..."
                />
              </div>
              <label className="flex items-center gap-2 text-sm text-gray-700 select-none">
                <input
                  type="checkbox"
                  checked={admitForm.auto_print_admit_slip}
                  onChange={e => setAdmitForm(f => ({ ...f, auto_print_admit_slip: e.target.checked }))}
                  className="w-4 h-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                />
                Print admit slip automatically
              </label>

              <div className="flex gap-2 pt-1">
                <button type="button" onClick={() => setAdmitCase(null)} className="flex-1 py-2 rounded-xl border border-gray-200 text-sm text-gray-600 hover:bg-gray-50 font-medium">
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={admitting || !admitForm.department || !pickedBed?.bed_code}
                  className="flex-1 py-2 rounded-xl bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {admitting ? 'Admitting…' : 'Admit to IPD'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showBedPicker && (
        <BedSelector
          onSelect={handleBedSelect}
          onClose={() => setShowBedPicker(false)}
          zIndexClass="z-[360]"
        />
      )}

      {chargeCase && (
        <div className="fixed inset-0 z-[330] flex items-center justify-center p-4 bg-black/50" onClick={() => setChargeCase(null)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden" onClick={e => e.stopPropagation()}>
            <div className="px-5 py-4 bg-gradient-to-r from-emerald-600 to-green-700 text-white flex items-center justify-between">
              <div>
                <p className="text-lg font-bold leading-tight">Mark Attended & Create Slip</p>
                <p className="text-emerald-100 text-xs">{chargeCase.patient_name}</p>
              </div>
              <button onClick={() => setChargeCase(null)} className="text-white/80 hover:text-white">
                <XCircle size={20} />
              </button>
            </div>
            <form onSubmit={saveChargeAndAttend} className="p-5 space-y-3">
              <div>
                <label className="text-xs text-gray-500 mb-1 block">Service Description</label>
                <input
                  value={chargeForm.description}
                  onChange={e => setChargeForm(f => ({ ...f, description: e.target.value }))}
                  className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-emerald-500 focus:outline-none"
                  placeholder="Emergency Consultation"
                />
              </div>
              <div>
                <label className="text-xs text-gray-500 mb-1 block">Charge Amount (INR) *</label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={chargeForm.amount}
                  onChange={e => setChargeForm(f => ({ ...f, amount: e.target.value }))}
                  className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-emerald-500 focus:outline-none"
                  placeholder="Enter amount"
                  required
                />
              </div>
              <div>
                <label className="text-xs text-gray-500 mb-1 block">Payment Mode</label>
                <select
                  value={chargeForm.payment_mode}
                  onChange={e => setChargeForm(f => ({ ...f, payment_mode: e.target.value }))}
                  className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-emerald-500 focus:outline-none"
                >
                  <option value="cash">Cash</option>
                  <option value="upi">UPI</option>
                  <option value="card">Card</option>
                  <option value="other">Other</option>
                </select>
              </div>
              <label className="flex items-center gap-2 text-sm text-gray-700 select-none">
                <input
                  type="checkbox"
                  checked={chargeForm.auto_print}
                  onChange={e => setChargeForm(f => ({ ...f, auto_print: e.target.checked }))}
                  className="w-4 h-4 rounded border-gray-300 text-emerald-600 focus:ring-emerald-500"
                />
                Print slip automatically after attending
              </label>
              <div className="flex gap-2 pt-1">
                <button type="button" onClick={() => setChargeCase(null)} className="flex-1 py-2 rounded-xl border border-gray-200 text-sm text-gray-600 hover:bg-gray-50 font-medium">
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={charging}
                  className="flex-1 py-2 rounded-xl bg-emerald-600 text-white text-sm font-semibold hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {charging ? 'Saving…' : 'Create Slip & Attend'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── OPD Receipt Print ────────────────────────────────────────────────────────
function PrintOpdReceipt({ visit, patient, onClose }) {
  const slipProfile = getPaymentSlipProfile()
  const logoUrl = resolvePaymentSlipLogoUrl(slipProfile)
  const hospitalName = (slipProfile.hospital_name || DEFAULT_PAYMENT_SLIP_PROFILE.hospital_name).toUpperCase()
  const address = slipProfile.address || DEFAULT_PAYMENT_SLIP_PROFILE.address
  const phone = slipProfile.phone || DEFAULT_PAYMENT_SLIP_PROFILE.phone
  const now = formatDateTime(new Date(), { paren: true })
  const patientName = [patient?.first_name, patient?.last_name].filter(Boolean).join(' ') || patient?.uhid || '—'
  const visitDateDisplay =
    visit.visit_date
      ? `${format(new Date(visit.visit_date), 'dd/MM/yyyy')}${
          visit.created_at ? ` ${formatTime(visit.created_at)}` : ''
        }`
      : '—'

  useEffect(() => {
    let cancelled = false
    const runPrint = () => {
      if (!cancelled) triggerHMSPrint()
    }
    const schedulePrint = () => {
      if (!logoUrl) {
        runPrint()
        return
      }
      const img = document.querySelector('#__opd_receipt_root .hosp-logo-print')
      if (!img || img.complete) {
        runPrint()
        return
      }
      img.onload = runPrint
      img.onerror = runPrint
    }
    const t = setTimeout(schedulePrint, 800)
    function after() { schedulePrintCleanup(onClose) }
    window.addEventListener('afterprint', after)
    return () => { cancelled = true; clearTimeout(t); window.removeEventListener('afterprint', after) }
  }, [logoUrl, onClose])

  const content = (
    <div id="__opd_receipt_root" className="fixed inset-0 z-[700] bg-white overflow-y-auto print:static print:h-auto print:overflow-visible">
      <div className="flex justify-end p-4 print:hidden">
        <button onClick={onClose} className="bg-gray-100 hover:bg-gray-200 text-gray-700 px-5 py-2 rounded-xl font-bold text-sm">✕ Close</button>
      </div>
      
      <div className="shadow-2xl print:shadow-none" style={{ width: '210mm', minHeight: '148.5mm', margin: '0 auto', background: '#fff', color: '#111', fontFamily: 'Arial, sans-serif', padding: '10mm 12mm', boxSizing: 'border-box', display: 'flex', flexDirection: 'column', borderBottom: '2px dashed #aaa' }}>
        
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', borderBottom: '2px solid #111', paddingBottom: '3mm', marginBottom: '4mm' }}>
           <div style={{ display: 'flex', alignItems: 'center', gap: '3mm', minWidth: 0 }}>
             {logoUrl ? (
               <img
                 src={logoUrl}
                 alt=""
                 className="hosp-logo-print"
                 style={{ height: '14mm', maxWidth: '28mm', objectFit: 'contain', flexShrink: 0 }}
               />
             ) : null}
             <div style={{ minWidth: 0 }}>
               <p style={{ fontSize: 24, fontWeight: 900, color: '#1a6b3f', margin: 0 }}>{hospitalName}</p>
               <p style={{ fontSize: 9, color: '#555', letterSpacing: 1, textTransform: 'uppercase', fontWeight: 700 }}>OPD Consultation Receipt</p>
             </div>
           </div>
           <div style={{ textAlign: 'right', fontSize: 10, color: '#333' }}>
             <p><strong>{address}</strong></p>
             <p>Contact: {phone}</p>
             <p style={{ marginTop: 2, fontWeight: 700 }}>{now}</p>
           </div>
        </div>

        <p style={{ textAlign: 'center', fontSize: 13, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 2, borderBottom: '1px solid #111', paddingBottom: '2mm', marginBottom: '4mm' }}>Payment Receipt</p>

        {/* Info Grid */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '2mm 5mm', marginBottom: '4mm', fontSize: '11px' }}>
          {[
            ['Patient Name', patientName.toUpperCase()],
            ['UHID', patient?.uhid || '—'],
            ['Token No', visit.queue_number || '—'],
            ['Consultant', visit.doctor_name || '—'],
            ['Visit Date', visitDateDisplay],
            ['Payment Mode', (visit.payment_mode || '—').toUpperCase()],
          ].map(([l, v]) => (
            <div key={l}>
              <p style={{ color: '#666', fontSize: '9px', marginBottom: 1 }}>{l}</p>
              <p style={{ fontWeight: 700 }}>{v}</p>
            </div>
          ))}
        </div>

        {/* Table */}
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '11px' }}>
          <thead>
            <tr style={{ background: '#1a6b3f', color: '#fff' }}>
              <th style={{ padding: '6px 10px', textAlign: 'left', textTransform: 'uppercase' }}>Description</th>
              <th style={{ padding: '6px 10px', textAlign: 'right', textTransform: 'uppercase', width: '30%' }}>Amount (₹)</th>
            </tr>
          </thead>
          <tbody>
            <tr style={{ borderBottom: '1.5px solid #111' }}>
              <td style={{ padding: '10px' }}>OPD Consultation & Registration Charges</td>
              <td style={{ padding: '10px', textAlign: 'right', fontWeight: 700 }}>{parseFloat(visit.amount || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
            </tr>
          </tbody>
          <tfoot>
            <tr style={{ background: '#f0fdf4' }}>
              <td style={{ padding: '8px 10px', fontWeight: 800 }}>TOTAL PAID</td>
              <td style={{ padding: '8px 10px', textAlign: 'right', fontWeight: 900, fontSize: 14, color: '#16a34a' }}>₹ {parseFloat(visit.amount || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
            </tr>
          </tfoot>
        </table>

        {/* Signatures */}
        <div style={{ marginTop: 'auto', display: 'flex', justifyContent: 'space-between', paddingTop: '5mm' }}>
           <div style={{ textAlign: 'center', width: '35%' }}>
             <div style={{ borderTop: '1px solid #111', paddingTop: 4, fontSize: 10, fontWeight: 700 }}>Patient / Guardian</div>
           </div>
           <div style={{ textAlign: 'center', width: '35%' }}>
             <div style={{ borderTop: '1px solid #111', paddingTop: 4, fontSize: 10, fontWeight: 700 }}>Authorized Signatory</div>
           </div>
        </div>
      </div>
      
      <style>{`
        @media print {
          @page { size: A4 portrait; margin: 0; }
          body, html { background: #fff !important; height: auto !important; overflow: visible !important; }
          body > *:not(#__opd_receipt_root) { display: none !important; }
          #__opd_receipt_root { 
            position: static !important; display: block !important; overflow: visible !important; 
            height: auto !important; padding: 0 !important; margin: 0 !important;
          }
          .print\\:hidden { display: none !important; }
        }
      `}</style>
    </div>
  )
  return createPortal(content, document.body)
}

// ─── Patient List ─────────────────────────────────────────────────────────────
function PatientLifetimeTimelineModal({ patient, onClose }) {
  const [loading, setLoading] = useState(false)
  const [data, setData] = useState(null)
  const [ledgerByAdmission, setLedgerByAdmission] = useState({})
  const [loadingLedger, setLoadingLedger] = useState({})
  const [expandedAdmissions, setExpandedAdmissions] = useState({})
  const [expandedOpds, setExpandedOpds] = useState({})
  const [expandedSubs, setExpandedSubs] = useState({}) // { [admId_section]: bool }
  const [printTarget, setPrintTarget] = useState(null)
  const [tlPayCancel, setTlPayCancel] = useState(null)
  const [tlPayCancelReason, setTlPayCancelReason] = useState('')
  const [tlPayCancelling, setTlPayCancelling] = useState(false)
  const [tlPayEdit, setTlPayEdit] = useState(null)
  const [tlPaySaving, setTlPaySaving] = useState(false)

  const fullName = [patient?.first_name, patient?.last_name].filter(Boolean).join(' ') || patient?.uhid || 'Patient'

  useEffect(() => {
    let cancelled = false
    async function fetchTimeline() {
      if (!patient?.uhid) {
        toast.error('UHID not available for this patient')
        return
      }
      setLoading(true)
      setLedgerByAdmission({})
      try {
        const { data: payload } = await api.get(`/patients/lifetime-timeline/?uhid=${encodeURIComponent(patient.uhid)}`)
        if (!cancelled) setData(payload?.data || payload)
      } catch {
        if (!cancelled) {
          toast.error('Failed to load patient timeline')
          setData(null)
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    fetchTimeline()
    return () => { cancelled = true }
  }, [patient?.uhid])

  async function loadLedger(admissionId) {
    if (!admissionId || ledgerByAdmission[admissionId] || loadingLedger[admissionId]) return
    setLoadingLedger(prev => ({ ...prev, [admissionId]: true }))
    try {
      const { data: payload } = await api.get(`/ipd-admissions/${admissionId}/ledger/`)
      setLedgerByAdmission(prev => ({ ...prev, [admissionId]: payload }))
    } catch { toast.error('Failed to load IPD ledger') }
    finally { setLoadingLedger(prev => ({ ...prev, [admissionId]: false })) }
  }

  async function reloadLedgerAdmission(admissionId) {
    if (!admissionId) return
    setLoadingLedger(prev => ({ ...prev, [admissionId]: true }))
    try {
      const { data: payload } = await api.get(`/ipd-admissions/${admissionId}/ledger/`)
      setLedgerByAdmission(prev => ({ ...prev, [admissionId]: payload }))
    } catch {
      toast.error('Failed to refresh IPD ledger')
    } finally {
      setLoadingLedger(prev => ({ ...prev, [admissionId]: false }))
    }
  }

  async function openTimelineLedgerEditPayment(admissionId, paymentId) {
    if (!paymentId) return
    setTlPaySaving(true)
    try {
      const { data } = await api.get(`/payments/${paymentId}/`)
      const row = data?.data || data
      setTlPayEdit({ ...row, admissionId, paid_at: toDateTimeInputValue(row.paid_at) })
    } catch {
      toast.error('Failed to load payment')
    } finally {
      setTlPaySaving(false)
    }
  }

  async function submitTlPayCancel() {
    if (!tlPayCancel?.paymentTransactionId) return
    const reason = tlPayCancelReason.trim()
    if (!reason) {
      toast.error('Please enter cancellation reason')
      return
    }
    setTlPayCancelling(true)
    try {
      const ref = `CANCEL:${reason}`.slice(0, 120)
      await api.patch(`/payments/${tlPayCancel.paymentTransactionId}/`, {
        status: 'cancelled',
        transaction_reference: ref,
      })
      toast.success('Payment receipt cancelled')
      const admId = tlPayCancel.admissionId
      setTlPayCancel(null)
      setTlPayCancelReason('')
      await reloadLedgerAdmission(admId)
    } catch (err) {
      toast.error(formatApiError(err, 'Failed to cancel payment'))
    } finally {
      setTlPayCancelling(false)
    }
  }

  async function handleTlPayEditSave(e) {
    e.preventDefault()
    if (!tlPayEdit?.id) return
    const admId = tlPayEdit.admissionId
    setTlPaySaving(true)
    try {
      await api.patch(`/payments/${tlPayEdit.id}/`, {
        payment_mode: tlPayEdit.payment_mode || 'cash',
        amount: tlPayEdit.amount || 0,
        transaction_reference: tlPayEdit.transaction_reference || '',
        receipt_no: tlPayEdit.receipt_no || '',
        status: tlPayEdit.status || 'success',
        paid_at: tlPayEdit.paid_at || null,
      })
      toast.success('Payment slip updated!')
      setTlPayEdit(null)
      await reloadLedgerAdmission(admId)
    } catch (err) {
      toast.error(formatApiError(err, 'Failed to update payment slip'))
    } finally {
      setTlPaySaving(false)
    }
  }

  function toggleAdmission(id) {
    setExpandedAdmissions(prev => ({ ...prev, [id]: !prev[id] }))
    if (!ledgerByAdmission[id]) loadLedger(id)
  }

  function toggleOpd(id) { setExpandedOpds(prev => ({ ...prev, [id]: !prev[id] })) }

  const fmt = (d) => d ? format(new Date(d), 'dd/MM/yyyy') : '—'
  const fmtM = (v) => Number(v || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })
  const sBadge = (s) => ({ admitted: 'bg-blue-100 text-blue-700', discharged: 'bg-emerald-100 text-emerald-700', cancelled: 'bg-red-100 text-red-700', completed: 'bg-emerald-100 text-emerald-700', pending: 'bg-amber-100 text-amber-700' }[s?.toLowerCase()] || 'bg-gray-100 text-gray-600')

  return (
    <>
    <div className="fixed inset-0 z-[320] flex items-center justify-center p-3 bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-gray-50 rounded-2xl shadow-2xl w-full max-w-4xl max-h-[93vh] overflow-hidden flex flex-col" onClick={e => e.stopPropagation()}>

        {/* ── Header ── */}
        <div className="bg-gradient-to-r from-violet-600 via-indigo-600 to-blue-600 px-5 py-4 flex items-center gap-3 shrink-0">
          <div className="w-10 h-10 rounded-full bg-white/20 flex items-center justify-center text-white font-black text-lg shrink-0">
            {(fullName[0] || '?').toUpperCase()}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-white font-black text-base leading-tight truncate">{fullName}</p>
            <p className="text-indigo-200 text-xs font-mono">{patient?.uhid} · Patient Lifetime Timeline</p>
          </div>
          <button onClick={onClose} className="text-white/70 hover:text-white transition-colors shrink-0"><XCircle size={22} /></button>
        </div>

        {/* ── Body ── */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {loading ? (
            <div className="flex flex-col items-center justify-center py-20 gap-3">
              <span className="w-8 h-8 border-[3px] border-indigo-500 border-t-transparent rounded-full animate-spin" />
              <p className="text-sm text-gray-400 font-medium">Loading timeline…</p>
            </div>
          ) : !data ? (
            <div className="text-center py-20 text-gray-400 text-sm">No timeline data found.</div>
          ) : (<>

            {/* Patient Profile Card */}
            <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
              <div className="flex items-center gap-2 px-4 py-3 bg-gradient-to-r from-gray-50 to-slate-50 border-b border-gray-100">
                <div className="w-6 h-6 rounded-full bg-slate-600 flex items-center justify-center shrink-0"><User size={13} className="text-white" /></div>
                <p className="font-black text-slate-800 text-sm">Patient Profile Details</p>
              </div>
              <div className="p-4 grid grid-cols-2 sm:grid-cols-4 gap-4 text-xs">
                {[
                  ['Full Name', fullName],
                  ['UHID', data.patient?.uhid],
                  ['Gender', data.patient?.gender],
                  ['Age / DOB', `${data.patient?.age || '—'} yrs (${data.patient?.dob ? format(new Date(data.patient.dob), 'dd/MM/yyyy') : '—'})`],
                  ['Phone', data.patient?.phone],
                  ['Email', data.patient?.email],
                  ['Blood Group', data.patient?.blood_group],
                  ['Guardian', data.patient?.guardian_name],
                  ['Address', [data.patient?.address_line1, data.patient?.city, data.patient?.state].filter(Boolean).join(', ')],
                  ['Patient Type', data.patient?.patient_type],
                  ['Registration', data.patient?.created_at ? format(new Date(data.patient.created_at), 'dd/MM/yyyy') : '—'],
                  ['Status', data.patient?.status]
                ].map(([l, v]) => (
                  <div key={l}>
                    <p className="text-gray-400 font-semibold uppercase tracking-wider text-[10px] mb-0.5">{l}</p>
                    <p className="font-bold text-gray-800 break-words">{v || '—'}</p>
                  </div>
                ))}
              </div>
            </div>

            {/* ── OPD History ── */}
            <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
              <div className="flex items-center gap-2 px-4 py-3 bg-gradient-to-r from-emerald-50 to-teal-50 border-b border-emerald-100">
                <div className="w-6 h-6 rounded-full bg-emerald-500 flex items-center justify-center shrink-0"><ClipboardList size={13} className="text-white" /></div>
                <p className="font-black text-emerald-800 text-sm">OPD History</p>
                <span className="ml-auto text-[11px] font-bold text-emerald-600 bg-emerald-100 px-2 py-0.5 rounded-full">{(data.opd_visits||[]).length} visits</span>
              </div>
              <div className="divide-y divide-gray-50">
                {(data.opd_visits||[]).length === 0 ? (
                  <p className="text-xs text-gray-400 text-center py-8">No OPD visits recorded.</p>
                ) : (data.opd_visits||[]).map(v => {
                  const open = expandedOpds[v.id]
                  return (
                    <div key={v.id}>
                      <button type="button" onClick={() => toggleOpd(v.id)}
                        className="w-full flex items-center gap-3 px-4 py-3 hover:bg-emerald-50/60 transition-colors text-left group">
                        <div className="w-9 h-9 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center shrink-0 text-xs font-black border border-emerald-200">{v.queue_number || '—'}</div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-bold text-gray-800 group-hover:text-emerald-700 transition-colors">{fmt(v.visit_date)}</p>
                          <p className="text-xs text-gray-500 truncate">{v.visit_reason || 'OPD Visit'} · Dr. {v.doctor_name || '—'}</p>
                        </div>
                        <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold capitalize shrink-0 ${sBadge(v.status)}`}>{v.status}</span>
                        {v.amount && <span className="text-xs font-bold text-gray-700 shrink-0 bg-gray-100 px-2 py-0.5 rounded-lg">₹{fmtM(v.amount)}</span>}
                        <ChevronDown size={14} className={`text-gray-400 shrink-0 transition-transform duration-200 ${open ? 'rotate-180':''}`} />
                      </button>
                      {open && (
                        <div className="px-4 pb-4 pt-1 bg-emerald-50/30 space-y-3">
                          <div className="grid grid-cols-3 gap-2 text-xs">
                            {[['Token No.',v.queue_number||'—'],['Doctor',v.doctor_name||'—'],['Diagnosis',v.diagnosis||'—'],['Visit Reason',v.visit_reason||'—'],['Payment Mode',(v.payment_mode||'—').toUpperCase()],['Amount Paid',v.amount?`₹${fmtM(v.amount)}`:'₹0.00']].map(([l,val]) => (
                              <div key={l} className="bg-white rounded-lg px-3 py-2 border border-gray-100">
                                <p className="text-gray-400 text-[10px] uppercase font-semibold tracking-wide">{l}</p>
                                <p className="font-bold text-gray-800 truncate mt-0.5">{val}</p>
                              </div>
                            ))}
                          </div>
                          <div className="flex gap-2">
                            {v.amount && (
                              <button type="button" onClick={() => setPrintTarget({ type:'opd_receipt', visit: { ...v, patient_name: [patient?.first_name, patient?.last_name].filter(Boolean).join(' ') || patient?.uhid } })}
                                className="flex items-center gap-1.5 text-[10px] bg-emerald-600 text-white px-3 py-1.5 rounded-lg font-bold hover:bg-emerald-700 transition-colors shadow-sm">
                                <Printer size={11} /> Receipt
                              </button>
                            )}
                            <button type="button" 
                              onClick={() => setPrintTarget({ 
                                type:'opd_slip', 
                                visit: { 
                                  ...v, 
                                  doc_name: v.doctor_name,
                                  patient_name: [patient?.first_name, patient?.last_name].filter(Boolean).join(' ') || patient?.uhid,
                                  patient_uhid: patient?.uhid,
                                  patient_age: patient?.age_value ?? patient?.age,
                                  patient_age_unit: patient?.age_unit || 'years',
                                  patient_gender: patient?.gender,
                                  patient_address: patient?.address,
                                  patient_guardian_name: patient?.guardian_name
                                } 
                              })}
                              className="flex items-center gap-1.5 text-[10px] bg-blue-600 text-white px-3 py-1.5 rounded-lg font-bold hover:bg-blue-700 transition-colors shadow-sm">
                              <Printer size={11} /> Print OPD Slip
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>

            {/* ── IPD History ── */}
            <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
              <div className="flex items-center gap-2 px-4 py-3 bg-gradient-to-r from-blue-50 to-indigo-50 border-b border-blue-100">
                <div className="w-6 h-6 rounded-full bg-blue-500 flex items-center justify-center shrink-0"><Bed size={13} className="text-white" /></div>
                <p className="font-black text-blue-800 text-sm">IPD Admissions</p>
                <span className="ml-auto text-[11px] font-bold text-blue-600 bg-blue-100 px-2 py-0.5 rounded-full">{(data.ipd_admissions||[]).length} admissions</span>
              </div>
              <div className="divide-y divide-gray-50">
                {(data.ipd_admissions||[]).length === 0 ? (
                  <p className="text-xs text-gray-400 text-center py-8">No IPD admissions recorded.</p>
                ) : (data.ipd_admissions||[]).map(a => {
                  const open = expandedAdmissions[a.id]
                  const ledger = ledgerByAdmission[a.id]
                  const isLL = loadingLedger[a.id]
                  const balVal = parseFloat(ledger?.balance_due || 0)
                  const isDischarged = a.status === 'discharged'
                  const admObj = { patient_name:fullName, patient_uhid:patient?.uhid, assigned_doctor_name:a.assigned_doctor_name, ward_name:a.ward_name, room_name:a.room_name, bed_code:a.bed_code, admission_date:a.admission_date, created_at:a.created_at, ipd_no:a.id, admission_diagnosis:a.admission_diagnosis }
                  return (
                    <div key={a.id}>
                      {/* Admission row */}
                      <button type="button" onClick={() => toggleAdmission(a.id)}
                        className="w-full flex items-center gap-3 px-4 py-3 hover:bg-blue-50/60 transition-colors text-left group">
                        <div className="w-9 h-9 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center shrink-0 border border-blue-200"><Bed size={15} /></div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-bold text-gray-800 group-hover:text-blue-700 transition-colors">
                            Admitted {fmt(a.admission_date)}{isDischarged && a.discharged_at ? ` → Discharged ${fmt(a.discharged_at)}` : ''}
                          </p>
                          <p className="text-xs text-gray-500 truncate">{a.department||'—'} · {a.ward_name||'—'} · Bed {a.bed_code||'—'} · Dr. {a.assigned_doctor_name||'—'}</p>
                        </div>
                        <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold capitalize shrink-0 ${sBadge(a.status)}`}>{a.status}</span>
                        {isLL && <span className="w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin shrink-0" />}
                        <ChevronDown size={14} className={`text-gray-400 shrink-0 transition-transform duration-200 ${open?'rotate-180':''}`} />
                      </button>

                      {open && (
                        <div className="px-4 pb-5 pt-2 space-y-4 bg-blue-50/20">
                          {/* Admission details grid */}
                          <div className="grid grid-cols-3 gap-2 text-xs">
                            {[['Department',a.department||'—'],['Ward / Bed',`${a.ward_name||'—'} / ${a.bed_code||'—'}`],['Doctor',a.assigned_doctor_name||'—'],['Diagnosis',a.admission_diagnosis||'—'],['Admitted',fmt(a.admission_date)],['Discharged',isDischarged&&a.discharged_at?fmt(a.discharged_at):'Still Admitted']].map(([l,val])=>(
                              <div key={l} className="bg-white rounded-lg px-3 py-2 border border-gray-100">
                                <p className="text-gray-400 text-[10px] uppercase font-semibold tracking-wide">{l}</p>
                                <p className="font-bold text-gray-800 truncate mt-0.5">{val}</p>
                              </div>
                            ))}
                          </div>

                          {/* ── IPD Process Logs (from lifetime timeline) ── */}
                          {(() => {
                            const processLogsWithMeta = (a.process_logs || [])
                              .map((log) => {
                                const config = resolveLogProcessConfig(log, getIpdProcessTemplates())
                                return {
                                  log,
                                  config,
                                  completion: getProcessCompletionMeta(log, config),
                                }
                              })
                              .filter(({ completion }) => completion.percent >= 1)
                            if (processLogsWithMeta.length === 0) return null
                            const subKey = `${a.id}_process`
                            const subOpen = expandedSubs[subKey]
                            return (
                              <div className="border border-violet-200 rounded-xl overflow-hidden bg-white">
                                <button type="button" onClick={() => setExpandedSubs(prev=>({...prev,[subKey]:!prev[subKey]}))}
                                  className="w-full flex items-center gap-2 px-3 py-2.5 bg-violet-50 hover:bg-violet-100 transition-colors text-left">
                                  <Activity size={12} className="text-violet-600 shrink-0" />
                                  <span className="font-black text-violet-700 text-xs flex-1">IPD Process</span>
                                  <span className="text-[10px] font-bold text-violet-600 bg-violet-100 px-2 py-0.5 rounded-full">{processLogsWithMeta.length} days</span>
                                  <ChevronDown size={13} className={`text-violet-400 transition-transform duration-200 ${subOpen?'rotate-180':''}`} />
                                </button>
                                {subOpen && (
                                  <div className="p-3 space-y-2 border-t border-violet-100">
                                    {processLogsWithMeta.map(({ log, config, completion }) => {
                                      const dayKey = `${subKey}_${log.id}`
                                      const dayOpen = expandedSubs[dayKey]
                                      return (
                                      <div key={log.id} className="rounded-xl border border-violet-100 bg-violet-50/40 overflow-hidden">
                                        <button
                                          type="button"
                                          onClick={() => setExpandedSubs((prev) => ({ ...prev, [dayKey]: !prev[dayKey] }))}
                                          className="w-full flex items-center gap-2 px-3 py-2.5 text-left hover:bg-violet-50/80 transition-colors"
                                        >
                                          <div className="flex items-center gap-3 flex-1 min-w-0">
                                            <div className="flex-1 min-w-0">
                                              <p className="text-xs font-black text-violet-900 truncate">
                                                {log.day_label || (log.day_number ? `Day ${log.day_number}` : 'Process log')}
                                                {' · '}
                                                {fmt(log.log_date)}
                                              </p>
                                              {log.recorded_by_name ? (
                                                <span className="text-[10px] text-violet-600 font-semibold truncate block">{log.recorded_by_name}</span>
                                              ) : null}
                                            </div>
                                            <div className="shrink-0 flex items-center gap-2">
                                              <ProcessCompletionRing percent={completion.percent} />
                                            </div>
                                          </div>
                                          <ChevronDown size={13} className={`text-violet-400 shrink-0 transition-transform duration-200 ${dayOpen ? 'rotate-180' : ''}`} />
                                        </button>
                                        {dayOpen && (
                                        <div className="px-3 pb-3 pt-2 space-y-2 border-t border-violet-100">
                                        {log.process_template_name ? (
                                          <span className="text-[10px] font-bold text-violet-600 bg-violet-100 px-2 py-0.5 rounded-full">
                                            {log.process_template_name}
                                          </span>
                                        ) : null}
                                        {buildProcessLogDisplayEntries(log, config).map((entry, idx) => (
                                          entry.type === 'group' ? (
                                            <div key={`${log.id}_g_${idx}`} className="space-y-1.5">
                                              <p className="text-[10px] font-black uppercase tracking-wide text-violet-700">{entry.label}</p>
                                              {entry.children.map((child, cidx) => (
                                                <div key={`${log.id}_gc_${cidx}`} className="text-xs pl-2 border-l-2 border-violet-200">
                                                  {child.vitals ? (
                                                    <div className="flex flex-wrap gap-1.5">
                                                      {Object.entries(child.vitals).filter(([, v]) => String(v || '').trim()).map(([k, v]) => (
                                                        <span key={k} className="text-[10px] font-bold uppercase tracking-wide text-violet-700 bg-white border border-violet-100 px-2 py-0.5 rounded-full">
                                                          {k}: {v}
                                                        </span>
                                                      ))}
                                                    </div>
                                                  ) : (
                                                    <>
                                                      <span className="font-bold text-violet-700">{child.label}: </span>
                                                      <span className={`text-gray-700 ${child.multiline ? 'whitespace-pre-wrap' : ''}`}>{child.text}</span>
                                                    </>
                                                  )}
                                                </div>
                                              ))}
                                            </div>
                                          ) : (
                                            <div key={`${log.id}_f_${idx}`} className="text-xs">
                                              {entry.vitals ? (
                                                <div className="flex flex-wrap gap-1.5">
                                                  {Object.entries(entry.vitals).filter(([, v]) => String(v || '').trim()).map(([k, v]) => (
                                                    <span key={k} className="text-[10px] font-bold uppercase tracking-wide text-violet-700 bg-white border border-violet-100 px-2 py-0.5 rounded-full">
                                                      {k}: {v}
                                                    </span>
                                                  ))}
                                                </div>
                                              ) : (
                                                <>
                                                  <span className="font-bold text-violet-700">{entry.label}: </span>
                                                  <span className={`text-gray-700 ${entry.multiline ? 'whitespace-pre-wrap' : ''}`}>{entry.text}</span>
                                                </>
                                              )}
                                            </div>
                                          )
                                        ))}
                                        </div>
                                        )}
                                      </div>
                                      )
                                    })}
                                  </div>
                                )}
                              </div>
                            )
                          })()}

                          {/* Ledger */}
                          {isLL ? (
                            <div className="flex items-center gap-2 text-xs text-blue-600 py-2 font-medium">
                              <span className="w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" /> Loading ledger…
                            </div>
                          ) : ledger ? (<div className="space-y-2">

                            {/* Summary cards always visible */}
                            <div className="grid grid-cols-3 gap-2">
                              {[{l:'Total Charges',v:ledger.total_charges,c:'border-gray-200 bg-white text-gray-800'},{l:'Total Paid',v:ledger.total_paid,c:'border-emerald-200 bg-emerald-50 text-emerald-700'},{l:'Balance Due',v:ledger.balance_due,c:balVal>0?'border-red-200 bg-red-50 text-red-600':'border-emerald-200 bg-emerald-50 text-emerald-700'}].map(({l,v,c})=>(
                                <div key={l} className={`rounded-xl border p-3 ${c}`}>
                                  <p className="text-[10px] font-semibold uppercase opacity-70 tracking-wide">{l}</p>
                                  <p className="text-base font-black mt-0.5">₹{fmtM(v)}</p>
                                </div>
                              ))}
                            </div>

                            {/* ── Sub-section 1: Charges ── */}
                            {buildIpdBillLineItems(ledger).length > 0 && (() => {
                              const subKey = `${a.id}_charges`
                              const subOpen = expandedSubs[subKey]
                              const chargeRows = buildIpdBillLineItems(ledger).map((item) => ({
                                description: item.description,
                                qty: item.quantity,
                                total_amount: item.total_amount,
                                date: null,
                                invoice_status: 'finalized',
                              }))

                              return (
                                <div className="border border-gray-200 rounded-xl overflow-hidden bg-white">
                                  <button type="button" onClick={() => setExpandedSubs(prev=>({...prev,[subKey]:!prev[subKey]}))}
                                    className="w-full flex items-center gap-2 px-3 py-2.5 bg-gray-50 hover:bg-gray-100 transition-colors text-left">
                                    <IndianRupee size={12} className="text-gray-500 shrink-0" />
                                    <span className="font-black text-gray-700 text-xs flex-1">Charges</span>
                                    <span className="text-[10px] font-bold text-gray-500 bg-gray-200 px-2 py-0.5 rounded-full">{chargeRows.length} items</span>
                                    <ChevronDown size={13} className={`text-gray-400 transition-transform duration-200 ${subOpen?'rotate-180':''}`} />
                                  </button>
                                  {subOpen && (
                                    <div className="overflow-x-auto border-t border-gray-100">
                                      <table className="w-full text-xs">
                                        <thead className="bg-gray-50 text-gray-400 text-[10px] uppercase">
                                          <tr>
                                            <th className="px-3 py-2 text-left font-semibold">Description</th>
                                            <th className="px-3 py-2 text-center font-semibold">Qty/Days</th>
                                            <th className="px-3 py-2 text-left font-semibold">Date</th>
                                            <th className="px-3 py-2 text-right font-semibold">Amount</th>
                                          </tr>
                                        </thead>
                                        <tbody className="divide-y divide-gray-50">
                                          {chargeRows.map((c,i)=>(
                                            <tr key={i} className={`hover:bg-gray-50/80 ${String(c.invoice_status || '').toLowerCase() === 'cancelled' ? 'bg-slate-50/90' : ''}`}>
                                              <td className="px-3 py-2.5 font-medium text-gray-800">
                                                <span>{c.description}</span>
                                                {String(c.invoice_status || '').toLowerCase() === 'cancelled' ? (
                                                  <span className="ml-1.5 text-[9px] font-black uppercase tracking-wide text-red-700 bg-red-100 px-1.5 py-0.5 rounded">Cancelled</span>
                                                ) : null}
                                              </td>
                                              <td className="px-3 py-2.5 text-center text-gray-600 font-bold">{c.qty}</td>
                                              <td className="px-3 py-2.5 text-gray-500">{c.date?format(new Date(c.date),'dd/MM/yy'):'—'}</td>
                                              <td className="px-3 py-2.5 text-right font-bold text-gray-900">₹{fmtM(c.total_amount)}</td>
                                            </tr>
                                          ))}
                                        </tbody>
                                        <tfoot className="border-t-2 border-gray-200">
                                          <tr className="bg-gray-50">
                                            <td colSpan={3} className="px-3 py-2 font-black text-gray-700 text-xs text-right">Total</td>
                                            <td className="px-3 py-2 text-right font-black text-gray-900">₹{fmtM(ledger.total_charges)}</td>
                                          </tr>
                                        </tfoot>
                                      </table>
                                    </div>
                                  )}
                                </div>
                              )
                            })()}

                            {/* ── Sub-section 2: Payment Receipts ── */}
                            {(ledger.payments||[]).length>0 && (() => {
                              const subKey = `${a.id}_payments`
                              const subOpen = expandedSubs[subKey]
                              const isVoidedPayment = (row) => {
                                if (String(row?.type || '') === 'pharmacy_payment') return false
                                return String(row?.status || '').toLowerCase() === 'cancelled'
                                  || String(row?.invoice_status || '').toLowerCase() === 'cancelled'
                              }
                              const payRows = [...(ledger.payments || [])].sort((a, b) => {
                                const voidA = isVoidedPayment(a)
                                const voidB = isVoidedPayment(b)
                                if (voidA !== voidB) return voidA ? 1 : -1
                                return new Date(a.date) - new Date(b.date)
                              })
                              const activePayRows = payRows.filter((p) => !isVoidedPayment(p))
                              const activePaidTotal = activePayRows.reduce((sum, p) => sum + (parseFloat(p?.amount || 0) || 0), 0)
                              return (
                                <div className="border border-emerald-200 rounded-xl overflow-hidden bg-white">
                                  <button type="button" onClick={() => setExpandedSubs(prev=>({...prev,[subKey]:!prev[subKey]}))}
                                    className="w-full flex flex-nowrap items-center gap-2 px-3 py-2.5 bg-emerald-50 hover:bg-emerald-100 transition-colors text-left min-w-0">
                                    <CreditCard size={12} className="text-emerald-600 shrink-0" />
                                    <span className="font-black text-emerald-700 text-xs flex-1 min-w-0 truncate">Payment Receipts</span>
                                    <span className="text-[10px] font-bold text-emerald-600 bg-emerald-100 px-2 py-0.5 rounded-full shrink-0">{activePayRows.length} payments</span>
                                    <button type="button" onClick={e=>{e.stopPropagation();setPrintTarget({type:'full_bill',admission:admObj,ledger})}}
                                      className="text-[10px] bg-indigo-600 text-white px-2 py-0.5 rounded-md font-bold hover:bg-indigo-700 inline-flex items-center gap-1 shrink-0">
                                      <Printer size={9} /> Full Bill
                                    </button>
                                    <ChevronDown size={13} className={`text-emerald-400 shrink-0 transition-transform duration-200 ${subOpen?'rotate-180':''}`} />
                                  </button>
                                  {subOpen && (
                                    <div className="overflow-x-auto border-t border-emerald-100">
                                      <table className="w-full text-xs">
                                        <thead className="bg-gray-50 text-gray-400 text-[10px] uppercase">
                                          <tr><th className="px-3 py-2 text-left font-semibold">Description</th><th className="px-3 py-2 text-left font-semibold">Date &amp; time</th><th className="px-3 py-2 text-right font-semibold">Amount</th><th className="px-3 py-2 text-center font-semibold">Status</th><th className="px-3 py-2 text-center font-semibold">Actions</th></tr>
                                        </thead>
                                        <tbody className="divide-y divide-gray-50">
                                          {activePayRows.map((p,i)=>{
                                            const md=(p.description||'').toUpperCase().includes('UPI')?'upi':(p.description||'').toUpperCase().includes('CREDIT')?'credit':'cash'
                                            const invNoPay = String(p?.invoice_no || '').toUpperCase()
                                            const descUpperPay = String(p?.description || '').toUpperCase()
                                            const isRef = invNoPay.includes('IPDREF') || descUpperPay.includes('REFUND') || parseFloat(p?.amount || 0) < 0
                                            const isAdv = !isRef && (p.description||'').toLowerCase().includes('advance')
                                            const receiptType = isRef ? 'refund' : isAdv ? 'advance' : 'service'
                                            const receiptAmount = Math.abs(parseFloat(p?.amount || 0) || 0)
                                            const rawPid = p?.id != null ? String(p.id) : ''
                                            const isPharmacy = p?.type === 'pharmacy_payment' || rawPid.startsWith('pharmacy-paid-')
                                            const payId = isPharmacy ? '' : rawPid
                                            const isPayCancelled = (p?.status || 'success') === 'cancelled'
                                            const invStPay = String(p?.invoice_status || 'finalized').toLowerCase()
                                            const isPayReadOnly = isPayCancelled || invStPay === 'cancelled'
                                            const canMutateTimelinePay = payId && !isPharmacy && !isPayReadOnly && invStPay === 'finalized'
                                            const slip = p?.slip_number || ''
                                            return (
                                              <tr key={i} className={`hover:bg-emerald-50/40 ${isPayReadOnly ? 'bg-slate-50/80 opacity-90' : ''}`}>
                                                <td className="px-3 py-2.5 font-medium text-gray-800">{p.description}</td>
                                                <td className="px-3 py-2.5 text-gray-500 whitespace-nowrap">{formatReceiptDateTime(p.date)}</td>
                                                <td className="px-3 py-2.5 text-right font-bold text-emerald-700">₹{fmtM(p.amount)}</td>
                                                <td className="px-3 py-2.5 text-center whitespace-nowrap">
                                                  {isPayReadOnly ? (
                                                    <span className="text-[9px] font-black uppercase tracking-wide text-red-700 bg-red-100 px-1.5 py-0.5 rounded">Cancelled</span>
                                                  ) : (
                                                    <span className="text-[9px] font-bold text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded">Active</span>
                                                  )}
                                                </td>
                                                <td className="px-3 py-2.5 text-center">
                                                  <div className="inline-flex flex-nowrap items-center justify-center gap-1.5 max-w-full overflow-x-auto py-0.5">
                                                    <button type="button"
                                                      onClick={()=>setPrintTarget({type:'ipd_receipt',admission:admObj,receiptData:{description:p.description,amount:receiptAmount,mode:md,invoice_no:p.invoice_no,paid_at:p.date,slip_number:slip},receiptType,viewOnly:true})}
                                                      title="View"
                                                      aria-label="View receipt"
                                                      className="h-8 w-8 hover:w-[72px] shrink-0 flex items-center justify-center gap-1 overflow-hidden text-indigo-600 hover:text-white bg-indigo-50 hover:bg-indigo-600 rounded-lg transition-all duration-150 border border-indigo-100 shadow-sm hover:shadow-md active:scale-95 group"
                                                    >
                                                      <Eye size={13} className="group-hover:scale-110 transition-transform shrink-0" />
                                                      <span className="max-w-0 opacity-0 translate-x-1 group-hover:max-w-[40px] group-hover:opacity-100 group-hover:translate-x-0 transition-all duration-150 text-[10px] font-black uppercase tracking-widest whitespace-nowrap">View</span>
                                                    </button>
                                                    <button type="button"
                                                      onClick={()=>setPrintTarget({type:'ipd_receipt',admission:admObj,receiptData:{description:p.description,amount:receiptAmount,mode:md,invoice_no:p.invoice_no,paid_at:p.date,slip_number:slip},receiptType,viewOnly:isPayReadOnly})}
                                                      title="Print"
                                                      aria-label="Print receipt"
                                                      className="h-8 w-8 hover:w-[74px] shrink-0 flex items-center justify-center gap-1 overflow-hidden rounded-lg transition-all duration-150 border shadow-sm hover:shadow-md active:scale-95 group text-sky-600 hover:text-white bg-sky-50 hover:bg-sky-600 border-sky-100"
                                                    >
                                                      <Printer size={13} className="group-hover:scale-110 transition-transform shrink-0" />
                                                      <span className="max-w-0 opacity-0 translate-x-1 group-hover:max-w-[44px] group-hover:opacity-100 group-hover:translate-x-0 transition-all duration-150 text-[10px] font-black uppercase tracking-widest whitespace-nowrap">Print</span>
                                                    </button>
                                                    {canMutateTimelinePay ? (
                                                      <>
                                                        <button type="button"
                                                          onClick={() => openTimelineLedgerEditPayment(a.id, payId)}
                                                          title="Edit"
                                                          aria-label="Edit payment"
                                                          className="h-8 w-8 hover:w-[68px] shrink-0 flex items-center justify-center gap-1 overflow-hidden text-emerald-600 hover:text-white bg-emerald-50 hover:bg-emerald-600 rounded-lg transition-all duration-150 border border-emerald-100 shadow-sm hover:shadow-md active:scale-95 group"
                                                        >
                                                          <Edit2 size={13} className="group-hover:scale-110 transition-transform shrink-0" />
                                                          <span className="max-w-0 opacity-0 translate-x-1 group-hover:max-w-[36px] group-hover:opacity-100 group-hover:translate-x-0 transition-all duration-150 text-[10px] font-black uppercase tracking-widest whitespace-nowrap">Edit</span>
                                                        </button>
                                                        <button type="button"
                                                          onClick={() => {
                                                            setTlPayCancel({
                                                              admissionId: a.id,
                                                              paymentTransactionId: payId,
                                                              invoice_no: p.invoice_no,
                                                              amount: parseFloat(String(p.amount || '0')),
                                                            })
                                                            setTlPayCancelReason('')
                                                          }}
                                                          title="Cancel"
                                                          aria-label="Cancel payment"
                                                          className="h-8 w-8 hover:w-[84px] shrink-0 flex items-center justify-center gap-1 overflow-hidden text-red-600 hover:text-white bg-red-50 hover:bg-red-600 rounded-lg transition-all duration-150 border border-red-100 shadow-sm hover:shadow-md active:scale-95 group"
                                                        >
                                                          <X size={13} className="group-hover:scale-110 transition-transform shrink-0" />
                                                          <span className="max-w-0 opacity-0 translate-x-1 group-hover:max-w-[52px] group-hover:opacity-100 group-hover:translate-x-0 transition-all duration-150 text-[10px] font-black uppercase tracking-widest whitespace-nowrap">Cancel</span>
                                                        </button>
                                                      </>
                                                    ) : null}
                                                  </div>
                                                </td>
                                              </tr>
                                            )
                                          })}
                                        </tbody>
                                        <tfoot className="border-t-2 border-gray-200">
                                          <tr className="bg-emerald-50">
                                            <td colSpan={2} className="px-3 py-2 font-black text-emerald-700 text-xs">Total Paid</td>
                                            <td className="px-3 py-2 text-right font-black text-emerald-700">₹{fmtM(activePaidTotal)}</td>
                                            <td />
                                            <td />
                                          </tr>
                                        </tfoot>
                                      </table>
                                    </div>
                                  )}
                                </div>
                              )
                            })()}

                            {/* ── Sub-section 3: Discharge Summary ── */}
                            {isDischarged && a.discharge_summary && (() => {
                              const subKey = `${a.id}_discharge`
                              const subOpen = expandedSubs[subKey]
                              return (
                                <div className="border border-teal-200 rounded-xl overflow-hidden bg-white">
                                  <button type="button" onClick={() => setExpandedSubs(prev=>({...prev,[subKey]:!prev[subKey]}))}
                                    className="w-full flex items-center gap-2 px-3 py-2.5 bg-teal-50 hover:bg-teal-100 transition-colors text-left">
                                    <CheckCircle size={12} className="text-teal-600 shrink-0" />
                                    <span className="font-black text-teal-700 text-xs flex-1">Discharge Summary</span>
                                    {isDischarged && (
                                      <button type="button" onClick={e=>{e.stopPropagation();setPrintTarget({type:'discharge',rec:{...a.discharge_summary},admission:a})}}
                                        className="text-[10px] bg-teal-600 text-white px-2 py-0.5 rounded-md font-bold hover:bg-teal-700 flex items-center gap-1 mr-1">
                                        <Printer size={9} /> Print
                                      </button>
                                    )}
                                    <ChevronDown size={13} className={`text-teal-400 transition-transform duration-200 ${subOpen?'rotate-180':''}`} />
                                  </button>
                                  {subOpen && (
                                    <div className="p-3 space-y-2 border-t border-teal-100">
                                      {[['Condition at Discharge',a.discharge_summary.condition_at_discharge],['Treatment Given',a.discharge_summary.treatment_given],['Medications on Discharge',a.discharge_summary.medications_on_discharge],['Follow-up Advice',a.discharge_summary.follow_up_advice]].filter(([,v])=>v).map(([l,val])=>(
                                        <div key={l} className="flex gap-2 text-xs">
                                          <span className="text-teal-600 font-bold shrink-0 w-44">{l}:</span>
                                          <span className="text-gray-700">{val}</span>
                                        </div>
                                      ))}
                                    </div>
                                  )}
                                </div>
                              )
                            })()}
                          </div>) : (
                            <button type="button" onClick={() => loadLedger(a.id)}
                              className="flex items-center gap-2 text-xs bg-blue-600 text-white px-3 py-2 rounded-lg font-bold hover:bg-blue-700 transition-colors shadow-sm">
                              <Receipt size={12} /> Load Full Ledger
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          </>)}
        </div>
      </div>
    </div>

    {tlPayCancel && (
      <div className="fixed inset-0 z-[340] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={() => { if (!tlPayCancelling) { setTlPayCancel(null); setTlPayCancelReason('') } }}>
        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden" onClick={e => e.stopPropagation()}>
          <div className="px-4 py-3 bg-red-600 text-white flex items-center justify-between">
            <h3 className="font-bold">Cancel payment receipt</h3>
            <button type="button" onClick={() => { if (!tlPayCancelling) { setTlPayCancel(null); setTlPayCancelReason('') } }} className="text-white/80 hover:text-white" disabled={tlPayCancelling}><X size={18} /></button>
          </div>
          <div className="p-4 space-y-3">
            <p className="text-sm text-gray-700">
              Cancelling payment for <span className="font-black">{tlPayCancel.invoice_no || '—'}</span>
              {' · '}
              <span className="font-semibold">₹{parseFloat(tlPayCancel.amount || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
            </p>
            <div>
              <label className="block text-xs font-bold text-gray-600 mb-1">Cancellation reason *</label>
              <textarea
                value={tlPayCancelReason}
                onChange={e => setTlPayCancelReason(e.target.value)}
                onKeyDown={e => handleCancelReasonKeyDown(e, submitTlPayCancel, { disabled: tlPayCancelling })}
                rows={4}
                className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm outline-none resize-none"
                disabled={tlPayCancelling}
                placeholder="Enter reason"
              />
            </div>
          </div>
          <div className="p-4 border-t border-gray-100 flex justify-end gap-2 bg-gray-50">
            <button type="button" onClick={() => { if (!tlPayCancelling) { setTlPayCancel(null); setTlPayCancelReason('') } }} disabled={tlPayCancelling} className="px-4 py-2 rounded-xl text-sm font-bold text-gray-600 hover:bg-gray-200">Close</button>
            <button type="button" onClick={submitTlPayCancel} disabled={tlPayCancelling} className="px-4 py-2 rounded-xl text-sm font-bold bg-red-600 text-white hover:bg-red-700">{tlPayCancelling ? 'Cancelling…' : 'Confirm cancel'}</button>
          </div>
        </div>
      </div>
    )}

    {tlPayEdit && (
      <div className="fixed inset-0 z-[340] bg-gray-900/40 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => !tlPaySaving && setTlPayEdit(null)}>
        <form onSubmit={handleTlPayEditSave} className="bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden" onClick={e => e.stopPropagation()}>
          <div className="bg-emerald-600 px-4 py-3 flex items-center justify-between text-white">
            <h2 className="font-bold">Edit payment slip</h2>
            <button type="button" onClick={() => !tlPaySaving && setTlPayEdit(null)}><X size={18} /></button>
          </div>
          <div className="p-4 space-y-4">
            <div>
              <label className="block text-xs font-bold text-gray-600 mb-1">Paid at</label>
              <input type="datetime-local" value={tlPayEdit.paid_at || ''} onChange={e => setTlPayEdit({ ...tlPayEdit, paid_at: e.target.value })} className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm outline-none" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-bold text-gray-600 mb-1">Amount</label>
                <input type="number" step="0.01" value={tlPayEdit.amount ?? ''} onChange={e => setTlPayEdit({ ...tlPayEdit, amount: e.target.value })} className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm outline-none" />
              </div>
              <div>
                <label className="block text-xs font-bold text-gray-600 mb-1">Mode</label>
                <select value={tlPayEdit.payment_mode || 'cash'} onChange={e => setTlPayEdit({ ...tlPayEdit, payment_mode: e.target.value })} className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm outline-none">
                  <option value="cash">Cash</option>
                  <option value="upi">UPI</option>
                  <option value="card">Card</option>
                  <option value="bank_transfer">Bank transfer</option>
                  <option value="other">Other</option>
                </select>
              </div>
            </div>
            <div>
              <label className="block text-xs font-bold text-gray-600 mb-1">Transaction reference</label>
              <input type="text" value={tlPayEdit.transaction_reference || ''} onChange={e => setTlPayEdit({ ...tlPayEdit, transaction_reference: e.target.value })} className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm outline-none" />
            </div>
            <div>
              <label className="block text-xs font-bold text-gray-600 mb-1">Receipt number</label>
              <input type="text" value={tlPayEdit.receipt_no || ''} onChange={e => setTlPayEdit({ ...tlPayEdit, receipt_no: e.target.value })} className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm outline-none" />
            </div>
            <div>
              <label className="block text-xs font-bold text-gray-600 mb-1">Status</label>
              <select value={tlPayEdit.status || 'success'} onChange={e => setTlPayEdit({ ...tlPayEdit, status: e.target.value })} className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm outline-none">
                <option value="success">Success</option>
                <option value="pending">Pending</option>
                <option value="failed">Failed</option>
                <option value="cancelled">Cancelled</option>
              </select>
            </div>
          </div>
          <div className="p-4 border-t flex justify-end gap-2 bg-gray-50">
            <button type="button" onClick={() => !tlPaySaving && setTlPayEdit(null)} className="px-4 py-2 rounded-xl text-sm font-bold text-gray-600 hover:bg-gray-200">Close</button>
            <button type="submit" disabled={tlPaySaving} className="px-4 py-2 rounded-xl text-sm font-bold bg-emerald-600 text-white hover:bg-emerald-700">{tlPaySaving ? 'Saving…' : 'Save'}</button>
          </div>
        </form>
      </div>
    )}

    {/* ── Print portals ── */}
    {printTarget?.type==='opd_receipt' && <PrintOpdReceipt visit={printTarget.visit} patient={printTarget.visit} onClose={()=>setPrintTarget(null)} />}
    {printTarget?.type==='opd_slip' && <PrintSlip visit={printTarget.visit} onClose={()=>setPrintTarget(null)} />}
    {printTarget?.type==='full_bill' && <PrintIpdLedger admission={printTarget.admission} ledger={printTarget.ledger} onClose={()=>setPrintTarget(null)} />}
    {printTarget?.type==='discharge' && <PrintDischargeSummary rec={printTarget.rec} admission={printTarget.admission} onClose={()=>setPrintTarget(null)} />}
    {printTarget?.type==='ipd_receipt' && (
      <PrintMiniReceipt
        admission={printTarget.admission}
        data={printTarget.receiptData}
        type={printTarget.receiptType}
        viewOnly={!!printTarget.viewOnly}
        onClose={()=>setPrintTarget(null)}
      />
    )}
    </>
  )
}

function PatientListSection() {
  const isMobile = useIsMobile()
  const [patients, setPatients] = useState([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(0)
  const [ptDateFrom, setPtDateFrom] = useState('')
  const [ptDateTo, setPtDateTo] = useState('')
  const [selected, setSelected] = useState(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [editPatientId, setEditPatientId] = useState(null)
  const [timelineFor, setTimelineFor] = useState(null)
  const PAGE_SIZE = 10
  const debounceRef = useRef(null)
  const isSearchFetchScheduledRef = useRef(false)

  useEffect(() => {
    setPage(0)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    isSearchFetchScheduledRef.current = true
    debounceRef.current = setTimeout(() => {
      isSearchFetchScheduledRef.current = false
      fetchPatients(0, search)
    }, 300)
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
      isSearchFetchScheduledRef.current = false
    }
  }, [search])

  useEffect(() => { setPage(0); fetchPatients(0, search) }, [ptDateFrom, ptDateTo])

  useEffect(() => {
    // When `search` changes, we reset `page` to 0 and schedule a debounced fetch.
    // Prevent the `page` effect from firing the immediate second fetch for offset=0.
    if (isSearchFetchScheduledRef.current && page === 0) return
    fetchPatients(page, search)
  }, [page])

  async function fetchPatients(pg = 0, q = '') {
    setLoading(true)
    try {
      const params = new URLSearchParams({ limit: PAGE_SIZE, offset: pg * PAGE_SIZE })
      if (q.trim()) params.set('search', q.trim())
      if (ptDateFrom) params.set('registered_from', ptDateFrom)
      if (ptDateTo) params.set('registered_to', ptDateTo)
      const { data } = await api.get(`/patients/?${params}`)
      setPatients(data?.data || data?.results || data || [])
      setTotal(data?.count ?? data?.total ?? (data?.data?.length ?? 0))
    } catch { toast.error('Failed to load patients') }
    finally { setLoading(false) }
  }

  function pName(p) {
    return [p.first_name, p.last_name].filter(Boolean).join(' ') || p.uhid || 'Patient'
  }

  function calcAge(dob) {
    if (!dob) return null
    const d = new Date(dob), t = new Date()
    let age = t.getFullYear() - d.getFullYear()
    if (t.getMonth() < d.getMonth() || (t.getMonth() === d.getMonth() && t.getDate() < d.getDate())) age--
    return age
  }

  const genderColor = { male: 'bg-blue-50 text-blue-700 border-blue-200', female: 'bg-pink-50 text-pink-700 border-pink-200', other: 'bg-purple-50 text-purple-700 border-purple-200' }
  const genderLabel = { male: 'Male', female: 'Female', other: 'Other' }
  const avatarColor = ['bg-emerald-100 text-emerald-700', 'bg-violet-100 text-violet-700', 'bg-amber-100 text-amber-700', 'bg-sky-100 text-sky-700', 'bg-rose-100 text-rose-700']
  const totalPages = Math.ceil(total / PAGE_SIZE)

  function openTimeline(patient) {
    if (!patient?.uhid) {
      toast.error('UHID not available for this patient')
      return
    }
    setTimelineFor(patient)
  }

  async function loadPatientDetail(patient) {
    if (!patient?.id) return patient
    try {
      const { data } = await api.get(`/patients/${patient.id}/`)
      return data?.data ?? data ?? patient
    } catch {
      toast.error('Failed to load patient details')
      return patient
    }
  }

  async function openView(patient) {
    setSelected(patient)
    setDetailLoading(true)
    const full = await loadPatientDetail(patient)
    setSelected(full)
    setDetailLoading(false)
  }

  async function refreshSelectedDetail() {
    if (!selected?.id) return
    setDetailLoading(true)
    const full = await loadPatientDetail(selected)
    setSelected(full)
    setDetailLoading(false)
  }

  function formatDobDisplay(dob) {
    if (!dob) return '—'
    try { return format(new Date(dob), 'dd/MM/yyyy') } catch { return String(dob) }
  }

  return (
    <div className={`flex flex-col min-h-0 ${isMobile ? 'h-full' : 'flex-1 gap-3'}`}>
      {!isMobile && (
        <div className="grid grid-cols-2 gap-3">
          {[['Total Patients', total, 'text-gray-900'], ['Showing', total === 0 ? '0' : `${page * PAGE_SIZE + 1}-${Math.min((page + 1) * PAGE_SIZE, total)}`, 'text-emerald-600']].map(([l, v, c]) => (
            <div key={l} className="bg-white rounded-xl p-3 shadow-sm border border-gray-100 flex items-center gap-3">
              <div className="min-w-0">
                <p className="text-[11px] font-medium text-gray-400 uppercase tracking-wide">{l}</p>
                <p className={`text-2xl font-black ${c}`}>{v}</p>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className={`bg-white shadow-sm border border-gray-100 overflow-hidden flex flex-col min-h-0 flex-1 ${isMobile ? 'rounded-none border-x-0' : 'rounded-xl'}`}>
        {isMobile ? (
          <MobileListFilters
            search={search}
            onSearchChange={setSearch}
            dateFrom={ptDateFrom}
            dateTo={ptDateTo}
            onDateFromChange={setPtDateFrom}
            onDateToChange={setPtDateTo}
            onClearDates={() => { setPtDateFrom(''); setPtDateTo('') }}
            loading={loading}
            onRefresh={() => fetchPatients(page, search)}
            total={total}
            totalLabel="patients"
            searchPlaceholder="Search name, UHID, phone…"
          />
        ) : (
          <div className="px-4 py-2.5 border-b border-gray-100 flex items-center gap-2 bg-gray-50/60 flex-wrap">
            <Search size={15} className="text-gray-400 shrink-0" strokeWidth={2} />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search by name, UHID, phone…"
              className="flex-1 min-w-[120px] text-sm outline-none bg-transparent placeholder:text-gray-400"
            />
            <span className="w-px h-4 bg-gray-200 shrink-0" />
            <div className="flex items-center gap-1.5 shrink-0">
              <label className="text-[11px] text-gray-400 font-semibold uppercase tracking-wide shrink-0">From</label>
              <input
                type="date"
                value={ptDateFrom}
                max={ptDateTo || undefined}
                onChange={e => setPtDateFrom(e.target.value)}
                className="text-xs border border-gray-200 rounded-lg px-2 py-1 text-gray-700 bg-white focus:outline-none focus:ring-2 focus:ring-emerald-400 focus:border-emerald-400 transition-all cursor-pointer"
              />
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              <label className="text-[11px] text-gray-400 font-semibold uppercase tracking-wide shrink-0">To</label>
              <input
                type="date"
                value={ptDateTo}
                min={ptDateFrom || undefined}
                onChange={e => setPtDateTo(e.target.value)}
                className="text-xs border border-gray-200 rounded-lg px-2 py-1 text-gray-700 bg-white focus:outline-none focus:ring-2 focus:ring-emerald-400 focus:border-emerald-400 transition-all cursor-pointer"
              />
            </div>
            {(ptDateFrom || ptDateTo) && (
              <button
                onClick={() => { setPtDateFrom(''); setPtDateTo('') }}
                className="text-[11px] font-bold text-red-500 hover:text-red-700 bg-red-50 hover:bg-red-100 px-2 py-1 rounded-lg transition-colors border border-red-100 shrink-0"
              >
                ✕ Clear
              </button>
            )}
            <span className="w-px h-4 bg-gray-200 shrink-0" />
            {loading && <span className="w-3.5 h-3.5 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin shrink-0" />}
            <button onClick={() => fetchPatients(page, search)} className="text-gray-400 hover:text-emerald-600 shrink-0">
              <RefreshCw size={14} strokeWidth={2} />
            </button>
            <span className="text-xs text-gray-400 shrink-0">{total} total</span>
          </div>
        )}

        {isMobile ? (
          <MobileCardList>
            {loading ? (
              <div className="py-12 text-center text-sm text-gray-400">Loading…</div>
            ) : patients.length === 0 ? (
              <div className="py-12 text-center text-sm text-gray-400">No patients found</div>
            ) : (
              patients.map((p, idx) => {
                const initials = ((p.first_name?.[0] || '') + (p.last_name?.[0] || '')).toUpperCase() || '?'
                const age = p.age ?? calcAge(p.dob)
                const regDate = p.created_at ? format(new Date(p.created_at), 'dd/MM/yyyy') : '—'
                return (
                  <PatientMobileCard
                    key={p.id}
                    patient={p}
                    displayName={pName(p)}
                    initials={initials}
                    avatarClass={avatarColor[idx % 5]}
                    age={age ?? '—'}
                    regDate={regDate}
                    genderLabel={genderLabel[p.gender]?.[0] || null}
                    genderClass={genderColor[p.gender] || 'bg-gray-50 text-gray-500 border-gray-200'}
                    onView={() => openView(p)}
                    onEdit={() => setEditPatientId(p.id)}
                    onTimeline={() => openTimeline(p)}
                  />
                )
              })
            )}
          </MobileCardList>
        ) : (
          <>
            <div className="grid grid-cols-12 px-4 py-2 bg-gray-100/80 border-b border-gray-200 text-[11px] font-semibold text-gray-500 uppercase tracking-wide">
              <div className="col-span-3">Patient</div>
              <div className="col-span-2">UHID</div>
              <div className="col-span-2">Phone</div>
              <div className="col-span-1 text-center">Gender</div>
              <div className="col-span-1 text-center">Age</div>
              <div className="col-span-1 text-right">Registered</div>
              <div className="col-span-2 text-right">Actions</div>
            </div>

            <div className="divide-y divide-gray-50 flex-1 overflow-y-auto min-h-0">
              {loading ? (
                <div className="py-12 text-center text-sm text-gray-400">Loading…</div>
              ) : patients.length === 0 ? (
                <div className="py-12 text-center text-sm text-gray-400">No patients found</div>
              ) : patients.map((p, idx) => {
                const initials = ((p.first_name?.[0] || '') + (p.last_name?.[0] || '')).toUpperCase() || '?'
                const age = p.age ?? calcAge(p.dob)
                const regDate = p.created_at ? format(new Date(p.created_at), 'dd/MM/yyyy') : '—'
                return (
                  <div
                    key={p.id}
                    onClick={() => openView(p)}
                    className="grid grid-cols-12 px-4 py-2.5 items-center hover:bg-emerald-50/40 cursor-pointer group transition-colors"
                  >
                    <div className="col-span-3 flex items-center gap-2.5 min-w-0">
                      <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${avatarColor[idx % 5]}`}>
                        {initials}
                      </div>
                      <p className="text-sm font-medium text-gray-900 truncate group-hover:text-emerald-800">{pName(p)}</p>
                    </div>
                    <div className="col-span-2 text-xs text-gray-500 font-mono truncate">{p.uhid}</div>
                    <div className="col-span-2 text-xs text-gray-500">{p.phone || '—'}</div>
                    <div className="col-span-1 flex justify-center">
                      <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full border ${genderColor[p.gender] || 'bg-gray-50 text-gray-500 border-gray-200'}`}>
                        {genderLabel[p.gender]?.[0] || '—'}
                      </span>
                    </div>
                    <div className="col-span-1 text-center text-xs text-gray-500">{age ?? '—'}</div>
                    <div className="col-span-1 text-right text-xs text-gray-400">{regDate}</div>
                    <div className="col-span-2 flex justify-end gap-1" onClick={e => e.stopPropagation()}>
                      <button
                        type="button"
                        onClick={() => openView(p)}
                        className="text-[10px] bg-emerald-100 text-emerald-800 px-2 py-1 rounded-md font-bold hover:bg-emerald-200 inline-flex items-center gap-0.5"
                      >
                        <Eye size={12} /> View
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditPatientId(p.id)}
                        className="text-[10px] bg-amber-100 text-amber-800 px-2 py-1 rounded-md font-bold hover:bg-amber-200 inline-flex items-center gap-0.5"
                      >
                        <Edit2 size={12} /> Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => openTimeline(p)}
                        title="Lifetime timeline"
                        className="text-[10px] bg-indigo-100 text-indigo-700 px-2 py-1 rounded-md font-bold hover:bg-indigo-200"
                      >
                        Timeline
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          </>
        )}
      </div>

      {/* Pagination */}
      <div className={`flex items-center justify-between py-1 shrink-0 ${isMobile ? 'px-3 pb-2 bg-white border-t border-gray-100' : 'px-1'}`}>
        {/* Left: showing count */}
        <span className="text-sm text-gray-400 font-medium">
          {total === 0
            ? 'No patients found'
            : `Showing ${page * PAGE_SIZE + 1}–${Math.min((page + 1) * PAGE_SIZE, total)} of ${total}`}
        </span>

        {/* Right: prev / page info / next */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => setPage(p => Math.max(0, p - 1))}
            disabled={page === 0}
            className="px-4 py-1.5 rounded-full text-sm font-semibold bg-gray-200 text-gray-700 hover:bg-gray-300 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            Previous
          </button>
          <span className="text-sm text-gray-500 font-medium px-1">
            Page {page + 1} of {totalPages || 1}
          </span>
          <button
            onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
            disabled={page >= totalPages - 1 || totalPages === 0}
            className="px-4 py-1.5 rounded-full text-sm font-semibold bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            Next
          </button>
        </div>
      </div>


      {/* ── Patient detail modal ── */}
      {selected && (
        <div
          className="fixed inset-0 z-[300] flex items-center justify-center p-4 bg-black/40 backdrop-blur-[2px]"
          onClick={() => setSelected(null)}
        >
          <div
            className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-hidden flex flex-col"
            onClick={e => e.stopPropagation()}
          >
            <div className="bg-gradient-to-r from-emerald-500 to-teal-600 px-5 py-4 flex items-center gap-4 shrink-0">
              <div className={`w-14 h-14 rounded-full flex items-center justify-center text-xl font-black shrink-0 ${avatarColor[0]}`}>
                {((selected.first_name?.[0] || '') + (selected.last_name?.[0] || '')).toUpperCase() || '?'}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-white font-bold text-lg truncate">{pName(selected)}</p>
                <p className="text-emerald-100 text-sm font-mono">{selected.uhid}</p>
              </div>
              <button type="button" onClick={() => setSelected(null)} className="text-white/70 hover:text-white shrink-0">
                <XCircle size={22} strokeWidth={1.8} />
              </button>
            </div>

            <div className="p-5 overflow-y-auto flex-1 relative">
              {detailLoading && (
                <div className="absolute inset-0 bg-white/80 flex items-center justify-center z-10">
                  <span className="w-6 h-6 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
                </div>
              )}
              <div className="grid grid-cols-2 gap-3">
                {[
                  ['Phone', selected.phone || '—', '📞'],
                  ['Email', selected.email || '—', '✉️'],
                  ['Gender', genderLabel[selected.gender] || selected.gender || '—', '🧬'],
                  ['Age', (() => {
                    const a = selected.age ?? calcAge(selected.dob)
                    return a != null && a !== '' ? `${a} yrs` : '—'
                  })(), '🎂'],
                  ['Date of Birth', formatDobDisplay(selected.dob), '📅'],
                  ['Blood Group', selected.blood_group || '—', '🩸'],
                  ['Guardian', selected.guardian_name || '—', '👤'],
                  ['Guardian relation', selected.guardian_relationship || '—', '🔗'],
                  ['Address', selected.address_line1 || '—', '📍'],
                  ['City', selected.city || '—', '🏙️'],
                  ['State', selected.state || '—', '🗺️'],
                  ['Patient type', selected.patient_type || '—', '🏥'],
                  ['Status', selected.status || '—', '●'],
                  ['Registered', selected.created_at ? format(new Date(selected.created_at), 'dd/MM/yyyy') : '—', '🗓️'],
                ].map(([label, value, icon]) => (
                  <div key={label} className="bg-gray-50 rounded-xl px-3 py-2.5 flex items-start gap-2">
                    <span className="text-base shrink-0 mt-0.5">{icon}</span>
                    <div className="min-w-0">
                      <p className="text-[11px] font-medium text-gray-400 uppercase tracking-wide">{label}</p>
                      <p className="text-sm font-semibold text-gray-800 break-words">{value}</p>
                    </div>
                  </div>
                ))}
              </div>

              {selected.emergency_tags && (
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {String(selected.emergency_tags).split(',').filter(Boolean).map(t => (
                    <span key={t} className="text-[11px] px-2 py-0.5 rounded-full bg-red-50 text-red-700 border border-red-200 font-medium">{t.trim()}</span>
                  ))}
                </div>
              )}

              {String(selected.registration_note || '').trim() !== '' && (
                <div className="mt-3 p-3 rounded-xl bg-amber-50/90 border border-amber-100">
                  <p className="text-[11px] font-semibold text-amber-900/80 uppercase tracking-wide mb-1.5">Registration note</p>
                  <p className="text-sm text-gray-800 whitespace-pre-wrap break-words">{selected.registration_note}</p>
                </div>
              )}
            </div>

            <div className="px-5 pb-4 flex flex-wrap gap-2 shrink-0 border-t border-gray-100 pt-3">
              <button
                type="button"
                onClick={() => {
                  setEditPatientId(selected.id)
                }}
                className="flex-1 min-w-[100px] py-2 rounded-xl bg-amber-600 text-white text-sm font-bold hover:bg-amber-700 inline-flex items-center justify-center gap-1"
              >
                <Edit2 size={14} /> Edit
              </button>
              <button
                type="button"
                onClick={() => { setSelected(null); openTimeline(selected) }}
                className="flex-1 min-w-[100px] py-2 rounded-xl bg-indigo-600 text-white text-sm font-bold hover:bg-indigo-700"
              >
                Timeline
              </button>
              <button
                type="button"
                onClick={() => setSelected(null)}
                className="flex-1 min-w-[100px] py-2 rounded-xl border border-gray-200 text-sm text-gray-600 hover:bg-gray-50 font-medium"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {editPatientId && (
        <PatientEditModal
          patientId={editPatientId}
          onClose={() => setEditPatientId(null)}
          onSaved={async () => {
            await fetchPatients(page, search)
            if (selected?.id === editPatientId) await refreshSelectedDetail()
          }}
          zIndexClass="z-[310]"
        />
      )}

      {timelineFor && (
        <PatientLifetimeTimelineModal
          patient={timelineFor}
          onClose={() => setTimelineFor(null)}
        />
      )}
    </div>
  )
}

// ─── Register Patient ─────────────────────────────────────────────────────────
function RegisterPatientSection() {
  const [form, setForm] = useState(() => buildPatientRegistrationInitial('', registrationDefaultsFromOpd()))
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    const validationError = validatePatientRegistrationForm(form)
    if (validationError) {
      toast.error(validationError)
      return
    }
    setSubmitting(true)
    try {
      const patient = await registerPatientFromForm(form)
      toast.success(`Patient registered! UHID: ${patient?.uhid || '—'}`)
      setForm(buildPatientRegistrationInitial('', registrationDefaultsFromOpd()))
    } catch (err) {
      if (err?.response?.data) {
        const errData = err.response.data
        toast.error(errData?.detail || (errData?.errors ? JSON.stringify(errData.errors) : null) || 'Registration failed')
      } else {
        toast.error(err?.message || 'Registration failed')
      }
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="max-w-4xl mx-auto w-full">
      <h2 className="text-lg font-bold text-gray-900 mb-4 flex items-center gap-2">
        <UserPlus size={20} className="text-emerald-500" /> Register New Patient
      </h2>
      <div className="bg-white rounded-2xl p-5 sm:p-6 shadow-sm border border-gray-100">
        <PatientRegistrationForm
          form={form}
          setForm={setForm}
          onSubmit={handleSubmit}
          submitting={submitting}
          submitLabel="Register Patient"
        />
      </div>
    </div>
  )
}


  

function prepareDischargePrintPagination(containerEl) {
  if (!containerEl) return
  const MM_TO_PX = 96 / 25.4
  // @page margin is 0 0 8mm 0 → content area is (297-8)mm tall
  const printableHeight = (297 - 8) * MM_TO_PX

  const headerEl = containerEl.querySelector('.discharge-print-header')
  const contentEl = containerEl.querySelector('.page-content')
  const footerEl = containerEl.querySelector('.discharge-print-footer')

  if (!contentEl) return

  // Reset any old padding so measurements are clean
  contentEl.style.paddingBottom = ''

  // Measure the actual rendered <td> heights (includes all padding/margin/border)
  const headerTd = headerEl?.closest('td')
  const footerTd = footerEl?.closest('td')
  const contentTd = contentEl?.closest('td')

  const headerHeight = headerTd
    ? headerTd.getBoundingClientRect().height
    : (headerEl?.getBoundingClientRect().height || 0)
  const footerHeight = footerTd
    ? footerTd.getBoundingClientRect().height
    : (footerEl?.getBoundingClientRect().height || 56)
  const contentHeight = contentTd
    ? contentTd.getBoundingClientRect().height
    : contentEl.scrollHeight

  const usablePerPage = Math.max(1, printableHeight - headerHeight - footerHeight)
  const totalPages = Math.max(1, Math.ceil(contentHeight / usablePerPage))

  // Expose dimensions as CSS variables so the print stylesheet can set min-height
  // on .page-content to fill the last page exactly (pushes tfoot to page bottom)
  containerEl.style.setProperty('--discharge-print-total-pages', String(totalPages))
  containerEl.style.setProperty('--discharge-usable-h', `${usablePerPage}px`)
  const root = document.getElementById('__discharge_doc_root')
  if (root) root.style.setProperty('--discharge-print-total-pages', String(totalPages))

  const pageSlot = containerEl.querySelector('.discharge-print-page-slot')
  if (pageSlot) pageSlot.textContent = `Page 1 of ${totalPages}`
}

// Removes every `@media print { ... }` block from a CSS/HTML string using brace matching
// (handles nested @page/@bottom-* rules). Used to drop the discharge component's own print
// block — the fragile `body * { visibility: hidden }` rules — before rebuilding a clean
// standalone document for the mobile new-tab flow.
function stripPrintMediaBlocks(css) {
  const src = String(css || '')
  const marker = '@media print'
  let out = ''
  let i = 0
  while (i < src.length) {
    const idx = src.indexOf(marker, i)
    if (idx === -1) {
      out += src.slice(i)
      break
    }
    out += src.slice(i, idx)
    const open = src.indexOf('{', idx)
    if (open === -1) break
    let depth = 1
    let j = open + 1
    while (j < src.length && depth > 0) {
      const ch = src[j]
      if (ch === '{') depth += 1
      else if (ch === '}') depth -= 1
      j += 1
    }
    i = j
  }
  return out
}

// Simple, mobile-safe replacement for the stripped print block. Neutralizes the fixed dark
// overlay wrapper (#__discharge_doc_root is a full-screen modal on the app) so the cloned
// content flows top-to-bottom in the new tab, hides the on-screen toolbar, and sets A4 @page.
const DISCHARGE_MOBILE_PRINT_CSS = `
  html, body { margin: 0; padding: 0; background: #fff; overflow: visible !important; height: auto !important; max-height: none !important; }
  #print-discharge-container { width: 100% !important; margin: 0 auto !important; overflow: visible !important; min-height: 297mm; }
  .discharge-print-table { width: 100%; border-collapse: collapse; }
  @media print {
    @page { size: A4 portrait; margin: 8mm; }
    html, body { margin: 0 !important; padding: 0 !important; background: #fff !important; overflow: visible !important; height: auto !important; }
    #print-discharge-container { overflow: visible !important; }
  }
`

function buildDischargeStandalonePrintHtml(printContainer) {
  const container = printContainer || document.getElementById('print-discharge-container')
  if (!container) return null

  const root = document.getElementById('__discharge_doc_root')
  const componentStyles = root
    ? Array.from(root.querySelectorAll('style'))
      .map((node) => stripPrintMediaBlocks(node.textContent || ''))
      .join('\n')
    : ''

  const linkedStyles = Array.from(document.querySelectorAll('link[rel="stylesheet"]'))
    .map((link) => `<link rel="stylesheet" href="${link.href}" />`)
    .join('')

  return `<!DOCTYPE html><html><head><meta charset="utf-8"/>${linkedStyles}
      <style>${STANDALONE_PRINT_DOCUMENT_CSS}</style>
      <style>${DISCHARGE_MOBILE_PRINT_CSS}</style>
      <style>${componentStyles}</style>
    </head><body>
      <div id="print-discharge-container" class="mx-auto w-full min-h-[297mm] text-black bg-white">
        ${container.innerHTML}
      </div>
    </body></html>`
}

function shouldUseStandaloneDischargePrint() {
  if (shouldUseDedicatedPrintDocument()) return true
  if (typeof window === 'undefined') return false
  return window.matchMedia('(max-width: 767px)').matches
}

function triggerDischargeDocumentPrint(printContainer, onBeforePrintDocument, targetWindow = null, onComplete = null) {
  prepareDischargePrintPagination(printContainer)
  onBeforePrintDocument?.()

  if (shouldUseStandaloneDischargePrint()) {
    const baseHtml = buildDischargeStandalonePrintHtml(printContainer)
    if (!baseHtml) return
    const win = shouldUseDedicatedPrintDocument() ? null : targetWindow
    deliverMobilePrintHtml(baseHtml, { targetWindow: win, onComplete })
    return
  }

  setTimeout(() => {
    receptionistLastPrintKind = 'discharge'
    triggerHMSPrint(window, { printRootId: '__discharge_doc_root' })
    if (typeof onComplete === 'function') {
      let done = false
      const finish = () => {
        if (done) return
        done = true
        window.removeEventListener('afterprint', finish)
        onComplete()
      }
      window.addEventListener('afterprint', finish)
      setTimeout(finish, 2500)
    }
  }, 300)
}

function PrintDischargeSummary({ rec, admission: admissionProp, onClose, onPrintBill, externalPrintBillLoading = false, onBeforePrintDocument, embedded = false, autoPrint = false }) {
  const isMobile = useIsMobile()
  const printRef = useRef(null)
  const [printReady, setPrintReady] = useState(false)
  // Re-render when hospital 12h/24h mode changes so printed times include AM/PM.
  useTimeDisplayMode()
  const slipProfile = getPaymentSlipProfile()
  const hospitalName = (slipProfile.hospital_name || DEFAULT_PAYMENT_SLIP_PROFILE.hospital_name).toUpperCase()
  const address = slipProfile.address || DEFAULT_PAYMENT_SLIP_PROFILE.address
  const pinCode = slipProfile.pin_code || DEFAULT_PAYMENT_SLIP_PROFILE.pin_code
  const phone = slipProfile.phone || DEFAULT_PAYMENT_SLIP_PROFILE.phone
  const email = slipProfile.email || DEFAULT_PAYMENT_SLIP_PROFILE.email
  const website = slipProfile.website || DEFAULT_PAYMENT_SLIP_PROFILE.website
  const logoUrl = slipProfile.hospital_logo_url || ''
  const adm = admissionProp || {}
  const [patientDemographics, setPatientDemographics] = useState({ age: '', ageUnit: 'years', gender: '' })

  const [billPrintTarget, setBillPrintTarget] = useState(null)
  const [billPrintLoading, setBillPrintLoading] = useState(false)

  useEffect(() => {
    let cancelled = false
    async function hydrateDemographics() {
      const fromRecAge = rec?.patient_age
      const fromRecGender = rec?.patient_gender
      if ((fromRecAge != null && fromRecAge !== '') && String(fromRecGender || '').trim()) {
        if (!cancelled) {
          setPatientDemographics({
            age: String(fromRecAge),
            ageUnit: normalizeAgeUnit(rec?.patient_age_unit || 'years'),
            gender: String(fromRecGender).trim(),
          })
        }
        return
      }
      const patientId = adm?.patient || (typeof adm?.patient === 'object' ? adm?.patient?.id : null)
      if (!patientId) {
        const ageFields = hydrateAgeFieldsFromPatient(adm)
        if (!cancelled) {
          setPatientDemographics({
            age: fromRecAge != null && fromRecAge !== '' ? String(fromRecAge) : ageFields.age,
            ageUnit: normalizeAgeUnit(rec?.patient_age_unit || ageFields.ageUnit),
            gender: String(fromRecGender || adm?.patient_gender || adm?.gender || '').trim(),
          })
        }
        return
      }
      try {
        const { data } = await api.get(`/patients/${patientId}/`)
        const p = data?.data || data || {}
        const ageFields = hydrateAgeFieldsFromPatient(p)
        if (!cancelled) {
          setPatientDemographics({
            age: fromRecAge != null && fromRecAge !== '' ? String(fromRecAge) : ageFields.age,
            ageUnit: normalizeAgeUnit(rec?.patient_age_unit || ageFields.ageUnit),
            gender: String(fromRecGender || p.gender || '').trim(),
          })
        }
      } catch {
        if (!cancelled) {
          setPatientDemographics({
            age: fromRecAge != null && fromRecAge !== '' ? String(fromRecAge) : '',
            ageUnit: normalizeAgeUnit(rec?.patient_age_unit || 'years'),
            gender: String(fromRecGender || '').trim(),
          })
        }
      }
    }
    hydrateDemographics()
    return () => { cancelled = true }
  }, [rec?.id, rec?.patient_age, rec?.patient_gender, rec?.patient_age_unit, adm?.patient, adm?.patient_gender, adm?.gender])

  const rawAge = (patientDemographics.age !== '' && patientDemographics.age != null)
    ? patientDemographics.age
    : rec?.patient_age
  const displayAge = (rawAge != null && rawAge !== '')
    ? formatAgeDisplayLabel(rawAge, patientDemographics.ageUnit || rec?.patient_age_unit)
    : '—'
  const displayGender = String(patientDemographics.gender || rec?.patient_gender || '').trim()
  const displayGenderLabel = displayGender
    ? displayGender.charAt(0).toUpperCase() + displayGender.slice(1).toLowerCase()
    : '—'

  function resolveAdmissionIdForBill() {
    const raw = rec?.admission ?? adm?.id ?? adm
    if (raw && typeof raw === 'object' && raw !== null && 'id' in raw) return raw.id
    return raw
  }

  async function handlePrintBillFromPreview() {
    if (onPrintBill) {
      onPrintBill(rec)
      return
    }
    const admissionId = resolveAdmissionIdForBill()
    if (!admissionId) {
      toast.error('Missing admission for billing')
      return
    }
    setBillPrintLoading(true)
    try {
      const [{ data: admission }, { data: ledger }] = await Promise.all([
        api.get(`/ipd-admissions/${admissionId}/`),
        api.get(`/ipd-admissions/${admissionId}/ledger/`),
      ])
      setBillPrintTarget({ admission, ledger, dischargeSummary: rec })
    } catch {
      toast.error('Could not load bill for printing')
    } finally {
      setBillPrintLoading(false)
    }
  }

  const billBtnBusy = onPrintBill ? externalPrintBillLoading : billPrintLoading

  useEffect(() => {
    const onBeforePrint = () => prepareDischargePrintPagination(printRef.current)
    window.addEventListener('beforeprint', onBeforePrint)
    return () => window.removeEventListener('beforeprint', onBeforePrint)
  }, [])

  const fmtAdmissionWhen = () => formatPrintDateTimeLabel(
    rec.admission_date || adm.admission_date,
    rec.admission_time || adm.admission_time || adm.created_at,
    { dateStyle: 'd/M/yyyy' },
  )

  const fmtDischargeWhen = () => {
    if (rec.discharge_date) {
      return formatPrintDateTimeLabel(rec.discharge_date, rec.discharge_time, { dateStyle: 'd/M/yyyy' })
    }
    if (adm.discharged_at) {
      try { return formatDateTime(adm.discharged_at, { dateStyle: 'd/M/yyyy' }) } catch { return '—' }
    }
    return rec.created_at ? formatDateTime(rec.created_at, { dateStyle: 'd/M/yyyy' }) : '—'
  }

  const vitals = rec.vitals_at_discharge && typeof rec.vitals_at_discharge === 'object' ? rec.vitals_at_discharge : {}
  
  useEffect(() => {
    if (embedded) return undefined
    function handleAfterPrint() {
      if (receptionistLastPrintKind === 'ipd_ledger') {
        receptionistLastPrintKind = null
        return
      }
      receptionistLastPrintKind = null
      schedulePrintCleanup(onClose)
    }
    window.addEventListener('afterprint', handleAfterPrint)
    return () => window.removeEventListener('afterprint', handleAfterPrint)
  }, [onClose, embedded])

  useEffect(() => {
    setPrintReady(false)
    const timer = window.setTimeout(() => setPrintReady(true), embedded ? 50 : 200)
    return () => window.clearTimeout(timer)
  }, [rec?.id, admissionProp?.id, embedded])

  useEffect(() => {
    if (!autoPrint || !printReady) return undefined
    const timer = setTimeout(() => {
      if (!printRef.current) return
      triggerDischargeDocumentPrint(printRef.current, onBeforePrintDocument, null, () => {
        schedulePrintCleanup(onClose)
      })
    }, 350)
    return () => clearTimeout(timer)
  }, [autoPrint, printReady, onClose, onBeforePrintDocument])

  const surgeryRows = Array.isArray(rec.surgery_rows) && rec.surgery_rows.length > 0
    ? rec.surgery_rows
    : (
      (rec.procedure_surgery || rec.surgery_date || rec.surgeon_name || rec.anaesthetist_name || rec.anaesthesia_type || rec.operative_findings || rec.intra_op_complications)
        ? [{
            surgery_date: rec.surgery_date || '',
            procedure_name: rec.procedure_surgery || '',
            surgeon_name: rec.surgeon_name || '',
            assistant_name: rec.assistant_name || '',
            anaesthetist_name: rec.anaesthetist_name || '',
            anaesthesia_type: rec.anaesthesia_type || '',
            operative_findings: rec.operative_findings || '',
            intra_op_complications: rec.intra_op_complications || '',
          }]
        : []
    )

  const clinicalSections = [
    { label: 'Chief complaints', val: rec.chief_complaints },
    { label: 'Reason for admission', val: rec.reason_for_admission },
    { label: 'Diagnosis', val: rec.diagnosis },
    { label: 'Co-morbidities', val: rec.co_morbidities },
    { label: 'Allergies', val: rec.allergies },
    { label: 'Medical history', val: rec.medical_history },
    { label: 'Family history', val: rec.family_history },
    { label: 'Personal history', val: rec.personal_history },
    { label: 'Physical examination', val: rec.physical_examination, includeVitals: true },
    { label: 'Treatment given', val: rec.treatment_given },
    {
      label: 'Procedure / surgery (summary)',
      val: rec.procedure_surgery || surgeryRows.map((r) => r.procedure_name || r.procedure_surgery || '').filter(Boolean).join('; ')
    },
    { label: 'Investigations (notes)', val: rec.investigations },
    { label: 'Course in hospital', val: rec.course_in_hospital },
    { label: 'Complications during stay', val: rec.complications_during_stay },
    { label: 'Blood transfusion', val: rec.blood_transfusion_details },
    { label: 'Implants', val: rec.implants_used },
    { label: 'Indwelling devices', val: rec.indwelling_devices_on_discharge },
    { label: 'Vaccination', val: rec.vaccination_given },
  ].filter((s) => {
    if (s.includeVitals) {
      const hasVitals = Boolean(vitals.bp || vitals.pulse || vitals.spo2 || vitals.temp || vitals.weight || vitals.rbs)
      const hasText = s.val && String(s.val).trim() !== ''
      return hasVitals || hasText
    }
    return s.val && String(s.val).trim() !== ''
  })

  const labRows = (rec.investigation_rows || []).filter(r => (r.category || 'lab') === 'lab')
  const imgRows = (rec.investigation_rows || []).filter(r => r.category === 'imaging')
  const medRows = rec.medication_rows || []
  const showOperative = surgeryRows.length > 0

  const dischargePrintFooterBar = (
    <div className="page-footer discharge-print-footer w-full grid grid-cols-3 items-center px-8 pt-5 text-[12px] font-bold text-black border-t border-black mt-4">
      <span className="justify-self-start" />
      <span className="justify-self-center">CONFIDENTIAL MEDICAL RECORD</span>
      <span className="justify-self-end">Page Number:</span>
    </div>
  )

  const content = (
    <div id="__discharge_doc_root" className={embedded
      ? 'bg-white rounded-2xl shadow-sm overflow-visible print:static print:p-0 print:block print:bg-transparent'
      : `fixed inset-0 z-[700] bg-black/60 backdrop-blur-sm flex items-stretch sm:items-center justify-center print:static print:p-0 print:block print:bg-transparent ${isMobile ? 'p-0' : 'p-3 sm:p-5'}`}>
      <div className={`w-full max-w-[1120px] bg-white shadow-2xl print:overflow-visible print:max-h-none print:rounded-none print:shadow-none flex flex-col ${embedded ? 'rounded-2xl overflow-visible h-auto max-h-none' : isMobile ? 'h-[100dvh] max-h-[100dvh] rounded-none overflow-hidden' : 'max-h-[94vh] rounded-2xl overflow-hidden'}`}>
        <div className="print:hidden sticky top-0 z-20 px-3 sm:px-4 py-3 border-b border-gray-200 bg-white/95 backdrop-blur flex flex-col sm:flex-row sm:items-center sm:justify-end gap-2">
          <button
            type="button"
            onClick={handlePrintBillFromPreview}
            disabled={billBtnBusy}
            title="Print IPD bill (A4)"
            className="inline-flex items-center justify-center gap-2 bg-teal-50 text-teal-900 border border-teal-200 px-4 py-2.5 rounded-lg text-sm font-bold hover:bg-teal-100 disabled:opacity-50 w-full sm:w-auto"
          >
            <Receipt size={16} /> Print bill
          </button>
          <button
            type="button"
            onClick={() => {
              const targetWindow = (isMobile && !shouldUseDedicatedPrintDocument())
                ? window.open('', '_blank')
                : null
              triggerDischargeDocumentPrint(printRef.current, onBeforePrintDocument, targetWindow)
            }}
            className="bg-emerald-600 text-white px-4 py-2.5 rounded-lg text-sm font-bold hover:bg-emerald-700 w-full sm:w-auto"
          >
            Print Document
          </button>
          {!embedded && (
            <button type="button" onClick={onClose} className="bg-gray-100 text-gray-700 px-4 py-2.5 rounded-lg text-sm font-bold hover:bg-gray-200 w-full sm:w-auto">Close Preview</button>
          )}
        </div>

        <div className={embedded
          ? 'overflow-visible p-2 sm:p-5 print:p-0'
          : `overflow-y-auto flex-1 min-h-0 print:overflow-visible print:max-h-none p-2 sm:p-5 print:p-0 ${isMobile ? '' : 'max-h-[calc(94vh-56px)]'}`}>
      {/* <div ref={printRef} className="mx-auto w-full max-w-[210mm] text-black bg-white print:shadow-none shadow-sm"> */}
        
        {/* ── PAGE 1: CLINICAL DISCHARGE SUMMARY (MEDANTA STYLE) ── */}
      <div ref={printRef} id="print-discharge-container" className="mx-auto w-full min-h-[297mm] text-black bg-white print:shadow-none shadow-sm">
            <table className="discharge-print-table w-full text-black bg-white print:table print:exact-colors text-[13px]">
              <thead className="table-header-group">
                <tr>
                  <td className="">
                    <div className="page-header discharge-print-header mt-5">
                      <div className="flex justify-between items-center ">
                        <div className="flex items-center gap-0">
                          <div className="flex items-center justify-center">
                            {logoUrl ? (
                              <img src={logoUrl} alt="Hospital logo" className="w-24 h-24 object-contain p-2" />
                            ) : (
                              <span className="font-black text-xl text-gray-300">LOGO</span>
                            )}
                          </div>
                          <div className="flex flex-col">
                            <h1 className="text-3xl font-black tracking-tight text-black uppercase">{hospitalName.split(' ')[0] || ''}</h1>
                            <h1 className="text-3xl font-black text-black leading-none uppercase">{hospitalName.split(' ').slice(1).join(' ')}</h1>
                          </div>
                        </div>
                        <div className="text-right flex flex-col text-[13px] text-black px-8">
                          <span>{address}, Pin: {pinCode}</span>
                          <span>{phone}</span>
                          <span>{email}</span>
                        </div>
                      </div>

                      <div className="w-full mb-3 text-center">
                        <h2 className="text-xl font-bold tracking-[0.2em] uppercase text-black">DISCHARGE SUMMARY</h2>
                      </div>
                      <div className="border border-black rounded p-2 grid grid-cols-2 gap-x-8 gap-y-0.5 text-xs px-4 m-5 mt-3 mb-2">
                        <div className="flex flex-col gap-0.5">
                          <div className="flex"><span className="font-bold w-32 shrink-0">Patient Name</span><span className="w-4 shrink-0 font-bold">:</span><span className="uppercase text-black">{rec.patient_name}</span></div>
                          <div className="flex"><span className="font-bold w-32 shrink-0">Age</span><span className="w-4 shrink-0 font-bold">:</span><span className="text-black">{displayAge}</span></div>
                          <div className="flex"><span className="font-bold w-32 shrink-0">Admission Date</span><span className="w-4 shrink-0 font-bold">:</span><span className="text-black">{fmtAdmissionWhen()}</span></div>
                          <div className="flex"><span className="font-bold w-32 shrink-0">Department</span><span className="w-4 shrink-0 font-bold">:</span><span className="text-black">{adm.department || '—'}</span></div>
                          <div className="flex items-start"><span className="font-bold w-32 shrink-0">IPD / Ward / Bed</span><span className="w-4 shrink-0 font-bold">:</span><span className="break-words text-black">{rec.admission_ipd_no || '—'} / {adm.ward_name || '—'} / {adm.bed_code || '—'}</span></div>
                        </div>
                        <div className="flex flex-col gap-0.5">
                          <div className="flex"><span className="font-bold w-40 shrink-0">Patient UHID</span><span className="w-4 shrink-0 font-bold">:</span><span className="text-black">{rec.patient_uhid || '—'}</span></div>
                          <div className="flex"><span className="font-bold w-40 shrink-0">Gender</span><span className="w-4 shrink-0 font-bold">:</span><span className="text-black">{displayGenderLabel}</span></div>
                          <div className="flex"><span className="font-bold w-40 shrink-0">Discharge Date</span><span className="w-4 shrink-0 font-bold">:</span><span className="text-black">{fmtDischargeWhen()}</span></div>
                          <div className="flex"><span className="font-bold w-40 shrink-0">Consultant Incharge</span><span className="w-4 shrink-0 font-bold">:</span><span className="text-black">{rec.treating_consultant || adm.assigned_doctor_name || '—'}</span></div>
                          <div className="flex"><span className="font-bold w-40 shrink-0">ABHA / Insurance</span><span className="w-4 shrink-0 font-bold">:</span><span className="text-black">{[rec.abha_id, rec.insurance_provider, rec.policy_number].filter(Boolean).join(' · ') || '—'}</span></div>
                        </div>
                      </div>
                    </div>
                  </td>
                </tr>
              </thead>

              <tbody className="table-row-group">
                <tr>
                  <td>
                    <div className="page-content m-5">
                      {(vitals.bp || vitals.pulse || vitals.spo2 || vitals.temp || vitals.weight || vitals.rbs) && (
                        <div className="mb-6 flex gap-2 break-inside-avoid justify-between">
                          {[{ k: 'bp', l: 'BP (mmHg)' }, { k: 'pulse', l: 'Pulse (bpm)' }, { k: 'spo2', l: 'SpO₂ (%)' }, { k: 'temp', l: 'Temp (°F)' }, { k: 'weight', l: 'Wt (kg)' }, { k: 'rbs', l: 'RBS (mg/dL)' }].map(({ k, l }) => (
                            <div key={k} className="flex-1 text-center border border-gray-100 rounded bg-[#f5f7f9] flex flex-col items-center justify-center p-2">
                              <span className="font-bold text-gray-500 text-[11px] mb-1">{l}</span>
                              <span className="text-[13px] font-medium text-black">{vitals[k] || '—'}</span>
                            </div>
                          ))}
                        </div>
                      )}
                      <div className="grid grid-cols-2 gap-x-8 gap-y-1.5 text-[13px] px-4 mb-6">
                        <div className="flex flex-col gap-1.5">
                          <div className="flex"><span className="font-bold w-40 shrink-0">Condition at Discharge</span><span className="w-4 shrink-0 font-bold">:</span><span className="text-black">{rec.condition_at_discharge || '—'}</span></div>
                          <div className="flex"><span className="font-bold w-40 shrink-0">Encounter Type</span><span className="w-4 shrink-0 font-bold">:</span><span className="text-black">{rec.encounter_type || 'IPD'}</span></div>
                        </div>
                        <div className="flex flex-col gap-1.5">
                          <div className="flex"><span className="font-bold w-30 shrink-0">Reg. no. / RMO</span><span className="w-4 shrink-0 font-bold">:</span><span className="text-black">{[rec.consultant_registration_no, rec.rmo_signed_by].filter(Boolean).join(' · ') || '—'}</span></div>
                          <div className="flex"><span className="font-bold w-30 shrink-0">Discharge Type</span><span className="w-4 shrink-0 font-bold">:</span><span className="uppercase text-black">{(rec.discharge_type || 'routine').replace(/_/g, ' ')}</span></div>
                        </div>
                      </div>

                      <div className="space-y-6 text-sm flex-1 text-black mx-4">
                        {clinicalSections.map((sec, i) => (
                          <div key={i} className="flex flex-col gap-1">
                            <h3 className="font-black uppercase tracking-tight text-black text-[13px]">{sec.label} :</h3>
                            <div className="whitespace-pre-wrap break-words pl-3 border-l-[3px] border-emerald-300 leading-relaxed text-gray-600 text-xs uppercase">{sec.val}</div>
                          </div>
                        ))}
                      </div>

                      {showOperative && (
                        <div className="border border-black rounded p-3 break-inside-avoid mx-2 mt-6 mb-0">
                          <h3 className="font-black uppercase text-xs mb-2">Operative details</h3>
                          <div className="space-y-3">
                            {surgeryRows.map((row, idx) => (
                              <div key={`print-surgery-${idx}`} className="border border-gray-200 rounded p-2">
                                <p className="font-bold text-xs mb-1">Surgery #{idx + 1}: {row.procedure_name || row.procedure_surgery || 'Procedure'}</p>
                                <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-xs text-gray-700">
                                  {row.surgery_date && <div><span className="font-bold text-black">Date:</span> {format(new Date(`${row.surgery_date}T12:00:00`), 'd/M/yyyy')}</div>}
                                  {row.surgeon_name && <div><span className="font-bold text-black">Surgeon:</span> {row.surgeon_name}</div>}
                                  {row.assistant_name && <div><span className="font-bold text-black">Assistant:</span> {row.assistant_name}</div>}
                                  {row.anaesthetist_name && <div><span className="font-bold text-black">Anaesthetist:</span> {row.anaesthetist_name}</div>}
                                  {row.anaesthesia_type && <div><span className="font-bold text-black">Anaesthesia:</span> {row.anaesthesia_type}</div>}
                                </div>
                                {(row.operative_findings || row.intra_op_complications) && (
                                  <div className="mt-2 space-y-1 text-xs whitespace-pre-wrap text-gray-700">
                                    {row.operative_findings && <p><span className="font-bold text-black">Findings:</span> {row.operative_findings}</p>}
                                    {row.intra_op_complications && <p><span className="font-bold text-black">Intra-op complications:</span> {row.intra_op_complications}</p>}
                                  </div>
                                )}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {(labRows.length > 0 || imgRows.length > 0) && (
                        <div className="space-y-4 mx-2 mt-6 mb-0">
                          <h3 className="font-black uppercase text-sm">Investigations</h3>
                          {labRows.length > 0 && (
                            <div className="discharge-data-grid discharge-data-grid--lab text-[11px]">
                              <div className="discharge-data-grid__head text-left">Lab test</div>
                              <div className="discharge-data-grid__head">Value</div>
                              <div className="discharge-data-grid__head">Ref.</div>
                              <div className="discharge-data-grid__head">Date</div>
                              {labRows.map((r, i) => (
                                <React.Fragment key={i}>
                                  <div className="discharge-data-grid__cell">{r.test_name}</div>
                                  <div className="discharge-data-grid__cell">{r.value || '—'}</div>
                                  <div className="discharge-data-grid__cell">{r.reference_range || '—'}</div>
                                  <div className="discharge-data-grid__cell">{r.test_date ? format(new Date(`${r.test_date}T12:00:00`), 'dd/MM/yy') : '—'}</div>
                                </React.Fragment>
                              ))}
                            </div>
                          )}
                          {imgRows.length > 0 && (
                            <div className="discharge-data-grid discharge-data-grid--img text-[11px]">
                              <div className="discharge-data-grid__head text-left">Imaging</div>
                              <div className="discharge-data-grid__head">Summary</div>
                              <div className="discharge-data-grid__head">Date</div>
                              {imgRows.map((r, i) => (
                                <React.Fragment key={i}>
                                  <div className="discharge-data-grid__cell">{r.test_name}</div>
                                  <div className="discharge-data-grid__cell">{r.value || '—'}</div>
                                  <div className="discharge-data-grid__cell">{r.test_date ? format(new Date(`${r.test_date}T12:00:00`), 'dd/MM/yy') : '—'}</div>
                                </React.Fragment>
                              ))}
                            </div>
                          )}
                        </div>
                      )}

                      <div className="mx-2 mt-6 mb-0">
                        <h2 className="text-center font-black text-[16px] uppercase tracking-[0.15em] m-5 italic">ADVICE ON DISCHARGE</h2>
                        <div className="space-y-6">
                          <div>
                            <h3 className="font-black uppercase text-sm mb-2">Discharge medication</h3>
                            {medRows.length > 0 ? (
                              <div className="discharge-data-grid discharge-data-grid--med text-[11px]">
                                <div className="discharge-data-grid__head text-left">Drug</div>
                                <div className="discharge-data-grid__head">Dose</div>
                                <div className="discharge-data-grid__head">Route</div>
                                <div className="discharge-data-grid__head">Freq</div>
                                <div className="discharge-data-grid__head">Dur</div>
                                <div className="discharge-data-grid__head">Notes</div>
                                {medRows.map((r, i) => {
                                  const manual = r.rx_meta && r.rx_meta.type === 'manual'
                                  return (
                                    <React.Fragment key={i}>
                                      <div className="discharge-data-grid__cell">{r.drug_name}{manual ? <span className="text-red-600 font-bold ml-1">[not in pharmacy]</span> : null}</div>
                                      <div className="discharge-data-grid__cell">{r.dose || '—'}</div>
                                      <div className="discharge-data-grid__cell">{r.route || '—'}</div>
                                      <div className="discharge-data-grid__cell">{r.frequency || '—'}</div>
                                      <div className="discharge-data-grid__cell">{r.duration || '—'}</div>
                                      <div className="discharge-data-grid__cell">{r.instructions || '—'}</div>
                                    </React.Fragment>
                                  )
                                })}
                              </div>
                            ) : (
                              <div className="whitespace-pre-wrap font-mono text-xs bg-gray-50 p-2 rounded border border-gray-200">{rec.medications_on_discharge || 'As per prescription.'}</div>
                            )}
                          </div>
                          <div className="grid grid-cols-2 gap-8 text-[13px] break-inside-avoid">
                            <div>
                              <h3 className="font-black uppercase text-sm mb-2">Diet & activity</h3>
                              <div className="text-gray-700 whitespace-pre-wrap uppercase">{rec.diet_advice || rec.activity_advice ? <>{rec.diet_advice && <p>{rec.diet_advice}</p>}{rec.activity_advice && <p>{rec.activity_advice}</p>}</> : <span className="text-gray-400">—</span>}</div>
                              {rec.wound_care_instructions && <p className="mt-2"><span className="font-bold text-black">Wound care:</span> <span className="uppercase">{rec.wound_care_instructions}</span></p>}
                              {rec.stitch_removal_date && <p className="mt-1"><span className="font-bold text-black">Stitch removal:</span> {format(new Date(`${rec.stitch_removal_date}T12:00:00`), 'd/M/yyyy')}</p>}
                            </div>
                            <div>
                              <h3 className="font-black uppercase text-sm mb-2">Follow-up & warnings</h3>
                              <div className="text-gray-700 whitespace-pre-wrap uppercase font-bold">{rec.follow_up_advice || rec.warning_signs ? <>{rec.follow_up_advice && <p>{rec.follow_up_advice}</p>}{rec.warning_signs && <p className="text-red-700 font-bold">{rec.warning_signs}</p>}</> : <span className="text-gray-400">—</span>}</div>
                              {(rec.next_follow_up_date || rec.follow_up_doctor) && (
                                <p className="mt-2 text-black font-bold">Next visit: {rec.next_follow_up_date ? format(new Date(`${rec.next_follow_up_date}T12:00:00`), 'd/M/yyyy') : '—'} {rec.follow_up_doctor ? `· ${rec.follow_up_doctor}` : ''} {rec.follow_up_department ? `(${rec.follow_up_department})` : ''}</p>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>

                      {rec.discharge_type === 'death' && (rec.cause_of_death || rec.time_of_death) && (
                        <div className="mt-6 border-2 border-red-300 rounded p-3 break-inside-avoid page-break-inside-avoid" style={{ pageBreakInside: 'avoid' }}>
                          <h3 className="font-black uppercase text-red-800 text-sm mb-2">Death summary</h3>
                          <div className="text-xs space-y-1 whitespace-pre-wrap">
                            {rec.cause_of_death && <p><span className="font-bold">Cause:</span> {rec.cause_of_death}</p>}
                            {rec.time_of_death && <p><span className="font-bold">Time:</span> {formatDateTime(rec.time_of_death)}</p>}
                            {rec.notified_to && <p><span className="font-bold">Notified to:</span> {rec.notified_to}</p>}
                            {rec.autopsy_required && <p className="font-bold text-red-700">Autopsy required: Yes</p>}
                          </div>
                        </div>
                      )}

                      {/* <div className="mt-10 mb-6 break-inside-avoid discharge-signatures-row"> */}
                      <div className="mt-auto pt-6 flex justify-between items-end border-t border-gray-200 break-inside-avoid gap-8">
                        <div className="flex justify-between items-end gap-8 mx-2 mt-8">
                          <div className="text-[10px] text-gray-400 font-medium flex-1">
                            {(rec.patient_education_given || rec.attendant_counselled_by) && (
                              <p>Patient education: {rec.patient_education_given ? 'Yes' : 'No'}{rec.attendant_counselled_by ? ` · Counselled by: ${rec.attendant_counselled_by}` : ''}</p>
                            )}
                          </div>
                          <div className="text-center w-44">
                            <div className="h-10 flex items-center justify-center italic text-gray-200 text-[10px]">Signature</div>
                            <div className="border-t border-black pt-1 font-black text-[11px] uppercase tracking-wider">{rec.treating_consultant || 'Consultant'}</div>
                          </div>
                          <div className="text-center w-44">
                            <div className="h-10 flex items-center justify-center italic text-gray-200 text-[10px]">Signature</div>
                            <div className="border-t border-black pt-1 font-black text-[11px] uppercase tracking-wider">{rec.rmo_signed_by || 'RMO'}</div>
                          </div>
                        </div>
                      </div>
                      <span id="discharge-print-end-marker" aria-hidden="true" className="block h-0 w-0 overflow-hidden" />
                    </div>
                  </td>
                </tr>
              </tbody>
              <tfoot className="table-footer-group">
                <tr>
                  <td className="">
                    {dischargePrintFooterBar}
                  </td>
                </tr>
              </tfoot>
            </table>
      </div>
        </div>
      </div>

      <style>{`
        .discharge-data-grid {
          display: grid;
          width: 100%;
          border: 1px solid #000;
        }
        .discharge-data-grid--lab { grid-template-columns: 2fr 1fr 1fr 1fr; }
        .discharge-data-grid--img { grid-template-columns: 1.5fr 2fr 1fr; }
        .discharge-data-grid--med { grid-template-columns: 2fr 0.8fr 0.8fr 0.8fr 0.8fr 1.5fr; }
        .discharge-data-grid__head,
        .discharge-data-grid__cell {
          border: 1px solid #000;
          padding: 6px 8px;
          margin: -1px 0 0 -1px;
        }
        .discharge-data-grid__head {
          background: #f3f4f6;
          font-weight: 700;
        }
        #print-discharge-container,
        #__discharge_doc_root {
          --discharge-print-total-pages: 1;
        }
        @media print {
          @page {
            size: A4 portrait;
            margin: 0 0 6mm 0;
            @bottom-left {
              content: "";
              -webkit-print-color-adjust: exact;
              print-color-adjust: exact;
            }
            @bottom-center {
              content: "";
              -webkit-print-color-adjust: exact;
              print-color-adjust: exact;
            }
            @bottom-right {
              content: counter(page) " of " counter(pages);
              -webkit-print-color-adjust: exact;
              print-color-adjust: exact;
              font-family: Arial, Helvetica, sans-serif;
              font-size: 12px;
              color: #000;
              padding-right: 8mm;
              padding-top: 0mm;
              padding-bottom: 2mm;
            }
          }
          body, html { background: #fff !important; height: auto !important; overflow: visible !important; }
          body * { visibility: hidden !important; }
          #__discharge_doc_root, #__discharge_doc_root * { visibility: visible !important; }
          #__discharge_doc_root {
            position: absolute !important;
            left: 0 !important;
            top: 0 !important;
            width: 100% !important;
            display: block !important;
            overflow: visible !important;
            height: auto !important;
            padding: 0 !important;
            margin: 0 !important;
            zoom: 1;
          }
          body > *:not(#__discharge_doc_root):not(#__ipd_ledger_root) { display: none !important; }
          #__discharge_doc_root > div:first-of-type { margin: 0 !important; box-shadow: none !important; border: none !important; max-height: none !important; overflow: visible !important; }
          .print\\:hidden, .print\\:hidden * { display: none !important; visibility: hidden !important; }
          #print-discharge-container {
            position: static !important;
            width: 100% !important;
            margin: 0 !important;
            padding: 0 !important;
          }
          #print-discharge-container > table.discharge-print-table {
            width: 100%;
            border-collapse: collapse;
            border-spacing: 0;
          }
          #print-discharge-container > table.discharge-print-table thead {
            display: table-header-group;
          }
          #print-discharge-container > table.discharge-print-table tfoot {
            display: table-footer-group !important;
          }
          #print-discharge-container > table.discharge-print-table tbody {
            display: table-row-group;
          }
          #print-discharge-container > table.discharge-print-table thead td,
          #print-discharge-container > table.discharge-print-table tfoot td,
          #print-discharge-container > table.discharge-print-table tbody td {
            padding-left: 0;
            padding-right: 0;
          }
          .discharge-print-footer {
            background-color: #e6f0fa !important;
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
          }
          .discharge-print-page-slot {
            display: none !important;
          }
          .page-content {
            min-height: calc(var(--discharge-print-total-pages, 1) * var(--discharge-usable-h, 900px) - 40px);
          }
          .discharge-data-grid__head {
            background-color: #f3f4f6 !important;
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
          }
        }
      `}</style>
    </div>
  )

  return (
    <>
      {embedded ? content : createPortal(content, document.body)}
      {!onPrintBill && billPrintTarget && (
        <PrintIpdLedger admission={billPrintTarget.admission} ledger={billPrintTarget.ledger} dischargeSummary={billPrintTarget.dischargeSummary} onClose={() => setBillPrintTarget(null)} />
      )}
    </>
  )
}

function compareDischargeSummariesNewestFirst(a, b) {
  const timeFor = (rec) => {
    const candidates = [
      rec?.updated_at,
      rec?.discharged_at,
      rec?.discharge_date ? `${rec.discharge_date}T${rec.discharge_time || '00:00:00'}` : null,
      rec?.created_at,
    ]
    for (const raw of candidates) {
      if (!raw) continue
      const stamp = new Date(raw)
      if (!Number.isNaN(stamp.getTime())) return stamp.getTime()
    }
    return 0
  }
  const diff = timeFor(b) - timeFor(a)
  if (diff !== 0) return diff
  return String(b?.id || '').localeCompare(String(a?.id || ''))
}

function DischargeSection() {
  const isMobile = useIsMobile()
  const [records, setRecords] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(0)
  const [discDateFrom, setDiscDateFrom] = useState('')
  const [discDateTo, setDiscDateTo] = useState('')
  const PAGE_SIZE = 10
  const [editSummaryAdmission, setEditSummaryAdmission] = useState(null)
  const [loadingEditAdmission, setLoadingEditAdmission] = useState(false)
  const [editingDischargedAdmission, setEditingDischargedAdmission] = useState(null)
  const [editingDischargeRecord, setEditingDischargeRecord] = useState(null)
  const [loadingDischargedEdit, setLoadingDischargedEdit] = useState(false)
  const [doctors, setDoctors] = useState([])
  const [departments, setDepartments] = useState([])

  useEffect(() => {
    setPage(0)
  }, [search])
  const [printData, setPrintData] = useState(null)
  const [billPrintTarget, setBillPrintTarget] = useState(null)
  const [billPrintLoading, setBillPrintLoading] = useState(false)

  useEffect(() => { 
    fetchDischarged()
    fetchDoctors()
    fetchDepartments()
  }, [])

  async function fetchDoctors() {
    try {
      const { data } = await api.get('/doctor-profiles/?limit=500')
      setDoctors(data?.data || data?.results || data || [])
    } catch {}
  }

  async function fetchDepartments() {
    try {
      const { data } = await api.get('/departments/?limit=500')
      setDepartments(Array.isArray(data?.data) ? data.data : (data?.results || data || []))
    } catch {}
  }

  useEffect(() => {
    function handleRefreshAdmissions() {
      fetchDischarged()
    }
    window.addEventListener('refresh-admissions', handleRefreshAdmissions)
    return () => window.removeEventListener('refresh-admissions', handleRefreshAdmissions)
  }, [])

  async function fetchDischarged() {
    setLoading(true)
    try {
      const { data } = await api.get('/summaries/', { params: { is_draft: false, limit: 500 } })
      const list = (data?.data || data?.results || data || []).filter((r) => r.is_draft === false)
      setRecords([...list].sort(compareDischargeSummariesNewestFirst))
    } catch { toast.error('Failed to load discharge records') }
    finally { setLoading(false) }
  }


  async function handlePrintClick(rec) {
    try {
      const admissionId = typeof rec.admission === 'object' && rec.admission != null
        ? (rec.admission.id || rec.admission)
        : rec.admission
      const [{ data: sumRes }, { data: admRes }] = await Promise.all([
        api.get(`/summaries/${rec.id}/`),
        admissionId
          ? api.get(`/ipd-admissions/${admissionId}/`)
          : Promise.resolve({ data: null }),
      ])
      const fullRec = sumRes?.data || sumRes || rec
      const admission = admRes?.data || admRes || {}
      setPrintData({ rec: fullRec, admission })
    } catch {
      setPrintData({ rec })
    }
  }

  async function handlePrintBillFromHistory(r) {
    if (!r?.admission) {
      toast.error('Missing admission for this record')
      return
    }
    setBillPrintLoading(true)
    try {
      const [{ data: admissionRes }, { data: ledgerRes }] = await Promise.all([
        api.get(`/ipd-admissions/${r.admission}/`),
        api.get(`/ipd-admissions/${r.admission}/ledger/`),
      ])
      setBillPrintTarget({
        admission: admissionRes?.data || admissionRes || {},
        ledger: ledgerRes?.data || ledgerRes || {},
        dischargeSummary: r,
      })
    } catch {
      toast.error('Could not load bill for printing')
    } finally {
      setBillPrintLoading(false)
    }
  }

  async function openDischargeSummaryEdit(rec) {
    if (!rec?.admission) {
      toast.error('Missing admission for this record')
      return
    }
    setLoadingEditAdmission(true)
    try {
      const { data } = await api.get(`/ipd-admissions/${rec.admission}/`)
      setEditSummaryAdmission(data?.data || data || null)
    } catch {
      toast.error('Could not load admission to edit summary')
    } finally {
      setLoadingEditAdmission(false)
    }
  }

  async function openDischargedAdmissionEdit(rec) {
    if (!rec?.admission) {
      toast.error('Missing admission for this record')
      return
    }
    setLoadingDischargedEdit(true)
    try {
      const { data } = await api.get(`/ipd-admissions/${rec.admission}/`)
      setEditingDischargedAdmission(data?.data || data || null)
      setEditingDischargeRecord(rec)
    } catch {
      toast.error('Could not load admission to edit')
    } finally {
      setLoadingDischargedEdit(false)
    }
  }

  const filteredHistory = records.filter(r => {
    const q = search.toLowerCase()
    const matchSearch = !q || (r.patient_name || '').toLowerCase().includes(q) || (r.patient_uhid || '').toLowerCase().includes(q)
    if (!matchSearch) return false
    if (discDateFrom || discDateTo) {
      const recDate = r.discharge_date || r.admission_date || (r.created_at ? r.created_at.slice(0, 10) : '')
      if (discDateFrom && recDate < discDateFrom) return false
      if (discDateTo && recDate > discDateTo) return false
    }
    return true
  }).sort(compareDischargeSummariesNewestFirst)

  const total = filteredHistory.length
  const totalPages = Math.ceil(total / PAGE_SIZE)
  const paginatedHistory = filteredHistory.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)

  return (
    <div className={`flex-1 min-h-0 flex flex-col overflow-hidden ${isMobile ? '' : 'space-y-4'}`}>
      {editSummaryAdmission && (
        <AdmissionLedgerModal
          admission={editSummaryAdmission}
          onClose={() => setEditSummaryAdmission(null)}
          autoOpenDischargeEdit
        />
      )}
      {editingDischargedAdmission && (
        <EditAdmissionModal
          admission={editingDischargedAdmission}
          dischargeRecord={editingDischargeRecord}
          mode="discharged"
          doctors={doctors}
          departments={departments}
          onClose={() => {
            setEditingDischargedAdmission(null)
            setEditingDischargeRecord(null)
          }}
          onSaved={() => {
            setEditingDischargedAdmission(null)
            setEditingDischargeRecord(null)
            fetchDischarged()
          }}
        />
      )}
      {printData && (
        <PrintDischargeSummary
          rec={printData.rec}
          admission={printData.admission}
          onClose={() => setPrintData(null)}
          onPrintBill={handlePrintBillFromHistory}
          externalPrintBillLoading={billPrintLoading}
          onBeforePrintDocument={() => setBillPrintTarget(null)}
        />
      )}
      {billPrintTarget && (
        <PrintIpdLedger admission={billPrintTarget.admission} ledger={billPrintTarget.ledger} dischargeSummary={billPrintTarget.dischargeSummary} onClose={() => setBillPrintTarget(null)} />
      )}

      {/* ── Discharge History ── */}
      {!isMobile && (
        <div className="grid grid-cols-2 gap-3 mb-3 shrink-0">
          {[['Total Discharges', total, 'text-gray-900'], ['Showing', total === 0 ? '0' : `${page * PAGE_SIZE + 1}-${Math.min((page + 1) * PAGE_SIZE, total)}`, 'text-blue-600']].map(([l, v, c]) => (
            <div key={l} className="bg-white rounded-xl p-3 shadow-sm border border-gray-100 flex items-center gap-3">
              <div className="min-w-0">
                <p className="text-[11px] font-medium text-gray-400 uppercase tracking-wide">{l}</p>
                <p className={`text-2xl font-black ${c}`}>{v}</p>
              </div>
            </div>
          ))}
        </div>
      )}

      <section className={`bg-white shadow-sm border border-gray-100 flex flex-col min-h-0 flex-1 overflow-hidden ${isMobile ? 'rounded-none border-x-0' : 'rounded-2xl'}`}>
        {isMobile ? (
          <MobileListFilters
            search={search}
            onSearchChange={setSearch}
            dateFrom={discDateFrom}
            dateTo={discDateTo}
            onDateFromChange={setDiscDateFrom}
            onDateToChange={setDiscDateTo}
            onClearDates={() => { setDiscDateFrom(''); setDiscDateTo('') }}
            loading={loading}
            total={total}
            totalLabel="discharges"
            searchPlaceholder="Search discharge history…"
            onRefresh={fetchDischarged}
          />
        ) : (
        <div className="px-4 py-3 border-b border-gray-100 flex items-center gap-2 bg-gray-50/50 flex-wrap shrink-0">
          <Search size={16} className="text-gray-400 shrink-0" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search discharge history..."
            className="flex-1 min-w-[120px] text-sm outline-none bg-transparent" />
          <span className="w-px h-4 bg-gray-200 shrink-0" />
          <div className="flex items-center gap-1.5 shrink-0">
            <label className="text-[11px] text-gray-400 font-semibold uppercase tracking-wide shrink-0">From</label>
            <input
              type="date"
              value={discDateFrom}
              max={discDateTo || undefined}
              onChange={e => setDiscDateFrom(e.target.value)}
              className="text-xs border border-gray-200 rounded-lg px-2 py-1 text-gray-700 bg-white focus:outline-none focus:ring-2 focus:ring-emerald-400 focus:border-emerald-400 transition-all cursor-pointer"
            />
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <label className="text-[11px] text-gray-400 font-semibold uppercase tracking-wide shrink-0">To</label>
            <input
              type="date"
              value={discDateTo}
              min={discDateFrom || undefined}
              onChange={e => setDiscDateTo(e.target.value)}
              className="text-xs border border-gray-200 rounded-lg px-2 py-1 text-gray-700 bg-white focus:outline-none focus:ring-2 focus:ring-emerald-400 focus:border-emerald-400 transition-all cursor-pointer"
            />
          </div>
          {(discDateFrom || discDateTo) && (
            <button
              onClick={() => { setDiscDateFrom(''); setDiscDateTo('') }}
              className="text-[11px] font-bold text-red-500 hover:text-red-700 bg-red-50 hover:bg-red-100 px-2 py-1 rounded-lg transition-colors border border-red-100 shrink-0"
            >
              ✕ Clear
            </button>
          )}
          <span className="w-px h-4 bg-gray-200 shrink-0" />
          <button onClick={fetchDischarged} className="text-gray-400 hover:text-emerald-600 shrink-0"><RefreshCw size={14} /></button>
        </div>
        )}
        {loading ? (
          <div className="text-center py-10 text-gray-400 text-sm italic">Loading history...</div>
        ) : filteredHistory.length === 0 ? (
          <div className="text-center py-10 text-gray-400 text-sm">No discharge records found</div>
        ) : isMobile ? (
          <MobileCardList>
            {paginatedHistory.map((r) => {
              const outstanding = Number(r.outstanding_balance || 0)
              const balanceTone = r.scheme_name ? 'scheme' : outstanding > 0 ? 'due' : 'clear'
              return (
                <DischargeHistoryMobileCard
                  key={r.id}
                  row={r}
                  admissionDateLabel={formatAdmissionDateLabel(r.admission_date)}
                  schemeName={r.scheme_name}
                  balanceAmount={outstanding.toLocaleString()}
                  balanceTone={balanceTone}
                  onEditAdmission={() => openDischargedAdmissionEdit(r)}
                  onEditSummary={() => openDischargeSummaryEdit(r)}
                  onPrintBill={() => handlePrintBillFromHistory(r)}
                  onViewSlip={() => handlePrintClick(r)}
                  editAdmissionDisabled={loadingDischargedEdit}
                  editSummaryDisabled={loadingEditAdmission}
                  billPrintDisabled={billPrintLoading}
                />
              )
            })}
          </MobileCardList>
        ) : (
          <div className="divide-y divide-gray-50 flex-1 overflow-y-auto min-h-0">
            {paginatedHistory.map(r => (
              <div key={r.id} className="px-4 py-3 flex items-center gap-3 hover:bg-gray-50 transition-colors">
                <div className="w-10 h-10 rounded-xl bg-blue-100 text-blue-700 flex items-center justify-center font-bold text-lg">
                  {r.patient_name ? r.patient_name[0].toUpperCase() : <FileText size={18} />}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-gray-800">{r.patient_name || 'Unknown Patient'}</p>
                  <p className="text-xs text-gray-400">
                    Adm: {formatAdmissionDateLabel(r.admission_date)} · ID: {r.id.slice(0,8)}
                  </p>
                </div>
                <div className="text-right mr-4">
                  {r.scheme_name ? (
                    <span className="text-xs px-2 py-0.5 rounded-full font-bold uppercase tracking-wider bg-yellow-400 text-yellow-950 border border-yellow-300">
                      Scheme: {r.scheme_name}
                    </span>
                  ) : (
                    <span className={`text-xs px-2 py-0.5 rounded-full font-bold uppercase tracking-wider ${parseFloat(r.outstanding_balance) > 0 ? 'bg-red-50 text-red-600 border border-red-100' : 'bg-emerald-50 text-emerald-700 border border-emerald-100'}`}>
                      Balance: ₹{Number(r.outstanding_balance).toLocaleString()}
                    </span>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => openDischargedAdmissionEdit(r)}
                  disabled={loadingDischargedEdit}
                  className="text-xs bg-amber-100 text-amber-700 px-2 py-1 rounded-lg hover:bg-amber-200 font-semibold flex items-center gap-1 disabled:opacity-50"
                >
                  <Edit2 size={12} /> Edit
                </button>
                <button
                  type="button"
                  onClick={() => openDischargeSummaryEdit(r)}
                  disabled={loadingEditAdmission}
                  className="text-xs bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-200 px-3 py-1.5 rounded-lg font-bold flex items-center gap-2 transition-colors disabled:opacity-50">
                  <Edit2 size={15} /> Edit summary
                </button>
                <div
                  className="inline-flex rounded-xl border border-teal-200/70 bg-white shadow-sm overflow-hidden shrink-0"
                  role="group"
                  aria-label="Bill and discharge slip"
                >
                  <button
                    type="button"
                    onClick={() => handlePrintBillFromHistory(r)}
                    disabled={billPrintLoading}
                    title="Print IPD bill (A4)"
                    className="text-xs px-3 py-1.5 font-bold flex items-center gap-2 transition-colors disabled:opacity-50 border-0 border-r border-teal-200/80 bg-teal-50 text-teal-900 hover:bg-teal-100 active:bg-teal-100/90"
                  >
                    <Receipt size={15} /> Print bill
                  </button>
                  <button
                    type="button"
                    onClick={() => handlePrintClick(r)}
                    className="text-xs px-3 py-1.5 font-bold flex items-center gap-2 transition-colors border-0 bg-sky-50 text-sky-900 hover:bg-sky-100 active:bg-sky-100/90"
                  >
                    <Printer size={15} /> View Details & Slip
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Pagination */}
      {filteredHistory.length > 0 && !loading && (
        <div className={`flex items-center justify-between py-1 shrink-0 ${isMobile ? 'px-3 pb-2 bg-white border-t border-gray-100' : 'px-1'}`}>
          <span className="text-sm text-gray-400 font-medium">
            {total === 0 ? 'No records found' : `Showing ${page * PAGE_SIZE + 1}–${Math.min((page + 1) * PAGE_SIZE, total)} of ${total}`}
          </span>
          <div className="flex items-center gap-2">
            <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0}
              className="px-4 py-1.5 rounded-full text-sm font-semibold bg-gray-200 text-gray-700 hover:bg-gray-300 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
              Previous
            </button>
            <span className="text-sm text-gray-500 font-medium px-1">
              Page {page + 1} of {totalPages || 1}
            </span>
            <button onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))} disabled={page >= totalPages - 1 || totalPages === 0}
              className="px-4 py-1.5 rounded-full text-sm font-semibold bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
              Next
            </button>
          </div>
        </div>
      )}


    </div>
  )
}

function printPaymentSlipImmediately(invoice, options = {}) {
  const { onComplete, targetWindow = null } = options
  const dateTimeStr = invoice.paid_at
    ? formatDateTime(invoice.paid_at, {})
    : formatDateTime(new Date(), {})
  const patientName = [invoice.patient?.first_name, invoice.patient?.last_name].filter(Boolean).join(' ').toUpperCase() || 'PATIENT'
  const genderAge = formatPaymentSlipGenderAge(invoice.patient || {})
  const guardianLine = formatPaymentSlipGuardianLine(invoice.patient || {})
  const attributedDoctor = formatPaymentSlipAttributedDoctor(invoice.attributedDoctor || invoice.referredBy || '')
  const payModeLabel = invoice.paymentMode === 'cash'
    ? 'Cash Payment'
    : invoice.paymentMode === 'card'
      ? 'Card Payment'
      : invoice.paymentMode === 'upi'
        ? 'UPI Payment'
        : 'Credit / Due'
  const slipProfile = getPaymentSlipProfile()
  const logoUrl = resolvePaymentSlipLogoUrl(slipProfile)
  const profileLines = buildPaymentSlipProfileLines(slipProfile, escapeHtml)
  const slipItems = Array.isArray(invoice.items) ? invoice.items : []
  const isCredit = invoice.paymentMode === 'credit'

  const docHtml = buildPaymentSlipDocumentHtml({
    title: `Receipt — ${invoice.invoice_no}`,
    hospitalName: slipProfile.hospital_name || DEFAULT_PAYMENT_SLIP_PROFILE.hospital_name,
    logoUrl,
    profileLines,
    escapeHtml,
    slipNumber: invoice.slip_number || '--',
    invoiceNumber: invoice.invoice_no,
    patientName,
    genderAge,
    payModeLabel,
    mobile: invoice.patient?.phone || '—',
    dateTimeStr,
    guardianLine,
    attributedDoctor,
    referredBy: invoice.referredBy || '',
    purpose: invoice.purpose || '',
    lineItems: slipItems,
    subtotal: invoice.subtotal,
    discount: invoice.discountAmt,
    total: invoice.total,
    isCredit,
    paidBoxLabel: isCredit ? 'CREDIT / DUE' : '✓ PAID',
    // On mobile the print trigger comes from patchHtmlForMobile. The desktop close-script does
    // window.location.replace('about:blank') on afterprint/focus to close the tab — but Android
    // renders the live DOM into the print preview and fires those events as the dialog opens,
    // which blanks the preview. So omit it for the mobile route.
    printCloseScript: targetWindow ? '' : PAYMENT_SLIP_PRINT_CLOSE_SCRIPT,
  })

  // Mobile: the caller already opened /print-slip?job=payment synchronously (targetWindow). That
  // page is polling localStorage for the finished slip — hand it the fully mobile-patched HTML.
  // Fall back to writing directly into the tab if localStorage is unavailable.
  if (targetWindow || shouldUseDedicatedPrintDocument()) {
    deliverMobilePrintHtml(docHtml, {
      targetWindow: shouldUseDedicatedPrintDocument() ? null : targetWindow,
      storageKey: shouldUseDedicatedPrintDocument() ? null : 'payment-slip-print-job',
      onComplete,
    })
    return
  }

  const w = createSameTabPrintWindow({ onComplete })
  w.document.write(docHtml)
  w.document.close()
}

// ─── Payment Slip ─────────────────────────────────────────────────────────────
function PaymentSlipSection() {
  const isMobile = useIsMobile()
  const [paymentDetailsExpanded, setPaymentDetailsExpanded] = useState(false)
  const [ptSearch, setPtSearch] = useState('')
  const [ptResults, setPtResults] = useState([])
  const [ptSearching, setPtSearching] = useState(false)
  const [patient, setPatient] = useState(null)
  const [items, setItems] = useState([{ description: '', unit_price: '', quantity: 1, category: '' }])
  const [discount, setDiscount] = useState('')
  const [paymentMode, setPaymentMode] = useState('cash')
  const [encounterType, setEncounterType] = useState('opd')
  const [referredBy, setReferredBy] = useState('')
  const [purpose, setPurpose] = useState('')
  const [paidAt, setPaidAt] = useState(() => toDateTimeInputValue(new Date()))
  const [submitting, setSubmitting] = useState(false)
  const [slipDoctors, setSlipDoctors] = useState([])
  const [collectionAttribution, setCollectionAttribution] = useState('hospital_self')
  const [attributedDoctorUser, setAttributedDoctorUser] = useState('')

  const [isAddingNew, setIsAddingNew] = useState(false)
  const [newPt, setNewPt] = useState({ search: '' })
  const [quickServices, setQuickServices] = useState(DEFAULT_QUICK_SERVICES)
  const [quickCategoryExtras, setQuickCategoryExtras] = useState([])
  const [activeQuickCategory, setActiveQuickCategory] = useState(QUICK_SERVICE_ALL_CATEGORY)
  const [showQuickServiceEditor, setShowQuickServiceEditor] = useState(false)
  const [newQuickLabel, setNewQuickLabel] = useState('')
  const [newQuickPrice, setNewQuickPrice] = useState('')
  const [newQuickCategory, setNewQuickCategory] = useState(QUICK_SERVICE_DEFAULT_CATEGORY)
  const [newQuickCategoryName, setNewQuickCategoryName] = useState('')
  const [activeServiceSearchRow, setActiveServiceSearchRow] = useState(null)
  const [editorQuickCategory, setEditorQuickCategory] = useState(QUICK_SERVICE_DEFAULT_CATEGORY)
  const [showCategoryCreator, setShowCategoryCreator] = useState(false)
  const [showQuickItemCreator, setShowQuickItemCreator] = useState(false)
  const [draggingQuickIndex, setDraggingQuickIndex] = useState(null)
  const [activeIpdByPatient, setActiveIpdByPatient] = useState({})
  const ptSearchAnchorRef = useRef(null)
  const [ptDropdownPos, setPtDropdownPos] = useState(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const { services, categories } = await loadPaymentQuickServices()
      if (cancelled) return
      if (services) setQuickServices(services)
      if (categories.length > 0) setQuickCategoryExtras(categories)
    })()
    return () => {
      cancelled = true
    }
  }, [])

  async function persistQuickServices(nextList, extraCategoriesOverride = null) {
    const payload = normalizeQuickServices(nextList)
    const categorySet = new Set([QUICK_SERVICE_DEFAULT_CATEGORY])
    const extraCategories = Array.isArray(extraCategoriesOverride) ? extraCategoriesOverride : quickCategoryExtras
    extraCategories.forEach(c => categorySet.add(String(c || '').trim()))
    payload.forEach(svc => categorySet.add(String(svc.category || QUICK_SERVICE_DEFAULT_CATEGORY).trim() || QUICK_SERVICE_DEFAULT_CATEGORY))
    const categoriesPayload = Array.from(categorySet).filter(c => c && c !== QUICK_SERVICE_ALL_CATEGORY)
    setQuickServices(payload)
    localStorage.setItem(QUICK_SERVICES_STORAGE_KEY, JSON.stringify(payload))
    try {
      await api.put('/payments/quick-services/', { services: payload, categories: categoriesPayload })
    } catch {
      toast.error('Could not sync quick services to server')
    }
  }
  const quickServiceCategories = useMemo(() => {
    const seen = new Set([QUICK_SERVICE_DEFAULT_CATEGORY])
    quickCategoryExtras.forEach(cat => seen.add(String(cat || '').trim()))
    quickServices.forEach(svc => seen.add(String(svc.category || QUICK_SERVICE_DEFAULT_CATEGORY)))
    return [QUICK_SERVICE_ALL_CATEGORY, ...Array.from(seen)]
  }, [quickCategoryExtras, quickServices])

  const visibleQuickServices = useMemo(() => {
    if (activeQuickCategory === QUICK_SERVICE_ALL_CATEGORY) return quickServices
    return quickServices.filter(svc => String(svc.category || QUICK_SERVICE_DEFAULT_CATEGORY) === activeQuickCategory)
  }, [activeQuickCategory, quickServices])

  useEffect(() => {
    if (!quickServiceCategories.includes(activeQuickCategory)) {
      setActiveQuickCategory(QUICK_SERVICE_ALL_CATEGORY)
    }
  }, [activeQuickCategory, quickServiceCategories])
  useEffect(() => {
    const allowed = quickServiceCategories.filter(c => c !== QUICK_SERVICE_ALL_CATEGORY)
    if (!allowed.includes(newQuickCategory)) {
      setNewQuickCategory(QUICK_SERVICE_DEFAULT_CATEGORY)
    }
  }, [newQuickCategory, quickServiceCategories])
  useEffect(() => {
    const allowed = quickServiceCategories.filter(c => c !== QUICK_SERVICE_ALL_CATEGORY)
    if (!allowed.includes(editorQuickCategory)) {
      setEditorQuickCategory(QUICK_SERVICE_DEFAULT_CATEGORY)
    }
  }, [editorQuickCategory, quickServiceCategories])

  useEffect(() => {
    if (ptSearch.trim().length < 2) { setPtResults([]); return }
    const t = setTimeout(async () => {
      setPtSearching(true)
      try {
        const { data } = await api.get(`/patients/?search=${encodeURIComponent(ptSearch)}&limit=8`)
        setPtResults(Array.isArray(data?.data) ? data.data : (data?.results || []))
      } catch { setPtResults([]) }
      finally { setPtSearching(false) }
    }, 400)
    return () => clearTimeout(t)
  }, [ptSearch])

  const showPtDropdown = !patient && (ptResults.length > 0 || (ptSearch.length > 1 && !ptSearching))

  const updatePtDropdownPos = useCallback(() => {
    const el = ptSearchAnchorRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    setPtDropdownPos({ top: rect.bottom + 4, left: rect.left, width: rect.width })
  }, [])

  useEffect(() => {
    if (!isMobile || !showPtDropdown) {
      setPtDropdownPos(null)
      return
    }
    updatePtDropdownPos()
    const onReposition = () => updatePtDropdownPos()
    window.addEventListener('resize', onReposition)
    window.addEventListener('scroll', onReposition, true)
    return () => {
      window.removeEventListener('resize', onReposition)
      window.removeEventListener('scroll', onReposition, true)
    }
  }, [isMobile, showPtDropdown, updatePtDropdownPos, ptResults, ptSearch, ptSearching, patient])

  useEffect(() => {
    fetchActiveIpdAdmissions()
  }, [])

  useEffect(() => {
    let cancelled = false
    async function loadSlipDoctors() {
      try {
        const { data } = await api.get('/doctor-profiles/?limit=500')
        if (cancelled) return
        const rows = Array.isArray(data?.data) ? data.data : (data?.results || data || [])
        setSlipDoctors(rows.filter((d) => d?.user))
      } catch {
        if (!cancelled) setSlipDoctors([])
      }
    }
    loadSlipDoctors()
    return () => { cancelled = true }
  }, [])

  const linkedAdmissionForPatient = patient ? (activeIpdByPatient[String(patient.id)] || null) : null
  const attributionLocked = !!linkedAdmissionForPatient?.assigned_doctor

  useEffect(() => {
    if (attributionLocked) {
      setCollectionAttribution('doctor')
      setAttributedDoctorUser(String(linkedAdmissionForPatient.assigned_doctor || ''))
    }
  }, [attributionLocked, linkedAdmissionForPatient?.id, linkedAdmissionForPatient?.assigned_doctor])

  function slipDoctorUserId(doc) {
    return String(doc?.user ?? doc?.user_id ?? '')
  }
  function slipDoctorLabel(doc) {
    return doc?.name || doc?.full_name || doc?.user_name || 'Doctor'
  }
  function resolveSlipAttributionLabel() {
    if (linkedAdmissionForPatient?.assigned_doctor_name) {
      return linkedAdmissionForPatient.assigned_doctor_name
    }
    if (collectionAttribution === 'doctor' && attributedDoctorUser) {
      const doc = slipDoctors.find((d) => slipDoctorUserId(d) === String(attributedDoctorUser))
      return doc ? slipDoctorLabel(doc) : 'Doctor'
    }
    return 'Self (Hospital)'
  }

  useEffect(() => {
    function handleRefreshAdmissions() {
      fetchActiveIpdAdmissions()
    }
    window.addEventListener('refresh-admissions', handleRefreshAdmissions)
    return () => window.removeEventListener('refresh-admissions', handleRefreshAdmissions)
  }, [])

  async function fetchActiveIpdAdmissions() {
    try {
      const { data } = await api.get('/ipd-admissions/?status=admitted&limit=500')
      const rows = sortAdmissionsLatestFirst(Array.isArray(data?.data) ? data.data : (data?.results || []))
      const byPatient = {}
      rows.forEach(adm => {
        const pid = String(adm?.patient || '')
        if (pid && !byPatient[pid]) byPatient[pid] = adm
      })
      setActiveIpdByPatient(byPatient)
    } catch {
      setActiveIpdByPatient({})
    }
  }

  function addItem() {
    setItems(prev => [...prev, { description: '', unit_price: '', quantity: 1, category: '' }])
  }
  function removeItem(i) {
    setItems(prev => {
      if (prev.length <= 1) {
        return [{ description: '', unit_price: '', quantity: 1, category: '' }]
      }
      const next = prev.filter((_, idx) => idx !== i)
      return next.length > 0 ? next : [{ description: '', unit_price: '', quantity: 1, category: '' }]
    })
  }
  function updateItem(i, field, val) {
    if (field === 'unit_price' || field === 'quantity') {
      if (val === '') {
        setItems(prev => prev.map((it, idx) => idx === i ? { ...it, [field]: val } : it))
        return
      }
      const numericVal = Number(val)
      if (!Number.isFinite(numericVal) || numericVal < 0) return
    }
    setItems(prev => prev.map((it, idx) => idx === i ? { ...it, [field]: val } : it))
  }
  function applyServiceSuggestion(rowIndex, suggestion) {
    const category = String(suggestion.category || QUICK_SERVICE_DEFAULT_CATEGORY).trim() || QUICK_SERVICE_DEFAULT_CATEGORY
    setItems(prev => {
      const next = prev.map((it, idx) => (
        idx === rowIndex
          ? { ...it, description: suggestion.label, unit_price: String(suggestion.price), category }
          : it
      ))
      const hasEmptyRow = next.some(it => !String(it.description || '').trim())
      if (!hasEmptyRow) {
        next.push({ description: '', unit_price: '', quantity: 1, category: '' })
      }
      return next
    })
    setActiveServiceSearchRow(null)
  }
  function quickAdd(svc) {
    const label = String(svc.label || '').trim()
    const price = Number(svc.price)
    const category = String(svc.category || QUICK_SERVICE_DEFAULT_CATEGORY).trim() || QUICK_SERVICE_DEFAULT_CATEGORY
    setItems(prev => {
      const sameIdx = prev.findIndex(
        it =>
          String(it.description || '').trim() === label &&
          Number.isFinite(price) &&
          Math.abs((parseFloat(String(it.unit_price)) || 0) - price) < 0.005
      )
      if (sameIdx !== -1) {
        return prev.map((it, i) => {
          if (i !== sameIdx) return it
          const q = parseFloat(String(it.quantity)) || 0
          return { ...it, quantity: q + 1, category: it.category || category }
        })
      }
      const empty = prev.findIndex(it => !it.description)
      if (empty !== -1) {
        return prev.map((it, i) => (i === empty ? { description: svc.label, unit_price: svc.price, quantity: 1, category } : it))
      }
      return [...prev, { description: svc.label, unit_price: svc.price, quantity: 1, category }]
    })
  }

  function addQuickService() {
    const label = newQuickLabel.trim()
    const price = parseFloat(newQuickPrice)
    const category = (newQuickCategory || QUICK_SERVICE_DEFAULT_CATEGORY).trim()
    if (!label) { toast.error('Service label is required'); return }
    if (Number.isNaN(price) || price < 0) { toast.error('Enter valid price'); return }
    if (!category) { toast.error('Select category'); return }
    const nextServices = [...quickServices, { label, price, category }]
    // Persist to DB immediately so it survives logout/browser close
    persistQuickServices(nextServices).catch(() => {})
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
    const exists = quickServiceCategories.some(cat => cat.toLowerCase() === normalized.toLowerCase())
    if (exists) {
      toast.error('Category already exists')
      return
    }
    setNewQuickCategory(normalized)
    setActiveQuickCategory(normalized)
    setEditorQuickCategory(normalized)
    const mergedCategories = Array.from(new Set([...quickCategoryExtras, normalized]))
    setQuickCategoryExtras(mergedCategories)
    localStorage.setItem(QUICK_SERVICE_CATEGORIES_STORAGE_KEY, JSON.stringify(mergedCategories))
    setNewQuickCategoryName('')
    setShowCategoryCreator(false)
    toast.success('Category added')
    // Persist categories to DB immediately — localStorage alone is lost on browser close/incognito
    persistQuickServices(quickServices, mergedCategories).catch(() => {})
  }

  function removeQuickService(index) {
    setQuickServices(prev => prev.filter((_, i) => i !== index))
  }
  function handleQuickServiceDrop(targetIndex) {
    if (draggingQuickIndex === null || draggingQuickIndex === targetIndex) return
    setQuickServices(prev => {
      if (draggingQuickIndex < 0 || draggingQuickIndex >= prev.length) return prev
      if (targetIndex < 0 || targetIndex >= prev.length) return prev
      const copy = [...prev]
      const [moved] = copy.splice(draggingQuickIndex, 1)
      copy.splice(targetIndex, 0, moved)
      return copy
    })
    setDraggingQuickIndex(null)
  }

  const editorCategories = useMemo(
    () => quickServiceCategories.filter(c => c !== QUICK_SERVICE_ALL_CATEGORY),
    [quickServiceCategories]
  )
  const editorQuickRows = useMemo(
    () => quickServices
      .map((svc, idx) => ({ svc, idx }))
      .filter(({ svc }) => String(svc.category || QUICK_SERVICE_DEFAULT_CATEGORY) === editorQuickCategory),
    [editorQuickCategory, quickServices]
  )
  const searchableServiceItems = useMemo(() => {
    const seen = new Set()
    const out = []
    quickServices.forEach(svc => {
      const label = String(svc?.label || '').trim()
      const price = Number(svc?.price || 0)
      if (!label || !Number.isFinite(price) || price < 0) return
      const key = label.toLowerCase()
      if (seen.has(key)) return
      seen.add(key)
      out.push({
        label,
        price,
        category: String(svc?.category || QUICK_SERVICE_DEFAULT_CATEGORY).trim() || QUICK_SERVICE_DEFAULT_CATEGORY,
      })
    })
    return out
  }, [quickServices])

  const consolidatedItems = useMemo(() => consolidatePaymentSlipItems(items), [items])

  const subtotal = consolidatedItems.reduce((sum, it) => sum + resolvePaymentSlipLineTotal(it), 0)
  const discountAmt = Math.min(parseFloat(discount) || 0, subtotal)
  const total = subtotal - discountAmt
  const selectedPatientHasActiveIpd = !!(patient && activeIpdByPatient[String(patient.id)])

  useEffect(() => {
    if (paymentMode === 'credit' && !selectedPatientHasActiveIpd) {
      setPaymentMode('cash')
    }
  }, [paymentMode, selectedPatientHasActiveIpd])

  async function handleSubmit(e) {
    e.preventDefault()
    if (paymentMode === 'credit' && !selectedPatientHasActiveIpd) {
      toast.error('Credit mode is available only for active IPD patients')
      return
    }
    
    let currentPatient = patient
    let targetPatientId = patient?.id

    if (isAddingNew) { toast.error('Complete patient registration popup first'); return }

    if (!targetPatientId) { toast.error('Select or create a patient first'); return }
    const validItems = consolidatedItems
    if (!validItems.length) { toast.error('Add at least one service with a price'); return }
    if (!paidAt || !dateTimeInputToIso(paidAt)) {
      toast.error('Enter a valid payment date and time')
      return
    }

    // Mobile: open a real, same-origin print page now — synchronously inside the click gesture so
    // the browser allows it. The slip HTML is produced only after the awaited API calls, so we
    // hand it to that page via localStorage; /print-slip?job=payment polls for it and prints.
    // (Writing into an about:blank tab is unreliable to print on mobile Chrome/Safari.)
    let targetWindow = null
    if (isMobileDevice()) {
      try { localStorage.removeItem('payment-slip-print-job') } catch { /* ignore */ }
      targetWindow = window.open('/print-slip?job=payment', '_blank')
    }

    setSubmitting(true)
    const paidAtIso = dateTimeInputToIso(paidAt) || new Date().toISOString()
    try {
      const linkedAdmission = activeIpdByPatient[String(targetPatientId)] || null
      const isCreditSlip = paymentMode === 'credit'
      const printAttributionLabel = linkedAdmission?.assigned_doctor_name
        || (collectionAttribution === 'doctor' && attributedDoctorUser
          ? slipDoctorLabel(slipDoctors.find((d) => slipDoctorUserId(d) === String(attributedDoctorUser)) || {})
          : 'Self (Hospital)')

      if (linkedAdmission && discountAmt <= 0) {
        let lastCharge = null
        for (const it of validItems) {
          const qty = parseFloat(it.quantity) || 1
          const unitPrice = parseFloat(it.unit_price)
          const lineTotal = qty * unitPrice
          const { data } = await api.post(`/ipd-admissions/${linkedAdmission.id}/add-charge/`, {
            description: it.description,
            amount: lineTotal,
            quantity: qty,
            unit_price: unitPrice,
            payment_mode: isCreditSlip ? 'credit' : mapIpdChargePaymentMode(paymentMode),
            paid_at: paidAtIso,
          })
          lastCharge = resolveAdmissionApiRow(data)
        }

        const slipItems = validItems.map(it => ({
          description: it.description,
          quantity: parseFloat(it.quantity) || 1,
          unit_price: parseFloat(it.unit_price),
          line_total: resolvePaymentSlipLineTotal(it),
        }))
        const paymentAmount = Number(parseFloat(lastCharge?.payment?.amount))
        const slipSubtotal = slipItems.reduce((sum, it) => sum + resolvePaymentSlipLineTotal(it), 0)
        const slipTotal = Number.isFinite(paymentAmount) && paymentAmount > 0
          ? paymentAmount
          : slipSubtotal
        printPaymentSlipImmediately({
          invoice_no: lastCharge?.invoice_no || 'IPD-Ledger',
          items: slipItems,
          slip_number: lastCharge?.payment?.slip_number || '',
          patient: currentPatient || { first_name: '', last_name: '', phone: '' },
          paymentMode,
          subtotal: slipSubtotal,
          discountAmt: 0,
          total: slipTotal,
          attributedDoctor: printAttributionLabel,
          purpose,
          paid_at: lastCharge?.payment?.paid_at || paidAtIso,
        }, { onComplete: resetForm, targetWindow })
        window.dispatchEvent(new Event('refresh-admissions'))
        toast.success(isCreditSlip ? 'Charge recorded on IPD ledger (due).' : 'Payment slip recorded on IPD ledger.')
        return
      }

      const payload = {
        patient: targetPatientId,
        encounter_type: encounterType,
        status: 'finalized',
        discount_amount: discountAmt.toFixed(2),
        ipd_admission: linkedAdmission?.id || null,
        items: validItems.map(it => ({
          description: it.description,
          quantity: parseFloat(it.quantity) || 1,
          unit_price: parseFloat(it.unit_price),
          category: it.category || '',
        })),
      }
      if (linkedAdmission?.assigned_doctor) {
        payload.attribution_type = 'doctor'
        payload.attributed_doctor_user = linkedAdmission.assigned_doctor
      } else if (collectionAttribution === 'doctor' && attributedDoctorUser) {
        payload.attribution_type = 'doctor'
        payload.attributed_doctor_user = attributedDoctorUser
      } else {
        payload.attribution_type = 'hospital_self'
      }
      const { data } = await api.post('/invoices/', payload)
      const inv = data?.data || data?.entity || data

      // Always create a payment transaction so every slip is visible in Payment Slips.
      // Credit entries are stored as pending dues (amount due, not collected yet).
      const paymentRes = await api.post('/payments/', {
        invoice: inv.id,
        payment_mode: isCreditSlip ? 'other' : paymentMode,
        amount: total.toFixed(2),
        status: isCreditSlip ? 'pending' : 'success',
        paid_at: paidAtIso,
        transaction_reference: isCreditSlip
          ? `CREDIT DUE${(linkedAdmission?.ipd_no || linkedAdmission?.ipd_id || linkedAdmission?.admission_no)
            ? ` | IPD ID:${linkedAdmission?.ipd_no || linkedAdmission?.ipd_id || linkedAdmission?.admission_no}`
            : ''}`
          : '',
      })
      const paymentRecord = paymentRes?.data?.data || paymentRes?.data?.entity || paymentRes?.data

      printPaymentSlipImmediately({
        invoice_no: inv.invoice_no,
        items: validItems.map(it => ({
          description: it.description,
          quantity: parseFloat(it.quantity) || 1,
          unit_price: parseFloat(it.unit_price),
          line_total: resolvePaymentSlipLineTotal(it),
        })),
        slip_number: paymentRecord?.slip_number || '',
        patient: currentPatient || { first_name: '', last_name: '', phone: '' },
        paymentMode,
        subtotal,
        discountAmt,
        total,
        attributedDoctor: printAttributionLabel,
        purpose,
        paid_at: paymentRecord?.paid_at || paidAtIso,
      }, { onComplete: resetForm, targetWindow })
      toast.success(`Invoice ${inv.invoice_no} created!`)
      toast.success(paymentMode === 'credit' ? 'Credit slip generated and registered in Payment Slips!' : 'Payment slip recorded successfully!')
    } catch (err) {
      // Nothing was printed before the failure — close the blank tab we opened up front.
      if (targetWindow && !targetWindow.closed) targetWindow.close()
      toast.error(err.response?.data?.detail || JSON.stringify(err.response?.data) || 'Failed to create invoice')
    } finally { setSubmitting(false) }
  }

  function resetForm() {
    setPatient(null)
    setIsAddingNew(false)
    setNewPt({ search: '' })
    setPtSearch('')
    setItems([{ description: '', unit_price: '', quantity: 1, category: '' }])
    setDiscount('')
    setPaymentMode('cash')
    setReferredBy('')
    setPurpose('')
    setPaidAt(toDateTimeInputValue(new Date()))
  }

  const inp = 'w-full border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:ring-2 focus:ring-emerald-500 focus:outline-none'
  const itemInp =
    'w-full border border-gray-200 rounded-md px-2 py-1 text-[11px] leading-tight text-gray-900 placeholder:text-gray-400 focus:ring-2 focus:ring-emerald-500 focus:outline-none'
  const mobileItemInp =
    'w-full border border-gray-200 rounded-md px-2 py-1.5 text-[12px] leading-tight text-gray-900 placeholder:text-gray-400 focus:ring-2 focus:ring-emerald-500 focus:outline-none bg-white'

  const mobileBillingCardCls =
    'mx-2 rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden'
  const mobilePatientCardCls =
    'mx-2 rounded-xl border border-gray-200 bg-white shadow-sm overflow-visible relative z-20 px-2.5 py-2 shrink-0 mt-1'
  const sectionCardCls = isMobile
    ? `${mobileBillingCardCls} px-2.5 py-2 shrink-0 mt-1`
    : 'bg-white rounded-xl border border-gray-200 p-3 shrink-0'
  const servicesCardCls = isMobile
    ? `${mobileBillingCardCls} flex-1 min-h-0 flex flex-col px-2.5 py-2 mb-1`
    : 'bg-white rounded-xl border border-gray-200 p-3 flex-1 min-h-0 flex flex-col overflow-hidden'

  const paymentDetailFields = (
    <div className="space-y-3">
      <div>
        <label className="text-[11px] font-medium text-gray-400 block mb-1">Encounter type</label>
        <select value={encounterType} onChange={e => setEncounterType(e.target.value)} className={`${inp} py-1.5 text-xs`}>
          {[['opd','OPD'],['lab','Lab'],['pharmacy','Pharmacy'],['ipd','IPD'],['package','Package']].map(([v,l]) => (
            <option key={v} value={v}>{l}</option>
          ))}
        </select>
      </div>
      <div>
        <label className="text-[11px] font-medium text-gray-400 block mb-1">Payment date &amp; time</label>
        <input
          type="datetime-local"
          value={paidAt}
          onChange={e => setPaidAt(e.target.value)}
          className={`${inp} py-1.5 text-xs`}
        />
      </div>
      <div>
        <label className="text-[11px] font-medium text-gray-400 block mb-1">Payment mode</label>
        <div className="flex flex-wrap gap-1.5">
          {[
            ['cash', 'Cash'],
            ['card', 'Card'],
            ['upi', 'UPI'],
            ...(selectedPatientHasActiveIpd ? [['credit', 'Credit']] : []),
          ].map(([v,l]) => (
            <button key={v} type="button" onClick={() => setPaymentMode(v)}
              className={`flex-1 min-w-[4.5rem] py-2 rounded-lg border text-xs font-medium transition-colors ${paymentMode === v ? 'bg-emerald-600 text-white border-emerald-600' : 'border-gray-200 text-gray-600 hover:border-emerald-300'}`}>
              {l}
            </button>
          ))}
        </div>
      </div>
      <div>
        <label className="text-[11px] font-medium text-gray-400 block mb-1">Discount (₹)</label>
        <input type="number" min="0" step="1" value={discount} onChange={e => {
          const next = e.target.value
          if (next === '' || Number(next) >= 0) setDiscount(next)
        }}
          placeholder="0.00" className={`${inp} py-1.5 text-xs`} />
      </div>
      <div>
        <label className="text-[11px] font-medium text-gray-400 block mb-1">Collection for</label>
        {attributionLocked ? (
          <div className="py-1.5 px-2 rounded-lg border border-emerald-200 bg-emerald-50 text-xs font-semibold text-emerald-800">
            Dr. {linkedAdmissionForPatient?.assigned_doctor_name || 'Assigned doctor'} (IPD)
          </div>
        ) : (
          <select
            value={collectionAttribution === 'doctor' && attributedDoctorUser ? `doctor:${attributedDoctorUser}` : 'hospital_self'}
            onChange={(e) => {
              const val = e.target.value
              if (val === 'hospital_self') {
                setCollectionAttribution('hospital_self')
                setAttributedDoctorUser('')
              } else if (val.startsWith('doctor:')) {
                setCollectionAttribution('doctor')
                setAttributedDoctorUser(val.slice(7))
              }
            }}
            className={`${inp} py-1.5 text-xs`}
          >
            <option value="hospital_self">Self (Hospital)</option>
            {slipDoctors.map((d) => (
              <option key={slipDoctorUserId(d)} value={`doctor:${slipDoctorUserId(d)}`}>
                {slipDoctorLabel(d)}
              </option>
            ))}
          </select>
        )}
        <p className="text-[10px] text-gray-400 mt-1">Example: {resolveSlipAttributionLabel()}</p>
      </div>
      <div>
        <label className="text-[11px] font-medium text-gray-400 block mb-1">Purpose / Notes (optional)</label>
        <input value={purpose} onChange={e => setPurpose(e.target.value)}
          placeholder="e.g. Chest X-Ray, Follow-up…" className={`${inp} py-1.5 text-xs`} />
      </div>
    </div>
  )

  const totalsBlock = (
    <div className={`rounded-xl border border-gray-100 p-3 ${isMobile ? 'bg-white' : 'bg-gray-50'}`}>
      <div className="space-y-1.5">
        <div className="flex justify-between text-sm text-gray-500">
          <span>Subtotal</span><span>₹{subtotal.toFixed(2)}</span>
        </div>
        {discountAmt > 0 && (
          <div className="flex justify-between text-sm text-red-500">
            <span>Discount</span><span>−₹{discountAmt.toFixed(2)}</span>
          </div>
        )}
        <div className="flex justify-between font-bold text-gray-900 text-base border-t border-gray-200 pt-2 mt-1">
          <span>Total</span><span className="text-emerald-700">₹{total.toFixed(2)}</span>
        </div>
      </div>
    </div>
  )

  const patientDropdownListCls = isMobile
    ? 'bg-white rounded-xl shadow-xl border border-gray-100 divide-y divide-gray-50 max-h-[min(40vh,280px)] overflow-y-auto'
    : 'absolute z-50 mt-1 w-full bg-white rounded-xl shadow-xl border border-gray-100 divide-y divide-gray-50 max-h-44 overflow-y-auto'

  const patientDropdownList = showPtDropdown ? (
    <ul
      className={patientDropdownListCls}
      style={
        isMobile && ptDropdownPos
          ? {
              position: 'fixed',
              top: ptDropdownPos.top,
              left: ptDropdownPos.left,
              width: ptDropdownPos.width,
              zIndex: 9999,
            }
          : undefined
      }
    >
      {ptResults.map(p => (
        <li key={p.id}>
          <button
            type="button"
            onClick={() => { setPatient(p); setPtSearch(''); setPtResults([]) }}
            className="w-full text-left px-3 py-2 hover:bg-emerald-50/60 active:bg-emerald-50"
          >
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-medium text-gray-900 truncate">{[p.first_name, p.last_name].filter(Boolean).join(' ')}</p>
              {activeIpdByPatient[String(p.id)] && (
                <span className="text-[10px] font-black px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 border border-blue-200 whitespace-nowrap">
                  IPD ACTIVE
                </span>
              )}
            </div>
            <p className="text-xs text-gray-400">{p.uhid} · {p.phone || 'No phone'}</p>
          </button>
        </li>
      ))}
      <li className="bg-emerald-50/50">
        <button
          type="button"
          onClick={() => { setIsAddingNew(true); setNewPt({ search: ptSearch }); setPtSearch(''); setPtResults([]) }}
          className="w-full text-left px-3 py-2.5 flex items-center gap-2 group transition-all active:bg-emerald-50"
        >
          <div className="w-7 h-7 rounded-lg bg-emerald-600 text-white flex items-center justify-center group-hover:scale-110 transition-transform">
            <Plus size={14} strokeWidth={3} />
          </div>
          <div>
            <p className="text-xs font-black text-emerald-700 uppercase tracking-tight">Register as New Patient</p>
            <p className="text-[11px] text-emerald-600/70 font-bold italic truncate">"{ptSearch}"</p>
          </div>
        </button>
      </li>
    </ul>
  ) : null

  const patientBlock = (
    <div className={isMobile ? mobilePatientCardCls : 'bg-white rounded-xl border border-gray-200 p-3 shrink-0'}>
      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Patient</p>
      {patient ? (
        <div className="flex items-center gap-2.5 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">
          <div className="w-7 h-7 rounded-full bg-emerald-100 text-emerald-700 font-bold text-xs flex items-center justify-center shrink-0">
            {(patient.first_name?.[0] || '') + (patient.last_name?.[0] || '')}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-gray-900 break-words">{[patient.first_name, patient.last_name].filter(Boolean).join(' ')}</p>
            <p className="text-xs text-gray-400 break-all">{patient.uhid} · {patient.phone || 'No phone'}</p>
            {activeIpdByPatient[String(patient.id)] && (
              <p className="text-[10px] font-bold text-blue-700 mt-0.5">
                IPD Active · Bed {activeIpdByPatient[String(patient.id)]?.bed_code || '--'}
              </p>
            )}
          </div>
          <button type="button" onClick={() => setPatient(null)} className="text-gray-300 hover:text-red-500 shrink-0">
            <XCircle size={16} strokeWidth={1.8} />
          </button>
        </div>
      ) : (
        <div className="relative" ref={ptSearchAnchorRef}>
          <Search size={13} className="absolute left-2.5 top-2.5 text-gray-400" />
          <input
            value={ptSearch}
            onChange={e => setPtSearch(e.target.value)}
            onFocus={isMobile ? updatePtDropdownPos : undefined}
            placeholder="Search by name, mobile or UHID…"
            className={`${inp} pl-8 text-xs`}
            autoComplete="off"
          />
          {ptSearching && <span className="absolute right-2.5 top-2.5 w-3 h-3 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />}
          {!isMobile && patientDropdownList}
        </div>
      )}
    </div>
  )

  const quickAddBlock = isMobile ? (
    <div className={`${mobileBillingCardCls} shrink-0 flex flex-col max-h-[34vh] min-h-[7.5rem] my-1.5`}>
      <div className="shrink-0 z-10 bg-white px-3 pt-3 pb-2.5 border-b-2 border-emerald-100 shadow-sm">
        <div className="flex items-center justify-between mb-2">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Quick Add</p>
          <button
            type="button"
            onClick={() => {
              const initial = activeQuickCategory === QUICK_SERVICE_ALL_CATEGORY ? QUICK_SERVICE_DEFAULT_CATEGORY : activeQuickCategory
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
        <div className="flex flex-wrap gap-1.5">
          {quickServiceCategories.map(category => (
            <button
              key={category}
              type="button"
              onClick={() => setActiveQuickCategory(category)}
              className={`text-[11px] px-2.5 py-1 rounded-md border transition-colors ${
                activeQuickCategory === category
                  ? 'border-emerald-600 bg-emerald-600 text-white'
                  : 'border-gray-200 bg-gray-50 text-gray-600 hover:border-emerald-300'
              }`}
            >
              {category}
            </button>
          ))}
        </div>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-3 py-2 border-t border-gray-100 bg-gray-50/30">
        <div className="flex flex-wrap gap-1.5">
          {visibleQuickServices.map((svc, idx) => (
            <button
              key={`${svc.category}-${svc.label}-${idx}`}
              type="button"
              onClick={() => quickAdd(svc)}
              className="text-[11px] px-2.5 py-1.5 rounded-full border border-gray-200 bg-gray-50 hover:border-emerald-400 hover:bg-emerald-50 hover:text-emerald-800 text-gray-600 transition-colors"
            >
              {svc.label} <span className="text-gray-400">₹{svc.price}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  ) : (
    <div className={sectionCardCls}>
      <div className="flex items-center justify-between mb-2">
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Quick Add</p>
        <button
          type="button"
          onClick={() => {
            const initial = activeQuickCategory === QUICK_SERVICE_ALL_CATEGORY ? QUICK_SERVICE_DEFAULT_CATEGORY : activeQuickCategory
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
        {quickServiceCategories.map(category => (
          <button
            key={category}
            type="button"
            onClick={() => setActiveQuickCategory(category)}
            className={`text-[11px] px-2.5 py-1 rounded-md border transition-colors ${
              activeQuickCategory === category
                ? 'border-emerald-600 bg-emerald-600 text-white'
                : 'border-gray-200 bg-gray-50 text-gray-600 hover:border-emerald-300'
            }`}
          >
            {category}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {visibleQuickServices.map((svc, idx) => (
          <button key={`${svc.category}-${svc.label}-${idx}`} type="button" onClick={() => quickAdd(svc)}
            className="text-[11px] px-2.5 py-1 rounded-full border border-gray-200 bg-gray-50 hover:border-emerald-400 hover:bg-emerald-50 hover:text-emerald-800 text-gray-600 transition-colors">
            {svc.label} <span className="text-gray-400">₹{svc.price}</span>
          </button>
        ))}
      </div>
    </div>
  )

  const renderServiceItemRow = (it, i) => {
    const q = String(it.description || '').trim().toLowerCase()
    const suggestions = q
      ? searchableServiceItems.filter(s => s.label.toLowerCase().includes(q)).slice(0, 8)
      : []
    const showSuggestions = activeServiceSearchRow === i && suggestions.length > 0
    const suggestionDropdown = showSuggestions && (
      <div className="absolute z-30 mt-1 w-full bg-white border border-gray-200 rounded-lg shadow-lg max-h-40 overflow-y-auto">
        {suggestions.map((s, idx) => (
          <button
            key={`${s.label}-${idx}`}
            type="button"
            onMouseDown={e => e.preventDefault()}
            onClick={() => applyServiceSuggestion(i, s)}
            className="w-full px-3 py-2 text-left text-sm hover:bg-emerald-50 flex items-center justify-between"
          >
            <span className="text-gray-700 truncate">{s.label}</span>
            <span className="text-gray-400 ml-2 shrink-0">₹{s.price}</span>
          </button>
        ))}
      </div>
    )

    if (isMobile) {
      const lineTotal = (parseFloat(String(it.quantity)) || 0) * (parseFloat(String(it.unit_price)) || 0)
      return (
        <div key={i} className="rounded-md border border-gray-200 bg-white p-1.5 space-y-1.5 shadow-sm">
          <div className="relative">
            <label className="text-[9px] font-bold text-gray-400 uppercase tracking-wide mb-0.5 block">Service</label>
            <input
              className={mobileItemInp}
              placeholder="Service name"
              value={it.description}
              onFocus={() => setActiveServiceSearchRow(i)}
              onBlur={() => setTimeout(() => setActiveServiceSearchRow(prev => (prev === i ? null : prev)), 120)}
              onChange={e => {
                updateItem(i, 'description', e.target.value)
                setActiveServiceSearchRow(i)
              }}
              onKeyDown={e => {
                if (e.key === 'Enter' && suggestions.length > 0) {
                  e.preventDefault()
                  applyServiceSuggestion(i, suggestions[0])
                }
              }}
            />
            {suggestionDropdown}
          </div>
          <div className="flex items-end gap-1.5">
            <div className="w-16 shrink-0">
              <label className="text-[9px] font-bold text-gray-400 uppercase tracking-wide mb-0.5 block">Qty</label>
              <input
                type="number"
                min="1"
                className={`${mobileItemInp} text-center`}
                value={it.quantity}
                onChange={e => updateItem(i, 'quantity', e.target.value)}
              />
            </div>
            <div className="flex-1 min-w-0">
              <label className="text-[9px] font-bold text-gray-400 uppercase tracking-wide mb-0.5 block">Price (₹)</label>
              <input
                type="number"
                min="0"
                step="1"
                className={mobileItemInp}
                placeholder="0"
                value={it.unit_price}
                onChange={e => updateItem(i, 'unit_price', e.target.value)}
              />
            </div>
            <button
              type="button"
              onClick={() => removeItem(i)}
              className="shrink-0 w-9 h-9 flex items-center justify-center rounded-lg border border-rose-200 text-rose-500 bg-rose-50 active:bg-rose-100"
              aria-label="Remove item"
            >
              <Trash2 size={15} strokeWidth={2} />
            </button>
          </div>
          {lineTotal > 0 && (
            <p className="text-[11px] font-bold text-emerald-700 text-right">
              Line total: ₹{lineTotal.toFixed(2)}
            </p>
          )}
        </div>
      )
    }

    return (
      <div key={i} className="grid grid-cols-12 gap-1 items-center">
        <div className="col-span-6 relative">
          <input
            className={itemInp}
            placeholder="Service"
            value={it.description}
            onFocus={() => setActiveServiceSearchRow(i)}
            onBlur={() => setTimeout(() => setActiveServiceSearchRow(prev => (prev === i ? null : prev)), 120)}
            onChange={e => {
              updateItem(i, 'description', e.target.value)
              setActiveServiceSearchRow(i)
            }}
            onKeyDown={e => {
              if (e.key === 'Enter' && suggestions.length > 0) {
                e.preventDefault()
                applyServiceSuggestion(i, suggestions[0])
              }
            }}
          />
          {suggestionDropdown}
        </div>
        <input type="number" min="1" className={`${itemInp} col-span-2 text-center`}
          value={it.quantity} onChange={e => updateItem(i, 'quantity', e.target.value)} />
        <input type="number" min="0" step="1" className={`${itemInp} col-span-3`} placeholder="0"
          value={it.unit_price} onChange={e => updateItem(i, 'unit_price', e.target.value)} />
        <button
          type="button"
          onClick={() => removeItem(i)}
          className="col-span-1 flex justify-center items-center p-1 rounded-md border border-rose-200 text-rose-400 hover:bg-rose-50 hover:text-rose-600 hover:border-rose-400 transition-colors"
        >
          <Trash2 size={14} strokeWidth={2} />
        </button>
      </div>
    )
  }

  const servicesBlock = (
    <div className={servicesCardCls}>
      <div className="flex items-center justify-between mb-2 shrink-0">
        <p className={`font-semibold text-gray-500 uppercase tracking-wide ${isMobile ? 'text-[13px]' : 'text-[11px]'}`}>
          Services / Items
          {isMobile && items.length > 0 && (
            <span className="ml-2 text-emerald-600 normal-case font-bold">({items.filter(it => String(it.description || '').trim()).length})</span>
          )}
        </p>
        <button
          type="button"
          onClick={addItem}
          className="text-xs font-bold text-emerald-700 flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-emerald-300 bg-emerald-50 hover:bg-emerald-100"
        >
          <Plus size={14} /> Add
        </button>
      </div>
      {!isMobile && (
        <div className="grid grid-cols-12 gap-1 text-[9px] font-semibold text-gray-400 uppercase tracking-wide border-b border-gray-300 pb-1.5 mb-0.5 shrink-0 px-0.5">
          <div className="col-span-6">Description</div>
          <div className="col-span-2 text-center">Qty</div>
          <div className="col-span-3">₹ Price</div>
          <div className="col-span-1" />
        </div>
      )}
      <div className={`overflow-y-auto overscroll-contain flex-1 min-h-0 ${isMobile ? 'space-y-2 py-1' : 'space-y-1'}`}>
        {items.length === 0 ? (
          <div className="py-8 text-center text-sm text-gray-400">No items — tap Quick Add or Add</div>
        ) : (
          [...items].reverse().map((it, revI) => renderServiceItemRow(it, items.length - 1 - revI))
        )}
      </div>
    </div>
  )

  return (
    <div className={`flex-1 min-h-0 flex flex-col overflow-hidden ${isMobile ? '' : 'gap-3'}`}>
      {!isMobile && (
        <div className="flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2">
            <Receipt size={18} className="text-emerald-600" />
            <h2 className="text-base font-semibold text-gray-900">Payment Slip</h2>
          </div>
        </div>
      )}

      <form
        onSubmit={handleSubmit}
        className={
          isMobile
            ? 'flex-1 min-h-0 flex flex-col overflow-hidden min-w-0'
            : 'flex-1 min-h-0 grid grid-cols-[3fr_2fr] grid-rows-1 gap-3 overflow-hidden min-w-0'
        }
      >
        {isMobile ? (
          <>
            <div className="flex-1 min-h-0 flex flex-col min-w-0 bg-gray-100/50 px-0.5 pb-0.5">
              <div className="shrink-0">{patientBlock}</div>
              <div className="flex-1 min-h-0 flex flex-col overflow-y-auto overflow-x-hidden">
                {quickAddBlock}
                <div className="flex-1 min-h-0 flex flex-col min-h-[6rem]">
                  {servicesBlock}
                </div>
              </div>
            </div>
            {isMobile && showPtDropdown && ptDropdownPos && createPortal(patientDropdownList, document.body)}
            <PaymentSlipMobileBottomPanel
              expanded={paymentDetailsExpanded}
              onToggle={() => setPaymentDetailsExpanded((v) => !v)}
              total={total}
              subtotal={subtotal}
              discountAmt={discountAmt}
              paymentMode={paymentMode}
              submitting={submitting}
              canSubmit={!!patient && total > 0}
              detailsContent={paymentDetailFields}
              totalsContent={totalsBlock}
            />
          </>
        ) : (
          <>
          <div className="flex flex-col gap-3 min-h-0 h-full min-w-0 overflow-hidden">
            {patientBlock}
            {quickAddBlock}
            {servicesBlock}
          </div>

          <div className="flex flex-col gap-3 min-h-0 h-full min-w-0 overflow-y-auto">
            <div className="bg-white rounded-xl border border-gray-200 p-3 shrink-0">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Payment Details</p>
              {paymentDetailFields}
            </div>
            {totalsBlock}
            <button type="submit" disabled={submitting || !patient || total <= 0}
              className="py-2.5 rounded-xl bg-emerald-600 text-white font-medium text-sm hover:bg-emerald-700 disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2 shrink-0">
              {submitting
                ? <><span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> Generating…</>
                : <><Receipt size={15} /> Generate Payment Slip</>
              }
            </button>
          </div>
          </>
        )}
      </form>
      {isAddingNew && (
        <NewPatientRegistrationModal
          open={isAddingNew}
          title="Register & Generate Slip"
          initialSearch={newPt.search}
          onClose={() => setIsAddingNew(false)}
          onCreated={(created) => {
            setPatient(created)
            setNewPt({ search: '' })
          }}
        />
      )}
      {showQuickServiceEditor && (
        <div className="fixed inset-0 z-[120] bg-black/40 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl overflow-hidden">
            <div className="bg-indigo-600 px-4 py-3 flex items-center justify-between">
              <h3 className="text-white font-bold">Edit Quick Add Services</h3>
              <button type="button" onClick={() => { setShowCategoryCreator(false); setShowQuickItemCreator(false); setShowQuickServiceEditor(false) }} className="text-white/80 hover:text-white">
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
                        setShowQuickItemCreator(v => !v)
                      }}
                      className="text-[11px] px-2.5 py-1 rounded-full border border-indigo-300 bg-indigo-100 text-indigo-700 font-bold hover:bg-indigo-200"
                    >
                      + Add Item
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowCategoryCreator(v => !v)}
                      className="text-[11px] px-2.5 py-1 rounded-full border border-emerald-300 bg-emerald-100 text-emerald-700 font-bold hover:bg-emerald-200"
                    >
                      + Add Category
                    </button>
                  </div>
                </div>
                <div className="flex items-center gap-2 overflow-x-auto pb-1">
                  {editorCategories.map(c => (
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
                      onChange={e => setNewQuickLabel(e.target.value)}
                      placeholder="Service name"
                      className="col-span-5 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none"
                    />
                    <select
                      value={newQuickCategory}
                      onChange={e => setNewQuickCategory(e.target.value)}
                      className="col-span-3 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none"
                    >
                      {editorCategories.map(c => (
                        <option key={c} value={c}>{c}</option>
                      ))}
                    </select>
                    <input
                      type="number"
                      min="0"
                      step="1"
                      value={newQuickPrice}
                      onChange={e => setNewQuickPrice(e.target.value)}
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
                      onChange={e => setNewQuickCategoryName(e.target.value)}
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
                  onDragOver={e => e.preventDefault()}
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
                    onChange={e => setQuickServices(prev => prev.map((x, i) => i === idx ? { ...x, label: e.target.value } : x))}
                    className="col-span-4 border border-gray-200 rounded-lg px-2 py-1.5 text-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none"
                  />
                  <select
                    value={svc.category || QUICK_SERVICE_DEFAULT_CATEGORY}
                    onChange={e => setQuickServices(prev => prev.map((x, i) => i === idx ? { ...x, category: e.target.value } : x))}
                    className="col-span-3 border border-gray-200 rounded-lg px-2 py-1.5 text-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none"
                  >
                    {editorCategories.map(c => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                  <input
                    type="number"
                    min="0"
                    step="1"
                    value={svc.price}
                    onChange={e => setQuickServices(prev => prev.map((x, i) => i === idx ? { ...x, price: Number(e.target.value || 0) } : x))}
                    className="col-span-3 border border-gray-200 rounded-lg px-2 py-1.5 text-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none"
                  />
                  <button type="button" onClick={() => removeQuickService(idx)} className="col-span-1 h-9 rounded-lg bg-red-50 text-red-600 hover:bg-red-100 flex items-center justify-center">
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
            </div>
            <div className="px-4 py-3 border-t border-gray-100 bg-gray-50 flex justify-end">
              <button type="button" onClick={() => { void persistQuickServices(quickServices); setShowQuickServiceEditor(false); toast.success('Quick Add services updated') }} className="px-4 py-2 rounded-lg bg-emerald-600 text-white text-sm font-bold hover:bg-emerald-700">
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── TV Screens Tab ───────────────────────────────────────────────────────────
// ─── Room Edit Modal ──────────────────────────────────────────────────────────
function RoomModal({ room, doctors, onSave, onClose }) {
  const isNew = !room.code
  const nextNum = room._nextNum || ''
  const [form, setForm] = useState({
    label: room.label || '',
    prefix: room.prefix || '',
    doctor_user: room.doctor_user || '',
    doctor_name: room.doctor_name || '',
  })

  function handleDoctorChange(e) {
    const docUser = e.target.value
    const doc = doctors.find(d => (d.user || d.id) === docUser)
    setForm(f => ({
      ...f,
      doctor_user: docUser,
      doctor_name: doc?.name || '',
      label: doc ? `Room ${nextNum || ''} – ${doc.name}` : f.label,
    }))
  }

  function handleSubmit(e) {
    e.preventDefault()
    if (!form.label.trim()) { toast.error('Room label is required'); return }
    if (!form.prefix.trim()) { toast.error('Token prefix is required'); return }
    onSave({
      ...room,
      label: form.label.trim(),
      prefix: form.prefix.trim().toUpperCase().slice(0, 2),
      doctor_user: form.doctor_user || null,
      doctor_name: form.doctor_name || '',
    })
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6">
        <div className="flex items-center justify-between mb-5">
          <h2 className="font-bold text-gray-800 text-lg">{isNew ? 'Add New Room' : 'Edit Room'}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-red-500"><XCircle size={20} /></button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Doctor picker */}
          <div>
            <label className="text-xs font-semibold text-gray-500 mb-1 block">Assign Doctor from Profile</label>
            <select value={form.doctor_user} onChange={handleDoctorChange}
              className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:ring-2 focus:ring-purple-500 focus:outline-none">
              <option value="">— No doctor / Walk-in room —</option>
              {doctors.map(d => (
                <option key={d.user || d.id} value={d.user || d.id}>
                  {d.name}
                  {d.specialty_name ? ` · ${d.specialty_name}` : ''}
                  {d.consultation_fee ? ` · ₹${d.consultation_fee}` : ''}
                </option>
              ))}
            </select>
            {form.doctor_name && (
              <p className="mt-1 text-xs text-purple-600 bg-purple-50 rounded-lg px-2 py-1">
                Doctor assigned: <strong>{form.doctor_name}</strong>
              </p>
            )}
          </div>

          {/* Room label */}
          <div>
            <label className="text-xs font-semibold text-gray-500 mb-1 block">Room Label</label>
            <input value={form.label} onChange={e => setForm(f => ({ ...f, label: e.target.value }))}
              placeholder="e.g. Room 1 – Dr. Sharma"
              className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:ring-2 focus:ring-purple-500 focus:outline-none" required />
          </div>

          {/* Token prefix */}
          <div>
            <label className="text-xs font-semibold text-gray-500 mb-1 block">Token Prefix (1-2 letters)</label>
            <input value={form.prefix} onChange={e => setForm(f => ({ ...f, prefix: e.target.value.toUpperCase().slice(0, 2) }))}
              placeholder="e.g. A"
              maxLength={2}
              className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:ring-2 focus:ring-purple-500 focus:outline-none" required />
            <p className="text-xs text-gray-400 mt-1">Tokens will be printed as: <strong>{form.prefix || 'A'}1</strong>, <strong>{form.prefix || 'A'}2</strong>…</p>
          </div>

          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose}
              className="flex-1 border border-gray-200 rounded-xl py-2.5 text-sm text-gray-600 hover:bg-gray-50 font-medium">
              Cancel
            </button>
            <button type="submit"
              className="flex-1 bg-purple-600 text-white rounded-xl py-2.5 text-sm font-bold hover:bg-purple-700">
              {isNew ? 'Add Room' : 'Save Changes'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ─── TV Screens Section ───────────────────────────────────────────────────────
function TVScreensSection({ rooms, setRooms, tvGroups, setTvGroups }) {
  const [dragRoomCode, setDragRoomCode] = useState(null)
  const [doctors, setDoctors] = useState([])
  const [modalRoom, setModalRoom] = useState(null)   // null = closed, {} = editing
  const [editTvId, setEditTvId] = useState(null)
  const [tvHeadingInput, setTvHeadingInput] = useState('')

  useEffect(() => {
    api.get('/doctor-profiles/?limit=200&is_active=true')
      .then(({ data }) => {
        const rows = data?.data || data?.results || data || []
        setDoctors(Array.isArray(rows) ? rows : [])
      })
      .catch(() => {})
  }, [])

  function roomLabel(code) { return rooms.find(r => r.code === code)?.label || code }
  function roomPrefix(code) { return rooms.find(r => r.code === code)?.prefix || '' }
  function roomDoctor(code) { return rooms.find(r => r.code === code)?.doctor_name || '' }
  function makeTvUrl(group) { return `/tv/${group.id}` }

  function openAddRoom() {
    const roomNumbers = rooms.map(r => { const m = String(r.code || '').match(/^room(\d+)$/); return m ? parseInt(m[1], 10) : 0 }).filter(Boolean)
    const nextNumber = roomNumbers.length ? Math.max(...roomNumbers) + 1 : (rooms.length + 1)
    setModalRoom({
      _isNew: true,
      _nextNum: nextNumber,
      code: `room${nextNumber}`,
      label: `Room ${nextNumber}`,
      prefix: String.fromCharCode(64 + nextNumber),
      doctor_user: null,
      doctor_name: '',
      isDefault: false,
    })
  }

  function openEditRoom(roomCode) {
    const room = rooms.find(r => r.code === roomCode)
    if (room) setModalRoom({ ...room })
  }

  function handleModalSave(updated) {
    if (updated._isNew) {
      setRooms(prev => [...prev, { ...updated, _isNew: undefined, _nextNum: undefined }])
    } else {
      setRooms(prev => prev.map(r => r.code === updated.code ? { ...updated, _isNew: undefined, _nextNum: undefined } : r))
    }
    setModalRoom(null)
    toast.success(updated._isNew ? 'Room added!' : 'Room updated!')
  }

  function deleteRoom(roomCode) {
    const room = rooms.find(r => r.code === roomCode)
    if (!room) return
    if (room.isDefault) { toast.error('First 3 rooms are mandatory and cannot be deleted'); return }
    if (!window.confirm(`Delete "${room.label}"?`)) return
    setRooms(prev => prev.filter(r => r.code !== roomCode))
    setTvGroups(prev => prev.map(g => ({
      ...g,
      left_room: g.left_room === roomCode ? null : g.left_room,
      right_room: g.right_room === roomCode ? null : g.right_room,
    })))
  }

  function dropRoomToTv(tvId, slot, droppedRoomCode) {
    const roomCode = droppedRoomCode || dragRoomCode
    if (!roomCode || !slot) return
    setTvGroups(prev => prev.map(group => {
      const cleared = {
        ...group,
        left_room: group.left_room === roomCode ? null : group.left_room,
        right_room: group.right_room === roomCode ? null : group.right_room,
      }
      if (group.id === tvId) return { ...cleared, [slot]: roomCode }
      return cleared
    }))
    setDragRoomCode(null)
  }

  function startEditTvHeading(group) {
    setEditTvId(group.id)
    setTvHeadingInput(group.name || '')
  }

  function saveTvHeading(tvId) {
    if (!tvHeadingInput.trim()) return
    setTvGroups(prev => prev.map(g => g.id === tvId ? { ...g, name: tvHeadingInput.trim() } : g))
    setEditTvId(null)
  }

  return (
    <div className="space-y-5">
      {/* Room cards */}
      <div className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100">
        <div className="flex items-center justify-between mb-1">
          <h3 className="font-bold text-gray-800 flex items-center gap-2">
            <Monitor size={18} className="text-purple-500" /> Rooms & Doctor Assignment
          </h3>
          <button onClick={openAddRoom}
            className="bg-purple-600 text-white text-xs px-4 py-2 rounded-xl font-semibold hover:bg-purple-700 flex items-center gap-1.5">
            <Plus size={13} /> Add Room
          </button>
        </div>
        <p className="text-xs text-amber-600 mb-4">Min 3 rooms required. First 3 non-deletable. All rooms can have a doctor assigned.</p>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {rooms.map((room, idx) => (
            <div key={room.code}
              draggable
              onDragStart={(e) => { setDragRoomCode(room.code); e.dataTransfer.setData('text/plain', room.code); e.dataTransfer.effectAllowed = 'move' }}
              onDragEnd={() => setDragRoomCode(null)}
              className={`rounded-2xl border p-4 cursor-grab transition-all ${
                dragRoomCode === room.code
                  ? 'border-purple-300 ring-2 ring-purple-100 bg-purple-50'
                  : 'border-gray-100 bg-gray-50 hover:border-purple-200'
              }`}
            >
              {/* Room header */}
              <div className="flex items-start justify-between gap-2 mb-3">
                <div className="w-9 h-9 rounded-xl bg-purple-100 text-purple-700 flex items-center justify-center font-black text-base shrink-0">
                  {room.prefix}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-bold text-gray-800 text-sm truncate">{room.label}</p>
                  <p className="text-xs text-gray-400">Code: {room.code}</p>
                </div>
              </div>

              {/* Doctor badge */}
              {room.doctor_name ? (
                <div className="flex items-center gap-1.5 bg-blue-50 border border-blue-200 rounded-lg px-2.5 py-1.5 mb-3">
                  <Users size={12} className="text-blue-500 shrink-0" />
                  <span className="text-xs text-blue-700 font-semibold truncate">{room.doctor_name}</span>
                </div>
              ) : (
                <div className="flex items-center gap-1.5 bg-gray-100 rounded-lg px-2.5 py-1.5 mb-3">
                  <Users size={12} className="text-gray-400 shrink-0" />
                  <span className="text-xs text-gray-400">No doctor assigned</span>
                </div>
              )}

              {/* Actions */}
              <div className="flex items-center gap-2">
                <button onClick={() => openEditRoom(room.code)}
                  className="flex-1 bg-white border border-purple-200 text-purple-700 text-xs py-1.5 rounded-lg font-semibold hover:bg-purple-50 flex items-center justify-center gap-1">
                  Assign Doctor / Edit
                </button>
                {!room.isDefault && (
                  <button onClick={() => deleteRoom(room.code)}
                    className="bg-red-50 border border-red-200 text-red-600 text-xs px-2.5 py-1.5 rounded-lg hover:bg-red-100">
                    Del
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* TV assignments */}
      <div className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100">
        <h3 className="font-bold text-gray-800 flex items-center gap-2 mb-4">
          <Tv size={18} className="text-purple-500" /> TV Screen Assignments
        </h3>
        <p className="text-xs text-gray-500 mb-4">Drag a room from above onto a TV slot. Each TV can show up to 2 rooms side-by-side.</p>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {tvGroups.map(group => (
            <div key={group.id} className="rounded-2xl border border-gray-200 p-4">
              {/* TV heading */}
              <div className="flex items-center justify-between gap-2 mb-3">
                {editTvId === group.id ? (
                  <div className="flex items-center gap-2 flex-1">
                    <input value={tvHeadingInput} onChange={e => setTvHeadingInput(e.target.value)}
                      className="flex-1 border border-purple-300 rounded-lg px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-purple-400"
                      autoFocus onKeyDown={e => e.key === 'Enter' && saveTvHeading(group.id)} />
                    <button onClick={() => saveTvHeading(group.id)}
                      className="bg-purple-600 text-white text-xs px-3 py-1.5 rounded-lg font-semibold hover:bg-purple-700">
                      Save
                    </button>
                    <button onClick={() => setEditTvId(null)} className="text-gray-400 hover:text-red-400"><XCircle size={16} /></button>
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-gray-800">{group.name}</span>
                    <button onClick={() => startEditTvHeading(group)}
                      className="text-[11px] px-2 py-1 rounded bg-gray-100 text-gray-600 hover:bg-gray-200">
                      Rename
                    </button>
                  </div>
                )}
                <a href={makeTvUrl(group)} target="_blank" rel="noreferrer"
                  className="bg-purple-600 text-white text-xs px-3 py-1.5 rounded-lg font-semibold flex items-center gap-1.5 hover:bg-purple-700 shrink-0">
                  <Tv size={12} /> Open TV
                </a>
              </div>

              <p className="text-[11px] text-blue-600 mb-3 break-all">{`http://localhost:5173${makeTvUrl(group)}`}</p>

              {/* Drop zones */}
              <div className="grid grid-cols-2 gap-2">
                {['left_room', 'right_room'].map(slot => {
                  const code = group[slot]
                  const doc = code ? roomDoctor(code) : ''
                  return (
                    <div key={slot}
                      onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move' }}
                      onDrop={(e) => { e.preventDefault(); dropRoomToTv(group.id, slot, e.dataTransfer.getData('text/plain')) }}
                      className={`rounded-xl border-2 border-dashed p-3 min-h-20 transition-all ${
                        dragRoomCode
                          ? 'border-purple-400 bg-purple-50/80'
                          : code ? 'border-purple-300 bg-purple-50/50' : 'border-gray-200 bg-gray-50/50'
                      }`}
                    >
                      <p className="text-[10px] uppercase tracking-wide text-purple-500 font-bold mb-2">
                        {slot === 'left_room' ? 'Left Screen' : 'Right Screen'}
                      </p>
                      {code ? (
                        <div>
                          <span className="text-xs bg-purple-100 border border-purple-200 text-purple-800 font-bold px-2 py-0.5 rounded-full inline-block mb-1">
                            {roomPrefix(code)}{' · '}{roomLabel(code)}
                          </span>
                          {doc && <p className="text-xs text-blue-600 mt-1">{doc}</p>}
                          <button onClick={() => setTvGroups(prev => prev.map(g => g.id === group.id ? { ...g, [slot]: null } : g))}
                            className="text-[10px] text-red-400 hover:text-red-600 mt-1 block">
                            Remove
                          </button>
                        </div>
                      ) : (
                        <p className="text-xs text-gray-400 italic">Drag & drop a room here</p>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 text-sm text-blue-800">
        <strong>Tip:</strong> Open TV links in fullscreen (F11). Tokens auto-refresh every 5 seconds. Assign a doctor to a room so the OPD token form pre-fills the doctor automatically.
      </div>

      {/* Room modal */}
      {modalRoom && (
        <RoomModal
          room={modalRoom}
          doctors={doctors}
          onSave={handleModalSave}
          onClose={() => setModalRoom(null)}
        />
      )}
    </div>
  )
}

// ─── Sidebar ──────────────────────────────────────────────────────────────────
function Sidebar({ activeSection, onSelect, navGroups = NAV_GROUPS, isOpen = false, onClose }) {
  const [collapsed, setCollapsed] = useState({})

  function toggleGroup(label) {
    setCollapsed(prev => ({ ...prev, [label]: !prev[label] }))
  }

  function handleSelect(id) {
    onSelect(id)
    if (onClose) onClose()
  }

  return (
    <>
      {/* Mobile overlay backdrop */}
      {isOpen && (
        <div
          className="fixed inset-0 bg-black/40 z-30 md:hidden"
          onClick={onClose}
        />
      )}

      {/* Sidebar panel */}
      <aside
        className={`
          fixed md:static top-0 left-0 h-full z-40
          w-64 md:w-52 shrink-0 bg-white border-r border-gray-100 flex flex-col
          transition-transform duration-300 ease-in-out
          md:translate-x-0
          ${isOpen ? 'translate-x-0 shadow-2xl' : '-translate-x-full'}
        `}
        style={{ height: '100dvh', maxHeight: '100dvh' }}
      >
        {/* Mobile header inside sidebar */}
        <div className="md:hidden flex items-center justify-between px-4 py-3 bg-gradient-to-r from-emerald-600 to-teal-600 shrink-0">
          <span className="text-white font-bold text-sm">Menu</span>
          <button onClick={onClose} className="text-white/80 hover:text-white p-1 rounded-lg">
            <X size={18} />
          </button>
        </div>

        <div className="hidden md:block px-3 py-2 border-b border-gray-100 shrink-0">
          <p className="text-[11px] font-bold text-gray-400 uppercase tracking-widest">Reception</p>
        </div>
        <nav className="flex-1 overflow-y-auto px-2 py-1.5" style={{ scrollbarWidth: 'none' }}>
          {navGroups.map(group => (
            <div key={group.label} className="mb-0.5">
              <button
                onClick={() => toggleGroup(group.label)}
                className="w-full flex items-center justify-between px-2 py-1 text-[10px] font-bold text-gray-400 uppercase tracking-widest hover:text-gray-600 rounded-md"
              >
                {group.label}
                {collapsed[group.label] ? <ChevronRight size={10} /> : <ChevronDown size={10} />}
              </button>
              {!collapsed[group.label] && group.items.map(item => {
                const Icon = item.icon
                const active = activeSection === item.id
                return (
                  <button key={item.id} onClick={() => handleSelect(item.id)}
                    className={`w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all mb-0.5 ${
                      active
                        ? 'bg-emerald-600 text-white shadow-sm'
                        : 'text-gray-600 hover:bg-gray-50 hover:text-gray-800'
                    }`}>
                    <Icon size={14} className={active ? 'text-white' : 'text-gray-400'} />
                    {item.label}
                  </button>
                )
              })}
            </div>
          ))}
        </nav>
      </aside>
    </>
  )
}

// ─── OPD Slips / History ────────────────────────────────────────────────────────
function OpdSlipsSection({ onMoveToIpd }) {
  const isMobile = useIsMobile()
  const [visits, setVisits] = useState([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(0)
  const [editingVisit, setEditingVisit] = useState(null)
  const [viewVisit, setViewVisit] = useState(null)
  const [printVisit, setPrintVisit] = useState(null)
  const [cancelVisit, setCancelVisit] = useState(null)
  const [cancelReason, setCancelReason] = useState('')
  const [cancelling, setCancelling] = useState(false)
  const [doctors, setDoctors] = useState([])
  const [departments, setDepartments] = useState([])
  const [layoutFields, setLayoutFields] = useState([])
  const PAGE_SIZE = 10
  const debounceRef = useRef(null)
  const formatPersonName = (value) => String(value || '')
    .split(' ')
    .map((part) => (part ? `${part.charAt(0).toUpperCase()}${part.slice(1).toLowerCase()}` : ''))
    .join(' ')
  const getDoctorUserId = (doctorRow) =>
    doctorRow?.user == null ? '' : String(doctorRow.user)
  const getVisitDoctorName = (visitRow) => {
    const assignedDoctorUser = visitRow?.doctor_user == null ? '' : String(visitRow.doctor_user)
    const matchedDoctor = doctors.find((d) => getDoctorUserId(d) === assignedDoctorUser)
    return matchedDoctor?.name || '-'
  }
  const getDoctorDepartmentValue = (doctorRows, selectedId) => {
    const target = String(selectedId || '')
    if (!target) return ''
    const matched = doctorRows.find((doctorRow) => getDoctorUserId(doctorRow) === target)
    if (!matched) return ''
    const entities = Array.isArray(matched.departments_entities) ? matched.departments_entities : []
    if (entities.length > 0) {
      const first = entities[0]
      return String(first?.name || first?.code || '').trim()
    }
    const deptIds = Array.isArray(matched.departments) ? matched.departments : []
    if (deptIds.length > 0) {
      const id = String(deptIds[0])
      const dep = departments.find((row) => String(row.id) === id)
      if (dep) return String(dep.name || dep.code || '').trim()
    }
    return ''
  }
  const loadOpdLayout = useCallback(async () => {
    try {
      const res = await fetch('/api/templates')
      if (!res.ok) return
      const data = await res.json()
      const single = (data.templates || []).find((t) => t.key === 'single')
      const cfg = normalizeOpdFieldConfig(
        getReceptionOpdSettings().opd_field_config,
        getReceptionOpdSettings().opd_visible_fields,
      )
      if (single?.layout) {
        const synced = syncCoreFieldsIntoLayout(single.layout, cfg)
        const slipFields = filterLayoutFieldsForSlip(synced, cfg)
        setLayoutFields(Object.keys(slipFields))
      } else {
        setLayoutFields([])
      }
    } catch {
      /* keep existing fields on failure */
    }
  }, [])
  const opdExtraTemplateFields = useMemo(
    () => layoutFields.filter((f) => !templateFieldUsesMainFormOnly(f)),
    [layoutFields],
  )

  useEffect(() => {
    Promise.all([
      api.get('/doctor-profiles/?limit=500'),
      api.get('/departments/?limit=500'),
    ])
      .then(([doctorRes, departmentRes]) => {
        const doctorRows = Array.isArray(doctorRes.data?.data)
          ? doctorRes.data.data
          : (doctorRes.data?.results || doctorRes.data || [])
        const departmentRows = Array.isArray(departmentRes.data?.data)
          ? departmentRes.data.data
          : (departmentRes.data?.results || departmentRes.data || [])
        setDoctors(doctorRows)
        setDepartments(departmentRows)
      })
      .catch(() => {})
  }, [])

  useEffect(() => {
    loadOpdLayout()
    const refresh = setInterval(() => {
      void loadOpdLayout()
    }, 15000)
    return () => clearInterval(refresh)
  }, [loadOpdLayout])

  const [opdDateFrom, setOpdDateFrom] = useState('')
  const [opdDateTo, setOpdDateTo] = useState('')

  useEffect(() => {
    setPage(0)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => fetchVisits(0, search), 300)
    return () => clearTimeout(debounceRef.current)
  }, [search])

  useEffect(() => { setPage(0); fetchVisits(0, search) }, [opdDateFrom, opdDateTo])
  useEffect(() => { fetchVisits(page, search) }, [page])

  async function fetchVisits(pg = 0, q = '') {
    setLoading(true)
    try {
      const params = new URLSearchParams({ limit: PAGE_SIZE, offset: pg * PAGE_SIZE, ordering: '-visit_date,-created_at' })
      if (q.trim()) params.set('search', q.trim())
      if (opdDateFrom) params.set('visit_date__gte', opdDateFrom)
      if (opdDateTo) params.set('visit_date__lte', opdDateTo)
      const { data } = await api.get(`/opd-visits/?${params}`)
      setVisits(data?.data || data?.results || data || [])
      setTotal(data?.count ?? data?.total ?? (data?.data?.length ?? 0))
    } catch { toast.error('Failed to load OPD slips') }
    finally { setLoading(false) }
  }

  async function handleSaveEdit(e) {
    e.preventDefault()
    try {
      const patientId = editingVisit.patient
      if (patientId) {
        const normalizedName = formatPersonName(editingVisit.patient_name || '').trim()
        const nameParts = normalizedName.split(/\s+/).filter(Boolean)
        const phoneDigits = String(editingVisit.patient_phone || '').replace(/\D/g, '')
        const patientPayload = {
          first_name: nameParts[0] || 'Patient',
          last_name: nameParts.slice(1).join(' ') || '',
          guardian_name: formatPersonName(editingVisit.patient_guardian_name || '').trim(),
          guardian_relationship: String(editingVisit.patient_guardian_relationship || '').trim(),
          preferred_salutation: String(editingVisit.salutation_choice ?? ''),
          gender: editingVisit.patient_gender || 'male',
          address_line1: editingVisit.patient_address || '',
          city: editingVisit.patient_city || '',
          state: editingVisit.patient_state || '',
        }
        if (editingVisit.patient_age !== '' && editingVisit.patient_age != null) {
          const a = parseInt(editingVisit.patient_age, 10)
          if (!Number.isNaN(a)) {
            patientPayload.age = a
            patientPayload.age_unit = normalizeAgeUnit(editingVisit.patient_age_unit)
          }
        }
        if (phoneDigits.length >= 10) {
          patientPayload.phone = phoneDigits.slice(-10)
        }
        if (opdExtraTemplateFields.length > 0) {
          patientPayload.opd_custom_fields = buildOpdCustomFieldPayload(
            opdExtraTemplateFields,
            editingVisit.opd_custom_fields,
          )
        }
        await api.patch(`/patients/${patientId}/`, patientPayload)
      }

      const visitDate = editingVisit.visit_datetime?.slice(0, 10) || editingVisit.visit_date
      const visitDatetimeIso = dateTimeInputToIso(editingVisit.visit_datetime)
      await api.patch(`/opd-visits/${editingVisit.id}/`, {
        doctor_user: editingVisit.doctor_user || null,
        department: editingVisit.department || '',
        chief_complaint: editingVisit.visit_reason || '',
        visit_reason: editingVisit.visit_reason || '',
        status: editingVisit.status,
        visit_date: visitDate,
        ...(visitDatetimeIso ? { visit_datetime: visitDatetimeIso } : {}),
        amount: editingVisit.amount || null,
        payment_mode: editingVisit.payment_mode || 'cash',
      })
      toast.success('OPD Slip updated!')
      setEditingVisit(null)
      fetchVisits(page, search)
    } catch (err) {
      const detail = err?.response?.data?.detail || JSON.stringify(err?.response?.data || {}) || 'Failed to update OPD slip'
      toast.error(detail)
    }
  }

  async function openEditVisit(visit) {
    if (!visit) return
    if (visit.status === 'cancelled') {
      toast.error('Cancelled OPD slips are view-only')
      return
    }
    let enriched = { ...visit }
    if (visit.patient) {
      try {
        const { data } = await api.get(`/patients/${visit.patient}/`)
        const p = data?.data || data || {}
        const fullName = [p.first_name, p.last_name].filter(Boolean).join(' ')
        const ageFields = hydrateAgeFieldsFromPatient(p)
        enriched = {
          ...enriched,
          patient_name: formatPersonName(fullName || visit.patient_name || ''),
          patient_phone: p.phone || visit.patient_phone || '',
          patient_gender: p.gender || visit.patient_gender || 'male',
          patient_age: ageFields.age || (visit.patient_age || ''),
          patient_age_unit: ageFields.ageUnit,
          patient_guardian_name: formatPersonName(p.guardian_name || visit.patient_guardian_name || ''),
          patient_guardian_relationship: (p.guardian_relationship || '').trim() || visit.patient_guardian_relationship || '',
          patient_address: p.address_line1 || visit.patient_address || '',
          patient_city: p.city || visit.patient_city || '',
          patient_state: p.state || visit.patient_state || '',
          salutation_choice: normalizeSalutationChoiceFromApi(p.preferred_salutation),
          opd_custom_fields: normalizeOpdCustomFields(
            p.opd_custom_fields || visit.patient_opd_custom_fields,
          ),
        }
      } catch {
        // fall back to visit payload values
      }
    }
    if (enriched.salutation_choice === undefined) {
      enriched = { ...enriched, salutation_choice: 'none' }
    }
    if (!enriched.opd_custom_fields) {
      enriched = {
        ...enriched,
        opd_custom_fields: normalizeOpdCustomFields(visit.patient_opd_custom_fields),
      }
    }
    if (!enriched.department) {
      enriched = {
        ...enriched,
        department: getDoctorDepartmentValue(doctors, enriched.doctor_user),
      }
    }
    enriched = {
      ...enriched,
      patient_age_unit: normalizeAgeUnit(enriched.patient_age_unit || visit.patient_age_unit || 'years'),
      visit_datetime: toDateTimeInputValue(
        visit.created_at
          || (visit.visit_date ? `${visit.visit_date}T12:00:00` : null),
      ),
    }
    setEditingVisit(enriched)
  }

  function reprintOpdSlip(visit) {
    if (!visit) return
    if (visit.status === 'cancelled') {
      toast.error('Cancelled OPD slips are view-only')
      return
    }
    setPrintVisit({
      ...visit,
      doc_name: getVisitDoctorName(visit),
      chief_complaint: visit.chief_complaint || visit.visit_reason || '',
      display_token: visit.display_token || String(visit.queue_number || visit.token_number || ''),
      patient_opd_custom_fields: visit.patient_opd_custom_fields || {},
    })
  }

  function openViewVisit(visit) {
    if (!visit) return
    const resolvedDoctor = getVisitDoctorName(visit)
    setViewVisit({
      ...visit,
      doctor_name: resolvedDoctor,
      doc_name: resolvedDoctor,
    })
  }

  function moveVisitToIpd(visit) {
    if (!visit) return
    if (visit.status === 'cancelled') {
      toast.error('Cancelled OPD slips are view-only')
      return
    }
    if (typeof onMoveToIpd === 'function') {
      onMoveToIpd({
        id: visit.id,
        patient_id: visit.patient,
        patient_uhid: visit.patient_uhid || '',
        patient_name: visit.patient_name || '',
        patient_phone: visit.patient_phone || '',
        doctor_user: visit.doctor_user || '',
        visit_reason: visit.visit_reason || '',
        notes: `Shifted from OPD slip #${visit.queue_number || visit.token_number || '--'}`,
      })
    }
  }

  const totalPages = Math.ceil(total / PAGE_SIZE)
  const statusColors = { waiting: 'bg-amber-100 text-amber-800', in_progress: 'bg-blue-100 text-blue-800', completed: 'bg-emerald-100 text-emerald-800', cancelled: 'bg-red-100 text-red-800' }
  const formatVisitDateLabel = (v) =>
    v.visit_date
      ? `${format(new Date(`${v.visit_date}T12:00:00`), 'dd/MM/yyyy')}${v.created_at ? ` (${formatTime(v.created_at)})` : ''}`
      : v.created_at
        ? `${format(new Date(v.created_at), 'dd/MM/yyyy')} (${formatTime(v.created_at)})`
        : '--'

  async function submitCancelVisit() {
    if (!cancelVisit) return
    const reason = cancelReason.trim()
    if (!reason) {
      toast.error('Please enter cancellation reason')
      return
    }
    setCancelling(true)
    try {
      const res = await api.post(`/opd-visits/${cancelVisit.id}/cancel/`, { cancel_reason: reason })
      toast.success('OPD slip cancelled')
      const updated = res?.data?.data ?? res?.data?.entity ?? res?.data
      const cancelledId = cancelVisit.id
      setCancelVisit(null)
      setCancelReason('')
      if (viewVisit?.id === cancelledId) {
        if (updated?.voided) {
          setViewVisit(null)
        } else {
          setViewVisit((prev) => ({ ...prev, status: 'cancelled', cancel_reason: reason }))
        }
      }
      fetchVisits(page, search)
    } catch (err) {
      const detail = err?.response?.data?.detail || err?.response?.data?.errors?.cancel_reason?.[0] || 'Failed to cancel OPD slip'
      toast.error(detail)
    } finally {
      setCancelling(false)
    }
  }

  return (
    <div className={`flex flex-col min-h-0 ${isMobile ? 'h-full' : 'flex-1 gap-3'}`}>
      {!isMobile && (
        <div className="grid grid-cols-2 gap-3">
          {[['Total Slips', total, 'text-gray-900'], ['Showing', total === 0 ? '0' : `${page * PAGE_SIZE + 1}-${Math.min((page + 1) * PAGE_SIZE, total)}`, 'text-emerald-600']].map(([l, v, c]) => (
            <div key={l} className="bg-white rounded-xl p-3 shadow-sm border border-gray-100 flex items-center gap-3">
               <div className="min-w-0">
                 <p className="text-[11px] font-medium text-gray-400 uppercase tracking-wide">{l}</p>
                 <p className={`text-2xl font-black ${c}`}>{v}</p>
               </div>
            </div>
          ))}
        </div>
      )}

      <div className={`bg-white shadow-sm border border-gray-100 overflow-hidden relative flex flex-col min-h-0 flex-1 ${isMobile ? 'rounded-none border-x-0' : 'rounded-xl'}`}>
        {isMobile ? (
          <MobileListFilters
            search={search}
            onSearchChange={setSearch}
            dateFrom={opdDateFrom}
            dateTo={opdDateTo}
            onDateFromChange={setOpdDateFrom}
            onDateToChange={setOpdDateTo}
            onClearDates={() => { setOpdDateFrom(''); setOpdDateTo('') }}
            loading={loading}
            onRefresh={() => fetchVisits(page, search)}
            total={total}
            totalLabel="slips"
            searchPlaceholder="Search name, mobile, UHID…"
          />
        ) : (
          <div className="px-4 py-2.5 border-b border-gray-100 flex items-center gap-2 bg-gray-50/60 flex-wrap">
            <Search size={15} className="text-gray-400 shrink-0" strokeWidth={2} />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search by name, mobile, UHID…" className="flex-1 min-w-[120px] text-sm outline-none bg-transparent placeholder:text-gray-400" />
            <span className="w-px h-4 bg-gray-200 shrink-0" />
            <div className="flex items-center gap-1.5 shrink-0">
              <label className="text-[11px] text-gray-400 font-semibold uppercase tracking-wide shrink-0">From</label>
              <input
                type="date"
                value={opdDateFrom}
                max={opdDateTo || undefined}
                onChange={e => setOpdDateFrom(e.target.value)}
                className="text-xs border border-gray-200 rounded-lg px-2 py-1 text-gray-700 bg-white focus:outline-none focus:ring-2 focus:ring-emerald-400 focus:border-emerald-400 transition-all cursor-pointer"
              />
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              <label className="text-[11px] text-gray-400 font-semibold uppercase tracking-wide shrink-0">To</label>
              <input
                type="date"
                value={opdDateTo}
                min={opdDateFrom || undefined}
                onChange={e => setOpdDateTo(e.target.value)}
                className="text-xs border border-gray-200 rounded-lg px-2 py-1 text-gray-700 bg-white focus:outline-none focus:ring-2 focus:ring-emerald-400 focus:border-emerald-400 transition-all cursor-pointer"
              />
            </div>
            {(opdDateFrom || opdDateTo) && (
              <button
                onClick={() => { setOpdDateFrom(''); setOpdDateTo('') }}
                className="text-[11px] font-bold text-red-500 hover:text-red-700 bg-red-50 hover:bg-red-100 px-2 py-1 rounded-lg transition-colors border border-red-100 shrink-0"
              >
                ✕ Clear
              </button>
            )}
            <span className="w-px h-4 bg-gray-200 shrink-0" />
            {loading && <span className="w-3.5 h-3.5 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin shrink-0" />}
            <button onClick={() => fetchVisits(page, search)} className="text-gray-400 hover:text-emerald-600 shrink-0"><RefreshCw size={14} strokeWidth={2} /></button>
            <span className="text-xs text-gray-400 shrink-0">{total} slips</span>
          </div>
        )}

        {isMobile ? (
          <MobileCardList>
            {loading ? (
              <div className="py-12 text-center text-sm text-gray-400">Loading…</div>
            ) : visits.length === 0 ? (
              <div className="py-12 text-center text-sm text-gray-400">No OPD slips found</div>
            ) : (
              visits.map((v) => {
                const isCancelled = v.status === 'cancelled'
                return (
                  <OpdSlipMobileCard
                    key={v.id}
                    visit={v}
                    doctorName={getVisitDoctorName(v)}
                    statusColors={statusColors}
                    visitDateLabel={formatVisitDateLabel(v)}
                    isCancelled={isCancelled}
                    onView={() => openViewVisit(v)}
                    onMoveToIpd={() => moveVisitToIpd(v)}
                    onPrint={() => reprintOpdSlip(v)}
                    onEdit={() => openEditVisit(v)}
                    onCancel={() => { setCancelVisit(v); setCancelReason('') }}
                  />
                )
              })
            )}
          </MobileCardList>
        ) : (
          <>
            <div className="grid grid-cols-12 px-4 py-2 bg-gray-100/80 border-b border-gray-200 text-[11px] font-semibold text-gray-500 uppercase tracking-wide">
              <div className="col-span-2">Date/OPD No</div>
              <div className="col-span-2">Patient</div>
              <div className="col-span-2">Doctor</div>
              <div className="col-span-1">Complaint</div>
              <div className="col-span-2 text-center">Status / Amt</div>
              <div className="col-span-3 text-right">Action</div>
            </div>

            <div className="divide-y divide-gray-50 flex-1 overflow-y-auto min-h-0">
              {loading ? <div className="py-12 text-center text-sm text-gray-400">Loading…</div> : visits.length === 0 ? <div className="py-12 text-center text-sm text-gray-400">No OPD slips found</div> : visits.map((v) => {
                const isCancelled = v.status === 'cancelled'
                return (
                 <div key={v.id} className={`grid grid-cols-12 px-4 py-3 items-center text-sm transition-colors ${isCancelled ? 'bg-red-50/40 hover:bg-red-50/50' : 'hover:bg-gray-50/50'}`}>
                    <div className="col-span-2 flex flex-col items-start min-w-0 pr-2">
                      <span className="font-bold text-gray-800">{formatVisitDateLabel(v)}</span>
                      <div className="flex flex-wrap gap-1 mt-0.5">
                        {v.opd_no && <span className="text-[10px] text-blue-600 font-bold bg-blue-50 px-1.5 py-0.5 rounded">{v.opd_no}</span>}
                        <span className="text-[10px] text-emerald-600 font-bold bg-emerald-50 px-1.5 py-0.5 rounded">#{v.queue_number || v.token_number}</span>
                      </div>
                    </div>
                    <div className="col-span-2 min-w-0 pr-2">
                      <p className="font-bold text-gray-800 truncate">{v.patient_name || 'Patient'}</p>
                      <p className="text-[10px] text-gray-500 font-mono truncate">{v.patient_uhid}</p>
                      {v.created_by_name && <p className="text-[10px] text-gray-400 font-bold mt-0.5">By: {v.created_by_name}</p>}
                    </div>
                    <div className="col-span-2 min-w-0 pr-2">
                      <span className="text-gray-600 truncate block">{getVisitDoctorName(v)}</span>
                    </div>
                    <div className="col-span-1 min-w-0 pr-2 text-gray-500 text-xs line-clamp-2">
                      {v.visit_reason || '-'}
                    </div>
                    <div className="col-span-2 flex flex-col items-center gap-1">
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full uppercase ${statusColors[v.status] || 'bg-gray-100 text-gray-800'}`}>
                        {v.status.replace('_', ' ')}
                      </span>
                      {isCancelled && <span className="text-[10px] font-bold text-red-700">Cancelled (view only)</span>}
                      {v.amount && <span className="text-xs font-bold text-gray-600 border border-gray-200 px-1.5 rounded bg-gray-50 flex items-center"><IndianRupee size={10} className="mr-0.5"/> {v.amount} <span className="ml-1 text-[9px] uppercase">({v.payment_mode || 'CASH'})</span></span>}
                    </div>
                    <div className="col-span-3 flex flex-wrap gap-1.5 items-center justify-end">
                      <button
                        onClick={() => openViewVisit(v)}
                        title="View"
                        aria-label="View OPD slip"
                        className="h-8 w-8 hover:w-[72px] flex items-center justify-center gap-1 overflow-hidden text-indigo-600 hover:text-white bg-indigo-50 hover:bg-indigo-600 rounded-lg transition-all duration-150 border border-indigo-100 shadow-sm hover:shadow-md active:scale-95 group"
                      >
                        <Eye size={13} className="group-hover:scale-110 transition-transform" />
                        <span className="max-w-0 opacity-0 translate-x-1 group-hover:max-w-[40px] group-hover:opacity-100 group-hover:translate-x-0 transition-all duration-150 text-[10px] font-black uppercase tracking-widest">View</span>
                      </button>
                      <button
                        onClick={() => moveVisitToIpd(v)}
                        disabled={isCancelled}
                        title="Move to IPD"
                        aria-label="Move OPD to IPD"
                        className={`h-8 w-8 ${isCancelled ? '' : 'hover:w-[70px]'} flex items-center justify-center gap-1 overflow-hidden rounded-lg transition-all duration-150 border shadow-sm active:scale-95 group ${isCancelled ? 'text-gray-400 bg-gray-100 border-gray-200 cursor-not-allowed' : 'text-blue-600 hover:text-white bg-blue-50 hover:bg-blue-600 border-blue-100 hover:shadow-md'}`}
                      >
                        <Bed size={13} className="group-hover:scale-110 transition-transform" />
                        {!isCancelled && <span className="max-w-0 opacity-0 translate-x-1 group-hover:max-w-[36px] group-hover:opacity-100 group-hover:translate-x-0 transition-all duration-150 text-[10px] font-black uppercase tracking-widest">IPD</span>}
                      </button>
                      <button
                        onClick={() => reprintOpdSlip(v)}
                        disabled={isCancelled}
                        title="Print"
                        aria-label="Print OPD slip"
                        className={`h-8 w-8 ${isCancelled ? '' : 'hover:w-[74px]'} flex items-center justify-center gap-1 overflow-hidden rounded-lg transition-all duration-150 border shadow-sm active:scale-95 group ${isCancelled ? 'text-gray-400 bg-gray-100 border-gray-200 cursor-not-allowed' : 'text-sky-600 hover:text-white bg-sky-50 hover:bg-sky-600 border-sky-100 hover:shadow-md'}`}
                      >
                        <Printer size={13} className="group-hover:scale-110 transition-transform" />
                        {!isCancelled && <span className="max-w-0 opacity-0 translate-x-1 group-hover:max-w-[44px] group-hover:opacity-100 group-hover:translate-x-0 transition-all duration-150 text-[10px] font-black uppercase tracking-widest">Print</span>}
                      </button>
                      <button
                        onClick={() => openEditVisit(v)}
                        disabled={isCancelled}
                        title="Edit"
                        aria-label="Edit OPD slip"
                        className={`h-8 w-8 ${isCancelled ? '' : 'hover:w-[68px]'} flex items-center justify-center gap-1 overflow-hidden rounded-lg transition-all duration-150 border shadow-sm active:scale-95 group ${isCancelled ? 'text-gray-400 bg-gray-100 border-gray-200 cursor-not-allowed' : 'text-emerald-600 hover:text-white bg-emerald-50 hover:bg-emerald-600 border-emerald-100 hover:shadow-md'}`}
                      >
                        <Edit2 size={13} className="group-hover:scale-110 transition-transform" />
                        {!isCancelled && <span className="max-w-0 opacity-0 translate-x-1 group-hover:max-w-[36px] group-hover:opacity-100 group-hover:translate-x-0 transition-all duration-150 text-[10px] font-black uppercase tracking-widest">Edit</span>}
                      </button>
                      {!isCancelled && (
                        <button
                          onClick={() => { setCancelVisit(v); setCancelReason('') }}
                          title="Cancel"
                          aria-label="Cancel OPD slip"
                          className="h-8 w-8 hover:w-[84px] flex items-center justify-center gap-1 overflow-hidden text-red-600 hover:text-white bg-red-50 hover:bg-red-600 rounded-lg transition-all duration-150 border border-red-100 shadow-sm hover:shadow-md active:scale-95 group"
                        >
                          <X size={13} className="group-hover:scale-110 transition-transform" />
                          <span className="max-w-0 opacity-0 translate-x-1 group-hover:max-w-[52px] group-hover:opacity-100 group-hover:translate-x-0 transition-all duration-150 text-[10px] font-black uppercase tracking-widest">Cancel</span>
                        </button>
                      )}
                    </div>
                 </div>
              )})}
            </div>
          </>
        )}
      </div>

      {/* Pagination */}
      <div className={`flex items-center justify-between py-1 shrink-0 ${isMobile ? 'px-3 pb-2 bg-white border-t border-gray-100' : 'px-1'}`}>
        <span className="text-sm text-gray-400 font-medium">
          {total === 0 ? 'No slips found' : `Showing ${page * PAGE_SIZE + 1}–${Math.min((page + 1) * PAGE_SIZE, total)} of ${total}`}
        </span>
        <div className="flex items-center gap-2">
          <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0}
            className="px-4 py-1.5 rounded-full text-sm font-semibold bg-gray-200 text-gray-700 hover:bg-gray-300 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
            Previous
          </button>
          <span className="text-sm text-gray-500 font-medium px-1">
            Page {page + 1} of {totalPages || 1}
          </span>
          <button onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))} disabled={page >= totalPages - 1 || totalPages === 0}
            className="px-4 py-1.5 rounded-full text-sm font-semibold bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
            Next
          </button>
        </div>
      </div>

      {editingVisit && (
        <div className="fixed inset-0 z-[100] bg-gray-900/40 backdrop-blur-sm flex items-center justify-center p-4">
          <form onSubmit={handleSaveEdit} className="bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden flex flex-col max-h-full">
            <div className="bg-emerald-600 px-4 py-3 flex items-center justify-between pointer-events-none">
              <h2 className="text-white font-bold pointer-events-auto">Edit OPD Slip</h2>
              <button type="button" onClick={() => setEditingVisit(null)} className="text-white/80 hover:text-white pointer-events-auto"><X size={18} /></button>
            </div>
            <div className="p-4 overflow-y-auto space-y-4">
               <div className="grid grid-cols-2 gap-3">
                 <div className="col-span-2">
                    <label className="block text-xs font-bold text-gray-600 mb-1">Patient Name</label>
                    <div className="flex w-full min-w-0 rounded-xl border border-gray-200 overflow-hidden items-stretch focus-within:ring-2 focus-within:ring-emerald-500 focus-within:border-emerald-400">
                      <select
                        value={editingVisit.salutation_choice ?? ''}
                        onChange={e => setEditingVisit({ ...editingVisit, salutation_choice: e.target.value })}
                        className="shrink-0 w-[5.25rem] sm:w-28 border-0 border-r border-gray-200 bg-gray-50/95 py-2 pl-2 pr-1 text-xs sm:text-sm font-bold text-gray-800 focus:outline-none cursor-pointer"
                        aria-label="Patient title (Mr, Mrs, …)"
                      >
                        {SALUTATION_CHOICE_OPTIONS.map((o) => (
                          <option key={o.value || '_none'} value={o.value}>{o.label}</option>
                        ))}
                      </select>
                      <input
                        type="text"
                        value={editingVisit.patient_name || ''}
                        onChange={e => setEditingVisit({ ...editingVisit, patient_name: e.target.value })}
                        className="flex-1 min-w-0 border-0 rounded-none bg-transparent py-2 px-3 text-sm focus:outline-none focus:ring-0"
                        placeholder="Patient full name"
                      />
                    </div>
                 </div>
                 <div className="col-span-2">
                    <label className="block text-xs font-bold text-gray-600 mb-1">Guardian</label>
                    <div className="flex w-full min-w-0 rounded-xl border border-gray-200 overflow-hidden items-stretch focus-within:ring-2 focus-within:ring-emerald-500 focus-within:border-emerald-400">
                      <select
                        value={editingVisit.patient_guardian_relationship || ''}
                        onChange={e => setEditingVisit({ ...editingVisit, patient_guardian_relationship: e.target.value })}
                        className="shrink-0 w-[6.5rem] sm:min-w-[7.5rem] sm:max-w-[9.5rem] sm:w-36 border-0 border-r border-gray-200/90 bg-gray-50/95 py-2 pl-1.5 pr-0.5 text-[11px] sm:text-xs font-bold text-gray-800 focus:outline-none cursor-pointer"
                        aria-label="Relation to guardian (S/o, W/o, …)"
                      >
                        {GUARDIAN_RELATIONSHIP_OPTIONS.map((o) => (
                          <option key={o.value || '_'} value={o.value}>{o.label}</option>
                        ))}
                      </select>
                      <input
                        type="text"
                        value={editingVisit.patient_guardian_name || ''}
                        onChange={e => setEditingVisit({ ...editingVisit, patient_guardian_name: e.target.value })}
                        className="flex-1 min-w-0 border-0 rounded-none bg-transparent py-2 px-3 text-sm focus:outline-none focus:ring-0"
                        placeholder="Guardian name"
                      />
                    </div>
                 </div>
                 <div>
                    <label className="block text-xs font-bold text-gray-600 mb-1">Phone</label>
                    <input
                      type="text"
                      value={editingVisit.patient_phone || ''}
                      onChange={e => setEditingVisit({ ...editingVisit, patient_phone: e.target.value })}
                      className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 outline-none"
                      placeholder="Mobile number"
                    />
                 </div>
                 <div>
                    <label className="block text-xs font-bold text-gray-600 mb-1">Age</label>
                    <AgeWithUnitInput
                      value={editingVisit.patient_age || ''}
                      unit={editingVisit.patient_age_unit || 'years'}
                      onValueChange={(next) => setEditingVisit({ ...editingVisit, patient_age: next })}
                      onUnitChange={(next) => setEditingVisit({ ...editingVisit, patient_age_unit: next })}
                      inputClassName="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 outline-none"
                    />
                 </div>
                 <div>
                    <label className="block text-xs font-bold text-gray-600 mb-1">Gender</label>
                    <select
                      value={editingVisit.patient_gender || 'male'}
                      onChange={e => setEditingVisit({ ...editingVisit, patient_gender: e.target.value })}
                      className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 outline-none"
                    >
                      <option value="male">Male</option>
                      <option value="female">Female</option>
                      <option value="other">Other</option>
                    </select>
                 </div>
                 <div className="col-span-2">
                    <label className="block text-xs font-bold text-gray-600 mb-1">Address</label>
                    <input
                      type="text"
                      value={editingVisit.patient_address || ''}
                      onChange={e => setEditingVisit({ ...editingVisit, patient_address: e.target.value })}
                      className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 outline-none"
                      placeholder="Address"
                    />
                 </div>
                 <div>
                    <label className="block text-xs font-bold text-gray-600 mb-1">City</label>
                    <input
                      type="text"
                      value={editingVisit.patient_city || ''}
                      onChange={e => setEditingVisit({ ...editingVisit, patient_city: e.target.value })}
                      className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 outline-none"
                      placeholder="City"
                    />
                 </div>
                 <div>
                    <label className="block text-xs font-bold text-gray-600 mb-1">State</label>
                    <input
                      type="text"
                      value={editingVisit.patient_state || ''}
                      onChange={e => setEditingVisit({ ...editingVisit, patient_state: e.target.value })}
                      className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 outline-none"
                      placeholder="State"
                    />
                 </div>
               </div>
               <div>
                  <label className="block text-xs font-bold text-gray-600 mb-1">Visit date &amp; time</label>
                  <input
                    type="datetime-local"
                    required
                    value={editingVisit.visit_datetime || ''}
                    onChange={(e) => {
                      const v = e.target.value
                      setEditingVisit({
                        ...editingVisit,
                        visit_datetime: v,
                        visit_date: v ? v.slice(0, 10) : editingVisit.visit_date,
                      })
                    }}
                    className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 outline-none bg-white"
                  />
               </div>
               <div>
                  <label className="block text-xs font-bold text-gray-600 mb-1">Doctor</label>
                  <select
                    value={editingVisit.doctor_user || ''}
                    onChange={(e) => {
                      const selectedDocId = e.target.value
                      setEditingVisit({
                        ...editingVisit,
                        doctor_user: selectedDocId,
                        department: selectedDocId
                          ? (getDoctorDepartmentValue(doctors, selectedDocId) || editingVisit.department || '')
                          : (editingVisit.department || ''),
                      })
                    }}
                    className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 outline-none"
                  >
                     <option value="">-- No Doctor --</option>
                     {doctors
                       .filter(d => getDoctorUserId(d))
                       .map(d => (
                         <option key={getDoctorUserId(d)} value={getDoctorUserId(d)}>
                           Dr. {d.name || d.first_name || d.email}
                         </option>
                       ))}
                  </select>
               </div>
               <div>
                  <label className="block text-xs font-bold text-gray-600 mb-1">Department</label>
                  <select
                    value={editingVisit.department || ''}
                    onChange={(e) => setEditingVisit({ ...editingVisit, department: e.target.value })}
                    className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 outline-none"
                  >
                    <option value="">-- Select department --</option>
                    {editingVisit.department
                      && !departments.some((dep) => (dep.name || dep.code || '') === editingVisit.department) ? (
                        <option value={editingVisit.department}>{editingVisit.department}</option>
                      ) : null}
                    {departments.map((dep) => (
                      <option key={dep.id} value={dep.name || dep.code || ''}>
                        {dep.name || dep.code}
                      </option>
                    ))}
                  </select>
               </div>
               <div>
                  <label className="block text-xs font-bold text-gray-600 mb-1">Chief Complaint</label>
                  <input type="text" value={editingVisit.visit_reason || ''} onChange={e => setEditingVisit({...editingVisit, visit_reason: e.target.value})} className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 outline-none" />
               </div>
               <div className="grid grid-cols-2 gap-3">
                 <div>
                    <label className="block text-xs font-bold text-gray-600 mb-1">Amount</label>
                    <input type="number" step="1" value={editingVisit.amount || ''} onChange={e => setEditingVisit({...editingVisit, amount: e.target.value})} className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 outline-none" placeholder="e.g. 500" />
                 </div>
                 <div>
                    <label className="block text-xs font-bold text-gray-600 mb-1">Payment</label>
                    <select value={editingVisit.payment_mode || 'cash'} onChange={e => setEditingVisit({...editingVisit, payment_mode: e.target.value})} className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 outline-none">
                       <option value="cash">Cash</option>
                       <option value="upi">UPI</option>
                       <option value="other">Other</option>
                    </select>
                 </div>
               </div>
               <div>
                  <label className="block text-xs font-bold text-gray-600 mb-1">Status</label>
                  <select value={editingVisit.status || 'waiting'} onChange={e => setEditingVisit({...editingVisit, status: e.target.value})} className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 outline-none">
                     <option value="waiting">Waiting</option>
                     <option value="in_progress">In Progress</option>
                     <option value="completed">Completed</option>
                     <option value="cancelled">Cancelled</option>
                  </select>
               </div>
               {opdExtraTemplateFields.length > 0 && (
                 <div className="col-span-2 border-t border-gray-100 pt-3 space-y-3">
                   <p className="text-xs font-bold text-gray-500">Slip template fields</p>
                   {opdExtraTemplateFields.map((fieldName) => (
                     <div key={fieldName}>
                       <label className="block text-xs font-bold text-gray-600 mb-1">{fieldName}</label>
                       <input
                         type="text"
                         value={editingVisit.opd_custom_fields?.[fieldName] ?? ''}
                         onChange={(e) => setEditingVisit({
                           ...editingVisit,
                           opd_custom_fields: {
                             ...normalizeOpdCustomFields(editingVisit.opd_custom_fields),
                             [fieldName]: e.target.value,
                           },
                         })}
                         className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 outline-none"
                         placeholder={`Enter ${fieldName}`}
                       />
                     </div>
                   ))}
                 </div>
               )}
            </div>
            <div className="p-4 border-t border-gray-100 flex gap-2 justify-end bg-gray-50 mt-auto shrink-0">
               <button type="button" onClick={() => setEditingVisit(null)} className="px-4 py-2 rounded-xl text-sm font-bold text-gray-600 hover:bg-gray-200 transition-colors">Cancel</button>
               <button type="submit" className="px-4 py-2 rounded-xl text-sm font-bold bg-emerald-600 text-white hover:bg-emerald-700 transition-colors">Save Changes</button>
            </div>
          </form>
        </div>
      )}
      
      {viewVisit && (
        <div className={`fixed inset-0 z-[100] bg-gray-900/40 backdrop-blur-sm flex ${isMobile ? 'items-stretch p-0' : 'items-center justify-center p-4'}`}>
          <div className={`bg-white shadow-2xl w-full overflow-hidden flex flex-col ${isMobile ? 'h-[100dvh] max-h-[100dvh] rounded-none' : 'max-w-4xl rounded-2xl max-h-[92vh]'}`}>
            <div className="bg-gray-800 px-4 sm:px-5 py-4 flex items-center justify-between text-white shrink-0">
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-10 h-10 rounded-full bg-blue-500 flex items-center justify-center font-black text-lg shadow-inner shrink-0">
                  {viewVisit.patient_name?.charAt(0) || 'P'}
                </div>
                <div className="min-w-0">
                  <h2 className="font-bold text-base sm:text-lg leading-tight truncate">
                    {formatPatientLineForSlip(
                      viewVisit.patient_name,
                      viewVisit.patient_gender,
                      viewVisit.patient_age,
                      viewVisit.patient_salutation,
                      viewVisit.patient_age_unit,
                    ) || '--'}
                  </h2>
                  <p className="text-xs text-gray-400 font-mono tracking-tighter truncate">{viewVisit.patient_uhid || 'No UHID'}</p>
                </div>
              </div>
              <button onClick={() => setViewVisit(null)} className="text-gray-400 hover:text-white transition-colors p-1.5 hover:bg-white/10 rounded-lg shrink-0">
                <X size={20} />
              </button>
            </div>
            
            <div className={`flex-1 min-h-0 overflow-y-auto space-y-5 sm:space-y-6 ${isMobile ? 'p-4' : 'p-6'}`}>
              <div className={`grid gap-5 sm:gap-8 ${isMobile ? 'grid-cols-1' : 'grid-cols-2'}`}>
                {/* Left Column: Demographics */}
                <div className="space-y-5">
                  <div className="flex items-center gap-2 pb-2 border-b border-gray-100">
                    <Users size={18} className="text-emerald-500" />
                    <h3 className="text-sm font-black text-gray-800 uppercase tracking-wider">Patient Demographics</h3>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div className="bg-gray-50 rounded-xl p-3 border border-gray-100">
                      <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1">Gender</p>
                      <p className="text-sm font-bold text-gray-800 capitalize">{viewVisit.patient_gender || '--'}</p>
                    </div>
                    <div className="bg-gray-50 rounded-xl p-3 border border-gray-100">
                      <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1">Age</p>
                      <p className="text-sm font-bold text-gray-800">
                        {formatAgeDisplayLabel(viewVisit.patient_age, viewVisit.patient_age_unit)}
                      </p>
                    </div>
                  </div>

                  <div className="space-y-3">
                    <div className="flex flex-col">
                      <span className="text-[10px] font-black text-gray-400 uppercase">Phone Number</span>
                      <span className="text-sm font-bold text-gray-800 flex items-center gap-1.5 mt-0.5">
                        <Phone size={13} className="text-emerald-500" /> {viewVisit.patient_phone || '--'}
                      </span>
                    </div>
                    <div className="flex flex-col">
                      <span className="text-[10px] font-black text-gray-400 uppercase">Guardian / Relative</span>
                      <span className="text-sm font-bold text-gray-700 mt-0.5">
                        {formatGuardianLineForSlip(viewVisit.patient_guardian_name || '', viewVisit.patient_guardian_relationship) || '--'}
                      </span>
                    </div>
                    <div className="flex flex-col">
                      <span className="text-[10px] font-black text-gray-400 uppercase">Full Address</span>
                      <span className="text-sm font-bold text-gray-700 mt-0.5 leading-relaxed">
                        {viewVisit.patient_address || '--'}
                        {(viewVisit.patient_city || viewVisit.patient_state) && (
                          <span className="block text-xs font-medium text-gray-500 mt-0.5">
                            {viewVisit.patient_city}{viewVisit.patient_city && viewVisit.patient_state ? ', ' : ''}{viewVisit.patient_state}
                          </span>
                        )}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Right Column: Visit & Financials */}
                <div className="space-y-5">
                  <div className="flex items-center gap-2 pb-2 border-b border-gray-100">
                    <Activity size={18} className="text-blue-500" />
                    <h3 className="text-sm font-black text-gray-800 uppercase tracking-wider">Visit & Financials</h3>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div className="flex flex-col">
                      <span className="text-[10px] font-black text-gray-400 uppercase">Consulting Doctor</span>
                      <span className="text-sm font-bold text-gray-700">{viewVisit.doctor_name || '--'}</span>
                    </div>
                    <div className="flex flex-col">
                      <span className="text-[10px] font-black text-gray-400 uppercase">Token / Date</span>
                      <span className="text-sm font-bold text-gray-700">
                        #{viewVisit.queue_number || viewVisit.token_number} · {viewVisit.visit_date ? `${format(new Date(viewVisit.visit_date), 'dd/MM/yyyy')} (${viewVisit.created_at ? formatTime(viewVisit.created_at) : '--'})` : '--'}
                      </span>
                    </div>
                    <div className="flex flex-col col-span-2">
                      <span className="text-[10px] font-black text-gray-400 uppercase">Registration Time</span>
                      <span className="text-sm font-bold text-gray-600">
                        {viewVisit.patient_registered_at ? formatDateTime(viewVisit.patient_registered_at, { paren: true }) : '--'}
                      </span>
                    </div>
                    <div className="flex flex-col col-span-2">
                      <span className="text-[10px] font-black text-gray-400 uppercase mb-1">Chief Complaint</span>
                      <span className="text-sm font-bold text-indigo-700 bg-indigo-50 px-3 py-1.5 rounded-lg inline-block leading-tight">{viewVisit.visit_reason || 'No complaint specified'}</span>
                    </div>
                  </div>

                  <div className="flex items-center justify-between bg-emerald-50 border border-emerald-100 rounded-2xl p-3.5 shadow-sm relative overflow-hidden group">
                    <div>
                      <p className="text-[10px] font-black text-emerald-600/60 uppercase tracking-widest mb-0.5">Billing Amount</p>
                      <p className="text-2xl font-black text-emerald-700 flex items-baseline gap-1.5 focus:outline-none">
                        <span className="text-lg opacity-40">₹</span>{viewVisit.amount || '0'}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-0.5">Payment Mode</p>
                      <span className="text-[11px] font-black px-2.5 py-1 rounded-full bg-emerald-600 text-white uppercase shadow-sm">{viewVisit.payment_mode || 'Cash'}</span>
                    </div>
                  </div>

                  <div className="flex items-center justify-between bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5">
                    <span className="text-xs font-bold text-gray-500 uppercase tracking-wide">Current Status</span>
                    <span className={`text-xs font-black px-3 py-1 rounded-full uppercase tracking-tighter shadow-sm border ${statusColors[viewVisit.status] || 'bg-gray-100 text-gray-800'}`}>
                      {viewVisit.status?.replace('_', ' ')}
                    </span>
                  </div>
                  {viewVisit.status === 'cancelled' && (
                    <div className="bg-red-50 border border-red-100 rounded-xl p-3 space-y-1.5">
                      <p className="text-[10px] font-black text-red-700 uppercase tracking-widest">Cancellation Details</p>
                      <p className="text-xs text-gray-700"><span className="font-bold">Reason:</span> {viewVisit.cancel_reason || '--'}</p>
                      <p className="text-xs text-gray-700"><span className="font-bold">Cancelled By:</span> {viewVisit.cancelled_by_name || '--'}</p>
                      <p className="text-xs text-gray-700"><span className="font-bold">Cancelled At:</span> {viewVisit.cancelled_at ? formatDateTime(viewVisit.cancelled_at, { paren: true }) : '--'}</p>
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div className="border-t border-gray-100 bg-gray-50 shrink-0 p-3 sm:p-4">
              <div className="grid grid-cols-2 gap-2 sm:gap-3">
                <button
                  type="button"
                  onClick={() => setViewVisit(null)}
                  className="col-span-2 sm:col-span-1 py-3 px-3 rounded-xl font-bold text-sm text-gray-600 bg-white border border-gray-200 hover:bg-gray-100 transition-all flex items-center justify-center gap-2 active:scale-[0.98]"
                >
                  <X size={16} /> Close
                </button>
                <button
                  type="button"
                  onClick={() => reprintOpdSlip(viewVisit)}
                  disabled={viewVisit.status === 'cancelled'}
                  className={`py-3 px-3 rounded-xl font-bold text-sm transition-all flex items-center justify-center gap-2 active:scale-[0.98] ${viewVisit.status === 'cancelled' ? 'bg-gray-200 text-gray-500 cursor-not-allowed' : 'bg-indigo-600 text-white hover:bg-indigo-700 shadow-sm'}`}
                >
                  <Printer size={16} /> Print
                </button>
                <button
                  type="button"
                  onClick={() => moveVisitToIpd(viewVisit)}
                  disabled={viewVisit.status === 'cancelled'}
                  className={`py-3 px-3 rounded-xl font-bold text-sm transition-all flex items-center justify-center gap-2 active:scale-[0.98] ${viewVisit.status === 'cancelled' ? 'bg-gray-200 text-gray-500 cursor-not-allowed' : 'bg-blue-600 text-white hover:bg-blue-700 shadow-sm'}`}
                >
                  <Bed size={16} /> Move to IPD
                </button>
                <button
                  type="button"
                  onClick={() => { openEditVisit(viewVisit); setViewVisit(null); }}
                  disabled={viewVisit.status === 'cancelled'}
                  className={`col-span-2 sm:col-span-1 py-3 px-3 rounded-xl font-bold text-sm transition-all flex items-center justify-center gap-2 active:scale-[0.98] ${viewVisit.status === 'cancelled' ? 'bg-gray-200 text-gray-500 cursor-not-allowed' : 'bg-emerald-600 text-white hover:bg-emerald-700 shadow-sm'}`}
                >
                  <Edit2 size={16} /> Edit Visit
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {cancelVisit && (
        <div className="fixed inset-0 z-[110] bg-gray-900/50 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden">
            <div className="px-4 py-3 bg-red-600 text-white flex items-center justify-between">
              <h3 className="font-bold">Cancel OPD Slip</h3>
              <button
                type="button"
                onClick={() => { if (!cancelling) { setCancelVisit(null); setCancelReason('') } }}
                className="text-white/80 hover:text-white"
                disabled={cancelling}
              >
                <X size={18} />
              </button>
            </div>
            <div className="p-4 space-y-3">
              <p className="text-sm text-gray-700">
                You are cancelling slip <span className="font-black text-gray-900">{cancelVisit.opd_no || `#${cancelVisit.queue_number || cancelVisit.token_number}`}</span> for{' '}
                <span className="font-semibold">{cancelVisit.patient_name || 'Patient'}</span>. This will make the slip view-only and remove its amount from collection totals.
              </p>
              <div>
                <label className="block text-xs font-bold text-gray-600 mb-1">Cancellation Reason *</label>
                <textarea
                  value={cancelReason}
                  onChange={e => setCancelReason(e.target.value)}
                  onKeyDown={e => handleCancelReasonKeyDown(e, submitCancelVisit, { disabled: cancelling })}
                  rows={4}
                  className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:border-red-500 focus:ring-1 focus:ring-red-500 outline-none resize-none"
                  placeholder="Enter reason for cancellation"
                  disabled={cancelling}
                />
              </div>
            </div>
            <div className="p-4 border-t border-gray-100 flex justify-end gap-2 bg-gray-50">
              <button
                type="button"
                onClick={() => { if (!cancelling) { setCancelVisit(null); setCancelReason('') } }}
                disabled={cancelling}
                className="px-4 py-2 rounded-xl text-sm font-bold text-gray-600 hover:bg-gray-200 transition-colors disabled:opacity-60"
              >
                Close
              </button>
              <button
                type="button"
                onClick={submitCancelVisit}
                disabled={cancelling}
                className="px-4 py-2 rounded-xl text-sm font-bold bg-red-600 text-white hover:bg-red-700 transition-colors disabled:opacity-60"
              >
                {cancelling ? 'Cancelling...' : 'Confirm Cancel'}
              </button>
            </div>
          </div>
        </div>
      )}

      {printVisit && <PrintSlip visit={printVisit} onClose={() => setPrintVisit(null)} />}
    </div>
  )
}

// ─── Payment Slips / History ───────────────────────────────────────────────────
function PaymentSlipsListSection() {
  const isMobile = useIsMobile()
  const [payments, setPayments] = useState([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(0)
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [editingPayment, setEditingPayment] = useState(null)
  const [viewPayment, setViewPayment] = useState(null)
  const [cancelPayment, setCancelPayment] = useState(null)
  const [cancelPaymentReason, setCancelPaymentReason] = useState('')
  const [cancellingPayment, setCancellingPayment] = useState(false)
  const [quickServices, setQuickServices] = useState([])
  const [itemDropdownIdx, setItemDropdownIdx] = useState(null)
  const [itemDropdownPos, setItemDropdownPos] = useState(null)
  const itemDescRefs = useRef({})
  const PAGE_SIZE = 10
  const debounceRef = useRef(null)

  useEffect(() => {
    api.get('/payments/quick-services/').then(({ data }) => {
      const payload = data?.data
      const rows = Array.isArray(payload?.services) ? payload.services : (Array.isArray(payload) ? payload : [])
      setQuickServices(rows.filter(r => r.label))
    }).catch(() => {})
  }, [])

  useEffect(() => {
    setPage(0)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => fetchPayments(0, search), 300)
    return () => clearTimeout(debounceRef.current)
  }, [search])

  useEffect(() => { setPage(0); fetchPayments(0, search) }, [dateFrom, dateTo])
  useEffect(() => { fetchPayments(page, search) }, [page])

  async function fetchPayments(pg = 0, q = '') {
    setLoading(true)
    try {
      const params = new URLSearchParams({ limit: PAGE_SIZE, offset: pg * PAGE_SIZE, ordering: '-paid_at' })
      const query = q.trim()
      if (query) params.set('search', query)
      if (dateFrom) params.set('paid_at__date__gte', dateFrom)
      if (dateTo) params.set('paid_at__date__lte', dateTo)
      const { data } = await api.get(`/payments/?${params}`)
      const rows = Array.isArray(data?.results)
        ? data.results
        : (Array.isArray(data?.data) ? data.data : (Array.isArray(data) ? data : []))
      setPayments(rows)
      setTotal(Number.isFinite(Number(data?.count)) ? Number(data.count) : rows.length)
    } catch {
      toast.error('Failed to load payment slips')
    } finally {
      setLoading(false)
    }
  }

  async function handleSaveEdit(e) {
    e.preventDefault()
    try {
      const invoiceId = editingPayment.invoice_details?.id || editingPayment.invoice
      const editItems = editingPayment._editItems || []
      let amountForPayment = Number(editingPayment.amount) || 0
      if (invoiceId && editItems.length > 0) {
        const itemsPayload = editItems.map(it => ({
          description: it.description || 'Service',
          category: it.category || '',
          subcategory: it.subcategory || '',
          quantity: Number(it.quantity) || 1,
          unit_price: Number(it.unit_price) || 0,
        }))
        const { data: invRes } = await api.patch(`/invoices/${invoiceId}/update-items/`, {
          items: itemsPayload,
          discount_amount: editingPayment._discount ?? undefined,
          tax_rate: editingPayment._taxRate ?? undefined,
        })
        const inv = invRes?.data ?? invRes
        if (inv?.total_amount != null && Number.isFinite(Number(inv.total_amount))) {
          amountForPayment = Number(inv.total_amount)
        }
      }
      await api.patch(`/payments/${editingPayment.id}/`, {
        payment_mode: editingPayment.payment_mode || 'cash',
        amount: amountForPayment,
        transaction_reference: editingPayment.transaction_reference || '',
        receipt_no: editingPayment.receipt_no || '',
        status: editingPayment.status || 'success',
        paid_at: editingPayment.paid_at || null,
      })
      toast.success('Payment slip updated!')
      setEditingPayment(null)
      fetchPayments(page, search)
    } catch (err) {
      toast.error(formatApiError(err, 'Failed to update payment slip'))
    }
  }

  function openEditPayment(p) {
    const rawItems = Array.isArray(p.invoice_details?.items) ? p.invoice_details.items : []
    const editItems = rawItems.map(it => ({
      id: it.id,
      description: it.description || '',
      category: it.category || '',
      quantity: String(it.quantity ?? 1),
      unit_price: String(it.unit_price ?? 0),
    }))
    setEditingPayment({
      ...p,
      paid_at: toDateTimeInputValue(p.paid_at),
      _editItems: editItems.length > 0 ? editItems : [{ description: '', category: '', quantity: '1', unit_price: '0' }],
      _discount: p.invoice_details?.discount_amount ?? 0,
      _taxRate: p.invoice_details?.tax_rate ?? 0,
    })
  }

  async function submitCancelPayment() {
    if (!cancelPayment) return
    const reason = cancelPaymentReason.trim()
    if (!reason) { toast.error('Please enter cancellation reason'); return }
    setCancellingPayment(true)
    try {
      const res = await api.patch(`/payments/${cancelPayment.id}/`, {
        status: 'cancelled',
        transaction_reference: cancelPayment.transaction_reference
          ? cancelPayment.transaction_reference
          : `Cancelled: ${reason}`,
      })
      toast.success('Payment slip cancelled')
      const updated = res?.data?.data ?? res?.data?.entity ?? res?.data
      const cancelledId = cancelPayment.id
      setCancelPayment(null)
      setCancelPaymentReason('')
      if (viewPayment?.id === cancelledId) {
        if (updated?.voided) {
          setViewPayment(null)
        } else {
          setViewPayment(v => ({ ...v, status: 'cancelled' }))
        }
      }
      fetchPayments(page, search)
    } catch (err) {
      toast.error(err?.response?.data?.detail || 'Failed to cancel payment slip')
    } finally {
      setCancellingPayment(false)
    }
  }

  function resolvePaymentSlipMobile(payment) {
    const raw =
      payment?.patient_phone
      || payment?.invoice_details?.patient_phone
      || payment?.invoice_details?.patient?.phone
      || ''
    const digits = String(raw).replace(/\D/g, '')
    if (digits.length >= 10) return digits.slice(-10)
    const trimmed = String(raw).trim()
    return trimmed || '—'
  }

  function resolvePaymentSlipPatientFields(payment) {
    return {
      gender: payment?.patient_gender,
      age_value: payment?.patient_age,
      age_unit: payment?.patient_age_unit,
      guardian_name: payment?.patient_guardian_name,
      guardian_relationship: payment?.patient_guardian_relationship,
    }
  }

  function printPaymentSlip(payment) {
    if (!payment) return
    const isMobile = isMobileDevice()
    const dateTimeStr = payment.paid_at ? formatDateTime(payment.paid_at, {}) : formatDateTime(new Date(), {})
    const patientName = (payment.patient_name || 'PATIENT').toUpperCase()
    const isCreditDue = payment.status === 'pending' && /credit/i.test(String(payment.transaction_reference || ''))
    const payModeLabel =
      isCreditDue
        ? 'Credit / Due'
        : payment.payment_mode === 'cash'
          ? 'Cash Payment'
          : payment.payment_mode === 'card'
            ? 'Card Payment'
            : payment.payment_mode === 'upi'
              ? 'UPI Payment'
              : (payment.payment_mode || 'Payment').toUpperCase()
    const amountNum = Number(payment.amount || 0)
    const amountFixed = Number.isFinite(amountNum) ? amountNum : 0
    const slipProfile = getPaymentSlipProfile()
    const logoUrl = resolvePaymentSlipLogoUrl(slipProfile)
    const profileLines = buildPaymentSlipProfileLines(slipProfile, escapeHtml)
    const invoiceDetails = payment.invoice_details || null
    let lineItems = buildPaymentSlipItemsForPayment(payment, invoiceDetails)
    if (!lineItems.length) {
      lineItems = [{
        description: payment.transaction_reference || payment.receipt_no || 'Payment',
        quantity: 1,
        unit_price: amountFixed,
        line_total: amountFixed,
      }]
    }
    const discountFixed = Number(invoiceDetails?.discount_amount ?? 0)

    const docHtml = buildPaymentSlipDocumentHtml({
      title: `Receipt — ${payment.slip_number || payment.invoice_no || payment.receipt_no || 'Payment'}`,
      hospitalName: slipProfile.hospital_name || DEFAULT_PAYMENT_SLIP_PROFILE.hospital_name,
      logoUrl,
      profileLines,
      escapeHtml,
      slipNumber: payment.slip_number || '--',
      invoiceNumber: payment.invoice_no || '--',
      patientName,
      genderAge: formatPaymentSlipGenderAge(resolvePaymentSlipPatientFields(payment)),
      payModeLabel,
      mobile: resolvePaymentSlipMobile(payment),
      dateTimeStr,
      guardianLine: formatPaymentSlipGuardianLine(resolvePaymentSlipPatientFields(payment)),
      attributedDoctor: formatPaymentSlipAttributedDoctor(
        payment.attributed_doctor_name || payment.invoice_details?.attributed_doctor_name,
      ),
      lineItems,
      subtotal: amountFixed,
      discount: discountFixed,
      total: amountFixed,
      isCredit: isCreditDue,
      paidBoxLabel: isCreditDue ? 'CREDIT / DUE' : '✓ PAID',
      // On mobile the print trigger comes from patchHtmlForMobile. The desktop close-script does
      // window.location.replace('about:blank') on afterprint/focus, which blanks the Android print
      // preview (it renders the live DOM) — so omit it for the mobile route.
      printCloseScript: isMobile ? '' : PRINT_WINDOW_CLOSE_SCRIPT,
    })

    // Mobile: render the slip on a real same-origin page (/print-slip?job=payment) so the print
    // dialog shows the content. printPaymentSlip runs inside the click gesture, so window.open here
    // is allowed; the slip HTML is handed to that page via localStorage.
    if (isMobile) {
      const win = shouldUseDedicatedPrintDocument() ? null : window.open('/print-slip?job=payment', '_blank')
      deliverMobilePrintHtml(docHtml, {
        targetWindow: win,
        storageKey: 'payment-slip-print-job',
      })
      return
    }

    const w = createSameTabPrintWindow()
    w.document.write(docHtml)
    w.document.close()
  }

  const totalPages = Math.ceil(total / PAGE_SIZE)
  const statusColors = {
    success: 'bg-emerald-100 text-emerald-800',
    pending: 'bg-amber-100 text-amber-800',
    failed: 'bg-red-100 text-red-800',
    cancelled: 'bg-gray-200 text-gray-800',
  }

  return (
    <div className={`flex flex-col min-h-0 ${isMobile ? 'h-full' : 'flex-1 gap-3'}`}>
      {!isMobile && (
        <div className="grid grid-cols-2 gap-3">
          {[['Total Slips', total, 'text-gray-900'], ['Showing', total === 0 ? '0' : `${page * PAGE_SIZE + 1}-${Math.min((page + 1) * PAGE_SIZE, total)}`, 'text-emerald-600']].map(([l, v, c]) => (
            <div key={l} className="bg-white rounded-xl p-3 shadow-sm border border-gray-100 flex items-center gap-3">
              <div className="min-w-0">
                <p className="text-[11px] font-medium text-gray-400 uppercase tracking-wide">{l}</p>
                <p className={`text-2xl font-black ${c}`}>{v}</p>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className={`bg-white shadow-sm border border-gray-100 overflow-hidden relative flex flex-col min-h-0 flex-1 ${isMobile ? 'rounded-none border-x-0' : 'rounded-xl'}`}>
        {isMobile ? (
          <MobileListFilters
            search={search}
            onSearchChange={setSearch}
            dateFrom={dateFrom}
            dateTo={dateTo}
            onDateFromChange={setDateFrom}
            onDateToChange={setDateTo}
            onClearDates={() => { setDateFrom(''); setDateTo('') }}
            loading={loading}
            onRefresh={() => fetchPayments(page, search)}
            total={total}
            totalLabel="slips"
            searchPlaceholder="Search name, mobile, UHID…"
          />
        ) : (
          <div className="px-4 py-2.5 border-b border-gray-100 flex items-center gap-2 bg-gray-50/60 flex-wrap">
            <Search size={15} className="text-gray-400 shrink-0" strokeWidth={2} />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search by name, mobile, UHID…" className="flex-1 min-w-[120px] text-sm outline-none bg-transparent placeholder:text-gray-400" />
            <span className="w-px h-4 bg-gray-200 shrink-0" />
            <div className="flex items-center gap-1.5 shrink-0">
              <label className="text-[11px] text-gray-400 font-semibold uppercase tracking-wide shrink-0">From</label>
              <input
                type="date"
                value={dateFrom}
                max={dateTo || undefined}
                onChange={e => setDateFrom(e.target.value)}
                className="text-xs border border-gray-200 rounded-lg px-2 py-1 text-gray-700 bg-white focus:outline-none focus:ring-2 focus:ring-emerald-400 focus:border-emerald-400 transition-all cursor-pointer"
              />
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              <label className="text-[11px] text-gray-400 font-semibold uppercase tracking-wide shrink-0">To</label>
              <input
                type="date"
                value={dateTo}
                min={dateFrom || undefined}
                onChange={e => setDateTo(e.target.value)}
                className="text-xs border border-gray-200 rounded-lg px-2 py-1 text-gray-700 bg-white focus:outline-none focus:ring-2 focus:ring-emerald-400 focus:border-emerald-400 transition-all cursor-pointer"
              />
            </div>
            {(dateFrom || dateTo) && (
              <button
                onClick={() => { setDateFrom(''); setDateTo('') }}
                className="text-[11px] font-bold text-red-500 hover:text-red-700 bg-red-50 hover:bg-red-100 px-2 py-1 rounded-lg transition-colors border border-red-100 shrink-0"
              >
                ✕ Clear
              </button>
            )}
            <span className="w-px h-4 bg-gray-200 shrink-0" />
            {loading && <span className="w-3.5 h-3.5 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin shrink-0" />}
            <button onClick={() => fetchPayments(page, search)} className="text-gray-400 hover:text-emerald-600 shrink-0"><RefreshCw size={14} strokeWidth={2} /></button>
            <span className="text-xs text-gray-400 shrink-0">{total} slips</span>
          </div>
        )}

        {isMobile ? (
          <MobileCardList>
            {loading ? (
              <div className="py-12 text-center text-sm text-gray-400">Loading…</div>
            ) : payments.length === 0 ? (
              <div className="py-12 text-center text-sm text-gray-400">No payment slips found</div>
            ) : (
              payments.map((p) => {
                const isCancelled = p.status === 'cancelled'
                const payModeLabel =
                  p.status === 'pending' && /credit/i.test(String(p.transaction_reference || ''))
                    ? 'credit'
                    : (p.payment_mode || 'cash')
                return (
                  <PaymentSlipMobileCard
                    key={p.id}
                    payment={p}
                    dateLabel={p.paid_at ? formatDateTime(p.paid_at, { paren: true }) : '--'}
                    statusColors={statusColors}
                    payModeLabel={payModeLabel}
                    isCancelled={isCancelled}
                    onView={() => setViewPayment(p)}
                    onEdit={() => openEditPayment(p)}
                    onCancel={() => { setCancelPayment(p); setCancelPaymentReason('') }}
                  />
                )
              })
            )}
          </MobileCardList>
        ) : (
          <>
            <div className="grid grid-cols-12 px-4 py-2 bg-gray-100/80 border-b border-gray-200 text-[11px] font-semibold text-gray-500 uppercase tracking-wide">
              <div className="col-span-2">Date/Receipt</div>
              <div className="col-span-2">Patient</div>
              <div className="col-span-2">Invoice/Mode</div>
              <div className="col-span-2 text-center">Status / Amt</div>
              <div className="col-span-2">Ref</div>
              <div className="col-span-2 text-right">Action</div>
            </div>

            <div className="divide-y divide-gray-50 flex-1 overflow-y-auto min-h-0">
              {loading ? <div className="py-12 text-center text-sm text-gray-400">Loading…</div> : payments.length === 0 ? <div className="py-12 text-center text-sm text-gray-400">No payment slips found</div> : payments.map((p) => (
                <div key={p.id} className="grid grid-cols-12 px-4 py-3 items-center text-sm hover:bg-gray-50/50 transition-colors">
              <div className="col-span-2 flex flex-col items-start min-w-0 pr-2">
                <span className="font-bold text-gray-800">{p.paid_at ? formatDateTime(p.paid_at, { paren: true }) : '--'}</span>
                <span className="text-xs text-emerald-600 font-bold bg-emerald-50 px-1.5 py-0.5 mt-0.5 rounded">{p.receipt_no || '--'}</span>
              </div>
              <div className="col-span-2 min-w-0 pr-2">
                <p className="font-bold text-gray-800 truncate">{p.patient_name || 'Patient'}</p>
                <p className="text-[10px] text-gray-500 font-mono truncate">{p.patient_uhid || '--'}</p>
                <p className="text-[10px] text-indigo-600 font-bold mt-0.5 truncate">{p.attributed_doctor_name || 'Self (Hospital)'}</p>
                {p.collected_by_name && <p className="text-[10px] text-gray-400 font-bold mt-0.5">By: {p.collected_by_name}</p>}
              </div>
              <div className="col-span-2 min-w-0 pr-2">
                <span className="text-gray-600 truncate block font-semibold">{p.invoice_no || '--'}</span>
                <span className="text-[10px] text-indigo-600 font-bold uppercase">
                  {p.status === 'pending' && /credit/i.test(String(p.transaction_reference || ''))
                    ? 'credit'
                    : (p.payment_mode || 'cash')}
                </span>
              </div>
              <div className="col-span-2 flex flex-col items-center gap-1">
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full uppercase ${statusColors[p.status] || 'bg-gray-100 text-gray-800'}`}>
                  {p.status}
                </span>
                <span className="text-xs font-bold text-gray-600 border border-gray-200 px-1.5 rounded bg-gray-50 flex items-center">
                  <IndianRupee size={10} className="mr-0.5" /> {p.amount || '0'}
                </span>
              </div>
              <div className="col-span-2 min-w-0 pr-2">
                <p className="text-xs text-gray-500 truncate">{p.transaction_reference || '--'}</p>
              </div>
              <div className="col-span-2 flex flex-row gap-1.5 items-center justify-end">
                <button
                  onClick={() => setViewPayment(p)}
                  title="View"
                  aria-label="View payment slip"
                  className="h-8 w-8 hover:w-[72px] flex items-center justify-center gap-1 overflow-hidden text-indigo-600 hover:text-white bg-indigo-50 hover:bg-indigo-600 rounded-lg transition-all duration-150 border border-indigo-100 shadow-sm hover:shadow-md active:scale-95 group"
                >
                  <Eye size={13} className="group-hover:scale-110 transition-transform" />
                  <span className="max-w-0 opacity-0 translate-x-1 group-hover:max-w-[40px] group-hover:opacity-100 group-hover:translate-x-0 transition-all duration-150 text-[10px] font-black uppercase tracking-widest">View</span>
                </button>
                {p.status !== 'cancelled' && (
                  <button
                    onClick={() => openEditPayment(p)}
                    title="Edit"
                    aria-label="Edit payment slip"
                    className="h-8 w-8 hover:w-[68px] flex items-center justify-center gap-1 overflow-hidden text-emerald-600 hover:text-white bg-emerald-50 hover:bg-emerald-600 rounded-lg transition-all duration-150 border border-emerald-100 shadow-sm hover:shadow-md active:scale-95 group"
                  >
                    <Edit2 size={13} className="group-hover:scale-110 transition-transform" />
                    <span className="max-w-0 opacity-0 translate-x-1 group-hover:max-w-[36px] group-hover:opacity-100 group-hover:translate-x-0 transition-all duration-150 text-[10px] font-black uppercase tracking-widest">Edit</span>
                  </button>
                )}
                {p.status !== 'cancelled' && (
                  <button
                    onClick={() => { setCancelPayment(p); setCancelPaymentReason('') }}
                    title="Cancel"
                    aria-label="Cancel payment slip"
                    className="h-8 w-8 hover:w-[84px] flex items-center justify-center gap-1 overflow-hidden text-red-600 hover:text-white bg-red-50 hover:bg-red-600 rounded-lg transition-all duration-150 border border-red-100 shadow-sm hover:shadow-md active:scale-95 group"
                  >
                    <X size={13} className="group-hover:scale-110 transition-transform" />
                    <span className="max-w-0 opacity-0 translate-x-1 group-hover:max-w-[52px] group-hover:opacity-100 group-hover:translate-x-0 transition-all duration-150 text-[10px] font-black uppercase tracking-widest">Cancel</span>
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
          </>
        )}
      </div>

      <div className={`flex items-center justify-between py-1 shrink-0 ${isMobile ? 'px-3 pb-2 bg-white border-t border-gray-100' : 'px-1'}`}>
        <span className="text-sm text-gray-400 font-medium">
          {total === 0 ? 'No slips found' : `Showing ${page * PAGE_SIZE + 1}–${Math.min((page + 1) * PAGE_SIZE, total)} of ${total}`}
        </span>
        <div className="flex items-center gap-2">
          <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0}
            className="px-4 py-1.5 rounded-full text-sm font-semibold bg-gray-200 text-gray-700 hover:bg-gray-300 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
            Previous
          </button>
          <span className="text-sm text-gray-500 font-medium px-1">
            Page {page + 1} of {totalPages || 1}
          </span>
          <button onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))} disabled={page >= totalPages - 1 || totalPages === 0}
            className="px-4 py-1.5 rounded-full text-sm font-semibold bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
            Next
          </button>
        </div>
      </div>

      {editingPayment && (
        <div className="fixed inset-0 z-[100] bg-gray-900/40 backdrop-blur-sm flex items-center justify-center p-4">
          <form onSubmit={handleSaveEdit} className="bg-white rounded-2xl shadow-xl w-full max-w-lg overflow-hidden flex flex-col max-h-[92vh]">
            <div className="bg-emerald-600 px-4 py-3 flex items-center justify-between pointer-events-none">
              <h2 className="text-white font-bold pointer-events-auto">Edit Payment Slip</h2>
              <button type="button" onClick={() => setEditingPayment(null)} className="text-white/80 hover:text-white pointer-events-auto"><X size={18} /></button>
            </div>
            <div className="p-4 overflow-y-auto space-y-4">

              {/* Read-only context */}
              <div className="bg-gray-50 border border-gray-200 rounded-xl p-3 grid grid-cols-3 gap-3">
                <div>
                  <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-0.5">Patient</p>
                  <p className="text-xs font-bold text-gray-800 truncate">{editingPayment.patient_name || '—'}</p>
                  <p className="text-[10px] text-gray-500 font-mono">{editingPayment.patient_uhid || '—'}</p>
                </div>
                <div>
                  <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-0.5">Invoice No</p>
                  <p className="text-xs font-bold text-gray-800 break-all">{editingPayment.invoice_no || '—'}</p>
                </div>
                <div>
                  <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-0.5">Slip No</p>
                  <p className="text-xs font-bold text-gray-800 break-all">{editingPayment.slip_number || '—'}</p>
                </div>
              </div>

              {/* Paid At */}
              <div>
                <label className="block text-xs font-bold text-gray-600 mb-1">Paid At</label>
                <input type="datetime-local" value={editingPayment.paid_at || ''} onChange={e => setEditingPayment({ ...editingPayment, paid_at: e.target.value })} className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 outline-none" />
              </div>

              {/* Amount + Mode */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-gray-600 mb-1">Amount (₹)</label>
                  <input type="number" step="0.01" min="0" value={editingPayment.amount || ''} onChange={e => setEditingPayment({ ...editingPayment, amount: e.target.value })} className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 outline-none" />
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-600 mb-1">Payment Mode</label>
                  <select value={editingPayment.payment_mode || 'cash'} onChange={e => setEditingPayment({ ...editingPayment, payment_mode: e.target.value })} className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 outline-none">
                    <option value="cash">Cash</option>
                    <option value="upi">UPI</option>
                    <option value="card">Card</option>
                    <option value="bank_transfer">Bank Transfer</option>
                    <option value="other">Other</option>
                  </select>
                </div>
              </div>

              {/* Receipt + Status */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-gray-600 mb-1">Receipt Number</label>
                  <input type="text" value={editingPayment.receipt_no || ''} onChange={e => setEditingPayment({ ...editingPayment, receipt_no: e.target.value })} className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 outline-none" placeholder="e.g. RCP-001" />
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-600 mb-1">Status</label>
                  <select value={editingPayment.status || 'success'} onChange={e => setEditingPayment({ ...editingPayment, status: e.target.value })} className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 outline-none">
                    <option value="success">Success</option>
                    <option value="pending">Pending</option>
                    <option value="failed">Failed</option>
                    <option value="cancelled">Cancelled</option>
                  </select>
                </div>
              </div>

              {/* Transaction Reference */}
              <div>
                <label className="block text-xs font-bold text-gray-600 mb-1">Transaction Reference</label>
                <input type="text" value={editingPayment.transaction_reference || ''} onChange={e => setEditingPayment({ ...editingPayment, transaction_reference: e.target.value })} className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 outline-none" placeholder="UPI ID, cheque no., etc." />
              </div>

              {/* Line Items Editor */}
              {editingPayment.invoice_details?.id || editingPayment.invoice ? (
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="text-xs font-bold text-gray-600">Invoice Items</label>
                    <button
                      type="button"
                      onClick={() => setEditingPayment(prev => ({ ...prev, _editItems: [...(prev._editItems || []), { description: '', category: '', quantity: '1', unit_price: '0' }] }))}
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
                    {(editingPayment._editItems || []).map((item, idx) => {
                      const lineTotal = (Number(item.quantity) || 0) * (Number(item.unit_price) || 0)
                      return (
                        <div key={idx} className="grid grid-cols-12 gap-1 px-2 py-1.5 border-t border-gray-100 items-center">
                          <div className="col-span-5">
                            <input
                              ref={el => { itemDescRefs.current[idx] = el }}
                              type="text"
                              value={item.description}
                              onChange={e => {
                                const next = [...editingPayment._editItems]
                                next[idx] = { ...next[idx], description: e.target.value }
                                setEditingPayment(prev => ({ ...prev, _editItems: next }))
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
                              onChange={e => {
                                const next = [...editingPayment._editItems]
                                next[idx] = { ...next[idx], category: e.target.value }
                                setEditingPayment(prev => ({ ...prev, _editItems: next }))
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
                              onChange={e => {
                                const next = [...editingPayment._editItems]
                                next[idx] = { ...next[idx], quantity: e.target.value }
                                setEditingPayment(prev => ({ ...prev, _editItems: next }))
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
                              onChange={e => {
                                const next = [...editingPayment._editItems]
                                next[idx] = { ...next[idx], unit_price: e.target.value }
                                setEditingPayment(prev => ({ ...prev, _editItems: next }))
                              }}
                              className="w-full border border-gray-200 rounded-lg px-2 py-1 text-xs text-right focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 outline-none"
                            />
                          </div>
                          <div className="col-span-1 flex justify-end">
                            {editingPayment._editItems.length > 1 && (
                              <button
                                type="button"
                                onClick={() => {
                                  const next = editingPayment._editItems.filter((_, i) => i !== idx)
                                  setEditingPayment(prev => ({ ...prev, _editItems: next }))
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
                        {editingPayment._editItems?.length || 0} item(s)
                      </span>
                      <span className="text-xs font-black text-emerald-700">
                        Total: ₹{(editingPayment._editItems || []).reduce((s, it) => s + (Number(it.quantity) || 0) * (Number(it.unit_price) || 0), 0).toFixed(2)}
                      </span>
                    </div>
                  </div>
                </div>
              ) : null}

            </div>
            <div className="p-4 border-t border-gray-100 flex gap-2 justify-end bg-gray-50 mt-auto shrink-0">
              <button type="button" onClick={() => setEditingPayment(null)} className="px-4 py-2 rounded-xl text-sm font-bold text-gray-600 hover:bg-gray-200 transition-colors">Close</button>
              <button type="submit" className="px-4 py-2 rounded-xl text-sm font-bold bg-emerald-600 text-white hover:bg-emerald-700 transition-colors">Save Changes</button>
            </div>
          </form>
        </div>
      )}

      {/* Quick-service dropdown portal — renders outside the clipping modal */}
      {itemDropdownIdx !== null && itemDropdownPos && (() => {
        const item = editingPayment?._editItems?.[itemDropdownIdx]
        if (!item) return null
        const descLower = (item.description || '').toLowerCase()
        const filteredSvc = quickServices.filter(s =>
          !descLower || s.label.toLowerCase().includes(descLower)
        )
        if (filteredSvc.length === 0) return null

        // Group by category
        const grouped = {}
        filteredSvc.forEach(svc => {
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
                    onMouseDown={e => {
                      e.preventDefault()
                      const next = [...editingPayment._editItems]
                      next[itemDropdownIdx] = {
                        ...next[itemDropdownIdx],
                        description: svc.label,
                        category: svc.category || '',
                        unit_price: String(svc.price ?? 0),
                      }
                      setEditingPayment(prev => ({ ...prev, _editItems: next }))
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
          document.body
        )
      })()}

      {/* Cancel Payment Modal */}
      {cancelPayment && (
        <div className="fixed inset-0 z-[110] bg-gray-900/50 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden">
            <div className="px-4 py-3 bg-red-600 text-white flex items-center justify-between">
              <h3 className="font-bold">Cancel Payment Slip</h3>
              <button type="button" onClick={() => { if (!cancellingPayment) { setCancelPayment(null); setCancelPaymentReason('') } }} className="text-white/80 hover:text-white" disabled={cancellingPayment}>
                <X size={18} />
              </button>
            </div>
            <div className="p-4 space-y-3">
              <p className="text-sm text-gray-700">
                You are cancelling slip <span className="font-black text-gray-900">{cancelPayment.slip_number || cancelPayment.invoice_no || `#${cancelPayment.receipt_no}`}</span> for{' '}
                <span className="font-semibold">{cancelPayment.patient_name || 'Patient'}</span> of amount <span className="font-black text-red-600">₹{Number(cancelPayment.amount || 0).toLocaleString('en-IN')}</span>. This will mark the slip as cancelled.
              </p>
              <div>
                <label className="block text-xs font-bold text-gray-600 mb-1">Cancellation Reason *</label>
                <textarea
                  value={cancelPaymentReason}
                  onChange={e => setCancelPaymentReason(e.target.value)}
                  onKeyDown={e => handleCancelReasonKeyDown(e, submitCancelPayment, { disabled: cancellingPayment })}
                  rows={4}
                  className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:border-red-500 focus:ring-1 focus:ring-red-500 outline-none resize-none"
                  placeholder="Enter reason for cancellation"
                  disabled={cancellingPayment}
                />
              </div>
            </div>
            <div className="p-4 border-t border-gray-100 flex justify-end gap-2 bg-gray-50">
              <button type="button" onClick={() => { if (!cancellingPayment) { setCancelPayment(null); setCancelPaymentReason('') } }} disabled={cancellingPayment} className="px-4 py-2 rounded-xl text-sm font-bold text-gray-600 hover:bg-gray-200 transition-colors disabled:opacity-60">Close</button>
              <button type="button" onClick={submitCancelPayment} disabled={cancellingPayment} className="px-4 py-2 rounded-xl text-sm font-bold bg-red-600 text-white hover:bg-red-700 transition-colors disabled:opacity-60">
                {cancellingPayment ? 'Cancelling...' : 'Confirm Cancel'}
              </button>
            </div>
          </div>
        </div>
      )}

      {viewPayment && (
        <div className={`fixed inset-0 z-[100] bg-gray-900/40 backdrop-blur-sm flex ${isMobile ? 'items-stretch p-0' : 'items-center justify-center p-4'}`}>
          <div className={`bg-white shadow-2xl w-full overflow-hidden flex flex-col ${isMobile ? 'h-[100dvh] max-h-[100dvh] rounded-none' : 'max-w-4xl rounded-2xl max-h-[92vh]'}`}>
            <div className="bg-gray-800 px-4 sm:px-5 py-4 flex items-center justify-between text-white shrink-0">
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-10 h-10 rounded-full bg-indigo-500 flex items-center justify-center font-black text-lg shadow-inner shrink-0">
                  <Receipt size={18} />
                </div>
                <div className="min-w-0">
                  <h2 className="font-bold text-base sm:text-lg leading-tight truncate">{viewPayment.patient_name || 'Payment Slip'}</h2>
                  <p className="text-xs text-gray-400 font-mono tracking-tighter truncate">{viewPayment.patient_uhid || 'No UHID'}</p>
                </div>
              </div>
              <button onClick={() => setViewPayment(null)} className="text-gray-400 hover:text-white transition-colors p-1.5 hover:bg-white/10 rounded-lg shrink-0">
                <X size={20} />
              </button>
            </div>

            <div className={`grid grid-cols-2 md:grid-cols-4 gap-2.5 shrink-0 ${isMobile ? 'p-3' : 'p-4'}`}>
              <div className="bg-gray-50 rounded-lg p-2 border border-gray-100 md:col-span-2">
                <p className="text-[9px] font-black text-gray-400 uppercase tracking-widest mb-0.5">Invoice No</p>
                <p className="text-xs font-bold text-gray-800 break-all">{viewPayment.invoice_no || '--'}</p>
              </div>
              <div className="bg-emerald-50 border border-emerald-100 rounded-lg p-2 md:col-span-2">
                <p className="text-[9px] font-black text-emerald-600/70 uppercase tracking-widest mb-0.5">Amount</p>
                <p className="text-lg font-black text-emerald-700">₹{Number(viewPayment.amount || 0).toLocaleString('en-IN')}</p>
              </div>
              <div className="bg-gray-50 rounded-lg p-2 border border-gray-100">
                <p className="text-[9px] font-black text-gray-400 uppercase tracking-widest mb-0.5">Receipt No</p>
                <p className="text-xs font-bold text-gray-800">{viewPayment.receipt_no || '--'}</p>
              </div>
              <div className="bg-gray-50 rounded-lg p-2 border border-gray-100">
                <p className="text-[9px] font-black text-gray-400 uppercase tracking-widest mb-0.5">Payment Mode</p>
                <p className="text-xs font-bold text-gray-800 uppercase">
                  {viewPayment.status === 'pending' && /credit/i.test(String(viewPayment.transaction_reference || ''))
                    ? 'CREDIT'
                    : (viewPayment.payment_mode || '--')}
                </p>
              </div>
              <div className="bg-gray-50 rounded-lg p-2 border border-gray-100">
                <p className="text-[9px] font-black text-gray-400 uppercase tracking-widest mb-0.5">Status</p>
                <span className={`inline-flex text-[10px] font-bold px-2 py-0.5 rounded-full uppercase ${statusColors[viewPayment.status] || 'bg-gray-100 text-gray-800'}`}>
                  {viewPayment.status || '--'}
                </span>
              </div>
              <div className="bg-gray-50 rounded-lg p-2 border border-gray-100">
                <p className="text-[9px] font-black text-gray-400 uppercase tracking-widest mb-0.5">Collected By</p>
                <p className="text-xs font-bold text-gray-800 truncate">{viewPayment.collected_by_name || '--'}</p>
              </div>
              <div className="bg-gray-50 rounded-lg p-2 border border-gray-100 md:col-span-2">
                <p className="text-[9px] font-black text-gray-400 uppercase tracking-widest mb-0.5">Paid At</p>
                <p className="text-xs font-bold text-gray-800">{viewPayment.paid_at ? formatDateTime(viewPayment.paid_at, { paren: true }) : '--'}</p>
              </div>
              <div className="bg-gray-50 rounded-lg p-2 border border-gray-100 md:col-span-2">
                <p className="text-[9px] font-black text-gray-400 uppercase tracking-widest mb-0.5">Transaction Reference</p>
                <p className="text-xs font-bold text-gray-800 break-all">{viewPayment.transaction_reference || '--'}</p>
              </div>
            </div>

            <div className={`flex-1 min-h-0 ${isMobile ? 'px-3 pb-3' : 'px-4 pb-3'}`}>
              <div className="bg-white rounded-xl border border-gray-100 overflow-hidden h-full flex flex-col">
                <div className="px-3 py-2 border-b border-gray-100 text-[10px] font-black text-gray-500 uppercase tracking-widest">
                  Billed Items
                </div>
                {Array.isArray(viewPayment?.invoice_details?.items) && viewPayment.invoice_details.items.length > 0 ? (
                  <div className={`overflow-y-auto ${isMobile ? 'min-h-[180px]' : 'min-h-[240px] max-h-[44vh]'}`}>
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
                        {viewPayment.invoice_details.items.map((it) => (
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
                  <div className={`flex items-center justify-center text-sm text-gray-400 ${isMobile ? 'min-h-[180px]' : 'min-h-[240px]'}`}>
                    No billed items
                  </div>
                )}
              </div>
            </div>

            <div className="border-t border-gray-100 bg-gray-50 shrink-0 p-3 sm:p-4">
              <div className="grid grid-cols-2 gap-2 sm:gap-3">
                <button
                  type="button"
                  onClick={() => setViewPayment(null)}
                  className="col-span-2 sm:col-span-1 py-3 px-3 rounded-xl font-bold text-sm text-gray-600 bg-white border border-gray-200 hover:bg-gray-100 transition-all flex items-center justify-center gap-2 active:scale-[0.98]"
                >
                  <X size={16} /> Close
                </button>
                <button
                  type="button"
                  onClick={() => printPaymentSlip(viewPayment)}
                  // className="py-3 px-3 rounded-xl font-bold text-sm bg-indigo-600 text-white hover:bg-indigo-700 transition-all shadow-sm flex items-center justify-center gap-2 active:scale-[0.98]"
                  className="col-span-2 sm:col-span-1 py-3 px-3 rounded-xl font-bold text-sm bg-indigo-600 text-white hover:bg-indigo-700 transition-all shadow-sm flex items-center justify-center gap-2 active:scale-[0.98]"
                >
                  <Printer size={16} /> Print
                </button>
                <button
                  type="button"
                  onClick={() => { setEditingPayment({ ...viewPayment, paid_at: toDateTimeInputValue(viewPayment.paid_at) }); setViewPayment(null) }}
                  className="col-span-2 sm:col-span-1 py-3 px-3 rounded-xl font-bold text-sm bg-emerald-600 text-white hover:bg-emerald-700 transition-all shadow-sm flex items-center justify-center gap-2 active:scale-[0.98]"
                >
                  <Edit2 size={16} /> Edit Slip
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function PaymentSlipSettingsSection() {
  const [form, setForm] = useState(() => getPaymentSlipProfile())
  const [logoPreview, setLogoPreview] = useState(() => getPaymentSlipProfile().hospital_logo_url || '')
  const [timeDisplayMode, setTimeDisplayMode] = useState(() => getTimeDisplayMode())
  const [timeModeSaving, setTimeModeSaving] = useState(false)
  const [formatsOpen, setFormatsOpen] = useState(false)
  const [formatErrors, setFormatErrors] = useState({})

  useEffect(() => {
    let cancelled = false
    async function hydrate() {
      await loadReceptionPortalSettings()
      if (!cancelled) {
        const next = getPaymentSlipProfile()
        setForm(next)
        setLogoPreview(next.hospital_logo_url || '')
        setTimeDisplayMode(getTimeDisplayMode())
      }
    }
    hydrate()
    return () => { cancelled = true }
  }, [])

  async function handleTimeDisplayToggle(checked) {
    const next = checked ? '24h' : '12h'
    setTimeModeSaving(true)
    try {
      const { data } = await api.patch('/settings/reception-portal/', { time_display_mode: next })
      const row = data?.data || data || {}
      receptionPortalSettingsCache = {
        ...receptionPortalSettingsCache,
        time_display_mode: row.time_display_mode === '12h' ? '12h' : '24h',
      }
      syncTimeDisplayModeFromRow(row)
      setTimeDisplayMode(getTimeDisplayMode())
      toast.success(`Time format set to ${next === '24h' ? '24 hour' : '12 hour'}`)
    } catch {
      toast.error('Failed to update time format')
    } finally {
      setTimeModeSaving(false)
    }
  }

  function onChange(key, value) {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  function onFormatPartFieldChange(docType, field, value) {
    setForm((prev) => ({
      ...prev,
      document_number_formats: onFormatPartChange(prev.document_number_formats, docType, field, value),
    }))
    setFormatErrors((prev) => {
      const next = { ...prev }
      delete next[docType]
      return next
    })
  }

  function onNextNumberChange(docType, value) {
    const nextVal = Math.max(1, parseInt(value, 10) || 1)
    setForm((prev) => ({
      ...prev,
      document_next_numbers: {
        ...normalizeDocumentNextNumbers(prev.document_next_numbers),
        [docType]: nextVal,
      },
    }))
  }

  function validateAllFormatTemplates(formats) {
    return validateAllDocumentNumberFormats(formats)
  }

  function resetDocumentNumberFormats() {
    setForm((prev) => ({
      ...prev,
      uhid_prefix: DEFAULT_PAYMENT_SLIP_PROFILE.uhid_prefix,
      invoice_prefix: DEFAULT_PAYMENT_SLIP_PROFILE.invoice_prefix,
      invoice_next_number: DEFAULT_PAYMENT_SLIP_PROFILE.invoice_next_number,
      document_number_formats: getDefaultDocumentNumberParts(),
      document_next_numbers: normalizeDocumentNextNumbers(DEFAULT_DOCUMENT_NEXT_NUMBERS),
    }))
    setFormatErrors({})
  }

  function onLogoFileChange(file) {
    if (!file) return
    const previewUrl = URL.createObjectURL(file)
    setLogoPreview(previewUrl)
    setForm((prev) => ({
      ...prev,
      hospital_logo_file: file,
      remove_hospital_logo: false,
    }))
  }

  function onRemoveLogo() {
    setLogoPreview('')
    setForm((prev) => ({
      ...prev,
      hospital_logo_file: null,
      hospital_logo_url: '',
      remove_hospital_logo: true,
    }))
  }

  async function handleSave(e) {
    e.preventDefault()
    const errors = validateAllFormatTemplates(form.document_number_formats)
    if (Object.keys(errors).length > 0) {
      setFormatErrors(errors)
      setFormatsOpen(true)
      toast.error('Fix document number format errors before saving')
      return
    }
    setFormatErrors({})
    try {
      await savePaymentSlipProfile(form)
      const next = getPaymentSlipProfile()
      setForm(next)
      setLogoPreview(next.hospital_logo_url || '')
      toast.success('Payment slip details saved')
    } catch {
      toast.error('Failed to save payment slip details')
    }
  }

  async function handleReset() {
    setForm({ ...DEFAULT_PAYMENT_SLIP_PROFILE, remove_hospital_logo: true })
    setLogoPreview('')
    setFormatErrors({})
    try {
      await savePaymentSlipProfile({ ...DEFAULT_PAYMENT_SLIP_PROFILE, remove_hospital_logo: true })
      const next = getPaymentSlipProfile()
      setForm(next)
      setLogoPreview(next.hospital_logo_url || '')
      toast.success('Payment slip details reset')
    } catch {
      toast.error('Failed to reset payment slip details')
    }
  }

  const normalizedFormats = normalizeDocumentNumberFormats(form.document_number_formats)
  const normalizedNextNumbers = normalizeDocumentNextNumbers(form.document_next_numbers)

  return (
    <div className="max-w-3xl mx-auto">
      <div className="bg-white border border-gray-100 rounded-2xl shadow-sm p-5 md:p-6">
        <h2 className="text-lg font-black text-gray-800">Hospital Settings</h2>
        <p className="text-sm text-gray-500 mt-1">
          Hospital branding for payment slips and configurable document number formats.
        </p>

        <div className="mt-5 border border-gray-100 rounded-xl p-4 bg-gray-50/50">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm font-bold text-gray-800">Time display format</p>
              <p className="text-xs text-gray-500 mt-0.5">
                Controls how times appear across reception, doctor, pharmacy, lab, reports, and printed receipts.
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0 px-3 py-1.5 border border-emerald-200 rounded-full bg-white">
              <span className={`text-xs font-bold select-none ${timeDisplayMode === '12h' ? 'text-emerald-700' : 'text-gray-400'}`}>
                12 hour
              </span>
              <button
                type="button"
                role="switch"
                aria-checked={timeDisplayMode === '24h'}
                disabled={timeModeSaving}
                onClick={() => handleTimeDisplayToggle(timeDisplayMode !== '24h')}
                className={`relative w-14 h-7 rounded-full transition-colors duration-200 focus:outline-none shrink-0 disabled:opacity-60 ${
                  timeDisplayMode === '24h' ? 'bg-emerald-500' : 'bg-gray-300'
                }`}
              >
                <span className={`absolute top-0.5 left-0.5 w-6 h-6 bg-white rounded-full shadow-md transition-transform duration-200 ${
                  timeDisplayMode === '24h' ? 'translate-x-7' : 'translate-x-0'
                }`} />
              </button>
              <span className={`text-xs font-bold select-none ${timeDisplayMode === '24h' ? 'text-emerald-700' : 'text-gray-400'}`}>
                24 hour
              </span>
            </div>
          </div>
        </div>

        <form onSubmit={handleSave} className="mt-5 space-y-4">
          <div className="border border-gray-100 rounded-xl overflow-hidden bg-gray-50/50">
            <button
              type="button"
              onClick={() => setFormatsOpen((open) => !open)}
              className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left hover:bg-gray-50 transition-colors"
            >
              <div>
                <p className="text-sm font-bold text-gray-800">Document Number Formats</p>
                <p className="text-xs text-gray-500 mt-0.5">
                  Configure UHID, OPD, IPD, payment slips, receipts, IPD final bills, and IPD ledger number templates.
                </p>
              </div>
              {formatsOpen ? (
                <ChevronDown className="text-gray-500 shrink-0" />
              ) : (
                <ChevronRight className="text-gray-500 shrink-0" />
              )}
            </button>

            {formatsOpen && (
              <div className="px-4 pb-4 space-y-4 border-t border-gray-100 bg-white">
                <div className="pt-4">
                  <label className="block text-xs font-bold text-gray-600 uppercase tracking-wide mb-1">Hospital Prefix</label>
                  <input
                    type="text"
                    value={form.uhid_prefix || ''}
                    onChange={(e) => onChange('uhid_prefix', e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8))}
                    className="w-full max-w-xs border border-gray-200 rounded-xl px-3 py-2.5 text-sm uppercase focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 outline-none"
                    placeholder="DEF"
                    maxLength={8}
                  />
                  <p className="text-xs text-gray-500 mt-1">Used when a slip type has “Use hospital prefix” enabled.</p>
                </div>

                <p className="text-xs text-gray-500">
                  Leave any box empty to skip that part in the final number. Sequence is always included.
                </p>

                <div className="space-y-3">
                  {DOCUMENT_NUMBER_FORMAT_ROWS.map((row) => {
                    const formatRow = normalizedFormats[row.key] || {}
                    const isReceipt = row.key === 'receipt'
                    const ownNext = row.hasOwnSequence
                      ? (Number(normalizedNextNumbers[row.key]) || 1)
                      : undefined
                    const preview = getDocumentNumberPreview(row.key, normalizedFormats, {
                      uhidPrefix: form.uhid_prefix || 'VAR',
                      invoicePrefix: form.invoice_prefix || 'INV',
                      seq: isReceipt
                        ? (Number(form.invoice_next_number) || 1)
                        : ownNext,
                    })

                    return (
                      <div key={row.key} className="rounded-xl border border-gray-100 p-3 bg-gray-50/60">
                        <div className="flex flex-wrap items-start justify-between gap-2 mb-3">
                          <p className="text-sm font-bold text-gray-800">{row.label}</p>
                          <span className="text-xs font-mono text-emerald-700 bg-emerald-50 px-2 py-1 rounded-lg border border-emerald-100">
                            Example: {preview || '—'}
                          </span>
                        </div>

                        {isReceipt ? (
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                            <div>
                              <label className="block text-xs font-bold text-gray-600 uppercase tracking-wide mb-1">Invoice Prefix</label>
                              <input
                                type="text"
                                value={form.invoice_prefix || ''}
                                onChange={(e) => onChange('invoice_prefix', e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 20))}
                                className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm uppercase focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 outline-none bg-white"
                                placeholder="INV"
                                maxLength={20}
                              />
                            </div>
                            <div>
                              <label className="block text-xs font-bold text-gray-600 uppercase tracking-wide mb-1">Next Invoice Number</label>
                              <input
                                type="number"
                                min="1"
                                value={form.invoice_next_number ?? 1}
                                onChange={(e) => onChange('invoice_next_number', Math.max(1, parseInt(e.target.value, 10) || 1))}
                                className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 outline-none bg-white"
                              />
                            </div>
                            <div>
                              <label className="block text-xs font-bold text-gray-600 uppercase tracking-wide mb-1">Separator</label>
                              <input
                                type="text"
                                value={formatRow.separator ?? ''}
                                onChange={(e) => onFormatPartFieldChange(row.key, 'separator', e.target.value.slice(0, 3))}
                                className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 outline-none bg-white"
                                placeholder="Leave empty for none"
                              />
                            </div>
                            <div>
                              <label className="block text-xs font-bold text-gray-600 uppercase tracking-wide mb-1">Sequence Digits</label>
                              <input
                                type="number"
                                min="0"
                                max="8"
                                value={formatRow.seq_padding ?? 0}
                                onChange={(e) => onFormatPartFieldChange(row.key, 'seq_padding', e.target.value)}
                                className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 outline-none bg-white"
                                placeholder="0 = no padding"
                              />
                            </div>
                          </div>
                        ) : (
                          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
                            <div>
                              <label className="block text-xs font-bold text-gray-600 uppercase tracking-wide mb-1">Kind</label>
                              <input
                                type="text"
                                value={formatRow.kind || ''}
                                onChange={(e) => onFormatPartFieldChange(row.key, 'kind', e.target.value)}
                                className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm uppercase focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 outline-none bg-white"
                                placeholder="Leave empty to skip"
                                maxLength={12}
                              />
                            </div>
                            <div>
                              <label className="block text-xs font-bold text-gray-600 uppercase tracking-wide mb-1">Prefix</label>
                              <input
                                type="text"
                                value={formatRow.prefix || ''}
                                onChange={(e) => onFormatPartFieldChange(row.key, 'prefix', e.target.value)}
                                className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm uppercase focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 outline-none bg-white"
                                placeholder="Leave empty to skip"
                                maxLength={20}
                              />
                            </div>
                            <div>
                              <label className="block text-xs font-bold text-gray-600 uppercase tracking-wide mb-1">Separator</label>
                              <input
                                type="text"
                                value={formatRow.separator ?? ''}
                                onChange={(e) => onFormatPartFieldChange(row.key, 'separator', e.target.value.slice(0, 3))}
                                className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 outline-none bg-white"
                                placeholder="- or empty"
                              />
                            </div>
                            <div>
                              <label className="block text-xs font-bold text-gray-600 uppercase tracking-wide mb-1">Sequence Digits</label>
                              <input
                                type="number"
                                min="0"
                                max="8"
                                value={formatRow.seq_padding ?? 0}
                                onChange={(e) => onFormatPartFieldChange(row.key, 'seq_padding', e.target.value)}
                                className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 outline-none bg-white"
                                placeholder="0 = no padding"
                              />
                            </div>
                            {row.hasOwnSequence && (
                              <div className="md:col-span-2 lg:col-span-4">
                                <label className="block text-xs font-bold text-gray-600 uppercase tracking-wide mb-1">Next Number</label>
                                <input
                                  type="number"
                                  min="1"
                                  value={ownNext ?? 1}
                                  onChange={(e) => onNextNumberChange(row.key, e.target.value)}
                                  className="w-full max-w-xs border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 outline-none bg-white"
                                />
                                <p className="text-xs text-gray-500 mt-1">Next sequence for the current year.</p>
                              </div>
                            )}
                          </div>
                        )}

                        {!isReceipt && (
                          <div className="mt-3 flex flex-wrap gap-4 text-xs text-gray-700">
                            {row.showHospitalPrefixToggle && (
                              <label className="inline-flex items-center gap-2 cursor-pointer">
                                <input
                                  type="checkbox"
                                  checked={formatRow.use_hospital_prefix === true}
                                  onChange={(e) => onFormatPartFieldChange(row.key, 'use_hospital_prefix', e.target.checked)}
                                  className="rounded border-gray-300 text-emerald-600 focus:ring-emerald-500"
                                />
                                <span>Use hospital prefix</span>
                              </label>
                            )}
                            <label className="inline-flex items-center gap-2 cursor-pointer">
                              <input
                                type="checkbox"
                                checked={formatRow.include_year === true}
                                onChange={(e) => onFormatPartFieldChange(row.key, 'include_year', e.target.checked)}
                                className="rounded border-gray-300 text-emerald-600 focus:ring-emerald-500"
                              />
                              <span>Include year</span>
                            </label>
                            {row.showSlug && (
                              <label className="inline-flex items-center gap-2 cursor-pointer">
                                <input
                                  type="checkbox"
                                  checked={formatRow.include_slug === true}
                                  onChange={(e) => onFormatPartFieldChange(row.key, 'include_slug', e.target.checked)}
                                  className="rounded border-gray-300 text-emerald-600 focus:ring-emerald-500"
                                />
                                <span>Include slug</span>
                              </label>
                            )}
                          </div>
                        )}

                        {isReceipt && (
                          <div className="mt-3 flex flex-wrap gap-4 text-xs text-gray-700">
                            <label className="inline-flex items-center gap-2 cursor-pointer">
                              <input
                                type="checkbox"
                                checked={formatRow.include_year === true}
                                onChange={(e) => onFormatPartFieldChange(row.key, 'include_year', e.target.checked)}
                                className="rounded border-gray-300 text-emerald-600 focus:ring-emerald-500"
                              />
                              <span>Include year</span>
                            </label>
                          </div>
                        )}

                        {formatErrors[row.key] && (
                          <p className="text-xs text-red-600 mt-2">{formatErrors[row.key]}</p>
                        )}
                      </div>
                    )
                  })}
                </div>

                <button
                  type="button"
                  onClick={resetDocumentNumberFormats}
                  className="px-3 py-2 rounded-lg bg-white border border-gray-200 text-gray-700 text-xs font-bold hover:bg-gray-50 transition-colors"
                >
                  Reset format defaults
                </button>
              </div>
            )}
          </div>

          <div>
            <label className="block text-xs font-bold text-gray-600 uppercase tracking-wide mb-1">Hospital Name</label>
            <input
              type="text"
              value={form.hospital_name || ''}
              onChange={(e) => onChange('hospital_name', e.target.value)}
              className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 outline-none"
              placeholder="Enter hospital name"
            />
          </div>
          <div>
            <label className="block text-xs font-bold text-gray-600 uppercase tracking-wide mb-1">Address</label>
            <input
              type="text"
              value={form.address || ''}
              onChange={(e) => onChange('address', e.target.value)}
              className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 outline-none"
              placeholder="Hospital address"
            />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-bold text-gray-600 uppercase tracking-wide mb-1">Pin Code</label>
              <input
                type="text"
                value={form.pin_code || ''}
                onChange={(e) => onChange('pin_code', e.target.value)}
                className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 outline-none"
                placeholder="Pin code"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-gray-600 uppercase tracking-wide mb-1">Phone</label>
              <input
                type="text"
                value={form.phone || ''}
                onChange={(e) => onChange('phone', e.target.value)}
                className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 outline-none"
                placeholder="+91-XXXXXXXXXX"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-gray-600 uppercase tracking-wide mb-1">Email</label>
              <input
                type="email"
                value={form.email || ''}
                onChange={(e) => onChange('email', e.target.value)}
                className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 outline-none"
                placeholder="info@hospital.com"
              />
            </div>
          </div>
          <div>
            <label className="block text-xs font-bold text-gray-600 uppercase tracking-wide mb-1">Website</label>
            <input
              type="text"
              value={form.website || ''}
              onChange={(e) => onChange('website', e.target.value)}
              className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 outline-none"
              placeholder="www.hospital.com"
            />
          </div>
          <div>
            <label className="block text-xs font-bold text-gray-600 uppercase tracking-wide mb-1">Hospital Logo</label>
            <div className="border border-dashed border-gray-300 rounded-xl p-3 bg-gray-50">
              {logoPreview ? (
                <img src={logoPreview} alt="Hospital logo preview" className="h-20 w-auto object-contain bg-white rounded-lg border border-gray-200 p-1 mb-2" />
              ) : (
                <div className="h-20 flex items-center justify-center text-xs text-gray-400 mb-2 bg-white rounded-lg border border-gray-200">
                  No logo selected
                </div>
              )}
              <div className="flex items-center gap-2">
                <input
                  type="file"
                  accept="image/*"
                  onChange={(e) => onLogoFileChange(e.target.files?.[0])}
                  className="block w-full text-xs text-gray-600 file:mr-3 file:py-2 file:px-3 file:rounded-lg file:border-0 file:bg-emerald-600 file:text-white file:font-bold file:cursor-pointer"
                />
                {logoPreview && (
                  <button
                    type="button"
                    onClick={onRemoveLogo}
                    className="px-3 py-2 rounded-lg bg-red-50 text-red-700 text-xs font-bold hover:bg-red-100 border border-red-100"
                  >
                    Remove
                  </button>
                )}
              </div>
            </div>
          </div>

          <div className="pt-2 flex gap-2">
            <button
              type="submit"
              className="px-4 py-2.5 rounded-xl bg-emerald-600 text-white text-sm font-extrabold hover:bg-emerald-700 transition-colors"
            >
              Save Settings
            </button>
            <button
              type="button"
              onClick={handleReset}
              className="px-4 py-2.5 rounded-xl bg-gray-100 text-gray-700 text-sm font-bold hover:bg-gray-200 transition-colors"
            >
              Reset Default
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

function OpdSettingsSection() {
  const [form, setForm] = useState(() => getReceptionOpdSettings())
  const [doctors, setDoctors] = useState([])
  // '' = All Doctors (default); a doctor user-id string = that doctor only
  const [selectedSlotDoctor, setSelectedSlotDoctor] = useState('')
  const normalizedSlots = useMemo(() => (
    Array.isArray(form.opd_fee_slots)
      ? form.opd_fee_slots.map((s) => ({
          start: String(s?.start || ''),
          end: String(s?.end || ''),
          amount: String(s?.amount ?? ''),
          days: Array.isArray(s?.days) ? s.days : null,
          doctor_user_id: s?.doctor_user_id != null ? String(s.doctor_user_id) : null,
        }))
      : []
  ), [form.opd_fee_slots])
  const ALL_DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
  const [timelineDraft, setTimelineDraft] = useState({ startMin: null, endMin: null, amount: '', days: ALL_DAYS, doctor_user_id: '', editIndex: null })

  useEffect(() => {
    let cancelled = false
    async function hydrate() {
      await loadReceptionPortalSettings()
      if (!cancelled) setForm(getReceptionOpdSettings())
    }
    hydrate()
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    let cancelled = false
    async function loadDoctors() {
      try {
        const { data } = await api.get('/doctor-profiles/?limit=500')
        if (cancelled) return
        const rows = Array.isArray(data?.data) ? data.data : (data?.results || data || [])
        setDoctors(rows)
      } catch {
        // keep dropdown empty on failure
      }
    }
    loadDoctors()
    return () => { cancelled = true }
  }, [])

  function onChange(key, value) {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  async function persistSlotRows(rows) {
    const sanitizedRows = (Array.isArray(rows) ? rows : [])
      .filter((s) => s && s.start && s.end)
      .map((s) => {
        const entry = {
          start: String(s.start).slice(0, 5),
          end: String(s.end).slice(0, 5),
          amount: Number(String(s.amount || '0').replace(/[^0-9.]/g, '') || 0),
          days: Array.isArray(s.days) && s.days.length > 0 ? s.days : ALL_DAYS,
        }
        if (s.doctor_user_id) entry.doctor_user_id = String(s.doctor_user_id)
        return entry
      })
    const next = {
      ...form,
      opd_fee_mode: 'slot',
      opd_fee_slots: sanitizedRows,
    }
    setForm((prev) => ({ ...prev, opd_fee_mode: 'slot', opd_fee_slots: sanitizedRows }))
    await saveReceptionOpdSettings(next)
    await loadReceptionPortalSettings()
    setForm(getReceptionOpdSettings())
  }

  function plusOneMinute(hhmm) {
    const m = String(hhmm || '').trim().match(/^(\d{1,2}):(\d{2})$/)
    if (!m) return ''
    const h = Number(m[1])
    const mm = Number(m[2])
    if (!Number.isFinite(h) || !Number.isFinite(mm) || h < 0 || h > 23 || mm < 0 || mm > 59) return ''
    const total = (h * 60 + mm + 1) % (24 * 60)
    const nh = String(Math.floor(total / 60)).padStart(2, '0')
    const nmm = String(total % 60).padStart(2, '0')
    return `${nh}:${nmm}`
  }

  function addFeeSlot() {
    setForm((prev) => {
      const rows = Array.isArray(prev.opd_fee_slots) ? [...prev.opd_fee_slots] : []
      const last = rows[rows.length - 1]
      const nextStart = plusOneMinute(last?.end)
      rows.push({ start: nextStart, end: '', amount: '' })
      return { ...prev, opd_fee_slots: rows }
    })
  }

  function updateFeeSlot(index, patch) {
    setForm((prev) => {
      const rows = Array.isArray(prev.opd_fee_slots) ? [...prev.opd_fee_slots] : []
      rows[index] = { ...(rows[index] || { start: '', end: '', amount: '' }), ...patch }
      return { ...prev, opd_fee_slots: rows }
    })
  }

  function removeFeeSlot(index) {
    setForm((prev) => {
      const rows = Array.isArray(prev.opd_fee_slots) ? [...prev.opd_fee_slots] : []
      rows.splice(index, 1)
      return { ...prev, opd_fee_slots: rows }
    })
  }

  const toMin = (hhmm) => {
    const m = String(hhmm || '').trim().match(/^(\d{1,2}):(\d{2})$/)
    if (!m) return null
    const h = Number(m[1]); const mm = Number(m[2])
    if (h < 0 || h > 23 || mm < 0 || mm > 59) return null
    return h * 60 + mm
  }
  const toHHMM = (mins) => {
    if (mins == null) return ''
    const m = ((Number(mins) % 1440) + 1440) % 1440
    const h = String(Math.floor(m / 60)).padStart(2, '0')
    const mm = String(m % 60).padStart(2, '0')
    return `${h}:${mm}`
  }
  const segments = useMemo(() => {
    const segs = []
    normalizedSlots.forEach((s, idx) => {
      const a = toMin(s.start)
      const b = toMin(s.end)
      if (a == null || b == null) return
      const amount = s.amount
      if (a <= b) segs.push({ idx, start: a, end: b, amount })
      else {
        segs.push({ idx, start: a, end: 1440, amount, overnight: true })
        segs.push({ idx, start: 0, end: b, amount, overnight: true })
      }
    })
    return segs
  }, [normalizedSlots])

  const draftSegments = useMemo(() => {
    const a = timelineDraft.startMin
    const b = timelineDraft.endMin
    if (a == null) return []
    if (b == null) return [{ start: a, end: a + 1 }]
    if (a <= b) return [{ start: a, end: b }]
    return [
      { start: a, end: 1440 },
      { start: 0, end: b },
    ]
  }, [timelineDraft.startMin, timelineDraft.endMin])

  const nowMarkerPct = useMemo(() => {
    // This is only for UI indicator; fee calculation remains backend-driven.
    const d = new Date()
    const mins = d.getHours() * 60 + d.getMinutes()
    return (mins / 1440) * 100
  }, [])

  async function handleSave(e) {
    e.preventDefault()
    try {
      const prepared = {
        ...form,
        opd_fee_mode: form.opd_fee_mode === 'slot' ? 'slot' : 'doctor',
        opd_fee_slots: normalizedSlots
          .filter((s) => s.start && s.end)
          .map((s) => {
            const entry = {
              start: s.start,
              end: s.end,
              amount: Number(String(s.amount || '0').replace(/[^0-9.]/g, '') || 0),
              days: Array.isArray(s.days) && s.days.length > 0 ? s.days : ALL_DAYS,
            }
            if (s.doctor_user_id) entry.doctor_user_id = String(s.doctor_user_id)
            return entry
          }),
      }
      await saveReceptionOpdSettings(prepared)
      await loadReceptionPortalSettings()
      setForm(getReceptionOpdSettings())
      toast.success('OPD settings saved')
    } catch (err) {
      const errors = err?.response?.data?.errors
      const detail = errors?.detail || errors?.default_doctor_user?.[0]
      toast.error(detail ? String(detail) : 'Failed to save OPD settings')
    }
  }

  async function handleReset() {
    const resetForm = {
      ...DEFAULT_RECEPTION_OPD_SETTINGS,
    }
    setForm(resetForm)
    try {
      await saveReceptionOpdSettings(resetForm)
      setForm(getReceptionOpdSettings())
      toast.success('OPD settings reset')
    } catch {
      toast.error('Failed to reset OPD settings')
    }
  }

  const withBg = form.print_with_background !== false

  return (
    <div className="max-w-3xl mx-auto">
      <div className="bg-white border border-gray-100 rounded-2xl shadow-sm p-5 md:p-6">
        <h2 className="text-lg font-black text-gray-800">OPD Settings</h2>
        <p className="text-sm text-gray-500 mt-1">
          Set default city and state for Token Queue registration form.
        </p>

        <form onSubmit={handleSave} className="mt-5 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-bold text-gray-600 uppercase tracking-wide mb-1">Default City</label>
              <input
                type="text"
                value={form.default_city || ''}
                onChange={(e) => onChange('default_city', e.target.value)}
                className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 outline-none"
                placeholder="City"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-gray-600 uppercase tracking-wide mb-1">Default State</label>
              <select
                value={form.default_state || ''}
                onChange={(e) => onChange('default_state', e.target.value)}
                className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 outline-none"
              >
                {form.default_state
                  && !INDIAN_STATE_OPTIONS.includes(form.default_state) ? (
                    <option value={form.default_state}>{form.default_state}</option>
                  ) : null}
                {INDIAN_STATE_OPTIONS.map((stateName) => (
                  <option key={stateName} value={stateName}>{stateName}</option>
                ))}
              </select>
            </div>
          </div>
          <div>
            <label className="block text-xs font-bold text-gray-600 uppercase tracking-wide mb-1">Default Doctor</label>
            <select
              value={form.default_doctor_user || ''}
              onChange={(e) => onChange('default_doctor_user', e.target.value)}
              className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 outline-none"
            >
              <option value="">Walk-in / Any</option>
              {doctors.filter((d) => d.user || d.user_id || d.doctor_user).map((d) => {
                const doctorUserId = String(d.user ?? d.user_id ?? d.doctor_user ?? '')
                return (
                  <option key={doctorUserId} value={doctorUserId}>
                    {d.name}
                  </option>
                )
              })}
            </select>
          </div>

          <div className="border border-gray-100 rounded-xl p-4 bg-gray-50/50 space-y-3">
            <div>
              <p className="text-sm font-bold text-gray-800">OPD Fee Mode</p>
              <p className="text-xs text-gray-500 mt-0.5">Choose one: doctor-wise consultation fee or slot-wise fee slabs.</p>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => {
                  onChange('opd_fee_mode', 'doctor')
                  saveReceptionOpdSettings({ ...form, opd_fee_mode: 'doctor' }).catch(() => {})
                }}
                className={`text-left rounded-lg border-2 p-3 transition-all ${
                  form.opd_fee_mode !== 'slot'
                    ? 'border-emerald-500 bg-emerald-50'
                    : 'border-gray-200 bg-white'
                }`}
              >
                <p className="text-sm font-bold text-gray-800">Doctor charges currently following</p>
                <p className="text-xs text-gray-500 mt-0.5">Uses the selected doctor's consultation fee.</p>
              </button>
              <button
                type="button"
                onClick={() => {
                  onChange('opd_fee_mode', 'slot')
                  saveReceptionOpdSettings({ ...form, opd_fee_mode: 'slot' }).catch(() => {})
                }}
                className={`text-left rounded-lg border-2 p-3 transition-all ${
                  form.opd_fee_mode === 'slot'
                    ? 'border-emerald-500 bg-emerald-50'
                    : 'border-gray-200 bg-white'
                }`}
              >
                <p className="text-sm font-bold text-gray-800">Slots wise</p>
                <p className="text-xs text-gray-500 mt-0.5">Set fee by time ranges, e.g. 08:00-14:00 = 200.</p>
              </button>
            </div>

            {form.opd_fee_mode === 'slot' && (
              <div className="space-y-2">
                <div className="rounded-xl border border-gray-200 bg-white p-3">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-xs font-extrabold text-gray-700 uppercase tracking-wider">24-hour OPD fee timeline</p>
                      <p className="text-[11px] text-gray-500 mt-0.5">Click once for start, again for end. Click an existing segment to edit.</p>
                    </div>
                    {form.current_opd_slot_fee != null && (
                      <div className="text-right">
                        <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Now</p>
                        <p className="text-sm font-extrabold text-emerald-700">₹{form.current_opd_slot_fee}</p>
                      </div>
                    )}
                  </div>

                  <div
                    className="mt-3 relative w-full h-12 rounded-xl bg-gradient-to-b from-gray-50 to-white border border-gray-200 overflow-hidden cursor-crosshair select-none"
                    onClick={(e) => {
                      const rect = e.currentTarget.getBoundingClientRect()
                      const x = Math.min(Math.max(0, e.clientX - rect.left), rect.width)
                      const raw = (x / rect.width) * 1440
                      const snapped = Math.round(raw / 5) * 5
                      if (timelineDraft.startMin == null || (timelineDraft.startMin != null && timelineDraft.endMin != null)) {
                        setTimelineDraft((d) => ({ startMin: snapped, endMin: null, amount: d.amount || '', editIndex: null }))
                      } else {
                        setTimelineDraft((d) => ({ ...d, endMin: snapped }))
                      }
                    }}
                    title="Click to pick start and end"
                  >
                    {/* Hour ticks */}
                    {[0, 6, 12, 18, 24].map((h) => (
                      <div
                        key={`tick-${h}`}
                        className="absolute top-0 bottom-0 w-px bg-gray-200"
                        style={{ left: `${(h / 24) * 100}%` }}
                      />
                    ))}
                    {/* Current time marker */}
                    <div className="absolute top-0 bottom-0 w-px bg-blue-500/70" style={{ left: `${nowMarkerPct}%` }} />

                    {segments.map((seg, i) => (
                      <div
                        key={`${seg.idx}-${i}`}
                        className={`absolute top-1 bottom-1 rounded-md ${
                          seg.idx % 3 === 0 ? 'bg-emerald-200/90 border border-emerald-300'
                            : seg.idx % 3 === 1 ? 'bg-sky-200/90 border border-sky-300'
                            : 'bg-violet-200/90 border border-violet-300'
                        }`}
                        style={{
                          left: `${(seg.start / 1440) * 100}%`,
                          width: `${((seg.end - seg.start) / 1440) * 100}%`,
                        }}
                        onClick={(e) => {
                          e.stopPropagation()
                          const slot = normalizedSlots[seg.idx]
                          setTimelineDraft({
                            startMin: toMin(slot.start),
                            endMin: toMin(slot.end),
                            amount: String(slot.amount || ''),
                            editIndex: seg.idx,
                          })
                        }}
                        title={`${toHHMM(seg.start)}–${toHHMM(seg.end)} ₹${seg.amount}`}
                      />
                    ))}
                    {draftSegments.map((seg, idx) => (
                      <div
                        key={`draft-${idx}`}
                        className="absolute top-1 bottom-1 rounded-md bg-blue-500/15 border border-blue-400/40"
                        style={{
                          left: `${(seg.start / 1440) * 100}%`,
                          width: `${((seg.end - seg.start) / 1440) * 100}%`,
                        }}
                      />
                    ))}
                  </div>

                  <div className="mt-1 flex items-center justify-between text-[10px] font-bold text-gray-400">
                    <span>00:00</span>
                    <span>06:00</span>
                    <span>12:00</span>
                    <span>18:00</span>
                    <span>24:00</span>
                  </div>

                  <div className="mt-2 grid grid-cols-12 gap-2 items-end">
                    <div className="col-span-4">
                      <label className="block text-[11px] font-bold text-gray-600 uppercase tracking-wide mb-1">From</label>
                      <input
                        type="time"
                        value={toHHMM(timelineDraft.startMin)}
                        onChange={(e) => setTimelineDraft((d) => ({ ...d, startMin: toMin(e.target.value) }))}
                        className="w-full border border-gray-200 rounded-lg px-2.5 py-2 text-sm focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 outline-none"
                      />
                    </div>
                    <div className="col-span-4">
                      <label className="block text-[11px] font-bold text-gray-600 uppercase tracking-wide mb-1">To</label>
                      <input
                        type="time"
                        value={toHHMM(timelineDraft.endMin)}
                        onChange={(e) => setTimelineDraft((d) => ({ ...d, endMin: toMin(e.target.value) }))}
                        className="w-full border border-gray-200 rounded-lg px-2.5 py-2 text-sm focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 outline-none"
                      />
                    </div>
                    <div className="col-span-3">
                      <label className="block text-[11px] font-bold text-gray-600 uppercase tracking-wide mb-1">Fee (Rs)</label>
                      <input
                        type="number"
                        min="0"
                        step="1"
                        value={timelineDraft.amount}
                        onChange={(e) => setTimelineDraft((d) => ({ ...d, amount: e.target.value }))}
                        className="w-full border border-gray-200 rounded-lg px-2.5 py-2 text-sm focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 outline-none"
                        placeholder="0"
                      />
                    </div>
                    <div className="col-span-1">
                      <button
                        type="button"
                        onClick={() => setTimelineDraft({ startMin: null, endMin: null, amount: '', days: ALL_DAYS, doctor_user_id: selectedSlotDoctor, editIndex: null })}
                        className="w-full h-9 rounded-lg bg-gray-100 text-gray-600 hover:bg-gray-200 text-sm font-bold"
                        title="Clear selection"
                      >
                        ↺
                      </button>
                    </div>
                  </div>

                  {/* Days selector */}
                  <div className="mt-2">
                    <label className="block text-[11px] font-bold text-gray-600 uppercase tracking-wide mb-1.5">Days</label>
                    <div className="flex flex-wrap items-center gap-1.5">
                      {/* All days toggle */}
                      <button
                        type="button"
                        onClick={() => {
                          const allSelected = ALL_DAYS.every(d => (timelineDraft.days || []).includes(d))
                          setTimelineDraft(prev => ({ ...prev, days: allSelected ? [] : [...ALL_DAYS] }))
                        }}
                        className={`px-2.5 py-1 rounded-lg text-xs font-extrabold border transition-all ${
                          ALL_DAYS.every(d => (timelineDraft.days || []).includes(d))
                            ? 'bg-emerald-600 text-white border-emerald-600'
                            : 'bg-white text-gray-600 border-gray-200 hover:border-emerald-400 hover:text-emerald-700'
                        }`}
                      >
                        All
                      </button>
                      {ALL_DAYS.map(day => {
                        const selected = (timelineDraft.days || []).includes(day)
                        return (
                          <button
                            key={day}
                            type="button"
                            onClick={() => {
                              setTimelineDraft(prev => {
                                const cur = prev.days || []
                                return {
                                  ...prev,
                                  days: selected ? cur.filter(d => d !== day) : [...cur, day],
                                }
                              })
                            }}
                            className={`px-2.5 py-1 rounded-lg text-xs font-extrabold border transition-all ${
                              selected
                                ? 'bg-blue-600 text-white border-blue-600'
                                : 'bg-white text-gray-600 border-gray-200 hover:border-blue-400 hover:text-blue-700'
                            }`}
                          >
                            {day}
                          </button>
                        )
                      })}
                    </div>
                  </div>

                  {/* Applies-to-Doctor picker */}
                  <div className="mt-2">
                    <label className="block text-[11px] font-bold text-gray-600 uppercase tracking-wide mb-1.5">Applies to Doctor</label>
                    <select
                      value={timelineDraft.doctor_user_id || ''}
                      onChange={e => setTimelineDraft(d => ({ ...d, doctor_user_id: e.target.value }))}
                      className="w-full border border-gray-200 rounded-lg px-2.5 py-2 text-sm focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 outline-none"
                    >
                      <option value="">Default (All Doctors)</option>
                      {doctors.filter(d => d.user || d.id).map(d => (
                        <option key={d.user || d.id} value={String(d.user || d.id)}>{d.name}</option>
                      ))}
                    </select>
                  </div>

                  <div className="mt-2 flex items-center justify-between gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        if (timelineDraft.startMin == null || timelineDraft.endMin == null) return
                        const rows = (() => {
                          const prev = form
                          const rows = Array.isArray(prev.opd_fee_slots) ? [...prev.opd_fee_slots] : []
                          const row = { start: toHHMM(timelineDraft.startMin), end: toHHMM(timelineDraft.endMin), amount: timelineDraft.amount || '0', days: timelineDraft.days && timelineDraft.days.length > 0 ? timelineDraft.days : ALL_DAYS, ...(timelineDraft.doctor_user_id ? { doctor_user_id: timelineDraft.doctor_user_id } : {}) }
                          if (timelineDraft.editIndex != null && rows[timelineDraft.editIndex]) {
                            rows[timelineDraft.editIndex] = row
                          } else {
                            rows.push(row)
                          }
                          return rows
                        })()
                        persistSlotRows(rows)
                          .then(() => {
                            toast.success('Slots saved')
                            setTimelineDraft({ startMin: null, endMin: null, amount: '', days: ALL_DAYS, doctor_user_id: selectedSlotDoctor, editIndex: null })
                          })
                          .catch(() => toast.error('Failed to save slots'))
                      }}
                      className={`inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-white text-sm font-extrabold disabled:opacity-40 ${
                        timelineDraft.editIndex != null ? 'bg-blue-600 hover:bg-blue-700' : 'bg-emerald-600 hover:bg-emerald-700'
                      }`}
                      disabled={timelineDraft.startMin == null || timelineDraft.endMin == null}
                    >
                      {timelineDraft.editIndex != null ? 'Save changes' : '+ Add slot'}
                    </button>
                    <div className="flex items-center gap-2 text-xs text-gray-500">
                      <span className="inline-flex items-center gap-1"><span className="w-3 h-3 rounded bg-emerald-200 border border-emerald-300" /> Slots</span>
                      <span className="inline-flex items-center gap-1"><span className="w-3 h-3 rounded bg-blue-500/15 border border-blue-400/40" /> Draft</span>
                    </div>
                  </div>
                </div>

                {/* Doctor filter + slot list */}
                <div className="mt-1 space-y-2">
                  {/* Filter dropdown */}
                  <div className="flex items-center gap-2">
                    <label className="text-[11px] font-bold text-gray-500 uppercase tracking-wide shrink-0">Show slots for</label>
                    <select
                      value={selectedSlotDoctor}
                      onChange={e => {
                        setSelectedSlotDoctor(e.target.value)
                        setTimelineDraft({ startMin: null, endMin: null, amount: '', days: ALL_DAYS, doctor_user_id: e.target.value, editIndex: null })
                      }}
                      className="flex-1 border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 outline-none"
                    >
                      <option value="">Default (All Doctors)</option>
                      {doctors.filter(d => d.user || d.id).map(d => (
                        <option key={d.user || d.id} value={String(d.user || d.id)}>{d.name}</option>
                      ))}
                    </select>
                  </div>

                  {/* Filtered slot rows:
                      - "All Doctors" tab  → show only slots with no doctor_user_id
                      - specific doctor tab → show that doctor's slots + "All Doctors" slots (inherited),
                        BUT hide an "All Doctors" slot if the doctor already has a slot with the same start+end */}
                  {(() => {
                    // Pre-compute the set of start+end pairs that the selected doctor already owns
                    const doctorOwnedTimes = new Set(
                      selectedSlotDoctor
                        ? normalizedSlots
                            .filter(s => (s.doctor_user_id || '') === selectedSlotDoctor)
                            .map(s => `${s.start}|${s.end}`)
                        : []
                    )
                    return normalizedSlots.filter(slot => {
                      const slotDoc = slot.doctor_user_id || ''
                      if (!selectedSlotDoctor) return slotDoc === ''
                      if (slotDoc === selectedSlotDoctor) return true
                      // "All Doctors" slot — only show if doctor has no override for the same time
                      if (slotDoc === '') return !doctorOwnedTimes.has(`${slot.start}|${slot.end}`)
                      return false
                    })
                  })().length > 0 ? (
                    <div className="space-y-1">
                      {(() => {
                        const doctorOwnedTimes = new Set(
                          selectedSlotDoctor
                            ? normalizedSlots
                                .filter(s => (s.doctor_user_id || '') === selectedSlotDoctor)
                                .map(s => `${s.start}|${s.end}`)
                            : []
                        )
                        return normalizedSlots.map((slot, idx) => {
                        const slotDoc = slot.doctor_user_id || ''
                        const isAllDoctors = slotDoc === ''
                        if (!selectedSlotDoctor && !isAllDoctors) return null
                        if (selectedSlotDoctor && slotDoc !== selectedSlotDoctor && !isAllDoctors) return null
                        // Hide inherited "All Doctors" slot if doctor has an override for same time
                        if (isAllDoctors && selectedSlotDoctor && doctorOwnedTimes.has(`${slot.start}|${slot.end}`)) return null
                        const docName = slot.doctor_user_id
                          ? (doctors.find(d => String(d.user || d.id) === String(slot.doctor_user_id))?.name || `Doctor #${slot.doctor_user_id}`)
                          : null
                        return (
                          <div key={`slot-row-${idx}`} className={`flex items-center justify-between gap-2 rounded-lg px-3 py-2 border ${isAllDoctors && selectedSlotDoctor ? 'bg-gray-50 border-gray-200' : 'bg-white border-gray-200'}`}>
                            <div className="text-sm font-bold text-gray-800 space-y-0.5">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span>{slot.start || '—'} – {slot.end || '—'} <span className="text-gray-400 font-black">·</span> ₹{slot.amount || '0'}</span>
                                {docName ? (
                                  <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-violet-50 text-violet-700 border border-violet-100">{docName}</span>
                                ) : selectedSlotDoctor ? (
                                  <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-gray-100 text-gray-500 border border-gray-200">All Doctors</span>
                                ) : null}
                              </div>
                              <div className="flex flex-wrap gap-1">
                                {(Array.isArray(slot.days) && slot.days.length > 0
                                  ? (slot.days.length === 7 ? ['All days'] : slot.days)
                                  : ['All days']
                                ).map(d => (
                                  <span key={d} className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 border border-blue-100">{d}</span>
                                ))}
                              </div>
                            </div>
                            <div className="flex items-center gap-2 shrink-0">
                              <button
                                type="button"
                                onClick={() => setTimelineDraft({ startMin: toMin(slot.start), endMin: toMin(slot.end), amount: String(slot.amount || ''), days: Array.isArray(slot.days) && slot.days.length > 0 ? slot.days : ALL_DAYS, doctor_user_id: slot.doctor_user_id || '', editIndex: idx })}
                                className="px-2 py-1 rounded-md bg-gray-100 text-gray-700 hover:bg-gray-200 text-xs font-extrabold"
                              >
                                Edit
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  const rows = Array.isArray(form.opd_fee_slots) ? [...form.opd_fee_slots] : []
                                  rows.splice(idx, 1)
                                  persistSlotRows(rows)
                                    .then(() => toast.success('Slot removed'))
                                    .catch(() => toast.error('Failed to remove slot'))
                                }}
                                className="px-2 py-1 rounded-md bg-gray-100 text-gray-700 hover:bg-red-100 hover:text-red-700 text-xs font-extrabold"
                              >
                                Remove
                              </button>
                            </div>
                          </div>
                        )
                      })
                    })()} 
                    </div>
                  ) : (
                    <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                      No slots for {selectedSlotDoctor
                        ? `${doctors.find(d => String(d.user || d.id) === selectedSlotDoctor)?.name || 'this doctor'} or All Doctors`
                        : 'All Doctors'
                      }. Add one above.
                    </p>
                  )}
                </div>
                {normalizedSlots.length === 0 && (
                  <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                    No slots added yet. Add one or more time ranges to apply slot-wise OPD fee.
                  </p>
                )}
              </div>
            )}
          </div>

          {/* ── OPD Slip Print Background Toggle ── */}
          <div className="border border-gray-100 rounded-xl p-4 bg-gray-50/50">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-bold text-gray-800">OPD Slip Background Image</p>
                <p className="text-xs text-gray-500 mt-0.5">When enabled, the A4 OPD slip prints with the template background image. Disable to print on plain paper.</p>
              </div>
              <button
                type="button"
                onClick={() => onChange('print_with_background', !withBg)}
                className={`relative w-14 h-7 rounded-full transition-colors duration-200 focus:outline-none shrink-0 ${
                  withBg ? 'bg-emerald-500' : 'bg-gray-300'
                }`}
              >
                <span className={`absolute top-0.5 left-0.5 w-6 h-6 bg-white rounded-full shadow-md transition-transform duration-200 ${
                  withBg ? 'translate-x-7' : 'translate-x-0'
                }`} />
              </button>
            </div>
            <div className="mt-3 flex gap-2">
              <div className={`flex-1 rounded-lg border-2 p-3 text-center cursor-pointer transition-all ${
                withBg ? 'border-emerald-500 bg-emerald-50' : 'border-gray-200 bg-white opacity-50'
              }`} onClick={() => onChange('print_with_background', true)}>
                <div className="text-2xl mb-1">🖼️</div>
                <p className="text-xs font-bold text-gray-700">With Background</p>
                <p className="text-[10px] text-gray-400">Prints template image</p>
              </div>
              <div className={`flex-1 rounded-lg border-2 p-3 text-center cursor-pointer transition-all ${
                !withBg ? 'border-blue-500 bg-blue-50' : 'border-gray-200 bg-white opacity-50'
              }`} onClick={() => onChange('print_with_background', false)}>
                <div className="text-2xl mb-1">📄</div>
                <p className="text-xs font-bold text-gray-700">Plain Paper</p>
                <p className="text-[10px] text-gray-400">No background image</p>
              </div>
            </div>
          </div>

          <div className="pt-2 flex gap-2">
            <button
              type="submit"
              className="px-4 py-2.5 rounded-xl bg-emerald-600 text-white text-sm font-extrabold hover:bg-emerald-700 transition-colors"
            >
              Save Settings
            </button>
            <button
              type="button"
              onClick={handleReset}
              className="px-4 py-2.5 rounded-xl bg-gray-100 text-gray-700 text-sm font-bold hover:bg-gray-200 transition-colors"
            >
              Reset Default
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

function ReceptionSettingsSection({
  rooms,
  setRooms,
  tvGroups,
  setTvGroups,
  ipdProcessRef,
  ipdProcessDirty,
  onIpdProcessDirtyChange,
  tab,
  onTabChange,
}) {
  const tabs = [
    { id: 'opd', label: 'OPD Settings', icon: Users },
    { id: 'opd_template', label: 'OPD Template', icon: Printer },
    { id: 'ipd_process', label: 'IPD Process', icon: Activity },
    { id: 'tv', label: 'TV Screens', icon: Monitor },
    { id: 'payment_slip', label: 'Hospital Settings', icon: Receipt },
  ]
  const setTab = onTabChange
  const [opdTemplateSettingsRevision, setOpdTemplateSettingsRevision] = useState(0)
  const [ipdProcessTemplates, setIpdProcessTemplates] = useState(() => getIpdProcessTemplates())
  const [pendingTab, setPendingTab] = useState(null)
  const [dialogSaving, setDialogSaving] = useState(false)

  useEffect(() => {
    if (tab === 'ipd_process') {
      setIpdProcessTemplates(getIpdProcessTemplates())
    }
  }, [tab])

  function requestTab(next) {
    if (tab === 'ipd_process' && next !== 'ipd_process' && ipdProcessDirty) {
      setPendingTab(next)
      return
    }
    setTab(next)
  }

  return (
    <>
      <DiscardChangesConfirmModal
        open={pendingTab != null}
        saving={dialogSaving}
        onCancel={() => setPendingTab(null)}
        onDiscard={() => {
          ipdProcessRef.current?.discardChanges()
          const next = pendingTab
          setPendingTab(null)
          if (next) setTab(next)
        }}
        onSave={async () => {
          setDialogSaving(true)
          const ok = await ipdProcessRef.current?.save()
          setDialogSaving(false)
          if (ok) {
            const next = pendingTab
            setPendingTab(null)
            if (next) setTab(next)
          }
        }}
      />
      <div className="flex flex-col gap-4 min-h-0 flex-1 overflow-auto">
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-2 flex items-center gap-2 overflow-x-auto shrink-0">
          {tabs.map((t) => {
            const Icon = t.icon
            const active = tab === t.id
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => requestTab(t.id)}
                className={`shrink-0 flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-bold transition-all ${
                  active
                    ? 'bg-emerald-600 text-white shadow-sm'
                    : 'text-gray-600 hover:bg-gray-50 hover:text-gray-800'
                }`}
              >
                <Icon size={15} />
                {t.label}
              </button>
            )
          })}
        </div>

        <div className="flex-1 min-h-0 overflow-auto">
          {tab === 'opd' && (
            <OpdSettingsSection />
          )}
          {tab === 'opd_template' && (
            <div className="h-full min-h-[72vh] bg-white rounded-2xl border border-gray-100 shadow-sm p-3 overflow-auto">
              <OpdGeneratorTab
                settingsRevision={opdTemplateSettingsRevision}
                onOpdFieldConfigSaved={() => setOpdTemplateSettingsRevision((v) => v + 1)}
              />
            </div>
          )}
          {tab === 'ipd_process' && (
            <IpdProcessSettingsSection
              ref={ipdProcessRef}
              initialTemplates={ipdProcessTemplates}
              onDirtyChange={onIpdProcessDirtyChange}
              onSave={async (templatesRoot) => {
                const saved = await saveIpdProcessFieldConfig(templatesRoot)
                setIpdProcessTemplates(saved)
              }}
            />
          )}
          {tab === 'tv' && (
            <TVScreensSection rooms={rooms} setRooms={setRooms} tvGroups={tvGroups} setTvGroups={setTvGroups} />
          )}
          {tab === 'payment_slip' && <PaymentSlipSettingsSection />}
        </div>
      </div>
    </>
  )
}

// ─── A4 Payment Slip (Advance / Service) ─────────────────────────────────────
function PrintMiniReceipt({ admission, data, type, onClose, viewOnly = false }) {
  const isMobile = useIsMobile()
  const slipProfile = getPaymentSlipProfile()
  const logoUrl = resolvePaymentSlipLogoUrl(slipProfile)
  const hospitalName = (slipProfile.hospital_name || DEFAULT_PAYMENT_SLIP_PROFILE.hospital_name).toUpperCase()
  const address = slipProfile.address || DEFAULT_PAYMENT_SLIP_PROFILE.address
  const phone = slipProfile.phone || DEFAULT_PAYMENT_SLIP_PROFILE.phone

  const receiptLine = buildPaymentSlipReceiptLine(data)
  const label =
    type === 'refund'
      ? 'REFUND RECEIPT'
      : type === 'advance'
        ? 'ADVANCE PAYMENT RECEIPT'
        : type === 'charge' && receiptLine.line_total < 0
          ? 'DISCOUNT RECEIPT'
          : type === 'charge'
            ? 'CHARGE RECEIPT'
            : 'IPD PAYMENT RECEIPT'

  function triggerPrint() {
    if (isMobile) {
      const root = document.getElementById('__receipt_root')
      const slipEl = root?.querySelector('[style*="210mm"]')
      const styleText = root?.querySelector('style')?.textContent || ''
      const linkedStyles = Array.from(document.querySelectorAll('link[rel="stylesheet"]'))
        .map((link) => `<link rel="stylesheet" href="${link.href}" />`)
        .join('')
      if (slipEl) {
        const html = `<!DOCTYPE html><html><head><meta charset="utf-8"/>${linkedStyles}<style>${styleText}</style></head><body>${(root || slipEl).outerHTML}</body></html>`
        printHtmlInHiddenIframe(html)
        return
      }
    }
    const runPrint = () => triggerHMSPrint()
    if (!logoUrl) {
      runPrint()
      return
    }
    const img = document.querySelector('#__receipt_root .hosp-logo-print')
    if (!img || img.complete) {
      runPrint()
      return
    }
    img.onload = runPrint
    img.onerror = runPrint
  }

  useEffect(() => {
    if (viewOnly) return undefined
    let cancelled = false
    const runPrint = () => {
      if (!cancelled) triggerPrint()
    }
    const timer = setTimeout(runPrint, 800)
    function after() { schedulePrintCleanup(onClose) }
    window.addEventListener('afterprint', after)
    return () => { cancelled = true; clearTimeout(timer); window.removeEventListener('afterprint', after) }
  }, [viewOnly, onClose, logoUrl])

  const receiptStamp = formatReceiptDateTime(data.paid_at || new Date())

  const isCredit = data.mode === 'credit'
  const isRefund = type === 'refund'
  const totalLabel = isRefund ? 'TOTAL REFUNDED' : isCredit ? 'TOTAL DUE' : 'TOTAL PAID'
  const totalColor = isRefund ? '#2563eb' : isCredit ? '#b45309' : '#16a34a'
  const totalBg = isRefund ? '#eff6ff' : isCredit ? '#fffbeb' : '#f0fdf4'

  const content = (
    <div id="__receipt_root" className="fixed inset-0 z-[600] bg-white overflow-y-auto print:static print:h-auto print:overflow-visible print:bg-transparent">
      <div className="flex flex-nowrap justify-end items-center gap-2 p-4 print:hidden">
        {viewOnly && (
          <button
            type="button"
            onClick={triggerPrint}
            className="shrink-0 bg-emerald-600 hover:bg-emerald-700 text-white px-5 py-2 rounded-xl font-bold text-sm transition-colors inline-flex items-center gap-1.5"
          >
            <Printer sx={{ fontSize: 18 }} /> Print
          </button>
        )}
        <button type="button" onClick={onClose} className="shrink-0 bg-gray-100 hover:bg-gray-200 text-gray-700 px-5 py-2 rounded-xl font-bold text-sm transition-colors">✕ Close</button>
      </div>

      <div className="shadow-2xl print:shadow-none" style={{ width: '210mm', minHeight: '148.5mm', margin: '0 auto', background: '#fff', color: '#111', fontFamily: 'Arial, sans-serif', padding: '10mm 12mm', boxSizing: 'border-box', display: 'flex', flexDirection: 'column', borderBottom: '2px dashed #aaa' }}>
        
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', borderBottom: '2px solid #111', paddingBottom: '3mm', marginBottom: '4mm' }}>
           <div style={{ display: 'flex', alignItems: 'center', gap: '3mm', minWidth: 0 }}>
             {logoUrl ? (
               <img
                 src={logoUrl}
                 alt=""
                 className="hosp-logo-print"
                 style={{ height: '14mm', maxWidth: '28mm', objectFit: 'contain', flexShrink: 0 }}
               />
             ) : null}
             <div style={{ minWidth: 0 }}>
               <p style={{ fontSize: 24, fontWeight: 900, color: '#1a6b3f', margin: 0 }}>{hospitalName}</p>
               <p style={{ fontSize: 9, color: '#555', letterSpacing: 1, textTransform: 'uppercase', fontWeight: 700 }}>Inpatient Services Receipt</p>
             </div>
           </div>
           <div style={{ textAlign: 'right', fontSize: 10, color: '#333' }}>
             <p><strong>{address}</strong></p>
             <p>Contact: {phone}</p>
             <p style={{ marginTop: 2, fontWeight: 700 }}>{receiptStamp}</p>
           </div>
        </div>

        <p
          style={{
            textAlign: 'center',
            fontSize: 13,
            fontWeight: 700,
            textTransform: 'uppercase',
            letterSpacing: 2,
            color: isRefund ? '#1d4ed8' : '#111',
            borderBottom: '1px solid #111',
            paddingBottom: '2mm',
            marginBottom: '4mm',
          }}
        >
          {label}
        </p>

        {/* Info Grid */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '2mm 5mm', marginBottom: '4mm', fontSize: '11px' }}>
          {[
            ['Patient Name', (admission.patient_name || '—').toUpperCase()],
            ['Doctor', (admission.assigned_doctor_name || '').trim()
              ? `Dr. ${(admission.assigned_doctor_name || '').trim()}`
              : '—'],
            ['UHID', admission.patient_uhid || '—'],
            ['IPD ID', admission.ipd_no || '—'],
            ['Ward / Room', formatWardRoomReceiptLabel(admission.ward_name, admission.room_name)],
            ['Bed Code', admission.bed_code || '—'],
            ['Adm. Date', admission.admission_date ? format(new Date(admission.admission_date), 'dd/MM/yyyy') : '—'],
            ['Payment Mode', (data.mode || '—').toUpperCase()],
            ['Payment Ref', data.invoice_no || data.slip_number || '—'],
          ].map(([l, v]) => (
            <div key={l}>
              <p style={{ color: '#666', fontSize: '9px', marginBottom: 1 }}>{l}</p>
              <p style={{ fontWeight: 700 }}>{v}</p>
            </div>
          ))}
        </div>

        {/* Table */}
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '11px' }}>
          <thead>
            <tr style={{ background: '#1a6b3f', color: '#fff' }}>
              <th style={{ padding: '6px 10px', textAlign: 'left', textTransform: 'uppercase' }}>Description</th>
              <th style={{ padding: '6px 10px', textAlign: 'center', textTransform: 'uppercase', width: '12%' }}>Qty</th>
              <th style={{ padding: '6px 10px', textAlign: 'right', textTransform: 'uppercase', width: '18%' }}>Rate (₹)</th>
              <th style={{ padding: '6px 10px', textAlign: 'right', textTransform: 'uppercase', width: '20%' }}>Amount (₹)</th>
            </tr>
          </thead>
          <tbody>
            <tr style={{ borderBottom: '1.5px solid #111' }}>
              <td style={{ padding: '10px' }}>{receiptLine.description}</td>
              <td style={{ padding: '10px', textAlign: 'center', fontWeight: 700 }}>{receiptLine.quantity}</td>
              <td style={{ padding: '10px', textAlign: 'right', fontWeight: 700 }}>{receiptLine.unit_price.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
              <td style={{ padding: '10px', textAlign: 'right', fontWeight: 700 }}>{receiptLine.line_total.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
            </tr>
          </tbody>
          <tfoot>
            <tr style={{ background: totalBg }}>
              <td colSpan={3} style={{ padding: '8px 10px', fontWeight: 800 }}>{totalLabel}</td>
              <td style={{ padding: '8px 10px', textAlign: 'right', fontWeight: 900, fontSize: 14, color: totalColor }}>₹ {receiptLine.line_total.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
            </tr>
          </tfoot>
        </table>

        {/* Signatures */}
        <div style={{ marginTop: 'auto', display: 'flex', justifyContent: 'space-between', paddingTop: '5mm' }}>
           <div style={{ textAlign: 'center', width: '35%' }}>
             <div style={{ borderTop: '1px solid #111', paddingTop: 4, fontSize: 10, fontWeight: 700 }}>Patient / Guardian</div>
           </div>
           <div style={{ textAlign: 'center', width: '35%' }}>
             <div style={{ borderTop: '1px solid #111', paddingTop: 4, fontSize: 10, fontWeight: 700 }}>Authorized Signatory</div>
           </div>
        </div>
      </div>
      
      <style>{`
        @media print {
          @page { size: A4 portrait; margin: 0; }
          body, html { background: #fff !important; height: auto !important; overflow: visible !important; }
          body > *:not(#__receipt_root) { display: none !important; }
          #__receipt_root { 
            position: static !important; display: block !important; overflow: visible !important; 
            height: auto !important; padding: 0 !important; margin: 0 !important;
          }
          .print\\:hidden { display: none !important; }
        }
      `}</style>
    </div>
  )
  return createPortal(content, document.body)
}

function isIpdLedgerGroupedRowCancelled(row) {
  if (!row) return false
  const events = row.events || []
  if (events.length) {
    return events.every((e) => String(e?.invoice_status || '').toLowerCase() === 'cancelled')
  }
  return String(row.description || '').includes('(Cancelled)')
}

function buildIpdBillLineItems(ledger) {
  if (!ledger) return []
  const items = []

  for (const row of ledger.grouped_charges || []) {
    if (isIpdLedgerGroupedRowCancelled(row)) continue
    const rowTotal = parseFloat(row.total_amount || 0)
    if (!Number.isFinite(rowTotal) || rowTotal <= 0) continue

    const events = Array.isArray(row.events) ? row.events : []
    const positiveEvents = events.filter(
      (ev) =>
        parseFloat(ev?.price || 0) > 0
        && String(ev?.invoice_status || '').toLowerCase() !== 'cancelled',
    )
    if (positiveEvents.length) {
      for (const ev of positiveEvents) {
        const totalAmount = parseFloat(ev.price || 0)
        if (!Number.isFinite(totalAmount) || totalAmount <= 0) continue
        const quantity = parseFloat(ev.quantity || 0)
        const resolvedQty = Number.isFinite(quantity) && quantity > 0 ? quantity : 1
        const fromEventUnit = parseFloat(ev.unit_price)
        const unitPrice = Number.isFinite(fromEventUnit) && fromEventUnit > 0
          ? fromEventUnit
          : (resolvedQty > 0 ? totalAmount / resolvedQty : totalAmount)
        items.push({
          description: String(ev.name || row.description || 'Service').trim() || 'Service',
          quantity: resolvedQty,
          unit_price: unitPrice,
          total_amount: totalAmount,
        })
      }
      continue
    }

    const quantity = parseFloat(row.quantity || 0)
    const resolvedQty = Number.isFinite(quantity) && quantity > 0 ? quantity : 1
    const unitPrice = resolvedQty > 0 ? rowTotal / resolvedQty : rowTotal
    items.push({
      description: String(row.description || 'Service').trim() || 'Service',
      quantity: resolvedQty,
      unit_price: unitPrice,
      total_amount: rowTotal,
    })
  }

  for (const charge of ledger.charges || []) {
    if (charge.type === 'room_rent') {
      if (String(charge.invoice_status || '').toLowerCase() === 'cancelled') continue
      const totalAmount = parseFloat(charge.amount || 0)
      if (!Number.isFinite(totalAmount) || totalAmount <= 0) continue
      const quantity = parseFloat(charge.quantity || 0)
      const resolvedQty = Number.isFinite(quantity) && quantity > 0 ? quantity : 1
      const fromApiUnit = parseFloat(charge.unit_price)
      const unitPrice = Number.isFinite(fromApiUnit) && fromApiUnit > 0
        ? fromApiUnit
        : (resolvedQty > 0 ? totalAmount / resolvedQty : totalAmount)
      items.push({
        description: String(charge.description || 'Room Rent').trim() || 'Room Rent',
        quantity: resolvedQty,
        unit_price: unitPrice,
        total_amount: totalAmount,
      })
    }
  }

  return items.sort((a, b) => a.description.localeCompare(b.description))
}

function buildIpdBillDiscountLines(ledger) {
  if (!ledger) return []
  const lines = []
  const seenEventIds = new Set()

  for (const row of ledger.grouped_charges || []) {
    if (isIpdLedgerGroupedRowCancelled(row)) continue
    const rowTotal = parseFloat(row.total_amount || 0)

    const events = Array.isArray(row.events) ? row.events : []
    const negativeEvents = events.filter((ev) => parseFloat(ev?.price || 0) < 0)
    if (negativeEvents.length) {
      for (const ev of negativeEvents) {
        const amount = Math.abs(parseFloat(ev.price || 0))
        if (!amount) continue
        if (ev.id) seenEventIds.add(String(ev.id))
        lines.push({
          description: String(ev.name || row.description || 'Discount').trim() || 'Discount',
          amount,
          date: ev.date || null,
        })
      }
      continue
    }

    if (!Number.isFinite(rowTotal) || rowTotal >= 0) continue

    lines.push({
      description: String(row.description || 'Discount').trim() || 'Discount',
      amount: Math.abs(rowTotal),
      date: null,
    })
  }

  for (const charge of ledger.charges || []) {
    if (charge.type !== 'charge') continue
    if (String(charge.invoice_status || '').toLowerCase() === 'cancelled') continue
    const chargeId = String(charge.id || charge.invoice_id || '').trim()
    if (chargeId && seenEventIds.has(chargeId)) continue
    const amount = parseFloat(charge.amount || 0)
    if (!Number.isFinite(amount) || amount >= 0) continue
    lines.push({
      description: String(charge.description || 'Discount').trim() || 'Discount',
      amount: Math.abs(amount),
      date: charge.date || null,
    })
  }

  return lines.sort((a, b) => {
    const da = a.date ? new Date(a.date).getTime() : 0
    const db = b.date ? new Date(b.date).getTime() : 0
    return da - db
  })
}

function parseAdmissionMoney(value) {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

function isAllowedMoneyInput(value) {
  return value === '' || /^\d*\.?\d{0,2}$/.test(String(value))
}

function parseMoneyInput(value) {
  const normalized = String(value ?? '').trim().replace(/,/g, '')
  if (!normalized) return NaN
  const amount = Number(normalized)
  return Number.isFinite(amount) ? amount : NaN
}

function resolveAdmissionApiRow(data) {
  return data?.data ?? data?.entity ?? data ?? {}
}

function normalizeDischargeBillingSummary(summaryRow, ledgerRow) {
  const totalBilled = parseAdmissionMoney(ledgerRow.total_charges ?? summaryRow.total_billed)
  const totalPaid = parseAdmissionMoney(ledgerRow.total_paid ?? summaryRow.total_paid)
  const roomTotal = parseAdmissionMoney(summaryRow.room_total ?? ledgerRow.room_rent)
  const hasSignedBalance =
    ledgerRow.balance_due != null && String(ledgerRow.balance_due).trim() !== ''
  const netBalance = hasSignedBalance
    ? parseAdmissionMoney(ledgerRow.balance_due)
    : (totalBilled - totalPaid)
  const amountDue = Math.max(0, netBalance)
  const refundDue = Math.max(0, -netBalance)
  const outstanding = amountDue
  return {
    ...summaryRow,
    total_billed: totalBilled,
    total_paid: totalPaid,
    outstanding,
    net_balance: netBalance,
    amount_due: amountDue,
    refund_due: refundDue,
    room_total: roomTotal,
    total_services: parseAdmissionMoney(
      summaryRow.total_services ?? Math.max(0, totalBilled - roomTotal),
    ),
  }
}

function mapDischargeSettlementMode(mode) {
  const normalized = String(mode || 'cash').toLowerCase()
  if (normalized === 'cash' || normalized === 'upi' || normalized === 'other') return normalized
  return 'other'
}

function mapIpdChargePaymentMode(mode) {
  const normalized = String(mode || 'cash').toLowerCase()
  if (normalized === 'credit') return 'credit'
  if (normalized === 'cash' || normalized === 'upi') return normalized
  return 'other'
}

function consolidatePaymentSlipItems(items) {
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

function resolvePaymentSlipLineTotal(item) {
  const lineTotal = Number(parseFloat(item?.line_total))
  if (Number.isFinite(lineTotal)) return lineTotal
  const amount = Number(parseFloat(item?.amount))
  if (Number.isFinite(amount)) return amount
  const quantity = Number(parseFloat(item?.quantity))
  const unitPrice = Number(parseFloat(item?.unit_price))
  if (Number.isFinite(quantity) && Number.isFinite(unitPrice)) return quantity * unitPrice
  return 0
}

function buildPaymentSlipReceiptLine(data) {
  const quantity = Math.max(1, Number(parseFloat(data?.quantity)) || 1)
  const lineAmount = resolvePaymentSlipLineTotal(data)
  const unitPrice = Number(parseFloat(data?.unit_price))
  const resolvedUnit = Number.isFinite(unitPrice) && unitPrice > 0
    ? unitPrice
    : (quantity > 0 ? lineAmount / quantity : lineAmount)
  return {
    description: String(data?.description || 'Service').trim() || 'Service',
    quantity,
    unit_price: resolvedUnit,
    line_total: lineAmount,
  }
}

function buildPaymentSlipItemsForPayment(payment, invoiceDetails) {
  const paymentAmount = Math.max(0, Number(parseFloat(payment?.amount)) || 0)
  const rawItems = Array.isArray(invoiceDetails?.items) ? invoiceDetails.items : []
  const consolidated = consolidatePaymentSlipItems(rawItems)
  if (!paymentAmount) {
    return consolidated.map((it) => ({
      ...it,
      line_total: resolvePaymentSlipLineTotal(it),
    }))
  }
  if (!consolidated.length) {
    return [{
      description: payment?.transaction_reference || payment?.receipt_no || 'Payment',
      quantity: 1,
      unit_price: paymentAmount,
      line_total: paymentAmount,
    }]
  }
  const invoiceTotal = consolidated.reduce((sum, it) => sum + resolvePaymentSlipLineTotal(it), 0)
  if (consolidated.length === 1) {
    const item = consolidated[0]
    const unitPrice = Number(parseFloat(item.unit_price)) || 0
    const quantity = unitPrice > 0 ? paymentAmount / unitPrice : 1
    return [{
      description: item.description,
      quantity,
      unit_price: unitPrice > 0 ? unitPrice : paymentAmount,
      line_total: paymentAmount,
    }]
  }
  let remaining = paymentAmount
  return consolidated.map((item, idx) => {
    const lineBase = resolvePaymentSlipLineTotal(item)
    const lineTotal = idx === consolidated.length - 1
      ? remaining
      : (invoiceTotal > 0 ? paymentAmount * (lineBase / invoiceTotal) : 0)
    remaining -= lineTotal
    const unitPrice = Number(parseFloat(item.unit_price)) || 0
    const quantity = unitPrice > 0 ? lineTotal / unitPrice : (Number(parseFloat(item.quantity)) || 1)
    return {
      description: item.description,
      quantity,
      unit_price: unitPrice > 0 ? unitPrice : lineTotal,
      line_total: Math.round(lineTotal * 100) / 100,
    }
  })
}

function buildIpdLedgerReceiptData(ev, rowDescription) {
  const quantity = Math.max(0, Number(parseFloat(ev?.quantity)) || 0)
  const unitPrice = Number(parseFloat(ev?.unit_price))
  const paidAmount = Number(parseFloat(ev?.amount ?? ev?.paid_amount))
  const lineAmount = Number.isFinite(paidAmount) && paidAmount > 0
    ? paidAmount
    : Number(parseFloat(ev?.price) || 0)
  const resolvedUnit = Number.isFinite(unitPrice) && unitPrice > 0
    ? unitPrice
    : (quantity > 0 ? lineAmount / quantity : lineAmount)
  const resolvedQty = resolvedUnit > 0 ? lineAmount / resolvedUnit : (quantity || 1)
  return {
    amount: lineAmount,
    quantity: resolvedQty,
    unit_price: resolvedUnit,
    mode: ev?.payment_mode || 'other',
    invoice_no: ev?.invoice_no,
    slip_number: ev?.slip_number || '',
    description: ev?.name || rowDescription || 'Service',
    paid_at: ev?.date,
  }
}

const DISCHARGE_NAV_ANCHOR_OFFSET = 16

function dischargeSectionTopInContainer(scrollRoot, el) {
  return el.getBoundingClientRect().top - scrollRoot.getBoundingClientRect().top + scrollRoot.scrollTop
}

function resolveActiveDischargeSection(scrollRoot, navItems) {
  if (!scrollRoot || !navItems?.length) return ''
  const anchor = scrollRoot.scrollTop + DISCHARGE_NAV_ANCHOR_OFFSET
  let active = navItems[0].id
  for (const { id } of navItems) {
    const el = scrollRoot.querySelector(`#${id}`)
    if (!el) continue
    if (dischargeSectionTopInContainer(scrollRoot, el) <= anchor + 1) active = id
  }
  return active
}

// ─── IPD Ledger Modal ────────────────────────────────────────────────────────
function AdmissionLedgerModal({ admission, onClose, onDischarged, autoDischarge = false, onDischargeInitiated, autoOpenDischargeEdit = false }) {
  const isMobile = useIsMobile()
  const [ledger, setLedger]         = useState(null)
  const [chargeCatalog, setChargeCatalog] = useState([])
  const [quickServices, setQuickServices] = useState([])
  const [loading, setLoading]       = useState(true)
  const [mode, setMode]             = useState('charge') // 'charge' | 'receive' | 'discount'
  const [submitting, setSubmitting] = useState(false)
  const [showPrint, setShowPrint]   = useState(false)
  const [receipt, setReceipt]       = useState(null)
  const [showReceiptsModal, setShowReceiptsModal] = useState(false)
  const [ledgerCancelPayment, setLedgerCancelPayment] = useState(null)
  const [ledgerCancelPaymentReason, setLedgerCancelPaymentReason] = useState('')
  const [ledgerCancellingPayment, setLedgerCancellingPayment] = useState(false)
  const [ledgerCancelInvoice, setLedgerCancelInvoice] = useState(null)
  const [ledgerCancelInvoiceReason, setLedgerCancelInvoiceReason] = useState('')
  const [ledgerCancellingInvoice, setLedgerCancellingInvoice] = useState(false)
  const [ledgerEditingPayment, setLedgerEditingPayment] = useState(null)
  const [ledgerSavingPayment, setLedgerSavingPayment] = useState(false)
  const [ledgerEditingCharge, setLedgerEditingCharge] = useState(null)
  const [ledgerSavingCharge, setLedgerSavingCharge] = useState(false)
  const [ledgerCancellingRoomRent, setLedgerCancellingRoomRent] = useState(false)

  const paidReceipts = useMemo(() => {
    if (!ledger) return []
    return (ledger.payments || []).filter(p => {
      if (p?.type === 'pharmacy_payment') return false
      const rawId = p?.id != null ? String(p.id) : ''
      return !rawId.startsWith('pharmacy-paid-')
    }).map(p => {
      const desc = p?.description || ''
      const upper = String(desc || '').toUpperCase()
      const invNo = String(p?.invoice_no || '').toUpperCase()
      const isRefund = invNo.includes('IPDREF') || upper.includes('REFUND') || parseFloat(p?.amount || 0) < 0
      const isAdvance = !isRefund && (upper.includes('ADVANCE') || invNo.includes('IPDADV-'))
      const rawId = p?.id != null ? String(p.id) : ''
      const isPharmacy = p?.type === 'pharmacy_payment' || rawId.startsWith('pharmacy-paid-')
      const rowKind = isPharmacy ? 'pharmacy_payment' : 'payment'

      let mode = 'cash'
      if (upper.includes('UPI')) mode = 'upi'
      else if (upper.includes('CREDIT')) mode = 'credit'
      else if (upper.includes('CARD')) mode = 'card'

      return {
        id: `payment-${rawId}-${String(p?.date || '')}`,
        paymentTransactionId: isPharmacy ? '' : rawId,
        rowKind,
        status: p?.status || 'success',
        invoice_status: p?.invoice_status != null ? String(p.invoice_status) : 'finalized',
        date: p?.date,
        description: desc || (isAdvance ? 'Advance' : 'Payment'),
        amount: parseFloat(p?.amount || 0),
        invoice_no: p?.invoice_no || '',
        slip_number: p?.slip_number || '',
        mode,
        receiptKind: isRefund ? 'refund' : isAdvance ? 'advance' : 'charge',
      }
    }).sort((a, b) => {
      const voidA = a.rowKind === 'pharmacy_payment' ? false : (a.status === 'cancelled' || String(a.invoice_status || '').toLowerCase() === 'cancelled')
      const voidB = b.rowKind === 'pharmacy_payment' ? false : (b.status === 'cancelled' || String(b.invoice_status || '').toLowerCase() === 'cancelled')
      if (voidA !== voidB) return voidA ? 1 : -1
      const ta = a.date ? new Date(a.date).getTime() : 0
      const tb = b.date ? new Date(b.date).getTime() : 0
      return ta - tb
    })
  }, [ledger])

  const admissionLedgerStatementParts = useMemo(() => {
    const gc = ledger?.grouped_charges || []
    const active = []
    const cancelled = []
    for (const row of gc) {
      if (isIpdLedgerGroupedRowCancelled(row)) cancelled.push(row)
      else active.push(row)
    }
    const rooms = (ledger?.charges || []).filter(c => c.type === 'room_rent')
    return [
      ...active.map(row => ({ kind: 'group', row })),
      ...rooms.map(row => ({ kind: 'room', row })),
      ...cancelled.map(row => ({ kind: 'group', row })),
    ]
  }, [ledger?.grouped_charges, ledger?.charges, ledger?.payments])

  // Discharge State
  const [journey, setJourney] = useState(null) // { admission, step: 'form'|'billing' }
  const emptyVitals = () => ({ bp: '', pulse: '', spo2: '', temp: '', weight: '', rbs: '' })
  const emptySurgeryDraft = () => ({
    surgery_date: '',
    procedure_name: '',
    surgeon_name: '',
    assistant_name: '',
    anaesthetist_name: '',
    anaesthesia_type: '',
    operative_findings: '',
    intra_op_complications: '',
  })
  const [summary, setSummary] = useState({
    summary_notes: '', treatment_given: '', condition_at_discharge: 'Stable',
    medications_on_discharge: '', follow_up_advice: '',
    reason_for_admission: '', diagnosis: '', allergies: '', procedure_surgery: '',
    medical_history: '', physical_examination: '', investigations: '', course_in_hospital: '',
    diet_advice: '', activity_advice: '', warning_signs: '',
    chief_complaints: '', co_morbidities: '', family_history: '', personal_history: '',
    complications_during_stay: '', blood_transfusion_details: '', implants_used: '',
    indwelling_devices_on_discharge: '', vaccination_given: '', wound_care_instructions: '',
    stitch_removal_date: '',
    vitals_at_discharge: emptyVitals(),
    surgery_date: '', surgeon_name: '', assistant_name: '', anaesthetist_name: '', anaesthesia_type: '',
    operative_findings: '', intra_op_complications: '',
    discharge_date: '', discharge_time: '',
    discharge_type: 'routine', discharge_status: 'improved', mode_of_admission: 'opd',
    referred_to_facility: '', referral_reason: '',
    treating_consultant: '', consultant_registration_no: '', rmo_signed_by: '',
    next_follow_up_date: '', follow_up_doctor: '', follow_up_department: '',
    cause_of_death: '', time_of_death: '', notified_to: '', autopsy_required: false,
    abha_id: '', insurance_provider: '', tpa_name: '', policy_number: '', claim_number: '',
    patient_education_given: false, attendant_counselled_by: '',
    investigation_rows: [],
    surgery_rows: [],
  })
  const [surgeryDraft, setSurgeryDraft] = useState(emptySurgeryDraft())
  const [editingSurgeryIndex, setEditingSurgeryIndex] = useState(-1)
  /** Doctor-style discharge meds (pharmacy search + manual); synced to API as medication_rows */
  const [dischargeRxItems, setDischargeRxItems] = useState([])
  const [billing, setBilling] = useState(null)
  const [draftSaving, setDraftSaving] = useState(false)
  const [dischargeHydrated, setDischargeHydrated] = useState(false)
  const [settleMode, setSettleMode] = useState('cash')
  const [settleRef, setSettleRef] = useState('')
  const [settlePrint, setSettlePrint] = useState(true)
  const [settleSubmitting, setSettleSubmitting] = useState(false)
  const autoOpenedDischargeEditRef = useRef(false)
  const [dischargePreviewData, setDischargePreviewData] = useState(null)
  const dischargeScrollRootRef = useRef(null)
  const dischargeNavLockUntilRef = useRef(0)
  const [activeDischargeSection, setActiveDischargeSection] = useState('')

  const dischargeSectionNavItems = useMemo(() => {
    const head = [
      { id: 'discharge-section-metadata', Icon: ClipboardList, label: 'Discharge metadata & identifiers' },
    ]
    const death =
      summary.discharge_type === 'death'
        ? [{ id: 'discharge-section-death', Icon: Skull, label: 'Death summary' }]
        : []
    const tail = [
      { id: 'discharge-section-narrative', Icon: ScrollText, label: 'Clinical narrative' },
      { id: 'discharge-section-operative', Icon: Syringe, label: 'Operative / procedure' },
      { id: 'discharge-section-investigations', Icon: FlaskConical, label: 'Investigations (structured)' },
      { id: 'discharge-section-course', Icon: Hospital, label: 'Hospital course & complications' },
      { id: 'discharge-section-prescriptions', Icon: Pill, label: 'Medications on discharge' },
      { id: 'discharge-section-advice', Icon: MessageSquare, label: 'Advice on discharge' },
    ]
    return [...head, ...death, ...tail]
  }, [summary.discharge_type])

  const scrollDischargeToSection = useCallback((sectionId) => {
    const scrollRoot = dischargeScrollRootRef.current
    if (!scrollRoot || !sectionId) return
    const el = scrollRoot.querySelector(`#${sectionId}`)
    if (!el) return

    const expandedDetails = el.tagName === 'DETAILS' && !el.open
    if (expandedDetails) el.open = true

    dischargeNavLockUntilRef.current = Date.now() + (expandedDetails ? 1200 : 1000)
    setActiveDischargeSection(sectionId)

    const runScroll = () => {
      const top = Math.max(0, dischargeSectionTopInContainer(scrollRoot, el) - DISCHARGE_NAV_ANCHOR_OFFSET)
      scrollRoot.scrollTo({ top, behavior: 'smooth' })
    }

    if (expandedDetails) {
      requestAnimationFrame(() => requestAnimationFrame(runScroll))
    } else {
      runScroll()
    }

    window.setTimeout(() => {
      dischargeNavLockUntilRef.current = 0
      const synced = resolveActiveDischargeSection(scrollRoot, dischargeSectionNavItems)
      if (synced) setActiveDischargeSection(synced)
    }, expandedDetails ? 1250 : 1050)
  }, [dischargeSectionNavItems])

  // Receive Money form state (renamed from Capture Advance)
  const [advAmount, setAdvAmount] = useState('')
  const [advMode, setAdvMode]     = useState('cash')
  const [advRef, setAdvRef]       = useState('')
  const [advPrint, setAdvPrint]   = useState(true)

  // Add Charge form state
  const [chgDesc, setChgDesc]         = useState('')
  const [chgQty, setChgQty]           = useState('1')
  const [chgUnitPrice, setChgUnitPrice] = useState('')
  const [chgStatus, setChgStatus]     = useState('due') // 'paid' | 'due'
  const [chgPaidMode, setChgPaidMode] = useState('cash')
  const [chgPrint, setChgPrint]       = useState(false)
  const [selectedExistingCharge, setSelectedExistingCharge] = useState('')
  const [isServiceMenuOpen, setIsServiceMenuOpen] = useState(false)
  const [highlightedServiceIndex, setHighlightedServiceIndex] = useState(-1)
  const serviceComboboxRef = useRef(null)

  // Apply Discount form state
  const [discReason, setDiscReason] = useState('')
  const [discAmount, setDiscAmount] = useState('')

  const [expandedChargeRows, setExpandedChargeRows] = useState({})

  const dsInp = `w-full [box-sizing:border-box] bg-white border border-slate-300 hover:border-slate-400 shadow-sm rounded-lg px-4 py-2 text-sm text-slate-800 focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 outline-none [&[type=date]]:pr-10 [&[type=time]]:pr-11 [&[type=datetime-local]]:pr-10 ${isMobile ? 'text-[15px] py-2.5' : ''}`
  const dsLbl = 'text-[10px] font-black text-slate-400 uppercase tracking-wider mb-1 block'
  const { getSuggestions } = useDischargeFieldCatalog(Boolean(journey?.step === 'form'))
  const setVital = (k, v) => setSummary(s => ({
    ...s,
    vitals_at_discharge: { ...emptyVitals(), ...(s.vitals_at_discharge || {}), [k]: v },
  }))
  const addInvRow = () => setSummary(s => ({
    ...s,
    investigation_rows: [...(s.investigation_rows || []), { category: 'lab', test_name: '', value: '', reference_range: '', test_date: '' }],
  }))
  const updateInvRow = (idx, key, val) => setSummary(s => {
    const rows = [...(s.investigation_rows || [])]
    if (!rows[idx]) return s
    rows[idx] = { ...rows[idx], [key]: val }
    return { ...s, investigation_rows: rows }
  })
  const removeInvRow = (idx) => setSummary(s => ({
    ...s,
    investigation_rows: (s.investigation_rows || []).filter((_, i) => i !== idx),
  }))
  const updateSurgeryDraftField = (key, val) => {
    setSurgeryDraft((s) => ({ ...s, [key]: val }))
  }
  const resetSurgeryDraft = () => {
    setSurgeryDraft(emptySurgeryDraft())
    setEditingSurgeryIndex(-1)
  }

  const autosaveSurgeryDraftLikeSave = () => {
    const procedure = (surgeryDraft.procedure_name || '').trim()
    if (!procedure) return
    const row = {
      surgery_date: surgeryDraft.surgery_date || '',
      procedure_name: procedure,
      surgeon_name: (surgeryDraft.surgeon_name || '').trim(),
      assistant_name: (surgeryDraft.assistant_name || '').trim(),
      anaesthetist_name: (surgeryDraft.anaesthetist_name || '').trim(),
      anaesthesia_type: (surgeryDraft.anaesthesia_type || '').trim(),
      operative_findings: (surgeryDraft.operative_findings || '').trim(),
      intra_op_complications: (surgeryDraft.intra_op_complications || '').trim(),
    }
    setSummary((s) => {
      const rows = [...(s.surgery_rows || [])]
      if (editingSurgeryIndex >= 0 && rows[editingSurgeryIndex]) {
        rows[editingSurgeryIndex] = row
      } else {
        rows.push(row)
      }
      return {
        ...s,
        surgery_rows: rows,
        // Keep legacy single fields mirrored from first row for backward-compatible consumers.
        procedure_surgery: rows[0]?.procedure_name || '',
        surgery_date: rows[0]?.surgery_date || '',
        surgeon_name: rows[0]?.surgeon_name || '',
        assistant_name: rows[0]?.assistant_name || '',
        anaesthetist_name: rows[0]?.anaesthetist_name || '',
        anaesthesia_type: rows[0]?.anaesthesia_type || '',
        operative_findings: rows[0]?.operative_findings || '',
        intra_op_complications: rows[0]?.intra_op_complications || '',
      }
    })
    resetSurgeryDraft()
  }
  const saveSurgeryRow = () => {
    const procedure = (surgeryDraft.procedure_name || '').trim()
    if (!procedure) {
      toast.error('Procedure name is required before saving surgery')
      return
    }
    const row = {
      surgery_date: surgeryDraft.surgery_date || '',
      procedure_name: procedure,
      surgeon_name: (surgeryDraft.surgeon_name || '').trim(),
      assistant_name: (surgeryDraft.assistant_name || '').trim(),
      anaesthetist_name: (surgeryDraft.anaesthetist_name || '').trim(),
      anaesthesia_type: (surgeryDraft.anaesthesia_type || '').trim(),
      operative_findings: (surgeryDraft.operative_findings || '').trim(),
      intra_op_complications: (surgeryDraft.intra_op_complications || '').trim(),
    }
    setSummary((s) => {
      const rows = [...(s.surgery_rows || [])]
      if (editingSurgeryIndex >= 0 && rows[editingSurgeryIndex]) {
        rows[editingSurgeryIndex] = row
      } else {
        rows.push(row)
      }
      return {
        ...s,
        surgery_rows: rows,
        // Keep legacy single fields mirrored from first row for backward-compatible consumers.
        procedure_surgery: rows[0]?.procedure_name || '',
        surgery_date: rows[0]?.surgery_date || '',
        surgeon_name: rows[0]?.surgeon_name || '',
        assistant_name: rows[0]?.assistant_name || '',
        anaesthetist_name: rows[0]?.anaesthetist_name || '',
        anaesthesia_type: rows[0]?.anaesthesia_type || '',
        operative_findings: rows[0]?.operative_findings || '',
        intra_op_complications: rows[0]?.intra_op_complications || '',
      }
    })
    resetSurgeryDraft()
  }
  const editSurgeryRow = (idx) => {
    const row = (summary.surgery_rows || [])[idx]
    if (!row) return
    const editDraft = {
      surgery_date: row.surgery_date || '',
      procedure_name: row.procedure_name || row.procedure_surgery || '',
      surgeon_name: row.surgeon_name || '',
      assistant_name: row.assistant_name || '',
      anaesthetist_name: row.anaesthetist_name || '',
      anaesthesia_type: row.anaesthesia_type || '',
      operative_findings: row.operative_findings || '',
      intra_op_complications: row.intra_op_complications || '',
    }
    setSurgeryDraft(editDraft)
    setEditingSurgeryIndex(idx)
  }
  const removeSurgeryRow = (idx) => {
    setSummary((s) => {
      const rows = (s.surgery_rows || []).filter((_, i) => i !== idx)
      return {
        ...s,
        surgery_rows: rows,
        procedure_surgery: rows[0]?.procedure_name || '',
        surgery_date: rows[0]?.surgery_date || '',
        surgeon_name: rows[0]?.surgeon_name || '',
        assistant_name: rows[0]?.assistant_name || '',
        anaesthetist_name: rows[0]?.anaesthetist_name || '',
        anaesthesia_type: rows[0]?.anaesthesia_type || '',
        operative_findings: rows[0]?.operative_findings || '',
        intra_op_complications: rows[0]?.intra_op_complications || '',
      }
    })
    if (editingSurgeryIndex === idx) {
      resetSurgeryDraft()
    } else if (editingSurgeryIndex > idx) {
      setEditingSurgeryIndex((i) => i - 1)
    }
  }

  useEffect(() => {
    fetchLedger()
    fetchChargeCatalog()
    fetchQuickServices()
  }, [admission.id])

  useEffect(() => {
    if (autoDischarge && ledger && !loading && !journey) {
      handleInitiateDischarge();
      if (onDischargeInitiated) onDischargeInitiated();
    }
  }, [autoDischarge, ledger, loading, journey])

  useEffect(() => {
    if (!journey || journey.step !== 'form') return
    if (!dischargeHydrated) return
    const timer = setTimeout(() => { saveSummaryDraft() }, 900)
    return () => clearTimeout(timer)
  }, [journey, summary, dischargeRxItems, dischargeHydrated])

  useEffect(() => {
    if (!journey || journey.step !== 'form') {
      setActiveDischargeSection('')
      dischargeNavLockUntilRef.current = 0
      return
    }
    const root = dischargeScrollRootRef.current
    if (!root) return

    const first = dischargeSectionNavItems[0]?.id
    if (first) setActiveDischargeSection(first)

    let raf = 0
    const onScroll = () => {
      if (Date.now() < dischargeNavLockUntilRef.current) return
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => {
        const active = resolveActiveDischargeSection(root, dischargeSectionNavItems)
        if (active) setActiveDischargeSection(active)
      })
    }

    root.addEventListener('scroll', onScroll, { passive: true })
    onScroll()

    return () => {
      cancelAnimationFrame(raf)
      root.removeEventListener('scroll', onScroll)
    }
  }, [journey?.step, journey?.admission?.id, dischargeSectionNavItems])

  async function fetchLedger() {
    setLoading(true)
    try {
      const { data } = await api.get(`/ipd-admissions/${admission.id}/ledger/`)
      setLedger(data)
    } catch { toast.error('Failed to load ledger') }
    finally { setLoading(false) }
  }

  async function fetchChargeCatalog() {
    try {
      const { data } = await api.get('/ipd-admissions/charge-catalog/')
      setChargeCatalog(Array.isArray(data?.services) ? data.services : [])
    } catch {
      setChargeCatalog([])
    }
  }

  async function fetchQuickServices() {
    try {
      const { services } = await loadPaymentQuickServices()
      setQuickServices(services || DEFAULT_QUICK_SERVICES)
    } catch {
      setQuickServices(DEFAULT_QUICK_SERVICES)
    }
  }

  async function openLedgerEditPayment(paymentId) {
    if (!paymentId) return
    setLedgerSavingPayment(true)
    try {
      const { data } = await api.get(`/payments/${paymentId}/`)
      const row = data?.data || data
      setLedgerEditingPayment({ ...row, paid_at: toDateTimeInputValue(row.paid_at) })
    } catch {
      toast.error('Failed to load payment')
    } finally {
      setLedgerSavingPayment(false)
    }
  }

  async function submitLedgerCancelPayment() {
    if (!ledgerCancelPayment?.paymentTransactionId) return
    const reason = ledgerCancelPaymentReason.trim()
    if (!reason) {
      toast.error('Please enter cancellation reason')
      return
    }
    setLedgerCancellingPayment(true)
    try {
      const ref = `CANCEL:${reason}`.slice(0, 120)
      await api.patch(`/payments/${ledgerCancelPayment.paymentTransactionId}/`, {
        status: 'cancelled',
        transaction_reference: ref,
      })
      toast.success('Payment receipt cancelled')
      setLedgerCancelPayment(null)
      setLedgerCancelPaymentReason('')
      await fetchLedger()
    } catch (err) {
      toast.error(formatApiError(err, 'Failed to cancel payment'))
    } finally {
      setLedgerCancellingPayment(false)
    }
  }

  async function submitLedgerCancelInvoice() {
    if (!ledgerCancelInvoice?.invoice_id) return
    const reason = ledgerCancelInvoiceReason.trim()
    if (!reason) {
      toast.error('Please enter cancellation reason')
      return
    }
    setLedgerCancellingInvoice(true)
    try {
      await api.post(`/invoices/${ledgerCancelInvoice.invoice_id}/cancel/`, { reason })
      toast.success('Invoice cancelled')
      setLedgerCancelInvoice(null)
      setLedgerCancelInvoiceReason('')
      await fetchLedger()
    } catch (err) {
      toast.error(formatApiError(err, 'Failed to cancel invoice'))
    } finally {
      setLedgerCancellingInvoice(false)
    }
  }

  async function handleLedgerSavePayment(e) {
    e.preventDefault()
    if (!ledgerEditingPayment?.id) return
    setLedgerSavingPayment(true)
    try {
      await api.patch(`/payments/${ledgerEditingPayment.id}/`, {
        payment_mode: ledgerEditingPayment.payment_mode || 'cash',
        amount: ledgerEditingPayment.amount || 0,
        transaction_reference: ledgerEditingPayment.transaction_reference || '',
        receipt_no: ledgerEditingPayment.receipt_no || '',
        status: ledgerEditingPayment.status || 'success',
        paid_at: ledgerEditingPayment.paid_at || null,
      })
      toast.success('Payment slip updated!')
      setLedgerEditingPayment(null)
      await fetchLedger()
    } catch (err) {
      toast.error(formatApiError(err, 'Failed to update payment slip'))
    } finally {
      setLedgerSavingPayment(false)
    }
  }

  function openLedgerEditChargeFromEvent(ev, descriptionFallback) {
    if (!ev?.invoice_id) return
    const invStatus = String(ev.invoice_status || '').toLowerCase()
    if (invStatus !== 'finalized') {
      toast.error('Only finalized invoices can be edited from here')
      return
    }
    const qty = parseFloat(String(ev.quantity || '1')) || 1
    const fromApiUnit = parseFloat(String(ev.unit_price))
    const price = parseFloat(String(ev.price || '0')) || 0
    const unit = Number.isFinite(fromApiUnit) && fromApiUnit > 0
      ? fromApiUnit
      : (qty > 0 ? price / qty : price)
    setLedgerEditingCharge({
      invoice_id: ev.invoice_id,
      description: ev.name || descriptionFallback || 'Service',
      amount: String(price),
      quantity: String(ev.quantity ?? '1'),
      unit_price: String(Number.isFinite(unit) ? unit.toFixed(2) : '0'),
      isRoomRent: false,
    })
  }

  function openLedgerEditRoomRent(item) {
    const days = Math.max(1, parseInt(String(ledger?.days ?? '1'), 10) || 1)
    const fromApiDaily = item?.unit_price != null && String(item.unit_price) !== '' ? parseFloat(String(item.unit_price)) : NaN
    const amt = parseFloat(String(item?.amount ?? '0')) || 0
    const impliedDaily = days > 0 ? amt / days : amt
    const daily = Number.isFinite(fromApiDaily) ? fromApiDaily : impliedDaily
    const total = (Number.isFinite(daily) ? daily : 0) * days
    setLedgerEditingCharge({
      invoice_id: 'room_rent',
      description: item?.description || 'Room rent',
      amount: String(Number.isFinite(total) ? total.toFixed(2) : '0'),
      quantity: String(days),
      unit_price: String(Number.isFinite(daily) ? daily.toFixed(2) : '0'),
      isRoomRent: true,
    })
  }

  async function clearRoomRentOverride() {
    setLedgerSavingCharge(true)
    try {
      await api.patch(`/ipd-admissions/${admission.id}/update-charge/`, {
        invoice_id: 'room_rent',
        clear_room_rent_override: true,
      })
      toast.success('Room rent reset to calculated amount')
      setLedgerEditingCharge(null)
      await fetchLedger()
    } catch (err) {
      toast.error(formatApiError(err, 'Failed to reset room rent'))
    } finally {
      setLedgerSavingCharge(false)
    }
  }

  async function cancelRoomRent() {
    const currentAmount = parseFloat(String(ledger?.room_rent || '0')) || 0
    if (currentAmount <= 0) return
    if (!window.confirm('Cancel bed charges for this admission? Room rent will be set to ₹0.')) return
    setLedgerCancellingRoomRent(true)
    try {
      await api.patch(`/ipd-admissions/${admission.id}/update-charge/`, {
        invoice_id: 'room_rent',
        amount: 0,
      })
      toast.success('Bed charges cancelled')
      setLedgerEditingCharge(null)
      await fetchLedger()
    } catch (err) {
      toast.error(formatApiError(err, 'Failed to cancel bed charges'))
    } finally {
      setLedgerCancellingRoomRent(false)
    }
  }

  async function handleLedgerSaveCharge(e) {
    e.preventDefault()
    if (!ledgerEditingCharge?.invoice_id) return
    const itemName = String(ledgerEditingCharge.description || '').trim()
    if (!itemName) {
      toast.error('Item name is required')
      return
    }
    setLedgerSavingCharge(true)
    try {
      const isRoom = ledgerEditingCharge.invoice_id === 'room_rent'
      const payload = {
        invoice_id: ledgerEditingCharge.invoice_id,
        description: itemName,
      }
      if (isRoom) {
        const daily = parseFloat(String(ledgerEditingCharge.unit_price || '0'))
        const days = Math.max(1, parseInt(String(ledgerEditingCharge.quantity || ledger?.days || '1'), 10) || 1)
        if (!Number.isFinite(daily) || daily < 0) {
          toast.error('Per-day bed charge must be zero or greater')
          return
        }
        payload.unit_price = daily
        payload.quantity = days
      } else {
        const quantity = parseFloat(String(ledgerEditingCharge.quantity || '1'))
        const unitPrice = parseFloat(String(ledgerEditingCharge.unit_price || '0'))
        if (!Number.isFinite(quantity) || quantity <= 0 || !Number.isFinite(unitPrice) || unitPrice <= 0) {
          toast.error('Quantity and unit price must be greater than zero')
          return
        }
        payload.quantity = quantity
        payload.unit_price = unitPrice
      }
      await api.patch(`/ipd-admissions/${admission.id}/update-charge/`, payload)
      toast.success(isRoom ? 'Room rent updated' : 'Charge updated')
      setLedgerEditingCharge(null)
      await fetchLedger()
    } catch (err) {
      toast.error(formatApiError(err, 'Failed to update charge'))
    } finally {
      setLedgerSavingCharge(false)
    }
  }

  function handleInitiateDischarge() {
    setDischargeHydrated(false)
    setJourney({ admission, step: 'form' })
    setSummary({
      summary_notes: admission.admission_notes || '',
      treatment_given: '',
      condition_at_discharge: 'Stable',
      medications_on_discharge: '',
      follow_up_advice: '',
      reason_for_admission: admission.admission_diagnosis || '',
      diagnosis: '',
      allergies: '',
      procedure_surgery: '',
      medical_history: '',
      physical_examination: '',
      investigations: '',
      course_in_hospital: '',
      diet_advice: '',
      activity_advice: '',
      warning_signs: '',
      chief_complaints: '', co_morbidities: '', family_history: '', personal_history: '',
      complications_during_stay: '', blood_transfusion_details: '', implants_used: '',
      indwelling_devices_on_discharge: '', vaccination_given: '', wound_care_instructions: '',
      stitch_removal_date: '',
      vitals_at_discharge: emptyVitals(),
      surgery_date: '', surgeon_name: '', assistant_name: '', anaesthetist_name: '', anaesthesia_type: '',
      operative_findings: '', intra_op_complications: '',
      discharge_date: '', discharge_time: '',
      discharge_type: 'routine', discharge_status: 'improved',
      mode_of_admission: (admission.opd_visit_id || admission.opd_visit) ? 'opd' : 'emergency',
      referred_to_facility: '', referral_reason: '',
      treating_consultant: (admission.assigned_doctor_name || '').trim(),
      consultant_registration_no: '', rmo_signed_by: '',
      next_follow_up_date: '', follow_up_doctor: '', follow_up_department: admission.department || '',
      cause_of_death: '', time_of_death: '', notified_to: '', autopsy_required: false,
      abha_id: '', insurance_provider: '', tpa_name: '', policy_number: '', claim_number: '',
      patient_education_given: false, attendant_counselled_by: '',
      investigation_rows: [],
      surgery_rows: [],
    })
    setSurgeryDraft(emptySurgeryDraft())
    setEditingSurgeryIndex(-1)
    setDischargeRxItems([])
    loadDischargeDraft(admission.id).finally(() => setDischargeHydrated(true))
  }

  async function loadDischargeDraft(admissionId) {
    try {
      const { data } = await api.get(`/summaries/?admission_id=${admissionId}&limit=20`)
      const list = Array.isArray(data) ? data : (data?.results ?? data?.data ?? [])
      const existing = [...list].sort(compareDischargeSummariesNewestFirst)[0]
      if (!existing) return
      const v = existing.vitals_at_discharge && typeof existing.vitals_at_discharge === 'object'
        ? { ...emptyVitals(), ...existing.vitals_at_discharge }
        : emptyVitals()
      const normalizedSurgeryRows = Array.isArray(existing.surgery_rows)
        ? existing.surgery_rows
          .map(r => ({
            surgery_date: r.surgery_date || '',
            procedure_name: r.procedure_name || r.procedure_surgery || '',
            surgeon_name: r.surgeon_name || '',
            assistant_name: r.assistant_name || '',
            anaesthetist_name: r.anaesthetist_name || '',
            anaesthesia_type: r.anaesthesia_type || '',
            operative_findings: r.operative_findings || '',
            intra_op_complications: r.intra_op_complications || '',
          }))
          .filter(r => (r.procedure_name || '').trim())
        : []
      const legacySurgeryFallback = (
        existing.procedure_surgery
        || existing.surgery_date
        || existing.surgeon_name
        || existing.assistant_name
        || existing.anaesthetist_name
        || existing.anaesthesia_type
        || existing.operative_findings
        || existing.intra_op_complications
      )
        ? [{
            surgery_date: existing.surgery_date || '',
            procedure_name: existing.procedure_surgery || '',
            surgeon_name: existing.surgeon_name || '',
            assistant_name: existing.assistant_name || '',
            anaesthetist_name: existing.anaesthetist_name || '',
            anaesthesia_type: existing.anaesthesia_type || '',
            operative_findings: existing.operative_findings || '',
            intra_op_complications: existing.intra_op_complications || '',
          }]
        : []
      setSummary({
        summary_notes: existing.summary_notes || admission.admission_notes || '',
        treatment_given: existing.treatment_given || '',
        condition_at_discharge: existing.condition_at_discharge || 'Stable',
        medications_on_discharge: existing.medications_on_discharge || '',
        follow_up_advice: existing.follow_up_advice || '',
        reason_for_admission: existing.reason_for_admission || admission.admission_diagnosis || '',
        diagnosis: existing.diagnosis || '',
        allergies: existing.allergies || '',
        procedure_surgery: existing.procedure_surgery || '',
        medical_history: existing.medical_history || '',
        physical_examination: existing.physical_examination || '',
        investigations: existing.investigations || '',
        course_in_hospital: existing.course_in_hospital || '',
        diet_advice: existing.diet_advice || '',
        activity_advice: existing.activity_advice || '',
        warning_signs: existing.warning_signs || '',
        chief_complaints: existing.chief_complaints || '',
        co_morbidities: existing.co_morbidities || '',
        family_history: existing.family_history || '',
        personal_history: existing.personal_history || '',
        complications_during_stay: existing.complications_during_stay || '',
        blood_transfusion_details: existing.blood_transfusion_details || '',
        implants_used: existing.implants_used || '',
        indwelling_devices_on_discharge: existing.indwelling_devices_on_discharge || '',
        vaccination_given: existing.vaccination_given || '',
        wound_care_instructions: existing.wound_care_instructions || '',
        stitch_removal_date: existing.stitch_removal_date || '',
        vitals_at_discharge: v,
        surgery_date: existing.surgery_date || '',
        surgeon_name: existing.surgeon_name || '',
        assistant_name: existing.assistant_name || '',
        anaesthetist_name: existing.anaesthetist_name || '',
        anaesthesia_type: existing.anaesthesia_type || '',
        operative_findings: existing.operative_findings || '',
        intra_op_complications: existing.intra_op_complications || '',
        discharge_date: existing.discharge_date || '',
        discharge_time: toHtmlTimeValue(existing.discharge_time) || '',
        discharge_type: existing.discharge_type || 'routine',
        discharge_status: existing.discharge_status || 'improved',
        mode_of_admission: existing.mode_of_admission || ((admission.opd_visit_id || admission.opd_visit) ? 'opd' : 'emergency'),
        referred_to_facility: existing.referred_to_facility || '',
        referral_reason: existing.referral_reason || '',
        treating_consultant: existing.treating_consultant || (admission.assigned_doctor_name || '').trim(),
        consultant_registration_no: existing.consultant_registration_no || '',
        rmo_signed_by: existing.rmo_signed_by || '',
        next_follow_up_date: existing.next_follow_up_date || '',
        follow_up_doctor: existing.follow_up_doctor || '',
        follow_up_department: existing.follow_up_department || admission.department || '',
        cause_of_death: existing.cause_of_death || '',
        time_of_death: existing.time_of_death || '',
        notified_to: existing.notified_to || '',
        autopsy_required: !!existing.autopsy_required,
        abha_id: existing.abha_id || '',
        insurance_provider: existing.insurance_provider || '',
        tpa_name: existing.tpa_name || '',
        policy_number: existing.policy_number || '',
        claim_number: existing.claim_number || '',
        patient_education_given: !!existing.patient_education_given,
        attendant_counselled_by: existing.attendant_counselled_by || '',
        investigation_rows: Array.isArray(existing.investigation_rows) ? existing.investigation_rows.map(r => ({
          category: r.category || 'lab',
          test_name: r.test_name || '', value: r.value || '',
          reference_range: r.reference_range || '', test_date: r.test_date || '',
        })) : [],
        surgery_rows: normalizedSurgeryRows.length > 0 ? normalizedSurgeryRows : legacySurgeryFallback,
      })
      setSurgeryDraft(emptySurgeryDraft())
      setEditingSurgeryIndex(-1)
      setDischargeRxItems(medicationRowsToRxItems(existing.medication_rows))
    } catch {
      // Non-blocking: discharge flow can still continue without draft restore.
    }
  }

  const _computeCommittedSurgeryRows = ({ baseRows, draft, editingIndex }) => {
    const rows = Array.isArray(baseRows) ? [...baseRows] : []
    const procedure = String(draft?.procedure_name || '').trim()
    if (!procedure) return rows
    const row = {
      surgery_date: draft?.surgery_date || '',
      procedure_name: procedure,
      surgeon_name: String(draft?.surgeon_name || '').trim(),
      assistant_name: String(draft?.assistant_name || '').trim(),
      anaesthetist_name: String(draft?.anaesthetist_name || '').trim(),
      anaesthesia_type: String(draft?.anaesthesia_type || '').trim(),
      operative_findings: String(draft?.operative_findings || '').trim(),
      intra_op_complications: String(draft?.intra_op_complications || '').trim(),
    }
    if (editingIndex >= 0 && rows[editingIndex]) {
      rows[editingIndex] = row
    } else {
      rows.push(row)
    }
    return rows.filter((r) => String(r?.procedure_name || '').trim())
  }

  async function saveSummaryDraft(options = {}) {
    const admId = journey?.admission?.id || admission?.id
    if (!admId) return true
    const commitSurgeryDraft = options?.commitSurgeryDraft === true
    const clearSurgeryDraftAfter = options?.clearSurgeryDraftAfter === true

    const committedSurgeryRows = commitSurgeryDraft
      ? _computeCommittedSurgeryRows({
          baseRows: summary.surgery_rows,
          draft: surgeryDraft,
          editingIndex: editingSurgeryIndex,
        })
      : (summary.surgery_rows || [])

    setDraftSaving(true)
    try {
      const payload = {
        admission: admId,
        ...summary,
        surgery_rows: committedSurgeryRows,
        medication_rows: rxItemsToMedicationRows(dischargeRxItems, DEFAULT_DOSAGE_PATTERNS, DEFAULT_TIMING_OPTIONS),
      }
      await api.post('/summaries/', payload)

      if (commitSurgeryDraft) {
        setSummary((s) => ({
          ...s,
          surgery_rows: committedSurgeryRows,
          procedure_surgery: committedSurgeryRows[0]?.procedure_name || '',
          surgery_date: committedSurgeryRows[0]?.surgery_date || '',
          surgeon_name: committedSurgeryRows[0]?.surgeon_name || '',
          assistant_name: committedSurgeryRows[0]?.assistant_name || '',
          anaesthetist_name: committedSurgeryRows[0]?.anaesthetist_name || '',
          anaesthesia_type: committedSurgeryRows[0]?.anaesthesia_type || '',
          operative_findings: committedSurgeryRows[0]?.operative_findings || '',
          intra_op_complications: committedSurgeryRows[0]?.intra_op_complications || '',
        }))
        if (clearSurgeryDraftAfter) {
          setSurgeryDraft(emptySurgeryDraft())
          setEditingSurgeryIndex(-1)
        }
      }
      return true
    } catch {
      toast.error('Failed to save discharge summary draft')
      return false
    } finally {
      setDraftSaving(false)
    }
  }

  useEffect(() => {
    function persistOnUnload() {
      if (journey?.step === 'form' || journey?.step === 'billing') {
        // Best-effort autosave before tab/window close.
        try {
          const committed = _computeCommittedSurgeryRows({
            baseRows: summary.surgery_rows,
            draft: surgeryDraft,
            editingIndex: editingSurgeryIndex,
          })
          const payload = JSON.stringify({
            admission: journey?.admission?.id || admission?.id,
            ...summary,
            surgery_rows: committed,
            medication_rows: rxItemsToMedicationRows(dischargeRxItems, DEFAULT_DOSAGE_PATTERNS, DEFAULT_TIMING_OPTIONS),
          })
          if (navigator?.sendBeacon) {
            navigator.sendBeacon('/api/v1/summaries/', new Blob([payload], { type: 'application/json' }))
          }
        } catch {
          // ignore unload failures
        }
      }
    }
    window.addEventListener('beforeunload', persistOnUnload)
    return () => window.removeEventListener('beforeunload', persistOnUnload)
  }, [journey, admission?.id, dischargeRxItems, summary, surgeryDraft, editingSurgeryIndex])

  function openDischargeEditorForDischarged() {
    setDischargeHydrated(false)
    setJourney({ admission, step: 'form' })
    setDischargeRxItems([])
    loadDischargeDraft(admission.id).finally(() => setDischargeHydrated(true))
  }

  useEffect(() => {
    if (!autoOpenDischargeEdit || loading || !ledger) return
    if (String(admission?.status || '').toLowerCase() !== 'discharged') return
    if (autoOpenedDischargeEditRef.current) return
    autoOpenedDischargeEditRef.current = true
    setDischargeHydrated(false)
    setJourney({ admission, step: 'form' })
    setDischargeRxItems([])
    loadDischargeDraft(admission.id).finally(() => setDischargeHydrated(true))
  }, [autoOpenDischargeEdit, loading, ledger, admission?.id, admission?.status])

  async function goToBilling() {
    if (String(journey?.admission?.status || '').toLowerCase() === 'discharged') return
    setSubmitting(true)
    try {
      const saved = await saveSummaryDraft({ commitSurgeryDraft: true, clearSurgeryDraftAfter: true })
      if (!saved) return
      await refreshBillingSummary(journey.admission.id)
      setJourney(j => ({ ...j, step: 'billing' }))
    } catch { toast.error('Failed to fetch billing summary') }
    finally { setSubmitting(false) }
  }

  async function handleExitDischargeJourney() {
    await saveSummaryDraft({ commitSurgeryDraft: true, clearSurgeryDraftAfter: true })
    setJourney(null)
  }

  async function handleLedgerModalClose() {
    if (journey?.step === 'form' || journey?.step === 'billing') {
      await saveSummaryDraft({ commitSurgeryDraft: true, clearSurgeryDraftAfter: true })
    }
    setJourney(null)
    onClose()
  }

  async function saveDischargedSummaryExplicit() {
    const ok = await saveSummaryDraft()
    if (ok) toast.success('Discharge summary saved')
  }

  function buildDischargePreviewRecord() {
    const nowIso = new Date().toISOString()
    const ageFields = hydrateAgeFieldsFromPatient(admission?.patient || admission)
    return {
      ...summary,
      id: summary?.id || `preview-${Date.now()}`,
      admission: admission?.id,
      patient_name: admission?.patient_name || '',
      patient_uhid: admission?.patient_uhid || '',
      patient_age: summary?.patient_age ?? ageFields.age ?? admission?.patient_age ?? '',
      patient_age_unit: summary?.patient_age_unit || ageFields.ageUnit || admission?.patient_age_unit || 'years',
      patient_gender: summary?.patient_gender || admission?.patient_gender || admission?.gender || '',
      patient_guardian_name: summary?.patient_guardian_name || admission?.guardian_name || admission?.patient_guardian_name || '',
      admission_date: admission?.admission_date || summary?.admission_date || '',
      admission_time: summary?.admission_time || admission?.admission_time || '',
      admission_ipd_no: admission?.ipd_no || '',
      created_at: nowIso,
      total_billed: billing?.total_billed ?? summary.total_billed ?? 0,
      total_paid: billing?.total_paid ?? summary.total_paid ?? 0,
      outstanding_balance: (journey?.admission?.scheme || admission?.scheme)
        ? 0
        : (billing?.net_balance ?? billing?.outstanding ?? summary.outstanding_balance ?? 0),
      medication_rows: rxItemsToMedicationRows(dischargeRxItems, DEFAULT_DOSAGE_PATTERNS, DEFAULT_TIMING_OPTIONS),
      investigation_rows: Array.isArray(summary.investigation_rows) ? summary.investigation_rows : [],
    }
  }

  function openDischargePrintPreview() {
    setDischargePreviewData({
      rec: buildDischargePreviewRecord(),
      admission: journey?.admission || admission,
    })
  }

  async function refreshBillingSummary(admissionId = journey?.admission?.id) {
    if (!admissionId) return null
    try {
      const [summaryRes, ledgerRes] = await Promise.all([
        api.get(`/summaries/billing-summary/?admission_id=${admissionId}`),
        api.get(`/ipd-admissions/${admissionId}/ledger/`),
      ])
      const next = normalizeDischargeBillingSummary(
        resolveAdmissionApiRow(summaryRes.data),
        resolveAdmissionApiRow(ledgerRes.data),
      )
      setBilling(next)
      return next
    } catch {
      return billing
    }
  }

  async function handleDueSettlement() {
    const admissionId = journey?.admission?.id || admission.id
    let outstanding = parseAdmissionMoney(billing?.amount_due ?? billing?.outstanding)
    if (outstanding <= 0) {
      const latest = await refreshBillingSummary(admissionId)
      outstanding = parseAdmissionMoney(latest?.amount_due ?? latest?.outstanding)
    }
    if (outstanding <= 0) {
      toast.success('No pending due to settle')
      return
    }
    setSettleSubmitting(true)
    try {
      const { data } = await api.post(`/ipd-admissions/${admissionId}/capture-advance/`, {
        amount: outstanding.toFixed(2),
        payment_mode: mapDischargeSettlementMode(settleMode),
        reference: settleRef,
      })
      const paymentRow = resolveAdmissionApiRow(data)
      await Promise.all([refreshBillingSummary(admissionId), fetchLedger()])
      toast.success('Due settled successfully')
      if (settlePrint) {
        setReceipt({
          type: 'advance',
          data: {
            amount: outstanding,
            mode: mapDischargeSettlementMode(settleMode),
            invoice_no: paymentRow.invoice_no,
            slip_number: paymentRow?.payment?.slip_number || '',
            description: 'Final Settlement Payment',
            paid_at: paymentRow?.payment?.paid_at || paymentRow?.payment?.created_at || undefined,
          },
        })
      }
      setSettleRef('')
    } catch {
      toast.error('Failed to settle due')
    } finally {
      setSettleSubmitting(false)
    }
  }

  async function handleRefundSettlement() {
    const admissionId = journey?.admission?.id || admission.id
    let credit = parseAdmissionMoney(billing?.refund_due)
    if (credit <= 0) {
      const latest = await refreshBillingSummary(admissionId)
      credit = parseAdmissionMoney(latest?.refund_due)
    }
    if (credit <= 0.009) {
      toast.success('No refund to record')
      return
    }
    setSettleSubmitting(true)
    try {
      const { data } = await api.post(`/ipd-admissions/${admissionId}/record-discharge-refund/`, {
        amount: credit.toFixed(2),
        payment_mode: mapDischargeSettlementMode(settleMode),
        reference: settleRef,
      })
      const paymentRow = resolveAdmissionApiRow(data)
      await Promise.all([refreshBillingSummary(admissionId), fetchLedger()])
      toast.success('Refund recorded successfully')
      if (settlePrint) {
        setReceipt({
          type: 'refund',
          data: {
            amount: credit,
            mode: mapDischargeSettlementMode(settleMode),
            invoice_no: paymentRow.invoice_no,
            slip_number: paymentRow?.payment?.slip_number || '',
            description: 'Discharge refund to patient',
            paid_at: paymentRow?.payment?.paid_at || paymentRow?.payment?.created_at || undefined,
          },
        })
      }
      setSettleRef('')
    } catch {
      toast.error('Failed to record refund')
    } finally {
      setSettleSubmitting(false)
    }
  }

  const isSchemePatient = !!(journey?.admission?.scheme || admission?.scheme)

  async function finalizeDischarge() {
    const latestBilling = await refreshBillingSummary(journey?.admission?.id || admission.id)
    if (!latestBilling) {
      toast.error('Billing details are not ready')
      return
    }
    const net = parseAdmissionMoney(
      latestBilling.net_balance ?? (latestBilling.total_billed - latestBilling.total_paid),
    )
    if (!isSchemePatient && Math.abs(net) > 0.009) {
      toast.error(
        net > 0.009
          ? 'Please clear pending due before discharge finalization.'
          : 'Please record the refund to the patient before discharge finalization.',
      )
      return
    }
    setSubmitting(true)
    try {
      const saved = await saveSummaryDraft()
      if (!saved) return
      const payload = {
        admission: journey.admission.id,
        ...summary,
        total_billed: latestBilling.total_billed,
        total_paid: latestBilling.total_paid,
        outstanding_balance: isSchemePatient ? 0 : latestBilling.net_balance,
        medication_rows: rxItemsToMedicationRows(dischargeRxItems, DEFAULT_DOSAGE_PATTERNS, DEFAULT_TIMING_OPTIONS),
      }
      await api.post('/summaries/', payload)
      toast.success('Discharge finalized successfully!')
      setJourney(null)
      window.dispatchEvent(new Event('refresh-admissions'))
      if (typeof onDischarged === 'function') {
        onDischarged()
      } else {
        onClose()
      }
    } catch (err) {
      const detail = err?.response?.data?.detail
      const firstFieldError = Object.values(err?.response?.data || {}).flat?.()?.[0]
      toast.error(
        typeof detail === 'string'
          ? detail
          : typeof firstFieldError === 'string'
            ? firstFieldError
            : 'Failed to finalize discharge',
      )
    }
    finally { setSubmitting(false) }
  }

  const updateBilling = (key, val) => {
    setBilling(prev => {
      if (!prev) return prev
      const next = { ...prev, [key]: parseAdmissionMoney(val) }
      const tb = parseAdmissionMoney(next.total_services) + parseAdmissionMoney(next.room_total)
      const tp = parseAdmissionMoney(next.total_paid)
      const net = tb - tp
      next.total_billed = tb
      next.net_balance = net
      next.amount_due = Math.max(0, net)
      next.refund_due = Math.max(0, -net)
      next.outstanding = next.amount_due
      return next
    })
  }

  async function handleAdvance(e) {
    e.preventDefault()
    const amount = parseMoneyInput(advAmount)
    if (!Number.isFinite(amount) || amount <= 0) {
      toast.error('Enter a valid amount greater than zero')
      return
    }
    const amountText = String(amount)
    setSubmitting(true)
    try {
      const { data } = await api.post(`/ipd-admissions/${admission.id}/capture-advance/`, {
        amount: amountText, payment_mode: advMode, reference: advRef
      })
      toast.success('Payment captured')
      fetchLedger()
      if (advPrint) {
        setReceipt({
          type: 'advance',
          data: {
            amount: amountText,
            mode: advMode,
            invoice_no: data.invoice_no,
            slip_number: data?.payment?.slip_number || '',
            description: 'Advance Payment',
            paid_at: data?.payment?.paid_at || data?.payment?.created_at || undefined,
          }
        })
      }
      setAdvAmount(''); setAdvRef('')
    } catch { toast.error('Failed to save payment') }
    finally { setSubmitting(false) }
  }

  const chgLineTotal = (() => {
    const q = parseFloat(chgQty || 0)
    const u = parseFloat(chgUnitPrice || 0)
    if (!isFinite(q) || !isFinite(u)) return 0
    return q * u
  })()

  async function handleCharge(e) {
    e.preventDefault()
    const total = chgLineTotal
    if (!chgDesc.trim() || !total || total <= 0) {
      toast.error('Description, qty and price are required')
      return
    }
    const paymentMode = chgStatus === 'paid' ? chgPaidMode : 'credit'
    setSubmitting(true)
    try {
      const { data } = await api.post(`/ipd-admissions/${admission.id}/add-charge/`, {
        description: chgDesc,
        amount: total,
        quantity: parseFloat(chgQty || 0),
        unit_price: parseFloat(chgUnitPrice || 0),
        payment_mode: paymentMode,
      })
      const chargeRow = resolveAdmissionApiRow(data)
      toast.success(chgStatus === 'paid' ? 'Charge saved & paid' : 'Charge added to bill')
      fetchLedger()
      if (chgPrint) {
        const submittedQty = parseFloat(chgQty || 0)
        const unitPrice = parseFloat(chgUnitPrice || 0)
        const paymentAmount = Number(parseFloat(chargeRow?.payment?.amount))
        const slipAmount = Number.isFinite(paymentAmount) && paymentAmount > 0 ? paymentAmount : total
        const line = buildPaymentSlipReceiptLine({
          description: chgDesc,
          quantity: submittedQty,
          unit_price: unitPrice,
          amount: slipAmount,
        })
        setReceipt({
          type: 'charge',
          data: {
            ...line,
            amount: line.line_total,
            mode: paymentMode,
            invoice_no: chargeRow.invoice_no,
            slip_number: chargeRow?.payment?.slip_number || '',
            paid_at: chargeRow?.payment?.paid_at || chargeRow?.payment?.created_at || undefined,
          },
        })
      }
      setChgDesc(''); setChgQty('1'); setChgUnitPrice(''); setChgStatus('due'); setChgPaidMode('cash'); setSelectedExistingCharge(''); setIsServiceMenuOpen(false); setHighlightedServiceIndex(-1)
    } catch { toast.error('Failed to add charge') }
    finally { setSubmitting(false) }
  }

  async function handleDiscount(e) {
    e.preventDefault()
    const amt = parseFloat(discAmount || 0)
    if (!discReason.trim() || !amt || amt <= 0) {
      toast.error('Reason and discount amount are required')
      return
    }
    setSubmitting(true)
    try {
      await api.post(`/ipd-admissions/${admission.id}/add-charge/`, {
        description: discReason, amount: -Math.abs(amt), payment_mode: 'credit',
      })
      toast.success('Discount applied')
      fetchLedger()
      setDiscReason(''); setDiscAmount('')
    } catch (err) {
      toast.error(formatApiError(err, 'Failed to apply discount'))
    } finally { setSubmitting(false) }
  }

  function applyRoomRentDiscount() {
    setMode('discount')
    setDiscReason('Room Rent Discount')
    setDiscAmount('')
    setTimeout(() => document.getElementById('disc-amount-input')?.focus(), 80)
  }

  function toggleChargeRowExpand(rowId) {
    setExpandedChargeRows(prev => ({ ...prev, [rowId]: !prev[rowId] }))
  }

  const serviceOptions = useMemo(() => {
    const byDesc = new Map()
    const normDesc = (d) => String(d || '').trim().toLowerCase()
    const addOption = (opt) => {
      const description = String(opt?.description || '').trim()
      if (!description || description.includes('(Cancelled)')) return
      const descKey = normDesc(description)
      if (!descKey || byDesc.has(descKey)) return
      const id = String(opt?.id || '').trim() || serviceGroupIdFromLabel(description)
      byDesc.set(descKey, {
        id,
        description,
        quantity: parseInt(opt?.quantity || 0, 10) || 0,
        events: opt?.events || [],
        unit_price: opt?.unit_price,
      })
    }
    for (const g of ledger?.grouped_charges || []) {
      addOption({
        id: g.id,
        description: g.description,
        quantity: g.quantity,
        events: g.events,
      })
    }
    for (const s of chargeCatalog || []) {
      addOption(s)
    }
    for (const s of quickServices || []) {
      addOption({
        id: serviceGroupIdFromLabel(s.label),
        description: s.label,
        unit_price: s.price,
      })
    }
    return Array.from(byDesc.values()).sort((a, b) =>
      a.description.localeCompare(b.description, undefined, { sensitivity: 'base' })
    )
  }, [ledger?.grouped_charges, chargeCatalog, quickServices])

  const filteredServiceOptions = useMemo(() => {
    const q = String(chgDesc || "").trim().toLowerCase()
    if (!q) return serviceOptions
    return serviceOptions.filter((opt) => opt.description.toLowerCase().includes(q))
  }, [serviceOptions, chgDesc])

  function getLatestUnitPrice(events) {
    const lastEvent = [...(events || [])].sort((a, b) => new Date(b.date) - new Date(a.date))[0]
    const lineTotal = Math.abs(parseFloat(lastEvent?.price) || 0)
    const qty = Math.abs(parseFloat(lastEvent?.quantity) || 0)
    if (!lineTotal) return 0
    if (qty > 0) return lineTotal / qty
    return lineTotal
  }

  function getServiceOptionUnitPrice(opt) {
    const fromEvents = getLatestUnitPrice(opt?.events)
    if (fromEvents) return fromEvents
    const catalogPrice = parseFloat(opt?.unit_price)
    return catalogPrice > 0 ? catalogPrice : 0
  }

  function handleSelectExistingCharge(value) {
    setSelectedExistingCharge(value)
    if (!value) {
      setHighlightedServiceIndex(-1)
      return
    }
    const selected =
      serviceOptions.find((opt) => opt.id === value)
      || (ledger?.grouped_charges || []).find((g) => g.id === value)
    if (!selected) return
    // Only fill description; user can add new qty / unit price for the new entry.
    setChgDesc(selected.description || '')
    const last = getServiceOptionUnitPrice(selected)
    if (last) setChgUnitPrice(String(last))
    setIsServiceMenuOpen(false)
    setHighlightedServiceIndex(-1)
  }

  const inp = 'w-full border border-gray-200 rounded-xl p-2.5 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none bg-gray-50 hover:bg-white transition-colors'

  useEffect(() => {
    function handleOutsideClick(e) {
      if (!serviceComboboxRef.current) return
      if (!serviceComboboxRef.current.contains(e.target)) {
        setIsServiceMenuOpen(false)
        setHighlightedServiceIndex(-1)
      }
    }
    document.addEventListener('mousedown', handleOutsideClick)
    return () => document.removeEventListener('mousedown', handleOutsideClick)
  }, [])


  if (journey) {
    const isStep1 = journey.step === 'form'
    const dischargedEditing = String(journey.admission?.status || '').toLowerCase() === 'discharged'

    return (
      <>
      <div className={`fixed inset-0 z-[600] flex items-stretch sm:items-center justify-center ${isMobile ? 'p-0' : 'p-3'} bg-slate-900/60 backdrop-blur-md transition-opacity`}>
        <div className={`bg-white shadow-2xl w-full max-w-5xl overflow-hidden flex flex-col border border-white/20 transform transition-all duration-300 ${isMobile ? 'h-[100dvh] max-h-[100dvh] rounded-none' : 'max-h-[94vh] rounded-[1.5rem]'}`}>
          
          {/* Header */}
          <div className="relative bg-gradient-to-br from-emerald-600 via-emerald-500 to-teal-500 px-3 sm:px-5 py-2.5 text-white overflow-hidden shrink-0">
            {/* Background patterns */}
            <div className="absolute top-0 right-0 -mr-16 -mt-16 w-64 h-64 rounded-full bg-white opacity-10 mix-blend-overlay animate-pulse"></div>
            <div className="absolute bottom-0 right-32 -mb-20 w-48 h-48 rounded-full bg-white opacity-10 mix-blend-overlay"></div>
            
            <div className="relative flex items-start sm:items-center justify-between gap-2 z-10">
              <div className="flex items-start sm:items-center gap-2 sm:gap-3 min-w-0 flex-1">
                <div className="w-9 h-9 rounded-lg bg-white/20 backdrop-blur-md flex items-center justify-center shadow-inner border border-white/30 shrink-0">
                  <Activity size={18} className="text-white" strokeWidth={2} />
                </div>
                <div className="min-w-0">
                  <h3 className="font-black text-base sm:text-lg tracking-tight leading-snug drop-shadow-sm">
                    {dischargedEditing ? 'Edit discharge summary' : 'Discharge Process'}
                  </h3>
                  <div className="flex flex-wrap items-center gap-1 mt-1">
                    <span className="bg-white/20 px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-widest">IPD: {journey.admission.ipd_no || 'N/A'}</span>
                    <span className="bg-white/20 px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-widest">UHID: {journey.admission.patient_uhid || 'N/A'}</span>
                  </div>
                  <p className="text-emerald-50 mt-1 text-xs font-medium opacity-90 drop-shadow-sm truncate">
                    {journey.admission.patient_name}
                  </p>
                </div>
              </div>
              <button type="button" onClick={handleExitDischargeJourney} className="w-8 h-8 rounded-full flex items-center justify-center bg-white/10 hover:bg-white/30 transition-all active:scale-95 text-emerald-50 hover:text-white backdrop-blur-md border border-white/10 shrink-0">
                <XCircle size={20} strokeWidth={2} />
              </button>
            </div>
            
            {/* Modern Stepper */}
            {!dischargedEditing ? (
              <div className="mt-2 relative z-10 flex items-center justify-center max-w-md mx-auto">
                <div className="absolute top-1/2 left-0 w-full h-1 bg-white/20 rounded-full -translate-y-1/2"></div>
                <div className={`absolute top-1/2 left-0 h-1 bg-white rounded-full -translate-y-1/2 transition-all duration-700 ease-out shadow-[0_0_10px_rgba(255,255,255,0.7)] ${isStep1 ? 'w-[15%]' : 'w-full'}`}></div>
                
                <div className="w-full flex justify-between relative">
                  <div className="flex flex-col items-center gap-1">
                    <div className={`w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-black transition-all duration-500 bg-white text-emerald-600 shadow-lg ring-4 ring-emerald-600/30`}>
                      1
                    </div>
                    <span className={`text-[9px] font-black uppercase tracking-widest text-white drop-shadow-sm transition-all duration-300`}>Clinical Summary</span>
                  </div>
                  <div className="flex flex-col items-center gap-1">
                    <div className={`w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-black transition-all duration-500 delay-100 ${!isStep1 ? 'bg-white text-emerald-600 shadow-lg ring-4 ring-emerald-600/30' : 'bg-emerald-700/50 text-emerald-200 border border-emerald-400/50 backdrop-blur-sm'}`}>
                      2
                    </div>
                    <span className={`text-[9px] font-black uppercase tracking-widest transition-all duration-300 ${!isStep1 ? 'text-white drop-shadow-sm' : 'text-emerald-200 opacity-70'}`}>Billing Review</span>
                  </div>
                </div>
              </div>
            ) : (
              <p className="mt-3 relative z-10 text-center text-xs font-semibold text-emerald-50/95 max-w-xl mx-auto">
                Changes auto-save while you edit. Use Save summary for confirmation, or close to keep the latest draft on the server.
              </p>
            )}
          </div>

          <div className="flex flex-1 min-h-0 bg-slate-50 flex-col sm:flex-row">
            {isStep1 && (
              isMobile ? (
                <div className="shrink-0 border-b border-slate-200 bg-white overflow-x-auto overscroll-x-contain">
                  <div className="flex gap-1.5 px-2 py-2 min-w-max">
                    {dischargeSectionNavItems.map(({ id, Icon, label }) => (
                      <button
                        key={id}
                        type="button"
                        title={label}
                        aria-label={label}
                        aria-current={activeDischargeSection === id ? 'step' : undefined}
                        onClick={() => scrollDischargeToSection(id)}
                        className={`shrink-0 flex flex-col items-center justify-center gap-0.5 min-w-[4.25rem] max-w-[5.5rem] px-2 py-1.5 rounded-xl transition-all duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 ${
                          activeDischargeSection === id
                            ? 'bg-emerald-600 text-white shadow-md'
                            : 'bg-slate-50 text-slate-600 border border-slate-200 active:bg-emerald-50'
                        }`}
                      >
                        <Icon size={16} strokeWidth={activeDischargeSection === id ? 2.25 : 2} />
                        <span className={`text-[9px] font-bold leading-tight text-center line-clamp-2 ${activeDischargeSection === id ? 'text-white' : 'text-slate-600'}`}>
                          {label.split(' ')[0]}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
              <aside className="shrink-0 w-[148px] sm:w-[176px] flex flex-col items-stretch gap-1.5 py-3 sm:py-4 px-2 sm:px-2.5 border-r border-slate-200/80 bg-gradient-to-b from-white via-slate-50/95 to-slate-100/90 shadow-[inset_-1px_0_0_rgba(15,23,42,0.05)] overflow-y-auto max-h-full">
                <span className="text-[8px] sm:text-[9px] font-black uppercase tracking-widest text-slate-400 mb-0.5 sm:mb-1 select-none text-center leading-tight px-0.5">Jump</span>
                {dischargeSectionNavItems.map(({ id, Icon, label }, idx) => (
                  <React.Fragment key={id}>
                    {idx > 0 && <div className="w-px h-1.5 sm:h-2 bg-gradient-to-b from-transparent via-slate-300/80 to-transparent" aria-hidden />}
                    <button
                      type="button"
                      title={label}
                      aria-label={label}
                      aria-current={activeDischargeSection === id ? 'step' : undefined}
                      onClick={() => scrollDischargeToSection(id)}
                      className={`relative w-full min-h-9 sm:min-h-10 rounded-xl px-2.5 py-1.5 flex items-center gap-2.5 transition-all duration-200 ease-out focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-1 focus-visible:ring-offset-slate-50 ${
                        activeDischargeSection === id
                          ? 'bg-emerald-600 text-white shadow-lg shadow-emerald-600/35 ring-2 ring-emerald-200 ring-offset-2 ring-offset-slate-50'
                          : 'bg-white text-slate-500 shadow-sm border border-slate-200/90 hover:border-emerald-300 hover:bg-emerald-50 hover:text-emerald-700 hover:shadow-md hover:-translate-y-px active:scale-95'
                      }`}
                    >
                      <Icon size={activeDischargeSection === id ? 17 : 16} strokeWidth={activeDischargeSection === id ? 2.25 : 2} className="transition-transform duration-300 shrink-0" />
                      <span className={`text-[10px] sm:text-[11px] font-bold leading-tight tracking-wide truncate ${activeDischargeSection === id ? 'text-white' : 'text-slate-700'}`}>
                        {label}
                      </span>
                      {activeDischargeSection === id && (
                        <span className="pointer-events-none absolute inset-0 rounded-xl ring-2 ring-white/40 animate-pulse" aria-hidden />
                      )}
                    </button>
                  </React.Fragment>
                ))}
              </aside>
              )
            )}
            <div ref={dischargeScrollRootRef} className={`flex-1 overflow-y-auto min-h-0 scroll-smooth custom-scrollbar scroll-pt-3 ${isMobile ? 'px-3 py-3 pb-24' : 'px-5 sm:px-7 py-4 sm:py-5'}`}>
            {isStep1 ? (
              <div className="space-y-4 max-w-5xl mx-auto animate-in fade-in slide-in-from-bottom-4 duration-500">
                <div className="flex flex-col sm:flex-row sm:flex-wrap sm:items-center justify-between gap-2 mb-1">
                  <div>
                    <h4 className="text-base sm:text-lg font-black text-slate-800 tracking-tight">Clinical Documentation</h4>
                    <p className="text-xs text-slate-500 font-medium mt-0.5">Use sections below; structured meds & labs print as tables.</p>
                  </div>
                  <div className="text-[11px] font-semibold text-slate-600 bg-white border border-slate-200 px-2.5 py-1.5 rounded-lg leading-relaxed">
                    Ward: {journey.admission.ward_name || 'N/A'} · Bed: {journey.admission.bed_code || 'N/A'}
                    {journey.admission.scheme_name ? (
                      <span className="ml-1.5 inline-block bg-yellow-400 text-yellow-950 border border-yellow-300 px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-widest">
                        {journey.admission.scheme_name}
                      </span>
                    ) : null}
                  </div>
                </div>

                <DischargeClinicalForm
                  sectionIdPrefix="discharge-section"
                  isMobile={isMobile}
                  summary={summary}
                  setSummary={setSummary}
                  surgeryDraft={surgeryDraft}
                  updateSurgeryDraftField={updateSurgeryDraftField}
                  saveSurgeryRow={saveSurgeryRow}
                  resetSurgeryDraft={resetSurgeryDraft}
                  editingSurgeryIndex={editingSurgeryIndex}
                  editSurgeryRow={editSurgeryRow}
                  removeSurgeryRow={removeSurgeryRow}
                  dischargeRxItems={dischargeRxItems}
                  setDischargeRxItems={setDischargeRxItems}
                  setVital={setVital}
                  addInvRow={addInvRow}
                  updateInvRow={updateInvRow}
                  removeInvRow={removeInvRow}
                  getSuggestions={getSuggestions}
                  dsInp={dsInp}
                  dsLbl={dsLbl}
                  dosagePatternOptions={DEFAULT_DOSAGE_PATTERNS}
                  timingOptions={DEFAULT_TIMING_OPTIONS}
                  footer={
                    <div className={`pt-3 mt-1 border-t border-slate-200/60 flex flex-col sm:flex-row justify-end gap-2 ${isMobile ? 'fixed bottom-0 left-0 right-0 z-30 bg-white/95 backdrop-blur-md border-t border-slate-200 px-3 py-3 shadow-[0_-6px_24px_rgba(0,0,0,0.08)]' : ''}`}>
                      <button
                        type="button"
                        onClick={openDischargePrintPreview}
                        className={`bg-white text-slate-700 border border-slate-300 rounded-xl text-sm font-bold hover:bg-slate-50 flex items-center justify-center gap-2 transition-all active:scale-95 focus:ring-4 focus:ring-slate-200 ${isMobile ? 'w-full py-3' : 'px-4 py-2.5'}`}
                      >
                        <Eye size={16} /> Preview print
                      </button>
                      {dischargedEditing ? (
                        <button type="button" onClick={saveDischargedSummaryExplicit} disabled={submitting || draftSaving}
                          className={`bg-emerald-700 text-white rounded-xl text-sm font-bold hover:bg-emerald-800 flex items-center justify-center gap-2 transition-all active:scale-95 focus:ring-4 focus:ring-emerald-300 disabled:opacity-60 ${isMobile ? 'w-full py-3' : 'px-6 py-2.5'}`}>
                          {draftSaving ? 'Saving...' : 'Save summary'}
                        </button>
                      ) : (
                        <button type="button" onClick={goToBilling} disabled={submitting}
                          className={`bg-slate-800 text-white rounded-xl text-sm font-bold hover:bg-black hover:shadow-lg hover:shadow-black/20 flex items-center justify-center gap-2 transition-all active:scale-95 group focus:ring-4 focus:ring-slate-300 ${isMobile ? 'w-full py-3' : 'px-6 py-2.5'}`}>
                          {draftSaving ? 'Saving...' : 'Review Billing Summary'} <ArrowRight size={18} className="transition-transform group-hover:translate-x-1" />
                        </button>
                      )}
                    </div>
                  }
                />

              </div>
            ) : (
              <div className="space-y-6 max-w-3xl mx-auto animate-in fade-in slide-in-from-right-8 duration-500 py-1">
                <div className="flex bg-emerald-50/50 p-5 rounded-2xl border border-emerald-100 items-start gap-4 shadow-sm">
                  <div className="w-12 h-12 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center shrink-0 shadow-sm">
                    <Receipt size={22} strokeWidth={2.5} />
                  </div>
                  <div>
                    <h4 className="text-lg font-black text-slate-800 tracking-tight">Financial Review & Adjustments</h4>
                    <p className="text-xs text-slate-500 mt-1 font-medium leading-relaxed">
                      You can manually adjust the amounts below before finalizing. The totals will reflect in the patient's final discharge invoice automatically.
                    </p>
                  </div>
                </div>
                
                {billing && (
                  <div className="space-y-6">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-5">
                      <div className="bg-white rounded-2xl p-4 sm:p-5 border shadow-sm border-slate-200 focus-within:ring-4 focus-within:ring-emerald-500/10 focus-within:border-emerald-500 transition-all hover:-translate-y-0.5 group">
                         <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3 group-focus-within:text-emerald-600 transition-colors">Service Invoices (Surgery, etc.)</p>
                         <div className="flex items-center gap-2">
                           <span className="text-slate-300 font-bold text-xl sm:text-2xl group-focus-within:text-emerald-500 transition-colors">₹</span>
                           <input type="number" value={billing.total_services} onChange={e => updateBilling('total_services', e.target.value)}
                             className="text-2xl sm:text-3xl font-black text-slate-800 outline-none w-full bg-transparent" />
                         </div>
                      </div>
                      <div className="bg-white rounded-2xl p-4 sm:p-5 border shadow-sm border-slate-200 focus-within:ring-4 focus-within:ring-emerald-500/10 focus-within:border-emerald-500 transition-all hover:-translate-y-0.5 group">
                         <p className="flex items-center justify-between text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3 group-focus-within:text-emerald-600 transition-colors">
                           Room Charges
                           <span className="bg-slate-100 text-slate-500 px-2.5 py-0.5 rounded-md tracking-normal text-xs">{billing.stay_days} Days</span>
                         </p>
                         <div className="flex items-center gap-2">
                           <span className="text-slate-300 font-bold text-xl sm:text-2xl group-focus-within:text-emerald-500 transition-colors">₹</span>
                           <input type="number" value={billing.room_total} onChange={e => updateBilling('room_total', e.target.value)}
                             className="text-2xl sm:text-3xl font-black text-slate-800 outline-none w-full bg-transparent" />
                         </div>
                      </div>
                    </div>

                    <div className="bg-slate-800 rounded-2xl sm:rounded-[2rem] p-5 sm:p-8 text-white relative overflow-hidden shadow-2xl shadow-slate-800/20 border border-slate-700/50">
                       <div className="absolute top-0 right-0 w-64 h-64 bg-gradient-to-br from-emerald-500/20 to-transparent rounded-full translate-x-1/3 -translate-y-1/3 blur-2xl"></div>
                       
                       <div className="relative z-10 flex justify-between items-center mb-5">
                          <span className="text-sm font-bold text-slate-300 uppercase tracking-widest">Gross Billed Amount</span>
                          <span className="text-2xl font-black text-slate-100">₹{Number(billing.total_billed).toLocaleString()}</span>
                       </div>
                       <div className="relative z-10 flex justify-between items-center mb-6 pb-6 border-b border-slate-700/80">
                          <span className="text-sm font-bold text-slate-300 uppercase tracking-widest">Recorded Payments & Advances</span>
                          <span className="text-2xl font-black text-emerald-400">₹{Number(billing.total_paid).toLocaleString()}</span>
                       </div>
                       <div className="relative z-10 flex justify-between items-end">
                          <div>
                             {isSchemePatient ? (
                               <>
                                 <p className="text-xs font-black uppercase tracking-widest mb-1.5 text-yellow-300 drop-shadow-sm">
                                   Scheme patient — no balance due
                                 </p>
                                 {journey.admission.scheme_name ? (
                                   <span className="inline-block bg-yellow-400 text-yellow-950 border border-yellow-300 px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-widest mb-2">
                                     {journey.admission.scheme_name}
                                   </span>
                                 ) : null}
                                 <div className="flex items-start gap-1">
                                   <span className="text-2xl font-bold mt-1 opacity-70">₹</span>
                                   <span className="text-[2.25rem] sm:text-[3.5rem] leading-none tracking-tighter font-black text-white">0</span>
                                 </div>
                               </>
                             ) : (
                               <>
                             <p className={`text-xs font-black uppercase tracking-widest mb-1.5 drop-shadow-sm ${
                               Number(billing.refund_due) > 0.009
                                 ? 'text-sky-300'
                                 : Number(billing.amount_due ?? billing.outstanding) > 0.009
                                   ? 'text-emerald-400'
                                   : 'text-slate-300'
                             }`}>
                               {Number(billing.refund_due) > 0.009
                                 ? 'Credit / refund to patient'
                                 : Number(billing.amount_due ?? billing.outstanding) > 0.009
                                   ? 'Final Settlement Due'
                                   : 'Net balance'}
                             </p>
                             <div className="flex items-start gap-1">
                               <span className="text-2xl font-bold mt-1 opacity-70">₹</span>
                               <span className="text-[2.25rem] sm:text-[3.5rem] leading-none tracking-tighter font-black text-white">
                                 {Number(
                                   Number(billing.refund_due) > 0.009
                                     ? billing.refund_due
                                     : (billing.amount_due ?? billing.outstanding),
                                 ).toLocaleString()}
                               </span>
                             </div>
                               </>
                             )}
                          </div>
                          <div className="bg-white/10 backdrop-blur-md px-4 py-2 rounded-xl border border-white/5">
                            <span className="text-[10px] font-black uppercase tracking-widest opacity-80">Room: {journey.admission.room_name || 'N/A'}</span>
                          </div>
                       </div>
                    </div>

                    {!isSchemePatient && Number(billing.amount_due ?? billing.outstanding) > 0.009 && (
                    <div className="bg-white p-5 rounded-2xl border border-emerald-200 shadow-sm">
                      <div className="flex items-center justify-between gap-4 mb-4">
                        <div>
                          <p className="text-sm font-black text-slate-800 tracking-tight">Settle Due Now</p>
                          <p className="text-xs text-slate-500 font-medium">Clear the pending amount directly from billing review.</p>
                        </div>
                        <p className="text-sm font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-1.5">
                          Due: ₹{Number((billing.amount_due ?? billing.outstanding) || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                        </p>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                        <select
                          value={settleMode}
                          onChange={e => setSettleMode(e.target.value)}
                          className="w-full bg-white border border-slate-200 rounded-xl p-3 text-sm font-semibold text-slate-700 focus:ring-4 focus:ring-emerald-500/10 focus:border-emerald-500 outline-none"
                        >
                          <option value="cash">Cash</option>
                          <option value="upi">UPI</option>
                          <option value="card">Card</option>
                          <option value="bank_transfer">Bank Transfer</option>
                          <option value="other">Other</option>
                        </select>
                        <input
                          value={settleRef}
                          onChange={e => setSettleRef(e.target.value)}
                          placeholder="Reference (optional)"
                          className="w-full bg-white border border-slate-200 rounded-xl p-3 text-sm font-medium text-slate-700 focus:ring-4 focus:ring-emerald-500/10 focus:border-emerald-500 outline-none"
                        />
                        <label className="flex items-center gap-2 text-sm font-bold text-slate-700 px-3 py-2.5 rounded-xl border border-slate-200 bg-slate-50">
                          <input type="checkbox" checked={settlePrint} onChange={e => setSettlePrint(e.target.checked)} />
                          Print slip
                        </label>
                      </div>

                      <div className="mt-4 flex justify-end">
                        <button
                          type="button"
                          onClick={handleDueSettlement}
                          disabled={settleSubmitting || Number((billing.amount_due ?? billing.outstanding) || 0) <= 0.009}
                          className="px-5 py-2.5 rounded-xl text-sm font-black text-white bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-300 disabled:cursor-not-allowed transition-colors"
                        >
                          {settleSubmitting ? 'Settling...' : 'Clear Due & Continue'}
                        </button>
                      </div>
                    </div>
                    )}

                    {!isSchemePatient && Number(billing.refund_due) > 0.009 && (
                    <div className="bg-white p-5 rounded-2xl border border-sky-200 shadow-sm">
                      <div className="flex items-center justify-between gap-4 mb-4">
                        <div>
                          <p className="text-sm font-black text-slate-800 tracking-tight">Record Refund to Patient</p>
                          <p className="text-xs text-slate-500 font-medium">Ledger shows overpayment. Record the payout so the account nets to zero before discharge.</p>
                        </div>
                        <p className="text-sm font-bold text-sky-800 bg-sky-50 border border-sky-200 rounded-lg px-3 py-1.5">
                          Refund: ₹{Number(billing.refund_due || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                        </p>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                        <select
                          value={settleMode}
                          onChange={e => setSettleMode(e.target.value)}
                          className="w-full bg-white border border-slate-200 rounded-xl p-3 text-sm font-semibold text-slate-700 focus:ring-4 focus:ring-sky-500/10 focus:border-sky-500 outline-none"
                        >
                          <option value="cash">Cash</option>
                          <option value="upi">UPI</option>
                          <option value="card">Card</option>
                          <option value="bank_transfer">Bank Transfer</option>
                          <option value="other">Other</option>
                        </select>
                        <input
                          value={settleRef}
                          onChange={e => setSettleRef(e.target.value)}
                          placeholder="Reference (optional)"
                          className="w-full bg-white border border-slate-200 rounded-xl p-3 text-sm font-medium text-slate-700 focus:ring-4 focus:ring-sky-500/10 focus:border-sky-500 outline-none"
                        />
                        <label className="flex items-center gap-2 text-sm font-bold text-slate-700 px-3 py-2.5 rounded-xl border border-slate-200 bg-slate-50">
                          <input type="checkbox" checked={settlePrint} onChange={e => setSettlePrint(e.target.checked)} />
                          Print slip
                        </label>
                      </div>

                      <div className="mt-4 flex justify-end">
                        <button
                          type="button"
                          onClick={handleRefundSettlement}
                          disabled={settleSubmitting || Number(billing.refund_due || 0) <= 0.009}
                          className="px-5 py-2.5 rounded-xl text-sm font-black text-white bg-sky-600 hover:bg-sky-700 disabled:bg-slate-300 disabled:cursor-not-allowed transition-colors"
                        >
                          {settleSubmitting ? 'Recording...' : 'Record Refund & Continue'}
                        </button>
                      </div>
                    </div>
                    )}

                    <div className="bg-amber-50/80 p-5 rounded-2xl border border-amber-200/80 flex items-start gap-4">
                      <div className="w-10 h-10 rounded-full bg-amber-100 text-amber-600 flex items-center justify-center shrink-0 shadow-inner">
                        <AlertTriangle size={18} strokeWidth={2.5} />
                      </div>
                      <div>
                        <p className="text-sm font-black text-amber-900 tracking-tight">Final Confirmation Notice</p>
                        <p className="text-xs text-amber-800/80 mt-1 font-medium leading-relaxed">Completing this step will permanently finalize the invoice, log the discharge summary, and release bed <strong className="bg-amber-200/50 px-1 py-0.5 rounded">{journey.admission.bed_code}</strong> for cleaning. Ensure any amount due is collected, any patient credit is refunded, or adjustments are made so the net balance is zero.</p>
                      </div>
                    </div>
                  </div>
                )}

                <div className={`pt-6 mt-2 border-t border-slate-200/60 flex flex-col-reverse sm:flex-row items-stretch sm:items-center justify-between gap-3 sm:gap-6 ${isMobile ? 'sticky bottom-0 z-30 bg-slate-50/95 backdrop-blur-md -mx-3 px-3 py-3 border-t border-slate-200' : ''}`}>
                  <button onClick={() => setJourney(j => ({ ...j, step: 'form' }))} className="px-4 sm:px-6 py-3 sm:py-3.5 rounded-2xl text-sm font-bold text-slate-500 hover:text-slate-800 hover:bg-slate-100 flex items-center justify-center gap-2 transition-colors active:scale-95">
                    <ArrowRight size={16} className="rotate-180" /> Back to Clinical
                  </button>
                  <button
                    type="button"
                    onClick={finalizeDischarge}
                    disabled={
                      submitting
                      || (
                        !isSchemePatient
                        && Math.abs(
                          parseAdmissionMoney(
                            billing?.net_balance ?? ((billing?.total_billed || 0) - (billing?.total_paid || 0)),
                          ),
                        ) > 0.009
                      )
                    }
                    className={`w-full sm:flex-1 py-3.5 sm:py-4 text-white rounded-2xl font-black text-sm sm:text-base transition-all flex items-center justify-center gap-3 border ${
                      (
                        !isSchemePatient
                        && Math.abs(
                          parseAdmissionMoney(
                            billing?.net_balance ?? ((billing?.total_billed || 0) - (billing?.total_paid || 0)),
                          ),
                        ) > 0.009
                      )
                        ? 'bg-slate-400 border-slate-400 cursor-not-allowed'
                        : 'bg-gradient-to-br from-emerald-500 to-emerald-600 hover:from-emerald-600 hover:to-emerald-700 shadow-[0_8px_30px_rgba(16,185,129,0.3)] hover:shadow-[0_8px_40px_rgba(16,185,129,0.4)] hover:-translate-y-0.5 active:translate-y-0 group border-emerald-400'
                    }`}>
                    {submitting ? 'Finalizing Discharge...' : (
                      <>
                        Approve & Execute Discharge 
                        <CheckCircle size={22} className="group-hover:scale-110 drop-shadow-md transition-transform" />
                      </>
                    )}
                  </button>
                </div>
              </div>
            )}
            </div>
          </div>
        </div>
      </div>
      {dischargePreviewData && (
        <PrintDischargeSummary
          rec={dischargePreviewData.rec}
          admission={dischargePreviewData.admission}
          onClose={() => setDischargePreviewData(null)}
        />
      )}
      </>
    )
  }

  return (
    <>
    <div className={`fixed inset-0 z-[400] flex items-stretch sm:items-center justify-center ${isMobile ? 'p-0' : 'p-4'} bg-black/60 backdrop-blur-sm`}>
      <div className={`bg-white shadow-2xl w-full min-w-0 overflow-hidden flex flex-col ${isMobile ? 'h-[100dvh] max-h-[100dvh] rounded-none' : 'rounded-3xl max-w-[80vw] max-h-[92vh]'}`}>

        {/* Header */}
        <div className={`bg-gradient-to-r from-blue-700 to-blue-500 shadow-sm shrink-0 ${isMobile ? 'px-3 py-3' : 'px-6 py-4'}`}>
          <div className={`flex gap-3 ${isMobile ? 'flex-col' : 'items-center justify-between'}`}>
            <div className="flex items-start gap-3 min-w-0">
              <div className={`rounded-xl bg-white/20 flex items-center justify-center text-white shrink-0 ${isMobile ? 'w-9 h-9' : 'w-10 h-10'}`}>
                <Activity size={isMobile ? 18 : 20} strokeWidth={2.5} />
              </div>
              <div className="min-w-0 flex-1">
                <h3 className={`text-white font-bold leading-tight flex flex-wrap items-center gap-1.5 ${isMobile ? 'text-base' : 'text-lg'}`}>
                  <span className="truncate max-w-full">{admission.patient_name || '--'}</span>
                  <span className="bg-white/20 px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-widest shrink-0">
                    IPD: {admission.ipd_no || 'N/A'}
                  </span>
                  {admission.scheme_name ? (
                    <span className="bg-yellow-400 text-yellow-950 border border-yellow-300 px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-widest shadow-sm shrink-0">
                      {admission.scheme_name}
                    </span>
                  ) : null}
                </h3>
                <p className={`text-blue-100 font-medium ${isMobile ? 'text-[11px] mt-1 leading-relaxed' : 'text-xs text-blue-100/90'}`}>
                  UHID {admission.patient_uhid || 'N/A'}
                  {' · '}
                  Dr. {admission.assigned_doctor_name || '—'}
                  {' · '}
                  {admission.ward_name} / Bed {admission.bed_code}
                  {' · '}
                  Adm: {formatAdmissionDateLabel(admission.admission_date)}
                </p>
              </div>
              {isMobile ? (
                <button type="button" onClick={handleLedgerModalClose} className="text-white/80 hover:text-white shrink-0 self-start">
                  <XCircle size={22} strokeWidth={1.5} />
                </button>
              ) : null}
            </div>
            <div className={`flex items-center gap-2 ${isMobile ? 'flex-wrap w-full' : ''}`}>
              {String(admission.status || '').toLowerCase() === 'discharged' ? (
                <button type="button" onClick={openDischargeEditorForDischarged} className={`flex items-center justify-center gap-1.5 bg-emerald-600 text-white rounded-xl font-bold shadow-md hover:bg-emerald-700 transition-all border border-emerald-500 ${isMobile ? 'flex-1 min-w-[calc(50%-4px)] px-3 py-2 text-xs' : 'px-4 py-2 text-sm'}`}>
                  <Edit2 size={isMobile ? 14 : 16} /> {isMobile ? 'Edit summary' : 'Edit discharge summary'}
                </button>
              ) : (
                <button type="button" onClick={handleInitiateDischarge} className={`flex items-center justify-center gap-1.5 bg-red-500 text-white rounded-xl font-bold shadow-md hover:bg-red-600 transition-all border border-red-400 ${isMobile ? 'flex-1 min-w-[calc(50%-4px)] px-3 py-2 text-xs' : 'px-4 py-2 text-sm'}`}>
                  <LogOut size={isMobile ? 14 : 16} /> {isMobile ? 'Discharge' : 'Discharge Patient'}
                </button>
              )}
              <button type="button" onClick={() => setShowPrint(true)} className={`flex items-center justify-center gap-1.5 bg-white/20 hover:bg-white/30 text-white rounded-xl font-bold transition-colors ${isMobile ? 'flex-1 min-w-[calc(50%-4px)] px-3 py-2 text-xs' : 'px-4 py-2 text-sm'}`}>
                <Printer size={isMobile ? 14 : 16} /> {isMobile ? 'Print bill' : 'Print A4 Bill'}
              </button>
              {!isMobile ? (
                <button type="button" onClick={handleLedgerModalClose} className="text-white/70 hover:text-white transition-colors">
                  <XCircle size={24} strokeWidth={1.5} />
                </button>
              ) : null}
            </div>
          </div>
        </div>

        {loading ? (
          <div className="flex-1 flex items-center justify-center py-20">
            <RefreshCw size={24} className="text-blue-500 animate-spin" />
          </div>
        ) : ledger ? (
          <div className={`flex-1 overflow-y-auto min-h-0 grid grid-cols-1 lg:grid-cols-5 gap-4 lg:gap-5 bg-gray-50/40 ${isMobile ? 'p-3 pb-6' : 'p-5'}`}>

            {/* ── Left: Account Statement (3 cols) ── */}
            <div className="lg:col-span-3 flex flex-col gap-4">
              {/* Summary cards */}
              {(() => {
                const chargesCount = (ledger.grouped_charges || []).length
                  + (ledger.charges || []).filter(c => c.type === 'room_rent').length
                const paidEvents = ledger.payments?.length || 0
                const isSchemeLedger = !!(admission?.scheme)
                const balance = isSchemeLedger ? 0 : parseFloat(ledger.balance_due || 0)
                const isDue = !isSchemeLedger && balance > 0
                const cards = [
                  {
                    label: 'Total Charges', val: ledger.total_charges, sub: `${chargesCount} item${chargesCount === 1 ? '' : 's'}`,
                    Icon: Receipt, color: 'text-gray-800', iconColor: 'text-blue-500', bg: 'bg-white', border: 'border-gray-200',
                  },
                  {
                    label: 'Total Paid', val: ledger.total_paid, sub: `${paidEvents} receipt${paidEvents === 1 ? '' : 's'}`,
                    Icon: CheckCircle, color: 'text-emerald-700', iconColor: 'text-emerald-500', bg: 'bg-emerald-50', border: 'border-emerald-200',
                  },
                  {
                    label: isSchemeLedger ? 'Under Scheme' : 'Balance Due',
                    val: isSchemeLedger ? 0 : ledger.balance_due,
                    sub: isSchemeLedger ? (admission.scheme_name || 'Final bill under scheme') : (isDue ? 'Outstanding' : 'Settled'),
                    Icon: isSchemeLedger ? CheckCircle : (isDue ? AlertTriangle : CheckCircle),
                    color: isSchemeLedger ? 'text-amber-800' : (isDue ? 'text-red-600' : 'text-emerald-600'),
                    iconColor: isSchemeLedger ? 'text-amber-600' : (isDue ? 'text-red-500' : 'text-emerald-500'),
                    bg: isSchemeLedger ? 'bg-amber-50' : (isDue ? 'bg-red-50' : 'bg-emerald-50'),
                    border: isSchemeLedger ? 'border-amber-200' : (isDue ? 'border-red-200' : 'border-emerald-200'),
                    big: true,
                  },
                ]
                return (
                  <div className={`grid gap-2 sm:gap-3 ${isMobile ? 'grid-cols-1' : 'grid-cols-3'}`}>
                    {cards.map(s => {
                      const Icon = s.Icon
                        const isTotalPaid = s.label === 'Total Paid'
                      return (
                        <div
                          key={s.label}
                          role={isTotalPaid ? 'button' : undefined}
                          tabIndex={isTotalPaid ? 0 : undefined}
                          onClick={isTotalPaid ? () => setShowReceiptsModal(true) : undefined}
                          onKeyDown={e => {
                            if (!isTotalPaid) return
                            if (e.key === 'Enter' || e.key === ' ') setShowReceiptsModal(true)
                          }}
                          className={`${s.bg} border ${s.border} rounded-2xl shadow-sm ${isMobile ? 'p-3.5 flex items-center justify-between gap-3' : 'p-3'} ${isTotalPaid ? 'cursor-pointer hover:shadow-md transition-shadow' : ''}`}
                        >
                          {isMobile ? (
                            <>
                              <div className="min-w-0">
                                <div className="flex items-center gap-1.5 mb-0.5">
                                  <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wide">{s.label}</p>
                                  <Icon size={14} className={s.iconColor} />
                                </div>
                                <p className="text-[10px] font-medium text-gray-500">{s.sub}</p>
                              </div>
                              <p className={`text-xl font-black ${s.color} tabular-nums leading-tight shrink-0`}>
                                ₹{parseFloat(s.val || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                              </p>
                            </>
                          ) : (
                          <>
                          <div className="flex items-center justify-between mb-1">
                            <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wide">{s.label}</p>
                            <Icon size={14} className={s.iconColor} />
                          </div>
                          <p className={`${s.big ? 'text-2xl' : 'text-xl'} font-black ${s.color} text-right tabular-nums leading-tight`}>
                            ₹{parseFloat(s.val || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                          </p>
                          <p className="text-[10px] font-medium text-gray-500 text-right mt-0.5">{s.sub}</p>
                          </>
                          )}
                        </div>
                      )
                    })}
                  </div>
                )
              })()}

              {showReceiptsModal && (
                <div
                  className={`fixed inset-0 z-[650] flex bg-black/60 backdrop-blur-sm ${isMobile ? 'items-stretch p-0' : 'items-center justify-center p-4'}`}
                  onClick={() => setShowReceiptsModal(false)}
                >
                  <div
                    className={`bg-white shadow-2xl w-full min-w-0 overflow-hidden flex flex-col ${isMobile ? 'h-[100dvh] max-h-[100dvh] rounded-none' : 'rounded-2xl max-w-[75vw]'}`}
                    onClick={e => e.stopPropagation()}
                  >
                    <div className="px-4 py-3 bg-emerald-600 text-white flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <CreditCard size={16} />
                        <div>
                          <div className="font-bold text-sm leading-tight">Receipts</div>
                          <div className="text-[11px] text-white/80">{paidReceipts.length} receipt{paidReceipts.length === 1 ? '' : 's'}</div>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => setShowReceiptsModal(false)}
                        className="bg-white/15 hover:bg-white/25 px-3 py-1 rounded-lg font-bold text-sm"
                      >
                        Close
                      </button>
                    </div>

                    <div className="p-4">
                      <div className="overflow-x-auto min-w-0">
                        <table className="w-full min-w-[640px] table-fixed text-xs border border-gray-200 rounded-lg overflow-hidden">
                          <colgroup>
                            <col className="w-[17%]" />
                            <col className="w-[30%]" />
                            <col className="w-[11%]" />
                            <col className="w-[12%]" />
                            <col className="w-[14%]" />
                            <col style={{ width: 300 }} />
                          </colgroup>
                          <thead className="bg-gray-50 text-gray-500 uppercase text-[10px] font-bold">
                            <tr>
                              <th className="px-3 py-2 text-left">Date &amp; time</th>
                              <th className="px-3 py-2 text-left">Description</th>
                              <th className="px-3 py-2 text-center">Status</th>
                              <th className="px-3 py-2 text-right">Amount</th>
                              <th className="px-3 py-2 text-left">Ref</th>
                              <th className="px-3 py-2 text-center align-middle">Actions</th>
                            </tr>
                          </thead>
                          <tbody>
                            {paidReceipts.length === 0 ? (
                              <tr>
                                <td colSpan={6} className="px-3 py-6 text-center text-gray-400">
                                  No receipts found.
                                </td>
                              </tr>
                            ) : (
                              paidReceipts.map((r) => {
                                const invSt = String(r.invoice_status || 'finalized').toLowerCase()
                                const isVoidReceipt = r.status === 'cancelled' || invSt === 'cancelled'
                                const canMutateLedgerPayment = r.rowKind === 'payment' && r.status !== 'cancelled' && invSt === 'finalized' && r.paymentTransactionId
                                return (
                                <tr key={r.id} className={`border-t border-gray-100 hover:bg-emerald-50/30 ${isVoidReceipt ? 'bg-slate-50/80 opacity-90' : ''}`}>
                                  <td className="px-3 py-2.5 whitespace-nowrap text-gray-600">
                                    {formatReceiptDateTime(r.date)}
                                  </td>
                                  <td className="px-3 py-2.5 text-gray-800 font-medium min-w-0 truncate" title={r.description || ''}>{r.description || '—'}</td>
                                  <td className="px-3 py-2.5 text-center whitespace-nowrap">
                                    {isVoidReceipt ? (
                                      <span className="text-[9px] font-black uppercase tracking-wide text-red-700 bg-red-100 px-2 py-0.5 rounded">Cancelled</span>
                                    ) : (
                                      <span className="text-[9px] font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded">Active</span>
                                    )}
                                  </td>
                                  <td className="px-3 py-2.5 text-right text-emerald-700 font-bold whitespace-nowrap">₹{parseFloat(r.amount || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                                  <td className="px-3 py-2.5 text-gray-600 whitespace-nowrap">{r.invoice_no || '—'}</td>
                                  <td className="px-2 py-2.5 text-center align-middle w-[300px] max-w-[300px] min-w-[300px] overflow-visible relative z-[1]">
                                    <div className="flex flex-nowrap items-center justify-center gap-1.5 py-0.5 w-full min-w-0">
                                      <button
                                        type="button"
                                        onClick={() => {
                                          setShowReceiptsModal(false)
                                          setReceipt({
                                            viewOnly: true,
                                            type: r.receiptKind === 'refund' ? 'refund' : r.receiptKind === 'advance' ? 'advance' : 'charge',
                                            data: {
                                              ...buildPaymentSlipReceiptLine({
                                                description: r.description,
                                                quantity: 1,
                                                unit_price: Math.abs(r.amount),
                                                amount: Math.abs(r.amount),
                                              }),
                                              mode: r.mode,
                                              invoice_no: r.invoice_no,
                                              slip_number: r.slip_number || '',
                                              paid_at: r.date,
                                            },
                                          })
                                        }}
                                        title="View"
                                        aria-label="View receipt"
                                        className="h-8 w-8 hover:w-[72px] shrink-0 flex items-center justify-center gap-1 overflow-hidden text-indigo-600 hover:text-white bg-indigo-50 hover:bg-indigo-600 rounded-lg transition-all duration-150 border border-indigo-100 shadow-sm hover:shadow-md active:scale-95 group"
                                      >
                                        <Eye size={13} className="group-hover:scale-110 transition-transform shrink-0" />
                                        <span className="max-w-0 opacity-0 translate-x-1 group-hover:max-w-[40px] group-hover:opacity-100 group-hover:translate-x-0 transition-all duration-150 text-[10px] font-black uppercase tracking-widest whitespace-nowrap">View</span>
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => {
                                          setShowReceiptsModal(false)
                                          setReceipt({
                                            viewOnly: isVoidReceipt,
                                            type: r.receiptKind === 'refund' ? 'refund' : r.receiptKind === 'advance' ? 'advance' : 'charge',
                                            data: {
                                              ...buildPaymentSlipReceiptLine({
                                                description: r.description,
                                                quantity: 1,
                                                unit_price: Math.abs(r.amount),
                                                amount: Math.abs(r.amount),
                                              }),
                                              mode: r.mode,
                                              invoice_no: r.invoice_no,
                                              slip_number: r.slip_number || '',
                                              paid_at: r.date,
                                            },
                                          })
                                        }}
                                        title="Print"
                                        aria-label="Print receipt"
                                        className="h-8 w-8 hover:w-[74px] shrink-0 flex items-center justify-center gap-1 overflow-hidden rounded-lg transition-all duration-150 border shadow-sm hover:shadow-md active:scale-95 group text-sky-600 hover:text-white bg-sky-50 hover:bg-sky-600 border-sky-100"
                                      >
                                        <Printer size={13} className="group-hover:scale-110 transition-transform shrink-0" />
                                        <span className="max-w-0 opacity-0 translate-x-1 group-hover:max-w-[44px] group-hover:opacity-100 group-hover:translate-x-0 transition-all duration-150 text-[10px] font-black uppercase tracking-widest whitespace-nowrap">Print</span>
                                      </button>
                                      {canMutateLedgerPayment ? (
                                        <>
                                          <button
                                            type="button"
                                            onClick={() => openLedgerEditPayment(r.paymentTransactionId)}
                                            title="Edit"
                                            aria-label="Edit payment"
                                            className="h-8 w-8 hover:w-[68px] shrink-0 flex items-center justify-center gap-1 overflow-hidden text-emerald-600 hover:text-white bg-emerald-50 hover:bg-emerald-600 rounded-lg transition-all duration-150 border border-emerald-100 shadow-sm hover:shadow-md active:scale-95 group"
                                          >
                                            <Edit2 size={13} className="group-hover:scale-110 transition-transform shrink-0" />
                                            <span className="max-w-0 opacity-0 translate-x-1 group-hover:max-w-[36px] group-hover:opacity-100 group-hover:translate-x-0 transition-all duration-150 text-[10px] font-black uppercase tracking-widest whitespace-nowrap">Edit</span>
                                          </button>
                                          <button
                                            type="button"
                                            onClick={() => { setLedgerCancelPayment(r); setLedgerCancelPaymentReason('') }}
                                            title="Cancel"
                                            aria-label="Cancel payment"
                                            className="h-8 w-8 hover:w-[84px] shrink-0 flex items-center justify-center gap-1 overflow-hidden text-red-600 hover:text-white bg-red-50 hover:bg-red-600 rounded-lg transition-all duration-150 border border-red-100 shadow-sm hover:shadow-md active:scale-95 group"
                                          >
                                            <X size={13} className="group-hover:scale-110 transition-transform shrink-0" />
                                            <span className="max-w-0 opacity-0 translate-x-1 group-hover:max-w-[52px] group-hover:opacity-100 group-hover:translate-x-0 transition-all duration-150 text-[10px] font-black uppercase tracking-widest whitespace-nowrap">Cancel</span>
                                          </button>
                                        </>
                                      ) : null}
                                    </div>
                                  </td>
                                </tr>
                                )
                              })
                            )}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {ledgerCancelPayment && (
                <div
                  className="fixed inset-0 z-[660] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
                  onClick={() => { if (!ledgerCancellingPayment) { setLedgerCancelPayment(null); setLedgerCancelPaymentReason('') } }}
                >
                  <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden" onClick={e => e.stopPropagation()}>
                    <div className="px-4 py-3 bg-red-600 text-white flex items-center justify-between">
                      <h3 className="font-bold">Cancel payment receipt</h3>
                      <button type="button" onClick={() => { if (!ledgerCancellingPayment) { setLedgerCancelPayment(null); setLedgerCancelPaymentReason('') } }} className="text-white/80 hover:text-white" disabled={ledgerCancellingPayment}><X size={18} /></button>
                    </div>
                    <div className="p-4 space-y-3">
                      <p className="text-sm text-gray-700">
                        Cancelling payment for <span className="font-black">{ledgerCancelPayment.invoice_no || '—'}</span>
                        {' · '}
                        <span className="font-semibold">₹{parseFloat(ledgerCancelPayment.amount || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
                      </p>
                      <div>
                        <label className="block text-xs font-bold text-gray-600 mb-1">Cancellation reason *</label>
                        <textarea
                          value={ledgerCancelPaymentReason}
                          onChange={e => setLedgerCancelPaymentReason(e.target.value)}
                          onKeyDown={e => handleCancelReasonKeyDown(e, submitLedgerCancelPayment, { disabled: ledgerCancellingPayment })}
                          rows={4}
                          className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:border-red-500 focus:ring-1 focus:ring-red-500 outline-none resize-none"
                          placeholder="Enter reason"
                          disabled={ledgerCancellingPayment}
                        />
                      </div>
                    </div>
                    <div className="p-4 border-t border-gray-100 flex justify-end gap-2 bg-gray-50">
                      <button type="button" onClick={() => { if (!ledgerCancellingPayment) { setLedgerCancelPayment(null); setLedgerCancelPaymentReason('') } }} disabled={ledgerCancellingPayment} className="px-4 py-2 rounded-xl text-sm font-bold text-gray-600 hover:bg-gray-200">Close</button>
                      <button type="button" onClick={submitLedgerCancelPayment} disabled={ledgerCancellingPayment} className="px-4 py-2 rounded-xl text-sm font-bold bg-red-600 text-white hover:bg-red-700">{ledgerCancellingPayment ? 'Cancelling…' : 'Confirm cancel'}</button>
                    </div>
                  </div>
                </div>
              )}

              {ledgerCancelInvoice && (
                <div
                  className="fixed inset-0 z-[660] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
                  onClick={() => { if (!ledgerCancellingInvoice) { setLedgerCancelInvoice(null); setLedgerCancelInvoiceReason('') } }}
                >
                  <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden" onClick={e => e.stopPropagation()}>
                    <div className="px-4 py-3 bg-red-600 text-white flex items-center justify-between">
                      <h3 className="font-bold">Cancel invoice / service slip</h3>
                      <button type="button" onClick={() => { if (!ledgerCancellingInvoice) { setLedgerCancelInvoice(null); setLedgerCancelInvoiceReason('') } }} className="text-white/80 hover:text-white" disabled={ledgerCancellingInvoice}><X size={18} /></button>
                    </div>
                    <div className="p-4 space-y-3">
                      <p className="text-sm text-gray-700">
                        Cancelling invoice <span className="font-black">{ledgerCancelInvoice.label || '—'}</span>. Linked successful payments will be voided.
                      </p>
                      <div>
                        <label className="block text-xs font-bold text-gray-600 mb-1">Cancellation reason *</label>
                        <textarea
                          value={ledgerCancelInvoiceReason}
                          onChange={e => setLedgerCancelInvoiceReason(e.target.value)}
                          onKeyDown={e => handleCancelReasonKeyDown(e, submitLedgerCancelInvoice, { disabled: ledgerCancellingInvoice })}
                          rows={4}
                          className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:border-red-500 focus:ring-1 focus:ring-red-500 outline-none resize-none"
                          placeholder="Enter reason"
                          disabled={ledgerCancellingInvoice}
                        />
                      </div>
                    </div>
                    <div className="p-4 border-t border-gray-100 flex justify-end gap-2 bg-gray-50">
                      <button type="button" onClick={() => { if (!ledgerCancellingInvoice) { setLedgerCancelInvoice(null); setLedgerCancelInvoiceReason('') } }} disabled={ledgerCancellingInvoice} className="px-4 py-2 rounded-xl text-sm font-bold text-gray-600 hover:bg-gray-200">Close</button>
                      <button type="button" onClick={submitLedgerCancelInvoice} disabled={ledgerCancellingInvoice} className="px-4 py-2 rounded-xl text-sm font-bold bg-red-600 text-white hover:bg-red-700">{ledgerCancellingInvoice ? 'Cancelling…' : 'Confirm cancel'}</button>
                    </div>
                  </div>
                </div>
              )}

              {ledgerEditingPayment && (
                <div className="fixed inset-0 z-[660] bg-gray-900/40 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => !ledgerSavingPayment && setLedgerEditingPayment(null)}>
                  <form onSubmit={handleLedgerSavePayment} className="bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden flex flex-col max-h-full" onClick={e => e.stopPropagation()}>
                    <div className="bg-emerald-600 px-4 py-3 flex items-center justify-between">
                      <h2 className="text-white font-bold">Edit payment slip</h2>
                      <button type="button" onClick={() => !ledgerSavingPayment && setLedgerEditingPayment(null)} className="text-white/80 hover:text-white"><X size={18} /></button>
                    </div>
                    <div className="p-4 overflow-y-auto space-y-4">
                      <div>
                        <label className="block text-xs font-bold text-gray-600 mb-1">Paid at</label>
                        <input type="datetime-local" value={ledgerEditingPayment.paid_at || ''} onChange={e => setLedgerEditingPayment({ ...ledgerEditingPayment, paid_at: e.target.value })} className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm outline-none" />
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="block text-xs font-bold text-gray-600 mb-1">Amount</label>
                          <input type="number" step="0.01" value={ledgerEditingPayment.amount ?? ''} onChange={e => setLedgerEditingPayment({ ...ledgerEditingPayment, amount: e.target.value })} className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm outline-none" />
                        </div>
                        <div>
                          <label className="block text-xs font-bold text-gray-600 mb-1">Payment mode</label>
                          <select value={ledgerEditingPayment.payment_mode || 'cash'} onChange={e => setLedgerEditingPayment({ ...ledgerEditingPayment, payment_mode: e.target.value })} className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm outline-none">
                            <option value="cash">Cash</option>
                            <option value="upi">UPI</option>
                            <option value="card">Card</option>
                            <option value="bank_transfer">Bank transfer</option>
                            <option value="other">Other</option>
                          </select>
                        </div>
                      </div>
                      <div>
                        <label className="block text-xs font-bold text-gray-600 mb-1">Transaction reference</label>
                        <input type="text" value={ledgerEditingPayment.transaction_reference || ''} onChange={e => setLedgerEditingPayment({ ...ledgerEditingPayment, transaction_reference: e.target.value })} className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm outline-none" />
                      </div>
                      <div>
                        <label className="block text-xs font-bold text-gray-600 mb-1">Receipt number</label>
                        <input type="text" value={ledgerEditingPayment.receipt_no || ''} onChange={e => setLedgerEditingPayment({ ...ledgerEditingPayment, receipt_no: e.target.value })} className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm outline-none" />
                      </div>
                      <div>
                        <label className="block text-xs font-bold text-gray-600 mb-1">Status</label>
                        <select value={ledgerEditingPayment.status || 'success'} onChange={e => setLedgerEditingPayment({ ...ledgerEditingPayment, status: e.target.value })} className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm outline-none">
                          <option value="success">Success</option>
                          <option value="pending">Pending</option>
                          <option value="failed">Failed</option>
                          <option value="cancelled">Cancelled</option>
                        </select>
                      </div>
                    </div>
                    <div className="p-4 border-t border-gray-100 flex gap-2 justify-end bg-gray-50">
                      <button type="button" onClick={() => !ledgerSavingPayment && setLedgerEditingPayment(null)} className="px-4 py-2 rounded-xl text-sm font-bold text-gray-600 hover:bg-gray-200">Close</button>
                      <button type="submit" disabled={ledgerSavingPayment} className="px-4 py-2 rounded-xl text-sm font-bold bg-emerald-600 text-white hover:bg-emerald-700">{ledgerSavingPayment ? 'Saving…' : 'Save'}</button>
                    </div>
                  </form>
                </div>
              )}

              {ledgerEditingCharge && (
                <div className="fixed inset-0 z-[660] bg-gray-900/40 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => !ledgerSavingCharge && setLedgerEditingCharge(null)}>
                  <form onSubmit={handleLedgerSaveCharge} className="bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden" onClick={e => e.stopPropagation()}>
                    <div className="bg-blue-600 px-4 py-3 flex items-center justify-between text-white">
                      <h2 className="font-bold">{ledgerEditingCharge.invoice_id === 'room_rent' ? 'Edit room rent' : 'Edit charge'}</h2>
                      <button type="button" onClick={() => !ledgerSavingCharge && setLedgerEditingCharge(null)}><X size={18} /></button>
                    </div>
                    <div className="p-4 space-y-3">
                      <div>
                        <label className="block text-xs font-bold text-gray-600 mb-1">Item name</label>
                        <input
                          type="text"
                          maxLength={300}
                          value={ledgerEditingCharge.description}
                          onChange={(e) => setLedgerEditingCharge({
                            ...ledgerEditingCharge,
                            description: e.target.value,
                          })}
                          className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm outline-none focus:border-blue-400"
                          placeholder="e.g. Room Rent, Bed charges, X-Ray"
                          required
                        />
                      </div>
                      {ledgerEditingCharge.invoice_id === 'room_rent' && (
                        <p className="text-[11px] text-blue-800 bg-blue-50 border border-blue-100 rounded-lg px-3 py-2 leading-snug">
                          Edit the <span className="font-bold">bed charge per day</span> and <span className="font-bold">stay days</span> counted for bed charges. Total room rent is daily rate × stay days. Reset restores the bed&apos;s default rate and auto-calculated days from admission dates.
                          {ledger?.room_rent_computed != null && (
                            <span className="block mt-1 text-blue-900/90">System total (reference): ₹{parseFloat(ledger.room_rent_computed || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
                          )}
                        </p>
                      )}
                      {ledgerEditingCharge.invoice_id === 'room_rent' ? (
                        <>
                          <div>
                            <label className="block text-xs font-bold text-gray-600 mb-1">Bed / room charge per day (₹)</label>
                            <input
                              type="number"
                              step="0.01"
                              min="0"
                              value={ledgerEditingCharge.unit_price}
                              onChange={(e) => {
                                const unit = e.target.value
                                const days = Math.max(1, parseFloat(String(ledgerEditingCharge.quantity || ledger?.days || 1)) || 1)
                                const tot = (parseFloat(unit) || 0) * days
                                setLedgerEditingCharge({
                                  ...ledgerEditingCharge,
                                  unit_price: unit,
                                  amount: Number.isFinite(tot) ? String(tot.toFixed(2)) : '',
                                })
                              }}
                              className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm outline-none"
                              required
                            />
                          </div>
                          <div>
                            <label className="block text-xs font-bold text-gray-600 mb-1">Stay days</label>
                            <input
                              type="number"
                              step="1"
                              min="1"
                              value={ledgerEditingCharge.quantity}
                              onChange={(e) => {
                                const raw = e.target.value
                                const days = Math.max(1, parseInt(String(raw), 10) || 1)
                                const unit = parseFloat(String(ledgerEditingCharge.unit_price)) || 0
                                const tot = unit * days
                                setLedgerEditingCharge({
                                  ...ledgerEditingCharge,
                                  quantity: raw === '' ? '' : String(days),
                                  amount: Number.isFinite(tot) ? String(tot.toFixed(2)) : '',
                                })
                              }}
                              className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm outline-none focus:border-blue-400"
                              required
                            />
                          </div>
                          <div>
                            <label className="block text-xs font-bold text-gray-600 mb-1">Total room rent (₹)</label>
                            <input
                              type="text"
                              readOnly
                              value={(() => {
                                const days = Math.max(1, parseFloat(String(ledgerEditingCharge.quantity || ledger?.days || 1)) || 1)
                                const u = parseFloat(String(ledgerEditingCharge.unit_price)) || 0
                                return (u * days).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
                              })()}
                              className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm outline-none bg-gray-50 text-gray-800 font-semibold"
                            />
                          </div>
                        </>
                      ) : (
                        <>
                          <div className="grid grid-cols-2 gap-3">
                            <div>
                              <label className="block text-xs font-bold text-gray-600 mb-1">Qty</label>
                              <input
                                type="number"
                                step="0.01"
                                min="0.01"
                                value={ledgerEditingCharge.quantity}
                                onChange={(e) => {
                                  const quantity = e.target.value
                                  const unitPrice = parseFloat(String(ledgerEditingCharge.unit_price)) || 0
                                  const total = (parseFloat(quantity) || 0) * unitPrice
                                  setLedgerEditingCharge({
                                    ...ledgerEditingCharge,
                                    quantity,
                                    amount: Number.isFinite(total) ? String(total.toFixed(2)) : '',
                                  })
                                }}
                                className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm outline-none"
                                required
                              />
                            </div>
                            <div>
                              <label className="block text-xs font-bold text-gray-600 mb-1">Unit price (₹)</label>
                              <input
                                type="number"
                                step="0.01"
                                min="0.01"
                                value={ledgerEditingCharge.unit_price}
                                onChange={(e) => {
                                  const unitPrice = e.target.value
                                  const quantity = parseFloat(String(ledgerEditingCharge.quantity)) || 0
                                  const total = quantity * (parseFloat(unitPrice) || 0)
                                  setLedgerEditingCharge({
                                    ...ledgerEditingCharge,
                                    unit_price: unitPrice,
                                    amount: Number.isFinite(total) ? String(total.toFixed(2)) : '',
                                  })
                                }}
                                className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm outline-none"
                                required
                              />
                            </div>
                          </div>
                          <div>
                            <label className="block text-xs font-bold text-gray-600 mb-1">Line amount (₹)</label>
                            <input
                              type="text"
                              readOnly
                              value={(() => {
                                const quantity = parseFloat(String(ledgerEditingCharge.quantity)) || 0
                                const unitPrice = parseFloat(String(ledgerEditingCharge.unit_price)) || 0
                                return (quantity * unitPrice).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
                              })()}
                              className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm outline-none bg-gray-50 text-gray-800 font-semibold"
                            />
                          </div>
                        </>
                      )}
                    </div>
                    <div className="p-4 border-t flex flex-wrap justify-end gap-2 bg-gray-50">
                      {ledgerEditingCharge.invoice_id === 'room_rent' && (ledger?.room_rent_override != null || ledger?.room_rent_daily_charge_override != null) && (
                        <button
                          type="button"
                          onClick={clearRoomRentOverride}
                          disabled={ledgerSavingCharge}
                          className="px-4 py-2 rounded-xl text-sm font-bold text-amber-800 bg-amber-100 hover:bg-amber-200 border border-amber-200 mr-auto"
                        >
                          Use calculated rent
                        </button>
                      )}
                      <button type="button" onClick={() => !ledgerSavingCharge && setLedgerEditingCharge(null)} className="px-4 py-2 rounded-xl text-sm font-bold text-gray-600 hover:bg-gray-200">Close</button>
                      <button type="submit" disabled={ledgerSavingCharge} className="px-4 py-2 rounded-xl text-sm font-bold bg-blue-600 text-white hover:bg-blue-700">{ledgerSavingCharge ? 'Saving…' : 'Save'}</button>
                    </div>
                  </form>
                </div>
              )}

              {/* Table */}
              <div className="bg-white border border-gray-200 rounded-2xl shadow-sm overflow-hidden flex flex-col flex-1">
                <div className="px-4 py-2.5 border-b border-gray-100 flex items-center justify-between bg-gray-50/60">
                  <span className="text-[11px] font-bold text-gray-500 uppercase tracking-wider flex items-center gap-1.5">
                    <FileText size={13} className="text-blue-500" /> Account Statement
                  </span>
                  <button onClick={fetchLedger} className="text-gray-400 hover:text-blue-500 transition-colors"><RefreshCw size={13} /></button>
                </div>
                <div className="overflow-x-auto flex-1 max-h-[60vh]">
                  <table className="w-full text-sm text-left">
                    <thead className="bg-gray-50 text-[10px] font-bold text-gray-500 uppercase tracking-wider border-b border-gray-200 sticky top-0 z-10 shadow-sm">
                      <tr>
                        <th className="px-2 py-2.5 w-8"></th>
                        <th className="px-4 py-2.5">Date &amp; time</th>
                        <th className="px-4 py-2.5">Description</th>
                        <th className="px-4 py-2.5 text-center">Qty/Days</th>
                        <th className="px-4 py-2.5 text-right">Charges (₹)</th>
                        <th className="px-4 py-2.5 text-right text-emerald-600">Paid (₹)</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {admissionLedgerStatementParts.map((part, idx) => {
                        if (part.kind === 'room') {
                          const item = part.row
                          const roomDays = Math.max(1, parseInt(String(ledger?.days ?? '1'), 10) || 1)
                          const roomRowId = String(item.id || 'room_rent')
                          const expanded = !!expandedChargeRows[roomRowId]
                          const amt = parseFloat(String(item.amount || '0')) || 0
                          const impliedDaily = roomDays > 0 ? amt / roomDays : amt
                          return (
                            <React.Fragment key={`room-${item.id || idx}`}>
                              <tr className="hover:bg-blue-50/40 transition-colors">
                                <td className="px-2 py-2.5 text-center">
                                  <button
                                    type="button"
                                    onClick={() => toggleChargeRowExpand(roomRowId)}
                                    className="text-gray-400 hover:text-blue-600 transition-colors"
                                    aria-expanded={expanded}
                                    aria-label={expanded ? 'Collapse room rent details' : 'Expand room rent details'}
                                  >
                                    {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                                  </button>
                                </td>
                                <td className="px-4 py-2.5 text-xs text-gray-500 whitespace-nowrap tabular-nums">{formatDateTime(item.date, { dateStyle: 'dd/MM/yy' })}</td>
                                <td className="px-4 py-2.5">
                                  <div className="flex items-center gap-1.5 flex-wrap min-w-0">
                                    <span className="text-[9px] bg-indigo-100 text-indigo-700 px-1.5 py-0.5 rounded font-bold shrink-0">RENT</span>
                                    <span className="text-xs font-semibold text-gray-800 min-w-0">{item.description}</span>
                                    {((ledger?.room_rent_override != null && ledger.room_rent_override !== '') ||
                                      (ledger?.room_rent_daily_charge_override != null && ledger.room_rent_daily_charge_override !== '')) ? (
                                      <span className="text-[9px] font-bold uppercase tracking-wide text-amber-800 bg-amber-100 border border-amber-200 px-1.5 py-0.5 rounded shrink-0">Adjusted</span>
                                    ) : null}
                                    {amt <= 0 ? (
                                      <span className="text-[9px] font-bold uppercase tracking-wide text-red-700 bg-red-100 border border-red-200 px-1.5 py-0.5 rounded shrink-0">Cancelled</span>
                                    ) : null}
                                  </div>
                                </td>
                                <td className="px-4 py-2.5 text-center text-xs font-bold text-slate-700 tabular-nums">{roomDays}</td>
                                <td className="px-4 py-2.5 text-right font-bold whitespace-nowrap text-gray-700 tabular-nums">{amt.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                                <td className="px-4 py-2.5 text-right text-gray-300">—</td>
                              </tr>
                              {expanded && (
                                <tr className="bg-slate-50/70">
                                  <td colSpan={6} className="px-4 py-3">
                                    <div className="space-y-2 border border-slate-200 bg-white rounded-xl p-3">
                                      <div className="flex items-center justify-between gap-3 border-b border-slate-100 pb-2 last:border-b-0 last:pb-0">
                                        <div className="min-w-0 flex-1">
                                          <p className="text-xs font-bold text-slate-800">{item.description}</p>
                                          <p className="text-[11px] text-slate-500 tabular-nums mt-1">
                                            {item.date ? formatReceiptDateTime(item.date) : '—'}
                                            {' · '}
                                            {roomDays} day(s)
                                            {' · '}
                                            Effective ₹{impliedDaily.toLocaleString('en-IN', { minimumFractionDigits: 2 })}/day
                                            {' · '}
                                            Total ₹{amt.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                                          </p>
                                          {(admission?.ward_name || admission?.room_name || admission?.bed_code) && (
                                            <p className="text-[11px] text-slate-600 mt-1">
                                              {admission.ward_name ? <span>Ward: {admission.ward_name}</span> : null}
                                              {admission.room_name ? <span>{admission.ward_name ? ' · ' : ''}Room: {admission.room_name}</span> : null}
                                              {admission.bed_code ? <span>{(admission.ward_name || admission.room_name) ? ' · ' : ''}Bed: {admission.bed_code}</span> : null}
                                            </p>
                                          )}
                                          {ledger?.room_rent_computed != null && (
                                            <p className="text-[11px] text-blue-700 mt-1 font-medium">
                                              System calculation: ₹{parseFloat(ledger.room_rent_computed || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                                            </p>
                                          )}
                                        </div>
                                        <div className="inline-flex flex-nowrap items-center gap-1.5 shrink-0 max-w-full overflow-x-auto py-0.5">
                                          {amt > 0 ? (
                                            <button
                                              type="button"
                                              onClick={cancelRoomRent}
                                              disabled={ledgerCancellingRoomRent}
                                              title="Cancel bed charges"
                                              aria-label="Cancel bed charges"
                                              className="h-8 w-8 hover:w-[76px] shrink-0 flex items-center justify-center gap-1 overflow-hidden text-red-600 hover:text-white bg-red-50 hover:bg-red-600 rounded-lg transition-all duration-150 border border-red-100 shadow-sm hover:shadow-md active:scale-95 group disabled:opacity-50"
                                            >
                                              <XCircle size={13} className="group-hover:scale-110 transition-transform shrink-0" />
                                              <span className="max-w-0 opacity-0 translate-x-1 group-hover:max-w-[44px] group-hover:opacity-100 group-hover:translate-x-0 transition-all duration-150 text-[10px] font-black uppercase tracking-widest whitespace-nowrap">Cancel</span>
                                            </button>
                                          ) : null}
                                          <button
                                            type="button"
                                            onClick={() => openLedgerEditRoomRent(item)}
                                            title="Edit amount"
                                            aria-label="Edit room rent amount"
                                            className="h-8 w-8 hover:w-[68px] shrink-0 flex items-center justify-center gap-1 overflow-hidden text-emerald-600 hover:text-white bg-emerald-50 hover:bg-emerald-600 rounded-lg transition-all duration-150 border border-emerald-100 shadow-sm hover:shadow-md active:scale-95 group"
                                          >
                                            <Edit2 size={13} className="group-hover:scale-110 transition-transform shrink-0" />
                                            <span className="max-w-0 opacity-0 translate-x-1 group-hover:max-w-[36px] group-hover:opacity-100 group-hover:translate-x-0 transition-all duration-150 text-[10px] font-black uppercase tracking-widest whitespace-nowrap">Edit</span>
                                          </button>
                                        </div>
                                      </div>
                                    </div>
                                  </td>
                                </tr>
                              )}
                            </React.Fragment>
                          )
                        }
                        const row = part.row
                        const expanded = !!expandedChargeRows[row.id]
                        const events = row.events || []
                        const latest = events[events.length - 1]
                        const totalAmount = parseFloat(row.total_amount || 0)
                        const totalPaid = parseFloat(row.total_paid || 0)
                        const isDiscount = totalAmount < 0
                        const isPaymentRow = totalPaid > 0 && totalAmount === 0
                        const isCancelledChargeGroup = String(row.description || '').includes('(Cancelled)')
                        let badge = null
                        if (isDiscount) badge = { label: 'DISCOUNT', cls: 'bg-amber-100 text-amber-700' }
                        else if (isPaymentRow) badge = { label: 'PAYMENT', cls: 'bg-emerald-100 text-emerald-700' }
                        else if (isCancelledChargeGroup) badge = { label: 'CANCELLED', cls: 'bg-red-100 text-red-700' }
                        else badge = { label: 'SERVICE', cls: 'bg-blue-100 text-blue-700' }
                        return (
                          <React.Fragment key={`grp-${row.id}-${idx}`}>
                            <tr className={`hover:bg-blue-50/40 transition-colors ${isDiscount ? 'bg-amber-50/40' : ''} ${isCancelledChargeGroup ? 'bg-slate-50/70 opacity-90' : ''}`}>
                              <td className="px-2 py-2.5 text-center">
                                <button onClick={() => toggleChargeRowExpand(row.id)} className="text-gray-400 hover:text-blue-600 transition-colors">
                                  {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                                </button>
                              </td>
                              <td className="px-4 py-2.5 text-xs text-gray-500 whitespace-nowrap tabular-nums">{latest?.date ? formatReceiptDateTime(latest.date) : <span className="text-gray-300">—</span>}</td>
                              <td className="px-4 py-2.5">
                                <div className="flex items-center gap-1.5 flex-wrap">
                                  <span className={`text-[9px] px-1.5 py-0.5 rounded font-bold ${badge.cls}`}>{badge.label}</span>
                                  <span className={`text-xs font-semibold ${isDiscount ? 'text-amber-700' : 'text-gray-800'}`}>{row.description}</span>
                                </div>
                              </td>
                              <td className="px-4 py-2.5 text-center text-xs font-bold text-slate-700 tabular-nums">{parseInt(row.quantity || 0, 10) || <span className="text-gray-300 font-normal">—</span>}</td>
                              <td className="px-4 py-2.5 text-right font-bold whitespace-nowrap text-gray-700 tabular-nums">
                                {totalAmount === 0 ? <span className="text-gray-300 font-normal">—</span> : parseFloat(totalAmount).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                              </td>
                              <td className="px-4 py-2.5 text-right font-bold text-emerald-600 whitespace-nowrap tabular-nums">
                                {totalPaid === 0 ? <span className="text-gray-300 font-normal">—</span> : parseFloat(totalPaid).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                              </td>
                            </tr>
                            {expanded && (
                              <tr className="bg-slate-50/70">
                                <td colSpan={6} className="px-4 py-3">
                                  <div className="space-y-2 border border-slate-200 bg-white rounded-xl p-3">
                                    {events.length === 0 ? (
                                      <p className="text-xs text-gray-400">No item logs available.</p>
                                    ) : events.map((ev, evIdx) => {
                                      const evInv = String(ev.invoice_status || '').toLowerCase()
                                      const isEvInvoiceCancelled = evInv === 'cancelled'
                                      const payEvents = Array.isArray(ev.payment_events)
                                        ? ev.payment_events.filter((payEv) => Number(parseFloat(payEv?.amount)) > 0)
                                        : []
                                      return (
                                      <div key={`${row.id}-event-${ev.id}-${evIdx}`} className={`space-y-2 border-b border-slate-100 last:border-b-0 pb-2 last:pb-0 ${isEvInvoiceCancelled ? 'opacity-90' : ''}`}>
                                        <div className="flex items-center justify-between gap-3">
                                        <div>
                                          <p className="text-xs font-bold text-slate-800">{ev.name || row.description}</p>
                                          <p className="text-[11px] text-slate-500 tabular-nums">
                                            {formatReceiptDateTime(ev.date)}
                                            {' · '}
                                            ₹{parseFloat(ev.price || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                                            {' · '}
                                            {(ev.payment_mode || 'credit').toUpperCase()}
                                            {' · Paid '}
                                            ₹{parseFloat(ev.paid_amount || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                                          </p>
                                          {isEvInvoiceCancelled && ev.cancelled_reason ? (
                                            <p className="text-[10px] text-red-600 mt-0.5 font-medium">Reason: {ev.cancelled_reason}</p>
                                          ) : null}
                                        </div>
                                        <div className="inline-flex flex-nowrap items-center gap-1.5 shrink-0 max-w-full overflow-x-auto py-0.5">
                                          {payEvents.length === 0 ? (
                                            <>
                                          <button
                                            type="button"
                                            onClick={() => setReceipt({
                                              viewOnly: true,
                                              type: 'charge',
                                              data: buildIpdLedgerReceiptData(ev, row.description),
                                            })}
                                            title="View"
                                            aria-label="View receipt"
                                            className="h-8 w-8 hover:w-[72px] shrink-0 flex items-center justify-center gap-1 overflow-hidden text-indigo-600 hover:text-white bg-indigo-50 hover:bg-indigo-600 rounded-lg transition-all duration-150 border border-indigo-100 shadow-sm hover:shadow-md active:scale-95 group"
                                          >
                                            <Eye size={13} className="group-hover:scale-110 transition-transform shrink-0" />
                                            <span className="max-w-0 opacity-0 translate-x-1 group-hover:max-w-[40px] group-hover:opacity-100 group-hover:translate-x-0 transition-all duration-150 text-[10px] font-black uppercase tracking-widest whitespace-nowrap">View</span>
                                          </button>
                                          <button
                                            type="button"
                                            onClick={() => setReceipt({
                                              viewOnly: isEvInvoiceCancelled,
                                              type: 'charge',
                                              data: buildIpdLedgerReceiptData(ev, row.description),
                                            })}
                                            title="Print"
                                            aria-label="Print receipt"
                                            className="h-8 w-8 hover:w-[74px] shrink-0 flex items-center justify-center gap-1 overflow-hidden rounded-lg transition-all duration-150 border shadow-sm hover:shadow-md active:scale-95 group text-sky-600 hover:text-white bg-sky-50 hover:bg-sky-600 border-sky-100"
                                          >
                                            <Printer size={13} className="group-hover:scale-110 transition-transform shrink-0" />
                                            <span className="max-w-0 opacity-0 translate-x-1 group-hover:max-w-[44px] group-hover:opacity-100 group-hover:translate-x-0 transition-all duration-150 text-[10px] font-black uppercase tracking-widest whitespace-nowrap">Print</span>
                                          </button>
                                            </>
                                          ) : null}
                                          {ev.invoice_id && evInv === 'finalized' ? (
                                            <>
                                              <button
                                                type="button"
                                                onClick={() => openLedgerEditChargeFromEvent(ev, row.description)}
                                                title="Edit"
                                                aria-label="Edit charge"
                                                className="h-8 w-8 hover:w-[68px] shrink-0 flex items-center justify-center gap-1 overflow-hidden text-emerald-600 hover:text-white bg-emerald-50 hover:bg-emerald-600 rounded-lg transition-all duration-150 border border-emerald-100 shadow-sm hover:shadow-md active:scale-95 group"
                                              >
                                                <Edit2 size={13} className="group-hover:scale-110 transition-transform shrink-0" />
                                                <span className="max-w-0 opacity-0 translate-x-1 group-hover:max-w-[36px] group-hover:opacity-100 group-hover:translate-x-0 transition-all duration-150 text-[10px] font-black uppercase tracking-widest whitespace-nowrap">Edit</span>
                                              </button>
                                              <button
                                                type="button"
                                                onClick={() => {
                                                  setLedgerCancelInvoice({
                                                    invoice_id: ev.invoice_id,
                                                    label: ev.invoice_no || ev.name || row.description,
                                                  })
                                                  setLedgerCancelInvoiceReason('')
                                                }}
                                                title="Cancel"
                                                aria-label="Cancel invoice"
                                                className="h-8 w-8 hover:w-[84px] shrink-0 flex items-center justify-center gap-1 overflow-hidden text-red-600 hover:text-white bg-red-50 hover:bg-red-600 rounded-lg transition-all duration-150 border border-red-100 shadow-sm hover:shadow-md active:scale-95 group"
                                              >
                                                <X size={13} className="group-hover:scale-110 transition-transform shrink-0" />
                                                <span className="max-w-0 opacity-0 translate-x-1 group-hover:max-w-[52px] group-hover:opacity-100 group-hover:translate-x-0 transition-all duration-150 text-[10px] font-black uppercase tracking-widest whitespace-nowrap">Cancel</span>
                                              </button>
                                            </>
                                          ) : null}
                                        </div>
                                        </div>
                                        {payEvents.map((payEv, payIdx) => (
                                          <div key={`${row.id}-event-${ev.id}-pay-${payEv.id || payIdx}`} className="flex items-center justify-between gap-3 rounded-lg border border-slate-100 bg-slate-50/80 px-3 py-2">
                                            <div>
                                              <p className="text-[11px] font-bold text-slate-800">Payment slip {payEv.slip_number || '—'}</p>
                                              <p className="text-[11px] text-slate-500 tabular-nums">
                                                {formatReceiptDateTime(payEv.date)}
                                                {' · Qty '}
                                                {parseFloat(payEv.quantity || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}
                                                {' · '}
                                                ₹{parseFloat(payEv.amount || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                                                {' · '}
                                                {(payEv.payment_mode || 'other').toUpperCase()}
                                              </p>
                                            </div>
                                            <div className="inline-flex flex-nowrap items-center gap-1.5 shrink-0">
                                              <button
                                                type="button"
                                                onClick={() => setReceipt({
                                                  viewOnly: true,
                                                  type: 'charge',
                                                  data: buildIpdLedgerReceiptData({ ...payEv, name: ev.name || row.description }, row.description),
                                                })}
                                                title="View payment slip"
                                                aria-label="View payment slip"
                                                className="h-8 w-8 hover:w-[72px] shrink-0 flex items-center justify-center gap-1 overflow-hidden text-indigo-600 hover:text-white bg-indigo-50 hover:bg-indigo-600 rounded-lg transition-all duration-150 border border-indigo-100 shadow-sm hover:shadow-md active:scale-95 group"
                                              >
                                                <Eye size={13} className="group-hover:scale-110 transition-transform shrink-0" />
                                                <span className="max-w-0 opacity-0 translate-x-1 group-hover:max-w-[40px] group-hover:opacity-100 group-hover:translate-x-0 transition-all duration-150 text-[10px] font-black uppercase tracking-widest whitespace-nowrap">View</span>
                                              </button>
                                              <button
                                                type="button"
                                                onClick={() => setReceipt({
                                                  viewOnly: isEvInvoiceCancelled,
                                                  type: 'charge',
                                                  data: buildIpdLedgerReceiptData({ ...payEv, name: ev.name || row.description }, row.description),
                                                })}
                                                title="Print payment slip"
                                                aria-label="Print payment slip"
                                                className="h-8 w-8 hover:w-[74px] shrink-0 flex items-center justify-center gap-1 overflow-hidden rounded-lg transition-all duration-150 border shadow-sm hover:shadow-md active:scale-95 group text-sky-600 hover:text-white bg-sky-50 hover:bg-sky-600 border-sky-100"
                                              >
                                                <Printer size={13} className="group-hover:scale-110 transition-transform shrink-0" />
                                                <span className="max-w-0 opacity-0 translate-x-1 group-hover:max-w-[44px] group-hover:opacity-100 group-hover:translate-x-0 transition-all duration-150 text-[10px] font-black uppercase tracking-widest whitespace-nowrap">Print</span>
                                              </button>
                                            </div>
                                          </div>
                                        ))}
                                      </div>
                                    )})}
                                  </div>
                                </td>
                              </tr>
                            )}
                          </React.Fragment>
                        )
                      })}
                      {admissionLedgerStatementParts.length === 0 && (
                        <tr>
                          <td colSpan={6} className="px-4 py-12 text-center text-xs text-gray-400">
                            No entries yet. Use the right panel to add charges, receive payments or apply a discount.
                          </td>
                        </tr>
                      )}
                    </tbody>
                    <tfoot>
                      <tr className="bg-gray-50 border-t border-gray-200 text-xs font-bold text-gray-600 uppercase sticky bottom-0">
                        <td colSpan={4} className="px-4 py-2.5 text-right">Total</td>
                        <td className="px-4 py-2.5 text-right text-gray-800 tabular-nums">₹{parseFloat(ledger.total_charges).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                        <td className="px-4 py-2.5 text-right text-emerald-600 tabular-nums">₹{parseFloat(ledger.total_paid).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </div>

              {/* Room rent discount shortcut (jumps to Discount mode in right panel) */}
              {parseFloat(ledger.room_rent) > 0 && (
                <button onClick={applyRoomRentDiscount}
                  className="self-start flex items-center gap-2 text-xs bg-amber-100 hover:bg-amber-200 text-amber-800 px-4 py-2 rounded-xl font-bold border border-amber-200 transition-colors">
                  <Tag size={13} /> Apply Room Rent Discount
                </button>
              )}
            </div>

            {/* ── Right: Action Panel (2 cols) ── */}
            <div className={`lg:col-span-2 space-y-4`}>

              {/* Mode Picker */}
              <div className="bg-white border border-gray-200 rounded-2xl shadow-sm overflow-hidden">
                <div className={`p-2 grid grid-cols-3 gap-2 bg-gray-50/70 border-b border-gray-100 ${isMobile ? 'sticky top-0 z-10' : ''}`}>
                  {[
                    { id: 'charge',   label: isMobile ? 'Charge' : 'Add Charge',    icon: Plus,         theme: 'blue'    },
                    { id: 'receive',  label: isMobile ? 'Receive' : 'Receive Money', icon: IndianRupee,  theme: 'emerald' },
                    { id: 'discount', label: 'Discount',      icon: Tag,          theme: 'amber'   },
                  ].map(seg => {
                    const active = mode === seg.id
                    const Icon = seg.icon
                    const themeMap = {
                      blue:    'bg-blue-600 text-white border-blue-600 shadow-md shadow-blue-200',
                      emerald: 'bg-emerald-600 text-white border-emerald-600 shadow-md shadow-emerald-200',
                      amber:   'bg-amber-500 text-white border-amber-500 shadow-md shadow-amber-200',
                    }
                    return (
                      <button
                        key={seg.id}
                        type="button"
                        onClick={() => setMode(seg.id)}
                        className={`py-2 px-2 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition-all border ${active ? themeMap[seg.theme] : 'bg-white text-gray-500 border-gray-200 hover:bg-gray-50 hover:text-gray-700'}`}
                      >
                        <Icon size={14} /> {seg.label}
                      </button>
                    )
                  })}
                </div>

                <div className="p-4">
                  {/* ─── Add Charge ─── */}
                  {mode === 'charge' && (
                    <form onSubmit={handleCharge} className="space-y-3">
                      <div ref={serviceComboboxRef} className="relative">
                        <label className="text-[10px] font-bold text-gray-500 uppercase">Description *</label>
                        <input
                          value={chgDesc}
                          onChange={e => {
                            const next = e.target.value
                            setChgDesc(next)
                            setIsServiceMenuOpen(true)
                            const exact = serviceOptions.find(
                              (opt) => opt.description.toLowerCase() === next.trim().toLowerCase()
                            )
                            if (exact) {
                              setSelectedExistingCharge(exact.id)
                            } else if (selectedExistingCharge) {
                              setSelectedExistingCharge('')
                            }
                            setHighlightedServiceIndex(0)
                          }}
                          onFocus={() => {
                            if (serviceOptions.length > 0) {
                              setIsServiceMenuOpen(true)
                              setHighlightedServiceIndex(0)
                            }
                          }}
                          onClick={() => {
                            if (serviceOptions.length > 0) {
                              setIsServiceMenuOpen(true)
                              setHighlightedServiceIndex(0)
                            }
                          }}
                          onKeyDown={(e) => {
                            if (!serviceOptions.length) return
                            if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && !isServiceMenuOpen) {
                              e.preventDefault()
                              setIsServiceMenuOpen(true)
                              setHighlightedServiceIndex(0)
                              return
                            }
                            if (!isServiceMenuOpen) return
                            if (e.key === 'ArrowDown') {
                              e.preventDefault()
                              setHighlightedServiceIndex((prev) =>
                                Math.min((prev < 0 ? 0 : prev + 1), Math.max(filteredServiceOptions.length - 1, 0))
                              )
                            } else if (e.key === 'ArrowUp') {
                              e.preventDefault()
                              setHighlightedServiceIndex((prev) => Math.max((prev < 0 ? 0 : prev - 1), 0))
                            } else if (e.key === 'Escape') {
                              e.preventDefault()
                              setIsServiceMenuOpen(false)
                              setHighlightedServiceIndex(-1)
                            } else if (e.key === 'Enter') {
                              if (isServiceMenuOpen) {
                                e.preventDefault()
                                if (highlightedServiceIndex >= 0 && filteredServiceOptions.length > 0) {
                                  handleSelectExistingCharge(filteredServiceOptions[highlightedServiceIndex].id)
                                } else {
                                  setIsServiceMenuOpen(false)
                                  setHighlightedServiceIndex(-1)
                                }
                              }
                            }
                          }}
                          required
                          placeholder="e.g. Doctor Visit, Surgery, Medicine"
                          className={`mt-1 ${inp}`}
                        />
                        {isServiceMenuOpen && serviceOptions.length > 0 && (
                          <div className="absolute z-20 mt-1 w-full rounded-xl border border-gray-200 bg-white shadow-lg max-h-52 overflow-auto">
                            {filteredServiceOptions.length > 0 ? (
                              filteredServiceOptions.map((opt, idx) => (
                                <button
                                  key={opt.id}
                                  type="button"
                                  onMouseDown={(e) => {
                                    e.preventDefault()
                                    handleSelectExistingCharge(opt.id)
                                  }}
                                  className={`w-full text-left px-3 py-2.5 border-b last:border-b-0 border-gray-100 ${
                                    idx === highlightedServiceIndex ? 'bg-blue-50' : 'hover:bg-gray-50'
                                  }`}
                                >
                                  <p className="text-sm font-semibold text-gray-800 truncate">{opt.description}</p>
                                  <p className="text-[11px] text-gray-500">
                                    {opt.quantity > 0 ? `Qty on this bill: ${opt.quantity}` : 'From previous bills'}
                                    {getServiceOptionUnitPrice(opt)
                                      ? ` · Last price: ₹${getServiceOptionUnitPrice(opt).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`
                                      : ''}
                                  </p>
                                </button>
                              ))
                            ) : (
                              <div className="px-3 py-2.5 text-xs text-gray-500">
                                No matching service - press Enter to use typed description
                              </div>
                            )}
                          </div>
                        )}
                        <p className="text-[10px] text-gray-400 mt-1 italic">
                          Click or type to search services from this bill, previous IPD bills, and payment slip services. You can also enter a new custom service.
                        </p>
                      </div>

                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="text-[10px] font-bold text-gray-500 uppercase">Qty *</label>
                          <input id="chg-qty-input" type="number" step="1" min="1" value={chgQty}
                            onChange={e => setChgQty(e.target.value)} required placeholder="1"
                            className={`mt-1 ${inp}`} />
                        </div>
                        <div>
                          <label className="text-[10px] font-bold text-gray-500 uppercase">Unit Price (₹) *</label>
                          <input id="chg-unit-input" type="number" step="0.01" min="0" value={chgUnitPrice}
                            onChange={e => setChgUnitPrice(e.target.value)} required placeholder="e.g. 500"
                            className={`mt-1 ${inp}`} />
                        </div>
                      </div>

                      <div className="flex items-center justify-between bg-blue-50 border border-blue-100 rounded-xl px-3 py-2">
                        <span className="text-[11px] font-bold text-blue-700 uppercase tracking-wider">Line Total</span>
                        <span className="text-base font-black text-blue-800 tabular-nums">
                          ₹{parseFloat(chgLineTotal || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                        </span>
                      </div>

                      <div>
                        <label className="text-[10px] font-bold text-gray-500 uppercase">Status *</label>
                        <div className="grid grid-cols-2 gap-2 mt-1">
                          {[
                            { val: 'due',  label: 'Add to Bill (Due)' },
                            { val: 'paid', label: 'Paid Now' },
                          ].map(s => (
                            <button key={s.val} type="button" onClick={() => setChgStatus(s.val)}
                              className={`py-2 rounded-xl text-xs font-bold border transition-colors ${chgStatus === s.val ? (s.val === 'paid' ? 'bg-emerald-600 text-white border-emerald-600' : 'bg-blue-600 text-white border-blue-600') : 'bg-gray-50 text-gray-600 border-gray-200 hover:border-blue-400'}`}>
                              {s.label}
                            </button>
                          ))}
                        </div>
                      </div>

                      {chgStatus === 'paid' && (
                        <div>
                          <label className="text-[10px] font-bold text-gray-500 uppercase">Payment Mode *</label>
                          <div className="grid grid-cols-4 gap-2 mt-1">
                            {['cash', 'upi', 'card', 'other'].map(m => (
                              <button key={m} type="button" onClick={() => setChgPaidMode(m)}
                                className={`py-2 rounded-xl text-xs font-bold border transition-colors capitalize ${chgPaidMode === m ? 'bg-emerald-600 text-white border-emerald-600' : 'bg-gray-50 text-gray-600 border-gray-200 hover:border-emerald-400'}`}>
                                {m}
                              </button>
                            ))}
                          </div>
                        </div>
                      )}

                      <label className="flex items-center gap-2 cursor-pointer text-sm text-gray-600 font-medium">
                        <input type="checkbox" checked={chgPrint} onChange={e => setChgPrint(e.target.checked)}
                          className="w-4 h-4 accent-blue-600 rounded" />
                        Print receipt after save
                      </label>
                      <button type="submit" disabled={submitting}
                        className="w-full py-3 rounded-xl bg-blue-600 text-white font-bold hover:bg-blue-700 active:scale-[0.98] transition-all flex items-center justify-center gap-2 shadow-sm text-sm disabled:opacity-60">
                        {submitting ? 'Saving…' : <><Plus size={16} /> Save Charge</>}
                      </button>
                    </form>
                  )}

                  {/* ─── Receive Money ─── */}
                  {mode === 'receive' && (
                    <form onSubmit={handleAdvance} className="space-y-3">
                      <div>
                        <label className="text-[10px] font-bold text-gray-500 uppercase">Amount (₹) *</label>
                        <input
                          type="text"
                          inputMode="decimal"
                          autoComplete="off"
                          value={advAmount}
                          onChange={e => {
                            const next = e.target.value
                            if (isAllowedMoneyInput(next)) setAdvAmount(next)
                          }}
                          required
                          placeholder="e.g. 5000.50"
                          className={`mt-1 ${inp}`}
                        />
                      </div>
                      <div>
                        <label className="text-[10px] font-bold text-gray-500 uppercase">Payment Mode *</label>
                        <div className="grid grid-cols-4 gap-2 mt-1">
                          {['cash', 'upi', 'card', 'other'].map(m => (
                            <button key={m} type="button" onClick={() => setAdvMode(m)}
                              className={`py-2 rounded-xl text-xs font-bold border transition-colors capitalize ${advMode === m ? 'bg-emerald-600 text-white border-emerald-600' : 'bg-gray-50 text-gray-600 border-gray-200 hover:border-emerald-400'}`}>
                              {m}
                            </button>
                          ))}
                        </div>
                      </div>
                      <div>
                        <label className="text-[10px] font-bold text-gray-500 uppercase">Reference / Txn ID</label>
                        <input value={advRef} onChange={e => setAdvRef(e.target.value)} placeholder="Optional (UPI Ref etc.)"
                          className={`mt-1 ${inp}`} />
                      </div>
                      <label className="flex items-center gap-2 cursor-pointer text-sm text-gray-600 font-medium">
                        <input type="checkbox" checked={advPrint} onChange={e => setAdvPrint(e.target.checked)}
                          className="w-4 h-4 accent-emerald-600 rounded" />
                        Print receipt after save
                      </label>
                      <button type="submit" disabled={submitting}
                        className="w-full py-3 rounded-xl bg-emerald-600 text-white font-bold hover:bg-emerald-700 active:scale-[0.98] transition-all flex items-center justify-center gap-2 shadow-sm text-sm disabled:opacity-60">
                        {submitting ? 'Saving…' : <><IndianRupee size={16} /> Save Payment</>}
                      </button>
                    </form>
                  )}

                  {/* ─── Apply Discount ─── */}
                  {mode === 'discount' && (
                    <form onSubmit={handleDiscount} className="space-y-3">
                      <div className="flex items-start gap-2 p-2.5 rounded-xl bg-amber-50 border border-amber-100">
                        <Tag size={14} className="text-amber-600 mt-0.5" />
                        <p className="text-[11px] text-amber-800 font-medium leading-snug">
                          Discount is added as a negative line so it subtracts from the total bill.
                        </p>
                      </div>
                      <div>
                        <label className="text-[10px] font-bold text-gray-500 uppercase">Reason *</label>
                        <input value={discReason} onChange={e => setDiscReason(e.target.value)} required
                          placeholder="e.g. Senior Citizen Discount, Room Rent Concession"
                          className={`mt-1 ${inp}`} />
                      </div>
                      <div>
                        <label className="text-[10px] font-bold text-gray-500 uppercase">Discount Amount (₹) *</label>
                        <input id="disc-amount-input" type="number" step="1" min="0" value={discAmount}
                          onChange={e => setDiscAmount(e.target.value)} required placeholder="e.g. 500"
                          className={`mt-1 ${inp}`} />
                        <p className="text-[10px] text-gray-400 mt-1 italic">Enter a positive number; it will be saved as a discount.</p>
                      </div>

                      {parseFloat(ledger.room_rent) > 0 && (
                        <button type="button" onClick={applyRoomRentDiscount}
                          className="w-full flex items-center justify-center gap-2 text-xs bg-amber-100 hover:bg-amber-200 text-amber-800 px-3 py-2 rounded-xl font-bold border border-amber-200 transition-colors">
                          <Tag size={13} /> Use “Room Rent Discount”
                        </button>
                      )}

                      <button type="submit" disabled={submitting}
                        className="w-full py-3 rounded-xl bg-amber-500 text-white font-bold hover:bg-amber-600 active:scale-[0.98] transition-all flex items-center justify-center gap-2 shadow-sm text-sm disabled:opacity-60">
                        {submitting ? 'Saving…' : <><Tag size={16} /> Save Discount</>}
                      </button>
                    </form>
                  )}
                </div>
              </div>

              {/* Room rent info */}
              {parseFloat(ledger.room_rent) > 0 && (
                <div className="bg-blue-50 border border-blue-200 rounded-2xl p-4">
                  <p className="text-[10px] font-bold text-blue-500 uppercase tracking-wider mb-1">Auto Room Rent</p>
                  <p className="font-black text-blue-800 text-lg">₹{parseFloat(ledger.room_rent).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</p>
                  <p className="text-blue-600 text-xs mt-0.5">{ledger.days} day{ledger.days !== 1 ? 's' : ''} · Bed {admission.bed_code}</p>
                </div>
              )}
            </div>

          </div>
        ) : null}
      </div>
    </div>
    {receipt && (
      <PrintMiniReceipt
        admission={admission}
        data={receipt.data}
        type={receipt.type}
        viewOnly={!!receipt.viewOnly}
        onClose={() => setReceipt(null)}
      />
    )}
    {dischargePreviewData && (
      <PrintDischargeSummary
        rec={dischargePreviewData.rec}
        admission={dischargePreviewData.admission}
        onClose={() => setDischargePreviewData(null)}
      />
    )}
    {showPrint && ledger && (
      <PrintIpdLedger admission={admission} ledger={ledger} onClose={() => setShowPrint(false)} />
    )}
    </>
  )
}


function PrintIpdLedger({ admission, ledger, onClose, autoPrint = true, embedded = false, dischargeSummary = null }) {
  const isMobile = useIsMobile()
  const printRef = useRef(null)
  const [printAdmission, setPrintAdmission] = useState(() => ({ ...admission }))
  const [printReady, setPrintReady] = useState(false)
  // Re-render when hospital 12h/24h mode changes so Stay Period times include AM/PM.
  useTimeDisplayMode()
  const slipProfile = getPaymentSlipProfile()
  const logoUrl = resolvePaymentSlipLogoUrl(slipProfile)
  const hospitalName = (slipProfile.hospital_name || DEFAULT_PAYMENT_SLIP_PROFILE.hospital_name).toUpperCase()
  const address = slipProfile.address || DEFAULT_PAYMENT_SLIP_PROFILE.address
  const pinCode = slipProfile.pin_code || DEFAULT_PAYMENT_SLIP_PROFILE.pin_code
  const phone = slipProfile.phone || DEFAULT_PAYMENT_SLIP_PROFILE.phone
  const email = slipProfile.email || DEFAULT_PAYMENT_SLIP_PROFILE.email
  const website = slipProfile.website || DEFAULT_PAYMENT_SLIP_PROFILE.website

  function triggerLedgerPrint() {
    receptionistLastPrintKind = 'ipd_ledger'
    if (isMobile && printRef.current) {
      const styleEl = document.getElementById('__ipd_ledger_root')?.querySelector('style')
      const extraStyles = styleEl?.textContent || ''
      const linkedStyles = Array.from(document.querySelectorAll('link[rel="stylesheet"]'))
        .map((link) => `<link rel="stylesheet" href="${link.href}" />`)
        .join('')
      const root = document.getElementById('__ipd_ledger_root')
      const html = `<!DOCTYPE html><html><head><meta charset="utf-8"/>${linkedStyles}<style>${extraStyles}</style></head><body>${(root || printRef.current).outerHTML}</body></html>`
      printHtmlInHiddenIframe(html, {
        onComplete: autoPrint ? () => schedulePrintCleanup(onClose) : undefined,
      })
      return
    }
    const runPrint = () => triggerHMSPrint(window, { printRootId: '__ipd_ledger_root' })
    if (!logoUrl) {
      runPrint()
      return
    }
    const img = document.querySelector('#__ipd_ledger_root .hosp-logo-print')
    if (!img || img.complete) {
      runPrint()
      return
    }
    img.onload = runPrint
    img.onerror = runPrint
  }

  useEffect(() => {
    let cancelled = false
    async function hydrateAdmissionForPrint() {
      let enriched = { ...admission }
      try {
        const { data } = await api.get(`/ipd-admissions/${admission.id}/`)
        const row = data?.data || data || {}
        enriched = { ...enriched, ...row }
      } catch {
        // keep base admission on API failure
      }
      const guardianMissing = !String(enriched.guardian_name || '').trim()
      const relationshipMissing = !String(enriched.guardian_relationship || '').trim()
      const addressMissing = !String(enriched.address || '').trim()
      const mobileMissing = !String(enriched.mobile_number || '').trim()
      if ((guardianMissing || relationshipMissing || addressMissing || mobileMissing) && enriched.patient) {
        try {
          const { data } = await api.get(`/patients/${enriched.patient}/`)
          const p = data?.data || data || {}
          const addressBits = [
            p.address_line1,
            p.address_line2,
            p.city,
            p.state,
            p.postal_code,
          ].filter(Boolean).map((v) => String(v).trim()).filter(Boolean)
          enriched = {
            ...enriched,
            guardian_name: String(enriched.guardian_name || p.guardian_name || '').trim(),
            guardian_relationship: String(
              enriched.guardian_relationship || p.guardian_relationship || '',
            ).trim(),
            mobile_number: String(enriched.mobile_number || p.phone || p.mobile_number || '').trim(),
            address: String(enriched.address || addressBits.join(', ')).trim(),
          }
        } catch {
          // keep current fields if patient lookup fails
        }
      }
      if (!cancelled) {
        setPrintAdmission(enriched)
        setPrintReady(true)
      }
    }
    hydrateAdmissionForPrint()
    return () => { cancelled = true }
  }, [admission])

  useEffect(() => {
    if (!printReady) return undefined
    if (!autoPrint) return undefined
    const timer = setTimeout(() => {
      if (printRef.current) triggerLedgerPrint()
    }, 300)

    function handleAfterPrint() {
      schedulePrintCleanup(onClose)
    }
    window.addEventListener('afterprint', handleAfterPrint)

    return () => {
      clearTimeout(timer)
      window.removeEventListener('afterprint', handleAfterPrint)
    }
  }, [printReady, autoPrint, onClose, logoUrl])

  const billingItems = buildIpdBillLineItems(ledger)
  const discountLines = buildIpdBillDiscountLines(ledger)
  const grossAmount = billingItems.reduce((sum, item) => sum + (parseFloat(item.total_amount || 0) || 0), 0)
  const totalDiscount = discountLines.reduce((sum, line) => sum + (line.amount || 0), 0)
  const netAmount = parseAdmissionMoney(ledger?.total_charges ?? (grossAmount - totalDiscount))
  const isSchemePatientPrint = !!(printAdmission?.scheme || admission?.scheme)
  const schemeBillName = String(printAdmission.scheme_name || admission?.scheme_name || '').trim()
  const rawBalanceDue = parseAdmissionMoney(ledger?.balance_due ?? 0)
  const balanceDue = isSchemePatientPrint ? 0 : rawBalanceDue
  const balanceLabel = isSchemePatientPrint
    ? 'FINAL AMOUNT (UNDER SCHEME)'
    : balanceDue > 0
      ? 'DUE'
      : balanceDue < 0
        ? 'REFUND'
        : 'SETTLED'
  const balanceAmount = isSchemePatientPrint ? 0 : Math.abs(balanceDue)
  const balanceClass = isSchemePatientPrint
    ? 'text-gray-900 font-black'
    : balanceDue > 0
      ? 'text-red-600'
      : balanceDue < 0
        ? 'text-blue-600'
        : 'text-gray-700'
  const payments = ledger ? [...(ledger.payments || [])].filter(p => {
    if (p.type === 'pharmacy_payment') return false
    if (String(p.id || '').startsWith('pharmacy-paid-')) return false
    if (String(p.status || '').toLowerCase() === 'cancelled') return false
    if (String(p.invoice_status || 'finalized').toLowerCase() === 'cancelled') return false
    return true
  }).sort((a, b) => new Date(a.date) - new Date(b.date)) : []

  const content = (
    <div id="__ipd_ledger_root" className={embedded
      ? 'bg-white overflow-visible print:p-0 p-1 print:static print:h-auto print:bg-transparent'
      : `fixed inset-0 z-[600] bg-white overflow-y-auto print:p-0 ${isMobile ? 'p-0' : 'p-4 sm:p-8'} print:static print:h-auto print:overflow-visible print:bg-transparent`}>
      <div className={`print:hidden flex gap-2 ${embedded ? 'justify-end mb-3' : isMobile ? 'sticky top-0 z-10 bg-white/95 backdrop-blur border-b border-gray-200 p-3' : 'absolute top-4 right-4'}`}>
        <button
          type="button"
          onClick={triggerLedgerPrint}
          className={`bg-emerald-600 text-white rounded-xl font-bold shadow-lg shadow-emerald-200 ${isMobile && !embedded ? 'flex-1 py-3 text-sm' : 'px-6 py-2'}`}
        >
          Print Bill
        </button>
        {!embedded && (
          <button onClick={onClose} className={`bg-gray-100 text-gray-600 rounded-xl font-bold ${isMobile ? 'flex-1 py-3 text-sm' : 'px-6 py-2'}`}>Cancel</button>
        )}
      </div>

      <div ref={printRef} className="ipd-ledger-sheet mx-auto w-full max-w-[210mm] text-black bg-white print:shadow-none shadow-2xl">
        <div className="p-4 sm:p-[15mm] print:p-0 flex flex-col relative bg-white">
          {/* Bill Header */}
          <div className="ipd-ledger-header flex justify-between items-start border-b-2 border-gray-900 pb-4 mb-6">
            <div className="w-16 h-16 rounded-lg flex items-center justify-center overflow-hidden border border-gray-200 bg-white shrink-0">
              {logoUrl ? (
                <img src={logoUrl} alt="Hospital logo" className="hosp-logo-print w-full h-full object-contain" />
              ) : null}
            </div>
            <div className="text-center flex-1 px-4">
              <h1 className="text-4xl font-black tracking-widest text-gray-900 leading-none">{hospitalName}</h1>
              <p className="text-sm font-medium text-gray-500 mt-1 uppercase tracking-wider">{address}, {pinCode}</p>
              <div className="mt-6 border-y-2 border-gray-900 py-2">
                <h2 className="text-2xl font-black uppercase tracking-[0.2em]">
                  {isSchemePatientPrint ? 'Final Bill Under Scheme' : 'Final Bill'}
                </h2>
              </div>
            </div>
            <div className="w-16 shrink-0" aria-hidden />
          </div>

          {/* Bill Info Grid */}
          <div className="ipd-ledger-info grid grid-cols-2 gap-x-12 gap-y-2 text-sm mb-6">
            <div className="space-y-1">
              <div className="flex"><span className="w-24 font-bold">Patient Name</span><span className="font-medium">: {printAdmission.patient_name || '—'}</span></div>
              <div className="flex"><span className="w-24 font-bold">Guardian Name</span><span className="font-medium">: {formatGuardianLineForSlip(printAdmission.guardian_name, printAdmission.guardian_relationship) || '—'}</span></div>
              <div className="flex"><span className="w-24 font-bold">Address</span><span className="font-medium">: {printAdmission.address || '—'}</span></div>
              <div className="flex"><span className="w-24 font-bold">Mobile No</span><span className="font-medium">: {printAdmission.mobile_number || '—'}</span></div>
              <div className="flex"><span className="w-24 font-bold">Consultant</span><span className="font-medium">: {printAdmission.assigned_doctor_name || '—'}</span></div>
              {isSchemePatientPrint ? (
                <div className="flex"><span className="w-24 font-bold">Scheme</span><span className="font-bold text-amber-900">: {schemeBillName || '—'}</span></div>
              ) : null}
            </div>
            <div className="space-y-1">
              <div className="flex"><span className="w-28 font-bold">Bill No</span><span className="font-medium">: {printAdmission.final_bill_no || '—'}</span></div>
              <div className="flex"><span className="w-28 font-bold">UHID No</span><span className="font-medium">: {printAdmission.patient_uhid || '—'}</span></div>
              <div className="flex"><span className="w-28 font-bold">IPD No</span><span className="font-medium">: {printAdmission.ipd_no || '—'}</span></div>
              <div className="flex"><span className="w-28 font-bold">Room / Bed</span><span className="font-medium">: {printAdmission.room_name || '—'} / {printAdmission.bed_code || '—'}</span></div>
              <div className="flex"><span className="w-28 font-bold">Stay Period</span><span className="font-medium">: {resolveStayStartDateTimeLabel(printAdmission)} to {resolveStayEndDateTimeLabel(printAdmission, dischargeSummary)}</span></div>
            </div>
          </div>

          {/* Billing Table */}
          <div className="flex-1">
            <table className="ipd-ledger-table w-full border-collapse border border-gray-800 text-sm">
              <thead>
                <tr className="bg-gray-50">
                  <th className="border border-gray-800 px-3 py-2 text-left w-12">S.No</th>
                  <th className="border border-gray-800 px-3 py-2 text-left">Description</th>
                  <th className="border border-gray-800 px-3 py-2 text-right w-20">Qty/Days</th>
                  <th className="border border-gray-800 px-3 py-2 text-right w-24">Rate</th>
                  <th className="border border-gray-800 px-3 py-2 text-right w-32">Amount</th>
                </tr>
              </thead>
              <tbody>
                {billingItems.map((item, idx) => (
                  <tr key={idx}>
                    <td className="border border-gray-800 px-3 py-2">{idx + 1}</td>
                    <td className="border border-gray-800 px-3 py-2 font-bold uppercase break-words">{item.description}</td>
                    <td className="border border-gray-800 px-3 py-2 text-right">{parseFloat(item.quantity || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}</td>
                    <td className="border border-gray-800 px-3 py-2 text-right">{parseFloat(item.unit_price || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                    <td className="border border-gray-800 px-3 py-2 text-right font-bold">{parseFloat(item.total_amount).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                  </tr>
                ))}
                {Array.from({ length: Math.max(0, 1 - billingItems.length) }).map((_, i) => (
                  <tr key={`empty-${i}`}><td className="border border-gray-800 px-3 py-2.5 text-center text-gray-200">—</td><td className="border border-gray-800 px-3 py-2.5" /><td className="border border-gray-800 px-3 py-2.5" /><td className="border border-gray-800 px-3 py-2.5" /><td className="border border-gray-800 px-3 py-2.5" /></tr>
                ))}
              </tbody>
            </table>

            <div className="mt-0 border-x border-b border-gray-800 flex divide-x divide-gray-800 break-inside-avoid">
               <div className="flex-1 p-2 text-[11px] leading-snug">
                 <p className="font-black underline mb-1">Receipt Details :</p>
                 {payments.length > 0 ? (
                    <div className="space-y-0">
                      {payments.map((p, i) => (
                        <p key={i} className="leading-tight">R.No: {p.invoice_no || '--'} - Dt. {formatReceiptDateTime(p.date)} - Amt. {parseFloat(p.amount).toLocaleString('en-IN')}</p>
                      ))}
                    </div>
                 ) : <p className="italic opacity-50">No payments recorded</p>}
               </div>
               <div className="ipd-ledger-totals w-72 shrink-0 font-bold text-xs leading-snug">
                 <div className="flex justify-between border-b border-gray-200 py-1.5 px-2"><span>GROSS AMOUNT :</span> <span className="tabular-nums">₹{grossAmount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span></div>
                 {discountLines.map((line, idx) => (
                   <div key={`${line.description}-${idx}`} className="flex justify-between gap-2 border-b border-gray-200 py-1 px-2 text-amber-800 font-semibold">
                     <span className="uppercase truncate" title={line.description}>{line.description}</span>
                     <span className="shrink-0 tabular-nums">- ₹{line.amount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
                   </div>
                 ))}
                 <div className={`ipd-ledger-net-row flex justify-between py-1.5 px-2 border-b border-gray-200 ${isSchemePatientPrint ? 'font-semibold text-xs' : 'bg-gray-50 text-sm font-black'}`}><span>NET AMOUNT :</span> <span className="tabular-nums">₹{netAmount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span></div>
                 <div className="flex justify-between border-b border-gray-200 py-1.5 px-2"><span>PAYMENT RECD :</span> <span className="text-emerald-700 tabular-nums">₹{parseFloat(ledger.total_paid || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span></div>
                 <div className={`ipd-ledger-final-row flex justify-between py-1.5 px-2 ${isSchemePatientPrint ? 'bg-gray-50 text-sm font-black' : ''}`}><span>{balanceLabel} :</span> <span className={`tabular-nums ${balanceClass}`}>₹{balanceAmount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span></div>
               </div>
            </div>
          </div>

          <div className="ipd-ledger-sign mt-auto pt-8 flex justify-between items-end break-inside-avoid">
            <div className="text-xs font-bold italic">
               <p>E. & O.E.</p>
               <p className="mt-4">Doc. Prepared by : {admission.created_by_name || 'System'}</p>
            </div>
            <div className="text-center w-56">
              <div className="h-12 print:h-5 flex items-center justify-center italic text-gray-300">Signatory</div>
              <div className="border-t-2 border-gray-900 pt-1 font-black text-xs uppercase tracking-wider">Authorized Signatory</div>
            </div>
          </div>
        </div>
      </div>

      <style>{`
        @media print {
          @page { size: A4 portrait; margin: 5mm; }
          body, html { background: #fff !important; height: auto !important; overflow: visible !important; }
          body * { visibility: hidden !important; }
          #__ipd_ledger_root, #__ipd_ledger_root * { visibility: visible !important; }
          #__ipd_ledger_root {
            position: absolute !important;
            left: 0 !important;
            top: 0 !important;
            width: 100% !important;
            display: block !important;
            overflow: visible !important;
            height: auto !important;
            padding: 0 !important;
            margin: 0 !important;
            zoom: 1;
          }
          body > *:not(#__ipd_ledger_root):not(#__discharge_doc_root) { display: none !important; }
          #__ipd_ledger_root .ipd-ledger-sheet { margin: 0 !important; box-shadow: none !important; border: none !important; }
          .print\\:hidden, .print\\:hidden * { display: none !important; visibility: hidden !important; }

          /* Keep bill to one page whenever content permits. */
          #__ipd_ledger_root .ipd-ledger-sheet { font-size: 92%; }
          #__ipd_ledger_root .ipd-ledger-header { margin-bottom: 8px !important; }
          #__ipd_ledger_root .ipd-ledger-header .mt-6 { margin-top: 8px !important; }
          #__ipd_ledger_root .ipd-ledger-info { margin-bottom: 8px !important; gap: 4px 18px !important; font-size: 12px !important; }
          #__ipd_ledger_root .ipd-ledger-table th,
          #__ipd_ledger_root .ipd-ledger-table td { padding-top: 4px !important; padding-bottom: 4px !important; }
          #__ipd_ledger_root .ipd-ledger-totals > * { padding-top: 3px !important; padding-bottom: 3px !important; font-size: 11px !important; }
          #__ipd_ledger_root .ipd-ledger-totals .ipd-ledger-final-row { font-size: 12px !important; }
          #__ipd_ledger_root .ipd-ledger-totals .ipd-ledger-net-row { font-size: 11px !important; }
          #__ipd_ledger_root .ipd-ledger-body { flex: 0 0 auto !important; }
          #__ipd_ledger_root .ipd-ledger-sign { margin-top: 8px !important; padding-top: 6px !important; }
          #__ipd_ledger_root .ipd-ledger-sign p { margin-top: 4px !important; }
        }
      `}</style>
    </div>
  )
  return embedded ? content : createPortal(content, document.body)
}

// ─── Main ────────────────────────────────────────────────────────────────────
export default function ReceptionistPortal() {
  useTimeDisplayMode()
  const isMobile = useIsMobile()
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [ipdAdmissionDraft, setIpdAdmissionDraft] = useState(null)
  const nav = useNavigate()
  const location = useLocation()
  // The URL owns which section is visible so screens stay bookmarkable.
  const { section, tab: settingsTab, canonicalPath } = matchReceptionPath(location.pathname)
  const goToSection = useCallback(
    (nextSection) => nav(pathForSection(nextSection)),
    [nav],
  )
  const user = useAuthStore((s) => s.user)
  const [rooms, setRooms] = useState(getRoomsConfig())
  const [tvGroups, setTvGroups] = useState(getTvGroupsConfig(getRoomsConfig()))
  const [alerts, setAlerts] = useState([])
  const [bellOpen, setBellOpen] = useState(false)
  const bellRef = useRef(null)
  const [receptionDailyReportEnabled, setReceptionDailyReportEnabled] = useState(true)
  const [ipdProcessDirty, setIpdProcessDirty] = useState(false)
  const [pendingSection, setPendingSection] = useState(null)
  const [ipdDialogSaving, setIpdDialogSaving] = useState(false)
  const [tpaPrintTarget, setTpaPrintTarget] = useState(null)
  const [tpaPharmacyInvoice, setTpaPharmacyInvoice] = useState(null)
  const [tpaPreviewHost, setTpaPreviewHost] = useState(null)
  const tpaPrintResolveRef = useRef(null)
  const tpaPrintWatchdogRef = useRef(null)
  const ipdProcessRef = useRef(null)

  const settleTpaPrint = useCallback(() => {
    if (tpaPrintWatchdogRef.current) {
      clearTimeout(tpaPrintWatchdogRef.current)
      tpaPrintWatchdogRef.current = null
    }
    const resolve = tpaPrintResolveRef.current
    tpaPrintResolveRef.current = null
    if (resolve) resolve()
  }, [])

  // A print job that never reports back (dialog dismissed without afterprint, load
  // failure, …) must not freeze the pack queue on "Printing 1/n…".
  const armTpaPrintWatchdog = useCallback((resolve, ms = 60000) => {
    tpaPrintResolveRef.current = resolve
    if (tpaPrintWatchdogRef.current) clearTimeout(tpaPrintWatchdogRef.current)
    tpaPrintWatchdogRef.current = setTimeout(() => {
      tpaPrintWatchdogRef.current = null
      const pending = tpaPrintResolveRef.current
      tpaPrintResolveRef.current = null
      if (pending) pending()
    }, ms)
  }, [])

  const finishTpaPortalPrint = useCallback(() => {
    setTpaPrintTarget(null)
    settleTpaPrint()
  }, [settleTpaPrint])

  const finishTpaPharmacyPrint = useCallback(() => {
    setTpaPharmacyInvoice(null)
    settleTpaPrint()
  }, [settleTpaPrint])

  const clearTpaPreview = useCallback(() => {
    setTpaPrintTarget(null)
    setTpaPharmacyInvoice(null)
    if (tpaPrintWatchdogRef.current) {
      clearTimeout(tpaPrintWatchdogRef.current)
      tpaPrintWatchdogRef.current = null
    }
    tpaPrintResolveRef.current = null
  }, [])

  const handleTpaPreviewHost = useCallback((el) => {
    setTpaPreviewHost((prev) => (prev === el ? prev : el))
  }, [])

  const handleTpaPortalPrint = useCallback(async (doc, pack, options = {}) => {
    if (!doc) return
    const previewOnly = Boolean(options.previewOnly)
    const embed = Boolean(options.embed)
    await new Promise(async (resolve, reject) => {
      if (previewOnly) tpaPrintResolveRef.current = null
      else armTpaPrintWatchdog(resolve)
      try {
        setTpaPharmacyInvoice(null)
        if (doc.type === 'opd') {
          const { data } = await api.get(`/opd-visits/${doc.id}/`)
          const visit = data?.data || data
          if (!visit) throw new Error('OPD visit not found')
          setTpaPrintTarget({
            type: 'opd',
            previewOnly,
            embed,
            visit: {
              ...visit,
              doc_name: visit.doctor_name || visit.doc_name || '',
              chief_complaint: visit.chief_complaint || visit.visit_reason || '',
              display_token: visit.display_token || String(visit.queue_number || visit.token_number || ''),
            },
          })
          if (previewOnly) resolve()
          return
        }
        if (doc.type === 'final_bill') {
          const admissionId = doc.meta?.admission_id || doc.id || pack?.admission?.id
          const [{ data: admRes }, { data: ledRes }] = await Promise.all([
            api.get(`/ipd-admissions/${admissionId}/`),
            api.get(`/ipd-admissions/${admissionId}/ledger/`),
          ])
          setTpaPrintTarget({
            type: 'full_bill',
            previewOnly,
            embed,
            admission: admRes?.data || admRes,
            ledger: ledRes?.data || ledRes,
          })
          if (previewOnly) resolve()
          return
        }
        if (doc.type === 'discharge_summary') {
          const admissionId = doc.meta?.admission_id || pack?.admission?.id
          const [{ data: sumRes }, { data: admRes }] = await Promise.all([
            api.get(`/summaries/${doc.id}/`),
            api.get(`/ipd-admissions/${admissionId}/`),
          ])
          setTpaPrintTarget({
            type: 'discharge',
            previewOnly,
            embed,
            rec: sumRes?.data || sumRes,
            admission: admRes?.data || admRes,
          })
          if (previewOnly) resolve()
          return
        }
        resolve()
      } catch (err) {
        if (tpaPrintWatchdogRef.current) {
          clearTimeout(tpaPrintWatchdogRef.current)
          tpaPrintWatchdogRef.current = null
        }
        tpaPrintResolveRef.current = null
        toast.error(err?.message || 'Could not prepare print')
        reject(err)
      }
    })
  }, [armTpaPrintWatchdog])

  const handleTpaPharmacyPrint = useCallback(async (invoiceId, options = {}) => {
    const embed = Boolean(options.embed)
    let pharmacyId = String(options.pharmacyId || options.pharmacy_id || '').trim()
    await new Promise(async (resolve, reject) => {
      if (embed) tpaPrintResolveRef.current = null
      else armTpaPrintWatchdog(resolve)
      try {
        const branchCfg = (id) => (id ? { headers: { 'X-Pharmacy-Branch': id } } : {})
        const { data } = await api.get(`/pharmacy/invoices/${invoiceId}/`, branchCfg(pharmacyId))
        const invoice = data?.data || data
        if (!invoice) throw new Error('Invoice not found')
        if (!pharmacyId) {
          pharmacyId = String(invoice.pharmacy || invoice.pharmacy_id || '').trim()
        }
        let outlet = null
        if (pharmacyId) {
          try {
            const settingsRes = await api.get('/pharmacy/settings/', branchCfg(pharmacyId))
            const raw = settingsRes.data?.data || settingsRes.data
            outlet = normalizeOutletSettingsFromApi(raw) || raw || null
          } catch {
            outlet = null
          }
        }
        setTpaPrintTarget(null)
        setTpaPharmacyInvoice({
          invoice,
          outlet,
          embed,
          previewOnly: Boolean(options.previewOnly),
        })
        if (embed) resolve()
      } catch (err) {
        if (tpaPrintWatchdogRef.current) {
          clearTimeout(tpaPrintWatchdogRef.current)
          tpaPrintWatchdogRef.current = null
        }
        tpaPrintResolveRef.current = null
        toast.error(err?.message || 'Could not load pharmacy invoice')
        reject(err)
      }
    })
  }, [armTpaPrintWatchdog])

  const requestSection = useCallback((next) => {
    if (section === 'settings' && next !== 'settings' && ipdProcessDirty) {
      setPendingSection(next)
      return
    }
    goToSection(next)
  }, [section, ipdProcessDirty, goToSection])

  // Bare /receptionist, bare /receptionist/settings, and unknown paths land on a real screen.
  useEffect(() => {
    if (canonicalPath !== location.pathname) {
      nav(canonicalPath, { replace: true })
    }
  }, [canonicalPath, location.pathname, nav])

  useEffect(() => {
    if (!ipdProcessDirty) return undefined
    const handler = (e) => {
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [ipdProcessDirty])

  const navGroups = useMemo(
    () =>
      receptionDailyReportEnabled
        ? NAV_GROUPS
        : NAV_GROUPS.filter((g) => g.label !== 'Reports'),
    [receptionDailyReportEnabled],
  )

  function logout() {
    clearAuthStorage()
    nav('/login')
  }

  useEffect(() => {
    async function refreshPortalSettings() {
      await loadReceptionPortalSettings()
      setReceptionDailyReportEnabled(getReceptionOpdSettings().reception_daily_report_enabled !== false)
    }
    refreshPortalSettings()
    const t = setInterval(refreshPortalSettings, 15000)
    return () => clearInterval(t)
  }, [])

  useEffect(() => {
    if (!receptionDailyReportEnabled && section === 'reports') {
      nav(pathForSection('opd'), { replace: true })
    }
  }, [receptionDailyReportEnabled, section, nav])

  useEffect(() => { saveRoomsConfig(rooms) }, [rooms])

  useEffect(() => {
    const roomCodes = new Set(rooms.map(r => r.code))
    const sanitized = tvGroups.map(g => ({
      ...g,
      left_room: roomCodes.has(g.left_room) ? g.left_room : null,
      right_room: roomCodes.has(g.right_room) ? g.right_room : null,
    }))
    setTvGroups(sanitized)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rooms])

  useEffect(() => { saveTvGroupsConfig(tvGroups) }, [tvGroups])

  // Fetch follow-up alerts
  useEffect(() => {
    fetchFollowUpAlerts()
    const t = setInterval(fetchFollowUpAlerts, 5 * 60 * 1000)
    return () => clearInterval(t)
  }, [])

  async function fetchFollowUpAlerts() {
    try {
      const { data } = await api.get('/follow-up-alerts/')
      setAlerts(data)
    } catch { }
  }

  async function markFollowUpDone(id) {
    try {
      await api.patch(`/opd-visits/${id}/`, { follow_up_completed: true })
      setAlerts(prev => prev.filter(a => a.id !== id))
      toast.success('Follow-up marked as completed')
    } catch {
      toast.error('Failed to mark as done')
    }
  }

  // Close bell dropdown on outside click
  useEffect(() => {
    function handler(e) {
      if (bellRef.current && !bellRef.current.contains(e.target)) setBellOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const todayAlerts = alerts.filter(a => a.is_today)
  const tomorrowAlerts = alerts.filter(a => a.is_tomorrow)
  const sectionTitle = navGroups.flatMap(g => g.items).find(i => i.id === section)?.label || 'Receptionist'

  // ── Helper: build the section content ─────────────────────────────────────
  function handleMoveOpdToIpd(visitDraft) {
    setIpdAdmissionDraft(visitDraft || null)
    goToSection('new_admission')
  }

  function renderSectionContent() {
    return (
      <>
        {section === 'opd' && <OPDSection rooms={rooms} />}
        {section === 'ipd' && (
          <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
            <IPDSection mode="ipd" initialAdmissionDraft={ipdAdmissionDraft} />
          </div>
        )}
        {section === 'new_admission' && (
          <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
            <IPDSection mode="new_admission" initialAdmissionDraft={ipdAdmissionDraft} />
          </div>
        )}
        {section === 'emergency' && (
          <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
            <EmergencySection />
          </div>
        )}
        {section === 'patients' && (
          <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
            <PatientListSection />
          </div>
        )}
        {section === 'opd_history' && (
          <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
            <OpdSlipsSection onMoveToIpd={handleMoveOpdToIpd} />
          </div>
        )}
        {section === 'register' && <RegisterPatientSection />}
        {section === 'payment_slip' && (
          <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
            <PaymentSlipSection />
          </div>
        )}
        {section === 'payment_slip_list' && (
          <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
            <PaymentSlipsListSection />
          </div>
        )}
        {section === 'expense' && (
          <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
            <ExpenseSection />
          </div>
        )}
        {receptionDailyReportEnabled && section === 'reports' && (
          <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
            <ReportsSection />
          </div>
        )}
        {section === 'discharge' && (
          <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
            <DischargeSection />
          </div>
        )}
        {section === 'tpa' && (
          <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
            <TpaDocumentPackSection
              onPortalPrint={handleTpaPortalPrint}
              onPharmacyPrint={handleTpaPharmacyPrint}
              onClearPreview={clearTpaPreview}
              onPreviewHost={handleTpaPreviewHost}
            />
          </div>
        )}
        {section === 'attendance' && <StaffAttendanceSection />}
        {section === 'settings' && (
          <ReceptionSettingsSection
            rooms={rooms}
            setRooms={setRooms}
            tvGroups={tvGroups}
            setTvGroups={setTvGroups}
            ipdProcessRef={ipdProcessRef}
            ipdProcessDirty={ipdProcessDirty}
            onIpdProcessDirtyChange={setIpdProcessDirty}
            tab={settingsTab}
            onTabChange={(nextTab) => nav(pathForSettingsTab(nextTab))}
          />
        )}
      </>
    )
  }

  const pharmacyInvoice = tpaPharmacyInvoice?.invoice || (tpaPharmacyInvoice?.id ? tpaPharmacyInvoice : null)
  const tpaEmbedded = Boolean(tpaPrintTarget?.embed || tpaPharmacyInvoice?.embed)
  const tpaPreviewOnly = Boolean(tpaPrintTarget?.previewOnly || tpaPharmacyInvoice?.previewOnly)
  const tpaPrintTree = (
    <>
      {tpaPrintTarget?.type === 'opd' && (
        <PrintSlip
          visit={tpaPrintTarget.visit}
          onClose={tpaPreviewOnly ? () => {} : finishTpaPortalPrint}
          embedded={tpaEmbedded}
          autoPrint={!tpaPreviewOnly && !tpaEmbedded}
        />
      )}
      {tpaPrintTarget?.type === 'full_bill' && (
        <PrintIpdLedger
          admission={tpaPrintTarget.admission}
          ledger={tpaPrintTarget.ledger}
          onClose={tpaPreviewOnly ? () => {} : finishTpaPortalPrint}
          autoPrint={!tpaPreviewOnly}
          embedded={tpaEmbedded}
        />
      )}
      {tpaPrintTarget?.type === 'discharge' && (
        <PrintDischargeSummary
          rec={tpaPrintTarget.rec}
          admission={tpaPrintTarget.admission}
          onClose={tpaPreviewOnly ? () => {} : finishTpaPortalPrint}
          autoPrint={!tpaPreviewOnly}
          embedded={tpaEmbedded}
        />
      )}
      {pharmacyInvoice && (
        <PharmacyInvoicePrint
          invoice={pharmacyInvoice}
          outlet={tpaPharmacyInvoice?.outlet || null}
          onClose={tpaPreviewOnly ? () => {} : finishTpaPharmacyPrint}
          embedded={tpaEmbedded}
          autoPrint={!tpaPreviewOnly && !tpaEmbedded}
        />
      )}
    </>
  )
  const tpaPrintMount = tpaEmbedded
    ? (tpaPreviewHost ? createPortal(tpaPrintTree, tpaPreviewHost) : null)
    : tpaPrintTree

  // ── Mobile layout (separate file) ───────────────────────────────────────────
  if (isMobile) {
    return (
      <>
        <MobilePortalShell
          user={user}
          section={section}
          sectionTitle={sectionTitle}
          navGroups={navGroups}
          alerts={alerts}
          onSelect={requestSection}
          onLogout={logout}
          markFollowUpDone={markFollowUpDone}
        >
          {renderSectionContent()}
        </MobilePortalShell>

        <DiscardChangesConfirmModal
          open={pendingSection != null}
          saving={ipdDialogSaving}
          onCancel={() => setPendingSection(null)}
          onDiscard={() => {
            ipdProcessRef.current?.discardChanges()
            const next = pendingSection
            setPendingSection(null)
            if (next) goToSection(next)
          }}
          onSave={async () => {
            setIpdDialogSaving(true)
            const ok = await ipdProcessRef.current?.save()
            setIpdDialogSaving(false)
            if (ok) {
              const next = pendingSection
              setPendingSection(null)
              if (next) goToSection(next)
            }
          }}
        />

        {tpaPrintMount}
      </>
    )
  }

  // ── Desktop layout ──────────────────────────────────────────────────────────
  return (
    <div className="h-screen overflow-hidden bg-gray-50 flex flex-col" style={{ height: '100dvh' }}>
      {/* Top bar */}
      <header className="bg-gradient-to-r from-emerald-600 to-teal-600 text-white px-5 py-2.5 flex items-center justify-between shadow-lg shrink-0">
        <div className="flex items-center gap-3">
          <Hospital size={20} />
          <div>
            <h1 className="font-bold text-sm leading-tight">
              {user.first_name ? `${user.first_name} ${user.last_name || ''}` : 'Receptionist Portal'}
            </h1>
            <p className="text-xs opacity-75">{user.role?.replace(/_/g, ' ') || user.email || 'Reception Desk'}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs bg-white/20 px-3 py-1 rounded-full font-medium">{sectionTitle}</span>

          {/* Follow-up Bell */}
          <div className="relative" ref={bellRef}>
            <button
              onClick={() => setBellOpen(o => !o)}
              className={`relative flex items-center gap-1.5 text-xs font-bold px-3 py-1.5 rounded-lg transition-all ${
                todayAlerts.length > 0
                  ? 'bg-red-500 hover:bg-red-600 text-white animate-pulse'
                  : tomorrowAlerts.length > 0
                  ? 'bg-amber-400 hover:bg-amber-500 text-white'
                  : 'bg-white/20 hover:bg-white/30 text-white'
              }`}
            >
              <Bell size={14} />
              Follow-up
              {alerts.length > 0 && (
                <span className="absolute -top-1.5 -right-1.5 w-4 h-4 bg-white text-emerald-700 text-[9px] font-black rounded-full flex items-center justify-center shadow">
                  {alerts.length}
                </span>
              )}
            </button>

            {/* Dropdown panel */}
            {bellOpen && (
              <div className="absolute right-0 top-full mt-2 w-80 bg-white rounded-2xl shadow-2xl border border-gray-100 z-50 overflow-hidden">
                <div className="bg-gradient-to-r from-emerald-600 to-teal-600 px-4 py-3 flex items-center justify-between">
                  <div className="flex items-center gap-2 text-white">
                    <Bell size={14} />
                    <span className="text-sm font-bold">Follow-up Alerts</span>
                  </div>
                  <button onClick={() => setBellOpen(false)} className="text-white/70 hover:text-white"><X size={14} /></button>
                </div>

                {alerts.length === 0 ? (
                  <div className="p-6 text-center text-gray-400 text-sm">No follow-up alerts</div>
                ) : (
                  <div className="max-h-96 overflow-y-auto divide-y divide-gray-50">
                    {alerts.map(alert => (
                      <div key={alert.id} className={`p-3 ${
                        alert.is_today ? 'bg-red-50' : 'bg-amber-50'
                      }`}>
                        <div className="flex items-start justify-between gap-2 mb-1">
                          <div>
                            <p className="text-sm font-bold text-gray-800">{alert.patient_name}</p>
                            <div className="flex items-center gap-2">
                              <p className="text-[10px] text-gray-500 font-mono italic">#{alert.uhid}</p>
                              {alert.patient_phone && (
                                <p className="text-[10px] text-emerald-700 font-bold bg-emerald-50 px-1.5 py-0.5 rounded border border-emerald-100 flex items-center gap-1">
                                  <Phone size={9} /> {alert.patient_phone}
                                </p>
                              )}
                            </div>
                          </div>
                          <div className="flex flex-col items-end gap-1">
                            <span className={`text-[10px] font-extrabold px-2 py-0.5 rounded-full shrink-0 ${
                              alert.is_today ? 'bg-red-200 text-red-800' : 'bg-amber-200 text-amber-800'
                            }`}>
                              {alert.is_today ? '🔴 TODAY' : '🟡 TOMORROW'}
                            </span>
                            <span className="text-[9px] text-gray-400 font-bold bg-white/50 px-1.5 py-0.5 rounded border border-gray-100 uppercase tracking-tighter">
                              Visited: {format(new Date(alert.original_visit_date), 'dd MMM')}
                            </span>
                          </div>
                        </div>
                        <p className="text-xs text-gray-500 mb-2 line-clamp-1 italic">"{alert.visit_reason || alert.revisit_advice || 'Follow-up'}"</p>
                        
                        <div className="flex gap-2">
                          {alert.patient_phone && (
                            <a href={`tel:${alert.patient_phone}`}
                              className="flex items-center justify-center gap-1.5 flex-1 text-xs font-bold bg-emerald-600 text-white py-2 rounded-xl hover:bg-emerald-700 transition-all shadow-sm">
                              <Phone size={12} /> Call
                            </a>
                          )}
                          <button
                            onClick={() => markFollowUpDone(alert.id)}
                            className="flex items-center justify-center gap-1.5 flex-1 text-xs font-bold bg-gray-100 text-gray-600 py-2 rounded-xl hover:bg-gray-200 transition-all border border-gray-200"
                          >
                            <CheckCircle size={12} /> Done
                          </button>
                        </div>
                        {alert.doctor_name && <p className="text-[10px] text-gray-400 mt-1 text-center">Dr. {alert.doctor_name}</p>}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          <button onClick={logout} className="flex items-center gap-1.5 text-xs bg-white/20 hover:bg-white/30 px-3 py-1.5 rounded-lg transition-all">
            <LogOut size={14} /> Logout
          </button>
        </div>
      </header>

      {/* Body: sidebar + content */}
      <div className="flex flex-1 overflow-hidden">
        <Sidebar
          activeSection={section}
          onSelect={requestSection}
          navGroups={navGroups}
          isOpen={false}
          onClose={() => {}}
        />
        <main className={`flex-1 flex flex-col min-h-0 ${section === 'opd' ? 'overflow-hidden p-0' : section === 'payment_slip' || section === 'expense' || section === 'tpa' ? 'overflow-hidden p-0' : 'overflow-auto p-5'}`}>
          {renderSectionContent()}
        </main>
      </div>

      <DiscardChangesConfirmModal
        open={pendingSection != null}
        saving={ipdDialogSaving}
        onCancel={() => setPendingSection(null)}
        onDiscard={() => {
          ipdProcessRef.current?.discardChanges()
          const next = pendingSection
          setPendingSection(null)
          if (next) goToSection(next)
        }}
        onSave={async () => {
          setIpdDialogSaving(true)
          const ok = await ipdProcessRef.current?.save()
          setIpdDialogSaving(false)
          if (ok) {
            const next = pendingSection
            setPendingSection(null)
            if (next) goToSection(next)
          }
        }}
      />

      {tpaPrintMount}
    </div>
  )
}


