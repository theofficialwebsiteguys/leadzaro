'use strict';

const request = require('supertest');
const app = require('../app');
const { sequelize, Project, WebsiteSeoAudit } = require('../models');
const { createOrganization, createRoleAssignedMember, loginAs } = require('./helpers/factory');
const {
  MockSeoAuditAdapter, DisabledSeoAuditAdapter, getSeoAuditAdapter,
} = require('../core/integrations/seoAudit/seoAuditAdapter');

afterAll(async () => {
  await sequelize.close();
});

function auth(login) {
  return (r) => r.set('Authorization', `Bearer ${login.token}`);
}

async function setupEntitledWebsite({ domain = null } = {}) {
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
  await adminAuth(request(app).post(`/api/v1/seo/organizations/${clientOrg.id}/entitlement-grants`).send({ reason: 'test' }));

  if (domain) {
    await adminAuth(request(app).post(`/api/v1/projects/${project.id}/website/domain/register`).send({ domain }));
  }

  return {
    agency, clientOrg, project, adminAuth, versionId: checkpoint.body.data.version.id,
  };
}

describe('WebsiteSeoAudit visibility guard', () => {
  test('a raw unscoped query throws', async () => {
    await expect(WebsiteSeoAudit.findAll()).rejects.toThrow(/must be queried through/i);
  });
});

describe('SeoAuditAdapter (unit)', () => {
  test('DisabledSeoAuditAdapter rejects every operation instead of silently succeeding', async () => {
    const adapter = new DisabledSeoAuditAdapter();
    await expect(adapter.checkLinks(['https://x.com'])).rejects.toThrow(/not configured/i);
    await expect(adapter.checkPerformance('https://x.com')).rejects.toThrow(/not configured/i);
  });

  test('MockSeoAuditAdapter defaults every unconfigured URL to ok, and setLinkStatus/setPerformanceStatus override provably', async () => {
    const adapter = new MockSeoAuditAdapter();
    const defaultLinks = await adapter.checkLinks(['https://x.com/a', 'https://x.com/b']);
    expect(defaultLinks.every((r) => r.status === 'ok')).toBe(true);

    adapter.setLinkStatus('https://x.com/a', 'broken');
    adapter.setLinkStatus('https://x.com/b', 'inconclusive');
    const overridden = await adapter.checkLinks(['https://x.com/a', 'https://x.com/b']);
    expect(overridden.find((r) => r.url === 'https://x.com/a').status).toBe('broken');
    expect(overridden.find((r) => r.url === 'https://x.com/b').status).toBe('inconclusive');

    const defaultPerf = await adapter.checkPerformance('https://x.com/');
    expect(defaultPerf.status).toBe('ok');

    adapter.setPerformanceStatus('https://x.com/', 'broken', 20);
    const overriddenPerf = await adapter.checkPerformance('https://x.com/');
    expect(overriddenPerf.status).toBe('broken');
    expect(overriddenPerf.score).toBe(20);
  });
});

describe('POST /api/v1/projects/:projectId/website/seo/audits', () => {
  test('requires an active SEO entitlement', async () => {
    const agency = await createOrganization(sequelize.models, { type: 'agency' });
    const clientOrg = await createOrganization(sequelize.models, { type: 'client', managingAgencyOrganizationId: agency.id });
    const project = await Project.create({
      organizationId: clientOrg.id, agencyOrganizationId: agency.id, stage: 'Design', healthStatus: 'on_track',
    });
    const { user: developer, password: developerPassword } = await createRoleAssignedMember(sequelize.models, { organizationId: agency.id, roleKeys: ['developer'] });
    const developerAuth = auth(await loginAs(app, developer.email, developerPassword));
    await developerAuth(request(app).post(`/api/v1/projects/${project.id}/website`).send({ name: 'x', startingMode: 'blank' }));
    const checkpoint = await developerAuth(request(app).post(`/api/v1/projects/${project.id}/website/versions`).send({ label: 'v1' }));
    const { user: admin, password: adminPassword } = await createRoleAssignedMember(sequelize.models, { organizationId: agency.id, roleKeys: ['administrator'] });
    const adminAuth = auth(await loginAs(app, admin.email, adminPassword));

    const res = await adminAuth(request(app).post(`/api/v1/projects/${project.id}/website/seo/audits`).send({ versionId: checkpoint.body.data.version.id }));
    expect(res.status).toBe(403);
  });

  test('with no domain registered, runs structural checks only (no broken-link findings) and records the audit', async () => {
    const { project, adminAuth, versionId } = await setupEntitledWebsite();
    const res = await adminAuth(request(app).post(`/api/v1/projects/${project.id}/website/seo/audits`).send({ versionId }));
    expect(res.status).toBe(200);
    expect(res.body.data.audit.websiteVersionId).toBe(versionId);
    expect(res.body.data.audit.findings.some((f) => f.check === 'broken_link')).toBe(false);
    // A blank starting-mode site has an empty home page — expect the
    // structural checker's own empty_page finding to be present.
    expect(res.body.data.audit.findings.some((f) => f.check === 'empty_page')).toBe(true);
  });

  test('with a registered domain, a mock-configured broken link and poor performance both surface as real findings', async () => {
    const { project, adminAuth, versionId } = await setupEntitledWebsite({ domain: 'audit-test.com' });
    const adapter = getSeoAuditAdapter();
    adapter.setLinkStatus('https://audit-test.com/', 'broken');
    adapter.setPerformanceStatus('https://audit-test.com/', 'broken', 15);

    try {
      const res = await adminAuth(request(app).post(`/api/v1/projects/${project.id}/website/seo/audits`).send({ versionId }));
      expect(res.status).toBe(200);
      expect(res.body.data.audit.findings.some((f) => f.check === 'broken_link' && f.url === 'https://audit-test.com/')).toBe(true);
      expect(res.body.data.audit.findings.some((f) => f.check === 'performance_poor')).toBe(true);
    } finally {
      adapter.setLinkStatus('https://audit-test.com/', 'ok');
      adapter.setPerformanceStatus('https://audit-test.com/', 'ok', 90);
    }
  });

  test('every run creates a new audit row — an audit trail, not an updated one', async () => {
    const { project, adminAuth, versionId } = await setupEntitledWebsite();
    await adminAuth(request(app).post(`/api/v1/projects/${project.id}/website/seo/audits`).send({ versionId }));
    await adminAuth(request(app).post(`/api/v1/projects/${project.id}/website/seo/audits`).send({ versionId }));

    const list = await adminAuth(request(app).get(`/api/v1/projects/${project.id}/website/seo/audits`));
    expect(list.body.data.audits.length).toBe(2);
  });
});

describe('GET /api/v1/projects/:projectId/website/seo/audits/:auditId', () => {
  test('fetches a single audit\'s full findings', async () => {
    const { project, adminAuth, versionId } = await setupEntitledWebsite();
    const runRes = await adminAuth(request(app).post(`/api/v1/projects/${project.id}/website/seo/audits`).send({ versionId }));
    const getRes = await adminAuth(request(app).get(`/api/v1/projects/${project.id}/website/seo/audits/${runRes.body.data.audit.id}`));
    expect(getRes.status).toBe(200);
    expect(getRes.body.data.audit.id).toBe(runRes.body.data.audit.id);
  });

  test('cross-agency isolation', async () => {
    const { project, adminAuth, versionId } = await setupEntitledWebsite();
    const runRes = await adminAuth(request(app).post(`/api/v1/projects/${project.id}/website/seo/audits`).send({ versionId }));

    const otherAgency = await createOrganization(sequelize.models, { type: 'agency' });
    const { user, password } = await createRoleAssignedMember(sequelize.models, { organizationId: otherAgency.id, roleKeys: ['administrator'] });
    const login = await loginAs(app, user.email, password);
    const res = await auth(login)(request(app).get(`/api/v1/projects/${project.id}/website/seo/audits/${runRes.body.data.audit.id}`));
    expect(res.status).toBe(404);
  });
});
