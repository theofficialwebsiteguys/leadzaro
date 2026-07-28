'use strict';

const request = require('supertest');
const app = require('../app');
const {
  sequelize, Project, WebsitePublicFormSubmission, ClientRequest,
} = require('../models');
const { createOrganization, createRoleAssignedMember, loginAs } = require('./helpers/factory');

afterAll(async () => {
  await sequelize.close();
});

function auth(login) {
  return (r) => r.set('Authorization', `Bearer ${login.token}`);
}

async function setupLiveWebsiteWithForm(domain) {
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
  const withForm = structuredClone(base.body.data.website.draftSchema);
  withForm.pages[0].sections.push({
    id: 'form1',
    componentKey: 'form',
    content: {
      fields: [{
        key: 'email', label: 'Email', type: 'email', required: true,
      }],
      submitTarget: { type: 'client_request', config: {} },
    },
    settings: {},
  });
  await developerAuth(request(app).patch(`/api/v1/projects/${project.id}/website/draft`).send({ draftSchema: withForm }));
  const checkpoint = await developerAuth(request(app).post(`/api/v1/projects/${project.id}/website/versions`).send({ label: 'v1' }));
  const versionId = checkpoint.body.data.version.id;
  const pageId = withForm.pages[0].id;

  const { user: pm, password: pmPassword } = await createRoleAssignedMember(sequelize.models, { organizationId: agency.id, roleKeys: ['project_manager'] });
  const pmAuth = auth(await loginAs(app, pm.email, pmPassword));
  await pmAuth(request(app).post(`/api/v1/projects/${project.id}/website/domain/register`).send({ domain }));
  const deployRes = await pmAuth(request(app).post(`/api/v1/projects/${project.id}/website/versions/${versionId}/deploy-production`));
  expect(deployRes.body.data.deployment.status).toBe('live');

  const websiteRes = await developerAuth(request(app).get(`/api/v1/projects/${project.id}/website`));
  const websiteId = websiteRes.body.data.website.id;

  return {
    agency, clientOrg, project, developerAuth, pmAuth, websiteId, pageId,
  };
}

describe('WebsitePublicFormSubmission visibility guard', () => {
  test('a raw unscoped query throws', async () => {
    await expect(WebsitePublicFormSubmission.findAll()).rejects.toThrow(/must be queried through/i);
  });
});

describe('POST /api/v1/public/websites/:websiteId/submit-form', () => {
  test('a real submission against a live form section creates a pending_review row, with no auth required', async () => {
    const { websiteId, pageId } = await setupLiveWebsiteWithForm('public-submit-live.com');

    const res = await request(app).post(`/api/v1/public/websites/${websiteId}/submit-form`).send({
      pageId, sectionId: 'form1', values: { email: 'visitor@example.com' },
    });
    expect(res.status).toBe(200);
    expect(res.body.data.submitted).toBe(true);

    const rows = await WebsitePublicFormSubmission.findAll({ where: { websiteId }, __visibilityScoped: true });
    expect(rows.length).toBe(1);
    expect(rows[0].status).toBe('pending_review');
    expect(rows[0].values.email).toBe('visitor@example.com');
    expect(rows[0].organizationId).toBeTruthy();
    expect(rows[0].agencyOrganizationId).toBeTruthy();
  });

  test('a filled honeypot field silently discards the submission (same success response, no row created)', async () => {
    const { websiteId, pageId } = await setupLiveWebsiteWithForm('public-submit-honeypot.com');

    const res = await request(app).post(`/api/v1/public/websites/${websiteId}/submit-form`).send({
      pageId, sectionId: 'form1', values: { email: 'bot@example.com' }, website: 'http://spam.example',
    });
    expect(res.status).toBe(200);
    expect(res.body.data.submitted).toBe(true);

    const rows = await WebsitePublicFormSubmission.findAll({ where: { websiteId }, __visibilityScoped: true });
    expect(rows.length).toBe(0);
  });

  test('an unknown websiteId produces a generic 404', async () => {
    const res = await request(app).post('/api/v1/public/websites/00000000-0000-0000-0000-000000000000/submit-form').send({
      pageId: 'page_home', sectionId: 'form1', values: {},
    });
    expect(res.status).toBe(404);
  });

  test('a website that has never had a production deploy produces the SAME generic 404 as a non-existent website (finding #10)', async () => {
    const agency = await createOrganization(sequelize.models, { type: 'agency' });
    const clientOrg = await createOrganization(sequelize.models, { type: 'client', managingAgencyOrganizationId: agency.id });
    const project = await Project.create({
      organizationId: clientOrg.id, agencyOrganizationId: agency.id, stage: 'Design', healthStatus: 'on_track',
    });
    const { user: developer, password: developerPassword } = await createRoleAssignedMember(sequelize.models, { organizationId: agency.id, roleKeys: ['developer'] });
    const developerAuth = auth(await loginAs(app, developer.email, developerPassword));
    await developerAuth(request(app).post(`/api/v1/projects/${project.id}/website`).send({ name: 'Draft only', startingMode: 'blank' }));
    const websiteRes = await developerAuth(request(app).get(`/api/v1/projects/${project.id}/website`));

    const draftOnlyRes = await request(app).post(`/api/v1/public/websites/${websiteRes.body.data.website.id}/submit-form`).send({
      pageId: 'page_home', sectionId: 'form1', values: {},
    });
    const nonExistentRes = await request(app).post('/api/v1/public/websites/00000000-0000-0000-0000-000000000000/submit-form').send({
      pageId: 'page_home', sectionId: 'form1', values: {},
    });
    expect(draftOnlyRes.status).toBe(404);
    expect(draftOnlyRes.body.message).toBe(nonExistentRes.body.message);
  });

  test('a pageId/sectionId that is not a real form section produces a 404', async () => {
    const { websiteId, pageId } = await setupLiveWebsiteWithForm('public-submit-not-a-form.com');
    const res = await request(app).post(`/api/v1/public/websites/${websiteId}/submit-form`).send({
      pageId, sectionId: 'nonexistent-section', values: {},
    });
    expect(res.status).toBe(404);
  });
});

describe('Public form submission triage (employee-side)', () => {
  test('builder.manage is required to list submissions', async () => {
    const { project, developerAuth } = await setupLiveWebsiteWithForm('triage-perm-check.com');
    const res = await developerAuth(request(app).get(`/api/v1/projects/${project.id}/website/public-form-submissions`));
    expect(res.status).toBe(403);
  });

  test('lists pending submissions and converts one into a real, accountable ClientRequest', async () => {
    const {
      project, pmAuth, websiteId, pageId,
    } = await setupLiveWebsiteWithForm('triage-convert.com');

    await request(app).post(`/api/v1/public/websites/${websiteId}/submit-form`).send({
      pageId, sectionId: 'form1', values: { email: 'lead@example.com' },
    });

    const list = await pmAuth(request(app).get(`/api/v1/projects/${project.id}/website/public-form-submissions`));
    expect(list.status).toBe(200);
    expect(list.body.data.submissions.length).toBe(1);
    expect(list.body.data.submissions[0].status).toBe('pending_review');
    const submissionId = list.body.data.submissions[0].id;

    const convertRes = await pmAuth(request(app).post(`/api/v1/projects/${project.id}/website/public-form-submissions/${submissionId}/convert`));
    expect(convertRes.status).toBe(200);
    expect(convertRes.body.data.submission.status).toBe('converted');
    expect(convertRes.body.data.clientRequest.category).toBe('form');

    const clientRequestRow = await ClientRequest.findOne({ where: { id: convertRes.body.data.clientRequest.id }, __visibilityScoped: true });
    expect(clientRequestRow.submittedByUserId).toBeTruthy();
    expect(clientRequestRow.projectId).toBe(project.id);

    const submissionRow = await WebsitePublicFormSubmission.findOne({ where: { id: submissionId }, __visibilityScoped: true });
    expect(submissionRow.convertedToClientRequestId).toBe(clientRequestRow.id);

    // Converting again is rejected — the original anonymous record is
    // never silently re-processed.
    const reconvertRes = await pmAuth(request(app).post(`/api/v1/projects/${project.id}/website/public-form-submissions/${submissionId}/convert`));
    expect(reconvertRes.status).toBe(409);
  });

  test('marking a submission as spam updates its status without creating a ClientRequest', async () => {
    const {
      project, pmAuth, websiteId, pageId,
    } = await setupLiveWebsiteWithForm('triage-spam.com');

    await request(app).post(`/api/v1/public/websites/${websiteId}/submit-form`).send({
      pageId, sectionId: 'form1', values: { email: 'spammer@example.com' },
    });
    const list = await pmAuth(request(app).get(`/api/v1/projects/${project.id}/website/public-form-submissions`));
    const submissionId = list.body.data.submissions[0].id;

    const res = await pmAuth(request(app).post(`/api/v1/projects/${project.id}/website/public-form-submissions/${submissionId}/status`).send({ status: 'spam' }));
    expect(res.status).toBe(200);
    expect(res.body.data.submission.status).toBe('spam');

    const requestCount = await ClientRequest.count({ where: { projectId: project.id }, __visibilityScoped: true });
    expect(requestCount).toBe(0);
  });

  test('cross-agency isolation: an unrelated agency cannot list or triage another agency\'s public form submissions', async () => {
    const { project, websiteId, pageId } = await setupLiveWebsiteWithForm('triage-isolation.com');
    await request(app).post(`/api/v1/public/websites/${websiteId}/submit-form`).send({
      pageId, sectionId: 'form1', values: { email: 'x@example.com' },
    });

    const otherAgency = await createOrganization(sequelize.models, { type: 'agency' });
    const { user, password } = await createRoleAssignedMember(sequelize.models, { organizationId: otherAgency.id, roleKeys: ['project_manager'] });
    const login = await loginAs(app, user.email, password);
    const res = await auth(login)(request(app).get(`/api/v1/projects/${project.id}/website/public-form-submissions`));
    expect(res.status).toBe(404);
  });
});
