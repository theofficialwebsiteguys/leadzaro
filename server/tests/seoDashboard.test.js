'use strict';

const request = require('supertest');
const app = require('../app');
const { sequelize, Project } = require('../models');
const { createOrganization, createRoleAssignedMember, loginAs } = require('./helpers/factory');

afterAll(async () => {
  await sequelize.close();
});

function auth(login) {
  return (r) => r.set('Authorization', `Bearer ${login.token}`);
}

async function setupWebsite() {
  const agency = await createOrganization(sequelize.models, { type: 'agency' });
  const clientOrg = await createOrganization(sequelize.models, { type: 'client', managingAgencyOrganizationId: agency.id });
  const project = await Project.create({
    organizationId: clientOrg.id, agencyOrganizationId: agency.id, stage: 'Design', healthStatus: 'on_track',
  });

  const { user: developer, password: developerPassword } = await createRoleAssignedMember(sequelize.models, { organizationId: agency.id, roleKeys: ['developer'] });
  const developerAuth = auth(await loginAs(app, developer.email, developerPassword));
  await developerAuth(request(app).post(`/api/v1/projects/${project.id}/website`).send({ name: 'Acme Co Site', startingMode: 'blank' }));
  const checkpoint = await developerAuth(request(app).post(`/api/v1/projects/${project.id}/website/versions`).send({ label: 'v1' }));

  const { user: admin, password: adminPassword } = await createRoleAssignedMember(sequelize.models, { organizationId: agency.id, roleKeys: ['administrator'] });
  const adminAuth = auth(await loginAs(app, admin.email, adminPassword));

  const { user: clientUser, password: clientPassword } = await createRoleAssignedMember(sequelize.models, {
    organizationId: clientOrg.id, roleKeys: ['client_owner'], membershipType: 'client',
  });
  const clientAuth = auth(await loginAs(app, clientUser.email, clientPassword));

  return {
    agency, clientOrg, project, adminAuth, clientAuth, versionId: checkpoint.body.data.version.id,
  };
}

describe('GET /api/v1/projects/:projectId/website/seo/dashboard', () => {
  test('a non-entitled organization sees entitled: false with zeroed-out fields, not a 403 (the dashboard itself must show entitlement status)', async () => {
    const { project, adminAuth } = await setupWebsite();
    const res = await adminAuth(request(app).get(`/api/v1/projects/${project.id}/website/seo/dashboard`));
    expect(res.status).toBe(200);
    expect(res.body.data.dashboard.entitled).toBe(false);
    expect(res.body.data.dashboard.latestAudit).toBeNull();
  });

  test('an entitled organization sees real counts, and both employee and client can read the same dashboard', async () => {
    const {
      project, adminAuth, clientAuth, clientOrg, versionId,
    } = await setupWebsite();
    await adminAuth(request(app).post(`/api/v1/seo/organizations/${clientOrg.id}/entitlement-grants`).send({ reason: 'test' }));
    await adminAuth(request(app).post(`/api/v1/projects/${project.id}/website/seo/redirects`).send({ fromPath: '/old', toPath: '/new' }));
    await adminAuth(request(app).post(`/api/v1/projects/${project.id}/website/seo/audits`).send({ versionId }));

    const employeeRes = await adminAuth(request(app).get(`/api/v1/projects/${project.id}/website/seo/dashboard`));
    expect(employeeRes.body.data.dashboard.entitled).toBe(true);
    expect(employeeRes.body.data.dashboard.redirectCount).toBe(1);
    expect(employeeRes.body.data.dashboard.latestAudit).toBeTruthy();
    expect(employeeRes.body.data.dashboard.latestAudit.errorCount).toBeGreaterThanOrEqual(0);
    // The client-safe summary never carries raw findings.
    expect(employeeRes.body.data.dashboard.latestAudit.findings).toBeUndefined();

    const clientRes = await clientAuth(request(app).get(`/api/v1/projects/${project.id}/website/seo/dashboard`));
    expect(clientRes.status).toBe(200);
    expect(clientRes.body.data.dashboard.entitled).toBe(true);
    // redirectCount/taskCycleCount are employee-only technical details
    // (like WebsiteRedirect/SeoTaskCycle themselves) — a client sees 0
    // for those, not an error, while pageSettingsConfiguredCount and
    // the audit summary (both genuinely client-reachable) still work.
    expect(clientRes.body.data.dashboard.redirectCount).toBe(0);
    expect(clientRes.body.data.dashboard.latestAudit).toBeTruthy();
  });

  test('cross-agency isolation', async () => {
    const { project } = await setupWebsite();
    const otherAgency = await createOrganization(sequelize.models, { type: 'agency' });
    const { user, password } = await createRoleAssignedMember(sequelize.models, { organizationId: otherAgency.id, roleKeys: ['administrator'] });
    const login = await loginAs(app, user.email, password);
    const res = await auth(login)(request(app).get(`/api/v1/projects/${project.id}/website/seo/dashboard`));
    expect(res.status).toBe(404);
  });
});

describe('GET /api/v1/seo/agency-overview', () => {
  test('seo.manage_entitlements is required', async () => {
    const { agency } = await setupWebsite();
    const { user, password } = await createRoleAssignedMember(sequelize.models, { organizationId: agency.id, roleKeys: ['developer'] });
    const login = await loginAs(app, user.email, password);
    const res = await auth(login)(request(app).get('/api/v1/seo/agency-overview'));
    expect(res.status).toBe(403);
  });

  test('lists every client org managed by the agency, with real entitlement status', async () => {
    const { adminAuth, clientOrg } = await setupWebsite();
    const before = await adminAuth(request(app).get('/api/v1/seo/agency-overview'));
    expect(before.status).toBe(200);
    const beforeRow = before.body.data.overview.find((r) => r.organizationId === clientOrg.id);
    expect(beforeRow.entitled).toBe(false);

    await adminAuth(request(app).post(`/api/v1/seo/organizations/${clientOrg.id}/entitlement-grants`).send({ reason: 'test' }));
    const after = await adminAuth(request(app).get('/api/v1/seo/agency-overview'));
    const afterRow = after.body.data.overview.find((r) => r.organizationId === clientOrg.id);
    expect(afterRow.entitled).toBe(true);
  });

  test('a client-membership request is rejected', async () => {
    const { clientOrg } = await setupWebsite();
    const { user, password } = await createRoleAssignedMember(sequelize.models, {
      organizationId: clientOrg.id, roleKeys: ['client_owner'], membershipType: 'client', email: `client-overview-${Date.now()}@example.test`,
    });
    const login = await loginAs(app, user.email, password);
    const res = await auth(login)(request(app).get('/api/v1/seo/agency-overview'));
    expect(res.status).toBe(403);
  });
});
