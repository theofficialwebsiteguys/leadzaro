'use strict';

/**
 * The actual Angular generator (current-phase-plan.md § 2g, Phase 6
 * slice 4) — schema → typed output, for 'managed'-state sections only
 * this slice (slice 5 extends this for extended/registered_custom/
 * detached). Runs against a specific immutable WebsiteVersion.schema,
 * never the live mutable draftSchema, matching the version-immutability
 * principle Phase 5 already established.
 *
 * Scope boundary confirmed during the pre-implementation review:
 * structural correctness (correct routing, correct typed inputs,
 * correct generated/custom boundary, correct component-state handling)
 * over pixel/visual fidelity — the same "structural proof, not pixel-
 * perfect" precedent the Phase 5 preview renderer already set. Every
 * standard component renders its content/settings generically (an
 * @for over each property), the same approach the preview renderer
 * already uses — real, compiling, typed Angular, not a stub, but not a
 * hand-crafted pixel-perfect hero/cta/etc. template either.
 */

const { resolveEffectiveComponentState } = require('../websites/componentState');

function toPascalCase(key) {
  return key
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('');
}

function toKebabCase(key) {
  return key
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean)
    .join('-')
    .toLowerCase();
}

// A JS identifier is never allowed to start with a digit, and any
// character outside [A-Za-z0-9_] is invalid — section/page ids are
// caller-supplied (crypto.randomUUID() for auto-assembled sections,
// but not guaranteed for hand-edited draft JSON), so this is a real
// input-shape concern, not just style.
function toSafeIdentifier(id) {
  const safe = id.replace(/\W/g, '_');
  return /^\d/.test(safe) ? `_${safe}` : safe;
}

function componentClassName(componentKey) {
  return `${toPascalCase(componentKey)}Component`;
}

function componentSelector(componentKey) {
  return `app-${toKebabCase(componentKey)}`;
}

function componentFilePath(componentKey) {
  return `components/standard/${toKebabCase(componentKey)}.component.ts`;
}

function pageFilePath(page) {
  return `generated/pages/${toKebabCase(page.id)}.component.ts`;
}

/**
 * One reusable, generically-rendering standard component per
 * componentKey — 'managed' sections only this slice. Real, compiling,
 * typed Angular 19 standalone component syntax (matching this
 * project's own frontend convention), deliberately structural rather
 * than pixel-crafted, per the scope boundary above.
 */
function generateStandardComponentFile(componentKey) {
  const className = componentClassName(componentKey);
  const selector = componentSelector(componentKey);
  const content = `import { Component, Input } from '@angular/core';

@Component({
  selector: '${selector}',
  standalone: true,
  template: \`
    <section class="section section-${toKebabCase(componentKey)}" [attr.data-variant]="variant">
      @for (item of contentEntries; track item.key) {
        <div class="section-field" [attr.data-key]="item.key">{{ item.value }}</div>
      }
    </section>
  \`,
})
export class ${className} {
  @Input() variant?: string;
  @Input() content: Record<string, unknown> = {};
  @Input() settings: Record<string, unknown> = {};

  get contentEntries(): Array<{ key: string; value: unknown }> {
    return Object.entries(this.content).map(([key, value]) => ({ key, value }));
  }
}
`;
  return { path: componentFilePath(componentKey), content };
}

/**
 * One routed page component per page, importing and instantiating the
 * standard component for each 'managed' section instance it contains,
 * in order. Each section's actual content/settings/variant become a
 * typed class field (never inlined as a template literal expression —
 * keeps the template itself simple property bindings, matching how a
 * hand-authored Angular component would normally be written).
 */
function generatePageComponentFile(page, sectionDefinitionsByKey) {
  const managedSections = (page.sections || []).filter((section) => {
    const definition = sectionDefinitionsByKey.get(section.componentKey);
    return resolveEffectiveComponentState(section, definition) === 'managed';
  });

  const usedComponentKeys = [...new Set(managedSections.map((section) => section.componentKey))];
  const imports = usedComponentKeys
    .map((key) => `import { ${componentClassName(key)} } from '../../components/standard/${toKebabCase(key)}.component';`)
    .join('\n');

  const fieldName = (section) => `section_${toSafeIdentifier(section.id)}`;
  const fields = managedSections
    .map((section) => `  ${fieldName(section)} = ${JSON.stringify({
      variant: section.variant ?? null, content: section.content || {}, settings: section.settings || {},
    })};`)
    .join('\n');

  const template = managedSections
    .map((section) => `    <${componentSelector(section.componentKey)} [variant]="${fieldName(section)}.variant" [content]="${fieldName(section)}.content" [settings]="${fieldName(section)}.settings"></${componentSelector(section.componentKey)}>`)
    .join('\n');

  const className = `${toPascalCase(page.id)}Component`;
  const content = `import { Component } from '@angular/core';
${imports ? `${imports}\n` : ''}
@Component({
  selector: 'app-page-${toKebabCase(page.id)}',
  standalone: true,
  imports: [${usedComponentKeys.map(componentClassName).join(', ')}],
  template: \`
${template}
  \`,
})
export class ${className} {
${fields}
}
`;
  return {
    path: pageFilePath(page), content, className, usedComponentKeys,
  };
}

/**
 * Angular route path syntax has no leading slash, and the root page's
 * '/' route is the empty path — schema routes (§ 2b) always carry the
 * leading slash since they're also used as real URL paths elsewhere.
 */
function toRoutePath(route) {
  return route.replace(/^\//, '');
}

function generateRoutesFile(pages) {
  // routes.ts lives at generated/configuration/routes.ts; page components
  // live at generated/pages/*.component.ts — a sibling directory, not a
  // child of configuration/, hence '../pages/...' not './pages/...'.
  const imports = pages
    .map((page) => `import { ${toPascalCase(page.id)}Component } from '../pages/${toKebabCase(page.id)}.component';`)
    .join('\n');
  const entries = pages
    .map((page) => `  { path: '${toRoutePath(page.route)}', component: ${toPascalCase(page.id)}Component },`)
    .join('\n');

  const content = `import { Routes } from '@angular/router';
${imports}

export const routes: Routes = [
${entries}
];
`;
  return { path: 'generated/configuration/routes.ts', content };
}

function generateDesignTokensFile(tokens) {
  const lines = [];
  for (const [colorName, colorValue] of Object.entries(tokens?.colors || {})) {
    lines.push(`  --color-${toKebabCase(colorName)}: ${colorValue};`);
  }
  for (const [fontName, fontValue] of Object.entries(tokens?.fonts || {})) {
    lines.push(`  --font-${toKebabCase(fontName)}: ${fontValue};`);
  }
  const content = `:root {\n${lines.join('\n')}\n}\n`;
  return { path: 'styles/design-tokens.scss', content };
}

function generateGlobalStylesFile() {
  const content = `@use 'design-tokens';

body {
  font-family: var(--font-body, sans-serif);
  color: var(--color-text, #0f172a);
  background: var(--color-background, #ffffff);
}
`;
  return { path: 'styles/global.scss', content };
}

function generateSiteSchemaFile(schema) {
  return { path: 'site.schema.json', content: `${JSON.stringify(schema, null, 2)}\n` };
}

function generateConfigFile({ websiteId, websiteVersionId, generatedAt }) {
  const content = `${JSON.stringify({ websiteId, websiteVersionId, generatedAt }, null, 2)}\n`;
  return { path: 'leadzaro.config.json', content };
}

/**
 * Assembles the full generator-owned file manifest for one
 * WebsiteVersion.schema. Only 'managed'-state sections produce real
 * per-section output this slice; a page containing an extended/
 * registered_custom/detached instance still generates (with that one
 * instance simply omitted from the page's rendered output) rather than
 * failing the whole website — slice 5 fills in the other three states'
 * own generation rules.
 */
function generateWebsiteFiles({
  schema, sectionDefinitionsByKey, designTokens, websiteId, websiteVersionId, generatedAt,
}) {
  const pages = schema?.pages || [];
  const pageFiles = pages.map((page) => generatePageComponentFile(page, sectionDefinitionsByKey));

  const allUsedComponentKeys = [...new Set(pageFiles.flatMap((pageFile) => pageFile.usedComponentKeys))];
  const standardComponentFiles = allUsedComponentKeys.map((key) => generateStandardComponentFile(key));

  return [
    ...pageFiles.map(({ path, content }) => ({ path, content })),
    ...standardComponentFiles,
    generateRoutesFile(pages),
    generateDesignTokensFile(designTokens),
    generateGlobalStylesFile(),
    generateSiteSchemaFile(schema),
    generateConfigFile({ websiteId, websiteVersionId, generatedAt }),
  ];
}

module.exports = {
  generateWebsiteFiles,
  generateStandardComponentFile,
  generatePageComponentFile,
  generateRoutesFile,
  generateDesignTokensFile,
  generateGlobalStylesFile,
  generateSiteSchemaFile,
  generateConfigFile,
  componentClassName,
  componentSelector,
  toKebabCase,
  toPascalCase,
  toSafeIdentifier,
};
