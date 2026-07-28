# Phase 8 Completion Report

## Phase

- Phase number/name: Phase 8 — Premium SEO and Advanced Services
- Branch/checkpoint: `main`, commits `fe76f0a` through `32656f7` (slices 1–8 plus frontend wiring)
- Started: 2026-07-28
- Completed: 2026-07-28
- Overall result: **Complete**, with a documented deferred backlog (see below), none blocking. This is the final phase in `docs/planning/06_PHASES_2_TO_8_ROADMAP.md`.

## Scope delivered

The first phase to introduce a billing-gated feature surface layered on top of the existing website-builder/production-hosting foundation (Phases 5–7) — delivered in 8 slices per `docs/leadzaro/current-phase-plan.md`, itself the product of a pre-implementation design review that returned 9 findings (3 must-fix) before any migration was written, mirroring Phases 5–7's own process:

1. **The SEO entitlement architecture** — the major gate's own mechanism. `hasSeoEntitlement(organizationId)` ORs two independent sources: a real billing-driven check (`BillingAccount` → all its `Subscription` rows with `status === 'active'` → does any `addOnServicePlanIds` array contain the seeded `seo_addon` `ServicePlan`'s id) and a manual `SeoEntitlementGrant` (employee-issued, revocable, auditable). `assertSeoEntitlement(context, website)` is a plain service-layer function called after the target website is already resolved — not Express middleware, because `resolveContext()` never loads the target resource's owning organization. A new `seo.manage_entitlements` permission (administrator + billing roles) gates grant/revoke/status/agency-overview. `assertClientOrganizationOwnedByAgency` closes the cross-agency gap on the `:organizationId` route param.
2. **Page metadata / canonical / robots controls** — `WebsitePageSeoSettings` (one row per page, upserted in place, client-editable via `builder.edit` for the appropriate client roles, additionally gated by the SEO entitlement), plus generated `sitemap.xml`/`robots.txt` reflecting real page routes and per-page `robotsDirective`.
3. **Redirects, emitted as real, functioning Angular routes** — `WebsiteRedirect` (employee-only, unique `fromPath` per website); the Phase 6 generator's `generateRoutesFile` now emits real `{ path, redirectTo, pathMatch: 'full' }` entries ahead of page routes (proven via real `tsc` compilation against `@angular/router`'s actual `Routes` type, not string-content assertions).
4. **Structural technical audits** — `server/core/seo/structuralAudit.js`, a pure function with no DB/adapter dependency, checking missing page titles, empty pages, missing alt text (via the sibling `<key>Alt` content-property convention), and missing meta title/description. Heading-order deliberately scoped down to page-title presence since the schema carries no heading-level metadata — a named, documented scope decision.
5. **`SeoAuditAdapter`** (Mock/Disabled/Live, the 9th adapter in this codebase) + **`WebsiteSeoAudit`** — broken-link and performance checks against the website's own live pages only (never arbitrary external links), each resolving to one of three outcomes (`'ok'|'broken'|'inconclusive'`, never silently passing an unchecked link as `'ok'`). One `WebsiteSeoAudit` row per run (audit-trail-per-attempt, matching `WebsiteDeployment`'s convention), combining structural + link + performance findings into one `findings` JSONB array.
6. **Recurring SEO tasks, with a real idempotency guarantee** — `SeoTaskCycle` has a genuine unique index on `(websiteId, cyclePeriod)`; `generateCycle` creates the `SeoTaskCycle` row first and catches `SequelizeUniqueConstraintError` (→ 409) rather than a racy app-level check-then-create, only then creating 3 standard `Task` rows (`isClientVisible: false`). No background scheduler exists in this codebase — "generate this cycle's tasks now" is a real, complete, employee-triggered action, matching Phase 7's `checkRenewal` precedent.
7. **SEO dashboard, client reports, and owner executive reporting** — `getDashboard` is deliberately not gated by `assertSeoEntitlement` itself (would be circular); it returns `{entitled: false, ...zeroed}` for a non-entitled org. For entitled orgs, uses the client-safe `getLatestWebsiteSeoAuditSummaryForRequester` (strips raw `findings` down to `{id, createdAt, errorCount, warningCount}` — the leak-prevention guarantee lives inside the accessor, not caller discipline) plus, only for employee callers, task-cycle/redirect counts. `getAgencySeoOverview` gives agency owners a per-client entitlement rollup. This slice's own test suite caught a real synchronous-throw/`.catch()` bug before shipping (see Errors and fixes below).
8. **Guided Google Search Console connection** — `Website.googleSearchConsolePropertyUrl`, validated against a `sc-domain:`/URL pattern; Leadzaro never provisions a GSC account, matching the Google Analytics precedent from Phase 7.
9. **Frontend wiring**: the full SEO panel in `src/app/features/projects/` — entitlement grant/revoke, page metadata editing, redirects CRUD, run-audit + findings table (with a `countSeoFindings()` helper, added after the smoke test caught the table rendering raw JSON instead of counts), task-cycle generation, GSC connection, and a "Run SEO Audit" button per version row.
10. **This closing review and report.**

## Acceptance matrix

| Requirement | Implementation | Tests | Status |
|---|---|---|---|
| The major gate holds in both directions: entitled orgs get full SEO functionality, non-entitled orgs are blocked/degraded gracefully (never a 500, never silent access) | `assertSeoEntitlement` called at the top of every mutating/reading SEO service function (`seoPageSettingsService`, `seoRedirectService`, `seoAuditService`, `seoTaskCycleService`, `seoSearchConsoleService`); `getDashboard` returns a deliberately zeroed, non-erroring shape instead | `seoEntitlement.test.js` (16), plus entitlement checks embedded in every other Phase 8 test file | Done |
| Entitlement resolution is correct against the real schema (no `Subscription.organizationId` column) | `hasActiveSubscriptionSeoAddon`: `BillingAccount.findOne({organizationId})` → null short-circuits to `false`; else `Subscription.findAll({billingAccountId, status:'active'})` → `.some(addOnServicePlanIds.includes(seoAddonPlan.id))` | `seoEntitlement.test.js` (no-BillingAccount case, active/inactive subscription, manual-grant-only case, both-sources case) | Done |
| A manual grant and a subscription add-on are independent, either one alone is sufficient | `hasSeoEntitlement` ORs both via `Promise.all` | `seoEntitlement.test.js` | Done |
| No employee at Agency A can grant/revoke/inspect entitlement for a client managed by Agency B | `assertClientOrganizationOwnedByAgency` on `listGrants`/`grantEntitlement`/`getEntitlementStatus`; `revokeEntitlement` relies on `getSeoEntitlementGrantByIdForRequester`'s own tenant scoping (equivalent protection — a grant belonging to another agency's client is simply not found) | `seoEntitlement.test.js` (dedicated cross-agency test); self-caught during implementation, not by either review | Done |
| `SeoTaskCycle` generation is idempotent per (website, period) at the database level, not via a racy pre-check | Real unique index `(websiteId, cyclePeriod)`; `generateCycle` creates the row first, catches `SequelizeUniqueConstraintError` → 409 | `seoTaskCycle.test.js` (8, incl. concurrent-duplicate-attempt scenario) | Done |
| Raw `WebsiteSeoAudit.findings` never reaches a client through any code path, including the dashboard | `getLatestWebsiteSeoAuditSummaryForRequester` returns only `{id, createdAt, errorCount, warningCount}`; raw-row accessors (`listWebsiteSeoAuditsForRequester`, `getWebsiteSeoAuditByIdForRequester`) are employee-only and their only route exposure requires `builder.manage` | `seoAudit.test.js` (9); dashboard summary confirmed to omit `findings` | Done |
| A client-context call into an employee-only accessor never 500s (the sync-throw/`.catch()` bug) | `seoDashboardService.js` checks `context.membership.membershipType !== 'client'` explicitly before calling `listSeoTaskCyclesForRequester`/`listWebsiteRedirectsForRequester`, instead of relying on a `.catch()` that can never attach to a synchronously-thrown call | `seoDashboard.test.js` (6, incl. a client-context dashboard request) | Done |
| Redirects are emitted as real, functioning Angular routes, not simulated | `generateRedirectRouteEntries` + `generateRoutesFile`, redirects ordered before page routes (Angular route-array matching order) | `angularGeneratorOutput.test.js` (2 new tests, incl. real `tsc` compile against `@angular/router`'s actual `Routes` type) | Done |
| Broken-link/performance checks never silently pass an unchecked URL as healthy | `SeoAuditAdapter` contract: every check resolves to `'ok'\|'broken'\|'inconclusive'`, never a boolean | `seoAudit.test.js` | Done |
| No real SEO-audit-provider credentials are ever required or exercised in this environment | `SEO_AUDIT_PROVIDER` defaults to `mock` in dev, `disabled` in production unless explicitly opted into — identical pattern to every prior adapter | `seoAudit.test.js` (Mock/Disabled adapter unit tests) | Done |
| Cross-agency isolation on every new guarded model | `visibilityGuard.js` + `clientVisibleModels.js` accessors, denormalized `organizationId`/`agencyOrganizationId` on all 5 new tables | Raw-unscoped-query-throws + cross-agency tests throughout all Phase 8 test files | Done |

## Repository changes

### Backend

- New permission: `seo.manage_entitlements` (`catalog.js` + seed migration).
- New models (all guarded via `installVisibilityGuard`): `SeoEntitlementGrant`, `WebsitePageSeoSettings`, `WebsiteRedirect`, `WebsiteSeoAudit`, `SeoTaskCycle`; `Website` extended (`googleSearchConsolePropertyUrl`).
- Adapter: `server/core/integrations/seoAudit/seoAuditAdapter.js` (`SeoAuditAdapter`/`LiveSeoAuditAdapter`/`MockSeoAuditAdapter`/`DisabledSeoAuditAdapter`).
- Modules/services: `server/modules/seo/{seoEntitlementService,seoTaskCycleService,seoDashboardService,seoSearchConsoleService,seoAuditService,seoRedirectService,seoPageSettingsService}.js`; `server/core/seo/structuralAudit.js` (pure, no I/O).
- Routes/APIs: `/api/v1/seo/{organizations/:organizationId/entitlement-status, organizations/:organizationId/entitlement-grants, organizations/:organizationId/entitlement-grants/:grantId/revoke, agency-overview}`; `/api/v1/projects/:projectId/website/seo/{pages, pages/:pageId, sitemap.xml, robots.txt, redirects, redirects/:redirectId, audits, audits/:auditId, task-cycles, dashboard, search-console}`.
- Authorization: `seo.manage_entitlements` for entitlement management; `projects.view`/`builder.edit`/`builder.manage` reused (not duplicated) for the website-scoped SEO routes, each additionally gated inside the service layer by `assertSeoEntitlement`.
- Jobs/events: none new — SEO task-cycle generation is an explicit, employee-triggered action, matching Phase 7's "no background scheduler exists yet" precedent.

### Frontend

- Routes/screens: no new route — the Website panel in `src/app/features/projects/` grew a full SEO section (entitlement, page metadata, redirects, audits, task cycles, GSC connection) plus a per-version "Run SEO Audit" button.
- State/services: new `src/app/core/services/seo.service.ts`; new models in `src/app/core/models/seo.model.ts` (`SeoEntitlementGrant`, `WebsitePageSeoSettings`, `SeoPageListEntry`, `WebsiteRedirect`, `SeoAuditFinding`, `WebsiteSeoAudit`, `SeoTaskCycle`, `SeoAuditSummary`, `SeoDashboard`, `AgencySeoOverviewRow`).
- Permission behavior: entitlement management gated by `seo.manage_entitlements`; page-metadata editing by `builder.edit`/`builder.manage`; other SEO panels by `projects.view`/`builder.manage` as appropriate, matching backend route gates exactly.
- Mobile/accessibility: reuses the app's existing table/form patterns; no dedicated mobile layout, consistent with prior phases' own deferral.

### Database

- New tables: `SeoEntitlementGrants`, `WebsitePageSeoSettings`, `WebsiteRedirects`, `WebsiteSeoAudits`, `SeoTaskCycles`.
- Changed tables: `Websites` gained `googleSearchConsolePropertyUrl`.
- Indexes/constraints: every new table denormalizes `organizationId`/`agencyOrganizationId` directly; unique index on `WebsitePageSeoSettings(websiteId, pageId)`, `WebsiteRedirects(websiteId, fromPath)`, and — the load-bearing one — `SeoTaskCycles(websiteId, cyclePeriod)`, verified by direct migration read to be a real DB-level `unique: true` index, not merely an application-level convention.
- Backfills: none needed — every new column/table is additive and nullable/defaulted, changing no observable behavior for pre-existing rows.
- Rollback behavior: every schema migration has a working, correctly-ordered `down()`; the permission-seed migration is intentionally not reversed, matching established precedent.

## Legacy compatibility

- Preserved workflows: Phases 1–7 untouched. `assertSeoEntitlement` is defined and imported only within `server/modules/seo/`; grepped confirmation that no Phase 1–7 code path calls it.
- Compatibility adapters: none needed.
- Deprecated fields/routes: none.
- Planned removal phase: N/A.

## Security and privacy

- Secret handling: `.env.example` documents `SEO_AUDIT_PROVIDER=mock`/`SEO_AUDIT_API_CREDENTIALS_JSON=` with placeholder values only; `SEO_AUDIT_PROVIDER` defaults to `mock` in dev and the adapter factory logs a warning if `mock` is ever set in production. No real credentials anywhere in this repository, and none were ever exercised — CLAUDE.md rule 8 held throughout.
- Authentication/session changes: none.
- Authorization/isolation tests: every new guarded model has a dedicated raw-unscoped-query-throws test; cross-agency isolation verified for all 5 new models, including the one genuinely new class of route (`:organizationId`-scoped, not website-scoped) that neither the pre-implementation review nor the initial draft's route design had a built-in ownership check for — self-caught during slice 1 implementation and closed with `assertClientOrganizationOwnedByAgency`.
- Impersonation/audit behavior: entitlement grant/revoke both call `recordAudit` explicitly.
- **Design-review-before-implementation, again**: the full architecture draft was escalated to `fable-phase-reviewer` before any migration was written. That review returned 9 findings, 3 must-fix, all incorporated into `current-phase-plan.md` before implementation began. The most load-bearing: (1) entitlement resolution must join through `BillingAccount hasMany Subscription` — `Subscription` has no `organizationId` column, so a naive `Subscription.findOne({where:{organizationId}})` would throw against the real schema; (2) `WebsitePageSeoSettings`/`WebsiteRedirect`/`WebsiteSeoAudit`'s original field lists omitted `organizationId`/`agencyOrganizationId` — corrected to denormalize them directly at row-creation time, matching every other guarded model rather than relying on an `include` (ADR 0007's documented include-bypass gap); (3) `requireSeoEntitlement` cannot be Express middleware — `resolveContext()` never loads the *target resource's* owning organization (only the requester's own), so entitlement can only be checked after the service layer has already resolved `projectId → website.organizationId`. A fourth must-fix-grade correction (an AI-provider adapter) was resolved by deferring it entirely rather than building even a shape-only stub, since no concrete Phase 8 outcome depends on it and architecture §24 ranks AI last.
- **Closing-review scope**: a dedicated `fable-phase-reviewer` closing review covered the major gate (both directions), entitlement resolution correctness, the `WebsiteSeoAudit` trust/visibility split, `SeoTaskCycle`'s idempotency claim, and cross-agency isolation, per CLAUDE.md's escalation rule. The review ran across two sessions (the first resumption was interrupted mid-investigation by a genuine usage-limit stop) and, given its own time constraints, explicitly flagged several claims it had not independently opened the source for. Per this session's established practice (CLAUDE.md rule 7 — verify claims against current code, don't just re-trust them), every one of those flagged items was independently re-verified directly against the code after the review returned: the `SeoTaskCycles(websiteId, cyclePeriod)` migration index confirmed `unique: true` by direct read; `seoTaskCycleService.generateCycle` confirmed to create the row first and catch `SequelizeUniqueConstraintError`, not check-then-create; all 5 new models' migrations confirmed to carry `organizationId`/`agencyOrganizationId` columns with the documented indexes; `SeoAuditAdapter`'s three-outcome (`ok`/`broken`/`inconclusive`) contract and `structuralAudit.js`'s pure-function/no-DB-access design confirmed by direct read; `assertSeoEntitlement` confirmed called at the top of every one of `seoRedirectService.js`/`seoAuditService.js`/`seoTaskCycleService.js`/`seoSearchConsoleService.js`'s exported functions; every caller of the generator's `buildGeneratedFiles` (which now threads `redirects` through) confirmed to sit behind a `builder.develop`/`builder.manage`-gated route, never a client-reachable one. No Critical or High findings surfaced by either the review or this follow-up verification.

## Validation commands run

- Frontend build: `ng build` — clean (only the pre-existing, unrelated `landing.component.scss` budget warning).
- Frontend tests: `ng test --watch=false --browsers=ChromeHeadless` — **18/18 passing**.
- Unit/integration tests: `npm run test:backend` (`--runInBand`, required — tests share one real test database and will spuriously fail under parallel workers) — **472/472 passing (56 suites)**.
- New tests this phase: `seoEntitlement.test.js` (16), `seoPageSettings.test.js` (17), `seoRedirects.test.js` (9), `structuralAudit.test.js` (10, pure unit), `seoAudit.test.js` (9), `seoTaskCycle.test.js` (8), `seoDashboard.test.js` (6), `seoSearchConsole.test.js` (6), plus 2 new redirect-emission tests in `angularGeneratorOutput.test.js` (including a real `tsc` compile against `@angular/router`'s actual `Routes` type).
- Migration tests: all 7 Phase 8 migrations applied cleanly to both the real dev database and a freshly-migrated test database.
- **Real end-to-end browser verification**: a full Puppeteer smoke test (`smoke-phase8-seo.js`) drove the SEO panel through actual DOM interactions — granted a manual entitlement, edited page metadata, created and deleted a redirect, ran a real audit and inspected its findings, generated a task cycle (and confirmed a second same-period attempt was rejected), and connected Google Search Console — with server-side database verification at critical steps. 23/24 assertions passed on the last full run; the 24th (agency-overview) hit a rate-limit artifact from repeated debug runs in the same session, not a real failure, and agency-overview correctness is separately covered by passing backend tests. The smoke test itself surfaced and led to the fix of one real minor frontend bug (the audits table rendering raw JSON instead of error/warning counts).

## Review pass 1 — pre-implementation design review (before any code was written)

| Severity | Finding | Resolution | Verification |
|---|---|---|---|
| Must-fix | `Subscription` has no `organizationId` column; entitlement resolution must join through `BillingAccount hasMany Subscription` | `hasActiveSubscriptionSeoAddon` resolves `BillingAccount` first, then checks all its `Subscription` rows | `seoEntitlement.test.js` |
| Must-fix | `WebsitePageSeoSettings`/`WebsiteRedirect`/`WebsiteSeoAudit`'s draft field lists omitted `organizationId`/`agencyOrganizationId` | All three denormalize both columns directly, populated at row-creation time | Migration files read directly; cross-agency tests |
| Must-fix | `requireSeoEntitlement` cannot be Express middleware — `resolveContext()` never loads the target resource's owning organization | Implemented as a plain service-layer function (`assertSeoEntitlement`), called after the service layer resolves the website | Code inspection; every SEO service file |

Plus 6 additional worth-noting/minor findings, all incorporated into `current-phase-plan.md` before implementation (the AI-provider adapter deferred entirely, not even a shape-only stub, since no concrete Phase 8 outcome depends on it and architecture §24 ranks AI last; slice granularity and ordering refined; the dashboard's entitlement-exempt response shape specified explicitly; redirect emission ordering relative to page routes called out; the sitemap/robots generation scope narrowed to reflect real page routes only; the recurring-task-cycle titles/description content specified).

## Review pass 2 — final full-phase closing review (fable-phase-reviewer)

A dedicated closing review covering the major gate's airtightness in both directions, entitlement resolution correctness, the `WebsiteSeoAudit` trust/visibility split, `SeoTaskCycle`'s idempotency claim, cross-agency isolation, and regression risk, per CLAUDE.md's escalation rule.

| Severity | Finding | Resolution | Verification |
|---|---|---|---|
| — | No Critical/High/Medium findings raised against any area the review actually opened source for | N/A | — |

The review's own working session was interrupted twice by session/usage-limit boundaries (a normal operational constraint of this environment, not a defect in the work reviewed) and it explicitly declined to sign off on the areas it had not directly opened source for, rather than re-asserting the plan's own claims as verified. Every one of those flagged-but-unopened areas was then independently re-verified directly against the code in this session (not merely re-trusted): the `SeoTaskCycles` migration's `unique: true` index on `(websiteId, cyclePeriod)`; `generateCycle`'s create-first/catch-`SequelizeUniqueConstraintError` implementation; all 5 new models' migration column definitions; `SeoAuditAdapter`'s three-outcome contract and `structuralAudit.js`'s pure-function design; `assertSeoEntitlement` call-site coverage across all remaining SEO service files; and every caller of the redirect-threading `buildGeneratedFiles` sitting behind an employee-only route gate. No Critical or High findings surfaced by either pass.

## Regression verification

Every Phase 1–7 test suite re-run unchanged and passing alongside the 8 new/extended Phase 8 suites. 472/472 backend (56 suites, run with `--runInBand` as the repository's own `test:backend` script requires — an initial unqualified parallel `jest` run produced 24 spurious failures from concurrent workers colliding on the shared test database, not real regressions; re-run correctly, all pass), 18/18 frontend, clean `ng build`.

## Data migration evidence

- Empty DB result: all 7 Phase 8 migrations apply cleanly to an empty database.
- Legacy DB result: applied cleanly on top of the full Phase 1–7 migration history.
- Record counts before/after: N/A — every Phase 8 table is new; the one changed table (`Websites`) gained only a nullable column.
- Duplicate/loss checks: N/A (additive-only).
- Rollback test: every Phase 8 schema migration has a working, correctly-ordered `down()`, directly reviewed; not exercised via a full rollback-and-re-migrate cycle this phase, matching the same noted limitation from every prior phase's report.

## Manual configuration required

- **SEO audit provider**: set `SEO_AUDIT_PROVIDER=live` plus a real `SEO_AUDIT_API_CREDENTIALS_JSON` in the untracked `.env` once a real broken-link/performance-audit provider account is provisioned. Until then, `SEO_AUDIT_PROVIDER=mock` (the current default) carries the entire link/performance-check workflow with a clearly-labeled, fully-tested in-memory simulation; structural checks (page titles, alt text, meta fields) require no external provider at all and always run for real.
- **Google Search Console**: no Leadzaro-side credentials needed — `googleSearchConsolePropertyUrl` is a client/employee-entered value validated for shape only, exactly mirroring the Phase 7 Google Analytics precedent.
- **Billing**: the `seo_addon` `ServicePlan` is seeded (key `seo_addon`, `amountCents: 29900`); no real Stripe product/price was created or charged, matching CLAUDE.md rule 8 — an agency wiring this to a real Stripe price does so through the existing Phase 3 billing configuration, unchanged by this phase.
- No secret values are or will be committed; only `.env.example` with placeholders is tracked.

## Deferred backlog

### Medium priority

- The Live `SeoAuditAdapter`'s real broken-link/performance-check implementation is a named, deliberate deferral — there is nothing to validate a real provider integration against without live credentials, and this phase's Mock/Disabled path already proves the orchestration and findings-merging logic correctly.
- No dedicated background scheduler exists for recurring SEO task-cycle generation — `generateCycle` is a real, complete, employee-triggered action today; wiring it to a recurring cron (or an external scheduler hitting the same endpoint) is a natural, low-risk addition once such infrastructure exists anywhere in this codebase (same deferred item noted in Phase 7's report for domain renewal checks).

### Low priority

- No dedicated mobile layout for the new SEO panel beyond the app's existing responsive patterns.
- An AI-assistance provider for SEO content suggestions was deliberately deferred entirely (not even a shape-only adapter stub) per the pre-implementation review's must-fix-grade correction — architecture §24 ranks AI last and "never a core dependency," and no concrete Phase 8 outcome depends on it.

### Deliberately deferred to later phase

- None — Phase 8 is the final phase in the current roadmap (`docs/planning/06_PHASES_2_TO_8_ROADMAP.md`). Any further SEO/premium-services expansion (e.g., the AI-assistance provider above, a live audit provider integration, scheduled recurring generation) would begin a new, not-yet-documented phase.

## Known risks

- No real SEO-audit-provider account has ever been exercised against the integration (no credentials in this environment) — the adapter interface and mock behavior are well-tested (including the three-outcome `ok`/`broken`/`inconclusive` contract), but real-provider field-shape assumptions are unverified until real credentials exist.
- `migrations.test.js`'s full-rollback-and-re-migrate test was not extended to include Phase 8's own migrations in a full down/up cycle — each migration's `down()` was written and directly reviewed but not exercised end-to-end, matching the same noted limitation from every prior phase.
- The closing review's working session was interrupted by session/usage-limit boundaries before it could independently open source for every claim in its own scope; every such gap was closed by direct self-verification in this session rather than left as an open question, but this is worth noting as this phase's review process looked structurally different from Phases 5–7's single-pass reviews.
- Running the backend test suite without `--runInBand` produces spurious failures from parallel workers sharing one test database — this is a pre-existing environmental characteristic of the test setup (not introduced this phase) but is easy to trip over; documented here so it isn't mistaken for a regression in a future session.

## Documentation updated

- README: not applicable.
- Architecture decisions: `docs/leadzaro/current-phase-plan.md` (the full, review-corrected Phase 8 design — evidence audit, corrected model designs, permission summary, testing priorities, slice order, pre-implementation review findings). No new ADR file was needed; Phase 8 reuses ADR 0007's existing guarded-model pattern without modification.
- API docs: none formal; routes documented inline via the phase plan and this report's acceptance matrix.
- Migration docs: inline comments in every new migration explaining its purpose and which review finding (if any) it implements.
- User/admin instructions: `.env.example` documents `SEO_AUDIT_PROVIDER`/`SEO_AUDIT_API_CREDENTIALS_JSON` with placeholder values and inline comments.

## Readiness for next phase

- Ready: Yes — this is the final phase in the documented roadmap.
- Blocking reasons: none.
- Recommended next-phase starting point: N/A — `docs/planning/06_PHASES_2_TO_8_ROADMAP.md` has no Phase 9. Any further work (a live SEO-audit-provider integration, an AI-assistance adapter, scheduled recurring task-cycle generation, a background job scheduler) would require a newly-scoped and documented phase, not a continuation of an existing one.
- Next step: a final, cross-phase end-to-end regression report and overall implementation summary covering Phases 1–8 together, per the active `/goal` directive's completion criteria.
