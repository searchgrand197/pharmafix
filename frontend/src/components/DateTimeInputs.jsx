import { useEffect, useId, useRef, useState } from 'react'
import { format } from 'date-fns'
import {
  parts12ToTime24,
  time24ToParts12,
} from '../utils/timeDisplay'
import { getTimeDisplayMode, useTimeDisplayMode } from '../utils/dateTimeFormat'

const HOURS_12 = Array.from({ length: 12 }, (_, i) => String(i + 1))
const MINUTES = Array.from({ length: 60 }, (_, i) => String(i).padStart(2, '0'))

/** Normalize API/date values to YYYY-MM-DD for native date inputs. */
export function toHtmlDateValue(v) {
  if (v == null || v === '') return ''
  const s = String(v).trim()
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (m) return `${m[1]}-${m[2]}-${m[3]}`
  const d = new Date(s)
  if (Number.isNaN(d.getTime())) return ''
  return format(d, 'yyyy-MM-dd')
}

/** Normalize API time (HH:MM:SS / HH:MM) to HH:MM. */
export function toHtmlTimeValue(v) {
  if (v == null || v === '') return ''
  const s = String(v).trim()
  const m = s.match(/^(\d{1,2}):(\d{2})/)
  if (m) return `${String(Number(m[1])).padStart(2, '0')}:${m[2]}`
  if (s.includes('T')) {
    const d = new Date(s)
    if (!Number.isNaN(d.getTime())) return format(d, 'HH:mm')
  }
  return ''
}

export function formatDisplayDate(v) {
  const iso = toHtmlDateValue(v)
  if (!iso) return ''
  return format(new Date(`${iso}T12:00:00`), 'dd/MM/yyyy')
}

/**
 * Date picker that displays DD/MM/YYYY while storing YYYY-MM-DD.
 */
export function FormattedDateInput({
  value,
  onChange,
  className = '',
  required = false,
  min,
  max,
  placeholder = 'DD/MM/YYYY',
  disabled = false,
}) {
  const hiddenRef = useRef(null)
  const display = formatDisplayDate(value)

  function openPicker() {
    const el = hiddenRef.current
    if (!el || disabled) return
    if (typeof el.showPicker === 'function') {
      try {
        el.showPicker()
        return
      } catch {
        /* fall through */
      }
    }
    el.focus()
    el.click()
  }

  return (
    <div className="relative">
      <input
        type="text"
        readOnly
        disabled={disabled}
        required={required && !value}
        value={display}
        onClick={openPicker}
        onFocus={openPicker}
        placeholder={placeholder}
        className={`${className} cursor-pointer bg-white`.trim()}
      />
      <input
        ref={hiddenRef}
        type="date"
        tabIndex={-1}
        aria-hidden="true"
        className="absolute inset-0 opacity-0 pointer-events-none w-full h-full"
        value={toHtmlDateValue(value)}
        min={min || undefined}
        max={max || undefined}
        onChange={(e) => onChange(e.target.value)}
        required={required}
        disabled={disabled}
      />
    </div>
  )
}

/**
 * Time input with AM/PM selects when hospital mode is 12h; otherwise HH:MM selects.
 * Value is always 24h HH:MM for the API.
 */
export function AmPmTimeInput({
  value,
  onChange,
  className = '',
  required = false,
  disabled = false,
  selectClassName = '',
}) {
  const mode = useTimeDisplayMode() || getTimeDisplayMode()
  const baseId = useId()
  const normalized = toHtmlTimeValue(value)
  const [parts, setParts] = useState(() => time24ToParts12(normalized))

  useEffect(() => {
    setParts(time24ToParts12(normalized))
  }, [normalized])

  function emit12(next) {
    setParts(next)
    onChange(parts12ToTime24(next.hour12, next.minute, next.period))
  }

  // Shared form classes (e.g. dsInp) include w-full + large px that crush hour/minute selects.
  const selectCls = String(
    selectClassName
    || 'border border-gray-200 rounded-xl text-sm bg-white focus:ring-2 focus:ring-blue-500 focus:outline-none',
  )
    .replace(/\bw-full\b/g, '')
    .replace(/\bpx-\d+\b/g, '')
    .replace(/\bpr-\d+\b/g, '')
    .replace(/\bpl-\d+\b/g, '')
    .concat(' px-1.5 py-2 text-center tabular-nums')
    .replace(/\s+/g, ' ')
    .trim()

  if (mode === '24h') {
    return (
      <input
        type="time"
        value={normalized}
        onChange={(e) => onChange(e.target.value)}
        required={required}
        disabled={disabled}
        className={className || `${selectClassName || selectCls} w-full`.trim()}
      />
    )
  }

  return (
    <div className={`flex items-center gap-1 w-full min-w-0 ${className}`.trim()}>
      <select
        id={`${baseId}-h`}
        required={required}
        disabled={disabled}
        className={`${selectCls} min-w-[3.25rem] flex-[1.1]`}
        value={parts.hour12}
        onChange={(e) => emit12({ ...parts, hour12: e.target.value })}
        aria-label="Hour"
      >
        <option value="">HH</option>
        {HOURS_12.map((h) => (
          <option key={h} value={h}>{h}</option>
        ))}
      </select>
      <span className="text-slate-400 font-bold shrink-0" aria-hidden>:</span>
      <select
        id={`${baseId}-m`}
        required={required}
        disabled={disabled}
        className={`${selectCls} min-w-[3.25rem] flex-[1.1]`}
        value={parts.minute}
        onChange={(e) => emit12({ ...parts, minute: e.target.value })}
        aria-label="Minute"
      >
        <option value="">MM</option>
        {MINUTES.map((m) => (
          <option key={m} value={m}>{m}</option>
        ))}
      </select>
      <select
        id={`${baseId}-p`}
        required={required}
        disabled={disabled}
        className={`${selectCls} min-w-[4.5rem] flex-[1.2]`}
        value={parts.period}
        onChange={(e) => emit12({ ...parts, period: e.target.value })}
        aria-label="AM or PM"
      >
        <option value="">AM/PM</option>
        <option value="AM">AM</option>
        <option value="PM">PM</option>
      </select>
    </div>
  )
}

