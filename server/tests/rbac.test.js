'use strict';

const request = require('supertest');
const app = require('../app');
const { sequelize } = require('../models');
const { createOrganization, createRoleAssignedMember, loginAs } = require('./helpers/factory');

afterAll(async () => {
  await sequelize.close();
});

describe('permission combination and overrides', () => {
  test('a membership with two roles gets the union of both role permission sets', async () => {
    const org = await createOrganization(sequelize.models, { type: 'agency' });
    const { user, password } = await createRoleAssignedMember(sequelize.models, {
      organizationId: org.id, roleKeys: ['sales_representative', 'sales_manager'],
    });
    const login = await loginAs(app, user.email, password);

    const current = await request(app).get('/api/v1/organizations/current').set('Authorization', `Bearer ${login.token}`);
    expect(current.status).toBe(200);
    expect(current.body.data.permissions).toEqual(expect.arrayContaining(['leads.search', 'leads.merge', 'audit.view']));
  });

  test('an explicit restriction overrides a role grant', async () => {
    const org = await createOrganization(sequelize.models, { type: 'agency' });
    const { user, membership, password } = await createRoleAssignedMember(sequelize.models, {
      organizationId: org.id, roleKeys: ['administrator'],
    });

    const { Permission, MembershipPermissionOverride } = sequelize.models;
    const permission = await Permission.findOne({ where: { key: 'invitations.manage' } });
    await MembershipPermissionOverride.create({
      membershipId: membership.id, permissionId: permission.id, effect: 'restrict', reason: 'test restriction',
    });

    const login = await loginAs(app, user.email, password);
    const current = await request(app).get('/api/v1/organizations/current').set('Authorization', `Bearer ${login.token}`);
    expect(current.body.data.permissions).not.toContain('invitations.manage');
    // Administrator otherwise keeps everything else.
    expect(current.body.data.permissions).toContain('memberships.manage');

    const attempt = await request(app).get('/api/v1/invitations').set('Authorization', `Bearer ${login.token}`);
    expect(attempt.status).toBe(403);
  });

  test('an explicit grant adds a permission beyond the assigned role', async () => {
    const org = await createOrganization(sequelize.models, { type: 'agency' });
    const { user, membership, password } = await createRoleAssignedMember(sequelize.models, {
      organizationId: org.id, roleKeys: ['sales_representative'],
    });

    const { Permission, MembershipPermissionOverride } = sequelize.models;
    const permission = await Permission.findOne({ where: { key: 'audit.view' } });
    await MembershipPermissionOverride.create({
      membershipId: membership.id, permissionId: permission.id, effect: 'grant', reason: 'test grant',
    });

    const login = await loginAs(app, user.email, password);
    const res = await request(app).get('/api/v1/audit').set('Authorization', `Bearer ${login.token}`);
    expect(res.status).toBe(200);
  });
});

describe('membership administration authorization', () => {
  test('administrator can list and update member roles; a sales rep cannot', async () => {
    const org = await createOrganization(sequelize.models, { type: 'agency' });
    const { user: admin, password: adminPassword } = await createRoleAssignedMember(sequelize.models, { organizationId: org.id, roleKeys: ['administrator'] });
    const { membership: repMembership, password: repPassword, user: rep } = await createRoleAssignedMember(sequelize.models, { organizationId: org.id, roleKeys: ['sales_representative'] });

    const adminLogin = await loginAs(app, admin.email, adminPassword);
    const list = await request(app).get('/api/v1/memberships').set('Authorization', `Bearer ${adminLogin.token}`);
    expect(list.status).toBe(200);
    expect(list.body.data.memberships.length).toBeGreaterThanOrEqual(2);

    const updateRoles = await request(app).put(`/api/v1/memberships/${repMembership.id}/roles`)
      .set('Authorization', `Bearer ${adminLogin.token}`)
      .send({ roleKeys: ['sales_manager'] });
    expect(updateRoles.status).toBe(200);

    const repLogin = await loginAs(app, rep.email, repPassword);
    const forbidden = await request(app).get('/api/v1/memberships').set('Authorization', `Bearer ${repLogin.token}`);
    expect(forbidden.status).toBe(403);

    const forbiddenRoleUpdate = await request(app).put(`/api/v1/memberships/${repMembership.id}/roles`)
      .set('Authorization', `Bearer ${repLogin.token}`)
      .send({ roleKeys: ['administrator'] });
    expect(forbiddenRoleUpdate.status).toBe(403);
  });

  test('assigning a client-scoped role to an employee membership is rejected', async () => {
    const org = await createOrganization(sequelize.models, { type: 'agency' });
    const { user: admin, password: adminPassword } = await createRoleAssignedMember(sequelize.models, { organizationId: org.id, roleKeys: ['administrator'] });
    const { membership: repMembership } = await createRoleAssignedMember(sequelize.models, { organizationId: org.id, roleKeys: ['sales_representative'] });

    const adminLogin = await loginAs(app, admin.email, adminPassword);
    const res = await request(app).put(`/api/v1/memberships/${repMembership.id}/roles`)
      .set('Authorization', `Bearer ${adminLogin.token}`)
      .send({ roleKeys: ['client_owner'] });
    expect(res.status).toBe(422);
  });
});
