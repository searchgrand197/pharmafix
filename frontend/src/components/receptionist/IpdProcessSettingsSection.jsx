import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useState,
} from 'react'
import { createPortal } from 'react-dom'
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import {
  SortableContext,
  arrayMove,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import {
  Activity,
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  Copy,
  Edit2,
  Plus,
  RefreshCw,
  Save,
  Star,
  Trash2,
  X,
} from 'lucide-react'
import toast from 'react-hot-toast'
import { ProcessFormFields } from '../ipd/ProcessFieldRenderer'
import {
  COL_SPAN_OPTIONS as SPANS,
  FIELD_TYPE_OPTIONS,
  LABEL_SIZE_OPTIONS,
  MAX_CUSTOM_FIELDS,
  MAX_TEMPLATES,
  BUILDER_DRAFT_FIELD_ID,
  DEFAULT_TEMPLATE_ID,
  collectFieldIds,
  countCustomFields,
  defaultIpdProcessFieldConfig,
  defaultIpdProcessTemplates,
  finalizeIpdProcessFieldConfig,
  finalizeIpdProcessTemplates,
  getDefaultTemplateId,
  makeCustomFieldId,
  makeTemplateId,
  normalizeIpdProcessFieldConfigEditor,
  normalizeIpdProcessTemplates,
  normalizeProcessField,
  overlayPanelFieldOnConfig,
  templatesEqual,
} from '../../utils/ipdProcessFieldConfig'

function cloneField(field) {
  if (!field) return null
  return JSON.parse(JSON.stringify(field))
}

function RestoreDefaultsConfirmModal({ open, onCancel, onConfirm }) {
  if (!open) return null
  return createPortal(
    <div className="fixed inset-0 z-[650] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm" onClick={onCancel} role="presentation" />
      <div className="relative z-10 bg-white rounded-2xl shadow-2xl border border-gray-100 w-full max-w-md overflow-hidden" role="dialog" aria-modal="true">
        <div className="h-1.5 bg-gradient-to-r from-violet-500 to-indigo-600" />
        <div className="px-6 pt-5 pb-6">
          <div className="flex items-start gap-4 mb-4">
            <div className="w-11 h-11 rounded-xl bg-violet-100 flex items-center justify-center shrink-0">
              <AlertTriangle size={22} className="text-violet-600" />
            </div>
            <div className="flex-1 min-w-0">
              <h3 className="text-base font-black text-gray-900 leading-tight">Restore default form?</h3>
              <p className="text-sm text-gray-500 mt-1">
                Your custom fields, layout, and reordering will be replaced with the standard IPD Process form.
              </p>
            </div>
            <button type="button" onClick={onCancel} className="shrink-0 p-1 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100">
              <X size={16} />
            </button>
          </div>
          <div className="flex gap-2.5">
            <button type="button" onClick={onCancel} className="flex-1 py-2.5 rounded-xl text-sm font-bold bg-gray-100 text-gray-700 hover:bg-gray-200">Cancel</button>
            <button type="button" onClick={onConfirm} className="flex-1 py-2.5 rounded-xl text-sm font-bold bg-violet-600 text-white hover:bg-violet-700 inline-flex items-center justify-center gap-1.5">
              <RefreshCw size={14} /> Yes, restore defaults
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  )
}

export function DiscardChangesConfirmModal({ open, saving, onCancel, onDiscard, onSave }) {
  if (!open) return null
  return createPortal(
    <div className="fixed inset-0 z-[660] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm" onClick={!saving ? onCancel : undefined} role="presentation" />
      <div className="relative z-10 bg-white rounded-2xl shadow-2xl border border-gray-100 w-full max-w-md overflow-hidden" role="dialog" aria-modal="true">
        <div className="h-1.5 bg-gradient-to-r from-violet-500 to-indigo-600" />
        <div className="px-6 pt-5 pb-6">
          <div className="flex items-start gap-4 mb-4">
            <div className="w-11 h-11 rounded-xl bg-amber-100 flex items-center justify-center shrink-0">
              <AlertTriangle size={22} className="text-amber-600" />
            </div>
            <div className="flex-1 min-w-0">
              <h3 className="text-base font-black text-gray-900 leading-tight">Unsaved changes</h3>
              <p className="text-sm text-gray-500 mt-1">
                You changed the IPD Process form but have not saved yet. Save your changes or discard them before leaving?
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2 justify-end">
            <button type="button" onClick={onCancel} disabled={saving} className="px-4 py-2 rounded-xl text-sm font-bold bg-gray-100 text-gray-700 hover:bg-gray-200 disabled:opacity-50">Stay</button>
            <button type="button" onClick={onDiscard} disabled={saving} className="px-4 py-2 rounded-xl text-sm font-bold text-rose-700 bg-rose-50 hover:bg-rose-100 disabled:opacity-50">Discard changes</button>
            <button type="button" onClick={onSave} disabled={saving} className="px-4 py-2 rounded-xl text-sm font-bold bg-violet-600 text-white hover:bg-violet-700 disabled:opacity-50 inline-flex items-center gap-1.5">
              <Save size={14} />
              {saving ? 'Saving…' : 'Save settings'}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  )
}

function TemplateNameModal({ open, mode = 'add', value, onChange, onCancel, onConfirm }) {
  if (!open) return null
  const title = mode === 'rename' ? 'Rename template' : 'Create template'
  const cta = mode === 'rename' ? 'Save name' : 'Create template'
  return createPortal(
    <div className="fixed inset-0 z-[670] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm" onClick={onCancel} role="presentation" />
      <div className="relative z-10 bg-white rounded-2xl shadow-2xl border border-gray-100 w-full max-w-md overflow-hidden" role="dialog" aria-modal="true">
        <div className="h-1.5 bg-gradient-to-r from-violet-500 to-indigo-600" />
        <div className="px-6 pt-5 pb-6">
          <div className="flex items-start gap-4 mb-4">
            <div className="w-11 h-11 rounded-xl bg-violet-100 flex items-center justify-center shrink-0">
              <Plus size={20} className="text-violet-600" />
            </div>
            <div className="flex-1 min-w-0">
              <h3 className="text-base font-black text-gray-900 leading-tight">{title}</h3>
              <p className="text-sm text-gray-500 mt-1">
                Enter a template name for the IPD process form.
              </p>
            </div>
            <button type="button" onClick={onCancel} className="shrink-0 p-1 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100">
              <X size={16} />
            </button>
          </div>
          <div className="space-y-4">
            <div>
              <label className="text-xs text-gray-500 mb-1 block">Template name</label>
              <input
                autoFocus
                value={value}
                maxLength={80}
                onChange={(e) => onChange(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') onConfirm()
                  if (e.key === 'Escape') onCancel()
                }}
                className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:ring-2 focus:ring-violet-500 focus:outline-none"
                placeholder="e.g. Post-op template"
              />
            </div>
            <div className="flex gap-2.5">
              <button type="button" onClick={onCancel} className="flex-1 py-2.5 rounded-xl text-sm font-bold bg-gray-100 text-gray-700 hover:bg-gray-200">
                Cancel
              </button>
              <button type="button" onClick={onConfirm} className="flex-1 py-2.5 rounded-xl text-sm font-bold bg-violet-600 text-white hover:bg-violet-700">
                {cta}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  )
}

function emptyDraft() {
  return {
    id: '',
    label: '',
    label_size: 'md',
    type: 'text',
    enabled: true,
    builtin: false,
    multiline: false,
    placeholder: '',
    number_mode: 'integer',
    true_label: 'Yes',
    false_label: 'No',
    datetime_mode: 'date',
    show_name: true,
    show_phone: true,
    show_email: true,
    choice_mode: 'single',
    options: ['Option 1'],
    layout: { col_span: 12, min_height_px: 40 },
    children: [],
  }
}

function updateFieldInTree(fields, fieldId, updater, parentId = null) {
  if (parentId) {
    return fields.map((f) => {
      if (f.id !== parentId) return f
      return {
        ...f,
        children: (f.children || []).map((c) => (c.id === fieldId ? updater(c) : c)),
      }
    })
  }
  return fields.map((f) => (f.id === fieldId ? updater(f) : f))
}

function removeFieldFromTree(fields, fieldId, parentId = null) {
  if (parentId) {
    return fields.map((f) => {
      if (f.id !== parentId) return f
      return { ...f, children: (f.children || []).filter((c) => c.id !== fieldId) }
    })
  }
  return fields.filter((f) => f.id !== fieldId)
}

function reorderFieldsInTree(fields, parentId, activeId, overId) {
  if (!overId || activeId === overId) return fields
  if (parentId) {
    return fields.map((f) => {
      if (f.id !== parentId) return f
      const children = [...(f.children || [])]
      const oldIndex = children.findIndex((c) => c.id === activeId)
      const newIndex = children.findIndex((c) => c.id === overId)
      if (oldIndex < 0 || newIndex < 0) return f
      return { ...f, children: arrayMove(children, oldIndex, newIndex).map((c, i) => ({ ...c, order: i })) }
    })
  }
  const oldIndex = fields.findIndex((f) => f.id === activeId)
  const newIndex = fields.findIndex((f) => f.id === overId)
  if (oldIndex < 0 || newIndex < 0) return fields
  return arrayMove(fields, oldIndex, newIndex).map((f, i) => ({ ...f, order: i }))
}

function findFieldLocation(fields, fieldId) {
  for (const f of fields) {
    if (f.id === fieldId) return { field: f, parentId: null }
    if (f.type === 'group') {
      const child = (f.children || []).find((c) => c.id === fieldId)
      if (child) return { field: child, parentId: f.id }
    }
  }
  return null
}

function SortableFieldRow({
  field,
  parentId,
  depth,
  childIndex,
  selectedId,
  expandedGroups,
  onToggleSelect,
  onEdit,
  onDelete,
  onToggleEnabled,
  onToggleExpand,
  onAddChild,
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: field.id })
  const active = selectedId === field.id
  const isGroup = field.type === 'group'
  const expanded = isGroup && expandedGroups.has(field.id)
  const childCount = (field.children || []).length
  const isGroupParent = isGroup

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    marginLeft: depth * 12,
    opacity: isDragging ? 0.85 : 1,
  }

  return (
    <div ref={setNodeRef} style={style}>
      <div
        className={`flex items-center gap-1 rounded-lg border px-2 py-1.5 mb-1 ${
          active ? 'border-violet-400 bg-violet-100' : 'border-[oklch(0.5_0_0)] bg-white'
        }`}
      >
        <button type="button" {...attributes} {...listeners} className="text-gray-400 hover:text-violet-600 cursor-grab active:cursor-grabbing shrink-0 touch-none p-0.5" title="Drag to reorder">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
            <circle cx="9" cy="6" r="1.5" /><circle cx="15" cy="6" r="1.5" />
            <circle cx="9" cy="12" r="1.5" /><circle cx="15" cy="12" r="1.5" />
            <circle cx="9" cy="18" r="1.5" /><circle cx="15" cy="18" r="1.5" />
          </svg>
        </button>
        {isGroup ? (
          <button type="button" onClick={() => onToggleExpand(field.id)} className="text-gray-400 hover:text-violet-600 shrink-0 p-0.5" title={expanded ? 'Collapse' : 'Expand'}>
            {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          </button>
        ) : (
          <span className="w-3 shrink-0" />
        )}
        <button
          type="button"
          onClick={() => onToggleSelect(field, parentId)}
          className={`flex-1 text-left text-xs truncate min-w-0 ${
            isGroupParent ? 'font-black text-gray-900' : 'font-semibold text-gray-600'
          }`}
        >
          {childIndex != null ? <span className="text-gray-400 font-semibold mr-1">{childIndex}.</span> : null}
          <span className={isGroupParent ? 'font-black text-gray-900' : 'font-semibold text-gray-600'}>
            {field.label}
          </span>
          {field.builtin ? <span className="text-[9px] text-gray-400 font-semibold ml-1">(default)</span> : null}
        </button>
        {isGroup ? (
          <>
            <span className="text-[10px] font-bold text-violet-600 bg-violet-100 px-1.5 py-0.5 rounded shrink-0">{childCount}</span>
            <button type="button" onClick={() => onAddChild(field.id)} className="text-violet-600 hover:bg-violet-100 rounded p-0.5 shrink-0" title="Add nested field">
              <Plus size={12} />
            </button>
          </>
        ) : null}
        <label className="shrink-0 flex items-center" title="Show on form">
          <input type="checkbox" checked={field.enabled !== false} onChange={(e) => onToggleEnabled(field.id, e.target.checked, parentId)} className="rounded text-violet-600" />
        </label>
        <button type="button" onClick={() => onEdit(field, parentId)} className="text-violet-600 hover:bg-violet-100 rounded p-0.5 shrink-0" title="Edit field">
          <Edit2 size={12} />
        </button>
        <button type="button" onClick={() => onDelete(field.id, parentId)} className="text-gray-400 hover:text-red-500 shrink-0 p-0.5" title="Delete field">
          <Trash2 size={12} />
        </button>
      </div>
    </div>
  )
}

function FieldTreeList({
  fields,
  parentId = null,
  depth = 0,
  selectedId,
  expandedGroups,
  onToggleSelect,
  onEdit,
  onDelete,
  onToggleEnabled,
  onReorder,
  onAddChild,
  onToggleExpand,
}) {
  const ids = fields.map((f) => f.id)
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }))

  function handleDragEnd(event) {
    const { active, over } = event
    if (!over || active.id === over.id) return
    onReorder(parentId, String(active.id), String(over.id))
  }

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <SortableContext items={ids} strategy={verticalListSortingStrategy}>
        {fields.map((field, idx) => (
          <div key={field.id}>
            <SortableFieldRow
              field={field}
              parentId={parentId}
              depth={depth}
              childIndex={parentId ? idx + 1 : null}
              selectedId={selectedId}
              expandedGroups={expandedGroups}
              onToggleSelect={onToggleSelect}
              onEdit={onEdit}
              onDelete={onDelete}
              onToggleEnabled={onToggleEnabled}
              onToggleExpand={onToggleExpand}
              onAddChild={onAddChild}
            />
            {field.type === 'group' && expandedGroups.has(field.id) && (
              <FieldTreeList
                fields={field.children || []}
                parentId={field.id}
                depth={depth + 1}
                selectedId={selectedId}
                expandedGroups={expandedGroups}
                onToggleSelect={onToggleSelect}
                onEdit={onEdit}
                onDelete={onDelete}
                onToggleEnabled={onToggleEnabled}
                onReorder={onReorder}
                onAddChild={onAddChild}
                onToggleExpand={onToggleExpand}
              />
            )}
          </div>
        ))}
      </SortableContext>
    </DndContext>
  )
}

function LayoutSizeBadge({ layout }) {
  const col = layout?.col_span || 12
  const h = layout?.min_height_px || 40
  return (
    <span className="inline-flex items-center gap-1 text-[10px] font-bold text-violet-700 bg-violet-100 px-2 py-0.5 rounded-full">
      {Math.round((col / 12) * 100)}% width · {h}px height
    </span>
  )
}

function FieldEditPanel({
  panelMode,
  panelField,
  isBuiltinEdit,
  updatePanel,
  updatePanelLayout,
  onCommit,
  onCancel,
}) {
  if (!panelField) return null
  return (
    <div className="space-y-3">
      <p className="text-xs font-black uppercase text-gray-500">
        {panelMode === 'add' ? 'New field' : 'Edit field'}
        {isBuiltinEdit ? ' (default)' : ''}
      </p>
      <div>
        <label className="text-xs text-gray-500 mb-1 block">Field name</label>
        <input value={panelField.label} onChange={(e) => updatePanel({ label: e.target.value })} className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm" placeholder="e.g. Dressing notes" />
      </div>
      <div>
        <label className="text-xs text-gray-500 mb-1 block">Label size</label>
        <select
          value={panelField.label_size || 'md'}
          onChange={(e) => updatePanel({ label_size: e.target.value })}
          className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm"
        >
          {LABEL_SIZE_OPTIONS.map((size) => (
            <option key={size} value={size}>
              {size === 'sm' ? 'Small' : size === 'lg' ? 'Large' : 'Medium'}
            </option>
          ))}
        </select>
      </div>
      {panelMode === 'add' && !isBuiltinEdit && (
        <div>
          <label className="text-xs text-gray-500 mb-1 block">Data type</label>
          <select value={panelField.type} onChange={(e) => updatePanel({ type: e.target.value })} className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm">
            {FIELD_TYPE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>
      )}
      {panelMode === 'edit' && (
        <p className="text-[11px] text-gray-500">Type: <span className="font-bold text-gray-700">{panelField.type}</span></p>
      )}
      {(panelField.type === 'text' || panelField.type === 'builtin_text') && (
        <label className="flex items-center gap-2 text-sm text-gray-700">
          <input type="checkbox" checked={panelField.multiline} onChange={(e) => updatePanel({ multiline: e.target.checked })} />
          Multiline (textarea)
        </label>
      )}
      {panelField.type === 'number' && (
        <div>
          <label className="text-xs text-gray-500 mb-1 block">Number mode</label>
          <select value={panelField.number_mode} onChange={(e) => updatePanel({ number_mode: e.target.value })} className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm">
            <option value="integer">Integer</option>
            <option value="decimal">Decimal</option>
          </select>
        </div>
      )}
      {panelField.type === 'boolean' && (
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="text-xs text-gray-500 mb-1 block">True label</label>
            <input value={panelField.true_label} onChange={(e) => updatePanel({ true_label: e.target.value })} className="w-full border rounded-xl px-2 py-1.5 text-sm" />
          </div>
          <div>
            <label className="text-xs text-gray-500 mb-1 block">False label</label>
            <input value={panelField.false_label} onChange={(e) => updatePanel({ false_label: e.target.value })} className="w-full border rounded-xl px-2 py-1.5 text-sm" />
          </div>
        </div>
      )}
      {panelField.type === 'datetime' && (
        <div>
          <label className="text-xs text-gray-500 mb-1 block">Mode</label>
          <select value={panelField.datetime_mode} onChange={(e) => updatePanel({ datetime_mode: e.target.value })} className="w-full border rounded-xl px-3 py-2 text-sm">
            <option value="date">Date</option>
            <option value="time">Time</option>
            <option value="datetime">Date & time</option>
          </select>
        </div>
      )}
      {panelField.type === 'choices' && (
        <div className="space-y-2">
          <label className="text-xs text-gray-500 block">Options</label>
          {(panelField.options || []).map((opt, idx) => (
            <div key={idx} className="flex gap-1">
              <input
                value={opt}
                onChange={(e) => {
                  const options = [...(panelField.options || [])]
                  options[idx] = e.target.value
                  updatePanel({ options })
                }}
                className="flex-1 border rounded-lg px-2 py-1 text-sm"
              />
              <button type="button" onClick={() => updatePanel({ options: (panelField.options || []).filter((_, i) => i !== idx) })} className="text-red-400"><Trash2 size={14} /></button>
            </div>
          ))}
          <button type="button" onClick={() => updatePanel({ options: [...(panelField.options || []), `Option ${(panelField.options || []).length + 1}`] })} className="text-xs font-bold text-violet-600">+ Add option</button>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={panelField.choice_mode === 'multi'} onChange={(e) => updatePanel({ choice_mode: e.target.checked ? 'multi' : 'single' })} />
            Allow multiple selections
          </label>
        </div>
      )}
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="text-xs text-gray-500 mb-1 block">Width (columns)</label>
          <select value={panelField.layout?.col_span || 12} onChange={(e) => updatePanelLayout({ col_span: Number(e.target.value) })} className="w-full border rounded-xl px-2 py-1.5 text-sm">
            {SPANS.map((s) => <option key={s} value={s}>{s}/12 ({Math.round((s / 12) * 100)}%)</option>)}
          </select>
        </div>
        <div>
          <label className="text-xs text-gray-500 mb-1 block">Min height (px)</label>
          <input type="number" min={32} max={400} value={panelField.layout?.min_height_px || 40} onChange={(e) => updatePanelLayout({ min_height_px: Number(e.target.value) })} className="w-full border rounded-xl px-2 py-1.5 text-sm" />
        </div>
      </div>
      <div className="flex gap-2 pt-2">
        <button type="button" onClick={onCommit} className="px-3 py-2 rounded-xl bg-violet-600 text-white text-sm font-bold">
          {panelMode === 'add' ? 'Add to form' : 'Apply changes'}
        </button>
        <button type="button" onClick={onCancel} className="px-3 py-2 rounded-xl bg-gray-100 text-gray-700 text-sm font-bold">Cancel</button>
      </div>
    </div>
  )
}

function cloneTemplates(value) {
  if (!value) return defaultIpdProcessTemplates()
  return JSON.parse(JSON.stringify(value))
}

function TemplatePillBar({
  templatesRoot,
  activeTemplateId,
  defaultTemplateId,
  onSelect,
  onAdd,
  onRename,
  onDuplicate,
  onDelete,
  onSetDefault,
}) {
  const templates = templatesRoot?.templates || []
  return (
    <div className="flex items-center gap-1.5 flex-wrap mb-3 pb-3 border-b border-gray-100">
      <span className="text-[9px] font-black uppercase text-gray-400 shrink-0 mr-0.5">Templates</span>
      {templates.map((tpl) => {
        const active = tpl.id === activeTemplateId
        const isDefault = tpl.id === defaultTemplateId
        return (
          <div key={tpl.id} className="inline-flex items-center gap-0.5 max-w-full">
            <button
              type="button"
              onClick={() => onSelect(tpl.id)}
              title={tpl.name}
              className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold border transition-colors truncate max-w-[9rem] ${
                active
                  ? 'bg-violet-600 text-white border-violet-600 shadow-sm'
                  : 'bg-white text-gray-700 border-[oklch(0.63_0.01_0/0.66)] hover:border-violet-300 hover:bg-violet-50'
              }`}
            >
              {isDefault ? (
                <Star size={8} className={active ? 'text-amber-200 shrink-0 fill-amber-200' : 'text-amber-500 shrink-0 fill-amber-400'} />
              ) : null}
              <span className="truncate">{tpl.name}</span>
            </button>
            {active ? (
              <span className="inline-flex items-center gap-px shrink-0">
                {!isDefault ? (
                  <button type="button" title="Set as default" onClick={() => onSetDefault(tpl.id)} className="p-0.5 rounded-full text-gray-400 hover:text-amber-500 hover:bg-amber-50">
                    <Star size={9} />
                  </button>
                ) : null}
                <button type="button" title="Rename" onClick={() => onRename(tpl)} className="p-0.5 rounded-full text-violet-600 hover:bg-violet-100">
                  <Edit2 size={9} />
                </button>
                <button type="button" title="Duplicate" onClick={() => onDuplicate(tpl)} className="p-0.5 rounded-full text-violet-600 hover:bg-violet-100">
                  <Copy size={9} />
                </button>
                <button
                  type="button"
                  title="Delete"
                  onClick={() => onDelete(tpl.id)}
                  disabled={isDefault || templates.length <= 1}
                  className="p-0.5 rounded-full text-gray-400 hover:text-red-500 hover:bg-red-50 disabled:opacity-30"
                >
                  <Trash2 size={9} />
                </button>
              </span>
            ) : null}
          </div>
        )
      })}
      <button
        type="button"
        onClick={onAdd}
        disabled={templates.length >= MAX_TEMPLATES}
        className="inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 text-[10px] font-bold border border-dashed border-violet-300 text-violet-700 hover:bg-violet-50 disabled:opacity-40 shrink-0"
      >
        <Plus size={9} /> Add
      </button>
    </div>
  )
}

const IpdProcessSettingsSection = forwardRef(function IpdProcessSettingsSection(
  { initialTemplates, onSave, onDirtyChange },
  ref,
) {
  const [savedBaseline, setSavedBaseline] = useState(() => normalizeIpdProcessTemplates(initialTemplates))
  const [templatesRoot, setTemplatesRoot] = useState(() => normalizeIpdProcessTemplates(initialTemplates))
  const [activeTemplateId, setActiveTemplateId] = useState(() => getDefaultTemplateId(normalizeIpdProcessTemplates(initialTemplates)))
  const [selectedId, setSelectedId] = useState(null)
  const [panelParentId, setPanelParentId] = useState(null)
  const [panelMode, setPanelMode] = useState(null)
  const [panelField, setPanelField] = useState(null)
  const [saving, setSaving] = useState(false)
  const [showRestoreConfirm, setShowRestoreConfirm] = useState(false)
  const [expandedGroups, setExpandedGroups] = useState(() => new Set())
  const [templateModal, setTemplateModal] = useState({ open: false, mode: 'add', value: '', templateId: null })

  useEffect(() => {
    const normalized = normalizeIpdProcessTemplates(initialTemplates)
    setSavedBaseline(normalized)
    setTemplatesRoot(normalized)
    setActiveTemplateId(getDefaultTemplateId(normalized))
  }, [initialTemplates])

  const config = useMemo(() => {
    const tpl = templatesRoot.templates?.find((t) => t.id === activeTemplateId)
    return normalizeIpdProcessFieldConfigEditor(tpl?.config)
  }, [templatesRoot, activeTemplateId])

  const patchConfig = useCallback((updater) => {
    setTemplatesRoot((prev) => {
      const root = cloneTemplates(prev)
      const idx = root.templates.findIndex((t) => t.id === activeTemplateId)
      if (idx < 0) return prev
      const cfg = normalizeIpdProcessFieldConfigEditor(root.templates[idx].config)
      const next = updater({ ...cfg, fields: [...cfg.fields] })
      root.templates[idx] = {
        ...root.templates[idx],
        config: { version: 1, fields: next.fields },
      }
      return root
    })
  }, [activeTemplateId])

  const closePanel = useCallback(() => {
    setPanelMode(null)
    setPanelField(null)
  }, [])

  const clearSelection = useCallback(() => {
    setSelectedId(null)
    setPanelParentId(null)
    closePanel()
  }, [closePanel])

  const isPanelDirty = useMemo(() => {
    if (!panelMode || !panelField) return false
    if (panelMode === 'add') return true
    const loc = findFieldLocation(config.fields, panelField.id)
    if (!loc?.field) return false
    return JSON.stringify(panelField) !== JSON.stringify(loc.field)
  }, [panelMode, panelField, config.fields])

  const isDirty = useMemo(
    () => !templatesEqual(templatesRoot, savedBaseline) || isPanelDirty,
    [templatesRoot, savedBaseline, isPanelDirty],
  )

  useEffect(() => {
    onDirtyChange?.(isDirty)
  }, [isDirty, onDirtyChange])

  const previewConfig = useMemo(() => {
    if (panelMode && panelField) {
      return overlayPanelFieldOnConfig(config, panelField, panelParentId, panelMode)
    }
    return config
  }, [config, panelMode, panelField, panelParentId])

  const previewSelectedId = useMemo(() => {
    if (panelMode === 'add' && panelField) return BUILDER_DRAFT_FIELD_ID
    return selectedId
  }, [panelMode, panelField, selectedId])

  const previewLayoutField = useMemo(() => {
    if (panelMode && panelField) return panelField.layout
    if (selectedId) {
      const loc = findFieldLocation(config.fields, selectedId)
      return loc?.field?.layout
    }
    return null
  }, [panelMode, panelField, selectedId, config.fields])

  const toggleSelect = useCallback((field, parentId = null) => {
    if (selectedId === field.id && panelMode !== 'add') {
      setSelectedId(null)
      setPanelParentId(null)
      if (panelMode === 'edit' && panelField?.id === field.id) closePanel()
    } else {
      setSelectedId(field.id)
      setPanelParentId(parentId)
    }
  }, [selectedId, panelMode, panelField, closePanel])

  const openEdit = useCallback((field, parentId = null) => {
    setSelectedId(field.id)
    setPanelParentId(parentId)
    setPanelMode('edit')
    setPanelField(cloneField(field))
  }, [])

  const startAddField = useCallback((parentId = null) => {
    setSelectedId(null)
    setPanelParentId(parentId)
    setPanelMode('add')
    setPanelField(emptyDraft())
    if (parentId) {
      setExpandedGroups((prev) => new Set([...prev, parentId]))
    }
  }, [])

  const handlePreviewFieldSelect = useCallback((fieldId, parentId) => {
    if (fieldId === BUILDER_DRAFT_FIELD_ID) return
    const loc = findFieldLocation(config.fields, fieldId)
    if (!loc) return
    toggleSelect(loc.field, parentId ?? loc.parentId)
  }, [config.fields, toggleSelect])

  function updatePanel(patch) {
    setPanelField((prev) => ({ ...prev, ...patch }))
  }

  function updatePanelLayout(layoutPatch) {
    setPanelField((prev) => ({ ...prev, layout: { ...(prev?.layout || {}), ...layoutPatch } }))
  }

  function handlePreviewLayoutChange(fieldId, layout, parentId) {
    if (panelMode && panelField) {
      const editingId = panelMode === 'add' ? BUILDER_DRAFT_FIELD_ID : panelField.id
      if (fieldId === editingId) {
        updatePanelLayout(layout)
        return
      }
    }
    if (fieldId === BUILDER_DRAFT_FIELD_ID) return
    patchConfig((cfg) => ({
      ...cfg,
      fields: updateFieldInTree(cfg.fields, fieldId, (f) => ({ ...f, layout: { ...(f.layout || {}), ...layout } }), parentId),
    }))
  }

  function commitPanelField() {
    const pf = panelField
    if (!pf?.label?.trim()) {
      toast.error('Field name is required')
      return
    }
    if (panelMode === 'add' && countCustomFields(config) >= MAX_CUSTOM_FIELDS) {
      toast.error(`Maximum ${MAX_CUSTOM_FIELDS} custom fields allowed`)
      return
    }
    const ids = collectFieldIds(config)
    const fieldId = pf.id || makeCustomFieldId(pf.label, ids)
    const built = normalizeProcessField({
      ...pf,
      id: fieldId,
      builtin: pf.builtin === true,
      enabled: pf.enabled !== false,
      label: pf.label.trim(),
    }, panelParentId ? 1 : 0)
    if (!built) {
      toast.error('Invalid field configuration')
      return
    }

    patchConfig((cfg) => {
      let fields = [...cfg.fields]
      if (panelMode === 'edit' && pf.id) {
        fields = updateFieldInTree(fields, fieldId, () => built, panelParentId)
      } else if (panelParentId) {
        fields = fields.map((f) => {
          if (f.id !== panelParentId) return f
          return { ...f, children: [...(f.children || []), built] }
        })
      } else {
        fields = [...fields, built]
      }
      return { ...cfg, fields }
    })
    setSelectedId(fieldId)
    setPanelMode(null)
    setPanelField(null)
    toast.success(panelMode === 'edit' ? 'Field updated' : 'Field added')
  }

  function handleDelete(fieldId, parentId) {
    patchConfig((cfg) => ({
      ...cfg,
      fields: removeFieldFromTree(cfg.fields, fieldId, parentId),
    }))
    if (selectedId === fieldId || panelField?.id === fieldId) clearSelection()
  }

  function handleReorder(parentId, activeId, overId) {
    patchConfig((cfg) => ({
      ...cfg,
      fields: reorderFieldsInTree(cfg.fields, parentId, activeId, overId),
    }))
  }

  function discardChanges() {
    const restored = cloneTemplates(savedBaseline)
    setTemplatesRoot(restored)
    setActiveTemplateId(getDefaultTemplateId(restored))
    clearSelection()
  }

  function applyRestoreDefaults() {
    patchConfig(() => defaultIpdProcessFieldConfig())
    clearSelection()
    setExpandedGroups(new Set())
    setShowRestoreConfirm(false)
    toast.success('Default fields restored for this template (save to apply)')
  }

  function selectTemplate(templateId) {
    if (templateId === activeTemplateId) return
    clearSelection()
    setActiveTemplateId(templateId)
  }

  function addTemplate() {
    if ((templatesRoot.templates || []).length >= MAX_TEMPLATES) {
      toast.error(`Maximum ${MAX_TEMPLATES} templates allowed`)
      return
    }
    setTemplateModal({ open: true, mode: 'add', value: 'New template', templateId: null })
  }

  function renameTemplate(tpl) {
    setTemplateModal({ open: true, mode: 'rename', value: tpl.name, templateId: tpl.id })
  }

  function duplicateTemplate(tpl) {
    if ((templatesRoot.templates || []).length >= MAX_TEMPLATES) {
      toast.error(`Maximum ${MAX_TEMPLATES} templates allowed`)
      return
    }
    const id = makeTemplateId()
    setTemplatesRoot((prev) => ({
      ...prev,
      templates: [
        ...prev.templates,
        {
          id,
          name: `${tpl.name} copy`.slice(0, 80),
          config: cloneField(tpl.config) || defaultIpdProcessFieldConfig(),
        },
      ],
    }))
    setActiveTemplateId(id)
    clearSelection()
  }

  function deleteTemplate(templateId) {
    if (templatesRoot.templates.length <= 1) return
    if (templateId === templatesRoot.default_template_id) {
      toast.error('Cannot delete the default template')
      return
    }
    if (!window.confirm('Delete this template?')) return
    const remaining = templatesRoot.templates.filter((t) => t.id !== templateId)
    let nextDefault = templatesRoot.default_template_id
    if (nextDefault === templateId) nextDefault = remaining[0]?.id || DEFAULT_TEMPLATE_ID
    setTemplatesRoot((prev) => ({
      ...prev,
      default_template_id: nextDefault,
      templates: remaining,
    }))
    if (activeTemplateId === templateId) {
      setActiveTemplateId(nextDefault)
      clearSelection()
    }
  }

  function setDefaultTemplate(templateId) {
    setTemplatesRoot((prev) => ({ ...prev, default_template_id: templateId }))
    toast.success('Default template updated (save to apply)')
  }

  function closeTemplateModal() {
    setTemplateModal((prev) => ({ ...prev, open: false }))
  }

  function submitTemplateModal() {
    const name = templateModal.value.trim().slice(0, 80)
    if (!name) {
      toast.error('Template name is required')
      return
    }
    if (templateModal.mode === 'rename' && templateModal.templateId) {
      setTemplatesRoot((prev) => ({
        ...prev,
        templates: prev.templates.map((t) => (t.id === templateModal.templateId ? { ...t, name } : t)),
      }))
      setTemplateModal({ open: false, mode: 'add', value: '', templateId: null })
      return
    }

    const id = makeTemplateId()
    const source = templatesRoot.templates.find((t) => t.id === activeTemplateId)
    setTemplatesRoot((prev) => ({
      ...prev,
      templates: [
        ...prev.templates,
        {
          id,
          name,
          config: cloneField(source?.config) || defaultIpdProcessFieldConfig(),
        },
      ],
    }))
    setActiveTemplateId(id)
    clearSelection()
    setTemplateModal({ open: false, mode: 'add', value: '', templateId: null })
  }

  async function handleSave() {
    if (panelMode && isPanelDirty) {
      toast.error('Apply or cancel field changes before saving settings')
      return false
    }
    setSaving(true)
    try {
      const finalized = finalizeIpdProcessTemplates(templatesRoot)
      setTemplatesRoot(finalized)
      await onSave(finalized)
      setSavedBaseline(finalized)
      toast.success('IPD Process templates saved')
      return true
    } catch {
      toast.error('Failed to save IPD Process settings')
      return false
    } finally {
      setSaving(false)
    }
  }

  useImperativeHandle(ref, () => ({
    save: handleSave,
    discardChanges,
    isDirty: () => isDirty,
  }), [isDirty, templatesRoot, panelMode, isPanelDirty, savedBaseline])

  const showPanel = panelMode && panelField
  const isBuiltinEdit = panelField?.builtin === true

  return (
    <>
      <RestoreDefaultsConfirmModal open={showRestoreConfirm} onCancel={() => setShowRestoreConfirm(false)} onConfirm={applyRestoreDefaults} />
      <TemplateNameModal
        open={templateModal.open}
        mode={templateModal.mode}
        value={templateModal.value}
        onChange={(value) => setTemplateModal((prev) => ({ ...prev, value }))}
        onCancel={closeTemplateModal}
        onConfirm={submitTemplateModal}
      />
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm flex flex-col min-h-[72vh] overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h3 className="font-black text-gray-900 flex items-center gap-2">
              <Activity size={18} className="text-violet-600" />
              IPD Process Form Builder
            </h3>
            <p className="text-xs text-gray-500 mt-0.5">Pick a template · configure fields · staff choose template per day when filling</p>
          </div>
          <div className="flex items-center gap-2">
            {isDirty ? (
              <span className="text-[10px] font-bold text-amber-600 bg-amber-50 px-2 py-1 rounded-lg">Unsaved changes</span>
            ) : null}
            <button type="button" onClick={() => setShowRestoreConfirm(true)} className="px-3 py-2 rounded-xl bg-gray-100 text-gray-700 text-xs font-bold hover:bg-gray-200">
              Restore defaults
            </button>
            <button type="button" onClick={handleSave} disabled={saving} className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-violet-600 text-white text-sm font-bold hover:bg-violet-700 disabled:opacity-60">
              <Save size={14} />
              {saving ? 'Saving…' : 'Save settings'}
            </button>
          </div>
        </div>

        <div className="flex-1 flex flex-col xl:flex-row min-h-0 overflow-hidden">
          <div className="xl:w-64 shrink-0 border-b xl:border-b-0 xl:border-r border-gray-100 p-4 overflow-y-auto min-h-0">
            <div className="flex items-center justify-between mb-3">
              <p className="text-xs font-black uppercase text-gray-500">Fields</p>
              <button type="button" onClick={() => startAddField(null)} className="text-[10px] font-bold text-violet-700 bg-violet-100 px-2 py-1 rounded-lg hover:bg-violet-200 inline-flex items-center gap-1">
                <Plus size={10} /> Add field
              </button>
            </div>
            <FieldTreeList
              fields={config.fields}
              selectedId={selectedId}
              expandedGroups={expandedGroups}
              onToggleSelect={toggleSelect}
              onEdit={openEdit}
              onDelete={handleDelete}
              onToggleEnabled={(fieldId, enabled, parentId) => {
                patchConfig((cfg) => ({
                  ...cfg,
                  fields: updateFieldInTree(cfg.fields, fieldId, (f) => ({ ...f, enabled }), parentId),
                }))
              }}
              onReorder={handleReorder}
              onAddChild={startAddField}
              onToggleExpand={(groupId) => {
                setExpandedGroups((prev) => {
                  const next = new Set(prev)
                  if (next.has(groupId)) next.delete(groupId)
                  else next.add(groupId)
                  return next
                })
              }}
            />
          </div>

          {showPanel ? (
            <div className="xl:w-72 shrink-0 border-b xl:border-b-0 xl:border-r border-gray-100 p-4 overflow-y-auto min-h-0">
              <FieldEditPanel
                panelMode={panelMode}
                panelField={panelField}
                isBuiltinEdit={isBuiltinEdit}
                updatePanel={updatePanel}
                updatePanelLayout={updatePanelLayout}
                onCommit={commitPanelField}
                onCancel={closePanel}
              />
            </div>
          ) : null}

          <div className="flex-1 min-w-0 flex flex-col overflow-y-auto p-4 bg-slate-50/50 min-h-0">
            <TemplatePillBar
              templatesRoot={templatesRoot}
              activeTemplateId={activeTemplateId}
              defaultTemplateId={templatesRoot.default_template_id}
              onSelect={selectTemplate}
              onAdd={addTemplate}
              onRename={renameTemplate}
              onDuplicate={duplicateTemplate}
              onDelete={deleteTemplate}
              onSetDefault={setDefaultTemplate}
            />
            <div className="flex items-center justify-between mb-3 gap-2 shrink-0">
              <p className="text-xs font-black uppercase text-gray-500">Live preview</p>
              {previewLayoutField ? <LayoutSizeBadge layout={previewLayoutField} /> : null}
            </div>
            <div className="bg-white rounded-2xl border border-gray-200 p-4">
              <ProcessFormFields
                config={previewConfig}
                form={{
                  log_date: new Date().toISOString().slice(0, 10),
                  vitals: {},
                  medication_procedure_notes: '',
                  completed_notes: '',
                  pending_notes: '',
                  general_notes: '',
                  custom_fields: {},
                }}
                readOnly
                previewMode
                layoutMode="builder"
                builderSelectable
                selectedFieldId={previewSelectedId}
                onFieldSelect={handlePreviewFieldSelect}
                onLayoutChange={handlePreviewLayoutChange}
              />
            </div>
            <p className="text-[10px] text-gray-400 mt-3 shrink-0">Click a field to select · use Edit to configure · drag handles to resize when selected</p>
          </div>
        </div>
      </div>
    </>
  )
})

export default IpdProcessSettingsSection
