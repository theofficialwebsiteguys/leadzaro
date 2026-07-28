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

async function loginAsRole(organizationId, roleKeys, membershipType) {
  const { user, password } = await createRoleAssignedMember(sequelize.models, { organizationId, roleKeys, membershipType });
  return loginAs(app, user.email, password);
}

async function setupAgencyWithProject() {
  const agency = await createOrganization(sequelize.models, { type: 'agency' });
  const clientOrg = await createOrganization(sequelize.models, { type: 'client', managingAgencyOrganizationId: agency.id });
  const project = await Project.create({
    organizationId: clientOrg.id, agencyOrganizationId: agency.id, stage: 'Design', healthStatus: 'on_track',
  });
  return { agency, clientOrg, project };
}

describe('Component publication permission/review split (Phase 6 slice 8 correction of Phase 5\'s single-gate design)', () => {
  test('builder.manage ALONE (a project_manager) can no longer create a custom section — registering a component\'s schema is now a builder.develop action', async () => {
    const { agency } = await setupAgencyWithProject();
    const login = await loginAsRole(agency.id, ['project_manager']);
    const res = await auth(login)(request(app).post('/api/v1/section-definitions').send({
      name: 'Testimonial', componentKey: 'testimonial_split_1', category: 'content',
    }));
    expect(res.status).toBe(403);
  });

  test('builder.develop ALONE (a developer) can create a custom section, but still cannot publish or deprecate it — that stays a builder.manage review gate', async () => {
    const { agency } = await setupAgencyWithProject();
    const login = await loginAsRole(agency.id, ['developer']);
    const created = await auth(login)(request(app).post('/api/v1/section-definitions').send({
      name: 'Testimonial', componentKey: 'testimonial_split_2', category: 'content',
    }));
    expect(created.status).toBe(201);
    expect(created.body.data.sectionDefinition.status).toBe('draft');

    const publishAttempt = await auth(login)(request(app).post(`/api/v1/section-definitions/${created.body.data.sectionDefinition.id}/publish`));
    expect(publishAttempt.status).toBe(403);
  });

  test('the developer\'s own drafted-but-unpublished component is visible in the governance list to a builder.manage reviewer, who can then publish it', async () => {
    const { agency } = await setupAgencyWithProject();
    const developerLogin = await loginAsRole(agency.id, ['developer']);
    const created = await auth(developerLogin)(request(app).post('/api/v1/section-definitions').send({
      name: 'Testimonial', componentKey: 'testimonial_split_3', category: 'content',
    }));

    const managerLogin = await loginAsRole(agency.id, ['project_manager']);
    const manageList = await auth(managerLogin)(request(app).get('/api/v1/section-definitions/manage'));
    expect(manageList.status).toBe(200);
    expect(manageList.body.data.sectionDefinitions.map((s) => s.id)).toContain(created.body.data.sectionDefinition.id);

    const published = await auth(managerLogin)(request(app).post(`/api/v1/section-definitions/${created.body.data.sectionDefinition.id}/publish`));
    expect(published.status).toBe(200);
    expect(published.body.data.sectionDefinition.status).toBe('published');
  });

  test('the developer can also see their own draft component in the governance list (builder.develop alone is enough to view it)', async () => {
    const { agency } = await setupAgencyWithProject();
    const login = await loginAsRole(agency.id, ['developer']);
    await auth(login)(request(app).post('/api/v1/section-definitions').send({
      name: 'Testimonial', componentKey: 'testimonial_split_4', category: 'content',
    }));
    const manageList = await auth(login)(request(app).get('/api/v1/section-definitions/manage'));
    expect(manageList.status).toBe(200);
  });
});

describe('POST /api/v1/projects/:projectId/website/merge-back', () => {
  async function setupProjectWithWebsiteAndRepository() {
    const { agency, clientOrg, project } = await setupAgencyWithProject();
    const developerLogin = await loginAsRole(agency.id, ['developer']);
    const developerAuth = auth(developerLogin);
    await developerAuth(request(app).post(`/api/v1/projects/${project.id}/website`).send({ name: 'x', startingMode: 'blank' }));
    await developerAuth(request(app).post(`/api/v1/projects/${project.id}/website/repository`));
    return {
      agency, clientOrg, project, developerAuth,
    };
  }

  test('builder.develop is required — builder.edit alone (a designer) is not enough', async () => {
    const { agency, project } = await setupProjectWithWebsiteAndRepository();
    const login = await loginAsRole(agency.id, ['designer']);
    const res = await auth(login)(request(app).post(`/api/v1/projects/${project.id}/website/merge-back`).send({ branchName: 'custom/booking-widget' }));
    expect(res.status).toBe(403);
  });

  test('branchName is required', async () => {
    const { project, developerAuth } = await setupProjectWithWebsiteAndRepository();
    const res = await developerAuth(request(app).post(`/api/v1/projects/${project.id}/website/merge-back`).send({}));
    expect(res.status).toBe(422);
  });

  test('rejects merge-back when no repository has been provisioned yet', async () => {
    const { agency, clientOrg, project } = await setupAgencyWithProject();
    const developerLogin = await loginAsRole(agency.id, ['developer']);
    const developerAuth = auth(developerLogin);
    await developerAuth(request(app).post(`/api/v1/projects/${project.id}/website`).send({ name: 'x', startingMode: 'blank' }));
    // No repository provisioned this time.
    const res = await developerAuth(request(app).post(`/api/v1/projects/${project.id}/website/merge-back`).send({ branchName: 'custom/booking-widget' }));
    expect(res.status).toBe(422);
    expect(res.body.message).toMatch(/repository/i);
  });

  test('creates a real pull request and merges it back to the repository\'s default branch', async () => {
    const { project, developerAuth } = await setupProjectWithWebsiteAndRepository();

    // A real branch has to exist on the repo before a PR can be opened
    // against it — use the branch a real promote-to-development action
    // would have already created, exactly the workflow merge-back is
    // meant to close the loop on.
    const checkpoint = await developerAuth(request(app).post(`/api/v1/projects/${project.id}/website/versions`).send({ label: 'v1' }));
    const promoted = await developerAuth(request(app).post(`/api/v1/projects/${project.id}/website/versions/${checkpoint.body.data.version.id}/promote-to-development`));
    const branchName = promoted.body.data.handoff.branchName;

    const res = await developerAuth(request(app).post(`/api/v1/projects/${project.id}/website/merge-back`).send({
      branchName, title: 'Add booking widget',
    }));
    expect(res.status).toBe(200);
    expect(res.body.data.pullRequest.status).toBe('merged');
    expect(res.body.data.branchName).toBe(branchName);
    expect(res.body.data.baseBranch).toBe('main');
  });

  test('cross-agency isolation: an unrelated agency\'s developer cannot merge back another agency\'s website', async () => {
    const { project } = await setupProjectWithWebsiteAndRepository();
    const otherAgency = await createOrganization(sequelize.models, { type: 'agency' });
    const login = await loginAsRole(otherAgency.id, ['developer']);
    const res = await auth(login)(request(app).post(`/api/v1/projects/${project.id}/website/merge-back`).send({ branchName: 'x' }));
    expect(res.status).toBe(404);
  });
});
