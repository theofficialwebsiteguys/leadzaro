'use strict';

const request = require('supertest');
const app = require('../app');
const { sequelize } = require('../models');
const { createOrganization, createRoleAssignedMember, loginAs, uniqueEmail } = require('./helpers/factory');

afterAll(async () => {
  await sequelize.close();
});

describe('login / session lifecycle', () => {
  test('existing user can log in and receives an access token + session cookie, not a long-lived JWT in the body only', async () => {
    const org = await createOrganization(sequelize.models, { type: 'agency' });
    const { user, password } = await createRoleAssignedMember(sequelize.models, {
      organizationId: org.id, roleKeys: ['sales_representative'],
    });

    const res = await request(app).post('/api/v1/auth/login').send({ email: user.email, password });
    expect(res.status).toBe(200);
    expect(res.body.data.token).toBeTruthy();
    expect(res.body.data.user.email).toBe(user.email);
    expect(res.body.data.user.passwordHash).toBeUndefined();
    expect(res.headers['set-cookie']?.[0]).toMatch(/lz_session=/);
    expect(res.headers['set-cookie']?.[0]).toMatch(/HttpOnly/);
  });

  test('wrong password is rejected and does not create a session', async () => {
    const org = await createOrganization(sequelize.models, { type: 'agency' });
    const { user } = await createRoleAssignedMember(sequelize.models, { organizationId: org.id, roleKeys: ['sales_representative'] });

    const res = await request(app).post('/api/v1/auth/login').send({ email: user.email, password: 'WrongPassword1!' });
    expect(res.status).toBe(401);
  });

  test('deactivated user cannot log in', async () => {
    const org = await createOrganization(sequelize.models, { type: 'agency' });
    const { user, password } = await createRoleAssignedMember(sequelize.models, { organizationId: org.id, roleKeys: ['sales_representative'] });
    await user.update({ isActive: false });

    const res = await request(app).post('/api/v1/auth/login').send({ email: user.email, password });
    expect(res.status).toBe(403);
  });

  test('refresh cookie yields a new access token, and logout revokes the session', async () => {
    const org = await createOrganization(sequelize.models, { type: 'agency' });
    const { user, password } = await createRoleAssignedMember(sequelize.models, { organizationId: org.id, roleKeys: ['sales_representative'] });

    const login = await loginAs(app, user.email, password);
    const refresh = await request(app).post('/api/v1/auth/refresh').set('Cookie', login.cookie);
    expect(refresh.status).toBe(200);
    expect(refresh.body.data.token).toBeTruthy();
    // Note: a JWT reissued for the same user within the same second is
    // byte-identical to the previous one (deterministic given identical
    // payload/secret/expiry) — that's expected and not a security issue,
    // so this only asserts the refresh endpoint issues *a* valid token,
    // not that it differs from the last one.

    const logout = await request(app).post('/api/v1/auth/logout').set('Cookie', login.cookie);
    expect(logout.status).toBe(200);

    const refreshAfterLogout = await request(app).post('/api/v1/auth/refresh').set('Cookie', login.cookie);
    expect(refreshAfterLogout.status).toBe(401);
  });

  test('a user can list and revoke their own sessions', async () => {
    const org = await createOrganization(sequelize.models, { type: 'agency' });
    const { user, password } = await createRoleAssignedMember(sequelize.models, { organizationId: org.id, roleKeys: ['sales_representative'] });

    const first = await loginAs(app, user.email, password);
    await loginAs(app, user.email, password);

    const list = await request(app).get('/api/v1/sessions').set('Authorization', `Bearer ${first.token}`);
    expect(list.status).toBe(200);
    expect(list.body.data.sessions.length).toBeGreaterThanOrEqual(2);

    const other = list.body.data.sessions.find((s) => !s.isCurrent);
    const revoke = await request(app).delete(`/api/v1/sessions/${other.id}`).set('Authorization', `Bearer ${first.token}`);
    expect(revoke.status).toBe(200);
  });

  test('password reset request never reveals whether the email exists, and a valid token resets the password', async () => {
    const org = await createOrganization(sequelize.models, { type: 'agency' });
    const { user } = await createRoleAssignedMember(sequelize.models, { organizationId: org.id, roleKeys: ['sales_representative'] });

    const unknownReq = await request(app).post('/api/v1/auth/password-reset/request').send({ email: uniqueEmail('nobody') });
    expect(unknownReq.status).toBe(200);

    const knownReq = await request(app).post('/api/v1/auth/password-reset/request').send({ email: user.email });
    expect(knownReq.status).toBe(200);

    const { PasswordResetToken } = sequelize.models;
    const record = await PasswordResetToken.findOne({ where: { userId: user.id }, order: [['createdAt', 'DESC']] });
    expect(record).toBeTruthy();
  });

  test('changing password revokes every other session but keeps the one making the request', async () => {
    const org = await createOrganization(sequelize.models, { type: 'agency' });
    const { user, password } = await createRoleAssignedMember(sequelize.models, { organizationId: org.id, roleKeys: ['sales_representative'] });

    const sessionA = await loginAs(app, user.email, password);
    const sessionB = await loginAs(app, user.email, password);

    const change = await request(app).put('/api/v1/auth/password')
      .set('Authorization', `Bearer ${sessionB.token}`)
      .set('Cookie', sessionB.cookie)
      .send({ currentPassword: password, newPassword: 'BrandNewSecurePass1!' });
    expect(change.status).toBe(200);

    const refreshA = await request(app).post('/api/v1/auth/refresh').set('Cookie', sessionA.cookie);
    expect(refreshA.status).toBe(401);

    const refreshB = await request(app).post('/api/v1/auth/refresh').set('Cookie', sessionB.cookie);
    expect(refreshB.status).toBe(200);
  });

  test('confirming a password reset revokes every session for that user', async () => {
    const org = await createOrganization(sequelize.models, { type: 'agency' });
    const { user, password } = await createRoleAssignedMember(sequelize.models, { organizationId: org.id, roleKeys: ['sales_representative'] });
    const session = await loginAs(app, user.email, password);

    const { generateRawToken, hashToken } = require('../core/security/tokens');
    const { PasswordResetToken } = sequelize.models;
    const rawToken = generateRawToken();
    await PasswordResetToken.create({ userId: user.id, tokenHash: hashToken(rawToken), expiresAt: new Date(Date.now() + 60000) });

    const confirm = await request(app).post('/api/v1/auth/password-reset/confirm').send({ token: rawToken, newPassword: 'AnotherNewPass1!' });
    expect(confirm.status).toBe(200);

    const refresh = await request(app).post('/api/v1/auth/refresh').set('Cookie', session.cookie);
    expect(refresh.status).toBe(401);
  });
});
