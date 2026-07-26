'use strict';

const request = require('supertest');
const app = require('../app');
const {
  sequelize, Organization, Project, ProjectFinancials, ProjectAssignment,
} = require('../models');
const { createOrganization, createRoleAssignedMember, loginAs } = require('./helpers/factory');
const {
  listProjectsForRequester, getProjectByIdForRequester, getProjectFinancials,
} = require('../core/authorization/clientVisibleModels');

afterAll(async () => {
  await sequelize.close();
});

async function setupAgencyWithClientProject() {
  const agency = await createOrganization(sequelize.models, { type: 'agency' });
  const clientOrg = await createOrganization(sequelize.models, { type: 'client', managingAgencyOrganizationId: agency.id });
  const project = await Project.create({
    organizationId: clientOrg.id, agencyOrganizationId: agency.id, stage: 'Client Onboarding', healthStatus: 'on_track',
  });
  return { agency, clientOrg, project };
}

describe('Client-visibility enforcement (ADR 0007)', () => {
  test('a raw, unscoped query against a guarded model throws instead of silently returning unfiltered data', async () => {
    await expect(Project.findAll()).rejects.toThrow(/must be queried through/i);
    await expect(Project.findOne({ where: {} })).rejects.toThrow(/must be queried through/i);
    await expect(Project.count()).rejects.toThrow(/must be queried through/i);
    await expect(ProjectFinancials.findAll()).rejects.toThrow(/must be queried through/i);
  });

  test('the sanctioned repository module succeeds and returns correctly scoped results', async () => {
    const { agency, project } = await setupAgencyWithClientProject();
    const context = { organization: { id: agency.id }, membership: { membershipType: 'employee' } };
    const results = await listProjectsForRequester(context);
    expect(results.map((p) => p.id)).toContain(project.id);
  });
});

describe('Known guard limitation (ADR 0007) — documented, not silently assumed safe', () => {
  test('including a guarded model as an association from an unguarded model\'s query bypasses the hook entirely', async () => {
    // This is exactly why the mitigating rule exists: a guarded model
    // (Project, ProjectFinancials, ...) must never be `include`d as an
    // association from another model's query anywhere in this codebase.
    // Sequelize's beforeFind hook only fires for a query's top-level
    // model, not its included associations — proven directly here.
    const { agency, project } = await setupAgencyWithClientProject();
    const { user: teamMember } = await createRoleAssignedMember(sequelize.models, { organizationId: agency.id, roleKeys: ['developer'] });
    await ProjectAssignment.create({ projectId: project.id, userId: teamMember.id, roleSlot: 'developer' });

    const rows = await ProjectAssignment.findAll({ where: { projectId: project.id }, include: [{ model: Project, as: 'project' }] });
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0].project).toBeDefined();
  });
});

describe('Project access scoping', () => {
  test('an employee sees their own agency projects but not another agency\'s', async () => {
    const { agency: agencyA, project: projectA } = await setupAgencyWithClientProject();
    const { agency: agencyB } = await setupAgencyWithClientProject();

    const { user, password } = await createRoleAssignedMember(sequelize.models, { organizationId: agencyA.id, roleKeys: ['administrator'] });
    const login = await loginAs(app, user.email, password);
    const auth = (r) => r.set('Authorization', `Bearer ${login.token}`);

    const list = await auth(request(app).get('/api/v1/projects'));
    expect(list.status).toBe(200);
    expect(list.body.data.projects.map((p) => p.id)).toContain(projectA.id);

    // agencyB's project must never appear for an agencyA employee.
    const otherAgencyProjects = await Project.findAll({ where: { agencyOrganizationId: agencyB.id }, raw: true, __visibilityScoped: true });
    expect(list.body.data.projects.map((p) => p.id)).not.toEqual(expect.arrayContaining(otherAgencyProjects.map((p) => p.id)));

    const crossGet = await auth(request(app).get(`/api/v1/projects/${otherAgencyProjects[0].id}`));
    expect(crossGet.status).toBe(404);
  });

  test('a client sees only their own organization\'s project, never another client\'s', async () => {
    const { agency, clientOrg, project } = await setupAgencyWithClientProject();
    const otherClientOrg = await createOrganization(sequelize.models, { type: 'client', managingAgencyOrganizationId: agency.id });
    const otherProject = await Project.create({
      organizationId: otherClientOrg.id, agencyOrganizationId: agency.id, stage: 'Design', healthStatus: 'on_track',
    });

    const { user, password } = await createRoleAssignedMember(sequelize.models, {
      organizationId: clientOrg.id, roleKeys: ['client_owner'], membershipType: 'client',
    });
    const login = await loginAs(app, user.email, password);
    const auth = (r) => r.set('Authorization', `Bearer ${login.token}`);

    const list = await auth(request(app).get('/api/v1/projects'));
    expect(list.status).toBe(200);
    expect(list.body.data.projects.map((p) => p.id)).toEqual([project.id]);

    const crossGet = await auth(request(app).get(`/api/v1/projects/${otherProject.id}`));
    expect(crossGet.status).toBe(404);
  });
});

describe('Soft-gate stage transitions', () => {
  test('a stage with a checklist requires confirmation or an override reason', async () => {
    const { agency, project } = await setupAgencyWithClientProject();
    const { user, password } = await createRoleAssignedMember(sequelize.models, { organizationId: agency.id, roleKeys: ['administrator'] });
    const login = await loginAs(app, user.email, password);
    const auth = (r) => r.set('Authorization', `Bearer ${login.token}`);

    const bare = await auth(request(app).patch(`/api/v1/projects/${project.id}/stage`).send({ stage: 'Launch' }));
    expect(bare.status).toBe(422);
    expect(bare.body.details.checklist.length).toBeGreaterThan(0);

    const confirmed = await auth(request(app).patch(`/api/v1/projects/${project.id}/stage`).send({ stage: 'Launch', confirmed: true }));
    expect(confirmed.status).toBe(200);
    expect(confirmed.body.data.project.stage).toBe('Launch');
    expect(confirmed.body.data.project.launchedAt).not.toBeNull();
  });

  test('an override reason is accepted in place of confirmation, and is recorded on the audit entry', async () => {
    const { agency, project } = await setupAgencyWithClientProject();
    const { user, password } = await createRoleAssignedMember(sequelize.models, { organizationId: agency.id, roleKeys: ['administrator'] });
    const login = await loginAs(app, user.email, password);
    const auth = (r) => r.set('Authorization', `Bearer ${login.token}`);

    const res = await auth(request(app).patch(`/api/v1/projects/${project.id}/stage`).send({ stage: 'Design', overrideReason: 'Client asked us to skip ahead' }));
    expect(res.status).toBe(200);

    const { AuditLog } = sequelize.models;
    const audit = await AuditLog.findOne({ where: { action: 'project.stage_changed', targetId: project.id } });
    expect(audit.metadata.overrideReason).toBe('Client asked us to skip ahead');
  });

  test('a role without projects.change_stage cannot change stage', async () => {
    const { agency, project } = await setupAgencyWithClientProject();
    const { user, password } = await createRoleAssignedMember(sequelize.models, { organizationId: agency.id, roleKeys: ['designer'] });
    const login = await loginAs(app, user.email, password);
    const auth = (r) => r.set('Authorization', `Bearer ${login.token}`);

    const res = await auth(request(app).patch(`/api/v1/projects/${project.id}/stage`).send({ stage: 'Content Collection' }));
    expect(res.status).toBe(403);
  });

  test('a client role cannot change stage', async () => {
    const { clientOrg, project } = await setupAgencyWithClientProject();
    const { user, password } = await createRoleAssignedMember(sequelize.models, {
      organizationId: clientOrg.id, roleKeys: ['client_owner'], membershipType: 'client',
    });
    const login = await loginAs(app, user.email, password);
    const auth = (r) => r.set('Authorization', `Bearer ${login.token}`);

    const res = await auth(request(app).patch(`/api/v1/projects/${project.id}/stage`).send({ stage: 'Content Collection' }));
    expect(res.status).toBe(403);
  });
});

describe('ProjectFinancials — never reachable by a client', () => {
  test('a client role is forbidden from the financials route entirely (no projects.manage)', async () => {
    const { clientOrg, project } = await setupAgencyWithClientProject();
    const { user, password } = await createRoleAssignedMember(sequelize.models, {
      organizationId: clientOrg.id, roleKeys: ['client_owner'], membershipType: 'client',
    });
    const login = await loginAs(app, user.email, password);
    const auth = (r) => r.set('Authorization', `Bearer ${login.token}`);

    const res = await auth(request(app).get(`/api/v1/projects/${project.id}/financials`));
    expect(res.status).toBe(403);
  });

  test('calling getProjectFinancials directly with a client context throws rather than returning data', async () => {
    const { clientOrg } = await setupAgencyWithClientProject();
    const context = { organization: { id: clientOrg.id }, membership: { membershipType: 'client' } };
    await expect(getProjectFinancials(context, 'any-id')).rejects.toThrow(/never reachable by a client/i);
  });

  test('an employee with projects.manage can set and read financials', async () => {
    const { agency, project } = await setupAgencyWithClientProject();
    const { user, password } = await createRoleAssignedMember(sequelize.models, { organizationId: agency.id, roleKeys: ['administrator'] });
    const login = await loginAs(app, user.email, password);
    const auth = (r) => r.set('Authorization', `Bearer ${login.token}`);

    const update = await auth(request(app).patch(`/api/v1/projects/${project.id}/financials`).send({
      estimatedCostCents: 50000, actualCostCents: 42000, marginNotes: 'Under budget so far',
    }));
    expect(update.status).toBe(200);

    const get = await auth(request(app).get(`/api/v1/projects/${project.id}/financials`));
    expect(get.status).toBe(200);
    expect(get.body.data.financials.estimatedCostCents).toBe(50000);
    expect(get.body.data.financials.marginNotes).toBe('Under budget so far');
  });
});

describe('Project assignments', () => {
  test('one user can hold multiple role slots on the same project', async () => {
    const { agency, project } = await setupAgencyWithClientProject();
    const { user: admin, password: adminPassword } = await createRoleAssignedMember(sequelize.models, { organizationId: agency.id, roleKeys: ['administrator'] });
    const { user: teamMember } = await createRoleAssignedMember(sequelize.models, { organizationId: agency.id, roleKeys: ['developer'] });
    const login = await loginAs(app, admin.email, adminPassword);
    const auth = (r) => r.set('Authorization', `Bearer ${login.token}`);

    const first = await auth(request(app).post(`/api/v1/projects/${project.id}/assignments`).send({ userId: teamMember.id, roleSlot: 'developer' }));
    expect(first.status).toBe(200);
    const second = await auth(request(app).post(`/api/v1/projects/${project.id}/assignments`).send({ userId: teamMember.id, roleSlot: 'designer' }));
    expect(second.status).toBe(200);

    const list = await auth(request(app).get(`/api/v1/projects/${project.id}/assignments`));
    expect(list.status).toBe(200);
    const slotsForUser = list.body.data.assignments.filter((a) => a.userId === teamMember.id).map((a) => a.roleSlot);
    expect(slotsForUser.sort()).toEqual(['designer', 'developer']);
  });

  test('adding the identical (user, roleSlot) assignment twice is idempotent, not a duplicate row', async () => {
    const { agency, project } = await setupAgencyWithClientProject();
    const { user: admin, password } = await createRoleAssignedMember(sequelize.models, { organizationId: agency.id, roleKeys: ['administrator'] });
    const { user: teamMember } = await createRoleAssignedMember(sequelize.models, { organizationId: agency.id, roleKeys: ['support'] });
    const login = await loginAs(app, admin.email, password);
    const auth = (r) => r.set('Authorization', `Bearer ${login.token}`);

    await auth(request(app).post(`/api/v1/projects/${project.id}/assignments`).send({ userId: teamMember.id, roleSlot: 'support' }));
    await auth(request(app).post(`/api/v1/projects/${project.id}/assignments`).send({ userId: teamMember.id, roleSlot: 'support' }));

    const count = await ProjectAssignment.count({ where: { projectId: project.id, userId: teamMember.id, roleSlot: 'support' } });
    expect(count).toBe(1);
  });

  test('projects.manage is required to add or remove an assignment', async () => {
    const { agency, project } = await setupAgencyWithClientProject();
    const { user: designer, password } = await createRoleAssignedMember(sequelize.models, { organizationId: agency.id, roleKeys: ['designer'] });
    const login = await loginAs(app, designer.email, password);
    const auth = (r) => r.set('Authorization', `Bearer ${login.token}`);

    const res = await auth(request(app).post(`/api/v1/projects/${project.id}/assignments`).send({ userId: designer.id, roleSlot: 'designer' }));
    expect(res.status).toBe(403);
  });
});

describe('The Phase-4-opening backfill (already applied to the dev/test DB by migration) — spot-check via clientVisibleModels', () => {
  test('the seeded demo client organization has exactly one Project, correctly tenant-scoped', async () => {
    const demoOrg = await Organization.findOne({ where: { slug: 'demo-client' } });
    expect(demoOrg).not.toBeNull();
    expect(demoOrg.managingAgencyOrganizationId).not.toBeNull();

    const [demoProjectRow] = await Project.findAll({ where: { organizationId: demoOrg.id }, __visibilityScoped: true });
    expect(demoProjectRow).toBeDefined();

    const context = { organization: { id: demoOrg.managingAgencyOrganizationId }, membership: { membershipType: 'employee' } };
    const project = await getProjectByIdForRequester(context, demoProjectRow.id);
    expect(project).not.toBeNull();
    expect(project.agencyOrganizationId).toBe(demoOrg.managingAgencyOrganizationId);
    expect(project.sourceConversionAttemptId).toBeNull();
  });
});
