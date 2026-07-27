'use strict';

const { DesignSystem, Website, WebsiteVersion } = require('../../models');
const {
  getProjectByIdForRequester, getWebsiteByProjectIdForRequester, getWebsiteByIdForRequester,
  listWebsiteVersionsForRequester, getWebsiteVersionByIdForRequester, getNextVersionNumberForWebsite,
} = require('../../core/authorization/clientVisibleModels');
const { DEFAULT_DESIGN_TOKENS, buildBlankSchema } = require('../../core/websites/websiteCatalog');

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
 * Coarse-grained for this slice — saves the whole draftSchema
 * unconditionally. current-phase-plan.md § 2e's per-property editing-
 * level classification (rejecting a Basic-assigned editor's attempt to
 * change a Professional-tier property) lands in slice 3, alongside the
 * builder.edit/builder.publish enforcement this slice only gates at
 * the broad route level.
 */
async function updateDraftSchema({ context, projectId, draftSchema }) {
  const website = await getWebsite(context, projectId);
  await website.update({ draftSchema });
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

async function createCheckpoint({
  context, projectId, label, actorUserId,
}) {
  const website = await getWebsite(context, projectId);
  const versionNumber = await getNextVersionNumberForWebsite(website.id);

  return WebsiteVersion.create({
    websiteId: website.id,
    organizationId: website.organizationId,
    agencyOrganizationId: website.agencyOrganizationId,
    versionNumber,
    label: label || null,
    schema: website.draftSchema,
    isAutosave: false,
    status: 'draft',
    createdByUserId: actorUserId,
  });
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

  await website.update({ draftSchema: version.schema });
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
};
