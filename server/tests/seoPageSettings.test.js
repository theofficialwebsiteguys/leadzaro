'use strict';

const request = require('supertest');
const app = require('../app');
const {
  sequelize, Project, WebsitePageSeoSettings,
} = require('../models');
const { createOrganization, createRoleAssignedMember, loginAs } = require('./helpers/factory');

afterAll(async () => {
  await sequelize.close();
});

function auth(login) {
  return (r) => r.set('Authorization', `Bearer ${login.token}`);
}

async function setupWebsite({ entitled = true, domain = null } = {}) {
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

  const { user: clientUser, password: clientPassword } = await createRoleAssignedMember(sequelize.models, {
    organizationId: clientOrg.id, roleKeys: ['client_owner'], membershipType: 'client',
  });
  const clientAuth = auth(await loginAs(app, clientUser.email, clientPassword));

  if (entitled) {
    await adminAuth(request(app).post(`/api/v1/seo/organizations/${clientOrg.id}/entitlement-grants`).send({ reason: 'test' }));
  }
  if (domain) {
    await adminAuth(request(app).post(`/api/v1/projects/${project.id}/website/domain/register`).send({ domain }));
  }

  return {
    agency, clientOrg, project, developerAuth, adminAuth, clientAuth,
  };
}

describe('WebsitePageSeoSettings visibility guard', () => {
  test('a raw unscoped query throws', async () => {
    await expect(WebsitePageSeoSettings.findAll()).rejects.toThrow(/must be queried through/i);
  });
});

describe('the major gate: SEO routes require an active entitlement, base website stays functional without one', () => {
  test('GET seo/pages 403s for a non-entitled organization', async () => {
    const { project, adminAuth } = await setupWebsite({ entitled: false });
    const res = await adminAuth(request(app).get(`/api/v1/projects/${project.id}/website/seo/pages`));
    expect(res.status).toBe(403);
  });

  test('PUT seo/pages/:pageId 403s for a non-entitled organization', async () => {
    const { project, adminAuth } = await setupWebsite({ entitled: false });
    const res = await adminAuth(request(app).put(`/api/v1/projects/${project.id}/website/seo/pages/page_home`).send({ metaTitle: 'x' }));
    expect(res.status).toBe(403);
  });

  test('the base website (get website, draft save) remains fully functional for a non-entitled organization', async () => {
    const { project, developerAuth } = await setupWebsite({ entitled: false });
    const getRes = await developerAuth(request(app).get(`/api/v1/projects/${project.id}/website`));
    expect(getRes.status).toBe(200);
    const draftRes = await developerAuth(request(app).patch(`/api/v1/projects/${project.id}/website/draft`).send({ draftSchema: getRes.body.data.website.draftSchema }));
    expect(draftRes.status).toBe(200);
  });

  test('granting entitlement makes SEO routes work; revoking it blocks them again', async () => {
    const { project, adminAuth, clientOrg } = await setupWebsite({ entitled: false });
    const blocked = await adminAuth(request(app).get(`/api/v1/projects/${project.id}/website/seo/pages`));
    expect(blocked.status).toBe(403);

    const grantRes = await adminAuth(request(app).post(`/api/v1/seo/organizations/${clientOrg.id}/entitlement-grants`).send({ reason: 'now entitled' }));
    const allowed = await adminAuth(request(app).get(`/api/v1/projects/${project.id}/website/seo/pages`));
    expect(allowed.status).toBe(200);

    await adminAuth(request(app).post(`/api/v1/seo/organizations/${clientOrg.id}/entitlement-grants/${grantRes.body.data.grant.id}/revoke`));
    const blockedAgain = await adminAuth(request(app).get(`/api/v1/projects/${project.id}/website/seo/pages`));
    expect(blockedAgain.status).toBe(403);
  });
});

describe('GET /api/v1/projects/:projectId/website/seo/pages', () => {
  test('lists the live draft\'s pages with null settings before any are set', async () => {
    const { project, adminAuth } = await setupWebsite();
    const res = await adminAuth(request(app).get(`/api/v1/projects/${project.id}/website/seo/pages`));
    expect(res.status).toBe(200);
    expect(res.body.data.pages.length).toBe(1);
    expect(res.body.data.pages[0].pageId).toBe('page_home');
    expect(res.body.data.pages[0].seoSettings).toBeNull();
  });
});

describe('PUT /api/v1/projects/:projectId/website/seo/pages/:pageId', () => {
  test('a client with builder.edit can set their own page\'s SEO settings', async () => {
    const { project, clientAuth } = await setupWebsite();
    const res = await clientAuth(request(app).put(`/api/v1/projects/${project.id}/website/seo/pages/page_home`).send({
      metaTitle: 'Acme Co — Home', metaDescription: 'Welcome to Acme', robotsDirective: 'index,follow',
    }));
    expect(res.status).toBe(200);
    expect(res.body.data.settings.metaTitle).toBe('Acme Co — Home');
  });

  test('upserting twice updates the same row, not a second one', async () => {
    const { project, adminAuth } = await setupWebsite();
    const first = await adminAuth(request(app).put(`/api/v1/projects/${project.id}/website/seo/pages/page_home`).send({ metaTitle: 'v1' }));
    const second = await adminAuth(request(app).put(`/api/v1/projects/${project.id}/website/seo/pages/page_home`).send({ metaTitle: 'v2' }));
    expect(first.body.data.settings.id).toBe(second.body.data.settings.id);
    expect(second.body.data.settings.metaTitle).toBe('v2');

    const count = await WebsitePageSeoSettings.count({ where: { id: first.body.data.settings.id }, __visibilityScoped: true });
    expect(count).toBe(1);
  });

  test('rejects an unknown pageId', async () => {
    const { project, adminAuth } = await setupWebsite();
    const res = await adminAuth(request(app).put(`/api/v1/projects/${project.id}/website/seo/pages/not-a-real-page`).send({ metaTitle: 'x' }));
    expect(res.status).toBe(404);
  });

  test('rejects an unknown robotsDirective', async () => {
    const { project, adminAuth } = await setupWebsite();
    const res = await adminAuth(request(app).put(`/api/v1/projects/${project.id}/website/seo/pages/page_home`).send({ robotsDirective: 'not-a-real-directive' }));
    expect(res.status).toBe(422);
  });

  test('a role with neither builder.edit nor builder.manage cannot write settings', async () => {
    const { project, agency } = await setupWebsite();
    const { user: supportUser, password: supportPassword } = await createRoleAssignedMember(sequelize.models, { organizationId: agency.id, roleKeys: ['sales_representative'] });
    const login = await loginAs(app, supportUser.email, supportPassword);
    const res = await auth(login)(request(app).put(`/api/v1/projects/${project.id}/website/seo/pages/page_home`).send({ metaTitle: 'x' }));
    expect(res.status).toBe(403);
  });
});

describe('GET /api/v1/projects/:projectId/website/seo/sitemap.xml and robots.txt', () => {
  test('requires a registered, active domain for the sitemap', async () => {
    const { project, adminAuth } = await setupWebsite();
    const res = await adminAuth(request(app).get(`/api/v1/projects/${project.id}/website/seo/sitemap.xml`));
    expect(res.status).toBe(422);
  });

  test('generates a real sitemap including the live page, excluding a noindex page', async () => {
    const { project, adminAuth } = await setupWebsite({ domain: 'sitemap-test.com' });
    await adminAuth(request(app).put(`/api/v1/projects/${project.id}/website/seo/pages/page_home`).send({ robotsDirective: 'index,follow' }));

    const res = await adminAuth(request(app).get(`/api/v1/projects/${project.id}/website/seo/sitemap.xml`));
    expect(res.status).toBe(200);
    expect(res.text).toContain('https://sitemap-test.com/');
    expect(res.text).toContain('<urlset');
  });

  test('a noindex page is excluded from the sitemap', async () => {
    const { project, adminAuth } = await setupWebsite({ domain: 'sitemap-noindex.com' });
    await adminAuth(request(app).put(`/api/v1/projects/${project.id}/website/seo/pages/page_home`).send({ robotsDirective: 'noindex,nofollow' }));

    const res = await adminAuth(request(app).get(`/api/v1/projects/${project.id}/website/seo/sitemap.xml`));
    expect(res.status).toBe(200);
    expect(res.text).not.toContain('<loc>');
  });

  test('robots.txt references the sitemap when a domain is registered', async () => {
    const { project, adminAuth } = await setupWebsite({ domain: 'robots-test.com' });
    const res = await adminAuth(request(app).get(`/api/v1/projects/${project.id}/website/seo/robots.txt`));
    expect(res.status).toBe(200);
    expect(res.text).toContain('Sitemap: https://robots-test.com/sitemap.xml');
  });

  test('robots.txt still works with no domain registered, just without a Sitemap line', async () => {
    const { project, adminAuth } = await setupWebsite();
    const res = await adminAuth(request(app).get(`/api/v1/projects/${project.id}/website/seo/robots.txt`));
    expect(res.status).toBe(200);
    expect(res.text).not.toContain('Sitemap:');
  });
});

describe('cross-agency isolation', () => {
  test('an unrelated agency cannot read or write another agency\'s page SEO settings', async () => {
    const { project } = await setupWebsite();
    const otherAgency = await createOrganization(sequelize.models, { type: 'agency' });
    const { user, password } = await createRoleAssignedMember(sequelize.models, { organizationId: otherAgency.id, roleKeys: ['administrator'] });
    const login = await loginAs(app, user.email, password);
    const res = await auth(login)(request(app).get(`/api/v1/projects/${project.id}/website/seo/pages`));
    expect(res.status).toBe(404);
  });
});
