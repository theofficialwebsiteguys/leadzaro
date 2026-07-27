'use strict';

const crypto = require('node:crypto');

/**
 * Default tokens/schema for a brand-new 'blank' website, and the
 * shared starter-schema assembly used by 'template'/'page_kit'/
 * 'guided' (current-phase-plan.md § 2n).
 */
const DEFAULT_DESIGN_TOKENS = {
  colors: {
    primary: '#2563eb', secondary: '#1e293b', background: '#ffffff', text: '#0f172a',
  },
  fonts: { heading: 'Inter', body: 'Inter' },
  spacingScale: [4, 8, 12, 16, 24, 32, 48, 64],
  radii: { sm: 4, md: 8, lg: 16 },
};

function buildBlankSchema() {
  return {
    pages: [
      {
        id: 'page_home', route: '/', title: 'Home', sections: [],
      },
    ],
    navigation: { items: [{ label: 'Home', route: '/' }] },
    siteSettings: {},
    organizationContent: {},
  };
}

// 'template' assembles a fuller starting homepage; 'page_kit' is
// deliberately smaller ("a partial, page-level starting point" — § 2n).
// Both are tolerant of a library missing one of these componentKeys
// (an agency's own section library may not define every one) — found
// keys are used in order, missing ones are simply skipped rather than
// failing the whole assembly.
const TEMPLATE_STARTER_COMPONENT_KEYS = ['hero', 'text', 'cta'];
const PAGE_KIT_STARTER_COMPONENT_KEYS = ['hero'];

const DEFAULT_VALUE_BY_PROPERTY_TYPE = {
  text: '',
  richtext: '',
  number: 0,
  select: '',
  image: null,
  form_fields: [],
  form_submit_target: null,
};

/**
 * Instantiates one section from a SectionDefinition, populating every
 * settingsSchema property with a type-appropriate empty default so the
 * result is immediately valid content for the schema-diff/editing-level
 * classifier (§ 2e) to walk, not a placeholder shape it has to special-
 * case. Every property lands in `settings` here; content vs. settings
 * placement is otherwise a builder-UI concern this phase doesn't
 * prescribe further for auto-assembled starter sections.
 */
function buildDefaultSectionInstance(sectionDefinition) {
  const settings = {};
  for (const [key, propertySchema] of Object.entries(sectionDefinition.settingsSchema || {})) {
    settings[key] = DEFAULT_VALUE_BY_PROPERTY_TYPE[propertySchema.type] ?? null;
  }
  return {
    id: crypto.randomUUID(),
    componentKey: sectionDefinition.componentKey,
    variant: Array.isArray(sectionDefinition.variants) ? sectionDefinition.variants[0] : undefined,
    settings,
    content: {},
  };
}

/**
 * Shared by 'template' (a fixed curated list), 'page_kit' (a shorter
 * fixed list), and 'guided' (an explicit caller-chosen list — the
 * "wizard-driven assembly" § 2n describes, backed by the same
 * assembly primitive). `sectionDefinitions` must already be the
 * caller's own visible, published set (current-phase-plan.md § 2n) —
 * this function does no visibility filtering of its own.
 */
function buildStarterSchema(sectionDefinitions, componentKeys) {
  const definitionsByKey = new Map(sectionDefinitions.map((definition) => [definition.componentKey, definition]));
  const sections = componentKeys
    .map((key) => definitionsByKey.get(key))
    .filter(Boolean)
    .map((definition) => buildDefaultSectionInstance(definition));

  return {
    pages: [
      {
        id: 'page_home', route: '/', title: 'Home', sections,
      },
    ],
    navigation: { items: [{ label: 'Home', route: '/' }] },
    siteSettings: {},
    organizationContent: {},
  };
}

module.exports = {
  DEFAULT_DESIGN_TOKENS,
  buildBlankSchema,
  buildStarterSchema,
  TEMPLATE_STARTER_COMPONENT_KEYS,
  PAGE_KIT_STARTER_COMPONENT_KEYS,
};
