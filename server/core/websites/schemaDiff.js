'use strict';

function pagesSignature(pages) {
  return (pages || []).map((page) => `${page.id}:${page.route}`).join('|');
}

function sectionsSignature(sections) {
  return (sections || []).map((section) => section.id).join('|');
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
 * separately from the per-property change list.
 */
function diffSchemaChanges(oldSchema, newSchema, sectionDefinitionsByKey) {
  const changes = [];
  let structuralChange = false;

  const oldPages = oldSchema?.pages || [];
  const newPages = newSchema?.pages || [];
  if (pagesSignature(oldPages) !== pagesSignature(newPages)) structuralChange = true;

  const oldPagesById = new Map(oldPages.map((page) => [page.id, page]));
  for (const newPage of newPages) {
    const oldPage = oldPagesById.get(newPage.id);
    if (!oldPage) continue; // a brand-new page — already counted as structural above

    if (sectionsSignature(oldPage.sections) !== sectionsSignature(newPage.sections)) structuralChange = true;

    const oldSectionsById = new Map((oldPage.sections || []).map((section) => [section.id, section]));
    for (const newSection of newPage.sections || []) {
      const oldSection = oldSectionsById.get(newSection.id);
      if (!oldSection) continue; // a brand-new section — already counted as structural above

      const definition = sectionDefinitionsByKey.get(newSection.componentKey);
      for (const bucket of ['settings', 'content']) {
        const oldBucket = oldSection[bucket] || {};
        const newBucket = newSection[bucket] || {};
        const keys = new Set([...Object.keys(oldBucket), ...Object.keys(newBucket)]);
        for (const key of keys) {
          if (JSON.stringify(oldBucket[key]) === JSON.stringify(newBucket[key])) continue;
          const entry = definition?.settingsSchema?.[key];
          changes.push({
            pageId: newPage.id,
            sectionId: newSection.id,
            key,
            editingLevel: entry?.editingLevel || 'advanced',
            requiresReview: entry ? !!entry.requiresReview : true,
          });
        }
      }
    }
  }

  return { changes, structuralChange };
}

module.exports = { diffSchemaChanges };
