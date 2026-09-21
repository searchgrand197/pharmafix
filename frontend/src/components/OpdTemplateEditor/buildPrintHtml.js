import { formatDateTime } from '../../utils/dateTimeFormat'

// Builds a standalone OPD print HTML page from the current layout + values.
// Kept as a plain JS file (not JSX) to avoid Vite parse issues with
// raw HTML string literals that contain <script> and </script> tags.

import { computeSlipLabelChCount, slipColumnAlignEnabled } from './slipLabelColumn.js'
import { useStyledTableHeaderRow } from './opdTableHeaderRow.js'
import { normalizeOpdFieldConfig, resolveSlipFieldLabel } from './opdCoreFields.js'
import { filterLayoutFieldsForSlip } from './syncCoreFieldsIntoLayout.js'

const CANVAS_W = 1024
const CANVAS_H = 1451

function esc(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function buildRxBoxHtml(layout, rxPrintData, printOffsetX, printOffsetY) {
  const box = layout?.rx_box
  if (!box || typeof box !== 'object') return ''

  const x = typeof box.x === 'number' ? box.x : 50
  const y = typeof box.y === 'number' ? box.y : 580
  const w = typeof box.width === 'number' ? box.width : 924
  const h = typeof box.height === 'number' ? box.height : 580
  const left = (((x + printOffsetX) / CANVAS_W) * 100).toFixed(4)
  const top = (((y + printOffsetY) / CANVAS_H) * 100).toFixed(4)
  const boxW = ((w / CANVAS_W) * 100).toFixed(4)
  const boxH = ((h / CANVAS_H) * 100).toFixed(4)
  const fontSize = Number(box.fontSize) || 10
  const fs = ((fontSize / 600) * 100).toFixed(4)
  const showQty = box.showQty !== false
  const showTiming = box.showTiming !== false

  const data = rxPrintData && typeof rxPrintData === 'object' ? rxPrintData : {}
  const parts = []

  const cc = String(data.chiefComplaint || '').trim()
  if (cc) {
    parts.push('<div style="margin-bottom:0.35em;"><strong>Chief Complaint:</strong> ' + esc(cc) + '</div>')
  }

  const rxItems = Array.isArray(data.rxItems) ? data.rxItems : []
  if (rxItems.length > 0) {
    let table = '<div style="margin:0.3em 0;font-weight:700;border-bottom:1px solid #374151;padding-bottom:0.2em;">Prescription</div>'
    table += '<table style="width:100%;border-collapse:collapse;font-size:inherit;">'
    table += '<tr style="font-weight:600;border-bottom:1px solid #9ca3af;">'
    table += '<td style="padding:2px 4px;">Medicine</td>'
    table += '<td style="padding:2px 4px;">Dosage</td>'
    table += '<td style="padding:2px 4px;">Days</td>'
    if (showQty) table += '<td style="padding:2px 4px;">Qty</td>'
    if (showTiming) table += '<td style="padding:2px 4px;">Timing</td>'
    table += '</tr>'
    rxItems.forEach((item) => {
      const name = esc(String(item.name || '').trim())
      const manualTag = item.isManual ? ' <span style="color:#92400e;font-size:0.9em;">(manual)</span>' : ''
      table += '<tr>'
      table += '<td style="padding:2px 4px;vertical-align:top;">' + name + manualTag + '</td>'
      table += '<td style="padding:2px 4px;">' + esc(String(item.pattern || '')) + '</td>'
      table += '<td style="padding:2px 4px;">' + esc(String(item.days ?? '')) + '</td>'
      if (showQty) table += '<td style="padding:2px 4px;">' + esc(String(item.qty ?? '')) + '</td>'
      if (showTiming) table += '<td style="padding:2px 4px;">' + esc(String(item.timing || '')) + '</td>'
      table += '</tr>'
    })
    table += '</table>'
    parts.push(table)
  }

  const notes = Array.isArray(data.notes) ? data.notes.filter((n) => String(n).trim()) : []
  if (notes.length > 0) {
    parts.push('<div style="margin-top:0.35em;"><strong>Notes:</strong> ' + notes.map((n) => esc(n)).join('; ') + '</div>')
  }

  const fup = String(data.followUpDate || '').trim()
  if (fup) {
    parts.push('<div style="margin-top:0.35em;"><strong>Follow-up:</strong> ' + esc(fup) + '</div>')
  }

  const inner = parts.length > 0
    ? parts.join('')
    : '<div style="color:#9ca3af;font-style:italic;">Prescription area</div>'

  return (
    '<div class="opd-rx-box" style="position:absolute;left:' + left + '%;top:' + top + '%;width:' + boxW + '%;height:' + boxH +
    '%;z-index:3;overflow:hidden;box-sizing:border-box;padding:4px 6px;font-size:' + fs +
    'cqw;font-family:system-ui,sans-serif;color:#111;line-height:1.35;">' + inner + '</div>'
  )
}

function buildAutoPrintScript() {
  return [
    '(function () {',
    '  var finalized = false;',
    '  function finalize() {',
    '    if (finalized) return;',
    '    finalized = true;',
    '    try { window.location.replace("about:blank"); } catch (e) {}',
    '    setTimeout(function () {',
    '      try { window.close(); } catch (e) {}',
    '    }, 50);',
    '  }',
    '  window.addEventListener("afterprint", finalize, { once: true });',
    '  window.addEventListener("focus", function () { setTimeout(finalize, 200); }, { once: true });',
    '  setTimeout(finalize, 120000);',
    '  function triggerPrint() {',
    '    setTimeout(function () {',
    '      try { window.print(); } catch (e) { finalize(); }',
    '    }, 0);',
    '  }',
    '  if (document.readyState === "complete") { triggerPrint(); }',
    '  else { window.addEventListener("load", triggerPrint, { once: true }); }',
    '})();',
  ].join('\n')
}

/** Prescription-only print: no background, no patient fields — just rx box content at saved position. */
export function buildRxOnlyPrintHtml(layout, rxPrintData) {
  const printOffsetX = typeof layout.printOffsetX === 'number' ? layout.printOffsetX : 0
  const printOffsetY = typeof layout.printOffsetY === 'number' ? layout.printOffsetY : 0
  const rxBoxHtml = buildRxBoxHtml(layout, rxPrintData, printOffsetX, printOffsetY)
  const inlineScript = buildAutoPrintScript()

  const parts = [
    '<!DOCTYPE html>',
    '<html lang="en">',
    '<head>',
    '<meta charset="UTF-8" />',
    '<title>Prescription Print</title>',
    '<style>',
    '@page { size: A4 portrait; margin: 0; marks: none; }',
    '*, *::before, *::after { box-sizing: border-box; }',
    'html, body { margin: 0; padding: 0; background: #fff; }',
    'table { border-collapse: collapse; }',
    'td, th { box-sizing: border-box; overflow: hidden; }',
    '.opd-generator-wrap {',
    '  width: 210mm; aspect-ratio: 210 / 297; height: auto;',
    '  position: relative; background: #ffffff;',
    '  container-type: inline-size; overflow: hidden;',
    '}',
    '.template-editor-canvas { position: relative; width: 100%; height: 100%; }',
    '@media print {',
    '  @page { size: A4 portrait; margin: 0; marks: none; }',
    '  html, body { margin: 0 !important; padding: 0 !important; background: #fff !important; }',
    '  .opd-generator-wrap { width: 210mm !important; }',
    '}',
    '</style>',
    '</head>',
    '<body>',
    '<div class="opd-generator-wrap">',
    '  <div class="template-editor-canvas">',
    '    ' + rxBoxHtml,
    '  </div>',
    '</div>',
    '<' + 'script' + '>',
    inlineScript,
    '</' + 'script' + '>',
    '</body>',
    '</html>',
  ]

  return parts.join('\n')
}

export function buildPrintHtml(layout, values, withBackground, opdFieldConfig, rxPrintData = null) {
  const printOffsetX    = typeof layout.printOffsetX === 'number' ? layout.printOffsetX : 0
  const printOffsetY    = typeof layout.printOffsetY === 'number' ? layout.printOffsetY : 0
  const showFieldLabels = layout.showFieldLabels === true
  const slipColumns = slipColumnAlignEnabled(layout)
  const bgSrc           = layout.backgroundDataUrl || null
  const normalizedFieldConfig = normalizeOpdFieldConfig(opdFieldConfig)
  const slipFields = filterLayoutFieldsForSlip(layout, normalizedFieldConfig)
  const fieldNames      = Object.keys(slipFields)
  const noteIds         = layout.notes  ? Object.keys(layout.notes)  : []
  const shapeIds        = layout.shapes ? Object.keys(layout.shapes) : []
  const tableIds        = layout.tables ? Object.keys(layout.tables) : []

  const slipLabelChStyle =
    slipColumns && fieldNames.length > 0
      ? ' style="--opd-slip-label-ch:' + computeSlipLabelChCount({ ...layout, fields: slipFields }, normalizedFieldConfig) + 'ch"'
      : ''

  const hasBg      = !!bgSrc
  const showBg     = withBackground && hasBg
  const showChrome = withBackground && !hasBg
  const sheetClass = showBg
    ? 'template-editor-canvas opd-sheet opd-sheet--with-bg'
    : 'template-editor-canvas opd-sheet'

  // ── Shapes ──────────────────────────────────────────────────────────────────
  const shapeBoxes = shapeIds.map((id) => {
    const cfg  = layout.shapes[id] || {}
    const x    = typeof cfg.x === 'number' ? cfg.x : 0
    const y    = typeof cfg.y === 'number' ? cfg.y : 0
    const left = (((x + printOffsetX) / CANVAS_W) * 100).toFixed(4)
    const top  = (((y + printOffsetY) / CANVAS_H) * 100).toFixed(4)

    if (cfg.type === 'line') {
      const isH   = cfg.orientation !== 'vertical'
      const len   = cfg.length    || 200
      const thick = cfg.thickness || 1
      const color = cfg.color     || '#000000'
      const style = cfg.style     || 'solid'
      const fs    = ((thick / 600) * 100).toFixed(4)
      if (isH) {
        const w = ((len / CANVAS_W) * 100).toFixed(4)
        return '<div style="position:absolute;left:' + left + '%;top:' + top + '%;width:' + w + '%;height:0;border-top:' + fs + 'cqw ' + style + ' ' + esc(color) + ';z-index:1;"></div>'
      } else {
        const h = ((len / CANVAS_H) * 100).toFixed(4)
        return '<div style="position:absolute;left:' + left + '%;top:' + top + '%;width:0;height:' + h + '%;border-left:' + fs + 'cqw ' + style + ' ' + esc(color) + ';z-index:1;"></div>'
      }
    }

    // rect
    const w    = (((cfg.width  || 200) / CANVAS_W) * 100).toFixed(4)
    const h    = (((cfg.height || 60)  / CANVAS_H) * 100).toFixed(4)
    const bw   = (((cfg.borderWidth || 1) / 600) * 100).toFixed(4)
    const bc   = cfg.borderColor || '#000000'
    const bs   = cfg.borderStyle || 'solid'
    const fill = cfg.fillColor   || 'transparent'
    const br   = cfg.borderRadius
      ? (((cfg.borderRadius / CANVAS_W) * 100).toFixed(4) + '%')
      : '0'
    return '<div style="position:absolute;left:' + left + '%;top:' + top + '%;width:' + w + '%;height:' + h + '%;border:' + bw + 'cqw ' + bs + ' ' + esc(bc) + ';background-color:' + esc(fill) + ';border-radius:' + br + ';z-index:2;box-sizing:border-box;-webkit-print-color-adjust:exact;print-color-adjust:exact;"></div>'
  }).join('\n')

  // ── Tables ───────────────────────────────────────────────────────────────────
  const tableBoxes = tableIds.map((id) => {
    const cfg       = layout.tables[id] || {}
    const x         = typeof cfg.x === 'number' ? cfg.x : 0
    const y         = typeof cfg.y === 'number' ? cfg.y : 0
    const left      = (((x + printOffsetX) / CANVAS_W) * 100).toFixed(4)
    const top       = (((y + printOffsetY) / CANVAS_H) * 100).toFixed(4)
    const cols      = cfg.cols      || 2
    const rows      = cfg.rows      || 2
    const colWidths = cfg.colWidths || Array(cols).fill(200)
    const totalW    = colWidths.reduce((a, b) => a + b, 0)
    const rowHeight = cfg.rowHeight || 50
    const headers   = cfg.headers   || []
    const styledHdr = useStyledTableHeaderRow(cfg)
    const bc        = cfg.borderColor || '#374151'
    const bw        = cfg.borderWidth  || 1
    const hBg       = cfg.headerBg || '#f3f4f6'
    const tableW    = ((totalW / CANVAS_W) * 100).toFixed(4)
    const tableH    = (((rows * rowHeight) / CANVAS_H) * 100).toFixed(4)
    const cellFs    = ((10 / 600) * 100).toFixed(4)
    const rowH      = (100 / rows).toFixed(2)

    let tHtml = '<div style="position:absolute;left:' + left + '%;top:' + top + '%;width:' + tableW + '%;height:' + tableH + '%;z-index:2;overflow:hidden;box-sizing:border-box;">'
    tHtml += '<table style="border-collapse:collapse;width:100%;height:100%;table-layout:fixed;">'
    for (let ri = 0; ri < rows; ri++) {
      tHtml += '<tr style="height:' + rowH + '%;">'
      for (let ci = 0; ci < cols; ci++) {
        const isHdr    = styledHdr && ri === 0
        const hText    = isHdr ? esc(headers[ci] || '') : ''
        const bg       = isHdr ? hBg : 'transparent'
        const fw       = isHdr ? '600' : 'normal'
        const colPct   = ((colWidths[ci] / totalW) * 100).toFixed(2)
        tHtml += '<td style="width:' + colPct + '%;border:' + bw + 'px solid ' + esc(bc) + ';background:' + bg + ';font-weight:' + fw + ';font-size:' + cellFs + 'cqw;padding:0 2px;overflow:hidden;color:#000;font-family:system-ui,sans-serif;">' + hText + '</td>'
      }
      tHtml += '</tr>'
    }
    tHtml += '</table></div>'
    return tHtml
  }).join('\n')

  // ── Fields ───────────────────────────────────────────────────────────────────
  const fieldBoxes = fieldNames.map((name) => {
    const cfg  = slipFields[name] || {}
    const x    = typeof cfg.x === 'number' ? cfg.x : CANVAS_W / 2
    const y    = typeof cfg.y === 'number' ? cfg.y : CANVAS_H / 2
    const left = (((x + printOffsetX) / CANVAS_W) * 100).toFixed(4)
    const top  = (((y + printOffsetY) / CANVAS_H) * 100).toFixed(4)
    const size = cfg.size || 13
    const fs   = ((size / 600) * 100).toFixed(4)
    const fw   = cfg.bold   ? 'bold'   : 'normal'
    const fi   = cfg.italic ? 'italic' : 'normal'
    const fc   = esc(cfg.color  || '#000000')

    let val = values[name] ?? ''
    if (name.toLowerCase().includes('address') && val.length > 35) {
      val = val.substring(0, 32) + '...'
    }
    const labelText = resolveSlipFieldLabel(name, cfg, layout, normalizedFieldConfig)
    const slipRow = slipColumns && val && labelText
    const rowClass = slipRow ? 'field-box field-box--slip-row' : 'field-box'
    const inner =
      slipRow
        ? '<span class="field-box-slip-label">' + esc(labelText) + '</span>' +
          '<span class="field-box-value-text">' + esc(val) + '</span>'
        : labelText && val
          ? esc(labelText + val)
          : esc(val)
    const taAttr = slipRow ? 'start' : 'left'
    return (
      '<div class="' + rowClass + '" style="left:' + left + '%;top:' + top + '%;font-size:' + fs +
      'cqw;font-weight:' + fw + ';font-style:' + fi + ';color:' + fc + ';text-align:' + taAttr + ';">' +
      inner +
      '</div>'
    )
  }).join('\n')

  // ── Notes ────────────────────────────────────────────────────────────────────
  const noteBoxes = noteIds.map((id) => {
    const cfg  = layout.notes[id] || {}
    const x    = typeof cfg.x === 'number' ? cfg.x : CANVAS_W / 2
    const y    = typeof cfg.y === 'number' ? cfg.y : CANVAS_H / 2
    const left = (((x + printOffsetX) / CANVAS_W) * 100).toFixed(4)
    const top  = (((y + printOffsetY) / CANVAS_H) * 100).toFixed(4)
    const size = cfg.size || 11
    const fs   = ((size / 600) * 100).toFixed(4)
    const fw   = cfg.bold   ? 'bold'   : 'normal'
    const fi   = cfg.italic ? 'italic' : 'normal'
    const fc   = esc(cfg.color || '#000000')
    const text = esc(cfg.text || '')
    return '<div class="field-box" style="left:' + left + '%;top:' + top + '%;font-size:' + fs + 'cqw;font-weight:' + fw + ';font-style:' + fi + ';color:' + fc + ';text-align:left;">' + text + '</div>'
  }).join('\n')

  // ── Timestamp ────────────────────────────────────────────────────────────────
  const dPrinted = new Date()
  const printedAtStr = esc(formatDateTime(dPrinted, {}))
  const printedAtHtml = '<div class="opd-printed-at">Printed at: ' + printedAtStr + '</div>'
  const rxBoxHtml = buildRxBoxHtml(layout, rxPrintData, printOffsetX, printOffsetY)

  const bgTag         = showBg ? '<img src="' + bgSrc + '" alt="" />' : ''
  const chromeDisplay = showChrome ? 'flex' : 'none'
  const imgDisplay    = showBg    ? 'block' : 'none'

  const inlineScript = buildAutoPrintScript()

  const parts = [
    '<!DOCTYPE html>',
    '<html lang="en">',
    '<head>',
    '<meta charset="UTF-8" />',
    '<title>OPD Print</title>',
    '<style>',
    '@page { size: A4 portrait; margin: 0; marks: none; }',
    '*, *::before, *::after { box-sizing: border-box; }',
    'html, body { margin: 0; padding: 0; background: #fff; -webkit-print-color-adjust: exact; print-color-adjust: exact; }',
    'table { border-collapse: collapse; }',
    'td, th { box-sizing: border-box; overflow: hidden; }',
    '.opd-generator-wrap {',
    '  width: 210mm; aspect-ratio: 210 / 297; height: auto;',
    '  position: relative; background: #ffffff;',
    '  container-type: inline-size; overflow: hidden;',
    '}',
    '.template-editor-canvas { position: relative; width: 100%; height: 100%; }',
    '.template-editor-canvas img {',
    '  position: absolute; left: 0; top: 0; width: 100%; height: 100%;',
    '  display: ' + imgDisplay + '; object-fit: fill; z-index: 1;',
    '}',
    '.field-box {',
    '  position: absolute; padding: 4px 6px; color: #000;',
    '  font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;',
    '  background: transparent; z-index: 2;',
    '}',
    '.field-box--slip-row {',
    '  display: flex; flex-direction: row; align-items: baseline; gap: 0.55em;',
    '  max-width: 100%;',
    '}',
    '.field-box-slip-label {',
    '  flex: 0 0 var(--opd-slip-label-ch, max-content);',
    '  width: var(--opd-slip-label-ch, max-content);',
    '  min-width: 0; text-align: right; white-space: nowrap; box-sizing: border-box;',
    '  padding-inline-end: 0.4ch;',
    '}',
    '.field-box-value-text, .field-box-value-slot {',
    '  flex: 1 1 auto; min-width: 0; text-align: right; white-space: nowrap;',
    '}',
    '.field-box-value-text { font-style: normal; font-weight: inherit; opacity: 1; }',
    '.field-box-preview-part { opacity: 0.42; font-style: italic; font-weight: 400; }',
    '.opd-printed-at {',
    '  position: absolute; bottom: 2mm; right: 3mm; font-size: 8px; color: #555;',
    '  z-index: 6; font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;',
    '}',
    '.opd-sheet-chrome {',
    '  display: ' + chromeDisplay + '; position: absolute; inset: 0; z-index: 0;',
    '  flex-direction: column; font-family: Arial, Helvetica, sans-serif;',
    '  color: #111; overflow: hidden; font-size: 8px;',
    '}',
    '.opd-sheet--with-bg .opd-sheet-chrome { display: none !important; }',
    '.opd-header { flex-shrink:0; background:linear-gradient(180deg,#0f766e 0%,#0d5c55 100%); color:#fff; padding:0.9em 1em 0.75em; }',
    '.opd-header-brand { display:flex; align-items:center; gap:0.75em; }',
    '.opd-logo-icon { width:2.8em; height:2.8em; display:block; border-radius:0.35em; }',
    '.opd-hospital-name { font-weight:800; font-size:1.6em; letter-spacing:0.04em; line-height:1.1; }',
    '.opd-hospital-meta { margin-top:0.35em; font-size:1em; opacity:0.95; line-height:1.35; }',
    '.opd-patient-section { flex-shrink:0; display:grid; grid-template-columns:1fr 1fr; gap:0.6em 1.25em; padding:0.65em 1em; background:#fff; border-bottom:1px solid #d1d5db; }',
    '.opd-field-line { display:flex; align-items:baseline; gap:0.35em; min-height:1.5em; }',
    '.opd-lbl { font-weight:700; font-size:1.05em; white-space:nowrap; color:#111827; }',
    '.opd-dots { flex:1; border-bottom:1px dotted #6b7280; min-height:0.85em; }',
    '.opd-mid-panel { flex:1; min-height:0; display:flex; flex-direction:column; padding:0.5em 0.65em 0.35em; background:#fff; }',
    '.opd-mid-grid { flex:1; display:grid; grid-template-columns:1fr 1.4fr 1fr; gap:0.35em; min-height:8em; }',
    '.opd-mid-cell { border:1px solid #374151; padding:0.35em 0.4em; background:#fafafa; }',
    '.opd-mid-title { display:block; font-weight:700; font-size:0.95em; margin-bottom:0.5em; color:#111827; }',
    '.opd-mid-list { margin:0; padding-left:1.1em; font-size:0.95em; line-height:1.35; color:#374151; }',
    '.opd-mid-placeholder { margin:0.25em 0 0; font-size:0.9em; line-height:1.3; color:#4b5563; }',
    '.opd-pain-scale { margin-top:0.5em; font-size:0.85em; }',
    '.opd-pain-bar { height:0.4em; margin-top:0.25em; background:linear-gradient(90deg,#22c55e 0%,#eab308 40%,#eab308 60%,#dc2626 100%); border-radius:2px; border:1px solid #9ca3af; }',
    '.opd-mid-bottom { display:grid; grid-template-columns:1fr 1fr; gap:0.35em; margin-top:0.35em; }',
    '.opd-mid-wide { border:1px solid #374151; min-height:2.5em; padding:0.3em 0.4em; font-size:0.95em; font-weight:600; color:#111827; background:#f9fafb; }',
    '.opd-watermark { position:absolute; left:50%; top:52%; transform:translate(-50%,-50%) rotate(-18deg); font-size:clamp(14px,4.5cqw,28px); font-weight:900; color:rgba(15,118,110,0.08); white-space:nowrap; z-index:0; pointer-events:none; font-family:Arial,Helvetica,sans-serif; letter-spacing:0.08em; }',
    '.opd-sheet-footer { flex-shrink:0; margin-top:auto; }',
    '.opd-disclaimer { margin:0; padding:0.35em 0.65em 0.25em; font-size:0.85em; line-height:1.35; color:#374151; background:#fff; }',
    '.opd-bar-grey { display:flex; justify-content:space-between; align-items:center; gap:0.5em; padding:0.35em 0.65em; background:#d1d5db; font-size:0.95em; color:#111827; }',
    '.opd-bar-hindi { flex:1; line-height:1.3; }',
    '.opd-bar-mlc { font-weight:700; white-space:nowrap; }',
    '.opd-bar-teal { height:0.55em; background:#0f766e; }',
    '@media print {',
    '  @page { size: A4 portrait; margin: 0; marks: none; }',
    '  html, body { margin: 0 !important; padding: 0 !important; }',
    '  .opd-generator-wrap { width: 210mm !important; }',
    '}',
    '</style>',
    '</head>',
    '<body>',
    '<div class="opd-generator-wrap">',
    '  <div class="' + sheetClass + '"' + slipLabelChStyle + '>',
    '    ' + bgTag,
    '    <div class="opd-sheet-chrome" aria-hidden="true">',
    '      <header class="opd-header">',
    '        <div class="opd-header-brand">',
    '          <span class="opd-logo-wrap">',
    '            <svg class="opd-logo-icon" viewBox="0 0 32 32" aria-hidden>',
    '              <rect fill="#ffffff" rx="4" width="32" height="32"/>',
    '              <path fill="#dc2626" d="M14 8h4v8h8v4h-8v8h-4v-8H6v-4h8z"/>',
    '            </svg>',
    '          </span>',
    '          <div class="opd-header-text">',
    '            <div class="opd-hospital-name">VARDAAN HOSPITAL</div>',
    '            <div class="opd-hospital-meta">Near oxford School, Rohtak By Pass Road, JIND M. +91 99924-25764, +91 70828-77717</div>',
    '          </div>',
    '        </div>',
    '      </header>',
    '      <section class="opd-patient-section">',
    '        <div class="opd-patient-col">',
    '          <div class="opd-field-line"><span class="opd-lbl">OPD No</span><span class="opd-dots"></span></div>',
    '          <div class="opd-field-line"><span class="opd-lbl">Patient Name</span><span class="opd-dots"></span></div>',
    '          <div class="opd-field-line"><span class="opd-lbl">Age / Sex</span><span class="opd-dots"></span></div>',
    '          <div class="opd-field-line"><span class="opd-lbl">Guardian Name</span><span class="opd-dots"></span></div>',
    '          <div class="opd-field-line"><span class="opd-lbl">Address</span><span class="opd-dots"></span></div>',
    '        </div>',
    '        <div class="opd-patient-col">',
    '          <div class="opd-field-line"><span class="opd-lbl">Date</span><span class="opd-dots"></span></div>',
    '          <div class="opd-field-line"><span class="opd-lbl">Doctor</span><span class="opd-dots"></span></div>',
    '          <div class="opd-field-line"><span class="opd-lbl">Reg. No.</span><span class="opd-dots"></span></div>',
    '          <div class="opd-field-line"><span class="opd-lbl">Amount</span><span class="opd-dots"></span></div>',
    '          <div class="opd-field-line"><span class="opd-lbl">Mobile</span><span class="opd-dots"></span></div>',
    '        </div>',
    '      </section>',
    '      <div class="opd-mid-panel">',
    '        <div class="opd-mid-grid">',
    '          <div class="opd-mid-cell opd-mid-vitals">',
    '            <span class="opd-mid-title">Vital assessment</span>',
    '            <ul class="opd-mid-list"><li>BP</li><li>PR</li><li>Temp</li><li>RR</li><li>SPO2</li><li>Wt. / Ht. / BMI</li></ul>',
    '          </div>',
    '          <div class="opd-mid-cell opd-mid-center">',
    '            <span class="opd-mid-title">CO-Morbidities &amp; screening</span>',
    '            <p class="opd-mid-placeholder">DM &middot; HTN &middot; CAD &middot; COPD &middot; CVA &middot; THYROID &middot; Nutritional screening</p>',
    '            <div class="opd-pain-scale"><span>Pain 0 &mdash; 10</span><div class="opd-pain-bar"></div></div>',
    '          </div>',
    '          <div class="opd-mid-cell opd-mid-side">',
    '            <span class="opd-mid-title">Allergy &amp; addiction</span>',
    '            <p class="opd-mid-placeholder">Drug &middot; Food &middot; Others &middot; Smoking &middot; Alcohol</p>',
    '          </div>',
    '        </div>',
    '        <div class="opd-mid-bottom">',
    '          <div class="opd-mid-wide">Chief complaints</div>',
    '          <div class="opd-mid-wide">Preventive / special advice</div>',
    '        </div>',
    '      </div>',
    '      <div class="opd-watermark">VARDAAN HOSPITAL</div>',
    '      <footer class="opd-sheet-footer">',
    '        <p class="opd-disclaimer">Prescribed Medicines are only suggestions, patient is free to choose any reliable generic/brand of their choice with exactly the same content.</p>',
    '        <div class="opd-bar-grey">',
    '          <span class="opd-bar-hindi">\u0915\u0943\u092a\u092f\u093e \u0905\u0917\u0932\u0940 \u092c\u093e\u0930 \u092a\u0941\u0930\u093e\u0085\u0928\u0940 \u092a\u0930\u094d\u091a\u0940 \u0935 \u0930\u093f\u092a\u094b\u0930\u094d\u091f\u0938 \u0938\u093e\u0925 \u0932\u093e\u090f\u0902</span>',
    '          <span class="opd-bar-mlc">&#10022; Not Valid For MLC</span>',
    '        </div>',
    '        <div class="opd-bar-teal"></div>',
    '      </footer>',
    '    </div>',
    '    ' + shapeBoxes,
    '    ' + tableBoxes,
    '    ' + fieldBoxes,
    '    ' + noteBoxes,
    '    ' + rxBoxHtml,
    '    ' + printedAtHtml,
    '  </div>',
    '</div>',
    '<' + 'script' + '>',
    inlineScript,
    '</' + 'script' + '>',
    '</body>',
    '</html>',
  ]

  return parts.join('\n')
}
