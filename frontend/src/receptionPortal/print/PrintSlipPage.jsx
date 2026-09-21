import React, { useEffect, useState } from 'react'
import { printOpdSheet } from '../../utils/printOpdSheet'

const PAYMENT_JOB_KEY = 'payment-slip-print-job'

/**
 * Poll localStorage for a key until it has a value or the timeout elapses.
 * Used by the payment-slip flow: the tab is opened synchronously on click (so the mobile
 * browser allows it), but the print HTML is only produced after the invoice/payment API
 * calls resolve — so this page waits for that HTML to arrive.
 */
function waitForJob(key, { timeout = 25000, interval = 150 } = {}) {
  return new Promise((resolve) => {
    const start = Date.now()
    const tick = () => {
      let val = null
      try { val = localStorage.getItem(key) } catch { /* ignore */ }
      if (val) { resolve(val); return }
      if (Date.now() - start >= timeout) { resolve(null); return }
      setTimeout(tick, interval)
    }
    tick()
  })
}

/**
 * Handles three print entry points:
 *
 * 1. Payment slip (mobile) → opens /print-slip?job=payment, then the generator writes a full
 *    print-ready HTML document to localStorage['payment-slip-print-job']. This page waits for it
 *    and takes over the whole document so the mobile print bar / auto-print script runs on a real
 *    same-origin page (about:blank tabs are unreliable to print on mobile).
 * 2. OPD Generator tab  → sets localStorage['opd-print-job'] then opens /print-slip
 * 3. Token Queue A4 btn → navigates to /print-slip?field1=val1&field2=val2
 *    (the layout is fetched from /api/templates and values come from URL params)
 */
export default function PrintSlipPage() {
  const [status, setStatus] = useState('Preparing print…')

  useEffect(() => {
    let cancelled = false

    async function run() {
      const params = new URLSearchParams(window.location.search)

      // 1. Payment slip — wait for the pre-built, mobile-patched HTML then render it.
      if (params.get('job') === 'payment') {
        const html = await waitForJob(PAYMENT_JOB_KEY)
        if (cancelled) return
        if (html) {
          try { localStorage.removeItem(PAYMENT_JOB_KEY) } catch { /* ignore */ }
          document.open()
          document.write(html)
          document.close()
        } else {
          setStatus('Could not prepare the payment slip. Please close this tab and try again.')
        }
        return
      }

      // 2. OPD print job stored in localStorage
      try {
        const raw = localStorage.getItem('opd-print-job')
        if (raw) {
          const job = JSON.parse(raw)
          if (job?.layout?.fields) {
            if (!cancelled) {
              await printOpdSheet({
                values: job.values || {},
                withBackground: !!job.withBackground,
                layout: job.layout,
                opdFieldConfig: job.opdFieldConfig,
              })
              setStatus('Printing…')
              setTimeout(() => {
                try { localStorage.removeItem('opd-print-job') } catch { /* ignore */ }
              }, 15000)
            }
            return
          }
        }
      } catch { /* fall through to URL params path */ }

      // 3. Values supplied via URL params
      const values = {}
      const withBackground = params.get('_bg') !== '0'
      for (const [k, v] of params.entries()) {
        if (k !== '_bg') values[k] = v
      }

      try {
        if (!cancelled) {
          await printOpdSheet({ values, withBackground })
          setStatus('Printing…')
        }
      } catch (err) {
        if (!cancelled) {
          setStatus(err?.message || 'Error: Could not load OPD template layout. Please save the layout in the OPD editor first.')
        }
      }
    }

    run()
    return () => { cancelled = true }
  }, [])

  return (
    <div style={{ padding: 32, fontFamily: 'system-ui, sans-serif', color: '#374151' }}>
      {status}
    </div>
  )
}
