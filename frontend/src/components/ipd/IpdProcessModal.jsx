import { useEffect, useMemo, useState } from 'react'

import { format } from 'date-fns'

import { Calendar, Edit2, Save, Star, XCircle } from 'lucide-react'

import api from '../../api'

import toast from 'react-hot-toast'

import { ProcessFormFields } from './ProcessFieldRenderer'

import ProcessLogReadOnlyView from './ProcessLogReadOnlyView'
import ProcessCompletionRing from './ProcessCompletionRing'

import {

  buildProcessSavePayload,

  defaultIpdProcessTemplates,

  emptyProcessForm,

  getDefaultTemplateId,

  getProcessCompletionMeta,

  getTemplateConfig,

  hydrateProcessFormFromLog,

  normalizeIpdProcessTemplates,

  resolveLogProcessConfig,

  setFieldValueOnForm,

} from '../../utils/ipdProcessFieldConfig'



function toHtmlDate(v) {

  if (!v) return format(new Date(), 'yyyy-MM-dd')

  return String(v).slice(0, 10)

}



function computeDayNumber(admissionDate, logDate) {

  if (!admissionDate || !logDate) return null

  const start = new Date(`${String(admissionDate).slice(0, 10)}T12:00:00`)

  const end = new Date(`${String(logDate).slice(0, 10)}T12:00:00`)

  const diff = Math.round((end - start) / (1000 * 60 * 60 * 24))

  return Math.max(diff + 1, 1)

}

function TemplatePickerPills({

  templates,

  selectedId,

  defaultTemplateId,

  onSelect,

  readOnly = false,

}) {

  if (!templates?.length) return null

  return (

    <div className="flex items-center gap-1.5 flex-wrap pb-2 mb-3 border-b border-gray-200">

      <span className="text-[9px] font-black uppercase text-gray-400 shrink-0 mr-0.5">Template *</span>

      {templates.map((tpl) => {

        const active = tpl.id === selectedId

        const isDefault = tpl.id === defaultTemplateId

        return (

          <button

            key={tpl.id}

            type="button"

            onClick={() => !readOnly && onSelect(tpl.id)}

            disabled={readOnly}

            title={tpl.name}

            className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[10px] font-bold border transition-colors truncate max-w-[10rem] ${

              active

                ? 'bg-violet-600 text-white border-violet-600 shadow-sm'

                : readOnly

                  ? 'bg-gray-50 text-gray-400 border-gray-200 cursor-default opacity-60'

                  : 'bg-white text-gray-700 border-[oklch(0.63_0.01_0/0.66)] hover:border-violet-300 hover:bg-violet-50'

            }`}

          >

            {isDefault ? (

              <Star

                size={8}

                className={active ? 'text-amber-200 shrink-0 fill-amber-200' : 'text-amber-500 shrink-0 fill-amber-400'}

              />

            ) : null}

            <span className="truncate">{tpl.name}</span>

          </button>

        )

      })}

    </div>

  )

}



export default function IpdProcessModal({ admission, onClose, onSaved, templates, onLoadTemplates }) {

  const today = format(new Date(), 'yyyy-MM-dd')

  const [logs, setLogs] = useState([])

  const [loading, setLoading] = useState(true)

  const [saving, setSaving] = useState(false)

  const [selectedLogId, setSelectedLogId] = useState(null)

  const [isEditing, setIsEditing] = useState(false)

  const [form, setForm] = useState(() => emptyProcessForm(today))

  const [templatesRoot, setTemplatesRoot] = useState(() => normalizeIpdProcessTemplates(templates))

  const [selectedTemplateId, setSelectedTemplateId] = useState(() => getDefaultTemplateId(normalizeIpdProcessTemplates(templates)))



  useEffect(() => {

    const root = normalizeIpdProcessTemplates(templates || defaultIpdProcessTemplates())

    setTemplatesRoot(root)

    if (!selectedLogId) {

      setSelectedTemplateId(getDefaultTemplateId(root))

    }

  }, [templates, selectedLogId])



  useEffect(() => {

    let cancelled = false

    async function ensureTemplates() {

      if (templates?.templates?.length) return

      if (onLoadTemplates) {

        const loaded = await onLoadTemplates()

        if (!cancelled && loaded) {

          setTemplatesRoot(normalizeIpdProcessTemplates(loaded))

          if (!selectedLogId) {

            setSelectedTemplateId(getDefaultTemplateId(loaded))

          }

        }

      }

    }

    ensureTemplates()

    return () => { cancelled = true }

  }, [templates, onLoadTemplates, selectedLogId])



  const isSavedLog = Boolean(selectedLogId)

  const isViewMode = isSavedLog && !isEditing

  const activeLog = useMemo(

    () => logs.find((l) => l.id === selectedLogId) || null,

    [logs, selectedLogId],

  )



  const config = useMemo(() => {

    if (isSavedLog && activeLog) {

      return resolveLogProcessConfig(activeLog, templatesRoot)

    }

    return getTemplateConfig(templatesRoot, selectedTemplateId)

  }, [isSavedLog, activeLog, templatesRoot, selectedTemplateId])



  const dayNumber = useMemo(

    () => computeDayNumber(admission?.admission_date, form.log_date),

    [admission?.admission_date, form.log_date],

  )



  function syncFormFromLog(log) {

    if (!log) return

    setForm(hydrateProcessFormFromLog(log, toHtmlDate(log.log_date)))

    setSelectedTemplateId(log.process_template_id || getDefaultTemplateId(templatesRoot))

  }



  async function fetchLogs() {

    if (!admission?.id) return []

    setLoading(true)

    try {

      const { data } = await api.get(`/ipd-admissions/${admission.id}/process-logs/`)

      const list = data?.data || data?.results || data || []

      const rows = Array.isArray(list) ? list : []

      setLogs(rows)

      return rows

    } catch {

      toast.error('Failed to load process logs')

      setLogs([])

      return []

    } finally {

      setLoading(false)

    }

  }



  useEffect(() => {

    fetchLogs()

  }, [admission?.id])



  function handleDateChange(dateStr) {

    const existing = logs.find((l) => String(l.log_date).slice(0, 10) === dateStr)

    setIsEditing(false)

    if (existing) {

      setSelectedLogId(existing.id)

      syncFormFromLog(existing)

    } else {

      setSelectedLogId(null)

      setSelectedTemplateId(getDefaultTemplateId(templatesRoot))

      setForm(emptyProcessForm(dateStr))

    }

  }



  function loadLog(log) {

    setIsEditing(false)

    setSelectedLogId(log.id)

    syncFormFromLog(log)

  }



  function startNewForDate(dateStr) {

    handleDateChange(dateStr)

  }



  function handleTemplateChange(templateId) {

    if (isSavedLog) return

    setSelectedTemplateId(templateId)

    setForm((prev) => emptyProcessForm(prev.log_date))

  }



  function handleFieldChange(field, value) {

    setForm((prev) => setFieldValueOnForm(prev, field, value))

  }



  function handleCancelEdit() {

    if (isSavedLog && isEditing) {

      setIsEditing(false)

      if (activeLog) syncFormFromLog(activeLog)

      return

    }

    onClose()

  }



  function handleEnterEdit(e) {
    e.preventDefault()
    e.stopPropagation()
    setIsEditing(true)
  }

  async function handleSave(e) {

    e.preventDefault()

    if (isSavedLog && !isEditing) return

    if (!admission?.id) return

    if (!form.log_date) {

      toast.error('Please select a date')

      return

    }

    if (admission.admission_date && form.log_date < String(admission.admission_date).slice(0, 10)) {

      toast.error('Process date cannot be before admission date')

      return

    }

    setSaving(true)

    try {

      const templateId = isSavedLog

        ? (activeLog?.process_template_id || selectedTemplateId)

        : selectedTemplateId

      const payload = buildProcessSavePayload(form, config, templateId)

      let savedLogId = selectedLogId

      if (selectedLogId) {

        await api.patch(`/ipd-admissions/${admission.id}/process-logs/${selectedLogId}/`, payload)

        toast.success('Process log updated')

      } else {

        const { data } = await api.post(`/ipd-admissions/${admission.id}/process-logs/`, payload)

        const row = data?.data || data || {}

        savedLogId = row.id || null

        toast.success('Process log saved')

      }

      const refreshed = await fetchLogs()

      if (savedLogId) {

        setSelectedLogId(savedLogId)

        const updated = refreshed.find((l) => l.id === savedLogId)

        if (updated) syncFormFromLog(updated)

      }

      setIsEditing(false)

      onSaved?.()

    } catch (err) {

      const apiErrors = err?.response?.data?.errors

      const firstFieldError =

        apiErrors && typeof apiErrors === 'object'

          ? Object.values(apiErrors).flat().find(Boolean)

          : null

      toast.error(firstFieldError || err?.response?.data?.detail || 'Failed to save process log')

    } finally {

      setSaving(false)

    }

  }



  const templateOptions = templatesRoot.templates || []
  const visibleLogs = useMemo(
    () => logs
      .map((log) => {
        const resolvedConfig = resolveLogProcessConfig(log, templatesRoot)
        return {
          log,
          completion: getProcessCompletionMeta(log, resolvedConfig),
        }
      })
      .filter(({ completion }) => completion.percent >= 1),
    [logs, templatesRoot],
  )



  const sidebarDateCls = 'border border-[oklch(0.71_0.01_0)] rounded-lg px-2 py-1 text-[11px] font-semibold text-gray-800 bg-white focus:ring-2 focus:ring-violet-500 focus:outline-none min-w-0 w-[7.5rem]'



  return (

    <div className="fixed inset-0 z-[520] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">

      <div className="bg-white rounded-3xl shadow-2xl w-full max-w-5xl max-h-[92vh] overflow-hidden border border-gray-100 flex flex-col">

        <div className="bg-gradient-to-r from-violet-600 to-indigo-600 px-6 py-4 flex items-center justify-between gap-4 text-white shrink-0">

          <div className="min-w-0">

            <h3 className="font-black text-lg tracking-tight">IPD Process</h3>

            <p className="text-violet-100 text-xs font-medium truncate">

              {admission?.patient_name || 'Patient'} · Bed {admission?.bed_code || '—'}

            </p>

          </div>

          <div className="flex items-center gap-4 shrink-0">

            <div className="text-right mr-6">

              <p className="text-[10px] uppercase font-bold text-violet-200 tracking-wide leading-none">Stay day</p>

              <p className="text-lg font-black text-white leading-tight mt-0.5">{dayNumber ? `Day ${dayNumber}` : '—'}</p>

            </div>

            <button type="button" onClick={onClose} className="text-white/80 hover:text-white shrink-0">

              <XCircle size={24} />

            </button>

          </div>

        </div>



        <div className="flex-1 overflow-hidden flex flex-col lg:flex-row min-h-0">

          <aside className="lg:w-72 border-b lg:border-b-0 lg:border-r border-gray-100 bg-slate-50/80 flex flex-col min-h-0">

            <div className="px-3 py-2 border-b border-gray-200 space-y-1.5">

              <div className="flex items-center justify-between gap-2">

                <p className="text-xs font-black uppercase tracking-wide text-slate-600 shrink-0">Saved Days</p>

                <div className="flex items-center gap-1 shrink-0">

                  <Calendar size={12} className="text-slate-500 shrink-0" />

                  <input

                    type="date"

                    form="ipd-process-form"

                    value={form.log_date}

                    min={admission?.admission_date ? toHtmlDate(admission.admission_date) : undefined}

                    onChange={(e) => handleDateChange(e.target.value)}

                    className={sidebarDateCls}

                    required={!isViewMode}

                    aria-label="Process date"

                  />

                </div>

              </div>

              <button

                type="button"

                onClick={() => startNewForDate(today)}

                className="w-full text-[10px] font-bold text-violet-700 bg-violet-100 px-2 py-1.5 rounded-lg hover:bg-violet-200"

              >

                + Today

              </button>

            </div>

            <div className="flex-1 overflow-y-auto p-3 space-y-2">

              {loading ? (

                <p className="text-xs text-gray-400 text-center py-6">Loading…</p>

              ) : visibleLogs.length === 0 ? (

                <p className="text-xs text-gray-400 text-center py-6">No process logs yet.</p>

              ) : (

                visibleLogs.map(({ log, completion }) => {

                  const active = selectedLogId === log.id

                  return (

                    <button

                      key={log.id}

                      type="button"

                      onClick={() => loadLog(log)}

                      className={`w-full text-left rounded-xl border px-3 py-2.5 transition-colors ${

                        active

                          ? 'border-[oklch(0.48_0.28_275.82)] shadow-sm'

                          : 'border-[oklch(0.71_0.01_0)] bg-white hover:border-violet-300 hover:bg-violet-50/30'

                      }`}

                      style={active ? { backgroundColor: 'oklch(0.48 0.28 275.82 / 0.12)' } : undefined}

                    >

                      <div className="flex items-start gap-3">
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-bold text-gray-800">
                            {log.day_label || `Day ${log.day_number || '—'}`}
                          </p>
                          <p className="text-[11px] text-gray-500">{format(new Date(`${toHtmlDate(log.log_date)}T12:00:00`), 'd MMM yyyy')}</p>
                          {log.process_template_name ? (
                            <p className="text-[10px] text-violet-600 font-semibold mt-0.5">{log.process_template_name}</p>
                          ) : null}
                        </div>
                        <ProcessCompletionRing percent={completion.percent} />
                      </div>

                    </button>

                  )

                })

              )}

            </div>

          </aside>



          <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
            <div className="flex-1 overflow-y-auto px-6 pt-3 min-h-0">
              <form id="ipd-process-form" onSubmit={handleSave} className="space-y-3 pb-4">

                <TemplatePickerPills

                  templates={templateOptions}

                  selectedId={selectedTemplateId}

                  defaultTemplateId={templatesRoot.default_template_id}

                  onSelect={handleTemplateChange}

                  readOnly={isSavedLog}

                />



                {isViewMode && activeLog?.recorded_by_name ? (

                  <p className="text-[10px] text-violet-600 font-semibold -mt-1 mb-1">

                    Recorded by {activeLog.recorded_by_name}

                  </p>

                ) : null}



                {isViewMode ? (

                  <ProcessLogReadOnlyView config={config} form={form} appearance="ipd" />

                ) : (

                  <ProcessFormFields

                    config={config}

                    form={form}

                    onFieldChange={handleFieldChange}

                    appearance="ipd"

                  />

                )}

              </form>
            </div>

            <div className="shrink-0 flex justify-end gap-2 px-6 py-4 border-t border-gray-100 bg-white">

              {isViewMode ? (

                <>

                  <button type="button" onClick={onClose} className="px-4 py-2.5 rounded-xl bg-gray-100 text-gray-700 text-sm font-bold hover:bg-gray-200">

                    Close

                  </button>

                  <button

                    type="button"

                    onMouseDown={handleEnterEdit}

                    className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-violet-600 text-white text-sm font-bold hover:bg-violet-700"

                  >

                    <Edit2 size={16} />

                    Edit

                  </button>

                </>

              ) : (

                <>

                  <button type="button" onClick={handleCancelEdit} className="px-4 py-2.5 rounded-xl bg-gray-100 text-gray-700 text-sm font-bold hover:bg-gray-200">

                    Cancel

                  </button>

                  <button

                    type="submit"

                    form="ipd-process-form"

                    disabled={saving}

                    className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-violet-600 text-white text-sm font-bold hover:bg-violet-700 disabled:opacity-60"

                  >

                    <Save size={16} />

                    {saving ? 'Saving…' : 'Save process log'}

                  </button>

                </>

              )}

            </div>

          </div>

        </div>

      </div>

    </div>

  )

}


