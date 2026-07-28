'use strict';

const request = require('supertest');
const app = require('../app');
const {
  sequelize, SeoEntitlementGrant, ServicePlan, BillingAccount, Subscription, AuditLog,
} = require('../models');
const { createOrganization, createRoleAssignedMember, loginAs } = require('./helpers/factory');
const { hasSeoEntitlement } = require('../modules/seo/seoEntitlementService');

afterAll(async () => {
  await sequelize.close();
});

function auth(login) {
  return (r) => r.set('Authorization', `Bearer ${login.token}`);
}

async function setupAgencyAndClient() {
  const agency = await createOrganization(sequelize.models, { type: 'agency' });
  const clientOrg = await createOrganization(sequelize.models, { type: 'client', managingAgencyOrganizationId: agency.id });

  const { user: admin, password: adminPassword } = await createRoleAssignedMember(sequelize.models, { organizationId: agency.id, roleKeys: ['administrator'] });
  const adminAuth = auth(await loginAs(app, admin.email, adminPassword));

  return {
    agency, clientOrg, admin, adminAuth,
  };
}

describe('SeoEntitlementGrant visibility guard', () => {
  test('a raw unscoped query throws', async () => {
    await expect(SeoEntitlementGrant.findAll()).rejects.toThrow(/must be queried through/i);
  });
});

describe('hasSeoEntitlement (unit)', () => {
  test('false with no subscription and no grant', async () => {
    const { clientOrg } = await setupAgencyAndClient();
    expect(await hasSeoEntitlement(clientOrg.id)).toBe(false);
  });

  test('true via an active Subscription whose addOnServicePlanIds includes the seo_addon plan', async () => {
    const { clientOrg } = await setupAgencyAndClient();
    const seoAddonPlan = await ServicePlan.findOne({ where: { key: 'seo_addon' } });
    const basePlan = await ServicePlan.findOne({ where: { key: 'starter_website' } });
    const billingAccount = await BillingAccount.create({ organizationId: clientOrg.id, status: 'active' });
    await Subscription.create({
      billingAccountId: billingAccount.id, servicePlanId: basePlan.id, addOnServicePlanIds: [seoAddonPlan.id], status: 'active',
    });

    expect(await hasSeoEntitlement(clientOrg.id)).toBe(true);
  });

  test('false when the subscription carrying the addon is not active', async () => {
    const { clientOrg } = await setupAgencyAndClient();
    const seoAddonPlan = await ServicePlan.findOne({ where: { key: 'seo_addon' } });
    const basePlan = await ServicePlan.findOne({ where: { key: 'starter_website' } });
    const billingAccount = await BillingAccount.create({ organizationId: clientOrg.id, status: 'active' });
    await Subscription.create({
      billingAccountId: billingAccount.id, servicePlanId: basePlan.id, addOnServicePlanIds: [seoAddonPlan.id], status: 'canceled',
    });

    expect(await hasSeoEntitlement(clientOrg.id)).toBe(false);
  });

  test('true via an active, indefinite manual grant; false once revoked', async () => {
    const { clientOrg, agency, admin } = await setupAgencyAndClient();
    const grant = await SeoEntitlementGrant.create({
      organizationId: clientOrg.id, agencyOrganizationId: agency.id, grantedByUserId: admin.id, reason: 'trial',
    });
    expect(await hasSeoEntitlement(clientOrg.id)).toBe(true);

    await grant.update({ revokedAt: new Date(), revokedByUserId: admin.id });
    expect(await hasSeoEntitlement(clientOrg.id)).toBe(false);
  });

  test('false once a grant\'s expiresAt has passed', async () => {
    const { clientOrg, agency, admin } = await setupAgencyAndClient();
    await SeoEntitlementGrant.create({
      organizationId: clientOrg.id, agencyOrganizationId: agency.id, grantedByUserId: admin.id, reason: 'trial', expiresAt: new Date(Date.now() - 1000),
    });
    expect(await hasSeoEntitlement(clientOrg.id)).toBe(false);
  });

  test('true when expiresAt is still in the future', async () => {
    const { clientOrg, agency, admin } = await setupAgencyAndClient();
    await SeoEntitlementGrant.create({
      organizationId: clientOrg.id, agencyOrganizationId: agency.id, grantedByUserId: admin.id, reason: 'trial', expiresAt: new Date(Date.now() + 1000 * 60 * 60),
    });
    expect(await hasSeoEntitlement(clientOrg.id)).toBe(true);
  });
});

describe('POST /api/v1/seo/organizations/:organizationId/entitlement-grants', () => {
  test('seo.manage_entitlements is required — builder.manage alone (a project_manager) is not enough', async () => {
    const { agency, clientOrg } = await setupAgencyAndClient();
    const { user, password } = await createRoleAssignedMember(sequelize.models, { organizationId: agency.id, roleKeys: ['project_manager'] });
    const login = await loginAs(app, user.email, password);
    const res = await auth(login)(request(app).post(`/api/v1/seo/organizations/${clientOrg.id}/entitlement-grants`).send({ reason: 'trial' }));
    expect(res.status).toBe(403);
  });

  test('grants entitlement, creates a real row and an audit entry, and flips entitlement-status', async () => {
    const { clientOrg, adminAuth, admin } = await setupAgencyAndClient();

    const before = await adminAuth(request(app).get(`/api/v1/seo/organizations/${clientOrg.id}/entitlement-status`));
    expect(before.body.data.entitled).toBe(false);

    const res = await adminAuth(request(app).post(`/api/v1/seo/organizations/${clientOrg.id}/entitlement-grants`).send({ reason: 'promotional trial' }));
    expect(res.status).toBe(200);
    expect(res.body.data.grant.reason).toBe('promotional trial');
    expect(res.body.data.grant.grantedByUserId).toBe(admin.id);

    const after = await adminAuth(request(app).get(`/api/v1/seo/organizations/${clientOrg.id}/entitlement-status`));
    expect(after.body.data.entitled).toBe(true);

    const auditEntries = await AuditLog.findAll({ where: { action: 'seo.entitlement_granted', targetId: res.body.data.grant.id } });
    expect(auditEntries.length).toBe(1);
  });

  test('a missing reason is rejected', async () => {
    const { clientOrg, adminAuth } = await setupAgencyAndClient();
    const res = await adminAuth(request(app).post(`/api/v1/seo/organizations/${clientOrg.id}/entitlement-grants`).send({}));
    expect(res.status).toBe(422);
  });

  test('cannot grant entitlement for a client organization managed by a different agency', async () => {
    const { clientOrg } = await setupAgencyAndClient();
    const otherAgency = await createOrganization(sequelize.models, { type: 'agency' });
    const { user, password } = await createRoleAssignedMember(sequelize.models, { organizationId: otherAgency.id, roleKeys: ['administrator'] });
    const login = await loginAs(app, user.email, password);
    const res = await auth(login)(request(app).post(`/api/v1/seo/organizations/${clientOrg.id}/entitlement-grants`).send({ reason: 'trial' }));
    expect(res.status).toBe(404);
  });
});

describe('POST /api/v1/seo/organizations/:organizationId/entitlement-grants/:grantId/revoke', () => {
  test('revokes an active grant, creates an audit entry, and flips entitlement-status back off', async () => {
    const { clientOrg, adminAuth } = await setupAgencyAndClient();
    const grantRes = await adminAuth(request(app).post(`/api/v1/seo/organizations/${clientOrg.id}/entitlement-grants`).send({ reason: 'trial' }));
    const grantId = grantRes.body.data.grant.id;

    const res = await adminAuth(request(app).post(`/api/v1/seo/organizations/${clientOrg.id}/entitlement-grants/${grantId}/revoke`));
    expect(res.status).toBe(200);
    expect(res.body.data.grant.revokedAt).toBeTruthy();

    const status = await adminAuth(request(app).get(`/api/v1/seo/organizations/${clientOrg.id}/entitlement-status`));
    expect(status.body.data.entitled).toBe(false);

    const auditEntries = await AuditLog.findAll({ where: { action: 'seo.entitlement_revoked', targetId: grantId } });
    expect(auditEntries.length).toBe(1);
  });

  test('revoking an already-revoked grant is rejected', async () => {
    const { clientOrg, adminAuth } = await setupAgencyAndClient();
    const grantRes = await adminAuth(request(app).post(`/api/v1/seo/organizations/${clientOrg.id}/entitlement-grants`).send({ reason: 'trial' }));
    const grantId = grantRes.body.data.grant.id;
    await adminAuth(request(app).post(`/api/v1/seo/organizations/${clientOrg.id}/entitlement-grants/${grantId}/revoke`));

    const res = await adminAuth(request(app).post(`/api/v1/seo/organizations/${clientOrg.id}/entitlement-grants/${grantId}/revoke`));
    expect(res.status).toBe(409);
  });

  test('a grant belonging to a different agency\'s client cannot be revoked', async () => {
    const { clientOrg, adminAuth } = await setupAgencyAndClient();
    const grantRes = await adminAuth(request(app).post(`/api/v1/seo/organizations/${clientOrg.id}/entitlement-grants`).send({ reason: 'trial' }));
    const grantId = grantRes.body.data.grant.id;

    const otherAgency = await createOrganization(sequelize.models, { type: 'agency' });
    const { user, password } = await createRoleAssignedMember(sequelize.models, { organizationId: otherAgency.id, roleKeys: ['administrator'] });
    const login = await loginAs(app, user.email, password);
    const res = await auth(login)(request(app).post(`/api/v1/seo/organizations/${clientOrg.id}/entitlement-grants/${grantId}/revoke`));
    expect(res.status).toBe(404);
  });
});

describe('GET /api/v1/seo/organizations/:organizationId/entitlement-grants', () => {
  test('lists grants for the caller\'s own agency\'s client', async () => {
    const { clientOrg, adminAuth } = await setupAgencyAndClient();
    await adminAuth(request(app).post(`/api/v1/seo/organizations/${clientOrg.id}/entitlement-grants`).send({ reason: 'trial one' }));
    await adminAuth(request(app).post(`/api/v1/seo/organizations/${clientOrg.id}/entitlement-grants`).send({ reason: 'trial two' }));

    const res = await adminAuth(request(app).get(`/api/v1/seo/organizations/${clientOrg.id}/entitlement-grants`));
    expect(res.status).toBe(200);
    expect(res.body.data.grants.length).toBe(2);
  });

  test('a client-membership request is blocked entirely', async () => {
    const { clientOrg } = await setupAgencyAndClient();
    const { user, password } = await createRoleAssignedMember(sequelize.models, {
      organizationId: clientOrg.id, roleKeys: ['client_owner'], membershipType: 'client',
    });
    const login = await loginAs(app, user.email, password);
    const res = await auth(login)(request(app).get(`/api/v1/seo/organizations/${clientOrg.id}/entitlement-grants`));
    expect(res.status).toBe(403);
  });
});
