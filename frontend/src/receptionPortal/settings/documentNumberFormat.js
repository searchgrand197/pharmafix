export const DEFAULT_DOCUMENT_NUMBER_PARTS = {
  uhid: {
    kind: '',
    prefix: '',
    use_hospital_prefix: true,
    use_invoice_prefix: false,
    include_year: false,
    include_slug: false,
    separator: '-',
    seq_padding: 4,
  },
  opd: {
    kind: 'OPD',
    prefix: '',
    use_hospital_prefix: true,
    use_invoice_prefix: false,
    include_year: true,
    include_slug: false,
    separator: '-',
    seq_padding: 0,
  },
  ipd: {
    kind: 'IPD',
    prefix: '',
    use_hospital_prefix: true,
    use_invoice_prefix: false,
    include_year: true,
    include_slug: false,
    separator: '-',
    seq_padding: 0,
  },
  payment_slip: {
    kind: 'PSL',
    prefix: '',
    use_hospital_prefix: true,
    use_invoice_prefix: false,
    include_year: true,
    include_slug: false,
    separator: '-',
    seq_padding: 0,
  },
  receipt: {
    kind: '',
    prefix: '',
    use_hospital_prefix: false,
    use_invoice_prefix: true,
    include_year: false,
    include_slug: false,
    separator: '',
    seq_padding: 0,
  },
  ipd_advance: {
    kind: 'IPDADV',
    prefix: '',
    use_hospital_prefix: false,
    use_invoice_prefix: false,
    include_year: true,
    include_slug: true,
    separator: '-',
    seq_padding: 4,
  },
  ipd_service: {
    kind: 'IPDSRV',
    prefix: '',
    use_hospital_prefix: false,
    use_invoice_prefix: false,
    include_year: true,
    include_slug: true,
    separator: '-',
    seq_padding: 4,
  },
  ipd_refund: {
    kind: 'IPDREF',
    prefix: '',
    use_hospital_prefix: false,
    use_invoice_prefix: false,
    include_year: true,
    include_slug: true,
    separator: '-',
    seq_padding: 4,
  },
  ipd_room: {
    kind: 'IPDROOM',
    prefix: '',
    use_hospital_prefix: false,
    use_invoice_prefix: false,
    include_year: true,
    include_slug: true,
    separator: '-',
    seq_padding: 4,
  },
  ipd_final_bill: {
    kind: 'IPDFIN',
    prefix: 'IPD',
    use_hospital_prefix: true,
    use_invoice_prefix: false,
    include_year: true,
    include_slug: false,
    separator: '-',
    seq_padding: 0,
  },
}

export const DOCUMENT_NUMBER_FORMAT_ROWS = [
  { key: 'uhid', label: 'UHID', showSlug: false, showHospitalPrefixToggle: true, showInvoicePrefixToggle: false, hasOwnSequence: true },
  { key: 'opd', label: 'OPD Number', showSlug: false, showHospitalPrefixToggle: true, showInvoicePrefixToggle: false, hasOwnSequence: true },
  { key: 'ipd', label: 'IPD Number', showSlug: false, showHospitalPrefixToggle: true, showInvoicePrefixToggle: false, hasOwnSequence: true },
  { key: 'payment_slip', label: 'Payment Slip', showSlug: false, showHospitalPrefixToggle: true, showInvoicePrefixToggle: false, hasOwnSequence: true },
  { key: 'receipt', label: 'Receipt / Invoice', showSlug: false, showHospitalPrefixToggle: false, showInvoicePrefixToggle: true, hasOwnSequence: false },
  { key: 'ipd_advance', label: 'IPD Advance Slip', showSlug: true, showHospitalPrefixToggle: false, showInvoicePrefixToggle: false, hasOwnSequence: false },
  { key: 'ipd_service', label: 'IPD Service Charge', showSlug: true, showHospitalPrefixToggle: false, showInvoicePrefixToggle: false, hasOwnSequence: false },
  { key: 'ipd_refund', label: 'IPD Discharge Refund', showSlug: true, showHospitalPrefixToggle: false, showInvoicePrefixToggle: false, hasOwnSequence: false },
  { key: 'ipd_room', label: 'IPD Room Charge', showSlug: true, showHospitalPrefixToggle: false, showInvoicePrefixToggle: false, hasOwnSequence: false },
  { key: 'ipd_final_bill', label: 'IPD Final Bill', showSlug: false, showHospitalPrefixToggle: true, showInvoicePrefixToggle: false, hasOwnSequence: true },
]

export const OWN_SEQUENCE_DOC_TYPES = DOCUMENT_NUMBER_FORMAT_ROWS
  .filter((row) => row.hasOwnSequence)
  .map((row) => row.key)

export const DEFAULT_DOCUMENT_NEXT_NUMBERS = Object.fromEntries(
  OWN_SEQUENCE_DOC_TYPES.map((key) => [key, 1]),
)

export function normalizeDocumentNextNumbers(raw) {
  const source = raw && typeof raw === 'object' ? raw : {}
  const merged = {}
  for (const key of OWN_SEQUENCE_DOC_TYPES) {
    const num = Number(source[key])
    merged[key] = Number.isFinite(num) && num > 0 ? Math.floor(num) : 1
  }
  return merged
}

const PREVIEW_SAMPLE = {
  uhidPrefix: 'VAR',
  invoicePrefix: 'INV',
  slug: 'VARD',
  year: 2026,
  seq: 42,
}

function coerceBool(value, fallback = false) {
  if (typeof value === 'boolean') return value
  if (value === 'true' || value === '1' || value === 1) return true
  if (value === 'false' || value === '0' || value === 0) return false
  return fallback
}

function coercePadding(value, fallback = 0) {
  const num = parseInt(value, 10)
  if (Number.isNaN(num) || num < 0) return fallback
  return Math.min(num, 8)
}

/** Migrate legacy { template, kind } rows to parts-based config. */
function templateToParts(template, legacyKind = '') {
  const cleaned = String(template || '').trim()
  const parts = {
    kind: String(legacyKind || '').trim().toUpperCase(),
    prefix: '',
    use_hospital_prefix: false,
    use_invoice_prefix: false,
    include_year: false,
    include_slug: false,
    separator: '-',
    seq_padding: 0,
  }
  if (!cleaned) return parts

  if (cleaned.includes('{PREFIX}') && cleaned.includes('{YEAR}') && !cleaned.includes('{KIND}') && cleaned.includes('{SEQ:06d}')) {
    parts.use_invoice_prefix = true
    parts.include_year = cleaned.includes('{YEAR}')
    parts.separator = cleaned.includes('-{YEAR}') || cleaned.includes('-{SEQ') ? '-' : ''
    parts.seq_padding = cleaned.includes('{SEQ:06d}') ? 6 : 0
    return parts
  }

  parts.use_hospital_prefix = cleaned.includes('{PREFIX}')
  parts.include_year = cleaned.includes('{YEAR}')
  parts.include_slug = cleaned.includes('{SLUG}')
  if (cleaned.includes('{SEQ:04d}')) parts.seq_padding = 4
  else if (cleaned.includes('{SEQ:06d}')) parts.seq_padding = 6

  const sepMatch = cleaned.match(/\}-(\{)/)
  parts.separator = sepMatch ? '-' : (cleaned.includes('-') ? '-' : '')

  if (!parts.kind && cleaned.includes('{KIND}')) {
    parts.kind = String(legacyKind || '').trim().toUpperCase()
  }

  return parts
}

export function normalizeDocumentNumberFormats(raw) {
  const source = raw && typeof raw === 'object' ? raw : {}
  const merged = {}
  for (const [docType, defaults] of Object.entries(DEFAULT_DOCUMENT_NUMBER_PARTS)) {
    const row = source[docType] && typeof source[docType] === 'object' ? source[docType] : {}
    let parts
    if (row.template) {
      parts = templateToParts(row.template, row.kind || defaults.kind)
    } else {
      parts = {
        kind: String(row.kind ?? defaults.kind ?? '').trim().toUpperCase(),
        prefix: String(row.prefix ?? defaults.prefix ?? '').trim().toUpperCase(),
        use_hospital_prefix: coerceBool(row.use_hospital_prefix, defaults.use_hospital_prefix),
        use_invoice_prefix: coerceBool(row.use_invoice_prefix, defaults.use_invoice_prefix),
        include_year: coerceBool(row.include_year, defaults.include_year),
        include_slug: coerceBool(row.include_slug, defaults.include_slug),
        separator: row.separator != null ? String(row.separator) : defaults.separator,
        seq_padding: coercePadding(row.seq_padding, defaults.seq_padding),
      }
    }
    merged[docType] = parts
  }
  return merged
}

export function formatSequence(seq, padding) {
  const value = parseInt(seq, 10) || 0
  const pad = coercePadding(padding, 0)
  if (pad > 0) return String(value).padStart(pad, '0')
  return String(value)
}

export function buildDocumentNumberFromParts(docType, parts, {
  uhidPrefix = PREVIEW_SAMPLE.uhidPrefix,
  invoicePrefix = PREVIEW_SAMPLE.invoicePrefix,
  slug = PREVIEW_SAMPLE.slug,
  year = PREVIEW_SAMPLE.year,
  seq = PREVIEW_SAMPLE.seq,
} = {}) {
  const config = parts || {}
  const segments = []

  const kind = String(config.kind || '').trim().toUpperCase()
  if (kind) segments.push(kind)

  const customPrefix = String(config.prefix || '').trim().toUpperCase()
  if (customPrefix) segments.push(customPrefix)

  if (config.use_hospital_prefix && uhidPrefix) {
    segments.push(String(uhidPrefix).trim().toUpperCase())
  }
  if (config.use_invoice_prefix && invoicePrefix) {
    segments.push(String(invoicePrefix).trim().toUpperCase())
  }
  if (config.include_slug && slug) {
    segments.push(String(slug).trim().toUpperCase())
  }
  if (config.include_year) {
    segments.push(String(year))
  }

  segments.push(formatSequence(seq, config.seq_padding))

  const separator = config.separator != null ? String(config.separator) : '-'
  return separator === '' ? segments.join('') : segments.join(separator)
}

export function getDocumentNumberPreview(docType, formats, { uhidPrefix, invoicePrefix, seq } = {}) {
  const normalized = normalizeDocumentNumberFormats(formats)
  return buildDocumentNumberFromParts(docType, normalized[docType], {
    uhidPrefix: uhidPrefix || PREVIEW_SAMPLE.uhidPrefix,
    invoicePrefix: invoicePrefix || PREVIEW_SAMPLE.invoicePrefix,
    seq: seq ?? PREVIEW_SAMPLE.seq,
  })
}

export function validateDocumentNumberParts(docType, parts) {
  const preview = buildDocumentNumberFromParts(docType, parts)
  if (!preview) return 'At least one segment is required.'
  if (!formatSequence(PREVIEW_SAMPLE.seq, parts?.seq_padding)) return 'Sequence is required.'
  return ''
}

export function validateAllDocumentNumberFormats(formats) {
  const normalized = normalizeDocumentNumberFormats(formats)
  const errors = {}
  for (const row of DOCUMENT_NUMBER_FORMAT_ROWS) {
    const message = validateDocumentNumberParts(row.key, normalized[row.key])
    if (message) errors[row.key] = message
  }
  return errors
}

/** @deprecated use normalizeDocumentNumberFormats */
export const DEFAULT_DOCUMENT_NUMBER_FORMATS = DEFAULT_DOCUMENT_NUMBER_PARTS

export function validateDocumentNumberTemplate() {
  return ''
}

export function renderDocumentNumberPreview(docType, options = {}) {
  return buildDocumentNumberFromParts(docType, {
    kind: options.kind || '',
    prefix: options.prefix || '',
    use_hospital_prefix: true,
    include_year: String(options.template || '').includes('{YEAR}'),
    include_slug: String(options.template || '').includes('{SLUG}'),
    separator: '-',
    seq_padding: String(options.template || '').includes(':04d') ? 4 : 0,
  }, options)
}

export function partsToApiPayload(formats) {
  return normalizeDocumentNumberFormats(formats)
}

export function onFormatPartChange(formats, docType, field, value) {
  const normalized = normalizeDocumentNumberFormats(formats)
  const current = { ...normalized[docType] }
  if (field === 'kind' || field === 'prefix') {
    current[field] = String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, field === 'kind' ? 12 : 20)
  } else if (field === 'separator') {
    current.separator = String(value ?? '')
  } else if (field === 'seq_padding') {
    current.seq_padding = coercePadding(value, 0)
  } else if (['use_hospital_prefix', 'use_invoice_prefix', 'include_year', 'include_slug'].includes(field)) {
    current[field] = Boolean(value)
  }
  return { ...normalized, [docType]: current }
}

export function getDefaultDocumentNumberParts() {
  return normalizeDocumentNumberFormats(DEFAULT_DOCUMENT_NUMBER_PARTS)
}
