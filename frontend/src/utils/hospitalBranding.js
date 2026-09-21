/** Tab title + PWA manifest; persisted for shell before portal chunks load. */
const STORAGE_NAME_KEY = 'reception_tab_hospital_name'
const STORAGE_PROFILE_KEY = 'hospital_branding_profile_json'

export const HOSPITAL_BRANDING_CHANGED = 'hospital-branding-changed'

/** @typedef {{ hospital_name?: string, address?: string, pin_code?: string, phone?: string, email?: string, website?: string }} ReceptionPortalRow */

/**
 * @param {ReceptionPortalRow | null | undefined} row
 */
export function syncHospitalBrandingFromApiRow(row) {
  const name = row?.hospital_name != null ? String(row.hospital_name).trim() : ''
  try {
    if (name) sessionStorage.setItem(STORAGE_NAME_KEY, name)
    else sessionStorage.removeItem(STORAGE_NAME_KEY)

    if (row && typeof row === 'object') {
      const slim = {
        hospital_name: row.hospital_name,
        address: row.address,
        pin_code: row.pin_code,
        phone: row.phone,
        email: row.email,
        website: row.website,
      }
      sessionStorage.setItem(STORAGE_PROFILE_KEY, JSON.stringify(slim))
    }
  } catch {
    /* quota / private mode */
  }
  window.dispatchEvent(new CustomEvent(HOSPITAL_BRANDING_CHANGED))
}

/** @param {string | null | undefined} name */
export function syncReceptionHospitalNameForTab(name) {
  syncHospitalBrandingFromApiRow({ hospital_name: name })
}

export function getHospitalNameForTab(fallback = 'Vardaan') {
  try {
    const s = sessionStorage.getItem(STORAGE_NAME_KEY)
    if (s && s.trim()) return s.trim()
  } catch {
    /* ignore */
  }
  return fallback
}

export function getReceptionHospitalNameForTab(fallback) {
  return getHospitalNameForTab(fallback)
}

/** @returns {ReceptionPortalRow | null} */
export function getHospitalBrandingProfile() {
  try {
    const raw = sessionStorage.getItem(STORAGE_PROFILE_KEY)
    if (raw) return JSON.parse(raw)
  } catch {
    /* ignore */
  }
  return null
}

function truncateShortName(s, maxLen = 12) {
  const t = String(s || '').trim()
  if (!t) return ''
  return t.length <= maxLen ? t : `${t.slice(0, maxLen - 1)}…`
}

function buildDescription(profile) {
  if (!profile || typeof profile !== 'object') return ''
  const parts = [profile.address, profile.pin_code, profile.phone].filter((x) => x != null && String(x).trim() !== '')
  return parts.join(' · ')
}

/** Role suffix in manifest `name` (after hospital name). */
const ROLE_MANIFEST_SUFFIX = {
  doctor: 'Doctor',
  pharmacy: 'Pharmacy',
  receptionist: 'Reception',
  staff: 'Staff',
  lab: 'Lab',
  admin: 'Admin',
}

const FALLBACK_SHORT = {
  doctor: 'Doctor',
  pharmacy: 'Pharmacy',
  receptionist: 'Reception',
  staff: 'Staff',
  lab: 'Lab',
  admin: 'Admin',
}

/** Base manifest bodies (icons, theme, scope) — aligned with frontend/public/manifest-*.json */
const MANIFEST_BASE = {
  doctor: {
    start_url: '/doctor',
    scope: '/',
    display: 'standalone',
    orientation: 'any',
    theme_color: '#0f172a',
    background_color: '#ffffff',
    icons: [
      { src: '/icons/icon-doctor-192.png', sizes: '192x192', type: 'image/png', purpose: 'any maskable' },
      { src: '/icons/icon-doctor-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
    ],
    description: 'Doctor web app',
  },
  pharmacy: {
    start_url: '/pharmacy',
    scope: '/',
    display: 'standalone',
    orientation: 'any',
    theme_color: '#0f172a',
    background_color: '#ffffff',
    icons: [
      { src: '/icons/icon-pharmacy-192.png', sizes: '192x192', type: 'image/png', purpose: 'any maskable' },
      { src: '/icons/icon-pharmacy-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
    ],
    description: 'Pharmacy web app',
  },
  receptionist: {
    start_url: '/receptionist',
    scope: '/',
    display: 'standalone',
    orientation: 'any',
    theme_color: '#0f172a',
    background_color: '#ffffff',
    icons: [
      { src: '/icons/icon-reception-192.png', sizes: '192x192', type: 'image/png', purpose: 'any maskable' },
      { src: '/icons/icon-reception-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
    ],
    description: 'Reception web app',
  },
  staff: {
    start_url: '/staff',
    scope: '/',
    display: 'standalone',
    orientation: 'any',
    theme_color: '#0f172a',
    background_color: '#ffffff',
    icons: [
      { src: '/icons/icon-staff-192.png', sizes: '192x192', type: 'image/png', purpose: 'any maskable' },
      { src: '/icons/icon-staff-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
    ],
    description: 'Staff web app',
  },
}

MANIFEST_BASE.lab = {
  ...MANIFEST_BASE.staff,
  start_url: '/lab',
  description: 'Lab web app',
}

MANIFEST_BASE.admin = {
  ...MANIFEST_BASE.staff,
  start_url: '/admin',
  description: 'Admin web app',
}

/** Same-origin manifest URL (installable; blob: URLs break Chrome PWA install). */
export function getPwaManifestUrl(roleKey, hospitalId) {
  const portal = roleKey && MANIFEST_BASE[roleKey] ? roleKey : 'staff'
  const params = new URLSearchParams()
  if (hospitalId != null && String(hospitalId).trim() !== '') {
    params.set('hospital_id', String(hospitalId).trim())
  }
  const qs = params.toString()
  return `/api/v1/pwa/manifest/${portal}/${qs ? `?${qs}` : ''}`
}

/**
 * @param {string} roleKey
 * @param {string} [hospitalName]
 * @param {ReceptionPortalRow | null} [profile]
 * @returns {string} blob: URL — caller must URL.revokeObjectURL when replacing
 * @deprecated Use getPwaManifestUrl — blob manifests are not installable in Chrome
 */
export function createManifestBlobUrl(roleKey, hospitalName, profile) {
  const displayName = (hospitalName && String(hospitalName).trim()) || getHospitalNameForTab()
  const suffix = ROLE_MANIFEST_SUFFIX[roleKey] || ROLE_MANIFEST_SUFFIX.staff
  const base = MANIFEST_BASE[roleKey] || MANIFEST_BASE.staff

  const name = `${displayName} – ${suffix}`
  const sn = truncateShortName(displayName, 12) || FALLBACK_SHORT[roleKey] || suffix
  const desc = buildDescription(profile) || base.description

  const manifest = {
    ...base,
    name,
    short_name: sn,
    description: desc,
  }

  const blob = new Blob([JSON.stringify(manifest)], { type: 'application/json' })
  return URL.createObjectURL(blob)
}
