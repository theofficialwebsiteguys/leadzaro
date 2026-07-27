'use strict';

const request = require('supertest');
const app = require('../app');
const {
  sequelize, Project, CancellationRequest, Notification,
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

describe('CancellationRequest visibility guard', () => {
  test('a raw, unscoped query throws', async () => {
    await expect(CancellationRequest.findAll()).rejects.toThrow(/must be queried through/i);
  });
});

describe('Requesting a cancellation', () => {
  test('a client can request cancellation; initiatedBy is derived from their own membership, never trusted from input', async () => {
    const { clientOrg, project } = await setupProject();
    const { user, password } = await createRoleAssignedMember(sequelize.models, {
      organizationId: clientOrg.id, roleKeys: ['client_owner'], membershipType: 'client',
    });
    const login = await loginAs(app, user.email, password);
    const auth = (r) => r.set('Authorization', `Bearer ${login.token}`);

    const res = await auth(request(app).post(`/api/v1/projects/${project.id}/cancellation-requests`).send({ reason: 'Moving in-house', initiatedBy: 'agency' }));
    expect(res.status).toBe(201);
    expect(res.body.data.cancellationRequest.status).toBe('requested');
    expect(res.body.data.cancellationRequest.initiatedBy).toBe('client');

    const projectRow = await Project.findOne({ where: { id: project.id }, __visibilityScoped: true });
    expect(projectRow.cancellationRequestedAt).not.toBeNull();
  });

  test('an administrator can also request cancellation (agency-initiated)', async () => {
    const { agency, project } = await setupProject();
    const { user, password } = await createRoleAssignedMember(sequelize.models, { organizationId: agency.id, roleKeys: ['administrator'] });
    const login = await loginAs(app, user.email, password);
    const auth = (r) => r.set('Authorization', `Bearer ${login.token}`);

    const res = await auth(request(app).post(`/api/v1/projects/${project.id}/cancellation-requests`).send({ reason: 'Non-payment' }));
    expect(res.status).toBe(201);
    expect(res.body.data.cancellationRequest.initiatedBy).toBe('agency');
  });

  test('a second request cannot be created while one is already pending', async () => {
    const { clientOrg, project } = await setupProject();
    const { user, password } = await createRoleAssignedMember(sequelize.models, {
      organizationId: clientOrg.id, roleKeys: ['client_owner'], membershipType: 'client',
    });
    const login = await loginAs(app, user.email, password);
    const auth = (r) => r.set('Authorization', `Bearer ${login.token}`);

    await auth(request(app).post(`/api/v1/projects/${project.id}/cancellation-requests`).send({ reason: 'First' }));
    const second = await auth(request(app).post(`/api/v1/projects/${project.id}/cancellation-requests`).send({ reason: 'Second' }));
    expect(second.status).toBe(409);
  });

  test('cancellations.request is required; a viewer cannot request cancellation', async () => {
    const { clientOrg, project } = await setupProject();
    const { user, password } = await createRoleAssignedMember(sequelize.models, {
      organizationId: clientOrg.id, roleKeys: ['viewer'], membershipType: 'client',
    });
    const login = await loginAs(app, user.email, password);
    const auth = (r) => r.set('Authorization', `Bearer ${login.token}`);

    const res = await auth(request(app).post(`/api/v1/projects/${project.id}/cancellation-requests`).send({ reason: 'x' }));
    expect(res.status).toBe(403);
  });

  test('a hands-on employee role without cancellations.request (e.g. designer) cannot request cancellation', async () => {
    const { agency, project } = await setupProject();
    const { user, password } = await createRoleAssignedMember(sequelize.models, { organizationId: agency.id, roleKeys: ['designer'] });
    const login = await loginAs(app, user.email, password);
    const auth = (r) => r.set('Authorization', `Bearer ${login.token}`);

    const res = await auth(request(app).post(`/api/v1/projects/${project.id}/cancellation-requests`).send({ reason: 'x' }));
    expect(res.status).toBe(403);
  });
});

describe('Confirming/withdrawing a cancellation', () => {
  test('cancellations.manage is required to confirm or withdraw; the client who requested it cannot', async () => {
    const { clientOrg, project } = await setupProject();
    const { user, password } = await createRoleAssignedMember(sequelize.models, {
      organizationId: clientOrg.id, roleKeys: ['client_owner'], membershipType: 'client',
    });
    const login = await loginAs(app, user.email, password);
    const auth = (r) => r.set('Authorization', `Bearer ${login.token}`);
    const created = await auth(request(app).post(`/api/v1/projects/${project.id}/cancellation-requests`).send({ reason: 'x' }));

    const confirmRes = await auth(request(app).post(`/api/v1/projects/${project.id}/cancellation-requests/${created.body.data.cancellationRequest.id}/confirm`));
    expect(confirmRes.status).toBe(403);
    const withdrawRes = await auth(request(app).post(`/api/v1/projects/${project.id}/cancellation-requests/${created.body.data.cancellationRequest.id}/withdraw`));
    expect(withdrawRes.status).toBe(403);
  });

  test('an administrator can confirm a pending request; confirming again is rejected', async () => {
    const { agency, clientOrg, project } = await setupProject();
    const { user: clientUser, password: clientPassword } = await createRoleAssignedMember(sequelize.models, { organizationId: clientOrg.id, roleKeys: ['client_owner'], membershipType: 'client' });
    const clientLogin = await loginAs(app, clientUser.email, clientPassword);
    const created = await request(app).post(`/api/v1/projects/${project.id}/cancellation-requests`).set('Authorization', `Bearer ${clientLogin.token}`).send({ reason: 'x' });

    const { user: admin, password: adminPassword } = await createRoleAssignedMember(sequelize.models, { organizationId: agency.id, roleKeys: ['administrator'] });
    const adminLogin = await loginAs(app, admin.email, adminPassword);
    const auth = (r) => r.set('Authorization', `Bearer ${adminLogin.token}`);

    const confirmed = await auth(request(app).post(`/api/v1/projects/${project.id}/cancellation-requests/${created.body.data.cancellationRequest.id}/confirm`));
    expect(confirmed.status).toBe(200);
    expect(confirmed.body.data.cancellationRequest.status).toBe('confirmed');
    expect(confirmed.body.data.cancellationRequest.confirmedByUserId).toBe(admin.id);

    const again = await auth(request(app).post(`/api/v1/projects/${project.id}/cancellation-requests/${created.body.data.cancellationRequest.id}/confirm`));
    expect(again.status).toBe(422);
  });

  test('withdrawing a pending request clears Project.cancellationRequestedAt and allows a new request afterward', async () => {
    const { agency, clientOrg, project } = await setupProject();
    const { user: clientUser, password: clientPassword } = await createRoleAssignedMember(sequelize.models, { organizationId: clientOrg.id, roleKeys: ['client_owner'], membershipType: 'client' });
    const clientLogin = await loginAs(app, clientUser.email, clientPassword);
    const created = await request(app).post(`/api/v1/projects/${project.id}/cancellation-requests`).set('Authorization', `Bearer ${clientLogin.token}`).send({ reason: 'Changed my mind' });

    const { user: pm, password: pmPassword } = await createRoleAssignedMember(sequelize.models, { organizationId: agency.id, roleKeys: ['project_manager'] });
    const pmLogin = await loginAs(app, pm.email, pmPassword);
    const auth = (r) => r.set('Authorization', `Bearer ${pmLogin.token}`);

    const withdrawn = await auth(request(app).post(`/api/v1/projects/${project.id}/cancellation-requests/${created.body.data.cancellationRequest.id}/withdraw`));
    expect(withdrawn.status).toBe(200);
    expect(withdrawn.body.data.cancellationRequest.status).toBe('withdrawn');

    const projectRow = await Project.findOne({ where: { id: project.id }, __visibilityScoped: true });
    expect(projectRow.cancellationRequestedAt).toBeNull();

    const second = await request(app).post(`/api/v1/projects/${project.id}/cancellation-requests`).set('Authorization', `Bearer ${clientLogin.token}`).send({ reason: 'Reconsidered' });
    expect(second.status).toBe(201);
  });
});

describe('Cancellation notifications', () => {
  test('a client-initiated request notifies the project owner; confirming/withdrawing notifies whoever requested it', async () => {
    const {
      clientOrg, project, owner, ownerPassword,
    } = await setupProjectWithOwner();
    const { user: clientUser, password: clientPassword } = await createRoleAssignedMember(sequelize.models, { organizationId: clientOrg.id, roleKeys: ['client_owner'], membershipType: 'client' });
    const clientLogin = await loginAs(app, clientUser.email, clientPassword);

    const created = await request(app).post(`/api/v1/projects/${project.id}/cancellation-requests`).set('Authorization', `Bearer ${clientLogin.token}`).send({ reason: 'Budget cuts' });
    expect(created.status).toBe(201);

    const requestedNotifications = await Notification.findAll({ where: { userId: owner.id, type: 'cancellation_requested' } });
    expect(requestedNotifications.length).toBe(1);

    const ownerLogin = await loginAs(app, owner.email, ownerPassword);
    const auth = (r) => r.set('Authorization', `Bearer ${ownerLogin.token}`);
    const confirmed = await auth(request(app).post(`/api/v1/projects/${project.id}/cancellation-requests/${created.body.data.cancellationRequest.id}/confirm`));
    expect(confirmed.status).toBe(200);

    const confirmedNotifications = await Notification.findAll({ where: { userId: clientUser.id, type: 'cancellation_confirmed' } });
    expect(confirmedNotifications.length).toBe(1);
  });
});

describe('Cross-agency isolation for cancellation requests', () => {
  test('an employee at one agency cannot act on another agency\'s cancellation request', async () => {
    const { clientOrg, project } = await setupProject();
    const { agency: agencyB } = await setupProject();
    const { user: clientUser, password: clientPassword } = await createRoleAssignedMember(sequelize.models, { organizationId: clientOrg.id, roleKeys: ['client_owner'], membershipType: 'client' });
    const clientLogin = await loginAs(app, clientUser.email, clientPassword);
    const created = await request(app).post(`/api/v1/projects/${project.id}/cancellation-requests`).set('Authorization', `Bearer ${clientLogin.token}`).send({ reason: 'x' });

    const { user, password } = await createRoleAssignedMember(sequelize.models, { organizationId: agencyB.id, roleKeys: ['administrator'] });
    const login = await loginAs(app, user.email, password);
    const res = await request(app).post(`/api/v1/projects/${project.id}/cancellation-requests/${created.body.data.cancellationRequest.id}/confirm`).set('Authorization', `Bearer ${login.token}`);
    expect(res.status).toBe(404);
  });
});
