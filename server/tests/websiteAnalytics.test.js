'use strict';

const request = require('supertest');
const app = require('../app');
const {
  sequelize, Project, WebsiteAnalyticsEvent,
} = require('../models');
const { createOrganization, createRoleAssignedMember, loginAs } = require('./helpers/factory');
const { generateWebsiteFiles } = require('../core/codegen/generateWebsiteFiles');

afterAll(async () => {
  await sequelize.close();
});

function auth(login) {
  return (r) => r.set('Authorization', `Bearer ${login.token}`);
}

async function setupLiveWebsite(domain) {
  const agency = await createOrganization(sequelize.models, { type: 'agency' });
  const clientOrg = await createOrganization(sequelize.models, { type: 'client', managingAgencyOrganizationId: agency.id });
  const project = await Project.create({
    organizationId: clientOrg.id, agencyOrganizationId: agency.id, stage: 'Design', healthStatus: 'on_track',
  });

  const { user: developer, password: developerPassword } = await createRoleAssignedMember(sequelize.models, { organizationId: agency.id, roleKeys: ['developer'] });
  const developerAuth = auth(await loginAs(app, developer.email, developerPassword));
  await developerAuth(request(app).post(`/api/v1/projects/${project.id}/website`).send({ name: 'Acme Co Site', startingMode: 'blank' }));
  await developerAuth(request(app).post(`/api/v1/projects/${project.id}/website/repository`));
  const checkpoint = await developerAuth(request(app).post(`/api/v1/projects/${project.id}/website/versions`).send({ label: 'v1' }));
  const versionId = checkpoint.body.data.version.id;

  const { user: pm, password: pmPassword } = await createRoleAssignedMember(sequelize.models, { organizationId: agency.id, roleKeys: ['project_manager'] });
  const pmAuth = auth(await loginAs(app, pm.email, pmPassword));
  await pmAuth(request(app).post(`/api/v1/projects/${project.id}/website/domain/register`).send({ domain }));
  const deployRes = await pmAuth(request(app).post(`/api/v1/projects/${project.id}/website/versions/${versionId}/deploy-production`));
  expect(deployRes.body.data.deployment.status).toBe('live');

  const websiteRes = await developerAuth(request(app).get(`/api/v1/projects/${project.id}/website`));
  const websiteId = websiteRes.body.data.website.id;

  const { user: clientUser, password: clientPassword } = await createRoleAssignedMember(sequelize.models, {
    organizationId: clientOrg.id, roleKeys: ['client_owner'], membershipType: 'client',
  });
  const clientAuth = auth(await loginAs(app, clientUser.email, clientPassword));

  return {
    agency, clientOrg, project, developerAuth, pmAuth, clientAuth, websiteId,
  };
}

describe('WebsiteAnalyticsEvent visibility guard', () => {
  test('a raw unscoped query throws', async () => {
    await expect(WebsiteAnalyticsEvent.findAll()).rejects.toThrow(/must be queried through/i);
  });
});

describe('POST /api/v1/public/websites/:websiteId/analytics-event', () => {
  test('a real event against a live website creates a row, with no auth required', async () => {
    const { websiteId } = await setupLiveWebsite('analytics-live.com');

    const res = await request(app).post(`/api/v1/public/websites/${websiteId}/analytics-event`).send({
      eventType: 'page_view', path: '/', sessionId: 'sess-123', metadata: { referrer: 'https://google.com' },
    });
    expect(res.status).toBe(200);
    expect(res.body.data.recorded).toBe(true);

    const rows = await WebsiteAnalyticsEvent.findAll({ where: { websiteId }, __visibilityScoped: true });
    expect(rows.length).toBe(1);
    expect(rows[0].eventType).toBe('page_view');
    expect(rows[0].sessionId).toBe('sess-123');
  });

  test('an unknown eventType is rejected', async () => {
    const { websiteId } = await setupLiveWebsite('analytics-bad-type.com');
    const res = await request(app).post(`/api/v1/public/websites/${websiteId}/analytics-event`).send({
      eventType: 'not_a_real_type', sessionId: 'sess-1',
    });
    expect(res.status).toBe(422);
  });

  test('a non-existent website and a draft-only (never-deployed) website both produce the same generic 404', async () => {
    const agency = await createOrganization(sequelize.models, { type: 'agency' });
    const clientOrg = await createOrganization(sequelize.models, { type: 'client', managingAgencyOrganizationId: agency.id });
    const project = await Project.create({
      organizationId: clientOrg.id, agencyOrganizationId: agency.id, stage: 'Design', healthStatus: 'on_track',
    });
    const { user: developer, password: developerPassword } = await createRoleAssignedMember(sequelize.models, { organizationId: agency.id, roleKeys: ['developer'] });
    const developerAuth = auth(await loginAs(app, developer.email, developerPassword));
    await developerAuth(request(app).post(`/api/v1/projects/${project.id}/website`).send({ name: 'Draft only', startingMode: 'blank' }));
    const websiteRes = await developerAuth(request(app).get(`/api/v1/projects/${project.id}/website`));

    const draftOnlyRes = await request(app).post(`/api/v1/public/websites/${websiteRes.body.data.website.id}/analytics-event`).send({
      eventType: 'page_view', sessionId: 'sess-1',
    });
    const nonExistentRes = await request(app).post('/api/v1/public/websites/00000000-0000-0000-0000-000000000000/analytics-event').send({
      eventType: 'page_view', sessionId: 'sess-1',
    });
    expect(draftOnlyRes.status).toBe(404);
    expect(draftOnlyRes.body.message).toBe(nonExistentRes.body.message);
  });
});

describe('GET /api/v1/projects/:projectId/website/analytics/events (raw, employee-only)', () => {
  test('a client cannot list raw events even with projects.view', async () => {
    const { project, clientAuth } = await setupLiveWebsite('analytics-raw-perm.com');
    const res = await clientAuth(request(app).get(`/api/v1/projects/${project.id}/website/analytics/events`));
    expect(res.status).toBe(403);
  });

  test('an employee with builder.manage sees raw event rows', async () => {
    const { project, pmAuth, websiteId } = await setupLiveWebsite('analytics-raw-list.com');
    await request(app).post(`/api/v1/public/websites/${websiteId}/analytics-event`).send({ eventType: 'page_view', sessionId: 's1' });
    await request(app).post(`/api/v1/public/websites/${websiteId}/analytics-event`).send({ eventType: 'click', sessionId: 's1' });

    const res = await pmAuth(request(app).get(`/api/v1/projects/${project.id}/website/analytics/events`));
    expect(res.status).toBe(200);
    expect(res.body.data.events.length).toBe(2);
  });
});

describe('GET /api/v1/projects/:projectId/website/analytics/summary (aggregate, client + employee)', () => {
  test('both a client and an employee can read the aggregate summary, with per-day/eventType counts', async () => {
    const {
      project, pmAuth, clientAuth, websiteId,
    } = await setupLiveWebsite('analytics-summary.com');

    await request(app).post(`/api/v1/public/websites/${websiteId}/analytics-event`).send({ eventType: 'page_view', sessionId: 's1' });
    await request(app).post(`/api/v1/public/websites/${websiteId}/analytics-event`).send({ eventType: 'page_view', sessionId: 's2' });
    await request(app).post(`/api/v1/public/websites/${websiteId}/analytics-event`).send({ eventType: 'click', sessionId: 's1' });

    const employeeRes = await pmAuth(request(app).get(`/api/v1/projects/${project.id}/website/analytics/summary`));
    expect(employeeRes.status).toBe(200);
    const pageViewRow = employeeRes.body.data.summary.find((r) => r.eventType === 'page_view');
    expect(pageViewRow.count).toBe(2);
    const clickRow = employeeRes.body.data.summary.find((r) => r.eventType === 'click');
    expect(clickRow.count).toBe(1);

    const clientRes = await clientAuth(request(app).get(`/api/v1/projects/${project.id}/website/analytics/summary`));
    expect(clientRes.status).toBe(200);
    expect(clientRes.body.data.summary.find((r) => r.eventType === 'page_view').count).toBe(2);

    // The client-visible summary never carries raw sessionId/metadata —
    // only aggregated day/eventType/count.
    for (const row of clientRes.body.data.summary) {
      expect(row.sessionId).toBeUndefined();
      expect(row.metadata).toBeUndefined();
    }
  });
});

describe('POST /api/v1/projects/:projectId/website/analytics/google-analytics', () => {
  test('sets a valid GA4 measurement id', async () => {
    const { project, pmAuth } = await setupLiveWebsite('ga-connect.com');
    const res = await pmAuth(request(app).post(`/api/v1/projects/${project.id}/website/analytics/google-analytics`).send({ measurementId: 'G-ABC1234XYZ' }));
    expect(res.status).toBe(200);
    expect(res.body.data.website.googleAnalyticsMeasurementId).toBe('G-ABC1234XYZ');
  });

  test('rejects a malformed measurement id', async () => {
    const { project, pmAuth } = await setupLiveWebsite('ga-bad-format.com');
    const res = await pmAuth(request(app).post(`/api/v1/projects/${project.id}/website/analytics/google-analytics`).send({ measurementId: 'not-a-ga-id' }));
    expect(res.status).toBe(422);
  });

  test('clears the measurement id when sent empty', async () => {
    const { project, pmAuth } = await setupLiveWebsite('ga-clear.com');
    await pmAuth(request(app).post(`/api/v1/projects/${project.id}/website/analytics/google-analytics`).send({ measurementId: 'G-ABC1234XYZ' }));
    const res = await pmAuth(request(app).post(`/api/v1/projects/${project.id}/website/analytics/google-analytics`).send({ measurementId: '' }));
    expect(res.status).toBe(200);
    expect(res.body.data.website.googleAnalyticsMeasurementId).toBeNull();
  });

  test('builder.manage is required', async () => {
    const { project, developerAuth } = await setupLiveWebsite('ga-perm-check.com');
    const res = await developerAuth(request(app).post(`/api/v1/projects/${project.id}/website/analytics/google-analytics`).send({ measurementId: 'G-ABC1234XYZ' }));
    expect(res.status).toBe(403);
  });
});

describe('cross-agency isolation', () => {
  test('an unrelated agency cannot list raw events, read the summary, or set the GA id for another agency\'s website', async () => {
    const { project } = await setupLiveWebsite('analytics-isolation.com');
    const otherAgency = await createOrganization(sequelize.models, { type: 'agency' });
    const { user, password } = await createRoleAssignedMember(sequelize.models, { organizationId: otherAgency.id, roleKeys: ['project_manager'] });
    const login = await loginAs(app, user.email, password);

    const eventsRes = await auth(login)(request(app).get(`/api/v1/projects/${project.id}/website/analytics/events`));
    expect(eventsRes.status).toBe(404);
    const summaryRes = await auth(login)(request(app).get(`/api/v1/projects/${project.id}/website/analytics/summary`));
    expect(summaryRes.status).toBe(404);
    const gaRes = await auth(login)(request(app).post(`/api/v1/projects/${project.id}/website/analytics/google-analytics`).send({ measurementId: 'G-X' }));
    expect(gaRes.status).toBe(404);
  });
});

describe('generateWebsiteFiles embeds the GA measurement id into leadzaro.config.json (unit)', () => {
  test('embeds a set measurement id', () => {
    const files = generateWebsiteFiles({
      schema: { pages: [] },
      sectionDefinitionsByKey: new Map(),
      designTokens: {},
      websiteId: 'w1',
      websiteVersionId: 'v1',
      generatedAt: '2026-01-01T00:00:00.000Z',
      googleAnalyticsMeasurementId: 'G-ABC1234XYZ',
    });
    const configFile = files.find((f) => f.path === 'leadzaro.config.json');
    expect(JSON.parse(configFile.content).googleAnalyticsMeasurementId).toBe('G-ABC1234XYZ');
  });

  test('emits null when not set', () => {
    const files = generateWebsiteFiles({
      schema: { pages: [] },
      sectionDefinitionsByKey: new Map(),
      designTokens: {},
      websiteId: 'w1',
      websiteVersionId: 'v1',
      generatedAt: '2026-01-01T00:00:00.000Z',
    });
    const configFile = files.find((f) => f.path === 'leadzaro.config.json');
    expect(JSON.parse(configFile.content).googleAnalyticsMeasurementId).toBeNull();
  });
});
