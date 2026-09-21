export const PHARMACY_BASE = '/pharmacy'
export const DEFAULT_PHARMACY_SECTION = 'dashboard'
export const DEFAULT_PURCHASE_SUB_VIEW = 'entry'

export const SECTION_PATHS = {
  dashboard: `${PHARMACY_BASE}/dashboard`,
  drafts: `${PHARMACY_BASE}/drafts`,
  billing: `${PHARMACY_BASE}/sales`,
  purchase: `${PHARMACY_BASE}/purchase`,
  parties: `${PHARMACY_BASE}/parties`,
  inventory: `${PHARMACY_BASE}/inventory`,
  categories: `${PHARMACY_BASE}/categories`,
  history: `${PHARMACY_BASE}/register`,
  returns: `${PHARMACY_BASE}/returns`,
  settings_b2b: `${PHARMACY_BASE}/settings/b2b`,
  settings_b2c: `${PHARMACY_BASE}/settings/b2c`,
}

export const PURCHASE_SUB_VIEWS = {
  entry: 'entry',
  history: 'history',
}

const PATH_TO_SECTION = Object.entries(SECTION_PATHS).reduce((acc, [section, path]) => {
  acc[path] = section
  return acc
}, {})

export function pathForSection(section) {
  return SECTION_PATHS[section] || SECTION_PATHS[DEFAULT_PHARMACY_SECTION]
}

export function pathForPurchaseSubView(subView) {
  const base = SECTION_PATHS.purchase
  if (subView === 'history') {
    return `${base}/history`
  }
  return `${base}/entry`
}

export function matchPharmacyPath(pathname) {
  if (!pathname.startsWith(PHARMACY_BASE)) {
    return {
      section: DEFAULT_PHARMACY_SECTION,
      purchaseSubView: DEFAULT_PURCHASE_SUB_VIEW,
      canonicalPath: pathForSection(DEFAULT_PHARMACY_SECTION),
    }
  }

  // Handle bare /pharmacy
  if (pathname === PHARMACY_BASE || pathname === `${PHARMACY_BASE}/`) {
    return {
      section: DEFAULT_PHARMACY_SECTION,
      purchaseSubView: DEFAULT_PURCHASE_SUB_VIEW,
      canonicalPath: pathForSection(DEFAULT_PHARMACY_SECTION),
    }
  }

  // Handle purchase sub-views
  if (pathname.startsWith(`${SECTION_PATHS.purchase}/`)) {
    const subPath = pathname.slice(SECTION_PATHS.purchase.length + 1)
    if (subPath === 'history') {
      return {
        section: 'purchase',
        purchaseSubView: 'history',
        canonicalPath: pathForPurchaseSubView('history'),
      }
    }
    if (subPath === 'entry') {
      return {
        section: 'purchase',
        purchaseSubView: 'entry',
        canonicalPath: pathForPurchaseSubView('entry'),
      }
    }
    // Unknown purchase sub-view, default to entry
    return {
      section: 'purchase',
      purchaseSubView: 'entry',
      canonicalPath: pathForPurchaseSubView('entry'),
    }
  }

  // Handle purchase without sub-view (default to entry)
  if (pathname === SECTION_PATHS.purchase) {
    return {
      section: 'purchase',
      purchaseSubView: 'entry',
      canonicalPath: pathForPurchaseSubView('entry'),
    }
  }

  // Direct section match
  const section = PATH_TO_SECTION[pathname]
  if (section) {
    return {
      section,
      purchaseSubView: section === 'purchase' ? 'entry' : DEFAULT_PURCHASE_SUB_VIEW,
      canonicalPath: pathname,
    }
  }

  // Unknown path, redirect to default
  return {
    section: DEFAULT_PHARMACY_SECTION,
    purchaseSubView: DEFAULT_PURCHASE_SUB_VIEW,
    canonicalPath: pathForSection(DEFAULT_PHARMACY_SECTION),
  }
}
