import React, { useEffect, useMemo, useState } from 'react'
import { useLocation } from 'react-router-dom'
import toast from 'react-hot-toast'
import { Download, X, AlertCircle } from 'lucide-react'
import { resolvePortalFromPath } from '../themes'

const PORTAL_INSTALL_LABEL = {
  doctor: 'Doctor App',
  pharmacy: 'Pharmacy App',
  receptionist: 'Reception App',
  staff: 'Staff App',
  lab: 'Lab App',
  admin: 'Admin App',
}

function readStoredDeferredPrompt() {
  return typeof window !== 'undefined' ? window.__hmsDeferredInstallPrompt || null : null
}

function clearStoredDeferredPrompt() {
  if (typeof window !== 'undefined') {
    window.__hmsDeferredInstallPrompt = null
  }
}

export default function InstallPrompt() {
  const location = useLocation()
  const [deferredPrompt, setDeferredPrompt] = useState(() => readStoredDeferredPrompt())
  const [dismissed, setDismissed] = useState(false)
  const [isInstalled, setIsInstalled] = useState(false)
  const [showHelp, setShowHelp] = useState(false)

  const portalKey = resolvePortalFromPath(location.pathname) || 'staff'
  const appLabel = PORTAL_INSTALL_LABEL[portalKey] || PORTAL_INSTALL_LABEL.staff

  const isStandalone = useMemo(() => {
    if (typeof window === 'undefined') return false
    return (
      window.matchMedia('(display-mode: standalone)').matches ||
      window.navigator.standalone === true
    )
  }, [])

  useEffect(() => {
    if (isStandalone) {
      setIsInstalled(true)
      return
    }

    const existing = readStoredDeferredPrompt()
    if (existing) setDeferredPrompt(existing)

    function handleInstallReady() {
      const prompt = readStoredDeferredPrompt()
      if (prompt) setDeferredPrompt(prompt)
    }

    function handleAppInstalled() {
      setIsInstalled(true)
      setDeferredPrompt(null)
      clearStoredDeferredPrompt()
    }

    window.addEventListener('hms-install-ready', handleInstallReady)
    window.addEventListener('appinstalled', handleAppInstalled)
    return () => {
      window.removeEventListener('hms-install-ready', handleInstallReady)
      window.removeEventListener('appinstalled', handleAppInstalled)
    }
  }, [isStandalone])

  async function handleInstall() {
    const prompt = deferredPrompt || readStoredDeferredPrompt()
    if (!prompt) {
      setShowHelp(true)
      toast.error('Install is not available in this browser. Use the steps below.')
      return
    }
    try {
      await prompt.prompt()
      const { outcome } = await prompt.userChoice
      if (outcome === 'accepted') {
        setIsInstalled(true)
        toast.success('App installed')
      }
    } catch {
      toast.error('Could not open install dialog. Try the manual steps below.')
      setShowHelp(true)
    } finally {
      setDeferredPrompt(null)
      clearStoredDeferredPrompt()
    }
  }

  function handleDismiss() {
    setDismissed(true)
    clearStoredDeferredPrompt()
  }

  if (isInstalled || dismissed) return null

  const onLogin = location.pathname.startsWith('/login') || location.pathname.startsWith('/change-password')
  if (onLogin) return null

  const canNativeInstall = Boolean(deferredPrompt || readStoredDeferredPrompt())

  return (
    <>
      <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[300] bg-slate-900 text-white rounded-xl shadow-2xl px-4 py-2.5 flex items-center gap-3 max-w-sm">
        <Download size={18} className="text-blue-400 shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-xs font-bold leading-tight">Install {appLabel}</p>
          <p className="text-[10px] text-slate-400">Quick access from your home screen</p>
        </div>
        <button
          type="button"
          onClick={handleInstall}
          className="shrink-0 bg-blue-600 hover:bg-blue-500 text-white text-[11px] font-bold px-3 py-1.5 rounded-lg transition-colors"
        >
          Install
        </button>
        {!canNativeInstall && (
          <button
            type="button"
            onClick={() => setShowHelp((v) => !v)}
            className="shrink-0 text-slate-400 hover:text-slate-200"
            title="How to install"
          >
            <AlertCircle size={16} />
          </button>
        )}
        <button type="button" onClick={handleDismiss} className="shrink-0 text-slate-500 hover:text-slate-300">
          <X size={14} />
        </button>
      </div>

      {(showHelp && !canNativeInstall) && (
        <div className="fixed bottom-20 left-1/2 -translate-x-1/2 z-[300] max-w-sm w-[calc(100%-2rem)] bg-white border border-slate-200 rounded-xl shadow-xl p-3 text-[11px] text-slate-700">
          <p className="font-bold text-slate-900 mb-1">Install manually</p>
          <ul className="list-disc pl-4 space-y-1 text-slate-600">
            <li><strong>Chrome / Edge (desktop):</strong> address bar Install icon, or menu → Install app.</li>
            <li><strong>Android Chrome:</strong> menu (⋮) → Install app / Add to Home screen.</li>
            <li><strong>iPhone Safari:</strong> Share → Add to Home Screen.</li>
          </ul>
          <button
            type="button"
            onClick={() => setShowHelp(false)}
            className="mt-2 text-blue-600 font-semibold"
          >
            Close
          </button>
        </div>
      )}
    </>
  )
}
