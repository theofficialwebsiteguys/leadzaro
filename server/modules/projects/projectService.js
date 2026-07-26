'use strict';

const {
  ProjectAssignment, User, Project, ProjectChannel, Organization,
} = require('../../models');
const {
  listProjectsForRequester, getProjectByIdForRequester, getProjectFinancials, findOrCreateProjectFinancials, findProjectByOrganizationIdSystemLevel,
} = require('../../core/authorization/clientVisibleModels');
const { STAGES, STAGE_CHECKLISTS, CHANNEL_DEFAULTS } = require('../../core/projects/projectCatalog');

function invalid(message, statusCode = 422) {
  const err = new Error(message);
  err.statusCode = statusCode;
  return err;
}

function listProjects(context) {
  return listProjectsForRequester(context);
}

async function getProject(context, projectId) {
  const project = await getProjectByIdForRequester(context, projectId);
  if (!project) throw invalid('Project not found', 404);
  return project;
}

/**
 * Soft-gate stage transition (architecture § 10 / current-phase-plan.md
 * § 2c): every stage with a non-empty checklist requires the caller to
 * either explicitly confirm they've verified it (`confirmed: true`) or
 * supply an `overrideReason` — Phase 4 has no per-item mechanical
 * completion tracking yet (no linked Task/deliverable proving each
 * checklist item done), so this is the honest current implementation of
 * "warns about missing items, authorized users may proceed with a
 * reason": a real human confirmation gate, not a rubber-stamped no-op.
 * Restricted to `projects.change_stage` at the route level — this
 * function does not re-check permission, matching this codebase's
 * established controller-gates-permission pattern. The controller
 * records the audit entry (not this function), matching every other
 * module's convention of calling recordAudit at the controller layer
 * where `req` is available.
 */
async function changeStage({
  context, projectId, stage, confirmed, overrideReason,
}) {
  if (!STAGES.includes(stage)) throw invalid(`Unknown stage: ${stage}`);
  const project = await getProject(context, projectId);

  const checklist = STAGE_CHECKLISTS[stage] || [];
  if (checklist.length > 0 && !confirmed && !overrideReason) {
    const err = invalid('This stage has a checklist that must be confirmed or overridden with a reason', 422);
    err.checklist = checklist;
    throw err;
  }

  const previousStage = project.stage;
  await project.update({
    stage,
    launchedAt: stage === 'Launch' && !project.launchedAt ? new Date() : project.launchedAt,
  });

  return { project, previousStage };
}

async function updateHealthStatus({ context, projectId, healthStatus }) {
  const project = await getProject(context, projectId);
  if (!Project.HEALTH_STATUSES.includes(healthStatus)) throw invalid(`Unknown healthStatus: ${healthStatus}`);

  await project.update({ healthStatus, healthStatusIsManualOverride: true });
  return project;
}

async function listAssignments(context, projectId) {
  const project = await getProject(context, projectId);
  return ProjectAssignment.findAll({
    where: { projectId: project.id },
    include: [{ model: User, as: 'user', attributes: ['id', 'name', 'email'] }],
    order: [['createdAt', 'ASC']],
  });
}

async function addAssignment({
  context, projectId, userId, roleSlot, actorUserId,
}) {
  const project = await getProject(context, projectId);
  if (!ProjectAssignment.ROLE_SLOTS.includes(roleSlot)) throw invalid(`Unknown roleSlot: ${roleSlot}`);

  const targetUser = await User.findByPk(userId);
  if (!targetUser) throw invalid('User not found', 404);

  const existing = await ProjectAssignment.findOne({ where: { projectId: project.id, userId, roleSlot } });
  if (existing) return { assignment: existing, alreadyExisted: true };

  const assignment = await ProjectAssignment.create({
    projectId: project.id, userId, roleSlot, assignedByUserId: actorUserId,
  });
  return { assignment, alreadyExisted: false };
}

async function removeAssignment({ context, projectId, assignmentId }) {
  const project = await getProject(context, projectId);
  const assignment = await ProjectAssignment.findOne({ where: { id: assignmentId, projectId: project.id } });
  if (!assignment) throw invalid('Assignment not found', 404);

  await assignment.destroy();
  return assignment;
}

async function getFinancials(context, projectId) {
  return getProjectFinancials(context, projectId);
}

async function updateFinancials({
  context, projectId, estimatedCostCents, actualCostCents, marginNotes,
}) {
  const project = await getProject(context, projectId);
  const financials = await findOrCreateProjectFinancials(context, project.id);
  await financials.update({
    estimatedCostCents: estimatedCostCents ?? financials.estimatedCostCents,
    actualCostCents: actualCostCents ?? financials.actualCostCents,
    marginNotes: marginNotes ?? financials.marginNotes,
  });
  return financials;
}

/**
 * Closes the loop Phase 3 deliberately left open (see docs/leadzaro/
 * phase-3-completion-report.md "Legacy/architecture boundary" and
 * current-phase-plan.md § 2a): the Phase-4-opening migration backfilled
 * a Project for every *pre-existing* client organization, but does
 * nothing for a conversion that happens from here forward — Phase 3's
 * own conversion code has no knowledge that Project exists. Called from
 * both server/modules/billing/webhookService.js and billingController.js
 * (the exact two places `triggerClientInvitationIfNew` is already
 * called from) immediately after every genuinely-new conversion, so
 * every future client gets a Project + its default channel set exactly
 * once, same as every pre-existing one already got via the migration.
 *
 * No requester context exists at this call site (a webhook has no
 * HTTP session; the manual-conversion controller's actor is the
 * *sales* rep converting the deal, not someone acting within Projects
 * module authorization) — hence `findProjectByOrganizationIdSystemLevel`
 * rather than the normal per-requester lookup.
 */
async function ensureProjectForConversion(conversionResult) {
  if (conversionResult.alreadyConverted) return null;
  const { conversionAttempt } = conversionResult;
  const organizationId = conversionAttempt.resultingClientOrganizationId;

  const existing = await findProjectByOrganizationIdSystemLevel(organizationId);
  if (existing) return existing;

  const organization = await Organization.findByPk(organizationId);
  if (!organization?.managingAgencyOrganizationId) {
    throw invalid(`Organization ${organizationId} has no managingAgencyOrganizationId; refusing to create an untenanted Project`, 500);
  }

  const project = await Project.create({
    organizationId,
    agencyOrganizationId: organization.managingAgencyOrganizationId,
    ownerUserId: conversionAttempt.createdByUserId || null,
    sourceConversionAttemptId: conversionAttempt.id,
  });

  await ProjectChannel.bulkCreate(CHANNEL_DEFAULTS.map((channel) => ({
    projectId: project.id,
    organizationId,
    agencyOrganizationId: organization.managingAgencyOrganizationId,
    key: channel.key,
    name: channel.name,
    visibility: channel.visibility,
  })));

  if (conversionAttempt.projectSetupPending) {
    await conversionAttempt.update({ projectSetupPending: false });
  }

  return project;
}

module.exports = {
  listProjects,
  ensureProjectForConversion,
  getProject,
  changeStage,
  updateHealthStatus,
  listAssignments,
  addAssignment,
  removeAssignment,
  getFinancials,
  updateFinancials,
};
