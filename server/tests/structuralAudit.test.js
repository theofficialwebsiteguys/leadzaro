'use strict';

const { runStructuralAudit, CHECKS } = require('../core/seo/structuralAudit');

const SECTION_DEFINITIONS_BY_KEY = new Map([
  ['hero', {
    componentKey: 'hero',
    settingsSchema: { heading: { type: 'text' }, backgroundImage: { type: 'image' } },
  }],
  ['text', { componentKey: 'text', settingsSchema: { body: { type: 'richtext' } } }],
]);

function pageWith(overrides) {
  return {
    id: 'page_home', route: '/', title: 'Home', sections: [], ...overrides,
  };
}

describe('runStructuralAudit', () => {
  test('a well-formed page with an alt-texted image and no SEO settings only reports the missing meta findings', () => {
    const schema = {
      pages: [pageWith({
        sections: [{
          id: 's1', componentKey: 'hero', content: { heading: 'Welcome', backgroundImage: 'https://x/img.jpg', backgroundImageAlt: 'A welcoming hero image' },
        }],
      })],
    };
    const findings = runStructuralAudit(schema, SECTION_DEFINITIONS_BY_KEY);
    const checks = findings.map((f) => f.check);
    expect(checks).not.toContain(CHECKS.MISSING_ALT_TEXT);
    expect(checks).not.toContain(CHECKS.MISSING_PAGE_TITLE);
    expect(checks).not.toContain(CHECKS.EMPTY_PAGE);
    expect(checks).toContain(CHECKS.MISSING_META_TITLE);
    expect(checks).toContain(CHECKS.MISSING_META_DESCRIPTION);
  });

  test('flags a missing page title', () => {
    const schema = { pages: [pageWith({ title: '', sections: [{ id: 's1', componentKey: 'text', content: { body: 'hi' } }] })] };
    const findings = runStructuralAudit(schema, SECTION_DEFINITIONS_BY_KEY);
    expect(findings.some((f) => f.check === CHECKS.MISSING_PAGE_TITLE)).toBe(true);
  });

  test('flags an empty page (no sections)', () => {
    const schema = { pages: [pageWith({ sections: [] })] };
    const findings = runStructuralAudit(schema, SECTION_DEFINITIONS_BY_KEY);
    expect(findings.some((f) => f.check === CHECKS.EMPTY_PAGE)).toBe(true);
  });

  test('flags an image with no alt text, but not an image with a blank/whitespace-only alt', () => {
    const schema = {
      pages: [pageWith({
        sections: [
          { id: 's1', componentKey: 'hero', content: { heading: 'A', backgroundImage: 'https://x/1.jpg' } },
          { id: 's2', componentKey: 'hero', content: { heading: 'B', backgroundImage: 'https://x/2.jpg', backgroundImageAlt: '   ' } },
        ],
      })],
    };
    const findings = runStructuralAudit(schema, SECTION_DEFINITIONS_BY_KEY);
    const altFindings = findings.filter((f) => f.check === CHECKS.MISSING_ALT_TEXT);
    expect(altFindings.length).toBe(2);
    expect(altFindings.map((f) => f.sectionId).sort()).toEqual(['s1', 's2']);
  });

  test('never flags an image field with no image actually set (nothing to have alt text for)', () => {
    const schema = {
      pages: [pageWith({ sections: [{ id: 's1', componentKey: 'hero', content: { heading: 'A' } }] })],
    };
    const findings = runStructuralAudit(schema, SECTION_DEFINITIONS_BY_KEY);
    expect(findings.some((f) => f.check === CHECKS.MISSING_ALT_TEXT)).toBe(false);
  });

  test('never flags a non-image property, however named', () => {
    const schema = {
      pages: [pageWith({ sections: [{ id: 's1', componentKey: 'text', content: { body: 'no images here' } }] })],
    };
    const findings = runStructuralAudit(schema, SECTION_DEFINITIONS_BY_KEY);
    expect(findings.some((f) => f.check === CHECKS.MISSING_ALT_TEXT)).toBe(false);
  });

  test('honors provided seoSettingsByPageId — no missing-meta findings once both are set', () => {
    const schema = { pages: [pageWith({ sections: [{ id: 's1', componentKey: 'text', content: { body: 'hi' } }] })] };
    const seoSettingsByPageId = new Map([['page_home', { metaTitle: 'Home', metaDescription: 'Welcome' }]]);
    const findings = runStructuralAudit(schema, SECTION_DEFINITIONS_BY_KEY, seoSettingsByPageId);
    expect(findings.some((f) => f.check === CHECKS.MISSING_META_TITLE)).toBe(false);
    expect(findings.some((f) => f.check === CHECKS.MISSING_META_DESCRIPTION)).toBe(false);
  });

  test('an unknown componentKey (no matching definition) is skipped safely, not thrown', () => {
    const schema = { pages: [pageWith({ sections: [{ id: 's1', componentKey: 'nonexistent', content: {} }] })] };
    expect(() => runStructuralAudit(schema, SECTION_DEFINITIONS_BY_KEY)).not.toThrow();
  });

  test('an empty schema (no pages) produces no findings', () => {
    expect(runStructuralAudit({ pages: [] })).toEqual([]);
    expect(runStructuralAudit(null)).toEqual([]);
    expect(runStructuralAudit(undefined)).toEqual([]);
  });

  test('findings across multiple pages are all independently reported', () => {
    const schema = {
      pages: [
        pageWith({ id: 'page_home', sections: [] }),
        pageWith({ id: 'page_about', title: '', sections: [{ id: 's1', componentKey: 'text', content: {} }] }),
      ],
    };
    const findings = runStructuralAudit(schema, SECTION_DEFINITIONS_BY_KEY);
    expect(findings.filter((f) => f.pageId === 'page_home').some((f) => f.check === CHECKS.EMPTY_PAGE)).toBe(true);
    expect(findings.filter((f) => f.pageId === 'page_about').some((f) => f.check === CHECKS.MISSING_PAGE_TITLE)).toBe(true);
  });
});
