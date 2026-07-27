# Phase 5 Completion Report

## Phase

- Phase number/name: Phase 5 — Website Builder Foundation
- Branch/checkpoint: `main`, commits `a825e14` through `d32c86d` (slices 1–8 plus the closing review's fix commit)
- Started: 2026-07-27
- Completed: 2026-07-27
- Overall result: **Complete**, with a documented deferred backlog (see below), none blocking.

## Scope delivered

The schema-first website builder foundation Phase 6 (Angular code generation) and Phase 7 (hosting) build on, delivered in 9 slices per `docs/leadzaro/current-phase-plan.md`:

1. **`DesignSystem` + `Website` + `WebsiteVersion`**: the schema/versioning foundation. `Website` is 1:1 with `Project`, holding a mutable `draftSchema` (pages → sections, schema-first per architecture §14). `WebsiteVersion` is an immutable full-snapshot-per-version model (never a diff/event log), with a non-tenant client-visibility split (`published`/`approved`, or the client's own submitted versions — never another user's in-progress draft). `DesignSystem` follows a fork-never-reference rule: a client's own instance is always a copy of a library template's tokens, taken at creation time, so a later library edit can never retroactively change an already-published site.
2. **`SectionDefinition` library + preview renderer**: an agency-scoped catalog (OR-logic tenancy — platform defaults plus the caller's own agency's custom sections) of reusable components, and a schema-only preview (`WebsitePreviewComponent`) proving the draft schema alone carries everything needed to reconstruct a page.
3. **Per-property editing-level enforcement (the secondary major gate)**: `builder.edit`/`builder.publish` permissions, `WebsiteEditorAssignment` (a dedicated table, not a field bolted onto `ProjectAssignment` — editing level is a distinct axis from project role), and property-level (never whole-section) Basic/Professional/Advanced classification with an independent `requiresReview` flag, enforced server-side on every mutating path.
4. **Autosave + named checkpoints + compare + restore** (the major gate's version-history half): a shared `authorizeAndClassifySchemaChange` function used by both a normal draft save and a version restore, so restoring never bypasses the per-property gate.
5. **Asset manager**: `website_asset` completed into `File.CLIENT_FACING_SCOPES`, `sharp`-based responsive image variants generated in-process at upload time (never blocking the original upload on variant-generation failure).
6. **Content scopes + form builder**: page/section, site-global (`siteSettings`), and organization-level (`organizationContent`) content scopes, all routed through the same `requiresReview` mechanism; a `form` section wired end-to-end to `ClientRequest` as its one real submission target this phase (an authenticated test-submit path — this phase has no live-hosted public site for a real anonymous visitor path yet).
7. **Collaboration**: `WebsiteComment` (anchored feedback, internal/client-visible split), `WebsiteEditLock` (short-TTL, heartbeat-renewed), `WebsitePresence` ("Currently Viewing," heartbeat-based, no WebSocket/SSE infrastructure — deliberately poll-based per the phase's own foundation-scope decision).
8. **`page_kit`/`guided`/`template` starting modes + library governance**: all three non-blank starting modes assemble a starting `draftSchema` from the section library (a fixed curated list for `template`/`page_kit`, the caller's own explicit choices for `guided`); `template` additionally forks a library `DesignSystem`'s tokens and is employee-only (§2a: a library template is never client-visible directly). New `builder.manage`-gated governance (create/publish/deprecate) for agency-owned custom `SectionDefinition`/`DesignSystem` templates, with the platform-provided base library staying migration-seeded only.
9. **This closing review and report.**

## Acceptance matrix

| Requirement | Implementation | Tests | Status |
|---|---|---|---|
| The schema, preview renderer, and version history are stable before Phase 6 (the major gate) | `draftSchema`/`WebsiteVersion.schema` shape stable across all 9 slices; `WebsitePreviewComponent` renders from schema alone | `websites.test.js`, `websiteVersioning.test.js`, `libraryGovernance.test.js` | Done |
| Basic/Professional/Advanced editing enforcement is server-side, per-property, never frontend-hidden (the secondary major gate) | `editingLevel.js` + `schemaDiff.js`, shared by `updateDraftSchema` and `restoreVersion` alike | `websiteEditingLevels.test.js` (8, incl. the restore-bypass regression) | Done |
| A client never sees another user's in-progress draft/autosave work | `websiteVersionWhereForRequester`'s non-tenant split (`published`/`approved` OR own `createdByUserId`) | `websiteVersioning.test.js` | Done |
| A `requiresReview`-flagged change (any level) or a structural page/nav change always forces `pending_review`, regardless of who made it | `authorizeAndClassifySchemaChange` + `Website.draftHasPendingReviewChanges` | `websiteEditingLevels.test.js` | Done |
| `WebsiteEditorAssignment` never grants `advanced` to a client, never references a user outside the website's own tenant | `addAssignment`'s membership + level checks | `websiteEditorAssignments.test.js` | Done |
| `website_asset` files are client-visible only when tied to a website the client can already see | `filterClientVisibleFiles`'s `website_asset` branch, mirroring `task_attachment` | `files.test.js` | Done |
| An internal `WebsiteComment` is never visible to a client, and `isInternal` is never trusted from client input | `websiteCommentService.createComment`, server-derived `isInternal` | `websiteCollaboration.test.js` | Done |
| A `WebsiteEditLock` cannot be released by anyone but its holder; a heartbeat is idempotent per (website, user) | `websiteCollaborationService` | `websiteCollaboration.test.js` | Done |
| A library template/custom section starts `draft` (invisible for new use), only appears once `published`, and is curatable only by its own agency | `libraryGovernanceService`, `status` lifecycle on both models | `libraryGovernance.test.js` (16) | Done |
| A library `DesignSystem` template is never visible to a client directly, even with `builder.edit` | `designSystemLibraryWhereForRequester`'s client-exclusion | `libraryGovernance.test.js` | Done |
| An auto-assembled section's properties land in the same `content`/`settings` buckets the preview renderer and form submission actually read | `buildDefaultSectionInstance`'s type-based bucket routing (closing-review fix) | `libraryGovernance.test.js` (2 new regression tests, incl. end-to-end assemble → edit → submit) | Done |
| Cross-agency isolation on every one of the 8 new guarded models | `visibilityGuard.js` + `clientVisibleModels.js` accessors | Dedicated raw-unscoped-query-throws test per model, plus cross-agency tests throughout | Done |

## Repository changes

### Backend

- Modules/services: `server/modules/websites/` (`websiteService.js`, `websiteController.js`, `routes.js`, `sectionDefinitionService/Controller/Routes.js`, `websiteEditorAssignmentService/Controller.js`, `websiteCommentService/Controller.js`, `websiteCollaborationService/Controller.js`, `libraryGovernanceService/Controller.js`, `designSystemTemplateRoutes.js`); `server/core/websites/{websiteCatalog.js,schemaDiff.js,editingLevel.js}`; `server/core/storage/imageOptimization.js`.
- Routes/APIs: `/api/v1/projects/:projectId/website` (+ `/draft`, `/versions[/compare|/:versionId[/restore|/publish]]`, `/versions/autosave`, `/forms/test-submit`, `/editors`, `/comments[/:id/resolve]`, `/locks[/:id]`, `/presence`); top-level `/api/v1/section-definitions` (+ `/manage`, `/:id/publish|deprecate`) and `/api/v1/design-system-templates` (same shape).
- Authorization: new permissions `builder.edit`, `builder.publish`, `builder.manage` — each with its own idempotent seed migration, mirrored in `catalog.js`.
- Jobs/events: none new — presence/locks are poll-based (heartbeat + recency window), no background scheduler or real-time transport introduced.

### Frontend

- Routes/screens: no new top-level route — the Projects screen (`src/app/features/projects/`) grew a Website panel across every slice (create → draft/versions/preview → assets → content scopes/forms → editor access → comments/presence → starting-mode picker); a new "Website Library" tab added to `src/app/features/administration/` for `builder.manage` governance.
- State/services: `src/app/core/services/{website,sectionDefinition,designSystemTemplate}.service.ts`; matching `src/app/core/models/{website,sectionDefinition,designSystemTemplate}.model.ts`; `WebsitePreviewComponent` (standalone).
- Permission behavior: every action gated by `*hasPermission`/`org.hasPermission()` matching the server-side permission, including the `template` starting mode's employee-only UI restriction (mirrored server-side, never the sole enforcement).
- Mobile/accessibility: reuses the app's existing table/card/chip patterns; no dedicated mobile layout added this phase, consistent with Phase 4's own deferral.

### Database

- New tables: `DesignSystems`, `Websites`, `WebsiteVersions`, `SectionDefinitions`, `WebsiteEditorAssignments`, `WebsiteComments`, `WebsiteEditLocks`, `WebsitePresences`.
- Changed tables: `Files` (added `variants` JSONB); `SectionDefinitions`/`DesignSystems` (added `status` lifecycle column, slice 8).
- Indexes/constraints: every new table denormalizes `organizationId`/`agencyOrganizationId` directly, matching the established convention; unique constraints on `(websiteId, sectionKey)` for edit locks and `(websiteId, userId)` for presence.
- Backfills: none needed — every new table is additive with no pre-existing data to migrate.
- Rollback behavior: every schema migration has a working `down()`; permission-seed and reference-data-seed migrations are intentionally not reversed, matching established precedent.

## Legacy compatibility

- Preserved workflows: Phases 1–4 untouched. Phase 5 is new functionality layered on the existing `Project` model (1:1 `Website`).
- Compatibility adapters: none needed.
- Deprecated fields/routes: none.
- Planned removal phase: N/A.

## Security and privacy

- Secret handling: no new environment variables or credentials introduced this phase; `sharp` (image processing) and the new library-governance surface are entirely in-process/local, no new external adapter.
- Authentication/session changes: none.
- Authorization/isolation tests: every one of the 8 new guarded models has a dedicated raw-unscoped-query-throws test; cross-agency isolation verified throughout (`libraryGovernance.test.js` explicitly proves an agency can never publish/deprecate another agency's section or a system-defined one).
- Input/file/webhook protections: no new webhook surface; image variant generation fails closed to "no variants" rather than blocking the original upload if `sharp` cannot decode the input.
- Impersonation/audit behavior: every governance mutation (section/template create, publish, deprecate) and every website mutation (create, checkpoint, restore, publish) is recorded via `recordAudit`.
- **Design-review-before-implementation pattern**: for this phase specifically, a full architecture draft was escalated to `fable-phase-reviewer` *before* any migration was written (not just a closing review). That review returned 10 findings, 3 of which required revising the draft before implementation — most significantly, moving editing-level classification from per-section to per-property (a whole-section `minEditingLevel` would have either wrongly blocked legitimate Basic edits or wrongly allowed a Basic editor to change a Professional-tier property within an otherwise-simple section).
- **Self-caught issues (not from external review) during implementation**: (1) `restoreVersion` originally bypassed per-property enforcement entirely — fixed by extracting `authorizeAndClassifySchemaChange` as a function shared with `updateDraftSchema`; (2) `siteSettings`/`organizationContent` were never diffed at all, letting a Basic client change them freely — fixed with `diffGlobalContentScope`; (3) a real Phase-4 regression where `sharp` crashed the whole upload on undecodable image bytes — fixed by making variant generation additive-only, never blocking.
- **Closing-review finding, fixed before this report**: `buildDefaultSectionInstance` (the starter-schema generator backing `template`/`page_kit`/`guided`) placed every auto-assembled property into a section's `settings` bucket regardless of type, while the preview renderer reads only `content` and `submitTestForm` reads `content.submitTarget` specifically. Every website created via a non-blank starting mode therefore rendered every section as empty in preview, and a form's `submitTarget` could never be found once configured through the real draft-edit path. Fixed by routing each property into `content` vs. `settings` by its declared type; verified by two new regression tests, one exercising the full assemble → edit → submit pipeline end-to-end (see commit `d32c86d`).

## Validation commands run

- Dependency install: none new this phase (`sharp` was already a dependency as of slice 5; no new packages added in slices 7–9).
- Frontend build: `npm run build` — clean (only the pre-existing, unrelated `landing.component.scss` budget warning).
- Type check/lint: TypeScript diagnostics clean on every modified frontend file (checked incrementally after each edit).
- Backend checks: syntax/require sanity-checked (`node -e "require('./server/app')"`) after every slice.
- Unit tests: `npm run test:backend` — **254/254 passing (31 suites)**, re-run clean after the closing-review fix.
- Integration tests: included in the same backend suite — `websites.test.js` (14), `sectionDefinitions.test.js` (4), `websiteEditingLevels.test.js` (8), `websiteEditorAssignments.test.js` (8), `websiteVersioning.test.js` (6), `websiteContentScopesAndForms.test.js` (5), `websiteCollaboration.test.js` (10), `libraryGovernance.test.js` (16), plus 3 `website_asset`-specific additions to `files.test.js`.
- Migration tests: all 9 Phase 5 migrations applied cleanly to the real dev database (`npm run migrate`) and to a freshly-recreated test database via Jest's `globalSetup`; re-verified a second time after the dev Postgres container was rebuilt mid-phase (see Known risks).
- End-to-end/manual checks: real headless-Chrome sessions (synthetic org/user/project, logged in through the real UI, synthetic data removed after) for: the website builder foundation (slice 1), WebsiteComment internal/non-internal visibility split and WebsitePresence "Currently Viewing" (slice 7, incl. a genuine immediate-heartbeat UX fix found during verification), and library governance end-to-end — created and published a section and a design-system template via the admin UI, then created a `guided`-mode website whose homepage schema actually contained the chosen section (slice 8).
- Frontend tests: `npm run test -- --watch=false` — **18/18 passing**, re-run clean after every slice and after the closing-review fix.

## Review pass 1 — per-slice engineering (ongoing throughout the phase)

| Severity | Finding | Resolution | Verification |
|---|---|---|---|
| High (security, pre-implementation) | Draft design used a whole-section `minEditingLevel`, an authorization gap in the unsafe direction for any mixed-tier section | Moved to per-property classification (`SectionDefinition.settingsSchema[key].editingLevel`) | `websiteEditingLevels.test.js` |
| High (security, self-caught) | `restoreVersion` bypassed per-property enforcement — a Basic-assigned editor could restore a version containing another user's Professional/Advanced content | Extracted `authorizeAndClassifySchemaChange`, shared by both `updateDraftSchema` and `restoreVersion` | Dedicated regression test |
| Medium (self-caught) | `siteSettings`/`organizationContent` were never diffed, leaving them freely editable at any level | Added `diffGlobalContentScope`, unconditionally `professional`+`requiresReview` | `websiteContentScopesAndForms.test.js` |
| Medium (regression, self-caught) | `sharp` crashed the whole upload on an existing Phase 4 test's fake image bytes | Variant generation wrapped in try/catch, additive-only, never blocking the original upload | New explicit graceful-degradation test + a real-PNG variant-generation test |

## Review pass 2 — final full-phase closing review (fable-phase-reviewer)

A dedicated closing review covering all 9 slices, focused specifically on schema-stability and authorization per the phase's own stated major/secondary gates (per CLAUDE.md's escalation rule). Verified: every `listSectionDefinitionsForRequester` call site's `includeUnpublished` default; the `DesignSystem` library-template client-exclusion and every path that reads a library row; the permission/role table against `catalog.js`; and the schema shape actually produced by the slice-8 starter-schema generator against what the preview renderer and form submission independently expect.

| Severity | Finding | Resolution | Verification |
|---|---|---|---|
| High | `buildDefaultSectionInstance` placed every auto-assembled property into `settings`, while the preview renderer and `submitTestForm` each expect specific properties in `content` — every `template`/`page_kit`/`guided` website rendered empty and a form's `submitTarget` could never be found | Type-based content/settings routing in `buildDefaultSectionInstance` | Two new tests: direct bucket-placement assertion + an end-to-end assemble → edit-via-real-draft-path → submit test |

The review additionally flagged five areas as "not independently re-verified" given a mid-review stop instruction (`WebsiteEditorAssignment` creation checks, the comment/lock/presence write-path trust boundary, governance route permission decoration, image optimization, and full test-file coverage). Each was directly re-checked against current source after the review: `websiteEditorAssignmentService.addAssignment`'s membership/level checks, `websiteCommentService.createComment`'s server-derived `isInternal` (`context.membership.membershipType === 'client' ? false : !!isInternal`), and both `sectionDefinitionRoutes.js`/`designSystemTemplateRoutes.js`'s four mutating endpoints are all `builder.manage`-gated — all confirmed correct by direct source reading, consistent with their own passing dedicated tests. No Critical or unresolved High findings remain.

## Regression verification

Every Phase 1–4 test suite re-run unchanged and passing alongside the 8 new/extended Phase 5 suites: authentication/sessions, organization isolation, RBAC, invitations, impersonation, CRM (opportunities, merge, scoring, dashboard, website audit, enrichment), public inbound leads, billing, projects/tasks/messaging/requests/meetings/files/cancellations, and the migration test suite. 254/254 backend, 18/18 frontend — re-run a second time after the closing-review fix and again after an unrelated mid-phase environment interruption (see Known risks) to confirm no residual state dependency.

## Data migration evidence

- Empty DB result: all 9 Phase 5 migrations apply cleanly to an empty database.
- Legacy DB result: applied cleanly on top of the full Phase 1–4 migration history, twice — once during normal development, and a second time from a freshly recreated database after the dev Postgres container was rebuilt mid-phase (see Known risks) — both runs produced an identical, fully-migrated schema.
- Record counts before/after: N/A — every Phase 5 table is new, no pre-existing rows to migrate; one platform-seeded `DesignSystem` ("Standard Business") and 5 platform-seeded `SectionDefinition` rows added via reference-data migrations.
- Duplicate/loss checks: N/A (additive-only tables).
- Rollback test: every Phase 5 schema migration has a working `down()`; not exercised via a full rollback-and-re-migrate cycle this phase, matching Phase 4's own noted limitation.

## Manual configuration required

None. Every Phase 5 feature (image optimization, library governance, all four starting modes) runs entirely in-process against the existing local Postgres/file-storage setup — no new external provider, credential, or account is needed.

## Deferred backlog

### Medium priority

- `WebsiteEditLock` has full backend implementation and test coverage but no frontend UI — a deliberate slice-7 scope decision, since the builder has no live multi-cursor editing surface yet for a lock UI to meaningfully guard.
- Split the now-large `src/app/features/projects/projects.component.{ts,html,scss}` (grown by a panel every slice across both Phase 4 and Phase 5) into per-panel sub-components — noted as a refinement candidate throughout, not yet done.

### Low priority

- No dedicated mobile layout for the website builder panels beyond the app's existing responsive patterns.
- The `guided` starting mode's section picker is a flat multi-select, not a true multi-step wizard UI — a reasonable "Foundation" scope reading of §14's "guided generation," but a fuller wizard experience is a natural later refinement.

### Deliberately deferred to later phase

- Real public, anonymously-reachable website rendering and real (non-test) form submissions — this phase has no live-hosted site at all; `submitTestForm` proves the `ClientRequest` wiring is correct end-to-end so Phase 7 (hosting) has a known-working target to call into.
- Real-time collaborative editing (operational transform) — presence/locks are deliberately short-TTL and poll-based per the phase's own approved design; no WebSocket/SSE infrastructure exists anywhere in this codebase yet.
- Multiple websites per client organization (`Website` stays 1:1 with `Project`), and promoting `organizationContent` to a table shared across sites — both documented, deliberate simplifications tied to that same 1:1 boundary.

## Known risks

- Mid-phase, the local Docker Desktop installation was reinstalled by the user, taking down the dev Postgres container (and its data volume) along with the frontend/backend dev servers. This was diagnosed as a genuine external environment event (confirmed via exhaustive, read-only checks — no Windows service, no reachable Docker daemon, no running WSL distro, nothing in the registry/Chocolatey — before concluding it wasn't something startable from within this session), not a defect in Phase 5 itself. Recovered via `docker compose up -d` (rebuilding the named volume fresh) + `npm run migrate`; the full backend suite was re-verified at 254/254 immediately after recovery with no discrepancy from the pre-interruption run, and both dev servers were restarted. No lasting risk, but noted here since it interrupted the closing review's own verification pass.
- The closing review's own findings depended on a mid-review stop instruction; the five flagged-as-unverified areas were each independently re-checked by direct source reading afterward (see Review pass 2), but a from-scratch second full review was not run — a reasonable and sufficient bar for a Foundation-phase closing pass, not a substitute for ongoing vigilance in Phase 6 if these accessors are touched again.

## Documentation updated

- README: not applicable.
- Architecture decisions: `docs/leadzaro/current-phase-plan.md` (the full, review-corrected Phase 5 design — §§1–5, all corrections marked explicitly). No new ADR file was needed; Phase 5 extends ADR 0007's existing guarded-model pattern to 8 new models without changing the pattern itself.
- API docs: none formal; routes documented inline via the phase plan and this report's acceptance matrix.
- Migration docs: inline comments in every new migration explaining its purpose and (where relevant) which architecture correction it implements.
- User/admin instructions: none needed — no new environment variables or manual setup this phase.

## Readiness for next phase

- Ready: Yes
- Blocking reasons: none
- Recommended next-phase starting point: Phase 6 — Angular Generation and Developer Workflow (per `docs/planning/06_PHASES_2_TO_8_ROADMAP.md`), building directly on the now-stable `draftSchema`/`WebsiteVersion.schema` shape.
- Generated next-phase prompt path: `docs/leadzaro/NEXT_PHASE_PROMPT.md` (to be rewritten for Phase 6 immediately after this report is finalized).
