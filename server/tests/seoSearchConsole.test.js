'use strict';

const request = require('supertest');
const app = require('../app');
const { sequelize, Project, AuditLog } = require('../models');
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

describe('POST /api/v1/projects/:projectId/website/seo/search-console', () => {
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

    const res = await adminAuth(request(app).post(`/api/v1/projects/${project.id}/website/seo/search-console`).send({ propertyUrl: 'https://example.com/' }));
    expect(res.status).toBe(403);
  });

  test('sets a valid URL-prefix property, recording an audit entry', async () => {
    const { project, adminAuth } = await setupEntitledWebsite();
    const res = await adminAuth(request(app).post(`/api/v1/projects/${project.id}/website/seo/search-console`).send({ propertyUrl: 'https://acme.com/' }));
    expect(res.status).toBe(200);
    expect(res.body.data.website.googleSearchConsolePropertyUrl).toBe('https://acme.com/');

    const entries = await AuditLog.findAll({ where: { action: 'seo.search_console_connected', targetId: res.body.data.website.id } });
    expect(entries.length).toBe(1);
  });

  test('accepts a domain property (sc-domain:...)', async () => {
    const { project, adminAuth } = await setupEntitledWebsite();
    const res = await adminAuth(request(app).post(`/api/v1/projects/${project.id}/website/seo/search-console`).send({ propertyUrl: 'sc-domain:acme.com' }));
    expect(res.status).toBe(200);
    expect(res.body.data.website.googleSearchConsolePropertyUrl).toBe('sc-domain:acme.com');
  });

  test('rejects a malformed property value', async () => {
    const { project, adminAuth } = await setupEntitledWebsite();
    const res = await adminAuth(request(app).post(`/api/v1/projects/${project.id}/website/seo/search-console`).send({ propertyUrl: 'not-a-real-property' }));
    expect(res.status).toBe(422);
  });

  test('clears the connection when sent empty', async () => {
    const { project, adminAuth } = await setupEntitledWebsite();
    await adminAuth(request(app).post(`/api/v1/projects/${project.id}/website/seo/search-console`).send({ propertyUrl: 'https://acme.com/' }));
    const res = await adminAuth(request(app).post(`/api/v1/projects/${project.id}/website/seo/search-console`).send({ propertyUrl: '' }));
    expect(res.status).toBe(200);
    expect(res.body.data.website.googleSearchConsolePropertyUrl).toBeNull();
  });

  test('the connected property shows up in the SEO dashboard', async () => {
    const { project, adminAuth } = await setupEntitledWebsite();
    await adminAuth(request(app).post(`/api/v1/projects/${project.id}/website/seo/search-console`).send({ propertyUrl: 'https://acme.com/' }));
    const dashboard = await adminAuth(request(app).get(`/api/v1/projects/${project.id}/website/seo/dashboard`));
    expect(dashboard.body.data.dashboard.googleSearchConsolePropertyUrl).toBe('https://acme.com/');
  });
});
