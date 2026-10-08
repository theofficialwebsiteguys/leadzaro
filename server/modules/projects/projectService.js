'use strict';

const {
  sequelize, ProjectAssignment, User, Project, ProjectChannel, Organization, OrganizationMembership, BillingAccount, Subscription, ServicePlan,
} = require('../../models');
const {
  listProjectsForRequester, getProjectByIdForRequester, getProjectFinancials, findOrCreateProjectFinancials, findProjectByConversionAttemptIdSystemLevel,
  listTasksForRequester, listChannelsForRequester, listMessagesForRequester, listClientRequestsForRequester, listMeetingsForRequester,
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

  // A ProjectAssignment's user is surfaced by name/email to anyone with
  // projects.view (including the client themselves, via listAssignments'
  // User include) - without this check, a projects.manage holder could
  // plant an assignment referencing any user in the system, including
  // one with no membership at this project's own agency at all.
  const targetMembership = await OrganizationMembership.findOne({
    where: { userId, organizationId: project.agencyOrganizationId, status: 'active' },
  });
  if (!targetMembership) throw invalid('User is not an active member of this project\'s agency', 422);

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

/**
 * What the client actually pays, sourced from Postgres (no Stripe call
 * needed for this summary) via the same
 * Organization -> BillingAccount -> Subscription -> ServicePlan chain
 * billingController.js's listSubscriptions/getCustomerPortalLink already
 * use directly (neither BillingAccount nor Subscription is a
 * visibility-guarded model — same reasoning applies here as there).
 * Returns null when the client has no billing account yet, e.g. an
 * internally-onboarded project with no Stripe conversion behind it.
 */
async function getBilling(context, projectId) {
  const project = await getProject(context, projectId);
  const billingAccount = await BillingAccount.findOne({ where: { organizationId: project.organizationId } });
  if (!billingAccount) return null;

  const subscriptions = await Subscription.findAll({
    where: { billingAccountId: billingAccount.id },
    include: [{ model: ServicePlan, as: 'servicePlan' }],
    order: [['createdAt', 'DESC']],
  });

  return {
    stripeCustomerId: billingAccount.stripeCustomerId,
    billingAccountStatus: billingAccount.status,
    subscriptions,
  };
}

/**
 * The one place a Project row is created, so every project — converted
 * through the CRM or added by hand on the client hub — gets the same
 * default channel set, and both inserts commit or roll back together.
 * Callers are responsible for having resolved the tenant columns from an
 * already-authorized organization.
 */
async function createProjectRecord(attributes, { transaction: outerTransaction } = {}) {
  const create = async (transaction) => {
    const project = await Project.create(attributes, { transaction });
    await ProjectChannel.bulkCreate(CHANNEL_DEFAULTS.map((channel) => ({
      projectId: project.id,
      organizationId: attributes.organizationId,
      agencyOrganizationId: attributes.agencyOrganizationId,
      key: channel.key,
      name: channel.name,
      visibility: channel.visibility,
    })), { transaction });
    return project;
  };
  // Joins a caller's transaction when one is given (e.g. creating a client,
  // its first project and its domain link together), else runs its own.
  return outerTransaction ? create(outerTransaction) : sequelize.transaction(create);
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
 * module authorization) — hence `findProjectByConversionAttemptIdSystemLevel`
 * rather than the normal per-requester lookup.
 */
async function ensureProjectForConversion(conversionResult) {
  if (conversionResult.alreadyConverted) return null;
  const { conversionAttempt } = conversionResult;
  const organizationId = conversionAttempt.resultingClientOrganizationId;

  const existing = await findProjectByConversionAttemptIdSystemLevel(conversionAttempt.id);
  if (existing) return existing;

  const organization = await Organization.findByPk(organizationId);
  if (!organization?.managingAgencyOrganizationId) {
    throw invalid(`Organization ${organizationId} has no managingAgencyOrganizationId; refusing to create an untenanted Project`, 500);
  }

  let project;
  try {
    project = await createProjectRecord({
      organizationId,
      agencyOrganizationId: organization.managingAgencyOrganizationId,
      ownerUserId: conversionAttempt.createdByUserId || null,
      sourceConversionAttemptId: conversionAttempt.id,
    });
  } catch (err) {
    // A concurrent delivery of the same conversion won the race; the
    // partial unique index on sourceConversionAttemptId guarantees there
    // is exactly one project for it, so return that one.
    if (err.name !== 'SequelizeUniqueConstraintError' && err.parent?.code !== '23505') throw err;
    project = await findProjectByConversionAttemptIdSystemLevel(conversionAttempt.id);
    if (!project) throw err;
  }

  if (conversionAttempt.projectSetupPending) {
    await conversionAttempt.update({ projectSetupPending: false });
  }

  return project;
}

/**
 * "Last-worked context" (current-phase-plan.md § 2f): a single computed
 * (not persisted) snapshot of what's recently happened on a project —
 * the newest few tasks, messages, requests and meetings a caller would
 * want on landing on the project rather than digging through five
 * separate panels. Every piece is fetched through this same module's
 * own already-guarded accessors (listTasksForRequester,
 * listChannelsForRequester + listMessagesForRequester,
 * listClientRequestsForRequester, listMeetingsForRequester) — this
 * function adds no new visibility logic of its own, it only aggregates
 * and truncates results that are already correctly scoped.
 */
async function getLastWorkedContext(context, projectId) {
  const project = await getProject(context, projectId);

  const [tasks, channels, requests, meetings] = await Promise.all([
    listTasksForRequester(context, { projectId: project.id, archivedAt: null }),
    listChannelsForRequester(context, { projectId: project.id }),
    listClientRequestsForRequester(context, { projectId: project.id }),
    listMeetingsForRequester(context, { projectId: project.id }),
  ]);

  const messagesByChannel = await Promise.all(
    channels.map((channel) => listMessagesForRequester(context, { channelId: channel.id })),
  );
  const messages = messagesByChannel.flat();
  const channelNameById = new Map(channels.map((channel) => [channel.id, channel.name]));

  const recentTasks = [...tasks]
    .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt))
    .slice(0, 5);

  const recentMessages = [...messages]
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .slice(0, 5)
    .map((message) => ({ ...message.toJSON(), channelName: channelNameById.get(message.channelId) || null }));

  const recentRequests = requests.slice(0, 5);

  const upcomingMeetings = meetings
    .filter((meeting) => ['requested', 'confirmed'].includes(meeting.status))
    .slice(0, 5);

  return {
    project, recentTasks, recentMessages, recentRequests, upcomingMeetings,
  };
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
  getLastWorkedContext,
  getBilling,
  createProjectRecord,
};
