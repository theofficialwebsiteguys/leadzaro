'use strict';

const request = require('supertest');
const app = require('../app');
const { sequelize } = require('../models');
const { createOrganization, createRoleAssignedMember, loginAs } = require('./helpers/factory');

afterAll(async () => {
  await sequelize.close();
});

describe('impersonation foundation', () => {
  test('an agency administrator can view as a client member, with audit start/end and a required reason', async () => {
    const agencyOrg = await createOrganization(sequelize.models, { type: 'agency' });
    const clientOrg = await createOrganization(sequelize.models, { type: 'client' });

    const { user: admin, password: adminPassword } = await createRoleAssignedMember(sequelize.models, { organizationId: agencyOrg.id, roleKeys: ['administrator'] });
    const { user: clientUser, membership: clientMembership } = await createRoleAssignedMember(sequelize.models, {
      organizationId: clientOrg.id, roleKeys: ['client_owner'], membershipType: 'client',
    });

    const adminLogin = await loginAs(app, admin.email, adminPassword);

    const missingReason = await request(app).post('/api/v1/impersonation/start')
      .set('Authorization', `Bearer ${adminLogin.token}`)
      .send({ membershipId: clientMembership.id });
    expect(missingReason.status).toBe(422);

    const start = await request(app).post('/api/v1/impersonation/start')
      .set('Authorization', `Bearer ${adminLogin.token}`)
      .send({ membershipId: clientMembership.id, reason: 'Debugging a client-reported issue' });
    expect(start.status).toBe(200);
    expect(start.body.data.user.email).toBe(clientUser.email);
    const impersonationToken = start.body.data.token;

    const { AuditLog } = sequelize.models;
    const startAudit = await AuditLog.findOne({ where: { action: 'impersonation.start' } });
    expect(startAudit).toBeTruthy();
    expect(startAudit.actorUserId).toBe(admin.id);

    // Acting as the impersonated user works for ordinary reads...
    const asClient = await request(app).get('/api/v1/organizations/current').set('Authorization', `Bearer ${impersonationToken}`);
    expect(asClient.status).toBe(200);
    expect(asClient.body.data.organization.id).toBe(clientOrg.id);

    // ...but is blocked from changing the impersonated user's password.
    const pwChange = await request(app).put('/api/auth/password')
      .set('Authorization', `Bearer ${impersonationToken}`)
      .send({ currentPassword: 'whatever', newPassword: 'NewPassword1!' });
    expect(pwChange.status).toBe(403);

    const end = await request(app).post('/api/v1/impersonation/end').set('Authorization', `Bearer ${impersonationToken}`);
    expect(end.status).toBe(200);

    const endAudit = await AuditLog.findOne({ where: { action: 'impersonation.end' } });
    expect(endAudit).toBeTruthy();
    expect(endAudit.actorUserId).toBe(admin.id);
    expect(endAudit.targetId).toBe(clientUser.id);
  });

  test('impersonation is rejected for a non-client membership and for a non-administrator', async () => {
    const agencyOrg = await createOrganization(sequelize.models, { type: 'agency' });
    const { user: admin, password: adminPassword } = await createRoleAssignedMember(sequelize.models, { organizationId: agencyOrg.id, roleKeys: ['administrator'] });
    const { membership: otherEmployeeMembership } = await createRoleAssignedMember(sequelize.models, { organizationId: agencyOrg.id, roleKeys: ['sales_representative'] });

    const adminLogin = await loginAs(app, admin.email, adminPassword);
    const wrongType = await request(app).post('/api/v1/impersonation/start')
      .set('Authorization', `Bearer ${adminLogin.token}`)
      .send({ membershipId: otherEmployeeMembership.id, reason: 'trying to impersonate a coworker' });
    expect(wrongType.status).toBe(422);

    const { user: rep, password: repPassword } = await createRoleAssignedMember(sequelize.models, { organizationId: agencyOrg.id, roleKeys: ['sales_representative'] });
    const repLogin = await loginAs(app, rep.email, repPassword);
    const forbidden = await request(app).post('/api/v1/impersonation/start')
      .set('Authorization', `Bearer ${repLogin.token}`)
      .send({ membershipId: otherEmployeeMembership.id, reason: 'not an admin' });
    expect(forbidden.status).toBe(403);
  });
});
