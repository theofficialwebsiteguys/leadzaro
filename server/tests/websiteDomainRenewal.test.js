'use strict';

const request = require('supertest');
const app = require('../app');
const {
  sequelize, Project, WebsiteDomain, Notification,
} = require('../models');
const { createOrganization, createRoleAssignedMember, loginAs } = require('./helpers/factory');

afterAll(async () => {
  await sequelize.close();
});

function auth(login) {
  return (r) => r.set('Authorization', `Bearer ${login.token}`);
}

async function setupProjectWithRegisteredDomain(domain) {
  const agency = await createOrganization(sequelize.models, { type: 'agency' });
  const clientOrg = await createOrganization(sequelize.models, { type: 'client', managingAgencyOrganizationId: agency.id });
  const project = await Project.create({
    organizationId: clientOrg.id, agencyOrganizationId: agency.id, stage: 'Design', healthStatus: 'on_track',
  });

  const { user: developer, password: developerPassword } = await createRoleAssignedMember(sequelize.models, { organizationId: agency.id, roleKeys: ['developer'] });
  const developerAuth = auth(await loginAs(app, developer.email, developerPassword));
  await developerAuth(request(app).post(`/api/v1/projects/${project.id}/website`).send({ name: 'Acme Co Site', startingMode: 'blank' }));

  const { user: pm, password: pmPassword } = await createRoleAssignedMember(sequelize.models, { organizationId: agency.id, roleKeys: ['project_manager'] });
  const pmAuth = auth(await loginAs(app, pm.email, pmPassword));
  const registerRes = await pmAuth(request(app).post(`/api/v1/projects/${project.id}/website/domain/register`).send({ domain }));

  const { user: admin, password: adminPassword } = await createRoleAssignedMember(sequelize.models, { organizationId: agency.id, roleKeys: ['administrator'] });
  const adminAuth = auth(await loginAs(app, admin.email, adminPassword));
  await adminAuth(request(app).post(`/api/v1/projects/${project.id}/assignments`).send({ userId: developer.id, roleSlot: 'developer' }));

  const { user: clientUser, password: clientPassword } = await createRoleAssignedMember(sequelize.models, {
    organizationId: clientOrg.id, roleKeys: ['client_owner'], membershipType: 'client',
  });
  const clientAuth = auth(await loginAs(app, clientUser.email, clientPassword));

  return {
    agency, clientOrg, project, developer, pmAuth, clientUser, clientAuth, domainId: registerRes.body.data.domain.id,
  };
}

describe('POST /api/v1/projects/:projectId/website/domain/check-renewal', () => {
  test('builder.manage is required', async () => {
    const { project, clientAuth } = await setupProjectWithRegisteredDomain('renewal-perm-check.com');
    const res = await clientAuth(request(app).post(`/api/v1/projects/${project.id}/website/domain/check-renewal`));
    expect(res.status).toBe(403);
  });

  test('a domain registered for a full year is not yet due — no notification sent', async () => {
    const { project, pmAuth } = await setupProjectWithRegisteredDomain('renewal-not-due.com');
    const res = await pmAuth(request(app).post(`/api/v1/projects/${project.id}/website/domain/check-renewal`));
    expect(res.status).toBe(200);
    expect(res.body.data.noticeSent).toBe(false);
    expect(res.body.data.reason).toBe('not_yet_due');
  });

  test(
    'a domain expiring within the notice window sends a full-detail notice to assigned employees and a narrow notice to active client members',
    async () => {
      const {
        project, developer, clientUser, pmAuth, domainId,
      } = await setupProjectWithRegisteredDomain('renewal-due-soon.com');

      const soon = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000);
      await WebsiteDomain.update({ expiresAt: soon }, { where: { id: domainId }, __visibilityScoped: true });

      const res = await pmAuth(request(app).post(`/api/v1/projects/${project.id}/website/domain/check-renewal`));
      expect(res.status).toBe(200);
      expect(res.body.data.noticeSent).toBe(true);
      expect(res.body.data.notifiedEmployeeUserIds).toContain(developer.id);
      expect(res.body.data.notifiedClientUserIds).toContain(clientUser.id);

      const employeeNotifications = await Notification.findAll({ where: { userId: developer.id, type: 'website_domain_renewal_approaching' } });
      expect(employeeNotifications.length).toBe(1);
      expect(employeeNotifications[0].title).toContain('renewal-due-soon.com');

      const clientNotifications = await Notification.findAll({ where: { userId: clientUser.id, type: 'website_domain_renewal_approaching' } });
      expect(clientNotifications.length).toBe(1);
      // Client-facing body carries only the date, never DNS/registrar internals.
      expect(clientNotifications[0].data.domain).toBe('renewal-due-soon.com');
      expect(clientNotifications[0].data.dnsRecords).toBeUndefined();

      const domainRow = await WebsiteDomain.findOne({ where: { id: domainId }, __visibilityScoped: true });
      expect(domainRow.renewalNoticeSentAt).toBeTruthy();
    }
  );

  test('a second check within the cooldown window does not send a duplicate notification', async () => {
    const {
      project, developer, pmAuth, domainId,
    } = await setupProjectWithRegisteredDomain('renewal-cooldown.com');
    const soon = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000);
    await WebsiteDomain.update({ expiresAt: soon }, { where: { id: domainId }, __visibilityScoped: true });

    const first = await pmAuth(request(app).post(`/api/v1/projects/${project.id}/website/domain/check-renewal`));
    expect(first.body.data.noticeSent).toBe(true);

    const second = await pmAuth(request(app).post(`/api/v1/projects/${project.id}/website/domain/check-renewal`));
    expect(second.body.data.noticeSent).toBe(false);
    expect(second.body.data.reason).toBe('already_sent_recently');

    const employeeNotifications = await Notification.findAll({ where: { userId: developer.id, type: 'website_domain_renewal_approaching' } });
    expect(employeeNotifications.length).toBe(1);
  });

  test('no domain registered at all — a clean, explicit no-op', async () => {
    const agency = await createOrganization(sequelize.models, { type: 'agency' });
    const clientOrg = await createOrganization(sequelize.models, { type: 'client', managingAgencyOrganizationId: agency.id });
    const project = await Project.create({
      organizationId: clientOrg.id, agencyOrganizationId: agency.id, stage: 'Design', healthStatus: 'on_track',
    });
    const { user: developer, password: developerPassword } = await createRoleAssignedMember(sequelize.models, { organizationId: agency.id, roleKeys: ['developer'] });
    const developerAuth = auth(await loginAs(app, developer.email, developerPassword));
    await developerAuth(request(app).post(`/api/v1/projects/${project.id}/website`).send({ name: 'x', startingMode: 'blank' }));

    const { user: pm, password: pmPassword } = await createRoleAssignedMember(sequelize.models, { organizationId: agency.id, roleKeys: ['project_manager'] });
    const pmAuth = auth(await loginAs(app, pm.email, pmPassword));
    const res = await pmAuth(request(app).post(`/api/v1/projects/${project.id}/website/domain/check-renewal`));
    expect(res.status).toBe(200);
    expect(res.body.data.noticeSent).toBe(false);
    expect(res.body.data.reason).toBe('no_domain_or_expiry');
  });
});
