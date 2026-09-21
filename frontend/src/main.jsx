import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter, useLocation } from 'react-router-dom'
import { Toaster } from 'react-hot-toast'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ThemeProvider, CssBaseline } from '@mui/material'
import { getThemeForPortal, resolvePortalFromPath, baseTheme } from './themes'
import App from './App'
import InstallPrompt from './components/InstallPrompt'
import './index.css'

/** Capture install prompt before React mounts (avoids race with InstallPrompt). */
if (typeof window !== 'undefined') {
  window.__hmsDeferredInstallPrompt = null
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault()
    window.__hmsDeferredInstallPrompt = e
    window.dispatchEvent(new Event('hms-install-ready'))
  })
}

/** Register SW in production only — dev SW breaks Vite module loading. */
if (import.meta.env.DEV && 'serviceWorker' in navigator) {
  navigator.serviceWorker.getRegistrations().then((regs) => regs.forEach((r) => r.unregister())).catch(() => {})
}
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('/sw.js')
      .then((reg) => {
        reg.addEventListener('updatefound', () => {
          const newWorker = reg.installing
          if (!newWorker) return
          newWorker.addEventListener('statechange', () => {
            if (newWorker.state === 'activated' && navigator.serviceWorker.controller) {
              if (confirm('New version available! Reload to update?')) {
                window.location.reload()
              }
            }
          })
        })
      })
      .catch(() => {})
  })
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60 * 1000,
      retry: 1,
      refetchOnWindowFocus: 'always',
      refetchOnReconnect: 'always',
    },
  },
})

class RootErrorBoundary extends React.Component {
  constructor(props) {
    super(props)
    this.state = { error: null }
  }
  static getDerivedStateFromError(error) {
    return { error }
  }
  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: 24, fontFamily: 'system-ui', maxWidth: 640 }}>
          <h1 style={{ color: '#b91c1c' }}>App failed to render</h1>
          <pre style={{ background: '#f1f5f9', padding: 12, overflow: 'auto', fontSize: 13 }}>
            {String(this.state.error?.message || this.state.error)}
          </pre>
          <p style={{ fontSize: 14, color: '#64748b' }}>Open the browser devtools console for the full stack trace.</p>
        </div>
      )
    }
    return this.props.children
  }
}

/** Dynamically selects the MUI theme based on the current URL path. */
function DynamicThemeProvider({ children }) {
  const location = useLocation()
  const portal = resolvePortalFromPath(location.pathname)
  const theme = portal ? getThemeForPortal(portal) : baseTheme

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      {children}
    </ThemeProvider>
  )
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <RootErrorBoundary>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <DynamicThemeProvider>
          <App />
          <Toaster position="top-right" toastOptions={{ duration: 3000 }} />
          <InstallPrompt />
        </DynamicThemeProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </RootErrorBoundary>
)
