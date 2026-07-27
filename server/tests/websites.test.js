'use strict';

const request = require('supertest');
const app = require('../app');
const {
  sequelize, Project, DesignSystem, Website, WebsiteVersion,
} = require('../models');
const { createOrganization, createRoleAssignedMember, loginAs } = require('./helpers/factory');
const {
  listDesignSystemsForRequester, getDesignSystemByIdForRequester,
} = require('../core/authorization/clientVisibleModels');

afterAll(async () => {
  await sequelize.close();
});

async function setupProject() {
  const agency = await createOrganization(sequelize.models, { type: 'agency' });
  const clientOrg = await createOrganization(sequelize.models, { type: 'client', managingAgencyOrganizationId: agency.id });
  const project = await Project.create({
    organizationId: clientOrg.id, agencyOrganizationId: agency.id, stage: 'Design', healthStatus: 'on_track',
  });
  return { agency, clientOrg, project };
}

describe('Website builder visibility guard', () => {
  test('raw unscoped queries throw', async () => {
    await expect(DesignSystem.findAll()).rejects.toThrow(/must be queried through/i);
    await expect(Website.findAll()).rejects.toThrow(/must be queried through/i);
    await expect(WebsiteVersion.findAll()).rejects.toThrow(/must be queried through/i);
  });
});

describe('Creating a website', () => {
  test('builder.edit is required; a client_owner can create a blank website, which also creates a forked DesignSystem and an initial version', async () => {
    const { clientOrg, project } = await setupProject();
    const { user, password } = await createRoleAssignedMember(sequelize.models, {
      organizationId: clientOrg.id, roleKeys: ['client_owner'], membershipType: 'client',
    });
    const login = await loginAs(app, user.email, password);
    const auth = (r) => r.set('Authorization', `Bearer ${login.token}`);

    const res = await auth(request(app).post(`/api/v1/projects/${project.id}/website`).send({ name: 'Acme Co Site', startingMode: 'blank' }));
    expect(res.status).toBe(201);
    expect(res.body.data.website.startingMode).toBe('blank');
    expect(res.body.data.website.draftSchema.pages.length).toBe(1);

    const designSystem = await DesignSystem.findOne({ where: { id: res.body.data.website.designSystemId }, __visibilityScoped: true });
    expect(designSystem.isLibraryTemplate).toBe(false);
    expect(designSystem.organizationId).toBe(clientOrg.id);

    const versions = await auth(request(app).get(`/api/v1/projects/${project.id}/website/versions`));
    expect(versions.status).toBe(200);
    expect(versions.body.data.versions.length).toBe(1);
    expect(versions.body.data.versions[0].versionNumber).toBe(1);
    expect(versions.body.data.versions[0].label).toBe('Initial version');
  });

  test('a client role without builder.edit (project_contact) cannot create a website', async () => {
    const { clientOrg, project } = await setupProject();
    const { user, password } = await createRoleAssignedMember(sequelize.models, {
      organizationId: clientOrg.id, roleKeys: ['project_contact'], membershipType: 'client',
    });
    const login = await loginAs(app, user.email, password);
    const auth = (r) => r.set('Authorization', `Bearer ${login.token}`);

    const res = await auth(request(app).post(`/api/v1/projects/${project.id}/website`).send({ name: 'x', startingMode: 'blank' }));
    expect(res.status).toBe(403);
  });

  test('an employee designer can create a website', async () => {
    const { agency, project } = await setupProject();
    const { user, password } = await createRoleAssignedMember(sequelize.models, { organizationId: agency.id, roleKeys: ['designer'] });
    const login = await loginAs(app, user.email, password);
    const auth = (r) => r.set('Authorization', `Bearer ${login.token}`);

    const res = await auth(request(app).post(`/api/v1/projects/${project.id}/website`).send({ name: 'Employee-built site', startingMode: 'blank' }));
    expect(res.status).toBe(201);
  });

  test('the template starting mode requires an explicit designSystemTemplateId (slice 8 coverage of the real assembly path lives in libraryGovernance.test.js)', async () => {
    const { agency, project } = await setupProject();
    const { user, password } = await createRoleAssignedMember(sequelize.models, { organizationId: agency.id, roleKeys: ['developer'] });
    const login = await loginAs(app, user.email, password);
    const auth = (r) => r.set('Authorization', `Bearer ${login.token}`);

    const res = await auth(request(app).post(`/api/v1/projects/${project.id}/website`).send({ name: 'x', startingMode: 'template' }));
    expect(res.status).toBe(422);
    expect(res.body.message).toMatch(/designSystemTemplateId/);
  });

  test('a project cannot have two websites', async () => {
    const { agency, project } = await setupProject();
    const { user, password } = await createRoleAssignedMember(sequelize.models, { organizationId: agency.id, roleKeys: ['developer'] });
    const login = await loginAs(app, user.email, password);
    const auth = (r) => r.set('Authorization', `Bearer ${login.token}`);

    await auth(request(app).post(`/api/v1/projects/${project.id}/website`).send({ name: 'First', startingMode: 'blank' }));
    const second = await auth(request(app).post(`/api/v1/projects/${project.id}/website`).send({ name: 'Second', startingMode: 'blank' }));
    expect(second.status).toBe(409);
  });
});

describe('Draft schema editing and checkpoints', () => {
  test('builder.edit is required to save the draft schema or create a checkpoint; projects.view alone (viewer) is not enough', async () => {
    const { agency, clientOrg, project } = await setupProject();
    const { user: developer, password: devPassword } = await createRoleAssignedMember(sequelize.models, { organizationId: agency.id, roleKeys: ['developer'] });
    const devLogin = await loginAs(app, developer.email, devPassword);
    const devAuth = (r) => r.set('Authorization', `Bearer ${devLogin.token}`);
    await devAuth(request(app).post(`/api/v1/projects/${project.id}/website`).send({ name: 'x', startingMode: 'blank' }));

    const { user: viewer, password: viewerPassword } = await createRoleAssignedMember(sequelize.models, {
      organizationId: clientOrg.id, roleKeys: ['viewer'], membershipType: 'client',
    });
    const viewerLogin = await loginAs(app, viewer.email, viewerPassword);
    const viewerAuth = (r) => r.set('Authorization', `Bearer ${viewerLogin.token}`);

    const draftRes = await viewerAuth(request(app).patch(`/api/v1/projects/${project.id}/website/draft`).send({ draftSchema: { pages: [] } }));
    expect(draftRes.status).toBe(403);

    const checkpointRes = await viewerAuth(request(app).post(`/api/v1/projects/${project.id}/website/versions`).send({ label: 'Nope' }));
    expect(checkpointRes.status).toBe(403);

    const listRes = await viewerAuth(request(app).get(`/api/v1/projects/${project.id}/website/versions`));
    expect(listRes.status).toBe(200);
  });

  test('saving the draft schema persists, and creating a named checkpoint captures the current draft with the next version number', async () => {
    const { agency, project } = await setupProject();
    const { user, password } = await createRoleAssignedMember(sequelize.models, { organizationId: agency.id, roleKeys: ['developer'] });
    const login = await loginAs(app, user.email, password);
    const auth = (r) => r.set('Authorization', `Bearer ${login.token}`);
    await auth(request(app).post(`/api/v1/projects/${project.id}/website`).send({ name: 'x', startingMode: 'blank' }));

    const newSchema = {
      pages: [{
        id: 'page_home', route: '/', title: 'Home', sections: [{ id: 'section_1', componentKey: 'hero' }],
      }],
    };
    const saved = await auth(request(app).patch(`/api/v1/projects/${project.id}/website/draft`).send({ draftSchema: newSchema }));
    expect(saved.status).toBe(200);
    expect(saved.body.data.website.draftSchema.pages[0].sections.length).toBe(1);

    const checkpoint = await auth(request(app).post(`/api/v1/projects/${project.id}/website/versions`).send({ label: 'Added hero section' }));
    expect(checkpoint.status).toBe(201);
    expect(checkpoint.body.data.version.versionNumber).toBe(2);
    expect(checkpoint.body.data.version.schema.pages[0].sections.length).toBe(1);
  });

  test('restoring an older version points the draft schema back at that version\'s snapshot AND appends a new version — history is never rewritten', async () => {
    const { agency, project } = await setupProject();
    const { user, password } = await createRoleAssignedMember(sequelize.models, { organizationId: agency.id, roleKeys: ['developer'] });
    const login = await loginAs(app, user.email, password);
    const auth = (r) => r.set('Authorization', `Bearer ${login.token}`);
    const created = await auth(request(app).post(`/api/v1/projects/${project.id}/website`).send({ name: 'x', startingMode: 'blank' }));
    const initialVersionId = (await auth(request(app).get(`/api/v1/projects/${project.id}/website/versions`))).body.data.versions[0].id;

    await auth(request(app).patch(`/api/v1/projects/${project.id}/website/draft`).send({ draftSchema: { pages: [], mutated: true } }));
    const afterMutation = await auth(request(app).get(`/api/v1/projects/${project.id}/website`));
    expect(afterMutation.body.data.website.draftSchema.mutated).toBe(true);

    const restored = await auth(request(app).post(`/api/v1/projects/${project.id}/website/versions/${initialVersionId}/restore`));
    expect(restored.status).toBe(200);
    expect(restored.body.data.website.draftSchema.mutated).toBeUndefined();
    expect(restored.body.data.website.draftSchema.pages.length).toBe(1);

    const versionsAfterRestore = await auth(request(app).get(`/api/v1/projects/${project.id}/website/versions`));
    expect(versionsAfterRestore.body.data.versions.length).toBe(2);
    const originalStillIntact = versionsAfterRestore.body.data.versions.find((v) => v.id === initialVersionId);
    expect(originalStillIntact.schema.mutated).toBeUndefined();
    const newestVersion = versionsAfterRestore.body.data.versions[0];
    expect(newestVersion.id).not.toBe(initialVersionId);
    expect(newestVersion.label).toBe('Restored to v1');
    expect(newestVersion.schema.mutated).toBeUndefined();
  });
});

describe('WebsiteVersion client-visibility split', () => {
  test('a client never sees another user\'s in-progress draft version, but does see their own submission and any published/approved version', async () => {
    const { agency, clientOrg, project } = await setupProject();
    const { user: developer, password: devPassword } = await createRoleAssignedMember(sequelize.models, { organizationId: agency.id, roleKeys: ['developer'] });
    const devLogin = await loginAs(app, developer.email, devPassword);
    const devAuth = (r) => r.set('Authorization', `Bearer ${devLogin.token}`);
    await devAuth(request(app).post(`/api/v1/projects/${project.id}/website`).send({ name: 'x', startingMode: 'blank' }));
    const employeeCheckpoint = await devAuth(request(app).post(`/api/v1/projects/${project.id}/website/versions`).send({ label: 'Employee in-progress work' }));

    const { user: clientUser, password: clientPassword } = await createRoleAssignedMember(sequelize.models, {
      organizationId: clientOrg.id, roleKeys: ['client_owner'], membershipType: 'client',
    });
    const clientLogin = await loginAs(app, clientUser.email, clientPassword);
    const clientAuth = (r) => r.set('Authorization', `Bearer ${clientLogin.token}`);

    const clientView = await clientAuth(request(app).get(`/api/v1/projects/${project.id}/website/versions`));
    expect(clientView.status).toBe(200);
    const clientVisibleIds = clientView.body.data.versions.map((v) => v.id);
    expect(clientVisibleIds).not.toContain(employeeCheckpoint.body.data.version.id);

    const directGet = await clientAuth(request(app).get(`/api/v1/projects/${project.id}/website/versions/${employeeCheckpoint.body.data.version.id}`));
    expect(directGet.status).toBe(404);

    const clientCheckpoint = await clientAuth(request(app).post(`/api/v1/projects/${project.id}/website/versions`).send({ label: 'Client-made checkpoint' }));
    expect(clientCheckpoint.status).toBe(201);
    const clientViewAfterOwnCheckpoint = await clientAuth(request(app).get(`/api/v1/projects/${project.id}/website/versions`));
    expect(clientViewAfterOwnCheckpoint.body.data.versions.map((v) => v.id)).toContain(clientCheckpoint.body.data.version.id);

    // The employee, by contrast, sees every version regardless of who made it or its status.
    const employeeView = await devAuth(request(app).get(`/api/v1/projects/${project.id}/website/versions`));
    expect(employeeView.body.data.versions.map((v) => v.id)).toEqual(expect.arrayContaining([employeeCheckpoint.body.data.version.id, clientCheckpoint.body.data.version.id]));
  });

  test('a published version is visible to a client even if they didn\'t create it', async () => {
    const { agency, clientOrg, project } = await setupProject();
    const { user: developer, password: devPassword } = await createRoleAssignedMember(sequelize.models, { organizationId: agency.id, roleKeys: ['developer'] });
    const devLogin = await loginAs(app, developer.email, devPassword);
    const devAuth = (r) => r.set('Authorization', `Bearer ${devLogin.token}`);
    const created = await devAuth(request(app).post(`/api/v1/projects/${project.id}/website`).send({ name: 'x', startingMode: 'blank' }));
    const initialVersionId = (await devAuth(request(app).get(`/api/v1/projects/${project.id}/website/versions`))).body.data.versions[0].id;

    await WebsiteVersion.update({ status: 'published' }, { where: { id: initialVersionId } });

    const { user: clientUser, password: clientPassword } = await createRoleAssignedMember(sequelize.models, {
      organizationId: clientOrg.id, roleKeys: ['client_owner'], membershipType: 'client',
    });
    const clientLogin = await loginAs(app, clientUser.email, clientPassword);
    const clientView = await request(app).get(`/api/v1/projects/${project.id}/website/versions/${initialVersionId}`).set('Authorization', `Bearer ${clientLogin.token}`);
    expect(clientView.status).toBe(200);
  });
});

describe('Cross-agency isolation for websites', () => {
  test('a project from another agency is not reachable', async () => {
    const { project } = await setupProject();
    const { agency: agencyB } = await setupProject();
    const { user, password } = await createRoleAssignedMember(sequelize.models, { organizationId: agencyB.id, roleKeys: ['developer'] });
    const login = await loginAs(app, user.email, password);
    const auth = (r) => r.set('Authorization', `Bearer ${login.token}`);

    const res = await auth(request(app).get(`/api/v1/projects/${project.id}/website`));
    expect(res.status).toBe(404);
  });
});

describe('DesignSystem visibility (unit-level, no dedicated route yet)', () => {
  test('a library template (organizationId: null) is visible to an employee at the owning agency but never to any client', async () => {
    const { agency, clientOrg } = await setupProject();
    const libraryTemplate = await DesignSystem.create({
      agencyOrganizationId: agency.id, organizationId: null, name: 'Agency Library Template', tokens: {}, isLibraryTemplate: true,
    });

    const employeeContext = { organization: { id: agency.id }, membership: { membershipType: 'employee' } };
    const employeeResults = await listDesignSystemsForRequester(employeeContext);
    expect(employeeResults.map((d) => d.id)).toContain(libraryTemplate.id);

    const clientContext = { organization: { id: clientOrg.id }, membership: { membershipType: 'client' } };
    const clientResults = await listDesignSystemsForRequester(clientContext);
    expect(clientResults.map((d) => d.id)).not.toContain(libraryTemplate.id);
    expect(await getDesignSystemByIdForRequester(clientContext, libraryTemplate.id)).toBeNull();
  });

  test('a client\'s own forked design system is visible to them and their own agency, never to a different agency', async () => {
    const { agency, clientOrg } = await setupProject();
    const { agency: agencyB } = await setupProject();
    const forked = await DesignSystem.create({
      agencyOrganizationId: agency.id, organizationId: clientOrg.id, name: 'Client Fork', tokens: {}, isLibraryTemplate: false,
    });

    const clientContext = { organization: { id: clientOrg.id }, membership: { membershipType: 'client' } };
    expect(await getDesignSystemByIdForRequester(clientContext, forked.id)).not.toBeNull();

    const employeeContext = { organization: { id: agency.id }, membership: { membershipType: 'employee' } };
    expect(await getDesignSystemByIdForRequester(employeeContext, forked.id)).not.toBeNull();

    const otherAgencyContext = { organization: { id: agencyB.id }, membership: { membershipType: 'employee' } };
    expect(await getDesignSystemByIdForRequester(otherAgencyContext, forked.id)).toBeNull();
  });
});
