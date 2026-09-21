import test from 'node:test';
import assert from 'node:assert/strict';
import {
  candidateHasUnsentOfferRecord,
  candidateNeedsOfferLetter,
  candidateOfferAlreadySent,
  candidateRecruitmentSubtitle,
  offerBuilderRoute,
} from './recruitmentOfferUtils.js';

const CANDIDATE_ID = 'cand-1';

test('candidateOfferAlreadySent when Offer.status is sent', () => {
  const candidate = { id: CANDIDATE_ID, status: 'selected', offer_status: 'pending' };
  const offers = [{ candidate: CANDIDATE_ID, status: 'sent' }];
  assert.equal(candidateOfferAlreadySent(candidate, offers, []), true);
});

test('candidateOfferAlreadySent when has_active_offer is true', () => {
  const candidate = {
    id: CANDIDATE_ID,
    status: 'selected',
    offer_status: 'pending',
    has_active_offer: true,
  };
  assert.equal(candidateOfferAlreadySent(candidate, [], []), true);
});

test('candidateOfferAlreadySent when pipeline_stage is offer_sent', () => {
  const candidate = {
    id: CANDIDATE_ID,
    status: 'selected',
    offer_status: 'pending',
    pipeline_stage: 'offer_sent',
  };
  assert.equal(candidateOfferAlreadySent(candidate, [], []), true);
});

test('candidateOfferAlreadySent when OfferBuilderV2 is_sent', () => {
  const candidate = { id: CANDIDATE_ID, status: 'selected', offer_status: 'pending' };
  const builders = [{ candidate: CANDIDATE_ID, is_sent: true }];
  assert.equal(candidateOfferAlreadySent(candidate, [], builders), true);
});

test('candidateOfferAlreadySent matches nested candidate object on offers', () => {
  const candidate = { id: CANDIDATE_ID, status: 'selected', offer_status: 'pending' };
  const offers = [{ candidate: { id: CANDIDATE_ID }, status: 'accepted' }];
  assert.equal(candidateOfferAlreadySent(candidate, offers, []), true);
});

test('selected candidate without offer needs offer letter', () => {
  const candidate = { id: CANDIDATE_ID, status: 'selected', offer_status: 'pending' };
  assert.equal(candidateNeedsOfferLetter(candidate, [], []), true);
});

test('created offer only yields unsent record not send_offer need', () => {
  const candidate = { id: CANDIDATE_ID, status: 'selected', offer_status: 'pending' };
  const offers = [{ candidate: CANDIDATE_ID, status: 'created' }];
  assert.equal(candidateNeedsOfferLetter(candidate, offers, []), false);
  assert.equal(candidateHasUnsentOfferRecord(offers, CANDIDATE_ID, []), true);
});

test('builder is_sent suppresses unsent offer record flag', () => {
  const offers = [{ candidate: CANDIDATE_ID, status: 'created' }];
  const builders = [{ candidate: CANDIDATE_ID, is_sent: true }];
  assert.equal(candidateHasUnsentOfferRecord(offers, CANDIDATE_ID, builders), false);
});

test('candidateRecruitmentSubtitle shows department and job', () => {
  const subtitle = candidateRecruitmentSubtitle({
    department_name: 'Nursing',
    job_opening_title: 'Nursing Staff',
  });
  assert.equal(subtitle, 'Nursing · Nursing Staff');
});

test('offerBuilderRoute prefers existing builder draft', () => {
  const route = offerBuilderRoute(CANDIDATE_ID, [{ id: 'builder-9', candidate: CANDIDATE_ID }]);
  assert.equal(route, '/hr/builder/builder-9');
});

test('offerBuilderRoute falls back to candidate query param', () => {
  assert.equal(offerBuilderRoute(CANDIDATE_ID, []), `/hr/builder?candidate_id=${CANDIDATE_ID}`);
});

test('offerBuilderRoute falls back to offer query param', () => {
  assert.equal(offerBuilderRoute(null, [], 'offer-42'), '/hr/builder?offer_id=offer-42');
});
