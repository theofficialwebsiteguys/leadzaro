'use strict';

/**
 * Default tokens/schema for a brand-new 'blank' website — the only
 * starting mode besides 'template' this slice needs to produce a real
 * starting draftSchema for (current-phase-plan.md § 2n). 'page_kit'/
 * 'guided' are deferred to a later slice once the section library
 * exists to build on.
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

module.exports = { DEFAULT_DESIGN_TOKENS, buildBlankSchema };
