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

async function setupProjectWithWebsiteAndCheckpoint() {
  const agency = await createOrganization(sequelize.models, { type: 'agency' });
  const clientOrg = await createOrganization(sequelize.models, { type: 'client', managingAgencyOrganizationId: agency.id });
  const project = await Project.create({
    organizationId: clientOrg.id, agencyOrganizationId: agency.id, stage: 'Design', healthStatus: 'on_track',
  });

  const { user: developer, password: developerPassword } = await createRoleAssignedMember(sequelize.models, { organizationId: agency.id, roleKeys: ['developer'] });
  const developerLogin = await loginAs(app, developer.email, developerPassword);
  const developerAuth = auth(developerLogin);
  await developerAuth(request(app).post(`/api/v1/projects/${project.id}/website`).send({ name: 'x', startingMode: 'blank' }));

  const base = await developerAuth(request(app).get(`/api/v1/projects/${project.id}/website`));
  const withHero = structuredClone(base.body.data.website.draftSchema);
  withHero.pages[0].sections.push({
    id: 'hero-1', componentKey: 'hero', content: { heading: 'Welcome' }, settings: { layout: 'centered' },
  });
  await developerAuth(request(app).patch(`/api/v1/projects/${project.id}/website/draft`).send({ draftSchema: withHero }));
  const checkpoint = await developerAuth(request(app).post(`/api/v1/projects/${project.id}/website/versions`).send({ label: 'v1' }));

  return {
    agency, clientOrg, project, developerAuth, versionId: checkpoint.body.data.version.id,
  };
}

describe('POST /api/v1/projects/:projectId/website/versions/:versionId/generate', () => {
  test('builder.develop is required — builder.edit alone (a designer) is not enough', async () => {
    const { agency, project, versionId } = await setupProjectWithWebsiteAndCheckpoint();
    const { user, password } = await createRoleAssignedMember(sequelize.models, { organizationId: agency.id, roleKeys: ['designer'] });
    const login = await loginAs(app, user.email, password);
    const res = await auth(login)(request(app).post(`/api/v1/projects/${project.id}/website/versions/${versionId}/generate`));
    expect(res.status).toBe(403);
  });

  test('rejects generation when no repository has been provisioned yet', async () => {
    const { project, developerAuth, versionId } = await setupProjectWithWebsiteAndCheckpoint();
    const res = await developerAuth(request(app).post(`/api/v1/projects/${project.id}/website/versions/${versionId}/generate`));
    expect(res.status).toBe(422);
    expect(res.body.message).toMatch(/repository/i);
  });

  test('generates and commits real Angular output to the provisioned repository once one exists', async () => {
    const { project, developerAuth, versionId } = await setupProjectWithWebsiteAndCheckpoint();
    await developerAuth(request(app).post(`/api/v1/projects/${project.id}/website/repository`));

    const res = await developerAuth(request(app).post(`/api/v1/projects/${project.id}/website/versions/${versionId}/generate`));
    expect(res.status).toBe(200);
    expect(res.body.data.fileCount).toBeGreaterThan(0);
    expect(res.body.data.commit.sha).toMatch(/^mock_sha_/);
    expect(res.body.data.branch).toBe('main');
  });

  test('cross-agency isolation: an unrelated agency\'s developer cannot trigger generation for another agency\'s website version', async () => {
    const { project, developerAuth, versionId } = await setupProjectWithWebsiteAndCheckpoint();
    await developerAuth(request(app).post(`/api/v1/projects/${project.id}/website/repository`));

    const otherAgency = await createOrganization(sequelize.models, { type: 'agency' });
    const { user, password } = await createRoleAssignedMember(sequelize.models, { organizationId: otherAgency.id, roleKeys: ['developer'] });
    const login = await loginAs(app, user.email, password);
    const res = await auth(login)(request(app).post(`/api/v1/projects/${project.id}/website/versions/${versionId}/generate`));
    expect(res.status).toBe(404);
  });
});
