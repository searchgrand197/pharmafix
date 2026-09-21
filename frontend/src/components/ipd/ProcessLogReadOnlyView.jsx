import { format, parseISO } from 'date-fns'
import { ProcessFieldGrid } from './ProcessFieldLayoutWrapper'
import {
  VITAL_FIELDS,
  colSpanClass,
  formatProcessFieldValue,
  getFieldValueFromForm,
} from '../../utils/ipdProcessFieldConfig'

function isEmptyValue(field, value) {
  if (value == null || value === '') return true
  if (Array.isArray(value) && value.length === 0) return true
  if (field.type === 'builtin_vitals' && typeof value === 'object') {
    return !VITAL_FIELDS.some(([k]) => String(value[k] || '').trim())
  }
  if (field.type === 'user' && typeof value === 'object') {
    return !['name', 'phone', 'email'].some((k) => String(value[k] || '').trim())
  }
  return false
}

function formatDateValue(value, mode = 'date') {
  const raw = String(value || '').trim()
  if (!raw) return ''
  try {
    const d = raw.includes('T') ? parseISO(raw) : parseISO(`${raw.slice(0, 10)}T12:00:00`)
    if (mode === 'time') return format(d, 'h:mm a')
    if (mode === 'datetime') return format(d, 'd MMM yyyy, h:mm a')
    return format(d, 'd MMM yyyy')
  } catch {
    return raw
  }
}

function displayText(field, value) {
  if (field.type === 'builtin_text' || (field.type === 'text' && field.multiline)) {
    return String(value || '').trim()
  }
  if (field.type === 'builtin_vitals') return null
  if (field.type === 'datetime') {
    return formatDateValue(value, field.datetime_mode || 'date')
  }
  const formatted = formatProcessFieldValue(field, value)
  if (!formatted) return ''
  const prefix = `${field.label}: `
  return formatted.startsWith(prefix) ? formatted.slice(prefix.length) : formatted
}

function isMultilineField(field) {
  return field.type === 'builtin_text'
    || (field.type === 'text' && field.multiline)
    || field.layout?.col_span === 12
}

function ReportLabel({ children }) {
  return (
    <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">
      {children}
    </p>
  )
}

function VitalsInline({ vitals }) {
  const bits = VITAL_FIELDS
    .map(([key, label]) => (String(vitals?.[key] || '').trim() ? { key, label, val: vitals[key] } : null))
    .filter(Boolean)
  if (!bits.length) return null
  return (
    <p className="text-sm text-gray-800 leading-relaxed">
      {bits.map(({ key, label, val }, i) => (
        <span key={key}>
          {i > 0 ? <span className="text-slate-300 mx-2">·</span> : null}
          <span className="font-semibold text-gray-600">{label}</span>
          {' '}
          <span>{val}</span>
        </span>
      ))}
    </p>
  )
}

function ReportField({ field, form }) {
  const value = getFieldValueFromForm(form, field)
  if (isEmptyValue(field, value)) return null

  const colSpan = field.layout?.col_span || 12
  const multiline = isMultilineField(field)

  if (field.type === 'builtin_vitals') {
    return (
      <div className={colSpanClass(colSpan)}>
        <ReportLabel>{field.label}</ReportLabel>
        <VitalsInline vitals={value} />
      </div>
    )
  }

  const text = displayText(field, value)

  return (
    <div className={colSpanClass(colSpan)}>
      <ReportLabel>{field.label}</ReportLabel>
      <p className={`text-sm text-gray-800 leading-relaxed ${multiline ? 'whitespace-pre-wrap' : ''}`}>
        {text || '—'}
      </p>
    </div>
  )
}

function ReportGroup({ field, form }) {
  const children = (field.children || []).filter((c) => c.enabled !== false)
  const visibleChildren = children.filter((child) => {
    if (child.type === 'group') return hasVisibleContent(child.children || [], form)
    return !isEmptyValue(child, getFieldValueFromForm(form, child))
  })
  if (!visibleChildren.length) return null

  return (
    <section className={colSpanClass(field.layout?.col_span || 12)}>
      <h4 className="text-xs font-black uppercase tracking-wide text-violet-800 border-b border-violet-100 pb-2 mb-4">
        {field.label}
      </h4>
      <ProcessFieldGrid className="gap-y-4">
        {visibleChildren.map((child) => {
          if (child.type === 'group') {
            return <ReportGroup key={child.id} field={child} form={form} />
          }
          return <ReportField key={child.id} field={child} form={form} />
        })}
      </ProcessFieldGrid>
    </section>
  )
}

function hasVisibleContent(fields, form) {
  for (const field of fields) {
    if (field.enabled === false) continue
    if (field.type === 'group') {
      if (hasVisibleContent(field.children || [], form)) return true
      continue
    }
    if (!isEmptyValue(field, getFieldValueFromForm(form, field))) return true
  }
  return false
}

export default function ProcessLogReadOnlyView({ config, form }) {
  const fields = (config?.fields || []).filter((f) => f.enabled !== false)

  if (!hasVisibleContent(fields, form)) {
    return (
      <p className="text-sm text-gray-400 italic py-8 text-center">No data recorded for this day.</p>
    )
  }

  return (
    <article className="rounded-2xl border border-gray-100 bg-gradient-to-b from-slate-50/40 to-white px-6 py-5 shadow-sm">
      <ProcessFieldGrid className="gap-y-5">
        {fields.map((field) => {
          if (field.type === 'group') {
            return <ReportGroup key={field.id} field={field} form={form} />
          }
          return <ReportField key={field.id} field={field} form={form} />
        })}
      </ProcessFieldGrid>
    </article>
  )
}
