'use strict';

const request = require('supertest');
const app = require('../app');
const {
  sequelize, Project, WebsiteDevelopmentHandoff, WebsiteDeployment, Notification,
} = require('../models');
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
    agency, clientOrg, project, developer, developerAuth, versionId: checkpoint.body.data.version.id,
  };
}

describe('WebsiteDevelopmentHandoff visibility guard', () => {
  test('a raw unscoped query throws', async () => {
    await expect(WebsiteDevelopmentHandoff.findAll()).rejects.toThrow(/must be queried through/i);
  });
});

describe('POST /api/v1/projects/:projectId/website/versions/:versionId/promote-to-development', () => {
  test('builder.develop is required — builder.edit alone (a designer) is not enough', async () => {
    const { agency, project, versionId } = await setupProjectWithWebsiteAndRepository();
    const { user, password } = await createRoleAssignedMember(sequelize.models, { organizationId: agency.id, roleKeys: ['designer'] });
    const login = await loginAs(app, user.email, password);
    const res = await auth(login)(request(app).post(`/api/v1/projects/${project.id}/website/versions/${versionId}/promote-to-development`));
    expect(res.status).toBe(403);
  });

  test(
    'runs the full checklist: creates a preview_ready handoff, a linked live preview deployment, a non-client-visible task, and notifies the project\'s assigned developer',
    async () => {
      const {
        agency, project, developer, developerAuth, versionId,
      } = await setupProjectWithWebsiteAndRepository();

      // Assign the developer to the project (ProjectAssignment role slot) so
      // "notify assigned roles" has someone real to notify.
      const { user: admin, password: adminPassword } = await createRoleAssignedMember(sequelize.models, { organizationId: agency.id, roleKeys: ['administrator'] });
      const adminAuth = auth(await loginAs(app, admin.email, adminPassword));
      await adminAuth(request(app).post(`/api/v1/projects/${project.id}/assignments`).send({ userId: developer.id, roleSlot: 'developer' }));

      const res = await developerAuth(request(app).post(`/api/v1/projects/${project.id}/website/versions/${versionId}/promote-to-development`).send({
        technicalHandoffNotes: 'Please implement the booking widget.',
      }));
      expect(res.status).toBe(201);
      expect(res.body.data.handoff.status).toBe('preview_ready');
      expect(res.body.data.handoff.branchName).toMatch(/^development\/v\d+$/);
      expect(res.body.data.deployment.status).toBe('live');
      expect(res.body.data.deployment.environment).toBe('preview');
      expect(res.body.data.deployment.branchName).toBe(res.body.data.handoff.branchName);
      expect(res.body.data.task.title).toContain('Technical handoff');
      expect(res.body.data.notifiedUserIds).toContain(developer.id);

      // The deployment row really is linked to this handoff, not just
      // reported as linked in the response.
      const deploymentRow = await WebsiteDeployment.findOne({ where: { id: res.body.data.deployment.id }, __visibilityScoped: true });
      expect(deploymentRow.developmentHandoffId).toBe(res.body.data.handoff.id);

      // The task is real and not client-visible.
      const tasksList = await developerAuth(request(app).get(`/api/v1/projects/${project.id}/tasks`));
      const createdTask = tasksList.body.data.tasks.find((t) => t.id === res.body.data.task.id);
      expect(createdTask).toBeTruthy();
      expect(createdTask.isClientVisible).toBe(false);

      // A real Notification row was created for the assigned developer.
      const notifications = await Notification.findAll({ where: { userId: developer.id, type: 'website_development_handoff' } });
      expect(notifications.length).toBe(1);

      const list = await developerAuth(request(app).get(`/api/v1/projects/${project.id}/website/development-handoffs`));
      expect(list.status).toBe(200);
      expect(list.body.data.handoffs.length).toBe(1);
    }
  );

  test('cross-agency isolation: an unrelated agency\'s developer cannot promote or list another agency\'s website handoffs', async () => {
    const { project, versionId } = await setupProjectWithWebsiteAndRepository();
    const otherAgency = await createOrganization(sequelize.models, { type: 'agency' });
    const { user, password } = await createRoleAssignedMember(sequelize.models, { organizationId: otherAgency.id, roleKeys: ['developer'] });
    const login = await loginAs(app, user.email, password);

    const promoteRes = await auth(login)(request(app).post(`/api/v1/projects/${project.id}/website/versions/${versionId}/promote-to-development`));
    expect(promoteRes.status).toBe(404);
    const listRes = await auth(login)(request(app).get(`/api/v1/projects/${project.id}/website/development-handoffs`));
    expect(listRes.status).toBe(404);
  });
});
