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

describe('CRM opportunities', () => {
  test('create -> list -> stage update -> claim -> archive -> restore, and duplicate create is rejected', async () => {
    const org = await createOrganization(sequelize.models, { type: 'agency' });
    const { user, password } = await createRoleAssignedMember(sequelize.models, { organizationId: org.id, roleKeys: ['sales_representative'] });
    const login = await loginAs(app, user.email, password);
    const auth = (r) => r.set('Authorization', `Bearer ${login.token}`);

    const leadData = { name: 'CRM Test Biz', googlePlaceId: uniquePlaceId('crm') };
    const create = await auth(request(app).post('/api/v1/crm/opportunities').send({ leadData }));
    expect(create.status).toBe(201);
    expect(create.body.data.organization.type).toBe('prospect');
    expect(create.body.data.organization.managingAgencyOrganizationId).toBe(org.id);
    const opportunityId = create.body.data.opportunity.id;
    expect(create.body.data.opportunity.assignedToUserId).toBe(user.id);

    const dup = await auth(request(app).post('/api/v1/crm/opportunities').send({ leadData }));
    expect(dup.status).toBe(409);

    const list = await auth(request(app).get('/api/v1/crm/opportunities'));
    expect(list.status).toBe(200);
    expect(list.body.data.items.find((o) => o.id === opportunityId)).toBeDefined();

    const updateStage = await auth(request(app).put(`/api/v1/crm/opportunities/${opportunityId}`).send({ stage: 'Qualified', score: 80, scoreReason: 'Strong fit' }));
    expect(updateStage.status).toBe(200);
    expect(updateStage.body.data.opportunity.stage).toBe('Qualified');

    const badStage = await auth(request(app).put(`/api/v1/crm/opportunities/${opportunityId}`).send({ stage: 'Not A Real Stage' }));
    expect(badStage.status).toBe(422);

    const archive = await auth(request(app).post(`/api/v1/crm/opportunities/${opportunityId}/archive`));
    expect(archive.status).toBe(200);

    const listAfterArchive = await auth(request(app).get('/api/v1/crm/opportunities'));
    expect(listAfterArchive.body.data.items.find((o) => o.id === opportunityId)).toBeUndefined();

    const restore = await auth(request(app).post(`/api/v1/crm/opportunities/${opportunityId}/restore`));
    expect(restore.status).toBe(200);
  });

  test('claim is rejected once already assigned; manager assign requires leads.assign; round-robin picks the least-loaded eligible rep', async () => {
    const org = await createOrganization(sequelize.models, { type: 'agency' });
    const { user: manager, password: managerPassword } = await createRoleAssignedMember(sequelize.models, { organizationId: org.id, roleKeys: ['sales_manager'] });
    const { user: repA, password: repAPassword } = await createRoleAssignedMember(sequelize.models, { organizationId: org.id, roleKeys: ['sales_representative'] });
    const { user: repB } = await createRoleAssignedMember(sequelize.models, { organizationId: org.id, roleKeys: ['sales_representative'] });

    const managerLogin = await loginAs(app, manager.email, managerPassword);
    const repALogin = await loginAs(app, repA.email, repAPassword);

    // repA already has one opportunity assigned (from creating it)...
    const create1 = await request(app).post('/api/v1/crm/opportunities')
      .set('Authorization', `Bearer ${repALogin.token}`)
      .send({ leadData: { name: 'RR Target 1', googlePlaceId: uniquePlaceId('rr1') } });
    expect(create1.status).toBe(201);

    // ...so a fresh opportunity's round-robin assignment should prefer repB (0 load) over repA (1 load).
    const create2 = await request(app).post('/api/v1/crm/opportunities')
      .set('Authorization', `Bearer ${managerLogin.token}`)
      .send({ leadData: { name: 'RR Target 2', googlePlaceId: uniquePlaceId('rr2') } });
    const opp2Id = create2.body.data.opportunity.id;

    const roundRobin = await request(app).post(`/api/v1/crm/opportunities/${opp2Id}/round-robin-assign`)
      .set('Authorization', `Bearer ${managerLogin.token}`);
    expect(roundRobin.status).toBe(200);
    expect(roundRobin.body.data.opportunity.assignedToUserId).toBe(repB.id);

    // A sales rep cannot manually assign to someone else (lacks leads.assign)...
    const forbiddenAssign = await request(app).post(`/api/v1/crm/opportunities/${opp2Id}/assign`)
      .set('Authorization', `Bearer ${repALogin.token}`)
      .send({ userId: repA.id });
    expect(forbiddenAssign.status).toBe(403);

    // ...but the manager can.
    const managerAssign = await request(app).post(`/api/v1/crm/opportunities/${opp2Id}/assign`)
      .set('Authorization', `Bearer ${managerLogin.token}`)
      .send({ userId: repA.id });
    expect(managerAssign.status).toBe(200);
    expect(managerAssign.body.data.opportunity.assignedToUserId).toBe(repA.id);

    // Claiming an already-assigned opportunity is rejected.
    const claimAttempt = await request(app).post(`/api/v1/crm/opportunities/${opp2Id}/claim`)
      .set('Authorization', `Bearer ${repALogin.token}`);
    expect(claimAttempt.status).toBe(409);
  });

  test('round-robin load count excludes closed opportunities, so a rep with only closed deals is not treated as busier than one with open work', async () => {
    const org = await createOrganization(sequelize.models, { type: 'agency' });
    const { user: manager, password: managerPassword } = await createRoleAssignedMember(sequelize.models, { organizationId: org.id, roleKeys: ['sales_manager'] });
    const { user: repA, password: repAPassword } = await createRoleAssignedMember(sequelize.models, { organizationId: org.id, roleKeys: ['sales_representative'] });
    const { user: repB, password: repBPassword } = await createRoleAssignedMember(sequelize.models, { organizationId: org.id, roleKeys: ['sales_representative'] });

    const managerLogin = await loginAs(app, manager.email, managerPassword);
    const repALogin = await loginAs(app, repA.email, repAPassword);
    const repBLogin = await loginAs(app, repB.email, repBPassword);

    // repA closes out two deals (no longer open work)...
    for (const suffix of ['closed1', 'closed2']) {
      const created = await request(app).post('/api/v1/crm/opportunities')
        .set('Authorization', `Bearer ${repALogin.token}`)
        .send({ leadData: { name: `Closed Deal ${suffix}`, googlePlaceId: uniquePlaceId(suffix) } });
      await request(app).put(`/api/v1/crm/opportunities/${created.body.data.opportunity.id}`)
        .set('Authorization', `Bearer ${managerLogin.token}`)
        .send({ stage: 'Closed Won' });
    }

    // ...while repB has one open opportunity.
    await request(app).post('/api/v1/crm/opportunities')
      .set('Authorization', `Bearer ${repBLogin.token}`)
      .send({ leadData: { name: 'RR Open Deal', googlePlaceId: uniquePlaceId('rropen') } });

    // A fresh opportunity (assigned to the manager on creation) should
    // round-robin to repA: repA's open load is 0 (closed deals excluded),
    // even though repA has more total historical opportunities than repB.
    const fresh = await request(app).post('/api/v1/crm/opportunities')
      .set('Authorization', `Bearer ${managerLogin.token}`)
      .send({ leadData: { name: 'RR Target Fresh', googlePlaceId: uniquePlaceId('rrfresh') } });
    const roundRobin = await request(app).post(`/api/v1/crm/opportunities/${fresh.body.data.opportunity.id}/round-robin-assign`)
      .set('Authorization', `Bearer ${managerLogin.token}`);
    expect(roundRobin.status).toBe(200);
    expect(roundRobin.body.data.opportunity.assignedToUserId).toBe(repA.id);
  });

  test('opportunities are isolated between two different agency organizations (cross-agency proof)', async () => {
    // Second, independent fixture agency — per the mandated Phase 2
    // architecture review, a single-real-agency test suite cannot prove
    // agencyOrganizationId-based isolation actually holds.
    const agencyA = await createOrganization(sequelize.models, { type: 'agency' });
    const agencyB = await createOrganization(sequelize.models, { type: 'agency' });

    const { user: userA, password: passwordA } = await createRoleAssignedMember(sequelize.models, { organizationId: agencyA.id, roleKeys: ['sales_representative'] });
    const { user: userB, password: passwordB } = await createRoleAssignedMember(sequelize.models, { organizationId: agencyB.id, roleKeys: ['sales_representative'] });

    const loginA = await loginAs(app, userA.email, passwordA);
    const create = await request(app).post('/api/v1/crm/opportunities')
      .set('Authorization', `Bearer ${loginA.token}`)
      .send({ leadData: { name: 'Isolated CRM Target', googlePlaceId: uniquePlaceId('iso') } });
    expect(create.status).toBe(201);
    const opportunityId = create.body.data.opportunity.id;

    const loginB = await loginAs(app, userB.email, passwordB);
    const listB = await request(app).get('/api/v1/crm/opportunities').set('Authorization', `Bearer ${loginB.token}`);
    expect(listB.body.data.items.find((o) => o.id === opportunityId)).toBeUndefined();

    const directB = await request(app).get(`/api/v1/crm/opportunities/${opportunityId}`).set('Authorization', `Bearer ${loginB.token}`);
    expect(directB.status).toBe(404);

    // The same business (by googlePlaceId) can independently become a
    // *different* prospect Organization for agency B — no sharing.
    const { Lead } = sequelize.models;
    const lead = await Lead.findOne({ where: { name: 'Isolated CRM Target' } });
    const createB = await request(app).post('/api/v1/crm/opportunities')
      .set('Authorization', `Bearer ${loginB.token}`)
      .send({ leadData: { name: 'Isolated CRM Target', googlePlaceId: lead.googlePlaceId } });
    expect(createB.status).toBe(201);
    expect(createB.body.data.organization.id).not.toBe(create.body.data.organization.id);
    expect(createB.body.data.organization.managingAgencyOrganizationId).toBe(agencyB.id);
  });
});
