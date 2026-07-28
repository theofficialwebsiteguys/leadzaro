'use strict';

const request = require('supertest');
const app = require('../app');
const {
  sequelize, Project, Website, SeoTaskCycle, Task,
} = require('../models');
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

describe('SeoTaskCycle visibility guard', () => {
  test('a raw unscoped query throws', async () => {
    await expect(SeoTaskCycle.findAll()).rejects.toThrow(/must be queried through/i);
  });
});

describe('POST /api/v1/projects/:projectId/website/seo/task-cycles', () => {
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

    const res = await adminAuth(request(app).post(`/api/v1/projects/${project.id}/website/seo/task-cycles`).send({ cyclePeriod: '2026-07' }));
    expect(res.status).toBe(403);
  });

  test('generates real, non-client-visible Task rows for the cycle', async () => {
    const { project, adminAuth } = await setupEntitledWebsite();
    const res = await adminAuth(request(app).post(`/api/v1/projects/${project.id}/website/seo/task-cycles`).send({ cyclePeriod: '2026-07' }));
    expect(res.status).toBe(200);
    expect(res.body.data.cycle.cyclePeriod).toBe('2026-07');
    expect(res.body.data.tasks.length).toBe(3);

    const taskRows = await Task.findAll({ where: { projectId: project.id }, __visibilityScoped: true });
    expect(taskRows.length).toBe(3);
    expect(taskRows.every((t) => t.isClientVisible === false)).toBe(true);
    expect(taskRows.every((t) => t.title.includes('[SEO 2026-07]'))).toBe(true);
  });

  test(
    'the DB-level unique constraint rejects a duplicate cycle for the same period — a real constraint, not just an app-level check',
    async () => {
      const { project, adminAuth } = await setupEntitledWebsite();
      const first = await adminAuth(request(app).post(`/api/v1/projects/${project.id}/website/seo/task-cycles`).send({ cyclePeriod: '2026-08' }));
      expect(first.status).toBe(200);

      const second = await adminAuth(request(app).post(`/api/v1/projects/${project.id}/website/seo/task-cycles`).send({ cyclePeriod: '2026-08' }));
      expect(second.status).toBe(409);

      // No duplicate tasks or cycle rows were created by the rejected
      // second attempt.
      const taskRows = await Task.findAll({ where: { projectId: project.id }, __visibilityScoped: true });
      expect(taskRows.length).toBe(3);
      const website = await Website.findOne({ where: { projectId: project.id }, __visibilityScoped: true });
      const cycleCount = await SeoTaskCycle.count({ where: { websiteId: website.id, cyclePeriod: '2026-08' }, __visibilityScoped: true });
      expect(cycleCount).toBe(1);
    }
  );

  test('a different cyclePeriod for the same website is allowed', async () => {
    const { project, adminAuth } = await setupEntitledWebsite();
    await adminAuth(request(app).post(`/api/v1/projects/${project.id}/website/seo/task-cycles`).send({ cyclePeriod: '2026-09' }));
    const second = await adminAuth(request(app).post(`/api/v1/projects/${project.id}/website/seo/task-cycles`).send({ cyclePeriod: '2026-10' }));
    expect(second.status).toBe(200);

    const list = await adminAuth(request(app).get(`/api/v1/projects/${project.id}/website/seo/task-cycles`));
    expect(list.body.data.cycles.length).toBe(2);
  });

  test('rejects a malformed cyclePeriod', async () => {
    const { project, adminAuth } = await setupEntitledWebsite();
    const res = await adminAuth(request(app).post(`/api/v1/projects/${project.id}/website/seo/task-cycles`).send({ cyclePeriod: 'not-a-period' }));
    expect(res.status).toBe(422);
  });

  test('defaults to the current YYYY-MM period when none is supplied', async () => {
    const { project, adminAuth } = await setupEntitledWebsite();
    const res = await adminAuth(request(app).post(`/api/v1/projects/${project.id}/website/seo/task-cycles`).send({}));
    expect(res.status).toBe(200);
    expect(res.body.data.cycle.cyclePeriod).toMatch(/^\d{4}-\d{2}$/);
  });
});

describe('cross-agency isolation', () => {
  test('an unrelated agency cannot list another agency\'s task cycles', async () => {
    const { project } = await setupEntitledWebsite();
    const otherAgency = await createOrganization(sequelize.models, { type: 'agency' });
    const { user, password } = await createRoleAssignedMember(sequelize.models, { organizationId: otherAgency.id, roleKeys: ['administrator'] });
    const login = await loginAs(app, user.email, password);
    const res = await auth(login)(request(app).get(`/api/v1/projects/${project.id}/website/seo/task-cycles`));
    expect(res.status).toBe(404);
  });
});
