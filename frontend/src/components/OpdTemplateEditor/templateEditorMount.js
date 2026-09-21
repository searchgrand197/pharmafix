// Template editor logic: draggable fields, notes, shapes (boxes/lines), and tables.
// Single layout, saved locally and optionally to backend.

import { computeSlipLabelChCount } from './slipLabelColumn.js';
import { useStyledTableHeaderRow } from './opdTableHeaderRow.js';
import {
  getDefaultOpdFieldConfig,
  normalizeOpdFieldConfig,
  isCoreTemplateField,
  resolveSlipFieldLabel,
} from './opdCoreFields.js';
import { syncCoreFieldsIntoLayout } from './syncCoreFieldsIntoLayout.js';
import { DEFAULT_RX_BOX, normalizeRxBox } from '../../pharmacy/rxBoxDefaults.js';

const CANVAS_W = 1024;
const CANVAS_H = 1451;
const LOCAL_STORAGE_KEY = 'custom-editor-single-layout';

/** Match Create OPD "Phone or UHID" column: `lg:col-span-3` on a 12-col grid → 25% of canvas width. */
const DEFAULT_OPD_FIELD_BOX_WIDTH = Math.round((CANVAS_W * 3) / 12);
/** ~Single-line `text-base` + `py-2` input height, in canvas Y units. */
const DEFAULT_OPD_FIELD_BOX_HEIGHT = 46;

export function mountTemplateEditor(root) {
  if (!root) {
    return {
      dispose() {},
      setOpdFieldConfig() {},
      refreshFieldLabels() {},
    };
  }

  const $ = (id) => root.querySelector(`#${id}`);
  const disposers = [];

  const on = (target, type, fn, opts) => {
    if (!target) return;
    target.addEventListener(type, fn, opts);
    disposers.push(() => {
      try { target.removeEventListener(type, fn, opts); } catch { /* ignore */ }
    });
  };

  // ── DOM refs ────────────────────────────────────────────────────────────────
  const canvasEl        = $('editor-canvas');
  const bgImgEl         = $('editor-bg');
  const bgInput         = $('template-upload');
  const newFieldInput   = $('new-field-name');
  const addFieldBtn     = $('add-field-btn');
  const addNoteBtn      = $('add-note-btn');
  const addBoxBtn       = $('add-box-btn');
  const addHLineBtn     = $('add-hline-btn');
  const addVLineBtn     = $('add-vline-btn');
  const addTableBtn     = $('add-table-btn');
  const addRxBoxBtn     = $('add-rx-box-btn');
  const rxBoxPropsEl    = $('rx-box-props');
  const removeRxBoxBtn  = $('remove-rx-box-btn');
  const rxBoxFontSizeEl = $('rx-box-fontsize');
  const rxBoxShowRxEl   = $('rx-box-show-rx');
  const rxBoxShowCcEl   = $('rx-box-show-cc');
  const rxBoxShowNotesEl = $('rx-box-show-notes');
  const rxBoxShowFupEl  = $('rx-box-show-fup');
  const rxBoxShowQtyEl  = $('rx-box-qty');
  const rxBoxShowTimingEl = $('rx-box-timing');
  const fieldErrorEl    = $('field-error');
  const fieldListEl     = $('field-list');
  const noteListEl      = $('note-list');
  const shapeListEl     = $('shape-list');
  const tableListEl     = $('table-list');
  const saveLayoutBtn   = $('save-layout-btn');
  const saveStatusEl    = $('save-layout-status');
  const layoutJsonEl    = $('layout-json');
  const applyLayoutBtn  = $('apply-layout-btn');
  const copyBtn         = $('copy-layout-btn');
  const copyStatusEl    = $('copy-status');
  const showLabelsToggle = $('show-field-labels-toggle');
  const alignSlipColumnsToggle = $('align-slip-columns-toggle');

  // ── Drag / resize state ─────────────────────────────────────────────────────
  let isDragging = false;
  let dragBox    = null;
  let dragOffsetX = 0;
  let dragOffsetY = 0;

  let isResizing     = false;
  let resizeShapeId  = null;
  let resizeTableId  = null;
  let resizeStartCX  = 0;
  let resizeStartCY  = 0;
  let resizeStartW   = 0;
  let resizeStartH   = 0;
  /** Snapshot while resizing a table (canvas px). */
  let resizeTableStartColWidths = [];
  let resizeTableStartTotalW    = 0;
  let resizeTableStartTotalH    = 0;
  let resizeTableRows           = 2;
  let resizeRxBox                 = false;
  let resizeRxBoxStartW           = 0;
  let resizeRxBoxStartH           = 0;

  // ── Layout model ────────────────────────────────────────────────────────────
  // fields:  { [name]: { x, y, size, width?, height?, bold?, italic?, color? } }
  // notes:   { [id]:   { x, y, size, width?, height?, text, bold?, italic?, color? } }
  // shapes:  { [id]:   { type:'rect'|'line', x, y, ... } }
  // tables:  { [id]:   { x, y, rows, cols, colWidths, rowHeight, headers, ... } }
  // showFieldLabels?: boolean
  // alignSlipFieldColumns?: boolean — fixed-width label column + aligned values (needs showFieldLabels)
  // printOffsetX/Y?: number
  let layout = {
    fields: {},
    notes: {},
    shapes: {},
    tables: {},
    backgroundDataUrl: undefined,
    showFieldLabels: false,
    alignSlipFieldColumns: false,
  };
  let opdFieldConfig = getDefaultOpdFieldConfig();
  let lastSyncedJsonText = '';

  // ── Helpers ─────────────────────────────────────────────────────────────────
  const clamp   = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const toCqw   = (px) => `${((px / 600) * 100).toFixed(4)}cqw`;

  /**
   * Inner size + viewport origin of the canvas padding box (where absolute children anchor at 0,0).
   * Uses border widths from computed style — clientLeft/clientTop are not reliable across engines.
   */
  function getCanvasContentMetrics() {
    if (!canvasEl) return null;
    const rect = canvasEl.getBoundingClientRect();
    const cs = window.getComputedStyle(canvasEl);
    const bl = parseFloat(cs.borderLeftWidth) || 0;
    const bt = parseFloat(cs.borderTopWidth) || 0;
    const innerW = canvasEl.clientWidth;
    const innerH = canvasEl.clientHeight;
    const originLeft = rect.left + bl;
    const originTop = rect.top + bt;
    return { innerW, innerH, originLeft, originTop };
  }
  const escHtml = (s) =>
    String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');

  function applyTextStyle(el, cfg) {
    el.style.fontWeight  = cfg.bold   ? 'bold'   : '';
    el.style.fontStyle   = cfg.italic ? 'italic' : '';
    el.style.color       = cfg.color  || '#000000';
    el.style.textAlign   = 'left';
  }

  function syncOpdSlipLabelChVar() {
    if (!canvasEl) return;
    const names = Object.keys(layout.fields || {});
    if (layout.alignSlipFieldColumns === true && names.length) {
      canvasEl.style.setProperty('--opd-slip-label-ch', `${computeSlipLabelChCount(layout, opdFieldConfig)}ch`);
    } else {
      canvasEl.style.removeProperty('--opd-slip-label-ch');
    }
  }

  /** Editor canvas: slip labels; optional column alignment (layout.alignSlipFieldColumns). */
  function setDynamicFieldEditorContent(el) {
    if (!el || !el.dataset.field) return;
    const name = el.dataset.field;
    const cfg = layout.fields[name] || {};
    const labelText = resolveSlipFieldLabel(name, cfg, layout, opdFieldConfig);
    const columns = layout.alignSlipFieldColumns === true && !!labelText;
    el.classList.toggle('dynamic-field--slip-columns', columns);
    if (columns) {
      el.style.textAlign = 'start';
      const labelSpan = labelText
        ? `<span class="field-box-slip-label">${escHtml(labelText)}</span>`
        : '';
      el.innerHTML =
        labelSpan +
        `<span class="field-box-preview-part field-box-value-slot" aria-hidden="true">${escHtml(name)}</span>`;
    } else if (labelText) {
      el.style.textAlign = '';
      el.textContent = `${labelText}${name}`;
      applyTextStyle(el, cfg);
    } else {
      el.textContent = name;
      applyTextStyle(el, cfg);
    }
  }

  function refreshAllDynamicFieldEditorContents() {
    if (!canvasEl) return;
    canvasEl.querySelectorAll('.field-box.dynamic-field').forEach((el) => {
      setDynamicFieldEditorContent(el);
    });
    syncOpdSlipLabelChVar();
    positionBoxesFromLayout();
  }

  function applyShapeStyle(el, cfg) {
    const x = cfg.x || 0;
    const y = cfg.y || 0;
    el.style.left = `${((x / CANVAS_W) * 100).toFixed(4)}%`;
    el.style.top  = `${((y / CANVAS_H) * 100).toFixed(4)}%`;

    if (cfg.type === 'line') {
      const len   = cfg.length    || 200;
      const thick = cfg.thickness || 1;
      const color = cfg.color     || '#000000';
      const style = cfg.style     || 'solid';
      if (cfg.orientation === 'vertical') {
        el.style.width       = '10px';
        el.style.height      = `${((len / CANVAS_H) * 100).toFixed(4)}%`;
        el.style.borderLeft  = `${thick}px ${style} ${color}`;
        el.style.borderTop   = '';
        el.style.borderRight = '';
        el.style.borderBottom = '';
      } else {
        el.style.height      = '10px';
        el.style.width       = `${((len / CANVAS_W) * 100).toFixed(4)}%`;
        el.style.borderTop   = `${thick}px ${style} ${color}`;
        el.style.borderLeft  = '';
        el.style.borderRight = '';
        el.style.borderBottom = '';
      }
      el.style.backgroundColor = 'transparent';
      el.style.border = undefined; // clear
    } else {
      // rect
      const w  = cfg.width       || 200;
      const h  = cfg.height      || 60;
      const bc = cfg.borderColor || '#000000';
      const bw = cfg.borderWidth || 1;
      const bs = cfg.borderStyle || 'solid';
      const fill = cfg.fillColor || 'transparent';
      const br = cfg.borderRadius || 0;
      el.style.width           = `${((w / CANVAS_W) * 100).toFixed(4)}%`;
      el.style.height          = `${((h / CANVAS_H) * 100).toFixed(4)}%`;
      el.style.border          = `${bw}px ${bs} ${bc}`;
      el.style.backgroundColor = fill;
      el.style.borderRadius    = br ? `${((br / CANVAS_W) * 100).toFixed(4)}%` : '0';
      el.style.boxSizing       = 'border-box';
    }
  }

  function applyTableStyle(el, cfg) {
    const x         = cfg.x || 0;
    const y         = cfg.y || 0;
    const cols      = cfg.cols     || 2;
    const colWidths = cfg.colWidths || Array(cols).fill(200);
    const totalW    = colWidths.reduce((a, b) => a + b, 0);
    const totalH    = (cfg.rows || 2) * (cfg.rowHeight || 50);
    el.style.left   = `${((x / CANVAS_W) * 100).toFixed(4)}%`;
    el.style.top    = `${((y / CANVAS_H) * 100).toFixed(4)}%`;
    el.style.width  = `${((totalW / CANVAS_W) * 100).toFixed(4)}%`;
    el.style.height = `${((totalH / CANVAS_H) * 100).toFixed(4)}%`;
  }

  function rebuildTableHTML(wrapper, cfg) {
    const cols      = cfg.cols      || 2;
    const rows      = cfg.rows      || 2;
    const colWidths = cfg.colWidths || Array(cols).fill(200);
    const totalW    = colWidths.reduce((a, b) => a + b, 0);
    const headers   = cfg.headers   || [];
    const bc        = cfg.borderColor || '#374151';
    const bw        = cfg.borderWidth || 1;
    const hBg       = cfg.headerBg || '#f3f4f6';
    const styledHdr = useStyledTableHeaderRow(cfg);

    let html = '<table style="border-collapse:collapse;width:100%;height:100%;table-layout:fixed;">';
    for (let ri = 0; ri < rows; ri++) {
      const rowH = ((100 / rows).toFixed(2)) + '%';
      html += `<tr style="height:${rowH}">`;
      for (let ci = 0; ci < cols; ci++) {
        const isHdr = styledHdr && ri === 0;
        const hText = isHdr ? escHtml(headers[ci] || '') : '';
        const bg    = isHdr ? hBg : 'transparent';
        const fw    = isHdr ? '600' : 'normal';
        const colPct = ((colWidths[ci] / totalW) * 100).toFixed(2) + '%';
        html += `<td style="width:${colPct};border:${bw}px solid ${bc};background:${bg};font-weight:${fw};font-size:9px;padding:1px 3px;overflow:hidden;color:#000;">${hText}</td>`;
      }
      html += '</tr>';
    }
    html += '</table>';
    wrapper.innerHTML = html;
  }

  // ── Persistence ─────────────────────────────────────────────────────────────
  function loadFromLocalStorage() {
    try {
      const raw = window.localStorage.getItem(LOCAL_STORAGE_KEY);
      if (!raw) return;
      const p = JSON.parse(raw);
      const next = normalizeIncomingLayout(p);
      if (!next) return;
      layout = next;
    } catch { /* ignore corrupted data */ }
  }

  function saveToLocalStorage() {
    try { window.localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(layout)); } catch { /* ignore */ }
  }

  async function loadOpdFieldConfig() {
    try {
      const res = await fetch('/api/v1/settings/reception-portal/', { credentials: 'same-origin' });
      if (!res.ok) return;
      const data = await res.json().catch(() => ({}));
      const row = data?.data || data || {};
      opdFieldConfig = normalizeOpdFieldConfig(row.opd_field_config, row.opd_visible_fields);
    } catch { /* keep defaults */ }
  }

  async function loadFromBackend() {
    try {
      const res  = await fetch('/api/templates');
      const data = await res.json().catch(() => ({}));
      const list = Array.isArray(data.templates) ? data.templates : [];
      const single = list.find((t) => t.key === 'single' && t.layout && t.layout.fields);
      if (single) {
        layout = {
          fields: { ...(single.layout.fields || {}) },
          notes:  { ...(single.layout.notes  || {}) },
          shapes: { ...(single.layout.shapes || {}) },
          tables: { ...(single.layout.tables || {}) },
          rx_box: normalizeRxBox(single.layout.rx_box) || undefined,
          backgroundDataUrl: single.layout.backgroundDataUrl || layout.backgroundDataUrl,
          showFieldLabels: typeof single.layout.showFieldLabels === 'boolean'
            ? single.layout.showFieldLabels : false,
          alignSlipFieldColumns: typeof single.layout.alignSlipFieldColumns === 'boolean'
            ? single.layout.alignSlipFieldColumns : false,
        };
        saveToLocalStorage();
      }
    } catch { /* backend may be offline */ }
  }

  // ── JSON / save ─────────────────────────────────────────────────────────────
  function updateJson() {
    const nextJsonText = JSON.stringify({ single: layout }, null, 2);
    lastSyncedJsonText = nextJsonText;
    if (layoutJsonEl) {
      const userIsEditingJson = document.activeElement === layoutJsonEl;
      if (!userIsEditingJson) {
        layoutJsonEl.value = nextJsonText;
      }
    }
    saveToLocalStorage();
  }

  function normalizeIncomingLayout(candidate) {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return null;
    return {
      fields: candidate.fields && typeof candidate.fields === 'object' ? { ...candidate.fields } : {},
      notes: candidate.notes && typeof candidate.notes === 'object' ? { ...candidate.notes } : {},
      shapes: candidate.shapes && typeof candidate.shapes === 'object' ? { ...candidate.shapes } : {},
      tables: candidate.tables && typeof candidate.tables === 'object' ? { ...candidate.tables } : {},
      backgroundDataUrl: candidate.backgroundDataUrl || undefined,
      showFieldLabels: candidate.showFieldLabels === true,
      alignSlipFieldColumns:
        candidate.showFieldLabels === true && candidate.alignSlipFieldColumns === true,
      printOffsetX: typeof candidate.printOffsetX === 'number' ? candidate.printOffsetX : undefined,
      printOffsetY: typeof candidate.printOffsetY === 'number' ? candidate.printOffsetY : undefined,
      rx_box: normalizeRxBox(candidate.rx_box) || undefined,
    };
  }

  function applyLayoutJsonText(raw) {
    if (!layoutJsonEl) return false;
    let parsed = null;
    try {
      parsed = JSON.parse(String(raw || ''));
    } catch {
      if (copyStatusEl) copyStatusEl.textContent = 'Invalid JSON. Please fix formatting.';
      return false;
    }
    const incoming = parsed?.single ?? parsed;
    const next = normalizeIncomingLayout(incoming);
    if (!next) {
      if (copyStatusEl) copyStatusEl.textContent = 'JSON must be an object (or { "single": { ... } }).';
      return false;
    }
    layout = syncCoreFieldsIntoLayout(next, opdFieldConfig);
    if (!layout.showFieldLabels) layout.alignSlipFieldColumns = false;
    syncBackgroundImage();
    if (showLabelsToggle) showLabelsToggle.checked = layout.showFieldLabels === true;
    if (alignSlipColumnsToggle) {
      alignSlipColumnsToggle.disabled = !layout.showFieldLabels;
      alignSlipColumnsToggle.checked =
        layout.showFieldLabels === true && layout.alignSlipFieldColumns === true;
    }
    renderAllFromLayout();
    renderFieldList();
    renderNoteList();
    renderShapeList();
    renderTableList();
    updateJson();
    if (copyStatusEl) copyStatusEl.textContent = 'JSON applied.';
    return true;
  }

  function setSaveStatus(msg, color) {
    if (!saveStatusEl) return;
    saveStatusEl.textContent = msg;
    saveStatusEl.style.color = color || '';
  }

  async function saveLayoutToBackend() {
    try {
      const res  = await fetch('/api/templates/update-layout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ key: 'single', layout }),
      });
      const text = await res.text();
      let data = {};
      try { data = text ? JSON.parse(text) : {}; } catch { data = {}; }
      if (res.ok && data.success) {
        setSaveStatus('Layout saved on server and locally.', '');
      } else {
        const hint = data.error || (res.status === 413
          ? 'Layout too large for the server. Use a smaller background image.'
          : `Save failed (HTTP ${res.status}). Layout is still saved locally.`);
        setSaveStatus(hint, '#b91c1c');
      }
    } catch {
      setSaveStatus('Backend not reachable. Layout saved locally only.', '#b91c1c');
    }
  }

  // ── Canvas rendering ────────────────────────────────────────────────────────
  function positionBoxesFromLayout() {
    if (!canvasEl) return;
    const m = getCanvasContentMetrics();
    if (!m || m.innerW <= 0 || m.innerH <= 0) return;
    const scaleX = m.innerW / CANVAS_W;
    const scaleY = m.innerH / CANVAS_H;

    // Fields and notes: width/height follow text (no fixed “empty” box on the canvas).
    const positionGroup = (selector, getCfg) => {
      canvasEl.querySelectorAll(selector).forEach((box) => {
        const cfg = getCfg(box);
        if (!cfg) return;
        const xC = typeof cfg.x === 'number' ? cfg.x : CANVAS_W / 2;
        const yC = typeof cfg.y === 'number' ? cfg.y : CANVAS_H / 2;
        box.style.width = 'max-content';
        box.style.height = 'auto';
        box.style.boxSizing = 'border-box';
        box.style.overflow = 'visible';
        let left = xC * scaleX;
        let top = yC * scaleY;
        if (xC <= 0) left = 0;
        if (yC <= 0) top = 0;
        box.style.left = `${left}px`;
        box.style.top = `${top}px`;
        box.style.maxWidth = `${Math.max(40, m.innerW)}px`;
        const bwPx = box.offsetWidth;
        const bhPx = Math.max(16, box.offsetHeight);
        left = clamp(left, 0, Math.max(0, m.innerW - bwPx));
        top = clamp(top, 0, Math.max(0, m.innerH - bhPx));
        box.style.left = `${left}px`;
        box.style.top = `${top}px`;
        box.style.maxWidth = `${Math.max(40, m.innerW - left)}px`;
      });
    };
    positionGroup('.field-box.dynamic-field', (b) => layout.fields[b.dataset.field]);
    positionGroup('.field-box.dynamic-note', (b) => layout.notes[b.dataset.note]);

    // Shapes and tables use %-based positioning (applyShapeStyle / applyTableStyle)
    canvasEl.querySelectorAll('.dynamic-shape').forEach((el) => {
      const cfg = layout.shapes[el.dataset.shape];
      if (cfg) applyShapeStyle(el, cfg);
    });
    canvasEl.querySelectorAll('.dynamic-table').forEach((el) => {
      const cfg = layout.tables[el.dataset.table];
      if (cfg) applyTableStyle(el, cfg);
    });
    canvasEl.querySelectorAll('.dynamic-rx-box').forEach((el) => {
      if (layout.rx_box) applyRxBoxStyle(el, layout.rx_box);
    });
  }

  function updateLayoutFromBox(box) {
    if (!canvasEl) return;
    const innerW = canvasEl.clientWidth;
    const innerH = canvasEl.clientHeight;
    if (innerW <= 0 || innerH <= 0) return;

    let leftPx;
    let topPx;
    if (box.offsetParent === canvasEl) {
      leftPx = box.offsetLeft;
      topPx = box.offsetTop;
    } else {
      const m = getCanvasContentMetrics();
      if (!m) return;
      const boxRect = box.getBoundingClientRect();
      leftPx = boxRect.left - m.originLeft;
      topPx = boxRect.top - m.originTop;
    }

    const SNAP = 2;
    if (Math.abs(leftPx) < SNAP) leftPx = 0;
    if (Math.abs(topPx) < SNAP) topPx = 0;

    const xC = clamp(Math.round((leftPx / innerW) * CANVAS_W), 0, CANVAS_W);
    const yC = clamp(Math.round((topPx / innerH) * CANVAS_H), 0, CANVAS_H);

    if (box.dataset.field) {
      const n = box.dataset.field;
      if (!layout.fields[n]) layout.fields[n] = {};
      layout.fields[n].x = Math.round(xC);
      layout.fields[n].y = Math.round(yC);
    } else if (box.dataset.note) {
      const id = box.dataset.note;
      if (!layout.notes[id]) layout.notes[id] = {};
      layout.notes[id].x = Math.round(xC);
      layout.notes[id].y = Math.round(yC);
    } else if (box.dataset.shape) {
      const id = box.dataset.shape;
      if (!layout.shapes[id]) layout.shapes[id] = {};
      layout.shapes[id].x = Math.round(xC);
      layout.shapes[id].y = Math.round(yC);
    } else if (box.dataset.table) {
      const id = box.dataset.table;
      if (!layout.tables[id]) layout.tables[id] = {};
      layout.tables[id].x = Math.round(xC);
      layout.tables[id].y = Math.round(yC);
    } else if (box.dataset.rxbox) {
      if (!layout.rx_box) layout.rx_box = { ...DEFAULT_RX_BOX };
      layout.rx_box.x = Math.round(xC);
      layout.rx_box.y = Math.round(yC);
    }
  }

  // ── Element creators ────────────────────────────────────────────────────────
  function createBoxElement(name) {
    if (!canvasEl) return null;
    const el = document.createElement('div');
    el.className    = 'field-box dynamic-field';
    el.dataset.field = name;
    const cfg = layout.fields[name] || {};
    el.style.fontSize = toCqw(cfg.size ?? 13);
    applyTextStyle(el, cfg);
    canvasEl.appendChild(el);
    setDynamicFieldEditorContent(el);
    return el;
  }

  function createNoteElement(id) {
    if (!canvasEl) return null;
    const el = document.createElement('div');
    el.className   = 'field-box dynamic-note';
    el.dataset.note = id;
    const cfg = layout.notes[id] || {};
    el.textContent  = cfg.text || '';
    el.style.fontSize = toCqw(cfg.size ?? 11);
    applyTextStyle(el, cfg);
    canvasEl.appendChild(el);
    return el;
  }

  function createShapeElement(id) {
    if (!canvasEl) return null;
    const cfg = layout.shapes[id];
    if (!cfg) return null;
    const el = document.createElement('div');
    el.className     = 'dynamic-shape';
    el.dataset.shape = id;
    applyShapeStyle(el, cfg);
    // Resize handle (bottom-right for rect, end for line)
    const handle = document.createElement('div');
    handle.className = 'shape-resize-handle';
    handle.title     = 'Drag to resize';
    el.appendChild(handle);
    canvasEl.appendChild(el);
    return el;
  }

  function createTableElement(id) {
    if (!canvasEl) return null;
    const cfg = layout.tables[id];
    if (!cfg) return null;
    const el = document.createElement('div');
    el.className = 'dynamic-table';
    el.dataset.table = id;
    const inner = document.createElement('div');
    inner.className = 'dynamic-table-inner';
    el.appendChild(inner);
    rebuildTableHTML(inner, cfg);
    applyTableStyle(el, cfg);
    const handle = document.createElement('div');
    handle.className = 'shape-resize-handle';
    handle.title = 'Drag to resize table';
    el.appendChild(handle);
    canvasEl.appendChild(el);
    return el;
  }

  function applyRxBoxStyle(el, cfg) {
    const x = cfg.x || 0;
    const y = cfg.y || 0;
    const w = cfg.width || DEFAULT_RX_BOX.width;
    const h = cfg.height || DEFAULT_RX_BOX.height;
    el.style.left = `${((x / CANVAS_W) * 100).toFixed(4)}%`;
    el.style.top = `${((y / CANVAS_H) * 100).toFixed(4)}%`;
    el.style.width = `${((w / CANVAS_W) * 100).toFixed(4)}%`;
    el.style.height = `${((h / CANVAS_H) * 100).toFixed(4)}%`;
    el.style.boxSizing = 'border-box';
    const fs = cfg.fontSize || DEFAULT_RX_BOX.fontSize;
    el.style.fontSize = toCqw(fs);
  }

  function createRxBoxElement() {
    if (!canvasEl || !layout.rx_box) return null;
    const existing = canvasEl.querySelector('.dynamic-rx-box');
    if (existing) existing.remove();
    const cfg = layout.rx_box;
    const el = document.createElement('div');
    el.className = 'dynamic-rx-box';
    el.dataset.rxbox = 'prescription';
    const inner = document.createElement('div');
    inner.className = 'dynamic-rx-box-inner';
    inner.innerHTML = [
      '<div class="dynamic-rx-box-title">Rx Prescription Area</div>',
      '<div class="dynamic-rx-box-preview">Chief Complaint · Prescription · Notes · Follow-up</div>',
      '<div class="dynamic-rx-box-sample">Medicine | Dosage | Days | Qty | Timing</div>',
    ].join('');
    el.appendChild(inner);
    applyRxBoxStyle(el, cfg);
    const handle = document.createElement('div');
    handle.className = 'shape-resize-handle';
    handle.title = 'Drag to resize prescription box';
    el.appendChild(handle);
    canvasEl.appendChild(el);
    return el;
  }

  function syncRxBoxPropsPanel() {
    const hasBox = !!layout.rx_box;
    if (addRxBoxBtn) {
      addRxBoxBtn.textContent = hasBox ? 'Edit Prescription Box' : '+ Prescription Box';
    }
    if (rxBoxPropsEl) rxBoxPropsEl.style.display = hasBox ? 'block' : 'none';
    if (!hasBox) return;
    const cfg = layout.rx_box;
    if (rxBoxFontSizeEl) rxBoxFontSizeEl.value = String(cfg.fontSize ?? DEFAULT_RX_BOX.fontSize);
    if (rxBoxShowRxEl) rxBoxShowRxEl.checked = cfg.showRx !== false;
    if (rxBoxShowCcEl) rxBoxShowCcEl.checked = cfg.showChiefComplaint !== false;
    if (rxBoxShowNotesEl) rxBoxShowNotesEl.checked = cfg.showNotes !== false;
    if (rxBoxShowFupEl) rxBoxShowFupEl.checked = cfg.showFollowUp !== false;
    if (rxBoxShowQtyEl) rxBoxShowQtyEl.checked = cfg.showQty !== false;
    if (rxBoxShowTimingEl) rxBoxShowTimingEl.checked = cfg.showTiming !== false;
  }

  function addRxBox() {
    if (!layout.rx_box) {
      layout.rx_box = { ...DEFAULT_RX_BOX };
    }
    createRxBoxElement();
    syncRxBoxPropsPanel();
    updateJson();
  }

  function removeRxBox() {
    layout.rx_box = undefined;
    canvasEl?.querySelector('.dynamic-rx-box')?.remove();
    syncRxBoxPropsPanel();
    updateJson();
  }

  function getTableInnerEl(tableWrapper) {
    return tableWrapper?.querySelector?.('.dynamic-table-inner') || tableWrapper;
  }

  function renderAllFromLayout() {
    if (!canvasEl) return;
    canvasEl.querySelectorAll(
      '.field-box.dynamic-field, .field-box.dynamic-note, .dynamic-shape, .dynamic-table, .dynamic-rx-box'
    ).forEach((el) => el.remove());

    Object.keys(layout.fields || {}).forEach((n)  => createBoxElement(n));
    Object.keys(layout.notes  || {}).forEach((id) => createNoteElement(id));
    Object.keys(layout.shapes || {}).forEach((id) => createShapeElement(id));
    Object.keys(layout.tables || {}).forEach((id) => createTableElement(id));
    if (layout.rx_box) createRxBoxElement();

    positionBoxesFromLayout();
    syncOpdSlipLabelChVar();
    syncRxBoxPropsPanel();
  }

  // ── Error helpers ───────────────────────────────────────────────────────────
  const clearFieldError = () => { if (fieldErrorEl) fieldErrorEl.textContent = ''; };
  const setFieldError   = (m) => { if (fieldErrorEl) fieldErrorEl.textContent = m; };

  // ── Sidebar: Fields ─────────────────────────────────────────────────────────
  function renderFieldList() {
    if (!fieldListEl) return;
    const names = Object.keys(layout.fields || {});
    if (!names.length) {
      fieldListEl.innerHTML = '<p class="field-hint">No fields yet. Add one above.</p>';
      return;
    }
    fieldListEl.innerHTML = names.map((name) => {
      const cfg  = layout.fields[name] || {};
      const size = cfg.size ?? 13;
      const n    = escHtml(name);
      const boldActive   = cfg.bold   ? ' active' : '';
      const italicActive = cfg.italic ? ' active' : '';
      const color        = cfg.color  || '#000000';
      const showLabel    = cfg.showLabel !== false;
      const labelText    = escHtml(cfg.label || name);
      const labelControls = cfg.system
        ? '<span class="field-hint" style="margin:4px 0 0;">Label controls are managed under Core fields.</span>'
        : `<div class="field-label-controls" style="display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-top:6px;">
            <label style="display:flex;align-items:center;gap:4px;font-size:12px;">
              <input type="checkbox" data-field-show-label="${n}" ${showLabel ? 'checked' : ''} />
              Show label
            </label>
            <input type="text" class="field-size-input" data-field-label-text="${n}" value="${labelText}" placeholder="Label text" title="Label text" style="flex:1;min-width:120px;" />
          </div>`;
      return `
        <div class="value-row value-row--stacked">
          <div style="display:flex;justify-content:space-between;align-items:center;gap:4px;">
            <span style="min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${n}${cfg.system ? ' <span style="font-size:10px;color:#6b7280;">(core)</span>' : ''}</span>
            <div class="value-row-controls">
              <button type="button" class="size-toggle" data-field-edit="${n}" title="Rename">✎</button>
              <button type="button" class="size-toggle" data-field-up="${n}" title="Move up">↑</button>
              <button type="button" class="size-toggle" data-field-down="${n}" title="Move down">↓</button>
              <input type="number" class="field-size-input" data-field-size="${n}" min="8" max="72" step="1" value="${size}" title="Font size">
              <button type="button" class="size-toggle" data-remove-field="${n}" title="Remove">×</button>
            </div>
          </div>
          <div class="style-controls">
            <button type="button" class="style-btn${boldActive}"   data-field-bold="${n}"   title="Bold"><b>B</b></button>
            <button type="button" class="style-btn${italicActive}" data-field-italic="${n}" title="Italic"><i>I</i></button>
            <input type="color" class="style-color" data-field-color="${n}" value="${color}" title="Text color">
          </div>
          ${labelControls}
        </div>`;
    }).join('');

    // Remove
    fieldListEl.querySelectorAll('[data-remove-field]').forEach((btn) => {
      const fn = btn.getAttribute('data-remove-field');
      on(btn, 'click', () => {
        if (layout.fields[fn]?.system) {
          setFieldError('Core fields can only be removed from the slip in the Core fields panel.');
          return;
        }
        delete layout.fields[fn];
        canvasEl?.querySelector(`.field-box.dynamic-field[data-field="${CSS.escape(fn)}"]`)?.remove();
        renderFieldList();
        syncOpdSlipLabelChVar();
        updateJson();
      });
    });

    // Rename
    fieldListEl.querySelectorAll('[data-field-edit]').forEach((btn) => {
      const cur = btn.getAttribute('data-field-edit');
      on(btn, 'click', () => {
        const next = window.prompt('Edit field name', cur);
        if (!next || next === cur) return;
        if (!layout.fields[cur]) return;
        if (layout.fields[cur]?.system) {
          setFieldError('Core fields cannot be renamed.');
          return;
        }
        if (isCoreTemplateField(next)) {
          setFieldError('That name is reserved for a core OPD field.');
          return;
        }
        if (layout.fields[next]) { setFieldError('A field with that name already exists.'); return; }
        layout.fields[next] = layout.fields[cur];
        delete layout.fields[cur];
        const box = canvasEl?.querySelector(`.field-box.dynamic-field[data-field="${CSS.escape(cur)}"]`);
        if (box) {
          box.dataset.field = next;
          setDynamicFieldEditorContent(box);
        }
        renderFieldList();
        syncOpdSlipLabelChVar();
        positionBoxesFromLayout();
        updateJson();
      });
    });

    // Reorder
    const reorderFields = (order) => {
      const next = {};
      order.forEach((k) => { if (layout.fields[k]) next[k] = layout.fields[k]; });
      layout.fields = next;
    };
    fieldListEl.querySelectorAll('[data-field-up]').forEach((btn) => {
      const name = btn.getAttribute('data-field-up');
      on(btn, 'click', () => {
        const order = Object.keys(layout.fields);
        const idx = order.indexOf(name);
        if (idx <= 0) return;
        [order[idx - 1], order[idx]] = [order[idx], order[idx - 1]];
        reorderFields(order); renderFieldList(); updateJson();
      });
    });
    fieldListEl.querySelectorAll('[data-field-down]').forEach((btn) => {
      const name = btn.getAttribute('data-field-down');
      on(btn, 'click', () => {
        const order = Object.keys(layout.fields);
        const idx = order.indexOf(name);
        if (idx === -1 || idx >= order.length - 1) return;
        [order[idx + 1], order[idx]] = [order[idx], order[idx + 1]];
        reorderFields(order); renderFieldList(); updateJson();
      });
    });

    // Font size
    fieldListEl.querySelectorAll('[data-field-size]').forEach((inp) => {
      const fn = inp.getAttribute('data-field-size');
      on(inp, 'input', () => {
        const v = Number(inp.value);
        if (!Number.isFinite(v) || v <= 0) return;
        if (!layout.fields[fn]) layout.fields[fn] = {};
        layout.fields[fn].size = v;
        const box = canvasEl?.querySelector(`.field-box.dynamic-field[data-field="${CSS.escape(fn)}"]`);
        if (box) box.style.fontSize = toCqw(v);
        positionBoxesFromLayout();
        updateJson();
      });
    });

    // Bold
    fieldListEl.querySelectorAll('[data-field-bold]').forEach((btn) => {
      const fn = btn.getAttribute('data-field-bold');
      on(btn, 'click', () => {
        if (!layout.fields[fn]) return;
        layout.fields[fn].bold = !layout.fields[fn].bold;
        const box = canvasEl?.querySelector(`.field-box.dynamic-field[data-field="${CSS.escape(fn)}"]`);
        if (box) applyTextStyle(box, layout.fields[fn]);
        renderFieldList();
        positionBoxesFromLayout();
        updateJson();
      });
    });

    // Italic
    fieldListEl.querySelectorAll('[data-field-italic]').forEach((btn) => {
      const fn = btn.getAttribute('data-field-italic');
      on(btn, 'click', () => {
        if (!layout.fields[fn]) return;
        layout.fields[fn].italic = !layout.fields[fn].italic;
        const box = canvasEl?.querySelector(`.field-box.dynamic-field[data-field="${CSS.escape(fn)}"]`);
        if (box) applyTextStyle(box, layout.fields[fn]);
        renderFieldList();
        positionBoxesFromLayout();
        updateJson();
      });
    });

    // Color
    fieldListEl.querySelectorAll('[data-field-color]').forEach((inp) => {
      const fn = inp.getAttribute('data-field-color');
      on(inp, 'input', () => {
        if (!layout.fields[fn]) return;
        layout.fields[fn].color = inp.value;
        const box = canvasEl?.querySelector(`.field-box.dynamic-field[data-field="${CSS.escape(fn)}"]`);
        if (box) applyTextStyle(box, layout.fields[fn]);
        positionBoxesFromLayout();
        updateJson();
      });
    });

    fieldListEl.querySelectorAll('[data-field-show-label]').forEach((inp) => {
      const fn = inp.getAttribute('data-field-show-label');
      on(inp, 'change', () => {
        if (!layout.fields[fn] || layout.fields[fn].system) return;
        layout.fields[fn] = { ...layout.fields[fn], showLabel: inp.checked };
        const box = canvasEl?.querySelector(`.field-box.dynamic-field[data-field="${CSS.escape(fn)}"]`);
        if (box) setDynamicFieldEditorContent(box);
        syncOpdSlipLabelChVar();
        positionBoxesFromLayout();
        updateJson();
      });
    });

    fieldListEl.querySelectorAll('[data-field-label-text]').forEach((inp) => {
      const fn = inp.getAttribute('data-field-label-text');
      const applyLabel = () => {
        if (!layout.fields[fn] || layout.fields[fn].system) return;
        const next = String(inp.value || '').trim() || fn;
        layout.fields[fn] = { ...layout.fields[fn], label: next, showLabel: layout.fields[fn].showLabel !== false };
        const box = canvasEl?.querySelector(`.field-box.dynamic-field[data-field="${CSS.escape(fn)}"]`);
        if (box) setDynamicFieldEditorContent(box);
        syncOpdSlipLabelChVar();
        positionBoxesFromLayout();
        updateJson();
      };
      on(inp, 'change', applyLabel);
      on(inp, 'blur', applyLabel);
    });
  }

  // ── Sidebar: Notes ──────────────────────────────────────────────────────────
  function renderNoteList() {
    if (!noteListEl) return;
    const ids = Object.keys(layout.notes || {});
    if (!ids.length) {
      noteListEl.innerHTML = '<p class="field-hint">No notes yet. Add one above.</p>';
      return;
    }
    noteListEl.innerHTML = ids.map((id) => {
      const cfg  = layout.notes[id] || {};
      const size = cfg.size ?? 11;
      const text = escHtml(cfg.text || '(empty note)');
      const boldActive   = cfg.bold   ? ' active' : '';
      const italicActive = cfg.italic ? ' active' : '';
      const color        = cfg.color  || '#000000';
      return `
        <div class="value-row value-row--stacked">
          <div style="display:flex;justify-content:space-between;align-items:center;gap:4px;">
            <span style="min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${text}</span>
            <div class="value-row-controls">
              <button type="button" class="size-toggle" data-note-edit="${id}" title="Edit text">✎</button>
              <button type="button" class="size-toggle" data-note-up="${id}" title="Move up">↑</button>
              <button type="button" class="size-toggle" data-note-down="${id}" title="Move down">↓</button>
              <input type="number" class="field-size-input" data-note-size="${id}" min="8" max="72" step="1" value="${size}" title="Font size">
              <button type="button" class="size-toggle" data-remove-note="${id}" title="Remove">×</button>
            </div>
          </div>
          <div class="style-controls">
            <button type="button" class="style-btn${boldActive}"   data-note-bold="${id}"   title="Bold"><b>B</b></button>
            <button type="button" class="style-btn${italicActive}" data-note-italic="${id}" title="Italic"><i>I</i></button>
            <input type="color" class="style-color" data-note-color="${id}" value="${color}" title="Text color">
          </div>
        </div>`;
    }).join('');

    // Remove
    noteListEl.querySelectorAll('[data-remove-note]').forEach((btn) => {
      const id = btn.getAttribute('data-remove-note');
      on(btn, 'click', () => {
        delete layout.notes[id];
        canvasEl?.querySelector(`.field-box.dynamic-note[data-note="${CSS.escape(id)}"]`)?.remove();
        renderNoteList(); updateJson();
      });
    });

    // Edit text
    noteListEl.querySelectorAll('[data-note-edit]').forEach((btn) => {
      const id = btn.getAttribute('data-note-edit');
      on(btn, 'click', () => {
        const cfg  = layout.notes[id] || {};
        const next = window.prompt('Edit note text', cfg.text || '');
        if (next == null) return;
        layout.notes[id] = { ...cfg, text: next };
        const box = canvasEl?.querySelector(`.field-box.dynamic-note[data-note="${CSS.escape(id)}"]`);
        if (box) box.textContent = next;
        renderNoteList();
        positionBoxesFromLayout();
        updateJson();
      });
    });

    // Reorder
    const reorderNotes = (order) => {
      const next = {};
      order.forEach((k) => { if (layout.notes[k]) next[k] = layout.notes[k]; });
      layout.notes = next;
    };
    noteListEl.querySelectorAll('[data-note-up]').forEach((btn) => {
      const id = btn.getAttribute('data-note-up');
      on(btn, 'click', () => {
        const order = Object.keys(layout.notes);
        const idx = order.indexOf(id);
        if (idx <= 0) return;
        [order[idx - 1], order[idx]] = [order[idx], order[idx - 1]];
        reorderNotes(order); renderNoteList(); updateJson();
      });
    });
    noteListEl.querySelectorAll('[data-note-down]').forEach((btn) => {
      const id = btn.getAttribute('data-note-down');
      on(btn, 'click', () => {
        const order = Object.keys(layout.notes);
        const idx = order.indexOf(id);
        if (idx === -1 || idx >= order.length - 1) return;
        [order[idx + 1], order[idx]] = [order[idx], order[idx + 1]];
        reorderNotes(order); renderNoteList(); updateJson();
      });
    });

    // Font size
    noteListEl.querySelectorAll('[data-note-size]').forEach((inp) => {
      const id = inp.getAttribute('data-note-size');
      on(inp, 'input', () => {
        const v = Number(inp.value);
        if (!Number.isFinite(v) || v <= 0) return;
        layout.notes[id] = { ...(layout.notes[id] || {}), size: v };
        const box = canvasEl?.querySelector(`.field-box.dynamic-note[data-note="${CSS.escape(id)}"]`);
        if (box) box.style.fontSize = toCqw(v);
        positionBoxesFromLayout();
        updateJson();
      });
    });

    // Bold
    noteListEl.querySelectorAll('[data-note-bold]').forEach((btn) => {
      const id = btn.getAttribute('data-note-bold');
      on(btn, 'click', () => {
        if (!layout.notes[id]) return;
        layout.notes[id].bold = !layout.notes[id].bold;
        const box = canvasEl?.querySelector(`.field-box.dynamic-note[data-note="${CSS.escape(id)}"]`);
        if (box) applyTextStyle(box, layout.notes[id]);
        renderNoteList();
        positionBoxesFromLayout();
        updateJson();
      });
    });

    // Italic
    noteListEl.querySelectorAll('[data-note-italic]').forEach((btn) => {
      const id = btn.getAttribute('data-note-italic');
      on(btn, 'click', () => {
        if (!layout.notes[id]) return;
        layout.notes[id].italic = !layout.notes[id].italic;
        const box = canvasEl?.querySelector(`.field-box.dynamic-note[data-note="${CSS.escape(id)}"]`);
        if (box) applyTextStyle(box, layout.notes[id]);
        renderNoteList();
        positionBoxesFromLayout();
        updateJson();
      });
    });

    // Color
    noteListEl.querySelectorAll('[data-note-color]').forEach((inp) => {
      const id = inp.getAttribute('data-note-color');
      on(inp, 'input', () => {
        if (!layout.notes[id]) return;
        layout.notes[id].color = inp.value;
        const box = canvasEl?.querySelector(`.field-box.dynamic-note[data-note="${CSS.escape(id)}"]`);
        if (box) applyTextStyle(box, layout.notes[id]);
        positionBoxesFromLayout();
        updateJson();
      });
    });
  }

  // ── Sidebar: Shapes ─────────────────────────────────────────────────────────
  function renderShapeList() {
    if (!shapeListEl) return;
    const ids = Object.keys(layout.shapes || {});
    if (!ids.length) {
      shapeListEl.innerHTML = '<p class="field-hint">No shapes yet. Add a box or line above.</p>';
      return;
    }
    shapeListEl.innerHTML = ids.map((id) => {
      const cfg    = layout.shapes[id] || {};
      const isLine = cfg.type === 'line';
      if (isLine) {
        const label = cfg.orientation === 'vertical' ? 'V-Line' : 'H-Line';
        const color = cfg.color || '#000000';
        const style = cfg.style || 'solid';
        const thick = cfg.thickness || 1;
        const len   = cfg.length || 200;
        return `
          <div class="value-row value-row--stacked">
            <div style="display:flex;justify-content:space-between;align-items:center;gap:4px;">
              <span>${label}</span>
              <div class="value-row-controls">
                <input type="color" class="style-color" data-shape-color="${id}" value="${color}" title="Color">
                <select class="shape-style-select" data-shape-linestyle="${id}" title="Line style">
                  <option value="solid"${style==='solid'?' selected':''}>Solid</option>
                  <option value="dashed"${style==='dashed'?' selected':''}>Dashed</option>
                  <option value="dotted"${style==='dotted'?' selected':''}>Dotted</option>
                </select>
                <button type="button" class="size-toggle" data-remove-shape="${id}" title="Remove">×</button>
              </div>
            </div>
            <div class="style-controls">
              <label style="font-size:11px;color:#6b7280;">Thickness:</label>
              <input type="number" class="field-size-input" data-shape-thick="${id}" min="1" max="20" value="${thick}" style="width:50px;" title="Thickness (px)">
              <label style="font-size:11px;color:#6b7280;">Length:</label>
              <input type="number" class="field-size-input" data-shape-len="${id}" min="10" max="1451" value="${len}" style="width:60px;" title="Length (canvas units)">
            </div>
          </div>`;
      } else {
        const bc   = cfg.borderColor  || '#000000';
        const fill = (cfg.fillColor && cfg.fillColor !== 'transparent') ? cfg.fillColor : '#ffffff';
        const bw   = cfg.borderWidth  || 1;
        const bs   = cfg.borderStyle  || 'solid';
        return `
          <div class="value-row value-row--stacked">
            <div style="display:flex;justify-content:space-between;align-items:center;gap:4px;">
              <span>Box</span>
              <div class="value-row-controls">
                <input type="color" class="style-color" data-shape-border="${id}" value="${bc}" title="Border color">
                <input type="color" class="style-color" data-shape-fill="${id}" value="${fill}" title="Fill color">
                <select class="shape-style-select" data-shape-borderstyle="${id}" title="Border style">
                  <option value="solid"${bs==='solid'?' selected':''}>Solid</option>
                  <option value="dashed"${bs==='dashed'?' selected':''}>Dashed</option>
                  <option value="dotted"${bs==='dotted'?' selected':''}>Dotted</option>
                </select>
                <button type="button" class="size-toggle" data-remove-shape="${id}" title="Remove">×</button>
              </div>
            </div>
            <div class="style-controls">
              <label style="font-size:11px;color:#6b7280;">Border px:</label>
              <input type="number" class="field-size-input" data-shape-bw="${id}" min="0" max="20" value="${bw}" style="width:50px;" title="Border width">
              <label style="font-size:11px;color:#6b7280;">Radius:</label>
              <input type="number" class="field-size-input" data-shape-radius="${id}" min="0" max="200" value="${cfg.borderRadius || 0}" style="width:50px;" title="Border radius">
            </div>
          </div>`;
      }
    }).join('');

    shapeListEl.querySelectorAll('[data-remove-shape]').forEach((btn) => {
      const id = btn.getAttribute('data-remove-shape');
      on(btn, 'click', () => {
        delete layout.shapes[id];
        canvasEl?.querySelector(`.dynamic-shape[data-shape="${CSS.escape(id)}"]`)?.remove();
        renderShapeList(); updateJson();
      });
    });

    const refreshShape = (id) => {
      const el = canvasEl?.querySelector(`.dynamic-shape[data-shape="${CSS.escape(id)}"]`);
      if (el && layout.shapes[id]) applyShapeStyle(el, layout.shapes[id]);
    };

    shapeListEl.querySelectorAll('[data-shape-color]').forEach((inp) => {
      const id = inp.getAttribute('data-shape-color');
      on(inp, 'input', () => {
        if (!layout.shapes[id]) return;
        layout.shapes[id].color = inp.value;
        refreshShape(id); updateJson();
      });
    });
    shapeListEl.querySelectorAll('[data-shape-linestyle]').forEach((sel) => {
      const id = sel.getAttribute('data-shape-linestyle');
      on(sel, 'change', () => {
        if (!layout.shapes[id]) return;
        layout.shapes[id].style = sel.value;
        refreshShape(id); updateJson();
      });
    });
    shapeListEl.querySelectorAll('[data-shape-thick]').forEach((inp) => {
      const id = inp.getAttribute('data-shape-thick');
      on(inp, 'input', () => {
        const v = Number(inp.value);
        if (!Number.isFinite(v) || v < 1) return;
        if (!layout.shapes[id]) return;
        layout.shapes[id].thickness = v;
        refreshShape(id); updateJson();
      });
    });
    shapeListEl.querySelectorAll('[data-shape-len]').forEach((inp) => {
      const id = inp.getAttribute('data-shape-len');
      on(inp, 'input', () => {
        const v = Number(inp.value);
        if (!Number.isFinite(v) || v < 10) return;
        if (!layout.shapes[id]) return;
        layout.shapes[id].length = v;
        refreshShape(id); updateJson();
      });
    });
    shapeListEl.querySelectorAll('[data-shape-border]').forEach((inp) => {
      const id = inp.getAttribute('data-shape-border');
      on(inp, 'input', () => {
        if (!layout.shapes[id]) return;
        layout.shapes[id].borderColor = inp.value;
        refreshShape(id); updateJson();
      });
    });
    shapeListEl.querySelectorAll('[data-shape-fill]').forEach((inp) => {
      const id = inp.getAttribute('data-shape-fill');
      on(inp, 'input', () => {
        if (!layout.shapes[id]) return;
        layout.shapes[id].fillColor = inp.value;
        refreshShape(id); updateJson();
      });
    });
    shapeListEl.querySelectorAll('[data-shape-borderstyle]').forEach((sel) => {
      const id = sel.getAttribute('data-shape-borderstyle');
      on(sel, 'change', () => {
        if (!layout.shapes[id]) return;
        layout.shapes[id].borderStyle = sel.value;
        refreshShape(id); updateJson();
      });
    });
    shapeListEl.querySelectorAll('[data-shape-bw]').forEach((inp) => {
      const id = inp.getAttribute('data-shape-bw');
      on(inp, 'input', () => {
        const v = Number(inp.value);
        if (!Number.isFinite(v)) return;
        if (!layout.shapes[id]) return;
        layout.shapes[id].borderWidth = v;
        refreshShape(id); updateJson();
      });
    });
    shapeListEl.querySelectorAll('[data-shape-radius]').forEach((inp) => {
      const id = inp.getAttribute('data-shape-radius');
      on(inp, 'input', () => {
        const v = Number(inp.value);
        if (!Number.isFinite(v)) return;
        if (!layout.shapes[id]) return;
        layout.shapes[id].borderRadius = v;
        refreshShape(id); updateJson();
      });
    });
  }

  // ── Sidebar: Tables ─────────────────────────────────────────────────────────
  function renderTableList() {
    if (!tableListEl) return;
    const ids = Object.keys(layout.tables || {});
    if (!ids.length) {
      tableListEl.innerHTML = '<p class="field-hint">No tables yet. Add one above.</p>';
      return;
    }
    tableListEl.innerHTML = ids.map((id) => {
      const cfg  = layout.tables[id] || {};
      const rows = cfg.rows || 2;
      const cols = cfg.cols || 2;
      return `
        <div class="value-row">
          <span>Table ${rows}×${cols}</span>
          <div class="value-row-controls">
            <button type="button" class="size-toggle" data-table-edit="${id}" title="Optional shaded header row (column titles)">✎</button>
            <button type="button" class="size-toggle" data-remove-table="${id}" title="Remove">×</button>
          </div>
        </div>`;
    }).join('');

    tableListEl.querySelectorAll('[data-remove-table]').forEach((btn) => {
      const id = btn.getAttribute('data-remove-table');
      on(btn, 'click', () => {
        delete layout.tables[id];
        canvasEl?.querySelector(`.dynamic-table[data-table="${CSS.escape(id)}"]`)?.remove();
        renderTableList(); updateJson();
      });
    });

    tableListEl.querySelectorAll('[data-table-edit]').forEach((btn) => {
      const id = btn.getAttribute('data-table-edit');
      on(btn, 'click', () => {
        const cfg  = layout.tables[id] || {};
        const prev = (cfg.headers || []).join(',');
        const next = window.prompt('Header row (comma-separated column names)', prev);
        if (next == null) return;
        layout.tables[id] = { ...cfg, headers: next.split(',').map((h) => h.trim()) };
        const el = canvasEl?.querySelector(`.dynamic-table[data-table="${CSS.escape(id)}"]`);
        if (el) rebuildTableHTML(getTableInnerEl(el), layout.tables[id]);
        renderTableList(); updateJson();
      });
    });
  }

  // ── Actions ─────────────────────────────────────────────────────────────────
  function addField() {
    if (!newFieldInput) return;
    const name = newFieldInput.value.trim();
    if (!name) { setFieldError('Enter a field name.'); return; }
    if (isCoreTemplateField(name)) {
      setFieldError('That name is reserved for a core OPD field. Enable it under OPD Settings instead.');
      return;
    }
    if (!layout.fields) layout.fields = {};
    if (layout.fields[name]) { setFieldError('Field already exists.'); return; }
    clearFieldError();
    layout.fields[name] = {
      x: Math.round(CANVAS_W / 2 - DEFAULT_OPD_FIELD_BOX_WIDTH / 2),
      y: Math.round(CANVAS_H / 2 - DEFAULT_OPD_FIELD_BOX_HEIGHT / 2),
      size: 13,
      showLabel: true,
      label: name,
    };
    createBoxElement(name);
    positionBoxesFromLayout();
    syncOpdSlipLabelChVar();
    renderFieldList(); updateJson();
    newFieldInput.value = '';
  }

  function addNote() {
    if (!newFieldInput) return;
    const raw = newFieldInput.value.trim();
    if (!raw) { setFieldError('Enter some text for the note.'); return; }
    clearFieldError();
    if (!layout.notes) layout.notes = {};
    const id = `note-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    layout.notes[id] = {
      text: raw,
      x: Math.round(CANVAS_W / 2 - DEFAULT_OPD_FIELD_BOX_WIDTH / 2),
      y: Math.round(CANVAS_H / 2 - DEFAULT_OPD_FIELD_BOX_HEIGHT / 2),
      size: 11,
    };
    createNoteElement(id);
    positionBoxesFromLayout();
    renderNoteList(); updateJson();
    newFieldInput.value = '';
  }

  function addShape(type) {
    if (!layout.shapes) layout.shapes = {};
    const id = `shape-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    layout.shapes[id] = {
      type: 'rect',
      x: Math.round(CANVAS_W / 2 - 150),
      y: Math.round(CANVAS_H / 2 - 30),
      width: 300,
      height: 60,
      borderColor: '#000000',
      borderWidth: 1,
      borderStyle: 'solid',
      fillColor: 'transparent',
      borderRadius: 0,
    };
    createShapeElement(id);
    renderShapeList(); updateJson();
  }

  function addLine(orientation) {
    if (!layout.shapes) layout.shapes = {};
    const id = `shape-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    layout.shapes[id] = {
      type: 'line',
      x: 50,
      y: Math.round(CANVAS_H / 2),
      orientation,
      length: orientation === 'vertical' ? 200 : CANVAS_W - 100,
      thickness: 1,
      color: '#000000',
      style: 'solid',
    };
    createShapeElement(id);
    renderShapeList(); updateJson();
  }

  function addTable() {
    const rowsInput = $('table-rows-input');
    const colsInput = $('table-cols-input');
    const rows = Math.max(1, Math.min(20, Number(rowsInput?.value) || 3));
    const cols = Math.max(1, Math.min(10, Number(colsInput?.value) || 3));
    if (!layout.tables) layout.tables = {};
    const id   = `table-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const colW = Math.round((CANVAS_W - 100) / cols);
    layout.tables[id] = {
      x: 50,
      y: Math.round(CANVAS_H / 2 - (rows * 50) / 2),
      rows,
      cols,
      colWidths: Array(cols).fill(colW),
      rowHeight: 50,
      headers: Array.from({ length: cols }, () => ''),
      borderColor: '#374151',
      borderWidth: 1,
      headerBg: '#f3f4f6',
    };
    createTableElement(id);
    renderTableList(); updateJson();
  }

  // ── Drag & resize handlers ──────────────────────────────────────────────────
  function onMouseDown(e) {
    if (!(e.target instanceof HTMLElement)) return;

    // Resize handle on shapes / tables / rx box
    if (e.target.classList.contains('shape-resize-handle')) {
      const rxEl = e.target.closest('.dynamic-rx-box');
      if (rxEl && layout.rx_box) {
        isResizing = true;
        resizeRxBox = true;
        resizeShapeId = null;
        resizeTableId = null;
        resizeStartCX = e.clientX;
        resizeStartCY = e.clientY;
        resizeRxBoxStartW = layout.rx_box.width || DEFAULT_RX_BOX.width;
        resizeRxBoxStartH = layout.rx_box.height || DEFAULT_RX_BOX.height;
        e.preventDefault();
        return;
      }
      const tableEl = e.target.closest('.dynamic-table');
      if (tableEl && layout.tables?.[tableEl.dataset.table]) {
        isResizing = true;
        resizeShapeId = null;
        resizeTableId = tableEl.dataset.table;
        resizeStartCX = e.clientX;
        resizeStartCY = e.clientY;
        const tcfg = layout.tables[resizeTableId] || {};
        const cols = tcfg.cols || 2;
        const cw = Array.isArray(tcfg.colWidths) && tcfg.colWidths.length === cols
          ? tcfg.colWidths
          : Array(cols).fill(Math.round((CANVAS_W - 100) / Math.max(cols, 1)));
        resizeTableStartColWidths = cw.map((w) => Number(w) || 20);
        resizeTableStartTotalW = resizeTableStartColWidths.reduce((a, b) => a + b, 0);
        resizeTableRows = Math.max(1, Number(tcfg.rows) || 2);
        const rh = Number(tcfg.rowHeight) || 50;
        resizeTableStartTotalH = resizeTableRows * rh;
        e.preventDefault();
        return;
      }
      const shapeEl = e.target.closest('.dynamic-shape');
      if (shapeEl) {
        isResizing = true;
        resizeTableId = null;
        resizeShapeId = shapeEl.dataset.shape;
        resizeStartCX = e.clientX;
        resizeStartCY = e.clientY;
        const cfg = layout.shapes[resizeShapeId] || {};
        resizeStartW = cfg.type === 'line' ? (cfg.length || 200) : (cfg.width  || 200);
        resizeStartH = cfg.type === 'line' ? 0                   : (cfg.height || 60);
        e.preventDefault();
        return;
      }
    }

    const box = e.target.closest(
      '.field-box.dynamic-field, .field-box.dynamic-note, .dynamic-shape, .dynamic-table, .dynamic-rx-box'
    );
    if (!box) return;
    isDragging  = true;
    dragBox     = box;
    const rect  = box.getBoundingClientRect();
    dragOffsetX = e.clientX - rect.left;
    dragOffsetY = e.clientY - rect.top;
    e.preventDefault();
  }

  function onMouseMove(e) {
    // Resize prescription box
    if (isResizing && resizeRxBox && layout.rx_box && canvasEl) {
      const m = getCanvasContentMetrics();
      if (!m || m.innerW <= 0 || m.innerH <= 0) return;
      const scaleX = CANVAS_W / m.innerW;
      const scaleY = CANVAS_H / m.innerH;
      const dx = (e.clientX - resizeStartCX) * scaleX;
      const dy = (e.clientY - resizeStartCY) * scaleY;
      const x0 = typeof layout.rx_box.x === 'number' ? layout.rx_box.x : 0;
      const y0 = typeof layout.rx_box.y === 'number' ? layout.rx_box.y : 0;
      let newW = Math.max(120, Math.round(resizeRxBoxStartW + dx));
      let newH = Math.max(80, Math.round(resizeRxBoxStartH + dy));
      newW = Math.min(newW, Math.max(120, CANVAS_W - x0));
      newH = Math.min(newH, Math.max(80, CANVAS_H - y0));
      layout.rx_box.width = newW;
      layout.rx_box.height = newH;
      const el = canvasEl.querySelector('.dynamic-rx-box');
      if (el) applyRxBoxStyle(el, layout.rx_box);
      return;
    }

    // Resize table (width + height, column ratios preserved)
    if (isResizing && resizeTableId && canvasEl) {
      const m = getCanvasContentMetrics();
      if (!m || m.innerW <= 0 || m.innerH <= 0) return;
      const scaleX = CANVAS_W / m.innerW;
      const scaleY = CANVAS_H / m.innerH;
      const dx = (e.clientX - resizeStartCX) * scaleX;
      const dy = (e.clientY - resizeStartCY) * scaleY;
      const cfg = layout.tables[resizeTableId];
      if (!cfg) return;
      const cols = Math.max(1, Number(cfg.cols) || 2);
      const minTotalW = cols * 24;
      const minTotalH = resizeTableRows * 14;
      let newTotalW = Math.max(minTotalW, Math.round(resizeTableStartTotalW + dx));
      let newTotalH = Math.max(minTotalH, Math.round(resizeTableStartTotalH + dy));
      const x0 = typeof cfg.x === 'number' ? cfg.x : 0;
      const y0 = typeof cfg.y === 'number' ? cfg.y : 0;
      newTotalW = Math.min(newTotalW, Math.max(minTotalW, CANVAS_W - x0));
      newTotalH = Math.min(newTotalH, Math.max(minTotalH, CANVAS_H - y0));
      const baseW = resizeTableStartTotalW || 1;
      const scale = newTotalW / baseW;
      const nextWidths = resizeTableStartColWidths.map((w) => Math.max(16, Math.round(w * scale)));
      let sum = nextWidths.reduce((a, b) => a + b, 0);
      if (sum !== newTotalW && nextWidths.length) {
        nextWidths[nextWidths.length - 1] += newTotalW - sum;
      }
      cfg.colWidths = nextWidths;
      cfg.rowHeight = Math.max(10, Math.round(newTotalH / resizeTableRows));
      const el = canvasEl.querySelector(`.dynamic-table[data-table="${CSS.escape(resizeTableId)}"]`);
      if (el) {
        rebuildTableHTML(getTableInnerEl(el), cfg);
        applyTableStyle(el, cfg);
      }
      return;
    }

    // Resize shape
    if (isResizing && resizeShapeId && canvasEl) {
      const m = getCanvasContentMetrics();
      if (!m || m.innerW <= 0 || m.innerH <= 0) return;
      const scaleX = CANVAS_W / m.innerW;
      const scaleY = CANVAS_H / m.innerH;
      const dx    = (e.clientX - resizeStartCX) * scaleX;
      const dy    = (e.clientY - resizeStartCY) * scaleY;
      const cfg   = layout.shapes[resizeShapeId];
      if (!cfg) return;
      if (cfg.type === 'line') {
        cfg.length = Math.max(20, Math.round(
          resizeStartW + (cfg.orientation === 'vertical' ? dy : dx)
        ));
      } else {
        cfg.width  = Math.max(20, Math.round(resizeStartW + dx));
        cfg.height = Math.max(10, Math.round(resizeStartH + dy));
      }
      const el = canvasEl.querySelector(`.dynamic-shape[data-shape="${CSS.escape(resizeShapeId)}"]`);
      if (el) applyShapeStyle(el, cfg);
      return;
    }

    // Move
    if (!isDragging || !dragBox || !canvasEl) return;
    const m = getCanvasContentMetrics();
    if (!m || m.innerW <= 0 || m.innerH <= 0) return;
    let left = e.clientX - dragOffsetX - m.originLeft;
    let top  = e.clientY - dragOffsetY - m.originTop;
    const bw = dragBox.offsetWidth || 1;
    const bh = dragBox.offsetHeight || 1;
    left = clamp(left, 0, Math.max(0, m.innerW - bw));
    top  = clamp(top,  0, Math.max(0, m.innerH - bh));
    dragBox.style.left = `${left}px`;
    dragBox.style.top  = `${top}px`;
    updateLayoutFromBox(dragBox);
  }

  function onMouseUp() {
    if (isResizing) {
      isResizing = false;
      resizeShapeId = null;
      resizeTableId = null;
      resizeRxBox = false;
      // Sync sidebar length/size inputs after resize
      renderShapeList();
      updateJson();
      return;
    }
    isDragging = false;
    dragBox    = null;
    updateJson();
  }

  // ── Background sync ─────────────────────────────────────────────────────────
  function syncBackgroundImage() {
    if (bgImgEl) {
      if (layout.backgroundDataUrl) {
        bgImgEl.src = layout.backgroundDataUrl;
      } else {
        bgImgEl.removeAttribute('src');
      }
    }
    if (canvasEl) {
      canvasEl.classList.toggle(
        'opd-sheet--with-bg',
        !!(layout.backgroundDataUrl && String(layout.backgroundDataUrl).length > 0),
      );
    }
  }

  // ── Wire up events ──────────────────────────────────────────────────────────
  on(canvasEl, 'mousedown', onMouseDown);
  on(window,   'mousemove', onMouseMove);
  on(window,   'mouseup',   onMouseUp);
  on(window,   'resize',    () => positionBoxesFromLayout());

  if (showLabelsToggle) {
    on(showLabelsToggle, 'change', () => {
      layout.showFieldLabels = showLabelsToggle.checked;
      if (!showLabelsToggle.checked) {
        layout.alignSlipFieldColumns = false;
        if (alignSlipColumnsToggle) alignSlipColumnsToggle.checked = false;
      }
      if (alignSlipColumnsToggle) {
        alignSlipColumnsToggle.disabled = !showLabelsToggle.checked;
      }
      refreshAllDynamicFieldEditorContents();
      updateJson();
    });
  }

  if (alignSlipColumnsToggle) {
    on(alignSlipColumnsToggle, 'change', () => {
      layout.alignSlipFieldColumns = alignSlipColumnsToggle.checked;
      refreshAllDynamicFieldEditorContents();
      updateJson();
    });
  }

  if (bgInput && bgImgEl) {
    on(bgInput, 'change', () => {
      const file = bgInput.files && bgInput.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        const dataUrl = typeof reader.result === 'string' ? reader.result : '';
        if (!dataUrl) return;
        bgImgEl.src = dataUrl;
        layout.backgroundDataUrl = dataUrl;
        syncBackgroundImage();
        updateJson();
      };
      reader.readAsDataURL(file);
    });
  }

  if (addFieldBtn) on(addFieldBtn, 'click', (e) => { e.preventDefault(); addField(); });
  if (addNoteBtn)  on(addNoteBtn,  'click', (e) => { e.preventDefault(); addNote(); });
  if (addBoxBtn)   on(addBoxBtn,   'click', (e) => { e.preventDefault(); addShape('rect'); });
  if (addHLineBtn) on(addHLineBtn, 'click', (e) => { e.preventDefault(); addLine('horizontal'); });
  if (addVLineBtn) on(addVLineBtn, 'click', (e) => { e.preventDefault(); addLine('vertical'); });
  if (addTableBtn) on(addTableBtn, 'click', (e) => { e.preventDefault(); addTable(); });
  if (addRxBoxBtn) on(addRxBoxBtn, 'click', (e) => { e.preventDefault(); addRxBox(); });
  if (removeRxBoxBtn) on(removeRxBoxBtn, 'click', (e) => { e.preventDefault(); removeRxBox(); });

  const bindRxBoxCheckbox = (el, key) => {
    if (!el) return;
    on(el, 'change', () => {
      if (!layout.rx_box) layout.rx_box = { ...DEFAULT_RX_BOX };
      layout.rx_box[key] = el.checked;
      updateJson();
    });
  };
  bindRxBoxCheckbox(rxBoxShowRxEl, 'showRx');
  bindRxBoxCheckbox(rxBoxShowCcEl, 'showChiefComplaint');
  bindRxBoxCheckbox(rxBoxShowNotesEl, 'showNotes');
  bindRxBoxCheckbox(rxBoxShowFupEl, 'showFollowUp');
  bindRxBoxCheckbox(rxBoxShowQtyEl, 'showQty');
  bindRxBoxCheckbox(rxBoxShowTimingEl, 'showTiming');

  if (rxBoxFontSizeEl) {
    on(rxBoxFontSizeEl, 'input', () => {
      const v = Number(rxBoxFontSizeEl.value);
      if (!Number.isFinite(v) || v < 7 || v > 16) return;
      if (!layout.rx_box) layout.rx_box = { ...DEFAULT_RX_BOX };
      layout.rx_box.fontSize = v;
      const el = canvasEl?.querySelector('.dynamic-rx-box');
      if (el) applyRxBoxStyle(el, layout.rx_box);
      updateJson();
    });
  }

  if (newFieldInput) {
    on(newFieldInput, 'keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); addField(); }
    });
  }

  if (saveLayoutBtn) {
    on(saveLayoutBtn, 'click', async (e) => {
      e.preventDefault();
      setSaveStatus('', '');
      if (layoutJsonEl) {
        const editedJson = layoutJsonEl.value || '';
        if (editedJson.trim() && editedJson !== lastSyncedJsonText) {
          const applied = applyLayoutJsonText(editedJson);
          if (!applied) {
            setSaveStatus('Invalid JSON. Fix it before saving.', '#b91c1c');
            return;
          }
        }
      }
      saveToLocalStorage();
      setSaveStatus('Layout saved locally.', '');
      await saveLayoutToBackend();
    });
  }

  if (copyBtn && layoutJsonEl) {
    on(copyBtn, 'click', async () => {
      try {
        if (!layoutJsonEl.value) return;
        await navigator.clipboard.writeText(layoutJsonEl.value);
        if (copyStatusEl) copyStatusEl.textContent = 'Copied!';
      } catch {
        if (copyStatusEl) copyStatusEl.textContent = 'Could not copy. Select the JSON and copy manually.';
      }
    });
  }

  if (applyLayoutBtn && layoutJsonEl) {
    on(applyLayoutBtn, 'click', (e) => {
      e.preventDefault();
      applyLayoutJsonText(layoutJsonEl.value);
    });
  }

  if (bgImgEl) bgImgEl.style.background = '#ffffff';

  // ── Initialise ──────────────────────────────────────────────────────────────
  (async () => {
    loadFromLocalStorage();
    await loadFromBackend();
    await loadOpdFieldConfig();
    layout = syncCoreFieldsIntoLayout(layout, opdFieldConfig);
    if (!layout.rx_box) layout.rx_box = { ...DEFAULT_RX_BOX };
    if (!layout.showFieldLabels) layout.alignSlipFieldColumns = false;
    syncBackgroundImage();
    if (showLabelsToggle) showLabelsToggle.checked = layout.showFieldLabels === true;
    if (alignSlipColumnsToggle) {
      alignSlipColumnsToggle.disabled = !layout.showFieldLabels;
      alignSlipColumnsToggle.checked =
        layout.showFieldLabels === true && layout.alignSlipFieldColumns === true;
    }
    renderAllFromLayout();
    renderFieldList();
    renderNoteList();
    renderShapeList();
    renderTableList();
    updateJson();
  })();

  function setOpdFieldConfigExternal(nextConfig, legacyHidden) {
    opdFieldConfig = normalizeOpdFieldConfig(nextConfig, legacyHidden);
  }

  function refreshFieldLabels() {
    layout = syncCoreFieldsIntoLayout(layout, opdFieldConfig);
    renderAllFromLayout();
    refreshAllDynamicFieldEditorContents();
    renderFieldList();
    updateJson();
  }

  return {
    dispose() { disposers.forEach((d) => d()); },
    setOpdFieldConfig: setOpdFieldConfigExternal,
    refreshFieldLabels,
  };
}
