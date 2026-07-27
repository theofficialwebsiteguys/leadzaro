# Phase 6 — Angular Generation and Developer Workflow: working plan

Scope per `docs/planning/06_PHASES_2_TO_8_ROADMAP.md` "Phase 6" and `docs/planning/02_MASTER_PRODUCT_SYSTEM_ARCHITECTURE.md` §§15 (Angular code generation) and 16 (source control and deployment).

Major gate: **a designer edit must never overwrite developer-owned custom functionality, and a registered developer component must remain usable in the builder.**

This plan was drafted, then escalated to `fable-phase-reviewer` for a pre-implementation design review (mirroring Phase 5's own process — a draft plan is not sufficient justification on its own for a phase this architecturally significant, per CLAUDE.md's escalation rule). The review returned 8 findings, 4 of them load-bearing (2 Critical, 2 High) that required revising the draft before any migration could be written. Every decision below reflects that review; corrections are marked explicitly.

## 1. Evidence audit — what already exists that this phase builds on

- `Website.draftSchema` / `WebsiteVersion.schema` (Phase 5) is the stable, versioned, schema-first source of truth this phase generates Angular code from. Shape: `{ pages: [{ id, route, title, sections: [{ id, componentKey, variant, settings, content }] }], navigation, siteSettings, organizationContent }`.
- **Verified during review**: `WebsiteVersion.schema` is immutable in practice — the only `version.update(...)` call site in `websiteService.js` touches `status`/`publishedAt` only, never `schema`, across every code path (checkpoint, restore, publish). This is convention-only, not DB-enforced, consistent with how `AuditLog`-style records are already treated in this codebase — not a new gap this phase introduces.
- `SectionDefinition.state` (`managed`/`extended`/`registered_custom`/`detached`) was reserved by Phase 5 as inert data, never read for behavior anywhere in the current codebase (verified during review) — genuinely free for this phase to give real meaning to, but see § 2c's correction below on where that meaning actually lives.
- ADR 0007's client-visibility architecture (`visibilityGuard.js` + `clientVisibleModels.js`) is the established, four-times-battle-tested pattern (Phases 1, 4, 5×2) for any model a client-membership request can reach.
- The adapter-interface pattern (`GoogleCalendarAdapter`, `StorageProvider`/GCS, etc. — abstract base, Mock/Disabled/Live subclasses, cached factory keyed by an env var) is used 5 times already. **Verified during review**: GitHub's actual operation set (repo/branch/commit/PR/Pages, inherently sequential and stateful — a branch must exist before a commit, a PR references two branches, a merge mutates file-tree state) is only superficially similar to the existing 2-3-operation stateless adapters at the operation level; it matches them only at the outer factory/cached-instance/env-var-provider level. The mock adapter therefore needs real in-memory state (not a stateless stub) for this phase's own tests to be meaningful — see § 2a.
- `ProjectFinancials`'s `assertEmployeeContext`/`findOrCreateProjectFinancials` pattern (Phase 4) is the established precedent both for "this guarded model is employee-only, never client-reachable" and for "create this row lazily on first real need, not eagerly and unconditionally" — both reused directly below (§ 2d, § 2e).
- `recordAudit()` / `Notification`/`notify()` are the established patterns for anything this phase needs to audit or notify about.

## 2. Core models and corrected design decisions

### 2a. GitHub adapter

`GitHubAdapter` abstract base + `MockGitHubAdapter`/`DisabledGitHubAdapter`/`LiveGitHubAdapter`, cached factory keyed by `GITHUB_PROVIDER` env var — the same outer shape as every other adapter in this codebase, but with real internal state where the others don't need any (see evidence audit above).

Operations: `createRepository(name)`, `createBranch(repo, fromBranch, newBranch)`, `commitFiles(repo, branch, files[], message)`, `createPullRequest(repo, headBranch, baseBranch, title)`, `mergePullRequest(repo, prNumber)`, `enablePagesForBranch(repo, branch)` → preview URL.

`MockGitHubAdapter` simulates, in memory, a real repo/branch/file-tree/PR/Pages-URL lifecycle (branches keyed off a parent, commits producing synthetic SHAs, PRs with open→merged/closed state) — real merge-conflict detection is explicitly out of scope (confirmed during review: detached-section custom code lives entirely under `custom/`, which the generator never writes to; Leadzaro's own tests only need to exercise its own orchestration logic, never git's merge algorithm — `LiveGitHubAdapter` inherits real conflict handling from actual GitHub for free).

`DisabledGitHubAdapter` rejects every operation (matching `DisabledStorageProvider`'s "no silent success" precedent — confirmed correct during review, since promote-to-development is a load-bearing action, unlike an optional calendar sync that can degrade to `not_configured`).

### 2b. `WebsiteRepository`

`id, websiteId (unique), organizationId, agencyOrganizationId, provider ('github'), externalRepoId (nullable), fullName (nullable), defaultBranch, status ('provisioning'|'active'|'error'), createdByUserId`.

**Correction (review findings #4 and #5, resolved together)**: the original draft proposed eager creation (both the row and the real external adapter call) at `Website`-creation time, reading §16's "repository creation occurs when design work begins" as "creating a Website is design beginning." The review identified two real problems with this: (1) no backfill story for `Website` rows already created throughout Phase 4/5 development, and (2) once `LiveGitHubAdapter` exists, every trial/abandoned/never-launched website would eventually cause a real external GitHub repo to be created, most of which may never be used beyond blank-mode draft editing.

Resolved by reusing `findOrCreateProjectFinancials`'s exact shape: a **lazy `findOrCreateWebsiteRepositoryForRequester`** accessor, called on first real need (first non-blank `draftSchema` save, or first promote-to-development action — whichever comes first in practice) rather than at `Website` creation. This closes both problems at once: no backfill migration is needed (a pre-existing `Website` simply gets its `WebsiteRepository` row created lazily the first time this phase's own code touches it, exactly like `ProjectFinancials` already does for pre-Phase-4 projects), and no external repo is ever provisioned for a website that stays in blank-draft-only editing.

Guarded, plain tenant scoping (no client/internal split) — a client can already see their own website exists; a repository record carries no additional sensitive information beyond that.

### 2c. `SectionDefinition.state` and the new per-instance `state` field

**Correction (review finding #1 — the most load-bearing fix from the review)**: the original draft proposed all four states (`managed`/`extended`/`registered_custom`/`detached`) live on `SectionDefinition.state` — the shared library catalog row, keyed by `componentKey`, referenced by every section *instance* across every page of every website that uses that component. The review identified this as a genuine, dangerous defect for `detached` specifically: if website A's homepage hero is detached and recorded by setting `state: 'detached'` on the shared "hero" `SectionDefinition` row, every *other* website using that same componentKey (potentially a different client entirely, or a system-wide row) would also read as detached, and the generator would incorrectly skip regenerating a section it should still fully manage elsewhere. This is the same class of whole-vs-per-instance granularity error Phase 5's own pre-implementation review caught for editing levels (§2e of that phase's plan).

Fixed by splitting the concept:

- **`SectionDefinition.state`** (type-level, unchanged column) — meaningful only for `managed` (the default, standard library component) and `registered_custom` (a whole hand-authored component type registered into the library, given its own `settingsSchema`, rendering implementation under `custom/components/`).
- **A new per-instance `state` field**, sibling to `id`/`componentKey`/`variant`/`settings`/`content` on every section object inside `draftSchema`/`WebsiteVersion.schema` — used specifically for `detached` (this one instance, on this one page, has been ejected from generated management; every other instance of the same componentKey elsewhere is unaffected). Defaults to `'inherited'` (defer to the type's `SectionDefinition.state`) when absent, so every existing Phase 5 schema stays valid with no migration needed.
- **`extended`** (review finding #7): resolved as **type-level**, alongside `managed`/`registered_custom`, not instance-level like `detached` — the generator always fully emits and regenerates an `extended` section's standard shape on every run; it additionally emits a named extension hook (e.g. a defined `@Input()` binding point) that an optional file under `custom/` may supply. This was the vaguest of the four states in the original draft and architecture §§14-15 don't define its mechanism explicitly; keeping it type-level avoids extending the instance-vs-type conflict found in `detached` to a second state.

`schemaDiff.js`'s classifier must be extended to read this new per-instance field the same defensive way it already treats an unrecognized settingsSchema key (safe-by-default) — an instance with `state: 'detached'` is always structurally significant regardless of which properties changed (see § 2d below).

### 2d. Builder-side enforcement: `authorizeAndClassifySchemaChange` must know about component state

**Correction (review finding #2 — the second load-bearing fix)**: the original draft's defense-in-depth (§ 2f below) only covered the *generator's* file-write path. The review identified that nothing in the draft protected the *builder's* own `updateDraftSchema`/`restoreVersion` path (Phase 5's existing shared `authorizeAndClassifySchemaChange` function) from a designer freely editing, repositioning, or deleting a `detached`/`registered_custom` section instance's `content`/`settings` through completely ordinary draft-save actions — a direct violation of this phase's literal major gate via a path the original draft never analyzed.

Fixed by extending `authorizeAndClassifySchemaChange` (still the single function shared by both `updateDraftSchema` and `restoreVersion`, per Phase 5's own restore-bypass-fix precedent — never let one path get this check and the other not) to independently re-derive each changed instance's effective state (per § 2c) and apply an additional rule on top of the existing per-property editing-level check:

- A `detached` instance rejects any change to its `content`, and rejects any change to `settings` keys the section's own `settingsSchema` doesn't explicitly mark `builderEditable: true` (a new, opt-in flag a developer sets when detaching a section, for the specific properties — e.g. a heading toggle, not raw markup — they want a designer to keep controlling from the builder). Reordering/moving the instance within a page remains allowed (structural changes are already gated at `professional`+ by the existing check).
- A `registered_custom` instance is treated exactly like any other library component — its own `settingsSchema`'s per-property `editingLevel`/`requiresReview` already governs it correctly with no new rule needed, since its rendering implementation living under `custom/` is a generator-side concern, not a builder-authorization concern.
- **Restore-of-a-pre-detachment-checkpoint edge case** (explicitly designed now, not discovered as a bug later, per the same lesson Phase 5 had to learn the hard way for its own restore path): restoring an old `WebsiteVersion` whose snapshot predates a section's detachment must not silently re-clobber the now-custom implementation on the next generator run. `restoreVersion` checks whether any restored instance's componentKey+position currently corresponds to a `detached` instance in the *live* draft; if so, the restore is rejected for that instance specifically (409, "this section has since been detached from the builder — restoring this version would discard developer-owned custom work") rather than either silently succeeding or blocking the entire restore.

### 2e. `WebsiteDevelopmentHandoff` and `WebsiteDeployment`: employee-only, explicitly decided

**Correction (review finding #3)**: the original draft explicitly decided `WebsiteRepository`'s visibility (plain tenant scoping) but left `WebsiteDevelopmentHandoff` and `WebsiteDeployment` undecided by omission — exactly the kind of gap Phase 4 (`Message`/`ProjectChannel`) and Phase 5 (`WebsiteVersion`) each had to retrofit a correction for after being caught by review, rather than deciding explicitly up front.

Both are **employee-only**, mirroring `ProjectFinancials`'s `assertEmployeeContext` pattern exactly — never reachable by a client-membership request, full stop. Neither carries anything a client needs to see directly (branch names, commit SHAs, handoff notes, internal repo state). If a client-facing "your site's preview is ready" signal is wanted (§16's "notify assigned roles" — read as including the client where appropriate), it's surfaced via the existing `Notification` model with just a URL/message payload, never by exposing these rows themselves.

- **`WebsiteDevelopmentHandoff`**: `id, websiteId, websiteVersionId (FK — the exact checkpoint being promoted, immutable), branchName, technicalHandoffNotes, status ('initiated'|'preview_ready'|'in_development'), initiatedByUserId`. One record per promote-to-development action, capturing §16's checklist (named checkpoint + branch + handoff doc + tasks + preview + notify) as one coherent, auditable action.
- **`WebsiteDeployment`**: `id, websiteId, websiteVersionId (FK — the design version ↔ commit ↔ deployment linkage), developmentHandoffId (nullable — null for a pure design-only preview), environment ('preview'|'production', defaulting to 'preview' this phase — see correction below), branchName, commitSha, previewUrl, status ('pending'|'building'|'live'|'failed'), deployedByUserId`.

**Correction (review finding #6)**: the original draft intended `WebsiteDeployment` to be reused across this phase's preview deploys and Phase 7's eventual production deploys, but never made that reuse concrete. Phase 7's own roadmap major gate is specifically about backup/rollback/health-check semantics, which this phase's shape has no room for (no `rolled_back` state, no backup pointer, no environment distinction). Adding `environment` now lets Phase 7 extend this same table (widen `status`, add backup/health-check fields via a follow-on migration) rather than needing to repurpose or duplicate it later.

No new model for "developer merge-back workflow" (confirmed sound during review, no correction needed) — a merge-back is a GitHub PR from a developer branch back to the design branch (the adapter's own `mergePullRequest`), recorded on the Leadzaro side only as an audit entry plus the relevant `SectionDefinition.state`/per-instance-state transition from § 2c, not a dedicated tracking table.

### 2f. The generated/custom boundary (the major gate's primary mechanism)

Directory split exactly per architecture §15's own example tree, inside each website's generated repository:
```
src/app/
  generated/{pages,configuration}/   ← generator writes here, and ONLY here, for 'managed' sections
  components/standard/               ← generator writes here for reusable standard components
  custom/{components,features,integrations}/  ← generator NEVER writes here, ever
styles/{design-tokens.scss,global.scss}
site.schema.json                     ← a snapshot of the WebsiteVersion.schema being generated from
leadzaro.config.json
```

The generator's file-write primitive (`server/core/codegen/angularGenerator.js`) takes a manifest of `{path, content}` and throws before writing anything if any path doesn't start with an allowed prefix (`generated/`, `components/standard/`, the two style files, or the two root config files) — structural defense-in-depth, not just a naming convention. This mechanism alone is **not sufficient** on its own (that was the original draft's gap — see § 2d's correction, which is the other, equally necessary half of this major gate).

`extended` sections (§ 2c): generator emits the standard shape plus a named extension hook on every run, regardless of instance. `registered_custom` componentKeys: generator emits only a reference/import, never inline markup. `detached` instances (per-instance state, § 2c): generator skips regenerating that specific instance's markup while still generating everything else on the same page normally.

### 2g. Angular generation scope (deliberate boundary, review-confirmed)

The generator runs against a specific immutable `WebsiteVersion.schema` — never the live mutable `draftSchema` — matching the version-immutability principle Phase 5 already established and matching "design version ↔ commit ↔ deployment linkage" directly (the version being generated is exactly the version a `WebsiteDeployment` record points at).

**Confirmed during review, no correction needed**: this phase delivers a real, compiling, typed Angular generator — not a stub — producing genuinely developer-quality routed page components and standard-section components from the schema. Full pixel/visual fidelity polish is explicitly secondary to structural correctness (correct routing, correct typed inputs, correct generated/custom boundary, correct component-state handling), mirroring the Phase 5 preview renderer's own "structural proof, not pixel-perfect" precedent.

**Correction (review finding #8, additive)**: because this phase explicitly promises "a real, compiling" generator (not just unit tests asserting the generator wrote the right strings), the phase's own testing priorities (§ 4 below) include an actual `ng build`-style compile check run against a real generated output tree, not just assertions on generator output content.

## 3. Permission summary

No new client-facing permission — every action in this phase (repository access, promote-to-development, merge-back, component registration/publication review) is employee-only, matching § 2e's visibility decision. Reuses `builder.manage` (administrator + project_manager, already established in Phase 5) for promote-to-development and component publication/review; a new `builder.develop` permission (developer + advanced_designer only) gates the actual code-generation trigger, merge-back actions, and custom-component registration — narrower than `builder.manage` since these are genuinely developer-role actions, not agency-management actions, mirroring the existing `builder.edit`/`builder.publish`/`builder.manage` three-tier precedent from Phase 5.

## 4. Testing priorities

1. Raw unscoped query throws, for every new guarded model (`WebsiteRepository`, `WebsiteDevelopmentHandoff`, `WebsiteDeployment`).
2. `WebsiteDevelopmentHandoff`/`WebsiteDeployment` employee-only visibility — a client-membership request must never reach either, direct regression tests analogous to `ProjectFinancials`'s own employee-only test.
3. **The major gate, both halves**: (a) the generator's path-prefix write-primitive rejects any attempt to write outside `generated/`/`components/standard/`/the style and config files; (b) `authorizeAndClassifySchemaChange` rejects a builder-side edit to a `detached` instance's `content`, and to any `settings` key not marked `builderEditable`, while still allowing reordering.
4. The restore-of-a-pre-detachment-checkpoint edge case (§ 2d) — a dedicated regression test, written *before* any caller could rely on the wrong behavior, mirroring how Phase 5's own restore-bypass fix was verified.
5. `MockGitHubAdapter`'s stateful lifecycle: branch-before-commit ordering, PR open→merged transitions, a Pages URL only available after `enablePagesForBranch`.
6. `findOrCreateWebsiteRepositoryForRequester`'s laziness — no `WebsiteRepository` row (and no adapter `createRepository` call) exists for a website that has only ever been saved in blank-mode draft form.
7. An actual `ng build` (or equivalent Angular CLI compile) run against a real generated output tree for at least one non-trivial multi-page, multi-section-state (managed + extended + registered_custom + detached) website — proving the "developer-quality, compiling" claim structurally, not just asserting generator output strings.
8. Cross-agency isolation for every new table (the standard suite-wide pattern).

## 5. Suggested slice order

1. `GitHubAdapter` (mock/disabled first) + `WebsiteRepository` with its lazy `findOrCreateWebsiteRepositoryForRequester` accessor.
2. The per-instance `state` field on section instances (§ 2c) + the generated/custom boundary write-primitive (§ 2f) — everything else depends on both being right, and together they are the major gate's mechanism half.
3. `authorizeAndClassifySchemaChange`'s new component-state-aware rules (§ 2d), including the restore-of-a-pre-detachment-checkpoint edge case — the major gate's authorization half, and the review's most emphasized correction.
4. The actual Angular generator (schema → typed output) for `managed`-state sections only, against the boundary from slice 2.
5. `extended`/`registered_custom`/`detached` component-state generation, extending the generator from slice 4.
6. Branches + preview workflow + GitHub Pages automatic previews (`WebsiteDeployment`, `environment: 'preview'`).
7. Promote-to-development checkpoint/handoff (`WebsiteDevelopmentHandoff`).
8. Developer merge-back workflow + custom component editor schemas + component publication permission/review (`builder.develop`).
9. Final full-phase review (major-gate-both-halves focus, mirroring Phase 5's own closing pass) + completion report.
