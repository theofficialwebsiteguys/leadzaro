'use strict';

/**
 * Qualification of businesses already in Leadzaro, the sales handoff and
 * realistic outcomes (ADR 0017), through the API: the email-source link
 * bug, field-level errors with nothing written, early duplicate checks,
 * research added without resetting a lead, pending duplicate review, safe
 * retries, do-not-contact across outreach paths, outcomes, handoff
 * acceptance, saved progress, the chain filter and attribution.
 */
const crypto = require('node:crypto');
const request = require('supertest');
const app = require('../app');
const {
  sequelize, Opportunity, Organization, Lead, WorkCredit, ResearchClaim, LeadNote,
} = require('../models');
const chainFilter = require('../modules/sales/chainFilterService');
const { createOrganization, createRoleAssignedMember, loginAs } = require('./helpers/factory');

afterAll(async () => {
  await sequelize.close();
});

let agency;
const people = {};

async function member(name, roleKeys) {
  const { user, password } = await createRoleAssignedMember(sequelize.models, { organizationId: agency.id, roleKeys });
  await user.update({ name });
  const login = await loginAs(app, user.email, password);
  const call = (method, url, body) => {
    const req = request(app)[method](`/api/v1${url}`).set('Authorization', `Bearer ${login.token}`).set('X-Organization-Id', agency.id);
    return body ? req.send(body) : req;
  };
  people[name] = { user, call };
  return people[name];
}

const key = () => crypto.randomUUID();
const MAPS = 'https://www.google.com/maps/place/Test+Business';
let phoneSeq = 3000;
const phone = () => `(914) 555-${phoneSeq++}`;

function qualifyBody(name, extra = {}) {
  return {
    leadData: { name, city: 'Tarrytown', state: 'NY', googlePlaceId: `place_${key()}` },
    sources: { google: { status: 'found', url: MAPS }, website: { status: 'not_found' }, facebook: { status: 'not_found' } },
    contacts: { email: { status: 'not_found' }, phone: { status: 'found', values: [{ value: phone() }] }, owner: { status: 'not_found' } },
    reason: { tags: ['no_website'], text: 'No website found on the sources checked' },
    assigneeUserId: people.sales.user.id,
    ...extra,
  };
}

/** A lead sales added themselves (never qualified), optionally already contacted. */
async function salesLead(name, { phoneNumber = phone(), email = null, contacted = false } = {}) {
  const res = await people.sales.call('post', '/sales/leads', { leadData: { name, city: 'Rye', phone: phoneNumber }, email, confirmNew: true });
  expect(res.status).toBe(200);
  const id = res.body.data.opportunityId;
  if (contacted) await people.sales.call('post', `/sales/leads/${id}/outcomes`, { channel: 'call', outcome: 'no_answer', idempotencyKey: key() }).expect(200);
  return id;
}

beforeAll(async () => {
  agency = await createOrganization(sequelize.models, { type: 'agency' });
  await member('qualifier', ['lead_qualifier']);
  await member('qualifier2', ['lead_qualifier']);
  await member('sales', ['sales_representative']);
  await member('salesManager', ['sales_manager']);
  await member('admin', ['administrator']);
});

describe('Qualifying a business (ADR 0017)', () => {
  test('an email source typed as text is a choice, not a bad link: qualified first time, retry is safe', async () => {
    const { qualifier } = people;
    const submissionKey = key();
    const body = qualifyBody('Source Text Cafe', {
      submissionKey,
      contacts: {
        email: { status: 'found', values: [{ value: 'hello@sourcetext.example', sourceUrl: 'Facebook' }] },
        phone: { status: 'not_found' },
        owner: { status: 'not_found' },
      },
    });
    const first = await qualifier.call('post', '/sales/qualification', body);
    expect(first.status).toBe(200);
    const q = first.body.data.qualification;
    expect(q.status).toBe('assigned');
    expect(q.contacts.email.source).toMatchObject({ type: 'facebook', label: 'Facebook', url: null, legacyText: 'Facebook' });

    // The same submission again (a double click, a retry after a timeout) changes nothing.
    const retry = await qualifier.call('post', '/sales/qualification', body);
    expect(retry.status).toBe(200);
    expect(retry.body.data.alreadyComplete).toBe(true);
    expect(retry.body.data.qualification.opportunityId).toBe(q.opportunityId);
    expect(await Opportunity.count({ where: { organizationId: q.business.organizationId } })).toBe(1);
    expect(await WorkCredit.count({ where: { opportunityId: q.opportunityId } })).toBe(1);
  });

  test('a real problem is reported on its own field, with nothing written', async () => {
    const body = qualifyBody('Typo Tacos', {
      sources: { google: { status: 'found', url: MAPS }, website: { status: 'not_found' }, facebook: { status: 'found', url: 'Facebook' } },
      contacts: {
        email: { status: 'found', values: [{ value: 'tacos@typo.example', sourceType: 'website', sourceUrl: 'their contact page' }] },
        phone: { status: 'found', values: [{ value: phone() }] },
        owner: { status: 'not_found' },
      },
    });
    const before = await Opportunity.count();
    const res = await people.qualifier.call('post', '/sales/qualification', body);
    expect(res.status).toBe(422);
    expect(res.body.fields).toEqual(expect.objectContaining({
      'sources.facebook.url': expect.stringContaining('Facebook page'),
      'contacts.email.values.0.sourceUrl': expect.stringContaining('isn’t a web address'),
    }));
    expect(res.body.step).toBe(2);
    expect(await Opportunity.count()).toBe(before);
    expect(await Lead.count({ where: { googlePlaceId: body.leadData.googlePlaceId } })).toBe(0);

    // An empty optional link and a source chosen from the list are fine.
    const fixed = await people.qualifier.call('post', '/sales/qualification', {
      ...body,
      sources: { ...body.sources, facebook: { status: 'not_found' } },
      contacts: { ...body.contacts, email: { status: 'found', values: [{ value: 'tacos@typo.example', sourceType: 'privacy_policy', sourceUrl: '' }] } },
    });
    expect(fixed.status).toBe(200);
    expect(fixed.body.data.qualification.contacts.email.source).toMatchObject({ type: 'privacy_policy', url: null });
  });

  test('the early check explains a likely match without opening anything a qualifier can’t see', async () => {
    const number = phone();
    const existingId = await salesLead('Harbor Bakery', { phoneNumber: number });
    const res = await people.qualifier.call('post', '/sales/qualification/check', { leadData: { name: 'Harbour Bakery & Cafe', city: 'Tarrytown' }, phones: [number] });
    expect(res.status).toBe(200);
    const match = res.body.data.matches.find((m) => m.opportunityId === existingId);
    expect(match).toMatchObject({ confidence: 'strong', mode: 'qualify', mergeable: true, canOpen: false });
    expect(match.reasons).toContain('the same phone number');
    // A shared website alone is only a possible match (it may be another location).
    const site = await people.qualifier.call('post', '/sales/qualification/check', { leadData: { name: 'Something Else', city: 'Elsewhere', website: 'https://example-chain-site.com/locations/1' } });
    expect(site.body.data.matches).toEqual([]);
  });

  test('adding research to an existing lead keeps its owner, stage, notes and contacts', async () => {
    const { qualifier, sales } = people;
    const number = phone();
    const existingId = await salesLead('Hilltop Hardware', { phoneNumber: number, contacted: true });
    await sales.call('post', `/sales/leads/${existingId}/notes`, { content: 'Owner prefers calls after 3pm' }).expect(200);
    const before = await Opportunity.findByPk(existingId);
    expect(before.stage).toBe('contacting');

    const body = qualifyBody('Hilltop Hardware', {
      contacts: {
        email: { status: 'found', values: [{ value: 'shop@hilltop.example', sourceType: 'website' }] },
        phone: { status: 'found', values: [{ value: number }] },
        owner: { status: 'not_found' },
      },
      reason: { tags: ['relies_on_facebook'], text: 'Their Google listing links only to Facebook' },
    });
    const blocked = await qualifier.call('post', '/sales/qualification', body);
    expect(blocked.status).toBe(409);
    expect(blocked.body.code).toBe('strong_match');
    expect(await Lead.count({ where: { googlePlaceId: body.leadData.googlePlaceId } })).toBe(0);

    const merged = await qualifier.call('post', '/sales/qualification', { ...body, mergeIntoOpportunityId: existingId });
    expect(merged.status).toBe(200);
    expect(merged.body.data.qualification.opportunityId).toBe(existingId);
    const after = await Opportunity.findByPk(existingId);
    expect(after.stage).toBe('contacting');
    expect(after.assignedToUserId).toBe(sales.user.id);
    expect(after.qualificationStatus).toBe('assigned');
    expect(after.outreachReason).toBe('Their Google listing links only to Facebook');
    expect(await LeadNote.count({ where: { opportunityId: existingId } })).toBe(1);
    const credit = await WorkCredit.findOne({ where: { opportunityId: existingId } });
    expect(credit.userId).toBe(qualifier.user.id);
    expect(credit.note).toMatch(/already in Leadzaro/);

    // Sales edits the reason: the qualifier's original is kept and attributed.
    await sales.call('put', `/sales/leads/${existingId}/outreach-reason`, { reason: 'Only a Facebook page; owner asked about Google' }).expect(200);
    const ws = await sales.call('get', `/sales/leads/${existingId}`);
    expect(ws.body.data.briefing.observed).toBe('Only a Facebook page; owner asked about Google');
    expect(ws.body.data.briefing.original).toMatchObject({ text: 'Their Google listing links only to Facebook', by: { name: 'qualifier' } });
    expect(ws.body.data.briefing.emailOpener).toMatch(/Facebook is the main place people find Hilltop Hardware/);
    expect(ws.body.data.briefing.emailSource).toMatchObject({ type: 'website' });
  });

  test('an uncertain match can be saved for review: flagged, out of sales queues and uncredited until a manager decides', async () => {
    const { qualifier, admin, sales } = people;
    const number = phone();
    const existingId = await salesLead('Riverside Florist', { phoneNumber: number });
    const body = qualifyBody('Riverside Flowers', { contacts: { email: { status: 'not_found' }, phone: { status: 'found', values: [{ value: number }] }, owner: { status: 'not_found' } } });
    // "It's a different business" can't override a strong match for a qualifier.
    expect((await qualifier.call('post', '/sales/qualification', { ...body, confirmNew: true })).status).toBe(409);

    const saved = await qualifier.call('post', '/sales/qualification', { ...body, keepSeparate: true, reviewNote: 'Different shop name on the sign' });
    expect(saved.status).toBe(200);
    expect(saved.body.data.outcome).toBe('review');
    const reviewId = saved.body.data.qualification.opportunityId;
    expect(saved.body.data.qualification.status).toBe('needs_review');
    expect(await WorkCredit.count({ where: { opportunityId: reviewId } })).toBe(0);
    const queue = await sales.call('get', '/sales/queue');
    expect(queue.body.data.items.map((i) => i.opportunityId)).not.toContain(reviewId);

    expect((await qualifier.call('post', `/sales/qualification/${reviewId}/review`, { action: 'separate' })).status).toBe(403);
    const work = await admin.call('get', '/sales/my-work');
    expect(work.body.data.admin.reviews.map((r) => r.opportunityId)).toContain(reviewId);

    const resolved = await admin.call('post', `/sales/qualification/${reviewId}/review`, { action: 'separate', note: 'Checked — two shops' });
    expect(resolved.status).toBe(200);
    const record = await Opportunity.findByPk(reviewId);
    expect(record.qualificationStatus).toBe('assigned');
    expect(record.assignedToUserId).toBe(sales.user.id);
    expect((await WorkCredit.findOne({ where: { opportunityId: reviewId } })).userId).toBe(qualifier.user.id);
    expect((await Opportunity.findByPk(existingId)).qualificationStatus).toBeNull();
  });

  test('a duplicate settled as "same business" adds the research to the existing lead and retires the extra record', async () => {
    const { qualifier, admin } = people;
    const number = phone();
    const existingId = await salesLead('Maple Dental', { phoneNumber: number });
    const saved = await qualifier.call('post', '/sales/qualification', qualifyBody('Maple Dental Care', {
      keepSeparate: true,
      contacts: { email: { status: 'found', values: [{ value: 'front@mapledental.example', sourceType: 'google_business' }] }, phone: { status: 'found', values: [{ value: number }] }, owner: { status: 'not_found' } },
    }));
    const reviewId = saved.body.data.qualification.opportunityId;
    const res = await admin.call('post', `/sales/qualification/${reviewId}/review`, { action: 'merge', targetOpportunityId: existingId });
    expect(res.status).toBe(200);
    const retired = await Opportunity.findByPk(reviewId);
    expect(retired.archivedAt).not.toBeNull();
    expect(retired.mergedIntoOpportunityId).toBe(existingId);
    const target = await Opportunity.findByPk(existingId, { include: [{ model: Organization, as: 'organization' }] });
    expect(target.organization.email).toBe('front@mapledental.example');
    expect(target.qualificationStatus).toBe('assigned');
  });

  test('clients and do-not-contact businesses are identified and not put back into outreach', async () => {
    const number = phone();
    const id = await salesLead('Quiet Barber', { phoneNumber: number });
    await people.sales.call('put', `/sales/leads/${id}/do-not-contact`, { doNotContact: true, reason: 'Asked us to stop' }).expect(200);
    const check = await people.qualifier.call('post', '/sales/qualification/check', { leadData: { name: 'Quiet Barber', city: 'Rye' }, phones: [number] });
    const match = check.body.data.matches.find((m) => m.opportunityId === id);
    expect(match).toMatchObject({ mergeable: false, doNotContact: true });
    expect(match.reason).toMatch(/do not contact/);
    const attempt = await people.qualifier.call('post', '/sales/qualification', qualifyBody('Quiet Barber', { mergeIntoOpportunityId: id }));
    expect(attempt.status).toBe(409);
    expect((await Opportunity.findByPk(id)).doNotContact).toBe(true);
  });

  test('a manager can complete research someone parked, and "not relevant" isn’t blocked by a mistyped optional link', async () => {
    const parked = await people.qualifier.call('post', '/sales/qualification', qualifyBody('Odd Link Deli', {
      sources: { google: { status: 'found', url: MAPS }, website: { status: 'found', url: 'not a link at all' }, facebook: { status: 'not_checked' } },
      park: { status: 'unsuitable', note: 'Permanently closed' },
    }));
    expect(parked.status).toBe(200);
    expect(parked.body.data.qualification.status).toBe('unsuitable');
  });
});

describe('Sales handoff and outcomes (ADR 0017)', () => {
  async function qualified(name) {
    const res = await people.qualifier.call('post', '/sales/qualification', qualifyBody(name, {
      contacts: { email: { status: 'found', values: [{ value: `${key().slice(0, 8)}@lead.example`, sourceType: 'facebook' }] }, phone: { status: 'found', values: [{ value: phone() }] }, owner: { status: 'not_found' } },
    }));
    expect(res.status).toBe(200);
    return res.body.data.qualification.opportunityId;
  }

  test('the briefing shows what was observed, by whom, where the email came from, and a call talking point', async () => {
    const id = await qualified('Briefing Bistro');
    const ws = (await people.sales.call('get', `/sales/leads/${id}`)).body.data;
    expect(ws.briefing).toMatchObject({
      observed: 'No website found on the sources checked',
      missing: false,
      researchedBy: { name: 'qualifier' },
      emailSource: { type: 'facebook', label: 'Facebook' },
    });
    expect(ws.briefing.emailOpener).toBe('When I looked Briefing Bistro up online, I couldn’t find a website for the business.');
    expect(ws.briefing.talkingPoint.ask).toBeTruthy();
    expect(ws.briefing.relevance.length).toBe(1);
    const rendered = await people.sales.call('post', `/sales/leads/${id}/render`, { subject: 'Hi', body: '{{outreach_reason}}' });
    expect(rendered.body.data.body).toBe(ws.briefing.emailOpener);
  });

  test('sales accepts a handoff separately; contacting accepts it too; returning it keeps the research', async () => {
    const { sales } = people;
    const id = await qualified('Accept Me Auto');
    let ws = (await sales.call('get', `/sales/leads/${id}`)).body.data;
    expect(ws.qualificationBrief.pendingAcceptance).toBe(true);
    ws = (await sales.call('post', `/sales/leads/${id}/accept`)).body.data;
    expect(ws.qualificationBrief.pendingAcceptance).toBe(false);
    expect(ws.qualificationBrief.acceptedBy.name).toBe('sales');
    expect(ws.history.map((h) => h.label)).toEqual(expect.arrayContaining(['Qualified', 'Accepted by sales']));

    const second = await qualified('Implicit Accept Spa');
    await sales.call('post', `/sales/leads/${second}/outcomes`, { channel: 'call', outcome: 'no_answer', idempotencyKey: key() }).expect(200);
    expect((await Opportunity.findByPk(second)).salesAcceptedAt).not.toBeNull();

    await sales.call('post', `/sales/leads/${id}/return-to-qualifier`, { reason: 'Phone is disconnected' }).expect(200);
    const back = await Opportunity.findByPk(id);
    expect(back.qualificationStatus).toBe('needs_correction');
    expect(back.salesAcceptedAt).toBeNull();
    expect(back.research.sources.google.status).toBe('found');
    expect(back.research.returns[0].reason).toBe('Phone is disconnected');
  });

  test('outcomes keep stage, outcome and next action apart', async () => {
    const { sales } = people;
    const notNow = await qualified('Not Now Nails');
    let ws = (await sales.call('post', `/sales/leads/${notNow}/outcomes`, { channel: 'call', outcome: 'not_now', idempotencyKey: key() })).body.data;
    expect(ws.opportunity.stage).toBe('nurture');
    expect(ws.opportunity.lifecycle).toBe('nurture');
    expect(new Date(ws.opportunity.nextActionAt).getTime()).toBeGreaterThan(Date.now() + 80 * 86400000);

    const info = await qualified('Info Please Pizza');
    ws = (await sales.call('post', `/sales/leads/${info}/outcomes`, { channel: 'call', outcome: 'info_requested', idempotencyKey: key() })).body.data;
    expect(ws.opportunity.stage).toBe('contacting');
    expect(ws.opportunity.nextActionNote).toMatch(/information/);

    const unfit = await qualified('Wrong Fit Warehouse');
    ws = (await sales.call('post', `/sales/leads/${unfit}/outcomes`, { channel: 'call', outcome: 'not_a_fit', note: 'Wholesale only, no local customers', idempotencyKey: key() })).body.data;
    expect(ws.opportunity.stage).toBe('lost');
    expect(ws.opportunity.lifecycle).toBe('disqualified');
    expect(ws.opportunity.lostReason).toBe('Wholesale only, no local customers');
  });

  test('an explicit opt-out is respected by every outreach path, and only a manager can lift it', async () => {
    const { sales, salesManager } = people;
    const id = await qualified('Opt Out Optics');
    await sales.call('post', `/sales/leads/${id}/outcomes`, { channel: 'call', outcome: 'do_not_contact', note: 'Please stop calling', idempotencyKey: key() }).expect(200);

    const send = await sales.call('post', `/sales/leads/${id}/send`, { channel: 'email', subject: 'Hi', body: 'Hello', idempotencyKey: key() });
    expect(send.status).toBe(409);
    expect((await sales.call('post', `/sales/leads/${id}/calls`, { idempotencyKey: key() })).status).toBe(409);
    expect((await sales.call('post', `/sales/leads/${id}/draft-intro`, {})).status).toBe(409);
    expect((await sales.call('post', `/sales/leads/${id}/payment-requests`, { idempotencyKey: key() })).status).toBe(409);
    expect((await sales.call('post', `/sales/leads/${id}/outcomes`, { channel: 'call', outcome: 'no_answer', idempotencyKey: key() })).status).toBe(409);
    // A new deal for the same business is suppressed too.
    const extra = await sales.call('post', `/sales/leads/${id}/opportunities`, { title: 'Upsell' });
    expect((await Opportunity.findByPk(extra.body.data.opportunityId)).doNotContact).toBe(true);
    // Not in anyone's queue.
    expect((await sales.call('get', '/sales/queue')).body.data.items.map((i) => i.opportunityId)).not.toContain(id);

    expect((await sales.call('put', `/sales/leads/${id}/do-not-contact`, { doNotContact: false, reason: 'Oops' })).status).toBe(403);
    expect((await salesManager.call('put', `/sales/leads/${id}/do-not-contact`, { doNotContact: false })).status).toBe(422);
    const lifted = await salesManager.call('put', `/sales/leads/${id}/do-not-contact`, { doNotContact: false, reason: 'They called back asking for a quote' });
    expect(lifted.status).toBe(200);
    expect(lifted.body.data.opportunity.doNotContact).toBe(false);
    expect(lifted.body.data.history.map((h) => h.label)).toEqual(expect.arrayContaining(['Marked do not contact', 'Do-not-contact lifted']));
  });
});

describe('Saved progress and the chain filter (ADR 0017)', () => {
  test('research in progress is saved on the server, listed in My Work, and a teammate’s progress is protected', async () => {
    const { qualifier, qualifier2 } = people;
    const draftKey = `manual:${key()}`;
    const saved = await qualifier.call('put', `/sales/qualification/drafts/${draftKey}`, { start: { name: 'Draft Diner', source: 'manual' }, draft: { step: 3, business: { name: 'Draft Diner', city: 'Rye' } } });
    expect(saved.body.data.saved).toBe(true);
    const mine = await qualifier.call('get', '/sales/my-work');
    expect(mine.body.data.qualifier.drafts).toEqual(expect.arrayContaining([expect.objectContaining({ key: draftKey, businessName: 'Draft Diner', step: 3 })]));
    expect((await qualifier.call('get', `/sales/qualification/drafts/${draftKey}`)).body.data.draft.step).toBe(3);

    const other = await qualifier2.call('put', `/sales/qualification/drafts/${draftKey}`, { start: { name: 'Draft Diner' }, draft: { step: 1 } });
    expect(other.body.data.saved).toBe(false);
    expect(other.body.data.claimedBy.name).toBe('qualifier');
    expect((await qualifier2.call('get', `/sales/qualification/drafts/${draftKey}`)).status).toBe(404);

    // Deciding clears the saved progress.
    await qualifier.call('post', '/sales/qualification', qualifyBody('Draft Diner', { draftKey })).expect(200);
    expect(await ResearchClaim.count({ where: { googlePlaceId: draftKey } })).toBe(0);
  });

  test('obvious chains are excluded with a reason, exceptions are remembered, and only managers edit the brands', async () => {
    const { qualifier, admin } = people;
    const results = [
      { id: 'pf-1', googlePlaceId: 'pf-1', name: 'Planet Fitness', city: 'Tarrytown', website: 'https://www.planetfitness.com/gyms/tarrytown-ny' },
      { id: 'local-1', googlePlaceId: 'local-1', name: 'Ironworks Strength Club', city: 'Tarrytown', website: 'https://ironworksstrength.com' },
      { id: 'local-2', googlePlaceId: 'local-2', name: 'Life Time Roofing', city: 'Rye' },
    ];
    let annotated = await chainFilter.annotate(agency.id, results);
    expect(annotated[0].chain).toMatchObject({ status: 'excluded', brandName: 'Planet Fitness' });
    expect(annotated[1].chain.status).toBeNull();
    expect(annotated[2].chain.status).toBeNull();
    // Already in Leadzaro: never annotated.
    expect((await chainFilter.annotate(agency.id, [{ ...results[0], pipeline: { opportunityId: 'x' } }]))[0].chain).toBeUndefined();

    expect((await qualifier.call('post', '/sales/chain-filter/allowed-places', { googlePlaceId: 'pf-1', name: 'Planet Fitness' })).status).toBe(200);
    annotated = await chainFilter.annotate(agency.id, results);
    expect(annotated[0].chain.status).toBe('allowed');

    expect((await qualifier.call('put', '/sales/chain-filter/brands', { action: 'add', name: 'Ironworks Strength Club' })).status).toBe(403);
    const added = await admin.call('put', '/sales/chain-filter/brands', { action: 'add', name: 'Ironworks Strength Club', domains: 'ironworksstrength.com' });
    expect(added.status).toBe(200);
    annotated = await chainFilter.annotate(agency.id, results);
    expect(annotated[1].chain.status).toBe('excluded');
    await admin.call('put', '/sales/chain-filter/brands', { action: 'disable', key: 'planet_fitness' }).expect(200);
    await qualifier.call('delete', '/sales/chain-filter/allowed-places/pf-1').expect(200);
    annotated = await chainFilter.annotate(agency.id, results);
    expect(annotated[0].chain.status).not.toBe('excluded');
    const settings = await qualifier.call('get', '/sales/chain-filter');
    expect(settings.body.data.limits).toMatch(/hint/);
    expect(settings.body.data.canEditBrands).toBe(false);
  });

  test('role restrictions hold: qualifiers can’t open full leads or settle duplicates', async () => {
    const id = await salesLead('Restricted Records');
    expect((await people.qualifier.call('get', `/sales/leads/${id}`)).status).toBe(403);
    expect((await people.qualifier.call('post', `/sales/leads/${id}/accept`)).status).toBe(403);
    expect((await people.sales.call('post', `/sales/qualification/${id}/review`, { action: 'dismiss' })).status).toBe(403);
  });
});
