'use strict';

const request = require('supertest');
const app = require('../app');
const {
  sequelize, Project, Website, WebsiteDeployment, Notification,
} = require('../models');
const { createOrganization, createRoleAssignedMember, loginAs } = require('./helpers/factory');
const { getCPanelAdapter } = require('../core/integrations/cpanel/cpanelAdapter');

afterAll(async () => {
  await sequelize.close();
});

function auth(login) {
  return (r) => r.set('Authorization', `Bearer ${login.token}`);
}

async function setupProjectReadyForProductionDeploy(domain) {
  const agency = await createOrganization(sequelize.models, { type: 'agency' });
  const clientOrg = await createOrganization(sequelize.models, { type: 'client', managingAgencyOrganizationId: agency.id });
  const project = await Project.create({
    organizationId: clientOrg.id, agencyOrganizationId: agency.id, stage: 'Design', healthStatus: 'on_track',
  });

  const { user: developer, password: developerPassword } = await createRoleAssignedMember(sequelize.models, { organizationId: agency.id, roleKeys: ['developer'] });
  const developerAuth = auth(await loginAs(app, developer.email, developerPassword));
  await developerAuth(request(app).post(`/api/v1/projects/${project.id}/website`).send({ name: 'Acme Co Site', startingMode: 'blank' }));
  await developerAuth(request(app).post(`/api/v1/projects/${project.id}/website/repository`));

  const base = await developerAuth(request(app).get(`/api/v1/projects/${project.id}/website`));
  const withHero = structuredClone(base.body.data.website.draftSchema);
  withHero.pages[0].sections.push({
    id: 'hero-1', componentKey: 'hero', content: { heading: 'Welcome' }, settings: {},
  });
  await developerAuth(request(app).patch(`/api/v1/projects/${project.id}/website/draft`).send({ draftSchema: withHero }));
  const checkpoint = await developerAuth(request(app).post(`/api/v1/projects/${project.id}/website/versions`).send({ label: 'v1' }));
  const versionId = checkpoint.body.data.version.id;

  const { user: pm, password: pmPassword } = await createRoleAssignedMember(sequelize.models, { organizationId: agency.id, roleKeys: ['project_manager'] });
  const pmAuth = auth(await loginAs(app, pm.email, pmPassword));
  await pmAuth(request(app).post(`/api/v1/projects/${project.id}/website/domain/register`).send({ domain }));

  const { user: admin, password: adminPassword } = await createRoleAssignedMember(sequelize.models, { organizationId: agency.id, roleKeys: ['administrator'] });
  const adminAuth = auth(await loginAs(app, admin.email, adminPassword));
  await adminAuth(request(app).post(`/api/v1/projects/${project.id}/assignments`).send({ userId: developer.id, roleSlot: 'developer' }));

  return {
    agency, clientOrg, project, developer, developerAuth, pmAuth, versionId,
  };
}

describe('POST /api/v1/projects/:projectId/website/versions/:versionId/deploy-production', () => {
  test('builder.manage is required — builder.develop alone (a developer) is not enough', async () => {
    const { project, developerAuth, versionId } = await setupProjectReadyForProductionDeploy('perm-check.com');
    const res = await developerAuth(request(app).post(`/api/v1/projects/${project.id}/website/versions/${versionId}/deploy-production`));
    expect(res.status).toBe(403);
  });

  test('requires a registered, active domain — 422 if none exists', async () => {
    const agency = await createOrganization(sequelize.models, { type: 'agency' });
    const clientOrg = await createOrganization(sequelize.models, { type: 'client', managingAgencyOrganizationId: agency.id });
    const project = await Project.create({
      organizationId: clientOrg.id, agencyOrganizationId: agency.id, stage: 'Design', healthStatus: 'on_track',
    });
    const { user: developer, password: developerPassword } = await createRoleAssignedMember(sequelize.models, { organizationId: agency.id, roleKeys: ['developer'] });
    const developerAuth = auth(await loginAs(app, developer.email, developerPassword));
    await developerAuth(request(app).post(`/api/v1/projects/${project.id}/website`).send({ name: 'x', startingMode: 'blank' }));
    await developerAuth(request(app).post(`/api/v1/projects/${project.id}/website/repository`));
    const checkpoint = await developerAuth(request(app).post(`/api/v1/projects/${project.id}/website/versions`).send({ label: 'v1' }));

    const { user: pm, password: pmPassword } = await createRoleAssignedMember(sequelize.models, { organizationId: agency.id, roleKeys: ['project_manager'] });
    const pmAuth = auth(await loginAs(app, pm.email, pmPassword));
    const res = await pmAuth(request(app).post(`/api/v1/projects/${project.id}/website/versions/${checkpoint.body.data.version.id}/deploy-production`));
    expect(res.status).toBe(422);
    expect(res.body.message).toMatch(/domain/i);
  });

  test(
    'happy path: healthy deploy goes live, sets Website.currentLiveProductionDeploymentId, and the first attempt has no predecessor',
    async () => {
      const { project, pmAuth, versionId } = await setupProjectReadyForProductionDeploy('happy-path-deploy.com');

      const res = await pmAuth(request(app).post(`/api/v1/projects/${project.id}/website/versions/${versionId}/deploy-production`));
      expect(res.status).toBe(200);
      expect(res.body.data.deployment.status).toBe('live');
      expect(res.body.data.deployment.environment).toBe('production');
      expect(res.body.data.deployment.previousLiveDeploymentId).toBeNull();
      expect(res.body.data.deployment.backupRef).toMatch(/^mock_backup_/);

      const website = await Website.findOne({ where: { projectId: project.id }, __visibilityScoped: true });
      expect(website.currentLiveProductionDeploymentId).toBe(res.body.data.deployment.id);

      const currentRes = await pmAuth(request(app).get(`/api/v1/projects/${project.id}/website/production-deployments/current`));
      expect(currentRes.body.data.deployment.id).toBe(res.body.data.deployment.id);
    }
  );

  test('a second successful deploy points previousLiveDeploymentId at the first, and updates the current-live pointer', async () => {
    const { project, pmAuth, versionId } = await setupProjectReadyForProductionDeploy('second-deploy.com');
    const first = await pmAuth(request(app).post(`/api/v1/projects/${project.id}/website/versions/${versionId}/deploy-production`));
    const second = await pmAuth(request(app).post(`/api/v1/projects/${project.id}/website/versions/${versionId}/deploy-production`));

    expect(second.body.data.deployment.previousLiveDeploymentId).toBe(first.body.data.deployment.id);
    const website = await Website.findOne({ where: { projectId: project.id }, __visibilityScoped: true });
    expect(website.currentLiveProductionDeploymentId).toBe(second.body.data.deployment.id);

    const list = await pmAuth(request(app).get(`/api/v1/projects/${project.id}/website/production-deployments`));
    expect(list.body.data.deployments.length).toBe(2);
  });

  test(
    'the major gate — an unhealthy deploy is automatically rolled back, the live-production pointer is left untouched, and responsible roles are notified',
    async () => {
      const {
        project, developer, pmAuth, versionId,
      } = await setupProjectReadyForProductionDeploy('rollback-test.com');

      const first = await pmAuth(request(app).post(`/api/v1/projects/${project.id}/website/versions/${versionId}/deploy-production`));
      expect(first.body.data.deployment.status).toBe('live');

      const cpanelAdapter = getCPanelAdapter();
      const liveUrl = 'https://rollback-test.com/';
      cpanelAdapter.setHealthOverride(liveUrl, false);

      const second = await pmAuth(request(app).post(`/api/v1/projects/${project.id}/website/versions/${versionId}/deploy-production`));
      expect(second.status).toBe(200);
      expect(second.body.data.deployment.status).toBe('rolled_back');
      expect(second.body.data.deployment.previousLiveDeploymentId).toBe(first.body.data.deployment.id);

      // Form functionality / build agreement (§ 2c part 2): the live
      // pointer is left exactly where it was before this failed attempt.
      const website = await Website.findOne({ where: { projectId: project.id }, __visibilityScoped: true });
      expect(website.currentLiveProductionDeploymentId).toBe(first.body.data.deployment.id);

      const notifications = await Notification.findAll({ where: { userId: developer.id, type: 'website_production_deploy_rolled_back' } });
      expect(notifications.length).toBe(1);

      cpanelAdapter.setHealthOverride(liveUrl, true);
    }
  );

  test('rollback-failed: if restoring the backup itself throws, the deployment is recorded as rollback_failed with an urgent notification', async () => {
    const {
      project, developer, pmAuth, versionId,
    } = await setupProjectReadyForProductionDeploy('double-failure.com');

    const first = await pmAuth(request(app).post(`/api/v1/projects/${project.id}/website/versions/${versionId}/deploy-production`));
    expect(first.body.data.deployment.status).toBe('live');

    const cpanelAdapter = getCPanelAdapter();
    const liveUrl = 'https://double-failure.com/';
    cpanelAdapter.setHealthOverride(liveUrl, false);
    const originalRestore = cpanelAdapter.restoreFromBackup.bind(cpanelAdapter);
    cpanelAdapter.restoreFromBackup = async () => {
      throw new Error('simulated cPanel restore failure');
    };

    try {
      const second = await pmAuth(request(app).post(`/api/v1/projects/${project.id}/website/versions/${versionId}/deploy-production`));
      expect(second.status).toBe(200);
      expect(second.body.data.deployment.status).toBe('rollback_failed');

      const website = await Website.findOne({ where: { projectId: project.id }, __visibilityScoped: true });
      expect(website.currentLiveProductionDeploymentId).toBe(first.body.data.deployment.id);

      const notifications = await Notification.findAll({ where: { userId: developer.id, type: 'website_production_rollback_failed' } });
      expect(notifications.length).toBe(1);
    } finally {
      cpanelAdapter.restoreFromBackup = originalRestore;
      cpanelAdapter.setHealthOverride(liveUrl, true);
    }
  });

  test(
    'closing-review fix: uploadBuild throwing after a backup was taken is treated exactly like an unhealthy result — rolled back, notified, live pointer untouched',
    async () => {
      const {
        project, developer, pmAuth, versionId,
      } = await setupProjectReadyForProductionDeploy('throw-after-backup.com');

      const first = await pmAuth(request(app).post(`/api/v1/projects/${project.id}/website/versions/${versionId}/deploy-production`));
      expect(first.body.data.deployment.status).toBe('live');

      const cpanelAdapter = getCPanelAdapter();
      const originalUploadBuild = cpanelAdapter.uploadBuild.bind(cpanelAdapter);
      cpanelAdapter.uploadBuild = async () => {
        throw new Error('simulated network failure mid-upload');
      };

      try {
        const second = await pmAuth(request(app).post(`/api/v1/projects/${project.id}/website/versions/${versionId}/deploy-production`));
        expect(second.status).toBe(200);
        expect(second.body.data.deployment.status).toBe('rolled_back');
        expect(second.body.data.deployment.backupRef).toBeTruthy();

        const website = await Website.findOne({ where: { projectId: project.id }, __visibilityScoped: true });
        expect(website.currentLiveProductionDeploymentId).toBe(first.body.data.deployment.id);

        const notifications = await Notification.findAll({ where: { userId: developer.id, type: 'website_production_deploy_rolled_back' } });
        expect(notifications.length).toBe(1);
      } finally {
        cpanelAdapter.uploadBuild = originalUploadBuild;
      }
    }
  );

  test(
    'closing-review fix: backupCurrentFolder throwing before any upload leaves the live site untouched — recorded as failed, not rolled_back',
    async () => {
      const {
        project, developer, pmAuth, versionId,
      } = await setupProjectReadyForProductionDeploy('throw-before-backup.com');

      const cpanelAdapter = getCPanelAdapter();
      const originalBackup = cpanelAdapter.backupCurrentFolder.bind(cpanelAdapter);
      cpanelAdapter.backupCurrentFolder = async () => {
        throw new Error('simulated failure taking a backup');
      };

      try {
        const res = await pmAuth(request(app).post(`/api/v1/projects/${project.id}/website/versions/${versionId}/deploy-production`));
        expect(res.status).toBe(200);
        expect(res.body.data.deployment.status).toBe('failed');
        expect(res.body.data.deployment.backupRef).toBeNull();

        const website = await Website.findOne({ where: { projectId: project.id }, __visibilityScoped: true });
        expect(website.currentLiveProductionDeploymentId).toBeNull();

        const notifications = await Notification.findAll({ where: { userId: developer.id, type: 'website_production_deploy_failed' } });
        expect(notifications.length).toBe(1);
      } finally {
        cpanelAdapter.backupCurrentFolder = originalBackup;
      }
    }
  );

  test('every deploy attempt creates exactly one new WebsiteDeployment row, never updating a prior one', async () => {
    const { project, pmAuth, versionId } = await setupProjectReadyForProductionDeploy('invariant-check.com');
    const first = await pmAuth(request(app).post(`/api/v1/projects/${project.id}/website/versions/${versionId}/deploy-production`));
    const firstUpdatedAt = first.body.data.deployment.updatedAt;

    await pmAuth(request(app).post(`/api/v1/projects/${project.id}/website/versions/${versionId}/deploy-production`));

    const firstRowAfter = await WebsiteDeployment.findOne({ where: { id: first.body.data.deployment.id }, __visibilityScoped: true });
    expect(firstRowAfter.updatedAt.toISOString()).toBe(firstUpdatedAt);
    expect(firstRowAfter.status).toBe('live');

    const count = await WebsiteDeployment.count({ where: { websiteId: firstRowAfter.websiteId, environment: 'production' }, __visibilityScoped: true });
    expect(count).toBe(2);
  });

  test('GET /production-deployments/:deploymentId returns a single deployment scoped to its own website', async () => {
    const { project, pmAuth, versionId } = await setupProjectReadyForProductionDeploy('detail-lookup.com');
    const deployed = await pmAuth(request(app).post(`/api/v1/projects/${project.id}/website/versions/${versionId}/deploy-production`));

    const res = await pmAuth(request(app).get(`/api/v1/projects/${project.id}/website/production-deployments/${deployed.body.data.deployment.id}`));
    expect(res.status).toBe(200);
    expect(res.body.data.deployment.id).toBe(deployed.body.data.deployment.id);

    const otherProject = await setupProjectReadyForProductionDeploy('detail-lookup-other.com');
    const notFoundRes = await otherProject.pmAuth(request(app).get(`/api/v1/projects/${otherProject.project.id}/website/production-deployments/${deployed.body.data.deployment.id}`));
    expect(notFoundRes.status).toBe(404);
  });

  test('cross-agency isolation: an unrelated agency cannot deploy or list another agency\'s production deployments', async () => {
    const { project, versionId } = await setupProjectReadyForProductionDeploy('isolation-check.com');
    const otherAgency = await createOrganization(sequelize.models, { type: 'agency' });
    const { user, password } = await createRoleAssignedMember(sequelize.models, { organizationId: otherAgency.id, roleKeys: ['project_manager'] });
    const login = await loginAs(app, user.email, password);

    const deployRes = await auth(login)(request(app).post(`/api/v1/projects/${project.id}/website/versions/${versionId}/deploy-production`));
    expect(deployRes.status).toBe(404);
    const listRes = await auth(login)(request(app).get(`/api/v1/projects/${project.id}/website/production-deployments`));
    expect(listRes.status).toBe(404);
  });
});
