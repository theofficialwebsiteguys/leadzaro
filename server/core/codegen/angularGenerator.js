'use strict';

/**
 * The generated/custom code boundary (current-phase-plan.md § 2f) — the
 * primary half of Phase 6's major gate ("a designer edit must never
 * overwrite developer-owned custom functionality"). The other half
 * (blocking a *builder-side* edit to a detached/registered_custom
 * section instance) lives in websiteService.authorizeAndClassifySchemaChange
 * (slice 3) — this module only guards the *generator's own* writes.
 *
 * Directory split exactly per architecture § 15's own example tree,
 * inside each website's generated repository:
 *   generated/{pages,configuration}/     — generator-owned
 *   components/standard/                 — generator-owned
 *   custom/{components,features,integrations}/  — generator NEVER writes here
 *   styles/{design-tokens.scss,global.scss}      — generator-owned (fixed paths)
 *   site.schema.json, leadzaro.config.json       — generator-owned (fixed paths)
 *
 * This is structural defense-in-depth, not just a naming convention a
 * future change could accidentally violate: `commitGeneratedFiles` is
 * the one sanctioned way the generator ever calls a GitHubAdapter's
 * `commitFiles`, and it refuses to write anything before checking every
 * path in the manifest, exactly the way ADR 0007's visibility guard
 * refuses a query before it runs rather than trusting every caller to
 * remember the rule.
 */

const ALLOWED_PATH_PREFIXES = ['generated/', 'components/standard/'];
const ALLOWED_EXACT_PATHS = new Set([
  'styles/design-tokens.scss',
  'styles/global.scss',
  'site.schema.json',
  'leadzaro.config.json',
]);

function isGeneratorOwnedPath(path) {
  if (ALLOWED_EXACT_PATHS.has(path)) return true;
  return ALLOWED_PATH_PREFIXES.some((prefix) => path.startsWith(prefix));
}

/**
 * Throws on the FIRST disallowed path rather than writing anything —
 * an all-or-nothing manifest, matching how a single commit should never
 * partially apply.
 */
function assertManifestIsGeneratorOwned(files) {
  for (const file of files) {
    if (!isGeneratorOwnedPath(file.path)) {
      throw new Error(
        `Refusing to write "${file.path}" — outside the generator-owned boundary `
        + '(generated/, components/standard/, or a fixed config/style file). '
        + 'Custom code under custom/ is never touched by the generator.'
      );
    }
  }
}

async function commitGeneratedFiles({
  adapter, repoId, branch, files, message,
}) {
  assertManifestIsGeneratorOwned(files);
  return adapter.commitFiles(repoId, branch, files, message);
}

module.exports = {
  isGeneratorOwnedPath,
  assertManifestIsGeneratorOwned,
  commitGeneratedFiles,
  ALLOWED_PATH_PREFIXES,
  ALLOWED_EXACT_PATHS,
};
