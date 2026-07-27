'use strict';

const request = require('supertest');
const app = require('../app');
const {
  sequelize, Project, WebsiteVersion,
} = require('../models');
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
    agency, clientOrg, project, developerAuth,
  };
}

describe('Autosave', () => {
  test('builder.edit is required to autosave', async () => {
    const { clientOrg, project } = await setupProjectWithWebsite();
    const { user, password } = await createRoleAssignedMember(sequelize.models, {
      organizationId: clientOrg.id, roleKeys: ['viewer'], membershipType: 'client',
    });
    const login = await loginAs(app, user.email, password);
    const res = await request(app).post(`/api/v1/projects/${project.id}/website/versions/autosave`).set('Authorization', `Bearer ${login.token}`);
    expect(res.status).toBe(403);
  });

  test('an autosave creates an unlabeled, isAutosave:true version and does not consume the pending-review flag', async () => {
    const { project, developerAuth } = await setupProjectWithWebsite();

    const base = await developerAuth(request(app).get(`/api/v1/projects/${project.id}/website`));
    const withForm = structuredClone(base.body.data.website.draftSchema);
    withForm.pages[0].sections.push({
      id: 'form1', componentKey: 'form', content: { fields: [] },
    });
    await developerAuth(request(app).patch(`/api/v1/projects/${project.id}/website/draft`).send({ draftSchema: withForm }));

    const autosave = await developerAuth(request(app).post(`/api/v1/projects/${project.id}/website/versions/autosave`));
    expect(autosave.status).toBe(201);
    expect(autosave.body.data.version.isAutosave).toBe(true);
    expect(autosave.body.data.version.label).toBeNull();
    expect(autosave.body.data.version.status).toBe('draft');

    // The pending-review flag from the form change is still live — a
    // real checkpoint after this autosave still comes out pending_review.
    const checkpoint = await developerAuth(request(app).post(`/api/v1/projects/${project.id}/website/versions`).send({ label: 'Real checkpoint' }));
    expect(checkpoint.body.data.version.status).toBe('pending_review');
  });

  test('only the most recent AUTOSAVE_RETENTION_COUNT autosave versions are kept; named checkpoints are never pruned', async () => {
    const { project, developerAuth } = await setupProjectWithWebsite();

    const namedCheckpoint = await developerAuth(request(app).post(`/api/v1/projects/${project.id}/website/versions`).send({ label: 'Keep me forever' }));

    for (let i = 0; i < 7; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await developerAuth(request(app).post(`/api/v1/projects/${project.id}/website/versions/autosave`));
    }

    const allVersions = await WebsiteVersion.findAll({ where: { websiteId: namedCheckpoint.body.data.version.websiteId }, __visibilityScoped: true });
    const autosaves = allVersions.filter((v) => v.isAutosave);
    expect(autosaves.length).toBe(5);

    const namedStillPresent = allVersions.find((v) => v.id === namedCheckpoint.body.data.version.id);
    expect(namedStillPresent).toBeDefined();
  });
});

describe('Compare', () => {
  test('comparing two versions reports the same classified per-property changes updateDraftSchema itself would authorize against', async () => {
    const { project, developerAuth } = await setupProjectWithWebsite();

    // v1: a hero section already exists (added structurally first, its
    // own checkpoint) so the later heading/layout edit below is a
    // property change on an EXISTING section, not a brand-new one —
    // diffSchemaChanges only walks per-property diffs for sections that
    // existed in both schemas being compared; a brand-new section is
    // reported purely as structuralChange, matching the authorization
    // path exactly (current-phase-plan.md § 2e).
    const base = await developerAuth(request(app).get(`/api/v1/projects/${project.id}/website`));
    const withHero = structuredClone(base.body.data.website.draftSchema);
    withHero.pages[0].sections.push({
      id: 'hero1', componentKey: 'hero', content: { heading: 'Original' }, settings: { layout: 'centered' },
    });
    await developerAuth(request(app).patch(`/api/v1/projects/${project.id}/website/draft`).send({ draftSchema: withHero }));
    const v1 = await developerAuth(request(app).post(`/api/v1/projects/${project.id}/website/versions`).send({ label: 'v1' }));

    const withEditedHero = structuredClone(withHero);
    withEditedHero.pages[0].sections[0].content.heading = 'Edited';
    withEditedHero.pages[0].sections[0].settings.layout = 'full-bleed';
    await developerAuth(request(app).patch(`/api/v1/projects/${project.id}/website/draft`).send({ draftSchema: withEditedHero }));
    const v2 = await developerAuth(request(app).post(`/api/v1/projects/${project.id}/website/versions`).send({ label: 'v2' }));

    const compare = await developerAuth(request(app).get(`/api/v1/projects/${project.id}/website/versions/compare`).query({ from: v1.body.data.version.id, to: v2.body.data.version.id }));
    expect(compare.status).toBe(200);
    expect(compare.body.data.comparison.structuralChange).toBe(false);
    const changedKeys = compare.body.data.comparison.changes.map((c) => c.key);
    expect(changedKeys).toEqual(expect.arrayContaining(['heading', 'layout']));
    const layoutChange = compare.body.data.comparison.changes.find((c) => c.key === 'layout');
    expect(layoutChange.editingLevel).toBe('professional');
  });

  test('from and to query params are required', async () => {
    const { project, developerAuth } = await setupProjectWithWebsite();
    const res = await developerAuth(request(app).get(`/api/v1/projects/${project.id}/website/versions/compare`));
    expect(res.status).toBe(422);
  });

  test('comparing a version the requester cannot see (another user\'s in-progress draft) is a clean 404, not a data leak', async () => {
    const { clientOrg, project, developerAuth } = await setupProjectWithWebsite();
    const v1 = await developerAuth(request(app).post(`/api/v1/projects/${project.id}/website/versions`).send({ label: 'v1' }));
    const v2 = await developerAuth(request(app).post(`/api/v1/projects/${project.id}/website/versions`).send({ label: 'v2' }));

    const { user, password } = await createRoleAssignedMember(sequelize.models, {
      organizationId: clientOrg.id, roleKeys: ['client_owner'], membershipType: 'client',
    });
    const login = await loginAs(app, user.email, password);
    const res = await request(app).get(`/api/v1/projects/${project.id}/website/versions/compare`).set('Authorization', `Bearer ${login.token}`).query({ from: v1.body.data.version.id, to: v2.body.data.version.id });
    expect(res.status).toBe(404);
  });
});
