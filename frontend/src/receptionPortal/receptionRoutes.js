/**
 * Reception portal URL map.
 *
 * The portal renders one component for `/receptionist/*` and picks the visible
 * section from the URL, so these ids must match the `NAV_GROUPS` item ids and
 * the settings tab ids inside ReceptionistPortal.jsx.
 */

export const RECEPTION_BASE = '/receptionist'

export const DEFAULT_RECEPTION_SECTION = 'opd'
export const DEFAULT_RECEPTION_SETTINGS_TAB = 'opd'

/** Section id → URL. Lookups are exact, so nested paths can never be ambiguous. */
export const SECTION_PATHS = {
  opd: `${RECEPTION_BASE}/opd`,
  opd_history: `${RECEPTION_BASE}/opd/slips`,
  ipd: `${RECEPTION_BASE}/ipd`,
  new_admission: `${RECEPTION_BASE}/ipd/new`,
  emergency: `${RECEPTION_BASE}/emergency`,
  patients: `${RECEPTION_BASE}/patients`,
  register: `${RECEPTION_BASE}/patients/register`,
  payment_slip: `${RECEPTION_BASE}/billing/payment-slip`,
  payment_slip_list: `${RECEPTION_BASE}/billing/payment-slips`,
  expense: `${RECEPTION_BASE}/billing/expense`,
  reports: `${RECEPTION_BASE}/reports`,
  discharge: `${RECEPTION_BASE}/discharge`,
  tpa: `${RECEPTION_BASE}/tpa`,
  attendance: `${RECEPTION_BASE}/attendance`,
  settings: `${RECEPTION_BASE}/settings`,
}

/** Settings tab id → URL slug. */
export const SETTINGS_TAB_SLUGS = {
  opd: 'opd',
  opd_template: 'opd-template',
  ipd_process: 'ipd-process',
  tv: 'tv',
  payment_slip: 'hospital',
}

const SECTION_BY_PATH = new Map(
  Object.entries(SECTION_PATHS).map(([section, path]) => [path, section]),
)

const SETTINGS_TAB_BY_PATH = new Map(
  Object.entries(SETTINGS_TAB_SLUGS).map(([tab, slug]) => [
    `${SECTION_PATHS.settings}/${slug}`,
    tab,
  ]),
)

/** Trailing slashes and casing should not change which screen is shown. */
function normalizePathname(pathname) {
  const value = String(pathname || '').split('?')[0].split('#')[0]
  const trimmed = value.length > 1 ? value.replace(/\/+$/, '') : value
  return trimmed || '/'
}

export function pathForSection(sectionId) {
  if (sectionId === 'settings') return pathForSettingsTab(DEFAULT_RECEPTION_SETTINGS_TAB)
  return SECTION_PATHS[sectionId] || SECTION_PATHS[DEFAULT_RECEPTION_SECTION]
}

export function pathForSettingsTab(tabId) {
  const slug = SETTINGS_TAB_SLUGS[tabId] || SETTINGS_TAB_SLUGS[DEFAULT_RECEPTION_SETTINGS_TAB]
  return `${SECTION_PATHS.settings}/${slug}`
}

/**
 * Resolve a pathname to the section (and settings tab) to render.
 *
 * `canonicalPath` is the URL the portal should be sitting on. When it differs
 * from the current pathname the caller redirects, which covers the bare
 * `/receptionist` entry point, bare `/receptionist/settings`, and unknown paths.
 */
export function matchReceptionPath(pathname) {
  const path = normalizePathname(pathname)

  const settingsTab = SETTINGS_TAB_BY_PATH.get(path)
  if (settingsTab) {
    return { section: 'settings', tab: settingsTab, canonicalPath: path }
  }

  const section = SECTION_BY_PATH.get(path)
  if (section === 'settings') {
    return {
      section: 'settings',
      tab: DEFAULT_RECEPTION_SETTINGS_TAB,
      canonicalPath: pathForSettingsTab(DEFAULT_RECEPTION_SETTINGS_TAB),
    }
  }
  if (section) {
    return { section, tab: DEFAULT_RECEPTION_SETTINGS_TAB, canonicalPath: path }
  }

  return {
    section: DEFAULT_RECEPTION_SECTION,
    tab: DEFAULT_RECEPTION_SETTINGS_TAB,
    canonicalPath: SECTION_PATHS[DEFAULT_RECEPTION_SECTION],
  }
}
