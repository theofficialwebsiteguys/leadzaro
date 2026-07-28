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

async function setupProjectWithWebsite() {
  const agency = await createOrganization(sequelize.models, { type: 'agency' });
  const clientOrg = await createOrganization(sequelize.models, { type: 'client', managingAgencyOrganizationId: agency.id });
  const project = await Project.create({
    organizationId: clientOrg.id, agencyOrganizationId: agency.id, stage: 'Design', healthStatus: 'on_track',
  });

  const { user: developer, password: developerPassword } = await createRoleAssignedMember(sequelize.models, { organizationId: agency.id, roleKeys: ['developer'] });
  const developerAuth = auth(await loginAs(app, developer.email, developerPassword));
  await developerAuth(request(app).post(`/api/v1/projects/${project.id}/website`).send({ name: 'Acme Co Site', startingMode: 'blank' }));
  const checkpoint = await developerAuth(request(app).post(`/api/v1/projects/${project.id}/website/versions`).send({ label: 'v1' }));

  const { user: pm, password: pmPassword } = await createRoleAssignedMember(sequelize.models, { organizationId: agency.id, roleKeys: ['project_manager'] });
  const pmAuth = auth(await loginAs(app, pm.email, pmPassword));

  return {
    agency, clientOrg, project, developerAuth, pmAuth, versionId: checkpoint.body.data.version.id,
  };
}

describe('POST /api/v1/projects/:projectId/website/domain/initiate-transfer', () => {
  test('builder.manage is required', async () => {
    const { project, developerAuth } = await setupProjectWithWebsite();
    const res = await developerAuth(request(app).post(`/api/v1/projects/${project.id}/website/domain/initiate-transfer`));
    expect(res.status).toBe(403);
  });

  test('404s when no domain has been registered yet', async () => {
    const { project, pmAuth } = await setupProjectWithWebsite();
    const res = await pmAuth(request(app).post(`/api/v1/projects/${project.id}/website/domain/initiate-transfer`));
    expect(res.status).toBe(404);
  });

  test('initiates a transfer via the mock Namecheap adapter, moving the domain to transferring', async () => {
    const { project, pmAuth } = await setupProjectWithWebsite();
    await pmAuth(request(app).post(`/api/v1/projects/${project.id}/website/domain/register`).send({ domain: 'transfer-me.com' }));

    const res = await pmAuth(request(app).post(`/api/v1/projects/${project.id}/website/domain/initiate-transfer`));
    expect(res.status).toBe(200);
    expect(res.body.data.domain.status).toBe('transferring');

    const getRes = await pmAuth(request(app).get(`/api/v1/projects/${project.id}/website/domain`));
    expect(getRes.body.data.domain.status).toBe('transferring');
  });

  test('cannot initiate a second transfer on a domain that is already transferring', async () => {
    const { project, pmAuth } = await setupProjectWithWebsite();
    await pmAuth(request(app).post(`/api/v1/projects/${project.id}/website/domain/register`).send({ domain: 'double-transfer.com' }));
    await pmAuth(request(app).post(`/api/v1/projects/${project.id}/website/domain/initiate-transfer`));

    const res = await pmAuth(request(app).post(`/api/v1/projects/${project.id}/website/domain/initiate-transfer`));
    expect(res.status).toBe(409);
  });

  test('cross-agency isolation', async () => {
    const { project } = await setupProjectWithWebsite();
    const otherAgency = await createOrganization(sequelize.models, { type: 'agency' });
    const { user, password } = await createRoleAssignedMember(sequelize.models, { organizationId: otherAgency.id, roleKeys: ['project_manager'] });
    const login = await loginAs(app, user.email, password);
    const res = await auth(login)(request(app).post(`/api/v1/projects/${project.id}/website/domain/initiate-transfer`));
    expect(res.status).toBe(404);
  });
});

describe('GET /api/v1/projects/:projectId/website/versions/:versionId/export', () => {
  test('builder.manage is required — builder.edit alone (a designer) is not enough', async () => {
    const { agency, project, versionId } = await setupProjectWithWebsite();
    const { user, password } = await createRoleAssignedMember(sequelize.models, { organizationId: agency.id, roleKeys: ['designer'] });
    const login = await loginAs(app, user.email, password);
    const res = await auth(login)(request(app).get(`/api/v1/projects/${project.id}/website/versions/${versionId}/export`));
    expect(res.status).toBe(403);
  });

  test('exports the full generated file bundle for a version, with a null domain when none is registered', async () => {
    const { project, pmAuth, versionId } = await setupProjectWithWebsite();
    const res = await pmAuth(request(app).get(`/api/v1/projects/${project.id}/website/versions/${versionId}/export`));
    expect(res.status).toBe(200);
    expect(res.body.data.export.website.name).toBe('Acme Co Site');
    expect(res.body.data.export.domain).toBeUndefined(); // domain lives at export.website.domain, not top-level
    expect(res.body.data.export.website.domain).toBeNull();
    expect(res.body.data.export.version.id).toBe(versionId);
    expect(Array.isArray(res.body.data.export.files)).toBe(true);
    expect(res.body.data.export.files.length).toBeGreaterThan(0);
    expect(res.body.data.export.files.some((f) => f.path === 'leadzaro.config.json')).toBe(true);
    expect(res.body.data.export.files.some((f) => f.path === 'site.schema.json')).toBe(true);
  });

  test('includes the registered domain name once one exists', async () => {
    const { project, pmAuth, versionId } = await setupProjectWithWebsite();
    await pmAuth(request(app).post(`/api/v1/projects/${project.id}/website/domain/register`).send({ domain: 'export-with-domain.com' }));

    const res = await pmAuth(request(app).get(`/api/v1/projects/${project.id}/website/versions/${versionId}/export`));
    expect(res.body.data.export.website.domain).toBe('export-with-domain.com');
  });

  test('cross-agency isolation', async () => {
    const { project, versionId } = await setupProjectWithWebsite();
    const otherAgency = await createOrganization(sequelize.models, { type: 'agency' });
    const { user, password } = await createRoleAssignedMember(sequelize.models, { organizationId: otherAgency.id, roleKeys: ['project_manager'] });
    const login = await loginAs(app, user.email, password);
    const res = await auth(login)(request(app).get(`/api/v1/projects/${project.id}/website/versions/${versionId}/export`));
    expect(res.status).toBe(404);
  });
});
