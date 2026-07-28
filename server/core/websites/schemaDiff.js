'use strict';

const { resolveEffectiveComponentState } = require('./componentState');

function pagesSignature(pages) {
  return (pages || []).map((page) => `${page.id}:${page.route}`).join('|');
}

function sectionsSignature(sections) {
  return (sections || []).map((section) => section.id).join('|');
}

/**
 * Diffs one of the two website-global content scopes (current-phase-
 * plan.md § 2f: siteSettings, organizationContent — as distinct from
 * page/section content). Every changed key here is classified
 * 'professional' + requiresReview: true unconditionally, never looked
 * up per-key — architecture § 13 names "design, navigation... legal
 * copy" as requiring review regardless of who's editing, and these two
 * maps are precisely the cross-page, not-scoped-to-any-one-section
 * content architecture § 13 is describing (e.g. business NAP data,
 * site-wide header/footer content).
 */
function diffGlobalContentScope(oldSchema, newSchema, scope) {
  const oldBucket = oldSchema?.[scope] || {};
  const newBucket = newSchema?.[scope] || {};
  const keys = new Set([...Object.keys(oldBucket), ...Object.keys(newBucket)]);
  const changes = [];
  for (const key of keys) {
    if (JSON.stringify(oldBucket[key]) === JSON.stringify(newBucket[key])) continue;
    changes.push({
      scope, key, editingLevel: 'professional', requiresReview: true,
    });
  }
  return changes;
}

/**
 * All changes for one section instance — split out of diffSchemaChanges
 * purely to keep that function's cognitive complexity down; the state/
 * bucket-walking rules themselves are documented on diffSchemaChanges.
 */
function diffSectionChanges(oldSection, newSection, pageId, definition) {
  const changes = [];

  // The instance's state BEFORE this change — Phase 6 § 2c/§ 2d: callers
  // use this to apply the extra "a detached instance rejects content
  // edits and non-builderEditable settings edits" rule on top of the
  // ordinary per-property editingLevel check. Deliberately the OLD
  // state, never the new one — what an instance was about to become is
  // irrelevant to what it currently protects.
  const sectionState = resolveEffectiveComponentState(oldSection, definition);

  const oldInstanceState = oldSection.state || 'inherited';
  const newInstanceState = newSection.state || 'inherited';
  if (oldInstanceState !== newInstanceState) {
    // Toggling detachment itself is always advanced+requiresReview — the
    // safe-by-default direction, same reasoning as an unrecognized
    // settingsSchema key, until a dedicated detach/re-attach action (a
    // later slice) supersedes editing this field through the ordinary
    // draft-save path at all.
    changes.push({
      scope: 'section', pageId, sectionId: newSection.id, key: 'state', sectionState, editingLevel: 'advanced', requiresReview: true,
    });
  }

  for (const bucket of ['settings', 'content']) {
    const oldBucket = oldSection[bucket] || {};
    const newBucket = newSection[bucket] || {};
    const keys = new Set([...Object.keys(oldBucket), ...Object.keys(newBucket)]);
    for (const key of keys) {
      if (JSON.stringify(oldBucket[key]) === JSON.stringify(newBucket[key])) continue;
      const entry = definition?.settingsSchema?.[key];
      changes.push({
        scope: 'section',
        pageId,
        sectionId: newSection.id,
        bucket,
        key,
        sectionState,
        builderEditable: !!entry?.builderEditable,
        editingLevel: entry?.editingLevel || 'advanced',
        requiresReview: entry ? !!entry.requiresReview : true,
      });
    }
  }

  return changes;
}

/**
 * Closing-review fix (High): a section instance removed entirely from
 * a page previously produced NO change entry at all — only the
 * aggregate structuralChange flag (professional+, the same undifferentiated
 * bar as a harmless reorder) — meaning a detached instance's content/
 * settings were unremovable through the builder (blocked by
 * authorizeAndClassifySchemaChange above) but the WHOLE INSTANCE could
 * simply be deleted from the page with no additional check at all.
 * Deletion is strictly more destructive than any single content/settings
 * edit, so it must be classified at least as strictly — reusing the
 * exact same `bucket: 'content'` shape the content-edit rule already
 * checks, rather than inventing a parallel rule that could drift from it.
 */
function diffRemovedSections(oldPage, newPage, sectionDefinitionsByKey) {
  const newSectionIds = new Set((newPage.sections || []).map((section) => section.id));
  const removedSections = (oldPage.sections || []).filter((section) => !newSectionIds.has(section.id));

  return removedSections.map((oldSection) => {
    const definition = sectionDefinitionsByKey.get(oldSection.componentKey);
    const sectionState = resolveEffectiveComponentState(oldSection, definition);
    return {
      scope: 'section',
      pageId: newPage.id,
      sectionId: oldSection.id,
      bucket: 'content',
      key: '__removed__',
      sectionState,
      builderEditable: false,
      editingLevel: 'advanced',
      requiresReview: true,
    };
  });
}

/**
 * Compares an old and new draftSchema and classifies every actual
 * change against each section's own SectionDefinition.settingsSchema
 * (current-phase-plan.md § 2e's per-property editing-level design —
 * the review's own load-bearing correction to the original single-
 * scalar-per-section draft). A property with no matching settingsSchema
 * entry defaults to editingLevel: 'advanced' + requiresReview: true —
 * the safe-by-default direction, since an unrecognized key is exactly
 * the shape a crafted payload would use to bypass classification if
 * unknown keys were instead assumed harmless.
 *
 * A structural change (a page added/removed/reordered, or a page's own
 * section list added/removed/reordered) is always requiresReview and
 * requires at least 'professional', regardless of any single property's
 * own tag, since it isn't a property of any one section — reported
 * separately from the per-property change list. siteSettings/
 * organizationContent changes (§ 2f) are diffed the same way, always
 * at 'professional'/requiresReview — see diffGlobalContentScope.
 */
function diffSchemaChanges(oldSchema, newSchema, sectionDefinitionsByKey) {
  const changes = [
    ...diffGlobalContentScope(oldSchema, newSchema, 'siteSettings'),
    ...diffGlobalContentScope(oldSchema, newSchema, 'organizationContent'),
  ];
  let structuralChange = false;

  const oldPages = oldSchema?.pages || [];
  const newPages = newSchema?.pages || [];
  if (pagesSignature(oldPages) !== pagesSignature(newPages)) structuralChange = true;

  const oldPagesById = new Map(oldPages.map((page) => [page.id, page]));
  for (const newPage of newPages) {
    const oldPage = oldPagesById.get(newPage.id);
    if (!oldPage) continue; // a brand-new page — already counted as structural above

    if (sectionsSignature(oldPage.sections) !== sectionsSignature(newPage.sections)) structuralChange = true;

    changes.push(...diffRemovedSections(oldPage, newPage, sectionDefinitionsByKey));

    const oldSectionsById = new Map((oldPage.sections || []).map((section) => [section.id, section]));
    for (const newSection of newPage.sections || []) {
      const oldSection = oldSectionsById.get(newSection.id);
      if (!oldSection) continue; // a brand-new section — already counted as structural above

      const definition = sectionDefinitionsByKey.get(newSection.componentKey);
      changes.push(...diffSectionChanges(oldSection, newSection, newPage.id, definition));
    }
  }

  return { changes, structuralChange };
}

module.exports = { diffSchemaChanges };
