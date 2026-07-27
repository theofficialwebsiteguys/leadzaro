'use strict';

const request = require('supertest');
const app = require('../app');
const {
  sequelize, Project, SectionDefinition, DesignSystem,
} = require('../models');
const { createOrganization, createRoleAssignedMember, loginAs } = require('./helpers/factory');

afterAll(async () => {
  await sequelize.close();
});

function auth(login) {
  return (r) => r.set('Authorization', `Bearer ${login.token}`);
}

async function setupAgencyWithProject() {
  const agency = await createOrganization(sequelize.models, { type: 'agency' });
  const clientOrg = await createOrganization(sequelize.models, { type: 'client', managingAgencyOrganizationId: agency.id });
  const project = await Project.create({
    organizationId: clientOrg.id, agencyOrganizationId: agency.id, stage: 'Design', healthStatus: 'on_track',
  });
  return { agency, clientOrg, project };
}

async function loginAsRole(organizationId, roleKeys, membershipType) {
  const { user, password } = await createRoleAssignedMember(sequelize.models, { organizationId, roleKeys, membershipType });
  return loginAs(app, user.email, password);
}

describe('SectionDefinition library governance', () => {
  test('builder.manage is required to create; builder.edit alone is not enough', async () => {
    const { agency } = await setupAgencyWithProject();
    const login = await loginAsRole(agency.id, ['designer']); // builder.edit only
    const res = await auth(login)(request(app).post('/api/v1/section-definitions').send({
      name: 'Testimonial', componentKey: 'testimonial', category: 'content',
    }));
    expect(res.status).toBe(403);
  });

  test('a new section is created as draft, invisible to the browse list, until published; deprecating removes it from the browse list again', async () => {
    const { agency } = await setupAgencyWithProject();
    const login = await loginAsRole(agency.id, ['administrator']);

    const created = await auth(login)(request(app).post('/api/v1/section-definitions').send({
      name: 'Testimonial', componentKey: 'testimonial_gov', category: 'content',
    }));
    expect(created.status).toBe(201);
    expect(created.body.data.sectionDefinition.status).toBe('draft');

    const browseBeforePublish = await auth(login)(request(app).get('/api/v1/section-definitions'));
    expect(browseBeforePublish.body.data.sectionDefinitions.map((s) => s.id)).not.toContain(created.body.data.sectionDefinition.id);

    const published = await auth(login)(request(app).post(`/api/v1/section-definitions/${created.body.data.sectionDefinition.id}/publish`));
    expect(published.status).toBe(200);
    expect(published.body.data.sectionDefinition.status).toBe('published');

    const browseAfterPublish = await auth(login)(request(app).get('/api/v1/section-definitions'));
    expect(browseAfterPublish.body.data.sectionDefinitions.map((s) => s.id)).toContain(created.body.data.sectionDefinition.id);

    const deprecated = await auth(login)(request(app).post(`/api/v1/section-definitions/${created.body.data.sectionDefinition.id}/deprecate`));
    expect(deprecated.status).toBe(200);
    expect(deprecated.body.data.sectionDefinition.status).toBe('deprecated');

    const browseAfterDeprecate = await auth(login)(request(app).get('/api/v1/section-definitions'));
    expect(browseAfterDeprecate.body.data.sectionDefinitions.map((s) => s.id)).not.toContain(created.body.data.sectionDefinition.id);
  });

  test('the governance manage list shows an agency only its own rows, in every status, never another agency\'s or a system row it cannot edit', async () => {
    const { agency: agencyA } = await setupAgencyWithProject();
    const { agency: agencyB } = await setupAgencyWithProject();
    const loginA = await loginAsRole(agencyA.id, ['administrator']);
    const loginB = await loginAsRole(agencyB.id, ['administrator']);

    const createdA = await auth(loginA)(request(app).post('/api/v1/section-definitions').send({
      name: 'A Section', componentKey: 'gov_a', category: 'content',
    }));
    const createdB = await auth(loginB)(request(app).post('/api/v1/section-definitions').send({
      name: 'B Section', componentKey: 'gov_b', category: 'content',
    }));

    const manageA = await auth(loginA)(request(app).get('/api/v1/section-definitions/manage'));
    expect(manageA.status).toBe(200);
    const idsA = manageA.body.data.sectionDefinitions.map((s) => s.id);
    expect(idsA).toContain(createdA.body.data.sectionDefinition.id);
    expect(idsA).not.toContain(createdB.body.data.sectionDefinition.id);
    // No system-defined (agencyOrganizationId: null) row appears in a governance list —
    // those are migration-seeded only, never editable through this API.
    const systemRowsInManage = manageA.body.data.sectionDefinitions.filter((s) => s.isSystemDefined);
    expect(systemRowsInManage.length).toBe(0);
  });

  test('an agency cannot publish or deprecate another agency\'s section, or a system-defined one', async () => {
    const { agency: agencyA } = await setupAgencyWithProject();
    const { agency: agencyB } = await setupAgencyWithProject();
    const loginA = await loginAsRole(agencyA.id, ['administrator']);
    const loginB = await loginAsRole(agencyB.id, ['administrator']);

    const createdB = await auth(loginB)(request(app).post('/api/v1/section-definitions').send({
      name: 'B Section', componentKey: 'gov_cross', category: 'content',
    }));

    const crossAgencyPublish = await auth(loginA)(request(app).post(`/api/v1/section-definitions/${createdB.body.data.sectionDefinition.id}/publish`));
    expect(crossAgencyPublish.status).toBe(404);

    const systemSection = await SectionDefinition.findOne({ where: { componentKey: 'hero' }, __visibilityScoped: true });
    const systemPublish = await auth(loginA)(request(app).post(`/api/v1/section-definitions/${systemSection.id}/deprecate`));
    expect(systemPublish.status).toBe(404);
  });
});

describe('DesignSystem library template governance', () => {
  test('a new template is draft/invisible until published, and disappears again once deprecated', async () => {
    const { agency } = await setupAgencyWithProject();
    const login = await loginAsRole(agency.id, ['administrator']);

    const created = await auth(login)(request(app).post('/api/v1/design-system-templates').send({
      name: 'Agency House Style', tokens: { colors: { primary: '#111111' } },
    }));
    expect(created.status).toBe(201);
    expect(created.body.data.designSystemTemplate.status).toBe('draft');

    const browseBeforePublish = await auth(login)(request(app).get('/api/v1/design-system-templates'));
    expect(browseBeforePublish.body.data.designSystemTemplates.map((d) => d.id)).not.toContain(created.body.data.designSystemTemplate.id);

    const published = await auth(login)(request(app).post(`/api/v1/design-system-templates/${created.body.data.designSystemTemplate.id}/publish`));
    expect(published.status).toBe(200);

    const browseAfterPublish = await auth(login)(request(app).get('/api/v1/design-system-templates'));
    expect(browseAfterPublish.body.data.designSystemTemplates.map((d) => d.id)).toContain(created.body.data.designSystemTemplate.id);

    const deprecated = await auth(login)(request(app).post(`/api/v1/design-system-templates/${created.body.data.designSystemTemplate.id}/deprecate`));
    expect(deprecated.status).toBe(200);
    const browseAfterDeprecate = await auth(login)(request(app).get('/api/v1/design-system-templates'));
    expect(browseAfterDeprecate.body.data.designSystemTemplates.map((d) => d.id)).not.toContain(created.body.data.designSystemTemplate.id);
  });

  test('a client never sees any design system template in the browse list, even with builder.edit, even after one is published', async () => {
    const { agency, clientOrg } = await setupAgencyWithProject();
    const adminLogin = await loginAsRole(agency.id, ['administrator']);
    const created = await auth(adminLogin)(request(app).post('/api/v1/design-system-templates').send({ name: 'Client-Invisible Template' }));
    await auth(adminLogin)(request(app).post(`/api/v1/design-system-templates/${created.body.data.designSystemTemplate.id}/publish`));

    const clientLogin = await loginAsRole(clientOrg.id, ['client_owner'], 'client');
    const browse = await auth(clientLogin)(request(app).get('/api/v1/design-system-templates'));
    expect(browse.status).toBe(200);
    expect(browse.body.data.designSystemTemplates).toEqual([]);
  });

  test('the platform-seeded "Standard Business" template is visible to every agency\'s browse list', async () => {
    const { agency } = await setupAgencyWithProject();
    const login = await loginAsRole(agency.id, ['designer']);
    const browse = await auth(login)(request(app).get('/api/v1/design-system-templates'));
    expect(browse.body.data.designSystemTemplates.some((d) => d.name === 'Standard Business')).toBe(true);
  });

  test('builder.manage is required to create a template', async () => {
    const { agency } = await setupAgencyWithProject();
    const login = await loginAsRole(agency.id, ['designer']);
    const res = await auth(login)(request(app).post('/api/v1/design-system-templates').send({ name: 'x' }));
    expect(res.status).toBe(403);
  });
});

describe('createWebsite: template/page_kit/guided starting modes', () => {
  test('template mode requires an employee membership — a client attempting it is rejected even with a valid designSystemTemplateId', async () => {
    const { clientOrg, project } = await setupAgencyWithProject();
    const platformTemplate = await DesignSystem.findOne({ where: { name: 'Standard Business' }, __visibilityScoped: true });
    const login = await loginAsRole(clientOrg.id, ['client_owner'], 'client');
    const res = await auth(login)(request(app).post(`/api/v1/projects/${project.id}/website`).send({
      name: 'x', startingMode: 'template', designSystemTemplateId: platformTemplate.id,
    }));
    expect(res.status).toBe(403);
  });

  test('template mode forks the chosen library template\'s tokens and assembles a populated homepage from the curated starter section list', async () => {
    const { agency, project } = await setupAgencyWithProject();
    const platformTemplate = await DesignSystem.findOne({ where: { name: 'Standard Business' }, __visibilityScoped: true });
    const login = await loginAsRole(agency.id, ['developer']);

    const res = await auth(login)(request(app).post(`/api/v1/projects/${project.id}/website`).send({
      name: 'Templated Site', startingMode: 'template', designSystemTemplateId: platformTemplate.id,
    }));
    expect(res.status).toBe(201);
    const homepage = res.body.data.website.draftSchema.pages[0];
    expect(homepage.sections.length).toBeGreaterThan(0);
    expect(homepage.sections.map((s) => s.componentKey)).toEqual(expect.arrayContaining(['hero']));

    const designSystem = await DesignSystem.findOne({ where: { id: res.body.data.website.designSystemId }, __visibilityScoped: true });
    expect(designSystem.tokens).toEqual(platformTemplate.tokens);
    expect(designSystem.forkedFromDesignSystemId).toBe(platformTemplate.id);
    expect(designSystem.isLibraryTemplate).toBe(false); // forked, never a live reference (§ 2a)
  });

  test('template mode 404s for an unpublished (draft) template id, proving the create-website path enforces the same published-only visibility as browsing', async () => {
    const { agency, project } = await setupAgencyWithProject();
    const login = await loginAsRole(agency.id, ['administrator']);
    const draftTemplate = await auth(login)(request(app).post('/api/v1/design-system-templates').send({ name: 'Still Draft' }));

    const res = await auth(login)(request(app).post(`/api/v1/projects/${project.id}/website`).send({
      name: 'x', startingMode: 'template', designSystemTemplateId: draftTemplate.body.data.designSystemTemplate.id,
    }));
    expect(res.status).toBe(404);
  });

  test('page_kit mode is open to a client and produces a smaller starter page than template mode, using only default tokens', async () => {
    const { clientOrg, project } = await setupAgencyWithProject();
    const login = await loginAsRole(clientOrg.id, ['client_owner'], 'client');

    const res = await auth(login)(request(app).post(`/api/v1/projects/${project.id}/website`).send({
      name: 'Page Kit Site', startingMode: 'page_kit',
    }));
    expect(res.status).toBe(201);
    const homepage = res.body.data.website.draftSchema.pages[0];
    expect(homepage.sections.length).toBe(1);
    expect(homepage.sections[0].componentKey).toBe('hero');
  });

  test('guided mode requires an explicit sectionComponentKeys list and rejects an unknown/unpublished key', async () => {
    const { agency, project } = await setupAgencyWithProject();
    const login = await loginAsRole(agency.id, ['developer']);

    const missing = await auth(login)(request(app).post(`/api/v1/projects/${project.id}/website`).send({ name: 'x', startingMode: 'guided' }));
    expect(missing.status).toBe(422);

    const unknown = await auth(login)(request(app).post(`/api/v1/projects/${project.id}/website`).send({
      name: 'x', startingMode: 'guided', sectionComponentKeys: ['not_a_real_section'],
    }));
    expect(unknown.status).toBe(422);
    expect(unknown.body.message).toMatch(/not_a_real_section/);
  });

  test('guided mode assembles exactly the caller\'s chosen sections, in the order given', async () => {
    const { agency, project } = await setupAgencyWithProject();
    const login = await loginAsRole(agency.id, ['developer']);

    const res = await auth(login)(request(app).post(`/api/v1/projects/${project.id}/website`).send({
      name: 'Guided Site', startingMode: 'guided', sectionComponentKeys: ['cta', 'text'],
    }));
    expect(res.status).toBe(201);
    const homepage = res.body.data.website.draftSchema.pages[0];
    expect(homepage.sections.map((s) => s.componentKey)).toEqual(['cta', 'text']);
  });
});
