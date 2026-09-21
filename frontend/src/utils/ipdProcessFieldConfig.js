/** IPD Process form builder field definitions (mirrored on backend). */

export const BUILTIN_FIELD_IDS = new Set(['vitals', 'medications', 'completed', 'pending', 'notes'])

export const BUILTIN_STORAGE_BY_ID = {
  medications: 'medication_procedure_notes',
  completed: 'completed_notes',
  pending: 'pending_notes',
  notes: 'general_notes',
}

export const CUSTOM_FIELD_TYPES = new Set([
  'group',
  'text',
  'number',
  'boolean',
  'datetime',
  'user',
  'choices',
])

export const BUILTIN_FIELD_TYPES = new Set(['builtin_vitals', 'builtin_text'])

export const ALL_FIELD_TYPES = new Set([...CUSTOM_FIELD_TYPES, ...BUILTIN_FIELD_TYPES])

export const COL_SPAN_OPTIONS = [3, 4, 6, 8, 12]

export const MAX_CUSTOM_FIELDS = 30
export const MAX_NESTING_DEPTH = 2
export const MIN_HEIGHT_PX = 32
export const MAX_HEIGHT_PX = 400
export const MAX_TEMPLATES = 20
export const DEFAULT_TEMPLATE_ID = 'default'

export const VITAL_FIELDS = [
  ['bp', 'BP'],
  ['pulse', 'Pulse'],
  ['spo2', 'SpO2'],
  ['temp', 'Temp'],
  ['weight', 'Weight'],
  ['rbs', 'RBS'],
]

export const FIELD_TYPE_OPTIONS = [
  { value: 'text', label: 'Text' },
  { value: 'number', label: 'Number' },
  { value: 'boolean', label: 'Yes / No' },
  { value: 'datetime', label: 'Date / Time' },
  { value: 'user', label: 'Contact (name / phone / email)' },
  { value: 'choices', label: 'Choices' },
  { value: 'group', label: 'Group (nested fields)' },
]

export const LABEL_SIZE_OPTIONS = ['sm', 'md', 'lg']

function defaultLayout(fieldType, { multiline = false } = {}) {
  if (fieldType === 'builtin_vitals') return { col_span: 12, min_height_px: 120 }
  if (fieldType === 'builtin_text' || fieldType === 'group') {
    return { col_span: 12, min_height_px: multiline || fieldType === 'group' ? 120 : 96 }
  }
  if (fieldType === 'text') return { col_span: 12, min_height_px: multiline ? 96 : 40 }
  if (fieldType === 'choices') return { col_span: 12, min_height_px: 80 }
  if (fieldType === 'user') return { col_span: 12, min_height_px: 100 }
  return { col_span: 12, min_height_px: 40 }
}

export function defaultIpdProcessFieldConfig() {
  return {
    version: 1,
    fields: [
      {
        id: 'vitals',
        builtin: true,
        enabled: true,
        label: 'Vitals',
        type: 'builtin_vitals',
        order: 0,
        layout: defaultLayout('builtin_vitals'),
      },
      {
        id: 'medications',
        builtin: true,
        enabled: true,
        label: 'Medications / Procedures',
        type: 'builtin_text',
        storage: 'medication_procedure_notes',
        multiline: true,
        order: 1,
        layout: defaultLayout('builtin_text', { multiline: true }),
      },
      {
        id: 'completed',
        builtin: true,
        enabled: true,
        label: 'Done Today',
        type: 'builtin_text',
        storage: 'completed_notes',
        multiline: true,
        order: 2,
        layout: defaultLayout('builtin_text', { multiline: true }),
      },
      {
        id: 'pending',
        builtin: true,
        enabled: true,
        label: 'Pending / Left To Do',
        type: 'builtin_text',
        storage: 'pending_notes',
        multiline: true,
        order: 3,
        layout: defaultLayout('builtin_text', { multiline: true }),
      },
      {
        id: 'notes',
        builtin: true,
        enabled: true,
        label: 'Notes',
        type: 'builtin_text',
        storage: 'general_notes',
        multiline: true,
        order: 4,
        layout: defaultLayout('builtin_text', { multiline: true }),
      },
    ],
  }
}

function slugifyId(label) {
  const slug = String(label || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40)
  return slug || 'field'
}

export function makeCustomFieldId(label, existingIds = new Set()) {
  let base = `custom_${slugifyId(label)}`
  let id = base
  let n = 2
  while (existingIds.has(id) || BUILTIN_FIELD_IDS.has(id)) {
    id = `${base}_${n}`
    n += 1
  }
  return id
}

function normalizeLayout(raw, fieldType, multiline = false) {
  const base = defaultLayout(fieldType, { multiline })
  if (!raw || typeof raw !== 'object') return base
  let col = Number(raw.col_span)
  if (!COL_SPAN_OPTIONS.includes(col)) col = base.col_span
  let h = Number(raw.min_height_px)
  if (!Number.isFinite(h)) h = base.min_height_px
  h = Math.max(MIN_HEIGHT_PX, Math.min(MAX_HEIGHT_PX, h))
  return { col_span: col, min_height_px: h }
}

function normalizeField(raw, depth = 0) {
  if (!raw || typeof raw !== 'object') return null
  const fieldId = String(raw.id || '').trim()
  if (!fieldId) return null
  const fieldType = String(raw.type || '').trim()
  if (!ALL_FIELD_TYPES.has(fieldType)) return null
  const isBuiltin = BUILTIN_FIELD_IDS.has(fieldId)
  if (isBuiltin && !BUILTIN_FIELD_TYPES.has(fieldType)) return null
  if (!isBuiltin && BUILTIN_FIELD_TYPES.has(fieldType)) return null

  const storage = isBuiltin && fieldType === 'builtin_text'
    ? (BUILTIN_STORAGE_BY_ID[fieldId] || raw.storage)
    : (raw.storage ? String(raw.storage).trim() : null)

  const label = String(raw.label || fieldId).trim().slice(0, 120) || fieldId
  const multiline = Boolean(raw.multiline ?? (fieldType === 'builtin_text' || fieldType === 'text'))

  const out = {
    id: fieldId,
    builtin: isBuiltin,
    enabled: raw.enabled !== false,
    label,
    label_size: LABEL_SIZE_OPTIONS.includes(raw.label_size) ? raw.label_size : 'md',
    type: fieldType,
    order: Number.isFinite(Number(raw.order)) ? Number(raw.order) : 0,
    layout: normalizeLayout(raw.layout, fieldType, multiline),
  }
  if (storage) out.storage = storage
  if (multiline) out.multiline = true
  if (fieldType === 'text') out.placeholder = String(raw.placeholder || '').trim().slice(0, 200)
  if (fieldType === 'number') {
    out.number_mode = raw.number_mode === 'decimal' ? 'decimal' : 'integer'
    if (raw.min != null && raw.min !== '') out.min = Number(raw.min)
    if (raw.max != null && raw.max !== '') out.max = Number(raw.max)
  }
  if (fieldType === 'boolean') {
    out.true_label = String(raw.true_label || 'Yes').trim().slice(0, 40) || 'Yes'
    out.false_label = String(raw.false_label || 'No').trim().slice(0, 40) || 'No'
  }
  if (fieldType === 'datetime') {
    const mode = String(raw.datetime_mode || 'date')
    out.datetime_mode = ['date', 'time', 'datetime'].includes(mode) ? mode : 'date'
  }
  if (fieldType === 'user') {
    out.show_name = raw.show_name !== false
    out.show_phone = raw.show_phone !== false
    out.show_email = raw.show_email !== false
  }
  if (fieldType === 'choices') {
    out.choice_mode = raw.choice_mode === 'multi' ? 'multi' : 'single'
    const opts = Array.isArray(raw.options) ? raw.options : []
    out.options = opts.map((o) => String(o).trim().slice(0, 80)).filter(Boolean).slice(0, 20)
  }
  if (fieldType === 'group' && depth < MAX_NESTING_DEPTH) {
    const childrenRaw = Array.isArray(raw.children) ? raw.children : []
    out.children = childrenRaw
      .map((child, idx) => {
        const normalized = normalizeField(child, depth + 1)
        if (!normalized) return null
        return { ...normalized, order: idx }
      })
      .filter(Boolean)
  } else if (fieldType === 'group') {
    out.children = []
  }
  return out
}

/** Settings editor: preserve user order; do not re-insert deleted default fields. */
export function normalizeIpdProcessFieldConfigEditor(value) {
  if (!value || typeof value !== 'object') return defaultIpdProcessFieldConfig()
  const fieldsRaw = value.fields
  if (!Array.isArray(fieldsRaw) || fieldsRaw.length === 0) return defaultIpdProcessFieldConfig()
  const seen = new Set()
  const fields = []
  for (const raw of fieldsRaw) {
    const normalized = normalizeField(raw, 0)
    if (!normalized || seen.has(normalized.id)) continue
    if (!normalized.builtin && BUILTIN_FIELD_IDS.has(normalized.id)) continue
    seen.add(normalized.id)
    fields.push(normalized)
  }
  return { version: 1, fields: fields.map((f, idx) => ({ ...f, order: idx })) }
}

/** Runtime (process form / timeline): use defaults only when config is empty. */
export function normalizeIpdProcessFieldConfig(value) {
  if (!value || typeof value !== 'object') return defaultIpdProcessFieldConfig()
  const fieldsRaw = value.fields
  if (!Array.isArray(fieldsRaw) || fieldsRaw.length === 0) return defaultIpdProcessFieldConfig()
  return normalizeIpdProcessFieldConfigEditor(value)
}

/** Final validation pass before API save. */
export function finalizeIpdProcessFieldConfig(value) {
  const editor = normalizeIpdProcessFieldConfigEditor(value)
  if (countCustomFields(editor) > MAX_CUSTOM_FIELDS) {
    return editor
  }
  return editor
}

export function normalizeProcessField(raw, depth = 0) {
  return normalizeField(raw, depth)
}

export const BUILDER_DRAFT_FIELD_ID = '__draft__'

export function configsEqual(a, b) {
  try {
    return JSON.stringify(finalizeIpdProcessFieldConfig(a))
      === JSON.stringify(finalizeIpdProcessFieldConfig(b))
  } catch {
    return false
  }
}

export function defaultIpdProcessTemplates() {
  return {
    version: 2,
    default_template_id: DEFAULT_TEMPLATE_ID,
    templates: [
      {
        id: DEFAULT_TEMPLATE_ID,
        name: 'Standard',
        config: defaultIpdProcessFieldConfig(),
      },
    ],
  }
}

function isV2Templates(value) {
  return value?.version === 2 && Array.isArray(value?.templates)
}

export function normalizeIpdProcessTemplates(value) {
  if (!value || typeof value !== 'object') return defaultIpdProcessTemplates()
  if (isV2Templates(value)) {
    const seen = new Set()
    const templates = []
    for (const raw of value.templates) {
      if (!raw || typeof raw !== 'object') continue
      const id = String(raw.id || '').trim().slice(0, 64)
      if (!id || seen.has(id)) continue
      const name = String(raw.name || id).trim().slice(0, 80) || id
      templates.push({
        id,
        name,
        config: normalizeIpdProcessFieldConfigEditor(raw.config),
      })
      seen.add(id)
    }
    if (!templates.length) return defaultIpdProcessTemplates()
    let defaultId = String(value.default_template_id || DEFAULT_TEMPLATE_ID).trim()
    if (!seen.has(defaultId)) defaultId = templates[0].id
    return {
      version: 2,
      default_template_id: defaultId,
      templates: templates.slice(0, MAX_TEMPLATES),
    }
  }
  if (Array.isArray(value.fields) && value.fields.length > 0) {
    return {
      version: 2,
      default_template_id: DEFAULT_TEMPLATE_ID,
      templates: [
        {
          id: DEFAULT_TEMPLATE_ID,
          name: 'Standard',
          config: normalizeIpdProcessFieldConfigEditor(value),
        },
      ],
    }
  }
  return defaultIpdProcessTemplates()
}

export function finalizeIpdProcessTemplates(value) {
  const root = normalizeIpdProcessTemplates(value)
  return {
    version: 2,
    default_template_id: root.default_template_id,
    templates: root.templates.map((tpl) => ({
      ...tpl,
      config: finalizeIpdProcessFieldConfig(tpl.config),
    })),
  }
}

export function templatesEqual(a, b) {
  try {
    return JSON.stringify(finalizeIpdProcessTemplates(a))
      === JSON.stringify(finalizeIpdProcessTemplates(b))
  } catch {
    return false
  }
}

export function makeTemplateId() {
  return `tpl_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36).slice(-4)}`
}

export function getDefaultTemplateId(templatesRoot) {
  return normalizeIpdProcessTemplates(templatesRoot).default_template_id || DEFAULT_TEMPLATE_ID
}

export function getTemplateById(templatesRoot, templateId) {
  const root = normalizeIpdProcessTemplates(templatesRoot)
  const id = String(templateId || '').trim()
  const found = root.templates.find((t) => t.id === id)
  if (found) return found
  const defaultId = getDefaultTemplateId(root)
  return root.templates.find((t) => t.id === defaultId) || root.templates[0] || null
}

export function getDefaultTemplate(templatesRoot) {
  return getTemplateById(templatesRoot, getDefaultTemplateId(templatesRoot))
}

export function getTemplateConfig(templatesRoot, templateId) {
  const tpl = getTemplateById(templatesRoot, templateId)
  return tpl?.config ? normalizeIpdProcessFieldConfig(tpl.config) : defaultIpdProcessFieldConfig()
}

export function resolveLogProcessConfig(log, templatesRoot) {
  const snapshot = log?.process_field_config
  if (snapshot?.fields?.length) {
    return normalizeIpdProcessFieldConfig(snapshot)
  }
  return getTemplateConfig(templatesRoot, log?.process_template_id)
}

export function overlayPanelFieldOnConfig(config, panelField, panelParentId, panelMode) {
  if (!panelField || !panelMode) return config
  const depth = panelParentId ? 1 : 0
  const normalized = normalizeProcessField(
    {
      ...panelField,
      id: panelMode === 'add' ? BUILDER_DRAFT_FIELD_ID : (panelField.id || BUILDER_DRAFT_FIELD_ID),
      enabled: true,
    },
    depth,
  )
  if (!normalized) return config

  const fields = [...(config?.fields || [])]
  if (panelMode === 'add') {
    if (panelParentId) {
      return {
        ...config,
        fields: fields.map((f) => {
          if (f.id !== panelParentId) return f
          return { ...f, children: [...(f.children || []), normalized] }
        }),
      }
    }
    return { ...config, fields: [...fields, normalized] }
  }

  if (panelMode === 'edit' && panelField.id) {
    if (panelParentId) {
      return {
        ...config,
        fields: fields.map((f) => {
          if (f.id !== panelParentId) return f
          return {
            ...f,
            children: (f.children || []).map((c) => (c.id === panelField.id ? normalized : c)),
          }
        }),
      }
    }
    return {
      ...config,
      fields: fields.map((f) => (f.id === panelField.id ? normalized : f)),
    }
  }
  return config
}

export function walkProcessFields(config) {
  const fields = config?.fields || []
  const out = []
  for (const field of fields) {
    out.push({ field, parent: null })
    if (field.type === 'group') {
      for (const child of field.children || []) {
        out.push({ field: child, parent: field })
      }
    }
  }
  return out
}

export function collectFieldIds(config) {
  return new Set(walkProcessFields(config).map(({ field }) => field.id))
}

export function builtinStorageKey(field) {
  if (field?.type !== 'builtin_text') return null
  return field.storage || BUILTIN_STORAGE_BY_ID[field.id] || null
}

export function isCustomField(field) {
  return !field?.builtin && !BUILTIN_FIELD_TYPES.has(field?.type)
}

export function emptyVitals() {
  return Object.fromEntries(VITAL_FIELDS.map(([k]) => [k, '']))
}

export function emptyCustomValue(field) {
  const t = field?.type
  if (t === 'number') return null
  if (t === 'boolean') return null
  if (t === 'user') return { name: '', phone: '', email: '' }
  if (t === 'choices') return field.choice_mode === 'multi' ? [] : ''
  if (t === 'datetime') return ''
  return ''
}

export function emptyProcessForm(logDate) {
  return {
    log_date: logDate,
    vitals: emptyVitals(),
    medication_procedure_notes: '',
    completed_notes: '',
    pending_notes: '',
    general_notes: '',
    custom_fields: {},
  }
}

export function hydrateProcessFormFromLog(log, logDate) {
  const date = logDate || (log?.log_date ? String(log.log_date).slice(0, 10) : '')
  return {
    log_date: date,
    vitals: { ...emptyVitals(), ...(log?.vitals || {}) },
    medication_procedure_notes: log?.medication_procedure_notes || '',
    completed_notes: log?.completed_notes || '',
    pending_notes: log?.pending_notes || '',
    general_notes: log?.general_notes || '',
    custom_fields: { ...(log?.custom_fields || {}) },
  }
}

export function buildProcessSavePayload(form, config, processTemplateId = null) {
  const normalized = normalizeIpdProcessFieldConfig(config)
  const payload = {
    log_date: form.log_date,
    vitals: form.vitals,
    custom_fields: { ...(form.custom_fields || {}) },
  }
  if (processTemplateId) payload.process_template_id = processTemplateId
  for (const { field } of walkProcessFields(normalized)) {
    if (!field.enabled) continue
    if (field.type === 'builtin_text') {
      const key = builtinStorageKey(field)
      if (key) payload[key] = form[key] ?? ''
    }
  }
  return payload
}

export function snapColSpanFromWidthPx(containerWidth, fieldWidthPx) {
  if (!containerWidth || !fieldWidthPx) return 12
  const ratio = fieldWidthPx / containerWidth
  const spans = COL_SPAN_OPTIONS
  let best = 12
  let bestDiff = Infinity
  for (const span of spans) {
    const diff = Math.abs(ratio - span / 12)
    if (diff < bestDiff) {
      bestDiff = diff
      best = span
    }
  }
  return best
}

export function colSpanClass(colSpan) {
  const map = {
    3: 'col-span-12 sm:col-span-3',
    4: 'col-span-12 sm:col-span-4',
    6: 'col-span-12 sm:col-span-6',
    8: 'col-span-12 sm:col-span-8',
    12: 'col-span-12',
  }
  return map[colSpan] || map[12]
}

export function formatProcessFieldValue(field, value) {
  if (value == null || value === '' || (Array.isArray(value) && value.length === 0)) return ''
  const label = field?.label || field?.id || ''
  const t = field?.type
  if (t === 'builtin_vitals' && typeof value === 'object') {
    const bits = VITAL_FIELDS
      .map(([k, lbl]) => (String(value[k] || '').trim() ? `${lbl}: ${value[k]}` : ''))
      .filter(Boolean)
    return bits.length ? `${label} — ${bits.join(', ')}` : ''
  }
  if (t === 'builtin_text') {
    const text = String(value || '').trim()
    return text ? `${label} — ${text}` : ''
  }
  if (t === 'boolean') {
    if (value === true) return `${label}: ${field.true_label || 'Yes'}`
    if (value === false) return `${label}: ${field.false_label || 'No'}`
    return ''
  }
  if (t === 'user' && typeof value === 'object') {
    const bits = [value.name, value.phone, value.email].map((v) => String(v || '').trim()).filter(Boolean)
    return bits.length ? `${label}: ${bits.join(', ')}` : ''
  }
  if (t === 'choices') {
    if (Array.isArray(value)) return value.length ? `${label}: ${value.join(', ')}` : ''
    return String(value).trim() ? `${label}: ${value}` : ''
  }
  if (t === 'group') return ''
  return `${label}: ${value}`
}

export function buildProcessLogDisplayEntries(log, config) {
  const normalized = normalizeIpdProcessFieldConfig(config)

  function lineForField(field) {
    let value
    if (field.type === 'builtin_vitals') value = log.vitals
    else if (field.type === 'builtin_text') {
      const key = builtinStorageKey(field)
      value = key ? log[key] : ''
    } else {
      value = (log.custom_fields || {})[field.id]
    }
    const text = formatProcessFieldValue(field, value)
    if (!text) return null
    if (field.type === 'builtin_vitals') {
      return { label: field.label, text, vitals: log.vitals || {} }
    }
    if (field.type === 'builtin_text' || field.type === 'text') {
      return { label: field.label, text: String(value || '').trim(), multiline: true }
    }
    return { label: field.label, text: text.replace(/^[^:]+:\s*/, ''), multiline: false }
  }

  const entries = []
  for (const field of normalized.fields) {
    if (!field.enabled) continue
    if (field.type === 'group') {
      const childEntries = (field.children || [])
        .filter((c) => c.enabled !== false)
        .map((child) => lineForField(child))
        .filter(Boolean)
      if (childEntries.length) {
        entries.push({ type: 'group', label: field.label, children: childEntries })
      }
      continue
    }
    const entry = lineForField(field)
    if (entry) entries.push({ type: 'field', ...entry })
  }
  return entries
}

export function getFieldValueFromForm(form, field) {
  if (field.type === 'builtin_vitals') return form.vitals
  if (field.type === 'builtin_text') {
    const key = builtinStorageKey(field)
    return key ? form[key] ?? '' : ''
  }
  return (form.custom_fields || {})[field.id]
}

export function setFieldValueOnForm(form, field, value) {
  if (field.type === 'builtin_vitals') {
    return { ...form, vitals: value }
  }
  if (field.type === 'builtin_text') {
    const key = builtinStorageKey(field)
    if (!key) return form
    return { ...form, [key]: value }
  }
  return {
    ...form,
    custom_fields: { ...(form.custom_fields || {}), [field.id]: value },
  }
}

export function countCustomFields(config) {
  let count = 0
  for (const { field } of walkProcessFields(config)) {
    if (isCustomField(field)) count += 1
  }
  return count
}

function processFieldHasValue(field, value) {
  if (field?.type === 'builtin_vitals' && value && typeof value === 'object') {
    return Object.values(value).some((v) => String(v || '').trim())
  }
  if (field?.type === 'user' && value && typeof value === 'object') {
    return [value.name, value.phone, value.email].some((v) => String(v || '').trim())
  }
  if (field?.type === 'choices') {
    if (Array.isArray(value)) return value.length > 0
    return String(value || '').trim() !== ''
  }
  if (field?.type === 'boolean') {
    return value === true || value === false
  }
  if (field?.type === 'number') {
    return value !== null && value !== undefined && String(value).trim() !== ''
  }
  return String(value || '').trim() !== ''
}

export function getProcessFieldValueFromLog(log, field) {
  if (field?.type === 'builtin_vitals') return log?.vitals
  if (field?.type === 'builtin_text') {
    const key = builtinStorageKey(field)
    return key ? log?.[key] : ''
  }
  return (log?.custom_fields || {})[field?.id]
}

export function getProcessCompletionMeta(log, config) {
  let total = 0
  let filled = 0

  function visit(fields) {
    for (const field of fields || []) {
      if (field?.enabled === false) continue
      if (field?.type === 'group') {
        visit(field.children || [])
        continue
      }
      total += 1
      if (processFieldHasValue(field, getProcessFieldValueFromLog(log, field))) {
        filled += 1
      }
    }
  }

  visit(config?.fields || [])

  const percent = total > 0 ? Math.round((filled / total) * 100) : 0
  return { total, filled, percent }
}
