'use strict';

const request = require('supertest');
const app = require('../app');
const {
  sequelize, Project, WebsiteDomain,
} = require('../models');
const { createOrganization, createRoleAssignedMember, loginAs } = require('./helpers/factory');
const {
  MockNamecheapAdapter, DisabledNamecheapAdapter,
} = require('../core/integrations/namecheap/namecheapAdapter');

afterAll(async () => {
  await sequelize.close();
});

function auth(login) {
  return (r) => r.set('Authorization', `Bearer ${login.token}`);
}

async function setupProjectWithWebsite() {
  const agency = await createOrganization(sequelize.models, { type: 'agency' });
  const clientOrg = await createOrganization(sequelize.models, { type: 'client', managingAgencyOrganizationId: agency.id });
  const project = await Project.create({
    organizationId: clientOrg.id, agencyOrganizationId: agency.id, stage: 'Design', healthStatus: 'on_track',
  });

  // Website creation requires builder.edit, which project_manager (the
  // role used below for domain actions, requiring builder.manage) does
  // not hold — a developer creates the website first, matching the real
  // separation of duties this permission split enforces.
  const { user: developer, password: developerPassword } = await createRoleAssignedMember(sequelize.models, { organizationId: agency.id, roleKeys: ['developer'] });
  const developerLogin = await loginAs(app, developer.email, developerPassword);
  await auth(developerLogin)(request(app).post(`/api/v1/projects/${project.id}/website`).send({ name: 'Acme Co Site', startingMode: 'blank' }));

  const { user: pm, password: pmPassword } = await createRoleAssignedMember(sequelize.models, { organizationId: agency.id, roleKeys: ['project_manager'] });
  const pmLogin = await loginAs(app, pm.email, pmPassword);
  const pmAuth = auth(pmLogin);

  return {
    agency, clientOrg, project, pmAuth,
  };
}

describe('WebsiteDomain visibility guard', () => {
  test('a raw unscoped query throws', async () => {
    await expect(WebsiteDomain.findAll()).rejects.toThrow(/must be queried through/i);
  });
});

describe('GET /api/v1/projects/:projectId/website/domain', () => {
  test('returns null before any domain has been registered', async () => {
    const { project, pmAuth } = await setupProjectWithWebsite();
    const res = await pmAuth(request(app).get(`/api/v1/projects/${project.id}/website/domain`));
    expect(res.status).toBe(200);
    expect(res.body.data.domain).toBeNull();
  });

  test('a client cannot view domain data even with builder.edit (employee-only, current-phase-plan.md § 2d)', async () => {
    const { clientOrg, project } = await setupProjectWithWebsite();
    const { user, password } = await createRoleAssignedMember(sequelize.models, {
      organizationId: clientOrg.id, roleKeys: ['client_owner'], membershipType: 'client',
    });
    const login = await loginAs(app, user.email, password);
    const res = await auth(login)(request(app).get(`/api/v1/projects/${project.id}/website/domain`));
    expect(res.status).toBe(403);
  });
});

describe('POST /api/v1/projects/:projectId/website/domain/register', () => {
  test('builder.manage is required — builder.develop alone (a developer) is not enough', async () => {
    const { agency, project } = await setupProjectWithWebsite();
    const { user, password } = await createRoleAssignedMember(sequelize.models, { organizationId: agency.id, roleKeys: ['developer'] });
    const login = await loginAs(app, user.email, password);
    const res = await auth(login)(request(app).post(`/api/v1/projects/${project.id}/website/domain/register`).send({ domain: 'example-acme.com' }));
    expect(res.status).toBe(403);
  });

  test('registers a domain via the mock Namecheap adapter, moving it to active with real registeredAt/expiresAt', async () => {
    const { project, pmAuth } = await setupProjectWithWebsite();
    const res = await pmAuth(request(app).post(`/api/v1/projects/${project.id}/website/domain/register`).send({ domain: 'example-acme.com', years: 2 }));
    expect(res.status).toBe(200);
    expect(res.body.data.domain.status).toBe('active');
    expect(res.body.data.domain.domain).toBe('example-acme.com');
    expect(res.body.data.domain.externalDomainId).toMatch(/^mock_domain_/);
    expect(res.body.data.domain.registeredAt).toBeTruthy();
    expect(res.body.data.domain.expiresAt).toBeTruthy();

    const getRes = await pmAuth(request(app).get(`/api/v1/projects/${project.id}/website/domain`));
    expect(getRes.body.data.domain.status).toBe('active');
  });

  test('is idempotent — registering twice never creates two rows or calls the adapter a second time', async () => {
    const { project, pmAuth } = await setupProjectWithWebsite();
    const first = await pmAuth(request(app).post(`/api/v1/projects/${project.id}/website/domain/register`).send({ domain: 'idempotent-acme.com' }));
    const second = await pmAuth(request(app).post(`/api/v1/projects/${project.id}/website/domain/register`).send({ domain: 'idempotent-acme.com' }));
    expect(first.body.data.domain.id).toBe(second.body.data.domain.id);
    expect(first.body.data.domain.externalDomainId).toBe(second.body.data.domain.externalDomainId);

    const count = await WebsiteDomain.count({ where: { websiteId: first.body.data.domain.websiteId }, __visibilityScoped: true });
    expect(count).toBe(1);
  });

  test('cross-agency isolation: an unrelated agency cannot view or register another agency\'s website domain', async () => {
    const { project } = await setupProjectWithWebsite();
    const otherAgency = await createOrganization(sequelize.models, { type: 'agency' });
    const { user, password } = await createRoleAssignedMember(sequelize.models, { organizationId: otherAgency.id, roleKeys: ['project_manager'] });
    const login = await loginAs(app, user.email, password);

    const getRes = await auth(login)(request(app).get(`/api/v1/projects/${project.id}/website/domain`));
    expect(getRes.status).toBe(404);

    const postRes = await auth(login)(request(app).post(`/api/v1/projects/${project.id}/website/domain/register`).send({ domain: 'example-acme.com' }));
    expect(postRes.status).toBe(404);
  });
});

describe('POST /api/v1/projects/:projectId/website/domain/check-availability', () => {
  test('reports a never-registered domain as available', async () => {
    const { project, pmAuth } = await setupProjectWithWebsite();
    const res = await pmAuth(request(app).post(`/api/v1/projects/${project.id}/website/domain/check-availability`).send({ domain: 'brand-new-domain.com' }));
    expect(res.status).toBe(200);
    expect(res.body.data.available).toBe(true);
  });

  test('reports an already-registered domain as unavailable', async () => {
    const { project, pmAuth } = await setupProjectWithWebsite();
    await pmAuth(request(app).post(`/api/v1/projects/${project.id}/website/domain/register`).send({ domain: 'example-acme.com' }));
    const res = await pmAuth(request(app).post(`/api/v1/projects/${project.id}/website/domain/check-availability`).send({ domain: 'example-acme.com' }));
    expect(res.body.data.available).toBe(false);
  });
});

describe('POST /api/v1/projects/:projectId/website/domain/dns-records', () => {
  test('updates DNS records on an already-registered domain', async () => {
    const { project, pmAuth } = await setupProjectWithWebsite();
    await pmAuth(request(app).post(`/api/v1/projects/${project.id}/website/domain/register`).send({ domain: 'example-acme.com' }));
    const records = [{ type: 'A', host: '@', value: '192.0.2.1' }];
    const res = await pmAuth(request(app).post(`/api/v1/projects/${project.id}/website/domain/dns-records`).send({ records }));
    expect(res.status).toBe(200);
    expect(res.body.data.domain.dnsRecords).toEqual(records);
  });

  test('404s when no domain has been registered yet', async () => {
    const { project, pmAuth } = await setupProjectWithWebsite();
    const res = await pmAuth(request(app).post(`/api/v1/projects/${project.id}/website/domain/dns-records`).send({ records: [] }));
    expect(res.status).toBe(404);
  });
});

describe('NamecheapAdapter (unit)', () => {
  test('DisabledNamecheapAdapter rejects every operation instead of silently succeeding', async () => {
    const adapter = new DisabledNamecheapAdapter();
    await expect(adapter.checkAvailability('x.com')).rejects.toThrow(/not configured/i);
    await expect(adapter.registerDomain('x.com', 1)).rejects.toThrow(/not configured/i);
    await expect(adapter.getDomainInfo('x.com')).rejects.toThrow(/not configured/i);
    await expect(adapter.updateDnsRecords('x.com', [])).rejects.toThrow(/not configured/i);
    await expect(adapter.renewDomain('x.com', 1)).rejects.toThrow(/not configured/i);
    await expect(adapter.initiateTransfer('x.com')).rejects.toThrow(/not configured/i);
  });

  test('MockNamecheapAdapter simulates a full register/DNS/renew/transfer lifecycle with real state', async () => {
    const adapter = new MockNamecheapAdapter();

    const availableBefore = await adapter.checkAvailability('lifecycle.com');
    expect(availableBefore.available).toBe(true);

    const registered = await adapter.registerDomain('lifecycle.com', 1);
    expect(registered.externalDomainId).toMatch(/^mock_domain_/);
    const originalExpiry = registered.expiresAt;

    const availableAfter = await adapter.checkAvailability('lifecycle.com');
    expect(availableAfter.available).toBe(false);

    const info = await adapter.getDomainInfo('lifecycle.com');
    expect(info.status).toBe('active');

    const dnsResult = await adapter.updateDnsRecords('lifecycle.com', [{ type: 'A', host: '@', value: '203.0.113.5' }]);
    expect(dnsResult.dnsRecords).toHaveLength(1);
    const infoAfterDns = await adapter.getDomainInfo('lifecycle.com');
    expect(infoAfterDns.dnsRecords).toHaveLength(1);

    const renewed = await adapter.renewDomain('lifecycle.com', 1);
    expect(new Date(renewed.expiresAt).getTime()).toBeGreaterThan(new Date(originalExpiry).getTime());

    const transferred = await adapter.initiateTransfer('lifecycle.com');
    expect(transferred.status).toBe('transferring');
  });

  test('MockNamecheapAdapter rejects operations against an unknown domain', async () => {
    const adapter = new MockNamecheapAdapter();
    await expect(adapter.getDomainInfo('never-registered.com')).rejects.toThrow(/unknown domain/i);
    await expect(adapter.updateDnsRecords('never-registered.com', [])).rejects.toThrow(/unknown domain/i);
    await expect(adapter.renewDomain('never-registered.com', 1)).rejects.toThrow(/unknown domain/i);
    await expect(adapter.initiateTransfer('never-registered.com')).rejects.toThrow(/unknown domain/i);
  });

  test('MockNamecheapAdapter rejects registering an already-registered domain', async () => {
    const adapter = new MockNamecheapAdapter();
    await adapter.registerDomain('dup.com', 1);
    await expect(adapter.registerDomain('dup.com', 1)).rejects.toThrow(/already registered/i);
  });
});
