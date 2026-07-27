'use strict';

const request = require('supertest');
const app = require('../app');
const { sequelize, Project, WebsiteEditorAssignment } = require('../models');
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
  await request(app).post(`/api/v1/projects/${project.id}/website`).set('Authorization', `Bearer ${developerLogin.token}`).send({ name: 'x', startingMode: 'blank' });

  const { user: admin, password: adminPassword } = await createRoleAssignedMember(sequelize.models, { organizationId: agency.id, roleKeys: ['administrator'] });
  const adminLogin = await loginAs(app, admin.email, adminPassword);
  const adminAuth = (r) => r.set('Authorization', `Bearer ${adminLogin.token}`);

  return {
    agency, clientOrg, project, adminAuth,
  };
}

function auth(login) {
  return (r) => r.set('Authorization', `Bearer ${login.token}`);
}

describe('WebsiteEditorAssignment visibility guard', () => {
  test('a raw unscoped query throws', async () => {
    await expect(WebsiteEditorAssignment.findAll()).rejects.toThrow(/must be queried through/i);
  });
});

describe('Managing website editor assignments', () => {
  test('builder.manage is required; a designer (builder.edit only) cannot assign editors', async () => {
    const { agency, clientOrg, project } = await setupProjectWithWebsite();
    const { user: designer, password } = await createRoleAssignedMember(sequelize.models, { organizationId: agency.id, roleKeys: ['designer'] });
    const login = await loginAs(app, designer.email, password);
    const { user: target } = await createRoleAssignedMember(sequelize.models, {
      organizationId: clientOrg.id, roleKeys: ['client_owner'], membershipType: 'client',
    });

    const res = await auth(login)(request(app).post(`/api/v1/projects/${project.id}/website/editors`).send({ userId: target.id, editingLevel: 'basic' }));
    expect(res.status).toBe(403);
  });

  test('an administrator can assign, list, and remove a client\'s editing level', async () => {
    const { clientOrg, project, adminAuth } = await setupProjectWithWebsite();
    const { user: target } = await createRoleAssignedMember(sequelize.models, {
      organizationId: clientOrg.id, roleKeys: ['client_owner'], membershipType: 'client',
    });

    const created = await adminAuth(request(app).post(`/api/v1/projects/${project.id}/website/editors`).send({ userId: target.id, editingLevel: 'basic' }));
    expect(created.status).toBe(200);
    expect(created.body.data.assignment.editingLevel).toBe('basic');

    const list = await adminAuth(request(app).get(`/api/v1/projects/${project.id}/website/editors`));
    expect(list.status).toBe(200);
    expect(list.body.data.assignments.map((a) => a.userId)).toContain(target.id);

    const removed = await adminAuth(request(app).delete(`/api/v1/projects/${project.id}/website/editors/${created.body.data.assignment.id}`));
    expect(removed.status).toBe(200);

    const listAfter = await adminAuth(request(app).get(`/api/v1/projects/${project.id}/website/editors`));
    expect(listAfter.body.data.assignments.map((a) => a.id)).not.toContain(created.body.data.assignment.id);
  });

  test('assigning the same user twice updates the existing row rather than creating a duplicate', async () => {
    const { clientOrg, project, adminAuth } = await setupProjectWithWebsite();
    const { user: target } = await createRoleAssignedMember(sequelize.models, {
      organizationId: clientOrg.id, roleKeys: ['client_owner'], membershipType: 'client',
    });

    const first = await adminAuth(request(app).post(`/api/v1/projects/${project.id}/website/editors`).send({ userId: target.id, editingLevel: 'basic' }));
    const second = await adminAuth(request(app).post(`/api/v1/projects/${project.id}/website/editors`).send({ userId: target.id, editingLevel: 'professional' }));
    expect(second.body.data.assignment.id).toBe(first.body.data.assignment.id);
    expect(second.body.data.assignment.editingLevel).toBe('professional');

    const list = await adminAuth(request(app).get(`/api/v1/projects/${project.id}/website/editors`));
    expect(list.body.data.assignments.filter((a) => a.userId === target.id).length).toBe(1);
  });

  test('advanced editing access can never be granted to a client-membership user', async () => {
    const { clientOrg, project, adminAuth } = await setupProjectWithWebsite();
    const { user: target } = await createRoleAssignedMember(sequelize.models, {
      organizationId: clientOrg.id, roleKeys: ['client_owner'], membershipType: 'client',
    });

    const res = await adminAuth(request(app).post(`/api/v1/projects/${project.id}/website/editors`).send({ userId: target.id, editingLevel: 'advanced' }));
    expect(res.status).toBe(422);
  });

  test('a user with no membership at this website\'s client organization or agency cannot be assigned', async () => {
    const { project, adminAuth } = await setupProjectWithWebsite();
    const { agency: unrelatedAgency } = await setupProjectWithWebsite();
    const { user: outsider } = await createRoleAssignedMember(sequelize.models, { organizationId: unrelatedAgency.id, roleKeys: ['developer'] });

    const res = await adminAuth(request(app).post(`/api/v1/projects/${project.id}/website/editors`).send({ userId: outsider.id, editingLevel: 'basic' }));
    expect(res.status).toBe(422);
  });

  test('an employee within the owning agency can be assigned (e.g. restricting a support role below their role default)', async () => {
    const { agency, project, adminAuth } = await setupProjectWithWebsite();
    const { user: support } = await createRoleAssignedMember(sequelize.models, { organizationId: agency.id, roleKeys: ['support'] });

    const res = await adminAuth(request(app).post(`/api/v1/projects/${project.id}/website/editors`).send({ userId: support.id, editingLevel: 'basic' }));
    expect(res.status).toBe(200);
  });
});

describe('Cross-agency isolation for website editor assignments', () => {
  test('an employee at a different agency cannot manage another agency\'s website assignments', async () => {
    const { clientOrg, project } = await setupProjectWithWebsite();
    const { agency: agencyB } = await setupProjectWithWebsite();
    const { user, password } = await createRoleAssignedMember(sequelize.models, { organizationId: agencyB.id, roleKeys: ['administrator'] });
    const login = await loginAs(app, user.email, password);
    const { user: target } = await createRoleAssignedMember(sequelize.models, {
      organizationId: clientOrg.id, roleKeys: ['client_owner'], membershipType: 'client',
    });

    const res = await auth(login)(request(app).post(`/api/v1/projects/${project.id}/website/editors`).send({ userId: target.id, editingLevel: 'basic' }));
    expect(res.status).toBe(404);
  });
});
