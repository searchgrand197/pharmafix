import { createPortal } from 'react-dom'
import { useEffect, useRef, useState } from 'react'
import { mountTemplateEditor } from './templateEditorMount'
import { OpdSheetChrome } from './OpdSheetChrome'
import { computeSlipLabelChCount, slipColumnAlignEnabled } from './slipLabelColumn'
import { useStyledTableHeaderRow } from './opdTableHeaderRow.js'
import {
  getDefaultOpdFieldConfig,
  getFieldInputCaption,
  resolveSlipFieldLabel,
} from './opdCoreFields.js'
import { loadOpdTemplateData } from './opdTemplateData.js'
import OpdCoreFieldsPanel from './OpdCoreFieldsPanel.jsx'
import './templateEditor.css'

const CANVAS_W = 1024
const CANVAS_H = 1451

export default function OpdGeneratorTab({ settingsRevision = 0, onOpdFieldConfigSaved }) {
  const rootRef = useRef(null)
  const editorHandleRef = useRef(null)
  const [mode, setMode] = useState('home') // 'home' | 'editor'
  const [layout, setLayout] = useState(null)
  const [opdFieldConfig, setOpdFieldConfig] = useState(() => getDefaultOpdFieldConfig())
  const [values, setValues] = useState({})
  const [showCoreFieldsPanel, setShowCoreFieldsPanel] = useState(false)
  // null = not printing | 'no-bg' | 'with-bg'
  const [printMode, setPrintMode] = useState(null)

  const applyTemplateData = (data) => {
    if (!data) return
    setOpdFieldConfig(data.opdFieldConfig)
    if (data.layout) setLayout(data.layout)
    if (editorHandleRef.current?.setOpdFieldConfig) {
      editorHandleRef.current.setOpdFieldConfig(data.opdFieldConfig)
      editorHandleRef.current.refreshFieldLabels?.()
    }
  }

  useEffect(() => {
    let cancelled = false
    loadOpdTemplateData().then((data) => {
      if (!cancelled) applyTemplateData(data)
    })
    return () => { cancelled = true }
  }, [settingsRevision])

  useEffect(() => {
    if (mode !== 'editor') {
      editorHandleRef.current?.dispose?.()
      editorHandleRef.current = null
      return undefined
    }
    const el = rootRef.current
    if (!el) return undefined
    const handle = mountTemplateEditor(el)
    editorHandleRef.current = handle
    handle.setOpdFieldConfig?.(opdFieldConfig)
    handle.refreshFieldLabels?.()
    return () => {
      handle.dispose?.()
      if (editorHandleRef.current === handle) editorHandleRef.current = null
    }
  }, [mode, settingsRevision])

  useEffect(() => {
    if (mode !== 'editor' || !editorHandleRef.current) return
    editorHandleRef.current.setOpdFieldConfig?.(opdFieldConfig)
    editorHandleRef.current.refreshFieldLabels?.()
  }, [opdFieldConfig, mode])

  // Trigger window.print() after React renders the print portal into the DOM
  useEffect(() => {
    if (!printMode) return
    const timer = setTimeout(() => { window.print() }, 80)
    const onAfterPrint = () => setPrintMode(null)
    window.addEventListener('afterprint', onAfterPrint)
    return () => {
      clearTimeout(timer)
      window.removeEventListener('afterprint', onAfterPrint)
    }
  }, [printMode])

  const fieldNames    = layout && layout.fields ? Object.keys(layout.fields) : []
  const noteIds       = layout && layout.notes  ? Object.keys(layout.notes)  : []
  const shapeIds      = layout && layout.shapes ? Object.keys(layout.shapes) : []
  const tableIds      = layout && layout.tables ? Object.keys(layout.tables) : []
  const printOffsetX  = layout && typeof layout.printOffsetX === 'number' ? layout.printOffsetX : 0
  const printOffsetY  = layout && typeof layout.printOffsetY === 'number' ? layout.printOffsetY : 0

  const handleChange = (name, v) => setValues((prev) => ({ ...prev, [name]: v }))
  const handlePrint  = (withBackground) => {
    if (!layout) return
    setPrintMode(withBackground ? 'with-bg' : 'no-bg')
  }

  // ── Shapes renderer ─────────────────────────────────────────────────────────
  const renderShapes = (offsetX, offsetY) => {
    if (!layout || !layout.shapes) return []
    return shapeIds.map((id) => {
      const cfg = layout.shapes[id] || {}
      const x   = typeof cfg.x === 'number' ? cfg.x : 0
      const y   = typeof cfg.y === 'number' ? cfg.y : 0
      const left = ((x + offsetX) / CANVAS_W) * 100
      const top  = ((y + offsetY) / CANVAS_H) * 100

      if (cfg.type === 'line') {
        const isH    = cfg.orientation !== 'vertical'
        const len    = cfg.length    || 200
        const thick  = cfg.thickness || 1
        const color  = cfg.color     || '#000000'
        const style  = cfg.style     || 'solid'
        const fs     = ((thick / 600) * 100).toFixed(4)
        if (isH) {
          const w = ((len / CANVAS_W) * 100).toFixed(4)
          return (
            <div
              key={id}
              style={{
                position: 'absolute',
                left: `${left.toFixed(4)}%`,
                top: `${top.toFixed(4)}%`,
                width: `${w}%`,
                height: 0,
                borderTop: `${fs}cqw ${style} ${color}`,
                zIndex: 1,
              }}
            />
          )
        } else {
          const h = ((len / CANVAS_H) * 100).toFixed(4)
          return (
            <div
              key={id}
              style={{
                position: 'absolute',
                left: `${left.toFixed(4)}%`,
                top: `${top.toFixed(4)}%`,
                width: 0,
                height: `${h}%`,
                borderLeft: `${fs}cqw ${style} ${color}`,
                zIndex: 1,
              }}
            />
          )
        }
      }

      // rect
      const w    = ((( cfg.width  || 200) / CANVAS_W) * 100).toFixed(4)
      const h    = ((( cfg.height || 60)  / CANVAS_H) * 100).toFixed(4)
      const bw   = (((cfg.borderWidth || 1) / 600) * 100).toFixed(4)
      const bc   = cfg.borderColor || '#000000'
      const bs   = cfg.borderStyle || 'solid'
      const fill = cfg.fillColor   || 'transparent'
      const br   = cfg.borderRadius
        ? `${((cfg.borderRadius / CANVAS_W) * 100).toFixed(4)}%`
        : '0'
      return (
        <div
          key={id}
          style={{
            position: 'absolute',
            left: `${left.toFixed(4)}%`,
            top: `${top.toFixed(4)}%`,
            width: `${w}%`,
            height: `${h}%`,
            border: `${bw}cqw ${bs} ${bc}`,
            backgroundColor: fill,
            borderRadius: br,
            zIndex: 1,
            boxSizing: 'border-box',
          }}
        />
      )
    })
  }

  // ── Tables renderer ─────────────────────────────────────────────────────────
  const renderTables = (offsetX, offsetY) => {
    if (!layout || !layout.tables) return []
    return tableIds.map((id) => {
      const cfg       = layout.tables[id] || {}
      const x         = typeof cfg.x === 'number' ? cfg.x : 0
      const y         = typeof cfg.y === 'number' ? cfg.y : 0
      const left      = ((x + offsetX) / CANVAS_W) * 100
      const top       = ((y + offsetY) / CANVAS_H) * 100
      const cols      = cfg.cols      || 2
      const rows      = cfg.rows      || 2
      const colWidths = cfg.colWidths || Array(cols).fill(200)
      const totalW    = colWidths.reduce((a, b) => a + b, 0)
      const rowHeight = cfg.rowHeight || 50
      const headers   = cfg.headers   || []
      const styledHdr = useStyledTableHeaderRow(cfg)
      const bc        = cfg.borderColor || '#374151'
      const bw        = (((cfg.borderWidth || 1) / 600) * 100).toFixed(4)
      const hBg       = cfg.headerBg || '#f3f4f6'
      const tableW    = ((totalW / CANVAS_W) * 100).toFixed(4)
      const tableH    = (((rows * rowHeight) / CANVAS_H) * 100).toFixed(4)
      const cellFs    = `${((10 / 600) * 100).toFixed(4)}cqw`
      const cellBorder = `${bw}cqw solid ${bc}`

      return (
        <div
          key={id}
          style={{
            position: 'absolute',
            left: `${left.toFixed(4)}%`,
            top: `${top.toFixed(4)}%`,
            width: `${tableW}%`,
            height: `${tableH}%`,
            zIndex: 1,
            overflow: 'hidden',
            boxSizing: 'border-box',
          }}
        >
          <table
            style={{
              borderCollapse: 'collapse',
              width: '100%',
              height: '100%',
              tableLayout: 'fixed',
            }}
          >
            <tbody>
              {Array.from({ length: rows }, (_, ri) => (
                <tr key={ri} style={{ height: `${(100 / rows).toFixed(2)}%` }}>
                  {colWidths.map((cw, ci) => {
                    const isHdr = styledHdr && ri === 0
                    return (
                      <td
                        key={ci}
                        style={{
                          width: `${((cw / totalW) * 100).toFixed(2)}%`,
                          border: cellBorder,
                          backgroundColor: isHdr ? hBg : 'transparent',
                          fontWeight: isHdr ? 600 : 'normal',
                          fontSize: cellFs,
                          padding: '0 2px',
                          overflow: 'hidden',
                          color: '#000',
                          fontFamily: 'system-ui, sans-serif',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {isHdr ? (headers[ci] || '') : ''}
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )
    })
  }

  // ── Fields / notes renderer ─────────────────────────────────────────────────
  const renderFields = (offsetX, offsetY, forPrint = false) => {
    const boxes          = []
    const slipColumns = slipColumnAlignEnabled(layout)

    fieldNames.forEach((name) => {
      const cfg  = layout.fields[name] || {}
      const labelText = resolveSlipFieldLabel(name, cfg, layout, opdFieldConfig)
      const x    = typeof cfg.x === 'number' ? cfg.x : CANVAS_W / 2
      const y    = typeof cfg.y === 'number' ? cfg.y : CANVAS_H / 2
      const left = ((x + offsetX) / CANVAS_W) * 100
      const top  = ((y + offsetY) / CANVAS_H) * 100
      const size = cfg.size || 13
      let val = values[name] ?? ''
      if (name.toLowerCase().includes('address') && val.length > 35) {
        val = val.substring(0, 32) + '...'
      }
      const hasVal = String(val).length > 0
      const useSlipRow = slipColumns && !!labelText && (hasVal || !forPrint)
      boxes.push(
        <div
          key={name}
          className={useSlipRow ? 'field-box field-box--slip-preview field-box--slip-row' : 'field-box'}
          style={{
            left:       `${left.toFixed(4)}%`,
            top:        `${top.toFixed(4)}%`,
            fontSize:   `${((size / 600) * 100).toFixed(4)}cqw`,
            fontWeight: cfg.bold   ? 'bold'   : undefined,
            fontStyle:  cfg.italic ? 'italic' : undefined,
            color:      cfg.color  || undefined,
            textAlign:  useSlipRow ? 'start' : 'left',
            cursor:     'default',
          }}
        >
          {(() => {
            if (!labelText) return val
            if (slipColumns && hasVal) {
              return (
                <>
                  <span className="field-box-slip-label">{labelText}</span>
                  <span className="field-box-value-text">{val}</span>
                </>
              )
            }
            if (slipColumns && !hasVal && !forPrint) {
              return (
                <>
                  <span className="field-box-slip-label">{labelText}</span>
                  <span className="field-box-preview-part field-box-value-slot" aria-hidden="true">
                    {name}
                  </span>
                </>
              )
            }
            if (slipColumns && forPrint && !hasVal) return ''
            if (hasVal) return `${labelText}${val}`
            if (forPrint) return ''
            return `${labelText}${name}`
          })()}
        </div>,
      )
    })

    noteIds.forEach((id) => {
      const cfg  = layout.notes[id] || {}
      const x    = typeof cfg.x === 'number' ? cfg.x : CANVAS_W / 2
      const y    = typeof cfg.y === 'number' ? cfg.y : CANVAS_H / 2
      const left = ((x + offsetX) / CANVAS_W) * 100
      const top  = ((y + offsetY) / CANVAS_H) * 100
      const size = cfg.size || 11
      boxes.push(
        <div
          key={id}
          className="field-box"
          style={{
            left:       `${left.toFixed(4)}%`,
            top:        `${top.toFixed(4)}%`,
            fontSize:   `${((size / 600) * 100).toFixed(4)}cqw`,
            fontWeight: cfg.bold   ? 'bold'   : undefined,
            fontStyle:  cfg.italic ? 'italic' : undefined,
            color:      cfg.color  || undefined,
            textAlign:  'left',
            cursor:     'default',
          }}
        >
          {cfg.text || ''}
        </div>,
      )
    })

    return boxes
  }

  // ── Generator preview (right panel) ────────────────────────────────────────
  const renderGeneratorPreview = () => {
    const hasContent =
      fieldNames.length || noteIds.length || shapeIds.length || tableIds.length
    if (!layout || !hasContent) {
      return (
        <div className="template-editor-canvas-wrap opd-generator-wrap">
          <div className="template-editor-canvas opd-sheet">
            <OpdSheetChrome />
            <div className="opd-empty-hint">
              No fields defined yet. Open the OPD editor, add fields, save the layout, then return
              here.
            </div>
          </div>
        </div>
      )
    }

    const bgSrc = layout.backgroundDataUrl || undefined
    const slipCanvasStyle =
      slipColumnAlignEnabled(layout)
      && fieldNames.length > 0
        ? { ['--opd-slip-label-ch']: `${computeSlipLabelChCount(layout, opdFieldConfig)}ch` }
        : undefined
    return (
      <div className="template-editor-canvas-wrap opd-generator-wrap">
        <div
          className={`template-editor-canvas opd-sheet${bgSrc ? ' opd-sheet--with-bg' : ''}`}
          style={slipCanvasStyle}
        >
          <OpdSheetChrome />
          {bgSrc ? <img src={bgSrc} alt="" /> : null}
          {renderShapes(printOffsetX, printOffsetY)}
          {renderTables(printOffsetX, printOffsetY)}
          {renderFields(printOffsetX, printOffsetY)}
        </div>
      </div>
    )
  }

  // ── Print portal — rendered into document.body, shown only by @media print ─
  const renderPrintPortal = () => {
    if (!printMode || !layout) return null

    const bgSrc     = layout.backgroundDataUrl || null
    const withBg    = printMode === 'with-bg'
    const showBgImg = withBg && !!bgSrc
    const showChrome = withBg && !bgSrc
    const sheetClass = [
      'template-editor-canvas opd-sheet',
      showBgImg ? 'opd-sheet--with-bg' : '',
    ].filter(Boolean).join(' ')
    const slipCanvasStyle =
      slipColumnAlignEnabled(layout)
      && fieldNames.length > 0
        ? { ['--opd-slip-label-ch']: `${computeSlipLabelChCount(layout, opdFieldConfig)}ch` }
        : undefined

    return createPortal(
      <div id="opd-print-portal">
        <div className="opd-print-page">
          <div className={sheetClass} style={slipCanvasStyle}>
            {showBgImg && <img src={bgSrc} alt="" />}
            {showChrome && <OpdSheetChrome />}
            {renderShapes(printOffsetX, printOffsetY)}
            {renderTables(printOffsetX, printOffsetY)}
            {renderFields(printOffsetX, printOffsetY, true)}
          </div>
        </div>
      </div>,
      document.body,
    )
  }

  // ── Home (generator) page ───────────────────────────────────────────────────
  if (mode === 'home') {
    return (
      <>
        {renderPrintPortal()}
        <div className="template-editor-app">
          <div className="template-editor-page">
            <div className="template-editor-card">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
                <h1>OPD Generator</h1>
                <button
                  type="button"
                  className="secondary-btn"
                  onClick={() => setMode('editor')}
                  style={{ width: 'auto', paddingInline: 16, whiteSpace: 'nowrap' }}
                >
                  OPD editor
                </button>
              </div>
              <p className="template-editor-subtitle">
                Fill in patient details on the left and preview your A4 OPD template on the right. The
                fields and positions come from the saved template editor layout.
              </p>

              <div className="template-editor-layout">
                <div className="template-editor-sidebar">
                  <h2>Patient / visit data</h2>
                  <div className="editor-values">
                    {fieldNames.length === 0 && (
                      <p className="field-hint">
                        No fields yet. Click &quot;OPD editor&quot; to create them.
                      </p>
                    )}
                    <div className="generator-field-grid">
                      {fieldNames.map((name) => (
                        <div className="field" key={name}>
                          <label htmlFor={`field-input-${name}`}>
                            {getFieldInputCaption(name, layout?.fields?.[name] || {}, layout, opdFieldConfig)}
                          </label>
                          <input
                            id={`field-input-${name}`}
                            type="text"
                            value={values[name] ?? ''}
                            onChange={(e) => handleChange(name, e.target.value)}
                          />
                        </div>
                      ))}
                    </div>
                  </div>

                  <button
                    type="button"
                    className="secondary-btn"
                    onClick={() => handlePrint(false)}
                    style={{ width: '100%', marginTop: 8 }}
                  >
                    Generate (print)
                  </button>
                  <button
                    type="button"
                    className="secondary-btn opd-btn-print-bg"
                    onClick={() => handlePrint(true)}
                    style={{ width: '100%', marginTop: 8 }}
                  >
                    Print with background
                  </button>
                </div>

                <div className="template-editor-preview-scroll">{renderGeneratorPreview()}</div>
              </div>
            </div>
          </div>
        </div>
      </>
    )
  }

  // ── Editor page ─────────────────────────────────────────────────────────────
  return (
    <div className="template-editor-app">
      <div className="template-editor-page" ref={rootRef}>
        <div className="template-editor-card">
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              gap: 12,
              marginBottom: 8,
            }}
          >
            <h1 style={{ margin: 0 }}>OPD Generator – Template Editor</h1>
            <button
              type="button"
              className="secondary-btn"
              onClick={() => setMode('home')}
              style={{ width: 'auto', paddingInline: 16, whiteSpace: 'nowrap' }}
            >
              Back to OPD generator
            </button>
          </div>
          <p className="template-editor-subtitle">
            Design your A4 slip: add draggable fields, notes, boxes, lines, and tables. Drag to
            position on the canvas, then click &quot;Save layout&quot;.
          </p>

          <div className="template-editor-layout editor-layout-sticky">
            <div className="template-editor-preview-scroll">
              <div className="template-editor-canvas-wrap opd-generator-wrap">
                <div className="template-editor-canvas opd-sheet" id="editor-canvas">
                  <OpdSheetChrome />
                  <img id="editor-bg" alt="" />
                  {/* All design elements are injected by templateEditorMount.js */}
                </div>
              </div>
            </div>

            <div className="template-editor-sidebar">
              {/* ── Background ── */}
              <h2>Background</h2>
              <div className="editor-values">
                <div className="field">
                  <label htmlFor="template-upload">Background image (optional)</label>
                  <input
                    id="template-upload"
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                  />
                  <span className="field-hint">
                    If you choose an image it will fill the A4 page. Leave empty for a plain white page.
                  </span>
                </div>
              </div>

              {/* ── Display settings ── */}
              <h2>Display settings</h2>
              <div className="editor-values">
                <div className="field" style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                  <input
                    id="show-field-labels-toggle"
                    type="checkbox"
                    style={{ width: 'auto', margin: 0, cursor: 'pointer' }}
                  />
                  <label
                    htmlFor="show-field-labels-toggle"
                    style={{ margin: 0, cursor: 'pointer', fontWeight: 500 }}
                  >
                    Show field name on slip
                  </label>
                </div>
                <span className="field-hint">
                  When enabled, slips print as &quot;Label: Value&quot;. Use the option below for a fixed-width
                  label column so values line up across fields.
                </span>
                <div className="field" style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 10 }}>
                  <input
                    id="align-slip-columns-toggle"
                    type="checkbox"
                    disabled
                    style={{ width: 'auto', margin: 0, cursor: 'pointer' }}
                  />
                  <label
                    htmlFor="align-slip-columns-toggle"
                    style={{ margin: 0, cursor: 'pointer', fontWeight: 500 }}
                  >
                    Align slip columns (label / value)
                  </label>
                </div>
                <span className="field-hint">
                  Requires &quot;Show field name on slip&quot;. Labels are right-aligned in a fixed-width column
                  (colons line up); values are right-aligned in the second column, with extra space after each colon
                  before the value. Turn off for a simple inline &quot;Label: Value&quot; line.
                </span>
              </div>

              {/* ── Print calibration ── */}
              <h2>Print calibration</h2>
              <div className="editor-values">
                <div className="field">
                  <label>Fine-tune print alignment (advanced)</label>
                  <span className="field-hint">
                    Adjust if printed text is slightly shifted. Positive values move content down/right.
                  </span>
                </div>
                <div className="generator-field-grid">
                  <div className="field">
                    <label htmlFor="calib-offset-x">Horizontal offset</label>
                    <input
                      id="calib-offset-x"
                      type="number"
                      defaultValue={printOffsetX}
                      onChange={(e) => {
                        const v = Number(e.target.value) || 0
                        setLayout((prev) => prev ? { ...prev, printOffsetX: v } : prev)
                      }}
                    />
                  </div>
                  <div className="field">
                    <label htmlFor="calib-offset-y">Vertical offset</label>
                    <input
                      id="calib-offset-y"
                      type="number"
                      defaultValue={printOffsetY}
                      onChange={(e) => {
                        const v = Number(e.target.value) || 0
                        setLayout((prev) => prev ? { ...prev, printOffsetY: v } : prev)
                      }}
                    />
                  </div>
                </div>
              </div>

              {/* ── Fields & notes ── */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                <h2 style={{ margin: 0 }}>Fields &amp; notes</h2>
                <button
                  type="button"
                  className="secondary-btn"
                  style={{ width: 'auto', paddingInline: 12, whiteSpace: 'nowrap' }}
                  onClick={() => setShowCoreFieldsPanel((open) => !open)}
                >
                  Core fields
                </button>
              </div>
              {showCoreFieldsPanel ? (
                <OpdCoreFieldsPanel
                  initialConfig={opdFieldConfig}
                  onSaved={(saved) => {
                    onOpdFieldConfigSaved?.()
                    loadOpdTemplateData().then((data) => {
                      applyTemplateData({ ...data, opdFieldConfig: saved })
                    })
                  }}
                  onClose={() => setShowCoreFieldsPanel(false)}
                />
              ) : null}
              <div className="editor-values">
                <div className="field">
                  <label htmlFor="new-field-name">New field / note text</label>
                  <input
                    id="new-field-name"
                    type="text"
                    placeholder="Type field label or note text"
                    autoComplete="off"
                  />
                  <span className="field-hint">
                    &quot;Add field&quot; creates an input on the generator page. &quot;Add note&quot; is printed text only.
                  </span>
                  <p className="field-hint" id="field-error" />
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button type="button" id="add-field-btn" className="primary-btn" style={{ flex: 1 }}>
                    Add field
                  </button>
                  <button type="button" id="add-note-btn" className="secondary-btn" style={{ flex: 1 }}>
                    Add note
                  </button>
                </div>
              </div>

              <div className="editor-values">
                <h3 style={{ margin: '0 0 6px', fontSize: 14 }}>Existing fields</h3>
                <div id="field-list" />
              </div>

              <div className="editor-values">
                <h3 style={{ margin: '0 0 6px', fontSize: 14 }}>Notes</h3>
                <div id="note-list" />
              </div>

              {/* ── Shapes & Lines ── */}
              <h2>Shapes &amp; Lines</h2>
              <div className="editor-values">
                <span className="field-hint">
                  Drag to position on canvas. Use the blue dot to resize. Style options appear in the list below.
                </span>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
                  <button type="button" id="add-box-btn" className="secondary-btn" style={{ flex: 1, fontSize: 13, padding: '8px 10px' }}>
                    + Box
                  </button>
                  <button type="button" id="add-hline-btn" className="secondary-btn" style={{ flex: 1, fontSize: 13, padding: '8px 10px' }}>
                    + H-Line
                  </button>
                  <button type="button" id="add-vline-btn" className="secondary-btn" style={{ flex: 1, fontSize: 13, padding: '8px 10px' }}>
                    + V-Line
                  </button>
                </div>
              </div>
              <div className="editor-values">
                <h3 style={{ margin: '0 0 6px', fontSize: 14 }}>Shapes &amp; Lines</h3>
                <div id="shape-list" />
              </div>

              {/* ── Tables ── */}
              <h2>Tables</h2>
              <div className="editor-values">
                <span className="field-hint">
                  Add a grid table. Drag to move; use the blue corner handle to resize (like boxes). Click ✎ for an optional shaded header row.
                </span>
                <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
                  <div className="field" style={{ marginBottom: 0, flex: 1 }}>
                    <label htmlFor="table-rows-input">Rows</label>
                    <input id="table-rows-input" type="number" min="1" max="20" defaultValue={3} />
                  </div>
                  <div className="field" style={{ marginBottom: 0, flex: 1 }}>
                    <label htmlFor="table-cols-input">Columns</label>
                    <input id="table-cols-input" type="number" min="1" max="10" defaultValue={3} />
                  </div>
                </div>
                <button type="button" id="add-table-btn" className="secondary-btn" style={{ width: '100%', marginTop: 8 }}>
                  + Add Table
                </button>
              </div>
              <div className="editor-values">
                <h3 style={{ margin: '0 0 6px', fontSize: 14 }}>Tables</h3>
                <div id="table-list" />
              </div>

              {/* ── Prescription Box ── */}
              <h2>Prescription Box</h2>
              <div className="editor-values">
                <span className="field-hint">
                  Drag on canvas to position. Mark Done prints only prescription text here — no background or patient fields.
                </span>
                <button type="button" id="add-rx-box-btn" className="secondary-btn" style={{ width: '100%', marginTop: 8 }}>
                  + Prescription Box
                </button>
                <div id="rx-box-props" style={{ display: 'none', marginTop: 10 }}>
                  <p className="field-hint" style={{ margin: '0 0 6px', fontWeight: 600 }}>Include on Mark Done print:</p>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, marginBottom: 4 }}>
                    <input type="checkbox" id="rx-box-show-rx" defaultChecked /> Pharmacy Prescription
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, marginBottom: 4 }}>
                    <input type="checkbox" id="rx-box-show-cc" defaultChecked /> Chief Complaint
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, marginBottom: 4 }}>
                    <input type="checkbox" id="rx-box-show-notes" defaultChecked /> Notes / Advice
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, marginBottom: 8 }}>
                    <input type="checkbox" id="rx-box-show-fup" defaultChecked /> Follow-up Date
                  </label>
                  <p className="field-hint" style={{ margin: '0 0 6px', fontWeight: 600 }}>Prescription table columns:</p>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, marginBottom: 4 }}>
                    <input type="checkbox" id="rx-box-qty" defaultChecked /> Show Qty
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, marginBottom: 8 }}>
                    <input type="checkbox" id="rx-box-timing" defaultChecked /> Show Timing
                  </label>
                  <div className="field" style={{ marginBottom: 8 }}>
                    <label htmlFor="rx-box-fontsize">Font size</label>
                    <input id="rx-box-fontsize" type="number" min="7" max="16" defaultValue={10} />
                  </div>
                  <button type="button" id="remove-rx-box-btn" className="secondary-btn" style={{ width: '100%', color: '#b91c1c' }}>
                    Remove Prescription Box
                  </button>
                </div>
              </div>

              {/* ── Save layout ── */}
              <h2>Save layout</h2>
              <p className="field-hint">
                Saves all fields, notes, shapes, and tables. Uses a single layout slot.
              </p>
              <button
                type="button"
                id="save-layout-btn"
                className="secondary-btn"
                style={{ width: '100%', marginBottom: 4 }}
              >
                Save layout
              </button>
              <p className="field-hint" id="save-layout-status" />

              <h2 style={{ marginTop: 16 }}>Generated config</h2>
              <textarea id="layout-json" className="layout-json" defaultValue="" />
              <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                <button type="button" id="apply-layout-btn" className="secondary-btn" style={{ flex: 1 }}>
                  Apply JSON
                </button>
                <button type="button" id="copy-layout-btn" className="secondary-btn" style={{ flex: 1 }}>
                  Copy JSON
                </button>
              </div>
              <p className="field-hint" id="copy-status" />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
