'use strict';

const request = require('supertest');
const app = require('../app');
const { sequelize } = require('../models');
const { createOrganization, createRoleAssignedMember, loginAs } = require('./helpers/factory');
const { DisabledEnrichmentAdapter, MockEnrichmentAdapter } = require('../core/integrations/enrichment/enrichmentAdapter');

afterAll(async () => {
  await sequelize.close();
});

function uniquePlaceId(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

describe('Enrichment adapter (unit)', () => {
  test('DisabledEnrichmentAdapter reports not_configured rather than fabricating data or throwing', async () => {
    const result = await new DisabledEnrichmentAdapter().enrich({ businessName: 'Anything' });
    expect(result.status).toBe('not_configured');
    expect(result.provider).toBe('none');
    expect(result.data).toBeNull();
  });

  test('MockEnrichmentAdapter clearly labels its output as mock/demo data', async () => {
    const result = await new MockEnrichmentAdapter().enrich({ businessName: 'Acme Plumbing', category: 'Plumber' });
    expect(result.status).toBe('success');
    expect(result.provider).toBe('mock');
    expect(result.data.industry).toBe('Plumber');
    expect(result.data.note).toMatch(/mock|demonstration/i);
  });
});

describe('CRM enrichment (integration, mock provider — the test-environment default)', () => {
  test('requesting enrichment creates a result; viewing before requesting is a clean 404; re-requesting updates the same row in place', async () => {
    const org = await createOrganization(sequelize.models, { type: 'agency' });
    const { user, password } = await createRoleAssignedMember(sequelize.models, { organizationId: org.id, roleKeys: ['sales_manager'] });
    const login = await loginAs(app, user.email, password);
    const auth = (r) => r.set('Authorization', `Bearer ${login.token}`);

    const create = await auth(request(app).post('/api/v1/crm/opportunities').send({
      leadData: { name: 'Enrichment Test Biz', googlePlaceId: uniquePlaceId('enrich'), category: 'Bakery' },
    }));
    const id = create.body.data.opportunity.id;

    const notYet = await auth(request(app).get(`/api/v1/crm/opportunities/${id}/enrichment`));
    expect(notYet.status).toBe(404);

    const first = await auth(request(app).post(`/api/v1/crm/opportunities/${id}/enrich`));
    expect(first.status).toBe(200);
    expect(first.body.data.enrichment.status).toBe('success');
    expect(first.body.data.enrichment.provider).toBe('mock');
    expect(first.body.data.enrichment.data.industry).toBe('Bakery');
    const firstId = first.body.data.enrichment.id;

    const get = await auth(request(app).get(`/api/v1/crm/opportunities/${id}/enrichment`));
    expect(get.status).toBe(200);
    expect(get.body.data.enrichment.id).toBe(firstId);

    const second = await auth(request(app).post(`/api/v1/crm/opportunities/${id}/enrich`));
    expect(second.status).toBe(200);
    expect(second.body.data.enrichment.id).toBe(firstId);

    const { Enrichment } = sequelize.models;
    const count = await Enrichment.count({ where: { opportunityId: id } });
    expect(count).toBe(1);
  });

  test('enrichment requests/view are scoped to the caller\'s own agency', async () => {
    const agencyA = await createOrganization(sequelize.models, { type: 'agency' });
    const agencyB = await createOrganization(sequelize.models, { type: 'agency' });
    const { user: userA, password: passwordA } = await createRoleAssignedMember(sequelize.models, { organizationId: agencyA.id, roleKeys: ['sales_manager'] });
    const { user: userB, password: passwordB } = await createRoleAssignedMember(sequelize.models, { organizationId: agencyB.id, roleKeys: ['sales_manager'] });

    const loginA = await loginAs(app, userA.email, passwordA);
    const authA = (r) => r.set('Authorization', `Bearer ${loginA.token}`);
    const create = await authA(request(app).post('/api/v1/crm/opportunities').send({
      leadData: { name: 'Isolated Enrichment Biz', googlePlaceId: uniquePlaceId('enrichiso') },
    }));
    const id = create.body.data.opportunity.id;

    const loginB = await loginAs(app, userB.email, passwordB);
    const authB = (r) => r.set('Authorization', `Bearer ${loginB.token}`);
    const crossEnrich = await authB(request(app).post(`/api/v1/crm/opportunities/${id}/enrich`));
    expect(crossEnrich.status).toBe(404);
  });
});
