/**
 * Pull a human-readable message from typical DRF / Axios error shapes.
 * @param {unknown} err
 */
export function getApiErrorMessage(err) {
  if (!err) return 'Something went wrong';
  if (typeof err === 'string') return err;
  const res = err.response?.data;
  if (typeof res === 'string') return res;
  if (res?.success === false && res?.errors?.detail != null) {
    const detail = res.errors.detail;
    if (typeof detail === 'string' && detail.trim()) return detail;
    if (Array.isArray(detail) && detail.length) return String(detail[0]);
  }
  if (res?.message) return String(res.message);
  if (typeof res?.detail === 'string' && res.detail.trim()) return String(res.detail);
  if (Array.isArray(res?.detail) && res.detail.length) return String(res.detail[0]);
  if (res?.error) return String(res.error);
  if (Array.isArray(res?.non_field_errors) && res.non_field_errors.length) {
    return String(res.non_field_errors[0]);
  }
  const fieldErrors = collectFieldErrors(res);
  if (fieldErrors) {
    const first = Object.values(fieldErrors)[0];
    if (first) return String(first);
  }
  const firstKey = res && typeof res === 'object' ? Object.keys(res)[0] : null;
  if (firstKey) {
    const val = res[firstKey];
    if (Array.isArray(val) && val.length) return `${firstKey}: ${val[0]}`;
    if (typeof val === 'string') return `${firstKey}: ${val}`;
  }
  if (err.message) return err.message;
  return 'Request failed';
}

/**
 * Field-level messages from DRF / project API wrapper (`errors` object).
 * @param {unknown} err
 * @returns {Record<string, string> | null}
 */
export function getApiFieldErrors(err) {
  const res = err?.response?.data;
  return collectFieldErrors(res);
}

/** @param {unknown} val */
function fieldEntryToMessage(val) {
  if (Array.isArray(val) && val.length) {
    return val
      .map((x) => String(x))
      .filter(Boolean)
      .join(' ');
  }
  if (typeof val === 'string' && val.trim()) return val.trim();
  return null;
}

/** @param {Record<string, unknown>} obj */
function flattenErrorDict(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      for (const [k2, v2] of Object.entries(v)) {
        const msg = fieldEntryToMessage(v2);
        if (msg) out[`${k}.${k2}`] = msg;
      }
      continue;
    }
    const msg = fieldEntryToMessage(v);
    if (msg) out[k] = msg;
  }
  return Object.keys(out).length ? out : null;
}

/** @param {unknown} res */
function collectFieldErrors(res) {
  if (!res || typeof res !== 'object') return null;
  if (res.errors && typeof res.errors === 'object' && !Array.isArray(res.errors)) {
    const flat = flattenErrorDict(res.errors);
    if (flat) return flat;
  }
  if (res.detail && typeof res.detail === 'object' && !Array.isArray(res.detail)) {
    const flat = flattenErrorDict(res.detail);
    if (flat) return flat;
  }
  const skip = new Set(['success', 'request_id', 'message', 'errors', 'detail', 'error']);
  const raw = {};
  for (const [k, v] of Object.entries(res)) {
    if (skip.has(k)) continue;
    const msg = fieldEntryToMessage(v);
    if (msg) raw[k] = msg;
  }
  return Object.keys(raw).length ? raw : null;
}
