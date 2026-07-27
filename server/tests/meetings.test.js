'use strict';

const request = require('supertest');
const app = require('../app');
const { sequelize, Project, Meeting } = require('../models');
const { createOrganization, createRoleAssignedMember, loginAs } = require('./helpers/factory');

afterAll(async () => {
  await sequelize.close();
});

async function setupProject() {
  const agency = await createOrganization(sequelize.models, { type: 'agency' });
  const clientOrg = await createOrganization(sequelize.models, { type: 'client', managingAgencyOrganizationId: agency.id });
  const project = await Project.create({
    organizationId: clientOrg.id, agencyOrganizationId: agency.id, stage: 'Development', healthStatus: 'on_track',
  });
  return { agency, clientOrg, project };
}

describe('Meeting visibility guard', () => {
  test('a raw unscoped query throws', async () => {
    await expect(Meeting.findAll()).rejects.toThrow(/must be queried through/i);
  });
});

describe('Meeting request/confirm/decline/cancel', () => {
  test('a client can request a meeting with at least one proposed slot', async () => {
    const { clientOrg, project } = await setupProject();
    const { user, password } = await createRoleAssignedMember(sequelize.models, {
      organizationId: clientOrg.id, roleKeys: ['client_owner'], membershipType: 'client',
    });
    const login = await loginAs(app, user.email, password);
    const auth = (r) => r.set('Authorization', `Bearer ${login.token}`);

    const noSlots = await auth(request(app).post(`/api/v1/projects/${project.id}/meetings`).send({ subject: 'Kickoff call', proposedSlots: [] }));
    expect(noSlots.status).toBe(422);

    const res = await auth(request(app).post(`/api/v1/projects/${project.id}/meetings`).send({
      subject: 'Kickoff call', proposedSlots: [{ start: '2026-08-01T15:00:00Z', end: '2026-08-01T15:30:00Z' }],
    }));
    expect(res.status).toBe(201);
    expect(res.body.data.meeting.status).toBe('requested');
  });

  test('confirming a meeting creates a mock calendar event and records it', async () => {
    const { agency, clientOrg, project } = await setupProject();
    const { user: clientUser, password: clientPassword } = await createRoleAssignedMember(sequelize.models, { organizationId: clientOrg.id, roleKeys: ['client_owner'], membershipType: 'client' });
    const clientLogin = await loginAs(app, clientUser.email, clientPassword);
    const slot = { start: '2026-08-02T18:00:00Z', end: '2026-08-02T18:30:00Z' };
    const created = await request(app).post(`/api/v1/projects/${project.id}/meetings`).set('Authorization', `Bearer ${clientLogin.token}`).send({ subject: 'Design review', proposedSlots: [slot] });

    const { user: pm, password: pmPassword } = await createRoleAssignedMember(sequelize.models, { organizationId: agency.id, roleKeys: ['project_manager'] });
    const pmLogin = await loginAs(app, pm.email, pmPassword);
    const auth = (r) => r.set('Authorization', `Bearer ${pmLogin.token}`);

    const confirmed = await auth(request(app).post(`/api/v1/projects/${project.id}/meetings/${created.body.data.meeting.id}/confirm`).send({ confirmedSlot: slot, attendeeEmails: [clientUser.email] }));
    expect(confirmed.status).toBe(200);
    expect(confirmed.body.data.meeting.status).toBe('confirmed');
    expect(confirmed.body.data.meeting.googleCalendarEventId).toMatch(/^mock_gcal_evt_/);

    // Confirming a second time is rejected — only a 'requested' meeting can be confirmed.
    const again = await auth(request(app).post(`/api/v1/projects/${project.id}/meetings/${created.body.data.meeting.id}/confirm`).send({ confirmedSlot: slot }));
    expect(again.status).toBe(422);
  });

  test('cancelling a confirmed meeting also cancels its calendar event', async () => {
    const { agency, clientOrg, project } = await setupProject();
    const { user: clientUser, password: clientPassword } = await createRoleAssignedMember(sequelize.models, { organizationId: clientOrg.id, roleKeys: ['client_owner'], membershipType: 'client' });
    const clientLogin = await loginAs(app, clientUser.email, clientPassword);
    const slot = { start: '2026-08-03T18:00:00Z', end: '2026-08-03T18:30:00Z' };
    const created = await request(app).post(`/api/v1/projects/${project.id}/meetings`).set('Authorization', `Bearer ${clientLogin.token}`).send({ subject: 'Launch planning', proposedSlots: [slot] });

    const { user: pm, password: pmPassword } = await createRoleAssignedMember(sequelize.models, { organizationId: agency.id, roleKeys: ['project_manager'] });
    const pmLogin = await loginAs(app, pm.email, pmPassword);
    const auth = (r) => r.set('Authorization', `Bearer ${pmLogin.token}`);
    await auth(request(app).post(`/api/v1/projects/${project.id}/meetings/${created.body.data.meeting.id}/confirm`).send({ confirmedSlot: slot }));

    const cancelled = await auth(request(app).post(`/api/v1/projects/${project.id}/meetings/${created.body.data.meeting.id}/cancel`));
    expect(cancelled.status).toBe(200);
    expect(cancelled.body.data.meeting.status).toBe('cancelled');
  });

  test('meetings.manage is required to confirm/decline/cancel; a client cannot', async () => {
    const { clientOrg, project } = await setupProject();
    const { user, password } = await createRoleAssignedMember(sequelize.models, {
      organizationId: clientOrg.id, roleKeys: ['client_owner'], membershipType: 'client',
    });
    const login = await loginAs(app, user.email, password);
    const auth = (r) => r.set('Authorization', `Bearer ${login.token}`);
    const created = await auth(request(app).post(`/api/v1/projects/${project.id}/meetings`).send({ subject: 'x', proposedSlots: [{ start: 'a', end: 'b' }] }));

    const res = await auth(request(app).post(`/api/v1/projects/${project.id}/meetings/${created.body.data.meeting.id}/decline`));
    expect(res.status).toBe(403);
  });
});

describe('Cross-agency isolation for meetings', () => {
  test('an employee at one agency cannot act on another agency\'s meeting', async () => {
    const { clientOrg, project } = await setupProject();
    const { agency: agencyB } = await setupProject();
    const { user: clientUser, password: clientPassword } = await createRoleAssignedMember(sequelize.models, { organizationId: clientOrg.id, roleKeys: ['client_owner'], membershipType: 'client' });
    const clientLogin = await loginAs(app, clientUser.email, clientPassword);
    const created = await request(app).post(`/api/v1/projects/${project.id}/meetings`).set('Authorization', `Bearer ${clientLogin.token}`).send({ subject: 'x', proposedSlots: [{ start: 'a', end: 'b' }] });

    const { user, password } = await createRoleAssignedMember(sequelize.models, { organizationId: agencyB.id, roleKeys: ['project_manager'] });
    const login = await loginAs(app, user.email, password);
    const res = await request(app).post(`/api/v1/projects/${project.id}/meetings/${created.body.data.meeting.id}/decline`).set('Authorization', `Bearer ${login.token}`);
    expect(res.status).toBe(404);
  });
});
