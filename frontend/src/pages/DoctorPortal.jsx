import React, { useState, useEffect, useRef, useMemo } from 'react'
import Layout from '../components/Layout'
import DoctorAnalytics from '../components/DoctorAnalytics'
import TreatmentPlansModule from '../components/TreatmentPlansModule'
import api from '../api'
import toast from 'react-hot-toast'
import { useAuthStore } from '../stores/authStore'
import DraftPrescriptionModal from '../components/DraftPrescriptionModal'
import DischargePrescriptionPanel from '../components/DischargePrescriptionPanel'
import DischargeClinicalForm from '../components/discharge/DischargeClinicalForm'
import { useDischargeFieldCatalog } from '../components/discharge/useDischargeFieldCatalog'
import { rxItemsToMedicationRows, medicationRowsToRxItems } from '../pharmacy/rxMedicationMapping'
import { useDebouncedValue } from '../pharmacy/useDebouncedValue'
import { pickDefaultPharmacyBranchId } from '../pharmacy/rxConstants'
import { filterCommonSalts, isCommonSaltName, MEDICINE_DB_LOWER, normalizeSaltName } from '../pharmacy/commonSaltNames'
import { getRxPrintDefaultsFromLayout } from '../pharmacy/rxBoxDefaults'
import { printRxOnly, loadOpdSlipLayoutForPrint } from '../utils/printOpdSheet'
import { formatTime, useTimeDisplayMode } from '../utils/dateTimeFormat'
import { format, addDays } from 'date-fns'
import {
  Groups as GroupsIcon,
  ChevronRight as ChevronRightIcon,
  Checklist as ChecklistIcon,
  Add as AddIcon,
  Delete as DeleteIcon,
  AccessTime as AccessTimeIcon,
  CheckCircle as CheckCircleIcon,
  ArrowForward as ArrowForwardIcon,
  DragIndicator as DragIndicatorIcon,
  MedicalServices as MedicalServicesIcon,
  Close as CloseIcon,
  Mic as MicIcon,
  MicOff as MicOffIcon,
  PersonAdd as PersonAddIcon,
  CalendarMonth as CalendarMonthIcon,
  ReceiptLong as ReceiptLongIcon,
  MonitorHeart as MonitorHeartIcon,
  Medication as MedicationIcon,
  ContentCut as ContentCutIcon,
  Description as DescriptionIcon,
  Search as SearchIcon,
  Autorenew as AutorenewIcon,
  Settings as SettingsIcon,
  Visibility as VisibilityIcon,
} from '@mui/icons-material'
import {
  DndContext, closestCenter, PointerSensor, useSensor, useSensors
} from '@dnd-kit/core'
import {
  SortableContext, useSortable, verticalListSortingStrategy, arrayMove
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'

function asMuiIcon(IconComponent) {
  return function IconBridge({ size, className, sx, ...rest }) {
    return <IconComponent className={className} sx={{ ...(size ? { fontSize: size } : {}), ...sx }} {...rest} />
  }
}

const Users = asMuiIcon(GroupsIcon)
const ChevronRight = asMuiIcon(ChevronRightIcon)
const ClipboardList = asMuiIcon(ChecklistIcon)
const Plus = asMuiIcon(AddIcon)
const Trash2 = asMuiIcon(DeleteIcon)
const Clock = asMuiIcon(AccessTimeIcon)
const CheckCircle = asMuiIcon(CheckCircleIcon)
const ArrowRight = asMuiIcon(ArrowForwardIcon)
const GripVertical = asMuiIcon(DragIndicatorIcon)
const Stethoscope = asMuiIcon(MedicalServicesIcon)
const X = asMuiIcon(CloseIcon)
const Mic = asMuiIcon(MicIcon)
const MicOff = asMuiIcon(MicOffIcon)
const UserPlus = asMuiIcon(PersonAddIcon)
const CalendarClock = asMuiIcon(CalendarMonthIcon)
const Receipt = asMuiIcon(ReceiptLongIcon)
const Activity = asMuiIcon(MonitorHeartIcon)
const Pill = asMuiIcon(MedicationIcon)
const Scissors = asMuiIcon(ContentCutIcon)
const FileText = asMuiIcon(DescriptionIcon)
const Search = asMuiIcon(SearchIcon)
const Loader2 = asMuiIcon(AutorenewIcon)
const Settings = asMuiIcon(SettingsIcon)
const Eye = asMuiIcon(VisibilityIcon)

const TABS = [
  { id: 'opd', label: 'OPD Queue', icon: Users },
  { id: 'tp', label: 'Treatment Plans', icon: ClipboardList },
  { id: 'analytics', label: 'Analytics', icon: Stethoscope },
  { id: 'discharge', label: 'Discharge Summary', icon: FileText },
]

const DAYS = ['Day 1', 'Day 2', 'Day 3', 'Day 4']

const TIMELINE_CATEGORY_META = {
  Appointment: { icon: CalendarClock, iconClass: 'text-sky-600' },
  Billing: { icon: Receipt, iconClass: 'text-emerald-600' },
  Condition: { icon: Activity, iconClass: 'text-violet-600' },
  Medicines: { icon: Pill, iconClass: 'text-blue-600' },
  Procedures: { icon: Scissors, iconClass: 'text-amber-600' },
}

const TIMELINE_FILTERS = [
  { id: 'all', label: 'All', categories: null },
  { id: 'medicines', label: 'Medicines', categories: ['Medicines'] },
  { id: 'billing', label: 'Billing', categories: ['Billing'] },
  { id: 'notes', label: 'Notes', categories: ['Condition', 'Appointment', 'Procedures'] },
]

const TREATMENT_EVENT_STATUS = {
  plan_saved: { icon: '⏳', color: 'text-amber-700' },
  treatment_done: { icon: '✔✔', color: 'text-emerald-700' },
  treatment_skipped: { icon: '❌', color: 'text-rose-700' },
}

const DEFAULT_FOLLOWUP_DAYS = [3, 5, 7, 10, 14, 30]
const DEFAULT_RX_DAYS = [1, 3, 5, 7, 10, 14, 30]
const DEFAULT_TIMING_OPTIONS = [
  { v: 'AF', l: 'After Food' }, { v: 'BF', l: 'Before Food' },
  { v: 'EM', l: 'Empty Stomach' }, { v: 'BD', l: 'Twice Daily' },
  { v: 'TDS', l: 'Three Times' }, { v: 'QID', l: 'Four Times' },
  { v: 'HS', l: 'Bedtime' }, { v: 'SOS', l: 'As Needed' },
]
const DEFAULT_DOSAGE_PATTERNS = [
  { v: '1', l: '1 (OD)', q: 1 },
  { v: '1-0-1', l: '1-0-1 (BD)', q: 2 },
  { v: '1-1', l: '1-1 (BD)', q: 2 },
  { v: '1-1-1', l: '1-1-1 (TDS)', q: 3 },
  { v: '1-1-1-1', l: '1-1-1-1 (QID)', q: 4 },
  { v: '0-1', l: '0-1 (Night)', q: 1 },
  { v: '1-0', l: '1-0 (Morning)', q: 1 },
  { v: '2-2', l: '2-2 (BD)', q: 4 },
  { v: '2-2-2', l: '2-2-2 (TDS)', q: 6 },
  { v: '0.5-0.5', l: '0.5-0.5 (Half BD)', q: 1 },
]

function normalizeDayOptions(raw, fallback) {
  const arr = Array.isArray(raw) ? raw : []
  const cleaned = [...new Set(arr.map((n) => Number(n)).filter((n) => Number.isFinite(n) && n > 0 && n <= 365))]
    .sort((a, b) => a - b)
  return cleaned.length ? cleaned : fallback
}

function parseDayOptionText(text, fallback) {
  const parsed = String(text || '')
    .split(',')
    .map((v) => Number(String(v).trim()))
    .filter((n) => Number.isFinite(n))
  return normalizeDayOptions(parsed, fallback)
}

function normalizeOptionPairs(raw, fallback) {
  const arr = Array.isArray(raw) ? raw : []
  const seen = new Set()
  const out = arr
    .map((x) => ({
      v: String(x?.v || '').trim(),
      l: String(x?.l || '').trim(),
    }))
    .filter((x) => x.v && x.l && !seen.has(x.v) && seen.add(x.v))
  return out.length ? out : fallback
}

function normalizeDosagePatterns(raw, fallback) {
  const arr = Array.isArray(raw) ? raw : []
  const seen = new Set()
  const out = arr
    .map((x) => ({
      v: String(x?.v || '').trim(),
      l: String(x?.l || '').trim(),
      q: Number(x?.q),
    }))
    .filter((x) => x.v && x.l && Number.isFinite(x.q) && x.q > 0 && !seen.has(x.v) && seen.add(x.v))
  return out.length ? out : fallback
}

const FREQ_MAP = {
  'OD': ['08:00'],
  'BD': ['08:00', '20:00'],
  'TDS': ['08:00', '14:00', '20:00'],
  'QID': ['08:00', '12:00', '16:00', '20:00'],
  'HS': ['22:00'],
  'PRN': ['PRN'],
  'STAT': ['STAT']
}

const MEDICINE_TEMPLATES = [
  { title: 'Give Glucose', instructions: '500ml IV over 2h', category: 'medication', color: 'yellow', frequency: 'BD' },
  { title: 'Antibiotic (Ceftriaxone 1g)', instructions: 'IV once', category: 'medication', color: 'blue', frequency: 'OD' },
  { title: 'Amoxicillin 500mg', instructions: 'PO', category: 'medication', color: 'green', frequency: 'TDS' },
  { title: 'Painkiller (Paracetamol 1g)', instructions: 'IV if pain ≥ 5', category: 'medication', color: 'red', frequency: 'PRN' },
  { title: 'Check Vitals', instructions: 'BP, temp, SPO2, pulse', category: 'nursing', color: 'purple', frequency: 'QID' },
  { title: 'IV Fluid Change', instructions: 'Every 8 hours', category: 'nursing', color: 'amber', frequency: 'TDS' },
  { title: 'Physiotherapy', instructions: '30 min session', category: 'physiotherapy', color: 'blue', frequency: 'OD' },
  { title: 'Blood CBC', instructions: 'Fasting sample', category: 'investigation', color: 'purple', frequency: 'OD' },
  { title: 'Diet – Soft/Liquid', instructions: 'No spicy food', category: 'diet', color: 'green', frequency: 'TDS' },
]

// Predefined packages — each is a named bundle of multiple order items.
const DEFAULT_PACKAGES = [
  {
    id: 'pkg-postop-0',
    name: 'Post-op Day 0',
    color: 'purple',
    items: [
      { title: 'Give Glucose', instructions: '500ml IV over 2h', category: 'medication', time_of_day: '08:00' },
      { title: 'Antibiotic (Ceftriaxone 1g)', instructions: 'IV once', category: 'medication', time_of_day: '08:00' },
      { title: 'Painkiller (Paracetamol 1g)', instructions: 'IV if pain ≥ 5', category: 'medication', time_of_day: '10:00' },
      { title: 'Check Vitals', instructions: 'BP, temp, SPO2, pulse', category: 'nursing', time_of_day: '06:00' },
      { title: 'IV Fluid Change', instructions: 'Every 8 hours', category: 'nursing', time_of_day: '08:00' },
    ],
  },
  {
    id: 'pkg-recovery',
    name: 'Recovery Protocol',
    color: 'green',
    items: [
      { title: 'Check Vitals', instructions: 'BP, temp, SPO2, pulse', category: 'nursing', time_of_day: '06:00' },
      { title: 'Physiotherapy', instructions: '30 min session', category: 'physiotherapy', time_of_day: '10:00' },
      { title: 'Diet – Soft/Liquid', instructions: 'No spicy food', category: 'diet', time_of_day: '08:00' },
      { title: 'Blood CBC', instructions: 'Fasting sample', category: 'investigation', time_of_day: '07:00' },
    ],
  },
  {
    id: 'pkg-morning',
    name: 'Morning Ward Round',
    color: 'blue',
    items: [
      { title: 'Check Vitals', instructions: 'BP, temp, SPO2, pulse', category: 'nursing', time_of_day: '06:00' },
      { title: 'IV Fluid Change', instructions: 'Every 8 hours', category: 'nursing', time_of_day: '06:30' },
      { title: 'Amoxicillin 500mg', instructions: 'PO once', category: 'medication', time_of_day: '07:00' },
    ],
  },
  {
    id: 'pkg-fever',
    name: 'Fever Management',
    color: 'red',
    items: [
      { title: 'Paracetamol 650mg', instructions: 'PO if temp > 38.5°C', category: 'medication', time_of_day: '08:00' },
      { title: 'Blood CBC', instructions: 'Fasting sample', category: 'investigation', time_of_day: '07:00' },
      { title: 'Check Vitals', instructions: 'Every 4 hours', category: 'nursing', time_of_day: '06:00' },
      { title: 'IV Fluids NS', instructions: '500ml IV over 4h', category: 'medication', time_of_day: '09:00' },
    ],
  },
]

const categoryEmoji = { medication: '💊', nursing: '🩺', physiotherapy: '🏃', investigation: '🔬', diet: '🥗', other: '📋' }

const pkgColors = {
  purple: { bg: 'bg-purple-100', border: 'border-purple-300', text: 'text-purple-800', btn: 'bg-purple-200 hover:bg-purple-300 text-purple-800' },
  green:  { bg: 'bg-green-100',  border: 'border-green-300',  text: 'text-green-800',  btn: 'bg-green-200 hover:bg-green-300 text-green-800' },
  blue:   { bg: 'bg-blue-100',   border: 'border-blue-300',   text: 'text-blue-800',   btn: 'bg-blue-200 hover:bg-blue-300 text-blue-800' },
  red:    { bg: 'bg-red-100',    border: 'border-red-300',    text: 'text-red-800',    btn: 'bg-red-200 hover:bg-red-300 text-red-800' },
  amber:  { bg: 'bg-amber-100',  border: 'border-amber-300',  text: 'text-amber-800',  btn: 'bg-amber-200 hover:bg-amber-300 text-amber-800' },
  yellow: { bg: 'bg-yellow-100', border: 'border-yellow-300', text: 'text-yellow-800', btn: 'bg-yellow-200 hover:bg-yellow-300 text-yellow-800' },
}

const COPY_DISABLED_TOAST_MESSAGE = 'Copy disabled for security reasons'
const COPY_DISABLED_TOAST_COOLDOWN_MS = 2000
const COPY_EXEMPT_ROLES = new Set(['superadmin'])

function useDoctorPortalCopyProtection(scopeRef, { enabled }) {
  const lastToastAtRef = useRef(0)

  useEffect(() => {
    if (!enabled) return undefined
    const scopeEl = scopeRef.current
    if (!scopeEl) return undefined

    const isEditableTarget = (target) => {
      if (!(target instanceof Element)) return false
      return Boolean(
        target.closest(
          'input, textarea, select, [contenteditable="true"], [contenteditable=""], [role="textbox"]',
        ),
      )
    }

    const shouldBlock = (target) => {
      if (!(target instanceof Element)) return false
      if (!scopeEl.contains(target)) return false
      if (!target.closest('[data-no-copy="true"]')) return false
      if (isEditableTarget(target)) return false
      return true
    }

    const showSecurityToast = () => {
      const now = Date.now()
      if (now - lastToastAtRef.current < COPY_DISABLED_TOAST_COOLDOWN_MS) return
      lastToastAtRef.current = now
      toast(COPY_DISABLED_TOAST_MESSAGE, { icon: '🔒' })
    }

    const handleClipboardEvent = (event) => {
      if (!shouldBlock(event.target)) return
      event.preventDefault()
      showSecurityToast()
    }

    const handleContextMenu = (event) => {
      if (!shouldBlock(event.target)) return
      event.preventDefault()
      showSecurityToast()
    }

    const handleDragStart = (event) => {
      if (!shouldBlock(event.target)) return
      event.preventDefault()
      showSecurityToast()
    }

    const handleSelectStart = (event) => {
      if (!shouldBlock(event.target)) return
      event.preventDefault()
    }

    const handleKeyDown = (event) => {
      const key = String(event.key || '').toLowerCase()
      const isCopyShortcut = (event.ctrlKey || event.metaKey) && ['c', 'x', 'v', 'a'].includes(key)
      if (!isCopyShortcut) return
      if (!shouldBlock(event.target)) return
      event.preventDefault()
      showSecurityToast()
    }

    document.addEventListener('copy', handleClipboardEvent, true)
    document.addEventListener('cut', handleClipboardEvent, true)
    document.addEventListener('paste', handleClipboardEvent, true)
    document.addEventListener('contextmenu', handleContextMenu, true)
    document.addEventListener('dragstart', handleDragStart, true)
    document.addEventListener('selectstart', handleSelectStart, true)
    document.addEventListener('keydown', handleKeyDown, true)

    return () => {
      document.removeEventListener('copy', handleClipboardEvent, true)
      document.removeEventListener('cut', handleClipboardEvent, true)
      document.removeEventListener('paste', handleClipboardEvent, true)
      document.removeEventListener('contextmenu', handleContextMenu, true)
      document.removeEventListener('dragstart', handleDragStart, true)
      document.removeEventListener('selectstart', handleSelectStart, true)
      document.removeEventListener('keydown', handleKeyDown, true)
    }
  }, [enabled, scopeRef])
}

function suggestIconsByName(name = '') {
  const n = name.toLowerCase()
  if (n.includes('glucose') || n.includes('fluid') || n.includes('iv')) return ['💧', '🧪', '💊']
  if (n.includes('antibiotic') || n.includes('amoxicillin') || n.includes('paracetamol') || n.includes('pain')) return ['💊', '💉', '🩹']
  if (n.includes('vital') || n.includes('bp') || n.includes('pulse') || n.includes('nursing')) return ['🩺', '❤️', '📈']
  if (n.includes('physio')) return ['🏃', '🦵', '🤸']
  if (n.includes('cbc') || n.includes('blood') || n.includes('test') || n.includes('investigation')) return ['🧪', '🔬', '🩸']
  if (n.includes('diet') || n.includes('food') || n.includes('liquid')) return ['🥗', '🍲', '🥛']
  if (n.includes('oxygen') || n.includes('resp')) return ['🫁', '💨', '🩺']
  if (n.includes('inj') || n.includes('injection')) return ['💉', '💊', '🧪']
  return ['📋', '💊', '🩺']
}

function pickIconWithSuggestion(title, fallback = '📋') {
  const suggestions = suggestIconsByName(title)
  const picked = window.prompt(
    `Select sticker icon for "${title}"\n` +
    `1) ${suggestions[0]}   2) ${suggestions[1]}   3) ${suggestions[2]}\n` +
    `You can type 1/2/3 or paste any emoji.`,
    suggestions[0]
  )
  if (!picked) return suggestions[0] || fallback
  const v = picked.trim()
  if (v === '1') return suggestions[0]
  if (v === '2') return suggestions[1]
  if (v === '3') return suggestions[2]
  return v
}

// ─── Sortable item in template palette ──────────────────────────────────────
function TemplateCard({ item, onAdd, dayIdx }) {
  return (
    <button
      onClick={() => onAdd(item, dayIdx)}
      className="flex items-center gap-2 w-full text-left px-3 py-2 rounded-lg hover:bg-blue-50 transition-all group border border-transparent hover:border-blue-200"
    >
      <span className="text-base">{categoryEmoji[item.category]}</span>
      <span className="text-xs font-medium text-gray-700 flex-1">{item.title}</span>
      <Plus size={13} className="text-blue-400 opacity-0 group-hover:opacity-100" />
    </button>
  )
}

// ─── Sortable task row ───────────────────────────────────────────────────────
function SortableTaskRow({ task, onRemove, onUpdate, isFocused = false }) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id: task._id })
  const style = { transform: CSS.Transform.toString(transform), transition }
  const taskStatus = task._taskStatus || ''
  const isPerformed = taskStatus === 'done' || taskStatus === 'skipped'

  return (
    <div ref={setNodeRef} style={style}
      className={`flex items-center gap-2 rounded-xl px-2 py-2 border transition-shadow ${
        isFocused
          ? 'ring-1 ring-blue-400 bg-blue-50 border-blue-200'
          : isPerformed
            ? (taskStatus === 'done' ? 'bg-emerald-50 border-emerald-200' : 'bg-amber-50 border-amber-200')
            : 'bg-gray-50 border-gray-100 hover:shadow-sm'
      }`}>
      <button {...attributes} {...listeners} disabled={isPerformed} className={`px-1 ${isPerformed ? 'text-slate-300 cursor-not-allowed' : 'text-gray-300 hover:text-gray-400 cursor-grab'}`}>
        <GripVertical size={14} />
      </button>

      <span className="text-sm shrink-0 w-6 h-6 flex items-center justify-center bg-white rounded-lg shadow-sm border border-gray-100">
        {task.icon || categoryEmoji[task.category]}
      </span>

      <input 
        value={task.title} 
        onChange={e => onUpdate(task._id, 'title', e.target.value)}
        disabled={isPerformed}
        className={`flex-1 text-xs bg-transparent outline-none font-bold min-w-0 px-1 ${isPerformed ? 'text-slate-700' : 'text-gray-700'}`} 
      />

      {/* Properly Visible Time Input */}
      <div className="flex items-center gap-1.5 bg-white border border-gray-200 rounded-lg px-2.5 py-1 shadow-sm shrink-0 min-w-[120px]">
        <input 
          type="time" 
          value={task.time_of_day || '08:00'} 
          onChange={e => onUpdate(task._id, 'time_of_day', e.target.value)}
          disabled={isPerformed}
          className={`text-xs font-black bg-transparent outline-none border-none w-full h-5 ${isPerformed ? 'text-slate-700 cursor-not-allowed' : 'text-gray-800 cursor-pointer'}`} 
        />
      </div>

      {isPerformed ? (
        <span className={`text-[10px] px-2 py-1 rounded font-bold shrink-0 ${taskStatus === 'done' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
          {taskStatus === 'done' ? 'Done' : 'Skipped'}
        </span>
      ) : (
        <button onClick={() => onRemove(task._id)} className="text-gray-300 hover:text-red-500 transition-colors p-1">
          <Trash2 size={14} />
        </button>
      )}
    </div>
  )
}

// ─── STT Microphone Input ────────────────────────────────────────────────────────
function MicrophoneInput({ onTranscript, autoStart = false }) {
  const [isListening, setIsListening] = useState(false);
  const recognitionRef = useRef(null);
  const autoStartedRef = useRef(false);

  const startListening = () => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) { toast.error('Browser dictation not supported.'); return; }
    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognitionRef.current = recognition;
    recognition.onresult = (event) => {
      let currentFinal = '';
      for (let i = event.resultIndex; i < event.results.length; ++i) {
        if (event.results[i].isFinal) currentFinal += event.results[i][0].transcript;
      }
      if (currentFinal) onTranscript(currentFinal);
    };
    recognition.onerror = () => setIsListening(false);
    recognition.onend = () => setIsListening(false);
    recognition.start();
    setIsListening(true);
  };

  useEffect(() => {
    if (autoStart && !autoStartedRef.current) {
      autoStartedRef.current = true;
      setTimeout(startListening, 400); // small delay to let UI settle
    }
    return () => { if (recognitionRef.current) recognitionRef.current.stop(); };
  }, [autoStart]);

  const toggleListen = () => {
    if (isListening) {
      if (recognitionRef.current) recognitionRef.current.stop();
      setIsListening(false);
    } else {
      startListening();
    }
  };

  return (
    <button
      onClick={toggleListen}
      className={`p-2 rounded-full transition-all flex items-center justify-center ${isListening ? 'bg-red-500 text-white animate-pulse shadow-md' : 'bg-blue-100 text-blue-600 hover:bg-blue-200'}`}
      title={isListening ? "Stop Dictation" : "Start Dictation"}
    >
      {isListening ? <MicOff size={14} /> : <Mic size={14} />}
    </button>
  );
}

// ─── AI Medical Extractor ───────────────────────────────────────────────────────
const MEDICINE_DB = MEDICINE_DB_LOWER

function extractMedAndFollowup(text) {
  if (!text || text.trim().length < 3) return { meds: [], followupDays: null };
  const lower = text.toLowerCase();
  const words = lower.split(/[\s,;.()]+/);

  // Extract medicines
  const foundMeds = new Set();
  MEDICINE_DB.forEach(med => {
    if (lower.includes(med)) {
      // Capitalize nicely
      foundMeds.add(med.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' '));
    }
  });
  // Also grab tokens that look like "DrugName Xmg" or "Xmg DrugName"
  const mgPattern = /\b([a-z]+(?:\s+[a-z]+)?)\s*(?:\d+(?:\.\d+)?\s*(?:mg|ml|mcg|gm|g|iu|units?))\b/gi;
  let m;
  while ((m = mgPattern.exec(text)) !== null) {
    const candidate = m[1].trim();
    if (candidate.length > 3) foundMeds.add(candidate.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' '));
  }

  // Extract follow-up days — STRICT patterns only, but find the LAST mentioned (if user rephrases)
  let followupDays = null;
  let lastIndex = -1;
  const fupPatterns = [
    /follow[\s-]?up\s+(?:after|in)\s+(\d+)\s+days?/ig,
    /follow[\s-]?up\s+(\d+)\s+days?/ig,
    /\b(?:review|revisit|re-visit)\s+(?:after|in)\s+(\d+)\s+days?/ig,
    /(\d+)\s+days?\s+(?:follow[\s-]?up|review|revisit)/ig,
    /next\s+(?:visit|appointment)\s+(?:after|in)\s+(\d+)\s+days?/ig,
    /come\s+back\s+after\s+(\d+)\s+days?/ig,
    /return\s+after\s+(\d+)\s+days?/ig,
    /see\s+me\s+after\s+(\d+)\s+days?/ig,
  ];
  
  for (const pat of fupPatterns) {
    const matches = [...text.matchAll(pat)];
    if (matches.length > 0) {
      const lastMatch = matches[matches.length - 1];
      if (lastMatch.index > lastIndex) {
        lastIndex = lastMatch.index;
        followupDays = parseInt(lastMatch[1], 10);
      }
    }
  }

  // Check tomorrow
  const tomorrowPattern = /(?:follow[\s-]?up|review|revisit)\s+tomorrow/ig;
  const tomorrowMatches = [...text.matchAll(tomorrowPattern)];
  if (tomorrowMatches.length > 0) {
    const lastMatch = tomorrowMatches[tomorrowMatches.length - 1];
    if (lastMatch.index > lastIndex) {
      lastIndex = lastMatch.index;
      followupDays = 1;
    }
  }

  return { meds: [...foundMeds], followupDays };
}

function AutoSavePopup({ prompt, onAccept, onReject }) {
  const [timeLeft, setTimeLeft] = useState(3);
  
  useEffect(() => {
     if (timeLeft <= 0) {
       onAccept(prompt.visitId, prompt.days);
       return;
     }
     const timer = setTimeout(() => setTimeLeft(t => t - 1), 1000);
     return () => clearTimeout(timer);
  }, [timeLeft, prompt.visitId, prompt.days]);
  
  return (
    <div className="fixed bottom-10 right-10 bg-white shadow-2xl border-2 border-blue-500 rounded-2xl p-5 z-[9999] max-w-sm w-full animate-in fade-in slide-in-from-bottom-5">
      <h3 className="font-extrabold text-blue-700 flex items-center gap-2 mb-2"><Stethoscope size={18} /> AI Detected Follow-up</h3>
      <p className="text-gray-700 text-sm font-medium mb-4">Patient should follow up in <span className="font-bold text-blue-600 px-1 py-0.5 bg-blue-50 rounded">{prompt.days} days</span>. Confirm?</p>
      
      <div className="flex items-center gap-2 mb-2">
        <button onClick={() => onAccept(prompt.visitId, prompt.days)} className="flex-1 bg-blue-600 text-white font-bold py-2 rounded-xl text-sm hover:bg-blue-700 shadow flex items-center justify-center gap-1"><CheckCircle size={14}/> Yes</button>
        <button onClick={onReject} className="flex-1 bg-red-50 text-red-600 border border-red-200 font-bold py-2 rounded-xl text-sm hover:bg-red-100 flex items-center justify-center gap-1"><X size={14}/> No</button>
      </div>
      
      <div className="w-full bg-gray-100 h-1.5 rounded-full overflow-hidden mt-3 relative">
         <div className="bg-blue-500 h-full absolute left-0 top-0 transition-all duration-1000 ease-linear" style={{ width: `${(timeLeft / 3) * 100}%` }}></div>
      </div>
      <p className="text-[10px] uppercase tracking-wider text-center text-gray-400 mt-2 font-bold animate-pulse">Auto-saving in {timeLeft}s</p>
    </div>
  );
}

function PatientHistoryTimeline({ events = [], filter = 'all', onFilterChange, maxHeightClass = 'max-h-[360px]' }) {
  const activeFilter = TIMELINE_FILTERS.find((f) => f.id === filter) || TIMELINE_FILTERS[0]
  const filteredEvents = (events || []).filter((event) => {
    if (!activeFilter.categories) return true
    return activeFilter.categories.includes(event.category)
  })
  const groupedByDate = filteredEvents.reduce((acc, event) => {
    const dateKey = format(new Date(event.ts), 'dd MMM yyyy')
    if (!acc[dateKey]) acc[dateKey] = []
    acc[dateKey].push(event)
    return acc
  }, {})
  const orderedDateKeys = Object.keys(groupedByDate).sort((a, b) => new Date(b) - new Date(a))
  const orderedCategories = ['Appointment', 'Billing', 'Condition', 'Medicines', 'Procedures']

  return (
    <div className="w-[340px] shrink-0 border-l border-slate-200 pl-2.5">
      <div className="sticky top-0 z-10 bg-white pb-1.5">
        <div className="flex items-center justify-between">
          <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Patient History</p>
          <FileText size={11} className="text-slate-400" />
        </div>
        <div className="mt-1 flex gap-1 overflow-x-auto whitespace-nowrap">
          {TIMELINE_FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => onFilterChange(f.id)}
              className={`rounded px-1.5 py-0.5 text-[10px] font-semibold border transition-colors ${
                filter === f.id
                  ? 'border-slate-300 bg-slate-100 text-slate-700'
                  : 'border-slate-200 bg-white text-slate-500 hover:bg-slate-50'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      <div className={`${maxHeightClass} overflow-y-auto pr-1 space-y-2.5`}>
        {orderedDateKeys.length === 0 ? (
          <p className="text-[11px] text-slate-400 py-3">No history entries</p>
        ) : orderedDateKeys.map((dateKey) => {
          const entries = groupedByDate[dateKey]
          const categoryMap = entries.reduce((acc, item) => {
            if (!acc[item.category]) acc[item.category] = []
            acc[item.category].push(item)
            return acc
          }, {})
          return (
            <div key={dateKey} className="space-y-1">
              <p className="text-[10px] font-bold tracking-wide text-slate-500 uppercase">{dateKey}</p>
              {orderedCategories.map((category) => {
                const categoryEntries = categoryMap[category] || []
                if (categoryEntries.length === 0) return null
                const meta = TIMELINE_CATEGORY_META[category]
                const Icon = meta.icon
                const sortedCategoryEntries = categoryEntries.sort((a, b) => new Date(a.ts) - new Date(b.ts))
                return (
                  <div key={`${dateKey}-${category}`} className="space-y-0.5">
                    <div className="flex items-center gap-1">
                      <Icon size={11} className={meta.iconClass} />
                      <span className="text-[10px] font-semibold text-slate-600">{category}</span>
                    </div>
                    <ul className="pl-4 space-y-0.5">
                      {sortedCategoryEntries.map((item) => (
                        <li key={item.id} className="list-disc text-[11px] leading-4 text-slate-700">
                          <span className="text-slate-500 mr-1">{formatTime(item.ts)}</span>
                          {item.text}
                        </li>
                      ))}
                    </ul>
                  </div>
                )
              })}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function TreatmentAuditTimeline({ events = [], onSelectEvent, maxHeightClass = 'max-h-[560px]' }) {
  const groupedByDate = (events || []).reduce((acc, event) => {
    const dateKey = format(new Date(event.timestamp), 'dd MMM yyyy')
    if (!acc[dateKey]) acc[dateKey] = []
    acc[dateKey].push(event)
    return acc
  }, {})
  const orderedDateKeys = Object.keys(groupedByDate).sort((a, b) => new Date(b) - new Date(a))

  return (
    <div className="h-full">
      <div className="flex items-center justify-between pb-1.5">
        <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Patient Timeline</p>
        <FileText size={11} className="text-slate-400" />
      </div>
      <div className={`${maxHeightClass} overflow-y-auto pr-1 space-y-2`}>
        {orderedDateKeys.length === 0 ? (
          <p className="text-[11px] text-slate-400 py-3">No audit events yet</p>
        ) : orderedDateKeys.map((dateKey) => {
          const entries = [...groupedByDate[dateKey]].sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
          return (
            <div key={dateKey} className="space-y-1">
              <p className="text-[10px] font-bold tracking-wide text-slate-500 uppercase">{dateKey}</p>
              <ul className="space-y-1">
                {entries.map((event) => {
                  const statusMeta = TREATMENT_EVENT_STATUS[event.event_type] || { icon: '⏳', color: 'text-slate-600' }
                  return (
                    <li key={event.id}>
                      <button
                        type="button"
                        onClick={() => onSelectEvent(event)}
                        className="w-full text-left rounded px-1.5 py-1 hover:bg-slate-50 transition-colors"
                        title={event.treatment_item_title ? `Open ${event.treatment_item_title}` : 'Timeline event'}
                      >
                        <div className="flex items-start gap-1.5">
                          <span className={`text-[10px] font-bold shrink-0 ${statusMeta.color}`}>{statusMeta.icon}</span>
                          <div className="min-w-0">
                            <p className="text-[11px] text-slate-700 leading-4">
                              <span className="text-slate-500 mr-1">{formatTime(event.timestamp)}</span>
                              <span className="font-semibold">{event.title}</span>
                            </p>
                            {event.description ? (
                              <p className="text-[10px] text-slate-500 leading-4 truncate">{event.description}</p>
                            ) : null}
                          </div>
                        </div>
                      </button>
                    </li>
                  )
                })}
              </ul>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ─── Enhanced Follow-Up Component with quick-day buttons ─────────────────────
function ManualFollowUp({ visitId, existingDate, quickDays = DEFAULT_FOLLOWUP_DAYS }) {
  const [date, setDate] = useState(existingDate || '');
  const [saved, setSaved] = useState(!!existingDate);
  const [editing, setEditing] = useState(!existingDate);

  useEffect(() => {
    if (existingDate) { setDate(existingDate); setSaved(true); setEditing(false); }
  }, [existingDate]);

  async function save(d) {
    const target = d || date;
    if (!target) return toast.error('Pick a date first');
    try {
      await api.patch(`/opd-visits/${visitId}/`, {
        follow_up_date: target,
        revisit_advice: `Follow up on ${format(new Date(target), 'dd MMM yyyy')}`,
      });
      setDate(target); setSaved(true); setEditing(false);
      toast.success(`✅ Follow-up: ${format(new Date(target), 'dd MMM yyyy')}`);
    } catch { toast.error('Failed to save'); }
  }

  async function clear() {
    try {
      await api.patch(`/opd-visits/${visitId}/`, { follow_up_date: null, revisit_advice: '' });
      setDate(''); setSaved(false); setEditing(true);
      toast('Follow-up cleared', { icon: '🗑️' });
    } catch { toast.error('Failed to clear'); }
  }

  if (saved && !editing) {
    return (
      <div className="flex items-center gap-2 bg-green-50 border border-green-200 rounded-xl px-3 py-2">
        <CheckCircle size={14} className="text-green-600 shrink-0" />
        <span className="text-xs font-bold text-green-700 flex-1">{format(new Date(date), 'dd MMM yyyy')}</span>
        <button onClick={() => setEditing(true)} className="text-[10px] font-bold px-2 py-1 bg-white border border-gray-200 text-gray-600 rounded-lg hover:bg-gray-50">Edit</button>
        <button onClick={clear} className="text-[10px] font-bold px-2 py-1 bg-red-50 border border-red-200 text-red-600 rounded-lg hover:bg-red-100">Clear</button>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5">
        {quickDays.map(d => (
          <button key={d} onClick={() => save(format(addDays(new Date(), d), 'yyyy-MM-dd'))}
            className="px-2.5 py-1 rounded-lg text-[10px] font-bold bg-blue-50 border border-blue-200 text-blue-700 hover:bg-blue-100 transition-colors">
            +{d}d
          </button>
        ))}
      </div>
      <div className="flex items-center gap-2">
        <input type="date" value={date} min={format(new Date(), 'yyyy-MM-dd')}
          onChange={e => { setDate(e.target.value); setSaved(false); }}
          className="flex-1 text-xs border border-gray-200 rounded-lg px-2.5 py-1.5 outline-none focus:border-blue-400" />
        <button onClick={() => save()}
          className="text-xs font-bold bg-blue-600 text-white px-3 py-1.5 rounded-lg hover:bg-blue-700 shrink-0">Save</button>
        {existingDate && <button onClick={() => setEditing(false)} className="text-xs font-bold bg-gray-100 text-gray-600 px-2.5 py-1.5 rounded-lg">Back</button>}
      </div>
    </div>
  );
}



// ─── Speech-to-Text Glow AI Transition Overlay ───────────────────────────────
function AITransitionOverlay({ onDone }) {
  useEffect(() => {
    const t = setTimeout(onDone, 2600);
    return () => clearTimeout(t);
  }, []);

  return (
    <div className="fixed inset-0 z-[9998] flex flex-col items-center justify-center overflow-hidden">
      {/* Dark background */}
      <div className="absolute inset-0 bg-black/80 backdrop-blur-md" />

      {/* Outer ambient glow that fills screen */}
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
        <div style={{
          width: '600px', height: '600px', borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(99,102,241,0.25) 0%, rgba(139,92,246,0.12) 40%, transparent 70%)',
          animation: 'ambientPulse 1.2s ease-in-out infinite',
        }} />
      </div>

      {/* Sound wave rings */}
      <div className="relative z-10 flex items-center justify-center" style={{ width: '280px', height: '280px' }}>
        {[1, 2, 3, 4].map(i => (
          <div key={i} className="absolute rounded-full border border-indigo-400/50" style={{
            width: `${i * 60}px`,
            height: `${i * 60}px`,
            animation: `sttRing 1.4s ease-out ${i * 0.18}s infinite`,
          }} />
        ))}

        {/* Mic button core */}
        <div className="relative z-20 flex items-center justify-center" style={{ animation: 'micPop 0.5s 0.2s ease-out both', opacity: 0 }}>
          {/* Outer glow circle */}
          <div className="absolute rounded-full" style={{
            width: '110px', height: '110px',
            background: 'radial-gradient(circle, rgba(139,92,246,0.6) 0%, transparent 70%)',
            animation: 'micGlow 1s ease-in-out infinite',
          }} />

          {/* Main mic circle */}
          <div style={{
            width: '80px', height: '80px', borderRadius: '50%',
            background: 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 50%, #a855f7 100%)',
            boxShadow: '0 0 40px rgba(139,92,246,0.8), 0 0 80px rgba(0, 0, 0, 0.4)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <Mic size={36} className="text-white" />
          </div>
        </div>
      </div>

      {/* Sound bars (equalizer) below mic */}
      <div className="relative z-10 flex items-end gap-1.5 mt-6" style={{ height: '32px' }}>
        {[0.4, 0.7, 1, 0.8, 0.5, 0.9, 0.6, 1, 0.7, 0.4].map((h, i) => (
          <div key={i} style={{
            width: '5px',
            borderRadius: '3px',
            background: 'linear-gradient(to top, #6366f1, #a855f7)',
            boxShadow: '0 0 6px rgba(139,92,246,0.7)',
            animation: `eqBar 0.6s ${i * 0.07}s ease-in-out infinite alternate`,
            height: '8px',
          }} />
        ))}
      </div>

      {/* Text */}
      <div className="relative z-10 text-center mt-6" style={{ animation: 'micPop 0.5s 0.6s ease-out both', opacity: 0 }}>
        <p className="text-white text-xl font-black tracking-tight">Listening…</p>
        <p className="text-purple-300 text-sm mt-1 font-medium">AI is active — dictate your notes 🎙️</p>
      </div>

      <style>{`
        @keyframes ambientPulse {
          0%, 100% { transform: scale(1); opacity: 0.8; }
          50%       { transform: scale(1.15); opacity: 1; }
        }
        @keyframes sttRing {
          0%   { transform: scale(0.6); opacity: 0.8; }
          100% { transform: scale(1.6); opacity: 0; }
        }
        @keyframes micGlow {
          0%, 100% { transform: scale(1);   opacity: 0.6; }
          50%       { transform: scale(1.3); opacity: 1; }
        }
        @keyframes micPop {
          from { transform: scale(0.4); opacity: 0; }
          to   { transform: scale(1);   opacity: 1; }
        }
        @keyframes eqBar {
          from { height: 4px;  opacity: 0.5; }
          to   { height: 28px; opacity: 1; }
        }
      `}</style>
    </div>
  );
}


function newRxItemKey() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID()
  return `rx-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

function mergeCustomSalts(prev, row) {
  if (!row?.name) return prev
  const norm = normalizeSaltName(row.name)
  const without = (prev || []).filter((s) => normalizeSaltName(s.name) !== norm)
  return [row, ...without]
}

// ─── Inline Rx Panel (embedded prescription, no modal) ───────────────────────
function InlineRxPanel({
  visit,
  defaultDayOptions = DEFAULT_RX_DAYS,
  dosagePatternOptions = DEFAULT_DOSAGE_PATTERNS,
  timingOptions = DEFAULT_TIMING_OPTIONS,
  onDraftChange,
}) {
  const [open, setOpen] = useState(true)
  const [branches, setBranches] = useState([])
  const [branchId, setBranchId] = useState('')
  const [manualSaltMode, setManualSaltMode] = useState(false)
  const [customSalts, setCustomSalts] = useState([])
  const [saltResults, setSaltResults] = useState([])
  const [search, setSearch] = useState('')
  const [results, setResults] = useState([])
  const [searching, setSearching] = useState(false)
  const [items, setItems] = useState([])
  const [globalDays, setGlobalDays] = useState(3)
  const searchRef = useRef(null)
  const debouncedQ = useDebouncedValue(search, 320)

  useEffect(() => {
    if (!open || branches.length) return
    api.get('/auth/pharmacies/').then(r => {
      const list = r.data?.data || r.data?.results || []
      setBranches(list)
      if (list.length) setBranchId(pickDefaultPharmacyBranchId(list))
    }).catch(() => {})
  }, [open, branches.length])

  useEffect(() => {
    if (!open) return
    api.get('/doctors/custom-rx-salts/')
      .then(r => setCustomSalts(Array.isArray(r.data?.data) ? r.data.data : []))
      .catch(() => {})
  }, [open])

  useEffect(() => {
    if (branches.length === 0 && !manualSaltMode) setManualSaltMode(true)
  }, [branches.length, manualSaltMode])

  useEffect(() => {
    if (manualSaltMode) {
      setResults([])
      return
    }
    if (!branchId || debouncedQ.length < 1) { setResults([]); return }
    setSearching(true)
    api.get('/pharmacy/doctor-stock-search/', { params: { pharmacy_id: branchId, q: debouncedQ } })
      .then(r => {
        const list = Array.isArray(r.data?.data || r.data) ? (r.data?.data || r.data) : []
        const q = String(debouncedQ || '').trim().toLowerCase()
        const ranked = [...list].sort((a, b) => {
          const rank = (row) => {
            const n = String(row?.medicine?.name || '').trim().toLowerCase()
            const s = String(row?.medicine?.sku || '').trim().toLowerCase()
            if (n === q || s === q) return 0
            if (n.startsWith(q)) return 1
            if (s.startsWith(q)) return 2
            if (n.includes(q)) return 3
            return 4
          }
          return rank(a) - rank(b)
        })
        setResults(ranked)
      })
      .catch(() => setResults([]))
      .finally(() => setSearching(false))
  }, [debouncedQ, branchId, manualSaltMode])

  useEffect(() => {
    if (!manualSaltMode) {
      setSaltResults([])
      return
    }
    const extra = customSalts.map(s => s.name)
    setSaltResults(filterCommonSalts(debouncedQ, extra))
  }, [debouncedQ, manualSaltMode, customSalts])

  const rememberCustomSalt = async (name) => {
    const trimmed = String(name || '').trim()
    if (trimmed.length < 2 || isCommonSaltName(trimmed)) return
    try {
      const { data } = await api.post('/doctors/custom-rx-salts/', { name: trimmed })
      const row = data?.data
      if (row) setCustomSalts(prev => mergeCustomSalts(prev, row))
    } catch { /* don't block prescribing */ }
  }

  const calculateQty = (pattern, days) => {
    const matched = dosagePatternOptions.find((p) => String(p.v) === String(pattern))
    const eq = Number(matched?.q)
    const perDay = Number.isFinite(eq) && eq > 0
      ? eq
      : String(pattern).split('-').reduce((acc, curr) => acc + (Number(curr) || 0), 0)
    return Math.ceil(perDay * (Number(days) || 1)) || 1
  }

  const handleGlobalDaysChange = (d) => {
    setGlobalDays(d)
    setItems(p => p.map(it => ({ ...it, days: d, qty: calculateQty(it.pattern || dosagePatternOptions[0]?.v || '1-0-1', d) })))
  }

  const toggleManualSaltMode = () => {
    setManualSaltMode(m => !m)
    setSearch('')
    setResults([])
    setSaltResults([])
    searchRef.current?.focus()
  }

  const addStockItem = pick => {
    if (items.some(i => i.source !== 'manual' && String(i.batch?.id) === String(pick.batch?.id))) {
      return toast.error('Already added')
    }
    const defaultPattern = dosagePatternOptions[0]?.v || '1-0-1'
    const defaultTiming = timingOptions[0]?.v || 'AF'
    setItems(p => [...p, {
      key: newRxItemKey(),
      source: 'stock',
      ...pick,
      pattern: defaultPattern,
      qty: calculateQty(defaultPattern, globalDays),
      days: globalDays,
      timing: defaultTiming,
    }])
    setSearch('')
    setResults([])
    searchRef.current?.focus()
  }

  const addManualItem = (name) => {
    const trimmed = String(name || '').trim()
    if (trimmed.length < 2) return toast.error('Enter at least 2 characters')
    const norm = normalizeSaltName(trimmed)
    if (items.some(i => i.source === 'manual' && normalizeSaltName(i.manualName) === norm)) {
      return toast.error('Already added')
    }
    const defaultPattern = dosagePatternOptions[0]?.v || '1-0-1'
    const defaultTiming = timingOptions[0]?.v || 'AF'
    setItems(p => [...p, {
      key: newRxItemKey(),
      source: 'manual',
      manualName: trimmed,
      pattern: defaultPattern,
      qty: calculateQty(defaultPattern, globalDays),
      days: globalDays,
      timing: defaultTiming,
    }])
    rememberCustomSalt(trimmed)
    setSearch('')
    setSaltResults([])
    searchRef.current?.focus()
  }

  const upd = (idx, f, v) => setItems(p => p.map((it, i) => {
    if (i !== idx) return it
    const updated = { ...it, [f]: v }
    if (f === 'pattern' || f === 'days') {
      updated.qty = calculateQty(updated.pattern, updated.days)
    }
    return updated
  }))

  const handleManualNameBlur = (idx, name) => {
    const trimmed = String(name || '').trim()
    if (trimmed.length >= 2) rememberCustomSalt(trimmed)
  }

  const rem = idx => setItems(p => p.filter((_, i) => i !== idx))

  const searchTrimmed = String(search || '').trim()
  const showAddCustomRow = manualSaltMode && searchTrimmed.length >= 2 && saltResults.length === 0
    && !items.some(i => i.source === 'manual' && normalizeSaltName(i.manualName) === normalizeSaltName(searchTrimmed))

  useEffect(() => {
    if (!onDraftChange) return
    const selectedBranch = branches.find((b) => String(b.id) === String(branchId))
    onDraftChange({
      visitId: visit.id,
      branchId,
      branchLabel: selectedBranch?.label || selectedBranch?.name || '',
      items,
    })
  }, [visit.id, branchId, items, branches, onDraftChange])

  return (
    <div className="border border-emerald-200 rounded-xl overflow-hidden">
      <button onClick={() => setOpen(o => !o)}
        className={`w-full flex items-center gap-2 px-3 py-2.5 text-left transition-colors ${
          open ? 'bg-emerald-600 text-white' : 'bg-emerald-50 hover:bg-emerald-100 text-emerald-700'
        }`}>
        <Pill size={14} />
        <span className="text-xs font-bold flex-1">💊 Pharmacy Prescription</span>
        {items.length > 0 && <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
          open ? 'bg-white/20 text-white' : 'bg-emerald-200 text-emerald-800'
        }`}>{items.length} added</span>}
        <span className="text-[10px] opacity-70">{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div className="bg-white">
          {(branches.length >= 1 || branches.length === 0) && (
            <div className="px-3 py-1.5 border-b border-slate-100 flex items-center gap-2 flex-wrap">
              {branches.length >= 1 && (
                <>
                  <span className="text-[10px] font-bold text-slate-500 uppercase shrink-0">Branch:</span>
                  <select value={branchId} onChange={e => { setBranchId(e.target.value); setResults([]) }}
                    className="text-[11px] border border-slate-200 rounded px-2 py-0.5 outline-none w-36 sm:w-44 max-w-[50%] shrink-0">
                    {branches.map(b => <option key={b.id} value={b.id}>{b.label || b.name}</option>)}
                  </select>
                </>
              )}
              <button type="button" onClick={toggleManualSaltMode}
                className={`ml-auto shrink-0 px-3 h-7 rounded-lg text-[10px] font-black border whitespace-nowrap transition-colors ${
                  manualSaltMode
                    ? 'bg-amber-200 border-amber-400 text-amber-950 ring-2 ring-amber-300/60'
                    : 'bg-amber-50 border-amber-200 text-amber-900 hover:bg-amber-100'
                }`}>
                + Not in pharma
              </button>
            </div>
          )}

          {/* Global Days */}
          <div className="px-3 pt-2">
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Default Days:</span>
              <div className="flex flex-wrap gap-1">
                {defaultDayOptions.map(d => (
                  <button key={d} onClick={() => handleGlobalDaysChange(d)}
                    className={`px-2 py-0.5 rounded text-[10px] font-bold transition-all border ${globalDays === d ? 'bg-emerald-500 text-white border-emerald-500 shadow-sm' : 'bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100'}`}>
                    {d}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Search */}
          <div className="px-3 pt-2 pb-1">
            <div className="relative">
              <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
              <input ref={searchRef} value={search} onChange={e => setSearch(e.target.value)}
                placeholder={manualSaltMode ? 'Search common salts (Paracetamol, Amoxicillin...)' : 'Search medicine...'}
                autoFocus
                className="w-full h-8 pl-8 pr-3 text-[12px] border border-slate-200 rounded-lg outline-none focus:border-emerald-400 focus:ring-1 focus:ring-emerald-400/30" />
              {searching && !manualSaltMode && <Loader2 size={11} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-emerald-500 animate-spin" />}
            </div>
          </div>

          {/* Stock search results */}
          {!manualSaltMode && results.length > 0 && (
            <div className="mx-3 mb-2 border border-slate-200 rounded-lg overflow-hidden max-h-40 overflow-y-auto">
              {results.slice(0, 8).map((pick, i) => {
                const added = items.some(it => it.source !== 'manual' && String(it.batch?.id) === String(pick.batch?.id))
                return (
                  <button key={i} onClick={() => !added && addStockItem(pick)} disabled={added}
                    className={`w-full text-left flex items-center gap-2 px-2.5 py-1.5 transition-colors border-b border-slate-100 last:border-0 ${
                      added ? 'opacity-40 cursor-default bg-slate-50' : 'hover:bg-emerald-50'
                    }`}>
                    <Pill size={11} className="text-emerald-600 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="text-[11px] font-bold text-slate-900 truncate">
                        {pick.medicine.name}
                        {pick.medicine.sku ? <span className="ml-1 text-[9px] font-semibold text-slate-500">({pick.medicine.sku})</span> : null}
                      </div>
                      <div className="text-[10px] text-slate-500">
                        {pick.batch.batch_no} · Stock: <span className="font-bold text-emerald-700">{pick.batch.stock}</span>
                      </div>
                    </div>
                    <span className="text-[11px] font-bold text-emerald-700 shrink-0">₹{Number(pick.batch.sale_rate).toFixed(0)}</span>
                    {added ? <CheckCircle size={11} className="text-emerald-400" /> : <Plus size={11} className="text-emerald-500" />}
                  </button>
                )
              })}
            </div>
          )}

          {/* Manual salt search results */}
          {manualSaltMode && (saltResults.length > 0 || showAddCustomRow) && (
            <div className="mx-3 mb-2 border border-amber-200 rounded-lg overflow-hidden max-h-40 overflow-y-auto bg-amber-50/30">
              {saltResults.map((name, i) => {
                const added = items.some(it => it.source === 'manual' && normalizeSaltName(it.manualName) === normalizeSaltName(name))
                return (
                  <button key={`salt-${i}`} type="button" onClick={() => !added && addManualItem(name)} disabled={added}
                    className={`w-full text-left flex items-center gap-2 px-2.5 py-1.5 transition-colors border-b border-amber-100 last:border-0 ${
                      added ? 'opacity-40 cursor-default bg-slate-50' : 'hover:bg-amber-50'
                    }`}>
                    <Pill size={11} className="text-amber-700 shrink-0" />
                    <span className="text-[11px] font-bold text-slate-900 truncate flex-1">{name}</span>
                    {added ? <CheckCircle size={11} className="text-amber-500" /> : <Plus size={11} className="text-amber-600" />}
                  </button>
                )
              })}
              {showAddCustomRow && (
                <button type="button" onClick={() => addManualItem(searchTrimmed)}
                  className="w-full text-left flex items-center gap-2 px-2.5 py-2 bg-amber-100 hover:bg-amber-200 transition-colors border-t border-amber-200">
                  <Plus size={11} className="text-amber-800 shrink-0" />
                  <span className="text-[11px] font-black text-amber-950">Add &quot;{searchTrimmed}&quot; as medicine</span>
                </button>
              )}
            </div>
          )}

          {/* Added items */}
          {items.length > 0 && (
            <div className="px-3 pb-2 space-y-1.5 mt-1">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-bold text-slate-500 uppercase">Prescription ({items.length})</span>
                <button onClick={() => setItems([])} className="text-[9px] text-rose-500 font-bold hover:underline">Clear all</button>
              </div>
              <div className="max-h-56 overflow-y-auto pr-1 space-y-1">
                {items.map((item, idx) => (
                  <div key={item.key || idx} className="bg-white border border-slate-200 rounded-lg px-2 py-1.5 shadow-sm flex items-center gap-1.5 min-w-0">
                    {item.source === 'manual' ? (
                      <>
                        <span className="text-[9px] font-black text-amber-700 uppercase shrink-0">Manual</span>
                        <input value={item.manualName || ''} onChange={e => upd(idx, 'manualName', e.target.value)}
                          onBlur={e => handleManualNameBlur(idx, e.target.value)}
                          placeholder="Medicine name"
                          className="w-32 sm:w-36 text-[10px] font-bold border border-amber-200 rounded px-1.5 h-6 bg-amber-50/50 outline-none focus:border-amber-400 shrink-0 min-w-0" />
                      </>
                    ) : (
                      <>
                        <Pill size={12} className="text-emerald-500 shrink-0" />
                        <p className="w-32 sm:w-40 text-[10px] font-bold text-slate-900 truncate" title={item.medicine?.name}>{item.medicine?.name}</p>
                      </>
                    )}

                    <select value={item.pattern} onChange={e => upd(idx, 'pattern', e.target.value)} title="Dosage Pattern"
                      className="w-[58px] h-6 text-[9px] font-bold text-center border border-slate-200 rounded bg-white outline-none cursor-pointer focus:border-emerald-400 transition-colors shrink-0">
                      {dosagePatternOptions.map(p => <option key={p.v} value={p.v}>{p.v}</option>)}
                    </select>
                    <span className="text-[9px] text-slate-400 shrink-0">×</span>
                    <input type="number" min="1" value={item.days} onChange={e => upd(idx, 'days', e.target.value)} title="Days"
                      className="w-8 h-6 text-[10px] font-bold text-center border border-slate-200 rounded bg-white outline-none focus:border-blue-400 transition-colors shrink-0" />
                    <span className="text-[9px] text-slate-400 shrink-0">=</span>
                    <input type="number" min="1" value={item.qty} onChange={e => upd(idx, 'qty', e.target.value)} title="Total Quantity"
                      className="w-8 h-6 text-[10px] font-bold text-center border border-emerald-200 rounded bg-emerald-50 text-emerald-700 outline-none focus:border-emerald-500 transition-colors shrink-0" />
                    <span className="text-[9px] text-emerald-600 font-semibold whitespace-nowrap shrink-0">Eq:{calculateQty(item.pattern, item.days)}</span>

                    <select value={item.timing} onChange={e => upd(idx, 'timing', e.target.value)} title="Timing"
                      className="w-24 h-6 text-[9px] font-bold border border-slate-200 rounded bg-white outline-none cursor-pointer focus:border-purple-400 transition-colors shrink-0">
                      {timingOptions.map(t => <option key={t.v} value={t.v}>{t.l}</option>)}
                    </select>
                    <button onClick={() => rem(idx)} className="text-slate-300 hover:text-rose-500 shrink-0 transition-colors">
                      <Trash2 size={13} />
                    </button>
                  </div>
                ))}
              </div>

              <p className="text-[10px] text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-2 py-1">
                {items.some(i => i.source === 'manual')
                  ? 'Stock medicines go to pharmacy draft on Mark Done. Manual (not in pharma) lines are noted in remarks.'
                  : 'Medicine draft will be sent automatically when you click Mark Done.'}
              </p>
            </div>
          )}

          {!items.length && search.length < 1 && (
            <div className="py-4 text-center text-slate-400 text-[11px]">
              <Pill size={22} className="mx-auto mb-1 opacity-30" />
              {manualSaltMode ? 'Search common salts or add a custom medicine name' : 'Search and add medicines above'}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function DayOptionsSettings({
  open,
  onClose,
  followupDays,
  rxDays,
  dosagePatterns,
  timingOptions,
  onSave,
  saving = false,
}) {
  const [followupText, setFollowupText] = useState((followupDays || DEFAULT_FOLLOWUP_DAYS).join(', '))
  const [rxText, setRxText] = useState((rxDays || DEFAULT_RX_DAYS).join(', '))
  const [patternRows, setPatternRows] = useState(dosagePatterns || DEFAULT_DOSAGE_PATTERNS)
  const [timingRows, setTimingRows] = useState(timingOptions || DEFAULT_TIMING_OPTIONS)
  const [dragging, setDragging] = useState(null)

  useEffect(() => {
    if (!open) return
    setFollowupText((followupDays || DEFAULT_FOLLOWUP_DAYS).join(', '))
    setRxText((rxDays || DEFAULT_RX_DAYS).join(', '))
    setPatternRows(dosagePatterns || DEFAULT_DOSAGE_PATTERNS)
    setTimingRows(timingOptions || DEFAULT_TIMING_OPTIONS)
  }, [open, followupDays, rxDays, dosagePatterns, timingOptions])

  const moveRow = (setter, rows, idx, dir) => {
    const next = [...rows]
    const target = idx + dir
    if (target < 0 || target >= next.length) return
    ;[next[idx], next[target]] = [next[target], next[idx]]
    setter(next)
  }

  const addRow = (setter, rows, codePrefix) => {
    const nextCode = `${codePrefix}${rows.length + 1}`
    setter([...rows, { v: nextCode, l: nextCode }])
  }

  const updateRow = (setter, rows, idx, key, value) => {
    setter(rows.map((r, i) => (i === idx ? { ...r, [key]: value } : r)))
  }

  const removeRow = (setter, rows, idx) => {
    if (rows.length <= 1) return
    setter(rows.filter((_, i) => i !== idx))
  }

  const onDragStart = (listKey, idx) => {
    setDragging({ listKey, idx })
  }

  const onDropRow = (listKey, targetIdx) => {
    if (!dragging || dragging.listKey !== listKey || dragging.idx === targetIdx) return
    const rows = listKey === 'pattern' ? [...patternRows] : [...timingRows]
    const [picked] = rows.splice(dragging.idx, 1)
    rows.splice(targetIdx, 0, picked)
    if (listKey === 'pattern') setPatternRows(rows)
    else setTimingRows(rows)
    setDragging(null)
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-[9999] bg-black/30 backdrop-blur-[1px] flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-white rounded-2xl border border-slate-200 shadow-2xl">
        <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
          <div>
            <p className="text-sm font-bold text-slate-800">Doctor Day Options</p>
            <p className="text-[11px] text-slate-500">Customize quick day buttons (comma separated)</p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700">
            <X size={16} />
          </button>
        </div>

        <div className="p-4 space-y-3 max-h-[72vh] overflow-auto">
          <div>
            <label className="text-[11px] font-bold uppercase text-slate-500">Follow-up Quick Days</label>
            <input
              value={followupText}
              onChange={(e) => setFollowupText(e.target.value)}
              placeholder="3, 5, 7, 10, 14, 30"
              className="mt-1 w-full h-9 px-3 text-[12px] border border-slate-200 rounded-lg outline-none focus:border-blue-400"
            />
          </div>
          <div>
            <label className="text-[11px] font-bold uppercase text-slate-500">Pharmacy Default Days</label>
            <input
              value={rxText}
              onChange={(e) => setRxText(e.target.value)}
              placeholder="1, 3, 5, 7, 10, 14, 30"
              className="mt-1 w-full h-9 px-3 text-[12px] border border-slate-200 rounded-lg outline-none focus:border-emerald-400"
            />
          </div>
          <p className="text-[10px] text-slate-400">Allowed range: 1 to 365 days.</p>

          <div>
            <div className="flex items-center justify-between">
              <label className="text-[11px] font-bold uppercase text-slate-500">Dosage Patterns (orderable)</label>
              <button onClick={() => addRow(setPatternRows, patternRows, 'P')} className="text-[11px] font-semibold text-blue-600">+ Add</button>
            </div>
            <div className="mt-1 space-y-1">
              {patternRows.map((row, idx) => (
                <div
                  key={`pat-${idx}`}
                  draggable
                  onDragStart={() => onDragStart('pattern', idx)}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={() => onDropRow('pattern', idx)}
                  onDragEnd={() => setDragging(null)}
                  className={`grid grid-cols-12 gap-1 items-center rounded ${dragging?.listKey === 'pattern' && dragging?.idx === idx ? 'opacity-50' : ''}`}
                >
                  <input value={row.v} onChange={(e) => updateRow(setPatternRows, patternRows, idx, 'v', e.target.value)}
                    className="col-span-2 h-8 px-2 text-[11px] border border-slate-200 rounded" placeholder="Code" />
                  <input value={row.l} onChange={(e) => updateRow(setPatternRows, patternRows, idx, 'l', e.target.value)}
                    className="col-span-4 h-8 px-2 text-[11px] border border-slate-200 rounded" placeholder="Label" />
                  <input value={row.q ?? ''} onChange={(e) => updateRow(setPatternRows, patternRows, idx, 'q', e.target.value)}
                    className="col-span-2 h-8 px-2 text-[11px] border border-emerald-200 rounded bg-emerald-50 text-emerald-700" placeholder="Eq qty" />
                  <button type="button" className="col-span-1 text-[11px] border rounded h-8 cursor-move" title="Drag to reorder">⋮⋮</button>
                  <button onClick={() => moveRow(setPatternRows, patternRows, idx, -1)} className="col-span-1 text-[11px] border rounded h-8">↑</button>
                  <button onClick={() => moveRow(setPatternRows, patternRows, idx, 1)} className="col-span-1 text-[11px] border rounded h-8">↓</button>
                  <button onClick={() => removeRow(setPatternRows, patternRows, idx)} className="col-span-2 text-[11px] border border-rose-200 text-rose-600 rounded h-8">X</button>
                </div>
              ))}
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between">
              <label className="text-[11px] font-bold uppercase text-slate-500">Food/Timing Options (orderable)</label>
              <button onClick={() => addRow(setTimingRows, timingRows, 'T')} className="text-[11px] font-semibold text-blue-600">+ Add</button>
            </div>
            <div className="mt-1 space-y-1">
              {timingRows.map((row, idx) => (
                <div
                  key={`time-${idx}`}
                  draggable
                  onDragStart={() => onDragStart('timing', idx)}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={() => onDropRow('timing', idx)}
                  onDragEnd={() => setDragging(null)}
                  className={`grid grid-cols-12 gap-1 items-center rounded ${dragging?.listKey === 'timing' && dragging?.idx === idx ? 'opacity-50' : ''}`}
                >
                  <input value={row.v} onChange={(e) => updateRow(setTimingRows, timingRows, idx, 'v', e.target.value)}
                    className="col-span-3 h-8 px-2 text-[11px] border border-slate-200 rounded" placeholder="Code" />
                  <input value={row.l} onChange={(e) => updateRow(setTimingRows, timingRows, idx, 'l', e.target.value)}
                    className="col-span-5 h-8 px-2 text-[11px] border border-slate-200 rounded" placeholder="Label" />
                  <button type="button" className="col-span-1 text-[11px] border rounded h-8 cursor-move" title="Drag to reorder">⋮⋮</button>
                  <button onClick={() => moveRow(setTimingRows, timingRows, idx, -1)} className="col-span-1 text-[11px] border rounded h-8">↑</button>
                  <button onClick={() => moveRow(setTimingRows, timingRows, idx, 1)} className="col-span-1 text-[11px] border rounded h-8">↓</button>
                  <button onClick={() => removeRow(setTimingRows, timingRows, idx)} className="col-span-1 text-[11px] border border-rose-200 text-rose-600 rounded h-8">X</button>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="px-4 py-3 border-t border-slate-100 flex justify-end gap-2">
          <button onClick={onClose} className="px-3 py-1.5 text-[12px] font-semibold rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50">
            Cancel
          </button>
          <button
            disabled={saving}
            onClick={() => onSave(followupText, rxText, patternRows, timingRows)}
            className="px-3 py-1.5 text-[12px] font-semibold rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-60"
          >
            {saving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── OPD Tab ─────────────────────────────────────────────────────────────────
function OPDTab({ aiMode = false }) {
  const [visits, setVisits] = useState([])
  const [loading, setLoading] = useState(true)
  const today = format(new Date(), 'yyyy-MM-dd')
  const pollingRef = useRef(null)

  const [autoSavePrompt, setAutoSavePrompt] = useState(null)
  const prevFollowupRef = useRef({})
  const noteStartRef = useRef({})
  const [notesDraftByVisit, setNotesDraftByVisit] = useState({})
  const [historyByVisit, setHistoryByVisit] = useState({})
  const [historyFilters, setHistoryFilters] = useState({})
  const [historyPreviewVisit, setHistoryPreviewVisit] = useState(null)
  const [rxDraftByVisit, setRxDraftByVisit] = useState({})
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [settingsSaving, setSettingsSaving] = useState(false)
  const [followupDayOptions, setFollowupDayOptions] = useState(DEFAULT_FOLLOWUP_DAYS)
  const [rxDayOptions, setRxDayOptions] = useState(DEFAULT_RX_DAYS)
  const [dosagePatternOptions, setDosagePatternOptions] = useState(DEFAULT_DOSAGE_PATTERNS)
  const [timingOptions, setTimingOptions] = useState(DEFAULT_TIMING_OPTIONS)
  const slipLayoutRef = useRef(null)

  const pushHistoryEvent = ({ visitId, category, text, ts = new Date().toISOString() }) => {
    if (!visitId || !category || !text) return
    setHistoryByVisit((prev) => {
      const current = prev[visitId] || []
      const next = [
        ...current,
        { id: `${visitId}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, category, text, ts },
      ].sort((a, b) => new Date(b.ts) - new Date(a.ts))
      return { ...prev, [visitId]: next }
    })
  }

  const saveDaySettings = async (followupText, rxText, nextPatterns, nextTimings) => {
    const nextFollowup = parseDayOptionText(followupText, DEFAULT_FOLLOWUP_DAYS)
    const nextRx = parseDayOptionText(rxText, DEFAULT_RX_DAYS)
    const normalizedPatterns = normalizeDosagePatterns(nextPatterns, DEFAULT_DOSAGE_PATTERNS)
    const normalizedTimings = normalizeOptionPairs(nextTimings, DEFAULT_TIMING_OPTIONS)
    setSettingsSaving(true)
    try {
      const { data } = await api.put('/doctors/portal-preferences/', {
        followup_day_options: nextFollowup,
        rx_default_day_options: nextRx,
        dosage_pattern_options: normalizedPatterns,
        food_timing_options: normalizedTimings,
      })
      const payload = data?.data || {}
      setFollowupDayOptions(normalizeDayOptions(payload.followup_day_options, nextFollowup))
      setRxDayOptions(normalizeDayOptions(payload.rx_default_day_options, nextRx))
      setDosagePatternOptions(normalizeDosagePatterns(payload.dosage_pattern_options, normalizedPatterns))
      setTimingOptions(normalizeOptionPairs(payload.food_timing_options, normalizedTimings))
      setSettingsOpen(false)
      toast.success('Doctor day options updated')
    } catch {
      toast.error('Failed to save doctor day options')
    } finally {
      setSettingsSaving(false)
    }
  }

  const inferCategoryFromNote = (text = '') => {
    const lower = text.toLowerCase()
    if (/(tablet|capsule|syrup|mg|ml|od|bd|tds|qid|drug|medicine|inj|injection|antibiotic)/.test(lower)) return 'Medicines'
    if (/(procedure|suturing|dressing|drain|stitch|minor ot|operation|debridement)/.test(lower)) return 'Procedures'
    if (/(bill|paid|payment|invoice|amount|discount)/.test(lower)) return 'Billing'
    if (/(follow up|review on|next visit|appointment|revisit)/.test(lower)) return 'Appointment'
    return 'Condition'
  }

  useEffect(() => {
    if (!aiMode) return;
    const inProg = visits.filter(v => v.status === 'in_progress' || v.status === 'in_consultation');
    inProg.forEach(v => {
      const { followupDays } = extractMedAndFollowup(v.chief_complaint);
      const prev = prevFollowupRef.current[v.id];
      if (followupDays && followupDays !== prev) {
        const fupISODate = format(addDays(new Date(), followupDays), 'yyyy-MM-dd');
        if (v.follow_up_date !== fupISODate) {
          setAutoSavePrompt({ visitId: v.id, days: followupDays, token: Date.now() });
        }
        prevFollowupRef.current[v.id] = followupDays;
      } else if (!followupDays && prev) {
        prevFollowupRef.current[v.id] = null;
      }
    });
  }, [visits, aiMode]);

  useEffect(() => {
    setHistoryByVisit((prev) => {
      let changed = false
      const next = { ...prev }
      visits.forEach((v) => {
        if (!next[v.id]) {
          changed = true
          next[v.id] = [{
            id: `seed-${v.id}`,
            category: 'Appointment',
            text: `Token #${v.token_number} visit opened`,
            ts: new Date().toISOString(),
          }]
        }
      })
      return changed ? next : prev
    })
  }, [visits])

  const acceptFollowUp = (visitId, days) => {
    const fupISODate = format(addDays(new Date(), days), 'yyyy-MM-dd');
    api.patch(`/opd-visits/${visitId}/`, {
      revisit_advice: `Follow up after ${days} days`,
      follow_up_date: fupISODate,
    }).then(() => {
      setVisits(prev => prev.map(x => x.id === visitId ? { ...x, follow_up_date: fupISODate } : x));
      toast.success(`✅ Follow-up saved automatically!`);
    }).catch(() => {});
    setAutoSavePrompt(null);
  };

  useEffect(() => {
    let alive = true
    loadOpdSlipLayoutForPrint()
      .then((layout) => {
        if (!alive || !layout) return
        slipLayoutRef.current = layout
      })
      .catch(() => {})
    return () => { alive = false }
  }, [])

  useEffect(() => {
    fetchVisits()
    pollingRef.current = setInterval(fetchVisits, 15000)
    return () => clearInterval(pollingRef.current)
  }, [])

  useEffect(() => {
    let alive = true
    api.get('/doctors/portal-preferences/')
      .then(({ data }) => {
        if (!alive) return
        const payload = data?.data || {}
        setFollowupDayOptions(normalizeDayOptions(payload.followup_day_options, DEFAULT_FOLLOWUP_DAYS))
        setRxDayOptions(normalizeDayOptions(payload.rx_default_day_options, DEFAULT_RX_DAYS))
        setDosagePatternOptions(normalizeDosagePatterns(payload.dosage_pattern_options, DEFAULT_DOSAGE_PATTERNS))
        setTimingOptions(normalizeOptionPairs(payload.food_timing_options, DEFAULT_TIMING_OPTIONS))
      })
      .catch(() => {
        if (!alive) return
        setFollowupDayOptions(DEFAULT_FOLLOWUP_DAYS)
        setRxDayOptions(DEFAULT_RX_DAYS)
        setDosagePatternOptions(DEFAULT_DOSAGE_PATTERNS)
        setTimingOptions(DEFAULT_TIMING_OPTIONS)
      })
    return () => { alive = false }
  }, [])

  async function fetchVisits() {
    setLoading(true)
    try {
      const { data } = await api.get(`/opd-visits/?visit_date=${today}&limit=1000`)
      setVisits(data.results || data)
    } catch { toast.error('Failed to load OPD') }
    finally { setLoading(false) }
  }

  /** API lists visits by newest first; queue call must be FIFO by token / queue number. */
  const waiting = useMemo(
    () =>
      [...visits.filter((v) => v.status === 'waiting')].sort((a, b) => {
        const na = Number(a.queue_number ?? a.token_number ?? 0)
        const nb = Number(b.queue_number ?? b.token_number ?? 0)
        return na - nb
      }),
    [visits],
  )
  const inProgress = visits.filter((v) => v.status === 'in_progress' || v.status === 'in_consultation')
  const done = visits.filter((v) => v.status === 'completed')
  const activeVisit = inProgress[0] || null
  const latestDoneVisit = done[0] || null

  async function callNext() {
    if (activeVisit) return toast('Finish current consultation with Mark Done or Skip first', { icon: 'ℹ️' })
    if (!waiting.length) return toast('No patients waiting', { icon: 'ℹ️' })
    const next = waiting[0]
    try {
      await api.patch(`/opd-visits/${next.id}/`, { status: 'in_progress' })
      toast.success(`Token #${next.token_number} called`)
      fetchVisits()
    } catch (e) { toast.error(e.response?.data?.detail || 'Error') }
  }

  async function autoSendDraftForVisit(visit) {
    const draft = rxDraftByVisit[visit.id]
    const draftItems = Array.isArray(draft?.items) ? draft.items : []
    const final = draftItems
      .map(i => ({ ...i, qty: Number(i.qty) || 0 }))
      .filter(i => {
        if (i.qty <= 0) return false
        if (i.source === 'manual') return String(i.manualName || '').trim().length >= 2
        return Boolean(i.medicine?.id && i.batch?.id)
      })
    if (!final.length) return false

    const stockItems = final.filter(i => i.source !== 'manual' && i.medicine?.id && i.batch?.id)
    const manualItems = final.filter(i => i.source === 'manual')

    const branchId = draft?.branchId
    if (stockItems.length > 0 && !branchId) {
      throw new Error('Select pharmacy branch before marking done.')
    }

    const bn = draft?.branchLabel || branchId || 'N/A'
    const notes = Array.isArray(visit?.patient_notes) ? visit.patient_notes : []
    const notesBlock = notes.length
      ? `\n\nNotes/Advice:\n${notes.map((n) => `- ${String(n).trim()}`).filter((x) => x !== '- ').join('\n')}`
      : ''

    const stockLines = stockItems.map(i => {
      const tl = timingOptions.find(t => t.v === i.timing)?.l || i.timing
      return `${i.medicine.name} x${i.qty} (${i.pattern}) | ${tl} | ${i.days} day${i.days > 1 ? 's' : ''}`
    })
    const manualLines = manualItems.map(i => {
      const name = String(i.manualName || '').trim()
      const tl = timingOptions.find(t => t.v === i.timing)?.l || i.timing
      return `${name} x${i.qty} (${i.pattern}) | ${tl} | ${i.days} day${i.days > 1 ? 's' : ''} [not in pharmacy]`
    })
    const allLines = [...stockLines, ...manualLines]
    const remarks = (stockItems.length > 0
      ? `Doctor Prescription (Branch: ${bn}):\n`
      : 'Doctor Prescription (manual / not in pharmacy):\n') +
      allLines.join('\n') +
      notesBlock

    if (stockItems.length > 0) {
      await api.post('/pharmacy/invoices/create-draft/', {
        patient: visit.patient,
        ipd_admission: visit.ipd_admission || null,
        remarks,
        items: stockItems.map(it => ({
          medicine: it.medicine.id, batch: it.batch.id, qty: it.qty,
          mrp: it.batch.mrp, rate: it.batch.sale_rate,
          amount: (Number(it.qty) * Number(it.batch.sale_rate)).toFixed(2),
        })),
      }, { headers: { 'X-Pharmacy-Branch': branchId } })
    }

    setRxDraftByVisit((prev) => {
      const next = { ...prev }
      delete next[visit.id]
      return next
    })
    return stockItems.length > 0 ? 'draft' : (manualItems.length > 0 ? 'manual' : false)
  }

  async function autoPrintVisitSlip(visit) {
    let layout = slipLayoutRef.current
    if (!layout) {
      layout = await loadOpdSlipLayoutForPrint()
      slipLayoutRef.current = layout
    }
    if (!layout?.rx_box) return

    const selections = getRxPrintDefaultsFromLayout(layout)
    const timingLabel = (v) => timingOptions.find(t => t.v === v)?.l || v
    const draft = rxDraftByVisit[visit.id] || {}
    const draftItems = Array.isArray(draft.items) ? draft.items : []

    const rxPrintData = {
      rxItems: selections.showRx
        ? draftItems
          .map(it => ({
            name: it.source === 'manual' ? String(it.manualName || '').trim() : String(it.medicine?.name || ''),
            isManual: it.source === 'manual',
            pattern: it.pattern,
            days: it.days,
            qty: it.qty,
            timing: timingLabel(it.timing),
          }))
          .filter(it => it.name.length > 0)
        : [],
      chiefComplaint: selections.showChiefComplaint ? String(visit.chief_complaint || '').trim() : '',
      notes: selections.showNotes
        ? (Array.isArray(visit.patient_notes) ? visit.patient_notes : [])
          .map(n => String(n).trim()).filter(Boolean)
        : [],
      followUpDate: selections.showFollowUp ? String(visit.follow_up_date || '').trim() : '',
    }

    const hasContent = Boolean(rxPrintData.chiefComplaint)
      || rxPrintData.rxItems.length > 0
      || rxPrintData.notes.length > 0
      || Boolean(rxPrintData.followUpDate)
    if (!hasContent) return

    await printRxOnly({ rxPrintData, layout })
  }

  async function completeVisit(visit) {
    try {
      const sent = await autoSendDraftForVisit(visit)
      await api.patch(`/opd-visits/${visit.id}/`, { status: 'completed' })
      try {
        await autoPrintVisitSlip(visit)
      } catch (printErr) {
        toast.error(printErr?.message || 'Visit completed but print failed')
      }
      if (sent === 'draft') toast.success('Consultation done and draft sent to pharmacy')
      else if (sent === 'manual') toast.success('Consultation done (manual medicines noted)')
      else toast.success('Consultation done')
      fetchVisits()
    } catch (e) { toast.error(e.response?.data?.detail || e.message || 'Error') }
  }

  async function skipVisit(visit) {
    try {
      await api.patch(`/opd-visits/${visit.id}/`, { status: 'skipped' })
      toast.success(`Token #${visit.token_number || visit.queue_number} skipped`)
      fetchVisits()
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Error')
    }
  }

  async function recallVisit(visit) {
    if (activeVisit) {
      return toast('Finish current consultation with Mark Done or Skip first', { icon: 'ℹ️' })
    }
    try {
      await api.patch(`/opd-visits/${visit.id}/`, { status: 'in_progress' })
      toast.success(`Token #${visit.token_number || visit.queue_number} recalled`)
      fetchVisits()
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Error')
    }
  }

  async function updateVisitNotes(id, text) {
    setVisits(prev => prev.map(v => v.id === id ? { ...v, chief_complaint: text } : v))
    try {
      await api.patch(`/opd-visits/${id}/`, { chief_complaint: text })
    } catch { } // quiet fail
  }

  function notesPointsToText(points) {
    if (!Array.isArray(points)) return ''
    return points
      .filter((x) => x != null && String(x).trim() !== '')
      .map((x) => String(x).trim())
      .join('\n')
  }

  function normalizeNotesPoints(points) {
    return (Array.isArray(points) ? points : [])
      .map((s) => String(s ?? '').trim())
      .map((s) => s.replace(/^[-•]\s+/, '').trim())
      .filter(Boolean)
  }

  function textToNotesPoints(text) {
    return String(text || '')
      .split('\n')
      .map((s) => s.replace(/^[-•]\s+/, '').trim())
      .filter(Boolean)
  }

  async function updateVisitPatientNotes(id, points) {
    const normalized = normalizeNotesPoints(points)
    setVisits(prev => prev.map(v => v.id === id ? { ...v, patient_notes: normalized } : v))
    try {
      await api.patch(`/opd-visits/${id}/`, { patient_notes: normalized })
    } catch { } // quiet fail
  }

  function handleNotesKeyDown(visitId, setDraftText) {
    return (e) => {
      if (e.key !== 'Enter') return
      // Enter => start a new bullet point line
      e.preventDefault()
      const el = e.currentTarget
      const start = el.selectionStart ?? 0
      const end = el.selectionEnd ?? 0
      const before = el.value.slice(0, start)
      const after = el.value.slice(end)
      const insert = '\n- '
      const nextVal = before + insert + after
      const nextPos = start + insert.length
      setDraftText(nextVal)
      setNotesDraftByVisit((prev) => ({ ...prev, [visitId]: nextVal }))
      requestAnimationFrame(() => {
        try { el.selectionStart = el.selectionEnd = nextPos } catch { /* ignore */ }
      })
    }
  }

  function commitVisitNoteHistory(visit, text) {
    const previousText = (noteStartRef.current[visit.id] ?? visit?.chief_complaint ?? '').trim()
    const nextText = (text || '').trim()
    if (!nextText || nextText === previousText) return
    const category = inferCategoryFromNote(nextText)
    const tail = nextText.length > 95 ? `${nextText.slice(0, 95)}...` : nextText
    pushHistoryEvent({
      visitId: visit.id,
      category,
      text: previousText ? `Updated note: ${tail}` : `Added note: ${tail}`,
    })
    noteStartRef.current[visit.id] = nextText
  }

  function appendVisitNotes(id, currentText, newText) {
    const space = (currentText && currentText.trim().length > 0) ? ' ' : '';
    const updated = (currentText || '') + space + newText.trim();
    const category = inferCategoryFromNote(newText)
    const tail = newText.trim().length > 85 ? `${newText.trim().slice(0, 85)}...` : newText.trim()
    if (tail) {
      pushHistoryEvent({
        visitId: id,
        category,
        text: `Dictated: ${tail}`,
      })
    }
    updateVisitNotes(id, updated);
  }

  function handleVisitDraftChange({ visitId, branchId, branchLabel, items }) {
    setRxDraftByVisit((prev) => ({
      ...prev,
      [visitId]: {
        branchId,
        branchLabel: branchLabel || '',
        items: Array.isArray(items) ? items : [],
      },
    }))
  }

  const statusBadge = {
    waiting: 'bg-amber-100 text-amber-700',
    in_progress: 'bg-blue-100 text-blue-700',
    in_consultation: 'bg-blue-100 text-blue-700',
    completed: 'bg-green-100 text-green-700',
    skipped: 'bg-rose-100 text-rose-700',
  }
  const canCallNext = !activeVisit && waiting.length > 0

  const visitsQueueOrder = useMemo(
    () =>
      [...visits].sort((a, b) => {
        const na = Number(a.queue_number ?? a.token_number ?? 0)
        const nb = Number(b.queue_number ?? b.token_number ?? 0)
        return na - nb
      }),
    [visits],
  )

  return (
    <div className="h-full flex gap-3 overflow-hidden">
      {/* LEFT: Stats + Queue sidebar */}
      <div className="w-64 shrink-0 flex flex-col gap-2 overflow-hidden">
        
        {/* Stats Row */}
        <div className="flex items-center gap-2 shrink-0">
          {[
            { label: 'Wait', count: waiting.length, bg: 'bg-amber-50 border-amber-200', txt: 'text-amber-700' },
            { label: 'Room', count: inProgress.length, bg: 'bg-blue-50 border-blue-200', txt: 'text-blue-700' },
            { label: 'Done', count: done.length, bg: 'bg-green-50 border-green-200', txt: 'text-green-700' },
          ].map(s => (
            <div key={s.label} className={`${s.bg} border rounded-xl flex-1 py-1.5 text-center shadow-sm`}>
              <p className={`text-xl font-black ${s.txt}`}>{s.count}</p>
              <p className={`text-[9px] font-semibold ${s.txt} opacity-80 uppercase tracking-wide`}>{s.label}</p>
            </div>
          ))}
        </div>

        {/* Call Next Button */}
        <button onClick={callNext}
          disabled={!canCallNext}
          title={activeVisit ? 'Finish current consultation with Mark Done or Skip first' : ''}
          className="w-full bg-gradient-to-r from-blue-600 to-indigo-600 text-white py-2.5 rounded-xl font-bold text-sm flex items-center justify-center gap-2 hover:opacity-90 transition-all shadow-md shrink-0 disabled:opacity-50 disabled:cursor-not-allowed">
          <ChevronRight size={18} />
          Call Next {waiting[0] ? `(#${waiting[0].token_number})` : ''}
        </button>

        {/* Queue List */}
        <div className="bg-white border border-gray-100 rounded-2xl flex-1 flex flex-col overflow-hidden shadow-sm mt-1">
          <div className="px-3 py-2 border-b border-gray-100 flex items-center justify-between shrink-0">
            <p className="text-xs font-bold text-gray-700">Queue</p>
            <span className="text-[10px] text-gray-400">{visits.length} today</span>
          </div>
          <div className="flex-1 overflow-y-auto divide-y divide-gray-50">
            {visits.length === 0 ? (
              <div className="text-center py-8 text-gray-400 text-xs">No visits today</div>
            ) : visitsQueueOrder.map(v => (
              <div key={v.id} className="px-2.5 py-2 flex items-center gap-2">
                <div className={`w-7 h-7 rounded-lg font-bold text-xs flex items-center justify-center shrink-0 ${
                  (v.status === 'in_progress' || v.status === 'in_consultation') ? 'bg-blue-600 text-white' :
                  v.status === 'completed' ? 'bg-green-100 text-green-700' :
                  v.status === 'skipped' ? 'bg-rose-100 text-rose-700' : 'bg-gray-100 text-gray-700'
                }`}>{v.token_number}</div>
                <div className="flex-1 min-w-0">
                  <p className="text-[11px] font-semibold text-gray-800 truncate">{v.patient_name || `#${v.token_number}`}</p>
                  <p className="text-[9px] text-gray-400 truncate">
                    {v.patient_address ? <span className="font-medium text-gray-500">📍 {v.patient_address} · </span> : ''}
                    {v.chief_complaint || 'General'}
                  </p>
                </div>
                <span className={`text-[8px] px-1.5 py-0.5 rounded-full font-bold shrink-0 ${statusBadge[v.status] || 'bg-gray-100 text-gray-600'}`}>
                  {v.status === 'in_progress' || v.status === 'in_consultation' ? 'In' :
                   v.status === 'completed' ? '✓' :
                   v.status === 'skipped' ? 'Skip' : 'Wait'}
                </span>
                {v.status === 'waiting' && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation()
                      skipVisit(v)
                    }}
                    className="text-[9px] font-bold px-2 py-1 rounded-md border border-rose-200 text-rose-700 bg-rose-50 hover:bg-rose-100"
                    title="Skip this waiting patient"
                  >
                    Skip
                  </button>
                )}
                {(v.status === 'skipped' || v.status === 'completed') && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation()
                      recallVisit(v)
                    }}
                    className="text-[9px] font-bold px-2 py-1 rounded-md border border-blue-200 text-blue-700 bg-blue-50 hover:bg-blue-100"
                    title="Recall patient to consultation"
                  >
                    Recall
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>

        {/* CENTER: Active patient(s) */}
        <div className="flex-1 min-w-0 overflow-y-auto relative">
          <div className="absolute top-2 right-2 z-30 flex items-center gap-2">
            <button
              onClick={() => setSettingsOpen(true)}
              className="h-8 w-8 rounded-lg border border-slate-200 bg-white/95 text-slate-600 hover:text-blue-600 hover:border-blue-300 shadow-sm flex items-center justify-center"
              title="Customize follow-up and default day options"
            >
              <Settings size={14} />
            </button>
            <button
              onClick={() => {
                const target = activeVisit || latestDoneVisit
                if (target) setHistoryPreviewVisit(target)
              }}
              disabled={!activeVisit && !latestDoneVisit}
              className="h-8 w-8 rounded-lg border border-slate-200 bg-white/95 text-slate-600 hover:text-blue-600 hover:border-blue-300 shadow-sm flex items-center justify-center disabled:opacity-40 disabled:cursor-not-allowed"
              title="View patient history"
            >
              <Eye size={14} />
            </button>
          </div>
          {inProgress.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-gray-400 bg-white rounded-2xl border border-dashed border-gray-200 relative overflow-hidden">
              <div className="w-14 h-14 rounded-2xl bg-gray-100 flex items-center justify-center mb-3">
                <Users size={26} className="opacity-30" />
              </div>
              <p className="font-semibold text-sm">No patient in room</p>
              <p className="text-xs mt-1 text-gray-400">Call next token to begin consultation</p>

              <div className="absolute bottom-4 right-4">
                <button onClick={callNext}
                  disabled={!canCallNext}
                  title={activeVisit ? 'Finish current consultation with Mark Done or Skip first' : ''}
                  className="bg-gradient-to-r from-blue-600 to-indigo-600 text-white px-6 py-3 rounded-xl font-bold text-sm flex items-center gap-2 shadow-lg hover:shadow-xl hover:-translate-y-0.5 transition-all disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:translate-y-0">
                  Call Next {waiting[0] ? `(#${waiting[0].token_number})` : ''} <ChevronRight size={18} />
                </button>
              </div>
            </div>
          ) : activeVisit ? (() => {
            const v = activeVisit
            const { meds, followupDays } = extractMedAndFollowup(v.chief_complaint)
            return (
              <div key={v.id} data-no-copy="true" className="bg-white rounded-2xl border border-blue-100 shadow-sm overflow-hidden flex flex-col h-full">
                {/* Patient header strip */}
                <div className="bg-gradient-to-r from-blue-600 to-indigo-600 px-4 py-3 flex items-center gap-3 shrink-0">
                  <div className="w-11 h-11 bg-white/20 backdrop-blur rounded-xl text-white font-black text-xl flex items-center justify-center border border-white/30">
                    {v.token_number}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-white font-bold text-base leading-tight truncate">{v.patient_name || 'Patient'}</p>
                    <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-0.5">
                      {v.patient_age && <span className="text-blue-100 text-[11px]">Age: <strong className="text-white">{v.patient_age}</strong></span>}
                      {v.patient_gender && <span className="text-blue-100 text-[11px]">Gender: <strong className="text-white capitalize">{v.patient_gender}</strong></span>}
                      {v.patient_phone && <span className="text-blue-100 text-[11px]">📞 <strong className="text-white">{v.patient_phone}</strong></span>}
                      {v.patient_address && <span className="text-blue-100 text-[11px]">📍 <strong className="text-white truncate max-w-[120px] inline-block align-bottom">{v.patient_address}</strong></span>}
                      {v.visit_time && <span className="text-blue-100 text-[11px]">⏰ <strong className="text-white">{v.visit_time}</strong></span>}
                      {v.uhid && <span className="text-blue-100 text-[11px]">UHID: <strong className="text-white">{v.uhid}</strong></span>}
                    </div>
                  </div>
                </div>

                {/* OPD slip detail row */}
                {(v.patient_address || v.visit_type || v.referred_by || v.department) && (
                  <div className="px-4 py-2 bg-slate-50 border-b border-slate-100 flex flex-wrap gap-x-4 gap-y-1">
                    {v.patient_address && (
                      <span className="text-[11px] text-slate-600">
                        📍 <span className="font-medium">{v.patient_address}</span>
                      </span>
                    )}
                    {v.visit_type && (
                      <span className="text-[11px] text-slate-600">
                        Type: <span className="font-semibold text-slate-800 capitalize">{v.visit_type}</span>
                      </span>
                    )}
                    {v.referred_by && (
                      <span className="text-[11px] text-slate-600">
                        Ref: <span className="font-semibold text-slate-800">{v.referred_by}</span>
                      </span>
                    )}
                    {v.department && (
                      <span className="text-[11px] text-slate-600">
                        Dept: <span className="font-semibold text-slate-800">{v.department}</span>
                      </span>
                    )}
                  </div>
                )}

                {/* Body: notes + follow-up + prescription */}
                <div className="p-3 space-y-2.5 flex-1 flex flex-col">
                  {/* Notes */}
                  <div className={`relative border rounded-xl overflow-hidden transition-colors ${
                    aiMode ? 'border-purple-300 bg-gradient-to-br from-indigo-50/50 to-purple-50/50 focus-within:border-purple-500'
                           : 'border-gray-200 bg-gray-50/50 focus-within:border-blue-400'
                  }`}>
                    <textarea
                      value={v.chief_complaint || ''}
                      onChange={e => updateVisitNotes(v.id, e.target.value)}
                      onFocus={() => { noteStartRef.current[v.id] = v.chief_complaint || '' }}
                      onBlur={e => commitVisitNoteHistory(v, e.target.value)}
                      placeholder={aiMode ? '🎙️ Dictate — symptoms, medicines, follow-up days...' : 'Chief complaint, symptoms, observations...'}
                      rows={3}
                      className="w-full text-sm text-gray-700 bg-transparent p-2.5 outline-none resize-none"
                      style={{ paddingBottom: aiMode ? '40px' : undefined }}
                    />
                    {aiMode && (
                      <div className="absolute bottom-2 right-2 flex gap-2 items-center bg-white shadow-sm border border-purple-100 rounded-full pl-3 pr-1 py-0.5">
                        <span className="text-[9px] text-purple-500 font-black tracking-widest uppercase">Dictate</span>
                        <MicrophoneInput autoStart={true} onTranscript={text => appendVisitNotes(v.id, v.chief_complaint, text)} />
                      </div>
                    )}
                  </div>

                  {/* Notes/Advice for patient */}
                  <div className="rounded-xl border border-slate-200 bg-white p-2.5 space-y-1.5">
                    <div className="flex items-center gap-1.5">
                      <span className="text-[10px] font-extrabold uppercase tracking-widest text-slate-600">Notes / Advice</span>
                      <span className="ml-auto text-[10px] text-slate-400">one point per line</span>
                    </div>
                    <textarea
                      value={notesDraftByVisit[v.id] ?? notesPointsToText(v.patient_notes)}
                      onChange={(e) => {
                        const nextText = e.target.value
                        setNotesDraftByVisit((prev) => ({ ...prev, [v.id]: nextText }))
                      }}
                      onKeyDown={handleNotesKeyDown(v.id, (nextText) => {
                        setNotesDraftByVisit((prev) => ({ ...prev, [v.id]: nextText }))
                      })}
                      onBlur={(e) => {
                        const points = textToNotesPoints(e.target.value)
                        updateVisitPatientNotes(v.id, points)
                        setNotesDraftByVisit((prev) => {
                          const next = { ...prev }
                          delete next[v.id]
                          return next
                        })
                      }}
                      placeholder={'Drink plenty of fluids\nTake rest\nAvoid spicy food'}
                      rows={3}
                      className="w-full text-[13px] text-slate-700 bg-slate-50/50 border border-slate-200 rounded-lg p-2 outline-none resize-none focus:border-blue-400"
                    />
                  </div>

                  {/* AI/manual follow-up */}
                  {aiMode ? (
                    <div className="rounded-xl border border-purple-200 bg-gradient-to-br from-indigo-50 to-purple-50 p-2.5 space-y-1.5">
                      <div className="flex items-center gap-1.5">
                        <span className="text-sm">🤖</span>
                        <span className="text-[10px] font-extrabold uppercase tracking-widest text-purple-700">AI Follow-up</span>
                        <span className="ml-auto text-[9px] bg-purple-100 text-purple-600 px-1.5 py-0.5 rounded-full font-bold">AUTO</span>
                      </div>
                      {followupDays ? (
                        <div className="flex items-center gap-2 bg-green-50 border border-green-300 rounded-lg px-3 py-1.5">
                          <span className="text-xs text-green-700 font-semibold flex-1">
                            ✅ {followupDays} days — {format(addDays(new Date(), followupDays), 'dd MMM yyyy')}
                          </span>
                          <button onClick={() => {
                            const d = format(addDays(new Date(), followupDays), 'yyyy-MM-dd')
                            api.patch(`/opd-visits/${v.id}/`, { revisit_advice: `Follow up after ${followupDays} days`, follow_up_date: d })
                              .then(() => {
                                setVisits(prev => prev.map(x => x.id === v.id ? { ...x, follow_up_date: d } : x))
                                pushHistoryEvent({ visitId: v.id, category: 'Appointment', text: `Follow-up: ${format(addDays(new Date(), followupDays), 'dd MMM yyyy')}` })
                                toast.success('Follow-up saved!')
                              }).catch(() => {})
                          }} className="text-[10px] font-bold bg-green-600 text-white px-2 py-1 rounded-lg hover:bg-green-700 shrink-0">
                            Save
                          </button>
                        </div>
                      ) : (
                        <p className="text-[10px] text-purple-400 italic">Say "follow up in 7 days" to auto-detect...</p>
                      )}
                      {meds.length > 0 && (
                        <div className="flex flex-wrap gap-1 pt-1 border-t border-purple-100">
                          {meds.map((med, i) => (
                            <span key={i} className="text-[10px] bg-purple-100 text-purple-800 rounded-full px-2 py-0.5 border border-purple-200 font-semibold">{med}</span>
                          ))}
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="rounded-xl border border-gray-200 bg-white p-2.5 space-y-2">
                      <div className="flex items-center gap-1.5">
                        <Clock size={12} className="text-gray-500" />
                        <span className="text-[10px] font-extrabold uppercase tracking-widest text-gray-600">Follow-up Date</span>
                      </div>
                      <ManualFollowUp visitId={v.id} existingDate={v.follow_up_date} quickDays={followupDayOptions} />
                    </div>
                  )}

                  <div className="mt-auto pt-3 flex justify-end gap-2">
                    <button
                      onClick={() => skipVisit(v)}
                      className="bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 text-sm px-4 py-2.5 rounded-xl font-bold flex items-center gap-2 shadow-sm transition-all"
                    >
                      <X size={16} /> Skip
                    </button>
                    <button onClick={() => completeVisit(v)}
                      className="bg-emerald-500 hover:bg-emerald-400 text-white text-sm px-6 py-2.5 rounded-xl font-bold flex items-center gap-2 shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md">
                      <CheckCircle size={16} /> Mark Done and Print
                    </button>
                  </div>
                </div>
              </div>
            )
          })() : null}
        </div>

        {/* RIGHT: Prescription & History panel */}
        {(activeVisit || latestDoneVisit) && (
          <div className="w-[40%] shrink-0 flex flex-col gap-3 overflow-y-auto pb-4 pr-1">
            {activeVisit && (
              <React.Fragment key={activeVisit.id}>
                <InlineRxPanel
                  visit={activeVisit}
                  defaultDayOptions={rxDayOptions}
                  dosagePatternOptions={dosagePatternOptions}
                  timingOptions={timingOptions}
                  onDraftChange={handleVisitDraftChange}
                />
              </React.Fragment>
            )}
            {!activeVisit && latestDoneVisit && (
              <React.Fragment key={`done-${latestDoneVisit.id}`}>
                <div className="text-[10px] font-bold uppercase tracking-wider text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-2 py-1">
                  Completed Visit #{latestDoneVisit.token_number}
                </div>
                <InlineRxPanel
                  visit={latestDoneVisit}
                  defaultDayOptions={rxDayOptions}
                  dosagePatternOptions={dosagePatternOptions}
                  timingOptions={timingOptions}
                  onDraftChange={handleVisitDraftChange}
                />
              </React.Fragment>
            )}
          </div>
        )}

      {aiMode && autoSavePrompt && (
        <AutoSavePopup key={autoSavePrompt.token} prompt={autoSavePrompt} onAccept={acceptFollowUp} onReject={() => setAutoSavePrompt(null)} />
      )}
      <DayOptionsSettings
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        followupDays={followupDayOptions}
        rxDays={rxDayOptions}
        dosagePatterns={dosagePatternOptions}
        timingOptions={timingOptions}
        onSave={saveDaySettings}
        saving={settingsSaving}
      />
      {historyPreviewVisit && (
        <div className="fixed inset-0 z-[10000] bg-black/35 backdrop-blur-[1px] flex items-center justify-center p-4">
          <div className="w-full max-w-3xl bg-white rounded-2xl border border-slate-200 shadow-2xl overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
              <div>
                <p className="text-sm font-bold text-slate-800">Patient History</p>
                <p className="text-[11px] text-slate-500">
                  {historyPreviewVisit.patient_name || `Token #${historyPreviewVisit.token_number}`}
                </p>
              </div>
              <button
                onClick={() => setHistoryPreviewVisit(null)}
                className="h-8 w-8 rounded-lg border border-slate-200 text-slate-500 hover:text-slate-700 hover:bg-slate-50 flex items-center justify-center"
              >
                <X size={14} />
              </button>
            </div>
            <div className="p-3">
              <PatientHistoryTimeline
                events={historyByVisit[historyPreviewVisit.id] || []}
                filter={historyFilters[historyPreviewVisit.id] || 'all'}
                onFilterChange={nextFilter =>
                  setHistoryFilters(prev => ({ ...prev, [historyPreviewVisit.id]: nextFilter }))
                }
                maxHeightClass="max-h-[70vh]"
              />
            </div>
          </div>
        </div>
      )}
    </div>
  )
}


// ─── Treatment Plan Builder (Drag & Drop) ─────────────────────────────────
function TPBuilder({ preSelectedAdmission, patientChip, onBack }) {
  const [admissions, setAdmissions] = useState([])
  const [selectedAdm, setSelectedAdm] = useState(preSelectedAdmission || '')
  const [planName, setPlanName] = useState('')
  const [startDate, setStartDate] = useState(format(new Date(), 'yyyy-MM-dd'))
  const [days, setDays] = useState({ 0: [], 1: [], 2: [], 3: [] })
  const [activeDayIdx, setActiveDayIdx] = useState(0)
  const [loading, setLoading] = useState(false)
  const [currentPlanId, setCurrentPlanId] = useState(null)
  const [modal, setModal] = useState({ open: false, type: '', mode: 'add', payload: {} })
  const [paletteTab, setPaletteTab] = useState('templates') // 'templates' | 'packages'
  const [expandedPkg, setExpandedPkg] = useState(null)
  const [templates, setTemplates] = useState(MEDICINE_TEMPLATES)
  const [packages, setPackages] = useState(DEFAULT_PACKAGES)
  const [catalogHydrated, setCatalogHydrated] = useState(false)
  const [staffList, setStaffList] = useState([])
  const [staffDropdownOpen, setStaffDropdownOpen] = useState(false)
  const [selectedStaffIds, setSelectedStaffIds] = useState([])
  const [savingStaff, setSavingStaff] = useState(false)
  const [voiceCmdListening, setVoiceCmdListening] = useState(false)
  const [voiceLog, setVoiceLog] = useState(null)   // { text, matched: [{type,name}] } or null
  const [tpHistoryEvents, setTpHistoryEvents] = useState([])
  const [focusedServerItemId, setFocusedServerItemId] = useState(null)
  const [inlineQuery, setInlineQuery] = useState('')
  const [inlineActiveIdx, setInlineActiveIdx] = useState(-1)
  const [inlineOpen, setInlineOpen] = useState(false)
  const voiceRecRef = useRef(null)
  const voiceStopTimerRef = useRef(null)
  const initialServerItemsRef = useRef([])
  const inlineBlurTimerRef = useRef(null)
  const catalogSaveTimerRef = useRef(null)
  const lastCatalogSaveErrorAtRef = useRef(0)
  const sensors = useSensors(useSensor(PointerSensor))
  let idCounter = useRef(0)
  const STOP_WORDS = useMemo(
    () => new Set(['give', 'check', 'start', 'add', 'from', 'with', 'after', 'hour', 'minute', 'day', 'days', 'hours', 'minutes', 'at', 'today', 'tomorrow']),
    [],
  )
  const packageMatchers = useMemo(
    () =>
      packages.map((pkg) => ({
        pkg,
        keywords: pkg.name
          .toLowerCase()
          .split(/[\s&,/-]+/)
          .filter((w) => w.length > 3 && !STOP_WORDS.has(w)),
      })),
    [packages, STOP_WORDS],
  )
  const templateMatchers = useMemo(
    () =>
      templates.map((tmpl) => ({
        tmpl,
        keywords: tmpl.title
          .toLowerCase()
          .split(/[\s&,()-]+/)
          .filter((w) => w.length > 3 && !STOP_WORDS.has(w)),
      })),
    [templates, STOP_WORDS],
  )
  const inlineSuggestions = useMemo(() => {
    const q = inlineQuery.trim().toLowerCase()
    if (!q) return []
    const templateHits = templates
      .filter((t) => {
        const title = (t.title || '').toLowerCase()
        const instructions = (t.instructions || '').toLowerCase()
        return title.includes(q) || instructions.includes(q)
      })
      .map((t, idx) => ({
        id: `tmpl-${idx}-${t.title}`,
        type: 'template',
        label: t.title,
        subtitle: t.instructions || 'Template',
        payload: t,
      }))

    const packageHits = packages
      .filter((p) => {
        const name = (p.name || '').toLowerCase()
        return name.includes(q)
      })
      .map((p) => ({
        id: `pkg-${p.id}`,
        type: 'package',
        label: p.name,
        subtitle: `${p.items?.length || 0} items package`,
        payload: p,
      }))

    return [...templateHits, ...packageHits].slice(0, 8)
  }, [inlineQuery, templates, packages])

  async function loadTimelineEvents(admissionId) {
    if (!admissionId) {
      setTpHistoryEvents([])
      return
    }
    try {
      const { data } = await api.get(`/patient-timeline/?ipd_admission=${admissionId}&ordering=-timestamp`)
      setTpHistoryEvents(data?.results || data || [])
    } catch {
      setTpHistoryEvents([])
    }
  }

  useEffect(() => {
    api.get('/ipd-admissions/?status=admitted').then(({ data }) => setAdmissions(data.results || data))
    api.get('/staff/?limit=300').then(({ data }) => {
      const list = data?.results || data?.data || data || []
      setStaffList(Array.isArray(list) ? list : [])
    }).catch(() => {})
    api
      .get('/treatment/template-package-catalog/')
      .then(({ data }) => {
        const serverTemplates = Array.isArray(data?.templates) ? data.templates : null
        const serverPackages = Array.isArray(data?.packages) ? data.packages : null
        if (serverTemplates && serverTemplates.length > 0) setTemplates(serverTemplates)
        if (serverPackages && serverPackages.length > 0) setPackages(serverPackages)
      })
      .catch(() => {})
      .finally(() => setCatalogHydrated(true))
  }, [])

  useEffect(() => {
    if (!catalogHydrated) return
    if (catalogSaveTimerRef.current) {
      clearTimeout(catalogSaveTimerRef.current)
    }
    catalogSaveTimerRef.current = setTimeout(() => {
      api
        .put('/treatment/template-package-catalog/', {
          templates,
          packages,
        })
        .catch(() => {
          const now = Date.now()
          if (now - lastCatalogSaveErrorAtRef.current > 5000) {
            lastCatalogSaveErrorAtRef.current = now
            toast.error('Failed to save templates/packages to server')
          }
        })
    }, 700)
    return () => {
      if (catalogSaveTimerRef.current) {
        clearTimeout(catalogSaveTimerRef.current)
      }
    }
  }, [templates, packages, catalogHydrated])

  useEffect(() => {
    if (!selectedAdm) {
      setTpHistoryEvents([])
      return
    }
    loadTimelineEvents(selectedAdm)
    const interval = setInterval(() => loadTimelineEvents(selectedAdm), 15000)
    return () => clearInterval(interval)
  }, [selectedAdm])

  useEffect(() => {
    if (inlineActiveIdx >= inlineSuggestions.length) {
      setInlineActiveIdx(inlineSuggestions.length > 0 ? 0 : -1)
    }
  }, [inlineSuggestions, inlineActiveIdx])

  async function loadPlanDetails(plan, admissionId) {
    const [itemRes, doneRes, assRes] = await Promise.all([
      api.get(`/treatment-plan-items/?plan=${plan.id}&limit=200`),
      api.get(`/treatment-tasks/?ipd_admission=${admissionId}&limit=1200`),
      api.get(`/treatment-plans/${plan.id}/staff-assignments/`),
    ])
    const items = itemRes.data?.results || itemRes.data?.data || itemRes.data || []
    const allTasks = doneRes.data?.results || doneRes.data?.data || doneRes.data || []
    const performedStatusMap = new Map()
    ;(Array.isArray(allTasks) ? allTasks : []).forEach((t) => {
      if (t.status === 'done' || t.status === 'skipped') {
        performedStatusMap.set(String(t.plan_item), t.status)
      }
    })
    const assignments = assRes.data?.results || assRes.data?.data || assRes.data || []
    const selectedIds = (Array.isArray(assignments) ? assignments : []).map((a) => String(a.staff))
    setSelectedStaffIds(selectedIds)
    const grouped = { 0: [], 1: [], 2: [], 3: [] }
    for (const item of (Array.isArray(items) ? items : [])) {
      const d = item.day_offset ?? 0
      if (d >= 0 && d <= 3) {
        grouped[d].push({
          _id: `item-${++idCounter.current}`,
          _serverId: item.id,
          title: item.title,
          instructions: item.instructions || '',
          category: item.category || 'medication',
          time_of_day: item.time_of_day || '08:00',
          _taskStatus: performedStatusMap.get(String(item.id)) || null,
        })
      }
    }
    initialServerItemsRef.current = Object.values(grouped).flat().map((x) => x._serverId).filter(Boolean)
    setDays(grouped)
  }

  useEffect(() => {
    if (!preSelectedAdmission) return
    api.get(`/treatment-plans/?ipd_admission=${preSelectedAdmission}&limit=1`)
      .then(({ data }) => {
        const plans = data?.results || data?.data || data || []
        const plan = Array.isArray(plans) && plans.length > 0 ? plans[0] : null
        if (plan) {
          setPlanName(plan.name || '')
          setStartDate(plan.start_date || format(new Date(), 'yyyy-MM-dd'))
          setCurrentPlanId(plan.id)
          return loadPlanDetails(plan, preSelectedAdmission)
        }
      })
      .catch(() => {})
  }, [preSelectedAdmission])

  function mkId() { return `item-${++idCounter.current}` }

  function clearInlineInput() {
    setInlineQuery('')
    setInlineActiveIdx(-1)
    setInlineOpen(false)
  }

  function addToDay(template, dayIdx) {
    const nowTime = formatTime(new Date())
    const times = (template.frequency && FREQ_MAP[template.frequency]) || [template.time_of_day || nowTime]
    const newItems = times.map((t, idx) => ({ ...template, _id: mkId(), time_of_day: idx === 0 ? nowTime : t }))
    setDays(d => ({ ...d, [dayIdx]: [...d[dayIdx], ...newItems] }))
  }

  function addPackageToDay(pkg, dayIdx) {
    const newItems = pkg.items.flatMap(t => {
       const times = (t.frequency && FREQ_MAP[t.frequency]) || [t.time_of_day || '08:00']
       return times.map(time => ({ ...t, _id: mkId(), time_of_day: time }))
    })
    setDays(d => ({ ...d, [dayIdx]: [...d[dayIdx], ...newItems] }))
    toast.success(`"${pkg.name}" added to Day ${dayIdx + 1} (${newItems.length} orders)`)
  }

  function addInlineCustomNote(rawText) {
    const title = rawText.trim()
    if (!title) return
    addToDay({ title, instructions: '', category: 'medication', color: 'yellow', frequency: 'OD' }, activeDayIdx)
  }

  function applyInlineSelection(selection) {
    if (!selection) return
    if (selection.type === 'package') {
      addPackageToDay(selection.payload, activeDayIdx)
    } else {
      addToDay(selection.payload, activeDayIdx)
    }
  }

  function handleInlineKeyDown(event) {
    if (!inlineOpen && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
      setInlineOpen(true)
      return
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      if (!inlineSuggestions.length) return
      setInlineActiveIdx((prev) => (prev + 1) % inlineSuggestions.length)
      return
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault()
      if (!inlineSuggestions.length) return
      setInlineActiveIdx((prev) => (prev <= 0 ? inlineSuggestions.length - 1 : prev - 1))
      return
    }
    if (event.key === 'Escape') {
      setInlineOpen(false)
      setInlineActiveIdx(-1)
      return
    }
    if (event.key === 'Enter') {
      event.preventDefault()
      const query = inlineQuery.trim()
      if (!query) return
      if (inlineSuggestions.length > 0) {
        const picked = inlineSuggestions[inlineActiveIdx >= 0 ? inlineActiveIdx : 0]
        applyInlineSelection(picked)
      } else {
        addInlineCustomNote(query)
      }
      clearInlineInput()
    }
  }

  // Voice command processor (day + time extraction).
  function processVoiceCommand(transcript) {
    const lower = transcript.toLowerCase()
    const matchedItems = []
    const wordSet = new Set(lower.split(/[^a-z0-9]+/).filter(Boolean))

    const dayWords = { one: 1, two: 2, three: 3, four: 4, '1': 1, '2': 2, '3': 3, '4': 4 }
    const dayMatch = lower.match(/\bday\s+(\w+)\b/)
    let targetDayIdx = activeDayIdx
    if (dayMatch) {
      const spoken = dayMatch[1]
      const parsed = dayWords[spoken]
      if (parsed && parsed >= 1 && parsed <= 4) {
        targetDayIdx = parsed - 1
        setActiveDayIdx(targetDayIdx)
      }
    }

    const timeKeywords = {
      morning: '08:00', afternoon: '13:00', evening: '18:00', night: '21:00',
      midnight: '00:00', noon: '12:00',
    }
    let overrideTime = null

    const relRegex = /(?:after|in)\s+(\d+)\s*(hour|minute)s?/i
    const relMatch = lower.match(relRegex)
    if (relMatch) {
      const amount = parseInt(relMatch[1], 10)
      const unit = relMatch[2].toLowerCase()
      const now = new Date()
      const future = new Date(now.getTime() + (unit.startsWith('hour') ? amount * 3600000 : amount * 60000))
      overrideTime = `${String(future.getHours()).padStart(2, '0')}:${String(future.getMinutes()).padStart(2, '0')}`
    }

    if (!overrideTime) {
      const timeRegex = /(?:\bat\s+)?(\d{1,2})(?::(\d{2}))?\s*([ap]\.?\s*m?\.?\b|o'clock)?/i
      const timeMatch = lower.match(timeRegex)
      if (timeMatch) {
        const hStr = timeMatch[1]
        const mStr = timeMatch[2]
        const meridiemRaw = timeMatch[3] ? timeMatch[3].toLowerCase().replace(/[\.\s]/g, '') : null

        let h = parseInt(hStr, 10)
        const m = mStr ? parseInt(mStr, 10) : 0

        const hasColon = !!mStr
        const hasMeridiem = meridiemRaw && (meridiemRaw.startsWith('a') || meridiemRaw.startsWith('p'))
        const hasOClock = meridiemRaw === "o'clock"
        const hasAtContext = lower.includes(`at ${hStr}`)

        if (hasColon || hasMeridiem || hasOClock || hasAtContext) {
          if (hasMeridiem) {
            const isPM = meridiemRaw.startsWith('p')
            if (isPM && h < 12) h += 12
            if (!isPM && h === 12) h = 0
          }
          if (h >= 0 && h <= 23 && m >= 0 && m <= 59) {
            overrideTime = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
          }
        }
      }
    }

    if (!overrideTime) {
      for (const [kw, t] of Object.entries(timeKeywords)) {
        if (lower.includes(kw)) { overrideTime = t; break }
      }
    }

    const addToDayWithTime = (tmpl) => {
      if (!overrideTime) {
        addToDay(tmpl, targetDayIdx)
        return
      }
      const newItem = { ...tmpl, _id: mkId(), time_of_day: overrideTime }
      setDays(d => ({ ...d, [targetDayIdx]: [...d[targetDayIdx], newItem] }))
    }

    packageMatchers.forEach(({ pkg, keywords }) => {
      const isMatch = keywords.some((kw) => wordSet.has(kw))

      if (isMatch) {
        if (overrideTime) {
          const newItems = pkg.items.flatMap(t => [{ ...t, _id: mkId(), time_of_day: overrideTime }])
          setDays(d => ({ ...d, [targetDayIdx]: [...d[targetDayIdx], ...newItems] }))
          toast.success(`"${pkg.name}" -> Day ${targetDayIdx + 1} @ ${overrideTime}`)
        } else {
          addPackageToDay(pkg, targetDayIdx)
        }
        matchedItems.push({ type: 'package', name: pkg.name, day: targetDayIdx + 1, time: overrideTime })
      }
    })

    templateMatchers.forEach(({ tmpl, keywords }) => {
      const isMatch = keywords.some((kw) => wordSet.has(kw))

      if (isMatch) {
        addToDayWithTime(tmpl)
        matchedItems.push({ type: 'template', name: tmpl.title, day: targetDayIdx + 1, time: overrideTime })
      }
    })

    if (matchedItems.length > 0) {
      setVoiceLog({ text: transcript, matched: matchedItems, day: targetDayIdx + 1, time: overrideTime })
      setTimeout(() => setVoiceLog(null), 6000)
    } else {
      toast(`No match for: "${transcript.slice(0, 40)}"`, { icon: '🎙️' })
    }
  }

  function toggleVoiceCmd() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition
    if (!SpeechRecognition) { toast.error('Speech not supported'); return }

    if (voiceCmdListening) {
      voiceRecRef.current?.stop()
      if (voiceStopTimerRef.current) {
        clearTimeout(voiceStopTimerRef.current)
        voiceStopTimerRef.current = null
      }
      setVoiceCmdListening(false)
      return
    }

    const rec = new SpeechRecognition()
    rec.continuous = true
    rec.interimResults = true
    rec.lang = 'en-US'
    rec.maxAlternatives = 1
    voiceRecRef.current = rec
    let handled = false
    let lastTranscript = ''
    let silenceTimer = null

    const finishFast = (transcript) => {
      if (handled) return
      const clean = (transcript || '').trim()
      if (clean.length < 2) return
      handled = true
      processVoiceCommand(clean)
      rec.stop()
    }

    rec.onresult = e => {
      for (let i = e.resultIndex; i < e.results.length; i += 1) {
        const result = e.results[i]
        const transcript = result[0]?.transcript?.trim()
        if (!transcript) continue
        lastTranscript = transcript
        if (result.isFinal && !handled) {
          finishFast(transcript)
          return
        }
      }
      if (!handled) {
        if (silenceTimer) clearTimeout(silenceTimer)
        // Trigger quickly once speech pauses briefly.
        silenceTimer = setTimeout(() => finishFast(lastTranscript), 550)
      }
    }
    rec.onerror = () => setVoiceCmdListening(false)
    rec.onend = () => {
      if (silenceTimer) {
        clearTimeout(silenceTimer)
        silenceTimer = null
      }
      if (!handled && lastTranscript.length >= 3) {
        processVoiceCommand(lastTranscript)
      }
      if (voiceStopTimerRef.current) {
        clearTimeout(voiceStopTimerRef.current)
        voiceStopTimerRef.current = null
      }
      setVoiceCmdListening(false)
    }

    rec.start()
    setVoiceCmdListening(true)
    voiceStopTimerRef.current = setTimeout(() => {
      rec.stop()
    }, 2500)
  }

  function removeFromDay(dayIdx, itemId) {
    setDays(d => ({ ...d, [dayIdx]: d[dayIdx].filter(i => (i._id !== itemId) || i._taskStatus) }))
  }

  function updateItem(dayIdx, itemId, field, val) {
    setDays(d => ({
      ...d,
      [dayIdx]: d[dayIdx].map(i => (i._id === itemId && !i._taskStatus) ? { ...i, [field]: val } : i),
    }))
  }

  function handleDragEnd(event, dayIdx) {
    const { active, over } = event
    if (active.id !== over?.id) {
      setDays(d => {
        const arr = d[dayIdx]
        const oldIndex = arr.findIndex(i => i._id === active.id)
        const newIndex = arr.findIndex(i => i._id === over.id)
        return { ...d, [dayIdx]: arrayMove(arr, oldIndex, newIndex) }
      })
    }
  }

  function addTemplate() {
    setModal({ open: true, type: 'template', mode: 'add', payload: { title: '', instructions: '', category: 'medication', frequency: 'OD', color: 'yellow' } })
  }

  function editTemplate(index) {
    const t = templates[index]
    setModal({ open: true, type: 'template', mode: 'edit', payload: { index, color: 'yellow', frequency: 'OD', ...t } })
  }

  function togglePin(index) {
    setTemplates(prev => {
      const copy = [...prev];
      copy[index] = { ...copy[index], isPinned: !copy[index].isPinned };
      return copy;
    });
  }

  function deleteTemplate(index) {
    if(window.confirm('Delete template?')) setTemplates(prev => prev.filter((_, idx) => idx !== index))
  }

  function addPackage() {
    setModal({ open: true, type: 'package', mode: 'add', payload: { name: '', color: 'blue' } })
  }

  function editPackageName(pkgId) {
    const p = packages.find(x => x.id === pkgId)
    if(p) setModal({ open: true, type: 'package', mode: 'edit', payload: { pkgId, name: p.name, color: p.color } })
  }

  function deletePackage(pkgId) {
    if(window.confirm('Delete package?')) {
      setPackages(prev => prev.filter(p => p.id !== pkgId))
      if (expandedPkg === pkgId) setExpandedPkg(null)
    }
  }

  function addPackageItem(pkgId) {
    setModal({ open: true, type: 'packageItem', mode: 'add', payload: { pkgId, title: '', instructions: '', category: 'medication', frequency: 'OD' } })
  }

  function editPackageItem(pkgId, itemIdx) {
    const p = packages.find(x => x.id === pkgId)
    if(p) {
      const item = p.items[itemIdx]
      setModal({ open: true, type: 'packageItem', mode: 'edit', payload: { pkgId, itemIdx, frequency: 'OD', ...item } })
    }
  }

  function deletePackageItem(pkgId, itemIdx) {
    if(window.confirm('Delete item?')) {
      setPackages(prev => prev.map(p => p.id === pkgId ? {
        ...p,
        items: p.items.filter((_, idx) => idx !== itemIdx),
      } : p))
    }
  }

  function handleModalSave() {
    const { type, mode, payload } = modal;
    if (!payload) return;
    
    if (type === 'template') {
      const bestIcon = payload.icon || suggestIconsByName(payload.title)[0] || categoryEmoji[payload.category] || '📋';
      const newData = { title: payload.title, instructions: payload.instructions, category: payload.category, frequency: payload.frequency || 'OD', icon: bestIcon, color: payload.color || 'yellow' };
      if (mode === 'add') {
         setTemplates(prev => [...prev, newData]);
      } else {
         setTemplates(prev => prev.map((it, idx) => idx === payload.index ? { ...it, ...newData } : it));
      }
    } else if (type === 'package') {
      if (mode === 'add') {
         setPackages(prev => [...prev, { id: `pkg-${Date.now()}`, name: payload.name, color: payload.color, items: [] }]);
      } else {
         setPackages(prev => prev.map(p => p.id === payload.pkgId ? { ...p, name: payload.name, color: payload.color } : p));
      }
    } else if (type === 'packageItem') {
       const newItem = { title: payload.title, instructions: payload.instructions, category: payload.category, frequency: payload.frequency || 'OD' };
       if (mode === 'add') {
          setPackages(prev => prev.map(p => p.id === payload.pkgId ? {
            ...p,
            items: [...p.items, newItem],
          } : p));
       } else {
          setPackages(prev => prev.map(p => {
             if (p.id !== payload.pkgId) return p;
             return {
                ...p,
                items: p.items.map((it, idx) => idx === payload.itemIdx ? { ...it, ...newItem } : it)
             };
          }));
       }
    }
    setModal({ open: false, type: '', mode: 'add', payload: {} });
  }

  async function saveStaffAssignments() {
    if (!currentPlanId) {
      // Auto-save plan first, then assign
      const totalItems = Object.values(days).flat().length
      if (totalItems === 0) {
        toast.error('Add at least one order item before assigning staff')
        return
      }
      await createPlan()
      // createPlan sets currentPlanId via setCurrentPlanId but state isn't
      // synchronous; we re-open dropdown after plan save instead.
      toast('Plan saved — please click Assign staff again to select staff')
      return
    }
    setSavingStaff(true)
    try {
      const res = await api.get(`/treatment-plans/${currentPlanId}/staff-assignments/`)
      const current = res.data?.results || res.data?.data || res.data || []
      const currentMap = new Map((Array.isArray(current) ? current : []).map((a) => [String(a.staff), a]))
      const wanted = new Set(selectedStaffIds.map(String))
      const toDelete = (Array.isArray(current) ? current : []).filter((a) => !wanted.has(String(a.staff)))
      const toAdd = selectedStaffIds.filter((sid) => !currentMap.has(String(sid)))

      await Promise.all(toDelete.map((a) => api.delete(`/treatment-plans/${currentPlanId}/staff-assignments/${a.id}/`)))
      await Promise.all(
        toAdd.map((staffId) =>
          api.post(`/treatment-plans/${currentPlanId}/staff-assignments/`, {
            staff: staffId,
            plan: currentPlanId,
          }),
        ),
      )
      toast.success('Staff assignment updated')
      setStaffDropdownOpen(false)
    } catch (e) {
      toast.error(e?.response?.data?.detail || 'Failed to update staff assignment')
    } finally {
      setSavingStaff(false)
    }
  }

  async function createPlan() {
    if (!selectedAdm) return toast.error('Select a patient')
    const totalItems = Object.values(days).flat().length
    if (totalItems === 0) return toast.error('Add at least one order item')
    setLoading(true)
    try {
      const endDate = format(addDays(new Date(startDate), 3), 'yyyy-MM-dd')
      let planId = currentPlanId

      if (planId) {
        await api.patch(`/treatment-plans/${planId}/`, {
          name: planName || 'Treatment Plan',
          start_date: startDate,
          end_date: endDate,
        })
      } else {
        const adm = admissions.find(a => String(a.id) === String(selectedAdm))
        const autoName = adm ? `Plan – ${adm.patient_name || 'Patient'}` : (planName || 'Treatment Plan')
        const resPlan = await api.post('/treatment-plans/', {
          ipd_admission: selectedAdm,
          name: autoName,
          start_date: startDate,
          end_date: endDate,
        })
        const pl = resPlan.data?.data || resPlan.data
        planId = pl.id
        setCurrentPlanId(planId)
      }

      const nextFlatItems = Object.entries(days).flatMap(([dayOffset, items]) =>
        items.map((item) => ({ ...item, _dayOffset: parseInt(dayOffset, 10) })),
      )
      const lockedItemIds = new Set(nextFlatItems.filter((x) => x._taskStatus && x._serverId).map((x) => String(x._serverId)))
      const nextItemById = new Map(nextFlatItems.filter((x) => x._serverId).map((x) => [String(x._serverId), x]))
      for (const doneId of lockedItemIds) {
        const existing = nextItemById.get(doneId)
        if (!existing) {
          toast.error('Cannot delete a performed task item')
          setLoading(false)
          return
        }
      }

      const removedIds = initialServerItemsRef.current.filter((id) => !nextItemById.has(String(id)))
      if (removedIds.some((id) => lockedItemIds.has(String(id)))) {
        toast.error('Cannot remove performed task item')
        setLoading(false)
        return
      }

      let seq = 0
      for (const item of nextFlatItems) {
        seq++
        const payload = {
          plan: planId,
          sequence: seq,
          title: item.title,
          instructions: item.instructions || '',
          category: item.category,
          day_offset: item._dayOffset,
          time_of_day: item.time_of_day || '08:00',
          is_active: true,
        }
        if (item._serverId) {
          if (item._taskStatus) continue
          await api.patch(`/treatment-plan-items/${item._serverId}/`, payload)
        } else {
          await api.post('/treatment-plan-items/', payload)
        }
      }

      for (const removedId of removedIds) {
        await api.delete(`/treatment-plan-items/${removedId}/`)
      }

      await loadPlanDetails({ id: planId }, selectedAdm)
      const isNew = !currentPlanId
      await loadTimelineEvents(selectedAdm)
      toast.success(isNew ? `Plan created — now assign staff` : `Plan updated (${totalItems} orders)`)
      if (!isNew && selectedStaffIds.length === 0) {
        toast('No staff assigned yet — use Assign staff button', { icon: '⚠️' })
      }
    } catch (e) { toast.error(e.response?.data?.detail || 'Error saving plan') }
    finally { setLoading(false) }
  }

  function handleTimelineSelect(event) {
    const targetItemId = event?.treatment_item
    if (!targetItemId) return
    const dayMatch = Object.entries(days).find(([, items]) =>
      items.some((item) => String(item._serverId) === String(targetItemId)),
    )
    if (!dayMatch) return
    const nextDayIdx = Number(dayMatch[0])
    setActiveDayIdx(nextDayIdx)
    setFocusedServerItemId(String(targetItemId))
    setTimeout(() => setFocusedServerItemId(null), 1800)
  }

  const totalItems = Object.values(days).flat().length

  return (
    <div className="space-y-2 h-full flex flex-col overflow-hidden">
      <div className="bg-white rounded-lg px-2.5 py-1.5 border border-gray-200 shrink-0 flex flex-wrap items-center gap-2">
        {patientChip || (
          <div className="shrink-0">
            <select value={selectedAdm} onChange={e => setSelectedAdm(e.target.value)}
              className="border border-gray-200 rounded px-2 py-1 text-[11px] outline-none focus:border-blue-500 min-w-[140px]">
              <option value="">-- Patient --</option>
              {admissions.map(a => <option key={a.id} value={a.id}>{a.patient_name || a.id}</option>)}
            </select>
          </div>
        )}
        <div className="flex items-center gap-1.5 flex-1 min-w-0">
          <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)}
            className="border border-gray-200 rounded px-2 py-1 text-[11px] outline-none focus:border-blue-500 w-[130px] shrink-0" />
          {currentPlanId && <span className="text-[9px] text-slate-500 font-mono">Editing plan</span>}
        </div>
        <div className="relative shrink-0">
          <button
            type="button"
            onClick={() => setStaffDropdownOpen((s) => !s)}
            className="inline-flex items-center gap-1.5 border border-gray-200 rounded px-2 py-1 text-[11px] hover:bg-gray-50"
            title="Assign multiple staff"
          >
            <UserPlus size={12} />
            {selectedStaffIds.length > 0 ? `${selectedStaffIds.length} staff selected` : 'Assign staff'}
          </button>
          {staffDropdownOpen && (
            <div className="absolute right-0 mt-1 w-64 max-h-56 overflow-y-auto bg-white border border-gray-200 rounded-lg shadow-lg z-20 p-2 space-y-1">
              {staffList.map((s) => {
                const sid = String(s.id)
                const name = `${s.first_name || ''} ${s.last_name || ''}`.trim() || s.employee_code || sid
                const selected = selectedStaffIds.includes(sid)
                return (
                  <label key={sid} className="flex items-center gap-2 px-2 py-1 rounded hover:bg-gray-50 text-[11px]">
                    <input
                      type="checkbox"
                      checked={selected}
                      onChange={(e) => {
                        setSelectedStaffIds((prev) =>
                          e.target.checked ? [...new Set([...prev, sid])] : prev.filter((x) => x !== sid),
                        )
                      }}
                    />
                    <span className="flex-1 truncate">{name}</span>
                  </label>
                )
              })}
              {staffList.length === 0 && <p className="text-[11px] text-slate-500 px-2 py-1">No staff found</p>}
              <div className="pt-1 border-t border-gray-100 flex justify-end">
                <button
                  type="button"
                  onClick={saveStaffAssignments}
                  disabled={savingStaff || !currentPlanId}
                  className="text-[11px] px-2.5 py-1 rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
                >
                  {savingStaff ? 'Saving...' : 'Save Staff'}
                </button>
              </div>
            </div>
          )}
        </div>
        <button
          onClick={createPlan}
          disabled={loading || totalItems === 0}
          className="shrink-0 bg-blue-600 text-white px-3 py-1.5 rounded font-bold text-[11px] flex items-center justify-center gap-1.5 hover:bg-blue-700 disabled:opacity-50 transition-all"
        >
          <ClipboardList size={13} />
          {loading ? 'Saving...' : currentPlanId ? `Save (${totalItems})` : `Create (${totalItems})`}
        </button>
        {onBack && (
          <button
            type="button"
            onClick={onBack}
            className="shrink-0 border border-gray-200 text-gray-600 px-3 py-1.5 rounded text-[11px] hover:bg-gray-50 transition-all"
          >
            ← Back
          </button>
        )}
      </div>

      <div className="grid grid-cols-12 gap-2 flex-1 min-h-0 overflow-hidden">
        <div data-no-copy="true" className="doctor-no-copy col-span-12 lg:col-span-4 bg-white rounded-lg border border-gray-200 flex flex-col overflow-hidden">
          <div className="flex items-center gap-1 p-1.5 bg-gray-50 border-b border-gray-100">
            <button onClick={() => setPaletteTab('templates')}
              className={`flex-1 flex gap-1 items-center justify-center text-[10px] uppercase tracking-wide font-bold py-1.5 px-2 rounded-md transition-all ${paletteTab === 'templates' ? 'bg-white text-blue-700 shadow-sm border border-gray-200' : 'text-gray-400 hover:bg-gray-100/50'}`}>
              🧪 Templates <span className={`text-[9px] px-1 py-0.5 rounded ${paletteTab === 'templates' ? 'bg-blue-100 text-blue-700' : 'bg-gray-200 text-gray-500'}`}>{templates.length}</span>
            </button>
            <button onClick={() => setPaletteTab('packages')}
              className={`flex-1 flex gap-1 items-center justify-center text-[10px] uppercase tracking-wide font-bold py-1.5 px-2 rounded-md transition-all ${paletteTab === 'packages' ? 'bg-white text-blue-700 shadow-sm border border-gray-200' : 'text-gray-400 hover:bg-gray-100/50'}`}>
              📦 Packages <span className={`text-[9px] px-1 py-0.5 rounded ${paletteTab === 'packages' ? 'bg-purple-100 text-purple-700' : 'bg-gray-200 text-gray-500'}`}>{packages.length}</span>
            </button>
            <button
              onClick={toggleVoiceCmd}
              title={voiceCmdListening ? 'Stop voice command' : `Say a package or template name to add to Day ${activeDayIdx + 1}`}
              className={`relative flex items-center justify-center w-9 h-9 rounded-xl shrink-0 transition-all ${
                voiceCmdListening
                  ? 'bg-gradient-to-br from-indigo-500 to-purple-600 shadow-lg shadow-purple-500/40'
                  : 'bg-gray-100 hover:bg-purple-100 text-gray-500 hover:text-purple-600'
              }`}
            >
              {voiceCmdListening ? (
                <>
                  <Mic size={16} className="text-white z-10" />
                  <span className="absolute inset-0 rounded-xl animate-ping bg-purple-500/40" />
                </>
              ) : (
                <Mic size={16} />
              )}
            </button>
          </div>

          {voiceLog && (
            <div className="mx-2 mt-2 bg-gradient-to-r from-indigo-50 to-purple-50 border border-purple-200 rounded-xl px-3 py-2.5 flex flex-col gap-1.5 shadow-sm">
              <p className="text-[10px] text-purple-500 uppercase font-extrabold tracking-wider flex items-center gap-1">
                <Mic size={10} /> Heard: <span className="text-purple-700 font-bold normal-case tracking-normal">"{voiceLog.text.slice(0, 50)}"</span>
              </p>
              <div className="flex gap-2">
                <span className="text-[10px] font-bold bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full border border-blue-200">
                  Day {voiceLog.day}
                </span>
                {voiceLog.time && (
                  <span className="text-[10px] font-bold bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full border border-amber-200">
                    {voiceLog.time}
                  </span>
                )}
              </div>
              <div className="flex flex-wrap gap-1">
                {voiceLog.matched.map((m, i) => (
                  <span key={i} className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                    m.type === 'package' ? 'bg-purple-100 text-purple-700 border border-purple-200' : 'bg-blue-100 text-blue-700 border border-blue-200'
                  }`}>
                    {m.type === 'package' ? 'Package' : 'Template'} {m.name}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Templates tab */}
          {paletteTab === 'templates' && (
            <div className="p-3 overflow-y-auto flex-1 custom-scrollbar bg-gray-50/50">
              <div className="flex items-center justify-between mb-4">
                <p className="text-xs font-medium text-gray-400">Add directly to days →</p>
                <button onClick={addTemplate} className="text-xs bg-blue-100 text-blue-700 px-3 py-1.5 rounded-lg font-bold hover:bg-blue-200 transition-all shadow-sm">+ New Note</button>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2 pb-3">
                {templates.map((t, i) => ({ ...t, _originalIndex: i }))
                 .sort((a, b) => (b.isPinned ? 1 : 0) - (a.isPinned ? 1 : 0))
                 .map((t) => {
                  const i = t._originalIndex;
                  const c = pkgColors[t.color || 'yellow'] || pkgColors.yellow;
                  return (
                  <div key={i} onClick={() => addToDay(t, activeDayIdx)} className={`rounded-md border p-1.5 flex flex-col justify-start min-h-[92px] ${c.bg}/70 ${c.border} relative group transition-all duration-150 cursor-pointer hover:shadow-sm hover:-translate-y-0.5`}>
                    {t.isPinned && <div className="absolute -top-2 left-1/2 -translate-x-1/2 text-sm drop-shadow-sm z-10 transition-transform group-hover:scale-110">📌</div>}
                    <div className="min-w-0">
                      <div className="flex justify-between items-start mb-1">
                        <span className="text-xs bg-white/55 w-5 h-5 flex items-center justify-center rounded-md border border-white/40" title={t.category}>{t.icon || categoryEmoji[t.category]}</span>
                        <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button onClick={(e) => { e.stopPropagation(); togglePin(i) }} className="p-0.5 rounded bg-white/80 hover:bg-white border border-transparent hover:border-gray-300 text-[10px] leading-none text-gray-700 transition-all" title={t.isPinned ? "Unpin" : "Pin to Top"}>{t.isPinned ? '📍' : '📌'}</button>
                          <button onClick={(e) => { e.stopPropagation(); editTemplate(i) }} className={`p-0.5 rounded bg-white/80 hover:bg-white border border-transparent hover:border-gray-200 text-[10px] leading-none text-gray-700 transition-all ${c.text}`}>✏️</button>
                          <button onClick={(e) => { e.stopPropagation(); deleteTemplate(i) }} className="p-0.5 rounded bg-white/80 hover:bg-white border border-transparent hover:border-red-200 text-[10px] leading-none text-red-600 transition-all">❌</button>
                        </div>
                      </div>
                      <p className={`font-semibold text-[11px] leading-[1.1rem] mb-0.5 line-clamp-2 break-words ${c.text}`}>{t.title}</p>
                      {t.instructions && <p className={`text-[9px] leading-[0.85rem] line-clamp-2 break-words ${c.text} opacity-70`}>{t.instructions}</p>}
                    </div>
                  </div>
                )})}
              </div>
            </div>
          )}

          {/* Packages tab */}
          {paletteTab === 'packages' && (
            <div className="p-2 overflow-y-auto flex-1 space-y-2 custom-scrollbar">
              <div className="flex items-center justify-between px-1 mb-1">
                <p className="text-xs text-gray-400">Add all items in a package to any day →</p>
                <button onClick={addPackage} className="text-xs bg-purple-100 text-purple-700 px-2 py-0.5 rounded-lg font-semibold">+ Add</button>
              </div>
              {packages.map(pkg => {
                const c = pkgColors[pkg.color] || pkgColors.blue
                const isOpen = expandedPkg === pkg.id
                return (
                  <div key={pkg.id} className={`rounded-xl border ${c.border} ${c.bg} overflow-hidden text-xs`}>
                    {/* Package header */}
                    <button
                      onClick={() => setExpandedPkg(isOpen ? null : pkg.id)}
                      className={`w-full flex items-center justify-between px-3 py-2 text-left ${c.text}`}>
                      <div className="flex items-center gap-1.5">
                        <span className="text-sm">📦</span>
                        <span className="text-xs font-bold">{pkg.name}</span>
                        <span className="text-xs opacity-60">({pkg.items.length})</span>
                      </div>
                      <div className="flex items-center gap-1">
                        <button onClick={(e) => { e.stopPropagation(); editPackageName(pkg.id) }} className="text-[10px] px-1.5 py-0.5 rounded bg-white/70 text-gray-700">Edit</button>
                        <button onClick={(e) => { e.stopPropagation(); deletePackage(pkg.id) }} className="text-[10px] px-1.5 py-0.5 rounded bg-red-100 text-red-600">Del</button>
                        <span className="text-xs opacity-60">{isOpen ? '▲' : '▼'}</span>
                      </div>
                    </button>

                    {/* Add-to-day row always visible */}
                    <div className="px-2 pb-2">
                       <button onClick={() => addPackageToDay(pkg, activeDayIdx)}
                         className={`w-full text-xs font-bold py-1.5 rounded-lg transition-all ${c.btn}`}
                         title={`Add all to Day ${activeDayIdx + 1}`}>+ Add to Day {activeDayIdx + 1}</button>
                    </div>

                    {/* Expandable item list */}
                    {isOpen && (
                      <div className="px-2 pb-2 space-y-1 border-t border-white/60 pt-2">
                        <button onClick={() => addPackageItem(pkg.id)} className="w-full text-[11px] py-1 rounded-lg bg-white/80 text-gray-700 font-semibold">
                          + Add item to package
                        </button>
                        {pkg.items.map((item, idx) => (
                          <div key={idx} className="flex items-center gap-1.5 text-xs text-gray-600 bg-white/70 rounded-lg px-2 py-1">
                            <span>{categoryEmoji[item.category]}</span>
                            <span className="flex-1 truncate font-medium">{item.title}</span>
                            <span className="text-blue-500 font-bold shrink-0 bg-blue-50 px-1.5 py-0.5 rounded">{item.frequency || item.time_of_day || 'OD'}</span>
                            <button onClick={() => editPackageItem(pkg.id, idx)} className="text-[10px] px-1 py-0.5 rounded bg-gray-100 text-gray-600">E</button>
                            <button onClick={() => deletePackageItem(pkg.id, idx)} className="text-[10px] px-1 py-0.5 rounded bg-red-100 text-red-600">D</button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>

        <div data-no-copy="true" className="doctor-no-copy col-span-12 lg:col-span-5 bg-white rounded-lg border border-gray-200 flex flex-col overflow-hidden">
          <div className="flex border-b border-gray-100 bg-gray-50/50 p-1.5 gap-1.5">
             {[0, 1, 2, 3].map(dayIdx => (
                <button
                   key={dayIdx}
                   onClick={() => setActiveDayIdx(dayIdx)}
                   className={`flex-1 py-1.5 px-2 rounded-md flex items-center justify-between transition-all ${activeDayIdx === dayIdx ? 'bg-white shadow-sm border border-gray-200' : 'hover:bg-gray-100/50 text-gray-500'}`}
                >
                   <div className="text-left">
                     <p className={`text-[11px] font-bold ${activeDayIdx === dayIdx ? 'text-blue-700' : ''}`}>Day {dayIdx + 1}</p>
                     <p className={`text-[9px] ${activeDayIdx === dayIdx ? 'text-blue-400' : 'text-gray-400'}`}>{format(addDays(new Date(startDate), dayIdx), 'dd MMM')}</p>
                   </div>
                   <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ${activeDayIdx === dayIdx ? 'bg-blue-100 text-blue-600' : 'bg-gray-200 text-gray-600'}`}>{days[dayIdx].length} items</span>
                </button>
             ))}
          </div>
          <div className="p-2 flex-1 bg-gray-50/30 overflow-y-auto custom-scrollbar">
            <div className="relative mb-2">
              <input
                value={inlineQuery}
                onChange={(e) => {
                  setInlineQuery(e.target.value)
                  setInlineOpen(true)
                  setInlineActiveIdx(0)
                }}
                onFocus={() => {
                  if (inlineBlurTimerRef.current) clearTimeout(inlineBlurTimerRef.current)
                  setInlineOpen(true)
                }}
                onBlur={() => {
                  inlineBlurTimerRef.current = setTimeout(() => setInlineOpen(false), 120)
                }}
                onKeyDown={handleInlineKeyDown}
                placeholder={`Type order for Day ${activeDayIdx + 1}...`}
                className="w-full h-8 rounded-md border border-gray-200 bg-white px-2.5 text-xs text-gray-700 outline-none focus:border-blue-400"
              />
              {inlineOpen && inlineQuery.trim().length > 0 && (
                <div className="absolute z-20 left-0 right-0 mt-1 max-h-56 overflow-y-auto rounded-md border border-gray-200 bg-white shadow-lg">
                  {inlineSuggestions.length > 0 ? (
                    inlineSuggestions.map((item, idx) => (
                      <button
                        key={item.id}
                        type="button"
                        onMouseDown={() => {
                          applyInlineSelection(item)
                          clearInlineInput()
                        }}
                        className={`w-full text-left px-2.5 py-1.5 border-b last:border-b-0 border-gray-100 ${
                          inlineActiveIdx === idx ? 'bg-blue-50' : 'bg-white hover:bg-gray-50'
                        }`}
                      >
                        <p className="text-[11px] font-semibold text-gray-800 leading-4">
                          {item.type === 'package' ? '📦' : '🧪'} {item.label}
                        </p>
                        <p className="text-[10px] text-gray-500 truncate">{item.subtitle}</p>
                      </button>
                    ))
                  ) : (
                    <button
                      type="button"
                      onMouseDown={() => {
                        addInlineCustomNote(inlineQuery)
                        clearInlineInput()
                      }}
                      className="w-full text-left px-2.5 py-2 bg-white hover:bg-gray-50"
                    >
                      <p className="text-[11px] font-semibold text-gray-800">Create new note</p>
                      <p className="text-[10px] text-gray-500 truncate">{inlineQuery}</p>
                    </button>
                  )}
                </div>
              )}
            </div>
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={e => handleDragEnd(e, activeDayIdx)}>
              <SortableContext items={days[activeDayIdx].map(i => i._id)} strategy={verticalListSortingStrategy}>
                <div className="space-y-2 min-h-[400px]">
                  {days[activeDayIdx].length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-32 text-gray-400 text-xs border-2 border-dashed border-gray-200 rounded-lg bg-white mt-2">
                      <Plus size={20} className="mb-1 text-gray-300" />
                      Add orders to Day {activeDayIdx + 1}
                    </div>
                  ) : (
                    days[activeDayIdx].map(task => (
                      <SortableTaskRow
                        key={task._id}
                        task={task}
                        onRemove={id => removeFromDay(activeDayIdx, id)}
                        onUpdate={(id, field, val) => updateItem(activeDayIdx, id, field, val)}
                        isFocused={focusedServerItemId && String(task._serverId) === String(focusedServerItemId)}
                      />
                    ))
                  )}
                </div>
              </SortableContext>
            </DndContext>
          </div>
        </div>

        <div className="col-span-12 lg:col-span-3 bg-white rounded-lg border border-gray-200 p-2 overflow-hidden">
          <TreatmentAuditTimeline
            events={tpHistoryEvents}
            onSelectEvent={handleTimelineSelect}
            maxHeightClass="max-h-[560px]"
          />
        </div>
      </div>

      {modal.open && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/40 backdrop-blur-[2px]">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden border border-gray-100">
            <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
              <h3 className="font-extrabold text-gray-800 text-lg">
                {modal.mode === 'add' ? 'Create' : 'Edit'} {modal.type === 'template' ? 'Template' : modal.type === 'package' ? 'Package' : 'Package Item'}
              </h3>
              <button type="button" onClick={() => setModal({ open: false, type: '', mode: 'add', payload: {} })} className="text-gray-400 hover:text-gray-800 bg-gray-50 hover:bg-gray-100 p-1.5 rounded-full transition-all">
                <X size={18} />
              </button>
            </div>
            <div className="p-5 space-y-4">
              {modal.type === 'package' ? (
                <>
                  <div>
                    <label className="text-xs font-bold text-gray-500 mb-1.5 block uppercase tracking-wider">Package Name <span className="text-red-400">*</span></label>
                    <input autoFocus value={modal.payload.name || ''} onChange={e => setModal({...modal, payload: {...modal.payload, name: e.target.value}})} className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none transition-all font-medium text-gray-800" placeholder="e.g. ICU General Protocol" />
                  </div>
                  <div>
                    <label className="text-xs font-bold text-gray-500 mb-1.5 block uppercase tracking-wider">Color Tag</label>
                    <div className="grid grid-cols-5 gap-2">
                       {['purple', 'green', 'blue', 'red', 'amber'].map(c => (
                         <button key={c} type="button" onClick={() => setModal({...modal, payload: {...modal.payload, color: c}})} 
                            className={`w-full aspect-square rounded-xl flex items-center justify-center transition-all ${modal.payload.color === c ? 'ring-2 ring-offset-2 ring-gray-800 scale-110 shadow-sm' : 'hover:scale-105'}`}
                         >
                            <span className={`block w-full h-full rounded-xl ${pkgColors[c]?.bg || `bg-${c}-50`} ${pkgColors[c]?.border || `border-${c}-200`} border-2 border-solid`}></span>
                         </button>
                       ))}
                    </div>
                  </div>
                </>
              ) : (
                <>
                  <div>
                    <label className="text-xs font-bold text-gray-500 mb-1.5 block uppercase tracking-wider">Title <span className="text-red-400">*</span></label>
                    <input autoFocus value={modal.payload.title || ''} onChange={e => setModal({...modal, payload: {...modal.payload, title: e.target.value}})} className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none transition-all font-medium text-gray-800" placeholder="e.g. Administer Glucose" />
                  </div>
                  <div>
                    <label className="text-xs font-bold text-gray-500 mb-1.5 block uppercase tracking-wider">Instructions</label>
                    <input value={modal.payload.instructions || ''} onChange={e => setModal({...modal, payload: {...modal.payload, instructions: e.target.value}})} className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none transition-all font-medium text-gray-800" placeholder="e.g. 500ml IV over 2 hours" />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                     <div>
                      <label className="text-xs font-bold text-gray-500 mb-1.5 block uppercase tracking-wider">Category</label>
                      <select value={modal.payload.category || 'medication'} onChange={e => setModal({...modal, payload: {...modal.payload, category: e.target.value}})} className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none transition-all font-medium text-gray-800 bg-white cursor-pointer">
                        {Object.keys(categoryEmoji).map(c => <option key={c} value={c}>{categoryEmoji[c]} <span className="capitalize">{c}</span></option>)}
                      </select>
                    </div>
                    <div>
                      <label className="text-xs font-bold text-gray-500 mb-1.5 block uppercase tracking-wider">Frequency</label>
                      <select value={modal.payload.frequency || 'OD'} onChange={e => setModal({...modal, payload: {...modal.payload, frequency: e.target.value}})} className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none transition-all font-medium text-gray-800 bg-white cursor-pointer">
                        {Object.keys(FREQ_MAP).map(f => <option key={f} value={f}>{f} ({FREQ_MAP[f].length}x)</option>)}
                      </select>
                    </div>
                  </div>
                  {modal.type === 'template' && (
                    <div>
                      <label className="text-xs font-bold text-gray-500 mb-1.5 block uppercase tracking-wider mt-4">Sticky Note Color</label>
                      <div className="grid grid-cols-6 gap-2">
                         {['yellow', 'purple', 'green', 'blue', 'red', 'amber'].map(c => (
                           <button key={c} type="button" onClick={() => setModal({...modal, payload: {...modal.payload, color: c}})} 
                              className={`w-full aspect-square rounded-xl flex items-center justify-center transition-all ${modal.payload.color === c ? 'ring-2 ring-offset-2 ring-gray-800 scale-110 shadow-sm' : 'hover:scale-105'}`}
                           >
                              <span className={`block w-full h-full rounded-xl ${pkgColors[c]?.bg || `bg-${c}-50`} ${pkgColors[c]?.border || `border-${c}-200`} border-2 border-solid`}></span>
                           </button>
                         ))}
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
            <div className="px-5 py-4 border-t border-gray-100 bg-gray-50/50 flex justify-end gap-3">
               <button onClick={() => setModal({ open: false, type: '', mode: 'add', payload: {} })} className="px-5 py-2.5 text-sm font-bold text-gray-600 hover:text-gray-900 bg-white border border-gray-200 hover:border-gray-300 hover:shadow-sm rounded-xl transition-all">Cancel</button>
               <button onClick={handleModalSave} disabled={!(modal.type === 'package' ? modal.payload.name : modal.payload.title)} className="px-7 py-2.5 text-sm font-bold text-white bg-blue-600 hover:bg-blue-700 shadow-md hover:shadow-lg shadow-blue-600/20 rounded-xl disabled:opacity-50 transition-all flex items-center gap-2">
                 <CheckCircle size={16} /> Save
               </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Discharge Summary Tab ────────────────────────────────────────────────────

const dsInp = 'w-full [box-sizing:border-box] bg-white border border-slate-300 hover:border-slate-400 shadow-sm rounded-lg px-4 py-2 text-sm text-slate-800 focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 outline-none [&[type=date]]:pr-10 [&[type=time]]:pr-11 [&[type=datetime-local]]:pr-10'
const dsLbl = 'text-[10px] font-black text-slate-400 uppercase tracking-wider mb-1 block'

function emptyDischargeSummary() {
  return {
    summary_notes: '', treatment_given: '', condition_at_discharge: 'Stable',
    medications_on_discharge: '', follow_up_advice: '',
    reason_for_admission: '', diagnosis: '', allergies: '', procedure_surgery: '',
    medical_history: '', physical_examination: '', investigations: '', course_in_hospital: '',
    diet_advice: '', activity_advice: '', warning_signs: '',
    chief_complaints: '', co_morbidities: '', family_history: '', personal_history: '',
    complications_during_stay: '', blood_transfusion_details: '', implants_used: '',
    indwelling_devices_on_discharge: '', vaccination_given: '', wound_care_instructions: '',
    stitch_removal_date: '',
    vitals_at_discharge: { bp: '', pulse: '', spo2: '', temp: '', weight: '', rbs: '' },
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
    investigation_rows: [], surgery_rows: [],
  }
}

function emptyDsSurgery() {
  return { surgery_date: '', procedure_name: '', surgeon_name: '', assistant_name: '', anaesthetist_name: '', anaesthesia_type: '', operative_findings: '', intra_op_complications: '' }
}

function DischargeSummaryTab() {
  const user = useAuthStore((s) => s.user) || {}
  const [admissions, setAdmissions] = useState([])
  const [summaryMap, setSummaryMap] = useState({})
  const [selectedId, setSelectedId] = useState(null)
  const [existingSummaryId, setExistingSummaryId] = useState(null)
  const [summary, setSummary] = useState(emptyDischargeSummary())
  const [surgeryDraft, setSurgeryDraft] = useState(emptyDsSurgery())
  const [editingSurgeryIndex, setEditingSurgeryIndex] = useState(-1)
  const [dischargeRxItems, setDischargeRxItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [search, setSearch] = useState('')
  const dischargeScrollRootRef = useRef(null)
  const [activeDischargeSection, setActiveDischargeSection] = useState('')
  const { getSuggestions } = useDischargeFieldCatalog(Boolean(selectedId))

  const dischargeSectionNavItems = useMemo(() => {
    const items = [
      { id: 'dds-metadata', Icon: ClipboardList, label: 'Metadata & Identifiers' },
      ...(summary.discharge_type === 'death' ? [{ id: 'dds-death', Icon: Stethoscope, label: 'Death Summary' }] : []),
      { id: 'dds-narrative', Icon: FileText, label: 'Clinical Narrative' },
      { id: 'dds-operative', Icon: Scissors, label: 'Operative / Procedure' },
      { id: 'dds-investigations', Icon: Search, label: 'Investigations' },
      { id: 'dds-course', Icon: Stethoscope, label: 'Hospital Course' },
      { id: 'dds-prescriptions', Icon: Pill, label: 'Medications' },
      { id: 'dds-advice', Icon: Receipt, label: 'Advice on Discharge' },
    ]
    return items
  }, [summary.discharge_type])

  // Scroll spy
  useEffect(() => {
    const root = dischargeScrollRootRef.current
    if (!root || !selectedId) return
    const ids = dischargeSectionNavItems.map((i) => i.id)
    let raf = 0
    const observer = new IntersectionObserver((entries) => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => {
        const visible = entries.filter((e) => e.isIntersecting && e.target?.id)
        if (visible.length) {
          const top = visible.sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0]
          setActiveDischargeSection(top.target.id)
        }
      })
    }, { root, threshold: 0.15 })
    ids.forEach((id) => { const el = root.querySelector(`[id="${id}"]`); if (el) observer.observe(el) })
    return () => { observer.disconnect(); cancelAnimationFrame(raf) }
  }, [selectedId, dischargeSectionNavItems])

  // helpers
  const setVital = (k, v) => setSummary(s => ({ ...s, vitals_at_discharge: { ...(s.vitals_at_discharge || {}), [k]: v } }))
  const addInvRow = () => setSummary(s => ({ ...s, investigation_rows: [...(s.investigation_rows || []), { category: 'lab', test_name: '', value: '', reference_range: '', test_date: '' }] }))
  const updateInvRow = (idx, key, val) => setSummary(s => { const rows = [...(s.investigation_rows || [])]; if (rows[idx]) rows[idx] = { ...rows[idx], [key]: val }; return { ...s, investigation_rows: rows } })
  const removeInvRow = (idx) => setSummary(s => ({ ...s, investigation_rows: (s.investigation_rows || []).filter((_, i) => i !== idx) }))
  const updateSurgeryField = (k, v) => setSurgeryDraft(d => ({ ...d, [k]: v }))
  const resetSurgeryDraft = () => { setSurgeryDraft(emptyDsSurgery()); setEditingSurgeryIndex(-1) }
  const saveSurgeryRow = () => {
    const proc = (surgeryDraft.procedure_name || '').trim()
    if (!proc) { toast.error('Procedure name is required'); return }
    const row = { ...surgeryDraft, procedure_name: proc }
    setSummary(s => {
      const rows = [...(s.surgery_rows || [])]
      if (editingSurgeryIndex >= 0 && rows[editingSurgeryIndex]) rows[editingSurgeryIndex] = row
      else rows.push(row)
      return { ...s, surgery_rows: rows }
    })
    resetSurgeryDraft()
  }
  const editSurgeryRow = (idx) => { const row = (summary.surgery_rows || [])[idx]; if (row) { setSurgeryDraft({ ...emptyDsSurgery(), ...row }); setEditingSurgeryIndex(idx) } }
  const removeSurgeryRow = (idx) => { setSummary(s => ({ ...s, surgery_rows: (s.surgery_rows || []).filter((_, i) => i !== idx) })); if (editingSurgeryIndex === idx) resetSurgeryDraft() }

  async function loadData() {
    setLoading(true)
    try {
      const admRes = await api.get('/ipd-admissions/?status=admitted&limit=500')
      const all = admRes.data?.data || admRes.data?.results || admRes.data || []
      const mine = all.filter((a) => a.assigned_doctor && String(a.assigned_doctor) === String(user.id))
      setAdmissions(mine.length ? mine : all)
    } catch { toast.error('Failed to load admissions') }
    finally { setLoading(false) }
    try {
      const sumRes = await api.get('/summaries/?limit=500')
      const list = sumRes.data?.data || sumRes.data?.results || sumRes.data || []
      const map = {}; list.forEach((s) => { map[String(s.admission)] = s }); setSummaryMap(map)
    } catch { /* migration may be pending */ }
  }

  useEffect(() => { loadData() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  function selectAdmission(admission) {
    setSelectedId(admission.id)
    setDischargeRxItems([])
    const existing = summaryMap[String(admission.id)]
    if (existing) {
      setExistingSummaryId(existing.id)
      setSummary({ ...emptyDischargeSummary(), ...existing, investigation_rows: existing.investigation_rows || [], surgery_rows: existing.surgery_rows || [] })
      if (existing.medication_rows?.length) {
        try { setDischargeRxItems(medicationRowsToRxItems(existing.medication_rows, DEFAULT_DOSAGE_PATTERNS, DEFAULT_TIMING_OPTIONS)) } catch { /* ignore */ }
      }
    } else {
      setExistingSummaryId(null)
      setSummary({ ...emptyDischargeSummary(), treating_consultant: user.first_name ? `${user.first_name} ${user.last_name || ''}`.trim() : (user.email || '') })
    }
  }

  async function handleSave(isDraft) {
    if (!selectedId) return
    setSaving(true)
    try {
      const payload = {
        ...summary,
        admission: selectedId,
        is_draft: isDraft,
        medication_rows: rxItemsToMedicationRows(dischargeRxItems, DEFAULT_DOSAGE_PATTERNS, DEFAULT_TIMING_OPTIONS),
        investigation_rows: Array.isArray(summary.investigation_rows) ? summary.investigation_rows : [],
        surgery_rows: Array.isArray(summary.surgery_rows) ? summary.surgery_rows : [],
      }
      let saved
      const res = await api.post('/summaries/', payload)
      saved = res.data?.data || res.data
      setExistingSummaryId(saved?.id || existingSummaryId || null)
      setSummaryMap((prev) => ({ ...prev, [String(selectedId)]: saved }))
      toast.success(isDraft ? 'Saved as draft' : 'Discharge summary finalised')
    } catch (err) {
      const detail = err?.response?.data?.detail || err?.response?.data?.non_field_errors?.[0]
      toast.error(detail || 'Failed to save — ensure the server migration has been applied (python manage.py migrate)')
    } finally { setSaving(false) }
  }

  const filteredAdmissions = admissions.filter((a) => {
    const q = search.toLowerCase()
    return !q || (a.patient_name || '').toLowerCase().includes(q) || (a.ward_name || '').toLowerCase().includes(q) || (a.bed_code || '').toLowerCase().includes(q)
  })

  const selectedAdmission = admissions.find((a) => a.id === selectedId)
  const currentSummary = selectedId ? summaryMap[String(selectedId)] : null

  if (loading) return (
    <div className="flex items-center justify-center h-64 text-slate-400 text-sm gap-2">
      <Loader2 size={18} className="animate-spin" /> Loading admissions…
    </div>
  )

  return (
    <div className="flex h-full overflow-hidden">
      {/* ── Patient list (left panel) ── */}
      <div className="w-64 shrink-0 flex flex-col border-r border-slate-200 bg-slate-50">
        <div className="px-3 pt-3 pb-2">
          <div className="flex items-center gap-2 bg-white border border-slate-200 rounded-xl px-2.5 py-1.5">
            <Search size={13} className="text-slate-400 shrink-0" />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search patient / bed…" className="flex-1 text-[11px] outline-none bg-transparent" />
          </div>
        </div>
        <div className="flex-1 overflow-y-auto px-2 pb-3 space-y-1">
          {filteredAdmissions.length === 0 && <p className="text-center text-slate-400 text-xs py-8">No active admissions</p>}
          {filteredAdmissions.map((a) => {
            const sum = summaryMap[String(a.id)]
            const isSelected = a.id === selectedId
            return (
              <button key={a.id} onClick={() => selectAdmission(a)}
                className={`w-full text-left rounded-xl border px-3 py-2.5 transition-colors ${isSelected ? 'border-emerald-500 bg-emerald-50' : 'border-slate-200 bg-white hover:bg-slate-100'}`}>
                <p className="text-[11px] font-semibold text-slate-800 truncate">{a.patient_name || a.patient}</p>
                <p className="text-[10px] text-slate-400 truncate mt-0.5">{a.ward_name || '—'} · Bed {a.bed_code || '—'}</p>
                <div className="mt-1.5">
                  {!sum ? <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-500 font-semibold">No Summary</span>
                    : sum.is_draft ? <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 font-semibold">Draft</span>
                    : <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-emerald-100 text-emerald-700 font-semibold">Final</span>}
                </div>
              </button>
            )
          })}
        </div>
      </div>

      {/* ── Form area (right) ── */}
      {!selectedAdmission ? (
        <div className="flex-1 flex flex-col items-center justify-center text-slate-400 gap-3">
          <FileText size={40} className="opacity-30" />
          <p className="text-sm font-medium">Select a patient from the left to write their discharge summary</p>
        </div>
      ) : (
        <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
          {/* Discharge Process Header */}
          <div className="relative bg-gradient-to-br from-emerald-600 via-emerald-500 to-teal-500 px-5 py-3 text-white shrink-0 overflow-hidden">
            <div className="absolute top-0 right-0 -mr-16 -mt-16 w-64 h-64 rounded-full bg-white opacity-10 mix-blend-overlay" />
            <div className="absolute bottom-0 right-32 -mb-20 w-48 h-48 rounded-full bg-white opacity-10 mix-blend-overlay" />
            <div className="relative flex items-center justify-between z-10">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-lg bg-white/20 backdrop-blur-md flex items-center justify-center shadow-inner border border-white/30">
                  <Activity size={18} className="text-white" />
                </div>
                <div>
                  <h3 className="font-black text-base tracking-tight leading-none drop-shadow-sm flex items-center gap-2 flex-wrap">
                    Discharge Summary
                    <span className="bg-white/20 px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-widest">IPD: {selectedAdmission.ipd_no || 'N/A'}</span>
                    <span className="bg-white/20 px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-widest">UHID: {selectedAdmission.patient_uhid || 'N/A'}</span>
                    {currentSummary && (
                      <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-widest ${currentSummary.is_draft ? 'bg-amber-400/80 text-amber-900' : 'bg-white/30 text-white'}`}>
                        {currentSummary.is_draft ? 'Draft' : 'Final'}
                      </span>
                    )}
                  </h3>
                  <p className="text-emerald-50 mt-0.5 text-xs font-medium opacity-90">{selectedAdmission.patient_name}</p>
                </div>
              </div>
            </div>
          </div>

          {/* Sidebar nav + scroll area */}
          <div className="flex flex-1 min-h-0 bg-slate-50">
            {/* Section nav icons */}
            <aside className="shrink-0 w-12 flex flex-col items-center gap-1.5 py-3 px-0.5 border-r border-slate-200/80 bg-gradient-to-b from-white via-slate-50/95 to-slate-100/90 overflow-y-auto">
              <span className="text-[8px] font-black uppercase tracking-widest text-slate-400 mb-0.5 select-none">Jump</span>
              {dischargeSectionNavItems.map(({ id, Icon, label }, idx) => (
                <React.Fragment key={id}>
                  {idx > 0 && <div className="w-px h-1.5 bg-gradient-to-b from-transparent via-slate-300/80 to-transparent" />}
                  <button type="button" title={label}
                    onClick={() => { const el = dischargeScrollRootRef.current?.querySelector(`[id="${id}"]`); el?.scrollIntoView({ behavior: 'smooth', block: 'start' }) }}
                    className={`relative w-9 h-9 rounded-xl flex items-center justify-center transition-all duration-200 focus:outline-none ${activeDischargeSection === id ? 'bg-emerald-600 text-white shadow-lg scale-110 ring-2 ring-emerald-200 ring-offset-1' : 'bg-white text-slate-500 shadow-sm border border-slate-200/90 hover:border-emerald-300 hover:bg-emerald-50 hover:text-emerald-700'}`}>
                    <Icon size={activeDischargeSection === id ? 17 : 16} />
                    {activeDischargeSection === id && <span className="pointer-events-none absolute inset-0 rounded-xl ring-2 ring-white/40 animate-pulse" />}
                  </button>
                </React.Fragment>
              ))}
            </aside>

            {/* Scrollable form */}
            <div ref={dischargeScrollRootRef} className="flex-1 overflow-y-auto px-5 py-4 space-y-4 scroll-smooth scroll-pt-3">
              <div className="flex flex-wrap items-center justify-between gap-2 mb-1">
                <div>
                  <h4 className="text-lg font-black text-slate-800 tracking-tight">Clinical Documentation</h4>
                  <p className="text-xs text-slate-500 font-medium mt-0.5">Use sections below; structured meds &amp; labs print as tables.</p>
                </div>
                <div className="text-[11px] font-semibold text-slate-600 bg-white border border-slate-200 px-2.5 py-1 rounded-lg">
                  Ward: {selectedAdmission.ward_name || 'N/A'} | Bed: {selectedAdmission.bed_code || 'N/A'} | Dept: {selectedAdmission.department || '—'}
                </div>
              </div>

              <DischargeClinicalForm
                sectionIdPrefix="dds"
                summary={summary}
                setSummary={setSummary}
                surgeryDraft={surgeryDraft}
                updateSurgeryDraftField={updateSurgeryField}
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
                  <div className="pt-3 mt-1 border-t border-slate-200/60 flex justify-end gap-3">
                    <button type="button" onClick={() => handleSave(true)} disabled={saving}
                      className="flex items-center gap-2 border border-amber-300 bg-amber-50 text-amber-800 px-5 py-2.5 rounded-xl text-sm font-bold hover:bg-amber-100 disabled:opacity-50 transition-all active:scale-95">
                      {saving ? <Loader2 size={15} className="animate-spin" /> : null}
                      Save as Draft
                    </button>
                    <button type="button" onClick={() => handleSave(false)} disabled={saving}
                      className="flex items-center gap-2 bg-emerald-700 text-white px-6 py-2.5 rounded-xl text-sm font-bold hover:bg-emerald-800 disabled:opacity-50 transition-all active:scale-95 focus:ring-4 focus:ring-emerald-300">
                      {saving ? <Loader2 size={15} className="animate-spin" /> : null}
                      Save as Final
                    </button>
                  </div>
                }
              />

            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── End Discharge Summary Tab ─────────────────────────────────────────────────

export default function DoctorPortal() {
  useTimeDisplayMode()
  const [tab, setTab] = useState('opd')
  const [aiMode, setAiMode] = useState(false)
  const [showAiTransition, setShowAiTransition] = useState(false)
  const doctorPortalRef = useRef(null)
  const user = useAuthStore((s) => s.user) || {}
  const role = String(localStorage.getItem('role') || user?.role || '').toLowerCase()
  const copyRestrictionsEnabled = !COPY_EXEMPT_ROLES.has(role)

  useDoctorPortalCopyProtection(doctorPortalRef, { enabled: copyRestrictionsEnabled })

  const toggleAI = () => {
    if (!aiMode) setShowAiTransition(true);
    else setAiMode(false);
  };

  const AIToggleBtn = (
    <button
      onClick={toggleAI}
      title={aiMode ? 'Disable AI Mode' : 'Enable AI Assistant'}
      className={`flex items-center gap-2 px-3 py-1 rounded-full text-[11px] font-extrabold transition-all duration-300 border-2 ${
        aiMode
          ? 'bg-white/20 border-white/40 text-white shadow-lg'
          : 'bg-white/10 border-white/20 text-white/80 hover:bg-white/20'
      }`}
    >
      <span className="text-base">🤖</span>
      <span className="hidden sm:inline">{aiMode ? 'AI ON' : 'AI OFF'}</span>
      <span className={`relative inline-flex h-4 w-8 items-center rounded-full transition-all ${
        aiMode ? 'bg-green-400' : 'bg-white/30'
      }`}>
        <span className={`inline-block h-3 w-3 rounded-full bg-white shadow transition-all ${
          aiMode ? 'translate-x-4' : 'translate-x-0.5'
        }`} />
      </span>
    </button>
  );

  return (
    <>
      {showAiTransition && <AITransitionOverlay onDone={() => { setShowAiTransition(false); setAiMode(true); }} />}
      <div ref={doctorPortalRef} className={`h-full flex flex-col ${copyRestrictionsEnabled ? 'doctor-portal-security-scope' : ''}`}>
        <Layout title="Doctor Portal" subtitle={user.email || 'Doctor'} color="blue" tabs={TABS} activeTab={tab} onTab={setTab} headerExtra={AIToggleBtn} noScroll={tab === 'opd'}>
          {tab === 'opd' && <OPDTab aiMode={aiMode} />}
          {tab === 'tp' && <TreatmentPlansModule TPBuilderComponent={TPBuilder} />}
          {tab === 'analytics' && <DoctorAnalytics />}
          {tab === 'discharge' && <DischargeSummaryTab />}
        </Layout>
      </div>
    </>
  )
}
