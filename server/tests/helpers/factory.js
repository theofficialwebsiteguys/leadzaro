'use strict';

const crypto = require('node:crypto');
const bcrypt = require('bcryptjs');
const request = require('supertest');

function uniqueEmail(prefix) {
  return `${prefix}-${crypto.randomBytes(4).toString('hex')}@example.test`;
}

function uniqueSlug(prefix) {
  return `${prefix}-${crypto.randomBytes(4).toString('hex')}`;
}

async function createOrganization(models, { type = 'agency', name } = {}) {
  const slug = uniqueSlug(type);
  return models.Organization.create({
    name: name || slug, slug, type, status: 'active',
  });
}

async function createRoleAssignedMember(models, {
  organizationId, roleKeys = [], membershipType = 'employee', password = 'TestPassw0rd!', email, status = 'active',
}) {
  const passwordHash = await bcrypt.hash(password, 4); // low rounds: tests only
  const user = await models.User.create({
    name: 'Test User', email: email || uniqueEmail('user'), passwordHash, role: 'user',
  });
  const membership = await models.OrganizationMembership.create({
    organizationId, userId: user.id, status, membershipType, acceptedAt: new Date(),
  });
  if (roleKeys.length) {
    const roles = await models.Role.findAll({ where: { key: roleKeys } });
    await models.MembershipRole.bulkCreate(roles.map((r) => ({ membershipId: membership.id, roleId: r.id })));
  }
  return { user, membership, password };
}

async function loginAs(app, email, password) {
  const res = await request(app).post('/api/v1/auth/login').send({ email, password });
  if (res.status !== 200) {
    throw new Error(`login failed for ${email}: ${res.status} ${JSON.stringify(res.body)}`);
  }
  const setCookie = res.headers['set-cookie'];
  return { token: res.body.data.token, user: res.body.data.user, cookie: setCookie };
}

function authed(app, method, url, token, orgId) {
  const req = request(app)[method](url).set('Authorization', `Bearer ${token}`);
  return orgId ? req.set('X-Organization-Id', orgId) : req;
}

module.exports = {
  uniqueEmail, uniqueSlug, createOrganization, createRoleAssignedMember, loginAs, authed,
};
