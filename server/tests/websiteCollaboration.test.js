'use strict';

const request = require('supertest');
const app = require('../app');
const {
  sequelize, Project, WebsiteComment, WebsiteEditLock, WebsitePresence,
} = require('../models');
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
    agency, clientOrg, project, developer, developerAuth,
  };
}

function auth(login) {
  return (r) => r.set('Authorization', `Bearer ${login.token}`);
}

describe('WebsiteComment', () => {
  test('a raw unscoped query throws', async () => {
    await expect(WebsiteComment.findAll()).rejects.toThrow(/must be queried through/i);
  });

  test('a client can never create an internal comment, even if they try — the flag is never trusted from client input', async () => {
    const { clientOrg, project } = await setupProjectWithWebsite();
    const { user, password } = await createRoleAssignedMember(sequelize.models, {
      organizationId: clientOrg.id, roleKeys: ['client_owner'], membershipType: 'client',
    });
    const login = await loginAs(app, user.email, password);
    const res = await auth(login)(request(app).post(`/api/v1/projects/${project.id}/website/comments`).send({
      anchorKey: 'page_home/hero1', body: 'Nice hero!', isInternal: true,
    }));
    expect(res.status).toBe(201);
    expect(res.body.data.comment.isInternal).toBe(false);
  });

  test('an internal comment from an employee is invisible to a client, but a non-internal one is visible to both', async () => {
    const { clientOrg, project, developerAuth } = await setupProjectWithWebsite();
    const internal = await developerAuth(request(app).post(`/api/v1/projects/${project.id}/website/comments`).send({
      anchorKey: 'page_home/hero1', body: 'Internal note about scope', isInternal: true,
    }));
    const visible = await developerAuth(request(app).post(`/api/v1/projects/${project.id}/website/comments`).send({
      anchorKey: 'page_home/hero1', body: 'Looks great!', isInternal: false,
    }));

    const { user, password } = await createRoleAssignedMember(sequelize.models, {
      organizationId: clientOrg.id, roleKeys: ['client_owner'], membershipType: 'client',
    });
    const login = await loginAs(app, user.email, password);
    const list = await auth(login)(request(app).get(`/api/v1/projects/${project.id}/website/comments`));
    expect(list.status).toBe(200);
    const ids = list.body.data.comments.map((c) => c.id);
    expect(ids).not.toContain(internal.body.data.comment.id);
    expect(ids).toContain(visible.body.data.comment.id);
  });

  test('resolving a comment sets resolvedAt', async () => {
    const { project, developerAuth } = await setupProjectWithWebsite();
    const created = await developerAuth(request(app).post(`/api/v1/projects/${project.id}/website/comments`).send({ anchorKey: 'page_home/hero1', body: 'x' }));
    const resolved = await developerAuth(request(app).post(`/api/v1/projects/${project.id}/website/comments/${created.body.data.comment.id}/resolve`));
    expect(resolved.status).toBe(200);
    expect(resolved.body.data.comment.resolvedAt).not.toBeNull();
  });

  test('builder.edit is required to create a comment; projects.view alone (viewer) can still list', async () => {
    const { clientOrg, project } = await setupProjectWithWebsite();
    const { user, password } = await createRoleAssignedMember(sequelize.models, {
      organizationId: clientOrg.id, roleKeys: ['viewer'], membershipType: 'client',
    });
    const login = await loginAs(app, user.email, password);
    const createRes = await auth(login)(request(app).post(`/api/v1/projects/${project.id}/website/comments`).send({ anchorKey: 'x', body: 'x' }));
    expect(createRes.status).toBe(403);
    const listRes = await auth(login)(request(app).get(`/api/v1/projects/${project.id}/website/comments`));
    expect(listRes.status).toBe(200);
  });
});

describe('WebsiteEditLock', () => {
  test('a raw unscoped query throws', async () => {
    await expect(WebsiteEditLock.findAll()).rejects.toThrow(/must be queried through/i);
  });

  test('acquiring a lock on a free section succeeds; a different user is rejected while it is still active; the same user re-acquiring renews it', async () => {
    const { agency, project, developer, developerAuth } = await setupProjectWithWebsite();
    const first = await developerAuth(request(app).post(`/api/v1/projects/${project.id}/website/locks`).send({ sectionKey: 'page_home/hero1' }));
    expect(first.status).toBe(200);
    expect(first.body.data.lock.lockedByUserId).toBe(developer.id);

    const { user: other, password } = await createRoleAssignedMember(sequelize.models, { organizationId: agency.id, roleKeys: ['designer'] });
    const otherLogin = await loginAs(app, other.email, password);
    const blocked = await auth(otherLogin)(request(app).post(`/api/v1/projects/${project.id}/website/locks`).send({ sectionKey: 'page_home/hero1' }));
    expect(blocked.status).toBe(409);

    const renewed = await developerAuth(request(app).post(`/api/v1/projects/${project.id}/website/locks`).send({ sectionKey: 'page_home/hero1' }));
    expect(renewed.status).toBe(200);
    expect(renewed.body.data.lock.id).toBe(first.body.data.lock.id);

    const activeLockCount = await WebsiteEditLock.count({ where: { websiteId: first.body.data.lock.websiteId }, __visibilityScoped: true });
    expect(activeLockCount).toBe(1);
  });

  test('only the user holding a lock can release it', async () => {
    const { agency, project, developerAuth } = await setupProjectWithWebsite();
    const created = await developerAuth(request(app).post(`/api/v1/projects/${project.id}/website/locks`).send({ sectionKey: 'page_home/hero1' }));

    const { user: other, password } = await createRoleAssignedMember(sequelize.models, { organizationId: agency.id, roleKeys: ['designer'] });
    const otherLogin = await loginAs(app, other.email, password);
    const forbidden = await auth(otherLogin)(request(app).delete(`/api/v1/projects/${project.id}/website/locks/${created.body.data.lock.id}`));
    expect(forbidden.status).toBe(403);

    const released = await developerAuth(request(app).delete(`/api/v1/projects/${project.id}/website/locks/${created.body.data.lock.id}`));
    expect(released.status).toBe(200);
  });
});

describe('WebsitePresence', () => {
  test('a raw unscoped query throws', async () => {
    await expect(WebsitePresence.findAll()).rejects.toThrow(/must be queried through/i);
  });

  test('a heartbeat is idempotent per (website, user) — repeated calls update the same row, never duplicate it', async () => {
    const { project, developer, developerAuth } = await setupProjectWithWebsite();
    await developerAuth(request(app).post(`/api/v1/projects/${project.id}/website/presence`).send({ sectionKey: 'page_home/hero1' }));
    await developerAuth(request(app).post(`/api/v1/projects/${project.id}/website/presence`).send({ sectionKey: 'page_home/text1' }));

    const list = await developerAuth(request(app).get(`/api/v1/projects/${project.id}/website/presence`));
    expect(list.status).toBe(200);
    const mine = list.body.data.presence.filter((p) => p.userId === developer.id);
    expect(mine.length).toBe(1);
    expect(mine[0].sectionKey).toBe('page_home/text1');
  });
});
