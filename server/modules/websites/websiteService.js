'use strict';

const { DesignSystem, Website, WebsiteVersion } = require('../../models');
const {
  getProjectByIdForRequester, getWebsiteByProjectIdForRequester, getWebsiteByIdForRequester,
  listWebsiteVersionsForRequester, getWebsiteVersionByIdForRequester, getNextVersionNumberForWebsite,
  pruneOldAutosaveVersions, listSectionDefinitionsForRequester, getDesignSystemLibraryTemplateByIdForRequester,
} = require('../../core/authorization/clientVisibleModels');
const {
  DEFAULT_DESIGN_TOKENS, buildBlankSchema, buildStarterSchema, TEMPLATE_STARTER_COMPONENT_KEYS, PAGE_KIT_STARTER_COMPONENT_KEYS,
} = require('../../core/websites/websiteCatalog');
const { resolveEffectiveEditingLevel, levelSatisfies } = require('../../core/websites/editingLevel');
const { diffSchemaChanges } = require('../../core/websites/schemaDiff');
const { resolveEffectiveComponentState } = require('../../core/websites/componentState');
const requestService = require('../requests/requestService');

// Named checkpoints and published versions are never pruned — only the
// autosave trail is bounded, so a website with heavy churn doesn't grow
// its version history unboundedly (current-phase-plan.md § 2c).
const AUTOSAVE_RETENTION_COUNT = 5;

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
 * Resolves the starting draftSchema (and, for 'template', the tokens to
 * fork) for each mode (current-phase-plan.md § 2n):
 *  - 'blank': an empty homepage, as before.
 *  - 'template': a full curated starter homepage, forking a library
 *    DesignSystem's tokens for branding — employee-only (§ 2a: a
 *    library template is "visible only to employees... never to a
 *    client directly"), and requires an explicit designSystemTemplateId
 *    so the caller must have actually seen it via the browsing list.
 *  - 'page_kit': the same assembly as 'template' but with a shorter
 *    fixed section list ("a partial, page-level starting point") and
 *    no design-system selection — open to clients too, same as 'blank'.
 *  - 'guided': the identical assembly primitive, but the section list
 *    is the caller's own explicit choice rather than a fixed curated
 *    one — the "wizard-driven assembly"; each chosen key is validated
 *    against the caller's own visible, published section library.
 * Every non-blank mode's section list is tolerant of gaps (an agency's
 * library may not define every curated key) except 'guided', where an
 * unrecognized key is a caller error, not a silent gap — the whole
 * point of a guided pick is that every choice came from a real list.
 */
async function resolveStartingSchema({
  context, startingMode, designSystemTemplateId, sectionComponentKeys,
}) {
  if (startingMode === 'blank') {
    return { draftSchema: buildBlankSchema(), tokens: DEFAULT_DESIGN_TOKENS, forkedFromDesignSystemId: null };
  }

  if (startingMode === 'template') {
    if (context.membership.membershipType === 'client') {
      throw invalid('Only an agency employee can start a website from a library template', 403);
    }
    if (!designSystemTemplateId) throw invalid('designSystemTemplateId is required for the template starting mode');
    const libraryTemplate = await getDesignSystemLibraryTemplateByIdForRequester(context, designSystemTemplateId);
    if (!libraryTemplate) throw invalid('Design system template not found', 404);

    const sectionDefinitions = await listSectionDefinitionsForRequester(context);
    return {
      draftSchema: buildStarterSchema(sectionDefinitions, TEMPLATE_STARTER_COMPONENT_KEYS),
      tokens: libraryTemplate.tokens,
      forkedFromDesignSystemId: libraryTemplate.id,
    };
  }

  if (startingMode === 'page_kit') {
    const sectionDefinitions = await listSectionDefinitionsForRequester(context);
    return {
      draftSchema: buildStarterSchema(sectionDefinitions, PAGE_KIT_STARTER_COMPONENT_KEYS),
      tokens: DEFAULT_DESIGN_TOKENS,
      forkedFromDesignSystemId: null,
    };
  }

  // startingMode === 'guided'
  if (!Array.isArray(sectionComponentKeys) || sectionComponentKeys.length === 0) {
    throw invalid('sectionComponentKeys is required for the guided starting mode');
  }
  const sectionDefinitions = await listSectionDefinitionsForRequester(context);
  const visibleKeys = new Set(sectionDefinitions.map((definition) => definition.componentKey));
  const unknownKey = sectionComponentKeys.find((key) => !visibleKeys.has(key));
  if (unknownKey) throw invalid(`Unknown or unavailable section componentKey: ${unknownKey}`, 422);

  return {
    draftSchema: buildStarterSchema(sectionDefinitions, sectionComponentKeys),
    tokens: DEFAULT_DESIGN_TOKENS,
    forkedFromDesignSystemId: null,
  };
}

async function createWebsite({
  context, projectId, name, startingMode, designSystemTemplateId, sectionComponentKeys, actorUserId,
}) {
  const project = await assertProjectAccess(context, projectId);
  if (!Website.STARTING_MODES.includes(startingMode)) throw invalid(`Unknown startingMode: ${startingMode}`);
  if (!name?.trim()) throw invalid('name is required');

  const existing = await getWebsiteByProjectIdForRequester(context, project.id);
  if (existing) throw invalid('This project already has a website', 409);

  const { draftSchema, tokens, forkedFromDesignSystemId } = await resolveStartingSchema({
    context, startingMode, designSystemTemplateId, sectionComponentKeys,
  });

  // Fork, never reference: a client's own DesignSystem row is created
  // fresh here (current-phase-plan.md § 2a correction) so a later edit
  // to any shared library template can never retroactively change this
  // site's already-published tokens.
  const designSystem = await DesignSystem.create({
    agencyOrganizationId: project.agencyOrganizationId,
    organizationId: project.organizationId,
    name: `${name} Design System`,
    tokens,
    isLibraryTemplate: false,
    forkedFromDesignSystemId,
    createdByUserId: actorUserId,
  });

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

  // includeUnpublished: existing content may reference a section whose
  // library entry has since been deprecated (§ 2n governance is
  // additive — it curates what's offered for *new* use, never
  // retroactively strips classification from content already placed).
  const sectionDefinitions = await listSectionDefinitionsForRequester(context, {}, { includeUnpublished: true });
  const sectionDefinitionsByKey = new Map(sectionDefinitions.map((definition) => [definition.componentKey, definition]));
  const { changes, structuralChange } = diffSchemaChanges(website.draftSchema, newSchema, sectionDefinitionsByKey);

  if (structuralChange && !levelSatisfies(effectiveLevel, 'professional')) {
    throw invalid('Adding, removing, or reordering pages or sections requires at least Professional-level editing access', 403);
  }
  const disallowed = changes.find((change) => !levelSatisfies(effectiveLevel, change.editingLevel));
  if (disallowed) {
    throw invalid(`Changing "${disallowed.key}" requires ${disallowed.editingLevel}-level editing access`, 403);
  }

  // The builder-side half of Phase 6's major gate (current-phase-plan.md
  // § 2d — the closing review's second Critical finding): a designer
  // edit must never overwrite developer-owned custom functionality. A
  // detached section instance's `content` is never editable through the
  // ordinary draft-save path at all, and its `settings` only for keys
  // the component's own settingsSchema explicitly opts in with
  // builderEditable: true — regardless of the requester's own editing
  // level, since this isn't a trust-tier question, it's "this territory
  // now belongs to hand-authored custom code, not the builder."
  // Reordering/moving a detached instance is unaffected (no bucket/key
  // change is involved in a pure reorder, which is already covered by
  // the structural-change check above).
  const blockedByDetachment = changes.find((change) => change.sectionState === 'detached' && change.bucket
    && (change.bucket === 'content' || !change.builderEditable));
  if (blockedByDetachment) {
    throw invalid(
      `"${blockedByDetachment.key}" on this section is detached from the builder — it is now custom, developer-owned code and can no longer be edited here`,
      403
    );
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
 * A lightweight, unlabeled snapshot of the current draft — not a real
 * checkpoint (never forces a review-status decision, never clears
 * draftHasPendingReviewChanges, since it's a recovery safety net, not a
 * point a human meant to commit to). The frontend calls this on a timer
 * while a builder.edit holder is actively editing. Pruned to the most
 * recent AUTOSAVE_RETENTION_COUNT rows immediately after creation.
 */
async function createAutosave({ context, projectId, actorUserId }) {
  const website = await getWebsite(context, projectId);
  const versionNumber = await getNextVersionNumberForWebsite(website.id);

  const version = await WebsiteVersion.create({
    websiteId: website.id,
    organizationId: website.organizationId,
    agencyOrganizationId: website.agencyOrganizationId,
    versionNumber,
    label: null,
    schema: website.draftSchema,
    isAutosave: true,
    status: 'draft',
    createdByUserId: actorUserId,
  });

  await pruneOldAutosaveVersions(website.id, AUTOSAVE_RETENTION_COUNT);
  return version;
}

/**
 * The major gate's "compare" requirement — reuses diffSchemaChanges
 * (the same classifier updateDraftSchema/restoreVersion authorize
 * against) purely for its diff output here, with no editing-level
 * enforcement of its own: comparing two versions you can already see is
 * a read, not a mutation.
 */
async function compareVersions({
  context, projectId, fromVersionId, toVersionId,
}) {
  const fromVersion = await getVersion(context, projectId, fromVersionId);
  const toVersion = await getVersion(context, projectId, toVersionId);

  const sectionDefinitions = await listSectionDefinitionsForRequester(context, {}, { includeUnpublished: true });
  const sectionDefinitionsByKey = new Map(sectionDefinitions.map((definition) => [definition.componentKey, definition]));
  const { changes, structuralChange } = diffSchemaChanges(fromVersion.schema, toVersion.schema, sectionDefinitionsByKey);

  return {
    fromVersion: { id: fromVersion.id, versionNumber: fromVersion.versionNumber },
    toVersion: { id: toVersion.id, versionNumber: toVersion.versionNumber },
    structuralChange,
    changes,
  };
}

/**
 * The form builder's one real submit target this phase wires up end-
 * to-end (current-phase-plan.md § 2j): a 'form' section's fields are
 * defined in its own content, submitTarget selects where a submission
 * goes. 'client_request' reuses Phase 4's existing ClientRequest
 * machinery directly rather than inventing new submission-storage
 * plumbing — a form response becomes a real, agency-visible ClientRequest
 * (category 'form') with the submitted field values as its description.
 *
 * This is deliberately an authenticated builder-context test submission
 * (builder.edit-gated, called from within the app), not a real public-
 * visitor submission — this phase has no live-hosted, publicly
 * reachable rendering of a website at all (that's Phase 6 code
 * generation + Phase 7 hosting); it proves the wiring is correct end-
 * to-end so a later phase's real public submission path has a known-
 * working target to call into, not a placeholder.
 */
async function submitTestForm({
  context, projectId, pageId, sectionId, values, submittedByUserId,
}) {
  const website = await getWebsite(context, projectId);
  const page = (website.draftSchema?.pages || []).find((p) => p.id === pageId);
  const section = page?.sections?.find((s) => s.id === sectionId);
  if (!section || section.componentKey !== 'form') throw invalid('Form section not found on this page', 404);

  const submitTarget = section.content?.submitTarget;
  if (!submitTarget || submitTarget.type !== 'client_request') {
    throw invalid('This form has no client_request submitTarget configured', 422);
  }

  return requestService.createRequest({
    context,
    projectId,
    category: 'form',
    description: JSON.stringify(values || {}),
    submittedByUserId,
  });
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
/**
 * Phase 6 § 2d's restore-of-a-pre-detachment-checkpoint edge case: an
 * old version's snapshot can predate a section instance's detachment.
 * Restoring it must never silently re-clobber the now-custom
 * implementation on the next generator run, but it also shouldn't block
 * the entire restore over one instance. For every section in the
 * CURRENT live draft that is currently detached, the target schema's
 * same section id (if the restored version still has it at all) is
 * overwritten with the current draft's own detached instance —
 * preserving the developer-owned custom content/settings exactly as
 * they are right now, while every other page/section restores normally.
 * Returns which section ids were preserved this way so the caller can
 * surface it (never silent, even though it isn't a hard error).
 */
function preserveDetachedInstances(currentDraftSchema, targetSchema, sectionDefinitionsByKey) {
  const preservedSectionIds = [];
  const currentPagesById = new Map((currentDraftSchema?.pages || []).map((page) => [page.id, page]));

  const mergedPages = (targetSchema?.pages || []).map((page) => {
    const currentPage = currentPagesById.get(page.id);
    if (!currentPage) return page;

    const currentSectionsById = new Map((currentPage.sections || []).map((section) => [section.id, section]));
    const mergedSections = (page.sections || []).map((section) => {
      const currentSection = currentSectionsById.get(section.id);
      if (!currentSection) return section;

      const definition = sectionDefinitionsByKey.get(currentSection.componentKey);
      if (resolveEffectiveComponentState(currentSection, definition) !== 'detached') return section;

      preservedSectionIds.push(section.id);
      return currentSection;
    });

    return { ...page, sections: mergedSections };
  });

  return { schema: { ...targetSchema, pages: mergedPages }, preservedSectionIds };
}

async function restoreVersion({
  context, projectId, versionId, actorUserId,
}) {
  const website = await getWebsite(context, projectId);
  const version = await getVersion(context, projectId, versionId);

  const sectionDefinitions = await listSectionDefinitionsForRequester(context, {}, { includeUnpublished: true });
  const sectionDefinitionsByKey = new Map(sectionDefinitions.map((definition) => [definition.componentKey, definition]));
  const { schema: targetSchema, preservedSectionIds } = preserveDetachedInstances(website.draftSchema, version.schema, sectionDefinitionsByKey);

  const requiresReview = await authorizeAndClassifySchemaChange(context, website, targetSchema);
  const versionNumber = await getNextVersionNumberForWebsite(website.id);

  await WebsiteVersion.create({
    websiteId: website.id,
    organizationId: website.organizationId,
    agencyOrganizationId: website.agencyOrganizationId,
    versionNumber,
    label: `Restored to v${version.versionNumber}`,
    schema: targetSchema,
    isAutosave: false,
    status: 'draft',
    createdByUserId: actorUserId,
  });

  await website.update({
    draftSchema: targetSchema,
    draftHasPendingReviewChanges: website.draftHasPendingReviewChanges || requiresReview,
  });
  return { website, preservedSectionIds };
}

module.exports = {
  getWebsite,
  createWebsite,
  updateDraftSchema,
  listVersions,
  getVersion,
  createCheckpoint,
  createAutosave,
  compareVersions,
  restoreVersion,
  publishVersion,
  submitTestForm,
};
