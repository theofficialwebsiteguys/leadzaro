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

const { Op } = require('sequelize');
const {
  Project, ProjectFinancials, Organization, Task, ProjectChannel, Message, User, ClientRequest, ContentInboxItem, Meeting, File, CancellationRequest,
  DesignSystem, Website, WebsiteVersion, SectionDefinition, WebsiteEditorAssignment,
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
 * there is no separate per-message visibility flag. Correction (found
 * by a Slice 6 test that calls this function directly rather than
 * through messagingService's own "check the channel first" call order):
 * tenant scoping alone is NOT equivalent to a channel-visibility check —
 * organizationId is the same for every channel on a project regardless
 * of visibility, so a plain tenant-scoped query would still return
 * messages from an internal channel to a client. This function must be
 * safe on its own, independent of any particular caller's order of
 * operations (exactly ADR 0007's point) — it now cross-checks each
 * message's channel via getChannelByIdForRequester itself, never via an
 * `include` of the guarded ProjectChannel model.
 */
const messageWhereForRequester = tenantWhereForRequester;

async function listMessagesForRequester(context, extraWhere = {}) {
  const messages = await Message.findAll(scoped({ where: messageWhereForRequester(context, extraWhere), include: [AUTHOR_INCLUDE], order: [['createdAt', 'ASC']] }));
  if (context.membership.membershipType !== 'client') return messages;

  const results = [];
  for (const message of messages) {
    // eslint-disable-next-line no-await-in-loop
    if (await getChannelByIdForRequester(context, message.channelId)) results.push(message);
  }
  return results;
}

async function getMessageByIdForRequester(context, messageId) {
  const message = await Message.findOne(scoped({ where: messageWhereForRequester(context, { id: messageId }) }));
  if (!message) return null;
  if (context.membership.membershipType === 'client' && !(await getChannelByIdForRequester(context, message.channelId))) {
    return null;
  }
  return message;
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
 * File's client-visibility rule is deliberately NOT just `isPrivate:
 * false` (§ 2b correction 2 — the review found that rule alone would
 * make e.g. a non-private website_asset file client-visible with
 * nothing tying it to a specific client-visible context). The real
 * rule: isPrivate: false AND scope in File.CLIENT_FACING_SCOPES, and
 * for task_attachment/message_attachment specifically, the referenced
 * Task/Message must independently be client-visible — checked via a
 * real lookup through this same module's own guarded accessors, never
 * via an `include` of Task/Message (ADR 0007).
 */
async function filterClientVisibleFiles(context, files) {
  const results = [];
  for (const file of files) {
    if (file.scope === 'task_attachment') {
      // eslint-disable-next-line no-await-in-loop
      if (await getTaskByIdForRequester(context, file.relatedId)) results.push(file);
    } else if (file.scope === 'message_attachment') {
      // eslint-disable-next-line no-await-in-loop
      if (await getMessageByIdForRequester(context, file.relatedId)) results.push(file);
    } else if (file.scope === 'website_asset') {
      // eslint-disable-next-line no-await-in-loop
      if (await getWebsiteByIdForRequester(context, file.relatedId)) results.push(file);
    } else {
      results.push(file);
    }
  }
  return results;
}

async function listFilesForRequester(context, extraWhere = {}) {
  if (context.membership.membershipType === 'client') {
    const candidates = await File.findAll(scoped({
      where: {
        ...extraWhere, organizationId: context.organization.id, isPrivate: false, scope: File.CLIENT_FACING_SCOPES,
      },
      order: [['createdAt', 'DESC']],
    }));
    return filterClientVisibleFiles(context, candidates);
  }
  return File.findAll(scoped({ where: { ...extraWhere, agencyOrganizationId: context.organization.id }, order: [['createdAt', 'DESC']] }));
}

async function getFileByIdForRequester(context, fileId) {
  if (context.membership.membershipType === 'client') {
    const file = await File.findOne(scoped({
      where: {
        id: fileId, organizationId: context.organization.id, isPrivate: false, scope: File.CLIENT_FACING_SCOPES,
      },
    }));
    if (!file) return null;
    const [visible] = await filterClientVisibleFiles(context, [file]);
    return visible || null;
  }
  return File.findOne(scoped({ where: { id: fileId, agencyOrganizationId: context.organization.id } }));
}

/**
 * CancellationRequest has no client/internal visibility split, same
 * reasoning as ClientRequest/Meeting: whoever can see the project at
 * all (client or agency) can see its cancellation history.
 */
function listCancellationRequestsForRequester(context, extraWhere = {}) {
  return CancellationRequest.findAll(scoped({ where: tenantWhereForRequester(context, extraWhere), order: [['createdAt', 'DESC']] }));
}

function getCancellationRequestByIdForRequester(context, requestId) {
  return CancellationRequest.findOne(scoped({ where: tenantWhereForRequester(context, { id: requestId }) }));
}

/**
 * DesignSystem reuses tenantWhereForRequester directly, unmodified
 * (current-phase-plan.md § 2a). A library-template row has
 * organizationId: null and agencyOrganizationId set — an employee
 * context matches on agencyOrganizationId and sees both the library
 * templates and every client instance under their agency; a client
 * context matches on organizationId, which a library row's null value
 * never satisfies, so library rows are automatically invisible to any
 * client with no extra logic required.
 */
function listDesignSystemsForRequester(context, extraWhere = {}) {
  return DesignSystem.findAll(scoped({ where: tenantWhereForRequester(context, extraWhere) }));
}

function getDesignSystemByIdForRequester(context, designSystemId) {
  return DesignSystem.findOne(scoped({ where: tenantWhereForRequester(context, { id: designSystemId }) }));
}

/**
 * Website denormalizes organizationId/agencyOrganizationId directly,
 * same reasoning as Task/Message/Meeting — a Website is 1:1 with a
 * Project (current-phase-plan.md § 2b) and needs no additional
 * client/internal split of its own; the split that matters lives on
 * WebsiteVersion below.
 */
function listWebsitesForRequester(context, extraWhere = {}) {
  return Website.findAll(scoped({ where: tenantWhereForRequester(context, extraWhere) }));
}

function getWebsiteByIdForRequester(context, websiteId) {
  return Website.findOne(scoped({ where: tenantWhereForRequester(context, { id: websiteId }) }));
}

function getWebsiteByProjectIdForRequester(context, projectId) {
  return Website.findOne(scoped({ where: tenantWhereForRequester(context, { projectId }) }));
}

/**
 * WebsiteVersion's visibility is NOT just tenant scoping — a client
 * membership must never see another user's in-progress draft/autosave
 * work (e.g. a designer's unfinished changes), only the currently
 * published/approved version(s) and their own submissions (so they can
 * track their own request's status). This is the same shape of
 * additional condition as taskWhereForRequester's isClientVisible check
 * and channelWhereForRequester's visibility check — found by direct
 * design-review analysis before any code was written, precisely because
 * ADR 0007's Message/ProjectChannel history showed this exact class of
 * omission ships silently if not checked for up front.
 */
function websiteVersionWhereForRequester(context, extraWhere = {}) {
  const base = tenantWhereForRequester(context, extraWhere);
  if (context.membership.membershipType !== 'client') return base;
  return {
    ...base,
    [Op.or]: [
      { status: ['published', 'approved'] },
      { createdByUserId: context.user.id },
    ],
  };
}

function listWebsiteVersionsForRequester(context, extraWhere = {}) {
  return WebsiteVersion.findAll(scoped({ where: websiteVersionWhereForRequester(context, extraWhere), order: [['versionNumber', 'DESC']] }));
}

function getWebsiteVersionByIdForRequester(context, versionId) {
  return WebsiteVersion.findOne(scoped({ where: websiteVersionWhereForRequester(context, { id: versionId }) }));
}

/**
 * Deliberately bypasses the client-visibility filter above — not a
 * requester-facing read, just an internal numbering lookup used after
 * the caller has already verified access to the parent Website via
 * getWebsiteByIdForRequester. Computing "next version number" from a
 * client-filtered view would be a real correctness bug, not just a
 * visibility one: a client's filtered list could be missing a higher-
 * numbered version an employee already created (e.g. their own in-
 * progress Professional-tier work), so a client's next checkpoint would
 * collide with that already-used number and fail the unique constraint
 * on (websiteId, versionNumber) — this counts every version regardless
 * of who created it, exactly matching what the constraint itself
 * guards against.
 */
async function getNextVersionNumberForWebsite(websiteId) {
  const latest = await WebsiteVersion.findOne(scoped({
    where: { websiteId }, order: [['versionNumber', 'DESC']],
  }));
  return (latest?.versionNumber || 0) + 1;
}

/**
 * SectionDefinition is agency-scoped, not tenant-scoped like every
 * other model above (current-phase-plan.md § 2d) — a row with
 * agencyOrganizationId: null is a platform-provided default visible to
 * everyone; a non-null row is a specific agency's own curated/custom
 * library, visible to that agency's employees and (read-only, to render
 * their own site) the clients under it. An employee's "own agency" is
 * context.organization.id directly; a client's is resolved through
 * their organization's managingAgencyOrganizationId (already loaded on
 * context.organization by resolveContext()'s own include).
 */
function sectionDefinitionWhereForRequester(context, extraWhere = {}) {
  const ownAgencyOrganizationId = context.membership.membershipType === 'client'
    ? context.organization.managingAgencyOrganizationId
    : context.organization.id;
  return {
    ...extraWhere,
    [Op.or]: [{ agencyOrganizationId: null }, { agencyOrganizationId: ownAgencyOrganizationId }],
  };
}

function listSectionDefinitionsForRequester(context, extraWhere = {}) {
  return SectionDefinition.findAll(scoped({ where: sectionDefinitionWhereForRequester(context, extraWhere), order: [['category', 'ASC'], ['name', 'ASC']] }));
}

function getSectionDefinitionByIdForRequester(context, sectionDefinitionId) {
  return SectionDefinition.findOne(scoped({ where: sectionDefinitionWhereForRequester(context, { id: sectionDefinitionId }) }));
}

/**
 * WebsiteEditorAssignment denormalizes organizationId/agencyOrganizationId
 * directly and uses plain tenant scoping — no additional split needed
 * (unlike WebsiteVersion, there's no "another user's in-progress work"
 * concern here: knowing who is assigned what editing level on a
 * project everyone involved already has access to isn't sensitive).
 */
// User is unguarded, so including it here is safe — same reasoning as
// AUTHOR_INCLUDE above; WebsiteEditorAssignment's own association uses
// a 'user' alias rather than 'author'.
const ASSIGNMENT_USER_INCLUDE = { model: User, as: 'user', attributes: ['id', 'name', 'email'] };

function listWebsiteEditorAssignmentsForRequester(context, extraWhere = {}) {
  return WebsiteEditorAssignment.findAll(scoped({ where: tenantWhereForRequester(context, extraWhere), include: [ASSIGNMENT_USER_INCLUDE] }));
}

function getWebsiteEditorAssignmentByIdForRequester(context, assignmentId) {
  return WebsiteEditorAssignment.findOne(scoped({ where: tenantWhereForRequester(context, { id: assignmentId }) }));
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

/**
 * Deliberately bypasses the client-visibility filter above for the same
 * reason getNextVersionNumberForWebsite does — the caller has already
 * verified access to the parent Website; this only prunes the autosave
 * trail (current-phase-plan.md § 5 slice 4), keeping the most recent
 * `keepCount` autosave versions and deleting the rest. Named checkpoints
 * and published versions (isAutosave: false) are never touched here.
 */
async function pruneOldAutosaveVersions(websiteId, keepCount) {
  const autosaves = await WebsiteVersion.findAll(scoped({
    where: { websiteId, isAutosave: true }, order: [['versionNumber', 'DESC']],
  }));
  const toDelete = autosaves.slice(keepCount);
  if (toDelete.length > 0) {
    await WebsiteVersion.destroy({ where: { id: toDelete.map((version) => version.id) } });
  }
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
  listFilesForRequester,
  getFileByIdForRequester,
  listCancellationRequestsForRequester,
  getCancellationRequestByIdForRequester,
  listDesignSystemsForRequester,
  getDesignSystemByIdForRequester,
  listWebsitesForRequester,
  getWebsiteByIdForRequester,
  getWebsiteByProjectIdForRequester,
  listWebsiteVersionsForRequester,
  getWebsiteVersionByIdForRequester,
  getNextVersionNumberForWebsite,
  pruneOldAutosaveVersions,
  listSectionDefinitionsForRequester,
  getSectionDefinitionByIdForRequester,
  listWebsiteEditorAssignmentsForRequester,
  getWebsiteEditorAssignmentByIdForRequester,
};
