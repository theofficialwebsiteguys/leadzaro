'use strict';

/**
 * The actual Angular generator (current-phase-plan.md § 2g) — schema →
 * typed output. Runs against a specific immutable WebsiteVersion.schema,
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
 *
 * All four component states (current-phase-plan.md § 2c/§ 2f), each
 * handled differently by design, not by omission:
 *  - managed:           generator-owned standard component, generated fresh every run.
 *  - extended:          same generator-owned standard component, PLUS a
 *                        real Angular extension point (<ng-content>) a
 *                        hand-authored custom/ wrapper can project into —
 *                        type-level (SectionDefinition.state), applies to
 *                        every instance of the componentKey uniformly.
 *  - registered_custom: the generator never writes this component's file
 *                        at all — the page imports it from custom/
 *                        components/ instead of components/standard/,
 *                        trusting the naming convention a developer's
 *                        hand-authored component must satisfy.
 *  - detached:           per-instance (never type-level — see
 *                        componentState.js) — that ONE section instance
 *                        is omitted from the generated page entirely,
 *                        assumed to be hand-rendered elsewhere; every
 *                        other instance of the same componentKey,
 *                        anywhere else, is unaffected.
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

function customComponentImportDir(componentKey) {
  return `../../custom/components/${toKebabCase(componentKey)}.component`;
}

function pageFilePath(page) {
  return `generated/pages/${toKebabCase(page.id)}.component.ts`;
}

/**
 * One reusable, generically-rendering standard component per generator-
 * owned componentKey (managed or extended — never registered_custom,
 * which has no generated file at all). Real, compiling, typed Angular
 * 19 standalone component syntax (matching this project's own frontend
 * convention), deliberately structural rather than pixel-crafted, per
 * the scope boundary above. An 'extended' type gets a real <ng-content>
 * extension point a hand-authored custom/ wrapper can project into —
 * the generator itself never reads or writes anything under custom/.
 */
function generateStandardComponentFile(sectionDefinition) {
  const { componentKey } = sectionDefinition;
  const isExtended = sectionDefinition.state === 'extended';
  const className = componentClassName(componentKey);
  const selector = componentSelector(componentKey);
  const extensionSlot = isExtended
    ? '\n      <!-- extension point: a custom/ wrapper component may project additional content here -->\n      <ng-content></ng-content>'
    : '';
  const content = `import { Component, Input } from '@angular/core';

@Component({
  selector: '${selector}',
  standalone: true,
  template: \`
    <section class="section section-${toKebabCase(componentKey)}" [attr.data-variant]="variant">
      @for (item of contentEntries; track item.key) {
        <div class="section-field" [attr.data-key]="item.key">{{ item.value }}</div>
      }${extensionSlot}
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
 * One routed page component per page. Each section instance is
 * classified by its own effective state (componentState.js) and
 * handled per current-phase-plan.md § 2c/§ 2f:
 *  - detached instances are omitted from the generated output entirely.
 *  - managed/extended instances import the generator-owned standard
 *    component from components/standard/.
 *  - registered_custom instances import from custom/components/ instead
 *    — the generator never writes that file, only references it, trusting
 *    the naming convention a hand-authored component must satisfy.
 * Each rendered section's actual content/settings/variant become a
 * typed class field (never inlined as a template literal expression —
 * keeps the template itself simple property bindings, matching how a
 * hand-authored Angular component would normally be written).
 */
function generatePageComponentFile(page, sectionDefinitionsByKey) {
  const renderableSections = (page.sections || [])
    .map((section) => {
      const definition = sectionDefinitionsByKey.get(section.componentKey);
      return { section, state: resolveEffectiveComponentState(section, definition) };
    })
    .filter(({ state }) => state !== 'detached');

  const usedComponentKeys = [...new Set(renderableSections.map(({ section }) => section.componentKey))];
  const imports = usedComponentKeys
    .map((key) => {
      const definition = sectionDefinitionsByKey.get(key);
      const importDir = definition?.state === 'registered_custom' ? customComponentImportDir(key) : `../../components/standard/${toKebabCase(key)}.component`;
      return `import { ${componentClassName(key)} } from '${importDir}';`;
    })
    .join('\n');

  const fieldName = (section) => `section_${toSafeIdentifier(section.id)}`;
  const fields = renderableSections
    .map(({ section }) => `  ${fieldName(section)} = ${JSON.stringify({
      variant: section.variant ?? null, content: section.content || {}, settings: section.settings || {},
    })};`)
    .join('\n');

  const template = renderableSections
    .map(({ section }) => `    <${componentSelector(section.componentKey)} [variant]="${fieldName(section)}.variant" [content]="${fieldName(section)}.content" [settings]="${fieldName(section)}.settings"></${componentSelector(section.componentKey)}>`)
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

/**
 * Redirects (Phase 8 slice 3, current-phase-plan.md § 2c) — real,
 * functioning Angular client-side routes, not just stored metadata
 * with no enforcement. Reviewed correction: unlike Phase 6/7's Live-
 * adapter deferrals (blocked by a genuine absence of live credentials
 * in this environment), nothing blocks a real redirect from working
 * today — RouterModule's own redirectTo/pathMatch is pure generated
 * code. A server/hosting-level 301 (.htaccess/cPanel rule) remains an
 * explicitly deferred, separate concern pending live cPanel
 * credentials; this is the client-side half, real and shipping now.
 * Placed before the page routes so an exact-match redirect is never
 * shadowed by a same-path page route (Angular matches routes in
 * array order).
 */
function generateRedirectRouteEntries(redirects) {
  return (redirects || [])
    .map((redirect) => `  { path: '${toRoutePath(redirect.fromPath)}', redirectTo: '${toRoutePath(redirect.toPath)}', pathMatch: 'full' },`)
    .join('\n');
}

function generateRoutesFile(pages, redirects = []) {
  // routes.ts lives at generated/configuration/routes.ts; page components
  // live at generated/pages/*.component.ts — a sibling directory, not a
  // child of configuration/, hence '../pages/...' not './pages/...'.
  const imports = pages
    .map((page) => `import { ${toPascalCase(page.id)}Component } from '../pages/${toKebabCase(page.id)}.component';`)
    .join('\n');
  const redirectEntries = generateRedirectRouteEntries(redirects);
  const pageEntries = pages
    .map((page) => `  { path: '${toRoutePath(page.route)}', component: ${toPascalCase(page.id)}Component },`)
    .join('\n');
  const entries = [redirectEntries, pageEntries].filter(Boolean).join('\n');

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

function generateConfigFile({
  websiteId, websiteVersionId, generatedAt, googleAnalyticsMeasurementId,
}) {
  const content = `${JSON.stringify({
    websiteId, websiteVersionId, generatedAt, googleAnalyticsMeasurementId: googleAnalyticsMeasurementId || null,
  }, null, 2)}\n`;
  return { path: 'leadzaro.config.json', content };
}

/**
 * Assembles the full generator-owned file manifest for one
 * WebsiteVersion.schema — every component state handled per this
 * module's own top-of-file documentation.
 */
function generateWebsiteFiles({
  schema, sectionDefinitionsByKey, designTokens, websiteId, websiteVersionId, generatedAt, googleAnalyticsMeasurementId, redirects,
}) {
  const pages = schema?.pages || [];
  const pageFiles = pages.map((page) => generatePageComponentFile(page, sectionDefinitionsByKey));

  // An unrecognized componentKey (no matching SectionDefinition at all)
  // falls back to a generated standard component rather than being
  // silently dropped — the page's own import logic defaults an unknown
  // definition's state to "not registered_custom" (see
  // generatePageComponentFile), so it must always have a matching
  // generated file to import, the same safe-by-default direction
  // schemaDiff.js already uses for an unrecognized settingsSchema key.
  const allUsedComponentKeys = [...new Set(pageFiles.flatMap((pageFile) => pageFile.usedComponentKeys))];
  const standardComponentFiles = allUsedComponentKeys
    .filter((key) => sectionDefinitionsByKey.get(key)?.state !== 'registered_custom')
    .map((key) => sectionDefinitionsByKey.get(key) || { componentKey: key, state: 'managed' })
    .map((definition) => generateStandardComponentFile(definition));

  return [
    ...pageFiles.map(({ path, content }) => ({ path, content })),
    ...standardComponentFiles,
    generateRoutesFile(pages, redirects),
    generateDesignTokensFile(designTokens),
    generateGlobalStylesFile(),
    generateSiteSchemaFile(schema),
    generateConfigFile({
      websiteId, websiteVersionId, generatedAt, googleAnalyticsMeasurementId,
    }),
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
