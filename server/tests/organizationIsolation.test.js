'use strict';

const request = require('supertest');
const app = require('../app');
const { sequelize } = require('../models');
const { createOrganization, createRoleAssignedMember, loginAs } = require('./helpers/factory');

afterAll(async () => {
  await sequelize.close();
});

describe('organization isolation', () => {
  test('a saved lead created in org A is invisible to org B, even for a member with full permissions', async () => {
    const orgA = await createOrganization(sequelize.models, { type: 'agency' });
    const orgB = await createOrganization(sequelize.models, { type: 'agency' });

    const { user: userA, password: passA } = await createRoleAssignedMember(sequelize.models, { organizationId: orgA.id, roleKeys: ['administrator'] });
    const { user: userB, password: passB } = await createRoleAssignedMember(sequelize.models, { organizationId: orgB.id, roleKeys: ['administrator'] });

    const loginA = await loginAs(app, userA.email, passA);
    const save = await request(app).post('/api/saved-leads')
      .set('Authorization', `Bearer ${loginA.token}`)
      .send({ leadData: { name: 'Isolated Biz', googlePlaceId: `iso_${Date.now()}` } });
    expect(save.status).toBe(201);
    const savedLeadId = save.body.data.savedLead.id;

    const loginB = await loginAs(app, userB.email, passB);
    const listB = await request(app).get('/api/saved-leads').set('Authorization', `Bearer ${loginB.token}`);
    expect(listB.status).toBe(200);
    expect(listB.body.data.items.find((i) => i.id === savedLeadId)).toBeUndefined();

    const directB = await request(app).get(`/api/saved-leads/${savedLeadId}`).set('Authorization', `Bearer ${loginB.token}`);
    expect(directB.status).toBe(404);
  });

  test('a member cannot access another organization by sending its id in X-Organization-Id', async () => {
    const orgA = await createOrganization(sequelize.models, { type: 'agency' });
    const orgB = await createOrganization(sequelize.models, { type: 'agency' });
    const { user: userA, password: passA } = await createRoleAssignedMember(sequelize.models, { organizationId: orgA.id, roleKeys: ['administrator'] });

    const loginA = await loginAs(app, userA.email, passA);
    const res = await request(app).get('/api/v1/organizations/current')
      .set('Authorization', `Bearer ${loginA.token}`)
      .set('X-Organization-Id', orgB.id);
    expect(res.status).toBe(403);
  });

  test('outreach activities are organization-scoped', async () => {
    const orgA = await createOrganization(sequelize.models, { type: 'agency' });
    const orgB = await createOrganization(sequelize.models, { type: 'agency' });
    const { user: userA, password: passA } = await createRoleAssignedMember(sequelize.models, { organizationId: orgA.id, roleKeys: ['administrator'] });
    const { user: userB, password: passB } = await createRoleAssignedMember(sequelize.models, { organizationId: orgB.id, roleKeys: ['administrator'] });

    const loginA = await loginAs(app, userA.email, passA);
    const lead = await sequelize.models.Lead.create({ name: 'Outreach Target', googlePlaceId: `outreach_${Date.now()}` });
    const activity = await request(app).post('/api/outreach')
      .set('Authorization', `Bearer ${loginA.token}`)
      .send({ leadId: lead.id, type: 'call', note: 'org A only' });
    expect(activity.status).toBe(201);

    const loginB = await loginAs(app, userB.email, passB);
    const listB = await request(app).get('/api/outreach').set('Authorization', `Bearer ${loginB.token}`);
    expect(listB.body.data.items.find((i) => i.id === activity.body.data.activity.id)).toBeUndefined();
  });

  test('audit log entries are organization-scoped', async () => {
    const orgA = await createOrganization(sequelize.models, { type: 'agency' });
    const orgB = await createOrganization(sequelize.models, { type: 'agency' });
    const { user: userA, password: passA } = await createRoleAssignedMember(sequelize.models, { organizationId: orgA.id, roleKeys: ['administrator'] });
    const { user: userB, password: passB } = await createRoleAssignedMember(sequelize.models, { organizationId: orgB.id, roleKeys: ['administrator'] });

    const loginA = await loginAs(app, userA.email, passA);
    await request(app).post('/api/saved-leads')
      .set('Authorization', `Bearer ${loginA.token}`)
      .send({ leadData: { name: 'Audit Target', googlePlaceId: `audit_${Date.now()}` } });

    const loginB = await loginAs(app, userB.email, passB);
    const auditB = await request(app).get('/api/v1/audit').set('Authorization', `Bearer ${loginB.token}`);
    expect(auditB.status).toBe(200);
    expect(auditB.body.data.items.find((a) => a.action === 'saved_lead.created')).toBeUndefined();
  });

  test('notifications are per-user and not leaked across organizations', async () => {
    const orgA = await createOrganization(sequelize.models, { type: 'agency' });
    const orgB = await createOrganization(sequelize.models, { type: 'agency' });
    const { user: userA, membership: membershipA, password: passA } = await createRoleAssignedMember(sequelize.models, { organizationId: orgA.id, roleKeys: ['sales_representative'] });
    const { user: userB, password: passB } = await createRoleAssignedMember(sequelize.models, { organizationId: orgB.id, roleKeys: ['sales_representative'] });

    const { Notification } = sequelize.models;
    await Notification.create({ userId: userA.id, organizationId: orgA.id, type: 'system', title: 'For A only' });

    const loginB = await loginAs(app, userB.email, passB);
    const listB = await request(app).get('/api/v1/notifications').set('Authorization', `Bearer ${loginB.token}`);
    expect(listB.body.data.items.find((n) => n.title === 'For A only')).toBeUndefined();

    const loginA = await loginAs(app, userA.email, passA);
    const listA = await request(app).get('/api/v1/notifications').set('Authorization', `Bearer ${loginA.token}`);
    expect(listA.body.data.items.find((n) => n.title === 'For A only')).toBeDefined();
  });
});
