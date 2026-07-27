'use strict';

const request = require('supertest');
const app = require('../app');
const { sequelize, Project, ClientRequest } = require('../models');
const { createOrganization, createRoleAssignedMember, loginAs } = require('./helpers/factory');

afterAll(async () => {
  await sequelize.close();
});

async function setupProjectWithWebsite() {
  const agency = await createOrganization(sequelize.models, { type: 'agency' });
  const clientOrg = await createOrganization(sequelize.models, { type: 'client', managingAgencyOrganizationId: agency.id });
  const project = await Project.create({
    organizationId: clientOrg.id, agencyOrganizationId: agency.id, stage: 'Design', healthStatus: 'on_track',
  });

  const { user: developer, password: developerPassword } = await createRoleAssignedMember(sequelize.models, { organizationId: agency.id, roleKeys: ['developer'] });
  const developerLogin = await loginAs(app, developer.email, developerPassword);
  const developerAuth = (r) => r.set('Authorization', `Bearer ${developerLogin.token}`);
  await developerAuth(request(app).post(`/api/v1/projects/${project.id}/website`).send({ name: 'x', startingMode: 'blank' }));

  return {
    agency, clientOrg, project, developerAuth,
  };
}

function auth(login) {
  return (r) => r.set('Authorization', `Bearer ${login.token}`);
}

describe('Content scopes: siteSettings and organizationContent are classified, not silently unchecked', () => {
  test('changing organizationContent requires at least Professional-level access, even for a Basic-assigned client', async () => {
    const { agency, clientOrg, project } = await setupProjectWithWebsite();
    const { user, password } = await createRoleAssignedMember(sequelize.models, {
      organizationId: clientOrg.id, roleKeys: ['client_owner'], membershipType: 'client',
    });
    const login = await loginAs(app, user.email, password);
    const clientAuth = auth(login);
    const { user: admin, password: adminPassword } = await createRoleAssignedMember(sequelize.models, { organizationId: agency.id, roleKeys: ['administrator'] });
    const adminLogin = await loginAs(app, admin.email, adminPassword);
    await auth(adminLogin)(request(app).post(`/api/v1/projects/${project.id}/website/editors`).send({ userId: user.id, editingLevel: 'basic' }));

    const current = await clientAuth(request(app).get(`/api/v1/projects/${project.id}/website`));
    const withOrgContent = structuredClone(current.body.data.website.draftSchema);
    withOrgContent.organizationContent.businessPhone = '555-0100';

    const res = await clientAuth(request(app).patch(`/api/v1/projects/${project.id}/website/draft`).send({ draftSchema: withOrgContent }));
    expect(res.status).toBe(403);
  });

  test('a Professional-assigned client CAN change siteSettings (also a global content scope), and the resulting checkpoint is pending_review', async () => {
    const { agency, clientOrg, project } = await setupProjectWithWebsite();
    const { user, password } = await createRoleAssignedMember(sequelize.models, {
      organizationId: clientOrg.id, roleKeys: ['client_owner'], membershipType: 'client',
    });
    const login = await loginAs(app, user.email, password);
    const clientAuth = auth(login);
    const { user: admin, password: adminPassword } = await createRoleAssignedMember(sequelize.models, { organizationId: agency.id, roleKeys: ['administrator'] });
    const adminLogin = await loginAs(app, admin.email, adminPassword);
    await auth(adminLogin)(request(app).post(`/api/v1/projects/${project.id}/website/editors`).send({ userId: user.id, editingLevel: 'professional' }));

    const current = await clientAuth(request(app).get(`/api/v1/projects/${project.id}/website`));
    const withSiteSettings = structuredClone(current.body.data.website.draftSchema);
    withSiteSettings.siteSettings.footerLegalCopy = 'All rights reserved.';

    const res = await clientAuth(request(app).patch(`/api/v1/projects/${project.id}/website/draft`).send({ draftSchema: withSiteSettings }));
    expect(res.status).toBe(200);

    const checkpoint = await clientAuth(request(app).post(`/api/v1/projects/${project.id}/website/versions`).send({ label: 'Updated footer copy' }));
    expect(checkpoint.status).toBe(201);
    expect(checkpoint.body.data.version.status).toBe('pending_review');
  });
});

describe('Form builder: test submission wires to a real ClientRequest', () => {
  async function addFormSection(developerAuth, projectId) {
    const base = await developerAuth(request(app).get(`/api/v1/projects/${projectId}/website`));
    const withForm = structuredClone(base.body.data.website.draftSchema);
    withForm.pages[0].sections.push({
      id: 'form1',
      componentKey: 'form',
      content: {
        fields: [{
          key: 'email', label: 'Email', type: 'email', required: true,
        }],
        submitTarget: { type: 'client_request', config: {} },
      },
    });
    await developerAuth(request(app).patch(`/api/v1/projects/${projectId}/website/draft`).send({ draftSchema: withForm }));
    return withForm;
  }

  test('submitting a configured form creates a real ClientRequest with category "form"', async () => {
    const { project, developerAuth } = await setupProjectWithWebsite();
    await addFormSection(developerAuth, project.id);

    const res = await developerAuth(request(app).post(`/api/v1/projects/${project.id}/website/forms/test-submit`).send({
      pageId: 'page_home', sectionId: 'form1', values: { email: 'lead@example.test' },
    }));
    expect(res.status).toBe(201);
    expect(res.body.data.clientRequest.category).toBe('form');
    expect(res.body.data.clientRequest.description).toContain('lead@example.test');

    const stored = await ClientRequest.findOne({ where: { id: res.body.data.clientRequest.id }, __visibilityScoped: true });
    expect(stored).not.toBeNull();
    expect(stored.projectId).toBe(project.id);
  });

  test('submitting against a section that is not a form, or has no client_request submitTarget, is rejected', async () => {
    const { project, developerAuth } = await setupProjectWithWebsite();

    const notAForm = await developerAuth(request(app).post(`/api/v1/projects/${project.id}/website/forms/test-submit`).send({
      pageId: 'page_home', sectionId: 'nonexistent', values: {},
    }));
    expect(notAForm.status).toBe(404);

    const base = await developerAuth(request(app).get(`/api/v1/projects/${project.id}/website`));
    const withUnconfiguredForm = structuredClone(base.body.data.website.draftSchema);
    withUnconfiguredForm.pages[0].sections.push({ id: 'form2', componentKey: 'form', content: { fields: [] } });
    await developerAuth(request(app).patch(`/api/v1/projects/${project.id}/website/draft`).send({ draftSchema: withUnconfiguredForm }));

    const noTarget = await developerAuth(request(app).post(`/api/v1/projects/${project.id}/website/forms/test-submit`).send({
      pageId: 'page_home', sectionId: 'form2', values: {},
    }));
    expect(noTarget.status).toBe(422);
  });

  test('builder.edit is required to test-submit a form', async () => {
    const { project, clientOrg, developerAuth } = await setupProjectWithWebsite();
    await addFormSection(developerAuth, project.id);

    const { user, password } = await createRoleAssignedMember(sequelize.models, {
      organizationId: clientOrg.id, roleKeys: ['project_contact'], membershipType: 'client',
    });
    const login = await loginAs(app, user.email, password);
    const res = await auth(login)(request(app).post(`/api/v1/projects/${project.id}/website/forms/test-submit`).send({
      pageId: 'page_home', sectionId: 'form1', values: {},
    }));
    expect(res.status).toBe(403);
  });
});
