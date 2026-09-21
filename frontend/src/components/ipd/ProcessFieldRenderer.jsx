import ProcessFieldLayoutWrapper, { ProcessFieldGrid } from './ProcessFieldLayoutWrapper'
import { VITAL_FIELDS, builtinStorageKey } from '../../utils/ipdProcessFieldConfig'

const DEFAULT_INPUT_CLS = 'w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-violet-500 focus:outline-none'
const IPD_INPUT_CLS = 'w-full border border-[oklch(0.71_0.01_0)] rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-violet-500 focus:outline-none'
const IPD_GROUP_BORDER_CLS = 'border border-[oklch(0.71_0.01_0)]'

function inputClass(appearance, compact = false) {
  const base = appearance === 'ipd' ? IPD_INPUT_CLS : DEFAULT_INPUT_CLS
  return compact ? `${base} text-xs py-1.5` : base
}

function labelClass(field, appearance, compact = false) {
  const size = field?.label_size || 'md'
  if (appearance === 'ipd') {
    const sizeCls = compact
      ? 'text-xs'
      : size === 'lg'
        ? 'text-base'
        : size === 'sm'
          ? 'text-xs'
          : 'text-sm'
    return `${sizeCls} font-semibold mb-1.5 block text-[oklch(0_0_0)]`
  }
  const sizeCls = compact
    ? 'text-[10px]'
    : size === 'lg'
      ? 'text-sm'
      : size === 'sm'
        ? 'text-[10px]'
        : 'text-xs'
  return `${sizeCls} text-gray-500 mb-1 block font-semibold`
}

function groupShellClass(appearance) {
  return appearance === 'ipd'
    ? `${IPD_GROUP_BORDER_CLS} rounded-2xl overflow-hidden h-full`
    : 'border border-gray-200 rounded-2xl overflow-hidden h-full'
}

function BooleanToggle({ field, value, onChange, readOnly, appearance = 'default' }) {
  const trueLabel = field.true_label || 'Yes'
  const falseLabel = field.false_label || 'No'
  const idleBorder = appearance === 'ipd' ? 'border-[oklch(0.71_0.01_0)]' : 'border-gray-200'
  return (
    <div className="flex gap-2">
      {[true, false].map((opt) => {
        const active = value === opt
        const label = opt ? trueLabel : falseLabel
        return (
          <button
            key={String(opt)}
            type="button"
            disabled={readOnly}
            onClick={() => !readOnly && onChange?.(opt)}
            className={`flex-1 px-3 py-2 rounded-xl text-sm font-bold border transition-colors ${
              active
                ? 'bg-violet-600 text-white border-violet-600'
                : `bg-white text-gray-600 ${idleBorder} hover:border-violet-300`
            } ${readOnly ? 'opacity-70 cursor-default' : ''}`}
          >
            {label}
          </button>
        )
      })}
    </div>
  )
}

function UserBlock({ field, value, onChange, readOnly, appearance = 'default' }) {
  const v = value && typeof value === 'object' ? value : { name: '', phone: '', email: '' }
  const parts = [
    field.show_name !== false && { key: 'name', label: 'Name', type: 'text' },
    field.show_phone !== false && { key: 'phone', label: 'Phone', type: 'tel' },
    field.show_email !== false && { key: 'email', label: 'Email', type: 'email' },
  ].filter(Boolean)
  const fieldCls = inputClass(appearance)

  return (
    <div className="space-y-2">
      {parts.map(({ key, label, type }) => (
        <div key={key}>
          <label className={labelClass(appearance)}>{label}</label>
          <input
            type={type}
            value={v[key] || ''}
            readOnly={readOnly}
            disabled={readOnly}
            onChange={(e) => onChange?.({ ...v, [key]: e.target.value })}
            className={fieldCls}
          />
        </div>
      ))}
    </div>
  )
}

function ChoicesField({ field, value, onChange, readOnly }) {
  const options = field.options || []
  const multi = field.choice_mode === 'multi'
  if (multi) {
    const selected = Array.isArray(value) ? value : []
    return (
      <div className="space-y-1.5">
        {options.map((opt) => (
          <label key={opt} className="flex items-center gap-2 text-sm text-gray-700">
            <input
              type="checkbox"
              checked={selected.includes(opt)}
              disabled={readOnly}
              onChange={(e) => {
                if (readOnly) return
                const next = e.target.checked
                  ? [...selected, opt]
                  : selected.filter((x) => x !== opt)
                onChange?.(next)
              }}
              className="rounded border-gray-300 text-violet-600 focus:ring-violet-500"
            />
            {opt}
          </label>
        ))}
      </div>
    )
  }
  return (
    <div className="space-y-1.5">
      {options.map((opt) => (
        <label key={opt} className="flex items-center gap-2 text-sm text-gray-700">
          <input
            type="radio"
            name={`choices_${field.id}`}
            checked={value === opt}
            disabled={readOnly}
            onChange={() => !readOnly && onChange?.(opt)}
            className="border-gray-300 text-violet-600 focus:ring-violet-500"
          />
          {opt}
        </label>
      ))}
    </div>
  )
}

function FieldBody({ field, value, onChange, readOnly, previewMode, fieldCls, labelCls, appearance = 'default' }) {
  const t = field.type
  const minH = field.layout?.min_height_px

  if (t === 'builtin_vitals') {
    const vitals = value && typeof value === 'object' ? value : {}
    return (
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        {VITAL_FIELDS.map(([key, label]) => (
          <div key={key}>
            <label className={labelCls}>{label}</label>
            <input
              value={vitals[key] || ''}
              readOnly={readOnly}
              disabled={readOnly}
              onChange={(e) => onChange?.({ ...vitals, [key]: e.target.value })}
              className={fieldCls}
              placeholder={label}
            />
          </div>
        ))}
      </div>
    )
  }

  if (t === 'builtin_text' || (t === 'text' && field.multiline)) {
    return (
      <textarea
        rows={Math.max(3, Math.round((minH || 96) / 24))}
        value={value || ''}
        readOnly={readOnly}
        disabled={readOnly}
        onChange={(e) => onChange?.(e.target.value)}
        className={`${fieldCls} resize-none`}
        placeholder={field.placeholder || field.label}
        style={{ minHeight: minH ? `${minH}px` : undefined }}
      />
    )
  }

  if (t === 'text') {
    return (
      <input
        value={value || ''}
        readOnly={readOnly}
        disabled={readOnly}
        onChange={(e) => onChange?.(e.target.value)}
        className={fieldCls}
        placeholder={field.placeholder || field.label}
      />
    )
  }

  if (t === 'number') {
    return (
      <input
        type="number"
        step={field.number_mode === 'decimal' ? '0.01' : '1'}
        min={field.min}
        max={field.max}
        value={value ?? ''}
        readOnly={readOnly}
        disabled={readOnly}
        onChange={(e) => {
          const raw = e.target.value
          if (raw === '') {
            onChange?.(null)
            return
          }
          const num = field.number_mode === 'decimal' ? parseFloat(raw) : parseInt(raw, 10)
          onChange?.(Number.isFinite(num) ? num : null)
        }}
        className={fieldCls}
      />
    )
  }

  if (t === 'boolean') {
    return <BooleanToggle field={field} value={value} onChange={onChange} readOnly={readOnly} appearance={appearance} />
  }

  if (t === 'datetime') {
    const mode = field.datetime_mode || 'date'
    const inputType = mode === 'time' ? 'time' : mode === 'datetime' ? 'datetime-local' : 'date'
    return (
      <input
        type={inputType}
        value={value || ''}
        readOnly={readOnly}
        disabled={readOnly}
        onChange={(e) => onChange?.(e.target.value)}
        className={fieldCls}
      />
    )
  }

  if (t === 'user') {
    return <UserBlock field={field} value={value} onChange={onChange} readOnly={readOnly} appearance={appearance} />
  }

  if (t === 'choices') {
    return <ChoicesField field={field} value={value} onChange={onChange} readOnly={readOnly} />
  }

  if (previewMode) {
    return <p className="text-xs text-gray-400 italic">Preview placeholder</p>
  }
  return null
}

function GroupShell({ field, children, defaultOpen = true, appearance = 'default' }) {
  const summaryLabelCls = labelClass(field, appearance)
  return (
    <details open={defaultOpen} className={groupShellClass(appearance)}>
      <summary className={`cursor-pointer px-4 py-3 bg-gray-50 font-black text-[oklch(0_0_0)] ${summaryLabelCls.replace('mb-1.5 block', '')}`}>
        {field.label}
      </summary>
      <div className="p-4">{children}</div>
    </details>
  )
}

export default function ProcessFieldRenderer({
  field,
  value,
  onChange,
  readOnly = false,
  previewMode = false,
  layoutMode = 'form',
  selected = false,
  onLayoutChange,
  onFieldSelect,
  builderSelectable = false,
  parentId = null,
  renderChildren,
  compact = false,
  appearance = 'default',
}) {
  if (!field?.enabled && !previewMode) return null

  const fieldCls = inputClass(appearance, compact)
  const labelCls = labelClass(field, appearance, compact)

  const handleFieldClick = builderSelectable && onFieldSelect
    ? () => onFieldSelect(field.id, parentId)
    : undefined

  const layoutProps = {
    field,
    resizeMode: layoutMode,
    selected,
    onLayoutChange,
    builderSelectable,
    onFieldClick: handleFieldClick,
    stopSelectionPropagation: parentId != null,
  }

  if (field.type === 'group') {
    const inner = renderChildren ? renderChildren(field) : null
    const body = (
      <GroupShell field={field} appearance={appearance}>
        {inner || (
          <ProcessFieldGrid>
            {(field.children || []).map((child) => (
              <ProcessFieldRenderer
                key={child.id}
                field={child}
                value={null}
                readOnly={readOnly}
                previewMode={previewMode}
                layoutMode={layoutMode}
                appearance={appearance}
                builderSelectable={builderSelectable}
                onFieldSelect={onFieldSelect}
                parentId={field.id}
                selected={false}
              />
            ))}
          </ProcessFieldGrid>
        )}
      </GroupShell>
    )
    return (
      <ProcessFieldLayoutWrapper {...layoutProps}>
        {body}
      </ProcessFieldLayoutWrapper>
    )
  }

  const label = (
    <label className={labelCls}>
      {field.label}
    </label>
  )

  const body = (
    <div className="h-full flex flex-col">
      {!compact && field.type !== 'builtin_vitals' ? label : null}
      {field.type === 'builtin_vitals' ? (
        <details open className={groupShellClass(appearance)}>
          <summary className={`cursor-pointer px-4 py-3 bg-gray-50 font-black text-[oklch(0_0_0)] ${labelCls.replace('mb-1.5 block', '')}`}>
            {field.label}
          </summary>
          <div className="p-4">
            <FieldBody
              field={field}
              value={value}
              onChange={onChange}
              readOnly={readOnly}
              previewMode={previewMode}
              fieldCls={fieldCls}
              labelCls={labelCls}
              appearance={appearance}
            />
          </div>
        </details>
      ) : (
        <FieldBody
          field={field}
          value={value}
          onChange={onChange}
          readOnly={readOnly}
          previewMode={previewMode}
          fieldCls={fieldCls}
          labelCls={labelCls}
          appearance={appearance}
        />
      )}
    </div>
  )

  return (
    <ProcessFieldLayoutWrapper {...layoutProps}>
      {body}
    </ProcessFieldLayoutWrapper>
  )
}

export function ProcessFormFields({
  config,
  form,
  onFieldChange,
  readOnly = false,
  previewMode = false,
  layoutMode = 'form',
  selectedFieldId = null,
  onLayoutChange,
  onFieldSelect,
  builderSelectable = false,
  appearance = 'default',
}) {
  const fields = (config?.fields || []).filter((f) => f.enabled !== false)

  function resolveValue(field) {
    if (field.type === 'builtin_vitals') return form.vitals
    if (field.type === 'builtin_text') {
      const key = builtinStorageKey(field)
      return key ? form[key] ?? '' : ''
    }
    return (form.custom_fields || {})[field.id]
  }

  function renderField(field, parentId = null) {
    const isSelected = selectedFieldId === field.id
    return (
      <ProcessFieldRenderer
        key={field.id}
        field={field}
        value={resolveValue(field)}
        onChange={onFieldChange ? (val) => onFieldChange(field, val) : undefined}
        readOnly={readOnly}
        previewMode={previewMode}
        layoutMode={layoutMode}
        appearance={appearance}
        builderSelectable={builderSelectable}
        onFieldSelect={onFieldSelect}
        parentId={parentId}
        selected={isSelected}
        onLayoutChange={
          onLayoutChange && isSelected
            ? (layout) => onLayoutChange(field.id, layout, parentId)
            : undefined
        }
        renderChildren={
          field.type === 'group'
            ? () => (
                <ProcessFieldGrid>
                  {(field.children || [])
                    .filter((c) => c.enabled !== false)
                    .map((child) => renderField(child, field.id))}
                </ProcessFieldGrid>
              )
            : undefined
        }
      />
    )
  }

  return (
    <ProcessFieldGrid>
      {fields.map((field) => renderField(field, null))}
    </ProcessFieldGrid>
  )
}
