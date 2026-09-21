import { useEffect, useState } from 'react'
import { format } from 'date-fns'

export const TIME_DISPLAY_MODE_CHANGED = 'time-display-mode-changed'

const TOKENS_24H = {
  time: 'HH:mm',
  dateTime: 'dd/MM/yyyy HH:mm',
  dateTimeParen: 'dd/MM/yyyy (HH:mm)',
}

const TOKENS_12H = {
  time: 'h:mm a',
  dateTime: 'dd/MM/yyyy h:mm a',
  dateTimeParen: 'dd/MM/yyyy (h:mm a)',
}

const TIME_TOKEN_PLACEHOLDER = '\u0000TIME\u0000'

let cachedMode = '12h'

function normalizeMode(raw) {
  return raw === '12h' ? '12h' : '24h'
}

export function getTimeDisplayMode() {
  return cachedMode
}

export function syncTimeDisplayModeFromRow(row) {
  const next = normalizeMode(row?.time_display_mode)
  if (next === cachedMode) return
  cachedMode = next
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(TIME_DISPLAY_MODE_CHANGED, { detail: { mode: next } }))
  }
}

export function getTimeFormatTokens() {
  return cachedMode === '12h' ? { ...TOKENS_12H } : { ...TOKENS_24H }
}

function toDate(value) {
  if (value == null || value === '') return null
  const d = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(d.getTime())) return null
  return d
}

/** Seconds are never shown — `withSeconds` is kept for call-site compatibility. */
export function formatTime(value, { withSeconds: _withSeconds = false } = {}) {
  const d = toDate(value)
  if (!d) return '—'
  return format(d, getTimeFormatTokens().time)
}

export function formatDateOnly(value, { dateStyle = 'dd/MM/yyyy', empty = '' } = {}) {
  const d = toDate(value)
  if (!d) return empty
  try {
    return format(d, dateStyle)
  } catch {
    return empty
  }
}

/** Seconds are never shown — `withSeconds` is kept for call-site compatibility. */
export function formatDateTime(value, {
  withSeconds: _withSeconds = false,
  paren = false,
  dateStyle = 'dd/MM/yyyy',
} = {}) {
  const d = toDate(value)
  if (!d) return '—'
  const tokens = getTimeFormatTokens()
  if (paren) {
    return `${format(d, dateStyle)} (${format(d, tokens.time)})`
  }
  if (dateStyle !== 'dd/MM/yyyy') {
    return `${format(d, dateStyle)} ${format(d, tokens.time)}`
  }
  return format(d, tokens.dateTime)
}

/** Ledger / IPD receipt lines: date with time in parentheses (no seconds). */
export function formatReceiptDateTime(value) {
  const d = toDate(value)
  if (!d) return '—'
  const tokens = getTimeFormatTokens()
  return `${format(d, 'dd/MM/yyyy')} (${format(d, tokens.time)})`
}

/** Build a date-fns pattern with the current time tokens substituted (seconds stripped). */
export function withTimeTokens(pattern) {
  const tokens = getTimeFormatTokens()
  const ph = TIME_TOKEN_PLACEHOLDER
  // Substitute via a placeholder so `h:mm a` cannot match inside `hh:mm a`
  // (that produced `hhh:mm a` → 012:23 PM).
  return String(pattern || '')
    .replace(/HH:mm:ss/g, ph)
    .replace(/hh:mm:ss a/g, ph)
    .replace(/h:mm:ss a/g, ph)
    .replace(/HH:mm/g, ph)
    .replace(/hh:mm a/g, ph)
    .replace(/h:mm a/g, ph)
    .split(ph)
    .join(tokens.time)
}

export function formatWithPattern(dateVal, fmtStr, { empty = '—' } = {}) {
  if (!dateVal) return empty
  const d = toDate(dateVal)
  if (!d) return empty
  try {
    return format(d, withTimeTokens(fmtStr))
  } catch {
    return empty
  }
}

export function useTimeDisplayMode() {
  const [mode, setMode] = useState(() => getTimeDisplayMode())

  useEffect(() => {
    const onChange = (e) => setMode(e.detail?.mode || getTimeDisplayMode())
    window.addEventListener(TIME_DISPLAY_MODE_CHANGED, onChange)
    return () => window.removeEventListener(TIME_DISPLAY_MODE_CHANGED, onChange)
  }, [])

  return mode
}
