'use strict';

const request = require('supertest');
const app = require('../app');
const {
  sequelize, Project, ClientRequest, ContentInboxItem, Task, Notification,
} = require('../models');
const { createOrganization, createRoleAssignedMember, loginAs } = require('./helpers/factory');

afterAll(async () => {
  await sequelize.close();
});

async function setupProject() {
  const agency = await createOrganization(sequelize.models, { type: 'agency' });
  const clientOrg = await createOrganization(sequelize.models, { type: 'client', managingAgencyOrganizationId: agency.id });
  const project = await Project.create({
    organizationId: clientOrg.id, agencyOrganizationId: agency.id, stage: 'Ongoing Support', healthStatus: 'on_track',
  });
  return { agency, clientOrg, project };
}

async function setupProjectWithOwner() {
  const agency = await createOrganization(sequelize.models, { type: 'agency' });
  const clientOrg = await createOrganization(sequelize.models, { type: 'client', managingAgencyOrganizationId: agency.id });
  const { user: owner, password: ownerPassword } = await createRoleAssignedMember(sequelize.models, { organizationId: agency.id, roleKeys: ['project_manager'] });
  const project = await Project.create({
    organizationId: clientOrg.id, agencyOrganizationId: agency.id, stage: 'Ongoing Support', healthStatus: 'on_track', ownerUserId: owner.id,
  });
  return {
    agency, clientOrg, project, owner, ownerPassword,
  };
}

describe('ClientRequest/ContentInboxItem visibility guard', () => {
  test('raw unscoped queries throw', async () => {
    await expect(ClientRequest.findAll()).rejects.toThrow(/must be queried through/i);
    await expect(ContentInboxItem.findAll()).rejects.toThrow(/must be queried through/i);
  });
});

describe('Client requests: submission and the unified support queue', () => {
  test('a client can submit a request and see it in their own project\'s list', async () => {
    const { clientOrg, project } = await setupProject();
    const { user, password } = await createRoleAssignedMember(sequelize.models, {
      organizationId: clientOrg.id, roleKeys: ['client_owner'], membershipType: 'client',
    });
    const login = await loginAs(app, user.email, password);
    const auth = (r) => r.set('Authorization', `Bearer ${login.token}`);

    const create = await auth(request(app).post(`/api/v1/projects/${project.id}/requests`).send({ category: 'bug', description: 'The contact form is broken on mobile' }));
    expect(create.status).toBe(201);
    expect(create.body.data.request.status).toBe('queued');

    const list = await auth(request(app).get(`/api/v1/projects/${project.id}/requests`));
    expect(list.status).toBe(200);
    expect(list.body.data.requests.map((r) => r.id)).toContain(create.body.data.request.id);
  });

  test('an unknown category is rejected', async () => {
    const { clientOrg, project } = await setupProject();
    const { user, password } = await createRoleAssignedMember(sequelize.models, {
      organizationId: clientOrg.id, roleKeys: ['client_owner'], membershipType: 'client',
    });
    const login = await loginAs(app, user.email, password);
    const auth = (r) => r.set('Authorization', `Bearer ${login.token}`);

    const res = await auth(request(app).post(`/api/v1/projects/${project.id}/requests`).send({ category: 'not_a_real_category', description: 'x' }));
    expect(res.status).toBe(422);
  });

  test('the unified support queue lists requests across every project at the caller\'s own agency', async () => {
    const { agency, clientOrg: clientA, project: projectA } = await setupProject();
    const clientB = await createOrganization(sequelize.models, { type: 'client', managingAgencyOrganizationId: agency.id });
    const projectB = await Project.create({ organizationId: clientB.id, agencyOrganizationId: agency.id, stage: 'Design', healthStatus: 'on_track' });

    const { user: clientUserA, password: passwordA } = await createRoleAssignedMember(sequelize.models, { organizationId: clientA.id, roleKeys: ['client_owner'], membershipType: 'client' });
    const loginA = await loginAs(app, clientUserA.email, passwordA);
    await request(app).post(`/api/v1/projects/${projectA.id}/requests`).set('Authorization', `Bearer ${loginA.token}`).send({ category: 'content', description: 'Need new homepage copy' });

    const { user: clientUserB, password: passwordB } = await createRoleAssignedMember(sequelize.models, { organizationId: clientB.id, roleKeys: ['client_owner'], membershipType: 'client' });
    const loginB = await loginAs(app, clientUserB.email, passwordB);
    await request(app).post(`/api/v1/projects/${projectB.id}/requests`).set('Authorization', `Bearer ${loginB.token}`).send({ category: 'design', description: 'Logo tweak' });

    const { user: pm, password: pmPassword } = await createRoleAssignedMember(sequelize.models, { organizationId: agency.id, roleKeys: ['project_manager'] });
    const pmLogin = await loginAs(app, pm.email, pmPassword);
    const queue = await request(app).get('/api/v1/requests/queue').set('Authorization', `Bearer ${pmLogin.token}`);
    expect(queue.status).toBe(200);
    expect(queue.body.data.requests.length).toBe(2);
  });

  test('requests.manage is required to update status or convert to task; a client cannot do either', async () => {
    const { clientOrg, project } = await setupProject();
    const { user, password } = await createRoleAssignedMember(sequelize.models, {
      organizationId: clientOrg.id, roleKeys: ['client_owner'], membershipType: 'client',
    });
    const login = await loginAs(app, user.email, password);
    const auth = (r) => r.set('Authorization', `Bearer ${login.token}`);
    const create = await auth(request(app).post(`/api/v1/projects/${project.id}/requests`).send({ category: 'hours', description: 'Add 5 more support hours' }));

    const statusRes = await auth(request(app).patch(`/api/v1/projects/${project.id}/requests/${create.body.data.request.id}/status`).send({ status: 'in_progress' }));
    expect(statusRes.status).toBe(403);
    const convertRes = await auth(request(app).post(`/api/v1/projects/${project.id}/requests/${create.body.data.request.id}/convert-to-task`).send({}));
    expect(convertRes.status).toBe(403);
  });

  test('converting a request to a task links it back and is idempotent against double-conversion', async () => {
    const { agency, clientOrg, project } = await setupProject();
    const { user: clientUser, password: clientPassword } = await createRoleAssignedMember(sequelize.models, { organizationId: clientOrg.id, roleKeys: ['client_owner'], membershipType: 'client' });
    const clientLogin = await loginAs(app, clientUser.email, clientPassword);
    const create = await request(app).post(`/api/v1/projects/${project.id}/requests`).set('Authorization', `Bearer ${clientLogin.token}`).send({ category: 'page_section', description: 'Add a testimonials section to the homepage' });

    const { user: pm, password: pmPassword } = await createRoleAssignedMember(sequelize.models, { organizationId: agency.id, roleKeys: ['project_manager'] });
    const pmLogin = await loginAs(app, pm.email, pmPassword);
    const auth = (r) => r.set('Authorization', `Bearer ${pmLogin.token}`);

    const converted = await auth(request(app).post(`/api/v1/projects/${project.id}/requests/${create.body.data.request.id}/convert-to-task`).send({ isClientVisible: true }));
    expect(converted.status).toBe(201);
    expect(converted.body.data.task.title).toMatch(/testimonials/);

    const task = await Task.findOne({ where: { id: converted.body.data.task.id }, __visibilityScoped: true });
    expect(task.isClientVisible).toBe(true);

    const requestRow = await ClientRequest.findOne({ where: { id: create.body.data.request.id }, __visibilityScoped: true });
    expect(requestRow.convertedToTaskId).toBe(task.id);
    expect(requestRow.status).toBe('in_progress');

    const again = await auth(request(app).post(`/api/v1/projects/${project.id}/requests/${create.body.data.request.id}/convert-to-task`).send({}));
    expect(again.status).toBe(409);
  });
});

describe('Client request submission notifications', () => {
  test('submitting a request notifies the project owner', async () => {
    const { clientOrg, project, owner } = await setupProjectWithOwner();
    const { user, password } = await createRoleAssignedMember(sequelize.models, {
      organizationId: clientOrg.id, roleKeys: ['client_owner'], membershipType: 'client',
    });
    const login = await loginAs(app, user.email, password);
    const auth = (r) => r.set('Authorization', `Bearer ${login.token}`);

    const create = await auth(request(app).post(`/api/v1/projects/${project.id}/requests`).send({ category: 'bug', description: 'The contact form is broken on mobile' }));
    expect(create.status).toBe(201);

    const notifications = await Notification.findAll({ where: { userId: owner.id, type: 'client_request_submitted' } });
    expect(notifications.length).toBe(1);
    expect(notifications[0].data.requestId).toBe(create.body.data.request.id);
  });

  test('submitting a request against a project with no owner set does not throw', async () => {
    const { clientOrg, project } = await setupProject();
    const { user, password } = await createRoleAssignedMember(sequelize.models, {
      organizationId: clientOrg.id, roleKeys: ['client_owner'], membershipType: 'client',
    });
    const login = await loginAs(app, user.email, password);
    const auth = (r) => r.set('Authorization', `Bearer ${login.token}`);

    const create = await auth(request(app).post(`/api/v1/projects/${project.id}/requests`).send({ category: 'bug', description: 'No owner set on this project' }));
    expect(create.status).toBe(201);
  });
});

describe('Content inbox', () => {
  test('a client can submit free-form content, and an employee can mark it reviewed', async () => {
    const { agency, clientOrg, project } = await setupProject();
    const { user: clientUser, password: clientPassword } = await createRoleAssignedMember(sequelize.models, { organizationId: clientOrg.id, roleKeys: ['content_editor'], membershipType: 'client' });
    const clientLogin = await loginAs(app, clientUser.email, clientPassword);

    const submit = await request(app).post(`/api/v1/projects/${project.id}/content-inbox`).set('Authorization', `Bearer ${clientLogin.token}`).send({ type: 'text', body: 'Here is our new tagline: Built for growth.' });
    expect(submit.status).toBe(201);
    expect(submit.body.data.item.status).toBe('new');

    const { user: support, password: supportPassword } = await createRoleAssignedMember(sequelize.models, { organizationId: agency.id, roleKeys: ['support'] });
    const supportLogin = await loginAs(app, support.email, supportPassword);
    const update = await request(app).patch(`/api/v1/projects/${project.id}/content-inbox/${submit.body.data.item.id}/status`).set('Authorization', `Bearer ${supportLogin.token}`).send({ status: 'reviewed' });
    expect(update.status).toBe(200);
    expect(update.body.data.item.status).toBe('reviewed');
  });

  test('a client cannot see another client\'s content inbox items (cross-tenant isolation)', async () => {
    const { clientOrg: clientA, project: projectA } = await setupProject();
    const { agency: agencyB } = await setupProject();
    const clientB = await createOrganization(sequelize.models, { type: 'client', managingAgencyOrganizationId: agencyB.id });

    const { user: userA, password: passwordA } = await createRoleAssignedMember(sequelize.models, { organizationId: clientA.id, roleKeys: ['content_editor'], membershipType: 'client' });
    const loginA = await loginAs(app, userA.email, passwordA);
    await request(app).post(`/api/v1/projects/${projectA.id}/content-inbox`).set('Authorization', `Bearer ${loginA.token}`).send({ type: 'text', body: 'Client A content' });

    const { user: userB, password: passwordB } = await createRoleAssignedMember(sequelize.models, { organizationId: clientB.id, roleKeys: ['content_editor'], membershipType: 'client' });
    const loginB = await loginAs(app, userB.email, passwordB);
    const res = await request(app).get(`/api/v1/projects/${projectA.id}/content-inbox`).set('Authorization', `Bearer ${loginB.token}`);
    expect(res.status).toBe(404);
  });
});
