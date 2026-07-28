'use strict';

const request = require('supertest');
const app = require('../app');
const { sequelize, Project } = require('../models');
const { createOrganization, createRoleAssignedMember, loginAs } = require('./helpers/factory');
const {
  MockCPanelAdapter, DisabledCPanelAdapter,
} = require('../core/integrations/cpanel/cpanelAdapter');

afterAll(async () => {
  await sequelize.close();
});

function auth(login) {
  return (r) => r.set('Authorization', `Bearer ${login.token}`);
}

async function setupProjectWithWebsite() {
  const agency = await createOrganization(sequelize.models, { type: 'agency' });
  const clientOrg = await createOrganization(sequelize.models, { type: 'client', managingAgencyOrganizationId: agency.id });
  const project = await Project.create({
    organizationId: clientOrg.id, agencyOrganizationId: agency.id, stage: 'Design', healthStatus: 'on_track',
  });

  const { user: developer, password: developerPassword } = await createRoleAssignedMember(sequelize.models, { organizationId: agency.id, roleKeys: ['developer'] });
  const developerLogin = await loginAs(app, developer.email, developerPassword);
  await auth(developerLogin)(request(app).post(`/api/v1/projects/${project.id}/website`).send({ name: 'Acme Co Site', startingMode: 'blank' }));

  const { user: pm, password: pmPassword } = await createRoleAssignedMember(sequelize.models, { organizationId: agency.id, roleKeys: ['project_manager'] });
  const pmLogin = await loginAs(app, pm.email, pmPassword);
  const pmAuth = auth(pmLogin);

  return {
    agency, clientOrg, project, pmAuth,
  };
}

describe('CPanelAdapter (unit)', () => {
  test('DisabledCPanelAdapter rejects every operation instead of silently succeeding', async () => {
    const adapter = new DisabledCPanelAdapter();
    await expect(adapter.uploadBuild('acct', [])).rejects.toThrow(/not configured/i);
    await expect(adapter.backupCurrentFolder('acct')).rejects.toThrow(/not configured/i);
    await expect(adapter.restoreFromBackup('acct', 'x')).rejects.toThrow(/not configured/i);
    await expect(adapter.healthCheck('http://x')).rejects.toThrow(/not configured/i);
    await expect(adapter.mapDocumentRoot('acct', 'x.com', '/public_html')).rejects.toThrow(/not configured/i);
  });

  test('MockCPanelAdapter: a backup -> upload -> restore cycle provably reverts the simulated live folder\'s contents', async () => {
    const adapter = new MockCPanelAdapter();
    const account = 'mock-account-1';

    await adapter.uploadBuild(account, [{ path: 'index.html', content: '<h1>v1</h1>' }]);
    const { backupId } = await adapter.backupCurrentFolder(account);

    await adapter.uploadBuild(account, [{ path: 'index.html', content: '<h1>v2 (broken)</h1>' }]);

    const restored = await adapter.restoreFromBackup(account, backupId);
    expect(restored.restoredFileCount).toBe(1);

    // Re-upload the exact v1 content and diff against a fresh backup
    // taken immediately after restore, proving the restore genuinely
    // reproduced v1's content rather than just returning a count.
    const { backupId: postRestoreBackupId } = await adapter.backupCurrentFolder(account);
    expect(postRestoreBackupId).not.toBe(backupId);
    const acct = adapter.accounts.get(account);
    expect(acct.liveFolder.get('index.html')).toBe('<h1>v1</h1>');
  });

  test('MockCPanelAdapter.restoreFromBackup rejects an unknown backup id', async () => {
    const adapter = new MockCPanelAdapter();
    await expect(adapter.restoreFromBackup('mock-account-1', 'mock_backup_does-not-exist')).rejects.toThrow(/unknown backup/i);
  });

  test('MockCPanelAdapter.healthCheck defaults to healthy, and setHealthOverride can force an unhealthy result', async () => {
    const adapter = new MockCPanelAdapter();
    const healthy = await adapter.healthCheck('https://example.com');
    expect(healthy.healthy).toBe(true);

    adapter.setHealthOverride('https://example.com', false);
    const unhealthy = await adapter.healthCheck('https://example.com');
    expect(unhealthy.healthy).toBe(false);

    adapter.setHealthOverride('https://example.com', true);
    const healthyAgain = await adapter.healthCheck('https://example.com');
    expect(healthyAgain.healthy).toBe(true);
  });

  test('MockCPanelAdapter.mapDocumentRoot records the mapping per account/domain', async () => {
    const adapter = new MockCPanelAdapter();
    await adapter.mapDocumentRoot('mock-account-1', 'example.com', '/home/mock-account-1/public_html');
    const acct = adapter.accounts.get('mock-account-1');
    expect(acct.documentRoots.get('example.com')).toBe('/home/mock-account-1/public_html');
  });
});

describe('POST /api/v1/projects/:projectId/website/domain/map-document-root', () => {
  test('builder.manage is required', async () => {
    const { agency, project } = await setupProjectWithWebsite();
    const { user, password } = await createRoleAssignedMember(sequelize.models, { organizationId: agency.id, roleKeys: ['developer'] });
    const login = await loginAs(app, user.email, password);
    const res = await auth(login)(request(app).post(`/api/v1/projects/${project.id}/website/domain/map-document-root`).send({ path: '/public_html' }));
    expect(res.status).toBe(403);
  });

  test('404s when no domain has been registered yet', async () => {
    const { project, pmAuth } = await setupProjectWithWebsite();
    const res = await pmAuth(request(app).post(`/api/v1/projects/${project.id}/website/domain/map-document-root`).send({ path: '/public_html' }));
    expect(res.status).toBe(404);
  });

  test('maps a document root via the mock cPanel adapter and persists it on the WebsiteDomain row', async () => {
    const { project, pmAuth } = await setupProjectWithWebsite();
    await pmAuth(request(app).post(`/api/v1/projects/${project.id}/website/domain/register`).send({ domain: 'docroot-test.com' }));

    const res = await pmAuth(request(app).post(`/api/v1/projects/${project.id}/website/domain/map-document-root`).send({ path: '/home/acct/public_html' }));
    expect(res.status).toBe(200);
    expect(res.body.data.domain.documentRootPath).toBe('/home/acct/public_html');
    expect(res.body.data.domain.cpanelAccount).toBeTruthy();

    const getRes = await pmAuth(request(app).get(`/api/v1/projects/${project.id}/website/domain`));
    expect(getRes.body.data.domain.documentRootPath).toBe('/home/acct/public_html');
  });
});
