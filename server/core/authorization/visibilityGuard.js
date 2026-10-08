'use strict';

/**
 * Installs a runtime guard on a model that is reachable, directly or
 * transitively, by a client-membership request (Project, ProjectFinancials,
 * Task, Message, ProjectChannel, File, ClientRequest, ...). See ADR 0007
 * (docs/leadzaro/adr/0007-client-visibility-enforcement.md) for the full
 * reasoning: a per-endpoint "remember to scope this query" convention
 * already failed once in this codebase (Phase 1's impersonation feature
 * originally had no tenant check at all). A lint-import-restriction was
 * considered and rejected — this repository has no ESLint config, lint
 * script, or CI workflow, so a lint rule would have zero automatic
 * enforcement. This hook fires unconditionally at runtime instead,
 * in every environment, with no dependence on anyone running a linter.
 *
 * Every `find*`/`count` call against a guarded model must be made through
 * `server/core/authorization/clientVisibleModels.js`, which sets the
 * `__visibilityScoped` marker on `options` only after applying the real
 * scoping for the requester. A raw `Model.findAll()`/`findByPk()` call
 * anywhere else in the codebase throws immediately instead of silently
 * returning unscoped data.
 */
function installVisibilityGuard(model, { accessModule = 'server/core/authorization/clientVisibleModels.js' } = {}) {
  const guard = (options) => {
    if (!options || options.__visibilityScoped !== true) {
      throw new Error(
        `${model.name} must be queried through ${accessModule}, `
        + 'never directly — see docs/leadzaro/adr/0007-client-visibility-enforcement.md'
      );
    }
  };
  model.addHook('beforeFind', guard);
  model.addHook('beforeCount', guard);
}

module.exports = { installVisibilityGuard };
