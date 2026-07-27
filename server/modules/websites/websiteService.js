'use strict';

const { DesignSystem, Website, WebsiteVersion } = require('../../models');
const {
  getProjectByIdForRequester, getWebsiteByProjectIdForRequester, getWebsiteByIdForRequester,
  listWebsiteVersionsForRequester, getWebsiteVersionByIdForRequester, getNextVersionNumberForWebsite,
  listSectionDefinitionsForRequester,
} = require('../../core/authorization/clientVisibleModels');
const { DEFAULT_DESIGN_TOKENS, buildBlankSchema } = require('../../core/websites/websiteCatalog');
const { resolveEffectiveEditingLevel, levelSatisfies } = require('../../core/websites/editingLevel');
const { diffSchemaChanges } = require('../../core/websites/schemaDiff');

function invalid(message, statusCode = 422) {
  const err = new Error(message);
  err.statusCode = statusCode;
  return err;
}

async function assertProjectAccess(context, projectId) {
  const project = await getProjectByIdForRequester(context, projectId);
  if (!project) throw invalid('Project not found', 404);
  return project;
}

async function getWebsite(context, projectId) {
  await assertProjectAccess(context, projectId);
  const website = await getWebsiteByProjectIdForRequester(context, projectId);
  if (!website) throw invalid('This project has no website yet', 404);
  return website;
}

/**
 * Only 'blank' actually produces a real starting schema this slice —
 * current-phase-plan.md § 2n defers 'page_kit'/'guided' to a later
 * slice once the section library exists to build on, and 'template'
 * has no real catalog to select from until slice 8's library
 * governance. Rejecting the other three now is more honest than
 * silently falling back to a blank schema under a different label.
 */
async function createWebsite({
  context, projectId, name, startingMode, actorUserId,
}) {
  const project = await assertProjectAccess(context, projectId);
  if (!Website.STARTING_MODES.includes(startingMode)) throw invalid(`Unknown startingMode: ${startingMode}`);
  if (startingMode !== 'blank') throw invalid(`Starting mode '${startingMode}' is not yet available`, 422);
  if (!name?.trim()) throw invalid('name is required');

  const existing = await getWebsiteByProjectIdForRequester(context, project.id);
  if (existing) throw invalid('This project already has a website', 409);

  // Fork, never reference: a client's own DesignSystem row is created
  // fresh here (current-phase-plan.md § 2a correction) so a later edit
  // to any shared library template can never retroactively change this
  // site's already-published tokens.
  const designSystem = await DesignSystem.create({
    agencyOrganizationId: project.agencyOrganizationId,
    organizationId: project.organizationId,
    name: `${name} Design System`,
    tokens: DEFAULT_DESIGN_TOKENS,
    isLibraryTemplate: false,
    createdByUserId: actorUserId,
  });

  const draftSchema = buildBlankSchema();

  const website = await Website.create({
    projectId: project.id,
    organizationId: project.organizationId,
    agencyOrganizationId: project.agencyOrganizationId,
    designSystemId: designSystem.id,
    name,
    startingMode,
    draftSchema,
    createdByUserId: actorUserId,
  });

  await WebsiteVersion.create({
    websiteId: website.id,
    organizationId: project.organizationId,
    agencyOrganizationId: project.agencyOrganizationId,
    versionNumber: 1,
    label: 'Initial version',
    schema: draftSchema,
    isAutosave: false,
    status: 'draft',
    createdByUserId: actorUserId,
  });

  return website;
}

/**
 * The secondary major gate (current-phase-plan.md § 2e), shared by
 * every path that can change draftSchema — a plain editor save AND a
 * version restore alike. Restoring an old version is a schema change
 * like any other: without running it through this same classification,
 * a Basic-assigned editor could restore a version containing another
 * user's Professional/Advanced-tier content and have it silently
 * reapplied to the draft, bypassing the per-property check entirely.
 * Diffs the incoming schema against the current draft, classifies every
 * changed key against its SectionDefinition.settingsSchema entry (never
 * a single whole-section check — the review's own load-bearing
 * correction to the original draft), and rejects the entire change if
 * anything exceeds the requester's effective editing level. Returns
 * whether the change requires review, for the caller to persist.
 */
async function authorizeAndClassifySchemaChange(context, website, newSchema) {
  const effectiveLevel = await resolveEffectiveEditingLevel(context, website.id);

  const sectionDefinitions = await listSectionDefinitionsForRequester(context);
  const sectionDefinitionsByKey = new Map(sectionDefinitions.map((definition) => [definition.componentKey, definition]));
  const { changes, structuralChange } = diffSchemaChanges(website.draftSchema, newSchema, sectionDefinitionsByKey);

  if (structuralChange && !levelSatisfies(effectiveLevel, 'professional')) {
    throw invalid('Adding, removing, or reordering pages or sections requires at least Professional-level editing access', 403);
  }
  const disallowed = changes.find((change) => !levelSatisfies(effectiveLevel, change.editingLevel));
  if (disallowed) {
    throw invalid(`Changing "${disallowed.key}" requires ${disallowed.editingLevel}-level editing access`, 403);
  }

  return structuralChange || changes.some((change) => change.requiresReview);
}

async function updateDraftSchema({ context, projectId, draftSchema }) {
  const website = await getWebsite(context, projectId);
  const requiresReview = await authorizeAndClassifySchemaChange(context, website, draftSchema);

  await website.update({
    draftSchema,
    draftHasPendingReviewChanges: website.draftHasPendingReviewChanges || requiresReview,
  });
  return website;
}

async function listVersions(context, projectId) {
  const website = await getWebsite(context, projectId);
  return listWebsiteVersionsForRequester(context, { websiteId: website.id });
}

async function getVersion(context, projectId, versionId) {
  const website = await getWebsite(context, projectId);
  const version = await getWebsiteVersionByIdForRequester(context, versionId);
  if (!version || version.websiteId !== website.id) throw invalid('Version not found', 404);
  return version;
}

/**
 * The new version's status reflects whether any change since the last
 * checkpoint was flagged requiresReview (§ 2e) — a single source of
 * truth (Website.draftHasPendingReviewChanges, set by updateDraftSchema
 * above) rather than re-deriving the classification here a second time.
 * The flag is cleared once captured into this checkpoint.
 */
async function createCheckpoint({
  context, projectId, label, actorUserId,
}) {
  const website = await getWebsite(context, projectId);
  const versionNumber = await getNextVersionNumberForWebsite(website.id);
  const status = website.draftHasPendingReviewChanges ? 'pending_review' : 'draft';

  const version = await WebsiteVersion.create({
    websiteId: website.id,
    organizationId: website.organizationId,
    agencyOrganizationId: website.agencyOrganizationId,
    versionNumber,
    label: label || null,
    schema: website.draftSchema,
    isAutosave: false,
    status,
    createdByUserId: actorUserId,
  });

  await website.update({ draftHasPendingReviewChanges: false });
  return version;
}

/**
 * builder.publish only (route-gated) — collapses "approve" and
 * "publish" into one action for this foundation phase rather than
 * requiring a separate approval step; the trusted senior roles that
 * hold builder.publish are exactly the ones architecture § 13 names as
 * the review authority for sensitive changes.
 */
async function publishVersion({ context, projectId, versionId }) {
  const website = await getWebsite(context, projectId);
  const version = await getVersion(context, projectId, versionId);
  if (version.status === 'published') throw invalid('This version is already published', 422);

  await version.update({ status: 'published', publishedAt: new Date() });
  await website.update({ currentPublishedVersionId: version.id });
  return version;
}

/**
 * Restoring never rewrites history (current-phase-plan.md § 2c) — it
 * points the website's mutable draftSchema at an older version's
 * immutable snapshot AND appends a brand-new version capturing that
 * restored state, so the act of restoring is itself part of the
 * append-only log rather than a silent, unrecorded mutation.
 */
async function restoreVersion({
  context, projectId, versionId, actorUserId,
}) {
  const website = await getWebsite(context, projectId);
  const version = await getVersion(context, projectId, versionId);
  const requiresReview = await authorizeAndClassifySchemaChange(context, website, version.schema);
  const versionNumber = await getNextVersionNumberForWebsite(website.id);

  await WebsiteVersion.create({
    websiteId: website.id,
    organizationId: website.organizationId,
    agencyOrganizationId: website.agencyOrganizationId,
    versionNumber,
    label: `Restored to v${version.versionNumber}`,
    schema: version.schema,
    isAutosave: false,
    status: 'draft',
    createdByUserId: actorUserId,
  });

  await website.update({
    draftSchema: version.schema,
    draftHasPendingReviewChanges: website.draftHasPendingReviewChanges || requiresReview,
  });
  return website;
}

module.exports = {
  getWebsite,
  createWebsite,
  updateDraftSchema,
  listVersions,
  getVersion,
  createCheckpoint,
  restoreVersion,
  publishVersion,
};
