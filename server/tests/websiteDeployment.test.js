'use strict';

const request = require('supertest');
const app = require('../app');
const { sequelize, Project, WebsiteDeployment } = require('../models');
const { createOrganization, createRoleAssignedMember, loginAs } = require('./helpers/factory');

afterAll(async () => {
  await sequelize.close();
});

function auth(login) {
  return (r) => r.set('Authorization', `Bearer ${login.token}`);
}

async function setupProjectWithWebsiteAndRepository() {
  const agency = await createOrganization(sequelize.models, { type: 'agency' });
  const clientOrg = await createOrganization(sequelize.models, { type: 'client', managingAgencyOrganizationId: agency.id });
  const project = await Project.create({
    organizationId: clientOrg.id, agencyOrganizationId: agency.id, stage: 'Design', healthStatus: 'on_track',
  });

  const { user: developer, password: developerPassword } = await createRoleAssignedMember(sequelize.models, { organizationId: agency.id, roleKeys: ['developer'] });
  const developerLogin = await loginAs(app, developer.email, developerPassword);
  const developerAuth = auth(developerLogin);
  await developerAuth(request(app).post(`/api/v1/projects/${project.id}/website`).send({ name: 'x', startingMode: 'blank' }));
  await developerAuth(request(app).post(`/api/v1/projects/${project.id}/website/repository`));

  const base = await developerAuth(request(app).get(`/api/v1/projects/${project.id}/website`));
  const withHero = structuredClone(base.body.data.website.draftSchema);
  withHero.pages[0].sections.push({
    id: 'hero-1', componentKey: 'hero', content: { heading: 'Welcome' }, settings: {},
  });
  await developerAuth(request(app).patch(`/api/v1/projects/${project.id}/website/draft`).send({ draftSchema: withHero }));
  const checkpoint = await developerAuth(request(app).post(`/api/v1/projects/${project.id}/website/versions`).send({ label: 'v1' }));

  return {
    agency, clientOrg, project, developerAuth, versionId: checkpoint.body.data.version.id,
  };
}

describe('WebsiteDeployment visibility guard', () => {
  test('a raw unscoped query throws', async () => {
    await expect(WebsiteDeployment.findAll()).rejects.toThrow(/must be queried through/i);
  });
});

describe('POST /api/v1/projects/:projectId/website/versions/:versionId/deploy-preview', () => {
  test('builder.develop is required — builder.edit alone (a designer) is not enough', async () => {
    const { agency, project, versionId } = await setupProjectWithWebsiteAndRepository();
    const { user, password } = await createRoleAssignedMember(sequelize.models, { organizationId: agency.id, roleKeys: ['designer'] });
    const login = await loginAs(app, user.email, password);
    const res = await auth(login)(request(app).post(`/api/v1/projects/${project.id}/website/versions/${versionId}/deploy-preview`));
    expect(res.status).toBe(403);
  });

  test('a client can never reach this route (builder.develop is never grantable to a client role)', async () => {
    const { clientOrg, project, versionId } = await setupProjectWithWebsiteAndRepository();
    const { user, password } = await createRoleAssignedMember(sequelize.models, {
      organizationId: clientOrg.id, roleKeys: ['client_owner'], membershipType: 'client',
    });
    const login = await loginAs(app, user.email, password);
    const res = await auth(login)(request(app).post(`/api/v1/projects/${project.id}/website/versions/${versionId}/deploy-preview`));
    expect(res.status).toBe(403);
  });

  test('deploys a real preview branch, commits generated files, and enables Pages, recording a live WebsiteDeployment', async () => {
    const { project, developerAuth, versionId } = await setupProjectWithWebsiteAndRepository();
    const res = await developerAuth(request(app).post(`/api/v1/projects/${project.id}/website/versions/${versionId}/deploy-preview`));
    expect(res.status).toBe(201);
    expect(res.body.data.deployment.status).toBe('live');
    expect(res.body.data.deployment.environment).toBe('preview');
    expect(res.body.data.deployment.branchName).toMatch(/^preview\/v\d+$/);
    expect(res.body.data.deployment.commitSha).toMatch(/^mock_sha_/);
    expect(res.body.data.deployment.previewUrl).toMatch(/^https:\/\/mock\.pages\.test\//);

    const list = await developerAuth(request(app).get(`/api/v1/projects/${project.id}/website/deployments`));
    expect(list.status).toBe(200);
    expect(list.body.data.deployments.length).toBe(1);
  });

  test('redeploying the same version reuses the same branch (no error) and records a SECOND deployment row — an audit trail, never updated in place', async () => {
    const { project, developerAuth, versionId } = await setupProjectWithWebsiteAndRepository();
    const first = await developerAuth(request(app).post(`/api/v1/projects/${project.id}/website/versions/${versionId}/deploy-preview`));
    expect(first.status).toBe(201);

    const second = await developerAuth(request(app).post(`/api/v1/projects/${project.id}/website/versions/${versionId}/deploy-preview`));
    expect(second.status).toBe(201);
    expect(second.body.data.deployment.branchName).toBe(first.body.data.deployment.branchName);
    expect(second.body.data.deployment.id).not.toBe(first.body.data.deployment.id);

    const list = await developerAuth(request(app).get(`/api/v1/projects/${project.id}/website/deployments`));
    expect(list.body.data.deployments.length).toBe(2);
  });

  test('cross-agency isolation: an unrelated agency\'s developer cannot deploy or list another agency\'s website', async () => {
    const { project, developerAuth, versionId } = await setupProjectWithWebsiteAndRepository();
    await developerAuth(request(app).post(`/api/v1/projects/${project.id}/website/versions/${versionId}/deploy-preview`));

    const otherAgency = await createOrganization(sequelize.models, { type: 'agency' });
    const { user, password } = await createRoleAssignedMember(sequelize.models, { organizationId: otherAgency.id, roleKeys: ['developer'] });
    const login = await loginAs(app, user.email, password);

    const deployRes = await auth(login)(request(app).post(`/api/v1/projects/${project.id}/website/versions/${versionId}/deploy-preview`));
    expect(deployRes.status).toBe(404);
    const listRes = await auth(login)(request(app).get(`/api/v1/projects/${project.id}/website/deployments`));
    expect(listRes.status).toBe(404);
  });
});
