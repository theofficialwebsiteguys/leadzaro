'use strict';

const request = require('supertest');
const app = require('../app');
const { sequelize, Project, WebsiteRedirect } = require('../models');
const { createOrganization, createRoleAssignedMember, loginAs } = require('./helpers/factory');

afterAll(async () => {
  await sequelize.close();
});

function auth(login) {
  return (r) => r.set('Authorization', `Bearer ${login.token}`);
}

async function setupEntitledWebsite() {
  const agency = await createOrganization(sequelize.models, { type: 'agency' });
  const clientOrg = await createOrganization(sequelize.models, { type: 'client', managingAgencyOrganizationId: agency.id });
  const project = await Project.create({
    organizationId: clientOrg.id, agencyOrganizationId: agency.id, stage: 'Design', healthStatus: 'on_track',
  });

  const { user: developer, password: developerPassword } = await createRoleAssignedMember(sequelize.models, { organizationId: agency.id, roleKeys: ['developer'] });
  const developerAuth = auth(await loginAs(app, developer.email, developerPassword));
  await developerAuth(request(app).post(`/api/v1/projects/${project.id}/website`).send({ name: 'Acme Co Site', startingMode: 'blank' }));

  const { user: admin, password: adminPassword } = await createRoleAssignedMember(sequelize.models, { organizationId: agency.id, roleKeys: ['administrator'] });
  const adminAuth = auth(await loginAs(app, admin.email, adminPassword));
  await adminAuth(request(app).post(`/api/v1/seo/organizations/${clientOrg.id}/entitlement-grants`).send({ reason: 'test' }));

  return {
    agency, clientOrg, project, adminAuth,
  };
}

describe('WebsiteRedirect visibility guard', () => {
  test('a raw unscoped query throws', async () => {
    await expect(WebsiteRedirect.findAll()).rejects.toThrow(/must be queried through/i);
  });
});

describe('POST /api/v1/projects/:projectId/website/seo/redirects', () => {
  test('requires an active SEO entitlement', async () => {
    const agency = await createOrganization(sequelize.models, { type: 'agency' });
    const clientOrg = await createOrganization(sequelize.models, { type: 'client', managingAgencyOrganizationId: agency.id });
    const project = await Project.create({
      organizationId: clientOrg.id, agencyOrganizationId: agency.id, stage: 'Design', healthStatus: 'on_track',
    });
    const { user: developer, password: developerPassword } = await createRoleAssignedMember(sequelize.models, { organizationId: agency.id, roleKeys: ['developer'] });
    const developerAuth = auth(await loginAs(app, developer.email, developerPassword));
    await developerAuth(request(app).post(`/api/v1/projects/${project.id}/website`).send({ name: 'x', startingMode: 'blank' }));
    const { user: admin, password: adminPassword } = await createRoleAssignedMember(sequelize.models, { organizationId: agency.id, roleKeys: ['administrator'] });
    const adminAuth = auth(await loginAs(app, admin.email, adminPassword));

    const res = await adminAuth(request(app).post(`/api/v1/projects/${project.id}/website/seo/redirects`).send({ fromPath: '/old', toPath: '/new' }));
    expect(res.status).toBe(403);
  });

  test('builder.manage is required — builder.edit alone (a designer) is not enough', async () => {
    const { project, agency } = await setupEntitledWebsite();
    const { user, password } = await createRoleAssignedMember(sequelize.models, { organizationId: agency.id, roleKeys: ['designer'] });
    const login = await loginAs(app, user.email, password);
    const res = await auth(login)(request(app).post(`/api/v1/projects/${project.id}/website/seo/redirects`).send({ fromPath: '/old', toPath: '/new' }));
    expect(res.status).toBe(403);
  });

  test('creates a redirect, normalizing paths to a leading slash', async () => {
    const { project, adminAuth } = await setupEntitledWebsite();
    const res = await adminAuth(request(app).post(`/api/v1/projects/${project.id}/website/seo/redirects`).send({ fromPath: 'old-page', toPath: 'new-page' }));
    expect(res.status).toBe(200);
    expect(res.body.data.redirect.fromPath).toBe('/old-page');
    expect(res.body.data.redirect.toPath).toBe('/new-page');
    expect(res.body.data.redirect.statusCode).toBe(301);
  });

  test('rejects a duplicate fromPath for the same website', async () => {
    const { project, adminAuth } = await setupEntitledWebsite();
    await adminAuth(request(app).post(`/api/v1/projects/${project.id}/website/seo/redirects`).send({ fromPath: '/old', toPath: '/new' }));
    const res = await adminAuth(request(app).post(`/api/v1/projects/${project.id}/website/seo/redirects`).send({ fromPath: '/old', toPath: '/other' }));
    expect(res.status).toBe(409);
  });

  test('rejects fromPath === toPath', async () => {
    const { project, adminAuth } = await setupEntitledWebsite();
    const res = await adminAuth(request(app).post(`/api/v1/projects/${project.id}/website/seo/redirects`).send({ fromPath: '/same', toPath: '/same' }));
    expect(res.status).toBe(422);
  });

  test('rejects an unsupported statusCode', async () => {
    const { project, adminAuth } = await setupEntitledWebsite();
    const res = await adminAuth(request(app).post(`/api/v1/projects/${project.id}/website/seo/redirects`).send({ fromPath: '/a', toPath: '/b', statusCode: 418 }));
    expect(res.status).toBe(422);
  });
});

describe('GET/DELETE /api/v1/projects/:projectId/website/seo/redirects', () => {
  test('lists and deletes a redirect', async () => {
    const { project, adminAuth } = await setupEntitledWebsite();
    const createRes = await adminAuth(request(app).post(`/api/v1/projects/${project.id}/website/seo/redirects`).send({ fromPath: '/old', toPath: '/new' }));

    const listRes = await adminAuth(request(app).get(`/api/v1/projects/${project.id}/website/seo/redirects`));
    expect(listRes.body.data.redirects.length).toBe(1);

    const deleteRes = await adminAuth(request(app).delete(`/api/v1/projects/${project.id}/website/seo/redirects/${createRes.body.data.redirect.id}`));
    expect(deleteRes.status).toBe(200);

    const listAfter = await adminAuth(request(app).get(`/api/v1/projects/${project.id}/website/seo/redirects`));
    expect(listAfter.body.data.redirects.length).toBe(0);
  });

  test('cross-agency isolation', async () => {
    const { project } = await setupEntitledWebsite();
    const otherAgency = await createOrganization(sequelize.models, { type: 'agency' });
    const { user, password } = await createRoleAssignedMember(sequelize.models, { organizationId: otherAgency.id, roleKeys: ['administrator'] });
    const login = await loginAs(app, user.email, password);
    const res = await auth(login)(request(app).get(`/api/v1/projects/${project.id}/website/seo/redirects`));
    expect(res.status).toBe(404);
  });
});
