'use strict';

const request = require('supertest');
const app = require('../app');
const { sequelize } = require('../models');
const { createOrganization, createRoleAssignedMember, loginAs } = require('./helpers/factory');

afterAll(async () => {
  await sequelize.close();
});

function uniquePlaceId(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

describe('CRM website audits', () => {
  test('generate creates an audit with a one-time share link; regenerating updates content but keeps the same link working', async () => {
    const org = await createOrganization(sequelize.models, { type: 'agency' });
    const { user, password } = await createRoleAssignedMember(sequelize.models, { organizationId: org.id, roleKeys: ['sales_manager'] });
    const login = await loginAs(app, user.email, password);
    const auth = (r) => r.set('Authorization', `Bearer ${login.token}`);

    const create = await auth(request(app).post('/api/v1/crm/opportunities').send({
      leadData: {
        name: 'No Website Biz', googlePlaceId: uniquePlaceId('audit1'), hasWebsite: false, rating: null, reviewCount: 0,
      },
    }));
    const id = create.body.data.opportunity.id;

    const first = await auth(request(app).post(`/api/v1/crm/opportunities/${id}/website-audit`));
    expect(first.status).toBe(200);
    expect(first.body.data.audit.checks.find((c) => c.key === 'has_website').passed).toBe(false);
    expect(first.body.data.shareUrl).toMatch(/\/audit\//);
    const token = first.body.data.shareUrl.split('/audit/')[1];

    const get = await auth(request(app).get(`/api/v1/crm/opportunities/${id}/website-audit`));
    expect(get.status).toBe(200);
    expect(get.body.data.audit.score).toBe(first.body.data.audit.score);

    // Regenerate — content can change, but no new link is issued...
    const second = await auth(request(app).post(`/api/v1/crm/opportunities/${id}/website-audit`));
    expect(second.status).toBe(200);
    expect(second.body.data.shareUrl).toBeUndefined();

    // ...and the original link still resolves to the (now-refreshed) report.
    const publicView = await request(app).get(`/api/v1/crm/public-audit/${token}`);
    expect(publicView.status).toBe(200);
    expect(publicView.body.data.businessName).toBe('No Website Biz');
  });

  test('the public report exposes only report fields, never internal CRM identifiers', async () => {
    const org = await createOrganization(sequelize.models, { type: 'agency' });
    const { user, password } = await createRoleAssignedMember(sequelize.models, { organizationId: org.id, roleKeys: ['sales_manager'] });
    const login = await loginAs(app, user.email, password);
    const auth = (r) => r.set('Authorization', `Bearer ${login.token}`);

    const create = await auth(request(app).post('/api/v1/crm/opportunities').send({
      leadData: {
        name: 'Exposure Check Biz', googlePlaceId: uniquePlaceId('audit2'), hasWebsite: true, website: 'https://example.test', rating: 4.7, reviewCount: 88,
      },
    }));
    const id = create.body.data.opportunity.id;
    const gen = await auth(request(app).post(`/api/v1/crm/opportunities/${id}/website-audit`));
    const token = gen.body.data.shareUrl.split('/audit/')[1];

    const publicView = await request(app).get(`/api/v1/crm/public-audit/${token}`);
    expect(publicView.status).toBe(200);
    const keys = Object.keys(publicView.body.data);
    expect(keys.sort()).toEqual(['businessName', 'checks', 'generatedAt', 'score', 'summary', 'website'].sort());
    expect(publicView.body.data.score).toBeGreaterThan(0);
  });

  test('an invalid share token returns 404; a rotated link invalidates the old token and issues a working new one', async () => {
    const org = await createOrganization(sequelize.models, { type: 'agency' });
    const { user, password } = await createRoleAssignedMember(sequelize.models, { organizationId: org.id, roleKeys: ['sales_manager'] });
    const login = await loginAs(app, user.email, password);
    const auth = (r) => r.set('Authorization', `Bearer ${login.token}`);

    const bogus = await request(app).get('/api/v1/crm/public-audit/not-a-real-token');
    expect(bogus.status).toBe(404);

    const create = await auth(request(app).post('/api/v1/crm/opportunities').send({
      leadData: { name: 'Rotate Link Biz', googlePlaceId: uniquePlaceId('audit3') },
    }));
    const id = create.body.data.opportunity.id;
    const gen = await auth(request(app).post(`/api/v1/crm/opportunities/${id}/website-audit`));
    const oldToken = gen.body.data.shareUrl.split('/audit/')[1];

    const rotate = await auth(request(app).post(`/api/v1/crm/opportunities/${id}/website-audit/rotate-link`));
    expect(rotate.status).toBe(200);
    const newToken = rotate.body.data.shareUrl.split('/audit/')[1];
    expect(newToken).not.toBe(oldToken);

    const oldTokenView = await request(app).get(`/api/v1/crm/public-audit/${oldToken}`);
    expect(oldTokenView.status).toBe(404);
    const newTokenView = await request(app).get(`/api/v1/crm/public-audit/${newToken}`);
    expect(newTokenView.status).toBe(200);
  });

  test('viewing/generating an audit is scoped to the caller\'s own agency; viewing before generation is a clean 404', async () => {
    const agencyA = await createOrganization(sequelize.models, { type: 'agency' });
    const agencyB = await createOrganization(sequelize.models, { type: 'agency' });
    const { user: userA, password: passwordA } = await createRoleAssignedMember(sequelize.models, { organizationId: agencyA.id, roleKeys: ['sales_manager'] });
    const { user: userB, password: passwordB } = await createRoleAssignedMember(sequelize.models, { organizationId: agencyB.id, roleKeys: ['sales_manager'] });

    const loginA = await loginAs(app, userA.email, passwordA);
    const authA = (r) => r.set('Authorization', `Bearer ${loginA.token}`);
    const create = await authA(request(app).post('/api/v1/crm/opportunities').send({
      leadData: { name: 'Isolated Audit Biz', googlePlaceId: uniquePlaceId('audit4') },
    }));
    const id = create.body.data.opportunity.id;

    const notYetGenerated = await authA(request(app).get(`/api/v1/crm/opportunities/${id}/website-audit`));
    expect(notYetGenerated.status).toBe(404);

    const loginB = await loginAs(app, userB.email, passwordB);
    const authB = (r) => r.set('Authorization', `Bearer ${loginB.token}`);
    const crossAgencyGenerate = await authB(request(app).post(`/api/v1/crm/opportunities/${id}/website-audit`));
    expect(crossAgencyGenerate.status).toBe(404);
  });
});
