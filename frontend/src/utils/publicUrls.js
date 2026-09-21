/**
 * Public URLs for server-rendered pages (job apply form, etc.).
 */
function getPublicSiteOrigin() {
  if (typeof window === 'undefined' || !window.location?.origin) {
    return 'http://localhost:8000';
  }

  const { protocol, hostname, port, origin } = window.location;
  // Vite dev serves the HR SPA on :5173; public apply forms are on Django :8000.
  if (port === '5173') {
    return `${protocol}//${hostname}:8000`;
  }

  return origin.replace(/\/$/, '');
}

function extractJobCode(job) {
  if (!job) return '';
  if (typeof job === 'string') return job.trim();

  const direct = job.job_code?.trim();
  if (direct) return direct;

  const applyUrl = job.apply_url;
  if (typeof applyUrl === 'string' && applyUrl) {
    const match = applyUrl.match(/\/jobs\/([^/?#]+)\/apply\/?(?:[?#]|$)/i);
    if (match?.[1]) {
      try {
        return decodeURIComponent(match[1]).trim();
      } catch {
        return match[1].trim();
      }
    }
  }

  return '';
}

export function getJobApplyUrl(job) {
  const code = extractJobCode(job);
  if (!code) return '';

  return `${getPublicSiteOrigin()}/jobs/${encodeURIComponent(code)}/apply/`;
}

/**
 * Open the public apply form in a new tab (full page load — bypasses React Router).
 */
export function openJobApplyForm(job) {
  const url = getJobApplyUrl(job);
  if (!url) return false;

  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.target = '_blank';
  anchor.rel = 'noopener noreferrer';
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  return true;
}
