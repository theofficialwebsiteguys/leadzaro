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

const {
  Project, ProjectFinancials, Organization, Task, ProjectChannel, Message, User, ClientRequest, ContentInboxItem, Meeting,
} = require('../../models');

// User is unguarded, so including it here is safe — same reasoning as
// ORGANIZATION_INCLUDE below (not one of the guarded-model includes
// ADR 0007's "known limitation" warns against).
const AUTHOR_INCLUDE = { model: User, as: 'author', attributes: ['id', 'name'] };

function scoped(options = {}) {
  return { ...options, __visibilityScoped: true };
}

/**
 * The base tenant scope shared by every guarded model: an employee
 * membership gets full read access within their own agency, regardless
 * of any finer-grained assignment (see current-phase-plan.md § 2d); a
 * client membership is scoped to their own organization only. Models
 * with an additional client-visibility flag (Task.isClientVisible,
 * ProjectChannel.visibility) layer that condition on top of this base
 * rather than duplicating the tenant split themselves.
 */
function tenantWhereForRequester(context, extraWhere = {}) {
  if (context.membership.membershipType === 'client') {
    return { ...extraWhere, organizationId: context.organization.id };
  }
  return { ...extraWhere, agencyOrganizationId: context.organization.id };
}

const projectWhereForRequester = tenantWhereForRequester;

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
  const base = tenantWhereForRequester(context, extraWhere);
  return context.membership.membershipType === 'client' ? { ...base, isClientVisible: true } : base;
}

function listTasksForRequester(context, extraWhere = {}) {
  return Task.findAll(scoped({ where: taskWhereForRequester(context, extraWhere), order: [['position', 'ASC'], ['createdAt', 'ASC']] }));
}

function getTaskByIdForRequester(context, taskId) {
  return Task.findOne(scoped({ where: taskWhereForRequester(context, { id: taskId }) }));
}

/**
 * ProjectChannel/Message denormalize organizationId/agencyOrganizationId
 * directly for the same reason as Task. Client membership additionally
 * requires visibility: 'client' on the channel — an 'internal' channel
 * (and every message inside it) simply doesn't exist from a client
 * request's point of view, matching Task's isClientVisible pattern.
 */
function channelWhereForRequester(context, extraWhere = {}) {
  const base = tenantWhereForRequester(context, extraWhere);
  return context.membership.membershipType === 'client' ? { ...base, visibility: 'client' } : base;
}

function listChannelsForRequester(context, extraWhere = {}) {
  return ProjectChannel.findAll(scoped({ where: channelWhereForRequester(context, extraWhere), order: [['createdAt', 'ASC']] }));
}

function getChannelByIdForRequester(context, channelId) {
  return ProjectChannel.findOne(scoped({ where: channelWhereForRequester(context, { id: channelId }) }));
}

/**
 * A Message's own visibility is entirely inherited from its channel —
 * there is no separate per-message visibility flag. A client request is
 * scoped to messages whose channelId belongs to one of their own
 * organization's client-visible channels; since that channel lookup
 * already went through channelWhereForRequester, and Message
 * denormalizes the same organizationId/agencyOrganizationId, scoping
 * Message directly by those columns is equivalent to (and avoids ever
 * needing to `include` ProjectChannel from) a channel-membership check.
 */
const messageWhereForRequester = tenantWhereForRequester;

function listMessagesForRequester(context, extraWhere = {}) {
  return Message.findAll(scoped({ where: messageWhereForRequester(context, extraWhere), include: [AUTHOR_INCLUDE], order: [['createdAt', 'ASC']] }));
}

function getMessageByIdForRequester(context, messageId) {
  return Message.findOne(scoped({ where: messageWhereForRequester(context, { id: messageId }) }));
}

/**
 * ClientRequest/ContentInboxItem have no separate client/internal
 * visibility split (unlike Task/ProjectChannel) — every request a
 * client submits is inherently visible to both them and the agency
 * handling it. The guard still matters purely for tenant isolation.
 */
function listClientRequestsForRequester(context, extraWhere = {}) {
  return ClientRequest.findAll(scoped({ where: tenantWhereForRequester(context, extraWhere), order: [['createdAt', 'DESC']] }));
}

function getClientRequestByIdForRequester(context, requestId) {
  return ClientRequest.findOne(scoped({ where: tenantWhereForRequester(context, { id: requestId }) }));
}

function listContentInboxItemsForRequester(context, extraWhere = {}) {
  return ContentInboxItem.findAll(scoped({ where: tenantWhereForRequester(context, extraWhere), order: [['createdAt', 'DESC']] }));
}

function getContentInboxItemByIdForRequester(context, itemId) {
  return ContentInboxItem.findOne(scoped({ where: tenantWhereForRequester(context, { id: itemId }) }));
}

function listMeetingsForRequester(context, extraWhere = {}) {
  return Meeting.findAll(scoped({ where: tenantWhereForRequester(context, extraWhere), order: [['createdAt', 'DESC']] }));
}

function getMeetingByIdForRequester(context, meetingId) {
  return Meeting.findOne(scoped({ where: tenantWhereForRequester(context, { id: meetingId }) }));
}

/**
 * The one exception to "every read goes through a requester context":
 * system-level operations with no HTTP requester at all (currently:
 * `projectService.ensureProjectForConversion`, triggered by a Stripe
 * webhook or the manual-conversion controller, neither of which has a
 * `req.context` to scope by — the conversion itself already establishes
 * which organization/agency this Project belongs to). Never call this
 * from anything reachable by an actual client or employee HTTP request.
 */
function findProjectByOrganizationIdSystemLevel(organizationId) {
  return Project.findOne(scoped({ where: { organizationId } }));
}

module.exports = {
  listProjectsForRequester,
  findProjectByOrganizationIdSystemLevel,
  getProjectByIdForRequester,
  getProjectFinancials,
  findOrCreateProjectFinancials,
  projectWhereForRequester,
  taskWhereForRequester,
  listTasksForRequester,
  getTaskByIdForRequester,
  channelWhereForRequester,
  listChannelsForRequester,
  getChannelByIdForRequester,
  messageWhereForRequester,
  listMessagesForRequester,
  getMessageByIdForRequester,
  listClientRequestsForRequester,
  getClientRequestByIdForRequester,
  listContentInboxItemsForRequester,
  getContentInboxItemByIdForRequester,
  listMeetingsForRequester,
  getMeetingByIdForRequester,
};
