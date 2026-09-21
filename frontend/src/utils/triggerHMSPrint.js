/**
 * HMS print bridge for Android WebView (window.Android.printPage) with browser fallback.
 *
 * Android PrintManager snapshots the *live* DOM (it does not apply @media print).
 * Content must stay visible, overflow must not clip, and cleanup must wait
 * ANDROID_PRINT_CONTENT_HOLD_MS after printPage().
 */

export const ANDROID_PRINT_CONTENT_HOLD_MS = 3000

/** Injected into standalone print HTML documents (iframe / popup / payment slip). */
export const STANDALONE_PRINT_DOCUMENT_CSS = `
html, body {
  margin: 0 !important;
  padding: 0 !important;
  overflow: visible !important;
  height: auto !important;
  max-height: none !important;
  min-height: 0 !important;
  visibility: visible !important;
  display: block !important;
  background: #fff !important;
}
@media print {
  html, body {
    overflow: visible !important;
    height: auto !important;
    max-height: none !important;
  }
}
`

/**
 * Screen rules for printing from the main SPA via Android.printPage().
 * @media print is NOT applied by the Android Print Adapter.
 */
export const ANDROID_PRINT_DOM_CSS = `
html.hms-android-print-active,
html.hms-android-print-active body {
  overflow: visible !important;
  height: auto !important;
  max-height: none !important;
  min-height: 0 !important;
  visibility: visible !important;
  display: block !important;
  position: static !important;
}
html.hms-android-print-active body > *:not(.hms-android-print-root) {
  display: none !important;
}
html.hms-android-print-active .hms-android-print-root {
  display: block !important;
  visibility: visible !important;
  position: static !important;
  overflow: visible !important;
  height: auto !important;
  max-height: none !important;
  width: 100% !important;
  inset: auto !important;
  opacity: 1 !important;
  z-index: auto !important;
}
html.hms-android-print-active .hms-android-print-root * {
  visibility: visible !important;
}
html.hms-android-print-active .hms-android-print-ui-only,
html.hms-android-print-active .print\\:hidden {
  display: none !important;
}
html.hms-android-print-active #opd-print-portal {
  display: block !important;
  visibility: visible !important;
  overflow: visible !important;
}
html.hms-android-print-active #opd-print-portal .opd-print-page {
  display: block !important;
  visibility: visible !important;
  overflow: visible !important;
  height: auto !important;
  min-height: 297mm;
}
`

const PRINT_ROOT_IDS = [
  'opd-print-portal',
  '__opd_receipt_root',
  '__receipt_root',
  '__discharge_doc_root',
  '__ipd_ledger_root',
  '__lab_report_root',
]

export const HMS_PRINT_SCHEDULE_HELPER = `function __hmsMinCleanupDelay() {
  try {
    var left = (window.__hmsAndroidHoldUntil || 0) - Date.now();
    return left > 0 ? left : 0;
  } catch (e) { return 0; }
}
function __hmsScheduleFinalize(fn) {
  var d = __hmsMinCleanupDelay();
  if (d > 0) setTimeout(fn, d);
  else fn();
}`

export const HMS_PRINT_INVOKE_FUNCTION = `function __hmsInvokePrint() {
  var targets = [window];
  try { if (window.opener && window.opener !== window) targets.push(window.opener); } catch (e0) {}
  try { if (window.top && window.top !== window) targets.push(window.top); } catch (e0b) {}
  for (var ti = 0; ti < targets.length; ti++) {
    var ctx = targets[ti];
    while (ctx) {
      try {
        if (ctx.Android && typeof ctx.Android.printPage === 'function') {
          ctx.Android.printPage();
          try { window.__hmsAndroidHoldUntil = Date.now() + ${ANDROID_PRINT_CONTENT_HOLD_MS}; } catch (e) {}
          return;
        }
      } catch (e) {}
      try {
        if (!ctx.parent || ctx.parent === ctx) break;
        ctx = ctx.parent;
      } catch (e2) {
        break;
      }
    }
  }
  window.print();
}`

export function getAndroidPrintBridge(startWindow = window) {
  const targets = [startWindow]
  try {
    if (startWindow.opener && startWindow.opener !== startWindow) targets.push(startWindow.opener)
  } catch { /* ignore */ }
  try {
    if (startWindow.top && startWindow.top !== startWindow) targets.push(startWindow.top)
  } catch { /* ignore */ }

  for (const start of targets) {
    let ctx = start
    while (ctx) {
      try {
        if (ctx.Android && typeof ctx.Android.printPage === 'function') {
          return ctx.Android
        }
        if (!ctx.parent || ctx.parent === ctx) break
        ctx = ctx.parent
      } catch {
        break
      }
    }
  }
  return null
}

export function isAndroidPrintBridgeAvailable(startWindow = window) {
  return Boolean(getAndroidPrintBridge(startWindow))
}

export function shouldUseDedicatedPrintDocument(startWindow = window) {
  return isAndroidPrintBridgeAvailable(startWindow)
}

export function getPrintCleanupDelayMs(startWindow = window) {
  return isAndroidPrintBridgeAvailable(startWindow) ? ANDROID_PRINT_CONTENT_HOLD_MS : 0
}

export function schedulePrintCleanup(callback, startWindow = window) {
  const delay = getPrintCleanupDelayMs(startWindow)
  if (delay > 0) {
    setTimeout(callback, delay)
    return
  }
  callback()
}

export function ensureFullHtmlDocument(html) {
  const s = String(html || '').trim()
  if (!s) {
    return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>${STANDALONE_PRINT_DOCUMENT_CSS}</style></head><body></body></html>`
  }
  if (/<html[\s>]/i.test(s)) return injectStandalonePrintCss(s)
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>${STANDALONE_PRINT_DOCUMENT_CSS}</style></head><body>${s}</body></html>`
}

export function injectStandalonePrintCss(html) {
  const css = `<style id="hms-standalone-print-css">${STANDALONE_PRINT_DOCUMENT_CSS}</style>`
  let s = String(html || '')
  if (s.includes('hms-standalone-print-css')) return s
  if (s.includes('<head>')) return s.replace('<head>', `<head>${css}`)
  if (/<html[\s>]/i.test(s)) {
    return s.replace(/<html([^>]*)>/i, `<html$1><head><meta charset="utf-8">${css}</head>`)
  }
  return ensureFullHtmlDocument(s)
}

function ensureAndroidPrintStyles(doc = document) {
  if (!doc?.head || doc.getElementById('hms-android-print-styles')) return
  const style = doc.createElement('style')
  style.id = 'hms-android-print-styles'
  style.textContent = ANDROID_PRINT_DOM_CSS
  doc.head.appendChild(style)
}

export function findActivePrintRoot(startWindow = window) {
  const doc = startWindow?.document
  if (!doc) return null
  for (const id of PRINT_ROOT_IDS) {
    const el = doc.getElementById(id)
    if (el) return el
  }
  return null
}

/**
 * Make a print overlay visible for Android PrintAdapter (live DOM capture).
 * Returns a restore function — call after ANDROID_PRINT_CONTENT_HOLD_MS.
 */
export function activateAndroidPrintRoot(rootEl) {
  if (!rootEl) return () => {}
  const doc = rootEl.ownerDocument
  const html = doc.documentElement
  ensureAndroidPrintStyles(doc)

  const prev = {
    htmlClass: html.className,
    htmlOverflow: html.style.overflow,
    htmlHeight: html.style.height,
    bodyOverflow: doc.body?.style.overflow || '',
    bodyHeight: doc.body?.style.height || '',
    rootClass: rootEl.className,
    rootDisplay: rootEl.style.display,
    rootVisibility: rootEl.style.visibility,
    rootOverflow: rootEl.style.overflow,
    rootPosition: rootEl.style.position,
    rootHeight: rootEl.style.height,
    rootMaxHeight: rootEl.style.maxHeight,
    rootOpacity: rootEl.style.opacity,
  }

  html.classList.add('hms-android-print-active')
  rootEl.classList.add('hms-android-print-root')
  html.style.overflow = 'visible'
  html.style.height = 'auto'
  if (doc.body) {
    doc.body.style.overflow = 'visible'
    doc.body.style.height = 'auto'
  }
  rootEl.style.display = 'block'
  rootEl.style.visibility = 'visible'
  rootEl.style.overflow = 'visible'
  rootEl.style.position = 'static'
  rootEl.style.height = 'auto'
  rootEl.style.maxHeight = 'none'
  rootEl.style.opacity = '1'

  return () => {
    html.className = prev.htmlClass
    html.style.overflow = prev.htmlOverflow
    html.style.height = prev.htmlHeight
    if (doc.body) {
      doc.body.style.overflow = prev.bodyOverflow
      doc.body.style.height = prev.bodyHeight
    }
    rootEl.className = prev.rootClass
    rootEl.style.display = prev.rootDisplay
    rootEl.style.visibility = prev.rootVisibility
    rootEl.style.overflow = prev.rootOverflow
    rootEl.style.position = prev.rootPosition
    rootEl.style.height = prev.rootHeight
    rootEl.style.maxHeight = prev.rootMaxHeight
    rootEl.style.opacity = prev.rootOpacity
  }
}

function markAndroidPrintHold(targetWindow) {
  try {
    targetWindow.__hmsAndroidHoldUntil = Date.now() + ANDROID_PRINT_CONTENT_HOLD_MS
  } catch {
    /* ignore cross-origin */
  }
}

/**
 * Trigger print via Android bridge when embedded in the HMS app, else window.print().
 * @param {Window} [targetWindow]
 * @param {{ printRootEl?: HTMLElement, printRootId?: string }} [options]
 */
export function triggerHMSPrint(targetWindow, options = {}) {
  const win = targetWindow || window
  const bridge = getAndroidPrintBridge(win)
  let restoreDom = () => {}

  if (bridge && !targetWindow) {
    const root = options.printRootEl
      || (options.printRootId && document.getElementById(options.printRootId))
      || findActivePrintRoot(win)
    if (root) {
      restoreDom = activateAndroidPrintRoot(root)
    } else {
      ensureAndroidPrintStyles()
      document.documentElement.classList.add('hms-android-print-active')
      restoreDom = () => document.documentElement.classList.remove('hms-android-print-active')
    }
  }

  if (bridge) {
    try {
      bridge.printPage()
      markAndroidPrintHold(win)
      setTimeout(restoreDom, ANDROID_PRINT_CONTENT_HOLD_MS)
      return true
    } catch {
      restoreDom()
      /* fall through */
    }
  }

  try {
    if (typeof win.focus === 'function') win.focus()
    win.print()
    return true
  } catch {
    restoreDom()
    return false
  }
}

export function buildHmsPrintCloseScript({ waitForLogo = true } = {}) {
  const logoWaitBlock = waitForLogo
    ? `
    window.addEventListener('load', () => {
      const logo = document.querySelector('.hosp-logo')
      if (!logo) {
        setTimeout(triggerPrint, 0)
        return
      }
      if (logo.complete) {
        setTimeout(triggerPrint, 0)
        return
      }
      logo.addEventListener('load', () => setTimeout(triggerPrint, 0), { once: true })
      logo.addEventListener('error', () => setTimeout(triggerPrint, 0), { once: true })
    }, { once: true })`
    : `
    window.addEventListener('load', () => setTimeout(triggerPrint, 0), { once: true })`

  return `<script>
  (function () {
    ${HMS_PRINT_SCHEDULE_HELPER}
    ${HMS_PRINT_INVOKE_FUNCTION}
    let finalized = false
    let printed = false
    const doFinalize = () => {
      if (finalized) return
      finalized = true
      try { window.location.replace('about:blank') } catch {}
      setTimeout(() => {
        try { window.close() } catch {}
      }, 50)
    }
    const finalize = () => __hmsScheduleFinalize(doFinalize)

    const triggerPrint = () => {
      if (printed) return
      printed = true
      try { __hmsInvokePrint() } catch { finalize() }
    }

    window.addEventListener('afterprint', finalize, { once: true })
    window.addEventListener('focus', () => finalize(), { once: true })
    setTimeout(finalize, 120000)
    ${logoWaitBlock}
  })()
</script>`
}

export function buildHmsAutoPrintScript() {
  return [
    '(function () {',
    HMS_PRINT_SCHEDULE_HELPER + ';',
    HMS_PRINT_INVOKE_FUNCTION + ';',
    '  var finalized = false;',
    '  function doFinalize() {',
    '    if (finalized) return;',
    '    finalized = true;',
    '    try { window.location.replace("about:blank"); } catch (e) {}',
    '    setTimeout(function () {',
    '      try { window.close(); } catch (e) {}',
    '    }, 50);',
    '  }',
    '  function finalize() { __hmsScheduleFinalize(doFinalize); }',
    '  window.addEventListener("afterprint", finalize, { once: true });',
    '  window.addEventListener("focus", function () { finalize(); }, { once: true });',
    '  setTimeout(finalize, 120000);',
    '  function triggerPrint() {',
    '    setTimeout(function () {',
    '      try { __hmsInvokePrint(); } catch (e) { finalize(); }',
    '    }, 0);',
    '  }',
    '  if (document.readyState === "complete") { triggerPrint(); }',
    '  else { window.addEventListener("load", triggerPrint, { once: true }); }',
    '})();',
  ].join('\n')
}
