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

async function createOpportunity(auth, name, prefix) {
  const res = await auth(request(app).post('/api/v1/crm/opportunities').send({
    leadData: { name, googlePlaceId: uniquePlaceId(prefix) },
  }));
  expect(res.status).toBe(201);
  return res.body.data.opportunity;
}

async function setStage(auth, id, stage) {
  const res = await auth(request(app).put(`/api/v1/crm/opportunities/${id}`).send({ stage }));
  expect(res.status).toBe(200);
}

describe('CRM pipeline dashboard summary', () => {
  test('a rep sees stage counts and their own stats, but no team breakdown; a manager sees the team breakdown', async () => {
    const org = await createOrganization(sequelize.models, { type: 'agency' });
    const { user: manager, password: managerPassword } = await createRoleAssignedMember(sequelize.models, { organizationId: org.id, roleKeys: ['sales_manager'] });
    const { user: rep, password: repPassword } = await createRoleAssignedMember(sequelize.models, { organizationId: org.id, roleKeys: ['sales_representative'] });

    const managerLogin = await loginAs(app, manager.email, managerPassword);
    const managerAuth = (r) => r.set('Authorization', `Bearer ${managerLogin.token}`);
    const repLogin = await loginAs(app, rep.email, repPassword);
    const repAuth = (r) => r.set('Authorization', `Bearer ${repLogin.token}`);

    const oppA = await createOpportunity(repAuth, 'Dashboard Biz A', 'dashA');
    const oppB = await createOpportunity(repAuth, 'Dashboard Biz B', 'dashB');
    await setStage(managerAuth, oppB.id, 'Closed Won');
    await createOpportunity(managerAuth, 'Dashboard Biz C', 'dashC');

    const repSummary = await repAuth(request(app).get('/api/v1/crm/dashboard'));
    expect(repSummary.status).toBe(200);
    expect(repSummary.body.data.teamBreakdown).toEqual([]);
    expect(repSummary.body.data.myStats.assigned).toBe(2);
    expect(repSummary.body.data.myStats.open).toBe(1);
    expect(repSummary.body.data.myStats.closedWon).toBe(1);

    const managerSummary = await managerAuth(request(app).get('/api/v1/crm/dashboard'));
    expect(managerSummary.status).toBe(200);
    expect(managerSummary.body.data.teamBreakdown.length).toBeGreaterThanOrEqual(2);
    const repRow = managerSummary.body.data.teamBreakdown.find((r) => r.userId === rep.id);
    expect(repRow.open).toBe(1);
    expect(repRow.closedWon).toBe(1);

    const stageCount = (stage) => managerSummary.body.data.stageCounts.find((s) => s.stage === stage)?.count;
    expect(stageCount('Closed Won')).toBe(1);
    expect(stageCount('Discovered')).toBe(2);
    expect(managerSummary.body.data.totalActive).toBe(2);
  });

  test('win rate reflects closed won vs. closed lost, and is null with no closed opportunities yet', async () => {
    const org = await createOrganization(sequelize.models, { type: 'agency' });
    const { user, password } = await createRoleAssignedMember(sequelize.models, { organizationId: org.id, roleKeys: ['sales_manager'] });
    const login = await loginAs(app, user.email, password);
    const auth = (r) => r.set('Authorization', `Bearer ${login.token}`);

    const noClosedYet = await auth(request(app).get('/api/v1/crm/dashboard'));
    expect(noClosedYet.body.data.winRate).toBeNull();

    const won1 = await createOpportunity(auth, 'Win Rate Won 1', 'wrWon1');
    const won2 = await createOpportunity(auth, 'Win Rate Won 2', 'wrWon2');
    const won3 = await createOpportunity(auth, 'Win Rate Won 3', 'wrWon3');
    const lost1 = await createOpportunity(auth, 'Win Rate Lost 1', 'wrLost1');
    await setStage(auth, won1.id, 'Closed Won');
    await setStage(auth, won2.id, 'Closed Won');
    await setStage(auth, won3.id, 'Closed Won');
    await setStage(auth, lost1.id, 'Closed Lost');

    const summary = await auth(request(app).get('/api/v1/crm/dashboard'));
    expect(summary.body.data.winRate).toBe(75);
  });

  test('dashboard summary is scoped to the caller\'s own agency', async () => {
    const agencyA = await createOrganization(sequelize.models, { type: 'agency' });
    const agencyB = await createOrganization(sequelize.models, { type: 'agency' });
    const { user: userA, password: passwordA } = await createRoleAssignedMember(sequelize.models, { organizationId: agencyA.id, roleKeys: ['sales_manager'] });
    const { user: userB, password: passwordB } = await createRoleAssignedMember(sequelize.models, { organizationId: agencyB.id, roleKeys: ['sales_manager'] });

    const loginA = await loginAs(app, userA.email, passwordA);
    const authA = (r) => r.set('Authorization', `Bearer ${loginA.token}`);
    await createOpportunity(authA, 'Isolated Dashboard Biz', 'isoDash');

    const loginB = await loginAs(app, userB.email, passwordB);
    const summaryB = await request(app).get('/api/v1/crm/dashboard').set('Authorization', `Bearer ${loginB.token}`);
    expect(summaryB.status).toBe(200);
    expect(summaryB.body.data.totalActive).toBe(0);
    expect(summaryB.body.data.teamBreakdown.find((r) => r.userId === userA.id)).toBeUndefined();
  });
});
