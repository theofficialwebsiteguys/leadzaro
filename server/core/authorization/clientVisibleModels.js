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
  WebsiteComment, WebsiteEditLock, WebsitePresence, WebsiteRepository, WebsiteDeployment, WebsiteDevelopmentHandoff,
  WebsiteDomain, WebsitePublicFormSubmission,
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
 * Library-template browsing (current-phase-plan.md § 2a/§ 2n): distinct
 * from the plain tenant-scoped accessors above, which only ever match a
 * client's own forked instance (organizationId set) — a library
 * template row always has organizationId: null and would never match
 * tenantWhereForRequester's exact-agency-id check for a platform-wide
 * (agencyOrganizationId: null) row, so this uses the same OR-scoping
 * shape as sectionDefinitionWhereForRequester. Unlike SectionDefinition,
 * though, § 2a is explicit that a library template is "visible only to
 * employees... never to a client directly" — a client's own website
 * still gets its branding via the forked DesignSystem instance, never a
 * live read of the library row itself, so a client query here is made
 * to match nothing rather than reusing the OR-scoped set.
 */
function designSystemLibraryWhereForRequester(context, extraWhere = {}) {
  if (context.membership.membershipType === 'client') {
    return { ...extraWhere, id: null }; // matches no row — id is a non-null PK
  }
  return {
    ...extraWhere,
    isLibraryTemplate: true,
    [Op.or]: [{ agencyOrganizationId: null }, { agencyOrganizationId: context.organization.id }],
  };
}

function listDesignSystemTemplatesForBrowsing(context) {
  return DesignSystem.findAll(scoped({
    where: designSystemLibraryWhereForRequester(context, { status: 'published' }),
    order: [['name', 'ASC']],
  }));
}

function getDesignSystemLibraryTemplateByIdForRequester(context, designSystemId) {
  return DesignSystem.findOne(scoped({
    where: designSystemLibraryWhereForRequester(context, { id: designSystemId, status: 'published' }),
  }));
}

/**
 * Governance surface, mirroring listSectionDefinitionsForGovernance —
 * only an agency's own custom library templates are curatable via this
 * API; the platform-provided base library is migration-seeded only.
 */
function listDesignSystemTemplatesForGovernance(context) {
  return DesignSystem.findAll(scoped({
    where: { agencyOrganizationId: context.organization.id, isLibraryTemplate: true },
    order: [['name', 'ASC']],
  }));
}

function getDesignSystemTemplateForGovernance(context, designSystemId) {
  return DesignSystem.findOne(scoped({
    where: { id: designSystemId, agencyOrganizationId: context.organization.id, isLibraryTemplate: true },
  }));
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
 * WebsiteRepository (current-phase-plan.md § 2b, Phase 6) — plain tenant
 * scoping, no client/internal split: a client can already see their own
 * website exists, and a repository record carries no additional
 * sensitive information beyond that.
 *
 * Created lazily, on first real need, never eagerly at Website creation
 * — the review correction that replaced the original eager-provisioning
 * draft. `findOrCreate` internally issues a `find` first, which the
 * model's own guard hook would otherwise reject, exactly like the
 * established `findOrCreateProjectFinancials` exception.
 */
function getWebsiteRepositoryForRequester(context, websiteId) {
  return WebsiteRepository.findOne(scoped({ where: tenantWhereForRequester(context, { websiteId }) }));
}

async function findOrCreateWebsiteRepositoryForRequester(context, website) {
  const [repository] = await WebsiteRepository.findOrCreate(scoped({
    where: { websiteId: website.id },
    defaults: {
      websiteId: website.id,
      organizationId: website.organizationId,
      agencyOrganizationId: website.agencyOrganizationId,
      createdByUserId: context.user.id,
    },
  }));
  return repository;
}

/**
 * WebsiteDeployment (current-phase-plan.md § 2e) — employee-only,
 * mirroring ProjectFinancials' assertEmployeeContext exactly: neither
 * carries anything a client needs to see directly (branch names,
 * commit SHAs, internal repo state), an explicit decision made up
 * front during the pre-implementation review rather than left
 * undecided by omission the way the original draft left it.
 */
function assertEmployeeContextForDeployment(context) {
  if (context.membership.membershipType === 'client') {
    throw new Error('WebsiteDeployment is never reachable by a client-membership request');
  }
}

function listWebsiteDeploymentsForRequester(context, extraWhere = {}) {
  assertEmployeeContextForDeployment(context);
  return WebsiteDeployment.findAll(scoped({ where: tenantWhereForRequester(context, extraWhere), order: [['createdAt', 'DESC']] }));
}

function getWebsiteDeploymentByIdForRequester(context, deploymentId) {
  assertEmployeeContextForDeployment(context);
  return WebsiteDeployment.findOne(scoped({ where: tenantWhereForRequester(context, { id: deploymentId }) }));
}

/**
 * WebsiteDevelopmentHandoff — employee-only, same reasoning as
 * WebsiteDeployment immediately above.
 */
function assertEmployeeContextForHandoff(context) {
  if (context.membership.membershipType === 'client') {
    throw new Error('WebsiteDevelopmentHandoff is never reachable by a client-membership request');
  }
}

function listWebsiteDevelopmentHandoffsForRequester(context, extraWhere = {}) {
  assertEmployeeContextForHandoff(context);
  return WebsiteDevelopmentHandoff.findAll(scoped({ where: tenantWhereForRequester(context, extraWhere), order: [['createdAt', 'DESC']] }));
}

function getWebsiteDevelopmentHandoffByIdForRequester(context, handoffId) {
  assertEmployeeContextForHandoff(context);
  return WebsiteDevelopmentHandoff.findOne(scoped({ where: tenantWhereForRequester(context, { id: handoffId }) }));
}

/**
 * WebsiteDomain (current-phase-plan.md § 2d) — employee-only, full row,
 * decided explicitly during the pre-implementation review rather than a
 * partial-field client-visibility branch (registrar/DNS internals are
 * sensitive; expiresAt/autoRenew are billing-adjacent). Same reasoning
 * as WebsiteDeployment/WebsiteDevelopmentHandoff above.
 */
function assertEmployeeContextForDomain(context) {
  if (context.membership.membershipType === 'client') {
    throw new Error('WebsiteDomain is never reachable by a client-membership request');
  }
}

function getWebsiteDomainForRequester(context, websiteId) {
  assertEmployeeContextForDomain(context);
  return WebsiteDomain.findOne(scoped({ where: tenantWhereForRequester(context, { websiteId }) }));
}

function listWebsiteDomainsForRequester(context, extraWhere = {}) {
  assertEmployeeContextForDomain(context);
  return WebsiteDomain.findAll(scoped({ where: tenantWhereForRequester(context, extraWhere), order: [['createdAt', 'DESC']] }));
}

async function findOrCreateWebsiteDomainForRequester(context, website, domain) {
  assertEmployeeContextForDomain(context);
  const [record] = await WebsiteDomain.findOrCreate(scoped({
    where: { websiteId: website.id },
    defaults: {
      websiteId: website.id,
      organizationId: website.organizationId,
      agencyOrganizationId: website.agencyOrganizationId,
      domain,
      createdByUserId: context.user.id,
    },
  }));
  return record;
}

/**
 * The ONLY place in this codebase allowed to look up a Website with NO
 * requester context at all (current-phase-plan.md § 2e; review finding
 * #1). A genuine anonymous site visitor has neither a membership nor
 * an organization to scope by — "bypass the guard" is not itself an
 * option, since the hook throws unconditionally on any unmarked query
 * (verified during the pre-implementation review). This is the same
 * documented-exception shape as getNextVersionNumberForWebsite/
 * pruneOldAutosaveVersions above, just for the opposite reason: no
 * internal-bookkeeping shortcut, no requester to scope by in the first
 * place. Returns only the minimal fields the public write path needs
 * — never the full row — and matches on currentLiveProductionDeploymentId
 * being set so a draft-only or not-yet-deployed website is treated
 * identically to one that doesn't exist (finding #10 — the controller
 * returns the same generic 404 for both).
 */
function getLiveWebsiteForPublicSubmission(websiteId) {
  return Website.findOne(scoped({
    where: { id: websiteId, currentLiveProductionDeploymentId: { [Op.ne]: null } },
    attributes: ['id', 'currentLiveProductionDeploymentId', 'organizationId', 'agencyOrganizationId'],
  }));
}

/**
 * Resolves the exact WebsiteVersion currently live in production, for
 * the same anonymous, no-requester-context reason as
 * getLiveWebsiteForPublicSubmission immediately above — the public
 * form-submission/analytics-event write paths need the live schema
 * (to validate a submitted section is really a 'form' section, and to
 * record which version a submission targeted) with no requester to
 * scope by. Never used to serve draft or non-live content — the
 * deploymentId passed in must already have come from
 * currentLiveProductionDeploymentId.
 */
async function getLiveWebsiteVersionForPublicSubmission(deploymentId) {
  const deployment = await WebsiteDeployment.findOne(scoped({
    where: { id: deploymentId }, attributes: ['id', 'websiteVersionId'],
  }));
  if (!deployment) return null;
  return WebsiteVersion.findOne(scoped({ where: { id: deployment.websiteVersionId } }));
}

/**
 * WebsitePublicFormSubmission (current-phase-plan.md § 2e) —
 * employee-only, mirroring WebsiteDomain/WebsiteDeployment. The
 * anonymous public write path (server/modules/public/) never uses
 * these — creating a row is never guarded by installVisibilityGuard in
 * the first place (only find/count are hooked), so the public
 * controller creates rows directly, deriving organizationId/
 * agencyOrganizationId server-side from getLiveWebsiteForPublicSubmission's
 * verified result. These accessors are for the employee-side triage
 * view only.
 */
function assertEmployeeContextForPublicFormSubmission(context) {
  if (context.membership.membershipType === 'client') {
    throw new Error('WebsitePublicFormSubmission is never reachable by a client-membership request');
  }
}

function listWebsitePublicFormSubmissionsForRequester(context, extraWhere = {}) {
  assertEmployeeContextForPublicFormSubmission(context);
  return WebsitePublicFormSubmission.findAll(scoped({ where: tenantWhereForRequester(context, extraWhere), order: [['createdAt', 'DESC']] }));
}

function getWebsitePublicFormSubmissionByIdForRequester(context, submissionId) {
  assertEmployeeContextForPublicFormSubmission(context);
  return WebsitePublicFormSubmission.findOne(scoped({ where: tenantWhereForRequester(context, { id: submissionId }) }));
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

/**
 * `includeUnpublished` defaults to false (published-only) — the correct
 * default for browsing/picking a section to add to a page. Internal
 * classification callers (schema diffing/enforcement, version compare)
 * pass true: a section already placed in existing content must still be
 * classified correctly even if its library entry was since deprecated,
 * matching current-phase-plan.md § 2n's governance being additive
 * (curating what's offered for *new* use), never retroactive.
 */
function listSectionDefinitionsForRequester(context, extraWhere = {}, { includeUnpublished = false } = {}) {
  const where = sectionDefinitionWhereForRequester(context, extraWhere);
  if (!includeUnpublished) where.status = 'published';
  return SectionDefinition.findAll(scoped({ where, order: [['category', 'ASC'], ['name', 'ASC']] }));
}

function getSectionDefinitionByIdForRequester(context, sectionDefinitionId) {
  return SectionDefinition.findOne(scoped({ where: sectionDefinitionWhereForRequester(context, { id: sectionDefinitionId }) }));
}

/**
 * Governance surface (current-phase-plan.md § 2n): a builder.manage
 * holder curates only their OWN agency's custom sections — system rows
 * (agencyOrganizationId: null) are migration-seeded and never mutable
 * via this API, so these accessors deliberately use plain equality,
 * not the OR-scoped browse accessor above.
 */
function listSectionDefinitionsForGovernance(context) {
  return SectionDefinition.findAll(scoped({
    where: { agencyOrganizationId: context.organization.id },
    order: [['category', 'ASC'], ['name', 'ASC']],
  }));
}

function getSectionDefinitionForGovernance(context, sectionDefinitionId) {
  return SectionDefinition.findOne(scoped({
    where: { id: sectionDefinitionId, agencyOrganizationId: context.organization.id },
  }));
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
 * WebsiteComment mirrors ProjectChannel's client/internal split
 * (current-phase-plan.md § 2h) — an employee can leave a client-invisible
 * internal note anchored to the same section a client-visible comment
 * lives on. A client membership additionally never sees isInternal:
 * true rows, on top of standard tenant scoping.
 */
function websiteCommentWhereForRequester(context, extraWhere = {}) {
  const base = tenantWhereForRequester(context, extraWhere);
  return context.membership.membershipType === 'client' ? { ...base, isInternal: false } : base;
}

function listWebsiteCommentsForRequester(context, extraWhere = {}) {
  return WebsiteComment.findAll(scoped({ where: websiteCommentWhereForRequester(context, extraWhere), include: [AUTHOR_INCLUDE], order: [['createdAt', 'ASC']] }));
}

function getWebsiteCommentByIdForRequester(context, commentId) {
  return WebsiteComment.findOne(scoped({ where: websiteCommentWhereForRequester(context, { id: commentId }) }));
}

/**
 * WebsiteEditLock/WebsitePresence carry no sensitive content — knowing
 * who is editing or viewing what section on a project everyone involved
 * already has access to isn't sensitive — so plain tenant scoping is
 * sufficient, no additional split (current-phase-plan.md § 2i).
 */
function listWebsiteEditLocksForRequester(context, extraWhere = {}) {
  return WebsiteEditLock.findAll(scoped({ where: tenantWhereForRequester(context, extraWhere) }));
}

function getWebsiteEditLockByIdForRequester(context, lockId) {
  return WebsiteEditLock.findOne(scoped({ where: tenantWhereForRequester(context, { id: lockId }) }));
}

function listWebsitePresenceForRequester(context, extraWhere = {}) {
  return WebsitePresence.findAll(scoped({ where: tenantWhereForRequester(context, extraWhere), include: [ASSIGNMENT_USER_INCLUDE] }));
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
  listDesignSystemTemplatesForBrowsing,
  getDesignSystemLibraryTemplateByIdForRequester,
  listDesignSystemTemplatesForGovernance,
  getDesignSystemTemplateForGovernance,
  listWebsitesForRequester,
  getWebsiteByIdForRequester,
  getWebsiteByProjectIdForRequester,
  getWebsiteRepositoryForRequester,
  findOrCreateWebsiteRepositoryForRequester,
  listWebsiteDeploymentsForRequester,
  getWebsiteDeploymentByIdForRequester,
  listWebsiteDevelopmentHandoffsForRequester,
  getWebsiteDevelopmentHandoffByIdForRequester,
  getWebsiteDomainForRequester,
  listWebsiteDomainsForRequester,
  findOrCreateWebsiteDomainForRequester,
  getLiveWebsiteForPublicSubmission,
  getLiveWebsiteVersionForPublicSubmission,
  listWebsitePublicFormSubmissionsForRequester,
  getWebsitePublicFormSubmissionByIdForRequester,
  listWebsiteVersionsForRequester,
  getWebsiteVersionByIdForRequester,
  getNextVersionNumberForWebsite,
  pruneOldAutosaveVersions,
  listSectionDefinitionsForRequester,
  getSectionDefinitionByIdForRequester,
  listSectionDefinitionsForGovernance,
  getSectionDefinitionForGovernance,
  listWebsiteEditorAssignmentsForRequester,
  getWebsiteEditorAssignmentByIdForRequester,
  listWebsiteCommentsForRequester,
  getWebsiteCommentByIdForRequester,
  listWebsiteEditLocksForRequester,
  getWebsiteEditLockByIdForRequester,
  listWebsitePresenceForRequester,
};
