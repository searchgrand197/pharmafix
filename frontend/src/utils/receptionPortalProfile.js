import api from '../api'
import {
  DEFAULT_DOCUMENT_NUMBER_PARTS,
  normalizeDocumentNumberFormats,
} from './documentNumberFormat'

const DEFAULT_PROFILE = {
  hospital_name: '',
  address: '',
  pin_code: '',
  phone: '',
  email: '',
  website: '',
  hospital_logo_url: '',
  uhid_prefix: 'DEF',
  invoice_prefix: 'INV',
  invoice_next_number: 1,
  document_number_formats: normalizeDocumentNumberFormats(DEFAULT_DOCUMENT_NUMBER_PARTS),
}

let cache = { ...DEFAULT_PROFILE }

export async function loadReceptionPortalProfileCache() {
  try {
    const { data } = await api.get('/settings/reception-portal/')
    const row = data?.data || data || {}
    cache = {
      ...DEFAULT_PROFILE,
      hospital_name: row.hospital_name ?? '',
      address: row.address ?? '',
      pin_code: row.pin_code ?? '',
      phone: row.phone ?? '',
      email: row.email ?? '',
      website: row.website ?? '',
      hospital_logo_url: row.hospital_logo_url ?? row.hospital_logo ?? '',
      uhid_prefix: row.uhid_prefix ?? DEFAULT_PROFILE.uhid_prefix,
      invoice_prefix: row.invoice_prefix ?? DEFAULT_PROFILE.invoice_prefix,
      invoice_next_number: Number(row.invoice_next_number) > 0
        ? Number(row.invoice_next_number)
        : DEFAULT_PROFILE.invoice_next_number,
      document_number_formats: normalizeDocumentNumberFormats(
        row.document_number_formats ?? DEFAULT_PROFILE.document_number_formats,
      ),
    }
  } catch {
    // keep cache
  }
  return cache
}

export function getPaymentSlipProfile() {
  return { ...cache }
}

export function mergeReceptionPortalProfileFromRow(row) {
  if (!row || typeof row !== 'object') return
  cache = {
    ...cache,
    hospital_name: row.hospital_name ?? '',
    address: row.address ?? '',
    pin_code: row.pin_code ?? '',
    phone: row.phone ?? '',
    email: row.email ?? '',
    website: row.website ?? '',
    hospital_logo_url: row.hospital_logo_url ?? row.hospital_logo ?? cache.hospital_logo_url,
    uhid_prefix: row.uhid_prefix ?? cache.uhid_prefix,
    invoice_prefix: row.invoice_prefix ?? cache.invoice_prefix,
    invoice_next_number: Number(row.invoice_next_number) > 0
      ? Number(row.invoice_next_number)
      : cache.invoice_next_number,
    document_number_formats: normalizeDocumentNumberFormats(
      row.document_number_formats ?? cache.document_number_formats,
    ),
  }
}

export { DEFAULT_PROFILE, DEFAULT_DOCUMENT_NUMBER_PARTS as DEFAULT_DOCUMENT_NUMBER_FORMATS, normalizeDocumentNumberFormats }
