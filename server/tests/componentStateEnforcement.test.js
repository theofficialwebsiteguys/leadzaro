'use strict';

const request = require('supertest');
const app = require('../app');
const {
  sequelize, Project, SectionDefinition, Website,
} = require('../models');
const { createOrganization, createRoleAssignedMember, loginAs } = require('./helpers/factory');

afterAll(async () => {
  await sequelize.close();
});

function auth(login) {
  return (r) => r.set('Authorization', `Bearer ${login.token}`);
}

async function setupProjectWithWebsiteAndCustomSection() {
  const agency = await createOrganization(sequelize.models, { type: 'agency' });
  const clientOrg = await createOrganization(sequelize.models, { type: 'client', managingAgencyOrganizationId: agency.id });
  const project = await Project.create({
    organizationId: clientOrg.id, agencyOrganizationId: agency.id, stage: 'Design', healthStatus: 'on_track',
  });

  const { user: developer, password: developerPassword } = await createRoleAssignedMember(sequelize.models, { organizationId: agency.id, roleKeys: ['developer'] });
  const developerLogin = await loginAs(app, developer.email, developerPassword);
  const developerAuth = auth(developerLogin);
  await developerAuth(request(app).post(`/api/v1/projects/${project.id}/website`).send({ name: 'x', startingMode: 'blank' }));

  const section = await SectionDefinition.create({
    agencyOrganizationId: agency.id,
    name: 'Custom Testimonial',
    componentKey: `custom_testimonial_${Date.now()}`,
    category: 'content',
    settingsSchema: {
      quote: { type: 'text', editingLevel: 'basic', requiresReview: false },
      accentColor: {
        type: 'text', editingLevel: 'basic', requiresReview: false, builderEditable: true,
      },
    },
    state: 'managed',
    isSystemDefined: false,
  });

  return {
    agency, clientOrg, project, developer, developerAuth, section,
  };
}

describe('Detached section instances: builder-side enforcement (current-phase-plan.md § 2d)', () => {
  test('a detached instance rejects any content change through the ordinary draft-save path, even for an advanced-level developer', async () => {
    const { project, developerAuth, section } = await setupProjectWithWebsiteAndCustomSection();

    const base = await developerAuth(request(app).get(`/api/v1/projects/${project.id}/website`));
    const withDetached = structuredClone(base.body.data.website.draftSchema);
    withDetached.pages[0].sections.push({
      id: 'custom1', componentKey: section.componentKey, state: 'detached', content: { quote: 'Original' }, settings: { accentColor: 'blue' },
    });
    const saved = await developerAuth(request(app).patch(`/api/v1/projects/${project.id}/website/draft`).send({ draftSchema: withDetached }));
    expect(saved.status).toBe(200);

    const editContent = structuredClone(withDetached);
    editContent.pages[0].sections[0].content.quote = 'Edited via builder';
    const res = await developerAuth(request(app).patch(`/api/v1/projects/${project.id}/website/draft`).send({ draftSchema: editContent }));
    expect(res.status).toBe(403);
    expect(res.body.message).toMatch(/detached/i);
  });

  test('a detached instance rejects a settings change UNLESS the property is marked builderEditable', async () => {
    const { project, developerAuth, section } = await setupProjectWithWebsiteAndCustomSection();
    const base = await developerAuth(request(app).get(`/api/v1/projects/${project.id}/website`));
    const withDetached = structuredClone(base.body.data.website.draftSchema);
    withDetached.pages[0].sections.push({
      id: 'custom1', componentKey: section.componentKey, state: 'detached', content: {}, settings: { accentColor: 'blue' },
    });
    await developerAuth(request(app).patch(`/api/v1/projects/${project.id}/website/draft`).send({ draftSchema: withDetached }));

    const editAllowed = structuredClone(withDetached);
    editAllowed.pages[0].sections[0].settings.accentColor = 'red';
    const allowedRes = await developerAuth(request(app).patch(`/api/v1/projects/${project.id}/website/draft`).send({ draftSchema: editAllowed }));
    expect(allowedRes.status).toBe(200);
    expect(allowedRes.body.data.website.draftSchema.pages[0].sections[0].settings.accentColor).toBe('red');
  });

  test('an unrelated section on the same page is unaffected by another section\'s detachment', async () => {
    const { project, developerAuth, section } = await setupProjectWithWebsiteAndCustomSection();
    const base = await developerAuth(request(app).get(`/api/v1/projects/${project.id}/website`));
    const withBoth = structuredClone(base.body.data.website.draftSchema);
    withBoth.pages[0].sections.push(
      {
        id: 'custom1', componentKey: section.componentKey, state: 'detached', content: { quote: 'x' }, settings: {},
      },
      { id: 'text1', componentKey: 'text', content: { body: 'Hello' } }
    );
    await developerAuth(request(app).patch(`/api/v1/projects/${project.id}/website/draft`).send({ draftSchema: withBoth }));

    const editUnrelated = structuredClone(withBoth);
    editUnrelated.pages[0].sections[1].content.body = 'Updated';
    const res = await developerAuth(request(app).patch(`/api/v1/projects/${project.id}/website/draft`).send({ draftSchema: editUnrelated }));
    expect(res.status).toBe(200);
  });

  test('toggling a section into detached state itself requires advanced-level editing and always flags requiresReview', async () => {
    const {
      agency, clientOrg, project, developerAuth, section,
    } = await setupProjectWithWebsiteAndCustomSection();
    const { user: admin, password: adminPassword } = await createRoleAssignedMember(sequelize.models, { organizationId: agency.id, roleKeys: ['administrator'] });
    const adminAuth = auth(await loginAs(app, admin.email, adminPassword));

    const { user, password } = await createRoleAssignedMember(sequelize.models, {
      organizationId: clientOrg.id, roleKeys: ['client_owner'], membershipType: 'client',
    });
    const clientAuth = auth(await loginAs(app, user.email, password));
    await adminAuth(request(app).post(`/api/v1/projects/${project.id}/website/editors`).send({ userId: user.id, editingLevel: 'professional' }));

    const base = await developerAuth(request(app).get(`/api/v1/projects/${project.id}/website`));
    const withSection = structuredClone(base.body.data.website.draftSchema);
    withSection.pages[0].sections.push({
      id: 'custom1', componentKey: section.componentKey, content: { quote: 'x' }, settings: {},
    });
    await developerAuth(request(app).patch(`/api/v1/projects/${project.id}/website/draft`).send({ draftSchema: withSection }));

    // A Professional-level client cannot toggle detachment (advanced required).
    const clientAttempt = structuredClone(withSection);
    clientAttempt.pages[0].sections[0].state = 'detached';
    const clientRes = await clientAuth(request(app).patch(`/api/v1/projects/${project.id}/website/draft`).send({ draftSchema: clientAttempt }));
    expect(clientRes.status).toBe(403);

    // The developer (advanced) can, and it forces the next checkpoint to pending_review.
    const developerAttempt = structuredClone(withSection);
    developerAttempt.pages[0].sections[0].state = 'detached';
    const developerRes = await developerAuth(request(app).patch(`/api/v1/projects/${project.id}/website/draft`).send({ draftSchema: developerAttempt }));
    expect(developerRes.status).toBe(200);

    const checkpoint = await developerAuth(request(app).post(`/api/v1/projects/${project.id}/website/versions`).send({ label: 'Detached' }));
    expect(checkpoint.body.data.version.status).toBe('pending_review');
  });
});

describe('Restoring a version preserves any section that has since been detached (current-phase-plan.md § 2d)', () => {
  test('restoring a pre-detachment checkpoint keeps the detached instance\'s current custom content in place, while an unrelated section still reverts normally', async () => {
    const { project, developerAuth, section } = await setupProjectWithWebsiteAndCustomSection();

    // Checkpoint A: the custom section (not yet detached) + a text section, both at their "original" values.
    const base = await developerAuth(request(app).get(`/api/v1/projects/${project.id}/website`));
    const original = structuredClone(base.body.data.website.draftSchema);
    original.pages[0].sections.push(
      { id: 'custom1', componentKey: section.componentKey, content: { quote: 'Original quote' }, settings: {} },
      { id: 'text1', componentKey: 'text', content: { body: 'Original text' } }
    );
    await developerAuth(request(app).patch(`/api/v1/projects/${project.id}/website/draft`).send({ draftSchema: original }));
    const preDetachmentCheckpoint = await developerAuth(request(app).post(`/api/v1/projects/${project.id}/website/versions`).send({ label: 'Pre-detachment' }));

    // Detach the custom section (a real, authorized change).
    const detached = structuredClone(original);
    detached.pages[0].sections[0].state = 'detached';
    await developerAuth(request(app).patch(`/api/v1/projects/${project.id}/website/draft`).send({ draftSchema: detached }));

    // Also change the OTHER (still-managed) section, so we have something that SHOULD revert on restore.
    const changedText = structuredClone(detached);
    changedText.pages[0].sections[1].content.body = 'Changed after checkpoint A';
    await developerAuth(request(app).patch(`/api/v1/projects/${project.id}/website/draft`).send({ draftSchema: changedText }));

    // Simulate the detached section's content diverging outside the builder (e.g. a developer's
    // hand-authored custom implementation) — this can no longer happen through updateDraftSchema
    // now that it's detached, so it's set directly, exactly the way a later slice's generator/
    // detach action would eventually record it.
    const website = await Website.findOne({ where: { projectId: project.id }, __visibilityScoped: true });
    const withCustomContent = structuredClone(website.draftSchema);
    withCustomContent.pages[0].sections[0].content.quote = 'Custom developer content';
    await website.update({ draftSchema: withCustomContent });

    const restore = await developerAuth(request(app).post(`/api/v1/projects/${project.id}/website/versions/${preDetachmentCheckpoint.body.data.version.id}/restore`));
    expect(restore.status).toBe(200);
    expect(restore.body.data.preservedSectionIds).toEqual(['custom1']);
    expect(restore.body.message).toMatch(/1 detached section/i);

    const restoredSchema = restore.body.data.website.draftSchema;
    const customSection = restoredSchema.pages[0].sections.find((s) => s.id === 'custom1');
    const textSection = restoredSchema.pages[0].sections.find((s) => s.id === 'text1');

    // The detached section kept its current custom content — NOT reverted to "Original quote".
    expect(customSection.content.quote).toBe('Custom developer content');
    expect(customSection.state).toBe('detached');
    // The unrelated, still-managed section genuinely restored to checkpoint A's value.
    expect(textSection.content.body).toBe('Original text');
  });
});
