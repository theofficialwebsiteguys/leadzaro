'use strict';

/**
 * Guided role-based workflow (ADR 0016), end to end through the API:
 * role restrictions, qualification drafts and completion, missing contact
 * details, outreach outcomes, duplicate-action protection, payment
 * confirmation versus closing approval, client conversion and onboarding,
 * work attribution, compensation review and time sessions.
 */
const crypto = require('node:crypto');
const request = require('supertest');
const app = require('../app');
const {
  sequelize, Opportunity, Organization, WorkCredit, ConversionAttempt, SalesHandoff, OutreachActivity, Notification,
} = require('../models');
const { createOrganization, createRoleAssignedMember, loginAs } = require('./helpers/factory');

afterAll(async () => {
  await sequelize.close();
});

let agency;
const people = {};

async function member(key, roleKeys) {
  const { user, password } = await createRoleAssignedMember(sequelize.models, { organizationId: agency.id, roleKeys });
  await user.update({ name: key });
  const login = await loginAs(app, user.email, password);
  const call = (method, url, body) => {
    const req = request(app)[method](`/api/v1${url}`).set('Authorization', `Bearer ${login.token}`).set('X-Organization-Id', agency.id);
    return body ? req.send(body) : req;
  };
  people[key] = { user, call };
  return people[key];
}

const key = () => crypto.randomUUID();
const MAPS = 'https://www.google.com/maps/place/Test+Business';

// Each business gets its own number: a shared phone is a strong duplicate match (ADR 0017).
let phoneSeq = 2000;
function research({ phone = `(914) 555-${phoneSeq++}` } = {}) {
  return {
    sources: { google: { status: 'found', url: MAPS }, website: { status: 'not_found' }, facebook: { status: 'unable' } },
    contacts: { email: { status: 'not_found' }, phone: phone ? { status: 'found', value: phone } : { status: 'not_found' }, owner: { status: 'not_found' } },
    reason: { tags: ['no_website'], text: 'No website found on the sources checked' },
  };
}

function qualifyBody(name, extra = {}) {
  return { leadData: { name, city: 'Tarrytown', state: 'NY', googlePlaceId: `place_${key()}` }, confirmNew: true, ...research(), ...extra };
}

/** Qualifies a business in one step (nothing exists before this) and returns the new lead's id. */
async function qualifiedLead(name, assignee = people.sales) {
  const res = await people.qualifier.call('post', '/sales/qualification', qualifyBody(name, { assigneeUserId: assignee.user.id }));
  expect(res.status).toBe(200);
  return res.body.data.qualification.opportunityId;
}

beforeAll(async () => {
  agency = await createOrganization(sequelize.models, { type: 'agency' });
  await member('qualifier', ['lead_qualifier']);
  await member('qualifier2', ['lead_qualifier']);
  await member('sales', ['sales_representative']);
  await member('sales2', ['sales_representative']);
  await member('manager', ['client_manager']);
  await member('manager2', ['client_manager']);
  await member('admin', ['administrator']);
});

describe('Guided workflow (ADR 0016)', () => {
  let leadId;

  test('roles are enforced on the server', async () => {
    const { qualifier, sales, manager } = people;
    for (const url of ['/sales/leads', '/sales/reports', '/clients', '/overview', '/sales/team-work', '/sales/closings', '/domains/renewals']) {
      expect((await qualifier.call('get', url)).status).toBe(403);
    }
    expect((await sales.call('get', '/overview')).status).toBe(403);
    expect((await sales.call('get', '/sales/team-work')).status).toBe(403);
    expect((await sales.call('get', '/sales/closings')).status).toBe(403);
    expect((await sales.call('get', '/domains/renewals')).status).toBe(403);
    expect((await manager.call('get', '/sales/leads')).status).toBe(403);
    expect((await people.admin.call('get', '/sales/team-work')).status).toBe(200);

    const myWork = await qualifier.call('get', '/sales/my-work');
    expect(myWork.status).toBe(200);
    expect(myWork.body.data.roles).toEqual(['qualifier']);
    expect(myWork.body.data.sales).toBeNull();
  });

  test('nothing is saved until the qualification is complete', async () => {
    const { qualifier, qualifier2 } = people;
    const before = await Opportunity.count();
    // A qualifier can't add a business as a lead without qualifying it.
    expect((await qualifier.call('post', '/sales/leads', { leadData: { name: 'Shortcut Cafe', city: 'Tarrytown' }, confirmNew: true })).status).toBe(403);
    // Incomplete research is rejected with what's missing — and creates nothing.
    const incomplete = await qualifier.call('post', '/sales/qualification', {
      ...qualifyBody('Half Done Diner'), sources: { google: { status: 'found', url: MAPS } }, assigneeUserId: people.sales.user.id,
    });
    expect(incomplete.status).toBe(422);
    expect(incomplete.body.missing.length).toBeGreaterThan(0);
    // Search pages aren't accepted as the business's links.
    const bad = await qualifier.call('post', '/sales/qualification', {
      ...qualifyBody('Search Link Grill'), sources: { ...research().sources, google: { status: 'found', url: 'https://www.google.com/search?q=grill' } }, assigneeUserId: people.sales.user.id,
    });
    expect(bad.status).toBe(422);
    expect(await Opportunity.count()).toBe(before);

    // Opening a result marks it as being researched, so a teammate knows.
    const placeId = `place_${key()}`;
    expect((await qualifier.call('post', '/sales/qualification/claim', { googlePlaceId: placeId, name: 'Claimed Bistro' })).body.data.claimed).toBe(true);
    const other = await qualifier2.call('post', '/sales/qualification/claim', { googlePlaceId: placeId, name: 'Claimed Bistro' });
    expect(other.body.data.claimedBy.id).toBe(qualifier.user.id);
  });

  test('qualifying a business already in Leads merges into it instead of duplicating', async () => {
    const { qualifier, sales } = people;
    // Sales added it directly, before anyone qualified it.
    const existing = await sales.call('post', '/sales/leads', { leadData: { name: 'Merge Test Pizzeria', city: 'Tarrytown', phone: '(914) 555-0142' }, confirmNew: true });
    expect(existing.status).toBe(200);
    const existingId = existing.body.data.opportunityId;

    const body = qualifyBody('Merge Test Pizzeria', {
      assigneeUserId: people.sales2.user.id,
      socials: [{ platform: 'instagram', url: 'https://www.instagram.com/mergetestpizza' }],
      contacts: {
        email: { status: 'found', values: [{ value: 'hello@mergetest.example' }, { value: 'orders@mergetest.example' }] },
        phone: { status: 'found', values: [{ value: '(914) 555-0142' }, { value: '(914) 555-0199', label: 'Mobile' }] },
        owner: { status: 'found', people: [{ name: 'Rosa Bianchi', title: 'Owner' }, { name: 'Luca Bianchi', title: 'Manager' }] },
      },
    });
    const dup = await qualifier.call('post', '/sales/qualification', { ...body, confirmNew: false });
    expect(dup.status).toBe(409);
    expect(dup.body.possibleDuplicates.map((d) => d.opportunityId)).toContain(existingId);

    const merged = await qualifier.call('post', '/sales/qualification', { ...body, confirmNew: false, mergeIntoOpportunityId: existingId });
    expect(merged.status).toBe(200);
    expect(merged.body.data.qualification.opportunityId).toBe(existingId);
    const opp = await Opportunity.findByPk(existingId);
    expect(opp.qualificationStatus).toBe('assigned');
    expect(opp.assignedToUserId).toBe(sales.user.id); // stays with its salesperson
    expect(opp.qualifiedByUserId).toBe(qualifier.user.id);
    expect(await WorkCredit.count({ where: { opportunityId: existingId } })).toBe(1);
    const org = await Organization.findByPk(opp.organizationId);
    expect(org.email).toBe('hello@mergetest.example');
    expect(org.socialLinks).toEqual([{ platform: 'instagram', url: 'https://www.instagram.com/mergetestpizza' }]);
    const contacts = await sequelize.models.Contact.findAll({ where: { organizationId: org.id } });
    expect(contacts.map((c) => c.email).filter(Boolean)).toContain('orders@mergetest.example');
    expect(contacts.map((c) => c.phone).filter(Boolean)).toContain('(914) 555-0199');
    expect(contacts.map((c) => c.name)).toEqual(expect.arrayContaining(['Rosa Bianchi', 'Luca Bianchi']));
    expect(await Opportunity.count({ where: { organizationId: opp.organizationId } })).toBe(1);

    // Already qualified: more research is added for its owner (ADR 0017) — no new credit, no change of status or owner.
    const again = await qualifier.call('post', '/sales/qualification', { ...body, mergeIntoOpportunityId: existingId });
    expect(again.status).toBe(200);
    expect(again.body.data.outcome).toBe('updated');
    expect(await WorkCredit.count({ where: { opportunityId: existingId } })).toBe(1);
    await opp.reload();
    expect(opp.assignedToUserId).toBe(sales.user.id);
    expect(opp.qualificationStatus).toBe('assigned');
  });

  test('without a usable email or phone the lead cannot go to sales, but can be parked', async () => {
    const res = await people.qualifier.call('post', '/sales/qualification', qualifyBody('No Contact Diner', { ...research({ phone: null }), assigneeUserId: people.sales.user.id }));
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('no_contact');
    const parked = await people.qualifier.call('post', '/sales/qualification', qualifyBody('No Contact Diner', { ...research({ phone: null }), park: { status: 'needs_research', note: 'Try their Instagram' } }));
    expect(parked.status).toBe(200);
    expect(parked.body.data.qualification.status).toBe('needs_research');
    const list = await people.sales.call('get', '/sales/leads?owner=all');
    expect(list.body.data.items.some((i) => i.opportunityId === parked.body.data.qualification.opportunityId)).toBe(false);
  });

  test('completing qualification creates one lead, assigns it, notifies, and credits once', async () => {
    const { qualifier, sales } = people;
    // Only sales employees can be chosen.
    expect((await qualifier.call('post', '/sales/qualification', qualifyBody('Wrong Assignee Pub', { assigneeUserId: people.manager.user.id }))).status).toBe(422);

    // Two clicks at once on the same listing create one lead.
    const body = qualifyBody('Bridge Test Tavern', { assigneeUserId: sales.user.id });
    const [first, second] = await Promise.all([qualifier.call('post', '/sales/qualification', body), qualifier.call('post', '/sales/qualification', body)]);
    expect([first.status, second.status].sort()).toEqual([200, 409]);
    leadId = (first.status === 200 ? first : second).body.data.qualification.opportunityId;
    const opp = await Opportunity.findByPk(leadId);
    expect(opp.qualificationStatus).toBe('assigned');
    expect(opp.assignedToUserId).toBe(sales.user.id);
    expect(opp.qualifiedByUserId).toBe(qualifier.user.id);
    expect(opp.outreachEvidence).toMatch(/Website: not found/);
    expect(await WorkCredit.count({ where: { opportunityId: leadId } })).toBe(1);
    expect(await Notification.count({ where: { userId: sales.user.id, type: 'lead_assignment', data: { opportunityId: leadId } } })).toBe(1);

    const myWork = await sales.call('get', '/sales/my-work');
    expect(myWork.body.data.sales.newlyAssigned.map((l) => l.opportunityId)).toContain(leadId);
    const ws = await sales.call('get', `/sales/leads/${leadId}`);
    expect(ws.body.data.qualificationBrief.qualifiedBy.id).toBe(qualifier.user.id);
    // Another qualifier can't open someone else's research; the sales workspace isn't a qualifier's to open.
    expect((await people.qualifier2.call('get', `/sales/qualification/${leadId}`)).status).toBe(404);
    expect((await qualifier.call('get', `/sales/leads/${leadId}`)).status).toBe(403);
  });

  test('outcomes record history and the next step; a repeated submit is saved once', async () => {
    const { sales } = people;
    const body = {
      channel: 'call', outcome: 'no_answer', idempotencyKey: key(), nextAction: { at: new Date(Date.now() + 86400000).toISOString(), type: 'call' },
    };
    await sales.call('post', `/sales/leads/${leadId}/outcomes`, body).expect(200);
    await sales.call('post', `/sales/leads/${leadId}/outcomes`, body).expect(200);
    expect(await OutreachActivity.count({ where: { opportunityId: leadId, outcome: 'no_answer' } })).toBe(1);
    const opp = await Opportunity.findByPk(leadId);
    expect(opp.stage).toBe('contacting');
    expect(opp.nextActionType).toBe('call');

    const interest = await sales.call('put', `/sales/leads/${leadId}/interest`, { level: 'hot' });
    expect(interest.body.data.opportunity.interestLevel).toBe('hot');
  });

  test('wrong contact returns the lead to its qualifier without a second credit', async () => {
    const { sales, qualifier } = people;
    await sales.call('post', `/sales/leads/${leadId}/outcomes`, {
      channel: 'call', outcome: 'wrong_contact', idempotencyKey: key(), returnToQualification: true, returnReason: 'Number belongs to another business',
      nextAction: { at: new Date(Date.now() + 86400000).toISOString() },
    }).expect(200);
    let opp = await Opportunity.findByPk(leadId);
    expect(opp.qualificationStatus).toBe('needs_correction');
    const credit = await WorkCredit.findOne({ where: { opportunityId: leadId } });
    expect(credit.correctionCount).toBe(1);
    expect(credit.status).toBe('needs_correction');
    const queue = await sales.call('get', '/sales/leads?owner=me');
    expect(queue.body.data.items.some((i) => i.opportunityId === leadId)).toBe(false);

    const work = await qualifier.call('get', '/sales/my-work');
    expect(work.body.data.qualifier.corrections.map((c) => c.opportunityId)).toContain(leadId);
    await qualifier.call('put', `/sales/qualification/${leadId}`, { contacts: { phone: { status: 'found', value: '(914) 555-0199' } } }).expect(200);
    await qualifier.call('post', `/sales/qualification/${leadId}/complete`, { assigneeUserId: sales.user.id }).expect(200);
    opp = await Opportunity.findByPk(leadId);
    expect(opp.qualificationStatus).toBe('assigned');
    expect(await WorkCredit.count({ where: { opportunityId: leadId } })).toBe(1);
    expect((await credit.reload()).status).toBe('pending');
  });

  test('do not contact stops outreach through the app', async () => {
    const id = await qualifiedLead('Quiet Bakery', people.sales);
    await people.sales.call('put', `/sales/leads/${id}/do-not-contact`, { doNotContact: true, reason: 'Asked us not to call' }).expect(200);
    expect((await people.sales.call('post', `/sales/leads/${id}/outcomes`, { channel: 'call', outcome: 'connected', idempotencyKey: key() })).status).toBe(409);
    expect((await people.sales.call('put', `/sales/leads/${id}/meeting`, { status: 'scheduled', at: new Date(Date.now() + 86400000).toISOString() })).status).toBe(409);
    expect((await people.sales.call('post', `/sales/leads/${id}/send`, { channel: 'email', to: 'x@example.test', subject: 's', body: 'b', idempotencyKey: key() })).status).toBe(409);
  });

  test('a confirmed payment is not a client until an admin approves the sale', async () => {
    const { sales, admin, manager, manager2 } = people;
    await sales.call('put', `/sales/leads/${leadId}/meeting`, {
      status: 'scheduled', method: 'video', at: new Date(Date.now() + 2 * 86400000).toISOString(), idempotencyKey: key(),
    }).expect(200);
    await sales.call('put', `/sales/leads/${leadId}/proposal`, {
      service: 'New website', scope: 'Five pages', setupCents: 150000, recurringCents: 5000, interval: 'month', markSent: true, sentVia: 'email', followUpAt: new Date(Date.now() + 3 * 86400000).toISOString(),
    }).expect(200);

    const link = await admin.call('post', `/sales/leads/${leadId}/payment-requests`, { customItems: [{ name: 'Website setup', amountCents: 150000 }], idempotencyKey: key() });
    expect(link.status).toBe(200);
    let opp = await Opportunity.findByPk(leadId);
    expect(opp.paymentConfirmedAt).toBeNull();

    await admin.call('post', `/sales/payment-requests/${link.body.data.id}/simulate-payment`).expect(200);
    opp = await Opportunity.findByPk(leadId);
    const org = await Organization.findByPk(opp.organizationId);
    expect(opp.paymentConfirmedAt).not.toBeNull();
    expect(opp.stage).toBe('awaiting_payment');
    expect(org.type).toBe('prospect');
    expect(await ConversionAttempt.count({ where: { opportunityId: leadId, status: 'completed' } })).toBe(0);
    // A replayed payment event is not paid twice.
    expect((await admin.call('post', `/sales/payment-requests/${link.body.data.id}/simulate-payment`)).status).toBe(409);

    expect((await sales.call('post', `/sales/leads/${leadId}/closing/approve`, { clientManagerUserId: manager.user.id })).status).toBe(403);
    const submitted = await sales.call('post', `/sales/leads/${leadId}/closing/submit`, { note: 'Paid in full' });
    expect(submitted.status).toBe(200);
    expect(submitted.body.data.opportunity.closingStatus).toBe('submitted');

    expect((await admin.call('post', `/sales/leads/${leadId}/closing/approve`, {})).status).toBe(422);
    const [a1, a2] = await Promise.all([
      admin.call('post', `/sales/leads/${leadId}/closing/approve`, { clientManagerUserId: manager.user.id }),
      admin.call('post', `/sales/leads/${leadId}/closing/approve`, { clientManagerUserId: manager.user.id }),
    ]);
    expect([a1.status, a2.status]).toEqual([200, 200]);
    expect(await ConversionAttempt.count({ where: { opportunityId: leadId, status: 'completed' } })).toBe(1);
    opp = await Opportunity.findByPk(leadId);
    expect(opp.stage).toBe('won');
    expect((await Organization.findByPk(opp.organizationId)).type).toBe('client');
    const handoff = await SalesHandoff.findOne({ where: { opportunityId: leadId } });
    expect(handoff.data.clientManagerUserId).toBe(manager.user.id);
    expect(handoff.data.qualifierName).toBe('qualifier');
    expect(handoff.data.outreachReason).toMatch(/No website found/);

    // Onboarding belongs to the assigned client manager.
    expect((await manager2.call('get', `/sales/onboarding/${leadId}`)).status).toBe(404);
    const onboarding = await manager.call('put', `/sales/onboarding/${leadId}`, { requirements: 'Menu page and online booking' });
    expect(onboarding.status).toBe(200);
    expect(onboarding.body.data.handoff.data.requirements).toBe('Menu page and online booking');
    const managerWork = await manager.call('get', '/sales/my-work');
    expect(managerWork.body.data.clientManager.newHandoffs.map((h) => h.opportunityId)).toContain(leadId);
  });

  test('an approved exception without payment needs a reason', async () => {
    const id = await qualifiedLead('Check Payer Cafe', people.sales2);
    expect((await people.sales2.call('post', `/sales/leads/${id}/closing/submit`, {})).status).toBe(422);
    await people.sales2.call('post', `/sales/leads/${id}/closing/submit`, { note: 'Paying by check on Friday' }).expect(200);
    const noReason = await people.admin.call('post', `/sales/leads/${id}/closing/approve`, { clientManagerUserId: people.manager.user.id });
    expect(noReason.status).toBe(422);
    expect(noReason.body.code).toBe('exception_required');
    await people.admin.call('post', `/sales/leads/${id}/closing/approve`, { clientManagerUserId: people.manager.user.id, exceptionReason: 'Owner known to us; check arranged' }).expect(200);
    expect(await ConversionAttempt.count({ where: { opportunityId: id, status: 'completed' } })).toBe(1);
  });

  test('attribution survives reassignment and compensation review is admin-only', async () => {
    const { admin, qualifier } = people;
    const id = await qualifiedLead('Reassigned Roofing', people.sales);
    await admin.call('post', `/sales/leads/${id}/assign`, { userId: people.sales2.user.id }).expect(200);
    const credit = await WorkCredit.findOne({ where: { opportunityId: id } });
    expect(credit.userId).toBe(qualifier.user.id);

    const report = await admin.call('get', `/sales/team-work?userId=${qualifier.user.id}`);
    const row = report.body.data.people[0];
    expect(row.qualifier.completed).toBe(await WorkCredit.count({ where: { userId: qualifier.user.id } }));

    expect((await qualifier.call('post', '/sales/team-work/credits/review', { ids: [credit.id], status: 'accepted' })).status).toBe(403);
    expect((await admin.call('post', '/sales/team-work/credits/review', { ids: [credit.id], status: 'rejected' })).status).toBe(422);
    await admin.call('post', '/sales/team-work/credits/review', { ids: [credit.id], status: 'accepted' }).expect(200);
    const paid = await admin.call('post', '/sales/team-work/credits/review', { ids: [credit.id], status: 'paid' });
    expect(paid.body.data.updated).toEqual([credit.id]);
    expect((await credit.reload()).paidAt).not.toBeNull();
    // Reviewing never touches the lead's operational state.
    expect((await Opportunity.findByPk(id)).qualificationStatus).toBe('assigned');
  });

  test('work sessions never overlap and corrections keep the original', async () => {
    const { sales } = people;
    await sales.call('post', '/sales/time/start', { workType: 'calls', opportunityId: leadId }).expect(200);
    expect((await sales.call('post', '/sales/time/start', { workType: 'calls' })).status).toBe(409);
    await sales.call('post', '/sales/time/pause').expect(200);
    await sales.call('post', '/sales/time/resume').expect(200);
    const stopped = await sales.call('post', '/sales/time/stop', { note: 'Morning calls' });
    expect(stopped.body.data.session).toBeNull();

    const start = new Date(Date.now() - 5 * 3600 * 1000).toISOString();
    await sales.call('post', '/sales/time/manual', { workType: 'research', minutes: 60, startedAt: start, note: 'Phone research' }).expect(200);
    expect((await sales.call('post', '/sales/time/manual', { workType: 'research', minutes: 30, startedAt: start, note: 'Again' })).status).toBe(409);
    const list = await sales.call('get', '/sales/time');
    const manual = list.body.data.items.find((s) => s.source === 'manual');
    const corrected = await sales.call('patch', `/sales/time/${manual.id}`, { minutes: 45, reason: 'Took a break' });
    expect(corrected.body.data).toMatchObject({ minutes: 45, originalMinutes: 60 });
    expect((await people.sales2.call('patch', `/sales/time/${manual.id}`, { minutes: 10, reason: 'x' })).status).toBe(403);
  });
});
