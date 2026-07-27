'use strict';

const request = require('supertest');
const app = require('../app');
const {
  sequelize, Project, WebsiteRepository,
} = require('../models');
const { createOrganization, createRoleAssignedMember, loginAs } = require('./helpers/factory');

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

  const { user: developer, password: developerPassword } = await createRoleAssignedMember(sequelize.models, { organizationId: agency.id, roleKeys: ['developer'] });
  const developerLogin = await loginAs(app, developer.email, developerPassword);
  const developerAuth = auth(developerLogin);
  await developerAuth(request(app).post(`/api/v1/projects/${project.id}/website`).send({ name: 'Acme Co Site', startingMode: 'blank' }));

  return {
    agency, clientOrg, project, developerAuth,
  };
}

describe('WebsiteRepository visibility guard', () => {
  test('a raw unscoped query throws', async () => {
    await expect(WebsiteRepository.findAll()).rejects.toThrow(/must be queried through/i);
  });
});

describe('GET /api/v1/projects/:projectId/website/repository', () => {
  test('returns null before any repository has been provisioned', async () => {
    const { project, developerAuth } = await setupProjectWithWebsite();
    const res = await developerAuth(request(app).get(`/api/v1/projects/${project.id}/website/repository`));
    expect(res.status).toBe(200);
    expect(res.body.data.repository).toBeNull();
  });
});

describe('POST /api/v1/projects/:projectId/website/repository', () => {
  test('builder.develop is required — builder.edit alone (a designer) is not enough', async () => {
    const { agency, project } = await setupProjectWithWebsite();
    const { user, password } = await createRoleAssignedMember(sequelize.models, { organizationId: agency.id, roleKeys: ['designer'] });
    const login = await loginAs(app, user.email, password);
    const res = await auth(login)(request(app).post(`/api/v1/projects/${project.id}/website/repository`));
    expect(res.status).toBe(403);
  });

  test('provisions a repository via the mock GitHub adapter, moving it to active with a real fullName/externalRepoId', async () => {
    const { project, developerAuth } = await setupProjectWithWebsite();
    const res = await developerAuth(request(app).post(`/api/v1/projects/${project.id}/website/repository`));
    expect(res.status).toBe(200);
    expect(res.body.data.repository.status).toBe('active');
    expect(res.body.data.repository.externalRepoId).toMatch(/^mock_repo_/);
    expect(res.body.data.repository.fullName).toBeTruthy();
    expect(res.body.data.repository.defaultBranch).toBe('main');

    const getRes = await developerAuth(request(app).get(`/api/v1/projects/${project.id}/website/repository`));
    expect(getRes.body.data.repository.status).toBe('active');
  });

  test('is idempotent — provisioning twice never creates two rows or calls the adapter a second time', async () => {
    const { project, developerAuth } = await setupProjectWithWebsite();
    const first = await developerAuth(request(app).post(`/api/v1/projects/${project.id}/website/repository`));
    const second = await developerAuth(request(app).post(`/api/v1/projects/${project.id}/website/repository`));
    expect(first.body.data.repository.id).toBe(second.body.data.repository.id);
    expect(first.body.data.repository.externalRepoId).toBe(second.body.data.repository.externalRepoId);

    const count = await WebsiteRepository.count({ where: { websiteId: first.body.data.repository.websiteId }, __visibilityScoped: true });
    expect(count).toBe(1);
  });

  test('a client cannot provision a repository even with builder.edit (client_owner)', async () => {
    const { clientOrg, project } = await setupProjectWithWebsite();
    const { user, password } = await createRoleAssignedMember(sequelize.models, {
      organizationId: clientOrg.id, roleKeys: ['client_owner'], membershipType: 'client',
    });
    const login = await loginAs(app, user.email, password);
    const res = await auth(login)(request(app).post(`/api/v1/projects/${project.id}/website/repository`));
    expect(res.status).toBe(403);
  });

  test('cross-agency isolation: an unrelated agency\'s developer cannot view or provision another agency\'s website repository', async () => {
    const { project } = await setupProjectWithWebsite();
    const otherAgency = await createOrganization(sequelize.models, { type: 'agency' });
    const { user, password } = await createRoleAssignedMember(sequelize.models, { organizationId: otherAgency.id, roleKeys: ['developer'] });
    const login = await loginAs(app, user.email, password);

    const getRes = await auth(login)(request(app).get(`/api/v1/projects/${project.id}/website/repository`));
    expect(getRes.status).toBe(404);

    const postRes = await auth(login)(request(app).post(`/api/v1/projects/${project.id}/website/repository`));
    expect(postRes.status).toBe(404);
  });
});
