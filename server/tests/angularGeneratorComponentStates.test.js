'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const {
  generateWebsiteFiles, generatePageComponentFile, generateStandardComponentFile,
} = require('../core/codegen/generateWebsiteFiles');
const { assertManifestIsGeneratorOwned } = require('../core/codegen/angularGenerator');

const REPO_ROOT = path.resolve(__dirname, '..', '..');

describe('generateStandardComponentFile: extended state adds a real extension point', () => {
  test('a managed component has no <ng-content> extension slot', () => {
    const file = generateStandardComponentFile({ componentKey: 'hero', state: 'managed' });
    expect(file.content).not.toMatch(/<ng-content>/);
  });

  test('an extended component includes a real <ng-content> projection slot', () => {
    const file = generateStandardComponentFile({ componentKey: 'hero', state: 'extended' });
    expect(file.content).toMatch(/<ng-content><\/ng-content>/);
  });
});

describe('generatePageComponentFile: per-instance and per-type state handling (current-phase-plan.md § 2c/§ 2f)', () => {
  const definitions = new Map([
    ['hero', { componentKey: 'hero', state: 'managed' }],
    ['cta', { componentKey: 'cta', state: 'extended' }],
    ['custom_widget', { componentKey: 'custom_widget', state: 'registered_custom' }],
  ]);

  test('a detached section instance is entirely omitted from the generated page — no import, no field, no template usage', () => {
    const page = {
      id: 'page_home',
      route: '/',
      sections: [
        { id: 's1', componentKey: 'hero', content: {}, settings: {} },
        {
          id: 's2', componentKey: 'hero', state: 'detached', content: { heading: 'Custom hand-authored' }, settings: {},
        },
      ],
    };
    const file = generatePageComponentFile(page, definitions);
    expect(file.usedComponentKeys).toEqual(['hero']);
    expect(file.content).not.toMatch(/Custom hand-authored/);
    expect((file.content.match(/HeroComponent/g) || []).length).toBeGreaterThan(0);
    // Only one <app-hero> usage — the detached instance never renders.
    expect((file.content.match(/<app-hero/g) || []).length).toBe(1);
  });

  test('a registered_custom section imports from custom/components/, not components/standard/', () => {
    const page = {
      id: 'page_home', route: '/', sections: [{ id: 's1', componentKey: 'custom_widget', content: {}, settings: {} }],
    };
    const file = generatePageComponentFile(page, definitions);
    expect(file.content).toContain("import { CustomWidgetComponent } from '../../custom/components/custom-widget.component';");
    expect(file.content).not.toContain('components/standard/custom-widget.component');
  });

  test('an extended section still imports from components/standard/, same as managed', () => {
    const page = {
      id: 'page_home', route: '/', sections: [{ id: 's1', componentKey: 'cta', content: {}, settings: {} }],
    };
    const file = generatePageComponentFile(page, definitions);
    expect(file.content).toContain("import { CtaComponent } from '../../components/standard/cta.component';");
  });
});

describe('generateWebsiteFiles: registered_custom componentKeys never get a generated standard file', () => {
  test('a registered_custom componentKey produces no components/standard/ file, but managed/extended ones still do', () => {
    const schema = {
      pages: [{
        id: 'page_home',
        route: '/',
        sections: [
          { id: 's1', componentKey: 'hero', content: {}, settings: {} },
          { id: 's2', componentKey: 'custom_widget', content: {}, settings: {} },
        ],
      }],
    };
    const definitions = new Map([
      ['hero', { componentKey: 'hero', state: 'managed' }],
      ['custom_widget', { componentKey: 'custom_widget', state: 'registered_custom' }],
    ]);
    const files = generateWebsiteFiles({
      schema, sectionDefinitionsByKey: definitions, designTokens: {}, websiteId: 'w1', websiteVersionId: 'v1', generatedAt: 'now',
    });
    const paths = files.map((f) => f.path);
    expect(paths).toContain('components/standard/hero.component.ts');
    expect(paths).not.toContain('components/standard/custom-widget.component.ts');
    // The whole manifest still obeys the generator-owned boundary — it
    // references custom/ via an import string, but never WRITES there.
    expect(() => assertManifestIsGeneratorOwned(files)).not.toThrow();
  });
});

test(
  'a real multi-state site (managed + extended + registered_custom + detached, all on one page) typechecks end-to-end, given the hand-authored custom component a real developer would have added',
  () => {
    const schema = {
      pages: [{
        id: 'page_home',
        route: '/',
        sections: [
          { id: 's1', componentKey: 'hero', content: { heading: 'Welcome' }, settings: {} },
          { id: 's2', componentKey: 'cta', content: { label: 'Go' }, settings: {} }, // extended
          { id: 's3', componentKey: 'custom_widget', content: { note: 'hi' }, settings: {} }, // registered_custom
          {
            id: 's4', componentKey: 'hero', state: 'detached', content: { heading: 'Ignored' }, settings: {},
          },
        ],
      }],
    };
    const definitions = new Map([
      ['hero', { componentKey: 'hero', state: 'managed' }],
      ['cta', { componentKey: 'cta', state: 'extended' }],
      ['custom_widget', { componentKey: 'custom_widget', state: 'registered_custom' }],
    ]);

    const files = generateWebsiteFiles({
      schema, sectionDefinitionsByKey: definitions, designTokens: { colors: {}, fonts: {} }, websiteId: 'w1', websiteVersionId: 'v1', generatedAt: 'now',
    });

    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'leadzaro-codegen-states-'));
    try {
      for (const file of files) {
        if (!file.path.endsWith('.ts')) continue;
        const fullPath = path.join(tempDir, file.path);
        fs.mkdirSync(path.dirname(fullPath), { recursive: true });
        fs.writeFileSync(fullPath, file.content);
      }

      // The generator never writes this — a real developer would have,
      // by hand, satisfying the exact naming convention the generator
      // assumes (componentClassName/selector). Written here purely to
      // prove that convention is real and satisfiable, not to claim the
      // generator produced it.
      const customComponentPath = path.join(tempDir, 'custom', 'components', 'custom-widget.component.ts');
      fs.mkdirSync(path.dirname(customComponentPath), { recursive: true });
      fs.writeFileSync(customComponentPath, `import { Component, Input } from '@angular/core';

@Component({
  selector: 'app-custom-widget',
  standalone: true,
  template: '<div>hand-authored custom widget</div>',
})
export class CustomWidgetComponent {
  @Input() variant?: string;
  @Input() content: Record<string, unknown> = {};
  @Input() settings: Record<string, unknown> = {};
}
`);

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
      try {
        execFileSync(tscBin, ['-p', path.join(tempDir, 'tsconfig.json')], {
          cwd: tempDir, stdio: 'pipe', shell: process.platform === 'win32',
        });
      } catch (err) {
        throw new Error(`Multi-state generated Angular output failed to typecheck:\n${(err.stdout || err.message || '').toString()}`);
      }
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  },
  30000
);
