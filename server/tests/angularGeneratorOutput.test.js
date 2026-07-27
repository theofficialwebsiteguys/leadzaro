'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { generateWebsiteFiles } = require('../core/codegen/generateWebsiteFiles');
const { assertManifestIsGeneratorOwned } = require('../core/codegen/angularGenerator');

const REPO_ROOT = path.resolve(__dirname, '..', '..');

const SECTION_DEFINITIONS_BY_KEY = new Map([
  ['hero', {
    componentKey: 'hero',
    state: 'managed',
    settingsSchema: {
      heading: { type: 'text' }, subheading: { type: 'text' }, backgroundImage: { type: 'image' }, layout: { type: 'select' },
    },
  }],
  ['text', { componentKey: 'text', state: 'managed', settingsSchema: { body: { type: 'richtext' } } }],
  ['cta', {
    componentKey: 'cta',
    state: 'managed',
    settingsSchema: { label: { type: 'text' }, targetRoute: { type: 'text' } },
  }],
]);

function buildMultiPageSchema() {
  return {
    pages: [
      {
        id: 'page_home',
        route: '/',
        title: 'Home',
        sections: [
          {
            id: 'hero-1', componentKey: 'hero', variant: 'centered', content: { heading: 'Welcome', subheading: 'We build things' }, settings: { layout: 'centered' },
          },
          { id: 'text-1', componentKey: 'text', content: { body: 'About our company.' } },
          { id: 'cta-1', componentKey: 'cta', content: { label: 'Get in touch', targetRoute: '/contact' } },
        ],
      },
      {
        id: 'page_contact',
        route: '/contact',
        title: 'Contact',
        sections: [
          { id: 'text-2', componentKey: 'text', content: { body: 'Reach out any time.' } },
        ],
      },
    ],
    navigation: { items: [{ label: 'Home', route: '/' }, { label: 'Contact', route: '/contact' }] },
    siteSettings: {},
    organizationContent: {},
  };
}

/**
 * Writes the generator's manifest to a real temp directory and typechecks
 * it with the project's own `tsc` against the project's own installed
 * `@angular/core`/`@angular/router` types. This proves the generated
 * TypeScript itself is real and compiling — not a full `ng build`
 * (which needs a complete Angular CLI workspace and template-compiler
 * pipeline, out of scope for a fast unit test), but a genuine, meaningful
 * "does this actually typecheck" proof rather than only asserting on
 * generated string content.
 */
function typecheckGeneratedFiles(files) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'leadzaro-codegen-'));
  try {
    for (const file of files) {
      if (!file.path.endsWith('.ts')) continue;
      const fullPath = path.join(tempDir, file.path);
      fs.mkdirSync(path.dirname(fullPath), { recursive: true });
      fs.writeFileSync(fullPath, file.content);
    }

    const angularNodeModules = path.join(REPO_ROOT, 'node_modules').replace(/\\/g, '/');
    const tsconfig = {
      compilerOptions: {
        target: 'ES2022',
        module: 'ES2022',
        moduleResolution: 'bundler',
        experimentalDecorators: true,
        useDefineForClassFields: false,
        strict: true,
        skipLibCheck: true,
        noEmit: true,
        baseUrl: '.',
        paths: { '@angular/*': [`${angularNodeModules}/@angular/*`] },
      },
      include: ['**/*.ts'],
    };
    fs.writeFileSync(path.join(tempDir, 'tsconfig.json'), JSON.stringify(tsconfig, null, 2));

    const tscBin = path.join(REPO_ROOT, 'node_modules', '.bin', process.platform === 'win32' ? 'tsc.cmd' : 'tsc');
    execFileSync(tscBin, ['-p', path.join(tempDir, 'tsconfig.json')], {
      cwd: tempDir, stdio: 'pipe', shell: process.platform === 'win32',
    });
    return { success: true };
  } catch (err) {
    return { success: false, output: (err.stdout || err.message || '').toString() };
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

describe('generateWebsiteFiles (Phase 6 slice 4)', () => {
  test('produces a manifest entirely within the generator-owned boundary', () => {
    const files = generateWebsiteFiles({
      schema: buildMultiPageSchema(),
      sectionDefinitionsByKey: SECTION_DEFINITIONS_BY_KEY,
      designTokens: { colors: { primary: '#2563eb' }, fonts: { body: 'Inter' } },
      websiteId: 'website-1',
      websiteVersionId: 'version-1',
      generatedAt: '2026-01-01T00:00:00.000Z',
    });

    expect(() => assertManifestIsGeneratorOwned(files)).not.toThrow();
    expect(files.length).toBeGreaterThan(0);
  });

  test('generates exactly one page component per page, one standard component per unique componentKey actually used, and the fixed config/style files', () => {
    const files = generateWebsiteFiles({
      schema: buildMultiPageSchema(),
      sectionDefinitionsByKey: SECTION_DEFINITIONS_BY_KEY,
      designTokens: { colors: {}, fonts: {} },
      websiteId: 'website-1',
      websiteVersionId: 'version-1',
      generatedAt: '2026-01-01T00:00:00.000Z',
    });
    const paths = files.map((f) => f.path);

    expect(paths).toContain('generated/pages/page-home.component.ts');
    expect(paths).toContain('generated/pages/page-contact.component.ts');
    expect(paths).toContain('components/standard/hero.component.ts');
    expect(paths).toContain('components/standard/text.component.ts');
    expect(paths).toContain('components/standard/cta.component.ts');
    // Only one file per componentKey even though 'text' is used on both pages.
    expect(paths.filter((p) => p === 'components/standard/text.component.ts').length).toBe(1);
    expect(paths).toContain('generated/configuration/routes.ts');
    expect(paths).toContain('styles/design-tokens.scss');
    expect(paths).toContain('styles/global.scss');
    expect(paths).toContain('site.schema.json');
    expect(paths).toContain('leadzaro.config.json');
  });

  test('the routes file maps each page\'s schema route to its generated component, with the root "/" mapping to the empty Angular path', () => {
    const files = generateWebsiteFiles({
      schema: buildMultiPageSchema(),
      sectionDefinitionsByKey: SECTION_DEFINITIONS_BY_KEY,
      designTokens: { colors: {}, fonts: {} },
      websiteId: 'website-1',
      websiteVersionId: 'version-1',
      generatedAt: '2026-01-01T00:00:00.000Z',
    });
    const routesFile = files.find((f) => f.path === 'generated/configuration/routes.ts');
    expect(routesFile.content).toMatch(/path: '',\s*component: PageHomeComponent/);
    expect(routesFile.content).toMatch(/path: 'contact',\s*component: PageContactComponent/);
  });

  test('the generated site.schema.json is a faithful, re-parseable copy of the source schema', () => {
    const schema = buildMultiPageSchema();
    const files = generateWebsiteFiles({
      schema,
      sectionDefinitionsByKey: SECTION_DEFINITIONS_BY_KEY,
      designTokens: { colors: {}, fonts: {} },
      websiteId: 'website-1',
      websiteVersionId: 'version-1',
      generatedAt: '2026-01-01T00:00:00.000Z',
    });
    const schemaFile = files.find((f) => f.path === 'site.schema.json');
    expect(JSON.parse(schemaFile.content)).toEqual(schema);
  });

  test(
    'the generated TypeScript actually typechecks against the project\'s real @angular/core and @angular/router types',
    () => {
      const files = generateWebsiteFiles({
        schema: buildMultiPageSchema(),
        sectionDefinitionsByKey: SECTION_DEFINITIONS_BY_KEY,
        designTokens: { colors: { primary: '#2563eb' }, fonts: { body: 'Inter' } },
        websiteId: 'website-1',
        websiteVersionId: 'version-1',
        generatedAt: '2026-01-01T00:00:00.000Z',
      });

      const result = typecheckGeneratedFiles(files);
      if (!result.success) {
        // Surface the real tsc diagnostics in the failure — essential for
        // ever debugging a generator regression, not just "it failed".
        throw new Error(`Generated Angular output failed to typecheck:\n${result.output}`);
      }
      expect(result.success).toBe(true);
    },
    30000
  );
});
