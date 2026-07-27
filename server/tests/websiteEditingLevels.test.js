'use strict';

const request = require('supertest');
const app = require('../app');
const { sequelize, Project, Website } = require('../models');
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

describe('Per-property editing-level enforcement', () => {
  test('a client_owner with builder.edit but no WebsiteEditorAssignment cannot save any draft change at all', async () => {
    const { clientOrg, project } = await setupProjectWithWebsite();
    const { user, password } = await createRoleAssignedMember(sequelize.models, {
      organizationId: clientOrg.id, roleKeys: ['client_owner'], membershipType: 'client',
    });
    const login = await loginAs(app, user.email, password);
    const clientAuth = auth(login);

    const current = await clientAuth(request(app).get(`/api/v1/projects/${project.id}/website`));
    const newSchema = structuredClone(current.body.data.website.draftSchema);
    newSchema.pages[0].sections.push({
      id: 's1', componentKey: 'text', content: { body: 'Hello' },
    });

    const res = await clientAuth(request(app).patch(`/api/v1/projects/${project.id}/website/draft`).send({ draftSchema: newSchema }));
    expect(res.status).toBe(403);
  });

  test('a Basic-assigned client can change a Basic-tier property but not a Professional-tier property on the SAME section — the per-property, not per-section, fix', async () => {
    const {
      agency, clientOrg, project, developerAuth,
    } = await setupProjectWithWebsite();
    const { user, password } = await createRoleAssignedMember(sequelize.models, {
      organizationId: clientOrg.id, roleKeys: ['client_owner'], membershipType: 'client',
    });
    const login = await loginAs(app, user.email, password);
    const clientAuth = auth(login);

    const { user: admin, password: adminPassword } = await createRoleAssignedMember(sequelize.models, { organizationId: agency.id, roleKeys: ['administrator'] });
    const adminLogin = await loginAs(app, admin.email, adminPassword);
    const adminAuth = auth(adminLogin);
    await adminAuth(request(app).post(`/api/v1/projects/${project.id}/website/editors`).send({ userId: user.id, editingLevel: 'basic' }));

    // First, an employee (advanced) adds a hero section for the client to edit.
    const base = await developerAuth(request(app).get(`/api/v1/projects/${project.id}/website`));
    const withHero = structuredClone(base.body.data.website.draftSchema);
    withHero.pages[0].sections.push({
      id: 'hero1', componentKey: 'hero', content: { heading: 'Original heading' }, settings: { layout: 'centered' },
    });
    await developerAuth(request(app).patch(`/api/v1/projects/${project.id}/website/draft`).send({ draftSchema: withHero }));

    // The Basic-assigned client changes the Basic-tier "heading" content field — allowed.
    const basicChange = structuredClone(withHero);
    basicChange.pages[0].sections[0].content.heading = 'Client-edited heading';
    const basicRes = await clientAuth(request(app).patch(`/api/v1/projects/${project.id}/website/draft`).send({ draftSchema: basicChange }));
    expect(basicRes.status).toBe(200);
    expect(basicRes.body.data.website.draftSchema.pages[0].sections[0].content.heading).toBe('Client-edited heading');

    // The same Basic-assigned client tries to change the Professional-tier "layout" setting on the SAME section — rejected.
    const professionalChange = structuredClone(basicChange);
    professionalChange.pages[0].sections[0].settings.layout = 'full-bleed';
    const professionalRes = await clientAuth(request(app).patch(`/api/v1/projects/${project.id}/website/draft`).send({ draftSchema: professionalChange }));
    expect(professionalRes.status).toBe(403);
  });

  test('an unrecognized property key (not in the section\'s settingsSchema) defaults to advanced + requiresReview — safe by default', async () => {
    const {
      agency, clientOrg, project, developerAuth,
    } = await setupProjectWithWebsite();
    const { user, password } = await createRoleAssignedMember(sequelize.models, {
      organizationId: clientOrg.id, roleKeys: ['client_owner'], membershipType: 'client',
    });
    const login = await loginAs(app, user.email, password);
    const clientAuth = auth(login);
    const { user: admin, password: adminPassword } = await createRoleAssignedMember(sequelize.models, { organizationId: agency.id, roleKeys: ['administrator'] });
    const adminLogin = await loginAs(app, admin.email, adminPassword);
    await auth(adminLogin)(request(app).post(`/api/v1/projects/${project.id}/website/editors`).send({ userId: user.id, editingLevel: 'professional' }));

    const base = await developerAuth(request(app).get(`/api/v1/projects/${project.id}/website`));
    const withHero = structuredClone(base.body.data.website.draftSchema);
    withHero.pages[0].sections.push({ id: 'hero1', componentKey: 'hero', content: {} });
    await developerAuth(request(app).patch(`/api/v1/projects/${project.id}/website/draft`).send({ draftSchema: withHero }));

    const withUnknownKey = structuredClone(withHero);
    withUnknownKey.pages[0].sections[0].content.someUntrackedField = 'anything';
    const res = await clientAuth(request(app).patch(`/api/v1/projects/${project.id}/website/draft`).send({ draftSchema: withUnknownKey }));
    expect(res.status).toBe(403);
  });

  test('a structural change (adding a page) requires at least Professional even if every individual property would otherwise be Basic', async () => {
    const { agency, clientOrg, project } = await setupProjectWithWebsite();
    const { user, password } = await createRoleAssignedMember(sequelize.models, {
      organizationId: clientOrg.id, roleKeys: ['client_owner'], membershipType: 'client',
    });
    const login = await loginAs(app, user.email, password);
    const clientAuth = auth(login);

    const { user: admin, password: adminPassword } = await createRoleAssignedMember(sequelize.models, { organizationId: agency.id, roleKeys: ['administrator'] });
    const adminLogin = await loginAs(app, admin.email, adminPassword);
    await auth(adminLogin)(request(app).post(`/api/v1/projects/${project.id}/website/editors`).send({ userId: user.id, editingLevel: 'basic' }));

    const current = await clientAuth(request(app).get(`/api/v1/projects/${project.id}/website`));
    const withNewPage = structuredClone(current.body.data.website.draftSchema);
    withNewPage.pages.push({
      id: 'page_contact', route: '/contact', title: 'Contact', sections: [],
    });

    const res = await clientAuth(request(app).patch(`/api/v1/projects/${project.id}/website/draft`).send({ draftSchema: withNewPage }));
    expect(res.status).toBe(403);
  });
});

describe('requiresReview -> checkpoint status, and publish', () => {
  test('a checkpoint created after a requiresReview-flagged change is pending_review; a checkpoint with no such change is draft', async () => {
    const { project, developerAuth } = await setupProjectWithWebsite();

    const noReviewCheckpoint = await developerAuth(request(app).post(`/api/v1/projects/${project.id}/website/versions`).send({ label: 'No review needed' }));
    expect(noReviewCheckpoint.status).toBe(201);
    expect(noReviewCheckpoint.body.data.version.status).toBe('draft');

    const base = await developerAuth(request(app).get(`/api/v1/projects/${project.id}/website`));
    const withForm = structuredClone(base.body.data.website.draftSchema);
    withForm.pages[0].sections.push({
      id: 'form1', componentKey: 'form', content: { fields: [{ key: 'email', label: 'Email', type: 'email' }] },
    });
    const saved = await developerAuth(request(app).patch(`/api/v1/projects/${project.id}/website/draft`).send({ draftSchema: withForm }));
    expect(saved.status).toBe(200);

    const reviewCheckpoint = await developerAuth(request(app).post(`/api/v1/projects/${project.id}/website/versions`).send({ label: 'Added a form' }));
    expect(reviewCheckpoint.status).toBe(201);
    expect(reviewCheckpoint.body.data.version.status).toBe('pending_review');

    // The flag is consumed by the checkpoint — the next one, with no new changes, is draft again.
    const followUpCheckpoint = await developerAuth(request(app).post(`/api/v1/projects/${project.id}/website/versions`).send({ label: 'Follow-up, nothing new' }));
    expect(followUpCheckpoint.body.data.version.status).toBe('draft');
  });

  test('builder.publish is required to publish; a designer (builder.edit only) cannot', async () => {
    const { agency, project, developerAuth } = await setupProjectWithWebsite();
    const checkpoint = await developerAuth(request(app).post(`/api/v1/projects/${project.id}/website/versions`).send({ label: 'x' }));

    const { user: designer, password } = await createRoleAssignedMember(sequelize.models, { organizationId: agency.id, roleKeys: ['designer'] });
    const login = await loginAs(app, designer.email, password);
    const res = await auth(login)(request(app).post(`/api/v1/projects/${project.id}/website/versions/${checkpoint.body.data.version.id}/publish`));
    expect(res.status).toBe(403);
  });

  test('an administrator can publish a version, which sets the website\'s currentPublishedVersionId; publishing twice is rejected', async () => {
    const { agency, project, developerAuth } = await setupProjectWithWebsite();
    const checkpoint = await developerAuth(request(app).post(`/api/v1/projects/${project.id}/website/versions`).send({ label: 'x' }));

    const { user: admin, password } = await createRoleAssignedMember(sequelize.models, { organizationId: agency.id, roleKeys: ['administrator'] });
    const login = await loginAs(app, admin.email, password);
    const adminAuth = auth(login);

    const published = await adminAuth(request(app).post(`/api/v1/projects/${project.id}/website/versions/${checkpoint.body.data.version.id}/publish`));
    expect(published.status).toBe(200);
    expect(published.body.data.version.status).toBe('published');

    const website = await Website.findOne({ where: { projectId: project.id }, __visibilityScoped: true });
    expect(website.currentPublishedVersionId).toBe(checkpoint.body.data.version.id);

    const again = await adminAuth(request(app).post(`/api/v1/projects/${project.id}/website/versions/${checkpoint.body.data.version.id}/publish`));
    expect(again.status).toBe(422);
  });
});

describe('Restoring a version also goes through per-property enforcement', () => {
  test('a Basic-assigned client cannot restore a published version containing Professional-tier content — restoring is a schema change like any other', async () => {
    const {
      agency, clientOrg, project, developerAuth,
    } = await setupProjectWithWebsite();

    const base = await developerAuth(request(app).get(`/api/v1/projects/${project.id}/website`));
    const withProfessionalContent = structuredClone(base.body.data.website.draftSchema);
    withProfessionalContent.pages[0].sections.push({
      id: 'hero1', componentKey: 'hero', settings: { layout: 'full-bleed' },
    });
    await developerAuth(request(app).patch(`/api/v1/projects/${project.id}/website/draft`).send({ draftSchema: withProfessionalContent }));
    const professionalCheckpoint = await developerAuth(request(app).post(`/api/v1/projects/${project.id}/website/versions`).send({ label: 'Professional layout' }));

    const { user: admin, password: adminPassword } = await createRoleAssignedMember(sequelize.models, { organizationId: agency.id, roleKeys: ['administrator'] });
    const adminLogin = await loginAs(app, admin.email, adminPassword);
    const adminAuth = auth(adminLogin);
    // Published, so it's visible to a client too (the WebsiteVersion
    // client-visibility split from slice 1) — this test is specifically
    // about the per-property enforcement on restore, not about
    // visibility blocking the attempt before enforcement is even reached.
    await adminAuth(request(app).post(`/api/v1/projects/${project.id}/website/versions/${professionalCheckpoint.body.data.version.id}/publish`));

    // Revert the draft back to blank so the restore below is a real change again.
    await developerAuth(request(app).patch(`/api/v1/projects/${project.id}/website/draft`).send({ draftSchema: base.body.data.website.draftSchema }));

    const { user, password } = await createRoleAssignedMember(sequelize.models, {
      organizationId: clientOrg.id, roleKeys: ['client_owner'], membershipType: 'client',
    });
    const login = await loginAs(app, user.email, password);
    const clientAuth = auth(login);
    await adminAuth(request(app).post(`/api/v1/projects/${project.id}/website/editors`).send({ userId: user.id, editingLevel: 'basic' }));

    const restoreAttempt = await clientAuth(request(app).post(`/api/v1/projects/${project.id}/website/versions/${professionalCheckpoint.body.data.version.id}/restore`));
    expect(restoreAttempt.status).toBe(403);
  });
});
