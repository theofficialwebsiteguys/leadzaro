'use strict';

const request = require('supertest');
const app = require('../app');
const { sequelize, SectionDefinition } = require('../models');
const { createOrganization, createRoleAssignedMember, loginAs } = require('./helpers/factory');

afterAll(async () => {
  await sequelize.close();
});

describe('SectionDefinition visibility guard', () => {
  test('a raw unscoped query throws', async () => {
    await expect(SectionDefinition.findAll()).rejects.toThrow(/must be queried through/i);
  });
});

describe('GET /api/v1/section-definitions', () => {
  test('builder.edit is required', async () => {
    const agency = await createOrganization(sequelize.models, { type: 'agency' });
    const { user, password } = await createRoleAssignedMember(sequelize.models, { organizationId: agency.id, roleKeys: ['sales_representative'] });
    const login = await loginAs(app, user.email, password);
    const res = await request(app).get('/api/v1/section-definitions').set('Authorization', `Bearer ${login.token}`);
    expect(res.status).toBe(403);
  });

  test('an employee with builder.edit sees every system-defined section plus their own agency\'s custom ones, never another agency\'s', async () => {
    const agencyA = await createOrganization(sequelize.models, { type: 'agency' });
    const agencyB = await createOrganization(sequelize.models, { type: 'agency' });
    const agencyASection = await SectionDefinition.create({
      agencyOrganizationId: agencyA.id, name: 'Agency A Custom Section', componentKey: 'custom_a', category: 'custom', isSystemDefined: false,
    });
    const agencyBSection = await SectionDefinition.create({
      agencyOrganizationId: agencyB.id, name: 'Agency B Custom Section', componentKey: 'custom_b', category: 'custom', isSystemDefined: false,
    });

    const { user, password } = await createRoleAssignedMember(sequelize.models, { organizationId: agencyA.id, roleKeys: ['designer'] });
    const login = await loginAs(app, user.email, password);
    const res = await request(app).get('/api/v1/section-definitions').set('Authorization', `Bearer ${login.token}`);
    expect(res.status).toBe(200);

    const ids = res.body.data.sectionDefinitions.map((s) => s.id);
    expect(ids).toContain(agencyASection.id);
    expect(ids).not.toContain(agencyBSection.id);

    const systemSections = res.body.data.sectionDefinitions.filter((s) => s.isSystemDefined);
    expect(systemSections.length).toBeGreaterThanOrEqual(5);
    expect(systemSections.map((s) => s.componentKey)).toEqual(expect.arrayContaining(['hero', 'text', 'image', 'cta', 'form']));
  });

  test('a client sees the system-defined sections plus their own managing agency\'s custom ones, never a different agency\'s', async () => {
    const agencyA = await createOrganization(sequelize.models, { type: 'agency' });
    const agencyB = await createOrganization(sequelize.models, { type: 'agency' });
    const clientOrg = await createOrganization(sequelize.models, { type: 'client', managingAgencyOrganizationId: agencyA.id });
    const agencyASection = await SectionDefinition.create({
      agencyOrganizationId: agencyA.id, name: 'Agency A Custom Section', componentKey: 'custom_a2', category: 'custom', isSystemDefined: false,
    });
    const agencyBSection = await SectionDefinition.create({
      agencyOrganizationId: agencyB.id, name: 'Agency B Custom Section', componentKey: 'custom_b2', category: 'custom', isSystemDefined: false,
    });

    const { user, password } = await createRoleAssignedMember(sequelize.models, {
      organizationId: clientOrg.id, roleKeys: ['client_owner'], membershipType: 'client',
    });
    const login = await loginAs(app, user.email, password);
    const res = await request(app).get('/api/v1/section-definitions').set('Authorization', `Bearer ${login.token}`);
    expect(res.status).toBe(200);

    const ids = res.body.data.sectionDefinitions.map((s) => s.id);
    expect(ids).toContain(agencyASection.id);
    expect(ids).not.toContain(agencyBSection.id);
    expect(ids.filter((id) => res.body.data.sectionDefinitions.find((s) => s.id === id).isSystemDefined).length).toBeGreaterThanOrEqual(5);
  });
});
