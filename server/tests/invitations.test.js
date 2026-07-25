'use strict';

const request = require('supertest');
const app = require('../app');
const { sequelize } = require('../models');
const {
  createOrganization, createRoleAssignedMember, loginAs, uniqueEmail,
} = require('./helpers/factory');

afterAll(async () => {
  await sequelize.close();
});

describe('invitations', () => {
  test('an administrator can invite a new employee, and the invitee accepts and creates their own account', async () => {
    const org = await createOrganization(sequelize.models, { type: 'agency' });
    const { user: admin, password: adminPassword } = await createRoleAssignedMember(sequelize.models, {
      organizationId: org.id, roleKeys: ['administrator'],
    });
    const adminLogin = await loginAs(app, admin.email, adminPassword);

    const invitedEmail = uniqueEmail('invitee');
    const create = await request(app).post('/api/v1/invitations')
      .set('Authorization', `Bearer ${adminLogin.token}`)
      .send({ email: invitedEmail, membershipType: 'employee', roleKeys: ['sales_representative'] });
    expect(create.status).toBe(201);

    const { Invitation } = sequelize.models;
    const invitation = await Invitation.findOne({ where: { email: invitedEmail } });
    expect(invitation).toBeTruthy();
    expect(invitation.status).toBe('pending');

    // Simulate the raw token from the email: we can't read the hashed
    // value back, so re-issue via resend and capture through a spy-free
    // approach — instead, directly verify accept fails on garbage token
    // and then accept using a token we mint the same way the service does.
    const badAccept = await request(app).post('/api/v1/invitations/accept').send({ token: 'not-a-real-token', name: 'X', password: 'Whatever1!' });
    expect(badAccept.status).toBe(400);

    // Use the lookup+accept flow with the actual raw token by re-creating
    // the invitation through the same code path and capturing the email
    // adapter's console output is brittle; instead assert acceptance
    // rules using a hand-crafted valid token via the security/tokens
    // helper against the persisted hash.
    const { generateRawToken, hashToken } = require('../core/security/tokens');
    const rawToken = generateRawToken();
    await invitation.update({ tokenHash: hashToken(rawToken) });

    const lookup = await request(app).get(`/api/v1/invitations/lookup?token=${rawToken}`);
    expect(lookup.status).toBe(200);
    expect(lookup.body.data.email).toBe(invitedEmail);
    expect(lookup.body.data.requiresPassword).toBe(true);

    const accept = await request(app).post('/api/v1/invitations/accept').send({
      token: rawToken, name: 'New Employee', password: 'BrandNewPass1!',
    });
    expect(accept.status).toBe(200);
    expect(accept.body.data.user.email).toBe(invitedEmail);

    const { OrganizationMembership, User } = sequelize.models;
    const newUser = await User.findOne({ where: { email: invitedEmail } });
    const membership = await OrganizationMembership.findOne({ where: { organizationId: org.id, userId: newUser.id } });
    expect(membership.status).toBe('active');
    expect(newUser.emailVerifiedAt).toBeTruthy();

    const refreshed = await Invitation.findByPk(invitation.id);
    expect(refreshed.status).toBe('accepted');
  });

  test('an existing user can accept an invitation to a second organization while logged in as themselves', async () => {
    const orgA = await createOrganization(sequelize.models, { type: 'agency' });
    const orgB = await createOrganization(sequelize.models, { type: 'agency' });

    const { user, password } = await createRoleAssignedMember(sequelize.models, { organizationId: orgA.id, roleKeys: ['sales_representative'] });
    const { user: admin, password: adminPassword } = await createRoleAssignedMember(sequelize.models, { organizationId: orgB.id, roleKeys: ['administrator'] });

    const adminLogin = await loginAs(app, admin.email, adminPassword);
    const create = await request(app).post('/api/v1/invitations')
      .set('Authorization', `Bearer ${adminLogin.token}`)
      .send({ email: user.email, membershipType: 'employee', roleKeys: ['sales_manager'] });
    expect(create.status).toBe(201);

    const { Invitation } = sequelize.models;
    const invitation = await Invitation.findOne({ where: { email: user.email, organizationId: orgB.id } });
    const { generateRawToken, hashToken } = require('../core/security/tokens');
    const rawToken = generateRawToken();
    await invitation.update({ tokenHash: hashToken(rawToken) });

    const lookup = await request(app).get(`/api/v1/invitations/lookup?token=${rawToken}`);
    expect(lookup.body.data.requiresPassword).toBe(false);

    const userLogin = await loginAs(app, user.email, password);

    // Accepting without being authenticated as the matching user is rejected.
    const anonAccept = await request(app).post('/api/v1/invitations/accept').send({ token: rawToken });
    expect(anonAccept.status).toBe(409);

    const accept = await request(app).post('/api/v1/invitations/accept')
      .set('Authorization', `Bearer ${userLogin.token}`)
      .send({ token: rawToken });
    expect(accept.status).toBe(200);

    const { OrganizationMembership } = sequelize.models;
    const membershipB = await OrganizationMembership.findOne({ where: { organizationId: orgB.id, userId: user.id } });
    expect(membershipB.status).toBe('active');
    expect(membershipB.membershipType).toBe('employee');
  });

  test('a non-admin cannot create invitations', async () => {
    const org = await createOrganization(sequelize.models, { type: 'agency' });
    const { user, password } = await createRoleAssignedMember(sequelize.models, { organizationId: org.id, roleKeys: ['sales_representative'] });
    const login = await loginAs(app, user.email, password);

    const res = await request(app).post('/api/v1/invitations')
      .set('Authorization', `Bearer ${login.token}`)
      .send({ email: uniqueEmail('nope'), membershipType: 'employee', roleKeys: ['sales_representative'] });
    expect(res.status).toBe(403);
  });
});
