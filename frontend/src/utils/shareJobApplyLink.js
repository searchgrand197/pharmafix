import toast from 'react-hot-toast';
import { copyTextToClipboard } from './clipboard';
import { getJobApplyUrl, openJobApplyForm } from './publicUrls';

/**
 * Copy the public job apply URL to the clipboard.
 * Uses execCommand fallback so copy works on LAN HTTP (192.168.x.x).
 */
export async function shareJobApplyLink(job, { openTab = false } = {}) {
  const url = getJobApplyUrl(job);
  if (!url) {
    const label = typeof job === 'object' ? job?.title || job?.id : job;
    toast.error(`No apply link for this job${label ? ` (${label})` : ''} — job code is missing.`);
    return null;
  }

  if (url.includes('/hr/recruitment/jobs')) {
    toast.error('Invalid apply link generated. Please refresh the page and try again.');
    return null;
  }

  try {
    await copyTextToClipboard(url);
    toast.success('Application link copied to clipboard!');
  } catch {
    toast.error(`Could not copy automatically. Copy this link manually:\n${url}`, { duration: 8000 });
  }

  if (openTab) {
    openJobApplyForm(job);
  }

  return url;
}
