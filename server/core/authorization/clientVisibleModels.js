'use strict';

/**
 * The ONLY sanctioned way any controller/service reads Project,
 * ProjectFinancials, or (as later Phase 4 slices add them) Task,
 * Message, ProjectChannel, File, ClientRequest. See ADR 0007
 * (docs/leadzaro/adr/0007-client-visibility-enforcement.md) for the full
 * reasoning. Every function here always applies the correct scoping
 * internally based on the requester's context — never a partial `where`
 * fragment a caller could forget to merge in — and sets the
 * `__visibilityScoped` marker the models' own Sequelize hooks require.
 * A raw `Project.findAll()` anywhere else in the codebase throws.
 */

const { Project, ProjectFinancials, Organization, Task } = require('../../models');

function scoped(options = {}) {
  return { ...options, __visibilityScoped: true };
}

/**
 * Employee membership at the project's own agency: full read access to
 * that agency's Projects, regardless of the requester's own
 * ProjectAssignment on any specific project (ProjectAssignment governs
 * task ownership, not read access — see current-phase-plan.md § 2d).
 * Client membership: only their own organization's Project(s).
 */
function projectWhereForRequester(context, extraWhere = {}) {
  if (context.membership.membershipType === 'client') {
    return { ...extraWhere, organizationId: context.organization.id };
  }
  return { ...extraWhere, agencyOrganizationId: context.organization.id };
}

// Organization is unguarded (no visibility hook), so including it here is
// safe — it is not one of the guarded-model includes ADR 0007's "known
// limitation" section warns against. Only used for display (a Project
// has no name of its own; its client Organization's name serves that
// purpose, since the two are one-to-one).
const ORGANIZATION_INCLUDE = { model: Organization, as: 'organization', attributes: ['id', 'name'] };

function listProjectsForRequester(context, extraWhere = {}) {
  return Project.findAll(scoped({ where: projectWhereForRequester(context, extraWhere), include: [ORGANIZATION_INCLUDE] }));
}

function getProjectByIdForRequester(context, projectId) {
  return Project.findOne(scoped({ where: projectWhereForRequester(context, { id: projectId }), include: [ORGANIZATION_INCLUDE] }));
}

/**
 * ProjectFinancials is agency-only, full stop — never reachable by any
 * client-membership request. Throws rather than silently returning null
 * if a client context is somehow passed in, since that would indicate a
 * bug in the calling code, not a normal "no data" outcome.
 */
function assertEmployeeContext(context) {
  if (context.membership.membershipType === 'client') {
    throw new Error('ProjectFinancials is never reachable by a client-membership request');
  }
}

async function getProjectFinancials(context, projectId) {
  assertEmployeeContext(context);
  const project = await getProjectByIdForRequester(context, projectId);
  if (!project) return null;
  return ProjectFinancials.findOne(scoped({ where: { projectId: project.id } }));
}

/**
 * The one sanctioned write path for ProjectFinancials — `findOrCreate`
 * internally issues a `find` first, which the model's own guard hook
 * would otherwise reject exactly like any other unscoped read.
 */
async function findOrCreateProjectFinancials(context, projectId) {
  assertEmployeeContext(context);
  const project = await getProjectByIdForRequester(context, projectId);
  if (!project) throw new Error('Project not found');
  const [financials] = await ProjectFinancials.findOrCreate(scoped({
    where: { projectId: project.id },
    defaults: { projectId: project.id },
  }));
  return financials;
}

/**
 * Task denormalizes organizationId/agencyOrganizationId directly (see
 * Task.js) specifically so its own top-level query can be scoped
 * without ever needing to `include` the guarded Project model — the
 * ADR 0007 "included association bypasses the hook" gap doesn't apply
 * here because Project is never included in these queries at all.
 * Client membership additionally requires isClientVisible: true — a
 * task is internal by default.
 */
function taskWhereForRequester(context, extraWhere = {}) {
  if (context.membership.membershipType === 'client') {
    return { ...extraWhere, organizationId: context.organization.id, isClientVisible: true };
  }
  return { ...extraWhere, agencyOrganizationId: context.organization.id };
}

function listTasksForRequester(context, extraWhere = {}) {
  return Task.findAll(scoped({ where: taskWhereForRequester(context, extraWhere), order: [['position', 'ASC'], ['createdAt', 'ASC']] }));
}

function getTaskByIdForRequester(context, taskId) {
  return Task.findOne(scoped({ where: taskWhereForRequester(context, { id: taskId }) }));
}

module.exports = {
  listProjectsForRequester,
  getProjectByIdForRequester,
  getProjectFinancials,
  findOrCreateProjectFinancials,
  projectWhereForRequester,
  taskWhereForRequester,
  listTasksForRequester,
  getTaskByIdForRequester,
};
