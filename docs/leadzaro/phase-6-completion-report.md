# Phase 6 Completion Report

## Phase

- Phase number/name: Phase 6 — Angular Generation and Developer Workflow
- Branch/checkpoint: `main`, commits `2dd85e3` through `8092f0d` (slices 1–8 plus the closing review's fix commit)
- Started: 2026-07-27
- Completed: 2026-07-27
- Overall result: **Complete**, with a documented deferred backlog (see below), none blocking.

## Scope delivered

The first phase to touch real code generation, a new external adapter (GitHub), and a source-control/deployment surface — delivered in 8 slices per `docs/leadzaro/current-phase-plan.md`, itself the product of a pre-implementation design review that caught 2 Critical and 2 High findings before any migration was written (mirroring Phase 5's own process):

1. **`GitHubAdapter`** (Mock/Disabled/Live) + **`WebsiteRepository`**, provisioned lazily via `findOrCreateWebsiteRepositoryForRequester` on first real need (an explicit "Provision Repository" action) rather than eagerly at `Website` creation — avoiding both a backfill migration for pre-existing websites and real external repo creation for a website that never leaves blank-draft editing.
2. **The generated/custom code boundary's two mechanisms**: a per-instance `state` field on section objects inside `draftSchema`/`WebsiteVersion.schema` (`inherited`/`detached`, resolved via `resolveEffectiveComponentState`), correcting the pre-implementation review's Critical finding that `detached` cannot live on the shared `SectionDefinition.state` type-level row; and the generator's own write-boundary primitive (`assertManifestIsGeneratorOwned`/`commitGeneratedFiles`), which refuses to write anything outside `generated/`, `components/standard/`, or the fixed config/style files.
3. **Builder-side component-state enforcement**: `authorizeAndClassifySchemaChange` extended to reject any builder-side edit to a `detached` instance's content, and any settings key not explicitly marked `builderEditable`, regardless of the requester's editing level — correcting the review's other Critical finding, that the generator's write boundary alone did nothing to stop a designer from clobbering custom work through the completely ordinary draft-save path. Includes the restore-of-a-pre-detachment-checkpoint edge case (`preserveDetachedInstances`), designed up front rather than discovered as a bug later.
4. **The actual Angular generator** for `managed`-state sections: real, compiling, typed Angular 19 standalone-component output (routed pages, reusable standard components, routes config, design tokens, global styles, a schema snapshot), wired to a real callable action (`generateAndCommit`).
5. **`extended`/`registered_custom`/`detached` generation**: an extended component gets a real `<ng-content>` extension point; a registered-custom component is never generated at all — the page imports it from `custom/components/` instead, trusting a naming convention proven satisfiable by a real compile test; a detached instance is omitted from generated output entirely.
6. **Branches + preview workflow + GitHub Pages** (`WebsiteDeployment`, employee-only): one new deployment row per deploy attempt (an audit trail, never updated in place), the underlying branch safely reused across redeploys of the same version.
7. **Promote-to-development** (`WebsiteDevelopmentHandoff`, employee-only): one coherent action running architecture §16's full checklist — branch, preview deploy, a real non-client-visible Task, and `Notification`s to the project's assigned developers.
8. **Developer merge-back + component publication review**: a real GitHub PR create-and-merge (no new model), and a permission split making custom-component registration a `builder.develop` action while publish/deprecate stays a separate `builder.manage` review gate — a genuine two-party workflow Phase 5 didn't have.
9. **This closing review and report.**

## Acceptance matrix

| Requirement | Implementation | Tests | Status |
|---|---|---|---|
| A designer edit must never overwrite developer-owned custom functionality (the major gate, generator half) | `angularGenerator.assertManifestIsGeneratorOwned`/`commitGeneratedFiles` — the only path the generator ever writes through | `angularGenerator.test.js` | Done |
| Same gate, builder half — a draft-save edit must never clobber a detached/registered_custom instance | `authorizeAndClassifySchemaChange`'s `blockedByDetachment` check | `componentStateEnforcement.test.js` | Done |
| Same gate — deleting (not just editing) a detached instance must also be blocked | `schemaDiff.diffRemovedSections` (closing-review fix) | `componentStateEnforcement.test.js` | Done |
| A registered developer component must remain usable in the builder | `registered_custom` sections render generically via the preview renderer/generator like any other component; only their generated *implementation* differs | `angularGeneratorComponentStates.test.js` | Done |
| `detached` never lives on the shared `SectionDefinition` type-level row | Per-instance `state` field, `componentState.js` | `componentState.test.js` (proves two instances of the same type resolve independently) | Done |
| Restoring an old version never silently re-clobbers a since-detached instance | `preserveDetachedInstances` in `restoreVersion` | `componentStateEnforcement.test.js` | Done |
| Generated Angular output actually compiles, not just asserted on string content | Real `tsc` typecheck against the project's own `@angular/core`/`@angular/router` types, in a temp dir | `angularGeneratorOutput.test.js`, `angularGeneratorComponentStates.test.js` (multi-state) | Done |
| `WebsiteRepository` never eagerly provisions a real external repo, and needs no backfill migration | Lazy `findOrCreateWebsiteRepositoryForRequester` | `websiteRepository.test.js` | Done |
| `WebsiteDeployment`/`WebsiteDevelopmentHandoff` are never reachable by a client-membership request | `assertEmployeeContextForDeployment`/`assertEmployeeContextForHandoff` | `websiteDeployment.test.js`, `websiteDevelopmentHandoff.test.js` | Done |
| Promote-to-development runs the full architecture §16 checklist as one action | `promoteToDevelopment` — branch, preview deploy, task, notifications | `websiteDevelopmentHandoff.test.js` | Done |
| Custom-component registration and publication are a genuine two-party review, not one gate | `builder.develop` (create) vs. `builder.manage` (publish/deprecate) | `websiteMergeBackAndComponentReview.test.js` | Done |
| Cross-agency isolation on every new guarded model | `visibilityGuard.js` + `clientVisibleModels.js` accessors | Raw-unscoped-query-throws + cross-agency tests throughout | Done |

## Repository changes

### Backend

- Modules/services: `server/core/integrations/github/githubAdapter.js`; `server/core/codegen/{angularGenerator.js,generateWebsiteFiles.js}`; `server/core/websites/componentState.js`; `server/modules/websites/{websiteRepositoryService,websiteCodegenService,websiteDeploymentService,websiteDevelopmentHandoffService,websiteMergeBackService}.js` (+ matching controllers).
- Routes/APIs: `/api/v1/projects/:projectId/website/{repository, versions/:versionId/generate, deployments, versions/:versionId/deploy-preview, development-handoffs, versions/:versionId/promote-to-development, merge-back}`; `POST /api/v1/section-definitions` permission changed from `builder.manage` to `builder.develop`.
- Authorization: new permission `builder.develop` (developer + advanced_designer), narrower than `builder.manage` since these are developer-role actions, not agency-management actions.
- Jobs/events: none new — every GitHub-adapter action is synchronous within its own request, matching this phase's own scope boundary (no background job infrastructure exists in this codebase).

### Frontend

- Routes/screens: no new route — the Website panel in `src/app/features/projects/` grew Repository, Deployments, Development Handoffs, and Merge Back sections, plus Generate/Deploy Preview/Promote to Development actions alongside each version.
- State/services: new methods on `src/app/core/services/website.service.ts`; new models `WebsiteRepository`, `WebsiteDeployment`, `WebsiteDevelopmentHandoff` in `website.model.ts`.
- Permission behavior: every new action gated by `*hasPermission="'builder.develop'"`, matching the server-side permission at the route.
- Mobile/accessibility: reuses the app's existing table/form patterns; no dedicated mobile layout, consistent with Phase 4/5's own deferral.

### Database

- New tables: `WebsiteRepositories`, `WebsiteDeployments`, `WebsiteDevelopmentHandoffs`.
- Changed tables: none — the per-instance component `state` field lives inside `Websites.draftSchema`/`WebsiteVersions.schema`'s existing JSONB, defaulting to `'inherited'` when absent so every pre-Phase-6 schema stays valid with no migration needed; `SectionDefinitions.state` had `'detached'` removed from its allowed values (never previously used by any row).
- Indexes/constraints: every new table denormalizes `organizationId`/`agencyOrganizationId` directly, matching established convention; `WebsiteDeployments.developmentHandoffId` FK added in its own migration (added after `WebsiteDevelopmentHandoffs` existed to reference, rather than retroactively editing an earlier migration).
- Backfills: none needed — every new table is additive, and `WebsiteRepository`'s lazy-creation design specifically avoids needing one.
- Rollback behavior: every schema migration has a working, correctly-ordered `down()` (verified directly — the FK-adding migration removes its own constraint before dropping the table); permission-seed migrations are intentionally not reversed, matching established precedent.

## Legacy compatibility

- Preserved workflows: Phases 1–5 untouched except the one deliberate permission change (`POST /section-definitions` now `builder.develop` instead of `builder.manage`) — verified during the closing review that no other caller (backend or frontend) still assumed the old gate, and every one of Phase 5's own governance tests still passes unchanged (they exercise `administrator`, who holds both permissions either way).
- Compatibility adapters: none needed.
- Deprecated fields/routes: none.
- Planned removal phase: N/A.

## Security and privacy

- Secret handling: `.env.example` documents `GITHUB_PROVIDER`/`GITHUB_APP_CREDENTIALS_JSON`/`GITHUB_ORG` with placeholder values only; `validateEnv()`'s `checkLiveProviderCredentials` refuses to boot in production with `GITHUB_PROVIDER=live` and missing/placeholder credentials, matching every other adapter's precedent. No real credentials anywhere in this repository.
- Authentication/session changes: none.
- Authorization/isolation tests: every new guarded model has a dedicated raw-unscoped-query-throws test; cross-agency isolation verified throughout.
- Input/file/webhook protections: no new webhook surface.
- Impersonation/audit behavior: every state-changing action (repository provisioning, code generation, preview deploy, promote-to-development, merge-back, component create/publish/deprecate) is recorded via `recordAudit`.
- **Design-review-before-implementation, again**: the full architecture draft was escalated to `fable-phase-reviewer` before any migration was written, exactly as Phase 5 established. That review returned 8 findings, 4 load-bearing (2 Critical, 2 High), all incorporated into `current-phase-plan.md` before implementation began — most significantly, catching that the original draft would have stored `detached` on the shared `SectionDefinition.state` row (a genuine cross-website data-leak-shaped bug: one website's ejected section would have made every other website using the same component read as detached too) before any code existed.
- **Closing-review finding, fixed before this report** (High): `schemaDiff.js` produced no per-section change entry for a section removed entirely from a page — only the aggregate `structuralChange` flag, gated at the same `professional`+ bar as a harmless reorder. A `detached` instance's content/settings edits were correctly blocked, but the whole instance could simply be deleted with no additional check — deletion is strictly more destructive than any single edit, yet was the one operation the major gate didn't cover. Fixed by `diffRemovedSections`, classifying a removed `detached` instance through the exact same `bucket: 'content'` shape the existing content-edit rule already checks; verified by a new regression test proving a detached instance cannot be removed while a managed one still can be.

## Validation commands run

- Dependency install: `npm install @octokit/rest` (reviewed diff — one line added to `package.json`, no unrelated changes).
- Frontend build: `npm run build` — clean (only the pre-existing, unrelated `landing.component.scss` budget warning).
- Type check/lint: TypeScript diagnostics clean on every modified frontend file, checked incrementally.
- Backend checks: `node -e "require('./server/app')"` sanity check after every slice.
- Unit tests: `npm run test:backend` — **316/316 passing (41 suites)**, re-run clean after the closing-review fix.
- Integration tests: included in the same backend suite — 62 new tests across `websiteRepository.test.js`, `externalAdapters.test.js` (+3 GitHub adapter unit tests), `componentState.test.js`, `angularGenerator.test.js`, `angularGeneratorOutput.test.js`, `angularGeneratorComponentStates.test.js`, `componentStateEnforcement.test.js` (+1 in the closing-review fix), `websiteCodegen.test.js`, `websiteDeployment.test.js`, `websiteDevelopmentHandoff.test.js`, `websiteMergeBackAndComponentReview.test.js`.
- Migration tests: all 4 Phase 6 migrations (3 new tables + 1 status-column removal via model change) applied cleanly to the real dev database and to a freshly-recreated test database via Jest's `globalSetup`.
- **Real compile verification** (the phase's own distinguishing test, beyond string-content assertions): a dedicated test writes the generator's actual output to a temp directory and runs the project's own `tsc` against its own installed `@angular/core`/`@angular/router` types — first for a `managed`-only site, then for a full multi-state site (managed + extended + registered_custom + detached together, with a hand-written stub custom component satisfying the registered_custom naming convention). This caught one genuine bug before it ever reached a real repository: the generated `routes.ts` imported page components with the wrong relative path (`./pages/...` instead of `../pages/...`, since `routes.ts` lives in `generated/configuration/` and page components live in the sibling `generated/pages/`) — found, fixed, and reverified within slice 4.
- End-to-end/manual checks: real headless-Chrome sessions (synthetic org/user/project, logged in through the real UI, synthetic data removed after) for repository provisioning (slice 1, confirmed active status and mock-org full name both in the UI and directly against the database row).

## Review pass 1 — pre-implementation design review (before any code was written)

| Severity | Finding | Resolution | Verification |
|---|---|---|---|
| Critical | The draft would have stored all four component states (including `detached`) on the shared `SectionDefinition.state` row — since one row is referenced by every instance of that component across every website, detaching one instance on one website would have made every other instance of the same componentKey elsewhere incorrectly read as detached too | Split into type-level `SectionDefinition.state` (managed/extended/registered_custom) and a new per-instance `state` field on section objects inside the schema itself (inherited/detached), resolved by a single shared function (`resolveEffectiveComponentState`) | `componentState.test.js`'s dedicated "two instances of the same SectionDefinition resolve independently" test |
| Critical | The draft's generator-side write boundary was the only planned defense — nothing stopped a designer's ordinary draft-save edit from clobbering a detached/registered_custom instance's content through a completely different path | `authorizeAndClassifySchemaChange` extended with component-state-aware rules, including the restore-of-a-pre-detachment-checkpoint edge case | `componentStateEnforcement.test.js` |
| High | No explicit client/employee visibility decision for `WebsiteDevelopmentHandoff`/`WebsiteDeployment` (only `WebsiteRepository`'s was decided in the draft) | Both made employee-only, mirroring `ProjectFinancials`'s established pattern | `websiteDeployment.test.js`, `websiteDevelopmentHandoff.test.js` |
| High | No backfill/migration story for `WebsiteRepository` against pre-existing `Website` rows from eager creation | Lazy `findOrCreateWebsiteRepositoryForRequester`, created on first real need — closes both the backfill gap and the "real external repo for an unused website" concern at once | `websiteRepository.test.js` |

Plus 4 additional Medium/Low findings, all incorporated into `current-phase-plan.md` before implementation (eager-row/lazy-provisioning split; `WebsiteDeployment.environment` column added now for Phase 7 to extend; `extended` resolved as type-level not instance-level; a real compile check added to the phase's own testing priorities).

## Review pass 2 — final full-phase closing review (fable-phase-reviewer)

A dedicated closing review covering all 8 slices, focused on the major gate (both halves, verified to hold together across the whole phase, not just individually) and authorization boundaries, per CLAUDE.md's escalation rule.

| Severity | Finding | Resolution | Verification |
|---|---|---|---|
| High | `schemaDiff.js` produced no change entry for a section removed entirely from a page — a `detached` instance could be deleted from a page with none of the protections that applied to editing so much as one of its settings keys | `diffRemovedSections`, reusing the exact `bucket: 'content'` shape the existing content-edit rule already checks | New regression test in `componentStateEnforcement.test.js` |

No Critical findings, and every other area investigated (no bypass path around `authorizeAndClassifySchemaChange`; the generator boundary has no direct-`adapter.commitFiles` escape hatch; `detached` is never emitted by the generator and is derived from the single shared resolver, not a separate ad hoc check; employee-only visibility holds; the `builder.develop`/`builder.manage` split didn't loosen publish/deprecate) came back clean. The reviewer flagged a `deployToBranch` bare `catch {}` around `createBranch` (swallows any error, not just "already exists") as worth noting but not scored — independently confirmed low-severity: a genuine failure there simply surfaces one step later as a `commitGeneratedFiles` failure, which is already caught, recorded as a `'failed'` `WebsiteDeployment` row, and correctly propagated to the caller. Listed under Known risks below rather than fixed this phase, since it degrades safely rather than failing silently.

## Regression verification

Every Phase 1–5 test suite re-run unchanged and passing alongside the 8 new/extended Phase 6 suites. 316/316 backend, 18/18 frontend — re-run after every slice and again after the closing-review fix.

## Data migration evidence

- Empty DB result: all 4 Phase 6 migrations apply cleanly to an empty database.
- Legacy DB result: applied cleanly on top of the full Phase 1–5 migration history.
- Record counts before/after: N/A — every Phase 6 table is new, no pre-existing rows to migrate.
- Duplicate/loss checks: N/A (additive-only tables; the per-instance `state` field defaults to `'inherited'` for every pre-existing schema, changing no observable behavior).
- Rollback test: every Phase 6 schema migration has a working, correctly-ordered `down()`, directly verified during the closing review; not exercised via a full rollback-and-re-migrate cycle this phase, matching Phase 4/5's own noted limitation.

## Manual configuration required

- **GitHub**: set `GITHUB_PROVIDER=live` plus a real `GITHUB_APP_CREDENTIALS_JSON`/`GITHUB_ORG` in the untracked `.env` once a real GitHub App is provisioned. Until then, `GITHUB_PROVIDER=mock` (the current default) carries the entire repository/branch/commit/PR/Pages-preview workflow with a clearly-labeled, fully-tested in-memory simulation — every operation `LiveGitHubAdapter` will eventually perform against real GitHub has an equivalent, independently-tested mock behavior.
- No secret values are or will be committed; only `.env.example` with placeholders is tracked.

## Deferred backlog

### Medium priority

- `deployToBranch`'s bare `catch {}` around `adapter.createBranch` swallows any error, not specifically "branch already exists" — degrades safely (surfaces one step later as a caught, recorded deployment failure) rather than failing silently, but narrowing the catch to the specific "already exists" condition would produce a clearer root-cause error message on a genuine provisioning/auth failure.
- No `ng build`/full Angular-CLI-workspace compile check exists yet — the phase's own real-compile verification uses `tsc` directly against the project's installed `@angular/core`/`@angular/router` types (a genuine, meaningful proof that the generated TypeScript itself is valid), not a complete Angular CLI build pipeline with real template compilation. Spinning up a disposable Angular workspace per test run was judged disproportionate for this phase's own testing loop; worth reconsidering once Phase 7's real hosting workflow needs an actual production build anyway.

### Low priority

- No dedicated mobile layout for the new Repository/Deployments/Handoffs/Merge Back panels beyond the app's existing responsive patterns.
- The merge-back workflow is single-step (create PR, merge immediately) — there is no PR-review UI in this application; a real reviewer still uses GitHub's own UI directly if they want to inspect the diff before this endpoint is called.

### Deliberately deferred to later phase

- Real production deployment, live DNS, or an actual cPanel upload — Phase 6's own scope ends at preview deployment to GitHub Pages and the promote-to-development handoff; "Production deployment is manual" per architecture §16 and is Phase 7's concern by design.
- `WebsiteDeployment.environment: 'production'` — the column exists now (added specifically so Phase 7 can extend this same table rather than introducing a second, competing deployment-history table) but nothing in this phase ever sets it; Phase 7 is expected to widen `status` and add backup/health-check fields via a follow-on migration.
- Real GitHub App credentials and end-to-end verification against live GitHub — this environment has none, by design; the adapter interface and mock behavior are thoroughly tested against their mock implementation, including a full multi-state real-compile proof.

## Known risks

- The `deployToBranch` bare-catch behavior noted above (Medium, deferred) — low practical risk given it degrades to a correctly-recorded and correctly-propagated failure rather than a silent success, but flagged here rather than left unverified.
- `migrations.test.js`'s full-rollback-and-re-migrate test predates Phase 4 and was not extended to include Phase 6's own migrations in a full down/up cycle — each migration's `down()` was written and directly reviewed but not exercised end-to-end, matching the same noted limitation from Phase 4 and Phase 5.
- No real GitHub account has ever been exercised against this integration (no credentials in this environment) — the adapter interface and mock behavior are well-tested (including a genuine multi-branch, multi-commit, PR-merge-with-real-file-propagation lifecycle test), but real-provider field-shape assumptions (PR number formats, Pages-enablement timing/eventual-consistency behavior, rate limits) are unverified until real credentials exist.

## Documentation updated

- README: not applicable.
- Architecture decisions: `docs/leadzaro/current-phase-plan.md` (the full, review-corrected Phase 6 design — evidence audit, corrected model designs, permission summary, testing priorities, slice order, both review passes). No new ADR file was needed; Phase 6 extends ADR 0007's existing guarded-model pattern to 3 new models without changing the pattern itself.
- API docs: none formal; routes documented inline via the phase plan and this report's acceptance matrix.
- Migration docs: inline comments in every new migration explaining its purpose and which architecture correction it implements.
- User/admin instructions: `.env.example` documents the new `GITHUB_*` environment variables with placeholder values and inline comments.

## Readiness for next phase

- Ready: Yes
- Blocking reasons: none
- Recommended next-phase starting point: Phase 7 — Production Website Operations (per `docs/planning/06_PHASES_2_TO_8_ROADMAP.md`), building directly on `WebsiteRepository`/`WebsiteDeployment` (the `environment` column already anticipates this) and the now-proven-compiling generator output.
- Generated next-phase prompt path: `docs/leadzaro/NEXT_PHASE_PROMPT.md` (to be rewritten for Phase 7 immediately after this report is finalized).
