'use strict';

/**
 * Structural technical audit checks (Phase 8 slice 4, current-phase-
 * plan.md § 2c) — run directly against WebsiteVersion.schema, no
 * adapter needed, matching the "structural correctness over full
 * external-tool simulation" precedent (Phase 5's preview renderer,
 * Phase 6's generator). Deliberately scoped to what this schema shape
 * actually models: there is no explicit heading-level (H1/H2/...)
 * metadata anywhere in a section's content/settings, so "heading
 * order" is checked as page-title presence (the one heading-shaped
 * field the schema genuinely carries) rather than forcing a semantic
 * concept the data doesn't support — a deliberate, named scope
 * decision, not an oversight.
 */

const CHECKS = {
  MISSING_PAGE_TITLE: 'missing_page_title',
  EMPTY_PAGE: 'empty_page',
  MISSING_ALT_TEXT: 'missing_alt_text',
  MISSING_META_TITLE: 'missing_meta_title',
  MISSING_META_DESCRIPTION: 'missing_meta_description',
};

/**
 * An image-type content property's alt text lives at a sibling
 * `<key>Alt` property — no separate alt-text model exists, so this is
 * the one convention available to check against.
 */
function findMissingAltText(page, section, settingsSchema) {
  const content = section.content || {};
  const findings = [];
  for (const [key, propDef] of Object.entries(settingsSchema)) {
    if (propDef.type !== 'image') continue;
    if (!content[key]) continue;
    const altValue = content[`${key}Alt`];
    if (!altValue || !String(altValue).trim()) {
      findings.push({
        check: CHECKS.MISSING_ALT_TEXT,
        severity: 'error',
        pageId: page.id,
        sectionId: section.id,
        message: `Section "${section.id}" on page "${page.id}" has an image ("${key}") with no alt text`,
      });
    }
  }
  return findings;
}

function runStructuralAudit(schema, sectionDefinitionsByKey = new Map(), seoSettingsByPageId = new Map()) {
  const findings = [];
  const pages = schema?.pages || [];

  for (const page of pages) {
    if (!page.title?.trim()) {
      findings.push({
        check: CHECKS.MISSING_PAGE_TITLE, severity: 'error', pageId: page.id, message: `Page "${page.id}" has no title`,
      });
    }
    if (!page.sections || page.sections.length === 0) {
      findings.push({
        check: CHECKS.EMPTY_PAGE, severity: 'warning', pageId: page.id, message: `Page "${page.id}" has no sections`,
      });
    }

    for (const section of page.sections || []) {
      const definition = sectionDefinitionsByKey.get(section.componentKey);
      findings.push(...findMissingAltText(page, section, definition?.settingsSchema || {}));
    }

    const seoSettings = seoSettingsByPageId.get(page.id);
    if (!seoSettings?.metaTitle) {
      findings.push({
        check: CHECKS.MISSING_META_TITLE, severity: 'warning', pageId: page.id, message: `Page "${page.id}" has no SEO meta title set`,
      });
    }
    if (!seoSettings?.metaDescription) {
      findings.push({
        check: CHECKS.MISSING_META_DESCRIPTION, severity: 'warning', pageId: page.id, message: `Page "${page.id}" has no SEO meta description set`,
      });
    }
  }

  return findings;
}

module.exports = { runStructuralAudit, CHECKS };
