const CACHE_NAME = 'hms-app-v5'
const API_CACHE = 'hms-api-v5'

const PRECACHE_URLS = [
  '/',
  '/offline.html',
  '/manifest.json',
  '/manifest-doctor.json',
  '/manifest-staff.json',
  '/manifest-pharmacy.json',
  '/manifest-receptionist.json',
  '/icons/icon-192.svg',
  '/icons/icon-512.svg',
]

const API_CACHE_PATHS = [
  '/api/v1/pharmacy/dashboard/',
  '/api/v1/medicines/',
  '/api/v1/batches/',
  '/api/v1/pharmacy/settings/',
]

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE_URLS))
  )
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((k) => k !== CACHE_NAME && k !== API_CACHE)
          .map((k) => caches.delete(k))
      )
    )
  )
  self.clients.claim()
})

self.addEventListener('fetch', (event) => {
  const { request } = event
  const url = new URL(request.url)

  if (request.method !== 'GET') return

  // Let Vite dev (and any /src or /@vite URLs) hit the network untouched — avoids breaking dynamic imports.
  if (
    url.pathname.startsWith('/src/') ||
    url.pathname.startsWith('/@') ||
    url.pathname.includes('/node_modules/')
  ) {
    return
  }

  if (API_CACHE_PATHS.some((p) => url.pathname.startsWith(p))) {
    event.respondWith(networkFirstApi(request))
    return
  }

  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(cacheFirst(request))
    return
  }

  event.respondWith(networkFirstPage(request))
})

async function cacheFirst(request) {
  const cached = await caches.match(request)
  if (cached) return cached
  try {
    const response = await fetch(request)
    if (response.ok) {
      const cache = await caches.open(CACHE_NAME)
      cache.put(request, response.clone())
    }
    return response
  } catch {
    return new Response('', { status: 408 })
  }
}

async function networkFirstPage(request) {
  try {
    const response = await fetch(request)
    if (response.ok) {
      const cache = await caches.open(CACHE_NAME)
      cache.put(request, response.clone())
    }
    return response
  } catch {
    const cached = await caches.match(request)
    if (cached) return cached
    return caches.match('/offline.html')
  }
}

async function networkFirstApi(request) {
  try {
    const response = await fetch(request)
    if (response.ok) {
      const cache = await caches.open(API_CACHE)
      cache.put(request, response.clone())
    }
    return response
  } catch {
    const cached = await caches.match(request)
    if (cached) return cached
    return new Response(
      JSON.stringify({ success: false, detail: 'You are offline' }),
      { status: 503, headers: { 'Content-Type': 'application/json' } }
    )
  }
}

self.addEventListener('push', (event) => {
  let payload = {}
  try {
    payload = event.data ? event.data.json() : {}
  } catch {
    payload = { title: 'New Notification', body: event.data ? event.data.text() : '' }
  }

  const title = payload.title || 'New Notification'
  const options = {
    body: payload.body || '',
    icon: payload.icon || '/icons/icon-staff-192.png?v=4',
    badge: payload.badge || '/icons/icon-staff-192.png?v=4',
    data: {
      url: payload.url || '/staff',
    },
    tag: payload.tag || 'hms-notification',
    renotify: true,
    vibrate: [200, 100, 200, 100, 200],
    requireInteraction: true,
  }

  event.waitUntil(self.registration.showNotification(title, options))
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const targetUrl = event.notification?.data?.url || '/staff'
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      for (const client of windowClients) {
        if ('focus' in client && client.url.includes(targetUrl)) {
          return client.focus()
        }
      }
      if (clients.openWindow) return clients.openWindow(targetUrl)
      return null
    }),
  )
})
