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

describe('CRM opportunity scoring', () => {
  test('a strong-signal lead (no website, well-reviewed) auto-scores higher than a weak-signal one (has a website, no reviews)', async () => {
    const org = await createOrganization(sequelize.models, { type: 'agency' });
    const { user, password } = await createRoleAssignedMember(sequelize.models, { organizationId: org.id, roleKeys: ['sales_manager'] });
    const login = await loginAs(app, user.email, password);
    const auth = (r) => r.set('Authorization', `Bearer ${login.token}`);

    const strong = await auth(request(app).post('/api/v1/crm/opportunities').send({
      leadData: {
        name: 'Strong Signal Biz', googlePlaceId: uniquePlaceId('strong'), hasWebsite: false, rating: 4.8, reviewCount: 150,
      },
    }));
    expect(strong.status).toBe(201);
    expect(strong.body.data.opportunity.score).toBeGreaterThan(0);
    expect(strong.body.data.opportunity.scoreReason).toMatch(/no website/);

    const weak = await auth(request(app).post('/api/v1/crm/opportunities').send({
      leadData: {
        name: 'Weak Signal Biz', googlePlaceId: uniquePlaceId('weak'), hasWebsite: true, rating: null, reviewCount: 0,
      },
    }));
    expect(weak.status).toBe(201);

    expect(strong.body.data.opportunity.score).toBeGreaterThan(weak.body.data.opportunity.score);
  });

  test('manual score override persists exactly as given; recalculate-score overwrites it with a fresh auto-computed value', async () => {
    const org = await createOrganization(sequelize.models, { type: 'agency' });
    const { user, password } = await createRoleAssignedMember(sequelize.models, { organizationId: org.id, roleKeys: ['sales_manager'] });
    const login = await loginAs(app, user.email, password);
    const auth = (r) => r.set('Authorization', `Bearer ${login.token}`);

    const create = await auth(request(app).post('/api/v1/crm/opportunities').send({
      leadData: {
        name: 'Override Test Biz', googlePlaceId: uniquePlaceId('override'), hasWebsite: true, rating: null, reviewCount: 0,
      },
    }));
    const id = create.body.data.opportunity.id;
    const autoScore = create.body.data.opportunity.score;

    const override = await auth(request(app).put(`/api/v1/crm/opportunities/${id}`).send({
      score: 5, scoreReason: 'Talked to owner, not interested right now',
    }));
    expect(override.status).toBe(200);
    expect(override.body.data.opportunity.score).toBe(5);
    expect(override.body.data.opportunity.scoreReason).toBe('Talked to owner, not interested right now');

    const recalc = await auth(request(app).post(`/api/v1/crm/opportunities/${id}/recalculate-score`));
    expect(recalc.status).toBe(200);
    expect(recalc.body.data.opportunity.score).toBe(autoScore);
    expect(recalc.body.data.opportunity.scoreReason).toMatch(/^Auto-calculated/);
  });

  test('score must be between 0 and 100', async () => {
    const org = await createOrganization(sequelize.models, { type: 'agency' });
    const { user, password } = await createRoleAssignedMember(sequelize.models, { organizationId: org.id, roleKeys: ['sales_manager'] });
    const login = await loginAs(app, user.email, password);
    const auth = (r) => r.set('Authorization', `Bearer ${login.token}`);

    const create = await auth(request(app).post('/api/v1/crm/opportunities').send({
      leadData: { name: 'Score Bounds Biz', googlePlaceId: uniquePlaceId('bounds') },
    }));
    const id = create.body.data.opportunity.id;

    const tooHigh = await auth(request(app).put(`/api/v1/crm/opportunities/${id}`).send({ score: 150 }));
    expect(tooHigh.status).toBe(422);

    const tooLow = await auth(request(app).put(`/api/v1/crm/opportunities/${id}`).send({ score: -5 }));
    expect(tooLow.status).toBe(422);
  });
});
