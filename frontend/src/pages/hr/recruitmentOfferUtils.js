/** Shared offer/candidate matching for recruitment dashboard and offers list. */

export const OFFER_SENT_STATUSES = new Set(['sent', 'accepted']);
export const OFFER_UNSENT_STATUSES = new Set(['draft', 'created']);
const PIPELINE_SENT_STAGES = new Set(['offer_sent', 'offer_accepted']);

export function candidateKey(value) {
  if (!value) return null;
  if (typeof value === 'object' && value.id != null) return String(value.id);
  return String(value);
}

export function offersForCandidate(offers, candidateId) {
  const key = String(candidateId);
  return (offers || []).filter((o) => candidateKey(o.candidate) === key);
}

export function buildersForCandidate(offerBuilders, candidateId) {
  const key = String(candidateId);
  return (offerBuilders || []).filter((b) => candidateKey(b.candidate) === key);
}

export function builderMarkedSent(offerBuilders, candidateId) {
  return buildersForCandidate(offerBuilders, candidateId).some((b) => b.is_sent === true);
}

export function candidateOfferAlreadySent(candidate, offers, offerBuilders = []) {
  if (candidate.has_active_offer === true) return true;

  const pipelineStage = candidate.pipeline_stage || '';
  if (PIPELINE_SENT_STAGES.has(pipelineStage)) return true;

  const offerStatus = candidate.offer_status || 'pending';
  if (OFFER_SENT_STATUSES.has(offerStatus) || offerStatus === 'declined') {
    return true;
  }

  if (builderMarkedSent(offerBuilders, candidate.id)) return true;

  return offersForCandidate(offers, candidate.id).some(
    (o) => OFFER_SENT_STATUSES.has(o.status),
  );
}

export function candidateHasUnsentOfferRecord(offers, candidateId, offerBuilders = []) {
  if (builderMarkedSent(offerBuilders, candidateId)) return false;
  return offersForCandidate(offers, candidateId).some(
    (o) => OFFER_UNSENT_STATUSES.has(o.status),
  );
}

export function candidateNeedsOfferLetter(candidate, offers, offerBuilders = []) {
  if (candidate.status !== 'selected') return false;
  if (candidateOfferAlreadySent(candidate, offers, offerBuilders)) return false;
  if (candidateHasUnsentOfferRecord(offers, candidate.id, offerBuilders)) return false;
  return true;
}

export function candidateRecruitmentSubtitle(candidate) {
  const dept = candidate.department_name || '';
  const job = candidate.job_opening_title || '';
  if (dept && job) return `${dept} · ${job}`;
  return dept || job || 'Candidate';
}

/** Route to open the offer letter builder for a candidate (matches offers list behavior). */
export function offerBuilderRoute(candidateId, offerBuilders = [], offerId = null) {
  const builders = buildersForCandidate(offerBuilders, candidateId);
  const builder = builders[0];
  if (builder?.id) {
    return `/hr/builder/${builder.id}`;
  }
  if (candidateId) {
    return `/hr/builder?candidate_id=${candidateId}`;
  }
  if (offerId) {
    return `/hr/builder?offer_id=${offerId}`;
  }
  return '/hr/recruitment/offers';
}
