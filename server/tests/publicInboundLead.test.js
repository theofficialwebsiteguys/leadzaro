'use strict';

const request = require('supertest');
const app = require('../app');
const {
  sequelize, Organization, Opportunity, Contact, InboundSubmission,
} = require('../models');
const { createRoleAssignedMember, loginAs } = require('./helpers/factory');

afterAll(async () => {
  await sequelize.close();
});

function uniqueEmail(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2)}@example.test`;
}

async function getDefaultAgencyId() {
  const org = await Organization.findOne({ where: { type: 'agency', status: 'active' }, order: [['createdAt', 'ASC']] });
  return org.id;
}

describe('Public inbound lead submission', () => {
  test('a valid submission creates a prospect Organization + Opportunity + Contact + InboundSubmission under the default agency, visible through the normal authenticated pipeline', async () => {
    const email = uniqueEmail('inbound');
    const res = await request(app).post('/api/v1/public/inbound-leads').send({
      landingPageSlug: 'free-audit',
      contactName: 'Jane Prospect',
      contactEmail: email,
      contactPhone: '555-0100',
      businessName: 'Jane\'s Bakery',
      message: 'Interested in a free audit',
      utmSource: 'google',
      utmMedium: 'cpc',
      utmCampaign: 'spring-promo',
      referrer: 'https://google.com/search',
    });
    expect(res.status).toBe(200);
    expect(res.body.data.submitted).toBe(true);

    const contact = await Contact.findOne({ where: { email } });
    expect(contact).not.toBeNull();
    expect(contact.name).toBe('Jane Prospect');
    expect(contact.source).toBe('inbound_form');

    const opportunity = await Opportunity.findOne({ where: { organizationId: contact.organizationId } });
    expect(opportunity).not.toBeNull();
    expect(opportunity.sourceLeadId).toBeNull();
    expect(opportunity.assignedToUserId).toBeNull();

    const submission = await InboundSubmission.findOne({ where: { opportunityId: opportunity.id } });
    expect(submission.landingPageSlug).toBe('free-audit');
    expect(submission.requestedService).toBe('free-audit');
    expect(submission.utmSource).toBe('google');
    expect(submission.utmCampaign).toBe('spring-promo');

    const prospectOrg = await Organization.findByPk(contact.organizationId);
    expect(prospectOrg.name).toBe('Jane\'s Bakery');
    expect(prospectOrg.type).toBe('prospect');
    expect(prospectOrg.managingAgencyOrganizationId).toBe(opportunity.agencyOrganizationId);

    // Feeds the same inbound CRM: a real member of the receiving agency sees it.
    const { user, password } = await createRoleAssignedMember(sequelize.models, {
      organizationId: opportunity.agencyOrganizationId, roleKeys: ['sales_manager'],
    });
    const login = await loginAs(app, user.email, password);
    const list = await request(app).get('/api/v1/crm/opportunities')
      .set('Authorization', `Bearer ${login.token}`);
    const listed = list.body.data.items.find((o) => o.id === opportunity.id);
    expect(listed).toBeDefined();

    // The attribution that made this feature worth building in the first
    // place must actually be visible to the agency, not just stored.
    expect(listed.inboundSubmission.landingPageSlug).toBe('free-audit');
    expect(listed.inboundSubmission.utmSource).toBe('google');

    const detail = await request(app).get(`/api/v1/crm/opportunities/${opportunity.id}`)
      .set('Authorization', `Bearer ${login.token}`);
    expect(detail.body.data.opportunity.inboundSubmission.utmCampaign).toBe('spring-promo');
  });

  test('a filled honeypot field silently discards the submission (same success response, no records created)', async () => {
    const before = await Contact.count();
    const email = uniqueEmail('honeypot');

    const res = await request(app).post('/api/v1/public/inbound-leads').send({
      landingPageSlug: 'free-audit',
      contactName: 'Bot Submission',
      contactEmail: email,
      website: 'http://spam.example.test',
    });
    expect(res.status).toBe(200);
    expect(res.body.data.submitted).toBe(true);

    const after = await Contact.count();
    expect(after).toBe(before);
    const contact = await Contact.findOne({ where: { email } });
    expect(contact).toBeNull();
  });

  test('rejects an unknown landing page and a missing contact name', async () => {
    const badSlug = await request(app).post('/api/v1/public/inbound-leads').send({
      landingPageSlug: 'not-a-real-campaign',
      contactName: 'Test',
    });
    expect(badSlug.status).toBe(422);

    const missingName = await request(app).post('/api/v1/public/inbound-leads').send({
      landingPageSlug: 'free-audit',
    });
    expect(missingName.status).toBe(422);
  });

  test('resolves to the default (oldest) agency organization regardless of other agencies created later', async () => {
    const defaultAgencyId = await getDefaultAgencyId();
    const email = uniqueEmail('defaultagency');

    const res = await request(app).post('/api/v1/public/inbound-leads').send({
      landingPageSlug: 'starter-website',
      contactName: 'Default Agency Check',
      contactEmail: email,
    });
    expect(res.status).toBe(200);

    const contact = await Contact.findOne({ where: { email } });
    expect(contact.agencyOrganizationId).toBe(defaultAgencyId);
  });
});
