/**
 * Hidden iframe printing — avoids blank pages on mobile when printing portaled overlays.
 */

import {
  triggerHMSPrint,
  getPrintCleanupDelayMs,
  shouldUseDedicatedPrintDocument,
  ensureFullHtmlDocument,
  injectStandalonePrintCss,
  HMS_PRINT_INVOKE_FUNCTION,
  STANDALONE_PRINT_DOCUMENT_CSS,
  activateAndroidPrintRoot,
  ANDROID_PRINT_CONTENT_HOLD_MS,
} from './triggerHMSPrint.js'

function isMobileDevice() {
  return /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent)
}

function useDedicatedPrintSurface() {
  return isMobileDevice() || shouldUseDedicatedPrintDocument()
}

/**
 * Patch arbitrary print HTML for the mobile new-tab flow.
 */
export function patchHtmlForMobile(html /* , autoPrint */) {
  const hmsFn = HMS_PRINT_INVOKE_FUNCTION.replace(/\n/g, '')

  const headSetup =
    '<scr' + 'ipt>(function(){' +
    hmsFn + ';' +
    'var _o=window.addEventListener.bind(window);' +
    'window.addEventListener=function(t,h,o){if(t==="focus")return;return _o(t,h,o);};' +
    'setTimeout(function(){window.addEventListener=_o;},2000);' +
    'var _pf=false;' +
    'window.__mblPrintNow=function(){try{__hmsInvokePrint();}catch(e){}};' +
    'window.print=function(){if(_pf)return;_pf=true;setTimeout(function(){_pf=false;},2500);try{__hmsInvokePrint();}catch(e){}};' +
    '_o.call(window,"afterprint",function(){window.__mblPrintNow=function(){try{__hmsInvokePrint();}catch(e){}};},{once:true});' +
    '})()</scr' + 'ipt>'

  const barCss =
    '<style>' +
    STANDALONE_PRINT_DOCUMENT_CSS +
    '.mbl-print-bar{position:fixed;top:0;left:0;right:0;z-index:9999;display:flex;' +
    'align-items:center;justify-content:center;gap:12px;padding:10px 16px;' +
    'background:#0f766e;box-shadow:0 2px 8px rgba(0,0,0,.18);}' +
    '.mbl-print-btn{background:#fff;color:#0f766e;border:none;border-radius:6px;' +
    'padding:8px 20px;font-size:15px;font-weight:700;cursor:pointer;font-family:system-ui,sans-serif;}' +
    '.mbl-ios-hint{display:none;margin:0;color:#fff;font-size:14px;font-family:system-ui,sans-serif;text-align:center;}' +
    '@media screen{body{padding-top:52px!important}}' +
    '@media print{.mbl-print-bar{display:none!important}}' +
    '</style>'

  const barHtml =
    '<div class="mbl-print-bar">' +
    '<button class="mbl-print-btn" onclick="window.__mblPrintNow ? window.__mblPrintNow() : window.print()">Print / Save as PDF</button>' +
    '<p class="mbl-ios-hint">iPhone / iPad: tap Share then select Print</p>' +
    '</div>'

  const triggerScript =
    '<scr' + 'ipt>(function(){' +
    'var isIOS=/iPad|iPhone|iPod/.test(navigator.userAgent)&&!window.MSStream;' +
    'var btn=document.querySelector(".mbl-print-btn");' +
    'var hint=document.querySelector(".mbl-ios-hint");' +
    'if(isIOS){' +
      'if(hint)hint.style.display="block";' +
      'if(btn)btn.style.display="none";' +
    '}else{' +
      'setTimeout(function(){try{window.print();}catch(e){}},400);' +
    '}' +
    '})()</scr' + 'ipt>'

  const baseHref = '<base href="' + window.location.origin + '/" />'
  const viewport = '<meta name="viewport" content="width=device-width,initial-scale=1"/>'

  let s = ensureFullHtmlDocument(html)
  s = injectStandalonePrintCss(s)
  s = s.includes('<head>')
    ? s.replace('<head>', '<head>' + baseHref + viewport + headSetup + barCss)
    : headSetup + barCss + s
  s = s.includes('<body>')
    ? s.replace('<body>', '<body>' + barHtml)
    : barHtml + s
  s = s.includes('</body>')
    ? s.replace('</body>', triggerScript + '</body>')
    : s + triggerScript
  return s
}

function attachPrintIframe(forAndroid = false) {
  const iframe = document.createElement('iframe')
  iframe.setAttribute('aria-hidden', 'true')
  iframe.setAttribute('title', 'print')
  if (forAndroid) {
    // Android PrintAdapter needs visible pixels — not visibility:hidden or off-screen.
    Object.assign(iframe.style, {
      position: 'fixed',
      top: '0',
      left: '0',
      width: '100%',
      height: '100%',
      border: '0',
      margin: '0',
      padding: '0',
      visibility: 'visible',
      opacity: '0.01',
      pointerEvents: 'none',
      zIndex: '99999',
      background: '#fff',
    })
  } else {
    Object.assign(iframe.style, {
      position: 'fixed',
      top: '0',
      left: '0',
      width: '100%',
      height: '100%',
      border: '0',
      margin: '0',
      padding: '0',
      visibility: 'hidden',
      pointerEvents: 'none',
      zIndex: '99999',
    })
  }
  document.body.appendChild(iframe)
  return iframe
}

function scheduleIframeCleanup(iframe, onComplete) {
  let cleaned = false
  let completed = false
  const notifyComplete = () => {
    if (completed) return
    completed = true
    if (typeof onComplete === 'function') {
      try { onComplete() } catch { /* ignore */ }
    }
  }
  const cw = iframe.contentWindow
  const cleanup = () => {
    if (cleaned) return
    cleaned = true
    try { iframe.remove() } catch { /* ignore */ }
    notifyComplete()
  }
  const scheduleCleanup = () => {
    const delay = Math.max(100, getPrintCleanupDelayMs(cw || window))
    setTimeout(cleanup, delay)
  }

  if (cw) {
    cw.addEventListener('afterprint', scheduleCleanup, { once: true })
  }
  window.addEventListener('focus', () => scheduleCleanup(), { once: true })
  setTimeout(cleanup, 120000)
  return cleanup
}

function openAndroidPrintSurface(html, { onComplete } = {}) {
  const fullHtml = injectStandalonePrintCss(ensureFullHtmlDocument(html))
  const parsed = new DOMParser().parseFromString(fullHtml, 'text/html')

  document.getElementById('hms-print-surface')?.remove()

  const overlay = document.createElement('div')
  overlay.id = 'hms-print-surface'
  overlay.className = 'hms-android-print-root'
  Object.assign(overlay.style, {
    position: 'fixed',
    inset: '0',
    zIndex: '2147483647',
    overflow: 'auto',
    background: '#fff',
  })

  parsed.querySelectorAll('head style').forEach((node) => {
    const style = document.createElement('style')
    style.textContent = node.textContent || ''
    overlay.appendChild(style)
  })

  const bodyWrap = document.createElement('div')
  bodyWrap.className = 'hms-print-surface-body'
  bodyWrap.innerHTML = parsed.body?.innerHTML || ''
  overlay.appendChild(bodyWrap)

  document.body.appendChild(overlay)

  const restoreDom = activateAndroidPrintRoot(overlay)
  const finish = () => {
    restoreDom()
    try { overlay.remove() } catch { /* ignore */ }
    if (typeof onComplete === 'function') {
      try { onComplete() } catch { /* ignore */ }
    }
  }

  const runPrint = () => {
    triggerHMSPrint(window, { printRootEl: overlay })
    setTimeout(finish, ANDROID_PRINT_CONTENT_HOLD_MS + 200)
  }

  let pending = 0
  overlay.querySelectorAll('img').forEach((img) => {
    if (img.complete) return
    pending += 1
    const done = () => { pending -= 1 }
    img.addEventListener('load', done, { once: true })
    img.addEventListener('error', done, { once: true })
  })

  if (pending === 0) {
    setTimeout(runPrint, 400)
    return true
  }

  const started = { value: false }
  const start = () => {
    if (started.value) return
    started.value = true
    runPrint()
  }
  const tick = setInterval(() => {
    if (pending <= 0) {
      clearInterval(tick)
      setTimeout(start, 200)
    }
  }, 100)
  setTimeout(() => {
    clearInterval(tick)
    start()
  }, 3000)

  return true
}

/**
 * Mobile browser: patched HTML + optional new tab / localStorage.
 * HMS Android APK: fullscreen surface in main WebView + auto printPage (no manual button).
 */
export function deliverMobilePrintHtml(html, { targetWindow, onComplete, storageKey } = {}) {
  if (shouldUseDedicatedPrintDocument()) {
    openAndroidPrintSurface(html, { onComplete })
    return null
  }

  const mobileHtml = patchHtmlForMobile(html)
  if (storageKey) {
    try {
      localStorage.setItem(storageKey, mobileHtml)
    } catch {
      if (targetWindow) writeHtmlToWindow(mobileHtml, targetWindow)
    }
  } else if (targetWindow) {
    writeHtmlToWindow(mobileHtml, targetWindow)
  }
  if (typeof onComplete === 'function') {
    try { onComplete() } catch { /* ignore */ }
  }
  return mobileHtml
}

function openDedicatedPrintDocument(html, { onComplete, mobilePatch = true } = {}) {
  // HMS Android APK: print in the main WebView (no preview tab / manual button).
  if (shouldUseDedicatedPrintDocument()) {
    return openAndroidPrintSurface(html, { onComplete })
  }

  const w = window.open('', '_blank')
  if (!w) return false
  const docHtml = mobilePatch ? patchHtmlForMobile(html) : injectStandalonePrintCss(ensureFullHtmlDocument(html))
  w.document.open()
  w.document.write(docHtml)
  w.document.close()
  if (typeof onComplete === 'function') {
    try { onComplete() } catch { /* ignore */ }
  }
  return true
}

/**
 * Preferred entry for printing a full HTML document (APK / mobile / desktop).
 */
export function printHtmlDocument(html, options = {}) {
  const { onComplete, autoPrint = true, mobilePatch = true } = options
  const fullHtml = injectStandalonePrintCss(ensureFullHtmlDocument(html))

  if (useDedicatedPrintSurface()) {
    if (openDedicatedPrintDocument(fullHtml, { onComplete, mobilePatch })) return
  }

  printHtmlInHiddenIframe(fullHtml, { onComplete, autoPrint })
}

export function printHtmlInHiddenIframe(html, options = {}) {
  const { onComplete, autoPrint = true } = options
  const fullHtml = injectStandalonePrintCss(ensureFullHtmlDocument(html))

  if (useDedicatedPrintSurface()) {
    if (openDedicatedPrintDocument(fullHtml, { onComplete, mobilePatch: true })) return
  }

  const forAndroid = shouldUseDedicatedPrintDocument()
  const iframe = attachPrintIframe(forAndroid)
  const cleanup = scheduleIframeCleanup(iframe, onComplete)

  const invokePrint = () => {
    const cw = iframe.contentWindow
    if (!cw) {
      cleanup()
      return
    }
    if (forAndroid) {
      cleanup()
      openAndroidPrintSurface(fullHtml, { onComplete })
      return
    }
    if (!triggerHMSPrint(cw)) {
      cleanup()
    }
  }

  const schedulePrint = () => {
    const doc = iframe.contentDocument
    const links = doc ? Array.from(doc.querySelectorAll('link[rel="stylesheet"]')) : []
    const waitForSheets = Promise.all(
      links.map(
        (link) =>
          new Promise((resolve) => {
            if (link.sheet) {
              resolve()
              return
            }
            link.addEventListener('load', () => resolve(), { once: true })
            link.addEventListener('error', () => resolve(), { once: true })
            // Safety if the browser never fires load for cached sheets
            setTimeout(resolve, 1200)
          }),
      ),
    )
    waitForSheets.finally(() => {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          setTimeout(invokePrint, 300)
        })
      })
    })
  }

  if (autoPrint) {
    iframe.addEventListener('load', schedulePrint, { once: true })
  }

  iframe.srcdoc = fullHtml
}

export function createSameTabPrintWindow(options = {}) {
  const { onComplete } = options
  let html = ''
  return {
    document: {
      write(chunk) {
        html += String(chunk || '')
      },
      close() {
        printHtmlInHiddenIframe(html, { onComplete, autoPrint: false })
      },
    },
  }
}

export function writeHtmlInHiddenIframe(html, options = {}) {
  printHtmlInHiddenIframe(html, options)
}

export function writeHtmlToWindow(html, targetWindow) {
  if (!targetWindow || targetWindow.closed) return
  const docHtml = injectStandalonePrintCss(ensureFullHtmlDocument(html))
  targetWindow.document.open()
  targetWindow.document.write(docHtml)
  targetWindow.document.close()
}
